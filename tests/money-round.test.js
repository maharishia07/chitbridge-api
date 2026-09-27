'use strict';
/**
 * tests/money-round.test.js — ONE ROUNDER AND ONE READER, checked against arithmetic that cannot be wrong.
 *
 * SPEC-money-one-reader.md. The truth here is computed in INTEGERS (paise × basis points, BigInt for the large
 * cases), so the test cannot share a float mistake with the code it checks. Both old rules failed this ~6,200
 * times in 1.4 M cases; money.round must fail it zero times.
 */
const assert = require('assert'), path = require('path');
const API = path.join(__dirname, '..');
const M = require(path.join(API, 'lib', 'money'));

let pass = 0;
const it = (what, fn) => { try { fn(); pass++; console.log('  ok  ' + what); } catch (e) { console.log('  FAIL ' + what + '\n      ' + e.message); process.exitCode = 1; } };

/* half away from zero, in integers: n / d rounded to the nearest whole */
function roundDiv(n, d) { const neg = n < 0n; const a = neg ? -n : n; let q = a / d; if ((a % d) * 2n >= d) q += 1n; return neg ? -q : q; }

console.log('\n— one rounder —');

it('⭐⭐⭐ percent off, every paisa from ₹0.01 to ₹2,000, at seven common rates — 0 wrong', () => {
  let bad = 0, first = null;
  for (const pct of [5, 10, 12.5, 15, 18, 25, 33]) {
    const bp = BigInt(Math.round(pct * 100));
    for (let p = 1; p <= 200000; p++) {
      const truth = Number(roundDiv(BigInt(p) * bp, 10000n)) / 100;
      const got = M.round(p / 100 * pct / 100, 'INR');
      if (got !== truth) { bad++; if (!first) first = pct + '% of ₹' + p / 100 + ': want ' + truth + ', got ' + got; }
    }
  }
  assert.strictEqual(bad, 0, bad + ' wrong — e.g. ' + first);
});

it('⭐⭐ weight sales (price × grams) — 0 wrong', () => {
  let bad = 0, first = null;
  for (let p = 100; p <= 50000; p += 37) for (let g = 1; g <= 3000; g += 97) {
    const truth = Number(roundDiv(BigInt(p) * BigInt(g), 1000n)) / 100;
    const got = M.round((p / 100) * (g / 1000), 'INR');
    if (got !== truth) { bad++; if (!first) first = '₹' + p / 100 + ' × ' + g + 'g: want ' + truth + ', got ' + got; }
  }
  assert.strictEqual(bad, 0, bad + ' wrong — e.g. ' + first);
});

it('⭐⭐ large amounts and refunds (negative), to ₹10 crore — 0 wrong', () => {
  let seed = 7; const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  let bad = 0, first = null;
  for (let i = 0; i < 100000; i++) {
    const paise = BigInt(Math.floor(rnd() * 1e9)) * (rnd() < 0.3 ? -1n : 1n);
    const bp = BigInt(1 + Math.floor(rnd() * 9999));
    const truth = Number(roundDiv(paise * bp, 10000n)) / 100;
    const got = M.round(Number(paise) / 100 * Number(bp) / 10000, 'INR');
    if (got !== truth) { bad++; if (!first) first = String(paise) + 'p × ' + bp + 'bp: want ' + truth + ', got ' + got; }
  }
  assert.strictEqual(bad, 0, bad + ' wrong — e.g. ' + first);
});

it('⭐ D1: half goes AWAY from zero, both ways', () => {
  assert.strictEqual(M.round(0.145, 'INR'), 0.15);
  assert.strictEqual(M.round(-0.145, 'INR'), -0.15);
  assert.strictEqual(M.round(1.005, 'INR'), 1.01);          /* the classic float trap */
  assert.strictEqual(M.round(2.135, 'INR'), 2.14);          /* 5% of ₹42.70 — the EPSILON rule gave 2.13 */
  assert.ok(!Object.is(M.round(-0.001, 'INR'), -0), 'produced -0');
});

it('⭐⭐ D2: each currency to its own decimals — yen 0, rial 3, rupee 2', () => {
  assert.strictEqual(M.decimals('INR'), 2); assert.strictEqual(M.decimals('JPY'), 0);
  assert.strictEqual(M.decimals('OMR'), 3); assert.strictEqual(M.decimals('KWD'), 3);
  assert.strictEqual(M.round(1234.5, 'JPY'), 1235);
  assert.strictEqual(M.round(1.2345, 'OMR'), 1.235);
  assert.strictEqual(M.round(1.2345, 'INR'), 1.23);
  assert.strictEqual(M.round(1.235), 1.24, 'no currency must keep today\'s 2 decimals');
  assert.strictEqual(M.decimals('not a code'), 2);
});

it('⚠️ a non-number stays loud — NaN in, NaN out', () => {
  assert.ok(Number.isNaN(M.round(NaN, 'INR')));
  assert.ok(Number.isNaN(M.round('abc', 'INR')));
});

console.log('\n— one reader —');

it('⭐⭐⭐ D3: an absent price is null, NEVER 0', () => {
  for (const v of ['', '   ', null, undefined, 'abc', '12abc', NaN, Infinity, {}, { amount: '' }, { amount: null }, [], true])
    assert.strictEqual(M.priceOf(v), null, JSON.stringify(v) + ' read as ' + M.priceOf(v));
});

it('⭐⭐ every stored shape reads to the same number', () => {
  assert.strictEqual(M.priceOf(12.5), 12.5);
  assert.strictEqual(M.priceOf('12.50'), 12.5);
  assert.strictEqual(M.priceOf(' 12.50 '), 12.5);
  assert.strictEqual(M.priceOf({ amount: 12.5, currency: 'INR' }), 12.5);
  assert.strictEqual(M.priceOf({ amount: '12.50', currency: 'INR' }), 12.5, 'the review\'s case: amountOfLoose read this as NaN');
  assert.strictEqual(M.priceOf(0), 0, 'a real zero is a price — whether it may be SOLD is the caller\'s rule');
  assert.strictEqual(M.priceOf(-5), -5, 'priceOf reads; it does not validate');
});

console.log(pass + ' checks');
