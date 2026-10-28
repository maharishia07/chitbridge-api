// @stage tested
// @stage-note [RI1] /api/repeat — the repeat-supply agreement: the seller's list · create (from a sent invoice) · pause · resume · end · skip
// @stage-note · run · agree · refuse; the customer's accept · counter · decline · skip through the rail (they hold the agreement chit).
'use strict';
/**
 * routes/repeat-supply.js — REPEAT SUPPLY (round RI1, 2026-10-12). The rules live in lib/repeat-supply.js; this file only gathers who is
 * asking and turns a refusal into a response in words.
 *
 * WHO MAY (the server decides):
 *   seller side   — the shop that made the agreement: the OWNER (lib/owner isOwner) or a person at EDITOR level (lib/access canEdit —
 *                   the sales hat). A viewer / commenter is refused 403 in the rail engine's own sentence (comment_only · read_only).
 *   customer side — the entity the agreement names, HOLDING its received copy of the agreement chit (`?chit=<chit_id>` or body.chit_id
 *                   names it; the server checks the copy under the caller's own RLS), at editor level (lib/rail can). Anyone else: 404.
 *   every verb    — lib/repeat-supply may(): the agreement's own step table; a refusal is 422 { code: 'REPEAT_<WHY>', message }.
 * BEFORE b303 runs every route answers 503 { code: 'REPEAT_NOT_MIGRATED', message } — never a 500.
 * ROUND TRIPS (tests/round-trips-all.test.cjs, by hand): list 2 (the zone, the join) · get 2–4 · a seller move 3 + 2 history lines ·
 *   the customer's accept = the status writer's own + 3 · create = the loopback send (its own request) + 3 · run = the sends + 2 each.
 */
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const access = require('../lib/access');
const railActions = require('../lib/rail-actions');
const RS = () => require('../lib/repeat-supply');

const me = (req) => auth.entityOf(req);
const who = (req) => ({ id: (req.identity && req.identity.identity_id) || null, name: (req.identity && req.identity.display_name) || null });
const chitOf = (req) => String((req.query && req.query.chit) || (req.body && req.body.chit_id) || '') || null;

function fail(res, e) {
  if (e && e.code === 'REPEAT_NOT_MIGRATED') return res.status(503).json({ code: e.code, error: e.message, message: e.message });
  if (e && e.code === 'BOOKS_NOT_FOUND') return res.status(404).json({ error: 'Not found', message: e.message });
  if (e && e.code === 'BOOKS_BAD_REQUEST') return res.status(400).json({ error: e.message, message: e.message });
  if (e && e.refused) return res.status(422).json({ code: e.code || 'REPEAT_REFUSED', error: e.message, message: e.message });
  if (e && e.status >= 400 && e.status < 500) return res.status(e.status).json(Object.assign({ error: e.message, message: e.message }, e.body || {}));
  require('../lib/logger').error('repeat.route', { error: String(e && e.message).slice(0, 200) });
  return res.status(500).json({ error: 'Server error', message: 'Repeat supply could not answer. Try again.' });
}
/** a writing verb on either side: the owner, or a person at editor level — the rail's own words for the rest */
function editorMay(req, res) {
  const m = access.mayWrite(req); /* the one answer (lib/access mayWrite) — the trade writes ask the same */
  if (m.may) return true;
  res.status(403).json({ error: 'Not permitted', message: m.why, why: m.code });
  return false;
}
/** the customer's verbs: editor level on the copy they hold (the rail engine's ladder, the same answer GET /chits/:id gives) */
function customerMay(req, res, action) {
  const v = railActions.can({ held: true, received: 'pending', sender: false }, railActions.meOf(req), action);
  if (v.ok) return true;
  railActions.refuse(res, v, 403, { error: 'Not permitted', message: railActions.WHY[v.why] });
  return false;
}

/** GET /api/repeat → { agreements: [...], migrated } — the seller's agreements, each with its actions (may/why) */
router.get('/', auth, async (req, res) => {
  try {
    const R = RS();
    if (!(await R.migrated(me(req)))) return res.json({ agreements: [], migrated: false, message: R.WHY.not_migrated });
    res.json({ agreements: await R.list(me(req)), migrated: true });
  } catch (e) {
    fail(res, e);
  }
});
/** POST /api/repeat { chit_id, every, unit, start_on, anchor_day?, until: { runs? | on? }, mode? } → { agreement } — the agreement chit is sent */
router.post('/', auth, async (req, res) => {
  try {
    if (!editorMay(req, res)) return;
    res.json({ agreement: await RS().create(me(req), who(req), req.body || {}) });
  } catch (e) {
    fail(res, e);
  }
});
/** POST /api/repeat/sweep → { ran, problems } — the seller runs everything due now (what the nightly would do) */
router.post('/sweep', auth, async (req, res) => {
  try {
    if (!editorMay(req, res)) return;
    res.json(await RS().sweep(me(req)));
  } catch (e) {
    fail(res, e);
  }
});
/** GET /api/repeat/:id?chit= → { agreement } — either side; the customer names the chit they hold */
router.get('/:id', auth, async (req, res) => {
  try {
    res.json(await RS().one(me(req), req.params.id, chitOf(req)));
  } catch (e) {
    fail(res, e);
  }
});

/* ── the customer's side (through the rail: they hold the agreement chit) ── */
router.post('/:id/accept', auth, async (req, res) => {
  try {
    if (!customerMay(req, res, 'accept')) return;
    res.json({ agreement: await RS().accept(me(req), req.params.id, chitOf(req), who(req), railActions.meOf(req)) });
  } catch (e) {
    fail(res, e);
  }
});
/** POST /:id/counter { chit_id, lines?: [{ line_id, quantity }], every?, unit?, start_on?, note } */
router.post('/:id/counter', auth, async (req, res) => {
  try {
    if (!customerMay(req, res, 'amend')) return;
    res.json({ agreement: await RS().counter(me(req), req.params.id, chitOf(req), who(req), req.body || {}) });
  } catch (e) {
    fail(res, e);
  }
});
router.post('/:id/decline', auth, async (req, res) => {
  try {
    if (!customerMay(req, res, 'reject')) return;
    res.json({ agreement: await RS().decline(me(req), req.params.id, chitOf(req), who(req), req.body || {}, railActions.meOf(req)) });
  } catch (e) {
    fail(res, e);
  }
});

/* ── either side: skip the next run (the customer says why) ── */
router.post('/:id/skip', auth, async (req, res) => {
  try {
    if (!editorMay(req, res)) return;
    res.json({ agreement: await RS().skip(me(req), req.params.id, chitOf(req), who(req), req.body || {}) });
  } catch (e) {
    fail(res, e);
  }
});

/* ── the seller's side ── */
const seller = (fn) => async (req, res) => {
  try {
    if (!editorMay(req, res)) return;
    res.json(await fn(req));
  } catch (e) {
    fail(res, e);
  }
};
router.post(
  '/:id/agree',
  auth,
  seller(async (req) => ({ agreement: await RS().agree(me(req), req.params.id, who(req)) }))
);
router.post(
  '/:id/refuse',
  auth,
  seller(async (req) => ({ agreement: await RS().refuseCounter(me(req), req.params.id, who(req), req.body || {}) }))
);
router.post(
  '/:id/pause',
  auth,
  seller(async (req) => ({ agreement: await RS().pause(me(req), req.params.id, who(req), req.body || {}) }))
);
router.post(
  '/:id/resume',
  auth,
  seller(async (req) => ({ agreement: await RS().resume(me(req), req.params.id, who(req)) }))
);
router.post(
  '/:id/end',
  auth,
  seller(async (req) => ({ agreement: await RS().end(me(req), req.params.id, who(req), req.body || {}) }))
);
router.post(
  '/:id/run',
  auth,
  seller(async (req) => RS().run(me(req), req.params.id, who(req)))
);

module.exports = router;
