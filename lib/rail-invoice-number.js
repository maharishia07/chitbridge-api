'use strict';
/**
 * lib/rail-invoice-number.js — THE NUMBER OF A RAIL INVOICE: given from the seller's own series when blank, in the country's format, unique per seller per financial year (AS-F-03, walk AS, 22 Nov 2026; critic 1129)
 * OWNS      railNumberStep (the send step) · duplicateIn (the seller's own earlier document with the same number, compared the way lib/bill-no.billNoOf compares)
 * OWNER     cb-rail
 * CALLED BY routes/chits.js SEND_STEPS (after sendBillNumber, which judges a counter bill's number at the till door)
 * FLOW      POST /api/chits/send (invoice · credit_note · debit_note, not a draft, not a counter bill) → billNoRawOf (lib/bill-no, THE reader of the number: bill_no, printed_as, invoice_no, doc_no)
 *           → blank: the next number of the seller's series (lib/price-note.nextSequence + numberOf, the series the further invoice and the notes already use) is written onto the document
 *           → typed: docnumber.check (THE country rule) → duplicateIn (one read) → 422 BILL_NO_BAD or on
 * RISK      a tax invoice with a 26-character or a repeated number (the walk accepted both; DocDtls.No came back null)
 * RULE      LEADERS ASSIGN (Xero, Zoho Books, QuickBooks and Tally give the next number when the person leaves it blank), so a blank number on a final document is ASSIGNED, never refused; only a duplicate or a malformed
 *           number the person TYPED is refused, in words. A draft is never judged and never numbered (read from the body at this step: sendState.is_draft is set 12 steps later, by sendFanOut).
 *           The format is docnumber.check's, never copied (India: at most 16 characters, letters, digits, / and -; CGST Rules r.46: not cited in CITE-1129). A country whose rule is not verified is not judged and
 *           not numbered (same line as the till door): an unstudied country's loose default is not law. The financial year is the country pack's start month (country-setup.fyStartOf).
 *           A document the SERVER raises (the loopback send, token kind 'auto': repeat supply) with no number is left to its own series; a number it does carry is judged like any other.
 *           A number assigned here and then refused by a later step goes back to the series when it was the last taken (price-note.giveBackNumber), so a refused send leaves no gap.
 *           Unique per seller, per document kind (an invoice series and a credit-note series are two series), within the financial year. The same client_ref is the same document (a replay), never a duplicate.
 */
const docnumber = require('./docnumber');
const { problem } = require('./problem');
const { said, codeOfStatus } = require('./chits-contract');
const { isTrue } = require('./chits-input');
const { withEntity } = require('../db');

const BILLING = ['invoice', 'credit_note', 'debit_note'];
const ASSIGN_TRIES = 5; /* a typed number may already hold the next one of the series: take the one after, a few times */

/** the seller's own earlier document of this kind with this number (case and spaces aside, as lib/bill-no.billNoOf reads it) since the financial year began (another client_ref), or null */
async function duplicateIn(sender_id, purpose, number, sinceDay, clientRef) {
  const found = await withEntity(sender_id, (db) =>
    db.query(
      `SELECT chit_id FROM chit_header
        WHERE entity_id = $1 AND sender_entity_id = $1 AND purpose = $2 AND COALESCE(role, '') <> 'Draft'
          AND upper(replace(COALESCE(NULLIF(business_json->>'bill_no', ''), NULLIF(business_json->>'printed_as', ''), NULLIF(business_json->>'invoice_no', ''), NULLIF(business_json->>'doc_no', ''), ''), ' ', '')) = upper(replace($3, ' ', ''))
          AND created_at >= $4::date AND COALESCE(business_json->>'client_ref', '') <> COALESCE($5, '') LIMIT 1`,
      [sender_id, purpose, number, sinceDay, clientRef || null]
    )
  );
  return found.rows[0] || null;
}
const refuse = (req, res, message) => {
  res.locals.code = 'BILL_NO_BAD';
  return problem(req, res, { status: 422, ...said({ error: 'Invoice number refused', code: 'BILL_NO_BAD', field: 'business_json.bill_no', message: message + ' The document was not taken - number it again and send it.' }, codeOfStatus(422)) });
};

/** the seller's next number of this kind, written onto the document (bill_no and printed_as: the two the invoice stamp reads); gives a reserved number back if the send ends refused */
async function assignNext(req, res, { sender_id, purpose, country, sinceDay, clientRef }, lookup, hooks) {
  const business = req.body.business_json && typeof req.body.business_json === 'object' ? req.body.business_json : (req.body.business_json = {});
  const prefix = hooks.DOCUMENTS[purpose].prefix;
  for (let attempt = 0; attempt < ASSIGN_TRIES; attempt++) {
    const sequence = await hooks.nextSequence(sender_id, purpose, prefix);
    const number = hooks.numberOf({ country, purpose, prefix, sequence });
    if (await lookup(sender_id, purpose, number, sinceDay, clientRef)) continue;
    business.bill_no = number;
    business.printed_as = number;
    if (res && typeof res.once === 'function') res.once('finish', () => { if (res.statusCode >= 400) hooks.giveBackNumber(sender_id, prefix, sequence).catch(() => {}); });
    return number;
  }
  return null;
}

const railNumberStep = (countryOfEntity, lookup = duplicateIn, hooks = null) => async function sendRailNumber(sendState, req, res) {
  const body = req.body || {};
  const purpose = String(body.purpose || '');
  const business = body.business_json;
  if (isTrue(body.is_draft) || BILLING.indexOf(purpose) < 0 || (business && business.till)) return; /* a draft is never judged; a counter bill is judged by billNumberStep */
  let number = require('./bill-no').billNoRawOf(business);
  if (!number && res.locals && res.locals.kind === 'auto') return; /* a document the server itself raises (repeat supply, lib/autoraise.sendAs) is numbered by the series it was sent through, not by a person's typing */
  const country = await countryOfEntity(sendState.sender_id);
  const verdict = docnumber.check(number, country);
  if (!verdict.verified) return;
  const fyMonth = require('./country-setup').fyStartOf(country) || 1;
  const sinceDay = require('./books-report-period').fyStartOf(require('./shop-clock').today(country), fyMonth); /* the one clock: the financial year of a document being issued now */
  if (!number) {
    const series = hooks || require('./price-note');
    number = await assignNext(req, res, { sender_id: sendState.sender_id, purpose, country, sinceDay, clientRef: sendState.client_ref }, lookup, series);
    if (!number) return refuse(req, res, 'No free ' + purpose.replace('_', ' ') + ' number could be given from your series.');
    return;
  }
  if (!verdict.ok) return refuse(req, res, verdict.reason);
  const clash = await lookup(sendState.sender_id, purpose, number, sinceDay, sendState.client_ref);
  if (clash) return refuse(req, res, 'The number "' + number + '" is already on an earlier ' + purpose.replace('_', ' ') + ' of yours this financial year.');
};

module.exports = { railNumberStep, duplicateIn, BILLING };
