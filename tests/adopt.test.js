/**
 * ── tests/adopt.test.js · WHAT A SHOP MAY TAKE INTO ITS OWN CATALOGUE ──────────────────────────────────────────
 * Athi's four rules, each of them a refusal to do something convenient. Every one of these is a decision that
 * ends with a product on a storefront if it goes wrong, so they are asserted before any route can act on them.
 */
'use strict';
const assert = require('assert'), path = require('path');
const A = require(path.join(__dirname, '..', 'lib', 'adopt.js'));

let pass = 0;
const it = (what, fn) => { try { fn(); pass++; console.log('  ok  ' + what); }
                           catch (e) { console.log('  FAIL ' + what + '\n       ' + e.message); process.exitCode = 1; } };

const KIRANA = { sectors: ['kirana'], has_item: (n) => n === 'Rice 1kg' };
const FMCG   = { name: 'ABC Distributors', sectors: ['fmcg'], supply_kind: 'resale' };
const PHARMA = { name: 'MedCo', sectors: ['pharma'], supply_kind: 'resale' };
const SUNDRY = { name: 'Chennai Stationers', sectors: ['fmcg'], supply_kind: 'own_use' };

console.log('— who decides what the goods are for —');

it('⭐⭐⭐ the SUPPLIER decides, once, instead of every line asking', () => {
  assert.strictEqual(A.purposeFor(SUNDRY).purpose, 'own_use');
  assert.strictEqual(A.purposeFor(FMCG).purpose, 'resale');
  assert.strictEqual(A.purposeFor(FMCG).from, 'supplier');
});

it('⚠️ but a LINE may still say otherwise — the biscuit distributor also sells shelf labels', () => {
  const d = A.purposeFor(FMCG, 'own_use');
  assert.strictEqual(d.purpose, 'own_use');
  assert.strictEqual(d.from, 'line', 'the line must win over the supplier default');
});

it('⚠️⚠️ and "nobody said" is a QUESTION, never quietly treated as "to sell"', () => {
  const undeclared = { name: 'New Traders', sectors: ['fmcg'] };
  assert.strictEqual(A.purposeFor(undeclared).purpose, 'unknown');
  const r = A.consider({ particulars: 'Floor cleaner' }, undeclared, KIRANA, {});
  /* it lands on 'offer', which is the right place — and carries the flag that makes the screen ask first */
  assert.strictEqual(r.may, 'offer');
  assert.strictEqual(r.ask_purpose, true,
    'an undeclared supplier fell through to offer with nothing telling the screen to ask');
});

console.log('— what may reach a catalogue —');

it('⭐⭐ a sundry supplier NEVER reaches the catalogue', () => {
  const r = A.consider({ particulars: 'Floor cleaner 5L', price: 400 }, SUNDRY, KIRANA, {});
  assert.strictEqual(r.may, 'not_for_sale');
  assert.ok(/sundry supplier/.test(r.why), r.why);
  assert.strictEqual(r.seed, undefined, 'a sundry line must not even be handed a form to accept');
});

it('⭐ something already stocked is not offered again, and says why', () => {
  const r = A.consider({ particulars: 'Rice 1kg' }, FMCG, KIRANA, {});
  assert.strictEqual(r.may, 'already');
  assert.ok(/already stock/.test(r.why));
});

it('⭐⭐⭐ own-use accepts ANY material, whatever the vertical — the invoice is the whole story', () => {
  /**
   * Athi, 2026-09-10: *"so this category can accept any material now irrespective of the vertical and
   * according to the invoice received."* Exactly — a grocery may buy a pharma-made disinfectant, an
   * electrician's cable, anything at all, to USE. None of it is being sold, so none of the obligations that
   * make the vertical gate exist apply: no licence, no expiry duty, no recall.
   *
   * ⚠️⚠️ THIS WORKS BECAUSE OF THE ORDER OF TWO CHECKS IN consider(), which is load-bearing and looks like an
   * accident: own-use returns BEFORE the vertical gate is reached. Swap them in a tidy-up and a grocery could
   * no longer buy hand sanitiser from a pharma supplier. Pinned here so the tidy-up goes red.
   */
  const sundryPharma = { name: 'MedCo Supplies', sectors: ['pharma'], supply_kind: 'own_use' };
  const r = A.consider({ particulars: 'Hand sanitiser 5L', price: 900 }, sundryPharma, KIRANA, {});
  assert.strictEqual(r.may, 'not_for_sale', 'a grocery must be able to BUY pharma goods it only uses');
  assert.notStrictEqual(r.refused, 'vertical', 'the vertical gate must not fire on something never being sold');
});

console.log('— the vertical gate —');

it('⭐⭐⭐ pharma goods at a grocery are REFUSED, not warned about', () => {
  const r = A.consider({ particulars: 'Paracetamol 500', price: 12 }, PHARMA, KIRANA, {});
  assert.strictEqual(r.may, 'refuse');
  assert.strictEqual(r.refused, 'vertical');
  /* ⚠️ THE SENTENCE MUST SAY WHAT IT MEANS, not name a mismatch. "vertical mismatch" is a word from our world. */
  assert.ok(/batch and an expiry/.test(r.why), 'the refusal must say what stocking them obliges: ' + r.why);
  assert.ok(/recall/.test(r.why));
  assert.ok(r.override_says, 'a refusal with no way through is a wall, not a gate');
});

it('⚠️ the override lets it through — and records that it WAS overridden', () => {
  const r = A.consider({ particulars: 'Paracetamol 500', price: 12 }, PHARMA, KIRANA, { override: true });
  assert.strictEqual(r.may, 'offer');
  assert.strictEqual(r.overridden, true, 'an override that leaves no trace is indistinguishable from no gate');
});

it('⚠️ a shop that declared NO sector is not told it is the wrong one', () => {
  const nobody = { sectors: [], has_item: () => false };
  const r = A.consider({ particulars: 'Paracetamol 500', price: 12 }, PHARMA, nobody, {});
  assert.strictEqual(r.may, 'offer', 'you cannot mismatch a trade nobody has declared');
});

console.log('— the seed is a form, not a record —');

it('⭐⭐⭐ the shop mints its OWN sku, and is never handed the supplier\'s', () => {
  const r = A.consider({ particulars: 'Aachi Masala 100g', unit: 'packet', price: 40,
                         item_data: { unit_cost: 44, sku: 'SUPPLIER-SKU-1' } }, FMCG, KIRANA, {});
  assert.strictEqual(r.seed.sku, null, 'the supplier\'s SKU must never be adopted as the shop\'s own');
  assert.ok(r.seed.suggested_sku, 'but a suggestion saves typing forty of them');
});

it('⭐⭐ the cost arrives as a COST — never pre-filled as a selling price', () => {
  const r = A.consider({ particulars: 'Aachi Masala 100g', price: 40, item_data: { unit_cost: 44 } }, FMCG, KIRANA, {});
  assert.strictEqual(r.seed.cost, 44, 'the landed cost is the cost, not the supplier list price');
  /* ⚠️ a shop that sold at cost because a form pre-filled it would have been failed by this module */
  assert.strictEqual(r.seed.price, null, 'what to sell at is the shop\'s decision, always');
});

it('⭐⭐ the vertical\'s own attributes travel, and batch tracking comes with them', () => {
  const r = A.consider({ particulars: 'Paracetamol 500',
                         item_data: { batch: 'P-1', expiry: '2027-06-30', unit_cost: 9 } },
                       PHARMA, { sectors: ['pharma'], has_item: () => false }, {});
  assert.deepStrictEqual(r.needs, ['batch', 'expiry'], 'pharma requires both');
  assert.strictEqual(r.seed.attributes.batch, 'P-1');
  assert.strictEqual(r.seed.attributes.expiry, '2027-06-30');
  assert.strictEqual(r.seed.batch_tracked, true, 'a pharma product must arrive already keeping stock per batch');
});

it('⚠️ a delivery MISSING a required field still adopts — but says what did not arrive', () => {
  const r = A.consider({ particulars: 'Paracetamol 500', item_data: { batch: 'P-1' } },
                       PHARMA, { sectors: ['pharma'], has_item: () => false }, {});
  assert.strictEqual(r.may, 'offer');
  assert.deepStrictEqual(r.missing, ['expiry'],
    'a missing expiry is a conversation with the supplier, not a row to quietly accept');
});

console.log('— the whole delivery, as a person reads it —');

it('⭐⭐ grouped, and the headline says what needs a person', () => {
  const all = A.considerAll([
    { particulars: 'Rice 1kg' },                                   /* already stocked */
    { particulars: 'Aachi Masala 100g', price: 40 },                /* new, same trade */
    { particulars: 'Shelf labels', price: 90 },                     /* marked shop-use on the line */
  ], FMCG, KIRANA, { per_line: { 2: { purpose: 'own_use' } } });
  assert.strictEqual(all.already.length, 1);
  assert.strictEqual(all.offer.length, 1);
  assert.strictEqual(all.not_for_sale.length, 1);
  assert.ok(/1 new product you can add/.test(all.says), all.says);
  assert.ok(/for the shop to use/.test(all.says), all.says);
});

console.log(pass + ' checks');
