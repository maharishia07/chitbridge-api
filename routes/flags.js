// OWNS      /api/flags: PRIVATE BOOKMARKS AND NOTES — a person's own bookmark or note on a record (a posting, a client), kept in the person's OWN organisation, never in the client's. A firm, an accountant and a business each keep their own and never see another's.
// CALLED BY server.js (mounted at /api/flags), the Day book row control and the flags list (web, a later slice).
// FLOW      auth → noKey → the schema check (lib/flags-contract) → lib/private-flag (the ONE module that names the table) → the answer; a refusal → problem(req, res, refusal in words)
// CARD      PM/REQ-PRIVATE-NOTES-BOOKMARKS-2026-11-17.md
// ⚠️⚠️ THIS ROUTER NEVER MOUNTS THE BOOKS GRANT FRONT AND NEVER READS THE X-BOOKS-FOR HEADER. Under a grant the database scope is the CLIENT's; a flag written there would land in the client's organisation and the client would read it. The caller's own binding only (as POST /api/books-grants/practice/baseline).
//      tests/private-flag-isolation.realstack.cjs fails if this file names either.
// Not found and not allowed answer the SAME 404 (no existence oracle). Nothing here leaves the installation: no CTP, no WhatsApp, no mail. Replies (slice A4) are not here.
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { problem, fromError } = require('../lib/problem');
const { declaresStatuses } = require('../lib/contract-kit');
const contract = require('../lib/flags-contract');
const flags = require('../lib/private-flag');

/** a key is not a person: a device key reads no flag */
function noKey(req, res, next) {
  if (!req.api_key) return next();
  return problem(req, res, { status: 403, code: 'SIGN_IN_FOR_FLAGS', detail: 'Sign in to work on your notes and bookmarks.' });
}
/** run a handler body and answer; a typed refusal is answered in words, anything else is a fault of ours (a 500 that says nothing of its cause) */
const statusOf = (ok) => ok || 200;
const handler = (work, okStatus) => async (req, res) => {
  try {
    res.status(statusOf(okStatus)).json(await work(req));
  } catch (err) {
    if (err && err.words) return problem(req, res, { status: err.status || 500, code: err.code, detail: err.words });
    return fromError(req, res, err);
  }
};

// @does Record ids of one client (at most 200) in a body -> we read the flags of those records in your own organisation in one read -> the flags by record, or 404.
router.post('/query', auth, noKey, declaresStatuses([404, 503]), ...contract.checked('POST /query'), handler((req) => flags.forSubjects(req, req.body)));

// @does Optional client, kind and page in -> we list your organisation's open flags that you may read, newest first -> the page of flags and the total.
router.get('/', auth, noKey, declaresStatuses([404, 503]), ...contract.checked('GET /'), handler((req) => flags.listOpen(req, req.query)));

// @does Nothing in -> we count the open flags you may read, in one read -> how many, and how many bookmarks and notes.
router.get('/counts', auth, noKey, declaresStatuses([404, 503]), ...contract.checked('GET /counts'), handler((req) => flags.counts(req)));

// @does A kind, who sees it, a client, records with their labels (or one note) in -> we keep the flags in your own organisation, never the client's -> how many were made and the flags.
router.post('/', auth, noKey, declaresStatuses([404, 503]), ...contract.checked('POST /'), handler((req) => flags.add(req, req.body), 201));

// @does A flag id in -> we resolve that note; it stays, greyed, with who and when -> the flag.
router.post('/:id/resolve', auth, noKey, declaresStatuses([404, 409, 503]), ...contract.checked('POST /:id/resolve'), handler((req) => flags.resolve(req, req.params.id)));

// @does A flag id in -> we open that resolved note again -> the flag.
router.post('/:id/reopen', auth, noKey, declaresStatuses([404, 409, 503]), ...contract.checked('POST /:id/reopen'), handler((req) => flags.reopen(req, req.params.id)));

// @does A flag id in -> we share that Only-me flag with your organisation (its writer only) -> the flag.
router.post('/:id/share', auth, noKey, declaresStatuses([404, 409, 503]), ...contract.checked('POST /:id/share'), handler((req) => flags.share(req, req.params.id)));

// @does A flag id in -> we remove that bookmark or note; the words are gone, who and when stay -> the flag.
router.post('/:id/remove', auth, noKey, declaresStatuses([404, 409, 503]), ...contract.checked('POST /:id/remove'), handler((req) => flags.remove(req, req.params.id)));

// @does A client and optionally two days in -> we remove that client's open bookmarks in one act -> how many were cleared.
router.post('/clear', auth, noKey, declaresStatuses([404, 503]), ...contract.checked('POST /clear'), handler((req) => flags.clearBookmarks(req, req.body)));

router.openapi = { paths: contract.pathsOf() };
module.exports = router;
