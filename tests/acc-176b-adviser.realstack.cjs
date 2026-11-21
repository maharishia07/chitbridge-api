'use strict';
const { shopToday, shopDayAt } = require('./lib/shop-day.cjs'); /* the shop's own day, never the UTC day (tzsweep) */
/**
 * tests/acc-176b-adviser.realstack.cjs — ACC-176b (an adviser FIRM acting for a store's owner: prepare, review, accept) on a REAL Postgres, as the role the api runs as (cb_app, RLS on), through the REAL routers
 * (routes/books-actions.js, routes/books-grants.js, routes/books.js) and the real grant front (middleware/books-grant.js). Only the sign-in is a stand-in: a header names who calls, and the person's row is read from the
 * identities table on every request as middleware/auth does (a removed person is refused, a demoted person has the demoted level). Migrations b863, b866 and b867 are built by the fresh-db step.
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
const RUN = 'a176b' + (Date.now() % 1e10).toString(36).padStart(6, '0');
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
  return asked.id;
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
  if (/\/accept$/.test(route)) headers['idempotency-key'] = 'acc176b-' + Math.random().toString(36).slice(2) + Date.now(); /* S36: each accept is its own attempt */
  const res = await fetch(base + route, { method, headers, body: o.body === undefined ? undefined : JSON.stringify(o.body) });
  let body = null;
  try { body = await res.json(); } catch (_) { body = null; }
  return { status: res.status, body };
}
const grantBody = (P, extra) => Object.assign({ grantee: P.id, purpose: 'adviser of the books', consent: true }, extra && extra.preset === 'adviser' ? { posting: 'owner_approves' } : {}, extra);
const giveGrant = (P, M, extra) => call(ownerOf(M), 'POST', '/api/books-grants', { body: grantBody(P, extra) });
/** as the firm's person, under the adviser grant of `member` (the page's store is the member unless told otherwise) */
const firm = (who, member, method, route, body, extra) => call(who, method, '/api/books-actions' + route, Object.assign({ member: member.id, role: 'adviser', body: body === undefined ? undefined : Object.assign({ store_id: member.id }, body) }, extra));
const asOwner = (M, method, route, body) => call(ownerOf(M), method, '/api/books-actions' + route, { body: body === undefined ? undefined : Object.assign({ store_id: M.id }, body) });
const count = (M, sql, params) => withEntity(M.id, (h) => h.query(sql, params)).then((r) => r.rows[0].n);
const stepsOf = (M) => count(M, 'SELECT count(*)::int AS n FROM books_action_step WHERE store = $1', [M.id]);
const day = shopToday();

async function ledgerOn(M) {
  await withEntity(M.id, (h) => require(path.join(API, 'lib', 'country-setup.js')).save(h, M.id, { country: 'IN', currency: 'INR', fy_start_month: 4, tax: { registered: true, number: '33AAAAA0000A1Z9', scheme: 'regular' }, source: { tax: 'typed' } }, M.id));
  const on = await call(ownerOf(M), 'POST', '/api/books/enable', { body: {} });
  ok('the ledger of ' + M.tag + ' is switched on through the real gates', on.status === 200, JSON.stringify(on));
}

async function main() {
  const P = await business('p'); const P2 = await business('q'); const M1 = await business('1'); const M2 = await business('2'); const M3 = await business('3'); const M4 = await business('4'); const S = await business('s');
  for (const M of [M1, M2, M4]) await join(P, M);
  const edge3 = await join(P, M3);
  await join(P2, P); /* a second firm: the NETWORK ANCESTOR of P, so it too is a parent of every store under P */
  const A = await person(P, 'a', 'editor', true); const B = await person(P, 'b', 'editor', true); const C = await person(P, 'c', 'editor', false);
  const D = await person(P, 'd', 'editor', true); const U = await person(P, 'u', 'commenter', true); const Z = await person(S, 'z', 'editor', true);
  const Z2 = await person(P2, 'z', 'editor', true); const Y2 = await person(P2, 'y', 'editor', true); const X2 = await person(P2, 'x', 'editor', true);

  const app = express();
  app.use(express.json());
  app.use('/api/books', require(path.join(API, 'routes', 'books.js')));
  app.use('/api/books-grants', require(path.join(API, 'routes', 'books-grants.js')));
  app.use('/api/books-actions', require(path.join(API, 'routes', 'books-actions.js')));
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  base = 'http://127.0.0.1:' + server.address().port;
  try {
    await ledgerOn(M1); await ledgerOn(M2); await ledgerOn(M3); await ledgerOn(M4);
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
    const p1s = await firm(A, M1, 'POST', '', journal('j1self')); /* RC-10 (19 Nov): review is not enforced; each case on its own action, so id1 keeps its colleague's review */ const self = await firm(A, M1, 'POST', '/' + p1s.body.action_id + '/review', { body_hash: p1s.body.body_hash });
    ok('2 A reviewing own entry: 200, recorded self_reviewed (RC-10)', self.status === 200 && self.body.review === 'self_reviewed' && self.body.reviewed.reason === 'self_reviewed', JSON.stringify(self));
    const p1u = await firm(A, M1, 'POST', '', journal('j1unrev')); const early = await asOwner(M1, 'POST', '/' + p1u.body.action_id + '/accept', { body_hash: p1u.body.body_hash, total_minor: 10000, currency: 'INR' });
    ok('3 the owner accepting an unreviewed action: 200, posted once, the record says not_reviewed (RC-9)', early.status === 200 && early.body.action.review === 'not_reviewed' && early.body.action.closed.reason === 'accepted without a review' && (await posted(M1, 'j1unrev')) === 1, JSON.stringify(early));

    /* 5, 6, 7 who may */
    const outsider = await firm(Z, M1, 'GET', '');
    ok('5 a person outside the firm naming M1 is refused (no grant of his business)', outsider.status === 403 && code(outsider) === 'BOOKS_GRANT_NONE', JSON.stringify(outsider));
    const oneNode = await firm(C, M1, 'GET', '');
    ok('5 a person of the firm without whole-entity reach is refused', oneNode.status === 403 && code(oneNode) === 'BOOKS_GRANT_NOT_FOR_YOU', JSON.stringify(oneNode));
    const reviewerOnly = await firm(U, M1, 'GET', '');
    ok('5 GRANT-SEAT (20 Nov): an auditor-preset person (reviewer seat) reads under the adviser grant: the grant is the ceiling, the seat narrows (no write, below)', reviewerOnly.status === 200, JSON.stringify(reviewerOnly));
    const dWorks = await firm(D, M1, 'GET', '');
    await query("UPDATE identities SET break_status = 'removed' WHERE identity_id = $1", [D.identity_id]);
    const dGone = await firm(D, M1, 'GET', '');
    ok('6 a person removed from the firm: allowed before, 401 ACCESS_REVOKED at once after', dWorks.status === 200 && dGone.status === 401 && code(dGone) === 'ACCESS_REVOKED', JSON.stringify([dWorks.status, dGone]));
    const before = await stepsOf(M1);
    await query("UPDATE identities SET access_level = 'commenter' WHERE identity_id = $1", [B.identity_id]);
    const demoted = await firm(B, M1, 'GET', ''); /* GRANT-SEAT (20 Nov): the demoted person (commenter) still READS under the adviser grant; the write is refused COMMENT_ONLY by the hat gate, which this stand-in sign-in does not run: tests/grant-seat.realstack.cjs A3 proves it on the real sign-in */
    await query("UPDATE identities SET access_level = 'editor' WHERE identity_id = $1", [B.identity_id]);
    ok('6 a person the firm demoted reads at once as a commenter, and nothing was stored', demoted.status === 200 && (await stepsOf(M1)) === before, JSON.stringify(demoted));
    const asAuditor = await call(U, 'POST', '/api/books-actions', { member: M1.id, role: 'auditor', body: Object.assign({ store_id: M1.id }, journal('jaud')) });
    const asEditorAuditorRole = await call(A, 'POST', '/api/books-actions', { member: M1.id, role: 'auditor', body: Object.assign({ store_id: M1.id }, journal('jaud2')) });
    const noRole = await call(U, 'POST', '/api/books-actions', { member: M1.id, body: Object.assign({ store_id: M1.id }, journal('jnorole')) });
    ok('7 under the auditor role a write is refused read only, although the firm also holds an adviser grant', asAuditor.status === 403 && code(asAuditor) === 'GRANT_READ_ONLY' && asEditorAuditorRole.status === 403 /* no header is the live grant now (the adviser's): see tests/grant-seat.realstack.cjs */, JSON.stringify([asAuditor, noRole, asEditorAuditorRole]));
    const directA = await call(A, 'POST', '/api/books/entries', { member: M1.id, role: 'adviser', body: { narration: 'direct ' + RUN, date: day, lines: [{ code: cash, dr_minor: 1 }, { code: sales, cr_minor: 1 }] } });
    const directU = await call(U, 'POST', '/api/books/entries', { member: M1.id, role: 'auditor', body: { narration: 'direct ' + RUN, date: day, lines: [{ code: cash, dr_minor: 1 }, { code: sales, cr_minor: 1 }] } });
    ok('7 the adviser has NO direct write on the books (not listed), the auditor role is read only', directA.status === 403 && code(directA) === 'GRANT_ROUTE_NOT_LISTED' && directU.status === 403 && code(directU) === 'GRANT_READ_ONLY' && (await posted(M1, '')) === 0, JSON.stringify([directA, directU]));
    const audRead = await call(U, 'GET', '/api/books/daybook', { member: M1.id });
    ok('7 the auditor grant still reads (no role header): 200', audRead.status === 200, JSON.stringify(audRead));
    const wrongRole = await call(U, 'GET', '/api/books-actions', { member: M1.id, role: 'adviser' }); /* the write refusal (COMMENT_ONLY) is the hat gate's: grant-seat.realstack.cjs A3 */
    ok('7 an auditor-preset person (reviewer seat) naming the adviser role reads the queue (review), never prepares (hat gate)', wrongRole.status === 200, JSON.stringify(wrongRole));
    const noOwner = await firm(A, M1, 'POST', '/' + id1 + '/accept', { body_hash: hash1, total_minor: 10000, currency: 'INR' });
    ok('7 a firm person cannot reach the owner\'s accept', noOwner.status === 403 && code(noOwner) === 'GRANT_ROUTE_NOT_LISTED', JSON.stringify(noOwner));

    /* the owner's reads the adviser also makes (the auditor's held-back list is unchanged) */
    const asAdviser = (route) => call(A, 'GET', '/api/books' + route, { member: M1.id, role: 'adviser' });
    const reads = {};
    for (const route of ['/events', '/status', '/todo', '/recurring', '/assets', '/packs']) reads[route] = (await asAdviser(route)).status;
    const evAuditor = await call(U, 'GET', '/api/books/events', { member: M1.id, role: 'auditor' });
    const stAuditor = await call(U, 'GET', '/api/books/status', { member: M1.id, role: 'auditor' });
    const postEvents = await call(A, 'POST', '/api/books/events', { member: M1.id, role: 'adviser', body: { kind: 'sale' } });
    const partyRead = await asAdviser('/party/' + newId() + '/statement');
    const railRead = await asAdviser('/bank/rail');
    ok('the adviser reads what the owner reads on the books screen (/events /status /todo /recurring /assets /packs: 200 each), read only', Object.values(reads).every((status) => status === 200), JSON.stringify(reads));
    ok('the AUDITOR still cannot read them (403 GRANT_ROUTE_NOT_LISTED), and a party statement is a door the adviser passes since PAST-YEARS (an unknown party then answers 404, not 403; the bank rail is the own read of the Bank page, open to the adviser since l16 adviser-bank)', evAuditor.status === 403 && code(evAuditor) === 'GRANT_ROUTE_NOT_LISTED' && stAuditor.status === 403 && code(stAuditor) === 'GRANT_ROUTE_NOT_LISTED' && partyRead.status === 404 && railRead.status === 200 /* l16 adviser-bank: the bank page's own read is open to a live adviser grant (tests/adviser-bank.realstack.cjs) */, JSON.stringify([evAuditor.status, stAuditor.status, partyRead.status, railRead.status]));
    ok('the adviser\'s direct POST /events is still refused (not listed): writes go only through /api/books-actions', postEvents.status === 403 && code(postEvents) === 'GRANT_ROUTE_NOT_LISTED', JSON.stringify(postEvents));

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
    const foreign = await firm(A, M1, 'POST', '', { kind: 'reverse', client_ref: RUN + 'jforeign', body: { entry_id: m2Entry.body.entry_id, reason: 'not mine' } });
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
      const fy = open.fiscal_year || periods.fiscal_year; const lockBody = { kind: 'lock', client_ref: RUN + 'jlock0', body: { fy, period: Number(open.period) } };
      const lp = await firm(A, M1, 'POST', '', lockBody);
      const lr = await firm(B, M1, 'POST', '/' + lp.body.action_id + '/review', { body_hash: lp.body.body_hash });
      const la = await asOwner(M1, 'POST', '/' + lp.body.action_id + '/accept', { body_hash: lp.body.body_hash });
      const after = (await call(ownerOf(M1), 'GET', '/api/books/periods')).body;
      const nowRow = ((after.periods || after.rows || after) || []).find((r) => Number(r.period) === Number(open.period));
      ok('20 a lock: prepared, reviewed, accepted by the owner, then the month is soft locked through the existing writer', lp.status === 201 && lr.status === 200 && la.status === 200 && nowRow && /locked/.test(nowRow.status), JSON.stringify([lp.status, lr.status, la, nowRow]));
    } else ok('20 an open month was found in the periods answer (a test that cannot find one fails, never skips)', false, JSON.stringify(periods).slice(0, 300));

    /* 15 the owner's log */
    const looks = await grants.looks(M1.id, { limit: 200 });
    const advLooks = looks.filter((x) => x.preset === 'adviser' && x.actor_identity_id === A.identity_id);
    ok('15 the owner\'s log reads the person\'s name, the firm\'s name and the role of each look', advLooks.length > 0 && advLooks.every((x) => x.actor_name === A.display_name && x.actor_entity_name === P.name) && looks.some((x) => x.preset === 'auditor'), JSON.stringify(advLooks.slice(0, 1)));
    const viaRoute = await call(ownerOf(M1), 'GET', '/api/books-grants/log');
    ok('15 the same through the member\'s log route', viaRoute.status === 200 && viaRoute.body.looks.some((x) => x.preset === 'adviser' && x.actor_name === A.display_name && x.actor_entity_name === P.name), JSON.stringify(viaRoute.body.looks && viaRoute.body.looks[0]));

    /* ── the fix round, part 1: F1 two firms on one store, F7 named people, F3 date, F4 reference, F6 reverse, F10 totals, STORE_MISMATCH on every POST, the database itself ── */
    const g2 = await giveGrant(P2, M1, { preset: 'adviser' });
    ok('F1 a second firm (the store\'s network ancestor) is given its OWN adviser grant on M1', g2.status === 201 && g2.body.grant_id !== adviserGrant.body.grant_id, JSON.stringify(g2));
    const seesA = await call(A, 'GET', '/api/books-grants');
    const seesZ2 = await call(Z2, 'GET', '/api/books-grants');
    const seesStranger = await call(Z, 'GET', '/api/books-grants');
    const seesOneNode = await call(C, 'GET', '/api/books-grants');
    ok('the grants a firm works under: a team member of P reads its `received` (its own firm\'s grants, none given), another firm sees only its own, a stranger business sees none, a person who may use no grant is refused (403)',
      seesA.status === 200 && seesA.body.given.length === 0 && seesA.body.received.length >= 3 && seesA.body.received.every((g) => g.grantee_entity === P.id) && seesA.body.received.some((g) => g.preset === 'adviser') && seesA.body.received.some((g) => g.preset === 'auditor')
        && seesZ2.status === 200 && seesZ2.body.received.length >= 1 && seesZ2.body.received.every((g) => g.grantee_entity === P2.id) && !seesZ2.body.received.some((g) => g.grantee_entity === P.id)
        && seesStranger.status === 200 && seesStranger.body.received.length === 0 && seesStranger.body.given.length === 0 && seesOneNode.status === 403, JSON.stringify([seesA.status, seesA.body.received && seesA.body.received.length, seesZ2.body, seesStranger.body, seesOneNode.status]));
    const f1 = await firm(A, M1, 'POST', '', journal('jf1'));
    const z2Review = await firm(Z2, M1, 'POST', '/' + f1.body.action_id + '/review', { body_hash: f1.body.body_hash });
    const z2Return = await firm(Z2, M1, 'POST', '/' + f1.body.action_id + '/return', { body_hash: f1.body.body_hash, reason: 'not your firm' });
    const z2Get = await firm(Z2, M1, 'GET', '/' + f1.body.action_id);
    const z2List = await firm(Z2, M1, 'GET', '?state=all');
    ok('F1 a person of ANOTHER firm cannot review, return or even read the first firm\'s action: 404 for each, and its queue holds none of it', z2Review.status === 404 && z2Return.status === 404 && z2Get.status === 404 && z2List.status === 200 && z2List.body.actions.every((a) => a.grant_id === g2.body.grant_id), JSON.stringify([z2Review.status, z2Return.status, z2Get.status, z2List.body]));
    const f1b = await firm(Y2, M1, 'POST', '', journal('jf1b'));
    const aOnY2 = await firm(A, M1, 'POST', '/' + f1b.body.action_id + '/review', { body_hash: f1b.body.body_hash });
    const z2Ok = await firm(Z2, M1, 'POST', '/' + f1b.body.action_id + '/review', { body_hash: f1b.body.body_hash });
    ok('F1 inside the second firm the review works (stamped with ITS firm), and the first firm cannot review it', aOnY2.status === 404 && z2Ok.status === 200 && z2Ok.body.reviewed.firm === P2.name && z2Ok.body.prepared.firm === P2.name, JSON.stringify([aOnY2.status, z2Ok]));
    const ownerSeesBoth = await asOwner(M1, 'GET', '?state=all&limit=100');
    ok('F1 the owner sees the actions of both firms', ownerSeesBoth.status === 200 && ownerSeesBoth.body.actions.some((a) => a.grant_id === g2.body.grant_id) && ownerSeesBoth.body.actions.some((a) => a.grant_id === adviserGrant.body.grant_id), JSON.stringify(ownerSeesBoth.body.total));
    const f1Accept = await asOwner(M1, 'POST', '/' + f1b.body.action_id + '/accept', { body_hash: f1b.body.body_hash, total_minor: 10000, currency: 'INR' });
    const f1Entry = (await withEntity(M1.id, (h) => h.query('SELECT created_by, grant_id FROM journal_entry WHERE entity_id = $1 AND entry_id = $2', [M1.id, f1Accept.body.entry && f1Accept.body.entry.entry_id]))).rows[0] || {};
    ok('F1 the second firm\'s entry carries ITS grant and its preparer', f1Accept.status === 200 && f1Entry.grant_id === g2.body.grant_id && f1Entry.created_by === Y2.identity_id, JSON.stringify([f1Accept.status, f1Entry]));

    const f7 = await firm(A, M1, 'POST', '', journal('jf7'));
    const f7Owner = await firm(ownerOf(P), M1, 'POST', '', journal('jf7b'));
    const f7Review = await firm(ownerOf(P), M1, 'POST', '/' + f7.body.action_id + '/review', { body_hash: f7.body.body_hash });
    const f7Return = await firm(ownerOf(P), M1, 'POST', '/' + f7.body.action_id + '/return', { body_hash: f7.body.body_hash, reason: 'owner sign-in' });
    const f7Named = await firm(A, M1, 'POST', '/' + f7Owner.body.action_id + '/review', { body_hash: f7Owner.body.body_hash });
    ok('F7 the firm\'s own sign-in is not a named person: it can prepare (201), never review or return (403 ACTION_REVIEWER_NOT_NAMED); a named person reviews its work', f7Owner.status === 201 && f7Review.status === 403 && code(f7Review) === 'ACTION_REVIEWER_NOT_NAMED' && f7Return.status === 403 && f7Named.status === 200, JSON.stringify([f7Owner.status, f7Review, f7Return.status, f7Named.status]));

    /* F7 across identities: one HUMAN with two identities cannot review his own work (red before the fix: the identity ids differ, so the old check let it through) */
    const H1 = await person(P, 'h1', 'editor', true); const H2 = await person(P, 'h2', 'editor', true); const H3 = await person(P, 'h3', 'editor', true);
    const H4 = await person(P, 'h4', 'editor', true); const H5 = await person(P, 'h5', 'editor', true);
    const sameMail = 'same-' + RUN + '@example.test';
    await query('UPDATE identities SET email = $2 WHERE identity_id = $1', [H1.identity_id, sameMail]);
    await query('UPDATE identities SET email = upper($2) WHERE identity_id = $1', [H2.identity_id, sameMail]);
    await query('UPDATE identities SET email = $2 WHERE identity_id = $1', [P.id, 'owner-' + RUN + '@example.test']);
    await query('UPDATE identities SET email = $2 WHERE identity_id = $1', [H3.identity_id, 'Owner-' + RUN + '@example.test']);
    await query('UPDATE identities SET phone = $2 WHERE identity_id = $1', [H4.identity_id, '+91' + String(Date.now()).slice(-9)]);
    await query('UPDATE identities SET phone = (SELECT phone FROM identities WHERE identity_id = $1) WHERE identity_id = $2', [H4.identity_id, H5.identity_id]);
    const hm = await firm(H1, M1, 'POST', '', journal('jhuman'));
    const hmSame = await firm(H2, M1, 'POST', '/' + hm.body.action_id + '/review', { body_hash: hm.body.body_hash });
    const hmReturn = await firm(H2, M1, 'POST', '/' + hm.body.action_id + '/return', { body_hash: hm.body.body_hash, reason: 'my other login' });
    const hmOther = await firm(B, M1, 'POST', '/' + hm.body.action_id + '/review', { body_hash: hm.body.body_hash });
    ok('F7 two identities with the same e-mail (any case) are ONE human: the review is allowed and recorded self_reviewed (RC-10), a RETURN is still refused (403 ACTION_SELF_REVIEW), and a colleague finds it already reviewed (409)', hm.status === 201 && hmSame.status === 200 && hmSame.body.review === 'self_reviewed' && hmReturn.status === 403 && hmOther.status === 409, JSON.stringify([hm.status, hmSame.status, code(hmSame), hmReturn.status, hmOther.status]));
    const hmOwner = await firm(ownerOf(P), M1, 'POST', '', journal('jhuman2'));
    const hmOwnerSame = await firm(H3, M1, 'POST', '/' + hmOwner.body.action_id + '/review', { body_hash: hmOwner.body.body_hash });
    ok('F7 the firm\'s owner sign-in and a staff login with the same e-mail are one human: the staff login reviews what the owner sign-in prepared as a SELF review (RC-10)', hmOwner.status === 201 && hmOwnerSame.status === 200 && hmOwnerSame.body.review === 'self_reviewed', JSON.stringify([hmOwner.status, hmOwnerSame.status, code(hmOwnerSame)]));
    const hp = await firm(H4, M1, 'POST', '', journal('jhuman3'));
    const hpSame = await firm(H5, M1, 'POST', '/' + hp.body.action_id + '/review', { body_hash: hp.body.body_hash });
    ok('F7 the same phone on two identities is one human too', hp.status === 201 && hpSame.status === 200 && hpSame.body.review === 'self_reviewed', JSON.stringify([hp.status, hpSame.status, code(hpSame)]));

    const undated = await firm(A, M1, 'POST', '', journal('jundated', { body: { narration: 'no date', lines: [{ code: cash, dr_minor: 100 }, { code: sales, cr_minor: 100 }] } }));
    ok('F3 a journal with no date is refused at prepare (it would post on the day of the accept)', undated.status === 422 && code(undated) === 'ACTION_BODY_INVALID' && /date/.test(undated.body.detail || ''), JSON.stringify(undated));
    const noRef = await call(A, 'POST', '/api/books-actions', { member: M1.id, role: 'adviser', body: { store_id: M1.id, kind: 'journal', body: journal('x').body } });
    const dbl1 = await firm(A, M1, 'POST', '', journal('jdbl'));
    const dbl2 = await firm(A, M1, 'POST', '', journal('jdbl2', { body: journal('jdbl').body }));
    ok('F4 no client_ref is refused (422), and the same content under a new reference while one is open is refused (409): a double press is never two actions', noRef.status === 422 && dbl1.status === 201 && dbl2.status === 409 && code(dbl2) === 'ACTION_REF_OPEN', JSON.stringify([noRef.status, dbl1.status, dbl2]));

    const revPrep = await firm(A, M1, 'POST', '', { kind: 'reverse', client_ref: RUN + 'jrev', body: { entry_id: accepted.body.entry.entry_id, reason: 'posted twice' } });
    ok('F6 a reversal of a manual journal carries the entry\'s own total and currency from prepare', revPrep.status === 201 && revPrep.body.total_minor === 10000 && revPrep.body.currency === 'INR', JSON.stringify(revPrep));
    await firm(B, M1, 'POST', '/' + revPrep.body.action_id + '/review', { body_hash: revPrep.body.body_hash });
    const revNoTotals = await asOwner(M1, 'POST', '/' + revPrep.body.action_id + '/accept', { body_hash: revPrep.body.body_hash });
    const revWrong = await asOwner(M1, 'POST', '/' + revPrep.body.action_id + '/accept', { body_hash: revPrep.body.body_hash, total_minor: 9999, currency: 'INR' });
    const revDone = await asOwner(M1, 'POST', '/' + revPrep.body.action_id + '/accept', { body_hash: revPrep.body.body_hash, total_minor: 10000, currency: 'INR' });
    const reversals = await count(M1, 'SELECT count(*)::int AS n FROM journal_entry WHERE entity_id = $1 AND reverses_entry_id = $2', [M1.id, accepted.body.entry.entry_id]);
    ok('F6 the owner must carry the total (422 without, 409 on a wrong one), then the existing reverser posts exactly one mirror entry', revNoTotals.status === 422 && code(revNoTotals) === 'ACTION_TOTAL_NEEDED' && revWrong.status === 409 && code(revWrong) === 'PREVIEW_TOTAL_DIFFERS' && revDone.status === 200 && reversals === 1, JSON.stringify([revNoTotals.status, revWrong.status, revDone, reversals]));
    const revOfRev = await firm(A, M1, 'POST', '', { kind: 'reverse', client_ref: RUN + 'jrev2', body: { entry_id: revDone.body.entry.entry_id, reason: 'undo the undo' } });
    ok('F6 an adviser reverses manual journals only: a reversal entry (or a sale, receipt, bill) is refused with a sentence', revOfRev.status === 422 && code(revOfRev) === 'ACTION_REVERSE_MANUAL_ONLY', JSON.stringify(revOfRev));
    const rev2 = await firm(A, M1, 'POST', '', { kind: 'reverse', client_ref: RUN + 'jrev3', body: { entry_id: accepted.body.entry.entry_id, reason: 'again' } });
    await firm(B, M1, 'POST', '/' + rev2.body.action_id + '/review', { body_hash: rev2.body.body_hash });
    const rev2Done = await asOwner(M1, 'POST', '/' + rev2.body.action_id + '/accept', { body_hash: rev2.body.body_hash, total_minor: 10000, currency: 'INR' });
    const rev2State = (await asOwner(M1, 'GET', '/' + rev2.body.action_id)).body;
    ok('F6 a second reversal of the same entry: a `duplicate` at accept is a REFUSAL (409 ACTION_DUPLICATE), the action stays waiting', rev2Done.status === 409 && code(rev2Done) === 'ACTION_DUPLICATE' && rev2State.state === 'waiting_accept', JSON.stringify([rev2Done, rev2State.state]));

    const f10 = await firm(A, M1, 'POST', '', journal('jf10'));
    await firm(B, M1, 'POST', '/' + f10.body.action_id + '/review', { body_hash: f10.body.body_hash });
    const f10None = await asOwner(M1, 'POST', '/' + f10.body.action_id + '/accept', { body_hash: f10.body.body_hash });
    const f10Text = await asOwner(M1, 'POST', '/' + f10.body.action_id + '/accept', { body_hash: f10.body.body_hash, total_minor: 'ten thousand', currency: 'INR' });
    const f10Nan = await asOwner(M1, 'POST', '/' + f10.body.action_id + '/accept', { body_hash: f10.body.body_hash, total_minor: 10000 });
    ok('F10 an accept without a proper total and currency is a 422 sentence (never "NaN")', f10None.status === 422 && code(f10None) === 'ACTION_TOTAL_NEEDED' && f10Nan.status === 422 && !/NaN|undefined/.test(JSON.stringify(f10None.body)) && (f10Text.status === 422 || f10Text.status === 400), JSON.stringify([f10None, f10Text.status, f10Nan.status]));

    const km = await firm(A, M1, 'POST', '', journal('jstale'));
    const stepsK = await stepsOf(M1);
    const kReview = await call(A, 'POST', '/api/books-actions/' + km.body.action_id + '/review', { member: M1.id, role: 'adviser', body: { store_id: M2.id, body_hash: km.body.body_hash } });
    const kReturn = await call(B, 'POST', '/api/books-actions/' + km.body.action_id + '/return', { member: M1.id, role: 'adviser', body: { store_id: M2.id, body_hash: km.body.body_hash, reason: 'stale tab' } });
    const kAccept = await call(ownerOf(M1), 'POST', '/api/books-actions/' + km.body.action_id + '/accept', { body: { store_id: M2.id, body_hash: km.body.body_hash, total_minor: 10000, currency: 'INR' } });
    ok('STORE_MISMATCH on review, return and accept (not only prepare): 409 each, nothing stored', kReview.status === 409 && kReturn.status === 409 && kAccept.status === 409 && [kReview, kReturn, kAccept].every((r) => code(r) === 'STORE_MISMATCH') && (await stepsOf(M1)) === stepsK, JSON.stringify([kReview.status, kReturn.status, kAccept.status]));

    /* the database itself, as the api role: row security, insert-only, one closing step */
    const rowOf = (store, step, role, grantId, actionId) => ['INSERT INTO books_action_step (action_id, store, step, kind, body, body_hash, actor_identity_id, role, grant_id, reason) VALUES ($1, $2, $3, \'lock\', ' + (step === 'prepared' ? '\'{}\'::jsonb' : 'NULL') + ', \'h\', $4, $5, $6, \'a reason\')', [actionId, store, step, A.identity_id, role, grantId]];
    const sqlCode = (scope, sql, params) => withEntity(scope, (h) => h.query(sql, params)).then(() => 'ok', (e) => e.code);
    ok('DB a firm step that names another store than the session scope is refused by row security (42501)', (await sqlCode(M2.id, ...rowOf(M1.id, 'prepared', 'maker', adviserGrant.body.grant_id, newId()))) === '42501');
    ok('DB a firm step that names an AUDITOR grant is refused (42501): the preset is asked of the grant row', (await sqlCode(M1.id, ...rowOf(M1.id, 'prepared', 'maker', auditorGrant.body.grant_id, newId()))) === '42501');
    ok('DB the firm cannot write an `accepted` step with a firm role, nor the owner\'s role on a prepared step (42501)', (await sqlCode(M1.id, ...rowOf(M1.id, 'accepted', 'maker', adviserGrant.body.grant_id, newId()))) === '42501' && (await sqlCode(M1.id, ...rowOf(M1.id, 'prepared', 'owner', adviserGrant.body.grant_id, newId()))) === '42501');
    ok('DB UPDATE and DELETE on the steps are refused for the api role (42501)', (await sqlCode(M1.id, 'UPDATE books_action_step SET reason = \'x\' WHERE store = $1', [M1.id])) === '42501' && (await sqlCode(M1.id, 'DELETE FROM books_action_step WHERE store = $1', [M1.id])) === '42501');
    const lone = newId();
    const loneOk = [await sqlCode(M1.id, ...rowOf(M1.id, 'prepared', 'maker', adviserGrant.body.grant_id, lone)), await sqlCode(M1.id, ...rowOf(M1.id, 'returned', 'owner', null, lone)), await sqlCode(M1.id, ...rowOf(M1.id, 'withdrawn', 'owner', null, lone))];
    ok('DB an action has AT MOST ONE closing step: prepared, returned are accepted, a second closing step is refused by the unique index (23505)', loneOk[0] === 'ok' && loneOk[1] === 'ok' && loneOk[2] === '23505', JSON.stringify(loneOk));

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

    /* ── the fix round, part 2: the written leg, expiry and the edge in flight, concurrency, a locked month at accept, unlock, lock and year close ── */
    const entriesWith = (M, tag) => count(M, "SELECT count(*)::int AS n FROM journal_entry WHERE entity_id = $1 AND narration LIKE '%' || $2", [M.id, RUN + tag]);
    const reviewed = async (who, reviewer, M, tag, extra) => {
      const made = await firm(who, M, 'POST', '', journal(tag, extra));
      const checked = await firm(reviewer, M, 'POST', '/' + made.body.action_id + '/review', { body_hash: made.body.body_hash });
      return { made, checked, id: made.body.action_id, hash: made.body.body_hash };
    };
    const accept = (M, one, totals) => asOwner(M, 'POST', '/' + one.id + '/accept', Object.assign({ body_hash: one.hash }, totals === undefined ? { total_minor: 10000, currency: 'INR' } : totals));

    /* the WRITTEN leg of PREVIEW_TOTAL_DIFFERS: the engine writes 10000 but the prepare was shown 10001 (a stand-in preview for that one prepare) */
    const ledgerLib = require(path.join(API, 'lib', 'books.js'));
    const realPreview = ledgerLib.previewEntry;
    ledgerLib.previewEntry = async (...args) => { const seen = await realPreview(...args); seen.posted.totals.dr_minor += 1; return seen; };
    const lied = await firm(Y2, M1, 'POST', '', journal('jwritten'));
    ledgerLib.previewEntry = realPreview;
    await firm(Z2, M1, 'POST', '/' + lied.body.action_id + '/review', { body_hash: lied.body.body_hash });
    const writtenLeg = await asOwner(M1, 'POST', '/' + lied.body.action_id + '/accept', { body_hash: lied.body.body_hash, total_minor: 10001, currency: 'INR' });
    ok('the WRITTEN leg: the carried total equals the prepared one but the books would write another: 409 PREVIEW_TOTAL_DIFFERS, everything rolled back, still waiting', lied.body.total_minor === 10001 && writtenLeg.status === 409 && code(writtenLeg) === 'PREVIEW_TOTAL_DIFFERS' && /what the books wrote/.test(writtenLeg.body.detail || '') && (await entriesWith(M1, 'jwritten')) === 0 && (await asOwner(M1, 'GET', '/' + lied.body.action_id)).body.state === 'waiting_accept', JSON.stringify([lied.body.total_minor, writtenLeg]));

    /* expiry in flight (M2): the grant runs out between review and accept */
    const exp = await reviewed(A, B, M2, 'jexp');
    await grants.change(M2.id, M2.id, m2Grant.body.grant_id, { expires_at: new Date(Date.now() + 2500).toISOString() });
    await new Promise((resolve) => setTimeout(resolve, 3200));
    const expAccept = await accept(M2, exp);
    const expPrepare = await firm(A, M2, 'POST', '', journal('jexp2'));
    const expList = await asOwner(M2, 'GET', '?state=withdrawn');
    ok('expiry in flight: the owner cannot accept (409 ACTION_ACCESS_ENDED), the firm cannot prepare (403), and the owner opening the queue closes it "withdrawn: grant expired"', exp.checked.status === 200 && expAccept.status === 409 && code(expAccept) === 'ACTION_ACCESS_ENDED' && expPrepare.status === 403 && expList.body.actions.some((a) => a.action_id === exp.id && a.closed.reason === 'withdrawn: grant expired') && (await entriesWith(M2, 'jexp')) === 0, JSON.stringify([expAccept.status, expPrepare.status, expList.body.actions && expList.body.actions.map((a) => a.closed)]));

    /* the network edge in flight (M3): suspended, the owner cannot accept; resumed, the same action posts */
    const m3Grant = await giveGrant(P, M3, { preset: 'adviser' });
    const edgeAction = await reviewed(A, B, M3, 'jedge');
    await net.suspend(edge3, P.node);
    const edgeOff = await accept(M3, edgeAction);
    const edgeList = await asOwner(M3, 'GET', '?state=open');
    await net.resume(edge3, P.node);
    const edgeOn = await accept(M3, edgeAction);
    ok('the edge in flight: suspended, accept is refused 409 ACTION_ACCESS_ENDED and the queue says access_ended; resumed, the same reviewed action posts', edgeAction.checked.status === 200 && edgeOff.status === 409 && code(edgeOff) === 'ACTION_ACCESS_ENDED' && edgeList.body.actions.some((a) => a.action_id === edgeAction.id && a.access_ended === true) && edgeOn.status === 200, JSON.stringify([edgeOff.status, code(edgeOff), edgeOn.status]));

    /* concurrency */
    const twice = await reviewed(Y2, Z2, M1, 'jtwice');
    const both = await Promise.all([accept(M1, twice), accept(M1, twice)]);
    ok('concurrency: two accepts of one action at once: exactly one posts (200) and the other is refused (409); one entry', both.map((r) => r.status).sort().join() === '200,409' && (await entriesWith(M1, 'jtwice')) === 1, JSON.stringify(both.map((r) => [r.status, code(r)])));
    const dual = await firm(Y2, M1, 'POST', '', journal('jdual'));
    const checks = await Promise.all([Z2, X2].map((who) => firm(who, M1, 'POST', '/' + dual.body.action_id + '/review', { body_hash: dual.body.body_hash })));
    const reviews = await count(M1, "SELECT count(*)::int AS n FROM books_action_step WHERE action_id = $1 AND step = 'reviewed'", [dual.body.action_id]);
    ok('concurrency: two reviews at once: exactly one stands (200 and 409), one reviewed step', checks.map((r) => r.status).sort().join() === '200,409' && reviews === 1, JSON.stringify(checks.map((r) => [r.status, code(r)])));
    const m4Grant = await giveGrant(P, M4, { preset: 'adviser' });
    const race = await reviewed(A, B, M4, 'jrace');
    const [raceAccept, raceRevoke] = await Promise.all([accept(M4, race), call(ownerOf(M4), 'POST', '/api/books-grants/' + m4Grant.body.grant_id + '/revoke', { body: {} })]);
    const raceState = (await asOwner(M4, 'GET', '/' + race.id)).body;
    const raceClosing = await count(M4, "SELECT count(*)::int AS n FROM books_action_step WHERE action_id = $1 AND step IN ('returned', 'accepted', 'withdrawn')", [race.id]);
    const raceEntries = await entriesWith(M4, 'jrace');
    ok('concurrency: an accept racing a revoke leaves EXACTLY ONE outcome: posted and accepted, or withdrawn with nothing posted, never both and never a post after the revoke', raceRevoke.status === 200 && raceClosing === 1 && ((raceState.state === 'accepted' && raceEntries === 1 && raceAccept.status === 200) || (raceState.state === 'withdrawn' && raceEntries === 0 && raceAccept.status === 409)), JSON.stringify([raceAccept.status, raceRevoke.status, raceState.state, raceClosing, raceEntries]));

    /* a locked month at accept, then unlock, lock and year close through the same flow (the second firm) */
    const periodsNow = (await call(ownerOf(M1), 'GET', '/api/books/periods')).body; /* K-F-01: a running month is never locked: lock the latest OPEN month that has ended, journal dated inside it */
    const endedRow = ((periodsNow.periods || periodsNow.rows || periodsNow) || []).filter((row) => Number(row.period) >= 1 && String(row.end_date).slice(0, 10) < day && row.status === 'open').sort((x, y) => String(y.end_date).localeCompare(String(x.end_date)))[0];
    ok('the periods answer holds an open month that has ended (a test that cannot find it fails, never skips)', !!endedRow, JSON.stringify(periodsNow).slice(0, 300));
    const fy = endedRow.fiscal_year; const periodNo = Number(endedRow.period);
    const lockedAt = await reviewed(Y2, Z2, M1, 'jlocked', { body: Object.assign({}, journal('jlocked').body, { date: String(endedRow.start_date).slice(0, 10) }) });
    const ownerLock = await call(ownerOf(M1), 'POST', '/api/books/periods/' + fy + '/' + periodNo + '/lock', { body: {} });
    const lockedAccept = await accept(M1, lockedAt);
    const stillWaiting = (await asOwner(M1, 'GET', '/' + lockedAt.id)).body;
    ok('a month locked between review and accept: the accept is refused, rolled back (no entry, no accepted step), the action still waits', ownerLock.status === 200 && lockedAccept.status >= 400 && lockedAccept.status < 500 && (await entriesWith(M1, 'jlocked')) === 0 && stillWaiting.state === 'waiting_accept', JSON.stringify([ownerLock.status, lockedAccept.status, code(lockedAccept), stillWaiting.state]));
    const unlock = await firm(Y2, M1, 'POST', '', { kind: 'unlock', client_ref: RUN + 'junlock', body: { fy, period: periodNo, reason: 'to post the reviewed journal' } });
    await firm(Z2, M1, 'POST', '/' + unlock.body.action_id + '/review', { body_hash: unlock.body.body_hash });
    const unlockDone = await asOwner(M1, 'POST', '/' + unlock.body.action_id + '/accept', { body_hash: unlock.body.body_hash });
    const retry = await accept(M1, lockedAt);
    ok('unlock: prepared, reviewed, accepted by the owner (the existing period writer), then the rolled-back journal posts', unlock.status === 201 && unlockDone.status === 200 && retry.status === 200 && (await entriesWith(M1, 'jlocked')) === 1, JSON.stringify([unlock.status, unlockDone.status, retry.status]));
    const lockAction = await firm(Y2, M1, 'POST', '', { kind: 'lock', client_ref: RUN + 'jlock', body: { fy, period: periodNo } });
    await firm(Z2, M1, 'POST', '/' + lockAction.body.action_id + '/review', { body_hash: lockAction.body.body_hash });
    const lockDone = await asOwner(M1, 'POST', '/' + lockAction.body.action_id + '/accept', { body_hash: lockAction.body.body_hash });
    const afterLock = ((await call(ownerOf(M1), 'GET', '/api/books/periods')).body.periods || []).find((row) => Number(row.period) === periodNo && row.fiscal_year === fy);
    ok('lock: prepared, reviewed, accepted, then the month is soft locked; the change log carries the adviser grant', lockAction.status === 201 && lockDone.status === 200 && afterLock && /locked/.test(afterLock.status) && (await count(M1, "SELECT count(*)::int AS n FROM books_change_log WHERE entity_id = $1 AND table_name = 'fiscal_period' AND grant_id = $2", [M1.id, g2.body.grant_id])) >= 1, JSON.stringify([lockDone.status, afterLock]));
    const close = await firm(Y2, M1, 'POST', '', { kind: 'year_close', client_ref: RUN + 'jclose', body: { fy } });
    await firm(Z2, M1, 'POST', '/' + close.body.action_id + '/review', { body_hash: close.body.body_hash });
    const closeTry = await asOwner(M1, 'POST', '/' + close.body.action_id + '/accept', { body_hash: close.body.body_hash });
    ok('year close goes through the existing closer: an open year is refused in its own words (422 YEAR_CLOSE_REFUSED), nothing recorded as accepted, the action still waits', close.status === 201 && closeTry.status === 422 && code(closeTry) === 'YEAR_CLOSE_REFUSED' && (await asOwner(M1, 'GET', '/' + close.body.action_id)).body.state === 'waiting_accept', JSON.stringify([closeTry.status, code(closeTry)]));
    /* DELEGATED POSTING (the owner chose adviser_posts on the grant of M3): the SAME action path posts at once, stamped 'delegated', never as the owner */ const gid = m3Grant.body.grant_id, patch = (body) => call(ownerOf(M3), 'PATCH', '/api/books-grants/' + gid, { body }), sql = (text, params) => withEntity(M3.id, (h) => h.query(text, params)).then((x) => x.rows[0] || {});
    const noChoice = await call(ownerOf(M3), 'POST', '/api/books-grants', { body: { grantee: P2.id, preset: 'adviser', purpose: 'second adviser', consent: true } }); const waits = await firm(A, M3, 'POST', '', journal('jwait')); const flip = await patch({ posting: 'adviser_posts' }); const direct = await firm(A, M3, 'POST', '', journal('jdeleg'));
    const dRow = await sql("SELECT created_by::text AS by, grant_id::text AS grant, (SELECT count(*)::int FROM books_action_step WHERE action_id = $2 AND role = 'delegated') AS steps FROM journal_entry WHERE entity_id = $1 AND narration LIKE '%' || $3", [M3.id, direct.body.action_id, RUN + 'jdeleg']);
    ok('delegation: no posting choice is refused (422 BOOKS_GRANT_POSTING_NEEDED, nothing defaulted); under owner_approves a prepare WAITS; the owner switches to adviser_posts (200) and the next prepare posts AT ONCE: accepted, one entry, 1 delegated step (no review step under the doer: RC-9), review not_reviewed, created_by the preparer, grant_id the grant', noChoice.status === 422 && code(noChoice) === 'BOOKS_GRANT_POSTING_NEEDED' && waits.body.state === 'waiting_review' && (await entriesWith(M3, 'jwait')) === 0 && flip.status === 200 && direct.body.state === 'accepted' && dRow.steps === 1 && dRow.grant === gid && direct.body.closed.role === 'delegated' && direct.body.review === 'not_reviewed' && direct.body.reviewed === null && (await entriesWith(M3, 'jdeleg')) === 1, JSON.stringify([noChoice.status, waits.body.state, flip.status, direct.body, dRow]).slice(0, 600));
    const feed = await call(ownerOf(M3), 'GET', '/api/books-actions?state=accepted&delegated=true'); const capSet = await patch({ posting_cap_minor: 5000, posting_cap_currency: 'INR' }); const over = await firm(A, M3, 'POST', '', journal('jcap')); await patch({ posting_cap_minor: null, posting_cap_currency: null }); ok('delegation: the owner weekly list is a filter of the same queue and holds the action; above the owner optional limit (5000 INR) the action WAITS for the accept; the first delegated post wrote ONE owner alert', feed.body.actions.some((x) => x.action_id === direct.body.action_id) && capSet.status === 200 && over.body.state === 'waiting_review' && (await entriesWith(M3, 'jcap')) === 0 && (await sql("SELECT count(*)::int AS n FROM access_events WHERE entity_id = $1 AND action = 'books_delegated_first'", [M3.id])).n === 1, JSON.stringify([feed.status, capSet.status, over.body.state]));
    const back = await patch({ posting: 'owner_approves' }); const after = await firm(A, M3, 'POST', '', journal('jback')); await patch({ posting: 'adviser_posts' }); await call(ownerOf(M3), 'POST', '/api/books-grants/' + gid + '/revoke', { body: {} }); const gone = await firm(A, M3, 'POST', '', journal('jgone'));
    ok('delegation: the owner switches back (200) and the very next prepare waits; after the owner revokes, a prepare is refused at once and nothing is posted', back.status === 200 && after.body.state === 'waiting_review' && gone.status >= 400 && gone.status < 500 && (await entriesWith(M3, 'jgone')) === 0, JSON.stringify([back.status, after.body.state, gone.status]));
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
