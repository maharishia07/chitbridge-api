'use strict';
/**
 * OWNS      the credit note an accepted price DECREASE on an issued invoice issues (ACC-192 slice 1b): the changed lines only, the note chit's body, the idempotent issue
 * CALLED BY lib/chit-proposal.js (sellerRound prices the delta · acceptHere / receiveDecision issue it at the SELLER's installation)
 * FLOW      edits → deltaLines (changed lines only) → chit-proposal.priceMoney (send-money.invoiceOfLines → moneyOfInvoice) → on acceptance issue() → autoraise.sendAs (the ONE send path)
 * CARD      14-accounting/README (ACC-192)
 *
 * ⭐ The note is priced over the CHANGED LINES ONLY (the dropped quantity at the old price, the dropped price on the quantity that stays), per line in the pack's own half-up
 *   rule. It is never total_new − total_old. The original chit and its invoice are never touched. An increase is refused in words (the debit note is slice 2).
 * ⭐ Idempotency key: (issuer entity, original chit_id, proposal_id) — kept as business_json.against.proposal_id; a replayed decision finds the note and issues none.
 */
const { withEntity } = require('../db');
const money = require('./money');

const INCREASE_WORDS = 'This change raises the price of a bill that is already invoiced. A raise needs a debit note, which is not available yet. Ask for the same or a lower price.';
const NO_DROP_WORDS = 'Nothing in this change lowers the bill, so there is no credit note to issue.';
const NOT_ISSUED_WORDS = 'The credit note could not be issued, so the change was not applied on either side. Try again; if it repeats, tell us.';
const refused = (status, code, message) => Object.assign(new Error(message), { status, code, refused: true });

/** a delta line: the live line's own rating fields, the dropped quantity and price, its total in the one rounder; no discount of its own */
function lineOf(live, quantity, price) {
  const line = Object.assign({}, live, { quantity, price, total: money.round(quantity * price), list_price: price });
  delete line.discount;
  return line;
}

/** the delta lines of ONE edit against the line's live form: a removal drops it all; a lower quantity drops the quantity at the old price; a lower price drops the difference on what stays */
function dropsOf(live, edit) {
  const oldQty = Number(live.quantity);
  const oldPrice = Number(live.price);
  if (edit.line === null) return [lineOf(live, oldQty, oldPrice)];
  const newQty = Number(edit.line.quantity);
  const newPrice = Number(edit.line.price);
  if (newQty > oldQty || newPrice > oldPrice) throw refused(409, 'INVOICE_INCREASE_REFUSED', INCREASE_WORDS);
  const drops = [];
  if (newQty < oldQty) drops.push(lineOf(live, oldQty - newQty, oldPrice));
  if (newPrice < oldPrice && newQty > 0) drops.push(lineOf(live, newQty, oldPrice - newPrice));
  return drops;
}

/** deltaLines(copy, edits) — the changed lines of a priced round, from the copy's live set; throws on a raise or on a change that lowers nothing */
function deltaLines(copy, edits) {
  const lines = [];
  for (const edit of edits || []) {
    const entry = copy.live[edit.line_index];
    if (entry && entry.live) lines.push(...dropsOf(Object.assign({}, copy.lines[edit.line_index], entry.live), edit));
  }
  if (!lines.length) throw refused(409, 'INVOICE_INCREASE_REFUSED', NO_DROP_WORDS);
  return lines;
}

/** the note already issued for this round (the idempotency key), or null */
async function existingNote(issuer, chit_id, proposal_id) {
  const found = await withEntity(issuer, (db) =>
    db.query("SELECT chit_id FROM chit_header WHERE entity_id = $1 AND purpose = 'credit_note' AND business_json -> 'against' ->> 'chit_id' = $2 AND business_json -> 'against' ->> 'proposal_id' = $3 LIMIT 1", [issuer, String(chit_id), String(proposal_id)])
  );
  return found.rows[0] ? String(found.rows[0].chit_id) : null;
}

/** the next number in the issuer's own credit-note series: CN/<year>/<n>, one past the highest it has issued */
async function nextNumber(issuer, year) {
  const found = await withEntity(issuer, (db) =>
    db.query("SELECT coalesce(max(substring(business_json ->> 'printed_as' from '[0-9]+$')::int), 0) + 1 AS next FROM chit_header WHERE entity_id = $1 AND purpose = 'credit_note' AND sender_entity_id = $1", [issuer])
  );
  return 'CN/' + year + '/' + String((found.rows[0] && found.rows[0].next) || 1).padStart(4, '0');
}

/** the original invoice, named: { chit_id, invoice_no, invoice_date, issuer } (+ the round that made the note) */
function againstOf(chit_id, original, issuerBridge, proposal_id) {
  const invoice = original.invoice || {};
  return {
    chit_id: String(chit_id),
    invoice_no: original.bill_no || original.printed_as || original.invoice_no || (invoice.DocDtls && invoice.DocDtls.No) || null,
    invoice_date: (invoice.DocDtls && invoice.DocDtls.Dt) || original.billed_at || null,
    issuer: issuerBridge || null,
    proposal_id: String(proposal_id)
  };
}

let sender = null;
/** tests: stand in for lib/autoraise.sendAs (null puts the real loopback back) */
function useSender(fn) {
  sender = fn || null;
}

/**
 * issue({ issuer, buyer, chit_id, row, copy, original, issuerBridge, year }) → { chit_id, duplicate } — ONE credit note chit at the seller's installation through the ONE send path.
 * The note carries the round's invoice (the delta the engine priced when it was proposed, byte for byte) so the send copies its money and prices nothing again.
 * A refused send is a refusal in words; nothing is applied by the caller then.
 */
async function issue(args) {
  const { issuer, buyer, chit_id, row, original } = args;
  const against = againstOf(chit_id, original, args.issuerBridge, row.proposal_id);
  const found = await existingNote(issuer, chit_id, row.proposal_id);
  if (found) return { chit_id: found, duplicate: true };
  const printed_as = await nextNumber(issuer, args.year);
  const body = {
    recipients: [{ entity_id: buyer, role: 'to' }],
    purpose: 'credit_note',
    manual_subject: 'Credit note ' + printed_as + (against.invoice_no ? ' against ' + against.invoice_no : ''),
    line_items: deltaLines(args.copy, row.edits),
    business_json: { invoice: row.invoice, against, printed_as, currency: row.currency_code, customer: { entity_id: buyer } }
  };
  const sent = await (sender || require('./autoraise').sendAs)(issuer, body, { idempotency_key: 'acc192-note:' + chit_id + ':' + row.proposal_id });
  if (!sent.ok) throw refused(409, 'CREDIT_NOTE_NOT_ISSUED', NOT_ISSUED_WORDS + (sent.body && (sent.body.message || sent.body.error) ? ' (' + (sent.body.message || sent.body.error) + ')' : ''));
  return { chit_id: sent.body.chit_id, duplicate: false };
}

module.exports = { deltaLines, dropsOf, existingNote, issue, againstOf, useSender, INCREASE_WORDS };
