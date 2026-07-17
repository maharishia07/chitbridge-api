// routes/schemas.js — Schema engine basic
const express = require('express');
const router  = express.Router();
const { safeErr } = require('../lib/respond');
const { body } = require('express-validator');
const { query } = require('../db');
const { validate } = require('../middleware/validate');
const auth = require('../middleware/auth');

// GET /api/schemas/my — does entity have a schema?
router.get('/my', auth, async (req, res) => {
  try {
    const entity_id = req.identity.identity_id;
    const schema = await query(
      `SELECT es.*, json_agg(sf ORDER BY sf.display_order) as fields
       FROM entity_schemas es
       LEFT JOIN schema_fields sf ON sf.schema_id = es.schema_id
       WHERE es.entity_id = $1 AND es.status = 'active' AND es.is_default = true
       GROUP BY es.schema_id`,
      [entity_id]
    );
    res.json({ schema: schema.rows[0] || null });
  } catch (err) {
    console.error('Schema fetch error:', err.message);
    res.status(500).json({ error: 'Failed to get schema', message: safeErr(err) });
  }
});

// POST /api/schemas/create-default — create Product Qty Price schema
router.post('/create-default', auth, async (req, res) => {
  try {
    const entity_id = req.identity.identity_id;
    // ONE implementation (also called at mint) — idempotent: returns the existing active schema instead of 400.
    const r = await require('../lib/schema-bootstrap').ensureDefaultSchema(entity_id);
    if (r.error || !r.schema_id) return res.status(500).json({ error: 'Failed to create schema', message: r.error || 'no schema' });
    const result = await query(
      `SELECT es.*, json_agg(sf ORDER BY sf.display_order) as fields
       FROM entity_schemas es
       JOIN schema_fields sf ON sf.schema_id = es.schema_id
       WHERE es.schema_id = $1
       GROUP BY es.schema_id`,
      [r.schema_id]
    );
    res.json({ message: r.created ? 'Schema created' : 'Schema already exists', schema: result.rows[0] });
  } catch (err) {
    console.error('Schema create error:', err.message);
    res.status(500).json({ error: 'Failed to create schema', message: safeErr(err) });
  }
});

// GET /api/schemas/fields — get fields for compose form
router.get('/fields', auth, async (req, res) => {
  try {
    const entity_id = req.identity.identity_id;
    const fields = await query(
      `SELECT sf.* FROM schema_fields sf
       JOIN entity_schemas es ON es.schema_id = sf.schema_id
       WHERE es.entity_id = $1 AND es.status = 'active' AND es.is_default = true
       ORDER BY sf.display_order ASC`,
      [entity_id]
    );
    res.json({ fields: fields.rows });
  } catch (err) {
    console.error('Schema fields error:', err.message);
    res.status(500).json({ error: 'Failed to get fields', message: safeErr(err) });
  }
});

// PATCH /api/schemas/visibility — set catalogue visibility (private | restricted | public)
router.patch('/visibility', auth,
  [ body('visibility').isIn(['private','restricted','public']) ], validate,
  async (req, res) => {
    try {
      const entity_id = req.identity.parent_entity_id || req.identity.identity_id;
      const r = await query(
        `UPDATE entity_schemas SET visibility = $1
         WHERE entity_id = $2 AND status = 'active' AND is_default = true
         RETURNING schema_id, visibility`,
        [req.body.visibility, entity_id]);
      if (!r.rows.length) return res.status(404).json({ error: 'Not found', message: 'No active catalogue to update' });
      res.json({ message: 'Visibility updated', visibility: r.rows[0].visibility });
    } catch (err) { res.status(500).json({ error: 'Visibility update failed', message: safeErr(err) }); }
  });

module.exports = router;
