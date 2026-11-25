'use strict';
/**
 * lib/catalogue-rate-menu.js — A TAX RATE THE SHOP'S COUNTRY DOES NOT LIST IS REFUSED IN WORDS (Y-F-03, walk Y; split out of lib/catalogue-write.js so that file holds its size row)
 * OWNER     cb-catalogue
 * RISK      money
 * OWNS      rateMenuRefusal(entity_id, item_data, stored) → the sentence or null: an AU shop's 10 or 0, never 15 or 5
 * CALLED BY lib/catalogue-write.js judgeItem (re-exported there: the typed door and the deferred doors judge with the same rule)
 * FLOW      item_data.gst_rate ──> a rate worth judging (given, a number, not the one the row already holds) ──> the shop's country (lib/profile.countryOf) ──> tax-packs.menuAsOf ──> listed: null · not listed: the sentence naming the rates
 * CARD      storefront-and-catalogue/catalogue-write
 * The list is the pack's own menu in force (tax-packs.menuAsOf: AU [0, 10]); a country with no pack or no menu judges nothing, and a rate the row already holds unchanged passes (a legacy row stays editable).
 */
const { boundRead } = require('./bound-read'); /* SEC-185: identities are read under their own binding */

/** the rate this write asks for when it is worth judging: given, a number, and not the one the stored row already holds; else null */
function rateToJudge(item_data, stored) {
  const given = item_data ? item_data.gst_rate : undefined;
  if (given === undefined || given === null || String(given).trim() === '' || (stored && String(stored.gst_rate) === String(given))) return null;
  const rate = Number(given);
  return Number.isFinite(rate) ? rate : null;
}

/** the rates the shop's country pack lists in force, as numbers; [] when the country has no pack or no menu */
async function menuRatesOf(entity_id) {
  const row = (await boundRead(require('../db').query, entity_id, 'SELECT country, gstn FROM identities WHERE identity_id = $1', [entity_id])).rows[0] || {};
  const packs = require('./tax-packs');
  const pack = packs.packFor(require('./profile').countryOf({ country: row.country, gstin: row.gstn }));
  const menu = pack && packs.menuAsOf ? packs.menuAsOf(pack) : null;
  return menu && Array.isArray(menu.rates) ? menu.rates.map(Number) : [];
}

/** "5%, 12% or 18%" (one rate: just "5%") */
function ratesInWords(rates) {
  const words = rates.map((rate) => rate + '%');
  return words.length > 1 ? words.slice(0, -1).join(', ') + ' or ' + words[words.length - 1] : words[0];
}

/**
 * Y-F-03 (walk Y): a tax rate the shop's COUNTRY PACK does not list is refused in words (an AU shop: 10 or 0, never 15 or 5). → the sentence or null.
 */
async function rateMenuRefusal(entity_id, item_data, stored) {
  const rate = rateToJudge(item_data, stored);
  if (rate === null) return null;
  const rates = await menuRatesOf(entity_id);
  if (!rates.length || rates.indexOf(rate) >= 0) return null;
  return 'A tax rate of ' + rate + '% is not one the tax rules of your country have. The rates here are ' + ratesInWords(rates) + '.';
}

module.exports = { rateMenuRefusal };
