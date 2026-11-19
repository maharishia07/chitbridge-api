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
const readExamples =() => (fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf8')).routes || {} : {});

/** a value that satisfies a JSON schema, built from what the schema says (never a field the schema does not name) */
function valueOf(schema, name, depth) {
  const s = schema || {};
  if (s.examples && s.examples.length) return s.examples[0];
  if (s.example !== undefined) return s.example;
  if (s.const !== undefined) return s.const;
  if (s.enum && s.enum.length) return s.enum[0];
  const kinds = [].concat(s.type || (s.properties ? 'object' : s.items ? 'array' : []));
  const kind = kinds.find((one) => one !== 'null') || kinds[0];
  const key = String(name || '');
  if (kind === 'object') {
    const properties = s.properties || {};
    if (depth > 4) return {};
    const out = {};
    Object.keys(properties).forEach((field) => { out[field] = valueOf(properties[field], field, depth + 1); });
    return out;
  }
  if (kind === 'array') return s.items && Object.keys(s.items).length && depth <= 4 ? [valueOf(s.items, key, depth + 1)] : [];
  if (kind === 'integer' || kind === 'number') {
    const guess = /minor|amount|cap|paise|cents/i.test(key) ? 125000 : 1;
    const low = s.minimum !== undefined ? s.minimum : s.exclusiveMinimum !== undefined ? s.exclusiveMinimum + 1 : -Infinity;
    const high = s.maximum !== undefined ? s.maximum : Infinity;
    return Math.min(Math.max(guess, low), high);
  }
  if (kind === 'boolean') return /^(has|may|is|can)_|more|truncated|consent|balanced|live|active|ok$/i.test(key);
  if (kind === 'string') {
    if (s.format === 'uuid' || /(^|_)(id|client|grantee|entry)$/i.test(key)) return UUID;
    if (s.format === 'date-time' || /(_at|seen_to)$/i.test(key)) return '2026-04-01T09:30:00.000Z';
    if (s.format === 'date' || /(^|_)(date|day|from|to|asof|as_of)$/i.test(key)) return '2026-04-01';
    if (/currency/i.test(key)) return 'INR';
    if (/period|month/i.test(key)) return '2026-04';
    if (/email/i.test(key)) return 'owner@example.com';
    const text = /purpose/i.test(key) ? 'Annual audit' : /name|label|title/i.test(key) ? 'Sample' : 'sample';
    return s.minLength && text.length < s.minLength ? text.padEnd(s.minLength, 'x') : text;
  }
  return null;
}

/** the request body example: the recorded request of the route (api-output-shapes.json) when it is a body, else built from the schema (the required fields; the first few when none is required) */
function requestOf(recorded, bodySchema) {
  if (recorded && recorded.body && typeof recorded.body === 'object' && !Array.isArray(recorded.body) && Object.keys(recorded.body).length) return recorded.body;
  const shaped = Array.isArray(bodySchema.type) ? Object.assign({}, bodySchema, { type: 'object' }) : bodySchema;
  const body = valueOf(shaped, '', 0);
  const required = bodySchema.required || [];
  const isObject = body && typeof body === 'object' && !Array.isArray(body);
  if (isObject && required.length) return Object.fromEntries(Object.entries(body).filter(([field]) => required.includes(field)));
  if (isObject && Object.keys(body).length > 4) return Object.fromEntries(Object.entries(body).slice(0, 4));
  return body;
}

/** the lowest 2xx answer of an operation: { status, schema } */
function successOf(operation) {
  const code = Object.keys(operation.responses || {}).filter((one) => /^2/.test(one)).sort()[0];
  const content = code && operation.responses[code].content;
  const schema = content && content['application/json'] && content['application/json'].schema;
  const other = content && Object.keys(content).find((type) => type !== 'application/json');
  return code ? { status: Number(code), schema: schema || null, media: schema ? null : other || null } : null;
}

const errorWords = (run) => JSON.stringify(run.errors.slice(0, 2).map((e) => e.instancePath + ' ' + e.message));

/** the problems with every example of the file: it must name a real route and validate against that route's own request and answer schemas */
function problemsOf(examples, operations, bodySchemaOf) {
  const problems = [];
  Object.keys(examples).forEach((key) => {
    const operation = operations[key];
    if (!operation) { problems.push(key + ': not a route of the app (an example for a route that is gone)'); return; }
    const example = examples[key];
    const bodySchema = bodySchemaOf(operation);
    if (bodySchema && example.request === undefined) problems.push(key + ': the route takes a body and the example has no request');
    if (!bodySchema && example.request !== undefined) problems.push(key + ': the route takes no body and the example has a request');
    if (bodySchema && example.request !== undefined) { const run = ENGINE.compile(bodySchema); if (!run(example.request)) problems.push(key + ": the request example does not validate against the route's body schema: " + errorWords(run)); }
    const success = successOf(operation);
    if (!success) { problems.push(key + ': the route declares no 2xx answer'); return; }
    if (!example.response || example.response.status !== success.status) { problems.push(key + ': the response example is missing or not under ' + success.status); return; }
    if (success.schema) { const run = ENGINE.compile(success.schema); if (!run(example.response.body)) problems.push(key + ": the response example does not validate against the route's answer schema: " + errorWords(run)); }
  });
  return problems;
}

function operationsOfLoadedApp() {
  const loader = require('./load-app.cjs');
  loader.stubDatabase(ROOT);
  loader.loadApp(ROOT);
  return require('./api-register.cjs').operationsOfApp();
}

function write(argv, operations, examples, bodySchemaOf) {
  const shapes = JSON.parse(fs.readFileSync(SHAPES, 'utf8')).routes || {};
  const given = argv.filter((one) => one.startsWith('/'));
  const prefixes = given.length ? given : DEFAULT_PREFIXES;
  const skipped = [];
  Object.keys(operations).filter((key) => prefixes.some((prefix) => key.split(' ')[1].startsWith(prefix)) && !examples[key]).forEach((key) => {
    const operation = operations[key];
    const success = successOf(operation);
    const bodySchema = bodySchemaOf(operation);
    if (!success || !(success.schema || success.media)) { skipped.push(key + ' (no answer to show)'); return; }
    const entry = {};
    if (bodySchema) entry.request = requestOf((shapes[key] || {}).example, bodySchema);
    entry.response = success.schema ? { status: success.status, body: valueOf(success.schema, '', 0) } : { status: success.status, media: success.media, body: success.media === 'text/csv' ? CSV_EXAMPLE : 'sample' };
    const bad = problemsOf({ [key]: entry }, operations, bodySchemaOf);
    if (bad.length) { skipped.push(bad[0]); return; }
    examples[key] = entry;
  });
  const sorted = Object.fromEntries(Object.keys(examples).sort().map((key) => [key, examples[key]]));
  fs.writeFileSync(FILE, JSON.stringify({ about: ABOUT, routes: sorted }, null, 1) + '\n');
  console.log('examples: ' + Object.keys(sorted).length + ' routes; skipped ' + skipped.length + (skipped.length ? '\n  ' + skipped.join('\n  ') : ''));
}

function main(argv) {
  const { bodySchemaOf } = require('../middleware/validate');
  const operations = operationsOfLoadedApp();
  const examples = readExamples();
  if (argv.includes('--write')) { write(argv, operations, examples, bodySchemaOf); return 0; }
  if (argv.includes('--count')) {
    const keys = Object.keys(operations);
    const have = keys.filter((key) => examples[key] || require('./api-reported.cjs').exampleColumn(operations[key]));
    console.log('routes with a documented example: ' + have.length + ' of ' + keys.length);
    return 0;
  }
  const problems = problemsOf(examples, operations, bodySchemaOf);
  if (problems.length) { console.error('API-EXAMPLES FAIL (' + problems.length + ')\n  ' + problems.join('\n  ')); return 1; }
  console.log("api-examples ok: " + Object.keys(examples).length + " examples validate against their routes' schemas");
  return 0;
}

module.exports = { valueOf, requestOf, problemsOf, readExamples, successOf, FILE };
if (require.main === module) process.exit(main(process.argv.slice(2)));
