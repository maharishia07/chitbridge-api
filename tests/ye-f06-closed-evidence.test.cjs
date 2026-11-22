/**
 * ye-f06-closed-evidence.test.cjs — YE-F-06 (walk YE 21 Nov): a closed year carries its evidence: when, by whom, how (returns declared lodged outside the books), the profit carried.
 * HAND-COMPUTED  twelve months closed by "Year close 2025-26 — returns lodged outside the books": how 'declared_lodged'; profit 1436617 for a seat that reads money, absent for one that does not.
 * Run: node tests/ye-f06-closed-evidence.test.cjs
 */
'use strict';
const path = require('path');
const Y = require(path.join(__dirname, '..', 'lib', 'books-year-past.js'));
let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const months = (declared) => [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((p) => ({ fiscal_year: '2025-26', period: p, status: 'hard_locked', reason: Y.yearCloseReason('2025-26', declared) }));
const event = { at: '2026-11-02T01:00:00Z', by: 'u-1', by_name: 'Elm Park Physio' };
const a = Y.closedWith(event, months(true), { profit_minor: 1436617 }, true, 'AUD');
ok('closed on, by whom, declared lodged, the profit carried', a.at === event.at && a.by_name === 'Elm Park Physio' && a.how === 'declared_lodged' && a.profit_minor === 1436617 && a.currency === 'AUD', JSON.stringify(a));
ok('closed without the declaration: year_closed', Y.closedWith(event, months(false), { profit_minor: 5 }, true).how === 'year_closed');
ok('a seat that reads no money gets no profit', !('profit_minor' in Y.closedWith(event, months(true), { profit_minor: 1436617 }, false)));
ok('no log line: nulls, never a made-up name', (() => { const z = Y.closedWith(null, months(true), null, true); return z.at === null && z.by_name === null && !('profit_minor' in z); })());
console.log('\n' + (pass + fail) + ' checks, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
