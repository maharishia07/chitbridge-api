/**
 * ye-f06-return-stage.test.cjs — YE-F-06 (walk YE 21 Nov): a return's stage words come from ONE state, so a lodged quarter never also says "Prepared, not lodged".
 * HAND-COMPUTED  declared_lodged → "Lodged, as you said"; ended + due passed + not closed → "Overdue — prepared, not lodged"; closed (set off, months locked, year closed) → "Closed — prepared, not lodged"; else "Prepared, not lodged".
 * Run: node tests/ye-f06-return-stage.test.cjs
 */
'use strict';
const path = require('path');
const Y = require(path.join(__dirname, '..', 'lib', 'books-year-past.js'));
let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const P = 'Prepared, not lodged';
const stage = (period) => Y.returnStage(period, P);
ok('declared lodged: lodged, as you said — the prepared words are gone', stage({ state: 'declared_lodged', closed: true }).words === 'Lodged, as you said' && stage({ state: 'declared_lodged', closed: true }).code === 'declared_lodged');
ok('overdue: named, still not lodged', stage({ state: 'open', closed: false, overdue: true }).words === 'Overdue — prepared, not lodged');
ok('closed with the year or by its months: closed, still not lodged', stage({ state: 'year_closed', closed: true }).words === 'Closed — prepared, not lodged' && stage({ state: 'months_locked', closed: true }).code === 'closed');
ok('an open running period: prepared, not lodged', stage({ state: 'open', closed: false }).words === P && stage(null).code === 'prepared');
console.log('\n' + (pass + fail) + ' checks, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
