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

const num = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};
const requestTimeoutMs = () => num(process.env.REQUEST_TIMEOUT_MS, 30000);
const statementTimeoutMs = () => num(process.env.DB_STATEMENT_TIMEOUT_MS, 15000);

/** long-lived on purpose: the bell's SSE stream */
const NO_DEADLINE = /^\/api\/events\/stream\/?$/;

/** the writers that go dead once the deadline has answered (res.json is not one: it stays the late answer's chain, see answerTimedOut) */
const DEAD_WRITERS = ['set', 'header', 'setHeader', 'write', 'writeHead', 'type', 'sendStatus', 'end'];

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
  res.statusCode = 503;
  res.setHeader('Content-Type', 'application/problem+json; charset=utf-8');
  res.end(JSON.stringify(body));
  const noop = () => res;
  DEAD_WRITERS.forEach((item) => {
    res[item] = noop;
  });
  res.send = noop;
  res.status = (code) => {
    res.statusCode = code;
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
  /* ⚠️ THE BULK ROUTES HAVE NO REQUEST DEADLINE. They are the LARGE list above, and they do long work on purpose:
     POST /api/products/import writes up to 2,000 rows, one transaction each (~4 trips a row) — well past 30 s on a
     big file. A deadline there would answer 503 while the writes carried on, and the shop would re-upload a file
     that had half-landed. Each of their STATEMENTS is still capped (DB_STATEMENT_TIMEOUT_MS). */
  if (!ms || NO_DEADLINE.test(req.path || '') || isLarge(req)) return next();
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

module.exports = { BODY_DEFAULT, BODY_LARGE, LARGE, isLarge, bodyLimit, requestTimeout, requestTimeoutMs, statementTimeoutMs };
