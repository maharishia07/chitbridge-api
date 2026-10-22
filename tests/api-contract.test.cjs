/**
 * tests/api-contract.test.cjs — API-1 slice 1b: schemaValidate (ajv over the route's own schema) and the contract cases generated from it.
 *
 * OWNS      the proof that a request is checked against the route's own schema, that EVERY field at fault is named (S4), that an outward route keeps its old refusal (S2),
 *           and that the generated cases (tools/api-contract-tests.cjs) pass for every route that validates its input, with the committed results equal to what they give.
 * CALLED BY scripts/guards.cjs · CI. No database, no network: the middleware runs alone on a stand-in request; the real app is loaded offline for the generated cases.
 * FLOW      operation → schemaValidate → stand-in request → answer (status, Problem body, errors[]) ──▶ generator over the real app ──▶ results equal the committed file
 * CARD      28-platform-and-operations/api-standard
 */
'use strict';
const path = require('path');
const API = path.join(__dirname, '..');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
const { schemaValidate, errorsOf, bodyEngine } = require(path.join(API, 'middleware', 'validate.js'));
const generator = require(path.join(API, 'tools', 'api-contract-tests.cjs'));

let passed = 0;
let failed = 0;
const check = (label, condition) => {
  if (condition) passed++;
  else failed++;
  console.log('  ' + (condition ? 'ok  ' : 'FAIL') + '  ' + label);
};

const OPERATION = {
  requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['name', 'qty'], properties: { name: { type: 'string' }, qty: { type: 'integer' }, tags: { type: 'array', items: { type: 'string' } } } } } } },
  parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }, { name: 'limit', in: 'query', schema: { type: 'integer' } }]
};
const answer = (check, request) => generator.runCheck(check, Object.assign({ id: 'r1', path: '/x', body: {}, params: { id: 'a' }, query: {} }, request));

console.log('\napi contract · schemaValidate and the generated cases');
const guard = schemaValidate(OPERATION);

const good = answer(guard, { body: { name: 'a', qty: 2 } });
check('a valid request is let through', good.accepted && good.status === null);

const empty = answer(guard, { body: {} });
check('nothing sent: 422 INVALID_INPUT', !empty.accepted && empty.status === 422 && empty.body.code === 'INVALID_INPUT');
check('nothing sent: EVERY needed field is named, not the first', ['name', 'qty'].every((field) => empty.body.errors.some((entry) => entry.field === field && entry.code === 'MISSING_FIELD')));
check('the Problem body keeps its request id and a plain sentence for each field', empty.body.request_id === 'r1' && empty.body.errors.every((entry) => /needed\.$/.test(entry.detail)));

const wrong = answer(guard, { body: { name: 5, qty: 'two', tags: [1] } });
check('wrong kinds: every field at fault is named, with the index of an array item', ['name', 'qty', 'tags.0'].every((field) => wrong.body.errors.some((entry) => entry.field === field && entry.code === 'WRONG_VALUE')));

check('a body that is not an object is refused, not crashed on', answer(guard, { body: 'text' }).status === 422);
check('a missing body is read as nothing sent', answer(guard, { body: undefined }).status === 422);
check('a path id that is missing is named', answer(guard, { body: { name: 'a', qty: 1 }, params: {} }).body.errors[0].field === 'id');
check('a query number arrives as text and is accepted', answer(guard, { body: { name: 'a', qty: 1 }, query: { limit: '5' } }).accepted);
check('a query value that is not a number is refused', answer(guard, { body: { name: 'a', qty: 1 }, query: { limit: 'abc' } }).status === 422);
check('a body number is NOT quietly turned into text', answer(guard, { body: { name: 7, qty: 1 } }).status === 422);

const outward = schemaValidate(OPERATION, { status: 400, code: 'OLD_REFUSAL', legacy: (failures) => ({ error: 'validation', message: failures[0].detail }) });
const kept = answer(outward, { body: {} });
check('an outward route keeps its status and code', kept.status === 400 && kept.body.code === 'OLD_REFUSAL');
check('an outward route keeps its frozen legacy keys beside the Problem fields', kept.body.error === 'validation' && typeof kept.body.message === 'string' && kept.body.status === 400);

check('the middleware carries its operation for the register and the generator', guard.schemaOperation === OPERATION);
check('errorsOf answers nothing for a value that fits', errorsOf(bodyEngine.compile({ type: 'object' }), {}).length === 0);

const cases = generator.casesFor(OPERATION);
check('the generator makes a case for each needed field, each property kind and the empty request', cases.length >= 8);
check('every generated case passes against the middleware', cases.every((item) => generator.judge(item, guard) === null));
const laxGuard = Object.assign(() => undefined, { schemaOperation: OPERATION, schemaOptions: {} });
check('a middleware that lets everything through FAILS the generated cases', cases.some((item) => generator.judge(item, laxGuard) !== null));

const real = generator.schemaRoutes(API);
const keys = Object.keys(real);
check('the real app has routes that validate against their own schema (routes/keys.js)', keys.includes('POST /api/keys') && keys.includes('DELETE /api/keys/:jti'));
const ran = generator.runAll(real);
check('every generated case of every real route passes', ran.failures.length === 0);
check('the committed results equal what the cases give (run tools/api-contract-tests.cjs --write)', require('fs').readFileSync(generator.RESULTS_FILE, 'utf8') === generator.textOf(ran.results));

console.log('\n  ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
