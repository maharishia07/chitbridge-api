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
      `SELECT a.raida_id, a.line_id, a.kind, a.body, a.closes_id, a.visibility, a.dispute_id,
              a.created_by_actor_id, a.created_by_name, a.created_at,
              st.current_status AS chit_status
         FROM ${TABLE} a
         /* ⚠️ LATERAL + LIMIT 1 — chit_status has no unique constraint on (entity_id, chit_id) and a
            self-chit holds two rows for one entity, so a plain join would double every entry. */
         LEFT JOIN LATERAL (
           SELECT current_status FROM chit_status
            WHERE entity_id = $1 AND chit_id = $2 AND deleted_at IS NULL
            ORDER BY updated_at DESC NULLS LAST LIMIT 1
         ) st ON true
        WHERE a.entity_id = $1 AND a.chit_id = $2${where.replace(/line_id/g, 'a.line_id')}
        ORDER BY a.created_at`, args));

    /* ⭐ THE ONLY DERIVATION IN THE FILE. A row that closes another is not an entry in its own right — it is the
       closing of one — so it never appears in the list; it sets `closed` on the row it points at and lends it its
       words as the reason. That keeps "3 open" honest without a status column to disagree with. */
    const closedBy = new Map();
    for (const row of r.rows) if (row.closes_id) closedBy.set(row.closes_id, row);

    /* ⭐⭐ ATHI'S CLOSURE RULE, and the SAME rule the report uses: *"if the chit is closed all are closed."*
       Derived, never written — inserting closing rows for everything would put a name and a time against an
       ending nobody chose, on a table whose whole value is that it does not do that. */
    const orderClosed = ['completed', 'cancelled', 'rejected']
      .indexOf(String((r.rows[0] || {}).chit_status || '')) >= 0;
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
        open: !close && !orderClosed,
        /* ⚠️ Three endings, not two: still running · somebody closed it · the order finished around it.
           The third is an UNRESOLVED entry, and reporting it as resolved would flatter the register exactly
           when it should not — an order that shipped with something still open. */
        ending: close ? 'closed' : (orderClosed ? 'closed_by_order' : null),
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
 * ⭐⭐ THE ROLL-UP — every entry the entity holds, across every chit. Athi, 2026-08-30: *"where will it
 * reflect as a wholesum across all the chit … so we can see all the open and closed stuff in a single place."*
 *
 * ⭐⭐ AND THE CLOSURE RULE IS HIS, AND IT IS DERIVED, NOT WRITTEN: *"the closure is, if the chit is closed
 * all are closed."* So a closed order closes its register — but NOT by inserting closing rows for everything.
 * Writing them would be a lie about who ended each entry and when, on a table whose whole value is that it does
 * not lie about that. The chit's status is read alongside, and an entry on a closed chit READS closed.
 *
 * ⚠️⚠️ AND THE TWO ENDINGS ARE KEPT APART, because they are not the same fact and the difference is the one
 * a person needs. `closed_by_order` means the order finished and nobody ever answered this — an unresolved risk,
 * not a resolved one. A register that reported those as "closed" beside deliberate closures would flatter itself
 * every time an order shipped with something still open, which is exactly when you want to know.
 */
async function report(entity_id, opts = {}) {
  if (!(await schema.hasTable(TABLE))) return { entries: [], migrated: false };
  const CLOSED_CHIT = ['completed', 'cancelled', 'rejected'];
  try {
    const r = await withEntity(entity_id, (db) => db.query(
      `SELECT a.raida_id, a.chit_id, a.line_id, a.kind, a.body, a.closes_id, a.visibility, a.dispute_id,
              a.created_by_name, a.created_at,
              l.particulars,
              h.manual_subject, h.auto_subject,
              st.current_status AS chit_status
         FROM ${TABLE} a
         /* The line is optional — an order-level entry has none, and must still appear. */
         LEFT JOIN chit_line l
                ON l.entity_id = $1 AND l.chit_id = a.chit_id AND l.line_id = a.line_id
         /* ⚠️ LATERAL + LIMIT 1, the same reason assign.js states: chit_header has no unique constraint on
            (entity_id, chit_id) — a self-chit holds two rows for one entity — and a plain join would double
            every entry. A join that multiplies is the most expensive kind of wrong. */
         LEFT JOIN LATERAL (
           SELECT manual_subject, auto_subject FROM chit_header
            WHERE entity_id = $1 AND chit_id = a.chit_id LIMIT 1
         ) h ON true
         LEFT JOIN LATERAL (
           SELECT current_status FROM chit_status
            WHERE entity_id = $1 AND chit_id = a.chit_id AND deleted_at IS NULL
            ORDER BY updated_at DESC NULLS LAST LIMIT 1
         ) st ON true
        WHERE a.entity_id = $1
        ORDER BY a.created_at DESC`, [entity_id]));

    const closedBy = new Map();
    for (const row of r.rows) if (row.closes_id) closedBy.set(row.closes_id, row);

    const entries = r.rows.filter((row) => !row.closes_id).map((row) => {
      const close = closedBy.get(row.raida_id) || null;
      const orderClosed = CLOSED_CHIT.indexOf(String(row.chit_status || '')) >= 0;
      return {
        raida_id: row.raida_id, chit_id: row.chit_id, line_id: row.line_id,
        kind: row.kind, body: row.body, visibility: row.visibility,
        dispute_id: row.dispute_id || null,
        by: row.created_by_name || null, at: row.created_at,
        particulars: row.particulars || null,
        subject: row.manual_subject || row.auto_subject || null,
        chit_status: row.chit_status || null,
        open: !close && !orderClosed,
        /* ⭐ Three endings, not two: still running · somebody closed it · the order finished around it. */
        ending: close ? 'closed' : (orderClosed ? 'closed_by_order' : null),
        closed_at: close ? close.created_at : null,
        closed_by: close ? (close.created_by_name || null) : null,
        closed_note: close ? close.body : null,
      };
    });

    const byKind = {};
    for (const e of entries) {
      const k = (byKind[e.kind] = byKind[e.kind] || { kind: e.kind, open: 0, closed: 0, closed_by_order: 0 });
      if (e.open) k.open++; else if (e.ending === 'closed') k.closed++; else k.closed_by_order++;
    }
    return {
      entries, by_kind: Object.values(byKind), migrated: true,
      open: entries.filter((e) => e.open).length,
      closed: entries.filter((e) => e.ending === 'closed').length,
      /* ⚠️ Counted and NAMED separately on purpose — see the note above. This is the number worth looking at. */
      closed_by_order: entries.filter((e) => e.ending === 'closed_by_order').length,
    };
  } catch (e) { if (notMigrated(e)) return { entries: [], migrated: false }; throw e; }
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

module.exports = { list, add, close, linkDispute, report, KINDS, VISIBILITY };
