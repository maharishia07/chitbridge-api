'use strict';
/**
 * tests/acc-176-books-grant.realstack.cjs — ACC-176 (an auditor over a network, read-only books of member stores) on a REAL Postgres, as the role the api runs as (cb_app, RLS on).
 *
 * The critic's cases (docs/04-network/ACC-176-AUDITOR-GRANT.md section 4), the api half; case 13 is the web screen (cb-network). The real pieces: migration b863's tables and policies, lib/books-grant.js,
 * middleware/books-grant.js (the router-level front), routes/books-grants.js, the real network (src/services/network: ask, approve, suspend, resume, disconnect) and the real db layer (BEGIN READ ONLY).
 * Only the sign-in is a stand-in (a header names who is calling) and the ledger routes are small stand-ins with the real names, reading and writing access_events (RLS by entity), because a seeded books ledger is
 * not what is under test. The classification of the REAL books router is tests/acc-176-grant-classification.test.cjs.
 * HAND-COMPUTED  parent P; members M1..M4 each approved under P (an active tree edge); every member holds 2 marker rows, P holds 1.
 *   1 no grant: P naming M1 gets 403 BOOKS_GRANT_NONE (a log row says no_grant); P without the header reads P's own marker only.
 *   2 M1 grants: P reads M1's 2 markers, equal to M1's own answer; M2 (no grant) 403; ?entity=M2 and a body entity are ignored.   3 M1, M2, M1 in a row: each answer is its own markers only.
 *   4 five write shapes with a grant: all 403 GRANT_READ_ONLY, M1's rows still 2.   5 a listed GET runs transaction_read_only = on; a planted listed GET that INSERTs is refused by Postgres (25006), rows still 2.
 *   7 a GET that is not listed is refused 403 GRANT_ROUTE_NOT_LISTED and its handler never runs.
 *   8 revoke: next request 403 BOOKS_GRANT_ENDED; suspend: 403 BOOKS_GRANT_NOT_LIVE, resume: 200 again; disconnect: 403 NOT_LIVE; expired: 403 BOOKS_GRANT_ENDED.
 *   9 a co-assist of M4 cannot grant or revoke (403 OWNER_ONLY); the parent and a stranger cannot revoke M4's grant (404); a grant to a business that is not the network parent is 422.
 *   10 a parent person without the auditor preset is refused (403); with it, allowed.   11 grant, change and revoke each leave an access_events row; the log has one row per request; a log insert that fails answers 503, no data.
 *   12 the member lists only its own looks.
 * Run: DATABASE_URL=postgres://cb_app:cbapp@localhost:5432/cb_s41 node tests/acc-176-books-grant.realstack.cjs   (CI: the integration job; needs b863 built by the fresh-db step)
 * CARD      04-network/ACC-176-AUDITOR-GRANT
 */
const url = process.env.DATABASE_URL || '';
const ALLOWED_HOSTS = /^(localhost|127\.0\.0\.1|db|sit-[a-z]+(\.[a-z0-9.-]+)?)$/;
const parts = /^postgres(?:ql)?:\/\/([^:@/]+):[^@]*@([^:/]+)/.exec(url);
if (!parts || parts[1] !== 'cb_app' || !ALLOWED_HOSTS.test(parts[2])) { console.error('REFUSED: needs DATABASE_URL as cb_app on localhost, the compose db or a SIT host'); process.exit(3); }
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'acc176_test_secret_at_least_32_chars_padding';
const path = require('path');
const express = require('express');
const API = path.join(__dirname, '..');

/* the sign-in stand-in goes in BEFORE the real modules that load middleware/auth (the wrapped books auth and the grant routes read it) */
const authPath = require.resolve(path.join(API, 'middleware', 'auth.js'));
const fakeAuth = (req, res, next) => {
  if (req.identity) return next(); /* the real auth re-enters on its DECIDED set and keeps the identity the front swapped in */
  try { req.identity = JSON.parse(String(req.headers['x-test-as'] || '')); } catch (_) { return res.status(401).json({ error: 'no test identity' }); }
  return next();
};
fakeAuth.entityOf = (req) => req.identity.parent_entity_id || req.identity.identity_id;
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: fakeAuth };

const net = require(path.join(API, 'src', 'services', 'network'));
const { query, withEntity } = require(path.join(API, 'db'));
const grants = require(path.join(API, 'lib', 'books-grant.js'));
const booksGrant = require(path.join(API, 'middleware', 'books-grant.js'));
const { isOwner } = require(path.join(API, 'lib', 'owner.js'));
const access = require(path.join(API, 'lib', 'access.js'));

let pass = 0, fail = 0;
const ok = (what, cond, info) => { if (cond) { pass++; console.log('  ok   ' + what); } else { fail++; console.log('  FAIL ' + what + (info ? '\n         ' + String(info).slice(0, 400) : '')); } };
const RUN = 'a176' + (Date.now() % 1e10).toString(36);
const madeIdentities = [];
const UUID0 = '00000000-0000-4000-8000-0000000000';
const label = (bridgeId) => String(bridgeId).replace(/[^A-Za-z0-9_]/g, '_');

/** a business: its identity and its network node, a root of its own */
async function business(tag) {
  const bridgeId = 'CB' + RUN + tag;
  const { rows: [identity] } = await query(
    `INSERT INTO identities (bridge_id, display_name, identity_type, country, currency_code, user_id) VALUES ($1, $2, 'entity', 'AU', 'AUD', $3) RETURNING identity_id`,
    [bridgeId, 'ACC176 ' + tag + ' ' + RUN, bridgeId.toLowerCase()]);
  madeIdentities.push(identity.identity_id);
  return { tag, bridgeId, id: identity.identity_id, node: await net.nodeOf(identity.identity_id, { ensure: true }) };
}
/** the member joins the parent's tree: the parent asks, the member approves (an active governance edge) */
async function join(parent, member) {
  const asked = await net.requestConnect({ parentId: parent.node.id, childId: member.node.id }, parent.node);
  await net.approve({ edgeId: asked.id }, member.node);
  return asked.id;
}
const ownerOf = (biz) => ({ identity_id: biz.id, bridge_id: biz.bridgeId, identity_type: 'entity', parent_entity_id: null, display_name: biz.tag });
const staffOf = (biz, extra, id) => Object.assign({ identity_id: id || require('crypto').randomUUID(), identity_type: 'actor', parent_entity_id: biz.id, bridge_id: biz.bridgeId, access_level: 'editor', whole_entity: false, can_see_costs: false }, extra);
const AUDITOR = { access_level: 'commenter', whole_entity: true, can_see_costs: true };
const newId = () => require('crypto').randomUUID();

/* ── the stand-in ledger: the real route names, rows in access_events (RLS by entity) ── */
const reached = { packs: 0 };
const markerRows = (entity) => withEntity(entity, (h) => h.query(`SELECT reason FROM access_events WHERE action = 'created' ORDER BY reason`)).then((r) => r.rows.map((x) => x.reason));
const addMarker = (entity, reason) => withEntity(entity, (h) => h.query(`INSERT INTO access_events (entity_id, subject_identity_id, action, reason) VALUES ($1, $2, 'created', $3)`, [entity, entity, reason]));
const count = (entity) => markerRows(entity).then((rows) => rows.length);
function ledger() {
  const router = express.Router();
  const auth = fakeAuth; /* the books router: the grant front first (a router-level layer), each route keeps its own sign-in, which re-enters on the decision already made */
  router.use(booksGrant);
  const read = async (req, res) => { const entity = fakeAuth.entityOf(req); res.json({ entity, rows: await markerRows(entity), owner: isOwner(req), may_write: access.mayWrite(req).may, level: access.levelOf(req.identity) }); };
  router.get('/daybook', auth, read);
  router.get('/trial-balance', auth, read);
  router.get('/pl', auth, async (req, res) => { const r = await withEntity(fakeAuth.entityOf(req), (h) => h.query('SHOW transaction_read_only')); res.json({ read_only: r.rows[0].transaction_read_only }); });
  router.get('/accounts', auth, async (req, res) => { /* a listed GET that quietly writes: Postgres, not the guard, must refuse it */
    try { await addMarker(fakeAuth.entityOf(req), 'planted'); res.json({ wrote: true }); } catch (e) { res.status(500).json({ pg: e.code }); }
  });
  router.get('/packs', auth, (req, res) => { reached.packs++; res.json({ reached: true }); });
  const write = async (req, res) => { await addMarker(fakeAuth.entityOf(req), 'WROTE'); res.json({ wrote: true }); };
  router.post('/entries', auth, write);
  router.patch('/entries/:id', auth, write);
  router.delete('/recurring/:id', auth, write);
  router.post('/payments/preview', auth, write);
  router.put('/setting', auth, write);
  return router;
}

let base = '';
/** one request as `who`, optionally naming a member's books */
async function call(who, method, route, opts) {
  const o = opts || {};
  const headers = { 'content-type': 'application/json', 'x-test-as': JSON.stringify(who) };
  if (o.member) headers['x-books-for'] = o.member;
  const res = await fetch(base + route, { method, headers, body: o.body === undefined ? undefined : JSON.stringify(o.body) });
  let body = null;
  try { body = await res.json(); } catch (_) { body = null; }
  return { status: res.status, body };
}
const asked = {}; /* requests P made on each member's books that reached the look (they each leave one log row) */
const viaP = (P, member, method, route, opts) => { asked[member.id] = (asked[member.id] || 0) + 1; return call(ownerOf(P), method, '/api/books' + route, Object.assign({ member: member.id }, opts)); };
const code = (r) => r.body && r.body.code;
const grantBody = (P, extra) => Object.assign({ grantee: P.id, purpose: 'audit of the books', consent: true }, extra);
const giveGrant = async (P, M, extra) => (await call(ownerOf(M), 'POST', '/api/books-grants', { body: grantBody(P, extra) }));
const logRows = (M) => grants.looks(M.id, { limit: 200 });
const eventsOf = (M) => withEntity(M.id, (h) => h.query(`SELECT action, before_value, after_value FROM access_events WHERE action LIKE 'books_grant_%' ORDER BY at, action`)).then((r) => r.rows);

async function main() {
  const P = await business('p'); const M1 = await business('1'); const M2 = await business('2'); const M3 = await business('3'); const M4 = await business('4'); const S = await business('s');
  const edge = {};
  for (const M of [M1, M2, M3, M4]) edge[M.tag] = await join(P, M);
  for (const M of [M1, M2, M3, M4]) { await addMarker(M.id, 'M' + M.tag + 'a'); await addMarker(M.id, 'M' + M.tag + 'b'); }
  await addMarker(P.id, 'Pown');

  const app = express();
  app.use(express.json());
  app.use('/api/books', ledger());
  app.use('/api/books-grants', require(path.join(API, 'routes', 'books-grants.js')));
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  base = 'http://127.0.0.1:' + server.address().port;
  try {
    /* 1 no grants */
    let r = await viaP(P, M1, 'GET', '/daybook');
    ok('1 no grant: P naming M1 is refused 403 BOOKS_GRANT_NONE and gets no row', r.status === 403 && code(r) === 'BOOKS_GRANT_NONE' && !r.body.rows, JSON.stringify(r));
    r = await call(ownerOf(P), 'GET', '/api/books/daybook');
    ok('1 P without the header reads its own books only', r.status === 200 && JSON.stringify(r.body.rows) === '["Pown"]' && r.body.entity === P.id, JSON.stringify(r));

    /* 2 grant M1 only */
    const consent = await call(ownerOf(M1), 'GET', '/api/books-grants/consent');
    ok('the consent screen words list exactly what the guard allows, and say what an auditor cannot do', consent.status === 200 && consent.body.can_read.length === booksGrant.GRANT_READS.size && /phone numbers or bank details/.test(consent.body.cannot.join(' ')), JSON.stringify(consent));
    const noConsent = await call(ownerOf(M1), 'POST', '/api/books-grants', { body: { grantee: P.id, purpose: 'audit', consent: false } });
    ok('a grant without a yes to the consent is refused 422', noConsent.status === 422 && code(noConsent) === 'BOOKS_GRANT_CONSENT_NEEDED', JSON.stringify(noConsent));
    const made = await giveGrant(P, M1);
    ok('2 M1 gives the grant: 201, 12 months by default, the purpose kept', made.status === 201 && Math.abs(new Date(made.body.expires_at) - Date.now() - 12 * 30.4375 * 864e5) < 36e5 && made.body.purpose === 'audit of the books', JSON.stringify(made));
    const again = await giveGrant(P, M1);
    ok('2 a second open grant for the pair is 409', again.status === 409 && code(again) === 'BOOKS_GRANT_EXISTS', JSON.stringify(again));
    const own = await call(ownerOf(M1), 'GET', '/api/books/daybook');
    r = await viaP(P, M1, 'GET', '/daybook');
    ok('2 with the grant P reads M1: the same rows as M1 reads', r.status === 200 && JSON.stringify(r.body.rows) === JSON.stringify(own.body.rows) && r.body.entity === M1.id && r.body.rows.length === 2, JSON.stringify(r));
    ok('13(api) the handler sees a synthetic auditor: not an owner, may not write, commenter', r.body.owner === false && r.body.may_write === false && r.body.level === 'commenter', JSON.stringify(r.body));
    r = await viaP(P, M2, 'GET', '/daybook');
    ok('2 M2 gave no grant: 403', r.status === 403 && code(r) === 'BOOKS_GRANT_NONE', JSON.stringify(r));
    asked[M1.id] = (asked[M1.id] || 0) + 1;
    r = await call(ownerOf(P), 'GET', '/api/books/daybook?entity=' + M2.id, { member: M1.id, body: undefined });
    ok('2 a forged entity in the query is ignored: still M1 rows only', r.status === 200 && r.body.entity === M1.id && r.body.rows.every((x) => x.startsWith('M1')), JSON.stringify(r));

    /* 3 one after another */
    await giveGrant(P, M2);
    const seq = [];
    for (const M of [M1, M2, M1]) seq.push(await viaP(P, M, 'GET', '/trial-balance'));
    ok('3 M1, M2, M1 on the same caller: each answer is its own rows only', seq[0].body.rows.every((x) => x.startsWith('M1')) && seq[1].body.rows.every((x) => x.startsWith('M2')) && seq[2].body.rows.every((x) => x.startsWith('M1')) && seq.every((x) => x.body.rows.length === 2), JSON.stringify(seq.map((x) => x.body)));

    /* 4 every write shape */
    const before = await count(M1.id);
    const shapes = [['POST', '/entries'], ['PATCH', '/entries/abc'], ['DELETE', '/recurring/abc'], ['POST', '/payments/preview'], ['PUT', '/setting']];
    const answers = [];
    for (const [method, route] of shapes) answers.push(await viaP(P, M1, method, route, method === 'DELETE' ? undefined : { body: {} }));
    ok('4 every write shape answers 403 GRANT_READ_ONLY', answers.every((x) => x.status === 403 && code(x) === 'GRANT_READ_ONLY'), JSON.stringify(answers.map((x) => [x.status, code(x)])));
    ok('4 and M1 holds the same rows after the sweep (' + before + ')', (await count(M1.id)) === before && before === 2);

    /* 5 READ ONLY */
    r = await viaP(P, M1, 'GET', '/pl');
    ok('5 a listed GET runs inside a READ ONLY transaction', r.status === 200 && r.body.read_only === 'on', JSON.stringify(r));
    r = await viaP(P, M1, 'GET', '/accounts');
    ok('5 a planted listed GET that INSERTs is refused by Postgres itself (25006), not by the guard', r.status === 500 && r.body.pg === '25006' && (await count(M1.id)) === 2, JSON.stringify(r));
    r = await call(ownerOf(M1), 'GET', '/api/books/accounts');
    ok('5 control: the same GET as M1 itself (no header) is not read only and does write', r.status === 200 && r.body.wrote === true);

    /* 7 not listed */
    r = await viaP(P, M1, 'GET', '/packs');
    ok('7 a GET that is not on the allow-list is 403 GRANT_ROUTE_NOT_LISTED and its handler never runs', r.status === 403 && code(r) === 'GRANT_ROUTE_NOT_LISTED' && reached.packs === 0, JSON.stringify(r));

    /* 10 who may use the grant */
    const noRole = await call(staffOf(P, {}), 'GET', '/api/books/daybook', { member: M1.id });
    ok('10 a parent person without the auditor preset is refused 403', noRole.status === 403 && code(noRole) === 'BOOKS_GRANT_NOT_FOR_YOU', JSON.stringify(noRole));
    const withRole = await call(staffOf(P, AUDITOR), 'GET', '/api/books/daybook', { member: M1.id }); asked[M1.id]++;
    ok('10 a parent person holding the auditor preset may', withRole.status === 200 && withRole.body.entity === M1.id, JSON.stringify(withRole));
    const strangerOwner = await call(ownerOf(S), 'GET', '/api/books/daybook', { member: M1.id });
    ok('10 a stranger business naming M1 is refused (no grant for it)', strangerOwner.status === 403 && code(strangerOwner) === 'BOOKS_GRANT_NONE', JSON.stringify(strangerOwner));

    /* 8 revoke, suspend, disconnect, expiry */
    const m1Grant = made.body.grant_id;
    const revoked = await call(ownerOf(M1), 'POST', '/api/books-grants/' + m1Grant + '/revoke', { body: {} });
    r = await viaP(P, M1, 'GET', '/daybook');
    ok('8 revoke: M1 revokes and the very next request is refused BOOKS_GRANT_ENDED', revoked.status === 200 && r.status === 403 && code(r) === 'BOOKS_GRANT_ENDED', JSON.stringify([revoked.status, r]));
    await net.suspend(edge['2'], P.node);
    r = await viaP(P, M2, 'GET', '/daybook');
    ok('8 a suspended member blocks reads at once: 403 BOOKS_GRANT_NOT_LIVE', r.status === 403 && code(r) === 'BOOKS_GRANT_NOT_LIVE', JSON.stringify(r));
    await net.resume(edge['2'], P.node);
    r = await viaP(P, M2, 'GET', '/daybook');
    ok('8 resumed: the same grant reads again (nothing was copied or rewritten)', r.status === 200 && r.body.entity === M2.id, JSON.stringify(r));
    await net.disconnect({ edgeId: edge['2'] }, P.node);
    r = await viaP(P, M2, 'GET', '/daybook');
    ok('8 a disconnected edge ends access at once: 403 BOOKS_GRANT_NOT_LIVE', r.status === 403 && code(r) === 'BOOKS_GRANT_NOT_LIVE', JSON.stringify(r));
    await withEntity(M3.id, (h) => h.query(`INSERT INTO books_access_grant (grantor_entity, grantee_entity, purpose, granted_by, granted_at, expires_at) VALUES ($1, $2, 'audit', $1, now() - interval '2 days', now() - interval '1 day')`, [M3.id, P.id]));
    r = await viaP(P, M3, 'GET', '/daybook');
    ok('8 an expired grant refuses: 403 BOOKS_GRANT_ENDED', r.status === 403 && code(r) === 'BOOKS_GRANT_ENDED', JSON.stringify(r));

    /* 9 who may grant and revoke */
    const m4 = await giveGrant(P, M4, { purpose: 'yearly audit by the practice' });
    const assist = staffOf(M4, {});
    const byAssist = await call(assist, 'POST', '/api/books-grants/' + m4.body.grant_id + '/revoke', { body: {} });
    const byAssistGive = await call(assist, 'POST', '/api/books-grants', { body: grantBody(P) });
    ok('9 a co-assist of the member cannot grant or revoke: 403 OWNER_ONLY', byAssist.status === 403 && byAssistGive.status === 403 && code(byAssist) === 'OWNER_ONLY', JSON.stringify([byAssist, byAssistGive]));
    const byParent = await call(ownerOf(P), 'POST', '/api/books-grants/' + m4.body.grant_id + '/revoke', { body: {} });
    const byStranger = await call(ownerOf(S), 'POST', '/api/books-grants/' + m4.body.grant_id + '/revoke', { body: {} });
    ok('9 the parent and a stranger cannot revoke the member\'s grant: 404', byParent.status === 404 && byStranger.status === 404, JSON.stringify([byParent, byStranger]));
    const notParent = await call(ownerOf(M3), 'POST', '/api/books-grants', { body: grantBody(S) });
    ok('9 a grant to a business that is not the network parent is 422', notParent.status === 422 && code(notParent) === 'BOOKS_GRANT_NO_PARENT', JSON.stringify(notParent));
    const longer = await call(ownerOf(M4), 'PATCH', '/api/books-grants/' + m4.body.grant_id, { body: { expires_at: new Date(Date.now() + 90 * 864e5).toISOString() } });
    const tooLong = await call(ownerOf(M4), 'PATCH', '/api/books-grants/' + m4.body.grant_id, { body: { expires_at: new Date(Date.now() + 5 * 365 * 864e5).toISOString() } });
    ok('9 the member edits the end date; more than 36 months is 422', longer.status === 200 && tooLong.status === 422 && code(tooLong) === 'BOOKS_GRANT_EXPIRY_INVALID', JSON.stringify([longer.status, tooLong]));

    /* 11 events, the log, fail closed */
    r = await viaP(P, M4, 'GET', '/daybook');
    const noLogId = staffOf(P, AUDITOR, 'not-a-uuid');
    const failClosed = await call(noLogId, 'GET', '/api/books/daybook', { member: M4.id });
    ok('11 the log row cannot be written: the answer is 503 and carries no data', failClosed.status === 503 && code(failClosed) === 'BOOKS_GRANT_LOG_UNAVAILABLE' && !failClosed.body.rows, JSON.stringify(failClosed));
    await call(ownerOf(M4), 'POST', '/api/books-grants/' + m4.body.grant_id + '/revoke', { body: {} });
    const events = await eventsOf(M4);
    const actions = events.map((e) => e.action).sort().join(',');
    ok('11 grant, change and revoke each left an access_events row', actions === 'books_grant_changed,books_grant_given,books_grant_revoked', actions);
    const changed = events.find((e) => e.action === 'books_grant_changed');
    ok('11 the change row holds before and after', changed && changed.before_value && changed.after_value && changed.before_value.expires_at !== changed.after_value.expires_at, JSON.stringify(changed));
    const lookM1 = await logRows(M1);
    const looksOfP = lookM1.filter((x) => String(x.grantee_entity) === P.id && x.actor_identity_id !== null);
    ok('11 every request on M1 left one log row (allowed or refused): ' + asked[M1.id], looksOfP.length === asked[M1.id], looksOfP.length + ' of ' + asked[M1.id]);
    ok('11 refusals are in the log with their outcome', lookM1.some((x) => x.outcome === 'read_only') && lookM1.some((x) => x.outcome === 'not_listed') && lookM1.some((x) => x.outcome === 'no_grant') && lookM1.some((x) => x.outcome === 'revoked') && lookM1.some((x) => x.outcome === 'allowed'), lookM1.map((x) => x.outcome).join(','));
    ok('11 a log row holds the route and the query keys, never a figure', lookM1.every((x) => /^(GET|POST|PATCH|DELETE|PUT) \//.test(x.route_pattern)) && lookM1.some((x) => x.query_shape === 'entity'));

    /* 12 the member lists only its own looks */
    const m2Looks = await call(ownerOf(M2), 'GET', '/api/books-grants/log');
    const m1Looks = await call(ownerOf(M1), 'GET', '/api/books-grants/log');
    const pLooks = await call(ownerOf(P), 'GET', '/api/books-grants/log');
    ok('12 the member reads its own log through the route; M2 sees M2\'s looks, M1 M1\'s, and P (the auditor) none of the members\'', m1Looks.status === 200 && m1Looks.body.looks.length === lookM1.length && m2Looks.body.looks.length === (await logRows(M2)).length && m2Looks.body.looks.length !== m1Looks.body.looks.length && pLooks.body.looks.length === 0, JSON.stringify([m1Looks.body.looks.length, m2Looks.body.looks.length, pLooks.body.looks.length]));
    const mixed = await withEntity(M2.id, (h) => h.query('SELECT count(*)::int AS n FROM books_access_log WHERE grantor_entity <> $1 AND grantee_entity <> $1', [M2.id]));
    ok('12 row security: M2 cannot see a log row that is neither about its books nor made by it', mixed.rows[0].n === 0, JSON.stringify(mixed.rows));
    const received = await call(ownerOf(P), 'GET', '/api/books-grants');
    ok('the parent lists the access it holds, each with its state', received.status === 200 && received.body.received.length === 4 && ['revoked', 'expired', 'edge_off'].every((word) => received.body.received.some((g) => g.state === word)), JSON.stringify(received.body.received && received.body.received.map((g) => g.state)));
    const noUpdate = await withEntity(P.id, (h) => h.query('UPDATE books_access_log SET status = 0')).then(() => 'updated', (e) => e.code);
    ok('the log is insert-only: no UPDATE privilege (42501)', noUpdate === '42501', noUpdate);
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
  console.log('\n── ACC-176 auditor grant on real Postgres (cb_app, RLS on) · run ' + RUN + ' ──');
  try { await main(); } catch (e) { ok('the run reached its end', false, e && e.stack); } finally { await cleanup().catch((e) => console.log('  note  the throwaway businesses stay (access_events is insert-only, its rows keep them): ' + (e && e.code))); }
  console.log('\n' + pass + ' ok, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
void UUID0; void label;
