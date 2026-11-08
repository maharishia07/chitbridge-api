'use strict';
/*
 * OWNS      the one error body (RFC 9457 problem details plus our `code`): build it, send it, and turn a thrown error into it.
 * CALLED BY server.js (404 and error handler) · route files' router.param (uuidParam · textParam) · lib/owner.js · routes/keys.js (the worked example; every other route moves here as it is touched).
 * FLOW      route refusal → problem(req, res, {...}) → body {type,title,status,code,detail,hint,request_id} + frozen legacy keys → application/problem+json
 *           thrown error  → fromError(req, res, err) → known(err) (lib/knownerr.js) | safeErr (lib/respond.js) → 500 INTERNAL
 * CARD      28-platform-and-operations/api-standard
 */
/**
 * lib/problem.js — API-STANDARD S1, S2, S3, S8. ONE writer so a caller learns one shape (docs/28-platform-and-operations/API-STANDARD.md).
 *
 * ⭐ LEGACY KEYS ARE FROZEN, NEVER DERIVED (S2). A route's old body (`error`, `message`, `ok:false`, `details[]`, `may`, `why` ...) is passed in as `legacy`
 * exactly as it answered before; it is merged UNDER the problem fields, so the web keeps reading what it read. `error` is never set from `title`:
 * the web shows each route's own `error` sentence. docs/contracts/api-legacy.json records the frozen body per route and a test replays it.
 *
 * ⚠️ A 5xx never carries `err.message`, SQL, a stack or a path (S8): fromError logs the real error with the request id through safeErr
 * (lib/respond.js — the one place that logs and words it) and answers INTERNAL.
 */
const { known, connectionLost } = require('./knownerr');
const { safeErr } = require('./respond');
const codeRegister = require('../docs/error-codes.json');
const { UUID } = require('./namedentity'); // the one uuid shape (K-1 guard below)

const PROBLEM_TYPE_BASE = 'https://chitbridge.com/problems/';
const INTERNAL_DETAIL = 'Something went wrong on our side.';
const INTERNAL_HINT = 'Try again in a moment. If it keeps happening, tell us this request id.';
const DEFAULT_HINT = 'Check what was sent and try again.';
/* the keys a legacy body may not overwrite: they are the contract (S1) */
const OWNED_KEYS = ['type', 'title', 'status', 'detail', 'request_id', 'errors'];

const registerRow = (code) => codeRegister.codes.find((row) => row.code === code) || null;

/** a title is the same for every occurrence of a code (RFC 9457 sec 3.1.3): the register's, else the code in words */
function titleOf(code) {
  const row = registerRow(code);
  if (row && row.title) return row.title;
  const words = String(code || 'UNKNOWN').toLowerCase().replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** hint: the caller's, else the register's, else a generic line for the status class */
function hintOf(code, status, given) {
  if (given) return given;
  const row = registerRow(code);
  if (row && row.hint && row.hint !== '-') return row.hint;
  return status >= 500 ? INTERNAL_HINT : DEFAULT_HINT;
}

/**
 * build(req, spec) — the body, pure (tests call it). spec = {status, code, detail, field, hint, params, errors, legacy}.
 * Unset optional keys are absent, not null. `legacy` keys that are not owned by the standard ride along unchanged.
 */
function build(req, spec) {
  const status = spec.status;
  const code = spec.code;
  const fields = {
    type: PROBLEM_TYPE_BASE + String(code).toLowerCase(),
    title: titleOf(code),
    status,
    code,
    detail: spec.detail,
    hint: hintOf(code, status, spec.hint),
    request_id: (req && req.id) || null
  };
  if (spec.field) fields.field = spec.field;
  if (spec.params) fields.params = spec.params;
  if (spec.errors) fields.errors = spec.errors;
  const legacy = Object.assign({}, spec.legacy);
  OWNED_KEYS.forEach((key) => delete legacy[key]);
  return Object.assign(legacy, fields);
}

/** problem(req, res, spec) — build and send. Content-Type is set first because res.json only sets one when none is set. */
function problem(req, res, spec) {
  if (res.locals) res.locals.code = spec.code; /* E01: the code reaches the request log */
  res.status(spec.status);
  const wait = spec.params && Number(spec.params.retry_after_seconds);
  if (wait >= 1 && typeof res.set === 'function' && !(res.getHeader && res.getHeader('Retry-After'))) res.set('Retry-After', String(Math.ceil(wait))); /* PLT-85: the header says what params.retry_after_seconds says (lib/rate-limit.js did it by hand) */
  if (typeof res.set === 'function') res.set('Content-Type', 'application/problem+json; charset=utf-8'); /* a bare test double has no header API */
  return res.json(build(req, spec));
}

/**
 * uuidParam(words) — API-10 / K-1: THE one guard for an id in the address that must be a uuid. Mount it with router.param('<name>', uuidParam(words))
 * and a non-uuid id is answered 404 NOT_FOUND (an id that is not a uuid names no row) before the database puts its own words
 * ("invalid input syntax for type uuid") into a 500. `words` is the route file's own not-found words: a spec, or a function of req returning one
 * (its legacy body stays the route's frozen 404). Never use it for a param that is not a uuid column (a field key, a handle, a scheme).
 */
const uuidParam = (words) => (req, res, next, id) =>
  UUID.test(String(id)) ? next() : problem(req, res, { status: 404, code: 'NOT_FOUND', ...(typeof words === 'function' ? words(req) : words) });

/* the one character Postgres text cannot hold (a bound NUL is refused 22021 → a 500). An address that does not decode never gets here: Express answers it 400. */
const NOT_TEXT = /\u0000/;

/**
 * textParam(words?) — K-1 Q2 (laptop1, 4 Nov): THE one guard for a TEXT value in the address (a holder value, a field key, a handle) — the twin of uuidParam.
 * router.param('<name>', textParam(words)): a value holding a character Postgres text cannot store is answered 400 INVALID_INPUT naming the field, before the
 * database turns it into a 500. Such a value can name no row in any shop, so the same 400 every time tells a stranger nothing (S41). Any other value passes.
 * `words` (optional) is the route file's own spec or a function of req; a file whose frozen answer for it is its own not-found words passes them, status included.
 */
const textParam = (words) => (req, res, next, value, name) =>
  !NOT_TEXT.test(String(value))
    ? next()
    : problem(req, res, {
        status: 400,
        code: 'INVALID_INPUT',
        field: name,
        detail: 'The ' + name + ' in the address holds a character that cannot be stored.',
        legacy: { error: 'Validation failed', message: 'The ' + name + ' in the address holds a character that cannot be stored.' },
        ...(typeof words === 'function' ? words(req) : words)
      });

/** the problem spec of a refusal knownerr made ({ status, body }): its own status, code, words and hint, its whole body kept as the legacy body. The ONE mapping (fromError and faultSpec) */
const specOf = (refusal) => ({ status: refusal.status, code: refusal.body.code || 'INTERNAL', detail: refusal.body.message, hint: refusal.body.hint, params: refusal.body.params, legacy: refusal.body });

/**
 * fromError(req, res, err, legacy?) — a thrown error becomes a problem. A refusal the database makes on purpose (known(err)) keeps its own status,
 * code and words; anything else is logged with the request id and answered INTERNAL. `legacy` is the frozen 5xx body of the calling route.
 */
function fromError(req, res, err, legacy) {
  const refusal = known(err);
  if (refusal) return problem(req, res, specOf(refusal));
  safeErr(err, { id: req && req.id, path: req && req.path });
  return problem(req, res, { status: 500, code: 'INTERNAL', detail: INTERNAL_DETAIL, legacy });
}

/**
 * internalSpec(req, err, legacy?, code?) — the spec of a 5xx that says nothing of its cause (S8): the real error is logged with the request id (safeErr),
 * the caller gets the generic sentence. `legacy` is the route's frozen 5xx body; `code` keeps a route's own fault code (default INTERNAL).
 * A route whose catch must not widen into known(err) (a read that always answered 500) calls problem(req, res, internalSpec(...)) instead of fromError.
 */
function internalSpec(req, err, legacy, code) {
  safeErr(err, { id: req && req.id, path: req && req.path });
  return { status: 500, code: code || 'INTERNAL', detail: INTERNAL_DETAIL, legacy };
}

/**
 * softFault(req, err) — a read that must NOT answer an error when it fails (a pulse: "cannot tell" is its own 200 body, and an error would silence the screen).
 * The fault is logged with the request id exactly as an INTERNAL answer would log it (safeErr) and nothing is written; the route answers its own body after it.
 */
function softFault(req, err) {
  safeErr(err, { id: req && req.id, path: req && req.path });
}

/**
 * faultSpec(req, err, legacy?, code?) — internalSpec, except that a database connection which died under the request (knownerr connectionLost) is 503 DB_CONNECTION_LOST, nothing saved (PLT-86c).
 * Opt-in per contract: a route must DECLARE 503 (its contract's statuses, the api register) before its failed() takes this path; the till is first.
 */
function faultSpec(req, err, legacy, code) {
  const lost = err && connectionLost(err);
  if (!lost) return internalSpec(req, err, legacy, code);
  safeErr(err, { id: req && req.id, path: req && req.path });
  return specOf(lost);
}

/** the challenge a 401 carries (RFC 9110 sec 11.6.1): the API takes a Bearer token, which may arrive as X-Api-Key */
const AUTH_CHALLENGE = 'Bearer realm="chitbridge"';

/**
 * wwwAuthenticate — SEC-82. ONE middleware for every 401 (routes and middleware/auth.js build theirs inline, so a header set in
 * problem() alone would miss them): when the status line is written as 401 and the answer has no challenge yet, add it.
 */
function wwwAuthenticate(req, res, next) {
  const writeHead = res.writeHead;
  res.writeHead = function (status) {
    if (status === 401 && !res.getHeader('WWW-Authenticate')) res.setHeader('WWW-Authenticate', AUTH_CHALLENGE);
    return writeHead.apply(this, arguments);
  };
  next();
}

/** the JSON Schema of the body, for the published OpenAPI (routes/openapi.js) — one definition of the shape */
const PROBLEM_SCHEMA = {
  type: 'object',
  required: ['type', 'title', 'status', 'code', 'detail', 'hint', 'request_id'],
  properties: {
    type: { type: 'string', format: 'uri-reference' },
    title: { type: 'string' },
    status: { type: 'integer', minimum: 400, maximum: 599 },
    code: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_]*$' },
    detail: { type: 'string' },
    hint: { type: 'string' },
    request_id: { type: ['string', 'null'] },
    field: { type: 'string' },
    params: { type: 'object' },
    errors: { type: 'array', items: { type: 'object', required: ['field', 'code', 'detail'], properties: { field: { type: 'string' }, code: { type: 'string' }, detail: { type: 'string' } } } }
  },
  additionalProperties: true
};

/** the OpenAPI response object for an error status: the Problem body (route fragments use it to declare their refusals, S9) */
const problemResponse = (description) => ({ description, content: { 'application/problem+json': { schema: { $ref: '#/components/schemas/Problem' } } } });

module.exports = { problem, uuidParam, textParam, fromError, internalSpec, softFault, faultSpec, build, PROBLEM_SCHEMA, problemResponse, titleOf, wwwAuthenticate, AUTH_CHALLENGE };
