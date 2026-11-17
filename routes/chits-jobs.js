'use strict';
// routes/chits-jobs.js — POST /api/chits/jobs/open: open one job chit per client (the first consumer of the generic assign capability)
/**
 * OWNS      POST /api/chits/jobs/open (a part of routes/chits.js, mounted by it under /api/chits)
 * CALLED BY routes/chits.js (router.use) · the practice screen's "Open jobs" button (web)
 * FLOW      auth → the partner/manager gate (lib/owner managerGate, BEFORE any body is read) → schema check (lib/chits-jobs-contract) → the per-business limiter → lib/jobs-open (the existing send path, the auto door) → the counts
 * CARD      01-rail-core-the-chit/assign
 * It holds no business rule of its own: who may open is lib/owner mayAt, which clients are eligible is the books' own grant verdict, the send, the seal and the holder are the rail's. NOT all-or-nothing (each send is its
 * own transaction across two parties' copies); the answer says what happened per subject and a partial run is finished by calling again.
 */
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { problem } = require('../lib/problem');
const { managerGate } = require('../lib/owner');
const { schemaValidate } = require('../middleware/validate');
const { rateLimit } = require('../lib/rate-limit');
const { failed } = require('../lib/chits-contract');
const contract = require('../lib/chits-jobs-contract');
const { openJobs } = require('../lib/jobs-open');

/* one call holds up to 200 sends: a button pressed twice is a retry, not an attack. Per business, 10 a minute (the global /api floor proves nothing for this door) */
const openLimiter = rateLimit({
  name: 'jobs-open',
  windowMs: 60 * 1000,
  max: Number(process.env.JOBS_OPEN_PER_MIN) || 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => 'jobs-open:' + String((req.identity && (req.identity.parent_entity_id || req.identity.identity_id)) || 'nobody'),
  message: { error: 'Too many requests', message: 'Open the jobs again in a minute.' }
});

openLimiter.addsStatuses = [429]; /* tools/api-register.cjs reads the status a gate answers from here (the limiter answers RATE_LIMITED itself) */

// @does A plug, a role, a period and a set of clients (a list or a filter) in -> we open one job per client through the existing send path and hand each to whoever your assignment rule picks; a repeat opens nothing twice -> the counts, what was skipped and why, and the jobs.
router.post('/jobs/open', auth, managerGate(), schemaValidate(contract.operationFor('POST /jobs/open')), openLimiter, async (req, res) => {
  try {
    const firm = auth.entityOf(req);
    const { plug, role, period, subject_ids, filter } = req.body;
    const opened = await openJobs({ firm, plug, role, period, subject_ids, filter });
    res.json(opened);
  } catch (err) {
    if (err && err.status === 400 && err.code === 'CHIT_TOO_MANY') {
      return problem(req, res, { status: 400, code: 'CHIT_TOO_MANY', detail: err.message, legacy: { error: 'Too many', message: err.message } });
    }
    console.error('Open jobs error:', err && err.message);
    problem(req, res, failed(err, req, 'Opening the jobs failed'));
  }
});

router.contract = contract;
module.exports = router;
