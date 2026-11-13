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
  await it('the one currency lock door (save, PATCH profile, network-build) refuses a NEW withdrawn money, and lets a shop re-send the one it holds', async () => {
    const cs = require('../lib/country-setup');
    const shop = (currency) => ({ currency, constituted: false, country: { code: 'IN' } });
    await assert.rejects(() => cs.currencyLockRefusal({}, 'e', 'BGN', { cur: shop('INR') }), (e) => e.code === 'MONEY_CURRENCY_UNKNOWN' && e.withdrawn === true);
    assert.strictEqual(await cs.currencyLockRefusal({}, 'e', 'BGN', { cur: shop('BGN') }), null, 'the held code is no change');
    assert.strictEqual(cs.guessOf({ country: 'BG', currency_code: 'BGN', timezone: 'Europe/Sofia' }).currency, null, 'a guess is never a withdrawn money');
  });
  await it('a shop whose own money is withdrawn issues no NEW document; the words name the successor and nothing is converted (the one document gate)', () => {
    const cs = require('../lib/country-setup');
    const want = { HRK: 'EUR', BGN: 'EUR', CUC: 'CUP', SLL: 'SLE', ZWL: 'ZWG' };
    Object.keys(want).forEach((c) => {
      const refusal = cs.documentRefusal({ country: 'IN', currency_code: c });
      assert.ok(refusal && refusal.status === 422 && refusal.code === 'NO_MONEY', c);
      assert.ok(refusal.message.indexOf('replaced by ' + want[c]) >= 0 && /nothing is converted/.test(refusal.message), c);
    });
    assert.strictEqual(cs.documentRefusal({ country: 'DE', currency_code: 'EUR' }), null);
    assert.strictEqual(cs.activeCurrency('hrk'), null);
    assert.strictEqual(cs.activeCurrency('eur'), 'EUR');
  });
  await it('every stored-money reader the api has reads an old BGN record (stored opt-in), and new BGN money is still refused', () => {
    const old = { amount: 12.5, currency: 'BGN' };
    const conv = require('../lib/convert');
    const rates = conv.table([{ from: 'BGN', to: 'EUR', rate: 0.5, as_of: '2025-12-31', source: 'official' }]);
    assert.strictEqual(conv.convertMoney(old, 'EUR', rates).amount.amount, 6.25, 'convert (reprice, capture, reports)');
    assert.strictEqual(money.amountOf(old, { stored: true }), 12.5, 'capture, reprice, chits items, products supplies');
    assert.strictEqual(money.currencyOf(old, { stored: true }), 'BGN', 'chits items, capture, reprice');
    assert.strictEqual(money.isMoney(old, { stored: true }), true, 'catalogue-blueprint, network-design');
    assert.deepStrictEqual(money.sum([old, old], { stored: true }), { amount: 25, currency: 'BGN' }, 'catalogue network price check');
    assert.strictEqual(money.isMoney(old), false);
    assert.throws(() => money.amountOf(old), (e) => e.code === 'MONEY_CURRENCY_UNKNOWN');
    assert.throws(() => money.make(1, 'BGN'), (e) => e.withdrawn === true);
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
