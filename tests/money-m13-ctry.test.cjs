#!/usr/bin/env node
'use strict';
/**
 * tests/money-m13-ctry.test.cjs — CTRY-20 + CTRY-29 pinned (M13, 2026-11-12). Proof only: the behaviour was already right on main.
 * CTRY-20  lib/profile-map.js FIELDS carry a layer, the jurisdiction layer is exactly state · pincode · country · currency, an AU shop is
 *          never given India's currency, and the ABN check (lib/reg-au.js abnCheck, modulus 89) takes 51 824 753 556, refuses its 10-digit cut and a wrong check.
 * CTRY-29  lib/kyb.js risk(): by_currency[] one group per currency, no single total across currencies, a null / zero amount not coalesced to a
 *          trade (stated in excluded.awaiting_agreement), a chit with no currency stated in excluded.non_monetary.
 * Hand figures (see the comments). No database: db is a stand-in in the require cache. Run: node tests/money-m13-ctry.test.cjs
 */
const path = require('path');
const assert = require('assert');
process.env.NODE_ENV = 'test'; process.env.DATABASE_URL = '';
const API = path.join(__dirname, '..');
const dbPath = require.resolve(path.join(API, 'db'));
let ROWS = [];
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { query: async () => ({ rows: [] }), withEntity: async (id, fn) => fn({ query: async () => ({ rows: ROWS }) }) } };
const PM = require('../lib/profile-map');
const AU = require('../lib/reg-au');
const kyb = require('../lib/kyb');

let n = 0;
const ok = (name, fn) => Promise.resolve().then(fn).then(() => { n++; console.log('  ok  ' + name); }, (e) => { console.error('FAIL ' + name + '\n' + (e && e.stack || e)); process.exit(1); });

(async () => {
  await ok('CTRY-20 profile-map FIELDS: every field names a layer; jurisdiction = state, pincode, country, currency', () => {
    const layers = new Set(['identity', 'tax', 'contact', 'jurisdiction', 'banking']);
    assert.strictEqual(PM.FIELDS.length, 16);
    PM.FIELDS.forEach((f) => assert.ok(layers.has(f.layer), f.key + ' layer ' + f.layer));
    assert.deepStrictEqual(PM.FIELDS.filter((f) => f.layer === 'jurisdiction').map((f) => f.key), ['state', 'pincode', 'country', 'currency']);
    const a = PM.assess({});
    assert.strictEqual(a.fields.currency.layer, 'jurisdiction');
  });
  await ok('CTRY-20 an AU shop (country AU, no GSTIN) is not given INR or an Indian country', () => {
    const a = PM.assess({ country: { value: 'AU' } });
    assert.strictEqual(a.fields.country.value, 'AU');
    assert.strictEqual(a.fields.currency.value, null); // not derived to INR: unknown stays unknown
    assert.strictEqual(a.fields.currency.missing, true);
    // contrast: India derives INR from IN
    assert.strictEqual(PM.assess({ country: { value: 'IN' } }).fields.currency.value, 'INR');
  });
  await ok('CTRY-20 ABN check: 51824753556 passes (sum 534 = 6 x 89), 10 digits refused, a wrong check digit refused', () => {
    // digits less 1 on the first: 4 1 8 2 4 7 5 3 5 5 6 x weights 10 1 3 5 7 9 11 13 15 17 19 = 40+1+24+10+28+63+55+39+75+85+114 = 534 = 6 x 89
    const good = AU.abn.check('51824753556');
    assert.strictEqual(good.ok, true); assert.strictEqual(good.formatted, '51 824 753 556');
    assert.strictEqual(AU.abn.check('51 824 753 556').ok, true); // spaces allowed
    const short = AU.abn.check('5182475355');
    assert.strictEqual(short.ok, false); assert.strictEqual(short.why, 'An ABN is 11 digits.');
    // 51824753557: sum 535, 535 mod 89 = 1, not 0
    const bad = AU.abn.check('51824753557');
    assert.strictEqual(bad.ok, false); assert.ok(/check digits do not match/.test(bad.why));
    assert.strictEqual(AU.abn.valid('51824753556'), true); assert.strictEqual(AU.abn.valid(null), false);
  });

  await ok('CTRY-29 kyb risk: INR and USD are two groups, never one sum; null / zero / no-currency rows stated, not valued', async () => {
    const recv = (d) => [{ role: 'receiver', display_name: d }];
    ROWS = [
      { direction: 'sent', all_recipients: recv('A'), total_value: '300.00', currency_code: 'INR' },
      { direction: 'sent', all_recipients: recv('B'), total_value: '100.00', currency_code: 'INR' },
      { direction: 'received', sender_entity_display_name: 'C', total_value: '100.00', currency_code: 'USD' },
      { direction: 'sent', all_recipients: recv('A'), total_value: null, currency_code: 'INR' },        // an offer nobody agreed: awaiting
      { direction: 'sent', all_recipients: recv('A'), total_value: '0.00', currency_code: 'USD' },      // zero: awaiting, not a zero trade
      { direction: 'received', sender_entity_display_name: 'D', total_value: '0.00', currency_code: null } // no currency: not money
    ];
    const r = await kyb.risk('e1'); const c = r.facts.concentration;
    // INR 300.00 + 100.00 = 400.00, A 300/400 = 75.0%, B 25.0%; USD 100.00 one chit, C 100.0%
    assert.deepStrictEqual(c.by_currency.map((g) => [g.currency, g.total, g.chits]), [['INR', 400, 2], ['USD', 100, 1]]);
    assert.deepStrictEqual(c.by_currency[0].parties, [{ counterparty: 'A', value: 300, pct: 75 }, { counterparty: 'B', value: 100, pct: 25 }]);
    assert.deepStrictEqual(c.by_currency[1].parties, [{ counterparty: 'C', value: 100, pct: 100 }]);
    assert.strictEqual('total' in c, false); // no single total across currencies
    assert.strictEqual(c.chits, 3);          // valued rows only; the null and zero rows are not trades
    assert.deepStrictEqual(c.excluded, { non_monetary: 1, awaiting_agreement: 2 });
    assert.strictEqual(c.top.counterparty, 'A'); // the legacy fields describe the largest currency (INR 400.00)
    assert.strictEqual(r.facts.exposures[0].fact, '75% of your INR business sits with one buyer (A).');
    assert.strictEqual(r.facts.exposures[0].severity, 'high');
  });
  await ok('CTRY-29 kyb risk: one currency answers as before (a single group); no rows = no groups, nothing invented', async () => {
    ROWS = [{ direction: 'received', sender_entity_display_name: 'C', total_value: '50.00', currency_code: 'AED' }];
    const one = (await kyb.risk('e1')).facts.concentration;
    assert.deepStrictEqual(one.by_currency.map((g) => [g.currency, g.total]), [['AED', 50]]);
    ROWS = [];
    const none = (await kyb.risk('e1')).facts.concentration;
    assert.deepStrictEqual(none.by_currency, []); assert.strictEqual(none.top, null);
    assert.deepStrictEqual(none.excluded, { non_monetary: 0, awaiting_agreement: 0 });
  });
  console.log('money-m13-ctry: ' + n + ' passed'); process.exit(0);
})();
