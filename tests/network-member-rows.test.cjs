/**
 * network-member-rows.test.cjs — WHAT THE SIMPLER NETWORK APP READS OFF GET /api/network-offers (NET-SRV1, 2026-10-14).
 *
 *   G1  a store sees the request it SENT to a brand whose catalogue it does not sell (before: only adoptions + invitations)
 *   G2  every row carries may/why — the server's rule (src/services/network.mayAct), never re-derived on a screen
 *   G3  the brand's and the network root's bridge ids, so the app links to the network store (GET /api/catalogue/network/:bridge_id)
 *
 * Run: node tests/network-member-rows.test.cjs   · no DB (the statements are answered by a stub), no network.
 */
'use strict';
const assert = require('assert'), path = require('path');
const API = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://u:p@127.0.0.1:5432/x';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

let pass = 0, fail = 0;
const tests = [];
const it = (name, fn) => tests.push([name, fn]);

/* the database first: every reader binds `query` when it loads, so the stub must be in place before them */
const db = require(path.join(API, 'db'));
let answer = () => ({ rows: [] });
db.query = async (sql, params) => answer(sql, params);
db.withEntity = async (_e, fn) => fn({ query: async (sql, params) => answer(sql, params) });

const membership = require(path.join(API, 'lib', 'network-membership.js'));
const ok = { ok: true, code: null, why: null };

/* ── G2 · the rule, pure ── */
it('⭐⭐ G2 a store that ASKED cannot approve its own request; the brand can — and each refusal carries a code and a sentence', () => {
  const asked = { state: 'requested', via: 'joined', edge_id: 'E', asked_by: 'store', parent_node: 'B', store_node: 'S', brand_node: 'B' };
  const store = membership.mayOn(asked, 'S');
  assert.strictEqual(store.approve.ok, false);
  assert.strictEqual(store.approve.code, 'NOT_ALLOWED');
  assert.ok(/^[A-Z].*\.$/.test(store.approve.why), 'the why is a sentence: ' + store.approve.why);
  assert.deepStrictEqual(store.decline, ok, 'either side may withdraw / decline');
  const brand = membership.mayOn(Object.assign({}, asked, { node_id: 'S' }), 'B');
  assert.deepStrictEqual(brand.approve, ok);
  assert.strictEqual(brand.suspend.code, 'BAD_STATE', 'a request is not yet a member to suspend');
});
it('⭐ G2 an invitation: the store accepts; the brand that invited waits', () => {
  const inv = { state: 'requested', via: 'joined', edge_id: 'E', asked_by: 'brand', parent_node: 'B', store_node: 'S', brand_node: 'B' };
  assert.deepStrictEqual(membership.mayOn(inv, 'S').approve, ok);
  assert.strictEqual(membership.mayOn(inv, 'B').approve.code, 'NOT_ALLOWED');
});
it('⭐ G2 only the network suspends or resumes; either side disconnects', () => {
  const act = { state: 'active', via: 'joined', edge_id: 'E', asked_by: 'store', parent_node: 'B', node_id: 'S' };
  assert.deepStrictEqual(membership.mayOn(act, 'B').suspend, ok);
  assert.strictEqual(membership.mayOn(act, 'S').suspend.code, 'NOT_ALLOWED');
  assert.strictEqual(membership.mayOn(act, 'B').resume.code, 'BAD_STATE');
  assert.deepStrictEqual(membership.mayOn(act, 'S').disconnect, ok);
  assert.deepStrictEqual(membership.mayOn(Object.assign({}, act, { state: 'suspended' }), 'B').resume, ok);
});
it('⭐ G2 no edge yet: the store may ask to join (even before it is on the tree); nothing else is offered', () => {
  const none = { state: 'none', via: null, edge_id: null, asked_by: null, parent_node: null, brand_node: 'B', store_node: null };
  const m = membership.mayOn(none, 'store-identity');
  assert.deepStrictEqual(m.request, ok);
  for (const op of ['approve', 'decline', 'suspend', 'resume', 'disconnect']) assert.strictEqual(m[op].code, 'NO_EDGE', op);
  assert.strictEqual(membership.mayOn({ state: 'active', via: 'built', edge_id: null }, 'S').request.code, 'BAD_STATE');
  assert.strictEqual(membership.mayOn(none, null).request.code, 'NO_ACTOR');
});
it('⚠️ G2 every op is answered on every row — the screen shows every action and greys the refused ones', () => {
  const m = membership.mayOn({}, 'X');
  assert.deepStrictEqual(Object.keys(m).sort(), ['approve', 'decline', 'disconnect', 'request', 'resume', 'suspend']);
  for (const k of Object.keys(m)) assert.ok(m[k].ok === true || (m[k].code && m[k].why), k + ' refused without a code and a sentence');
});

/* ── G1 + G3 · the route, with the database answered by a stub ── */
const STORE = '00000000-0000-0000-0000-00000000000a', BRAND = '00000000-0000-0000-0000-00000000000b';
function stubDb() {
  const seen = [];
  answer = (sql, params) => {
    seen.push(sql);
    if (/FROM catalogue_adoption/.test(sql)) return { rows: [] };                       // the store sells nothing of the brand's
    if (/JOIN cb_edge e ON e\.child_id = mc\.id/.test(sql)) return { rows: [{ brand_id: BRAND }] };   // …but it ASKED to join
    if (/FROM unnest\(\$2::uuid\[\]\) AS want/.test(sql)) {
      assert.deepStrictEqual(params[1], [BRAND], 'standing() is asked about the brand the store asked');
      return { rows: [{ brand_id: BRAND, brand_node: 'B', store_node: 'S', brand_bridge_id: 'cb-brand', root_bridge_id: 'cb-root',
                        tree_parent: null, built: false, tree_state: null, tree_edge: null, edge_id: 'E', edge_state: 'requested', asked_by: 'store' }] };
    }
    if (/AS owns/.test(sql)) return { rows: [{ owns: false, node: 'S', bridge_id: 'cb-store', root_bridge_id: 'cb-store' }] };
    return { rows: [] };
  };
  return { seen, restore: () => { answer = () => ({ rows: [] }); } };
}
async function getOffers() {
  const router = require(path.join(API, 'routes', 'network-offers.js'));
  const layer = router.stack.find((l) => l.route && l.route.path === '/' && l.route.methods.get);
  const handlers = layer.route.stack.map((s) => s.handle);
  const req = { identity: { identity_id: STORE }, headers: {}, id: 'test' };
  let body = null, status = 200;
  const res = { status(n) { status = n; return this; }, json(b) { body = b; return this; } };
  await handlers[handlers.length - 1](req, res);
  return { status, body };
}
it('⭐⭐ G1 a store sees the request it sent to a brand whose catalogue it does not sell — as "asked", not guessed', async () => {
  const s = stubDb();
  try {
    const { status, body } = await getOffers();
    assert.strictEqual(status, 200, JSON.stringify(body));
    const n = body.store.networks.find((x) => x.brand_id === BRAND);
    assert.ok(n, 'the brand the store asked is not listed');
    assert.strictEqual(n.membership.state, 'asked');
    assert.deepStrictEqual(n.offers, [], 'a store outside the network is told nothing of its offers');
    /* G2 on the store row: it asked, so it cannot approve; it may withdraw */
    assert.strictEqual(n.may.approve.code, 'NOT_ALLOWED');
    assert.strictEqual(n.may.decline.ok, true);
    /* G3 */
    assert.strictEqual(n.brand_bridge_id, 'cb-brand');
    assert.strictEqual(n.root_bridge_id, 'cb-root');
    assert.strictEqual(body.brand.bridge_id, 'cb-store');
    assert.strictEqual(body.brand.root_bridge_id, 'cb-store');
  } finally { s.restore(); }
});
it('⚠️ G1 the edge read lists asked, active and suspended edges — not only invitations', () => {
  const src = require('fs').readFileSync(path.join(API, 'routes', 'network-offers.js'), 'utf8');
  assert.ok(/e\.state IN \('requested', 'active', 'suspended'\)/.test(src));
  assert.ok(!/e\.requested_by = e\.parent_id/.test(src), 'the read is still limited to invitations');
});

(async () => {
  for (const [name, fn] of tests) {
    try { await fn(); pass++; console.log('  ok  ' + name); }
    catch (e) { fail++; console.log('  FAIL ' + name + '\n      ' + (e && e.message)); }
  }
  console.log('\n' + (fail ? '✗ ' + fail + ' failed · ' : '✓ ') + pass + ' passed');
  process.exit(fail ? 1 : 0);
})();
