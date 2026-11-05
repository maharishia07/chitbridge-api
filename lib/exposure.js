/**
 * exposure.js — WHAT A CUSTOMER MAY SEE OF AN ITEM, decided per item, enforced in the one projection every surface reads.
 *
 * Athi, 2026-09-05: "shall we create another panel in the catalogue per item — what is to be exposed to the customer? so it
 * is definitive per item: offer, tax (may be default), availability, synonyms, or any other item the business wants to
 * show or not." The switches live on the golden record (`item_data.exposure`), the defaults on the business
 * (`policy_flags.storefront_exposure`), and this module strips the public copy of an item accordingly — so the storefront,
 * the Suppliers screen and the API obey without each knowing the rule. Price and unit are never switchable: nothing can be
 * ordered without them.
 *
 * OWNS      exposureOf (the switches) · apply (the public copy of an item, cost-side keys always deleted)
 * FLOW      item row → exposureOf(business defaults, item switches) → apply: cost-side keys dropped first (lib/cost.js COST_KEYS, fail-closed, no switch), then the switchable fields → the public item
 * CARD      06-catalogue-pim/visibility-and-exposure
 * CALLED BY lib/catalogue-view.js   [from the knowledge graph, 2026-10-18 - regenerate: node tools/graph/trace.cjs]
 */
'use strict';
const DEFAULTS = { tax: true, offers: true, stock: true, synonyms: false, hsn: false, description: true, media: true };
const KEYS = Object.keys(DEFAULTS);

/** the effective switches for one item: business defaults, then the item's own */
function exposureOf(entityFlags, item_data) {
  const base = (entityFlags && typeof entityFlags.storefront_exposure === 'object' && entityFlags.storefront_exposure) || {};
  const ownFlags = (item_data && typeof item_data.exposure === 'object' && item_data.exposure) || {};
  const out = {};
  for (const k of KEYS) out[k] = k in ownFlags ? !!ownFlags[k] : k in base ? !!base[k] : DEFAULTS[k];
  return out;
}

/** strip the PUBLIC copy of an item (the view's output object) of what is not exposed; returns the switches applied */
function apply(item, flags) {
  if (!item) return flags;
  const itemData = (item.item_data = Object.assign({}, item.item_data || {}));
  /**
   * ⚠️⚠️⚠️ COST IS NEVER A SWITCH. Every other field here is a seller's CHOICE — tax, stock, synonyms may be
   * shown or hidden per item. Cost is not: Offer Lab's own spec is explicit — "No customer, reseller or link
   * ever sees it" — so it is deleted unconditionally, the one line above every `if (!flags...)` gate, not folded
   * into DEFAULTS where a future item could opt back in by mistake. [[project-offer-lab]]
   */
  require('./cost').dropCostKeys(itemData); /* P1 2026-10-29: cost, unit_cost, landed_cost, supplier_note, margin … at any depth — the ONE list, lib/cost.js COST_KEYS */
  if (!flags.tax) delete item.tax;
  if (!flags.stock) delete itemData.avail;
  if (!flags.synonyms) {
    delete itemData.synonyms;
    delete itemData.aliases;
    delete itemData.alias;
  }
  if (!flags.hsn) {
    delete itemData.hsn;
    delete itemData.hsn_code;
  }
  if (!flags.description) {
    delete itemData.description;
    delete itemData.desc;
  }
  if (!flags.media) {
    delete itemData.media;
    delete itemData.images;
    delete itemData.image_url;
  }
  /* offers: the engine honours an opt-out list on the line; '*' means every offer (offers.js / offers-engine.js) */
  if (!flags.offers) itemData.offers_excluded = ['*'];
  itemData.exposure = flags; /* the public copy says what was applied, so a row can explain itself */
  return flags;
}
module.exports = { DEFAULTS, KEYS, exposureOf, apply };
