/**
 * tests/walkd-lot-trace-lines.test.cjs — WALK-D D-F-07: THE LOT TRACE READS THE LOT ON THE CHIT'S OWN LINES (a goods-in receipt, a supplier's bill), NOT ONLY chit_line.flags.
 *
 * OWNS      lib/chits-trace-batch batchRows + batchItems with a db stand-in: a receipt with item_data.lot {batch L1} and no network trace answers matched_on 'batch' with the line's product, quantity 5 and unit piece;
 *           the lot query reads chit_detail.line_items (all three shapes of stock-from-chit.lotOf), binds ONLY the lot text, and an empty answer still falls back to product, announcing it (matched_on 'product').
 *           ⚠️ The SQL text is checked, not run: this laptop has no Postgres. The real-stack check is the gorilla row (receipt with lot L1 → GET /api/chits/trace/by-batch?q=L1 → count 1).
 * CALLED BY by hand: node tests/walkd-lot-trace-lines.test.cjs
 * FLOW      lot → batchRows (chit_line.flags, then chit_detail.line_items, then product) → batchItems → one item per chit
 * CARD      13-inventory-stock-and-traceability/batch-traceability-mass-balance
 */
'use strict';
const path = require('path');
process.env.NODE_ENV = 'test';
const HERE = path.join(__dirname, '..');
const dbFile = require.resolve(path.join(HERE, 'db'));
const real = require(dbFile);
const calls = [];
let onLines = [];
const stand = async (sql, params) => {
  calls.push({ sql, params });
  if (/chit_detail/.test(sql)) return { rows: onLines };
  return { rows: [] };
};
require.cache[dbFile].exports = Object.assign({}, real, { withEntity: async (entity, fn) => fn({ query: stand }) });
const trace = require(path.join(HERE, 'lib', 'chits-trace-batch'));
let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };

(async () => {
  console.log('\n== WALK-D D-F-07 · the lot trace finds a lot on the chit lines ==\n');
  onLines = [{ chit_id: 'c1', sender_entity_id: 's1', sender_entity_display_name: 'WKD A', all_recipients: [], trace: null, line: { particulars: 'WKD Yoghurt', quantity: 5, unit: 'piece' } }];
  const answer = await trace.batchRows('s1', 'L1');
  ok('a lot on a receipt line (no network trace) → matched_on batch, not product', answer.matched_on === 'batch' && answer.r.rows.length === 1, JSON.stringify(answer));
  const items = trace.batchItems(answer.r.rows);
  ok('the item carries the line\'s product WKD Yoghurt, quantity 5, unit piece', items.length === 1 && items[0].product === 'WKD Yoghurt' && items[0].qty === 5 && items[0].unit === 'piece', JSON.stringify(items));
  const lotQuery = calls.find((c) => /chit_detail/.test(c.sql));
  ok('the lot query reads chit_detail.line_items and binds only the lot text', !!lotQuery && /line_items/.test(lotQuery.sql) && JSON.stringify(lotQuery.params) === '["L1"]');
  ok('all three shapes of the lot are read: object {batch|serial}, bare text, flat item_data.batch', /'item_data'->'lot'->>'batch'/.test(lotQuery.sql) && /'item_data'->'lot'->>'serial'/.test(lotQuery.sql) && /jsonb_typeof\(li\.value->'item_data'->'lot'\) = 'string'/.test(lotQuery.sql) && /item_data'->>'batch'/.test(lotQuery.sql));
  onLines = [];
  const none = await trace.batchRows('s1', 'NOPE');
  ok('a lot nobody holds still falls back to product and says so', none.matched_on === 'product' && none.r.rows.length === 0);
  console.log('\n' + pass + ' ok, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
