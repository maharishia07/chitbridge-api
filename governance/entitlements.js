'use strict';
// Pure entitlement guard. Enforces at the action. No DB — caller passes current counts.
// A plan is a plain object from constitution.plan_menu[name]. null limit = unlimited.

function planFor(constitution, planName) {
  const menu = (constitution && constitution.plan_menu) || {};
  const plan = menu[planName];
  if (!plan) {
    // default-deny: an unknown plan grants nothing
    return { max_entities: 0, chits_per_day: 0, max_networks: 0, network_depth: 0,
             public_facing: false, mode: 'b2b_only', _unknown: true };
  }
  return plan;
}

// counts (max_entities, max_networks, network_depth)
function checkCount(plan, resource, current) {
  const limit = plan[resource];
  if (limit === null || limit === undefined) return { ok: true, info: `${current} (unlimited)` };
  return { ok: current < limit, info: `${current}/${limit}` };
}

// rate limits over a window (chits_per_day) — same shape, windowed count supplied by caller
function checkRate(plan, resource, windowCount) {
  return checkCount(plan, resource, windowCount);
}

// capability gates (public_facing, b2b/b2c mode)
function checkCapability(plan, feature) {
  return { ok: Boolean(plan[feature]), value: plan[feature] };
}

module.exports = { planFor, checkCount, checkRate, checkCapability };
