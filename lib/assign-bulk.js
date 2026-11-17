'use strict';
/**
 * CARD 01-rail-core-the-chit/assign
 * assign-bulk.js — POST /api/chits/assign-bulk's work: hand many copies to ONE person (or back to the pool), in one transaction, through the ONE assignment writer.
 *
 * OWNS      bulkAssign(req) → { t, assigned, skipped, cap } · the job-chit gate of a batch (W3) · the subject resolver (plug, role, subject_ids → open job chits)
 * CALLED BY routes/chits.js (POST /assign-bulk)
 * FLOW      the door reads the body → (a) a named plug is gated BEFORE any lookup (lib/owner mayAt at the plug's may_assign) → withEntity(me): settings → (b) a listed batch reads the job markers of its rows ONCE and is
 *           refused WHOLE when one is a job chit and the caller may not → the target (a person who may take work, or null = the pool) → per copy assignChit → taskCount → state_log
 * ASSIGN-1: widened per D1 B4 and DECISIONS-SLICE1 §1. chit_ids XOR { plug, role, subject_ids } · target_actor_id may be null (return the set to the pool) · optional note (to state_log.detail) · every skip carries a code.
 * Ordinary task chits keep today's rule (any signed-in actor); the gate bites on the job marker. A refusal is the WHOLE call, nothing assigned, so the answer never depends on which ids were sent.
 */
const { withEntity } = require('../db');
const railActions = require('./rail-actions');
const { assignChit, taskCount, assignableActor } = require('./assign-chit');
const register = require('./assign-register');
const { mayAt, MANAGER_ONLY_WORDS } = require('./owner');
const auth = require('../middleware/auth');

const MAX = 200;
const refuse = (message, status, code) => Object.assign(new Error(message), { status, code });
const refusedWhole = () => refuse(MANAGER_ONLY_WORDS, 403, 'CHIT_NOT_PERMITTED');
const noteOf = (note) => (typeof note === 'string' && note.trim() ? ' — ' + note.trim().slice(0, 200) : '');

/** step (a): a request that NAMES a plug is gated at the door, before any lookup */
function gateNamedPlug(req, plug) {
  if (!plug) return;
  if (!register.entryOf(plug)) throw refuse('Unknown kind of work.', 400, 'CHIT_BAD_REQUEST');
  if (!mayAt(req, register.levelOf(plug)).ok) throw refusedWhole();
}

/**
 * step (b): ONE read of the job markers of a listed batch, inside the transaction and before the first write; a job chit the caller may not assign refuses the WHOLE call.
 * Answers the plug whose assignable rule the target is held to: the one plug when EVERY listed chit is a job of it, else 'task' (a mixed batch gets the strictest rule).
 */
async function gateListedJobs(client, req, entity_id, chit_ids) {
  const found = await client.query(
    `SELECT DISTINCT chit_id, business_json -> 'job' ->> 'plug' AS plug FROM chit_header WHERE entity_id = $1 AND chit_id = ANY($2::uuid[]) AND business_json ? 'job'`,
    [entity_id, chit_ids]
  );
  const level = found.rows.map((row) => register.levelOf(row.plug)).reduce(register.stricter, 'any');
  if (!mayAt(req, level).ok) throw refusedWhole();
  const plugs = [...new Set(found.rows.map((row) => row.plug))];
  return plugs.length === 1 && found.rows.length === new Set(chit_ids.map(String)).size ? plugs[0] : 'task';
}

/** the open job chits of the named subjects, in ONE statement: [{ subject_id, chit_id }]; a subject with none is a JOB_NOT_OPEN skip */
async function jobChitsOf(client, entity_id, plug, role, subject_ids) {
  const { copy } = register.expansionOf(register.entryOf(plug));
  const found = await client.query(
    `SELECT DISTINCT r ->> 'entity_id' AS subject_id, cs.chit_id
       FROM chit_status cs JOIN chit_header ch ON ch.chit_id = cs.chit_id AND ch.entity_id = cs.entity_id
       CROSS JOIN LATERAL jsonb_array_elements(ch.all_recipients) r
      WHERE cs.entity_id = $1 AND cs.direction = '${copy}' AND cs.deleted_at IS NULL AND cs.current_status NOT IN (${railActions.CLOSED_SQL})
        AND ch.business_json -> 'job' ->> 'plug' = $2 AND ($3::text = '' OR ch.business_json -> 'job' ->> 'role' = $3)
        AND r ->> 'role' IS DISTINCT FROM 'sender' AND r ->> 'entity_id' = ANY($4::text[])`,
    [entity_id, plug, role || '', subject_ids.map(String)]
  );
  return found.rows;
}

/** the target: a person who is on shift and may hold this plug's work (W1: lib/assign-chit's one assignable rule), or null = the pool */
async function targetOf(client, entity_id, target_actor_id, plug) {
  if (!target_actor_id) return null;
  const target = await assignableActor(client, entity_id, plug, target_actor_id, { columns: 'identity_id, display_name, max_tasks, current_task_count' });
  if (!target) throw refuse('Target co-assist not found, not on shift, or not an assignable hat (Act/Manager)', 400);
  return target;
}

/** one copy handed over (or returned): the writer, the counts, the log line */
async function moveOne(client, ctx, chit_id, already) {
  const { entity_id, t, me, by, note } = ctx;
  if (already) await taskCount(client, already, 'release');
  if (t) {
    /* ⭐ W1-RAIL: the one assignment writer: only my received copy moves status (the rail's rule); a sent copy keeps its status */
    await assignChit(client, entity_id, chit_id, t, 'push', { me });
    await taskCount(client, t.identity_id, 'take'); /* TA1 */
  } else {
    await assignChit(client, entity_id, chit_id, null, 'push');
  }
  const detail = t ? `Bulk-assigned to ${t.display_name} by ${by.name}${noteOf(note)}` : `Returned to the pool by ${by.name}${noteOf(note)}`;
  await client.query(
    /* DISTINCT — a self-chit holds two chit_status rows for one entity, so this wrote the same assignment event twice */
    `INSERT INTO state_log (chit_id, entity_id, action, action_by_identity_id, action_by_display_name, detail)
     SELECT $1, entity_id, 'assigned', $2, $3, $4 FROM (SELECT DISTINCT entity_id FROM chit_status WHERE chit_id = $1 AND entity_id = $5) s`,
    [chit_id, by.id, by.name, detail, entity_id]
  );
}

/** the whole batch: the references (chit ids, or subjects of a plug) resolved to copies, then today's loop */
async function runBatch(client, req, entity_id, body) {
  const st = await client.query(`SELECT assignment_model, default_max_tasks FROM entity_actor_settings WHERE entity_id = $1`, [entity_id]);
  const model = (st.rows[0] && st.rows[0].assignment_model) || 'both';
  const defMax = (st.rows[0] && st.rows[0].default_max_tasks) || 10;
  const named = !!body.plug;
  const plug = named ? body.plug : await gateListedJobs(client, req, entity_id, body.chit_ids);
  /* (e) pull mode: push-assign to a person is off. Returning to the pool is not an assignment. */
  if (model === 'pull' && body.target_actor_id) throw refuse('Push-assign is off — this entity is in pull mode (co-assists take tasks themselves).', 400);
  const t = await targetOf(client, entity_id, body.target_actor_id, plug);
  const cap = t ? t.max_tasks || defMax : null;
  let load = t ? t.current_task_count || 0 : 0;
  const refs = named ? await jobChitsOf(client, entity_id, body.plug, body.role, body.subject_ids) : body.chit_ids.map((chit_id) => ({ chit_id }));
  const ctx = { entity_id, t, me: railActions.meOf(req), by: { id: req.identity.identity_id, name: req.identity.display_name }, note: body.note };
  const assigned = [];
  const skipped = [];
  if (named) body.subject_ids.filter((id) => !refs.some((ref) => ref.subject_id === String(id))).forEach((id) => skipped.push({ subject_id: id, reason: 'no job open', code: 'JOB_NOT_OPEN' }));
  for (const ref of refs) {
    const extra = ref.subject_id ? { subject_id: ref.subject_id } : {};
    const cs = await client.query(`SELECT assigned_to_actor_id FROM chit_status WHERE chit_id = $1 AND entity_id = $2 AND deleted_at IS NULL`, [ref.chit_id, entity_id]);
    if (cs.rows.length === 0) {
      skipped.push({ chit_id: ref.chit_id, reason: 'not found', code: 'NOT_FOUND', ...extra });
      continue;
    }
    const already = cs.rows[0].assigned_to_actor_id;
    if ((t && already === t.identity_id) || (!t && !already)) {
      assigned.push(ref.chit_id); // already theirs, or already in the pool — no change, no cost
      continue;
    }
    if (t && load >= cap) {
      skipped.push({ chit_id: ref.chit_id, reason: `at capacity (${cap})`, code: 'ASSIGN_AT_CAPACITY', ...extra });
      continue;
    } // (e) capacity gate
    await moveOne(client, ctx, ref.chit_id, already);
    if (t) load++;
    assigned.push(ref.chit_id);
  }
  return { t, assigned, skipped, cap };
}

/** → { t, assigned, skipped, cap }; throws { status, code } for a refusal (400 · 403 CHIT_NOT_PERMITTED) the route words */
async function bulkAssign(req) {
  const entity_id = auth.entityOf(req);
  const body = req.body;
  const ids = body.plug ? body.subject_ids : body.chit_ids;
  if (ids.length > MAX) throw refuse('Assign at most 200 chits at once.', 400, 'CHIT_TOO_MANY'); // F4: bound the batch (long tx / lock contention)
  gateNamedPlug(req, body.plug); /* (a) before any lookup */
  // Atomic: the whole batch (counts + chit_status + state_log) commits together or rolls back. B1 RLS: writes only the assigning entity's own rows -> withEntity(me).
  return withEntity(entity_id, (client) => runBatch(client, req, entity_id, body));
}

module.exports = { bulkAssign, MAX };
