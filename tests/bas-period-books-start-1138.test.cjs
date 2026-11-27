/**
 * bas-period-books-start-1138.test.cjs — UX-226 A6: the BAS opens on a period that is not in the future and a quarter wholly before the books start is never overdue nor the default.
 * Books start = booksLockLine's first month holding an entry (the one rule). Today 2026-11-28; FY27 AU quarters; due = 28th after quarter (21st after a month).
 * Hand cases: (1) start Nov 2026, quarterly -> Q2 (Oct-Dec, running), Q1 before books, none overdue. (2) start Jul 2026 -> Q1 default, overdue (due 2026-10-28).
 * (3) monthly, start Nov 2026 -> Nov default, Jul-Oct before books, none overdue; monthly start Jul -> Oct default, Jul-Oct overdue (due 21st after, < Nov 28).
 * (4) start 15 Nov (month start 1 Nov) -> Q2 not before books. (5) a named period is still honoured. (6) the To do rule (closedByMonths) agrees.
 * Run: node tests/bas-period-books-start-1138.test.cjs      CARD 14-accounting/gst-returns
 */
'use strict';
const assert = require('assert');
const { choosePeriod } = require('../lib/books-period');
const { withStates } = require('../lib/books-year-past');
const R = require('../lib/return-overdue');
const TODAY = '2026-11-28';
const Q = [['2026-Q1', '2026-07-01', '2026-09-30', '2026-10-28'], ['2026-Q2', '2026-10-01', '2026-12-31', '2027-01-28'], ['2027-Q3', '2027-01-01', '2027-03-31', '2027-04-28'], ['2027-Q4', '2027-04-01', '2027-06-30', '2027-07-28']].map(([period, start, end, due]) => ({ period, start, end, due }));
const M = [['2026-07', '2026-07-01', '2026-07-31', '2026-08-21'], ['2026-08', '2026-08-01', '2026-08-31', '2026-09-21'], ['2026-09', '2026-09-01', '2026-09-30', '2026-10-21'], ['2026-10', '2026-10-01', '2026-10-31', '2026-11-21'], ['2026-11', '2026-11-01', '2026-11-30', '2026-12-21'], ['2026-12', '2026-12-01', '2026-12-31', '2027-01-21']].map(([period, start, end, due]) => ({ period, start, end, due }));
const read = (table, start) => withStates(table, [{ periods: table.map((p) => ({ period: p.period, start: p.start, end: p.end, closed: false, how: 'open' })) }], TODAY, start);
const pick = (table, start, query) => choosePeriod(read(table, start), query || {}, null, TODAY).period;
const overdue = (table, start) => read(table, start).filter((p) => p.overdue).map((p) => p.period);

assert.strictEqual(pick(Q, '2026-11-01'), '2026-Q2', 'Nov start: the quarter running, never Q1 or the future Q4');
assert.deepStrictEqual(overdue(Q, '2026-11-01'), [], 'Nov start: nothing overdue');
assert.strictEqual(read(Q, '2026-11-01')[0].before_books, true);
assert.strictEqual(read(Q, '2026-11-01')[1].before_books, undefined, 'the quarter holding the start is not before the books');
assert.strictEqual(pick(Q, '2026-07-01'), '2026-Q1');
assert.deepStrictEqual(overdue(Q, '2026-07-01'), ['2026-Q1']);
assert.strictEqual(pick(M, '2026-11-01'), '2026-11');
assert.deepStrictEqual(overdue(M, '2026-11-01'), []);
assert.strictEqual(pick(M, '2026-07-01'), '2026-10');
assert.deepStrictEqual(overdue(M, '2026-07-01'), ['2026-07', '2026-08', '2026-09', '2026-10']);
assert.strictEqual(pick(Q, '2026-08-01'), '2026-Q1', 'Aug start: Q1 holds the start, still owed');
assert.strictEqual(pick(Q, '2026-11-01', { period: '2026-Q1' }), '2026-Q1', 'a named period is honoured');
assert.strictEqual(pick(Q, null), '2026-Q1', 'no entries yet: unchanged (decision pending, see the PR)');
const rows = [{ period: 10, status: 'open', before_books: true, end_date: '2026-10-31' }, { period: 11, status: 'open', end_date: '2026-11-30' }];
assert.strictEqual(R.closedByMonths(rows)(Q[0]), true, 'the To do rule treats Q1 as not owed too');
assert.strictEqual(R.beforeBooks(Q[0], '2026-11-01'), true);
console.log('bas-period-books-start-1138: 15 passed');
