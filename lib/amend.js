'use strict';
// lib/amend.js — corrections recorded ALONGSIDE the reading, never over it (b137).
//
// Athi, 2026-08-11: *"the existing data has to be shown struck out and the new data item appears instead."*
//
// ── ⚠️ NOTHING HERE MUTATES A CHIT ──────────────────────────────────────────────────────────────────────────────
// `chit_detail.line_items` keeps what the reader produced, forever. apply() lays the amendments over a COPY of it
// for display, so the screen can show "5" struck through with "2" beside it — and both remain true statements
// about different moments. A chit that quietly became right would be indistinguishable from one that was always
// right, and only one of those can be defended.
//
// ── ⚠️ TWO KINDS OF CORRECTION, AND THEY TEACH DIFFERENT THINGS ─────────────────────────────────────────────────
//   'naming'   "thakkali means Tomato"      → DATA. Can be learned, as a catalogue synonym, once a human confirms.
//   'reading'  "you took the size as a qty" → ENGINEERING. No amount of data fixes it; the prompt is wrong.
// Filing them together would hide the second kind inside the first, and the second kind is the one that tells you
// whether the reader is actually improving.
const { withEntity } = require('../db');

const notMigrated = (e) => e && (e.code === '42P01' || e.code === '42703');
const gone = () => { const x = new Error('Amendments are not migrated on this environment (b137).'); x.status = 503; return x; };

/** Fields a person may correct on a line. Anything else is refused — an amendment to an unknown field is a typo. */
const LINE_FIELDS = ['particulars', 'quantity', 'unit', 'unit_size', 'unit_price', 'price', 'comment'];
/** …and on the chit as a whole (line_index = null). */
const CHIT_FIELDS = ['delivery_at', 'delivery_address', 'notes', 'subject'];

/**
 * record(entity_id, chit_id, edits, who) — write one or more corrections.
 *
 * `edits` = [{ line_index, field, old_value, new_value, kind, reason }]
 *
 * ⚠️ old_value IS SUPPLIED BY THE CALLER AND STORED VERBATIM. It could be re-derived server-side, but the honest
 * record is what the person was LOOKING AT when they corrected it — if the two ever disagree, that disagreement is
 * itself worth seeing rather than smoothing over.
 */
async function record(entity_id, chit_id, edits, who = {}) {
  const rows = (Array.isArray(edits) ? edits : [edits]).filter(Boolean);
  if (!rows.length) { const e = new Error('Nothing to amend'); e.status = 400; throw e; }
  for (const r of rows) {
    const f = String(r.field || '');
    const ok = (r.line_index === null || r.line_index === undefined) ? CHIT_FIELDS.includes(f) : LINE_FIELDS.includes(f);
    if (!ok) { const e = new Error('Cannot amend "' + f + '"'); e.status = 400; throw e; }
    if (String(r.old_value ?? '') === String(r.new_value ?? '')) {
      const e = new Error('"' + f + '" is unchanged — an amendment that changes nothing is noise on the record');
      e.status = 400; throw e;
    }
  }
  try {
    return await withEntity(entity_id, async (db) => {
      const out = [];
      for (const r of rows) {
        const q = await db.query(
          `INSERT INTO chit_amendment (chit_id, entity_id, line_index, field, old_value, new_value, actor_id, actor_name, reason, kind)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
           RETURNING amendment_id, line_index, field, old_value, new_value, kind, actor_name, created_at`,
          [chit_id, entity_id,
           (r.line_index === null || r.line_index === undefined) ? null : Number(r.line_index),
           String(r.field), r.old_value == null ? null : String(r.old_value).slice(0, 500),
           r.new_value == null ? null : String(r.new_value).slice(0, 500),
           who.actor_id || null, who.actor_name || null,
           r.reason ? String(r.reason).slice(0, 300) : null,
           ['naming', 'reading', 'other'].includes(r.kind) ? r.kind : 'reading']);
        out.push(q.rows[0]);
      }
      return { amendments: out };
    });
  } catch (e) { if (e.status) throw e; if (notMigrated(e)) throw gone(); throw e; }
}

async function list(entity_id, chit_id) {
  try {
    const r = await withEntity(entity_id, (db) => db.query(
      `SELECT amendment_id, line_index, field, old_value, new_value, kind, actor_name, reason, learned_at, created_at
         FROM chit_amendment WHERE entity_id = $1 AND chit_id = $2 ORDER BY created_at`, [entity_id, chit_id]));
    return { amendments: r.rows, migrated: true };
  } catch (e) { if (notMigrated(e)) return { amendments: [], migrated: false, note: 'amendments not migrated (b137)' }; throw e; }
}

/**
 * apply(lines, amendments) — the ORIGINAL lines plus, on each, what it was amended to.
 *
 * ⚠️ IT RETURNS BOTH. Each line gains `_amended` (field → {from, to}) and its values updated, so the screen can
 * strike the old and show the new without a second lookup — and without ever having lost the old.
 *
 * ⚠️ LAST WRITE WINS PER FIELD, which is why they are ordered by created_at. Correcting a correction is normal;
 * showing three struck-through values in a row is not, so only the first `from` is kept — that is what the reader
 * originally produced, and it is the one worth seeing.
 */
function apply(lines, amendments, chitLevel) {
  const out = (lines || []).map((l) => Object.assign({}, l));
  const chit = {};
  for (const a of (amendments || [])) {
    const val = a.new_value;
    if (a.line_index === null || a.line_index === undefined) {
      chit[a.field] = { from: (chit[a.field] && chit[a.field].from !== undefined) ? chit[a.field].from : a.old_value, to: val };
      continue;
    }
    const l = out[a.line_index];
    if (!l) continue;                      // an amendment to a line that no longer exists — ignored, never crashes
    l._amended = l._amended || {};
    if (l._amended[a.field] === undefined) l._amended[a.field] = { from: a.old_value, to: val };
    else l._amended[a.field].to = val;
    /* Numbers come back as text from the DB; a quantity must stay a number or every total downstream turns into
       string concatenation — "2" + "3" = "23" is the kind of bug that only shows up in the money column. */
    l[a.field] = ['quantity', 'price', 'unit_price'].includes(a.field) ? (val === null ? null : Number(val)) : val;
  }
  (out).forEach((l) => {
    if (l.quantity != null && l.price != null) l.total = Math.round((Number(l.quantity) * Number(l.price) + Number.EPSILON) * 100) / 100;
  });
  return chitLevel ? { lines: out, chit } : out;
}

module.exports = { record, list, apply, LINE_FIELDS, CHIT_FIELDS };
