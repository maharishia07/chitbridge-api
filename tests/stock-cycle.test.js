/**
 * ── tests/stock-cycle.test.js · THE LIFE OF ONE PRODUCT ON A SHELF ─────────────────────────────────────────────
 *
 * `lib/inventory.js` is arithmetic and could be tested alone. The question here is the one that actually bites:
 * does the LOG and the CACHE stay in step — through a replayed bill, a sale into negative stock, and a balance
 * that somebody has quietly corrupted?
 *
 * ⚠️ It runs against the real `lib/stock-store.js` with the database stubbed, and the stub enforces the two rules
 * the real schema enforces: the unique index on (entity, ref, line_ref, reason), and no UPDATE or DELETE on
 * stock_movement. So what is under test is the real post(), the real rebuild() and the real engine — everything
 * except the network.
 */
'use strict';
const assert = require('assert'), path = require('path');
const inventory = require(path.join(__dirname, '..', 'lib', 'inventory.js'));
const store = require(path.join(__dirname, '..', 'lib', 'stock-store.js'));

let pass = 0;
const ita = async (what, fn) => { try { await fn(); pass++; console.log('  ok  ' + what); }
                                  catch (e) { console.log('  FAIL ' + what + '\n       ' + e.message); process.exitCode = 1; } };

const SHOP = '11111111-1111-1111-1111-111111111111';
const RICE = '22222222-2222-2222-2222-222222222222';

/* ── the stub: two tables and the handful of statements the store issues ── */
let MOVES = [], BAL = [];
/* ⚠️ THE KEY GAINS THE LOT (b215). Untracked stock lives under '' — a real value, never NULL, because a NULL in
   a primary key does not compare equal to itself. */
const key = (r) => [r.entity_id, r.item_id, r.location, r.lot || ''].join('|');
const withEntity = async (entity_id, fn) => fn({
  query: async (sql, args) => {
    if (/^\s*INSERT INTO stock_movement/.test(sql)) {
      const [entity_id, item_id, location, qty, rate, value_delta, unit, reason, ref, line_ref, lot, note, at, by, expires_at] = args;
      /* the real unique index, reproduced — a replayed bill must not move stock twice */
      /* the real unique index now includes COALESCE(lot,'') — one sale line can split across two batches */
      if (ref != null && MOVES.some((m) => m.entity_id === entity_id && m.ref === ref
            && m.line_ref === line_ref && m.reason === reason && (m.lot || '') === (lot || ''))) return { rows: [] };
      const row = { movement_id: 'mv-' + (MOVES.length + 1), entity_id, item_id, location,
                    qty: Number(qty), rate, value_delta, unit, reason, ref, line_ref, lot, note, expires_at,
                    at: at || new Date(Date.now() + MOVES.length * 1000).toISOString() };
      MOVES.push(row);
      return { rows: [{ movement_id: row.movement_id, at: row.at }] };
    }
    if (/^\s*INSERT INTO stock_balance/.test(sql)) {
      const [entity_id, item_id, location, lot, expires_at] = args;
      const k = [entity_id, item_id, location, lot || ''].join('|');
      if (!BAL.some((b) => key(b) === k))
        BAL.push({ entity_id, item_id, location, lot: lot || '', expires_at: expires_at || null,
                   qty: 0, value: 0, avg_cost: 0, unit: null, last_at: null, moves: 0 });
      return { rows: [] };
    }
    /* ⚠️ MATCH THE INTENT, NOT THE COLUMN LIST. These branches were pinned to exact SELECT lists, so adding one
       column to the real query made the stub silently return no rows and the code then read undefined. Same
       lesson as the 300-character slice earlier: a check that measures the shape of a string is measuring the
       wrong thing. FOR UPDATE is what actually distinguishes the lock from the plain read, so use that. */
    /* ⚠️ THE FEFO READ IS ITS OWN SHAPE: every batch of one product that still holds stock, oldest expiry first.
       It takes three arguments where the others take four, so a key-join match silently returned nothing and
       issue() fell through to its shortfall path — which looked exactly like "there was no stock". */
    if (/FROM stock_balance[\s\S]*qty > 0[\s\S]*ORDER BY expires_at/.test(sql)) {
      const [entity_id, item_id, location] = args;
      return { rows: BAL
        .filter((b) => b.entity_id === entity_id && b.item_id === item_id && b.location === location && b.qty > 0)
        .sort((a, z) => String(a.expires_at || '9999-12-31').localeCompare(String(z.expires_at || '9999-12-31'))
                        || String(a.lot).localeCompare(String(z.lot))) };
    }
    if (/SELECT [\s\S]*FROM stock_balance[\s\S]*FOR UPDATE/.test(sql)) {
      const k = args.join('|');
      return { rows: BAL.filter((b) => key(b) === k) };
    }
    /* ⚠️ TWO DIFFERENT UPDATEs, and the stub has to tell them apart — matching both with one branch made the
       repair path assign a movement COUNT into last_at and then increment moves anyway. The stub was wrong, not
       the code, but it cost a red test to find: a fake that is sloppier than the real schema tests nothing. */
    if (/^\s*UPDATE stock_balance/.test(sql) && /moves = \$7/.test(sql)) {      /* rebuild --repair */
      const [entity_id, item_id, location, qty, value, avg_cost, moves, lot] = args;
      const b = BAL.find((x) => key(x) === [entity_id, item_id, location, lot || ''].join('|'));
      Object.assign(b, { qty: Number(qty), value: Number(value), avg_cost: Number(avg_cost), moves: Number(moves) });
      return { rows: [] };
    }
    if (/^\s*UPDATE stock_balance/.test(sql)) {                                 /* post() */
      const [entity_id, item_id, location, qty, value, avg_cost, at, unit, expires_at, lot] = args;
      const b = BAL.find((x) => key(x) === [entity_id, item_id, location, lot || ''].join('|'));
      Object.assign(b, { qty: Number(qty), value: Number(value), avg_cost: Number(avg_cost),
                         unit: b.unit || unit || null, last_at: at, moves: b.moves + 1 });
      return { rows: [] };
    }
    if (/SELECT [\s\S]*FROM stock_balance/.test(sql)) {
      const k = args.join('|');
      return { rows: BAL.filter((b) => key(b) === k) };
    }
    if (/FROM stock_movement/.test(sql)) {
      const [entity_id, item_id, location] = args;
      return { rows: MOVES.filter((m) => m.entity_id === entity_id && m.item_id === item_id
                                      && m.location === location)
                          .sort((a, z) => String(a.at).localeCompare(String(z.at))) };
    }
    if (/^\s*UPDATE stock_movement|^\s*DELETE FROM stock_movement/i.test(sql))
      throw new Error('stock_movement is append-only by GRANT');
    return { rows: [] };
  },
});

const at = (n) => new Date(Date.UTC(2026, 8, n, 10, 0, 0)).toISOString();

(async () => {
console.log('— the ordinary week —');

await ita('⭐ opening stock, then a delivery: the average is the blend', async () => {
  await store.post(SHOP, { item_id: RICE, reason: 'opening',  qty: 10, rate: 100, ref: 'OPEN', line_ref: '1', at: at(1) }, withEntity);
  await store.post(SHOP, { item_id: RICE, reason: 'purchase', qty: 10, rate: 120, ref: 'GRN-1', line_ref: '1', at: at(2) }, withEntity);
  const b = await store.balanceOf(SHOP, RICE, withEntity);
  assert.strictEqual(b.qty, 20);
  assert.strictEqual(b.value, 2200);
  assert.strictEqual(b.avg_cost, 110, '(10×100 + 10×120) ÷ 20');
});

await ita('⭐⭐ a SALE does not move the average — that is the whole point of the method', async () => {
  const r = await store.post(SHOP, { item_id: RICE, reason: 'sale', qty: 5, ref: 'B-001', line_ref: '1', at: at(3) }, withEntity);
  assert.strictEqual(r.balance.qty, 15);
  assert.strictEqual(r.balance.avg_cost, 110, 'issuing stock changed what the remaining stock cost');
  assert.strictEqual(r.balance.value, 1650);
});

await ita('⭐⭐⭐ the same bill arriving again moves NOTHING — the counter replays its queue for a living', async () => {
  const before = await store.balanceOf(SHOP, RICE, withEntity);
  const r = await store.post(SHOP, { item_id: RICE, reason: 'sale', qty: 5, ref: 'B-001', line_ref: '1', at: at(3) }, withEntity);
  assert.strictEqual(r.duplicate, true, 'a replayed bill was recorded a second time');
  const after = await store.balanceOf(SHOP, RICE, withEntity);
  assert.deepStrictEqual([after.qty, after.value], [before.qty, before.value], 'a replay moved the balance');
  assert.strictEqual(MOVES.filter((m) => m.ref === 'B-001').length, 1);
});

await ita('⚠️ but the SAME bill for a DIFFERENT line is a different movement', async () => {
  const r = await store.post(SHOP, { item_id: RICE, reason: 'sale', qty: 1, ref: 'B-001', line_ref: '2', at: at(3) }, withEntity);
  assert.strictEqual(r.duplicate, false, 'two lines of one bill were collapsed into one movement');
});

console.log('— what the caller is not trusted with —');

await ita('⭐⭐ the SIGN comes from the REASON, never from the caller', async () => {
  /* a sale sent with a positive quantity must still REMOVE stock; the alternative is a row that adds stock and
     looks completely ordinary for ever */
  const before = (await store.balanceOf(SHOP, RICE, withEntity)).qty;
  await store.post(SHOP, { item_id: RICE, reason: 'sale', qty: 2, ref: 'B-002', line_ref: '1', at: at(4) }, withEntity);
  const after = (await store.balanceOf(SHOP, RICE, withEntity)).qty;
  assert.strictEqual(after, before - 2, 'a positive quantity on a sale did not take stock out');
  assert.ok(MOVES.find((m) => m.ref === 'B-002').qty < 0, 'the stored movement must be signed');
});

await ita('⚠️ a receipt with no cost price is refused — unvalued stock can never be valued later', async () => {
  const r = await store.post(SHOP, { item_id: RICE, reason: 'purchase', qty: 5, ref: 'GRN-X', line_ref: '1' }, withEntity);
  assert.strictEqual(r.ok, false);
  assert.ok(/cost price/.test(r.why), 'got: ' + r.why);
  assert.ok(!MOVES.some((m) => m.ref === 'GRN-X'), 'a refused movement must not reach the log');
});

console.log('— the shelf disagrees —');

await ita('⭐⭐ stock can go below zero, and it is FLAGGED rather than blocked', async () => {
  const b = await store.balanceOf(SHOP, RICE, withEntity);
  const r = await store.post(SHOP, { item_id: RICE, reason: 'sale', qty: b.qty + 3, ref: 'B-003', line_ref: '1', at: at(5) }, withEntity);
  assert.strictEqual(r.ok, true, 'an offline counter cannot know what is on the shelf, so this must never be refused');
  assert.strictEqual(r.below_zero, true, 'below-zero stock has to be said, or nobody goes and counts');
  assert.strictEqual(r.balance.qty, -3);
});

await ita('⭐ a receipt onto negative stock takes the incoming rate as the average', async () => {
  const r = await store.post(SHOP, { item_id: RICE, reason: 'purchase', qty: 10, rate: 90, ref: 'GRN-2', line_ref: '1', at: at(6) }, withEntity);
  assert.strictEqual(r.balance.qty, 7);
  assert.strictEqual(r.balance.avg_cost, 90, 'there is no meaningful prior cost to blend with when the balance was under water');
});

await ita('⭐ a count posts the DIFFERENCE, it never overwrites', async () => {
  const before = (await store.balanceOf(SHOP, RICE, withEntity)).qty;
  await store.post(SHOP, { item_id: RICE, reason: 'count_adjust', qty: -1, ref: 'CNT-1', line_ref: '1',
                           note: 'counted 6, book said 7', at: at(7) }, withEntity);
  const after = await store.balanceOf(SHOP, RICE, withEntity);
  assert.strictEqual(after.qty, before - 1);
  assert.ok(MOVES.find((m) => m.ref === 'CNT-1').note, 'a count that does not say what was found is unarguable');
});

console.log('— the balance is a cache —');

await ita('⭐⭐⭐ a replay of the log lands exactly where the stored balance is', async () => {
  const r = await store.rebuild(SHOP, RICE, withEntity);
  assert.strictEqual(r.agrees, true,
    'stored ' + JSON.stringify(r.stored) + ' vs replayed ' + JSON.stringify(r.replayed));
  assert.strictEqual(r.refused.length, 0, 'the log contains a movement the engine will not apply');
});

await ita('⭐⭐ and when they disagree, THE LOG WINS', async () => {
  const b = BAL.find((x) => x.item_id === RICE);
  b.qty = 999; b.value = 99999;                        /* somebody, or something, corrupted the cache */
  const found = await store.rebuild(SHOP, RICE, withEntity);
  assert.strictEqual(found.agrees, false, 'drift was not detected');
  /* ⚠️ AND IT DID NOT QUIETLY FIX IT. A checker that silently repairs destroys the evidence of the drift it exists
     to find — so repair is asked for, explicitly. */
  assert.strictEqual(found.repaired, false, 'rebuild repaired without being asked');
  assert.strictEqual(BAL.find((x) => x.item_id === RICE).qty, 999, 'it wrote when it was only asked to check');

  const fixed = await store.rebuild(SHOP, RICE, withEntity, { repair: true });
  assert.strictEqual(fixed.repaired, true);
  assert.strictEqual(BAL.find((x) => x.item_id === RICE).qty, fixed.replayed.qty);
  assert.strictEqual((await store.rebuild(SHOP, RICE, withEntity)).agrees, true);
});

await ita('⚠️⚠️ nothing corrects stock by editing a movement', async () => {
  await assert.rejects(
    () => withEntity(SHOP, (db) => db.query('UPDATE stock_movement SET qty = 0 WHERE ref = $1', ['B-001'])),
    /append-only/, 'an UPDATE against the movement log was allowed');
});

console.log('— what was lost, and why —');

await ita('⭐⭐ shrinkage is separable, which is the whole reason reason codes exist', async () => {
  await store.post(SHOP, { item_id: RICE, reason: 'expiry', qty: 1, ref: 'W-1', line_ref: '1', at: at(8) }, withEntity);
  await store.post(SHOP, { item_id: RICE, reason: 'damage', qty: 1, ref: 'W-2', line_ref: '1', at: at(9) }, withEntity);
  const lost = MOVES.filter((m) => inventory.isShrink(m.reason));
  assert.ok(lost.length >= 3, 'expiry, damage and the count adjustment are all losses');
  assert.ok(!inventory.isShrink('sale'), 'a sale is not shrinkage');
  assert.ok(!inventory.isShrink('purchase_return'), 'sending goods back is not a loss');
  /* ⭐ the point: "₹8,400 expired in July" is actionable; "the stock is wrong" is not */
  assert.deepStrictEqual(new Set(lost.map((m) => m.reason)), new Set(['count_adjust', 'expiry', 'damage']));
});

await ita('⭐ and every movement ever posted is still there', async () => {
  assert.ok(MOVES.length >= 9, 'only ' + MOVES.length + ' movements — something removed history');
  assert.ok(MOVES.every((m) => m.qty !== 0 || m.reason === 'writedown'),
    'a movement of nothing records nothing and should never have been written');
});


console.log('— what a chit actually moves —');

await ita('⭐⭐⭐ STOCK MOVES WHEN GOODS MOVE — an order is a promise, not a movement', () => {
  const fromChit = require(path.join(__dirname, '..', 'lib', 'stock-from-chit.js'));
  const line = [{ item_id: RICE, quantity: 2, unit: 'kg' }];
  const none = [
    ['a draft',        { is_draft: true, purpose: 'order', business_json: { bill_no: 'X' }, line_items: line }],
    ['an order',       { purpose: 'order', business_json: {}, line_items: line }],
    ['a despatch note',{ purpose: 'delivery_note', business_json: { doc: 'despatch' }, line_items: line }],
    ['no lines',       { purpose: 'order', business_json: { bill_no: 'X' }, line_items: [] }],
  ];
  for (const [what, chit] of none)
    assert.deepStrictEqual(fromChit.movementsFor(chit), [], what + ' must not move stock');
  /* ⚠️ THE DESPATCH ONE IS A DECISION, NOT AN OVERSIGHT: for a counter shop the bill IS the handover, so posting
     on both would take the same goods out twice. Which document is authoritative is a question about the
     business, and it needs Athi. */
});

await ita('⭐⭐ a counter bill takes stock OUT; goods-in puts it IN at the LANDED cost', () => {
  const fromChit = require(path.join(__dirname, '..', 'lib', 'stock-from-chit.js'));
  const sale = fromChit.movementsFor({ purpose: 'order', business_json: { bill_no: 'C1/7', client_ref: 'C1/7' },
    line_items: [{ item_id: RICE, quantity: 2, unit: 'kg' }] });
  assert.strictEqual(sale.length, 1);
  assert.strictEqual(sale[0].reason, 'sale');
  assert.strictEqual(sale[0].ref, 'C1/7', 'the ref must be the document number, or a replay is not idempotent');

  const grn = fromChit.movementsFor({ purpose: 'receipt', business_json: { doc: 'receipt', doc_no: 'GRN-9' },
    line_items: [{ quantity: 10, unit: 'kg', price: 100, item_data: { item_id: RICE, unit_cost: 112.5 } }] });
  assert.strictEqual(grn[0].reason, 'purchase');
  /* ⭐ Ind AS 2: inventory cost includes freight and handling, so the LANDED figure wins over the supplier's bare
     rate. Taking price here would understate every margin in the shop. */
  assert.strictEqual(grn[0].rate, 112.5, 'the landed unit cost must beat the supplier rate');
});

await ita('⚠️ the item id is read from BOTH places the two builders put it', () => {
  const fromChit = require(path.join(__dirname, '..', 'lib', 'stock-from-chit.js'));
  assert.strictEqual(fromChit.itemIdOf({ item_id: 'a' }), 'a', 'the counter sale puts it at the top level');
  assert.strictEqual(fromChit.itemIdOf({ item_data: { item_id: 'b' } }), 'b', 'goods-in puts it in item_data');
  assert.strictEqual(fromChit.itemIdOf({ particulars: 'Delivery' }), null, 'a free-text line has no product');
});

await ita('⭐⭐ posting the same chit twice moves nothing the second time', async () => {
  const fromChit = require(path.join(__dirname, '..', 'lib', 'stock-from-chit.js'));
  const chit = { purpose: 'receipt', business_json: { doc: 'receipt', doc_no: 'GRN-DUP' },
    created_at: at(12), line_items: [{ quantity: 4, unit: 'kg', price: 50, item_data: { item_id: RICE, line_id: 'L1' } }] };
  const first = await fromChit.postFor(SHOP, chit, withEntity);
  const again = await fromChit.postFor(SHOP, chit, withEntity);
  assert.strictEqual(first.moved, 1);
  assert.strictEqual(again.moved, 0);
  assert.strictEqual(again.duplicate, 1, 'a replayed goods receipt added stock a second time');
});

await ita('⚠️⚠️ a receipt with no cost price is REPORTED, not silently dropped', async () => {
  const fromChit = require(path.join(__dirname, '..', 'lib', 'stock-from-chit.js'));
  const r = await fromChit.postFor(SHOP, { purpose: 'receipt', business_json: { doc: 'receipt', doc_no: 'GRN-NC' },
    line_items: [{ quantity: 3, item_data: { item_id: RICE } }] }, withEntity);
  assert.strictEqual(r.moved, 0);
  assert.strictEqual(r.skipped.length, 1, 'an unvalued receipt must be named, or half the shop goes missing quietly');
  assert.ok(/cost price/.test(r.skipped[0].why));
});

await ita('⭐⭐ and a unit that does not match the balance is REFUSED, never converted', async () => {
  const CASES = '33333333-3333-3333-3333-333333333333';
  await store.post(SHOP, { item_id: CASES, reason: 'purchase', qty: 5, rate: 100, unit: 'kg', ref: 'U-1', line_ref: '1', at: at(13) }, withEntity);
  const bad = await store.post(SHOP, { item_id: CASES, reason: 'purchase', qty: 1, rate: 1200, unit: 'case', ref: 'U-2', line_ref: '1', at: at(14) }, withEntity);
  assert.strictEqual(bad.ok, false, 'a case was added to a balance counted in kg');
  assert.ok(/counted in kg/.test(bad.why) && /in case/.test(bad.why), 'the refusal must name BOTH units: ' + bad.why);
  const b = await store.balanceOf(SHOP, CASES, withEntity);
  assert.strictEqual(b.qty, 5, 'a refused movement must leave the balance alone');
});


console.log('— per batch, resolved from the vertical —');

await ita('⭐⭐⭐ the vertical decides, and the product may overrule it — in both directions', () => {
  const L = require(path.join(__dirname, '..', 'lib', 'lotfields.js'));
  assert.strictEqual(L.tracksBatch({ sectors: ['Pharmaceuticals'] }).tracked, true, 'pharma must track batches');
  assert.strictEqual(L.tracksBatch({ sectors: ['kirana'] }).tracked, true, 'FMCG requires a batch');
  assert.strictEqual(L.tracksBatch({ sectors: ['apparel'] }).tracked, false, 'garments need no batch');
  /* ⚠️ A SHOP WITH NO SECTOR TRACKS NOTHING. Guessing would put a batch box in front of someone selling vegetables. */
  assert.strictEqual(L.tracksBatch({ sectors: [] }).tracked, false);
  /* both overrides have a real shop behind them */
  assert.strictEqual(L.tracksBatch({ sectors: ['fmcg'], item: { item_data: { batch_tracked: false } } }).tracked, false,
    'loose rice out of one sack must be allowed to opt out');
  assert.strictEqual(L.tracksBatch({ sectors: [], item: { item_data: { batch_tracked: true } } }).tracked, true,
    'one shelf of medicines in a general store must be allowed to opt in');
});

await ita('⚠️⚠️ a lot key is normalised, because a recall that misses stock on a space is the worst bug here', () => {
  const L = require(path.join(__dirname, '..', 'lib', 'lotfields.js'));
  assert.strictEqual(L.lotKey(' a-4471 '), 'A-4471');
  assert.strictEqual(L.lotKey(null), '', 'untracked stock is the empty string, never null');
});

await ita('⚠️ tracked stock cannot be RECEIVED without a batch number', async () => {
  const MED = '44444444-4444-4444-4444-444444444444';
  const r = await store.post(SHOP, { item_id: MED, reason: 'purchase', qty: 10, rate: 5, tracked: true,
                                     ref: 'GRN-NOBATCH', line_ref: '1', at: at(20) }, withEntity);
  assert.strictEqual(r.ok, false, 'a nameless pool alongside the named ones is the one a recall cannot clear');
  assert.ok(/batch number/.test(r.why), r.why);
});

console.log('— FEFO —');

const MED = '55555555-5555-5555-5555-555555555555';

await ita('⭐ two batches, and the one expiring SOONER goes first even though it arrived LATER', async () => {
  /* the long-dated batch arrives first… */
  await store.post(SHOP, { item_id: MED, reason: 'purchase', qty: 10, rate: 5, tracked: true,
    lot: 'B-LONG', expires_at: '2027-12-31', ref: 'GRN-L', line_ref: '1', at: at(21) }, withEntity);
  /* …then a short-dated one, which is exactly the case where FIFO would be wrong */
  await store.post(SHOP, { item_id: MED, reason: 'purchase', qty: 4, rate: 5, tracked: true,
    lot: 'B-SHORT', expires_at: '2026-10-01', ref: 'GRN-S', line_ref: '1', at: at(22) }, withEntity);
  const lots = await store.lotsOf(SHOP, MED, withEntity);
  assert.strictEqual(lots[0].lot, 'B-SHORT', 'FEFO orders by expiry, not by arrival: ' + JSON.stringify(lots.map((l) => l.lot)));
});

await ita('⭐⭐⭐ one sale line splits across batches when the first cannot cover it', async () => {
  const r = await store.issue(SHOP, { item_id: MED, reason: 'sale', qty: 6, tracked: true,
    ref: 'B-FEFO', line_ref: '1', at: at(23) }, withEntity);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.parts.length, 2, 'six units over a batch holding four must touch two batches');
  assert.strictEqual(r.parts[0].lot, 'B-SHORT');
  assert.strictEqual(r.parts[0].qty, 4, 'the short-dated batch is emptied first');
  assert.strictEqual(r.parts[1].lot, 'B-LONG');
  assert.strictEqual(r.parts[1].qty, 2);
  assert.strictEqual((await store.balanceOf(SHOP, MED, withEntity, null, 'B-SHORT')).qty, 0);
  assert.strictEqual((await store.balanceOf(SHOP, MED, withEntity, null, 'B-LONG')).qty, 8);
});

await ita('⭐⭐ and replaying that split bill moves nothing — both halves are idempotent', async () => {
  const again = await store.issue(SHOP, { item_id: MED, reason: 'sale', qty: 6, tracked: true,
    ref: 'B-FEFO', line_ref: '1', at: at(23) }, withEntity);
  assert.strictEqual(again.moved, 0, 'a replayed split sale moved stock a second time');
  assert.strictEqual((await store.balanceOf(SHOP, MED, withEntity, null, 'B-LONG')).qty, 8);
  /* ⚠️ THIS IS WHY b215 PUT THE LOT IN THE UNIQUE INDEX. Without it the two halves share a line_ref, the second
     would be refused as a duplicate on the FIRST run, and the sale would be short by two units in silence. */
});

await ita('⚠️⚠️ selling more than every batch holds is ALLOWED, and the shortfall is reported', async () => {
  const r = await store.issue(SHOP, { item_id: MED, reason: 'sale', qty: 20, tracked: true,
    ref: 'B-OVER', line_ref: '1', at: at(24) }, withEntity);
  assert.strictEqual(r.ok, true, 'an offline counter cannot know the shelf, so a sale is never blocked');
  assert.strictEqual(r.short, 12, '8 on hand, 20 sold — the shop is 12 short and needs to count');
  const lots = await store.lotsOf(SHOP, MED, withEntity);
  assert.strictEqual(lots.length, 0, 'nothing is left holding positive stock');
});

await ita('⭐ an untracked product still goes through issue() as ONE ordinary movement', async () => {
  const SOAP = '66666666-6666-6666-6666-666666666666';
  await store.post(SHOP, { item_id: SOAP, reason: 'purchase', qty: 10, rate: 20, ref: 'GRN-SOAP', line_ref: '1', at: at(25) }, withEntity);
  const r = await store.issue(SHOP, { item_id: SOAP, reason: 'sale', qty: 3, tracked: false, ref: 'B-SOAP', line_ref: '1', at: at(26) }, withEntity);
  assert.strictEqual(r.parts.length, 1, 'untracked stock is one pool and must not be split');
  assert.strictEqual((await store.balanceOf(SHOP, SOAP, withEntity)).qty, 7);
});

console.log(pass + ' checks');
})();
