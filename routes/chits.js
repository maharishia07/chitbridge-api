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
      const summary_json = {
        ...summary,
        currency_code: req.identity.currency_code || 'INR',
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
         cs.assignment_type
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

    // Get full state log for the chit — shared timeline visible to all participants
    const log = await query(
      `SELECT action, action_by_display_name, previous_status,
              new_status, detail, created_at
       FROM state_log
       WHERE chit_id = $1
       ORDER BY created_at ASC`,
      [chit_id]
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
      .isIn(['accepted','rejected','in_progress','partial','completed','cancelled'])
      .withMessage('Invalid status'),
    body('note').optional().trim().isLength({ max: 500 }),
  ],
  validate,
  auth,
  async (req, res) => {
    try {
      const chit_id = req.params.chit_id;
      const entity_id = req.identity.identity_id;
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
      const validTransitions = {
        'pending':     ['accepted', 'rejected', 'cancelled'],
        'delivered':   ['accepted', 'rejected', 'cancelled'],
        'accepted':    ['in_progress', 'completed', 'cancelled'],
        'in_progress': ['partial', 'completed', 'cancelled'],
        'partial':     ['completed', 'cancelled'],
        'read':        ['accepted', 'rejected', 'cancelled']
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

      // Log state change
      const detail = note ||
        `Status changed from ${previous_status} to ${new_status} by ${req.identity.display_name}`;

      await query(
        `INSERT INTO state_log
         (chit_id, entity_id, action, action_by_identity_id,
          action_by_display_name, previous_status, new_status, detail)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [chit_id, entity_id, `status_${new_status}`,
         entity_id, req.identity.display_name,
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

      if (!isSender && header.rows.length > 0) {
        // Receiver action — log update to sender so they see it
        await query(
          `INSERT INTO state_log
           (chit_id, entity_id, action, action_by_identity_id,
            action_by_display_name, previous_status, new_status, detail)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [chit_id, header.rows[0].sender_entity_id,
           `status_${new_status}`,
           entity_id, req.identity.display_name,
           previous_status, new_status,
           `${req.identity.display_name} ${new_status} this chit`]
        );
      }

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
          await query(
            `INSERT INTO state_log
             (chit_id, entity_id, action, action_by_identity_id,
              action_by_display_name, previous_status, new_status, detail)
             VALUES ($1,$2,'status_cancelled',$3,$4,'pending','cancelled',$5)`,
            [chit_id, r.entity_id, entity_id, req.identity.display_name,
             `Cancelled by ${req.identity.display_name}`]
          );
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

module.exports = router;
