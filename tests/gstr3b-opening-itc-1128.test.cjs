/**
 * tests/gstr3b-opening-itc-1128.test.cjs — F2 (VERIFY-EL-TAX, batch 1128): THE SERVED GSTR-3B 6.1 CARRIES THE CREDIT THE BOOKS BRING IN (opening_itc).
 * CGST Act s.49 (the electronic credit ledger carries unused credit; cash only for the rest), Rule 88A set-off order (posting.gstSetOff).
 * Hand figures, rupees, a Karnataka (29) shop selling inter-state to Tamil Nadu (33), so the output tax is IGST:
 *   September carried IGST 5,000.00 into October (the books' input balance, read by books-period.itcCarriedInto).
 *   A · October: sale 30,000.00 at 3%: sale 1,00,000.00 at 3% = IGST 3,000.00, no purchases.
 *       with the carry:    ITC used 3,000.00 (IGST), cash 0, carried 2,000.00
 *       without (before):  cash 3,000.00, the 5,000.00 credit ignored
 *   B · October: no sale, a return of goods bought for IGST 8,000.00 (the supplier's credit note) with the carry 5,000.00:
 *       4(B)(2) 8,000.00, the credit that can be given back is 5,000.00; the 3,000.00 shortfall is NAMED in warnings (never silent), carried 0.
 * Run: node tests/gstr3b-opening-itc-1128.test.cjs
 */
'use strict';
const assert = require('node:assert/strict');
const TL = require('../lib/tax-lines');

let pass = 0, fail = 0;
const test = (name, fn) => { try { fn(); pass++; console.log('   ok   ' + name); } catch (e) { fail++; console.log('   FAIL ' + name + '\n          ' + String(e.message).split('\n').slice(0, 6).join('\n          ')); } };

const ME = { Gstin: '29AAAAA0000A1Z5', LglNm: 'Bengaluru Traders', State: '29', Pos: '29', Country: 'IN', RegType: 'regular' };
const BUYER = { Gstin: '33BBBBB1111B1Z2', LglNm: 'Chennai Tea Traders', State: '33', Country: 'IN', RegType: 'regular' };
const SELLER = { Gstin: '33CCCCC2222C1Z1', LglNm: 'Salem Mills', State: '33', Country: 'IN', RegType: 'regular' };
const sale = () => {
  const made = TL.invoiceFor({ lines: [{ particulars: 'Tea', quantity: 1, price: 100000, hsn: '0902', gst_rate: 3 }], seller: ME, buyer: BUYER, currency: 'INR', chit_id: 's1', at: '2026-10-10' });
  return { chit_id: 's1', direction: 'issued', sells: true, purpose: 'invoice', invoice: made.invoice, provisional: false, seller: Object.assign({ entity_id: 'me' }, ME), buyer: Object.assign({ entity_id: 'b' }, BUYER), at: '2026-10-10T05:00:00Z', day: '2026-10-10' };
};
const supplierReturn = () => {
  const made = TL.invoiceFor({ lines: [{ particulars: 'Tea chests', quantity: 1, price: 100000, hsn: '0902', gst_rate: 8 }], seller: SELLER, buyer: ME, currency: 'INR', chit_id: 'r1', at: '2026-10-12' });
  return { chit_id: 'r1', direction: 'received', sells: false, purpose: 'credit_note', invoice: made.invoice, provisional: false, seller: Object.assign({ entity_id: 'sup' }, SELLER), buyer: Object.assign({ entity_id: 'me' }, ME), at: '2026-10-12T05:00:00Z', day: '2026-10-12' };
};
const file = (entries, opening) => { const l = TL.ledger(entries, ME); if (opening) l.opening_itc = opening; return TL.gstr3b(l, ME, '102026'); };
const CARRY = { igst: 5000, cgst: 0, sgst: 0, cess: 0 };

test('hand: the sale carries IGST 3,000.00 (inter-state 3%)', () => assert.equal(TL.heads(sale().invoice).igst, 3000));

test('A · with the carry: 6.1 uses 3,000.00 of the 5,000.00, cash 0, carried 2,000.00', () => {
  const pay = file([sale()], CARRY)._cb.payment;
  assert.equal(pay.itc_used_by_head.igst, 3000);
  assert.equal(pay.cash.igst, 0);
  assert.equal(pay.itc_carried.igst, 2000);
});

test('A · without the carry (the old behaviour): cash 3,000.00 — the credit was ignored', () => {
  assert.equal(file([sale()])._cb.payment.cash.igst, 3000);
});

test('two carried totals agree: opening 5,000 = used 3,000 + carried 2,000 (6.1 own columns)', () => {
  const pay = file([sale()], CARRY)._cb.payment;
  assert.equal(pay.itc_opening.igst, pay.itc_used_by_head.igst + pay.itc_carried.igst);
});

test('B · a return of 8,000.00 against a carry of 5,000.00: the 3,000.00 shortfall is named, never silent; nothing carried', () => {
  const out = file([supplierReturn()], CARRY);
  assert.equal(TL.heads(supplierReturn().invoice).igst, 8000);
  assert.equal(out._cb.payment.itc_carried.igst, 0);
  assert.ok(out._cb.warnings.some((word) => /reversals exceed/i.test(word) && /3000/.test(word)), JSON.stringify(out._cb.warnings));
});

console.log('\n' + (fail ? '  ✗ ' + fail + ' failed' : '  ✓ ' + pass + ' passed') + ' · ' + (pass + fail) + ' checks\n');
process.exit(fail ? 1 : 0);
