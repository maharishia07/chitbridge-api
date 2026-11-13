'use strict';
/**
 * lib/till-row.js — WHAT A COUNTER IS TOLD ABOUT A PRODUCT'S MONEY, READ ONCE (CTR-244, lifted from routes/till.js).
 *
 * OWNS      rateOf(value) · taxFactsOf(item_data) (hsn · tax_slab · gst_rate · cess_rate · categories as the engine's one input reads them) · soldPriceOf(item_data) (the sellable shelf price or null)
 *           · commercialOf(item_data) → { price, gst_rate, status } (the three figures a price-drift check compares)
 * CALLED BY routes/till.js (tillItem: the snapshot, the recheck door, the rate door) · lib/price-drift.js (the server's drift check at send, via routes/chits.js)
 * FLOW      stored item_data → money.priceOf → sellable-price.soldAt · tax-slab.inputOf → the same figure the counter's row carries
 * CARD      09-counter/README
 *
 * ⚠️ WHY A LIB: the drift check at send (routes/chits.js) must read the row through the SAME projection the snapshot and the recheck door use, and a route may not require a route
 * (routes/chits.js -> routes/till.js is the inversion CTR-244's critic refused). The three readers moved here unchanged; routes/till.js calls them.
 */
const taxSlab = require('./tax-slab');
const sellablePrice = require('./sellable-price');
const itemstatus = require('./itemstatus');
const { priceOf: amountOf } = require('./money');

/** a stored rate as a number, or null for a blank or junk value (a rate is a percentage, never money) */
const rateOf = (value) => (value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value));

/**
 * ⭐⭐ THE ITEM'S TAX FACTS, AS THE ENGINE'S ONE INPUT READS THEM (F5 A1, critic 2 and 12; tax-slab inputOf from engines 1.72.0). A rate typed on the
 * item, or set at the counter's door (POST /rate), reached the catalogue view and never the counter's projection, so the counter billed 0%.
 * gst_rate · tax_slab_name · cess_rate are the slab's travelling copy; `categories` is EVERY id the product cites (the category rung is keyed by id;
 * the resolved NAME still travels as `category` for old tills); hsn also reads `sac` (a service's code) and NEVER `code`: a shop code "D01" would
 * land on a tax invoice. A blank is null — "nobody said", never 0.
 */
function taxFactsOf(item_data) {
  /* engines 1.72.0: the ONE builder (tax_slab · tax_slab_name · gst_rate · cess_rate · categories[] · hsn || sac), blanks left out — the wire says null for them */
  const facts = taxSlab.inputOf(item_data);
  return {
    hsn: facts.hsn !== undefined ? facts.hsn : item_data.hs_code || item_data.hsn_code || null /* the two legacy keys old rows still carry */,
    tax_slab: facts.tax_slab || null,
    gst_rate: rateOf(facts.gst_rate),
    tax_slab_name: facts.tax_slab_name || null,
    cess_rate: rateOf(facts.cess_rate),
    categories: facts.categories || []
  };
}

/** the shelf price a counter may sell at (a stored negative or unreadable price is null: "no price", never 0) */
const soldPriceOf = (item_data) => sellablePrice.soldAt(amountOf((item_data || {}).price));

/** the three figures a drift check compares, as the counter's row carries them: the price, the row's own rate (null when the rate comes from a slab on the shelf), the status word */
function commercialOf(item_data) {
  const data = item_data || {};
  return { price: soldPriceOf(data), gst_rate: taxFactsOf(data).gst_rate, status: itemstatus.statusOf(data) };
}

module.exports = { rateOf, taxFactsOf, soldPriceOf, commercialOf };
