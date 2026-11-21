'use strict';
/**
 * lib/rail-invoice-number.js — THE NUMBER OF A RAIL INVOICE: required, in the country's format, unique per seller per financial year (AS-F-03, walk AS, 22 Nov 2026).
 * OWNS      railNumberStep (the send step) · numberOf (the one reader of the number a billing document carries) · duplicateIn (the seller's own earlier document with the same number)
 * OWNER     cb-rail
 * CALLED BY routes/chits.js SEND_STEPS (after sendBillNumber, which judges a counter bill's number at the till door)
 * FLOW      POST /api/chits/send (invoice · credit_note · debit_note, not a draft, not a counter bill) → numberOf → docnumber.check (THE country rule) → duplicateIn (one read) → 422 BILL_NO_BAD or on
 * RISK      a tax invoice with a blank, a 26-character or a repeated number (the walk accepted all three; DocDtls.No came back null)
 * RULE      the format is docnumber.check's, never copied (India: at most 16 characters, letters, digits, / and -; CGST Rules r.46: not cited in CITE-1129). A country whose rule is not
 *           verified is not judged (same line as the till door): an unstudied country's loose default is not law. The financial year is the country pack's start month (country-setup.fyStartOf).
 *           Unique per seller, per document kind (an invoice series and a credit-note series are two series), within the financial year. The same client_ref is the same document (a replay), never a duplicate.
 */
const docnumber = require('./docnumber');
const { problem } = require('./problem');
const { said, codeOfStatus } = require('./chits-contract');
const { withEntity } = require('../db');

const BILLING = ['invoice', 'credit_note', 'debit_note'];

/** the number the document carries: bill_no, else printed_as (the same two the invoice stamp reads, send-money.invoiceOfLines) — '' when it carries none */
function numberOf(business) {
  const b = business && typeof business === 'object' ? business : {};
  const given = b.bill_no !== undefined && b.bill_no !== null && b.bill_no !== '' ? b.bill_no : b.printed_as;
  return typeof given === 'string' || typeof given === 'number' ? String(given) : '';
}

/** the seller's own earlier document of this kind with this number since the financial year began (another client_ref), or null */
async function duplicateIn(sender_id, purpose, number, sinceDay, clientRef) {
  const found = await withEntity(sender_id, (db) =>
    db.query(
      `SELECT chit_id FROM chit_header
        WHERE entity_id = $1 AND sender_entity_id = $1 AND purpose = $2 AND COALESCE(role, '') <> 'Draft'
          AND COALESCE(business_json->>'bill_no', business_json->>'printed_as') = $3 AND created_at >= $4::date
          AND COALESCE(business_json->>'client_ref', '') <> COALESCE($5, '') LIMIT 1`,
      [sender_id, purpose, number, sinceDay, clientRef || null]
    )
  );
  return found.rows[0] || null;
}
const refuse = (req, res, message) => {
  res.locals.code = 'BILL_NO_BAD';
  return problem(req, res, { status: 422, ...said({ error: 'Invoice number refused', code: 'BILL_NO_BAD', field: 'business_json.bill_no', message: message + ' The document was not taken - number it again and send it.' }, codeOfStatus(422)) });
};

const railNumberStep = (countryOfEntity, lookup = duplicateIn) => async function sendRailNumber(sendState, req, res) {
  const body = req.body || {};
  const purpose = String(body.purpose || '');
  const business = body.business_json;
  if (sendState.is_draft || BILLING.indexOf(purpose) < 0 || (business && business.till)) return; /* a counter bill is judged by billNumberStep */
  const country = await countryOfEntity(sendState.sender_id);
  const number = numberOf(business);
  const verdict = docnumber.check(number, country);
  if (!verdict.verified) return;
  if (!verdict.ok) return refuse(req, res, number ? verdict.reason : 'A ' + purpose.replace('_', ' ') + ' needs its number.');
  const fyMonth = require('./country-setup').fyStartOf(country) || 1;
  const sinceDay = require('./books-report-period').fyStartOf(new Date().toISOString().slice(0, 10), fyMonth); /* clock-ok: the financial year of a document being issued now */
  const clash = await lookup(sendState.sender_id, purpose, number, sinceDay, sendState.client_ref);
  if (clash) return refuse(req, res, 'The number "' + number + '" is already on an earlier ' + purpose.replace('_', ' ') + ' of yours this financial year.');
};

module.exports = { railNumberStep, numberOf, duplicateIn, BILLING };
