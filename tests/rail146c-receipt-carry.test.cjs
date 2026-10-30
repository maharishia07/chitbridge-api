/**
 * tests/rail146c-receipt-carry.test.cjs — RAIL-146c: a goods RECEIPT sent by a cost-blind co-assist is never costed at zero.
 *
 * OWNS      the proof that POST /chits/send of a receipt (purpose 'receipt', business_json.against = the order) from an actor without can_see_costs, whose lines carry no price (the
 *           till sends price null, total 0, unit_cost 0 once the rate is hidden), puts the ORDER's stored price on the line (the live price an amend wrote, not the frozen one), the
 *           total made from the received quantity, and no unit_cost 0 — so lib/stock-from-chit costs the stock at the order's price; that a receipt line with price null and no cost is a
 *           no_cost skip (never rate 0); that a figure he sends (a price, a total, the receipt's goods or landed_total) is a 403 COST_BLIND, nothing delivered; that the order is re-read
 *           under FOR UPDATE in the write transaction (409 when the owner repriced in between); that the owner and a cost-allowed actor send exactly what they send today.
 * CALLED BY scripts/guards.cjs · CI. No database, no network: the real routes/chits.js over the route-golden stand-ins (as tests/rail149-draft-cost-carry.test.cjs).
 * FLOW      scene (who · the order's lines · the live price) → real POST /send → status, the copy handed to mint.deliver, the statements → stock-from-chit.movementsFor on that copy
 * CARD      01-rail-core-the-chit/chits-routes
 *
 * Run: node tests/rail146c-receipt-carry.test.cjs
 */
'use strict';
const assert = require('assert'), path = require('path');
const G = require('./support/route-golden.cjs');
const API = G.API;

const SHOP = '11111111-1111-4111-8111-111111111111', SUPPLIER = '22222222-2222-4222-8222-222222222222';
const BLIND_ID = '55555555-5555-4555-8555-555555555555', GRANTED_ID = '66666666-6666-4666-8666-666666666666';
const ORDER = '77777777-7777-4777-8777-777777777777', L1 = '88888888-8888-4888-8888-888888888881', L2 = '88888888-8888-4888-8888-888888888882';
const CUSTOMER = '33333333-3333-4333-8333-333333333333', STRANGER = '99999999-9999-4999-8999-999999999999';
const STORED = 4242.5, LIVE = 4545.5, TRIED = 9797.25;
const row = (id, name, bridge) => ({ identity_id: id, bridge_id: bridge, display_name: name, country: 'IN', currency_code: 'INR', policy_flags: {}, status: 'active', user_id: name });
const ROWS = { [SHOP]: row(SHOP, 'Mayur Traders', 'CBSHOP0001'), [SUPPLIER]: row(SUPPLIER, 'Rice Mill', 'CBMILL0001') };
const OWNER = { identity_id: SHOP, identity_type: 'entity', bridge_id: 'CBSHOP0001', display_name: 'Mayur Traders' };
const BLIND = { identity_id: BLIND_ID, identity_type: 'actor', access_level: 'editor', parent_entity_id: SHOP, hat: 'manager', bridge_id: 'CBSHOP0001', display_name: 'Blind' };
const GRANTED = Object.assign({}, BLIND, { identity_id: GRANTED_ID, display_name: 'Granted' });
/** the order as stored: line 1 priced, line 2 never priced */
const PAYLOAD = [
  { line_id: L1, seq: 10, particulars: 'Basmati rice 1kg', quantity: 10, unit: 'kg', price: STORED, total: 42425 },
  { line_id: L2, seq: 20, particulars: 'Toor dal 1kg', quantity: 5, unit: 'kg' }
];
let delivered = [];
/** the order's header as the side read sees it: an order the shop SENT to `other` */
const headerFor = (other) => ({ purpose: 'order', sender_entity_id: SHOP, all_recipients: [{ entity_id: SHOP, role: 'sender' }, { entity_id: other, role: 'receiver' }], business_json: {} });
const fresh = () => ({ payload: PAYLOAD, live: [], moved: null, locked: 0, header: headerFor(SUPPLIER), roleOf: { [SUPPLIER]: 'supplier', [CUSTOMER]: 'customer' } });
const SCENE = fresh();
function rows(s, p) {
  if (/SELECT ch\.purpose, ch\.sender_entity_id, ch\.all_recipients/.test(s)) return SCENE.header ? [SCENE.header] : [];
  if (/FROM unnest\(\$2::uuid\[\]\)/.test(s)) return p[1].map((id) => ({ id, customer: SCENE.roleOf[id] === 'customer', supplier: SCENE.roleOf[id] === 'supplier' }));
  if (/WITH s AS \(SELECT c\.id, c\.path FROM identities/.test(s)) return [{ brand_id: SUPPLIER, built: false, edge_id: null }];
  if (/to_regprocedure\('chit_deliver/.test(s)) return [{ ok: true }];
  if (/can_see_costs FROM identities/.test(s)) return [{ can_see_costs: p[0] === GRANTED_ID }];
  if (/SELECT line_id, seq, price FROM chit_line .* FOR UPDATE/.test(s)) return SCENE.live;
  if (/SELECT line_items FROM chit_detail WHERE entity_id = \$1 AND chit_id = \$2 LIMIT 1 FOR UPDATE/.test(s)) {
    SCENE.locked += 1;
    return [{ line_items: SCENE.locked > 1 && SCENE.moved ? SCENE.moved : SCENE.payload }];
  }
  if (/SELECT country, currency_code, timezone FROM identities/.test(s)) return [{ country: 'IN', currency_code: 'INR', timezone: null }];
  if (/SELECT self_copy_pref, currency_code FROM identities/.test(s)) return [{ self_copy_pref: null, currency_code: 'INR' }];
  if (/FROM identities/.test(s) && /identity_id = \$1/.test(s)) { const r = ROWS[p[0]]; return r ? [r] : []; }
  return [];
}
const h = G.harness({ rows, known: { [SHOP]: 'SHOP', [SUPPLIER]: 'SUPPLIER' } });
const mint = require(path.join(API, 'lib', 'mint'));
mint.deliver = async (sender, chit, copies) => { delivered.push({ sender, chit, copies }); return { ok: true }; };
require(path.join(API, 'lib', 'books-hooks')).afterChit = () => Promise.resolve({});
require(path.join(API, 'lib', 'meter')).meter = async () => {};
require(path.join(API, 'lib', 'tax-shelf')).readShelf = async () => null;
const stock = require(path.join(API, 'lib', 'stock-from-chit'));
stock.postFor = async () => ({ failed: [], skipped: [] });
require(path.join(API, 'lib', 'events')).notifyAfter = () => {};
const app = h.app('/api/chits', require(path.join(API, 'routes', 'chits')));

/** the line the till sends once the rate is hidden (chitOfDoc): price null, total 0 (value), unit_cost 0, landed 0 */
const hiddenLine = (over) => Object.assign({ particulars: 'Basmati rice 1kg', quantity: 8, unit: 'kg', price: null, total: 0, item_data: { item_id: 'I1', line_id: L1, unit_cost: 0, landed: 0, lot: null } }, over);
const receipt = (lines, bj) => ({ purpose: 'receipt', manual_subject: 'Goods received from Rice Mill — R/1', recipients: [{ self: true, name: 'self' }], client_ref: 'R/1',
  business_json: Object.assign({ doc: 'receipt', doc_no: 'R/1', against: { chit_id: ORDER, party: 'Rice Mill' }, goods: 0, extras: 0, landed_total: 0 }, bj || {}), line_items: lines });
const send = async (who, payload, scene) => {
  Object.assign(SCENE, fresh(), scene || {});
  delivered = [];
  const r = await h.run(app, { url: '/api/chits/send', body: payload, identity: who, ctx: {} });
  return Object.assign(r, { copies: delivered.length ? JSON.parse(JSON.stringify(delivered[0].copies)) : null, wrote: delivered.length });
};
const sentLines = (r) => { const copy = (r.copies || []).find((item) => item && item.line_items) || (r.copies || [])[0]; return (copy && copy.line_items) || []; };
const movementOf = (line, bj) => stock.movementsFor({ purpose: 'receipt', business_json: Object.assign({ doc: 'receipt', doc_no: 'R/1' }, bj || {}), line_items: [line], created_at: '2026-10-29T00:00:00Z' })[0];
const reads = (r) => r.calls.filter((c) => /FOR UPDATE/.test(c.sql || '')).length;

let pass = 0, fail = 0;
const it = async (name, fn) => { try { await fn(); pass++; console.log('  ok  ' + name); } catch (e) { fail++; console.log('  XX  ' + name + ' — ' + e.message); } };

(async () => {
  console.log('\nRAIL-146c · a blind quantity-only receipt carries the order\'s price');
  await it('the till\'s hidden-rate line (price null, total 0, unit_cost 0): the ORDER\'s price is on the line, the total is made from the counted quantity, no zero cost survives', async () => {
    const r = await send(BLIND, receipt([hiddenLine()]));
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    const line = sentLines(r)[0];
    assert.strictEqual(line.price, STORED, JSON.stringify(line));
    assert.strictEqual(line.total, 33940);
    assert.ok(!('unit_cost' in line.item_data) && !('landed' in line.item_data), JSON.stringify(line.item_data));
    assert.strictEqual(line.item_data.line_id, L1);
  });
  await it('STOCK: that line is costed at the order\'s price (rate 4242.5), not zero', async () => {
    const line = sentLines(await send(BLIND, receipt([hiddenLine()])))[0];
    assert.strictEqual(movementOf(line).rate, STORED);
  });
  await it('the LIVE price (an amend or reprice wrote chit_line) wins over the frozen one, and the total follows it', async () => {
    const r = await send(BLIND, receipt([hiddenLine({ quantity: 10 })]), { live: [{ line_id: L1, seq: 10, price: LIVE }] });
    const line = sentLines(r)[0];
    assert.strictEqual(line.price, LIVE);
    assert.strictEqual(line.total, 45455);
    assert.strictEqual(movementOf(line).rate, LIVE);
  });
  await it('lines are matched by the order\'s line_id (item_data), in any order; an unordered line (no id) carries nothing and is not matched by position', async () => {
    const extra = hiddenLine({ particulars: 'Sugar', item_data: { item_id: 'I9', line_id: null, unit_cost: 0 } });
    const r = await send(BLIND, receipt([extra, hiddenLine({ particulars: 'Toor dal 1kg', item_data: { item_id: 'I2', line_id: L2, unit_cost: 0 } }), hiddenLine()]));
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    const lines = sentLines(r);
    assert.ok(lines[0].price == null, 'the unordered line carries no price: ' + JSON.stringify(lines[0]));
    assert.ok(lines[1].price == null, 'the never-priced order line carries none');
    assert.strictEqual(lines[2].price, STORED);
  });
  await it('NO COST, NO RECEIPT: a line with price null and no unit_cost is a no_cost skip, never rate 0', async () => {
    const mv = movementOf({ particulars: 'Rice', quantity: 8, unit: 'kg', price: null, item_data: { item_id: 'I1' } });
    assert.ok(mv && mv.skip === true && mv.code === 'no_cost', JSON.stringify(mv));
    const blank = movementOf({ particulars: 'Rice', quantity: 8, unit: 'kg', price: '', item_data: { item_id: 'I1', unit_cost: '' } });
    assert.ok(blank && blank.skip === true && blank.code === 'no_cost', JSON.stringify(blank));
    assert.strictEqual(movementOf({ particulars: 'Rice', quantity: 8, unit: 'kg', price: 0, item_data: { item_id: 'I1' } }).rate, 0, 'a stated 0 is still a stated 0 (the owner\'s free sample)');
  });
  await it('a receipt that names no order: nothing to carry, the zero is taken off, the line is a no_cost skip', async () => {
    const r = await send(BLIND, receipt([hiddenLine({ item_data: { item_id: 'I1', unit_cost: 0 } })], { against: null }));
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    const line = sentLines(r)[0];
    assert.ok(line.price == null && !('unit_cost' in line.item_data), JSON.stringify(line));
    assert.strictEqual(movementOf(line).code, 'no_cost');
  });

  console.log('\nRAIL-146c · only a BUY order lends a price; the answer is pruned');
  await it('a receipt against the sender OWN sale order (to a customer-only party) carries nothing: the sell price is not taken as cost, the zeros go, the line is a no_cost skip', async () => {
    const r = await send(BLIND, receipt([hiddenLine()]), { header: headerFor(CUSTOMER) });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    const line = sentLines(r)[0];
    assert.ok(line.price == null && !('unit_cost' in line.item_data), JSON.stringify(line));
    assert.strictEqual(movementOf(line).code, 'no_cost');
    const unknown = await send(BLIND, receipt([hiddenLine()]), { header: headerFor(STRANGER), roleOf: {} });
    assert.ok(sentLines(unknown)[0].price == null, 'an order of unknown side lends nothing');
  });
  await it('a figure of his is still a 403 against a sale order', async () => {
    const r = await send(BLIND, receipt([hiddenLine({ price: TRIED })]), { header: headerFor(CUSTOMER) });
    assert.strictEqual(r.status, 403, JSON.stringify(r.body));
  });
  await it('the SEND ANSWER of a blind receipt: cost_hidden true, no money key, no figure, no rupee sign anywhere in the body, no sender-written rider in the summary', async () => {
    const r = await send(BLIND, receipt([hiddenLine()], { commercial: { terms: 'net 30 ex works' }, governed: { rule: 'two-sign' } }));
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    const raw = JSON.stringify(r.body);
    assert.strictEqual(r.body.cost_hidden, true, raw);
    assert.ok(!/₹|4242|42425|33940|ex works|two-sign/.test(raw), raw); /* no figure, and no sender-written rider */
    const keys = [];
    (function walk(v) { if (v && typeof v === 'object') Object.keys(v).forEach((k) => { keys.push(k); walk(v[k]); }); })(r.body);
    assert.deepStrictEqual(keys.filter((k) => /total|amount|price|money|cost$|commercial|trace|governed|clearances|number_check|offers/.test(k)), [], raw);
    assert.ok(r.body.chit_id && r.body.summary && r.body.summary.line_item_count === 1, 'the fixed keys stay: ' + raw);
  });
  await it('the owner send answer is as it was: no cost_hidden', async () => {
    const r = await send(OWNER, receipt([hiddenLine({ price: TRIED })], { commercial: { price_basis: 'ex works' } }));
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.ok(!('cost_hidden' in r.body));
  });

  console.log('\nRAIL-146c · a blind co-assist cannot write a figure on a receipt');
  for (const [label, payload] of [['a price', receipt([hiddenLine({ price: TRIED })])], ['a total', receipt([hiddenLine({ total: TRIED })])],
    ['a unit_cost', receipt([hiddenLine({ item_data: { item_id: 'I1', line_id: L1, unit_cost: TRIED } })])], ['the receipt\'s goods', receipt([hiddenLine()], { goods: TRIED })],
    ['the receipt\'s landed_total', receipt([hiddenLine()], { landed_total: TRIED })], ['their bill\'s total', receipt([hiddenLine()], { their_bill: { no: 'B1', total: TRIED } })]]) {
    await it(label + ': 403 COST_BLIND, nothing delivered, the figure not echoed', async () => {
      const r = await send(BLIND, payload);
      assert.strictEqual(r.status, 403, JSON.stringify(r.body));
      assert.ok(/COST_BLIND/.test(JSON.stringify(r.body)) && !/9797/.test(JSON.stringify(r.body)), JSON.stringify(r.body));
      assert.strictEqual(r.wrote, 0);
    });
  }
  await it('the order\'s own price re-sent unchanged is not a figure of his', async () => {
    const r = await send(BLIND, receipt([hiddenLine({ price: STORED })]));
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.strictEqual(sentLines(r)[0].price, STORED);
  });
  await it('the order is read FOR UPDATE and again in the write transaction; the owner repriced in between: 409, nothing delivered', async () => {
    const ok = await send(BLIND, receipt([hiddenLine()]));
    assert.strictEqual(reads(ok) >= 2, true, 'reads: ' + reads(ok));
    const moved = PAYLOAD.map((l) => (l.line_id === L1 ? Object.assign({}, l, { price: 6161.75 }) : l));
    const r = await send(BLIND, receipt([hiddenLine()]), { moved });
    assert.strictEqual(r.status, 409, JSON.stringify(r.body));
    assert.strictEqual(r.wrote, 0);
  });

  console.log('\nRAIL-146c · everyone else sends what they sent before');
  await it('the owner and a cost-allowed actor: their own price, total, unit_cost and goods go on the receipt untouched, with no extra statement', async () => {
    for (const who of [OWNER, GRANTED]) {
      const r = await send(who, receipt([hiddenLine({ price: TRIED, total: 78378, item_data: { item_id: 'I1', line_id: L1, unit_cost: 9999.5 } })], { goods: 78378 }));
      assert.strictEqual(r.status, 200, who.display_name + ' ' + JSON.stringify(r.body));
      const line = sentLines(r)[0];
      assert.deepStrictEqual([line.price, line.total, line.item_data.unit_cost], [TRIED, 78378, 9999.5]);
      assert.strictEqual(reads(r), 0, 'no lock read for ' + who.display_name);
    }
  });

  console.log('\n  ' + (fail ? '✗' : '✓') + ' ' + pass + ' passed · ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})();
