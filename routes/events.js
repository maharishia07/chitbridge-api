/**
 * /api/events — the mailbox bell (see lib/events.js).
 *   POST /ticket  (auth)      → { ticket, ttl_s }    one-time, 60 s
 *   GET  /stream?t=<ticket>   → text/event-stream    'hello' on open, 'cb' per arrival, ': ping' every 25 s
 *   GET  /stats   (auth)      → { entities, connections, tickets }   for the operator
 */
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const events = require('../lib/events');
const ctx = (req) => auth.entityOf(req);

router.post('/ticket', auth, (req, res) => { const e = ctx(req); if (!e) return res.status(401).json({ error: 'Unauthorised' }); res.json(events.ticketFor(e)); });
router.get('/stream', (req, res) => {
  /**
   * ⚠️⚠️ BOTH SPELLINGS. The app has always sent ?t=, and the counter and the shop screen have always sent ?ticket= —
   * so every counter and every television was refused here, silently, from the day the bell was written: "the shop
   * changed" never reached a till, which caught up only on its fifteen-minute timer. Found 2026-09-17 when a brand's
   * offer change reached every store's snapshot and no store's counter. Accepting both mends every page already open
   * in a shop, without anyone having to reload it.
   */
  const e = events.spend(req.query.t || req.query.ticket);
  if (!e) return res.status(401).json({ error: 'Unauthorised', message: 'ticket missing, spent or expired' });
  events.subscribe(e, req, res);
});
router.get('/stats', auth, (req, res) => res.json(events.stats()));
module.exports = router;
