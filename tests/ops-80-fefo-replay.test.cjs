#!/usr/bin/env node
// @type: contract
/**
 * ops-80-fefo-replay.test.cjs — OPS-80: a replayed FEFO issue of batch-tracked stock takes the goods out ONCE.
 *
 * OWNS      the proof that the same tracked sale line sent twice (a counter queue retry after a lost response), sent concurrently, or sent after the
 *           first call stopped half-way, leaves the lot rows and the stock movements exactly as the first call left them, and answers the first call's batches.
 * CALLED BY scripts/guards.cjs · CI. No database: lib/stock-store over a stand-in that holds the real unique key (uq_stock_movement_once: entity, ref, line_ref,
 *           reason, lot), a row lock on the balance (SELECT ... FOR UPDATE, held to the end of the transaction) and yields between statements so calls interleave.
 * FLOW      stock-store.issue → lotsOf / takenBefore / post → stand-in rows
 * CARD      13-inventory-stock-and-traceability/on-hand-and-movements
 */
'use strict';
const assert = require('assert');
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
const store = require('../lib/stock-store');

const SHOP = '11111111-1111-1111-1111-111111111111';
let n = 0;
let MOVES, BAL, LOCKS;
const tick = () => new Promise((resolve) => setImmediate(resolve));
const bkey = (entity_id, item_id, location, lot) => [entity_id, item_id, location, lot || ''].join('|');
const balKey = (b) => bkey(b.ent, b.item_id, b.location, b.lot);

async function lockRow(held, k) {
  while (LOCKS.has(k) && LOCKS.get(k) !== held) await tick();
  LOCKS.set(k, held);
}

/** the movement INSERT: the real unique index (a NULL ref or line_ref is never a duplicate), ON CONFLICT DO NOTHING */
function insertMovement(a) {
  const [ent, item_id, location, qty, rate, , , reason, ref, line_ref, lot] = a;
  if (ref != null && line_ref != null && MOVES.some((m) => m.ent === ent && m.ref === ref && m.line_ref === line_ref && m.reason === reason && m.lot === (lot || ''))) return { rows: [] };
  MOVES.push({ ent, item_id, location, qty: Number(qty), rate: rate == null ? null : Number(rate), reason, ref, line_ref, lot: lot || '' });
  return { rows: [{ movement_id: 'mv-' + MOVES.length, at: new Date().toISOString() }] };
}

/** the FEFO read: batches holding stock, earliest expiry first */
function fefoRows(a) {
  const rows = BAL.filter((b) => b.ent === a[0] && b.item_id === a[1] && b.location === a[2] && b.qty > 0);
  rows.sort((x, y) => String(x.expires_at || '9999').localeCompare(String(y.expires_at || '9999')) || x.lot.localeCompare(y.lot));
  return { rows: rows.map((b) => Object.assign({}, b)) };
}

/** one statement, answered by its shape */
async function answer(sql, a, held) {
  await tick();
  if (/^\s*INSERT INTO stock_movement/.test(sql)) return insertMovement(a);
  if (/^\s*INSERT INTO stock_balance/.test(sql)) {
    if (!BAL.some((b) => balKey(b) === bkey(a[0], a[1], a[2], a[3])))
      BAL.push({ ent: a[0], item_id: a[1], location: a[2], lot: a[3] || '', expires_at: a[4] || null, qty: 0, value: 0, avg_cost: 0, unit: null, moves: 0 });
    return { rows: [] };
  }
  if (/FROM stock_balance[\s\S]*qty > 0[\s\S]*ORDER BY expires_at/.test(sql)) return fefoRows(a);
  if (/SELECT [\s\S]*FROM stock_balance[\s\S]*FOR UPDATE/.test(sql)) {
    await lockRow(held, bkey(...a));
    return { rows: BAL.filter((b) => balKey(b) === bkey(...a)).map((b) => Object.assign({}, b)) };
  }
  if (/^\s*UPDATE stock_balance/.test(sql)) {
    const b = BAL.find((x) => balKey(x) === bkey(a[0], a[1], a[2], a[9]));
    Object.assign(b, { qty: Number(a[3]), value: Number(a[4]), avg_cost: Number(a[5]), moves: b.moves + 1 });
    return { rows: [] };
  }
  if (/SELECT COALESCE\(lot, ''\) AS lot, qty FROM stock_movement/.test(sql)) {
    const [ent, item_id, location, ref, line_ref, reason] = a;
    /* SQL semantics: `line_ref = $5` is never true for NULL; `IS NOT DISTINCT FROM` is (what the first version of this query used) */
    const nullSafe = /IS NOT DISTINCT FROM/.test(sql);
    const sameLine = (m) => (nullSafe ? (m.line_ref ?? null) === (line_ref ?? null) : line_ref != null && m.line_ref === line_ref) || (line_ref != null && (m.line_ref || '').startsWith(line_ref + '#top-up')); /* position(...) = 1 */
    return { rows: MOVES.filter((m) => m.ent === ent && m.item_id === item_id && m.location === location && m.ref === ref && sameLine(m) && m.reason === reason) };
  }
  if (/SELECT [\s\S]*FROM stock_balance/.test(sql)) return { rows: BAL.filter((b) => balKey(b) === bkey(...a)) };
  if (/SELECT rate FROM stock_movement/.test(sql)) {
    const [ent, item_id, location] = a; /* the item latest receipt cost */
    return { rows: MOVES.filter((m) => m.ent === ent && m.item_id === item_id && m.location === location && m.qty > 0 && m.rate != null).slice(-1) };
  }
  return { rows: [] };
}

/** one transaction: row locks are released when the function ends */
const withEntity = async (entity_id, fn) => {
  const held = {};
  try {
    return await fn({ query: (sql, a) => answer(sql, a, held) });
  } finally {
    for (const k of [...LOCKS.keys()]) if (LOCKS.get(k) === held) LOCKS.delete(k);
  }
};

/** a fresh shelf: lots = [[lot, qty, expires]] of one tracked product */
async function shelf(lots) {
  MOVES = [];
  BAL = [];
  LOCKS = new Map();
  const item = '22222222-2222-2222-2222-' + String(++n).padStart(12, '0');
  for (const [lot, qty, expires_at] of lots)
    await store.post(SHOP, { item_id: item, reason: 'purchase', qty, rate: 10, tracked: true, lot, expires_at, ref: 'GRN-' + lot, line_ref: '1' }, withEntity);
  return item;
}
const sale = (item, qty, extra) => Object.assign({ item_id: item, reason: 'sale', qty, tracked: true, ref: 'BILL-9', line_ref: '1' }, extra || {});
const outs = (ref) => MOVES.filter((m) => m.reason === 'sale' && (!ref || m.ref === ref)).map((m) => m.lot + ':' + m.qty).sort().join(',');
const level = async (item, lot) => (await store.balanceOf(SHOP, item, withEntity, null, lot)).qty;
const shape = (r) => r.parts.map((p) => p.lot + ':' + p.qty).sort().join(',');

let pass = 0;
const it = async (what, fn) => {
  try { await fn(); pass++; console.log('  ok  ' + what); } catch (e) { console.log('  FAIL ' + what + '\n       ' + e.message); process.exitCode = 1; }
};
const AB = () => shelf([['A', 5, '2026-12-01'], ['B', 3, '2027-01-01']]);

(async () => {
  console.log('ops-80-fefo-replay');

  await it('the OPS-80 repro: A=5 and B=3, issue 8 twice — the second call is a duplicate and nothing moves', async () => {
    const item = await AB();
    const first = await store.issue(SHOP, sale(item, 8), withEntity);
    const second = await store.issue(SHOP, sale(item, 8), withEntity);
    assert.strictEqual(first.moved, 2);
    assert.strictEqual(second.moved, 0, 'the retry moved stock: ' + outs());
    assert.strictEqual(second.duplicate, 2);
    assert.strictEqual(second.short, 0);
    assert.strictEqual(outs(), 'A:-5,B:-3', 'one movement per batch, no pool row');
    assert.deepStrictEqual([await level(item, 'A'), await level(item, 'B'), await level(item, '')], [0, 0, 0]);
  });

  await it("the retry returns the FIRST issue's allocations (lot and qty), not a new plan", async () => {
    const item = await AB();
    const first = await store.issue(SHOP, sale(item, 8), withEntity);
    const second = await store.issue(SHOP, sale(item, 8), withEntity);
    assert.strictEqual(shape(second), shape(first));
    assert.ok(second.parts.every((p) => p.ok && p.duplicate));
  });

  await it('a partial batch spanning two lots (A holds 3 of 5, sale of 5 takes A 3 and B 2), replayed — exactly once', async () => {
    const item = await shelf([['A', 5, '2026-12-01'], ['B', 6, '2027-01-01']]);
    await store.issue(SHOP, sale(item, 2, { ref: 'EARLIER' }), withEntity); /* A now holds 3 */
    const first = await store.issue(SHOP, sale(item, 5), withEntity);
    assert.strictEqual(outs('BILL-9'), 'A:-3,B:-2');
    const again = await store.issue(SHOP, sale(item, 5), withEntity);
    assert.strictEqual(first.moved, 2);
    assert.strictEqual(again.moved, 0, 'moved again: ' + outs());
    assert.strictEqual(shape(again), shape(first));
    assert.deepStrictEqual([await level(item, 'A'), await level(item, 'B'), await level(item, '')], [0, 4, 0]);
  });

  await it('a call that stopped after the first batch is COMPLETED by the retry, the posted batch not taken again', async () => {
    const item = await AB();
    await store.post(SHOP, Object.assign(sale(item, 5), { lot: 'A' }), withEntity); /* the first call died here */
    const retry = await store.issue(SHOP, sale(item, 8), withEntity);
    assert.strictEqual(retry.ok, true);
    assert.strictEqual(outs(), 'A:-5,B:-3');
    assert.deepStrictEqual([await level(item, 'A'), await level(item, 'B'), await level(item, '')], [0, 0, 0]);
  });

  await it('concurrent double send: both calls in flight at once — each lot row and movement exists once', async () => {
    const item = await AB();
    const both = await Promise.all([store.issue(SHOP, sale(item, 8), withEntity), store.issue(SHOP, sale(item, 8), withEntity)]);
    assert.ok(both.every((r) => r.ok), JSON.stringify(both.map((r) => r.why)));
    assert.strictEqual(outs(), 'A:-5,B:-3', 'doubled: ' + outs());
    assert.deepStrictEqual([await level(item, 'A'), await level(item, 'B'), await level(item, '')], [0, 0, 0]);
  });

  await it('three at once, with a shortfall: the short row is written once too', async () => {
    const item = await shelf([['A', 2, '2026-12-01']]);
    const all = await Promise.all([1, 2, 3].map(() => store.issue(SHOP, sale(item, 5), withEntity)));
    assert.ok(all.every((r) => r.ok));
    assert.strictEqual(outs(), ':-3,A:-2', outs());
    assert.deepStrictEqual([await level(item, 'A'), await level(item, '')], [0, -3]);
  });

  await it('a short sale (more than every batch holds) is recorded on the pool, not lost as its own duplicate', async () => {
    const item = await shelf([['A', 5, '2026-12-01']]);
    const r = await store.issue(SHOP, sale(item, 8), withEntity);
    assert.strictEqual(r.short, 3);
    assert.deepStrictEqual([await level(item, 'A'), await level(item, '')], [0, -3]);
    const again = await store.issue(SHOP, sale(item, 8), withEntity);
    assert.strictEqual(again.moved, 0);
    assert.deepStrictEqual([await level(item, 'A'), await level(item, '')], [0, -3]);
  });

  await it('two different sale lines are not mistaken for a replay', async () => {
    const item = await AB();
    await store.issue(SHOP, sale(item, 4), withEntity);
    await store.issue(SHOP, sale(item, 4, { line_ref: '2' }), withEntity);
    assert.deepStrictEqual([await level(item, 'A'), await level(item, 'B')], [0, 0]);
    assert.strictEqual(outs(), 'A:-1,A:-4,B:-3');
  });

  await it('a short sale is valued at the LAST KNOWN COST (the emptied batch average), not the pool average of 0', async () => {
    const item = await shelf([['A', 5, '2026-12-01']]); /* A costs 10 */
    await store.issue(SHOP, sale(item, 8), withEntity);
    const pool = await store.balanceOf(SHOP, item, withEntity, null, '');
    assert.deepStrictEqual([pool.qty, pool.value], [-3, -30], 'the 3 short units go out at 10, not 0');
    assert.strictEqual(MOVES.find((m) => m.lot === '' && m.reason === 'sale').rate, 10, 'the cost rides on the stored row, so a replay values it the same');
  });

  await it('a short with NO batch ever emptied falls back to the last receipt cost', async () => {
    const item = await shelf([['A', 5, '2026-12-01']]);
    await store.issue(SHOP, sale(item, 5, { ref: 'EMPTY-IT' }), withEntity); /* A is empty and gone from the FEFO read */
    await store.issue(SHOP, sale(item, 2, { ref: 'NEXT' }), withEntity); /* nothing on this sale to average: the last receipt rate (10) */
    assert.strictEqual((await store.balanceOf(SHOP, item, withEntity, null, '')).value, -20);
  });

  await it('a line with no line_ref is not read as a replay: two issues on one ref both take stock', async () => {
    const item = await shelf([['A', 10, '2026-12-01']]);
    const noLine = { item_id: item, reason: 'sale', qty: 3, tracked: true, ref: 'BILL-NL' };
    await store.issue(SHOP, noLine, withEntity);
    const second = await store.issue(SHOP, noLine, withEntity);
    assert.strictEqual(second.moved, 1, 'the second issue was swallowed as a replay');
    assert.strictEqual(await level(item, 'A'), 4);
  });

  await it('a replay asking for MORE (9 then 12, A holds 5) issues only the difference and records the extra short', async () => {
    const item = await shelf([['A', 5, '2026-12-01']]);
    const first = await store.issue(SHOP, sale(item, 9), withEntity);
    assert.strictEqual(first.short, 4);
    const again = await store.issue(SHOP, sale(item, 12), withEntity);
    assert.strictEqual(again.short, 3, 'the 3 extra units were dropped in silence');
    assert.strictEqual(again.moved, 1);
    assert.deepStrictEqual([await level(item, 'A'), await level(item, '')], [0, -7]);
    assert.strictEqual((await store.balanceOf(SHOP, item, withEntity, null, '')).value, -70, 'the extra short is valued at the last cost too');
    const third = await store.issue(SHOP, sale(item, 12), withEntity); /* and 12 again is now a plain replay */
    assert.deepStrictEqual([third.moved, third.short, third.note], [0, 0, null]);
    const fourth = await store.issue(SHOP, sale(item, 15), withEntity); /* a second revision up, a second top-up key */
    assert.deepStrictEqual([fourth.moved, fourth.short, await level(item, '')], [1, 3, -10]);
  });

  await it('a replay asking for the same or LESS is a no-op; less says so in a note, nothing is reversed', async () => {
    const item = await shelf([['A', 5, '2026-12-01']]);
    await store.issue(SHOP, sale(item, 9), withEntity);
    const same = await store.issue(SHOP, sale(item, 9), withEntity);
    assert.deepStrictEqual([same.moved, same.short, same.note], [0, 0, null]);
    const less = await store.issue(SHOP, sale(item, 6), withEntity);
    assert.strictEqual(less.moved, 0);
    assert.strictEqual(less.ok, true);
    assert.match(less.note, /already took 9.*6.*nothing was reversed/);
    assert.deepStrictEqual([await level(item, 'A'), await level(item, '')], [0, -4]);
  });

  console.log(pass + ' passed');
})();
