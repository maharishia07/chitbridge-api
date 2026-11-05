'use strict';
/**
 * lib/shop-actors.js — IS THIS PERSON ONE OF THIS SHOP'S OWN ACTORS? One question, asked before a write stores an actor id.
 *
 * OWNS      actorOwned(): the lookup of an actor under the caller's shop (SEC-103). Postgres checks a foreign key without row security, and entity_work_routing.assignee_actor_id
 *           has none at all, so a write that stored a body id as it came kept another shop's person; the same lookup the SEC-100 folderOwned does for a folder.
 * CALLED BY routes/entities.js (PUT /routing: the assignee)
 * FLOW      a body id → not a uuid: no → one SELECT on identities with an explicit parent_entity_id predicate, inside the writer's own withEntity → true or false
 * CARD      28-platform-and-operations/api-standard
 */
const { UUID } = require('./namedentity'); /* the one uuid shape */

/**
 * actorOwned(db, entity_id, actor_id) → true only when the actor belongs to THIS shop (SEC-103). Another shop's actor, an unknown id and text that is no uuid all answer false,
 * so the caller gives them one answer. The predicate on parent_entity_id is explicit (never row security alone).
 */
async function actorOwned(db, entity_id, actor_id) {
  if (!UUID.test(String(actor_id))) return false;
  const found = await db.query(`SELECT 1 FROM identities WHERE identity_id = $1 AND identity_type = 'actor' AND parent_entity_id = $2`, [actor_id, entity_id]);
  return found.rows.length > 0;
}

module.exports = { actorOwned };
