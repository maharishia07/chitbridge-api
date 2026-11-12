'use strict';
/**
 * OWNS      the numbers of a reward programme that the earning engine would misread: what a way to spend points needs (points above 0, and an amount above 0 for money off) and how long points last
 * CALLED BY lib/definition-check.js (the reward branch of missingValue, so POST and PUT /api/definitions refuse it with the form's own kind of sentence)
 * FLOW      rules.redeem[] · rules.expires_months → numbersRefusal → sentence | null
 * CARD      08-rewards-and-loyalty/README
 *
 * CAT-272: a negative redeem amount ADDED to the bill; points of 0 were worth nothing; expires_months of 1e9 made every later call for the holder a 500 (RangeError in expiresAt).
 * Kept apart from definition-check.js, which M4b also changes, so the shared file carries one line of this.
 */
const MAX_EXPIRES_MONTHS = 1200;

const asNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : NaN;
};
/** does one way to spend points break the rule: points above 0, and money off an amount above 0 */
const spendIsBroken = (spend) => !!spend && typeof spend === 'object' && (!(asNumber(spend.points) > 0) || (spend.kind === 'money' && !(asNumber(spend.amount) > 0)));
const isSaid = (value) => value !== undefined && value !== null && value !== '';

/** numbersRefusal(rules) → the sentence for the first number of a reward programme that cannot work, or null */
function numbersRefusal(rules) {
  if ((Array.isArray(rules.redeem) ? rules.redeem : []).some(spendIsBroken)) return 'Each way to spend points needs points above 0, and money off needs an amount above 0.';
  const months = rules.expires_months;
  if (isSaid(months) && !(asNumber(months) >= 0 && asNumber(months) <= MAX_EXPIRES_MONTHS)) return 'Points can expire after 0 to ' + MAX_EXPIRES_MONTHS + ' months (0 or blank means never).';
  return null;
}

module.exports = { numbersRefusal, MAX_EXPIRES_MONTHS };
