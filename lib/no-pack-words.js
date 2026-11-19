'use strict';
// lib/no-pack-words.js — THE ONE SENTENCE FOR A COUNTRY WITH NO PACK (XC-1119, Athi 19 Nov).
// OWNS  the words every door says when a country has no rule pack: books, returns, trial balance, setup, the counter sale, a firm opening the client,
//       the rail invoice a buyer in that country receives. One source; a door never types its own copy.
// CALLED BY lib/country-setup.js (profile → the books gate, setup) · lib/services.js (noPackRefused) · routes/tax.js · lib/books-action.js (a firm reading a
//       no-pack client) · lib/rail-actions / routes/chits accept (the buyer's warning) · lib/send-money.js (the counter sale)
// FLOW  packMissing(country) → "The <Country> pack is missing, so <Country> rules can't be checked."; the name is country-setup.nameOf (the ISO region name)
// CARD 15-tax-and-country-packs/no-pack-words
const CODE = 'NO_COUNTRY_PACK';

const nameOfCountry = (country) => require('./country-setup').nameOf(String(country || '').trim().toUpperCase()) || String(country || '');

/** the sentence: The <Country> pack is missing, so <Country> rules can't be checked. */
function packMissing(country) {
  const name = nameOfCountry(country);
  return 'The ' + name + " pack is missing, so " + name + " rules can't be checked.";
}
/** the tax number said alongside setup for such a country: it is stored, NOT checked */
function numberUnchecked(country) {
  return packMissing(country) + ' The tax number was saved but is NOT checked.';
}
/** the warning a buyer reads on a rail invoice from another country when ITS country has no pack: a warning, never a block */
function buyerWarning(country) {
  const name = nameOfCountry(country);
  return 'Your ' + name + " pack is missing, so this invoice can't be checked against " + name + ' rules.';
}
/** is this error the engine's "no tax scheme: ... no pack covers the seller" (an adopted file, never edited here) */
const isNoPackError = (e) => !!e && !e.refused && /^no tax scheme:/.test(String(e.message));
/** the refusal a door throws: 422 NO_COUNTRY_PACK in the one sentence — never a retryable 503 */
const refusal = (country) => Object.assign(new Error(packMissing(country)), { refused: true, status: 422, code: CODE });

module.exports = { CODE, packMissing, numberUnchecked, buyerWarning, isNoPackError, refusal };
