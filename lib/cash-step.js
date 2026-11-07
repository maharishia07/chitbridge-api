// @stage tested
// CALLED BY routes/chits.js   [sendCashStep — the step after sendPaper]
// @stage-note CTRY-77: the server's ONE read of the shop pack's cashRounding at send — a cash part no coin can make is refused by name.
'use strict';
/**
 * cash-step.js — A CASH TENDER MUST BE ONE THE COIN CAN MAKE (CTRY-77 · AU-02b · Athi 5 Nov: go with the recommendation, REFUSE).
 *
 * OWNS      the server's check of a counter bill's cash parts against the shop pack's `cashRounding` { step_minor, tender, cite } (reg-au 5c; reg-my 5 sen).
 *           A cash part whose amount, in minor units, is not a whole number of steps is refused: 400 CASH_ROUNDING_STEP, the part and the nearest
 *           coin-able figure named, the pack's cite carried. Card, UPI and every other tender are exact and never touched. A pack with no cashRounding
 *           (reg-in, reg-ae) → nothing, byte for byte as before. Nothing is rounded on the server: the till rounds (TILL-B2), the books post the gap
 *           as round-off (ACC-200/ACC-215), and a direct caller that skipped the till is told, not silently bent.
 * CALLED BY routes/chits.js sendPaper's neighbour sendCashStep (outside any fail-open try: a refusal must reach the counter)
 * FLOW      business_json.payment.parts + the shop's country ──▶ country.packFor (null, never India) ──▶ cashRounding ──▶ each part of the rounding
 *           tender ──▶ toMinor % step ──▶ null | { code, why, field, cite, part_minor, nearest_minor }
 * CARD      counter/bill-slip
 *
 * ⚠️ NO NUMBER IS TYPED HERE: the step is the pack's (never 5), the tender the pack names (default cash), the tender word is books-hooks modeOf
 * (the one reader of 'Cash' / 'cash ' / 'CASH'), the minor unit is books-cashflow toMinor (money.round + decimals, the api's one pair).
 * ENGINES: the decision also asked for ONE rounder `roundToStep` in engines src/money.js with the till's second copy retired; that is a twin round
 * (engines tag + api and web pins) not made here. `nearestMinor` below is the single server-side place until it lands, and is the swap point.
 */
const COUNTRY = require('./country');
const CODE = 'CASH_ROUNDING_STEP';
const FIELD = 'business_json.payment.parts';

/** the api's one major → minor (lib/books-cashflow), found at call time: that module reaches the db */
const toMinor = (amount, currency) => require('./books-cashflow').toMinor(amount, currency);
const modeOf = (tenderWords) => require('./books-hooks').modeOf(tenderWords);

/** the pack's rounding rule { step, tender, cite }, or null when the country has none (India, UAE …) or no pack (never India) */
function ruleOf(country) {
  const pack = COUNTRY.packFor(country);
  const rule = pack && pack.cashRounding;
  const step = rule ? Number(rule.step_minor) : 0;
  return step > 0 ? { step, tender: rule.tender || 'cash', cite: rule.cite || null } : null;
}

/** the nearest whole number of steps to a minor figure, half away from zero (the same half rule as money.round, on integers) */
function nearestMinor(minor, step) {
  return Math.sign(minor) * Math.round(Math.abs(minor) / step) * step;
}

/** a minor figure written as the currency writes it, e.g. AUD 10.00 */
function wordsOf(minor, currency) {
  const places = require('./money').decimals(currency);
  return currency + ' ' + (minor / Math.pow(10, places)).toFixed(places);
}

/** the first cash part (the rule's tender) whose minor amount is not a whole number of steps: { minor, nearest }, or null */
function offStepPart(parts, rule, currency) {
  for (const part of parts) {
    if (modeOf(part && part.how) !== rule.tender) continue;
    const minor = toMinor(part.amount, currency);
    if (Number.isFinite(minor) && minor % rule.step !== 0) return { minor, nearest: nearestMinor(minor, rule.step) };
  }
  return null;
}

/**
 * refusalOf({ country, business_json, currency }) → null | { code, why, field, cite, part_minor, nearest_minor }
 * Only the FIRST off-step cash part is named; the counter fixes it and sends again.
 */
function refusalOf(input) {
  const business = (input && input.business_json) || {};
  const parts = business.payment && Array.isArray(business.payment.parts) ? business.payment.parts : [];
  const rule = parts.length ? ruleOf(input.country) : null;
  const offStep = rule ? offStepPart(parts, rule, input.currency) : null;
  if (!offStep) return null;
  const sentence = 'Cash of ' + wordsOf(offStep.minor, input.currency) + ' cannot be paid in coins here: cash is paid in steps of ' + wordsOf(rule.step, input.currency) + '. The nearest is ' + wordsOf(offStep.nearest, input.currency) + ' - take that in cash (the shop books the difference as round-off), or pay this part by card.';
  return { code: CODE, field: FIELD, cite: rule.cite, part_minor: offStep.minor, nearest_minor: offStep.nearest, why: sentence };
}

/** a bill struck this long before it arrives was QUEUED offline (the till sends a live sale within seconds) - a replay of a printed sale */
const REPLAY_AFTER_MS = 15 * 60 * 1000;

/**
 * replayOf(business_json, nowMs) -> true when the bill's own moment (business_json.billed_at, ISO or ms) is older than REPLAY_AFTER_MS.
 * Such a sale is already on paper in a customer's hand and may predate the till rounding cash (TILL-B2): refusing it would only wedge the
 * till's queue and lose the sale from the books, so sendCashStep accepts it and SAYS so (cash_step on the answer); the books take the gap
 * as round-off (ACC-200/215). A live send is never a replay. An absent or unreadable moment is live (refused).
 */
function replayOf(businessJson, nowMs) {
  const stamp = businessJson && businessJson.billed_at;
  const struck = typeof stamp === 'number' ? stamp : Date.parse(stamp);
  return Number.isFinite(struck) && nowMs - struck > REPLAY_AFTER_MS;
}

/**
 * verdictOf(input, nowMs) -> null (on the step, or no rule) | the refusal itself (a live send) | the refusal marked { accepted: 'replay' } (an offline replay: let through, said)
 */
function verdictOf(input, nowMs) {
  const refusal = refusalOf(input);
  if (!refusal) return null;
  return replayOf(input.business_json, nowMs) ? Object.assign({}, refusal, { accepted: 'replay' }) : refusal;
}

module.exports = { refusalOf, verdictOf, ruleOf, nearestMinor, replayOf, CODE };
