/*
 * OWNS      the contract of routes/csp-report.js (/api/csp-report, 1 route): its OpenAPI operation (S9).
 * CALLED BY routes/csp-report.js (contract.checked on the route, router.openapi) → tools/api-register.cjs · tools/api-contract-tests.cjs · /api/openapi.json · tests/api-problem-csp-report.test.cjs.
 * FLOW      operation → schemaValidate(operation) at the route → the register reads router.openapi → the contract cases run from the same schemas
 * CARD      28-platform-and-operations/limits-idempotency-rate-limits
 * This file shapes NO answer: the route answers 204 with no body and logs shaped fields only.
 *
 * ⚠️ PUBLIC, AND IT STAYS PUBLIC. A browser sends a CSP report with no credential, so the operation asks for none (public: true, no 401). The body is declared as the two shapes a browser sends
 *    (report-uri: an object · Reporting API: a list) and NOTHING is required: whatever the parser lets through is read leniently by the route (a report with no directive and no blocked
 *    address is simply not logged), so the schema never turns a report away. The refusals are the route's own stack: a body that is not JSON → 400 (the body parser, worded by lib/knownerr),
 *    a body over 8 KB → 413, over REPORTS_PER_MIN from one address → 429 (lib/rate-limit).
 */
'use strict';
const { contractOf, any } = require('./contract-kit');

const ROUTES = {
  'POST /': {
    summary: "Where a browser reports a violation of the web's report-only Content-Security-Policy (no sign-in; one trimmed log line; no answer body)",
    public: true,
    body: ['csp-report', 'type', 'body'],
    list: true,
    ok: 204,
    says: 'the report was taken; nothing is sent back',
    out: any,
    inline: [400, 413, 429]
  }
};
const contract = contractOf({ mount: '/api/csp-report', routes: ROUTES, gateStatus: {} });

module.exports = { contract, ROUTES };
