// @stage tested
// @stage-note The api's door to the rail engine (lib/rail.js, adopted): who I am, what my copy holds, and how a route refuses.
'use strict';
/**
 * lib/rail-actions.js — THE RAIL ENGINE, ASKED THE SAME WAY BY GET /chits/:id AND BY EVERY WRITING RAIL ROUTE (R01, 2026-10-07).
 *
 * owns: the api's door to the adopted rail engine — who is asking, what my copy holds, how a route refuses, and the ONE table of
 *       status words every list, bucket and guard reads (W2-RAIL R2: derived from rail.TRANSITIONS, never spelled again).
 * called by: routes/chits.js (GET `actions`, every writing rail door, delete · archive · purge · reprice), lib/rail-status,
 *            lib/dispute-may, lib/workflow, lib/measure, lib/home-facts, lib/books-hooks, lib/assign-chit, lib/raida, routes/actors.
 * FLOW  req → meOf() → copyOf(facts) → rail.can / rail.move → refuse() or the write      INIT  rail (adopted) → access → this
 * // CARD 01-rail-core-the-chit/rail-actions
 *
 * DESIGN-rail-modules-2026-10-05 §2.0. The rules live in lib/rail.js (chitbridge-engines `rail`, ADOPTED — never edit it here).
 * This file only gathers the engine's two inputs from a request and turns a refusal into a response:
 *
 *   meOf(req)                       → { level, holder }       level = lib/access.levelOf(req.identity); holder = req.till (M04)
 *   copyOf({ held, received, sender }) → the engine's chit facts, normalised
 *   actions(chit, me)               → the `actions` answer GET /chits/:id returns
 *   refuse(res, verdict, code, body) → res.status(code).json({ ...body, why })  — the route keeps its status code and its
 *                                      words (no client breaks), and gains the engine's refusal word as `why`
 *   canHousekeep(action, facts)     → may I delete · purge · archive MY copy (W2-RAIL R2) — the housekeeping words below
 *   STATES · BUCKETS · OPEN_STATES · CLOSED_STATES · ASKABLE · ARRIVAL · SENT_STATUS — the status words, one table
 *
 * ⚠️ ONE ENGINE BOTH SIDES. GET answers with rail.actions; the routes refuse with rail.can / rail.move over the same facts —
 * so the answer can never say ok:true for something the route then refuses (tests/rail-actions.test.cjs drives both).
 */
const rail = require('./rail');
const access = require('./access');

/* ── ⭐ THE STATUS WORDS, ONE TABLE (W2-RAIL R2, 15 Oct) ──────────────────────────────────────────────────────────────────────
 * Eleven files spelled the open / act / close buckets by hand (chits.js, measure, home-facts, books-hooks, workflow, assign-chit,
 * raida, actors). Every word here is read off the engine's own transition table, so a status the rail does not know cannot
 * be a bucket's member, and a new rail state shows up as a test failure here rather than as a list that quietly miscounts. */
/** every status a copy can be in — the keys of the engine's transition table */
const STATES = Object.freeze(Object.keys(rail.TRANSITIONS));
/** the three buckets a list filters by: not yet answered · being worked · at an end */
const BUCKETS = Object.freeze({
  open:  Object.freeze(['pending', 'delivered', 'read']),
  act:   Object.freeze(['accepted', 'in_progress', 'partial']),
  close: Object.freeze(['completed', 'cancelled', 'rejected']),
});
/** still open = unanswered or being worked (what a folder counts, what a sweep may still close) */
const OPEN_STATES = Object.freeze(BUCKETS.open.concat(BUCKETS.act));
/** an end of the road: the copy stays with whoever finished it */
const CLOSED_STATES = BUCKETS.close;
/** the statuses a person may ASK for (PUT /status): every transition target; delivered · read are the system's alone */
const ASKABLE = Object.freeze([...new Set(Object.values(rail.TRANSITIONS).flat())]);
/** a received copy's status on arrival, by how it was addressed: the `to` party acts, cc / for are informed */
const ARRIVAL = Object.freeze({ to: 'pending', cc: 'delivered', for: 'delivered' });
/** the sender's own copy at send */
const SENT_STATUS = 'delivered';
/** the status a received copy starts in (ARRIVAL by kind; an unknown kind is informed, never asked to act) */
function arrivalStatus(kind) { return ARRIVAL[kind] || ARRIVAL.cc; }
/** the closed set as a SQL list — for a NOT IN (…) in a statement that cannot take an array parameter */
const CLOSED_SQL = CLOSED_STATES.map((status) => "'" + status + "'").join(',');

/* ── ⭐ HOUSEKEEPING — may I delete · purge · archive MY copy (W2-RAIL R2) ──────────────────────────────────────────────────
 * Not rail actions (the adopted engine has no word for them — queued with chitbridge-engines; until then these words live
 * beside the door, like dispute-may's). Every guard FAILS CLOSED: a dispute count that could not be read is a refusal, not 0. */
const HOUSEKEEP_WHY = Object.freeze({
  co_held_record:   'This chit is a record both parties hold. Archive it instead.',
  dispute_open:     'A dispute is open on this chit. Resolve it first.',
  disputes_unknown: 'Could not check for open disputes. Try again in a moment.',
});
const HOUSEKEEP_ACTIONS = Object.freeze(['delete', 'purge', 'archive']);
/** what the draft rule applies to: delete and purge remove; archive only hides */
const REMOVES = Object.freeze(['delete', 'purge']);
/**
 * canHousekeep(action, facts) → { ok } | { ok:false, why, say }
 *   facts.role           the header's role on MY copy ('Draft' = never sent; anything else is co-held)
 *   facts.open_disputes  the count of my open dispute copies, or null when it could not be read (→ refused, fail closed)
 */
function canHousekeep(action, facts) {
  if (!HOUSEKEEP_ACTIONS.includes(action)) throw new Error('rail-actions.canHousekeep: unknown action "' + action + '"');
  const f = facts || {};
  const no = (why) => ({ ok: false, why, say: HOUSEKEEP_WHY[why] });
  if (REMOVES.includes(action) && f.role !== 'Draft') return no('co_held_record');
  if (f.open_disputes === null || f.open_disputes === undefined) return no('disputes_unknown');
  if (Number(f.open_disputes) > 0) return no('dispute_open');
  return { ok: true };
}
/** the status a housekeeping refusal answers with: the record / dispute rules are a conflict, an unread count is "not now" */
const HOUSEKEEP_STATUS = Object.freeze({ co_held_record: 409, dispute_open: 409, disputes_unknown: 503 });

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

/** is this word one a refusal may carry: the engine's, or a housekeeping word of this file */
const isRefusalWord = (why) => Object.prototype.hasOwnProperty.call(rail.WHY, why) || Object.prototype.hasOwnProperty.call(HOUSEKEEP_WHY, why);

/** a refusal, said by the route with its own status code and body, plus the engine's word */
function refuse(res, verdict, code, body) {
  if (!verdict || verdict.ok || !isRefusalWord(verdict.why)) {
    throw new Error('rail-actions.refuse: not an engine refusal — ' + JSON.stringify(verdict));
  }
  return res.status(code).json(Object.assign({}, body || {}, { why: verdict.why }));
}

/** a housekeeping refusal: its own status (409 conflict · 503 not now), the sentence as `message`, the word as `why` AND `code` */
function refuseHousekeep(res, verdict) {
  const code = HOUSEKEEP_STATUS[verdict.why] || 409;
  return refuse(res, verdict, code, { error: code === 503 ? 'Not now' : 'Not allowed', message: verdict.say, code: verdict.why });
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

/**
 * ⭐ STD1 · MAY I ACCEPT THIS BILL — the server's answer, composed on the chit read. A bill I received (docOf bill_received) steps on MY
 * bill_step, not the shared status the rail reads (bills-private), so the rail's step facts (not_received · wrong_step) do not apply to it —
 * only its access LEVEL does. Then the books: a bill whose waiting row asks something other than acceptance (a supplier the books do not
 * know, a gap between their total and the lines) is refused with the books' own sentence — Accept shown, greyed, with the fix beside it.
 * → the actions object, with `accept` answered for a bill; every other copy and action is the rail's answer, untouched.
 */
function forBill(doc, wait, actions) {
  if (doc !== 'bill_received' || !actions || !actions.accept) return actions;
  const a = actions.accept, level = a.ok === false && /^(not_participant|read_only|comment_only)$/.test(String(a.why || ''));
  const out = Object.assign({}, actions);
  out.accept = level ? a
    : wait && wait.todo && wait.todo !== 'accept' ? { ok: false, why: 'books_waiting', say: String(wait.why || ''), todo: wait.todo } : { ok: true };
  /* FX-F10W2: REJECT, answered the same way — the level alone refuses it (the books' sentences tell the owner to reject); it needs a reason
     (lib/workflow needsOf — the rule Task's reject already follows; PUT /status refuses a bill's reject without one) */
  const r = actions.reject || a, rlevel = r && r.ok === false && /^(not_participant|read_only|comment_only)$/.test(String(r.why || ''));
  out.reject = rlevel ? r : { ok: true, needs: require('./workflow').needs({}, 'reject') };
  return out;
}
/**
 * ⭐ SEC4 · MAY I RECORD A DELIVERY ON THIS COPY (POST /:chit_id/deliver-lines) — the engine's own ladder (rail.byLevel) and the same
 * "I hold a copy" fact, so the refusal word is the engine's. ⚠️ The adopted engine does not name `deliver` among its ACTIONS yet
 * (rail.can throws on it); when chitbridge-engines adds it, this becomes `can(c, me, 'deliver')` and GET's `actions` answers it too.
 */
function canDeliver(c, me) {
  const lv = rail.byLevel(me && me.level, 'deliver');
  if (lv) return { ok: false, why: lv };
  return copyOf(c).held ? { ok: true } : { ok: false, why: 'not_participant' };
}
module.exports = { meOf, copyOf, actions, forBill, refuse, refuseOwnCopy, canDeliver, can: (c, me, a) => rail.can(copyOf(c), me, a),
  move: (c, me, to) => rail.move(copyOf(c), me, to), WHY: rail.WHY, ACTIONS: rail.ACTIONS,
  /* W2-RAIL R2 */
  canHousekeep, refuseHousekeep, HOUSEKEEP_WHY, HOUSEKEEP_ACTIONS, HOUSEKEEP_STATUS,
  STATES, BUCKETS, OPEN_STATES, CLOSED_STATES, CLOSED_SQL, ASKABLE, ARRIVAL, SENT_STATUS, arrivalStatus };
