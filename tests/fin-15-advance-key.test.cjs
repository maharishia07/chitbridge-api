/**
 * tests/fin-15-advance-key.test.cjs — FIN-15: a /dues row carries `advance_minor`, what the party paid on account that no bill took (netOpen's unapplied_by_party — the ONE figure).
 * OWNS      the hand-computed proof of the key: a customer with a 10,000 bill and a 17,000 receipt on account has 7,000 left on account; a party with no advance says 0; a both-sides row adds the two halves; a cost-blind reader gets null on a supplier or both-sides row
 * CALLED BY npm test (pure node, no database)   FLOW  items → books-engines.dues → books-dues-rows.partyRow / mergeSides → dues-view.blindDuesRow
 * CARD      16-finance/receivables-and-payables
 */
'use strict';
const path = require('path');
const H = require('./support/books-harness.cjs');
if (!H.enginesSrc().dir) { console.log('\n   SKIP: ' + H.enginesSrc().why + '\n'); process.exit(1); }
const E = require(path.join(H.API, 'lib', 'books-engines'));
const PACK = require(path.join(H.API, 'lib', 'regulation')).packFor('IN');
const Rows = require(path.join(H.API, 'lib', 'books-dues-rows'));
const View = require(path.join(H.API, 'lib', 'dues-view'));
let pass = 0, fail = 0;
const t = (label, got, want) => { const same = JSON.stringify(got) === JSON.stringify(want); same ? pass++ : fail++; console.log('  ' + (same ? 'ok  ' : 'FAIL') + '  ' + label + (same ? '' : '\n        got  ' + JSON.stringify(got) + '\n        want ' + JSON.stringify(want))); };
let seq = 0;
const item = (party, o, side) => Object.assign({ item_id: 'i-' + (++seq), party, party_id: party, side: side || 'receivable', currency: 'INR' }, o);
const bill = (party, ref, minor, side) => item(party, { ref_kind: 'bill', kind: 'sale', ref, against_ref: ref, amount_minor: minor, date: '2026-10-01', doc_date: '2026-10-01', due_date: '2026-10-31', entry_id: 'e-' + ref }, side);
const paid = (party, ref, minor, side) => item(party, { ref_kind: 'advance', kind: 'payment', ref, against_ref: ref, amount_minor: minor, date: '2026-10-10' }, side);
const ctx = { currency: 'INR' }, needs = { by_party: new Map() };
const rowOf = (role, party, items) => {
  const side = role === 'creditors' ? 'payable' : 'receivable';
  const dues = E.dues(items, '2026-11-16', side, { pack: PACK });
  const docs = Object.keys(dues.open.by_ref).map((ref) => dues.open.by_ref[ref]).filter((d) => String(d.party) === party);
  return Rows.partyRow(ctx, role, party, dues, docs, needs);
};

/* hand: bill 10,000.00 (1000000 minor), receipt 17,000.00 (1700000) -> the bill is covered, 700000 stays on account; the balance is -700000 */
const customer = rowOf('debtors', 'c1', [bill('c1', 'B1', 1000000), paid('c1', 'P1', -1700000)]);
t('customer: the advance is what no bill took: 1,700,000 - 1,000,000 = 700,000', customer.advance_minor, 700000);
t('customer: the balance is the net, the advance is a magnitude beside it', customer.balance_minor, -700000);
const none = rowOf('debtors', 'c2', [bill('c2', 'B2', 500000)]);
t('a party with no receipt on account says 0, not a missing key', none.advance_minor, 0);
const paidFull = rowOf('debtors', 'c3', [bill('c3', 'B3', 500000), paid('c3', 'P3', -500000), bill('c3', 'B4', 100000)]);
t('a receipt a bill took is no advance: 500,000 receipt against 600,000 of bills leaves 0 on account', paidFull.advance_minor, 0);
/* a supplier the shop paid ahead: bill 400,000, paid 1,000,000 -> 600,000 ahead */
const supplier = rowOf('creditors', 's1', [bill('s1', 'S1', 400000, 'payable'), paid('s1', 'SP1', -1000000, 'payable')]);
t('supplier: paid ahead is 1,000,000 - 400,000 = 600,000', supplier.advance_minor, 600000);
const merged = Object.assign({}, customer, { needs: { a: 0 }, buckets: {} });
Rows.mergeSides(merged, Object.assign({}, supplier, { needs: { a: 0 }, buckets: {} }), null, false);
t('both sides: the two advances add (700,000 + 600,000), as the balances net', [merged.side, merged.advance_minor], ['both', 1300000]);
t('cost-blind: a customer row keeps the figure (sell-side money)', View.blindDuesRow(customer).advance_minor, 700000);
t('cost-blind: a supplier row and a both-sides row answer null, the key stays', [View.blindDuesRow(supplier).advance_minor, View.blindDuesRow(merged).advance_minor], [null, null]);
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
