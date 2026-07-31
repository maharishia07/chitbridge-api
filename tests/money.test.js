'use strict';
/**
 * money.test.js — the money type, and specifically the ways it must FAIL.
 *
 * Most of these assert a throw. That is the point: every one of them is a case that today produces a confident wrong
 * number instead — a free product, a NaN total, or INR added to AED.
 */
const assert = require('assert');
const M = require('../lib/money');

let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n        ${e.message}`); fail++; }
};
const throws = (fn, re, msg) => assert.throws(fn, (e) => re.test(e.message), msg);

console.log('\nmoney');

// ── shape ───────────────────────────────────────────────────────────────────────────────────────────────────
t('isMoney accepts a well-formed value', () => assert.ok(M.isMoney({ amount: 3290, currency: 'INR' })));
t('isMoney rejects a bare number', () => assert.ok(!M.isMoney(3290)));
t('isMoney rejects a lower-case code', () => assert.ok(!M.isMoney({ amount: 1, currency: 'inr' })));
t('isMoney rejects a 2- or 4-letter code', () => {
  assert.ok(!M.isMoney({ amount: 1, currency: 'IN' }));
  assert.ok(!M.isMoney({ amount: 1, currency: 'INRR' }));
});
t('isMoney rejects NaN and Infinity', () => {
  assert.ok(!M.isMoney({ amount: NaN, currency: 'INR' }));
  assert.ok(!M.isMoney({ amount: Infinity, currency: 'INR' }));
});

// ── make: the write-path guard ──────────────────────────────────────────────────────────────────────────────
t('make normalises the code to upper case', () => assert.strictEqual(M.make(10, ' inr ').currency, 'INR'));
t('make accepts a numeric string from a form field', () => assert.deepStrictEqual(M.make('3290', 'INR'), { amount: 3290, currency: 'INR' }));
t('make REFUSES a currency-less price', () => throws(() => M.make(3290, null), /must carry a currency/));
t('make REFUSES a bogus code rather than letting a typo travel', () => throws(() => M.make(1, 'RUPEE'), /must carry a currency/));
t('make REFUSES a non-finite amount', () => throws(() => M.make('abc', 'INR'), /finite number/));
t('make allows zero — zero is a price', () => assert.strictEqual(M.make(0, 'INR').amount, 0));
t('make allows a negative — a credit is a real amount', () => assert.strictEqual(M.make(-50, 'INR').amount, -50));

// ── read: the tolerant reader that must ship FIRST ──────────────────────────────────────────────────────────
t('read passes a money value through unchanged', () => assert.deepStrictEqual(M.read({ amount: 5, currency: 'AED' }), { amount: 5, currency: 'AED' }));
t('read accepts a legacy number when told what to assume', () => assert.deepStrictEqual(M.read(3290, { assume: 'INR' }), { amount: 3290, currency: 'INR', assumed: true }));
t('read FLAGS an assumed currency, so inferred never looks declared', () => assert.strictEqual(M.read(1, { assume: 'INR' }).assumed, true));
t('a declared currency is NOT flagged assumed', () => assert.strictEqual(M.read({ amount: 1, currency: 'INR' }).assumed, undefined));
t('read NEVER invents a currency', () => throws(() => M.read(3290), /no currency and none was supplied/));
t('read treats null/undefined/"" as NO PRICE, not as zero', () => {
  assert.strictEqual(M.read(null), null);
  assert.strictEqual(M.read(undefined), null);
  assert.strictEqual(M.read(''), null);
});
t('read REFUSES an unreadable object rather than coercing it', () => throws(() => M.read({ foo: 1 }, { assume: 'INR' }), /Unreadable price/));
t('read refuses a boolean', () => throws(() => M.read(true, { assume: 'INR' }), /Unreadable price/));

// ── the silent-zero, which is the whole reason for rule 3 ───────────────────────────────────────────────────
t('THE BUG THIS PREVENTS: `+money || 0` silently yields a FREE product', () => {
  const money = { amount: 3290, currency: 'INR' };
  assert.strictEqual(+money || 0, 0, 'if this ever stops being 0, re-read rule 3 before relaxing anything');
});
t('amountOf returns null for absent — never 0', () => assert.strictEqual(M.amountOf(null), null));
t('amountOf returns 0 for a genuine zero price', () => assert.strictEqual(M.amountOf({ amount: 0, currency: 'INR' }), 0));

// ── arithmetic ──────────────────────────────────────────────────────────────────────────────────────────────
t('times multiplies within one currency', () => assert.deepStrictEqual(M.times({ amount: 3290, currency: 'INR' }, 4), { amount: 13160, currency: 'INR' }));
t('times on no price is null, not zero', () => assert.strictEqual(M.times(null, 4), null));
t('times refuses a non-finite quantity', () => throws(() => M.times({ amount: 1, currency: 'INR' }, 'x'), /Quantity must be/));
t('round2 tames float drift', () => assert.strictEqual(M.round2(0.1 + 0.2), 0.3));

// ── sum: the latent network-order bug, made loud ────────────────────────────────────────────────────────────
t('sum totals one currency', () => assert.deepStrictEqual(
  M.sum([{ amount: 100, currency: 'INR' }, { amount: 250, currency: 'INR' }]), { amount: 350, currency: 'INR' }));
t('sum REFUSES to add INR to AED', () => throws(
  () => M.sum([{ amount: 100, currency: 'INR' }, { amount: 50, currency: 'AED' }]), /Cannot total across currencies/));
t('the refusal names both currencies, so the operator can act', () => {
  try { M.sum([{ amount: 1, currency: 'INR' }, { amount: 1, currency: 'AED' }]); assert.fail('should throw'); }
  catch (e) { assert.deepStrictEqual(e.currencies, ['INR', 'AED']); assert.strictEqual(e.status, 409); }
});
t('sum skips absent prices without treating them as zero', () => assert.deepStrictEqual(
  M.sum([{ amount: 100, currency: 'INR' }, null, { amount: 50, currency: 'INR' }]), { amount: 150, currency: 'INR' }));
t('an empty list has NO currency, so it yields null not a fake zero', () => assert.strictEqual(M.sum([]), null));
t('an empty list yields zero only when the caller states the currency', () => assert.deepStrictEqual(
  M.sum([], { empty: 'INR' }), { amount: 0, currency: 'INR' }));
t('assertSameCurrency blocks a cross-currency comparison', () => throws(
  () => M.assertSameCurrency({ amount: 1, currency: 'INR' }, { amount: 1, currency: 'USD' }, 'proposal vs list price'),
  /cannot be combined/));

// ── display ─────────────────────────────────────────────────────────────────────────────────────────────────
t('format emits the CODE, never a guessed symbol', () => assert.strictEqual(M.format({ amount: 3290, currency: 'INR' }), 'INR 3,290'));
t('format of no price is null, so a caller cannot print "0"', () => assert.strictEqual(M.format(null), null));

// ── summarise: three legitimate modes, and no way to express the wrong one ──────────────────────────────────
const ROWS = [
  { value: 329000, currency: 'INR' },
  { value: 4100,   currency: 'USD' },
  { value: 15200,  currency: 'AED' },
  { value: null,   currency: 'AED' },   // an offer nobody has agreed
  { value: null,   currency: null  },   // a help desk ticket
];
t('summarise splits into one row per currency', () => {
  const s = M.summarise(ROWS);
  assert.strictEqual(s.by_currency.length, 3);
  assert.deepStrictEqual(s.by_currency.map((b) => b.currency), ['INR', 'AED', 'USD']);   // by size
});
t('summarise flags that the currencies are mixed — "abruptly say so"', () => assert.strictEqual(M.summarise(ROWS).mixed, true));
t('summarise offers NO cross-currency total — the wrong answer is unavailable, not discouraged', () => {
  assert.strictEqual(M.summarise(ROWS).total, null);
  assert.ok(!Object.keys(M.summarise(ROWS)).some((k) => /grand|combined|overall/i.test(k)));
});
t('a SINGLE currency does get one total — the common case stays simple', () => {
  const s = M.summarise([{ value: 100, currency: 'INR' }, { value: 50, currency: 'INR' }]);
  assert.strictEqual(s.mixed, false);
  assert.deepStrictEqual(s.total, { currency: 'INR', total: 150, chits: 2 });
});
t('summarise states what it excluded rather than hiding it', () => {
  assert.deepStrictEqual(M.summarise(ROWS).excluded, { non_monetary: 1, awaiting_agreement: 1 });
});
t('the 409 tells the caller its three options instead of just blocking', () => {
  try { M.sum([{ amount: 1, currency: 'INR' }, { amount: 1, currency: 'USD' }]); assert.fail('should throw'); }
  catch (e) {
    assert.deepStrictEqual(e.options, ['split_by_currency', 'total_product_only', 'convert_to_reporting_currency']);
    assert.match(e.message, /group by currency/);
    assert.match(e.message, /total the PRODUCT/);
    assert.match(e.message, /reporting currency/);
  }
});

// ── the invariant ───────────────────────────────────────────────────────────────────────────────────────────
t('the module exposes NO conversion of any kind', () => {
  const names = Object.keys(M).join(' ').toLowerCase();
  assert.ok(!/convert|rate|fx|exchange/.test(names), 'an amount is labelled, never converted');
});
t('and none is hidden in the source', () => {
  const src = require('fs').readFileSync(require.resolve('../lib/money'), 'utf8');
  const code = src.split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n');
  assert.ok(!/\brates?\s*\[|\bconvert\s*\(/.test(code), 'no rate table, no convert()');
});

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
