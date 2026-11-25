'use strict';
/**
 * CARD 14-accounting/tax-return
 * books-return-registration.js — GREY-AU (U-F-09): the answer of GET /returns for a shop that SAID it is not registered for the tax.
 * OWNER     cb-accounting
 * RISK      money
 * OWNS      notRegisteredWhy · unregisteredAnswer
 * CALLED BY lib/books-period.js taxReturn (registration read once, before the transaction, from country-setup.registrationOfShop — the ONE reader; 'unknown' is never read as 'no')
 * FLOW      registration 'unregistered' → the empty form + needs 'registration' + the sentence → the page greys Close with it; no boxes are drawn (ATO: only a GST-registered entity lodges GST on a BAS)
 */
/** the sentence: the pack's word for the tax and for its return (GST · BAS, VAT · VAT return), never typed here */
const notRegisteredWhy = (country, returnName) => 'This shop is not registered for ' + require('./tax-shelf').taxWordOf(country) + ', so there is no ' + (returnName || 'return') + ' to lodge.';
/** the return's own answer shape with nothing in it: no period, no boxes, nothing to pay (the same empty form a period table that cannot be built gives) */
function unregisteredAnswer(base, packId, returnsDef) {
  return Object.assign(base, { asked: {}, needs: 'registration', why: notRegisteredWhy(packId, returnsDef.short), periods: [], period: null, boxes: [], payable_minor: 0, refund_minor: 0, net_minor: 0, notes: [], cite: null, emirates: returnsDef.emirates || [], staggers: returnsDef.staggers || {} });
}
module.exports = { notRegisteredWhy, unregisteredAnswer };
