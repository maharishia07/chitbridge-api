// routes/relationships.js — B3.6 Supplier List + Customer List + Promotions
const express = require('express');
const router  = express.Router();
const { body } = require('express-validator');
const { query } = require('../db');
const { validate, sanitise } = require('../middleware/validate');
const auth = require('../middleware/auth');

// actors act in their parent entity's context
const ctx = (req) => req.identity.parent_entity_id || req.identity.identity_id;

// ── SUPPLIERS (no consent — D-056) ──────────────────────────

// Add a supplier by bridge_id
router.post('/suppliers',
  [ body('supplier_bridge_id').trim().notEmpty().withMessage('Supplier bridge ID required'),
    body('category').optional().trim().isLength({ max: 50 }) ],
  validate, auth,
  async (req, res) => {
    try {
      const owner    = ctx(req);
      const bridge   = req.body.supplier_bridge_id.trim();
      const category = sanitise(req.body.category || '') || null;

      const sup = await query(
        `SELECT identity_id, display_name FROM identities WHERE bridge_id = $1`, [bridge]);
      if (sup.rows.length === 0)
        return res.status(404).json({ error: 'Not found', message: 'No entity with that bridge ID' });
      if (sup.rows[0].identity_id === owner)
        return res.status(400).json({ error: 'Invalid', message: 'Cannot add yourself' });

      const dup = await query(
        `SELECT 1 FROM supplier_list WHERE owner_entity_id = $1 AND supplier_entity_id = $2`,
        [owner, sup.rows[0].identity_id]);
      if (dup.rows.length > 0)
        return res.status(409).json({ error: 'Exists', message: 'Already in your supplier list' });

      await query(
        `INSERT INTO supplier_list (owner_entity_id, supplier_entity_id, category, added_via)
         VALUES ($1, $2, $3, 'manual')`,
        [owner, sup.rows[0].identity_id, category]);

      res.json({ message: 'Supplier added',
        supplier: { bridge_id: bridge, display_name: sup.rows[0].display_name, category } });
    } catch (err) {
      console.error('Add supplier error:', err.message);
      res.status(500).json({ error: 'Add supplier failed', message: err.message });
    }
  });

// List my suppliers — has_catalogue reflects an active default schema only
router.get('/suppliers', auth, async (req, res) => {
  try {
    const owner = ctx(req);
    const r = await query(
      `SELECT sl.supplier_list_id, sl.category, sl.created_at,
              i.bridge_id, i.display_name, i.identity_id AS supplier_entity_id,
              EXISTS (SELECT 1 FROM entity_schemas es
                      WHERE es.entity_id = i.identity_id
                        AND es.status = 'active' AND es.is_default = true) AS has_catalogue
       FROM supplier_list sl
       JOIN identities i ON i.identity_id = sl.supplier_entity_id
       WHERE sl.owner_entity_id = $1
       ORDER BY sl.created_at DESC`, [owner]);
    res.json({ suppliers: r.rows, count: r.rows.length });
  } catch (err) {
    console.error('Get suppliers error:', err.message);
    res.status(500).json({ error: 'Get suppliers failed', message: err.message });
  }
});

// Remove from my list (does not affect the supplier)
router.delete('/suppliers/:id', auth, async (req, res) => {
  try {
    const owner = ctx(req);
    const r = await query(
      `DELETE FROM supplier_list WHERE supplier_list_id = $1 AND owner_entity_id = $2 RETURNING supplier_list_id`,
      [req.params.id, owner]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ message: 'Supplier removed' });
  } catch (err) {
    res.status(500).json({ error: 'Remove supplier failed', message: err.message });
  }
});

// Fetch a supplier's catalogue (active default schema) to render an order form (D-059)
router.get('/suppliers/:supplier_entity_id/catalogue', auth, async (req, res) => {
  try {
    const sid = req.params.supplier_entity_id;
    const schema = await query(
      `SELECT schema_id, schema_name FROM entity_schemas
       WHERE entity_id = $1 AND status = 'active' AND is_default = true LIMIT 1`, [sid]);
    if (schema.rows.length === 0) return res.json({ schema: null, fields: [] });
    const fields = await query(
      `SELECT field_key, field_name, field_type, required, display_order
       FROM schema_fields WHERE schema_id = $1 ORDER BY display_order`,
      [schema.rows[0].schema_id]);
    res.json({ schema: schema.rows[0], fields: fields.rows });
  } catch (err) {
    res.status(500).json({ error: 'Get catalogue failed', message: err.message });
  }
});

// ── CUSTOMERS (auto-added — D-065; segment computed on read — D-067) ──

router.get('/customers', auth, async (req, res) => {
  try {
    const owner   = ctx(req);
    const segment = (req.query.segment || '').trim();
    const r = await query(
      `SELECT cl.customer_list_id, cl.customer_type, cl.added_via,
              cl.txn_count, cl.last_txn_at,
              i.identity_id AS customer_identity_id, i.bridge_id, i.display_name,
              i.email, i.identity_type, i.owner_scope,
              COALESCE(cl.segment_override,
                CASE WHEN cl.last_txn_at < NOW() - INTERVAL '90 days' THEN 'inactive'
                     WHEN cl.txn_count >= 3 THEN 'regular'
                     ELSE 'new' END) AS segment
       FROM customer_list cl
       JOIN identities i ON i.identity_id = cl.customer_identity_id
       WHERE cl.owner_entity_id = $1
       ORDER BY cl.last_txn_at DESC NULLS LAST`, [owner]);
    const rows = segment ? r.rows.filter(c => c.segment === segment) : r.rows;
    res.json({ customers: rows, count: rows.length });
  } catch (err) {
    console.error('Get customers error:', err.message);
    res.status(500).json({ error: 'Get customers failed', message: err.message });
  }
});

// Manual segment override (optional)
router.patch('/customers/:id',
  [ body('segment_override').isIn(['high_value','regular','new','inactive']) ],
  validate, auth,
  async (req, res) => {
    try {
      const owner = ctx(req);
      const r = await query(
        `UPDATE customer_list SET segment_override = $1
         WHERE customer_list_id = $2 AND owner_entity_id = $3 RETURNING customer_list_id`,
        [req.body.segment_override, req.params.id, owner]);
      if (r.rows.length === 0) return res.status(404).json({ error: 'Not found' });
      res.json({ message: 'Segment updated' });
    } catch (err) {
      res.status(500).json({ error: 'Update segment failed', message: err.message });
    }
  });

module.exports = router;
