/*
 * OWNS      the contract of routes/people.js (/api/people, 1 route): its OpenAPI operation (S9) and the one way its fault is worded (failed).
 * CALLED BY routes/people.js (contract.checked on the route, router.openapi, problem(req, res, failed(e, req)))
 *           → tools/api-register.cjs · tools/api-contract-tests.cjs · /api/openapi.json · tests/api-problem-small.test.cjs.
 * FLOW      operation → schemaValidate(operation) at the route → the register reads router.openapi → the contract cases run from the same schemas
 *           a thrown error → failed(e, req) → the old { error, message } at 500, the cause logged with the request id and never sent
 * CARD      17-people-employees-hr-and-payroll/people-list
 * This file shapes NO answer: the list is lib/people.view, as before. Split from nothing: routes/actors.js has its own contract (lib/actors-contract.js) for the people's actions.
 *
 * ⚠️ BEHAVIOUR FROZEN. `for`, `page` and `limit` are declared as plain text, the way the handler reads them (an unknown `for` is the full list, a page that is not a number is the first):
 *    a schema that refused "abc" would turn a fallback into a refusal no caller has ever had. A value given twice is no text, and is the schema's 422.
 */
'use strict';
const { contractOf, object } = require('./contract-kit');
const { internalSpec } = require('./problem');
const { SAFE_SENTENCE } = require('./respond');

/** a fault of ours: the screen's old words, nothing of the cause */
const failed = (e, req) => internalSpec(req, e, { error: 'Failed to list people', message: SAFE_SENTENCE });

const ROUTES = {
  'GET /': {
    summary: "The shop's people, and what this login may do to each (?for=add: only the Add-a-person picker)",
    query: ['for', 'page', 'limit'],
    out: object(['may', 'access_choices'])
  }
};
const contract = contractOf({ mount: '/api/people', routes: ROUTES, gateStatus: {} });

module.exports = { failed, contract, ROUTES };
