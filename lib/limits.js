'use strict';
/**
 * ── E01 · LIMITS AND TIMEOUTS — how big a body may be, how long a request and a statement may run ─────────────
 *
 * Before this file every route took an 8 MB JSON body (one global express.json), no request had a deadline and
 * no query had one either (FIT §E-i). One slow statement held a pooled connection for as long as it liked; ten
 * of them and the pool (max 10) was gone for everyone.
 *
 * ⭐ ONE TABLE, READ BY ONE PARSER. middleware/auth-first.js asks `bodyLimit(req)` which of two parser pairs to
 * run; nothing else parses JSON. Refusals reach the client through lib/knownerr.js with a code, and the request
 * log carries that code (res.locals.code) — a 413 or a 503 is never silent.
 *
 * Env (all optional): BODY_LIMIT_DEFAULT (256kb) · BODY_LIMIT_LARGE (8mb) · REQUEST_TIMEOUT_MS (30000, 0 = off) ·
 * DB_STATEMENT_TIMEOUT_MS (15000, 0 = off) · API_MAX_INFLIGHT (DB_POOL_MAX x 1.6 = 16, 0 = off; warned above 2 x the pool) · API_ABANDON_LEASE_MS (30000) · API_SHED_RETRY_AFTER_S (2) · DB_POOL_MAX (10) · DB_POOL_WAIT_MS (10000).
 * A numeric setting that is not a whole number falls back to its default and warns once (intFromEnv, SEC-125).
 *
 * OWNS      the body-size table (LARGE → 8 MB, else 256 KB), the request deadline, the statement deadline and the admission cap (PLT-85 / SPD-45)
 * FLOW      req.path → bodyLimit(req) → middleware/auth-first.js picks the parser · requestTimeout(req) → 503 when the deadline passes · admit(req) → 503 SERVER_BUSY + Retry-After over the cap, before any claim or write
 * CARD      28-platform-and-operations/limits-idempotency-rate-limits
 
 * CALLED BY middleware/auth-first.js   [from the knowledge graph, 2026-10-18 - regenerate: node tools/graph/trace.cjs]
 */

const log = require('./logger');

const BODY_DEFAULT = process.env.BODY_LIMIT_DEFAULT || '256kb';
const BODY_LARGE = process.env.BODY_LIMIT_LARGE || '8mb';

/**
 * ⚠️ THE ROUTES THAT KEEP THE LARGE BUDGET, and why. A route is here because it takes base64 files or a bulk list
 * today — not because it might. To move one to the default, check the request log's `bytes` for it first (E07).
 */
const LARGE = [
  /^\/api\/attachments(\/|$)/, // base64 files
  /^\/api\/products(\/|$)/, // images (base64) and bulk import
  /^\/api\/catalogue(\/|$)/, // bulk rows, columns
  /^\/api\/catalogue-face(\/|$)/, // the whole face document
  /^\/api\/connectors(\/|$)/, // Tally / Zoho transfers (10,000+ products)
  /^\/api\/till(\/|$)/, // offline bills replayed in one go
  /^\/api\/chits(\/|$)/, // a chit with its lines and inline attachments
  /^\/api\/ctp\/deliver$/, // a delivered chit from another installation (RAIL-139: /query and the manifest take the default)
  /^\/api\/testing(\/|$)/, // the test board's case lists and results
  /^\/api\/books(\/|$)/, // a books pack
  /^\/api\/network(-design)?(\/|$)/, // a network canvas
  /^\/api\/(forms|kyb|identity)(\/|$)/, // filled forms and identity documents
  /^\/api\/(schemas|definitions|integrations|offers|invoice)(\/|$)/, // rule sets and batches
  /^\/api\/assist(\/|$)/, // a question with a picture
  /^\/api\/crm\/leads\/import$/ // a bulk list: up to 500 CSV rows of leads, parsed by the browser (L3)
];

const isLarge = (req) => LARGE.some((item) => item.test(req.path || ''));
const bodyLimit = (req) => (isLarge(req) ? BODY_LARGE : BODY_DEFAULT);

/** the biggest count an operator may set on purpose (sim-load asks for 10 million); a longer number is a typo and falls back */
const ENV_INT_MAX = 100000000;
const warnedEnv = new Set();
const WHOLE = /^[0-9]+$/;
const DECIMAL = /^[0-9]+(\.[0-9]+)?$/;

/** say once per setting that its value was refused and what is used instead (a silent fallback is the bug this guards). ⚠️ NAME ONLY: the given value may be a secret pasted into the wrong variable, so it is never logged */
function warnEnvOnce(name, fallback) {
  if (warnedEnv.has(name)) return;
  warnedEnv.add(name);
  log.warn('setting ' + name + ' is not a usable number, so the safe default ' + fallback + ' is used', { setting: name });
}

/** the one parse behind intFromEnv and numFromEnv: the shape (whole or decimal), then the range; anything else is the default and a warning */
function readEnvNumber(name, fallback, bounds, shape) {
  const given = process.env[name];
  if (given === undefined) return fallback;
  const min = bounds && bounds.min !== undefined ? bounds.min : 1;
  const max = bounds && bounds.max !== undefined ? bounds.max : ENV_INT_MAX;
  const text = String(given).trim();
  const parsed = shape.test(text) ? Number(text) : NaN;
  if (Number.isFinite(parsed) && parsed >= min && parsed <= max) return parsed;
  warnEnvOnce(name, fallback);
  return fallback;
}

/**
 * ⭐ SEC-125 · THE ONE READER OF A NUMERIC SETTING. FAILS CLOSED: unset gives the default; anything that is not a whole number in [min, max]
 * ("abc", "", "30s", "-5", "2.5", "1e9", 99999999999) gives the default and a warning once, never NaN or 0, which express-rate-limit
 * and a deadline both read as "no limit". min defaults to 1; pass { min: 0 } only where 0 is a documented "off". max defaults to 100 million.
 */
const intFromEnv = (name, fallback, bounds) => readEnvNumber(name, fallback, bounds, WHOLE);

/** the same, for a setting that may carry a decimal (a USD ceiling, a percent): "2.5" is taken, "abc" / "" / "-1" / "1e3" are the default. Same bounds. */
const numFromEnv = (name, fallback, bounds) => readEnvNumber(name, fallback, bounds, DECIMAL);

const requestTimeoutMs = () => intFromEnv('REQUEST_TIMEOUT_MS', 30000, { min: 0 });
const statementTimeoutMs = () => intFromEnv('DB_STATEMENT_TIMEOUT_MS', 15000, { min: 0 });

/**
 * ⭐ PLT-70 · ONE LIST OF THE ROUTES THAT HAVE NO REQUEST DEADLINE: the bulk ones, derived from LARGE (the body-size table) so no regex is typed twice.
 * Everything else on LARGE that is not here keeps the deadline: today only POST /api/chits/send, the one money door that dedupes a retry
 * (the till's client_ref, routes/chits.js sameRefLook; an Idempotency-Key besides). Past the deadline its client gets 503 REQUEST_TIMEOUT, the handler still
 * runs on to its commit (answerTimedOut), and the retry is answered with the chit that exists. Every other chit door, books entries, offers and invoice
 * have no replay of their own, so a deadline there would invite a duplicate: they stay in this list.
 */
const NO_DEADLINE_BULK = LARGE.filter((item) => !item.test('/api/chits/send')).concat(/^\/api\/chits(?!\/send\/?$)(\/|$)/);
const isBulk = (req) => NO_DEADLINE_BULK.some((item) => item.test(req.path || ''));

/**
 * ⭐ PLT-70 · A SEND KEEPS THE DEADLINE ONLY WHEN ITS RETRY REPLAYS: it carries the till's client_ref (body) or an Idempotency-Key (header). The web compose path
 * sends with neither; a 503 there would invite a manual retry that makes a second chit, so an unkeyed send keeps today's behaviour (no deadline).
 */
const CHIT_SEND_PATH = /^\/api\/chits\/send\/?$/;
const hasReplayKey = (req) => Boolean((req.body && req.body.client_ref) || (req.headers && req.headers['idempotency-key']));
const unkeyedSend = (req) => CHIT_SEND_PATH.test(req.path || '') && !hasReplayKey(req);

/** long-lived on purpose: the bell's SSE stream */
const NO_DEADLINE = /^\/api\/events\/stream\/?$/;

/** the writers that go dead once the deadline has answered (res.json is not one: it stays the late answer's chain, see answerTimedOut) */
const DEAD_WRITERS = ['set', 'header', 'setHeader', 'write', 'writeHead', 'type', 'sendStatus', 'end'];

/**
 * ⭐ PLT-69 (retry never twice): THE STATUS A ROUTE'S ANSWER CARRIES. After the deadline res.statusCode is our 503 (the log reads it), so a route
 * that answers with a plain res.json(...) (200 by default, no res.status call) was read as a 503, "not settled", and the idempotency claim was
 * DROPPED while its work was done: the retry ran the handler a second time. The chain (idempotency record, output allow-list) reads this instead.
 */
const answerStatus = (res) => (res.locals && res.locals.lateStatus !== undefined ? res.locals.lateStatus : res.statusCode);

/**
 * ⭐ PLT-69: THE 503 GOES OUT THROUGH res.end, NEVER THROUGH res.json. middleware/idempotency wraps res.json (it records the answer and sends it
 * only after the key is settled, and a 5xx deletes the claim), so a 503 sent that way was swallowed by our own no-op res.send and the client hung,
 * and the claim was dropped while the handler kept running, so the retry ran it a second time. The body is the one problem shape (lib/problem.build).
 *
 * THE LATE ANSWER STAYS ON THE WRITER CHAIN. res.json is left as it is, so the output allow-list (lib/output-allowlist) prunes it and the
 * idempotency gate records it (finalize) exactly as on a normal answer, whenever it is installed, even after the deadline; only the last step
 * (res.send) is dead. res.status records the status on the response object (the head has gone) so the chain reads the status the route chose.
 * Meanwhile the key stays in_progress (a retry gets 409); once the work finished the retry replays the stored answer; a late 5xx drops the claim.
 */
function answerTimedOut(req, res, ms) {
  const { build } = require('./problem');
  const detail = 'This took longer than ' + Math.round(ms / 1000) + ' seconds and was stopped. Try again; if it keeps happening, tell us.';
  const body = build(req, { status: 503, code: 'REQUEST_TIMEOUT', detail, legacy: { error: 'Took too long', message: detail } });
  res.locals.code = 'REQUEST_TIMEOUT';
  res.locals.lateStatus = res.statusCode; /* what the route had chosen so far (200 unless it set one): the late answer is read at THIS status, never at our 503 */
  res.statusCode = 503;
  res.setHeader('Content-Type', 'application/problem+json; charset=utf-8');
  res.end(JSON.stringify(body));
  const noop = () => res;
  DEAD_WRITERS.forEach((item) => {
    res[item] = noop;
  });
  res.send = noop;
  res.status = (code) => {
    res.locals.lateStatus = code; /* res.statusCode stays 503 for the log; the chain reads answerStatus */
    return res;
  };
}

/**
 * ⭐ A REQUEST HAS A DEADLINE. Past it the client gets 503 REQUEST_TIMEOUT and the route's own late answer goes
 * nowhere.
 *
 * ⚠️⚠️ THE LATE ANSWER MUST BE SWALLOWED, NOT THROWN. Express 4 does not catch an async handler's rejection, and
 * a route that answers after we did would throw ERR_HTTP_HEADERS_SENT — then its catch answers again and throws
 * again, unhandled, and Node exits. So once the deadline fires, the response's writers become no-ops.
 */
function requestTimeout(req, res, next) {
  const ms = requestTimeoutMs();
  /* ⚠️ THE BULK ROUTES HAVE NO REQUEST DEADLINE (PLT-70: NO_DEADLINE_BULK; POST /api/chits/send keeps it). They are the LARGE list above, and they do long work on purpose:
     POST /api/products/import writes up to 2,000 rows, one transaction each (~4 trips a row) — well past 30 s on a
     big file. A deadline there would answer 503 while the writes carried on, and the shop would re-upload a file
     that had half-landed. Each of their STATEMENTS is still capped (DB_STATEMENT_TIMEOUT_MS). */
  if (!ms || NO_DEADLINE.test(req.path || '') || isBulk(req) || unkeyedSend(req)) return next();
  const timer = setTimeout(() => {
    if (res.headersSent) return;
    answerTimedOut(req, res, ms);
  }, ms);
  if (timer.unref) timer.unref();
  const clear = () => clearTimeout(timer);
  res.on('finish', clear);
  res.on('close', clear);
  next();
}


/**
 * ⭐ PLT-85 / SPD-45 · ADMISSION: THE LINE IS SHORT, AND ITS END IS AT THE DOOR. The pool is 10 connections and a bill takes about ten of them in turn, so
 * with no limit on requests inside the api each one waited its turn for minutes (SIT 7 Nov: p50 76 s at 300 req/s, handler time flat at 416 ms) and the
 * till had long gone: abandoned bills were still saved, keys sat in progress. Shedding by shortening the wait INSIDE a request would make half bills
 * (a later step failing after the first committed), so the cut is made here, before the idempotency claim and before any write: over the cap the answer is
 * 503 SERVER_BUSY with Retry-After, nothing claimed, nothing written, and the till's queue retries the same key. Default = the pool x 1.6 (10 gives 16; it was 24 until 8 Nov, see inflightCeiling). Measured on sit-in 8 Nov (2 vCPU, 126-route mix at 80 req/s):
 * 64 admitted still met 10 s pool timeouts (56 x 500, 5 bills without a ledger line), 24 met none (0 x 500, 0 failures). Never shed: the health probe, the SSE stream, inbound webhooks, peer installations and sign-in.
 */
const POOL_MAX_DEFAULT = 10;
const INFLIGHT_PER_POOL_CONNECTION = 1.6; /* measured on sit-au 8 Nov: 16 in flight on a pool of 10 met 120 of 120 sends, 24 did not (the pool waits ran to the 10 s timeout) */
const INFLIGHT_WARN_ABOVE_POOLS = 2;
const ABANDON_LEASE_DEFAULT_MS = 30000;
const SHED_RETRY_AFTER_DEFAULT_S = 2;
const SHED_LOG_EVERY_MS = 10000;
const NEVER_SHED = /^\/(health(\/|$)|api\/(events\/stream|capture\/webhook|ctp(\/|$)|signin(\/|$)|actors\/(login|check-login|set-pin)|entities\/(register|verify)|till\/pair\/claim))/;
let inflight = 0;
let shedCount = 0;
let lastShedLog = 0;
let lastWarnedCeiling = 0;
const poolMax = () => intFromEnv('DB_POOL_MAX', POOL_MAX_DEFAULT, { min: 1 });
/**
 * the cap: API_MAX_INFLIGHT when set, else the pool x 1.6 (10 connections gives 16), so the two knobs cannot drift apart; 0 = off.
 * A cap above twice the pool is allowed but said once per value, because past it requests only wait in the pool for its timeout.
 */
function inflightCeiling() {
  const pool = poolMax();
  const ceiling = intFromEnv('API_MAX_INFLIGHT', Math.round(pool * INFLIGHT_PER_POOL_CONNECTION), { min: 0 });
  if (ceiling > pool * INFLIGHT_WARN_ABOVE_POOLS && ceiling !== lastWarnedCeiling) {
    lastWarnedCeiling = ceiling;
    log.warn('API_MAX_INFLIGHT ' + ceiling + ' is more than 2 x DB_POOL_MAX ' + pool + ': the extra requests only wait in the pool, and past DB_POOL_WAIT_MS they fail', { ceiling, pool });
  }
  return ceiling;
}
const maxInflight = inflightCeiling;
const abandonLeaseMs = () => intFromEnv('API_ABANDON_LEASE_MS', ABANDON_LEASE_DEFAULT_MS, { min: 0 });
const inflightNow = () => inflight;

/** say, at most every 10 s, that requests are being turned away and how full the line is (never silent; the pool wait rides here) */
function noteShed(ceiling) {
  shedCount += 1;
  const now = Date.now();
  if (now - lastShedLog < SHED_LOG_EVERY_MS) return;
  lastShedLog = now;
  const pool = require('../db').pool || {};
  log.warn('busy: requests over the cap are answered 503 SERVER_BUSY before any work', { ceiling, inflight, shed_since_last_line: shedCount, pool_waiting: pool.waitingCount, pool_total: pool.totalCount, pool_idle: pool.idleCount });
  shedCount = 0;
}

/** the 503 itself: the one problem shape, Retry-After in the header and in params, nothing claimed */
function answerBusy(req, res) {
  const { problem } = require('./problem');
  const seconds = intFromEnv('API_SHED_RETRY_AFTER_S', SHED_RETRY_AFTER_DEFAULT_S);
  const detail = 'ChitBridge is very busy right now. Nothing was saved. Try again in ' + seconds + ' seconds.';
  return problem(req, res, { status: 503, code: 'SERVER_BUSY', detail, hint: 'Wait ' + seconds + ' seconds, then send it again.', params: { retry_after_seconds: seconds }, legacy: { error: 'Busy', message: detail } });
}

/**
 * ⭐ PLT-85: remember that the client left. Set on 'close' when the answer had not been fully written: res.locals.clientGone. A GET or HEAD also carries
 * res.locals.readerGate, so the database door (refuseIfReaderGone, read by db/index.js) can turn a read away before it takes a pool connection.
 * The stream and the other NEVER_SHED doors are not gated (a stream closes by design and its cleanup still reads).
 * ⚠️ A mutating request is never stopped by this mark after its idempotency claim: a claimed bill runs to COMMIT (middleware/idempotency holdKey only
 * reads the mark BEFORE the claim).
 */
function trackClient(req, res) {
  const reader = (req.method === 'GET' || req.method === 'HEAD') && !NEVER_SHED.test(req.path || '');
  res.locals.readerGate = reader;
  res.on('close', () => { if (!res.writableFinished) res.locals.clientGone = true; });
}

/** the database's door for a read: the client has gone, so no pool connection is taken. Log-only: nobody is left to answer. No request in scope (a job, a test) → nothing refused. */
function refuseIfReaderGone() {
  const current = require('./reqctx').currentRequest();
  const locals = current && current.locals;
  if (locals && locals.readerGate && locals.clientGone) throw Object.assign(new Error('the client has gone; this read was not started'), { clientGone: true });
}

/** the route a request matched, for a log line that must not carry ids from the path */
const routeOf = (req) => (req.route ? (req.baseUrl || '') + req.route.path : 'unrouted');

/**
 * ⭐ admit — count the request in and keep its place until its HANDLER has answered (res.end), not until the client closed: an abandoned request still
 * holds pool connections, so freeing its place on 'close' let the work inside the api exceed the cap by the number of abandoned requests.
 * A LEASE bounds that: closed and still running after API_ABANDON_LEASE_MS (30 s) frees the place anyway and one warn names the route (0 = free it at close).
 * A request that is not admitted is not counted. Counted out ONCE.
 */
function admit(req, res, next) {
  trackClient(req, res);
  const ceiling = maxInflight();
  if (!ceiling || NEVER_SHED.test(req.path || '')) return next();
  if (inflight >= ceiling) { noteShed(ceiling); return answerBusy(req, res); }
  inflight += 1;
  let released = false;
  let lease = null;
  const release = () => { if (released) return; released = true; inflight -= 1; if (lease) clearTimeout(lease); };
  const end = res.end;
  res.end = function endAndRelease(...args) { release(); return end.apply(this, args); };
  res.on('finish', release);
  res.on('close', () => {
    if (released) return;
    const leaseMs = abandonLeaseMs();
    if (!leaseMs) return release();
    lease = setTimeout(() => {
      if (released) return;
      log.warn('the client left and its handler is still running: the place is freed after the lease', { route: routeOf(req), method: req.method, lease_ms: leaseMs });
      release();
    }, leaseMs);
    if (lease.unref) lease.unref();
  });
  next();
}

module.exports = { admit, inflightNow, inflightCeiling, poolMax, trackClient, refuseIfReaderGone, NEVER_SHED, answerStatus, BODY_DEFAULT, BODY_LARGE, LARGE, isLarge, isBulk, bodyLimit, requestTimeout, requestTimeoutMs, statementTimeoutMs, intFromEnv, numFromEnv };
