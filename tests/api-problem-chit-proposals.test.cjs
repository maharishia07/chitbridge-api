#!/usr/bin/env node
// @type: contract
/**
 * api-problem-chit-proposals.test.cjs — API-4 sweep, the proposal doors: every answer of routes/chit-proposals.js (5 routes: list · propose · accept · reject · counter).
 *
 * OWNS      the proof that each refusal of the proposal doors is a Problem body that keeps its legacy keys (docs/contracts/api-legacy.json, frozen at the doors' first contract, 25 Oct 2026:
 *           the doors are new and no screen calls them yet), that no success answer is a Problem, that no answer of any status carries a failure's cause, this file's rows of
 *           docs/contracts/api-error-tests.json (the statuses each route is tested for, which the register's error_tests column reads), and the "signed in as another shop" world:
 *           a chit addressed by an id in the path answers another shop's id exactly as an unknown id (API-STANDARD S35, tests/lib/foreign-id-world.cjs), recorded in
 *           docs/contracts/api-hardening-evidence-areas.json. Also: no answer outside the statuses the contract declares (lib/chit-proposals-contract.js), its shape as a unit
 *           (every body closed, every success answer closed), and every code a refusal carries is a register row with its sentence written.
 * CALLED BY scripts/guards.cjs · CI. No database, no network: the real route file over a stand-in db and auth (tests/lib/problem-world.cjs, scenes in tests/lib/chit-proposals-scenes.cjs).
 * FLOW      route list (read from the router itself) x world (signed out, a viewer, staff, a bad id, a failing db, nothing set up) + the named extras → real route → body →
 *           Problem fields present · frozen legacy keys equal · no leak on any status · statuses tested → manifest; then the foreign-id world
 * CARD      01-rail-core-the-chit/chit-proposal
 *
 *   node tests/api-problem-chit-proposals.test.cjs                    check
 *   node tests/api-problem-chit-proposals.test.cjs --write            rewrite this file's rows of docs/contracts/api-error-tests.json and api-hardening-evidence-areas.json
 *   node tests/api-problem-chit-proposals.test.cjs --capture F        record each answer to file F
 *   node tests/api-problem-chit-proposals.test.cjs --freeze F         merge a capture F into docs/contracts/api-legacy.json (the frozen answers)
 *   node tests/api-problem-chit-proposals.test.cjs --compare F        the answers now against a capture F: byte for byte for a success, the old keys in order for a refusal
 */
'use strict';
const path = require('path');
const fs = require('fs');
const { harness, OWNER, STAFF, SECRET_SQL, sameValue, answering, firstOf } = require('./lib/problem-world.cjs');
const scenes = require('./lib/chit-proposals-scenes.cjs');
const foreign = require('./lib/foreign-id-world.cjs');

const HERE = path.join(__dirname, '..');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
const MOUNT = '/api/chits';
const ROUTE_FILE = 'routes/chit-proposals.js';
const OTHER_SHOP = '99999999-9999-4999-8999-999999999999';
const STRANGER = { identity_id: OTHER_SHOP, identity_type: 'entity', display_name: 'Other shop' };
const TESTED_FILE = path.join(HERE, 'docs', 'contracts', 'api-error-tests.json');
const EVIDENCE_FILE = path.join(HERE, 'docs', 'contracts', 'api-hardening-evidence-areas.json');
const REGISTER_FILE = path.join(HERE, 'docs', 'error-codes.json');
const tools = { OWNER, STAFF, SECRET_SQL, answering, firstOf };
/** the statuses a round of a word reads: the ones the generic worlds reach by themselves */
const lab = harness({
  here: HERE,
  mounts: [MOUNT],
  routeFiles: { [MOUNT]: ROUTE_FILE },
  owns: (route) => /^(GET|POST) \/api\/chits\/:chit_id\/proposals(\/|$)/.test(route),
  legacyFile: path.join(HERE, 'docs', 'contracts', 'api-legacy.json'),
  inherited: (scenario, answer) => answer.status === 401 && scenario.id === 'signed-out',
  notFrozen: (one, scenario) => one.status === 401 && scenario === 'signed-out',
  /* what one scenario learned about the schema, or the address book, is not known to the next */
  before: () => {
    require(path.join(HERE, 'lib', 'schema'))._reset();
    require(path.join(HERE, 'lib', 'ctpaddress')).invalidate();
  }
});
const { check } = lab;
const sources = () => ({ proposal: require(path.join(HERE, 'lib', 'chit-proposal')) });
const VIEWER = Object.assign({}, STAFF, { access_level: 'viewer' });
const WORLDS = [
  { id: 'signed-out', setup: { realAuth: true } },
  { id: 'viewer-asks', setup: { who: VIEWER } },
  { id: 'staff-asks', setup: { who: STAFF } },
  { id: 'db-fails', setup: { db: 'fail' } },
  { id: 'nothing-set-up', setup: {} },
  { id: 'bad-id', setup: {}, badId: true }
];
const contractModule = () => require(path.join(HERE, 'lib', 'chit-proposals-contract.js'));

/** lib/chit-proposals-contract.js as a unit: every door has an operation, every body is closed, every success answer is closed, the library's refusals are published */
function checkContractShape(routes) {
  console.log('\n-- the contract and the router agree --');
  const contract = contractModule();
  const operations = Object.keys(contract.OPERATIONS);
  check('every route the router holds has an operation, and every operation a route (' + operations.length + ')', sameValue(operations.slice().sort(), Object.keys(routes).sort()), operations.filter((key) => !routes[key]));
  const bodies = operations.filter((key) => contract.OPERATIONS[key].requestBody).map((key) => contract.OPERATIONS[key].requestBody.content['application/json'].schema);
  check('every body is an allow-list: additionalProperties false on the 4 write doors (S33)', bodies.length === 4 && bodies.every((schema) => schema.additionalProperties === false), bodies.map((schema) => schema.additionalProperties));
  const answers = operations.map((key) => contract.OPERATIONS[key].responses['200'].content['application/json'].schema);
  check('every success answer is an allow-list: additionalProperties false on all 5 doors (S34)', answers.every((schema) => schema && schema.additionalProperties === false), answers.map((schema) => schema && schema.additionalProperties));
  const published = contract.OPERATIONS['POST /api/chits/:chit_id/proposals']['x-chit-proposals-refusals'] || [];
  check('the refusals the library means are published on each write door (x-chit-proposals-refusals), with code, status and when', published.length === contract.LIBRARY_REFUSALS.length && published.every((one) => one.code && one.status && one.when), published.length);
  const level = operations.every((key) => '403' in contract.OPERATIONS[key].responses);
  check('every door declares the level gate (403) and sign-in (401)', level && operations.every((key) => '401' in contract.OPERATIONS[key].responses));
}

/** every code the doors answer under is a register row with its sentence written */
function checkCodesRegistered(recording) {
  console.log('\n-- the codes the proposal doors answer under are in the register --');
  const known = new Set(JSON.parse(fs.readFileSync(REGISTER_FILE, 'utf8')).codes.filter((row) => row.shopkeeper !== 'PENDING').map((row) => row.code));
  const seen = [...new Set(Object.values(recording).filter((one) => one.status >= 400 && one.body && one.body.code).map((one) => one.body.code))].sort();
  const missing = seen.filter((code) => !known.has(code));
  check('every code seen in a refusal (' + seen.length + ': ' + seen.join(' ') + ') is a register row with its sentence written', seen.length > 0 && missing.length === 0, missing);
  const library = contractModule().LIBRARY_REFUSALS.map((one) => one.code).filter((code) => !known.has(code));
  check('every code the contract publishes for the library is a register row', library.length === 0, library);
}

/** a 2xx is never a Problem, and no answer of any status carries the database text (the stand-in throws it; R2-3 a) */
function checkAnswers(recording) {
  console.log('\n-- the answers themselves --');
  const successes = Object.keys(recording).filter((key) => recording[key].status < 300);
  check('every success answer is plain JSON, never a Problem (' + successes.length + ' seen)', successes.length >= 4 && successes.every((key) => !/problem\+json/.test(recording[key].type) && !(recording[key].body && recording[key].body.type)), successes.filter((key) => /problem/.test(recording[key].type)));
  check('no answer of any status carries the database text', Object.values(recording).every((one) => !JSON.stringify(one.body || {}).includes('vault') && !/vault/.test(one.text || '')));
  const notSetUp = recording['POST /api/chits/:chit_id/proposals|nothing-set-up'];
  check('an installation without the table refuses a round in words: 503 PROPOSAL_NOT_SETUP', !!notSetUp && notSetUp.status === 503 && notSetUp.body.code === 'PROPOSAL_NOT_SETUP', notSetUp && notSetUp.body);
  const unknownKey = recording['POST /api/chits/:chit_id/proposals|propose-unknown-key-refused'];
  check('a key the library never reads is refused by name, never dropped (S33)', !!unknownKey && unknownKey.status === 422 && (unknownKey.body.errors || []).some((one) => one.field === 'price_total'), unknownKey && unknownKey.body);
  const viewer = recording['POST /api/chits/:chit_id/proposals/:proposal_id/accept|viewer-asks'];
  check('a viewer is refused by the level gate before anything is read: 403 CHIT_NOT_PERMITTED with the rail word', !!viewer && viewer.status === 403 && viewer.body.code === 'CHIT_NOT_PERMITTED' && viewer.body.why === 'read_only', viewer && viewer.body);
}

/** the "signed in as another shop" world: every door names a chit by an id in its path (API-STANDARD S35) */
async function foreignWorld(port) {
  console.log('\n-- the 9th world: signed in as another shop --');
  const planted = (owner) => scenes.copyRows(owner, { proposals: [scenes.round(scenes.ROUND_A)] });
  const at = (tail) => MOUNT + '/' + scenes.PARTY + '/proposals' + tail;
  const asks = [
    ['GET /api/chits/:chit_id/proposals', 'GET', at(''), undefined],
    ['POST /api/chits/:chit_id/proposals', 'POST', at(''), { note: 'please' }],
    ['POST /api/chits/:chit_id/proposals/:proposal_id/accept', 'POST', at('/' + scenes.ROUND_A + '/accept'), {}],
    ['POST /api/chits/:chit_id/proposals/:proposal_id/reject', 'POST', at('/' + scenes.ROUND_A + '/reject'), {}],
    ['POST /api/chits/:chit_id/proposals/:proposal_id/counter', 'POST', at('/' + scenes.ROUND_A + '/counter'), { note: 'less' }]
  ];
  const cases = asks.map(([route, method, url, body]) => ({
    route,
    play: async (who, plantedRows) => {
      Object.assign(lab.world, { realAuth: false, db: 'ok', who: who === 'owner' ? OWNER : STRANGER, sqlRows: plantedRows ? planted(OWNER.identity_id) : scenes.migrated });
      require(path.join(HERE, 'lib', 'schema'))._reset();
      return lab.send(port, method, url, body);
    }
  }));
  const seen = foreign.recorder();
  const failures = await foreign.runCases(cases, seen.record);
  failures.forEach((sentence) => check('foreign id: ' + sentence, false));
  asks.forEach(([route]) => check(route + ": another shop's id answers exactly as an unknown id (404, same body); the owner's own id is not a 404", !failures.some((one) => one.startsWith(route))));
  return seen.proved();
}

(async () => {
  if (lab.flagValue('--freeze')) return lab.freeze(lab.flagValue('--freeze'));
  lab.installStubs();
  const router = require(path.join(HERE, ROUTE_FILE));
  const routes = lab.routesOf(router, MOUNT);
  const server = lab.appOf([{ mount: MOUNT, router }]).listen(0);
  const recording = {};
  const capturing = lab.flagValue('--capture') || lab.flagValue('--compare');
  const allowed = capturing ? () => [] : contractModule().allowedStatuses();
  const scenarios = lab.scenariosOf(routes, WORLDS, scenes.extras(tools), { chit_id: scenes.PARTY, proposal_id: scenes.ROUND_A });
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
  checkContractShape(routes);
  checkCodesRegistered(recording);
  checkAnswers(recording);
  const proved = await foreignWorld(server.address().port);
  server.close();
  const legacy = JSON.parse(fs.readFileSync(lab.legacyFile, 'utf8')).routes;
  const frozen = Object.keys(legacy).filter(lab.mine).reduce((sum, route) => sum + legacy[route].answers.length, 0);
  check('every refusal frozen at the first contract is replayed against the code: ' + frozen + ' answers, each once, byte for byte', frozen > 30, frozen);
  check('a caller who is not signed in is refused with 401 on every door', Object.keys(recording).filter((key) => key.endsWith('|signed-out')).every((key) => recording[key].status === 401));
  const coverage = lab.coverageOf(tested);
  const onDisk = JSON.parse(fs.readFileSync(TESTED_FILE, 'utf8'));
  const mine = Object.fromEntries(Object.keys(onDisk).filter(lab.mine).sort().map((route) => [route, onDisk[route]]));
  if (lab.argv.includes('--write')) {
    const others = Object.fromEntries(Object.keys(onDisk).filter((route) => !lab.mine(route)).map((route) => [route, onDisk[route]]));
    const merged = Object.assign(others, coverage);
    fs.writeFileSync(TESTED_FILE, JSON.stringify(Object.fromEntries(Object.keys(merged).sort().map((route) => [route, merged[route]])), null, 1) + '\n');
    foreign.writeEvidence(EVIDENCE_FILE, lab.mine, proved);
  } else {
    check('docs/contracts/api-error-tests.json lists exactly the statuses these scenarios cover for routes/chit-proposals.js', sameValue(mine, coverage), { onDisk: mine, covered: coverage });
    check('docs/contracts/api-hardening-evidence-areas.json says exactly what the foreign-id world showed', sameValue(foreign.evidenceOf(EVIDENCE_FILE, lab.mine), proved), proved);
  }
  console.log('\n  ' + lab.count.passed + ' checks, ' + lab.count.failed + ' failed');
  process.exit(lab.count.failed ? 1 : 0);
})().catch((failure) => {
  console.log('  FAIL  the test itself failed: ' + (failure && failure.stack ? failure.stack.split('\n').slice(0, 3).join(' | ') : failure));
  process.exit(1);
});
