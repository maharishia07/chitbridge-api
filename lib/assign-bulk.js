'use strict';
/**
 * CARD 01-rail-core-the-chit/assign
 * assign-bulk.js — POST /api/chits/assign-bulk's work: hand many copies to ONE person (or back to the pool), in one transaction, through the ONE assignment writer.
 *
 * OWNS      bulkAssign(req) → { t, assigned, skipped (once per client, named), cap, subjects (clients handled, named batch), previous (holders before: for Undo) } · the job-chit gate of a batch (W3) · the subject resolver (plug, role, subject_ids → open job chits)
 * CALLED BY routes/chits.js (POST /assign-bulk)
 * FLOW      the door reads the body → (a) a named plug is gated BEFORE any lookup (lib/owner mayAt at the plug's may_assign) → withEntity(me): settings → (b) a listed batch reads the job markers of its rows ONCE and is
 *           refused WHOLE when one is a job chit and the caller may not → the target (a person who may take work, or null = the pool) → per copy assignChit → taskCount → state_log
 * ASSIGN-1: widened per D1 B4 and DECISIONS-SLICE1 §1. chit_ids XOR { plug, role, subject_ids } · target_actor_id may be null (return the set to the pool) · optional note (to state_log.detail) · every skip carries a code.
 * Ordinary task chits keep today's rule (any signed-in actor); the gate bites on the job marker. A refusal is the WHOLE call, nothing assigned, so the answer never depends on which ids were sent.
 */
const { withEntity } = require('../db');
const railActions = require('./rail-actions');
const { assignChit, taskCount, assignableActor, viewOnlyName } = require('./assign-chit');
const register = require('./assign-register');
const { mayAt, MANAGER_ONLY_WORDS } = require('./owner');
const auth = require('../middleware/auth');

const MAX = 200;
const { UUID } = require('./namedentity'); /* the one uuid shape: a malformed id is never sent to the opener (its ::uuid[] reads would 500); it stays a named skip */
const refuse = (message, status, code) => Object.assign(new Error(message), { status, code });
const refusedWhole = () => refuse(MANAGER_ONLY_WORDS, 403, 'CHIT_NOT_PERMITTED');
const noteOf = (note) => (typeof note === 'string' && note.trim() ? ' — ' + note.trim().slice(0, 200) : '');

/** step (a): a request that NAMES a plug is gated at the door, before any lookup */
function gateNamedPlug(req, plug, body) {
  if (!plug) return false;
  if (!register.entryOf(plug)) throw refuse('Unknown kind of work.', 400, 'CHIT_BAD_REQUEST');
  if (mayAt(req, register.levelOf(plug)).ok) return false;
  if (staffMayTry(req, body)) return true; /* W17: a seat of the firm may assign work nobody holds (the rows are checked inside, before any write) */
  throw refusedWhole();
}

/** W17 (Athi 19 Nov): the ONE door stays; a seat of the firm (an actor, never a key or a grant) that names a person to take work, or names null (RELEASE: back to the pool, STAFFPICK 21 Nov), may TRY: the batch then must be all unassigned (or the caller's own), see staffGate */
function staffMayTry(req, body) {
  return !!(body && body.target_actor_id !== undefined && isFirmSeat(req) && !mayAt(req, 'manager').ok); /* H-mx-002: a manager may move held work, so is no staff here */
}
/** a seat of a firm: a signed-in actor under a parent entity, never an API key and never an adviser acting under a grant */
function isFirmSeat(req) {
  const id = req.identity;
  return !req.api_key && !!id && id.identity_type === 'actor' && !!id.parent_entity_id && !id.acting_for_grant;
}

/**
 * W17 + STAFFPICK: what a seat of the firm may do with clients, checked WHOLE before any write. `ids` = the chit copies (listed), or null = read them from the named subjects.
 *   a copy held by SOMEONE ELSE refuses the whole call (pick up, release and hand over alike): only the partner or a manager moves another person's client (ASSIGN_HELD_BY_OTHER)
 *   a copy nobody holds may be taken or handed to a colleague only while the firm's pick-up switch is ON (ASSIGN_PICKUP_OFF); releasing or handing over a client the seat holds itself never asks the switch
 */
async function staffGateIn(client, req, entity_id, body, ids) {
  const copies = ids || (await jobChitsOf(client, entity_id, body.plug, body.role, body.subject_ids)).map((ref) => String(ref.chit_id));
  const states = copies.length ? await client.query('SELECT assigned_to_actor_id FROM chit_status WHERE entity_id = $1 AND chit_id = ANY($2::uuid[]) AND deleted_at IS NULL', [entity_id, copies]) : { rows: [] };
  const me = String(req.identity.identity_id);
  if (states.rows.some((row) => row.assigned_to_actor_id && String(row.assigned_to_actor_id) !== me)) throw refuse('Someone else already holds one of these. Only the partner or a manager can move it.', 403, 'ASSIGN_HELD_BY_OTHER');
  const nobodyHolds = !copies.length || states.rows.some((row) => !row.assigned_to_actor_id);
  if (body.target_actor_id && nobodyHolds && !(await register.pickUpOn(client, entity_id))) throw refuse('Your practice has turned off picking up clients. Ask the partner or a manager to assign.', 403, 'ASSIGN_PICKUP_OFF');
}

/** the one plug whose rule the target is held to: the plug when EVERY listed chit is a job of it, else 'task' */
function plugOfBatch(rows, chit_ids) {
  const plugs = [...new Set(rows.map((row) => row.plug))];
  return plugs.length === 1 && rows.length === new Set(chit_ids.map(String)).size ? plugs[0] : 'task';
}

/**
 * step (b): ONE read of the job markers of a listed batch, inside the transaction and before the first write; a job chit the caller may not assign refuses the WHOLE call.
 * Answers { plug, plugOf }: the plug whose assignable rule the target is held to (the one plug when EVERY listed chit is a job of it, else 'task': a mixed batch gets the strictest rule) and each job chit's own plug (the task cap and count skip those).
 */
async function gateListedJobs(client, req, entity_id, chit_ids, staff) {
  const found = await client.query(
    `SELECT DISTINCT chit_id, business_json -> 'job' ->> 'plug' AS plug FROM chit_header WHERE entity_id = $1 AND chit_id = ANY($2::uuid[]) AND business_json ? 'job'`,
    [entity_id, chit_ids]
  );
  let level = 'any';
  for (const row of found.rows) level = register.stricter(level, register.levelOf(row.plug)); /* the strictest level of the listed rows (a loop: not a money reduce) */
  if (!mayAt(req, level).ok && !(staff && staffMayTry(req, { target_actor_id: true }))) throw refusedWhole();
  const plug = plugOfBatch(found.rows, chit_ids);
  return { plug, plugOf: new Map(found.rows.map((row) => [String(row.chit_id), row.plug])) }; /* plugOf: which listed chit is a job (d): a job is neither capped nor counted */
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

/** RC-4: a person who is on the team but may not hold this work is named as view-only (the registered ASSIGNEE_VIEW_ONLY, as lib/crm-followups); anyone else falls to the general words */
async function refuseViewOnly(client, entity_id, plug, target_actor_id) {
  const name = await viewOnlyName(client, entity_id, plug, target_actor_id);
  if (name) throw refuse(`${name} has view-only access, so they cannot take this work.`, 400, 'ASSIGNEE_VIEW_ONLY');
}

/** the target: a person who is on shift and may hold this plug's work (W1: lib/assign-chit's one assignable rule), or null = the pool */
async function targetOf(client, entity_id, target_actor_id, plug) {
  if (!target_actor_id) return null;
  const target = await assignableActor(client, entity_id, plug, target_actor_id, { columns: 'identity_id, display_name, max_tasks, current_task_count' });
  /* The sentence was a frozen released body (docs/contracts/api-legacy.json, key `message`) that said "Act/Manager"; the rule is level-based (W1, lib/assign-chit assignableActor). Reworded in place on 18 Nov (DECISIONS-SLICE1 (f)): status 400 and the body keys are the contract, the prose is not; no web caller matched the old text (grepped wt-integ-1117b-web, next/assign1-web, assign1-people-web). */
  if (!target) await refuseViewOnly(client, entity_id, plug, target_actor_id);
  if (!target) throw refuse('Target co-assist not found, not on shift, or not allowed to hold this work (a task needs someone who can edit)', 400);
  return target;
}

/** the log line of one move: picked up (the person took it), bulk-assigned (handed to another) or returned to the pool */
function logWords(target, by, note) {
  if (!target) return `Returned to the pool by ${by.name}${noteOf(note)}`;
  if (target.identity_id === by.id) return `Picked up by ${by.name}${noteOf(note)}`;
  return `Bulk-assigned to ${target.display_name} by ${by.name}${noteOf(note)}`;
}

/** one copy handed over (or returned): the writer, the counts, the log line */
async function moveOne(client, ctx, chit_id, already, plug) {
  const { entity_id, target, me: railMover, by, note } = ctx;
  if (already) await taskCount(client, already, 'release', plug);
  if (target) {
    /* ⭐ W1-RAIL: the one assignment writer: only my received copy moves status (the rail's rule); a sent copy keeps its status */
    await assignChit(client, entity_id, chit_id, target, target.identity_id === by.id ? 'pull' : 'push', { me: railMover }); /* W17: taking it yourself is a pull (assignment_type, and assigned_at says when) */
    await taskCount(client, target.identity_id, 'take', plug); /* TA1 · (d) a job is not counted */
  } else {
    await assignChit(client, entity_id, chit_id, null, 'push');
  }
  const detail = logWords(target, by, note);
  await client.query(
    /* DISTINCT — a self-chit holds two chit_status rows for one entity, so this wrote the same assignment event twice */
    `INSERT INTO state_log (chit_id, entity_id, action, action_by_identity_id, action_by_display_name, detail)
     SELECT $1, entity_id, 'assigned', $2, $3, $4 FROM (SELECT DISTINCT entity_id FROM chit_status WHERE chit_id = $1 AND entity_id = $5) s`,
    [chit_id, by.id, by.name, detail, entity_id]
  );
}

/** the clients the batch handled, counted ONCE each (a client with two periods holds two job copies: the answer counts the client) */
const subjectsOf = (refs, assigned) => new Set(refs.filter((ref) => assigned.includes(ref.chit_id)).map((ref) => ref.subject_id)).size;

/** one skip with its client's name, and a lost race with the holder's name in its sentence (held_by is read here and never leaves) */
function namedSkip(skip, nameOf) {
  const { held_by: holder, ...shown } = skip;
  const holderName = holder && nameOf.get(String(holder));
  const sentence = holderName ? { reason: `already held by ${holderName}` } : null;
  const clientName = shown.subject_id && nameOf.get(String(shown.subject_id));
  return { ...shown, ...sentence, ...(clientName ? { name: clientName } : null) };
}

/** each skip once per client and reason, with the client's name (ONE read), so the screen says who and why */
async function namedSkips(client, skipped) {
  const seen = new Set();
  const once = skipped.filter((skip) => {
    const key = String(skip.subject_id || skip.chit_id) + ':' + skip.code;
    return !seen.has(key) && seen.add(key);
  });
  const ids = [...new Set(once.flatMap((skip) => [skip.subject_id, skip.held_by]).filter(Boolean).map(String))]; /* the clients named, and the holders a lost race names: ONE read for both */
  if (!ids.length) return once;
  const names = await client.query('SELECT identity_id::text AS id, display_name FROM identities WHERE identity_id = ANY($1::uuid[])', [ids]);
  const nameOf = new Map(names.rows.map((row) => [row.id, row.display_name]));
  return once.map((skip) => namedSkip(skip, nameOf));
}

/** the entity's assignment model and its default task cap (the settings row, or 'both' and 10 when there is none) */
async function assignSettingsOf(client, entity_id) {
  const settings = await client.query(`SELECT assignment_model, default_max_tasks FROM entity_actor_settings WHERE entity_id = $1`, [entity_id]);
  const row = settings.rows[0];
  return { model: (row && row.assignment_model) || 'both', defMax: (row && row.default_max_tasks) || 10 };
}

/** the subjects asked for by name that have no open job: each is a skip, by the opener's own reason when it could not open one (preSkips), else JOB_NOT_OPEN (a named batch only) */
function subjectsWithNoJob(subject_ids, refs, preSkips) {
  return subject_ids
    .filter((id) => !refs.some((ref) => ref.subject_id === String(id)))
    .map((id) => preSkips.get(String(id).toLowerCase()) || { subject_id: id, reason: 'no job is open for this client', code: 'JOB_NOT_OPEN' });
}

/** the copy is already where the batch wants it: held by the target, or (no target) already in the pool */
function alreadyThere(target, holderId) {
  return target ? holderId === target.identity_id : !holderId;
}

/** R9 (race 20 Nov): a seat of the firm (staffId set) may only take work nobody holds, or its own: a copy now held by someone else is not its to move */
function heldByOther(staffId, holderId) {
  return !!staffId && !!holderId && String(holderId) !== String(staffId);
}

/** the per-row refusal of the loser of a race (the registered ASSIGN_HELD_BY_OTHER code); held_by is turned into the holder's name by namedSkips, in its one read of names */
function heldSkip(ref, holderId, extra) {
  return { chit_id: ref.chit_id, reason: 'someone else already holds it', code: 'ASSIGN_HELD_BY_OTHER', ...extra, held_by: holderId };
}

/** one reference of the batch → { skip } (not found · at capacity), or { assignedId } (already in place), or { assignedId, was } (moved now; was = the holder before, null = the pool); `batchState.load` counts the tasks handed over so far; `copyRows` is the read of this copy (its holder), made by the loop */
async function assignRef(client, batchState, ref, copyRows) {
  const { target, ctx, plugOfCopy, cap: taskCap } = batchState;
  const extra = ref.subject_id ? { subject_id: ref.subject_id } : {};
  if (copyRows.length === 0) return { skip: { chit_id: ref.chit_id, reason: 'not found', code: 'NOT_FOUND', ...extra } };
  const already = copyRows[0].assigned_to_actor_id;
  if (alreadyThere(target, already)) return { assignedId: ref.chit_id }; // already theirs, or already in the pool — no change, no cost
  if (heldByOther(batchState.staffId, already)) return { skip: heldSkip(ref, already, extra) }; /* R9: a seat takes nothing from a holder who got there first (the gate saw it free; the locked re-read says otherwise) */
  const copyPlug = plugOfCopy(ref.chit_id);
  const counted = !!target && copyPlug === 'task';
  if (counted && batchState.load >= taskCap) return { skip: { chit_id: ref.chit_id, reason: `at capacity (${taskCap})`, code: 'ASSIGN_AT_CAPACITY', ...extra } }; // (e) capacity gate: for tasks only (d)
  await moveOne(client, ctx, ref.chit_id, already, copyPlug);
  if (counted) batchState.load++;
  return { assignedId: ref.chit_id, was: already || null };
}

/** (d) the plug of ONE copy: a named batch is all jobs of its plug; a listed one knows its job chits from the gate's single read; anything else is a task (capped, counted) */
function plugOfCopyFn(body, listed) {
  return (chit_id) => (body.plug ? body.plug : listed.plugOf.get(String(chit_id)) || 'task');
}

/** the copies the batch works on: the open job chits of the named subjects, or the listed chit ids */
function refsOf(client, entity_id, body) {
  if (!body.plug) return body.chit_ids.map((chit_id) => ({ chit_id }));
  return jobChitsOf(client, entity_id, body.plug, body.role, body.subject_ids);
}

/** (e) pull mode: push-assign to a person is off. Returning to the pool is not an assignment. */
function refusePushInPullMode(model, body) {
  if (model === 'pull' && body.target_actor_id) throw refuse('Push-assign is off — this entity is in pull mode (co-assists take tasks themselves).', 400);
}

/** R9: the holder is read FOR UPDATE, so a second batch on the same copy waits for the first to commit and then reads the NEW holder (no last-write-wins). Every reference through assignRef: → { assigned (chit ids), previous (who held each MOVED copy before this call, null = the pool: what an Undo puts back) }; the skips are pushed onto `skipped` */
async function assignEach(client, batchState, refs, skipped) {
  const assigned = [];
  const previous = [];
  for (const ref of refs) {
    const copy = await client.query(`SELECT assigned_to_actor_id FROM chit_status WHERE chit_id = $1 AND entity_id = $2 AND deleted_at IS NULL FOR UPDATE`, [ref.chit_id, batchState.entity_id]);
    const outcome = await assignRef(client, batchState, ref, copy.rows);
    if (outcome.skip) skipped.push(outcome.skip);
    else assigned.push(outcome.assignedId);
    if (outcome.was !== undefined) previous.push({ chit_id: ref.chit_id, subject_id: ref.subject_id, actor_id: outcome.was });
  }
  return { assigned, previous };
}

/**
 * R3d / RC-13 (DECISIONS 19 Nov): when the practice lets everyone see every client (client_access = all, the default), taking someone off a client is a RE-ASSIGNMENT, not a removal: the person still reads the client's books. The answer says so in words.
 * Asked only for a client batch that moved something; null otherwise (and for a practice that shows only the clients a person holds).
 */
async function accessNoteOf(client, entity_id, plug, previous, target) {
  if (plug !== 'client' || !previous.length) return null;
  const switchRow = (await client.query(`SELECT ${register.clientAccessSql('$1')} AS everyone`, [entity_id])).rows[0];
  if (!switchRow || switchRow.everyone !== true) return null;
  return (target ? 'The work moved to ' + target.display_name + '.' : 'The work went back to the pool.') + ' Everyone in the practice can still open every client, so no one lost access to the books: this is a re-assignment, not a removal.';
}

/** W17: a listed JOB chit taken by a seat of the firm meets the same rule as a named plug */
async function staffGateListed(client, req, entity_id, body, staff, listed) {
  if (staff && listed && listed.plugOf.size) await staffGateIn(client, req, entity_id, body, [...listed.plugOf.keys()]);
}

/** the whole batch: the references (chit ids, or subjects of a plug) resolved to copies, then today's loop */
async function runBatch(client, req, entity_id, body, preSkips, staff) {
  const { model, defMax } = await assignSettingsOf(client, entity_id);
  const listed = body.plug ? null : await gateListedJobs(client, req, entity_id, body.chit_ids, staff);
  await staffGateListed(client, req, entity_id, body, staff, listed);
  refusePushInPullMode(model, body);
  const plug = body.plug || listed.plug;
  const target = await targetOf(client, entity_id, body.target_actor_id, plug);
  const taskCap = target ? target.max_tasks || defMax : null;
  const refs = await refsOf(client, entity_id, body);
  const ctx = { entity_id, target, me: railActions.meOf(req), by: { id: req.identity.identity_id, name: req.identity.display_name }, note: body.note };
  const batchState = { entity_id, staffId: staff ? req.identity.identity_id : null, target, ctx, plugOfCopy: plugOfCopyFn(body, listed), cap: taskCap, load: target ? target.current_task_count || 0 : 0 };
  const skipped = body.plug ? subjectsWithNoJob(body.subject_ids, refs, preSkips) : [];
  const { assigned, previous } = await assignEach(client, batchState, refs, skipped);
  return { t: target, assigned, skipped: await namedSkips(client, skipped), cap: taskCap, subjects: body.plug ? subjectsOf(refs, assigned) : null, previous, access_note: await accessNoteOf(client, entity_id, plug, previous, target) };
}

/**
 * A client handed to a person with NO job open gets the standing job (period 'standing'), through the ONE opener (lib/jobs-open.openJobs): the send is its own transaction across two parties' copies, so it runs
 * BEFORE the batch's transaction and the batch then finds the new job like any other. → Map(subject → the opener's own skip, e.g. not your client) for the ids it could not open. Returning to the pool opens nothing.
 */
async function openStandingJobs(req, entity_id, body) {
  const skips = new Map();
  if (!body.plug || !body.role || !body.target_actor_id) return skips; /* the opener needs the role (a listed or role-less call names the skip instead) */
  const have = await withEntity(entity_id, async (client) => new Set((await jobChitsOf(client, entity_id, body.plug, body.role, body.subject_ids)).map((ref) => ref.subject_id)));
  const missing = body.subject_ids.map((id) => String(id).toLowerCase()).filter((id) => UUID.test(id) && !have.has(id));
  if (!missing.length) return skips;
  const opened = await require('./jobs-open').openJobs({ firm: entity_id, plug: body.plug, role: body.role, period: 'standing', subject_ids: missing });
  for (const skip of opened.skipped) skips.set(String(skip.subject_id).toLowerCase(), skip);
  return skips;
}

/** → { t, assigned, skipped, cap }; throws { status, code } for a refusal (400 · 403 CHIT_NOT_PERMITTED) the route words */
async function bulkAssign(req) {
  const entity_id = auth.entityOf(req);
  const body = req.body;
  const ids = body.plug ? body.subject_ids : body.chit_ids;
  if (ids.length > MAX) throw refuse('Assign at most 200 chits at once.', 400, 'CHIT_TOO_MANY'); // F4: bound the batch (long tx / lock contention)
  const staff = gateNamedPlug(req, body.plug, body); /* (a) before any lookup */
  if (staff) await withEntity(entity_id, (client) => staffGateIn(client, req, entity_id, body, null)); /* before the standing jobs are opened: a refused call opens nothing */
  // Atomic: the whole batch (counts + chit_status + state_log) commits together or rolls back. B1 RLS: writes only the assigning entity's own rows -> withEntity(me).
  const preSkips = await openStandingJobs(req, entity_id, body);
  return withEntity(entity_id, (client) => runBatch(client, req, entity_id, body, preSkips, staffMayTry(req, body)));
}

module.exports = { bulkAssign, MAX, targetOf, staffMayTry, staffGateIn, heldByOther, heldSkip, namedSkips }; /* targetOf: the unit test of the view-only words (RC-4) */
