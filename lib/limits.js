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
 */

const BODY_DEFAULT = process.env.BODY_LIMIT_DEFAULT || '256kb';
const BODY_LARGE = process.env.BODY_LIMIT_LARGE || '8mb';

/**
 * ⚠️ THE ROUTES THAT KEEP THE LARGE BUDGET, and why. A route is here because it takes base64 files or a bulk list
 * today — not because it might. To move one to the default, check the request log's `bytes` for it first (E07).
 */
const LARGE = [
  /^\/api\/attachments(\/|$)/,       // base64 files
  /^\/api\/products(\/|$)/,          // images (base64) and bulk import
  /^\/api\/catalogue(\/|$)/,         // bulk rows, columns
  /^\/api\/catalogue-face(\/|$)/,    // the whole face document
  /^\/api\/connectors(\/|$)/,        // Tally / Zoho transfers (10,000+ products)
  /^\/api\/till(\/|$)/,              // offline bills replayed in one go
  /^\/api\/chits(\/|$)/,             // a chit with its lines and inline attachments
  /^\/api\/ctp(\/|$)/,               // a delivered chit from another installation
  /^\/api\/testing(\/|$)/,           // the test board's case lists and results
  /^\/api\/books(\/|$)/,             // a books pack
  /^\/api\/network(-design)?(\/|$)/, // a network canvas
  /^\/api\/(forms|kyb|identity)(\/|$)/, // filled forms and identity documents
  /^\/api\/(schemas|definitions|integrations|offers|invoice)(\/|$)/,   // rule sets and batches
  /^\/api\/assist(\/|$)/,            // a question with a picture
];

const isLarge = (req) => LARGE.some((re) => re.test(req.path || ''));
const bodyLimit = (req) => (isLarge(req) ? BODY_LARGE : BODY_DEFAULT);

const num = (v, d) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : d; };
const requestTimeoutMs = () => num(process.env.REQUEST_TIMEOUT_MS, 30000);
const statementTimeoutMs = () => num(process.env.DB_STATEMENT_TIMEOUT_MS, 15000);

/** long-lived on purpose: the bell's SSE stream */
const NO_DEADLINE = /^\/api\/events\/stream\/?$/;

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
    res.locals.code = 'REQUEST_TIMEOUT';
    res.status(503).json({ error: 'Took too long', code: 'REQUEST_TIMEOUT',
      message: 'This took longer than ' + Math.round(ms / 1000) + ' seconds and was stopped. Try again; if it keeps happening, tell us.' });
    const noop = function () { return res; };
    ['status', 'set', 'header', 'setHeader', 'json', 'send', 'end', 'write', 'writeHead', 'type', 'sendStatus'].forEach((k) => { res[k] = noop; });
  }, ms);
  if (timer.unref) timer.unref();
  const clear = () => clearTimeout(timer);
  res.on('finish', clear); res.on('close', clear);
  next();
}

module.exports = { BODY_DEFAULT, BODY_LARGE, LARGE, isLarge, bodyLimit, requestTimeout, requestTimeoutMs, statementTimeoutMs };
