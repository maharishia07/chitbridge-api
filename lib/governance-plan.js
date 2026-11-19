'use strict';
/**
 * lib/governance-plan.js — the active constitution (cached read) and the plan's daily-chit guard.
 * OWNS      loadActiveConstitution · CHITS_TODAY_SQL · countChitsToday · assertChitAllowed (no route, no state)
 * CALLED BY routes/governance.js (re-exports all four; the Home Plan card reads countChitsToday and CHITS_TODAY_SQL)
 * FLOW      loadActiveConstitution (memo, one minute) -> planFor / checkRate -> assertChitAllowed throws 503 (no constitution) or 429 (daily chit limit)
 * CARD      20-settings-governance-and-plan/governance-7-layers-govcontext
 */
const { query, withEntity } = require('../db');
const { memo } = require('./confcache'); // the active constitution is read once a minute, not once a call
const { planFor, checkRate } = require('../governance/entitlements');

// ── load the active constitution (shaped for the resolver) ──
/**
 * ⭐ CACHED — see lib/confcache.js. This runs on EVERY profile paint (routes/entities.js reads plan_menu twice,
 * network-design once) plus four times in this file, and `platform_constitution` has no writer anywhere in the
 * API: it is migration-only. That was a round trip per call against a table that changes when a migration says so.
 *
 * ⚠️ THE RETURNED OBJECT IS NOW SHARED BETWEEN CALLERS AND MUST NOT BE MUTATED. Checked when this changed:
 * `resolver.resolve()` reads and `.slice()`s, `entitlements.planFor()` hands `plan_menu[name]` by reference to
 * `checkCount`/`checkRate`/`checkCapability` which only read, and the three `plan_menu` readers outside this
 * file only read. Nothing assigns into either. If that ever changes, copy at the read rather than here.
 *
 * ⚠️ A THROW IS NOT CACHED (memo stores only a resolved value), so a database blip cannot become a full minute
 * of "no active constitution" — which every caller in this file turns into a 503.
 */
async function loadActiveConstitution() {
  return memo('platform_constitution:active', async () => {
    const { rows } = await query(
      `SELECT pc.version, pc.params, pc.plan_menu, pc.root_id
         FROM platform_constitution pc
         JOIN platform_root pr ON pr.root_id = pc.root_id
        WHERE pc.is_active LIMIT 1`
    );
    if (!rows.length) return null; // no-orphan: caller must reject
    const r = rows[0];
    return { version: r.version, root_id: r.root_id, plan_menu: r.plan_menu, ...r.params };
  });
}

/** today's chits sent by one entity (UTC day) — also read by the Home Plan card, in its own batch (SET-35) */
const CHITS_TODAY_SQL = `SELECT count(*)::int AS n FROM chit_header
      WHERE sender_entity_id = $1
        AND sent_at >= date_trunc('day', now() AT TIME ZONE 'UTC')`;
async function countChitsToday(entityId) {
  // UTC-day window (absolute-time invariant). B1 RLS: an entity's own sent chits -> withEntity(entity). (Dormant
  // guard — call it OUTSIDE any open entity transaction to avoid nesting when it's eventually wired.)
  const { rows } = await withEntity(entityId, (c) => c.query(CHITS_TODAY_SQL, [entityId]));
  return rows[0] ? rows[0].n : 0; /* no row is no chits, never a throw */
}

// ── Guards to call from core flows WHEN enforcement is enabled (not wired yet) ──
async function assertChitAllowed(entityId, plan) {
  const active = await loadActiveConstitution();
  if (!active) {
    const e = new Error('no active constitution');
    e.status = 503;
    throw e;
  }
  const used = await countChitsToday(entityId);
  const r = checkRate(planFor(active, plan), 'chits_per_day', used);
  if (!r.ok) {
    const e = new Error('daily chit limit reached');
    e.status = 429;
    e.quota = r.info;
    throw e;
  }
}

module.exports = { loadActiveConstitution, CHITS_TODAY_SQL, countChitsToday, assertChitAllowed };
