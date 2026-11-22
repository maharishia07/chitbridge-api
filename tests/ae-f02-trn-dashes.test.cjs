/**
 * tests/ae-f02-trn-dashes.test.cjs — AE-F-02 (Walk AE 21 Nov): a UAE TRN typed the way it is printed (100-2345-6780-0003, or with spaces) is cleaned to its
 * 15 digits by the pack's own rule and stored clean; it used to reach identities.gstn (15 characters) with 18 and answer 500.
 * Hand: "100-2345-6780-0003" without dashes = 1002345678 00003 = 100234567800003 (15 digits). 14 digits, 16 digits and a letter are refused in words.
 * Run: node --test tests/ae-f02-trn-dashes.test.cjs · no DB, no network.
 * CARD      15-tax-and-country-packs/country-setup-and-country-lab
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const CS = require('../lib/country-setup');
const profile = require('../lib/profile');

const base = (number) => ({ country: 'AE', currency: 'AED', fy_start_month: 1, tax: { registered: true, number, scheme: 'regular' } });

test('a TRN typed with dashes or spaces is stored as 15 digits', () => {
  for (const typed of ['100-2345-6780-0003', '100 2345 6780 0003', ' 100234567800003 ']) {
    const answer = CS.clean(base(typed));
    assert.equal(answer.tax.number, '100234567800003', typed);
  }
});
test('a wrong TRN is refused in words (400), never passed on', () => {
  for (const typed of ['10023456780003', '1002345678000034', '10023456780000A']) {
    assert.throws(() => CS.clean(base(typed)), (e) => e.status === 400 && /TRN/.test(e.message || e.why || ''), typed);
  }
});
test('the one cleaner, and the one check refuses what the column could not hold', () => {
  assert.equal(profile.taxIdNormal('AE', '100-2345-6780-0003'), '100234567800003');
  assert.equal(profile.taxIdRefusal('AE', '100-2345-6780-0003'), null);
  assert.equal(profile.taxIdNormal('XX', 'abc-1'), 'ABC-1');
  assert.equal(profile.taxIdRefusal('XX', 'A'.repeat(20)).code, 'TAX_ID_BAD');
});
