'use strict';
/**
 * lib/team-member.js — IS THIS PERSON ON THIS SHOP'S TEAM? One reader, lifted from lib/crm-followups.js (ORD-80, C11 batch 10d).
 * OWNS      the team test (the shop itself or one of its actors) and the one sentence a refusal carries (BAD_ASSIGNEE, 400, in the error register)
 * CALLED BY lib/crm-followups.js (a follow-up's assignee) · lib/assign.js (a chit line's assignee)
 * FLOW      ids → keep only what is a uuid (a word never reaches the database cast) → one read of identities → the ids that belong to this shop
 * CARD      02-tasks-orders-and-workflow/assign-and-deliver-lines
 * ⚠️ A stranger's id and an id nobody holds answer the same (no oracle on other shops' people).
 */
const { UUID } = require('./namedentity');

const NOT_ON_TEAM = 'That person is not on your team.';

const lower = (id) => String(id).toLowerCase();

/** the Set (lower-cased) of those ids that are the shop itself or one of its actors; one query, however many ids */
async function readTeam(db, owner, ids) {
  if (!ids.length) return new Set();
  const found = await db.query(`SELECT identity_id FROM identities WHERE identity_id = ANY($1::uuid[]) AND (identity_id = $2 OR parent_entity_id = $2)`, [ids, owner]);
  return new Set(found.rows.map((row) => lower(row.identity_id)));
}

/** teamAmong(db, owner, ids) → the Set of the ids a CALLER typed that are on the team: a word that is no uuid names nobody (the database cast is never reached) */
const teamAmong = (db, owner, ids) => readTeam(db, owner, [...new Set(ids.map(String))].filter((id) => UUID.test(id)));

/** isTeamMember(db, owner, person, { typed }) → true when `person` is on the team. typed (the default) = the caller typed the id, so a non-uuid is refused unread; typed: false = the session's own id */
async function isTeamMember(db, owner, person, { typed = true } = {}) {
  if (typed && !UUID.test(String(person))) return false;
  return (await readTeam(db, owner, [String(person)])).has(lower(person));
}

module.exports = { NOT_ON_TEAM, teamAmong, isTeamMember };
