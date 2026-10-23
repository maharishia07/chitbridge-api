/*
 * OWNS      the contract of routes/pricing.js: each route's OpenAPI operation (S9) and the words its refusals answer in.
 * CALLED BY routes/pricing.js (schemaValidate on the price route, router.openapi, problem(req, res, { status, ...said(...) })) → tools/api-register.cjs · tools/api-contract-tests.cjs · /api/openapi.json · tests/api-problem-finance.test.cjs.
 * FLOW      operation → schemaValidate(operation) at the route → the register reads router.openapi → the contract cases run from the same schemas
 *           a refusal → problem(req, res, { status, ...said(code, error, message) }) → the old { error, message } beside the Problem fields
 * CARD      28-platform-and-operations/pricing-service
 * This file shapes NO answer and prices nothing: the figures are lib/pricing-engine's and lib/services'.
 *
 * ⚠️ The body names the one field the handler reads (lines) and requires nothing: an empty or odd `lines` is answered by the handler in its own 400 sentence, frozen in docs/contracts/api-legacy.json.
 *    The structure and result shapes below are documentation only (the response side); no request is checked against them.
 */
'use strict';
const pricingEngine = require('./pricing-engine').CBPricing;
const { contractOf, object } = require('./contract-kit');

/** the old body of a refusal, as the spec parts problem() takes: { code, detail, legacy } */
const said = (code, error, message) => ({ code, detail: message, legacy: { error, message } });

/** the shapes the answer documents (referenced from the price route's success response) */
const SCHEMAS = {
  PricingStructure: {
    type: 'object',
    properties: {
      kind: { type: 'string', enum: pricingEngine.kinds },
      name: { type: 'string' },
      amount: { type: 'number' },
      tiers: { type: 'array', items: { type: 'object', properties: { qty: { type: 'number' }, price: { type: 'number' } } } },
      min: { type: 'number' },
      max: { type: 'number' }
    }
  },
  PriceResult: {
    type: 'object',
    properties: {
      total: { type: 'number' },
      lines: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            key: { type: 'string' },
            unit_price: { type: 'number' },
            list_price: { type: 'number' },
            structure: { type: 'string', nullable: true },
            tier: { type: 'object', nullable: true },
            why: { type: 'string' },
            violation: { type: 'string', nullable: true },
            bands: { type: 'array', items: { type: 'object' } }
          }
        }
      }
    }
  }
};

const ROUTES = {
  'GET /kinds': { summary: 'Pricing structure kinds: fixed, tiered, range, and the fields each reads (public)', public: true, out: object(['engine', 'version', 'order', 'kinds']) },
  'POST /price': {
    summary: 'Unit price at a quantity, per line (key scope: pricing)',
    gates: ['scope'],
    keyed: true,
    inline: [400],
    body: ['lines'],
    out: { $ref: '#/components/schemas/PriceResult' }
  }
};

module.exports = Object.assign({ said, SCHEMAS, ROUTES }, contractOf({ mount: '/api/pricing', routes: ROUTES, gateStatus: { scope: 403 } }));
