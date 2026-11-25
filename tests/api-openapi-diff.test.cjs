/**
 * api-openapi-diff.test.cjs — D1 (batch 1130): the breaking-change check on the published operations (tools/api-openapi-diff.cjs).
 * Run: node tests/api-openapi-diff.test.cjs
 * CARD      28-platform-and-operations/api-standard
 */
'use strict';
const { diffOperations } = require('../tools/api-openapi-diff.cjs');
let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const answer = (schema, status) => ({ responses: { [status || '200']: { content: { 'application/json': { schema } } } } });
const obj = (properties, extra) => Object.assign({ type: 'object', properties }, extra || {});
const diff = (before, after) => diffOperations({ 'GET /x': before }, { 'GET /x': after });
const breaking = (list) => list.filter((finding) => finding.breaking);
const request = (schema, required) => ({ requestBody: { required, content: { 'application/json': { schema } } } });

ok('same operation: nothing', diff(answer(obj({ a: { type: 'string' } })), answer(obj({ a: { type: 'string' } }))).length === 0);
ok('a key removed from an answer is breaking', breaking(diff(answer(obj({ a: {}, b: {} })), answer(obj({ a: {} })))).length === 1);
ok('a key added to an answer is not a finding', diff(answer(obj({ a: {} })), answer(obj({ a: {}, b: {} }))).length === 0);
ok('an answer type changed is breaking', breaking(diff(answer(obj({ a: { type: 'string' } })), answer(obj({ a: { type: ['string', 'null'] } })))).length === 1);
ok('a key no longer always there is breaking', breaking(diff(answer(obj({ a: {} }, { required: ['a'] })), answer(obj({ a: {} })))).length === 1);
ok('a 200 no longer declared is breaking, a 404 only a note', breaking(diff({ responses: { 200: {}, 404: {} } }, { responses: { 404: {} } })).length === 1 && diff({ responses: { 404: {} } }, { responses: {} }).filter((f) => !f.breaking).length === 1);
ok('a route removed is breaking', breaking(diffOperations({ 'GET /x': {} }, {})).length === 1);
ok('a new required request key is breaking', breaking(diff(request(obj({ a: {} })), request(obj({ a: {}, b: {} }, { required: ['b'] })))).length === 1);
ok('an optional new request key is fine', diff(request(obj({ a: {} })), request(obj({ a: {}, b: {} }))).length === 0);
ok('unknown request keys now refused is breaking', breaking(diff(request(obj({ a: {} })), request(obj({ a: {} }, { additionalProperties: false })))).length === 1);
ok('a request maxLength lowered is breaking, raised is fine', breaking(diff(request(obj({ a: { maxLength: 10 } })), request(obj({ a: { maxLength: 5 } })))).length === 1 && diff(request(obj({ a: { maxLength: 10 } })), request(obj({ a: { maxLength: 20 } }))).length === 0);
ok('a request enum value lost is breaking', breaking(diff(request(obj({ a: { enum: ['x', 'y'] } })), request(obj({ a: { enum: ['x'] } })))).length === 1);
ok('a new required parameter is breaking', breaking(diff({ parameters: [] }, { parameters: [{ name: 'q', in: 'query', required: true }] })).length === 1);
ok('a nested answer key removed names where', diff(answer(obj({ rows: { type: 'array', items: obj({ id: {}, n: {} }) } })), answer(obj({ rows: { type: 'array', items: obj({ id: {} }) } })))[0].what.includes('rows[]'));
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
