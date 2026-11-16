'use strict';
/**
 * middleware/books-area-gate.js — STAFF SEE NO BOOKS UNLESS THE OWNER OPENED THE ACCOUNTS FOR THEM (W15-66): the router-level ALLOW-LIST of /api/books.
 * OWNS      the one gate in front of every route of routes/books.js AND routes/books-money.js (the same mount) · the sentence a closed door answers (CLOSED_WORDS) · bankWriter (the route-level gate of the bank writes).
 * CALLED BY routes/books.js (one `router.use`, right after middleware/books-grant) · tests/l16-staff-areas.test.cjs.
 * FLOW      no X-Books-For header: it SIGNS IN ITSELF (middleware/auth: the books-grant front runs before any route's own auth and does nothing without the header, so req.identity is unset when it would run; the
 *           routes' own `auth` then re-enters on the DECIDED request, as it always does) → a request acting for a firm's grant passes (middleware/books-grant allow-listed it) → the owner passes → an API key is refused
 *           (the ledger takes a person) → a person: lib/books-areas.classOf(method, path) names the class, lib/areas.holds says whether this person holds the level it needs → else 403 in words (may:false, why).
 * CARD      18-identity-sign-in-and-access/access-levels
 * ⚠️ FAILS CLOSED: a route in no row of lib/books-areas.TABLE has no class and answers 403 to every person who is not the owner; a failure of the sign-in is auth's own answer (401), never a pass.
 * ⚠️ Public paths under /api/books: none. Every route of both routers carries `auth` (tests/l16-staff-areas.test.cjs reads each route's own stack), so no request that was public before is refused here.
 */
const auth = require('./auth');
const { problem } = require('../lib/problem');
const { isOwner, OWNER_ONLY, OWNER_ONLY_WORDS } = require('../lib/owner');
const areas = require('../lib/areas');
const { classOf, needs, OWNER } = require('../lib/books-areas');

/** the one area this gate enforces (v1); lib/areas.GRANTABLE must equal ENFORCED (tests/l16-staff-areas.test.cjs): a grantable area that nothing enforces is a lie on a screen */
const AREA = 'accounts';
const ENFORCED = Object.freeze([AREA]);
const CLOSED = 'BOOKS_AREA_CLOSED';
/** what a closed door says (the screen shows it as is; the code is the word a screen branches on) */
const CLOSED_WORDS = 'Your access does not include the books. Ask the owner.';
const NO_WORK_WORDS = 'Your access to the books is read only. Ask the owner.';
const KEY_WORDS = 'Sign in as a person to use the ledger.';

/** the one refusal: 403 through the one problem shape, with the old { error, message } keys and the may/why a screen greys the action with */
function refuse(req, res, code, words) {
  return problem(req, res, { status: 403, code, detail: words, legacy: { error: words, message: words, code, may: false, why: words } });
}

/** the verdict for a person who is neither the owner nor acting for a firm's grant: null = pass, or the refusal to answer */
function verdictFor(req) {
  const doorClass = classOf(req.method, req.path);
  if (doorClass === null) return { code: CLOSED, words: CLOSED_WORDS };
  if (doorClass === OWNER) return { code: OWNER_ONLY, words: OWNER_ONLY_WORDS };
  const need = needs(doorClass);
  if (areas.holds(req.identity, AREA, need)) return null;
  /* a person who reads the books but may not write them hears so (a View-only person granted `work` is capped at read) */
  return areas.holds(req.identity, AREA, 'see') ? { code: CLOSED, words: NO_WORK_WORDS } : { code: CLOSED, words: CLOSED_WORDS };
}

/** the gate once the caller is signed in */
function decide(req, res, next) {
  if (req.acting_for_grant || isOwner(req)) return next();
  if (req.api_key) return refuse(req, res, 'SIGN_IN_FOR_LEDGER', KEY_WORDS);
  const verdict = verdictFor(req);
  return verdict ? refuse(req, res, verdict.code, verdict.words) : next();
}

/** gateOf(signIn) → the router-level middleware (the sign-in is a parameter so a test can stand its own in) */
function gateOf(signIn) {
  return (req, res, next) => {
    if (req.method === 'OPTIONS' || req.acting_for_grant) return next();
    signIn(req, res, (err) => (err ? next(err) : decide(req, res, next)));
  };
}

/**
 * bankWriter — the route-level gate of the bank writes (POST /bank/marks · POST /bank/statements): the owner, or a person who holds `work` on the accounts; then the ledger's own level gate (`editor`) as before, so a
 * View-only person granted `work` is still refused. Written beside the router-level gate on purpose: the table closes a new door, this names the three writes the owner can open.
 */
function bankWriter(editor) {
  const gate = (req, res, next) => (isOwner(req) || areas.holds(req.identity, AREA, 'work') ? editor(req, res, next) : refuse(req, res, CLOSED, areas.holds(req.identity, AREA, 'see') ? NO_WORK_WORDS : CLOSED_WORDS));
  gate.roleGate = 'editor'; /* tools/api-reported.cjs: a route carrying this gate is role-gated (bfla_role_check) */
  return gate;
}

module.exports = Object.assign(gateOf(auth), { gateOf, bankWriter, decide, verdictFor, ENFORCED, CLOSED, CLOSED_WORDS, NO_WORK_WORDS, KEY_WORDS });
