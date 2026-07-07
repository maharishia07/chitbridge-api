// routes/folders.js — FOLDERS: a per-entity tree for organising ANY chit (mailing-model). Folders are private per
// entity; filing sets chit_status.folder_id on THIS entity's copy only. Current/Archive reuses chit_status.archived_at.
// chit_status is RLS-protected -> any query touching it runs inside withEntity(caller). The folder table is entity-filtered.
const express = require('express');
const router  = express.Router();
const { query, withEntity } = require('../db');
const { safeErr } = require('../lib/respond');
const { body, param } = require('express-validator');
const { validate, sanitise } = require('../middleware/validate');
const auth = require('../middleware/auth');

const ent = (req) => req.identity.parent_entity_id || req.identity.identity_id;

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
    if (parent) { const p = await query(`SELECT 1 FROM folder WHERE folder_id = $1 AND entity_id = $2`, [parent, e]); if (!p.rows.length) return res.status(400).json({ error: 'Bad parent', message: 'Parent folder not found.' }); }
    const r = await query(`INSERT INTO folder (entity_id, parent_id, name) VALUES ($1,$2,$3) RETURNING folder_id, parent_id, name, sort`, [e, parent, name]);
    res.json({ folder: { ...r.rows[0], count: 0 } });
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
    const r = await query(`UPDATE folder SET ${sets.join(', ')} WHERE folder_id = $${idIdx} AND entity_id = $${n} RETURNING folder_id, parent_id, name`, params);
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json({ folder: r.rows[0] });
  } catch (err) { res.status(500).json({ error: 'Update failed', message: safeErr(err) }); }
});

// DELETE /api/folders/:id — delete a folder (children cascade via FK); UNFILE its chits (folder_id -> NULL) so nothing is lost.
router.delete('/:id', auth, [ param('id').isUUID() ], validate, async (req, res) => {
  try {
    const e = ent(req);
    await withEntity(e, (db) => db.query(
      `UPDATE chit_status SET folder_id = NULL
        WHERE entity_id = $1 AND folder_id IN (SELECT folder_id FROM folder WHERE entity_id = $1 AND (folder_id = $2 OR parent_id = $2))`,
      [e, req.params.id]));
    const r = await query(`DELETE FROM folder WHERE folder_id = $1 AND entity_id = $2`, [req.params.id, e]);
    res.json({ deleted: r.rowCount });
  } catch (err) { res.status(500).json({ error: 'Delete failed', message: safeErr(err) }); }
});

// POST /api/folders/move — file / redirect a chit into a folder (folder_id=null => unfile). Sets MY copy only.
router.post('/move', auth,
  [ body('chit_id').isUUID(), body('folder_id').optional({ nullable: true }) ],
  validate, async (req, res) => {
  try {
    const e = ent(req); const fid = req.body.folder_id || null;
    if (fid) { const f = await query(`SELECT 1 FROM folder WHERE folder_id = $1 AND entity_id = $2`, [fid, e]); if (!f.rows.length) return res.status(400).json({ error: 'No such folder' }); }
    const r = await withEntity(e, (db) => db.query(`UPDATE chit_status SET folder_id = $1 WHERE chit_id = $2 AND entity_id = $3`, [fid, req.body.chit_id, e]));
    res.json({ moved: r.rowCount, folder_id: fid });
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

module.exports = router;
