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
assert.strictEqual(pick(Q, null), '2026-Q1', 'no start at all (no registration day either): unchanged');
const rows = [{ period: 10, status: 'open', before_books: true, end_date: '2026-10-31' }, { period: 11, status: 'open', end_date: '2026-11-30' }];
assert.strictEqual(R.closedByMonths(rows)(Q[0]), true, 'the To do rule treats Q1 as not owed too');
assert.strictEqual(R.beforeBooks(Q[0], '2026-11-01'), true);
/* the new shop (Athi 28 Nov): the first period starts at the GST registration day; a nil return is due; nothing before registration is shown or owed */
const Reg = require('../lib/books-return-registration');
const handle = (registered_on, created) => ({ query: async () => ({ rows: [{ registered_on, created }] }) });
const first = async (table, h, booksStart) => { const o = await Reg.owedPeriods(h, 'E1', table, booksStart); const ps = withStates(o.table, [{ periods: o.table.map((p) => ({ period: p.period, start: p.start, end: p.end, closed: false, how: 'open' })) }], TODAY, o.start); return { list: ps.map((p) => p.period), pick: choosePeriod(ps, {}, null, TODAY).period, overdue: ps.filter((p) => p.overdue).map((p) => p.period) }; };
(async () => {
  const n1 = await first(Q, handle('2026-11-10', '2026-11-01'), null);
  assert.deepStrictEqual(n1.list, ['2026-Q2', '2027-Q3', '2027-Q4'], 'N1 registered 10 Nov, no entries: Q1 (Jul-Sep) is not shown; Q2 (Oct-Dec) is the first');
  assert.strictEqual(n1.pick, '2026-Q2'); assert.deepStrictEqual(n1.overdue, [], 'N1: the first quarter is due 28 Jan 2027, never overdue before registration');
  const n2 = await first(Q, handle('2026-07-01', '2026-07-01'), null);
  assert.strictEqual(n2.list[0], '2026-Q1'); assert.deepStrictEqual(n2.overdue, ['2026-Q1'], 'N2 registered 1 Jul, nothing lodged, due 28 Oct passed: Q1 is overdue (a nil BAS is lodged)');
  const n3 = await first(Q, handle(null, '2026-11-20'), null);
  assert.strictEqual(n3.list[0], '2026-Q2', 'N3 no registration day given, shop created 20 Nov, no entries: Q2 first'); assert.deepStrictEqual(n3.overdue, []);
  const n4 = await first(Q, handle(null, '2026-11-20'), '2026-08-01');
  assert.strictEqual(n4.list[0], '2026-Q1', 'N4 a shop WITH entries from 1 Aug and no registration day: the created day is ignored, Q1 stays');
  const n5 = await first(Q, handle('2026-11-10', '2026-07-01'), '2026-08-01');
  assert.strictEqual(n5.list[0], '2026-Q2', 'N5 registered 10 Nov although entries start 1 Aug: nothing before registration is shown');
  assert.strictEqual(Reg.firstOwedDay('2026-11-01', '2026-07-01'), '2026-11-01'); assert.strictEqual(Reg.firstOwedDay(null, null), null);
  assert.deepStrictEqual((await Reg.owedPeriods(handle('2027-12-01', null), 'E1', Q, null)).table, Q, 'a registration day after every period keeps the table whole');
  assert.strictEqual(await Reg.registrationDayOf(handle('not a date', null), 'E1', false), null);
  console.log('bas-period-books-start-1138: 15 + 12 passed');
})().catch((e) => { console.log(e.stack); process.exit(1); });
