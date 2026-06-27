// routes/notifications.js — derived notification feed (no notifications table).
// Computed from state_log: recent activity by OTHERS on chits I am a party to.
const express = require('express');
const router = express.Router();
const { query } = require('../db');
const auth = require('../middleware/auth');

// GET /api/notifications?limit= — recent activity (newest first) on my chits, excluding my own actions.
router.get('/', auth, async (req, res) => {
  try {
    const entity_id = req.identity.parent_entity_id || req.identity.identity_id;
    const limit = Math.min(parseInt(req.query.limit || 30), 100);

    const result = await query(
      `SELECT sl.chit_id, sl.action, sl.action_by_display_name,
              sl.new_status, sl.detail, sl.created_at,
              ch.auto_subject, ch.manual_subject
         FROM state_log sl
         JOIN chit_status cs
           ON cs.chit_id = sl.chit_id AND cs.entity_id = $1 AND cs.deleted_at IS NULL
         LEFT JOIN chit_header ch
           ON ch.chit_id = sl.chit_id AND ch.entity_id = $1
        WHERE sl.action_by_identity_id <> $1
        ORDER BY sl.created_at DESC
        LIMIT $2`,
      [entity_id, limit]
    );

    res.json({ notifications: result.rows, count: result.rows.length });
  } catch (err) {
    console.error('Notifications error:', err.message);
    res.status(500).json({ error: 'Failed to get notifications', message: err.message });
  }
});

module.exports = router;
