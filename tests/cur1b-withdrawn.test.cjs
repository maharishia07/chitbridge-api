/**
 * tests/cur1b-withdrawn.test.cjs · CUR-1b (DECISIONS 80c547c7): a withdrawn code (BGN HRK CUC SLL ZWL) stays READABLE on old records
 * and is refused at every door that makes NEW money; a fund (XDR) is never a shop's money.
 *
 * OWNS: the api side of the withdrawn-codes rule: work-rows' minor-unit expression, the setting door (govresolve.currencyRefusal),
 * the fx-rates door, the registration guess, and both vendored money copies answering the same.
 * CALLED BY: scripts/guards.cjs (node tests/cur1b-withdrawn.test.cjs). No network, no DB.
 * FLOW: money value type; shop currency setup; fx rates.
 * BREAK CASE: on money v1.89.0 (no read list) decimals('BGN') throws, so the first check fails and one old BGN row would 422 the whole list.
 */
'use strict';
const assert = require('assert');
const money = require('../lib/money');
const tally = require('../tools/tally-connector/money');
const fx = require('../lib/fx-rates');
const gov = require('../lib/govresolve');

const WITHDRAWN = ['BGN', 'HRK', 'CUC', 'SLL', 'ZWL'];
let checks = 0;
const it = (what, body) => Promise.resolve(body()).then(() => { checks += 1; console.log('  ok  ' + what); });

/* the very expression lib/work-rows.js minorOf runs on every order row (one calculation: money.round and money.decimals) */
const minorOf = (v, cur) => Math.round(money.round(Number(v), cur || null) * Math.pow(10, money.decimals(cur || null)));

(async () => {
  await it('an old record in a withdrawn code still reads: minor units 1234 for 12.34 (work-rows, books)', () => {
    WITHDRAWN.forEach((c) => { assert.strictEqual(minorOf(12.34, c), 1234, c); assert.strictEqual(tally.decimals(c), 2, c); });
  });
  await it('a fund or an unlisted code is refused (422), never read', () => {
    ['XDR', 'PTS', 'ZZZ'].forEach((c) => assert.throws(() => minorOf(1, c), (e) => e.code === 'MONEY_CURRENCY_UNKNOWN' && e.status === 422));
  });
  await it('the setting door refuses a withdrawn code for a new shop, in words, and an active one passes the shape check', async () => {
    for (const c of WITHDRAWN) {
      const refusal = await gov.currencyRefusal('no-such-entity', c);
      assert.ok(refusal && refusal.code === 'CURRENCY_NOT_ALLOWED' && /withdrawn from ISO 4217/.test(refusal.message), c);
    }
    const fund = await gov.currencyRefusal('no-such-entity', 'XDR');
    assert.ok(fund && !/withdrawn/.test(fund.message));
  });
  await it('fx-rates refuses a new rate in a withdrawn code in words, and in a fund', () => {
    const why = fx.rowOf({ date: '2026-11-01', from: 'BGN', to: 'INR', rate: '45.1' }, 'INR', 'manual');
    assert.ok(why.why && /withdrawn/.test(why.why));
    assert.ok(fx.rowOf({ date: '2026-11-01', from: 'XDR', to: 'INR', rate: '110' }, 'INR', 'manual').why);
    assert.ok(fx.rowOf({ date: '2026-11-01', from: 'USD', to: 'INR', rate: '83.2' }, 'INR', 'manual').row);
  });
  await it('every new-money door in the value type refuses a withdrawn code with withdrawn: true', () => {
    WITHDRAWN.forEach((c) => [() => money.make(5, c), () => money.refuseNewCurrency(c), () => money.makeMinor(100, c)].forEach((call) => assert.throws(call, (e) => e.code === 'MONEY_CURRENCY_UNKNOWN' && e.withdrawn === true)));
  });
  await it('both vendored copies of money answer the same on the withdrawn list', () => {
    assert.deepStrictEqual(Object.keys(money.WITHDRAWN_4217), Object.keys(tally.WITHDRAWN_4217));
  });
  console.log('\n  ' + checks + ' checks');
})().catch((e) => { console.error(e); process.exit(1); });
