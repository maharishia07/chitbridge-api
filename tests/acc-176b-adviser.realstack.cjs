'use strict';
/**
 * tests/acc-176b-adviser.realstack.cjs — ACC-176b (an adviser FIRM acting for a store's owner: prepare, review, accept) on a REAL Postgres, as the role the api runs as (cb_app, RLS on), through the REAL routers
 * (routes/books-actions.js, routes/books-grants.js, routes/books.js) and the real grant front (middleware/books-grant.js). Only the sign-in is a stand-in: a header names who calls, and the person's row is read from the
 * identities table on every request as middleware/auth does (a removed person is refused, a demoted person has the demoted level). Migrations b863, b865 and b866 are built by the fresh-db step.
 * HAND-COMPUTED  firm P with people A and B (editor, whole entity), C (editor, one node), D (removed later), a reviewer-only auditor person U; stores M1 and M2 (India, INR, ledger on) under P; a stranger S with person Z.
 *   M1 gives P an AUDITOR grant and an ADVISER grant; M2 gives P an adviser grant. Every journal is Dr cash 10000 / Cr sales 10000 minor (INR 100.00).
 *   1 A prepares: 201, waiting_review, INR 10000, stamped A + firm + maker; nothing posted.   2 A reviews own: 403.   3 owner accepts unreviewed: 409.   4 B reviews: waiting_accept; stamped B + checker.
 *   5 a person outside the firm: refused.   6 a removed person: 401; a demoted person: refused.   7 an auditor grant cannot prepare, nor write, even while the firm holds an adviser grant (both role headers).
 *   8 a stale tab of M2 on M1: 409 STORE_MISMATCH, nothing stored.   9 a return needs a reason; with it the round ends and a review is refused.   10 the owner accepts: posted ONCE, created_by A, grant_id, source action:<id>; a second accept 409.
 *   11 a wrong carried total: 409 PREVIEW_TOTAL_DIFFERS, nothing posted; a wrong body hash: 409.   12 two people, each stamped on a different action.   13 revoke withdraws the open action; the auditor grant still reads.
 *   14 M1, M2, M1: each queue is its own.   15 the owner's log shows the person, the firm and the role.   16 the same client_ref: refused open, refused once posted.   17 a foreign currency: refused.   18 an entry of another store: 404.
 *   19 a second grant of the other role warns the owner.   20 a lock action posts through the existing writer.   21 a log row that cannot be written: 503 and nothing stored.
 * Run: DATABASE_URL=postgres://cb_app:cbapp@localhost:5432/cb_s41 node tests/acc-176b-adviser.realstack.cjs   (CI: the integration job; a SIT box: tests/sit-api-tests.sh)
 * CARD      04-network/ACC-176B-ADVISER-REQUIREMENT
 */
const url = process.env.DATABASE_URL || '';
const ALLOWED_HOSTS = /^(localhost|127\.0\.0\.1|db|sit-[a-z]+(\.[a-z0-9.-]+)?)$/;
const parts = /^postgres(?:ql)?:\/\/([^:@/]+):[^@]*@([^:/]+)/.exec(url);
if (!parts || parts[1] !== 'cb_app' || !ALLOWED_HOSTS.test(parts[2])) { console.error('REFUSED: needs DATABASE_URL as cb_app on localhost, the compose db or a SIT host'); process.exit(3); }
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'acc176b_test_secret_at_least_32_chars_padding';
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const API = path.join(__dirname, '..');

/* the sign-in stand-in goes in BEFORE the real modules that load middleware/auth: the person's row is read from the database as the real auth does (removed or deactivated: 401; the level and the reach come from the row) */
const authPath = require.resolve(path.join(API, 'middleware', 'auth.js'));
const { query, withEntity } = require(path.join(API, 'db'));
const fakeAuth = async (req, res, next) => {
  if (req.identity) return next(); /* the real auth re-enters on its DECIDED set and keeps the identity the front swapped in */
  let who;
  try { who = JSON.parse(String(req.headers['x-test-as'] || '')); } catch (_) { return res.status(401).json({ error: 'no test identity' }); }
  if (who.identity_type === 'actor' && /^[0-9a-f-]{36}$/i.test(String(who.identity_id))) {
    const row = (await query('SELECT break_status, access_level, whole_entity, can_see_costs FROM identities WHERE identity_id = $1', [who.identity_id])).rows[0];
    if (!row || ['removed', 'deactivated'].includes(row.break_status)) return res.status(401).json({ code: 'ACCESS_REVOKED' });
    Object.assign(who, { access_level: row.access_level, whole_entity: row.whole_entity === true, can_see_costs: row.can_see_costs === true });
  }
  req.identity = who;
  return next();
};
fakeAuth.entityOf = (req) => req.identity.parent_entity_id || req.identity.identity_id;
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: fakeAuth };

const net = require(path.join(API, 'src', 'services', 'network'));
const grants = require(path.join(API, 'lib', 'books-grant.js'));

let pass = 0, fail = 0;
const ok = (what, cond, info) => { if (cond) { pass++; console.log('  ok   ' + what); } else { fail++; console.log('  FAIL ' + what + (info ? '\n         ' + String(info).slice(0, 500) : '')); } };
const RUN = 'a176b' + (Date.now() % 1e10).toString(36);
const madeIdentities = [];
const code = (r) => r.body && r.body.code;
const newId = () => crypto.randomUUID();

/** a business: its identity and its network node */
async function business(tag, country, currency) {
  const bridgeId = 'CB' + RUN + tag;
  const { rows: [identity] } = await query(
    `INSERT INTO identities (bridge_id, display_name, identity_type, country, currency_code, user_id) VALUES ($1, $2, 'entity', $4, $5, $3) RETURNING identity_id, display_name`,
    [bridgeId, 'ACC176b ' + tag + ' ' + RUN, bridgeId.toLowerCase(), country || 'IN', currency || 'INR']);
  madeIdentities.push(identity.identity_id);
  return { tag, bridgeId, id: identity.identity_id, name: identity.display_name, node: await net.nodeOf(identity.identity_id, { ensure: true }) };
}
async function join(parent, member) {
  const asked = await net.requestConnect({ parentId: parent.node.id, childId: member.node.id }, parent.node);
  await net.approve({ edgeId: asked.id }, member.node);
}
const ownerOf = (biz) => ({ identity_id: biz.id, bridge_id: biz.bridgeId, identity_type: 'entity', parent_entity_id: null, display_name: biz.name });
/** a person of a business: a real identities row (the sign-in stand-in reads it every request) */
async function person(biz, tag, level, whole) {
  const { rows: [row] } = await query(
    `INSERT INTO identities (bridge_id, display_name, identity_type, parent_entity_id, country, currency_code, user_id, access_level, whole_entity, can_see_costs, hat) VALUES ($1, $2, 'actor', $3, 'IN', 'INR', $4, $5, $6, true, 'act') RETURNING identity_id, display_name`,
    [biz.bridgeId + tag, 'Person ' + tag + ' ' + RUN, biz.id, (biz.bridgeId + tag).toLowerCase(), level, whole]);
  madeIdentities.push(row.identity_id);
  return { identity_id: row.identity_id, identity_type: 'actor', parent_entity_id: biz.id, bridge_id: biz.bridgeId, display_name: row.display_name };
}

let base = '';
async function call(who, method, route, opts) {
  const o = opts || {};
  const headers = { 'content-type': 'application/json', 'x-test-as': JSON.stringify(who) };
  if (o.member) headers['x-books-for'] = o.member;
  if (o.role) headers['x-books-role'] = o.role;
  const res = await fetch(base + route, { method, headers, body: o.body === undefined ? undefined : JSON.stringify(o.body) });
  let body = null;
  try { body = await res.json(); } catch (_) { body = null; }
  return { status: res.status, body };
}
const grantBody = (P, extra) => Object.assign({ grantee: P.id, purpose: 'adviser of the books', consent: true }, extra);
const giveGrant = (P, M, extra) => call(ownerOf(M), 'POST', '/api/books-grants', { body: grantBody(P, extra) });
/** as the firm's person, under the adviser grant of `member` (the page's store is the member unless told otherwise) */
const firm = (who, member, method, route, body, extra) => call(who, method, '/api/books-actions' + route, Object.assign({ member: member.id, role: 'adviser', body: body === undefined ? undefined : Object.assign({ store_id: member.id }, body) }, extra));
const asOwner = (M, method, route, body) => call(ownerOf(M), method, '/api/books-actions' + route, { body: body === undefined ? undefined : Object.assign({ store_id: M.id }, body) });
const count = (M, sql, params) => withEntity(M.id, (h) => h.query(sql, params)).then((r) => r.rows[0].n);
const stepsOf = (M) => count(M, 'SELECT count(*)::int AS n FROM books_action_step WHERE store = $1', [M.id]);
const day = new Date().toISOString().slice(0, 10);

async function ledgerOn(M) {
  await withEntity(M.id, (h) => require(path.join(API, 'lib', 'country-setup.js')).save(h, M.id, { country: 'IN', currency: 'INR', fy_start_month: 4, tax: { registered: true, number: '33AAAAA0000A1Z9', scheme: 'regular' }, source: { tax: 'typed' } }, M.id));
  const on = await call(ownerOf(M), 'POST', '/api/books/enable', { body: {} });
  ok('the ledger of ' + M.tag + ' is switched on through the real gates', on.status === 200, JSON.stringify(on));
}

async function main() {
  const P = await business('p'); const M1 = await business('1'); const M2 = await business('2'); const S = await business('s');
  for (const M of [M1, M2]) await join(P, M);
  const A = await person(P, 'a', 'editor', true); const B = await person(P, 'b', 'editor', true); const C = await person(P, 'c', 'editor', false);
  const D = await person(P, 'd', 'editor', true); const U = await person(P, 'u', 'commenter', true); const Z = await person(S, 'z', 'editor', true);

  const app = express();
  app.use(express.json());
  app.use('/api/books', require(path.join(API, 'routes', 'books.js')));
  app.use('/api/books-grants', require(path.join(API, 'routes', 'books-grants.js')));
  app.use('/api/books-actions', require(path.join(API, 'routes', 'books-actions.js')));
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  base = 'http://127.0.0.1:' + server.address().port;
  try {
    await ledgerOn(M1); await ledgerOn(M2);
    const accounts = (await call(ownerOf(M1), 'GET', '/api/books/accounts')).body;
    const list = accounts.accounts || accounts.rows || accounts || [];
    const cash = (list.find((a) => /cash/i.test(a.name || '')) || {}).code || '1000';
    const sales = (list.find((a) => /^sales/i.test(a.name || '')) || {}).code || '4000';
    const journal = (tag, extra) => Object.assign({ kind: 'journal', client_ref: RUN + tag, body: { narration: 'acc176b ' + RUN + tag, date: day, lines: [{ code: cash, dr_minor: 10000 }, { code: sales, cr_minor: 10000 }] } }, extra);
    const posted = (M, tag) => count(M, "SELECT count(*)::int AS n FROM journal_entry WHERE entity_id = $1 AND narration LIKE '%' || $2", [M.id, RUN + tag]);

    /* grants: the auditor's first, then the adviser's (the owner is warned the firm holds both) */
    const auditorGrant = await giveGrant(P, M1);
    const adviserGrant = await giveGrant(P, M1, { preset: 'adviser' });
    ok('1a M1 gives P the AUDITOR grant, then the ADVISER grant: two separate grants, 201 each', auditorGrant.status === 201 && adviserGrant.status === 201 && auditorGrant.body.preset === 'auditor' && adviserGrant.body.preset === 'adviser', JSON.stringify([auditorGrant, adviserGrant]));
    ok('19 the second role to the same firm warns the owner, never blocks', Array.isArray(adviserGrant.body.warnings) && adviserGrant.body.warnings.some((w) => w.code === 'BOTH_ROLES_ONE_FIRM'), JSON.stringify(adviserGrant.body));
    const m2Grant = await giveGrant(P, M2, { preset: 'adviser' });
    ok('1b M2 gives P an adviser grant', m2Grant.status === 201, JSON.stringify(m2Grant));

    /* 1 prepare */
    const p1 = await firm(A, M1, 'POST', '', journal('j1'));
    ok('1 A prepares: 201 waiting_review, INR 10000, stamped with A, the firm and the maker role', p1.status === 201 && p1.body.state === 'waiting_review' && p1.body.total_minor === 10000 && p1.body.currency === 'INR' && p1.body.prepared.identity_id === A.identity_id && p1.body.prepared.firm === P.name && p1.body.prepared.role === 'maker', JSON.stringify(p1));
    ok('1 nothing is posted by preparing', (await posted(M1, 'j1')) === 0);
    const id1 = p1.body.action_id; const hash1 = p1.body.body_hash;

    /* 2, 3 */
    const self = await firm(A, M1, 'POST', '/' + id1 + '/review', { body_hash: hash1 });
    ok('2 A reviewing own entry: 403 ACTION_SELF_REVIEW', self.status === 403 && code(self) === 'ACTION_SELF_REVIEW', JSON.stringify(self));
    const early = await asOwner(M1, 'POST', '/' + id1 + '/accept', { body_hash: hash1, total_minor: 10000, currency: 'INR' });
    ok('3 the owner accepting an unreviewed action: 409 ACTION_NOT_REVIEWED, nothing posted', early.status === 409 && code(early) === 'ACTION_NOT_REVIEWED' && (await posted(M1, 'j1')) === 0, JSON.stringify(early));

    /* 5, 6, 7 who may */
    const outsider = await firm(Z, M1, 'GET', '');
    ok('5 a person outside the firm naming M1 is refused (no grant of his business)', outsider.status === 403 && code(outsider) === 'BOOKS_GRANT_NONE', JSON.stringify(outsider));
    const oneNode = await firm(C, M1, 'GET', '');
    ok('5 a person of the firm without whole-entity reach is refused', oneNode.status === 403 && code(oneNode) === 'BOOKS_GRANT_NOT_FOR_YOU', JSON.stringify(oneNode));
    const reviewerOnly = await firm(U, M1, 'GET', '');
    ok('5 an auditor-preset person cannot use the adviser role', reviewerOnly.status === 403 && code(reviewerOnly) === 'BOOKS_GRANT_NOT_FOR_YOU', JSON.stringify(reviewerOnly));
    const dWorks = await firm(D, M1, 'GET', '');
    await query("UPDATE identities SET break_status = 'removed' WHERE identity_id = $1", [D.identity_id]);
    const dGone = await firm(D, M1, 'GET', '');
    ok('6 a person removed from the firm: allowed before, 401 ACCESS_REVOKED at once after', dWorks.status === 200 && dGone.status === 401 && code(dGone) === 'ACCESS_REVOKED', JSON.stringify([dWorks.status, dGone]));
    const before = await stepsOf(M1);
    await query("UPDATE identities SET access_level = 'commenter' WHERE identity_id = $1", [B.identity_id]);
    const demoted = await firm(B, M1, 'POST', '', journal('jdemote'));
    await query("UPDATE identities SET access_level = 'editor' WHERE identity_id = $1", [B.identity_id]);
    ok('6 a person the firm demoted is refused at once, and nothing was stored', demoted.status === 403 && code(demoted) === 'BOOKS_GRANT_NOT_FOR_YOU' && (await stepsOf(M1)) === before, JSON.stringify(demoted));
    const asAuditor = await call(U, 'POST', '/api/books-actions', { member: M1.id, role: 'auditor', body: Object.assign({ store_id: M1.id }, journal('jaud')) });
    const asEditorAuditorRole = await call(A, 'POST', '/api/books-actions', { member: M1.id, role: 'auditor', body: Object.assign({ store_id: M1.id }, journal('jaud2')) });
    const noRole = await call(U, 'POST', '/api/books-actions', { member: M1.id, body: Object.assign({ store_id: M1.id }, journal('jnorole')) });
    ok('7 under the auditor role a write is refused read only, although the firm also holds an adviser grant', asAuditor.status === 403 && code(asAuditor) === 'GRANT_READ_ONLY' && noRole.status === 403 && code(noRole) === 'GRANT_READ_ONLY' && asEditorAuditorRole.status === 403, JSON.stringify([asAuditor, noRole, asEditorAuditorRole]));
    const directA = await call(A, 'POST', '/api/books/entries', { member: M1.id, role: 'adviser', body: { narration: 'direct ' + RUN, date: day, lines: [{ code: cash, dr_minor: 1 }, { code: sales, cr_minor: 1 }] } });
    const directU = await call(U, 'POST', '/api/books/entries', { member: M1.id, role: 'auditor', body: { narration: 'direct ' + RUN, date: day, lines: [{ code: cash, dr_minor: 1 }, { code: sales, cr_minor: 1 }] } });
    ok('7 the adviser has NO direct write on the books (not listed), the auditor role is read only', directA.status === 403 && code(directA) === 'GRANT_ROUTE_NOT_LISTED' && directU.status === 403 && code(directU) === 'GRANT_READ_ONLY' && (await posted(M1, '')) === 0, JSON.stringify([directA, directU]));
    const audRead = await call(U, 'GET', '/api/books/daybook', { member: M1.id });
    ok('7 the auditor grant still reads (no role header): 200', audRead.status === 200, JSON.stringify(audRead));
    const wrongRole = await call(U, 'POST', '/api/books-actions', { member: M1.id, role: 'adviser', body: Object.assign({ store_id: M1.id }, journal('juser')) });
    ok('7 an auditor-preset person naming the adviser role cannot prepare', wrongRole.status === 403 && code(wrongRole) === 'BOOKS_GRANT_NOT_FOR_YOU', JSON.stringify(wrongRole));
    const noOwner = await firm(A, M1, 'POST', '/' + id1 + '/accept', { body_hash: hash1, total_minor: 10000, currency: 'INR' });
    ok('7 a firm person cannot reach the owner\'s accept', noOwner.status === 403 && code(noOwner) === 'GRANT_ROUTE_NOT_LISTED', JSON.stringify(noOwner));

    /* 8 stale tab */
    const beforeStale = await stepsOf(M1);
    const stale = await call(A, 'POST', '/api/books-actions', { member: M1.id, role: 'adviser', body: Object.assign({ store_id: M2.id }, journal('jstale')) });
    ok('8 a stale tab of M2 on M1: 409 STORE_MISMATCH and nothing stored', stale.status === 409 && code(stale) === 'STORE_MISMATCH' && (await stepsOf(M1)) === beforeStale && (await stepsOf(M2)) === 0, JSON.stringify(stale));

    /* 4 review */
    const rev = await firm(B, M1, 'POST', '/' + id1 + '/review', { body_hash: hash1 });
    ok('4 B reviews: waiting_accept, stamped B, the firm and the checker role', rev.status === 200 && rev.body.state === 'waiting_accept' && rev.body.reviewed.identity_id === B.identity_id && rev.body.reviewed.role === 'checker' && rev.body.reviewed.firm === P.name, JSON.stringify(rev));
    const again = await firm(B, M1, 'POST', '/' + id1 + '/review', { body_hash: hash1 });
    ok('4 a second review of the same action: 409', again.status === 409, JSON.stringify(again));

    /* 9 return */
    const p2 = await firm(A, M1, 'POST', '', journal('j2'));
    const noReason = await firm(B, M1, 'POST', '/' + p2.body.action_id + '/return', { body_hash: p2.body.body_hash, reason: '' });
    const ownReturn = await firm(A, M1, 'POST', '/' + p2.body.action_id + '/return', { body_hash: p2.body.body_hash, reason: 'my own mistake' });
    const returned = await firm(B, M1, 'POST', '/' + p2.body.action_id + '/return', { body_hash: p2.body.body_hash, reason: 'wrong account' });
    const afterReturn = await firm(B, M1, 'POST', '/' + p2.body.action_id + '/review', { body_hash: p2.body.body_hash });
    ok('9 a return needs a reason (422), never by the preparer (403), and with it the round ends in the reason\'s words', noReason.status === 422 && code(noReason) === 'ACTION_REASON_NEEDED' && ownReturn.status === 403 && returned.status === 200 && returned.body.state === 'returned' && returned.body.closed.reason === 'wrong account', JSON.stringify([noReason.status, ownReturn.status, returned]));
    ok('9 a returned action cannot be reviewed any more (409) and nothing is posted', afterReturn.status === 409 && code(afterReturn) === 'ACTION_CLOSED' && (await posted(M1, 'j2')) === 0, JSON.stringify(afterReturn));

    /* 11 wrong totals, wrong hash */
    const wrongTotal = await asOwner(M1, 'POST', '/' + id1 + '/accept', { body_hash: hash1, total_minor: 9999, currency: 'INR' });
    const wrongHash = await asOwner(M1, 'POST', '/' + id1 + '/accept', { body_hash: 'nothash', total_minor: 10000, currency: 'INR' });
    const wrongCur = await asOwner(M1, 'POST', '/' + id1 + '/accept', { body_hash: hash1, total_minor: 10000, currency: 'AUD' });
    ok('11 a carried total that differs: 409 PREVIEW_TOTAL_DIFFERS naming both, nothing posted; so a carried currency', wrongTotal.status === 409 && code(wrongTotal) === 'PREVIEW_TOTAL_DIFFERS' && wrongCur.status === 409 && code(wrongCur) === 'PREVIEW_TOTAL_DIFFERS' && (await posted(M1, 'j1')) === 0, JSON.stringify([wrongTotal, wrongCur]));
    ok('11 a body hash that is not the one reviewed: 409 ACTION_BODY_CHANGED', wrongHash.status === 409 && code(wrongHash) === 'ACTION_BODY_CHANGED', JSON.stringify(wrongHash));

    /* 10 accept */
    const accepted = await asOwner(M1, 'POST', '/' + id1 + '/accept', { body_hash: hash1, total_minor: 10000, currency: 'INR' });
    ok('10 the owner accepts the reviewed action: 200, one entry', accepted.status === 200 && accepted.body.action.state === 'accepted' && accepted.body.entry && accepted.body.entry.entry_id, JSON.stringify(accepted));
    const entry = (await withEntity(M1.id, (h) => h.query('SELECT created_by, grant_id, source_ref, total_minor, currency FROM journal_entry WHERE entity_id = $1 AND entry_id = $2', [M1.id, accepted.body.entry && accepted.body.entry.entry_id]))).rows[0] || {};
    ok('10 the entry is created_by A (the preparer), carries the adviser grant, links back by source_ref, INR 10000', entry.created_by === A.identity_id && entry.grant_id === adviserGrant.body.grant_id && entry.source_ref === 'action:' + id1 && Number(entry.total_minor) === 10000 && entry.currency === 'INR', JSON.stringify(entry));
    const second = await asOwner(M1, 'POST', '/' + id1 + '/accept', { body_hash: hash1, total_minor: 10000, currency: 'INR' });
    ok('10 a second accept posts nothing: 409, still one entry', second.status === 409 && (await posted(M1, 'j1')) === 1, JSON.stringify(second));
    const trail = (await asOwner(M1, 'GET', '/' + id1)).body;
    ok('10 the action reads A prepared, B reviewed, the owner accepted, each with person, firm, role', trail && trail.steps && trail.steps.map((s) => s.step + ':' + s.role).join() === 'prepared:maker,reviewed:checker,accepted:owner' && trail.steps[0].name === A.display_name && trail.steps[1].name === B.display_name && trail.steps[0].firm === P.name, JSON.stringify(trail));

    /* 12 two people, each stamped (the other way round) */
    const p3 = await firm(B, M1, 'POST', '', journal('j3'));
    const r3 = await firm(A, M1, 'POST', '/' + p3.body.action_id + '/review', { body_hash: p3.body.body_hash });
    ok('12 B prepares and A reviews: each is stamped on this action as on the other', p3.body.prepared.identity_id === B.identity_id && r3.status === 200 && r3.body.reviewed.identity_id === A.identity_id && r3.body.reviewed.name === A.display_name, JSON.stringify([p3.status, r3]));

    /* 16, 17, 18 */
    const dupOpen = await firm(A, M1, 'POST', '', journal('j3'));
    const dupPosted = await firm(A, M1, 'POST', '', journal('j1'));
    ok('16 the same client_ref while one is open: 409 ACTION_REF_OPEN; once posted: 409 ACTION_REF_POSTED', dupOpen.status === 409 && code(dupOpen) === 'ACTION_REF_OPEN' && dupPosted.status === 409 && code(dupPosted) === 'ACTION_REF_POSTED', JSON.stringify([dupOpen, dupPosted]));
    const usd = await firm(A, M1, 'POST', '', journal('jusd', { body: { narration: 'usd', date: day, currency: 'USD', lines: [{ code: cash, dr_minor: 100 }, { code: sales, cr_minor: 100 }] } }));
    const usdLines = await firm(A, M1, 'POST', '', journal('jusd2', { body: { narration: 'usd', date: day, lines: [{ code: cash, dr_minor: 100, currency: 'USD' }, { code: sales, cr_minor: 100, currency: 'USD' }] } }));
    ok('17 a foreign currency, named or on a line, is refused and nothing is stored', usd.status === 422 && code(usd) === 'CURRENCY_NOT_THE_LEDGERS' && usdLines.status >= 400 && usdLines.status < 500, JSON.stringify([usd, usdLines]));
    const m2Entry = await call(ownerOf(M2), 'POST', '/api/books/entries', { body: { narration: 'm2 ' + RUN, date: day, lines: [{ code: cash, dr_minor: 500 }, { code: sales, cr_minor: 500 }], client_ref: RUN + 'm2' } });
    const foreign = await firm(A, M1, 'POST', '', { kind: 'reverse', body: { entry_id: m2Entry.body.entry_id, reason: 'not mine' } });
    ok('18 an entry of another store: 404 and nothing stored', m2Entry.status === 200 && foreign.status === 404, JSON.stringify([m2Entry.status, foreign]));

    /* 14 isolation M1, M2, M1 */
    const q1 = await firm(A, M1, 'GET', '?state=all');
    const pm2 = await firm(A, M2, 'POST', '', journal('j1')); /* the same client_ref in another store is its own */
    const q2 = await firm(A, M2, 'GET', '?state=all');
    const q3 = await firm(A, M1, 'GET', '?state=all');
    ok('14 M1, M2, M1: each queue is its own store only; one client_ref may live in both', pm2.status === 201 && q1.body.actions.every((a) => a.store === M1.id) && q2.body.actions.length === 1 && q2.body.actions[0].store === M2.id && q3.body.total === q1.body.total, JSON.stringify([q1.body.total, q2.body.total, q3.body.total, pm2.status]));
    const mine = await firm(A, M1, 'GET', '?state=all&mine=true');
    ok('14 "mine" keeps what the caller prepared, and the list is paginated (total, page, limit)', mine.status === 200 && mine.body.actions.every((a) => a.prepared.identity_id === A.identity_id) && typeof mine.body.total === 'number' && mine.body.page === 1 && mine.body.limit === 25, JSON.stringify(mine.body));

    /* 20 a lock goes through the existing writer */
    const periods = (await call(ownerOf(M1), 'GET', '/api/books/periods')).body;
    const rows = periods.periods || periods.rows || periods || [];
    const open = (Array.isArray(rows) ? rows : []).find((r) => r.status === 'open' && Number(r.period) >= 1);
    if (open) {
      const fy = open.fiscal_year || periods.fiscal_year; const lockBody = { kind: 'lock', body: { fy, period: Number(open.period) } };
      const lp = await firm(A, M1, 'POST', '', lockBody);
      const lr = await firm(B, M1, 'POST', '/' + lp.body.action_id + '/review', { body_hash: lp.body.body_hash });
      const la = await asOwner(M1, 'POST', '/' + lp.body.action_id + '/accept', { body_hash: lp.body.body_hash });
      const after = (await call(ownerOf(M1), 'GET', '/api/books/periods')).body;
      const nowRow = ((after.periods || after.rows || after) || []).find((r) => Number(r.period) === Number(open.period));
      ok('20 a lock: prepared, reviewed, accepted by the owner, then the month is soft locked through the existing writer', lp.status === 201 && lr.status === 200 && la.status === 200 && nowRow && /locked/.test(nowRow.status), JSON.stringify([lp.status, lr.status, la, nowRow]));
    } else ok('20 (skipped: no open month in the periods answer)', true);

    /* 15 the owner's log */
    const looks = await grants.looks(M1.id, { limit: 200 });
    const advLooks = looks.filter((x) => x.preset === 'adviser' && x.actor_identity_id === A.identity_id);
    ok('15 the owner\'s log reads the person\'s name, the firm\'s name and the role of each look', advLooks.length > 0 && advLooks.every((x) => x.actor_name === A.display_name && x.actor_entity_name === P.name) && looks.some((x) => x.preset === 'auditor'), JSON.stringify(advLooks.slice(0, 1)));
    const viaRoute = await call(ownerOf(M1), 'GET', '/api/books-grants/log');
    ok('15 the same through the member\'s log route', viaRoute.status === 200 && viaRoute.body.looks.some((x) => x.preset === 'adviser' && x.actor_name === A.display_name && x.actor_entity_name === P.name), JSON.stringify(viaRoute.body.looks && viaRoute.body.looks[0]));

    /* 13 revoke: the open action is withdrawn; the auditor grant is its own */
    const open3 = r3.body.action_id;
    const revoked = await call(ownerOf(M1), 'POST', '/api/books-grants/' + adviserGrant.body.grant_id + '/revoke', { body: {} });
    const withdrawn = await asOwner(M1, 'GET', '/' + open3);
    const prepareAfter = await firm(A, M1, 'POST', '', journal('jafter'));
    const acceptAfter = await asOwner(M1, 'POST', '/' + open3 + '/accept', { body_hash: r3.body.body_hash, total_minor: 10000, currency: 'INR' });
    const auditorStill = await call(U, 'GET', '/api/books/daybook', { member: M1.id });
    ok('13 revoke closes the open action "withdrawn: grant revoked", in the same transaction', revoked.status === 200 && revoked.body.actions_withdrawn >= 1 && withdrawn.body.state === 'withdrawn' && withdrawn.body.closed.reason === 'withdrawn: grant revoked', JSON.stringify([revoked.status, withdrawn.body]));
    ok('13 after the revoke nobody of the firm can prepare (403 ended), the owner cannot accept the withdrawn action, nothing is posted', prepareAfter.status === 403 && code(prepareAfter) === 'BOOKS_GRANT_ENDED' && acceptAfter.status === 409 && (await posted(M1, 'j3')) === 0, JSON.stringify([prepareAfter, acceptAfter]));
    ok('13 the auditor grant is its own: still reads after the adviser grant was revoked', auditorStill.status === 200, JSON.stringify(auditorStill));

    /* 21 a log row that cannot be written */
    const badLog = Object.assign({}, A, { identity_id: 'not-a-uuid', access_level: 'editor', whole_entity: true });
    const stepsBefore = await stepsOf(M2);
    const failClosed = await call(badLog, 'POST', '/api/books-actions', { member: M2.id, role: 'adviser', body: Object.assign({ store_id: M2.id }, journal('jlog')) });
    ok('21 the look cannot be logged: 503 and nothing stored', failClosed.status === 503 && (await stepsOf(M2)) === stepsBefore, JSON.stringify(failClosed));
  } finally {
    server.close();
  }
}

async function cleanup() {
  const nodes = (await query(`SELECT e.id FROM cb_entity e JOIN identities i ON upper(i.bridge_id) = upper(e.bridge_id) WHERE i.identity_id = ANY($1::uuid[])`, [madeIdentities])).rows.map((x) => x.id);
  await query(`DELETE FROM cb_edge WHERE parent_id = ANY($1::uuid[]) OR child_id = ANY($1::uuid[])`, [nodes]);
  await query(`DELETE FROM cb_entity WHERE id = ANY($1::uuid[])`, [nodes]);
  await query(`DELETE FROM identities WHERE identity_id = ANY($1::uuid[])`, [madeIdentities]);
}
(async () => {
  console.log('\n── ACC-176b adviser maker-checker on real Postgres (cb_app, RLS on) · run ' + RUN + ' ──');
  try { await main(); } catch (e) { ok('the run reached its end', false, e && e.stack); } finally { await cleanup().catch((e) => console.log('  note  the throwaway businesses stay (insert-only rows keep them): ' + (e && e.code))); }
  console.log('\n' + pass + ' ok, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
void newId;
