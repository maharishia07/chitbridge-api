/**
 * tests/rail-218-reject-paid.test.cjs — RAIL-218: a buyer cannot REJECT a bill it has already marked paid (the way out is a credit note).
 * The refusal lives in lib/rail-status statusGate (paidRefusal, the ONE status writer), reached by every door; the buyer's mark is read by
 * lib/chit-paid paidOnBillIReceived on the caller's own handle. Real statusGate + real rail + real folder-inventory docOf; only the db rows are a stand-in
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
const dbOf = (header) => ({ query: async (text) => {
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
  t('an invoice I sent is the seller side (paidFactsOf), not asked here', (await chitPaid.paidOnBillIReceived(dbOf({ purpose: 'invoice', sender_entity_id: BUYER, business_json: { payment: mark } }), BUYER, CHIT)) === false);
  const dead = { query: async () => { throw new Error('database down'); } };
  let closed = false; try { await gate(dead, 'rejected'); } catch (e) { closed = /database down/.test(e.message); }
  t('fail-closed: a failed read throws, never reads "unpaid"', closed);

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log(pass + ' checks');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
