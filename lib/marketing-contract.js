/*
 * OWNS      the contract of routes/marketing.js (/api/marketing): its route's OpenAPI operation (S9), the Marketing read's fault (faultOf) and the sentence the sign-in fence answers in.
 * CALLED BY routes/marketing.js (schemaValidate on the route, router.openapi, problem(req, res, faultOf(err, req))) → tools/api-register.cjs · tools/api-contract-tests.cjs · /api/openapi.json · tests/api-problem-marketing.test.cjs.
 * FLOW      operation → schemaValidate(operation) at the route → the register reads router.openapi → the contract cases run from the same schemas
 *           a thrown error → faultOf(e, req) → the status the error names (500 when none) with a body that says nothing of its cause
 * CARD      11-crm-and-marketing/crm-routes
 * Split from lib/crm-contract.js (the CRM's own contract, API-4 crm sweep) so each router has its contract in one file. This file shapes NO answer: the figures are lib/marketing-results'.
 *
 * ⚠️ A query value the handler reads leniently (a page falls back to the first) is declared as plain text: a schema that refused it would turn a fallback into a refusal no caller has ever had.
 */
'use strict';
const { internalSpec } = require('./problem');
const { SAFE_SENTENCE } = require('./respond');
const { contractOf, object } = require('./contract-kit');

/* ── the sentences the fence and the fault answer in (frozen: they are the words the screens map to their own lines) ── */
const SAID = { signInMarketing: 'Sign in to use Marketing.', failed: 'Failed' };

/** the Marketing read answers with the status its error names (it has always done), 500 when it names none; the body says nothing of the cause */
function faultOf(e, req) {
  return Object.assign(internalSpec(req, e, { error: SAID.failed, message: SAFE_SENTENCE }), { status: (e && e.status) || 500 });
}

const ROUTES = {
  'GET /came-back': {
    summary: "Who was sent an offer and then bought within the shop's days-to-come-back, with the bills that count",
    gates: ['noKey'],
    query: ['page', 'limit'],
    out: object(['customers', 'sent_n', 'came_back_n', 'money', 'total', 'page', 'limit'])
  }
};
const marketingContract = contractOf({ mount: '/api/marketing', routes: ROUTES, gateStatus: { noKey: 403 } });

module.exports = { SAID, faultOf, marketingContract, ROUTES };
