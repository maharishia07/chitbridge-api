#!/usr/bin/env node
// @type: contract
/**
 * api-problem-definitions.test.cjs — API-4 sweep, the definitions shelf: every answer of routes/definitions.js (6 routes, mounted at /api/definitions).
 *
 * OWNS      the proof that each refusal of these 6 routes is a Problem body AND still carries the keys it answered before (docs/contracts/api-legacy.json, recorded from the code
 *           before the sweep), that no success answer moved (--compare against a capture of the code before), that no answer of any status carries the text of a thrown error (a db
 *           that THROWS a string with SQL in it, and a library that does), this file's rows of docs/contracts/api-error-tests.json, and the "signed in as another shop" world
 *           (API-STANDARD S35, tests/lib/foreign-id-world.cjs) for the three routes addressed by an id, recorded in docs/contracts/api-hardening-evidence.json.
 *           Also: no answer outside the statuses the contract declares (lib/definitions-contract.js), its words as units, and the old express-validator chains run beside the
 *           schemas that replaced them.
 * CALLED BY scripts/guards.cjs · CI. No database, no network: the real route file over a stand-in db and auth (tests/lib/problem-world.cjs).
 * FLOW      the six routes x world (signed out, a failing db, an empty db, a bad id) + the named extras (tests/lib/definitions-scenes.cjs) → real route → body → Problem fields
 *           present · frozen legacy keys equal · no leak on any status · statuses tested → manifest; then the foreign-id world → evidence
 * CARD      07-catalogue-and-pricing/definitions
 *
 *   node tests/api-problem-definitions.test.cjs                    check
 *   node tests/api-problem-definitions.test.cjs --write            rewrite this file's rows of docs/contracts/api-error-tests.json and api-hardening-evidence.json
 *   node tests/api-problem-definitions.test.cjs --capture F        (run on the code BEFORE the change) record each answer to file F
 *   node tests/api-problem-definitions.test.cjs --freeze F         merge a capture F into docs/contracts/api-legacy.json (the frozen answers)
 *   node tests/api-problem-definitions.test.cjs --compare F        the answers now against a capture F: byte for byte for a success, the old keys in order for a refusal
 */
'use strict';
const path = require('path');
const fs = require('fs');
const { harness, OWNER, SECRET_SQL, sameValue, raising, answering, firstOf } = require('./lib/problem-world.cjs');
const S = require('./lib/definitions-scenes.cjs');
const chainTable = require('./lib/definitions-chains.cjs');
const foreign = require('./lib/foreign-id-world.cjs');

const HERE = path.join(__dirname, '..');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
const MOUNT = '/api/definitions';
const TESTED_FILE = path.join(HERE, 'docs', 'contracts', 'api-error-tests.json');
const EVIDENCE_FILE = path.join(HERE, 'docs', 'contracts', 'api-hardening-evidence.json');
const REGISTER_FILE = path.join(HERE, 'docs', 'error-codes.json');
const TOOLS = { answering, raising, firstOf, SECRET_SQL };
const ROUTE_COUNT = 6;
const MIN_SCENARIOS = 80;
const MIN_FROZEN_5XX = 25;
const MIN_FROZEN = 50;
const lab = harness({
  here: HERE,
  mounts: [MOUNT],
  routeFiles: { [MOUNT]: 'routes/definitions.js' },
  legacyFile: path.join(HERE, 'docs', 'contracts', 'api-legacy.json'),
  inherited: (scenario, answer) => answer.status === 401,
  notFrozen: (one) => one.status === 401
});
const { check } = lab;
const WORLDS = [
  { id: 'signed-out', setup: { realAuth: true } },
  { id: 'db-fails', setup: { db: 'fail' } },
  { id: 'nothing-found', setup: {} },
  { id: 'bad-id', setup: {}, badId: true }
];
/** the modules a scene may swap a function of: a library call that THROWS like a database (the scene's `patch`) */
const sources = () => ({
  clash: require(path.join(HERE, 'lib', 'offer-clash')),
  slab: require(path.join(HERE, 'lib', 'slab-cites')),
  gov: require(path.join(HERE, 'lib', 'tax-governance')),
  check: require(path.join(HERE, 'lib', 'definition-check')),
  net: require(path.join(HERE, 'lib', 'network-offers'))
});
const contractModule = () => require(path.join(HERE, 'lib', 'definitions-contract.js'));
const SPILLED_TEXT = /vault|SELECT|relation "|pg [0-9A-Z]{5}|catalogue_items/;
const THROWING_SCENES = ['create-clash-check-throws', 'create-rule-check-throws', 'save-clash-check-throws', 'retire-guard-throws', 'freeze-governed-read-throws', 'list-governed-read-throws', 'list-release-stamp-throws'];

/** lib/definitions-contract.js as a unit: the words of a refusal and of a fault, as these routes always said them */
function checkWords() {
  console.log('\n-- lib/definitions-contract.js: the refusals as a unit --');
  const words = contractModule();
  const req = { id: 'r1' };
  const migration = words.definitionFault(Object.assign(new Error('relation "definition" does not exist'), { code: '42P01' }), req);
  check('definitionFault: a missing table is the short 503, in the words the screens map', migration.status === 503 && migration.code === 'DEFINITIONS_NOT_MIGRATED' && sameValue(migration.legacy, { error: 'Not provisioned', message: 'Definitions need migration b160. Ask the operator to run it.' }), migration);
  const taken = words.definitionFault(Object.assign(new Error('duplicate key'), { code: '23505' }), req, { nameTaken: true });
  check('definitionFault: a taken name is the 409 with its sentence', taken.status === 409 && taken.code === 'DEFINITION_NAME_TAKEN' && taken.legacy.error === 'Name taken', taken);
  const readTaken = words.definitionFault(Object.assign(new Error('duplicate key'), { code: '23505' }), req);
  check('definitionFault: a unique violation on a route that writes no name is a 500, as it was', readTaken.status === 500, readTaken);
  const fault = words.definitionFault(new Error(SECRET_SQL), req, { nameTaken: true });
  check('definitionFault: anything else is a 500 that says nothing of its cause', fault.status === 500 && fault.code === 'INTERNAL' && sameValue(fault.legacy, { error: 'Failed', message: 'Something went wrong — please try again.' }) && !JSON.stringify(fault).includes('vault'), fault);
  const clash = words.words.clash({ error: 'Offer clash', code: 'OFFER_CLASH', message: 'm', clashes: [] });
  check('words.clash keeps the library body whole', clash.code === 'OFFER_CLASH' && sameValue(clash.legacy, { error: 'Offer clash', code: 'OFFER_CLASH', message: 'm', clashes: [] }) && clash.detail === 'm', clash);
  check('words.takeover: the two takeover refusals have their own codes', words.words.takeover({ error: 'same' }).code === 'DEFINITION_TAKEOVER_SAME' && words.words.takeover({ error: 'no_takeover' }).code === 'DEFINITION_TAKEOVER_NOT_LIVE');
  const counts = [[undefined, 2], [null, 2], ['', 1], [' ', 1], ['x', 0], [5, 1], [[], 1], [[''], 2], [['x', ''], 2], [{}, 1]];
  check('the old chain\'s double listing of an empty text is counted as it was', counts.every(([value, times]) => words.timesKindOrName(value) === times), counts.filter(([value, times]) => words.timesKindOrName(value) !== times));
  check('the old chain listed a missing list once, a list never', words.timesList(undefined) === 1 && words.timesList('x') === 1 && words.timesList([]) === 0);
}

/** every code the words answer under is a row of docs/ERROR-CODES.md with its sentence written */
function checkCodesRegistered() {
  console.log('\n-- the codes the definitions routes answer under are in the register --');
  const codes = contractModule().CODES;
  const known = new Set(JSON.parse(fs.readFileSync(REGISTER_FILE, 'utf8')).codes.filter((item) => item.shopkeeper !== 'PENDING').map((item) => item.code));
  const missing = codes.filter((code) => !known.has(code));
  check('every code the definitions words answer under (' + codes.length + ' codes) is a register row with its sentence written', missing.length === 0, missing);
}

/** the contract in front of the router: every route has a row, and a row has a route; the success shapes keep their statuses */
function checkContractShape(routes) {
  console.log('\n-- the contract and the router agree --');
  const contract = contractModule();
  const operations = Object.keys(contract.OPERATIONS);
  check('every route the router holds has an operation, and every operation a route (' + operations.length + ')', sameValue(operations.slice().sort(), Object.keys(routes).sort()), operations.filter((key) => !routes[key]));
  check('every refusal an operation declares is a Problem', operations.every((key) => Object.keys(contract.OPERATIONS[key].responses).filter((status) => Number(status) >= 400).every((status) => JSON.stringify(contract.OPERATIONS[key].responses[status]).includes('Problem'))));
  const created = contract.OPERATIONS['POST /api/definitions'];
  check('a created definition answers 201 and a body needs a text kind and name, as the chain did', '201' in created.responses && !('200' in created.responses) && sameValue(created.requestBody.content['application/json'].schema.required, ['kind', 'name']), created);
  check('POST /freeze needs a list of ids', sameValue(contract.OPERATIONS['POST /api/definitions/freeze'].requestBody.content['application/json'].schema.required, ['definition_ids']));
  check('no body refuses an unknown key (strict_input is not claimed: the Offer Lab sends what its form holds)', Object.values(contract.OPERATIONS).filter((one) => one.requestBody).every((one) => one.requestBody.content['application/json'].schema.additionalProperties === undefined));
  const ids = ['GET', 'PUT', 'DELETE'].map((method) => contract.OPERATIONS[method + ' /api/definitions/:id']);
  check('the three id routes declare a 404; the writes declare the 403, 409 and 422 their handlers write', ids.every((one) => '404' in one.responses) && '403' in ids[1].responses && '409' in ids[2].responses && '422' in contract.OPERATIONS['POST /api/definitions'].responses);
  const router = require(path.join(HERE, 'routes', 'definitions.js'));
  check('the router publishes its paths (three: the shelf and its create share one, the id routes share one, the freeze)', Object.keys((router.openapi || {}).paths || {}).length === 3 && Object.keys(contract.contract.pathsOf()).length === 3, Object.keys((router.openapi || {}).paths || {}));
}

/** the two old chains and the schemas that replaced them refuse the same bodies, in the same words */
async function checkChainsAgree() {
  console.log('\n-- the schemas agree with the chains they replaced --');
  const { schemaValidate } = require(path.join(HERE, 'middleware', 'validate'));
  const contract = contractModule();
  for (const route of [chainTable.CREATE, chainTable.FREEZE]) {
    const operation = contract.contract.operationFor(route);
    const outcome = await chainTable.compare(route, schemaValidate(operation, contract.schemaOptionsFor(route)));
    check(route + ': the schema and the chain agree on ' + outcome.cases + ' bodies (verdict and refusal body, every double listing included)', outcome.disagree.length === 0, outcome.disagree.slice(0, 6));
  }
  check('no difference between chain and schema is kept', chainTable.KNOWN_DIFFERENCES.length === 0);
}

/**
 * the harness replays no frozen body for a 5xx, only that it says nothing of its cause; a 500 and a 503 here are deliberate words ("Failed", "Not provisioned"), so each frozen 5xx is replayed:
 * the same status and every old key, byte for byte and in order. These routes relay no provider text, so there is no 502 and no per-mode 503: the one 503 is the migration's.
 */
function checkFrozen5xx(recording) {
  console.log('\n-- the frozen 500 and 503 answers are replayed --');
  const legacy = JSON.parse(fs.readFileSync(lab.legacyFile, 'utf8')).routes;
  let replayed = 0;
  Object.keys(legacy).filter(lab.mine).forEach((route) => legacy[route].answers.filter((frozen) => frozen.status >= 500).forEach((frozen) => {
    const now = recording[route + '|' + frozen.scenario];
    const order = Object.keys(frozen.fixture);
    replayed++;
    check(route + ' · ' + frozen.scenario + ': the frozen ' + frozen.status + ' body is kept, key by key and in order', !!now && now.status === frozen.status && sameValue(order.map((name) => now.body[name]), order.map((name) => frozen.fixture[name])) && sameValue(Object.keys(now.body).slice(0, order.length), order), now && now.body);
  }));
  check('at least ' + MIN_FROZEN_5XX + ' 5xx answers were frozen and replayed (' + replayed + ')', replayed >= MIN_FROZEN_5XX, replayed);
}

/** the answers of every status, read for what must never be in them: a 2xx is never a Problem, and no body of any status holds the text of a thrown error or of the database */
function checkNoSpill(recording) {
  console.log('\n-- no answer of any status carries thrown text; a 2xx is never a Problem --');
  const answers = Object.values(recording);
  const spilled = (one) => SPILLED_TEXT.test(JSON.stringify(one.body || {}));
  check('the throwing-library scenes ran (' + THROWING_SCENES.length + ') and every one answered without the thrown text', THROWING_SCENES.every((id) => Object.keys(recording).some((key) => key.endsWith('|' + id) && !spilled(recording[key]))), THROWING_SCENES);
  check('no body of any status, 2xx included, carries the database text or a driver code (' + answers.length + ' answers)', answers.every((one) => !spilled(one)), answers.filter(spilled).map((one) => one.route));
  check('a 2xx answer is never a Problem body', answers.filter((one) => one.status >= 200 && one.status < 300).every((one) => !/problem/.test(one.type) && !(one.body && one.body.type && one.body.title && one.body.code)));
  const signedOut = Object.keys(recording).filter((key) => key.endsWith('|signed-out'));
  check('a caller who is not signed in is refused with 401 on every route', signedOut.length === ROUTE_COUNT && signedOut.every((key) => recording[key].status === 401), signedOut.length);
  check('the 200 of a delete, a freeze and a list are still answered', ['DELETE /api/definitions/:id|retire-one', 'POST /api/definitions/freeze|freeze-one', 'GET /api/definitions|list-listed'].every((key) => recording[key] && recording[key].status === 200));
}

/** the "signed in as another shop" world: every route addressed by an id in its path (API-STANDARD S35) */
async function foreignWorld(port) {
  console.log('\n-- the 9th world: signed in as another shop --');
  const stranger = { identity_id: S.OTHER_SHOP, identity_type: 'entity', display_name: 'Another shop' };
  const asks = [
    ['GET /api/definitions/:id', 'GET', '/' + S.DEF],
    ['PUT /api/definitions/:id', 'PUT', '/' + S.DEF, { name: 'Renamed' }],
    ['DELETE /api/definitions/:id', 'DELETE', '/' + S.DEF]
  ];
  const cases = asks.map(([route, method, url, body]) => ({
    route,
    play: async (who, planted) => {
      const asked = who === 'owner' ? OWNER : stranger;
      Object.assign(lab.world, { realAuth: false, asKey: false, db: 'ok', who: asked, sqlRows: S.visibleTo(asked, planted, TOOLS) });
      return lab.send(port, method, MOUNT + url, body).catch(() => null);
    }
  }));
  const seen = foreign.recorder();
  const failures = await foreign.runCases(cases, seen.record);
  failures.forEach((sentence) => check('foreign id: ' + sentence, false));
  asks.forEach(([route]) => check(route + ': another shop\'s id answers exactly as an unknown id (404, same body); the owner\'s own id is not a 404', !failures.some((one) => one.startsWith(route))));
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
  check('docs/contracts/api-error-tests.json lists exactly the statuses these scenarios cover for routes/definitions.js', sameValue(mine, coverage), { onDisk: Object.keys(mine).length, covered: Object.keys(coverage).length });
  check('docs/contracts/api-hardening-evidence.json says exactly what the foreign-id world showed', sameValue(foreign.evidenceOf(EVIDENCE_FILE, lab.mine), proved), proved);
}

process.on('unhandledRejection', (failure) => console.log('  (unhandled rejection: ' + String(failure && failure.message).slice(0, 80) + ')'));
(async () => {
  if (lab.flagValue('--freeze')) {
    lab.freeze(lab.flagValue('--freeze'));
    process.exit(0);
  }
  lab.installStubs();
  const router = require(path.join(HERE, 'routes', 'definitions.js'));
  const routes = lab.routesOf(router, MOUNT);
  const server = lab.appOf([{ mount: MOUNT, router }]).listen(0);
  const port = server.address().port;
  const recording = {};
  const capturing = lab.flagValue('--capture') || lab.flagValue('--compare');
  const allowed = capturing ? () => [] : (route) => contractModule().allowedStatuses()(route) || [];
  const scenarios = lab.scenariosOf(routes, WORLDS, S.extras(TOOLS), {});
  const tested = await lab.checkRoutes(port, scenarios, recording, allowed, sources);
  if (lab.flagValue('--capture')) {
    fs.writeFileSync(lab.flagValue('--capture'), JSON.stringify(recording, null, 1));
    console.log('captured ' + Object.keys(recording).length + ' answers over ' + Object.keys(routes).length + ' routes');
    process.exit(0);
  }
  if (lab.flagValue('--compare')) {
    lab.compare(lab.flagValue('--compare'), recording);
    process.exit(0);
  }
  checkWords();
  checkCodesRegistered();
  checkContractShape(routes);
  await checkChainsAgree();
  checkFrozen5xx(recording);
  checkNoSpill(recording);
  check('premise: the router holds the six routes and the scenarios ran (' + Object.keys(routes).length + ' routes, ' + scenarios.length + ' scenarios)', Object.keys(routes).length === ROUTE_COUNT && scenarios.length > MIN_SCENARIOS, Object.keys(routes));
  const proved = await foreignWorld(port);
  server.close();
  const legacy = JSON.parse(fs.readFileSync(lab.legacyFile, 'utf8')).routes;
  const frozen = Object.keys(legacy).filter(lab.mine).reduce((sum, route) => sum + legacy[route].answers.length, 0);
  check('every refusal recorded before the sweep is replayed against the code: ' + frozen + ' answers, each once, byte for byte', frozen > MIN_FROZEN, frozen);
  settleRecords(tested, proved);
  console.log('\n  ' + lab.count.passed + ' checks, ' + lab.count.failed + ' failed');
  process.exit(lab.count.failed ? 1 : 0);
})();
