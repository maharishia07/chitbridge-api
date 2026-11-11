'use strict';
/**
 * tests/ctry-139-band-asof.test.cjs — CTRY-139 (engines v1.86.0): the law-set price band is read as of the SHOP'S DAY of the document.
 * billDayOf: a bill's own billed_at in the shop's zone (00:10 IST on 22 Sep is the 22nd, a UTC slice says the 21st); a credit or debit note reads the invoice it is
 * against, and a note with no such date answers null (NO band). invoiceFor: bill_day reaches the engine as asOf. Hand figures (rupees, 33 -> 33): apparel 2,500.01 on or after
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
it('billDayOf: a credit or debit note reads the invoice it is against; without that date it answers null (no band)', () => {
  const against = { against: { invoice_date: '2025-09-21T10:00:00Z' }, billed_at: '2026-01-05T10:00:00Z' };
  assert.strictEqual(T.billDayOf(against, 'credit_note', null, { Country: 'IN' }), '2025-09-21');
  assert.strictEqual(T.billDayOf(against, 'debit_note', null, { Country: 'IN' }), '2025-09-21');
  assert.strictEqual(T.billDayOf({ against: 'C2/26-27/0010', billed_at: '2026-01-05T10:00:00Z' }, 'credit_note', null, { Country: 'IN' }), null);
  assert.strictEqual(T.billDayOf({ billed_at: '2026-01-05T10:00:00Z' }, 'credit_note', null, { Country: 'IN' }), null);
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
console.log(pass + ' checks');
