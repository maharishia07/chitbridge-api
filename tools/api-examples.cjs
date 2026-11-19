/*
 * OWNS      the documented examples of the API (API-STANDARD S46, reported column 20 documented_example): docs/contracts/api-examples.json, one request body and one 2xx answer per route,
 *           and the check that every example VALIDATES against the route's own schema (a wrong example fails CI).
 * CALLED BY CI job api-standard (`node tools/api-examples.cjs --check`) · tests/api-examples.test.cjs · lib/contract-kit.js reads the file (shapeOf-style) and puts each example in its OpenAPI operation.
 * FLOW      app loaded with a stand-in database → every operation → --write builds the missing examples from the schema (+ the recorded request of api-output-shapes.json) → --check validates all
 * CARD      28-platform-and-operations/api-standard
 * Usage: node tools/api-examples.cjs --write [prefix ...]   (add the examples a route lacks; an example already in the file is kept, never rewritten)
 *        node tools/api-examples.cjs --check                 (every example in the file validates; a route in the file exists; exit 1 otherwise)
 *        node tools/api-examples.cjs --count                 (routes with an example, of all routes)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const Ajv2020 = require('ajv/dist/2020');

const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'docs', 'contracts', 'api-examples.json');
const SHAPES = path.join(ROOT, 'docs', 'contracts', 'api-output-shapes.json');
const DEFAULT_PREFIXES = ['/api/books', '/api/assign', '/api/chits/assign', '/api/counters', '/api/actors/assign'];
const ENGINE = new Ajv2020({ allErrors: true, strict: false, allowUnionTypes: true });
const UUID = '22222222-2222-4222-8222-222222222222';
const ABOUT = "Documented examples (API-STANDARD S46): routes[key] = { request?: a body the route accepts, response: { status, body } }. lib/contract-kit.js puts them in the OpenAPI operation; node tools/api-examples.cjs --check validates each against the route's own schema. Add with --write, then read them.";

const CSV_EXAMPLE = ['date,description,amount', '2026-04-01,Sample,125000', ''].join('\n');
const LINE_BREAK = String.fromCharCode(10);
const readExamples =() => (fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf8')).routes || {} : {});

/** a number that satisfies the schema's bounds: money-named fields get a rupee-sized amount, the rest 1 */
function numberOf(schema, key) {
  const guess = /minor|amount|cap|paise|cents/i.test(key) ? 125000 : 1;
  const floor = schema.minimum !== undefined ? schema.minimum : schema.exclusiveMinimum !== undefined ? schema.exclusiveMinimum + 1 : -Infinity;
  const ceiling = schema.maximum !== undefined ? schema.maximum : Infinity;
  return Math.min(Math.max(guess, floor), ceiling);
}

/** the text a field of this name carries: [test on the field name, text], first match wins */
const TEXTS = [[/(^|_)(id|client|grantee|entry)$/i, UUID], [/(_at|seen_to)$/i, '2026-04-01T09:30:00.000Z'], [/(^|_)(date|day|from|to|asof|as_of)$/i, '2026-04-01'], [/currency/i, 'INR'], [/period|month/i, '2026-04'], [/email/i, 'owner@example.com'], [/purpose/i, 'Annual audit'], [/name|label|title/i, 'Sample']];
const FORMAT_TEXTS = { uuid: UUID, 'date-time': '2026-04-01T09:30:00.000Z', date: '2026-04-01' };

/** a text that fits the schema's format and the field's name */
function textOf(schema, key) {
  const named = TEXTS.find(([test]) => test.test(key));
  const sample = FORMAT_TEXTS[schema.format] || (named ? named[1] : 'sample');
  return schema.minLength && sample.length < schema.minLength ? sample.padEnd(schema.minLength, 'x') : sample;
}

/** a value the schema itself names (an example, a const, an enum), or undefined */
function namedValueOf(schema) {
  if (schema.examples && schema.examples.length) return schema.examples[0];
  if (schema.example !== undefined) return schema.example;
  return schema.const !== undefined ? schema.const : (schema.enum || [])[0];
}

/** the first type a schema names that is not null */
const kindOf = (schema) => {
  const kinds = [].concat(schema.type || (schema.properties ? 'object' : schema.items ? 'array' : []));
  return kinds.find((item) => item !== 'null') || kinds[0];
};

/** an object or an array built from the schema's properties or items (depth-bounded) */
function structureOf(schema, kind, key, depth) {
  if (depth > 4) return kind === 'object' ? {} : [];
  if (kind === 'object') return Object.fromEntries(Object.keys(schema.properties || {}).map((field) => [field, valueOf(schema.properties[field], field, depth + 1)]));
  return schema.items && Object.keys(schema.items).length ? [valueOf(schema.items, key, depth + 1)] : [];
}

/** a value that satisfies a JSON schema, built from what the schema says (never a field the schema does not name) */
function valueOf(schema, name, depth) {
  const given = schema || {};
  const named = namedValueOf(given);
  if (named !== undefined) return named;
  const kind = kindOf(given);
  const key = String(name || '');
  if (kind === 'object' || kind === 'array') return structureOf(given, kind, key, depth);
  if (kind === 'integer' || kind === 'number') return numberOf(given, key);
  if (kind === 'boolean') return /^(has|may|is|can)_|more|truncated|consent|balanced|live|active|ok$/i.test(key);
  return kind === 'string' ? textOf(given, key) : null;
}

/** the request body example: the recorded request of the route (api-output-shapes.json) when it is a body, else built from the schema (the required fields; the first few when none is required) */
function requestOf(recorded, bodySchema) {
  const taken = recorded && recorded.body;
  if (isPlainObject(taken) && Object.keys(taken).length) return taken;
  const shaped = Array.isArray(bodySchema.type) ? Object.assign({}, bodySchema, { type: 'object' }) : bodySchema;
  const body = valueOf(shaped, '', 0);
  return isPlainObject(body) ? fewOf(body, bodySchema.required || []) : body;
}

/** the required fields of a body, or its first four when none is required */
function fewOf(body, required) {
  const entries = Object.entries(body);
  return Object.fromEntries(required.length ? entries.filter(([field]) => required.includes(field)) : entries.slice(0, 4));
}

/** a JSON object (not null, not a list) */
const isPlainObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value);

/** the lowest 2xx answer of an operation: { status, schema } */
function successOf(operation) {
  const code = Object.keys(operation.responses || {}).filter((item) => /^2/.test(item)).sort()[0];
  const content = code && operation.responses[code].content;
  const schema = content && content['application/json'] && content['application/json'].schema;
  const other = content && Object.keys(content).find((type) => type !== 'application/json');
  return code ? { status: Number(code), schema: schema || null, media: schema ? null : other || null } : null;
}

const errorWords = (checker) => JSON.stringify(checker.errors.slice(0, 2).map((error) => error.instancePath + ' ' + error.message));

/** the problems of one value against one schema */
function schemaProblems(key, what, schema, value) {
  const checker = ENGINE.compile(schema);
  return checker(value) ? [] : [key + ': the ' + what + " example does not validate against the route's schema: " + errorWords(checker)];
}

/** the problems of the request example: a body route needs one that validates, a bodyless route has none */
function requestProblems(key, example, bodySchema) {
  if (!bodySchema) return example.request === undefined ? [] : [key + ': the route takes no body and the example has a request'];
  return example.request === undefined ? [key + ': the route takes a body and the example has no request'] : schemaProblems(key, 'request', bodySchema, example.request);
}

/** the problems of the response example: it sits under the route's 2xx status and validates */
function responseProblems(key, example, success) {
  if (!success) return [key + ': the route declares no 2xx answer'];
  if (!example.response || example.response.status !== success.status) return [key + ': the response example is missing or not under ' + success.status];
  return success.schema ? schemaProblems(key, 'response', success.schema, example.response.body) : [];
}

/** the problems with one example: its request and its answer against the route's own schemas */
function problemsOfOne(key, example, operation, bodySchemaOf) {
  return requestProblems(key, example, bodySchemaOf(operation)).concat(responseProblems(key, example, successOf(operation)));
}

/** the problems with every example of the file: it must name a real route and validate against that route's own request and answer schemas */
function problemsOf(examples, operations, bodySchemaOf) {
  return Object.keys(examples).flatMap((key) => (operations[key] ? problemsOfOne(key, examples[key], operations[key], bodySchemaOf) : [key + ': not a route of the app (an example for a route that is gone)']));
}

/** the app loaded with a stand-in database, and the OpenAPI operation of every route */
function operationsOfLoadedApp() {
  const loader = require('./load-app.cjs');
  loader.stubDatabase(ROOT);
  loader.loadApp(ROOT);
  return require('./api-register.cjs').operationsOfApp();
}

/** the example of one route built from its schema, or { skipped: why } */
function entryOf(key, operations, shapes, bodySchemaOf) {
  const operation = operations[key];
  const success = successOf(operation);
  const bodySchema = bodySchemaOf(operation);
  if (!success || !(success.schema || success.media)) return { skipped: key + ' (no answer to show)' };
  const entry = {};
  if (bodySchema) entry.request = requestOf((shapes[key] || {}).example, bodySchema);
  entry.response = success.schema ? { status: success.status, body: valueOf(success.schema, '', 0) } : { status: success.status, media: success.media, body: success.media === 'text/csv' ? CSV_EXAMPLE : 'sample' };
  const refused = problemsOf({ [key]: entry }, operations, bodySchemaOf);
  return refused.length ? { skipped: refused[0] } : { entry };
}

/** add the examples the routes under the given prefixes lack (an example already in the file is kept) and write the file */
function write(argv, operations, examples, bodySchemaOf) {
  const shapes = JSON.parse(fs.readFileSync(SHAPES, 'utf8')).routes || {};
  const given = argv.filter((item) => item.startsWith('/'));
  const prefixes = given.length ? given : DEFAULT_PREFIXES;
  const skipped = [];
  Object.keys(operations).filter((key) => prefixes.some((prefix) => key.split(' ')[1].startsWith(prefix)) && !examples[key]).forEach((key) => {
    const made = entryOf(key, operations, shapes, bodySchemaOf);
    if (made.skipped) skipped.push(made.skipped);
    else examples[key] = made.entry;
  });
  const sorted = Object.fromEntries(Object.keys(examples).sort().map((key) => [key, examples[key]]));
  fs.writeFileSync(FILE, JSON.stringify({ about: ABOUT, routes: sorted }, null, 1) + '\n');
  console.log('examples: ' + Object.keys(sorted).length + ' routes; skipped ' + skipped.length + (skipped.length ? '\n  ' + skipped.join('\n  ') : ''));
}

/** the command line: --write adds examples, --count counts them, --check (default) validates them; the exit code */
function main(argv) {
  const { bodySchemaOf } = require('../middleware/validate');
  const operations = operationsOfLoadedApp();
  const examples = readExamples();
  if (argv.includes('--write')) return write(argv, operations, examples, bodySchemaOf) || 0;
  return argv.includes('--count') ? count(operations, examples) : check(operations, examples, bodySchemaOf);
}

/** --count: how many routes carry a documented example (this file's, or one in the operation already) */
function count(operations, examples) {
  const keys = Object.keys(operations);
  const have = keys.filter((key) => examples[key] || require('./api-reported.cjs').exampleColumn(operations[key]));
  console.log('routes with a documented example: ' + have.length + ' of ' + keys.length);
  return 0;
}

/** --check: every example validates against its route's own schemas; the exit code */
function check(operations, examples, bodySchemaOf) {
  const problems = problemsOf(examples, operations, bodySchemaOf);
  if (problems.length) console.error('API-EXAMPLES FAIL (' + problems.length + ')' + LINE_BREAK + '  ' + problems.join(LINE_BREAK + '  '));
  else console.log('api-examples ok: ' + Object.keys(examples).length + " examples validate against their routes' schemas");
  return problems.length ? 1 : 0;
}

module.exports = { valueOf, requestOf, problemsOf, readExamples, successOf, FILE };
if (require.main === module) process.exit(main(process.argv.slice(2)));
