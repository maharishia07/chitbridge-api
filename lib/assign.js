'use strict';
// lib/assign.js — who is doing which LINE (b143). Division of labour.
//
// Athi, 2026-08-12: *"for each line item if we can assign to an assist, a date and may be few others it will start
// behaving like a division of labour — so multiple people, devices or anything it can work at the same time."*
//
// ── ⚠️ THIS IS THE PRIVATE HALF ─────────────────────────────────────────────────────────────────────────────────
// Per-line ASSIGNMENT is ours; per-line DELIVERY is shared. The counterparty must never learn that Murugan has
// their onions — that is headcount, capacity and who is behind on what. Nothing in this file is ever joined into
// a co-held read, and every query is entity-scoped under FORCE RLS.
//
// ── ⭐ THE ROLL-UP IS THE POINT, NOT THE ASSIGNMENT ─────────────────────────────────────────────────────────────
// Assigning a line is bookkeeping. What it BUYS is `byPerson()`: one person's work list assembled from every chit
// at once — "everything Murugan owes today, across twelve customers". A chit-level model cannot express that at
// all, because the chit is the smallest thing it can hand to anybody. This is the same insight as the group sum:
// the same lines, grouped by a different key, answer a completely different question.
const { withEntity, onEntity } = require('../db');

const notMigrated = (e) => e && (e.code === '42P01' || e.code === '42703');
const gone = () => { const x = new Error('Line assignment is not migrated on this environment (b143).'); x.status = 503; return x; };

/**
 * assign(entity_id, chit_id, edits, who) — append assignments.
 *
 * `edits` = [{ line_id, assignee_actor_id|null, assignee_name, assignee_type, task, due_date, note }]
 *
 * ⚠️ assignee_actor_id NULL IS A REAL ASSIGNMENT — "taken off Murugan", which is not the same as never assigned.
 * The caller must send it deliberately; omitting the key entirely is rejected rather than guessed.
 * ⚠️ seq IS COMPUTED IN THE TRANSACTION. Taking it from the client would let two taps on a bad connection both
 * claim to be the same step, and "who has it now" would then depend on row order rather than on what happened.
 */
async function assign(entity_id, chit_id, edits, who = {}) {
  const rows = (Array.isArray(edits) ? edits : [edits]).filter(Boolean);
  if (!rows.length) { const e = new Error('Nothing to assign'); e.status = 400; throw e; }
  for (const r of rows) {
    if (!r.line_id) { const e = new Error('Each assignment needs a line_id'); e.status = 400; throw e; }
    if (!('assignee_actor_id' in r)) {
      const e = new Error('Send assignee_actor_id explicitly — null means unassign, and omitting it is not the same thing');
      e.status = 400; throw e;
    }
    if (r.due_date && !/^\d{4}-\d{2}-\d{2}$/.test(String(r.due_date))) {
      const e = new Error('due_date must be YYYY-MM-DD'); e.status = 400; throw e;
    }
  }
  try {
    return await withEntity(entity_id, async (db) => {
      const out = [];
      for (const r of rows) {
        const q = await db.query(
          `INSERT INTO chit_line_assignment
             (chit_id, entity_id, line_id, seq, assignee_actor_id, assignee_name, assignee_type,
              task, due_date, note, assigned_by_actor_id, assigned_by_name)
           SELECT $1,$2,$3::uuid,
                  COALESCE((SELECT MAX(seq) FROM chit_line_assignment
                             WHERE entity_id=$2 AND chit_id=$1 AND line_id=$3::uuid), 0) + 1,
                  $4::uuid,$5,$6,$7,$8::date,$9,$10::uuid,$11
           RETURNING assignment_id, line_id, seq, assignee_actor_id, assignee_name, assignee_type,
                     task, due_date, note, created_at`,
          [chit_id, entity_id, r.line_id, r.assignee_actor_id || null,
           r.assignee_name ? String(r.assignee_name).slice(0, 120) : null,
           ['human', 'ai'].includes(r.assignee_type) ? r.assignee_type : null,
           r.task ? String(r.task).slice(0, 80) : null,
           r.due_date || null, r.note ? String(r.note).slice(0, 300) : null,
           who.actor_id || null, who.actor_name || null]);
        out.push(q.rows[0]);
      }
      return { assignments: out };
    });
  } catch (e) { if (e.status) throw e; if (notMigrated(e)) throw gone(); throw e; }
}

/**
 * current(entity_id, chit_id) — who holds each line NOW, plus how it got there.
 * Returns Map(line_id → { …latest, history: [older…] }). ⚠️ null when b143 is not applied, so callers degrade
 * to "no line assignment on this chit" rather than erroring — which is also the honest answer.
 */
async function current(entity_id, chit_id, _db, _rows) {
  try {
    const r = _rows ? { rows: _rows } : await onEntity(entity_id, _db, (db) => db.query(
      `SELECT line_id, seq, assignee_actor_id, assignee_name, assignee_type, task, due_date, note, created_at
         FROM chit_line_assignment WHERE entity_id = $1 AND chit_id = $2 ORDER BY line_id, seq`, [entity_id, chit_id]));
    const m = new Map();
    for (const row of r.rows) {
      const prev = m.get(row.line_id);
      /* Latest seq wins; everything before it is the record of who held it. Reassignment is normal, and after
         something goes wrong "who had this on Tuesday" is the question actually asked. */
      m.set(row.line_id, Object.assign({}, row, { history: prev ? prev.history.concat([{ assignee_name: prev.assignee_name, task: prev.task, due_date: prev.due_date, at: prev.created_at }]) : [] }));
    }
    return m;
  } catch (e) { if (notMigrated(e)) return null; throw e; }
}

/**
 * ⭐ byPerson(entity_id, opts) — one person's work list, across EVERY chit.
 *
 * opts: { due_on?: 'YYYY-MM-DD', actor_id?, include_done? }
 *
 * ⚠️ IT READS chit_line, SO REMOVED LINES DROP OUT AUTOMATICALLY. A line struck for stock-unavailable is not work
 * anybody owes; leaving it on a picking list would send someone looking for goods that were cancelled.
 * ⚠️ AND ONLY THE LATEST ASSIGNMENT COUNTS. A line reassigned from Murugan to Selvam must appear on exactly one
 * list — showing on both is how two people pick the same crate and one customer gets nothing.
 */
async function byPerson(entity_id, opts = {}) {
  const args = [entity_id];
  let where = '';
  if (opts.due_on) { args.push(opts.due_on); where += ` AND a.due_date = $${args.length}::date`; }
  if (opts.actor_id) { args.push(opts.actor_id); where += ` AND a.assignee_actor_id = $${args.length}::uuid`; }
  try {
    const r = await withEntity(entity_id, (db) => db.query(
      `WITH latest AS (
         SELECT DISTINCT ON (chit_id, line_id) *
           FROM chit_line_assignment
          WHERE entity_id = $1
          ORDER BY chit_id, line_id, seq DESC
       )
       SELECT a.assignee_actor_id, a.assignee_name, a.assignee_type, a.task, a.due_date, a.note,
              a.chit_id, a.line_id,
              l.particulars, l.quantity, l.unit, l.removed,
              h.manual_subject, h.auto_subject, h.sender_entity_display_name
         FROM latest a
         JOIN chit_line l ON l.entity_id = $1 AND l.chit_id = a.chit_id AND l.line_id = a.line_id
         /**
          * ⚠️ LATERAL + LIMIT 1, BECAUSE A PLAIN JOIN MULTIPLIES. chit_header has no unique constraint on
          * (entity_id, chit_id): a self-chit legitimately holds TWO rows for one entity — the sent copy and the
          * received copy — so joining on chit_id alone returned every assignment TWICE.
          *
          * It looked like three separate bugs (counts doubled, due_on ignored, actor_id ignored) and was one:
          * the filters were correct all along and were being applied to a doubled row set. A join that multiplies
          * is the most expensive kind of wrong, because every number downstream stays plausible.
          *
          * The header is used only for the chit's NAME here, and both copies carry the same subject — so one row
          * is the right answer, not an arbitrary one.
          */
         LEFT JOIN LATERAL (
           SELECT manual_subject, auto_subject, sender_entity_display_name
             FROM chit_header
            WHERE entity_id = $1 AND chit_id = a.chit_id
            LIMIT 1
         ) h ON true
        WHERE l.removed = false ${where}
        ORDER BY a.assignee_name NULLS LAST, a.due_date NULLS LAST, l.particulars`, args));

    /* Grouped here rather than in SQL so "unassigned" is a real bucket with a name, instead of a null key the
       caller has to remember to handle. */
    const people = new Map();
    for (const row of r.rows) {
      const key = row.assignee_actor_id || '__unassigned__';
      if (!people.has(key)) {
        people.set(key, { actor_id: row.assignee_actor_id, name: row.assignee_name || 'Unassigned',
                          type: row.assignee_type || null, lines: [] });
      }
      people.get(key).lines.push({
        chit_id: row.chit_id, line_id: row.line_id,
        particulars: row.particulars, quantity: row.quantity === null ? null : Number(row.quantity),
        unit: row.unit, task: row.task, due_date: row.due_date, note: row.note,
        subject: row.manual_subject || row.auto_subject || null, counterparty: row.sender_entity_display_name || null,
      });
    }
    const out = [...people.values()].map((p) => Object.assign(p, { count: p.lines.length }));
    return { people: out, lines: r.rows.length, migrated: true, scoped_to_self: !!opts._scoped_to_self };
  } catch (e) { if (notMigrated(e)) return { people: [], lines: 0, migrated: false }; throw e; }
}

module.exports = { assign, current, byPerson };
