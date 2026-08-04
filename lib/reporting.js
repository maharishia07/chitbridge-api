// @stage tested
// @stage-note Built for the network MIS + Beckn work that is queued. 17 assertions. No caller yet, by design — the Beckn phase is where it lands.
// @stage-why  Not called from the app. That is a STAGE, not a defect — CB is built experiment -> poc -> test -> implement.
//             tests/engine-boundary.test.js REQUIRES this tag on anything a route does not reach, so the roster
//             stays honest and nobody mistakes a stage for shipped capability.
'use strict';
/**
 * reporting.js — the NETWORK-LEVEL REPORTING CURRENCY, and mode 3 of a money summary.
 *
 * Athi, 2026-07-31: *"if there is a conversion table available then we can use it to convert to a common currency
 * used at network level. My only concern is it should not be summed under one currency."*
 *
 * ── THE HARD LINE THIS MODULE EXISTS TO HOLD ────────────────────────────────────────────────────────────────────
 *
 * A REPORTING currency is not a TRANSACTION currency. They are different things that look identical on a screen:
 *
 *   lib/regional.currencyFor()   what an order IS denominated in. Minted onto a chit, frozen by value, permanent.
 *   lib/reporting.js (here)      a LENS for looking at several chits at once. Display only. Never minted.
 *
 * Confusing the two would let a converted figure be written onto a chit as though two parties had agreed it — which
 * is the failure the whole currency model was built to prevent. So the guarantee here is STRUCTURAL, not a comment:
 *
 *   `convertForReport()` returns an object that deliberately FAILS `money.isMoney()`.
 *
 * It has no `amount`/`currency` pair, so it cannot be passed anywhere money is expected. A developer who tries to
 * stamp a converted total onto a chit gets a rejection from the money type rather than a plausible record. A test
 * asserts this and it must never be "tidied up" into a normal money value.
 *
 * ── WHERE A NETWORK'S CURRENCY COMES FROM ───────────────────────────────────────────────────────────────────────
 *
 * A network has no table. It is a `network_id` carried on catalogue items, plus an `operator` entity that governs
 * it. Under Athi's model the ENTITY owns the currency — and the operator is an entity — so:
 *
 *   1. the OPERATOR's governed currency          ← the answer today
 *   2. an explicit network declaration            ← when a network gains a home of its own; hook is below
 *   3. null — NOT a fallback.
 *
 * Step 3 is the important one. `currencyFor()` falls back to INR because a transaction must be denominated in
 * SOMETHING and the entity's own setting is the best available answer. A REPORT has no such obligation: if the
 * target cannot be determined, the honest outcome is that mode 3 is unavailable and the caller shows the split
 * instead. A guessed reporting currency produces a converted number that is confidently wrong, which is worse than
 * no number at all.
 */

const regional = require('./regional');
const money = require('./money');

/**
 * reportingCurrencyFor(networkId) → { currency, basis, operator_id } | null
 *
 * Returns null — never a guess — when the network's operator cannot be resolved unambiguously.
 */
async function reportingCurrencyFor(networkId, deps) {
  const { query, withEntity } = deps || {};
  const nid = String(networkId || '').trim();
  if (!nid || typeof query !== 'function') return null;

  // Every item in a network names its operator. They must AGREE; if they do not, the network's governance is
  // ambiguous and we refuse rather than picking one. Fail closed — the same rule the catalogue item resolver uses.
  let operators = [];
  try {
    const r = await withEntity(null, (db) => db.query(
      `SELECT DISTINCT item_data->>'operator' AS operator
         FROM catalogue_items
        WHERE item_data->>'network_id' = $1 AND is_active = true AND item_data->>'operator' IS NOT NULL`, [nid]));
    operators = (r.rows || []).map((x) => x.operator).filter(Boolean);
  } catch (_) { return null; }

  if (operators.length !== 1) return null;   // 0 = no operator set · >1 = ambiguous governance

  const operator_id = operators[0];
  const currency = await regional.currencyFor(operator_id);
  if (!currency || !money.CODE_RE.test(currency)) return null;

  return { currency, basis: 'operator', operator_id };
}

/**
 * convertForReport(summary, opts) → a DERIVED view. Never money.
 *
 * `summary` is the output of `money.summarise()`. `opts`:
 *   to      the reporting currency (from reportingCurrencyFor)
 *   rates   { INR: 1, USD: 88.2, … } — multipliers INTO `to`. Supplied by the CALLER, from a dated feed.
 *   as_of   the date those rates are from. REQUIRED.
 *   source  where they came from. REQUIRED.
 *
 * `as_of` and `source` are mandatory because a converted figure without them is indistinguishable from a settled
 * one on screen — which is the entire problem. There is no default and no "unknown".
 */
function convertForReport(summary, opts = {}) {
  const to = String(opts.to || '').trim().toUpperCase();
  if (!money.CODE_RE.test(to)) { const e = new Error('A reporting currency is required to convert. Resolve it first, or show the split instead.'); e.status = 422; throw e; }
  if (!opts.as_of)  { const e = new Error('A conversion needs the DATE its rates are from. A converted figure without one cannot be told apart from a settled one.'); e.status = 422; throw e; }
  if (!opts.source) { const e = new Error('A conversion needs the SOURCE of its rates. Rates belong to a dated feed, not to code.'); e.status = 422; throw e; }

  const rates = opts.rates || {};
  const lines = (summary && summary.by_currency) || [];

  // PARTIAL CONVERSION IS BANNED. Converting two of three currencies and quietly dropping the third yields a total
  // that looks complete and is not. Either every currency present has a rate, or nothing is converted.
  const missing = lines.map((l) => l.currency).filter((c) => c !== to && !Number.isFinite(Number(rates[c])));
  if (missing.length) {
    const e = new Error(`No rate for ${missing.join(', ')} into ${to}. A partial conversion is a wrong total that looks complete — showing the split is the correct answer here.`);
    e.status = 422; e.missing = missing; throw e;
  }
  const bad = Object.keys(rates).filter((c) => Number(rates[c]) <= 0);
  if (bad.length) { const e = new Error(`Rate for ${bad.join(', ')} must be greater than zero.`); e.status = 422; throw e; }

  const converted = lines.map((l) => {
    const rate = l.currency === to ? 1 : Number(rates[l.currency]);
    return { from: l.currency, original: l.total, rate, chits: l.chits, reported: money.round2(l.total * rate) };
  });

  return {
    // ⚠ NOT a money value, on purpose. No `amount`, no `currency` — so `money.isMoney()` rejects it and it cannot be
    //   written where a real denomination belongs. Do not "fix" these key names.
    derived: true,
    reporting_currency: to,
    reported_total: money.round2(converted.reduce((s, c) => s + c.reported, 0)),
    as_of: opts.as_of,
    source: opts.source,
    basis: opts.basis || null,
    lines: converted,
    // Carried through so a screen cannot show the converted figure without also being able to show the truth.
    split: lines,
    excluded: (summary && summary.excluded) || null,
    caveat: `DERIVED — converted into ${to} at rates as of ${opts.as_of} (${opts.source}). Not a settled figure, and not what either party agreed. The per-currency split is authoritative.`,
  };
}

module.exports = { reportingCurrencyFor, convertForReport };
