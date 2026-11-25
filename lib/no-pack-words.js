'use strict';
// lib/no-pack-words.js — THE ONE SENTENCE FOR A COUNTRY WITH NO PACK (XC-1119, Athi 19 Nov).
// OWNS  the words every door says when a country has no rule pack: books, returns, trial balance, setup, the counter sale, a firm opening the client,
//       the rail invoice a buyer in that country receives. One source; a door never types its own copy.
// CALLED BY lib/country-setup.js (profile → the books gate, setup) · lib/services.js (noPackRefused) · routes/tax.js · lib/books-action.js (a firm reading a
//       no-pack client) · lib/rail-actions / routes/chits accept (the buyer's warning) · lib/send-money.js (the counter sale)
// OWNER cb-country
// RISK  plain
// FLOW  saleOf(e) → { tax_checked:false, notice } for a send of a no-pack shop (it sells, untaxed) · packMissing(country) → "The <Country> pack is missing, so <Country> rules can't be checked."; the name is country-setup.nameOf (the ISO region name)
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
/* engines v1.109.0 throws it as a refused error with code TAX_NO_SCHEME (before: a plain Error); both are the same fact, and any OTHER refusal stays an error */
const isNoPackError = (e) => !!e && (!e.refused || e.code === 'TAX_NO_SCHEME') && /^no tax scheme:/.test(String(e.message));
/** what still works for a shop with no pack (Athi 19 Nov, DECISIONS "A shop with no pack may sell"): it sells; WE do not tax the sale, the owner enters the tax line by hand */
const stillWorks = () => 'You can still sell and send invoices, but ChitBridge does not work out the tax: enter the tax line by hand.';
/** the refusal a door throws: 422 NO_COUNTRY_PACK in the one sentence — never a retryable 503 */
const refusal = (country) => Object.assign(new Error(packMissing(country)), { refused: true, status: 422, code: CODE });

/** a send that met the no-pack refusal is a SALE, not a refusal: { tax_checked:false, notice } (the one sentence + what still works), null for any other error */
const saleOf = (e) => (e && e.refused && e.status === 422 && e.code === CODE ? { tax_checked: false, notice: e.message + ' ' + stillWorks() } : null);

/** the Problem spec a send answers when the engine could not price: a pack-missing refusal keeps its own 422 and words, anything else is the retryable 503 */
function sendFailureSpec(e, said503) {
  return e && e.refused && e.status === 422 ? { status: 422, code: e.code, error: 'The country pack is missing', message: e.message } : said503;
}
/** a change order passes a pack-missing refusal through in its own words (the caller rethrows what this returns) */
const passThrough = (e) => (e && e.refused && e.status === 422 ? e : null);
/** the pack's own word for its tax read as the registered scheme (a UAE shop that says VAT is not refused for using the pack's word); any other word stands */
const schemeOf = (country, scheme) => (scheme && scheme === String((((require('./regulation').packFor(country) || {}).tax) || {}).scheme || '').toLowerCase() ? 'regular' : scheme);
/** the sentence for a country that has no pack, null for one that has (or none given) */
const missingFor = (country) => (country && !require('./regulation').packFor(country) ? packMissing(country) : null);

/** the setup answer's two words about a country with no pack: its tax number is saved, NOT checked (never a quiet 'done') */
const noticeOf = (country) => ({ tax_checked: !missingFor(country), notice: missingFor(country) ? numberUnchecked(country) : null });
/** the identities' countries by id, upper-case: a map (an id with none is absent) */
async function countriesOf(ids) {
  const { withEntity } = require('../db');
  const read = await withEntity(ids[0], (db) => db.query('SELECT identity_id, country FROM identities WHERE identity_id = ANY($1::uuid[])', [ids.map(String)]));
  return new Map(read.rows.filter((row) => row.country).map((row) => [String(row.identity_id), String(row.country).toUpperCase()]));
}
/** the buyer's warning for an invoice from ANOTHER country (null when the sender is the buyer itself, the country is the same, it has a pack, or it could not be read: the accept stands) */
async function buyerWarningFor(buyerId, senderId) {
  if (!senderId || String(senderId) === String(buyerId)) return null;
  try {
    const countries = await countriesOf([buyerId, senderId]);
    const mine = countries.get(String(buyerId));
    return mine && mine !== countries.get(String(senderId)) && missingFor(mine) ? buyerWarning(mine) : null;
  } catch (e) {
    require('./logger').fellBack('chits status: the no-pack buyer warning was not read — the accept stands without it', e);
    return null;
  }
}
/** a pack-missing refusal passes through; any other error becomes what `otherwise()` answers (it logs and words its own refusal) */
const refusalOr = (e, otherwise) => passThrough(e) || otherwise();

module.exports = { stillWorks, saleOf, noticeOf, buyerWarningFor, refusalOr, sendFailureSpec, passThrough, schemeOf, missingFor, CODE, packMissing, numberUnchecked, buyerWarning, isNoPackError, refusal };
