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
const COUNTRY = require('./country');
const { query } = require('../db');
const { boundRead } = require('./bound-read'); /* SEC-198: the identities read runs under its own id's binding */

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
/* CAT-345: outside the home country the list's pictures are removed before the strip counts them, but the list HAS photos and none were copied: `list` (the blueprint) says so too */
const photosNote = (dropped, list) => (dropped || (list && list.starter.some((row) => row.image)) ? ' · the list’s photos were not copied: add each from the product’s Media' : '');
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

/**
 * WALK-H H-F-03 (21 Nov): the starter lists are Chennai's. A shop in another country is not offered the Indian-only shelves, and an item it adopts from a
 * FRESH-FOOD shelf takes the tax kind its country's pack names for basic food — read from the pack's own supplyKinds table, never a rate typed here.
 * Australia: fresh fruit and vegetables are GST-free (GST Act 1999 Div 38, s.38-4; ato.gov.au › GST-free food). A shelf the pack says nothing about adopts with no kind.
 */
const INDIA_ONLY_SHELVES = Object.freeze(['Pooja & flowers', 'Gourds']);
const INDIA_ONLY_ITEMS = Object.freeze(['Sambar cut', 'Cut bottle gourd']); /* walk X X-F-01: a South-Indian pack line on the Cut & packed shelf; the shelf itself stays */
const FRESH_FOOD_SHELVES = Object.freeze(['Vegetables', 'Gourds', 'Roots & tubers', 'Greens', 'Herbs & aromatics', 'Fruit', 'Exotic']);
const FRESH_FOOD_KIND = Object.freeze({ AU: 'gst_free' }); /* country → the kind in that pack's supplyKinds; a country not named adopts with no kind (the shop sets its slab) */

/** the shop's country as its identity row states it (upper-case), null when none is stated — never India by default */
async function shopCountry(entityId) {
  try {
    const found = await boundRead(query, entityId, 'SELECT country FROM identities WHERE identity_id = $1', [entityId]);
    const code = found.rows[0] && found.rows[0].country;
    return code ? String(code).trim().toUpperCase() : null;
  } catch (failure) {
    log.fellBack('products lists: the shop country was not read — stated as none', failure);
    return null;
  }
}
/** a list card shown to a shop of this country: another country's shelves are left off (India's own shop, and a shop that states no country, see the whole list as before) */
function cardForCountry(card, country) {
  if (!country || country === 'IN') return card;
  const keep = (row) => INDIA_ONLY_SHELVES.indexOf(row.category) < 0 && INDIA_ONLY_ITEMS.indexOf(row.name) < 0;
  const rows = card.rows.filter(keep);
  return Object.assign({}, card, { categories: card.categories.filter((c) => INDIA_ONLY_SHELVES.indexOf(c) < 0), rows, count: rows.length });
}
/** the adopted items, each fresh-food one carrying the kind (and the rate 0 it means) its country's pack defines; the pack's table decides whether the kind exists */
function withPackTaxKind(items, country) {
  const kind = FRESH_FOOD_KIND[country];
  const defined = kind && COUNTRY.packFor(country) && COUNTRY.packFor(country).tax && COUNTRY.packFor(country).tax.supplyKinds;
  if (!defined || !defined[kind]) return items;
  return items.map((item) => (FRESH_FOOD_SHELVES.indexOf(item.categoryName) < 0 ? item : Object.assign({}, item, { tax_kind: kind, gst_rate: defined[kind].rate })));
}

module.exports = { withoutServerOwned, photosNote, dropForeignListPrices, shopCountry, cardForCountry, withPackTaxKind, INDIA_ONLY_SHELVES, INDIA_ONLY_ITEMS };
