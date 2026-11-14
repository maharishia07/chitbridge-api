#!/usr/bin/env node
// @type: contract
/**
 * crm-46-party-exact.test.cjs — CRM-46: a party field that cannot be stored exactly is refused in words, never cut or rounded in silence.
 *
 * OWNS      lib/party-fields.clean(): credit_days 2.7 / true, credit_limit_minor 12.5 / true, a legal name over 200 characters, a nickname over 80.
 * CALLED BY scripts/guards.cjs · CI. No database, no network: clean() is a pure function.
 * MIN       contract - 13 checks; the 6 refusals fail on the base it was cut from (that cut 2.7 to 2, true to 1, 12.5 to 13 and long text to its first 200 / 80 characters).
 * CARD      11-crm-and-marketing/parties-one-record-timeline-interactions
 * HAND      credit_days "30" -> 30; credit_limit_minor 150000 -> 150000 (money in minor units of the shop's currency, kept as sent); a 200-character name is kept whole, 201 is refused.
 */
'use strict';
const path = require('path');
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
const { clean } = require(path.join(__dirname, '..', 'lib', 'party-fields'));

let failed = 0;
const check = (name, ok) => {
  if (!ok) failed++;
  console.log((ok ? 'ok   ' : 'FAIL ') + name);
};
const refused = (side, body, words) => {
  try {
    clean(side, body);
    return false;
  } catch (e) {
    return e.status === 400 && words.test(e.message);
  }
};
const kept = (side, body) => {
  try {
    return clean(side, body);
  } catch (_) {
    return null;
  }
};

check('credit_days 2.7 refused', refused('customer', { credit_days: 2.7 }, /Credit days is a whole number/));
check('credit_days true refused', refused('supplier', { credit_days: true }, /Credit days is a whole number/));
check('credit_days "30" read as 30', (kept('customer', { credit_days: '30' }) || {}).credit_days === 30);
check('credit_days null clears', (kept('customer', { credit_days: null }) || {}).credit_days === null);
check('credit_limit_minor 12.5 refused', refused('customer', { credit_limit_minor: 12.5 }, /whole number/));
check('credit_limit_minor true refused', refused('supplier', { credit_limit_minor: true }, /whole number/));
check('credit_limit_minor 150000 kept', (kept('customer', { credit_limit_minor: 150000 }) || {}).credit_limit_minor === 150000);
check('credit_limit_minor -5 still refused', refused('customer', { credit_limit_minor: -5 }, /0 or more/));
check('legal_name of 200 kept whole', ((kept('customer', { legal_name: 'a'.repeat(200) }) || {}).legal_name || '').length === 200);
check('legal_name of 201 refused', refused('customer', { legal_name: 'a'.repeat(201) }, /legal name is at most 200/));
check('nickname of 81 refused', refused('customer', { nickname: 'n'.repeat(81) }, /nickname is at most 80/));
check('nickname of 80 kept', ((kept('customer', { nickname: 'n'.repeat(80) }) || {}).nickname || '').length === 80);
check('blank legal_name still clears', (kept('supplier', { legal_name: '  ' }) || {}).legal_name === null);

if (failed) {
  console.log(failed + ' failed');
  process.exit(1);
}
console.log('crm-46-party-exact: all passed');
