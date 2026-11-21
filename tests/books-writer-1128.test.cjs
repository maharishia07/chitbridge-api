/**
 *   F6  the balance rows of an entry come out in one fixed order (the row key), so two entries posting at once take their row locks in the same order — no 40P01 between them.
 *   F12 a reversal's source_ref is 'reverse:<original id>' whatever a caller sends.
 * Run: node tests/books-writer-1128.test.cjs
 */
'use strict';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://x:x@127.0.0.1:1/x';
const { balanceRows } = require('../lib/books-balance-rows');
const B = require('../lib/books');
let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };

/* a sale (Dr cash 11,800 · Cr sales 10,000 · Cr tax 1,800) and a refund (Dr round-off · Cr cash) post together: the SAME keys in either line order must give the same row order */
const line = (account_id, dr_minor, cr_minor) => ({ account_id, dr_minor, cr_minor, currency: 'INR' });
const sale = [line('c-cash', 1180000, 0), line('a-sales', 0, 1000000), line('b-tax', 0, 180000), line('d-roundoff', 0, 0)];
const refund = [line('d-roundoff', 50, 0), line('c-cash', 0, 50)];
const keys = (lines) => balanceRows(lines, '2026-27', 7).map((row) => row.account_id);
ok('F6: rows come out sorted by account (a, b, c, d), whatever order the lines are in', JSON.stringify(keys(sale)) === JSON.stringify(['a-sales', 'b-tax', 'c-cash', 'd-roundoff']), JSON.stringify(keys(sale)));
ok('F6: the refund (round-off first, cash second) takes them in the same order: c-cash before d-roundoff, the order the sale takes them', JSON.stringify(keys(refund)) === JSON.stringify(['c-cash', 'd-roundoff']), JSON.stringify(keys(refund)));
ok('F6: the sorted rows carry the same sums: cash Dr 1,180,000 minor', balanceRows(sale, '2026-27', 7).find((row) => row.account_id === 'c-cash').dr_minor === 1180000);
const head = (event) => B.reversalHead({ entry_id: 'e-1', entry_no: 'SV/1', fiscal_year: '2026-27', posting_date: '2026-11-02', total_minor: 100, currency: 'INR' }, Object.assign({ reason: 'wrong' }, event), { date: '2026-11-03', fy: '2026-27', period: 8 });
ok('F12: a reversal with no ref is reverse:<id>', head({}).source_ref === 'reverse:e-1');
ok('F12: a caller\'s own ref is ignored (a second reversal cannot hide under another name)', head({ source_ref: 'my-own-ref' }).source_ref === 'reverse:e-1');
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
