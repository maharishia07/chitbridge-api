/**
 * tests/send-suspended.test.cjs — A SUSPENDED MEMBER'S SEND IS REFUSED IN WORDS (NET-7, 2026-10-24).
 *
 * chits/send never asked the edge standing: a store its brand had SUSPENDED could still send it an order. The step sendSuspended
 * (routes/chits.js) now asks lib/network-membership.suspendedWith, which reads the ONE standing() statement the network routes use.
 * Refused: 403 MEMBERSHIP_SUSPENDED, in words, before any copy is written. Allowed: an active member, a receiver with no edge, a
 * draft, a self-chit. Offline: db, auth and the deliverer stubbed (tests/support/route-golden.cjs), no network.
 *
 * Run: node tests/send-suspended.test.cjs
 */
'use strict';
const assert = require('assert'), path = require('path');
const G = require('./support/route-golden.cjs');
const API = G.API;

const SHOP = '11111111-1111-4111-8111-111111111111', BRAND = '22222222-2222-4222-8222-222222222222';
const ROWS = {
  [SHOP]: { identity_id: SHOP, bridge_id: 'CBSHOP0001', display_name: 'Mayur Traders', country: 'IN', currency_code: 'INR', policy_flags: {}, status: 'active', user_id: 'mayur' },
  [BRAND]: { identity_id: BRAND, bridge_id: 'CBBRND0001', display_name: 'Chola Brand', country: 'IN', currency_code: 'INR', policy_flags: {}, status: 'active', user_id: 'chola' }
};
/* STANDING_SQL answers one row per brand asked: a joined edge in ctx.state, or no edge at all */
function rows(s, p, ctx) {
  if (/WITH s AS \(SELECT c\.id, c\.path FROM identities/.test(s)) {
    return ctx.state ? [{ brand_id: BRAND, built: false, edge_id: 'EDGE-1', edge_state: ctx.state, asked_by: 'brand', brand_node: 'N-B', store_node: 'N-S' }] : [{ brand_id: BRAND, built: false, edge_id: null }];
  }
  if (/to_regprocedure\('chit_deliver/.test(s)) return [{ ok: true }];
  if (/SELECT country, currency_code, timezone FROM identities/.test(s)) return [{ country: 'IN', currency_code: 'INR', timezone: null }];
  if (/SELECT self_copy_pref, currency_code FROM identities/.test(s)) return [{ self_copy_pref: null, currency_code: 'INR' }];
  if (/FROM identities/.test(s) && /identity_id = \$1/.test(s) && !/status = 'active'/.test(s)) { const r = ROWS[p[0]]; return r ? [r] : []; }
  if (/SELECT bridge_id, display_name FROM identities WHERE identity_id = \$1/.test(s)) { const r = ROWS[p[0]]; return r ? [{ bridge_id: r.bridge_id, display_name: r.display_name }] : []; }
  if (/FROM identities/.test(s) && /identity_id = \$1/.test(s)) { const r = ROWS[p[0]]; return r ? [r] : []; }
  return [];
}
const h = G.harness({ rows, known: { [SHOP]: 'SHOP', [BRAND]: 'BRAND' } });
const mint = require(path.join(API, 'lib', 'mint'));
let delivered = 0;
mint.deliver = async () => { delivered++; return { ok: true }; };
require(path.join(API, 'lib', 'books-hooks')).afterChit = () => Promise.resolve({});
require(path.join(API, 'lib', 'meter')).meter = async () => {};
require(path.join(API, 'lib', 'tax-shelf')).readShelf = async () => null;
require(path.join(API, 'lib', 'stock-from-chit')).postFor = async () => ({ failed: [], skipped: [] });
require(path.join(API, 'lib', 'events')).notifyAfter = () => {};
const app = h.app('/api/chits', require(path.join(API, 'routes', 'chits')));
const ME = { identity_id: SHOP, identity_type: 'entity', bridge_id: 'CBSHOP0001', display_name: 'Mayur Traders' };
const LINES = [{ particulars: 'Brake pad', quantity: 2, unit: 'piece', price: 59, total: 118 }];
const order = (extra) => Object.assign({ purpose: 'order', manual_subject: 'Brake pads', recipients: [{ entity_id: BRAND, role: 'to' }], line_items: LINES }, extra || {});
const standingAsked = (r) => r.calls.filter((c) => /WITH s AS \(SELECT c\.id, c\.path FROM identities/.test(c.sql)).length;

let pass = 0, fail = 0;
const it = async (name, fn) => { try { await fn(); pass++; console.log('  ok  ' + name); } catch (e) { fail++; console.log('  XX  ' + name + ' — ' + e.message); } };
const send = (body, ctx) => h.run(app, { url: '/api/chits/send', body, identity: ME, ctx: ctx || {} });

(async () => {
  console.log('\nsend · a suspended member is refused, in words, before anything is written');
  await it('a SUSPENDED edge: 403 MEMBERSHIP_SUSPENDED, in words, no copy delivered, the one standing statement asked once', async () => {
    delivered = 0;
    const r = await send(order(), { state: 'suspended' });
    assert.strictEqual(r.status, 403, JSON.stringify(r.body));
    const text = JSON.stringify(r.body);
    assert.ok(/MEMBERSHIP_SUSPENDED/.test(text) && /suspended your membership/.test(text) && /Ask the network to resume/.test(text), text);
    assert.ok(!/Chola|CBBRND|2222/.test(text), 'echoes a value: ' + text);
    assert.strictEqual(delivered, 0);
    assert.strictEqual(standingAsked(r), 1);
    assert.ok(!r.calls.some((c) => /INSERT INTO chit_header/i.test(c.sql || '')), 'something was written');
  });
  await it('an ACTIVE edge is not refused', async () => {
    const r = await send(order(), { state: 'active' });
    assert.ok(!/MEMBERSHIP_SUSPENDED/.test(JSON.stringify(r.body)), JSON.stringify(r.body));
    assert.strictEqual(standingAsked(r), 1);
  });
  await it('NO edge (a non-network counterparty) is not refused', async () => {
    const r = await send(order(), {});
    assert.ok(!/MEMBERSHIP_SUSPENDED/.test(JSON.stringify(r.body)), JSON.stringify(r.body));
  });
  await it('a DRAFT to the brand is kept (nothing is sent), and a self-chit asks nothing', async () => {
    const d = await send(order({ is_draft: true }), { state: 'suspended' });
    assert.ok(!/MEMBERSHIP_SUSPENDED/.test(JSON.stringify(d.body)) && standingAsked(d) === 0);
    const s = await send(order({ purpose: 'general', recipients: [{ self: true }] }), { state: 'suspended' });
    assert.ok(!/MEMBERSHIP_SUSPENDED/.test(JSON.stringify(s.body)) && standingAsked(s) === 0);
  });
  await it('a failed network read answers 503 in words, never a silent pass', async () => {
    const nm = require(path.join(API, 'lib', 'network-membership')), real = nm.suspendedWith;
    nm.suspendedWith = async () => { const e = new Error('We could not read who is in the network just now. Nothing was changed.'); e.code = 'NETWORK_READ_FAILED'; throw e; };
    try { const r = await send(order(), {}); assert.strictEqual(r.status, 503, JSON.stringify(r.body)); assert.ok(/NETWORK_READ_FAILED/.test(JSON.stringify(r.body)), JSON.stringify(r.body)); }
    finally { nm.suspendedWith = real; }
  });
  console.log('\n  ' + pass + ' passed, ' + fail + ' failed\n  ' + pass + ' checks');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
