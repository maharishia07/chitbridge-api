/**
 * tests/rail-218-reject-paid.test.cjs — RAIL-218: a buyer cannot REJECT a bill it has already marked paid (the way out is a credit note).
 * The refusal lives in lib/rail-status statusGate (paidRefusal, the ONE status writer), reached by every door; the buyer's mark is read by
 * lib/chit-paid paidFactsOf(side received) on the caller's own handle: the stamp OR a payment in the buyer's books (the stamp alone was the critic's CHANGE: unmark then reject). Real statusGate + real rail + real folder-inventory docOf; only the db rows are a stand-in
 * (unknown queries answer EMPTY, never a chit row). Mutation: RAIL218_RAIL_STATUS=<a copy without the buyer branch> must turn this red.
 * Run: node tests/rail-218-reject-paid.test.cjs
 */
'use strict';
const path = require('path');
const API = path.join(__dirname, '..');
const railStatus = require(process.env.RAIL218_RAIL_STATUS || path.join(API, 'lib', 'rail-status'));
const chitPaid = require(path.join(API, 'lib', 'chit-paid'));
let pass = 0, fail = 0;
const t = (name, ok, extra) => { if (ok) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? '\n       ' + extra : '')); } };

const BUYER = 'b0000000-0000-4000-8000-000000000001', SELLER = 'a0000000-0000-4000-8000-000000000002', CHIT = 'c0000000-0000-4000-8000-000000000003';
const ME = { level: 'editor', holder: null };
const dbOf = (header, press) => ({ query: async (text) => {
  if (press && /FROM books_payment p WHERE/.test(text)) return { rows: [{}], rowCount: 1 };
  if (header && /SELECT purpose, sender_entity_id, business_json FROM chit_header/.test(text)) return { rows: [header], rowCount: 1 };
  if (header && /SELECT business_json->'payment' AS payment FROM chit_header/.test(text)) return { rows: [{ payment: header.business_json.payment }], rowCount: 1 };
  return { rows: [], rowCount: 0 };
} });
const mark = { method: 'cash', amount: 100, at: '2026-11-15T00:00:00Z' };
const gate = async (db, to, entity, from) => railStatus.statusGate(db, entity || BUYER, CHIT, to, ME, { copy: 'received', from: from || 'pending' });

(async () => {
  console.log('\n== RAIL-218: reject after paying ==');
  const paidBill = dbOf({ purpose: 'invoice', sender_entity_id: SELLER, business_json: { payment: mark } });
  const g = await gate(paidBill, 'rejected');
  t('a received invoice marked paid: reject refused, why "paid"', g.ok === false && g.why === 'paid', JSON.stringify({ ok: g.ok, why: g.why }));
  let wrote = false; try { await g.write(); wrote = true; } catch (e) { /* the refusal's write throws: nothing can save past it */ }
  t('the refused verdict writes nothing', wrote === false);
  t('same from accepted', (await gate(paidBill, 'rejected', BUYER, 'accepted')).why === 'paid');
  t('the words carry the credit note and why "paid"', /credit note/.test(chitPaid.PAID_SAID.message) && chitPaid.PAID_SAID.why === 'paid');

  console.log('\n== what stays allowed ==');
  const unpaid = await gate(dbOf({ purpose: 'invoice', sender_entity_id: SELLER, business_json: {} }), 'rejected');
  t('unpaid received invoice: reject goes through', unpaid.ok === true && unpaid.why !== 'paid', JSON.stringify({ ok: unpaid.ok, why: unpaid.why }));
  const acc = await gate(paidBill, 'accepted');
  t('a paid bill moving to accepted is not asked', acc.why !== 'paid');
  const tender = await gate(dbOf({ purpose: 'invoice', sender_entity_id: SELLER, business_json: { payment: { parts: [{ mode: 'credit', amount: 100 }] } } }), 'rejected');
  t('a credit-only tender is a promise, not money: not refused as paid', tender.why !== 'paid');
  const mine = await gate(dbOf({ purpose: 'invoice', sender_entity_id: BUYER, business_json: { payment: mark } }), 'rejected', BUYER);
  t('an invoice I sent is the seller side (paidFactsOf), not asked here', (await chitPaid.paidFactsOf(dbOf({ purpose: 'invoice', sender_entity_id: BUYER, business_json: { payment: mark } }), BUYER, CHIT, 'received')) === false);
  console.log('\n== RAIL-218b: unmarked, books-only ==');
  const store = require(path.join(API, 'lib', 'books-store')), engines = require(path.join(API, 'lib', 'books-engines'));
  let allocs = [];
  store.billParties = async () => ['p1']; store.items = async () => []; engines.itemOf = (x) => x; engines.receivables = () => ({ fromItems: () => ({ allocations: allocs }) });
  const unmarked = dbOf({ purpose: 'invoice', sender_entity_id: SELLER, business_json: {} }); /* Mark-paid then DELETE /payment: the stamp is gone */
  const pressed = dbOf({ purpose: 'invoice', sender_entity_id: SELLER, business_json: {} }, true); /* the books recorded the Mark-paid press (books_payment chitpay:<chit>), the stamp is cleared */
  t('unmark then reject: the press the books recorded (no allocation row, as on the live stack) refuses', (await gate(pressed, 'rejected')).why === 'paid');
  allocs = [{ debit: 'bill', credit: CHIT, amount: 100 }];
  t('unmark then reject: my books still hold the payment against the bill: refused', (await gate(unmarked, 'rejected')).why === 'paid');
  allocs = [{ debit: CHIT, credit: 'pay', amount: 100 }];
  t('the bill as the debit side is read too', (await gate(unmarked, 'rejected')).why === 'paid');
  allocs = [];
  t('no stamp and no payment in the books: reject goes through', (await gate(unmarked, 'rejected')).ok === true);
  const dead = { query: async () => { throw new Error('database down'); } };
  let closed = false; try { await gate(dead, 'rejected'); } catch (e) { closed = /database down/.test(e.message); }
  t('fail-closed: a failed read throws, never reads "unpaid"', closed);

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log(pass + ' checks');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
