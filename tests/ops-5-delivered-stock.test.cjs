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

const world = { sent: [], deliveries: [], receipts: [], use: { bill: 'resale' }, lines: [], seq: 0, order: null };
const receiptRow = (against, qty, no) => ({ chit_id: 'R-' + no, purpose: 'receipt', created_at: '2026-10-31', business_json: { client_ref: no, against: { chit_id: against } }, line_items: [{ line_id: L1, item_id: ITEM, quantity: qty, unit: 'kg', price: 60 }] });
const ledger = new Map(); /* the stock index (entity|ref|line_ref|reason|lot) -> qty, in memory */
const onHand = () => [...ledger.values()].reduce((a, q) => a + q, 0);

function copy() {
  return {
    chit_id: CHIT,
    sender_entity_id: 'seller',
    purpose: 'invoice',
    current_status: 'pending',
    business_json: { use: world.use, ...(world.order ? { order: { from: world.order } } : {}) },
    /* the supplier's own item_id is on the line and must be ignored */
    line_items: world.lines.map((x) => ({ line_id: x.line_id, particulars: x.name, quantity: x.qty, unit: 'kg', price: 60, item_id: 'THEIR-SKU' }))
  };
}
function fakeDb() {
  return {
    query: async (text, p) => {
      const t = String(text).replace(/\s+/g, ' ');
      if (world.useRow && /SELECT business_json->'use' AS use FROM chit_header/.test(t)) return { rows: [{ use: world.useRow }] };
      if (/FROM chit_line WHERE/.test(t)) return { rows: world.lines.map((x) => ({ line_id: x.line_id })) };
      if (/FROM identities/.test(t)) return { rows: [{ display_name: 'Shop' }] };
      if (/^INSERT INTO chit_line_delivery/.test(t)) {
        const ref = p[p.length - 1];
        if (ref && world.deliveries.some((d) => d.line_id === p[12] && d.client_ref === ref)) return { rowCount: 0, rows: [] };
        world.deliveries.push({ delivery_id: 'D' + ++world.seq, line_id: p[12], quantity: p[5], unit: p[6], kind: p[9], client_ref: ref, delivered_at: '2026-10-31' });
        return { rowCount: 1, rows: [] };
      }
      if (/FROM chit_line_delivery d JOIN stock_movement/.test(t)) {
        /* the link: the bill itself, or (OPS-75) the order the supplier's bill is for - a read that cannot follow the order finds nothing */
        const follows = p[1] === CHIT || (/'order' ->> 'from'/.test(t) && world.order && p[1] === world.order);
        if (!follows) return { rows: [] };
        const counted = [...ledger.entries()].filter(([k]) => k.includes('|GI:')).reduce((a, [, q]) => a + q, 0);
        return { rows: counted ? [{ item_id: ITEM, qty: counted }] : [] };
      }
      if (/chit_line_event/.test(t)) return { rows: [{ copies: 2 }] };
      if (/FROM chit_line_delivery/.test(t)) return { rows: world.deliveries.filter((d) => d.kind === 'deliver') };
      if (/FROM chit_header WHERE entity_id/.test(t)) return { rows: world.receipts };
      /* OPS-99: the receipts raised EARLIER against the same document (not this one, created before it) */
      /* the earlier-receipts read, answered as the SQL does: (created_at, chit_id) order with a missing stamp = the latest; a cancelled / rejected receipt drops only when the statement says so */
      if (/h.business_json #>> '{against,chit_id}' = [$]2/.test(t) && /'infinity'/.test(t) && !/= ANY/.test(t)) {
        const at = (v) => (v == null ? Infinity : v), me = at(p[3]);
        const ties = /h.chit_id::text < [$]3/.test(t); /* no tie term in the statement = equal stamps are not earlier, as SQL would answer */
        const dropsWithdrawn = /cs.current_status IN \('cancelled', 'rejected'\)/.test(t);
        return { rows: world.sent.filter((r) => r.business_json.against.chit_id === p[1] && !(dropsWithdrawn && r.withdrawn) && (at(r.created_at) < me || (ties && at(r.created_at) === me && String(r.chit_id) < p[2]))) };
      }
      if (/h.business_json #>> '{against,chit_id}' = ANY/.test(t)) { /* a cancelled / rejected receipt drops only when the statement says so */
        const dropsWithdrawn = /cs.current_status IN [(]'cancelled', 'rejected'[)]/.test(t);
        return { rows: world.receipts.filter((r) => p[1].includes(r.business_json.against.chit_id) && !(dropsWithdrawn && r.withdrawn)) };
      }
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
  Object.assign(world, { sent: [], deliveries: [], receipts: [], use: { bill: 'resale' }, seq: 0, order: null, lines: [{ line_id: L1, name: 'Basmati Rice', qty: 80 }] }, over || {});
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

  reset({ receipts: [receiptRow(CHIT, 10, 'GRN-A')] });
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

  /* a receipt raised AFTER the bill was counted in: the shared link is against.chit_id = the bill */
  const receipt = (qty, against) => ({ chit_id: 'R1', purpose: 'receipt', business_json: { client_ref: 'GRN1', against: { chit_id: against || CHIT } }, line_items: [{ line_id: L1, item_id: ITEM, quantity: qty, unit: 'kg', price: 60 }] });
  const receive = (qty, against) => require(path.join(API, 'lib/stock-from-chit')).postFor(SHOP, receipt(qty, against), dbStub.withEntity, {});
  reset();
  await count([{ line_id: L1, quantity: 50, unit: 'kg', client_ref: 'x1' }]);
  const same = await receive(50);
  eq([onHand(), same.skipped.map((s) => s.code)], [50, ['already_counted_in']], 'bill counted in 50, then a receipt of 50: stock stays 50, said so');
  reset();
  await count([{ line_id: L1, quantity: 50, unit: 'kg', client_ref: 'x2' }]);
  const more = await receive(80);
  eq([onHand(), more.moved], [80, 1], 'bill 50, then a receipt of 80: only the remainder 30 is posted, stock 80');
  eq((await receive(80)).moved, 0, 'the receipt sent again posts nothing twice');
  reset();
  await receive(50);
  reset();
  await receive(50);
  world.receipts = [receiptRow(CHIT, 50, 'GRN1')];
  await count([{ line_id: L1, quantity: 50, unit: 'kg', client_ref: 'x3' }]);
  eq(onHand(), 50, 'receipt before the bill: the bill is not counted a second time (already_received)');

  /* OPS-75: the receipt is raised against the PO and does NOT name the bill - the shared link is the PO (bill.business_json.order.from = receipt.against.chit_id).
     Stock must post once whichever arrives first. Quantities are plain counts, so the case is the same for an IN and an AU shop (no country branch in the posting). */
  const PO = '55555555-5555-4555-8555-555555555555', OTHER_PO = '66666666-6666-4666-8666-666666666666';
  reset({ order: PO });
  await count([{ line_id: L1, quantity: 50, unit: 'kg', client_ref: 'p1' }]);
  const poSame = await receive(50, PO);
  eq([onHand(), poSame.skipped.map((s) => s.code)], [50, ['already_counted_in']], 'OPS-75 bill first: a receipt of 50 against the PO is not posted again');
  reset({ order: PO });
  await count([{ line_id: L1, quantity: 50, unit: 'kg', client_ref: 'p2' }]);
  eq([(await receive(80, PO)).moved, onHand()], [1, 80], 'OPS-75 bill 50, receipt 80 against the PO: only the remainder 30 is posted');
  reset({ order: PO });
  await count([{ line_id: L1, quantity: 50, unit: 'kg', client_ref: 'p3' }]);
  eq([(await receive(50, OTHER_PO)).moved, onHand()], [1, 100], 'OPS-75 a receipt against ANOTHER order is a different delivery: posted');
  reset({ order: PO });
  await receive(50, PO);
  world.receipts = [receiptRow(PO, 50, 'GRN1')];
  const billAfter = await count([{ line_id: L1, quantity: 50, unit: 'kg', client_ref: 'p4' }]);
  eq([onHand(), codes(billAfter)], [50, ['already_received']], 'OPS-75 receipt first: the bill counted in afterwards, same goods, posts nothing');
  reset({ order: PO });
  await receive(50, PO);
  world.receipts = [receiptRow(PO, 50, 'GRN1')];
  await count([{ line_id: L1, quantity: 80, unit: 'kg', client_ref: 'p5' }]);
  eq(onHand(), 80, 'OPS-75 receipt 50 first, then the whole bill 80: only the remainder 30 is posted, stock 80');
  reset({ order: PO });
  world.receipts = [receiptRow(OTHER_PO, 50, 'GRN9')];
  await count([{ line_id: L1, quantity: 50, unit: 'kg', client_ref: 'p6' }]);
  eq(onHand(), 50, 'OPS-75 a receipt for another order does not net this bill');

  /* OPS-99: partial billing. The bill's counted-in goods are used up once: bill counted in 60, receipts 40 then 60 -> stock 100, not 60 */
  const partial = async (no, qty, at) => {
    const chit = { chit_id: 'RP' + no, purpose: 'receipt', created_at: at, business_json: { client_ref: 'GRN-P' + no, against: { chit_id: CHIT } }, line_items: [{ line_id: L1, item_id: ITEM, quantity: qty, unit: 'kg', price: 60 }] };
    const reply = await stockFromChit.postFor(SHOP, chit, dbStub.withEntity, {});
    world.sent.push(chit);
    return reply;
  };
  reset();
  await count([{ line_id: L1, quantity: 60, unit: 'kg', client_ref: 'q1' }]);
  const r1 = await partial(1, 40, 1), r2 = await partial(2, 60, 2);
  eq([r1.moved, r2.moved, onHand()], [0, 1, 100], 'OPS-99 bill counted in 60, receipts 40 + 60: the second posts only 40, stock 100 (was 60 of 100)');
  eq((await partial(2, 60, 2)).moved, 0, 'OPS-99 the second receipt sent again posts nothing twice');
  eq([(await partial(1, 40, 1)).moved, onHand()], [0, 100], 'OPS-99 the first receipt replayed after the second still posts nothing (only EARLIER receipts count)');
  reset();
  await count([{ line_id: L1, quantity: 60, unit: 'kg', client_ref: 'q2' }]);
  await partial(1, 100, 1);
  eq(onHand(), 100, 'OPS-99 bill 60, one receipt of 100: only the remainder 40 is posted, stock 100');
  eq([(await partial(2, 30, 2)).moved, onHand()], [1, 130], 'OPS-99 bill 60, receipts 100 then 30: the bill is already used up, the 30 posts in full, stock 130');
  reset();
  await count([{ line_id: L1, quantity: 100, unit: 'kg', client_ref: 'q3' }]);
  await partial(1, 40, 1);
  await partial(2, 60, 2);
  eq(onHand(), 100, 'OPS-99 bill counted in 100, receipts 40 + 60: all netted, stock 100 (the order that already held)');

  /* OPS-99 review fixes (cb-accounting): the order of "earlier" is total, a cancelled receipt nets nothing, earlier receipts are read as this one is. Bill counted in 60, goods 60/kg. */
  const rcpt = (id, qty, at, over) => ({ chit_id: id, purpose: 'receipt', created_at: at, business_json: { client_ref: 'G-' + id, against: { chit_id: CHIT } }, line_items: [{ line_id: (over && over.line) || L1, item_id: ITEM, quantity: qty, unit: 'kg', price: 60 }], withdrawn: !!(over && over.withdrawn) });
  const raise = async (chit) => {
    const reply = await stockFromChit.postFor(SHOP, chit, dbStub.withEntity, {});
    if (!world.sent.includes(chit)) world.sent.push(chit);
    return reply;
  };
  /* 1 · the same created_at: exactly one is earlier (by chit_id), so 40 + 60 against 60 counted in still gives 100 (both ignoring each other gave 60) */
  reset();
  await count([{ line_id: L1, quantity: 60, unit: 'kg', client_ref: 'r1' }]);
  const ra = rcpt('RA', 40, 5), rb = rcpt('RB', 60, 5);
  await raise(ra);
  await raise(rb);
  eq(onHand(), 100, 'OPS-99 equal created_at, bill 60, receipts 40 + 60: the one with the higher chit_id is the later, stock 100');
  eq([(await raise(ra)).moved, onHand()], [0, 100], 'OPS-99 equal created_at: the lower chit_id replayed after the other still posts nothing');
  /* 2 · no created_at: null is the latest, tie on chit_id (two nulls: 40 + 60 -> 100, not 80); a null stamp counts the stamped receipts as earlier */
  reset();
  await count([{ line_id: L1, quantity: 60, unit: 'kg', client_ref: 'r2' }]);
  await raise(rcpt('RA', 40, null));
  await raise(rcpt('RB', 60, null));
  eq(onHand(), 100, 'OPS-99 two receipts with no created_at: ordered by chit_id, stock 100 (each counting the other gave 80)');
  reset();
  await count([{ line_id: L1, quantity: 60, unit: 'kg', client_ref: 'r3' }]);
  await raise(rcpt('RA', 40, 1));
  await raise(rcpt('RB', 60, null));
  eq(onHand(), 100, 'OPS-99 a receipt with no created_at is the latest: it nets after the stamped one, stock 100');
  reset();
  await count([{ line_id: L1, quantity: 60, unit: 'kg', client_ref: 'r3b' }]);
  await raise(rcpt('RB', 60, null));
  eq([(await raise(rcpt('RA', 40, 1))).moved, onHand()], [0, 60], 'OPS-99 a stamped receipt does not count a receipt with no created_at as earlier');
  /* 3 · a cancelled earlier receipt nets nothing: bill 60 counted in, A (100) cancelled, B (100) alone posts the remainder 40 */
  reset();
  await count([{ line_id: L1, quantity: 60, unit: 'kg', client_ref: 'r4' }]);
  world.sent.push(rcpt('RX', 100, 1, { withdrawn: true }));
  eq([(await raise(rcpt('RY', 100, 2))).moved, onHand()], [1, 100], 'OPS-99 a cancelled earlier receipt nets nothing: B nets the bill 60 and posts 40, stock 100');
  /* 4 · earlier receipts read as this one is: the buyer said A's line (L2) is for own use, so it put nothing on the shelf and nets nothing */
  reset();
  await count([{ line_id: L1, quantity: 60, unit: 'kg', client_ref: 'r5' }]);
  world.useRow = { bill: 'resale', lines: { [L2]: 'use' } };
  world.sent.push(rcpt('RU', 40, 1, { line: L2 }));
  eq([(await raise(rcpt('RV', 60, 2))).moved, onHand()], [0, 60], 'OPS-99 an earlier receipt line marked own use nets nothing: the later one nets the whole 60, stock 60');
  world.useRow = null;
  /* 5 · the receipt-first order (OPS-75 receivedQuantities): a cancelled receipt of 50 put nothing on the shelf, so the bill counted in afterwards posts all 50 */
  reset({ order: PO });
  world.receipts = [Object.assign(receiptRow(PO, 50, 'GRNX'), { withdrawn: true })];
  await count([{ line_id: L1, quantity: 50, unit: 'kg', client_ref: 'r6' }]);
  eq(onHand(), 50, 'OPS-99 a cancelled receipt is not netted off the bill counted in afterwards: stock 50, not 0');

  console.log(checks + ' checks');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
