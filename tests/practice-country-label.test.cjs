'use strict';
// @type: unit
/**
 * practice-country-label.test.cjs - NZ slice 2 (1131): the firm list's Country column rests on the row's own `country` (a code) and its return label comes from the PACK, never a field name.
 * OWNS      hand-computed proof that whoOf carries the client's country (books setting first, own identity when its books are off) and that basOf names the form from the pack's calendar
 *           (AU "BAS", AE "VAT return", each the pack's returns.short), so a pack registered later (NZ GST101A) labels its rows with no change here.
 * CALLED BY by hand: node tests/practice-country-label.test.cjs
 * HAND      AU: the pack short name is BAS (reg-au returns.short), AE: "VAT return" (reg-ae returns.short, id VAT201). The test asserts the FORM word, never a date this file did not read from the pack.
 */
const assert = require('assert');
const P = require('../lib/books-practice');
let bad = 0;
const t = (name, fn) => { try { fn(); console.log('  ok  ', name); } catch (error) { bad++; console.log('  FAIL', name, '\n      ', error.message); } };

t('whoOf: the books setting country wins, upper-cased', () => {
  const who = P.whoOf({ entity_id: 'e1', setting: { country: 'au', enabled: true, functional_currency: 'AUD' }, identity: { country: 'IN', currency_code: 'INR' } }, { grantor_name: 'A', preset: 'adviser', grant_id: 'g' });
  assert.strictEqual(who.country, 'AU'); assert.strictEqual(who.currency, 'AUD'); assert.strictEqual(who.books_on, true);
});
t('whoOf: books off, the client\'s own identity gives its country (XC-1119)', () => {
  const who = P.whoOf({ entity_id: 'e2', setting: null, identity: { country: 'ae', currency_code: 'AED' } }, { grantor_name: 'B', preset: 'auditor', grant_id: 'h' });
  assert.strictEqual(who.country, 'AE'); assert.strictEqual(who.books_on, false);
});
t('whoOf: no country anywhere is null, not a guess', () => {
  assert.strictEqual(P.whoOf({ entity_id: 'e3', setting: null, identity: null }, { preset: 'adviser' }).country, null);
});
t('basOf: the form word is the pack\'s own short name', () => {
  const au = P.basOf({ country: 'AU', fy_start_month: 7, enabled: true }, '2026-11-26', []);
  const ae = P.basOf({ country: 'AE', fy_start_month: 1, enabled: true }, '2026-11-26', []);
  assert.strictEqual(au.form, 'BAS'); assert.strictEqual(ae.form, 'VAT return'); /* reg-ae returns.short (its id is VAT201): the pack's word, read from reg-ae.js */
});
t('basOf: books off says so in words, no form', () => {
  const off = P.basOf(null, '2026-11-26', []);
  assert.strictEqual(off.form, null); assert.ok(/not switched on/.test(off.why));
});
process.exit(bad ? 1 : 0);
