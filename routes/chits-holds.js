'use strict';
// routes/chits-holds.js — what a person holds (GET /api/chits/holds), my work (GET /api/chits/my-work), hand over all (POST /api/chits/hand-over-all)
/**
 * OWNS      the three routes (a part of routes/chits.js, mounted by it under /api/chits, BEFORE /:chit_id)
 * CALLED BY routes/chits.js (router.use) · the Employees screen (Holds column, Hand over all…) · the Home strip and the Mine view (web, after CBAssign v2)
 * FLOW      auth → (holds, hand-over: the partner/manager gate, lib/owner managerGate, BEFORE any body is read) → schema check (lib/chits-holds-contract) → lib/assign-holds → res.json; a refusal → problem()
 * CARD      01-rail-core-the-chit/assign
 * No holder is written here: hand-over goes through lib/assign-bulk (the ONE assign writer) and the one follow-up mover; the count and the list read the one held rule (lib/assign-chit openHeldWhere).
 */
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { problem } = require('../lib/problem');
const { managerGate } = require('../lib/owner');
const { schemaValidate } = require('../middleware/validate');
const { withEntity } = require('../db');
const { failed } = require('../lib/chits-contract');
const contract = require('../lib/chits-holds-contract');
const holds = require('../lib/assign-holds');
const PL = require('../lib/page-limit');

const MY_WORK_DEFAULT = 50, MY_WORK_MAX = 200; /* one page of my work: the clamp that was spelled in lib/assign-holds, now the ONE pager's */

const checked = (route) => schemaValidate(contract.operationFor(route));

// @does Optionally one person in -> we count what each person of your shop holds open across tasks, clients and follow-ups -> a row per person with the counts per kind of work (partner or manager).
router.get('/holds', auth, managerGate(), checked('GET /holds'), async (req, res) => {
  try {
    res.json(await holds.holdsAnswer(auth.entityOf(req), req.query.actor_id));
  } catch (err) {
    problem(req, res, failed(err, req, 'Reading what people hold failed'));
  }
});

// @does Nothing in -> we list what you hold open, per kind of work, newest first, with one count -> total, the count per kind and the rows.
router.get('/my-work', auth, checked('GET /my-work'), async (req, res) => {
  try {
    const entity = auth.entityOf(req);
    const mine = await withEntity(entity, (client) => holds.myWork(client, entity, req.identity.identity_id, PL.limitOf(req.query.limit, MY_WORK_DEFAULT, MY_WORK_MAX)));
    res.json({ total: mine.total, plugs: mine.by_plug, rows: mine.rows });
  } catch (err) {
    problem(req, res, failed(err, req, 'Reading your work failed'));
  }
});

// @does A person and where their work goes (a colleague, or the pool) in -> we move everything they hold open through the one assign writer -> the counts, what was skipped and why, and who held each item before.
router.post('/hand-over-all', auth, managerGate(), checked('POST /hand-over-all'), async (req, res) => {
  try {
    const { from_actor_id, to_actor_id, note } = req.body;
    const done = await holds.handOverAll(req, { from: from_actor_id, to: to_actor_id || null, note });
    res.json({ message: 'Hand-over complete', from: done.from, to: done.to, moved: done.moved, skipped: done.skipped, previous: done.previous });
  } catch (err) {
    if (err && err.status === 404) return problem(req, res, { status: 404, code: err.code, detail: err.message });
    if (err && err.status === 400) return problem(req, res, { status: 400, code: err.code || 'CHIT_BAD_REQUEST', detail: err.message });
    if (err && err.status === 403) return problem(req, res, { status: 403, code: 'CHIT_NOT_PERMITTED', detail: err.message });
    problem(req, res, failed(err, req, 'Hand-over failed'));
  }
});

router.contract = contract;
module.exports = router;
