/**
 * /api/facts — WHAT EACH HOME CARD SAYS (N18, 2026-10-08).
 *
 *   GET /api/facts/:card   card ∈ till · accounts · product-lab · combo-lab · offer-lab   → { lines: [{ text, value?, tone? }], figures? }
 *   GET /api/facts/rail/chits  -> { overdue_days, truncated, items:[{ chit_id, tab:in|out, stuck, why, ... }] } - the chits behind the rail's numbers
 *   GET /api/facts/rail                                                                    → { suppliers, customers, in, out, stuck }
 *
 * The shell (public/app/shell.js) GETs the `facts` URL named in a manifest row and draws at most two lines. Every answer is built
 * in lib/home-facts.js from the libs the old per-page reads used; this file only authenticates, dispatches and refuses.
 * ⭐ A FIGURE THE SERVER CANNOT COMPUTE IS LEFT OUT, NEVER 0. ⚠️ COST NEVER TRAVELS — product-lab sends a count.
 * Answers are the caller's own shop (auth.entityOf); a key is not a person and is refused (the shell is a signed-in page).
 */
'use strict';
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { safeErr } = require('../lib/respond');
const home = require('../lib/home-facts');

/* the chits behind the rail's In · Out · Stuck (H1): the same rows and the same overdue test as the counts. Before /:card, which would call it a card. */
router.get('/rail/chits', auth, async (req, res) => {
  if (req.api_key) return res.status(403).json({ error: 'Forbidden', message: 'Sign in to see the Home figures.' });
  try {
    res.json(await home.railChits({ entity: auth.entityOf(req), actor: req.identity && req.identity.identity_id, req }));
  } catch (e) { res.status(500).json({ error: 'Failed', message: safeErr(e) }); }
});

router.get('/:card', auth, async (req, res) => {
  const build = Object.prototype.hasOwnProperty.call(home.BUILD, req.params.card) ? home.BUILD[req.params.card] : null;
  if (!build) return res.status(404).json({ error: 'Not found', message: 'There is no Home card called "' + String(req.params.card).slice(0, 40) + '".' });
  if (req.api_key) return res.status(403).json({ error: 'Forbidden', message: 'Sign in to see the Home figures.' });
  try {
    const entity = auth.entityOf(req);
    res.json(await build({ entity, actor: req.identity && req.identity.identity_id, req }));
  } catch (e) { res.status(500).json({ error: 'Failed', message: safeErr(e) }); }
});

module.exports = router;
