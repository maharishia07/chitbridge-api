#!/usr/bin/env node
// @type: contract
/**
 * crm-47-party-keys.test.cjs — CRM-47: a party body is never half-read. tax_ids that is not a list, and two keys for one credit limit, are refused by name.
 *
 * OWNS      lib/party-fields.cleanTaxIds() and clean(): tax_ids sent as an object, credit_limit_minor and credit_limit in one body.
 * CALLED BY scripts/guards.cjs · CI. No database, no network: both are pure functions.
 * MIN       contract - 9 checks; the 3 refusals fail on the base it was cut from (an object answered null = ignored, and credit_limit lost to credit_limit_minor).
 * CARD      11-crm-and-marketing/parties-one-record-timeline-interactions
 * HAND      tax_ids absent -> null (nothing to change); [] -> [] (clear them); { scheme: 'GSTIN' } -> 400 naming tax_ids; credit_limit_minor 5000 alone -> 5000 minor units.
 */
'use strict';
const path = require('path');
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
const { clean, cleanTaxIds } = require(path.join(__dirname, '..', 'lib', 'party-fields'));

let failed = 0;
const check = (name, ok) => {
  if (!ok) failed++;
  console.log((ok ? 'ok   ' : 'FAIL ') + name);
};
const refusedWith = (fn, words) => {
  try {
    fn();
    return false;
  } catch (e) {
    return e.status === 400 && words.test(e.message);
  }
};

check('tax_ids absent changes nothing', cleanTaxIds(undefined) === null && cleanTaxIds(null) === null);
check('tax_ids [] clears', Array.isArray(cleanTaxIds([])) && cleanTaxIds([]).length === 0);
check('tax_ids as an object refused by name', refusedWith(() => cleanTaxIds({ scheme: 'GSTIN', value: 'x' }), /tax_ids is a list/));
check('tax_ids as a string refused', refusedWith(() => cleanTaxIds('27AAAAA0000A1Z5'), /tax_ids is a list/));
check('tax_ids as a number refused', refusedWith(() => cleanTaxIds(5), /tax_ids is a list/));
check('both credit keys refused by name', refusedWith(() => clean('customer', { credit_limit_minor: 5000, credit_limit: 50 }), /credit_limit_minor or credit_limit, not both/));
check('both credit keys refused even when one is -5', refusedWith(() => clean('supplier', { credit_limit_minor: 5000, credit_limit: -5 }), /not both/));
check('credit_limit_minor alone kept', clean('customer', { credit_limit_minor: 5000 }).credit_limit_minor === 5000);
check('credit_limit alone is rupees to minor units (50 -> 5000)', clean('customer', { credit_limit: 50 }).credit_limit_minor === 5000);

if (failed) {
  console.log(failed + ' failed');
  process.exit(1);
}
console.log('crm-47-party-keys: all passed');
