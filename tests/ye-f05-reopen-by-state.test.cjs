/**
 * ye-f05-reopen-by-state.test.cjs — YE-F-05 (walk YE 21 Nov): a month the year close locked never offers "Reopen month" — the server says so.
 * HAND-COMPUTED  Jun 2026 hard-locked by "Year close 2025-26 — …": reopen.may false, by_year true, words "Closed with the year…";
 *                a month hard-locked alone: "Closed for good — it never opens again." (no by_year); a soft-locked last month: may true.
 * Run: node tests/ye-f05-reopen-by-state.test.cjs
 */
'use strict';
const path = require('path');
const Y = require(path.join(__dirname, '..', 'lib', 'books-year-past.js'));
const A = require(path.join(__dirname, '..', 'lib', 'books-month-advice.js'));
let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const month = (period, status, reason) => ({ fiscal_year: '2025-26', period, start_date: '2025-07-01', end_date: '2025-07-31', status, reason: reason || null });
const rows = [month(1, 'hard_locked', Y.yearCloseReason('2025-26', true)), month(2, 'hard_locked', 'Closed for good by the owner'), month(3, 'soft_locked', 'GST filed')];
const out = A.periodAdvice(rows, [], '2026-11-21', [], null);
ok('a year-closed month: may false, by_year, the words say with the year', out[0].reopen.may === false && out[0].reopen.by_year === true && /with the year/.test(out[0].reopen.why), JSON.stringify(out[0].reopen));
ok('a month hard-locked alone: said as a hard lock the owner may open with a reason (batch 1128 wording, fixBooks F7), no by_year', out[1].reopen.may === false && !out[1].reopen.by_year && /hard lock/.test(out[1].reopen.why), JSON.stringify(out[1].reopen));
ok('the last soft-locked month may open again', out[2].reopen.may === true, JSON.stringify(out[2].reopen));
console.log('\n' + (pass + fail) + ' checks, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
