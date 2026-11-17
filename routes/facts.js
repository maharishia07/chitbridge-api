/**
 * OWNS      /api/facts: what each Home card says (lines, figures, state) and the chits behind the rail's In · Out · Stuck.
 * CALLED BY server.js (mounted at /api/facts), the shell's Home cards (public/app/shell.js) and the rail.
 * FLOW      auth → a key is refused → schema check (lib/facts-contract.js) → lib/home-facts → the answer; a refusal → problem(req, res, { status, ...said(...) }), its old body frozen in docs/contracts/api-legacy.json
 * CARD      28-platform-and-operations/facts-route
 * /api/facts — WHAT EACH HOME CARD SAYS (N18, 2026-10-08).
 *
 *   GET /api/facts/:card   card ∈ till · counters · account · reports · accounts · orders · operations · disputes · assist · people · finance · product-lab · combo-lab · offer-lab · tax-lab · country-lab · marketing (MKT-SRV1 G3: who agreed to offers) · crm · trend · storefront · compare (WALK2 W3) → { lines: [{ text, value?, tone? }], figures?, state }
 *   GET /api/facts/rail/chits  -> { overdue_days, truncated, items:[{ chit_id, tab:in|out, stuck, why, ... }] } - the chits behind the rail's numbers
 *   GET /api/facts/rail                                                                    → { suppliers, customers, in, out, stuck }
 *   state (every card, rail too): 'needs_you' (a line has tone 'dn') · 'in_use' (has data, nothing pending) · 'not_started' (never used: a card says so from its own figure). Default in home.withState.
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
const { problem, internalSpec } = require('../lib/problem'); // API-STANDARD S1: the one error writer
const { schemaValidate } = require('../middleware/validate'); // S9: the request is checked against the route's own schema
const { SAFE_SENTENCE } = require('../lib/respond');
const { said, keyRefused, operationFor, pathsOf } = require('../lib/facts-contract'); // the contract (each route's operation) and the words of a refusal
const home = require('../lib/home-facts');
/** the schema check of one route (its own operation in lib/facts-contract.js), as a list to spread after the gates: a route that takes no input has none */
function checked(route) {
  const operation = operationFor(route);
  return operation.parameters || operation.requestBody ? [schemaValidate(operation)] : [];
}
/** a fault of ours: the screen's old words, nothing of the cause (the real error is logged with the request id) */
const failed = (e, req) => internalSpec(req, e, { error: 'Failed', message: SAFE_SENTENCE });

/* the chits behind the rail's In · Out · Stuck (H1): the same rows and the same overdue test as the counts. Before /:card, which would call it a card. */
router.get('/rail/chits', auth, ...checked('GET /rail/chits'), async (req, res) => {
  if (req.api_key) return problem(req, res, { status: 403, ...keyRefused() });
  try {
    res.json(await home.railChits({ entity: auth.entityOf(req), actor: req.identity && req.identity.identity_id, req }));
  } catch (e) {
    problem(req, res, failed(e, req));
  }
});

router.get('/:card', auth, ...checked('GET /:card'), async (req, res) => {
  const build = Object.prototype.hasOwnProperty.call(home.BUILD, req.params.card) ? home.BUILD[req.params.card] : null;
  if (!build) return problem(req, res, { status: 404, ...said('NOT_FOUND', 'Not found', 'There is no Home card called "' + String(req.params.card).slice(0, 40) + '".') });
  if (req.api_key) return problem(req, res, { status: 403, ...keyRefused() });
  try {
    const entity = auth.entityOf(req);
    res.json(await build({ entity, actor: req.identity && req.identity.identity_id, req }));
  } catch (e) {
    problem(req, res, failed(e, req));
  }
});

router.openapi = { paths: pathsOf(), schemas: {} };
module.exports = router;
