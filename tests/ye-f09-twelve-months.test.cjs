/**
 * ye-f09-twelve-months.test.cjs — YE-F-09 (walk YE 21 Nov): the practice row's year counts the year's 12 months, not the 10 the books hold.
 * HAND-COMPUTED  FY 2025-26, twelve months all hard-locked, the books begin in Sep 2025 (Jul, Aug marked before_books): of 12, locked 12, start 2025-07-01.
 *                The same year with Apr–Jun open: of 12, locked 9 (Jul–Aug before the books count as locked, Sep–Mar locked).
 * Run: node tests/ye-f09-twelve-months.test.cjs
 */
'use strict';
const path = require('path');
const H = require(path.join(__dirname, '..', 'lib', 'practice-health.js'));
let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const ends = ['2025-07-31', '2025-08-31', '2025-09-30', '2025-10-31', '2025-11-30', '2025-12-31', '2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31', '2026-06-30'];
const rows = (openFrom) => ends.map((end, i) => Object.assign({ fiscal_year: '2025-26', period: i + 1, end_date: end, status: openFrom && i + 1 >= openFrom ? 'open' : 'hard_locked' }, i < 2 ? { before_books: true } : {}));
const bank = { state: 'reconciled', reconciled_to: '2026-06-30' };
const closed = H.yearEndOf(rows(0), bank, '2026-11-21');
ok('twelve months: of 12, locked 12, the strip starts 1 Jul 2025', closed.of === 12 && closed.locked === 12 && closed.start === '2025-07-01', JSON.stringify(closed));
const part = H.yearEndOf(rows(10), bank, '2026-11-21');
ok('Apr-Jun open: of 12, locked 9, blocker months', part.of === 12 && part.locked === 9 && part.blocker === 'months', JSON.stringify(part));
console.log('\n' + (pass + fail) + ' checks, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
