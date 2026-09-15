/**
 * ── ⭐⭐ THE CONVERSION ENGINE — currency, and what a quantity is worth ─────────────────────────────────────────
 *
 * Athi, 2026-09-15: *"a conversion lab, reading data from a chit or a catalogue, convert to another currency,
 * and also read the qty and provide value according to current value, bullion market or commodity market."*
 *
 * ⚠️ NO DATABASE, NO NETWORK, NO CHIT. The engine is handed lines and rates; where they came from is the
 * caller's business. That is what makes it an asset rather than a feature.
 */
const assert = require('assert');
const cv = require('../lib/convert');
const money = require('../lib/money');

let pass = 0, fail = 0;
const ok = (name, fn) => { try { fn(); pass++; console.log('   ok   ' + name); }
  catch (e) { fail++; console.log('   FAIL ' + name + '\n          ' + e.message); } };

console.log('\n══ CONVERSION — a rate is evidence, not a number ══\n');

const RATES = cv.table([
  cv.rate('INR', 'AED', 0.043, { as_of: '2026-09-15', source: 'RBI reference', provenance: 'published' }),
  cv.rate('USD', 'INR', 88.20,  { as_of: '2026-09-15', source: 'RBI reference', provenance: 'published' }),
]);

/* ── § 1 · A RATE CARRIES ITS EVIDENCE ─────────────────────────────────────────────────────────────────────── */
ok('a rate records where it came from and when', () => {
  const r = cv.rate('INR', 'AED', 0.043, { as_of: '2026-09-15', source: 'RBI', provenance: 'published' });
  assert.strictEqual(r.provenance, 'published');
  assert.strictEqual(r.as_of, '2026-09-15');
});

ok('⚠️ an undated rate is recorded as undated, never as "now"', () => {
  const r = cv.rate('INR', 'AED', 0.043, {});
  assert.strictEqual(r.as_of, null, 'dating it with the moment the code ran would be inventing evidence');
  assert.strictEqual(r.provenance, 'unknown');
});

ok('a rate that is not a positive number is refused', () => {
  for (const bad of [0, -1, 'x', null, undefined, NaN, Infinity]) {
    assert.throws(() => cv.rate('INR', 'AED', bad), /positive number|must say/);
  }
});

/* ── § 2 · CURRENCY ────────────────────────────────────────────────────────────────────────────────────────── */
ok('₹1,000 becomes AED 43', () => {
  const r = cv.convertMoney(money.make(1000, 'INR'), 'AED', RATES);
  assert.strictEqual(r.ok, true, r.why);
  assert.strictEqual(money.amountOf(r.amount), 43);
  assert.strictEqual(money.currencyOf(r.amount), 'AED');
});

ok('the workings say which rate was used and on whose word', () => {
  const r = cv.convertMoney(money.make(1000, 'INR'), 'AED', RATES);
  const w = r.workings[0];
  assert.strictEqual(w.source, 'RBI reference');
  assert.strictEqual(w.provenance, 'published');
  assert.ok(/1000 INR × 0.043 = 43 AED/.test(w.say), w.say);
});

ok('the same currency is a no-op, not a rate lookup', () => {
  const r = cv.convertMoney(money.make(1000, 'INR'), 'INR', cv.table([]));
  assert.strictEqual(r.ok, true);
  assert.strictEqual(money.amountOf(r.amount), 1000);
});

ok('⚠️ a missing rate is an ANSWER, not an exception', () => {
  const r = cv.convertMoney(money.make(1000, 'INR'), 'JPY', RATES);
  assert.strictEqual(r.ok, false);
  assert.ok(/no rate from INR to JPY/.test(r.why), r.why);
});

ok('⚠️ it will NOT invert a rate unless told it may', () => {
  const off = cv.convertMoney(money.make(100, 'INR'), 'USD', RATES);
  assert.strictEqual(off.ok, false, 'a bank’s buy and sell are not reciprocal');
  const on = cv.convertMoney(money.make(8820, 'INR'), 'USD', RATES, { invert: true });
  assert.strictEqual(on.ok, true, on.why);
  assert.strictEqual(money.amountOf(on.amount), 100);
  assert.strictEqual(on.workings[0].inverted, true, 'and it must SAY it inverted');
  /* ⚠️ AND SAY IT AS A DIVISION BY THE RATE ON THE SHEET. It first printed `× 0.011337868480725623`, which is
     true and impossible for anybody to check — the workings exist to be checked, so they quote the held rate. */
  assert.strictEqual(on.workings[0].held_rate, 88.20);
  assert.ok(/8820 INR ÷ 88.2 = 100 USD/.test(on.workings[0].say), on.workings[0].say);
  assert.ok(!/0\.0113/.test(on.workings[0].say), 'never the reciprocal as a decimal — nobody can verify it');
});

/* ── § 3 · WHAT A QUANTITY IS WORTH ────────────────────────────────────────────────────────────────────────── */
const GOLD = { per_unit: 'gram', price: money.make(78.5, 'USD'),
               as_of: '2026-09-15T09:00:00Z', source: 'LBMA pm', provenance: 'published' };

ok('12 grams of gold, in dollars', () => {
  const v = cv.valueOf({ qty: 12, unit: 'gram' }, GOLD, RATES);
  assert.strictEqual(v.ok, true, v.why);
  assert.strictEqual(money.amountOf(v.amount), 942);
});

ok('…and the same 12 grams in rupees — two steps, both shown', () => {
  const v = cv.valueOf({ qty: 12, unit: 'gram' }, GOLD, RATES, { to: 'INR' });
  assert.strictEqual(v.ok, true, v.why);
  assert.strictEqual(money.currencyOf(v.amount), 'INR');
  assert.strictEqual(v.workings.length, 2, 'a market step and a currency step');
  assert.strictEqual(v.workings[0].step, 'market');
  assert.strictEqual(v.workings[1].step, 'currency');
  assert.strictEqual(money.amountOf(v.amount), cv.round(12 * 78.5 * 88.20, 2));
});

ok('⚠️ kilograms priced per gram is REFUSED, not multiplied by a guess', () => {
  const v = cv.valueOf({ qty: 12, unit: 'kg' }, GOLD, RATES);
  assert.strictEqual(v.ok, false);
  assert.ok(/will not invent/.test(v.why), v.why);
  /* 12 kg valued as 12 g is wrong by a thousand; valued with a guessed factor it is wrong and confident */
});

/* ⚠️ THE CANONICAL UNIT IS `gram`, NOT `g` — `unitOf('g')` is null, because `g` is not in the table at all.
   My first draft assumed the symbol and units.js was right to refuse it. The alias list holds kg/kilogram/
   கிலோ but no bare `g`; whether it should is a deliberate decision about a VENDORED table (app/units.js and
   the connector's UN/ECE mapping both follow it), so it is in the backlog rather than slipped in here. */
ok('a spelling of the same unit is fine', () => {
  const v = cv.valueOf({ qty: 12, unit: 'grams' }, GOLD, RATES);
  assert.strictEqual(v.ok, true, v.why);
});

/* ── § 4 · A BASKET, FROM ANYWHERE ─────────────────────────────────────────────────────────────────────────── */
const PRICES = {
  gold:   GOLD,
  silver: { per_unit: 'gram', price: money.make(0.95, 'USD'), as_of: '2026-09-15', source: 'LBMA', provenance: 'published' },
};

ok('a basket totals, in one currency', () => {
  const r = cv.valueLines(
    [{ item_id: 'gold', qty: 10, unit: 'gram' }, { item_id: 'silver', qty: 100, unit: 'gram' }],
    PRICES, RATES, { to: 'USD' });
  assert.strictEqual(r.ok, true, r.why);
  assert.strictEqual(money.amountOf(r.total), cv.round(10 * 78.5 + 100 * 0.95, 2));
});

ok('⚠️ a line it cannot value does NOT vanish from the total', () => {
  const r = cv.valueLines(
    [{ item_id: 'gold', qty: 10, unit: 'gram' }, { item_id: 'platinum', qty: 5, unit: 'gram' }],
    PRICES, RATES, { to: 'USD' });
  assert.strictEqual(r.ok, false, 'a total that silently skipped a line is worse than no total');
  assert.strictEqual(r.refused.length, 1);
  assert.ok(/no market price for platinum/.test(r.refused[0].why), r.refused[0].why);
  assert.ok(/1 of 2 lines valued/.test(r.why), r.why);
});

/* ── § 5 · LINES THAT ALREADY CARRY A PRICE — the catalogue and the chit ───────────────────────────────────── */
ok('a priced basket, read in another currency', () => {
  const r = cv.convertLines(
    [{ item_id: 'rice', qty: 2, price: money.make(500, 'INR') },
     { item_id: 'oil',  qty: 1, price: money.make(250, 'INR') }],
    'AED', RATES);
  assert.strictEqual(r.ok, true, r.why);
  assert.strictEqual(money.amountOf(r.total), cv.round(1000 * 0.043, 2) + cv.round(250 * 0.043, 2));
  assert.strictEqual(money.currencyOf(r.total), 'AED');
});

ok('the quantity step is shown before the currency step', () => {
  const r = cv.convertLines([{ item_id: 'rice', qty: 2, price: money.make(500, 'INR') }], 'AED', RATES);
  const w = r.priced[0].workings;
  assert.strictEqual(w[0].step, 'line');
  assert.ok(/2 × 500 INR = 1000 INR/.test(w[0].say), w[0].say);
  assert.strictEqual(w[1].step, 'currency');
});

ok('a missing quantity means one, not none', () => {
  const r = cv.convertLines([{ item_id: 'rice', price: money.make(500, 'INR') }], 'INR', RATES);
  assert.strictEqual(money.amountOf(r.total), 500, 'no qty on a line is one of it — never zero, which hides it');
});

ok('⭐ two suppliers, two currencies, one answer', () => {
  const r = cv.convertLines(
    [{ item_id: 'a', qty: 1, price: money.make(1000, 'INR') },
     { item_id: 'b', qty: 1, price: money.make(10, 'USD') }],
    'INR', RATES, { invert: true });
  assert.strictEqual(r.ok, true, r.why);
  assert.strictEqual(money.amountOf(r.total), cv.round(1000 + 10 * 88.20, 2),
    'a basket assembled from two suppliers has two denominations — that is the question, not a fault');
});

ok('⚠️ a bare number is NOT a price', () => {
  const r = cv.convertLines([{ item_id: 'rice', qty: 2, price: 500 }], 'AED', RATES);
  assert.strictEqual(r.ok, false, 'an unlabelled number is exactly the bug money.js exists to end');
  assert.ok(/must carry its currency/.test(r.refused[0].why), r.refused[0].why);
});

ok('⚠️ and here too, a line it cannot convert does not vanish', () => {
  const r = cv.convertLines(
    [{ item_id: 'a', qty: 1, price: money.make(100, 'INR') },
     { item_id: 'b', qty: 1, price: money.make(100, 'JPY') }],
    'AED', RATES);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.refused.length, 1);
  assert.strictEqual(money.amountOf(r.total), 4.3, 'the total still reports what it COULD do, flagged not ok');
  assert.ok(/1 of 2 lines converted/.test(r.why), r.why);
});

ok('it knows nothing about chits — it is handed lines', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'lib', 'convert.js'), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/chit/i.test(code), 'the engine must not mention a chit outside its comments');
  assert.ok(!/require\('\.\.\/db'\)/.test(code), 'and must not reach for a database');
});

console.log('\n  ' + pass + ' passed, ' + fail + ' failed · ' + (pass + fail) + ' checks\n');
process.exit(fail ? 1 : 0);
