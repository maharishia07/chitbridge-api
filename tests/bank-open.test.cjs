/**
 * bank-open.test.cjs — the open documents the bank sheet matches a statement line against (lib/bank-open.js). Offline: the books and the store are stubbed, the receivables engine is the real one.
 * Unit per rule · the refusal path (a disputed or settled bill is never offered; a cost-blind reader gets no supplier side) · fail closed (the engine's refusal is not swallowed). Run: node tests/bank-open.test.cjs
 * CARD 16-finance/bank-reconciliation-and-bank-rail
 */
'use strict';
const path = require('path');
const API = path.join(__dirname, '..');
const stub = (name, exports) => { const file = require.resolve(path.join(API, 'lib', name)); require.cache[file] = { id: file, filename: file, loaded: true, exports }; };
let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };

const bill = (party, ref, minor, extra) => Object.assign({ party, side: 'receivable', ref_kind: 'bill', ref, against_ref: ref, amount_minor: minor, currency: 'INR', date: '2026-10-01', due_date: '2026-10-31' }, extra || {});
let itemsBy = {}; const reads = { control: 0, items: 0, billNos: 0 };
stub('books', {
  controlOf: async (handle, entity, side) => { reads.control++; return { account_id: 'acct-' + side }; },
  partyItems: async (handle, entity, party, accountId) => { reads.items++; return itemsBy[accountId] || []; }
});
stub('books-store', { billNos: async (handle, entity, refs) => { reads.billNos++; return Object.fromEntries(refs.map((ref) => [ref, 'INV-' + ref])); } });
const BankOpen = require(path.join(API, 'lib', 'bank-open'));

const names = new Map([
  ['p1', { party_id: 'p1', name: 'Ravi', customer: true }],
  ['p2', { party_id: 'p2', nickname: 'Anand Mills', name: 'Anand', supplier: true }],
  ['p3', { party_id: 'p3', name: 'Both Ltd', customer: true, supplier: true }],
  ['p4', { party_id: 'p4' }]
]);

(async () => {
  const parties = BankOpen.partiesOf(names, true);
  ok('a customer and a supplier are each one row with their kind', parties.find((row) => row.id === 'p1').kind === 'customer' && parties.find((row) => row.id === 'p2').kind === 'supplier');
  ok('the nickname is the name the engine compares', parties.find((row) => row.id === 'p2').name === 'Anand Mills');
  ok('a party on both lists is ONE row with no kind', parties.filter((row) => row.id === 'p3').length === 1 && parties.find((row) => row.id === 'p3').kind === undefined);
  ok('a party with no name is left out', !parties.some((row) => row.id === 'p4'));
  const blind = BankOpen.partiesOf(names, false);
  ok('a cost-blind reader gets no supplier: the supplier row is refused, a both-sides party becomes a customer', !blind.some((row) => row.id === 'p2') && blind.find((row) => row.id === 'p3').kind === 'customer');

  itemsBy = {
    'acct-customer': [bill('p1', 'B1', 1000), bill('p1', 'B2', 500, { date: '2026-10-05', due_date: null }), bill('p3', 'B3', 300)],
    'acct-supplier': [bill('p2', 'S1', 2500, { side: 'payable' })]
  };
  const out = await BankOpen.openDocuments({}, 'shop', { names, currency: 'INR', withCosts: true });
  const byRef = Object.fromEntries(out.open_items.map((row) => [row.ref, row]));
  ok('every open bill of both control accounts is offered, with its currency and document number', out.open_items.length === 4 && byRef.B1.currency === 'INR' && byRef.B1.bill_no === 'INV-B1');
  ok('the open figure is the engine outstanding (a bill raised 1000 is open 1000)', byRef.B1.open_minor === 1000 && byRef.B1.side === 'customer');
  ok('a bill with no due date keeps null, never an invented one', byRef.B2.due_date === null);
  ok('the supplier side carries its own side tag', byRef.S1 && byRef.S1.side === 'supplier');
  ok('one read of each control account, one read of the document numbers, nothing per row', reads.control === 2 && reads.items === 2 && reads.billNos === 1, JSON.stringify(reads));

  reads.control = reads.items = reads.billNos = 0;
  const blindOut = await BankOpen.openDocuments({}, 'shop', { names, currency: 'INR', withCosts: false });
  ok('refusal: withCosts false leaves the supplier side out (never read at all)', !blindOut.open_items.some((row) => row.side === 'supplier') && reads.control === 1, JSON.stringify(reads));

  const dispute = { party: 'p1', side: 'receivable', ref_kind: 'status', ref: 'B9', against_ref: 'B9', amount_minor: 0, currency: 'INR', status: 'disputed', date: '2026-10-02' };
  itemsBy = { 'acct-customer': [bill('p1', 'B9', 400), dispute, bill('p1', 'B8', 400)], 'acct-supplier': [] };
  const kept = await BankOpen.openDocuments({}, 'shop', { names, currency: 'INR' });
  ok('refusal: a disputed bill is never offered to a payment (C4), its sibling is', kept.open_items.length === 1 && kept.open_items[0].ref === 'B8');
  ok('the default for withCosts is on (only an explicit false is cost-blind)', kept.parties.some((row) => row.kind === 'supplier'));

  itemsBy = { 'acct-customer': [], 'acct-supplier': [] };
  const empty = await BankOpen.openDocuments({}, 'shop', { names, currency: 'INR' });
  reads.billNos = 0;
  ok('no open bill is an empty list and no document-number read', empty.open_items.length === 0 && reads.billNos === 0 && empty.parties.length === 3);

  itemsBy = { 'acct-customer': [bill('p1', 'B1', 1000), bill('p1', 'B1x', 5, { currency: 'USD' })], 'acct-supplier': [] };
  let refused = null;
  try { await BankOpen.openDocuments({}, 'shop', { names, currency: 'INR' }); } catch (err) { refused = err; }
  ok('fail closed: two currencies in one control account is the engine refusal, not a quiet mix', refused && /Cannot mix currencies/.test(refused.message), refused && refused.message);
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((err) => { console.log('ERROR ' + (err && err.stack)); process.exit(1); });
