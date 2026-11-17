'use strict';
/* tests/bills-read-books.test.cjs — E19: Unpaid bills reads the books' dues (GET /dues, the one Dues paints), not only bill chits.
 * HAND-COMPUTED  Seed E client 001: 2 supplier documents, Dues A$9,284.00 to suppliers (928400 minor). The tab must call booksDues for its side EVERY time (not only when no chit is open),
 *   paint the api's total_minor as its figure (never a sum of chits) and give each books-only party its own row; a chit row keeps its chit opener. Live proof: e2e on sit-grund. */
const fs = require('fs'), assert = require('assert');
const html = fs.readFileSync(__dirname + '/../public/accounts.html', 'utf8');
const fn = html.slice(html.indexOf('async function accBills'), html.indexOf('TO DO — what the owner'));
let pass = 0;
const ok = (n, f) => { f(); pass++; console.log('  ok   ' + n); };
ok('the dues read is not behind an empty chit list', () => assert(!/if \(!list\.length\) \{\s*const owed/.test(fn) && /api\('booksDues'/.test(fn)));
ok('the figure is the api total_minor', () => assert(/owed\.total_minor/.test(fn)));
ok('a books-only party is a row, the list is chits + books rows', () => assert(/rows: \(\) => rowsAll/.test(fn) && /books: true/.test(fn)));
ok('a chit row still opens its chit; a books row does not', () => assert(/c\.books \? undefined : openChitSheet\(c\.chit_id\)/.test(fn)));
console.log('\n' + pass + ' passed');
