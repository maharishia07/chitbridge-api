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
 * P-F-05 (batch 1129): a shop that SAID it is unregistered gets gst_rate 0 (bill word unregistered_seller), never no answer; an unknown registration still gets none (the till refuses it in words, TAX_LINE_UNAVAILABLE).
 * WHY: an AU shop's new "Yoghurt A$5.00" had no gst_rate, so the till billed 19.80 as 19.80 sales and GST 0 (hand: 19.80 / 11 = 1.80). The walker saw no GST label either.
 * The rate is the PACK's `standard_rate` (AU 10, AE 5) — data in the country pack, never a number typed here. Only where it is true:
 *   · the shop CHARGES tax (a registration that may charge AND a tax id: tax-shelf.chargesTax === true) — an unregistered or unknown shop is "not handed a rate it never asked for" (catalogue-blueprint);
 *   · the pack HAS one standard rate (India's slab-rated GST has none, the US has none: they stay "nobody said");
 *   · the item names no rate, no slab and no category (a category may carry the slab; a rate stamped here would override it).
 * ⚠️ A rate the person typed — even 0 — is never replaced.
 */
const taxShelf = require('./tax-shelf');
const taxPacks = require('./tax-packs');
const { boundRead } = require('./bound-read'); /* SEC-185: identities are read under their own binding */
const countrySetup = require('./country-setup');

/* the shop row, entity-scoped by the caller's query; with the answer it also reads the registration answer in the same statement (entity_governance exists from b299) */

const saidRate = (value) => value !== undefined && value !== null && String(value).trim() !== '';
const citesSlabOrCategory = (item) => !!(item.tax_slab || item.tax_slab_name || (Array.isArray(item.categories) && item.categories.length) || item.category || item.categoryName);

/** defaultRateOf(item, standardRate) → the rate this item gets, or null when it has its own, cites a slab or category, or the shop has no standard rate to give */
function defaultRateOf(item, standardRate) {
  if (!item || typeof item !== 'object' || saidRate(item.gst_rate) || citesSlabOrCategory(item)) return null;
  return typeof standardRate === 'number' && isFinite(standardRate) ? standardRate : null;
}

/** the rate a new item of this shop gets, on the caller's entity-scoped `query`: the pack's standard rate when the shop CHARGES tax; 0 when the shop SAID it is unregistered (the bill then says ZERO · unregistered_seller, tax-lines DOC_ZERO_WORD: a shop that does not charge answers 0, not nothing — P-F-05); else null (unknown · no pack standard rate). One read of identities; the cached registration answer is read once */
async function standardRateOf(entity_id, query) {
  /* ONE read: the shop row and its registration answer together (entity_governance exists from b299): a second transaction for the answer cost the starter catalogue one more trip */
  const withAnswer = await countrySetup.migrated();
  const shop = await readShopRow(entity_id, query, withAnswer);
  const pack = taxPacks.packFor(shop.country);
  const registration = withAnswer ? registrationOfShop(shop) : null;
  if (registration === 'unregistered') return 0;
  if (lacksTaxId(shop, pack)) return null; /* chargesTax needs a tax id (or a pack that collects without one) */
  const flags = shop.policy_flags && typeof shop.policy_flags === 'object' ? shop.policy_flags : {};
  const charges = taxShelf.chargesTax({ gstin: shop.gstn, reg_type: countrySetup.registrationWord(registration, flags.gst_registration) }, pack);
  return charges === true && pack ? pack.standard_rate : null;
}

/** true when the shop has no tax id and its country's pack does not collect tax without one */
function lacksTaxId(shop, pack) {
  return !String(shop.gstn || '').trim() && !(pack && pack.collect_without_tax_id);
}

/** the shop's identities row ({} when none), with its cached registration answer when entity_governance exists */
async function readShopRow(entity_id, query, withAnswer) {
  const result = await boundRead(query, entity_id, withAnswer
    ? 'SELECT i.gstn, i.country, i.policy_flags, g.tax_registration FROM identities i LEFT JOIN entity_governance g ON g.entity_id = i.identity_id WHERE i.identity_id = $1'
    : 'SELECT i.gstn, i.country, i.policy_flags FROM identities i WHERE i.identity_id = $1', [entity_id]);
  return result.rows[0] || {};
}

/** the registration state the shop's own answer (or its tax id and scheme) gives, by the country setup's one reader */
function registrationOfShop(shop) {
  const answered = shop.tax_registration && typeof shop.tax_registration === 'object' ? shop.tax_registration : {};
  return countrySetup.registrationOf({ country: shop.country, number: answered.number || shop.gstn, scheme: (shop.policy_flags || {}).gst_registration, tax_registration: shop.tax_registration || null });
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

/** a line that already says its own tax: a rate (either word), a slab or category, a kind, or a reverse-charge category: never given the standard rate */
const saysOwnTax = (line) => !line || line.removed || saidRate(line.gst_rate) || saidRate(line.rate) || citesSlabOrCategory(line) || !!(line.tax_kind || line.nil_kind || line.supply_kind || line.rcm_category);

/**
 * stampTypedLines(seller, lines, blankAt, query) → the lines of a SEND. A line TYPED into a chit (Workshop > Compose names no catalogue item and no rate) carries the seller country's standard rate,
 * the same rule as a new product (defaultRateOf: a registered shop that charges, a pack with ONE standard rate: AU 10, AE 5); never a number typed here. 27 Nov 2026 (TAXLINE-1132): an AU shop's
 * typed "Brake pad set" was refused TAX_LINE_UNAVAILABLE because the shelf could not match it and nothing else rated it. A line that SENT a blank rate (blankAt: BAD_RATE, never 0%) and a line that
 * says its own tax are left as they are; India has no standard rate, so a typed line there stays unrated and is refused in words (slab by HSN, never a guess). Called after the shelf has answered.
 */
async function stampTypedLines(entity_id, lines, blankAt, query) {
  const list = Array.isArray(lines) ? lines : [];
  const skip = new Set(blankAt || []);
  const at = list.map((line, index) => index).filter((index) => !skip.has(index) && !saysOwnTax(list[index]));
  if (!at.length) return list;
  const stamped = await stampDefault(entity_id, at.map((index) => list[index]), query);
  return list.map((line, index) => (at.includes(index) ? stamped[at.indexOf(index)] : line));
}

module.exports = { defaultRateOf, stampDefault, stampTypedLines, standardRateOf };
