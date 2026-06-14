// routes/schemas.js — Schema engine basic
const express = require('express');
const router  = express.Router();
const { query } = require('../db');
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
    res.status(500).json({ error: 'Failed to get schema', message: err.message });
  }
});

// POST /api/schemas/create-default — create Product Qty Price schema
router.post('/create-default', auth, async (req, res) => {
  try {
    const entity_id = req.identity.identity_id;

    // Check not already created
    const existing = await query(
      `SELECT schema_id FROM entity_schemas WHERE entity_id = $1 AND status = 'active'`,
      [entity_id]
    );
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'Schema already exists', message: 'Entity already has a schema' });
    }

    // Create schema
    const schema = await query(
      `INSERT INTO entity_schemas (entity_id, schema_name, schema_type, source, status, is_default)
       VALUES ($1, 'Product Schema', 'product', 'manual', 'active', true)
       RETURNING *`,
      [entity_id]
    );
    const schema_id = schema.rows[0].schema_id;

    // Insert three default fields
    await query(
      `INSERT INTO schema_fields (schema_id, field_name, field_key, field_type, required, min_value, display_order)
       VALUES
         ($1, 'Product', 'product', 'text',   true, null, 1),
         ($1, 'Quantity', 'quantity', 'number', true, 1,    2),
         ($1, 'Price',    'price',    'number', true, 0,    3)`,
      [schema_id]
    );

    // Fetch with fields
    const result = await query(
      `SELECT es.*, json_agg(sf ORDER BY sf.display_order) as fields
       FROM entity_schemas es
       JOIN schema_fields sf ON sf.schema_id = es.schema_id
       WHERE es.schema_id = $1
       GROUP BY es.schema_id`,
      [schema_id]
    );

    res.json({ message: 'Schema created', schema: result.rows[0] });
  } catch (err) {
    console.error('Schema create error:', err.message);
    res.status(500).json({ error: 'Failed to create schema', message: err.message });
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
    res.status(500).json({ error: 'Failed to get fields', message: err.message });
  }
});

module.exports = router;
