'use strict';
/**
 * routes/books-events-batch.js — POST /api/books/events/batch (SPD bank Add): a statement's lines post in ONE request (split out of routes/books.js, 1129).
 * OWNER     cb-accounting
 * RISK      money
 * OWNS      the door only: the gates, the 400 and 409 answers and the receipt in the body. The capability is lib/books-events-batch.postEventsBatch (CAP-BOOKS-EVENTS-BATCH).
 * CALLED BY server.js (mounted beside routes/books.js at /api/books); the bank Add on the Ledger screen.
 * FLOW      auth → noKey → ownerOrAccountant (owner or manager seat, no adviser door) → on → contract check → postEventsBatch → { posted, failed, results, + the receipt }
 *           a batch not taken answers 400 BOOKS_BAD_REQUEST or 409 BOOKS_BATCH_HELD (the old {error, message} keys beside the Problem); any other fault → problem(refusalOf)
 * CARD      14-accounting/ledger-accounts-day-book-entries-reverse
 */
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { problem } = require('../lib/problem');
const { refusalOf } = require('../lib/books-contract');
const { postEventsBatch } = require('../lib/books-events-batch');
const { noKey, ownerOrAccountant, on, checked, refuse } = require('./books').gates;

/**
 * POST /events/batch { events: [ { kind, ... } x 1..100 ] } → { posted, failed, results: [ { index, client_ref, ok, duplicate?, entry_no?, posting_date? | status, code, detail } ], ok, capability, request_id, written, held, refused }
 * the lines go through the SAME event writer as POST /events (each keeps its own client_ref, so a retry posts nothing twice); a refused line is named by index and the rest post.
 */
// @does A list of up to 100 events in -> we post each one through the one event writer -> one result per line (owner or accountant).
router.post('/events/batch', auth, noKey, ownerOrAccountant, on, ...checked('POST /events/batch'), require('../lib/books-approval').grantProposeGate(refusalOf), async (req, res) => {
  try {
    const entity = auth.entityOf(req);
    const batch = await postEventsBatch({
      entity, books: req.books, by: (req.identity && req.identity.identity_id) || null, request_id: req.id || null,
      isHeld: () => require('../lib/books-approval').bindsRequest(req, entity),
      said: (err) => refusalOf(err, req)
    }, req.body && req.body.events);
    if (batch.refusal) return refuse(req, res, batch.refusal.status, batch.refusal.code, batch.refusal.detail, batch.refusal.detail);
    res.json({ posted: batch.posted, failed: batch.failed, results: batch.results, ok: batch.ok, capability: batch.capability, request_id: batch.request_id, written: batch.written, held: batch.held, refused: batch.refused });
  } catch (err) {
    problem(req, res, refusalOf(err, req));
  }
});

module.exports = router;
