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
 *           maker-checker doors of routes/books-actions.js); the owner accepts through his own door, or, under adviser_posts, the server accepts for the owner in the preparer's own transaction, stamped delegated. The preset, the person's firm and the stamp come from the live grant row; the header only names which row.
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
  '/accounts', '/daybook', '/ledger/:account', '/evidence/:id', '/trial-balance', '/pl', '/bs', '/dues', '/cashflow', '/periods', '/year/:fy/status',
  '/terms', '/fx-rates', '/health', '/cheques', '/returns',
  '/party/:id/statement' /* PAST-YEARS (Athi 16 Nov): a customer's or supplier's ledger, READ ONLY, for the auditor's debtor and creditor confirmations; the same lines and the same cost-blind cut (forBooksDoor) as GET /ledger/:account?party=, no contact or bank data in it */,
  '/bank/log' /* l16 audbank (W15-71, cb-finance agrees): the reconciliation record - marks (who matched), signed months, the lines posted - open to the auditor READ ONLY (FIN-70 built it for the auditor to read); the rail stays held back */,
  '/bank/statement-files', '/bank/statement-files/:id/file' /* l16 Statements box (b872): the kept bank statements, list and download only; adding is the owner's or the adviser's (ADVISER_DOORS) */
]);
/** GET routes held back from v1, each with its reason: the classification test needs every books GET in one list or the other */
const GRANT_HELD_BACK = {
  '/bank/rail': 'returns payment_advice and the party list (held until cb-country agrees)',
  '/status': 'owner only today; an auditor reads the ledger switch only after its gate is widened (the register line moves with it)',
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
  '/attention': 'who needs the owner and why: the owner own to-do, with party names (held back like /todo; the ADVISER reads it (ADVISER_EXTRA_READS); an auditor only after cb-finance agrees, and the web does not ask in the auditor seat)',
  '/party/:id/bills': 'one party own bills with the party name: party data (held back like the party statement; open to an auditor only after cb-finance agrees)',
  '/assets': 'owner register',
  '/fx-revalue': 'a preview that reads like a write'
};
/**
 * THE ADVISER'S DOORS (ACC-176b), keyed by METHOD and the full path: the books the adviser may read (the auditor's list), the server's own preview, and the maker-checker action doors (prepare, review, return, and the queue).
 * Nothing else: an adviser has NO direct write on the books, and accept is the owner's own door (no grant is involved in it; under adviser_posts the server accepts for the owner inside the prepare, stamped delegated). A new books POST is born refused for an adviser as it is for an auditor.
 */
const ADVISER_DOORS = new Set(['POST /api/books/preview', 'GET /api/books-actions', 'GET /api/books-actions/:id', 'POST /api/books-actions', 'POST /api/books-actions/:id/review', 'POST /api/books-actions/:id/return',
  /* l16 Statements box: an adviser may KEEP a statement file for the client (a file filed against an account and period; it writes no book row, the grant stamps the row), under the live grant row and X-Books-Role: adviser, whatever the posting policy: filing is not posting */
  'POST /api/books/bank/statement-files']);
const ADVISER_TESTS = [...ADVISER_DOORS].map((door) => ({ door, test: new RegExp('^' + door.replace(/:[^/]+/g, '[^/]+') + '/?$') }));
/**
 * THE OWNER'S READS THE ADVISER ALSO MAKES (Athi: the adviser acts from the owner's perspective): the books screen's own reads that the auditor's list holds back. Still held back from the adviser, each for its reason: party statements, payment
 * advice, the bank rail (party and bank details, C6, cb-country), compare (stores), the import history, file downloads and the FX preview. An adviser GET is always read only; its writes go through /api/books-actions.
 */
const ADVISER_EXTRA_READS = new Set(['/events', '/status', '/todo', '/recurring', '/assets', '/packs', '/packs/:id', '/attention' /* l16 fable2 R2-3: the Day book's evidence counts are the owner's own to-do read, like /todo: the accountant reads them; the auditor (party names) stays held back and his page does not ask */]);
const EXTRA_TESTS = [...ADVISER_EXTRA_READS].map((pattern) => ({ test: new RegExp('^' + pattern.replace(/:[^/]+/g, '[^/]+') + '/?$') }));
const adviserReadsExtra = (path) => EXTRA_TESTS.some((item) => item.test.test(path));
/**
 * THE ADVISER'S BANK DOORS (l16 adviser-bank; Athi: "the owner doesn't look into all, only the accountant does"): the one Bank page works for an adviser as it does for the owner.
 *   reads   GET /api/books/bank/log · GET /api/books/bank/rail: any live adviser grant (the page's own reads; the rail brings the open bills the lines settle against).
 *   writes  POST /api/books/bank/marks · /bank/statements · /events · /payments: ONLY when the live grant row says posting = adviser_posts with no cap (lib/books-grant.look decides, from the row, never from the request), and ONLY the bank page's own bodies:
 *           an event of the four kinds the bank page posts, a payment, each with a client_ref of 'bank:<fingerprint>' (bankWriteBody below). Run in ONE normal transaction stamped with the grant (runActingFor), the same writers the owner's request reaches.
 * The auditor never reaches any of these (GRANT_HELD_BACK and read_only stand), and the party doors stay the owner's (BOOKS_FOR_NOT_HERE).
 */
const ADVISER_BANK_READS = new Set(['GET /api/books/bank/log', 'GET /api/books/bank/rail', 'GET /api/books/bank/statement-files'/* the box's list; its file download (:id) is the auditor list's own GRANT_READS pattern, which the adviser reads too */]);
const ADVISER_BANK_WRITES = new Set(['POST /api/books/bank/marks', 'POST /api/books/bank/statements', 'POST /api/books/events', 'POST /api/books/payments']);
const BANK_EVENT_KINDS = ['expense', 'other_income', 'contra', 'tax_payment'];
const noSlash = (path) => (path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path);
const bankRoute = (set, req) => set.has(req.method + ' ' + noSlash(fullPathOf(req)));
const bankRead = (req) => bankRoute(ADVISER_BANK_READS, req);
const bankWrite = (req) => bankRoute(ADVISER_BANK_WRITES, req);
/** the bank page's own bodies only: an event is one of its four kinds, an event or a payment carries the line's client_ref 'bank:…' (so a journal, a drawing or a capital entry is never posted through here) */
function bankWriteBody(req) {
  const door = noSlash(fullPathOf(req));
  if (door === '/api/books/bank/marks' || door === '/api/books/bank/statements') return true;
  const body = req.body || {};
  if (!/^bank:[0-9a-z:_-]{1,75}$/i.test(String(body.client_ref || ''))) return false;
  /* W15-85b: the accountant does the books for the owner, so the line in a locked month may be posted in the next open one (the same if_locked the owner sends; the entry is stamped with the firm and the grant like any adviser write). Only that word: any other value is not the bank page's body. Unlocking a month is NOT a door here: Reopen stays the owner's. */
  if (body.if_locked !== undefined && body.if_locked !== 'next_open') return false;
  /* the writer resolves the kind and the ref from inner `event`/`type` too (lib/books-manual eventOf): a body that carries any of these keys is not the bank page's body and is refused whole */
  const FOREIGN_EVENT = ['event', 'type', 'lines', 'voucher_type', 'supplier', 'party', 'party_id', 'bill', 'against_ref', 'customer'];
  if (door === '/api/books/payments') return !!body.party_id && !body.party && !body.cheque && String(body.mode || '') !== 'cheque' && !Object.keys(body).some((key) => /^cheque/.test(key)) && !body.against_ref; /* an EXISTING party (never one to make), no cheque */
  if (FOREIGN_EVENT.some((key) => body[key] !== undefined)) return false;
  return BANK_EVENT_KINDS.includes(String(body.kind || ''));
}
/** the adviser door a request is, or null */
const adviserDoor = (method, fullPath) => (ADVISER_TESTS.find((item) => item.test.test(method + ' ' + fullPath)) || {}).door || null;
/** is this request one the role may make: an auditor reads the listed GETs; an adviser reads them too and passes through the adviser doors, and only those */
const listedFor = (role, req) => (isMarks(req) ? markReadDoor(req) !== null : role === grants.ADVISER ? adviserDoor(req.method, (req.baseUrl || '') + req.path) !== null || bankRead(req) || (bankWrite(req) && bankWriteBody(req)) || (req.method === 'GET' && (listedPattern(req.path) !== null || adviserReadsExtra(req.path))) : listedPattern(req.path) !== null);

/**
 * THE MARKS ROUTER'S DOORS (MARK & QUERY, routes/marks.js, mounted at /api/marks): the same front, a third family. An allow-list again, keyed by METHOD and the full path:
 *   reads   GET /api/marks (the list, the open items) · GET /api/marks/:thread_id/messages · POST /api/marks/query (a READ with the ids in the body): the auditor and the adviser read under the grant, READ ONLY as always.
 *   writes  EXACTLY TWO: POST /api/marks (set a mark) and POST /api/marks/:thread_id/messages (a reply). They run in ONE normal transaction opened by lib/mark-door (the grant look, the insert and the log row commit or roll back together),
 *           never inside runReadOnly. Which role may set and which may reply is the adopter's policy (lib/mark-adopters), not this file.
 * ⚠️ tests/mark-write-door-classification.test.cjs fails any other non-GET on the marks router, as unclassifiedGets does for GETs.
 */
const MARK_BASE = '/api/marks';
const MARK_READ_DOORS = new Set(['GET /api/marks', 'GET /api/marks/:thread_id/messages', 'POST /api/marks/query']);
const MARK_WRITE_DOORS = new Set(['POST /api/marks', 'POST /api/marks/:thread_id/messages']);
const markTest = (door) => new RegExp('^' + door.replace(/:[^/]+/g, '[^/]+') + '/?$');
const MARK_READ_TESTS = [...MARK_READ_DOORS].map((door) => ({ door, test: markTest(door) }));
const MARK_WRITE_TESTS = [...MARK_WRITE_DOORS].map((door) => ({ door, test: markTest(door) }));
const fullPathOf = (req) => (req.baseUrl || '') + (req.path === '/' ? '' : req.path);
const isMarks = (req) => fullPathOf(req) === MARK_BASE || fullPathOf(req).startsWith(MARK_BASE + '/');
const markWriteDoor = (req) => (MARK_WRITE_TESTS.find((item) => item.test.test(req.method + ' ' + fullPathOf(req))) || {}).door || null;
const markReadDoor = (req) => (MARK_READ_TESTS.find((item) => item.test.test(req.method + ' ' + fullPathOf(req))) || {}).door || null;
/** unclassifiedWrites(router) → the non-GET routes of the marks router in neither door list ('POST /api/marks/query' as the router's path makes it); empty = honest */
function unclassifiedWrites(router) {
  const found = [];
  for (const layer of router.stack.filter((item) => item.route)) {
    for (const method of Object.keys(layer.route.methods).filter((name) => name !== 'get' && layer.route.methods[name])) {
      const door = method.toUpperCase() + ' ' + (layer.route.path === '/' ? MARK_BASE : MARK_BASE + layer.route.path);
      if (!MARK_WRITE_DOORS.has(door) && !MARK_READ_DOORS.has(door)) found.push(door);
    }
  }
  return found;
}

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
 * the SEAT a person holds in the firm, by the firm's own people settings (no new table): the firm's OWNER holds both; a team member holds the auditor seat by the auditor preset (commenter, whole entity, sees costs) and the adviser seat
 * when they may do the firm's work across every branch (editor, whole entity: the regional preset). The ONE place the seats are decided: the practice read (routes/books-grants grantUserOnly) and mayUseGrant both call it.
 * A person the firm removed is refused before this runs (middleware/auth re-reads the identity row on every request).
 */
function holdsSeat(req, role) {
  const holder = req.identity;
  if (!holder || req.api_key) return false;
  if (holder.identity_type !== 'actor') return !holder.parent_entity_id;
  if (role === grants.ADVISER) return holder.access_level === 'editor' && holder.whole_entity === true;
  return holder.access_level === 'commenter' && holder.whole_entity === true && holder.can_see_costs === true;
}

/**
 * may this identity open a client's books under a grant of this role: the seat's holder, and (W12) the accountant seat also opens a client's AUDITOR-role grant, read only, since it does the firm's work and may look.
 * Never more than the grant: the look still needs a live grant row for the role named, the held-back reads and the costs flag come from that row, and a person with neither seat is refused.
 */
function mayUseGrant(req, role) {
  return holdsSeat(req, role) || (role === grants.AUDITOR && holdsSeat(req, grants.ADVISER));
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
  const request = { actor: req.identity.identity_id, actor_name: req.identity.display_name, role: roleNamed(req), pattern: routeForLog(req.method, isMarks(req) ? fullPathOf(req) : req.path), method: isMarks(req) && markReadDoor(req) ? 'GET' : req.method /* a marks READ that carries ids in a body is a read */, listed: listedFor(role, req), query_shape: shapeOf(req), bank_write: bankWrite(req) /* the look checks the grant's posting policy for it */ };
  return grants.look(entityOfReal(req.identity), member.toLowerCase(), request);
}

/**
 * the marks WRITE variant of actOn: the caller is checked (mayUseGrant, above) and the member is named, nothing more here. NO look, NO log row and NO runReadOnly: the grant look, the insert and the log row are ONE transaction opened by
 * lib/mark-door (so a log row that cannot be written rolls the mark back), and req.identity stays the real caller (the door builds the member's context from the grant row it reads inside that transaction).
 */
function markWrite(req, res, next) {
  const member = String(req.headers[HEADER] || '').trim().toLowerCase();
  if (!grants.UUID.test(member)) return refuse(req, res, 403, 'BOOKS_GRANT_NONE', 'No access has been given for these books.');
  req.mark_door = { member, role: grants.roleOf(roleNamed(req)), real_entity: entityOfReal(req.identity), door: markWriteDoor(req) };
  return next();
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
  if (isMarks(req) && markWriteDoor(req)) return markWrite(req, res, next);
  if (isMarks(req) && !markReadDoor(req)) return refuse(req, res, 403, 'MARK_WRITE_NOT_LISTED', 'This part of the books is not open to an auditor.');
  const verdict = await decide(req);
  if (verdict.bad) return refuse(req, res, 403, 'BOOKS_GRANT_NONE', 'No access has been given for these books.');
  if (!verdict.allowed) return refuse(req, res, verdict.status, verdict.code, verdict.words);
  req.realIdentity = req.identity;
  req.identity = syntheticOf(req.realIdentity, verdict.grant);
  req.acting_for_grant = verdict.grant.grant_id;
  req.acting_firm_name = verdict.firm_name || null;
  /* the bank page's writes under an adviser_posts grant: the OWNER gates of POST /events read this flag (set here from the live grant row, never from the request) */
  if (verdict.grant.preset === grants.ADVISER && bankWrite(req)) {
    req.acting_bank_write = true;
    await require('../lib/books-action').alertBankFirst(verdict.grant.grantor_entity, { identity_id: req.realIdentity.identity_id, name: req.realIdentity.display_name, firm_name: verdict.firm_name || null, grant_id: verdict.grant.grant_id }); /* the owner's record of the first bank write, before it is made */
  }
  /* an adviser's GET is read only like an auditor's; the action doors (POST) run in one normal transaction stamped with the grant: they write ONLY the action's own step, never the books */
  if (verdict.grant.preset === grants.ADVISER && req.method !== 'GET' && !(isMarks(req) && markReadDoor(req))) return reqctx.runActingFor(verdict.grant.grant_id, () => next(), { name: req.realIdentity.display_name, firm: verdict.firm_name || null });
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

/** a request that names a client's books (X-Books-For) is for the books screens only: anywhere else the header would be ignored and the firm would act as ITSELF under a client banner, so it is refused, nothing done (ACC-176b) */
const BOOKS_HOME = /^\/api\/(books(-actions|-grants)?|marks)(\/|$)/;
const BOOKS_FOR_NOT_HERE = "This request names a client's books, which only the books screens use. Nothing was done.";
function refuseElsewhere(req, res, next) {
  if (req.headers[HEADER] === undefined || BOOKS_HOME.test(req.path)) return next();
  return problem(req, res, { status: 403, code: 'BOOKS_FOR_NOT_HERE', detail: BOOKS_FOR_NOT_HERE, legacy: { error: BOOKS_FOR_NOT_HERE, message: BOOKS_FOR_NOT_HERE } });
}

module.exports = Object.assign(frontOf(require('./auth')), { bankWriteBody, listedFor, unclassifiedWrites, MARK_READ_DOORS, MARK_WRITE_DOORS, refuseElsewhere, frontOf, ROLE_HEADER, ADVISER_DOORS, ADVISER_EXTRA_READS, adviserDoor, GRANT_READS, GRANT_HELD_BACK, HEADER, mayUseGrant, holdsSeat, syntheticOf, unclassifiedGets, listedPattern, routeForLog });
