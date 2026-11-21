/**
 * books-advice-in.js — A PAYMENT ADVICE I RECEIVED, read as my receipt (B-F-17; split out of books-hooks.js, whose size row may not grow).
 * OWNER     cb-rail (the chit) with cb-accounting (the posting)
 * RISK      money
 * OWNS      verdict
 * CALLED BY lib/books-hooks.js classify (payment_advice branch)
 * FLOW      a received advice chit ──▶ waits for my acceptance (and any dispute) ──▶ a payment verdict (direction in) that recordChitPayment records
 * CARD      16-finance/books-posting
 */
'use strict';
/**
 * ⭐ B-F-17 · A PAYMENT ADVICE I RECEIVED (the payer's chit, books-payment-advice) → my receipt, once I confirm it. Never automatic (Athi 2026-10-01 for bills; SPEC-payments §3 the payee's Accept; Xero/MYOB/QuickBooks
 * likewise: a remittance is a claim until the seller matches it). Waits on my acceptance and on any dispute; accepted → ONE payment through recordChitPayment (direction in, the payer = the chit's sender).
 * The payer's own copy, and an advice of money I paid, post nothing here.
 */
function verdict(ctx, { ACCEPTED, modeOf, dayOf, paymentReceivedWait }) {
  const { copy, business, setting, currency, at, input } = ctx;
  const advice = business.payment_advice;
  if (copy.direction !== 'received' || advice.action !== 'paid') return { kind: 'none' };
  const payer = copy.sender_entity_id ? String(copy.sender_entity_id) : null;
  const pcur = String(advice.currency || currency || '').toUpperCase();
  const amountMinor = Math.abs(Math.round(Number(advice.amount_minor) || 0));
  const what = '(' + (advice.words || 'a payment advice') + ')';
  const statusText = String(input.status || copy.current_status || '');
  if (input.disputed) return { kind: 'queue', wait: 'dispute', why: 'Disputed — this posts once the dispute is settled and you confirm the money arrived ' + what };
  if (!ACCEPTED.test(statusText)) return { kind: 'queue', wait: 'acceptance', todo: 'accept', why: 'Waiting for you to confirm the money was received ' + what };
  const mode = modeOf(advice.mode),
    receivedDay = dayOf(advice.paid_on || at, setting);
  const wait = paymentReceivedWait({ no: advice.reference || '', mode: advice.mode }, payer, amountMinor, mode, receivedDay);
  if (wait) return wait;
  return {
    kind: 'payment',
    payment: {
      party_id: payer,
      direction: 'in',
      amount_minor: amountMinor,
      currency: pcur,
      mode,
      reference: advice.reference || null,
      received_at: receivedDay,
      client_ref: 'chit:' + copy.chit_id,
      source_chit_id: copy.chit_id
    }
  };
}
module.exports = { verdict };
