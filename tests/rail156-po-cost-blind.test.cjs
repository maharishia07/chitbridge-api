/**
 * tests/rail156-po-cost-blind.test.cjs — RAIL-156: a cost-blind co-assist cannot SEND a priced chit that is the shop's spend (a purchase order, a supplier bill).
 *
 * OWNS      the proof, on every path a chit takes out of a blind sender's hands, that a figure he sends on a BUY-side chit is the same 403 COST_BLIND a goods receipt gets (lib/cost-write
 *           carryFromSource, options.cost), nothing delivered: a PO to a listed supplier (price · total · a unit_cost · the PO's own goods), an invoice to a supplier, a supplier bill
 *           (receipt with their bill's total), the receipt itself; that a quantity-only PO still goes (200, answer pruned); that a SALE order to a customer, the owner and a
 *           cost-allowed actor send what they sent before; that a repeat-supply run (the owner's loopback token), the connector move-in (owner-only routes) and a crossing (mint.deliver is
 *           never reached) cannot carry a blind figure either. The sender's side is lib/cost-view costSideOf from the sender's own lists, never a second predicate.
 * CALLED BY scripts/guards.cjs · CI. No database, no network: the real routes/chits.js over the route-golden stand-ins (as tests/rail146c-receipt-carry.test.cjs).
 * FLOW      scene (who · the recipient's role on the sender's lists) → real POST /send → status, whether mint.deliver was reached, the lines handed to it
 * CARD      01-rail-core-the-chit/chits-routes
 *
 * Run: node tests/rail156-po-cost-blind.test.cjs
 */
'use strict';
const assert = require('assert'), path = require('path'), fs = require('fs');
const G = require('./support/route-golden.cjs');
const API = G.API;

const SHOP = '11111111-1111-4111-8111-111111111111', SUPPLIER = '22222222-2222-4222-8222-222222222222', CUSTOMER = '33333333-3333-4333-8333-333333333333';
const BOTH = '77777777-7777-4777-8777-777777777777', STRANGER = '44444444-4444-4444-8444-444444444444', BLIND_ID = '55555555-5555-4555-8555-555555555555', GRANTED_ID = '66666666-6666-4666-8666-666666666666';
const TRIED = 9797.25;
const row = (id, name, bridge) => ({ identity_id: id, bridge_id: bridge, display_name: name, country: 'IN', currency_code: 'INR', policy_flags: {}, status: 'active', user_id: name });
const ROWS = { [SHOP]: row(SHOP, 'Mayur Traders', 'CBSHOP0001'), [SUPPLIER]: row(SUPPLIER, 'Rice Mill', 'CBMILL0001'), [CUSTOMER]: row(CUSTOMER, 'Venkat', 'CBCUST0001'), [STRANGER]: row(STRANGER, 'Nobody', 'CBNONE0001'), [BOTH]: row(BOTH, 'Partner', 'CBBOTH0001') };
const OWNER = { identity_id: SHOP, identity_type: 'entity', bridge_id: 'CBSHOP0001', display_name: 'Mayur Traders' };
const BLIND = { identity_id: BLIND_ID, identity_type: 'actor', access_level: 'editor', parent_entity_id: SHOP, hat: 'manager', bridge_id: 'CBSHOP0001', display_name: 'Blind' };
const GRANTED = Object.assign({}, BLIND, { identity_id: GRANTED_ID, display_name: 'Granted' });
const ROLE_OF = { [SUPPLIER]: 'supplier', [CUSTOMER]: 'customer', [BOTH]: 'supplier' };
const BOTH_ROLE = { customer: true, supplier: true };
/* the unnest stand-in answers one role per id; BOTH is customer AND supplier */
let delivered = [];
function rows(s, p) {
  if (/FROM unnest\(\$2::uuid\[\]\)/.test(s)) return p[1].map((id) => ({ id, customer: ROLE_OF[id] === 'customer' || id === BOTH, supplier: ROLE_OF[id] === 'supplier' }));
  if (/WITH s AS \(SELECT c\.id, c\.path FROM identities/.test(s)) return [{ brand_id: SUPPLIER, built: false, edge_id: null }];
  if (/to_regprocedure\('chit_deliver/.test(s)) return [{ ok: true }];
  if (/can_see_costs FROM identities/.test(s)) return [{ can_see_costs: p[0] === GRANTED_ID }];
  if (/SELECT country, currency_code, timezone FROM identities/.test(s)) return [{ country: 'IN', currency_code: 'INR', timezone: null }];
  if (/SELECT self_copy_pref, currency_code FROM identities/.test(s)) return [{ self_copy_pref: null, currency_code: 'INR' }];
  if (/FROM identities/.test(s) && /identity_id = \$1/.test(s)) { const r = ROWS[p[0]]; return r ? [r] : []; }
  return [];
}
const h = G.harness({ rows, known: { [SHOP]: 'SHOP', [SUPPLIER]: 'SUPPLIER', [CUSTOMER]: 'CUSTOMER' } });
const mint = require(path.join(API, 'lib', 'mint'));
mint.deliver = async (sender, chit, copies) => { delivered.push({ sender, chit, copies }); return { ok: true }; };
require(path.join(API, 'lib', 'books-hooks')).afterChit = () => Promise.resolve({});
require(path.join(API, 'lib', 'meter')).meter = async () => {};
require(path.join(API, 'lib', 'tax-shelf')).readShelf = async () => null;
require(path.join(API, 'lib', 'stock-from-chit')).postFor = async () => ({ failed: [], skipped: [] });
require(path.join(API, 'lib', 'events')).notifyAfter = () => {};
const app = h.app('/api/chits', require(path.join(API, 'routes', 'chits')));

/** the line the till sends once the rate is hidden: no price, total 0 */
const quiet = (over) => Object.assign({ particulars: 'Basmati rice 1kg', quantity: 8, unit: 'kg', price: null, total: 0, item_data: { item_id: 'I1', unit_cost: 0 } }, over);
const to = (id) => [{ kind: 'to', entity_id: id, display_name: ROWS[id].display_name }];
const chit = (purpose, who, lines, bj) => ({ purpose, manual_subject: purpose + ' to ' + ROWS[who].display_name, recipients: to(who), business_json: bj || {}, line_items: lines });
const selfChit = (purpose, lines, bj) => ({ purpose, manual_subject: purpose + ' R/1', recipients: [{ self: true, name: 'self' }], business_json: bj || {}, line_items: lines });
const send = async (identity, payload) => {
  delivered = [];
  const r = await h.run(app, { url: '/api/chits/send', body: payload, identity, ctx: {} });
  return Object.assign(r, { wrote: delivered.length });
};
const refused = (r, label) => {
  assert.strictEqual(r.status, 403, label + ': ' + JSON.stringify(r.body));
  assert.ok(/COST_BLIND/.test(JSON.stringify(r.body)) && !/9797/.test(JSON.stringify(r.body)), label + ': ' + JSON.stringify(r.body));
  assert.strictEqual(r.wrote, 0, label + ': nothing delivered');
};

let pass = 0, fail = 0;
const it = async (name, fn) => { try { await fn(); pass++; console.log('  ok  ' + name); } catch (e) { fail++; console.log('  XX  ' + name + ' — ' + e.message); } };

(async () => {
  console.log('\nRAIL-156 · P1 a priced purchase order from a cost-blind co-assist (the lifecycle X-O3.Rd-b case)');
  for (const [label, line, bj] of [['a price', quiet({ price: TRIED }), {}], ['a total', quiet({ total: TRIED }), {}], ['a unit_cost', quiet({ item_data: { item_id: 'I1', unit_cost: TRIED } }), {}],
    ['the PO own goods', quiet(), { goods: TRIED }], ['a price and a total together (the lifecycle PO)', quiet({ price: 12, total: 60 }), {}]]) {
    await it('PO to a listed supplier with ' + label + ': 403 COST_BLIND, nothing delivered', async () => {
      const r = await send(BLIND, chit('order', SUPPLIER, [line], bj));
      if (label.startsWith('a price and')) { assert.strictEqual(r.status, 403, JSON.stringify(r.body)); assert.strictEqual(r.wrote, 0); } else refused(r, label);
    });
  }
  console.log('\nRAIL-156 · P2 the other spend-side documents take the same door');
  await it('an invoice the shop SENDS is its sale (RAIL-156 KNOWN_SELL): priced, to a supplier-listed or a customer-and-supplier partner, it goes 200 and the answer is untouched', async () => {
    for (const who of [SUPPLIER, BOTH]) {
      const r = await send(BLIND, chit('invoice', who, [quiet({ price: TRIED })]));
      assert.strictEqual(r.status, 200, ROWS[who].display_name + ' ' + JSON.stringify(r.body));
      assert.ok(!('cost_hidden' in r.body), ROWS[who].display_name);
    }
  });
  await it('a supplier bill (receipt carrying their bill no and total)', async () => refused(await send(BLIND, selfChit('receipt', [quiet()], { their_bill: { no: 'B1', total: TRIED } })), 'bill'));
  await it('a goods receipt with a price (the RAIL-146c refusal still holds)', async () => refused(await send(BLIND, selfChit('receipt', [quiet({ price: TRIED })])), 'receipt'));
  await it('an expense with a typed amount (docOf expense is a buy)', async () => refused(await send(BLIND, selfChit('expense', [quiet({ price: TRIED })])), 'expense'));

  console.log('\nRAIL-156 q10/q11 · by the party, not the document kind alone');
  for (const purpose of ['credit_note', 'general', 'delivery_note', 'inquiry']) {
    await it(purpose + ' with a price to a SUPPLIER: 403 COST_BLIND, nothing delivered', async () => refused(await send(BLIND, chit(purpose, SUPPLIER, [quiet({ price: TRIED })])), purpose));
    await it(purpose + ' with a price to a CUSTOMER: sent 200, answer untouched', async () => {
      const r = await send(BLIND, chit(purpose, CUSTOMER, [quiet({ price: TRIED })]));
      assert.strictEqual(r.status, 200, JSON.stringify(r.body));
      assert.strictEqual(r.wrote, 1);
      assert.ok(!('cost_hidden' in r.body), JSON.stringify(r.body));
    });
  }

  console.log('\nRAIL-156 · what must still go');
  await it('a quantity-only PO (the till hidden-rate line) goes 200 to the supplier, and its answer holds no money', async () => {
    const r = await send(BLIND, chit('order', SUPPLIER, [quiet()]));
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.strictEqual(r.wrote, 1);
    assert.strictEqual(r.body.cost_hidden, true, JSON.stringify(r.body));
  });
  await it('a SALE order to a customer-only party with a price: 200 as before, answer untouched', async () => {
    const r = await send(BLIND, chit('order', CUSTOMER, [quiet({ price: TRIED, total: TRIED })]));
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.strictEqual(r.wrote, 1);
    assert.ok(!('cost_hidden' in r.body), JSON.stringify(r.body));
  });
  await it('a priced order to a party on neither list is not judged (unknown is not refused: a walk-in sale must not break)', async () => {
    const r = await send(BLIND, chit('order', STRANGER, [quiet({ price: TRIED })]));
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  });
  await it('the owner and a cost-allowed actor send the priced PO untouched', async () => {
    for (const who of [OWNER, GRANTED]) {
      const r = await send(who, chit('order', SUPPLIER, [quiet({ price: TRIED, total: TRIED })], { goods: TRIED }));
      assert.strictEqual(r.status, 200, who.display_name + ' ' + JSON.stringify(r.body));
      assert.ok(!('cost_hidden' in r.body), who.display_name);
      const line = (delivered[0].copies.find((c) => c && c.line_items) || {}).line_items[0];
      assert.strictEqual(line.price, TRIED, who.display_name);
    }
  });

  console.log('\nRAIL-156 · the paths that never reach a blind figure');
  const books = fs.readFileSync(path.join(API, 'routes', 'books.js'), 'utf8');
  await it('CONNECTOR MOVE-IN: preflight, preview and import are owner-only routes (a co-assist is refused before any document is made)', () => {
    for (const r of ['preflight', 'preview', 'import']) assert.ok(new RegExp("router\\.post\\('/move-in/" + r + "', auth, owner,").test(books), r);
  });
  const autoraise = fs.readFileSync(path.join(API, 'lib', 'autoraise.js'), 'utf8');
  await it('REPEAT SUPPLY: a run is sent over the loopback with the ENTITY token (never an actor), and a run is a sale', () => {
    assert.ok(/sendAs\(entity_id, body, opts\)/.test(autoraise) && /_internalToken\(entity_id\)/.test(autoraise));
  });
  await it('CROSSING: the refusal comes before mint.deliver, the only door to another installation (wrote 0)', async () => {
    refused(await send(BLIND, chit('order', SUPPLIER, [quiet({ price: TRIED })])), 'crossing');
  });

  console.log('\nRAIL-156 · READ side agrees (bite for KNOWN_SELL): the blind reader of a SENT invoice to a customer-and-supplier partner sees its total and no cost');
  const view = require(path.join(API, 'lib', 'cost-view'));
  const sentInvoice = (sender) => ({ header: { chit_id: 'C1', purpose: 'invoice', sender_entity_id: sender, all_recipients: [{ entity_id: SHOP }, { entity_id: BOTH }], total_value: 5900, business_json: {} }, cost: 3000, margin: 2900 });
  await it('sent by the shop: total_value kept, cost and margin gone, not cost_hidden', () => {
    const header = sentInvoice(SHOP).header, out = view.chitAnswer(sentInvoice(SHOP), true, header, SHOP, { party: BOTH_ROLE, deliveryRows: [] }, BLIND_ID);
    assert.strictEqual(view.costSideOf(header, SHOP, BOTH_ROLE), 'sell');
    assert.strictEqual(out.header.total_value, 5900, JSON.stringify(out));
    assert.ok(!('cost' in out) && !('margin' in out), JSON.stringify(out));
    assert.ok(!out.cost_hidden, JSON.stringify(out));
  });
  await it('the SAME invoice RECEIVED from a partner who is a supplier is still a buy: total hidden', () => {
    const header = sentInvoice(BOTH).header, out = view.chitAnswer(sentInvoice(BOTH), true, header, SHOP, { party: BOTH_ROLE, deliveryRows: [] }, BLIND_ID);
    assert.notStrictEqual(out.header.total_value, 5900, JSON.stringify(out));
    assert.strictEqual(out.cost_hidden, true);
  });

  console.log('\n  ' + (fail ? '✗' : '✓') + ' ' + pass + ' passed · ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})();
