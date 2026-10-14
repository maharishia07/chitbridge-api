// @stage tested
'use strict';
/**
 * assign-chit.js — ⭐⭐ THE ONE WRITER OF A PERSON'S TASK COUNT (TA1, 14 Oct).
 *
 * identities.current_task_count is what auto-assign ranks people by and what the break/leave gate refuses on. Taking,
 * pushing, returning, reassigning, routing on leave and the bulk assign each wrote it with their own UPDATE — 13 statements
 * in routes/actors.js and routes/chits.js, two spellings of "minus one" and one "plus one" that forgot last_assigned_at was
 * the tie-break. They all come here now; tests/one-writer.test.cjs fails on a second writer.
 *
 * taskCount(run, identity_id, change) — on the caller's transaction:
 *   'take'     +1 and last_assigned_at = now (the round-robin tie-break)
 *   'release'  −1, never below zero
 *   'clear'    0 (a person whose work was routed elsewhere)
 *   { add: n } +n (work routed TO this person in one go; last_assigned_at is not moved, as before)
 * run — a query function (sql, params) or a connection with .query. A missing id is a no-op.
 */
async function taskCount(run, identity_id, change) {
  if (!identity_id) return null;
  const q = typeof run === 'function' ? run : (t, p) => run.query(t, p);
  if (change === 'take')
    return q(`UPDATE identities SET current_task_count = current_task_count + 1, last_assigned_at = NOW() WHERE identity_id = $1`, [identity_id]);
  if (change === 'release')
    return q(`UPDATE identities SET current_task_count = GREATEST(0, current_task_count - 1) WHERE identity_id = $1`, [identity_id]);
  if (change === 'clear')
    return q(`UPDATE identities SET current_task_count = 0 WHERE identity_id = $1`, [identity_id]);
  if (change && Number.isInteger(change.add))
    return q(`UPDATE identities SET current_task_count = current_task_count + $1 WHERE identity_id = $2`, [change.add, identity_id]);
  throw new Error('taskCount: unknown change ' + JSON.stringify(change));
}

module.exports = { taskCount };
