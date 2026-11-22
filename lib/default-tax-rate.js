'use strict';
/**
 * lib/default-tax-rate.js — A NEW PRODUCT IN A TAX-REGISTERED SHOP CARRIES THE COUNTRY'S RATE, NOT NOTHING (WALK-D D-F-08, 21 Nov 2026).
 *
 * OWNER     cb-accounting
 * RISK      money
 * OWNS      defaultRateOf (pure: the rate a new item gets, or null) · stampDefault (items in → the same items with the rate written where it applies; one shop read)
 * CALLED BY lib/mint-product.js (a person's form, a delivery adopted, a combo pushed) · lib/catalogue-write.js writeItems (the CSV import, the starter catalogue, the bulk door)
 * FLOW      shop (country · tax id · registration) → tax-shelf.chargesTax + tax-packs.packFor(country).standard_rate → item with no rate of its own gets gst_rate
 * CARD      15-tax-and-country-packs/tax-compute-rate-invoice-tax
 *
 * WHY: an AU shop's new "Yoghurt A$5.00" had no gst_rate, so the till billed 19.80 as 19.80 sales and GST 0 (hand: 19.80 / 11 = 1.80). The walker saw no GST label either.
 * The rate is the PACK's `standard_rate` (AU 10, AE 5) — data in the country pack, never a number typed here. Only where it is true:
 *   · the shop CHARGES tax (a registration that may charge AND a tax id: tax-shelf.chargesTax === true) — an unregistered or unknown shop is "not handed a rate it never asked for" (catalogue-blueprint);
 *   · the pack HAS one standard rate (India's slab-rated GST has none, the US has none: they stay "nobody said");
 *   · the item names no rate, no slab and no category (a category may carry the slab; a rate stamped here would override it).
 * ⚠️ A rate the person typed — even 0 — is never replaced.
 */
const taxShelf = require('./tax-shelf');
const taxPacks = require('./tax-packs');
const countrySetup = require('./country-setup');

const saidRate = (value) => value !== undefined && value !== null && String(value).trim() !== '';
const citesSlabOrCategory = (item) => !!(item.tax_slab || item.tax_slab_name || (Array.isArray(item.categories) && item.categories.length) || item.category || item.categoryName);

/** defaultRateOf(item, standardRate) → the rate this item gets, or null when it has its own, cites a slab or category, or the shop has no standard rate to give */
function defaultRateOf(item, standardRate) {
  if (!item || typeof item !== 'object' || saidRate(item.gst_rate) || citesSlabOrCategory(item)) return null;
  return typeof standardRate === 'number' && isFinite(standardRate) ? standardRate : null;
}

/** the shop's standard rate when it charges tax, else null: one read of identities (country · tax id · policy flags), on the caller's entity-scoped `query`, and the cached registration answer only when a tax id is there to qualify */
async function standardRateOf(entity_id, query) {
  const shop = (await query('SELECT gstn, country, policy_flags FROM identities WHERE identity_id = $1', [entity_id])).rows[0] || {};
  const pack = taxPacks.packFor(shop.country);
  if (!String(shop.gstn || '').trim() && !(pack && pack.collect_without_tax_id)) return null; /* chargesTax needs a tax id (or a pack that collects without one): no read of the registration */
  const registration = await countrySetup.registrationOfShop(entity_id);
  const flags = shop.policy_flags && typeof shop.policy_flags === 'object' ? shop.policy_flags : {};
  const charges = taxShelf.chargesTax({ gstin: shop.gstn, reg_type: countrySetup.registrationWord(registration, flags.gst_registration) }, pack);
  return charges === true && pack ? pack.standard_rate : null;
}

/**
 * stampDefault(entity_id, items, query) → (query = the entity-scoped query the writer already holds: db queryFor(entity_id)) the items, each with gst_rate written where defaultRateOf says so (copies, the input is not changed).
 * ⚠️ Fails open: a shop that cannot be read leaves the items as sent (the way it was) and says so in the log.
 */
async function stampDefault(entity_id, items, query) {
  const list = Array.isArray(items) ? items : [];
  if (!list.some((item) => defaultRateOf(item, 1) !== null)) return list; /* nothing needs a rate: no read */
  try {
    const standard = await standardRateOf(entity_id, query);
    return list.map((item) => {
      const rate = defaultRateOf(item, standard);
      return rate === null ? item : Object.assign({}, item, { gst_rate: rate });
    });
  } catch (e) {
    require('./logger').fellBack('default-tax-rate stampDefault: the shop could not be read — the items go as sent', e);
    return list;
  }
}

module.exports = { defaultRateOf, stampDefault, standardRateOf };
