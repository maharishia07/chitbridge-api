// routes/catalogue-face.js — CATALOGUE FACE persistence: the catalogue setup config (purpose · method · units ·
// facets · tax · ERP mapping), stored per entity so the SAME setup follows the user across machines/browsers (was
// browser-localStorage only). The catalogue ITEMS live in catalogue_items (real products); this holds only the face.
// catalogue_face is RLS-protected (b112) -> every query runs inside withEntity(caller). One row per entity.
const express = require('express');
const router  = express.Router();
const { withEntity } = require('../db');
const { safeErr } = require('../lib/respond');
const auth = require('../middleware/auth');

const ent = (req) => req.identity.parent_entity_id || req.identity.identity_id;
const MAX_BYTES = 1_000_000;   // a face is a small config object; cap so this never becomes a document store

// GET /api/catalogue-face — this entity's saved face (null if none yet).
router.get('/', auth, async (req, res) => {
  try {
    const e = ent(req);
    const r = await withEntity(e, (db) => db.query(
      `SELECT face, updated_at FROM catalogue_face WHERE entity_id = $1`, [e]));
    res.json({ face: r.rows.length ? r.rows[0].face : null, updated_at: r.rows.length ? r.rows[0].updated_at : null });
  } catch (err) { res.status(500).json({ error: 'Load failed', message: safeErr(err) }); }
});

// PUT /api/catalogue-face — upsert the whole face config { face: {...} }.
router.put('/', auth, async (req, res) => {
  try {
    const e = ent(req);
    const face = req.body && req.body.face;
    if (face === undefined || face === null || typeof face !== 'object' || Array.isArray(face)) {
      return res.status(400).json({ error: 'Bad request', message: 'face must be an object' });
    }
    if (Buffer.byteLength(JSON.stringify(face)) > MAX_BYTES) {
      return res.status(413).json({ error: 'Too large', message: 'face exceeds ' + MAX_BYTES + ' bytes' });
    }
    const r = await withEntity(e, (db) => db.query(
      `INSERT INTO catalogue_face (entity_id, face, updated_at) VALUES ($1, $2, now())
         ON CONFLICT (entity_id) DO UPDATE SET face = EXCLUDED.face, updated_at = now()
       RETURNING updated_at`, [e, face]));
    res.json({ ok: true, updated_at: r.rows[0].updated_at });
  } catch (err) { res.status(500).json({ error: 'Save failed', message: safeErr(err) }); }
});

module.exports = router;
