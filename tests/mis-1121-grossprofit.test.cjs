#!/usr/bin/env node
// @type: unit
/**
 * tests/mis-1121-grossprofit.test.cjs — F-66 (auditor walk 21 Nov): the gross profit takes off the cost the trial balance prints under "Cost of sales".
 * Contract: books-report-period.COST_OF_SALES_ROLES holds every expense class the packs file as a DIRECT cost (AU, AE cost_of_sales · IN direct_expenses),
 * so the P&L's gross line, the Home "How we are doing" gross and the practice margin agree with the TB. Hand figures: Moonee Espresso, sales 137,340.00, wages 53,951.15.
 * OWNS      the F-66 proof        CALLED BY npm test        CARD  26-reporting-mis-and-bi
 */
'use strict';
process.env.NODE_ENV = 'test';
const path = require('path');
const assert = require('assert');
const R = require(path.join(__dirname, '..', 'lib', 'books-report-period'));
const DIRECT = { AU: ['cost_of_sales'], AE: ['cost_of_sales'], IN: ['direct_expenses'] };
for (const [country, groups] of Object.entries(DIRECT)) {
  const pack = require(path.join(__dirname, '..', 'lib', 'reg-' + country.toLowerCase()));
  const direct = (pack.expense_classes || []).filter((e) => groups.includes(e.group)).map((e) => e.role);
  assert.ok(!direct.includes('wages'), country + ': wages are an operating expense since engines v1.102.0 (F-66)');
  for (const role of direct) assert.ok(R.COST_OF_SALES_ROLES.includes(role), country + ': ' + role + ' is a direct cost in the pack but not in the gross-profit list');
}
const g = R.grossOf([{ role: 'sales', amount_minor: 13734000 }], [{ role: 'freight_inward', amount_minor: 5395115 }, { role: 'wages', amount_minor: 4000000 }, { role: 'rent', amount_minor: 100000 }], 'AUD');
assert.deepStrictEqual(g, { sales_minor: 13734000, cost_of_sales_minor: 5395115, gross_profit_minor: 8338885 }); /* 137,340.00 - 53,951.15 = 83,388.85; wages (6015) and rent stay operating expenses (batch 1126) */
console.log('mis-1121-grossprofit: ok (gross 83,388.85)');

/* F-67: the year box counts the months from the books' start to today — Jul (before the books) and Dec–Jun (to come) are not months of "0 of N locked". Hand: Aug, Sep, Oct, Nov = 4. */
const PC = require(path.join(__dirname, '..', 'lib', 'books-period-choices'));
const month = (p, start, end, o) => Object.assign({ fiscal_year: '2026-27', period: p, start_date: start, end_date: end, entries: 0, status: 'open', before_books: false }, o);
const rows = [month(1, '2026-07-01', '2026-07-31', { before_books: true }), month(2, '2026-08-01', '2026-08-31', { entries: 5 }), month(3, '2026-09-01', '2026-09-30', { entries: 5 }), month(4, '2026-10-01', '2026-10-31', { entries: 5 }), month(5, '2026-11-01', '2026-11-30', { entries: 2 }), month(6, '2026-12-01', '2026-12-31'), month(7, '2027-01-01', '2027-01-31')];
assert.strictEqual(PC.yearsOf(rows, '2026-11-21')[0].months, 4);
assert.strictEqual(PC.yearsOf(rows)[0].months, 6); /* no day given: every month of the books, as before */
console.log('mis-1121-grossprofit: year box count ok (4)');
assert.strictEqual(R.withFigures({ income: [], expenses: [] }), null); /* F-66: nothing last year = no comparison */
assert.deepStrictEqual(R.throughOf('2027-06-30', '2026-11-21'), { through: '2026-11-21' }); /* F-67: the year to come is read to today */
assert.deepStrictEqual(R.throughOf('2026-09-30', '2026-11-21'), {});
console.log('mis-1121-grossprofit: no-comparison + through ok');
