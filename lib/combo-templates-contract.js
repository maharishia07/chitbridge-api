/*
 * OWNS      the contract of routes/combo-templates.js: each route's OpenAPI operation (S9), how a malformed save keeps its old 400 (validationOptions), and the words of a refusal and of a fault.
 * CALLED BY routes/combo-templates.js (schemaValidate on each route, router.openapi, problem(req, res, ...)) → tools/api-register.cjs · tools/api-contract-tests.cjs · /api/openapi.json · tests/api-problem-marketing.test.cjs.
 * FLOW      operation → schemaValidate(operation, validationOptions) at the route → the register reads router.openapi → the contract cases run from the same schemas
 *           a refusal → problem(req, res, said(status, code, error, message)) → the old { error, message } beside the Problem fields
 * CARD      07-offers-pricing-and-combos/combo-templates
 * This file shapes NO answer and judges no combo: whether a group is a good one is lib/variant.js's (the client runs it before "Save as"); the route only keeps the rows.
 *
 * ⚠️ A save with a missing or odd name or definition has always been a 400 { error: 'Validation failed', details: [{ field, message }] } (express-validator). It stays that 400 and that body
 *    (validationOptions), not the standard 422, until the screen that reads `details` moves — so every route here declares 400, not 422, for a malformed request (the kit's schemaStatus).
 */
'use strict';
const { internalSpec } = require('./problem');
const { SAFE_SENTENCE } = require('./respond');
const { contractOf, object, any } = require('./contract-kit');

/** one refusal in the route's words: the Problem fields beside the old { error, message } */
const said = (status, code, error, message) => ({ status, code, detail: message, legacy: { error, message } });

/** the old "Validation failed" body: one { field, message } per field at fault, in the words express-validator always gave */
const validationOptions = {
  status: 400,
  code: 'VALIDATION_FAILED',
  legacy: (failures) => ({ error: 'Validation failed', details: failures.map((failure) => ({ field: failure.field, message: 'Invalid value' })) })
};

/** a refusal the database or a library names (4xx) keeps its status and the route's label; anything else is a 500 that says nothing of its cause */
function faultOf(e, req, label) {
  if (e && e.status && e.status >= 400 && e.status < 500)
    return { status: e.status, code: 'COMBO_REFUSED', detail: e.message, legacy: { error: label, message: e.message } };
  return internalSpec(req, e, { error: label, message: SAFE_SENTENCE });
}

const ROUTES = {
  'GET /': { summary: 'My saved combos, newest first', schemaStatus: 400, query: ['page', 'limit'], out: object(['templates', 'total', 'page', 'limit']) },
  'POST /': {
    summary: 'Save a combo for reuse ("Save as")',
    schemaStatus: 400,
    inline: [400],
    bodySchema: {
      type: 'object',
      required: ['name', 'definition'],
      properties: { name: { type: 'string' }, definition: { type: 'array', items: {} }, price: any }
    },
    out: object(['message', 'template'])
  },
  'PATCH /:id': {
    summary: 'Rename a saved combo, replace what it holds, price it or link it to a product that already exists',
    schemaStatus: 400,
    inline: [400],
    bodySchema: { type: 'object', properties: { name: { type: 'string' }, definition: { type: 'array', items: {} }, price: any, product_item_id: any } },
    out: object(['message', 'template'])
  },
  'POST /:id/push': {
    summary: 'Push a saved combo to the product list: creates the product the first time, updates it every time after',
    schemaStatus: 400,
    inline: [400, 403],
    body: [],
    out: object(['message', 'verb', 'item', 'template'])
  },
  'DELETE /:id': { summary: 'Delete a saved combo', schemaStatus: 400, out: object(['message']) }
};
const contract = contractOf({ mount: '/api/combo-templates', routes: ROUTES, gateStatus: {} });

module.exports = { said, validationOptions, faultOf, contract };
