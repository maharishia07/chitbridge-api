// routes/combo-templates.js — [OFFR-06] saved, reusable combo/modifier group sets — b266.
//
// Athi, testing the Modifier Lab: "the example shown is very pathetic... what i want is something similar
// to the combo offer in a popup window with possibly combination, and also with save as option, if we are
// doing save as feature then we should be having a mechanism of open the same again."
//
// A template holds the SAME shape CBVariant (lib/variant.js) already owns and validates — an array of
// `{name, required, max, options:[{name, price}]}` groups. This route never re-validates that shape itself;
// the client runs it through CBVariant.validate() before ever offering "Save as", exactly as it already does
// before Apply. This route's only job is CRUD, scoped to the caller's own entity.
'use strict';
const express = require('express');
const router = express.Router();
const { safeErr } = require('../lib/respond');
const { body } = require('express-validator');
const { withEntity } = require('../db');
const { validate } = require('../middleware/validate');
const auth = require('../middleware/auth');

function fail(res, e, label) {
  if (e && e.status && e.status >= 400 && e.status < 500) {
    return res.status(e.status).json({ error: label, message: e.message });
  }
  return res.status(500).json({ error: label, message: safeErr(e) });
}
const ctx = (req) => auth.entityOf(req);

/** ⚠️ a name is the whole point of "save as" — an unnamed row is a row nobody can find again to reopen */
function badName(name) {
  const n = String(name || '').trim();
  if (!n) return 'A name is required — this is what you will look for when you come back to reuse it.';
  if (n.length > 120) return 'That name is too long — keep it under 120 characters.';
  return null;
}
/** ⚠️ the ONE shape check this route makes — not what variant.js already validates, just "is this an array
 *  of plausible groups at all", so a malformed body cannot wedge a row nothing can ever read back. */
function badDefinition(def) {
  if (!Array.isArray(def) || !def.length) return 'A combo needs at least one group to be worth saving.';
  for (const g of def) {
    if (!g || typeof g !== 'object' || !String(g.name || '').trim()) return 'Every group needs a name before it can be saved.';
    if (!Array.isArray(g.options) || !g.options.length) return `"${g.name}" has no options yet — add one before saving.`;
  }
  return null;
}

// GET /api/combo-templates — the library, newest first
router.get('/', auth, async (req, res) => {
  try {
    const entity_id = ctx(req);
    const r = await withEntity(entity_id, (db) => db.query(
      `SELECT id, name, definition, created_at, updated_at FROM combo_templates
       WHERE entity_id=$1 ORDER BY created_at DESC LIMIT 200`, [entity_id]));
    res.json({ templates: r.rows });
  } catch (e) { fail(res, e, 'Could not read your saved combos'); }
});

// POST /api/combo-templates  { name, definition }  — "Save as"
router.post('/', auth, [ body('name').isString(), body('definition').isArray() ], validate, async (req, res) => {
  try {
    const entity_id = ctx(req);
    const nameErr = badName(req.body.name);
    if (nameErr) return res.status(400).json({ error: 'Invalid name', message: nameErr });
    const defErr = badDefinition(req.body.definition);
    if (defErr) return res.status(400).json({ error: 'Invalid combo', message: defErr });
    const r = await withEntity(entity_id, (db) => db.query(
      `INSERT INTO combo_templates (entity_id, name, definition) VALUES ($1,$2,$3)
       RETURNING id, name, definition, created_at, updated_at`,
      [entity_id, String(req.body.name).trim(), JSON.stringify(req.body.definition)]));
    res.json({ message: 'Saved', template: r.rows[0] });
  } catch (e) { fail(res, e, 'Could not save this combo') }
});

// PATCH /api/combo-templates/:id  { name?, definition? } — rename, or replace what it holds
router.patch('/:id', auth, [ body('name').optional().isString(), body('definition').optional().isArray() ], validate, async (req, res) => {
  try {
    const entity_id = ctx(req);
    if ('name' in req.body) {
      const nameErr = badName(req.body.name);
      if (nameErr) return res.status(400).json({ error: 'Invalid name', message: nameErr });
    }
    if ('definition' in req.body) {
      const defErr = badDefinition(req.body.definition);
      if (defErr) return res.status(400).json({ error: 'Invalid combo', message: defErr });
    }
    const cur = await withEntity(entity_id, (db) => db.query(
      `SELECT name, definition FROM combo_templates WHERE id=$1 AND entity_id=$2`, [req.params.id, entity_id]));
    if (!cur.rows.length) return res.status(404).json({ error: 'Not found' });
    const name = 'name' in req.body ? String(req.body.name).trim() : cur.rows[0].name;
    const definition = 'definition' in req.body ? req.body.definition : cur.rows[0].definition;
    const r = await withEntity(entity_id, (db) => db.query(
      `UPDATE combo_templates SET name=$1, definition=$2, updated_at=NOW()
       WHERE id=$3 AND entity_id=$4 RETURNING id, name, definition, created_at, updated_at`,
      [name, JSON.stringify(definition), req.params.id, entity_id]));
    res.json({ message: 'Updated', template: r.rows[0] });
  } catch (e) { fail(res, e, 'Could not update this combo'); }
});

// DELETE /api/combo-templates/:id
router.delete('/:id', auth, async (req, res) => {
  try {
    const entity_id = ctx(req);
    const r = await withEntity(entity_id, (db) => db.query(
      `DELETE FROM combo_templates WHERE id=$1 AND entity_id=$2 RETURNING id`, [req.params.id, entity_id]));
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json({ message: 'Deleted' });
  } catch (e) { fail(res, e, 'Could not delete this combo'); }
});

module.exports = router;
