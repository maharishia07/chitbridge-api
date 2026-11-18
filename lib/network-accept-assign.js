'use strict';
/**
 * lib/network-accept-assign.js — "assign at accept" (L10, 18 Nov): the firm that accepts a client's connection may name who looks after that client, in the same call.
 * OWNS      assignAtAccept (the optional `assign_to` of PUT /api/connections/:id/respond, action accept) · SKIP (the two skip codes this door adds)
 * CALLED BY routes/connections.js (respond, after the accept is written)
 * FLOW      assignable person (lib/assign-chit assignableActor: the ONE who-may-hold rule, A5: a view-only seat holds nothing) → the role of the live books grant the client gave this firm → lib/assign-bulk bulkAssign (the ONE writer: opens the standing job, assigns, one transaction)
 *           → { assigned_to, assigned, skipped } ; a refusal anywhere is a NAMED SKIP, never an error: the accept has already happened and stays.
 * CARD      04-network/connections-and-invitations
 */
const { withEntity } = require('../db');
const { assignableActor } = require('./assign-chit');
const bulk = require('./assign-bulk');

const SKIP = Object.freeze({
  HOLDER_REFUSED: 'ASSIGN_HOLDER_REFUSED',
  NO_BOOKS_ACCESS: 'ASSIGN_NO_BOOKS_ACCESS'
});
const WORDS = Object.freeze({
  [SKIP.HOLDER_REFUSED]: 'That person cannot look after a client (not on shift, not on your team, or a view-only seat). The connection is accepted; the client is in the pool.',
  [SKIP.NO_BOOKS_ACCESS]: 'This client has not given you access to its books yet, so there is no job to hand over. The connection is accepted; assign the client once access is given.'
});
const skipOf = (code, subject_id) => ({ subject_id, code, reason: WORDS[code] });

/** the role (auditor | adviser) of the newest live books grant the client gave this firm, or null */
async function grantRoleOf(firm, client) {
  const found = await withEntity(firm, (bound) =>
    bound.query('SELECT preset FROM books_access_grant WHERE grantor_entity = $1 AND grantee_entity = $2 AND ' + require('./books-grant').liveGrantSql() + ' ORDER BY granted_at DESC LIMIT 1', [client, firm])
  );
  return (found.rows[0] && found.rows[0].preset) || null;
}

/** the one verdict of whether this person may hold the client: the assignable rule, asked under the firm's binding */
const mayHoldClient = (firm, person) => withEntity(firm, (bound) => assignableActor(bound, firm, 'client', person));

/**
 * assignAtAccept(req, { firm, client, assign_to }, deps?) → null (nothing asked) | { assigned_to, assigned, skipped }
 * The accept is already written: whatever is refused here is named in `skipped` and the answer still says accepted.
 */
async function assignAtAccept(req, { firm, client, assign_to }, deps) {
  if (!assign_to) return null;
  const doors = Object.assign({ mayHoldClient, grantRoleOf, bulkAssign: bulk.bulkAssign }, deps);
  const person = await doors.mayHoldClient(firm, assign_to);
  if (!person) return { assigned_to: null, assigned: 0, skipped: [skipOf(SKIP.HOLDER_REFUSED, client)] };
  const role = await doors.grantRoleOf(firm, client);
  if (!role) return { assigned_to: null, assigned: 0, skipped: [skipOf(SKIP.NO_BOOKS_ACCESS, client)] };
  const asked = Object.assign(Object.create(req), { body: { plug: 'client', role, subject_ids: [client], target_actor_id: assign_to } });
  try {
    const done = await doors.bulkAssign(asked);
    return { assigned_to: person.display_name || null, assigned: done.assigned.length, skipped: done.skipped };
  } catch (refused) { /* the writer's own refusal (403 not a partner or manager, 400 the target): said as a skip, the accept stands */
    if (!refused || !refused.status || refused.status >= 500) throw refused;
    return { assigned_to: null, assigned: 0, skipped: [{ subject_id: client, code: refused.code || 'ASSIGN_REFUSED', reason: refused.message }] };
  }
}

module.exports = { assignAtAccept, SKIP, WORDS };
