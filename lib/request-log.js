// OWNS      requestLine(req, res) — the keys of the one "request" log line — and seatOf(req), routeOf(req)
// FLOW      server.js request logger ──▶ res 'finish' ──▶ requestLine ──▶ log.info('request', …) ──▶ one JSON line on stdout
// CALLED BY server.js
// CARD      28-platform-and-operations/logging-and-observability-db-watch
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
function requestLine(req, res, t0) {
  return {
    id: req.id,
    method: req.method,
    /* the FULL path, not the part a mounted router leaves, and no query string (the Servers heat map counts by path: PM/SERVERS-STATUS.md, Athi 31 Oct) */
    path: (req.originalUrl || req.url).split('?')[0],
    route: routeOf(req),
    status: res.statusCode,
    ms: Date.now() - t0,
    code: (res.locals && res.locals.code) || null,
    kind: (res.locals && res.locals.kind) || null /* M05: 'person' (listed session) · 'legacy' (no jti) */,
    origin: req.headers.origin || null,
    /* E07: whose request — the business (entity) and who acted (person); the body's size, for E01's budgets */
    entity: (req.identity && (req.identity.parent_entity_id || req.identity.identity_id)) || null,
    person: (req.identity && req.identity.identity_id) || null,
    seat: seatOf(req),
    bytes: Number(req.headers['content-length']) || 0
  };
}

module.exports = { requestLine, seatOf, routeOf };
