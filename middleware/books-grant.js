'use strict';
/**
 * middleware/books-grant.js — ACTING FOR A MEMBER'S BOOKS, READ ONLY (ACC-176): the router-level middleware of the BOOKS ROUTER ONLY that turns a granted request into a synthetic auditor of the member.
 * OWNS      the allow-list of GET routes an auditor may read (GRANT_READS) and the ones held back (GRANT_HELD_BACK) · unclassifiedGets(router) · frontOf(auth) · the synthetic identity.
 * CALLED BY routes/books.js (one `router.use`, on the router line) · lib/books-grants-contract.js (the consent words) · tests/acc-176-*.
 * FLOW      no X-Books-For header: nothing happens (the request is the books router's own, untouched) → a header names a member: the real sign-in (middleware/auth, which every route re-enters by its DECIDED set) → the caller
 *           must be the parent's owner or an auditor-preset person → ONE look (lib/books-grant.look: the live grant, the live edge, the log row) → refused: 403 in words (the log row says why) → allowed: req.identity becomes
 *           { actor of the member, commenter, whole entity, costs as the grant says }, req.realIdentity keeps the caller, the rest of the request runs BEGIN READ ONLY (lib/reqctx runReadOnly → db beginSql). Nothing else
 *           is added: entityOf, isOwner, levelOf, the hat gate and the books gates read that identity as they read any auditor.
 * CARD      04-network/ACC-176-AUDITOR-GRANT
 * ⚠️ auth.entityOf IS NOT CHANGED (267 call sites) and no route's own gate list is touched: the member's id is the synthetic identity's parent_entity_id, taken ONLY from the grant row, never from the header, a query or a body.
 * ACC-176b · A SECOND, SEPARATE ROLE: X-Books-Role: adviser picks the member's ADVISER grant (the auditor's is the default, and can only read). An adviser has NO direct write on the books: it passes only ADVISER_DOORS (the server's own preview and the
 *           maker-checker doors of routes/books-actions.js); the owner accepts, through his own door. The preset, the person's firm and the stamp come from the live grant row; the header only names which row.
 * ⚠️ AN ALLOW-LIST, NOT A DENY-LIST: a GET not in GRANT_READS is refused (a new route is born closed); every other method is refused. tests/acc-176-grant-classification.test.cjs fails a books GET in neither list.
 * ⚠️ FAILS CLOSED: any failure of the look (the log row included) answers 503 in words; it never falls back to the caller's own books or to an open answer.
 */
const reqctx = require('../lib/reqctx');
const grants = require('../lib/books-grant');
const { problem } = require('../lib/problem');

const HEADER = 'x-books-for';
/** which of the member's two grants the request asks to work under: it picks the ROW, never what the row allows (that comes from the grant); absent means the auditor's, which can only read */
const ROLE_HEADER = 'x-books-role';

/** GET routes of routes/books.js an auditor may read: the books' figures and lists, no party contact data, nothing that stores into the member's books */
const GRANT_READS = new Set([
  '/accounts', '/daybook', '/ledger/:account', '/trial-balance', '/pl', '/bs', '/dues', '/cashflow', '/periods', '/year/:fy/status',
  '/terms', '/fx-rates', '/health', '/cheques', '/returns'
]);
/** GET routes held back from v1, each with its reason: the classification test needs every books GET in one list or the other */
const GRANT_HELD_BACK = {
  '/bank/rail': 'returns payment_advice and the party list (held until cb-country agrees)',
  '/status': 'owner only today; an auditor reads the ledger switch only after its gate is widened (the register line moves with it)',
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
/**
 * THE ADVISER'S DOORS (ACC-176b), keyed by METHOD and the full path: the books the adviser may read (the auditor's list), the server's own preview, and the maker-checker action doors (prepare, review, return, and the queue).
 * Nothing else: an adviser has NO direct write on the books, and accept is the owner's own door (no grant is ever involved in it). A new books POST is born refused for an adviser as it is for an auditor.
 */
const ADVISER_DOORS = new Set(['POST /api/books/preview', 'GET /api/books-actions', 'GET /api/books-actions/:id', 'POST /api/books-actions', 'POST /api/books-actions/:id/review', 'POST /api/books-actions/:id/return']);
const ADVISER_TESTS = [...ADVISER_DOORS].map((door) => ({ door, test: new RegExp('^' + door.replace(/:[^/]+/g, '[^/]+') + '/?$') }));
/**
 * THE OWNER'S READS THE ADVISER ALSO MAKES (Athi: the adviser acts from the owner's perspective): the books screen's own reads that the auditor's list holds back. Still held back from the adviser, each for its reason: party statements, payment
 * advice, the bank rail (party and bank details, C6, cb-country), compare (stores), the import history, file downloads and the FX preview. An adviser GET is always read only; its writes go through /api/books-actions.
 */
const ADVISER_EXTRA_READS = new Set(['/events', '/status', '/todo', '/recurring', '/assets', '/packs', '/packs/:id']);
const EXTRA_TESTS = [...ADVISER_EXTRA_READS].map((pattern) => ({ test: new RegExp('^' + pattern.replace(/:[^/]+/g, '[^/]+') + '/?$') }));
const adviserReadsExtra = (path) => EXTRA_TESTS.some((item) => item.test.test(path));
/** the adviser door a request is, or null */
const adviserDoor = (method, fullPath) => (ADVISER_TESTS.find((item) => item.test.test(method + ' ' + fullPath)) || {}).door || null;
/** is this request one the role may make: an auditor reads the listed GETs; an adviser reads them too and passes through the adviser doors, and only those */
const listedFor = (role, req) => (role === grants.ADVISER ? adviserDoor(req.method, (req.baseUrl || '') + req.path) !== null || (req.method === 'GET' && (listedPattern(req.path) !== null || adviserReadsExtra(req.path))) : listedPattern(req.path) !== null);

/** each listed pattern as a path test: ':name' is any one segment */
const LISTED = [...GRANT_READS].map((pattern) => ({ pattern, test: new RegExp('^' + pattern.replace(/:[^/]+/g, '[^/]+') + '/?$') }));
const listedPattern = (path) => (LISTED.find((item) => item.test.test(path)) || {}).pattern || null;
/** the route as the log says it: the listed pattern, else the path with every id-like segment named :id (no value of the member's data is kept) */
const routeForLog = (method, path) => method + ' ' + (listedPattern(path) || String(path).replace(/\/[0-9a-f-]{8,}(?=\/|$)/gi, '/:id').slice(0, 120));

/** unclassifiedGets(router) → the GET routes of a router in neither GRANT_READS nor GRANT_HELD_BACK (the classification test: a new GET must be classified before it ships; empty = honest) */
function unclassifiedGets(router) {
  const gets = router.stack.filter((layer) => layer.route && layer.route.methods.get).map((layer) => layer.route.path);
  return gets.filter((path) => !GRANT_READS.has(path) && !(path in GRANT_HELD_BACK));
}

/**
 * may this identity use a grant of this role: the firm's OWNER either way; a team member by the firm's own people settings (no new table): the auditor role for a person holding the auditor preset
 * (commenter, whole entity, sees costs), the adviser role for a person who may do the firm's work across every branch (editor, whole entity: the regional preset). A person the firm removed is refused
 * before this runs (middleware/auth re-reads the identity row on every request).
 */
function mayUseGrant(req, role) {
  const holder = req.identity;
  if (!holder || req.api_key) return false;
  if (holder.identity_type !== 'actor') return !holder.parent_entity_id;
  if (role === grants.ADVISER) return holder.access_level === 'editor' && holder.whole_entity === true;
  return holder.access_level === 'commenter' && holder.whole_entity === true && holder.can_see_costs === true;
}

/** the synthetic identity of the member's books for this grant: an auditor (the existing auditor preset, as a value) or an adviser, who acts for the owner (editor level, the owner's gates on the books router) */
function syntheticOf(real, grant) {
  const adviser = grant.preset === grants.ADVISER;
  return {
    identity_id: real.identity_id,
    bridge_id: real.bridge_id,
    display_name: real.display_name,
    identity_type: 'actor',
    parent_entity_id: grant.grantor_entity,
    owner_scope: null,
    hat: adviser ? 'act' : 'audit',
    access_level: adviser ? 'editor' : 'commenter',
    whole_entity: true,
    can_see_costs: grant.can_see_costs === true,
    acting_for_grant: grant.grant_id,
    acting_preset: grant.preset /* from the live grant row only: never a header, a query or a body */
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

/** the role the request names: absent is the auditor's; a value that is no role is carried as is and finds no grant */
const roleNamed = (req) => String(req.headers[ROLE_HEADER] || '').trim() || undefined;

/** the one look of this request: the member the header names, the route and the shape of the question */
async function decide(req) {
  const member = String(req.headers[HEADER] || '').trim();
  if (!grants.UUID.test(member)) return { bad: true };
  const role = grants.roleOf(roleNamed(req));
  const request = { actor: req.identity.identity_id, actor_name: req.identity.display_name, role: roleNamed(req), pattern: routeForLog(req.method, req.path), method: req.method, listed: listedFor(role, req), query_shape: shapeOf(req) };
  return grants.look(entityOfReal(req.identity), member.toLowerCase(), request);
}

/** the failure of a look is a refusal in words: never the caller's own books, never an open answer */
function answerFailure(req, res, failure) {
  if (failure && failure.words) return refuse(req, res, failure.status || 503, failure.code, failure.words);
  require('../lib/logger').error('books grant: the look failed, answered 503', { code: (failure && failure.code) || null });
  return refuse(req, res, 503, 'BOOKS_GRANT_LOG_UNAVAILABLE', 'We could not record this look at the books, so nothing was shown. Try again in a minute.');
}

/** a request that names a member: who may, the look, then the synthetic identity: an auditor runs READ ONLY for the rest of the request, an adviser in one normal transaction stamped with the grant */
async function actOn(req, res, next) {
  if (!mayUseGrant(req, grants.roleOf(roleNamed(req)))) return refuse(req, res, 403, 'BOOKS_GRANT_NOT_FOR_YOU', "Only an owner, or a person with the auditor role, can open another business's books.");
  const verdict = await decide(req);
  if (verdict.bad) return refuse(req, res, 403, 'BOOKS_GRANT_NONE', 'No access has been given for these books.');
  if (!verdict.allowed) return refuse(req, res, verdict.status, verdict.code, verdict.words);
  req.realIdentity = req.identity;
  req.identity = syntheticOf(req.realIdentity, verdict.grant);
  req.acting_for_grant = verdict.grant.grant_id;
  req.acting_firm_name = verdict.firm_name || null;
  /* an adviser's GET is read only like an auditor's; the action doors (POST) run in one normal transaction stamped with the grant: they write ONLY the action's own step, never the books */
  if (verdict.grant.preset === grants.ADVISER && req.method !== 'GET') return reqctx.runActingFor(verdict.grant.grant_id, () => next());
  return reqctx.runReadOnly(() => next());
}

/**
 * frontOf(auth) → the router-level middleware: a request with no X-Books-For header passes through untouched; one that names a member is signed in by `auth` first (the route's own `auth` then re-enters on its DECIDED set and
 * runs the hat gate over the synthetic identity), then the grant decides.
 */
function frontOf(auth) {
  return (req, res, next) => {
    if (!req.headers[HEADER] || req.acting_for_grant) return next();
    auth(req, res, (err) => {
      if (err) return next(err);
      actOn(req, res, next).catch((failure) => answerFailure(req, res, failure));
    });
  };
}

module.exports = Object.assign(frontOf(require('./auth')), { frontOf, ROLE_HEADER, ADVISER_DOORS, ADVISER_EXTRA_READS, adviserDoor, GRANT_READS, GRANT_HELD_BACK, HEADER, mayUseGrant, syntheticOf, unclassifiedGets, listedPattern, routeForLog });
