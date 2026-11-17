/**
 * lib-opening-bills.test.cjs — the opening-balances page rules and the party-bills page rules that need no database.
 * Modules: lib/books-opening.js (splitRows · billsByControl · the refusals of replaceOpening) · lib/books-party-bills.js (standingOf · the sorts · the tabs)
 * Unit per rule · the refusal path · fail closed. Run: node tests/lib-opening-bills.test.cjs
 * CARD 14-accounting/README
 */
'use strict';
const Opening = require('../lib/books-opening');
const PartyBills = require('../lib/books-party-bills');
let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const thrown = async (fn) => { try { await fn(); return null; } catch (err) { return err; } };

// ---- books-opening
const rows = [
  { code: '1200', party_no: 'P-1', dr_minor: 600, cr_minor: 0 },
  { code: '1200', party_no: 'P-2', dr_minor: 400, cr_minor: 0 },
  { code: '1200', control: true, dr_minor: 1000, cr_minor: 0 },
  { code: '3000', control: true, dr_minor: 0, cr_minor: 50 },
  { code: '1000', dr_minor: 70, cr_minor: 0 }
];
const split = Opening.splitRows(rows);
ok('a typed control total with bills under it is checked, never posted', split.controls.length === 1 && split.controls[0].code === '1200' && !split.post.some((row) => row.control));
ok('a control total with no bills under it is an ordinary line', split.post.some((row) => row.code === '3000'));
ok('splitRows of nothing is nothing (closed, not an error)', Opening.splitRows(null).post.length === 0 && Opening.splitRows(undefined).controls.length === 0);
const chart = [{ code: '1200', name: 'Debtors' }];
const bills = Opening.billsByControl(split.post, split.controls, chart, 'INR');
ok('bills per control ledger: the sum of the bill rows beside the typed total, nothing recomputed', bills.length === 1 && bills[0].bills_minor === 1000 && bills[0].typed_minor === 1000 && bills[0].apart_minor === 0);
const apartRows = split.controls.map((row) => Object.assign({}, row, { dr_minor: 900 }));
ok('refusal: a typed total apart from its bills shows the gap in minor units', Opening.billsByControl(split.post, apartRows, chart, 'INR')[0].apart_minor === 100);
ok('a ledger with bills and no typed total has no gap to refuse', Opening.billsByControl(split.post, [], chart, 'INR')[0].typed_minor === null && Opening.billsByControl(split.post, [], chart, 'INR')[0].apart_minor === 0);

(async () => {
  const noReason = await thrown(() => Opening.replaceOpening({}, 'shop', { rows: [], date: '2026-04-01', client_ref: 'x' }));
  ok('refusal: a change to the opening balances needs a reason', noReason && /needs a reason/.test(noReason.message), noReason && noReason.message);
  const noRef = await thrown(() => Opening.replaceOpening({}, 'shop', { rows: [], date: '2026-04-01', reason: 'typo' }));
  ok('refusal: a change needs a client_ref so a second tap cannot post it twice', noRef && /client_ref/.test(noRef.message), noRef && noRef.message);

  // ---- books-party-bills
  ok('standingOf: paid when nothing is owed, part when less is owed than the bill, unpaid otherwise', PartyBills.standingOf(1000, 0) === 'paid' && PartyBills.standingOf(1000, 400) === 'part' && PartyBills.standingOf(1000, 1000) === 'unpaid');
  ok('standingOf: an over-paid bill (owed below nothing) reads paid, never unpaid', PartyBills.standingOf(1000, -50) === 'paid');
  ok('the states and tabs are the ones the route lists', PartyBills.STATES.includes('part') && PartyBills.TABS.join() === 'needs,open,all');
  const bill = { date: '2026-10-01', due_date: '2026-10-15', days_overdue: 12, amount_minor: 900, owed_minor: 400, bill_no: 'INV-7', ref: 'B7' };
  ok('every sort reads one column of the bill row', PartyBills.SORTS.date(bill) === '2026-10-01' && PartyBills.SORTS.due(bill) === '2026-10-15' && PartyBills.SORTS.days(bill) === 12 && PartyBills.SORTS.amount(bill) === 900 && PartyBills.SORTS.owed(bill) === 400 && PartyBills.SORTS.bill(bill) === 'INV-7');
  ok('a bill not yet due sorts below every late one; a bill with no number sorts by its reference', PartyBills.SORTS.days({ days_overdue: null }) === -1 && PartyBills.SORTS.bill({ ref: 'B9' }) === 'B9');
  ok('refusal: an unknown sort word is no sort (the table has only its own keys)', !Object.prototype.hasOwnProperty.call(PartyBills.SORTS, 'drop table'));
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((err) => { console.log('ERROR ' + (err && err.stack)); process.exit(1); });
