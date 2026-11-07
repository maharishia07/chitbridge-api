#!/usr/bin/env node
// @type: contract
/**
 * api-problem-signin.test.cjs — API-4 sweep for the sign-in doors: every answer of routes/signin.js (8 routes, mounted at /api/signin).
 *
 * OWNS      the proof that no route of the file answers outside the statuses its contract declares (lib/signin-contract.js; the three routes that read no input are listed here),
 *           that no 5xx says a failure's cause, that a NUL byte in a typed value is answered exactly as an unknown value is (S41: same status, same body, same keys),
 *           this file's rows of docs/contracts/api-error-tests.json (the statuses each route is tested for, which the register's error_tests column reads) and the contract's words as units.
 * CALLED BY scripts/guards.cjs · CI. No database, no network: the real routes/signin.js over a stand-in db and auth (tests/lib/problem-world.cjs, tests/lib/signin-scenes.cjs).
 * FLOW      route list (read from the router) x world (signed out, a key, a failing db, nothing found) + the named scenes → real route → body → status declared · no leak → manifest
 * CARD      18-identity-sign-in-and-access/sign-in
 * The bodies are NOT judged as Problem bodies and not frozen here: the doors keep their old words byte for byte (tests/signin-routes.test.cjs holds the golden recorded before the move),
 * and the one refusal an unknown account, a wrong secret and a lock share is SEC-81's. This test pins statuses, leaks and the junk-text rule.
 *
 *   node tests/api-problem-signin.test.cjs            check
 *   node tests/api-problem-signin.test.cjs --write    rewrite this file's rows of docs/contracts/api-error-tests.json
 */
'use strict';
const path = require('path');
const fs = require('fs');
const { harness, SECRET_SQL, sameValue } = require('./lib/problem-world.cjs');
const S = require('./lib/signin-scenes.cjs');

const HERE = path.join(__dirname, '..');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
const MOUNT = '/api/signin';
const TESTED_FILE = path.join(HERE, 'docs', 'contracts', 'api-error-tests.json');
/** the two routes that read no body, no query and no path value: no operation, so the refusals are the door's alone (the owner's 403, a fault 500). POST /logout has a closed empty body since API-47 (LOGOUT, below) */
const NO_INPUT = { 'GET /api/signin/sessions': [401, 403, 500], 'GET /api/signin/devices': [401, 403, 500] };
const LOGOUT = { 'POST /api/signin/logout': [400, 401, 403, 500] }; /* the one write with no field: an empty closed body, an unknown key is a 400 */
const lab = harness({
  here: HERE,
  mounts: [MOUNT],
  routeFiles: { [MOUNT]: 'routes/signin.js' },
  legacyFile: path.join(HERE, 'docs', 'contracts', 'api-legacy.json'),
  inherited: () => true /* the bodies are the doors' own words, kept byte for byte by tests/signin-routes.test.cjs: only the status is judged here */
});
const { check } = lab;
const WORLDS = [
  { id: 'signed-out', setup: { realAuth: true } },
  { id: 'key-asks', setup: { asKey: true } },
  { id: 'db-fails', setup: { db: 'fail' } },
  { id: 'nothing-found', setup: {} }
];
const contractModule = () => require(path.join(HERE, 'lib', 'signin-contract.js'));
const modules = () => ({ identityAuth: require(path.join(HERE, 'lib', 'identity-auth.js')) });

/** the contract and the router agree: every route that reads an input has an operation, and no operation is for a route the file does not hold */
function checkContract(routes) {
  console.log('\n-- the contract and the router agree --');
  const operations = Object.keys(contractModule().contract.OPERATIONS);
  const withInput = Object.keys(routes).filter((key) => !NO_INPUT[key]);
  check('every route that reads an input has an operation, and every operation a route (' + operations.length + ')', sameValue(operations.slice().sort(), withInput.sort()), { operations, withInput });
  check('the two routes that read no input have none (' + Object.keys(NO_INPUT).length + ')', Object.keys(NO_INPUT).every((key) => routes[key] && !operations.includes(key)));
  const problems = operations.every((key) => Object.keys(contractModule().contract.OPERATIONS[key].responses).filter((status) => Number(status) >= 400).every((status) => JSON.stringify(contractModule().contract.OPERATIONS[key].responses[status]).includes('Problem')));
  check('every refusal an operation declares is a Problem response', problems);
}

/** a typed value no database can hold is answered as an unknown one is: the same status and the same body, and the database was never asked */
function checkJunkAsUnknown(recording, scenes) {
  console.log('\n-- junk text answers exactly like an unknown value (S41) --');
  scenes.filter((one) => one.like).forEach((one) => {
    const junk = recording[one.route + '|' + one.id];
    const unknown = recording[one.route + '|' + one.like];
    check(one.id + ' answers like ' + one.like + ' (status ' + (unknown && unknown.status) + ', same body)', !!junk && !!unknown && junk.status === unknown.status && sameValue(junk.body, unknown.body), { junk: junk && [junk.status, junk.body], unknown: unknown && [unknown.status, unknown.body] });
  });
}

(async () => {
  lab.installStubs();
  const router = require(path.join(HERE, 'routes', 'signin.js'));
  const routes = lab.routesOf(router, MOUNT);
  const entities = require(path.join(HERE, 'routes', 'entities.js'));
  const registerRoutes = lab.routesOf(entities, '/api/entities'); /* the register door is entities.js's: only the named scenes run there */
  const server = lab.appOf([{ mount: MOUNT, router }, { mount: '/api/entities', router: entities }]).listen(0);
  const recording = {};
  const declared = contractModule().contract.allowedStatuses();
  const allowed = (route) => NO_INPUT[route] || LOGOUT[route] || (route.includes('/api/entities/') ? [400, 409, 500] : declared(route));
  const scenes = S.extras();
  const scenarios = lab.scenariosOf(routes, WORLDS, scenes.filter((one) => routes[one.route]), {}).concat(lab.scenariosOf(registerRoutes, [], scenes.filter((one) => registerRoutes[one.route]), {}));
  const tested = await lab.checkRoutes(server.address().port, scenarios, recording, allowed, modules);
  server.close();
  checkContract(routes);
  checkJunkAsUnknown(recording, scenes);
  check('a caller who is not signed in is refused with 401 on every route that asks for it', ['POST /api/signin/renew', 'POST /api/signin/logout', 'GET /api/signin/sessions', 'GET /api/signin/devices', 'POST /api/signin/sessions/revoke', 'POST /api/signin/pin'].every((key) => recording[key + '|signed-out'].status === 401));
  /* the shape, which the sweep above leaves to the doors (inherited): every refusal is a Problem naming its own status, with a code and the old error word beside it. The express-validator 400s of ask, verify and pin (middleware/validate.js validate; bodies frozen byte for byte by tests/signin-routes.test.cjs) are the one open gap: skipped here, not judged */
  const refusals = Object.entries(recording).filter(([, one]) => one.status >= 400 && one.body && !Array.isArray(one.body.details));
  const notProblems = refusals.filter(([, one]) => !(one.body.type && one.body.title && one.body.status === one.status && one.body.detail && one.body.code && one.body.error !== undefined));
  check('every refusal of every scene is a Problem that names its own status and carries a code and the old error word (' + refusals.length + ' answers, S1-S2)', notProblems.length === 0, notProblems.map(([name, one]) => name + ' ' + JSON.stringify(one.body).slice(0, 120)));
  check('no 5xx of any scene carries a failure\'s cause', Object.values(recording).filter((one) => one.status >= 500).every((one) => !JSON.stringify(one.body).includes(SECRET_SQL) && !/SELECT|vault|relation "/.test(JSON.stringify(one.body))));
  const coverage = Object.fromEntries(Object.entries(lab.coverageOf(tested)).filter(([route]) => lab.mine(route))); /* the register door's rows are entities.js's own sweep's */
  const onDisk = JSON.parse(fs.readFileSync(TESTED_FILE, 'utf8'));
  const mine = Object.fromEntries(Object.keys(onDisk).filter(lab.mine).sort().map((route) => [route, onDisk[route]]));
  if (lab.argv.includes('--write')) {
    const others = Object.fromEntries(Object.keys(onDisk).filter((route) => !lab.mine(route)).map((route) => [route, onDisk[route]]));
    const merged = Object.assign(others, coverage);
    fs.writeFileSync(TESTED_FILE, JSON.stringify(Object.fromEntries(Object.keys(merged).sort().map((route) => [route, merged[route]])), null, 1) + '\n');
  } else check('docs/contracts/api-error-tests.json lists exactly the statuses these scenarios cover for routes/signin.js', sameValue(mine, coverage), { onDisk: mine, covered: coverage });
  console.log('\n  ' + lab.count.passed + ' checks, ' + lab.count.failed + ' failed');
  process.exit(lab.count.failed ? 1 : 0);
})().catch((failure) => {
  console.log('  FAIL  the test itself failed: ' + (failure && failure.stack ? failure.stack.split('\n').slice(0, 3).join(' | ') : failure));
  process.exit(1);
});
