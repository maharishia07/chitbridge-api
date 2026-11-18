'use strict';
/**
 * CARD 01-rail-core-the-chit/assign
 * assign-holds.js — what a person holds across the plugs, and hand-over of all of it (ASSIGN-NET L11 + L9).
 *
 * OWNS      holdsOf(client, entity, ids) → Map(actor → { total, by_plug, followups }) · holdsAnswer(entity, actorId) · myWork(client, entity, holder, limit) → { total, by_plug, rows } · handOverAll(req, { from, to, note }) → { from, to, moved, skipped, previous }
 * CALLED BY routes/chits-holds.js (GET /holds · GET /my-work · POST /hand-over-all)
 * FLOW      a count and a list read the SAME rows, in ONE spelling (lib/assign-chit openHeldWhere, the one "holds open work") plus the person's open follow-ups (party_followup)
 *           → hand-over groups the held chits by plug (the plug decides who may hold them) → the ONE writer, lib/assign-bulk bulkAssign, once per plug and 200 → follow-ups through the ONE follow-up mover (lib/crm-followups rerouteFollowups)
 * It writes no holder itself and holds no second rule: who may hold is assignableActor (bulkAssign's own target check) and mustBeAssignable (follow-ups); who may hand over is the partner or a manager (the route's managerGate).
 * ANSWER    like assign-bulk: moved (counts) · skipped (named, with a code) · previous[] (who held each MOVED item before: what an Undo puts back; { chit_id, plug, subject_id, actor_id } or { followup_id, plug: 'followup', actor_id }).
 * NOT all-or-nothing across plugs (each bulkAssign is its own transaction, as the job opener's sends are): a partial run is finished by calling again.
 */
const { withEntity } = require('../db');
const auth = require('../middleware/auth');
const { openHeldWhere } = require('./assign-chit');
const { bulkAssign, MAX } = require('./assign-bulk');
const followups = require('./crm-followups');

const PLUG_SQL = `COALESCE(ch.business_json -> 'job' ->> 'plug', 'task')`;
const SUBJECT_SQL = `(SELECT r ->> 'entity_id' FROM jsonb_array_elements(ch.all_recipients) r WHERE r ->> 'role' IS DISTINCT FROM 'sender' LIMIT 1)`;
const refuse = (message, status, code) => Object.assign(new Error(message), { status, code });

/** the open follow-ups each of the people holds: Map(actor → count); a shop before the follow-up migration holds none */
async function followupCounts(client, entity, ids) {
  if (!(await followups.migrated(client))) return new Map();
  const found = await client.query(
    `SELECT assignee_user_id::text AS actor_id, COUNT(*)::int AS n FROM party_followup WHERE owner_entity_id = $1 AND done_at IS NULL AND assignee_user_id = ANY($2::uuid[]) GROUP BY 1`,
    [entity, ids]
  );
  return new Map(found.rows.map((row) => [row.actor_id, row.n]));
}

/**
 * holdsOf(client, entity, ids) → Map(actor id → { total, by_plug: { task, client, …, followup }, followups }) for each id asked (a person who holds nothing answers zeros).
 * ONE statement for the chits (the person list joined to openHeldWhere), ONE for the follow-ups.
 */
async function holdsOf(client, entity, ids) {
  const out = new Map(ids.map((id) => [String(id), { total: 0, by_plug: {}, followups: 0 }]));
  if (!ids.length) return out;
  const held = await client.query(
    `SELECT ids.id::text AS actor_id, ${PLUG_SQL} AS plug, COUNT(*)::int AS n
       FROM unnest($2::uuid[]) AS ids(id)
       JOIN chit_status cs ON ${openHeldWhere('ids.id', '$1')}
       LEFT JOIN chit_header ch ON ch.chit_id = cs.chit_id AND ch.entity_id = cs.entity_id
      GROUP BY 1, 2`,
    [entity, ids]
  );
  for (const row of held.rows) {
    const holding = out.get(row.actor_id);
    holding.by_plug[row.plug] = row.n;
    holding.total += row.n;
  }
  for (const [actor, n] of await followupCounts(client, entity, ids)) {
    const holding = out.get(actor);
    if (!holding) continue;
    holding.by_plug.followup = n;
    holding.followups = n;
    holding.total += n;
  }
  return out;
}

/** the plugs counted, in the order a screen says them */
const plugsOf = (by_plug) => Object.keys(by_plug).map((plug) => ({ plug, count: by_plug[plug] }));

/** the people of the shop (actors, switched off or not: a leaver's work is exactly what a hand-over moves) */
async function teamOf(client, entity) {
  const found = await client.query(`SELECT identity_id::text AS id, display_name FROM identities WHERE parent_entity_id = $1 AND identity_type = 'actor'`, [entity]);
  return found.rows;
}

/** the answer of GET /holds: every person with something held, or the one person asked for (zeros included) */
async function holdsAnswer(entity, actorId) {
  return withEntity(entity, async (client) => {
    const team = await teamOf(client, entity);
    const asked = actorId ? team.filter((person) => person.id.toLowerCase() === String(actorId).toLowerCase()) : team;
    const counts = await holdsOf(client, entity, asked.map((person) => person.id));
    const people = asked.map((person) => {
      const holding = counts.get(person.id);
      return { actor_id: person.id, name: person.display_name, total: holding.total, followups: holding.followups, plugs: plugsOf(holding.by_plug) };
    });
    return { people: actorId ? people : people.filter((person) => person.total > 0) };
  });
}

/**
 * myWork(client, entity, holder, limit) → { total, by_plug, rows }: what I hold, newest first, the count and the rows from the SAME held rule (openHeldWhere), so they cannot disagree.
 * A row: { kind: 'chit'|'followup', plug, chit_id|followup_id, subject, subject_id, status, assigned_at }; a client job's subject_id is the client (the sealed list's non-sender entry).
 */
async function myWork(client, entity, holder, limit) {
  const pageSize = Math.max(1, Math.min(200, Number(limit) || 50));
  const counts = (await holdsOf(client, entity, [holder])).get(String(holder));
  const chits = await client.query(
    `SELECT cs.chit_id, ${PLUG_SQL} AS plug, cs.current_status AS status, cs.assigned_at, COALESCE(ch.manual_subject, ch.auto_subject) AS subject, ${SUBJECT_SQL} AS subject_id
       FROM chit_status cs LEFT JOIN chit_header ch ON ch.chit_id = cs.chit_id AND ch.entity_id = cs.entity_id
      WHERE ${openHeldWhere('$1', '$2')}
      ORDER BY cs.assigned_at DESC NULLS LAST, cs.chit_id LIMIT $3`,
    [holder, entity, pageSize]
  );
  const rows = chits.rows.map((row) => ({ kind: 'chit', plug: row.plug, chit_id: row.chit_id, subject: row.subject || null, subject_id: row.plug === 'task' ? null : row.subject_id || null, status: row.status, assigned_at: row.assigned_at }));
  if (counts.followups) {
    const open = await client.query(`SELECT followup_id, what, party_id, updated_at FROM party_followup WHERE owner_entity_id = $1 AND assignee_user_id = $2 AND done_at IS NULL ORDER BY updated_at DESC NULLS LAST LIMIT $3`, [entity, holder, pageSize]);
    for (const row of open.rows) rows.push({ kind: 'followup', plug: 'followup', followup_id: row.followup_id, subject: row.what, subject_id: row.party_id || null, status: 'open', assigned_at: row.updated_at || null });
  }
  rows.sort((first, second) => String(second.assigned_at || '').localeCompare(String(first.assigned_at || '')));
  return { total: counts.total, by_plug: plugsOf(counts.by_plug), rows: rows.slice(0, pageSize) };
}

/** the held chits of one person, grouped by plug: Map(plug → [{ chit_id, subject_id }]) (the plug decides who may hold them) */
async function heldChitsOf(client, entity, from) {
  const found = await client.query(
    `SELECT cs.chit_id, ${PLUG_SQL} AS plug, ${SUBJECT_SQL} AS subject_id
       FROM chit_status cs LEFT JOIN chit_header ch ON ch.chit_id = cs.chit_id AND ch.entity_id = cs.entity_id
      WHERE ${openHeldWhere('$1', '$2')} ORDER BY cs.assigned_at DESC NULLS LAST, cs.chit_id`,
    [from, entity]
  );
  const groups = new Map();
  for (const row of found.rows) {
    if (!groups.has(row.plug)) groups.set(row.plug, []);
    groups.get(row.plug).push({ chit_id: row.chit_id, subject_id: row.plug === 'task' ? undefined : row.subject_id });
  }
  return groups;
}

/** a group the new holder is refused (a view-only seat, a seat off shift, pull mode): every item a named skip, never a whole refusal */
const skipsOf = (items, plug, err) => items.map((item) => ({ chit_id: item.chit_id, plug, subject_id: item.subject_id, code: 'TARGET_CANNOT_HOLD', reason: err.message }));

/** one plug's group through the ONE writer, 200 at a time: → { moved, skipped, previous } */
async function moveGroup(req, plug, items, to, note) {
  const out = { moved: 0, skipped: [], previous: [] };
  for (let at = 0; at < items.length; at += MAX) {
    const chunk = items.slice(at, at + MAX);
    const asked = Object.create(req);
    asked.body = { chit_ids: chunk.map((item) => item.chit_id), target_actor_id: to, note };
    try {
      const done = await bulkAssign(asked);
      const subjectOf = new Map(chunk.map((item) => [String(item.chit_id), item.subject_id]));
      out.moved += done.assigned.length;
      out.skipped.push(...done.skipped.map((skip) => Object.assign({ plug }, skip)));
      out.previous.push(...done.previous.map((before) => ({ chit_id: before.chit_id, plug, subject_id: subjectOf.get(String(before.chit_id)), actor_id: before.actor_id })));
    } catch (err) {
      if (err.status !== 400) throw err; /* a 403 (not a manager) is the whole call's refusal */
      out.skipped.push(...skipsOf(chunk, plug, err));
    }
  }
  return out;
}

/** the follow-ups: the ONE follow-up mover, after the same may-hold gate a single hand-on passes (a refusal names every follow-up) */
async function moveFollowups(entity, from, to) {
  return withEntity(entity, async (client) => {
    if (!(await followups.migrated(client))) return { moved: 0, skipped: [], previous: [] };
    const open = await client.query(`SELECT followup_id FROM party_followup WHERE owner_entity_id = $1 AND assignee_user_id = $2 AND done_at IS NULL ORDER BY followup_id`, [entity, from]);
    const ids = open.rows.map((row) => row.followup_id);
    if (!ids.length) return { moved: 0, skipped: [], previous: [] };
    if (to) {
      try {
        await followups.mustBeAssignable(client, entity, to, true);
      } catch (err) {
        return { moved: 0, skipped: ids.map((id) => ({ followup_id: id, plug: 'followup', code: 'TARGET_CANNOT_HOLD', reason: err.message })), previous: [] };
      }
    }
    await followups.rerouteFollowups(client, entity, from, to || null);
    return { moved: ids.length, skipped: [], previous: ids.map((id) => ({ followup_id: id, plug: 'followup', actor_id: from })) };
  });
}

/** both people must be on the team; their names for the answer */
async function namesOf(entity, from, to) {
  return withEntity(entity, async (client) => {
    const nameOf = new Map((await teamOf(client, entity)).map((person) => [person.id.toLowerCase(), person.display_name]));
    if (!nameOf.has(String(from).toLowerCase())) throw refuse('That person is not on your team.', 404, 'ACTOR_NOT_FOUND');
    if (to && String(to).toLowerCase() === String(from).toLowerCase()) throw refuse('Choose someone else to hand the work to.', 400, 'CHIT_BAD_REQUEST');
    if (to && !nameOf.has(String(to).toLowerCase())) throw refuse('That person is not on your team.', 400, 'CHIT_BAD_REQUEST');
    return { from: nameOf.get(String(from).toLowerCase()), to: to ? nameOf.get(String(to).toLowerCase()) : null };
  });
}

/**
 * handOverAll(req, { from, to, note }) → { from, to, moved, skipped, previous }: everything `from` holds open goes to `to` (a person), or back to the pool (to null).
 * `moved` counts items (a client once per job copy, as assign-bulk's `copies`; a follow-up each one); the skips are named and coded.
 */
async function handOverAll(req, { from, to, note }) {
  const entity = auth.entityOf(req);
  const names = await namesOf(entity, from, to);
  const groups = await withEntity(entity, (client) => heldChitsOf(client, entity, from));
  const result = { moved: 0, skipped: [], previous: [] };
  const merge = (part) => {
    result.moved += part.moved;
    result.skipped.push(...part.skipped);
    result.previous.push(...part.previous);
  };
  for (const [plug, items] of groups) merge(await moveGroup(req, plug, items, to || null, note));
  merge(await moveFollowups(entity, from, to || null));
  return { from: names.from, to: names.to, moved: result.moved, skipped: result.skipped, previous: result.previous };
}

module.exports = { holdsOf, holdsAnswer, myWork, handOverAll };
