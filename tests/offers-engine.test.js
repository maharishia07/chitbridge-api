'use strict';
/**
 * THE OFFER ENGINE AS A CAPABILITY — the combination matrix (Athi, 2026-09-06 19:3x: "we are trying to create an offer engine
 * exclusively; if we are mistreating, the responsibility comes to us — take it separately, create multiple combinations internally,
 * check how it works, then we can fit it anywhere").
 *
 * One scenario per rule of C:\dev\catalogue\OFFER-ENGINE-CONTRACT.md. Pure: the engine is lib/offers-engine.js (vendored from the
 * app's offers.js — the diff must be empty), no database, no browser. Every expected figure is written out by hand from the rule,
 * never copied from a run. A scenario that fails is a rule the engine breaks (fix the engine) or a rule we had wrong (fix the contract) —
 * never a number to "adjust".
 *
 * Run: node tests/offers-engine.test.js
 */
const assert = require('node:assert');
const eng = require('../lib/offers-engine').CBOffers;

let pass = 0, fail = 0;
function it(name, fn) { try { fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + String(e.message).split('\n')[0]); } }
const money = (n) => '₹' + (Math.round(n * 100) / 100).toFixed(2);
const today = new Date().toISOString().slice(0, 10), later = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10), earlier = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
const L = (key, unitPrice, qty, extra) => Object.assign({ key, item_id: key, sku: 'SKU-' + key, categories: [], excluded: [], qty, unitPrice }, extra || {});
const ev = (lines, offers, ctx) => eng.evaluate({ lines, offers, ctx: Object.assign({ now: new Date(), currency: 'INR', money }, ctx || {}) });
const sum = (res, pred) => Math.round(res.adjustments.filter(pred || (() => true)).reduce((t, a) => t + a.amount, 0) * 100) / 100;
const labels = (res) => res.adjustments.map((a) => a.label);
const skippedWhy = (res, label) => (res.skipped.find((s) => s.label === label) || {}).why || '';

console.log('\n══ OFFER ENGINE · the matrix ══\n');

console.log('— kinds, alone —');
it('percent off a line: 2 × 200 at 10% → −40, total 360', () => {
  const r = ev([L('a', 200, 2)], [{ id: 'p', label: 'Flat 10%', kind: 'percent_off', percent: 10, scope: 'line' }]);
  assert.strictEqual(sum(r), -40); assert.strictEqual(r.total, 360);
});
it('amount off a line: ₹10 off each line, capped at the line value and the cap is said', () => {
  const r = ev([L('a', 200, 1), L('b', 5, 1)], [{ id: 'm', label: '10 off', kind: 'amount_off', amount: 10, scope: 'line' }]);
  assert.strictEqual(sum(r), -15); assert.ok(/capped/.test(r.adjustments[1].why));
});
it('percent off the basket: 10% of the eligible subtotal (list value), one adjustment, scope cart', () => {
  const r = ev([L('a', 200, 1), L('b', 100, 2)], [{ id: 'c', label: 'Basket 10%', kind: 'percent_off', percent: 10, scope: 'cart' }]);
  assert.strictEqual(r.adjustments.length, 1); assert.strictEqual(r.adjustments[0].scope, 'cart'); assert.strictEqual(sum(r), -40); assert.strictEqual(r.total, 360);
});
it('amount off the basket: ₹500 off a ₹300 order gives ₹300 and says it was capped', () => {
  const r = ev([L('a', 300, 1)], [{ id: 'c', label: '500 off', kind: 'amount_off', amount: 500, scope: 'cart' }]);
  assert.strictEqual(sum(r), -300); assert.strictEqual(r.total, 0); assert.ok(/capped/.test(r.adjustments[0].why));
});
it('tier price: qty 10 reaches the 10+ tier at 150 (from 200) → −500, basis price; a tier never raises a price', () => {
  const o = { id: 't', label: 'Bulk', kind: 'tier_price', tiers: [{ qty: 10, price: 150 }, { qty: 50, price: 120 }] };
  const r = ev([L('a', 200, 10)], [o]); assert.strictEqual(sum(r), -500); assert.strictEqual(r.adjustments[0].basis, 'price');
  const r2 = ev([L('a', 100, 10)], [o]); assert.strictEqual(r2.adjustments.length, 0);
});
it('threshold not met: a note with the shortfall, no money moves', () => {
  const r = ev([L('a', 200, 1)], [{ id: 'th', label: 'Spend 500', kind: 'threshold', min_amount: 500, percent: 10 }]);
  assert.strictEqual(r.adjustments.length, 0); assert.strictEqual(r.notes.length, 1); assert.strictEqual(r.notes[0].shortfall, 300); assert.strictEqual(r.total, 200);
});
it('threshold met: 10% off the basket; a threshold with no minimum is "unfinished", not always-on', () => {
  const r = ev([L('a', 200, 3)], [{ id: 'th', label: 'Spend 500', kind: 'threshold', min_amount: 500, percent: 10 }]);
  assert.strictEqual(sum(r), -60);
  const r2 = ev([L('a', 200, 3)], [{ id: 'th2', label: 'Unfinished', kind: 'threshold', percent: 10 }]);
  assert.strictEqual(r2.adjustments.length, 0); assert.ok(/unfinished/.test(r2.notes[0].why));
});
it('threshold with a reward item: held → its line is discounted; not held → a claim the cart may add, never added by the engine', () => {
  const o = { id: 'th', label: 'Free sugar', kind: 'threshold', min_amount: 500, get_item_id: 'sugar', get_item_name: 'Sugar 1kg', get_qty: 1 };
  const r = ev([L('a', 200, 3), L('sugar', 60, 1)], [o]); assert.strictEqual(sum(r), -60); assert.strictEqual(r.adjustments[0].target, 'sugar');
  const r2 = ev([L('a', 200, 3)], [o]); assert.strictEqual(r2.adjustments.length, 0); assert.strictEqual(eng.claims(r2).length, 1); assert.strictEqual(eng.claims(r2)[0].item_id, 'sugar');
});
it('buy 2 get 1: 3 units → the cheapest unit free; 5 units → still one set; max_sets caps', () => {
  const o = { id: 'b', label: 'B2G1', kind: 'buy_x_get_y', buy: 2, get: 1 };
  assert.strictEqual(sum(ev([L('a', 100, 3)], [o])), -100);
  assert.strictEqual(sum(ev([L('a', 100, 5)], [o])), -100);
  assert.strictEqual(sum(ev([L('a', 100, 6)], [o])), -200);
  assert.strictEqual(sum(ev([L('a', 100, 6)], [Object.assign({ max_sets: 1 }, o)])), -100);
  const mixed = ev([L('a', 100, 2), L('b', 40, 1)], [o]); assert.strictEqual(mixed.adjustments[0].target, 'b');   /* the cheapest unit is the free one */
});
it('buy X get a DIFFERENT item: held → discounted; not held → a claim; the basket is never mutated', () => {
  const o = { id: 'b', label: 'Rice→Oil', kind: 'buy_x_get_y', buy: 3, get: 1, get_item_id: 'oil', get_item_name: 'Oil', applies_to: { item_ids: ['rice'] } };
  const lines = [L('rice', 80, 3), L('oil', 120, 1)]; const before = JSON.stringify(lines);
  const r = ev(lines, [o]); assert.strictEqual(sum(r), -120); assert.strictEqual(JSON.stringify(lines), before);
  const r2 = ev([L('rice', 80, 3)], [o]); assert.strictEqual(r2.adjustments.length, 0); assert.strictEqual(eng.claims(r2)[0].item_id, 'oil');
});
it('bundle: complete set → the saving lands on the set pro rata; a missing item → a note', () => {
  const o = { id: 'bd', label: 'Combo', kind: 'bundle_price', bundle_items: ['x', 'y'], bundle_price: 250 };
  const r = ev([L('x', 200, 1), L('y', 100, 1)], [o]); assert.strictEqual(sum(r), -50); assert.strictEqual(r.adjustments.length, 2);
  const r2 = ev([L('x', 200, 1)], [o]); assert.strictEqual(r2.adjustments.length, 0); assert.ok(/needs 1 more/.test(r2.notes[0].why));
});
it('shipping: free / flat / percent come off shipping only; no term → a note', () => {
  const lines = [L('a', 200, 1)];
  assert.strictEqual(ev(lines, [{ id: 's', label: 'Free ship', kind: 'shipping', free: true }], { shipping: 50 }).shipping, 0);
  assert.strictEqual(ev(lines, [{ id: 's', label: 'Flat 20', kind: 'shipping', flat: 20 }], { shipping: 50 }).shipping, 20);
  assert.strictEqual(ev(lines, [{ id: 's', label: 'Half ship', kind: 'shipping', percent: 50 }], { shipping: 50 }).shipping, 25);
  assert.ok(/no shipping term/.test(ev(lines, [{ id: 's', label: 'Blank', kind: 'shipping' }], { shipping: 50 }).notes[0].why));
});
it('price range is a constraint, not a discount: outside the band → a note, nothing moves', () => {
  const r = ev([L('a', 500, 1)], [{ id: 'pr', label: 'Band', kind: 'price_range', min: 100, max: 400 }]);
  assert.strictEqual(r.adjustments.length, 0); assert.ok(/outside/.test(r.notes[0].why)); assert.strictEqual(r.total, 500);
});

it('a quantity break by PERCENTAGE is price-independent: 10% from 5 gives ₹180 on a ₹200 product and ₹72 on an ₹80 one; the badge says the percentage until the row is known', () => {
  const o = { id: 'tp', label: 'Bulk %', kind: 'tier_price', tiers: [{ qty: 5, percent: 10 }] };
  assert.strictEqual(ev([L('a', 200, 5)], [o]).total, 900);          /* 5 × 180 */
  assert.strictEqual(ev([L('b', 80, 5)], [o]).total, 360);           /* 5 × 72 */
  assert.strictEqual(ev([L('a', 200, 4)], [o]).adjustments.length, 0);
  assert.strictEqual(eng.promise(o, { now: new Date(), money }), '10% off from 5');
  assert.strictEqual(eng.forLine({ item_id: 'a', sku: 'A', categories: [], unitPrice: 200, excluded: [] }, [o], { now: new Date(), money })[0].promise, '₹180.00 each from 5');
  assert.match(ev([L('a', 200, 5)], [o]).adjustments[0].why, /10% off · ₹200.00 → ₹180.00 each/);   /* the applied line says the percentage */
  assert.match(ev([L('a', 200, 10)], [{ id: 'tq', label: 'Bulk', kind: 'tier_price', tiers: [{ qty: 10, price: 170 }] }]).adjustments[0].why, /15% off/);   /* worked out when the slab was a price */
});

it('free shipping from an amount: below it a note says how far to go, at it the shipping goes free', () => {
  const o = { id: 'fs', label: 'Free delivery', kind: 'shipping', free: true, min_amount: 500 };
  const under = ev([L('a', 200, 2)], [o], { shipping: 60 });
  assert.strictEqual(under.shipping, 60); assert.strictEqual(under.notes.length, 1); assert.strictEqual(under.notes[0].shortfall, 100);
  const over = ev([L('a', 200, 3)], [o], { shipping: 60 }); assert.strictEqual(over.shipping, 0);
});

console.log('— stacking and exclusivity —');
it('stacking is on the RUNNING amount (industry standard): 10% then 10% on 200 → 180 → 162, not 160', () => {
  const r = ev([L('a', 200, 1)], [{ id: 'p1', label: 'A 10%', kind: 'percent_off', percent: 10, scope: 'line' }, { id: 'p2', label: 'B 10%', kind: 'percent_off', percent: 10, scope: 'line' }]);
  assert.strictEqual(r.total, 162); assert.strictEqual(r.line_net.a, 162);
});
it('at equal stacking order a percentage runs before an amount: 10% and ₹10 on 200 → 170 whichever way they are listed', () => {
  const p = { id: 'p', label: 'Flat 10%', kind: 'percent_off', percent: 10, scope: 'line' }, m = { id: 'm', label: '10 off', kind: 'amount_off', amount: 10, scope: 'line' };
  assert.strictEqual(ev([L('a', 200, 1)], [p, m]).total, 170); assert.strictEqual(ev([L('a', 200, 1)], [m, p]).total, 170);
  assert.strictEqual(ev([L('a', 200, 1)], [Object.assign({ priority: 1 }, p), Object.assign({ priority: 0 }, m)]).total, 171);   /* an explicit order is obeyed: ₹10 first, then 10% of 190 */
});
it('a basket offer is taken on the subtotal AFTER line offers, and allocated across the lines by running net', () => {
  const r = ev([L('a', 200, 1), L('b', 100, 1)], [{ id: 'p', label: 'Flat 10%', kind: 'percent_off', percent: 10, scope: 'line', applies_to: { item_ids: ['a'] } }, { id: 'c', label: 'Basket 10%', kind: 'percent_off', percent: 10, scope: 'cart' }]);
  assert.strictEqual(sum(r, (a) => a.scope === 'line'), -20);                 /* a: 200 → 180 */
  assert.strictEqual(sum(r, (a) => a.scope === 'cart'), -28);                 /* 10% of (180 + 100) */
  assert.strictEqual(r.line_net.a, 162); assert.strictEqual(r.line_net.b, 90);   /* 18 and 10 allocated by running net */
  assert.strictEqual(r.cart_shares.a[0].amount, -18); assert.strictEqual(r.cart_shares.b[0].amount, -10); assert.strictEqual(r.total, 252);
});
it('EXCLUSIVE means instead of the others: it runs first whatever the stacking numbers say, and the rest are skipped with the reason', () => {
  const r = ev([L('a', 100, 1)], [{ id: 'p', label: 'Flat 10%', kind: 'percent_off', percent: 10, scope: 'line', priority: 0 }, { id: 'x', label: 'Tier 25', kind: 'percent_off', percent: 25, scope: 'cart', exclusive: true, priority: 9 }]);
  assert.deepStrictEqual(labels(r), ['Tier 25']); assert.strictEqual(r.total, 75); assert.strictEqual(skippedWhy(r, 'Flat 10%'), 'an exclusive offer already applied');
});
it('two exclusives: the stacking order decides between them; only the first applies', () => {
  const r = ev([L('a', 100, 1)], [{ id: 'x2', label: 'Ex 2', kind: 'percent_off', percent: 20, scope: 'line', exclusive: true, priority: 2 }, { id: 'x1', label: 'Ex 1', kind: 'percent_off', percent: 5, scope: 'line', exclusive: true, priority: 1 }]);
  assert.deepStrictEqual(labels(r), ['Ex 1']); assert.strictEqual(r.total, 95);
});
it('an exclusive that does NOT fire (wrong group, expired) leaves the others in place', () => {
  const offers = [{ id: 'p', label: 'Flat 10%', kind: 'percent_off', percent: 10, scope: 'line' }, { id: 'x', label: 'Tier 25', kind: 'percent_off', percent: 25, scope: 'cart', exclusive: true, customer_group: 'tier1' }];
  const stranger = ev([L('a', 100, 1)], offers, { customer_groups: [] }); assert.deepStrictEqual(labels(stranger), ['Flat 10%']); assert.ok(/only for/.test(skippedWhy(stranger, 'Tier 25')));
  const member = ev([L('a', 100, 1)], offers, { customer_groups: ['tier1'] }); assert.deepStrictEqual(labels(member), ['Tier 25']);
});
it('the array order never matters: the sort (exclusive · stacking order · percent before amount) decides', () => {
  const a = { id: 'p', label: 'Flat 10%', kind: 'percent_off', percent: 10, scope: 'line' }, b = { id: 'm', label: '10 off', kind: 'amount_off', amount: 10, scope: 'line' }, c = { id: 'c', label: 'Basket 5%', kind: 'percent_off', percent: 5, scope: 'cart' };
  assert.strictEqual(ev([L('a', 200, 2)], [a, b, c]).total, ev([L('a', 200, 2)], [c, b, a]).total);
  assert.strictEqual(ev([L('a', 200, 2)], [a, b, c]).total, 332.5);   /* 400 → 10% → 360 → ₹10 → 350 → basket 5% of 350 = 17.50 → 332.50 */
});
it('never below zero: two ₹80 offs on ₹100 give 100 → 20 → 0 (the second capped at the running 20); percentages compound and cannot overshoot', () => {
  const lines = [L('a', 100, 1)];
  const r = ev(lines, [{ id: 'm1', label: '80 off A', kind: 'amount_off', amount: 80, scope: 'line' }, { id: 'm2', label: '80 off B', kind: 'amount_off', amount: 80, scope: 'line' }]);
  assert.strictEqual(r.total, 0); assert.strictEqual(eng.perLine(r, lines).a.off, 100); assert.ok(/capped/.test(r.adjustments[1].why));
  const p = ev(lines, [{ id: 'p1', label: '60% A', kind: 'percent_off', percent: 60, scope: 'line' }, { id: 'p2', label: '60% B', kind: 'percent_off', percent: 60, scope: 'line' }]);
  assert.strictEqual(p.total, 16); assert.strictEqual(p.line_net.a, 16);
});

console.log('— who, when, where: the gates —');
it('customer-only offers FAIL CLOSED: no groups in the context → not applied; the group → applied; the customer by id → applied', () => {
  const o = { id: 'g', label: 'Regulars', kind: 'percent_off', percent: 10, scope: 'line', customer_group: 'regular', customer_name: 'Regulars' };
  assert.strictEqual(ev([L('a', 100, 1)], [o]).adjustments.length, 0);
  assert.strictEqual(ev([L('a', 100, 1)], [o], { customer_groups: [] }).adjustments.length, 0);
  assert.strictEqual(ev([L('a', 100, 1)], [o], { customer_groups: ['new'] }).adjustments.length, 0);
  assert.strictEqual(ev([L('a', 100, 1)], [o], { customer_groups: ['regular'] }).total, 90);
  const c = { id: 'g2', label: 'Chola only', kind: 'percent_off', percent: 10, scope: 'line', customer_group: 'customer:abc' };
  assert.strictEqual(ev([L('a', 100, 1)], [c], { customer_groups: ['customer:abc', 'new'] }).total, 90);
  assert.strictEqual(ev([L('a', 100, 1)], [c], { customer_groups: ['customer:xyz'] }).total, 100);
});
it('validity: not started → skipped; expired → skipped; an end DATE lasts to the end of that day; no window → always', () => {
  const base = { id: 'v', label: 'Window', kind: 'percent_off', percent: 10, scope: 'line' };
  assert.ok(/not started/.test(skippedWhy(ev([L('a', 100, 1)], [Object.assign({ valid_from: later }, base)]), 'Window')));
  assert.ok(/expired/.test(skippedWhy(ev([L('a', 100, 1)], [Object.assign({ valid_to: earlier }, base)]), 'Window')));
  assert.strictEqual(ev([L('a', 100, 1)], [Object.assign({ valid_from: today, valid_to: today }, base)]).total, 90);
  assert.strictEqual(ev([L('a', 100, 1)], [base]).total, 90);
});
it('currency and region: a mismatch skips; an offer that names none applies everywhere', () => {
  const o = { id: 'cur', label: 'INR only', kind: 'percent_off', percent: 10, scope: 'line', currency: 'INR' };
  assert.strictEqual(ev([L('a', 100, 1)], [o], { currency: 'AED' }).total, 100); assert.strictEqual(ev([L('a', 100, 1)], [o], { currency: 'INR' }).total, 90);
  const rg = { id: 'rg', label: 'TN only', kind: 'percent_off', percent: 10, scope: 'line', region: 'TN' };
  assert.strictEqual(ev([L('a', 100, 1)], [rg], { region: 'KA' }).total, 100); assert.strictEqual(ev([L('a', 100, 1)], [rg], { region: 'tn' }).total, 90);
  assert.strictEqual(ev([L('a', 100, 1)], [{ id: 'any', label: 'Any', kind: 'percent_off', percent: 10, scope: 'line' }], { region: 'KA', currency: 'AED' }).total, 90);
});
it('targeting: a category, an item list, a sku list — a union; price bounds — AND; the item\'s opt-out wins', () => {
  const cat = { id: 'c', label: 'Fruit 10%', kind: 'percent_off', percent: 10, scope: 'line', applies_to: { category: 'fruit' } };
  const r = ev([L('a', 100, 1, { categories: ['fruit'] }), L('b', 100, 1, { categories: ['veg'] })], [cat]); assert.strictEqual(sum(r), -10); assert.strictEqual(r.adjustments[0].target, 'a');
  const uni = { id: 'u', label: 'Union', kind: 'percent_off', percent: 10, scope: 'line', applies_to: { category: 'fruit', item_ids: ['b'] } };
  assert.strictEqual(sum(ev([L('a', 100, 1, { categories: ['fruit'] }), L('b', 100, 1), L('c', 100, 1)], [uni])), -20);
  const band = { id: 'bd', label: 'Dear only', kind: 'percent_off', percent: 10, scope: 'line', applies_to: { min_unit_price: 150 } };
  assert.strictEqual(sum(ev([L('a', 100, 1), L('b', 200, 1)], [band])), -20);
  assert.strictEqual(ev([L('a', 100, 1, { excluded: ['*'] })], [cat.id ? { id: 'p', label: 'Any', kind: 'percent_off', percent: 10, scope: 'line' } : null]).adjustments.length, 0);
  assert.strictEqual(ev([L('a', 100, 1, { excluded: ['p'] })], [{ id: 'p', label: 'Any', kind: 'percent_off', percent: 10, scope: 'line' }]).adjustments.length, 0);
  assert.ok(/no line qualifies/.test(skippedWhy(ev([L('a', 100, 1, { categories: ['veg'] })], [cat]), 'Fruit 10%')));
});

it('a minimum order size on any offer: 10% off from 5 units — 4 units get nothing (skipped: no line qualifies), 5 get it; the badge says "10% off 5+"', () => {
  const o = { id: 'mq', label: 'Bulk 10%', kind: 'percent_off', percent: 10, scope: 'line', applies_to: { min_qty: 5 } };
  const r4 = ev([L('a', 100, 4)], [o]); assert.strictEqual(r4.adjustments.length, 0); assert.ok(/no line qualifies/.test(skippedWhy(r4, 'Bulk 10%')));
  assert.strictEqual(ev([L('a', 100, 5)], [o]).total, 450);
  assert.strictEqual(eng.promise(o, { now: new Date(), money }), '10% off 5+');
  assert.strictEqual(eng.forLine({ item_id: 'a', sku: 'A', categories: [], unitPrice: 100, excluded: [] }, [o], { now: new Date(), money }).length, 1);   /* the row may advertise the condition */
});

it('a minimum per PRODUCT (applies_to.min_qty_by_item): grapes need 3, oil needs 1 — 2 grapes get nothing, 1 oil gets the offer; the badge says "3+" on grapes', () => {
  const o = { id: 'mp', label: 'Bulk 10%', kind: 'percent_off', percent: 10, scope: 'line', applies_to: { min_qty_by_item: { a: 3, b: 1 } } };
  const r = ev([L('a', 100, 2), L('b', 100, 1)], [o]); assert.strictEqual(r.adjustments.length, 1); assert.strictEqual(r.adjustments[0].target, 'b');
  assert.strictEqual(ev([L('a', 100, 3)], [o]).total, 270);
  const fa = eng.forLine({ item_id: 'a', sku: 'A', categories: [], unitPrice: 100, excluded: [] }, [o], { now: new Date(), money }); assert.strictEqual(fa[0].promise, '10% off 3+');
  const fb = eng.forLine({ item_id: 'b', sku: 'B', categories: [], unitPrice: 100, excluded: [] }, [o], { now: new Date(), money }); assert.strictEqual(fb[0].promise, '10% off');
});

it('a quantity break is never advertised on a row it cannot help: ₹180 from 5 shows on a ₹200 product, not on an ₹80 one', () => {
  const o = { id: 't', label: 'Bulk', kind: 'tier_price', tiers: [{ qty: 5, price: 180 }] };
  const dear = eng.forLine({ item_id: 'a', sku: 'A', categories: [], unitPrice: 200, excluded: [] }, [o], { now: new Date(), money });
  const cheap = eng.forLine({ item_id: 'b', sku: 'B', categories: [], unitPrice: 80, excluded: [] }, [o], { now: new Date(), money });
  assert.strictEqual(dear.length, 1); assert.strictEqual(dear[0].promise, '₹180.00 each from 5'); assert.strictEqual(cheap.length, 0);
  assert.strictEqual(ev([L('b', 80, 10)], [o]).adjustments.length, 0);   /* and it never fires there either */
});

it('a spend threshold is cart level only: no row advertises it; the basket still says how far to go', () => {
  const o = { id: 'th', label: 'Spend 500', kind: 'threshold', min_amount: 500, percent: 10 };
  assert.strictEqual(eng.forLine({ item_id: 'a', sku: 'A', categories: [], unitPrice: 200, excluded: [] }, [o], { now: new Date(), money }).length, 0);
  const r = ev([L('a', 200, 1)], [o]); assert.strictEqual(r.notes[0].shortfall, 300);
});

console.log('— what the outlets read —');
it('perLine: line-scope amounts summed per line, every offer id listed, basket-scope excluded', () => {
  const lines = [L('a', 200, 1), L('b', 100, 1)];
  const r = ev(lines, [{ id: 'p', label: 'Flat 10%', kind: 'percent_off', percent: 10, scope: 'line' }, { id: 'm', label: '10 off', kind: 'amount_off', amount: 10, scope: 'line' }, { id: 'c', label: 'Basket 5%', kind: 'percent_off', percent: 5, scope: 'cart' }]);
  const per = eng.perLine(r, lines); assert.strictEqual(per.a.off, 30); assert.strictEqual(per.b.off, 20); assert.deepStrictEqual(per.a.offers.sort(), ['m', 'p']);
});
it('forLine (the row badge before anything is in a basket) names line offers only, never a basket offer; a customer-only offer only for its customer', () => {
  const offers = [{ id: 'p', label: 'Flat 10%', kind: 'percent_off', percent: 10, scope: 'line' }, { id: 'c', label: 'Basket 5%', kind: 'percent_off', percent: 5, scope: 'cart' }, { id: 'g', label: 'Regulars', kind: 'percent_off', percent: 10, scope: 'line', customer_group: 'regular' }];
  const line = { item_id: 'a', sku: 'A', categories: [], unitPrice: 100, excluded: [] };
  assert.deepStrictEqual(eng.forLine(line, offers, { now: new Date(), customer_groups: [], money }).map((x) => x.label), ['Flat 10%']);
  assert.deepStrictEqual(eng.forLine(line, offers, { now: new Date(), customer_groups: ['regular'], money }).map((x) => x.label), ['Flat 10%', 'Regulars']);
});
it('promise: the sentence a badge prints; null when the offer cannot fire now (expired, other group)', () => {
  assert.strictEqual(eng.promise({ id: 'p', label: 'Flat 10%', kind: 'percent_off', percent: 10, scope: 'line' }, { now: new Date(), money }), '10% off');
  assert.strictEqual(eng.promise({ id: 'p', label: 'Old', kind: 'percent_off', percent: 10, scope: 'line', valid_to: earlier }, { now: new Date(), money }), null);
  assert.strictEqual(eng.promise({ id: 'g', label: 'Regulars', kind: 'percent_off', percent: 10, scope: 'line', customer_group: 'regular' }, { now: new Date(), money, customer_groups: [] }), null);
  assert.strictEqual(eng.promise({ id: 'g', label: 'Regulars', kind: 'percent_off', percent: 10, scope: 'line', customer_group: 'regular' }, { now: new Date(), money, customer_groups: ['regular'] }), '10% off');
});
it('the context is read from input.ctx, and a top-level field wins over it', () => {
  const o = { id: 'g', label: 'Regulars', kind: 'percent_off', percent: 10, scope: 'line', customer_group: 'regular' };
  assert.strictEqual(eng.evaluate({ lines: [L('a', 100, 1)], offers: [o], ctx: { customer_groups: ['regular'] } }).total, 90);
  assert.strictEqual(eng.evaluate({ lines: [L('a', 100, 1)], offers: [o], ctx: { customer_groups: ['regular'] }, customer_groups: [] }).total, 100);
});
it('explain: every applied offer, every skipped one and its reason — the audit trail', () => {
  const r = ev([L('a', 100, 1)], [{ id: 'p', label: 'Flat 10%', kind: 'percent_off', percent: 10, scope: 'line' }, { id: 'e', label: 'Old', kind: 'percent_off', percent: 10, scope: 'line', valid_to: earlier }]);
  assert.strictEqual(r.explain.length, 2); assert.ok(/Old not applied — expired/.test(r.explain[1]));
});
it('pure and deterministic: inputs are not mutated; the same input gives the same output twice', () => {
  const lines = [L('a', 200, 2)], offers = [{ id: 'p', label: 'Flat 10%', kind: 'percent_off', percent: 10, scope: 'line', priority: 2 }, { id: 'x', label: 'Ex', kind: 'percent_off', percent: 5, scope: 'cart', exclusive: true }];
  const s0 = JSON.stringify([lines, offers]); const a = ev(lines, offers), b = ev(lines, offers);
  assert.strictEqual(JSON.stringify([lines, offers]), s0); assert.deepStrictEqual(a, b);
});

console.log('— the vendored copy —');
it('lib/offers-engine.js and the app\'s offers.js are the same engine (body identical)', () => {
  const fs = require('fs'), path = require('path');
  const strip = (s) => s.replace(/\r\n/g, '\n').split('\n').slice(39).join('\n');
  const api = strip(fs.readFileSync(path.join(__dirname, '..', 'lib', 'offers-engine.js'), 'utf8'));
  const web = strip(fs.readFileSync(path.join(__dirname, '..', '..', 'chitbridge-web', 'public', 'app', 'offers.js'), 'utf8'));
  assert.strictEqual(api, web);
});

console.log('\n══ offer engine · ' + pass + ' passed · ' + fail + ' failed ══\n');
process.exit(fail ? 1 : 0);
