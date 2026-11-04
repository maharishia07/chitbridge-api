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
 * DB_STATEMENT_TIMEOUT_MS (15000, 0 = off).
 *
 * OWNS      the body-size table (LARGE → 8 MB, else 256 KB), the request deadline and the statement deadline
 * FLOW      req.path → bodyLimit(req) → middleware/auth-first.js picks the parser · requestTimeout(req) → 503 when the deadline passes
 * CARD      28-platform-and-operations/limits-idempotency-rate-limits
 
 * CALLED BY middleware/auth-first.js   [from the knowledge graph, 2026-10-18 - regenerate: node tools/graph/trace.cjs]
 */

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

const blank = (v) => v == null || String(v).trim() === '';
/** SEC-125 · a setting that is unset OR blank is the default (Number('') is 0, which would switch a deadline OFF) */
const num = (v, d) => {
  if (blank(v)) return d;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : d;
};
/**
 * SEC-125 · a numeric env setting that must be a positive whole number (a rate-limit cap, a window in hours). A non-number ("30s", "abc")
 * used to become NaN, which express-rate-limit never limits and the idempotency window never replays — it failed OPEN. It now falls
 * back to the default and says so in the log, once per name.
 */
const warned = new Set();
function envPositiveInt(name, fallback) {
  const raw = process.env[name];
  if (blank(raw)) return fallback;
  const text = String(raw).trim();
  if (/^[0-9]+$/.test(text) && Number(text) > 0) return Number(text);
  if (!warned.has(name)) {
    warned.add(name);
    require('./logger').warn('limits: ' + name + '="' + raw + '" is not a positive whole number — using the default ' + fallback);
  }
  return fallback;
}
const requestTimeoutMs = () => num(process.env.REQUEST_TIMEOUT_MS, 30000);
const statementTimeoutMs = () => num(process.env.DB_STATEMENT_TIMEOUT_MS, 15000);

/** long-lived on purpose: the bell's SSE stream */
const NO_DEADLINE = /^\/api\/events\/stream\/?$/;

/**
 * PLT-70 · THE BULK-IMPORT ROUTES, and only they, run without the 30 s request deadline: they write thousands of rows on purpose.
 * This is NOT the body-size table (LARGE) — a chit send, a till bill, an offer, an invoice or a books call has a big BODY allowance
 * and still a DEADLINE, so a hung money call answers 503 REQUEST_TIMEOUT instead of holding the connection open.
 */
const BULK_NO_DEADLINE = [
  /^\/api\/products\/import/, // up to 2,000 rows, one transaction each
  /^\/api\/connectors(\/|$)/, // Tally / Zoho transfers (10,000+ products)
  /^\/api\/crm\/leads\/import$/, // up to 500 CSV rows
  /^\/api\/catalogue\/[^/]+\/(bulk|import)/ // catalogue bulk rows
];
const hasNoDeadline = (req) => NO_DEADLINE.test(req.path || '') || BULK_NO_DEADLINE.some((item) => item.test(req.path || ''));

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
  /* ⚠️ THE BULK-IMPORT ROUTES HAVE NO REQUEST DEADLINE (BULK_NO_DEADLINE above), and they do long work on purpose:
     POST /api/products/import writes up to 2,000 rows, one transaction each (~4 trips a row) — well past 30 s on a
     big file. A deadline there would answer 503 while the writes carried on, and the shop would re-upload a file
     that had half-landed. Each of their STATEMENTS is still capped (DB_STATEMENT_TIMEOUT_MS). */
  if (!ms || hasNoDeadline(req)) return next();
  const timer = setTimeout(() => {
    if (res.headersSent) return;
    res.locals.code = 'REQUEST_TIMEOUT';
    res.status(503).json({
      error: 'Took too long',
      code: 'REQUEST_TIMEOUT',
      message: 'This took longer than ' + Math.round(ms / 1000) + ' seconds and was stopped. Try again; if it keeps happening, tell us.'
    });
    const noop = function () {
      return res;
    };
    ['status', 'set', 'header', 'setHeader', 'json', 'send', 'end', 'write', 'writeHead', 'type', 'sendStatus'].forEach((item) => {
      res[item] = noop;
    });
  }, ms);
  if (timer.unref) timer.unref();
  const clear = () => clearTimeout(timer);
  res.on('finish', clear);
  res.on('close', clear);
  next();
}

module.exports = { BODY_DEFAULT, BODY_LARGE, LARGE, BULK_NO_DEADLINE, hasNoDeadline, envPositiveInt, isLarge, bodyLimit, requestTimeout, requestTimeoutMs, statementTimeoutMs };
