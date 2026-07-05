// routes/connectors.js — L3.1: connector as a first-class ACTOR (an `identities` row) + its endpoints (connections).
// A connector actor = identities row {identity_type:'actor', connector_type:'iot'|'erp'} under the entity — so it
// shows in Co-assists as a VISIBLE IDENTITY and reuses the actor/RLS-carveout infra. Endpoints live in
// `connector_connection` (b57). Every route is auth'd + gated on the entity's `connector` capability.
// Emit-through-connection + receipts = the next step (L3.4); the manual emit (cap-connector.js) still works meanwhile.
const express = require('express');
const router  = express.Router();
const { v4: uuidv4 } = require('uuid');
const { query: db } = require('../db');
const { safeErr } = require('../lib/respond');
const { body, param } = require('express-validator');
const { validate, sanitise } = require('../middleware/validate');
const auth    = require('../middleware/auth');

const generateBridgeId = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id = 'CB';
  for (let i = 0; i < 8; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
};

// the OWNING entity for the caller (an actor acts under its parent entity)
const ownerEntityId = (req) => req.identity.parent_entity_id || req.identity.identity_id;

// capability gate — the entity must carry 'connector' in identities.capabilities (L3.5: API-enforced, not just UI)
async function requireConnector(req, res, next) {
  try {
    const eid = ownerEntityId(req);
    const r = await db('SELECT capabilities FROM identities WHERE identity_id = $1', [eid]);
    const caps = (r.rows[0] && r.rows[0].capabilities) || [];
    if (Array.isArray(caps) && caps.indexOf('connector') >= 0) return next();
    return res.status(403).json({ error: 'Capability off', message: 'The connector capability is not enabled for this entity.' });
  } catch (err) {
    return res.status(500).json({ error: 'Gate check failed', message: safeErr(err) });
  }
}

// ownership guard — the connector actor must be an actor identities row under this entity
async function ownedConnector(actor_id, entity_id) {
  const r = await db(
    `SELECT identity_id, display_name, connector_type FROM identities
      WHERE identity_id = $1 AND parent_entity_id = $2 AND identity_type = 'actor' AND connector_type IS NOT NULL`,
    [actor_id, entity_id]);
  return r.rows[0] || null;
}

// POST /api/connectors — create a connector actor (visible in Co-assists)
router.post('/', auth, requireConnector,
  [ body('display_name').trim().isLength({ min: 2 }).withMessage('Name required'),
    body('type').isIn(['iot', 'erp']).withMessage('type must be iot or erp'),
    body('actor_key').optional().trim().matches(/^[a-z0-9]+$/) ],
  validate,
  async (req, res) => {
    try {
      const entity_id    = ownerEntityId(req);
      const display_name = sanitise(req.body.display_name);
      const type         = req.body.type;
      const actor_key    = (req.body.actor_key || ('conn' + Math.random().toString(36).slice(2, 7))).toLowerCase();
      const identity_id  = uuidv4();
      const bridge_id    = generateBridgeId();
      // passive machine identity: OTP fields set (mirror the proven actor insert) but never used for login.
      const otp          = Math.floor(100000 + Math.random() * 900000).toString();
      const otp_expires  = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      await db(
        `INSERT INTO identities
           (identity_id, bridge_id, display_name, actor_key, actor_type, parent_entity_id, actor_role, phone,
            max_tasks, identity_type, status, break_status, otp_code, otp_expires_at, hat, connector_type)
         VALUES ($1,$2,$3,$4,'human',$5,NULL,NULL,10,'actor','active','active',$6,$7,'act',$8)`,
        [identity_id, bridge_id, display_name, actor_key, entity_id, otp, otp_expires, type]);
      res.json({ message: 'Connector created', connector: { identity_id, display_name, type, actor_key, bridge_id } });
    } catch (err) {
      res.status(500).json({ error: 'Create failed', message: safeErr(err) });
    }
  });

// GET /api/connectors — list this entity's connector actors
router.get('/', auth, requireConnector, async (req, res) => {
  try {
    const entity_id = ownerEntityId(req);
    const r = await db(
      `SELECT identity_id, display_name, actor_key, connector_type, status, created_at
         FROM identities
        WHERE parent_entity_id = $1 AND identity_type = 'actor' AND connector_type IS NOT NULL
        ORDER BY created_at DESC`, [entity_id]);
    res.json({ connectors: r.rows });
  } catch (err) { res.status(500).json({ error: 'List failed', message: safeErr(err) }); }
});

// POST /api/connectors/:actorId/connections — add an endpoint/device binding under a connector actor
router.post('/:actorId/connections', auth, requireConnector,
  [ param('actorId').isUUID(),
    body('direction').optional().isIn(['in', 'out']),
    body('ref').trim().isLength({ min: 1 }).withMessage('endpoint/device ref required'),
    body('schema_ref').optional().trim(),
    body('counterparty_entity_id').optional().isUUID(),
    body('retention').optional().isIn(['never_persist', 'persist_then_purge']) ],
  validate,
  async (req, res) => {
    try {
      const entity_id = ownerEntityId(req);
      const actor = await ownedConnector(req.params.actorId, entity_id);
      if (!actor) return res.status(404).json({ error: 'Not found', message: 'No such connector under this entity.' });
      const direction    = req.body.direction || 'in';
      const schema_ref   = req.body.schema_ref || null;
      const counterparty = req.body.counterparty_entity_id || null;
      const retention    = req.body.retention || 'never_persist';
      const r = await db(
        `INSERT INTO connector_connection
           (actor_id, entity_id, direction, ref, schema_ref, counterparty_entity_id, retention)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [actor.identity_id, entity_id, direction, sanitise(req.body.ref), schema_ref, counterparty, retention]);
      res.json({ message: 'Connection added', connection: r.rows[0] });
    } catch (err) { res.status(500).json({ error: 'Add connection failed', message: safeErr(err) }); }
  });

// GET /api/connectors/:actorId/connections — list a connector's connections
router.get('/:actorId/connections', auth, requireConnector,
  [ param('actorId').isUUID() ], validate,
  async (req, res) => {
    try {
      const entity_id = ownerEntityId(req);
      const actor = await ownedConnector(req.params.actorId, entity_id);
      if (!actor) return res.status(404).json({ error: 'Not found' });
      const r = await db(
        `SELECT * FROM connector_connection WHERE actor_id = $1 AND entity_id = $2 ORDER BY created_at DESC`,
        [actor.identity_id, entity_id]);
      res.json({ connections: r.rows });
    } catch (err) { res.status(500).json({ error: 'List connections failed', message: safeErr(err) }); }
  });

// PATCH /api/connectors/:actorId/connections/:connId — enable/disable a connection (per-endpoint kill switch)
router.patch('/:actorId/connections/:connId', auth, requireConnector,
  [ param('actorId').isUUID(), param('connId').isInt(), body('enabled').isBoolean() ], validate,
  async (req, res) => {
    try {
      const entity_id = ownerEntityId(req);
      const actor = await ownedConnector(req.params.actorId, entity_id);
      if (!actor) return res.status(404).json({ error: 'Not found' });
      const r = await db(
        `UPDATE connector_connection SET enabled = $1
          WHERE connection_id = $2 AND actor_id = $3 AND entity_id = $4 RETURNING *`,
        [req.body.enabled, req.params.connId, actor.identity_id, entity_id]);
      if (!r.rows[0]) return res.status(404).json({ error: 'Not found' });
      res.json({ message: 'Updated', connection: r.rows[0] });
    } catch (err) { res.status(500).json({ error: 'Update failed', message: safeErr(err) }); }
  });

module.exports = router;
