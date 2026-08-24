'use strict';
// lib/deliverline.js — per-line delivery (b144). The SHARED half of division of labour.
//
// Athi, 2026-08-12: assignment private, delivery shared.
//
// ── ⚠️ NOTHING HERE STORES A TOTAL ──────────────────────────────────────────────────────────────────────────────
// "6 of 10 · 4 pending" is SUMMED from the rows every time it is asked. A `delivered_qty` column would be a second
// answer to the same question and it drifts the first time a delivery is corrected. Same rule as the live set:
// the only stored thing is what happened; everything else is computed from it.
//
// ── ⭐ WHY BOTH SIDES RECORDING IS THE POINT ────────────────────────────────────────────────────────────────────
// Two independent claims that agree is far stronger evidence than one person's tick, and it is the one place the
// co-holding architecture earns its keep for almost no cost. Divergence — "they recorded a delivery you have not"
// — is SURFACED and never resolved: CB takes no side, blocks nothing, and shows both. Surfacing it early, while
// both people still remember the morning, is the whole value.
const { withEntity, onEntity } = require('../db');

/* ⚠️ 42883 IS NOT IN THIS SET, and that was a mistake worth keeping out. "function does not exist" is raised
   both when a migration is missing AND when a call fails to resolve its argument types — so treating it as
   "not migrated" hid a plain coding error behind a 503 that pointed at the database. A missing table (42P01) or
   column (42703) really is a migration; a missing function is now allowed to surface as the 500 it is. */
const notMigrated = (e) => e && (e.code === '42P01' || e.code === '42703');
const gone = () => { const x = new Error('Per-line delivery is not migrated on this environment (b144).'); x.status = 503; return x; };
const n2 = (v) => Math.round((Number(v) + Number.EPSILON) * 1000) / 1000;

/**
 * ⭐ A UNIT IS PART OF THE QUANTITY, NOT A LABEL ON IT.
 *
 * ⚠️ THIS FUNCTION EXISTS BECAUSE THE SUM IGNORED IT. `delivered` added every row's number whatever unit it
 * carried, so ordering 25 kg and recording 1 crate left "24 kg pending" — and, far worse, ordering 10 kg and
 * recording 12 pieces read `delivered 12 >= ordered 10` and marked the line **COMPLETE, with 2 over**. That is
 * the b150 failure shape exactly: the error points at "it has arrived", which is the one direction nobody
 * questions and nobody chases. A full delivery in the ordered unit hides it completely, which is why it survived
 * — it only shows up in PARTIAL delivery, in mixed units.
 *
 * ⚠️ NOTHING IS CONVERTED. CB does not know how many kg are in a crate, and a rate it guessed would become the
 * number two parties argue over. Quantities in the ordered unit count; quantities in any other unit are carried
 * BESIDE the total and flagged for a human — the same honest fallback as the worklist roll-up's "mixed units".
 *
 * A blank delivery unit is read as the ordered unit: recording "10" against a line ordered in kg is a claim about
 * that line, not a competing unit.
 */
const uKey = (u) => String(u == null ? '' : u).trim().toLowerCase();

/**
 * record(entity_id, chit_id, rows, who) — claim a delivery against one or more lines.
 *
 * ⚠️ THE WRITE GOES THROUGH chit_line_deliver(), a SECURITY DEFINER function, because it must land in EVERY
 * participant's copy. That is what "shared" means; a plain INSERT under RLS would only ever reach my own side and
 * the counterparty would never see the claim.
 * ⚠️ A NEGATIVE QUANTITY IS LEGAL and is how a delivery is undone — a correcting entry, never an edit or a delete.
 */
async function record(entity_id, chit_id, rows, who = {}) {
  const list = (Array.isArray(rows) ? rows : [rows]).filter(Boolean);
  if (!list.length) { const e = new Error('Nothing to record'); e.status = 400; throw e; }
  for (const r of list) {
    if (!r.line_id) { const e = new Error('Each delivery needs a line_id'); e.status = 400; throw e; }
    const isAdd = String(r.kind || '').trim().toLowerCase() === 'add';
    const q = Number(r.quantity);
    /* ⚠️ THE DELIVER RULE IS UNCHANGED AND STAYS STRICT — a delivery of nothing is not a claim about goods. Only
       the new 'add' kind may carry a zero quantity, and only when it carries money instead: a call-out fee is a
       real event with no thing attached. Each kind must say SOMETHING; neither may say nothing. */
    if (!isAdd) {
      if (!Number.isFinite(q) || q === 0) {
        const e = new Error('quantity must be a non-zero number — a negative value corrects an earlier delivery');
        e.status = 400; throw e;
      }
    } else {
      const a = Number(r.amount);
      if (!(Number.isFinite(q) && q !== 0) && !(Number.isFinite(a) && a !== 0)) {
        const e = new Error('an added event needs a quantity or an amount — otherwise it records nothing');
        e.status = 400; throw e;
      }
      if (!String(r.particulars || '').trim()) {
        const e = new Error('an added event must say what it was for');
        e.status = 400; throw e;
      }
    }
  }
  try {
    return await withEntity(entity_id, async (db) => {
      const out = [];
      for (const r of list) {
        /* ⚠️ EVERY ARGUMENT IS CAST EXPLICITLY. node-pg sends parameters untyped, so Postgres cannot resolve
           which chit_line_deliver() overload is meant and raises 42883 — "function does not exist". That error
           code is in the notMigrated set, so it surfaced as a 503 "not migrated" and sent me looking at the
           migration rather than at the call. An untyped call to a typed function is a lie by omission. */
        /* b152 — same call, two directions. `kind` decides whether the event draws the order down or accrues
           against it; everything else is identical, which is the point Athi made. */
        const kind = String(r.kind || 'deliver').trim().toLowerCase() === 'add' ? 'add' : 'deliver';
        const q = await db.query(
          'SELECT chit_line_event($1::uuid,$2::uuid,$3::numeric,$4::text,$5::text,$6::text,$7::uuid,$8::text,$9::text,$10::numeric,$11::text) AS copies',
          [chit_id, r.line_id, r.quantity == null ? null : Number(r.quantity), r.unit || null,
           r.reference ? String(r.reference).slice(0, 200) : null,
           r.note ? String(r.note).slice(0, 300) : null,
           who.actor_id || null, who.actor_name || null,
           kind, r.amount == null ? null : Number(r.amount),
           r.particulars ? String(r.particulars).slice(0, 300) : null])
          /**
           * ⚠️ THE ONE PLACE 42883 IS ALLOWED TO MEAN "NOT MIGRATED" — and it is narrow on purpose. The header of
           * this file explains why 42883 is normally NOT in the notMigrated set: it is also raised when a call
           * fails to resolve its argument types, so treating it as a migration gap once hid a plain coding error
           * behind a 503. Here the call is constructed three lines above with every type cast explicit, so the
           * only way the function can be missing is that b152 has not been run — the window between deploying
           * this code and running the migration, which is the standing order (code first, then the migration).
           * The fallback is refused for anything b144 cannot express, so an 'add' never degrades into a delivery.
           */
          .catch(async (e) => {
            if (e && e.code === '42883' && kind === 'deliver' && r.amount == null && !r.particulars) {
              return db.query(
                'SELECT chit_line_deliver($1::uuid,$2::uuid,$3::numeric,$4::text,$5::text,$6::text,$7::uuid,$8::text) AS copies',
                [chit_id, r.line_id, Number(r.quantity), r.unit || null,
                 r.reference ? String(r.reference).slice(0, 200) : null,
                 r.note ? String(r.note).slice(0, 300) : null,
                 who.actor_id || null, who.actor_name || null]);
            }
            throw e;
          });
        out.push({ line_id: r.line_id, quantity: Number(r.quantity || 0), kind, copies: q.rows[0].copies });
      }
      return { delivered: out };
    });
  } catch (e) { if (e.status) throw e; if (notMigrated(e)) throw gone(); throw e; }
}

/**
 * ⭐ progress(entity_id, chit_id) — how much of each line has actually gone out, and who says so.
 *
 * Returns Map(line_id → { ordered, delivered, pending, complete, over, events[], mine, theirs, both_agree }).
 *
 * ⚠️ `both_agree` IS COMPUTED FROM MATCHING TOTALS, not from matching rows. Two parties will never produce
 * identical row sets — they record at different moments, in different splits ("6 then 4" vs "10"). What can
 * honestly be compared is what each side says has gone out IN TOTAL. Comparing rows would show disagreement
 * where there is none, and people would stop believing the signal.
 */
async function progress(entity_id, chit_id, _db, _rows) {
  try {
    const r = _rows ? { rows: _rows } : await onEntity(entity_id, _db, (db) => db.query(
      `SELECT l.line_id, l.particulars, l.unit AS ordered_unit, l.quantity AS ordered, l.removed,
              d.delivery_id, d.quantity AS dq, d.unit AS du, d.reference, d.note,
              d.recorded_by_entity_id, d.recorded_by_name, d.recorded_by_actor_name, d.delivered_at,
              /* ⚠️ READ THROUGH to_jsonb SO THE COLUMN MAY NOT EXIST YET. Naming d.kind directly raises 42703,
                 which this file treats as "not migrated" and turns into a null progress — the whole delivery
                 display would vanish between deploying this code and running b152. Through to_jsonb an absent
                 column is simply null, which is exactly what a pre-b152 row means. */
              to_jsonb(d)->>'kind'                AS dkind,
              (to_jsonb(d)->>'amount')::numeric   AS damount,
              to_jsonb(d)->>'particulars'         AS dparticulars
         FROM chit_line l
         LEFT JOIN chit_line_delivery d
                ON d.entity_id = l.entity_id AND d.chit_id = l.chit_id AND d.line_id = l.line_id
        WHERE l.entity_id = $1 AND l.chit_id = $2
        ORDER BY l.seq, l.line_id, d.delivered_at`, [entity_id, chit_id]));

    const m = new Map();
    for (const row of r.rows) {
      if (!m.has(row.line_id)) {
        m.set(row.line_id, { line_id: row.line_id, particulars: row.particulars,
          ordered: row.ordered === null ? null : Number(row.ordered), unit: row.ordered_unit,
          removed: row.removed, events: [], mine: 0, theirs: 0, _off: new Map(),
          added: [], charged: 0 });
      }
      const e = m.get(row.line_id);
      if (!row.delivery_id) continue;
      const q = Number(row.dq);
      const isMine = row.recorded_by_entity_id === entity_id;

      /* Money accrues on EVERY event, whichever direction it reads — a delivery can carry a charge too. */
      const amt = row.damount == null ? null : Number(row.damount);
      if (amt != null && isFinite(amt)) e.charged = n2(e.charged + amt);

      /**
       * ⭐ THE OTHER DIRECTION — Athi: *"a car service … adds brake oil, brake shoe and so on, all accumulated
       * under a line item. Here it is the reverse, both are nothing but the same."*
       *
       * ⚠️ AN 'add' NEVER TOUCHES `delivered`. It is not a claim about the ordered quantity — fitting a brake
       * shoe does not deliver 2 of the brake job. It accrues alongside, in its own units, and is listed rather
       * than summed for the same reason `other_units` exists: 1 litre + 2 piece + 1.5 hours is not 4.5.
       */
      if (row.dkind === 'add') {
        e.added.push({ delivery_id: row.delivery_id, particulars: row.dparticulars,
          quantity: q, unit: row.du, amount: amt, at: row.delivered_at,
          by: row.recorded_by_name, by_actor: row.recorded_by_actor_name, mine: isMine,
          reference: row.reference, note: row.note });
        continue;
      }
      /* A blank unit means "as ordered" — it is an omission, not a different unit. */
      const dk = uKey(row.du) || uKey(e.unit);
      const onUnit = dk === uKey(e.unit);
      e.events.push({ delivery_id: row.delivery_id, quantity: q, unit: row.du,
        reference: row.reference, note: row.note, at: row.delivered_at,
        by: row.recorded_by_name, by_actor: row.recorded_by_actor_name,
        mine: isMine,
        /* ⚠️ The event is never hidden or rejected — it happened. It is marked so the screen can say so. */
        off_unit: !onUnit });
      if (onUnit) {
        if (isMine) e.mine = n2(e.mine + q); else e.theirs = n2(e.theirs + q);
      } else {
        const o = e._off.get(dk) || { unit: row.du, mine: 0, theirs: 0 };
        if (isMine) o.mine = n2(o.mine + q); else o.theirs = n2(o.theirs + q);
        e._off.set(dk, o);
      }
    }

    for (const e of m.values()) {
      /* ⚠️ MY OWN CLAIM IS THE HEADLINE. Using the larger of the two, or their number when it is bigger, would
         let the counterparty move my delivered figure by asserting something — which is exactly the sort of
         quiet authority CB must never hand across the boundary. Theirs is shown BESIDE mine, never merged. */
      e.delivered = e.mine;
      e.pending = (e.ordered === null) ? null : n2(Math.max(0, e.ordered - e.delivered));
      /**
       * ⚠️⚠️ A LINE THAT ASKED FOR NOTHING IS NOT DONE — IT IS UNREAD. Athi, 2026-08-24, on a WhatsApp job:
       * *"just the status alone appearing as done."* Two of its seven lines said **done** and nobody had
       * touched them: `oil change` and `filter change` came out of the reader with `ordered = 0`, and
       * `0 >= 0` is true, so they were VACUOUSLY complete from the moment the chit was created.
       *
       * ⭐ That is the worst possible direction for this bug to point. "Nothing was ordered" and "the work is
       * finished" are opposite facts, and the screen was showing the second one — a shop reading that job
       * would skip two complaints believing them handled.
       *
       * ⚠️ NARROW ON PURPOSE. `ordered > 0` keeps every ordinary line exactly as it was; `delivered > 0` keeps
       * a zero-quantity line completable once somebody actually records against it. A line stays incomplete
       * only while BOTH are zero, which is precisely the state that means "nobody has done anything yet".
       */
      e.complete = (e.ordered !== null) && e.delivered >= e.ordered
        && (e.ordered > 0 || e.delivered > 0);
      /* ⚠️ EXCESS IS RECORDED AND SHOWN, never rejected — an extra crate is normal, and refusing it would make
         the record disagree with the lorry. */
      e.over = (e.ordered !== null && e.delivered > e.ordered) ? n2(e.delivered - e.ordered) : 0;
      /**
       * ⭐ WHAT CAME IN A DIFFERENT UNIT, CARRIED BESIDE THE TOTAL AND NEVER FOLDED INTO IT.
       *
       * ⚠️ `complete` above is now decided by the ordered unit ALONE, which is a deliberate narrowing: a line
       * ordered in kg cannot be closed by a delivery counted in crates. If that under-reads a real delivery, the
       * screen says so and a person settles it — the opposite of the old behaviour, which closed the line
       * silently and stopped anyone chasing it.
       */
      e.other_units = [...e._off.values()].filter((o) => o.mine !== 0 || o.theirs !== 0);
      e.unit_mismatch = e.other_units.length > 0;
      delete e._off;
      /* An open line: the estimate was 100 and 130 of work has been recorded against it. The variance is the
         conversation, so it is stated rather than left to be worked out. */
      e.accrued = e.added.length;
      e.both_agree = e.theirs !== 0 && e.mine !== 0 && e.mine === e.theirs && !e.unit_mismatch;
      /**
       * ⚠️ DIVERGENCE REQUIRES BOTH SIDES TO HAVE SPOKEN. The first version read
       *      (theirs !== 0 || mine !== 0) && mine !== theirs
       * which flagged EVERY delivery the counterparty had not yet confirmed — i.e. almost all of them, almost all
       * of the time. A signal that fires constantly is one people stop reading, and then the real disagreement
       * arrives wearing the same badge as the ordinary case. Same failure I caught in the numeral check.
       *
       * The three states are genuinely different and are kept apart:
       *   both_agree      both recorded, totals match      — the strongest evidence on the rail
       *   divergent       both recorded, totals DIFFER     — a real disagreement, surfaced, never resolved
       *   unacknowledged  only one side has recorded       — the normal, uninteresting case
       */
      e.divergent = e.mine !== 0 && e.theirs !== 0 && e.mine !== e.theirs;
      e.unacknowledged = e.mine !== 0 && e.theirs === 0;
    }
    return m;
  } catch (e) { if (notMigrated(e)) return null; throw e; }
}

/** roll-up for a whole chit: "3 of 6 complete", used by the header. Derived, never stored. */
function summarise(map) {
  if (!map) return null;
  const live = [...map.values()].filter((e) => !e.removed);
  const done = live.filter((e) => e.complete).length;
  const started = live.filter((e) => e.delivered > 0).length;
  return { lines: live.length, complete: done, started,
           none: live.length - started,
           /* ⭐ PARTIAL IS A FIRST-CLASS STATE, not "not yet complete". A line with something against it and
              something still owed is where the work actually is, and the header could not say how many. */
           partial: live.filter((e) => e.delivered > 0 && !e.complete).length,
           /* ⭐ The service reading: how many lines are accumulating work, and what it comes to. Money DOES sum
              across lines — a rupee is a rupee, which is exactly why quantities are not summed and this is. */
           accruing: live.filter((e) => (e.added || []).length > 0).length,
           charged: n2(live.reduce((t, e) => t + (e.charged || 0), 0)),
           divergent: live.filter((e) => e.divergent).length,
           /* A line whose delivery is counted in a unit the order does not use needs a person, not a formula. */
           unit_mismatch: live.filter((e) => e.unit_mismatch).length,
           unacknowledged: live.filter((e) => e.unacknowledged).length };
}

module.exports = { record, progress, summarise };
