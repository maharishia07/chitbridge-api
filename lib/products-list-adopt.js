'use strict';
/**
 * lib/products-list-adopt.js — what the starter-list adopt strips before it writes: server-owned keys, the photos note, and rupee list prices for a shop in another currency.
 * OWNS      withoutServerOwned · photosNote · dropForeignListPrices (no route, no state)
 * CALLED BY routes/products.js (POST /lists/adopt)
 * FLOW      the list's rows -> dropForeignListPrices (currency read) -> withoutServerOwned -> the rows the adopt writes
 * CARD      storefront-and-catalogue/products-routes
 */
const log = require('./logger');
const regional = require('./regional'); // the currency comes from the ENTITY, never from the request
const catcols = require('./catalogue-columns');

/** the list rows without the keys only the server writes (catalogue-columns.SERVER_OWNED: media, image) → { kept, dropped: how many rows lost one } */
function withoutServerOwned(items) {
  const kept = [];
  let dropped = 0;
  for (const item of items) {
    const copy = Object.assign({}, item);
    const owned = catcols.SERVER_OWNED.filter((key) => key in copy);
    for (const key of owned) delete copy[key];
    dropped += owned.length ? 1 : 0;
    kept.push(copy);
  }
  return { kept, dropped };
}
/** CAT-207: the starter list's pictures are not copied (a picture is minted by the server from an upload, never taken from a link in a row): said in words, never silently */
const photosNote = (dropped) => (dropped ? ' · the list’s photos were not copied: add each from the product’s Media' : '');
/** WALK-REG R57 (16 Oct): the starter lists carry INDIAN-RUPEE figures (Chennai market) with no currency of their own. A shop in another
 *  currency must never inherit them as its price (a UAE shop adopted "Tomato AED 40/kg"). The page's own prices are applied AFTER this, so they survive; the list's own
 *  figure is dropped and the line is adopted unpriced. A failed currency read drops the list figures too — unpriced is the safe side. */
async function dropForeignListPrices(items, req) {
  const withoutListPrice = (item) => {
    const copy = Object.assign({}, item);
    delete copy.price;
    return copy;
  };
  let shopCurrency = null;
  try {
    shopCurrency = await regional.currencyFor(req.identity && req.identity.identity_id);
  } catch (failure) {
    log.fellBack('products POST /lists/adopt: the shop currency read failed — list prices dropped', failure);
    return items.map(withoutListPrice);
  }
  if (shopCurrency && String(shopCurrency).toUpperCase() === 'INR')
    return items; /* the lists' figures ARE rupees: kept for a rupee shop only; no money stated → dropped */
  return items.map(withoutListPrice);
}

module.exports = { withoutServerOwned, photosNote, dropForeignListPrices };
