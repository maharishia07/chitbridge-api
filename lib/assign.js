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

/**
 * ⚠️ EVERY due_date IS CAST ::text, AND IT IS A CORRECTNESS FIX, NOT A FORMATTING ONE.
 *
 * due_date is a Postgres DATE. node-pg turns it into a JS Date at LOCAL midnight, and JSON then serialises that to
 * UTC — so in IST (+5:30) 2026-08-17 leaves the API as "2026-08-16T18:30:00.000Z", and any caller taking the first
 * ten characters reads the PREVIOUS DAY. The worklist heading said "Sun, 16 Aug" for work due on the 17th.
 *
 * A due date has no time and no timezone — it is a day on a calendar. Sending it as text is the only shape that
 * cannot be re-interpreted by whoever reads it.
 */
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
        /**
         * ⭐ REASSIGN, RE-DATE AND MARK-DONE ARE ALL THIS ONE INSERT — Athi, 2026-08-14: *"reassign it to someone
         * else … he can set the status to close … possibly assign to a different date."*
         *
         * Nothing new was needed for two of the three: the table is append-only with seq, and current() reads the
         * latest and keeps the rest as history. So handing a line to someone else is another row, moving the date
         * is another row, and b153's `state` rides the same way — which is what makes "who marked it done, and
         * when" free rather than a fourth column nobody maintains.
         */
        const st = ['open', 'done'].includes(String(r.state || '').toLowerCase())
          ? String(r.state).toLowerCase() : 'open';
        const q = await db.query(
          `INSERT INTO chit_line_assignment
             (chit_id, entity_id, line_id, seq, assignee_actor_id, assignee_name, assignee_type,
              task, due_date, note, assigned_by_actor_id, assigned_by_name, state)
           SELECT $1,$2,$3::uuid,
                  COALESCE((SELECT MAX(seq) FROM chit_line_assignment
                             WHERE entity_id=$2 AND chit_id=$1 AND line_id=$3::uuid), 0) + 1,
                  $4::uuid,$5,$6,$7,$8::date,$9,$10::uuid,$11,$12
           RETURNING assignment_id, line_id, seq, assignee_actor_id, assignee_name, assignee_type,
                     task, due_date::text AS due_date, note, created_at`,
          [chit_id, entity_id, r.line_id, r.assignee_actor_id || null,
           r.assignee_name ? String(r.assignee_name).slice(0, 120) : null,
           ['human', 'ai'].includes(r.assignee_type) ? r.assignee_type : null,
           r.task ? String(r.task).slice(0, 80) : null,
           r.due_date || null, r.note ? String(r.note).slice(0, 300) : null,
           who.actor_id || null, who.actor_name || null, st])
          /* ⚠️ ASSIGNMENT MUST NOT BREAK IN THE DEPLOY WINDOW. Code ships before the migration by standing order,
             so between this deploy and b153 the `state` column does not exist and naming it raises 42703 — which
             this file turns into a 503, taking every assignment down. The retry drops only the new column, and
             only for 'open', so a mark-done can never silently record itself as an ordinary reassignment. */
          .catch(async (e) => {
            if (e && e.code === '42703' && st === 'open') {
              return db.query(
                `INSERT INTO chit_line_assignment
                   (chit_id, entity_id, line_id, seq, assignee_actor_id, assignee_name, assignee_type,
                    task, due_date, note, assigned_by_actor_id, assigned_by_name)
                 SELECT $1,$2,$3::uuid,
                        COALESCE((SELECT MAX(seq) FROM chit_line_assignment
                                   WHERE entity_id=$2 AND chit_id=$1 AND line_id=$3::uuid), 0) + 1,
                        $4::uuid,$5,$6,$7,$8::date,$9,$10::uuid,$11
                 RETURNING assignment_id, line_id, seq, assignee_actor_id, assignee_name, assignee_type,
                           task, due_date::text AS due_date, note, created_at`,
                [chit_id, entity_id, r.line_id, r.assignee_actor_id || null,
                 r.assignee_name ? String(r.assignee_name).slice(0, 120) : null,
                 ['human', 'ai'].includes(r.assignee_type) ? r.assignee_type : null,
                 r.task ? String(r.task).slice(0, 80) : null,
                 r.due_date || null, r.note ? String(r.note).slice(0, 300) : null,
                 who.actor_id || null, who.actor_name || null]);
            }
            throw e;
          });
        out.push(Object.assign({ state: st }, q.rows[0]));
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
      /* ⚠️ `state` WAS MISSING HERE AND ONLY HERE. byPerson returned it from the day b153 landed, so the worklist
         knew a subtask was finished while the CHIT screen — the one place showing all the lines of an order
         together — could not. Someone marks a line done, opens the order, and it looks untouched. Read through
         to_jsonb for the same pre-migration reason as elsewhere. */
      `SELECT line_id, seq, assignee_actor_id, assignee_name, assignee_type, task, due_date::text AS due_date,
              note, created_at, COALESCE(to_jsonb(chit_line_assignment)->>'state', 'open') AS state
         FROM chit_line_assignment WHERE entity_id = $1 AND chit_id = $2 ORDER BY line_id, seq`, [entity_id, chit_id]));
    const m = new Map();
    for (const row of r.rows) {
      const prev = m.get(row.line_id);
      /* Latest seq wins; everything before it is the record of who held it. Reassignment is normal, and after
         something goes wrong "who had this on Tuesday" is the question actually asked. */
      /* The history entry carries `state` and `seq` too — without them "marked done, then reopened" is
         indistinguishable from a plain reassignment when you read the trail back. */
      m.set(row.line_id, Object.assign({}, row, { history: prev ? prev.history.concat([{ seq: prev.seq,
        assignee_name: prev.assignee_name, task: prev.task, due_date: prev.due_date,
        state: prev.state || 'open', at: prev.created_at }]) : [] }));
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
       SELECT a.assignee_actor_id, a.assignee_name, a.assignee_type, a.task, a.due_date::text AS due_date, a.note,
              l.chit_id, l.line_id, COALESCE(a.seq, 0) AS seq,
              /* b153 — read through to_jsonb so the column may not exist yet: naming a.state directly raises
                 42703, which this file turns into "not migrated" and the whole worklist would go blank between
                 deploying this and running b153. */
              COALESCE(to_jsonb(a)->>'state', 'open') AS state,
              l.particulars, l.quantity, l.unit, l.removed,
              /**
               * ⭐ THE ORIGINAL REQUIREMENT, TRAVELLING WITH THE TASK — Athi, 2026-08-14: *"how do we connect
               * with the original requirement … see, is it transparent?"*
               *
               * ⚠️ ALL FOUR ALREADY EXISTED AND NONE HAS EVER REACHED THE PERSON DOING THE WORK. asked_as and
               * raw_phrase are what the customer ACTUALLY WROTE before anything matched it to a catalogue
               * item — "2 boxes of the usual rice" becoming "Rice Ponni Boiled · 24 kg". The worker was shown
               * only the tidy version, which is the version that can be wrong: if the match is off, the person
               * holding the sack is the last one who could catch it, and they were the one person not told.
               *
               * (⚠️ No backticks in this comment. It sits INSIDE a template literal, and a backtick here ends the
               * string mid-SQL — the same slip that took the API down once already.)
               */
              l.comment, l.asked_as, l.raw_phrase, l.needs_human,
              /* What is actually left, by the ONE definition of delivered — b153's function, the same one
                 lib/amend.js guards with. A second hand-written copy of that rule here is how two screens start
                 disagreeing about how much is owed. */
              chit_line_delivered_qty(l.chit_id, l.line_id) AS delivered,
              st.current_status AS chit_status,
              h.manual_subject, h.auto_subject, h.sender_entity_display_name
         /**
          * ⚠️⚠️ THIS JOIN USED TO RUN THE OTHER WAY, AND IT HID THE MOST URGENT WORK ON THE SCREEN.
          * Athi, 2026-08-30, looking at Everyone's work: *"we have to bring the rest which is not
          * assigned as well. which is not visible now."*
          *
          * It read FROM chit_line_assignment JOIN chit_line — so a line only existed here if somebody
          * had already created an assignment row for it. There are two different absences and only one
          * of them was visible:
          *   assignment row, assignee NULL  ->  showed as "Unassigned"   (b143's deliberate un-assign)
          *   NO assignment row at all       ->  INVISIBLE                (nobody has picked it up yet)
          * The second is the common case — a line captured from WhatsApp has never been assigned to
          * anyone — so the work at most risk of being forgotten was the work the screen could not show.
          *
          * ⭐⭐ THE BUCKET ALREADY EXISTED ON BOTH SIDES. The grouping below keys on
          * assignee_actor_id || '__unassigned__' and names it "Unassigned"; the client already sorts
          * that key LAST and greys it. So inverting the join drops these lines into a bucket that was
          * built for them, and NOTHING on the client changed.
          */
         FROM chit_line l
         LEFT JOIN latest a ON a.chit_id = l.chit_id AND a.line_id = l.line_id
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
           SELECT manual_subject, auto_subject, sender_entity_display_name, role
             FROM chit_header
            WHERE entity_id = $1 AND chit_id = l.chit_id
            LIMIT 1
         ) h ON true
         /**
          * ⭐ ONLY LIVE WORK — Athi, 2026-08-14: *"what is the filter criteria? Does it bring all subtask
          * irrespective of the status of the chit? We have to bring only the active chit, ie open and act, not
          * closed one."*
          *
          * ⚠️ IT BROUGHT EVERYTHING. This file never once looked at chit_status — so a CANCELLED order kept its
          * lines in somebody's queue forever, counted toward their overdue figure, and nothing on the screen
          * said why. That is his "Order from Anbu Provisions" sitting overdue on laxman: the seed cancelled that
          * chit, and the work list never heard.
          *
          * The three buckets are the ones routes/chits.js already uses — open · act · close. Only the close
          * bucket is excluded, so an unset or unrecognised status still shows: work with an odd status must not
          * silently disappear from the list of things to do.
          *
          * ⚠️ LATERAL + LIMIT 1 AGAIN, for the same reason as the header above: chit_status has no unique
          * constraint on (entity_id, chit_id), and a self-chit holds two rows for one entity. A plain join here
          * would have re-introduced the exact row-doubling this query was fixed for once already.
          */
         LEFT JOIN LATERAL (
           SELECT current_status
             FROM chit_status
            WHERE entity_id = $1 AND chit_id = l.chit_id AND deleted_at IS NULL
            ORDER BY updated_at DESC NULLS LAST
            LIMIT 1
         ) st ON true
        WHERE l.entity_id = $1
          AND l.removed = false
          /**
           * ⚠️ A DRAFT IS NOT WORK, AND IT HAS LINES. chit_deliver() writes chit_line rows for a draft
           * too — mint.js passes is_draft as p_clear_first, so re-saving a draft rewrites them. While this
           * query started from assignments that never mattered: nobody assigns an unsent draft. Starting
           * from chit_line, every line of every unsent draft would have walked onto the worklist as
           * unassigned work somebody owes. Excluded by chit_header.role = 'Draft', which is how
           * routes/chits.js itself lists them.
           *
           * ⚠️⚠️ NOT is_draft — I REACHED FOR IT AND BROKE PRODUCTION FOR A FEW MINUTES. There IS an
           * is_draft column in 000_baseline, on cb_chit, which is the OTHER schema (the cb_* prototype the
           * jest suites use). chit_header has no such column, so naming it raised 42703 — which this file
           * catches as "not migrated" and answers with an empty list. The worklist went blank rather than
           * erroring, which is exactly the failure mode that takes longest to notice.
           */
          AND COALESCE(h.role, '') <> 'Draft'
          AND COALESCE(st.current_status, '') NOT IN ('completed', 'cancelled', 'rejected')
          ${where}
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
      const ordered = row.quantity === null ? null : Number(row.quantity);
      const delivered = row.delivered === null || row.delivered === undefined ? 0 : Number(row.delivered);
      people.get(key).lines.push({
        chit_id: row.chit_id, line_id: row.line_id, seq: row.seq,
        particulars: row.particulars, quantity: ordered,
        unit: row.unit, task: row.task, due_date: row.due_date, note: row.note,
        /* b153 — the PRIVATE declaration. Never merged with `left`: one is what a person says, the other is what
           the events say, and they are allowed to differ. */
        state: row.state || 'open',
        chit_status: row.chit_status || null,
        delivered: delivered,
        left: ordered === null ? null : Math.max(0, Math.round((ordered - delivered) * 1000) / 1000),
        /* What was actually asked for, kept beside what it was matched to. `asked_as` only travels when it
           DIFFERS from the particulars — otherwise the row would carry the same words twice and the one case
           that matters (a match that changed the wording) would stop standing out. */
        asked_as: row.asked_as && row.asked_as !== row.particulars ? row.asked_as : null,
        raw_phrase: row.raw_phrase || null,
        comment: row.comment || null,
        needs_human: !!row.needs_human,
        subject: row.manual_subject || row.auto_subject || null, counterparty: row.sender_entity_display_name || null,
      });
    }
    const out = [...people.values()].map((p) => Object.assign(p, { count: p.lines.length }));
    return { people: out, lines: r.rows.length, migrated: true, scoped_to_self: !!opts._scoped_to_self };
  } catch (e) { if (notMigrated(e)) return { people: [], lines: 0, migrated: false }; throw e; }
}

module.exports = { assign, current, byPerson };
