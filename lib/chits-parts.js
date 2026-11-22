/**
 * lib/chits-parts.js — small whole steps of routes/chits.js that need no route state (split out to keep that file's size row)
 * OWNER     cb-rail (the chit routes) with cb-accounting for the tax refusal
 * RISK      money (a bill sent with tax a shop may not charge) · fail-closed (a payment mark is never cleared on a withdrawn bill or one that carries its tender)
 * OWNS      taxNotChargeableRefusal · paymentClearShut · paymentClearShutSaid · logPaymentCleared · withdrawGates · writeGates · logWithdrawn · voidNotAllowed · NO_PAYMENT_STATUS
 * CALLED BY routes/chits.js (the send step sendIssued, DELETE /:chit_id/payment, PUT /:chit_id/void)
 * FLOW      a request's facts in ──▶ a refusal body (422 · 409 · 403 · 404) or null ──▶ the route answers it with the one error shape; the two log helpers write one timeline row on the caller's transaction
 * CARD      01-rail-core-the-chit/chits-routes
 * @stage tested
 */
'use strict';
const railStatus = require('./rail-status');
const taxLines = require('./tax-lines');
const { said } = require('./chits-contract');
/** a bill in either of these statuses has no payment mark to change */
const NO_PAYMENT_STATUS = ['cancelled', 'rejected'];

const NO_TAX_REGISTRATIONS = ['composition', 'unregistered'];
/**
 * ⭐ F-F-10 (WALK F, 1128): THE SERVER NEVER TRUSTS A CLIENT-SENT TAX SPLIT FOR A SHOP THAT MAY NOT CHARGE TAX. A composition-scheme shop (India: no tax collected from the buyer,
 * no tax invoice) and a shop that is not registered (AU: GST is charged only by a business registered for it) cannot issue an invoice that carries tax; before this the
 * counter's invoice with CGST 5.00 + SGST 5.00 was posted to Output CGST / SGST. The seller's registration is the ONE reader's (the seller party's RegType, from country-setup.registrationOfShop),
 * the tax of the invoice is the one reader's (tax-lines.heads) — nothing is worked out here. A shop whose registration is not known keeps the older "name it, never stop" path.
 * Refused 422 TAX_NOT_CHARGEABLE before anything is written; the counter must issue a bill of supply with no tax.
 */
function taxNotChargeableRefusal(entry, business_json) {
  const regType = entry && entry.seller && entry.seller.RegType;
  if (NO_TAX_REGISTRATIONS.indexOf(regType) < 0) return null;
  const charged = taxLines.heads(business_json && business_json.invoice).tax;
  if (!(charged > 0)) return null;
  const words = regType === 'composition' ? 'A shop under the composition scheme cannot charge tax or issue a tax invoice' : 'A shop that is not registered for tax cannot charge tax';
  return { error: 'Tax not chargeable', code: 'TAX_NOT_CHARGEABLE', field: 'business_json.invoice', registration: regType, message: words + ' — this bill carries ' + charged.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' of tax. Issue it as a bill of supply with no tax and send it again.' };
}
/** RAIL-1128 M2: why a bill's payment mark may not be cleared here, as the transaction's answer (no uuid / not mine -> nothing to clear · withdrawn or rejected · the tender is on the bill), or null when it may */
function paymentClearShut(copy) {
  if (!copy) return { rows: [] };
  if (NO_PAYMENT_STATUS.includes(copy.current_status)) return { rows: [], voided: copy.current_status };
  return copy.business_json && copy.business_json.payment && Array.isArray(copy.business_json.payment.parts) ? { rows: [], parts: true } : null;
}
/** RAIL-1128 M2: what the door says when paymentClearShut shut it (409 withdrawn or rejected · 422 the tender is on the bill), or null */
function paymentClearShutSaid(result) {
  if (result.voided) return { status: 409, ...said({ error: 'This bill was withdrawn', message: 'This bill is ' + (result.voided === 'rejected' ? 'rejected' : 'withdrawn') + ', so its payment mark is not changed here.' }, 'CHIT_VOIDED') };
  return result.parts ? { status: 422, ...said({ error: 'The tender is on the bill', message: 'This bill carries its own tender — it is not cleared here; a refund is a credit note.' }, 'PAYMENT_TENDER_ON_BILL') } : null;
}
/** RAIL-1128 M2: the timeline line for a cleared payment mark, on this transaction (the line is named with the stamp it removed) */
async function logPaymentCleared(db, req, entity_id, copy) {
  await db.query(
    `INSERT INTO state_log (chit_id, entity_id, action, action_by_identity_id, action_by_display_name, detail) VALUES ($1, $2, 'payment_cleared', $3, $4, $5)`,
    [req.params.chit_id, entity_id, req.identity.identity_id, req.identity.display_name || null, 'Mark paid cleared by ' + (req.identity.display_name || 'a user') + (copy.business_json && copy.business_json.payment ? ' (was ' + (copy.business_json.payment.method || 'paid') + (copy.business_json.payment.amount != null ? ' ' + copy.business_json.payment.amount : '') + ')' : '')]
  );
}
/** T1-RAIL: the rail's status gate for each copy of the chit I hold (a copy I do not hold has nothing to move) */
async function withdrawGates(db, entity_id, chit_id, me) {
  const gates = [];
  for (const copy of railStatus.COPIES) {
    const gate = await railStatus.statusGate(db, entity_id, chit_id, 'cancelled', me, { copy });
    if (gate.from) gates.push(gate);
  }
  return gates;
}
/** run each withdraw gate's write; the copies it moved ({ copy, from }) in gate order */
async function writeGates(gates) {
  const moved = [];
  for (const gate of gates) if (await gate.write()) moved.push({ copy: gate.copy, from: gate.from });
  return moved;
}
/** the 'voided' line on my own timeline: who withdrew it and why */
async function logWithdrawn(db, req, entity_id, chit_id, reason) {
  await db.query(
    `INSERT INTO state_log (chit_id, entity_id, action, action_by_identity_id, action_by_display_name, new_status, detail)
       VALUES ($1, $2, 'voided', $3, $4, 'cancelled', $5)`,
    [chit_id, entity_id, req.identity.identity_id, req.identity.display_name, `Withdrawn: ${reason}`]
  );
}
/** the refusal when this entity may not void the chit: it holds no such copy (404) or is not its sender (403); null when it may */
function voidNotAllowed(own, entity_id) {
  if (own.rows.length === 0) return { status: 404, ...said({ error: 'Not found', message: 'Chit not found' }, 'NOT_FOUND') };
  return own.rows[0].sender_entity_id === entity_id ? null : { status: 403, ...said({ error: 'Forbidden', message: 'Only the sender can void a chit' }, 'CHIT_NOT_PERMITTED') };
}
/** the statuses a bill takes no payment in: withdrawn (the void route writes 'cancelled') and rejected — the rail's two ends with no way to money */

module.exports = { NO_PAYMENT_STATUS, taxNotChargeableRefusal, paymentClearShut, paymentClearShutSaid, logPaymentCleared, withdrawGates, writeGates, logWithdrawn, voidNotAllowed };
