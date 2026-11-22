/**
 * tests/yearclose-stock-warning-1129.test.cjs — GF-MONEY F3 (batch 1129): a year that holds counted stock but has no closing stock entry is NAMED on the close
 * (warning closing_stock_missing, never a gate: the close still goes ahead on the owner's word); a year with a closing stock names nothing.
 * Unit test, no database: closeWarnings with a stub handle and the To do's closingStockGap stubbed. Run: node tests/yearclose-stock-warning-1129.test.cjs
 */
'use strict';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://x:x@127.0.0.1:1/x';
const path = require('path');
const todo = require(path.join(__dirname, '..', 'lib', 'books-todo'));
const warn = require(path.join(__dirname, '..', 'lib', 'books-year-reopen'));
let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
(async () => {
  const handle = { query: async () => ({ rows: [] }) };
  const ctx = { range: { start: '2025-07-01', end: '2026-06-30' }, chart: [], cur: 'AUD', shop: { country: 'AU' } };
  const keep = todo.closingStockGap;
  const seen = [];
  todo.closingStockGap = async (h, e, shop, last) => { seen.push(last); return last; };
  const w = await warn.closeWarnings(handle, 'e1', '2025-26', ctx);
  ok('stock held, no closing stock: closing_stock_missing is named', w.some((x) => x.name === 'closing_stock_missing' && /2025-26/.test(x.why)), JSON.stringify(w));
  ok('…read over the whole year (start to end), the To do\'s own question', seen[0] && seen[0].start === '2025-07-01' && seen[0].end === '2026-06-30', JSON.stringify(seen));
  todo.closingStockGap = async () => null;
  const none = await warn.closeWarnings(handle, 'e1', '2025-26', ctx);
  ok('a closing stock recorded (or no stock held): no stock warning', !none.some((x) => x.name === 'closing_stock_missing'), JSON.stringify(none));
  todo.closingStockGap = keep;
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
