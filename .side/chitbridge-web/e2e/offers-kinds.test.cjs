'use strict';
/**
 * offers-kinds.test.cjs — EVERY KIND IN THE REGISTRY, on a real basket, with the rules the FORM writes.
 *
 * Athi, 2026-09-03: *"check offer effectively for each type of offers"*.
 *
 * ⚠️⚠️ WHY THIS IS NOT COVERED BY THE TWO FILES BESIDE IT. offers-promise tests promise() and offers-combined
 * tests stacking, and both were written by reading offers.js — so both fed it the keys offers.js reads. The
 * FORM writes different keys. `promise()` read `min_subtotal`; cap-definitions writes `min_amount`; the promise
 * test passed `min_subtotal` and went green, while every threshold offer a person actually authored advertised
 * nothing at all on any product row. A test that supplies the implementation's own vocabulary can only prove
 * the implementation is self-consistent.
 *
 * ⭐ SO THE RULE HERE IS: the rules in this file are the rules cbDefRuleFields() can produce, and every kind is
 * asserted three ways — the MONEY it moves, the WHY it gives for moving it, and the PROMISE it makes on a row
 * before anything is in a basket. A kind that cannot pass all three cannot be sold with.
 *
 * ⚠️ THE FIRST GUARD IS A COUNT. Adding a KIND to offers.js without a case here is the failure this file exists
 * to catch — a kind nobody exercises looks fine, because a kind that never fires looks like a kind nobody used.
 *
 * Run: node e2e/offers-kinds.test.cjs
 */
const assert = require('assert');
const { CBOffers: O } = require('../public/engine/offers.js');

let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); console.log('  ✓ ' + name); pass++; }
  catch (e) { console.log('  ✗ ' + name + '\n      ' + e.message); fail++; }
};
const sec = (s) => console.log('\n' + s);

const NOW = new Date('2026-09-03T00:00:00Z');
const money = (n) => '₹' + n;
const CTX = { now: NOW, money };

/* One basket, used by every kind: 3 × ₹100 rice (Grains) and 2 × ₹250 oil. */
const RICE = { key: '0', item_id: 'rice', sku: 'R1', categories: ['grains'], qty: 3, unitPrice: 100 };
const OIL = { key: '1', item_id: 'oil', sku: 'O1', categories: ['edible'], qty: 2, unitPrice: 250 };
const BASKET = [RICE, OIL];                                     /* subtotal 300 + 500 = 800 */

const ev = (offers, lines, extra) => O.evaluate(Object.assign(
  { lines: lines || BASKET, offers: [].concat(offers), now: NOW, money }, extra || {}));
const only = (r) => { assert.strictEqual(r.adjustments.length, 1, 'one adjustment, got ' + r.adjustments.length
  + ' · ' + JSON.stringify(r.explain)); return r.adjustments[0]; };
const kept = new Set();
const kind = (k, name, fn) => { kept.add(k); t(name, fn); };

sec('offers · every kind, with the rules the FORM writes');

kind('percent_off', '⭐ percent_off — off each line it targets, and the badge says the plain thing', () => {
  const o = { id: 'p', kind: 'percent_off', label: 'Diwali 10%', percent: 10, applies_to: { category: 'grains' } };
  const a = only(ev(o));
  assert.strictEqual(a.amount, -30, '10% of the ₹300 rice line');
  assert.strictEqual(a.target, '0', 'and it lands on that line, not the order');
  assert.strictEqual(a.why, '10% off ₹300');
  assert.strictEqual(O.promise(o, CTX), '10% off');
  assert.strictEqual(ev(o).total, 770);
});

kind('amount_off', '⭐ amount_off — a flat sum, capped at the line, and the cap is REPORTED', () => {
  const o = { id: 'a', kind: 'amount_off', label: '₹50 off', amount: 50, applies_to: { item_ids: ['rice'] } };
  assert.strictEqual(only(ev(o)).amount, -50);
  assert.strictEqual(only(ev(o)).why, '₹50 off');
  assert.strictEqual(O.promise(o, CTX), '₹50 off');
  /* ⚠️ ₹500 off a ₹300 line must not pay the customer ₹200 — and must SAY it was trimmed, or the number
     cannot be reconciled against the offer that was advertised. */
  const big = only(ev(Object.assign({}, o, { amount: 500 })));
  assert.strictEqual(big.amount, -300);
  assert.ok(/capped at the line/.test(big.why), big.why);
});

kind('tier_price', '⭐⭐ tier_price — a RE-PRICE, and the badge carries the quantity or it is a lie', () => {
  const o = { id: 't', kind: 'tier_price', label: 'Bulk rice',
              tiers: [{ qty: 3, price: 80 }, { qty: 10, price: 70 }], applies_to: { item_ids: ['rice'] } };
  const a = only(ev(o));
  assert.strictEqual(a.amount, -60, '3 × (100 − 80)');
  assert.strictEqual(a.basis, 'price', 'marked a re-price, not a discount — it is the price of record');
  /* ⭐ THE BADGE SAYS THE PERCENTAGE TOO (Athi, 2026-09-06 23:4x: *"show 15% discount applied?"*) — worked out
     from the two prices when the slab was written as a price, so the sentence reads the same either way. This
     assertion used to expect the older wording and had been red ever since. */
  assert.strictEqual(a.why, 'qty 3 reaches the 3+ tier · 20% off · ₹100 → ₹80 each');
  assert.strictEqual(O.promise(o, CTX), '₹80 each from 3 (2 price breaks)');
  /* ⚠️ NEVER SILENTLY RAISES. A tier dearer than the list price is not applied. */
  assert.strictEqual(ev(Object.assign({}, o, { tiers: [{ qty: 1, price: 500 }] })).adjustments.length, 0);
});

/**
 * ── ⭐ bundle_price — THE ONE KIND IN THE REGISTRY THAT HAD NO CASE (written 2026-09-16) ────────────────────
 *
 * The sweep at the foot of this file asserts that every kind is exercised, and it had been failing on exactly
 * one name: `bundle_price`. A kind with no case is a kind nobody has checked, and this one moves real money —
 * it re-prices a SET of products bought together and then has to spread the saving back across the lines.
 *
 * ⚠️ THE SPREAD IS THE PART WORTH TESTING. The saving is allocated in proportion to each item's price, with
 * the LAST line taking the remainder — so the shares always add up to the saving exactly, with no rounding
 * dust left over. A bundle whose parts do not sum to its own discount is the kind of thing a shopkeeper finds
 * at the counter, in front of a customer.
 */
/* ⚠️ the engine rounds to paise; so must a test that adds its answers back up */
const r2 = (n) => Math.round(n * 100) / 100;
kind('bundle_price', '⭐⭐ bundle_price — a SET re-priced, and the saving is spread so the parts add up', () => {
  const o = { id: 'b', kind: 'bundle_price', label: 'Rice + oil',
              bundle_items: ['rice', 'oil'], bundle_price: 300 };
  const r = ev(o, [RICE, OIL]);
  /* rice ₹100 + oil ₹250 = ₹350 a set; the bundle is ₹300, so ₹50 a set. Two sets fit (oil has qty 2). */
  const total = r.adjustments.reduce((t, a) => t + a.amount, 0);
  assert.strictEqual(r2(total), -100, '₹50 a set × 2 sets — the smaller quantity decides how many sets fit');
  assert.strictEqual(r.adjustments.length, 2, 'the saving lands on both lines, not in a lump on one');
  /* ⚠️ THE SHARES MUST ADD UP TO THE SAVING — the last line carries the remainder for exactly this reason */
  const byKey = {};
  r.adjustments.forEach((a) => { byKey[a.target] = r2((byKey[a.target] || 0) + a.amount); });
  assert.strictEqual(r2(byKey['0'] + byKey['1']), -100, 'no rounding dust: the parts equal the whole');

  /* ⚠️ AND IT DOES NOT FIRE HALF-BUILT. Missing a member is reported, not silently discounted. */
  const short = ev(o, [RICE]);
  assert.strictEqual(short.adjustments.length, 0, 'one item of a two-item bundle discounts nothing');
  assert.match(String(short.notes[0] && short.notes[0].why), /needs 1 more item/,
    'and it says what is missing rather than staying silent');

  /* ⚠️ A BUNDLE DEARER THAN ITS PARTS GIVES NOTHING — it must never quietly RAISE a price. */
  const dear = ev(Object.assign({}, o, { bundle_price: 9999 }), [RICE, OIL]);
  assert.strictEqual(dear.adjustments.length, 0, 'nothing to give, and nothing taken');
});

kind('threshold', '⭐⭐ threshold — spend, and the shortfall is reported when it does not fire', () => {
  const o = { id: 'th', kind: 'threshold', label: 'Over ₹500', percent: 10, min_amount: 500 };
  const a = only(ev(o));
  assert.strictEqual(a.amount, -80, '10% of the whole ₹800 order');
  assert.strictEqual(a.scope, 'cart', 'an order benefit belongs to the order, never to one line');
  assert.strictEqual(a.why, '10% off — order of ₹800 meets the ₹500 threshold');
  assert.strictEqual(O.promise(o, CTX), '10% off orders over ₹500');
  const short = ev(Object.assign({}, o, { min_amount: 1000 }));
  assert.strictEqual(short.adjustments.length, 0);
  assert.strictEqual(short.notes[0].why, 'not yet — ₹200 more needed');
  assert.strictEqual(short.notes[0].shortfall, 200, 'the number, not only the sentence');
});

kind('buy_x_get_y', '⭐⭐ buy_x_get_y — earned PER PRODUCT, never pooled across the category', () => {
  /**
   * ⚠⚠ CHANGED ON PURPOSE, 2026-09-10. Athi, looking at a counter line reading ₹0.00 for a single packet:
   * *"we cannot offer for different product."* It used to pool the category and give away the cheapest unit in
   * it, so three different biscuits earned a free one and the line holding one packet showed ₹0.00 with nothing
   * to explain it. Three of ONE thing now earns one of that thing — which costs the shop more on a mixed
   * basket, and is the intended behaviour.
   * ⭐ The cheapest-free convention moved to mix_and_match, which is tested just below.
   */
  const o = { id: 'b', kind: 'buy_x_get_y', label: 'BOGO rice', buy: 2, get: 1,
              applies_to: { item_ids: ['rice'] } };
  const a = only(ev(o));
  assert.strictEqual(a.amount, -100, 'qty 3 = one set of (2+1), one unit free');
  assert.strictEqual(a.why, '1 × free — buy 2 get 1 (1 set of this product)');
  assert.strictEqual(O.promise(o, CTX), 'Buy 2 get 1 free');
  /* ⭐ A DIFFERENT PRODUCT AS THE REWARD, which the same-item form cannot say. */
  const cross = { id: 'x', kind: 'buy_x_get_y', label: 'Rice → oil', buy: 3, get: 1,
                  get_item_id: 'oil', get_item_name: 'Sunflower Oil', applies_to: { item_ids: ['rice'] } };
  assert.strictEqual(only(ev(cross)).amount, -250, 'one oil they are holding goes free');
  assert.strictEqual(O.promise(cross, CTX), 'Buy 3 get 1 Sunflower Oil free');
});

kind('shipping', '⭐ shipping — free, flat or a percentage, and it never promises on a product row', () => {
  const free = { id: 's', kind: 'shipping', label: 'Free delivery', free: true };
  const r = ev(free, BASKET, { shipping: 80 });
  assert.strictEqual(only(r).amount, -80);
  assert.strictEqual(only(r).why, 'free shipping');
  assert.strictEqual(r.shipping, 0, 'and the order carries no delivery charge');
  assert.strictEqual(ev({ id: 's2', kind: 'shipping', label: 'Half', percent: 50 }, BASKET,
    { shipping: 80 }).adjustments[0].amount, -40);
  assert.strictEqual(only(ev({ id: 's3', kind: 'shipping', label: 'Flat ₹30', flat: 30 }, BASKET,
    { shipping: 80 })).why, 'flat shipping at ₹30');
  /* ⚠️ One line cannot deliver an order-level benefit, so a row stays silent about it. */
  assert.strictEqual(O.promise(free, CTX), null);
});

kind('price_range', '⭐ price_range — a CONSTRAINT: it reports a violation and moves no money', () => {
  const o = { id: 'r', kind: 'price_range', label: 'Rice band', min: 120, max: 200,
              applies_to: { item_ids: ['rice'] } };
  const r = ev(o);
  assert.strictEqual(r.adjustments.length, 0, 'a band never clamps a negotiated price');
  assert.strictEqual(r.notes[0].why, '₹100 is outside the seller’s band ₹120–₹200');
  assert.strictEqual(r.total, 800, 'and the order is unchanged');
  assert.strictEqual(ev(Object.assign({}, o, { min: 50 })).notes.length, 0, 'inside the band, nothing to say');
  assert.strictEqual(O.promise(o, CTX), null, 'a band is the price, not a discount off one');
});

/**
 * ⭐⭐⭐ MIX AND MATCH — and this case exists because the registry check below went red for it.
 *
 * Athi, 2026-09-10: *"in cloth line it works as per category, so possibly we need a different naming
 * convention"*, then *"cheapest free for mix and match"*. It is the POOLED kind: any N from the rail, and the
 * cheapest qualifying units are the free ones — exactly what buy_x_get_y used to do and no longer does.
 *
 * ⚠ I added the kind and did not add a case, and the "every kind is exercised" assertion is the only thing
 * that noticed. That guard earning its keep is worth more than the case itself.
 */
kind('mix_and_match', '⭐⭐ mix_and_match — pooled across the category, and the CHEAPEST units are free', () => {
  const o = { id: 'mm', kind: 'mix_and_match', label: 'Any 2 grains', buy: 1, get: 1,
              applies_to: { category: 'grains' } };
  const r = ev(o);
  assert.strictEqual(r.adjustments.length, 1, 'ONE adjustment — the pool is the unit, not the line');
  assert.ok(/cheapest qualifying unit/.test(r.adjustments[0].why),
    'the cheapest-free convention is what this kind means: ' + r.adjustments[0].why);
});

t('⚠️ EVERY KIND IN THE REGISTRY IS EXERCISED ABOVE', () => {
  const missing = O.kinds.filter((k) => !kept.has(k));
  assert.deepStrictEqual(missing, [], 'kinds with no case in this file: ' + missing.join(', '));
});

sec('offers · what the form writes vs what the engine reads');

/**
 * ⚠️⚠️ THESE ARE THE MISMATCHES THAT WERE LIVE. Each one is written with the keys cbDefRuleFields() produces,
 * because that is the only vocabulary an authored offer ever has.
 */
t('⚠️⚠️ A THRESHOLD AUTHORED ON THE FORM ADVERTISES ITSELF — promise() read a key nothing writes', () => {
  /* The form's fields are `min_amount` and `min_qty`. promise() read `min_subtotal`, so it returned null,
     forLine() dropped the offer, and the product row said the product was on no offer. */
  assert.strictEqual(O.promise({ kind: 'threshold', percent: 5, min_amount: 5000 }, CTX),
    '5% off orders over ₹5000');
  assert.strictEqual(O.promise({ kind: 'threshold', amount: 200, min_qty: 10 }, CTX),
    '₹200 off orders of 10+ items');
  assert.strictEqual(O.promise({ kind: 'threshold', percent: 5, min_subtotal: 5000 }, CTX),
    '5% off orders over ₹5000', 'the old key still reads, so nothing authored before this stops working');
});

t('⚠️⚠️ A QUANTITY THRESHOLD COUNTS ITEMS — it used to measure the SPEND against the item count', () => {
  const o = { id: 'q', kind: 'threshold', label: '5 items', percent: 10, min_qty: 5 };
  assert.strictEqual(only(ev(o)).why, '10% off — order of 5 items meets the 5-item threshold');
  /* The form offers "Spend at least" and "…or this many items" side by side, so both get filled. The old code
     took the SPEND figure and compared it to the COUNT: "197 more item(s) needed" on a ₹300 basket. */
  const both = { id: 'qb', kind: 'threshold', label: 'Either', percent: 10, min_amount: 500, min_qty: 20 };
  assert.strictEqual(only(ev(both)).why, '10% off — order of ₹800 meets the ₹500 threshold');
  const neither = ev(Object.assign({}, both, { min_amount: 2000 }));
  assert.strictEqual(neither.notes[0].why, 'not yet — ₹1200 more needed (or 15 more item(s) needed)',
    'and when neither is met, BOTH ways to close the gap are named — the form said "or"');
});

t('⚠️⚠️ A SHIPPING OFFER WITH NO TERM SAYS SO — it used to evaluate to silence', () => {
  /* The form's only shipping field is "% off shipping (blank = free)". Blank produced an offer with no free,
     no flat and no percent: it returned an empty list and was indistinguishable from one nobody triggered. */
  const r = ev({ id: 's0', kind: 'shipping', label: 'Delivery' }, BASKET, { shipping: 80 });
  assert.strictEqual(r.adjustments.length, 0);
  assert.strictEqual(r.notes.length, 1);
  assert.ok(/no shipping term stated/.test(r.notes[0].why), r.notes[0].why);
});

t('⚠️ A THRESHOLD WITH NO MINIMUM IS UNFINISHED, not "always on"', () => {
  const r = ev({ id: 'x', kind: 'threshold', label: 'Half done', percent: 10 });
  assert.strictEqual(r.adjustments.length, 0, 'it must not fire on every basket');
  assert.ok(/unfinished/.test(r.notes[0].why), r.notes[0].why);
});

sec('offers · two offers on ONE product');

const P10 = { id: 'p10', kind: 'percent_off', label: '10% off rice', percent: 10,
              applies_to: { item_ids: ['rice'] }, priority: 1 };
const A25 = { id: 'a25', kind: 'amount_off', label: '₹25 off rice', amount: 25,
              applies_to: { item_ids: ['rice'] }, priority: 2 };

t('⭐⭐ PERCENT + AMOUNT ON ONE PRODUCT BOTH LAND, and they accumulate', () => {
  const r = ev([P10, A25], [RICE]);
  assert.strictEqual(r.adjustments.length, 2, 'both fired');
  assert.strictEqual(r.goods_adjustment, -55, '30 + 25');
  assert.strictEqual(r.total, 245);
  /* ⭐ AND EACH SAYS WHY — the answer to "why ₹245 and not ₹300" six months later. */
  assert.deepStrictEqual(r.explain, ['10% off rice: 10% off ₹300', '₹25 off rice: ₹25 off']);
});

/**
 * ── ⚠️⚠️ THIS ASSERTION WAS MOVED, NOT DELETED (2026-09-16) ─────────────────────────────────────────────────
 *
 * It expected 60% + 60% to SUM to 120% and the order to be clamped at zero. That was the additive model, and
 * Athi replaced it on 2026-09-06: *"offers apply in order, each on the RUNNING amount"* — decision 1, recorded
 * in lib/offers-engine.js beside `unitNow()` and the `net` map. A percentage is now taken on what the line is
 * worth AFTER the offers already applied: ₹300 → ₹120 → ₹48.
 *
 * ⭐ THE INVARIANT THE TEST EXISTS FOR IS UNCHANGED and is still asserted here: **a discount can never turn
 * into a refund.** Under the running-amount rule a percentage approaches zero and never crosses it, and an
 * amount is capped at the line — so the floor holds by construction rather than by a clamp. The old expected
 * NUMBERS were stale; the rule they were protecting was not, so it is proved a stronger way: 100 percentages
 * in a row still cannot make the total negative.
 */
t('⚠️⚠️ STACKED DISCOUNTS RUN ON THE RUNNING AMOUNT, AND CAN NEVER BECOME A REFUND', () => {
  const a = { id: 'a', kind: 'percent_off', label: '60%', percent: 60, applies_to: { item_ids: ['rice'] }, priority: 1 };
  const b = { id: 'b', kind: 'percent_off', label: '60% again', percent: 60, applies_to: { item_ids: ['rice'] }, priority: 2 };
  const lines = [RICE];
  const r = ev([a, b], lines);
  assert.strictEqual(r.total, 48, '₹300 → 60% off → ₹120 → 60% off → ₹48 (percent on percent)');
  assert.ok(r.total >= 0, 'a negative total is not a refund');

  /* ⚠️ THE CAP IS PER LINE, and evaluate() only clamps the ORDER. perLine() is where a caller gets the capped
     figure, and it exists because four call sites were each one `Math.min` away from a −20% line. */
  const per = O.perLine(r, lines);
  assert.strictEqual(per['0'].off, 252, 'what actually came off: 180 then 72');
  assert.ok(per['0'].off <= 300, 'never more than the line was worth');
  assert.deepStrictEqual(per['0'].offers, ['a', 'b'], 'both offers are named on the line');

  /* ⭐ THE FLOOR, PROVED RATHER THAN ASSUMED — a hundred stacked percentages still cannot cross zero. */
  const many = [];
  for (let i = 0; i < 100; i++) many.push({ id: 'p' + i, kind: 'percent_off', label: '60%', percent: 60,
                                            applies_to: { item_ids: ['rice'] }, priority: i });
  const deep = ev(many, [RICE]);
  assert.ok(deep.total >= 0, 'a hundred discounts deep, and still not a refund');
  assert.ok(O.perLine(deep, [RICE])['0'].off <= 300, 'and never more than the line was worth');
});

t('⚠️ AN EXCLUSIVE OFFER FIRST STOPS THE ONE AFTER IT', () => {
  const excl = Object.assign({}, P10, { exclusive: true, priority: 1 });
  const r = ev([excl, A25], [RICE]);
  assert.strictEqual(r.adjustments.length, 1);
  assert.strictEqual(r.total, 270, 'only the 10%');
  assert.strictEqual(r.skipped[0].label, '₹25 off rice');
  assert.strictEqual(r.skipped[0].why, 'an exclusive offer already applied');
});

/**
 * ── ⚠️⚠️ AND THIS ONE ASSERTED THE OPPOSITE OF THE DECISION (moved 2026-09-16) ──────────────────────────────
 *
 * It expected a high `priority` number to push an exclusive offer SECOND, so the ₹25 would run first and both
 * would land. Athi ruled the other way on 2026-09-06 19:29, from a real case — *an exclusive 25% for one
 * customer, and the Flat 10% still applied because it ran first at order 0*. EXCLUSIVE MEANS "INSTEAD OF THE
 * OTHERS": it runs before every non-exclusive one whatever the stacking numbers say, and then stops them.
 *
 * ⭐ The intent of the test — that the ARRAY ORDER must never decide a price — is kept, and is the stronger
 * half: both orderings give the same answer. Only the claim about priority is corrected.
 */
t('⭐⭐ AN EXCLUSIVE OFFER RUNS FIRST WHATEVER ITS PRIORITY NUMBER — and the array never decides', () => {
  const excl = Object.assign({}, P10, { exclusive: true, priority: 9 });
  const r = ev([excl, A25], [RICE]);
  assert.strictEqual(r.adjustments.length, 1, 'the exclusive one ran, and stopped the other');
  assert.strictEqual(r.total, 270, 'only the 10% — priority 9 does not demote an exclusive');
  assert.strictEqual(r.skipped.length, 1, 'the ₹25 was stopped, and says why');
  assert.strictEqual(r.skipped[0].why, 'an exclusive offer already applied');
  /* ⚠️ AND THE ARRAY ORDER IS NOT THE ANSWER — the reversed array gives the same price. */
  assert.strictEqual(ev([A25, excl], [RICE]).total, 270);
});

t('⚠️ AN OFFER THAT TARGETS ANOTHER PRODUCT IS SKIPPED, and says which', () => {
  const other = { id: 'o', kind: 'percent_off', label: 'Oil 10%', percent: 10, applies_to: { item_ids: ['oil'] } };
  const r = ev([P10, other], [RICE]);
  assert.strictEqual(r.adjustments.length, 1);
  assert.strictEqual(r.skipped[0].why, 'no line qualifies');
});

t('⚠️ A CLOSED WINDOW SKIPS, and the reason names the date', () => {
  const r = ev([P10, Object.assign({}, A25, { valid_to: '2026-08-01' })], [RICE]);
  assert.strictEqual(r.total, 270);
  assert.strictEqual(r.skipped[0].why, 'expired (2026-08-01)');
  const early = ev([Object.assign({}, P10, { valid_from: '2026-12-01' })], [RICE]);
  assert.strictEqual(early.skipped[0].why, 'not started (from 2026-12-01)');
  assert.strictEqual(O.promise(Object.assign({}, P10, { valid_from: '2026-12-01' }), CTX), null,
    'and a row promises nothing it cannot honour today');
});

/**
 * ── ⭐⭐ "₹20 OFF" — OFF THE LINE, OR OFF EACH? (observation 6, division F) ──────────────────────────────────
 *
 * Athi authored "Rs 20 off cooking oil" meaning twenty off EACH tin; the engine took twenty off the LINE.
 * Neither was wrong — the form only ever said "Amount off" and never asked. `per` now carries the answer.
 *
 * ⚠️⚠️ THE DEFAULT IS ASSERTED FIRST AND DELIBERATELY. Every offer already written means a flat amount off the
 * line, and this test exists as much to stop that changing as to prove the new behaviour: repricing live offers
 * in shops that never asked would be discovered at somebody's counter.
 */
t('⭐⭐ amount_off per item multiplies by the quantity; per line does not; the default does not move', () => {
  const base = { id: 'oil', kind: 'amount_off', label: 'Rs 20 off cooking oil', amount: 20,
                 applies_to: { item_ids: ['rice'] } };
  /* RICE is 3 × ₹100 = ₹300 */
  assert.strictEqual(only(ev(base, [RICE])).amount, -20, 'the default is off the LINE, once — unchanged');
  assert.strictEqual(only(ev(Object.assign({}, base, { per: 'line' }), [RICE])).amount, -20, 'and saying so is the same');

  const each = only(ev(Object.assign({}, base, { per: 'item' }), [RICE]));
  assert.strictEqual(each.amount, -60, '3 × ₹20 — what Athi meant when he wrote it');
  assert.match(each.why, /₹20 off each/, 'and the row SAYS it is each, or the number cannot be checked');

  /* ⚠️ still capped at the line: a discount can never become a refund */
  const capped = only(ev(Object.assign({}, base, { per: 'item', amount: 500 }), [RICE]));
  assert.strictEqual(capped.amount, -300, '3 × ₹500 is capped at what the line was worth');
  assert.match(capped.why, /capped at the line value/, 'and the cap is reported, never silent');

  /* the promise on the shelf must distinguish them too, or the badge re-creates the ambiguity */
  assert.strictEqual(O.promise(Object.assign({}, base, { per: 'item' }), CTX), '₹20 off each');
  assert.strictEqual(O.promise(base, CTX), '₹20 off');
});

console.log('\n' + (fail ? '✗ ' + fail + ' failed, ' : '✓ ') + pass + ' passed\n');
process.exit(fail ? 1 : 0);
