#!/usr/bin/env node
/**
 * offers.test.mjs — CBOffers, proven without a browser.
 *
 * offers.js is deliberately pure — catalogue + lines + context in, a breakdown out, nothing mutated — so it can
 * be tested exactly as the pricing engine it is, with no DOM and no cart. That purity is the point: the same
 * engine has to give the same answer in the cart, on the storefront, in a quote, and again at seal time months
 * later, and a function that touches nothing is the only kind that can promise that.
 *
 * ⚠️ NOT WIRED TO ANY SCREEN YET (Athi: "need not complete now, let us finish cart flow correct"). This proves
 * the arithmetic and the REFUSALS; where it gets called is a later decision. See C:\dev\SPEC-offers-tax.md.
 */
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ctx = createContext({ console });
runInContext(readFileSync(join(ROOT, 'public/engine/offers.js'), 'utf8'), ctx, { filename: 'offers.js' });
const CBOffers = ctx.CBOffers;

let pass = 0, fail = 0;
const ok = (name, cond, got) => {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (got === undefined ? '' : '  → ' + JSON.stringify(got))); }
};
const money = (n) => '₹' + n;
const LINES = [
  { key: 'a', item_id: 'i1', sku: 'RICE-25', category: 'grain', qty: 4, unitPrice: 100 },   // 400
  { key: 'b', item_id: 'i2', sku: 'DAL-1',   category: 'grain', qty: 2, unitPrice: 150 },   // 300
  { key: 'c', item_id: 'i3', sku: 'OIL-5',   category: 'oil',   qty: 1, unitPrice: 300 }    // 300
];
const run = (offers, extra) => CBOffers.evaluate(Object.assign({ lines: LINES, offers, money }, extra || {}));

console.log('\n1 · the shapes an offer can take');
{
  let r = run([{ id: 'o1', kind: 'percent_off', scope: 'cart', percent: 10, label: '10% off' }]);
  ok('cart % off applies to the whole subtotal', r.total === 900, { subtotal: r.subtotal, total: r.total });

  r = run([{ id: 'o2', kind: 'threshold', min_amount: 500, percent: 5, label: 'spend 500' }]);
  ok('⭐ "discount above a certain amount" fires when the order qualifies', r.total === 950, r.total);

  r = run([{ id: 'o3', kind: 'threshold', min_amount: 5000, percent: 5, label: 'spend 5000' }]);
  ok('…and does NOT fire when it does not', r.total === 1000, r.total);
  ok('⭐ …and says HOW FAR SHORT — the most useful thing a cart can tell you',
     /4000 more needed/.test((r.notes[0] || {}).why || ''), r.notes);

  r = run([{ id: 'o4', kind: 'tier_price', label: 'bulk rice',
             applies_to: { skus: ['RICE-25'] }, tiers: [{ qty: 3, price: 90 }, { qty: 10, price: 80 }] }]);
  ok('a quantity tier RE-PRICES the line (4 × ₹100 → ₹90)', r.total === 960, r.total);
  ok('…and is marked as a re-price, not a discount', r.adjustments[0].basis === 'price', r.adjustments[0]);

  r = run([{ id: 'o5', kind: 'buy_x_get_y', buy: 1, get: 1, label: 'BOGO grain',
             applies_to: { category: 'grain' } }]);
  /**
   * ⚠⚠⚠ THIS ASSERTION CHANGED ON PURPOSE, 2026-09-10, AND THE OLD ONE WAS RIGHT UNTIL THEN.
   *
   * Athi, looking at a counter line showing ₹0.00 for a single packet: *"we cannot offer for different
   * product."* buy_x_get_y used to POOL the whole category and give away the cheapest unit in it — so three
   * different biscuits earned a free one, and the line holding one packet read ₹0.00 with nothing to explain it.
   *
   * ⭐ It is now earned PER PRODUCT: three of one thing earns one of that thing. It costs the shop MORE on a
   * mixed basket, and that is the intended behaviour.
   */
  ok('buy-one-get-one takes whole sets from 6 qualifying units', r.adjustments.length > 0);
  ok('⭐⭐ …PER PRODUCT — each qualifying line earns its own sets, never the category pooled',
     r.adjustments.length === 2 && /sets of this product/.test(r.adjustments[0].why),
     r.adjustments.map((x) => x.why));

  /**
   * ⭐⭐ AND THE CHEAPEST-FREE CONVENTION DID NOT DISAPPEAR — IT MOVED. It is what mix_and_match means, which
   * is the kind a clothes shop wants ("any two from this rail"). Asserted here rather than deleted, because an
   * assertion that is removed rather than relocated is a rule nobody is checking any more.
   */
  r = run([{ id: 'o5b', kind: 'mix_and_match', buy: 1, get: 1, label: 'any 2 grain',
             applies_to: { category: 'grain' } }]);
  ok('⭐ mix_and_match pools the category and the CHEAPEST qualifying units are the free ones',
     r.adjustments.length === 1 && /cheapest qualifying units/.test(r.adjustments[0].why),
     (r.adjustments[0] || {}).why);

  r = run([{ id: 'o5', kind: 'buy_x_get_y', buy: 1, get: 1, label: 'BOGO grain',
             applies_to: { category: 'grain' } }]);

  r = run([{ id: 'o6', kind: 'shipping', free: true, label: 'free shipping' }], { shipping: 80 });
  ok('free shipping zeroes the shipping leg, not the goods', r.shipping === 0 && r.subtotal === 1000,
     { shipping: r.shipping, subtotal: r.subtotal });
}

console.log('\n2 · ⚠️ the refusals — never apply what was not earned');
{
  let r = run([{ id: 'x1', kind: 'percent_off', scope: 'cart', percent: 50,
                 valid_from: '2030-01-01', label: 'future' }]);
  ok('an offer that has not started is NOT applied', r.total === 1000, r.total);
  ok('…and says why', /not started/.test((r.skipped[0] || {}).why || ''), r.skipped);

  r = run([{ id: 'x2', kind: 'percent_off', scope: 'cart', percent: 50,
             valid_to: '2020-12-31', label: 'expired' }]);
  ok('an expired offer is NOT applied', r.total === 1000, r.total);

  /* ⚠️ The off-by-one that customers notice: "valid to 31 Oct" must mean the END of the 31st. */
  r = run([{ id: 'x3', kind: 'percent_off', scope: 'cart', percent: 10, valid_to: '2026-10-31', label: 'oct' }],
          { now: '2026-10-31T18:00:00Z' });
  ok('⭐ an end DATE means the END of that day, not 00:00', r.total === 900, r.total);

  r = run([{ id: 'x4', kind: 'percent_off', scope: 'cart', percent: 10, region: 'TN', label: 'TN only' }],
          { region: 'KL' });
  ok('a region-locked offer does not apply elsewhere', r.total === 1000, r.total);

  r = run([{ id: 'x5', kind: 'percent_off', scope: 'cart', percent: 10, label: 'no region declared' }],
          { region: 'KL' });
  ok('⚠️ …but a MISSING region means no restriction, never "fails"', r.total === 900, r.total);

  r = run([{ id: 'x6', kind: 'amount_off', scope: 'cart', amount: 99999, label: 'huge' }]);
  ok('⭐ a flat discount larger than the order does NOT pay the customer', r.total === 0, r.total);
  ok('…and the cap is REPORTED, not silent', /capped/.test(r.adjustments[0].why), r.adjustments[0].why);

  r = run([{ id: 'x7', kind: 'tier_price', applies_to: { skus: ['RICE-25'] },
             tiers: [{ qty: 3, price: 130 }], label: 'bad tier' }]);
  ok('⚠️ a tier that would RAISE the price is refused', r.total === 1000, r.total);

  /* R44 (24 Oct walk): the Offer Lab saves a ladder step as {qty, percent} - the engine's one word. 'pct' is read by nobody. */
  const idli = [{ key: 'i', item_id: 'idli', qty: 5, unitPrice: 40 }];
  const ladder = (steps) => CBOffers.evaluate({ lines: idli, offers: [{ id: 'l', kind: 'tier_price', scope: 'line', applies_to: { item_ids: ['idli'] }, tiers: steps, label: 'ladder' }] });
  r = ladder([{ qty: 3, percent: 10 }, { qty: 5, percent: 15 }]);
  ok('R44 a {qty, percent} ladder takes 15% off 5 x 40 (Rs30)', Math.abs(r.total - 170) < 0.01, r.total);
  r = ladder([{ qty: 3, pct: 10 }, { qty: 5, pct: 15 }]);
  /* engines 1.72+ reads the legacy 'pct' as an alias of 'percent' (tierPercentOf; 'percent' wins): 5 x 40 = 200.00, 15% off = 170.00. This line said 200 and was stale for
     weeks because the script was in no CI step (found 2026-10-29, web #425); it is enrolled now. */
  ok('R44 a legacy {qty, pct} ladder is read as percent (alias): 5 x 40 less 15% = 170.00', Math.abs(r.total - 170) < 0.01, r.total);

  /* M4a (engines v1.89.0, CAT-252/253/233): the SAME product on two lines counts together; different products never do. Hand figures, INR. */
  const two = (a, b) => [{ key: 'p', item_id: a, qty: 3, unitPrice: 100 }, { key: 'q', item_id: b, qty: 2, unitPrice: 100 }];
  const min5 = [{ id: 'm5', kind: 'percent_off', percent: 10, applies_to: { min_qty: 5 }, label: '10% from 5' }];
  r = CBOffers.evaluate({ lines: two('a', 'a'), offers: min5, money });
  ok('M4a min_qty 5: a:3 + a:2 of ONE item meets it: 500.00 less 10% = 450.00', Math.abs(r.total - 450) < 0.01, r.total);
  r = CBOffers.evaluate({ lines: two('a', 'b'), offers: min5, money });
  ok('M4a min_qty 5: a:3 + b:2 are DIFFERENT items, 3 and 2 do not make 5: total stays 500.00', Math.abs(r.total - 500) < 0.01, r.total);
  const bundle = [{ id: 'b1', kind: 'bundle_price', bundle_items: ['A', 'B'], bundle_price: 150, label: 'A+B' }];
  r = CBOffers.evaluate({ lines: [{ key: '0', item_id: 'A', qty: 1, unitPrice: 100 }, { key: '1', item_id: 'B', qty: 1, unitPrice: 80 }], offers: bundle, money });
  ok('M4a a declared bundle A 100.00 + B 80.00 for 150.00 prices as the bundle: 150.00', Math.abs(r.total - 150) < 0.01, r.total);
  /* M4a critic round - tier, buy-x (either line order) and the opt-out, on the till's copy. Hand figures, INR. */
  const tier = [{ id: 't1', kind: 'tier_price', tiers: [{ qty: 10, price: 80 }], label: '10+ at 80' }];
  r = CBOffers.evaluate({ lines: [{ key: '0', item_id: 'a', qty: 5, unitPrice: 100 }, { key: '1', item_id: 'a', qty: 5, unitPrice: 100 }], offers: tier, money });
  ok('M4a tier 10 at 80.00: a:5 + a:5 of ONE item = 10 x 80.00 = 800.00', Math.abs(r.total - 800) < 0.01, r.total);
  const bogo = [{ id: 'g1', kind: 'buy_x_get_y', buy: 2, get: 1, label: 'buy 2 get 1' }];
  const dear = { key: '0', item_id: 'a', qty: 1, unitPrice: 100 }, cheap = { key: '1', item_id: 'a', qty: 2, unitPrice: 80 };
  const bogoBoth = [[dear, cheap], [cheap, dear]].map((lines) => CBOffers.evaluate({ lines, offers: bogo, money }).total);
  ok('M4a buy 2 get 1: a:1 at 100.00 + a:2 at 80.00, the cheapest unit is free: 260.00 - 80.00 = 180.00 in BOTH line orders', bogoBoth.every((t) => Math.abs(t - 180) < 0.01), bogoBoth);
  r = CBOffers.evaluate({ lines: [{ key: '0', item_id: 'a', qty: 3, unitPrice: 100 }, { key: '1', item_id: 'a', qty: 2, unitPrice: 100, excluded: ['m5'] }], offers: min5, money });
  ok('M4a min_qty 5: a line opted out of the offer is not counted (3 only): total stays 500.00', Math.abs(r.total - 500) < 0.01, r.total);

  r = run([{ id: 'x8', kind: 'price_range', min: 200, max: 250,
             applies_to: { skus: ['OIL-5'] }, label: 'oil band' }]);
  ok('⭐ a price outside the seller band produces a VIOLATION, never a clamp',
     r.total === 1000 && r.notes.length === 1, { total: r.total, notes: r.notes.length });
  /* ⚠️ The band is printed through the caller's money() — "₹200–₹250", not "200–250". Asserting the bare digits
     was my mistake, and the formatted version is the correct behaviour: a band stated without its currency is
     exactly the ambiguity this engine exists to remove. */
  ok('…and names the band, in the caller’s currency', /₹200–₹250/.test(r.notes[0].why), r.notes[0].why);

  r = run([{ id: 'x9', kind: 'not_a_real_kind', label: 'nonsense' }]);
  ok('an unknown kind is skipped with a reason, not crashed on',
     r.total === 1000 && /unknown kind/.test(r.skipped[0].why), r.skipped);
}

console.log('\n3 · ⚠️ stacking is EXPLICIT, never array order');
{
  let r = run([
    { id: 's2', kind: 'percent_off', scope: 'cart', percent: 10, priority: 2, label: 'second' },
    { id: 's1', kind: 'amount_off',  scope: 'cart', amount: 100, priority: 1, label: 'first' }
  ]);
  ok('offers run in PRIORITY order, not the order they were listed',
     r.adjustments[0].label === 'first', r.adjustments.map((a) => a.label));

  r = run([
    { id: 'e1', kind: 'percent_off', scope: 'cart', percent: 10, priority: 1, exclusive: true, label: 'only me' },
    { id: 'e2', kind: 'percent_off', scope: 'cart', percent: 10, priority: 2, label: 'blocked' }
  ]);
  ok('⭐ an exclusive offer that fires stops everything after it', r.adjustments.length === 1, r.adjustments.length);
  ok('…and the blocked one says why it did not apply',
     /exclusive/.test((r.skipped[0] || {}).why || ''), r.skipped);
}

console.log('\n4 · ⭐ every price must be defensible six months later');
{
  const r = run([
    { id: 'd1', kind: 'threshold', min_amount: 500, percent: 5, label: 'Spend ₹500' },
    { id: 'd2', kind: 'percent_off', scope: 'cart', percent: 50, valid_to: '2020-01-01', label: 'Diwali 2019' }
  ]);
  ok('the explain trail covers what APPLIED', r.explain.some((e) => /Spend ₹500/.test(e)), r.explain);
  ok('⭐ …and what did NOT, with the reason', r.explain.some((e) => /Diwali 2019 not applied — expired/.test(e)),
     r.explain);
  ok('every adjustment names its offer', r.adjustments.every((a) => a.offer_id && a.why));
}

console.log('\n== RESULT ==  PASS ' + pass + '  ·  FAIL ' + fail);
process.exit(fail ? 1 : 0);
