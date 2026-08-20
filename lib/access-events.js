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
const ACTION_FOR = {
  hat: 'hat_changed',
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
  } catch (_) {
    /* table absent (pre-b172) or the write failed — never surface it to the caller. See the header. */
    return false;
  }
}

/**
 * recordChanges — compare a before-row and an after-row, and write one event per access field that moved.
 * Fields that are not about ACCESS (display_name, phone) are deliberately not tracked: a table that logs
 * everything is a table nobody reads.
 */
async function recordChanges(query, { entity_id, subject_identity_id, before, after, changed_by, reason }) {
  let n = 0;
  for (const field of Object.keys(ACTION_FOR)) {
    const b = before ? before[field] : undefined;
    const a = after ? after[field] : undefined;
    if (b === a) continue;
    if (b === undefined && a === undefined) continue;
    const ok = await record(query, {
      entity_id, subject_identity_id, action: ACTION_FOR[field],
      before: { [field]: b === undefined ? null : b },
      after: { [field]: a === undefined ? null : a },
      changed_by, reason,
    });
    if (ok) n++;
  }
  return n;
}

module.exports = { record, recordChanges, ACTION_FOR };
