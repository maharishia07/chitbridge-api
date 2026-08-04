// @stage poc
// @stage-note Proven by scripts/prove-retention.js + retention-logic-test.js (FLOOR rule, 9/0). Phase 1 DELETES NOTHING; the destructive phase is human-gated, which is why no route calls it.
// @stage-why  Not called from the app. That is a STAGE, not a defect — CB is built experiment -> poc -> test -> implement.
//             tests/engine-boundary.test.js REQUIRES this tag on anything a route does not reach, so the roster
//             stays honest and nobody mistakes a stage for shipped capability.
// lib/retention.js — per-copy retention & end-of-life. A retention job IS a deletion job, so this module is built
// DRY-RUN-FIRST: planRetirement() reports what WOULD retire and never deletes unless called with { commit:true } AND
// the guardrails pass. The daily schedule is NOT enabled here — wiring it is a separate, human-gated step.
// See SPEC-retention-lifecycle.md + CB-CLI-PROOF-REQUEST-retention-lifecycle. Destructive parts require migration b105.
const { query, withEntity } = require('../db');

const DAY = 86400000;
const GRACE_DAYS = Number(process.env.RETENTION_GRACE_DAYS || 30);   // configured, NOT hard-coded (Athi's spec)
const SOFT_DELETE_DAYS = Number(process.env.RETENTION_SOFT_DELETE_DAYS || 7);
const MAX_EXTEND_DAYS = Number(process.env.RETENTION_MAX_EXTEND_DAYS || 365);   // extension is BOUNDED — never unbounded
const THRESHOLD_ROWS = Number(process.env.RETENTION_MAX_ROWS_PER_RUN || 1000);  // guardrail: refuse a runaway sweep
const THRESHOLD_PCT = Number(process.env.RETENTION_MAX_PCT_PER_RUN || 20);       // guardrail: refuse > N% in one run

// ── THE RULE (Athi's spec): retire_at is a FLOOR, not a restart. ──
// No dispute            → retire_at = retention_end
// Dispute resolved      → retire_at = MAX(retention_end, dispute_resolved_at + grace)   ← the floor; a late dispute does
//                                                                                          NOT add another full period
// Dispute still OPEN    → never retire (return null)
// A literal "restart the clock" is WRONG and this function must never implement it.
function computeRetireAt(retention_end, dispute_open, dispute_resolved_at, graceDays) {
  if (dispute_open) return null;                                  // the ONE override — an open dispute never retires
  const base = retention_end instanceof Date ? retention_end : new Date(retention_end);
  if (!dispute_resolved_at) return base;                          // no dispute → the plain retention end
  const grace = new Date(new Date(dispute_resolved_at).getTime() + (graceDays == null ? GRACE_DAYS : graceDays) * DAY);
  return grace.getTime() > base.getTime() ? grace : base;        // MAX(retention_end, resolved + grace) — a FLOOR
}

// a bounded extension only — reject unbounded/oversized requests (CB must not become a permanent custodian).
function boundedExtension(days) {
  const d = Math.floor(Number(days) || 0);
  if (!(d > 0)) { const e = new Error('extension must be a positive number of days'); e.status = 400; throw e; }
  if (d > MAX_EXTEND_DAYS) { const e = new Error('extension is capped at ' + MAX_EXTEND_DAYS + ' days (no unbounded retention)'); e.status = 400; throw e; }
  return d;
}

// ── DRY-RUN planner (safe): report which per-copy rows are due to retire TODAY, honouring the open-dispute override.
// Needs b105 (retire_at column + retention_config). Returns { candidates, guardrail } — deletes NOTHING here.
async function planRetirement({ commit = false } = {}) {
  // total live per-copy rows (denominator for the % guardrail)
  const total = await query('SELECT count(*)::int AS n FROM chit_status WHERE deleted_at IS NULL').then(r => r.rows[0].n).catch(() => null);
  // due = past retire_at, not on legal hold, and NOT under an open dispute (the override). retire_at from b105.
  const due = await query(
    `SELECT cs.chit_id, cs.entity_id
       FROM chit_status cs
      WHERE cs.deleted_at IS NULL
        AND COALESCE(cs.legal_hold,false) = false
        AND cs.retire_at IS NOT NULL AND cs.retire_at <= now()
        AND NOT EXISTS (SELECT 1 FROM chit_disputes d
                         WHERE d.chit_id = cs.chit_id AND d.entity_id = cs.entity_id AND d.status = 'open')`
  ).then(r => r.rows).catch((e) => { const err = new Error('Retention not migrated yet (b105).'); err.status = 503; err.code = e.code; throw err; });

  const n = due.length;
  const pct = total ? (n / total) * 100 : 0;
  const guardrail = { rows: n, total, pct: Math.round(pct * 10) / 10, threshold_rows: THRESHOLD_ROWS, threshold_pct: THRESHOLD_PCT };
  guardrail.blocked = n > THRESHOLD_ROWS || pct > THRESHOLD_PCT;   // refuse a runaway sweep — stop + alert, never mass-delete

  if (!commit || guardrail.blocked) return { mode: commit && guardrail.blocked ? 'BLOCKED' : 'dry-run', candidates: due, guardrail };
  // commit path is DELIBERATELY not implemented in this module yet — it must go through the b105 context-scoped
  // definer (retire_copy) under per-entity scoping, with the soft-delete window. Guarded here so it cannot mass-delete.
  return { mode: 'commit-not-wired', candidates: due, guardrail, note: 'commit path is human-gated; use the b105 definer per-copy' };
}

module.exports = { computeRetireAt, boundedExtension, planRetirement, GRACE_DAYS, SOFT_DELETE_DAYS, MAX_EXTEND_DAYS, THRESHOLD_ROWS, THRESHOLD_PCT };
