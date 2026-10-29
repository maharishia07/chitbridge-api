#!/usr/bin/env node
// @type: contract
/**
 * api-problem-connectors.test.cjs — API-4 sweep, the connectors: every answer of routes/connectors.js (14 routes, mounted at /api/connectors).
 *
 * OWNS      the proof that each refusal of the connector routes is a Problem body AND still carries the keys it answered before (docs/contracts/api-legacy.json, recorded from the code
 *           before the sweep), that no success answer moved (--compare against a capture of the code before), this file's rows of docs/contracts/api-error-tests.json (the statuses each
 *           route is tested for, which the register's error_tests column reads), and the "signed in as another shop" world for the nine routes addressed by a connector id in the path
 *           (API-STANDARD S35, tests/lib/foreign-id-world.cjs), recorded in docs/contracts/api-hardening-evidence-areas.json. Also: no answer outside the statuses the contract declares
 *           (lib/connectors-contract.js), its words as units, and the two doors a device and an ERP agent read (POST /ingest, POST /erp-ingest): every status and every key they answered
 *           stays, which the frozen answers and the 5xx replay below hold.
 * CALLED BY scripts/guards.cjs · CI. No database, no network: the real route file over a stand-in db and auth (tests/lib/problem-world.cjs), the rows of tests/lib/connectors-scenes.cjs.
 * FLOW      route list (read from the router) x world (signed out, capability off, a bad id, an unknown id, a failing db, a found connector) + the named scenes → real route → body →
 *           Problem fields present · frozen legacy keys equal · no leak on a 5xx · statuses tested → manifest; then the frozen 5xx replay and the foreign-id world
 * CARD      28-platform-and-operations/connectors-routes
 *
 *   node tests/api-problem-connectors.test.cjs                    check
 *   node tests/api-problem-connectors.test.cjs --write            rewrite this file's rows of docs/contracts/api-error-tests.json and api-hardening-evidence-areas.json
 *   node tests/api-problem-connectors.test.cjs --capture F        (run on the code BEFORE the change) record each answer to file F
 *   node tests/api-problem-connectors.test.cjs --freeze F         merge a capture F into docs/contracts/api-legacy.json (the frozen answers)
 *   node tests/api-problem-connectors.test.cjs --compare F        the answers now against a capture F: byte for byte for a success, the old keys in order for a refusal
 */
'use strict';
const path = require('path');
const fs = require('fs');
const { harness, OWNER, STAFF, sameValue } = require('./lib/problem-world.cjs');
const scenes = require('./lib/connectors-scenes.cjs');
const FOREIGN = require('./lib/foreign-id-world.cjs');

const HERE = path.join(__dirname, '..');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
const MOUNT = '/api/connectors';
const ROUTE_FILE = 'routes/connectors.js';
/** the two doors a program calls with its own key (no session): a refusal at the key is theirs, not the sign-in's */
const DEVICE_ROUTES = ['POST ' + MOUNT + '/ingest', 'POST ' + MOUNT + '/erp-ingest'];
const SECRET_SQL = 'relation "chit" does not exist -- SELECT secret FROM vault';
const lab = harness({
  here: HERE,
  mounts: [MOUNT],
  routeFiles: { [MOUNT]: ROUTE_FILE },
  legacyFile: path.join(HERE, 'docs', 'contracts', 'api-legacy.json'),
  inherited: (scenario, answer) => answer.status === 401 && scenario.id === 'signed-out' && !DEVICE_ROUTES.includes(scenario.route),
  notFrozen: (one, scenario) => (one.status === 401 && scenario === 'signed-out' && !DEVICE_ROUTES.includes(one.route)) || AFTER.has(scenario),
  before: (scenario) => prepare(scenario)
});
const { check, world } = lab;
const TESTED_FILE = path.join(HERE, 'docs', 'contracts', 'api-error-tests.json');
const REGISTER_FILE = path.join(HERE, 'docs', 'error-codes.json');
const EVIDENCE_FILE = path.join(HERE, 'docs', 'contracts', 'api-hardening-evidence-areas.json');
const STRANGER = { identity_id: scenes.STRANGER_ID, identity_type: 'entity', display_name: 'Shop B' };
const VALUES = { actorId: scenes.ACTOR, connId: scenes.CONNECTION };
const WORLDS = [
  { id: 'signed-out', setup: { realAuth: true } },
  { id: 'capability-off', setup: { sqlRows: scenes.stubRows({ caps: [] }) } },
  { id: 'bad-id', setup: { sqlRows: scenes.stubRows({}) }, badId: true },
  { id: 'unknown-id', setup: { sqlRows: scenes.stubRows({ owner: 'nobody' }) } },
  { id: 'db-fails', setup: { db: 'fail' } },
  { id: 'found-asks', setup: { sqlRows: scenes.stubRows({}) } },
  { id: 'staff-asks', setup: { who: STAFF, sqlRows: scenes.stubRows({ hat: 'act' }) } }
];

/* a fixed id for every uuid the routes mint, and a fixed bridge id: the random parts of a success answer are the same on every run (before and after the change) */
let idCounter = 0;
/** a scenario starts from the first id, and the generic worlds of the sample-document door get the fixed clock and chance the named scenes carry */
function prepare(scenario) {
  resetIds();
  if (/erp-test$/.test(scenario.route) && !scenario.patch) scenario.patch = { math: { random: () => 0.25 }, date: { now: () => 1760000000000 }, mint: { deliver: async () => undefined } };
}

const resetIds = () => { idCounter = 0; };
function installFixedIds() {
  const mockModule = (relative, exported) => {
    const file = require.resolve(path.join(HERE, relative));
    require.cache[file] = { id: file, filename: file, loaded: true, exports: exported };
  };
  const realUuid = require('uuid');
  const next = () => '00000000-0000-4000-8000-' + String(++idCounter).padStart(12, '0');
  const uuidFile = require.resolve('uuid');
  require.cache[uuidFile] = { id: uuidFile, filename: uuidFile, loaded: true, exports: Object.assign({}, realUuid, { v4: next }) };
  const realBridge = require(path.join(HERE, 'lib', 'bridgeid'));
  mockModule('lib/bridgeid.js', Object.assign({}, realBridge, { generateBridgeId: () => 'CBFIXED01' }));
  mockModule('lib/workpattern.js', { resolveWorkPattern: async () => ({}) }); /* the work-pattern resolution is not under test (it is frozen): no pattern, so the device's own folder and `to` rule */
}

const extrasList = () => scenes.extras({ OWNER, STAFF });
const AFTER = new Set(extrasList().filter((one) => one.after).map((one) => one.id));
const sources = () => ({
  crypto: require('crypto'),
  math: Math,
  date: Date,
  mint: require(path.join(HERE, 'lib', 'mint')),
  storage: require(path.join(HERE, 'lib', 'storage'))
});
const contractModule = () => require(path.join(HERE, 'lib', 'connectors-contract.js'));

/** lib/connectors-contract.js as a unit: the words of a refusal and of a fault, as these routes always said them */
function checkWords() {
  console.log('\n-- lib/connectors-contract.js: the refusals as a unit --');
  const words = contractModule();
  const req = { id: 'r1' };
  const lost = words.failed(new Error(SECRET_SQL), req, 'Create failed');
  check('failed: the screen\'s own label and the safe sentence, never the cause', lost.status === 500 && lost.legacy.error === 'Create failed' && !JSON.stringify(lost).includes('vault'), lost);
  const off = words.words.capabilityOff();
  check('capabilityOff: the old three keys (error · code · message)', off.code === 'CAPABILITY_OFF' && sameValue(Object.keys(off.legacy), ['error', 'code', 'message']) && /switched its connector capability off/.test(off.legacy.message), off);
  const noKey = words.words.noKey();
  check('noKey: 401 words of a device with no key', noKey.code === 'NO_KEY' && noKey.legacy.error === 'No key' && /X-Bridge-Key/.test(noKey.legacy.message), noKey);
  const known = words.ingestRefusal({ status: 409, body: { error: 'Test and live cannot mix', message: 'm', hint: 'h', code: 'POPULATION_BOUNDARY' } });
  check('ingestRefusal: the database\'s own refusal keeps its words, health first', known.status === 409 && known.code === 'POPULATION_BOUNDARY' && sameValue(Object.keys(known.legacy), ['health', 'error', 'message', 'hint', 'code']) && known.hint === 'h', known);
  const undelivered = words.words.chitNotDelivered();
  check('chitNotDelivered: 503 CHIT_NOT_DELIVERED, health live, the device keeps the event', undelivered.code === 'CHIT_NOT_DELIVERED' && undelivered.legacy.health === 'live' && /keeps the event/.test(undelivered.legacy.message), undelivered);
  const locked = words.words.badCode({ status: 400, reason: 'OTP_LOCKED', message: 'That code is not right.' });
  const wrong = words.words.badCode({ status: 400, reason: 'OTP_WRONG', message: 'That code is not right.' });
  const expired = words.words.badCode({ status: 400, reason: 'OTP_EXPIRED', message: 'Code expired — request a new one.' });
  check('badCode: a locked code is not told apart from a wrong one on the door (SEC-81); an expired one says so', locked.code === 'OTP_WRONG' && wrong.code === 'OTP_WRONG' && expired.code === 'OTP_EXPIRED' && locked.legacy.error === 'Bad code', [locked, wrong, expired]);
}

/** every code the words answer under is a row of docs/ERROR-CODES.md with its sentence written */
function checkCodesRegistered(contract) {
  console.log('\n-- the codes the connector routes answer under are in the register --');
  const known = new Set(JSON.parse(fs.readFileSync(REGISTER_FILE, 'utf8')).codes.filter((row) => row.shopkeeper !== 'PENDING').map((row) => row.code));
  const missing = contract.CODES.filter((code) => !known.has(code));
  check('every code the connector words (' + contract.CODES.length + ') answer under is a register row with its sentence written', missing.length === 0, missing);
}

/** the contract in front of the router: every route has a row, and a row has a route; a path argument stays plain text; the two device doors take a list or an object (nothing new is refused) */
function checkContractShape(routes) {
  console.log('\n-- the contract and the router agree --');
  const contract = contractModule();
  const operations = Object.keys(contract.OPERATIONS);
  check('every route the router holds has an operation, and every operation a route (' + operations.length + ')', sameValue(operations.slice().sort(), Object.keys(routes).sort()), operations.filter((key) => !routes[key]));
  check('the contract holds 14 operations', operations.length === 14 && Object.keys(routes).length === 14, [operations.length, Object.keys(routes).length]);
  const bodies = operations.filter((key) => contract.OPERATIONS[key].requestBody);
  const typeOf = (key) => contract.OPERATIONS[key].requestBody.content['application/json'].schema.type;
  const IGNORES_BODY = ['POST ' + MOUNT + '/reissue-code', 'POST ' + MOUNT + '/:actorId/erp-test', 'POST ' + MOUNT + '/:actorId/ping'];
  const LIST_OK = DEVICE_ROUTES.concat(IGNORES_BODY);
  check('the owner writes the chains check declare a body that is an object', bodies.filter((key) => !LIST_OK.includes(key)).every((key) => typeOf(key) === 'object'), bodies);
  check('the two device doors and the three routes that read no body take an object or a list: the schema refuses neither', LIST_OK.every((key) => sameValue(typeOf(key), ['object', 'array'])), LIST_OK.map(typeOf));
  check('a body requires none of its fields in the schema (the chains answer a missing one in their own frozen words)', bodies.every((key) => !(contract.OPERATIONS[key].requestBody.content['application/json'].schema.required || []).length));
  check('every refusal an operation declares is a Problem', operations.every((key) => Object.keys(contract.OPERATIONS[key].responses).filter((status) => Number(status) >= 400).every((status) => JSON.stringify(contract.OPERATIONS[key].responses[status]).includes('Problem'))));
  check('a path argument is plain text: the express-validator chain answers a malformed id in its own words', operations.filter((key) => key.includes(':')).every((key) => contract.OPERATIONS[key].parameters.every((one) => one.schema.type === 'string' && !one.schema.pattern)));
  check('the two device doors declare no 401 as the sign-in: they are public and say their key refusals themselves', DEVICE_ROUTES.every((key) => contract.OPERATIONS[key].security.length === 0 && contract.OPERATIONS[key].responses[401]), DEVICE_ROUTES.map((key) => contract.OPERATIONS[key].security));
}

/**
 * the harness judges a 5xx as "says nothing of its cause" and replays no frozen body for it; a 503 here is the ingest door's deliberate refusal ("the device keeps the event", in the words an agent
 * logs), and every other 5xx is a label with the safe sentence: each frozen 5xx is replayed here: the same status and every old key, byte for byte and in order
 */
function checkFrozenFaults(recording) {
  console.log('\n-- the frozen 5xx answers are replayed --');
  const legacy = JSON.parse(fs.readFileSync(lab.legacyFile, 'utf8')).routes;
  let replayed = 0;
  Object.keys(legacy).filter(lab.mine).forEach((route) => legacy[route].answers.filter((frozen) => frozen.status >= 500).forEach((frozen) => {
    const now = recording[route + '|' + frozen.scenario];
    const order = Object.keys(frozen.fixture);
    replayed++;
    check(route + ' · ' + frozen.scenario + ': the frozen ' + frozen.status + ' body is kept, key by key and in order', !!now && now.status === frozen.status && sameValue(order.map((name) => now.body[name]), order.map((name) => frozen.fixture[name])) && sameValue(Object.keys(now.body).filter((name) => order.includes(name)), order), now && now.body);
  }));
  check('at least thirty 5xx answers were frozen and replayed (' + replayed + ')', replayed >= 30, replayed);
}

/* ── the foreign-id world (API-STANDARD S35): shop B asks for shop A's connector by its id ── */
const WITH_BODY = { regenerate: { name: 'Tally Mayur', otp: '482910' }, connection: { ref: 'sensor-9' }, toggle: { enabled: true } };
const FOREIGN_ROUTES = () => [
  ['GET ' + MOUNT + '/:actorId/receipts', 'GET', '/receipts'],
  ['POST ' + MOUNT + '/:actorId/erp-test', 'POST', '/erp-test', {}],
  ['GET ' + MOUNT + '/:actorId/provisioning', 'GET', '/provisioning'],
  ['POST ' + MOUNT + '/:actorId/regenerate-key', 'POST', '/regenerate-key', WITH_BODY.regenerate],
  ['POST ' + MOUNT + '/:actorId/ping', 'POST', '/ping', {}],
  ['POST ' + MOUNT + '/:actorId/connections', 'POST', '/connections', WITH_BODY.connection],
  ['GET ' + MOUNT + '/:actorId/connections', 'GET', '/connections'],
  ['PATCH ' + MOUNT + '/:actorId/connections/:connId', 'PATCH', '/connections/' + scenes.CONNECTION, WITH_BODY.toggle],
  ['DELETE ' + MOUNT + '/:actorId', 'DELETE', '']
];

/** one play(who, planted) of a foreign-id route: the connector exists for shop A only when planted; shop B asks as the stranger, shop A as the owner */
function playFor(port, [, method, tail, body]) {
  return async (who, planted) => {
    const rows = scenes.stubRows({ owner: planted ? scenes.SHOP : 'nobody', connections: planted ? [scenes.CONNECTION_ROW] : [] });
    Object.assign(world, { realAuth: false, who: who === 'owner' ? OWNER : STRANGER, asKey: false, db: 'ok', sqlRows: rows, jsonThrows: false, noCustomer: false });
    resetIds();
    return lab.send(port, method, MOUNT + '/' + scenes.ACTOR + tail, body);
  };
}

async function checkForeignIds(port) {
  console.log('\n-- signed in as another shop: a foreign id answers exactly as an unknown id (S35) --');
  const recording = FOREIGN.recorder();
  const items = FOREIGN_ROUTES();
  const failures = await FOREIGN.runCases(items.map((item) => ({ route: item[0], play: playFor(port, item) })), recording.record);
  console.log('  foreign id: ' + (items.length - failures.length) + ' of ' + items.length + ' routes held');
  failures.forEach((sentence) => console.log('  FINDING ' + sentence));
  return { proved: recording.proved(), failures, asked: items.length };
}

/** the two raw-text keys of a POST /ingest success (a known finding, listed for cb-security, not fixed here): printed so the run says where they are */
function reportFindings(recording) {
  const ingest = Object.keys(recording).filter((key) => key.startsWith('POST ' + MOUNT + '/ingest|') && recording[key].status === 200 && recording[key].body);
  const carrying = ingest.filter((key) => /secret|bucket/.test(JSON.stringify(recording[key].body)));
  console.log('\n-- findings (listed, not fixed) --');
  console.log('  FINDING POST /api/connectors/ingest: a 200 carries the exception text in `file_err` / `proof_err` (' + carrying.length + ' scenes show it)');
  const erp = Object.keys(recording).filter((key) => key.startsWith('POST ' + MOUNT + '/erp-ingest|') && recording[key].body && recording[key].body.outcome === 'failed');
  console.log('  FINDING POST /api/connectors/erp-ingest: a 200 with outcome "failed" when the outcome chit was not delivered (' + erp.length + ' scene)');
  return carrying;
}

process.on('unhandledRejection', (failure) => console.log('  (unhandled rejection: ' + String(failure && failure.message).slice(0, 80) + ')'));
(async () => {
  if (lab.flagValue('--freeze')) return lab.freeze(lab.flagValue('--freeze'));
  installFixedIds();
  lab.installStubs();
  const router = require(path.join(HERE, ROUTE_FILE));
  const routes = lab.routesOf(router, MOUNT);
  const server = lab.appOf([{ mount: MOUNT, router }]).listen(0);
  const port = server.address().port;
  const recording = {};
  const capturing = lab.flagValue('--capture') || lab.flagValue('--compare');
  const allowed = capturing ? () => [] : contractModule().allowedStatuses();
  const scenarios = lab.scenariosOf(routes, WORLDS, extrasList(), VALUES);
  const tested = await lab.checkRoutes(port, scenarios, recording, allowed, sources);
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
  const foreign = await checkForeignIds(port);
  server.close();
  checkWords();
  checkCodesRegistered(contractModule());
  checkContractShape(routes);
  checkFrozenFaults(recording);
  reportFindings(recording);
  const legacy = JSON.parse(fs.readFileSync(lab.legacyFile, 'utf8')).routes;
  const frozen = Object.keys(legacy).filter(lab.mine).reduce((sum, route) => sum + legacy[route].answers.length, 0);
  check('every refusal recorded before the sweep is replayed against the code: ' + frozen + ' answers, each once, byte for byte', frozen > 100, frozen);
  check('a caller who is not signed in is refused with 401 on every route that asks for a sign-in', Object.keys(recording).filter((key) => key.endsWith('|signed-out') && !DEVICE_ROUTES.some((route) => key.startsWith(route + '|'))).every((key) => recording[key].status === 401));
  check('a device with no key is refused with 401 NO_KEY on both doors', ['POST ' + MOUNT + '/ingest|ingest-no-key', 'POST ' + MOUNT + '/erp-ingest|erp-ingest-no-key'].every((key) => recording[key].status === 401 && recording[key].body.code === 'NO_KEY'));
  const leaks = (key) => /SELECT|vault|relation "/.test(JSON.stringify(recording[key].body || {}));
  const faults = Object.keys(recording).filter((key) => recording[key].status >= 500);
  check('a 5xx never says its cause: no answer of 500 and over carries the database text (' + faults.length + ' answers)', faults.filter(leaks).length === 0, faults.filter(leaks));
  const refused = Object.keys(recording).filter((key) => recording[key].status >= 400 && recording[key].status < 500);
  check('a 4xx never carries the database text either (' + refused.length + ' answers)', refused.filter(leaks).length === 0, refused.filter(leaks));
  const everywhere = Object.keys(recording).filter((key) => !key.startsWith('POST ' + MOUNT + '/ingest|') && leaks(key));
  check('no answer of any route but POST /ingest, a 200 included, carries the text of a thrown error (a body scan: ' + Object.keys(recording).length + ' answers; the ingest 200 is the finding above)', everywhere.length === 0, everywhere);
  check('a 2xx is never a Problem: every success answer keeps its own shape', Object.keys(recording).filter((key) => recording[key].status < 400).every((key) => !/problem\+json/.test(recording[key].type)));
  const coverage = lab.coverageOf(tested);
  const onDisk = JSON.parse(fs.readFileSync(TESTED_FILE, 'utf8'));
  const mine = Object.fromEntries(Object.keys(onDisk).filter(lab.mine).sort().map((route) => [route, onDisk[route]]));
  if (lab.argv.includes('--write')) {
    const others = Object.fromEntries(Object.keys(onDisk).filter((route) => !lab.mine(route)).map((route) => [route, onDisk[route]]));
    const merged = Object.assign(others, coverage);
    fs.writeFileSync(TESTED_FILE, JSON.stringify(Object.fromEntries(Object.keys(merged).sort().map((route) => [route, merged[route]])), null, 1) + '\n');
    FOREIGN.writeEvidence(EVIDENCE_FILE, lab.mine, foreign.proved);
  } else {
    check('docs/contracts/api-error-tests.json lists exactly the statuses these scenarios cover for routes/connectors.js', sameValue(mine, coverage), { onDisk: Object.keys(mine).length, covered: Object.keys(coverage).length });
    check('docs/contracts/api-hardening-evidence-areas.json says exactly what the foreign-id world showed', sameValue(FOREIGN.evidenceOf(EVIDENCE_FILE, lab.mine), foreign.proved), foreign.proved);
  }
  check('signed in as another shop: all ' + foreign.asked + ' routes addressed by a connector id held (a foreign id answers exactly as an unknown one)', foreign.failures.length === 0, foreign.failures);
  console.log('\n  ' + lab.count.passed + ' checks, ' + lab.count.failed + ' failed');
  process.exit(lab.count.failed ? 1 : 0);
})();
