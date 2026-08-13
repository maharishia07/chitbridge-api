'use strict';
/**
 * routes/service.js — a chit AS A SERVICE REQUEST. The clock, and the pause that gets argued about.
 *
 * Athi, 2026-08-13: *"are you not bridging the gap for ITIL? the SLA clock cycle or whatever required?"* — and he
 * was right to push. The arithmetic (lib/sla.js) and the storage (b147) existed; the module did not.
 *
 * ⚠️ EVERY ROUTE DEGRADES BEFORE THE MIGRATION. b147 lands when Athi runs it, and the API deploys first — so a
 * missing table answers "not migrated" plainly rather than throwing a 500 that reads like a bug in the feature.
 * This has cost two evenings already: a swallowed 42P01 sent him back to the SQL editor twice for migrations that
 * had applied perfectly.
 */
const express = require('express');
const { body } = require('express-validator');
const crypto = require('crypto');
const router = express.Router();

const auth = require('../middleware/auth');
const { validate } = require('../middleware/validate');   // ⚠️ a NAMED export — the default is the module object
const { withEntity } = require('../db');
const sla = require('../lib/sla');
const safeErr = (e) => (e && e.message) || 'Something went wrong';

const notMigrated = (e) => e && (e.code === '42P01' || e.code === '42703' || e.code === '42883');
const gone = (res) => res.status(503).json({ error: 'Not migrated',
  message: 'The service clock needs b147 on this environment.' });
const ctx = (req) => auth.entityOf(req);

/** A chit I actually hold. Same gate the amend route uses — an id in a URL is not authority. */
async function mine(entity_id, chit_id) {
  const r = await withEntity(entity_id, (db) => db.query(
    `SELECT role FROM chit_header WHERE chit_id = $1 AND entity_id = $2`, [chit_id, entity_id]));
  return !!r.rows.length;
}

/**
 * GET /api/service/:chit_id — the clock, computed BOTH WAYS.
 *
 * ⚠️ THE RESPONSE ALWAYS CARRIES as_agreed AND contested, even when they are identical. A screen that only saw one
 * number when the parties happen to agree would have no place to put the second when they stop agreeing, and the
 * disagreement is the entire point of the feature.
 */
router.get('/:chit_id', auth, async (req, res) => {
  try {
    const entity_id = ctx(req);
    const chit_id = req.params.chit_id;
    if (!(await mine(entity_id, chit_id))) return res.status(404).json({ error: 'Not found' });

    const [rec, pauses] = await Promise.all([
      withEntity(entity_id, (db) => db.query(`SELECT * FROM chit_sla WHERE entity_id=$1 AND chit_id=$2`, [entity_id, chit_id])),
      withEntity(entity_id, (db) => db.query(
        `SELECT pause_id, paused_from, paused_to, reason, note, on_counterparty,
                claimed_by_entity_id, claimed_by_name, accepted, accepted_at, accepted_by
           FROM chit_sla_pause WHERE entity_id=$1 AND chit_id=$2 ORDER BY paused_from`, [entity_id, chit_id])),
    ]);

    const r = rec.rows[0] || null;
    if (!r) return res.json({ tracked: false, chit_id, resolution_codes: sla.RESOLUTION_CODES,
      pause_reasons: sla.PAUSE_REASONS, impacts: sla.IMPACT, urgencies: sla.URGENCY });

    const clock = sla.clock({
      raised_at: r.raised_at, responded_at: r.responded_at, resolved_at: r.resolved_at,
      priority: r.priority, impact: r.impact, urgency: r.urgency, policy: r.policy,
      pauses: pauses.rows.map((p) => ({ from: p.paused_from, to: p.paused_to, reason: p.reason,
        on_counterparty: p.on_counterparty, accepted: p.accepted })),
    });

    res.json({ tracked: true, chit_id, record: r, clock,
      /* ⚠️ `mine` says which pauses I claimed, because the accept/reject control must not appear on my own —
         a party answering its own claim is refused in SQL, and offering a button that always errors is worse
         than not offering it. */
      pauses: pauses.rows.map((p) => ({ ...p, mine: String(p.claimed_by_entity_id) === String(entity_id) })),
      readable: { respond: sla.readable(clock.as_agreed.respond_ms), resolve: sla.readable(clock.as_agreed.resolve_ms),
                  contested_resolve: sla.readable(clock.contested.resolve_ms),
                  disputed: sla.readable(clock.disputed_pause_ms) },
      resolution_codes: sla.RESOLUTION_CODES, pause_reasons: sla.PAUSE_REASONS,
      impacts: sla.IMPACT, urgencies: sla.URGENCY });
  } catch (e) { if (notMigrated(e)) return gone(res); console.error('service get:', e.message);
    res.status(500).json({ error: 'Failed', message: safeErr(e) }); }
});

/**
 * PUT /api/service/:chit_id — start tracking, or change impact/urgency.
 *
 * ⚠️ PRIORITY IS DERIVED, NOT TYPED. impact × urgency is the whole reason ITIL separates them; accepting a bare
 * priority would let every ticket be a P1 by assertion, which is exactly what the matrix exists to stop. An
 * explicit override is allowed but recorded as what it is.
 */
router.put('/:chit_id', auth,
  [ body('impact').optional().isString(), body('urgency').optional().isString(),
    body('priority').optional().isString() ],
  validate,
  async (req, res) => {
    try {
      const entity_id = ctx(req);
      const chit_id = req.params.chit_id;
      if (!(await mine(entity_id, chit_id))) return res.status(404).json({ error: 'Not found' });

      const impact = req.body.impact ? String(req.body.impact).toLowerCase() : null;
      const urgency = req.body.urgency ? String(req.body.urgency).toLowerCase() : null;
      let priority = sla.priorityOf(impact, urgency);
      if (!priority && req.body.priority) {
        const p = String(req.body.priority).toUpperCase();
        if (!sla.PRIORITIES.includes(p)) return res.status(400).json({ error: 'Bad priority',
          message: 'priority must be one of: ' + sla.PRIORITIES.join(', ') });
        priority = p;
      }
      /* ⚠️ NOT REFUSED WHEN THERE IS NO PRIORITY YET. Tracking a request before anyone has classified it is the
         normal first minute of a service desk, and the clock still needs to start. lib/sla reports has_target
         false rather than pretending nothing is late. */
      const r = await withEntity(entity_id, (db) => db.query(
        `INSERT INTO chit_sla (chit_id, entity_id, impact, urgency, priority, policy)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb)
         ON CONFLICT (entity_id, chit_id) DO UPDATE
            SET impact = COALESCE(EXCLUDED.impact, chit_sla.impact),
                urgency = COALESCE(EXCLUDED.urgency, chit_sla.urgency),
                priority = COALESCE(EXCLUDED.priority, chit_sla.priority),
                policy = COALESCE(EXCLUDED.policy, chit_sla.policy),
                updated_at = now()
         RETURNING *`,
        [chit_id, entity_id, impact, urgency, priority,
         req.body.policy ? JSON.stringify(req.body.policy) : null]));
      res.json({ message: 'Service clock updated', record: r.rows[0] });
    } catch (e) { if (notMigrated(e)) return gone(res); console.error('service put:', e.message);
      res.status(500).json({ error: 'Failed', message: safeErr(e) }); }
  });

/** POST /:chit_id/respond — someone picked it up. Idempotent: the FIRST response is the one that counts. */
router.post('/:chit_id/respond', auth, async (req, res) => {
  try {
    const entity_id = ctx(req);
    if (!(await mine(entity_id, req.params.chit_id))) return res.status(404).json({ error: 'Not found' });
    /* ⚠️ COALESCE, so a second tap does not move the response time later and quietly turn a met target into a
       breach — or the reverse. */
    const r = await withEntity(entity_id, (db) => db.query(
      `UPDATE chit_sla SET responded_at = COALESCE(responded_at, now()), updated_at = now()
        WHERE entity_id=$1 AND chit_id=$2 RETURNING responded_at`, [entity_id, req.params.chit_id]));
    if (!r.rows.length) return res.status(404).json({ error: 'Not tracked', message: 'Start the service clock first.' });
    res.json({ message: 'Response recorded', responded_at: r.rows[0].responded_at });
  } catch (e) { if (notMigrated(e)) return gone(res); res.status(500).json({ error: 'Failed', message: safeErr(e) }); }
});

/** POST /:chit_id/resolve — WHAT was done. Closure (did they accept it) is a separate act, deliberately. */
router.post('/:chit_id/resolve', auth, [ body('resolution_code').isString() ], validate, async (req, res) => {
  try {
    const entity_id = ctx(req);
    if (!(await mine(entity_id, req.params.chit_id))) return res.status(404).json({ error: 'Not found' });
    const code = String(req.body.resolution_code);
    if (!sla.RESOLUTION_CODES.includes(code)) return res.status(400).json({ error: 'Bad resolution',
      message: 'resolution_code must be one of: ' + sla.RESOLUTION_CODES.join(', ') });
    const r = await withEntity(entity_id, (db) => db.query(
      `UPDATE chit_sla SET resolved_at = COALESCE(resolved_at, now()), resolution_code = $3,
              resolution_note = $4, updated_at = now()
        WHERE entity_id=$1 AND chit_id=$2 RETURNING resolved_at, resolution_code`,
      [entity_id, req.params.chit_id, code, req.body.note ? String(req.body.note).slice(0, 500) : null]));
    if (!r.rows.length) return res.status(404).json({ error: 'Not tracked', message: 'Start the service clock first.' });
    res.json({ message: 'Resolution recorded', ...r.rows[0] });
  } catch (e) { if (notMigrated(e)) return gone(res); res.status(500).json({ error: 'Failed', message: safeErr(e) }); }
});

/**
 * ⭐ POST /:chit_id/pause — stop the clock, and say on whom.
 *
 * ⚠️ THIS WRITES INTO EVERY PARTICIPANT'S COPY via the b147 SECURITY DEFINER function, gated the same way
 * chit_line_deliver is. A pause only I can see is not a disputable fact — it is my private opinion about time,
 * which is what every other service desk already has.
 */
router.post('/:chit_id/pause', auth, [ body('reason').isString() ], validate, async (req, res) => {
  try {
    const entity_id = ctx(req);
    const chit_id = req.params.chit_id;
    if (!(await mine(entity_id, chit_id))) return res.status(404).json({ error: 'Not found' });
    const reason = String(req.body.reason);
    if (!sla.PAUSE_REASONS.includes(reason)) return res.status(400).json({ error: 'Bad reason',
      message: 'reason must be one of: ' + sla.PAUSE_REASONS.join(', ') });

    /* ⚠️ ONE OPEN PAUSE AT A TIME, PER CLAIMANT. Two open pauses from the same party overlap by construction, and
       lib/sla would merge them into one — so the second would look recorded and change nothing. Refuse instead. */
    const open = await withEntity(entity_id, (db) => db.query(
      `SELECT pause_id FROM chit_sla_pause
        WHERE entity_id=$1 AND chit_id=$2 AND paused_to IS NULL AND claimed_by_entity_id=$1 LIMIT 1`,
      [entity_id, chit_id]));
    if (open.rows.length) return res.status(409).json({ error: 'Already paused',
      message: 'This request is already paused by you — end that pause before starting another.' });

    const pause_id = crypto.randomUUID();
    const n = await withEntity(entity_id, (db) => db.query(
      `SELECT chit_sla_pause_start($1,$2,$3,$4,$5,$6) AS copies`,
      [chit_id, pause_id, req.body.from || null, reason,
       req.body.note ? String(req.body.note).slice(0, 300) : null,
       req.body.on_counterparty === true]));
    res.json({ message: 'Clock paused', pause_id, copies: n.rows[0].copies });
  } catch (e) { if (notMigrated(e)) return gone(res); console.error('service pause:', e.message);
    res.status(500).json({ error: 'Failed', message: safeErr(e) }); }
});

/** POST /:chit_id/pause/:pause_id/end — restart the clock. */
router.post('/:chit_id/pause/:pause_id/end', auth, async (req, res) => {
  try {
    const entity_id = ctx(req);
    if (!(await mine(entity_id, req.params.chit_id))) return res.status(404).json({ error: 'Not found' });
    const n = await withEntity(entity_id, (db) => db.query(
      `SELECT chit_sla_pause_end($1,$2,$3) AS copies`,
      [req.params.chit_id, req.params.pause_id, req.body.to || null]));
    /* ⚠️ ZERO COPIES MEANS THE PAUSE WAS ALREADY CLOSED — said plainly rather than reported as success. Re-ending
       silently would let someone believe they had corrected an end time that never moved. */
    if (!Number(n.rows[0].copies)) return res.status(409).json({ error: 'Not open',
      message: 'That pause is already ended — its end time cannot be moved.' });
    res.json({ message: 'Clock restarted', copies: n.rows[0].copies });
  } catch (e) { if (notMigrated(e)) return gone(res); res.status(500).json({ error: 'Failed', message: safeErr(e) }); }
});

/**
 * ⭐⭐ POST /:chit_id/pause/:pause_id/answer — accept or reject the OTHER side's pause.
 *
 * This is the disagreement, made into a fact. Everything else in this file is bookkeeping; this is the feature.
 */
router.post('/:chit_id/pause/:pause_id/answer', auth, [ body('accepted').isBoolean() ], validate, async (req, res) => {
  try {
    const entity_id = ctx(req);
    if (!(await mine(entity_id, req.params.chit_id))) return res.status(404).json({ error: 'Not found' });
    const n = await withEntity(entity_id, (db) => db.query(
      `SELECT chit_sla_pause_answer($1,$2,$3,$4) AS copies`,
      [req.params.chit_id, req.params.pause_id, req.body.accepted === true,
       req.identity.display_name || null]));
    res.json({ message: req.body.accepted === true ? 'Pause accepted' : 'Pause rejected — the clock is now contested',
      copies: n.rows[0].copies });
  } catch (e) {
    /* The SQL refuses a party answering its own claim. That is a deliberate rule, not an internal failure, so it
       must not come back as a 500 the caller cannot act on. */
    if (/cannot answer its own/.test(e.message || '')) {
      return res.status(409).json({ error: 'Your own claim',
        message: 'You raised this pause — the other party is the one who accepts or rejects it.' });
    }
    if (notMigrated(e)) return gone(res);
    console.error('service answer:', e.message);
    res.status(500).json({ error: 'Failed', message: safeErr(e) });
  }
});

module.exports = router;
