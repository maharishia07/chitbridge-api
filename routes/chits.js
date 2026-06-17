// routes/chits.js — Chit send, inbox, detail, status update
const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const { v4: uuidv4 } = require('uuid');
const { query } = require('../db');
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
    body('receivers')
      .isArray({ min: 1 })
      .withMessage('At least one receiver required'),
    body('receivers').custom((receivers) => {
      for (const r of receivers) {
        if (!r.entity_id && !r.display_name) {
          throw new Error('Each receiver must have entity_id or display_name');
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
      const receivers = req.body.receivers;

      // Existence check only — connection NOT required to send
      const receiverDetails = [];
      for (const r of receivers) {
        // Support both entity_id (UUID) and display_name lookup
        let rec;
        if (r.entity_id) {
          rec = await query(
            `SELECT identity_id, bridge_id, display_name FROM identities
             WHERE identity_id = $1 AND status = 'active'`,
            [r.entity_id]
          );
        } else if (r.display_name) {
          rec = await query(
            `SELECT identity_id, bridge_id, display_name FROM identities
             WHERE LOWER(display_name) = LOWER($1) AND status = 'active'
             AND identity_type = 'entity'`,
            [r.display_name.trim()]
          );
        }

        if (!rec || rec.rows.length === 0) {
          return res.status(404).json({
            error: 'Not found',
            message: `Receiver "${r.entity_id || r.display_name}" not found in the platform`
          });
        }

        // Check not sending to self
        if (rec.rows[0].identity_id === sender_id) {
          return res.status(400).json({ error: 'Invalid receiver', message: 'Cannot send to yourself' });
        }

        receiverDetails.push({
          entity_id: rec.rows[0].identity_id,
          bridge_id: rec.rows[0].bridge_id,
          display_name: rec.rows[0].display_name,
          role: 'receiver'
        });
      }

      // Generate chit_id — same for ALL participants
      const chit_id = uuidv4();
      const now = new Date();

      // Build all_recipients — snapshot with sender + all receivers
      const all_recipients = [
        {
          entity_id: sender_id,
          bridge_id: sender_bridge_id,
          display_name: sender_display_name,
          role: 'sender'
        },
        ...receiverDetails
      ];

      // Generate auto subject
      const auto_subject = generateAutoSubject(purpose, sender_display_name, now);

      // Calculate summary from line items
      const summary = calculateSummary(line_items);
      const currency_code = (business_json && business_json.currency) || 'INR';
      const summary_json = {
        ...summary,
        currency_code,
        purpose
      };

      // ── Create records for SENDER ──
      await query(
        `INSERT INTO chit_header
         (chit_id, entity_id, sender_entity_id, sender_entity_bridge_id,
          sender_entity_display_name, all_recipients, purpose,
          auto_subject, manual_subject, summary_json, business_json,
          sent_at, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW(),NOW())`,
        [chit_id, sender_id, sender_id, sender_bridge_id,
         sender_display_name, JSON.stringify(all_recipients), purpose,
         auto_subject, manual_subject || null,
         JSON.stringify(summary_json),
         business_json ? JSON.stringify(business_json) : null]
      );

      await query(
        `INSERT INTO chit_detail
         (chit_id, entity_id, detail_type, line_item_count,
          total_value, currency_code, line_items, payload_delivered_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())`,
        [chit_id, sender_id, purpose,
         summary.line_item_count, summary.total_value,
         summary_json.currency_code,
         line_items.length > 0 ? JSON.stringify(line_items) : null]
      );

      await query(
        `INSERT INTO chit_status
         (chit_id, entity_id, current_status)
         VALUES ($1,$2,'delivered')`,
        [chit_id, sender_id]
      );

      // Log for sender
      await query(
        `INSERT INTO state_log
         (chit_id, entity_id, action, action_by_identity_id,
          action_by_display_name, new_status, detail)
         VALUES ($1,$2,'created',$3,$4,'delivered',$5)`,
        [chit_id, sender_id, sender_id, sender_display_name,
         `Chit created and sent to ${receiverDetails.map(r => r.display_name).join(', ')}`]
      );

      // ── Create records for EACH RECEIVER ──
      for (const receiver of receiverDetails) {
        await query(
          `INSERT INTO chit_header
           (chit_id, entity_id, sender_entity_id, sender_entity_bridge_id,
            sender_entity_display_name, all_recipients, purpose,
            auto_subject, manual_subject, summary_json, business_json,
            sent_at, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW(),NOW())`,
          [chit_id, receiver.entity_id, sender_id, sender_bridge_id,
           sender_display_name, JSON.stringify(all_recipients), purpose,
           auto_subject, manual_subject || null,
           JSON.stringify(summary_json),
           business_json ? JSON.stringify(business_json) : null]
        );

        await query(
          `INSERT INTO chit_detail
           (chit_id, entity_id, detail_type, line_item_count,
            total_value, currency_code, line_items)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [chit_id, receiver.entity_id, purpose,
           summary.line_item_count, summary.total_value,
           summary_json.currency_code,
           line_items.length > 0 ? JSON.stringify(line_items) : null]
        );

        await query(
          `INSERT INTO chit_status
           (chit_id, entity_id, current_status)
           VALUES ($1,$2,'pending')`,
          [chit_id, receiver.entity_id]
        );

        // Log for receiver
        await query(
          `INSERT INTO state_log
           (chit_id, entity_id, action, action_by_identity_id,
            action_by_display_name, new_status, detail)
           VALUES ($1,$2,'delivered',$3,$4,'pending',$5)`,
          [chit_id, receiver.entity_id, sender_id, sender_display_name,
           `Chit received from ${sender_display_name}`]
        );

        // B3.6 — auto-add this receiver to sender's customer_list (D-065).
        // Never breaks /send: a missing table or any error is logged and ignored.
        try {
          await query(
            `INSERT INTO customer_list
               (owner_entity_id, customer_identity_id, customer_type, added_via, txn_count, last_txn_at)
             VALUES ($1, $2, 'entity', 'transaction', 1, NOW())
             ON CONFLICT (owner_entity_id, customer_identity_id)
             DO UPDATE SET txn_count = customer_list.txn_count + 1, last_txn_at = NOW()`,
            [sender_id, receiver.entity_id]
          );
        } catch (e) { console.log('customer auto-add skipped:', e.message); }
      }

      res.json({
        message: 'Chit sent successfully',
        chit_id,
        auto_subject,
        recipients: receiverDetails.length,
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
          WHERE cm2.chit_id = ch.chit_id AND cm2.visibility_entity_id IS NULL) AS last_message_at
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

// ─── POST /chits/:chit_id/disputes ───────────────────────────
router.post('/:chit_id/disputes',
  [
    body('category').isIn(['quality','quantity','delivery','payment','docs','other']).withMessage('Invalid category'),
    body('reason').trim().isLength({ min: 10 }).withMessage('Reason must be at least 10 characters'),
  ],
  validate,
  auth,
  async (req, res) => {
    const { chit_id }  = req.params;
    const { category, reason } = req.body;
    const entity_id    = req.identity.parent_entity_id || req.identity.identity_id;
    const display_name = req.identity.display_name;

    try {
      const access = await query(
        `SELECT current_status FROM chit_status WHERE chit_id = $1 AND entity_id = $2`,
        [chit_id, entity_id]
      );
      if (access.rows.length === 0) return res.status(403).json({ error: 'Not a participant' });

      // Block duplicate open dispute in same category from same entity
      const existing = await query(
        `SELECT dispute_id FROM chit_disputes WHERE chit_id = $1 AND raised_by_entity_id = $2 AND status = 'open' AND category = $3`,
        [chit_id, entity_id, category]
      );
      if (existing.rows.length > 0) {
        return res.status(400).json({ error: 'Dispute exists', message: `You already have an open ${category} dispute on this chit` });
      }

      const result = await query(
        `INSERT INTO chit_disputes
           (chit_id, raised_by_entity_id, raised_by_display_name, category, reason, status, created_at)
         VALUES ($1, $2, $3, $4, $5, 'open', NOW())
         RETURNING *`,
        [chit_id, entity_id, display_name, category, reason]
      );

      // Log in state_log for timeline — sender's entity view
      await query(
        `INSERT INTO state_log
           (chit_id, entity_id, action, action_by_identity_id, action_by_display_name, detail)
         VALUES ($1, $2, 'dispute_raised', $3, $4, $5)`,
        [chit_id, entity_id, entity_id, display_name, `Dispute raised — ${category}: ${reason.slice(0,100)}`]
      );

      res.json({
        dispute_id:           result.rows[0].dispute_id,
        category,
        reason,
        status:               'open',
        raised_by_display_name: display_name,
        created_at:           result.rows[0].created_at,
        message:              'Dispute raised',
      });
    } catch (err) {
      console.error('Raise dispute error:', err.message);
      if (err.message.includes('chit_disputes')) {
        return res.status(500).json({ error: 'Table not found', message: 'Run B3.5 migration SQL first', sql_needed: true });
      }
      res.status(500).json({ error: 'Raise dispute failed', message: err.message });
    }
  }
);

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

    const result = await query(
      `SELECT * FROM chit_disputes WHERE chit_id = $1 ORDER BY created_at ASC`,
      [chit_id]
    );
    res.json({ disputes: result.rows, open_count: result.rows.filter(d => d.status === 'open').length });
  } catch (err) {
    if (err.message.includes('chit_disputes')) return res.json({ disputes: [], open_count: 0 });
    res.status(500).json({ error: 'Get disputes failed', message: err.message });
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
       ORDER BY cd.created_at ASC`,
      [entity_id]
    );

    const myDisputes    = result.rows.filter(d => d.raised_by_entity_id === entity_id);
    const otherDisputes = result.rows.filter(d => d.raised_by_entity_id !== entity_id);

    res.json({
      disputes:       result.rows,
      my_disputes:    myDisputes,
      other_disputes: otherDisputes,
      total_open:     result.rows.length,
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
