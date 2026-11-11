'use strict';
/**
 * tests/ctry-139-band-asof.test.cjs — CTRY-139 (engines v1.86.0): the law-set price band is read as of the SHOP'S DAY of the document.
 * billDayOf: a bill's own billed_at in the shop's zone (00:10 IST on 22 Sep is the 22nd, a UTC slice says the 21st); a credit or debit note is never banded (null: its lines keep the rate they carry; a delta line would re-band the
 * original supply). invoiceFor: bill_day reaches the engine as asOf. Hand figures (rupees, 33 -> 33): apparel 2,500.01 on or after
 * 22 Sep 2025 is 18% (225.00 + 225.00); 2,000.00 is 5% (100.00) from 22 Sep and 12% (240.00) before; no day = the line keeps its stated rate.
 */
const assert = require('assert');
const T = require('../lib/tax-lines');
let pass = 0;
const it = (what, fn) => { try { fn(); pass++; console.log('  ok  ' + what); } catch (e) { console.log('  FAIL ' + what + '\n      ' + e.message); process.exitCode = 1; } };
const seller = { Gstin: '33AABCK1234F1Z6', State: '33', Country: 'IN', RegType: 'regular' };
const buyer = { State: '33', Pos: '33', Country: 'IN' };
const figures = (price, rate, day, hsn) => {
  const det = T.invoiceFor({ lines: [{ line_id: 'a', quantity: 1, price, gst_rate: rate, hsn: hsn || '6109' }], seller, buyer, currency: 'INR', bill_day: day }).invoice;
  return [det.ItemList[0].GstRt, det.ItemList[0].CgstAmt, det.ItemList[0].SgstAmt, det.ValDtls.TotInvVal, det._cb.bands ? det._cb.bands.length : 0];
};
it('billDayOf: 00:10 IST on 22 Sep 2025 (18:40Z on the 21st) is the 22nd in the shop, never the UTC date', () => {
  assert.strictEqual(T.billDayOf({ billed_at: '2025-09-21T18:40:00Z' }, 'invoice', null, { Country: 'IN' }), '2025-09-22');
  assert.strictEqual(T.billDayOf({ billed_at: '2025-09-21T18:29:00Z' }, 'invoice', null, { Country: 'IN' }), '2025-09-21');
  assert.strictEqual(T.billDayOf({}, 'invoice', '2025-09-22T05:00:00Z', { Country: 'IN' }), '2025-09-22', 'no billed_at: the moment the caller holds');
  assert.strictEqual(T.billDayOf({}, 'invoice', null, { Country: 'IN' }), null);
});
it('billDayOf: a credit or debit NOTE is never banded (null), whatever it is against: its lines keep the rate they carry; a 500 price-difference note on a 3,000 garment at 18% stays 90.00 tax', () => {
  const against = { against: { invoice_date: '2025-09-21T10:00:00Z', billed_at: '2025-09-21T10:00:00Z' }, billed_at: '2026-01-05T10:00:00Z' };
  ['credit_note', 'debit_note'].forEach((purpose) => assert.strictEqual(T.billDayOf(against, purpose, '2026-01-05T10:00:00Z', { Country: 'IN' }), null, purpose));
  const delta = T.invoiceFor({ lines: [{ line_id: 'a', quantity: 1, price: 500, gst_rate: 18, hsn: '6109' }], seller, buyer, currency: 'INR', bill_day: T.billDayOf(against, 'credit_note', null, { Country: 'IN' }) }).invoice;
  assert.deepStrictEqual([delta.ItemList[0].GstRt, delta.ValDtls.CgstVal + delta.ValDtls.SgstVal], [18, 90]);
});
it('invoiceFor hands bill_day to the engine: 2,500.01 stated 5% is 18% on 2025-09-22 (225.00 + 225.00, 2,950.01); 2,000.00 is 5% (100.00) from the 22nd and 12% (240.00) on the 21st', () => {
  assert.deepStrictEqual(figures(2500.01, 5, '2025-09-22'), [18, 225, 225, 2950.01, 1]);
  assert.deepStrictEqual(figures(2000, 18, '2025-09-22').slice(0, 4), [5, 50, 50, 2100]);
  assert.deepStrictEqual(figures(2000, 18, '2025-09-21').slice(0, 4), [12, 120, 120, 2240]);
});
it('no day, or a day that is not YYYY-MM-DD, is no band: the line keeps its stated rate', () => {
  assert.deepStrictEqual(figures(2500.01, 5, undefined), [5, 62.5, 62.5, 2625.01, 0]);
  assert.strictEqual(figures(2500.01, 5, undefined)[0], 5);
  assert.strictEqual(figures(2500.01, 5, '2025-09-22T10:00:00Z')[0], 5);
});
it('footwear and a non-band code: 6403 at 2,500.01 is 18% on a day; 9983 keeps its rate', () => {
  assert.strictEqual(figures(2500.01, 5, '2026-01-05', '6403')[0], 18);
  assert.strictEqual(figures(2500.01, 12, '2026-01-05', '9983')[0], 12);
});
it('no bill day is SAID on the line (engine 1.86.0 re-review): _band "not checked: no bill date", the stated rate kept', () => {
  const det = T.invoiceFor({ lines: [{ line_id: 'a', quantity: 1, price: 5000, gst_rate: 5, hsn: '6109' }], seller, buyer, currency: 'INR' }).invoice;
  assert.deepStrictEqual([det.ItemList[0].GstRt, det.ItemList[0]._band], [5, 'not checked: no bill date']);
});
it('a tax-inclusive price is tested on its TAXABLE value (CBIC FAQ 33): 2,625.00 inclusive is 5% (tax 125.00), 2,625.01 is 18%', () => {
  const at = (price) => T.invoiceFor({ lines: [{ line_id: 'a', quantity: 1, price, gst_rate: 18, hsn: '6109' }], seller, buyer, currency: 'INR', priceIncludesTax: true, bill_day: '2026-01-05' }).invoice;
  assert.deepStrictEqual([at(2625).ItemList[0].GstRt, at(2625).ValDtls.CgstVal + at(2625).ValDtls.SgstVal, at(2625.01).ItemList[0].GstRt], [5, 125, 18]);
});
console.log(pass + ' checks');
