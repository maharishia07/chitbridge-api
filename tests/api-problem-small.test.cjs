#!/usr/bin/env node
// @type: contract
/**
 * api-problem-small.test.cjs — API-4 sweep for two small routers that had none: every answer of routes/adopt.js (2 routes) and routes/people.js (1 route).
 *
 * OWNS      the proof that each refusal of the adoption doors and the people list is a Problem body AND keeps the keys it answered before (docs/contracts/api-legacy.json, frozen
 *           at this sweep's first run: Lane B2, 4 Nov 2026), that no answer says a failure's cause, this file's rows of docs/contracts/api-error-tests.json (the statuses each
 *           route is tested for, which the register's error_tests column reads), and that no answer is outside the statuses the contracts declare
 *           (lib/adopt-contract.js · lib/people-contract.js). The handler-made refusals the generic worlds cannot reach are the named extras below.
 * CALLED BY scripts/guards.cjs · CI. No database, no network: the real route files over a stand-in db and auth (tests/lib/problem-world.cjs).
 * FLOW      route list (read from each router) x world (signed out, staff, a bad id, a failing db, nothing found) + the named extras → real route → body →
 *           Problem fields present · frozen legacy keys equal · no leak on a 5xx · statuses tested → manifest
 * CARD      03-catalogue/adopt
 *
 *   node tests/api-problem-small.test.cjs                    check
 *   node tests/api-problem-small.test.cjs --write            rewrite this file's rows of docs/contracts/api-error-tests.json
 *   node tests/api-problem-small.test.cjs --capture F        record each answer to file F
 *   node tests/api-problem-small.test.cjs --freeze F         merge a capture F into docs/contracts/api-legacy.json (the frozen answers)
 */
'use strict';
const path = require('path');
const fs = require('fs');
const { harness, STAFF, SECRET_SQL, sameValue } = require('./lib/problem-world.cjs');

const HERE = path.join(__dirname, '..');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
const MOUNTS = [
  { mount: '/api/adopt', file: 'routes/adopt.js', contract: 'lib/adopt-contract.js' },
  { mount: '/api/people', file: 'routes/people.js', contract: 'lib/people-contract.js' }
];
const TESTED_FILE = path.join(HERE, 'docs', 'contracts', 'api-error-tests.json');
const REGISTER_FILE = path.join(HERE, 'docs', 'error-codes.json');
const CHIT = '33333333-3333-4333-8333-333333333333';
const lab = harness({
  here: HERE,
  mounts: MOUNTS.map((one) => one.mount),
  routeFiles: Object.fromEntries(MOUNTS.map((one) => [one.mount, one.file])),
  legacyFile: path.join(HERE, 'docs', 'contracts', 'api-legacy.json'),
  inherited: (scenario, answer) => answer.status === 401 && scenario.id === 'signed-out',
  notFrozen: (one, scenario) => one.status === 401 && scenario === 'signed-out'
});
const { check } = lab;
const WORLDS = [
  { id: 'signed-out', setup: { realAuth: true } },
  { id: 'staff-asks', setup: { who: STAFF } },
  { id: 'bad-id', setup: {}, badId: true },
  { id: 'db-fails', setup: { db: 'fail' } },
  { id: 'nothing-found', setup: {} }
];
const X = (id, route, status, extra) => Object.assign({ id, route, expect: status, setup: {} }, extra);
const ACCEPT = { accept: [{ line: 0, name: 'Tea 250g', sku: 'TEA-250' }] };
/** the extras: a refusal inside a handler the generic worlds cannot reach (they send an empty body, which is itself the handler's 400) */
const EXTRAS = [
  X('delivery-unknown', 'POST /api/adopt/:chit_id', 404, { url: '/api/adopt/' + CHIT, body: ACCEPT }),
  X('db-fails-with-lines', 'POST /api/adopt/:chit_id', 500, { url: '/api/adopt/' + CHIT, body: ACCEPT, setup: { db: 'fail' } }),
  X('no-lines-given-as-a-list', 'POST /api/adopt/:chit_id', 400, { url: '/api/adopt/' + CHIT, body: [] }),
  X('page-given-twice', 'GET /api/people', 422, { url: '/api/people?page=1&page=2' }),
  X('for-given-twice', 'GET /api/people', 422, { url: '/api/people?for=add&for=add' }),
  X('db-fails-for-people', 'GET /api/people', 500, { setup: { db: 'fail' } })
];
const contractOf = (one) => require(path.join(HERE, one.contract)).contract;

/** the contracts as units: every route has an operation and every operation a route; every refusal an operation declares is a Problem; the words never carry a cause */
function checkContracts(routes) {
  console.log('\n-- the contracts and the routers agree --');
  const operations = MOUNTS.flatMap((one) => Object.keys(contractOf(one).OPERATIONS));
  check('every route the routers hold has an operation, and every operation a route (' + operations.length + ')', sameValue(operations.slice().sort(), Object.keys(routes).sort()), operations.filter((key) => !routes[key]));
  const refusalsAreProblems = MOUNTS.every((one) => Object.values(contractOf(one).OPERATIONS).every((operation) => Object.keys(operation.responses).filter((status) => Number(status) >= 400).every((status) => JSON.stringify(operation.responses[status]).includes('Problem'))));
  check('every refusal an operation declares is a Problem', refusalsAreProblems);
  const { words, failed } = require(path.join(HERE, 'lib', 'adopt-contract.js'));
  const lost = failed(new Error(SECRET_SQL), { id: 'r1' }, 'Could not adopt');
  check('adopt failed(): the screen label and the safe sentence, never the cause', lost.status === 500 && lost.legacy.error === 'Could not adopt' && !JSON.stringify(lost).includes('vault'), lost);
  check('adopt words.notFound: the old one key { error: "Not found" } under the Problem fields', sameValue(Object.keys(words.notFound().legacy), ['error']) && words.notFound().legacy.error === 'Not found', words.notFound());
  const people = require(path.join(HERE, 'lib', 'people-contract.js')).failed(new Error(SECRET_SQL), { id: 'r1' });
  check('people failed(): the old { error, message } and no cause', people.status === 500 && people.legacy.error === 'Failed to list people' && !JSON.stringify(people).includes('vault'), people);
}

/** every code the answers carry is a register row with its sentence written */
function checkCodesRegistered(recording) {
  console.log('\n-- the codes these routes answer under are in the register --');
  const known = new Set(JSON.parse(fs.readFileSync(REGISTER_FILE, 'utf8')).codes.filter((row) => row.shopkeeper !== 'PENDING').map((row) => row.code));
  const seen = [...new Set(Object.values(recording).filter((one) => one.status >= 400 && one.body && one.body.code).map((one) => one.body.code))].sort();
  const missing = seen.filter((code) => !known.has(code));
  check('every code seen in a refusal (' + seen.length + ': ' + seen.join(' ') + ') is a register row with its sentence written', seen.length > 0 && missing.length === 0, missing);
}

(async () => {
  if (lab.flagValue('--freeze')) return lab.freeze(lab.flagValue('--freeze'));
  lab.installStubs();
  const mounted = MOUNTS.map((one) => ({ mount: one.mount, router: require(path.join(HERE, one.file)) }));
  const routes = Object.assign({}, ...mounted.map((one) => lab.routesOf(one.router, one.mount)));
  const server = lab.appOf(mounted).listen(0);
  const recording = {};
  const capturing = lab.flagValue('--capture');
  const allowedBy = Object.assign({}, ...MOUNTS.map((one) => Object.fromEntries(Object.keys(contractOf(one).OPERATIONS).map((key) => [key, contractOf(one).allowedStatuses()(key)]))));
  const allowed = capturing ? () => [] : (route) => allowedBy[route] || [];
  const scenarios = lab.scenariosOf(routes, WORLDS, EXTRAS, { chit_id: CHIT });
  const tested = await lab.checkRoutes(server.address().port, scenarios, recording, allowed, () => ({}));
  server.close();
  if (capturing) {
    fs.writeFileSync(capturing, JSON.stringify(recording, null, 1));
    console.log('captured ' + Object.keys(recording).length + ' answers over ' + Object.keys(routes).length + ' routes');
    process.exit(0);
  }
  checkContracts(routes);
  checkCodesRegistered(recording);
  check('a caller who is not signed in is refused with 401 on every route', Object.keys(recording).filter((key) => key.endsWith('|signed-out')).every((key) => recording[key].status === 401));
  const coverage = lab.coverageOf(tested);
  const onDisk = JSON.parse(fs.readFileSync(TESTED_FILE, 'utf8'));
  const mine = Object.fromEntries(Object.keys(onDisk).filter(lab.mine).sort().map((route) => [route, onDisk[route]]));
  if (lab.argv.includes('--write')) {
    const others = Object.fromEntries(Object.keys(onDisk).filter((route) => !lab.mine(route)).map((route) => [route, onDisk[route]]));
    const merged = Object.assign(others, coverage);
    fs.writeFileSync(TESTED_FILE, JSON.stringify(Object.fromEntries(Object.keys(merged).sort().map((route) => [route, merged[route]])), null, 1) + '\n');
  } else check('docs/contracts/api-error-tests.json lists exactly the statuses these scenarios cover for routes/adopt.js and routes/people.js', sameValue(mine, coverage), { onDisk: mine, covered: coverage });
  console.log('\n  ' + lab.count.passed + ' checks, ' + lab.count.failed + ' failed');
  process.exit(lab.count.failed ? 1 : 0);
})().catch((failure) => {
  console.log('  FAIL  the test itself failed: ' + (failure && failure.stack ? failure.stack.split('\n').slice(0, 3).join(' | ') : failure));
  process.exit(1);
});
