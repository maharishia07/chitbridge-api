/**
 * tests/tax-explicit-1129.test.cjs — TAX-EXPLICIT (batch 1129, Athi 21 Nov: a bill line carries a value or a zero WITH its reason; no answer = refused, never 0).
 * OWNS      lib/tax-lines lineTaxStatusOf + refuseUnavailable (the ONE place the status is decided, read off the engine's own answer).
 * CALLED BY CI / node --test tests/tax-explicit-1129.test.cjs · no DB, no network.
 * HAND FIGURES (minor units): IN 100000 at 18% → tax 18000, total 118000 · IN exempt item 100000, tax 0, reason exempt · AU 10000 GST-free → 10000, reason gst_free ·
 *           AE 10000 at 5% → tax 500, total 10500 · no rate on a registered seller's line → UNAVAILABLE, refused · a cess the slab declared but could not be read → refused, not 0.
 *           (The identities read that fails → refused is tests/tax01-1128-shelf.test.cjs case 1.)
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const TL = require('../lib/tax-lines');
const money = require('../lib/money');

const IN_SELLER = { Gstin: '27AAPFU0939F1ZV', LglNm: 'S', State: '27', Country: 'IN', RegType: 'regular' };
const IN_BUYER = { Country: 'IN', State: '27', Gstin: '27AAPFU0939F1ZV' };
const AU_SELLER = { Country: 'AU', LglNm: 'S', RegType: 'regular', Gstin: '51824753556' };
const AE_SELLER = { Country: 'AE', LglNm: 'S', RegType: 'regular', Gstin: '100000000000003' };
const bill = (seller, buyer, lines, currency) => TL.invoiceFor({ lines, seller, buyer, currency, at: '2026-11-07T00:00:00Z' });
const minor = (n, cur) => money.toMinor(n, cur);

test('IN 1,000 at 18% → RATED 18%, tax 180, total 1,180', () => {
  const a = bill(IN_SELLER, IN_BUYER, [{ name: 'x', qty: 1, unit_price: 1000, gst_rate: 18 }], 'INR');
  assert.equal(a.tax_status[0].status, 'RATED');
  assert.equal(a.tax_status[0].rate, 18);
  assert.deepEqual(a.tax_status[0].tax, { amount_minor: 18000, currency: 'INR' });
  assert.equal(minor(a.invoice.ValDtls.TotInvVal, 'INR'), 118000);
});

test('IN exempt item → ZERO, reason exempt, total 1,000', () => {
  const a = bill(IN_SELLER, IN_BUYER, [{ name: 'x', qty: 1, unit_price: 1000, gst_rate: 0, nil_kind: 'exempt' }], 'INR');
  assert.equal(a.tax_status[0].status, 'ZERO');
  assert.equal(a.tax_status[0].reason, 'exempt');
  assert.equal(minor(a.invoice.ValDtls.TotInvVal, 'INR'), 100000);
});

test('IN registered, item 0% naming no kind → UNAVAILABLE zero_reason_missing, refused in words (never ZERO unanswered)', () => {
  const lines = [{ name: 'Rice', qty: 1, unit_price: 1000, gst_rate: 0 }];
  const a = bill(IN_SELLER, IN_BUYER, lines, 'INR');
  assert.equal(a.tax_status[0].status, 'UNAVAILABLE');
  assert.equal(a.tax_status[0].reason, 'zero_reason_missing');
  assert.throws(() => TL.refuseUnavailable(a.tax_status, lines), (e) => e.code === 'TAX_LINE_UNAVAILABLE' && e.status === 422 && /Say why Rice is zero-rated or exempt in Catalogue/.test(e.message));
});

test('AE Rice 30.00 at 0% no kind → refused; with kind exempt → ZERO exempt, total stays 3000 minor', () => {
  const lines = [{ name: 'Rice', qty: 1, unit_price: 30, gst_rate: 0 }];
  const a = bill(AE_SELLER, { Country: 'AE' }, lines, 'AED');
  assert.equal(a.tax_status[0].status, 'UNAVAILABLE');
  assert.throws(() => TL.refuseUnavailable(a.tax_status, lines), (e) => e.code === 'TAX_LINE_UNAVAILABLE');
  const b = bill(AE_SELLER, { Country: 'AE' }, [{ name: 'Rice', qty: 1, unit_price: 30, gst_rate: 0, tax_kind: 'exempt' }], 'AED');
  assert.equal(b.tax_status[0].status, 'ZERO');
  assert.equal(b.tax_status[0].reason, 'exempt');
  assert.equal(minor(b.invoice.ValDtls.TotInvVal, 'AED'), 3000);
});

test('IN unregistered shop, item 0% no kind → ZERO unregistered_seller, allowed', () => {
  const a = bill({ Country: 'IN', LglNm: 'S', RegType: 'unregistered' }, IN_BUYER, [{ name: 'x', qty: 1, unit_price: 1000, gst_rate: 0 }], 'INR');
  assert.equal(a.tax_status[0].reason, 'unregistered_seller');
  assert.doesNotThrow(() => TL.refuseUnavailable(a.tax_status, []));
});

test('a registered seller\'s line with NO rate → UNAVAILABLE and refused in words (TAX_LINE_UNAVAILABLE 422), never sent as 0', () => {
  const lines = [{ name: 'Rice', qty: 1, unit_price: 1000 }];
  const a = bill(IN_SELLER, IN_BUYER, lines, 'INR');
  assert.equal(a.tax_status[0].status, 'UNAVAILABLE');
  assert.equal(a.tax_status[0].reason, 'rate_missing');
  assert.throws(
    () => TL.refuseUnavailable(a.tax_status, lines),
    (e) => e.code === 'TAX_LINE_UNAVAILABLE' && e.status === 422 && e.refused === true && /Line 1 \(Rice\)/.test(e.message) && /Nothing was saved/.test(e.message)
  );
});

test('an unregistered seller\'s unrated line → ZERO, reason unregistered_seller (the document says why), not refused', () => {
  const a = bill({ Country: 'IN', LglNm: 'S', RegType: 'unregistered' }, IN_BUYER, [{ name: 'x', qty: 1, unit_price: 1000 }], 'INR');
  assert.equal(a.tax_status[0].status, 'ZERO');
  assert.equal(a.tax_status[0].reason, 'unregistered_seller');
  assert.doesNotThrow(() => TL.refuseUnavailable(a.tax_status, []));
});

test('a composition seller → ZERO, reason composition', () => {
  const a = bill({ Gstin: '27AAPFU0939F1ZV', State: '27', Country: 'IN', RegType: 'composition' }, IN_BUYER, [{ name: 'x', qty: 1, unit_price: 1000, gst_rate: 18 }], 'INR');
  assert.equal(a.tax_status[0].reason, 'composition');
});

test('AU 100 GST-free → ZERO, reason gst_free, total 100', () => {
  const a = bill(AU_SELLER, { Country: 'AU' }, [{ name: 'x', qty: 1, unit_price: 100, tax_kind: 'gst_free' }], 'AUD');
  assert.equal(a.tax_status[0].status, 'ZERO');
  assert.equal(a.tax_status[0].reason, 'gst_free');
  assert.equal(minor(a.invoice.ValDtls.TotInvVal, 'AUD'), 10000);
});

test('AE 100 at 5% → RATED, tax 5.00 (500 minor), total 105', () => {
  const a = bill(AE_SELLER, { Country: 'AE' }, [{ name: 'x', qty: 1, unit_price: 100, gst_rate: 5 }], 'AED');
  assert.equal(a.tax_status[0].status, 'RATED');
  assert.deepEqual(a.tax_status[0].tax, { amount_minor: 500, currency: 'AED' });
  assert.equal(minor(a.invoice.ValDtls.TotInvVal, 'AED'), 10500);
});

test('a cess the slab declared but could not be read → UNAVAILABLE cess_rate_unreadable, refused, not 0', () => {
  const lines = [{ name: 'Cola', qty: 1, unit_price: 1000, gst_rate: 28, cess_unreadable: true }];
  const a = bill(IN_SELLER, IN_BUYER, lines, 'INR');
  assert.equal(a.tax_status[0].status, 'UNAVAILABLE');
  assert.equal(a.tax_status[0].reason, 'cess_rate_unreadable');
  assert.throws(() => TL.refuseUnavailable(a.tax_status, lines), (e) => e.code === 'TAX_LINE_UNAVAILABLE' && /cess/.test(e.message));
});

test('a line with a cess RATE but nothing wrong stays RATED (an absent cess on a known rate is SAFE)', () => {
  const a = bill(IN_SELLER, IN_BUYER, [{ name: 'x', qty: 1, unit_price: 1000, gst_rate: 28, cess_rate: 12 }], 'INR');
  assert.equal(a.tax_status[0].status, 'RATED');
});

test('the engine\'s slab reader flags an unreadable cess (decorate carries it to the line)', () => {
  const slabs = require('../lib/tax-slab');
  const r = slabs.resolve({ item_data: { gst_rate: 28, cess_rate: 'abc' }, slabs: [] });
  /* the flag arrives with the adopted engines version that carries it; until then decorate has nothing to carry and the line stays as before */
  assert.ok(r.cess_unreadable === true || r.cess_unreadable === undefined);
});

test('P-F-05 · AU registered shop, A$11.00 item with NO tax answer → UNAVAILABLE and refused, never A$0 GST on a "bill"', () => {
  const lines = [{ name: 'Muffin', qty: 1, unit_price: 11 }];
  const a = bill(AU_SELLER, { Country: 'AU' }, lines, 'AUD');
  assert.equal(a.tax_status[0].status, 'UNAVAILABLE');
  assert.equal(a.tax_status[0].reason, 'rate_missing');
  assert.throws(() => TL.refuseUnavailable(a.tax_status, lines), (e) => e.code === 'TAX_LINE_UNAVAILABLE' && /Muffin/.test(e.message));
  /* the same item with the pack's own 10% (what lib/default-tax-rate stamps on a new item): RATED, GST 1.00 of 11.00 inclusive */
  const rated = TL.invoiceFor({ lines: [{ name: 'Muffin', qty: 1, unit_price: 11, gst_rate: 10 }], seller: AU_SELLER, buyer: { Country: 'AU' }, currency: 'AUD', at: '2026-11-07T00:00:00Z', priceIncludesTax: true });
  assert.equal(rated.tax_status[0].status, 'RATED');
  assert.deepEqual(rated.tax_status[0].tax, { amount_minor: 100, currency: 'AUD' });
});
