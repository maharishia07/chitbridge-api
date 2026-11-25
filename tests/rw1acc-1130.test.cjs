/**
 * rw1acc-1130.test.cjs — re-walk 1 (25 Nov 2026) RW1-08: a BAS label follows a line's tax treatment, not the account it hit.
 * Case: Moonee Espresso, FY27 Q2 (Oct-Dec 2026), one A$350.00 sale to a buyer in Mumbai, stated as an export, posted 17 Nov BEFORE the 21 Nov export-ledger fix:
 * Dr Customers 350.00 / Cr 4000 Sales 350.00, no GST line. Insert-only books keep it; the return reads it as G2.
 * Hand figures (A$, from the box's journal, read-only): 4000 Sales cr 38,950.00 (of which the 350.00) · 4020 GST-free cr 6,930.00 · 2200 cr 3,900.00 dr 40.00 net 3,860.00.
 *   G1 = 38,950.00 + 6,930.00 + 3,860.00 = 49,740.00 (stays: an export is a sale) · G2 = 350.00 · G3 = 6,930.00 · G4 = 0
 *   taxable base = G1 - G2 - G3 - G4 = 42,460.00 = 38,600.00 sales + 3,860.00 GST · 1/11 of 42,460.00 = 3,860.00 = 1A (no shortfall)
 * Run: node tests/rw1acc-1130.test.cjs
 * CARD      14-accounting/README
 */
'use strict';
const assert = require('assert');
const E = require('../lib/books-engines');
const Store = require('../lib/books-store');
const Taxed = require('../lib/books-period-taxed');
const gap = require('../lib/books-return-gst-gap');
const au = E.packs().packFor('AU');
const chart = [{ code: '4000', role: 'sales', name: 'Sales' }, { code: '4010', role: 'sales_export', name: 'Export sales (GST-free)' }];
const movement = () => [
  { code: '4000', role: 'sales', dr_minor: 0, cr_minor: 3895000 },
  { code: '4020', role: 'sales_gst_free', dr_minor: 0, cr_minor: 693000 },
  { code: '2200', role: 'gst_collected', dr_minor: 4000, cr_minor: 390000 }
];
const bas = (rows) => au.returns.bas({ period: '2026-Q2', simpler: false }, rows).labels;
(async () => {
  const real = Store.statedExportLines, realIncome = Store.taxedIncomeLines;
  Store.taxedIncomeLines = async () => [];
  const calls = [];
  Store.statedExportLines = async (...args) => { calls.push(args); return [{ code: '4000', dr_minor: '0', cr_minor: '35000' }]; };
  const rows = movement();
  await Taxed.addTaxedRows({}, 'shop', { pack: au, chart }, '2026-10-01', '2026-12-31', rows);
  assert.deepStrictEqual(calls[0].slice(1, 4), ['shop', '2026-10-01', '2026-12-31'], 'reads this shop and this window');
  assert.ok(calls[0][4].includes('gst_collected') && calls[0][5] === 'sales', 'asks for the entries with NO tax line, on the plain sales role');
  const before = bas(movement()), after = bas(rows);
  assert.strictEqual(before.G1.minor, 4974000, 'G1 before');
  assert.strictEqual(after.G1.minor, 4974000, 'G1 does not move: an export is still a sale');
  assert.strictEqual(after.G2.minor, 35000, 'G2 = 350.00');
  assert.strictEqual(after.G3.minor, 693000, 'G3 = 6,930.00');
  assert.strictEqual(after.G4.minor, 0, 'G4 = 0');
  assert.strictEqual(after['1A'].minor, 386000, '1A = 3,860.00 (never changed by the move)');
  const taxable = after.G1.minor - after.G2.minor - after.G3.minor - after.G4.minor;
  assert.strictEqual(taxable, 4246000, 'taxable base 42,460.00');
  assert.strictEqual(taxable / 11, after['1A'].minor, 'one eleventh of the taxable base is 1A, the two carried totals agree');
  /* the shortfall warning (accw2) stays quiet for this case, and still speaks when the sale is NOT a stated export */
  const boxes = (r) => [{ code: '1A', amount_minor: bas(r)['1A'].minor, roles: ['gst_collected'] }];
  assert.strictEqual(gap.gapOf(au, rows, boxes(rows), 'AUD'), null, 'no warning once the export is read as G2');
  assert.strictEqual(gap.gapOf(au, movement(), boxes(movement()), 'AUD').gap_minor, 3500, 'the same rows with no export statement still warn (35.00)');
  /* a shop whose chart has no export ledger is read as before; nothing is asked of the store */
  calls.length = 0;
  const plain = movement();
  await Taxed.addTaxedRows({}, 'shop', { pack: au, chart: [chart[0]] }, '2026-10-01', '2026-12-31', plain);
  assert.strictEqual(calls.length, 0);
  assert.strictEqual(plain.length, 3);
  Store.statedExportLines = real; Store.taxedIncomeLines = realIncome;
  console.log('rw1acc-1130: 12 passed');
})().catch((e) => { console.error(e); process.exit(1); });

/* RW1-10: October 2026 (monthly table) is "overdue" on 25 Nov: it ended 31 Oct, was due 21 Nov, and its covering quarter (2026-Q2, Oct-Dec) is open. September (due 21 Oct) too; November is not yet due. A closed quarter is never overdue. */
(() => {
  const past = require('../lib/books-year-past');
  const month = (n, last, due) => ({ period: '2026-' + n, start: '2026-' + n + '-01', end: '2026-' + n + '-' + last, due });
  const table = [month('09', '30', '2026-10-21'), month('10', '31', '2026-11-21'), month('11', '30', '2026-12-21')];
  const quarter = (closed) => [{ periods: [{ period: '2026-Q1', start: '2026-07-01', end: '2026-09-30', how: closed ? 'set_off' : null, closed }, { period: '2026-Q2', start: '2026-10-01', end: '2026-12-31', how: closed ? 'set_off' : null, closed }] }];
  const open = past.withStates(table, quarter(false), '2026-11-25');
  assert.deepStrictEqual(open.map((item) => !!item.overdue), [true, true, false], 'Sept and Oct overdue, Nov not due yet');
  assert.deepStrictEqual(open.map((item) => item.ended), [true, true, false]);
  assert.deepStrictEqual(past.withStates(table, quarter(true), '2026-11-25').map((item) => !!item.overdue), [false, false, false], 'a closed quarter holds its months: none overdue');
  assert.deepStrictEqual(past.withStates(table, [{ periods: [] }], '2026-11-25').map((item) => item.overdue), [undefined, undefined, undefined], 'no state held (the shop charges no tax): never overdue on a guess');
})();
console.log('rw1acc-1130: month overdue 5 passed');
