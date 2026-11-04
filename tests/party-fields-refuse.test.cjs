/**
 * party-fields-refuse.test.cjs — CRM-46: a party field that cannot be stored exactly is REFUSED in words, never cut or rounded in silence.
 * Run: node tests/party-fields-refuse.test.cjs   (pure: lib/party-fields.clean, no database)
 */
'use strict';
const assert = require('assert');
const { clean } = require('../lib/party-fields');

let pass = 0;
const ok = (what, fn) => { try { fn(); pass++; console.log('  ok  ' + what); } catch (e) { console.log('  FAIL ' + what + '\n      ' + e.message); process.exitCode = 1; } };
const refused = (side, body, re) => assert.throws(() => clean(side, body), (e) => e.status === 400 && re.test(e.message));

ok('credit days 2.7 is refused, not floored to 2', () => refused('customer', { credit_days: 2.7 }, /number of days/));
ok('credit days true is refused, not stored as 1', () => refused('customer', { credit_days: true }, /number of days/));
ok('credit days 30 / "30" / null / "" still go through', () => {
  assert.strictEqual(clean('customer', { credit_days: 30 }).credit_days, 30);
  assert.strictEqual(clean('customer', { credit_days: '30' }).credit_days, 30);
  assert.strictEqual(clean('customer', { credit_days: null }).credit_days, null);
  assert.strictEqual(clean('customer', { credit_days: '' }).credit_days, null);
});
ok('credit limit 12.5 minor units is refused, not rounded to 13', () => refused('supplier', { credit_limit_minor: 12.5 }, /whole minor units/));
ok('credit limit 1250 minor stays; a limit typed in rupees still becomes minor units', () => {
  assert.strictEqual(clean('supplier', { credit_limit_minor: 1250 }).credit_limit_minor, 1250);
  assert.strictEqual(clean('supplier', { credit_limit: 12.5 }).credit_limit_minor, 1250);
});
ok('a legal name of 201 characters is refused with its length; 200 is kept whole', () => {
  refused('customer', { legal_name: 'x'.repeat(201) }, /at most 200 characters; this one has 201/);
  assert.strictEqual(clean('customer', { legal_name: 'y'.repeat(200) }).legal_name.length, 200);
});
ok('a customer nickname of 81 is refused; 80 is kept; spaces are tidied, not counted twice', () => {
  refused('customer', { nickname: 'n'.repeat(81) }, /nickname can be at most 80/);
  assert.strictEqual(clean('customer', { nickname: 'n'.repeat(80) }).nickname.length, 80);
  assert.strictEqual(clean('customer', { nickname: '  Big   Ravi ' }).nickname, 'Big Ravi');
});
ok('a state code over 8 is refused, not cut', () => refused('customer', { state_code: '123456789' }, /state code can be at most 8/));

console.log('\n' + pass + ' passed' + (process.exitCode ? ' · FAILURES above' : ''));
