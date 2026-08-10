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
const select  = require('../lib/select');    // WHICH chits — shared with the scorecard
const measure = require('../lib/measure');   // ...and how they are counted
const policy  = require('../lib/policy');    // overdue is a declared flag, not a magic number

// GET /api/folders — the entity's folder tree (flat rows; the client builds the tree) with CURRENT (non-archived) counts.
router.get('/', auth, async (req, res) => {
  try {
    const e = ent(req);
    const r = await withEntity(e, (db) => db.query(
      `SELECT f.folder_id, f.parent_id, f.name, f.sort,
              (SELECT COUNT(*) FROM chit_status cs
                 WHERE cs.entity_id = f.entity_id AND cs.folder_id = f.folder_id
                   AND cs.deleted_at IS NULL AND cs.archived_at IS NULL) AS count
         FROM folder f
        WHERE f.entity_id = $1
        ORDER BY f.parent_id NULLS FIRST, f.sort, f.name`, [e]));
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
    const row = await withEntity(e, async (db) => {
      if (parent) { const p = await db.query(`SELECT 1 FROM folder WHERE folder_id = $1 AND entity_id = $2`, [parent, e]); if (!p.rows.length) return { badParent: true }; }
      const r = await db.query(`INSERT INTO folder (entity_id, parent_id, name) VALUES ($1,$2,$3) RETURNING folder_id, parent_id, name, sort`, [e, parent, name]);
      return { folder: r.rows[0] };
    });
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
    const result = await withEntity(e, async (db) => {
      if (fid) { const f = await db.query(`SELECT 1 FROM folder WHERE folder_id = $1 AND entity_id = $2`, [fid, e]); if (!f.rows.length) return { noFolder: true }; }
      const r = await db.query(`UPDATE chit_status SET folder_id = $1 WHERE chit_id = $2 AND entity_id = $3`, [fid, req.body.chit_id, e]);
      return { moved: r.rowCount };
    });
    if (result.noFolder) return res.status(400).json({ error: 'No such folder' });
    res.json({ moved: result.moved, folder_id: fid });
  } catch (err) { res.status(500).json({ error: 'Move failed', message: safeErr(err) }); }
});

// GET /api/folders/:id/chits?archived=0|1 — the chits filed in this folder (spans BOTH directions: task + order).
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
    const rows = await select.rows(me, { folder_id: req.params.id, archived: req.query.archived === '1' });
    res.json(Object.assign({ folder_id: req.params.id }, measure.measure(rows, { overdue_days: flags.overdue_days })));
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
