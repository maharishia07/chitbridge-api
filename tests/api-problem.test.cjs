/**
 * tests/api-problem.test.cjs — API-1 slice 1a: the ONE error body (lib/problem.js), the legacy keys frozen, and the worked example routes/keys.js.
 *
 * OWNS      the proof that every error answer of routes/keys.js, the 404 and the error handler is a Problem body AND still carries the keys it answered before
 *           (docs/contracts/api-legacy.json, recorded from the code before this change), and the list of statuses each keys route is tested for
 *           (docs/contracts/api-error-tests.json, which the register's error_tests column reads).
 * CALLED BY scripts/guards.cjs · CI. No database, no network: the real routes/keys.js over a stand-in db and auth; the 404 and handler through the real server.js (tools/load-app.cjs).
 * FLOW      scenario → real route → body → Problem fields present · frozen legacy keys equal · no leak on a 5xx · statuses tested → manifest
 *
 *   node tests/api-problem.test.cjs                    check
 *   node tests/api-problem.test.cjs --write            rewrite docs/contracts/api-error-tests.json (the statuses these scenarios cover)
 *   node tests/api-problem.test.cjs --capture F        (run against the code BEFORE the change, API_ROOT=<that checkout>) record each answer to file F
 */
'use strict';
const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');

const HERE = path.join(__dirname, '..');
const API = process.env.API_ROOT ? path.resolve(process.env.API_ROOT) : HERE;
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
const LEGACY_FILE = path.join(HERE, 'docs', 'contracts', 'api-legacy.json');
const TESTED_FILE = path.join(HERE, 'docs', 'contracts', 'api-error-tests.json');
const argv = process.argv.slice(2);
const PROBLEM_FIELDS = ['type', 'title', 'status', 'code', 'detail', 'hint', 'request_id', 'field', 'params', 'errors'];
const REQUIRED_FIELDS = ['type', 'title', 'status', 'code', 'detail', 'hint', 'request_id'];

let passed = 0;
let failed = 0;
const check = (label, condition, info) => {
  if (condition) passed++;
  else failed++;
  console.log('  ' + (condition ? 'ok  ' : 'FAIL') + '  ' + label + (condition || info === undefined ? '' : '\n        ' + JSON.stringify(info).slice(0, 500)));
};
const sameValue = (left, right) => JSON.stringify(left) === JSON.stringify(right);

/* ── stand-ins for the keys router: db, auth, policy, platform ───────────────────────────────────────────── */
const mock = (relative, exported) => {
  const file = require.resolve(path.join(API, relative));
  require.cache[file] = { id: file, filename: file, loaded: true, exports: exported };
};
const SHOP = { identity_id: 'e1', identity_type: 'entity', owner_scope: 'entity' };
const CO_ASSIST = { identity_id: 'a1', identity_type: 'actor', parent_entity_id: 'e1' };
const world = { realAuth: false, who: SHOP, asKey: false, keys: [], dbFails: false };
const SECRET_SQL = 'relation "identities" does not exist -- SELECT secret FROM vault';

function installStubs() {
  const realAuth = require(path.join(API, 'middleware', 'auth'));
  const stubAuth = (req, res, next) => {
    if (world.realAuth) return realAuth(req, res, next);
    req.identity = world.who;
    if (world.asKey) req.api_key = true;
    return next();
  };
  mock('middleware/auth', Object.assign(stubAuth, realAuth, { entityOf: (req) => req.identity.identity_id, forgetKey: () => {}, SCOPE_NAMES: ['services', 'offers', 'pricing', 'tax', 'invoice', 'till', 'connector', 'testing'] }));
  const rows = () => {
    if (world.dbFails) throw new Error(SECRET_SQL);
    return { rows: [{ policy_flags: { api_keys: world.keys } }], rowCount: 1 };
  };
  const client = { query: async () => rows() };
  const db = { query: async () => rows(), withTransaction: async (run) => (rows(), run(client)), withEntity: async (id, run) => run(client), readBatch: async () => [{ rows: [], rowCount: 0 }] };
  mock('db', db);
  mock('db/index', db);
  mock('lib/policy', { patchKey: async () => ({}), get: async () => ({}), defaults: () => ({}), flagOf: () => null });
  mock('lib/platformroot', { isPlatform: () => false, isRoot: () => false });
}

/* ── the scenarios: every error answer of routes/keys.js (and the shared gates in front of it) ─────────────── */
const SCENARIOS = [
  { id: 'get-key-asks', route: 'GET /api/keys', status: 403, setup: { asKey: true } },
  { id: 'get-no-token', route: 'GET /api/keys', status: 401, setup: { realAuth: true }, inherited: true },
  { id: 'get-db-fails', route: 'GET /api/keys', status: 500, setup: { dbFails: true } },
  { id: 'post-key-asks', route: 'POST /api/keys', status: 403, setup: { asKey: true }, body: { scopes: ['offers'] } },
  { id: 'post-not-owner', route: 'POST /api/keys', status: 403, setup: { who: CO_ASSIST }, body: { scopes: ['offers'] } },
  { id: 'post-platform-kind', route: 'POST /api/keys', status: 403, setup: {}, body: { scopes: ['testing'] } },
  { id: 'post-bad-scope', route: 'POST /api/keys', status: 400, setup: {}, body: { scopes: ['nonsense'] } },
  { id: 'post-no-token', route: 'POST /api/keys', status: 401, setup: { realAuth: true }, body: {}, inherited: true },
  { id: 'post-db-fails', route: 'POST /api/keys', status: 500, setup: { dbFails: true }, body: { scopes: ['offers'] } },
  { id: 'delete-key-asks', route: 'DELETE /api/keys/:jti', status: 403, setup: { asKey: true }, url: '/api/keys/abc' },
  { id: 'delete-not-owner', route: 'DELETE /api/keys/:jti', status: 403, setup: { who: CO_ASSIST }, url: '/api/keys/abc' },
  { id: 'delete-no-such-key', route: 'DELETE /api/keys/:jti', status: 404, setup: {}, url: '/api/keys/abc' },
  { id: 'delete-no-token', route: 'DELETE /api/keys/:jti', status: 401, setup: { realAuth: true }, url: '/api/keys/abc', inherited: true },
  { id: 'delete-db-fails', route: 'DELETE /api/keys/:jti', status: 500, setup: { dbFails: true }, url: '/api/keys/abc' }
];

function send(port, method, urlPath, body, headers) {
  return new Promise((resolve) => {
    const data = body === undefined ? null : typeof body === 'string' ? body : JSON.stringify(body);
    const options = { port, path: urlPath, method, headers: Object.assign(data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {}, headers) };
    const request = http.request(options, (response) => {
      let text = '';
      response.on('data', (part) => (text += part));
      response.on('end', () => resolve({ status: response.statusCode, type: String(response.headers['content-type'] || ''), text, json: safeParse(text) }));
    });
    if (data) request.write(data);
    request.end();
  });
}
function safeParse(text) {
  try {
    return JSON.parse(text);
  } catch (failure) {
    return null;
  }
}

async function runScenario(port, scenario) {
  Object.assign(world, { realAuth: false, who: SHOP, asKey: false, keys: [], dbFails: false }, scenario.setup);
  const [method, template] = scenario.route.split(' ');
  return send(port, method, scenario.url || template, scenario.body);
}

const legacyOf = (key, scenario) => (JSON.parse(fs.readFileSync(LEGACY_FILE, 'utf8')).routes[key] || { answers: [] }).answers.find((answer) => answer.scenario === scenario);

function checkProblemBody(label, answer) {
  check(label + ': content-type is application/problem+json', /application\/problem\+json/.test(answer.type), answer.type);
  check(label + ': has every Problem field', answer.json && REQUIRED_FIELDS.every((name) => answer.json[name] !== undefined), answer.json);
  check(label + ': request_id is the id the server minted', answer.json && answer.json.request_id === 'req-test', answer.json && answer.json.request_id);
  check(label + ': status in the body equals the HTTP status', answer.json && answer.json.status === answer.status);
}

function checkLegacy(label, answer, frozen) {
  if (!frozen) return check(label + ': a frozen legacy entry exists in docs/contracts/api-legacy.json', false);
  check(label + ': status equals the frozen status', answer.status === frozen.status, [answer.status, frozen.status]);
  const missing = Object.keys(frozen.fixture).filter((name) => !sameValue(answer.json[name], frozen.fixture[name]));
  check(label + ': every frozen legacy key is still there, byte for byte', missing.length === 0, missing.map((name) => name + ' -> ' + JSON.stringify(answer.json[name])));
  const extra = Object.keys(answer.json).filter((name) => !PROBLEM_FIELDS.includes(name) && !(name in frozen.fixture));
  check(label + ': no key beyond the frozen ones and the Problem fields', extra.length === 0, extra);
}

async function checkKeysRoutes(port, recording) {
  console.log('\n-- routes/keys.js: every refusal is a Problem and keeps its old keys --');
  const tested = {};
  for (const scenario of SCENARIOS) {
    const answer = await runScenario(port, scenario);
    recording[scenario.id] = { route: scenario.route, status: answer.status, body: answer.json };
    (tested[scenario.route] = tested[scenario.route] || new Set()).add(answer.status);
    const label = scenario.id;
    check(label + ': answers ' + scenario.status, answer.status === scenario.status, answer.status);
    if (argv.includes('--capture')) continue;
    if (scenario.inherited) continue; /* the sign-in middleware's own 401 is the old body until slice 1b; it is tested, not yet a Problem */
    checkProblemBody(label, answer);
    checkLegacy(label, answer, legacyOf(scenario.route, scenario.id));
    if (scenario.status === 500) check(label + ': a 5xx says nothing of its cause', !/identities|SELECT|vault|relation/.test(answer.text), answer.text);
  }
  return tested;
}

async function checkServerHandlers(recording) {
  console.log('\n-- server.js: the 404 and the error handler --');
  const loader = require(path.join(HERE, 'tools', 'load-app.cjs'));
  loader.stubDatabase(API);
  const app = loader.loadApp(API);
  const server = app.listen ? http.createServer(app) : null;
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const notFound = await send(port, 'GET', '/nothing-here');
  const broken = await send(port, 'POST', '/nothing-here', '{"bad json', { 'content-type': 'application/json', 'x-request-id': 'req-test' });
  server.close();
  recording['server-404'] = { route: 'ANY (404 handler)', status: notFound.status, body: notFound.json };
  recording['server-error-handler'] = { route: 'ANY (error handler)', status: broken.status, body: broken.json };
  if (argv.includes('--capture')) return;
  const frozen = JSON.parse(fs.readFileSync(LEGACY_FILE, 'utf8')).global;
  [['server-404', notFound], ['server-error-handler', broken]].forEach(([id, answer]) => {
    check(id + ': content-type is application/problem+json', /application\/problem\+json/.test(answer.type), answer.type);
    check(id + ': has every Problem field', REQUIRED_FIELDS.every((name) => answer.json[name] !== undefined), answer.json);
    checkLegacy(id, answer, frozen[id]);
  });
  check('server-error-handler: the answer carries the caller\'s request id', broken.json.request_id === 'req-test', broken.json.request_id);
  check('server-error-handler: nothing of the parser\'s message leaks', !/Unexpected|JSON|position/.test(broken.text), broken.text);
}

function checkUnits() {
  console.log('\n-- lib/problem.js: build, problem, fromError --');
  const { build, problem, fromError, titleOf } = require(path.join(HERE, 'lib', 'problem.js'));
  const body = build({ id: 'r1' }, { status: 409, code: 'POPULATION_BOUNDARY', detail: 'no', legacy: { error: 'Old', status: 'x', title: 'y', message: 'keep' } });
  check('type is a URI from the code', body.type === 'https://chitbridge.com/problems/population_boundary', body.type);
  check('title comes from the register, not the legacy body', body.title === titleOf('POPULATION_BOUNDARY') && body.title !== 'y', body.title);
  check('a legacy key cannot overwrite status or title', body.status === 409 && body.title !== 'y');
  check('legacy keys that the standard does not own ride along', body.error === 'Old' && body.message === 'keep', body);
  check('hint falls back to a line for the status class', typeof build({}, { status: 500, code: 'INTERNAL', detail: 'd' }).hint === 'string');
  const sent = {};
  const fakeResponse = { locals: {}, status(code) { sent.status = code; return this; }, set(name, value) { sent.type = value; return this; }, json(payload) { sent.body = payload; return this; } };
  problem({ id: 'r2' }, fakeResponse, { status: 404, code: 'NOT_FOUND', detail: 'gone' });
  check('problem() sets the content-type before json and puts the code on res.locals', /problem\+json/.test(sent.type) && fakeResponse.locals.code === 'NOT_FOUND');
  const leaked = {};
  const catcher = { locals: {}, status(code) { leaked.status = code; return this; }, set() { return this; }, json(payload) { leaked.body = payload; return this; } };
  fromError({ id: 'r3', path: '/x' }, catcher, Object.assign(new Error(SECRET_SQL), { stack: 'at /srv/app/db.js:1' }));
  check('fromError: an unknown error is a 500 INTERNAL with no cause in the body', leaked.status === 500 && leaked.body.code === 'INTERNAL' && !/identities|vault|srv/.test(JSON.stringify(leaked.body)), leaked.body);
  const refusal = {};
  const refuser = { locals: {}, status(code) { refusal.status = code; return this; }, set() { return this; }, json(payload) { refusal.body = payload; return this; } };
  fromError({ id: 'r4' }, refuser, Object.assign(new Error('cannot trade with a production entity'), { code: '23514' }));
  check('fromError: a refusal the database makes on purpose keeps its status, code and legacy keys', refusal.status === 409 && refusal.body.code === 'POPULATION_BOUNDARY' && refusal.body.error === 'Test and live cannot mix', refusal.body);
}

(async () => {
  checkUnits();
  installStubs();
  const app = express();
  app.use((req, res, next) => {
    req.id = 'req-test';
    next();
  });
  app.use(express.json());
  app.use('/api/keys', require(path.join(API, 'routes', 'keys.js')));
  const server = app.listen(0);
  const recording = {};
  const tested = await checkKeysRoutes(server.address().port, recording);
  server.close();
  await checkServerHandlers(recording);
  if (argv.includes('--capture')) fs.writeFileSync(argv[argv.indexOf('--capture') + 1], JSON.stringify(recording, null, 1));
  const coverage = Object.fromEntries(Object.keys(tested).sort().map((route) => [route, [...tested[route]].sort()]));
  /* this file owns the /api/keys rows; each area's own test file (api-problem-<area>.test.cjs) owns its rows of the same manifest */
  const onDisk = JSON.parse(fs.readFileSync(TESTED_FILE, 'utf8'));
  const OURS = (route) => / \/api\/keys(\/|$)/.test(route);
  const mine = Object.fromEntries(Object.keys(onDisk).filter(OURS).map((route) => [route, onDisk[route]]));
  const merged = Object.assign(Object.fromEntries(Object.keys(onDisk).filter((route) => !OURS(route)).map((route) => [route, onDisk[route]])), coverage);
  if (argv.includes('--write')) fs.writeFileSync(TESTED_FILE, JSON.stringify(Object.fromEntries(Object.keys(merged).sort().map((route) => [route, merged[route]])), null, 1) + '\n');
  else if (!argv.includes('--capture')) check('docs/contracts/api-error-tests.json lists exactly the statuses these scenarios cover', sameValue(mine, coverage), coverage);
  console.log('\n  ' + passed + ' checks, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch((failure) => {
  console.log('FAIL ' + (failure && failure.stack));
  process.exit(1);
});
