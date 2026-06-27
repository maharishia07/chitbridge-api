// routes/chits.js — Chit send, inbox, detail, status update
const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const { v4: uuidv4 } = require('uuid');
const { query, withTransaction } = require('../db');
const { validate, sanitise } = require('../middleware/validate');
const auth = require('../middleware/auth');

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
      const sender_id = req.identity.identity_id;
      const sender_bridge_id = req.identity.bridge_id;
      const sender_display_name = req.identity.display_name;
      const purpose = req.body.purpose;
      const manual_subject = sanitise(req.body.manual_subject || '');
      const line_items = req.body.line_items || [];
      const business_json = req.body.business_json || null;
      const is_draft = !!req.body.is_draft;

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

      // Existence check only — connection NOT required to send. Resolve + de-dupe (one chit_header row per entity).
      const receiverDetails = [];
      const seen = new Set();
      for (const r of rawList) {
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
          return res.status(404).json({
            error: 'Not found',
            message: `Recipient "${r.entity_id || r.display_name || r.name}" not found in the platform`
          });
        }

        const rid = rec.rows[0].identity_id;
        // Cannot send to self (the sender already holds the origin copy)
        if (rid === sender_id) {
          return res.status(400).json({ error: 'Invalid recipient', message: 'Cannot send to yourself' });
        }
        if (seen.has(rid)) continue;   // de-dupe: one chit_header row per entity (composite PK)
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

      // Generate chit_id — same for ALL participants
      const chit_id = uuidv4();
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
      const summary_json = {
        ...summary,
        currency_code,
        purpose,
        is_promotion: !!(business_json && business_json.is_promotion)
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

      // ── Guaranteed write: every row for this chit commits together, or none do (INV-2) ──
      await withTransaction(async (client) => {
        // SENDER
        await client.query(
          `INSERT INTO chit_header
           (chit_id, entity_id, sender_entity_id, sender_entity_bridge_id,
            sender_entity_display_name, all_recipients, purpose,
            auto_subject, manual_subject, summary_json, business_json,
            schema_version, schema_id, created_by_actor_id, role, chit_ref, sent_at, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,NOW(),NOW())`,
          [chit_id, sender_id, sender_id, sender_bridge_id,
           sender_display_name, JSON.stringify(all_recipients), purpose,
           auto_subject, manual_subject || null,
           JSON.stringify(summary_json),
           business_json ? JSON.stringify(business_json) : null,
           frozen_schema_version, frozen_schema_id, created_by_actor_id,
           is_draft ? 'Draft' : 'Act', chit_id]
        );
        await client.query(
          `INSERT INTO chit_detail
           (chit_id, entity_id, detail_type, line_item_count,
            total_value, currency_code, line_items, payload_delivered_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())`,
          [chit_id, sender_id, purpose,
           summary.line_item_count, summary.total_value,
           summary_json.currency_code,
           line_items.length > 0 ? JSON.stringify(line_items) : null]
        );
        await client.query(
          `INSERT INTO chit_status (chit_id, entity_id, current_status)
           VALUES ($1,$2,'delivered')`,
          [chit_id, sender_id]
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
              schema_version, schema_id, created_by_actor_id, role, chit_ref, sent_at, created_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,NOW(),NOW())`,
            [chit_id, receiver.entity_id, sender_id, sender_bridge_id,
             sender_display_name, JSON.stringify(all_recipients), purpose,
             auto_subject, manual_subject || null,
             JSON.stringify(summary_json),
             business_json ? JSON.stringify(business_json) : null,
             frozen_schema_version, frozen_schema_id, created_by_actor_id,
             receiver.role, chit_id]
          );
          await client.query(
            `INSERT INTO chit_detail
             (chit_id, entity_id, detail_type, line_item_count,
              total_value, currency_code, line_items)
             VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [chit_id, receiver.entity_id, purpose,
             summary.line_item_count, summary.total_value,
             summary_json.currency_code,
             line_items.length > 0 ? JSON.stringify(line_items) : null]
          );
          await client.query(
            `INSERT INTO chit_status (chit_id, entity_id, current_status)
             VALUES ($1,$2,$3)`,
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

      // ── Best-effort CRM auto-add — AFTER commit; a CRM write must never fail a guaranteed chit (D-065) ──
      if (!is_draft) for (const receiver of receiverDetails) {
        try {
          const isSupplier = await query(
            `SELECT 1 FROM supplier_list
              WHERE owner_entity_id = $1 AND supplier_entity_id = $2`,
            [sender_id, receiver.entity_id]
          );
          if (isSupplier.rows.length === 0) {
            await query(
              `INSERT INTO customer_list
                 (owner_entity_id, customer_identity_id, customer_type, added_via, txn_count, last_txn_at)
               VALUES ($1, $2, 'entity', 'transaction', 1, NOW())
               ON CONFLICT (owner_entity_id, customer_identity_id)
               DO UPDATE SET txn_count = customer_list.txn_count + 1, last_txn_at = NOW()`,
              [sender_id, receiver.entity_id]
            );
          }
        } catch (e) { console.log('customer auto-add skipped:', e.message); }
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
      res.status(500).json({ error: 'Send failed', message: err.message });
    }
  }
);

// ─── GET /chits/inbox ─────────────────────────────────────────
// Lightweight inbox — my chit_status only — fast
router.get('/inbox', auth, async (req, res) => {
  try {
    // Actors query their parent entity's inbox (chit_status is entity-keyed)
    const entity_id = req.identity.parent_entity_id || req.identity.identity_id;
    const page = parseInt(req.query.page || 1);
    const limit = parseInt(req.query.limit || 20);
    const offset = (page - 1) * limit;
    const status_filter = req.query.status || null;

    let whereClause = `cs.entity_id = $1 AND cs.deleted_at IS NULL`;
    const params = [entity_id];
    let paramCount = 1;

    if (status_filter) {
      paramCount++;
      whereClause += ` AND cs.current_status = $${paramCount}`;
      params.push(status_filter);
    }

    // Count total
    const countResult = await query(
      `SELECT COUNT(*) FROM chit_status cs WHERE ${whereClause}`,
      params
    );

    // Get inbox — lightweight — no payload
    const result = await query(
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
          WHERE cd.chit_id = ch.chit_id AND cd.status = 'open') AS open_dispute_count,
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
       WHERE ${whereClause}
       ORDER BY ch.created_at DESC
       LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`,
      [...params, limit, offset]
    );

    res.json({
      chits: result.rows,
      pagination: {
        total: parseInt(countResult.rows[0].count),
        page,
        limit,
        pages: Math.ceil(countResult.rows[0].count / limit)
      }
    });

  } catch (err) {
    console.error('Inbox error:', err.message);
    res.status(500).json({ error: 'Failed to get inbox', message: err.message });
  }
});

// ─── GET /chits/:chit_id ──────────────────────────────────────
// Full chit detail — all participants, full state log, line items
router.get('/:chit_id', auth, async (req, res) => {
  try {
    const chit_id = req.params.chit_id;
    // Actors use parent entity's id — chit_header and chit_status are entity-keyed
    const entity_id = req.identity.parent_entity_id || req.identity.identity_id;

    // Verify entity participates in this chit
    const participation = await query(
      `SELECT 1 FROM chit_header
       WHERE chit_id = $1 AND entity_id = $2`,
      [chit_id, entity_id]
    );

    if (participation.rows.length === 0) {
      return res.status(404).json({
        error: 'Not found',
        message: 'Chit not found or you do not have access'
      });
    }

    // Get my header
    const header = await query(
      `SELECT * FROM chit_header
       WHERE chit_id = $1 AND entity_id = $2`,
      [chit_id, entity_id]
    );

    // Get my detail — line items if still present
    const detail = await query(
      `SELECT detail_type, line_item_count, total_value, currency_code,
              line_items, payload_delivered_at, payload_deleted_at
       FROM chit_detail
       WHERE chit_id = $1 AND entity_id = $2`,
      [chit_id, entity_id]
    );

    // Each participant has their own copy (entity_id = their entity).
    // Filtering by entity_id means one party deleting their rows never affects others.
    const log = await query(
      `SELECT action, action_by_display_name, previous_status,
              new_status, detail, created_at
       FROM state_log
       WHERE chit_id = $1 AND entity_id = $2 AND action != 'read'
       ORDER BY created_at ASC`,
      [chit_id, entity_id]
    );

    // Check if first time reading (before update) to decide whether to log it
    const preCheck = await query(
      `SELECT read_at FROM chit_status WHERE chit_id = $1 AND entity_id = $2`,
      [chit_id, entity_id]
    );
    const wasUnread = !preCheck.rows[0]?.read_at;

    // Update read_at FIRST so allStatuses fetch below reflects this read
    await query(
      `UPDATE chit_status
       SET read_at = NOW()
       WHERE chit_id = $1 AND entity_id = $2`,
      [chit_id, entity_id]
    );

    // Get ALL participants status AFTER update — ensures current reader's read_at is fresh
    const allStatuses = await query(
      `SELECT cs.entity_id, cs.current_status, cs.read_at,
              cs.assigned_to_actor_display_name, cs.updated_at,
              i.display_name, i.bridge_id
       FROM chit_status cs
       JOIN identities i ON i.identity_id = cs.entity_id
       WHERE cs.chit_id = $1`,
      [chit_id]
    );
    if (wasUnread) {
      await query(
        `INSERT INTO state_log
         (chit_id, entity_id, action, action_by_identity_id,
          action_by_display_name, detail)
         VALUES ($1,$2,'read',$3,$4,'Chit opened and read')`,
        [chit_id, entity_id, entity_id, req.identity.display_name]
      );
    }

    res.json({
      header: header.rows[0],
      detail: detail.rows[0] || null,
      participants: allStatuses.rows,
      state_log: log.rows
    });

  } catch (err) {
    console.error('Chit detail error:', err.message);
    res.status(500).json({ error: 'Failed to get chit', message: err.message });
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
      const current = await query(
        `SELECT current_status FROM chit_status
         WHERE chit_id = $1 AND entity_id = $2`,
        [chit_id, entity_id]
      );

      if (current.rows.length === 0) {
        return res.status(404).json({
          error: 'Not found',
          message: 'Chit not found'
        });
      }

      const previous_status = current.rows[0].current_status;

      // Validate state transitions
      // Arrow model: Open(pending/delivered/read) → in_progress → completed
      // ← regress: in_progress/accepted → pending, completed → in_progress
      // Legacy accepted step kept for backward compat (ChitDetailPage still uses it)
      const validTransitions = {
        'pending':     ['in_progress', 'accepted', 'rejected', 'cancelled'],
        'delivered':   ['in_progress', 'accepted', 'rejected', 'cancelled'],
        'read':        ['in_progress', 'accepted', 'rejected', 'cancelled'],
        'accepted':    ['in_progress', 'pending', 'rejected', 'cancelled'],
        'in_progress': ['partial', 'completed', 'pending', 'accepted', 'cancelled'],
        'partial':     ['in_progress', 'completed', 'cancelled'],
        'completed':   ['in_progress'],
        'rejected':    ['accepted'],
        'cancelled':   ['accepted'],
      };

      const allowed = validTransitions[previous_status] || [];
      if (!allowed.includes(new_status)) {
        return res.status(400).json({
          error: 'Invalid transition',
          message: `Cannot move from ${previous_status} to ${new_status}`,
          allowed_transitions: allowed
        });
      }

      // Update chit_status
      await query(
        `UPDATE chit_status
         SET current_status = $1, updated_at = NOW()
         WHERE chit_id = $2 AND entity_id = $3`,
        [new_status, chit_id, entity_id]
      );

      // One log row per participant — each entity owns their copy independently
      const detail = note ||
        `Status changed from ${previous_status} to ${new_status} by ${action_by_name}`;

      await query(
        `INSERT INTO state_log
         (chit_id, entity_id, action, action_by_identity_id,
          action_by_display_name, previous_status, new_status, detail)
         SELECT $1, entity_id, $2, $3, $4, $5, $6, $7
         FROM chit_status WHERE chit_id = $1`,
        [chit_id, `status_${new_status}`,
         action_by_id, action_by_name,
         previous_status, new_status, detail]
      );

      // Get header to check sender and propagate cancellation to receivers
      const header = await query(
        `SELECT sender_entity_id FROM chit_header
         WHERE chit_id = $1 AND entity_id = $2`,
        [chit_id, entity_id]
      );

      const isSender = header.rows.length > 0 &&
                       header.rows[0].sender_entity_id === entity_id;

      // One log entry per status change — state_log is queried by chit_id only
      // so all participants already see every entry; no need to duplicate per entity

      // When sender cancels — push cancellation to all receivers
      if (isSender && new_status === 'cancelled') {
        const receivers = await query(
          `SELECT entity_id FROM chit_status
           WHERE chit_id = $1 AND entity_id != $2`,
          [chit_id, entity_id]
        );
        for (const r of receivers.rows) {
          await query(
            `UPDATE chit_status SET current_status = 'cancelled', updated_at = NOW()
             WHERE chit_id = $1 AND entity_id = $2`,
            [chit_id, r.entity_id]
          );
          // No separate log insert — the per-participant INSERT...SELECT above
          // already wrote a cancelled row for every entity on this chit
        }
      }

      res.json({
        message: `Chit ${new_status}`,
        chit_id,
        previous_status,
        new_status
      });

    } catch (err) {
      console.error('Update status error:', err.message);
      res.status(500).json({ error: 'Update failed', message: err.message });
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
  ],
  validate,
  auth,
  async (req, res) => {
    const { chit_id }  = req.params;
    const { message_text, thread_type } = req.body;
    const entity_id    = req.identity.parent_entity_id || req.identity.identity_id;
    const display_name = req.identity.display_name;

    try {
      const access = await query(
        `SELECT entity_id FROM chit_status WHERE chit_id = $1 AND entity_id = $2`,
        [chit_id, entity_id]
      );
      if (access.rows.length === 0) {
        return res.status(403).json({ error: 'Forbidden', message: 'Not a participant on this chit' });
      }

      // NULL visibility = external (all see); entity_id = internal (only sender sees)
      const visibility_entity_id = thread_type === 'internal' ? entity_id : null;

      const result = await query(
        `INSERT INTO chit_messages
           (chit_id, sender_entity_id, sender_display_name,
            thread_type, visibility_entity_id, message_text, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())
         RETURNING *`,
        [chit_id, entity_id, display_name, thread_type, visibility_entity_id, message_text]
      );

      // Log external messages in state_log so all participants see it in their timeline
      if (thread_type === 'external') {
        const participants = await query(
          `SELECT entity_id FROM chit_status WHERE chit_id = $1`,
          [chit_id]
        );
        for (const p of participants.rows) {
          await query(
            `INSERT INTO state_log (chit_id, entity_id, action, action_by_identity_id, action_by_display_name, detail)
             VALUES ($1, $2, 'message_sent', $3, $4, $5)`,
            [chit_id, p.entity_id, entity_id, display_name, message_text.slice(0, 100)]
          );
        }
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
      res.status(500).json({ error: 'Send message failed', message: err.message });
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
    const access = await query(
      `SELECT entity_id FROM chit_status WHERE chit_id = $1 AND entity_id = $2`,
      [chit_id, entity_id]
    );
    if (access.rows.length === 0) return res.status(403).json({ error: 'Forbidden' });

    let q, params;
    if (thread_filter === 'external') {
      q = `SELECT * FROM chit_messages WHERE chit_id = $1 AND thread_type = 'external' ORDER BY created_at ASC`;
      params = [chit_id];
    } else if (thread_filter === 'internal') {
      q = `SELECT * FROM chit_messages WHERE chit_id = $1 AND thread_type = 'internal' AND visibility_entity_id = $2 ORDER BY created_at ASC`;
      params = [chit_id, entity_id];
    } else {
      q = `SELECT * FROM chit_messages WHERE chit_id = $1 AND (thread_type = 'external' OR (thread_type = 'internal' AND visibility_entity_id = $2)) ORDER BY created_at ASC`;
      params = [chit_id, entity_id];
    }

    const result = await query(q, params);
    res.json({ messages: result.rows, count: result.rows.length });
  } catch (err) {
    console.error('Get messages error:', err.message);
    if (err.message.includes('chit_messages')) return res.json({ messages: [], count: 0 });
    res.status(500).json({ error: 'Get messages failed', message: err.message });
  }
});

// ─── B3.10 — targeted + erasure-aware dispute helpers ────────
// integrity-critical categories whose audience the platform widens by obligation (opt-in via env)
const WIDEN_CATEGORIES = (process.env.CB_DISPUTE_WIDEN_CATEGORIES || '')
  .split(',').map(s => s.trim()).filter(Boolean);

async function probeParity(chit_id, target_entity_id) {
  if (!target_entity_id) return { parity_state: null, mode: 'two_sided', answerable: true, target_display_name: null };
  const idn = await query(`SELECT display_name, status, is_erased FROM identities WHERE identity_id=$1`, [target_entity_id]);
  if (idn.rows.length === 0) return { parity_state:'absent', mode:'one_sided', answerable:false, target_display_name:'[unknown]' };
  const t = idn.rows[0];
  if (t.is_erased)            return { parity_state:'erased', mode:'one_sided', answerable:false, target_display_name:'[erased]' };
  if (t.status !== 'active')  return { parity_state:'defunct', mode:'one_sided', answerable:false, target_display_name:t.display_name };
  const cs = await query(`SELECT deleted_at FROM chit_status WHERE chit_id=$1 AND entity_id=$2`, [chit_id, target_entity_id]);
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
      const access = await query(`SELECT current_status FROM chit_status WHERE chit_id=$1 AND entity_id=$2`, [chit_id, entity_id]);
      if (access.rows.length === 0) return res.status(403).json({ error:'Not a participant' });

      // 2. can't target yourself
      if (target_entity_id && target_entity_id === entity_id)
        return res.status(400).json({ error:'Invalid target', message:'You cannot raise a dispute against yourself' });

      // 3. decide scope + probe parity → mode
      let scope = (chit_wide || !target_entity_id) ? 'chit_wide' : 'targeted';
      const parity = await probeParity(chit_id, scope === 'targeted' ? target_entity_id : null);

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

      // 6. evidence snapshot — "forward your chit" (survives counterparty erasure)
      const snap = await query(
        `SELECT ch.auto_subject, ch.summary_json, cs.current_status AS my_status
           FROM chit_header ch JOIN chit_status cs ON cs.chit_id=ch.chit_id AND cs.entity_id=$2
          WHERE ch.chit_id=$1`, [chit_id, entity_id]);
      const evidence = { ...(snap.rows[0] || {}), captured_at: new Date().toISOString(), via };

      // 7 + 8. insert dispute + timeline atomically (INV-2)
      const d = await withTransaction(async (client) => {
        const result = await client.query(
          `INSERT INTO chit_disputes
             (chit_id, raised_by_entity_id, raised_by_display_name, target_entity_id, target_display_name,
              scope, mode, answerable, parity_state, via, category, reason, evidence_snapshot, status, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'open',NOW())
           RETURNING *`,
          [chit_id, entity_id, display_name,
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
        return result.rows[0];
      });
      res.json({
        dispute_id: d.dispute_id, category, reason, status:'open',
        scope, mode: d.mode, answerable: d.answerable, parity_state: d.parity_state,
        target_display_name: d.target_display_name,
        raised_by_display_name: display_name,
        alert: d.mode === 'one_sided'
          ? `The other side is no longer reachable (${d.parity_state}). This is lodged as a unilateral record on your own copy.`
          : (widened ? 'This category notifies all parties — raised chit-wide.' : 'Dispute raised with the selected party.'),
        message: 'Dispute raised',
      });
    } catch (err) {
      console.error('Raise dispute error:', err.message);
      if (err.message.includes('chit_disputes')) return res.status(500).json({ error:'Table not found', message:'Run B3.5 + B3.10 migrations', sql_needed:true });
      res.status(500).json({ error:'Raise dispute failed', message: err.message });
    }
  });

// ─── GET /chits/:chit_id/disputes ────────────────────────────
// All participants see all disputes on a chit
router.get('/:chit_id/disputes', auth, async (req, res) => {
  const { chit_id } = req.params;
  const entity_id   = req.identity.parent_entity_id || req.identity.identity_id;

  try {
    const access = await query(
      `SELECT entity_id FROM chit_status WHERE chit_id = $1 AND entity_id = $2`,
      [chit_id, entity_id]
    );
    if (access.rows.length === 0) return res.status(403).json({ error: 'Forbidden' });

    // B3.10 — scoped: you see chit-wide disputes, ones you raised, or ones targeting you
    const result = await query(
      `SELECT * FROM chit_disputes
         WHERE chit_id = $1 AND (scope='chit_wide' OR raised_by_entity_id=$2 OR target_entity_id=$2)
         ORDER BY created_at ASC`,
      [chit_id, entity_id]
    );
    // evidence_snapshot is PII — expose presence only, never its contents
    const disputes = result.rows.map(({ evidence_snapshot, ...d }) => ({ ...d, has_evidence: evidence_snapshot != null }));
    res.json({ disputes, open_count: disputes.filter(d => d.status === 'open').length });
  } catch (err) {
    if (err.message.includes('chit_disputes')) return res.json({ disputes: [], open_count: 0 });
    res.status(500).json({ error: 'Get disputes failed', message: err.message });
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
    const access = await query(`SELECT 1 FROM chit_status WHERE chit_id=$1 AND entity_id=$2`, [chit_id, entity_id]);
    if (access.rows.length === 0) return res.status(403).json({ error: 'Forbidden' });

    const hdr = await query(
      `SELECT auto_subject, schema_version FROM chit_header WHERE chit_id=$1 AND entity_id=$2`,
      [chit_id, entity_id]);
    const det = await query(
      `SELECT line_items FROM chit_detail WHERE chit_id=$1 AND entity_id=$2`,
      [chit_id, entity_id]);
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
    res.status(500).json({ error: 'Diagnosis failed', message: err.message });
  }
});

// ─── PUT /chits/:chit_id/disputes/:dispute_id/resolve ────────
// Only the entity that raised the dispute can resolve it
router.put('/:chit_id/disputes/:dispute_id/resolve',
  [body('resolution_note').trim().notEmpty().withMessage('Resolution note required')],
  validate,
  auth,
  async (req, res) => {
    const { chit_id, dispute_id } = req.params;
    const { resolution_note }     = req.body;
    const entity_id    = req.identity.parent_entity_id || req.identity.identity_id;
    const display_name = req.identity.display_name;

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

      await query(
        `UPDATE chit_disputes
         SET status = 'resolved', resolution_note = $1, resolved_by_entity_id = $2, resolved_at = NOW()
         WHERE dispute_id = $3`,
        [resolution_note, entity_id, dispute_id]
      );

      await query(
        `INSERT INTO state_log
           (chit_id, entity_id, action, action_by_identity_id, action_by_display_name, detail)
         VALUES ($1, $2, 'dispute_resolved', $3, $4, $5)`,
        [chit_id, entity_id, entity_id, display_name, `Dispute resolved — ${d.category}: ${resolution_note.slice(0,100)}`]
      );

      res.json({ dispute_id, status: 'resolved', resolution_note, resolved_by: display_name, message: 'Dispute resolved' });
    } catch (err) {
      console.error('Resolve dispute error:', err.message);
      res.status(500).json({ error: 'Resolve failed', message: err.message });
    }
  }
);

// ─── GET /chits/disputes/queue ────────────────────────────────
// All open disputes across all chits for this entity — used by DisputesPage sidebar
// Safe: /disputes/queue has 2 segments; /:chit_id matches 1 segment only — no conflict
router.get('/disputes/queue', auth, async (req, res) => {
  const entity_id = req.identity.parent_entity_id || req.identity.identity_id;

  try {
    const result = await query(
      `SELECT cd.*, ch.auto_subject, ch.purpose,
              se.display_name AS sender_display_name
       FROM chit_disputes cd
       JOIN chit_header ch ON ch.chit_id = cd.chit_id AND ch.entity_id = $1
       JOIN chit_status cs ON cs.chit_id = cd.chit_id AND cs.entity_id = $1
       LEFT JOIN identities se ON se.identity_id = ch.sender_entity_id
       WHERE cd.status = 'open'
         AND (cd.scope='chit_wide' OR cd.raised_by_entity_id = $1 OR cd.target_entity_id = $1)
       ORDER BY cd.created_at ASC`,
      [entity_id]
    );

    // evidence_snapshot is PII — expose presence only, never its contents
    const rows = result.rows.map(({ evidence_snapshot, ...d }) => ({ ...d, has_evidence: evidence_snapshot != null }));
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
    res.status(500).json({ error: 'Get dispute queue failed', message: err.message });
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

    // Verify this entity has a (non-deleted) copy of the chit
    const current = await query(
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
    const openDisputes = await query(
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
    await query(
      `UPDATE chit_status
       SET deleted_at = NOW(), updated_at = NOW()
       WHERE chit_id = $1 AND entity_id = $2`,
      [chit_id, entity_id]
    );

    // Audit trail — one row for this entity's copy
    await query(
      `INSERT INTO state_log
       (chit_id, entity_id, action, action_by_identity_id,
        action_by_display_name, previous_status, new_status, detail)
       VALUES ($1, $2, 'deleted', $3, $4, $5, $5, $6)`,
      [chit_id, entity_id, action_by_id, action_by_name,
       current.rows[0].current_status,
       `Chit deleted by ${action_by_name}`]
    );

    res.json({ message: 'Chit deleted', chit_id });

  } catch (err) {
    console.error('Delete chit error:', err.message);
    res.status(500).json({ error: 'Delete failed', message: err.message });
  }
});

module.exports = router;
