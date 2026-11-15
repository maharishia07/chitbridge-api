'use strict';
// OWNS      the CHANGE DETECTORS of an adopter (MARK-AND-QUERY 2.3): subjectsNow(db, adopter, entity, ids) → what each subject is NOW (found, its words, its seal, its successor) · compareSeal(stored, now)
// CALLED BY lib/review-mark.js (at set time for the seal, at read time for "altered") · tests/mark-detect.test.cjs
// FLOW      adopter.change.how: successor → the later row that reverses it · version / seal → canon.seal over the row read as JSON (to_jsonb: one type for every driver) → compare TWO CARRIED values, never recompute the subject
// CARD      capability/MARK-AND-QUERY-CAPABILITY
/**
 * ⚠️ MISMATCH, NOT RECOMPUTE: the seal on the mark and the seal now are two carried values compared; nothing here calculates the subject a second time.
 * ⚠️ ONE canon.seal() CALL for both moments (set and read), over the row as `to_jsonb` gives it (numeric a number, a date a string): a bigint driver string and a number seal to the same hash (hostile test).
 * Identifiers come from the reviewed registry and are re-checked as plain names before they reach SQL; values are always parameters.
 */
const canon = require('./canon');

const IDENT = /^[a-z_][a-z0-9_]*$/;
const plain = (name) => {
  if (!IDENT.test(String(name))) throw new Error('mark-detect: not a plain name: ' + name);
  return name;
};

/** the seal of a subject from what was read: the detector form's own fields */
function sealOf(change, row, successorId) {
  if (change.how === 'successor') return canon.seal(['successor_id'], { successor_id: successorId || null });
  const fields = change.how === 'version' ? change.columns : change.fields;
  return canon.seal(fields, row);
}

/**
 * subjectsNow(db, adopter, entity, ids) → Map(id → { found, label, date, seal, successor: { id, no, at, who } | null })
 * An id the entity has no such row for is `found: false` (a foreign id and a missing id read the same).
 */
async function subjectsNow(db, adopter, entity, ids) {
  const out = new Map();
  if (!ids.length) return out;
  const { subject, change } = adopter;
  const table = plain(subject.table), id = plain(subject.id), label = plain(subject.label[0]);
  const date = subject.date ? plain(subject.date) : null;
  let sql, params = [entity, ids];
  if (change.how === 'successor') {
    const col = plain(change.column), who = plain(change.who), at = plain(change.at), lab = plain(change.label);
    sql = `SELECT s.${id}::text AS id, s.${label}::text AS label, ${date ? `s.${date}::text` : 'NULL'} AS date,
                  n.${id}::text AS succ_id, n.${lab}::text AS succ_no, n.${at} AS succ_at, n.${who}::text AS succ_who
             FROM ${table} s
             LEFT JOIN LATERAL (SELECT x.* FROM ${table} x WHERE x.${col} = s.${id} AND x.entity_id = s.entity_id ORDER BY x.${at}, x.${id} LIMIT 1) n ON true
            WHERE s.entity_id = $1::uuid AND s.${id}::text = ANY($2::text[])`;
  } else {
    sql = `SELECT s.${id}::text AS id, s.${label}::text AS label, ${date ? `s.${date}::text` : 'NULL'} AS date, to_jsonb(s) AS row
             FROM ${table} s WHERE s.entity_id = $1::uuid AND s.${id}::text = ANY($2::text[])`;
  }
  const found = await db.query(sql, params);
  for (const row of found.rows) {
    const successor = row.succ_id ? { id: row.succ_id, no: row.succ_no, at: row.succ_at, who: row.succ_who } : null;
    out.set(row.id, { found: true, label: row.label, date: row.date, seal: sealOf(change, row.row, row.succ_id), successor });
  }
  for (const wanted of ids) if (!out.has(wanted)) out.set(wanted, { found: false, label: null, date: null, seal: null, successor: null });
  return out;
}

/** compareSeal(stored, now) → { altered, recheck_needed }: the field list changed = re-check (never altered); else the two hashes */
function compareSeal(stored, now) {
  if (!stored || !now) return { altered: false, recheck_needed: false };
  const sameFields = JSON.stringify(stored.fields || []) === JSON.stringify(now.fields || []);
  if (!sameFields) return { altered: false, recheck_needed: true };
  return { altered: stored.hash !== now.hash, recheck_needed: false };
}

module.exports = { subjectsNow, compareSeal, sealOf };
