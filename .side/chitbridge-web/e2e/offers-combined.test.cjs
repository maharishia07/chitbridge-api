'use strict';
/**
 * offers-combined.test.cjs — several offers on one basket, all the way to the minted line.
 *
 * Athi, 2026-09-03: *"try multiple combination and then see how all works together."*
 *
 * ⚠️⚠️ WHY THIS FILE EXISTS SEPARATELY FROM offers-promise. That one tests each kind ALONE. Everything expensive
 * about a promotions engine happens when two of them touch the same basket: which runs first, whether one stops
 * the rest, whether two discounts can land on one line, and — the part nothing tested at all — whether the answer
 * on screen is the answer that reaches the CHIT.
 *
 * ⭐ THE LAST STAGE IS THE POINT. `mint()` below is the compose send path in miniature: the same evaluate, the
 * same line build, the same "price stays, total falls" shape. Until 2026-09-03 the send collected offer IDS and
 * threw the adjustments away — the cart said "1 × free Sunflower Oil, ₹132 off" and the chit charged ₹132.
 *
 * Run: node e2e/offers-combined.test.cjs
 */
const assert = require('assert');
const { CBOffers: O } = require('../public/engine/offers.js');

let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); console.log('  ✓ ' + name); pass++; }
  catch (e) { console.log('  ✗ ' + name + '\n      ' + e.message); fail++; }
};

const NOW = new Date('2026-09-03T00:00:00Z');
const money = (n) => '₹' + n;

/**
 * The compose send path, in miniature — deliberately mirroring app.html submitCompose so a change there that
 * broke this shape would show up here rather than in a customer's invoice.
 */
function mint(items, offers) {
  const evLines = items.map((it, i) => ({ key: String(i), item_id: it.item_id, sku: it.sku,
    categories: it.categories || [], qty: it.qty, unitPrice: it.price }));
  const ev = O.evaluate({ lines: evLines, offers, now: NOW, money });
  /* ⚠️ CBOffers.perLine, not a loop written here. This file held the fourth hand-written copy of "accumulate
     the line-scope adjustments and cap them at the line", and the copy in app.html's SEND path had no cap. */
  const off = O.perLine(ev, evLines);
  const lines = items.map((it, i) => {
    const gross = it.qty * it.price;
    const d = (off[String(i)] || {}).off || 0;
    const row = { particulars: it.name, quantity: it.qty, price: it.price,
      total: Math.round((gross - d) * 100) / 100 };
    if (d > 0) { row.discount = d; row.freebie = (row.total === 0); }
    return row;
  });
  /* The server's calculateSummary, after the zero-is-not-absent fix. */
  const value = lines.reduce((s, l) => {
    const explicit = (l.total !== undefined && l.total !== null && String(l.total).trim() !== '');
    return s + (explicit ? parseFloat(l.total) : (l.price || 0) * (l.quantity || 0));
  }, 0);
  return { lines, value: Math.round(value * 100) / 100, notes: ev.notes.map((n) => n.why), ev };
}

const RICE = { item_id: 'rice', name: 'Rice Ponni 10kg', qty: 3, price: 620, categories: ['grain'] };
const OIL = { item_id: 'oil', name: 'Sunflower Oil 1L', qty: 1, price: 132, categories: ['oil'] };
const TEA = { item_id: 'tea', name: 'Tea 250g', qty: 4, price: 180, categories: ['bev'] };

const FREEBIE = { id: 'f1', kind: 'buy_x_get_y', label: 'Rice → free oil', buy: 3, get: 1,
  applies_to: { item_ids: ['rice'] }, get_item_id: 'oil', get_item_name: 'Sunflower Oil 1L', priority: 1 };
const TEA10 = { id: 'p1', kind: 'percent_off', label: '10% off tea', percent: 10,
  applies_to: { category: 'bev' }, priority: 2 };
const SPEND = { id: 't1', kind: 'threshold', label: '₹200 off over ₹2000', scope: 'cart',
  amount: 200, min_amount: 2000, priority: 3 };

console.log('\noffers · the freebie reaches the chit');

t('⭐⭐ OIL CHOSEN FIRST, THEN RICE — the oil line is minted at zero and marked a freebie', () => {
  /* Athi's exact scenario. Order of adding must not matter: the engine sees a basket, not a sequence. */
  const r = mint([OIL, RICE], [FREEBIE]);
  const oilLine = r.lines[0];
  assert.strictEqual(oilLine.price, 132, 'the LIST price is kept — free means nothing without it');
  assert.strictEqual(oilLine.total, 0, 'and nothing is owed for it');
  assert.strictEqual(oilLine.discount, 132);
  assert.strictEqual(oilLine.freebie, true, 'the reader is TOLD, not left to infer it from a number');
});

t('rice first, oil second — the same chit', () => {
  const a = mint([OIL, RICE], [FREEBIE]);
  const b = mint([RICE, OIL], [FREEBIE]);
  assert.strictEqual(a.value, b.value, 'the order things were added must not change the price');
  assert.strictEqual(a.value, 3 * 620);
});

t('⭐⭐ THE CHIT VALUE EXCLUDES THE FREEBIE — a zero total is a total', () => {
  /* The server coalesced `item.total || price * quantity`, so a 0 fell through to the FULL price and the freebie
     was charged in the chit's value. It was wrong only for free lines, which is why nothing caught it. */
  const r = mint([OIL, RICE], [FREEBIE]);
  assert.strictEqual(r.value, 1860, 'rice only — the oil is free');
});

console.log('\noffers · several at once');

t('⭐ a line discount and a cart discount both land, and do not fight', () => {
  const r = mint([RICE, TEA], [TEA10, SPEND]);
  const tea = r.lines[1];
  assert.strictEqual(tea.discount, 72, '10% of 720');
  assert.strictEqual(tea.total, 648);
  /* The cart-scope threshold is an ORDER adjustment: it must NOT be pushed onto a line. */
  assert.ok(r.ev.adjustments.some((a) => a.scope === 'cart'), 'the order discount is present');
  assert.strictEqual(r.lines[0].discount, undefined, 'and it did not land on the rice line');
});

t('⭐⭐ THREE OFFERS, ONE BASKET — freebie + line % + order threshold, all together', () => {
  const r = mint([OIL, RICE, TEA], [FREEBIE, TEA10, SPEND]);
  assert.strictEqual(r.lines[0].freebie, true, 'oil free');
  assert.strictEqual(r.lines[1].total, 1860, 'rice full price');
  assert.strictEqual(r.lines[2].total, 648, 'tea 10% off');
  assert.strictEqual(r.value, 2508, 'and the chit is the sum of what is owed');
});

t('⚠️ AN EXCLUSIVE OFFER STOPS THE ONES AFTER IT — and priority decides which those are', () => {
  const excl = Object.assign({}, TEA10, { exclusive: true, priority: 1 });
  const later = Object.assign({}, SPEND, { priority: 9 });
  const r = mint([RICE, TEA], [excl, later]);
  assert.ok(r.lines[1].discount > 0, 'the exclusive one applied');
  assert.ok(!r.ev.adjustments.some((a) => a.offer_id === 't1'), 'and the later one was stopped');
  assert.ok(r.ev.skipped.some((s) => /exclusive/i.test(s.why || '')), 'and it SAYS why it was skipped');
});

/**
 * ⚠️⚠️ MOVED, NOT DELETED (2026-09-16). This expected 60% + 60% to SUM to 120% and the line to clamp at zero.
 * Athi replaced that on 2026-09-06 with *"offers apply in order, each on the RUNNING amount"* — so the second
 * 60% is taken on what is left: ₹720 → ₹288 → ₹115.20.
 * ⭐ The invariant the test exists for is untouched and is asserted more strongly than before: a discount can
 * never exceed the line and a basket can never owe less than nothing — which under this rule holds by
 * construction, because a percentage of what remains approaches zero without ever crossing it.
 */
t('⚠️ two line discounts on ONE line run on the running amount, and never exceed the line', () => {
  const a = { id: 'a', kind: 'percent_off', percent: 60, applies_to: { item_ids: ['tea'] }, priority: 1 };
  const b = { id: 'b', kind: 'percent_off', percent: 60, applies_to: { item_ids: ['tea'] }, priority: 2 };
  const r = mint([TEA], [a, b]);
  assert.strictEqual(r.lines[0].total, 115.2, '₹720 → 60% → ₹288 → 60% → ₹115.20');
  assert.ok(r.lines[0].total >= 0, 'never negative');
  assert.ok(r.lines[0].discount <= 720, 'a discount cannot exceed what the line was worth');
  assert.ok(r.value >= 0, 'and a basket can never owe less than nothing');
});

console.log('\noffers · what the basket says when it cannot give');

t('⭐ earned but unclaimed is REPORTED beside the priced lines, not silently dropped', () => {
  const r = mint([RICE], [FREEBIE]);
  assert.strictEqual(r.lines.length, 1, 'the engine adds NO line the customer did not choose');
  assert.ok(r.notes.some((n) => /earned 1 . Sunflower Oil/.test(n)), JSON.stringify(r.notes));
});

t('⚠️ an offer whose window has closed changes no line and no total', () => {
  const dead = Object.assign({}, TEA10, { valid_to: '2026-01-01' });
  const r = mint([TEA], [dead]);
  assert.strictEqual(r.lines[0].total, 720);
  assert.strictEqual(r.lines[0].discount, undefined);
  assert.strictEqual(r.value, 720);
});

t('⚠️⚠️ AN UNCLASSIFIED PRODUCT IS NOT SWEPT INTO A TARGETED OFFER, even in a mixed basket', () => {
  const plain = { item_id: 'x', name: 'Unfiled thing', qty: 1, price: 500 };
  const r = mint([TEA, plain], [TEA10]);
  assert.strictEqual(r.lines[0].discount, 72, 'the targeted line got it');
  assert.strictEqual(r.lines[1].discount, undefined, 'and the unfiled one did not');
});

console.log('\noffers · the freebie is DERIVED, never owned');

/**
 * ccSyncOffers in miniature — strip what a previous pass added, evaluate, re-add.
 *
 * ⭐⭐ Athi, 2026-09-03: *"if he removes the original one, the freebie should be removed as well."* That one
 * sentence settles the whole design. A freebie is a CONSEQUENCE, not a choice — so it is re-derived from the
 * basket every time rather than added once and then owned by it. Remove-the-rice-and-the-oil-goes then falls
 * out for free instead of needing its own rule, and nothing can go stale because nothing is remembered.
 */
function sync(items, offers) {
  const kept = items.filter((i) => !i._auto_offer);
  const ev = O.evaluate({
    lines: kept.map((it, n) => ({ key: String(n), item_id: it.item_id,
      categories: it.categories || [], qty: it.qty, unitPrice: it.price })),
    offers, now: NOW, money,
  });
  /**
   * ⚠️⚠️ THE REWARD IS ADDED AT ITS REAL PRICE AND THEN DISCOUNTED TO ZERO — not added at zero.
   *
   * Adding it at 0 looks simpler and is wrong three ways at once: there is nothing for the engine to discount,
   * so the SAVING silently excludes the free item (₹72 shown while ₹204 was given); the line cannot show what it
   * would have cost, so "free" means nothing; and the auto-added line behaves differently from the same item
   * added by hand, which is two rules for one thing.
   *
   * ⭐ So: add at the catalogue price, evaluate AGAIN, and let the ordinary discount path make it free. One rule,
   * and every number agrees with every other.
   */
  const PRICES = { oil: 132, rice: 620, tea: 180 };
  const out = kept.slice();
  O.claims(ev).forEach((c) => out.push({ item_id: c.item_id, name: c.name, qty: c.qty,
    price: PRICES[c.item_id] || 0, _auto_offer: c.offer_id, _auto_label: c.label }));
  const ev2 = O.evaluate({
    lines: out.map((it, n) => ({ key: String(n), item_id: it.item_id,
      categories: it.categories || [], qty: it.qty, unitPrice: it.price })),
    offers, now: NOW, money,
  });
  return { items: out, saved: Math.round(Math.abs(ev2.goods_adjustment || 0) * 100) / 100 };
}

t('⭐⭐ THE FREEBIE IS ADDED ON ITS OWN, and the line knows it was not chosen', () => {
  const r = sync([RICE], [FREEBIE]);
  assert.strictEqual(r.items.length, 2, 'the oil arrived without being asked for');
  const oil = r.items[1];
  assert.strictEqual(oil.item_id, 'oil');
  /* ⭐ ADDED AT ITS REAL PRICE, then discounted to zero by the ordinary path — so the line can show what it
     would have cost, the saving counts it, and it behaves exactly like the same item added by hand. */
  assert.strictEqual(oil.price, 132);
  assert.ok(oil._auto_offer, 'marked — which is exactly what makes it removable again');
});

t('⭐⭐ REMOVE THE RICE AND THE OIL GOES WITH IT', () => {
  const one = sync([RICE], [FREEBIE]);
  const two = sync(one.items.filter((i) => i.item_id !== 'rice'), [FREEBIE]);
  assert.strictEqual(two.items.length, 0, 'nothing earned it, so nothing is given');
});

t('⚠️ CALLING IT TWICE IS THE SAME AS ONCE — no second free oil', () => {
  /* It is wired into every quantity keystroke, so idempotence is not a nicety. */
  const a = sync([RICE], [FREEBIE]);
  const b = sync(a.items, [FREEBIE]);
  assert.strictEqual(b.items.length, 2);
  assert.strictEqual(b.items.filter((i) => i.item_id === 'oil').length, 1);
});

t('⚠️⚠️ A LINE THE BUYER ADDED IS NEVER STRIPPED, even when it is the reward', () => {
  const r = sync([RICE, OIL], [FREEBIE]);
  const oils = r.items.filter((i) => i.item_id === 'oil');
  assert.strictEqual(oils.length, 1, 'their own line stands; no ghost line beside it');
  assert.ok(!oils[0]._auto_offer, 'and it is still THEIRS');
});

t('⭐ the saving is the number they get told', () => {
  const r = sync([RICE, TEA], [FREEBIE, TEA10]);
  assert.strictEqual(r.saved, 204, '132 oil + 72 tea');
});

t('more rice, more oil — the reward tracks what was earned', () => {
  const r = sync([Object.assign({}, RICE, { qty: 6 })], [FREEBIE]);
  assert.strictEqual(r.items[1].qty, 2, 'two sets, two free');
});

console.log('\n' + (fail ? '✗ ' + fail + ' failed, ' : '✓ ') + pass + ' passed\n');
process.exit(fail ? 1 : 0);
