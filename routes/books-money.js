'use strict';
/**
 * routes/books-money.js — THE ONE ROUTE THAT CLOSES AN OPEN MONEY ITEM (ACC-206 B · Athi 2026-10-30: an overridden sale "has to be addressed").
 * OWNS      POST /api/books/money-check/resolve { chit_id, how, note? } — a sale the owner let through although the engine's money did not add up is an item on the books to-do (money_unbalanced)
 *           until someone says how it was settled. One insert in the books' change log (lib/money-check.resolve); the chit is never rewritten.
 * CALLED BY server.js (mounted beside routes/books.js at /api/books); the Ledger to-do row names it as its action.
 * FLOW      auth → noKey (a key-bearer has no business in the ledger) → editor (owner or editor; a viewer or commenter is refused in the rail's words) → on (the ledger is switched on)
 *           → schemaValidate (closed body: { how, note? }) → lib/money-check.resolve → { resolved, how, duplicate }; a refusal → problem(refusalOf)
 * CARD      14-accounting/README
 * Its own file because routes/books.js answers some errors by hand: a route added there could not meet the API standard's error_shape column. The gates are the ledger's own (books.gates);
 * the operation is the ledger's contract row (lib/books-contract.js 'POST /money-check/:chit_id/resolve'). Round trips: 1 (budgeted in round-trips.budget.json).
 */
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { problem } = require('../lib/problem');
const { schemaValidate } = require('../middleware/validate');
const { refusalOf, operationFor, pathsOf } = require('../lib/books-contract');
const { noKey, editor, on } = require('./books').gates;
const CHIT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROUTE = 'POST /money-check/resolve';

/** the sale (its chit id is in the body, so the route is not addressed by a path id) is settled: confirmed as right, or answered by a credit note / a corrected bill. Owner or editor. */
router.post('/money-check/resolve', auth, noKey, editor, on, schemaValidate(operationFor(ROUTE)), async (req, res) => {
  try {
    const chitId = String((req.body && req.body.chit_id) || '');
    if (!CHIT_ID.test(chitId)) {
      const unknown = new Error('Not found');
      unknown.code = 'BOOKS_NOT_FOUND';
      throw unknown;
    }
    const outcome = await require('../lib/money-check').resolve(auth.entityOf(req), chitId, req.body || {}, req.identity && req.identity.identity_id);
    res.json(outcome);
  } catch (err) {
    problem(req, res, refusalOf(err, req));
  }
});

router.openapi = { paths: pathsOf([ROUTE]) };
module.exports = router;
