#!/usr/bin/env node
/**
 * offers-published-contract.test.cjs — the offer service's PUBLISHED document is typed while its ENFORCED schema stays loose (api #350 hold, 2026-10-23).
 *
 * OWNS      the proof that GET /api/offers/openapi.json (routes/offers.js router.openapi, through routes/openapi.js) gives evaluate and explain the typed
 *           request body (EvaluateBody: Line with qty and unitPrice required, Offer, ctx), requestBody required:true and the 429 response, and that the schema the
 *           route ENFORCES (the one schemaValidate holds) is still names only, nothing required, nothing narrowed.
 * CALLED BY scripts/guards.cjs · CI. No database, no network. Reads routes/offers.js and lib/offers-contract.js (the contract) and lib/contract-kit.js (published, never copied).
 * FLOW      router.openapi.paths → typed body / required / 429 · router stack → schemaOperation.requestBody → equal to the loose literal below
 */
'use strict';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
const assert = require('assert');
const router = require('../routes/offers');
const { contract } = require('../lib/offers-contract');

let passed = 0;
const check = (name, fn) => {
  fn();
  passed++;
};
const LOOSE = { content: { 'application/json': { schema: { type: 'object', properties: { lines: {}, offers: {}, ctx: {} } } } } };
const published = (route) => router.openapi.paths['/api/offers/' + route].post;
const enforced = (route) => {
  const layer = router.stack.find((item) => item.route && item.route.path === '/' + route && item.route.methods.post);
  const holder = layer.route.stack.map((item) => item.handle).find((fn) => fn.schemaOperation);
  return holder.schemaOperation;
};

['evaluate', 'explain'].forEach((route) => {
  check(route + ': the published body is the typed EvaluateBody and required', () => {
    const body = published(route).requestBody;
    assert.strictEqual(body.required, true);
    assert.strictEqual(body.content['application/json'].schema.$ref, '#/components/schemas/EvaluateBody');
  });
  check(route + ': the published document carries the 429 of the per-key limit', () => {
    assert.ok(/240\/min per key/.test(published(route).responses[429].description));
  });
  check(route + ': the published document keeps its Problem refusals', () => {
    [401, 403, 500].forEach((status) => assert.ok(published(route).responses[status], 'status ' + status));
  });
  check(route + ': the enforced schema is unchanged (names only, nothing required)', () => {
    assert.deepStrictEqual(enforced(route).requestBody, LOOSE);
    assert.strictEqual(enforced(route).responses[429], undefined);
    assert.deepStrictEqual(contract.operationFor('POST /' + route).requestBody, LOOSE);
  });
});
check('the documented 429 is flagged so the register does not count it as the route own', () => {
  assert.deepStrictEqual(published('evaluate')['x-documented-statuses'], [429]);
  assert.strictEqual(enforced('evaluate')['x-documented-statuses'], undefined);
});
check('the typed shapes resolve: Line needs qty and unitPrice, Offer needs kind, EvaluateBody needs lines', () => {
  const schemas = router.openapi.schemas;
  assert.deepStrictEqual(schemas.Line.required, ['qty', 'unitPrice']);
  assert.deepStrictEqual(schemas.Offer.required, ['kind']);
  assert.deepStrictEqual(schemas.EvaluateBody.required, ['lines']);
  assert.strictEqual(schemas.EvaluateBody.properties.lines.items, schemas.Line);
  assert.strictEqual(schemas.EvaluateBody.properties.offers.items, schemas.Offer);
  assert.ok(schemas.EvaluateBody.properties.ctx.properties.currency);
});
check('a route that publishes nothing extra is its enforced operation, same object', () => {
  assert.strictEqual(router.openapi.paths['/api/offers/kinds'].get, contract.OPERATIONS['GET /api/offers/kinds']);
});
console.log('\n  ' + passed + ' checks, 0 failed');
