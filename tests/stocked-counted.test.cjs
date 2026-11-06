#!/usr/bin/env node
// @type: unit
/**
 * tests/stocked-counted.test.cjs — WHAT IS NOT STOCK NEVER MOVES A BALANCE (lib/stocked.js, R104).
 * UNIT      13 INVENTORY / STOCK & TRACEABILITY / On hand & movements (the "counted as stock" answer had no direct test; lib/stocked.js was reached by one file)
 * OWNS      the one answer behind "does a sale move stock for this item?": the PRODUCT's own flag wins both ways · else the TRADE decides (a restaurant cooks to order, a
 *           pharmacy sells what it stocks) · no trade declared → every item is counted (a default is not an answer to a question nobody asked) · the product flags are read
 *           in ONE query over the ids named (never per line) · an unreadable flag FAILS SAFE towards "counted" so a receipt of ghee never vanishes as a dish · notCountedOf
 *           returns exactly the items the shop does not count.
 * CALLED BY scripts/guards.cjs · CI. No database: withEntity is a stub that counts the queries it is sent; the trade is passed in (opts.trade).
 * FLOW      stockedFor (pure) → flagsFor / notCountedOf over a stub withEntity → asserted
 * CARD      13-inventory-stock-and-traceability/on-hand-and-movements
 */
'use strict';
process.env.DATABASE_URL = process.env.DATABASE_URL || '';
const assert = require('assert');
const path = require('path');
const stocked = require(path.join(__dirname, '..', 'lib', 'stocked.js'));

const QUERIES = [];
const flagRows = [
  { item_id: 'a1', batch_tracked: true, stocked: null },
  { item_id: 'a2', batch_tracked: null, stocked: false },
  { item_id: 'a3', batch_tracked: null, stocked: true },
  { item_id: 'a5', batch_tracked: 'yes', stocked: 'no' }
];
const withEntity = async (entity, fn) => fn({ query: async (sql, params) => { QUERIES.push({ sql, params }); return { rows: flagRows }; } });
const broken = async () => { throw new Error('connection reset'); };
const RESTAURANT = { key: 'restaurant', sectors: [] };
const PHARMACY = { key: 'pharmacy', sectors: [] };

let checks = 0;
async function it(what, fn) { QUERIES.length = 0; await fn(); checks++; console.log('  ok  ' + what); }

(async () => {
  await it('the product\'s own flag wins both ways: stocked:true on a restaurant dish counts it, stocked:false on a pharmacy item drops it', async () => {
    assert.strictEqual(stocked.stockedFor(RESTAURANT, true).counted, true);
    assert.strictEqual(stocked.stockedFor(PHARMACY, false).counted, false);
    assert.strictEqual(stocked.stockedFor(RESTAURANT, true).source, 'product');
  });

  await it('otherwise the trade decides, and the answer says which: a restaurant does not count a dish, a pharmacy counts everything', async () => {
    const dish = stocked.stockedFor(RESTAURANT, undefined);
    assert.deepStrictEqual([dish.counted, dish.source, dish.vertical], [false, 'vertical', 'restaurant']);
    assert.ok(/to order/.test(dish.why));
    const pill = stocked.stockedFor(PHARMACY, undefined);
    assert.deepStrictEqual([pill.counted, pill.source], [true, 'vertical']);
  });

  await it('no trade declared (null, {} or no key) counts every item and says no one asked — it never guesses a trade', async () => {
    for (const trade of [null, undefined, {}, { key: '' }]) {
      const r = stocked.stockedFor(trade, undefined);
      assert.deepStrictEqual([r.counted, r.source], [true, 'none'], JSON.stringify(trade));
    }
  });

  await it('only a real boolean is a product flag: "false", 0, null and undefined fall through to the trade', async () => {
    for (const odd of ['false', 0, null, undefined, 'no']) assert.strictEqual(stocked.stockedFor(RESTAURANT, odd).source, 'vertical', String(odd));
  });

  await it('flagsFor reads every product flag in ONE query over the ids named, never one per line', async () => {
    const ids = ['a1', 'a2', 'a3', 'a4', 'a5'];
    await stocked.flagsFor('shop-1', ids, withEntity, { trade: RESTAURANT });
    assert.strictEqual(QUERIES.length, 1, 'queries sent: ' + QUERIES.length);
    assert.strictEqual(QUERIES[0].sql, stocked.FLAGS_SQL);
    assert.deepStrictEqual(QUERIES[0].params, ['shop-1', ids]);
  });

  await it('no ids named → no query at all', async () => {
    const r = await stocked.flagsFor('shop-1', [], withEntity, { trade: RESTAURANT });
    assert.strictEqual(QUERIES.length, 0);
    assert.strictEqual(r.by.size, 0);
    await stocked.flagsFor('shop-1', undefined, withEntity, { trade: RESTAURANT });
    assert.strictEqual(QUERIES.length, 0);
  });

  await it('per item: a1 tracked by batch · a2 flagged not-stocked · a3 flagged stocked · a4 unflagged takes the restaurant default (not counted)', async () => {
    const r = await stocked.flagsFor('shop-1', ['a1', 'a2', 'a3', 'a4'], withEntity, { trade: RESTAURANT });
    assert.strictEqual(r.by.get('a1').tracked, true);
    assert.strictEqual(r.by.get('a2').counted, false);
    assert.strictEqual(r.by.get('a3').counted, true);
    assert.strictEqual(r.by.get('a4').counted, false);
    assert.strictEqual(r.counted_default, false);
  });

  await it('a flag that is not a boolean ("yes" / "no") is unsaid, so it takes the trade\'s answer rather than a string\'s truthiness', async () => {
    const r = await stocked.flagsFor('shop-1', ['a5'], withEntity, { trade: null });
    assert.strictEqual(r.by.get('a5').counted, true, '"no" must not count as a false flag');
    assert.strictEqual(r.by.get('a5').tracked, false, '"yes" must not count as a true flag');
  });

  await it('notCountedOf returns exactly the ids the shop does not count', async () => {
    const out = await stocked.notCountedOf('shop-1', ['a1', 'a2', 'a3', 'a4'], withEntity, { trade: RESTAURANT });
    assert.deepStrictEqual([...out].sort(), ['a1', 'a2', 'a4']);
    const pharmacy = await stocked.notCountedOf('shop-1', ['a1', 'a2', 'a3', 'a4'], withEntity, { trade: PHARMACY });
    assert.deepStrictEqual([...pharmacy], ['a2']);
  });

  await it('fail-safe: an unreadable flag read keeps every item COUNTED (nothing silently drops out of stock), never the reverse', async () => {
    const out = await stocked.notCountedOf('shop-1', ['a1', 'a2', 'a3'], broken, { trade: RESTAURANT });
    assert.strictEqual(out.size, 0, 'a failed read dropped items: ' + [...out]);
    const r = await stocked.flagsFor('shop-1', ['a1'], broken, { trade: RESTAURANT });
    assert.strictEqual(r.counted_default, true);
    assert.strictEqual(r.by.get('a1').counted, true);
  });

  await it('numeric ids are read as text so a Map lookup by the chit\'s id cannot miss', async () => {
    const r = await stocked.flagsFor('shop-1', [101, 102], withEntity, { trade: PHARMACY });
    assert.deepStrictEqual([...r.by.keys()], ['101', '102']);
  });

  console.log('\n  ' + checks + ' checks');
  console.log('  ' + checks + ' passed');
  process.exit(0);
})().catch((e) => { console.log('  FAIL ' + (e && e.stack ? e.stack.split('\n').slice(0, 5).join('\n       ') : e)); process.exit(1); });
