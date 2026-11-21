/**
 * ye-f07-overdue-return.test.cjs — YE-F-07 (walk YE 21 Nov): an overdue BAS is named, for the firm's row (and the owner's To do, same rule: lib/return-overdue).
 * HAND-COMPUTED (today 21 Nov 2026, AU quarterly, the pack's due days 28 Oct 2025 · 28 Feb 2026 · 28 Apr 2026 · 28 Jul 2026 · 28 Oct 2026):
 *   Elm Park-like: FY 2025-26 closed, FY 2026-27 months open → ONE overdue, FY27 Q1 (Jul–Sep 2026) due 2026-10-28, 24 days late.
 *   Alder-like: FY 2025-26 months open, FY 2026-27 open → FIVE overdue, the oldest FY26 Q1 due 2025-10-28, 389 days late (28 Oct 2025 → 21 Nov 2026).
 *   Every period closed → none. A month before the books is not owed: a pack that is not BAS → none.
 *   The BAS list (GET /returns periods): FY27 Q1 overdue; FY27 Q2 (ends 31 Dec 2026, running) and a closed period are not.
 * Run: node tests/ye-f07-overdue-return.test.cjs
 */
'use strict';
const path = require('path');
const P = require(path.join(__dirname, '..', 'lib', 'books-practice.js'));
const R = require(path.join(__dirname, '..', 'lib', 'return-overdue.js'));
let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const ends = ['07-31', '08-31', '09-30', '10-31', '11-30', '12-31', '01-31', '02-28', '03-31', '04-30', '05-31', '06-30'];
const year = (fy, firstYear, status) => ends.map((e, i) => ({ fiscal_year: fy, period: i + 1, end_date: (i < 6 ? firstYear : firstYear + 1) + '-' + e, status }));
const AU = { country: 'AU', fy_start_month: 7, functional_currency: 'AUD', enabled: true };
const today = '2026-11-21';
const elm = P.basOf(AU, today, year('2025-26', 2025, 'hard_locked').concat(year('2026-27', 2026, 'open')));
ok('Elm Park-like: one overdue, FY27 Q1 due 28 Oct 2026, 24 days late', elm.overdue && elm.overdue.n === 1 && elm.overdue.due === '2026-10-28' && elm.overdue.days_late === 24 && /FY27 Q1/.test(elm.overdue.label), JSON.stringify(elm.overdue));
const alder = P.basOf(AU, today, year('2025-26', 2025, 'open').concat(year('2026-27', 2026, 'open')));
ok('Alder-like: five overdue, the oldest FY26 Q1 due 28 Oct 2025, 389 days late', alder.overdue && alder.overdue.n === 5 && alder.overdue.due === '2025-10-28' && alder.overdue.days_late === 389, JSON.stringify(alder.overdue));
const none = P.basOf(AU, today, year('2025-26', 2025, 'hard_locked').concat(year('2026-27', 2026, 'hard_locked')));
ok('every period closed: no overdue', none.overdue === null, JSON.stringify(none.overdue));
const before = year('2025-26', 2025, 'hard_locked').map((r, i) => (i < 3 ? Object.assign({ before_books: true }, r, { status: 'open' }) : r)).concat(year('2026-27', 2026, 'hard_locked'));
ok('months before the books are not owed: FY26 Q1 (Jul-Sep) wholly before the books is not overdue', P.basOf(AU, today, before).overdue === null);
ok('a pack whose return is not read from the books names none', R.overdueReturns({ returns: { id: 'GSTR' } }, today, [], () => false).length === 0);
const Y = require(path.join(__dirname, '..', 'lib', 'books-year-past.js'));
const listed = Y.withStates([{ period: '2026-Q1', end: '2026-09-30', due: '2026-10-28' }, { period: '2026-Q2', end: '2026-12-31', due: '2027-02-28' }, { period: '2025-Q4', end: '2025-06-30', due: '2025-07-28' }], [{ periods: [{ period: '2026-Q1', closed: false, how: null }, { period: '2026-Q2', closed: false, how: null }, { period: '2025-Q4', closed: true, how: 'year_closed' }] }], today);
ok('the BAS list flags the unclosed ended period past its due day (overdue), and neither a running one nor a closed one', listed[0].overdue === true && !listed[1].overdue && !listed[2].overdue, JSON.stringify(listed));
console.log('\n' + (pass + fail) + ' checks, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
