'use strict';
/**
 * tests/r103-reverse-live-bill.test.cjs — R1-03 (DEC-267), offline: Reverse on a live sale_bill / purchase_bill is refused AT THE ROUTE, never in the one writer.
 *   1 lib/books-live-bill.js liveBillEntries asks one query for a page, names only sale_bill / purchase_bill whose source is exactly chit:<id>, unreversed, whose chit is not cancelled / rejected; bad ids ask nothing
 *   2 POST /entries/:id/reverse has refuseLiveBill in its chain BEFORE the handler that calls B.reverseEntry (409 ENTRY_OF_LIVE_BILL); the day book hands may_reverse + why from the same reader and the same sentence
 *   3 lib/books.js reverseEntry holds no such check, so the cancel path (chit-move → books-hooks.takeBackCancelled → reverseIfPosted) still works
 *   4 the code is in the register with its shopkeeper sentence
 * Real Postgres: tests/r103-reverse-live-bill.realstack.cjs (scenarios R103-AU / R103-AE). CARD 14-accounting (R1 slice C)
 */
const fs = require('fs');
const path = require('path');
const S = require('../lib/books-live-bill');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
let fail = 0;
const ok = (name, cond, why) => { if (cond) console.log('   ok   ' + name); else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };

(async () => {
  const calls = [];
  const db = { query: async (sql, args) => { calls.push({ sql, args }); return /SAVEPOINT/.test(sql) ? { rows: [] } : /walkin_day/.test(sql) ? { rows: [{ entry_id: "99999999-9999-4999-8999-999999999999", event_type: 'walkin_day' }] } : { rows: [{ entry_id: "11111111-1111-4111-8111-111111111111", event_type: 'expense' }] }; } };
  const E = '22222222-2222-4222-8222-222222222222', X = '11111111-1111-4111-8111-111111111111';
  const live = await S.liveBillEntries(db, E, [X, 'not-an-id']);
  ok('the bad id never reaches the reads', calls.every((c) => !c.args || !JSON.stringify(c.args).includes('not-an-id')) && calls.length >= 1);
  ok('the answer is a Set of entry ids (the chit-sourced one and the walk-in day)', live instanceof Set && live.has(X) && live.has('99999999-9999-4999-8999-999999999999'));
  const kinds = await S.liveEntryKinds(db, E, [X]);
  ok('the kinds: an expense is live, worded by its own sentence (Q4)', kinds.get(X) === 'expense' && S.wordsOf('expense') !== S.LIVE_BILL_WORDS);
  ok('words by side: sold bill · buyer bill · walk-in day · credit note / expense', S.wordsOf('sale_bill') === S.LIVE_BILL_WORDS && /Ask the supplier for a credit note/.test(S.wordsOf('purchase_bill')) && /counter sales/.test(S.wordsOf('walkin_day')) && /document that is still live/.test(S.wordsOf('return')));
  const sql = calls[0].sql, daySql = calls.map((c) => c.sql).find((x) => /walkin_day/.test(x));
  ok('only bills, only the chit source (and its :asset|:use halves), not reversed, not cancelled / rejected', sql.includes('event_type = ANY($3::text[])') && calls[0].args[2].includes('debit_note') && calls[0].args[2].includes('credit_note') && calls[0].args[2].includes('expense') && !calls[0].args[2].includes('payment') && /walkin_day/.test(daySql) && daySql.includes('source_chit_ids') && daySql.includes('cardinality') && sql.includes("'^chit:[0-9a-f-]{36}(:asset|:use)?$'") && sql.includes('reverses_entry_id = x.entry_id') && sql.includes("'cancelled', 'rejected'"));
  const before = calls.length; ok('no ids → no query', (await S.liveBillEntries(db, E, [])).size === 0 && calls.length === before);

  const route = read('routes/books.js'), mod = read('lib/books-live-bill.js'), at = route.indexOf("router.post('/entries/:id/reverse'"), line = route.slice(at, route.indexOf('\n', at));
  ok('the reverse route has the live-bill guard in its chain, after the input check and before the handler', line.indexOf("checked('POST /entries/:id/reverse')") < line.indexOf('LiveBill.refuseLiveBill') && line.indexOf('LiveBill.refuseLiveBill') < line.indexOf('async (req, res)'));
  ok('the guard refuses ENTRY_OF_LIVE_BILL (409) and otherwise goes on (next)', /ENTRY_OF_LIVE_BILL/.test(mod) && /status: 409/.test(mod) && mod.includes('return next();'));
  ok('the day book answers may_reverse + why from the same reader', route.includes('LiveBill.markReverseAnswers(h, e, entries)') && mod.includes('item.may_reverse = ') && mod.includes('words: wordsOf('));
  const books = read('lib/books.js'), rev = books.slice(books.indexOf('async function reverseEntry'), books.indexOf('async function reverseEntry') + 500);
  ok('reverseEntry (the one writer) holds no live-bill check: the cancel path stays open', !/LIVE_BILL|liveBill/.test(rev));
  ok('no other door calls the route: chit-move and books-hooks reach the writer directly', !/liveBill/i.test(read('lib/chit-move.js')) && !/liveBill/i.test(read('lib/books-hooks.js')));
  const act = read('lib/books-action.js'), post = act.slice(act.indexOf('async function postReversal'), act.indexOf('async function postReversal') + 700);
  ok('the delegated / adviser Reverse asks the same reader BEFORE reverseEntry and answers the same code (ACC-357)', post.indexOf('liveEntryKinds') > 0 && post.indexOf('liveEntryKinds') < post.indexOf('reverseEntry') && /ENTRY_OF_LIVE_BILL', 409/.test(post));
  const code = [].concat(JSON.parse(read('docs/error-codes.json')).codes || JSON.parse(read('docs/error-codes.json'))).find((c) => c.code === 'ENTRY_OF_LIVE_BILL');
  ok('the code is registered: 409 with the shopkeeper sentence', code && String(code.status) === '409' && /credit note/.test(code.shopkeeper), JSON.stringify(code));
  ok('the module sentence is the register sentence', mod.includes("'" + (code ? code.shopkeeper : '') + "'"));
  console.log(fail ? '\n' + fail + ' FAILED' : '\nall ok');
  process.exitCode = fail ? 1 : 0;
})();
