/**
 * books-advice-in.js — A PAYMENT ADVICE I RECEIVED, read as my receipt (B-F-17; split out of books-hooks.js, whose size row may not grow).
 * OWNER     cb-rail (the chit) with cb-accounting (the posting)
 * RISK      money
 * OWNS      verdict (the receipt a received advice becomes, or why it waits)
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
/** what the payer's advice says, read once: who paid, in which currency, how much, and the words that name it in a queue line */
function adviceFacts(ctx) {
  const { copy, business, currency } = ctx;
  const advice = business.payment_advice;
  return {
    advice,
    payer: copy.sender_entity_id ? String(copy.sender_entity_id) : null,
    currencyCode: String(advice.currency || currency || '').toUpperCase(),
    amountMinor: Math.abs(Number(advice.amount_minor) || 0), /* a whole minor-unit figure from the frozen advice: kept as it is, never re-rounded here (money-scan) */
    what: '(' + (advice.words || 'a payment advice') + ')'
  };
}

/** the queue line while the advice still waits: on a dispute, or on my acceptance; null when neither holds it back */
function waitingLine(ctx, facts, ACCEPTED) {
  const { copy, input } = ctx;
  const statusText = String(input.status || copy.current_status || '');
  if (input.disputed) return { kind: 'queue', wait: 'dispute', why: 'Disputed — this posts once the dispute is settled and you confirm the money arrived ' + facts.what };
  if (ACCEPTED.test(statusText)) return null;
  return { kind: 'queue', wait: 'acceptance', todo: 'accept', why: 'Waiting for you to confirm the money was received ' + facts.what };
}

/** the one payment of an accepted advice (direction in, the payer = the chit's sender) */
function receiptOf(copy, facts, mode, receivedDay) {
  return {
    kind: 'payment',
    payment: {
      party_id: facts.payer,
      direction: 'in',
      amount_minor: facts.amountMinor,
      currency: facts.currencyCode,
      mode,
      reference: facts.advice.reference || null,
      received_at: receivedDay,
      client_ref: 'chit:' + copy.chit_id,
      source_chit_id: copy.chit_id
    }
  };
}

/** the verdict for a received advice: nothing, why it waits, a wait the books raise, or the one receipt */
function verdict(ctx, { ACCEPTED, modeOf, dayOf, paymentReceivedWait }) {
  const { copy, setting, at } = ctx;
  const advice = ctx.business.payment_advice;
  if (copy.direction !== 'received' || advice.action !== 'paid') return { kind: 'none' };
  const facts = adviceFacts(ctx);
  const waiting = waitingLine(ctx, facts, ACCEPTED);
  if (waiting) return waiting;
  const mode = modeOf(advice.mode),
    receivedDay = dayOf(advice.paid_on || at, setting);
  const wait = paymentReceivedWait({ no: advice.reference || '', mode: advice.mode }, facts.payer, facts.amountMinor, mode, receivedDay);
  return wait || receiptOf(copy, facts, mode, receivedDay);
}
module.exports = { verdict };
