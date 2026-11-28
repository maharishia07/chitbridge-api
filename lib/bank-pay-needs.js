// @stage tested
// @stage-note BB-P1-3: a bank line paid out to a party with no account and no bill is asked, never posted as a payment on account.
'use strict';
/**
 * lib/bank-pay-needs.js — a money-out bank line that names a party but no bill and no account
 * OWNER     cb-accounting
 * RISK      money
 * OWNS      mustNameAccountOrBill(handle, entity, { party, amount_minor }) → the refusal `needs: which_account` (or `which_bill` when one open bill of the party is for exactly this amount); it posts and settles nothing
 * CALLED BY routes/books.js POST /payments via askIfBankLine (only when the body says bank_line: true, direction out, with no allocations)
 * CARD      16-finance/bank-reconciliation-and-bank-rail
 * FLOW      bank_line payment out, no allocations ──▶ open bills of the party (bank-open.openOf, the engine's own outstanding) ──▶ refuse with the question, or let it through (allocations named)
 * ⚠️ The Dues screen pays a supplier on account on purpose and does not send bank_line, so it is unchanged. A statement line that IS a bill (the JONES case) arrives with its allocations and is never asked.
 */
const refuse = require('./books-period').refuse;

/** the refusal the screen branches on: code NEEDS_WHICH_ACCOUNT / NEEDS_WHICH_BILL, `needs` beside it (a code, never prose) */
function needsError(needs, words, bill) {
  const e = refuse(words, needs === 'which_bill' ? 'NEEDS_WHICH_BILL' : 'NEEDS_WHICH_ACCOUNT');
  e.needs = needs;
  e.bill = bill || null;
  return e;
}
/** a bank line (bank_line: true) paid out with no bill named is asked; every other payment passes untouched (the Dues door, money in, a line that names its bill) */
async function askIfBankLine(handle, entity, ask) {
  if (ask.bank_line !== undefined && typeof ask.bank_line !== 'boolean') throw require('./books-period').ask('bank_line is true or false.'); /* fail closed: a word that is not a boolean is refused, never read as no */
  if (ask.bank_line !== true || ask.direction !== 'out' || (ask.allocations && ask.allocations.length)) return;
  await mustNameAccountOrBill(handle, entity, ask);
}
/** throws when the line has nothing to book against: one exact open bill → asked to confirm it (never settled silently); none → asked which account it is */
async function mustNameAccountOrBill(handle, entity, ask) {
  const open = await require('./bank-open').openOf(handle, entity, 'supplier', ask.currency);
  const mine = open.filter((doc) => doc.party === String(ask.party));
  const exact = mine.filter((doc) => doc.open_minor === ask.amount_minor);
  if (exact.length === 1) throw needsError('which_bill', 'This is the same amount as an open bill of theirs. Confirm that bill, or say which account it is. Nothing was posted.', { ref: exact[0].ref, open_minor: exact[0].open_minor });
  throw needsError('which_account', 'Say which account this pays (what it was for), or pick the bill it settles. Nothing was posted.', null);
}
module.exports = { askIfBankLine, mustNameAccountOrBill };
