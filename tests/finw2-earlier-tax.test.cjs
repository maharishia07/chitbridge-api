/**
 * finw2-earlier-tax.test.cjs — FW-30 (walk 25 Nov): the ledger's tax owed from BEFORE the period that holds the day names the late return (its own figure, due date, overdue) and the rest as "on no return".
 * Hand figures (A$ minor): ledger owes 4,320.72 = 432072; the return that holds the day (FY27 Q2) 12.52 = 1252; earlier = 430820; FY27 Q1 1,803.50 = 180350 due 28 Oct 2026 (overdue);
 * on no return = 430820 - 180350 = 250470 (A$2,504.70). A return larger than what is left is cut to what is left. Run: node tests/finw2-earlier-tax.test.cjs
 */
'use strict';
const CF = require('../lib/books-cashflow');
let fail = 0;
const ok = (name, cond, why) => { console.log((cond ? '   ok   ' : '   FAIL ') + name + (cond ? '' : ' ' + why)); if (!cond) fail++; };
const day = (iso) => CF.day(iso);
const row = (extra) => Object.assign({ payable_minor: 432072, period_minor: 1252, period_start: '2026-10-01', due_date: '2027-01-28', form: 'BAS', short: 'BAS', why: null }, extra);
const Q1 = { period: '2026-Q1', label: 'FY27 Q1 (Jul-Sep 2026)', due_date: '2026-10-28', payable_minor: 180350, overdue: true };
const a = CF.gstLine(row({ earlier_returns: [Q1] }), day('2026-11-25'), day('2026-12-02')).line;
ok('payable stays the period figure 12.52', a.payable_minor === 1252, JSON.stringify(a));
ok('earlier total 4,308.20', a.earlier.payable_minor === 430820, JSON.stringify(a.earlier));
ok('Q1 1,803.50 named with its date and overdue', a.earlier.returns.length === 1 && a.earlier.returns[0].payable_minor === 180350 && a.earlier.returns[0].due_date === '2026-10-28' && a.earlier.returns[0].overdue === true, JSON.stringify(a.earlier));
ok('overdue 1,803.50 and on no return 2,504.70', a.earlier.overdue_minor === 180350 && a.earlier.other_minor === 250470, JSON.stringify(a.earlier));
ok('parts add up to the earlier figure', a.earlier.returns.reduce((s, r) => s + r.payable_minor, 0) + a.earlier.other_minor === a.earlier.payable_minor, '');
const b = CF.gstLine(row({ payable_minor: 1252 + 100000, earlier_returns: [Q1] }), day('2026-11-25'), day('2026-12-02')).line;
ok('a return larger than what is left is cut (1,000.00 left of 1,803.50)', b.earlier.returns[0].payable_minor === 100000 && b.earlier.other_minor === 0, JSON.stringify(b.earlier));
const c = CF.gstLine(row({}), day('2026-11-25'), day('2026-12-02')).line;
ok('no return list: the lump as before, no new keys', c.earlier.payable_minor === 430820 && c.earlier.returns === undefined && c.earlier.other_minor === undefined, JSON.stringify(c.earlier));
console.log(fail ? fail + ' FAILED' : 'all ok');
process.exit(fail ? 1 : 0);
