'use strict';
/**
 * country-registry-callers.test.cjs — R5b (engines v1.53.0): the api asks the country registry, never a country's own member name.
 * A NEW country (registered here at run time, its pack carrying the standard `taxId`) gets its own tax-ID check and word with no api edit;
 * Australia and the UAE keep exactly today's verdicts. Found by the Singapore runbook trial: before R5 a UEN was accepted unchecked.
 */
const assert = require('assert');
const R = require('../lib/regulation'), AE = require('../lib/reg-ae'), P = require('../lib/profile');
let pass = 0;
const it = (what, fn) => { try { fn(); pass++; console.log('  ok  ' + what); } catch (e) { console.log('  FAIL ' + what + '\n      ' + e.message); process.exitCode = 1; } };

const XX = Object.assign({}, AE, { id: 'XX', country: 'XX', name: 'Testland · GST', version: '1.0.0',
  taxId: { name: 'UEN', hint: '201912345K', check: (v) => (/^\d{9}[A-Z]$/.test(v) ? { ok: true, value: v } : { ok: false, why: 'A UEN looks like 201912345K.' }) } });
R.register(XX);

it('⭐ a new country: its own taxId check refuses a bad number, in its own words', () => {
  const r = P.taxIdRefusal('XX', 'ABC');
  assert.ok(r && r.code === 'TAX_ID_BAD', JSON.stringify(r)); assert.equal(r.why, 'A UEN looks like 201912345K.');
  assert.equal(P.taxIdRefusal('XX', '201912345K'), null);
});
it('⭐ a new country: the tax-ID word is its own', () => { assert.equal(P.taxIdWordOf('XX'), 'UEN'); });
it('Australia and the UAE: the same verdicts and words as before R5', () => {
  assert.equal(P.taxIdRefusal('AU', '51 824 753 556'), null); assert.ok(P.taxIdRefusal('AU', '51824753557'));
  assert.equal(P.taxIdRefusal('AE', '100123456700003'), null); assert.ok(P.taxIdRefusal('AE', '1001234'));
  assert.equal(P.taxIdWordOf('AU'), 'ABN'); assert.equal(P.taxIdWordOf('AE'), 'TRN');
});
console.log(pass + ' checks');
