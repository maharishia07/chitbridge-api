'use strict';
/**
 * lib/chit-proposal-money.js — what a chit round may say about money before anything is kept (LV-02 · LV-03), split out of lib/chit-proposal.js (a file may not grow).
 * OWNER     cb-rail
 * RISK      money
 * OWNS      refuseLine(price, quantity) (a price or quantity below zero or past the widest the chit columns hold is a 400 in words) · refusePeerMoney(payload) (a peer's invoice is a plain object, its total a non-negative number the chit can hold)
 * CALLED BY lib/chit-proposal.js (priceAndQuantity for our own round, receive for a round that arrived)
 * FLOW      a round's figures ──▶ sign and ceiling (lib/chit-ceiling, the one definition of the widest number) ──▶ a 400 PROPOSAL_BAD / CHIT_AMOUNT_TOO_LARGE, nothing kept
 * CARD      01-rail-core-the-chit/chits-routes
 */
const chitCeiling = require('./chit-ceiling');
const refused = (code, message) => Object.assign(new Error(message), { status: 400, code, refused: true });

/** a price or a quantity below zero is no offer; one past the widest the chit columns hold would fail after the round was half applied */
function refuseLine(price, quantity) {
  if ((Number.isFinite(price) && price < 0) || (Number.isFinite(quantity) && quantity < 0)) throw refused('PROPOSAL_BAD', 'A price and a quantity cannot be below zero.');
  chitCeiling.refuseLine({ price, quantity });
}

/** the money a peer's round carries: an invoice is a plain object, the summary's total a non-negative number the chit can hold */
function refusePeerMoney(payload) {
  const invoice = payload.invoice, total = payload.summary && payload.summary.total_value;
  if (invoice != null && (typeof invoice !== 'object' || Array.isArray(invoice))) throw refused('PROPOSAL_BAD', 'The invoice on that round is not in a form we can keep, so it was not saved.');
  if (total != null && (!Number.isFinite(Number(total)) || Number(total) < 0)) throw refused('PROPOSAL_BAD', 'The total on that round is not a number we can keep, so it was not saved.');
  const over = chitCeiling.overOf({ total, lines: [] });
  if (over) throw chitCeiling.refusalFor(over, payload.currency_code);
}
module.exports = { refuseLine, refusePeerMoney };
