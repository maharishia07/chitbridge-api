// @stage tested
'use strict';
/**
 * tax-engine-line.js — ONE bill line as the tax engine reads it (the input half of lib/tax-lines.js invoiceFor).
 *
 * OWNS      engineLineOf (quantity, price, offer discount, list price, rate, cess, HSN, supply kind, reverse-charge category) and rcmCategoryOf (the category a line names).
 * OWNER     cb-accounting
 * CALLED BY lib/tax-lines.js (invoiceFor: rcmCategoryOf and engineLineOf; both re-exported there)
 * FLOW      a minted bill line → engineLineOf → the engine's line (a rate that was never given stays absent, never 0)
 * CARD      15-tax-and-country-packs/tax-compute-rate-invoice-tax
 * RISK      a missing rate read as 0% (taxes nothing and says nothing) · the offer lost from the invoice — pinned by tests/tax-explicit-1129.test.cjs and tests/rcm-post.test.cjs
 * ZERO DEPENDENCIES · TIER A
 */
const num = (values) => {
  const n = Number(values);
  return Number.isFinite(n) ? n : null;
};
/** the first of these that reads as a number, or undefined when none does */
const firstNumber = (...candidates) => candidates.map(num).find((found) => found !== null);

/**
 * RCM-POST: the reverse-charge category a line NAMES — `line_items[].rcm_category`, the pack's id (docs/FIELDS.md) — or null. Not a lookup:
 * tax-packs.rcmCategoryFor resolves the id against the pack and tax.determine applies the registration tests; this only reads the mark.
 * ⚠️ On a bill that carries one marked line the engine also matches the OTHER lines by SAC/HSN prefix (its v1.20 rule) — the one place that changes is the engine.
 */
function rcmCategoryOf(line) {
  const values = line && (line.rcm_category != null ? line.rcm_category : line.rcmCategory);
  const sellerData = values == null ? '' : String(values).trim().toLowerCase();
  return sellerData || undefined;
}

/* ⭐ ACC-206 (engines v1.75.1, Athi 2026-11-02): the line's list price rides to the ENGINE, which says the savings of a line sold below it (gross at list,
   the difference as Discount; owed and tax unchanged); absent, null or blank = NO list_price key (num() would read them as 0), as the engine reads it. The api adds nothing up (keepOffer is gone). */
const listPriceOf = (item) => {
  const given = item.list_price !== undefined && item.list_price !== null && String(item.list_price).trim() !== '';
  return given && num(item.list_price) !== null ? { list_price: num(item.list_price) } : {};
};

/** the supply kind and nil kind a line carries, each present only when the line says it (AE-F-11; G-F-02: the engine reads either word, tax.js:782, so supply_kind must not be dropped) */
function kindFieldsOf(item) {
  const kind = item.tax_kind || item.supply_kind;
  return { ...(kind ? { tax_kind: kind } : {}), ...(item.nil_kind ? { nil_kind: item.nil_kind } : {}) };
}

/** the offer as the invoice's discount (the storefront path writes l.offer = { off, label } and leaves l.price at the listed price; without this the invoice said Discount 0 and taxed the listed price, two-party tour 2026-09-05) */
const discountOf = (item) => num(item.discount) || (item.offer && num(item.offer.off)) || 0;

/** one bill line as the tax engine reads it: quantity, price (listed, less the offer), rate (absent stays absent), cess, HSN, supply kind, reverse-charge category */
function engineLineOf(item) {
  return {
    id: item.line_id || null,
    name: item.name || item.particulars || '',
    qty: firstNumber(item.quantity, item.qty) ?? 0,
    unit_price: firstNumber(item.price, item.unit_price) ?? 0,
    unit: item.unit || '',
    discount: discountOf(item),
    ...listPriceOf(item),
    /* RCM-POST: a reverse-charge line with no rate of its own takes the pack's notified option (rate undefined, never 0 — 0 would tax nothing and note it); TAX-EXPLICIT: a line that gave NO rate reaches the engine as no rate (it marks _unrated and the status is UNAVAILABLE), never as a 0% a seller did not state */
    rate: firstNumber(item.gst_rate, item.rate),
    cess_rate: num(item.cess_rate) || 0,
    hsn: item.hsn || '',
    tax_scheme: item.tax_scheme || undefined,
    ...kindFieldsOf(item),
    /* RCM-POST: the line's reverse-charge category — the PACK's id (reg-in rcm.categories: gta · legal · rent_unregistered …), carried as the line names it */
    rcm_category: rcmCategoryOf(item)
  };
}

module.exports = { engineLineOf, rcmCategoryOf };
