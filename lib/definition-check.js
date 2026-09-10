/**
 * definition-check.js — the value a definition kind cannot do without. The SAME sentences the form shows
 * (app/cap-definitions.js cbDefMissingValue); here so the API refuses what a hand-made request or an older client sends.
 *
 * Athi, 2026-09-05: an offer named "Flat 10%" was saved with its Percent box empty — the engine saw no percentage, the
 * product page said "After offers ₹200", and he asked "offer not applied?" A rule without its value is not a rule.
 */
'use strict';
function n(v) { const x = Number(v); return Number.isFinite(x) ? x : NaN; }
function missingValue(kind, sub, rules) {
  const r = (rules && typeof rules === 'object') ? rules : {};
  if (kind === 'offer') {
    if (sub === 'percent_off' && !(n(r.percent) > 0)) return 'Percent off is needed — the name is not the rule. Type the percentage (e.g. 10).';
    if (sub === 'amount_off' && !(n(r.amount) > 0)) return 'Amount off is needed — how much comes off.';
    if (sub === 'threshold' && !(n(r.percent) > 0) && !(n(r.amount) > 0) && !r.get_item_id) return 'A threshold offer needs a percent, an amount, or a reward item.';
    if (sub === 'tier_price' && !(Array.isArray(r.tiers) && r.tiers.length)) return 'At least one tier (quantity = price) is needed.';
    if (sub === 'buy_x_get_y' && !(n(r.buy) > 0 && n(r.get) > 0)) return 'Buy X get Y needs both numbers.';
    if (sub === 'bundle_price' && !(n(r.bundle_price) > 0)) return 'A bundle needs its price.';
  }
  if (kind === 'tax' && !(n(r.rate) >= 0)) return 'The rate is needed (0 for a zero-rated slab).';
  /**
   * ⚠️⚠️ A REWARD PROGRAMME WITH NO EARNING RULE WOULD BE ACCEPTED AND THEN EARN NOTHING, SILENTLY — which is
   * Athi's "Flat 10%" bug again, one subject along: a rule without its value is not a rule, and the failure looks
   * exactly like a working feature that nobody happens to be earning on.
   * ⭐ The sentence is the ENGINE'S, not a second opinion written here. lib/rewards.js already refuses a rule
   * missing a parameter and says which one; asking it means the API and the counter cannot disagree about what
   * counts as a complete programme.
   */
  if (kind === 'reward') {
    const chk = require('./rewards').earnCheck(r.earn);
    if (!chk.ok) return 'This programme cannot award anything yet — ' + chk.why + '.';
    /* ⚠️ AND WHAT A POINT TURNS INTO. A shop may declare points that convert to nothing (a pure loyalty count),
       but it should do that on purpose rather than by leaving the box empty, so an empty list is refused. */
    if (!Array.isArray(r.redeem) || !r.redeem.length)
      return 'Say what a point is worth — money off, an item, or a named thing.';
  }
  if (kind === 'pricing' && sub === 'tiered' && !(Array.isArray(r.tiers) && r.tiers.length)) return 'At least one tier is needed.';
  return null;
}
module.exports = { missingValue };
