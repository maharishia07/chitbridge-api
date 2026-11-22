/**
 * books-dues-units.test.cjs — the dues read and its row builders, rule by rule (lib/books-dues.js + lib/books-dues-rows.js). Offline: the store, the books and the terms are stubbed; the engines are the real ones.
 * (The byte-for-byte golden of the whole /dues answer is tests/books-dues-core.test.cjs.)
 * Unit per rule · the refusal path (a settled party is no row; a side not asked for is null, never a zero) · fail closed (no chart account for a role reads nothing). Run: node tests/books-dues-units.test.cjs
 * CARD 16-finance/receivables-and-payables
 */
'use strict';
process.env.SHOP_CLOCK_ALLOW = '1';
const path = require('path');
const API = path.join(__dirname, '..');
const stub = (name, exports) => { const file = require.resolve(path.join(API, 'lib', name)); require.cache[file] = { id: file, filename: file, loaded: true, exports }; };
let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };

const calls = { items: 0, openItems: 0 }; let chart = []; let rowsBy = {};
stub('books', { curOf: () => 'INR', packOf: (setting) => require(path.join(API, 'lib', 'books-engines')).packs().packFor(setting && setting.country), dateWords: (day) => day, owesWords: (minor) => (minor > 0 ? 'owes you' : minor < 0 ? 'you owe' : 'settled') });
stub('books-store', {
  accounts: async () => chart,
  openItems: async (handle, entity, accountId) => { calls.openItems++; return rowsBy[accountId] || []; },
  items: async (handle, entity, party, accountId) => { calls.items++; return rowsBy[accountId] || []; },
  fxLinesReady: async () => false,
  movedByLock: async () => [] /* AC-F-02: no entry moved by a lock in this stub */
});
stub('books-needs', { empty: () => ({ marks: 0 }), partyNeeds: async () => ({ by_party: new Map() }) });
stub('books-hooks', { dayOf: (moment) => new Date(moment).toISOString().slice(0, 10), dayBounds: (day) => ({ to: day + 'T23:59:59Z' }) });
const terms = { shop: {}, by_party: new Map() };
stub('finance-terms', { customerTerms: async () => terms, resolve: () => ({ credit_days: { value: 30 }, interest: { value: null }, early: { value: null } }) });
const CLOCK = require(path.join(API, 'lib', 'shop-clock'));
const Dues = require(path.join(API, 'lib', 'books-dues'));
const Rows = require(path.join(API, 'lib', 'books-dues-rows'));

const dbBill = (party, ref, minor, day, due) => ({ item_id: ref, entry_id: 'e-' + ref, party_id: party, side: 'receivable', ref_kind: 'bill', ref, against_ref: ref, amount_minor: minor, currency: 'INR', doc_date: day, due_date: due || null, created_at: day + 'T06:00:00Z' });

(async () => {
  CLOCK.set('2026-11-16T06:00:00Z');
  // the small readers
  ok('withBalanceWords says the standing in the payment outcome own words', Dues.withBalanceWords('INR')({ balance_minor: 500 }).balance_words === 'owes you');
  ok('termsReaders: a party with no list row has no effective terms (null), a listed one resolves', (() => {
    const readers = Dues.termsReaders({ resolve: (shop, own) => ({ from: own, credit_days: { value: own.credit_days } }) }, { shop: {}, by_party: new Map([['p1', { credit_days: 7 }]]) });
    return readers.effOf('p9') === null && readers.effOf('p1').from.credit_days === 7 && readers.followOpt.creditDaysOf('p1') === 7;
  })());
  ok('termsReaders: null terms is not the Collections read (no follow options)', Dues.termsReaders({}, null).followOpt === null && Dues.termsReaders({}, null).effOf('p1') === null);
  ok('earlyOfferRow: no documents, or only disputed ones, is no offer (null)', Dues.earlyOfferRow([], '2026-11-01', 'INR', null) === null && Dues.earlyOfferRow([{ ref: 'B1', outstanding_minor: 100, disputed: true }], '2026-11-01', 'INR', null) === null);
  const figures = Dues.termsFigures([], '2026-11-01', 'INR', null);
  ok('termsFigures with no terms: early null, interest figures present (SHOWN, never posted)', figures.early === null && 'interest_minor' in figures && 'interest_state' in figures);
  const side = [{ side: 'customer', balance_minor: 700, follow_up: { not_due: 1 } }, { side: 'supplier', balance_minor: -200 }];
  const aged = Dues.agedTotals(side, ['debtors'], 'INR');
  ok('agedTotals: the Total column is the rows signed balances; a side not asked for is null, never a zero', aged.customer.balance_minor === 700 && aged.supplier === null);
  ok('agedTotals: a supplier total is negative as its rows are', Dues.agedTotals(side, ['creditors'], 'INR').supplier.balance_minor === -200);
  ok('pageExtras adds payables and the follow-up total only when asked', (() => {
    const bare = Dues.pageExtras(false, null, side, ['debtors'], 'INR'), full = Dues.pageExtras(true, { total_minor: 5 }, side, ['debtors'], 'INR');
    return !('payables' in bare) && !('follow_up_total' in bare) && full.payables.total_minor === 5 && 'follow_up_total' in full && 'aged_totals' in full;
  })());

  // the row builders
  const docs = { B1: { ref: 'B1', party: 'p1', outstanding_minor: 900, due_date: '2026-10-01', date: '2026-09-01' }, B2: { ref: 'B2', party: 'p1', outstanding_minor: 100, due_date: null, date: '2026-09-20' }, B3: { ref: 'B3', party: 'p2', outstanding_minor: 0 } };
  const grouped = Rows.openDocsByParty(docs);
  ok('openDocsByParty groups the open documents once per party and drops the settled', grouped.get('p1').length === 2 && !grouped.has('p2'));
  const dues = { ageing: { by_party: { p1: { undisputed: { d0_30: 1000 }, disputed: { d0_30: 50 }, total_minor: 1050 } } }, outstanding: { by_party: { p1: 1000, p2: 0 } }, follow: null };
  const needs = { by_party: new Map([['p1', { marks: 2 }]]) };
  const row = Rows.partyRow({ currency: 'INR' }, 'debtors', 'p1', dues, grouped.get('p1'), needs);
  ok('partyRow: a customer is positive, oldest due is the earliest, needs ride beside the balance', row.balance_minor === 1000 && row.side === 'customer' && row.oldest_due === '2026-09-20' && row.needs.marks === 2, JSON.stringify(row));
  ok('partyRow: the buckets carry the disputed share too and the disputed total is kept', row.buckets.d0_30 === 1050 && row.disputed_minor === 50);
  ok('partyRow: a supplier row is signed negative', Rows.partyRow({ currency: 'INR' }, 'creditors', 'p1', dues, grouped.get('p1'), needs).balance_minor === -1000);
  ok('refusal: a party that owes nothing and holds nothing open is not a row (E15)', Rows.partyRow({ currency: 'INR' }, 'debtors', 'p2', { ageing: { by_party: {} }, outstanding: { by_party: { p2: 0 } } }, [], needs) === null);
  const into = { balance_minor: 1000, disputed_minor: 0, needs: { marks: 1 }, side: 'customer', oldest_due: '2026-10-01', buckets: { d0_30: 5 }, follow_up: 'cust' };
  Rows.mergeSides(into, { balance_minor: -300, disputed_minor: 0, needs: { marks: 2 }, side: 'supplier', oldest_due: '2026-09-01', buckets: { d0_30: -2, d31_60: 4 }, follow_up: 'supp' }, null, false);
  ok('mergeSides nets a party on both lists: balance, needs, buckets, earliest due; the customer half is what ages', into.balance_minor === 700 && into.needs.marks === 3 && into.side === 'both' && into.oldest_due === '2026-09-01' && into.buckets.d0_30 === 3 && into.buckets.d31_60 === 4 && into.follow_up === 'cust');
  const rowsById = new Map([['p1', { balance_minor: 1 }]]);
  Rows.mergeForeign(rowsById, [{ party_id: 'p1', txn_currency: 'USD', txn_minor: 100, fn_minor: 8300 }, { party_id: 'p1', txn_currency: 'USD', txn_minor: 50, fn_minor: 4150 }, { party_id: 'nobody', txn_currency: 'USD', txn_minor: 1, fn_minor: 1 }]);
  ok('mergeForeign adds a foreign balance beside the books figure, one line per currency, and ignores a party with no row', rowsById.get('p1').foreign.length === 1 && rowsById.get('p1').foreign[0].balance_minor === 150 && rowsById.get('p1').foreign[0].carried_minor === 12450);

  // the whole read, in memory
  chart = [{ role: 'debtors', account_id: 'AD' }];
  rowsBy = { AD: [dbBill('p1', 'B1', 1000, '2026-10-01', '2026-10-15'), dbBill('p1', 'B2', 500, '2026-10-20')] };
  const names = async (handle, entity, ids) => new Map(ids.map((id) => [String(id), { party_no: 'P-1', name: 'Ravi' }]));
  const req = { books: { country: 'IN' } };
  const out = await Dues.read({}, 'shop', { req, fin: false, pay: false, sides: ['debtors'], asOf: '2026-11-01', partyNames: names });
  ok('read: one row per party with its balance in words, the biggest first', out.rows.length === 1 && out.rows[0].balance_minor === 1500 && out.rows[0].balance_words === 'owes you' && out.rows[0].name === 'Ravi' && out.payables === null, JSON.stringify(out));
  ok('read: a past day reads every row (not only the open ones)', calls.items === 1 && calls.openItems === 0);
  await Dues.read({}, 'shop', { req, fin: false, pay: false, sides: ['debtors'], asOf: '2026-11-17', partyNames: names });
  ok('read: as at today reads the OPEN documents only (GROWTH5Y)', calls.openItems === 1);
  const later = await Dues.read({}, 'shop', { req, fin: false, pay: false, sides: ['debtors'], asOf: '2026-09-30', partyNames: names });
  ok('refusal: a document dated after the asOf day is not read into it (age by document date)', later.rows.length === 0);
  // B1 (Fable 1117b, client 013): a party on BOTH lists is on each aged table with that list's own amount, and each total ties to its control ledger
  chart = [{ role: 'debtors', account_id: 'AD' }, { role: 'creditors', account_id: 'AC' }];
  const supBill = Object.assign(dbBill('p1', 'S1', 4642, '2026-10-01', '2026-10-31'), { side: 'payable' });
  rowsBy = { AD: [dbBill('p1', 'B1', 5000, '2026-06-01', '2026-06-15'), dbBill('p2', 'B9', 440, '2026-10-20', '2026-11-20')], AC: [supBill] };
  const both = await Dues.read({}, 'shop', { req, fin: false, pay: false, sides: ['debtors', 'creditors'], asOf: '2026-11-01', partyNames: names });
  const harbour = both.rows.find((r) => r.party_id === 'p1');
  const totals = Dues.agedTotals(both.rows, ['debtors', 'creditors'], 'INR');
  ok('both sides: the net stays (358-style) and each list keeps its own amount in sides', harbour.side === 'both' && harbour.balance_minor === 358 && harbour.sides.customer.balance_minor === 5000 && harbour.sides.supplier.balance_minor === -4642, JSON.stringify(harbour.sides));
  ok('both sides: the customer total ties to the debtors control (5,440), the supplier total to the creditors control', totals.customer.balance_minor === 5440 && totals.supplier.balance_minor === -4642, JSON.stringify(totals));
  ok('both sides: the late debtor is in the customer total aged 90+ days', totals.customer.d90_plus === 5000, JSON.stringify(totals.customer));
  ok('both sides, cost-blind reader: the supplier half rides nowhere (sides null, balance hidden)', (() => { const blind = require(path.join(API, 'lib', 'dues-view')).blindDuesRow(harbour); return blind.sides === null && blind.balance_minor === null && blind.follow_up === null; })(), 'blind row');
  chart = [];
  const closed = await Dues.read({}, 'shop', { req, fin: false, pay: false, sides: ['debtors', 'creditors'], asOf: '2026-11-01', partyNames: names });
  ok('fail closed: a role with no chart account reads nothing — no rows, no payables, no throw', closed.rows.length === 0 && closed.payables === null);
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((err) => { console.log('ERROR ' + (err && err.stack)); process.exit(1); });
