/*
 * OWNS      the contract of routes/offers.js (the offer engine as a service): each route's OpenAPI operation (S9), the words of its one refusal and of a fault.
 * CALLED BY routes/offers.js (schemaValidate on each route, router.openapi, problem(req, res, ...)) → tools/api-register.cjs · tools/api-contract-tests.cjs · /api/openapi.json · tests/api-problem-marketing.test.cjs.
 * FLOW      operation → schemaValidate(operation) at the route → the register reads router.openapi → the contract cases run from the same schemas
 *           a refusal → problem(req, res, { ..., legacy: { error: 'validation', message } }) → the old body's keys beside the Problem fields
 * CARD      07-offers-pricing-and-combos/offers-engine-as-service
 * This file works out no offer and no total: the engine (lib/offers-engine.js, vendored) does, and the route only shapes its answer.
 *
 * ⚠️ OUTWARD ROUTES (another system calls evaluate and explain with a key): the answers they always gave are frozen (docs/contracts/api-legacy.json). The input schema says what the handler
 *    ALREADY takes: names, nothing required, nothing narrowed — a missing lines[] is still its own 400 in words. Required lines and unknown-key refusal are API-3 (strict_input), with the owner's say.
 * ⚠️ The typed Line / Offer / Result shapes stay in the route's OpenAPI components for the people who attach to the service; the 429 of the per-key rate limit is the rate limiter's, not this route's.
 */
'use strict';
const { internalSpec } = require('./problem');
const { SAFE_SENTENCE } = require('./respond');
const { contractOf, object } = require('./contract-kit');

const SAID = { lines: 'lines[] required: { key, item_id?, qty, unitPrice }', failed: 'Failed' };

/** a fault of ours: the old { error: 'Failed', message } body, the real error logged with the request id and not told */
const faultOf = (e, req) => internalSpec(req, e, { error: SAID.failed, message: SAFE_SENTENCE });

const RESULT = { $ref: '#/components/schemas/Result' };
const ROUTES = {
  'GET /kinds': {
    summary: 'The registry of offer kinds, each with its scope and the fields it reads (open: no sign-in)',
    open: true,
    out: object(['engine', 'version', 'kinds'])
  },
  'GET /openapi.json': { summary: 'The OpenAPI document another system reads to attach to the offer service (open: no sign-in)', open: true, out: object() },
  'POST /evaluate': {
    summary: 'Evaluate offers on lines: what would come off and why (key scope: offers; 240 a minute per key)',
    gates: ['scope'],
    keyed: true,
    inline: [400],
    body: ['lines', 'offers', 'ctx'],
    out: RESULT
  },
  'POST /explain': {
    summary: 'Evaluate, with a one-line reason per adjustment (key scope: offers; 240 a minute per key)',
    gates: ['scope'],
    keyed: true,
    inline: [400],
    body: ['lines', 'offers', 'ctx'],
    out: RESULT
  }
};
const contract = contractOf({ mount: '/api/offers', routes: ROUTES, gateStatus: { scope: 403 } });

module.exports = { SAID, faultOf, contract };
