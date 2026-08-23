'use strict';
/**
 * lib/rates.js — WHAT A BILLABLE EVENT COSTS, AS A STAMPED CARD.
 *
 * Athi, 2026-08-22: *"if we have costing details per chit... this will help even if we change to a different
 * model like profit sharing"* — and on 2026-08-23: **"ledger only design confirmed."**
 *
 * ⭐⭐ SO THE CHARGE IS STAMPED, NOT REFERENCED, AND IT IS STAMPED INTO THE LEDGER ROW. The header columns from
 * the original design are not built: `usage_ledger` already carries `detail` (the chit id, a reference back to
 * the trade) plus `quantity`, `cost_usd` and a jsonb `meta`. Everything the header would have held fits there,
 * with one authority instead of two — which is the whole reason Athi chose it.
 *
 * ⚠️⚠️ A FOREIGN KEY TO A PRICE TABLE WOULD HAVE BEEN THE BUG. Re-pricing would silently rewrite history and
 * every past invoice would become unexplainable — the exact failure a chit avoids by freezing its terms at the
 * mint. So a ledger row copies the card's ID **and the numbers that applied**. Changing this file changes what
 * the NEXT event costs and never what a past one did.
 *
 * ⚠️ THE NUMBERS BELOW ARE ZERO ON PURPOSE. What a send is worth is Athi's decision and nobody else's; putting
 * a plausible-looking figure here would be an invented price that later reads as an agreed one. The MECHANISM
 * is what is being built — set `per_event_usd` (or switch `model`) and every subsequent row records it, with no
 * schema change and no migration. That portability is the point of the whole exercise.
 */

/**
 * The card in force. `id` is stamped on every row, so "which card charged this?" is answerable years later
 * even after the card has changed a dozen times.
 *
 * model:
 *   'per-event'  a flat charge per billable event  → cost = per_event_usd × quantity
 *   'share'      a percentage of the trade's value → cost = basis × share_pct / 100
 *
 * ⚠️ `share` needs a BASIS, which only some events have (a chit has a value; a KYB lookup does not). An event
 * with no basis falls back to `per-event` rather than charging zero silently — a share model that quietly bills
 * nothing for half the events is worse than one that is obviously flat.
 */
const CARD = {
  id: 'rc-2026-08-dev',
  model: 'per-event',
  per_event_usd: 0,
  share_pct: 0,
  currency: 'USD',
  note: 'development card — every rate is zero until Athi sets one',
};

/**
 * What this event costs, and the evidence for it.
 * Returns `{ cost_usd, rate }` where `rate` is the stamp that goes into `meta.rate` — the card id, the model,
 * and the numbers actually applied, so the charge can be re-derived without this file.
 */
function priceOf({ quantity = 1, basis = null } = {}) {
  const q = Number(quantity) || 0;
  const b = basis == null ? null : Number(basis);
  const usable = CARD.model === 'share' && Number.isFinite(b) && b > 0;
  const model = usable ? 'share' : 'per-event';

  const cost = usable
    ? (b * (Number(CARD.share_pct) || 0)) / 100
    : q * (Number(CARD.per_event_usd) || 0);

  return {
    cost_usd: Math.round((Number(cost) || 0) * 10000) / 10000,   // the column is numeric(12,4)
    rate: {
      card: CARD.id,
      model,
      /* Only the number that actually applied — recording both invites a later reader to use the wrong one. */
      ...(model === 'share' ? { share_pct: CARD.share_pct } : { per_event_usd: CARD.per_event_usd }),
      /* ⚠️ Stated even when it did not apply, because "there was no basis" is the reason the model fell back. */
      basis: Number.isFinite(b) ? b : null,
    },
  };
}

module.exports = { CARD, priceOf };
