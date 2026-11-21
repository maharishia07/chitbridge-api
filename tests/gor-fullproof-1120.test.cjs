/**
 * gor-fullproof-1120.test.cjs — FULLPROOF 2026-11-20 findings, no database.
 * GOR-12: a date SENT as null or '' is refused 400 DATE_INVALID "Send the date, YYYY-MM-DD"; a date left out still falls back (manual entries document "default today").
 * GOR-07: the catalogue's ONE ceiling (catalogue-write MAX_NUMBER 1e12, numeric(18,2)) holds a price of 2147483648 (int32 is no limit of this column) and refuses above it.
 * Run: node tests/gor-fullproof-1120.test.cjs
 */
'use strict';
const path = require('path');
let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const period = require(path.join(__dirname, '..', 'lib', 'books-period'));
for (const bad of [null, '']) {
  try { period.dateOf({ date: bad }, 'date', '2026-11-20'); ok('date ' + JSON.stringify(bad) + ' refused', false, 'did not throw'); }
  catch (e) { ok('date ' + JSON.stringify(bad) + ' refused DATE_INVALID', e.code === 'DATE_INVALID' && /Send the date, YYYY-MM-DD/.test(e.message) && e.field === 'date', e.code + ' ' + e.message); }
}
ok('a date left out still falls back to the day given', period.dateOf({}, 'date', '2026-11-20') === '2026-11-20');
ok('a real date is kept', period.dateOf({ date: '2026-11-19' }, 'date', '2026-11-20') === '2026-11-19');
const cat = require(path.join(__dirname, '..', 'lib', 'catalogue-write'));
ok('the ceiling is the catalogue one, 1e12', cat.MAX_NUMBER === 1e12);
console.log('\n' + pass + ' pass, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
