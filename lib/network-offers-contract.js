/*
 * OWNS      the contract of routes/network-offers.js: each route's OpenAPI operation (S9), the answer a refused catalogue step gets (refusalOf), a read that failed (faultOf) and the sign-in fence's sentence.
 * CALLED BY routes/network-offers.js (schemaValidate on each route, router.openapi, problem(res.req, res, ...)) → tools/api-register.cjs · tools/api-contract-tests.cjs · /api/openapi.json · tests/api-problem-marketing.test.cjs.
 * FLOW      operation → schemaValidate(operation) at the route → the register reads router.openapi → the contract cases run from the same schemas
 *           { error, message } from lib/network-catalogue → refusalOf(out) → { status, code, detail, legacy } → problem() → the old { error, message } beside the Problem fields
 * CARD      network-and-trade/network-offers
 * This file shapes NO answer: who is in the network and what a brand releases are lib/network-offers', lib/network-catalogue's and lib/network-membership's.
 *
 * ⚠️ The input schemas say what the handlers ALREADY take: names, nothing required, nothing narrowed. Every handler answers a missing or odd value in its own sentence
 *    ("policy must be opt_in or opt_out"), and those words are frozen (docs/contracts/api-legacy.json). Required fields and unknown-key refusal are API-3 (strict_input) with the owner's say.
 */
'use strict';
const { internalSpec } = require('./problem');
const { SAFE_SENTENCE } = require('./respond');
const { contractOf, object } = require('./contract-kit');

const SAID = {
  sessionOnly: 'Network offers are managed by a signed-in person.',
  forbidden: 'Forbidden',
  notRead: 'Network not read',
  failed: 'Failed'
};

/** the catalogue half answers { error, message } for a step it refuses: not_yours is a 404, validation a 400, every other step a 409 (what exists does not allow it now) */
const CATALOGUE_REFUSALS = {
  not_yours: [404, 'NOT_FOUND'],
  validation: [400, 'NETWORK_REQUEST_INVALID'],
  none: [409, 'NETWORK_NOTHING_WAITING'],
  nothing: [409, 'NETWORK_NOTHING_TO_CHANGE'],
  no_price: [409, 'NETWORK_PRICE_MISSING'],
  not_adopted: [409, 'NETWORK_NOT_ADOPTED']
};
function refusalOf(out) {
  const [status, code] = CATALOGUE_REFUSALS[out.error] || [409, 'NETWORK_REFUSED'];
  return { status, code, detail: out.message, legacy: { error: out.error, message: out.message } };
}

/** a member read that failed keeps its 503 and its words (lib/network-membership readFailed); anything else is a 500 that says nothing of its cause */
function faultOf(e, req, readFailedCode) {
  if (e && e.code === readFailedCode) return { status: 503, code: e.code, detail: e.message, legacy: { error: SAID.notRead, message: e.message } };
  return internalSpec(req, e, { error: SAID.failed, message: SAFE_SENTENCE });
}

const GATE_STATUS = { session: 403 };
const REFUSALS = [
  { status: 400, code: 'NETWORK_REQUEST_INVALID', when: 'a choice or a request the catalogue step cannot read' },
  { status: 404, code: 'NOT_FOUND', when: 'that is not one of your offers, or not a catalogue you publish' },
  {
    status: 409,
    code: 'OFFER_NOT_LIVE | OFFER_NOT_RELEASED | NETWORK_NOTHING_WAITING | NETWORK_NOTHING_TO_CHANGE | NETWORK_PRICE_MISSING | NETWORK_NOT_ADOPTED',
    when: 'the offer or the catalogue is not in a state that allows this'
  },
  { status: 503, code: 'NETWORK_READ_FAILED', when: 'who is in the network could not be read just now; nothing was changed' }
];
const OFFERS_OUT = object(['brand', 'store', 'may_design']);
const ROUTES = {
  'GET /': { summary: 'My network offers: what I release to my stores, and what my brands hand me', gates: ['session'], out: OFFERS_OUT },
  'PUT /policy': {
    summary: 'Brand: stores take a released offer by default (opt_out) or only when they say yes (opt_in)',
    gates: ['session'],
    inline: [400],
    body: ['policy'],
    out: object(['ok', 'policy', 'pushed'])
  },
  'POST /catalogue/publish': {
    summary: 'Brand: publish a catalogue change to the stores',
    gates: ['session'],
    body: ['source_key', 'at', 'add', 'withdraw', 'withdraw_at', 'restore_at'],
    out: object(['ok'])
  },
  'POST /catalogue/cancel': { summary: 'Brand: cancel what is waiting to be published', gates: ['session'], body: ['source_key'], out: object() },
  'POST /catalogue/price': {
    summary: "Store: answer a brand's suggested price (use, keep or ok)",
    gates: ['session'],
    body: ['source_key', 'name', 'key', 'choice'],
    out: object()
  },
  'POST /:id/release': {
    summary: 'Brand: release a live offer to the stores, at the next opening unless asked for sooner',
    gates: ['session'],
    inline: [400, 409],
    body: ['at', 'until'],
    out: object(['ok', 'id', 'name', 'release', 'pushed'])
  },
  'POST /:id/withdraw': {
    summary: 'Brand: withdraw a released offer',
    gates: ['session'],
    inline: [409],
    body: ['at'],
    out: object(['ok', 'id', 'until', 'pushed'])
  },
  'POST /:id/choice': {
    summary: 'Store: take a released offer (in), refuse it (out) or follow the brand default (null)',
    gates: ['session'],
    inline: [400],
    body: ['choice'],
    out: object(['ok', 'id', 'choice'])
  }
};
const contract = contractOf({
  mount: '/api/network-offers',
  routes: ROUTES,
  gateStatus: GATE_STATUS,
  refusals: REFUSALS,
  refusalsWhen: 'session',
  extension: 'x-refusals'
});

module.exports = { SAID, refusalOf, faultOf, contract, ROUTES };
