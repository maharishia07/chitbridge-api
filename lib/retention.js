// @stage poc
// @stage-note Proven by scripts/prove-retention.js + retention-logic-test.js (FLOOR rule, 9/0). Phase 1 DELETES NOTHING; the destructive phase is human-gated, which is why no route calls it.
// @stage-why  Not called from the app. That is a STAGE, not a defect — CB is built experiment -> poc -> test -> implement.
//             tests/engine-boundary.test.js REQUIRES this tag on anything a route does not reach, so the roster
//             stays honest and nobody mistakes a stage for shipped capability.
// lib/retention.js — per-copy retention & end-of-life. A retention job IS a deletion job, so this module is built
// DRY-RUN-FIRST: planRetirement() reports what WOULD retire and never deletes unless called with { commit:true } AND
// the guardrails pass AND an archive receipt is handed (DB-21) AND the attempt is logged in ops.retention_flush_log (PM-16, b772). The daily schedule is NOT enabled here — wiring it is a separate, human-gated step.
// See SPEC-retention-lifecycle.md + CB-CLI-PROOF-REQUEST-retention-lifecycle. Destructive parts require migration b105.
const { query, withEntity } = require('../db');
const log = require('./logger');
const { RECORDS_FLOOR_YEARS } = require('./policy'); // CO3: no copy younger than the records-law floor is ever a candidate

const DAY = 86400000;
const GRACE_DAYS = Number(process.env.RETENTION_GRACE_DAYS || 30); // configured, NOT hard-coded (Athi's spec)
const SOFT_DELETE_DAYS = Number(process.env.RETENTION_SOFT_DELETE_DAYS || 7);
const MAX_EXTEND_DAYS = Number(process.env.RETENTION_MAX_EXTEND_DAYS || 365); // extension is BOUNDED — never unbounded
const THRESHOLD_ROWS = Number(process.env.RETENTION_MAX_ROWS_PER_RUN || 1000); // guardrail: refuse a runaway sweep
const THRESHOLD_PCT = Number(process.env.RETENTION_MAX_PCT_PER_RUN || 20); // guardrail: refuse > N% in one run

// ── THE RULE (Athi's spec): retire_at is a FLOOR, not a restart. ──
// No dispute            → retire_at = retention_end
// Dispute resolved      → retire_at = MAX(retention_end, dispute_resolved_at + grace)   ← the floor; a late dispute does
//                                                                                          NOT add another full period
// Dispute still OPEN    → never retire (return null)
// A literal "restart the clock" is WRONG and this function must never implement it.
function computeRetireAt(retention_end, dispute_open, dispute_resolved_at, graceDays) {
  if (dispute_open) return null; // the ONE override — an open dispute never retires
  const base = retention_end instanceof Date ? retention_end : new Date(retention_end);
  if (!dispute_resolved_at) return base; // no dispute → the plain retention end
  const grace = new Date(new Date(dispute_resolved_at).getTime() + (graceDays == null ? GRACE_DAYS : graceDays) * DAY);
  return grace.getTime() > base.getTime() ? grace : base; // MAX(retention_end, resolved + grace) — a FLOOR
}

// a bounded extension only — reject unbounded/oversized requests (CB must not become a permanent custodian).
function boundedExtension(days) {
  const d = Math.floor(Number(days) || 0);
  if (!(d > 0)) {
    const e = new Error('extension must be a positive number of days');
    e.status = 400;
    throw e;
  }
  if (d > MAX_EXTEND_DAYS) {
    const e = new Error('extension is capped at ' + MAX_EXTEND_DAYS + ' days (no unbounded retention)');
    e.status = 400;
    throw e;
  }
  return d;
}

// ── DB-21 (K-DB, 21 Oct 2026): IRREVERSIBLE ONLY EVER FOLLOWS REVERSIBLE. A commit is refused unless the caller hands the receipt of an
// archive that already holds the candidates. Where the archive lives is Athi's call (MANIFEST.md); NO table here holds archived copies
// (the database is at the Free-plan quota). A receipt: { archive_ref: where it went, sha256: 64 hex of what was written, rows: the count
// archived, which must equal the candidates now due, at: when }.
const SHA256_HEX = /^[0-9a-f]{64}$/;
/** what is wrong with this receipt for these candidates, in words — or null when it may stand */
function receiptProblem(receipt, candidates) {
  if (!receipt || typeof receipt !== 'object') return 'no archive receipt: archive the copies first, then commit with its receipt';
  if (!receipt.archive_ref || typeof receipt.archive_ref !== 'string') return 'the receipt does not say where the archive is (archive_ref)';
  if (!SHA256_HEX.test(String(receipt.sha256 || ''))) return 'the receipt has no sha256 of what was archived';
  if (receipt.rows !== candidates) return 'the receipt archived ' + receipt.rows + ' copies and ' + candidates + ' are due now: archive again';
  if (isNaN(Date.parse(receipt.at))) return 'the receipt has no time (at)';
  return null;
}
/** PM-16: every commit attempt is one ops.retention_flush_log row (b772), written through its one definer. → the row id, or null when
 *  it could not be written (b772 not run, or the database refused) — then the commit is refused too: no flush without its event. */
async function logFlush(event) {
  try {
    const r = await query('SELECT ops.f_retention_flush_event($1, $2, $3, $4, $5, $6) AS id', [
      event.mode,
      event.reason || null,
      event.candidates,
      event.deleted || 0,
      event.receipt ? JSON.stringify(event.receipt) : null,
      JSON.stringify(event.guardrail || {})
    ]);
    return r.rows[0].id;
  } catch (e) {
    log.fellBack('retention: the flush event was not written (b772 ops.retention_flush_log) — the commit is refused', e);
    return null;
  }
}
/** the commit door: refused (BLOCKED, 0 deleted) without a sound receipt or without its logged event; otherwise still human-gated */
async function commitGate(due, guardrail, archiveReceipt) {
  const problem = receiptProblem(archiveReceipt, due.length);
  const mode = problem ? 'BLOCKED' : 'commit-not-wired';
  const flushId = await logFlush({ mode, reason: problem, candidates: due.length, deleted: 0, receipt: archiveReceipt, guardrail });
  if (problem) return { mode, reason: problem, deleted: 0, flush_id: flushId, candidates: due, guardrail };
  if (!flushId) return { mode: 'BLOCKED', reason: 'the flush event could not be logged (b772)', deleted: 0, flush_id: null, candidates: due, guardrail };
  // the commit path is DELIBERATELY not implemented in this module yet — it must go through the b105 context-scoped definer
  // (retire_copy) under per-entity scoping, with the soft-delete window. Guarded here so it cannot mass-delete.
  return { mode, deleted: 0, flush_id: flushId, candidates: due, guardrail, note: 'commit path is human-gated; use the b105 definer per-copy' };
}

// ── DRY-RUN planner (safe): report which per-copy rows are due to retire TODAY, honouring the open-dispute override.
// Needs b105 (retire_at column + retention_config). Returns { candidates, guardrail } — deletes NOTHING here.
async function planRetirement({ commit = false, archiveReceipt = null } = {}) {
  // total live per-copy rows (denominator for the % guardrail)
  const total = await query('SELECT count(*)::int AS n FROM chit_status WHERE deleted_at IS NULL')
    .then((reply) => reply.rows[0].n)
    .catch(log.orElse('retention: the read failed — answered with nothing', null));
  // due = past retire_at, not on legal hold, and NOT under an open dispute (the override). retire_at from b105.
  const due = await query(
    `SELECT cs.chit_id, cs.entity_id
       FROM chit_status cs
      WHERE cs.deleted_at IS NULL
        AND COALESCE(cs.legal_hold,false) = false
        AND cs.retire_at IS NOT NULL AND cs.retire_at <= now()
        AND cs.created_at IS NOT NULL AND cs.created_at <= now() - make_interval(years => $1::int)
        AND NOT EXISTS (SELECT 1 FROM chit_disputes d
                         WHERE d.chit_id = cs.chit_id AND d.entity_id = cs.entity_id AND d.status = 'open')`,
    [RECORDS_FLOOR_YEARS]
  )
    .then((reply) => reply.rows)
    .catch((e) => {
      const err = new Error('Retention not migrated yet (b105).');
      err.status = 503;
      err.code = e.code;
      throw err;
    });

  const n = due.length;
  const pct = total ? (n / total) * 100 : 0;
  const guardrail = { rows: n, total, pct: Math.round(pct * 10) / 10, threshold_rows: THRESHOLD_ROWS, threshold_pct: THRESHOLD_PCT };
  guardrail.blocked = n > THRESHOLD_ROWS || pct > THRESHOLD_PCT; // refuse a runaway sweep — stop + alert, never mass-delete

  if (!commit) return { mode: 'dry-run', candidates: due, guardrail };
  if (guardrail.blocked) {
    const reason = 'the guardrail refused a runaway sweep';
    const flushId = await logFlush({ mode: 'BLOCKED', reason, candidates: n, guardrail, receipt: archiveReceipt });
    return { mode: 'BLOCKED', reason, deleted: 0, flush_id: flushId, candidates: due, guardrail };
  }
  return commitGate(due, guardrail, archiveReceipt);
}

module.exports = {
  computeRetireAt,
  boundedExtension,
  planRetirement,
  receiptProblem,
  RECORDS_FLOOR_YEARS,
  GRACE_DAYS,
  SOFT_DELETE_DAYS,
  MAX_EXTEND_DAYS,
  THRESHOLD_ROWS,
  THRESHOLD_PCT
};
