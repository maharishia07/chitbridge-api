/**
 * /api/events — the mailbox bell (see lib/events.js).
 *   POST /ticket  (auth)      → { ticket, ttl_s }    one-time, 60 s
 *   GET  /stream?t=<ticket>   → text/event-stream    'hello' on open, 'cb' per arrival, and every 25 s BOTH ': ping' (a comment, for proxies) and a named 'ping' event — a comment fires no client listener, so only the named one lets a counter tell a quiet bell from a dead one ([TILL-167])
 *   GET  /stats   (auth · platform root only, SEC3) → { entities, connections, tickets }   platform-wide counts, the operator's
 *
 * OWNS       the three routes of the mailbox bell: a one-time ticket, the live stream opened with it, and the operator's connection counts. The frames are lib/events.js.
 * CALLED BY  server.js (mounted at /api/events) · the app (public/app/rail-bell.js, core.js), the counter (public/till.html) and the shop screens, through EventSource.
 * FLOW  every route: its schema check (lib/bell-contract.js `events`) → the handler → lib/events.js. A refusal → problem(req, res, ...), the old { error, message } kept beside the Problem fields
 *       (docs/contracts/api-legacy.json). The stream's success is NOT JSON (text/event-stream), declared by the contract; its framing is lib/events.js and is not touched.
 * CARD  22-channels-capture-and-messaging/notifications-and-the-bell
 */
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const events = require('../lib/events');
const { problem } = require('../lib/problem'); // API-STANDARD S1: the one error writer; each answer's old body is frozen in docs/contracts/api-legacy.json
const { events: contract, words, lastResort } = require('../lib/bell-contract'); // the contract (each route's operation) and the words of a refusal
const ctx = (req) => auth.entityOf(req);
const { isScreenKey } = require('../lib/holder');
/* ⚠️ SEC3: platform-wide connection counts are the OPERATOR's — any signed-in shop could read them. lib/platformroot is the one door, here as a gate that says which statuses it answers (the same line as routes/entities.js rootGate). */
const rootGate = Object.assign((req, res, next) => (require('../lib/platformroot').refuseUnlessRoot(req, res) ? next() : undefined), { addsStatuses: [403, 404] });

/* SNAP-SCREEN: a screen key's ticket is marked, so its stream carries only 'the shop changed' (lib/events ticketFor) */
router.post('/ticket', auth, ...contract.checked('POST /ticket'), (req, res) => {
  const e = ctx(req);
  if (!e) return problem(req, res, { status: 401, ...words.signInRequired() });
  res.json(events.ticketFor(e, { screen: isScreenKey(req.till && req.till.key) }));
});
router.get('/stream', ...contract.checked('GET /stream'), (req, res) => {
  /**
   * ⚠️⚠️ BOTH SPELLINGS. The app has always sent ?t=, and the counter and the shop screen have always sent ?ticket= —
   * so every counter and every television was refused here, silently, from the day the bell was written: "the shop
   * changed" never reached a till, which caught up only on its fifteen-minute timer. Found 2026-09-17 when a brand's
   * offer change reached every store's snapshot and no store's counter. Accepting both mends every page already open
   * in a shop, without anyone having to reload it.
   */
  const v = events.spendFor(req.query.t || req.query.ticket);
  if (!v) return problem(req, res, { status: 401, ...words.ticketRefused() });
  events.subscribe(v.entity_id, req, res, { screen: v.screen });
});
router.get('/stats', auth, rootGate, ...contract.checked('GET /stats'), (req, res) => {
  try {
    res.json(events.stats());
  } catch (e) {
    problem(req, res, lastResort(e, req)); /* the answer the server's last-resort handler gave a throw here, now written here */
  }
});

router.openapi = { paths: contract.pathsOf(), schemas: {} };

module.exports = router;
