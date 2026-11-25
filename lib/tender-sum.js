// @stage tested
// CALLED BY routes/chits.js   [sendTenderSum — the step after sendCashStep]
// @stage-note P-F-01 (walk P, 21 Nov): a counter bill whose tenders do not add up to its total is refused in words (fail closed).
'use strict';
/**
 * tender-sum.js — THE TENDERS OF A BILL ADD UP TO ITS TOTAL (walk P P-F-01: a A$22.00 bill was saved with Cash 10.00 only; by-tender figures ran 24.02 short of takings).
 *
 * OWNER     cb-counter
 * RISK      money
 * OWNS      the server's check, in MINOR units, that business_json.payment.parts (cash, card, UPI, On credit ... every tender the till writes) sum to the invoice total
 *           (business_json.invoice.ValDtls.TotInvVal) plus the cash rounding the bill took (payment.cash_round, signed). Short or over → 422 TENDER_SUM_MISMATCH.
 * CALLED BY routes/chits.js sendTenderSum (outside any fail-open try: a refusal must reach the counter)
 * FLOW      payment.parts + invoice total + cash_round ──▶ books-cashflow toMinor (the api's one major → minor) ──▶ null | { code, why, expected_minor, tendered_minor }
 * CARD      counter/bill-slip
 *
 * ⚠️ NO FIGURE IS WORKED OUT: the total is the engine's invoice, the parts are the till's, the rounding is the till's recorded cash_round; this only compares integers.
 * A bill with no parts or no invoice total is not read here (other steps refuse a bill with no invoice). An OFFLINE REPLAY of a printed sale (cash-step.replayOf)
 * is accepted and said, never wedged in the till's queue.
 */
const CODE = 'TENDER_SUM_MISMATCH';
const toMinor = (amount, currency) => require('./books-cashflow').toMinor(amount, currency);
const wordsOf = (minor, currency) => require('./cash-step').wordsOf(minor, currency);

/** the sum of the parts in minor units, or null when a part is not a number */
function tenderedMinor(parts, currency) {
  let sum = 0;
  for (const part of parts) {
    const minor = toMinor(part && part.amount, currency);
    if (!Number.isFinite(minor)) return null;
    sum += minor;
  }
  return sum;
}

/** the refusal in words: no amount on a payment, a shortfall (take the rest or put it On credit), or more than the bill (take the payments again) */
function shortfallWords(tendered, expected, currency) {
  if (tendered == null) return 'A payment on this bill has no amount, so it was not saved. Take the payment again.';
  const gap = expected - tendered;
  if (gap > 0) return 'Only ' + wordsOf(tendered, currency) + ' was taken against a bill of ' + wordsOf(expected, currency) + ' (' + wordsOf(gap, currency) + ' short), so it was not saved. Take the rest, or put it On credit.';
  return 'More than the bill was recorded: ' + wordsOf(tendered, currency) + ' taken against a bill of ' + wordsOf(expected, currency) + ', so it was not saved. Take the payments again.';
}
/** refusalOf({ business_json, currency }) → null | { code, why, expected_minor, tendered_minor } */
function refusalOf(input) {
  const business = (input && input.business_json) || {};
  const parts = business.payment && Array.isArray(business.payment.parts) ? business.payment.parts : [];
  const total = require('./counter-bill').pickOf({ business_json: business }).total; /* the one pick of a bill's total (money-reader-scan): null when the bill carries no invoice total */
  if (!parts.length || !Number.isFinite(total)) return null;
  const currency = input.currency;
  const rounding = Number(business.payment.cash_round) || 0;
  const expected = toMinor(total, currency) + toMinor(rounding, currency);
  const tendered = tenderedMinor(parts, currency);
  if (tendered === expected) return null;
  return { code: CODE, why: shortfallWords(tendered, expected, currency), expected_minor: expected, tendered_minor: tendered };
}

/** verdictOf(input, nowMs) → null | the refusal | the refusal marked { accepted: 'replay' } (an offline replay: let through, said) */
function verdictOf(input, nowMs) {
  const refusal = refusalOf(input);
  if (!refusal) return null;
  return require('./cash-step').replayOf(input.business_json, nowMs) ? Object.assign({}, refusal, { accepted: 'replay' }) : refusal;
}

module.exports = { refusalOf, verdictOf, CODE };
