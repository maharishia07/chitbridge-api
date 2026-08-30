'use strict';
/**
 * lib/raida.js — the register on a line (b182). Risks, assumptions, issues, dependencies, actions, decisions.
 *
 * Athi, 2026-08-30: *"still in design only but much simplistic one, recording facts only."*
 * Design and the decisions behind it: C:\dev\DESIGN-raida-and-cover.md
 *
 * ── ⭐⭐ STATE IS COMPUTED, NEVER STORED ─────────────────────────────────────────────────────────────────────────
 * There is no status column and there will not be one in phase 0. An entry is OPEN when no row closes it, and
 * CLOSED when one does — exactly the way `chit_line_cost` corrects with a signed row instead of an edit. Nothing
 * is ever UPDATEd, so "what did we think on the 14th" stays answerable after it has stopped being true.
 *
 * That is what makes "recording facts only" reachable rather than a slogan: owner, due date, probability and
 * derivation can each arrive later as a column or a read, and until they do this cannot rot into a half-built
 * workflow. There is no field for it to rot in.
 *
 * ── ⚠️ THE TABLE MAY NOT EXIST YET, AND THAT MUST NOT BE AN ERROR ───────────────────────────────────────────────
 * Code deploys before the migration is run by hand — always, here. Every read degrades to an EMPTY register and
 * `migrated:false`; a WRITE refuses with 503 and says which migration is missing, because silently accepting a
 * risk nobody stored would be worse than refusing it.
 *
 * ⚠️⚠️ AND THE GUARD IS `schema.hasTable`, NOT A NAKED QUERY. On 2026-08-30 I named a column that lives on a
 * different table and the 42703 turned an entire screen blank rather than erroring — the failure mode that takes
 * longest to notice. Ask first; the answer is cached.
 */
const { withEntity, onEntity } = require('../db');
const schema = require('./schema');
const reqctx = require('./reqctx');

const TABLE = 'chit_line_raida';
/** The six. `info` and `query` are conversation, not register entries — they stay message types. */
const KINDS = ['risk', 'assumption', 'issue', 'dependency', 'action', 'decision'];
const VISIBILITY = ['internal', 'shared'];

const notMigrated = (e) => e && (e.code === '42P01' || e.code === '42703');
const gone = () => {
  const x = new Error('The register is not migrated on this environment (b182).');
  x.status = 503; return x;
};
const bad = (msg) => { const x = new Error(msg); x.status = 400; return x; };

/**
 * Read the register for a chit, or for one line of it.
 *
 * ⚠️ `line_id` HAS THREE MEANINGS HERE and conflating them is the easy mistake:
 *   undefined  →  everything on this chit, order-level entries included  (the chit's whole register)
 *   a uuid     →  that line, PLUS the order-level entries it inherits    (what the line card shows)
 *   null       →  order-level only
 * The middle one is the scope model from the design — authored at a scope, read with inheritance.
 */
async function list(entity_id, chit_id, line_id, db) {
  if (!(await schema.hasTable(TABLE))) return { entries: [], migrated: false };
  try {
    const args = [entity_id, chit_id];
    let where = '';
    if (line_id === null) where = ' AND line_id IS NULL';
    else if (line_id !== undefined) { args.push(line_id); where = ` AND (line_id = $${args.length} OR line_id IS NULL)`; }

    const r = await onEntity(entity_id, db, (c) => c.query(
      `SELECT raida_id, line_id, kind, body, closes_id, visibility, dispute_id,
              created_by_actor_id, created_by_name, created_at
         FROM ${TABLE}
        WHERE entity_id = $1 AND chit_id = $2${where}
        ORDER BY created_at`, args));

    /* ⭐ THE ONLY DERIVATION IN THE FILE. A row that closes another is not an entry in its own right — it is the
       closing of one — so it never appears in the list; it sets `closed` on the row it points at and lends it its
       words as the reason. That keeps "3 open" honest without a status column to disagree with. */
    const closedBy = new Map();
    for (const row of r.rows) if (row.closes_id) closedBy.set(row.closes_id, row);

    const entries = r.rows.filter((row) => !row.closes_id).map((row) => {
      const close = closedBy.get(row.raida_id) || null;
      return {
        raida_id: row.raida_id,
        line_id: row.line_id,
        /* ⚠️ INHERITED, not a second kind of entry. An order-level entry read from a line is the SAME entry; the
           flag only tells the screen not to offer "close" from a place that does not own it. */
        scope: row.line_id ? 'line' : 'order',
        inherited: !!(line_id && !row.line_id),
        kind: row.kind,
        body: row.body,
        visibility: row.visibility,
        dispute_id: row.dispute_id || null,
        by: row.created_by_name || null,
        at: row.created_at,
        open: !close,
        closed_at: close ? close.created_at : null,
        closed_by: close ? (close.created_by_name || null) : null,
        closed_note: close ? close.body : null,
      };
    });
    const open = entries.filter((e) => e.open).length;
    return { entries, open, closed: entries.length - open, migrated: true };
  } catch (e) { if (notMigrated(e)) return { entries: [], migrated: false }; throw e; }
}

/**
 * Record one fact.
 *
 * ⚠️ opts.db LETS THE CALLER SHARE ITS TRANSACTION, and the route uses it. The ownership check and the insert
 * are one question and one answer; opening a second withEntity for the insert costs BEGIN + set_config + COMMIT
 * again — four more round trips at ~250ms each from Railway to Supabase, to establish something the first
 * transaction already knew. Same seam as storage.listForChit and everything else that took this lesson.
 */
async function add(entity_id, chit_id, opts = {}) {
  if (!(await schema.hasTable(TABLE))) throw gone();
  const kind = String(opts.kind || '').trim().toLowerCase();
  if (KINDS.indexOf(kind) < 0) throw bad('kind must be one of: ' + KINDS.join(', '));
  const body = String(opts.body == null ? '' : opts.body).trim();
  if (!body) throw bad('An entry needs to say something.');
  /* ⚠️ DEFAULT internal, and never inferred. An entry saying our own supplier may slip must not reach the
     counterparty because a caller left the field off. */
  const visibility = VISIBILITY.indexOf(opts.visibility) >= 0 ? opts.visibility : 'internal';
  /* undefined and null both mean "the whole chit" on the way IN — there is no third thing to express here. */
  const line_id = opts.line_id || null;

  try {
    const r = await onEntity(entity_id, opts.db, (c) => c.query(
      `INSERT INTO ${TABLE} (entity_id, chit_id, line_id, kind, body, visibility,
                             created_by_actor_id, created_by_name)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING raida_id, created_at`,
      [entity_id, chit_id, line_id, kind, body, visibility,
       reqctx.currentActor() || null, opts.by_name || null]));
    return { raida_id: r.rows[0].raida_id, at: r.rows[0].created_at, kind, migrated: true };
  } catch (e) { if (notMigrated(e)) throw gone(); throw e; }
}

/**
 * Close one entry by APPENDING the row that closes it.
 *
 * ⚠️ THE CLOSING ROW CARRIES THE REASON, and that is the point of closing this way rather than flipping a flag:
 * "we booked the slot" and "the customer withdrew it" are different endings, and a boolean cannot tell them apart.
 */
async function close(entity_id, chit_id, raida_id, opts = {}) {
  if (!(await schema.hasTable(TABLE))) throw gone();
  const body = String(opts.body == null ? '' : opts.body).trim() || 'Closed.';
  try {
    return await withEntity(entity_id, async (c) => {
      /* ⚠️ READ IT FIRST — inside the same transaction, so the kind and the line come from the row being closed
         rather than from whatever the caller believed. A close that lands on the wrong line is invisible. */
      const t = await c.query(
        `SELECT kind, line_id, closes_id FROM ${TABLE} WHERE entity_id = $1 AND chit_id = $2 AND raida_id = $3`,
        [entity_id, chit_id, raida_id]);
      if (!t.rows.length) throw bad('No such entry on this chit.');
      if (t.rows[0].closes_id) throw bad('That row is itself a closing row — it cannot be closed.');

      const already = await c.query(
        `SELECT 1 FROM ${TABLE} WHERE entity_id = $1 AND closes_id = $2 LIMIT 1`, [entity_id, raida_id]);
      /* ⚠️ Idempotent by refusal, not by silence: closing twice is a mistake worth reporting, and a second
         closing row would give the entry two endings. */
      if (already.rows.length) throw bad('That entry is already closed.');

      const r = await c.query(
        `INSERT INTO ${TABLE} (entity_id, chit_id, line_id, kind, body, closes_id,
                               created_by_actor_id, created_by_name)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING raida_id, created_at`,
        [entity_id, chit_id, t.rows[0].line_id, t.rows[0].kind, body, raida_id,
         reqctx.currentActor() || null, opts.by_name || null]);
      return { closed: raida_id, closing_row: r.rows[0].raida_id, at: r.rows[0].created_at, migrated: true };
    });
  } catch (e) { if (e.status) throw e; if (notMigrated(e)) throw gone(); throw e; }
}

/**
 * Record that an issue was escalated through the EXISTING dispute path.
 *
 * ⚠️ THIS RAISES NOTHING. Athi, 2026-08-30: *"if they want to link it as dispute there should be a facility to
 * raise it as a dispute, just call the dispute here."* So the caller raises the dispute the one way disputes are
 * raised, then tells the register the id. Reimplementing any part of the dispute lifecycle here would be a second
 * answer to a question that already has one — which is the failure this whole design keeps avoiding.
 */
async function linkDispute(entity_id, chit_id, raida_id, dispute_id) {
  if (!(await schema.hasTable(TABLE))) throw gone();
  if (!dispute_id) throw bad('A dispute id is required.');
  try {
    const r = await withEntity(entity_id, (c) => c.query(
      `UPDATE ${TABLE} SET dispute_id = $4
        WHERE entity_id = $1 AND chit_id = $2 AND raida_id = $3 AND kind = 'issue'
        RETURNING raida_id`,
      [entity_id, chit_id, raida_id, dispute_id]));
    /* ⚠️ The kind is in the WHERE on purpose: only an ISSUE escalates. A risk that has not happened yet has
       nothing to dispute about, and silently allowing it would put the register and the dispute list out of step. */
    if (!r.rows.length) throw bad('No open issue with that id on this chit.');
    return { raida_id, dispute_id, migrated: true };
  } catch (e) { if (e.status) throw e; if (notMigrated(e)) throw gone(); throw e; }
}

module.exports = { list, add, close, linkDispute, KINDS, VISIBILITY };
