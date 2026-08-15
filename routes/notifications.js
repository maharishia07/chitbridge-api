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
      /**
       * ⚠️ DISTINCT ON, BECAUSE chit_status HOLDS TWO ROWS PER ENTITY ON A SELF-CHIT.
       *
       * Athi, 2026-08-15: *"does it make sense?"* — it did not. Measured live: 30 rows for 27 events, the same
       * delivery listed twice, because the JOIN below matches BOTH the sent and received copy and nothing
       * collapsed them. A person reading this feed would count two deliveries where one happened.
       *
       * ⚠️ AND THIS IS THE FOURTH PLACE TODAY. The worklist showed every person double, b150 wrote every delivery
       * twice, the message inbox needed a LATERAL, and now this. Any join to chit_header or chit_status without
       * a direction filter or a LIMIT 1 is doubling something.
       */
      /* ⚠️ WRAPPED. DISTINCT ON forces its own keys to lead the ORDER BY, which would hand back a feed grouped
         by chit instead of newest-first. Dedupe inside, sort outside, LIMIT outside — in that order, or the LIMIT
         truncates a chit-ordered list and the newest events fall off the end. */
      `SELECT * FROM (
        SELECT DISTINCT ON (sl.chit_id, sl.action, sl.created_at, sl.detail)
              sl.chit_id, sl.action, sl.action_by_display_name,
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
        ORDER BY sl.chit_id, sl.action, sl.created_at DESC, sl.detail
      ) d
      ORDER BY d.created_at DESC
      LIMIT $4`,
      [entity_id, caller_id, dispute_handler, limit]
    ));

    /**
     * ⭐ THE BADGE COUNTS WHAT ARRIVED SINCE YOU LAST LOOKED — b157.
     *
     * ⚠️ THE COUNT USED TO BE result.rows.length, i.e. "how many recent events exist", capped by the LIMIT. It
     * read 30 forever whatever you did, and a badge that cannot reach zero is one people stop reading — after
     * which the real event arrives wearing the same number as the noise.
     *
     * Read through to_jsonb so the column may not exist yet: before b157 every row counts as new, which is
     * exactly what the old behaviour was, so an unmigrated environment is no worse off than it is today.
     */
    let seen = null;
    try {
      const s = await withEntity(entity_id, (c) => c.query(
        `SELECT to_jsonb(i)->>'notif_seen_at' AS seen FROM identities i WHERE i.identity_id = $1`, [entity_id]));
      seen = s.rows[0] && s.rows[0].seen;
    } catch (e) { /* pre-b157 — leave seen null and every row counts as new */ }
    const fresh = seen ? result.rows.filter((r) => new Date(r.created_at) > new Date(seen)).length
                       : result.rows.length;
    res.json({ notifications: result.rows, count: fresh, total: result.rows.length, seen_at: seen });
  } catch (err) {
    console.error('Notifications error:', err.message);
    res.status(500).json({ error: 'Failed to get notifications', message: safeErr(err) });
  }
});

/**
 * POST /api/notifications/seen — move the watermark to now.
 *
 * ⚠️ NO PARAMETER, AND THAT IS THE POINT. b157's definer takes the entity from the session, so a caller cannot
 * clear somebody else's badge. A small thing, but a badge you can silently clear for another person is a badge
 * nobody can trust.
 */
router.post('/seen', auth, async (req, res) => {
  try {
    const entity_id = auth.entityOf(req);
    const r = await withEntity(entity_id, (c) => c.query('SELECT notif_mark_seen() AS at'));
    res.json({ ok: true, seen_at: r.rows[0] && r.rows[0].at });
  } catch (err) {
    /* Pre-b157 the function does not exist. Say so plainly rather than 500 — the panel still opens and still
       lists everything; only the badge cannot yet be cleared. */
    if (err && err.code === '42883') {
      return res.status(503).json({ error: 'Not migrated', message: 'Clearing the badge needs b157 on this environment.' });
    }
    console.error('notif seen:', err.message);
    res.status(500).json({ error: 'Failed', message: safeErr(err) });
  }
});

module.exports = router;
