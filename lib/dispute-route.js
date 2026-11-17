'use strict';
/**
 * lib/dispute-route.js — WHO OWNS A DISPUTE ON A CHIT NOBODY HOLDS? The shop's routing row, kind 'dispute', assignee only.
 *
 * OWNS      the writes of that one row (set, clear, clear-for-a-leaver) and the rule for who may be on it. Nothing here holds a chit: assignChit (lib/assign-chit) stays the ONE writer
 *           of chit_status.assigned_to_actor_id, and a dispute never writes a status (moveStatus). The row is only the fallback owner for the bell when the disputed chit is in the pool.
 * CALLED BY routes/entities.js (PATCH /profile, PUT /routing), routes/actors.js (a person leaves). READ BY routes/notifications.js through lib/workroute routeFor.
 * FLOW      person → assignableActor (this shop, may hold task work: act_or_manager) → upsert/delete entity_work_routing (entity_id, 'dispute') → mirror identities.dispute_handler_actor_id
 * D3        2026-11-18 (docs PM/critic/D3-DISPUTES-ASSIGN-CRITIC-2026-11-18.md). DUAL WRITE for one release: the column identities.dispute_handler_actor_id is still written so the bell's fallback
 *           and an un-migrated database agree. Dropping the column is an Athi HOLD (after a release with zero reads of it); this file's mirror goes with it.
 *           NOT DELIVERED: round robin on disputes (it would count a task twice; the existing auto door places the received copy).
 */
const { assignableActor } = require('./assign-chit');

const KIND = 'dispute';

/** the tenant tables are FORCE RLS: every statement here runs on a handle that is already bound to the shop (withEntity) */

/** mayBeHandler(db, shop, actorId) → true when this person is the shop's own and may hold task work (a read-only seat, a stranger, another shop's person: no). Not shift-bound: a handler may be on break. */
async function mayBeHandler(db, shop, actorId) {
  return !!(await assignableActor(db, shop, 'task', actorId, { columns: 'identity_id', onShift: false }));
}

/**
 * setDisputeRoute(db, shop, actorId) → null when written, 'badHandler' when the person may not be the handler (nothing written). A null actorId clears the route and the column.
 * ⚠️ a table that is not there yet (b250) is the caller's 42P01 to answer; the column is written either way once the route is.
 */
async function setDisputeRoute(db, shop, actorId) {
  if (actorId) {
    if (!(await mayBeHandler(db, shop, actorId))) return 'badHandler';
    await db.query(
      `INSERT INTO entity_work_routing (entity_id, kind, assignee_actor_id, updated_at) VALUES ($1,$2,$3, now())
       ON CONFLICT (entity_id, kind) DO UPDATE SET assignee_actor_id = EXCLUDED.assignee_actor_id, folder_id = NULL, route_to_entity_id = NULL, notify_email = NULL, updated_at = now()`,
      [shop, KIND, actorId]
    );
  } else {
    await db.query(`DELETE FROM entity_work_routing WHERE entity_id = $1 AND kind = $2`, [shop, KIND]);
  }
  await db.query(`UPDATE identities SET dispute_handler_actor_id = $2 WHERE identity_id = $1`, [shop, actorId || null]);
  return null;
}

/** clearDisputeRouteFor(db, shop, actorId) → how many rows were cleared (route + column) because this person has left. Inside the removal's own transaction. */
async function clearDisputeRouteFor(db, shop, actorId) {
  const route = await db.query(`DELETE FROM entity_work_routing WHERE entity_id = $1 AND kind = $2 AND assignee_actor_id = $3`, [shop, KIND, actorId]);
  const column = await db.query(`UPDATE identities SET dispute_handler_actor_id = NULL WHERE identity_id = $1 AND dispute_handler_actor_id = $2`, [shop, actorId]);
  return (route.rowCount || 0) + (column.rowCount || 0) > 0 ? 1 : 0;
}

module.exports = { KIND, mayBeHandler, setDisputeRoute, clearDisputeRouteFor };
