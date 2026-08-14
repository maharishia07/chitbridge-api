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
    const q = Number(r.quantity);
    if (!Number.isFinite(q) || q === 0) {
      const e = new Error('quantity must be a non-zero number — a negative value corrects an earlier delivery');
      e.status = 400; throw e;
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
        const q = await db.query(
          'SELECT chit_line_deliver($1::uuid,$2::uuid,$3::numeric,$4::text,$5::text,$6::text,$7::uuid,$8::text) AS copies',
          [chit_id, r.line_id, Number(r.quantity), r.unit || null,
           r.reference ? String(r.reference).slice(0, 200) : null,
           r.note ? String(r.note).slice(0, 300) : null,
           who.actor_id || null, who.actor_name || null]);
        out.push({ line_id: r.line_id, quantity: Number(r.quantity), copies: q.rows[0].copies });
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
              d.recorded_by_entity_id, d.recorded_by_name, d.recorded_by_actor_name, d.delivered_at
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
          removed: row.removed, events: [], mine: 0, theirs: 0, _off: new Map() });
      }
      const e = m.get(row.line_id);
      if (!row.delivery_id) continue;
      const q = Number(row.dq);
      const isMine = row.recorded_by_entity_id === entity_id;
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
      e.complete = (e.ordered !== null) && e.delivered >= e.ordered;
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
           divergent: live.filter((e) => e.divergent).length,
           /* A line whose delivery is counted in a unit the order does not use needs a person, not a formula. */
           unit_mismatch: live.filter((e) => e.unit_mismatch).length,
           unacknowledged: live.filter((e) => e.unacknowledged).length };
}

module.exports = { record, progress, summarise };
