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
const Store = require('../lib/books-store');
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
  ok('only bills, only the chit source (and its :asset|:use halves), not reversed, not cancelled / rejected', sql.includes("event_type IN ('sale_bill', 'purchase_bill')") && sql.includes("'^chit:[0-9a-f-]{36}(:asset|:use)?$'") && sql.includes('reverses_entry_id = x.entry_id') && sql.includes("'cancelled', 'rejected'"));
  ok('no ids → no query', (await S.liveBillEntries(db, E, [])).size === 0 && calls.length === 1);

  const route = read('routes/books.js'), mod = read('lib/books-live-bill.js'), at = route.indexOf("router.post('/entries/:id/reverse'"), line = route.slice(at, route.indexOf('\n', at));
  ok('the reverse route has the live-bill guard in its chain, after the input check and before the handler', line.indexOf("checked('POST /entries/:id/reverse')") < line.indexOf('LiveBill.refuseLiveBill') && line.indexOf('LiveBill.refuseLiveBill') < line.indexOf('async (req, res)'));
  ok('the guard refuses ENTRY_OF_LIVE_BILL (409) and otherwise goes on (next)', /ENTRY_OF_LIVE_BILL/.test(mod) && /status: 409/.test(mod) && mod.includes('return next();'));
  ok('the day book answers may_reverse + why from the same reader', route.includes('LiveBill.markReverseAnswers(h, e, entries)') && mod.includes('item.may_reverse = ') && /words: LIVE_BILL_WORDS/.test(mod));
  const books = read('lib/books.js'), rev = books.slice(books.indexOf('async function reverseEntry'), books.indexOf('async function reverseEntry') + 500);
  ok('reverseEntry (the one writer) holds no live-bill check: the cancel path stays open', !/LIVE_BILL|liveBill/.test(rev));
  ok('no other door calls the route: chit-move and books-hooks reach the writer directly', !/liveBill/i.test(read('lib/chit-move.js')) && !/liveBill/i.test(read('lib/books-hooks.js')));
  const code = [].concat(JSON.parse(read('docs/error-codes.json')).codes || JSON.parse(read('docs/error-codes.json'))).find((c) => c.code === 'ENTRY_OF_LIVE_BILL');
  ok('the code is registered: 409 with the shopkeeper sentence', code && String(code.status) === '409' && /credit note/.test(code.shopkeeper), JSON.stringify(code));
  ok('the module sentence is the register sentence', mod.includes("'" + (code ? code.shopkeeper : '') + "'"));
  const loanCode = [].concat(JSON.parse(read('docs/error-codes.json')).codes || JSON.parse(read('docs/error-codes.json'))).find((c) => c.code === 'ENTRY_HAS_REPAYMENTS');
  ok('a loan with live instalments: the same chain refuses it (ENTRY_HAS_REPAYMENTS 409, the register sentence), the delegated Reverse asks the same reader', loanCode && String(loanCode.status) === '409' && loanCode.shopkeeper === Store.LOAN_HAS_INSTALMENTS_WORDS && /instalments/.test(loanCode.shopkeeper) && !/repayments first/i.test(loanCode.title + loanCode.shopkeeper) && mod.includes('reverseRefusals(handle, entity, [entryId])') && /reverseRefusals/.test(read('lib/books-action.js')) && !/loanEntriesWithRepayments/.test(rev));
  const loanSql = [];
  const held = await Store.loanEntriesWithRepayments({ query: async (text) => { loanSql.push(text); return { rows: [{ entry_id: X }] }; } }, E, [X, 'bad']);
  ok('the loan reader: one query, loan: entries not reversed that hold an emi:<ref>:<x> not reversed', held.has(X) && loanSql.length === 1 && loanSql[0].includes("LIKE 'loan:%'") && loanSql[0].includes("LIKE 'emi:%'") && loanSql[0].includes('reverses_entry_id = i.entry_id') && /CASE WHEN i\.source_ref LIKE 'loan:%'/.test(loanSql[0]) && !/left\(/.test(loanSql[0]));
  const lib = read('lib/books-live-bill.js') + read('lib/books-store.js');
  ok('ONE definition of which loan an instalment belongs to: loanRefSql(alias), no position()/left() copy anywhere', /const loanRefSql = \(alias\)/.test(lib) && !/position\(':' IN/.test(lib) && !/LOAN_REF_SQL/.test(lib) && Store.loanRefSql('z') === Store.loanRefSql('x').split('x.').join('z.'));
  const wr = books.slice(books.indexOf('async function refuseLoanWithInstalments'), books.indexOf('async function writeReversal'));
  ok('the reversal asks again INSIDE the write: lock first, then the one read, owner reversals of loan: entries only; writeReversal calls it before posting', wr.indexOf('S.lockLoan') > 0 && wr.indexOf('S.lockLoan') < wr.indexOf('S.loanEntriesWithRepayments') && /entryEvent\.owner !== true/.test(wr) && /await refuseLoanWithInstalments\(handle, entity, orig, entryEvent\);/.test(books));
  const period = read('lib/books-period.js'), emiAt = period.slice(period.indexOf('async function loanEmi'));
  ok('loanEmi locks the loan for every instalment (interest-only too) and refuses a reversed loan in words', emiAt.indexOf('S.lockLoan') > 0 && emiAt.indexOf('S.lockLoan') < emiAt.indexOf("'loan:' + ref") && /That loan was reversed/.test(emiAt));
  /* the third caller, lib/books-hooks.js reverseOne (takeBackCancelled): chit:<id> bill entries only, never owner: true, so writeReversal's loan guard never applies */
  ok('books-hooks.reverseOne passes owner-less reversals of chit entries: it can never name a loan entry', !/owner:\s*true/.test(read('lib/books-hooks.js')));
  console.log(fail ? '\n' + fail + ' FAILED' : '\nall ok');
  process.exitCode = fail ? 1 : 0;
})();
