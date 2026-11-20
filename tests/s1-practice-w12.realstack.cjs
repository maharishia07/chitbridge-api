'use strict';
/**
 * tests/s1-practice-w12.realstack.cjs — S1 (18 Nov 2026) on a REAL Postgres as cb_app (RLS on): the practice list and the books door ask ONE reader.
 * Harness reused from acc-176-books-grant.realstack.cjs (the same real network, grants, routes/books-grants and middleware/books-grant; only sign-in is a stand-in).
 * HAND-COMPUTED  firm P; clients M1 (AUDITOR grant to P), M2 (ADVISER grant to P), M3 (an auditor grant to a DIFFERENT firm S).
 *   SEC-117 (segregation of duties, merged into 1118v2): the accountant seat never opens an AUDITOR grant; W12's read-only rows stay off until Athi decides W12.
 *   staff of P (editor, whole entity = the accountant seat): practice lists M2 only (1), role adviser, not read only; the door refuses M1 (403): the list and the door agree.
 *   auditor-preset person of P: practice lists M1 only (1), read only false.   staff of S (accountant seat of ANOTHER firm, its grant M3 is an auditor grant): lists none, never M1 or M2.
 *   a viewer of P (no seat): practice 403, the door 403.   staff of P cannot set a check point on M1 (not theirs): refused.
 * Run: DATABASE_URL=postgres://cb_app:...@localhost:5432/<throwaway> node tests/s1-practice-w12.realstack.cjs   (a throwaway database only; never sit-au, never production)
 */
const url = process.env.DATABASE_URL || '';
const ALLOWED_HOSTS = /^(localhost|127.0.0.1)$/; /* throwaway local database only */
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
const RUN = 'a176' + (Date.now() % 1e10).toString(36).padStart(6, '0');
const madeIdentities = [];
const UUID0 = '00000000-0000-4000-8000-0000000000';
const label = (bridgeId) => String(bridgeId).replace(/[^A-Za-z0-9_]/g, '_');

/** a business: its identity and its network node, a root of its own */
async function business(tag, country, currency) {
  const bridgeId = 'CB' + RUN + tag;
  const { rows: [identity] } = await query(
    `INSERT INTO identities (bridge_id, display_name, identity_type, country, currency_code, user_id) VALUES ($1, $2, 'entity', $4, $5, $3) RETURNING identity_id`,
    [bridgeId, 'S1P ' + tag + ' ' + RUN, bridgeId.toLowerCase(), country || 'AU', currency || 'AUD']);
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

let base = '';
async function call(who, method, route, opts) {
  const o = opts || {};
  const headers = { 'content-type': 'application/json', 'x-test-as': JSON.stringify(who) };
  if (o.member) headers['x-books-for'] = o.member;
  const res = await fetch(base + route, { method, headers, body: o.body === undefined ? undefined : JSON.stringify(o.body) });
  let body = null;
  try { body = await res.json(); } catch (_) { body = null; }
  return { status: res.status, body };
}
const giveGrant = (G, firm, preset) => call(ownerOf(G), 'POST', '/api/books-grants', { body: { grantee: firm.id, purpose: 'audit of the books', consent: true, preset, posting: preset === 'adviser' ? 'owner_approves' : undefined } });
const idsOf = (r) => ((r.body && r.body.clients) || []).map((c) => String(c.entity_id)).sort();

async function main() {
  const P = await business('p'); const S = await business('s'); const M1 = await business('1'); const M2 = await business('2'); const M3 = await business('3');
  for (const M of [M1, M2, M3]) await join(M === M3 ? S : P, M);
  const app = express();
  app.use(express.json());
  const books = express.Router();
  books.use(booksGrant);
  books.get('/daybook', fakeAuth, (req, res) => res.json({ entity: fakeAuth.entityOf(req) }));
  app.use('/api/books', books);
  app.use('/api/books-grants', require(path.join(API, 'routes', 'books-grants.js')));
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  base = 'http://127.0.0.1:' + server.address().port;
  try {
    ok('grant M1 auditor to P', (await giveGrant(M1, P, 'auditor')).status === 201);
    ok('grant M2 adviser to P', (await giveGrant(M2, P, 'adviser')).status === 201);
    ok('grant M3 auditor to S', (await giveGrant(M3, S, 'auditor')).status === 201);
    const staff = staffOf(P, { whole_entity: true });
    const auditor = staffOf(P, AUDITOR);
    const viewer = staffOf(P, { access_level: 'viewer', whole_entity: false });
    const sStaff = staffOf(S, { whole_entity: true });
    let r = await call(staff, 'GET', '/api/books-grants/practice');
    /* GRANT-SEAT (20 Nov, Athi): the client's grant is the ceiling and the seat narrows within it, so a staff seat opens BOTH grants of its firm (the auditor one at the commenter level); the list and the door still ask the ONE reader */
    ok('staff seat: practice lists M1 and M2 (2 clients, the grant is the ceiling)', r.status === 200 && r.body.total === 2 && JSON.stringify(idsOf(r)) === JSON.stringify([M1.id, M2.id].sort()), JSON.stringify(r.body).slice(0, 300));
    const row = (id) => (r.body.clients || []).find((c) => String(c.entity_id) === id);
    ok('M1 row has the auditor role; M2 row not read only, role adviser', row(M1.id) && row(M1.id).grant.role === 'auditor' && row(M2.id) && row(M2.id).grant.read_only === false && row(M2.id).grant.role === 'adviser');
    ok('the door opens M1 for the same person (200): the list and the door agree', (await call(staff, 'GET', '/api/books/daybook', { member: M1.id })).status === 200);
    r = await call(auditor, 'GET', '/api/books-grants/practice');
    ok('auditor-preset person (reviewer seat): M1 and M2 (2), the grant is the ceiling', r.status === 200 && r.body.total === 2 && JSON.stringify(idsOf(r)) === JSON.stringify([M1.id, M2.id].sort()), JSON.stringify(r.body).slice(0, 200));
    ok('the door opens M2 for the auditor person (a read under the adviser grant: acc-176b #5)', (await call(auditor, 'GET', '/api/books/daybook', { member: M2.id })).status === 200);
    r = await call(sStaff, 'GET', '/api/books-grants/practice');
    ok('staff of another firm S: M3 only (its own grant), never M1 or M2', r.status === 200 && JSON.stringify(idsOf(r)) === JSON.stringify([M3.id]), JSON.stringify(r.body).slice(0, 200));
    ok('...and the door refuses S staff on M1', (await call(sStaff, 'GET', '/api/books/daybook', { member: M1.id })).status !== 200);
    r = await call(viewer, 'GET', '/api/books-grants/practice');
    ok('a person with no seat: practice 403', r.status === 403, JSON.stringify(r));
    const cp = await call(staff, 'POST', '/api/books-grants/practice/baseline', { body: { client: M3.id, seen_to: new Date().toISOString() } });
    ok('check point on M3 (a client of ANOTHER firm, not of this seat) refused', cp.status === 403 || cp.status === 404, JSON.stringify(cp).slice(0, 200));
  } finally {
    await new Promise((resolve) => server.close(resolve));
    for (const id of madeIdentities) { try { await query('DELETE FROM identities WHERE identity_id = $1', [id]); } catch (_) {} }
  }
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
