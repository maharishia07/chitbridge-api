/**
 * tests/tax01b-country-of-number.test.cjs — VERIFY-TAX-01 row 6 (batch 1128): a tax number is not India by default. Hand cases, offline.
 *   A  legacy AU row: country NULL, gstn = ABN 51824753556 (weighted sum 534 = 89 x 6)  -> countryOf null or AU, NEVER IN
 *   B  country NULL, gstn = 27AAPFU0939F1ZV (a valid Maharashtra GSTIN)                    -> IN
 *   C  country NULL, gstn = 27AAPFU0939F1ZX (wrong check character), and '12345'           -> null
 *   D  country '12' (digits)                                                               -> null (a country is two letters)
 *   E  country 'au' stated beside a GSTIN                                                  -> AU (stated wins)
 * Run: node tests/tax01b-country-of-number.test.cjs
 */
'use strict';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
const assert = require('assert');
const profile = require('../lib/profile.js');
let pass = 0, fail = 0;
const it = (what, fn) => { try { fn(); pass++; console.log('  ok  ' + what); } catch (e) { fail++; console.log('  FAIL ' + what + '\n      ' + e.message); } };
it('A  an ABN in gstn is never India', () => assert.notStrictEqual(profile.countryOf({ country: null, gstin: '51824753556' }), 'IN'));
it('B  a valid GSTIN is India', () => assert.strictEqual(profile.countryOf({ country: null, gstin: '27AAPFU0939F1ZV' }), 'IN'));
it('C  a bad check character or short number is no country', () => {
  assert.strictEqual(profile.countryOf({ gstin: '27AAPFU0939F1ZX' }), null);
  assert.strictEqual(profile.countryOf({ gstin: '12345' }), null);
});
it('D  a country of digits is no country', () => assert.strictEqual(profile.countryOf({ country: '12' }), null));
it('E  a stated country wins, case folded', () => assert.strictEqual(profile.countryOf({ country: 'au', gstin: '27AAPFU0939F1ZV' }), 'AU'));
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
