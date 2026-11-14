/**
 * tests/cur1-money-adopt.test.cjs · the api's adopted money.js is the CUR-1 value type (ISO 4217, strict, refusing a mismatch)
 *
 * OWNS: the answers the api depends on after the money pin moved from 1.0.0 to v1.89.0 (CUR-1 slice 1 reaches the api).
 * CALLED BY: scripts/guards.cjs (node tests/cur1-money-adopt.test.cjs). No network, no DB.
 * FLOW: money value type, every path; the tally-connector copy is the same file and must answer the same.
 * BREAK CASE: on money 1.0.0 the points case (PTS made), the unlisted case (ZZZ answered 2) and the HUF exponent (0) all fail, so
 * the test goes red if the pin moves back or an adopted copy is edited by hand.
 */
'use strict';
const assert = require('assert');

let checks = 0;
function it(what, body) {
  body();
  checks += 1;
  console.log('  ok  ' + what);
}

function refuses(body, code, status) {
  assert.throws(body, (error) => error && error.code === code && error.status === status, 'expected ' + code + ' (' + status + ')');
}

const COPIES = { 'lib/money.js': require('../lib/money'), 'tools/tally-connector/money.js': require('../tools/tally-connector/money') };

Object.keys(COPIES).forEach((name) => {
  const money = COPIES[name];
  console.log('— ' + name + ' —');

  it('the minor unit comes from the ISO 4217 list, HUF 2 by Athi decision of 11 Nov (was 0 under Intl)', () => {
    const expected = { INR: 2, USD: 2, AUD: 2, AED: 2, EUR: 2, HUF: 2, JPY: 0, KWD: 3, BHD: 3 };
    Object.keys(expected).forEach((code) => assert.strictEqual(money.decimals(code), expected[code], code));
  });

  it('an unlisted code is refused with MONEY_CURRENCY_UNKNOWN (422), never answered 2', () => {
    ['ZZZ', 'PTS', 'INRR', '123'].forEach((code) => refuses(() => money.decimals(code), 'MONEY_CURRENCY_UNKNOWN', 422));
    ['ZZZ', 'PTS'].forEach((code) => refuses(() => money.exponentOf(code), 'MONEY_CURRENCY_UNKNOWN', 422));
  });

  it('a lower-case or padded listed code is read as its upper-case self (legacy callers upper-case late)', () => {
    assert.strictEqual(money.decimals('inr'), 2);
    assert.strictEqual(money.decimals(' jpy '), 0);
  });

  it('a point cannot be stamped as money: make refuses PTS, accepts a listed code (a lower-case one is read upper-case)', () => {
    refuses(() => money.make(50, 'PTS'), 'MONEY_CURRENCY_UNKNOWN', 422);
    assert.strictEqual(money.make(50, 'inr').currency, 'INR');
    assert.deepStrictEqual(money.make(50, 'INR'), { amount: 50, currency: 'INR' });
  });

  it('an operator refuses a currency mismatch loudly (409 MONEY_CURRENCY_MISMATCH), not a silent sum', () => {
    refuses(() => money.plusMoney(money.makeMinor(100, 'INR'), money.makeMinor(100, 'USD')), 'MONEY_CURRENCY_MISMATCH', 409);
    assert.strictEqual(money.plusMoney(money.makeMinor(100, 'INR'), money.makeMinor(250, 'INR')).amount_minor, 350);
  });

  it('an absent currency still takes the counted shim (slice 10 removes it), and the count moves', () => {
    money.decimalsShimReset();
    assert.strictEqual(money.decimals(null), 2);
    assert.strictEqual(money.decimalsShimCount(), 1, 'every shim answer is counted so the callers can be moved one by one');
  });
});

it('the two adopted copies carry the same ISO list', () => {
  assert.deepStrictEqual(Object.assign({}, COPIES['lib/money.js'].ISO_4217), Object.assign({}, COPIES['tools/tally-connector/money.js'].ISO_4217));
});

console.log('— the doors (critic: a strict money must answer in words, never 500) —');

it('an unlisted-currency throw from money answers 422 with its code through knownerr, a mismatch 409, and a plain error stays unknown', () => {
  const known = require('../lib/knownerr').known;
  const money = COPIES['lib/money.js'];
  let thrown;
  try { money.decimals('ZZZ'); } catch (e) { thrown = e; }
  const answer = known(thrown);
  assert.ok(answer, 'a thrown MONEY_CURRENCY_UNKNOWN is a known refusal');
  assert.strictEqual(answer.status, 422);
  assert.strictEqual(answer.body.code, 'MONEY_CURRENCY_UNKNOWN');
  try { money.plusMoney(money.makeMinor(1, 'INR'), money.makeMinor(1, 'USD')); } catch (e) { thrown = e; }
  assert.strictEqual(known(thrown).status, 409);
  assert.strictEqual(known(Object.assign(new Error('x'), { code: 'MONEY_OTHER', status: 422 })), null, 'only the two named money codes are mapped');
});

it('a rate in a currency ISO 4217 does not list is refused at the fx door (ZZZ), a listed one is kept', () => {
  const fx = require('../lib/fx-rates');
  const bad = fx.rowOf({ date: '2026-11-13', from: 'ZZZ', rate: 1.5 }, 'INR', 'manual');
  assert.ok(bad.why && !bad.row, 'ZZZ is refused with a sentence');
  const good = fx.rowOf({ date: '2026-11-13', from: 'USD', rate: 83.25 }, 'INR', 'manual');
  assert.ok(good.row && good.row.from_ccy === 'USD', 'USD is kept');
});

console.log('\n  ' + checks + ' checks\n');
