/**
 * network-member-view.test.cjs — THE NETWORK ANSWERS WHAT THE SIMPLER NETWORK APP NEEDS (NET-SRV1, 2026-10-14).
 *
 *   G1  a store sees a request it SENT to a brand whose catalogue it does not sell (it was in neither the adoption list nor the
 *       invitation list, so the store could not see its own asking)
 *   G2  every membership row — the store's networks and the brand's members — carries may/why per action; the server decides from
 *       the one rule table the POST routes refuse with (src/services/network.mayAct), the screen greys a refused action with its why
 *   G3  a store's row names the brand's bridge id and its network ROOT's bridge id — the address of the network store
 *
 * Run: node tests/network-member-view.test.cjs   · no DB (tests/support/network-stub.cjs), no network.
 */
'use strict';
const assert = require('assert'), path = require('path');
const API = path.join(__dirname, '..');
const S = require('./support/network-stub.cjs');
const membership = require(path.join(API, 'lib', 'network-membership.js'));
const { mayAct } = require(path.join(API, 'src', 'services', 'network.js'));

let pass = 0, fail = 0;
const tests = [];
const it = (name, fn) => tests.push([name, fn]);
const ACTS = ['request', 'approve', 'decline', 'suspend', 'resume', 'disconnect'];
const shaped = (may) => ACTS.every((k) => may && may[k] && typeof may[k].ok === 'boolean' && (may[k].ok ? may[k].why === null : typeof may[k].why === 'string' && may[k].why.length > 0));

/* ── G2, the pure half: mayOf says what mayAct would, per state ── */
it('⭐⭐ G2 · a store that ASKED cannot approve its own request — with the sentence the POST would refuse with — but may withdraw it (decline)', () => {
  const m = membership.mayOf({ state: 'requested', asked_by: 'store', brand_node: 'P', node_id: 'C' }, 'store');
  assert.ok(shaped(m));
  assert.strictEqual(m.approve.ok, false);
  assert.strictEqual(m.approve.why, mayAct('approve', { edge: { parent_id: 'P', child_id: 'C', requested_by: 'C' }, actorId: 'C' }));
  assert.strictEqual(m.decline.ok, true);
  assert.strictEqual(m.request.ok, false, 'asking twice');
});
it('⭐⭐ G2 · the brand approves the store that asked; the store accepts the brand that invited', () => {
  assert.strictEqual(membership.mayOf({ state: 'requested', asked_by: 'store', brand_node: 'P', node_id: 'C' }, 'brand').approve.ok, true);
  assert.strictEqual(membership.mayOf({ state: 'requested', asked_by: 'brand', brand_node: 'P', node_id: 'C' }, 'store').approve.ok, true);
  assert.strictEqual(membership.mayOf({ state: 'requested', asked_by: 'brand', brand_node: 'P', node_id: 'C' }, 'brand').approve.ok, false, 'the brand approved its own invitation');
});
it('⭐ G2 · in: only the network pauses or resumes; either side may leave; nothing to answer', () => {
  const store = membership.mayOf({ state: 'active', brand_node: 'P', node_id: 'C' }, 'store'), brand = membership.mayOf({ state: 'active', brand_node: 'P', node_id: 'C' }, 'brand');
  assert.strictEqual(store.suspend.ok, false); assert.strictEqual(store.suspend.why, mayAct('suspend', { edge: { parent_id: 'P', child_id: 'C' }, actorId: 'C' }));
  assert.strictEqual(brand.suspend.ok, true);
  assert.strictEqual(store.disconnect.ok, true); assert.strictEqual(brand.disconnect.ok, true);
  assert.strictEqual(store.approve.ok, false); assert.strictEqual(store.request.ok, false); assert.strictEqual(store.resume.ok, false);
  const paused = membership.mayOf({ state: 'suspended', brand_node: 'P', node_id: 'C' }, 'brand');
  assert.strictEqual(paused.resume.ok, true); assert.strictEqual(paused.suspend.ok, false);
  assert.strictEqual(membership.mayOf({ state: 'suspended', brand_node: 'P', node_id: 'C' }, 'store').resume.ok, false);
});
it('⭐ G2 · not yet connected: the store may ask, nothing else applies — a store with no node yet may still ask', () => {
  const m = membership.mayOf({ state: 'none', brand_node: 'P', node_id: null }, 'store');
  assert.ok(shaped(m));
  assert.strictEqual(m.request.ok, true);
  for (const k of ['approve', 'decline', 'suspend', 'resume', 'disconnect']) assert.strictEqual(m[k].ok, false, k);
  assert.ok(shaped(membership.mayOf(null, 'store')), 'an absent standing still answers every action');
});

/* ── the route, over the stub ── */
it('⭐⭐ G1 · the store sees the brand it ASKED to join without selling its catalogue — as "asked", with the brand that invited it and the paused one', async () => {
  S.as({});
  const r = await S.get('/api/network-offers');
  assert.strictEqual(r.status, 200);
  const by = {}; r.body.store.networks.forEach((n) => { by[n.brand_id] = n; });
  assert.deepStrictEqual(Object.keys(by).sort(), [S.A, S.B, S.C, S.D], 'four standings, four rows');
  assert.strictEqual(by[S.B].membership.state, 'asked');
  assert.strictEqual(by[S.B].membership.edge_id, 'e-b');
  assert.strictEqual(by[S.B].brand_name, 'Bharat Mills');
  assert.deepStrictEqual(by[S.B].offers, [], 'a store outside the network is told nothing of its offers');
  assert.strictEqual(by[S.C].membership.state, 'invited');
  assert.strictEqual(by[S.D].membership.state, 'suspended');
  assert.strictEqual(by[S.A].membership.state, 'active');
  assert.strictEqual(by[S.A].membership.via, 'built');
  assert.strictEqual(by[S.A].offers.length, 1, 'the brand it is IN releases to it');
  assert.strictEqual(by[S.A].offers[0].applies, true);
});
it('⭐⭐ G2 · every network row carries may/why — the store that asked may not approve (the server says why), the invited store may', async () => {
  S.as({});
  const r = await S.get('/api/network-offers');
  const by = {}; r.body.store.networks.forEach((n) => { by[n.brand_id] = n; });
  for (const id of [S.A, S.B, S.C, S.D]) assert.ok(shaped(by[id].may), id + ' is missing an action or a why');
  assert.strictEqual(by[S.B].may.approve.ok, false);
  assert.strictEqual(by[S.B].may.approve.why, 'the other business has to accept this — you asked');
  assert.strictEqual(by[S.B].may.decline.ok, true);
  assert.strictEqual(by[S.C].may.approve.ok, true);
  assert.strictEqual(by[S.C].may.decline.ok, true);
  assert.strictEqual(by[S.A].may.disconnect.ok, true);
  assert.strictEqual(by[S.A].may.suspend.ok, false);
  assert.strictEqual(by[S.D].may.resume.ok, false);
  assert.strictEqual(by[S.D].may.resume.why, 'only the network can suspend or resume a member');
  assert.strictEqual(by[S.D].may.disconnect.ok, true);
});
it('⭐⭐ G2 · the brand half: each member row carries may/why — approve the store that asked, pause the one that is in', async () => {
  S.as({ identity_id: S.A, display_name: 'Apex' });
  const r = await S.get('/api/network-offers');
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.brand.is_brand, true);
  const by = {}; r.body.brand.members.forEach((m) => { by[m.id] = m; });
  assert.ok(shaped(by[S.STORE].may) && shaped(by[S.STORE2].may));
  assert.strictEqual(by[S.STORE2].state, 'requested'); assert.strictEqual(by[S.STORE2].asked_by, 'store');
  assert.strictEqual(by[S.STORE2].may.approve.ok, true);
  assert.strictEqual(by[S.STORE2].may.decline.ok, true);
  assert.strictEqual(by[S.STORE].may.suspend.ok, true);
  assert.strictEqual(by[S.STORE].may.approve.ok, false);
  assert.strictEqual(r.body.brand.stores, 1, 'only the store that is IN counts');
  assert.strictEqual(r.body.store.networks.length, 0, 'the brand sells for nobody');
});
it('⭐⭐ G3 · a store row names the brand\'s bridge id and its network ROOT\'s — brand-b sits under a root of its own, so the store links there', async () => {
  S.as({});
  const r = await S.get('/api/network-offers');
  const by = {}; r.body.store.networks.forEach((n) => { by[n.brand_id] = n; });
  assert.strictEqual(by[S.A].brand_bridge_id, 'CB-BRAND-A'); assert.strictEqual(by[S.A].root_bridge_id, 'CB-BRAND-A');
  assert.strictEqual(by[S.B].brand_bridge_id, 'CB-BRAND-B'); assert.strictEqual(by[S.B].root_bridge_id, 'CB-ROOT-X');
  assert.strictEqual(by[S.C].root_bridge_id, 'CB-BRAND-C');
  /* the one statement reads the root off cb_entity by its path, never off the label (dashes are mangled there) */
  const st = S.LOG.statements.find((s) => /^WITH s AS \(SELECT c\.id, c\.path FROM identities i JOIN cb_entity c/.test(s));
  assert.ok(st && /subpath\(bc\.path, 0, 1\)/.test(st) && /AS root_bridge_id/.test(st) && /AS brand_bridge_id/.test(st), 'standing() does not carry the bridge ids');
});
it('⚠️ the edge read admits every commercial edge of mine — requested, active, suspended — whoever asked (not only invitations)', async () => {
  const st = S.LOG.statements.find((s) => /AS brand_id, e\.id::text AS edge_id, e\.state,/.test(s));
  assert.ok(st, 'edgesOf never ran');
  assert.ok(/e\.state IN \('requested', 'active', 'suspended'\)/.test(st), 'a paused or active joined membership is not read');
  assert.ok(!/e\.requested_by = e\.parent_id\b(?!.*CASE)/.test(st.replace(/CASE WHEN[\s\S]*?END AS asked_by/, '')), 'still filtered to invitations');
});
it('⚠️ a co-assist is told it may not design (unchanged); a counter key is refused in words (403)', async () => {
  S.as({ identity_id: 'co-1', parent_entity_id: S.STORE, display_name: 'Asha' });
  const r = await S.get('/api/network-offers');
  assert.strictEqual(r.status, 200); assert.strictEqual(r.body.may_design.ok, false); assert.ok(r.body.may_design.why);
  assert.strictEqual(r.body.store.networks.length, 4, 'the co-assist sees the business\'s networks');
  S.as({}, true);
  const k = await S.get('/api/network-offers');
  assert.strictEqual(k.status, 403); assert.ok(/signed-in person/.test(k.body.message));
  S.as({});
});
it('⭐ the round trips did not grow: the edge read is ONE statement, the standing ONE, may/why none', async () => {
  S.LOG.statements.length = 0;
  S.as({});
  await S.get('/api/network-offers');
  const edges = S.LOG.statements.filter((s) => /AS brand_id, e\.id::text AS edge_id, e\.state,/.test(s)).length;
  const standing = S.LOG.statements.filter((s) => /^WITH s AS \(SELECT c\.id, c\.path/.test(s)).length;
  assert.strictEqual(edges, 1); assert.strictEqual(standing, 1);
  assert.ok(!S.LOG.statements.some((s) => /cb_edge/.test(s) && !/AS brand_id, e\.id::text AS edge_id|^WITH s AS|^WITH b AS|unnest/.test(s)), 'a second edge read appeared');
});

(async () => {
  await S.start();
  try {
    for (const [name, fn] of tests) {
      try { await fn(); pass++; console.log('  ok  ' + name); }
      catch (e) { fail++; console.log('  FAIL ' + name + '\n      ' + (e && e.message)); }
    }
  } finally { S.stop(); }
  console.log('\n' + (fail ? '✗ ' + fail + ' failed, ' : '✓ ') + pass + ' passed · ' + (pass + fail) + ' checks\n');
  process.exit(fail ? 1 : 0);
})();
