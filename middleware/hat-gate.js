/**
 * hat-gate.js — make the co-assist HAT actually govern writes, by default, everywhere.
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

/** Hats that may change the business's records. Everything else may read. */
const WRITE_HATS = ['act', 'manager'];

/**
 * Paths a restricted hat may still POST/PATCH/PUT/DELETE, because they are SELF-SCOPED or read-shaped.
 * ⚠️ Matched against the path AFTER `/api`, by prefix. Keep each one narrow and say why.
 */
const SELF_SCOPED = [
  ['/entities/me/prefs', 'their own locale and appearance — a display choice, not a record'],
  ['/entities/me/locale', 'the same, under its pre-b166 name'],
  ['/actors/me', 'their own profile row'],
  ['/actors/break', 'their own break status — a person may say they are on a break'],
  ['/auth', 'signing in cannot require permission to sign in'],
  ['/notifications', 'clearing one\'s own notifications changes no record — b164 writes only a dismissal'],
  ['/assist', 'asking the assistant a question; it creates nothing on the rail'],
  ['/metrics', 'reporting — which is precisely what the mis hat is for'],
  ['/exports', 'the same'],
];

/** Verbs that change something. GET/HEAD/OPTIONS are never gated. */
const MUTATING = ['POST', 'PATCH', 'PUT', 'DELETE'];

const SAYS = {
  view_only: 'View-only',
  audit: 'Audit — review only',
  mis: 'MIS — reports',
};

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
  const hat = req.identity.hat || 'act';
  if (WRITE_HATS.includes(hat)) return next();

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
  const p = String(req.originalUrl || req.path || '').split('?')[0].replace(/^\/api(?=\/|$)/, '');
  if (SELF_SCOPED.some(([prefix]) => p === prefix || p.startsWith(prefix + '/'))) return next();

  /**
   * ⚠️ THE MESSAGE NAMES THE HAT AND WHO CAN CHANGE IT. A bare "Forbidden" tells someone they are blocked and
   * leaves them to guess whether it is a bug, a stale login, or deliberate — so they ask the owner, who looks
   * at a screen reading "View-only" and cannot see why that would stop anything. Naming both ends turns a dead
   * end into an instruction.
   */
  return res.status(403).json({
    error: 'Not permitted',
    message: 'Your access is set to "' + (SAYS[hat] || hat) + '", which can read records but not change them. '
      + 'The account owner can change this in Co-assists.',
    hat,
  });
};

module.exports.WRITE_HATS = WRITE_HATS;
module.exports.SELF_SCOPED = SELF_SCOPED;
