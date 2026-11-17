'use strict';
/**
 * offers-promise.test.cjs — what a ROW may advertise, before anything is in a cart.
 *
 * Athi, 2026-09-02: *"discount and offers need to be expressed i guess, otherwise people may not know"* and
 * *"in b2b, that is the way, the products are being pushed."*
 *
 * ⚠️⚠️ THE LOAD-BEARING TESTS HERE ARE THE ONES ABOUT NOT PROMISING. A badge is a commitment: a row that says
 * "10% off" while the basket declines to give it is worse than a row that said nothing at all — the first is a
 * broken promise, the second is merely quiet. So most of this file asserts silence.
 *
 * Run: node e2e/offers-promise.test.cjs
 */
const assert = require('assert');
const { CBOffers: O } = require('../public/engine/offers.js');

let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); console.log('  ✓ ' + name); pass++; }
  catch (e) { console.log('  ✗ ' + name + '\n      ' + e.message); fail++; }
};

const NOW = new Date('2026-09-03T00:00:00Z');
const CTX = { now: NOW, money: (n) => '₹' + n };

console.log('\noffers · the promise states its condition');

t('a plain percentage needs no condition', () => {
  assert.strictEqual(O.promise({ kind: 'percent_off', percent: 10 }, CTX), '10% off');
});

t('⭐⭐ A QUANTITY BREAK CARRIES ITS THRESHOLD — "₹170 each" alone would be a lie', () => {
  /* The row shows ₹180. A badge reading "₹170 each" would be read as the price for one. */
  const p = O.promise({ kind: 'tier_price', tiers: [{ qty: 10, price: 170 }, { qty: 50, price: 160 }] }, CTX);
  assert.ok(/from 10/.test(p), 'the quantity that unlocks it must be in the sentence: ' + p);
  assert.ok(/170/.test(p));
});

t('⭐ an order threshold says what the order must reach', () => {
  const p = O.promise({ kind: 'threshold', min_subtotal: 5000, percent: 5 }, CTX);
  assert.ok(/5% off/.test(p) && /5000/.test(p), p);
});

t('buy-x-get-y reads the way a shopper says it', () => {
  assert.strictEqual(O.promise({ kind: 'buy_x_get_y', buy: 2, get: 1 }, CTX), 'Buy 2 get 1 free');
});

console.log('\noffers · when a row must stay silent');

t('⚠️ an EXPIRED offer promises nothing', () => {
  assert.strictEqual(O.promise({ kind: 'percent_off', percent: 10, valid_to: '2026-08-01' }, CTX), null);
});

t('⚠️ an offer that has NOT STARTED promises nothing', () => {
  assert.strictEqual(O.promise({ kind: 'percent_off', percent: 10, valid_from: '2027-01-01' }, CTX), null);
});

t('⚠️ an offer for another region promises nothing here', () => {
  const ctx = Object.assign({ region: 'IN' }, CTX);
  assert.strictEqual(O.promise({ kind: 'percent_off', percent: 10, region: 'AE' }, ctx), null);
});

t('⚠️ FREE SHIPPING IS NOT A PRODUCT PROMISE — one line cannot deliver an order-level benefit', () => {
  assert.strictEqual(O.promise({ kind: 'shipping', amount: 0 }, CTX), null);
});

t('a percentage of nothing is not an offer', () => {
  assert.strictEqual(O.promise({ kind: 'percent_off', percent: 0 }, CTX), null);
  assert.strictEqual(O.promise({ kind: 'amount_off', amount: 0 }, CTX), null);
});

t('the validity gate is the SAME one evaluate uses', () => {
  /* Two copies of "is this live?" is how a badge and a basket disagree on one screen. If evaluate skips it,
     promise must be silent about it. */
  const o = { id: 'x', kind: 'percent_off', percent: 10, valid_to: '2026-08-01', label: 'Old' };
  const ev = O.evaluate({ lines: [{ key: '0', item_id: 'a', qty: 1, unitPrice: 100 }], offers: [o],
    now: NOW, money: CTX.money });
  assert.strictEqual(ev.adjustments.length, 0, 'the basket refuses it');
  assert.strictEqual(O.promise(o, CTX), null, 'so the row must not advertise it');
});

console.log('\noffers · which rows may advertise which offer');

const OFFERS = [
  { id: 'o1', kind: 'percent_off', percent: 10, applies_to: { category: 'grains' } },
  { id: 'o2', kind: 'tier_price', tiers: [{ qty: 10, price: 170 }] },
];

t('a targeted offer reaches the rows it names', () => {
  const got = O.forLine({ item_id: 'a', categories: ['grains'], unitPrice: 180 }, OFFERS, CTX);
  assert.deepStrictEqual(got.map((x) => x.offer_id).sort(), ['o1', 'o2']);
});

t('⚠️⚠️ AN UNCLASSIFIED PRODUCT DOES NOT INHERIT A TARGETED OFFER — it fails CLOSED', () => {
  /* An offer aimed at Grains must never fall back to "applies to everything" on a product nobody classified.
     That would be a discount nobody agreed to, appearing on the storefront. */
  const got = O.forLine({ item_id: 'b', unitPrice: 180 }, OFFERS, CTX);
  assert.deepStrictEqual(got.map((x) => x.offer_id), ['o2']);
});

t('a row in another category gets only the untargeted offer', () => {
  const got = O.forLine({ item_id: 'c', categories: ['spices'], unitPrice: 180 }, OFFERS, CTX);
  assert.deepStrictEqual(got.map((x) => x.offer_id), ['o2']);
});

t('onOffer agrees with forLine, because it IS forLine', () => {
  assert.strictEqual(O.onOffer({ item_id: 'a', categories: ['grains'], unitPrice: 180 }, OFFERS, CTX), true);
  assert.strictEqual(O.onOffer({ item_id: 'z', unitPrice: 180 }, [OFFERS[0]], CTX), false);
});

t('an expired offer puts no badge on any row', () => {
  const dead = [{ id: 'd', kind: 'percent_off', percent: 25, valid_to: '2026-01-01' }];
  assert.deepStrictEqual(O.forLine({ item_id: 'a', unitPrice: 100 }, dead, CTX), []);
});

console.log('\noffers · a different product as the reward');

const RICE = { id: 'r1', kind: 'buy_x_get_y', label: 'Rice to oil', buy: 3, get: 1,
  applies_to: { item_ids: ['rice'] }, get_item_id: 'oil', get_item_name: 'Sunflower Oil 1L' };
const run = (lines) => O.evaluate({ lines, offers: [RICE], now: NOW, money: CTX.money });

t('⭐ the promise NAMES the reward — "Buy 3 get 1 free" beside rice reads as a fourth bag', () => {
  assert.strictEqual(O.promise(RICE, CTX), 'Buy 3 get 1 Sunflower Oil 1L free');
});

/**
 * ⚠️⚠️ THE DECISION THIS TEST PINS IS NOT TECHNICAL. The obvious implementation puts the oil in the basket at
 * zero. On this rail a cart becomes a CHIT, and a chit is what two parties AGREED — so a line the customer never
 * chose must not arrive inside one. Earned-but-unclaimed is reported, never inserted.
 */
t('⭐⭐ EARNED BUT NOT IN THE BASKET IS A NOTE, and the engine adds NO line', () => {
  const r = run([{ key: '0', item_id: 'rice', qty: 3, unitPrice: 620 }]);
  assert.strictEqual(r.adjustments.length, 0, 'nothing is discounted, because nothing was chosen');
  assert.strictEqual(r.notes.length, 1);
  assert.ok(/earned 1 . Sunflower Oil/.test(r.notes[0].why), r.notes[0].why);
  assert.strictEqual(r.notes[0].target, 'oil', 'the id travels, so a screen can offer to add it in one press');
});

t('the reward IS in the basket, so it is discounted', () => {
  const r = run([{ key: '0', item_id: 'rice', qty: 3, unitPrice: 620 },
                 { key: '1', item_id: 'oil', qty: 1, unitPrice: 132 }]);
  assert.strictEqual(r.adjustments.length, 1);
  assert.strictEqual(r.adjustments[0].amount, -132, 'free means the whole line');
  assert.strictEqual(r.notes.length, 0);
});

t('⭐ EARNED 2, HOLDING 1 — one discounted AND the other still reported', () => {
  const r = run([{ key: '0', item_id: 'rice', qty: 6, unitPrice: 620 },
                 { key: '1', item_id: 'oil', qty: 1, unitPrice: 132 }]);
  assert.strictEqual(r.adjustments.length, 1, 'the one they hold');
  assert.strictEqual(r.notes.length, 1, 'and the one they have not claimed');
});

t('below the threshold earns nothing and says nothing', () => {
  const r = run([{ key: '0', item_id: 'rice', qty: 2, unitPrice: 620 }]);
  assert.strictEqual(r.adjustments.length, 0);
  assert.strictEqual(r.notes.length, 0);
});

t('⚠️ the same-item form is UNCHANGED — no get_item_id, cheapest eligible unit still goes free', () => {
  const same = { id: 's1', kind: 'buy_x_get_y', buy: 2, get: 1 };
  const r = O.evaluate({ lines: [{ key: '0', item_id: 'a', qty: 3, unitPrice: 100 }],
    offers: [same], now: NOW, money: CTX.money });
  assert.strictEqual(r.adjustments.length, 1);
  assert.strictEqual(r.adjustments[0].amount, -100);
});

console.log('\n' + (fail ? '✗ ' + fail + ' failed, ' : '✓ ') + pass + ' passed\n');
process.exit(fail ? 1 : 0);
