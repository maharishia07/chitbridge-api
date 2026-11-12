// OWNS      the invoice door's questions to the country pack: reverse charge built? · each line's rate on the dated menu? · the buyer's tax id (CTRY-110 / 111 / 112 / 136, money wave 2 M2).
// CALLED BY lib/services.js computeTax (invoice/build and tax/compute) — before the engine prices a line.
// FLOW      seller country → tax pack (tax-packs) + regulation pack scope → throw a refusal with `said` (tax-contract THROWN maps it to its status) | the notes the bill carries.
// CARD      15-tax-and-country-packs/tax-compute-rate-invoice-tax
/**
 * The pack answers, the door only asks (no country rule is written here):
 *   reverse charge   a pack whose scope names `tax.rcm` as out or partial (AU Div 84; AE: tax.determine does not assess it) → 422 RCM_NOT_BUILT in the PACK's own sentence; India (no such line) is unchanged.
 *   a line's rate    the WHOLE rateOnMenu answer on the seller's day: not on the menu → 422 RATE_NOT_ON_MENU with its `why`; on the menu only for a class (`only`) → the bill stands and carries the sentence as a note.
 *   the buyer's id   the ONE check (profile.taxIdRefusal, the buyer's own country else the seller's) → 400 BUYER_TAX_ID_BAD, the code the bill paper already says.
 * A seller with no country or no pack is NO_COUNTRY / NO_COUNTRY_PACK's to refuse (the engine): nothing is asked here.
 */
'use strict';
const taxPacks = require('./tax-packs');

/** a refusal in the services' thrown shape: `said` = [code, sentence], `code` lower-cased for tax-contract THROWN */
function refusal(code, status, sentence) {
  return Object.assign(new Error(code.toLowerCase() + ': ' + sentence), { code: code.toLowerCase(), status, said: [code, sentence] });
}
/** the pack's own sentence saying reverse charge is out of scope / partial, or null when the country builds it */
function rcmNotBuiltWord(country) {
  const scope = (require('./regulation').packFor(country) || {}).scope || {};
  return (scope.out && scope.out['tax.rcm']) || (scope.partial && scope.partial['tax.rcm']) || null;
}
/** throws RCM_NOT_BUILT when the bill asks for reverse charge in a country whose pack does not build it */
function checkReverseCharge(country, reverseCharge) {
  const word = reverseCharge ? rcmNotBuiltWord(country) : null;
  if (word) throw refusal('RCM_NOT_BUILT', 422, 'Reverse charge is not built for ' + require('./country-setup').nameOf(country) + ' yet: ' + word + '. Send the invoice without reverse charge.');
}
/** each distinct line rate asked of the menu in force on the invoice day; → the `only` sentences (on the menu for a class), throws RATE_NOT_ON_MENU for a rate not on it */
function checkRates(pack, country, lines) {
  const invoiceDay = require('./shop-clock').today(country);
  const notes = [];
  const asked = new Set();
  for (const item of lines) {
    if (item.gst_rate == null || asked.has(item.gst_rate)) continue;
    asked.add(item.gst_rate);
    const answer = taxPacks.rateOnMenu(pack, item.gst_rate, invoiceDay);
    if (!answer.on_menu) throw refusal('RATE_NOT_ON_MENU', 422, 'Line "' + (item.name || 'line') + '": ' + answer.why);
    if (answer.only) notes.push(answer.why);
  }
  return notes;
}
/** throws BUYER_TAX_ID_BAD when the buyer carries a tax number that fails the one check */
function checkBuyerTaxId(country, buyer) {
  const buyerId = buyer ? String(buyer.Gstin || '').trim() : '';
  const refused = buyerId ? require('./profile').taxIdRefusal(buyer.Country || country, buyerId) : null;
  if (refused) throw refusal('BUYER_TAX_ID_BAD', 400, "The buyer's tax number does not check out: " + refused.why);
}
/** the three questions in order → the notes the bill carries ([] when none, and for a seller with no country or pack) */
function askPack(seller, buyer, lines, reverseCharge) {
  const country = String((seller && (seller.Country || seller.country)) || '').trim();
  const pack = country ? taxPacks.packFor(country) : null;
  if (!pack) return [];
  checkReverseCharge(country, reverseCharge);
  const notes = checkRates(pack, country, lines);
  checkBuyerTaxId(country, buyer);
  return notes;
}
module.exports = { askPack };
