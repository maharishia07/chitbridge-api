'use strict';
/**
 * middleware/books-auth.js — ACTING FOR A MEMBER'S BOOKS, READ ONLY (ACC-176): the middleware of the BOOKS ROUTER ONLY that turns a granted request into a synthetic auditor of the member.
 * OWNS      the allow-list of GET routes an auditor may read (GRANT_READS) and the ones held back (GRANT_HELD_BACK) · unclassifiedGets(router) · afterAuth(auth) — the books router's `auth`, then the grant · the synthetic identity.
 * CALLED BY routes/books.js (its one `auth` constant: this IS middleware/auth plus the grant, so the API register still reads it as the sign-in) · tests/acc-176-*.
 * FLOW      auth (the real caller, the parent's owner or its auditor) → no X-Books-For header: nothing changes → the header names a member → ONE look (lib/books-grant.look: the live grant, the live edge, the log row)
 *           → refused: 403 in words (the log row says why) · allowed: req.identity becomes { actor of the member, commenter, whole entity, costs as the grant says }, req.realIdentity keeps the caller, the rest of the
 *           request runs BEGIN READ ONLY (lib/reqctx runReadOnly → db beginSql). Nothing else is added: entityOf, isOwner, levelOf, the hat gate and the books gates read that identity as they read any auditor.
 * CARD      04-network/ACC-176-AUDITOR-GRANT
 * ⚠️ auth.entityOf IS NOT CHANGED (267 call sites): the member's id is the synthetic identity's parent_entity_id, taken ONLY from the grant row, never from the header, a query or a body.
 * ⚠️ AN ALLOW-LIST, NOT A DENY-LIST: a GET not in GRANT_READS is refused (a new route is born closed); every other method is refused. tests/acc-176-grant-classification.test.cjs fails a books GET in neither list.
 * ⚠️ FAILS CLOSED: any failure of the look (the log row included) answers 503 in words; it never falls back to the caller's own books or to an open answer.
 */
const reqctx = require('../lib/reqctx');
const grants = require('../lib/books-grant');
const { problem } = require('../lib/problem');

const HEADER = 'x-books-for';

/** GET routes of routes/books.js an auditor may read: the books' figures and lists, no party contact data, nothing that stores into the member's books */
const GRANT_READS = new Set([
  '/accounts', '/daybook', '/ledger/:account', '/trial-balance', '/pl', '/bs', '/dues', '/cashflow', '/periods', '/year/:fy/status',
  '/terms', '/fx-rates', '/health', '/cheques', '/bank/rail', '/returns', '/status'
]);
/** GET routes held back from v1, each with its reason: the classification test needs every books GET in one list or the other */
const GRANT_HELD_BACK = {
  '/party/:id/statement': 'party names, phones, bank details (C6: only after cb-country confirms per country)',
  '/payments/:id/advice': 'bank details of a payee (C6)',
  '/compare': 'stores into the member books',
  '/compare/:id': 'stores into the member books',
  '/compare/:id/csv': 'a copy of books data (no export)',
  '/events': 'internal events',
  '/move-in/imports': 'import history of the owner',
  '/packs': 'owner documents',
  '/packs/:id': 'owner documents',
  '/packs/:id/file': 'a file download (no export)',
  '/recurring': 'owner schedule',
  '/todo': 'owner to-do list',
  '/assets': 'owner register',
  '/fx-revalue': 'a preview that reads like a write'
};

/** unclassifiedGets(router) → the GET routes of a router in neither GRANT_READS nor GRANT_HELD_BACK (the classification test: a new GET must be classified before it ships; empty = honest) */
function unclassifiedGets(router) {
  const gets = router.stack.filter((layer) => layer.route && layer.route.methods.get).map((layer) => layer.route.path);
  return gets.filter((path) => !GRANT_READS.has(path) && !(path in GRANT_HELD_BACK));
}

/** is this identity one the parent may use a grant with: its owner, or a person holding the auditor preset (commenter, whole entity, sees costs) */
function mayUseGrant(req) {
  const holder = req.identity;
  if (!holder || req.api_key) return false;
  if (holder.identity_type !== 'actor') return !holder.parent_entity_id;
  return holder.access_level === 'commenter' && holder.whole_entity === true && holder.can_see_costs === true;
}

/** the synthetic auditor of the member: the existing auditor preset, as a value */
function syntheticOf(real, grant) {
  return {
    identity_id: real.identity_id,
    bridge_id: real.bridge_id,
    display_name: real.display_name,
    identity_type: 'actor',
    parent_entity_id: grant.grantor_entity,
    owner_scope: null,
    hat: 'audit',
    access_level: 'commenter',
    whole_entity: true,
    can_see_costs: grant.can_see_costs === true,
    acting_for_grant: grant.grant_id
  };
}

/** the request's shape for the log: its query keys only, never the values */
const shapeOf = (req) => Object.keys(req.query || {}).sort().slice(0, 12).join(',') || null;

/** refuse in words with the old { error, message } keys beside the Problem */
function refuse(req, res, status, code, words) {
  return problem(req, res, { status, code, detail: words, legacy: { error: words, message: words } });
}

/** the real caller's own entity: the business (an owner) or the business its person acts for */
const entityOfReal = (real) => real.parent_entity_id || real.identity_id;

/** the one look of this request: the member the header names, the route and the shape of the question */
async function decide(req) {
  const member = String(req.headers[HEADER] || '').trim();
  const pattern = req.method + ' ' + (req.route && req.route.path);
  const base = { actor: req.identity.identity_id, pattern, method: req.method, listed: GRANT_READS.has(req.route && req.route.path), query_shape: shapeOf(req) };
  if (!grants.UUID.test(member)) return { bad: true };
  return grants.look(entityOfReal(req.identity), member.toLowerCase(), base);
}

/**
 * afterAuth(auth) → the books router's `auth`: the real sign-in first, then the grant. Carries every property of auth (entityOf, requireScope …) so `auth.entityOf` still reads the same.
 * A request with no X-Books-For header passes through as it always did.
 */
function afterAuth(auth) {
  const gated = (req, res, next) => {
    auth(req, res, (err) => {
      if (err) return next(err);
      if (req.acting_for_grant || !req.headers[HEADER]) return next();
      actOn(req, res, next).catch((failure) => answerFailure(req, res, failure));
    });
  };
  Object.defineProperty(gated, 'name', { value: 'auth' }); /* tools/api-register.cjs reads a route's sign-in by this name */
  return Object.assign(gated, auth);
}
/** the failure of a look is a refusal in words: never the caller's own books, never an open answer */
function answerFailure(req, res, failure) {
  if (failure && failure.words) return refuse(req, res, failure.status || 503, failure.code, failure.words);
  const words = 'We could not record this look at the books, so nothing was shown. Try again in a minute.';
  require('../lib/logger').error('books grant: the look failed, answered 503', { code: (failure && failure.code) || null });
  return refuse(req, res, 503, 'BOOKS_GRANT_LOG_UNAVAILABLE', words);
}
/** a request that names a member: who may, the look, then the synthetic auditor and READ ONLY for the rest of the request */
async function actOn(req, res, next) {
  if (!mayUseGrant(req)) {
    const words = 'Only an owner, or a person with the auditor role, can open another business\'s books.';
    return refuse(req, res, 403, 'BOOKS_GRANT_NOT_FOR_YOU', words);
  }
  const verdict = await decide(req);
  if (verdict.bad) return refuse(req, res, 403, 'BOOKS_GRANT_NONE', 'No access has been given for these books.');
  if (!verdict.allowed) return refuse(req, res, verdict.status, verdict.code, verdict.words);
  req.realIdentity = req.identity;
  req.identity = syntheticOf(req.realIdentity, verdict.grant);
  req.acting_for_grant = verdict.grant.grant_id;
  return reqctx.runReadOnly(() => next());
}

module.exports = Object.assign(afterAuth(require('./auth')), { afterAuth, GRANT_READS, GRANT_HELD_BACK, HEADER, mayUseGrant, syntheticOf, unclassifiedGets });
