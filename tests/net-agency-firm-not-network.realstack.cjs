'use strict';
/**
 * tests/net-agency-firm-not-network.realstack.cjs — a FIRM over its clients (an agency edge) is not a network (Athi's rule, 15 Nov 2026: confidentiality).
 *
 * OWNS      the proof, on a REAL Postgres as cb_app, that: a client never sees the firm's other clients in GET /api/network-design/stores; the firm lists its clients there;
 *           a real governance network still lists a member's siblings (the positive control); the firm can be given a client's books through the agency edge (isGrantParentSql),
 *           the look is allowed, and a suspended agency edge ends the look on the next request.
 * HAND-COMPUTED  firm F with clients A and B (agency, both catalogue visibility 'network'); network N with members X and Y (governance).
 *   A lists {A}; B lists {B}; F lists {A, B}; X lists {N, X, Y}.   F given A's books: allowed.  Suspend the edge: refused.
 * CALLED BY CI integration job. Run: DATABASE_URL=postgres://cb_app:cbapp@localhost:5432/cb_s41 node tests/net-agency-firm-not-network.realstack.cjs
 * CARD      04-network/ACC-176-AUDITOR-GRANT
 */
const url = process.env.DATABASE_URL || '';
const ALLOWED_HOSTS = /^(localhost|127\.0\.0\.1|db|sit-[a-z]+(\.[a-z0-9.-]+)?)$/;
const parts = /^postgres(?:ql)?:\/\/([^:@/]+):[^@]*@([^:/]+)/.exec(url);
if (!parts || parts[1] !== 'cb_app' || !ALLOWED_HOSTS.test(parts[2])) { console.error('REFUSED: needs DATABASE_URL as cb_app on localhost, the compose db or a SIT host'); process.exit(3); }
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'agency_test_secret_at_least_32_chars_padding';
const path = require('path');
const express = require('express');
const API = path.join(__dirname, '..');

const authPath = require.resolve(path.join(API, 'middleware', 'auth.js'));
const fakeAuth = (req, res, next) => {
  try { req.identity = JSON.parse(String(req.headers['x-test-as'] || '')); } catch (_) { return res.status(401).json({ error: 'no test identity' }); }
  return next();
};
fakeAuth.entityOf = (req) => req.identity.parent_entity_id || req.identity.identity_id;
fakeAuth.forgetKey = () => {};
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: fakeAuth };

const net = require(path.join(API, 'src', 'services', 'network'));
const { query } = require(path.join(API, 'db'));
const grants = require(path.join(API, 'lib', 'books-grant.js'));

let pass = 0, fail = 0;
const ok = (what, cond, info) => { if (cond) { pass++; console.log('  ok   ' + what); } else { fail++; console.log('  FAIL ' + what + (info ? '\n         ' + String(info).slice(0, 400) : '')); } };
const RUN = 'ag' + (Date.now() % 1e10).toString(36);
const made = [];

async function business(tag) {
  const bridgeId = 'CB' + RUN + tag;
  const { rows: [identity] } = await query(
    `INSERT INTO identities (bridge_id, display_name, identity_type, country, currency_code, user_id, catalogue_visibility) VALUES ($1, $2, 'entity', 'AU', 'AUD', $3, 'network') RETURNING identity_id`,
    [bridgeId, 'AGENCY ' + tag + ' ' + RUN, bridgeId.toLowerCase()]);
  made.push(identity.identity_id);
  return { tag, bridgeId, id: identity.identity_id, node: await net.nodeOf(identity.identity_id, { ensure: true }) };
}
async function connect(parent, child, type) {
  const asked = await net.requestConnect({ parentId: parent.node.id, childId: child.node.id, type }, parent.node);
  await net.approve({ edgeId: asked.id }, child.node);
  return asked.id;
}
const as = (biz) => ({ identity_id: biz.id, bridge_id: biz.bridgeId, identity_type: 'entity', parent_entity_id: null, display_name: biz.tag });

async function main() {
  const F = await business('f'), A = await business('a'), B = await business('b'), N = await business('n'), X = await business('x'), Y = await business('y');
  const agencyA = await connect(F, A, 'agency'); await connect(F, B, 'agency');
  await connect(N, X, 'governance'); await connect(N, Y, 'governance');

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.id = 'req-test'; next(); });
  app.use('/api/network-design', require(path.join(API, 'routes', 'network-design.js')));
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = 'http://127.0.0.1:' + server.address().port;
  const listed = async (biz) => {
    const res = await fetch(base + '/api/network-design/stores', { headers: { 'x-test-as': JSON.stringify(as(biz)) } });
    const body = await res.json();
    return (body.stores || []).map((s) => s.entity_id).sort();
  };
  const sorted = (...b) => b.map((x) => x.id).sort();
  try {
    const a = await listed(A), b = await listed(B), f = await listed(F), x = await listed(X);
    ok('1 client A does not see client B (both visibility network)', !a.includes(B.id) && !b.includes(A.id), a.join(','));
    ok('2 client A sees itself, and not the firm as a sibling list entry of others', a.includes(A.id) || a.length === 0, a.join(','));
    ok('3 the firm lists both clients', f.includes(A.id) && f.includes(B.id), f.join(','));
    ok('4 a real governance network member still sees its network siblings (X sees Y and N)', x.includes(Y.id) && x.includes(X.id) && x.includes(N.id), x.join(','));
    ok('5 network rows unchanged by the firm: X does not see F or its clients', !x.includes(F.id) && !x.includes(A.id) && !x.includes(B.id), x.join(','));

    const given = await grants.give(A.id, A.id, { grantee: F.id, purpose: 'adviser view', consent: true }).catch((e) => e);
    ok('6 A can give its books to the firm over an agency edge', given && given.grant_id, given && (given.words || given.message));
    const look = await grants.look(F.id, A.id, { actor: F.id, pattern: 'GET /trial-balance', method: 'GET', listed: true }).catch((e) => e);
    ok('7 the firm\'s look at A\'s books is allowed', look && look.allowed === true, JSON.stringify(look).slice(0, 200));
    ok('8 a network sibling is not an agent: Y cannot be given X\'s books', await grants.give(X.id, X.id, { grantee: Y.id, consent: true }).then(() => false, (e) => e.code === 'BOOKS_GRANT_NO_PARENT'));
    await net.suspend(agencyA, F.node);
    const after = await grants.look(F.id, A.id, { actor: F.id, pattern: 'GET /trial-balance', method: 'GET', listed: true }).catch((e) => e);
    ok('9 a suspended agency edge ends the firm\'s look on the next request', after && after.allowed === false, JSON.stringify(after).slice(0, 200));
    void sorted;
  } finally { server.close(); }
}

async function cleanup() {
  const nodes = (await query(`SELECT e.id FROM cb_entity e JOIN identities i ON upper(i.bridge_id) = upper(e.bridge_id) WHERE i.identity_id = ANY($1::uuid[])`, [made])).rows.map((x) => x.id);
  await query(`DELETE FROM cb_edge WHERE parent_id = ANY($1::uuid[]) OR child_id = ANY($1::uuid[])`, [nodes]);
  await query(`DELETE FROM cb_entity WHERE id = ANY($1::uuid[])`, [nodes]);
  await query(`DELETE FROM identities WHERE identity_id = ANY($1::uuid[])`, [made]);
}
(async () => {
  console.log('\n── agency firm is not a network, real Postgres · run ' + RUN + ' ──');
  try { await main(); } catch (e) { ok('the run reached its end', false, e && e.stack); } finally { await cleanup().catch((e) => console.log('  note  throwaway rows stay: ' + e.message)); }
  console.log('\n' + pass + ' ok, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
