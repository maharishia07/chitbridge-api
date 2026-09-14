// @stage held
// @stage-note Subscription plans + entitlement/quota. A HELD design foundation — written, deliberately not wired, waiting on the entitlement-limits decision. No test and no script: the least mature thing in lib/.
// @stage-why  Not called from the app. That is a STAGE, not a defect — CB is built experiment -> poc -> test -> implement.
//             tests/engine-boundary.test.js REQUIRES this tag on anything a route does not reach, so the roster
//             stays honest and nobody mistakes a stage for shipped capability.
// lib/plans.js — subscription plan catalogue + entitlement/quota mechanism (HELD design foundation).
// A Plan = { quotas (hard numeric caps), features (enabled modules) }.
// The NETWORK TOP NODE (billing root) holds the plan; quotas count TOTAL across its subtree (the tenant),
// NOT per node. Children inherit the root's plan. Enforcement is server-side only (never trust the client).
// ⭐ TIER NAMES are decided (Athi 2026-09-14): test · free · silver · gold · platinum. The NUMBERS are not,
//   and are recorded as ABSENT rather than null so they cannot read as unlimited. See quotaOf().

// Feature modules the app exposes (gate routes + panels on these).
const FEATURES = ['catalogue', 'chits', 'task', 'order', 'suppliers', 'network', 'disputes', 'mis', 'coassists'];

// Dependency graph — a feature is only useful with its prerequisites. resolveBundle() expands a selection,
// so "I want disputes" auto-includes chits + catalogue. (Confirm against the agreed minimal-viable bundles.)
const FEATURE_DEPS = {
  catalogue: [],
  chits:     ['catalogue'],
  task:      ['chits'],
  order:     ['chits'],
  disputes:  ['chits'],
  mis:       ['chits'],
  suppliers: ['catalogue'],
  network:   [],
  coassists: [],
};

/**
 * ── ⚠️⚠️ THREE STATES, NOT TWO, AND CONFLATING THEM IS THE BUG THIS BLOCK EXISTS TO PREVENT ────────────────────
 *
 * Athi, 2026-09-14: *"free plan should have limits, test entities do not have."*
 *
 *     limited: false            UNLIMITED BY DESIGN. Only `test`. There is nothing to enforce.
 *     limited: true, quota set  a real cap. Enforce it.
 *     limited: true, quota ABSENT  ⚠️ NOT YET DECIDED — and it MUST NOT read as unlimited.
 *
 * The obvious shortcut is `quotas: { actors: null }` on free and a comment saying "to be set". That is exactly
 * wrong: `null` already means unlimited everywhere in this file, so a free tier that is supposed to be capped
 * would silently be the most generous plan on offer, and nothing would ever say so.
 *
 * ⭐ So an unset quota is ABSENT, and quotaOf() returns the state rather than a number. Enforcement must refuse
 * to evaluate an unset quota and say so — fail closed on configuration, never open.
 */
const PLANS = {
  /* ⭐ NOT FOR SALE. No terms, no invoice, no limits — what every entity is on today. It exists so that
     "nobody has assigned a plan" and "chose the cheapest tier" can never be confused, which is exactly what
     the old default of 'free' made impossible. */
  test:     { name: 'Test',     sellable: false, limited: false,
              quotas: { entities: null, actors: null, chits_per_month: null, network_depth: null, suppliers: null },
              features: FEATURES.slice() },

  /* ⚠️ A REAL TIER, AT NO COST — not the absence of a tier. It is capped; the caps are not set yet. */
  free:     { name: 'Free',     sellable: true,  limited: true, quotas: {},
              features: ['catalogue', 'chits'] },

  silver:   { name: 'Silver',   sellable: true,  limited: true, quotas: {},
              features: ['catalogue', 'chits', 'task', 'order'] },

  gold:     { name: 'Gold',     sellable: true,  limited: true, quotas: {},
              features: ['catalogue', 'chits', 'task', 'order', 'suppliers', 'disputes', 'coassists'] },

  platinum: { name: 'Platinum', sellable: true,  limited: true, quotas: {},
              features: FEATURES.slice() },
};
const DEFAULT_PLAN = 'test';

/**
 * What this plan says about one quota. Returns a STATE, never a bare number, so a caller cannot accidentally
 * treat "nobody has decided" as "no limit".
 *
 *   { state: 'unlimited' }              → allow
 *   { state: 'capped', limit: 15 }      → compare
 *   { state: 'unset' }                  → ⚠️ DO NOT ENFORCE, and say so. A cap nobody set is not a cap of zero
 *                                          and it is not infinity either; it is a configuration gap, and
 *                                          silently picking either answer is how a shop gets blocked or a bill
 *                                          gets missed.
 */
function quotaOf(code, key) {
  const p = plan(code);
  if (!p.limited) return { state: 'unlimited' };
  const v = p.quotas ? p.quotas[key] : undefined;
  if (v === undefined) return { state: 'unset' };
  if (v === null) return { state: 'unlimited' };
  return { state: 'capped', limit: v };
}

const plan        = (code) => PLANS[code] || PLANS[DEFAULT_PLAN];
const hasFeature  = (code, f) => plan(code).features.includes(f);
/**
 * ⚠️⚠️ DEPRECATED — USE quotaOf(). These two collapse three states into two and get the dangerous one wrong.
 *
 * `quota()` returned `null` for an ABSENT quota, and `null` means UNLIMITED everywhere in this file. So every
 * capped tier whose numbers are not set yet — free, silver, gold, platinum, all of them today — reported as
 * unlimited, and `withinQuota()` answered true to everything. A free tier that is supposed to be the most
 * restricted would have been the most generous plan on offer, silently.
 *
 * ⭐ They now delegate to quotaOf() and treat 'unset' as ALLOW-BUT-NOT-A-DECISION, which is the only safe
 * reading while nothing is enforced: refusing would block a shop over a number nobody has chosen. ⚠️ THAT MAKES
 * THEM UNUSABLE AS AN ENFORCEMENT GATE — a gate that cannot tell "no limit" from "no decision" must not decide.
 * Enforcement reads quotaOf() and handles `state === 'unset'` explicitly.
 */
const quota = (code, resource) => {
  const q = quotaOf(code, resource);
  return q.state === 'capped' ? q.limit : null;      // unlimited AND unset both read as null here — see above
};
const withinQuota = (code, resource, current, n = 1) => {
  const q = quotaOf(code, resource);
  if (q.state === 'capped') return (current + n) <= q.limit;
  return true;                                        // unlimited, or nobody has set it yet
};
// expand a selected feature set to include all dependencies (so any pick is actually usable).
function resolveBundle(features) {
  const out = new Set();
  const add = (f) => { if (out.has(f)) return; out.add(f); (FEATURE_DEPS[f] || []).forEach(add); };
  (features || []).forEach(add);
  return [...out];
}
// validate a plan's feature list is closed under deps (catches a broken/partial plan definition).
const planClosed = (features) => resolveBundle(features).every((f) => (features || []).includes(f));

module.exports = { quotaOf, FEATURES, FEATURE_DEPS, PLANS, DEFAULT_PLAN, plan, hasFeature, quota, withinQuota, resolveBundle, planClosed };
