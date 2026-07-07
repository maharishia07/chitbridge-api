// routes/chits.js — Chit send, inbox, detail, status update
const express = require('express');
const router = express.Router();
const { safeErr } = require('../lib/respond');
const { body } = require('express-validator');
const { v4: uuidv4 } = require('uuid');
const { query, withTransaction, withEntity } = require('../db');
const storage = require('../lib/storage');
const { validate, sanitise } = require('../middleware/validate');
const auth = require('../middleware/auth');

// ── B1 RLS — the crossing helper ─────────────────────────────────────────────────────────────────────────
// A few chit operations legitimately cross the entity boundary (log an event into every/selected participant,
// propagate a cancel/void, set the customer flag). Under RLS those are served by the b50/b51 SECURITY DEFINER
// "delivery-agent" fns. `crossing()` runs the definer inside withEntity(caller); if the delivery layer isn't
// applied yet (pre-b50), it runs a legacy direct-SQL fallback in its OWN transaction — so a missing-function
// error can't poison a shared tx, and the feature keeps working before/after the migration. Under FORCE without
// the fn the fallback fails closed (degraded, never a cross-tenant leak). Once b50 is applied the definer wins.
// Are the b50/b51/b52 delivery-agent fns installed? Latches true once seen; keeps re-probing while false, so it
// self-heals when the migration lands (no restart needed). A tenant-table-free probe -> the RLS guard stays silent.
let _definersReady = false;
async function definersReady() {
  if (_definersReady) return true;
  try {
    const r = await query(
      `SELECT (to_regprocedure('chit_deliver(uuid,boolean,jsonb)') IS NOT NULL
           AND to_regprocedure('chit_log_targets(uuid,uuid[],text,uuid,text,text)') IS NOT NULL
           AND to_regprocedure('chit_participant_parity(uuid,uuid)') IS NOT NULL) AS ok`);
    _definersReady = !!(r.rows[0] && r.rows[0].ok);
  } catch (_) { /* leave false — fall back to legacy */ }
  return _definersReady;
}

// Run a b50/b51/b52 definer inside withEntity(caller); before the delivery layer is applied, run the legacy
// direct-SQL fallback instead (fallback(db) receives the tx client). Keeps every crossing feature working
// before/after the migration; once the fns exist the definer path wins, so writes cross safely + audited.
// b63 folders: is chit_status.folder_id present? Cached probe so the inbox can hide FILED chits (mailing-model "move"
// is a QUERY, not data movement — the chit stays put; Task just excludes what's filed) WITHOUT ever erroring if the
// migration isn't applied yet. Self-heals the moment the column exists.
let _folderColReady = null;
async function folderColReady() {
  if (_folderColReady !== null) return _folderColReady;
  try { const r = await query(`SELECT 1 FROM information_schema.columns WHERE table_name = 'chit_status' AND column_name = 'folder_id' LIMIT 1`); _folderColReady = r.rows.length > 0; }
  catch (_) { _folderColReady = false; }
  return _folderColReady;
}

async function crossing(entity, definerSql, definerParams, fallback) {
  if (await definersReady()) {
    return await withEntity(entity, (db) => db.query(definerSql, definerParams));
  }
  return await withEntity(entity, fallback);
}

// Connection check removed — existence check only
// Sender can send to any entity that exists in the system

// ─── Helper: Generate auto subject ───────────────────────────
const generateAutoSubject = (purpose, senderName, date) => {
  const purposes = {
    order: 'Order',
    invoice: 'Invoice',
    receipt: 'Receipt',
    inquiry: 'Inquiry',
    delivery_note: 'Delivery Note',
    general: 'Message'
  };
  const label = purposes[purpose] || 'Chit';
  const dateStr = new Date(date).toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric'
  });
  return `${label} from ${senderName} — ${dateStr}`;
};

// ─── Helper: Calculate summary ───────────────────────────────
const calculateSummary = (lineItems) => {
  if (!lineItems || !Array.isArray(lineItems)) {
    return { line_item_count: 0, total_value: 0 };
  }
  const total = lineItems.reduce((sum, item) => {
    return sum + (parseFloat(item.total || item.price * item.quantity || 0));
  }, 0);
  return {
    line_item_count: lineItems.length,
    total_value: Math.round(total * 100) / 100
  };
};

// ─── D1 auto-assign on receipt ─────────────────────────────────
// Walk the delegate chain when the chosen actor is on leave / not-assignable. Returns an assignable
// actor id (active + Act/Manager hat) or null. Loop-guarded (visited set + depth cap). Capacity is
// NOT re-checked here — the default/overflow assignee absorbs excess by design (D1).
async function resolveDelegateTarget(client, entity_id, actorId) {
  const seen = new Set(); let cur = actorId; let depth = 0;
  while (cur && depth < 12) {
    if (seen.has(cur)) return null;                    // cycle → give up (set-time check is the primary guard)
    seen.add(cur);
    const r = (await client.query(
      `SELECT identity_id, break_status, hat, delegate_actor_id
         FROM identities WHERE identity_id = $1 AND parent_entity_id = $2 AND identity_type = 'actor'`,
      [cur, entity_id])).rows[0];
    if (!r) return null;
    if (r.break_status === 'active' && (r.hat === 'act' || r.hat === 'manager')) return r.identity_id;
    cur = r.delegate_actor_id; depth++;                // on leave / not assignable → try their delegate
  }
  return null;
}

// Auto-assign a freshly-received chit per the entity's mode. Atomic + idempotent (skips if already
// assigned). Caller runs it best-effort AFTER commit so it can never fail the guaranteed chit.
async function autoAssignReceived(entity_id, chit_id) {
  // B1 RLS: the receiver auto-assigns within its OWN roster -> withEntity(receiver), not withTransaction.
  await withEntity(entity_id, async (client) => {
    const st = (await client.query(
      `SELECT auto_assign_mode, default_assignee_actor_id, default_max_tasks
         FROM entity_actor_settings WHERE entity_id = $1`, [entity_id])).rows[0];
    const mode = (st && st.auto_assign_mode) || 'off';
    if (mode === 'off') return;
    const defMax = (st && st.default_max_tasks) || 10;
    const defaultAssignee = (st && st.default_assignee_actor_id) || null;

    // Idempotency + scope: only the actionable received copy, still unassigned.
    const cs = (await client.query(
      `SELECT assigned_to_actor_id FROM chit_status
         WHERE chit_id = $1 AND entity_id = $2 AND direction = 'received' AND deleted_at IS NULL`,
      [chit_id, entity_id])).rows[0];
    if (!cs || cs.assigned_to_actor_id) return;

    let target = null;
    if (mode === 'default_assignee') {
      target = defaultAssignee;
    } else if (mode === 'least_loaded') {
      const cand = (await client.query(
        `SELECT identity_id, max_tasks, current_task_count FROM identities
           WHERE parent_entity_id = $1 AND identity_type = 'actor' AND break_status = 'active'
             AND hat IN ('act','manager')
           ORDER BY current_task_count ASC, last_assigned_at ASC NULLS FIRST
           LIMIT 10`, [entity_id])).rows;
      const room = cand.find(a => (a.current_task_count || 0) < (a.max_tasks || defMax));
      target = room ? room.identity_id : defaultAssignee;   // all full → overflow to the default assignee
    }
    if (!target) return;                               // no eligible actor + no default → stays in the pool

    target = await resolveDelegateTarget(client, entity_id, target);   // route past anyone on leave
    if (!target) return;

    const t = (await client.query(
      `SELECT identity_id, display_name FROM identities
         WHERE identity_id = $1 AND parent_entity_id = $2 AND identity_type = 'actor'`,
      [target, entity_id])).rows[0];
    if (!t) return;

    await client.query(
      `UPDATE chit_status SET assigned_to_actor_id = $1, assigned_to_actor_display_name = $2,
              assigned_at = NOW(), assignment_type = 'auto', current_status = 'pending', updated_at = NOW()
        WHERE chit_id = $3 AND entity_id = $4 AND direction = 'received'`,
      [t.identity_id, t.display_name, chit_id, entity_id]);
    await client.query(
      `UPDATE identities SET current_task_count = current_task_count + 1, last_assigned_at = NOW() WHERE identity_id = $1`,
      [t.identity_id]);
    await client.query(
      `INSERT INTO state_log (chit_id, entity_id, action, action_by_identity_id, action_by_display_name, new_status, detail)
       VALUES ($1, $2, 'assigned', NULL, 'System (auto-assign)', 'pending', $3)`,
      [chit_id, entity_id, `Auto-assigned to ${t.display_name} (${mode === 'least_loaded' ? 'least-loaded' : 'default assignee'})`]);
  });
}

// ─── POST /chits/send ─────────────────────────────────────────
// Send a chit from sender to one or more receivers
router.post('/send',
  [
    // Accept legacy `receivers` (all = To) OR fan-out `recipients` [{..., role:'to'|'cc'|'for'}];
    // a draft may have no recipients. (ATH-119)
    body().custom((_v, { req }) => {
      const list = Array.isArray(req.body.recipients) ? req.body.recipients
                 : Array.isArray(req.body.receivers)  ? req.body.receivers
                 : [];
      if (!req.body.is_draft && list.length === 0) {
        throw new Error('At least one recipient required');
      }
      for (const r of list) {
        if (!r.entity_id && !r.display_name && !r.name) {
          throw new Error('Each recipient must have entity_id, display_name, or name');
        }
      }
      return true;
    }),
    body('purpose')
      .optional()
      .trim()
      .isIn(['order','invoice','receipt','inquiry','delivery_note','general'])
      .withMessage('Invalid purpose'),
    body('manual_subject').optional().trim().isLength({ max: 500 }),
    body('line_items').optional().isArray(),
    body('business_json').optional().isObject(),
  ],
  validate,
  auth,
  async (req, res) => {
    try {
      // Uniform actor model: an actor acts FOR its entity, so the chit is ALWAYS owned by the entity, never the actor.
      // (created_by_actor_id below records WHO pressed send — the only actor-specific bit, for audit.)
      const sender_id = req.identity.parent_entity_id || req.identity.identity_id;
      let sender_bridge_id = req.identity.bridge_id;
      let sender_display_name = req.identity.display_name;
      if (req.identity.identity_type === 'actor' && req.identity.parent_entity_id) {
        const _ent = await query(`SELECT bridge_id, display_name FROM identities WHERE identity_id = $1`, [sender_id]);
        if (_ent.rows[0]) { sender_bridge_id = _ent.rows[0].bridge_id; sender_display_name = _ent.rows[0].display_name; }
      }
      // Compose panel omits purpose and sends `subject`/`schema_values` — tolerate that shape.
      const purpose = req.body.purpose || 'order';
      const manual_subject = sanitise(req.body.manual_subject || req.body.subject || '');
      const line_items = req.body.line_items || [];
      const business_json = req.body.business_json
        || (req.body.schema_values && Object.keys(req.body.schema_values).length ? { schema_values: req.body.schema_values } : null);
      const is_draft = !!req.body.is_draft;
      // Promote/update a saved draft IN PLACE (same chit_id): Draft stays a draft until sent; sending flips it to
      // Order + fans out to Task. is_draft:true + promote_draft_id => update the draft; is_draft:false => send it.
      const promote_draft_id = (typeof req.body.promote_draft_id === 'string' && req.body.promote_draft_id) ? req.body.promote_draft_id : null;

      // ── Fan-out recipients (ATH-119): To/CC/For. Backward-compatible: legacy `receivers` => all To. ──
      const LIMITS = { to: 5, cc: 5, for: 1, items: 50, attachments: 10 };
      const ROLE_MAP = { to: 'Act', cc: 'Info', for: 'For' };
      const rawList = (Array.isArray(req.body.recipients) ? req.body.recipients
                     : Array.isArray(req.body.receivers)  ? req.body.receivers
                     : []
                    ).map(r => ({ ...r, kind: String(r.role || 'to').toLowerCase() }));

      // Server-side LIMITS re-check — never trust the client (ATH-120).
      const counts = { to: 0, cc: 0, for: 0 };
      for (const r of rawList) {
        if (!(r.kind in counts)) {
          return res.status(400).json({ error: 'Invalid recipient role', message: `role must be to|cc|for, got "${r.kind}"` });
        }
        counts[r.kind]++;
      }
      if (counts.to > LIMITS.to || counts.cc > LIMITS.cc || counts.for > LIMITS.for) {
        return res.status(400).json({ error: 'Limit exceeded', message: `Recipient caps — to:${LIMITS.to}, cc:${LIMITS.cc}, for:${LIMITS.for}` });
      }
      if (line_items.length > LIMITS.items) {
        return res.status(400).json({ error: 'Limit exceeded', message: `Max ${LIMITS.items} line items` });
      }

      // Two-copy: the sender's view preference for self-chits (both | sent | received) — exposed via /me.
      const prefRow = await query(`SELECT self_copy_pref FROM identities WHERE identity_id = $1`, [sender_id]);
      const selfCopyPref = prefRow.rows[0]?.self_copy_pref || 'both';
      const makeSelfReceiver = (k) => ({ entity_id: sender_id, bridge_id: sender_bridge_id,
        display_name: sender_display_name, kind: k, role: ROLE_MAP[k], all_role: k === 'to' ? 'receiver' : k });
      let hasSelf = false;

      // Existence check — connection NOT required. Resolve + de-dupe (one row per entity per direction).
      const receiverDetails = [];
      const seen = new Set();
      for (const r of rawList) {
        // Self recipient ("+ Self" or your own name): always create the entity's 'received' (Task)
        // copy here; the 'sent' (Order) copy is the SENDER block below. Two copies, always.
        if (r.self === true || ['self','me'].includes(String(r.name || '').trim().toLowerCase())) {
          if (!hasSelf) receiverDetails.push(makeSelfReceiver(r.kind));
          hasSelf = true;
          continue;
        }
        let rec;
        if (r.entity_id) {
          rec = await query(
            `SELECT identity_id, bridge_id, display_name FROM identities
             WHERE identity_id = $1 AND status = 'active'`,
            [r.entity_id]
          );
        } else if (r.display_name || r.name) {
          rec = await query(
            `SELECT identity_id, bridge_id, display_name FROM identities
             WHERE LOWER(display_name) = LOWER($1) AND status = 'active'
             AND identity_type = 'entity'`,
            [(r.display_name || r.name).trim()]
          );
        }

        if (!rec || rec.rows.length === 0) {
          if (is_draft) {   // a draft is WIP — keep the entered recipient name (unresolved); resolution is enforced only on send
            receiverDetails.push({ entity_id: null, bridge_id: null, display_name: (r.display_name || r.name || '').toString().trim(),
              kind: r.kind, role: ROLE_MAP[r.kind], all_role: r.kind === 'to' ? 'receiver' : r.kind });
            continue;
          }
          return res.status(404).json({
            error: 'Not found',
            message: `Recipient "${r.entity_id || r.display_name || r.name}" not found in the platform`
          });
        }

        const rid = rec.rows[0].identity_id;
        // Resolved to self (you typed your own name): same as "+ Self" — create the received copy.
        if (rid === sender_id) {
          if (!hasSelf) receiverDetails.push(makeSelfReceiver(r.kind));
          hasSelf = true;
          continue;
        }
        if (seen.has(rid)) continue;   // de-dupe external recipients
        seen.add(rid);

        receiverDetails.push({
          entity_id: rid,
          bridge_id: rec.rows[0].bridge_id,
          display_name: rec.rows[0].display_name,
          kind: r.kind,                                   // to | cc | for
          role: ROLE_MAP[r.kind],                         // Act | Info | For (chit_header.role)
          all_role: r.kind === 'to' ? 'receiver' : r.kind // for the all_recipients snapshot
        });
      }

      // ── validateSend hook: when promoting a draft, it must be THIS entity's draft. (Baseline/supplier-window
      //    and other send-time rules will plug in here when we build Suppliers.) ──
      if (promote_draft_id) {
        const dchk = await withEntity(sender_id, (db) => db.query(`SELECT role FROM chit_header WHERE chit_id = $1 AND entity_id = $2`, [promote_draft_id, sender_id]));
        if (dchk.rows.length === 0) return res.status(404).json({ error: 'Not found', message: 'Draft not found' });
        if (dchk.rows[0].role !== 'Draft') return res.status(400).json({ error: 'Not a draft', message: 'This chit has already been sent' });
      }
      // Generate chit_id — same for ALL participants (reuse the draft's id when promoting, so the draft BECOMES the order)
      const chit_id = promote_draft_id || uuidv4();
      const now = new Date();

      // Build all_recipients — snapshot with sender + all recipients (with fan-out roles)
      const all_recipients = [
        {
          entity_id: sender_id,
          bridge_id: sender_bridge_id,
          display_name: sender_display_name,
          role: 'sender'
        },
        ...receiverDetails.map(r => ({
          entity_id: r.entity_id, bridge_id: r.bridge_id,
          display_name: r.display_name, role: r.all_role
        }))
      ];

      // Generate auto subject
      const auto_subject = generateAutoSubject(purpose, sender_display_name, now);

      // Calculate summary from line items
      const summary = calculateSummary(line_items);
      const currency_code = (business_json && business_json.currency) || 'INR';
      // External priority: set by the drafter at compose, immutable once sent (rides on the shared header summary).
      const ext_priority = ['normal','high','urgent'].includes((req.body.external_priority || '').trim()) ? req.body.external_priority.trim() : 'normal';
      const summary_json = {
        ...summary,
        currency_code,
        priority_external: ext_priority,
        purpose,
        is_promotion: !!(business_json && business_json.is_promotion),
        // Forward keeps a reference to the source chit (new thread; content unchanged) so it can be grouped later.
        forwarded_from: (typeof req.body.forwarded_from === 'string' && req.body.forwarded_from.length <= 64) ? req.body.forwarded_from : null
      };

      // ── Freeze-at-send (A10): snapshot the governing schema = sender's active default schema ──
      const schemaRow = await query(
        `SELECT schema_id, schema_version
           FROM entity_schemas
          WHERE entity_id = $1 AND status = 'active' AND is_default = true
          ORDER BY created_at DESC
          LIMIT 1`,
        [sender_id]
      );
      const frozen_schema_id      = schemaRow.rows[0]?.schema_id      || null;
      const frozen_schema_version = schemaRow.rows[0]?.schema_version || null;
      const created_by_actor_id   = req.identity.identity_id;   // who actually pressed send

      // ── Compose the per-participant copies for the delivery layer (SENDER always; RECEIVERS unless draft).
      //    Every copy carries the SAME sender = the caller, which is chit_deliver's isolation gate. ──
      const headerCommon = {
        sender_entity_id: sender_id, sender_entity_bridge_id: sender_bridge_id,
        sender_entity_display_name: sender_display_name, all_recipients, purpose,
        auto_subject, manual_subject: manual_subject || null, summary_json,
        schema_version: frozen_schema_version, schema_id: frozen_schema_id, created_by_actor_id,
        detail_type: purpose, line_item_count: summary.line_item_count,
        total_value: summary.total_value, currency_code: summary_json.currency_code,
      };
      const mkCopy = (extra) => {
        const c = { ...headerCommon, ...extra };
        if (business_json) c.business_json = business_json;     // omit -> SQL NULL (matches legacy)
        if (line_items.length > 0) c.line_items = line_items;   // omit -> SQL NULL
        return c;
      };
      const copies = [ mkCopy({
        entity_id: sender_id, direction: 'sent', role: is_draft ? 'Draft' : 'Act',
        current_status: 'delivered', priority_flag: 'normal', payload_delivered: true,
        log: { action: 'created', action_by_identity_id: sender_id, action_by_display_name: sender_display_name,
               new_status: 'delivered', detail: `Chit created and sent to ${receiverDetails.map(r => r.display_name).join(', ')}` },
      }) ];
      if (!is_draft) for (const receiver of receiverDetails) {
        const rcv_status = receiver.kind === 'to' ? 'pending' : 'delivered';   // To acts; CC/For informational
        copies.push(mkCopy({
          entity_id: receiver.entity_id, direction: 'received', role: receiver.role,
          current_status: rcv_status, priority_flag: 'normal',
          log: { action: 'delivered', action_by_identity_id: sender_id, action_by_display_name: sender_display_name,
                 new_status: rcv_status, detail: `Chit received from ${sender_display_name} (${receiver.kind.toUpperCase()})` },
        }));
      }

      // ── Guaranteed write: every row for this chit commits together, or none do (INV-2). Delivery is a substrate
      //    op (writes each participant's copy, incl. receivers) -> the b50 SECURITY DEFINER fn chit_deliver, run in
      //    withEntity(sender). Fallback to the legacy in-tx fan-out when b50 isn't applied. ──
      if (await definersReady()) {
        await withEntity(sender_id, (db) => db.query(
          `SELECT chit_deliver($1,$2,$3::jsonb)`,
          [chit_id, !!promote_draft_id, JSON.stringify(copies)]));
      } else {
      await withTransaction(async (client) => {
        if (promote_draft_id) {   // promoting/updating: clear the draft's own rows so this chit re-inserts cleanly under the SAME id
          await client.query('DELETE FROM state_log  WHERE chit_id = $1 AND entity_id = $2', [chit_id, sender_id]);
          await client.query('DELETE FROM chit_detail WHERE chit_id = $1 AND entity_id = $2', [chit_id, sender_id]);
          await client.query('DELETE FROM chit_status WHERE chit_id = $1 AND entity_id = $2', [chit_id, sender_id]);
          await client.query('DELETE FROM chit_header WHERE chit_id = $1 AND entity_id = $2', [chit_id, sender_id]);
        }
        // SENDER
        await client.query(
          `INSERT INTO chit_header
           (chit_id, entity_id, sender_entity_id, sender_entity_bridge_id,
            sender_entity_display_name, all_recipients, purpose,
            auto_subject, manual_subject, summary_json, business_json,
            schema_version, schema_id, created_by_actor_id, role, chit_ref, direction, sent_at, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,NOW(),NOW())`,
          [chit_id, sender_id, sender_id, sender_bridge_id,
           sender_display_name, JSON.stringify(all_recipients), purpose,
           auto_subject, manual_subject || null,
           JSON.stringify(summary_json),
           business_json ? JSON.stringify(business_json) : null,
           frozen_schema_version, frozen_schema_id, created_by_actor_id,
           is_draft ? 'Draft' : 'Act', chit_id, 'sent']
        );
        await client.query(
          `INSERT INTO chit_detail
           (chit_id, entity_id, detail_type, line_item_count,
            total_value, currency_code, line_items, direction, payload_delivered_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())`,
          [chit_id, sender_id, purpose,
           summary.line_item_count, summary.total_value,
           summary_json.currency_code,
           line_items.length > 0 ? JSON.stringify(line_items) : null, 'sent']
        );
        await client.query(
          `INSERT INTO chit_status (chit_id, entity_id, current_status, direction, priority_flag)
           VALUES ($1,$2,'delivered','sent',$3)`,
          [chit_id, sender_id, 'normal']  // internal priority starts normal; each party sets its own (external rides on summary_json)
        );
        await client.query(
          `INSERT INTO state_log
           (chit_id, entity_id, action, action_by_identity_id,
            action_by_display_name, new_status, detail)
           VALUES ($1,$2,'created',$3,$4,'delivered',$5)`,
          [chit_id, sender_id, sender_id, sender_display_name,
           `Chit created and sent to ${receiverDetails.map(r => r.display_name).join(', ')}`]
        );

        // RECIPIENTS (skipped for drafts — a draft is the author's copy only)
        if (!is_draft) for (const receiver of receiverDetails) {
          const rcv_status = receiver.kind === 'to' ? 'pending' : 'delivered'; // To acts; CC/For are informational
          await client.query(
            `INSERT INTO chit_header
             (chit_id, entity_id, sender_entity_id, sender_entity_bridge_id,
              sender_entity_display_name, all_recipients, purpose,
              auto_subject, manual_subject, summary_json, business_json,
              schema_version, schema_id, created_by_actor_id, role, chit_ref, direction, sent_at, created_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,NOW(),NOW())`,
            [chit_id, receiver.entity_id, sender_id, sender_bridge_id,
             sender_display_name, JSON.stringify(all_recipients), purpose,
             auto_subject, manual_subject || null,
             JSON.stringify(summary_json),
             business_json ? JSON.stringify(business_json) : null,
             frozen_schema_version, frozen_schema_id, created_by_actor_id,
             receiver.role, chit_id, 'received']
          );
          await client.query(
            `INSERT INTO chit_detail
             (chit_id, entity_id, detail_type, line_item_count,
              total_value, currency_code, line_items, direction)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [chit_id, receiver.entity_id, purpose,
             summary.line_item_count, summary.total_value,
             summary_json.currency_code,
             line_items.length > 0 ? JSON.stringify(line_items) : null, 'received']
          );
          await client.query(
            `INSERT INTO chit_status (chit_id, entity_id, current_status, direction)
             VALUES ($1,$2,$3,'received')`,
            [chit_id, receiver.entity_id, rcv_status]
          );
          await client.query(
            `INSERT INTO state_log
             (chit_id, entity_id, action, action_by_identity_id,
              action_by_display_name, new_status, detail)
             VALUES ($1,$2,'delivered',$3,$4,$5,$6)`,
            [chit_id, receiver.entity_id, sender_id, sender_display_name, rcv_status,
             `Chit received from ${sender_display_name} (${receiver.kind.toUpperCase()})`]
          );
        }
      });
      }

      // ── Best-effort CRM auto-add — AFTER commit; a CRM write must never fail a guaranteed chit (D-065) ──
      // Q4: this post-commit write is OUTSIDE the delivery, so it runs in its OWN withEntity(sender) — customer_list
      // is RLS-scoped on owner_entity_id, so a bare query() would fail closed under FORCE.
      if (!is_draft) for (const receiver of receiverDetails) {
        try {
          await withEntity(sender_id, async (db) => {
            const isSupplier = await db.query(
              `SELECT 1 FROM supplier_list
                WHERE owner_entity_id = $1 AND supplier_entity_id = $2`,
              [sender_id, receiver.entity_id]
            );
            if (isSupplier.rows.length === 0) {
              await db.query(
                `INSERT INTO customer_list
                   (owner_entity_id, customer_identity_id, customer_type, added_via, txn_count, last_txn_at)
                 VALUES ($1, $2, 'entity', 'transaction', 1, NOW())
                 ON CONFLICT (owner_entity_id, customer_identity_id)
                 DO UPDATE SET txn_count = customer_list.txn_count + 1, last_txn_at = NOW()`,
                [sender_id, receiver.entity_id]
              );
            }
          });
        } catch (e) { console.log('customer auto-add skipped:', e.message); }
      }

      // ── Best-effort auto-assign on receipt (D1) — AFTER commit; never fails the guaranteed chit ──
      // Only the actionable 'to' copy is auto-assigned; CC/For stay informational. Each receiver entity
      // resolves against ITS OWN settings/roster (the receiver decides how its inbox auto-assigns).
      if (!is_draft) for (const receiver of receiverDetails) {
        if (receiver.kind !== 'to' || !receiver.entity_id) continue;
        try { await autoAssignReceived(receiver.entity_id, chit_id); }
        catch (e) { console.log('auto-assign skipped:', e.message); }
      }

      res.json({
        message: is_draft ? 'Draft saved' : 'Chit sent successfully',
        chit_id,
        auto_subject,
        is_draft,
        recipients: is_draft ? 0 : receiverDetails.length,
        fan_out: { to: counts.to, cc: counts.cc, for: counts.for },
        summary: summary_json
      });

    } catch (err) {
      console.error('Send chit error:', err.message);
      res.status(500).json({ error: 'Send failed', message: safeErr(err) });
    }
  }
);

// ─── GET /chits/inbox ─────────────────────────────────────────
// Lightweight inbox — my chit_status only — fast
// GET /chits/sent — chits I sent (my sender copy), newest first, paginated.
// Mounted BEFORE /:chit_id so "sent" is never parsed as a chit_id.
// Advanced-search filters shared by the chit lists: amount range, date range, priority, status bucket.
// All parameterised (no injection). Used by /inbox, /sent, /folder. (Criteria set can become schema-driven later.)
function chitFilters(req, where, params){
  const num = v => { const n = parseFloat(v); return isFinite(n) ? n : null; };
  const amin = num(req.query.amount_min), amax = num(req.query.amount_max);
  if (amin !== null) { params.push(amin); where += ` AND COALESCE((ch.summary_json->>'total_value')::numeric,0) >= $${params.length}`; }
  if (amax !== null) { params.push(amax); where += ` AND COALESCE((ch.summary_json->>'total_value')::numeric,0) <= $${params.length}`; }
  if (req.query.date_from) { params.push(req.query.date_from); where += ` AND ch.created_at >= $${params.length}::timestamptz`; }
  if (req.query.date_to)   { params.push(req.query.date_to);   where += ` AND ch.created_at < ($${params.length}::date + interval '1 day')`; }
  if (req.query.priority)  { params.push(req.query.priority);  where += ` AND cs.priority_flag = $${params.length}`; }
  if (req.query.fstatus)   {
    const B = { open:['pending','delivered','read'], act:['accepted','in_progress','partial'], close:['completed','cancelled','rejected'] };
    const L = B[req.query.fstatus] || [req.query.fstatus];
    const ph = L.map(s => { params.push(s); return '$'+params.length; }).join(',');
    where += ` AND cs.current_status IN (${ph})`;
  }
  // Delegation scope: unassigned = the entity's own pool; assigned = delegated to a co-assist. assigned_to=me|<id>
  // scopes to one actor (fixes actor "My Task"). No param = everything (back-compat).
  if (req.query.assignment === 'unassigned')      where += ` AND cs.assigned_to_actor_id IS NULL`;
  else if (req.query.assignment === 'assigned')   where += ` AND cs.assigned_to_actor_id IS NOT NULL`;
  const at = req.query.assigned_to;
  if (at === 'me')                            { params.push(req.identity.identity_id); where += ` AND cs.assigned_to_actor_id = $${params.length}`; }
  else if (at && at !== 'me' && at !== 'all') { params.push(at); where += ` AND cs.assigned_to_actor_id = $${params.length}`; }
  // D4: dispute filter — chits with an OPEN dispute this entity is involved in (raiser / target / listed party / chit-wide).
  if (req.query.dispute === 'open' || req.query.dispute === 'active') {
    params.push(req.identity.parent_entity_id || req.identity.identity_id);
    const e = params.length;
    where += ` AND EXISTS (SELECT 1 FROM chit_disputes cd WHERE cd.chit_id = ch.chit_id AND cd.status = 'open'
                 AND (cd.scope = 'chit_wide' OR cd.raised_by_entity_id = $${e} OR cd.target_entity_id = $${e}
                      OR EXISTS (SELECT 1 FROM dispute_participants dp WHERE dp.dispute_id = cd.dispute_id AND dp.entity_id = $${e} AND dp.dispute_status = 'open')))`;
  }
  return where;
}

router.get('/sent', auth, async (req, res) => {
  try {
    const entity_id = req.identity.parent_entity_id || req.identity.identity_id;
    const page   = parseInt(req.query.page || 1);
    const limit  = parseInt(req.query.limit || 20);
    const offset = (page - 1) * limit;
    const q_search = (req.query.q || '').trim();

    // search across the header data (subject, recipients, purpose). pg_trgm GIN index recommended at scale.
    const params = [entity_id];
    let where = `ch.entity_id = $1 AND ch.direction = 'sent' AND ch.role <> 'Draft' AND cs.deleted_at IS NULL AND cs.archived_at IS NULL`;
    if (q_search) {
      params.push('%' + q_search + '%');
      where += ` AND (ch.manual_subject ILIKE $${params.length} OR ch.auto_subject ILIKE $${params.length} OR ch.all_recipients::text ILIKE $${params.length} OR ch.purpose ILIKE $${params.length})`;
    }
    const joinFrom = `FROM chit_header ch
         JOIN chit_status cs ON cs.chit_id = ch.chit_id AND cs.entity_id = ch.entity_id AND cs.direction = ch.direction`;

    where = chitFilters(req, where, params);
    // B1 RLS: caller reads only its own entity_id rows -> run inside withEntity(me).
    const { countResult, result } = await withEntity(entity_id, async (db) => {
    const countResult = await db.query(`SELECT COUNT(*) ${joinFrom} WHERE ${where}`, params);

    const limIdx = params.length + 1, offIdx = params.length + 2;
    const result = await db.query(
      `SELECT ch.chit_id, ch.all_recipients, ch.purpose, ch.auto_subject, ch.manual_subject,
              ch.summary_json, ch.created_at, ch.role,
              cs.current_status, cs.priority_flag, cs.customer_priority, cs.star_flag,
              (SELECT COUNT(*) FROM chit_disputes cd
                WHERE cd.chit_id = ch.chit_id AND cd.status = 'open'
                  AND (cd.scope='chit_wide' OR cd.raised_by_entity_id=$1 OR cd.target_entity_id=$1
                       OR EXISTS (SELECT 1 FROM dispute_participants dp
                                   WHERE dp.dispute_id=cd.dispute_id AND dp.entity_id=$1 AND dp.dispute_status='open'))) AS open_dispute_count,
              (SELECT COUNT(*) FROM chit_disputes cd
                WHERE cd.chit_id = ch.chit_id AND cd.status = 'resolved'
                  AND (cd.scope='chit_wide' OR cd.raised_by_entity_id=$1 OR cd.target_entity_id=$1
                       OR EXISTS (SELECT 1 FROM dispute_participants dp
                                   WHERE dp.dispute_id=cd.dispute_id AND dp.entity_id=$1))) AS resolved_dispute_count
         ${joinFrom}
        WHERE ${where}
        ORDER BY ${({date:'ch.created_at',subject:'COALESCE(ch.manual_subject, ch.auto_subject)',from:"(ch.all_recipients->1->>'display_name')",amount:"(ch.summary_json->>'total_value')::numeric",status:'cs.current_status',priority:"CASE cs.priority_flag WHEN 'urgent' THEN 3 WHEN 'high' THEN 2 WHEN 'normal' THEN 1 ELSE 0 END",priority_ext:"CASE ch.summary_json->>'priority_external' WHEN 'urgent' THEN 3 WHEN 'high' THEN 2 WHEN 'normal' THEN 1 ELSE 0 END"}[req.query.sort]||'ch.created_at')} ${(String(req.query.dir||'').toLowerCase()==='asc')?'ASC':'DESC'}, ch.created_at DESC
        LIMIT $${limIdx} OFFSET $${offIdx}`,
      [...params, limit, offset]
    );
    return { countResult, result };
    });

    res.json({ chits: result.rows, total: parseInt(countResult.rows[0].count), page, limit });
  } catch (err) {
    console.error('Sent list error:', err.message);
    res.status(500).json({ error: 'Failed to get sent items', message: safeErr(err) });
  }
});

// GET /chits/folder?view=drafts|trash|archive — mailbox folders (both directions), paginated + searchable + sortable.
// Mounted BEFORE /:chit_id so "folder" is never parsed as a chit_id.
router.get('/folder', auth, async (req, res) => {
  try {
    const entity_id = req.identity.parent_entity_id || req.identity.identity_id;
    const page   = parseInt(req.query.page || 1);
    const limit  = parseInt(req.query.limit || 20);
    const offset = (page - 1) * limit;
    const view   = req.query.view || 'drafts';
    const q_search = (req.query.q || '').trim();

    const params = [entity_id];
    let where = `cs.entity_id = $1`;
    if (view === 'trash')        where += ` AND cs.deleted_at IS NOT NULL`;
    else if (view === 'archive') where += ` AND cs.archived_at IS NOT NULL AND cs.deleted_at IS NULL`;
    else {                       where += ` AND ch.role = 'Draft' AND cs.deleted_at IS NULL`;   // drafts
      // Drafts are personal WIP until sent: an actor sees ONLY the drafts they authored (mailing model).
      params.push(req.identity.identity_id);
      where += ` AND ch.created_by_actor_id = $${params.length}`;
    }
    if (q_search) {
      params.push('%' + q_search + '%');
      where += ` AND (ch.manual_subject ILIKE $${params.length} OR ch.auto_subject ILIKE $${params.length} OR ch.all_recipients::text ILIKE $${params.length} OR ch.purpose ILIKE $${params.length})`;
    }
    const joinFrom = `FROM chit_status cs
         JOIN chit_header ch ON ch.chit_id = cs.chit_id AND ch.entity_id = cs.entity_id AND ch.direction = cs.direction`;
    // dedupe self-chits (both copies in trash/archive) to one row per chit, preferring the sent copy
    where = chitFilters(req, where, params);
    // B1 RLS: caller reads only its own entity_id rows -> run inside withEntity(me).
    const { countResult, result } = await withEntity(entity_id, async (db) => {
    const countResult = await db.query(`SELECT COUNT(DISTINCT ch.chit_id) ${joinFrom} WHERE ${where}`, params);

    const orderBy = ({date:'created_at',subject:'COALESCE(manual_subject, auto_subject)',amount:"(summary_json->>'total_value')::numeric",status:'current_status',priority:"CASE priority_flag WHEN 'urgent' THEN 3 WHEN 'high' THEN 2 WHEN 'normal' THEN 1 ELSE 0 END",priority_ext:"CASE summary_json->>'priority_external' WHEN 'urgent' THEN 3 WHEN 'high' THEN 2 WHEN 'normal' THEN 1 ELSE 0 END"}[req.query.sort] || 'created_at')
                  + ' ' + ((String(req.query.dir||'').toLowerCase()==='asc') ? 'ASC' : 'DESC');
    const result = await db.query(
      `SELECT * FROM (
         SELECT DISTINCT ON (ch.chit_id)
              ch.chit_id, ch.sender_entity_display_name, ch.sender_entity_bridge_id, ch.all_recipients,
              ch.purpose, ch.auto_subject, ch.manual_subject, ch.summary_json, ch.created_at,
              cs.current_status, cs.read_at, cs.star_flag, cs.priority_flag, cs.deleted_at, cs.archived_at, ch.direction,
              (SELECT COUNT(*) FROM chit_messages cm
                WHERE cm.chit_id = ch.chit_id AND cm.visibility_entity_id IS NULL) AS message_count
           ${joinFrom}
          WHERE ${where}
          ORDER BY ch.chit_id, (ch.direction = 'sent') DESC
       ) t
       ORDER BY ${orderBy}, created_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    );
    return { countResult, result };
    });
    res.json({ chits: result.rows, total: parseInt(countResult.rows[0].count), page, limit, view });
  } catch (err) {
    console.error('Folder error:', err.message);
    res.status(500).json({ error: 'Failed to get folder', message: safeErr(err) });
  }
});

// GET /chits/rollup?group_by=counterparty|state — read-only grouped summary over MY chits.
// No merge, no new chit, the seal is untouched. Mounted BEFORE /:chit_id.
router.get('/rollup', auth, async (req, res) => {
  try {
    const entity_id = req.identity.parent_entity_id || req.identity.identity_id;
    const groupBy = (req.query.group_by === 'state') ? 'state' : 'counterparty';
    const keyExpr = groupBy === 'state' ? 'cs.current_status' : 'ch.sender_entity_display_name';
    // direction scopes the rollup to Task (received) or Order (sent); omit for both. Without it, self-chits
    // (sent+received held by one entity) would double-count.
    const dir = (req.query.direction === 'sent' || req.query.direction === 'received') ? req.query.direction : null;
    const params = [entity_id];
    let where = `cs.entity_id = $1 AND cs.deleted_at IS NULL AND cs.archived_at IS NULL`;
    if (dir) { params.push(dir); where += ` AND cs.direction = $${params.length}`; }
    if (req.query.assignment === 'unassigned')      where += ` AND cs.assigned_to_actor_id IS NULL`;
    else if (req.query.assignment === 'assigned')   where += ` AND cs.assigned_to_actor_id IS NOT NULL`;
    else if (req.query.assigned_to === 'me')        { params.push(req.identity.identity_id); where += ` AND cs.assigned_to_actor_id = $${params.length}`; }
    // B1 RLS: caller reads only its own entity_id rows -> run inside withEntity(me).
    const { result, disp } = await withEntity(entity_id, async (db) => {
    const result = await db.query(
      `SELECT ${keyExpr} AS key, COUNT(*)::int AS chits,
              COALESCE(SUM((ch.summary_json->>'total_value')::numeric), 0) AS total_value
         FROM chit_status cs
         JOIN chit_header ch ON ch.chit_id = cs.chit_id AND ch.entity_id = cs.entity_id AND ch.direction = cs.direction
        WHERE ${where}
        GROUP BY ${keyExpr}
        ORDER BY chits DESC`,
      params
    );
    // D4: open-dispute count for the same scope — powers the "Disputes (n)" filter in the task menu.
    // Guarded so a pre-migration DB (no dispute tables) simply reports 0 rather than failing the rollup.
    const disp = await db.query(
      `SELECT COUNT(DISTINCT cs.chit_id)::int AS n
         FROM chit_status cs
        WHERE ${where}
          AND EXISTS (SELECT 1 FROM chit_disputes cd WHERE cd.chit_id = cs.chit_id AND cd.status = 'open'
                       AND (cd.scope = 'chit_wide' OR cd.raised_by_entity_id = $1 OR cd.target_entity_id = $1
                            OR EXISTS (SELECT 1 FROM dispute_participants dp WHERE dp.dispute_id = cd.dispute_id AND dp.entity_id = $1 AND dp.dispute_status = 'open')))`,
      params).catch(() => ({ rows: [{ n: 0 }] }));
    return { result, disp };
    });
    res.json({ group_by: groupBy, direction: dir, groups: result.rows, dispute_open: disp.rows[0].n });
  } catch (err) {
    console.error('Rollup error:', err.message);
    res.status(500).json({ error: 'Rollup failed', message: safeErr(err) });
  }
});

router.get('/inbox', auth, async (req, res) => {
  try {
    // Actors query their parent entity's inbox (chit_status is entity-keyed)
    const entity_id = req.identity.parent_entity_id || req.identity.identity_id;
    const page = parseInt(req.query.page || 1);
    const limit = parseInt(req.query.limit || 20);
    const offset = (page - 1) * limit;
    const status_filter = req.query.status || null;
    const q_search = (req.query.q || '').trim();

    let whereClause = `cs.entity_id = $1 AND cs.direction = 'received' AND cs.deleted_at IS NULL AND cs.archived_at IS NULL`;
    const params = [entity_id];
    let paramCount = 1;
    if (await folderColReady()) whereClause += ` AND cs.folder_id IS NULL`;   // filed chits show in their folder view, not Task (query-only — no data moved; guarded so a missing column never blanks Task)

    if (status_filter) {
      paramCount++;
      whereClause += ` AND cs.current_status = $${paramCount}`;
      params.push(status_filter);
    }

    if (q_search) {
      paramCount++;
      whereClause += ` AND (ch.manual_subject ILIKE $${paramCount} OR ch.auto_subject ILIKE $${paramCount} OR ch.sender_entity_display_name ILIKE $${paramCount} OR ch.all_recipients::text ILIKE $${paramCount} OR ch.purpose ILIKE $${paramCount})`;
      params.push('%' + q_search + '%');
    }

    whereClause = chitFilters(req, whereClause, params);
    paramCount = params.length;
    // B1 RLS: caller reads only its own entity_id rows -> run inside withEntity(me).
    const { countResult, result } = await withEntity(entity_id, async (db) => {
    const countResult = await db.query(
      `SELECT COUNT(*) FROM chit_status cs
        JOIN chit_header ch ON ch.chit_id = cs.chit_id AND ch.entity_id = cs.entity_id AND ch.direction = cs.direction
        WHERE ${whereClause}`,
      params
    );

    // Get inbox — lightweight — no payload
    const result = await db.query(
      `SELECT
         ch.chit_id,
         ch.sender_entity_display_name,
         ch.sender_entity_bridge_id,
         ch.all_recipients,
         ch.purpose,
         ch.auto_subject,
         ch.manual_subject,
         ch.summary_json,
         ch.created_at,
         cs.current_status,
         cs.read_at,
         cs.star_flag,
         cs.priority_flag,
         cs.assignment_type,
         cs.assigned_to_actor_id,
         cs.assigned_to_actor_display_name,
         (SELECT COUNT(*) FROM chit_disputes cd
          WHERE cd.chit_id = ch.chit_id AND cd.status = 'open'
            AND (cd.scope='chit_wide' OR cd.raised_by_entity_id=$1 OR cd.target_entity_id=$1
                 OR EXISTS (SELECT 1 FROM dispute_participants dp
                             WHERE dp.dispute_id=cd.dispute_id AND dp.entity_id=$1 AND dp.dispute_status='open'))) AS open_dispute_count,
         (SELECT COUNT(*) FROM chit_disputes cd
          WHERE cd.chit_id = ch.chit_id AND cd.status = 'resolved'
            AND (cd.scope='chit_wide' OR cd.raised_by_entity_id=$1 OR cd.target_entity_id=$1
                 OR EXISTS (SELECT 1 FROM dispute_participants dp
                             WHERE dp.dispute_id=cd.dispute_id AND dp.entity_id=$1))) AS resolved_dispute_count,
         (SELECT COUNT(*) FROM chit_messages cm
          WHERE cm.chit_id = ch.chit_id AND cm.visibility_entity_id IS NULL) AS message_count,
         (SELECT MAX(cm2.created_at) FROM chit_messages cm2
          WHERE cm2.chit_id = ch.chit_id AND cm2.visibility_entity_id IS NULL) AS last_message_at,
         (SELECT sl.action_by_display_name FROM state_log sl
          WHERE sl.chit_id = ch.chit_id AND sl.entity_id = ch.entity_id AND sl.action = 'created'
          ORDER BY sl.created_at ASC LIMIT 1) AS placed_by_name,
         (SELECT i.identity_type FROM state_log sl
          LEFT JOIN identities i ON i.identity_id = sl.action_by_identity_id
          WHERE sl.chit_id = ch.chit_id AND sl.entity_id = ch.entity_id AND sl.action = 'created'
          ORDER BY sl.created_at ASC LIMIT 1) AS placed_by_type
       FROM chit_status cs
       JOIN chit_header ch ON ch.chit_id = cs.chit_id
                          AND ch.entity_id = cs.entity_id
                          AND ch.direction = cs.direction
       WHERE ${whereClause}
       ORDER BY ${({date:'ch.created_at',subject:'COALESCE(ch.manual_subject, ch.auto_subject)',from:'ch.sender_entity_display_name',amount:"(ch.summary_json->>'total_value')::numeric",status:'cs.current_status',priority:"CASE cs.priority_flag WHEN 'urgent' THEN 3 WHEN 'high' THEN 2 WHEN 'normal' THEN 1 ELSE 0 END",priority_ext:"CASE ch.summary_json->>'priority_external' WHEN 'urgent' THEN 3 WHEN 'high' THEN 2 WHEN 'normal' THEN 1 ELSE 0 END"}[req.query.sort]||'ch.created_at')} ${(String(req.query.dir||'').toLowerCase()==='asc')?'ASC':'DESC'}, ch.created_at DESC
       LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`,
      [...params, limit, offset]
    );
    return { countResult, result };
    });

    res.json({
      chits: result.rows,
      // top-level total/page/limit — mirrors /sent so the web pager treats both lists the same
      total: parseInt(countResult.rows[0].count),
      page,
      limit,
      pagination: {
        total: parseInt(countResult.rows[0].count),
        page,
        limit,
        pages: Math.ceil(countResult.rows[0].count / limit)
      }
    });

  } catch (err) {
    console.error('Inbox error:', err.message);
    res.status(500).json({ error: 'Failed to get inbox', message: safeErr(err) });
  }
});

// ─── GET /chits/:chit_id ──────────────────────────────────────
// Full chit detail — all participants, full state log, line items
// GET /chits/unread — chit_ids that are unread FOR THE CALLING ACTOR (per-actor read state).
// Unread = no chit_reads row yet, or the copy changed (cs.updated_at) after the actor last opened it.
// Entity (non-actor) logins get [] — they use the entity-level read_at. Mounted BEFORE /:chit_id.
router.get('/unread', auth, async (req, res) => {
  try {
    if (req.identity.identity_type !== 'actor') return res.json({ unread: [] });
    const entity_id = req.identity.parent_entity_id || req.identity.identity_id;
    const actor_id  = req.identity.identity_id;
    // B1 RLS: caller reads only its own entity_id rows -> run inside withEntity(me).
    const r = await withEntity(entity_id, (db) => db.query(
      `SELECT DISTINCT cs.chit_id
         FROM chit_status cs
         LEFT JOIN chit_reads cr ON cr.chit_id = cs.chit_id AND cr.actor_id = $2
        WHERE cs.entity_id = $1 AND cs.deleted_at IS NULL
          AND (cr.read_at IS NULL OR cs.updated_at > cr.read_at)`,
      [entity_id, actor_id]));
    res.json({ unread: r.rows.map(x => x.chit_id) });
  } catch (err) { res.status(500).json({ error: 'Unread failed', message: safeErr(err) }); }
});

router.get('/:chit_id', auth, async (req, res) => {
  try {
    const chit_id = req.params.chit_id;
    // Actors use parent entity's id — chit_header and chit_status are entity-keyed
    const entity_id = req.identity.parent_entity_id || req.identity.identity_id;

    // B1 RLS: everything here is the caller's OWN copy -> withEntity(me).
    const data = await withEntity(entity_id, async (db) => {
      // Verify entity participates in this chit
      const participation = await db.query(
        `SELECT role, created_by_actor_id FROM chit_header
         WHERE chit_id = $1 AND entity_id = $2`,
        [chit_id, entity_id]
      );
      if (participation.rows.length === 0) return { notFound: true };
      // Draft privacy: a draft is the author's PRIVATE WIP — another actor of the SAME entity must not read it,
      // even by direct id. The drafts LIST is author-scoped (created_by_actor_id); the detail read must be too.
      const _draft = participation.rows.find(r => r.role === 'Draft');
      if (_draft && _draft.created_by_actor_id !== req.identity.identity_id) return { notFound: true };

      // Per-actor read: opening the chit marks it read for THIS actor (clears its unread flag).
      // Best-effort — never let read-tracking break the chit view (chit_reads is not RLS-scoped).
      if (req.identity.identity_type === 'actor') {
        // SAVEPOINT so a failure here (e.g. a missing table) can't poison the outer transaction and 500 the read.
        try {
          await db.query('SAVEPOINT mark_read');
          await db.query(
            `INSERT INTO chit_reads (chit_id, actor_id, read_at) VALUES ($1, $2, NOW())
             ON CONFLICT (chit_id, actor_id) DO UPDATE SET read_at = NOW()`,
            [chit_id, req.identity.identity_id]);
          await db.query('RELEASE SAVEPOINT mark_read');
        } catch (e) {
          console.error('mark-read skipped:', e.message);
          try { await db.query('ROLLBACK TO SAVEPOINT mark_read'); } catch (_) {}
        }
      }

      // Get my header
      const header = await db.query(
        `SELECT * FROM chit_header
         WHERE chit_id = $1 AND entity_id = $2`,
        [chit_id, entity_id]
      );

      // Get my detail — line items if still present
      const detail = await db.query(
        `SELECT detail_type, line_item_count, total_value, currency_code,
                line_items, payload_delivered_at, payload_deleted_at
         FROM chit_detail
         WHERE chit_id = $1 AND entity_id = $2`,
        [chit_id, entity_id]
      );

      // Each participant has their own copy (entity_id = their entity).
      const log = await db.query(
        `SELECT action, action_by_display_name, previous_status,
                new_status, detail, created_at
         FROM state_log
         WHERE chit_id = $1 AND entity_id = $2 AND action != 'read'
         ORDER BY created_at ASC`,
        [chit_id, entity_id]
      );

      // Check if first time reading (before update) to decide whether to log it
      const preCheck = await db.query(
        `SELECT read_at FROM chit_status WHERE chit_id = $1 AND entity_id = $2`,
        [chit_id, entity_id]
      );
      const wasUnread = !preCheck.rows[0]?.read_at;

      // Update read_at FIRST so the participants panel reflects this read
      await db.query(
        `UPDATE chit_status
         SET read_at = NOW()
         WHERE chit_id = $1 AND entity_id = $2`,
        [chit_id, entity_id]
      );

      if (wasUnread) {
        await db.query(
          `INSERT INTO state_log
           (chit_id, entity_id, action, action_by_identity_id,
            action_by_display_name, detail)
           VALUES ($1,$2,'read',$3,$4,'Chit opened and read')`,
          [chit_id, entity_id, entity_id, req.identity.display_name]
        );
      }
      return { header, detail, log };
    });

    if (data.notFound) {
      return res.status(404).json({
        error: 'Not found',
        message: 'Chit not found or you do not have access'
      });
    }

    // Participants panel = a deliberate CROSS-entity read (who has read/accepted). Under RLS it is served by the
    // b50 SECURITY DEFINER fn chit_participants (validates caller is a participant, then crosses). Fallback to the
    // direct join when the delivery layer (b50) isn't applied yet, so the page works before/after the migration;
    // under FORCE without the fn the fallback scopes to self (degraded panel, never a leak).
    let participants;
    try {
      const ps = await withEntity(entity_id, (db) => db.query(`SELECT * FROM chit_participants($1)`, [chit_id]));
      participants = ps.rows;
    } catch (e) {
      if (e && (e.code === '42883' || /chit_participants/.test(e.message || ''))) {
        const ps = await withEntity(entity_id, (db) => db.query(
          `SELECT cs.entity_id, cs.current_status, cs.read_at,
                  cs.assigned_to_actor_display_name, cs.updated_at,
                  i.display_name, i.bridge_id
           FROM chit_status cs
           JOIN identities i ON i.identity_id = cs.entity_id
           WHERE cs.chit_id = $1`,
          [chit_id]));
        participants = ps.rows;
      } else throw e;
    }

    const attachments = await storage.listForChit(chit_id, entity_id).catch(() => []);   // per-entity: the caller's OWN copies only
    res.json({
      header: data.header.rows[0],
      detail: data.detail.rows[0] || null,
      participants,
      state_log: data.log.rows,
      attachments
    });

  } catch (err) {
    console.error('Chit detail error:', err.message);
    res.status(500).json({ error: 'Failed to get chit', message: safeErr(err) });
  }
});

// ─── PUT /chits/:chit_id/status ───────────────────────────────
// Update chit status — accept, reject, complete etc
router.put('/:chit_id/status',
  [
    body('status')
      .trim()
      .isIn(['pending','accepted','rejected','in_progress','partial','completed','cancelled'])
      .withMessage('Invalid status'),
    body('note').optional().trim().isLength({ max: 500 }),
  ],
  validate,
  auth,
  async (req, res) => {
    try {
      const chit_id      = req.params.chit_id;
      // entity_id   = participant entity context (parent for actors, self for entities)
      // action_by_* = whoever is performing — entity admin or actor, never remapped
      const entity_id    = req.identity.parent_entity_id || req.identity.identity_id;
      const action_by_id   = req.identity.identity_id;
      const action_by_name = req.identity.display_name;
      const new_status = req.body.status;
      const note = sanitise(req.body.note || '');

      // Get current status
      // B1 RLS: own received-copy read -> withEntity(me).
      const current = await withEntity(entity_id, (db) => db.query(
        `SELECT current_status FROM chit_status
         WHERE chit_id = $1 AND entity_id = $2 AND direction = 'received'`,
        [chit_id, entity_id]
      ));

      if (current.rows.length === 0) {
        return res.status(404).json({
          error: 'Not found',
          message: 'Chit not found'
        });
      }

      const previous_status = current.rows[0].current_status;

      // Idempotent: advancing to the status it's already in is a no-op success (not a 400).
      // Fixes the "Cannot move from accepted to accepted" error when a self-chit's displayed copy diverges. (E — symptom fix; direction-scoping still backlog.)
      if (new_status === previous_status) {
        return res.json({ message: `Already ${new_status}`, chit_id, status: new_status, noop: true });
      }

      // Validate state transitions
      // Arrow model: Open(pending/delivered/read) → in_progress → completed
      // ← regress: in_progress/accepted → pending, completed → in_progress
      // Legacy accepted step kept for backward compat (ChitDetailPage still uses it)
      // 3-state UI model (Open / Act / Close) is bidirectional: from any state you can reach any of the three
      // canonical targets — pending (Open), in_progress (Act), completed (Close). Sub-statuses kept for compat.
      const validTransitions = {
        'pending':     ['in_progress', 'completed', 'accepted', 'rejected', 'cancelled'],
        'delivered':   ['in_progress', 'completed', 'accepted', 'rejected', 'cancelled', 'pending'],
        'read':        ['in_progress', 'completed', 'accepted', 'rejected', 'cancelled', 'pending'],
        'accepted':    ['in_progress', 'completed', 'pending', 'rejected', 'cancelled'],
        'in_progress': ['partial', 'completed', 'pending', 'accepted', 'cancelled'],
        'partial':     ['in_progress', 'completed', 'pending', 'cancelled'],
        'completed':   ['in_progress', 'pending'],
        'rejected':    ['accepted', 'pending', 'in_progress', 'completed'],
        'cancelled':   ['accepted', 'pending', 'in_progress', 'completed'],
      };

      const allowed = validTransitions[previous_status] || [];
      if (!allowed.includes(new_status)) {
        return res.status(400).json({
          error: 'Invalid transition',
          message: `Cannot move from ${previous_status} to ${new_status}`,
          allowed_transitions: allowed
        });
      }

      // C1 (per Athi 2026-07-05): closing a DISPUTED chit (completed/cancelled) is ALLOWED, but we WARN + record WHO did it
      // (surfaced to the UI + written to the timeline). Archive/delete still hard-block — a separate, stricter rule.
      let disputeWarning = null;
      if (new_status === 'completed' || new_status === 'cancelled') {
        const openD = await query(`SELECT COUNT(*)::int AS count FROM chit_disputes WHERE chit_id = $1 AND status = 'open'`,
          [chit_id]).catch(() => ({ rows: [{ count: 0 }] }));
        if (openD.rows[0].count > 0) disputeWarning = `Chit closed with an OPEN dispute — by ${action_by_name}.`;
      }

      // Update chit_status — the caller's OWN received copy.
      await withEntity(entity_id, (db) => db.query(
        `UPDATE chit_status
         SET current_status = $1, updated_at = NOW()
         WHERE chit_id = $2 AND entity_id = $3 AND direction = 'received'`,
        [new_status, chit_id, entity_id]
      ));

      // One log row per participant — a CROSS-entity write, so via the b50 delivery-agent fn chit_log_all
      // (validated: caller must be a participant). Fallback = the legacy INSERT...SELECT when b50 isn't applied.
      const detail = (note ||
        `Status changed from ${previous_status} to ${new_status} by ${action_by_name}`)
        + (disputeWarning ? ` ⚠ ${disputeWarning}` : '');

      await crossing(entity_id,
        `SELECT chit_log_all($1,$2,$3,$4,$5,$6,$7)`,
        [chit_id, `status_${new_status}`, action_by_id, action_by_name, previous_status, new_status, detail],
        (db) => db.query(
          `INSERT INTO state_log
           (chit_id, entity_id, action, action_by_identity_id,
            action_by_display_name, previous_status, new_status, detail)
           SELECT $1, entity_id, $2, $3, $4, $5, $6, $7
           FROM (SELECT DISTINCT entity_id FROM chit_status WHERE chit_id = $1) cs`,
          [chit_id, `status_${new_status}`, action_by_id, action_by_name, previous_status, new_status, detail]));

      // Get header to check sender and propagate cancellation to receivers (own copy).
      const header = await withEntity(entity_id, (db) => db.query(
        `SELECT sender_entity_id FROM chit_header
         WHERE chit_id = $1 AND entity_id = $2`,
        [chit_id, entity_id]
      ));

      const isSender = header.rows.length > 0 &&
                       header.rows[0].sender_entity_id === entity_id;

      // When the sender cancels — terminal cancel on the WHOLE chit (every participant + the sender's own copy,
      // consistent with /void). CROSS-entity write -> chit_set_status_all (validated: caller must be the sender).
      // Fallback = a single all-rows update when b50 isn't applied.
      if (isSender && new_status === 'cancelled') {
        await crossing(entity_id,
          `SELECT chit_set_status_all($1,$2)`,
          [chit_id, 'cancelled'],
          (db) => db.query(
            `UPDATE chit_status SET current_status = 'cancelled', updated_at = NOW() WHERE chit_id = $1`,
            [chit_id]));
      }

      res.json({
        message: `Chit ${new_status}`,
        warning: disputeWarning,   // C1: set when a disputed chit was closed anyway (UI shows who + that it was open)
        chit_id,
        previous_status,
        new_status
      });

    } catch (err) {
      console.error('Update status error:', err.message);
      res.status(500).json({ error: 'Update failed', message: safeErr(err) });
    }
  }
);

// ─────────────────────────────────────────────────────────────
// B3.5 — MESSAGING (dual thread) and DISPUTE MODULE
// ─────────────────────────────────────────────────────────────

// ─── POST /chits/:chit_id/messages ───────────────────────────
// thread_type: 'external' (all parties see) | 'internal' (sender entity only)
router.post('/:chit_id/messages',
  [
    body('message_text').trim().notEmpty().withMessage('Message text required'),
    body('thread_type').isIn(['external','internal']).withMessage('thread_type must be external or internal'),
    body('is_dispute').optional().isBoolean(),
    body('dispute_id').optional({ nullable:true }).isUUID(),
  ],
  validate,
  auth,
  async (req, res) => {
    const { chit_id }  = req.params;
    const { message_text, thread_type } = req.body;
    const entity_id    = req.identity.parent_entity_id || req.identity.identity_id;
    const display_name = req.identity.display_name;

    try {
      // B1 RLS: participant access check on own copy -> withEntity(me).
      const access = await withEntity(entity_id, (db) => db.query(
        `SELECT entity_id FROM chit_status WHERE chit_id = $1 AND entity_id = $2`,
        [chit_id, entity_id]
      ));
      if (access.rows.length === 0) {
        return res.status(403).json({ error: 'Forbidden', message: 'Not a participant on this chit' });
      }

      // NULL visibility = external (all see); entity_id = internal (only sender sees)
      const visibility_entity_id = thread_type === 'internal' ? entity_id : null;
      // D4: dispute-tagged message — stays filterable in the thread even after the dispute resolves.
      const isDispute = req.body.is_dispute === true || req.body.is_dispute === 'true';
      const disputeId = req.body.dispute_id || null;
      // B3 (Athi): a DISPUTE message posts in the ENTITY's name (the acting actor stays as provenance in the timeline).
      let senderName = display_name;
      if (isDispute && req.identity.parent_entity_id) {
        const _e = await query('SELECT display_name FROM identities WHERE identity_id = $1', [entity_id]).catch(() => ({ rows: [] }));
        if (_e.rows[0] && _e.rows[0].display_name) senderName = _e.rows[0].display_name;
      }

      const result = await query(
        `INSERT INTO chit_messages
           (chit_id, sender_entity_id, sender_display_name,
            thread_type, visibility_entity_id, message_text, is_dispute, dispute_id, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
         RETURNING *`,
        [chit_id, entity_id, senderName, thread_type, visibility_entity_id, message_text, isDispute, disputeId]
      );

      // Log external messages into every participant's timeline — a CROSS-entity write, via chit_log_all
      // (validated: caller must be a participant). Fallback = the legacy per-participant loop when b50 isn't applied.
      if (thread_type === 'external') {
        await crossing(entity_id,
          `SELECT chit_log_all($1,$2,$3,$4,$5,$6,$7)`,
          [chit_id, 'message_sent', entity_id, display_name, null, null, message_text.slice(0, 100)],
          async (db) => {
            // DISTINCT entity: a self-chit has two copies under one entity — log once per entity, not per copy.
            const participants = await db.query(
              `SELECT DISTINCT entity_id FROM chit_status WHERE chit_id = $1`, [chit_id]);
            for (const p of participants.rows) {
              await db.query(
                `INSERT INTO state_log (chit_id, entity_id, action, action_by_identity_id, action_by_display_name, detail)
                 VALUES ($1, $2, 'message_sent', $3, $4, $5)`,
                [chit_id, p.entity_id, entity_id, display_name, message_text.slice(0, 100)]);
            }
          });
      }

      res.json({
        message_id:           result.rows[0].message_id,
        thread_type,
        message_text,
        sender_display_name:  display_name,
        created_at:           result.rows[0].created_at,
      });
    } catch (err) {
      console.error('Send message error:', err.message);
      if (err.message.includes('chit_messages')) {
        return res.status(500).json({ error: 'Table not found', message: 'Run B3.5 migration SQL first', sql_needed: true });
      }
      res.status(500).json({ error: 'Send message failed', message: safeErr(err) });
    }
  }
);

// ─── GET /chits/:chit_id/messages ────────────────────────────
// thread_type query: 'all' | 'external' | 'internal'
router.get('/:chit_id/messages', auth, async (req, res) => {
  const { chit_id }   = req.params;
  const entity_id     = req.identity.parent_entity_id || req.identity.identity_id;
  const thread_filter = req.query.thread_type || 'all';

  try {
    // B1 RLS: participant access check on own copy -> withEntity(me).
    const access = await withEntity(entity_id, (db) => db.query(
      `SELECT entity_id FROM chit_status WHERE chit_id = $1 AND entity_id = $2`,
      [chit_id, entity_id]
    ));
    if (access.rows.length === 0) return res.status(403).json({ error: 'Forbidden' });

    // Dispute messages are scoped to the dispute roster (targeted) or all participants (chit-wide) — a
    // non-party on the chit must NEVER see them. Non-dispute messages keep the external/internal rules.
    const disputeVis = `(m.is_dispute = true AND (
        EXISTS (SELECT 1 FROM chit_disputes cd WHERE cd.dispute_id = m.dispute_id AND cd.scope = 'chit_wide')
        OR EXISTS (SELECT 1 FROM dispute_participants dp WHERE dp.dispute_id = m.dispute_id AND dp.entity_id = $2)
      ))`;
    let vis;
    if (thread_filter === 'internal') {
      vis = `(COALESCE(m.is_dispute,false)=false AND m.thread_type='internal' AND m.visibility_entity_id=$2)`;
    } else if (thread_filter === 'external') {
      vis = `(COALESCE(m.is_dispute,false)=false AND m.thread_type='external') OR ${disputeVis}`;
    } else {
      vis = `(COALESCE(m.is_dispute,false)=false AND (m.thread_type='external' OR (m.thread_type='internal' AND m.visibility_entity_id=$2))) OR ${disputeVis}`;
    }
    let q = `SELECT m.* FROM chit_messages m WHERE m.chit_id = $1 AND (${vis})`;
    // D4: dispute-only view — filter the thread to dispute-tagged messages (works after a dispute closes).
    if (req.query.dispute === '1' || req.query.dispute === 'true') q += ` AND m.is_dispute = true`;
    q += ` ORDER BY m.created_at ASC`;
    const params = [chit_id, entity_id];

    const result = await query(q, params);
    // attach per-message files (bytes pulled on demand via GET /api/attachments/:id)
    const msgIds = result.rows.map(m => m.message_id).filter(Boolean);
    const atts = await storage.listForMessages(msgIds, entity_id).catch(() => []);   // per-entity: caller's own copies
    const byMsg = {};
    for (const a of atts) { (byMsg[a.message_id] = byMsg[a.message_id] || []).push(a); }
    for (const m of result.rows) { m.attachments = byMsg[m.message_id] || []; }
    res.json({ messages: result.rows, count: result.rows.length });
  } catch (err) {
    console.error('Get messages error:', err.message);
    if (err.message.includes('chit_messages')) return res.json({ messages: [], count: 0 });
    res.status(500).json({ error: 'Get messages failed', message: safeErr(err) });
  }
});

// ─── B3.10 — targeted + erasure-aware dispute helpers ────────
// integrity-critical categories whose audience the platform widens by obligation (opt-in via env)
const WIDEN_CATEGORIES = (process.env.CB_DISPUTE_WIDEN_CATEGORIES || '')
  .split(',').map(s => s.trim()).filter(Boolean);

async function probeParity(chit_id, target_entity_id, caller_entity_id) {
  if (!target_entity_id) return { parity_state: null, mode: 'two_sided', answerable: true, target_display_name: null };
  const idn = await query(`SELECT display_name, status, is_erased FROM identities WHERE identity_id=$1`, [target_entity_id]);
  if (idn.rows.length === 0) return { parity_state:'absent', mode:'one_sided', answerable:false, target_display_name:'[unknown]' };
  const t = idn.rows[0];
  if (t.is_erased)            return { parity_state:'erased', mode:'one_sided', answerable:false, target_display_name:'[erased]' };
  if (t.status !== 'active')  return { parity_state:'defunct', mode:'one_sided', answerable:false, target_display_name:t.display_name };
  // Cross-entity read of the counterparty's copy -> b52 chit_participant_parity (validated participant);
  // fallback to the legacy direct read pre-b52. Same row-presence semantics either way.
  const cs = await crossing(caller_entity_id,
    `SELECT * FROM chit_participant_parity($1,$2)`, [chit_id, target_entity_id],
    (db) => db.query(`SELECT deleted_at FROM chit_status WHERE chit_id=$1 AND entity_id=$2`, [chit_id, target_entity_id]));
  if (cs.rows.length === 0)   return { parity_state:'absent', mode:'one_sided', answerable:false, target_display_name:t.display_name };
  if (cs.rows[0].deleted_at)  return { parity_state:'archived', mode:'two_sided', answerable:true, target_display_name:t.display_name };
  return { parity_state:'present', mode:'two_sided', answerable:true, target_display_name:t.display_name };
}

// ─── POST /chits/:chit_id/disputes ───────────────────────────
router.post('/:chit_id/disputes',
  [
    body('category').isIn(['quality','quantity','delivery','payment','docs','other']).withMessage('Invalid category'),
    body('reason').trim().isLength({ min: 10 }).withMessage('Reason must be at least 10 characters'),
    body('target_entity_id').optional({ nullable:true }).isUUID().withMessage('Bad target'),
    body('participant_entity_ids').optional().isArray().withMessage('participant_entity_ids must be an array'),
    body('chit_wide').optional().isBoolean(),
    body('via').optional().isIn(['chit','mailbox']),
  ],
  validate,
  auth,
  async (req, res) => {
    const { chit_id } = req.params;
    const { category, reason, target_entity_id = null, chit_wide = false, via = 'chit' } = req.body;
    const entity_id    = req.identity.parent_entity_id || req.identity.identity_id;
    const display_name = req.identity.display_name;
    try {
      // 1. raiser must be a participant
      const access = await withEntity(entity_id, (db) => db.query(`SELECT current_status FROM chit_status WHERE chit_id=$1 AND entity_id=$2`, [chit_id, entity_id]));
      if (access.rows.length === 0) return res.status(403).json({ error:'Not a participant' });

      // C2 (Athi): raising on an already-CLOSED chit is allowed but flagged with a warning (bring back to Act if needed).
      const _cs = access.rows[0].current_status;
      const closedWarning = (_cs === 'completed' || _cs === 'cancelled')
        ? `This chit is already ${_cs} — the dispute is raised anyway. Bring it back to Act if it needs work.`
        : null;
      // B3 (Athi): dispute records + messages carry the ENTITY's name; the acting actor stays as provenance in the timeline.
      let entityName = display_name;
      if (req.identity.parent_entity_id) {
        const _e = await query('SELECT display_name FROM identities WHERE identity_id = $1', [entity_id]).catch(() => ({ rows: [] }));
        if (_e.rows[0] && _e.rows[0].display_name) entityName = _e.rows[0].display_name;
      }

      // 2. can't target yourself
      if (target_entity_id && target_entity_id === entity_id)
        return res.status(400).json({ error:'Invalid target', message:'You cannot raise a dispute against yourself' });

      // 3. decide scope + probe parity → mode
      // D4: an explicit party checklist means a TARGETED dispute (only those parties see it), even when no
      // single target_entity_id is given. Only fall through to chit_wide when NO parties were selected.
      const selParties = Array.isArray(req.body.participant_entity_ids)
        ? req.body.participant_entity_ids.filter(x => x && x !== entity_id) : [];
      let scope = chit_wide ? 'chit_wide' : ((target_entity_id || selParties.length) ? 'targeted' : 'chit_wide');
      const parity = await probeParity(chit_id, scope === 'targeted' ? (target_entity_id || null) : null, entity_id);

      // 4. platform widen by obligation
      let widened = false;
      if (scope === 'targeted' && WIDEN_CATEGORIES.includes(category)) { scope = 'chit_wide'; widened = true; }

      // 5. duplicate guard (raiser + category + same target + open)
      const dup = await query(
        `SELECT dispute_id FROM chit_disputes
          WHERE chit_id=$1 AND raised_by_entity_id=$2 AND status='open' AND category=$3
            AND COALESCE(target_entity_id::text,'') = COALESCE($4::text,'')`,
        [chit_id, entity_id, category, scope === 'targeted' ? target_entity_id : null]);
      if (dup.rows.length) return res.status(400).json({ error:'Dispute exists', message:`You already have an open ${category} dispute here` });

      // 5b. D4 — resolve the involved parties (multi-select checklist). Falls back to the single
      //     target for back-compat. Raiser + parties form the roster; each party carries its own status.
      const partyIds = selParties.length
        ? [...new Set(selParties)]
        : (scope === 'targeted' && target_entity_id ? [target_entity_id] : []);
      let partyNames = {};
      if (partyIds.length) {
        const nm = await query(`SELECT identity_id, display_name FROM identities WHERE identity_id = ANY($1::uuid[])`, [partyIds]);
        nm.rows.forEach(r => { partyNames[r.identity_id] = r.display_name; });
      }

      // 6. evidence snapshot — "forward your chit" (survives counterparty erasure)
      const snap = await withEntity(entity_id, (db) => db.query(
        `SELECT ch.auto_subject, ch.summary_json, cs.current_status AS my_status
           FROM chit_header ch JOIN chit_status cs ON cs.chit_id=ch.chit_id AND cs.entity_id=$2
          WHERE ch.chit_id=$1`, [chit_id, entity_id]));
      const evidence = { ...(snap.rows[0] || {}), captured_at: new Date().toISOString(), via };

      // 7 + 8. insert dispute + timeline atomically (INV-2). chit_disputes/dispute_participants are not RLS-scoped
      // and the raiser's OWN state_log is entity_id=caller, so all run in withEntity(me); the per-party notices are
      // a CROSS write into each party's own state_log -> chit_log_targets (validated participant), legacy loop pre-b50.
      const ready = await definersReady();
      const d = await withEntity(entity_id, async (client) => {
        const result = await client.query(
          `INSERT INTO chit_disputes
             (chit_id, raised_by_entity_id, raised_by_display_name, target_entity_id, target_display_name,
              scope, mode, answerable, parity_state, via, category, reason, evidence_snapshot, status, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'open',NOW())
           RETURNING *`,
          [chit_id, entity_id, entityName,
           scope === 'targeted' ? target_entity_id : null,
           scope === 'targeted' ? parity.target_display_name : null,
           scope, parity.mode, parity.answerable, parity.parity_state, via,
           category, reason, JSON.stringify(evidence)]
        );
        await client.query(
          `INSERT INTO state_log (chit_id, entity_id, action, action_by_identity_id, action_by_display_name, detail)
           VALUES ($1,$2,'dispute_raised',$3,$4,$5)`,
          [chit_id, entity_id, entity_id, display_name,
           `Dispute raised — ${category} (${parity.mode === 'one_sided' ? 'record-only' : scope}): ${reason.slice(0,80)}`]
        );
        // D4 — involved-parties roster + per-party status. Raiser is always a participant; each selected
        // party is added and NOTIFIED on their own copy (derived-notifications feed). Dispute status is
        // set only for the involved participants, never chit-wide unless the scope says so.
        const did = result.rows[0].dispute_id;
        await client.query(
          `INSERT INTO dispute_participants (dispute_id, chit_id, entity_id, display_name, role, dispute_status)
           VALUES ($1,$2,$3,$4,'raiser','open') ON CONFLICT (dispute_id, entity_id) DO NOTHING`,
          [did, chit_id, entity_id, display_name]);
        for (const pid of partyIds) {
          await client.query(
            `INSERT INTO dispute_participants (dispute_id, chit_id, entity_id, display_name, role, dispute_status)
             VALUES ($1,$2,$3,$4,'party','open') ON CONFLICT (dispute_id, entity_id) DO NOTHING`,
            [did, chit_id, pid, partyNames[pid] || null]);
        }
        // Per-party timeline notices — CROSS write into each party's own state_log copy.
        if (partyIds.length) {
          const notice = `Dispute raised against you — ${category}: ${reason.slice(0,80)}`;
          if (ready) {
            await client.query(`SELECT chit_log_targets($1,$2,$3,$4,$5,$6)`,
              [chit_id, partyIds, 'dispute_raised', entity_id, display_name, notice]);
          } else {
            for (const pid of partyIds) {
              await client.query(
                `INSERT INTO state_log (chit_id, entity_id, action, action_by_identity_id, action_by_display_name, detail)
                 VALUES ($1,$2,'dispute_raised',$3,$4,$5)`,
                [chit_id, pid, entity_id, display_name, notice]);
            }
          }
        }
        // NOTE: chit-wide participants see the raise via the scoped chit_message below (Messages panel). A
        // chit-wide Status-LOG fan-out would need the chit_log_all definer (a direct chit_status read here is
        // RLS-scoped to the raiser and writes cross-entity are rejected) — deferred to the dispute backlog.
        // D4 — the dispute REASON as a scoped chit_message so it appears in the Messages panel (not just the
        // Status log). ONE row; GET /messages scopes visibility to the roster (targeted) or all (chit-wide),
        // so a non-party on the chit never sees it. chit_messages is not RLS-scoped.
        await client.query(
          `INSERT INTO chit_messages
             (chit_id, sender_entity_id, sender_display_name, thread_type, visibility_entity_id, message_text, is_dispute, dispute_id, created_at)
           VALUES ($1,$2,$3,'external',NULL,$4,true,$5,NOW())`,
          [chit_id, entity_id, entityName, `[${category}] ${reason}`, did]);
        return result.rows[0];
      });
      res.json({
        dispute_id: d.dispute_id, category, reason, status:'open',
        warning: closedWarning,   // C2: set when raised on an already-closed chit
        scope, mode: d.mode, answerable: d.answerable, parity_state: d.parity_state,
        target_display_name: d.target_display_name,
        raised_by_display_name: entityName,
        alert: d.mode === 'one_sided'
          ? `The other side is no longer reachable (${d.parity_state}). This is lodged as a unilateral record on your own copy.`
          : (widened ? 'This category notifies all parties — raised chit-wide.' : 'Dispute raised with the selected party.'),
        message: 'Dispute raised',
      });
    } catch (err) {
      console.error('Raise dispute error:', err.message);
      if (err.message.includes('chit_disputes')) return res.status(500).json({ error:'Table not found', message:'Run B3.5 + B3.10 migrations', sql_needed:true });
      res.status(500).json({ error:'Raise dispute failed', message: safeErr(err) });
    }
  });

// ─── GET /chits/:chit_id/disputes ────────────────────────────
// All participants see all disputes on a chit
router.get('/:chit_id/disputes', auth, async (req, res) => {
  const { chit_id } = req.params;
  const entity_id   = req.identity.parent_entity_id || req.identity.identity_id;

  try {
    // B1 RLS: participant access check on own copy -> withEntity(me).
    const access = await withEntity(entity_id, (db) => db.query(
      `SELECT entity_id FROM chit_status WHERE chit_id = $1 AND entity_id = $2`,
      [chit_id, entity_id]
    ));
    if (access.rows.length === 0) return res.status(403).json({ error: 'Forbidden' });

    // B3.10 + D4 — scoped: you see chit-wide disputes, ones you raised/target, or ones you're a listed party to
    const result = await query(
      `SELECT * FROM chit_disputes cd
         WHERE cd.chit_id = $1 AND (cd.scope='chit_wide' OR cd.raised_by_entity_id=$2 OR cd.target_entity_id=$2
                OR EXISTS (SELECT 1 FROM dispute_participants dp WHERE dp.dispute_id = cd.dispute_id AND dp.entity_id = $2))
         ORDER BY cd.created_at ASC`,
      [chit_id, entity_id]
    );
    // D4 — attach the involved-parties roster (best-effort; empty on a pre-migration DB)
    let partsByD = {};
    try {
      const pr = await query(`SELECT dispute_id, entity_id, display_name, role, dispute_status FROM dispute_participants WHERE chit_id = $1`, [chit_id]);
      pr.rows.forEach(r => { (partsByD[r.dispute_id] = partsByD[r.dispute_id] || []).push(r); });
    } catch (_) {}
    // evidence_snapshot is PII — expose presence only, never its contents
    const disputes = result.rows.map(({ evidence_snapshot, ...d }) => ({ ...d, has_evidence: evidence_snapshot != null, participants: partsByD[d.dispute_id] || [] }));
    res.json({ disputes, open_count: disputes.filter(d => d.status === 'open').length });
  } catch (err) {
    if (err.message.includes('chit_disputes') || err.message.includes('dispute_participants')) return res.json({ disputes: [], open_count: 0 });
    res.status(500).json({ error: 'Get disputes failed', message: safeErr(err) });
  }
});

// ─── GET /chits/:chit_id/diagnosis ───────────────────────────
// DEMO-5: read-only diagnosis over B3.10 disputes. One card per dispute the
// viewer is party to. probe (fault) → localise (coordinate) → route (routing) + proof.
// Never writes anything; never returns evidence_snapshot contents.
const FAULT_SUMMARY = {
  present:  'Both sides present — workable',
  archived: 'Counterparty archived their copy — still workable',
  erased:   'Counterparty erased — no live other side',
  defunct:  'Counterparty no longer active',
  absent:   'No counterparty copy found on this chit',
};
router.get('/:chit_id/diagnosis', auth, async (req, res) => {
  const { chit_id } = req.params;
  const entity_id   = req.identity.parent_entity_id || req.identity.identity_id;
  try {
    // B1 RLS: own-copy reads (status/header/detail) -> withEntity(me).
    const rls = await withEntity(entity_id, async (db) => {
      const access = await db.query(`SELECT 1 FROM chit_status WHERE chit_id=$1 AND entity_id=$2`, [chit_id, entity_id]);
      if (access.rows.length === 0) return null;
      const hdr = await db.query(
        `SELECT auto_subject, schema_version FROM chit_header WHERE chit_id=$1 AND entity_id=$2`,
        [chit_id, entity_id]);
      const det = await db.query(
        `SELECT line_items FROM chit_detail WHERE chit_id=$1 AND entity_id=$2`,
        [chit_id, entity_id]);
      return { hdr, det };
    });
    if (!rls) return res.status(403).json({ error: 'Forbidden' });
    const { hdr, det } = rls;
    let itemLabel = null;
    try {
      const raw = det.rows[0]?.line_items;
      const li = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : [];
      if (Array.isArray(li) && li.length) {
        itemLabel = li.map(i => i.particulars || i.product).filter(Boolean).join(', ') || null;
      }
    } catch { itemLabel = null; }

    // same audience rule as GET disputes — never leak someone else's dispute
    const d = await query(
      `SELECT dispute_id, category, reason, status, created_at,
              target_display_name, scope, mode, answerable, parity_state, via,
              (evidence_snapshot IS NOT NULL) AS has_evidence
         FROM chit_disputes
        WHERE chit_id=$1 AND (scope='chit_wide' OR raised_by_entity_id=$2 OR target_entity_id=$2)
        ORDER BY created_at ASC`,
      [chit_id, entity_id]);

    const diagnoses = d.rows.map(x => ({
      dispute_id: x.dispute_id,
      category:   x.category,
      reason:     x.reason,
      status:     x.status,
      created_at: x.created_at,
      resolvable: x.mode === 'two_sided',
      // probe → the fault
      fault: {
        state:    x.parity_state || 'present',
        category: x.category,
        summary:  FAULT_SUMMARY[x.parity_state] || FAULT_SUMMARY.present,
      },
      // localise → the coordinate (who / what / which version)
      coordinate: {
        party:          x.target_display_name || 'all parties',
        line_item:      itemLabel,
        schema_version: hdr.rows[0]?.schema_version ?? null,
      },
      // route → how it is handled
      routing: { scope: x.scope, mode: x.mode, answerable: x.answerable },
      // proof → presence only + provenance (never the contents)
      proof: { evidence_captured: x.has_evidence, arose_from: x.via },
    }));

    res.json({ chit_id, chit_subject: hdr.rows[0]?.auto_subject || null, diagnoses, count: diagnoses.length });
  } catch (err) {
    if (err.message.includes('chit_disputes')) return res.json({ chit_id, chit_subject: null, diagnoses: [], count: 0 });
    console.error('Diagnosis error:', err.message);
    res.status(500).json({ error: 'Diagnosis failed', message: safeErr(err) });
  }
});

// ─── PUT /chits/:chit_id/disputes/:dispute_id/resolve ────────
// Only the entity that raised the dispute can resolve it
router.put('/:chit_id/disputes/:dispute_id/resolve',
  [ body('resolution_note').trim().notEmpty().withMessage('Resolution note required'),
    body('target_entity_id').optional({ nullable:true }).isUUID() ],
  validate,
  auth,
  async (req, res) => {
    const { chit_id, dispute_id } = req.params;
    const { resolution_note }     = req.body;
    const targetParty  = req.body.target_entity_id || null;   // per-party resolve; null = clear all remaining
    const entity_id    = req.identity.parent_entity_id || req.identity.identity_id;
    const display_name = req.identity.display_name;
    // B3: the resolution message posts in the ENTITY name (the acting actor stays as provenance in the timeline).
    let entityName = display_name;
    if (req.identity.parent_entity_id) { const _e = await query('SELECT display_name FROM identities WHERE identity_id = $1', [entity_id]).catch(() => ({ rows: [] })); if (_e.rows[0] && _e.rows[0].display_name) entityName = _e.rows[0].display_name; }

    try {
      const dispute = await query(
        `SELECT * FROM chit_disputes WHERE dispute_id = $1 AND chit_id = $2`,
        [dispute_id, chit_id]
      );
      if (dispute.rows.length === 0) return res.status(404).json({ error: 'Dispute not found' });

      const d = dispute.rows[0];
      if (d.status !== 'open') return res.status(400).json({ error: 'Dispute already resolved' });
      if (d.raised_by_entity_id !== entity_id) {
        return res.status(403).json({ error: 'Forbidden', message: 'Only the entity that raised the dispute can resolve it' });
      }

      // chit_disputes/dispute_participants are not RLS-scoped and the resolver's own state_log is entity_id=caller,
      // so all run in withEntity(me); the per-party notices are a CROSS write -> chit_log_targets, legacy loop pre-b50.
      // D4 — PER-PARTY resolution: the raiser clears one party at a time; the dispute closes chit-wide only when
      // NO party is still open. chit_disputes/dispute_participants aren't RLS-scoped; the resolver's own state_log
      // is entity_id=caller, so all run in withEntity(me). Per-party notices cross -> chit_log_targets (legacy loop pre-b50).
      const ready = await definersReady();
      const out = await withEntity(entity_id, async (client) => {
        let resolvedPartyIds;
        if (targetParty) {
          await client.query(`UPDATE dispute_participants SET dispute_status='resolved' WHERE dispute_id=$1 AND entity_id=$2 AND role='party'`, [dispute_id, targetParty]);
          resolvedPartyIds = [targetParty];
        } else {
          const all = await client.query(`SELECT entity_id FROM dispute_participants WHERE dispute_id=$1 AND role='party' AND dispute_status='open'`, [dispute_id]);
          resolvedPartyIds = all.rows.map(r => r.entity_id);
          await client.query(`UPDATE dispute_participants SET dispute_status='resolved' WHERE dispute_id=$1 AND role='party'`, [dispute_id]);
        }
        // chit-wide close only when every party is resolved (no 'party' row left open)
        const remaining = await client.query(`SELECT COUNT(*)::int AS n FROM dispute_participants WHERE dispute_id=$1 AND role='party' AND dispute_status='open'`, [dispute_id]);
        const allResolved = remaining.rows[0].n === 0;
        if (allResolved) {
          await client.query(
            `UPDATE chit_disputes SET status='resolved', resolution_note=$1, resolved_by_entity_id=$2, resolved_at=NOW() WHERE dispute_id=$3`,
            [resolution_note, entity_id, dispute_id]);
          await client.query(`UPDATE dispute_participants SET dispute_status='resolved' WHERE dispute_id=$1`, [dispute_id]); // raiser too
        }
        // resolver's own timeline
        await client.query(
          `INSERT INTO state_log (chit_id, entity_id, action, action_by_identity_id, action_by_display_name, detail)
           VALUES ($1,$2,'dispute_resolved',$3,$4,$5)`,
          [chit_id, entity_id, entity_id, display_name, `Dispute resolved — ${d.category}: ${resolution_note.slice(0,100)}`]);
        // resolution note as a scoped dispute message (roster / chit-wide only — never a non-party)
        await client.query(
          `INSERT INTO chit_messages (chit_id, sender_entity_id, sender_display_name, thread_type, visibility_entity_id, message_text, is_dispute, dispute_id, created_at)
           VALUES ($1,$2,$3,'external',NULL,$4,true,$5,NOW())`,
          [chit_id, entity_id, entityName, `[resolved] ${resolution_note}`, dispute_id]);
        // notify the cleared parties on their own timeline
        if (resolvedPartyIds.length) {
          const notice = `Dispute resolved — ${d.category}: ${resolution_note.slice(0,100)}`;
          if (ready) {
            await client.query(`SELECT chit_log_targets($1,$2,$3,$4,$5,$6)`, [chit_id, resolvedPartyIds, 'dispute_resolved', entity_id, display_name, notice]);
          } else {
            for (const pid of resolvedPartyIds) {
              await client.query(
                `INSERT INTO state_log (chit_id, entity_id, action, action_by_identity_id, action_by_display_name, detail)
                 VALUES ($1,$2,'dispute_resolved',$3,$4,$5)`,
                [chit_id, pid, entity_id, display_name, notice]);
            }
          }
        }
        return { allResolved, resolvedPartyIds };
      });

      res.json({
        dispute_id,
        status: out.allResolved ? 'resolved' : 'open',
        resolved_parties: out.resolvedPartyIds,
        fully_resolved: out.allResolved,
        resolution_note, resolved_by: display_name,
        message: out.allResolved ? 'Dispute fully resolved' : 'Party resolved — still open for the others'
      });
    } catch (err) {
      console.error('Resolve dispute error:', err.message);
      res.status(500).json({ error: 'Resolve failed', message: safeErr(err) });
    }
  }
);

// ─── GET /chits/disputes/queue ────────────────────────────────
// All open disputes across all chits for this entity — used by DisputesPage sidebar
// Safe: /disputes/queue has 2 segments; /:chit_id matches 1 segment only — no conflict
router.get('/disputes/queue', auth, async (req, res) => {
  const entity_id = req.identity.parent_entity_id || req.identity.identity_id;

  try {
    // B1 RLS: own-copy subselects (chit_header/chit_status) -> withEntity(me).
    const result = await withEntity(entity_id, (db) => db.query(
      `SELECT cd.*,
              (SELECT ch.auto_subject FROM chit_header ch WHERE ch.chit_id=cd.chit_id AND ch.entity_id=$1 LIMIT 1) AS auto_subject,
              (SELECT ch.purpose      FROM chit_header ch WHERE ch.chit_id=cd.chit_id AND ch.entity_id=$1 LIMIT 1) AS purpose,
              (SELECT se.display_name FROM chit_header ch LEFT JOIN identities se ON se.identity_id=ch.sender_entity_id
                WHERE ch.chit_id=cd.chit_id AND ch.entity_id=$1 LIMIT 1) AS sender_display_name
       FROM chit_disputes cd
       WHERE cd.status = 'open'
         AND EXISTS (SELECT 1 FROM chit_status cs WHERE cs.chit_id=cd.chit_id AND cs.entity_id=$1)
         AND (cd.scope='chit_wide' OR cd.raised_by_entity_id = $1 OR cd.target_entity_id = $1
              OR EXISTS (SELECT 1 FROM dispute_participants dp WHERE dp.dispute_id = cd.dispute_id AND dp.entity_id = $1))
       ORDER BY cd.created_at ASC`,
      [entity_id]
    ));

    // evidence_snapshot is PII — expose presence only, never its contents
    const rows = result.rows.map(({ evidence_snapshot, ...d }) => ({ ...d, has_evidence: evidence_snapshot != null }));
    // attach the per-party roster (status per party) so the raiser can resolve each party independently
    const dids = rows.map(d => d.dispute_id);
    if (dids.length) {
      const pr = await query(`SELECT dispute_id, entity_id, display_name, role, dispute_status FROM dispute_participants WHERE dispute_id = ANY($1::uuid[])`, [dids]);
      const byD = {}; pr.rows.forEach(r => { (byD[r.dispute_id] = byD[r.dispute_id] || []).push(r); });
      rows.forEach(d => { d.participants = byD[d.dispute_id] || []; });
    }
    // "other" now means disputes targeting me (untargeted ones no longer leak)
    const myDisputes    = rows.filter(d => d.raised_by_entity_id === entity_id);
    const otherDisputes = rows.filter(d => d.raised_by_entity_id !== entity_id);

    res.json({
      disputes:       rows,
      my_disputes:    myDisputes,
      other_disputes: otherDisputes,
      total_open:     rows.length,
    });
  } catch (err) {
    if (err.message.includes('chit_disputes')) {
      return res.json({ disputes: [], my_disputes: [], other_disputes: [], total_open: 0 });
    }
    res.status(500).json({ error: 'Get dispute queue failed', message: safeErr(err) });
  }
});

// ─── DELETE /chits/:chit_id ──────────────────────────────────
// Soft delete (per-entity) — sets chit_status.deleted_at for the
// requesting entity only; the other party's copy is untouched.
// Blocked (409) while an OPEN dispute exists on the chit.
router.delete('/:chit_id', auth, async (req, res) => {
  try {
    const chit_id        = req.params.chit_id;
    const entity_id      = req.identity.parent_entity_id || req.identity.identity_id;
    const action_by_id   = req.identity.identity_id;
    const action_by_name = req.identity.display_name;

    // B1 RLS: caller deletes only its own copy -> withEntity(me).
    await withEntity(entity_id, async (db) => {
    // Verify this entity has a (non-deleted) copy of the chit
    const current = await db.query(
      `SELECT current_status FROM chit_status
       WHERE chit_id = $1 AND entity_id = $2 AND deleted_at IS NULL`,
      [chit_id, entity_id]
    );

    if (current.rows.length === 0) {
      return res.status(404).json({
        error: 'Not found',
        message: 'Chit not found or already deleted'
      });
    }

    // Guard: cannot delete while an open dispute is registered
    const openDisputes = await db.query(
      `SELECT COUNT(*)::int AS count FROM chit_disputes
       WHERE chit_id = $1 AND status = 'open'`,
      [chit_id]
    );

    if (openDisputes.rows[0].count > 0) {
      return res.status(409).json({
        error: 'Dispute active',
        message: 'Cannot delete a chit with an open dispute. Resolve the dispute first.'
      });
    }

    // Soft delete this entity's copy only
    await db.query(
      `UPDATE chit_status
       SET deleted_at = NOW(), updated_at = NOW()
       WHERE chit_id = $1 AND entity_id = $2`,
      [chit_id, entity_id]
    );

    // Audit trail — one row for this entity's copy
    await db.query(
      `INSERT INTO state_log
       (chit_id, entity_id, action, action_by_identity_id,
        action_by_display_name, previous_status, new_status, detail)
       VALUES ($1, $2, 'deleted', $3, $4, $5, $5, $6)`,
      [chit_id, entity_id, action_by_id, action_by_name,
       current.rows[0].current_status,
       `Chit deleted by ${action_by_name}`]
    );

    res.json({ message: 'Chit deleted', chit_id });
    });

  } catch (err) {
    console.error('Delete chit error:', err.message);
    res.status(500).json({ error: 'Delete failed', message: safeErr(err) });
  }
});

// ─────────────────────────────────────────────────────────────
// Slice 2 — fp01 priority endpoints (internal queue + customer cross-edge)
// ─────────────────────────────────────────────────────────────

// PUT /chits/:chit_id/priority — INTERNAL queue priority. Never crosses the edge.
// urgent requires a reason, logged as an internal action message.
router.put('/:chit_id/priority',
  [
    body('priority').trim().isIn(['normal','high','urgent']).withMessage('priority must be normal|high|urgent'),
    body('reason').optional().trim().isLength({ max: 500 }),
  ],
  validate,
  auth,
  async (req, res) => {
    try {
      const chit_id   = req.params.chit_id;
      const entity_id = req.identity.parent_entity_id || req.identity.identity_id;
      const priority  = req.body.priority;
      const reason    = sanitise(req.body.reason || '');

      if (priority === 'urgent' && !reason) {
        return res.status(400).json({ error: 'Reason required', message: 'An urgent priority needs a reason' });
      }

      // B1 RLS: caller sets priority on its own copy -> withEntity(me).
      await withEntity(entity_id, async (db) => {
      const access = await db.query(
        `SELECT current_status FROM chit_status WHERE chit_id = $1 AND entity_id = $2`,
        [chit_id, entity_id]
      );
      if (access.rows.length === 0) {
        return res.status(404).json({ error: 'Not found', message: 'Chit not found for this entity' });
      }

      await db.query(
        `UPDATE chit_status SET priority_flag = $1, updated_at = NOW()
         WHERE chit_id = $2 AND entity_id = $3`,
        [priority, chit_id, entity_id]
      );

      // urgent → record an internal action message (only this entity's internal thread)
      if (priority === 'urgent') {
        await db.query(
          `INSERT INTO chit_messages
             (chit_id, sender_entity_id, sender_display_name,
              thread_type, visibility_entity_id, message_text, msg_type, created_at)
           VALUES ($1,$2,$3,'internal',$2,$4,'action',NOW())`,
          [chit_id, entity_id, req.identity.display_name, `Marked URGENT: ${reason}`]
        );
      }

      res.json({ message: 'Priority updated', chit_id, priority_flag: priority });
      });
    } catch (err) {
      console.error('Set priority error:', err.message);
      res.status(500).json({ error: 'Priority update failed', message: safeErr(err) });
    }
  }
);

// PUT /chits/:chit_id/priority-flag — CUSTOMER cross-edge priority, WRITE-ONCE.
// DESIGN (review): set + lock on EVERY participant row so the counterparty sees it;
// reject once customer_priority_locked is true.
router.put('/:chit_id/priority-flag',
  [ body('priority').isBoolean().withMessage('priority must be true or false') ],
  validate,
  auth,
  async (req, res) => {
    try {
      const chit_id   = req.params.chit_id;
      const entity_id = req.identity.parent_entity_id || req.identity.identity_id;
      const flag      = req.body.priority === true || req.body.priority === 'true';

      // B1 RLS: write-once lock check on own copy -> withEntity(me).
      const access = await withEntity(entity_id, (db) => db.query(
        `SELECT customer_priority_locked FROM chit_status WHERE chit_id = $1 AND entity_id = $2`,
        [chit_id, entity_id]
      ));
      if (access.rows.length === 0) {
        return res.status(404).json({ error: 'Not found', message: 'Chit not found for this entity' });
      }
      if (access.rows[0].customer_priority_locked) {
        return res.status(409).json({ error: 'Locked', message: 'Customer priority is write-once and already set' });
      }

      // Customer flag is cross-edge (write-once) -> set on ALL participant rows via chit_set_customer_priority_all
      // (validated: caller must be a participant). Fallback = the legacy all-rows update when b50 isn't applied.
      await crossing(entity_id,
        `SELECT chit_set_customer_priority_all($1,$2)`,
        [chit_id, flag],
        (db) => db.query(
          `UPDATE chit_status SET customer_priority = $1, customer_priority_locked = true, updated_at = NOW()
           WHERE chit_id = $2`,
          [flag, chit_id]));

      // Trail parity with internal urgent: log who/when as an action message.
      // External thread (visibility NULL) — the customer flag is cross-edge, so both parties see the trail.
      await query(
        `INSERT INTO chit_messages
           (chit_id, sender_entity_id, sender_display_name,
            thread_type, visibility_entity_id, message_text, msg_type, created_at)
         VALUES ($1,$2,$3,'external',NULL,$4,'action',NOW())`,
        [chit_id, entity_id, req.identity.display_name,
         flag ? 'Customer marked this chit as priority' : 'Customer cleared priority']
      );

      res.json({ message: 'Customer priority set', chit_id, customer_priority: flag, locked: true });
    } catch (err) {
      console.error('Customer flag error:', err.message);
      res.status(500).json({ error: 'Customer flag failed', message: safeErr(err) });
    }
  }
);

// ─────────────────────────────────────────────────────────────
// feat/chit-actions — archive (reversible), void (terminal), assign-bulk
// ─────────────────────────────────────────────────────────────

// POST /chits/:chit_id/archive — hide MY copy from inbox/sent (reversible; never deletes).
router.post('/:chit_id/archive', auth, async (req, res) => {
  try {
    const entity_id = req.identity.parent_entity_id || req.identity.identity_id;
    // D4 guard: a chit with an OPEN dispute can't be archived (parity with the delete guard) — resolve first.
    const openD = await query(`SELECT COUNT(*)::int AS count FROM chit_disputes WHERE chit_id = $1 AND status = 'open'`,
      [req.params.chit_id]).catch(() => ({ rows: [{ count: 0 }] }));
    if (openD.rows[0].count > 0) return res.status(409).json({ error: 'Dispute active', message: 'Cannot archive a chit with an open dispute. Resolve the dispute first.' });
    // B1 RLS: caller archives only its own copy -> withEntity(me).
    const r = await withEntity(entity_id, (db) => db.query(
      `UPDATE chit_status SET archived_at = NOW(), updated_at = NOW()
        WHERE chit_id = $1 AND entity_id = $2 AND deleted_at IS NULL AND archived_at IS NULL
        RETURNING chit_id`,
      [req.params.chit_id, entity_id]));
    if (r.rows.length === 0) return res.status(404).json({ error: 'Not found', message: 'Chit not found or already archived' });
    res.json({ message: 'Chit archived', chit_id: req.params.chit_id });
  } catch (err) { res.status(500).json({ error: 'Archive failed', message: safeErr(err) }); }
});

// PUT /chits/:chit_id/star — toggle the star/flag on MY copies (kept in sync across both directions).
router.put('/:chit_id/star', auth, async (req, res) => {
  try {
    const entity_id = req.identity.parent_entity_id || req.identity.identity_id;
    // B1 RLS: caller acts only on its own copy -> withEntity(me).
    await withEntity(entity_id, async (db) => {
    const cur = await db.query(`SELECT star_flag FROM chit_status WHERE chit_id = $1 AND entity_id = $2 LIMIT 1`,
      [req.params.chit_id, entity_id]);
    if (cur.rows.length === 0) return res.status(404).json({ error: 'Not found', message: 'Chit not found' });
    const next = !cur.rows[0].star_flag;
    await db.query(`UPDATE chit_status SET star_flag = $3, updated_at = NOW() WHERE chit_id = $1 AND entity_id = $2`,
      [req.params.chit_id, entity_id, next]);
    res.json({ message: 'Star toggled', chit_id: req.params.chit_id, star_flag: next });
    });
  } catch (err) { res.status(500).json({ error: 'Star failed', message: safeErr(err) }); }
});

// POST /chits/:chit_id/unread — mark MY copy unread (clear read_at).
router.post('/:chit_id/unread', auth, async (req, res) => {
  try {
    const entity_id = req.identity.parent_entity_id || req.identity.identity_id;
    // B1 RLS: caller acts only on its own copy -> withEntity(me).
    const r = await withEntity(entity_id, (db) => db.query(`UPDATE chit_status SET read_at = NULL, updated_at = NOW() WHERE chit_id = $1 AND entity_id = $2 RETURNING chit_id`,
      [req.params.chit_id, entity_id]));
    if (r.rows.length === 0) return res.status(404).json({ error: 'Not found', message: 'Chit not found' });
    res.json({ message: 'Marked unread', chit_id: req.params.chit_id });
  } catch (err) { res.status(500).json({ error: 'Mark-unread failed', message: safeErr(err) }); }
});

// POST /chits/:chit_id/unarchive — restore MY copy to inbox/sent.
router.post('/:chit_id/unarchive', auth, async (req, res) => {
  try {
    const entity_id = req.identity.parent_entity_id || req.identity.identity_id;
    // B1 RLS: caller acts only on its own copy -> withEntity(me).
    const r = await withEntity(entity_id, (db) => db.query(
      `UPDATE chit_status SET archived_at = NULL, updated_at = NOW()
        WHERE chit_id = $1 AND entity_id = $2 AND archived_at IS NOT NULL
        RETURNING chit_id`,
      [req.params.chit_id, entity_id]));
    if (r.rows.length === 0) return res.status(404).json({ error: 'Not found', message: 'Chit not found or not archived' });
    res.json({ message: 'Chit restored', chit_id: req.params.chit_id });
  } catch (err) { res.status(500).json({ error: 'Unarchive failed', message: safeErr(err) }); }
});

// POST /chits/:chit_id/restore — bring MY copy back from Trash (undo a soft delete).
// Mirrors DELETE /:chit_id (which sets deleted_at); clears deleted_at on this entity's copy only + logs it.
router.post('/:chit_id/restore', auth, async (req, res) => {
  try {
    const chit_id        = req.params.chit_id;
    const entity_id      = req.identity.parent_entity_id || req.identity.identity_id;
    const action_by_id   = req.identity.identity_id;
    const action_by_name = req.identity.display_name;
    // B1 RLS: caller restores only its own copy -> withEntity(me).
    await withEntity(entity_id, async (db) => {
    const r = await db.query(
      `UPDATE chit_status SET deleted_at = NULL, updated_at = NOW()
        WHERE chit_id = $1 AND entity_id = $2 AND deleted_at IS NOT NULL
        RETURNING chit_id`,
      [chit_id, entity_id]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'Not found', message: 'Chit not found in Trash' });
    await db.query(
      `INSERT INTO state_log (chit_id, entity_id, action, action_by_identity_id, action_by_display_name, detail)
       VALUES ($1, $2, 'restored', $3, $4, $5)`,
      [chit_id, entity_id, action_by_id, action_by_name, `Chit restored from Trash by ${action_by_name}`]);
    res.json({ message: 'Chit restored from Trash', chit_id });
    });
  } catch (err) { res.status(500).json({ error: 'Restore failed', message: safeErr(err) }); }
});

// DELETE /chits/:chit_id/purge — permanently remove a DRAFT (owner only). Real chits are immutable co-held
// records and can NEVER be hard-deleted here; only role='Draft' (un-bridged, sender-only) qualifies.
router.delete('/:chit_id/purge', auth, async (req, res) => {
  try {
    const chit_id   = req.params.chit_id;
    const entity_id = req.identity.parent_entity_id || req.identity.identity_id;
    // B1 RLS: caller purges only its own draft copy -> withEntity(me) (was withTransaction).
    await withEntity(entity_id, async (db) => {
      const chk = await db.query(`SELECT role, created_by_actor_id FROM chit_header WHERE chit_id = $1 AND entity_id = $2`, [chit_id, entity_id]);
      if (chk.rows.length === 0) return res.status(404).json({ error: 'Not found', message: 'Draft not found' });
      if (chk.rows[0].role !== 'Draft') return res.status(403).json({ error: 'Forbidden', message: 'Only drafts can be permanently deleted — sent chits are immutable co-held records.' });
      if (chk.rows[0].created_by_actor_id !== req.identity.identity_id) return res.status(403).json({ error: 'Forbidden', message: 'You can only delete drafts you created.' });
      await db.query(`DELETE FROM chit_messages WHERE chit_id = $1`, [chit_id]);
      await db.query(`DELETE FROM state_log  WHERE chit_id = $1 AND entity_id = $2`, [chit_id, entity_id]);
      await db.query(`DELETE FROM chit_detail WHERE chit_id = $1 AND entity_id = $2`, [chit_id, entity_id]);
      await db.query(`DELETE FROM chit_status WHERE chit_id = $1 AND entity_id = $2`, [chit_id, entity_id]);
      await db.query(`DELETE FROM chit_header WHERE chit_id = $1 AND entity_id = $2`, [chit_id, entity_id]);
      try { await db.query(`DELETE FROM cb_attachment WHERE chit_id = $1`, [chit_id]); } catch (e) { /* attachment table may not exist */ }
      res.json({ message: 'Draft permanently deleted', chit_id });
    });
  } catch (err) {
    console.error('Purge draft error:', err.message);
    res.status(500).json({ error: 'Purge failed', message: safeErr(err) });
  }
});

// PUT /chits/:chit_id/void — recorded hard-cancel by the SENDER; works after acceptance.
// Terminal 'void' status on ALL participant rows (cross-edge); reason required + logged;
// chit stays visible as voided, never deleted; the seal is untouched.
router.put('/:chit_id/void',
  [ body('reason').trim().notEmpty().withMessage('A reason is required to void') ],
  validate, auth,
  async (req, res) => {
    try {
      const chit_id   = req.params.chit_id;
      const entity_id = req.identity.parent_entity_id || req.identity.identity_id;
      const reason    = sanitise(req.body.reason);

      // B1 RLS: sender check on own copy -> withEntity(me).
      const own = await withEntity(entity_id, (db) => db.query(
        `SELECT sender_entity_id FROM chit_header WHERE chit_id = $1 AND entity_id = $2`,
        [chit_id, entity_id]));
      if (own.rows.length === 0) return res.status(404).json({ error: 'Not found', message: 'Chit not found' });
      if (own.rows[0].sender_entity_id !== entity_id) {
        return res.status(403).json({ error: 'Forbidden', message: 'Only the sender can void a chit' });
      }

      // Cross-edge terminal void on every participant row (never delete) -> chit_set_status_all
      // (validated: caller must be the sender). Fallback = the legacy all-rows update when b50 isn't applied.
      await crossing(entity_id,
        `SELECT chit_set_status_all($1,$2)`,
        [chit_id, 'void'],
        (db) => db.query(`UPDATE chit_status SET current_status = 'void', updated_at = NOW() WHERE chit_id = $1`, [chit_id]));
      // Record who/when/why as an external action message (both parties see it).
      await query(
        `INSERT INTO chit_messages
           (chit_id, sender_entity_id, sender_display_name,
            thread_type, visibility_entity_id, message_text, msg_type, created_at)
         VALUES ($1,$2,$3,'external',NULL,$4,'action',NOW())`,
        [chit_id, entity_id, req.identity.display_name, `Chit VOIDED: ${reason}`]);
      // State-log the void into every participant's timeline -> chit_log_all. Fallback = the legacy INSERT...SELECT.
      await crossing(entity_id,
        `SELECT chit_log_all($1,$2,$3,$4,$5,$6,$7)`,
        [chit_id, 'voided', req.identity.identity_id, req.identity.display_name, null, 'void', `Voided: ${reason}`],
        (db) => db.query(
          `INSERT INTO state_log (chit_id, entity_id, action, action_by_identity_id, action_by_display_name, new_status, detail)
           SELECT $1, entity_id, 'voided', $2, $3, 'void', $4 FROM chit_status WHERE chit_id = $1`,
          [chit_id, req.identity.identity_id, req.identity.display_name, `Voided: ${reason}`]));

      res.json({ message: 'Chit voided', chit_id, status: 'void' });
    } catch (err) {
      console.error('Void error:', err.message);
      res.status(500).json({ error: 'Void failed', message: safeErr(err) });
    }
  });

// POST /chits/assign-bulk — push-assign many chits to one actor (mirrors the single push).
router.post('/assign-bulk',
  [ body('chit_ids').isArray({ min: 1 }).withMessage('chit_ids[] required'),
    body('target_actor_id').isUUID().withMessage('target_actor_id required') ],
  validate, auth,
  async (req, res) => {
    try {
      const entity_id      = req.identity.parent_entity_id || req.identity.identity_id;
      const action_by_id   = req.identity.identity_id;
      const action_by_name = req.identity.display_name;
      const { chit_ids, target_actor_id } = req.body;
      if (chit_ids.length > 200) return res.status(400).json({ error: 'Too many', message: 'Assign at most 200 chits at once.' });   // F4: bound the batch (long tx / lock contention)

      // Atomic: the whole batch (counts + chit_status + state_log) commits together or rolls back —
      // a mid-loop failure no longer leaves a partial assign. Target validated inside the tx.
      // B1 RLS: bulk-assign writes only the assigning entity's own rows -> withEntity(me), not withTransaction.
      const out = await withEntity(entity_id, async (client) => {
        // (e) Assignment rule from settings: honour pull/push mode + per-actor capacity BEFORE assigning.
        const st = await client.query(`SELECT assignment_model, default_max_tasks FROM entity_actor_settings WHERE entity_id = $1`, [entity_id]);
        const model  = (st.rows[0] && st.rows[0].assignment_model) || 'both';
        const defMax = (st.rows[0] && st.rows[0].default_max_tasks) || 10;
        if (model === 'pull') { const e = new Error('Push-assign is off — this entity is in pull mode (co-assists take tasks themselves).'); e.status = 400; throw e; }

        const target = await client.query(
          `SELECT identity_id, display_name, max_tasks, current_task_count FROM identities
            WHERE identity_id = $1 AND parent_entity_id = $2 AND break_status = 'active'
              AND hat IN ('act','manager')`,
          [target_actor_id, entity_id]);
        if (target.rows.length === 0) { const e = new Error('Target co-assist not found, not on shift, or not an assignable hat (Act/Manager)'); e.status = 400; throw e; }
        const t = target.rows[0];
        const cap = t.max_tasks || defMax;
        let load = t.current_task_count || 0;

        const assigned = []; const skipped = [];
        for (const chit_id of chit_ids) {
          const cs = await client.query(
            `SELECT assigned_to_actor_id FROM chit_status WHERE chit_id = $1 AND entity_id = $2 AND deleted_at IS NULL`,
            [chit_id, entity_id]);
          if (cs.rows.length === 0) { skipped.push({ chit_id, reason: 'not found' }); continue; }
          const already = cs.rows[0].assigned_to_actor_id;
          if (already === t.identity_id) { assigned.push(chit_id); continue; }              // already theirs — no change, no cost
          if (load >= cap) { skipped.push({ chit_id, reason: `at capacity (${cap})` }); continue; }   // (e) capacity gate
          if (already) { await client.query(`UPDATE identities SET current_task_count = GREATEST(0, current_task_count - 1) WHERE identity_id = $1`, [already]); }
          await client.query(
            `UPDATE chit_status SET assigned_to_actor_id = $1, assigned_to_actor_display_name = $2,
                    assigned_at = NOW(), assignment_type = 'push', current_status = 'pending', updated_at = NOW()
              WHERE chit_id = $3 AND entity_id = $4`,
            [t.identity_id, t.display_name, chit_id, entity_id]);
          await client.query(`UPDATE identities SET current_task_count = current_task_count + 1, last_assigned_at = NOW() WHERE identity_id = $1`, [t.identity_id]);
          load++;
          await client.query(
            // F3: assignment is INTERNAL — write ONLY the assigning entity's own row. The assignee sees it via the
            // derived notifications feed (assigned_to_me) — step (d) of the workflow.
            `INSERT INTO state_log (chit_id, entity_id, action, action_by_identity_id, action_by_display_name, detail)
             SELECT $1, entity_id, 'assigned', $2, $3, $4 FROM chit_status WHERE chit_id = $1 AND entity_id = $5`,
            [chit_id, action_by_id, action_by_name, `Bulk-assigned to ${t.display_name} by ${action_by_name}`, entity_id]);
          assigned.push(chit_id);
        }
        return { t, assigned, skipped, cap };
      });
      res.json({ message: 'Bulk assign complete', assigned_to: out.t.display_name, assigned: out.assigned.length, skipped: out.skipped });
    } catch (err) {
      if (err.status === 400) return res.status(400).json({ error: 'Invalid target', message: err.message });
      console.error('Bulk assign error:', err.message);
      res.status(500).json({ error: 'Bulk assign failed', message: safeErr(err) });
    }
  });

module.exports = router;
