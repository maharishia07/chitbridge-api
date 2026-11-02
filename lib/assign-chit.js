// @stage tested
// @stage-note The ONE write of who holds a chit copy (assigned_to_actor_id …) and of a person's task count. Every door that assigns, returns or re-routes work calls it.
'use strict';
/**
 * CARD 01-rail-core-the-chit/assign
 * assign-chit.js — ⭐⭐ THE ONE WRITER OF A CHIT'S ASSIGNMENT AND OF A PERSON'S TASK COUNT (TA1 14 Oct · W1-RAIL 15 Oct).
 *
 * owns       chit_status.assigned_to_actor_id · assigned_to_actor_display_name · assigned_at · assignment_type
 *            identities.current_task_count · last_assigned_at
 * called by  routes/actors.js (pull · push · return · admin route · deactivate · leave) · routes/chits.js (auto-assign · assign-bulk)
 *            routes/connectors.js (a signal's default assignee) · lib/raiseticket.js (a ticket's routed assignee)
 * FLOW       door reads its copy → assignChit() [UPDATE → rail-status.statusGate → pending] → taskCount() → the door's own state_log row
 * flow step  O2C step 4 · delivery — the seller's staff take or are handed the task (web docs/process/flows.json: PUT /api/actors/assign/:chit_id)
 *
 * WHY. identities.current_task_count is what auto-assign ranks people by and what the break/leave gate refuses on. Taking, pushing,
 * returning, reassigning, routing on leave and the bulk assign each wrote it with their own UPDATE — 13 statements in two files, two
 * spellings of "minus one" and one "plus one" that forgot last_assigned_at was the tie-break (TA1). The ASSIGNMENT itself had the
 * same disease: nine `UPDATE chit_status SET assigned_to_actor_id …` across four files, one of which never wrote the display name
 * (so the screen showed the previous person) and two of which left the name behind on a return. The "back to pending" step after
 * an assignment was copied three times. They all come here now; tests/one-writer.test.cjs fails on a second writer of either.
 *
 * taskCount(run, identity_id, change) — on the caller's transaction:
 *   'take'     +1 and last_assigned_at = now (the round-robin tie-break)
 *   'release'  −1, never below zero
 *   'clear'    0 (a person whose work was routed elsewhere)
 *   { add: n } +n (work routed TO this person in one go; last_assigned_at is not moved, as before)
 *
 * assignChit(run, entity_id, chit_id, assignee, kind, opts) — who holds MY copy of one chit:
 *   assignee   { identity_id, display_name } → that person · null → back to the pool
 *   kind       'pull' · 'push' · 'auto' (the pool has no kind)
 *   opts.copy  'received' → only my received copy (the auto doors); default: every copy I hold of this chit (a self-chit has two)
 *   opts.me    who is moving it (railActions.meOf(req) or rail-status.SYSTEM). When given, the received copy goes back to pending
 *              through the ONE status write (lib/rail-status statusGate) — never a bare SET; a refusal leaves the assignment standing
 *              and is logged; a sent-only copy keeps its status (not_received is the expected answer, not a fault).
 *   opts.from  the copy's status when the door already read it in this transaction (saves the read)
 *   → { rows, moved, from }
 *
 * rerouteOpenTasks(run, entity_id, from_actor_id, assignee) — everything one person still holds → a colleague ('push') or the pool.
 *   Closed copies (completed · cancelled · rejected) are never re-routed. → how many copies moved.
 *
 * run — a query function (sql, params) or a connection with .query. A missing id is a no-op.
 */
const railStatus = require('./rail-status');
const log = require('./logger');

/* a copy in one of these is finished work: it stays with whoever did it when their open work is re-routed */
/* W2-RAIL R2: the ONE table (lib/rail-actions) — rail-status already loads rail-actions, so nothing new is required here */
const { CLOSED_STATES: CLOSED_STATUSES, CLOSED_SQL } = require('./rail-actions');
/* how a copy came to be held: a person took it, someone gave it, or the shop's own rule placed it */
const ASSIGNMENT_KINDS = ['pull', 'push', 'auto'];
/* the SET halves — one spelling each, so a scanner finds exactly one writer */
const SET_HOLDER = `SET assigned_to_actor_id = $1, assigned_to_actor_display_name = $2, assigned_at = NOW(), assignment_type = $3, updated_at = NOW()`;
const SET_POOL = `SET assigned_to_actor_id = NULL, assigned_to_actor_display_name = NULL, assigned_at = NULL, assignment_type = NULL, updated_at = NOW()`;

/* the two shapes a caller hands in: a bare query function, or a client with .query */
const queryOf = (run) => (typeof run === 'function' ? run : (sql, params) => run.query(sql, params));
const clientOf = (run) => (typeof run === 'function' ? { query: run } : run);
const rowsOf = (written) => (written && written.rowCount) || 0;

async function taskCount(run, identity_id, change) {
  if (!identity_id) return null;
  const q = queryOf(run);
  if (change === 'take')
    return q(`UPDATE identities SET current_task_count = current_task_count + 1, last_assigned_at = NOW() WHERE identity_id = $1`, [identity_id]);
  if (change === 'release') return q(`UPDATE identities SET current_task_count = GREATEST(0, current_task_count - 1) WHERE identity_id = $1`, [identity_id]);
  if (change === 'clear') return q(`UPDATE identities SET current_task_count = 0 WHERE identity_id = $1`, [identity_id]);
  if (change && Number.isInteger(change.add))
    return q(`UPDATE identities SET current_task_count = current_task_count + $1 WHERE identity_id = $2`, [change.add, identity_id]);
  throw new Error('taskCount: unknown change ' + JSON.stringify(change));
}

/** the direction clause for opts.copy — a literal, so the SQL stays plain to RLS and to the one-writer scanner */
function copyClause(copy) {
  if (copy === undefined || copy === null) return '';
  if (!railStatus.COPIES.includes(copy)) throw new Error('assignChit: copy must be received or sent, not "' + copy + '"');
  return ` AND direction = '${copy}'`;
}

/**
 * RAIL-106: the copy's new status (pending) is a status move like any other, so a party on another installation is told by the same event moveStatus sends. Fire-and-forget after the caller's
 * transaction (this runs inside it): a failure is logged by lib/ctpreturn and never fails the assignment.
 */
function tellOtherInstallations(entity_id, chit_id, gate) {
  setImmediate(() => {
    try {
      Promise.resolve(require('./ctpreturn').onStatusMoved(entity_id, chit_id, { status: 'pending', previous_status: gate.from, copy: gate.copy })).catch((e) => log.warn('assign: the other installations were not told', { chit_id, error: String((e && e.message) || e) }));
    } catch (e) {
      log.warn('assign: could not tell the other installations', { chit_id, error: String((e && e.message) || e) });
    }
  });
}

/** after an assignment the received copy goes back to pending through the ONE status write; a refusal is logged, never silent */
async function backToPending(run, entity_id, chit_id, me, kind, from) {
  const gate = await railStatus.statusGate(clientOf(run), entity_id, chit_id, 'pending', me, from === undefined ? undefined : { from });
  if (gate.ok) {
    const moved = await gate.write();
    if (moved) tellOtherInstallations(entity_id, chit_id, gate);
    return { moved, from: gate.from };
  }
  if (gate.why !== 'not_received') log.warn('assign ' + kind + ': status not moved to pending', { chit_id, from: gate.from, why: gate.why });
  return { moved: false, from: gate.from };
}

/** the one UPDATE that hands my copy of a chit to a person — the kind must be one of the three */
function writeHolder(q, entity_id, chit_id, assignee, kind, copy) {
  if (!ASSIGNMENT_KINDS.includes(kind)) throw new Error('assignChit: kind must be pull, push or auto, not ' + JSON.stringify(kind));
  return q(`UPDATE chit_status ${SET_HOLDER} WHERE chit_id = $4 AND entity_id = $5${copyClause(copy)}`, [
    assignee.identity_id,
    assignee.display_name || null,
    kind,
    chit_id,
    entity_id
  ]);
}

/** the one UPDATE that puts my copy of a chit back in the pool */
function writePool(q, entity_id, chit_id, copy) {
  return q(`UPDATE chit_status ${SET_POOL} WHERE chit_id = $1 AND entity_id = $2${copyClause(copy)}`, [chit_id, entity_id]);
}

/** who holds my copy of one chit — a person (then back to pending when a mover is given) or the pool; see the header */
async function assignChit(run, entity_id, chit_id, assignee, kind, opts) {
  const notMoved = { rows: 0, moved: false, from: null };
  if (!chit_id || !entity_id) return notMoved;
  const o = opts || {};
  const toPerson = !!(assignee && assignee.identity_id);
  const written = toPerson
    ? await writeHolder(queryOf(run), entity_id, chit_id, assignee, kind, o.copy)
    : await writePool(queryOf(run), entity_id, chit_id, o.copy);
  const outcome = Object.assign({}, notMoved, { rows: rowsOf(written) });
  if (!toPerson || !o.me) return outcome;
  return Object.assign(outcome, await backToPending(run, entity_id, chit_id, o.me, kind, o.from));
}

/** everything one person still holds → a colleague (push) or the pool; closed copies stay put. → how many copies moved */
async function rerouteOpenTasks(run, entity_id, from_actor_id, assignee) {
  if (!from_actor_id || !entity_id) return 0;
  const q = queryOf(run);
  const toPerson = !!(assignee && assignee.identity_id);
  const written = toPerson
    ? await q(`UPDATE chit_status ${SET_HOLDER} WHERE assigned_to_actor_id = $4 AND entity_id = $5 AND current_status NOT IN (${CLOSED_SQL})`, [
        assignee.identity_id,
        assignee.display_name || null,
        'push',
        from_actor_id,
        entity_id
      ])
    : await q(`UPDATE chit_status ${SET_POOL} WHERE assigned_to_actor_id = $1 AND entity_id = $2 AND current_status NOT IN (${CLOSED_SQL})`, [
        from_actor_id,
        entity_id
      ]);
  return rowsOf(written);
}

module.exports = { taskCount, assignChit, rerouteOpenTasks, CLOSED_STATUSES, ASSIGNMENT_KINDS };
