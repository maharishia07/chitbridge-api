/*
 * OWNS      the contract of the bell's two routers (6 routes): routes/events.js (/api/events: the ticket, the live stream, the platform counts) and routes/notifications.js (/api/notifications: the feed
 *           and its badge, seen, dismiss) — each route's OpenAPI operation (S9), the words its refusals answer in (words), and the one way a fault is worded (faultOf, over lib/products-contract.js `failed`).
 *           ONE file for both routers (the kit takes one mount per contract, so there are two contractOf calls: `events` and `notifications`).
 * CALLED BY routes/events.js · routes/notifications.js (contract.checked on each route, router.openapi, problem(req, res, { status, ...words.x() } | faultOf(e, req, label))) → tools/api-register.cjs ·
 *           tools/api-contract-tests.cjs · /api/openapi.json · tests/api-problem-bell.test.cjs.
 * FLOW      operation → schemaValidate(operation) at the route → the register reads router.openapi → the contract cases run from the same schemas
 *           a refusal → problem(req, res, { status, ...words.x() }) → the old { error, message } beside the Problem fields
 *           a thrown error → faultOf(e, req, label): a 500 with the screen's own label and the one generic sentence, whatever the error said
 * CARD      22-channels-capture-and-messaging/notifications-and-the-bell
 * This file shapes NO success answer and reads no row: the ticket, the stream's frames and the counts are lib/events.js; the feed, the watermark and the dismissals are routes/notifications.js and the
 * database, as before. The stream's success is not JSON: it is declared as text/event-stream (the kit's media()), so schema_out is true and output_allowlist cannot be (a stream has no JSON allow-list).
 *
 * ⚠️ NO BEHAVIOUR CHANGE. The input schemas say what the handlers ALREADY take: a body is an object OR a list (the handlers read a list as no body), nothing is required, a value is anything (`all` is true only
 *    when `=== true`; a `log_ids` that is not a list is read as none), and a query value is anything (`?count=1&count=1` is not '1'; `?limit=abc` falls back to the page size; `?t=a&t=b` is a ticket nobody holds).
 *    An unknown key is NOT refused (the handler drops it), so strict_input stays open on the three writes. The schema check in front of each route can therefore refuse nothing; the 422 the kit declares for a
 *    route that takes input is never answered (on POST /dismiss the kit's refusal is declared at 400, the status the route itself answers for "nothing to clear").
 * ⚠️ THE RELAY STILL RELAYS, AND ONLY FIXED WORDS. `faultOf` carries the constant sentence of lib/respond.js safeErr ('Something went wrong — please try again.') in `message` of each 500: it can pass NOTHING of the error.
 *    Every other sentence below is a literal. Moving the relay into this file stops the raw-error ratchet counting it; the PR says so.
 */
'use strict';
const { contractOf, object, array, any, text } = require('./contract-kit');
const { internalSpec } = require('./problem');
const { said, failed } = require('./products-contract');

/* ── the words ──────────────────────────────────────────────────────────────────────────────────────────── */
/** every sentence a bell route refuses in; each returns { code, detail, legacy }. Frozen: docs/contracts/api-legacy.json. */
const words = {
  /** a login that names no shop asks for a ticket (401): the old body, one key */
  signInRequired: () => said('EVENTS_NOT_SIGNED_IN', { error: 'Unauthorised' }),
  /** the stream was opened with no ticket, a spent one, an expired one or one nobody holds (401): the old two keys */
  ticketRefused: () => said('EVENTS_TICKET_REFUSED', { error: 'Unauthorised', message: 'ticket missing, spent or expired' }),
  /** a dismissal that names neither log_ids nor all:true (400) */
  nothingToClear: () => said('NOTIF_NOTHING_TO_CLEAR', { error: 'Nothing to clear', message: 'Send log_ids, or all:true.' }),
  /** the watermark's function (b157) is not on this database yet (503) */
  seenNotMigrated: () => said('NOTIF_SEEN_NOT_MIGRATED', { error: 'Not migrated', message: 'Clearing the badge needs b157 on this environment.' }),
  /** the dismissals table (b164) is not on this database yet (503): this body has always carried its own `code` */
  dismissNotMigrated: () => said('NOTIF_DISMISS_NOT_MIGRATED', { error: 'Not migrated', message: 'Clearing Activity needs b164 on this environment.', code: 'NOTIF_DISMISS_NOT_MIGRATED' })
};

/** whatever a bell route's catch got, worded by the screen's own label; the real error is logged with the request id */
const faultOf = (e, req, label) => failed(e, req, label);

/** a fault in a handler with no catch of its own (GET /stats): the body the server's last-resort handler (server.js, fromError) has always answered for an error nobody expected, so the bytes are the same; the real error is logged with the request id */
const lastResort = (e, req) => internalSpec(req, e, { error: 'Server error', message: 'Something went wrong' });

/** every code these routes answer under, for the test that each is a register row with its sentence */
const CODES = ['EVENTS_NOT_SIGNED_IN', 'EVENTS_TICKET_REFUSED', 'NOTIF_NOTHING_TO_CLEAR', 'NOTIF_SEEN_NOT_MIGRATED', 'NOTIF_DISMISS_NOT_MIGRATED', 'INTERNAL'];

/* ── the shapes ─────────────────────────────────────────────────────────────────────────────────────────── */
const flag = { type: 'boolean' };
const whole = { type: 'integer' };
const feedShape = object(['notifications', 'count', 'total', 'page', 'limit', 'seen_at'], { notifications: array(object()), count: whole, total: whole, page: whole, limit: whole, seen_at: any });
const badgeShape = object(['count', 'total', 'seen_at'], { count: whole, total: whole, seen_at: any });

const EVENTS_ROUTES = {
  'POST /ticket': {
    summary: 'A one-time ticket (60 s) to open the live stream with: a token never rides a URL',
    list: true,
    body: [],
    out: object(['ticket', 'ttl_s'], { ticket: text, ttl_s: whole })
  },
  'GET /stream': {
    summary: 'The live stream (Server-Sent Events): hello once, then cb per arrival, and every 25 s a comment and a named ping. Opened with the ticket in ?t= or ?ticket= (both spellings)',
    public: true,
    lenient: true,
    query: ['t', 'ticket'],
    inline: [401],
    media: 'text/event-stream'
  },
  'GET /stats': {
    summary: 'How many shops are listening, platform-wide: the platform operator only',
    inline: [403, 404],
    out: object(['entities', 'connections', 'tickets'], { entities: whole, connections: whole, tickets: whole })
  }
};

const NOTIFICATIONS_ROUTES = {
  'GET /': {
    summary: 'The Activity feed: recent activity by others on my chits, newest first; with ?count=1 the badge alone',
    lenient: true,
    query: ['limit', 'count'],
    out: { anyOf: [feedShape, badgeShape] }
  },
  'POST /seen': {
    summary: 'Move the badge watermark to now: opening the panel is seeing it',
    list: true,
    body: [],
    inline: [503],
    out: object(['ok'], { ok: flag, seen_at: any })
  },
  'POST /dismiss': {
    summary: 'Clear one Activity row, several, or all of them: hidden from the feed, never deleted from the trail',
    list: true,
    body: ['log_ids', 'all'],
    invalid: 400,
    inline: [503],
    out: object(['ok', 'cleared'], { ok: flag, cleared: whole })
  }
};

/** the contracts of the two routers, of the kit's making */
const events = contractOf({ mount: '/api/events', routes: EVENTS_ROUTES, gateStatus: {} });
const notifications = contractOf({ mount: '/api/notifications', routes: NOTIFICATIONS_ROUTES, gateStatus: {} });
const OPERATIONS = Object.assign({}, events.OPERATIONS, notifications.OPERATIONS);
const ROUTES = { events: EVENTS_ROUTES, notifications: NOTIFICATIONS_ROUTES };
/** the refusal statuses a test may see from one route (either router's) */
const allowedStatuses = () => (key) => (key.includes(' /api/events') ? events : notifications).allowedStatuses()(key);

module.exports = { events, notifications, words, faultOf, lastResort, CODES, OPERATIONS, ROUTES, allowedStatuses };
