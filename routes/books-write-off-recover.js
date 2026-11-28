'use strict';
/**
 * routes/books-write-off-recover.js — A WRITTEN-OFF DEBT PAID LATER (ACC-418, batch 1138): the recovery door beside POST /api/books/write-off.
 * OWNER     cb-accounting
 * RISK      money
 * OWNS      POST /api/books/write-off/recover
 * CALLED BY server.js (mounted beside routes/books.js at /api/books)
 * FLOW      auth → owner → on → schemaValidate → the strict amount reader → lib/books-bad-debt.adjusted (the invoice's own GST figures) → books.postEntry (the engine's write_off_recovery: Dr where it came in · Cr bad debts · Cr output tax) → the entry
 * CARD      14-accounting/ledger-accounts-day-book-entries-reverse
 * The route NEVER computes GST: the engine splits (posting-bad-debt), the route only reads the invoice's figures and posts once per client_ref (source_ref wr:<ref>, the event guard: a reused ref with another amount is 409 EVENT_REF_REUSED).
 * Why its own file: routes/books.js may not grow (filesize ratchet). Owner-only, enforced HERE as on the write-off door (the screen does not check the role).
 */
const express = require('express');
const router = express.Router();
router.use(require('../middleware/books-grant')); /* ACC-176: a request that names a member's books (X-Books-For) is read through the grant; no header, no effect */
const auth = require('../middleware/auth');
const { problem } = require('../lib/problem');
const { refusalOf } = require('../lib/books-contract');
const { owner, on, checked, refuse } = require('./books').gates;
const CLOCK = require('../lib/shop-clock');
const books = require('../lib/books');
const { clientRef } = require('../lib/books-input');
const period = () => require('../lib/books-period');
const curOf = (req) => books.curOf(req.books);
const byOf = (req) => (req.identity && req.identity.identity_id) || null;
const dateQ = (value, fallback) => period().dateGiven(value, null, fallback);
/** what came in, as minor units, by the ONE strict amount reader (the write-off door's): a plain 400 "How much?" when it is not a whole number above nothing */
const minorOf = (input, currency) => period().amountOf(input, 'amount', currency, { ask: 'How much?', zero: true, plain: 'How much?' });

// @does An amount a written-off customer paid later and where it came in -> we post the recovery once per client_ref, the GST given back as the engine splits it -> the entry (owner only).
router.post('/write-off/recover', auth, owner, on, ...checked('POST /write-off/recover'), async (req, res) => {
  try {
    const body = req.body || {};
    const ref = clientRef(body.client_ref);
    const recoveredMinor = minorOf(body, curOf(req));
    if (!(recoveredMinor > 0)) return refuse(req, res, 400, 'BOOKS_BAD_REQUEST', 'How much?', 'How much?');
    const entity = auth.entityOf(req);
    const recovery = {
      type: 'write_off_recovery',
      owner: true,
      amount: require('../lib/books-cashflow').fromMinor(recoveredMinor, curOf(req)),
      reason: body.reason,
      into: body.into == null ? 'cash' : String(body.into),
      currency: curOf(req),
      strict_date: true,
      date: dateQ(body.date, CLOCK.today(req.books)),
      against_ref: body.against_ref ? String(body.against_ref) : null,
      source_ref: ref ? 'wr:' + ref : null,
      doc_ref: 'wr:' + (body.against_ref ? String(body.against_ref) : 'none') + ':' + (ref || CLOCK.nowMs()),
      by: byOf(req)
    };
    /* the GST inside the recovery is the ENGINE's; the route only hands it the invoice's own figures (adjusted) and the event guard */
    const found = await require('../lib/books-bad-debt').adjusted(entity, recovery);
    const out = await books.postEntry(null, entity, found.event, require('../lib/books-event-guard').guardOf(entity, found.event));
    res.json({ ok: out.ok, off: out.off, duplicate: out.duplicate, entry_id: out.entry_id, entry_no: out.entry_no, posting_date: out.posting_date, doc_date: out.doc_date, moved: out.moved, lines: out.lines, items: out.items, note: [out.note, found.note].filter(Boolean).join(' ') || out.note });
  } catch (err) {
    problem(req, res, refusalOf(err, req));
  }
});

module.exports = router;
