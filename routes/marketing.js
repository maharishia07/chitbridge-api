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
const { problem } = require('../lib/problem'); // API-STANDARD S1: the one error writer; each answer's old body is frozen in docs/contracts/api-legacy.json
const { schemaValidate } = require('../middleware/validate'); // S9: the request is checked against the route's own schema
const { SAID, faultOf, marketingContract: contract } = require('../lib/crm-contract'); // the contract (the route's operation) and the read's fault
const results = require('../lib/marketing-results');

/** a condition becomes a verdict with a code a screen maps to its own line — the message is never shown as-is (design rule 1) */
function noKey(req, res, next) {
  if (req.api_key)
    return problem(req, res, {
      status: 403,
      code: 'SIGN_IN',
      detail: SAID.signInMarketing,
      legacy: { error: SAID.signInMarketing, message: SAID.signInMarketing }
    });
  next();
}

router.get('/came-back', auth, noKey, schemaValidate(contract.operationFor('GET /came-back')), async (req, res) => {
  try {
    res.json(await results.cameBack(auth.entityOf(req), { query: req.query }));
  } catch (err) {
    problem(req, res, faultOf(err, req)); /* the status the error names (500 when none), the old { error, message } body */
  }
});

router.openapi = { paths: contract.pathsOf(), schemas: {} };
module.exports = router;
