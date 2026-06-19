// routes/catalogue.js — B3.7 Public catalogue + end-customer order (no business login)
const express = require('express');
const router  = express.Router();
const { body } = require('express-validator');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { query, withTransaction } = require('../db');
const { validate, sanitise } = require('../middleware/validate');
const auth = require('../middleware/auth');

const genBridge = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id = 'CB';
  for (let i = 0; i < 8; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
};
const genOTP = () => (process.env.DEV_OTP || '').trim() || Math.floor(100000 + Math.random() * 900000).toString();
const cleanPhone = (p) => String(p || '').replace(/[^0-9+]/g, '');

async function resolveEntity(bridge_id) {
  const r = await query(
    `SELECT identity_id, display_name, bridge_id, currency_code, gstn, is_verified, logo_url, address, business_status
     FROM identities WHERE bridge_id = $1 AND identity_type = 'entity' AND status = 'active'`,
    [bridge_id]);
  return r.rows[0] || null;
}

// ── CJ-02: public catalogue (only when visibility='public') ──
router.get('/:bridge_id', async (req, res) => {
  try {
    const entity = await resolveEntity(req.params.bridge_id);
    if (!entity) return res.status(404).json({ error: 'Not found', message: 'Shop not found' });
    const sch = await query(
      `SELECT schema_id, schema_name FROM entity_schemas
       WHERE entity_id = $1 AND status = 'active' AND is_default = true AND visibility = 'public' LIMIT 1`,
      [entity.identity_id]);
    if (!sch.rows.length) return res.status(404).json({ error: 'Not available', message: 'This shop has no public catalogue' });
    const fields = await query(
      `SELECT field_key, field_name, field_type, required, min_value, display_order
       FROM schema_fields WHERE schema_id = $1 ORDER BY display_order`, [sch.rows[0].schema_id]);
    const items = await query(
      `SELECT item_id, item_data FROM catalogue_items
       WHERE entity_id = $1 AND is_active = true ORDER BY created_at DESC`,
      [entity.identity_id]);
    res.json({
      shop: {
        bridge_id: entity.bridge_id, display_name: entity.display_name,
        currency_code: entity.currency_code,
        gstn: entity.gstn, is_verified: entity.is_verified,
        logo_url: entity.logo_url, address: entity.address,   // B3.9 — identity/trust
        business_status: entity.business_status || 'open'      // B3.11 — open | closed | away
      },
      schema: sch.rows[0],
      fields: fields.rows,
      items:  items.rows           // B3.7a — the actual products
    });
  } catch (err) { console.error('catalogue get:', err.message); res.status(500).json({ error: 'Catalogue failed', message: err.message }); }
});

// ── CJ-05a: order-first — enter phone → create/find end_customer scoped to entity → OTP ──
router.post('/:bridge_id/order/start',
  [ body('phone').trim().isLength({ min: 6, max: 20 }).withMessage('Phone required') ],
  validate,
  async (req, res) => {
    try {
      const entity = await resolveEntity(req.params.bridge_id);
      if (!entity) return res.status(404).json({ error: 'Not found', message: 'Shop not found' });
      if (entity.business_status === 'closed')
        return res.status(403).json({ error: 'Shop closed', message: 'This shop is currently closed and not accepting orders.' });
      const phone  = cleanPhone(req.body.phone);
      const name   = sanitise(req.body.name || '') || phone;
      const handle = `${phone}@${entity.bridge_id}.cr`;          // .cr marker + entity scope

      let existing = await query(`SELECT identity_id, bridge_id FROM identities WHERE email = $1`, [handle]);
      let identity_id, bridge_id;
      if (existing.rows.length) {
        identity_id = existing.rows[0].identity_id; bridge_id = existing.rows[0].bridge_id;
      } else {
        identity_id = uuidv4(); bridge_id = genBridge();
        await query(
          `INSERT INTO identities
             (identity_id, bridge_id, display_name, email, phone, identity_type, parent_entity_id, owner_scope, auth_method, status)
           VALUES ($1,$2,$3,$4,$5,'customer',$6,'entity','otp','pending')`,
          [identity_id, bridge_id, name, handle, phone, entity.identity_id]);
      }
      const otp = genOTP();
      await query(`UPDATE identities SET otp_code = $1, otp_expires_at = $2 WHERE identity_id = $3`,
        [otp, new Date(Date.now() + 60 * 60 * 1000), identity_id]);
      console.log(`[DEV] Customer OTP for ${handle}: ${otp}`);   // no SMS in dev/testing
      const emailDisabled = process.env.OTP_EMAIL_ENABLED !== 'true';
      res.json({
        message: process.env.DEV_OTP ? `Dev mode — OTP: ${otp}` : 'Code sent to your phone',
        ...((process.env.DEV_OTP || emailDisabled) && { dev_otp: otp })
      });
    } catch (err) { console.error('order/start:', err.message); res.status(500).json({ error: 'Order start failed', message: err.message }); }
  });

// ── CJ-05b + CJ-06: verify OTP → place guaranteed chit (customer → shop) + auto-add to CRM ──
router.post('/:bridge_id/order/confirm',
  [ body('phone').trim().notEmpty(),
    body('otp').trim().isLength({ min: 6, max: 6 }),
    body('line_items').isArray({ min: 1 }).withMessage('Order is empty') ],
  validate,
  async (req, res) => {
    try {
      const entity = await resolveEntity(req.params.bridge_id);
      if (!entity) return res.status(404).json({ error: 'Not found', message: 'Shop not found' });
      if (entity.business_status === 'closed')
        return res.status(403).json({ error: 'Shop closed', message: 'This shop is currently closed and not accepting orders.' });
      const phone  = cleanPhone(req.body.phone);
      const handle = `${phone}@${entity.bridge_id}.cr`;

      const cr = await query(
        `SELECT identity_id, bridge_id, display_name, otp_code, otp_expires_at
         FROM identities WHERE email = $1`, [handle]);
      if (!cr.rows.length) return res.status(400).json({ error: 'Verify failed', message: 'Start the order first' });
      const c = cr.rows[0];
      if (c.otp_code !== req.body.otp.trim())          return res.status(400).json({ error: 'Verify failed', message: 'Incorrect code' });
      if (new Date() > new Date(c.otp_expires_at))     return res.status(400).json({ error: 'Verify failed', message: 'Code expired' });
      // build the guaranteed chit: customer = sender, shop = receiver
      const line_items = req.body.line_items;
      const chit_id = uuidv4();
      const total = line_items.reduce((s, i) => s + parseFloat(i.total || i.price * i.quantity || 0), 0);
      const summary_json = { line_item_count: line_items.length, total_value: Math.round(total * 100) / 100,
                             currency_code: entity.currency_code || 'INR', purpose: 'order', is_promotion: false };
      const auto_subject = `Order from ${c.display_name} — ` +
        new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
      const all_recipients = [
        { entity_id: c.identity_id,      bridge_id: c.bridge_id,      display_name: c.display_name,      role: 'sender' },
        { entity_id: entity.identity_id, bridge_id: entity.bridge_id, display_name: entity.display_name, role: 'receiver' }
      ];
      const li = JSON.stringify(line_items);
      const ar = JSON.stringify(all_recipients);
      const sj = JSON.stringify(summary_json);

      // freeze-at-send (A10): governing schema = the SHOP's active default schema
      const schemaRow = await query(
        `SELECT schema_id, schema_version FROM entity_schemas
          WHERE entity_id = $1 AND status = 'active' AND is_default = true
          ORDER BY created_at DESC LIMIT 1`,
        [entity.identity_id]
      );
      const frozen_schema_id      = schemaRow.rows[0]?.schema_id      || null;
      const frozen_schema_version = schemaRow.rows[0]?.schema_version || null;

      // guaranteed write: OTP consume + both chit records + timeline, all-or-nothing (INV-2)
      await withTransaction(async (client) => {
        await client.query(
          `UPDATE identities SET status='active', otp_code=NULL, otp_expires_at=NULL, last_active_at=NOW()
            WHERE identity_id=$1`, [c.identity_id]);

        // sender (customer) record
        await client.query(
          `INSERT INTO chit_header (chit_id, entity_id, sender_entity_id, sender_entity_bridge_id, sender_entity_display_name,
             all_recipients, purpose, auto_subject, summary_json, schema_version, schema_id, sent_at, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,'order',$7,$8,$9,$10,NOW(),NOW())`,
          [chit_id, c.identity_id, c.identity_id, c.bridge_id, c.display_name, ar, auto_subject, sj,
           frozen_schema_version, frozen_schema_id]);
        await client.query(
          `INSERT INTO chit_detail (chit_id, entity_id, detail_type, line_item_count, total_value, currency_code, line_items, payload_delivered_at)
           VALUES ($1,$2,'order',$3,$4,$5,$6,NOW())`,
          [chit_id, c.identity_id, summary_json.line_item_count, summary_json.total_value, summary_json.currency_code, li]);
        await client.query(`INSERT INTO chit_status (chit_id, entity_id, current_status) VALUES ($1,$2,'delivered')`, [chit_id, c.identity_id]);

        // receiver (shop) record
        await client.query(
          `INSERT INTO chit_header (chit_id, entity_id, sender_entity_id, sender_entity_bridge_id, sender_entity_display_name,
             all_recipients, purpose, auto_subject, summary_json, schema_version, schema_id, sent_at, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,'order',$7,$8,$9,$10,NOW(),NOW())`,
          [chit_id, entity.identity_id, c.identity_id, c.bridge_id, c.display_name, ar, auto_subject, sj,
           frozen_schema_version, frozen_schema_id]);
        await client.query(
          `INSERT INTO chit_detail (chit_id, entity_id, detail_type, line_item_count, total_value, currency_code, line_items)
           VALUES ($1,$2,'order',$3,$4,$5,$6)`,
          [chit_id, entity.identity_id, summary_json.line_item_count, summary_json.total_value, summary_json.currency_code, li]);
        await client.query(`INSERT INTO chit_status (chit_id, entity_id, current_status) VALUES ($1,$2,'pending')`, [chit_id, entity.identity_id]);

        // timeline — both sides, in the same commit (was best-effort; now guaranteed)
        await client.query(
          `INSERT INTO state_log (chit_id, entity_id, action, action_by_identity_id, action_by_display_name, new_status, detail)
           VALUES ($1,$2,'created',$3,$4,'delivered',$5),($1,$6,'delivered',$3,$4,'pending',$7)`,
          [chit_id, c.identity_id, c.identity_id, c.display_name, `Order placed to ${entity.display_name}`,
           entity.identity_id, `Order received from ${c.display_name}`]);
      });

      // CJ-06: best-effort CRM auto-add — after commit, never breaks the order
      try {
        await query(
          `INSERT INTO customer_list (owner_entity_id, customer_identity_id, customer_type, added_via, txn_count, last_txn_at)
           VALUES ($1,$2,'end_customer','catalogue',1,NOW())
           ON CONFLICT (owner_entity_id, customer_identity_id)
           DO UPDATE SET txn_count = customer_list.txn_count + 1, last_txn_at = NOW()`,
          [entity.identity_id, c.identity_id]);
      } catch (e) { console.log('customer auto-add skipped:', e.message); }

      // customer token (for future order tracking — CJ-F1)
      const token = jwt.sign(
        { identity_id: c.identity_id, bridge_id: c.bridge_id, display_name: c.display_name,
          email: handle, identity_type: 'customer', parent_entity_id: entity.identity_id },
        process.env.JWT_SECRET, { expiresIn: '7d' });

      res.json({ message: 'Order placed', chit_id, shop: entity.display_name, summary: summary_json, token });
    } catch (err) { console.error('order/confirm:', err.message); res.status(500).json({ error: 'Order failed', message: err.message }); }
  });

// ── CJ-F1: verify OTP for sign-in (no order) → customer token ──
router.post('/:bridge_id/login/verify',
  [ body('phone').trim().notEmpty(), body('otp').trim().isLength({ min: 6, max: 6 }) ],
  validate,
  async (req, res) => {
    try {
      const entity = await resolveEntity(req.params.bridge_id);
      if (!entity) return res.status(404).json({ error: 'Not found', message: 'Shop not found' });
      const phone  = cleanPhone(req.body.phone);
      const handle = `${phone}@${entity.bridge_id}.cr`;
      const cr = await query(
        `SELECT identity_id, bridge_id, display_name, otp_code, otp_expires_at
         FROM identities WHERE email = $1`, [handle]);
      if (!cr.rows.length) return res.status(400).json({ error: 'Sign-in failed', message: 'No account — place an order first' });
      const c = cr.rows[0];
      if (c.otp_code !== req.body.otp.trim())      return res.status(400).json({ error: 'Sign-in failed', message: 'Incorrect code' });
      if (new Date() > new Date(c.otp_expires_at)) return res.status(400).json({ error: 'Sign-in failed', message: 'Code expired' });
      await query(`UPDATE identities SET status='active', otp_code=NULL, otp_expires_at=NULL, last_active_at=NOW() WHERE identity_id=$1`, [c.identity_id]);
      const token = jwt.sign(
        { identity_id: c.identity_id, bridge_id: c.bridge_id, display_name: c.display_name,
          email: handle, identity_type: 'customer', parent_entity_id: entity.identity_id },
        process.env.JWT_SECRET, { expiresIn: '7d' });
      res.json({ message: 'Signed in', token, name: c.display_name });
    } catch (err) { res.status(500).json({ error: 'Sign-in failed', message: err.message }); }
  });

// ── CJ-F1: the signed-in customer's orders + live status ──
router.get('/:bridge_id/my-orders', auth, async (req, res) => {
  try {
    const me = req.identity.identity_id;
    const r = await query(
      `SELECT ch.chit_id, ch.auto_subject, ch.summary_json, ch.created_at, cs.current_status
       FROM chit_header ch
       JOIN chit_status cs ON cs.chit_id = ch.chit_id AND cs.entity_id = ch.entity_id
       WHERE ch.entity_id = $1 AND ch.purpose = 'order'
       ORDER BY ch.created_at DESC`, [me]);
    res.json({ orders: r.rows, count: r.rows.length });
  } catch (err) { res.status(500).json({ error: 'Orders failed', message: err.message }); }
});

module.exports = router;
