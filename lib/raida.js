'use strict';
/**
 * lib/raida.js — THE REGISTER. What we believe, fear, owe and must do about anything.
 *
 * Design: C:\dev\DESIGN-raida-and-cover.md §10 · migrations b182 (phase 0) and b185 (the capability).
 * Athi, 2026-08-30: *"it is a capability, not per entity and it should be attached anywhere"* and
 * *"what I am looking at is a proper closure, so we have an audit of what happened."*
 *
 * ── ⭐⭐ STATE IS COMPUTED, NEVER STORED ─────────────────────────────────────────────────────────────────────────
 * Three row shapes in one table, and nothing is ever UPDATEd:
 *   ENTRY     neither revises_id nor closes_id  — the thing itself
 *   REVISION  revises_id set                    — a field changed; what was believed before stays readable
 *   CLOSING   closes_id set                     — how it ended, with the disposition and the evidence
 * An entry is OPEN when nothing closes it. No status column, so nothing can drift out of step with the log, and
 * "what did we think on the 14th" survives the entry ceasing to be true.
 *
 * ⚠️ THE REVISION SHAPE IS WHY FIELDS COULD BE ADDED AT ALL. An owner or a severity UPDATEd in place destroys
 * what was believed at the time — the one thing this table exists to keep. Same chain as chit_line_assignment.
 *
 * ── ⚠️⚠️ TWO SCHEMAS, BECAUSE CODE DEPLOYS BEFORE THE MIGRATION RUNS ────────────────────────────────────────────
 * b185 renames chit_line_raida → register_entry and adds the capability. Between deploy and the migration being
 * run by hand, whichever table exists is the one that answers. The shape is resolved ONCE from `register_subject`:
 *   register_subject exists  →  b185 has run, full capability
 *   only the entry table     →  answer exactly as phase 0 did
 *   neither                  →  reads degrade to empty, writes refuse with the migration number
 *
 * ⚠️ ONE FLAG, NOT COLUMN-BY-COLUMN PROBING. Naming a column that does not exist raises 42703, which this file
 * turns into "not migrated" and a BLANK screen — the failure mode that takes longest to notice, and one that
 * already cost an afternoon on 2026-08-30.
 *
 * ⚠️⚠️ AND THE RENAME ITSELF IS A DEPLOY-ORDER HAZARD I WALKED INTO. b185 was applied while this file still said
 * `chit_line_raida`; every read answered `migrated:false` until the new code shipped. The register degraded
 * rather than erroring — which is the guard working — but a rename is the one migration where old code cannot
 * limp along, so it ships with its code or not at all.
 */
const { withEntity, onEntity } = require('../db');
const schema = require('./schema');
const reqctx = require('./reqctx');

const KINDS = ['risk', 'assumption', 'issue', 'dependency', 'action', 'decision'];
const VISIBILITY = ['internal', 'shared'];
/** ⭐ Six endings, not two — and only some of them are actions. The silent ones matter most. */
const DISPOSITIONS = ['resolved', 'action', 'carried_forward', 'accepted', 'constraint', 'waived'];
const VERIFICATION = ['test', 'analysis', 'inspection', 'demonstration'];
const REL_TYPES = ['finish_to_start', 'start_to_start', 'finish_to_finish', 'start_to_finish'];

/**
 * ⭐⭐ THE FOUR T's — the response CATEGORY, which is not the same thing as the treatment.
 *
 * `treatment` is free text: *"book the rig a week earlier"*. The category is what that decision IS, and it is
 * the column every risk report pivots on — "how much of this register are we simply tolerating" is a question
 * prose cannot answer. PRINCE2 and the UK-government risk guidance both use these four.
 *
 * ⚠️ FOR THREATS. PRINCE2's opportunity set is different (exploit · enhance · share · reject) and is NOT folded
 * in here: sharing an upside and transferring a downside are opposite decisions, and one list containing both
 * would let a register report them as the same thing.
 */
const RESPONSES = ['tolerate', 'treat', 'transfer', 'terminate'];

const notMigrated = (e) => e && (e.code === '42P01' || e.code === '42703');
const bad = (msg) => { const x = new Error(msg); x.status = 400; return x; };
const gone = (which) => {
  const x = new Error('The register is not migrated on this environment (' + (which || 'b182') + ').');
  x.status = 503; return x;
};

/**
 * Which shape this database is on. `full` means b185 has run; `resp` means b192 has.
 *
 * ⚠️ `resp` IS A COLUMN PROBE, and it has to be, because b192 adds a column to a table that already exists —
 * so no table test can tell the two apart. Naming `response` before b192 is run is a 42703, which throws the
 * WHOLE query rather than returning undefined.
 */
async function shape() {
  if (await schema.hasTable('register_subject')) {
    return { table: 'register_entry', full: true,
             resp: await schema.hasColumn('register_entry', 'response') };
  }
  if (await schema.hasTable('register_entry')) return { table: 'register_entry', full: false, resp: false };
  if (await schema.hasTable('chit_line_raida')) return { table: 'chit_line_raida', full: false, resp: false };
  return { table: null, full: false, resp: false };
}

/* ═══ SUBJECTS — a register attached to something ═════════════════════════════════════════════════════════════ */

/** What a register may hang off. A registry, so a new kind is an INSERT rather than a migration. */
async function attachables() {
  /**
   * ⚠️⚠️ AN EMPTY READ HERE HAS FOUR CAUSES AND THEY LOOK IDENTICAL. This function exists to tell them apart,
   * because each one sent someone down a different wrong path on 2026-08-30:
   *
   *   42P01  absent        the table is not there yet — the normal deploy-before-migration window
   *   42501  no-grant      it is there and this role may not read it
   *   0 rows + RLS         ⭐ RLS is ON with NO POLICY. Every non-owner gets zero rows, silently: no error, no
   *                        permission denied. The OWNER IS EXEMPT unless FORCE is set, so it reads perfectly in
   *                        the SQL editor as postgres and empty in the app as cb_app. A whole day went into
   *                        looking for a seed that had run all along.
   *   0 rows               genuinely unseeded
   *
   * ⚠️ NO hasTable() GUARD. It reads information_schema, which shows only what the role holds a privilege on,
   * so "never created" and "created but never granted" arrive as the same answer.
   */
  let rows;
  try {
    const r = await withEntity(null, (c) => c.query(
      `SELECT type_key, label, points_at FROM register_attachable WHERE active ORDER BY type_key`));
    rows = r.rows;
  } catch (e) {
    if (e.code === '42P01') return { attachables: [], degraded: 'absent' };
    if (e.code === '42501') return { attachables: [], degraded: 'no-grant' };
    throw e;
  }
  if (rows.length) return { attachables: rows, degraded: null };

  /* ⭐ Only on the empty path, so it costs nothing in the normal case: ask the catalog whether the rows were
     filtered away rather than never written. Reporting "empty" for an RLS problem is a wrong answer, not a
     missing one. */
  try {
    const d = await withEntity(null, (c) => c.query(
      `SELECT c.relrowsecurity AS rls,
              (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) AS policies
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = 'register_attachable'`));
    const row = d.rows[0];
    if (row && row.rls && Number(row.policies) === 0) return { attachables: [], degraded: 'rls-no-policy' };
  } catch (e) { /* the diagnosis is a courtesy — never let it turn an empty list into a 500 */ }
  return { attachables: [], degraded: 'empty' };
}

/**
 * Find or open the register for a thing.
 * ⚠️ GET-OR-CREATE, and the unique index is what makes it safe. Two people recording a finding on the same order
 * at the same moment would otherwise open two registers for it — two answers to one question.
 */
async function subjectFor(entity_id, opts, db) {
  const s = await shape();
  if (!s.full) throw gone('b185');
  const type_key = String(opts.type_key || 'chit');
  const ref_id = opts.ref_id || null;
  const name = String(opts.name || '').trim() || 'Register';
  return onEntity(entity_id, db, async (c) => {
    if (ref_id) {
      const found = await c.query(
        `SELECT subject_id, closed_at FROM register_subject
          WHERE entity_id = $1 AND type_key = $2 AND ref_id = $3`, [entity_id, type_key, ref_id]);
      if (found.rows.length) return found.rows[0];
    }
    const made = await c.query(
      `INSERT INTO register_subject (entity_id, type_key, ref_id, ref_label, name)
       VALUES ($1,$2,$3,$4,$5) RETURNING subject_id, closed_at`,
      [entity_id, type_key, ref_id, opts.ref_label || null, name]);
    return made.rows[0];
  });
}

async function listSubjects(entity_id, opts = {}) {
  const s = await shape();
  if (!s.full) return { subjects: [], migrated: false };
  const args = [entity_id];
  let where = '';
  if (opts.type_key) { args.push(opts.type_key); where += ` AND s.type_key = $${args.length}`; }
  if (opts.open_only) where += ' AND s.closed_at IS NULL';
  try {
    const r = await withEntity(entity_id, (c) => c.query(
      `SELECT s.subject_id, s.type_key, s.ref_id, s.ref_label, s.name,
              s.opened_at, s.closed_at, s.closed_by_name,
              /* ⚠️ Counted here, not by the caller: "12 open" and the list of 12 must come from ONE query, or a
                 screen can show a count that disagrees with what is underneath it. */
              (SELECT count(*) FROM register_entry e
                WHERE e.entity_id = s.entity_id AND e.subject_id = s.subject_id
                  AND e.closes_id IS NULL AND e.revises_id IS NULL
                  AND NOT EXISTS (SELECT 1 FROM register_entry c2
                                   WHERE c2.entity_id = e.entity_id AND c2.closes_id = e.raida_id)) AS open_count
         FROM register_subject s
        WHERE s.entity_id = $1${where}
        ORDER BY s.closed_at NULLS FIRST, s.opened_at DESC`, args));
    return { subjects: r.rows, migrated: true };
  } catch (e) { if (notMigrated(e)) return { subjects: [], migrated: false }; throw e; }
}

/**
 * ⭐⭐ THE CLOSURE GATE — step 1 of the design, and the cheapest thing on the whole list.
 *
 * *A subject may not close while any entry is undispositioned.* One rule, no new field, and it is what a Test
 * Readiness Review, a Flight Readiness Review and a discrepancy board exist to enforce. Without it a register is
 * a place to write things down; with it, it is a gate.
 *
 * ⚠️ THE REFUSAL NAMES WHAT IS OUTSTANDING. "Cannot close: 4 open" sends someone hunting; the four, with their
 * kinds and their words, is the difference between a rule people work with and one they route around.
 */
async function closeSubject(entity_id, subject_id, opts = {}) {
  const s = await shape();
  if (!s.full) throw gone('b185');
  try {
    return await withEntity(entity_id, async (c) => {
      const subj = await c.query(
        `SELECT subject_id, name, closed_at FROM register_subject
          WHERE entity_id = $1 AND subject_id = $2`, [entity_id, subject_id]);
      if (!subj.rows.length) throw bad('No such register.');
      if (subj.rows[0].closed_at) throw bad('That register is already closed.');

      const outstanding = await c.query(
        `SELECT e.raida_id, e.kind, e.body
           FROM register_entry e
          WHERE e.entity_id = $1 AND e.subject_id = $2
            AND e.closes_id IS NULL AND e.revises_id IS NULL
            AND NOT EXISTS (SELECT 1 FROM register_entry c2
                             WHERE c2.entity_id = e.entity_id AND c2.closes_id = e.raida_id)
          ORDER BY e.created_at`, [entity_id, subject_id]);

      if (outstanding.rows.length) {
        const n = outstanding.rows.length;
        const err = new Error(n + ' entr' + (n === 1 ? 'y is' : 'ies are')
          + ' still open. Every one needs an ending before this can close.');
        err.status = 409;
        err.outstanding = outstanding.rows.map((x) => ({ raida_id: x.raida_id, kind: x.kind, body: x.body }));
        throw err;
      }

      const done = await c.query(
        `UPDATE register_subject
            SET closed_at = now(), closed_by_actor_id = $3, closed_by_name = $4
          WHERE entity_id = $1 AND subject_id = $2
        RETURNING subject_id, closed_at`,
        [entity_id, subject_id, reqctx.currentActor() || null, opts.by_name || null]);
      return { closed: done.rows[0].subject_id, at: done.rows[0].closed_at, migrated: true };
    });
  } catch (e) { if (e.status) throw e; if (notMigrated(e)) throw gone('b185'); throw e; }
}

/* ═══ ENTRIES ═════════════════════════════════════════════════════════════════════════════════════════════════ */

/** Columns that exist only after b185 — named in ONE place so the two shapes cannot drift apart. */
const FULL_COLS = `a.subject_id, a.template_id, a.owner_actor_id, a.owner_name, a.due_date::text AS due_date,
       a.review_date::text AS review_date, a.likelihood, a.severity, a.treatment, a.verification_method,
       a.residual_likelihood, a.residual_severity, a.rel_type, a.to_type, a.to_id, a.to_label,
       a.needed_by::text AS needed_by, a.disposition, a.carried_to_subject_id, a.evidence_ref, a.evidence_hash,
       a.revises_id,`;

/**
 * Read a register.
 * ⚠️ `line_id` HAS THREE MEANINGS and conflating them is the easy mistake:
 *   undefined → everything on this subject · a uuid → that line PLUS what it inherits · null → subject-level only
 */
async function list(entity_id, chit_id, line_id, db, opts = {}) {
  const s = await shape();
  if (!s.table) return { entries: [], migrated: false };
  try {
    const args = [entity_id];
    let where = '';
    if (opts.subject_id) { args.push(opts.subject_id); where += ` AND a.subject_id = $${args.length}`; }
    else { args.push(chit_id); where += ` AND a.chit_id = $${args.length}`; }
    if (line_id === null) where += ' AND a.line_id IS NULL';
    else if (line_id !== undefined) { args.push(line_id); where += ` AND (a.line_id = $${args.length} OR a.line_id IS NULL)`; }

    const r = await onEntity(entity_id, db, (c) => c.query(
      `SELECT a.raida_id, a.line_id, a.kind, a.body, a.closes_id, a.visibility, a.dispute_id,
              ${s.full ? FULL_COLS : ''}${s.resp ? ' a.response,' : ''}
              a.created_by_actor_id, a.created_by_name, a.created_at
         FROM ${s.table} a
        WHERE a.entity_id = $1${where}
        ORDER BY a.created_at`, args));

    return Object.assign(fold(r.rows, line_id, s.full), { migrated: true, full: s.full });
  } catch (e) { if (notMigrated(e)) return { entries: [], migrated: false }; throw e; }
}

/**
 * ⭐ THE ONLY DERIVATION IN THE FILE, and everything readable about an entry comes out of it.
 * A closing row is not an entry — it is the ending of one. A revision is not an entry either — it is a later
 * version of one. Both fold onto the row they point at, so "3 open" stays honest with no status column to
 * disagree with.
 */
function fold(rows, line_id, full) {
  const closedBy = new Map(), revisions = new Map();
  for (const row of rows) {
    if (row.closes_id) closedBy.set(row.closes_id, row);
    /* ⚠️ LATEST WINS — they arrive in created_at order, the same rule the assignment chain uses. */
    else if (full && row.revises_id) revisions.set(row.revises_id, row);
  }
  const entries = rows.filter((row) => !row.closes_id && !(full && row.revises_id)).map((row) => {
    const close = closedBy.get(row.raida_id) || null;
    const rev = revisions.get(row.raida_id) || null;
    /* A revision supplies what it carries; anything it leaves null keeps the original. */
    const v = (k) => (rev && rev[k] != null ? rev[k] : row[k]);
    const out = {
      raida_id: row.raida_id,
      line_id: row.line_id,
      scope: row.line_id ? 'line' : 'subject',
      inherited: !!(line_id && !row.line_id),
      kind: row.kind,
      body: v('body'),
      visibility: v('visibility'),
      dispute_id: row.dispute_id || null,
      by: row.created_by_name || null,
      at: row.created_at,
      revised: !!rev,
      open: !close,
      closed_at: close ? close.created_at : null,
      closed_by: close ? (close.created_by_name || null) : null,
      closed_note: close ? close.body : null,
      /* ⚠️ Six endings. `resolved` and `accepted` are both "closed" and are not the same fact. */
      disposition: close ? (close.disposition || null) : null,
    };
    if (full) Object.assign(out, {
      subject_id: row.subject_id, template_id: row.template_id,
      owner: v('owner_name'), owner_actor_id: v('owner_actor_id'),
      due_date: v('due_date'), review_date: v('review_date'),
      likelihood: v('likelihood'), severity: v('severity'),
      score: (v('likelihood') && v('severity')) ? v('likelihood') * v('severity') : null,
      treatment: v('treatment'), verification_method: v('verification_method'),
      residual_likelihood: v('residual_likelihood'), residual_severity: v('residual_severity'),
      residual_score: (v('residual_likelihood') && v('residual_severity'))
        ? v('residual_likelihood') * v('residual_severity') : null,
      /* ⭐⭐ THE EDGE. A dependency that points can be walked; one that does not is a sentence. */
      edge: row.to_id ? { rel_type: row.rel_type || 'finish_to_start', to_type: row.to_type,
                          to_id: row.to_id, to_label: row.to_label, needed_by: row.needed_by } : null,
      carried_to_subject_id: close ? close.carried_to_subject_id : null,
      evidence: close && close.evidence_ref ? { ref: close.evidence_ref, hash: close.evidence_hash } : null,
    });
    return out;
  });
  const open = entries.filter((e) => e.open).length;
  return { entries, open, closed: entries.length - open };
}

/**
 * Record one finding.
 * ⭐ `template_id` COPIES, it does not link. If an instance read its wording and its standards THROUGH the
 * library, editing the library would silently rewrite what an audit was told last year. Snapshot, never join —
 * the same discipline as every other record here.
 */
async function add(entity_id, chit_id, opts = {}) {
  const s = await shape();
  if (!s.table) throw gone('b182');
  const kind = String(opts.kind || '').trim().toLowerCase();
  if (KINDS.indexOf(kind) < 0) throw bad('kind must be one of: ' + KINDS.join(', '));
  const visibility = VISIBILITY.indexOf(opts.visibility) >= 0 ? opts.visibility : 'internal';
  const line_id = opts.line_id || null;

  if (!s.full) {
    /* Phase-0 shape: the fields below do not exist yet. Answer exactly as b182 did. */
    const body0 = String(opts.body == null ? '' : opts.body).trim();
    if (!body0) throw bad('An entry needs to say something.');
    try {
      const r = await onEntity(entity_id, opts.db, (c) => c.query(
        `INSERT INTO ${s.table} (entity_id, chit_id, line_id, kind, body, visibility,
                                 created_by_actor_id, created_by_name)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING raida_id, created_at`,
        [entity_id, chit_id, line_id, kind, body0, visibility,
         reqctx.currentActor() || null, opts.by_name || null]));
      return { raida_id: r.rows[0].raida_id, at: r.rows[0].created_at, kind, migrated: true, full: false };
    } catch (e) { if (notMigrated(e)) throw gone('b182'); throw e; }
  }

  const num = (val, what) => {
    if (val == null || val === '') return null;
    const n = Number(val);
    if (!Number.isInteger(n) || n < 1 || n > 5) throw bad(what + ' must be a whole number from 1 to 5.');
    return n;
  };
  if (opts.verification_method && VERIFICATION.indexOf(opts.verification_method) < 0) {
    throw bad('verification must be one of: ' + VERIFICATION.join(', '));
  }
  /* ⭐ The response CATEGORY, validated like every other closed list here. Free text would defeat the point:
     the column exists to be grouped on. */
  if (opts.response && RESPONSES.indexOf(String(opts.response)) < 0) {
    throw bad('response must be one of: ' + RESPONSES.join(', '));
  }
  if (opts.rel_type && REL_TYPES.indexOf(opts.rel_type) < 0) {
    throw bad('rel_type must be one of: ' + REL_TYPES.join(', '));
  }
  const rel = opts.rel_type || (opts.to_id ? 'finish_to_start' : null);

  try {
    return await onEntity(entity_id, opts.db, async (c) => {
      let body = String(opts.body == null ? '' : opts.body).trim();
      let likelihood = num(opts.likelihood, 'likelihood');
      let severity = num(opts.severity, 'severity');
      let treatment = opts.treatment || null;
      let vm = opts.verification_method || null;
      let stds = [];

      if (opts.template_id) {
        const t = await c.query(
          `SELECT title, body, likelihood, severity, treatment, verification_method
             FROM register_template WHERE entity_id = $1 AND template_id = $2 AND active`,
          [entity_id, opts.template_id]);
        if (!t.rows.length) throw bad('No such library entry.');
        const T = t.rows[0];
        /* The instance wins where it says something; the library fills the rest. */
        if (!body) body = T.body || T.title;
        if (likelihood == null) likelihood = T.likelihood;
        if (severity == null) severity = T.severity;
        if (!treatment) treatment = T.treatment;
        if (!vm) vm = T.verification_method;
        const ts = await c.query(
          `SELECT standard_key, clause FROM register_template_standard
            WHERE entity_id = $1 AND template_id = $2`, [entity_id, opts.template_id]);
        stds = ts.rows;
      }
      if (!body) throw bad('An entry needs to say something.');

      /**
       * Every entry belongs to a subject. A chit gets one on first use rather than being asked for.
       *
       * ⭐⭐ AND IT IS NAMED AFTER THE ORDER, not "Order". A risk raised on a task lands in a register created
       * for its chit — so with the literal default, a business running ten orders had ten registers all called
       * the same thing and the rail became unreadable at exactly the point it started being useful.
       *
       * ⚠️ ONE EXTRA READ, AND ONLY ON FIRST USE. subjectFor is get-or-create; once the register exists this
       * branch never runs again for that chit.
       */
      let subject_id = opts.subject_id || null;
      if (!subject_id) {
        let name = opts.subject_name || null;
        if (!name && chit_id) {
          const h = await c.query(
            `SELECT manual_subject, auto_subject FROM chit_header
              WHERE entity_id = $1 AND chit_id = $2 LIMIT 1`, [entity_id, chit_id]);
          const H = h.rows[0] || {};
          name = H.manual_subject || H.auto_subject || null;
        }
        const subj = await subjectFor(entity_id, {
          type_key: opts.type_key || 'chit', ref_id: chit_id,
          name: name || 'Order', ref_label: name || null }, c);
        subject_id = subj.subject_id;
        /* ⚠️ A closed register does not take new findings — that is what closing it MEANT. */
        if (subj.closed_at) throw bad('That register is closed. Reopen it, or attach this to another one.');
      }

      const r = await c.query(
        `INSERT INTO register_entry
           (entity_id, chit_id, line_id, subject_id, template_id, kind, body, visibility,
            owner_actor_id, owner_name, due_date, review_date,
            likelihood, severity, treatment, verification_method,
            rel_type, to_type, to_id, to_label, needed_by,
            created_by_actor_id, created_by_name${s.resp ? ', response' : ''})
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23${s.resp ? ',$24' : ''})
         RETURNING raida_id, created_at`,
        [entity_id, chit_id, line_id, subject_id, opts.template_id || null, kind, body, visibility,
         opts.owner_actor_id || null, opts.owner_name || null, opts.due_date || null, opts.review_date || null,
         likelihood, severity, treatment, vm,
         rel, opts.to_type || null, opts.to_id || null, opts.to_label || null, opts.needed_by || null,
         reqctx.currentActor() || null, opts.by_name || null]
          /* ⚠️ Appended, never interleaved — a value in the wrong position is a silent data swap, not an error. */
          .concat(s.resp ? [opts.response || null] : []));

      const raida_id = r.rows[0].raida_id;
      /* Standards from the library, copied — plus anything named on the instance itself. */
      const all = stds.concat((opts.standards || []).map((x) => (typeof x === 'string'
        ? { standard_key: x, clause: '' }
        : { standard_key: x.standard_key, clause: x.clause || '' })));
      /* ⚠️ ONE STATEMENT, NOT ONE PER MAPPING. A loop of INSERTs here is an N+1 — and query-shape.test.cjs
         caught it before this shipped. A library entry answering to six clauses of three standards would have
         been eighteen round trips at ~250ms each, inside the transaction that raises the finding. UNNEST takes
         the same rows in one. */
      const keys = all.filter((x) => x.standard_key).map((x) => x.standard_key);
      if (keys.length) {
        await c.query(
          `INSERT INTO register_entry_standard (entity_id, entry_id, standard_key, clause)
           SELECT $1, $2, k, cl FROM unnest($3::text[], $4::text[]) AS t(k, cl)
           ON CONFLICT DO NOTHING`,
          [entity_id, raida_id, keys, all.filter((x) => x.standard_key).map((x) => x.clause || '')]);
      }
      return { raida_id, at: r.rows[0].created_at, kind, subject_id,
               standards: all.length, migrated: true, full: true };
    });
  } catch (e) { if (e.status) throw e; if (notMigrated(e)) throw gone('b185'); throw e; }
}

/**
 * Change a field without destroying what it said before.
 * ⚠️ AN APPENDED ROW, NOT AN UPDATE. Reassignment is normal, and who held it when something went wrong is the
 * question afterwards. A revision carries only what changed; reads fold the latest over the original.
 */
async function revise(entity_id, raida_id, fields = {}) {
  const s = await shape();
  if (!s.full) throw gone('b185');
  const allowed = ['body', 'owner_actor_id', 'owner_name', 'due_date', 'review_date',
                   'likelihood', 'severity', 'treatment', 'verification_method',
                   'residual_likelihood', 'residual_severity', 'visibility'];
  /* ⭐ The response category is revisable too, once the column exists. Settable at creation and never
     changeable afterwards would be the wrong half: a register is where a decision gets REVISITED. */
  if (s.resp) allowed.push('response');
  if (fields.response && RESPONSES.indexOf(String(fields.response)) < 0) {
    throw bad('response must be one of: ' + RESPONSES.join(', '));
  }
  const given = allowed.filter((k) => fields[k] != null && fields[k] !== '');
  if (!given.length) throw bad('Nothing to change.');
  try {
    return await withEntity(entity_id, async (c) => {
      const t = await c.query(
        `SELECT chit_id, line_id, subject_id, kind, closes_id, body FROM register_entry
          WHERE entity_id = $1 AND raida_id = $2`, [entity_id, raida_id]);
      if (!t.rows.length) throw bad('No such entry.');
      if (t.rows[0].closes_id) throw bad('That row is a closing row — it cannot be revised.');
      const shut = await c.query(
        `SELECT 1 FROM register_entry WHERE entity_id = $1 AND closes_id = $2 LIMIT 1`, [entity_id, raida_id]);
      if (shut.rows.length) throw bad('That entry is closed. Reopening is not a revision.');

      const E = t.rows[0];
      const cols = ['entity_id', 'chit_id', 'line_id', 'subject_id', 'kind', 'body', 'revises_id',
                    'created_by_actor_id', 'created_by_name'];
      const vals = [entity_id, E.chit_id, E.line_id, E.subject_id, E.kind,
                    /* ⚠️⚠️ THE ORIGINAL BODY WHEN IT IS NOT WHAT CHANGED. This was '(revised)', and reads fold
                       the latest revision over the original — so revising an OWNER renamed the entry to
                       "(revised)" and the description was gone from every view. body is NOT NULL, so the row
                       must carry something; carrying what it already said is the only harmless answer. */
                    fields.body || E.body, raida_id, reqctx.currentActor() || null, fields.by_name || null];
      for (const k of given) {
        if (k === 'body') continue;
        cols.push(k); vals.push(fields[k]);
      }
      const ph = vals.map((_, i) => '$' + (i + 1)).join(',');
      const r = await c.query(
        `INSERT INTO register_entry (${cols.join(',')}) VALUES (${ph}) RETURNING raida_id, created_at`, vals);
      return { revised: raida_id, revision: r.rows[0].raida_id, changed: given, migrated: true };
    });
  } catch (e) { if (e.status) throw e; if (notMigrated(e)) throw gone('b185'); throw e; }
}

/**
 * End an entry by APPENDING the row that ends it.
 * ⭐⭐ THE DISPOSITION IS THE POINT. "Resolved" and "accepted" are both closed and are not the same fact: one is
 * fixed, the other is a residual risk somebody is carrying. A boolean cannot tell them apart, and at the end of a
 * campaign the difference between them is the entire audit.
 */
async function close(entity_id, chit_id, raida_id, opts = {}) {
  const s = await shape();
  if (!s.table) throw gone('b182');
  const body = String(opts.body == null ? '' : opts.body).trim() || 'Closed.';
  if (opts.disposition && DISPOSITIONS.indexOf(opts.disposition) < 0) {
    throw bad('disposition must be one of: ' + DISPOSITIONS.join(', '));
  }
  const disposition = opts.disposition || null;
  if (s.full && !disposition) throw bad('An ending needs a disposition: ' + DISPOSITIONS.join(', '));

  try {
    return await withEntity(entity_id, async (c) => {
      const t = await c.query(
        `SELECT kind, line_id, closes_id${s.full ? ', subject_id, chit_id' : ''} FROM ${s.table}
          WHERE entity_id = $1 AND raida_id = $2`, [entity_id, raida_id]);
      if (!t.rows.length) throw bad('No such entry.');
      if (t.rows[0].closes_id) throw bad('That row is itself a closing row — it cannot be closed.');
      const already = await c.query(
        `SELECT 1 FROM ${s.table} WHERE entity_id = $1 AND closes_id = $2 LIMIT 1`, [entity_id, raida_id]);
      /* Idempotent by refusal, not by silence: a second closing row gives one entry two endings. */
      if (already.rows.length) throw bad('That entry is already closed.');
      const E = t.rows[0];

      if (!s.full) {
        const r = await c.query(
          `INSERT INTO ${s.table} (entity_id, chit_id, line_id, kind, body, closes_id,
                                   created_by_actor_id, created_by_name)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING raida_id, created_at`,
          [entity_id, chit_id, E.line_id, E.kind, body, raida_id,
           reqctx.currentActor() || null, opts.by_name || null]);
        return { closed: raida_id, closing_row: r.rows[0].raida_id, at: r.rows[0].created_at, migrated: true };
      }

      /* ⚠️ CARRIED FORWARD MUST NAME WHERE TO. "We will deal with it later" without a later is how a finding
         disappears while looking dispositioned. */
      if (disposition === 'carried_forward' && !opts.carried_to_subject_id) {
        throw bad('Carrying it forward needs the register it moves to.');
      }
      const r = await c.query(
        `INSERT INTO register_entry (entity_id, chit_id, line_id, subject_id, kind, body, closes_id,
                                     disposition, carried_to_subject_id, evidence_ref, evidence_hash,
                                     created_by_actor_id, created_by_name)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING raida_id, created_at`,
        [entity_id, E.chit_id, E.line_id, E.subject_id, E.kind, body, raida_id,
         disposition, opts.carried_to_subject_id || null, opts.evidence_ref || null, opts.evidence_hash || null,
         reqctx.currentActor() || null, opts.by_name || null]);
      return { closed: raida_id, closing_row: r.rows[0].raida_id, disposition,
               at: r.rows[0].created_at, migrated: true };
    });
  } catch (e) { if (e.status) throw e; if (notMigrated(e)) throw gone('b182'); throw e; }
}

/**
 * ⭐⭐ ACCEPT A RESIDUAL RISK — a signature, which is why it is a row of its own and not a column.
 * MIL-STD-882 makes the signature level a function of the Risk Assessment Code. "Nobody answered it" and "the
 * chief engineer accepted it on the 14th" are different facts, and only the second is a closure anyone can audit.
 * ⚠️ AND A REVIEW DATE, because an accepted risk that is never revisited is a forgotten one — the shape that
 * kills, since nothing else will ever raise it again.
 */
async function accept(entity_id, raida_id, opts = {}) {
  const s = await shape();
  if (!s.full) throw gone('b185');
  const who = String(opts.accepted_by_name || '').trim();
  if (!who) throw bad('An acceptance needs the name of the person accepting it.');
  try {
    return await withEntity(entity_id, async (c) => {
      const t = await c.query(
        `SELECT severity FROM register_entry WHERE entity_id = $1 AND raida_id = $2`, [entity_id, raida_id]);
      if (!t.rows.length) throw bad('No such entry.');
      const r = await c.query(
        `INSERT INTO register_acceptance
           (entity_id, entry_id, accepted_by_actor_id, accepted_by_name, authority_level, rationale, review_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING acceptance_id, accepted_at`,
        [entity_id, raida_id, opts.accepted_by_actor_id || reqctx.currentActor() || null, who,
         opts.authority_level || null, opts.rationale || null, opts.review_by || null]);
      return { acceptance_id: r.rows[0].acceptance_id, at: r.rows[0].accepted_at,
               entry_severity: t.rows[0].severity, migrated: true };
    });
  } catch (e) { if (e.status) throw e; if (notMigrated(e)) throw gone('b185'); throw e; }
}

/**
 * Record that an issue was escalated through the EXISTING dispute path.
 * ⚠️ THIS RAISES NOTHING — Athi: *"just call the dispute here."* Reimplementing any part of that lifecycle would
 * be a second answer to a question that already has one.
 */
async function linkDispute(entity_id, chit_id, raida_id, dispute_id) {
  const s = await shape();
  if (!s.table) throw gone('b182');
  if (!dispute_id) throw bad('A dispute id is required.');
  try {
    const r = await withEntity(entity_id, (c) => c.query(
      `UPDATE ${s.table} SET dispute_id = $3
        WHERE entity_id = $1 AND raida_id = $2 AND kind = 'issue' RETURNING raida_id`,
      [entity_id, raida_id, dispute_id]));
    /* Only an ISSUE escalates. A risk that has not happened has nothing to dispute about. */
    if (!r.rows.length) throw bad('No issue with that id.');
    return { raida_id, dispute_id, migrated: true };
  } catch (e) { if (e.status) throw e; if (notMigrated(e)) throw gone('b182'); throw e; }
}

/* ═══ THE ROLL-UP ═════════════════════════════════════════════════════════════════════════════════════════════ */

const CLOSED_SUBJECT = ['completed', 'cancelled', 'rejected'];

/**
 * ⭐⭐ EVERY ENTRY THIS ENTITY HOLDS, ACROSS EVERYTHING. Athi: *"see all the open and closed stuff in a single
 * place."* Filterable by subject and — the point of the standards mapping — **by standard**, so ISO 9001 and
 * ISO 27001 are two READINGS of one set of facts rather than two registers kept in step by hand.
 *
 * ⭐⭐ AND THE CLOSURE RULE, DERIVED NEVER WRITTEN: *"if the chit is closed all are closed."* Inserting closing
 * rows for everything on a closed subject would put a name and a time against an ending nobody chose.
 *
 * ⚠️ THE TWO ENDINGS STAY APART. `closed` means somebody ended it and said how; `closed_by_order` means the
 * subject finished while nobody ever answered it — unresolved, not resolved. Summing them would flatter the
 * register at the one moment it must not.
 */
async function report(entity_id, opts = {}) {
  const s = await shape();
  if (!s.table) return { entries: [], migrated: false };
  try {
    const args = [entity_id];
    let where = '', join = '';
    if (s.full && opts.subject_id) { args.push(opts.subject_id); where += ` AND a.subject_id = ${args.length}`; }
    if (s.full && opts.standard_key) {
      args.push(opts.standard_key);
      join += ` JOIN register_entry_standard es
                  ON es.entity_id = a.entity_id AND es.entry_id = a.raida_id AND es.standard_key = ${args.length}`;
    }

    const r = await withEntity(entity_id, (c) => c.query(
      `SELECT DISTINCT a.raida_id, a.chit_id, a.line_id, a.kind, a.body, a.closes_id, a.visibility, a.dispute_id,
              ${s.full ? FULL_COLS : ''}${s.resp ? ' a.response,' : ''}
              a.created_by_name, a.created_at,
              l.particulars,
              h.manual_subject, h.auto_subject,
              st.current_status AS chit_status
              ${s.full ? ', sub.name AS subject_name, sub.type_key, sub.closed_at AS subject_closed_at' : ''}
         FROM ${s.table} a${join}
         ${s.full ? 'LEFT JOIN register_subject sub ON sub.entity_id = a.entity_id AND sub.subject_id = a.subject_id' : ''}
         LEFT JOIN chit_line l
                ON l.entity_id = $1 AND l.chit_id = a.chit_id AND l.line_id = a.line_id
         /* ⚠️ LATERAL + LIMIT 1 — chit_header has no unique constraint on (entity_id, chit_id): a self-chit holds
            two rows for one entity, and a plain join would double every entry. */
         LEFT JOIN LATERAL (
           SELECT manual_subject, auto_subject FROM chit_header
            WHERE entity_id = $1 AND chit_id = a.chit_id LIMIT 1
         ) h ON true
         LEFT JOIN LATERAL (
           SELECT current_status FROM chit_status
            WHERE entity_id = $1 AND chit_id = a.chit_id AND deleted_at IS NULL
            ORDER BY updated_at DESC NULLS LAST LIMIT 1
         ) st ON true
        WHERE a.entity_id = $1${where}
        ORDER BY a.created_at DESC`, args));

    const closedBy = new Map(), revisions = new Map();
    for (const row of r.rows) {
      if (row.closes_id) closedBy.set(row.closes_id, row);
      else if (s.full && row.revises_id) revisions.set(row.revises_id, row);
    }

    const entries = r.rows.filter((row) => !row.closes_id && !(s.full && row.revises_id)).map((row) => {
      const close = closedBy.get(row.raida_id) || null;
      const rev = revisions.get(row.raida_id) || null;
      const v = (k) => (rev && rev[k] != null ? rev[k] : row[k]);
      /* A subject closes explicitly (b185) or, for a chit-backed one, when the order does. */
      const subjectClosed = (s.full && row.subject_closed_at)
        || CLOSED_SUBJECT.indexOf(String(row.chit_status || '')) >= 0;
      const out = {
        raida_id: row.raida_id, chit_id: row.chit_id, line_id: row.line_id,
        kind: row.kind, body: v('body'), visibility: v('visibility'),
        dispute_id: row.dispute_id || null,
        by: row.created_by_name || null, at: row.created_at,
        particulars: row.particulars || null,
        subject: (s.full && row.subject_name) || row.manual_subject || row.auto_subject || null,
        chit_status: row.chit_status || null,
        open: !close && !subjectClosed,
        /* ⭐ Three endings, not two: still running · somebody ended it · the subject finished around it. */
        ending: close ? 'closed' : (subjectClosed ? 'closed_by_order' : null),
        disposition: close ? (close.disposition || null) : null,
        closed_at: close ? close.created_at : null,
        closed_by: close ? (close.created_by_name || null) : null,
        closed_note: close ? close.body : null,
      };
      if (s.full) Object.assign(out, {
        subject_id: row.subject_id, type_key: row.type_key, template_id: row.template_id,
        owner: v('owner_name'), due_date: v('due_date'), review_date: v('review_date'),
        likelihood: v('likelihood'), severity: v('severity'),
        score: (v('likelihood') && v('severity')) ? v('likelihood') * v('severity') : null,
        /* ⭐ THE REGISTER TABLE NEEDS THE WHOLE ROW. FULL_COLS has selected these since b185 and report() threw
           them away — so the roll-up could show a score but never the treatment that was supposed to move it,
           which is the column an auditor actually reads. Inherent and residual are kept as SEPARATE numbers,
           not just the product: a 2x5 and a 5x2 score the same and mean completely different things. */
        treatment: v('treatment'), verification_method: v('verification_method'),
        response: s.resp ? v('response') : null,
        residual_likelihood: v('residual_likelihood'), residual_severity: v('residual_severity'),
        residual_score: (v('residual_likelihood') && v('residual_severity'))
          ? v('residual_likelihood') * v('residual_severity') : null,
        edge: row.to_id ? { rel_type: row.rel_type, to_type: row.to_type, to_id: row.to_id,
                            to_label: row.to_label, needed_by: row.needed_by } : null,
        evidence: close && close.evidence_ref ? { ref: close.evidence_ref, hash: close.evidence_hash } : null,
      });
      return out;
    });

    const byKind = {};
    for (const e of entries) {
      const k = (byKind[e.kind] = byKind[e.kind] || { kind: e.kind, open: 0, closed: 0, closed_by_order: 0 });
      if (e.open) k.open++; else if (e.ending === 'closed') k.closed++; else k.closed_by_order++;
    }
    /* ⭐ The closure statement's spine: what happened to everything, named. */
    const byDisposition = {};
    if (s.full) for (const e of entries) {
      if (!e.disposition) continue;
      byDisposition[e.disposition] = (byDisposition[e.disposition] || 0) + 1;
    }

    return {
      entries, by_kind: Object.values(byKind), by_disposition: byDisposition,
      /* ⚠️ resp is REPORTED, not inferred. The UI must not offer a field the database cannot store, and
         it cannot tell from an all-null column whether b192 has run or nobody has answered it yet. */
      migrated: true, full: s.full, resp: !!s.resp,
      open: entries.filter((e) => e.open).length,
      closed: entries.filter((e) => e.ending === 'closed').length,
      /* ⚠️ Named separately on purpose. This is the number worth looking at — nobody answered these. */
      closed_by_order: entries.filter((e) => e.ending === 'closed_by_order').length,
    };
  } catch (e) { if (notMigrated(e)) return { entries: [], migrated: false }; throw e; }
}

/**
 * ⭐⭐ THE WALK — what this breaks, or what broke it.
 *
 * Every dependency entry that POINTS is an edge; the walk is the impact. Runs in both directions and
 * **backwards is the one people need**, because it is the question asked after something has already gone wrong.
 *
 * ⚠️ DEPTH-BOUNDED AND CYCLE-GUARDED. A register is written by people, so "A waits on B waits on A" WILL be
 * recorded eventually — it is a true statement about a deadlock, not bad data — and a walk that trusted the
 * graph to be acyclic would hang the request rather than report the loop.
 */
async function walk(entity_id, from, opts = {}) {
  const s = await shape();
  if (!s.full) return { hops: [], migrated: false };
  const maxDepth = Math.min(Number(opts.depth) || 6, 12);
  const back = !!opts.backwards;
  try {
    const r = await withEntity(entity_id, (c) => c.query(
      `SELECT raida_id, kind, body, line_id, subject_id, rel_type, to_type, to_id, to_label,
              needed_by::text AS needed_by, owner_name, severity
         FROM register_entry
        WHERE entity_id = $1 AND to_id IS NOT NULL AND closes_id IS NULL AND revises_id IS NULL`, [entity_id]));

    /* forward: what waits ON this thing. backwards: what this thing waits on. */
    const byTarget = new Map(), bySource = new Map();
    for (const e of r.rows) {
      if (!byTarget.has(String(e.to_id))) byTarget.set(String(e.to_id), []);
      byTarget.get(String(e.to_id)).push(e);
      const src = String(e.line_id || e.subject_id || '');
      if (!bySource.has(src)) bySource.set(src, []);
      bySource.get(src).push(e);
    }

    const seen = new Set();
    const hops = [];
    let frontier = [String(from)];
    for (let d = 0; d < maxDepth && frontier.length; d++) {
      const next = [];
      for (const node of frontier) {
        const edges = back ? (bySource.get(node) || []) : (byTarget.get(node) || []);
        for (const e of edges) {
          if (seen.has(e.raida_id)) continue;      /* the cycle guard */
          seen.add(e.raida_id);
          hops.push({ depth: d, raida_id: e.raida_id, kind: e.kind, body: e.body,
                      rel_type: e.rel_type, to_type: e.to_type, to_id: e.to_id, to_label: e.to_label,
                      needed_by: e.needed_by, owner: e.owner_name, severity: e.severity });
          next.push(String(back ? e.to_id : (e.line_id || e.subject_id || '')));
        }
      }
      frontier = next;
    }
    return { hops, depth_reached: hops.length ? Math.max(...hops.map((h) => h.depth)) + 1 : 0,
             truncated: hops.length > 0 && frontier.length > 0, backwards: back, migrated: true };
  } catch (e) { if (notMigrated(e)) return { hops: [], migrated: false }; throw e; }
}

/* ═══ THE LIBRARY — the same risk, everywhere, worded slightly differently ═════════════════════════════════════ */

async function templates(entity_id) {
  if (!(await schema.hasTable('register_template'))) return { templates: [], migrated: false };
  try {
    const r = await withEntity(entity_id, (c) => c.query(
      `SELECT t.template_id, t.kind, t.title, t.body, t.likelihood, t.severity, t.treatment,
              t.verification_method, t.applies_to,
              /* ⭐ THE OUTSIDE VIEW, FOR FREE. Once a risk is a template, "raised 40 times, closed 31" is a
                 plain count — and a register that cannot say that is a filing cabinet. */
              (SELECT count(*) FROM register_entry e
                WHERE e.entity_id = t.entity_id AND e.template_id = t.template_id
                  AND e.closes_id IS NULL AND e.revises_id IS NULL) AS raised,
              (SELECT count(*) FROM register_entry e
                 JOIN register_entry c2 ON c2.entity_id = e.entity_id AND c2.closes_id = e.raida_id
                WHERE e.entity_id = t.entity_id AND e.template_id = t.template_id) AS closed,
              (SELECT array_agg(DISTINCT ts.standard_key) FROM register_template_standard ts
                WHERE ts.entity_id = t.entity_id AND ts.template_id = t.template_id) AS standards
         FROM register_template t
        WHERE t.entity_id = $1 AND t.active
        ORDER BY t.kind, t.title`, [entity_id]));
    return { templates: r.rows, migrated: true };
  } catch (e) { if (notMigrated(e)) return { templates: [], migrated: false }; throw e; }
}

async function addTemplate(entity_id, opts = {}) {
  if (!(await schema.hasTable('register_template'))) throw gone('b185');
  const kind = String(opts.kind || '').trim().toLowerCase();
  if (KINDS.indexOf(kind) < 0) throw bad('kind must be one of: ' + KINDS.join(', '));
  const title = String(opts.title || '').trim();
  if (!title) throw bad('A library entry needs a short title.');
  try {
    return await withEntity(entity_id, async (c) => {
      const r = await c.query(
        `INSERT INTO register_template (entity_id, kind, title, body, likelihood, severity, treatment,
                                        verification_method, applies_to)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING template_id`,
        [entity_id, kind, title, opts.body || null, opts.likelihood || null, opts.severity || null,
         opts.treatment || null, opts.verification_method || null, opts.applies_to || null]);
      const template_id = r.rows[0].template_id;
      /* Same shape as the instance mapping above, and for the same reason. */
      const norm = (opts.standards || []).map((st) => (typeof st === 'string'
        ? { standard_key: st, clause: '' } : { standard_key: st.standard_key, clause: st.clause || '' }))
        .filter((x) => x.standard_key);
      if (norm.length) {
        await c.query(
          `INSERT INTO register_template_standard (entity_id, template_id, standard_key, clause)
           SELECT $1, $2, k, cl FROM unnest($3::text[], $4::text[]) AS t(k, cl)
           ON CONFLICT DO NOTHING`,
          [entity_id, template_id, norm.map((x) => x.standard_key), norm.map((x) => x.clause)]);
      }
      return { template_id, migrated: true };
    });
  } catch (e) { if (e.status) throw e; if (notMigrated(e)) throw gone('b185'); throw e; }
}

module.exports = {
  shape, attachables, subjectFor, listSubjects, closeSubject,
  list, add, revise, close, accept, linkDispute,
  templates, addTemplate, report, walk,
  KINDS, VISIBILITY, DISPOSITIONS, VERIFICATION, REL_TYPES, RESPONSES,
};
