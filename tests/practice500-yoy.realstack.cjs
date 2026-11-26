'use strict';
/**
 * tests/practice500-yoy.realstack.cjs — practice500 (26 Nov 2026) on a REAL Postgres as cb_app (RLS on): GET /api/books-grants/practice answered 500 for every firm whose clients have books on,
 * because the year-on-year statement (one per client, inlined by db.queryAsEach) held a ';' in a SQL comment.
 * HAND-COMPUTED  firm P with 3 clients M1, M2, M3, each with books on (fy start month 7, AUD, AU) and a live grant (auditor, adviser, auditor):
 *   practice answers 200 with total 3 and one row per client; each row carries the year-on-year dates (sales_yoy_from set: the statement RAN, an unasked one leaves null).
 *   M2's owner revokes the grant: practice answers total 2 = M1, M3 (the revoked client drops out of the list).
 * Harness: s1-practice-w12.realstack.cjs (real network, grants, routes; only sign-in is a stand-in).
 * Run: DATABASE_URL=postgres://cb_app:...@localhost:5432/<throwaway> node tests/practice500-yoy.realstack.cjs   (a throwaway database only; never production)
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
const RUN = 'p500' + (Date.now() % 1e10).toString(36).padStart(6, '0');
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
  const P = await business('p'); const M1 = await business('1'); const M2 = await business('2'); const M3 = await business('3');
  for (const M of [M1, M2, M3]) await join(P, M);
  for (const M of [M1, M2, M3]) await withEntity(M.id, (h) => h.query("INSERT INTO books_setting (entity_id, enabled, fy_start_month, functional_currency, country, enabled_at) VALUES ($1, true, 7, 'AUD', 'AU', now())", [M.id]));
  const app = express();
  app.use(express.json());
  app.use('/api/books-grants', require(path.join(API, 'routes', 'books-grants.js')));
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  base = 'http://127.0.0.1:' + server.address().port;
  try {
    const g1 = await giveGrant(M1, P, 'auditor'), g2 = await giveGrant(M2, P, 'adviser'), g3 = await giveGrant(M3, P, 'auditor');
    ok('three grants given (201)', g1.status === 201 && g2.status === 201 && g3.status === 201, JSON.stringify([g1, g2, g3]).slice(0, 300));
    const staff = staffOf(P, { whole_entity: true });
    let r = await call(staff, 'GET', '/api/books-grants/practice');
    ok('practice answers 200, not 500', r.status === 200, JSON.stringify(r.body).slice(0, 300));
    ok('3 clients live: total 3, the three ids', r.body && r.body.total === 3 && JSON.stringify(idsOf(r)) === JSON.stringify([M1.id, M2.id, M3.id].sort()), JSON.stringify(r.body).slice(0, 300));
    ok('every row ran the year-on-year statement (its dates are set)', ((r.body && r.body.clients) || []).length === 3 && r.body.clients.every((c) => c.health && c.health.sales_yoy_from), JSON.stringify((r.body.clients || []).map((c) => c.health && c.health.sales_yoy_from)));
    const revoked = await call(ownerOf(M2), 'POST', '/api/books-grants/' + (g2.body && (g2.body.id || g2.body.grant_id)) + '/revoke', { body: {} });
    ok('M2 revokes its grant (200)', revoked.status === 200, JSON.stringify(revoked).slice(0, 300));
    r = await call(staff, 'GET', '/api/books-grants/practice');
    ok('after the revoke: total 2 = M1 and M3, M2 is gone', r.status === 200 && r.body.total === 2 && JSON.stringify(idsOf(r)) === JSON.stringify([M1.id, M3.id].sort()), JSON.stringify(r.body).slice(0, 300));
  } finally {
    await new Promise((resolve) => server.close(resolve));
    for (const id of madeIdentities) { try { await query('DELETE FROM books_setting WHERE entity_id = $1', [id]); await query('DELETE FROM identities WHERE identity_id = $1', [id]); } catch (_) {} }
  }
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
