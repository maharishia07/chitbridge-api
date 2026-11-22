'use strict';
/**
 * tests/books-evidence.realstack.cjs — THE EVIDENCE BEHIND A BOOKS ROW on a REAL Postgres (cb_app, RLS on), through routes/books.js, routes/attachments.js and the real grant front (middleware/books-grant.js).
 * Only the sign-in is a stand-in (a header names who calls). R76 · RERUNNABLE ON ANY BOX: it SEEDS ITS OWN throwaway Australian shop (a fresh entity, the ledger switched on through POST /api/books/enable, three purchase bills with a
 * chit each, one walk-in day) and reads that shop only. It never reads, resets or deletes another shop's rows (the Harbour demo's live state changes under other lanes' hands, so a count taken from it was never stable).
 * HAND-COMPUTED (the rig, Oct 2026, AUD, whole dollars): bills JPS-J1 A$880.00 (GST 80.00), JPS-J2 A$1,650.00 (GST 150.00), HP-E1 A$242.00 (GST 22.00); walk-in day 2026-10-10 A$1,100.00 cash (1,000 + GST 100).
 *   AP 2,772.00 (880 + 1,650 + 242) · GST paid 252.00 (80 + 150 + 22) · GST collected 100.00 · profit -1,520.00 (sales 1,000 - purchases 800 + 1,500 + 220)
 *   1 before any file: the three purchases carry flag no_tax_invoice and count 0 (each gross is above the pack's A$82.50); the walk-in day carries no flag and no document.
 *   2 the owner uploads a PDF on JPS-J1 through POST /api/attachments: the Day book reads count 1, the file's name, flag null; HP-E1 and JPS-J2 still flagged. A file on a MESSAGE of a chit is never evidence.
 *   3 the figures are the same before and after: bank, AR, AP, GST paid, profit (two carried totals compared, read from the trial balance and the P&L).
 *   4 the ledger of Creditors (2100) carries the same evidence on the JPS-J1 line.
 *   5 an auditor firm P under a LIVE grant reads the file (200, the same bytes, application/pdf inline, no-store) and the look is logged (+1 books_access_log row, route /evidence/:id); a file on a message is 404; a made-up id is 404;
 *     a non-GET is refused; a stranger firm Q with the header: 403; Q's own books: 404; after the owner revokes: 403.
 * Run: DATABASE_URL=postgres://cb_app:...@db:5432/<db> node tests/books-evidence.realstack.cjs   (the local stack's db or a SIT box other than sit-au, which is frozen; no other setting)
 */
const url = process.env.DATABASE_URL || '';
const ALLOWED_HOSTS = /^(localhost|127\.0\.0\.1|db|sit-[a-z]+(\.[a-z0-9.-]+)?)$/;
const FROZEN_HOST = /^sit-au(\.|$)|^129\.225\.90\.80$/; /* sit-au is FROZEN: nothing runs against it */
const parts = /^postgres(?:ql)?:\/\/([^:@/]+):[^@]*@([^:/]+)/.exec(url);
if (parts && FROZEN_HOST.test(parts[2])) { console.error('REFUSED: sit-au is frozen; run on another box or the local stack'); process.exit(3); }
if (!parts || parts[1] !== 'cb_app' || !ALLOWED_HOSTS.test(parts[2])) { console.error('REFUSED: needs DATABASE_URL as cb_app on localhost, the compose db or a SIT host'); process.exit(3); }
process.env.NODE_ENV = 'test';
process.env.CB_TRIPS = '1';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'books_evidence_test_secret_at_least_32_chars_padding';
const path = require('path');
const express = require('express');
const API = path.join(__dirname, '..');
let SHOP = null; /* the rig's own shop, made in main() */

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
const RUN = 'ev' + (Date.now() % 1e10).toString(36).padStart(6, '0');
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
  const S0 = await business('s');
  SHOP = S0.id;
  const owner = ownerOf(S0);
  await withEntity(SHOP, (c) => require(path.join(API, 'lib', 'country-setup.js')).save(c, SHOP, { country: 'AU', currency: 'AUD', fy_start_month: 7, timezone: 'Australia/Sydney', tax: { registered: true, number: '51824753556', scheme: 'regular' }, source: { tax: 'typed' } }, SHOP));
  const P = await business('p'), Q = await business('q');
  const harbourNode = S0.node;
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
  const on = await call(owner, 'POST', '/api/books/enable', { body: {} });
  ok('0a the rig shop switches its ledger on (AU pack)', on.status === 200, JSON.stringify(on.body));
  /* the three purchases, each on a chit of the shop (the document the file is held on) */
  const B = require(path.join(API, 'lib', 'books'));
  const crypto = require('crypto'), SUPPLIER = crypto.randomUUID();
  const chitOf = async (ref) => {
    const id = crypto.randomUUID();
    await withEntity(SHOP, async (c) => {
      await c.query(`INSERT INTO chit_header (chit_id, entity_id, direction, sender_entity_id, sender_entity_bridge_id, sender_entity_display_name) VALUES ($1, $2, 'received', $2, $3, $4)`, [id, SHOP, S0.bridgeId, 'Rig supplier ' + ref]);
      await c.query('INSERT INTO chit_detail (chit_id, entity_id, direction, total_value, currency_code) VALUES ($1, $2, $3, $4, $5)', [id, SHOP, 'received', 0, 'AUD']);
    });
    return id;
  };
  const buy = async (ref, taxable, gst, date) => B.postEntry(null, SHOP, { type: 'purchase_bill', ref, date, currency: 'AUD', party: SUPPLIER, source_chit_id: await chitOf(ref), source_ref: 'chit:' + RUN + ref, by_rate: [{ rate: 10, taxable, gst }], paid: 0 });
  const posted = [await buy('JPS-J1', 800, 80, '2026-10-05'), await buy('JPS-J2', 1500, 150, '2026-10-06'), await buy('HP-E1', 220, 22, '2026-10-08')];
  const day = await B.postEntry(null, SHOP, { type: 'walkin_day', ref: 'HP-INV-1', date: '2026-10-10', currency: 'AUD', modes: { cash: 1100 }, by_rate: [{ rate: 10, taxable: 1000, gst: 100 }] });
  ok('0b the rig posts three purchase bills and one walk-in day', posted.concat([day]).every((x) => x && x.ok), JSON.stringify(posted.concat([day])));
  const looks = async () => Number((await withEntity(SHOP, (c) => c.query("SELECT count(*)::int AS n FROM books_access_log WHERE grantor_entity = $1 AND route_pattern LIKE '%evidence%'", [SHOP]))).rows[0].n);
  try {
    const book = async (who, o) => (await call(who, 'GET', '/api/books/daybook?from=2026-07-01&to=2026-11-30', o)).body;
    /* the rig's documents are told apart by what they carry (the chit's own number is not on the row): gross, in minor units; the walk-in day by its event type */
    const GROSS = { 'JPS-J1': 88000, 'JPS-J2': 165000, 'HP-E1': 24200 };
    const byRef = (d, ref) => (d.entries || []).find((e) => (ref === 'HP-INV-1' ? e.event_type === 'walkin_day' : e.event_type === 'purchase_bill' && e.lines.some((l) => l.code === '2100' && l.cr_minor === GROSS[ref])));
    const figures = async () => {
      const tb = (await call(owner, 'GET', '/api/books/trial-balance?asOf=2026-11-30')).body;
      const pl = (await call(owner, 'GET', '/api/books/pl?from=2026-07-01&to=2026-11-30')).body;
      const rows = tb.rows || [];
      const bal = (code) => { const r = rows.find((x) => String(x.code) === code) || {}; return Number(r.dr_minor || 0) - Number(r.cr_minor || 0); };
      return { ap: -bal('2100'), gst_paid: bal('2210'), gst_collected: -bal('2200'), profit: Number(pl.profit_minor) };
    };
    const before = await figures();
    ok('0 the rig figures are the hand-computed ones: AP 2,772.00 · GST paid 252.00 · GST collected 100.00 · profit -1,520.00',
      before.ap === 277200 && before.gst_paid === 25200 && before.gst_collected === 10000 && before.profit === -152000, JSON.stringify(before));

    const d0 = await book(owner);
    const e1 = byRef(d0, 'JPS-J1'), e2 = byRef(d0, 'JPS-J2'), ex = byRef(d0, 'HP-E1'), s1 = byRef(d0, 'HP-INV-1');
    ok('1a every entry carries evidence; a purchase with no file reads flag no_tax_invoice and count 0 (JPS-J1, JPS-J2, HP-E1)', [e1, e2, ex].every((e) => e && e.evidence && e.evidence.flag === 'no_tax_invoice' && e.evidence.count === 0 && e.evidence.doc && e.evidence.doc.chit_id && e.evidence.cite), JSON.stringify([e1 && e1.evidence, ex && ex.evidence]));
    ok('1b the walk-in day carries no flag and no document', s1 && s1.evidence.flag === null && (s1.evidence.doc === null || !s1.evidence.doc.chit_id), JSON.stringify(s1 && s1.evidence));

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
    ok('3 the figures are the same after the files (AP, GST paid, GST collected, profit compared with the carried before)', JSON.stringify(before) === JSON.stringify(after), JSON.stringify([before, after]));
    const led = (await call(owner, 'GET', '/api/books/ledger/2100?from=2026-07-01&to=2026-11-30')).body;
    const line = (led.lines || []).find((l) => l.source && l.source.chit_id === e1.evidence.doc.chit_id);
    ok('4 the Creditors ledger carries the same evidence on the JPS-J1 line (count 1)', line && line.evidence && line.evidence.count === 1 && line.evidence.files[0].id === up.body.id, JSON.stringify(line && line.evidence));

    const fileId = up.body.id;
    const own = await call(owner, 'GET', '/api/books/evidence/' + fileId);
    ok('5a the owner reads the file: 200, the same bytes, application/pdf inline, no-store', own.status === 200 && own.raw.equals(pdf) && /application\/pdf/.test(own.type) && /^inline/.test(own.disp) && /no-store/.test(own.cache), JSON.stringify([own.status, own.type, own.disp, own.cache]));
    const g = await call(owner, 'POST', '/api/books-grants', { body: { grantee: P.id, purpose: 'audit of the books', consent: true } });
    ok('5b the owner gives the auditor firm P a grant', g.status === 201, JSON.stringify(g.body));
    const n0 = await looks();
    const aud = await call(Pw, 'GET', '/api/books/evidence/' + fileId, { member: SHOP });
    const n1 = await looks();
    /* MONEY-01 A6 (21 Nov, Athi: an accountant's access is explicit): the file download is the ADVISER grant's only; an auditor under a live grant is refused and nothing is logged as looked at (middleware/books-grant FILE_READS) */
    ok('5c the auditor under a LIVE grant is refused the file download: 403, no bytes, no look logged (the adviser grant alone downloads a file)', aud.status === 403 && !(aud.raw && aud.raw.equals(pdf)) && n1 === n0, JSON.stringify([aud.status, n0, n1]));
    const audList = await call(Pw, 'GET', '/api/books/daybook?from=2026-07-01&to=2026-11-30', { member: SHOP });
    const af = byRef(audList.body, 'JPS-J1');
    ok('5d the auditor Day book carries the same evidence and the flag on HP-E1', af && af.evidence.count === 1 && byRef(audList.body, 'HP-E1').evidence.flag === 'no_tax_invoice', JSON.stringify(af && af.evidence));
    const msgFile = await call(owner, 'GET', '/api/books/evidence/' + note.body.id);
    ok('5e a file stored on a MESSAGE is not evidence: 404 for its owner, the same as a made-up id (the auditor is refused 403 at the door for both: nothing to tell them apart)', msgFile.status === 404 && (await call(owner, 'GET', '/api/books/evidence/22222222-2222-4222-8222-222222222222')).status === 404 && (await call(Pw, 'GET', '/api/books/evidence/' + note.body.id, { member: SHOP })).status === 403, JSON.stringify(msgFile.status));
    const write = await call(Pw, 'POST', '/api/books/evidence/' + fileId, { member: SHOP, body: {} });
    ok('5f a write through the grant is refused (not a 2xx)', write.status >= 400, JSON.stringify(write.status));
    const stranger = await call(Qw, 'GET', '/api/books/evidence/' + fileId, { member: SHOP });
    ok('5g a stranger firm naming the shop: 403', stranger.status === 403, JSON.stringify(stranger.status));
    const own404 = await call(Qw, 'GET', '/api/books/evidence/' + fileId);
    ok('5h a stranger reading his OWN books with the rig shop file id gets no file (RLS: 404, or 422 while his own books are not on)', own404.status !== 200 && !own404.raw.equals(pdf), JSON.stringify(own404.status));
    const rv = await call(owner, 'POST', '/api/books-grants/' + g.body.grant_id + '/revoke', { body: {} });
    const gone = await call(Pw, 'GET', '/api/books/evidence/' + fileId, { member: SHOP });
    ok('5i the owner revokes: the auditor is 403 at once', rv.status === 200 && gone.status === 403, JSON.stringify([rv.status, gone.status]));
    console.log('TRIPS daybook ' + (audList.trips || '-') + ' (4 entries, one extra read for the files)');
  } finally {
    server.close();
  }
  console.log('\n' + pass + ' ok, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error('CRASH', e); process.exit(1); });
