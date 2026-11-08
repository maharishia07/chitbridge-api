// @stage tested
// @stage-note ACC-286: a counter credit note may never take the credited total of a bill past the bill (read under a per-bill lock, in the send's own transaction)
'use strict';
/**
 * lib/credit-cap.js — A COUNTER CREDIT NOTE CANNOT CREDIT MORE THAN THE BILL IT IS AGAINST.
 *
 * OWNS       the cap on a counter credit note: which bill it is against (against.chit_id, else against.bill_no), the one lock per bill, the notes already issued against it,
 *            and the one comparison "earlier notes + this note <= the bill". The refusal is 409 CREDIT_NOTE_OVER_BILL, thrown as data (lib/knownerr thrownRefusal), nothing written.
 * CALLED BY  routes/chits.js sendWrite and sendLegacyWrite — INSIDE the transaction that inserts the note, before the chit is delivered (a note that waits on the lock reads
 *            the earlier note's committed header, so ten notes at once settle one after the other).
 * FLOW       send body ──▶ applies? (a counter note: purpose credit_note, a till, an against) ──▶ the bill (own sent copy) ──▶ lock credit-cap|<bill> (lib/xact-lock)
 *            ──▶ the earlier notes (own sent copies, not withdrawn, not this chit, not a draft) ──▶ each total PICKED (lib/counter-bill pickOf, else the figure the counter stored)
 *            ──▶ compared in minor units (lib/books-cashflow toMinor) ──▶ ok | refusal in words
 * CARD       14-accounting/README (ACC-286)
 *
 * ⚠️ NOTHING IS RECOMPUTED: the bill's total and every note's total are figures the chits already carry, picked by the one reader and compared as integers.
 * ⚠️ KNOWN LIMIT (said in the log, never silent): a note whose bill cannot be found among this shop's own sent bills, or that carries no total, goes through as before (no cap can be
 *    judged on a figure that is not there). The rail path (a credit note chit against a rail invoice) is ACC-284 / ACC-73, not here.
 */
const lock = require('./xact-lock');
const counterBill = require('./counter-bill');
const log = require('./logger');

const CODE = 'CREDIT_NOTE_OVER_BILL';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** the bill's own purposes (a counter bill is an order / offer; its customer's copy reads invoice) */
const BILL_PURPOSES = ['order', 'offer', 'invoice'];

/** the figures one chit row carries: the invoice total, the header's money total, the legacy total_value, and the refund total a counter note stores */
const FIGURES_SQL = `h.business_json -> 'invoice' -> 'ValDtls' -> 'TotInvVal' AS invoice_total, h.summary_json -> 'money' -> 'total' AS money_total,
  h.summary_json -> 'total_value' AS legacy_total, h.business_json -> 'refund' -> 'total' AS refund_total, h.business_json ->> 'bill_no' AS bill_no`;

/** the bill a note names: { chit_id, bill_no } with null for what it does not say (against may be an object, or the bill number as text) */
function againstOf(business) {
  const against = business && business.against;
  if (against && typeof against === 'object') {
    const chitId = against.chit_id && UUID.test(String(against.chit_id)) ? String(against.chit_id) : null;
    return { chit_id: chitId, bill_no: against.bill_no ? String(against.bill_no) : null };
  }
  return { chit_id: null, bill_no: against ? String(against) : null };
}

/** does the cap judge this send? a counter credit note (a till, an against) that is not a draft */
function applies(sendState) {
  const business = sendState.business_json;
  if (sendState.is_draft || sendState.purpose !== 'credit_note' || !business || typeof business !== 'object') return false;
  if (!(business.till && business.till.id)) return false;
  const named = againstOf(business);
  return !!(named.chit_id || named.bill_no);
}

/** a chit row's total as a number (major units), or null: the one pick of the bill's total, else the figure the counter stored on the note */
function totalOf(row) {
  const picked = counterBill.pickOf({
    business_json: { invoice: { ValDtls: { TotInvVal: row.invoice_total } } },
    summary_json: { money: { total: row.money_total }, total_value: row.legacy_total }
  });
  if (picked.total !== null && picked.total !== undefined) return picked.total;
  const refunded = row.refund_total === null || row.refund_total === undefined ? NaN : Number(row.refund_total);
  return Number.isFinite(refunded) ? refunded : null;
}

/** the shop's own sent bill the note is against, or null */
async function billOf(client, entity, named) {
  const found = await client.query(
    `SELECT h.chit_id, h.currency_code, ${FIGURES_SQL} FROM chit_header h
      WHERE h.entity_id = $1 AND h.sender_entity_id = $1 AND h.role <> 'Draft' AND h.purpose = ANY($4::text[])
        AND (h.chit_id = $2::uuid OR (h.business_json ->> 'bill_no') = $3::text)
      ORDER BY (h.chit_id = $2::uuid) DESC NULLS LAST LIMIT 1`,
    [entity, named.chit_id, named.bill_no, BILL_PURPOSES]
  );
  return found.rows[0] || null;
}

/** the notes already issued against this bill (any till), own sent copies, not withdrawn, never this chit, never a draft */
async function earlierNotes(client, entity, bill, ownChitId) {
  const found = await client.query(
    `SELECT DISTINCT ON (h.chit_id) h.chit_id, ${FIGURES_SQL} FROM chit_header h
      WHERE h.entity_id = $1 AND h.sender_entity_id = $1 AND h.role <> 'Draft' AND h.purpose = 'credit_note' AND h.chit_id <> $4::uuid
        AND (h.business_json -> 'against' ->> 'chit_id' = $2::text
             OR ($3::text IS NOT NULL AND COALESCE(CASE WHEN jsonb_typeof(h.business_json -> 'against') = 'object' THEN h.business_json -> 'against' ->> 'bill_no' ELSE h.business_json ->> 'against' END, '') = $3::text))
        ${counterBill.NOT_WITHDRAWN_SQL}`,
    [entity, String(bill.chit_id), bill.bill_no || null, ownChitId]
  );
  return found.rows;
}

/** the sentence: what the bill was, what is already credited, what is left, what this note asks */
function wordsOf(figures, currency) {
  const words = (minor) => require('./bill-privacy').money(minor, currency);
  const left = Math.max(0, figures.bill - figures.credited);
  const rest = left > 0 ? 'only ' + words(left) + ' is left to credit' : 'nothing is left to credit';
  return 'This bill was ' + words(figures.bill) + ' and ' + words(figures.credited) + ' is already credited, so ' + rest + '. This note is ' + words(figures.note) + '.';
}

/** a refusal thrown as data (lib/knownerr thrownRefusal): 409, the registered code, the sentence */
function refusalOf(sentence) {
  return Object.assign(new Error(sentence), { status: 409, refused: true, code: CODE, title: 'Credit note too large' });
}

/**
 * holdUnderLock(client, sendState) — call inside the send's write transaction, on its handle. Applies → take the bill's lock, read the earlier notes, compare in minor units,
 * throw the refusal when this note would take the credited total past the bill. Anything else (not a counter note, bill or total not found) returns and says so in the log.
 */
async function holdUnderLock(client, sendState) {
  if (!applies(sendState)) return;
  const entity = sendState.sender_id;
  const bill = await billOf(client, entity, againstOf(sendState.business_json));
  const billTotal = bill ? totalOf(bill) : null;
  const noteTotal = totalOf({ invoice_total: sendState.business_json.invoice && sendState.business_json.invoice.ValDtls && sendState.business_json.invoice.ValDtls.TotInvVal, refund_total: sendState.business_json.refund && sendState.business_json.refund.total });
  if (billTotal === null || noteTotal === null) {
    log.warn('credit-cap.not-judged', { entity_id: entity, chit_id: sendState.chit_id, bill_found: !!bill, bill_total: billTotal, note_total: noteTotal });
    return;
  }
  await lock.lockKeys(client, entity, ['credit-cap|' + bill.chit_id]);
  const currency = sendState.currency_code || bill.currency_code;
  const minor = (amount) => require('./books-cashflow').toMinor(amount, currency);
  const earlier = await earlierNotes(client, entity, bill, sendState.chit_id);
  const credited = earlier.reduce((sum, row) => sum + minor(totalOf(row) || 0), 0);
  const figures = { bill: minor(billTotal), credited, note: minor(noteTotal) };
  if (figures.credited + figures.note > figures.bill) throw refusalOf(wordsOf(figures, currency));
}

module.exports = { holdUnderLock, applies, againstOf, totalOf, CODE };
