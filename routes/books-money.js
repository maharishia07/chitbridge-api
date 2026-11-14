'use strict';
/**
 * routes/books-money.js — THE ONE ROUTE THAT CLOSES AN OPEN MONEY ITEM (ACC-206 B · Athi 2026-10-30: an overridden sale "has to be addressed").
 * OWNS      POST /api/books/money-check/resolve { chit_id, how, note? } — a sale the owner let through although the engine's money did not add up is an item on the books to-do (money_unbalanced)
 *           until someone says how it was settled. One insert in the books' change log (lib/money-check.resolve); the chit is never rewritten.
 * CALLED BY server.js (mounted beside routes/books.js at /api/books); the Ledger to-do row names it as its action.
 * FLOW      auth → noKey (a key-bearer has no business in the ledger) → editor (owner or editor; a viewer or commenter is refused in the rail's words) → on (the ledger is switched on)
 *           → schemaValidate (closed body: { how, note? }) → lib/money-check.resolve → { resolved, how, duplicate }; a refusal → problem(refusalOf)
 * CARD      14-accounting/README
 * ⭐ ACC-176 · the MEMBER's side of read-only access for its network parent lives here too (/api/books/grants: consent · list · give · change the end date · revoke · who looked), owner only, written to access_events with the grant: the
 *   auditor does not use these routes, it reads GET /api/books/* with X-Books-For (middleware/books-grant.js). Contract: lib/books-grants-contract.js; the grant itself: lib/books-grant.js. A new router file would fail the register-sums guard until the batch regenerates the register, so the doors sit in this one.
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
const { ownerOnly } = require('../lib/owner');
const grants = require('../lib/books-grant');
const grantContract = require('../lib/books-grants-contract');
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

/* ── ACC-176 · the member's doors for read-only access (owner only) ── */
const entityOf = (req) => auth.entityOf(req);
const byOf = (req) => req.identity.identity_id;
/** a key is not a person: the member's decision to open its books is made by a signed-in owner */
function grantNoKey(req, res, next) {
  if (!req.api_key) return next();
  const words = 'Sign in as the owner to change who can read your books.';
  return problem(req, res, { status: 403, code: 'SIGN_IN_FOR_BOOKS_GRANT', detail: words, legacy: { error: words, message: words } });
}
const memberOnly = ownerOnly('Only the owner can change who reads these books.');
/** a refusal of the grant store is a typed answer in words; anything else is a fault of ours (500, nothing of its cause) */
function answer(req, res, err) {
  if (err && err.words) return problem(req, res, { status: err.status, code: err.code, detail: err.words, legacy: { error: err.words, message: err.words } });
  require('../lib/logger').error('books grant route failed', { code: (err && err.code) || null });
  return problem(req, res, { status: 500, code: 'INTERNAL', detail: 'Something went wrong on our side. Nothing was changed.', legacy: { error: 'Failed', message: 'Something went wrong on our side. Nothing was changed.' } });
}

router.get('/grants/consent', auth, grantNoKey, ...grantContract.checked('GET /consent'), (req, res) => res.json(grantContract.consentWords(req.query.can_see_costs !== 'false')));

router.get('/grants', auth, grantNoKey, memberOnly, async (req, res) => {
  try {
    res.json(await grants.list(entityOf(req)));
  } catch (err) {
    answer(req, res, err);
  }
});

router.post('/grants', auth, grantNoKey, memberOnly, ...grantContract.checked('POST /'), async (req, res) => {
  try {
    const body = req.body || {};
    if (body.consent !== true) throw grants.refusal('BOOKS_GRANT_CONSENT_NEEDED', 422, 'Read what your auditor can see, then say yes.');
    res.status(201).json(await grants.give(entityOf(req), byOf(req), body));
  } catch (err) {
    answer(req, res, err);
  }
});

router.patch('/grants/:id', auth, grantNoKey, memberOnly, ...grantContract.checked('PATCH /:id'), async (req, res) => {
  try {
    res.json(await grants.change(entityOf(req), byOf(req), req.params.id, req.body || {}));
  } catch (err) {
    answer(req, res, err);
  }
});

router.post('/grants/:id/revoke', auth, grantNoKey, memberOnly, ...grantContract.checked('POST /:id/revoke'), async (req, res) => {
  try {
    res.json(await grants.revoke(entityOf(req), byOf(req), req.params.id));
  } catch (err) {
    answer(req, res, err);
  }
});

router.get('/grants/log', auth, grantNoKey, memberOnly, ...grantContract.checked('GET /log'), async (req, res) => {
  try {
    res.json({ looks: await grants.looks(entityOf(req), req.query || {}) });
  } catch (err) {
    answer(req, res, err);
  }
});

router.openapi = { paths: Object.assign({}, pathsOf([ROUTE]), grantContract.pathsOf()) };
module.exports = router;
