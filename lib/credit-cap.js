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
 * ⚠️ KNOWN LIMIT (said in the log, never silent): a note whose bill is ambiguous (two share its number) or that carries no total goes through as before; a bill that is not found at all is REFUSED (CTR-234, 409 BILL_NOT_RECORDED) (no cap can be
 *    judged on a figure that is not there). The rail path (a credit note chit against a rail invoice) is ACC-284 / ACC-73, not here.
 */
const lock = require('./xact-lock');
const counterBill = require('./counter-bill');
const log = require('./logger');

const CODE = 'CREDIT_NOTE_OVER_BILL';
const CODE_UNCHECKED = 'CREDIT_NOTE_NOT_CHECKED';
const CODE_NOT_JUDGED = 'CREDIT_NOTE_NOT_JUDGED';
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

/** the till a chit names, upper-cased, or '' — the scope a bill number lives in */
const tillOf = (business) => String((business && business.till && business.till.id) || '').toUpperCase();

/**
 * the shop's own sent bill the note is against, or null. The bill's OWN id decides when the note carries it (and then only that bill, never a guess by number). A note that
 * names only a bill number is matched on the number AND the till it was struck on (a number is only unique inside its till's series); more than one match is AMBIGUOUS and is not
 * judged (logged), because a cap on a guessed bill could refuse a true note.
 */
async function billOf(client, entity, named, till) {
  const found = await client.query(
    `SELECT h.chit_id, d.currency_code, upper(COALESCE(h.business_json -> 'till' ->> 'id', '')) AS till_id, ${FIGURES_SQL} FROM chit_header h LEFT JOIN chit_detail d ON d.chit_id = h.chit_id AND d.entity_id = h.entity_id
      WHERE h.entity_id = $1 AND h.sender_entity_id = $1 AND h.role <> 'Draft' AND h.purpose = ANY($4::text[])
        AND CASE WHEN $2::uuid IS NOT NULL THEN h.chit_id = $2::uuid ELSE (h.business_json ->> 'bill_no') = $3::text END
      LIMIT 5`,
    [entity, named.chit_id, named.bill_no, BILL_PURPOSES]
  );
  if (found.rows.length === 0) throw noBillRefusal(); /* CTR-234: no sent bill of THIS shop under that id/number (another shop's bill reads the same: the query is scoped to the shop) */
  if (named.chit_id || found.rows.length === 1) return found.rows[0];
  const sameTill = found.rows.filter((item) => item.till_id === till);
  if (sameTill.length === 1) return sameTill[0];
  log.warn('credit-cap.ambiguous-bill', { entity_id: entity, bill_no: named.bill_no, till, matches: found.rows.length });
  return null;
}

/**
 * the notes already issued against this bill (any till), own sent copies, not withdrawn, never this chit, never a draft, never the SAME client_ref (a retry that raced
 * this send is a replay, answered by the duplicate path, not a second credit). A note names the bill by its id, or — only when it carries no id — by its number on the
 * bill's own till.
 */
async function earlierNotes(client, entity, bill, thisNote) {
  const found = await client.query(
    `SELECT DISTINCT ON (h.chit_id) h.chit_id, ${FIGURES_SQL} FROM chit_header h
      WHERE h.entity_id = $1 AND h.sender_entity_id = $1 AND h.role <> 'Draft' AND h.purpose = 'credit_note' AND h.chit_id <> $4::uuid
        AND ($5::text IS NULL OR (h.business_json ->> 'client_ref') IS DISTINCT FROM $5::text)
        AND (h.business_json -> 'against' ->> 'chit_id' = $2::text
             OR ($3::text IS NOT NULL AND h.business_json -> 'against' ->> 'chit_id' IS NULL AND upper(COALESCE(h.business_json -> 'till' ->> 'id', '')) = $6::text
                 AND COALESCE(CASE WHEN jsonb_typeof(h.business_json -> 'against') = 'object' THEN h.business_json -> 'against' ->> 'bill_no' ELSE h.business_json ->> 'against' END, '') = $3::text))
        ${counterBill.NOT_WITHDRAWN_SQL}`,
    [entity, String(bill.chit_id), bill.bill_no || null, thisNote.chit_id, thisNote.client_ref || null, bill.till_id || '']
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

/** CTR-234: the note names a bill this shop has none of — missing and another shop's look the same; 409 BILL_NOT_RECORDED is a WAITING code (middleware/idempotency), so an offline till's queue sends it again once the bill lands */
function noBillRefusal() {
  return Object.assign(new Error('That bill has not reached ChitBridge yet, so this credit note was not saved. Send the bill first, or check the bill number.'), { status: 409, refused: true, code: 'BILL_NOT_RECORDED', title: 'Bill not recorded' });
}

/** a refusal thrown as data (lib/knownerr thrownRefusal): 409, the registered code, the sentence */
function refusalOf(sentence) {
  return Object.assign(new Error(sentence), { status: 409, refused: true, code: CODE, title: 'Credit note too large' });
}

/** the figures the note being sent carries, in the row shape totalOf reads: its invoice total and the refund total the counter stored */
function figuresOfNote(business) {
  const valDtls = (business.invoice && business.invoice.ValDtls) || {};
  return { invoice_total: valDtls.TotInvVal, refund_total: business.refund && business.refund.total };
}

/** a refusal when the cap could not read the bill or the earlier notes: nothing is saved, the person is told and may send again (never a bare 500, never a silent pass) */
function unreadRefusal() {
  return Object.assign(new Error('This credit note could not be checked against its bill, so it was not saved. Send it again; if it repeats, tell us.'), { status: 503, refused: true, code: CODE_UNCHECKED, title: 'Credit note not checked' });
}

/** the warning a note carries on the send answer when it was NOT judged (no total, or two bills with that number) */
function notJudged(sendState, reason) {
  sendState.creditCap = { code: CODE_NOT_JUDGED, why: reason };
}

/**
 * holdUnderLock(client, sendState) — call inside the send's write transaction, on its handle. Applies → take the bill's lock, read the earlier notes, compare in minor units,
 * throw the refusal when this note would take the credited total past the bill. Anything else (not a counter note, bill or total not found) returns and says so in the log.
 */
async function holdUnderLock(client, sendState) {
  if (!applies(sendState)) return;
  try {
    await judge(client, sendState);
  } catch (err) {
    if (err && (err.refused === true || require('./knownerr').known(err))) throw err; /* our own refusals, and any error knownerr already answers (DB_CONNECTION_LOST, STATEMENT_TIMEOUT, SERVER_BUSY) pass unchanged */
    log.error('credit-cap.read-failed', { entity_id: sendState.sender_id, chit_id: sendState.chit_id, error: String(err && err.message) });
    throw unreadRefusal();
  }
}

/** the cap itself: the bill, its lock, the earlier notes, the comparison */
async function judge(client, sendState) {
  const entity = sendState.sender_id;
  const bill = await billOf(client, entity, againstOf(sendState.business_json), tillOf(sendState.business_json));
  const billTotal = bill ? totalOf(bill) : null;
  const noteTotal = totalOf(figuresOfNote(sendState.business_json));
  if (billTotal === null || noteTotal === null) {
    log.warn('credit-cap.not-judged', { entity_id: entity, chit_id: sendState.chit_id, bill_found: !!bill, bill_total: billTotal, note_total: noteTotal });
    return notJudged(sendState, 'This credit note was not checked against a bill: two bills share its number, or its total is not on record. Check that the credit is not more than the bill.');
  }
  await lock.lockKeys(client, entity, ['credit-cap|' + bill.chit_id]);
  /* the one reader of a stated currency (country-setup currencyStated): none stated is null, never a default — then no figure can be compared and the note is not judged, said */
  const currency = require('./country-setup').currencyStated(sendState.currency_code, bill.currency_code);
  if (!currency) return notJudged(sendState, 'This credit note was not checked against its bill: no currency is stated on it or on the bill.');
  const minor = (amount) => require('./books-cashflow').toMinor(amount, currency);
  const earlier = await earlierNotes(client, entity, bill, { chit_id: sendState.chit_id, client_ref: sendState.client_ref || sendState.business_json.client_ref });
  const credited = earlier.reduce((sum, row) => sum + minor(totalOf(row) || 0), 0);
  const figures = { bill: minor(billTotal), credited, note: minor(noteTotal) };
  if (figures.credited + figures.note > figures.bill) throw refusalOf(wordsOf(figures, currency));
}

module.exports = { holdUnderLock, CODE_UNCHECKED, CODE_NOT_JUDGED, applies, againstOf, totalOf, CODE };
