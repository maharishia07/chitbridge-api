/**
 * OWNS      the value a definition kind cannot do without (missingValue): the sentences the form shows, refused by the API for a hand-made request or an older client
 * CALLED BY routes/definitions.js (POST /, PUT /:id)
 * FLOW      kind · sub_kind · rules → missingValue → sentence | null (a reward programme's numbers: lib/reward-check.js)
 * CARD      07-offers-pricing-and-combos/README
 *
 * definition-check.js — the value a definition kind cannot do without. The SAME sentences the form shows
 * (app/cap-definitions.js cbDefMissingValue); here so the API refuses what a hand-made request or an older client sends.
 *
 * Athi, 2026-09-05: an offer named "Flat 10%" was saved with its Percent box empty — the engine saw no percentage, the
 * product page said "After offers ₹200", and he asked "offer not applied?" A rule without its value is not a rule.
 */
'use strict';
function n(v) {
  /* [REVIEWS3 GF-cat-01 M7 / EL M10] a blank, null, boolean or array is NOT zero: Number('') and Number(null) are 0 and would save an empty Rate box as a 0% slab */
  if (v === '' || v === null || v === undefined || typeof v === 'boolean' || (typeof v === 'string' && !v.trim()) || typeof v === 'object') return NaN;
  const x = Number(v);
  return Number.isFinite(x) ? x : NaN;
}
/** per offer kind: how to tell the rule lacks its value, and what to say for the owner */
const OFFER_NEEDS = new Map([
  ['percent_off', { lacks: (rule) => !(n(rule.percent) > 0 && n(rule.percent) <= 100), say: 'Percent off is needed — the name is not the rule. Type the percentage between 0 and 100 (e.g. 10).' }],
  ['amount_off', { lacks: (rule) => !(n(rule.amount) > 0), say: 'Amount off is needed — how much comes off.' }],
  ['threshold', { lacks: (rule) => !(n(rule.percent) > 0) && !(n(rule.amount) > 0) && !rule.get_item_id, say: 'A threshold offer needs a percent, an amount, or a reward item.' }],
  ['tier_price', { lacks: (rule) => !(Array.isArray(rule.tiers) && rule.tiers.length), say: 'At least one tier (quantity = price) is needed.' }],
  ['buy_x_get_y', { lacks: (rule) => !(n(rule.buy) > 0 && n(rule.get) > 0), say: 'Buy X get Y needs both numbers.' }],
  ['bundle_price', { lacks: (rule) => !(n(rule.bundle_price) > 0), say: 'A bundle needs its price.' }]
]);
/** the first thing an offer of this kind lacks, said for the owner; null when it has what its kind needs */
function missingOfferValue(sub, rule) {
  const need = OFFER_NEEDS.get(sub);
  return need && need.lacks(rule) ? need.say : null;
}
/**
 * CAT-353: an offer whose scope cannot be read is refused at save, never widened to "every product" (the till would take 10% off all four when
 * the shop asked for the juice). The test is the ENGINE'S (CBOffers.unreadableScope), so the save and the till cannot disagree about what a scope is.
 */
function unreadableScopeSentence(rule) {
  const keys = require('./offers-engine').CBOffers.unreadableScope(rule);
  return keys ? 'The offer scope is not understood: ' + keys + '. Name the products or categories inside applies_to (item_ids, skus, category_ids), or leave applies_to out for the whole shop.' : null;
}
/** the first thing a reward programme lacks (an earning rule the rewards engine accepts; what a point turns into), or null */
function missingRewardValue(rule) {
  /**
   * ⚠️⚠️ A REWARD PROGRAMME WITH NO EARNING RULE WOULD BE ACCEPTED AND THEN EARN NOTHING, SILENTLY — which is
   * Athi's "Flat 10%" bug again, one subject along: a rule without its value is not a rule, and the failure looks
   * exactly like a working feature that nobody happens to be earning on.
   * ⭐ The sentence is the ENGINE'S, not a second opinion written here. lib/rewards.js already refuses a rule
   * missing a parameter and says which one; asking it means the API and the counter cannot disagree about what
   * counts as a complete programme.
   */
  const chk = require('./rewards').earnCheck(rule.earn);
  if (!chk.ok) return 'This programme cannot award anything yet — ' + chk.why + '.';
  /* ⚠️ AND WHAT A POINT TURNS INTO. A shop may declare points that convert to nothing (a pure loyalty count),
     but it should do that on purpose rather than by leaving the box empty, so an empty list is refused. */
  return !Array.isArray(rule.redeem) || !rule.redeem.length ? 'Say what a point is worth — money off, an item, or a named thing.' : require('./reward-check').numbersRefusal(rule); /* CAT-272: and its numbers */
}
function missingValue(kind, sub, rules) {
  const r = rules && typeof rules === 'object' ? rules : {};
  if (kind === 'offer') {
    const offerMissing = missingOfferValue(sub, r) || unreadableScopeSentence(r);
    if (offerMissing) return offerMissing;
  }
  if (kind === 'tax' && !(n(r.rate) >= 0 && n(r.rate) <= 100)) return 'The rate is needed, between 0 and 100 (0 for a zero-rated slab).';
  if (kind === 'reward') return missingRewardValue(r);
  if (kind === 'pricing' && sub === 'tiered' && !(Array.isArray(r.tiers) && r.tiers.length)) return 'At least one tier is needed.';
  return null;
}
module.exports = { missingValue };
