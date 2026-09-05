/**
 * exposure.js — WHAT A CUSTOMER MAY SEE OF AN ITEM, decided per item, enforced in the one projection every surface reads.
 *
 * Athi, 2026-09-05: "shall we create another panel in the catalogue per item — what is to be exposed to the customer? so it
 * is definitive per item: offer, tax (may be default), availability, synonyms, or any other item the business wants to
 * show or not." The switches live on the golden record (`item_data.exposure`), the defaults on the business
 * (`policy_flags.storefront_exposure`), and this module strips the public copy of an item accordingly — so the storefront,
 * the Suppliers screen and the API obey without each knowing the rule. Price and unit are never switchable: nothing can be
 * ordered without them.
 */
'use strict';
const DEFAULTS = { tax: true, offers: true, stock: true, synonyms: false, hsn: false, description: true, media: true };
const KEYS = Object.keys(DEFAULTS);

/** the effective switches for one item: business defaults, then the item's own */
function exposureOf(entityFlags, item_data) {
  const base = (entityFlags && typeof entityFlags.storefront_exposure === 'object' && entityFlags.storefront_exposure) || {};
  const own = (item_data && typeof item_data.exposure === 'object' && item_data.exposure) || {};
  const out = {};
  for (const k of KEYS) out[k] = (k in own) ? !!own[k] : (k in base) ? !!base[k] : DEFAULTS[k];
  return out;
}

/** strip the PUBLIC copy of an item (the view's output object) of what is not exposed; returns the switches applied */
function apply(it, exp) {
  if (!it) return exp;
  const d = it.item_data = Object.assign({}, it.item_data || {});
  if (!exp.tax) delete it.tax;
  if (!exp.stock) delete d.avail;
  if (!exp.synonyms) { delete d.synonyms; delete d.aliases; delete d.alias; }
  if (!exp.hsn) { delete d.hsn; delete d.hsn_code; }
  if (!exp.description) { delete d.description; delete d.desc; }
  if (!exp.media) { delete d.media; delete d.images; delete d.image_url; }
  /* offers: the engine honours an opt-out list on the line; '*' means every offer (offers.js / offers-engine.js) */
  if (!exp.offers) d.offers_excluded = ['*'];
  d.exposure = exp;   /* the public copy says what was applied, so a row can explain itself */
  return exp;
}
module.exports = { DEFAULTS, KEYS, exposureOf, apply };
