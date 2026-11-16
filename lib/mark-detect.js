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

/** the ONE statement that reads what the subjects are now ($1 the entity, $2 the ids as text[]): subjectsNow runs it, and a caller that batches (the practice read) sends the SAME text with its own ids expression */
function nowSql(adopter) {
  const { subject, change } = adopter;
  const table = plain(subject.table), id = plain(subject.id), label = plain(subject.label[0]);
  const date = subject.date ? plain(subject.date) : null;
  const wanted = idIn(adopter, id, '$2::text[]');
  if (change.how === 'successor') {
    const col = plain(change.column), who = plain(change.who), at = plain(change.at), lab = plain(change.label);
    return `SELECT s.${id}::text AS id, s.${label}::text AS label, ${date ? `s.${date}::text` : 'NULL'} AS date,
                  n.${id}::text AS succ_id, n.${lab}::text AS succ_no, n.${at} AS succ_at, n.${who}::text AS succ_who
             FROM ${table} s
             LEFT JOIN LATERAL (SELECT x.* FROM ${table} x WHERE x.${col} = s.${id} AND x.entity_id = s.entity_id ORDER BY x.${at}, x.${id} LIMIT 1) n ON true
            WHERE s.entity_id = $1::uuid AND ${wanted}`;
  }
  return `SELECT s.${id}::text AS id, s.${label}::text AS label, ${date ? `s.${date}::text` : 'NULL'} AS date, to_jsonb(s) AS row
             FROM ${table} s WHERE s.entity_id = $1::uuid AND ${wanted}`;
}

/* a canonical lower-case uuid: the only text that `id::text` could ever equal, so reading such a text as a uuid changes no answer */
const UUID_TEXT = "'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'";
/** SQL that reads a text expression as the subject's uuid key, or NULL when it is not a canonical uuid (CASE keeps the cast off any other text, so it can never raise) */
function uuidOf(textExpr) { return `CASE WHEN ${textExpr} ~ ${UUID_TEXT} THEN ${textExpr}::uuid END`; }
/**
 * the predicate "s.<id> is one of the wanted ids" with the key column LEFT BARE when the adopter says the id is a uuid (subject.id_type), so the key index serves it: the old `s.id::text = ANY(text[])` cast the column and scanned the client's whole entry book (l17 MIS depth, 4.4 ms to 1.4 ms per client at 7 years).
 * textArray: SQL giving a text[] of wanted ids. Any other id type keeps the text compare.
 */
function idIn(adopter, id, textArray) {
  if (adopter.subject.id_type !== 'uuid') return `s.${id}::text = ANY(${textArray})`;
  return `s.${id} = ANY(ARRAY(SELECT ${uuidOf('w.t')} FROM unnest(${textArray}) w(t)))`;
}

/** the Map of what each wanted id is now, from the rows nowSql answered (an id with no row is found: false) */
function nowFrom(adopter, rows, ids) {
  const out = new Map();
  for (const row of rows) {
    const successor = row.succ_id ? { id: row.succ_id, no: row.succ_no, at: row.succ_at, who: row.succ_who } : null;
    out.set(row.id, { found: true, label: row.label, date: row.date, seal: sealOf(adopter.change, row.row, row.succ_id), successor });
  }
  for (const wanted of ids) if (!out.has(wanted)) out.set(wanted, { found: false, label: null, date: null, seal: null, successor: null });
  return out;
}

/**
 * subjectsNow(db, adopter, entity, ids) → Map(id → { found, label, date, seal, successor: { id, no, at, who } | null })
 * An id the entity has no such row for is `found: false` (a foreign id and a missing id read the same).
 */
async function subjectsNow(db, adopter, entity, ids) {
  if (!ids.length) return new Map();
  const found = await db.query(nowSql(adopter), [entity, ids]);
  return nowFrom(adopter, found.rows, ids);
}

/** compareSeal(stored, now) → { altered, recheck_needed }: the field list changed = re-check (never altered); else the two hashes */
function compareSeal(stored, now) {
  if (!stored || !now) return { altered: false, recheck_needed: false };
  const sameFields = JSON.stringify(stored.fields || []) === JSON.stringify(now.fields || []);
  if (!sameFields) return { altered: false, recheck_needed: true };
  return { altered: stored.hash !== now.hash, recheck_needed: false };
}

module.exports = { subjectsNow, nowSql, nowFrom, compareSeal, sealOf, uuidOf };
