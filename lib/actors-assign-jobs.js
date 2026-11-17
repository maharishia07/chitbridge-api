'use strict';
/**
 * lib/actors-assign-jobs.js — the three jobs of PUT /assign/:chit_id: pull (take an unassigned chit), push (hand it to a colleague), return (back to the pool).
 * OWNS      ASSIGN_JOBS · pullChit · pushChit · returnChit (no route, no state)
 * CALLED BY routes/actors.js (PUT /assign/:chit_id picks the job by the action)
 * FLOW      job({ req, res, client, handle, entity_id, chit_id, ... }) -> the one assignment writer (lib/assign-chit) -> state_log rows -> res.json
 * CARD      17-people-employees-hr-and-payroll/add-edit-switch-off-a-person
 */
const { problem } = require('./problem'); // API-STANDARD S1: the one error writer
const { words } = require('./actors-contract');
const railActions = require('./rail-actions'); // T1-RAIL — who is moving the copy (the rail's level ladder)
const { taskCount, assignChit } = require('./assign-chit'); /* TA1 · W1-RAIL: the one writer of who holds a chit and of a person's task count */

/**
 * PUT /assign/:chit_id does three jobs on one field (a mode switch: flagged, not split — the next major version of the route). Each job is one function below; `work` is what the route read:
 * the request, the transaction client (every statement runs in withEntity(me)), the chit row and who is moving it.
 */
/** pull — take an unassigned chit to my own tasks. */
async function pullChit(work) {
  const { req, res, client, handle, entity_id, chit_id, action_by_id, action_by_name, chitRow } = work;
  // Can only pull if unassigned
  if (chitRow.assigned_to_actor_id) {
    return problem(req, res, { status: 400, ...words.alreadyAssigned(chitRow.actor_name) });
  }
  /* W1-RAIL: the one assignment writer — the UPDATE and the back-to-pending step (rail-status statusGate) in one call */
  const movedOnPull = await assignChit(client, entity_id, chit_id, { identity_id: action_by_id, display_name: action_by_name }, 'pull', {
    me: railActions.meOf(req)
  });
  if (movedOnPull.refused) return problem(req, res, { status: 409, ...words.billTakenBack(movedOnPull.from) }); /* RAIL-173: nothing was written */
  await taskCount(handle, action_by_id, 'take');
  // Log assignment event
  await handle(
    `INSERT INTO state_log
           (chit_id, entity_id, action, action_by_identity_id,
            action_by_display_name, detail)
           SELECT $1, entity_id, 'assigned', $2, $3, $4
           FROM chit_status WHERE chit_id = $1 AND entity_id = $5`,
    [chit_id, action_by_id, action_by_name, `Pulled by ${action_by_name}`, entity_id]
  );
  // Log status reset to pending so it appears in Open tab for the new assignee — only when the copy actually moved
  if (movedOnPull.moved)
    await handle(
      `INSERT INTO state_log
           (chit_id, entity_id, action, action_by_identity_id,
            action_by_display_name, previous_status, new_status, detail)
           SELECT $1, entity_id, 'status_pending', $2, $3, $4, 'pending', $5
           FROM chit_status WHERE chit_id = $1 AND entity_id = $6`,
      [chit_id, action_by_id, action_by_name, movedOnPull.from, `Reset to pending — pulled by ${action_by_name}`, entity_id]
    );
  return res.json({
    message: 'Chit pulled to your My Task',
    action: 'pull',
    assigned_to: action_by_name,
    new_status: 'pending'
  });
}

/** push — hand a chit to a colleague who is on and may take work (a warning when they are full). */
async function pushChit(work) {
  const { req, res, client, handle, entity_id, chit_id, action_by_id, action_by_name, chitRow, target_actor_id } = work;
  if (!target_actor_id) {
    return problem(req, res, { status: 400, ...words.pushNeedsTarget() });
  }
  const target = await handle(
    `SELECT identity_id, display_name, current_task_count, max_tasks
           FROM identities
           WHERE identity_id = $1
           AND parent_entity_id = $2
           AND break_status = 'active'
           AND hat IN ('act','manager')`,
    [target_actor_id, entity_id]
  );
  if (target.rows.length === 0) {
    return problem(req, res, { status: 400, ...words.targetNotActive() });
  }
  const t = target.rows[0];
  // Warning if overloaded
  const overloaded = t.current_task_count >= t.max_tasks;

  const movedOnPush = await assignChit(client, entity_id, chit_id, t, 'push', { me: railActions.meOf(req) }); /* W1-RAIL: the one writer */
  if (movedOnPush.refused) return problem(req, res, { status: 409, ...words.billTakenBack(movedOnPush.from) }); /* RAIL-173: nothing was written, no count moved */
  // Reduce previous assignee count
  if (chitRow.assigned_to_actor_id) {
    await taskCount(handle, chitRow.assigned_to_actor_id, 'release');
  }
  await taskCount(handle, t.identity_id, 'take');
  // Log assignment — differentiate initial push from actor-to-actor transfer
  const isTransfer = !!chitRow.assigned_to_actor_id;
  const assignDetail = isTransfer
    ? `Transferred from ${chitRow.actor_name} to ${t.display_name} by ${action_by_name}`
    : `Assigned to ${t.display_name} by ${action_by_name}`;
  await handle(
    `INSERT INTO state_log
           (chit_id, entity_id, action, action_by_identity_id,
            action_by_display_name, detail)
           SELECT $1, entity_id, $2, $3, $4, $5
           FROM chit_status WHERE chit_id = $1 AND entity_id = $6`,
    [chit_id, isTransfer ? 'transferred' : 'assigned', action_by_id, action_by_name, assignDetail, entity_id]
  );
  // Log status reset to pending so it appears in Open tab for the new assignee — only when the copy actually moved
  if (movedOnPush.moved)
    await handle(
      `INSERT INTO state_log
           (chit_id, entity_id, action, action_by_identity_id,
            action_by_display_name, previous_status, new_status, detail)
           SELECT $1, entity_id, 'status_pending', $2, $3, $4, 'pending', $5
           FROM chit_status WHERE chit_id = $1 AND entity_id = $6`,
      [chit_id, action_by_id, action_by_name, movedOnPush.from, `Reset to pending — assigned to ${t.display_name} by ${action_by_name}`, entity_id]
    );
  return res.json({
    message: `Chit pushed to ${t.display_name}`,
    action: 'push',
    assigned_to: t.display_name,
    new_status: 'pending',
    warning: overloaded ? `${t.display_name} is at maximum load` : null
  });
}

/** return — give a chit back to the shop pool. */
async function returnChit(work) {
  const { res, client, handle, entity_id, chit_id, action_by_id, action_by_name, chitRow } = work;
  if (chitRow.assigned_to_actor_id) {
    await taskCount(handle, chitRow.assigned_to_actor_id, 'release');
  }
  await assignChit(client, entity_id, chit_id, null); /* W1-RAIL: back to the pool through the one writer */
  // One row per participant — each owns their copy of this return event
  await handle(
    `INSERT INTO state_log
           (chit_id, entity_id, action, action_by_identity_id,
            action_by_display_name, detail)
           SELECT $1, entity_id, 'returned', $2, $3, $4
           FROM chit_status WHERE chit_id = $1 AND entity_id = $5`,
    [chit_id, action_by_id, action_by_name, `Returned to entity pool${chitRow.actor_name ? ` from ${chitRow.actor_name}` : ''} by ${action_by_name}`, entity_id]
  );
  return res.json({
    message: 'Chit returned to entity pool',
    action: 'return'
  });
}
const ASSIGN_JOBS = { pull: pullChit, push: pushChit, return: returnChit };

module.exports = { ASSIGN_JOBS };
