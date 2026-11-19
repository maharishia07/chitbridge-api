#!/usr/bin/env node
// @type: unit
/**
 * tests/xc-1119-no-pack.test.cjs — XC-1119 (Athi 19 Nov): the ONE no-pack sentence, the AE "VAT" scheme, a mixed firm's filing verb, a client row's own country (offline).
 * OWNS      the offline checks of lib/no-pack-words.js and the three small fixes riding with it.   CALLED BY scripts/guards.cjs.   CARD  15-tax-and-country-packs/no-pack-words
 */
'use strict';
process.env.NODE_ENV = 'test';
const assert = require('assert');
const noPack = require('../lib/no-pack-words');
const CS = require('../lib/country-setup');
const P = require('../lib/books-practice');
const { countryWords } = require('../lib/tax-contract');
let n = 0;
const ok = (what, fn) => { fn(); n++; console.log('  ok  ' + what); };

ok('the sentence is the one Athi worded, with the country by name', () => {
  assert.strictEqual(noPack.packMissing('NZ'), "The New Zealand pack is missing, so New Zealand rules can't be checked.");
});
ok('the refusal is a 422 NO_COUNTRY_PACK in that sentence, never a retryable 503', () => {
  const r = noPack.refusal('NZ');
  assert.strictEqual(r.status, 422); assert.strictEqual(r.code, 'NO_COUNTRY_PACK'); assert.strictEqual(r.refused, true); assert.strictEqual(r.message, noPack.packMissing('NZ'));
});
ok('the engine "no tax scheme" throw is told from any other error', () => {
  assert.strictEqual(noPack.isNoPackError(new Error('no tax scheme: the lines cite none')), true);
  assert.strictEqual(noPack.isNoPackError(new Error('boom')), false);
});
ok('the buyer is warned in its own words (a warning, not a refusal)', () => {
  assert.strictEqual(noPack.buyerWarning('NZ'), "Your New Zealand pack is missing, so this invoice can't be checked against New Zealand rules.");
});
ok('tax-contract says the same sentence for a country with no pack', () => {
  assert.strictEqual(countryWords('NO_COUNTRY_PACK', 'engine words', 'NZ'), noPack.packMissing('NZ'));
});
ok('setup: the tax number is said NOT checked for a country with no pack', () => {
  assert.match(noPack.numberUnchecked('NZ'), /NOT checked/);
});
ok('AE setup accepts the pack\'s own word VAT as the registered scheme', () => {
  const out = CS.clean({ country: 'AE', currency: 'AED', fy_start_month: 1, tax: { registered: true, number: '100123456700003', scheme: 'VAT' } });
  assert.strictEqual(out.tax.scheme, 'regular');
});
ok('a mixed firm (AU + IN clients) gets the neutral filing verb, a one-country firm its own', () => {
  assert.strictEqual(P.filingVerbOf([{ country: 'AU' }, { country: 'IN' }], 'AU'), 'file');
  assert.strictEqual(P.filingVerbOf([{ country: 'AU' }, { country: 'AU' }], 'IN'), 'lodge');
  assert.strictEqual(P.filingVerbOf([], 'AU'), 'lodge');
});
ok('a client with its books off still carries its own country and currency, and says its pack is missing', () => {
  const row = P.whoOf({ entity_id: 'e1', setting: null, identity: { country: 'nz', currency_code: 'NZD' } }, { grantor_name: 'Kiwi', preset: 'adviser', grant_id: 'g1' });
  assert.strictEqual(row.country, 'NZ'); assert.strictEqual(row.currency, 'NZD'); assert.strictEqual(row.books_on, false);
  assert.strictEqual(row.pack_missing, noPack.packMissing('NZ'));
  const au = P.whoOf({ entity_id: 'e2', setting: null, identity: { country: 'AU', currency_code: 'AUD' } }, { preset: 'adviser' });
  assert.strictEqual(au.pack_missing, null);
});
console.log('\n' + n + ' checks passed');
process.exit(0);
