/* app/pricing.js — THE PRICING STRUCTURE A PRODUCT CITES, AND THE UNIT PRICE IT YIELDS AT A QUANTITY.
 *   (classic script, shared global scope · vendored verbatim to the API as lib/pricing-engine.js)
 *
 * Athi, 2026-09-05: *"in catalogue setup I have fixed and tier pricing. how do I invoke the same in the catalogue
 * while setting up the price?"* — until today the structures were a REGISTER (Catalogue setup › Pricing) and the
 * product carried one scalar; nothing could cite a structure and nothing evaluated one.
 *
 * ── THE MODEL IS ODOO'S PRICELIST, REDUCED ─────────────────────────────────────────────────────
 * A pricing structure is a definition (kind 'pricing') with a sub-kind:
 *   fixed   — one declared amount (overrides the list price when set; else the list price IS the fixed price)
 *   tiered  — price breaks: from quantity q, each unit costs p. Below the first break the list price applies.
 *             A tier RE-PRICES the line; it is not a discount (that is an offer, offers.js, applied AFTER this).
 *   range   — a band the price must sit in; it constrains, it never re-prices. Outside → reported, never clamped.
 * The product CITES one (item_data.pricing_def) and carries a TRAVELLING COPY of what it means (pricing_kind,
 * pricing_tiers, pricing_amount, pricing_min/max, pricing_def_name) — exactly as a tax slab travels as gst_rate —
 * so a line priced from it is explainable months later without the definition.
 *
 * ── ⚠️⚠️ PURE. IT PRICES, IT NEVER CHARGES ──────────────────────────────────────────────────
 * unitPrice(item_data, qty, listPrice) → { amount, kind, tier, list, why, violation }
 * The same function answers on the product page, in the cart, on the storefront and on the server's order path.
 * ORDER OF EVALUATION on a line: pricing structure → offers → tax.
 */
(function (root) {
  'use strict';
  var KEY = 'pricing_def';
  var KINDS = ['fixed', 'tiered', 'range'];
  function num(v) { var n = Number(v); return isFinite(n) ? n : null; }
  function R2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
  function tiersOf(d) {
    var t = d && d.pricing_tiers;
    return (Array.isArray(t) ? t : []).map(function (x) { return { qty: num(x && x.qty), price: num(x && x.price) }; })
      .filter(function (x) { return x.qty !== null && x.qty > 0 && x.price !== null && x.price >= 0; })
      .sort(function (a, b) { return a.qty - b.qty; });
  }
  /** the travelling copy for a definition — what the product will carry (null clears it) */
  function copyOf(def) {
    if (!def) return { pricing_def: null, pricing_def_name: null, pricing_kind: null, pricing_tiers: null, pricing_amount: null, pricing_min: null, pricing_max: null };
    var r = (def.rules && typeof def.rules === 'object') ? def.rules : {};
    return { pricing_def: String(def.definition_id || def.id || ''), pricing_def_name: def.name || null, pricing_kind: def.sub_kind || null,
             pricing_tiers: Array.isArray(r.tiers) && r.tiers.length ? r.tiers : null,
             pricing_amount: num(r.amount), pricing_min: num(r.min), pricing_max: num(r.max) };
  }
  function setOn(item_data, def) { var c = copyOf(def); Object.keys(c).forEach(function (k) { item_data[k] = c[k]; }); return item_data; }
  /** unitPrice(item_data, qty, listPrice) — the price of ONE unit at that quantity, and why */
  function unitPrice(d, qty, listPrice) {
    d = d || {}; var q = num(qty); if (q === null || q <= 0) q = 1;
    var list = num(listPrice); if (list === null) list = num(d.price && typeof d.price === 'object' ? d.price.amount : d.price);
    var kind = d.pricing_kind || null;
    var out = { amount: list, kind: kind, tier: null, list: list, why: kind ? '' : 'list price', violation: null, name: d.pricing_def_name || null };
    if (kind === 'fixed') { if (num(d.pricing_amount) !== null) { out.amount = num(d.pricing_amount); out.why = 'fixed at ' + out.amount; } else out.why = 'fixed — the list price'; return out; }
    if (kind === 'tiered') {
      var ts = tiersOf(d), hit = null;
      for (var i = 0; i < ts.length; i++) if (q >= ts[i].qty) hit = ts[i];
      if (hit) { out.amount = R2(hit.price); out.tier = hit; out.why = 'tier from ' + hit.qty + ' → ' + hit.price + ' each'; }
      else out.why = ts.length ? 'below the first break (' + ts[0].qty + ') — list price' : 'no breaks declared — list price';
      return out;
    }
    if (kind === 'range') {
      var lo = num(d.pricing_min), hi = num(d.pricing_max);
      if (list !== null && ((lo !== null && list < lo) || (hi !== null && list > hi))) out.violation = 'the list price ' + list + ' is outside the band ' + (lo === null ? '' : lo) + '–' + (hi === null ? '' : hi);
      out.why = 'band ' + (lo === null ? '' : lo) + '–' + (hi === null ? '' : hi) + (out.violation ? ' — VIOLATED' : ' — the list price sits in it');
      return out;
    }
    return out;
  }
  /** one line for a screen: "Tiered · 3 breaks" / "Fixed" / "Band 900–1,100" / "List price" */
  function describe(d) {
    d = d || {}; var k = d.pricing_kind;
    if (k === 'tiered') return (d.pricing_def_name || 'Tiered') + ' · ' + tiersOf(d).length + ' break' + (tiersOf(d).length === 1 ? '' : 's');
    if (k === 'fixed') return (d.pricing_def_name || 'Fixed') + (num(d.pricing_amount) !== null ? ' · ' + d.pricing_amount : '');
    if (k === 'range') return (d.pricing_def_name || 'Band') + ' · ' + (d.pricing_min == null ? '' : d.pricing_min) + '–' + (d.pricing_max == null ? '' : d.pricing_max);
    return 'List price';
  }
  /** the bands a tiered structure yields, for a table: [{ from, to, price }] — the first band is the list price */
  function bands(d, listPrice) {
    var ts = tiersOf(d || {}); var list = num(listPrice); var out = [];
    if (!ts.length) return out;
    if (ts[0].qty > 1) out.push({ from: 1, to: ts[0].qty - 1, price: list });
    for (var i = 0; i < ts.length; i++) out.push({ from: ts[i].qty, to: (i + 1 < ts.length) ? ts[i + 1].qty - 1 : null, price: ts[i].price });
    return out;
  }
  root.CBPricing = { KEY: KEY, kinds: KINDS, copyOf: copyOf, setOn: setOn, unitPrice: unitPrice, describe: describe, bands: bands, tiersOf: tiersOf };
})(typeof window !== 'undefined' ? window : this);
