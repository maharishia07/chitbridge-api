// routes/products.js — B3.7a Catalogue items (products) CRUD + search
const express = require('express');
const router  = express.Router();
const { body } = require('express-validator');
const { query } = require('../db');
const { validate } = require('../middleware/validate');
const auth = require('../middleware/auth');
const ctx = (req) => req.identity.parent_entity_id || req.identity.identity_id;

async function defaultSchemaId(entity_id) {
  const r = await query(
    `SELECT schema_id FROM entity_schemas
     WHERE entity_id = $1 AND status='active' AND is_default=true LIMIT 1`, [entity_id]);
  return r.rows[0]?.schema_id || null;
}

// Validate a product against its schema fields. Returns an error message, or null if valid.
// Rules: required fields not empty · number fields numeric, not negative, respect min_value.
// `quantity` is excluded — the customer sets it at order time.
async function validateItem(schema_id, item_data) {
  if (!schema_id) return null;
  const f = await query(
    `SELECT field_key, field_name, field_type, required, min_value
     FROM schema_fields WHERE schema_id = $1`, [schema_id]);
  for (const field of f.rows) {
    if (field.field_key === 'quantity') continue;
    const v = (item_data?.[field.field_key] == null ? '' : String(item_data[field.field_key])).trim();
    if (field.required && !v) return `${field.field_name} is required`;
    if (field.field_type === 'number' && v !== '') {
      const n = Number(v);
      if (Number.isNaN(n))            return `${field.field_name} must be a number`;
      if (n < 0)                      return `${field.field_name} cannot be negative`;
      if (field.min_value != null && n < Number(field.min_value))
                                      return `${field.field_name} must be at least ${field.min_value}`;
    }
  }
  return null;
}

// CREATE — add a product
router.post('/', auth, [ body('item_data').isObject() ], validate, async (req, res) => {
  try {
    const entity_id = ctx(req);
    const schema_id = await defaultSchemaId(entity_id);
    const verr = await validateItem(schema_id, req.body.item_data);
    if (verr) return res.status(400).json({ error: 'Invalid product', message: verr });
    const r = await query(
      `INSERT INTO catalogue_items (entity_id, schema_id, item_data)
       VALUES ($1,$2,$3) RETURNING *`,
      [entity_id, schema_id, JSON.stringify(req.body.item_data)]);
    res.json({ message: 'Product added', item: r.rows[0] });
  } catch (e) { res.status(500).json({ error: 'Add failed', message: e.message }); }
});

// READ + SEARCH — list my products, optional ?q=
router.get('/', auth, async (req, res) => {
  try {
    const entity_id = ctx(req);
    const q = (req.query.q || '').trim();
    const r = q
      ? await query(
          `SELECT * FROM catalogue_items
           WHERE entity_id=$1 AND is_active=true AND item_data::text ILIKE $2
           ORDER BY created_at DESC`, [entity_id, `%${q}%`])
      : await query(
          `SELECT * FROM catalogue_items
           WHERE entity_id=$1 AND is_active=true
           ORDER BY created_at DESC`, [entity_id]);
    res.json({ items: r.rows, count: r.rows.length });
  } catch (e) { res.status(500).json({ error: 'List failed', message: e.message }); }
});

// UPDATE — edit a product
router.patch('/:id', auth, [ body('item_data').isObject() ], validate, async (req, res) => {
  try {
    const entity_id = ctx(req);
    const verr = await validateItem(await defaultSchemaId(entity_id), req.body.item_data);
    if (verr) return res.status(400).json({ error: 'Invalid product', message: verr });
    const r = await query(
      `UPDATE catalogue_items SET item_data=$1, updated_at=NOW()
       WHERE item_id=$2 AND entity_id=$3 RETURNING *`,
      [JSON.stringify(req.body.item_data), req.params.id, entity_id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json({ message: 'Product updated', item: r.rows[0] });
  } catch (e) { res.status(500).json({ error: 'Update failed', message: e.message }); }
});

// DELETE — soft remove
router.delete('/:id', auth, async (req, res) => {
  try {
    const entity_id = ctx(req);
    const r = await query(
      `UPDATE catalogue_items SET is_active=false
       WHERE item_id=$1 AND entity_id=$2 RETURNING item_id`,
      [req.params.id, entity_id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json({ message: 'Product removed' });
  } catch (e) { res.status(500).json({ error: 'Delete failed', message: e.message }); }
});

module.exports = router;
