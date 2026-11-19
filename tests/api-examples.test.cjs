/* api-examples.test.cjs · the examples check (tools/api-examples.cjs, S46): a good example passes, a wrong one is named, and the committed file validates. node tests/api-examples.test.cjs */
'use strict';
const assert = require('assert');
const { problemsOf, valueOf, readExamples } = require('../tools/api-examples.cjs');
const { bodySchemaOf } = require('../middleware/validate');

const operation = {
  requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['amount_minor'], properties: { amount_minor: { type: 'integer', minimum: 1 } }, additionalProperties: false } } } },
  responses: { 201: { content: { 'application/json': { schema: { type: 'object', required: ['id'], properties: { id: { type: 'string' } }, additionalProperties: false } } } } }
};
const ops = { 'POST /x': operation, 'GET /y': { responses: { 200: { content: { 'application/json': { schema: { type: 'object', properties: { n: { type: 'integer' } } } } } } } } };
const good = { 'POST /x': { request: { amount_minor: 100 }, response: { status: 201, body: { id: 'a' } } } };
assert.deepStrictEqual(problemsOf(good, ops, bodySchemaOf), [], 'a valid example passes');
const wrongRequest = { 'POST /x': { request: { amount: 100 }, response: { status: 201, body: { id: 'a' } } } };
assert.ok(problemsOf(wrongRequest, ops, bodySchemaOf).some((p) => /request example does not validate/.test(p)), 'an invented request field is named');
const wrongAnswer = { 'POST /x': { request: { amount_minor: 100 }, response: { status: 201, body: { id: 5 } } } };
assert.ok(problemsOf(wrongAnswer, ops, bodySchemaOf).some((p) => /response example does not validate/.test(p)), 'a wrong answer example is named');
assert.ok(problemsOf({ 'POST /x': { response: { status: 201, body: { id: 'a' } } } }, ops, bodySchemaOf).some((p) => /no request/.test(p)), 'a body route needs a request example');
assert.ok(problemsOf({ 'GET /gone': { response: { status: 200, body: {} } } }, ops, bodySchemaOf).some((p) => /not a route/.test(p)), 'an example for a missing route is named');
assert.ok(problemsOf({ 'GET /y': { response: { status: 200, body: {} }, request: {} } }, ops, bodySchemaOf).some((p) => /takes no body/.test(p)), 'a request example on a bodyless route is named');
assert.strictEqual(valueOf({ type: 'integer', minimum: 5 }, 'n', 0), 5, 'a generated number honours its minimum');
assert.ok(Object.keys(readExamples()).length > 0, 'the committed file is read');
console.log('api-examples.test ok');
