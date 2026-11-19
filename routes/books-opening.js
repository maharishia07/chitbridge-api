'use strict';
/**
 * routes/books-opening.js — THE OPENING BALANCES PAGE'S DOORS (l16; the posting door itself, POST /opening, stays in routes/books.js).
 * OWNS      POST /api/books/opening/preview · POST /api/books/opening/replace · GET /api/books/opening · GET /api/books/opening/years
 * CALLED BY server.js (mounted beside routes/books.js at /api/books); the Accounts page's Setup › Opening balances (web public/app/cap-opening.js).
 * FLOW      auth → (owner for the two POSTs · moneyReader for the two reads) → on → schemaValidate → lib/books-opening (inside withEntity: ONE transaction) → the answer; a refusal → problem(refusalOf)
 * CARD      14-accounting/README
 * Its own file so routes/books.js (2.9k lines) gains nothing but the `require_balanced` flag. Writes go only through lib/books-opening → books.reverseEntry / books.postOpening.
 * Owner-only as POST /opening is today: delegation to an accountant is a security rule (cb-security), not this slice. The two reads answer an auditor's grant too (router.use books-grant).
 */
const express = require('express');
const router = express.Router();
router.use(require('../middleware/books-grant')); /* ACC-176: a request that names a member's books (X-Books-For) is read-only for a live grant */
const auth = require('../middleware/auth');
const { withEntity } = require('../db');
const { problem } = require('../lib/problem');
const { schemaValidate } = require('../middleware/validate');
const { refusalOf, operationFor, pathsOf } = require('../lib/books-contract');
const { noKey, owner, on, moneyReader } = require('./books').gates;
const books = require('../lib/books');
const openingLib = require('../lib/books-opening');
const dateQ = (value, fallback) => require('../lib/books-period').dateGiven(value, null, fallback);
const byOf = (req) => (req.identity && req.identity.identity_id) || null;
const ROUTES = ['POST /opening/preview', 'POST /opening/replace', 'GET /opening', 'GET /opening/years'];

/** the shop's money; a body that names another currency is refused (money is a value type: the page never types the currency in) */
function currencyOf(req) {
  const own = books.curOf(req.books),
    given = req.body && req.body.currency;
  if (given && String(given) !== own) throw books.refuse('This shop keeps its books in ' + own + ', not ' + given + '.', 'CURRENCY_MISMATCH');
  return own;
}
const dayOf = (req) => dateQ(req.body && req.body.date, require('../lib/shop-clock').today(req.books));

// @does Opening rows and a date in -> we ask the posting engine what it would post, its Difference and what would refuse, writing nothing -> the figures and the refusals (owner only).
router.post('/opening/preview', auth, owner, on, schemaValidate(operationFor('POST /opening/preview')), async (req, res) => {
  try {
    const entity = auth.entityOf(req);
    const answer = await withEntity(entity, (handle) => openingLib.previewOpening(handle, entity, { rows: (req.body || {}).rows, date: dayOf(req), currency: currencyOf(req), replace: (req.body || {}).replace === true }));
    res.json(answer);
  } catch (err) {
    problem(req, res, refusalOf(err, req));
  }
});
// @does A day, new rows and a reason in -> we reverse that day's opening entries and post the new rows in one transaction, logging each line old to new -> the new entry (owner only).
router.post('/opening/replace', auth, owner, on, schemaValidate(operationFor('POST /opening/replace')), async (req, res) => {
  try {
    const entity = auth.entityOf(req),
      body = req.body || {};
    const out = await withEntity(entity, (handle) => openingLib.replaceOpening(handle, entity, { rows: body.rows, date: dayOf(req), currency: currencyOf(req), reason: body.reason, client_ref: body.client_ref, by: byOf(req) }));
    res.json({ ok: out.ok, duplicate: out.duplicate, entry_id: out.entry_id, entry_no: out.entry_no, posting_date: out.posting_date, reversed: out.reversed, changes: out.changes, changed: out.changed });
  } catch (err) {
    problem(req, res, refusalOf(err, req));
  }
});
// @does Optionally a day in -> we read every live opening line of that day with its ledger, party, bill, who entered it and when -> the saved opening.
router.get('/opening', auth, moneyReader, on, schemaValidate(operationFor('GET /opening')), async (req, res) => {
  try {
    const entity = auth.entityOf(req);
    const day = req.query && req.query.date ? dateQ(req.query.date, null) : null;
    res.json(await withEntity(entity, (handle) => openingLib.savedOpening(handle, entity, day)));
  } catch (err) {
    problem(req, res, refusalOf(err, req));
  }
});
// @does Nothing in -> we read each year's opening and carry from the year close, the carried-out total set beside the next opening -> the year strip (read only).
router.get('/opening/years', auth, moneyReader, on, async (req, res) => {
  try {
    const entity = auth.entityOf(req);
    res.json(await withEntity(entity, (handle) => openingLib.yearsView(handle, entity)));
  } catch (err) {
    problem(req, res, refusalOf(err, req));
  }
});

router.openapi = { paths: pathsOf(ROUTES) };
module.exports = router;
