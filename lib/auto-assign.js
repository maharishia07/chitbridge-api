'use strict';
/**
 * CARD 01-rail-core-the-chit/assign
 * auto-assign.js — THE AUTO DOOR: a freshly arrived chit is handed to a person by the entity's own mode (off · default_assignee · least_loaded = round robin under the cap, overflow to the default).
 *
 * OWNS      autoAssign(entity_id, chit_id, plug) → the assignee's identity id, or null (mode off, already held, nobody eligible) · pickAutoAssignTarget · resolveDelegateTarget
 * CALLED BY routes/chits.js (the receiver's door after a send: plug 'task', copy received) · lib/jobs-open.js (the firm's door after it opens a job: plug 'client', copy sent)
 * FLOW      the register says which copy (lib/assign-register copy) → settings read → copy still unassigned? → pick → delegate past leave → assignChit (the ONE writer) → taskCount → state_log
 * ASSIGN-1 (Athi 17 Nov, ADOPT what is built): this was autoAssignReceived in routes/chits.js, moved here byte for byte except that the COPY comes from the plug-in's register entry, so default assignee and round robin
 * work for a job chit the business opened itself with no second picker. The picker is untouched. Best-effort by contract: callers run it AFTER commit and never fail the chit on it.
 */
const { withEntity } = require('../db');
const railStatus = require('./rail-status');
const { assignChit, taskCount } = require('./assign-chit');
const { entryOf } = require('./assign-register');

// Walk the delegate chain when the chosen actor is on leave / not-assignable. Returns an assignable
// actor id (active + Act/Manager hat) or null. Loop-guarded (visited set + depth cap). Capacity is
// NOT re-checked here — the default/overflow assignee absorbs excess by design (D1).
async function resolveDelegateTarget(client, entity_id, actorId) {
  const seen = new Set();
  let current = actorId;
  let depth = 0;
  while (current && depth < 12) {
    if (seen.has(current)) return null; // cycle → give up (set-time check is the primary guard)
    seen.add(current);
    const actor = (
      await client.query(
        `SELECT identity_id, break_status, hat, delegate_actor_id
         FROM identities WHERE identity_id = $1 AND parent_entity_id = $2 AND identity_type = 'actor'`,
        [current, entity_id]
      )
    ).rows[0];
    if (!actor) return null;
    if (actor.break_status === 'active' && (actor.hat === 'act' || actor.hat === 'manager')) return actor.identity_id;
    current = actor.delegate_actor_id;
    depth++; // on leave / not assignable → try their delegate
  }
  return null;
}

// Auto-assign a freshly-received chit per the entity's mode. Atomic + idempotent (skips if already
// assigned). Caller runs it best-effort AFTER commit so it can never fail the guaranteed chit.
async function autoAssign(entity_id, chit_id, plug) {
  const copy = (entryOf(plug) || entryOf('task')).copy; /* ASSIGN-1: WHICH of my copies the register says holds the assignment (task: received; client job: sent) */
  // B1 RLS: the entity auto-assigns within its OWN roster -> withEntity(entity), not withTransaction.
  return withEntity(entity_id, async (client) => {
    const settings = await readAutoAssignSettings(client, entity_id);
    const mode = (settings && settings.auto_assign_mode) || 'off';
    if (mode === 'off') return null;

    // Idempotency + scope: only the actionable received copy, still unassigned.
    const copyStatus = await readCopyStatus(client, entity_id, chit_id, copy);
    if (!copyStatus || copyStatus.assigned_to_actor_id) return null;

    let target = await pickAutoAssignTarget(client, entity_id, mode, settings);
    if (!target) return null; // no eligible actor + no default → stays in the pool

    target = await resolveDelegateTarget(client, entity_id, target); // route past anyone on leave
    if (!target) return null;

    const assignee = (
      await client.query(
        `SELECT identity_id, display_name FROM identities
         WHERE identity_id = $1 AND parent_entity_id = $2 AND identity_type = 'actor'`,
        [target, entity_id]
      )
    ).rows[0];
    if (!assignee) return null;

    /* ⭐ W1-RAIL: the one assignment writer (lib/assign-chit) — my received copy, then back to pending through the ONE status write
       (T1-RAIL, rail-status statusGate), never a bare SET. The status was read with the row above — no second read. The shop's own
       automation moves it as SYSTEM. */
    await assignChit(client, entity_id, chit_id, assignee, 'auto', { copy, me: railStatus.SYSTEM, from: copyStatus.current_status });
    await taskCount(client, assignee.identity_id, 'take'); /* TA1 */
    await client.query(
      `INSERT INTO state_log (chit_id, entity_id, action, action_by_identity_id, action_by_display_name, new_status, detail)
       VALUES ($1, $2, 'assigned', NULL, 'System (auto-assign)', 'pending', $3)`,
      [chit_id, entity_id, `Auto-assigned to ${assignee.display_name} (${mode === 'least_loaded' ? 'least-loaded' : 'default assignee'})`]
    );
    return assignee.identity_id;
  });
}
/** the entity's auto-assign settings row (mode · default assignee · default max tasks), or undefined when it has none */
async function readAutoAssignSettings(client, entity_id) {
  return (
    await client.query(
      `SELECT auto_assign_mode, default_assignee_actor_id, default_max_tasks
         FROM entity_actor_settings WHERE entity_id = $1`,
      [entity_id]
    )
  ).rows[0];
}
/** this entity's received copy of the chit (its assignee and status), or undefined when there is none to act on */
async function readCopyStatus(client, entity_id, chit_id, copy) {
  return (
    await client.query(
      `SELECT assigned_to_actor_id, current_status FROM chit_status
         WHERE chit_id = $1 AND entity_id = $2 AND direction = $3 AND deleted_at IS NULL`,
      [chit_id, entity_id, copy]
    )
  ).rows[0];
}
/** the actor the entity's mode picks: its default assignee, or the least-loaded active actor with room (all full → the default); null when none */
async function pickAutoAssignTarget(client, entity_id, mode, settings) {
  const defaultMax = (settings && settings.default_max_tasks) || 10;
  const defaultAssignee = (settings && settings.default_assignee_actor_id) || null;
  if (mode === 'default_assignee') return defaultAssignee;
  if (mode !== 'least_loaded') return null;
  const candidates = (
    await client.query(
      `SELECT identity_id, max_tasks, current_task_count FROM identities
           WHERE parent_entity_id = $1 AND identity_type = 'actor' AND break_status = 'active'
             AND hat IN ('act','manager')
           ORDER BY current_task_count ASC, last_assigned_at ASC NULLS FIRST
           LIMIT 10`,
      [entity_id]
    )
  ).rows;
  const room = candidates.find((item) => (item.current_task_count || 0) < (item.max_tasks || defaultMax));
  return room ? room.identity_id : defaultAssignee; // all full → overflow to the default assignee
}


module.exports = { autoAssign, pickAutoAssignTarget, resolveDelegateTarget };
