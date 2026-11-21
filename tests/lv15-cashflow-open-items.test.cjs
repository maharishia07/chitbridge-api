/**
 * lv15-cashflow-open-items.test.cjs — LV-15 (batch 1129): the cash view reads the OPEN documents of the two control accounts, not every party_item row ever written,
 * and project() answers THE SAME on them. A seeded history (bills paid in full, part paid, one receipt over two bills, cheques in hand, a dispute, a bill dated AFTER today,
 * money on account) goes through project() both ways and the whole answer is compared. The SQL is one statement (books-open-items, proved in open-items.test.cjs).
 * Run: node tests/lv15-cashflow-open-items.test.cjs
 */
'use strict';
process.env.DATABASE_URL = '';
const path = require('path');
const fs = require('fs');
const H = require('./support/books-harness.cjs');
const E = require(path.join(__dirname, '..', 'lib', 'books-engines.js'));
const OPEN = require(path.join(__dirname, '..', 'lib', 'books-open-items.js'));
let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };

/* the rule of rowsSql, in JS (as open-items.test.cjs): live = nets to something or has a status row; closed over allocation links both ways; a row is read by the document it is against */
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
let seed = 20261122;
const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
const day = (n) => new Date(Date.UTC(2026, 0, 1) + n * 86400000).toISOString().slice(0, 10);
const ASOF = '2026-10-12';
function history(side) {
  const rows = []; let id = 0, pay = 0;
  const add = (party, ref, against, kind, amount, date, due, extra) => rows.push(Object.assign({ item_id: ++id, party_id: party, account_id: 'acc', side, ref, against_ref: against, ref_kind: kind, kind: 'sale', amount_minor: amount, pending_minor: 0, currency: 'INR', doc_date: date, due_date: due || null, created_at: date + 'T08:00:00Z' }, extra || {}));
  const bills = [];
  for (let n = 0; n < 400; n++) {
    const party = 'p' + (n % 12), date = day(n % 300), ref = side[0] + 'B' + n, amount = 10000 + rnd(300000);
    add(party, ref, ref, 'bill', amount, date, day(n % 300 + 15)); bills.push({ party, ref, amount, date });
  }
  bills.forEach((bill, n) => {
    const roll = rnd(100), p = side[0] + 'P' + ++pay;
    if (roll < 60) { add(bill.party, p, p, 'on_account', -bill.amount, bill.date); add(bill.party, p, bill.ref, 'allocation', -bill.amount, bill.date); add(bill.party, p, p, 'allocation', bill.amount, bill.date); }
    else if (roll < 72) { const part = Math.floor(bill.amount / 3); add(bill.party, p, p, 'on_account', -part, bill.date); add(bill.party, p, bill.ref, 'allocation', -part, bill.date); add(bill.party, p, p, 'allocation', part, bill.date); }
    else if (roll < 78 && n > 0 && bills[n - 1].party === bill.party) { const other = bills[n - 1]; add(bill.party, p, p, 'on_account', -(bill.amount + other.amount), bill.date); add(bill.party, p, bill.ref, 'allocation', -bill.amount, bill.date); add(bill.party, p, other.ref, 'allocation', -other.amount, bill.date); add(bill.party, p, p, 'allocation', bill.amount + other.amount, bill.date); }
    else if (roll < 82) add(bill.party, p, p, 'status', 0, bill.date, null, { pending_minor: -bill.amount, status: 'received' });
    else if (roll < 85) add(bill.party, bill.ref, bill.ref, 'status', 0, bill.date, null, { status: 'disputed' });
    else if (roll < 88) add(bill.party, p, p, 'on_account', -Math.floor(bill.amount / 2), bill.date);
  });
  /* a bill dated AFTER the as-at day, due after it: the cash view counts it on its due date, so the open read must not cut it by date */
  add('p1', side[0] + 'BF', side[0] + 'BF', 'bill', 77700, '2026-10-20', '2026-10-25');
  return rows;
}
const names = new Map(Array.from({ length: 12 }, (_, i) => ['p' + i, { name: 'Party ' + i, party_no: 'P-' + i }]));
const inputFor = (recv, pay) => ({ asOf: ASOF, days: 30, currency: 'INR', opening: [{ role: 'cash', code: '1400', name: 'Cash', balance_minor: 900000 }], receivable_items: recv.map(E.itemOf), payable_items: pay.map(E.itemOf), cheques: [], promises: [], gst: null, names, recurring: [] });

(async () => {
  console.log('LV-15 · the cash view on the open documents');
  if (!H.enginesSrc().dir) { console.log('   SKIP: ' + H.enginesSrc().why); process.exit(1); }
  const CF = require(path.join(H.API, 'lib', 'books-cashflow'));
  const recv = history('receivable'), pay = history('payable');
  const full = JSON.stringify(CF.project(inputFor(recv, pay)));
  const kept = JSON.stringify(CF.project(inputFor(openRows(recv), openRows(pay))));
  ok('the history means something (' + recv.length + ' rows; ' + openRows(recv).length + ' open)', recv.length > 1000 && openRows(recv).length < recv.length * 0.8);
  ok('project() on the open documents = project() on every row (the whole answer, byte for byte, 30 days)', kept === full, kept.slice(0, 80));
  ok('the bill dated after the as-at day is in the answer', kept.indexOf('77700') >= 0);
  const cut = (rows) => openRows(rows).filter((row) => !row.doc_date || row.doc_date <= ASOF);
  ok('MUTATION: bounding the open read by the as-at day DOES change the answer (the test can fail)', JSON.stringify(CF.project(inputFor(cut(recv), cut(pay)))) !== full);
  let split = null;
  try { split = JSON.stringify(CF.project(inputFor(openRows(recv, true), openRows(pay, true)))); } catch (refused) { split = 'refused'; }
  ok('MUTATION: leaving out the linked documents changes the answer or is refused', split !== full);
  const bounded = OPEN.rowsSql('$1::uuid', { account: '$2::uuid' });
  ok('openItems with no day: the statement has the account and no day bound', /x\.account_id = \$2::uuid/.test(bounded) && !/doc_date <=/.test(bounded));
  const cashSrc = fs.readFileSync(path.join(__dirname, '..', 'lib', 'books-cashflow.js'), 'utf8'), storeSrc = fs.readFileSync(path.join(__dirname, '..', 'lib', 'books-store.js'), 'utf8');
  ok('read() asks openItems for both control accounts, never items() for the whole account', /store\.openItems\(db, entity, debtors\.account_id, null\)/.test(cashSrc) && /store\.openItems\(db, entity, cred\.account_id, null\)/.test(cashSrc) && !/store\.items\(db, entity, null, (debtors|cred)\.account_id\)/.test(cashSrc));
  ok('openItems with a day keeps its old call (dues): three params', /asOf \? \[e, account_id, asOf\] : \[e, account_id\]/.test(storeSrc));
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((error) => { console.error(error); process.exit(1); });
