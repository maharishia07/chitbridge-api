/**
 * tests/reviews1-trace-batch-errors.test.cjs — reviews1 EL rail F8: a lot recall answers "no rows" only for a MISSING table or column (42P01 / 42703);
 * a timeout or pool error is rethrown, never turned into "nobody received it".
 * CALLED BY by hand: node tests/reviews1-trace-batch-errors.test.cjs
 * CARD      13-inventory-stock-and-traceability/batch-traceability-mass-balance
 */
'use strict';
const path = require('path');
process.env.NODE_ENV = 'test';
const HERE = path.join(__dirname, '..');
const dbFile = require.resolve(path.join(HERE, 'db'));
const real = require(dbFile);
let failWith = null;
require.cache[dbFile].exports = Object.assign({}, real, { withEntity: async (entity, fn) => fn({ query: async (sql) => { if (failWith && /chit_line|chit_detail/.test(sql) && /WHERE/.test(sql)) throw Object.assign(new Error('boom'), { code: failWith }); return { rows: [] }; } }) });
const trace = require(path.join(HERE, 'lib', 'chits-trace-batch'));
let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name); } };
(async () => {
  failWith = '42P01';
  const old = await trace.batchRows('s1', 'L1');
  ok('a database without chit_line (42P01) falls through to the product answer', old.matched_on === 'product' && old.r.rows.length === 0);
  failWith = '57014'; /* statement timeout */
  let thrown = null;
  try { await trace.batchRows('s1', 'L1'); } catch (e) { thrown = e; }
  ok('a statement timeout is rethrown, not answered as "no rows"', !!thrown && thrown.code === '57014');
  console.log('\n' + pass + ' ok, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
