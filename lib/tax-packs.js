/* ADOPTED from chitbridge-engines v1.64.1 · tax-packs · sha256 e3885990e20a64aada0f545316e520176ff3601d9d5a6c6b2d73ce56b00c6248 — DO NOT EDIT HERE. Change it in chitbridge-engines, release a version, then run tools/adopt.cjs. */
/* chitbridge-engines · tax-packs. Edited ONLY in chitbridge-engines/src/tax-packs.js; every platform adopts a released version of it. */
(function (root) {
'use strict';
/**
 * tax-packs.js — WHAT A COUNTRY'S TAX IS, AS DATA. The tax engines hold the arithmetic; this file holds the country.
 *
 * Athi, 2026-09-27: *"we create the tax engine in such a way that it works for any country and each platform can refer
 * this codebase."* So a country is an ENTRY here, never a branch in tax.js. Adding one is a data change with its own tests;
 * the engines do not change.
 *
 * ── WHAT A PACK SAYS ────────────────────────────────────────────────────────────────────────────────────────────
 *   country           ISO 3166-1 alpha-2
 *   scheme            the scheme code a slab and an invoice carry ('GST', 'VAT' …)
 *   supply            how the supply is classified, which decides the heads:
 *                       'state'  — the seller's state against the PLACE OF SUPPLY: same state → split across two heads
 *                                  (CGST + SGST), another state → one head (IGST). India.
 *                       'border' — the seller's country against the buyer's: domestic → the full rate on one head,
 *                                  cross-border → nothing charged (the buyer accounts for it). A VAT country.
 *   rates             the rates the scheme DEFINES, offered as a picker. ⚠️ A MENU, NOT A MAPPING: it says which numbers
 *                     are legal to type, not which one a product attracts (that is per HSN, and the merchant's).
 *   invoice_round_to  the unit the invoice TOTAL rounds to; the difference is declared as RndOffAmt, never hidden.
 *   source            where the rule comes from, so it can be checked rather than believed.
 *
 * ⭐ DEFAULT_COUNTRY is the pack a party with NO country is read under. It is India because every invoice this engine has
 * ever produced was read that way — the default is not new, it is NAMED here instead of being a bare 'GST' inside tax.js.
 * ⚠️ A scheme with no pack (a slab citing 'VAT' before its country is written) keeps the behaviour it always had: the
 * border rule, and a whole-unit round. That round is wrong for most VAT countries — a pack for the country fixes it.
 *
 * ── ZERO DEPENDENCIES · DATA ONLY ───────────────────────────────────────────────────────────────────────────────
 */
/* ⭐ v1.21.0 (core-vs-packs a2): the India tax pack moved, unchanged, to src/reg-in.js (its `tax` member). PACKS.IN is that same frozen object.
   v1.28.0 (review fix): no second registry — PACKS is read from the regulation registry (every registered pack's `tax` member), as accounts-packs reads its chart. */
var REG_ = (typeof CBRegulation !== 'undefined' && CBRegulation && CBRegulation.list) ? CBRegulation : null;
if (!REG_ && typeof require === 'function') REG_ = require('./regulation');
if (!REG_) throw new Error('tax-packs.js needs regulation.js (CBRegulation, with the India pack) loaded before it — add the regulation scripts ahead of this one on the page; see the CHANGELOG, v1.28.0.');
const PACKS = Object.freeze(REG_.list().reduce(function (t, p) { if (p.tax) t[p.id] = p.tax; return t; }, {}));

const DEFAULT_COUNTRY = REG_.DEFAULT;

/** packFor('in') → the pack for that country, or null. Case and spaces do not matter; an unknown country is null, never a guess. */
function packFor(country) {
  const c = String(country == null ? '' : country).trim().toUpperCase();
  return Object.prototype.hasOwnProperty.call(PACKS, c) ? PACKS[c] : null;
}

/** packForScheme('gst') → the pack whose scheme that is, or null. One scheme, one pack — a second would be ambiguous. */
function packForScheme(scheme) {
  const s = String(scheme == null ? '' : scheme).trim().toUpperCase();
  for (const k of Object.keys(PACKS)) if (PACKS[k].scheme === s) return PACKS[k];
  return null;
}

/**
 * rcmCategoryFor(pack, { id?, code? }) → the reverse-charge category (by id, or the first whose code prefix the SAC / HSN starts with), or null.
 * A lookup in the pack's DATA — it decides nothing about who pays; tax.determine applies the supplier's registration to it.
 */
function rcmCategoryFor(pack, q) {
  const list = (pack && pack.rcm && pack.rcm.categories) || [], x = q || {};
  if (x.id != null && x.id !== '') { const id = String(x.id); for (const c of list) if (c.id === id) return c; return null; }
  const code = String(x.code == null ? '' : x.code).replace(/\s+/g, '');
  if (!code) return null;
  for (const c of list) for (const p of c.codes) if (code.indexOf(p) === 0) return c;
  return null;
}

const EXPORTS = { PACKS, DEFAULT_COUNTRY, packFor, packForScheme, rcmCategoryFor };

/* ⭐ ONE FILE, EVERY HOST: node takes module.exports; a page, the TV and the shop PC take window.CBTaxPacks. */
if (typeof module !== 'undefined' && module.exports) module.exports = EXPORTS;
if (root && typeof root.window !== 'undefined') root.window.CBTaxPacks = EXPORTS;
})(typeof globalThis !== 'undefined' ? globalThis : this);
