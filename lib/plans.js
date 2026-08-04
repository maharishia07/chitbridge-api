// @stage held
// @stage-note Subscription plans + entitlement/quota. A HELD design foundation — written, deliberately not wired, waiting on the entitlement-limits decision. No test and no script: the least mature thing in lib/.
// @stage-why  Not called from the app. That is a STAGE, not a defect — CB is built experiment -> poc -> test -> implement.
//             tests/engine-boundary.test.js REQUIRES this tag on anything a route does not reach, so the roster
//             stays honest and nobody mistakes a stage for shipped capability.
// lib/plans.js — subscription plan catalogue + entitlement/quota mechanism (HELD design foundation).
// A Plan = { quotas (hard numeric caps), features (enabled modules) }.
// The NETWORK TOP NODE (billing root) holds the plan; quotas count TOTAL across its subtree (the tenant),
// NOT per node. Children inherit the root's plan. Enforcement is server-side only (never trust the client).
// NOTE: tier names + numbers below are PLACEHOLDERS — set them from the real subscription model.

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

// PLACEHOLDER tiers — REVIEW/SET from the subscription model. Quotas are hard caps; null = unlimited.
const PLANS = {
  starter:    { name: 'Starter',    quotas: { entities: 1,    actors: 3,    chits_per_month: 200,   network_depth: 1,    suppliers: 10   }, features: ['catalogue', 'chits', 'task', 'order'] },
  team:       { name: 'Team',       quotas: { entities: 5,    actors: 15,   chits_per_month: 2000,  network_depth: 2,    suppliers: 50   }, features: ['catalogue', 'chits', 'task', 'order', 'suppliers', 'disputes', 'coassists'] },
  business:   { name: 'Business',   quotas: { entities: 25,   actors: 100,  chits_per_month: 20000, network_depth: 4,    suppliers: 500  }, features: ['catalogue', 'chits', 'task', 'order', 'suppliers', 'disputes', 'coassists', 'network', 'mis'] },
  enterprise: { name: 'Enterprise', quotas: { entities: null, actors: null, chits_per_month: null,  network_depth: null, suppliers: null }, features: FEATURES.slice() },
};
const DEFAULT_PLAN = 'starter';

const plan        = (code) => PLANS[code] || PLANS[DEFAULT_PLAN];
const hasFeature  = (code, f) => plan(code).features.includes(f);
const quota       = (code, resource) => { const q = plan(code).quotas[resource]; return q === undefined ? null : q; }; // null = unlimited
// true if adding `n` more stays within the cap (null cap = unlimited → always allowed).
const withinQuota = (code, resource, current, n = 1) => { const cap = quota(code, resource); return cap == null || (current + n) <= cap; };
// expand a selected feature set to include all dependencies (so any pick is actually usable).
function resolveBundle(features) {
  const out = new Set();
  const add = (f) => { if (out.has(f)) return; out.add(f); (FEATURE_DEPS[f] || []).forEach(add); };
  (features || []).forEach(add);
  return [...out];
}
// validate a plan's feature list is closed under deps (catches a broken/partial plan definition).
const planClosed = (features) => resolveBundle(features).every((f) => (features || []).includes(f));

module.exports = { FEATURES, FEATURE_DEPS, PLANS, DEFAULT_PLAN, plan, hasFeature, quota, withinQuota, resolveBundle, planClosed };
