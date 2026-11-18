'use strict';
/* P1-1 (18 Nov): the opening-balance journal is counted in the month its day falls in, so the picker's counts and the Day book's list agree.
 * Hand-computed: Aug 7 + Sep 8 + Oct 10 = 25 entries, plus 1 opening journal (period 0, dated 1 Aug) = 26 in the year, Aug = 8. */
const test = require('node:test'), assert = require('node:assert');
const S = require('../lib/books-opening-count');
const P = require('../lib/books-period-choices');
const FY = '2026-27';
const figures = [
  { fiscal_year: FY, period: 0, entries: 1, sales_minor: 0 },
  { fiscal_year: FY, period: 2, entries: 7, sales_minor: 500 },
  { fiscal_year: FY, period: 3, entries: 8, sales_minor: 0 },
  { fiscal_year: FY, period: 4, entries: 10, sales_minor: 0 }
];
const months = [2, 3, 4].map((p, i) => ({ fiscal_year: FY, period: p, start_date: ['2026-08-01', '2026-09-01', '2026-10-01'][i], end_date: ['2026-08-31', '2026-09-30', '2026-10-31'][i] }));
test('the opening journal is counted once, in the month of its day', () => {
  const out = S.foldOpening(figures, [{ fiscal_year: FY, day: '2026-08-01', n: 1 }], months);
  assert.strictEqual(out.find((x) => x.period === 2).entries, 8);
  assert.strictEqual(out.find((x) => x.period === 2).sales_minor, 500);
  assert.strictEqual(out.some((x) => x.period === 0), false);
  assert.strictEqual(out.reduce((n, x) => n + x.entries, 0), 26);
});
test('the year line and the list say the same number: 25 entries plus 1 opening = 26 both', () => {
  const folded = S.foldOpening(figures, [{ fiscal_year: FY, day: '2026-08-01', n: 1 }], months);
  const rows = months.map((m) => Object.assign({ status: 'open', checked: 3, of: null }, m, { entries: folded.find((x) => x.period === m.period).entries }));
  const year = P.yearsOf(rows)[0];
  assert.strictEqual(year.entries, 26);
  const listShown = 25 + 1;
  assert.strictEqual(year.entries, listShown);
});
test('an opening day no month holds stays in period 0, never lost', () => {
  const out = S.foldOpening(figures, [{ fiscal_year: FY, day: '2026-07-01', n: 1 }], months);
  assert.strictEqual(out.find((x) => x.period === 0).entries, 1);
  assert.strictEqual(out.reduce((n, x) => n + x.entries, 0), 26);
});
