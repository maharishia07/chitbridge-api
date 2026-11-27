'use strict';
/**
 * routes/books-evidence.js — A RECEIPT BESIDE AN ENTRY OF THESE BOOKS (FW2-03, cold auditor walk 27 Nov); the file's bytes are read at GET /evidence/:id in routes/books.js.
 * OWNER     cb-accounting
 * RISK      money
 * OWNS      POST /api/books/evidence
 * CALLED BY server.js (mounted beside routes/books.js at /api/books); the Day book's Attach receipt (web public/app/cap-books.js bkAttachToEntry)
 * FLOW      books-grant front (X-Books-For + a live adviser grant → the client's entity and an editor identity) → auth → noKey → editor → on → schemaValidate → lib/books-evidence-attach.put (seat, type by first bytes, size, entry of THIS shop, add-only) → the answer; a refusal → problem
 * CARD      14-accounting/ledger-accounts-day-book-entries-reverse
 * Why its own file: routes/books.js may not grow (filesize ratchet). Why a books door at all: POST /api/attachments is the firm's OWN books and refuses X-Books-For, so an adviser's file never reached the client's entry ("No such entry in these books").
 * An auditor, a reviewer seat, a key or a header with no live grant never attaches (lib/books-evidence-attach.mayAttach); the adviser door is listed in middleware/books-grant ADVISER_DOORS (filing is not posting, as the Statements box).
 */
const express = require('express');
const router = express.Router();
router.use(require('../middleware/books-grant')); /* ACC-176: a request that names a member's books (X-Books-For) is read through the grant; no header, no effect */
const auth = require('../middleware/auth');
const { problem } = require('../lib/problem');
const { schemaValidate } = require('../middleware/validate');
const { refusalOf, operationFor, pathsOf } = require('../lib/books-contract');
const { noKey, editor, on } = require('./books').gates;
const ROUTE = 'POST /evidence';

/** the statuses this door refuses with, by the code of lib/books-evidence-attach's answer (lib/attachments-contract words): the contract's declared statuses, written where the route reads them */
function evidenceRefusal(refusal) {
  const statuses = { ATTACHMENT_NOT_ENTRY_SEAT: { status: 403 }, ATTACHMENT_ENTRY_NOT_FOUND: { status: 404 }, BODY_TOO_LARGE: { status: 413 }, ATTACHMENT_TYPE_NOT_ALLOWED: { status: 415 }, ATTACHMENT_EMPTY: { status: 400 }, ATTACHMENT_ENTRY_NOT_READY: { status: 503 } };
  return Object.assign({}, refusal, statuses[refusal.code]);
}
/** POST /evidence { entry_id, name, data_base64 } → { id, name, mime, size, entry_id, duplicate? }: the owner, an editor seat, or an adviser acting for a client (the file lands in the CLIENT's books); nothing is stored on a refusal */
// @does An entry id and a file in -> we check the seat, the type by its bytes and that the entry is in these books -> the file kept beside the entry (add-only).
router.post('/evidence', auth, noKey, editor, on, schemaValidate(operationFor(ROUTE)), async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.data_base64 || !body.name) return problem(req, res, { status: 400, ...require('../lib/attachments-contract').words.entryFieldsMissing() });
    const done = await require('../lib/books-evidence-attach').put(req, auth.entityOf(req), body);
    if (done.refuse) return problem(req, res, evidenceRefusal(done.refuse));
    res.json(done.ok);
  } catch (err) {
    problem(req, res, refusalOf(err, req));
  }
});

router.openapi = { paths: pathsOf([ROUTE]) };
module.exports = router;
