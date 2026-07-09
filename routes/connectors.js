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
const storage = require('../lib/storage');
const { resolveWorkPattern } = require('../lib/workpattern');   // the resolution seam — resolve-before-act
const { body, param } = require('express-validator');
const { validate, sanitise } = require('../middleware/validate');
const auth    = require('../middleware/auth');
const { sendOtpEmail, sendEmail } = require('../lib/notify');
const { verifyOtp } = require('../lib/otp');
// Reissue step-up code. In DEV (DEV_OTP set) use a FIXED 654321 — distinct from the login dev-OTP (123456) so the two
// are unmistakable during testing. In prod it's a fresh random 6-digit code.
const genOtp = () => (process.env.DEV_OTP ? '654321' : Math.floor(100000 + Math.random() * 900000).toString());

// Step-up authorisation for the destructive key reissue: ONLY the entity admin, or a MANAGER-hat delegate.
async function canReissue(req) {
  if (req.identity.identity_type === 'entity') return { ok: true, role: 'entity' };
  if (req.identity.identity_type === 'actor') {
    const r = await db(`SELECT hat FROM identities WHERE identity_id = $1 AND identity_type = 'actor'`, [req.identity.identity_id]);
    if (r.rows[0] && r.rows[0].hat === 'manager') return { ok: true, role: 'manager-delegate' };
  }
  return { ok: false };
}

const generateBridgeId = () => { const c='ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let id='CB'; for (let i=0;i<8;i++) id+=c[Math.floor(Math.random()*c.length)]; return id; };
const genKey  = () => crypto.randomBytes(24).toString('base64url');            // ActorKey — returned ONCE on IoT push create
const hashKey = (k) => crypto.createHash('sha256').update(k).digest('hex');    // only the hash is stored
// Canonical (key-sorted) hash of an ERP document — the ONLY trace we keep of the raw payload (process-then-forget).
// Sorting keys makes it order-independent so the SAME document from two clients dedupes to one receipt.
const stableStringify = (v) => {
  if (v === null || typeof v !== 'object') return JSON.stringify(v === undefined ? null : v);
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
  return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}';
};
const hashPayload = (v) => crypto.createHash('sha256').update(stableStringify(v)).digest('hex');
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
      // Issue the ActorKey now, store only its hash, return the raw ONCE. IoT push needs it to provision the Pi;
      // ERP needs it to authenticate its document pushes to /erp-ingest (the ERP's own credential, not a user JWT).
      let provision_key = null, key_hash = null;
      if ((type === 'iot' && (config.mode || 'push') === 'push') || type === 'erp') { provision_key = genKey(); key_hash = hashKey(provision_key); }
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
async function emitSignalChit({ entity_id, actor, folder, sub_type, cc, signal, value, unit, device_id, bridge_id, kind, extra, default_assignee, lifecycle, notify_email, blueprint_ref }) {
  const ent = await db(`SELECT bridge_id, display_name FROM identities WHERE identity_id = $1`, [entity_id]);
  const self = ent.rows[0]; if (!self) throw new Error('owning entity not found');
  // Exceptions are SELF-CHITS filed into a named FOLDER (they stay inside the entity); CC = an optional partner who
  // co-holds the same sealed proof. An invalid CC is skipped, never fatal.
  let ccRow = null;
  if (cc && cc !== entity_id) {
    const r = await db(`SELECT identity_id, bridge_id, display_name FROM identities WHERE identity_id = $1 AND status = 'active'`, [cc]);
    ccRow = r.rows[0] || null;
  }

  const chit_id = uuidv4();
  const purpose = 'general';
  const now = new Date();
  const label = sub_type || signal || 'signal';
  // STAMP the resolved governance (values-in-force) onto the chit itself — this `governed` block IS the audit log of
  // what governed this chit at emit time (the work pattern + the resolved knobs). It travels with the sealed record.
  const governed = { pattern: blueprint_ref || (kind === 'erp_document' ? 'erp-document' : 'iot-signal'),
    folder: folder || null, assignee: default_assignee || null, notify: notify_email || null, copy: 'both',
    next: lifecycle || null, resolved_at: now.toISOString() };   // next = the chit's forward lifecycle (what to do next)
  const business_json = { kind: kind || 'device_signal', folder: folder || null, sub_type: sub_type || null,
    device_id, signal, value, unit, bridge_id, source: 'connector_ingest', at: now.toISOString(), governed, ...(extra || {}) };
  const manual_subject = (folder ? ('[' + folder + '] ') : '') + 'Signal: ' + label + (value != null ? (' = ' + value + (unit || '')) : '');
  const auto_subject = 'Signal from ' + (actor.display_name || self.display_name) + ' — ' + now.toISOString().slice(0, 10);

  const all_recipients = [
    { entity_id, bridge_id: self.bridge_id, display_name: self.display_name, role: 'sender' },
    { entity_id, bridge_id: self.bridge_id, display_name: self.display_name, role: 'receiver' },
  ];
  if (ccRow) all_recipients.push({ entity_id: ccRow.identity_id, bridge_id: ccRow.bridge_id, display_name: ccRow.display_name, role: 'cc' });

  const summary_json = { line_item_count: 0, total_value: 0, currency_code: 'INR', priority_external: 'normal', purpose, is_promotion: false, forwarded_from: null };
  const headerCommon = {
    sender_entity_id: entity_id, sender_entity_bridge_id: self.bridge_id, sender_entity_display_name: self.display_name,
    all_recipients, purpose, auto_subject, manual_subject, summary_json,
    schema_version: null, schema_id: null, created_by_actor_id: actor.identity_id,
    detail_type: purpose, line_item_count: 0, total_value: 0, currency_code: 'INR',
  };
  const fdetail = folder ? (' · ' + folder) : '';
  const copies = [
    { ...headerCommon, business_json, entity_id, direction: 'sent', role: 'Act',
      current_status: 'delivered', priority_flag: 'normal', payload_delivered: true,
      log: { action: 'created', action_by_identity_id: entity_id, action_by_display_name: self.display_name, new_status: 'delivered', detail: 'Device exception filed' + fdetail } },
    { ...headerCommon, business_json, entity_id, direction: 'received', role: 'Act',
      current_status: 'pending', priority_flag: 'normal',
      log: { action: 'delivered', action_by_identity_id: entity_id, action_by_display_name: self.display_name, new_status: 'pending', detail: 'Device exception' + fdetail } },
  ];
  if (ccRow) copies.push({ ...headerCommon, business_json, entity_id: ccRow.identity_id, direction: 'received', role: 'Info',
    current_status: 'delivered', priority_flag: 'normal',
    log: { action: 'delivered', action_by_identity_id: entity_id, action_by_display_name: self.display_name, new_status: 'delivered', detail: 'CC — device exception from ' + self.display_name } });

  await withEntity(entity_id, (dbx) => dbx.query(`SELECT chit_deliver($1,$2,$3::jsonb)`, [chit_id, false, JSON.stringify(copies)]));
  // AUTO-FILE the exception into the named folder (create it if new) so it lands in Folders, not loose in Task.
  // Best-effort — if the folders schema (b63) isn't there, the chit still lands normally.
  let filedFolderId = null, folderErr = null;
  if (folder) {
    try {
      // ALL folder-table access runs inside withEntity so app.current_entity is bound — the `folder` table is
      // RLS-enforced (b64), so a context-free INSERT/SELECT would fail closed. Resolve-or-create, then file.
      await withEntity(entity_id, async (dbx) => {
        let fr = await dbx.query(`SELECT folder_id FROM folder WHERE entity_id = $1 AND lower(name) = lower($2) LIMIT 1`, [entity_id, folder]);
        let fid = fr.rows[0] && fr.rows[0].folder_id;
        if (!fid) { const ins = await dbx.query(`INSERT INTO folder (entity_id, name) VALUES ($1,$2) RETURNING folder_id`, [entity_id, folder]); fid = ins.rows[0].folder_id; }
        if (fid) { await dbx.query(`UPDATE chit_status SET folder_id = $1 WHERE chit_id = $2 AND entity_id = $3 AND direction = 'received'`, [fid, chit_id, entity_id]); filedFolderId = fid; }
      });
    } catch (e) { folderErr = (e && e.message) || String(e); console.warn('[connectors] folder auto-file failed:', folderErr); }   // best-effort, but LOUD + surfaced
  }
  // ASSIGN the received (Task) copy to the resolved default-assignee → the signal is OWNED + on someone's radar,
  // not just filed away (the visibility fix). Best-effort; skipped if none resolved or the assignee isn't an active
  // co-assist of this entity. (The list-visibility model for filed chits is the next resolvable knob.)
  let assigned_to = null;
  if (default_assignee) {
    try {
      await withEntity(entity_id, async (dbx) => {
        const a = await dbx.query(`SELECT display_name FROM identities WHERE identity_id = $1 AND parent_entity_id = $2 AND status = 'active'`, [default_assignee, entity_id]);
        if (a.rows[0]) {
          await dbx.query(`UPDATE chit_status SET assigned_to_actor_id = $1, assigned_to_actor_display_name = $2, assigned_at = NOW(), assignment_type = 'auto', updated_at = NOW() WHERE chit_id = $3 AND entity_id = $4 AND direction = 'received'`,
            [default_assignee, a.rows[0].display_name, chit_id, entity_id]);
          assigned_to = default_assignee;
        }
      });
    } catch (_) { /* assignment is best-effort — never fail the signal over it */ }
  }
  // EXTERNAL NOTICE (off-rail): if a notify_email is resolved, send an email NUDGE to someone NOT in the system — a
  // notice, never the governed payload. Best-effort + gated (only delivers when email is configured); never blocks.
  if (notify_email) {
    try {
      const e = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const subj = 'Chit and Bridge — a signal from ' + e(actor.display_name || self.display_name || 'a device');
      const html = '<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto">'
        + '<h2 style="color:#0D47A1;margin:0 0 8px">Chit &amp; Bridge — signal notice</h2>'
        + '<p><b>' + e(self.display_name || 'An entity') + '</b> recorded a device signal'
        + (label ? (' — <b>' + e(label) + '</b>') : '') + (value != null ? (' = ' + e(value) + e(unit || '')) : '') + '.</p>'
        + (folder ? ('<p>Filed under: <b>' + e(folder) + '</b></p>') : '')
        + '<p style="color:#555;font-size:13px">This is a notice only. Sign in to Chit &amp; Bridge to view the full record.</p>'
        + '</div>';
      await sendEmail(notify_email, subj, html);
    } catch (_) { /* notice is best-effort — never fail the signal over an email */ }
  }
  // participants = the entities that hold a copy (owner + CC if any) — for per-entity proof replication (b66).
  const participants = [entity_id]; if (ccRow) participants.push(ccRow.identity_id);
  return { chit_id, folder_id: filedFolderId, folder_error: folderErr, participants, assigned_to };
}

// Shared ERP process-then-forget CORE (used by both the key-authed /erp-ingest and the owner-authed /erp-test).
// (1) Claim the receipt slot = the idempotency lock (a retry returns the first receipt, no re-emit). (2) PROCESS by
// emitting only the SUMMARY (doc_type/ref/amount) as a co-held chit. (3) FORGET — finalise the receipt; the raw
// payload is NEVER written. Returns the receipt shape. Callers pass the already-resolved actor/entity/cfg/cc.
async function processErpDocument({ actor, entity_id, cfg, payload, doc_type, doc_ref, cc }) {
  const payload_hash = hashPayload(payload);   // the ONLY trace of the raw document we keep
  const receipt_id = uuidv4();
  const claim = await withEntity(entity_id, (c) => c.query(
    `INSERT INTO connector_receipt (receipt_id, entity_id, actor_id, doc_type, doc_ref, payload_hash, outcome)
     VALUES ($1,$2,$3,$4,$5,$6,'pending')
     ON CONFLICT (actor_id, payload_hash) DO NOTHING RETURNING receipt_id`,
    [receipt_id, entity_id, actor.identity_id, doc_type, doc_ref, payload_hash]));
  if (claim.rows.length === 0) {
    const ex = await withEntity(entity_id, (c) => c.query(
      `SELECT receipt_id, outcome, chit_id FROM connector_receipt WHERE actor_id = $1 AND payload_hash = $2`,
      [actor.identity_id, payload_hash]));
    const r = ex.rows[0] || {};
    return { receipt_id: r.receipt_id || null, payload_hash, outcome: 'duplicate', chit_id: r.chit_id || null, idempotent: true, note: null };
  }
  let chit_id = null, outcome = cc ? 'processed' : 'logged', note = null;
  try {
    const extra = { doc_type, doc_ref };
    if (payload.amount != null) extra.amount = payload.amount;
    if (payload.currency) extra.currency = String(payload.currency).slice(0, 8);
    const emit = await emitSignalChit({
      entity_id, actor, folder: cfg.folder || 'ERP', sub_type: 'erp:' + doc_type, cc,
      kind: 'erp_document', signal: doc_type, value: doc_ref, extra, device_id: doc_ref, bridge_id: null,
    });
    chit_id = emit.chit_id;
  } catch (e) { outcome = 'failed'; note = 'Receipt kept, but the outcome chit could not be delivered: ' + safeErr(e); }
  await withEntity(entity_id, (c) => c.query(
    `UPDATE connector_receipt SET outcome = $1, chit_id = $2 WHERE receipt_id = $3`, [outcome, chit_id, receipt_id]));
  return { receipt_id, payload_hash, outcome, chit_id, idempotent: false, note };
}

// POST /api/connectors/ingest — DEVICE-FACING. Auth by the CB-issued ActorKey (X-Bridge-Key header), NOT a user JWT.
// The Pi/gateway calls THIS: (1) prove identity with its own key, (2) heartbeat -> the cockpit health dot goes LIVE,
// (3) emit the reading as a co-held Device Signal chit to the connection's counterparty. One call, own credential.
// By design there is NO `auth` middleware here (a device has no session); abuse-throttling is a tracked backlog item.
router.post('/ingest',
  [ body('signal').optional().trim().isLength({ max: 64 }),
    body('sub_type').optional().trim().isLength({ max: 64 }),
    body('folder').optional().trim().isLength({ max: 80 }),
    body('bridge_id').optional().trim(),
    body('unit').optional().trim().isLength({ max: 16 }),
    body('device_id').optional().trim().isLength({ max: 64 }) ],
  validate,
  async (req, res) => {
    try {
      const key = (req.get('X-Bridge-Key') || (req.body && req.body.key) || '').toString().trim();
      if (!key) return res.status(401).json({ error: 'No key', message: 'Send the ActorKey in the X-Bridge-Key header.' });
      const ar = await db(
        `SELECT identity_id, parent_entity_id, display_name, connector_type, status, connector_config
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

      // (3) EMIT the exception as a co-held chit — a SELF-CHIT filed into the device's FOLDER, CC the partner if set.
      //     A pure liveness ping can pass heartbeat_only=true to refresh health WITHOUT raising a chit (no inbox flood).
      // RESOLVE-BEFORE-ACT: resolve the iot-signal work pattern (folder · counterparty · default assignee), cascaded
      // device → connector → entity, BEFORE emitting. The mode reads its config from the seam — it never hard-codes it.
      const wp = await resolveWorkPattern('iot-signal', { entity_id, connectorConfig: actor.connector_config || {}, connection: conn }) || {};
      const cfg = (conn && conn.conn_config) || {};
      const folder = wp.folder || (req.body.folder ? String(req.body.folder).trim() : null);
      const sub_type = req.body.sub_type ? String(req.body.sub_type).trim()
                     : (Array.isArray(cfg.classes) && cfg.classes.length === 1 ? cfg.classes[0] : null);
      const cc = wp.counterparty || (req.body.to ? String(req.body.to).trim() : null);
      const default_assignee = wp.default_assignee || null;
      let chit_id = null, note = null, proof_id = null, filed = null, file_err = null, proof_err = null, assigned = null;
      if (req.body.heartbeat_only) {
        note = 'Heartbeat only — health refreshed, no chit raised.';
      } else {
        try {
          const emit = await emitSignalChit({
            entity_id, actor, folder, sub_type, cc, default_assignee, lifecycle: wp.lifecycle, notify_email: wp.notify_email, blueprint_ref: wp._blueprint,
            signal: req.body.signal || 'signal',
            value: (req.body.value != null ? String(req.body.value) : null),
            unit: req.body.unit || null,
            device_id: req.body.device_id || (conn && conn.ref) || null,
            bridge_id,
          });
          chit_id = emit.chit_id; filed = emit.folder_id; file_err = emit.folder_error; assigned = emit.assigned_to;   // filed = folder it landed in; assigned = resolved default-assignee (if any)
          // PROOF — attach the edge image (base64) to the chit; bytes fetched on demand via GET /api/attachments/:id.
          if (chit_id && req.body.proof) {
            try {
              const buf = Buffer.from(String(req.body.proof).replace(/^data:[^;]+;base64,/, ''), 'base64');
              if (buf.length > 0 && buf.length <= 6 * 1024 * 1024) {
                // PER-ENTITY: replicate the proof to every participant (owner + CC) — each holds its own copy.
                proof_id = await storage.putForParticipants({ chit_id, name: (req.body.proof_name || 'proof.jpg').toString().slice(0, 200),
                  mime: (req.body.proof_mime || 'image/jpeg').toString().slice(0, 120), size: buf.length, buffer: buf,
                  uploaded_by: actor.identity_id, participants: emit.participants, forEntity: entity_id });
              }
            } catch (e) { proof_err = (e && e.message) || String(e); console.warn('[connectors] proof attach failed:', proof_err); }
          }
        } catch (e) { note = 'Health updated, but the exception chit could not be delivered: ' + safeErr(e); }
      }
      res.json({ message: 'ingested', health: 'live', last_seen: new Date().toISOString(), chit_id, proof_id, filed, file_err, proof_err, note, assigned });
    } catch (err) { res.status(500).json({ error: 'Ingest failed', message: safeErr(err) }); }
  });

// POST /api/connectors/erp-ingest — ERP-FACING, "process-then-forget". An ERP/middleware authenticates with its
// ActorKey and pushes a DOCUMENT (req.body.payload — arbitrary JSON). We PROCESS it (emit the business outcome as a
// co-held chit to the counterparty) then FORGET the raw payload, persisting only a RECEIPT: hash + outcome + chit
// pointer. The raw document is NEVER written to the DB. Idempotent: the receipt row (UNIQUE actor_id+payload_hash)
// is the lock, so a retried push yields ONE receipt and ONE effect. No user JWT — a system has no session.
router.post('/erp-ingest',
  [ body('payload').custom(v => v !== undefined && v !== null && typeof v === 'object').withMessage('payload (JSON object) required'),
    body('doc_type').optional().trim().isLength({ max: 64 }),
    body('doc_ref').optional().trim().isLength({ max: 120 }) ],
  validate,
  async (req, res) => {
    try {
      const key = (req.get('X-Bridge-Key') || (req.body && req.body.key) || '').toString().trim();
      if (!key) return res.status(401).json({ error: 'No key', message: 'Send the ActorKey in the X-Bridge-Key header.' });
      const ar = await db(
        `SELECT identity_id, parent_entity_id, display_name, connector_type, status, connector_config
           FROM identities
          WHERE provision_key_hash = $1 AND identity_type = 'actor' AND connector_type IS NOT NULL`, [hashKey(key)]);
      const actor = ar.rows[0];
      if (!actor || actor.status !== 'active') return res.status(401).json({ error: 'Bad key', message: 'ActorKey not recognised, or the connector is inactive.' });
      if (actor.connector_type !== 'erp') return res.status(409).json({ error: 'Wrong type', message: 'This endpoint is for ERP connectors. IoT devices use /ingest.' });

      const entity_id = actor.parent_entity_id;
      const cfg       = actor.connector_config || {};
      const doc_type  = req.body.doc_type ? String(req.body.doc_type).trim() : (req.body.payload.doc_type ? String(req.body.payload.doc_type).slice(0, 64) : 'document');
      const doc_ref   = req.body.doc_ref ? String(req.body.doc_ref).trim() : (req.body.payload.doc_ref ? String(req.body.payload.doc_ref).slice(0, 120) : null);
      const cc        = req.body.to ? String(req.body.to).trim() : (cfg.counterparty_entity_id || null);

      // Heartbeat — health goes live for the ERP connector (independent of processing below).
      await db(`UPDATE identities SET last_seen = NOW() WHERE identity_id = $1`, [actor.identity_id]);

      const out = await processErpDocument({ actor, entity_id, cfg, payload: req.body.payload, doc_type, doc_ref, cc });
      res.json({ message: out.idempotent ? 'duplicate' : 'received', ...out });
    } catch (err) { res.status(500).json({ error: 'ERP ingest failed', message: safeErr(err) }); }
  });

// GET /api/connectors/:actorId/receipts — the ERP receipt ledger (hash + outcome, NEVER the raw payload). Entity-scoped.
router.get('/:actorId/receipts', auth, requireConnector,
  [ param('actorId').isUUID() ], validate,
  async (req, res) => {
    try {
      const entity_id = ownerEntityId(req);
      const own = await db(`SELECT 1 FROM identities WHERE identity_id = $1 AND parent_entity_id = $2 AND connector_type = 'erp'`, [req.params.actorId, entity_id]);
      if (own.rows.length === 0) return res.status(404).json({ error: 'Not found', message: 'No ERP connector with that id under this entity.' });
      const r = await withEntity(entity_id, (c) => c.query(
        `SELECT receipt_id, doc_type, doc_ref, payload_hash, outcome, chit_id, received_at
           FROM connector_receipt WHERE actor_id = $1 ORDER BY received_at DESC LIMIT 200`, [req.params.actorId]));
      res.json({ receipts: r.rows });
    } catch (err) { res.status(500).json({ error: 'List receipts failed', message: safeErr(err) }); }
  });

// POST /api/connectors/:actorId/erp-test — OWNER-authed test cycle. The cockpit CANNOT call /erp-ingest (that needs the
// ActorKey, which the UI never holds — we store only its hash). So the owner (JWT) triggers the SAME process-then-forget
// core with a generated sample document. A fresh nonce keeps every run unique so it is never swallowed by idempotency —
// each press produces a real receipt + a real co-held chit, letting a human see the whole ERP loop from the cockpit.
router.post('/:actorId/erp-test', auth, requireConnector,
  [ param('actorId').isUUID() ], validate,
  async (req, res) => {
    try {
      const entity_id = ownerEntityId(req);
      const ar = await db(
        `SELECT identity_id, parent_entity_id, display_name, connector_type, connector_config
           FROM identities
          WHERE identity_id = $1 AND parent_entity_id = $2 AND identity_type = 'actor' AND connector_type = 'erp'`,
        [req.params.actorId, entity_id]);
      const actor = ar.rows[0];
      if (!actor) return res.status(404).json({ error: 'Not found', message: 'No ERP connector with that id under this entity.' });
      const cfg = actor.connector_config || {};
      const cc  = cfg.counterparty_entity_id || null;
      // A representative sample document. The nonce makes it unique per run (else the 2nd test would dedupe to 'duplicate').
      const kinds    = ['invoice', 'order', 'grn', 'payment'];
      const doc_type = kinds[Math.floor(Math.random() * kinds.length)];
      const doc_ref  = 'TEST-' + Date.now().toString().slice(-6);
      const payload  = { doc_type, doc_ref, amount: Math.round(100 + Math.random() * 9900), currency: 'INR', test: true, nonce: uuidv4(), note: 'sample document — the raw body is processed then forgotten' };
      await db(`UPDATE identities SET last_seen = NOW() WHERE identity_id = $1`, [actor.identity_id]);
      const out = await processErpDocument({ actor, entity_id, cfg, payload, doc_type, doc_ref, cc });
      res.json({ message: 'test-processed', doc_type, doc_ref, counterparty: cc, ...out });
    } catch (err) { res.status(500).json({ error: 'ERP test failed', message: safeErr(err) }); }
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
        endpoint: cfg.endpoint || 'https://chitbridge-api-production.up.railway.app  (HTTPS · POST /api/connectors/ingest)',
        note: 'ActorKey is shown once at creation — Regenerate to re-issue. Flash Endpoint + ActorKey on the Pi; it publishes these BridgeIds.',
        publishes: conns.rows.map(c => ({ bridge_id: c.bridge_id, ref: c.ref, topic: (c.conn_config || {}).topic || null })) });
    }
    return res.json({ type: 'erp', base_url: cfg.base_url || null, auth_type: cfg.auth_type || null, auth_ref: cfg.auth_ref || null,
      endpoints: conns.rows.map(c => ({ bridge_id: c.bridge_id, ref: c.ref, path: (c.conn_config || {}).path || null })) });
  } catch (err) { res.status(500).json({ error: 'Provisioning failed', message: safeErr(err) }); }
});

// POST /api/connectors/reissue-code — STEP-UP: email a one-time code to the ENTITY's registered email (the account
// owner), so even a manager delegate cannot reissue a device key without the code the entity controls.
router.post('/reissue-code', auth, requireConnector, async (req, res) => {
  try {
    const perm = await canReissue(req);
    if (!perm.ok) return res.status(403).json({ error: 'Forbidden', message: 'Only the entity admin or a manager delegate may reissue a device key.' });
    const entity_id = ownerEntityId(req);
    const e = await db(`SELECT email, display_name FROM identities WHERE identity_id = $1`, [entity_id]);
    const ent = e.rows[0]; if (!ent || !ent.email) return res.status(400).json({ error: 'No email', message: 'The entity has no registered email to send a code to.' });
    const otp = genOtp(); const expires = new Date(Date.now() + 10 * 60 * 1000);
    await db(`UPDATE identities SET otp_code = $1, otp_expires_at = $2, otp_attempts = 0 WHERE identity_id = $3`, [otp, expires, entity_id]);
    const sent = await sendOtpEmail(ent.email, ent.display_name, otp);
    res.json({ message: sent.delivered ? 'Code sent to the account email.' : sent.dev ? 'Dev mode — code issued.' : 'Could not send the code — try again.',
      email: String(ent.email).replace(/(.).*(@.*)/, '$1***$2'), ...(sent.dev && { dev_otp: otp }) });
  } catch (err) { res.status(500).json({ error: 'Send failed', message: safeErr(err) }); }
});

// POST /api/connectors/:actorId/regenerate-key — issue a FRESH ActorKey (invalidates the old one). GATED: entity/manager
// only + re-type the gateway name (the QUESTION) + the one-time code sent to the entity email (the PASSWORD). Audited.
router.post('/:actorId/regenerate-key', auth, requireConnector,
  [ param('actorId').isUUID(), body('name').trim().notEmpty().withMessage('Type the gateway name'),
    body('otp').trim().isLength({ min: 6, max: 6 }).withMessage('6-digit code required') ], validate,
  async (req, res) => {
  try {
    const perm = await canReissue(req);
    if (!perm.ok) return res.status(403).json({ error: 'Forbidden', message: 'Only the entity admin or a manager delegate may reissue a device key.' });
    const entity_id = ownerEntityId(req);
    const actor = await ownedConnector(req.params.actorId, entity_id);
    if (!actor) return res.status(404).json({ error: 'Not found' });
    // THE QUESTION — the typed gateway name must match exactly (case-insensitive)
    if (String(req.body.name).trim().toLowerCase() !== String(actor.display_name || '').trim().toLowerCase())
      return res.status(400).json({ error: 'Name mismatch', message: 'The gateway name you typed does not match.' });
    // THE PASSWORD — verify the one-time code against the ENTITY's current code
    const er = await db(`SELECT identity_id, otp_code, otp_expires_at, otp_attempts FROM identities WHERE identity_id = $1`, [entity_id]);
    const chk = await verifyOtp(db, er.rows[0] || {}, req.body.otp);
    if (!chk.ok) return res.status(chk.status || 400).json({ error: 'Bad code', message: chk.message });
    // PASSED — reissue, clear the code, audit (who/when into the connector's own config; no migration needed)
    const provision_key = genKey();
    await db(`UPDATE identities SET provision_key_hash = $1 WHERE identity_id = $2`, [hashKey(provision_key), actor.identity_id]);
    await db(`UPDATE identities SET otp_code = NULL, otp_expires_at = NULL, otp_attempts = 0 WHERE identity_id = $1`, [entity_id]);
    const cfg = actor.connector_config || {};
    cfg.last_key_reissue = { by_identity_id: req.identity.identity_id, by_name: req.identity.display_name, role: perm.role, at: new Date().toISOString() };
    await db(`UPDATE identities SET connector_config = $1 WHERE identity_id = $2`, [JSON.stringify(cfg), actor.identity_id]);
    console.log(`[AUDIT] connector key reissued — connector=${actor.identity_id} by=${req.identity.identity_id}(${perm.role}) entity=${entity_id}`);
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
    res.json({ actor_health: actorHealth, actor_last_seen: actor.last_seen, connections });
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

// DELETE /api/connectors/:actorId — retire a connector. RULE (Athi): hard-delete ONLY if it has NO devices attached
// (a bare connector is cheap to recreate); if any connection exists, REFUSE (protect the attached devices — detach
// first). Also refuses if the connector has raised records that reference it (FK) — that's a "problem", so keep it.
router.delete('/:actorId', auth, requireConnector, [param('actorId').isUUID()], validate, async (req, res) => {
  try {
    const entity_id = ownerEntityId(req);
    const actor = await ownedConnector(req.params.actorId, entity_id);
    if (!actor) return res.status(404).json({ error: 'Not found', message: 'No such connector under this entity.' });
    const cc = await db(`SELECT COUNT(*)::int AS n FROM connector_connection WHERE actor_id = $1`, [actor.identity_id]);
    if (cc.rows[0].n > 0) return res.status(409).json({ error: 'Has devices',
      message: 'This connector has ' + cc.rows[0].n + ' device' + (cc.rows[0].n === 1 ? '' : 's') + ' attached — remove them before deleting.' });
    try {
      await db(`DELETE FROM identities WHERE identity_id = $1 AND parent_entity_id = $2 AND identity_type = 'actor' AND connector_type IS NOT NULL`, [actor.identity_id, entity_id]);
    } catch (e) {
      if (e && e.code === '23503')   // FK — it raised chits/records that point back to it; deleting would orphan them
        return res.status(409).json({ error: 'In use', message: 'This connector has raised records and cannot be hard-deleted. Disable its devices instead.' });
      throw e;
    }
    res.json({ deleted: 1 });
  } catch (err) { res.status(500).json({ error: 'Delete failed', message: safeErr(err) }); }
});

module.exports = router;
