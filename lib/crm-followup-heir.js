'use strict';
/**
 * CARD 08-crm/followups
 * crm-followup-heir.js — who inherits a leaver's open follow-ups, split out of lib/crm-followups.js so that file stays at 500 lines (rule: split, don't raise).
 *
 * OWNS      heirOf(handle, owner, leaverId, target) -> an identity id, or null (Unassigned)
 * CALLED BY lib/crm-followups.js (re-exported as heirOf) · routes/actors.js PUT /:id/status (through it) · tests/crm-followup-assign.test.cjs
 * FLOW      the colleague chosen for the leaver's tasks (target) ──▶ else the shop's default assignee (entity_actor_settings, on the caller's bound handle) when that person is not the leaver and may hold work (lib/assign-chit assignableActor) ──▶ else null
 */
const { assignableActor } = require('./assign-chit'); /* ASSIGN-1 W1: the ONE "may this person hold work" rule; a follow-up is a task to it */

/** heirOf(h, owner, leaverId, target) -> who inherits a leaver's follow-ups: the colleague chosen for their tasks (target), else the shop's default assignee when that person is not the leaver and may hold work, else null (Unassigned) */
async function heirOf(handle, owner, leaverId, target) {
  if (target && target.identity_id) return target.identity_id;
  const found = await handle.query('SELECT default_assignee_actor_id FROM entity_actor_settings WHERE entity_id = $1', [owner]);
  const fallback = found.rows[0] && found.rows[0].default_assignee_actor_id;
  if (!fallback || String(fallback) === String(leaverId)) return null;
  return (await assignableActor(handle, owner, 'task', fallback, { columns: 'identity_id' })) ? fallback : null;
}

module.exports = { heirOf };
