'use strict';
/**
 * lib/credit-original.js — THE ORIGINAL INVOICE A CREDIT OR DEBIT NOTE CORRECTS: its number and its date, read from the shop's own posted bill (AS-F-04, walk AS, 22 Nov 2026).
 * OWNS      originalOf (one read of the bill the note names) · refDtlsOf (the INV-01 RefDtls.PrecDocDtls block) · inherit (BEFORE the engine prices the note: the bill's place of supply and value) · carryOn (stamps the invoice the send froze)
 * OWNER     cb-rail
 * CALLED BY routes/chits.js sendMoney (inherit before invoiceAtSend, carryOn after it)
 * FLOW      a note names its bill (business_json.against.chit_id, or the bill number) → one read of the shop's own sent bill → { InvNo, InvDt dd/mm/yyyy in the shop's zone } → invoice.RefDtls.PrecDocDtls
 * RISK      a credit note whose document says nothing of the invoice it corrects (CGST Rules r.53: not cited in CITE-1129). The number and date come from the BILL, never from what the note's sender typed.
 *           A note that names no bill, or one that is not this shop's, gets no block here: refusing it is the credit-note door's job (CREDIT_NOTE_NEEDS_BILL, fix/ai-1129), not this read's.
 * AY-F-01   A NOTE FOLLOWS ITS BILL (22 Nov, walk AY): the place of supply comes from the ORIGINAL bill's frozen invoice (BuyerDtls.Pos), never from the walk-in rule: an inter-state bill's note reversed CGST+SGST and was
 *           netted into b2cs. inherit() records it on the note in the slots the tax readers already read (business_json.delivery.state_code: tax-copy.deliveredPos, CTRY-81; business_json.against.total: the bill's value
 *           for GSTR-1's B2CL / CDNUR test, tax-lines.againstValueOf) so the priced-at-send path, the live copy and the freeze all say the same. The rates are the bill's already (rateFromOriginal); nothing is recomputed here.
 * SHAPE     RefDtls.PrecDocDtls [{ InvNo, InvDt }] is the shape the engine's own e-invoice builder reads and validates (engines src/einvoice.js: dd/mm/yyyy); lib/price-note.js writes a top-level PrecDocDtls
 *           (marked unverified there): two spellings of one slot, reported to the coordinator, not widened here.
 */
const { boundRead } = require('./bound-read'); /* SEC-185 */
const creditCap = require('./credit-cap'); /* the one pick of a bill's total (FIGURES_SQL + totalOf: counter-bill.pickOf), never a raw TotInvVal read */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NOTES = ['credit_note', 'debit_note'];

/** { chit_id, bill_no } the note names (against may be an object or the bill number as text), nulls for what it does not say */
function namedOf(business) {
  const against = business && business.against;
  if (against && typeof against === 'object') return { chit_id: against.chit_id && UUID.test(String(against.chit_id)) ? String(against.chit_id) : null, bill_no: against.bill_no ? String(against.bill_no) : null };
  return { chit_id: null, bill_no: against ? String(against) : null };
}

/** the shop's own sent bill the note names → { no, at, zone } or null (not found, or more than one bill by that number: not guessed) */
async function originalOf(db, entity, business) {
  const named = namedOf(business);
  if (!named.chit_id && !named.bill_no) return null;
  const found = await boundRead((text, params) => db.query(text, params), entity,
    `SELECT COALESCE(h.business_json->>'bill_no', h.business_json->>'printed_as', h.business_json->'invoice'->'DocDtls'->>'No') AS no,
            COALESCE(h.business_json->'invoice'->'DocDtls'->>'Dt', h.business_json->>'billed_at', h.created_at::text) AS at,
            h.business_json->'invoice'->'BuyerDtls'->>'Pos' AS pos,
            ${creditCap.FIGURES_SQL},
            (SELECT timezone FROM identities WHERE identity_id = $1) AS zone
       FROM chit_header h
      WHERE h.entity_id = $1 AND h.sender_entity_id = $1 AND h.role <> 'Draft' AND h.purpose IN ('invoice', 'order')
        AND CASE WHEN $2::uuid IS NOT NULL THEN h.chit_id = $2::uuid ELSE h.business_json->>'bill_no' = $3::text END
      LIMIT 2`,
    [entity, named.chit_id, named.bill_no]
  );
  const row = found.rows.length === 1 ? found.rows[0] : null;
  return row && row.no ? { no: String(row.no), at: row.at, zone: row.zone, pos: row.pos ? String(row.pos).trim() : null, total: creditCap.totalOf(row) } : null;
}

/** dd/mm/yyyy of the bill's day in the shop's zone (the form the e-invoice's preceding-document date takes), null when the date is unreadable */
function dmyOf(original) {
  const day = require('./books-hooks').dayOf(original.at, original.zone);
  return day ? day.slice(8, 10) + '/' + day.slice(5, 7) + '/' + day.slice(0, 4) : null;
}
const refDtlsOf = (original) => ({ PrecDocDtls: [{ InvNo: original.no, InvDt: dmyOf(original) }] });

/** is this send a final credit or debit note (a draft is never stamped) */
const isFinalNote = (state) => !state.is_draft && NOTES.indexOf(String(state.purpose)) >= 0;

/** a two-digit state code ('7' → '07'), else null */
const stateOf = (pos) => {
  const text = String(pos == null ? '' : pos).trim();
  return /^[0-9]{1,2}$/.test(text) ? text.padStart(2, '0') : null;
};

/**
 * AY-F-01 · BEFORE the engine prices a note: reads the bill it names ONCE (kept on sendState.original for carryOn) and records its place of supply and value on the note, in the existing slots (see SHAPE). The sender's own
 * delivery or bill value is never overwritten. A note that names no readable bill is left exactly as it was.
 */
async function inherit(sendState, withEntity) {
  if (!isFinalNote(sendState)) return;
  const original = await withEntity(sendState.sender_id, (db) => originalOf(db, sendState.sender_id, sendState.business_json));
  sendState.original = original;
  if (!original) return;
  const business = sendState.business_json && typeof sendState.business_json === 'object' ? sendState.business_json : {};
  const stated = business.delivery && typeof business.delivery === 'object' ? business.delivery : {};
  const named = business.against && typeof business.against === 'object' ? business.against : { bill_no: String(business.against || '') || undefined };
  const code = stateOf(original.pos);
  const next = Object.assign({}, business);
  if (code && !String(stated.state_code == null ? '' : stated.state_code).trim()) next.delivery = Object.assign({}, stated, { state_code: code });
  if (original.total !== null && named.total === undefined) next.against = Object.assign({}, named, { total: original.total });
  sendState.business_json = next;
}

/** stamps the frozen invoice of a note with the bill it corrects (its number and date); anything else (not a note, a draft, no bill found) is left exactly as it was */
async function carryOn(sendState, withEntity) {
  const { originInvoice, sender_id, business_json } = sendState;
  if (!isFinalNote(sendState) || !originInvoice || typeof originInvoice !== 'object') return;
  const original = sendState.original !== undefined ? sendState.original : await withEntity(sender_id, (db) => originalOf(db, sender_id, business_json));
  if (original && dmyOf(original)) originInvoice.RefDtls = refDtlsOf(original);
}

module.exports = { originalOf, refDtlsOf, inherit, carryOn, namedOf, dmyOf };
