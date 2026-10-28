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
 *
 * OWNS      the seven routes of /api/service: read the clock · start it · record the response · record the resolution · pause · end a pause · answer the other side's pause (chit_sla, chit_sla_pause; b147)
 * CALLED BY server.js (app.use('/api/service')) · the web's SERVICE panel (cap-service.js: svcGet · svcSet · svcRespond · svcResolve · svcPause · svcPauseEnd · svcPauseAnswer)
 * FLOW  auth → schema check (lib/service-contract.js) → mine(): a chit this shop holds → the clock (lib/sla.js) over chit_sla / chit_sla_pause → res.json;
 *       a refusal → problem(req, res, { status, ...words.x() } | serviceFault(e, req)). A column that is not listed in RECORD_COLUMNS / PAUSE_COLUMNS never leaves (S34).
 * CARD  02-tasks-orders-and-workflow/README
 */
const express = require('express');
const crypto = require('crypto');
const router = express.Router();

const auth = require('../middleware/auth');
const { problem } = require('../lib/problem'); // API-STANDARD S1: the one error writer; each answer's old body is frozen in docs/contracts/api-legacy.json
const { withEntity, onEntity } = require('../db');
const sla = require('../lib/sla');
const { words, serviceFault, isOwnClaim, pick, RECORD_COLUMNS, PAUSE_COLUMNS, checked, pathsOf } = require('../lib/service-contract'); // the contract (each route's operation) and the words of a refusal

const ctx = (req) => auth.entityOf(req);

/** A chit I actually hold. Same gate the amend route uses — an id in a URL is not authority. */
/**
 * ⚠️ TAKES AN OPTIONAL CLIENT — `onEntity(id, db, fn)` runs on a transaction the caller already owns, or opens
 * its own when passed nothing (db/index.js). Every one of the eight existing callers passes nothing and is
 * untouched; the one that has a transaction in hand now shares it instead of opening a second.
 *
 * ⚠️ THE ALTERNATIVE WAS TO INLINE THIS QUERY at the one call site that needed it, which is how a check that
 * eight endpoints share becomes nine slightly different checks. One answerer, optionally hosted.
 */
async function mine(entity_id, chit_id, db) {
  const held = await onEntity(entity_id, db, (c) => c.query(`SELECT role FROM chit_header WHERE chit_id = $1 AND entity_id = $2`, [chit_id, entity_id]));
  return !!held.rows.length;
}

/** the lists a screen builds its pickers from — in every answer of the clock, tracked or not */
const pickersOf = () => ({ resolution_codes: sla.RESOLUTION_CODES, pause_reasons: sla.PAUSE_REASONS, impacts: sla.IMPACT, urgencies: sla.URGENCY });

/**
 * ⭐⭐ THREE TRANSACTIONS BECOME ONE. This opened one for the ownership check, then `Promise.all`'d TWO
 * more — twelve round trips, since `withEntity` costs four each (BEGIN · set_config · query · COMMIT).
 *
 * ⚠️ AND Promise.all WAS THE WRONG INSTINCT HERE, not just an inefficient one. The pool is max:10, so two
 * parallel transactions per request means five concurrent readers of this screen exhaust it and the sixth
 * queues. That trades a slow page for connection timeouts — a worse failure and much harder to diagnose.
 *
 * ⭐ HOW THIS ENDPOINT IS USED: `svcGet` — the SERVICE panel on an open chit (cap-service.js), 2 call
 * sites. It is opened per chit, so its cost is paid every time someone looks at a service request.
 *
 * ⚠️ THE OWNERSHIP CHECK STILL RUNS FIRST AND STILL SHORT-CIRCUITS. Sharing a transaction is not merging
 * the queries: a chit that is not yours still 404s before either SLA row is read.
 */
const readClock = (entity_id, chit_id) =>
  withEntity(entity_id, async (db) => {
    if (!(await mine(entity_id, chit_id, db))) return null;
    const record = await db.query(`SELECT * FROM chit_sla WHERE entity_id=$1 AND chit_id=$2`, [entity_id, chit_id]);
    const pauses = await db.query(
      `SELECT pause_id, paused_from, paused_to, reason, note, on_counterparty,
              claimed_by_entity_id, claimed_by_name, accepted, accepted_at, accepted_by
         FROM chit_sla_pause WHERE entity_id=$1 AND chit_id=$2 ORDER BY paused_from`,
      [entity_id, chit_id]
    );
    return { rec: record, pauses };
  });

/** the pauses as lib/sla reads them */
const pausesForClock = (rows) => rows.map((item) => ({ from: item.paused_from, to: item.paused_to, reason: item.reason, on_counterparty: item.on_counterparty, accepted: item.accepted }));

/** the clock of a tracked request: both ways, with the readable durations and the pauses (each marked as mine or theirs) */
function clockAnswer(entity_id, chit_id, row, pauseRows) {
  const clock = sla.clock({ raised_at: row.raised_at, responded_at: row.responded_at, resolved_at: row.resolved_at, priority: row.priority, impact: row.impact, urgency: row.urgency, policy: row.policy, pauses: pausesForClock(pauseRows) });
  return {
    tracked: true,
    chit_id,
    record: pick(row, RECORD_COLUMNS),
    clock,
    /* ⚠️ `mine` says which pauses I claimed, because the accept/reject control must not appear on my own —
       a party answering its own claim is refused in SQL, and offering a button that always errors is worse
       than not offering it. */
    pauses: pauseRows.map((item) => ({ ...pick(item, PAUSE_COLUMNS), mine: String(item.claimed_by_entity_id) === String(entity_id) })),
    readable: {
      respond: sla.readable(clock.as_agreed.respond_ms),
      resolve: sla.readable(clock.as_agreed.resolve_ms),
      contested_resolve: sla.readable(clock.contested.resolve_ms),
      disputed: sla.readable(clock.disputed_pause_ms)
    },
    ...pickersOf()
  };
}

/**
 * GET /api/service/:chit_id — the clock, computed BOTH WAYS.
 *
 * ⚠️ THE RESPONSE ALWAYS CARRIES as_agreed AND contested, even when they are identical. A screen that only saw one
 * number when the parties happen to agree would have no place to put the second when they stop agreeing, and the
 * disagreement is the entire point of the feature.
 */
async function getClock(req, res) {
  try {
    const entity_id = ctx(req);
    const chit_id = req.params.chit_id;
    const found = await readClock(entity_id, chit_id);
    if (!found) return problem(req, res, { status: 404, ...words.notFound() });
    const row = found.rec.rows[0] || null;
    if (!row) return res.json({ tracked: false, chit_id, ...pickersOf() });
    res.json(clockAnswer(entity_id, chit_id, row, found.pauses.rows));
  } catch (e) {
    problem(req, res, serviceFault(e, req));
  }
}
router.get('/:chit_id', auth, checked('GET /:chit_id'), getClock);

/** the one write of the clock's classification: start tracking, or change what is given (COALESCE keeps the rest) */
const upsertClock = (entity_id, chit_id, fields) =>
  withEntity(entity_id, (db) =>
    db.query(
      `INSERT INTO chit_sla (chit_id, entity_id, impact, urgency, priority, policy)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb)
         ON CONFLICT (entity_id, chit_id) DO UPDATE
            SET impact = COALESCE(EXCLUDED.impact, chit_sla.impact),
                urgency = COALESCE(EXCLUDED.urgency, chit_sla.urgency),
                priority = COALESCE(EXCLUDED.priority, chit_sla.priority),
                policy = COALESCE(EXCLUDED.policy, chit_sla.policy),
                updated_at = now()
         RETURNING *`,
      [chit_id, entity_id, fields.impact, fields.urgency, fields.priority, fields.policy ? JSON.stringify(fields.policy) : null]
    )
  );

/**
 * PUT /api/service/:chit_id — start tracking, or change impact/urgency.
 *
 * ⚠️ PRIORITY IS DERIVED, NOT TYPED. impact × urgency is the whole reason ITIL separates them; accepting a bare
 * priority would let every ticket be a P1 by assertion, which is exactly what the matrix exists to stop. An
 * explicit override is allowed but recorded as what it is.
 */
async function startClock(req, res) {
  try {
    const entity_id = ctx(req);
    const chit_id = req.params.chit_id;
    if (!(await mine(entity_id, chit_id))) return problem(req, res, { status: 404, ...words.notFound() });

    const impact = req.body.impact ? String(req.body.impact).toLowerCase() : null;
    const urgency = req.body.urgency ? String(req.body.urgency).toLowerCase() : null;
    let priority = sla.priorityOf(impact, urgency);
    if (!priority && req.body.priority) {
      const p = String(req.body.priority).toUpperCase();
      if (!sla.PRIORITIES.includes(p)) return problem(req, res, { status: 400, ...words.badPriority() });
      priority = p;
    }
    /* ⚠️ NOT REFUSED WHEN THERE IS NO PRIORITY YET. Tracking a request before anyone has classified it is the
       normal first minute of a service desk, and the clock still needs to start. lib/sla reports has_target
       false rather than pretending nothing is late. */
    const saved = await upsertClock(entity_id, chit_id, { impact, urgency, priority, policy: req.body.policy });
    res.json({ message: 'Service clock updated', record: pick(saved.rows[0], RECORD_COLUMNS) });
  } catch (e) {
    problem(req, res, serviceFault(e, req));
  }
}
router.put('/:chit_id', auth, checked('PUT /:chit_id'), startClock);

/** POST /:chit_id/respond — someone picked it up. Idempotent: the FIRST response is the one that counts. */
async function respond(req, res) {
  try {
    const entity_id = ctx(req);
    if (!(await mine(entity_id, req.params.chit_id))) return problem(req, res, { status: 404, ...words.notFound() });
    /* ⚠️ COALESCE, so a second tap does not move the response time later and quietly turn a met target into a
       breach — or the reverse. */
    const saved = await withEntity(entity_id, (db) =>
      db.query(
        `UPDATE chit_sla SET responded_at = COALESCE(responded_at, now()), updated_at = now()
        WHERE entity_id=$1 AND chit_id=$2 RETURNING responded_at`,
        [entity_id, req.params.chit_id]
      )
    );
    if (!saved.rows.length) return problem(req, res, { status: 404, ...words.notTracked() });
    res.json({ message: 'Response recorded', responded_at: saved.rows[0].responded_at });
  } catch (e) {
    problem(req, res, serviceFault(e, req));
  }
}
router.post('/:chit_id/respond', auth, checked('POST /:chit_id/respond'), respond);

/** POST /:chit_id/resolve — WHAT was done. Closure (did they accept it) is a separate act, deliberately. */
async function resolve(req, res) {
  try {
    const entity_id = ctx(req);
    if (!(await mine(entity_id, req.params.chit_id))) return problem(req, res, { status: 404, ...words.notFound() });
    const code = String(req.body.resolution_code);
    if (!sla.RESOLUTION_CODES.includes(code)) return problem(req, res, { status: 400, ...words.badResolution() });
    const saved = await withEntity(entity_id, (db) =>
      db.query(
        `UPDATE chit_sla SET resolved_at = COALESCE(resolved_at, now()), resolution_code = $3,
              resolution_note = $4, updated_at = now()
        WHERE entity_id=$1 AND chit_id=$2 RETURNING resolved_at, resolution_code`,
        [entity_id, req.params.chit_id, code, req.body.note ? String(req.body.note).slice(0, 500) : null]
      )
    );
    if (!saved.rows.length) return problem(req, res, { status: 404, ...words.notTracked() });
    res.json({ message: 'Resolution recorded', ...pick(saved.rows[0], ['resolved_at', 'resolution_code']) });
  } catch (e) {
    problem(req, res, serviceFault(e, req));
  }
}
router.post('/:chit_id/resolve', auth, checked('POST /:chit_id/resolve'), resolve);

/**
 * ⭐⭐ THREE TRANSACTIONS BECOME ONE — ownership, the already-paused check, and the write. Twelve round
 * trips, since `withEntity` costs four each (BEGIN · set_config · query · COMMIT, db/index.js).
 *
 * ⚠️⚠️ AND HERE IT IS A CORRECTNESS FIX, NOT ONLY A SPEED ONE. The "one open pause at a time" check and the
 * insert it guards ran in SEPARATE transactions, so two requests arriving together could both read zero
 * open pauses and both start one. lib/sla merges overlapping pauses from the same claimant, so the second
 * would look recorded and silently change nothing — the exact outcome the check exists to prevent. Inside
 * one transaction the read and the write are the same unit of work.
 *
 * ⭐ HOW THIS ENDPOINT IS USED: `svcPause` — the PAUSE button on the service panel of an open chit
 * (cap-service.js). One call site, and it is the write that the whole SLA clock hangs off.
 */
const startPause = (entity_id, chit_id, pause_id, reason, body) =>
  withEntity(entity_id, async (db) => {
    if (!(await mine(entity_id, chit_id, db))) return { notFound: true };

    /* ⚠️ ONE OPEN PAUSE AT A TIME, PER CLAIMANT. Two open pauses from the same party overlap by construction,
       and lib/sla would merge them into one — so the second would look recorded and change nothing. */
    const open = await db.query(
      `SELECT pause_id FROM chit_sla_pause
          WHERE entity_id=$1 AND chit_id=$2 AND paused_to IS NULL AND claimed_by_entity_id=$1 LIMIT 1`,
      [entity_id, chit_id]
    );
    if (open.rows.length) return { already: true };

    const n = await db.query(`SELECT chit_sla_pause_start($1,$2,$3,$4,$5,$6) AS copies`, [chit_id, pause_id, body.from || null, reason, body.note ? String(body.note).slice(0, 300) : null, body.on_counterparty === true]);
    return { copies: n.rows[0].copies };
  });

/**
 * ⭐ POST /:chit_id/pause — stop the clock, and say on whom.
 *
 * ⚠️ THIS WRITES INTO EVERY PARTICIPANT'S COPY via the b147 SECURITY DEFINER function, gated the same way
 * chit_line_deliver is. A pause only I can see is not a disputable fact — it is my private opinion about time,
 * which is what every other service desk already has.
 */
async function pauseClock(req, res) {
  try {
    const entity_id = ctx(req);
    /* ⚠️ THE CHEAP REFUSAL FIRST — a bad reason needs no database at all, so it is checked before any
       connection is taken. Validating after opening a transaction pays for a round trip to say "no". */
    const reason = String(req.body.reason);
    if (!sla.PAUSE_REASONS.includes(reason)) return problem(req, res, { status: 400, ...words.badReason() });

    const pause_id = crypto.randomUUID();
    const out = await startPause(entity_id, req.params.chit_id, pause_id, reason, req.body);
    if (out.notFound) return problem(req, res, { status: 404, ...words.notFound() });
    if (out.already) return problem(req, res, { status: 409, ...words.alreadyPaused() });
    res.json({ message: 'Clock paused', pause_id, copies: out.copies });
  } catch (e) {
    problem(req, res, serviceFault(e, req));
  }
}
router.post('/:chit_id/pause', auth, checked('POST /:chit_id/pause'), pauseClock);

/** POST /:chit_id/pause/:pause_id/end — restart the clock. */
async function endPause(req, res) {
  try {
    const entity_id = ctx(req);
    if (!(await mine(entity_id, req.params.chit_id))) return problem(req, res, { status: 404, ...words.notFound() });
    const n = await withEntity(entity_id, (db) => db.query(`SELECT chit_sla_pause_end($1,$2,$3) AS copies`, [req.params.chit_id, req.params.pause_id, req.body.to || null]));
    /* ⚠️ ZERO COPIES MEANS THE PAUSE WAS ALREADY CLOSED — said plainly rather than reported as success. Re-ending
       silently would let someone believe they had corrected an end time that never moved. */
    if (!Number(n.rows[0].copies)) return problem(req, res, { status: 409, ...words.notOpen() });
    res.json({ message: 'Clock restarted', copies: n.rows[0].copies });
  } catch (e) {
    problem(req, res, serviceFault(e, req));
  }
}
router.post('/:chit_id/pause/:pause_id/end', auth, checked('POST /:chit_id/pause/:pause_id/end'), endPause);

/**
 * ⭐⭐ POST /:chit_id/pause/:pause_id/answer — accept or reject the OTHER side's pause.
 *
 * This is the disagreement, made into a fact. Everything else in this file is bookkeeping; this is the feature.
 */
async function answerPause(req, res) {
  try {
    const entity_id = ctx(req);
    if (!(await mine(entity_id, req.params.chit_id))) return problem(req, res, { status: 404, ...words.notFound() });
    const n = await withEntity(entity_id, (db) =>
      db.query(`SELECT chit_sla_pause_answer($1,$2,$3,$4) AS copies`, [req.params.chit_id, req.params.pause_id, req.body.accepted === true, req.identity.display_name || null])
    );
    res.json({ message: req.body.accepted === true ? 'Pause accepted' : 'Pause rejected — the clock is now contested', copies: n.rows[0].copies });
  } catch (e) {
    /* The SQL refuses a party answering its own claim. That is a deliberate rule, not an internal failure, so it
       must not come back as a 500 the caller cannot act on. */
    if (isOwnClaim(e)) return problem(req, res, { status: 409, ...words.ownClaim() });
    problem(req, res, serviceFault(e, req));
  }
}
router.post('/:chit_id/pause/:pause_id/answer', auth, checked('POST /:chit_id/pause/:pause_id/answer'), answerPause);

router.openapi = { paths: pathsOf(), schemas: {} };

module.exports = router;
