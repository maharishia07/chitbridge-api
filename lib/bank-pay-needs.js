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
/** the open bills of this supplier that are for exactly this amount, each { ref, open_minor }: the ONE finder (bank-open.openOf, the engine's own outstanding) behind both the /payments ask and the /events ask */
async function exactBillsOf(handle, entity, party, amount_minor, currency) {
  const open = await require('./bank-open').openOf(handle, entity, 'supplier', currency);
  return open.filter((doc) => doc.party === String(party) && doc.open_minor === amount_minor).map((doc) => ({ ref: doc.ref, open_minor: doc.open_minor }));
}
/** throws when the line has nothing to book against: one exact open bill → asked to confirm it (never settled silently); none → asked which account it is */
async function mustNameAccountOrBill(handle, entity, ask) {
  const exact = await exactBillsOf(handle, entity, ask.party, ask.amount_minor, ask.currency);
  if (exact.length === 1) throw needsError('which_bill', 'This is the same amount as an open bill of theirs. Confirm that bill, or say which account it is. Nothing was posted.', exact[0]);
  throw needsError('which_account', 'Say which account this pays (what it was for), or pick the bill it settles. Nothing was posted.', null);
}
/**
 * BB-P1-3: POST /events kind bank_expense_supplier (expense + payment, one entry) must not double-count a bill: when the supplier has an open bill of exactly the line's GROSS (net + the tax inside it),
 * the line is ASKED (422 NEEDS_WHICH_BILL, the first bill in `bill`, every ref in `bills`), nothing posted. not_this_bill: true (a strict boolean) is the owner's "no, a new expense": it posts and
 * says which bills it was not. A reference already posted is left to the duplicate guard (a replay answers the first entry). → { skipped: [refs] } (what the owner said no to), or throws.
 */
async function askIfSupplierBill(handle, entity, line) {
  if (line.not_this_bill !== undefined && typeof line.not_this_bill !== 'boolean') throw require('./books-period').ask('not_this_bill is true or false.'); /* fail closed */
  const exact = await exactBillsOf(handle, entity, line.party, line.gross_minor, line.currency);
  if (!exact.length) return { skipped: [] };
  const seen = line.preview ? await line.preview().catch((err) => { require('./logger').warn('bank-pay-needs: the duplicate preview failed, so the line is asked as if new', { err: err && err.message }); return null; }) : null;
  if (seen && seen.duplicate) return { skipped: [] };
  if (line.not_this_bill === true) return { skipped: exact.map((doc) => doc.ref) };
  const e = needsError('which_bill', 'This is the same amount as an open bill of theirs. Use that bill, or say it is a new expense (not_this_bill). Nothing was posted.', exact[0]);
  e.bills = exact.map((doc) => doc.ref);
  throw e;
}
module.exports = { askIfBankLine, mustNameAccountOrBill, askIfSupplierBill, exactBillsOf };
