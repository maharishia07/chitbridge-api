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
const key = (r) => [r.entity_id, r.item_id, r.location].join('|');
const withEntity = async (entity_id, fn) => fn({
  query: async (sql, args) => {
    if (/^\s*INSERT INTO stock_movement/.test(sql)) {
      const [entity_id, item_id, location, qty, rate, value_delta, reason, ref, line_ref, lot, note, at] = args;
      /* the real unique index, reproduced — a replayed bill must not move stock twice */
      if (ref != null && MOVES.some((m) => m.entity_id === entity_id && m.ref === ref
            && m.line_ref === line_ref && m.reason === reason)) return { rows: [] };
      const row = { movement_id: 'mv-' + (MOVES.length + 1), entity_id, item_id, location,
                    qty: Number(qty), rate, value_delta, reason, ref, line_ref, lot, note,
                    at: at || new Date(Date.now() + MOVES.length * 1000).toISOString() };
      MOVES.push(row);
      return { rows: [{ movement_id: row.movement_id, at: row.at }] };
    }
    if (/^\s*INSERT INTO stock_balance/.test(sql)) {
      const [entity_id, item_id, location] = args;
      const k = [entity_id, item_id, location].join('|');
      if (!BAL.some((b) => key(b) === k))
        BAL.push({ entity_id, item_id, location, qty: 0, value: 0, avg_cost: 0, last_at: null, moves: 0 });
      return { rows: [] };
    }
    if (/^\s*SELECT qty, value, avg_cost FROM stock_balance/.test(sql)) {
      const k = args.join('|');
      return { rows: BAL.filter((b) => key(b) === k) };
    }
    /* ⚠️ TWO DIFFERENT UPDATEs, and the stub has to tell them apart — matching both with one branch made the
       repair path assign a movement COUNT into last_at and then increment moves anyway. The stub was wrong, not
       the code, but it cost a red test to find: a fake that is sloppier than the real schema tests nothing. */
    if (/^\s*UPDATE stock_balance/.test(sql) && /moves = \$7/.test(sql)) {      /* rebuild --repair */
      const [entity_id, item_id, location, qty, value, avg_cost, moves] = args;
      const b = BAL.find((x) => key(x) === [entity_id, item_id, location].join('|'));
      Object.assign(b, { qty: Number(qty), value: Number(value), avg_cost: Number(avg_cost), moves: Number(moves) });
      return { rows: [] };
    }
    if (/^\s*UPDATE stock_balance/.test(sql)) {                                 /* post() */
      const [entity_id, item_id, location, qty, value, avg_cost, at] = args;
      const b = BAL.find((x) => key(x) === [entity_id, item_id, location].join('|'));
      Object.assign(b, { qty: Number(qty), value: Number(value), avg_cost: Number(avg_cost),
                         last_at: at, moves: b.moves + 1 });
      return { rows: [] };
    }
    if (/^\s*SELECT qty, value, avg_cost, last_at, moves FROM stock_balance/.test(sql)) {
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

console.log(pass + ' checks');
})();
