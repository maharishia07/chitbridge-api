/*
 * OWNS      the contract of the three plumbing doors: GET /health (routes/health.js), OPTIONS * (routes/preflight.js) and GET /api/openapi.json (routes/openapi.js): each one's OpenAPI operation (S9).
 * CALLED BY routes/health.js · routes/preflight.js · routes/openapi.js (router.openapi) → tools/api-register.cjs · tools/api-contract-tests.cjs · tests/api-problem-plumbing.test.cjs.
 * FLOW      operation → router.openapi → the register reads it → the contract cases run from the same schemas
 * CARD      28-platform-and-operations/api-standard
 * This file shapes NO answer: the health body, the preflight reply (the cors package's own 204 and headers) and the OpenAPI document are what the routes made before, byte for byte.
 *
 * ⚠️ THESE DOORS ANSWER WHAT THEIR CALLER EXPECTS, NOT A NEW SHAPE. The uptime probe reads status 200 and `status: "OK"`; a browser reads the 204 and the Access-Control-* headers; a tool reads the OpenAPI JSON.
 *    All three are public (no sign-in, no 401), read no body and no query, and only a fault of ours can refuse them (500, a Problem through the app's one error handler).
 *    A refused origin on a preflight is the app's 403 ORIGIN_NOT_ALLOWED (server.js error handler, the cors package's callback error): DOCUMENTED here (x-documented-statuses) and not
 *    written by the route, so the register does not count it as the route's own.
 * ⚠️ /health keeps answering 200 whatever the database says (db: ok · slow · down): it says how the database is, it does not take the API out of rotation.
 */
'use strict';
const { contractOf, object, any, text } = require('./contract-kit');

const HEALTH_BODY = object(
  ['status', 'platform', 'version', 'db', 'db_ms', 'timestamp', 'environment', 'commit', 'region', 'web', 'audit_lost', 'money_mismatch', 'output_dropped', 'legacy_tokens'],
  {
    status: text,
    platform: text,
    version: text,
    db: { type: 'string', enum: ['ok', 'slow', 'down'] },
    db_ms: { type: ['integer', 'null'] },
    timestamp: text,
    environment: text,
    commit: { type: ['string', 'null'] },
    region: { type: ['string', 'null'] },
    web: { type: ['string', 'null'] },
    audit_lost: { type: 'integer' },
    money_mismatch: { type: 'integer' },
    output_dropped: any,
    legacy_tokens: any
  },
  true
);

const HEALTH = contractOf({
  mount: '/health',
  routes: { 'GET /': { summary: 'Say the API is up and how its database is (the uptime probe reads this; it answers 200 whatever the database says)', public: true, says: 'the API is up', out: HEALTH_BODY } },
  gateStatus: {}
});

const PREFLIGHT = contractOf({
  mount: '',
  routes: {
    'OPTIONS *': {
      summary: 'The browser preflight for any path: the allowed origins, methods and headers (the cors package answers 204)',
      public: true,
      ok: 204,
      says: 'the origin may call; the Access-Control headers say how',
      published: { responses: { 403: { description: 'the origin is not on the allow-list (ORIGIN_NOT_ALLOWED, the app error handler)', content: { 'application/problem+json': { schema: { $ref: '#/components/schemas/Problem' } } } } } }
    }
  },
  gateStatus: {}
});

const OPENAPI_BODY = object(['openapi', 'info', 'servers', 'tags', 'components', 'paths'], { openapi: text, info: any, servers: any, tags: any, components: any, paths: any }, true);
const OPENAPI = contractOf({
  mount: '/api',
  routes: { 'GET /openapi.json': { summary: 'The OpenAPI document of the governed services (public; offers, pricing, tax, invoice, keys, integrations)', public: true, says: 'the OpenAPI document', out: OPENAPI_BODY } },
  gateStatus: {}
});

module.exports = { HEALTH, PREFLIGHT, OPENAPI };
