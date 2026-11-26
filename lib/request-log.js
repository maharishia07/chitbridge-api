// lib/request-log.js — the one structured "request" log line, built from the request and its response
// OWNER     cb-health
// RISK      personal-data
// OWNS      requestLine(req, res) — the keys of the one "request" log line — and seatOf(req), routeOf(req), noteRefusalCode(res) (also notes rows returned, noteRows)
// FLOW      server.js request logger ──▶ res 'finish' ──▶ requestLine ──▶ log.info('request', …) ──▶ one JSON line on stdout
// CALLED BY server.js
// CARD      28-platform-and-operations/logging-and-observability-db-watch
// @stage tested
// ERR-14 (Athi 21 Nov): the error-capture metric wants ONE line with code, request id, route, shop and seat. `id` is the request id, `entity` the shop,
// `route` the matched route PATTERN (so a line groups by door, never by id) and `seat` the caller's seat word from lib/role-matrix.js SEAT_NAMES
// (owner · staff · adviser · auditor · anon) — plus `customer` for a shop's own customer. A seat is a ROLE, never a name, e-mail or phone: nothing
// from the identity but its type, hat and the grant role is read here, and the logger prints no header, body or query.
'use strict';

/** the seat word of whoever made the request; never personal data */
function seatOf(req) {
  const who = req.identity;
  if (!who) return 'anon';
  if (req.acting_for_grant) return req.books_role === 'auditor' ? 'auditor' : 'adviser'; /* a firm person opening a client's books under a grant */
  if (who.identity_type === 'actor') return who.hat === 'audit' ? 'auditor' : 'staff';
  if (who.identity_type === 'customer') return 'customer';
  return 'owner';
}

/** the matched route pattern (mount + route path, e.g. /api/chits/:chit_id), or null when no route matched (404, a refusal before routing) */
function routeOf(req) {
  const pattern = req.route && typeof req.route.path === 'string' ? req.route.path : null;
  return pattern === null ? null : (req.baseUrl || '') + (pattern === '/' && req.baseUrl ? '' : pattern);
}

/** the fields of the request line (the existing keys stay: something reads id, path, status, ms, entity) */
function requestLine(req, res, startedAt) {
  return {
    id: req.id,
    method: req.method,
    /* the FULL path, not the part a mounted router leaves, and no query string (the Servers heat map counts by path: PM/SERVERS-STATUS.md, Athi 31 Oct) */
    path: (req.originalUrl || req.url).split('?')[0],
    route: routeOf(req),
    status: res.statusCode,
    ms: Date.now() - startedAt,
    code: localOf(res, 'code'),
    kind: localOf(res, 'kind') /* M05: 'person' (listed session) · 'legacy' (no jti) */,
    origin: req.headers.origin || null,
    /* E07: whose request — the business (entity) and who acted (person); the body's size, for E01's budgets */
    entity: entityOf(req),
    person: personOf(req),
    seat: seatOf(req),
    bytes: Number(req.headers['content-length']) || 0,
    /* PERF1 paged reads (Athi 26 Nov): how many records a list answer carried (rows) and how many exist when the answer says (total); null for an answer that is not a list. tools/paged-reads-report.cjs reads these two */
    rows: localOf(res, 'rows'),
    total: localOf(res, 'rows_total')
  };
}

const CODE_WORD = /^[A-Z][A-Z0-9_]{2,}$/;

/** the code word a refusal body carries ({ code } or { error:{ code } }), or null */
function codeOfBody(body) {
  const word = [body && body.code, body && body.error && body.error.code].find(w => CODE_WORD.test(w));
  return word || null;
}

/**
 * noteRefusalCode(res) — ERR-14 part 3 for EVERY refusal, not only those sent through lib/problem.js: a route that answers with its own
 * res.status(4xx|5xx).json({ code } or { error:{ code } }) left res.locals.code empty, so its log line named no code. This wraps res.json ONCE (server.js
 * logger, before any route) and lets the answer's own code reach res.locals.code when nothing set it. It reads the code only; the body is never changed.
 */
function noteRefusalCode(res) {
  const send = res.json;
  res.json = function (body) {
    const word = res.statusCode >= 400 ? codeOfBody(body) : null;
    if (word && res.locals && !res.locals.code) res.locals.code = word;
    if (res.locals && res.statusCode < 300) noteRows(res, body);
    return send.apply(this, arguments);
  };
}

/**
 * noteRows(res, body) — PERF1: how many records one answer carries. The list is the answer itself (an array) or the longest array at the answer's top level (every list route answers
 * { <key>: rows, total, page, limit } — lib/page-limit pageOut); `total` is the answer's own `total` when it is a number. Counts only; no value is read, kept or logged. Not a list: nothing is set.
 */
function noteRows(res, body) {
  if (!body || typeof body !== 'object') return;
  const list = Array.isArray(body) ? body : longestList(body);
  if (!list) return;
  res.locals.rows = list.length;
  if (!Array.isArray(body) && typeof body.total === 'number') res.locals.rows_total = body.total;
}

/** the longest array at the top level of an answer, or null (a count of records, never a sum of them) */
function longestList(body) {
  let longest = null;
  for (const value of Object.values(body)) if (Array.isArray(value) && (!longest || value.length > longest.length)) longest = value;
  return longest;
}

/** one value a handler left on res.locals, or null */
function localOf(res, key) {
  return (res.locals && res.locals[key]) || null;
}

/** the business a request belongs to: the parent shop when the caller is a person of one, else the identity itself; null when anonymous */
function entityOf(req) {
  return (req.identity && (req.identity.parent_entity_id || req.identity.identity_id)) || null;
}

/** who acted: the signed-in identity's id, or null */
function personOf(req) {
  return (req.identity && req.identity.identity_id) || null;
}

module.exports = { requestLine, seatOf, routeOf, noteRefusalCode, noteRows };
