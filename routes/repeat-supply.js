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
 * ANSWERS (API-STANDARD S1): every refusal is a Problem that keeps the keys it always had (docs/contracts/api-legacy.json); the words are lib/orders-contract.js.
 * OWNS      /api/repeat: the agreement's 14 routes, over lib/repeat-supply (the rules). CALLED BY the Orders and Collections screens, the customer's agreement page, the nightly sweep.
 * FLOW      auth → who may (writeGate | customerGate) → schema check (lib/orders-contract.js) → lib/repeat-supply → res.json | problem(req, res, repeatFault(e, req))
 * CARD      12-suppliers-and-procurement/repeat-supply
 * ROUND TRIPS (tests/round-trips-all.test.cjs, by hand): list 2 (the zone, the join) · get 2–4 · a seller move 3 + 2 history lines ·
 *   the customer's accept = the status writer's own + 3 · create = the loopback send (its own request) + 3 · run = the sends + 2 each.
 */
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const access = require('../lib/access');
const railActions = require('../lib/rail-actions');
const { problem } = require('../lib/problem'); // API-STANDARD S1: the one error writer; each answer's old body is frozen in docs/contracts/api-legacy.json
const { schemaValidate } = require('../middleware/validate'); // S9: the request is checked against the route's own schema
const { UUID_RE } = require('../lib/trace');
const { repeat: contract, schemaOptions, repeatFault, levelRefusal, badChit, noSuchAgreement } = require('../lib/orders-contract'); // the contract (each route's operation) and the words of a refusal
const RS = () => require('../lib/repeat-supply');

const me = (req) => auth.entityOf(req);
const who = (req) => ({ id: (req.identity && req.identity.identity_id) || null, name: (req.identity && req.identity.display_name) || null });
/* S34: the agreement as lib/repeat-supply view answers it, every key named in the order the bytes had (rowOf, then side, actions, words, due) */
// prettier-ignore
const agreementOf = (held) => ({ agreement_id: held.agreement_id, entity_id: held.entity_id, chit_id: held.chit_id, customer_entity_id: held.customer_entity_id, source_chit_id: held.source_chit_id, every: held.every, unit: held.unit, anchor_day: held.anchor_day, next_on: held.next_on, end_on: held.end_on, runs_max: held.runs_max, runs_done: held.runs_done, mode: held.mode, state: held.state, terms: held.terms, counter: held.counter, skips: held.skips, runs: held.runs, last_run_on: held.last_run_on, state_by: held.state_by, state_at: held.state_at, state_note: held.state_note, created_by: held.created_by, created_at: held.created_at, updated_at: held.updated_at, customer: held.customer && { entity_id: held.customer.entity_id, name: held.customer.name }, money: held.money, currency: held.currency, subject: held.subject, side: held.side, actions: held.actions, words: held.words, due: held.due });
const chitOf = (req) => String((req.query && req.query.chit) || (req.body && req.body.chit_id) || '') || null;

/** ORD-73: an agreement id in the address that is not a uuid names nothing — 404 before the database sees it */
router.param('id', (req, res, next, id) => (UUID_RE.test(String(id)) ? next() : problem(req, res, { status: 404, ...noSuchAgreement() })));
/** ORD-73: the chit the caller names (body chit_id or ?chit=), when given, must be a uuid — 400 before the database sees it */
function chitNamed(req, res, next) {
  const named = chitOf(req);
  return named === null || UUID_RE.test(named) ? next() : problem(req, res, { status: 400, ...badChit() });
}

/** the schema check of one route (its own operation in lib/orders-contract.js), as a list to spread after the gates: a route that takes no input has none */
function checked(route) {
  const operation = contract.operationFor(route);
  return operation.parameters || operation.requestBody ? [schemaValidate(operation, schemaOptions.repeat)] : [];
}
/** a writing verb on either side: the owner, or a person at editor level — the rail's own words for the rest (403) */
function writeGate(req, res, next) {
  const m = access.mayWrite(req); /* the one answer (lib/access mayWrite) — the trade writes ask the same */
  if (m.may) return next();
  return problem(req, res, { status: 403, ...levelRefusal(m.code, m.why) });
}
/** the customer's verbs: editor level on the copy they hold (the rail engine's ladder, the same answer GET /chits/:id gives) */
const customerGate = (action) => (req, res, next) => {
  const v = railActions.can({ held: true, received: 'pending', sender: false }, railActions.meOf(req), action);
  if (v.ok) return next();
  return problem(req, res, { status: 403, ...levelRefusal(v.why, railActions.WHY[v.why]) });
};

/** GET /api/repeat → { agreements: [...], migrated } — the seller's agreements, each with its actions (may/why) */
router.get('/', auth, async (req, res) => {
  try {
    const R = RS();
    if (!(await R.migrated(me(req)))) return res.json({ agreements: [], migrated: false, message: R.WHY.not_migrated });
    res.json({ agreements: (await R.list(me(req))).map(agreementOf), migrated: true });
  } catch (e) {
    problem(req, res, repeatFault(e, req));
  }
});
/** POST /api/repeat { chit_id, every, unit, start_on, anchor_day?, until: { runs? | on? }, mode? } → { agreement } — the agreement chit is sent */
router.post('/', auth, writeGate, ...checked('POST /'), async (req, res) => {
  try {
    res.json({ agreement: agreementOf(await RS().create(me(req), who(req), req.body || {})) });
  } catch (e) {
    problem(req, res, repeatFault(e, req));
  }
});
/** POST /api/repeat/sweep → { ran, problems } — the seller runs everything due now (what the nightly would do) */
router.post('/sweep', auth, writeGate, ...checked('POST /sweep'), async (req, res) => {
  try {
    const swept = await RS().sweep(me(req), null, { request_id: req.id || null }); /* SEC-90: a fault in problems[] says the safe sentence and this id */
    res.json({ ran: swept.ran, problems: swept.problems });
  } catch (e) {
    problem(req, res, repeatFault(e, req));
  }
});
/** GET /api/repeat/:id?chit= → { agreement } — either side; the customer names the chit they hold */
router.get('/:id', auth, ...checked('GET /:id'), async (req, res) => {
  try {
    const found = await RS().one(me(req), req.params.id, chitOf(req));
    res.json(found.read_only ? { agreement: agreementOf(found.agreement), read_only: found.read_only } : { agreement: agreementOf(found.agreement) }); /* read_only only for a third party who holds the chit */
  } catch (e) {
    problem(req, res, repeatFault(e, req));
  }
});

/* ── the customer's side (through the rail: they hold the agreement chit) ── */
router.post('/:id/accept', auth, customerGate('accept'), chitNamed, ...checked('POST /:id/accept'), async (req, res) => {
  try {
    res.json({ agreement: agreementOf(await RS().accept(me(req), req.params.id, chitOf(req), who(req), railActions.meOf(req))) });
  } catch (e) {
    problem(req, res, repeatFault(e, req));
  }
});
/** POST /:id/counter { chit_id, lines?: [{ line_id, quantity }], every?, unit?, start_on?, note } */
router.post('/:id/counter', auth, customerGate('amend'), chitNamed, ...checked('POST /:id/counter'), async (req, res) => {
  try {
    res.json({ agreement: agreementOf(await RS().counter(me(req), req.params.id, chitOf(req), who(req), req.body || {})) });
  } catch (e) {
    problem(req, res, repeatFault(e, req));
  }
});
router.post('/:id/decline', auth, customerGate('reject'), chitNamed, ...checked('POST /:id/decline'), async (req, res) => {
  try {
    res.json({ agreement: agreementOf(await RS().decline(me(req), req.params.id, chitOf(req), who(req), req.body || {}, railActions.meOf(req))) });
  } catch (e) {
    problem(req, res, repeatFault(e, req));
  }
});

/* ── either side: skip the next run (the customer says why) ── */
router.post('/:id/skip', auth, writeGate, chitNamed, ...checked('POST /:id/skip'), async (req, res) => {
  try {
    res.json({ agreement: agreementOf(await RS().skip(me(req), req.params.id, chitOf(req), who(req), req.body || {})) });
  } catch (e) {
    problem(req, res, repeatFault(e, req));
  }
});

/* ── the seller's side ── */
/** a seller's verb: the gate and the schema check in front, the library's answer behind; a refusal it throws is a Problem */
const seller = (route, answer) => [
  writeGate,
  ...checked(route),
  async (req, res) => {
    try {
      res.json(await answer(req));
    } catch (e) {
      problem(req, res, repeatFault(e, req));
    }
  }
];
router.post(
  '/:id/agree',
  auth,
  ...seller('POST /:id/agree', async (req) => ({ agreement: agreementOf(await RS().agree(me(req), req.params.id, who(req))) }))
);
router.post(
  '/:id/refuse',
  auth,
  ...seller('POST /:id/refuse', async (req) => ({ agreement: agreementOf(await RS().refuseCounter(me(req), req.params.id, who(req), req.body || {})) }))
);
router.post(
  '/:id/pause',
  auth,
  ...seller('POST /:id/pause', async (req) => ({ agreement: agreementOf(await RS().pause(me(req), req.params.id, who(req), req.body || {})) }))
);
router.post(
  '/:id/resume',
  auth,
  ...seller('POST /:id/resume', async (req) => ({ agreement: agreementOf(await RS().resume(me(req), req.params.id, who(req))) }))
);
router.post(
  '/:id/end',
  auth,
  ...seller('POST /:id/end', async (req) => ({ agreement: agreementOf(await RS().end(me(req), req.params.id, who(req), req.body || {})) }))
);
router.post(
  '/:id/run',
  auth,
  ...seller('POST /:id/run', async (req) => {
    const moved = await RS().run(me(req), req.params.id, who(req), { request_id: req.id || null });
    return { agreement: agreementOf(moved.agreement), ran: moved.ran, problems: moved.problems };
  })
);

router.openapi = { paths: contract.pathsOf(), schemas: {} };
module.exports = router;
