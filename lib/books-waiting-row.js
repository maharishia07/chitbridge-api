'use strict';
/**
 * lib/books-waiting-row.js — THE WAITING ROW AS THE SCREENS READ IT (split out of lib/books-hooks.js so that file holds its size row)
 * OWNER     cb-accounting
 * RISK      money
 * OWNS      TODOS (what a waiting row may ask of the owner) · todoFields (a queue answer's todo, name, candidates and shortfall as the outbox row's event carries them) · shortOf (the three shortfall figures, integers) ·
 *           waitingRow (a waiting-list row as GET /api/books/health and the nightly check show it)
 * CALLED BY lib/books-hooks.js (re-exports TODOS and waitingRow; park and retry use todoFields) · lib/books-nightly.js and routes/books.js through hooks.waitingRow
 * FLOW      parked row (books_outbox + its event) ──> todo (one of TODOS, else 'record') ──> the row's data: reason, tries, job, name, near suppliers, the chit it waits on ──> the screens branch on `todo`, never on `reason`
 * CARD      14-accounting/books-health-to-do-outbox
 */

/** STD1: what a waiting row may ask of the owner (books-store TODO_SQL classifies a row parked before these existed) */
const TODOS = ['accept', 'add_supplier', 'record'];

/** the three shortfall figures, integers only — never the words (the row says them from the figures) */
function shortOf(figures) {
  if (!figures || typeof figures !== 'object') return null;
  const whole = (value) => Math.round(Number(value) || 0);
  return { theirs_minor: whole(figures.theirs_minor), ours_minor: whole(figures.ours_minor), short_minor: whole(figures.short_minor) };
}

/** a queue answer's todo · name · candidates, as the outbox row's event carries them */
function todoFields(verdict) {
  const todo = TODOS.indexOf(verdict && verdict.todo) >= 0 ? verdict.todo : 'record';
  const out = todo === 'add_supplier' ? { todo, name: verdict.name || null, candidates: Array.isArray(verdict.candidates) ? verdict.candidates.slice(0, 3) : [] } : { todo };
  if (verdict && verdict.short) out.short = shortOf(verdict.short); /* R106: a shortfall's figures ride the row as data (FIELDS waiting[].short) */
  return out;
}

/** the shop's near matches for a supplier to add (books-store supplierByName): up to 3, names + party_no only; [] on every other row */
function nearSuppliersOf(parkedJob, todo) {
  if (todo !== 'add_supplier' || !Array.isArray(parkedJob.candidates)) return [];
  return parkedJob.candidates.slice(0, 3).map((item) => ({ name: String(item.name || ''), party_no: item.party_no || null }));
}

/** ⭐ `source` — the same shape the Day book's entries carry, so the screen opens the chit the row is waiting on */
function waitingSourceOf(row, parkedJob) {
  return { chit_id: row.source_chit_id || parkedJob.chit_id || null, ref: parkedJob.ref || null, kind: parkedJob.kind || parkedJob.job || null, counter: parkedJob.counter || null, by: parkedJob.by || null };
}

/**
 * a waiting-list row as GET /api/books/health and the nightly check show it — `reason` is why it could not post (for people).
 * ⭐ STD1: `todo` (accept · add_supplier · record) and `name` are the row's DATA (park; books-store waiting() reads them, classifying a row
 * parked before they existed with the ONE fragment TODO_SQL) — the screens branch on these, never on `reason`.
 */
function waitingRow(row) {
  const parkedJob = row.event || {};
  const todo = todoOf(row, parkedJob);
  return Object.assign({ short: shortOf(parkedJob.short) /* R106: their figure, the count, the gap (integers) on a shortfall wait; else null */ }, plainFieldsOf(row, parkedJob), {
    todo,
    name: todo === 'add_supplier' ? row.name || parkedJob.name || null : null,
    candidates: nearSuppliersOf(parkedJob, todo),
    wait: parkedJob.waiting || null /* 'locked': books-locked-wait */,
    source: waitingSourceOf(row, parkedJob)
  });
}
/** the row's todo: its own, else the parked job's, when it is one of TODOS; else 'record' */
function todoOf(row, parkedJob) {
  const asked = row.todo || parkedJob.todo;
  return TODOS.indexOf(asked) >= 0 ? asked : 'record';
}
/** the row's plain fields: id, the chit and ref it waits on, why it could not post, tries, since, the parked job's kind */
function plainFieldsOf(row, parkedJob) {
  return { id: row.id, chit_id: row.source_chit_id || null, ref: row.source_ref || null, reason: row.why || null, tries: Number(row.tries) || 0, since: row.created_at, job: parkedJob.job || null };
}

module.exports = { TODOS, todoFields, shortOf, waitingRow };
