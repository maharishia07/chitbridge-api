// @stage built
// @stage-note [MKT first slice] /api/marketing — the results of the offers a shop sent: GET /came-back (reads only; no table of its own).
'use strict';
/**
 * OWNS      the Marketing results route. CALLED BY web Marketing › Who came back (public/app/cap-marketing.js).
 * FLOW      auth → noKey → lib/marketing-results.cameBack → { customers, sent_n, came_back_n, why, money, total · page · limit }
 * CARD      12-marketing/README
 *
 *   GET /api/marketing/came-back   ?page= &limit= — who was SENT an offer (a receipt in channel_outbound with status sent) and then bought within the shop's
 *                                  `came_back_days` (Settings › Business rules, default 14). Each customer lists the bills that count, so every number opens.
 *
 * WHO MAY: anyone signed in to the shop reads it (a viewer too — it changes nothing); an API key does not (the CRM's fence). The shop is the caller's own:
 * lib/marketing-results runs AS THE SHOP (withEntity), so one shop never sees another's sends or bills. THIS FILE COMPUTES NO MONEY — lib/measure does, per currency.
 */
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { safeErr } = require('../lib/respond');
const results = require('../lib/marketing-results');

/** a condition becomes a verdict with a code a screen maps to its own line — the message is never shown as-is (design rule 1) */
function noKey(req, res, next) {
  if (req.api_key) return res.status(403).json({ code: 'SIGN_IN', error: 'Sign in to use Marketing.', message: 'Sign in to use Marketing.' });
  next();
}

router.get('/came-back', auth, noKey, async (req, res) => {
  try {
    res.json(await results.cameBack(auth.entityOf(req), { query: req.query }));
  } catch (err) {
    res.status(err.status || 500).json({ error: 'Failed', message: safeErr(err) });
  }
});

module.exports = router;
