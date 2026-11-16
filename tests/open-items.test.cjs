/**
 * open-items.test.cjs — l16-scale (5-year growth): the OPEN documents of a shop (lib/books-open-items.js) give the engines the SAME answers as every row ever written.
 * The SQL is one statement; here its rule is run in JS over a seeded history (bills, part and full payments, a payment over several bills, cheques, disputes, reversals) and the ENGINE is run on both sets:
 * the ageing buckets, the owed total, the netted open bills and the unapplied credit per party are COMPARED (two carried answers), never recomputed another way.
 * A mutation (dropping the linked documents) must break the answer, or the test proves nothing. The statement itself was run on a Postgres rig at 8 years: same answer, 115,610 rows → 4,242.
 * Run: node tests/open-items.test.cjs
 */
'use strict';
process.env.DATABASE_URL = '';
const path = require('path');
const E = require(path.join(__dirname, '..', 'lib', 'books-engines.js'));
const B = require(path.join(__dirname, '..', 'lib', 'books.js'));
const OPEN = require(path.join(__dirname, '..', 'lib', 'books-open-items.js'));

let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };

/** the rule of the SQL, in JS: live = a document whose rows do not net to nothing, or that has a status row; closed over the allocation links both ways; a row is read by the document it is against */
function openRows(rows, skipLinks) {
  const net = new Map(), status = new Set(), links = new Map();
  rows.forEach((row) => {
    net.set(row.against_ref, (net.get(row.against_ref) || 0) + row.amount_minor);
    if (row.ref_kind === 'status') status.add(row.against_ref);
    if (row.ref !== row.against_ref && !skipLinks) {
      (links.get(row.ref) || links.set(row.ref, new Set()).get(row.ref)).add(row.against_ref);
      (links.get(row.against_ref) || links.set(row.against_ref, new Set()).get(row.against_ref)).add(row.ref);
    }
  });
  const live = new Set([...net.keys()].filter((ref) => net.get(ref) !== 0 || status.has(ref)));
  const queue = [...live];
  while (queue.length) for (const next of links.get(queue.pop()) || []) if (!live.has(next)) { live.add(next); queue.push(next); }
  return rows.filter((row) => live.has(row.against_ref));
}

/* a seeded history: 30 customers, 5 years of bills; receipts fully, partly, or over several bills; some cheques not cleared; some disputes */
let seed = 20261116;
const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
const rows = [];
let id = 0;
const add = (party, ref, against, kind, how, amount, date, due, extra) => rows.push(Object.assign({ item_id: ++id, party_id: party, account_id: 'acc', side: 'receivable', ref, against_ref: against, ref_kind: kind, kind: how, amount_minor: amount, pending_minor: null, currency: 'INR', due_date: due || null, doc_date: date, status: null, reverses: null, reverses_kind: null, entry_id: null, payment_id: null, created_at: date }, extra || {}));
const day = (n) => new Date(Date.UTC(2021, 3, 1) + n * 86400000).toISOString().slice(0, 10);
const bills = [];
for (let n = 0; n < 900; n++) {
  const party = 'p' + (n % 30), date = day(n * 2), ref = 'B' + n, amount = 10000 + rnd(400000);
  add(party, ref, ref, 'bill', 'sale', amount, date, day(n * 2 + 15));
  bills.push({ party, ref, amount, date });
}
let pay = 0;
bills.forEach((bill, n) => {
  const roll = rnd(100);
  if (roll < 70) { /* paid in full */ const p = 'pay:' + ++pay; add(bill.party, p, p, 'on_account', 'payment', -bill.amount, day(n * 2 + 20)); add(bill.party, p, bill.ref, 'allocation', 'payment', -bill.amount, day(n * 2 + 20)); add(bill.party, p, p, 'allocation', 'payment', bill.amount, day(n * 2 + 20)); }
  else if (roll < 80) { /* part paid */ const part = Math.floor(bill.amount / 3), p = 'pay:' + ++pay; add(bill.party, p, p, 'on_account', 'payment', -part, day(n * 2 + 20)); add(bill.party, p, bill.ref, 'allocation', 'payment', -part, day(n * 2 + 20)); add(bill.party, p, p, 'allocation', 'payment', part, day(n * 2 + 20)); }
  else if (roll < 85 && n > 3 && bills[n - 1].party === bill.party) { /* one receipt over this bill and the one before (when the same customer) */ const other = bills[n - 1], p = 'pay:' + ++pay; add(bill.party, p, p, 'on_account', 'payment', -(bill.amount + other.amount), day(n * 2 + 21)); [bill, other].forEach((x) => { add(bill.party, p, x.ref, 'allocation', 'payment', -x.amount, day(n * 2 + 21)); add(bill.party, p, p, 'allocation', 'payment', x.amount, day(n * 2 + 21)); }); }
  else if (roll < 88) { /* a cheque received, not cleared: a status row carries the amount */ const p = 'pay:' + ++pay; add(bill.party, p, p, 'status', 'payment', 0, day(n * 2 + 20), null, { pending_minor: -bill.amount, status: 'received' }); }
  else if (roll < 91) { /* disputed */ add(bill.party, bill.ref, bill.ref, 'status', 'sale', 0, day(n * 2 + 5), null, { status: 'disputed' }); }
  else if (roll < 93) { /* money on account that was never applied */ const p = 'pay:' + ++pay; add(bill.party, p, p, 'on_account', 'payment', -Math.floor(bill.amount / 2), day(n * 2 + 30)); }
  /* the rest: not paid at all */
});

(async () => {
  console.log('══ open documents: the engines answer the same on them as on every row ══');
  const setting = { country: 'IN', fy_start_month: 4, functional_currency: 'INR' };
  const pack = B.packOf(setting);
  const asOf = '2026-11-16';
  const answer = (set) => {
    const items = set.map(E.itemOf);
    const d = E.dues(items, asOf, 'receivable', { pack, creditDaysOf: () => null });
    return { outstanding: d.outstanding.total_minor, by_party: Object.keys(d.outstanding.by_party).filter((p) => d.outstanding.by_party[p] !== 0).sort().map((p) => [p, d.outstanding.by_party[p]]), /* a customer who owes nothing is no row: the same figure (0) either way */ ageing: d.follow.ageing.buckets, ageingTotal: d.follow.ageing.total_minor, open: Object.keys(d.open.by_ref).sort().map((ref) => [ref, d.open.by_ref[ref].outstanding_minor]), unapplied: Object.keys(d.open.unapplied_by_party).sort().map((p) => [p, d.open.unapplied_by_party[p]]) };
  };
  const all = answer(rows);
  const kept = openRows(rows);
  ok('the history is big enough to mean something (' + rows.length + ' rows, ' + kept.length + ' kept)', rows.length > 3000 && kept.length < rows.length / 3, rows.length + ' / ' + kept.length);
  ok('the owed total, per-party balances, ageing buckets, netted open bills and unapplied credit are the same on the open documents as on every row', JSON.stringify(answer(kept)) === JSON.stringify(all));
  let dropped = null;
  try { dropped = JSON.stringify(answer(openRows(rows, true))); } catch (refused) { dropped = 'refused: ' + refused.message; } /* a split allocation pair is REFUSED by the engine (a lone half) — which is why the links are followed */
  ok('MUTATION: leaving out the linked documents changes the answer or is refused (the test can fail)', dropped !== JSON.stringify(all), String(dropped).slice(0, 100));

  const sql = OPEN.rowsSql('$1::uuid');
  ok('the statement is bound to the shop in every read of party_item', (sql.match(/FROM party_item/g) || []).length === 3 && (sql.match(/entity_id = \$1::uuid/g) || []).length === 3);
  ok('the statement keeps a pair together: a link is followed both ways, to the end', /RECURSIVE/.test(sql) && /both_ways/.test(sql) && /UNION ALL SELECT b, a FROM link/.test(sql));

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((error) => { console.error(error); process.exit(1); });
