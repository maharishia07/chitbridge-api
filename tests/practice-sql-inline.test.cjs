/* The practice cash statement is sent through db.queryAsEach, which INLINES its $n (db.inlineSql). A lone apostrophe in a SQL comment
 * (booksLockLine's, accounts') reads as the start of a literal there, so a later $1 stays unbound and Postgres answers "there is no
 * parameter $1" (batch 1128 S41 failure); a ';' in a comment is the same trap. OFFLINE: builds the statement and inlines it. */
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://x:x@127.0.0.1:1/x';
const assert = require('assert');
const db = require('../db');
const P = require('../lib/books-practice');
const cashflow = require('../lib/books-cashflow');
let fail = 0;
for (const bankLog of [true, false]) {
  try {
    const body = db.inlineSql(P.statement(cashflow.CASH_ROLES, bankLog), ['3165cee7-927c-433f-8bff-eb2374a48430', '2026-11-21', '2026-11-21T13:41:46.980Z']);
    assert.strictEqual((body.match(/\$\d+/g) || []).length, 0, 'a $n left after inlining');
    console.log('  ok   practice statement inlines clean (bank log ' + bankLog + ')');
  } catch (e) { fail++; console.log('  FAIL practice statement (bank log ' + bankLog + '): ' + e.message); }
}
console.log(fail ? fail + ' failed' : '2 passed, 0 failed');
process.exit(fail ? 1 : 0);
