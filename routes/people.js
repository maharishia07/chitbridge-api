'use strict';
/**
 * routes/people.js — P1: GET /api/people, the shop's people for the Employees app. ONE read, ONE trip.
 *
 * The five actions (add · what they can do · reset code · switch off/on · cover) are NOT wrapped: routes/actors.js already
 * has them — POST /, PATCH /:id, DELETE /:id/pin, PUT /:id/status, PUT /:id/delegate — and the screen calls those. This route
 * only answers "who, and what may THIS login do to each" (lib/people.js), so a refused action is greyed WITH its sentence.
 * A person can read the list (colleagues); every action is then refused with the owner-only sentence. The actions still
 * refuse on their own — this is never the check, only the early word.
 */
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { query } = require('../db');
const { isOwner } = require('../lib/owner');
const people = require('../lib/people');
const { safeErr } = require('../lib/respond');

router.get('/', auth, async (req, res) => {
  try {
    /* ?for=add — the Add-a-person form only needs may/why + the picker: no list is read (no query past auth) */
    if (req.query.for === 'add') return res.json(people.addView({ owner: isOwner(req) }));
    const entity_id = auth.entityOf(req);
    /* one statement: the shop's human people (not removed) and the owner's handle for the user-id fallback.
       access_level / whole_entity are b173 columns — the row is read with `to_jsonb` so a shop that has not had it yet
       still answers (the level then comes from the old hat, lib/access.js). */
    /* CX6 (E1): the shop row is the left side, so its country comes back even with no people yet (one row, identity_id null) */
    const r = await query(
      `SELECT i.identity_id, i.display_name, i.actor_key, i.user_id, i.actor_role, i.phone, i.hat, i.break_status,
              i.can_see_costs, i.current_task_count, i.last_active_at, i.delegate_actor_id,
              (to_jsonb(i)->>'access_level') AS access_level, ((to_jsonb(i)->>'whole_entity')::boolean) AS whole_entity,
              i.email, (i.email IS NOT NULL AND i.email <> '') AS has_email,
              e.user_id AS entity_handle, e.country AS entity_country
         FROM identities e
         LEFT JOIN identities i ON i.parent_entity_id = e.identity_id AND ${people.peopleSql('i')}
        WHERE e.identity_id = $1
        ORDER BY (i.break_status = 'deactivated'), i.display_name`,
      [entity_id]);
    const country = r.rows[0] && r.rows[0].entity_country;
    const view = people.view(r.rows.filter((x) => x.identity_id), { owner: isOwner(req), country });
    res.json(Object.assign(view, PL.pageOut('people', view.people, PL.pageArgs(req.query, PAGE_DEFAULT, PAGE_MAX))));
  } catch (err) {
    console.error('List people error:', err.message);
    res.status(500).json({ error: 'Failed to list people', message: safeErr(err) });
  }
});

module.exports = router;
