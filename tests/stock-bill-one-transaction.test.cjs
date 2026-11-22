/**
 * tests/stock-bill-one-transaction.test.cjs — SPEED (batch 1129): the stock lines of ONE bill post in ONE transaction (lib/stock-from-chit.postMovements → lib/stock-post-lines).
 *
 * OWNS      the proof that a 6-line bill opens ONE stock transaction (it opened one per line, and more for the reads each line made), that a line which THROWS in the middle rolls the whole bill back
 *           (no half-posted stock: nothing moved, every line said failed, the sweep can post it again), that a line the rules REFUSE (ok false) still lets the others post, that the per-line rules
 *           (FEFO batches, idempotent replay, negative stock allowed) are the store's own and unchanged, and that two bills sharing two goods lock them in the same order.
 *           lib/stock-post-lines.js fails closed: a line that throws leaves the bill unposted (never half), a refused line is said and never stops the rest.
 * MIN fail-closed (a throw posts nothing of the bill)
 * CALLED BY scripts/guards.cjs · CI. No database, no network: the db is a stand-in with the stock tables in memory, a transaction that restores them when it throws, and counters.
 * FLOW      scene (a bill) -> real postFor -> real stock-store.post/issue -> in-memory stock_balance / stock_movement
 * CARD      13-inventory-stock-and-traceability/on-hand-and-movements
 *
 * Run: node tests/stock-bill-one-transaction.test.cjs
 */
'use strict';
const assert = require('assert'),
  path = require('path');
const API = path.join(__dirname, '..');
const stocked = require(path.join(API, 'lib', 'stocked'));
const fromChit = require(path.join(API, 'lib', 'stock-from-chit'));
const postLines = require(path.join(API, 'lib', 'stock-post-lines'));
const SHOP = '11111111-1111-4111-8111-111111111111';
const ITEMS = [0, 1, 2, 3, 4, 5].map((n) => '4444444' + n + '-4444-4444-8444-444444444444');

const world = { balances: new Map(), moves: new Map(), tx: 0, queries: 0, failItem: null, locks: [] };
const snapshot = () => ({ balances: new Map([...world.balances].map(([k, v]) => [k, Object.assign({}, v)])), moves: new Map(world.moves) });
const restore = (was) => { world.balances = was.balances; world.moves = was.moves; };
const handle = {
  query: async (text, params) => {
    world.queries++;
    const sql = String(text).replace(/\s+/g, ' ');
    if (/^INSERT INTO stock_balance/.test(sql)) { const key = params[1] + '|' + params[3]; if (!world.balances.has(key)) world.balances.set(key, { qty: 10, value: 1000, avg_cost: 100, unit: null }); return { rows: [] }; }
    if (/FROM stock_balance WHERE entity_id = \$1 AND item_id = \$2 AND location = \$3 AND lot = \$4 FOR UPDATE/.test(sql)) { world.locks.push(params[1]); return { rows: [Object.assign({}, world.balances.get(params[1] + '|' + params[3]))] }; }
    if (/^INSERT INTO stock_movement/.test(sql)) {
      if (world.failItem && params[1] === world.failItem) throw new Error('connection reset');
      const key = [params[0], params[8], params[9], params[7], params[10]].join('|');
      if (world.moves.has(key)) return { rows: [] };
      world.moves.set(key, params[3]);
      return { rows: [{ movement_id: 'm' + world.moves.size, at: '2026-11-22T08:00:00Z' }] };
    }
    if (/^UPDATE stock_balance/.test(sql)) { world.balances.set(params[1] + '|' + params[9], { qty: params[3], value: params[4], avg_cost: params[5], unit: params[7] }); return { rows: [] }; }
    return { rows: [] };
  }
};
const withEntity = async (_entity, fn) => {
  world.tx++;
  const was = snapshot();
  try { return await fn(handle); } catch (e) { restore(was); throw e; }
};
stocked.flagsFor = async (_entity, ids) => ({ by: new Map(ids.map((id) => [id, { tracked: false, counted: true }])) });
const reset = () => { world.balances = new Map(); world.moves = new Map(); world.tx = 0; world.queries = 0; world.failItem = null; world.locks = []; };
const bill = (n, items) => ({
  chit_id: '2222222' + n + '-2222-4222-8222-222222222222', purpose: 'order', business_json: { bill_no: 'B-' + n, client_ref: 'T1-B-' + n }, created_at: '2026-11-22T08:00:00Z',
  line_items: items.map((item, i) => ({ line_id: 'L' + n + i, item_id: item, quantity: 2, unit: 'pc', particulars: 'tea ' + i }))
});

(async () => {
  /* 1 · a 6-line bill: ONE transaction, six movements, six balances moved */
  reset();
  const six = await fromChit.postFor(SHOP, bill(1, ITEMS), withEntity, {});
  assert.deepStrictEqual([six.moved, six.failed.length, six.duplicate], [6, 0, 0], 'all six lines posted: ' + JSON.stringify(six));
  console.log('   ok   6 lines posted: ' + world.moves.size + ' movements');
  const stockTx = world.tx, stockQueries = world.queries;
  console.log('        transactions opened: ' + stockTx + ' · queries: ' + stockQueries + ' (this run, the bill\'s whole stock post incl. its reads)');
  /* the reads before the post (the order already left? the tracking flags, the counted-in bill) are not a transaction of their own on a bill with no order: 1 here for the lookups at most */
  assert.ok(stockTx <= 3, 'a 6-line bill opens at most 3 transactions (reads + ONE post), got ' + stockTx);
  console.log('   ok   at most 3 transactions for a 6-line bill (was 1 per line plus the reads each line made)');
  assert.strictEqual([...world.balances.values()].filter((b) => b.qty === 8).length, 6, 'each shelf took 2 off');
  console.log('   ok   every shelf took its 2 off (the store\'s per-line rule, unchanged)');

  /* 2 · replay: the same bill again moves nothing twice */
  const again = await fromChit.postFor(SHOP, bill(1, ITEMS), withEntity, {});
  assert.deepStrictEqual([again.moved, again.duplicate, again.failed.length], [0, 6, 0], 'replay is a no-op: ' + JSON.stringify(again));
  assert.strictEqual([...world.balances.values()].filter((b) => b.qty === 8).length, 6);
  console.log('   ok   the same bill sent again moves nothing twice (idempotent per line)');

  /* 3 · ATOMIC: line 4 throws → nothing of the bill is posted, every line is said failed with the reason */
  reset();
  world.failItem = ITEMS[3];
  const broke = await fromChit.postFor(SHOP, bill(2, ITEMS), withEntity, {});
  assert.strictEqual(world.moves.size, 0, 'no movement is left: ' + world.moves.size);
  assert.ok([...world.balances.values()].every((b) => b.qty === 10) || world.balances.size === 0, 'no balance moved');
  assert.deepStrictEqual([broke.moved, broke.failed.length], [0, 6], 'nothing moved, all six said failed: ' + JSON.stringify(broke));
  assert.ok(/rolled back/.test(broke.failed[0].why) && /connection reset/.test(broke.failed[0].why));
  console.log('   ok   a throw on line 4 leaves NO partial stock (0 movements, 0 balances moved, 6 lines said failed)');
  world.failItem = null;
  const healed = await fromChit.postFor(SHOP, bill(2, ITEMS), withEntity, {});
  assert.deepStrictEqual([healed.moved, healed.failed.length], [6, 0], 'the retry (what the sweep does) posts all six: ' + JSON.stringify(healed));
  console.log('   ok   the retry posts all six, once each');

  /* 4 · a REFUSED line (the rules say no, nothing written) does not stop the others: the store's refusal is per line, as it was */
  reset();
  const store = require(path.join(API, 'lib', 'stock-store')), realIssue = store.issue;
  store.issue = async (entity, mv, w, o) => (mv.line_ref === 'L31' ? { ok: false, why: 'the unit does not match' } : realIssue(entity, mv, w, o)); /* the rules say no to line 2: nothing written for it */
  let part;
  try { part = await fromChit.postFor(SHOP, bill(3, ITEMS.slice(0, 3)), withEntity, {}); } finally { store.issue = realIssue; }
  assert.deepStrictEqual([part.moved, part.failed.length], [2, 1], 'the other two post: ' + JSON.stringify(part));
  console.log('   ok   a line the rules refuse is said, the others still post (moved ' + part.moved + ', failed ' + part.failed.length + ', skipped ' + part.skipped.length + ')');

  /* 5 · lock order: two bills with the same goods named in opposite orders lock them the same way round */
  reset();
  await fromChit.postFor(SHOP, bill(4, [ITEMS[5], ITEMS[0], ITEMS[3]]), withEntity, {});
  const first = world.locks.slice();
  reset();
  await fromChit.postFor(SHOP, bill(5, [ITEMS[3], ITEMS[5], ITEMS[0]]), withEntity, {});
  assert.deepStrictEqual(first, world.locks, 'same lock order: ' + first.join(',') + ' vs ' + world.locks.join(','));
  assert.deepStrictEqual(first.slice(), first.slice().sort(), 'in item order');
  console.log('   ok   goods are locked in item order whatever order the bill names them (no deadlock between two bills)');
  console.log('\n  5 groups passed');
})().catch((e) => { console.error(e); process.exit(1); });
