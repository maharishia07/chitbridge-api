// routes/notifications.js — derived notification feed (no notifications table).
// Computed from state_log: recent activity by OTHERS on chits I am a party to.
const express = require('express');
const router = express.Router();
const { safeErr } = require('../lib/respond');
const { query, withEntity } = require('../db');
const auth = require('../middleware/auth');

// GET /api/notifications?limit= — recent activity (newest first) on my chits, excluding my own actions.
router.get('/', auth, async (req, res) => {
  try {
    const entity_id = auth.entityOf(req);
    const caller_id = req.identity.identity_id;   // the actor (or entity) actually making the call
    const limit = Math.min(parseInt(req.query.limit || 30), 100);

    // Entity-level "dispute team": an actor who receives ALL disputes for this entity,
    // regardless of which actor the individual chit is assigned to.
    const h = await query(`SELECT dispute_handler_actor_id FROM identities WHERE identity_id = $1`, [entity_id]);
    const dispute_handler = h.rows[0]?.dispute_handler_actor_id || null;

    // B1 RLS: the feed reads the caller's OWN state_log copy — cross-party events (status/dispute/void) are already
    // fanned into it by the definers — so it scopes cleanly to withEntity(me). (The `OR action IN (...)` branch is a
    // harmless no-op under RLS, since non-own rows aren't visible anyway.)
    const result = await withEntity(entity_id, (c) => c.query(
      `SELECT sl.chit_id, sl.action, sl.action_by_display_name,
              sl.new_status, sl.detail, sl.created_at, cs.direction,
              cs.assigned_to_actor_id,
              ch.auto_subject, ch.manual_subject,
              (cs.assigned_to_actor_id = $2)                                           AS assigned_to_me,
              (sl.action IN ('dispute_raised','dispute_resolved') AND $2 = $3) AS dispute_for_me
         FROM state_log sl
         JOIN chit_status cs
           ON cs.chit_id = sl.chit_id AND cs.entity_id = $1 AND cs.deleted_at IS NULL
         LEFT JOIN chit_header ch
           ON ch.chit_id = sl.chit_id AND ch.entity_id = $1 AND ch.direction = cs.direction
        WHERE (sl.action_by_identity_id <> $2
               OR sl.action IN ('dispute_raised','dispute_resolved','voided'))
          -- F3 (P0 isolation): only the caller's OWN copy's state_log row, OR a genuinely cross-party event.
          -- Stops the counterparty's INTERNAL actions (read / archive / delete / restore / internal assign +
          -- their actor names) leaking into this feed; disputes/voids still cross. Status changes already fan a
          -- row to each copy (chits.js:688), so a counterparty status change still shows via the caller's own row.
          AND ( sl.entity_id = $1 OR sl.action IN ('dispute_raised','dispute_resolved','voided') )
        ORDER BY sl.created_at DESC
        LIMIT $4`,
      [entity_id, caller_id, dispute_handler, limit]
    ));

    res.json({ notifications: result.rows, count: result.rows.length });
  } catch (err) {
    console.error('Notifications error:', err.message);
    res.status(500).json({ error: 'Failed to get notifications', message: safeErr(err) });
  }
});

module.exports = router;
