/**
 * tests/gstr3b-rcm-1128.test.cjs — F1 (VERIFY-GF-TAX, batch 1128): THE SERVED GSTR-3B CARRIES REVERSE-CHARGE TAX — 3.1(d) AND 4(A)(3) — FROM THE ONE BUILDER (the adopted engine gst-returns.gstr3b).
 * CBIC GSTR-3B Table 3.1(d) (inward supplies liable to reverse charge) and 4(A)(3) (ITC on inward supplies liable to reverse charge); CGST Act s.9(3) (GTA is notified for RCM).
 * Hand figures, rupees (an inter-state buyer in 29, an unregistered transporter in 33, so the tax is IGST):
 *   A · GTA freight 1,00,000.00 at 5%, no credit under the notification   → RCM IGST 5,000.00:   3.1(d) txval 100000 / iamt 5000, 4(A)(3) nothing
 *   B · GTA freight 1,00,000.00 at 18%, credit allowed                      → RCM IGST 18,000.00:  3.1(d) txval 100000 / iamt 18000, 4(A)(3) iamt 18000
 *   both in the month: 3.1(d) txval 200000 / iamt 23000; 4(A)(3) iamt 18000; the net ITC 18000 (the 5% freight gives none)
 *   a forward-charge purchase of 1,000.00 at 5% from a registered seller beside them stays 4(A)(5): iamt 50, never 3.1(d)
 * Compared as carried totals: the sum of the invoices' own RcmIgstVal (23000) = the file's 3.1(d) iamt; the books' RCM liability is the same number (tests/rcm-post.test.cjs).
 * A shop that is not a regular taxpayer files no 3.1(d) here (composition: CMP-08), a shop in AU is refused as before (acc-278).
 * Run: node tests/gstr3b-rcm-1128.test.cjs
 */
'use strict';
const assert = require('node:assert/strict');
const TL = require('../lib/tax-lines');

let pass = 0, fail = 0;
const test = (name, fn) => { try { fn(); pass++; console.log('   ok   ' + name); } catch (e) { fail++; console.log('   FAIL ' + name + '\n          ' + String(e.message).split('\n').slice(0, 6).join('\n          ')); } };

const BUYER = { Gstin: '29AAAAA0000A1Z5', LglNm: 'Bengaluru Traders', State: '29', Pos: '29', Country: 'IN', RegType: 'regular' };
const GTA = { LglNm: 'Sri Ram Transport', State: '33', Country: 'IN', RegType: 'unregistered' };
const REG = { Gstin: '33BBBBB1111B1Z2', LglNm: 'Chennai Tea Traders', State: '33', Country: 'IN', RegType: 'regular' };
const bill = (id, seller, line) => {
  const made = TL.invoiceFor({ lines: [line], seller, buyer: BUYER, currency: 'INR', chit_id: id, at: '2026-09-10' });
  return { chit_id: id, direction: 'received', sells: false, purpose: 'invoice', invoice: made.invoice, provisional: false, seller: Object.assign({ entity_id: 'sup-' + id }, seller), buyer: Object.assign({ entity_id: 'me' }, BUYER), at: '2026-09-10T05:00:00Z' };
};
const freight5 = bill('a', GTA, { particulars: 'Freight Salem to Bengaluru', quantity: 1, price: 100000, hsn: '996511', gst_rate: 5, rcm_category: 'gta' });
const freight18 = bill('b', GTA, { particulars: 'Freight Salem to Bengaluru', quantity: 1, price: 100000, hsn: '996511', gst_rate: 18, rcm_category: 'gta' });
const tea = bill('c', REG, { particulars: 'Tea', quantity: 1, price: 1000, hsn: '0902', gst_rate: 5 });
const ME = { Gstin: BUYER.Gstin, RegType: 'regular', Country: 'IN' };
const file = (entries, me) => TL.gstr3b(TL.ledger(entries, me || ME), me || ME, '092026');
const zeroItc = { iamt: 0, camt: 0, samt: 0, csamt: 0 };

test('the invoices carry the RCM heads the books post (hand: 5,000 and 18,000 IGST, none charged by the supplier)', () => {
  assert.deepEqual([freight5.invoice.ValDtls.RcmIgstVal, freight18.invoice.ValDtls.RcmIgstVal], [5000, 18000]);
  assert.deepEqual([TL.heads(freight5.invoice).tax, TL.heads(freight18.invoice).tax], [0, 0]);
});

test('A · GTA freight at 5%: 3.1(d) shows 100000 / 5000 IGST, and no 4(A)(3) credit (the notification gives none at 5%)', () => {
  const out = file([freight5]);
  assert.deepEqual(out.sup_details.isup_rev, { txval: 100000, iamt: 5000, camt: 0, samt: 0, csamt: 0 });
  assert.deepEqual(out.itc_elg.itc_avl, [Object.assign({ ty: 'OTH' }, zeroItc)], 'no ISRC row, no credit');
  assert.deepEqual(out.itc_elg.itc_net, zeroItc);
});

test('B · GTA freight at 18%: 3.1(d) 100000 / 18000 and 4(A)(3) (ISRC) 18000 — the credit is available the same month', () => {
  const out = file([freight18]);
  assert.deepEqual(out.sup_details.isup_rev, { txval: 100000, iamt: 18000, camt: 0, samt: 0, csamt: 0 });
  assert.deepEqual(out.itc_elg.itc_avl.find((row) => row.ty === 'ISRC'), { ty: 'ISRC', iamt: 18000, camt: 0, samt: 0, csamt: 0 });
  assert.deepEqual(out.itc_elg.itc_net, { iamt: 18000, camt: 0, samt: 0, csamt: 0 });
});

test('both freights and a forward-charge purchase: 3.1(d) 200000 / 23000, 4(A)(3) 18000, 4(A)(5) 50 (the tea), net ITC 18050', () => {
  const out = file([freight5, freight18, tea]);
  assert.deepEqual(out.sup_details.isup_rev, { txval: 200000, iamt: 23000, camt: 0, samt: 0, csamt: 0 });
  assert.deepEqual(out.itc_elg.itc_avl.map((row) => [row.ty, row.iamt]), [['OTH', 50], ['ISRC', 18000]]);
  assert.deepEqual(out.itc_elg.itc_net, { iamt: 18050, camt: 0, samt: 0, csamt: 0 });
});

test('two carried totals agree: the invoices\' own RcmIgstVal (23000) = the file\'s 3.1(d) IGST', () => {
  const carried = [freight5, freight18].reduce((sum, row) => sum + row.invoice.ValDtls.RcmIgstVal, 0);
  assert.equal(file([freight5, freight18]).sup_details.isup_rev.iamt, carried);
});

test('a shop that is not a regular taxpayer files no 3.1(d) and takes no credit from this builder', () => {
  const composition = { Gstin: BUYER.Gstin, RegType: 'composition', Country: 'IN' };
  const out = file([freight18], composition);
  assert.deepEqual(out.sup_details.isup_rev, { txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0 });
  assert.deepEqual(out.itc_elg.itc_net, zeroItc);
});

test('a month with no reverse charge answers 3.1(d) zero and the old keys are all still there', () => {
  const out = file([tea]);
  assert.deepEqual(out.sup_details.isup_rev, { txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0 });
  assert.deepEqual([out.gstin, out.ret_period, out.itc_elg.itc_avl[0].iamt, out.itc_elg.itc_net.iamt, out._cb.net.total], [BUYER.Gstin, '092026', 50, 50, -50]);
});

test('one builder: tax-lines no longer holds a second GSTR-3B sum (its sup_details come from gst-returns.gstr3b)', () => {
  const text = require('fs').readFileSync(require('path').join(__dirname, '..', 'lib', 'tax-lines.js'), 'utf8');
  assert.ok(/gstReturns\.gstr3b\(/.test(text) && !/outwardBoxes/.test(text));
});

/* WALK J J-F-01 (21 Nov, the rail's received bills): GTA 10,000 at 5% and legal services 20,000 at 18%, both from unregistered suppliers, rcm_category on the line.
   Hand, Nov (inter-state): 3.1(d) txval 30000, IGST 500 + 3,600 = 4,100; 4(A)(3) IGST 3,600 (the 5% freight gives no credit). Oct (intra-state GTA 10,000 at 5%): CGST 250, SGST 250. */
const gtaIn = { LglNm: 'Local Transport', State: '29', Country: 'IN', RegType: 'unregistered' };
const jBill = (id, seller, line, at) => {
  const made = TL.invoiceFor({ lines: [line], seller, buyer: BUYER, currency: 'INR', chit_id: id, at });
  return { chit_id: id, direction: 'received', sells: false, purpose: 'invoice', invoice: made.invoice, provisional: false, seller: Object.assign({ entity_id: 'sup-' + id }, seller), buyer: Object.assign({ entity_id: 'me' }, BUYER), at: at + 'T05:00:00Z' };
};
test('J-F-01 Nov: GTA 10,000 @5% + legal 20,000 @18% from another state: 3.1(d) 30000 / IGST 4100, 4(A)(3) IGST 3600', () => {
  const rows = [jBill('j1', GTA, { particulars: 'Freight', quantity: 1, price: 10000, hsn: '996511', gst_rate: 5, rcm_category: 'gta' }, '2026-11-05'), jBill('j2', GTA, { particulars: 'Legal fees', quantity: 1, price: 20000, hsn: '998212', gst_rate: 18, rcm_category: 'legal' }, '2026-11-06')];
  const out = TL.gstr3b(TL.ledger(rows, ME), ME, '112026');
  assert.deepEqual(out.sup_details.isup_rev, { txval: 30000, iamt: 4100, camt: 0, samt: 0, csamt: 0 });
  assert.equal(out.itc_elg.itc_avl.find((row) => row.ty === 'ISRC').iamt, 3600);
});
test('J-F-01 Oct: GTA 10,000 @5% within the state: 3.1(d) CGST 250 / SGST 250', () => {
  const out = TL.gstr3b(TL.ledger([jBill('j3', gtaIn, { particulars: 'Freight', quantity: 1, price: 10000, hsn: '996511', gst_rate: 5, rcm_category: 'gta' }, '2026-10-05')], ME), ME, '102026');
  assert.deepEqual(out.sup_details.isup_rev, { txval: 10000, iamt: 0, camt: 250, samt: 250, csamt: 0 });
});

console.log('\n' + (fail ? '  ✗ ' + fail + ' failed' : '  ✓ ' + pass + ' passed') + ' · ' + (pass + fail) + ' checks\n');
process.exit(fail ? 1 : 0);
