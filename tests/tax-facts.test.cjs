'use strict';
/**
 * tax-facts.test.cjs - lib/tax-facts.js: the owner's registration ANSWER, read one way (CMP-13).
 * OWNS      one case per rule of taxFactsOf (registered, number, scheme), the refusal to guess, and the closed default
 * CALLED BY scripts/guards.cjs
 * CARD      28-platform-and-operations/country-setup
 */
const assert = require('assert');
const { SCHEMES, taxFactsOf } = require('../lib/tax-facts');

let passed = 0;
function t(name, fn) {
  fn();
  passed++;
  console.log('  ok  ' + name);
}

t('the schemes a shop can state are regular and composition', () => {
  assert.deepStrictEqual(SCHEMES, ['regular', 'composition']);
});

t('rule: the owner\'s explicit answer wins for registered, true and false alike', () => {
  assert.strictEqual(taxFactsOf({ registered: true }, null, {}).registered, true);
  assert.strictEqual(taxFactsOf({ registered: false }, '29ABCDE1234F1Z5', {}).registered, false);
});

t('rule: no answer but a tax number means registered', () => {
  assert.strictEqual(taxFactsOf(null, '29ABCDE1234F1Z5', {}).registered, true);
});

t('rule: the scheme comes from the answer, then the flag, and a number alone is regular', () => {
  assert.strictEqual(taxFactsOf({ scheme: 'composition' }, null, { gst_registration: 'regular' }).scheme, 'composition');
  assert.strictEqual(taxFactsOf(null, null, { gst_registration: 'Composition' }).scheme, 'composition');
  assert.strictEqual(taxFactsOf(null, '29ABCDE1234F1Z5', {}).scheme, 'regular');
});

t('the number is carried through unchanged', () => {
  assert.strictEqual(taxFactsOf(null, 'X1', {}).number, 'X1');
  assert.strictEqual(taxFactsOf(null, null, {}).number, null);
});

t('refusal path: a scheme that is not on the list is never accepted, never thrown', () => {
  assert.strictEqual(taxFactsOf({ scheme: 'made-up' }, null, {}).scheme, null);
  assert.strictEqual(taxFactsOf({ scheme: 'made-up' }, 'X1', {}).scheme, 'regular');
  assert.strictEqual(taxFactsOf({ registered: 'yes' }, null, {}).registered, null, 'a non-boolean answer is not an answer');
});

t('fail-closed: nothing said stays unknown (null), it is never assumed "not registered"', () => {
  assert.deepStrictEqual(taxFactsOf(null, null, {}), { registered: null, number: null, scheme: null });
});

console.log(`  ${passed} checks`);
