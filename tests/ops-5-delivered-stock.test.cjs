/**
 * tests/ops-5-delivered-stock.test.cjs — OPS-5 (ST-19): a supplier bill I counted in (deliver-lines), marked resale, puts the goods on the shelf.
 *
 * OWNS      the proof that lib/deliverline.record on a bill's private copy writes purchase movements (ref GI:<delivery_id>) for the stored delivery rows:
 *           50 then 30 -> +80; the same delivery sent again posts nothing twice; an own-use / asset bill and a charge ('add') move nothing; a name that is
 *           not exactly mine is a named skip; a receipt already raised against the bill means no second count.
 * CALLED BY scripts/guards.cjs · CI. No database, no network: db, schema and the stock store are stand-ins that keep their rows in memory.
 * FLOW      scene (bill copy · catalogue · use) -> real deliverline.record({private}) -> real delivered-stock -> in-memory stock ledger
 * CARD      13-inventory-stock-and-traceability (ST-19)
 *
 * Run: node tests/ops-5-delivered-stock.test.cjs
 */
'use strict';
const assert = require('assert'),
  path = require('path');
const API = path.join(__dirname, '..');
const SHOP = '11111111-1111-4111-8111-111111111111',
  CHIT = '22222222-2222-4222-8222-222222222222';
const L1 = '33333333-3333-4333-8333-333333333331',
  L2 = '33333333-3333-4333-8333-333333333332';
const ITEM = '44444444-4444-4444-8444-444444444444';

const world = { deliveries: [], receipts: [], use: { bill: 'resale' }, lines: [], seq: 0 };
const ledger = new Map(); /* the stock index (entity|ref|line_ref|reason|lot) -> qty, in memory */
const onHand = () => [...ledger.values()].reduce((a, q) => a + q, 0);

function copy() {
  return {
    chit_id: CHIT,
    sender_entity_id: 'seller',
    purpose: 'invoice',
    current_status: 'pending',
    business_json: { use: world.use },
    /* the supplier's own item_id is on the line and must be ignored */
    line_items: world.lines.map((x) => ({ line_id: x.line_id, particulars: x.name, quantity: x.qty, unit: 'kg', price: 60, item_id: 'THEIR-SKU' }))
  };
}
function fakeDb() {
  return {
    query: async (text, p) => {
      const t = String(text).replace(/\s+/g, ' ');
      if (/FROM chit_line WHERE/.test(t)) return { rows: world.lines.map((x) => ({ line_id: x.line_id })) };
      if (/FROM identities/.test(t)) return { rows: [{ display_name: 'Shop' }] };
      if (/^INSERT INTO chit_line_delivery/.test(t)) {
        const ref = p[p.length - 1];
        if (ref && world.deliveries.some((d) => d.line_id === p[12] && d.client_ref === ref)) return { rowCount: 0, rows: [] };
        world.deliveries.push({ delivery_id: 'D' + ++world.seq, line_id: p[12], quantity: p[5], unit: p[6], kind: p[9], client_ref: ref, delivered_at: '2026-10-31' });
        return { rowCount: 1, rows: [] };
      }
      if (/chit_line_event/.test(t)) return { rows: [{ copies: 2 }] };
      if (/FROM chit_line_delivery/.test(t)) return { rows: world.deliveries.filter((d) => d.kind === 'deliver') };
      if (/FROM chit_header WHERE entity_id/.test(t)) return { rows: world.receipts };
      if (/FROM chit_header h/.test(t)) return { rows: [copy()] };
      if (/FROM catalogue_items/.test(t)) return { rows: [{ item_id: ITEM, item_data: { name: 'Basmati Rice', unit: 'kg', price: 90 }, updated_at: null }] };
      return { rows: [], rowCount: 0 };
    }
  };
}
const dbStub = { withEntity: async (e, fn) => fn(fakeDb()), onEntity: async (e, fn) => fn(fakeDb()), query: async () => ({ rows: [{ x: 1 }] }), pool: {} };
require.cache[require.resolve(path.join(API, 'db'))] = { id: 'db', filename: 'db', loaded: true, exports: dbStub };

const stockFromChit = require(path.join(API, 'lib/stock-from-chit'));
/** the stock store, in memory, with the real index's key: a repeat moves nothing. On origin/main this is never called for a bill. */
stockFromChit.postMovements = async (entity, wanted) => {
  const out = { moved: 0, skipped: [], failed: [], duplicate: 0, short: [] };
  for (const mv of wanted) {
    if (mv.skip) {
      out.skipped.push(mv);
      continue;
    }
    const key = [entity, mv.ref, mv.line_ref, mv.reason, mv.lot || ''].join('|');
    if (ledger.has(key)) {
      out.duplicate += 1;
      continue;
    }
    ledger.set(key, mv.qty);
    out.moved += 1;
  }
  return out;
};
require(path.join(API, 'lib/schema')).hasColumn = async () => true;
const deliverline = require(path.join(API, 'lib/deliverline'));
const deliveredStock = { postFor: stockFromChit.postDelivered, movementsFor: stockFromChit.movementsForDelivered };

let checks = 0;
const eq = (a, b, msg) => {
  assert.deepStrictEqual(a, b, msg);
  checks++;
};
function reset(over) {
  Object.assign(world, { deliveries: [], receipts: [], use: { bill: 'resale' }, seq: 0, lines: [{ line_id: L1, name: 'Basmati Rice', qty: 80 }] }, over || {});
  ledger.clear();
}
const count = (rows, who) => deliverline.record(SHOP, CHIT, rows, who || { actor_id: 'a', actor_name: 'A', private: true });
const codes = (r) => ((r && r.stock && r.stock.skipped) || []).map((s) => s.code);

(async () => {
  reset();
  const first = await count([{ line_id: L1, quantity: 50, unit: 'kg', client_ref: 'c1' }]);
  const second = await count([{ line_id: L1, quantity: 30, unit: 'kg', client_ref: 'c2' }]);
  eq(onHand(), 80, 'ST-19: 50 then 30 counted in -> stock +80');
  eq(ledger.size, 2, 'one purchase row per delivery');
  eq([...ledger.keys()].every((k) => k.includes('|GI:D') && k.endsWith('|purchase|')), true, 'purchase rows, ref GI:<delivery_id>');
  eq([first.stock.moved, second.stock.moved, second.stock.duplicate], [1, 1, 1], 'the second call re-derives the first row and finds it a duplicate');

  const again = await count([{ line_id: L1, quantity: 30, unit: 'kg', client_ref: 'c2' }]);
  eq(onHand(), 80, 'the same delivery sent again does not double count');
  eq(again.stock.moved, 0, 'a replay moves nothing');
  const keyless = await count([{ line_id: L1, quantity: 5, unit: 'kg' }]);
  eq([onHand(), keyless.stock.moved], [85, 1], 'a new unkeyed delivery is a new delivery, moved once');

  reset({ use: { bill: 'use' } });
  const own = await count([{ line_id: L1, quantity: 10, unit: 'kg', client_ref: 'u1' }]);
  eq([onHand(), codes(own)], [0, ['not_stock_use']], 'own use: counted in, not put on the shelf, and said so');
  reset({ use: { bill: 'asset' } });
  eq(codes(await count([{ line_id: L1, quantity: 1, unit: 'kg', client_ref: 'a1' }])), ['not_stock_asset'], 'an asset is said so');

  reset({
    lines: [
      { line_id: L1, name: 'Basmati Rice', qty: 5 },
      { line_id: L2, name: 'Labour charge', qty: 1 }
    ]
  });
  const mixed = await count([
    { line_id: L1, quantity: 5, unit: 'kg', client_ref: 'm1' },
    { line_id: L2, quantity: 1, unit: 'kg', client_ref: 'm2' }
  ]);
  eq([onHand(), codes(mixed)], [5, ['item_unmatched']], 'a line that is not my product moves nothing, named item_unmatched');

  reset();
  await count([{ line_id: L1, quantity: 100, unit: 'kg', kind: 'add', amount: 40, particulars: 'freight', client_ref: 'f1' }]);
  eq(onHand(), 0, 'a charge (kind add) is not goods');

  reset({ receipts: [{ x: 1 }] });
  const dup = await count([{ line_id: L1, quantity: 10, unit: 'kg', client_ref: 'r1' }]);
  eq([onHand(), codes(dup)], [0, ['already_received']], 'a receipt already raised against the bill: not counted twice, and said so');

  reset();
  const shared = await count([{ line_id: L1, quantity: 7, unit: 'kg' }], { actor_id: 'a' });
  eq([onHand(), shared.stock], [0, undefined], 'a delivery that is not on a bill I received posts nothing and carries no stock answer');

  /* fail closed: a stock read that is down or unavailable never fails the delivery and never looks like success - the answer says the stock is pending */
  const down = await deliveredStock.postFor(SHOP, CHIT, {}, { readDelivered: async () => { throw new Error('catalogue unavailable'); } });
  eq([down.moved, down.failed.length, /^stock_pending/.test(down.failed[0].why)], [0, 1, true], 'a catalogue that cannot be read is refused as stock_pending, not as success');
  /* the rule, unit: a take-back and a movement with no cost are refused with their own code */
  const rules = deliveredStock.movementsFor({
    copy: copy(), catalogue: { items: [{ name: 'Basmati Rice', variant: '', synonyms: [], item_id: ITEM }] },
    rows: [{ delivery_id: 'T1', line_id: L1, quantity: -3, unit: 'kg' }, { delivery_id: 'T2', line_id: L1, quantity: 3, unit: 'kg' }]
  });
  eq([rules[0].code, rules[1].reason, rules[1].ref], ['take_back_not_posted', 'purchase', 'GI:T2'], 'a take-back is refused; a delivery is a purchase with its own ref');

  console.log(checks + ' checks');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
