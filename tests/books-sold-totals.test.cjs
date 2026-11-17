// @type: unit
/**
 * tests/books-sold-totals.test.cjs — MIS A1 (offline): books-store.soldTotals is ONE statement over soldEntriesSql, the bounds in each range's WHERE as parameters, the answer shaped { sold, taken, bills, entries, through, first };
 * the practice's year-on-year statement now lives in books-store and the practice still exports it. The equality with soldByDay on real SQL is tests/books-sold-totals.realstack.cjs (run on the box, output in the PR).
 * Run: node tests/books-sold-totals.test.cjs
 */
'use strict';
process.env.NODE_ENV = 'test'; process.env.DATABASE_URL = '';
const S = require('../lib/books-store'), P = require('../lib/books-practice');
let pass = 0, fail = 0;
const t = (name, got, want) => { const a = JSON.stringify(got), b = JSON.stringify(want); if (a === b) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n         got  ' + a.slice(0, 300) + '\n         want ' + b.slice(0, 300)); } };
(async () => {
  const E = '11111111-1111-4111-8111-111111111111', seen = [];
  const rows = [{ i: '0', sold: '5000', taken: '4000', bills: '3', entries: '3', cur_lo: 'AUD', cur_hi: 'AUD', through: '2026-11-16', first: '2026-07-02' }, { i: '1', sold: '0', taken: '0', bills: '0', entries: '0', cur_lo: null, cur_hi: null, through: null, first: null }, { i: '2', sold: '9', taken: '9', bills: '1', entries: '1', cur_lo: 'AUD', cur_hi: 'USD', through: '2025-08-01', first: '2025-08-01' }];
  const db = { query: async (text, params) => { seen.push({ text, params }); return { rows }; } };
  const got = await S.soldTotals(db, E, [{ from: '2026-07-01', to: '2026-11-17' }, { from: '2025-07-01', to: '2025-06-30' }, { from: '2025-07-01', to: '2025-11-17' }]);
  t('ONE statement for three ranges, the parameters in order', [seen.length, seen[0].params], [1, [E, '2026-07-01', '2026-11-17', '2025-07-01', '2025-06-30', '2025-07-01', '2025-11-17']]);
  t('each range bounds its own entries in the WHERE ($2/$3, $4/$5, $6/$7), through the one SOLD fragment', [/h\.posting_date >= \$2::date/.test(seen[0].text), /h\.posting_date <= \$5::date/.test(seen[0].text), /h\.posting_date >= \$6::date/.test(seen[0].text)], [true, true, true]);
  t('a range with money', got[0], { from: '2026-07-01', to: '2026-11-17', sold: { minor: 5000, currency: 'AUD' }, taken: { minor: 4000, currency: 'AUD' }, bills: 3, entries: 3, through: '2026-11-16', first: '2026-07-02' });
  t('a range with no entry: entries 0, through null (the caller shows no figure, never a read zero)', [got[1].entries, got[1].through, got[1].sold.currency], [0, null, null]);
  t('two currencies in a range: mixed and no sum', got[2].sold, { minor: null, currency: '*mixed*' });
  t('no ranges: no statement', [await S.soldTotals(db, E, []), await S.soldTotals(db, E, [{ from: '2026-01-01' }]), seen.length], [[], [], 1]);
  t('the year-on-year statement lives in books-store and the practice still exports the same text', [S.YOY_STATEMENT === P.YOY_STATEMENT, S.YOY_STATEMENT.includes('AS sales_through')], [true, true]);
  const M = require('./support/books-memory.cjs');
  t('the in-memory twin has soldTotals', typeof M.create().soldTotals, 'function');
  console.log('\n' + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
})().catch((err) => { console.log('ERROR ' + (err && err.stack)); process.exit(1); });
