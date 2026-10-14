// @stage tested
// @stage-note Writes the IAM audit trail (b172). Self-healing: silent no-op until the migration is applied.
'use strict';
/**
 * access-events.js — record who changed someone's access, when, and from what.
 *
 * IAM-SPEC.md §29. Before this there was no record of a hat change at all — `changed_by` existed in this
 * database exactly once, on catalogue item versions.
 *
 * ⚠️⚠️ A FAILED AUDIT WRITE MUST NEVER FAIL THE ACTION. If recording the change threw, a manager could be
 * blocked from granting access because the LOG was unavailable — the trail holding the product hostage. So
 * every call is wrapped and swallows. That is a deliberate trade and it is the wrong one for a bank; it is the
 * right one here, where the alternative is an outage caused by bookkeeping.
 *
 * ⚠️⚠️ BUT A SWALLOWED FAILURE MUST NOT BE A SILENT ONE (external review 2026-09-25, fixed 2026-09-28). The
 * trade above is about NOT FAILING THE ACTION — it never meant not SAYING so. record() logs every failure with
 * its code, recordChanges() reports how many were written and how many failed, and the route puts that in its
 * answer. routes/actors.js:505 already names the cost of silence: "Every access change since b172 went
 * unrecorded", found only by reading the table.
 *
 * ⚠️ AND IT IS SELF-HEALING. b172 may not be applied yet — Athi runs migrations, and code deploys first. An
 * absent table makes this a no-op rather than a 500 on every access change until he gets to it.
 *
 * ⭐ BEFORE AND AFTER, NOT JUST AFTER. "Ravi is now view_only" does not answer "what was he before", which is
 * the question actually asked when something has gone wrong.
 */

/**
 * diff(before, after, fields) — only what actually changed, as one event per concern.
 *
 * ⚠️ A PATCH that sets hat AND can_see_costs is TWO access changes, not one. Collapsing them into a single row
 * means a later reader cannot tell which of the two a reason referred to.
 */
const log = require('./logger');

/**
 * ⭐ HOW MANY AUDIT ROWS THIS PROCESS HAS LOST (SEC-SMALL item 1, 2026-10-14). The line below says each one; this
 * number says it to a reader who was not watching the log — GET /health carries it as `audit_lost`, so a reviewer
 * can see "0" and believe the trail, or see "14" and go looking. Per process, since boot: a restart resets it,
 * which is honest — the log line is the durable record, this is the gauge.
 */
let lost = 0;
/** the counter, read by /health (server.js); never written from outside */
function lostCount() { return lost; }

const ACTION_FOR = {
  /* ⭐ b173 — the level is the thing that matters now; `hat` is tracked only until the column is retired, so
     a change made by an un-redeployed client still leaves a record. */
  access_level: 'hat_changed',
  hat: 'hat_changed',
  /* ⚠️ REACH IS AN ACCESS CHANGE and must be recorded like one. Granting whole_entity turns a branch clerk
     into someone who sees the whole business — a bigger change than most hat moves, and one nobody would
     think to look for if it were untracked. */
  whole_entity: 'reach_changed',
  can_see_costs: 'costs_changed',
  break_status: 'break_changed',
};

async function record(query, { entity_id, subject_identity_id, action, before, after, changed_by, reason }) {
  try {
    await query(
      `INSERT INTO access_events
         (entity_id, subject_identity_id, action, before_value, after_value, changed_by, reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [entity_id, subject_identity_id, action,
       before === undefined ? null : JSON.stringify(before),
       after === undefined ? null : JSON.stringify(after),
       changed_by || null, reason || null]
    );
    return true;
  } catch (e) {
    /**
     * ⚠️⚠️ NEVER FAILS THE CALLER (see the header): an audit outage must not lock a shop out of granting access —
     * the manager's action still succeeds and `false` tells the route to say the row was not kept.
     * ⚠️ BUT NEVER SILENT: ERROR level through lib/logger (the one logger — a bare console line has no level
     * to alert on), with the event KIND and the database code and nothing that names a person: no subject id,
     * no changed_by, no reason text (SEC-SMALL item 1). 42P01 is "b172 not applied"; anything else (an RLS
     * refusal, a dead connection) is a real lost record. The counter is what /health shows.
     */
    lost++;
    log.error('access-events: audit row NOT written', { action, code: (e && e.code) || null, lost });
    return false;
  }
}

/**
 * recordChanges — compare a before-row and an after-row, and write one event per access field that moved.
 * Fields that are not about ACCESS (display_name, phone) are deliberately not tracked: a table that logs
 * everything is a table nobody reads.
 */
async function recordChanges(query, { entity_id, subject_identity_id, before, after, changed_by, reason }) {
  let n = 0, failed = 0;
  for (const field of Object.keys(ACTION_FOR)) {
    const b = before ? before[field] : undefined;
    const a = after ? after[field] : undefined;
    if (b === a) continue;
    if (b === undefined && a === undefined) continue;

    /**
     * ⚠️⚠️ ABSENT IS NOT "CHANGED TO NULL", AND TREATING IT AS ONE MADE THE TRAIL LIE. The first real events
     * this table ever recorded, minutes after b175 brought it back to life, included:
     *
     *     break_changed | {"break_status":"active"} → {"break_status":null}
     *
     * on a PATCH that never touched a break. `after` is the UPDATE's RETURNING row, which does not list
     * break_status, so `a` was undefined — and undefined was then written as null, which reads as "somebody
     * cleared this person's break status".
     *
     * ⭐ AN AUDIT TRAIL THAT INVENTS A CHANGE IS WORSE THAN ONE THAT MISSES IT. A gap is visibly a gap; a
     * fabricated entry is indistinguishable from evidence, and this one would have been read as an
     * unexplained act by whoever's name sits in changed_by. If the after-row does not carry the field, this
     * statement said nothing about it — which is not the same as saying it is now empty.
     */
    if (a === undefined) continue;

    const ok = await record(query, {
      entity_id, subject_identity_id, action: ACTION_FOR[field],
      before: { [field]: b === undefined ? null : b },
      after: { [field]: a === undefined ? null : a },
      changed_by, reason,
    });
    if (ok) n++; else failed++;
  }
  return { written: n, failed };
}

module.exports = { record, recordChanges, ACTION_FOR, lostCount };
