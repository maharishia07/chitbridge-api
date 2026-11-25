/**
 * walky-rate-menu-1129.test.cjs - WALK Y Y-F-03: the api took gst_rate 15 and 5 on an AU shop (200, stored). The country pack's own menu decides (AU 0 or 10).
 * Run: node tests/walky-rate-menu-1129.test.cjs      CARD  09-counter/returns
 */
'use strict';
const assertLib = require('assert');
let checks = 0;
const assert = new Proxy(assertLib, { get: (target, key) => (typeof target[key] === 'function' ? (...args) => (checks++, target[key](...args)) : target[key]), apply: (target, self, args) => (checks++, target(...args)) }); /* count each assertion for the '<n> checks' line guards read */
const path = require('path');
const dbPath = require.resolve('../db');
let country = 'AU';
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { query: async () => ({ rows: [{ country, gstn: country === 'AU' ? '51824753556' : null }] }) } };
const write = require('../lib/catalogue-write');
(async () => {
  const refuse = async (rate, stored) => { const r = await write.rateMenuRefusal('e1', { gst_rate: rate }, stored); return r; };
  assert.ok(/15% is not one the tax rules of your country have\. The rates here are 0% or 10%/.test(await refuse(15)), await refuse(15));
  assert.ok(await refuse(5));
  assert.strictEqual(await refuse(10), null);
  assert.strictEqual(await refuse(0), null);
  assert.strictEqual(await refuse('10'), null);
  assert.strictEqual(await refuse(undefined), null);
  assert.strictEqual(await refuse(15, { gst_rate: 15 }), null, 'a legacy row stays editable');
  country = 'XX';
  assert.strictEqual(await refuse(15), null, 'a country with no pack judges nothing');
  console.log('walky-rate-menu: all passed');
  console.log(checks + ' checks');
})().catch((e) => { console.log('FAIL', e.message); process.exit(1); });
