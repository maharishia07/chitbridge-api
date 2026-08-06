// routes/relationships.js — B3.6 Supplier List + Customer List + Promotions
const express = require('express');
const router  = express.Router();
const { safeErr } = require('../lib/respond');
const { body } = require('express-validator');
const { query, withEntity } = require('../db');
const { validate, sanitise } = require('../middleware/validate');
const auth = require('../middleware/auth');
const catalogueView  = require('../lib/catalogue-view');    // the SAME catalogue read the public storefront uses
const catalogueBuild = require('../lib/catalogue-build');
const orderInput     = require('../lib/order-input');

// actors act in their parent entity's context
const ctx = (req) => req.identity.parent_entity_id || req.identity.identity_id;

// ── SUPPLIERS (no consent — D-056) ──────────────────────────

// Add a supplier by bridge_id — with optional owner-side fields (your naming / preferred / notes)
router.post('/suppliers',
  [ body('supplier_bridge_id').trim().notEmpty().withMessage('Supplier bridge ID required'),
    body('category').optional().trim().isLength({ max: 50 }),
    body('nickname').optional().trim().isLength({ max: 80 }),
    body('notes').optional().trim().isLength({ max: 2000 }),
    body('preferred').optional().isBoolean() ],
  validate, auth,
  async (req, res) => {
    try {
      const owner     = ctx(req);
      const bridge    = req.body.supplier_bridge_id.trim();
      const category  = sanitise(req.body.category || '') || null;
      const nickname  = sanitise(req.body.nickname || '') || null;
      const notes     = sanitise(req.body.notes || '') || null;
      const preferred = req.body.preferred === true || req.body.preferred === 'true';

      // Resolve by bridge_id OR external user_id OR email — the panel prompts "User ID or email",
      // so bridge-id-only lookup would 404 those. (Matches the ATH-114 user_id resolution.)
      const sup = await query(
        `SELECT identity_id, display_name FROM identities
         WHERE bridge_id = $1 OR LOWER(user_id) = LOWER($1) OR LOWER(email) = LOWER($1)
         LIMIT 1`, [bridge]);
      if (sup.rows.length === 0)
        return res.status(404).json({ error: 'Not found', message: 'No business with that User ID, bridge ID, or email' });
      if (sup.rows[0].identity_id === owner)
        return res.status(400).json({ error: 'Invalid', message: 'Cannot add yourself' });

      const dup = await query(
        `SELECT 1 FROM supplier_list WHERE owner_entity_id = $1 AND supplier_entity_id = $2`,
        [owner, sup.rows[0].identity_id]);
      if (dup.rows.length > 0)
        return res.status(409).json({ error: 'Exists', message: 'Already in your supplier list' });

      await query(
        `INSERT INTO supplier_list (owner_entity_id, supplier_entity_id, category, nickname, notes, preferred, added_via)
         VALUES ($1, $2, $3, $4, $5, $6, 'manual')`,
        [owner, sup.rows[0].identity_id, category, nickname, notes, preferred]);

      res.json({ message: 'Supplier added',
        supplier: { bridge_id: bridge, display_name: sup.rows[0].display_name, category, nickname, notes, preferred } });
    } catch (err) {
      console.error('Add supplier error:', err.message);
      res.status(500).json({ error: 'Add supplier failed', message: safeErr(err) });
    }
  });

// List my suppliers — has_catalogue reflects an active default schema only
router.get('/suppliers', auth, async (req, res) => {
  try {
    const owner = ctx(req);
    const r = await query(
      `SELECT sl.supplier_list_id, sl.category, sl.nickname, sl.preferred, sl.notes, sl.created_at,
              i.bridge_id, i.display_name, i.identity_id AS supplier_entity_id,
              EXISTS (SELECT 1 FROM entity_schemas es
                      WHERE es.entity_id = i.identity_id
                        AND es.status = 'active' AND es.is_default = true) AS has_catalogue
       FROM supplier_list sl
       JOIN identities i ON i.identity_id = sl.supplier_entity_id
       WHERE sl.owner_entity_id = $1
       ORDER BY sl.preferred DESC, sl.created_at DESC`, [owner]);
    res.json({ suppliers: r.rows, count: r.rows.length });
  } catch (err) {
    console.error('Get suppliers error:', err.message);
    res.status(500).json({ error: 'Get suppliers failed', message: safeErr(err) });
  }
});

// Update owner-side fields on a supplier relationship — your naming / preferred / notes / category.
// Does NOT touch the supplier's own entity (that's theirs). Only the fields the owner controls.
router.patch('/suppliers/:id',
  [ body('nickname').optional({ nullable: true }).trim().isLength({ max: 80 }),
    body('category').optional({ nullable: true }).trim().isLength({ max: 50 }),
    body('notes').optional({ nullable: true }).trim().isLength({ max: 2000 }),
    body('preferred').optional().isBoolean() ],
  validate, auth,
  async (req, res) => {
    try {
      const owner = ctx(req);
      const sets = [], vals = []; let n = 1;
      if ('nickname'  in req.body) { sets.push(`nickname = $${n++}`);  vals.push(sanitise(req.body.nickname || '') || null); }
      if ('category'  in req.body) { sets.push(`category = $${n++}`);  vals.push(sanitise(req.body.category || '') || null); }
      if ('notes'     in req.body) { sets.push(`notes = $${n++}`);     vals.push(sanitise(req.body.notes || '') || null); }
      if ('preferred' in req.body) { sets.push(`preferred = $${n++}`); vals.push(req.body.preferred === true || req.body.preferred === 'true'); }
      if (!sets.length) return res.status(400).json({ error: 'Nothing to update', message: 'Provide nickname, category, notes, or preferred' });
      vals.push(req.params.id, owner);
      const r = await query(
        `UPDATE supplier_list SET ${sets.join(', ')}
         WHERE supplier_list_id = $${n++} AND owner_entity_id = $${n} RETURNING supplier_list_id`, vals);
      if (r.rows.length === 0) return res.status(404).json({ error: 'Not found' });
      res.json({ message: 'Supplier updated' });
    } catch (err) {
      console.error('Update supplier error:', err.message);
      res.status(500).json({ error: 'Update failed', message: safeErr(err) });
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
    res.status(500).json({ error: 'Remove supplier failed', message: safeErr(err) });
  }
});

// Fetch a supplier's catalogue (schema fields + products) to draft an order chit (D-059).
// Mirrors the PHP supplierCompose flow: select supplier -> see their catalogue -> compose.
router.get('/suppliers/:supplier_entity_id/catalogue', auth, async (req, res) => {
  try {
    const sid = req.params.supplier_entity_id;
    const sup = await query(
      `SELECT identity_id, display_name, bridge_id, currency_code, business_status
       FROM identities WHERE identity_id = $1 AND identity_type = 'entity' AND COALESCE(sealed, false) = false`, [sid]);
    const supplier = sup.rows[0] || null;
    if (!supplier) return res.json({ supplier: null, schema: null, fields: [], items: [], finishes: [] });
    // ── ONE CATALOGUE READ (SPEC-one-path-many-principals) ────────────────────────────────────────────────────
    // This used to be a second, older implementation of "read a catalogue": it returned only the supplier's OWN
    // catalogue_items and knew nothing of `finishes` (where published/adopted TEMPLATES live) or `order_input` (the
    // declaration), so a buyer could not even learn what a form asks for. Proven live by scripts/journey-supplier-hop.js.
    // It now calls the SAME resolver the public storefront uses, so a new surface is a new principal, not a new endpoint.
    //
    // ACCESS: this returns exactly the ANONYMOUS storefront payload — no more. That is deliberate and load-bearing:
    //   • GET /api/catalogue/:bridge_id is PUBLIC, so everything here is already world-readable; serving it to a
    //     logged-in entity adds ZERO exposure, and the F7 concern (reading another entity's catalogue via the :id in
    //     the URL) is satisfied by the fact that anyone could read it anonymously anyway.
    //   • Adding a supplier is UNILATERAL (POST /suppliers inserts with no consent from the supplier), so being
    //     "related" is SELF-ASSERTED and must NOT authorise anything beyond public. A tier that shows more needs
    //     bilateral consent, which supplier_list does not model. Do not add one until it does.
    const view = await catalogueView.buildPublicView({ entity: supplier, query, withEntity, catalogueBuild, orderInput, identity: require('../lib/identity'), catalogueRead: require('../lib/catalogue-read'), container: require('../lib/container') });
    if (!view.available) return res.json({ supplier, schema: null, fields: [], items: [], groups: [], finishes: [] });
    res.json({ supplier, shop: view.shop, schema: view.schema, fields: view.fields, items: view.items,
      groups: view.groups, lines: view.lines, catalogue_summary: view.catalogue_summary,
      unpriced_hidden: view.unpriced_hidden,
      finishes: view.finishes });
  } catch (err) {
    res.status(500).json({ error: 'Get catalogue failed', message: safeErr(err) });
  }
});

// ── CUSTOMERS (auto-added — D-065; segment computed on read — D-067) ──

router.get('/customers', auth, async (req, res) => {
  try {
    const owner   = ctx(req);
    const segment = (req.query.segment || '').trim();
    // B1 RLS: customer_list is owner-scoped (owner_entity_id) -> withEntity(me).
    const r = await withEntity(owner, (db) => db.query(
      `SELECT cl.customer_list_id, cl.customer_type, cl.added_via,
              cl.txn_count, cl.last_txn_at,
              i.identity_id AS customer_identity_id, i.bridge_id, i.display_name,
              i.email, i.phone, i.otp_contact, i.created_at AS customer_since, i.identity_type, i.owner_scope,
              COALESCE(cl.segment_override,
                CASE WHEN cl.last_txn_at < NOW() - INTERVAL '90 days' THEN 'inactive'
                     WHEN cl.txn_count >= 3 THEN 'regular'
                     ELSE 'new' END) AS segment
       FROM customer_list cl
       JOIN identities i ON i.identity_id = cl.customer_identity_id
       WHERE cl.owner_entity_id = $1
         AND NOT EXISTS (
           SELECT 1 FROM supplier_list sl
           WHERE sl.owner_entity_id = $1 AND sl.supplier_entity_id = cl.customer_identity_id
         )
       ORDER BY cl.last_txn_at DESC NULLS LAST`, [owner]));
    const rows = segment ? r.rows.filter(c => c.segment === segment) : r.rows;
    res.json({ customers: rows, count: rows.length });
  } catch (err) {
    console.error('Get customers error:', err.message);
    res.status(500).json({ error: 'Get customers failed', message: safeErr(err) });
  }
});

// Manual segment override (optional)
router.patch('/customers/:id',
  [ body('segment_override').isIn(['high_value','regular','new','inactive']) ],
  validate, auth,
  async (req, res) => {
    try {
      const owner = ctx(req);
      const r = await withEntity(owner, (db) => db.query(
        `UPDATE customer_list SET segment_override = $1
         WHERE customer_list_id = $2 AND owner_entity_id = $3 RETURNING customer_list_id`,
        [req.body.segment_override, req.params.id, owner]));
      if (r.rows.length === 0) return res.status(404).json({ error: 'Not found' });
      res.json({ message: 'Segment updated' });
    } catch (err) {
      res.status(500).json({ error: 'Update segment failed', message: safeErr(err) });
    }
  });

module.exports = router;
