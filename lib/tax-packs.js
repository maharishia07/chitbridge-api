/* ADOPTED from chitbridge-engines v1.10.0 · tax-packs · sha256 7bdc62041052fbd37552bab185ba30936072c609744648eab163ab9f7638fc15 — DO NOT EDIT HERE. Change it in chitbridge-engines, release a version, then run tools/adopt.cjs. */
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
const PACKS = Object.freeze({
  IN: Object.freeze({
    country: 'IN',
    scheme: 'GST',
    supply: 'state',
    rates: Object.freeze([0, 0.25, 3, 5, 12, 18, 28]),
    /* ⭐ TO THE PAISA (Athi, 2026-10-02: "keep it up to paisa … one computation and one value"). The total is the sum
       of its declared components; a rupee-rounded figure, if ever shown, is displayed beside it — never posted. */
    invoice_round_to: 0.01,
    source: 'CGST Act 2017 + IGST Act 2017 ss.7-8 (intra vs inter-state by place of supply); GSTN e-invoice schema INV-01; the rate menu as the engine has carried it since 2026-09-03',
  }),
});

const DEFAULT_COUNTRY = 'IN';

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

const EXPORTS = { PACKS, DEFAULT_COUNTRY, packFor, packForScheme };

/* ⭐ ONE FILE, EVERY HOST: node takes module.exports; a page, the TV and the shop PC take window.CBTaxPacks. */
if (typeof module !== 'undefined' && module.exports) module.exports = EXPORTS;
if (root && typeof root.window !== 'undefined') root.window.CBTaxPacks = EXPORTS;
})(typeof globalThis !== 'undefined' ? globalThis : this);
