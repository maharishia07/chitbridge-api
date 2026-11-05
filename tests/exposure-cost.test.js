'use strict';
/**
 * COST NEVER REACHES A CUSTOMER-FACING SURFACE — the automated test design-handoff's Offer Lab spec asks for
 * by name (§8: "No customer, reseller or link ever sees it. Keep an automated test for this.").
 *
 * lib/exposure.js is the ONE projection every surface reads (catalogue-view.js's own docstring: "so the
 * storefront, the Suppliers screen and the API obey without each knowing the rule"). Cost is deleted there
 * unconditionally — not gated behind any of the seller's own on/off switches, because unlike tax or synonyms
 * a seller never gets to choose to show it.
 *
 * Run: node tests/exposure-cost.test.js
 */
const assert = require('node:assert');
const exposure = require('../lib/exposure');

/* ── the plain case: cost set, no switches touched ─────────────────────────────────────────────────────── */
(function () {
  const it = { item_data: { name: 'Masala Dosa', price: 70, cost: 38 } };
  const exp = exposure.exposureOf({}, it.item_data);
  exposure.apply(it, exp);
  assert.strictEqual(it.item_data.cost, undefined, 'cost must not survive exposure.apply()');
  assert.strictEqual(it.item_data.price, 70, 'price is not cost — must still be there');
})();

/* ── every exposure switch wide open — cost still gone, because it is not one of the switches ─────────── */
(function () {
  const it = { item_data: { name: 'Filter Coffee', price: 20, cost: 7,
    exposure: { tax: true, offers: true, stock: true, synonyms: true, hsn: true, description: true, media: true } } };
  const exp = exposure.exposureOf({}, it.item_data);
  exposure.apply(it, exp);
  assert.strictEqual(it.item_data.cost, undefined, 'cost has no switch — it cannot be opted back in');
})();

/* ── the shop's own defaults wide open too ─────────────────────────────────────────────────────────────── */
(function () {
  const it = { item_data: { name: 'Idli', price: 40, cost: 17 } };
  const entityFlags = { storefront_exposure: { tax: true, offers: true, stock: true, synonyms: true, hsn: true, description: true, media: true } };
  const exp = exposure.exposureOf(entityFlags, it.item_data);
  exposure.apply(it, exp);
  assert.strictEqual(it.item_data.cost, undefined, 'a shop-wide default cannot expose cost either');
})();

/* ── an item with no cost at all — apply() must not invent one or throw ───────────────────────────────── */
(function () {
  const it = { item_data: { name: 'Fresh Juice', price: 60 } };
  const exp = exposure.exposureOf({}, it.item_data);
  assert.doesNotThrow(() => exposure.apply(it, exp));
  assert.strictEqual(it.item_data.cost, undefined);
})();

/* ── P1 2026-10-29, fail-closed: unit_cost and supplier_note (any depth) are deleted by apply() whatever the switches say ── */
(function () {
  const it = { item_data: { name: 'Widget', price: 5, unit_cost: 7777.77, supplier_note: 'x', variants: [{ landed_cost: 1, margin: 2 }] } };
  exposure.apply(it, exposure.exposureOf({ storefront_exposure: { tax: true, offers: true, stock: true, synonyms: true, hsn: true, description: true, media: true } }, it.item_data));
  assert.strictEqual(JSON.stringify(it).match(/7777|supplier_note|landed_cost|margin/), null);
  assert.strictEqual(it.item_data.price, 5);
})();

console.log('exposure-cost: cost never reaches a customer-facing surface — 5/5 passed');
