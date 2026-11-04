/*
 * OWNS      the contract of routes/adopt.js (/api/adopt, 2 routes): each route's OpenAPI operation (S9) and the words its refusals answer in (words, failed).
 * CALLED BY routes/adopt.js (contract.checked on each route, router.param uuidParam(words.notFound), router.openapi, problem(req, res, failed(e, req, label)))
 *           → tools/api-register.cjs · tools/api-contract-tests.cjs · /api/openapi.json · tests/api-problem-small.test.cjs.
 * FLOW      operation → schemaValidate(operation) at the route → the register reads router.openapi → the contract cases run from the same schemas
 *           a refusal → problem(req, res, { status, ...words.x() }) with the route's old body frozen under it (docs/contracts/api-legacy.json)
 * CARD      03-catalogue/adopt
 * This file shapes NO answer and judges NO delivery: the rules are lib/adopt.js, the answers are the route's own, as before.
 *
 * ⚠️ BEHAVIOUR FROZEN. The POST body is declared as the handler reads it: an object OR a list (a list is read as "no lines named" and answers the handler's own 400), `accept` is not
 *    required by the schema (the handler's 400 says "name the lines to accept"), and no key is closed. The path id is plain text here: a non-uuid is the router's 404 (uuidParam), as an unknown id is.
 */
'use strict';
const { contractOf, object } = require('./contract-kit');
const { internalSpec } = require('./problem');
const { SAFE_SENTENCE } = require('./respond');

/** the words of each refusal, with the old body kept key by key under the Problem's own */
const words = {
  notFound: () => ({ code: 'NOT_FOUND', detail: 'That delivery was not found.', legacy: { error: 'Not found' } }),
  noLines: () => ({
    code: 'INVALID_INPUT',
    detail: 'name the lines to accept — there is no "accept everything"',
    legacy: { error: 'validation', message: 'name the lines to accept — there is no "accept everything"' }
  })
};
/** a fault of ours: the screen's own label and the generic sentence, never the cause (the real error is logged with the request id) */
const failed = (e, req, label) => internalSpec(req, e, { error: label, message: SAFE_SENTENCE });

const ROUTES = {
  'GET /:chit_id': {
    summary: 'What a delivery offers to this catalogue, and what it refuses',
    out: object(['chit_id', 'from', 'says', 'rows', 'counts'])
  },
  'POST /:chit_id': {
    summary: 'Accept named lines as your OWN products',
    body: ['accept'],
    list: true,
    inline: [400],
    out: object(['message', 'added', 'refused', 'says'])
  }
};
const contract = contractOf({ mount: '/api/adopt', routes: ROUTES, gateStatus: {} });

module.exports = { words, failed, contract, ROUTES };
