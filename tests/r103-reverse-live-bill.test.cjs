'use strict';
/**
 * tests/r103-reverse-live-bill.test.cjs — R1-03 (DEC-267), offline: Reverse on a live sale_bill / purchase_bill is refused AT THE ROUTE, never in the one writer.
 *   1 S.liveBillEntries asks one query for a page, names only sale_bill / purchase_bill whose source is exactly chit:<id>, unreversed, whose chit is not cancelled / rejected; bad ids ask nothing
 *   2 routes/books.js POST /entries/:id/reverse refuses ENTRY_OF_LIVE_BILL (409) BEFORE B.reverseEntry; the day book hands may_reverse + why from the same reader and the same sentence
 *   3 lib/books.js reverseEntry holds no such check, so the cancel path (chit-move → books-hooks.takeBackCancelled → reverseIfPosted) still works
 *   4 the code is in the register with its shopkeeper sentence
 * Real Postgres: tests/r103-reverse-live-bill.realstack.cjs (scenarios R103-AU / R103-AE). CARD 14-accounting (R1 slice C)
 */
const fs = require('fs');
const path = require('path');
const S = require('../lib/books-store');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
let fail = 0;
const ok = (name, cond, why) => { if (cond) console.log('   ok   ' + name); else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };

(async () => {
  const calls = [];
  const db = { query: async (sql, args) => { calls.push({ sql, args }); return { rows: [{ entry_id: '11111111-1111-4111-8111-111111111111' }] }; } };
  const E = '22222222-2222-4222-8222-222222222222', X = '11111111-1111-4111-8111-111111111111';
  const live = await S.liveBillEntries(db, E, [X, 'not-an-id']);
  ok('one query for the page, the bad id never reaches it', calls.length === 1 && calls[0].args[1].length === 1 && calls[0].args[1][0] === X);
  ok('the answer is a Set of entry ids', live instanceof Set && live.has(X));
  const sql = calls[0].sql;
  ok('only bills, only the chit source (and its :asset|:use halves), not reversed, not cancelled / rejected', /event_type IN ('sale_bill', 'purchase_bill')/.test(sql) && sql.includes("'^chit:[0-9a-f-]{36}(:asset|:use)?$'") && /reverses_entry_id = x.entry_id/.test(sql) && /'cancelled', 'rejected'/.test(sql));
  ok('no ids → no query', (await S.liveBillEntries(db, E, [])).size === 0 && calls.length === 1);

  const route = read('routes/books.js'), at = route.indexOf("router.post('/entries/:id/reverse'"), body = route.slice(at, at + 2600);
  ok('the route refuses ENTRY_OF_LIVE_BILL (409) before it calls reverseEntry', /ENTRY_OF_LIVE_BILL/.test(body) && /status: 409/.test(body) && body.indexOf('liveBillEntries') < body.indexOf('await B.reverseEntry'));
  ok('the day book answers may_reverse + why from the same reader', /S\.liveBillEntries\(h, e, entries\.map/.test(route) && /x\.may_reverse = /.test(route) && /words: LIVE_BILL_WORDS/.test(route));
  const books = read('lib/books.js'), rev = books.slice(books.indexOf('async function reverseEntry'), books.indexOf('async function reverseEntry') + 500);
  ok('reverseEntry (the one writer) holds no live-bill check: the cancel path stays open', !/LIVE_BILL|liveBill/.test(rev));
  ok('no other door calls the route: chit-move and books-hooks reach the writer directly', !/liveBillEntries/.test(read('lib/chit-move.js')) && !/liveBillEntries/.test(read('lib/books-hooks.js')));
  const code = [].concat(JSON.parse(read('docs/error-codes.json')).codes || JSON.parse(read('docs/error-codes.json'))).find((c) => c.code === 'ENTRY_OF_LIVE_BILL');
  ok('the code is registered: 409 with the shopkeeper sentence', code && String(code.status) === '409' && /credit note/.test(code.shopkeeper), JSON.stringify(code));
  ok('the route sentence is the register sentence', route.includes("'" + (code ? code.shopkeeper : '') + "'"));
  console.log(fail ? '\n' + fail + ' FAILED' : '\nall ok');
  process.exitCode = fail ? 1 : 0;
})();
