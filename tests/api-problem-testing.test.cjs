#!/usr/bin/env node
// @type: contract
/**
 * api-problem-testing.test.cjs — API-4 sweep, the test board: every refusal of routes/testing.js (33 routes).
 *
 * OWNS      the proof that each refusal of the test board's routes is a Problem body AND still carries the keys it answered before (docs/contracts/api-legacy.json, recorded
 *           from the code before the sweep), that no success answer moved (--compare against a capture of the code before), this file's rows of docs/contracts/api-error-tests.json
 *           (the statuses each route is tested for, which the register's error_tests column reads), and the "signed in as another shop" world: a record addressed by an id in the path
 *           answers another shop's id exactly as it answers an unknown id (API-STANDARD S35, tests/lib/foreign-id-world.cjs), recorded in docs/contracts/api-hardening-evidence-areas.json.
 *           Also: no answer outside the statuses the route's contract declares (lib/testing-contract.js), and that contract's words as units.
 * CALLED BY scripts/guards.cjs · CI. No database, no network: the real route file over a stand-in db and auth (tests/lib/problem-world.cjs, scenes in tests/lib/testing-scenes.cjs).
 * FLOW      route list (read from the router itself) x world (signed out, staff, a failing db, an empty db, a bad id) + the named extras → real route → body →
 *           Problem fields present · frozen legacy keys equal · no leak on a 5xx · statuses tested → manifest;
 *           then the foreign-id world: shop B asks shop A's id → the same 404 as an unknown id → evidence
 * CARD      28-platform-and-operations/testing
 *
 *   node tests/api-problem-testing.test.cjs                    check
 *   node tests/api-problem-testing.test.cjs --write            rewrite this file's rows of docs/contracts/api-error-tests.json and api-hardening-evidence-areas.json
 *   node tests/api-problem-testing.test.cjs --capture F        (run on the code BEFORE the change) record each answer to file F
 *   node tests/api-problem-testing.test.cjs --freeze F         merge a capture F into docs/contracts/api-legacy.json (the frozen answers)
 *   node tests/api-problem-testing.test.cjs --compare F        the answers now against a capture F: byte for byte for a success, the old keys in order for a refusal
 */
'use strict';
const path = require('path');
const fs = require('fs');
const { harness, PARTY, OWNER, STAFF, SECRET_SQL, sameValue, answering, firstOf } = require('./lib/problem-world.cjs');
const scenes = require('./lib/testing-scenes.cjs');
const foreign = require('./lib/foreign-id-world.cjs');

const HERE = path.join(__dirname, '..');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
delete process.env.TEST_BOARD_ENTITY;
const MOUNT = '/api/testing';
const OTHER_SHOP = '99999999-9999-4999-8999-999999999999';
const STRANGER = { identity_id: OTHER_SHOP, identity_type: 'entity', display_name: 'Other shop' };
const TESTED_FILE = path.join(HERE, 'docs', 'contracts', 'api-error-tests.json');
const EVIDENCE_FILE = path.join(HERE, 'docs', 'contracts', 'api-hardening-evidence-areas.json');
const REGISTER_FILE = path.join(HERE, 'docs', 'error-codes.json');
const tools = { PARTY, OWNER, STAFF, SECRET_SQL, answering, firstOf };
/** the scenes that are answers the sweep ADDS (the schema's refusal): never frozen */
const ADDED = new Set(scenes.extras(tools).filter((one) => one.after).map((one) => one.id));
const lab = harness({
  here: HERE,
  mounts: [MOUNT],
  routeFiles: { [MOUNT]: 'routes/testing.js' },
  legacyFile: path.join(HERE, 'docs', 'contracts', 'api-legacy.json'),
  before: () => {
    /* every scenario meets the project column as the first read of a fresh process does: not asked yet (routes/testing.js _proj is the cache of that one question) */
    const cache = require(path.join(HERE, 'routes', 'testing.js'))._proj;
    cache.has = null;
    cache.at = 0;
  },
  inherited: (scenario, answer) => answer.status === 401 && scenario.id === 'signed-out',
  notFrozen: (one, scenario) => (one.status === 401 && scenario === 'signed-out') || ADDED.has(scenario)
});
const { check } = lab;
const sources = () => ({ board: require(path.join(HERE, 'lib', 'testboard')), storage: require(path.join(HERE, 'lib', 'storage')), fs: require('fs') });
const WORLDS = [
  { id: 'signed-out', setup: { realAuth: true } },
  { id: 'staff-asks', setup: { who: STAFF } },
  { id: 'db-fails', setup: { db: 'fail' } },
  { id: 'nothing-found', setup: {} },
  { id: 'bad-id', setup: {}, badId: true }
];
const contractModule = () => require(path.join(HERE, 'lib', 'testing-contract.js'));

/** lib/testing-contract.js as a unit: the words of a refusal and of a fault, as the board always said them */
function checkWords() {
  console.log('\n-- lib/testing-contract.js: the board refusals as a unit --');
  const words = contractModule();
  const fault = words.faultOf(new Error(SECRET_SQL), { id: 'r1' }, 'Could not read the runs');
  check('faultOf: a 500 INTERNAL that says nothing of its cause, the screen\'s label kept', fault.status === 500 && fault.code === 'INTERNAL' && sameValue(fault.legacy, { error: 'Could not read the runs', message: 'Something went wrong — please try again.' }) && !JSON.stringify(fault).includes('vault'), fault);
  const bare = words.bareFaultOf(new Error(SECRET_SQL), { id: 'r1' }, 'Failed to list changes');
  check('bareFaultOf: the two reads that never carried a message keep only their label', bare.status === 500 && sameValue(bare.legacy, { error: 'Failed to list changes' }) && !JSON.stringify(bare).includes('vault'), bare);
  const bad = words.badRequest('Nothing to import', 'Send { cases: [...] }.');
  check('badRequest: the old two keys, the code TESTING_BAD_REQUEST, the sentence as the detail', sameValue(bad.legacy, { error: 'Nothing to import', message: 'Send { cases: [...] }.' }) && bad.code === 'TESTING_BAD_REQUEST' && bad.detail === 'Send { cases: [...] }.', bad);
  const writer = words.notBoardWriter();
  check('notBoardWriter: error, code and message in the order they were sent', sameValue(Object.keys(writer.legacy), ['error', 'code', 'message']) && writer.code === 'NOT_BOARD_WRITER', writer);
  const schema = words.schemaOptions.legacy([{ detail: 'summary must be a string.' }]);
  check('schemaOptions: a body the schema refuses is answered 400 in the board\'s own two keys', words.schemaOptions.status === 400 && sameValue(schema, { error: 'Bad request', message: 'summary must be a string.' }), schema);
}

/** every code the words answer under is a row of docs/ERROR-CODES.md with its sentence written */
function checkCodesRegistered() {
  console.log('\n-- the codes the board routes answer under are in the register --');
  const words = contractModule();
  const codes = words.CODES;
  const known = new Set(JSON.parse(fs.readFileSync(REGISTER_FILE, 'utf8')).codes.filter((row) => row.shopkeeper !== 'PENDING').map((row) => row.code));
  const missing = codes.filter((code) => !known.has(code));
  check('every code the board words answer under (' + codes.length + ' codes) is a register row with its sentence written', missing.length === 0, missing);
}

/** the contract in front of the router: every route has a row, and a row has a route; the report door declares its media type, the vocabulary asks for no sign-in */
function checkContractShape(routes) {
  console.log('\n-- the contract and the router agree --');
  const contract = contractModule();
  const operations = Object.keys(contract.OPERATIONS);
  check('every route the router holds has an operation, and every operation a route (' + operations.length + ')', sameValue(operations.slice().sort(), Object.keys(routes).sort()), operations.filter((key) => !routes[key]));
  const vocabulary = contract.OPERATIONS['GET /api/testing/vocabulary'];
  check('the vocabulary asks for no credentials: no security, no 401', sameValue(vocabulary.security, []) && !('401' in vocabulary.responses), Object.keys(vocabulary.responses));
  const feature = contract.OPERATIONS['GET /api/testing/cases/gherkin'].responses['200'].content;
  check('the feature file is declared as text, not JSON', Object.keys(feature)[0] === 'text/plain', Object.keys(feature));
  const junit = contract.OPERATIONS['POST /api/testing/results/junit'].requestBody.content['application/json'].schema;
  check('the JUnit report is declared as the XML text it is, in a body that stays JSON { xml }', junit.properties.xml.contentMediaType === 'application/xml' && !('type' in junit.properties.xml), junit.properties.xml);
  check('a body keeps its named fields and requires none (the handlers answer a missing one in their own words)', Object.values(contract.OPERATIONS).filter((one) => one.requestBody).every((one) => !(one.requestBody.content['application/json'].schema.required || []).length));
}

/** the "signed in as another shop" world: three routes with a record addressed by an id in the path (API-STANDARD S35) */
async function foreignWorld(port) {
  console.log('\n-- the 9th world: signed in as another shop --');
  const T = MOUNT;
  const mineOnly = (rows) => (sql, params) => (params && params[0] === OWNER.identity_id ? rows(sql, params) : null);
  const record = answering(/COALESCE\(\$3, d\.current_version\)/, [{ name: 'CAP-SIGNIN', current_version: 1, version: 1, rules: { title: 'Sign in' }, created_at: '2026-10-01T00:00:00Z' }]);
  const spec = answering(/d\.kind = 'spec' AND d\.definition_id/, [{ definition_id: PARTY, name: 'CLAUSE-1', created_by: OWNER.identity_id, current_version: 1, rules: { priority: 'Medium', state: 'raised', history: [] } }]);
  const incident = answering(/d\.kind = 'incident' AND d\.definition_id/, [{ definition_id: PARTY, name: 'INC-1', created_by: OWNER.identity_id, current_version: 1, rules: { severity: 'Sev-3', state: 'raised', history: [] } }]);
  const asks = [
    ['GET /api/testing/cmdb/:ci', 'GET', T + '/cmdb/CAP-SIGNIN', undefined, record],
    ['PATCH /api/testing/requirements/:id', 'PATCH', T + '/requirements/' + PARTY, { state: 'accepted' }, spec],
    ['PATCH /api/testing/incidents/:id', 'PATCH', T + '/incidents/' + PARTY, { state: 'investigating' }, incident]
  ];
  const cases = asks.map(([route, method, url, body, rows]) => ({
    route,
    play: async (who, planted) => {
      Object.assign(lab.world, { realAuth: false, db: 'ok', who: who === 'owner' ? OWNER : STRANGER, sqlRows: planted ? mineOnly(rows) : null });
      return lab.send(port, method, url, body);
    }
  }));
  const seen = foreign.recorder();
  const failures = await foreign.runCases(cases, seen.record);
  failures.forEach((sentence) => check('foreign id: ' + sentence, false));
  asks.forEach(([route]) => check(route + ': another shop\'s id answers exactly as an unknown id (404, same body); the owner\'s own id is not a 404', !failures.some((one) => one.startsWith(route))));
  return seen.proved();
}

process.on('unhandledRejection', (failure) => console.log('  (unhandled rejection: ' + String(failure && failure.message).slice(0, 80) + ')'));
(async () => {
  if (lab.flagValue('--freeze')) return lab.freeze(lab.flagValue('--freeze'));
  lab.installStubs();
  const router = require(path.join(HERE, 'routes', 'testing.js'));
  const routes = lab.routesOf(router, MOUNT);
  const server = lab.appOf([{ mount: MOUNT, router }]).listen(0);
  const recording = {};
  const capturing = lab.flagValue('--capture') || lab.flagValue('--compare');
  const allowed = capturing ? () => [] : contractModule().allowedStatuses();
  const scenarios = lab.scenariosOf(routes, WORLDS, scenes.extras(tools), { ci: 'CAP-SIGNIN' });
  const tested = await lab.checkRoutes(server.address().port, scenarios, recording, allowed, sources);
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
  checkContractShape(routes);
  const proved = await foreignWorld(server.address().port);
  server.close();
  const legacy = JSON.parse(fs.readFileSync(lab.legacyFile, 'utf8')).routes;
  const frozen = Object.keys(legacy).filter(lab.mine).reduce((sum, route) => sum + legacy[route].answers.length, 0);
  check('every refusal recorded before the sweep is replayed against the code: ' + frozen + ' answers, each once, byte for byte', frozen > 60, frozen);
  check('a caller who is not signed in is refused with 401 on every route that asks for sign-in', Object.keys(recording).filter((key) => key.endsWith('|signed-out')).every((key) => recording[key].status === 401 || /vocabulary/.test(key)));
  check('a 500 never says its cause: no answer of any route carries the database text', Object.values(recording).filter((one) => one.status >= 500).every((one) => !/SELECT|vault|relation "/.test(JSON.stringify(one.body || {})))); /* 5xx only, as tests/lib/problem-world.cjs: a 200 may list a module whose header names the vault (GET /engine) */
  const coverage = lab.coverageOf(tested);
  const onDisk = JSON.parse(fs.readFileSync(TESTED_FILE, 'utf8'));
  const mine = Object.fromEntries(Object.keys(onDisk).filter(lab.mine).sort().map((route) => [route, onDisk[route]]));
  if (lab.argv.includes('--write')) {
    const others = Object.fromEntries(Object.keys(onDisk).filter((route) => !lab.mine(route)).map((route) => [route, onDisk[route]]));
    const merged = Object.assign(others, coverage);
    fs.writeFileSync(TESTED_FILE, JSON.stringify(Object.fromEntries(Object.keys(merged).sort().map((route) => [route, merged[route]])), null, 1) + '\n');
    foreign.writeEvidence(EVIDENCE_FILE, lab.mine, proved);
  } else {
    check('docs/contracts/api-error-tests.json lists exactly the statuses these scenarios cover for routes/testing.js', sameValue(mine, coverage), { onDisk: Object.keys(mine).length, covered: Object.keys(coverage).length });
    check('docs/contracts/api-hardening-evidence-areas.json says exactly what the foreign-id world showed', sameValue(foreign.evidenceOf(EVIDENCE_FILE, lab.mine), proved), proved);
  }
  console.log('\n  ' + lab.count.passed + ' checks, ' + lab.count.failed + ' failed');
  process.exit(lab.count.failed ? 1 : 0);
})();
