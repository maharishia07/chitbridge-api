/**
 * /api/work — TASKS & ORDERS, READ (TO1/A1, 2026-10-10). Reads only; the writes (do · assign) are a later round.
 *
 *   GET /api/work/list?view=orders_in|orders_out|tasks|done&status=&assigned=me|none|<actor id>&q=&page=&limit=
 *        -> { view, page, limit, truncated, counts|null, total|null, rows:[{ chit_id, kind, tab, stage, word, status, side, subject, party, total_minor, currency,
 *             channel, fulfilment, address, requested_for, remark, lines_n, lines_open_n, billed, assignee, lines_assigned_n, age_days, actions }] }
 *   GET /api/work/facts   -> { truncated, counts|null, lines:[{ text, value?, tone? }], figures }       (the Home box and the till pill)
 *   GET /api/work/:chit_id -> the row + lines:[{ line_id, particulars, qty, unit, price_minor, delivered, remaining, assignment, settings, actions }]
 *
 * Every answer is built in lib/work-rows.js from the libs the old reads used (select · workflow · open-orders · assign · deliverline); this file only
 * authenticates, dispatches and refuses. `actions` is the SERVER's answer to "what may I do" for THIS login: every action, a refused one with its
 * sentence (`why`, `say`) — the page greys it, and the writing route still refuses.
 * ⭐ A truncated shop (more copies than one read takes) gets `truncated: true` and no counts — never a wrong one.
 * Answers are the caller's own shop (auth.entityOf, entity-scoped reads); a key is not a person and a customer is not staff: both are refused.
 */
'use strict';
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { safeErr } = require('../lib/respond');
const work = require('../lib/work-rows');
const railActions = require('../lib/rail-actions');

/** who is asking, or null after answering the refusal */
function who(req, res) {
  if (req.api_key || (req.identity && req.identity.identity_type === 'customer')) {
    res.status(403).json({ error: 'Forbidden', message: 'Sign in as staff to see Tasks and Orders.' });
    return null;
  }
  return { entity: auth.entityOf(req), actor: req.identity && req.identity.identity_id, me: railActions.meOf(req) };
}

router.get('/list', auth, async (req, res) => {
  const ctx = who(req, res); if (!ctx) return;
  const q = req.query || {};
  try {
    res.json(await work.list(ctx, { view: q.view, status: q.status, assigned: q.assigned, q: q.q, page: q.page, limit: q.limit }));
  } catch (e) { res.status(500).json({ error: 'Failed', message: safeErr(e) }); }
});

/* before /:chit_id, which would call it a chit */
router.get('/facts', auth, async (req, res) => {
  const ctx = who(req, res); if (!ctx) return;
  try { res.json(await work.facts(ctx)); }
  catch (e) { res.status(500).json({ error: 'Failed', message: safeErr(e) }); }
});

router.get('/:chit_id', auth, async (req, res) => {
  const ctx = who(req, res); if (!ctx) return;
  try {
    const row = await work.one(ctx, req.params.chit_id);
    if (!row) return res.status(404).json({ error: 'Not found', message: 'Chit not found or you do not have access' });
    res.json(row);
  } catch (e) { res.status(500).json({ error: 'Failed', message: safeErr(e) }); }
});

module.exports = router;
