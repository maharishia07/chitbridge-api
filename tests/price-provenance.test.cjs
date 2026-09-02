/**
 * price-provenance.test.cjs — a price read from a market carries WHERE and WHEN, or it carries nothing.
 *
 * Athi, 2026-09-02: *"if it is gold bullion, then the price changes according to market rate, so how do we bring
 * it here?"*
 *
 * ⚠️⚠️ THE SCREEN STATED A RULE THE STORAGE COULD NOT KEEP. The Pricing panel has always said *"a
 * market-referenced price without a reading date is a rumour — the same rule the availability engine applies to
 * a stock figure"*, and `market-ref` and `exchange` have been offered in the registries all along. But a stamped
 * price was `{amount, currency}` and nothing else, so the reading and its date were dropped on the way in. The
 * vocabulary existed and the mechanism did not — which is the more dangerous half, because the screen reads as
 * though the promise is kept.
 *
 * ⭐ The shape mirrors `avail` — `{qty, source, as_of}` for stock, `{amount, currency, source, as_of}` for a
 * price. One rule applied twice: a number without a timestamp is not an answer.
 *
 * Run: node --test tests/price-provenance.test.cjs
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const money = require('../lib/money');

test('a market reading keeps its source and its date', () => {
  const p = money.stampPrice(
    { amount: 71450, currency: 'INR', source: 'IBJA morning fix', as_of: '2026-09-02T04:30:00Z' }, 'INR');
  assert.strictEqual(p.amount, 71450);
  assert.strictEqual(p.source, 'IBJA morning fix');
  assert.strictEqual(p.as_of, '2026-09-02T04:30:00.000Z');
});

test('⚠️ ABSENT PROVENANCE STAYS ABSENT — nothing is manufactured', () => {
  /* Stamping "now" on a number somebody typed would invent a reading that never happened, which is worse than
     no reading at all: the second is honest about what it does not know. Same reason availability.stamp()
     returns null rather than defaulting a quantity. */
  const p = money.stampPrice({ amount: 890, currency: 'INR' }, 'INR');
  assert.strictEqual(p.source, undefined);
  assert.strictEqual(p.as_of, undefined);
  assert.deepStrictEqual(Object.keys(p).sort(), ['amount', 'currency']);
});

test('a bare legacy number still stamps, and gains nothing it did not have', () => {
  const p = money.stampPrice(890, 'INR');
  assert.deepStrictEqual(p, { amount: 890, currency: 'INR' });
});

test('an unreadable date is DROPPED, not stored', () => {
  /* A malformed timestamp reads as provenance and is not one — worse than no date, because a reader believes it. */
  const p = money.stampPrice({ amount: 100, currency: 'INR', source: 'x', as_of: 'not-a-date' }, 'INR');
  assert.strictEqual(p.as_of, undefined);
  assert.strictEqual(p.source, 'x');
});

test('an empty source is not a source', () => {
  const p = money.stampPrice({ amount: 100, currency: 'INR', source: '   ' }, 'INR');
  assert.strictEqual(p.source, undefined);
});

test('⭐ the currency guard is untouched — provenance cannot smuggle a currency past it', () => {
  /* The spoofing guard is the reason stampPrice exists. Adding fields to the shape must not weaken it. */
  assert.throws(
    () => money.stampPrice({ amount: 5, currency: 'USD', source: 'somewhere' }, 'INR'),
    /priced in INR/);
});

test('and it round-trips: stamping a stamped price changes nothing', () => {
  /* ⚠️ The round-trip is a real path — read an item, change the name, write it back. It broke once before, when
     validateItem ran String() over a money object and got "[object Object]". */
  const once = money.stampPrice({ amount: 71450, currency: 'INR', source: 'LBMA PM', as_of: '2026-09-01T15:00:00Z' }, 'INR');
  const twice = money.stampPrice(once, 'INR');
  assert.deepStrictEqual(twice, once);
});
