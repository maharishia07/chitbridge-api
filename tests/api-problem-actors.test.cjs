#!/usr/bin/env node
/**
 * api-problem-actors.test.cjs — API-4 sweep, the people: every answer of routes/actors.js (20 routes: add · edit · switch off · PIN and first code · cover and break · tasks and routing · settings).
 *
 * OWNS      the proof that each refusal of the actors routes is a Problem body AND still carries the keys it answered before (docs/contracts/api-legacy.json, recorded from the code
 *           before the sweep), that no success answer moved (--compare against a capture of the code before), this file's rows of docs/contracts/api-error-tests.json (the statuses
 *           each route is tested for, which the register's error_tests column reads), and the "signed in as another shop" world for the routes that name a record by an id in the path
 *           (API-STANDARD S35, tests/lib/foreign-id-world.cjs), recorded in docs/contracts/api-hardening-evidence-areas.json. Also: no answer outside the statuses the route's contract declares
 *           (lib/actors-contract.js), its words as units, that the deliberate 503 (a sealed shop with no e-mail sender) answers its old words, and that sign-in (GET /check-login, POST /set-pin,
 *           POST /login) is RUN here, not frozen and never judged (api-legacy.json holds no key for them; the one byte-for-byte check was the --compare against the untouched base, 24 of 24), since their refusals are routes/signin.js's.
 * CALLED BY scripts/guards.cjs · CI. No database, no network: the real route file over a stand-in db and auth (tests/lib/problem-world.cjs).
 * FLOW      route list (read from the router) x world (signed out, staff, a stranger, a bad id, a failing db, an empty db) + the named extras (tests/lib/actors-scenes.cjs) → real route →
 *           body → Problem fields present · frozen legacy keys equal · no leak on a 5xx · statuses tested → manifest; then the foreign-id world
 * CARD      17-people-employees-hr-and-payroll/functions
 *
 *   node tests/api-problem-actors.test.cjs                    check
 *   node tests/api-problem-actors.test.cjs --write            rewrite this file's rows of docs/contracts/api-error-tests.json and api-hardening-evidence-areas.json
 *   node tests/api-problem-actors.test.cjs --capture F        (run on the code BEFORE the change) record each answer to file F
 *   node tests/api-problem-actors.test.cjs --freeze F         merge a capture F into docs/contracts/api-legacy.json (the frozen answers)
 *   node tests/api-problem-actors.test.cjs --compare F        the answers now against a capture F: byte for byte for a success, the old keys in order for a refusal
 */
'use strict';
const path = require('path');
const fs = require('fs');
const { harness, OWNER, STAFF, SHOP, SECRET_SQL, sameValue, raising, answering, firstOf } = require('./lib/problem-world.cjs');
const scenes = require('./lib/actors-scenes.cjs');
const FOREIGN = require('./lib/foreign-id-world.cjs');

process.env.OUTPUT_ALLOWLIST = 'enforce'; /* S34: a sweep test runs the allow-list for real; production defaults to report */
const HERE = path.join(__dirname, '..');
/* --capture / --compare replay the same answers byte for byte: the clock and Math.random are held still, so a difference is the code's and not the run's */
if (process.argv.includes('--capture') || process.argv.includes('--compare')) {
  let drawn = 0;
  Math.random = () => ((drawn += 1) * 0.6180339887) % 1;
  const FIXED_NOW = 1800000000000;
  const RealDate = Date;
  global.Date = class extends RealDate {
    constructor(...given) {
      if (given.length) super(...given);
      else super(FIXED_NOW);
    }
    static now() {
      return FIXED_NOW;
    }
  };
}
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
const MOUNT = '/api/actors';
const ROUTE_FILE = 'routes/actors.js';
/** sign-in: run, not frozen, never judged (their refusals are routes/signin.js's, an area of its own) */
const SIGN_IN = ['GET ' + MOUNT + '/check-login', 'POST ' + MOUNT + '/set-pin', 'POST ' + MOUNT + '/login'];
const lab = harness({
  here: HERE,
  mounts: [MOUNT],
  routeFiles: { [MOUNT]: ROUTE_FILE },
  legacyFile: path.join(HERE, 'docs', 'contracts', 'api-legacy.json'),
  inherited: (scenario, answer) => (answer.status === 401 && scenario.id === 'signed-out') || SIGN_IN.includes(scenario.route),
  notFrozen: (one, scenario) => (one.status === 401 && scenario === 'signed-out') || AFTER.has(scenario) || SIGN_IN.includes(one.route),
  cannotRide: () => [],
  before: async () => require(path.join(HERE, 'lib', 'employee-code'))._resetAsk() /* R112: each scene starts with a clean issue limiter */
});
const { check, world } = lab;
const TESTED_FILE = path.join(HERE, 'docs', 'contracts', 'api-error-tests.json');
const REGISTER_FILE = path.join(HERE, 'docs', 'error-codes.json');
const EVIDENCE_FILE = path.join(HERE, 'docs', 'contracts', 'api-hardening-evidence-areas.json');
const STRANGER = { identity_id: scenes.STRANGER_ID, identity_type: 'entity', display_name: 'Shop B' };
const WORLDS = [
  { id: 'signed-out', setup: { realAuth: true } },
  { id: 'staff-asks', setup: { who: STAFF } },
  { id: 'stranger-asks', setup: { who: STRANGER } },
  { id: 'bad-id', setup: {}, badId: true },
  { id: 'db-fails', setup: { db: 'fail' } },
  { id: 'nothing-found', setup: {} }
];
const lib = (name) => require(path.join(HERE, 'lib', name));
const sources = () => ({ schema: lib('schema'), empcode: lib('employee-code'), devotp: lib('dev-otp'), notify: lib('notify') });
const contractModule = () => lib('actors-contract.js');

/** the first-code and the bridge id are random in life: the test puts fixed ones in the require cache so a success answer is the same bytes on every run (the real modules are otherwise untouched) */
function fixedRandomness() {
  const put = (name, make) => {
    const file = require.resolve(path.join(HERE, 'lib', name));
    require.cache[file] = { id: file, filename: file, loaded: true, exports: make(require(file)) };
  };
  put('bridgeid', (real) => Object.assign({}, real, { generateBridgeId: () => 'AAAA1111' }));
  put('otp', (real) => Object.assign({}, real, { generateOTP: () => '123456' }));
  holdIds();
}

/** --capture / --compare: the id a created person is given (uuid v4, from the system's own randomness) counts up instead, so two replays are the same bytes */
function holdIds() {
  if (!(process.argv.includes('--capture') || process.argv.includes('--compare'))) return;
  const file = require.resolve('uuid', { paths: [HERE] });
  let issued = 0;
  const next = () => '00000000-0000-4000-8000-' + String((issued += 1)).padStart(12, '0');
  require.cache[file] = { id: file, filename: file, loaded: true, exports: Object.assign({}, require(file), { v4: next }) };
}

let AFTER = new Set();
let TOOLS = null;
const extrasList = () => scenes.extras(TOOLS);

/** lib/actors-contract.js as a unit: the words of a refusal and of a fault, as these routes always said them */
function checkWords() {
  console.log('\n-- lib/actors-contract.js: the refusals as a unit --');
  const { words, failed, failedBare, EMAIL_TAKEN } = contractModule();
  const req = { id: 'r1' };
  const lost = failed(new Error(SECRET_SQL), req, 'Create failed');
  check('failed: the screen\'s own label and the safe sentence, never the cause', lost.status === 500 && lost.legacy.error === 'Create failed' && !JSON.stringify(lost).includes('vault'), lost);
  const bare = failedBare(new Error(SECRET_SQL), req, 'Failed to get actor tasks');
  check('failedBare: the label alone (these two 500s never had a message), never the cause', bare.status === 500 && sameValue(Object.keys(bare.legacy), ['error']) && !JSON.stringify(bare).includes('vault'), bare);
  check('EMAIL_TAKEN keeps its three old keys', sameValue(Object.keys(EMAIL_TAKEN), ['error', 'code', 'message']) && EMAIL_TAKEN.code === 'EMAIL_TAKEN', EMAIL_TAKEN);
  const over = words.overTaskCap(20);
  check('overTaskCap: the number rides in the sentence and the old keys are kept', /at most 20 tasks/.test(over.legacy.message) && over.code === 'MAX_TASKS_OVER_ENTITY' && over.legacy.error === 'Over the limit', over);
  const warned = words.confirmRemove(3);
  check('confirmRemove: the warning names the count; none when no task is open', /3 active tasks/.test(warned.legacy.tasks_warning) && words.confirmRemove(0).legacy.tasks_warning === null, warned);
  const routed = words.tasksToRoute(2);
  check('tasksToRoute: the old keys required and actor_tasks are kept', routed.legacy.actor_tasks === 2 && /task_action: pool/.test(routed.legacy.required), routed);
  const coded = words.fromLibrary({ status: 503, body: { error: 'E-mail delivery is not configured', code: 'EMAIL_DELIVERY_NOT_CONFIGURED', message: 'sealed' } });
  check('fromLibrary: a refusal the first-code library meant keeps its status, code and every word', coded.status === 503 && coded.code === 'EMAIL_DELIVERY_NOT_CONFIGURED' && coded.legacy.message === 'sealed', coded);
  const modes = contractModule().MODE_SWITCHES;
  check('the three mode-switch routes are named (flagged, not split)', sameValue(Object.keys(modes).sort(), ['PUT /:id/status', 'PUT /:id/tasks/route', 'PUT /assign/:chit_id']), Object.keys(modes));
}

/** every code the words answer under is a row of docs/ERROR-CODES.md with its sentence written */
function checkCodesRegistered(contract) {
  console.log('\n-- the codes the actors routes answer under are in the register --');
  const known = new Set(JSON.parse(fs.readFileSync(REGISTER_FILE, 'utf8')).codes.filter((row) => row.shopkeeper !== 'PENDING').map((row) => row.code));
  const missing = contract.CODES.filter((code) => !known.has(code));
  check('every code the actors words (' + contract.CODES.length + ') answer under is a register row with its sentence written', missing.length === 0, missing);
}

/** the contract in front of the router: every route but sign-in has a row, and a row has a route; a body keeps its named fields */
function checkContractShape(routes) {
  console.log('\n-- the contract and the router agree --');
  const contract = contractModule();
  const operations = Object.keys(contract.OPERATIONS);
  const swept = Object.keys(routes).filter((key) => !SIGN_IN.includes(key));
  check('every route the router holds but sign-in has an operation, and every operation a route (' + operations.length + ')', sameValue(operations.slice().sort(), swept.sort()), operations.filter((key) => !routes[key]));
  check('the contract holds 17 operations: the 20 routes less GET /check-login, POST /set-pin and POST /login', operations.length === 17 && Object.keys(routes).length === 20, [operations.length, Object.keys(routes).length]);
  const bodies = operations.filter((key) => contract.OPERATIONS[key].requestBody);
  check('every write declares a body that is an object (a list is the schema\'s 400); the first-code re-issue takes any, as before', bodies.every((key) => key === 'POST /api/actors/:id/otp' || contract.OPERATIONS[key].requestBody.content['application/json'].schema.type === 'object'), bodies);
  check('every refusal an operation declares is a Problem', operations.every((key) => Object.keys(contract.OPERATIONS[key].responses).filter((status) => Number(status) >= 400).every((status) => JSON.stringify(contract.OPERATIONS[key].responses[status]).includes('Problem'))));
  check('a malformed path argument is still a 404 or the route\'s own answer, never a 400: the path arguments are plain text', operations.filter((key) => key.includes(':')).every((key) => contract.OPERATIONS[key].parameters.filter((one) => one.in === 'path').every((one) => one.schema.type === 'string' && !one.schema.pattern)));
  const schemaOf = (key) => contract.OPERATIONS[key].requestBody.content['application/json'].schema;
  check('the action of the two mode switches that already refuse an unknown one is the enum the chain accepts', sameValue(schemaOf('PUT /api/actors/:id/status').properties.action.enum, ['deactivate', 'remove', 'reactivate']) && sameValue(schemaOf('PUT /api/actors/assign/:chit_id').properties.action.enum, ['pull', 'push', 'return']));
  check('the third mode switch declares no enum: an unknown action is a 404 for an unknown task before it is a 400', schemaOf('PUT /api/actors/:id/tasks/route').properties.action.enum === undefined);
}

/** every deliberate 503 (a sealed shop with no e-mail sender) frozen before the sweep is replayed here: the same status and every old key, byte for byte and in order */
function checkFrozen503(recording) {
  console.log('\n-- the frozen 503 answers (a sealed shop with no e-mail sender) are replayed --');
  const legacy = JSON.parse(fs.readFileSync(lab.legacyFile, 'utf8')).routes;
  let replayed = 0;
  Object.keys(legacy).filter(lab.mine).forEach((route) => legacy[route].answers.filter((frozen) => frozen.status === 503).forEach((frozen) => {
    const now = recording[route + '|' + frozen.scenario];
    const order = Object.keys(frozen.fixture);
    replayed++;
    check(route + ' · ' + frozen.scenario + ': the frozen 503 body is kept, key by key and in order', !!now && now.status === 503 && sameValue(order.map((name) => now.body[name]), order.map((name) => frozen.fixture[name])) && sameValue(Object.keys(now.body).slice(0, order.length), order), now && now.body);
  }));
  check('four 503 answers were frozen and replayed: the first code of an add, a PIN reset, a new code and a switch-on (' + replayed + ')', replayed === 4, replayed);
}

/* ── the foreign-id world (API-STANDARD S35): shop B asks for shop A's record by its id ── */
const A_PERSON = scenes.PERSON;
/** the routes of this file that name a record by an id in the path: a person, or a chit */
const FOREIGN_ROUTES = () => [
  { route: 'PATCH ' + MOUNT + '/:id', url: MOUNT + '/' + A_PERSON, method: 'PATCH', body: { display_name: 'Zed Zed' } },
  { route: 'DELETE ' + MOUNT + '/:id/pin', url: MOUNT + '/' + A_PERSON + '/pin', method: 'DELETE', body: {} },
  { route: 'POST ' + MOUNT + '/:id/otp', url: MOUNT + '/' + A_PERSON + '/otp', method: 'POST', body: {} },
  { route: 'PUT ' + MOUNT + '/:id/status', url: MOUNT + '/' + A_PERSON + '/status', method: 'PUT', body: { action: 'deactivate' } },
  { route: 'PUT ' + MOUNT + '/:id/delegate', url: MOUNT + '/' + A_PERSON + '/delegate', method: 'PUT', body: {} },
  { route: 'GET ' + MOUNT + '/:id/tasks', url: MOUNT + '/' + A_PERSON + '/tasks', method: 'GET' },
  { route: 'PUT ' + MOUNT + '/:id/tasks/route', url: MOUNT + '/' + A_PERSON + '/tasks/route', method: 'PUT', body: { chit_id: scenes.CHIT, action: 'pool' }, chitIsTheCallers: true },
  { route: 'PUT ' + MOUNT + '/assign/:chit_id', url: MOUNT + '/assign/' + A_PERSON, method: 'PUT', body: { action: 'return' } }
];

/** one play(who, planted) of a foreign-id route: sets the world and asks as the stranger (shop B) or as the owner (shop A); the record is planted for shop A only */
function playFor(port, item) {
  return async (who, planted) => {
    const rows = item.chitIsTheCallers ? scenes.chitOfTheCaller() : scenes.universal(planted);
    Object.assign(world, { realAuth: false, who: who === 'owner' ? OWNER : STRANGER, asKey: false, db: 'ok', sqlRows: rows, jsonThrows: false, noCustomer: false });
    return lab.send(port, item.method, item.url, item.body);
  };
}

async function checkForeignIds(port) {
  console.log('\n-- signed in as another shop: a foreign id answers exactly as an unknown id (S35) --');
  const recording = FOREIGN.recorder();
  const items = FOREIGN_ROUTES();
  const failures = await FOREIGN.runCases(items.map((item) => ({ route: item.route, play: playFor(port, item) })), recording.record);
  console.log('  foreign id: ' + (items.length - failures.length) + ' of ' + items.length + ' routes held');
  failures.forEach((sentence) => console.log('  FINDING ' + sentence));
  return { proved: recording.proved(), failures, asked: items.length };
}

/**
 * output_allowlist in the shop's own world (API-8, S34): the generator's stand-in database cannot seat the people, settings and access events these reads answer, so here every route whose
 * 200 schema is closed (additionalProperties false, derived from the answers and the handler's own keys) has every recorded 200 fit that schema, and the allow-list filter drops nothing from it:
 * a key the schema does not list would be cut, so a drop here is an answer that moved. → { route: { output_allowlist: true } }
 */
function checkAllowList(recording) {
  console.log('\n-- the closed success schemas hold every recorded 200 --');
  const proved = {};
  const operations = contractModule().OPERATIONS;
  const engine = require(path.join(HERE, 'middleware', 'validate.js')).bodyEngine;
  const { prune } = require(path.join(HERE, 'lib', 'output-allowlist.js'));
  Object.keys(operations).sort().filter((route) => !SIGN_IN.includes(route)).forEach((route) => {
    const schema = (((operations[route].responses[200] || {}).content || {})['application/json'] || {}).schema;
    if (!schema || schema.additionalProperties !== false) return;
    const answers = Object.values(recording).filter((one) => one.route === route && one.status === 200 && one.body);
    const fits = engine.compile(schema);
    const held = answers.length > 0 && answers.every((one) => fits(one.body) && prune(schema, one.body).dropped.length === 0);
    check(route + ': every recorded 200 (' + answers.length + ') holds only the keys its operation lists (a closed schema the answers fit)', held, { answers: answers.length, errors: fits.errors });
    if (held) proved[route] = { output_allowlist: true };
  });
  return proved;
}
/** the shop's routes the evidence file says output_allowlist for */
function allowListEvidenceOnDisk() {
  const routes = JSON.parse(fs.readFileSync(EVIDENCE_FILE, 'utf8')).routes || {};
  return Object.fromEntries(Object.keys(routes).filter((route) => lab.mine(route) && routes[route].output_allowlist).sort().map((route) => [route, { output_allowlist: true }]));
}
/** write this file's output_allowlist rows into the evidence file (other routes and columns stay as they are) */
function writeAllowList(proved) {
  const onDisk = JSON.parse(fs.readFileSync(EVIDENCE_FILE, 'utf8'));
  const routes = onDisk.routes || {};
  Object.keys(routes).filter(lab.mine).forEach((route) => {
    delete routes[route].output_allowlist;
    if (!Object.keys(routes[route]).length) delete routes[route];
  });
  Object.keys(proved).forEach((route) => (routes[route] = Object.assign(routes[route] || {}, proved[route])));
  const sorted = Object.fromEntries(Object.keys(routes).sort().map((route) => [route, routes[route]]));
  fs.writeFileSync(EVIDENCE_FILE, JSON.stringify(Object.assign({}, onDisk, { routes: sorted }), null, 1) + '\n');
}

process.on('unhandledRejection', (failure) => console.log('  (unhandled rejection: ' + String(failure && failure.message).slice(0, 80) + ')'));
(async () => {
  if (lab.flagValue('--freeze')) {
    TOOLS = { OWNER, STAFF, SECRET_SQL, raising, answering, firstOf, pinHash: '', devOtp: {}, realRefusal: () => null }; /* the scenes are only read for which of them the sweep ADDS */
    AFTER = new Set(extrasList().filter((one) => one.after).map((one) => one.id));
    return lab.freeze(lab.flagValue('--freeze'));
  }
  lab.installStubs();
  fixedRandomness();
  const devOtp = lib('dev-otp');
  const pinHash = await lib('identity-auth').hashPin(scenes.PIN);
  TOOLS = { OWNER, STAFF, SECRET_SQL, raising, answering, firstOf, pinHash, devOtp, realRefusal: lib('employee-code').refusal };
  AFTER = new Set(extrasList().filter((one) => one.after).map((one) => one.id));
  const router = require(path.join(HERE, ROUTE_FILE));
  const routes = lab.routesOf(router, MOUNT);
  const server = lab.appOf([{ mount: MOUNT, router }]).listen(0);
  const recording = {};
  const capturing = lab.flagValue('--capture') || lab.flagValue('--compare');
  const declared = capturing ? () => [] : contractModule().allowedStatuses();
  const allowed = (route) => (SIGN_IN.includes(route) ? [400, 401, 403, 404, 409, 422, 429, 500, 503] : declared(route));
  const scenarios = lab.scenariosOf(routes, WORLDS, extrasList());
  const tested = await lab.checkRoutes(server.address().port, scenarios, recording, allowed, sources);
  if (lab.flagValue('--capture')) {
    server.close();
    fs.writeFileSync(lab.flagValue('--capture'), JSON.stringify(recording, null, 1));
    console.log('captured ' + Object.keys(recording).length + ' answers over ' + Object.keys(routes).length + ' routes');
    process.exit(0);
  }
  if (lab.flagValue('--compare')) {
    lab.compare(lab.flagValue('--compare'), recording);
    process.exit(0);
  }
  const foreign = await checkForeignIds(server.address().port);
  server.close();
  checkWords();
  checkCodesRegistered(contractModule());
  checkContractShape(routes);
  checkFrozen503(recording);
  const allowed200 = checkAllowList(recording);
  const legacy = JSON.parse(fs.readFileSync(lab.legacyFile, 'utf8')).routes;
  const frozen = Object.keys(legacy).filter(lab.mine).reduce((sum, route) => sum + legacy[route].answers.length, 0);
  check('every refusal recorded before the sweep is replayed against the code: ' + frozen + ' answers, each once, byte for byte', frozen > 100, frozen);
  check('a caller who is not signed in is refused with 401 on every route that asks for a sign-in', Object.keys(recording).filter((key) => key.endsWith('|signed-out') && !SIGN_IN.some((route) => key.startsWith(route + '|'))).every((key) => recording[key].status === 401));
  const leaks = (key) => /vault|relation "/.test(JSON.stringify(recording[key].body || {}));
  check('no answer, 200 or 4xx or 5xx, carries the database text: a thrown error is never relayed (' + Object.keys(recording).length + ' answers)', Object.keys(recording).filter(leaks).length === 0, Object.keys(recording).filter(leaks));
  check('a 2xx is never a Problem: every success answer keeps its own shape', Object.keys(recording).filter((key) => recording[key].status < 400).every((key) => !/problem\+json/.test(recording[key].type)));
  const coverage = lab.coverageOf(tested);
  const onDisk = JSON.parse(fs.readFileSync(TESTED_FILE, 'utf8'));
  const mine = Object.fromEntries(Object.keys(onDisk).filter(lab.mine).sort().map((route) => [route, onDisk[route]]));
  const judged = Object.fromEntries(Object.keys(coverage).filter((route) => !SIGN_IN.includes(route)).map((route) => [route, coverage[route]]));
  if (lab.argv.includes('--write')) {
    const others = Object.fromEntries(Object.keys(onDisk).filter((route) => !lab.mine(route)).map((route) => [route, onDisk[route]]));
    const merged = Object.assign(others, judged);
    fs.writeFileSync(TESTED_FILE, JSON.stringify(Object.fromEntries(Object.keys(merged).sort().map((route) => [route, merged[route]])), null, 1) + '\n');
    FOREIGN.writeEvidence(EVIDENCE_FILE, lab.mine, foreign.proved);
    writeAllowList(allowed200);
  } else {
    check('docs/contracts/api-hardening-evidence-areas.json says output_allowlist for exactly the shop routes whose 200 held closed here', sameValue(allowListEvidenceOnDisk(), allowed200), { onDisk: Object.keys(allowListEvidenceOnDisk()).length, held: Object.keys(allowed200).length });
    check('docs/contracts/api-error-tests.json lists exactly the statuses these scenarios cover for routes/actors.js (sign-in apart)', sameValue(mine, judged), { onDisk: Object.keys(mine).length, covered: Object.keys(judged).length });
    check('docs/contracts/api-hardening-evidence-areas.json says foreign_id_404 for exactly the routes that held here', sameValue(FOREIGN.evidenceOf(EVIDENCE_FILE, lab.mine), foreign.proved), { onDisk: Object.keys(FOREIGN.evidenceOf(EVIDENCE_FILE, lab.mine)).length, held: Object.keys(foreign.proved).length });
  }
  console.log('\n  ' + lab.count.passed + ' checks, ' + lab.count.failed + ' failed');
  process.exit(lab.count.failed ? 1 : 0);
})();
