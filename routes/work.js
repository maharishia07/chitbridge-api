/**
 * /api/work — TASKS & ORDERS, READ (TO1/A1, 2026-10-10). Reads only; the writes (do · assign) are a later round.
 *
 *   GET /api/work/list?view=orders_in|orders_out|tasks|done&status=&assigned=me|none|<actor id>&q=&page=&limit=
 *        -> { view, page, limit, truncated, counts|null, total|null, rows:[{ chit_id, kind, tab, stage, word, status, side, subject, party, total_minor, currency,
 *             channel, fulfilment, address, requested_for, remark, lines_n, lines_open_n, billed, assignee, lines_assigned_n, age_days, actions }] }
 *   GET /api/work/facts   -> { truncated, counts|null, lines:[{ text, value?, tone? }], figures }       (the Home box and the till pill)
 *        ?unbilled=1 adds figures.unbilled { n, minor, currency } — the open orders in that no bill names yet (Finance › Collections, W11)
 *   GET /api/work/:chit_id -> the row + lines:[{ line_id, particulars, qty, unit, price_minor, delivered, remaining, assignment, settings, actions }]
 *
 * Every answer is built in lib/work-rows.js from the libs the old reads used (select · workflow · open-orders · assign · deliverline); this file only
 * authenticates, dispatches and refuses. `actions` is the SERVER's answer to "what may I do" for THIS login: every action, a refused one with its
 * sentence (`why`, `say`) — the page greys it, and the writing route still refuses.
 * ⭐ A truncated shop (more copies than one read takes) gets `truncated: true` and no counts — never a wrong one.
 * Answers are the caller's own shop (auth.entityOf, entity-scoped reads); a key is not a person and a customer is not staff: both are refused.
 * FLOW  auth → schema check (lib/orders-contract.js) → who(req) → lib/work-rows list · facts (?unbilled=1 → unbilledOf) · one → res.json; a refusal → problem(req, res, staffOnly() | chitNotFound() | failed(e, req))
 * CARD 02-tasks-orders-and-workflow/everyones-work
 */
'use strict';
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { problem } = require('../lib/problem'); // API-STANDARD S1: the one error writer; each answer's old body is frozen in docs/contracts/api-legacy.json
const { schemaValidate } = require('../middleware/validate'); // S9: the request is checked against the route's own schema
const { work: contract, schemaOptions, staffOnly, chitNotFound, failed } = require('../lib/orders-contract'); // the contract (each route's operation) and the words of a refusal
const work = require('../lib/work-rows');
const railActions = require('../lib/rail-actions');

/** the schema check of one route (its own operation in lib/orders-contract.js) */
const checked = (route) => schemaValidate(contract.operationFor(route), schemaOptions.work);

/** who is asking, or null after answering the refusal */
function who(req, res) {
  if (req.api_key || (req.identity && req.identity.identity_type === 'customer')) {
    problem(req, res, { status: 403, ...staffOnly() });
    return null;
  }
  return { entity: auth.entityOf(req), actor: req.identity && req.identity.identity_id, me: railActions.meOf(req) };
}

router.get('/list', auth, checked('GET /list'), async (req, res) => {
  const ctx = who(req, res);
  if (!ctx) return;
  const q = req.query || {};
  try {
    res.json(await work.list(ctx, { view: q.view, status: q.status, assigned: q.assigned, q: q.q, page: q.page, limit: q.limit }));
  } catch (e) {
    problem(req, res, failed(e, req));
  }
});

/* before /:chit_id, which would call it a chit */
router.get('/facts', auth, checked('GET /facts'), async (req, res) => {
  const ctx = who(req, res);
  if (!ctx) return;
  try {
    res.json(await work.facts(ctx, { unbilled: req.query && req.query.unbilled === '1' }));
  } catch (e) {
    problem(req, res, failed(e, req));
  }
});

router.get('/:chit_id', auth, checked('GET /:chit_id'), async (req, res) => {
  const ctx = who(req, res);
  if (!ctx) return;
  try {
    const row = await work.one(ctx, req.params.chit_id);
    if (!row) return problem(req, res, { status: 404, ...chitNotFound() });
    res.json(row);
  } catch (e) {
    problem(req, res, failed(e, req));
  }
});

router.openapi = { paths: contract.pathsOf(), schemas: {} };

module.exports = router;
