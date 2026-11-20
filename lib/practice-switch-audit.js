/**
 * lib/practice-switch-audit.js — H-h1 (ISO 27001 A.8.15): who sees which client is an access control, so each practice switch that moved leaves one access_events row, before and after (moved out of routes/actors.js, whose size row may not grow).
 * OWNER     cb-people
 * RISK      access
 * OWNS      SWITCH_DEFAULTS (what a practice that never saved its switches runs on) · record(withEntity, entity_id, { now, was }, by) → one access_events row per moved switch
 * CALLED BY routes/actors.js PUT /settings
 * FLOW      before-row + after-row of entity_actor_settings ──▶ the switches whose value moved ──▶ access_events (practice_switch_changed), in its own transaction
 * CARD      15-people/roles-and-access
 * ⚠️ Never fails the change: a refused audit row (b886 not run) is counted in /health by access-events, it must not abort the settings write.
 */
'use strict';
const accessEvents = require('./access-events');
/** what a practice that never saved its switches runs on (the column defaults), so the first change is recorded from them */
const SWITCH_DEFAULTS = { client_access: 'all', staff_pick_up: 'on', all_task_visible: false, assignment_model: 'both' };
const FIELDS = ['client_access', 'staff_pick_up', 'all_task_visible', 'assignment_model'];
const beforeOf = (was, field) => (was[field] === undefined ? SWITCH_DEFAULTS[field] : was[field]);
/** the switches whose value moved between the before-row and the after-row */
function movedOf(was, after) {
  return FIELDS.filter((field) => { const a = after[field], b = beforeOf(was, field); return a !== undefined && b !== undefined && String(a) !== String(b); });
}
async function record(withEntity, entity_id, { now, was }, changedBy) {
  const after = now.rows[0] || {}, changes = movedOf(was, after);
  if (changes.length) await withEntity(entity_id, async (audit) => { for (const field of changes) await accessEvents.record((sql, args) => audit.query(sql, args), { entity_id, subject_identity_id: entity_id, action: 'practice_switch_changed', before: { [field]: beforeOf(was, field) }, after: { [field]: after[field] }, changed_by: changedBy, reason: 'practice switch ' + field }); });
}
module.exports = { SWITCH_DEFAULTS, record };
