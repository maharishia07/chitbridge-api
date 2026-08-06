// @stage tested
// @stage-note The network storefront: one shopfront over many member catalogues, classified. Pure — the caller
// supplies the members and their already-resolved views.
'use strict';
/**
 * network-view.js — one shopfront, many departments.
 *
 * Athi, 2026-08-06: *"when the storefront is calling, it will call the NETWORK, not the individual stores under the
 * network — so the catalogue of all the entities should be visible where the entity is public. A departmental
 * store has N product lines like clothing, medicine and so on… the consumer, when they browse the network, sees
 * all of it and can search."*
 *
 * And: *"we have to introduce grouping, category and so on, so the classification becomes simpler for the person
 * using it."*
 *
 * ── THE CLASSIFICATION, THREE LEVELS ───────────────────────────────────────────────────────────────────────────
 *
 *     DEPARTMENT      Clothing · Pharmacy · Grocery       ← a member ENTITY. Its own prices, units, order mode.
 *       └ CATEGORY    Shirts · Trousers                   ← within a department
 *           └ PRODUCT Cotton Shirt                        ← one product…
 *               └ LINE  S · M · L                         ← …with its purchasable lines (the variant work)
 *
 * Each level answers a different question a shopper actually asks: *whose is this* · *what kind of thing is it* ·
 * *which one* · *which size*. Collapsing any two of them is what makes a catalogue hard to browse.
 *
 * ── WHERE A CATEGORY COMES FROM, AND WHY IT IS NOT INVENTED ────────────────────────────────────────────────────
 * `item_data.category` when the merchant declared one. When they did not, the line is grouped under `Everything
 * else` for that department — NOT under a guessed category. A catalogue that invents categories is worse than one
 * with none, because a shopper cannot tell the difference between a classification and a guess.
 *
 * ── VISIBILITY IS NOT DECIDED HERE ─────────────────────────────────────────────────────────────────────────────
 * ⚠️ This module never reads a visibility flag. The caller passes only the members it has ALREADY resolved through
 * `buildPublicView`, which applies public/network/private with the viewer in hand. A private department simply is
 * not in the list. Deciding access in two places is how the supplier view once diverged from the storefront — the
 * one thing SPEC-one-path-many-principals exists to prevent.
 *
 * ── ZERO DEPENDENCIES · TIER A ─────────────────────────────────────────────────────────────────────────────────
 */

const UNCATEGORISED = 'Everything else';

const str = (v) => (v === null || v === undefined) ? '' : String(v).trim();
const amountOf = (p) => (p && typeof p === 'object') ? p.amount : p;

/**
 * assemble({ network, departments }) → the shopfront.
 *
 * `departments` is [{ entity:{bridge_id, display_name, currency_code}, view }] where `view` is what
 * buildPublicView returned. A department whose view is unavailable is skipped — it was private, or closed, or not
 * a member; from here they are the same thing and none of them is this module's business.
 */
function assemble(opts = {}) {
  const out = { network: opts.network || null, departments: [], categories: [], count: 0, currencies: [] };
  const seenCcy = [];

  for (const d of (opts.departments || [])) {
    const view = d && d.view;
    if (!view || view.available === false) continue;        // private/closed/absent — indistinguishable, by design

    const shop = view.shop || {};
    const ccy = shop.currency_code || null;
    if (ccy && seenCcy.indexOf(ccy) < 0) seenCcy.push(ccy);

    // Lines: the ONE read if the caller has it, else the flat items list. Both carry the same fields.
    const lines = Array.isArray(view.lines) && view.lines.length
      ? view.lines.map((l) => ({ item_id: l.item_id, fields: l.fields || {}, origin: l.origin }))
      : (view.items || []).map((p) => ({ item_id: p.item_id, fields: p.item_data || {}, origin: 'own' }));

    const byCat = new Map();
    for (const l of lines) {
      const f = l.fields || {};
      const cat = str(f.category) || UNCATEGORISED;
      if (!byCat.has(cat)) byCat.set(cat, []);
      byCat.get(cat).push({
        item_id: l.item_id,
        name: str(f.name) || str(f.product) || 'item',
        unit: str(f.unit),
        price: amountOf(f.price),
        currency: (f.price && typeof f.price === 'object' && f.price.currency) || ccy || null,
        variant: str(f.size) || str(f.variant) || '',
        // The product this line belongs to, when the department declared variants. Absent → the line IS the product.
        product: str(f.product) || null,
      });
    }

    const categories = [...byCat.entries()].map(([name, items]) => ({ name, count: items.length, items }));
    // The declared categories first, in the order they appeared; the catch-all last wherever it turned up. A
    // shopper reads "Everything else" as the end of a list, not as one entry among equals.
    categories.sort((a, b) => (a.name === UNCATEGORISED ? 1 : 0) - (b.name === UNCATEGORISED ? 1 : 0));

    const total = lines.length;
    out.departments.push({
      bridge_id: shop.bridge_id || (d.entity && d.entity.bridge_id) || null,
      name: shop.display_name || (d.entity && d.entity.display_name) || 'Department',
      currency_code: ccy,
      order_method: shop.order_method || (shop.order_input && shop.order_input.preset) || 'cart',
      count: total,
      categories,
    });
    out.count += total;
    for (const c of categories) if (out.categories.indexOf(c.name) < 0) out.categories.push(c.name);
  }

  out.currencies = seenCcy;
  return out;
}

/**
 * search(shopfront, q) → the same shape, filtered.
 *
 * Matches a product name, its category, its unit, or the department. Case-insensitive substring, because a shopper
 * types "para" and means Paracetamol — anything cleverer here would be a ranking function pretending to be a
 * filter, and an empty result would then be impossible to explain.
 *
 * Empty departments and empty categories are dropped, so a search never shows a heading with nothing under it.
 */
function search(shopfront, q) {
  const needle = str(q).toLowerCase();
  if (!needle) return shopfront;
  const out = { network: shopfront.network, departments: [], categories: [], count: 0, currencies: shopfront.currencies, query: q };

  for (const d of (shopfront.departments || [])) {
    const deptHit = d.name.toLowerCase().indexOf(needle) >= 0;
    const cats = [];
    for (const c of (d.categories || [])) {
      const catHit = c.name.toLowerCase().indexOf(needle) >= 0;
      const items = (c.items || []).filter((it) => deptHit || catHit
        || it.name.toLowerCase().indexOf(needle) >= 0
        || (it.unit && it.unit.toLowerCase().indexOf(needle) >= 0)
        || (it.product && it.product.toLowerCase().indexOf(needle) >= 0));
      if (items.length) cats.push({ name: c.name, count: items.length, items });
    }
    if (cats.length) {
      out.departments.push(Object.assign({}, d, { categories: cats, count: cats.reduce((n, c) => n + c.count, 0) }));
      out.count += cats.reduce((n, c) => n + c.count, 0);
      for (const c of cats) if (out.categories.indexOf(c.name) < 0) out.categories.push(c.name);
    }
  }
  return out;
}

module.exports = { assemble, search, UNCATEGORISED };
