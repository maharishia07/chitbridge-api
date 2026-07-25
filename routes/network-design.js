// routes/network-design.js — NETWORK DESIGN persistence: the design-first Network builder's draft, stored
// per entity so the SAME design follows the user across machines/browsers (was browser-localStorage only).
// network_design is RLS-protected (b111) -> every query runs inside withEntity(caller). One row per entity.
const express = require('express');
const router  = express.Router();
const { withEntity } = require('../db');
const { safeErr } = require('../lib/respond');
const auth = require('../middleware/auth');

const ent = (req) => req.identity.parent_entity_id || req.identity.identity_id;
const MAX_BYTES = 2_000_000;   // a design is a modest JSON tree; cap so this never becomes a document store

// GET /api/network-design — this entity's saved design (null if none yet).
router.get('/', auth, async (req, res) => {
  try {
    const e = ent(req);
    const r = await withEntity(e, (db) => db.query(
      `SELECT draft, updated_at FROM network_design WHERE entity_id = $1`, [e]));
    res.json({ draft: r.rows.length ? r.rows[0].draft : null, updated_at: r.rows.length ? r.rows[0].updated_at : null });
  } catch (err) { res.status(500).json({ error: 'Load failed', message: safeErr(err) }); }
});

// PUT /api/network-design — upsert the whole design draft { draft: {...} }.
router.put('/', auth, async (req, res) => {
  try {
    const e = ent(req);
    const draft = req.body && req.body.draft;
    if (draft === undefined || draft === null || typeof draft !== 'object' || Array.isArray(draft)) {
      return res.status(400).json({ error: 'Bad request', message: 'draft must be an object' });
    }
    if (JSON.stringify(draft).length > MAX_BYTES) {
      return res.status(413).json({ error: 'Too large', message: 'design exceeds ' + MAX_BYTES + ' bytes' });
    }
    const r = await withEntity(e, (db) => db.query(
      `INSERT INTO network_design (entity_id, draft, updated_at) VALUES ($1, $2, now())
         ON CONFLICT (entity_id) DO UPDATE SET draft = EXCLUDED.draft, updated_at = now()
       RETURNING updated_at`, [e, draft]));
    res.json({ ok: true, updated_at: r.rows[0].updated_at });
  } catch (err) { res.status(500).json({ error: 'Save failed', message: safeErr(err) }); }
});

module.exports = router;
