// routes/folders.js — FOLDERS: a per-entity tree for organising ANY chit (mailing-model). Folders are private per
// entity; filing sets chit_status.folder_id on THIS entity's copy only. Current/Archive reuses chit_status.archived_at.
// chit_status is RLS-protected -> any query touching it runs inside withEntity(caller). The folder table is entity-filtered.
const express = require('express');
const router  = express.Router();
const { withEntity } = require('../db');   // every folder-table query runs inside withEntity — `folder` is RLS-enforced (b64)
const { safeErr } = require('../lib/respond');
const { body, param } = require('express-validator');
const { validate, sanitise } = require('../middleware/validate');
const auth = require('../middleware/auth');

const ent = (req) => auth.entityOf(req);
/**
 * ⚠️ A FOLDER BELONGS TO ONE TRACK (b133). Athi, 2026-08-10: *"tasks and order cannot be on the same folder. folder
 * are having same characteristics as tasks, so all the icon is possible and arithmetic is possible."*
 *
 * You ACT on a Task and you CHASE an Order — different lists, different actions. A folder holding both could inherit
 * neither. Declaring the side makes a folder a SUB-LIST of its track: same row, same icons, same actions, plus
 * arithmetic over a smaller set.
 */
/**
 * ⚠️ LATCH TRUE, NEVER FALSE — the same rule routes/chits.js states for the b50 definer probe: *"latches true once
 * seen; keeps re-probing while false, so it self-heals when the migration lands (no restart needed)."*
 *
 * My first version cached BOTH answers. A server process that learned "no scope column" before b133 was applied
 * kept believing it forever, so folders carried on being created without a side and the proof reported "b133 is
 * NOT applied" against a database where it plainly was. A negative cache outlives the fact it describes.
 *
 * Cost of getting it wrong this way round: one failed query per call until the column appears, then never again.
 */
let SCOPE_OK = false;                       // latches TRUE once the column is really there; never latches false
const missingCol = (e) => e && e.code === '42703';
/* Always attempt the scoped form unless we have already proved it works — so a pre-b133 database pays one failed
   query per call (a transient state) and a migrated one pays nothing after the first success. */
const select  = require('../lib/select');    // WHICH chits — shared with the scorecard
const measure = require('../lib/measure');   // ...and how they are counted
const policy  = require('../lib/policy');    // overdue is a declared flag, not a magic number

// GET /api/folders — the entity's folder tree (flat rows; the client builds the tree) with CURRENT (non-archived) counts.
router.get('/', auth, async (req, res) => {
  try {
    const e = ent(req);
    const readFolders = (withScope) => withEntity(e, (db) => db.query(
      `SELECT f.folder_id, f.parent_id, f.name, f.sort, ${withScope ? "f.scope" : "NULL::text AS scope"},
              (SELECT COUNT(*) FROM chit_status cs
                 WHERE cs.entity_id = f.entity_id AND cs.folder_id = f.folder_id
                   AND cs.deleted_at IS NULL AND cs.archived_at IS NULL) AS count
         FROM folder f
        WHERE f.entity_id = $1
        ORDER BY f.parent_id NULLS FIRST, f.sort, f.name`, [e]));
    let r;
    try { r = await readFolders(true); SCOPE_OK = true; }
    catch (e1) { if (!missingCol(e1)) throw e1; r = await readFolders(false); }   // pre-b133 → retry in a FRESH tx
    res.json({ folders: r.rows });
  } catch (err) { res.status(500).json({ error: 'List failed', message: safeErr(err) }); }
});

// POST /api/folders — create { name, parent_id? }
router.post('/', auth,
  [ body('name').trim().isLength({ min: 1, max: 60 }).withMessage('Name required'),
    body('parent_id').optional({ nullable: true }).isUUID() ],
  validate, async (req, res) => {
  try {
    const e = ent(req); const name = sanitise(req.body.name); const parent = req.body.parent_id || null;
    /* ⚠️ A FOLDER BELONGS TO ONE TRACK (b133). Task and Order are different lists with different actions; a folder
       that held both could inherit neither. Default 'task' — the track folders were built for. */
    const scope = (req.body.scope === 'order') ? 'order' : 'task';
    /**
     * ⚠️ A FALLBACK INSIDE A TRANSACTION IS NOT A FALLBACK. The first version caught 42703 (no `scope` column, i.e.
     * pre-b133) and retried the plain INSERT on the SAME client — but Postgres had already aborted the transaction,
     * so the retry died with "current transaction is aborted" and the create returned a folder with no id. The
     * metrics call then 400'd on "id: Invalid value", which points nowhere near the actual cause.
     *
     * The retry must be a NEW transaction, and the negative is never cached (see the latch note above).
     */
    const doInsert = (withScope) => withEntity(e, async (db) => {
      if (parent) { const p = await db.query(`SELECT 1 FROM folder WHERE folder_id = $1 AND entity_id = $2`, [parent, e]); if (!p.rows.length) return { badParent: true }; }
      const r = withScope
        ? await db.query(`INSERT INTO folder (entity_id, parent_id, name, scope) VALUES ($1,$2,$3,$4) RETURNING folder_id, parent_id, name, sort, scope`, [e, parent, name, scope])
        : await db.query(`INSERT INTO folder (entity_id, parent_id, name) VALUES ($1,$2,$3) RETURNING folder_id, parent_id, name, sort`, [e, parent, name]);
      return { folder: r.rows[0] };
    });
    let row;
    try { row = await doInsert(true); SCOPE_OK = true; }
    catch (e1) { if (!missingCol(e1)) throw e1; row = await doInsert(false); }
    if (row.badParent) return res.status(400).json({ error: 'Bad parent', message: 'Parent folder not found.' });
    res.json({ folder: { ...row.folder, count: 0 } });
  } catch (err) { res.status(500).json({ error: 'Create failed', message: safeErr(err) }); }
});

// PATCH /api/folders/:id — rename and/or re-parent (move a subtree)
router.patch('/:id', auth,
  [ param('id').isUUID(), body('name').optional().trim().isLength({ min: 1, max: 60 }),
    body('parent_id').optional({ nullable: true }) ],
  validate, async (req, res) => {
  try {
    const e = ent(req); const sets = []; const params = []; let n = 0;
    if (req.body.name !== undefined) { n++; sets.push(`name = $${n}`); params.push(sanitise(req.body.name)); }
    if (req.body.parent_id !== undefined) {
      const par = req.body.parent_id || null;
      if (par === req.params.id) return res.status(400).json({ error: 'A folder cannot be its own parent' });
      n++; sets.push(`parent_id = $${n}`); params.push(par);
    }
    if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });
    n++; const idIdx = n; params.push(req.params.id); n++; params.push(e);
    const r = await withEntity(e, (db) => db.query(`UPDATE folder SET ${sets.join(', ')} WHERE folder_id = $${idIdx} AND entity_id = $${n} RETURNING folder_id, parent_id, name`, params));
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json({ folder: r.rows[0] });
  } catch (err) { res.status(500).json({ error: 'Update failed', message: safeErr(err) }); }
});

// DELETE /api/folders/:id — delete a folder (children cascade via FK); UNFILE its chits (folder_id -> NULL) so nothing is lost.
router.delete('/:id', auth, [ param('id').isUUID() ], validate, async (req, res) => {
  try {
    const e = ent(req);
    const deleted = await withEntity(e, async (db) => {
      await db.query(
        `UPDATE chit_status SET folder_id = NULL
          WHERE entity_id = $1 AND folder_id IN (SELECT folder_id FROM folder WHERE entity_id = $1 AND (folder_id = $2 OR parent_id = $2))`,
        [e, req.params.id]);
      const r = await db.query(`DELETE FROM folder WHERE folder_id = $1 AND entity_id = $2`, [req.params.id, e]);
      return r.rowCount;
    });
    res.json({ deleted });
  } catch (err) { res.status(500).json({ error: 'Delete failed', message: safeErr(err) }); }
});

// POST /api/folders/move — file / redirect a chit into a folder (folder_id=null => unfile). Sets MY copy only.
router.post('/move', auth,
  [ body('chit_id').isUUID(), body('folder_id').optional({ nullable: true }) ],
  validate, async (req, res) => {
  try {
    const e = ent(req); const fid = req.body.folder_id || null;
    const doMove = (scoped) => withEntity(e, async (db) => {
      let fscope = null;
      if (fid) {
        let f;
        /* Same rule as the create route: never retry inside an aborted transaction, and never cache the negative. */
        f = await db.query(scoped
          ? `SELECT scope FROM folder WHERE folder_id = $1 AND entity_id = $2`
          : `SELECT NULL::text AS scope FROM folder WHERE folder_id = $1 AND entity_id = $2`, [fid, e]).catch((err) => {
            if (missingCol(err)) return null;
            throw err;
          });
        if (f === null) return { retryNoScope: true };
        if (!f.rows.length) return { noFolder: true };
        fscope = f.rows[0].scope;
      }
      /**
       * ⚠️ `direction` IS OPTIONAL, AND WITHOUT IT A SELF-CHIT MOVES BOTH COPIES.
       *
       * The comment above says "MY copy" — singular — but this UPDATE matched on (chit_id, entity_id) only. On an
       * inter-entity chit you hold one copy, so there was never a difference. On a SELF-CHIT you hold two (the
       * Order copy and the Task copy) and both moved together: filing 40 chits produced 80 filed rows, and the
       * folder honestly reported 80 while a person would say 40.
       *
       * Found 2026-08-10 by seeding folders and reading the counts back. Fixed ADDITIVELY: omit `direction` and
       * the old behaviour is unchanged; pass it and only that copy moves. The UI passes it now, because Task and
       * Order are genuinely different things in the mailbox model — filing the Order copy into "Sent to suppliers"
       * should not drag the Task copy along.
       */
      let dir = (req.body.direction === 'sent' || req.body.direction === 'received') ? req.body.direction : null;
      /**
       * ⚠️ THE FOLDER'S SIDE DECIDES (b133). A Task folder takes received copies; an Order folder takes sent ones.
       * When the caller names no direction, the folder's scope supplies it — so an old client filing "the chit"
       * into a Task folder now files the Task copy and leaves the Order copy alone, instead of dragging both.
       * When the caller DOES name one and it contradicts the folder, that is refused rather than quietly ignored:
       * silently filing into the wrong track is how a folder stops meaning anything.
       */
      const want = fscope === 'order' ? 'sent' : fscope === 'task' ? 'received' : null;
      if (want && dir && dir !== want) return { wrongSide: { folder: fscope, chit: dir } };
      if (want && !dir) dir = want;

      const r = await db.query(
        `UPDATE chit_status SET folder_id = $1 WHERE chit_id = $2 AND entity_id = $3` + (dir ? ` AND direction = $4` : ''),
        dir ? [fid, req.body.chit_id, e, dir] : [fid, req.body.chit_id, e]);
      return { moved: r.rowCount, scope: fscope };
    });
    // The 42703 retry is a FRESH transaction — the aborted one can serve nothing further. At most once per process.
    let result = await doMove(true);
    if (result.retryNoScope) result = await doMove(false);   // FRESH tx — the aborted one serves nothing
    else if (!result.noFolder) SCOPE_OK = true;
    if (result.noFolder) return res.status(400).json({ error: 'No such folder' });
    if (result.wrongSide) return res.status(400).json({
      error: 'Wrong side',
      message: 'That is a ' + (result.wrongSide.folder === 'order' ? 'Order' : 'Task') + ' folder — it holds '
             + (result.wrongSide.folder === 'order' ? 'chits you sent' : 'chits that came to you')
             + '. Task and Order are separate tracks, so a folder belongs to one of them.',
      code: 'FOLDER_WRONG_SIDE' });
    res.json({ moved: result.moved, folder_id: fid, scope: result.scope });
  } catch (err) { res.status(500).json({ error: 'Move failed', message: safeErr(err) }); }
});

// GET /api/folders/:id/chits?archived=0|1 — the chits filed in this folder.
// ⚠️ ONE SIDE ONLY (b133). Filing enforces it, so a folder cannot acquire the wrong track — but a folder that was
// mixed BEFORE b133 still holds both, and this list would show them side by side with the wrong actions. The
// folder's declared scope filters the read too, so the screen is consistent even where the data is not yet.
// Isolated from the core inbox query on purpose. Lightweight shape for the folder list.
router.get('/:id/chits', auth, [ param('id').isUUID() ], validate, async (req, res) => {
  try {
    const e = ent(req); const arch = (req.query.archived === '1' || req.query.archived === 'true');
    const r = await withEntity(e, (db) => db.query(
      `SELECT ch.chit_id, ch.sender_entity_display_name, ch.auto_subject, ch.manual_subject, ch.purpose, ch.created_at,
              ch.business_json, ch.created_by_actor_id,
              (SELECT display_name FROM identities WHERE identity_id = ch.created_by_actor_id) AS raiser_name,
              cs.direction, cs.current_status
         FROM chit_status cs
         JOIN chit_header ch ON ch.chit_id = cs.chit_id AND ch.entity_id = cs.entity_id AND ch.direction = cs.direction
        WHERE cs.entity_id = $1 AND cs.folder_id = $2 AND cs.deleted_at IS NULL AND cs.archived_at IS ${arch ? 'NOT NULL' : 'NULL'}
        ORDER BY ch.created_at DESC LIMIT 100`, [e, req.params.id]));
    res.json({ chits: r.rows });
  } catch (err) { res.status(500).json({ error: 'List failed', message: safeErr(err) }); }
});

/**
 * GET /:id/metrics — WHAT IS IN THIS FOLDER, as numbers.
 *
 * ⚠️ THREE LINES, BECAUSE THE WORK IS SHARED. A folder metric and a counterparty scorecard are the same operation
 * over different selectors — resolve a set (lib/select.js), measure it (lib/measure.js). Written once so a folder
 * and a supplier can never disagree about what "open" or "overdue" means, which they would within a month if
 * each screen counted for itself. See SPEC-folder-skills.md.
 *
 * Read-only, no migration, WITH RLS: withEntity() sets the tenant and the WHERE names it again. A folder is
 * per-COPY — this counts YOUR copies, never a counterparty's.
 */
router.get('/:id/metrics', auth, [ param('id').isUUID() ], validate, async (req, res) => {
  try {
    const me = ent(req);
    const flags = await policy.get(me);      //  is a POLICY, not a constant hidden inside a report
    /* The folder's own side scopes what it measures — a Task folder's arithmetic is over Task copies. */
    let fscope = null;
    try { const f = await withEntity(me, (db) => db.query('SELECT scope FROM folder WHERE folder_id = $1 AND entity_id = $2', [req.params.id, me])); fscope = (f.rows[0]||{}).scope || null; } catch (_) {}
    const rows = await select.rows(me, { folder_id: req.params.id, archived: req.query.archived === '1',
      direction: fscope === 'order' ? 'sent' : fscope === 'task' ? 'received' : undefined });
    res.json(Object.assign({ folder_id: req.params.id, scope: fscope }, measure.measure(rows, { overdue_days: flags.overdue_days })));
  } catch (err) { console.error("folder metrics:", err.message); res.status(500).json({ error: "Metrics failed", message: safeErr(err) }); }
});

/* ── FOLDER RULES (b132) — condition -> file here. The UX Athi asked for lives INSIDE the folder. ────────────── */
const rules = require('../lib/folder-rules');
const fail = (res, err, label) => res.status(err.status || 500).json({ error: label, message: err.status ? (err.message || safeErr(err)) : safeErr(err) });

router.get('/:id/rules', auth, [ param('id').isUUID() ], validate, async (req, res) => {
  try { res.json(await rules.list(ent(req), req.params.id)); } catch (err) { fail(res, err, 'Rules list failed'); }
});
router.post('/:id/rules', auth, [ param('id').isUUID() ], validate, async (req, res) => {
  try { res.json(await rules.create(ent(req), req.params.id, req.body || {})); } catch (err) { fail(res, err, 'Rule create failed'); }
});
router.patch('/rules/:rule_id', auth, [ param('rule_id').isUUID() ], validate, async (req, res) => {
  try { res.json(await rules.update(ent(req), req.params.rule_id, req.body || {})); } catch (err) { fail(res, err, 'Rule update failed'); }
});
router.delete('/rules/:rule_id', auth, [ param('rule_id').isUUID() ], validate, async (req, res) => {
  try { res.json(await rules.remove(ent(req), req.params.rule_id)); } catch (err) { fail(res, err, 'Rule delete failed'); }
});

/* ⚠️ PREVIEW BEFORE SAVE — the most useful route here. A rule is a promise about the future written by someone
   who cannot see it; running it against chits that already exist turns "I think this catches supplier invoices"
   into a list you can read first. Needs no rules table, so it works before b132 is run. */
router.post('/rules/preview', auth, async (req, res) => {
  try { res.json(await rules.preview(ent(req), (req.body || {}).when, req.body || {})); } catch (err) { fail(res, err, 'Preview failed'); }
});

/* The condition vocabulary, served to the UI so the builder cannot offer a term the matcher does not know. */
router.get('/rules/vocabulary', auth, (req, res) => res.json({ keys: require('../lib/match').KEYS }));

module.exports = router;
