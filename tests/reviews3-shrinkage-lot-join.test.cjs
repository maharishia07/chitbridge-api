'use strict';
/**
 * reviews3-shrinkage-lot-join.test.cjs — batch 1129 fixReviews3 (GF-orders-stock-01 M7): shrinkage() joins a movement to ITS batch's balance row only.
 * BREAK CASE: the join was on entity+item+location, so a product held in 3 batches tripled every count and used 3 different average costs.
 * Run: node tests/reviews3-shrinkage-lot-join.test.cjs
 */
const assert = require('node:assert');
const store = require('../lib/stock-store');
let sql = '';
const withEntity = async (_e, fn) => fn({ query: async (q) => { sql = q; return { rows: [] }; } });
(async () => {
  await store.shrinkage('e1', withEntity, {});
  assert.ok(/b\.lot\s+IS NOT DISTINCT FROM\s+m\.lot/.test(sql), 'the balance join must include the lot');
  console.log('ok reviews3-shrinkage-lot-join');
})();
