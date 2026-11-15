'use strict';
/**
 * tests/books-evidence.realstack.cjs — THE EVIDENCE BEHIND A BOOKS ROW on a REAL Postgres (cb_app, RLS on), through routes/books.js, routes/attachments.js and the real grant front (middleware/books-grant.js).
 * Only the sign-in is a stand-in (a header names who calls). It runs on a COPY of the sit-au database (the clean Harbour, owner entity HARBOUR) restored into a throwaway database, never on the live one.
 * HAND-COMPUTED (Harbour, Oct 2026, AUD): bills JPS-J1 A$880.00 (GST 80.00) and JPS-J2 A$1,650.00 (GST 150.00), Origin Energy expense HP-E1 A$242.00 (GST 22.00); sales HP-INV-1..4 1,705 / 2,750 / 330 / 495.
 *   bank 19,963.00 (opening 18,500 - 242 + 1,705) · AR 3,575.00 (2,750 + 330 + 495) · AP 2,530.00 (880 + 1,650) · GST paid 252.00 (22 + 80 + 150) · profit 2,280.00 (4,800 - 2,300 - 220)
 *   1 before any file: the three purchases carry flag no_tax_invoice and count 0 (each gross is above the pack's A$82.50); the sales and the opening carry no flag; the opening has doc null.
 *   2 the owner uploads a PDF on JPS-J1 through POST /api/attachments: the Day book reads count 1, the file's name, flag null; HP-E1 and JPS-J2 still flagged. A file on a MESSAGE of a chit is never evidence.
 *   3 the figures are the same before and after: bank, AR, AP, GST paid, profit (two carried totals compared, read from the trial balance and the P&L).
 *   4 the ledger of Creditors (2100) carries the same evidence on the JPS-J1 line.
 *   5 an auditor firm P under a LIVE grant reads the file (200, the same bytes, application/pdf inline, no-store) and the look is logged (+1 books_access_log row, route /evidence/:id); a file on a message is 404; a made-up id is 404;
 *     a non-GET is refused; a stranger firm Q with the header: 403; Q's own books: 404; after the owner revokes: 403.
 * Run: DATABASE_URL=postgres://cb_app:...@db:5432/cb_ev HARBOUR=ed90909a-... node tests/books-evidence.realstack.cjs   (a SIT box, a copy of the member database)
 */
const url = process.env.DATABASE_URL || '';
const ALLOWED_HOSTS = /^(localhost|127\.0\.0\.1|db|sit-[a-z]+(\.[a-z0-9.-]+)?)$/;
const parts = /^postgres(?:ql)?:\/\/([^:@/]+):[^@]*@([^:/]+)/.exec(url);
if (!parts || parts[1] !== 'cb_app' || !ALLOWED_HOSTS.test(parts[2])) { console.error('REFUSED: needs DATABASE_URL as cb_app on localhost, the compose db or a SIT host'); process.exit(3); }
if (!/cb_ev/.test(url)) { console.error('REFUSED: this run only touches the throwaway copy database (cb_ev)'); process.exit(3); }
process.env.NODE_ENV = 'test';
process.env.CB_TRIPS = '1';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'books_evidence_test_secret_at_least_32_chars_padding';
const path = require('path');
const express = require('express');
const API = path.join(__dirname, '..');
const HARBOUR = process.env.HARBOUR;

const authPath = require.resolve(path.join(API, 'middleware', 'auth.js'));
const { query, withEntity } = require(path.join(API, 'db'));
const fakeAuth = async (req, res, next) => {
  if (req.identity) return next();
  let who;
  try { who = JSON.parse(String(req.headers['x-test-as'] || '')); } catch (_) { return res.status(401).json({ error: 'no test identity' }); }
  req.identity = who;
  return next();
};
fakeAuth.entityOf = (req) => req.identity.parent_entity_id || req.identity.identity_id;
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: fakeAuth };
const net = require(path.join(API, 'src', 'services', 'network'));

let pass = 0, fail = 0;
const ok = (what, cond, info) => { if (cond) { pass++; console.log('  ok   ' + what); } else { fail++; console.log('  FAIL ' + what + (info ? '\n         ' + String(info).slice(0, 700) : '')); } };
const RUN = 'ev' + (Date.now() % 1e10).toString(36);
let base = '';
async function call(who, method, route, opts) {
  const o = opts || {};
  const headers = { 'content-type': 'application/json', 'x-test-as': JSON.stringify(who) };
  if (o.member) headers['x-books-for'] = o.member;
  const res = await fetch(base + route, { method, headers, body: o.body === undefined ? undefined : JSON.stringify(o.body) });
  const raw = Buffer.from(await res.arrayBuffer());
  let body = null;
  try { body = JSON.parse(raw.toString('utf8')); } catch (_) { body = null; }
  return { status: res.status, body, raw, type: res.headers.get('content-type'), cache: res.headers.get('cache-control'), disp: res.headers.get('content-disposition'), trips: res.headers.get('x-db-trips') };
}
async function business(tag) {
  const { rows: [identity] } = await query(`INSERT INTO identities (bridge_id, display_name, identity_type, country, currency_code, user_id) VALUES ($1, $2, 'entity', 'AU', 'AUD', $3) RETURNING identity_id, display_name`, ['CB' + RUN + tag, 'Firm ' + tag + ' ' + RUN, 'u_' + RUN + tag]);
  return { id: identity.identity_id, bridgeId: 'CB' + RUN + tag, name: identity.display_name, node: await net.nodeOf(identity.identity_id, { ensure: true }) };
}
const ownerOf = (b) => ({ identity_id: b.id, bridge_id: b.bridgeId, identity_type: 'entity', parent_entity_id: null, display_name: b.name });
const pdf = Buffer.from('%PDF-1.4\n% SAMPLE - fictional ' + RUN + '\n%%EOF');

async function main() {
  const { rows: [h] } = await query('SELECT identity_id, bridge_id, display_name FROM identities WHERE identity_id = $1', [HARBOUR]).catch(() => ({ rows: [] }));
  if (!h) { console.error('the Harbour entity is not in this database'); process.exit(2); }
  const owner = { identity_id: h.identity_id, bridge_id: h.bridge_id, identity_type: 'entity', parent_entity_id: null, display_name: h.display_name };
  const P = await business('p'), Q = await business('q');
  const harbourNode = await net.nodeOf(HARBOUR, { ensure: true });
  const asked = await net.requestConnect({ parentId: P.node.id, childId: harbourNode.id }, P.node);
  await net.approve({ edgeId: asked.id }, harbourNode);
  const app = express();
  app.use(require(path.join(API, 'lib', 'trips')).middleware());
  app.use(express.json({ limit: '10mb' }));
  app.use('/api/books', require(path.join(API, 'routes', 'books.js')));
  app.use('/api/books-grants', require(path.join(API, 'routes', 'books-grants.js')));
  app.use('/api/attachments', require(path.join(API, 'routes', 'attachments.js')));
  app.use((err, req, res, next) => res.status(500).json({ code: 'TEST_500', message: String(err && err.message) }));
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  base = 'http://127.0.0.1:' + server.address().port;
  const Pw = ownerOf(P), Qw = ownerOf(Q);
  const looks = async () => Number((await withEntity(HARBOUR, (c) => c.query("SELECT count(*)::int AS n FROM books_access_log WHERE grantor_entity = $1 AND route_pattern LIKE '%evidence%'", [HARBOUR]))).rows[0].n);
  try {
    const book = async (who, o) => (await call(who, 'GET', '/api/books/daybook?from=2026-07-01&to=2026-11-30', o)).body;
    const byRef = (d, ref) => (d.entries || []).find((e) => e.source && e.source.ref === ref);
    const figures = async () => {
      const tb = (await call(owner, 'GET', '/api/books/trial-balance?asOf=2026-11-30')).body;
      const pl = (await call(owner, 'GET', '/api/books/pl?from=2026-07-01&to=2026-11-30')).body;
      const rows = tb.rows || [];
      const bal = (code) => { const r = rows.find((x) => String(x.code) === code) || {}; return Number(r.dr_minor || 0) - Number(r.cr_minor || 0); };
      return { bank: bal('1500'), ar: bal('1300'), ap: -bal('2100'), gst_paid: bal('2210'), profit: Number(pl.profit_minor) };
    };
    const before = await figures();
    ok('0 the Harbour figures are the hand-computed ones: bank 19,963.00 · AR 3,575.00 · AP 2,530.00 · GST paid 252.00 · profit 2,280.00',
      before.bank === 1996300 && before.ar === 357500 && before.ap === 253000 && before.gst_paid === 25200 && before.profit === 228000, JSON.stringify(before));

    const d0 = await book(owner);
    const e1 = byRef(d0, 'JPS-J1'), e2 = byRef(d0, 'JPS-J2'), ex = byRef(d0, 'HP-E1'), s1 = byRef(d0, 'HP-INV-1');
    const opening = (d0.entries || []).find((e) => e.event_type === 'opening');
    ok('1a every entry carries evidence; a purchase with no file reads flag no_tax_invoice and count 0 (JPS-J1, JPS-J2, HP-E1)', [e1, e2, ex].every((e) => e && e.evidence && e.evidence.flag === 'no_tax_invoice' && e.evidence.count === 0 && e.evidence.doc && e.evidence.doc.chit_id && e.evidence.cite), JSON.stringify([e1 && e1.evidence, ex && ex.evidence]));
    ok('1b a sale carries its document, no flag; the opening has doc null and no flag', s1 && s1.evidence.flag === null && s1.evidence.doc && s1.evidence.doc.ref === 'HP-INV-1' && opening && opening.evidence.doc === null && opening.evidence.flag === null, JSON.stringify([s1 && s1.evidence, opening && opening.evidence]));

    const put = (who, chit, name, extra) => call(who, 'POST', '/api/attachments', { body: Object.assign({ chit_id: chit, name, mime: 'application/pdf', data_base64: pdf.toString('base64') }, extra || {}) });
    const up = await put(owner, e1.evidence.doc.chit_id, 'JPS-J1 tax invoice SAMPLE.pdf');
    ok('2a the owner attaches a PDF to JPS-J1 through the product door: 200 with an id', up.status === 200 && up.body && up.body.id, JSON.stringify([up.status, up.body]));
    const note = await put(owner, e2.evidence.doc.chit_id, 'private note.pdf', { message_id: '11111111-1111-4111-8111-111111111111' });
    ok('2b a file stored with a message id is accepted by the chit door (it is not evidence)', note.status === 200 && note.body && note.body.id, JSON.stringify([note.status, note.body]));
    const d1 = await book(owner);
    const f1 = byRef(d1, 'JPS-J1'), f2 = byRef(d1, 'JPS-J2'), fx = byRef(d1, 'HP-E1');
    ok('2c JPS-J1 now reads count 1, its file name and no flag; JPS-J2 (only a message file) and HP-E1 stay flagged', f1.evidence.count === 1 && f1.evidence.files[0].name === 'JPS-J1 tax invoice SAMPLE.pdf' && f1.evidence.flag === null && f2.evidence.count === 0 && f2.evidence.flag === 'no_tax_invoice' && fx.evidence.flag === 'no_tax_invoice', JSON.stringify([f1.evidence, f2.evidence]));
    ok('2d no bytes and no object key in the list', !JSON.stringify(d1).match(/data_base64|object_key|"data"/), '');

    const after = await figures();
    ok('3 the figures are the same after the files (bank, AR, AP, GST paid, profit compared with the carried before)', JSON.stringify(before) === JSON.stringify(after), JSON.stringify([before, after]));
    const led = (await call(owner, 'GET', '/api/books/ledger/2100?from=2026-07-01&to=2026-11-30')).body;
    const line = (led.lines || []).find((l) => l.source && l.source.ref === 'JPS-J1');
    ok('4 the Creditors ledger carries the same evidence on the JPS-J1 line (count 1)', line && line.evidence && line.evidence.count === 1 && line.evidence.files[0].id === up.body.id, JSON.stringify(line && line.evidence));

    const fileId = up.body.id;
    const own = await call(owner, 'GET', '/api/books/evidence/' + fileId);
    ok('5a the owner reads the file: 200, the same bytes, application/pdf inline, no-store', own.status === 200 && own.raw.equals(pdf) && /application\/pdf/.test(own.type) && /^inline/.test(own.disp) && /no-store/.test(own.cache), JSON.stringify([own.status, own.type, own.disp, own.cache]));
    const g = await call(owner, 'POST', '/api/books-grants', { body: { grantee: P.id, purpose: 'audit of the books', consent: true } });
    ok('5b the owner gives the auditor firm P a grant', g.status === 201, JSON.stringify(g.body));
    const n0 = await looks();
    const aud = await call(Pw, 'GET', '/api/books/evidence/' + fileId, { member: HARBOUR });
    const n1 = await looks();
    ok('5c the auditor under a LIVE grant reads the file: 200, the same bytes, no-store, and the look is logged (+1)', aud.status === 200 && aud.raw.equals(pdf) && /no-store/.test(aud.cache) && n1 === n0 + 1, JSON.stringify([aud.status, n0, n1]));
    const audList = await call(Pw, 'GET', '/api/books/daybook?from=2026-07-01&to=2026-11-30', { member: HARBOUR });
    const af = byRef(audList.body, 'JPS-J1');
    ok('5d the auditor Day book carries the same evidence and the flag on HP-E1', af && af.evidence.count === 1 && byRef(audList.body, 'HP-E1').evidence.flag === 'no_tax_invoice', JSON.stringify(af && af.evidence));
    const msgFile = await call(Pw, 'GET', '/api/books/evidence/' + note.body.id, { member: HARBOUR });
    ok('5e a file stored on a MESSAGE is not evidence: 404, the same as a made-up id', msgFile.status === 404 && (await call(Pw, 'GET', '/api/books/evidence/22222222-2222-4222-8222-222222222222', { member: HARBOUR })).status === 404, JSON.stringify(msgFile.status));
    const write = await call(Pw, 'POST', '/api/books/evidence/' + fileId, { member: HARBOUR, body: {} });
    ok('5f a write through the grant is refused (not a 2xx)', write.status >= 400, JSON.stringify(write.status));
    const stranger = await call(Qw, 'GET', '/api/books/evidence/' + fileId, { member: HARBOUR });
    ok('5g a stranger firm naming the Harbour: 403', stranger.status === 403, JSON.stringify(stranger.status));
    const own404 = await call(Qw, 'GET', '/api/books/evidence/' + fileId);
    ok('5h a stranger reading his OWN books with the Harbour file id gets no file (RLS: 404, or 422 while his own books are not on)', own404.status !== 200 && !own404.raw.equals(pdf), JSON.stringify(own404.status));
    const rv = await call(owner, 'POST', '/api/books-grants/' + g.body.grant_id + '/revoke', { body: {} });
    const gone = await call(Pw, 'GET', '/api/books/evidence/' + fileId, { member: HARBOUR });
    ok('5i the owner revokes: the auditor is 403 at once', rv.status === 200 && gone.status === 403, JSON.stringify([rv.status, gone.status]));
    console.log('TRIPS daybook ' + (audList.trips || '-') + ' (9 entries, one extra read for the files)');
  } finally {
    server.close();
  }
  console.log('\n' + pass + ' ok, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error('CRASH', e); process.exit(1); });
