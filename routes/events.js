/**
 * /api/events — the mailbox bell (see lib/events.js).
 *   POST /ticket  (auth)      → { ticket, ttl_s }    one-time, 60 s
 *   GET  /stream?t=<ticket>   → text/event-stream    'hello' on open, 'cb' per arrival, and every 25 s BOTH ': ping' (a comment, for proxies) and a named 'ping' event — a comment fires no client listener, so only the named one lets a counter tell a quiet bell from a dead one ([TILL-167])
 *   GET  /stats   (auth · platform root only, SEC3) → { entities, connections, tickets }   platform-wide counts, the operator's
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
/* ⚠️ SEC3: platform-wide connection counts are the OPERATOR's — any signed-in shop could read them. lib/platformroot is the one door. */
router.get('/stats', auth, (req, res) => { if (!require('../lib/platformroot').refuseUnlessRoot(req, res)) return; res.json(events.stats()); });
module.exports = router;
