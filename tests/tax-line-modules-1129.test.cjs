#!/usr/bin/env node
// @type: unit
/**
 * tests/tax-line-modules-1129.test.cjs — the two small modules moved out of lib/tax-lines.js (readability, batch 1129).
 *
 * OWNS      lib/tax-line-status (lineTaxStatusOf, refuseUnavailable) and lib/tax-engine-line (engineLineOf, rcmCategoryOf): each rule once, the refusal, and the fail-closed case.
 * CALLED BY scripts/guards.cjs · CI. No database, no network.
 * FLOW      hand-made engine rows → the module → the status / the engine line
 * Run: node tests/tax-line-modules-1129.test.cjs · MIN unit-per-rule · refusal-path · fail-closed (a line with no rate and no reason is never a silent 0)
 * CARD      15-tax-and-country-packs/tax-compute-rate-invoice-tax
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { lineTaxStatusOf, refuseUnavailable } = require('../lib/tax-line-status');
const { engineLineOf, rcmCategoryOf } = require('../lib/tax-engine-line');

test('a rated line is RATED with its tax in minor units', () => {
  const out = lineTaxStatusOf({ currency: 'INR', ItemList: [{ GstRt: 18, CgstAmt: 9, SgstAmt: 9 }], _cb: { supply: 'intra' } }, [{}]);
  assert.deepEqual(out[0], { line: 0, status: 'RATED', rate: 18, tax: { amount_minor: 1800, currency: 'INR' } });
});

test('a zero line with no word is UNAVAILABLE and the refusal names the line (fail closed, never a silent 0)', () => {
  const out = lineTaxStatusOf({ currency: 'INR', ItemList: [{ GstRt: 0 }], _cb: {} }, [{ name: 'Tea' }]);
  assert.equal(out[0].status, 'UNAVAILABLE');
  assert.equal(out[0].reason, 'zero_reason_missing');
  assert.throws(() => refuseUnavailable(out, [{ name: 'Tea' }]), /Line 1 \(Tea\)/);
});

test('a zero line with a supply kind, a nil kind or a stated export is ZERO with that word', () => {
  const byKind = lineTaxStatusOf({ ItemList: [{ GstRt: 0 }], _cb: { kinds: [{ line: 0, kind: 'gst_free' }] } }, [{}]);
  assert.equal(byKind[0].reason, 'gst_free');
  const byNil = lineTaxStatusOf({ ItemList: [{ GstRt: 0, _nil_kind: 'exempt' }], _cb: {} }, [{}]);
  assert.equal(byNil[0].reason, 'exempt');
  const byExport = lineTaxStatusOf({ ItemList: [{ GstRt: 0 }], _cb: { export: 'stated' } }, [{}]);
  assert.equal(byExport[0].reason, 'zero_rated_export');
});

test('a charge-nothing document answers every line with its word; an unrated line and an unreadable cess are UNAVAILABLE', () => {
  const doc = lineTaxStatusOf({ ItemList: [{ GstRt: 18 }], _cb: { reason: 'sez' } }, [{}]);
  assert.deepEqual(doc[0], { line: 0, status: 'ZERO', reason: 'sez' });
  const unrated = lineTaxStatusOf({ ItemList: [{ _unrated: true }], _cb: {} }, [{}]);
  assert.equal(unrated[0].reason, 'rate_missing');
  const cess = lineTaxStatusOf({ ItemList: [{ GstRt: 18 }], _cb: {} }, [{ cess_unreadable: true }]);
  assert.equal(cess[0].reason, 'cess_rate_unreadable');
  assert.doesNotThrow(() => refuseUnavailable([{ line: 0, status: 'RATED' }], [{}]));
});

test('engineLineOf: quantity and price fall back in order, a line with no rate keeps no rate, the offer is the discount', () => {
  const out = engineLineOf({ qty: 3, unit_price: 50, offer: { off: 5 }, hsn: '0901' });
  assert.equal(out.qty, 3);
  assert.equal(out.unit_price, 50);
  assert.equal(out.discount, 5);
  assert.equal(out.rate, undefined);
  assert.equal(engineLineOf({ quantity: 2, gst_rate: 0, rate: 12 }).rate, 0);
  assert.equal(engineLineOf({ list_price: '' }).list_price, undefined);
  assert.equal(engineLineOf({ list_price: 90 }).list_price, 90);
  assert.equal(engineLineOf({ supply_kind: 'zero_rated', nil_kind: 'nil' }).tax_kind, 'zero_rated');
});

test('rcmCategoryOf reads the mark a line names, lower-cased, or nothing', () => {
  assert.equal(rcmCategoryOf({ rcm_category: ' GTA ' }), 'gta');
  assert.equal(rcmCategoryOf({ rcmCategory: 'legal' }), 'legal');
  assert.equal(rcmCategoryOf({ rcm_category: '' }), undefined);
  assert.equal(rcmCategoryOf(null), undefined);
});
