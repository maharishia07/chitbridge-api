// routes/connectors.js — L3.1+ : a connector = a first-class ACTOR (identities row) grouped by SITE (Model 1),
// holding its connection string (IoT: CB-issued ActorKey+endpoint, or your broker · ERP: base_url+auth_ref),
// owning CONNECTIONS (devices/endpoints) each with its own bridge_id + config. Health is last_seen-based and
// CASCADES: a Pi/system offline => every connection under it reports no-signal (the sensors may be fine, the
// pipe is down). Every route is auth'd + gated on the entity's 'connector' capability. (b62 schema.)
const express = require('express');
const router  = express.Router();
const crypto  = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { query: db, withEntity } = require('../db');
const { safeErr } = require('../lib/respond');
const { body, param } = require('express-validator');
const { validate, sanitise } = require('../middleware/validate');
const auth    = require('../middleware/auth');

const generateBridgeId = () => { const c='ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let id='CB'; for (let i=0;i<8;i++) id+=c[Math.floor(Math.random()*c.length)]; return id; };
const genKey  = () => crypto.randomBytes(24).toString('base64url');            // ActorKey — returned ONCE on IoT push create
const hashKey = (k) => crypto.createHash('sha256').update(k).digest('hex');    // only the hash is stored
// health from last_seen: never / stale >15m = offline, >3m = slow, else live
function health(last_seen){ if (!last_seen) return 'offline'; const age = Date.now() - new Date(last_seen).getTime(); if (age > 15*60*1000) return 'offline'; if (age > 3*60*1000) return 'slow'; return 'live'; }

const ownerEntityId = (req) => req.identity.parent_entity_id || req.identity.identity_id;

// capability gate — the entity must carry 'connector' (API-enforced, not just UI)
async function requireConnector(req, res, next) {
  try {
    const eid = ownerEntityId(req);
    const r = await db('SELECT capabilities FROM identities WHERE identity_id = $1', [eid]);
    const caps = (r.rows[0] && r.rows[0].capabilities) || [];
    if (Array.isArray(caps) && caps.indexOf('connector') >= 0) return next();
    return res.status(403).json({ error: 'Capability off', message: 'The connector capability is not enabled for this entity.' });
  } catch (err) { return res.status(500).json({ error: 'Gate check failed', message: safeErr(err) }); }
}

// ownership guard — the connector actor must be an actor identities row under this entity
async function ownedConnector(actor_id, entity_id) {
  const r = await db(
    `SELECT identity_id, display_name, connector_type, site, connector_config, last_seen
       FROM identities
      WHERE identity_id = $1 AND parent_entity_id = $2 AND identity_type = 'actor' AND connector_type IS NOT NULL`,
    [actor_id, entity_id]);
  return r.rows[0] || null;
}

// POST /api/connectors — create a connector actor (a Pi, or an ERP system). IoT push → we ISSUE an ActorKey (once).
router.post('/', auth, requireConnector,
  [ body('display_name').trim().isLength({ min: 2 }).withMessage('Name required'),
    body('type').isIn(['iot', 'erp']).withMessage('type must be iot or erp'),
    body('site').optional().trim(),
    body('config').optional().isObject() ],
  validate,
  async (req, res) => {
    try {
      const entity_id    = ownerEntityId(req);
      const display_name = sanitise(req.body.display_name);
      const type         = req.body.type;
      const site         = req.body.site ? sanitise(req.body.site) : null;
      const config       = req.body.config || {};   // IoT: {mode:'push'|'pull', endpoint, host, port} · ERP: {base_url, auth_type, auth_ref}
      const actor_key    = ('conn' + Math.random().toString(36).slice(2, 7)).toLowerCase();
      const identity_id  = uuidv4();
      const bridge_id    = generateBridgeId();
      const otp          = Math.floor(100000 + Math.random() * 900000).toString();
      const otp_expires  = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      // IoT push: issue the device ActorKey now, store only its hash, return the raw ONCE (for provisioning the Pi).
      let provision_key = null, key_hash = null;
      if (type === 'iot' && (config.mode || 'push') === 'push') { provision_key = genKey(); key_hash = hashKey(provision_key); }
      await db(
        `INSERT INTO identities
           (identity_id, bridge_id, display_name, actor_key, actor_type, parent_entity_id, actor_role, phone,
            max_tasks, identity_type, status, break_status, otp_code, otp_expires_at, hat, connector_type,
            site, connector_config, provision_key_hash)
         VALUES ($1,$2,$3,$4,'human',$5,NULL,NULL,10,'actor','active','active',$6,$7,'act',$8,$9,$10,$11)`,
        [identity_id, bridge_id, display_name, actor_key, entity_id, otp, otp_expires, type,
         site, JSON.stringify(config), key_hash]);
      res.json({ message: 'Connector created',
        connector: { identity_id, display_name, type, bridge_id, site, connector_config: config, health: 'offline' },
        provision_key });   // shown ONCE
    } catch (err) { res.status(500).json({ error: 'Create failed', message: safeErr(err) }); }
  });

// Build + deliver a Device Signal chit (sender = the connector's OWNING ENTITY, receiver = the counterparty),
// reusing the SAME b50 `chit_deliver` primitive the /send route uses — no line items, the reading is the payload.
// Throws if the delivery layer isn't installed or the counterparty is gone; the caller keeps the heartbeat regardless.
async function emitSignalChit({ entity_id, actor, counterparty, signal, value, unit, device_id, bridge_id }) {
  const ent = await db(`SELECT bridge_id, display_name FROM identities WHERE identity_id = $1`, [entity_id]);
  const sender = ent.rows[0]; if (!sender) throw new Error('owning entity not found');
  const rc = await db(`SELECT identity_id, bridge_id, display_name FROM identities WHERE identity_id = $1 AND status = 'active'`, [counterparty]);
  const receiver = rc.rows[0]; if (!receiver) throw new Error('counterparty not found or inactive');

  const chit_id = uuidv4();
  const purpose = 'general';
  const now = new Date();
  const business_json = { kind: 'device_signal', device_id, signal, value, unit, bridge_id, source: 'connector_ingest', at: now.toISOString() };
  const manual_subject = 'Signal: ' + signal + (value != null ? (' = ' + value + (unit || '')) : '');
  const auto_subject = 'Signal from ' + (actor.display_name || sender.display_name) + ' — ' + now.toISOString().slice(0, 10);
  const all_recipients = [
    { entity_id, bridge_id: sender.bridge_id, display_name: sender.display_name, role: 'sender' },
    { entity_id: receiver.identity_id, bridge_id: receiver.bridge_id, display_name: receiver.display_name, role: 'receiver' },
  ];
  const summary_json = { line_item_count: 0, total_value: 0, currency_code: 'INR', priority_external: 'normal', purpose, is_promotion: false, forwarded_from: null };
  const headerCommon = {
    sender_entity_id: entity_id, sender_entity_bridge_id: sender.bridge_id, sender_entity_display_name: sender.display_name,
    all_recipients, purpose, auto_subject, manual_subject, summary_json,
    schema_version: null, schema_id: null, created_by_actor_id: actor.identity_id,
    detail_type: purpose, line_item_count: 0, total_value: 0, currency_code: 'INR',
  };
  const copies = [
    { ...headerCommon, business_json, entity_id, direction: 'sent', role: 'Act',
      current_status: 'delivered', priority_flag: 'normal', payload_delivered: true,
      log: { action: 'created', action_by_identity_id: entity_id, action_by_display_name: sender.display_name, new_status: 'delivered', detail: 'Device signal emitted to ' + receiver.display_name } },
    { ...headerCommon, business_json, entity_id: receiver.identity_id, direction: 'received', role: 'Act',
      current_status: 'pending', priority_flag: 'normal',
      log: { action: 'delivered', action_by_identity_id: entity_id, action_by_display_name: sender.display_name, new_status: 'pending', detail: 'Device signal received from ' + sender.display_name } },
  ];
  await withEntity(entity_id, (dbx) => dbx.query(`SELECT chit_deliver($1,$2,$3::jsonb)`, [chit_id, false, JSON.stringify(copies)]));
  return chit_id;
}

// POST /api/connectors/ingest — DEVICE-FACING. Auth by the CB-issued ActorKey (X-Bridge-Key header), NOT a user JWT.
// The Pi/gateway calls THIS: (1) prove identity with its own key, (2) heartbeat -> the cockpit health dot goes LIVE,
// (3) emit the reading as a co-held Device Signal chit to the connection's counterparty. One call, own credential.
// By design there is NO `auth` middleware here (a device has no session); abuse-throttling is a tracked backlog item.
router.post('/ingest',
  [ body('signal').optional().trim().isLength({ max: 64 }),
    body('bridge_id').optional().trim(),
    body('unit').optional().trim().isLength({ max: 16 }),
    body('device_id').optional().trim().isLength({ max: 64 }) ],
  validate,
  async (req, res) => {
    try {
      const key = (req.get('X-Bridge-Key') || (req.body && req.body.key) || '').toString().trim();
      if (!key) return res.status(401).json({ error: 'No key', message: 'Send the ActorKey in the X-Bridge-Key header.' });
      const ar = await db(
        `SELECT identity_id, parent_entity_id, display_name, connector_type, status
           FROM identities
          WHERE provision_key_hash = $1 AND identity_type = 'actor' AND connector_type IS NOT NULL`, [hashKey(key)]);
      const actor = ar.rows[0];
      if (!actor || actor.status !== 'active') return res.status(401).json({ error: 'Bad key', message: 'ActorKey not recognised, or the connector is inactive.' });

      const entity_id = actor.parent_entity_id;
      const bridge_id = req.body.bridge_id ? String(req.body.bridge_id).trim() : null;

      // Resolve the device/connection when a BridgeId is given — it must belong to THIS actor and be enabled.
      let conn = null;
      if (bridge_id) {
        const cr = await db(`SELECT * FROM connector_connection WHERE actor_id = $1 AND bridge_id = $2`, [actor.identity_id, bridge_id]);
        conn = cr.rows[0] || null;
        if (!conn) return res.status(404).json({ error: 'Unknown device', message: 'No connection with that bridge_id under this connector.' });
        if (conn.enabled === false) return res.status(409).json({ error: 'Disabled', message: 'This connection is disabled.' });
      }

      // (2) HEARTBEAT — health goes live for the Pi (and this device). Saved independently of the chit emit below.
      await db(`UPDATE identities SET last_seen = NOW() WHERE identity_id = $1`, [actor.identity_id]);
      if (bridge_id) await db(`UPDATE connector_connection SET last_seen = NOW() WHERE actor_id = $1 AND bridge_id = $2`, [actor.identity_id, bridge_id]);

      // (3) EMIT the reading as a chit to the counterparty (best-effort — the heartbeat is already committed).
      const counterparty = (conn && conn.counterparty_entity_id) || (req.body.to ? String(req.body.to).trim() : null);
      let chit_id = null, note = null;
      if (!counterparty) {
        note = 'Heartbeat only — no counterparty on the connection (set one to route signals as chits).';
      } else {
        try {
          chit_id = await emitSignalChit({
            entity_id, actor, counterparty,
            signal: req.body.signal || 'signal',
            value: (req.body.value != null ? String(req.body.value) : null),
            unit: req.body.unit || null,
            device_id: req.body.device_id || (conn && conn.ref) || null,
            bridge_id,
          });
        } catch (e) { note = 'Health updated, but the signal chit could not be delivered: ' + safeErr(e); }
      }
      res.json({ message: 'ingested', health: 'live', last_seen: new Date().toISOString(), chit_id, note });
    } catch (err) { res.status(500).json({ error: 'Ingest failed', message: safeErr(err) }); }
  });

// GET /api/connectors — list connector actors (site, config, health) so the UI can group by site
router.get('/', auth, requireConnector, async (req, res) => {
  try {
    const entity_id = ownerEntityId(req);
    const r = await db(
      `SELECT identity_id, display_name, connector_type, site, connector_config, last_seen, status, created_at,
              (SELECT COUNT(*) FROM connector_connection cc WHERE cc.actor_id = identities.identity_id) AS connection_count
         FROM identities
        WHERE parent_entity_id = $1 AND identity_type = 'actor' AND connector_type IS NOT NULL
        ORDER BY site NULLS LAST, created_at DESC`, [entity_id]);
    res.json({ connectors: r.rows.map(a => ({ ...a, health: health(a.last_seen) })) });
  } catch (err) { res.status(500).json({ error: 'List failed', message: safeErr(err) }); }
});

// GET /api/connectors/:actorId/provisioning — the connection string to put on the Pi (IoT) / the ERP system config
router.get('/:actorId/provisioning', auth, requireConnector, [param('actorId').isUUID()], validate, async (req, res) => {
  try {
    const entity_id = ownerEntityId(req);
    const actor = await ownedConnector(req.params.actorId, entity_id);
    if (!actor) return res.status(404).json({ error: 'Not found' });
    const conns = await db(`SELECT bridge_id, ref, conn_config FROM connector_connection WHERE actor_id = $1 AND entity_id = $2 ORDER BY created_at`, [actor.identity_id, entity_id]);
    const cfg = actor.connector_config || {};
    if (actor.connector_type === 'iot') {
      return res.json({ type: 'iot', mode: cfg.mode || 'push',
        endpoint: cfg.endpoint || 'ingest.chitbridge.io:8883',
        note: 'ActorKey is shown once at creation — Regenerate to re-issue. Flash Endpoint + ActorKey on the Pi; it publishes these BridgeIds.',
        publishes: conns.rows.map(c => ({ bridge_id: c.bridge_id, ref: c.ref, topic: (c.conn_config || {}).topic || null })) });
    }
    return res.json({ type: 'erp', base_url: cfg.base_url || null, auth_type: cfg.auth_type || null, auth_ref: cfg.auth_ref || null,
      endpoints: conns.rows.map(c => ({ bridge_id: c.bridge_id, ref: c.ref, path: (c.conn_config || {}).path || null })) });
  } catch (err) { res.status(500).json({ error: 'Provisioning failed', message: safeErr(err) }); }
});

// POST /api/connectors/:actorId/regenerate-key — issue a FRESH ActorKey (invalidates the old one, since we only
// ever store the hash). Returned ONCE. This is the recovery path when the create-time key wasn't copied.
router.post('/:actorId/regenerate-key', auth, requireConnector, [param('actorId').isUUID()], validate, async (req, res) => {
  try {
    const entity_id = ownerEntityId(req);
    const actor = await ownedConnector(req.params.actorId, entity_id);
    if (!actor) return res.status(404).json({ error: 'Not found' });
    const provision_key = genKey();
    await db(`UPDATE identities SET provision_key_hash = $1 WHERE identity_id = $2`, [hashKey(provision_key), actor.identity_id]);
    res.json({ message: 'ActorKey regenerated', provision_key });   // shown ONCE — the old key stops working immediately
  } catch (err) { res.status(500).json({ error: 'Regenerate failed', message: safeErr(err) }); }
});

// POST /api/connectors/:actorId/ping — heartbeat seam: marks the connector (and optionally one bridge) live.
// Used by the app "Test connection" button today; the real device/gateway will call the ingest path (next milestone).
router.post('/:actorId/ping', auth, requireConnector, [param('actorId').isUUID()], validate, async (req, res) => {
  try {
    const entity_id = ownerEntityId(req);
    const actor = await ownedConnector(req.params.actorId, entity_id);
    if (!actor) return res.status(404).json({ error: 'Not found' });
    await db(`UPDATE identities SET last_seen = NOW() WHERE identity_id = $1`, [actor.identity_id]);
    if (req.body && req.body.bridge_id) await db(`UPDATE connector_connection SET last_seen = NOW() WHERE actor_id = $1 AND bridge_id = $2`, [actor.identity_id, req.body.bridge_id]);
    res.json({ message: 'pong', last_seen: new Date().toISOString(), health: 'live' });
  } catch (err) { res.status(500).json({ error: 'Ping failed', message: safeErr(err) }); }
});

// POST /api/connectors/:actorId/connections — add a device/endpoint (its own bridge_id + type-specific config)
router.post('/:actorId/connections', auth, requireConnector,
  [ param('actorId').isUUID(),
    body('direction').optional().isIn(['in', 'out']),
    body('ref').trim().isLength({ min: 1 }).withMessage('endpoint/device ref required'),
    body('schema_ref').optional().trim(),
    body('counterparty_entity_id').optional().isUUID(),
    body('retention').optional().isIn(['never_persist', 'persist_then_purge']),
    body('config').optional().isObject() ],
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
      const config       = req.body.config || {};   // IoT: {protocol,host,port,topic,device_id} · ERP: {path}
      const bridge_id    = generateBridgeId();
      const r = await db(
        `INSERT INTO connector_connection
           (actor_id, entity_id, direction, ref, schema_ref, counterparty_entity_id, retention, bridge_id, conn_config)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [actor.identity_id, entity_id, direction, sanitise(req.body.ref), schema_ref, counterparty, retention, bridge_id, JSON.stringify(config)]);
      res.json({ message: 'Connection added', connection: r.rows[0] });
    } catch (err) { res.status(500).json({ error: 'Add connection failed', message: safeErr(err) }); }
  });

// GET /api/connectors/:actorId/connections — list; signal CASCADES from the actor's health
router.get('/:actorId/connections', auth, requireConnector, [param('actorId').isUUID()], validate, async (req, res) => {
  try {
    const entity_id = ownerEntityId(req);
    const actor = await ownedConnector(req.params.actorId, entity_id);
    if (!actor) return res.status(404).json({ error: 'Not found' });
    const actorHealth = health(actor.last_seen);
    const r = await db(`SELECT * FROM connector_connection WHERE actor_id = $1 AND entity_id = $2 ORDER BY created_at DESC`, [actor.identity_id, entity_id]);
    // CASCADE: if the Pi/system is offline, every connection reports no-signal regardless of its own last_seen.
    const connections = r.rows.map(c => ({ ...c, signal: actorHealth === 'offline' ? 'no_signal' : health(c.last_seen) }));
    res.json({ actor_health: actorHealth, connections });
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
