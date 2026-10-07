// @stage tested
// @stage-note The api's door to the rail engine (lib/rail.js, adopted): who I am, what my copy holds, and how a route refuses.
'use strict';
/**
 * lib/rail-actions.js — THE RAIL ENGINE, ASKED THE SAME WAY BY GET /chits/:id AND BY EVERY WRITING RAIL ROUTE (R01, 2026-10-07).
 *
 * DESIGN-rail-modules-2026-10-05 §2.0. The rules live in lib/rail.js (chitbridge-engines `rail`, ADOPTED — never edit it here).
 * This file only gathers the engine's two inputs from a request and turns a refusal into a response:
 *
 *   meOf(req)                       → { level, holder }       level = lib/access.levelOf(req.identity); holder = req.till (M04)
 *   copyOf({ held, received, sender }) → the engine's chit facts, normalised
 *   actions(chit, me)               → the `actions` answer GET /chits/:id returns
 *   refuse(res, verdict, code, body) → res.status(code).json({ ...body, why })  — the route keeps its status code and its
 *                                      words (no client breaks), and gains the engine's refusal word as `why`
 *
 * ⚠️ ONE ENGINE BOTH SIDES. GET answers with rail.actions; the routes refuse with rail.can / rail.move over the same facts —
 * so the answer can never say ok:true for something the route then refuses (tests/rail-actions.test.cjs drives both).
 */
const rail = require('./rail');
const access = require('./access');

/** who is asking: the access level (viewer · commenter · editor) and the holder of the request (lib/holder.js shape) */
function meOf(req) {
  const t = (req && req.till) || null;
  return { level: access.levelOf(req && req.identity), holder: t ? { holder: t.holder, kind: t.kind } : null };
}

/**
 * what MY copy holds: held (I have a copy at all), received (the status of my RECEIVED copy, or null — a sender's own copy has
 * none), sender (I sent it). A self-chit is both: sender AND a received copy.
 */
function copyOf(f) {
  const x = f || {};
  return { held: !!x.held, received: x.received || null, sender: !!x.sender };
}

/** the whole answer for GET /chits/:id */
function actions(chit, me) { return rail.actions(copyOf(chit), me); }

/** a refusal, said by the route with its own status code and body, plus the engine's word */
function refuse(res, verdict, code, body) {
  if (!verdict || verdict.ok || !Object.prototype.hasOwnProperty.call(rail.WHY, verdict.why)) {
    throw new Error('rail-actions.refuse: not an engine refusal — ' + JSON.stringify(verdict));
  }
  return res.status(code).json(Object.assign({}, body || {}, { why: verdict.why }));
}

/**
 * refuseOwnCopy(res, verdict) — the refusal of a route that acts on a copy I hold (assign-lines, amend): not holding it is the
 * 404 those routes always answered (an id in the URL learns nothing); a level refusal is a 403 in the engine's sentence (the hat
 * gate answers a viewer / commenter first, so this is the backstop).
 */
function refuseOwnCopy(res, verdict) {
  return verdict.why === 'not_participant'
    ? refuse(res, verdict, 404, { error: 'Not found', message: 'Chit not found or you do not have access' })
    : refuse(res, verdict, 403, { error: 'Not permitted', message: rail.WHY[verdict.why] });
}

module.exports = { meOf, copyOf, actions, refuse, refuseOwnCopy, can: (c, me, a) => rail.can(copyOf(c), me, a),
  move: (c, me, to) => rail.move(copyOf(c), me, to), WHY: rail.WHY, ACTIONS: rail.ACTIONS };
