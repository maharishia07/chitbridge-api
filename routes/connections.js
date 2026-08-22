// routes/connections.js — Connection handshake
const express = require('express');
const router = express.Router();
const { safeErr } = require('../lib/respond');
const { body } = require('express-validator');
const { v4: uuidv4 } = require('uuid');
const { query, withEntity } = require('../db');
const { validate, sanitise } = require('../middleware/validate');
const auth = require('../middleware/auth');

// ─── POST /connections/request ───────────────────────────────
// Entity A sends connection request to Entity B
router.post('/request',
  [
    body('to_entity_id').trim().notEmpty().withMessage('Receiver entity ID required'),
    body('note').optional().trim().isLength({ max: 500 }),
  ],
  auth,
  validate,
  async (req, res) => {
    try {
      const from_id = req.identity.identity_id;
      const to_id = sanitise(req.body.to_entity_id);
      const note = sanitise(req.body.note || '');

      // Cannot connect to yourself
      if (from_id === to_id) {
        return res.status(400).json({
          error: 'Invalid request',
          message: 'Cannot connect to yourself'
        });
      }

      // Check receiver exists
      const receiver = await query(
        `SELECT identity_id, bridge_id, display_name
         FROM identities
         WHERE identity_id = $1 AND status = 'active'`,
        [to_id]
      );

      if (receiver.rows.length === 0) {
        return res.status(404).json({
          error: 'Not found',
          message: 'Entity not found'
        });
      }

      // Check if connection already exists
      const existing = await query(
        `SELECT connection_id, status
         FROM connections
         WHERE (from_entity_id = $1 AND to_entity_id = $2)
            OR (from_entity_id = $2 AND to_entity_id = $1)`,
        [from_id, to_id]
      );

      if (existing.rows.length > 0) {
        return res.status(400).json({
          error: 'Connection exists',
          message: `Connection already exists with status: ${existing.rows[0].status}`,
          status: existing.rows[0].status
        });
      }

      // Get sender snapshot
      const sender = await query(
        'SELECT bridge_id, display_name FROM identities WHERE identity_id = $1',
        [from_id]
      );

      // Create connection request
      const connection_id = uuidv4();
      await query(
        `INSERT INTO connections
         (connection_id, from_entity_id, from_display_name, from_bridge_id,
          to_entity_id, to_display_name, to_bridge_id, status, note)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8)`,
        [
          connection_id,
          from_id,
          sender.rows[0].display_name,
          sender.rows[0].bridge_id,
          to_id,
          receiver.rows[0].display_name,
          receiver.rows[0].bridge_id,
          note
        ]
      );

      // Log to state_log (the requester's OWN copy). B1 RLS: withEntity(me).
      await withEntity(from_id, (c) => c.query(
        `INSERT INTO state_log
         (chit_id, entity_id, action, action_by_identity_id,
          action_by_display_name, detail)
         VALUES ($1, $2, 'connection_requested', $3, $4, $5)`,
        [
          connection_id,
          from_id,
          from_id,
          sender.rows[0].display_name,
          `Connection request sent to ${receiver.rows[0].display_name}`
        ]
      ));

      res.json({
        message: 'Connection request sent',
        connection_id,
        to: {
          display_name: receiver.rows[0].display_name,
          bridge_id: receiver.rows[0].bridge_id
        }
      });

    } catch (err) {
      console.error('Connection request error:', err.message);
      res.status(500).json({ error: 'Request failed', message: safeErr(err) });
    }
  }
);

// ─── GET /connections/pending ─────────────────────────────────
// Get pending connection requests for current entity
router.get('/pending', auth, async (req, res) => {
  try {
    const result = await query(
      `SELECT connection_id, from_entity_id, from_display_name,
              from_bridge_id, note, created_at
       FROM connections
       WHERE to_entity_id = $1 AND status = 'pending'
       ORDER BY created_at DESC`,
      [req.identity.identity_id]
    );

    res.json({
      requests: result.rows,
      count: result.rows.length
    });

  } catch (err) {
    console.error('Pending connections error:', err.message);
    res.status(500).json({ error: 'Failed to get requests', message: safeErr(err) });
  }
});

// ─── PUT /connections/:id/respond ────────────────────────────
// Entity B accepts or rejects connection request
router.put('/:id/respond',
  [
    body('action')
      .trim()
      .isIn(['accept', 'reject'])
      .withMessage('Action must be accept or reject'),
  ],
  auth,
  validate,
  async (req, res) => {
    try {
      const connection_id = req.params.id;
      const action = req.body.action;
      const entity_id = req.identity.identity_id;

      // Find connection
      const conn = await query(
        `SELECT * FROM connections
         WHERE connection_id = $1 AND to_entity_id = $2 AND status = 'pending'`,
        [connection_id, entity_id]
      );

      if (conn.rows.length === 0) {
        return res.status(404).json({
          error: 'Not found',
          message: 'Connection request not found or already responded'
        });
      }

      const newStatus = action === 'accept' ? 'accepted' : 'rejected';

      // Update connection status
      await query(
        `UPDATE connections
         SET status = $1, responded_at = NOW()
         WHERE connection_id = $2`,
        [newStatus, connection_id]
      );

      // Log to state_log — for both entities
      const logAction = action === 'accept'
        ? 'connection_accepted'
        : 'connection_rejected';

      const detail = action === 'accept'
        ? `${req.identity.display_name} accepted connection from ${conn.rows[0].from_display_name}`
        : `${req.identity.display_name} rejected connection from ${conn.rows[0].from_display_name}`;

      // Log for receiver (the responder's OWN copy). B1 RLS: withEntity(me).
      await withEntity(entity_id, (c) => c.query(
        `INSERT INTO state_log
         (chit_id, entity_id, action, action_by_identity_id,
          action_by_display_name, detail)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [connection_id, entity_id, logAction,
         entity_id, req.identity.display_name, detail]
      ));

      // (Removed under B1 RLS, 2026-07-04) There used to be a second state_log INSERT here with
      // entity_id = the SENDER (conn.from_entity_id) — the responder writing into the OTHER entity's copy.
      // That violates "nobody writes another entity's data" (and RLS forbids it), AND it was dead data:
      // connection state_log rows are never surfaced (the notifications feed joins chit_status by chit_id, and
      // a connection has no chit_status row). The sender already learns of the response from the `connections`
      // table (status / responded_at) via GET /connections/list. If a sender-side timeline entry is ever wanted,
      // model it as a proper cross-notification (a chit, or a connection-scoped definer) — never a direct write.

      /* ⭐ b99 names `network.connect`. Metered only on ACCEPT — a refused request is not a connection, and
         billing for one would charge for being asked. */
      if (newStatus === 'accepted') {
        try { require('../lib/meter').meter(entity_id, 'network.connect', {
          detail: connection_id, rid: req.id }).catch(() => {}); } catch (_) {}
      }

      res.json({
        message: `Connection ${newStatus}`,
        connection_id,
        status: newStatus
      });

    } catch (err) {
      console.error('Connection respond error:', err.message);
      res.status(500).json({ error: 'Response failed', message: safeErr(err) });
    }
  }
);

// ─── GET /connections/list ────────────────────────────────────
// Get all accepted connections for current entity
router.get('/list', auth, async (req, res) => {
  try {
    const entity_id = req.identity.identity_id;

    const result = await query(
      `SELECT connection_id,
              CASE WHEN from_entity_id = $1
                   THEN to_entity_id ELSE from_entity_id END AS partner_entity_id,
              CASE WHEN from_entity_id = $1
                   THEN to_display_name ELSE from_display_name END AS partner_display_name,
              CASE WHEN from_entity_id = $1
                   THEN to_bridge_id ELSE from_bridge_id END AS partner_bridge_id,
              status, created_at, responded_at
       FROM connections
       WHERE (from_entity_id = $1 OR to_entity_id = $1)
       AND status = 'accepted'
       ORDER BY created_at DESC`,
      [entity_id]
    );

    res.json({
      connections: result.rows,
      count: result.rows.length
    });

  } catch (err) {
    console.error('Connections list error:', err.message);
    res.status(500).json({ error: 'Failed to get connections', message: safeErr(err) });
  }
});

module.exports = router;
