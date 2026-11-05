#!/usr/bin/env node
// @type: contract
/**
 * api-problem-schemas.test.cjs — API-4 sweep (stage 2), the catalogue's schema engine: every answer of routes/schemas.js (7 routes, mounted at /api/schemas).
 *
 * OWNS      the proof that each refusal of the seven routes is a Problem body AND still carries the keys it answered before (docs/contracts/api-legacy.json, recorded from the code
 *           before the sweep), that no success answer moved (--compare against a capture of the code before), that a 2xx is never a Problem, that no answer of ANY status (a 200 and a
 *           4xx included) carries the text of a thrown error, the one place where one still does (POST /create-default relays its bootstrap's error text: listed here, frozen, a finding
 *           for cb-catalogue and cb-security, NOT fixed by the sweep), the frozen 5xx bodies replayed, this file's rows of docs/contracts/api-error-tests.json, the "signed in as another
 *           shop" world on the two routes addressed by a column key (recorded in docs/contracts/api-hardening-evidence-areas.json), the old express-validator chains run beside the schemas
 *           that replaced them, and the Q18 rule (an unknown key in a body is refused by name; every key the web sends is accepted).
 * CALLED BY scripts/guards.cjs · CI. No database, no network: the real route file and the real libraries over the stand-in db and sign-in (tests/lib/problem-world.cjs, scenes in tests/lib/schemas-scenes.cjs).
 * FLOW      the seven routes x world (signed out, a failing db, an empty db, a bad id) + the named extras → real route → body → Problem fields present · frozen legacy keys equal · no leak
 *           on any status · statuses tested → manifest; then the chains, the frozen 5xx, the leak register, the foreign-column world → evidence
 * CARD      07-catalogue-and-pricing/catalogue-setup
 *
 *   node tests/api-problem-schemas.test.cjs                    check
 *   node tests/api-problem-schemas.test.cjs --write            rewrite this file's rows of docs/contracts/api-error-tests.json and api-hardening-evidence-areas.json
 *   node tests/api-problem-schemas.test.cjs --capture F        (run on the code BEFORE the change) record each answer to file F
 *   node tests/api-problem-schemas.test.cjs --freeze F         merge a capture F into docs/contracts/api-legacy.json (the frozen answers)
 *   node tests/api-problem-schemas.test.cjs --compare F        the answers now against a capture F: byte for byte for a success, the old keys in order for a refusal
 */
'use strict';
const path = require('path');
const fs = require('fs');
const { harness, OWNER, SECRET_SQL, sameValue } = require('./lib/problem-world.cjs');
const S = require('./lib/schemas-scenes.cjs');
const foreign = require('./lib/foreign-id-world.cjs');

const HERE = path.join(__dirname, '..');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
const MOUNT = '/api/schemas';
const ROUTE_COUNT = 7;
const MIN_SCENARIOS = 100;
const MIN_FROZEN = 60;
const MIN_FROZEN_5XX = 12;
const TESTED_FILE = path.join(HERE, 'docs', 'contracts', 'api-error-tests.json');
const EVIDENCE_FILE = path.join(HERE, 'docs', 'contracts', 'api-hardening-evidence-areas.json');
const REGISTER_FILE = path.join(HERE, 'docs', 'error-codes.json');
const SAFE = 'Something went wrong — please try again.';
const LEAK = /SELECT|vault|relation "|pg [0-9A-Z]{5}/;
const CREATE = 'POST ' + MOUNT + '/create-default';
const PATCH_ONE = 'PATCH ' + MOUNT + '/fields/:field_key';
const DROP_ONE = 'DELETE ' + MOUNT + '/fields/:field_key';
const LABELS = {
  [`GET ${MOUNT}/my`]: 'Failed to get schema',
  [CREATE]: 'Failed to create schema',
  [`GET ${MOUNT}/fields`]: 'Failed to get fields',
  [DROP_ONE]: 'Failed to remove the column',
  [`PATCH ${MOUNT}/fields/order`]: 'Failed to save the order',
  [PATCH_ONE]: 'Failed to update the column',
  [`PATCH ${MOUNT}/visibility`]: 'Visibility update failed'
};
const lab = harness({
  here: HERE,
  mounts: [MOUNT],
  routeFiles: { [MOUNT]: 'routes/schemas.js' },
  legacyFile: path.join(HERE, 'docs', 'contracts', 'api-legacy.json'),
  inherited: (scenario, answer) => answer.status === 401 && scenario.id === 'signed-out',
  notFrozen: (one, scenario) => one.status === 401 && scenario === 'signed-out'
});
const { check } = lab;
const WORLDS = [
  { id: 'signed-out', setup: { realAuth: true } },
  { id: 'db-fails', setup: { db: 'fail' } },
  { id: 'nothing-found', setup: {} },
  { id: 'bad-id', setup: {}, badId: true }
];
/** the libraries a scene may swap a function of (the scene's `patch`): the column probe and the bootstrap */
const sources = () => ({ schema: require(path.join(HERE, 'lib', 'schema')), bootstrap: require(path.join(HERE, 'lib', 'schema-bootstrap')) });
/** the contract, or null when the code has none (the untouched base: the checks then FAIL by name instead of the run dying on a missing file) */
const contractModule = () => {
  try {
    return require(path.join(HERE, 'lib', 'schemas-contract.js'));
  } catch (failure) {
    return null;
  }
};
const chainsModule = () => require('./lib/schemas-chains.cjs');
const legacyRoutes = () => JSON.parse(fs.readFileSync(lab.legacyFile, 'utf8')).routes;
/** the one scenario the real bootstrap answers with the database's own sentence: replayed, never judged as an ordinary 5xx */
const isKnownLeak = (scenario) => scenario.route === CREATE && scenario.id === 'db-fails';

/** lib/schemas-contract.js as a unit: the words of every refusal and of a fault, as these routes always said them */
function checkWords() {
  console.log('\n-- lib/schemas-contract.js: the schema routes\' refusals as a unit --');
  const contract = contractModule();
  check('lib/schemas-contract.js exists and words the refusals', !!contract);
  if (!contract) return;
  const { words, fault, createRefused } = contract;
  const req = { id: 'r1' };
  const locked = words.locked('name');
  check('a locked column: the old { error, code, message } at 409 under the code LOCKED', locked.code === 'LOCKED' && sameValue(Object.keys(locked.legacy), ['error', 'code', 'message']) && locked.legacy.code === 'LOCKED' && locked.legacy.error === 'Cannot remove', locked);
  const inUse = words.inUse(1, 'Grade');
  check('an in-use column: used_by travels beside the sentence, the singular reads "1 product"', inUse.code === 'IN_USE' && inUse.legacy.used_by === 1 && /^1 product record/.test(inUse.legacy.message) && sameValue(Object.keys(inUse.legacy), ['error', 'code', 'used_by', 'message']), inUse);
  check('the plural reads "12 products"', /^12 products record/.test(words.inUse(12, 'Grade').legacy.message));
  check('a retype refusal is IN_USE when products hold a value, else LOCKED, and says how many', words.retypeRefused(4, 'why').code === 'IN_USE' && words.retypeRefused(0, 'why').code === 'LOCKED' && words.retypeRefused(4, 'why').legacy.used_by === 4);
  check('a missing column and a missing definition answer NOT_FOUND in their own sentences', words.noSuchColumn().code === 'NOT_FOUND' && words.noSuchColumn().legacy.message === 'Your catalogue has no such column.' && words.noDefinition().legacy.message === 'Your catalogue has no definition.' && words.noActiveCatalogue().legacy.message === 'No active catalogue to update');
  const broken = fault(new Error(SECRET_SQL), req, 'Failed to get fields');
  check('a fault: a 500 INTERNAL that says nothing of its cause, the screen\'s label kept', broken.status === 500 && broken.code === 'INTERNAL' && sameValue(broken.legacy, { error: 'Failed to get fields', message: SAFE }) && !JSON.stringify(broken).includes('vault'), broken);
  const relayed = createRefused(req, { error: 'the bootstrap said no' });
  check('POST /create-default\'s refusal relays the bootstrap\'s own text (listed as a finding, frozen as it answered)', relayed.status === 500 && relayed.legacy.message === 'the bootstrap said no' && relayed.legacy.error === 'Failed to create schema', relayed);
  check('and says "no schema" when the bootstrap gave no reason', createRefused(req, {}).legacy.message === 'no schema');
}

/** every code the words answer under is a row of docs/ERROR-CODES.md with its sentence written */
function checkCodesRegistered() {
  console.log('\n-- the codes the schema routes answer under are in the register --');
  const contract = contractModule();
  if (!contract) return;
  const known = new Set(JSON.parse(fs.readFileSync(REGISTER_FILE, 'utf8')).codes.filter((item) => item.shopkeeper !== 'PENDING').map((item) => item.code));
  const missing = contract.CODES.filter((code) => !known.has(code));
  check('every code the schema words answer under (' + contract.CODES.length + ' codes) is a register row with its sentence written', missing.length === 0, missing);
}

/** the contract in front of the router: every route has a row and a row has a route; every body is closed; the web's keys are all accepted */
function checkContractShape(routes, router) {
  console.log('\n-- the contract and the router agree --');
  const contract = contractModule();
  const published = router.openapi && router.openapi.paths ? Object.keys(router.openapi.paths) : [];
  check('the router publishes its operations: router.openapi.paths names the routes (' + published.length + ' paths)', !!contract && published.length === 6, published);
  if (!contract) return;
  const operations = Object.keys(contract.OPERATIONS);
  check('every route the router holds has an operation, and every operation a route (' + operations.length + ')', sameValue(operations.slice().sort(), Object.keys(routes).sort()), operations.filter((key) => !routes[key]));
  const bodies = Object.entries(contract.OPERATIONS).filter(([, one]) => one.requestBody).map(([key, one]) => [key, one.requestBody.content['application/json'].schema]);
  check('four routes take a body, and every body is closed: an unknown key is refused by name (Q18)', bodies.length === 4 && bodies.every(([, schema]) => schema.additionalProperties === false), bodies.map(([key]) => key));
  const named = (key) => Object.keys(contract.OPERATIONS[key].requestBody.content['application/json'].schema.properties).sort();
  check('PATCH /fields/:field_key names the six keys its handler reads, and the web sends only four of them', sameValue(named(PATCH_ONE), ['field_name', 'field_type', 'leg', 'required', 'unit', 'via']));
  check('PATCH /fields/order names order, PATCH /visibility names visibility, POST /create-default names nothing', sameValue(named(`PATCH ${MOUNT}/fields/order`), ['order']) && sameValue(named(`PATCH ${MOUNT}/visibility`), ['visibility']) && sameValue(named(CREATE), []));
  check('every refusal an operation declares is a Problem', operations.every((key) => Object.keys(contract.OPERATIONS[key].responses).filter((status) => Number(status) >= 400).every((status) => JSON.stringify(contract.OPERATIONS[key].responses[status]).includes('Problem'))));
  const declared = (key) => Object.keys(contract.OPERATIONS[key].responses).filter((status) => Number(status) >= 400).map(Number);
  check('the two column routes declare the 404 and the 409 their handlers write; the order route declares its 404 without a path id', declared(DROP_ONE).includes(404) && declared(DROP_ONE).includes(409) && declared(PATCH_ONE).includes(409) && declared(`PATCH ${MOUNT}/fields/order`).includes(404));
}

/** the old chains and the schemas that replaced them refuse the same bodies, in the same words */
async function checkChainsAgree() {
  console.log('\n-- the schemas agree with the chains they replaced --');
  const { schemaValidate } = require(path.join(HERE, 'middleware', 'validate'));
  const contract = contractModule();
  if (!contract) return check('the chains can be compared once the contract exists', false);
  const table = chainsModule();
  for (const route of table.ROUTES) {
    const operation = contract.contract.operationFor(route);
    const outcome = await table.compare(route, schemaValidate(operation, contract.schemaOptionsFor(route)));
    check(route + ': the schema and the chain agree on ' + outcome.cases + ' bodies (verdict and refusal body, every double listing included)', outcome.disagree.length === 0, outcome.disagree.slice(0, 6));
  }
  check('the differences between a chain and its schema that were looked at and kept are the ' + table.KNOWN_DIFFERENCES.length + ' listed (a list for a value, a body that is not an object: no screen sends either)', table.KNOWN_DIFFERENCES.length === 3, table.KNOWN_DIFFERENCES);
}

/**
 * the harness replays no frozen body for a 5xx, only that it says nothing of its cause; each frozen 5xx here is a deliberate label ("Failed to get fields"), so each is replayed:
 * the same status and every old key, key by key and in order. A 502 or a 503 has no source here: no library under these routes carries a status.
 */
function checkFrozen5xx(recording) {
  console.log('\n-- the frozen 5xx answers are replayed --');
  const legacy = legacyRoutes();
  let replayed = 0;
  Object.keys(legacy).filter(lab.mine).forEach((route) => legacy[route].answers.filter((frozen) => frozen.status >= 500 && recording[route + '|' + frozen.scenario]).forEach((frozen) => {
    const now = recording[route + '|' + frozen.scenario];
    const order = Object.keys(frozen.fixture);
    replayed++;
    check(route + ' · ' + frozen.scenario + ': the frozen ' + frozen.status + ' body is kept, key by key and in order', now.status === frozen.status && sameValue(order.map((name) => now.body[name]), order.map((name) => frozen.fixture[name])) && sameValue(Object.keys(now.body).slice(0, order.length), order), now.body);
  }));
  check('at least ' + MIN_FROZEN_5XX + ' 5xx answers were frozen and replayed (' + replayed + ')', replayed >= MIN_FROZEN_5XX, replayed);
}

/** a 2xx is never a Problem; no answer of any status carries the text of a thrown error, bar the one listed leak; every fault says only the generic sentence, bar the relayed refusals */
function checkNoLeakAnywhere(recording) {
  console.log('\n-- the body scan: a 2xx is never a Problem, and no body carries a thrown text --');
  const keys = Object.keys(recording);
  const successes = keys.filter((key) => recording[key].status < 300);
  check('a 2xx answer is never a Problem (' + successes.length + ' answers)', successes.every((key) => !/problem/.test(recording[key].type) && !(recording[key].body && recording[key].body.type && recording[key].body.request_id !== undefined && recording[key].body.code)), successes.filter((key) => /problem/.test(recording[key].type)));
  const leaking = keys.filter((key) => LEAK.test(JSON.stringify(recording[key].body || {})) || /relation "/.test(recording[key].text || ''));
  check('no answer of any status, a 200 and a 4xx included, carries the database text (' + keys.length + ' answers scanned)', leaking.length === 0, leaking);
  const relays = keys.filter((key) => key.startsWith(CREATE + '|') && recording[key].status >= 500 && recording[key].body && recording[key].body.message !== SAFE).map((key) => key.split('|')[1]).sort();
  const faults = keys.filter((key) => recording[key].status >= 500 && !relays.includes(key.split('|')[1]));
  check('every other fault says only the generic sentence (' + faults.length + ' answers)', faults.every((key) => recording[key].body && recording[key].body.message === SAFE), faults.filter((key) => !recording[key].body || recording[key].body.message !== SAFE));
  check('the only fault that does not is POST /create-default\'s own refusal when its bootstrap gave a reason: ' + relays.join(', '), sameValue(relays, ['create-bootstrap-refuses', 'create-no-schema-id', 'nothing-found']), relays);
  check('a caller who is not signed in is refused with 401 on every route', keys.filter((key) => key.endsWith('|signed-out')).length === ROUTE_COUNT && keys.filter((key) => key.endsWith('|signed-out')).every((key) => recording[key].status === 401));
}

/** ask one scene on its own, with the library functions it swaps put back afterwards */
async function askAlone(port, scenario) {
  const modules = sources();
  const undo = [];
  Object.keys(scenario.patch || {}).forEach((which) => Object.keys(scenario.patch[which]).forEach((name) => {
    undo.push([modules[which], name, modules[which][name]]);
    modules[which][name] = scenario.patch[which][name];
  }));
  Object.assign(lab.world, { realAuth: false, who: OWNER, asKey: false, db: 'ok', sqlRows: null, jsonThrows: false }, scenario.setup);
  const method = scenario.route.split(' ')[0];
  const answer = await lab.send(port, method, scenario.url, method === 'GET' ? undefined : scenario.body === undefined ? {} : scenario.body);
  undo.forEach(([owner, name, original]) => (owner[name] = original));
  return answer;
}

/**
 * THE ONE LEAK (a finding, NOT fixed here): lib/schema-bootstrap.js returns { error: e.message } and POST /create-default sends it as `message` of its 500 (routes/schemas.js, the base :49).
 * The sweep keeps the answer byte for byte (behaviour is the owner's), words it as a Problem, and this check shows exactly what it holds, so the leak cannot grow or move unseen.
 */
async function checkKnownLeak(port, scenario) {
  console.log('\n-- POST /create-default: the bootstrap\'s error text in a 500 (finding for cb-catalogue and cb-security) --');
  const answer = await askAlone(port, scenario);
  const frozen = (legacyRoutes()[CREATE] || { answers: [] }).answers.find((one) => one.scenario === scenario.id);
  check('a failing database answers 500 as a Problem under INTERNAL', answer.status === 500 && answer.json && /problem\+json/.test(answer.type) && answer.json.code === 'INTERNAL', [answer.status, answer.type]);
  check('the old keys are kept, in order: error, then the bootstrap\'s text as message (the frozen answer)', !!frozen && sameValue(Object.keys(frozen.fixture), ['error', 'message']) && answer.json.error === frozen.fixture.error && answer.json.message === frozen.fixture.message, frozen);
  check('the Problem\'s own detail says nothing of the cause: the text rides only in the frozen `message`', answer.json && !LEAK.test(answer.json.detail || '') && !LEAK.test(answer.json.hint || '') && !LEAK.test(JSON.stringify(answer.json.errors || [])), answer.json);
  check('the text is the bootstrap\'s own (that is the finding: it is a database sentence)', answer.json && LEAK.test(answer.json.message), answer.json && answer.json.message);
}

/** a scene whose refusal the sweep ADDS: the answer, its Problem and the keys the old chain-less route did not have */
async function checkAdded(port, scenarios, contract) {
  console.log('\n-- the refusals the sweep adds (Q18): an unknown key, a list for a body --');
  for (const scenario of scenarios) {
    const answer = await askAlone(port, scenario);
    const label = scenario.route + ' · ' + scenario.id;
    check(label + ': refused with ' + scenario.expect, answer.status === scenario.expect, [answer.status, answer.text.slice(0, 160)]);
    check(label + ': a Problem that names the field at fault', answer.json && /problem\+json/.test(answer.type) && Array.isArray(answer.json.errors) && answer.json.errors.length > 0 && typeof answer.json.field === 'string', answer.json);
    if (/zz_unknown/.test(JSON.stringify(scenario.body))) check(label + ': the unknown key is the one named', answer.json && answer.json.errors.some((one) => one.field === 'zz_unknown' && one.code === 'UNKNOWN_FIELD'), answer.json && answer.json.errors);
  }
  const body = (key) => contract.OPERATIONS[key].requestBody.content['application/json'].schema;
  check('every key the web sends is a key the schema names (field_name · field_type · required · unit · order · visibility)', ['field_name', 'field_type', 'required', 'unit'].every((name) => name in body(PATCH_ONE).properties) && 'order' in body(`PATCH ${MOUNT}/fields/order`).properties && 'visibility' in body(`PATCH ${MOUNT}/visibility`).properties);
}

/** the "signed in as another shop" world: the two routes addressed by a column key (API-STANDARD S35) */
async function foreignWorld(port) {
  console.log('\n-- the 9th world: signed in as another shop --');
  const stranger = { identity_id: S.OTHER_SHOP, identity_type: 'entity', display_name: 'Another shop' };
  const asks = [
    [DROP_ONE, 'DELETE', MOUNT + '/fields/grade'],
    [PATCH_ONE, 'PATCH', MOUNT + '/fields/grade', { field_name: 'Renamed' }]
  ];
  const cases = asks.map(([route, method, url, body]) => ({
    route,
    play: async (who, planted) => {
      const asked = who === 'owner' ? OWNER : stranger;
      Object.assign(lab.world, { realAuth: false, asKey: false, db: 'ok', who: asked, sqlRows: S.visibleTo(asked, planted) });
      return lab.send(port, method, url, body).catch(() => null);
    }
  }));
  const seen = foreign.recorder();
  const failures = await foreign.runCases(cases, seen.record);
  failures.forEach((sentence) => check('foreign id: ' + sentence, false));
  asks.forEach(([route]) => check(route + ': another shop\'s column key answers exactly as an unknown one (404, same body); the owner\'s own key is not a 404', !failures.some((one) => one.startsWith(route))));
  return seen.proved();
}

/** the rows of api-error-tests.json and the evidence file this test owns: rewritten with --write, otherwise compared with what the scenarios showed */
function settleRecords(tested, proved) {
  const coverage = lab.coverageOf(tested);
  const onDisk = JSON.parse(fs.readFileSync(TESTED_FILE, 'utf8'));
  const mine = Object.fromEntries(Object.keys(onDisk).filter(lab.mine).sort().map((route) => [route, onDisk[route]]));
  if (lab.argv.includes('--write')) {
    const others = Object.fromEntries(Object.keys(onDisk).filter((route) => !lab.mine(route)).map((route) => [route, onDisk[route]]));
    const merged = Object.assign(others, coverage);
    fs.writeFileSync(TESTED_FILE, JSON.stringify(Object.fromEntries(Object.keys(merged).sort().map((route) => [route, merged[route]])), null, 1) + '\n');
    foreign.writeEvidence(EVIDENCE_FILE, lab.mine, proved);
    return;
  }
  check('docs/contracts/api-error-tests.json lists exactly the statuses these scenarios cover for routes/schemas.js', sameValue(mine, coverage), { onDisk: mine, covered: coverage });
  check('docs/contracts/api-hardening-evidence-areas.json says exactly what the foreign-id world showed', sameValue(foreign.evidenceOf(EVIDENCE_FILE, lab.mine), proved), proved);
}

process.on('unhandledRejection', (failure) => console.log('  (unhandled rejection: ' + String(failure && failure.message).slice(0, 80) + ')'));
(async () => {
  if (lab.flagValue('--freeze')) return lab.freeze(lab.flagValue('--freeze'));
  lab.installStubs();
  const router = require(path.join(HERE, 'routes', 'schemas.js'));
  const routes = lab.routesOf(router, MOUNT);
  check('premise: the router holds the seven schema routes (' + Object.keys(routes).length + ')', Object.keys(routes).length === ROUTE_COUNT, Object.keys(routes));
  const server = lab.appOf([{ mount: MOUNT, router }]).listen(0);
  const port = server.address().port;
  const recording = {};
  const capturing = lab.flagValue('--capture') || lab.flagValue('--compare');
  const contract = contractModule();
  const allowed = capturing ? () => [] : contract ? contract.allowedStatuses() : () => [];
  const all = lab.scenariosOf(routes, WORLDS, S.extras(), {}).map((one) => (isKnownLeak(one) ? Object.assign({}, one, { synthetic: true }) : one));
  const leaks = all.filter(isKnownLeak);
  const added = all.filter((one) => one.after);
  const ordinary = capturing ? all : all.filter((one) => !one.synthetic && !one.after);
  const tested = await lab.checkRoutes(port, ordinary, recording, allowed, sources);
  if (lab.flagValue('--capture')) {
    server.close();
    fs.writeFileSync(lab.flagValue('--capture'), JSON.stringify(recording, null, 1));
    console.log('captured ' + Object.keys(recording).length + ' answers over ' + Object.keys(routes).length + ' routes');
    process.exit(0);
  }
  if (lab.flagValue('--compare')) {
    server.close();
    lab.compare(lab.flagValue('--compare'), recording);
    process.exit(0);
  }
  checkWords();
  checkCodesRegistered();
  checkContractShape(routes, router);
  await checkChainsAgree();
  checkFrozen5xx(recording);
  checkNoLeakAnywhere(recording);
  for (const leak of leaks) await checkKnownLeak(port, leak);
  check('the refusals the sweep adds are the six listed (an unknown key on four routes, a list for a body on two)', added.length === 6, added.map((one) => one.id));
  if (contract) await checkAdded(port, added, contract);
  check('premise: the scenarios ran (' + all.length + ' scenarios over ' + Object.keys(routes).length + ' routes)', all.length > MIN_SCENARIOS && Object.keys(routes).length === ROUTE_COUNT, all.length);
  const proved = await foreignWorld(port);
  server.close();
  const legacy = legacyRoutes();
  const frozen = Object.keys(legacy).filter(lab.mine).reduce((sum, route) => sum + legacy[route].answers.length, 0);
  check('every refusal recorded before the sweep is replayed against the code: ' + frozen + ' answers, each once, byte for byte', frozen >= MIN_FROZEN, frozen);
  settleRecords(tested, proved);
  console.log('\n  ' + lab.count.passed + ' checks, ' + lab.count.failed + ' failed');
  process.exit(lab.count.failed ? 1 : 0);
})();
