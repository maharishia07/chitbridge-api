/**
 * hat-gate.js — make the co-assist HAT actually govern writes, by default, everywhere.
 * OWNS      the list of writes a View-only or Comment-only login keeps (SELF_SCOPED, SELF_SCOPED_EXACT) and why each is open
 * CALLED BY middleware/auth.js (runs it inside every signed-in route) · tests/write-route-gate.test.cjs
 * FLOW      request → auth → hat-gate → access.canEdit → next, or the self-scoped list, or 403
 * CARD      17-people-employees-hr-and-payroll/people-list-with-may-why
 *
 *
 * ⚠️⚠️ THE DEFECT: A FALSE ASSURANCE, WHICH IS WORSE THAN A GAP. The hat
 * (`view_only · act · audit · mis · manager`) has been stored, editable, and shown to owners as a choice since
 * it shipped — and enforced in exactly TWO places: auto-assignment (routes/chits.js) and connector delegation
 * (routes/connectors.js). No write path looked at it.
 *
 * So an owner could set a temp to "View-only", watch the product accept and display that, and that person could
 * still create and send chits. The owner believes the records are protected. The product knows they are not and
 * says nothing. It surfaces as a chit nobody meant to send — by then on the rail and in the counterparty's copy,
 * where nothing can recall it.
 *
 * ── ⭐⭐ WHY THIS IS ONE GATE AT THE MOUNT AND NOT 130 CALLS ON 130 ROUTES ────────────────────────────────────
 *
 * There are ~130 mutating routes. Adding `auth.requireAct` to each is a hundred-and-thirty chances to miss one,
 * and a missed one FAILS OPEN — silently permitted, forever, with nothing to notice. The next route someone
 * writes fails open too, because opting in is a thing you have to remember.
 *
 * Mounted once, before the routers, the default inverts: **anything not named below is gated**. A route I have
 * not thought about is REFUSED for a restricted hat rather than allowed, and the cost of my being wrong is a
 * person seeing "your access is set to View-only" and telling their owner — a loud, immediate, correctable
 * failure. The cost of failing open is a chit nobody meant to send.
 *
 * ⚠️ FAIL CLOSED IS ONLY DEFENSIBLE IF THE EXCEPTIONS ARE HONEST, so they are enumerated, reasoned, and narrow.
 *
 * ── WHAT IS DELIBERATELY NOT GATED ───────────────────────────────────────────────────────────────────────────
 *
 * A hat answers "what may this person do to the BUSINESS'S RECORDS" — not "may this person use the product".
 * Blocking someone's own display preferences, their own break status, or marking their own message read would be
 * petty, would break screens the person is supposed to be reading, and would teach owners that view_only is
 * unusable rather than restricted. `mis` exists to run reports; a gate that stopped it exporting would make the
 * hat self-contradictory.
 */
'use strict';
const access = require('../lib/access'); // b173 — viewer / commenter / editor
const { problem } = require('../lib/problem');

/* ⚠️ WRITE_HATS is gone — lib/access.js owns that question now. It was one of eighteen places comparing
   against 'manager' / 'audit' / 'mis' / 'view_only' across six files. */

/**
 * Paths a restricted hat may still POST/PATCH/PUT/DELETE, because they are SELF-SCOPED or read-shaped.
 * ⚠️ Matched against the path AFTER `/api`, by prefix. Keep each one narrow and say why.
 */
const SELF_SCOPED = [
  ['/entities/me/prefs', 'their own locale and appearance — a display choice, not a record'],
  ['/actors/me', 'their own profile row'],
  /**
   * ⭐ A PERSON'S OWN IDENTITY DOCUMENTS ARE THEIRS, NOT THE BUSINESS'S. b174. Athi: *"which HE can submit here
   * for verification so it become HIS record."* Filing your own PAN changes no business record and creates
   * nothing on the rail, so an access level about business records has no business refusing it — a Viewer with
   * an unverifiable identity would be a Viewer nobody could ever verify.
   *
   * ⚠️ Safe to open by PREFIX because the route takes NO identity_id: the subject is always req.identity, so
   * there is no shape of this request that files a document against somebody else.
   */
  ['/identity', 'their own identity documents — the subject is always the caller (b174)'],
  ['/actors/break', 'their own break status — a person may say they are on a break (PPL-27: a viewer keeps this)'],
  ['/auth', 'signing in cannot require permission to sign in'],
  /* M05: renew, sign out, list and end ONE'S OWN sessions. Ending someone else's session or removing a device is
     owner-only, and routes/signin.js refuses it itself — an actor is never the owner. */
  ['/signin', 'a person’s own sessions — signing out cannot require permission to sign out'],
  ['/notifications', "clearing one's own notifications changes no record — b164 writes only a dismissal (PPL-27: a viewer keeps POST /notifications/seen)"],
  /* ⚠️⚠️ '/assist' WAS HERE, BY PREFIX — and five routes under it WRITE business records (external review
     2026-09-25, fixed 2026-09-28): catalogue-adopt, catalogue-source (PUT with an empty list wipes a brand's
     shared source that every member store adopts), container, region-override, publish. A View-only co-assist
     could do all five. Asking is now opened by EXACT path below, and the writes are gated like any other. */
  ['/metrics', 'reporting — which is precisely what the mis hat is for'],
  ['/exports', 'the same']

  /**
   * ⭐⭐ MESSAGING IS NOT A WRITE TO THE RECORD. Athi, 2026-08-20: *"Though read only, you can pass messages…
   * read only is internal messaging only, not external messaging."*
   *
   * ⚠️⚠️ BEFORE THIS, A READ-ONLY CO-ASSIST COULD NOT MESSAGE AT ALL — the POST was refused outright, so an
   * auditor could see a conversation and had no way to say anything about it, even to their own colleagues.
   * That was not a decision anyone made; it fell out of a default-deny gate and an allow-list nobody added
   * messages to.
   *
   * ⚠️ THIS OPENS THE ROUTE, IT DOES NOT DECIDE WHICH MESSAGES ARE ALLOWED. Internal and external share one
   * endpoint and differ by a BODY field — the gate never sees a body. routes/chits.js refuses
   * thread_type:'external' for a read-only hat, and it landed in the SAME COMMIT as this line. Opening here
   * first would silently grant external messaging in the gap, and widening is the failure direction that does
   * not announce itself.
   */
  /* ⚠️⚠️ NOT '/chits' — SEE THE PATTERN LIST BELOW. A prefix entry here would open EVERY mutating route
     under /chits: creating a chit, changing its status, amending a line. Messaging needs ONE sub-path, and a
     prefix cannot express "one sub-path". I wrote '/chits' first and caught it before it shipped; leaving this
     note because the next person adding a nested permission will reach for the same wrong tool. */
];

/**
 * ⭐ SELF_SCOPED matches by PREFIX, which is right for a whole area ('/notifications') and wrong for one nested
 * route. These are matched WHOLE, so nothing else under the same parent is opened by accident.
 */
const SELF_SCOPED_EXACT = [
  /* MARK & QUERY: setting a mark and answering in its thread are for the people the ADOPTER names (an auditor is a commenter), not for the hat: routes/marks.js asks lib/mark-policies on every call. Exact doors, nothing else under /marks. */
  [/^[/]marks[/]?$/, 'set a mark: the adopter policy decides who (the auditor); the hat cannot see the body'],
  [/^[/]marks[/](query|[^/]+[/]messages)[/]?$/, 'a read with ids in a body, and a reply in a mark thread: the adopter policy decides who'],
  /* E11 (Fable multi-role walk 2026-11-17): the live-update ticket is read-shaped. It mints a one-time 60 s ticket for the CALLER'S OWN entity stream (routes/events.js: the entity is the caller's, never a body or path id; lib/events subscribes that id and the shared board only) and writes no record. A read-only seat (the auditor's commenter level) was refused 403 on every page and so had no live push, a stale view. Exact door, nothing else under /events. */
  /* RANK 10 (found by the real-browser e2e, QA 2026-11-17): the auditor's own check point. Mark as checked stores WHEN THIS PERSON last looked at ONE client (lib/books-baseline.setBaseline: the person's own row, no look logged, nothing of the client's changed). The auditor seat is a commenter, so the hat gate refused it with 403 and the button never worked on a real login (the route test faked the auth and could not see it). Exact door; the route itself still asks for a live grant and the practice role (grantUserOnly, req.practice_roles). */
  [/^[/]books-grants[/]practice[/]baseline[/]?$/, "an auditor own check point on one client: a row about the person own reading, never the client records"],
  /* GRANT-SEAT (Athi 20 Nov): the REVIEW of a firm's prepared action (the checker's review and return) is open to a Reviewer seat (a commenter): the door itself asks for a live ADVISER grant (routes/books-actions firmOnly / firmOrOwner), so no other commenter reaches a write through it; prepare and accept stay gated */
  [/^[/]books-actions[/][^/]+[/](review|return)[/]?$/, 'the checker review or return of an adviser action: the door asks for the live adviser grant'],
  /* DOORS SWEEP (found by a real login: POST /api/flags/query answered 403 to the auditor seat, so the private bookmark chips never drew): /api/flags is the person own PRIVATE bookmarks and notes, kept in the person own organisation, never in the client books (routes/flags.js never mounts books-grant; private-notes critic 9a26ad3c). Every write below is a row about the person own reading; the hat cannot see the body or the client, and lib/private-flag decides each call (live grant seat, "Only me", author or lead for a shared row; not found and not allowed are one 404). Exact doors, nothing else under /flags. */
  [/^[/]flags[/]?$/, "add my private bookmark or note on a record: a row in my own organisation, never the client records"],
  [/^[/]flags[/](query|clear)[/]?$/, "query: a READ with ids in a body; clear: remove my own open bookmarks of one client; both private to me and my organisation"],
  [/^[/]flags[/][^/]+[/](resolve|reopen|share|remove)[/]?$/, "close, reopen, share with my own organisation, or remove one flag; lib/private-flag decides by author and seat, a flag is never the client record"],
  [/^[/]flags[/][^/]+[/]messages[/]?$/, "a reply on my firm's own note: one message in my own organisation, never the client's; lib/private-flag decides by seat and the note's state"],
  [/^[/]entities[/]me[/]preview-token[/]?$/, 'the owner preview key: mints a 15-minute READ key for the caller own shop (lib/preview-token.js), writes nothing; a viewer previews the shop it works for'],
  [/^[/]events[/]ticket[/]?$/, 'the live-update ticket: reads, writes no record, carries only the caller own entity events'],
  [/^\/chits\/[^/]+\/messages$/, 'messaging — the route itself refuses an EXTERNAL thread for a read-only hat'],
  /* ⭐ the assistant's READ-SHAPED posts only — each answers a question and writes nothing (routes/assist.js,
     checked 2026-09-28). A new /assist route is gated until somebody adds it here on purpose. */
  [/^\/assist(\/ask)?\/?$/, 'asking the assistant a question (POST /api/assist) — it creates nothing on the rail'],
  [/^\/assist\/conform$/, 'checking a product against a standard — a read'],
  [/^\/assist\/catalogue-structure$/, 'a proposed catalogue structure, returned, not saved (PPL-27: a viewer keeps the free draft; the paid intro is for editors only, routes/assist.js)'],
  [/^\/assist\/gap$/, 'deprecated: logs a line and writes nothing (capture is the chit flow)'],
  [/^\/assist\/resolve$/, 'resolving a governed view — a read']
];

/** Verbs that change something. GET/HEAD/OPTIONS are never gated. */
const MUTATING = ['POST', 'PATCH', 'PUT', 'DELETE'];

/* ⚠️ Keyed by LEVEL now, not by the five old hat names. b173 collapsed those to three. */
/* the registered Problem code of each level that cannot write (docs/ERROR-CODES.md) */
const LEVEL_CODE = { viewer: 'READ_ONLY', commenter: 'COMMENT_ONLY' };
const SAYS = {
  viewer: 'View-only',
  commenter: 'Comment-only — read and reply internally'
};

/** a write to the person's own things (their theme, their notifications) is open to a read-only seat: the full URL, without its query string and /api prefix, is on the SELF_SCOPED lists */
function isSelfScoped(req) {
  /**
   * ⚠️⚠️ originalUrl, NOT path — AND THIS ALMOST SHIPPED WRONG. The gate runs inside `auth`, which runs inside
   * a MOUNTED ROUTER, so `req.path` is relative to the mount: a PATCH to /api/entities/me/prefs/ui arrives here
   * as `/me/prefs/ui`. Every prefix in SELF_SCOPED is written full ('/entities/me/prefs'), so NONE of them would
   * have matched — and because the gate fails closed, the failure mode was that a view_only co-assist could not
   * save their own theme or clear their own notifications. Correct-looking, unit-tested, and wrong in production
   * only. Caught by measuring what express actually puts on the request rather than assuming.
   *
   * ⚠️ The query string is stripped: '/assist/ask?x=1' must match '/assist'.
   */
  const text = String(req.originalUrl || req.path || '')
    .split('?')[0]
    .replace(/^\/api(?=\/|$)/, '');
  return SELF_SCOPED.some(([prefix]) => text === prefix || text.startsWith(prefix + '/')) || SELF_SCOPED_EXACT.some(([re]) => re.test(text));
}

/** the gate: a write by a seat that cannot edit is refused in words (READ_ONLY | COMMENT_ONLY), except the person's own things; the owner, an unauthenticated request and every read pass */
module.exports = function hatGate(req, res, next) {
  if (!MUTATING.includes(req.method)) return next();

  /**
   * ⚠️ THE ENTITY OWNER HAS NO HAT AND IS NEVER GATED. `identity_type === 'entity'` is the business itself; a
   * hat is something an owner gives to someone else. Gating the owner would lock a business out of its own
   * records with no way back, because the only person who could lift it is the person locked out.
   *
   * ⚠️ AND AN UNAUTHENTICATED REQUEST FALLS THROUGH UNTOUCHED. This is not an authentication gate — the route's
   * own `auth` decides that, and a 403 here on a request that has not proved who it is would be answering the
   * wrong question and leaking that the path exists.
   */
  if (!req.identity || req.identity.identity_type !== 'actor') return next();

  /* Absent means 'act', matching what POST /actors writes when no hat is given — so anyone created before the
     column existed keeps exactly today's access. A hardening that silently demotes existing staff is an outage,
     not a hardening. */
  /**
   * ⭐⭐ ONE PLACE DECIDES. This used to read `req.identity.hat` and compare it against a local WRITE_HATS
   * array — one of eighteen string comparisons against 'manager' / 'audit' / 'mis' / 'view_only' spread over
   * six files. Any new rule had to be remembered in all of them, and this gate has already shipped one bug
   * that every unit test passed.
   *
   * lib/access.js is now the only thing that knows what a level means, and it derives the answer from the old
   * `hat` when `access_level` is absent — so this behaves identically either side of b173.
   */
  if (access.canEdit(req.identity)) return next();

  if (isSelfScoped(req)) return next();

  /**
   * ⚠️ THE MESSAGE NAMES THE HAT AND WHO CAN CHANGE IT. A bare "Forbidden" tells someone they are blocked and
   * leaves them to guess whether it is a bug, a stale login, or deliberate — so they ask the owner, who looks
   * at a screen reading "View-only" and cannot see why that would stop anything. Naming both ends turns a dead
   * end into an instruction.
   */
  /**
   * ⚠️ THE LEVEL, NOT THE HAT. Removing the local `const hat = …` left this line reading an undefined variable
   * — caught immediately by the test suite, which is the whole argument for having driven these rules through
   * real express rather than asserting the predicates.
   */
  const lvl = access.levelOf(req.identity);
  const message = 'Your access is set to "' + (SAYS[lvl] || lvl) + '", which can read records but not change them. ' + 'The account owner can change this in Employees.';
  /* RFC 9457 through the one helper (col14 role_matrix): the level picks the registered code (READ_ONLY | COMMENT_ONLY); the three old keys ride as the frozen legacy body */
  return problem(req, res, { status: 403, code: LEVEL_CODE[lvl] || 'READ_ONLY', detail: message, legacy: { error: 'Not permitted', message, access_level: lvl } });
};
module.exports.SELF_SCOPED = SELF_SCOPED;
