'use strict';
/**
 * lib/till-credit-note-money.js — A COUNTER CREDIT NOTE'S MONEY, AS SIGNS, AND WHICH ROWS A DAY'S TAKINGS COUNT (moved out of routes/till.js, read1129routes)
 * OWNER     cb-counter
 * RISK      money-adjacent: only PICKS the figures the counter stored (negative, 0 stays 0, a missing key answers null); no arithmetic here
 * FLOW      a bill's business_json -> negOf / negRates -> creditNoteMoney (the money object of a credit-note row) · a live-day row -> isCounterTakings (counter bill or not)
 * OWNS      negOf · negRates · creditNoteMoney · isCounterTakings
 * CALLED BY routes/till.js (the bills read and the live day summary) · tests/till-day-returns-1129.test.cjs · tests/till-takings-1129.test.cjs
 * CARD      counter/till-routes
 */

/** a credit note's money as a SIGN: -abs of a finite number, 0 stays 0 (never -0), anything else null (never 0) */
function negOf(figure) {
  if (typeof figure !== 'number' || !Number.isFinite(figure)) return null;
  return figure === 0 ? 0 : -Math.abs(figure);
}

/** a credit note's by_rate as signs: each rate's taxable and tax -abs (0 stays 0, a non-number null), or null when the note stored none */
function negRates(byRate) {
  if (!byRate || typeof byRate !== 'object') return null;
  const out = {};
  for (const rate of Object.keys(byRate)) {
    const v = byRate[rate] || {};
    out[rate] = { taxable: negOf(v.taxable != null ? v.taxable : v.base), tax: negOf(v.tax) };
  }
  return Object.keys(out).length ? out : null;
}

/**
 * ACC-255: a counter credit note has no invoice, so summary_json.money is null by design (lib/send-money scope 'none');
 * its money sits in business_json.{taxable, tax, refund} as the counter stored it. The reader only PICKS those (negative,
 * kind credit_note, so a day's net is a plain sum) — no by_rate arithmetic, a missing key answers null.
 * Sale rows get {} so their bytes do not move. counter-bill.paidOf stays untouched (the reward reads it).
 */
function creditNoteMoney(business) {
  if (business.slip !== 'credit_note') return {};
  const refund = business.refund && typeof business.refund === 'object' ? business.refund : {};
  return {
    total: negOf(refund.total),
    saved: null,
    taxable: negOf(business.taxable),
    tax: negOf(business.tax),
    by_rate: negRates(business.by_rate), /* U-F-02: the rate rows the books posted, so a day nets a return per rate */
    refunds: Array.isArray(refund.parts) ? refund.parts : [],
    against: business.against && business.against.bill_no ? { bill_no: business.against.bill_no } : null,
    reason_words: business.reason_words || null
  };
}

/**
 * R-F-04 (1129): the till summary counts what THE COUNTERS took, the same set the day close reads. A credit note that came in on the rail (a purpose 'credit_note' chit with no counter object
 * and no slip kind: the customer's own paper) is not a counter bill; it was read as a 10.50 sale (Home 168.50 against the day close's 158.00). A counter bill carries `till` or `slip`.
 */
function isCounterTakings(row) {
  const business = (row && row.business_json) || {};
  return !(row && row.purpose === 'credit_note' && !business.till && !business.slip);
}

module.exports = { negOf, negRates, creditNoteMoney, isCounterTakings };
