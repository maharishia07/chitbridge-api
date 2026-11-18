#!/usr/bin/env node
// @type: contract
/**
 * api-problem-chits-jobs.test.cjs — API sweep for the job opener: every answer of routes/chits-jobs.js (POST /api/chits/jobs/open).
 *
 * OWNS      the proof that each refusal of the opener is a Problem body, that no answer says a failure's cause, this route's row of docs/contracts/api-error-tests.json (the statuses it is tested for,
 *           which the register's error_tests column reads), that its success answers hold only the keys its closed schema lists (docs/contracts/api-hardening-evidence-areas.json, output_allowlist),
 *           and that no answer is outside the statuses lib/chits-jobs-contract.js declares.
 * CALLED BY scripts/guards.cjs · CI. No database, no network: the real routes/chits-jobs.js over a stand-in db and auth (tests/lib/problem-world.cjs); lib/jobs-open (the rail's send path) is answered by a stand-in,
 *           its own proof being tests/assign-register.test.cjs and tests/assign1.realstack.cjs.
 * FLOW      route x world (signed out, a key, staff, a failing db) + the named extras → real route → body → Problem fields present · no leak on a 5xx · statuses tested → manifest · success answers → allow-list evidence
 * CARD      01-rail-core-the-chit/assign
 *
 *   node tests/api-problem-chits-jobs.test.cjs            check
 *   node tests/api-problem-chits-jobs.test.cjs --write    rewrite this route's rows of docs/contracts/api-error-tests.json and api-hardening-evidence-areas.json
 *   node tests/api-problem-chits-jobs.test.cjs --capture F / --freeze F   record each answer / merge it into docs/contracts/api-legacy.json
 */
'use strict';
const path = require('path');
const fs = require('fs');
const { harness, OWNER, STAFF, SECRET_SQL, sameValue } = require('./lib/problem-world.cjs');
const allowlistWorld = require('./lib/allowlist-world.cjs');

const HERE = path.join(__dirname, '..');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
process.env.JOBS_OPEN_PER_MIN = '1'; /* each scene below asks as its own business; the one pair that shares a business meets the limiter */
const MOUNT = '/api/chits';
const FILE = 'routes/chits-jobs.js';
const ROUTE = 'POST /api/chits/jobs/open';
const TESTED_FILE = path.join(HERE, 'docs', 'contracts', 'api-error-tests.json');
const EVIDENCE_FILE = path.join(HERE, 'docs', 'contracts', 'api-hardening-evidence-areas.json');
const REGISTER_FILE = path.join(HERE, 'docs', 'error-codes.json');
const SUBJECT = '66666666-6666-4666-8666-666666666666';
const CHIT = '77777777-7777-4777-8777-777777777777';
const lab = harness({
  here: HERE,
  mounts: [MOUNT],
  routeFiles: { [MOUNT]: FILE },
  owns: (route) => route === ROUTE,
  before: async (scenario) => { if (scenario.before) scenario.before(); },
  legacyFile: path.join(HERE, 'docs', 'contracts', 'api-legacy.json'),
  inherited: (scenario, answer) => answer.status === 401 && scenario.id === 'signed-out',
  notFrozen: (one, scenario) => one.status === 401 && scenario === 'signed-out'
});
const { check } = lab;
const WORLDS = [
  { id: 'signed-out', setup: { realAuth: true } },
  { id: 'a-key-asks', setup: { asKey: true } },
  { id: 'staff-asks', setup: { who: STAFF } },
  { id: 'db-fails', setup: { db: 'fail' } }
];
/* the rail's opener, answered by the scene: lib/jobs-open is wrapped BEFORE the route file loads it */
const opener = require(path.join(HERE, 'lib', 'jobs-open.js'));
let openImpl = async () => { throw new Error('no stand-in set'); };
opener.openJobs = (...args) => openImpl(...args);
const answering = (answer) => () => { openImpl = async () => answer; };
const failing = (error) => () => { openImpl = async () => { throw error; }; };
/** a business of its own per scene (the limiter keys on it) */
const firm = (n) => Object.assign({}, OWNER, { identity_id: '1111111' + n + '-1111-4111-8111-111111111111' });
const GOOD = { plug: 'client', role: 'adviser', period: 'standing', subject_ids: [SUBJECT] };
const OPENED = { opened: 1, existing: 0, assigned: 0, skipped: [], jobs: [{ subject_id: SUBJECT, chit_id: CHIT, outcome: 'opened' }] };
const MIXED = { opened: 0, existing: 1, assigned: 0, skipped: [{ subject_id: CHIT, code: 'JOB_CLIENT_NOT_YOURS', reason: 'This business is not one of your clients, or the link between you has ended.' }], jobs: [{ subject_id: SUBJECT, chit_id: CHIT, outcome: 'existing' }] };
const X = (id, status, who, body, before) => ({ id, route: ROUTE, expect: status, setup: { who }, body, before });

const EXTRAS = [
  X('open-made', 200, firm(1), GOOD, answering(OPENED)),
  X('open-mixed-with-skips-and-existing', 200, firm(2), GOOD, answering(MIXED)),
  X('open-by-a-filter', 200, firm(3), { plug: 'client', role: 'auditor', period: 'Q2 2026', filter: { list: 'practice', without_job: true } }, answering(OPENED)),
  X('open-too-many-clients-for-the-filter', 400, firm(4), { plug: 'client', role: 'adviser', period: 'standing', filter: { list: 'practice' } }, failing(Object.assign(new Error('That is more than 200 clients. Narrow the list.'), { status: 400, code: 'CHIT_TOO_MANY' }))),
  X('open-fails', 500, firm(5), GOOD, failing(new Error(SECRET_SQL))),
  X('open-asked-twice-in-a-minute-first', 200, firm(6), GOOD, answering(OPENED)),
  X('open-asked-twice-in-a-minute-second', 429, firm(6), GOOD, answering(OPENED)),
  X('open-no-body-fields', 422, firm(7), {}),
  X('open-extra-key', 422, firm(7), Object.assign({ holder: SUBJECT }, GOOD)),
  X('open-neither-list-nor-filter', 422, firm(7), { plug: 'client', role: 'adviser', period: 'standing' }),
  X('open-both-list-and-filter', 422, firm(7), Object.assign({ filter: { list: 'practice' } }, GOOD)),
  X('open-bad-subject-id', 422, firm(7), Object.assign({}, GOOD, { subject_ids: ['nope'] })),
  X('open-unknown-role', 422, firm(7), Object.assign({}, GOOD, { role: 'boss' })),
  X('open-blank-period', 422, firm(7), Object.assign({}, GOOD, { period: ' ' })),
  X('open-201-clients', 400, firm(8), Object.assign({}, GOOD, { subject_ids: Array.from({ length: 201 }, (_, n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0')) }), failing(Object.assign(new Error('That is more than 200 clients. Narrow the list.'), { status: 400, code: 'CHIT_TOO_MANY' }))),
  X('open-by-a-manager', 200, Object.assign({}, STAFF, { hat: 'manager', identity_id: '44444444-4444-4444-8444-444444444445', parent_entity_id: '12121212-1212-4212-8212-121212121212' }), GOOD, answering(OPENED))
];

/** the contract as a unit: the route has an operation and every refusal an operation declares is a Problem */
function checkContract(routes) {
  console.log('\n-- the contract and the router agree --');
  const contract = require(path.join(HERE, 'lib', 'chits-jobs-contract.js'));
  check('the one route the router holds has an operation, and the operation a route', sameValue(Object.keys(contract.OPERATIONS).sort(), Object.keys(routes).sort()), Object.keys(routes));
  check('every refusal the operation declares is a Problem', Object.values(contract.OPERATIONS).every((operation) => Object.keys(operation.responses).filter((status) => Number(status) >= 400).every((status) => JSON.stringify(operation.responses[status]).includes('problem'))));
}

/** every code the answers carry is a register row with its sentence written */
function checkCodesRegistered(recording) {
  console.log('\n-- the codes this route answers under are in the register --');
  const known = new Set(JSON.parse(fs.readFileSync(REGISTER_FILE, 'utf8')).codes.filter((row) => row.shopkeeper !== 'PENDING').map((row) => row.code));
  const seen = [...new Set(Object.values(recording).filter((one) => one.status >= 400 && one.body && one.body.code).map((one) => one.body.code))].sort();
  const missing = seen.filter((code) => !known.has(code));
  check('every code seen in a refusal (' + seen.length + ': ' + seen.join(' ') + ') is a register row with its sentence written', seen.length > 0 && missing.length === 0, missing);
}

(async () => {
  if (lab.flagValue('--freeze')) return lab.freeze(lab.flagValue('--freeze'));
  lab.installStubs();
  const router = require(path.join(HERE, FILE));
  const routes = lab.routesOf(router, MOUNT);
  const server = lab.appOf([{ mount: MOUNT, router }]).listen(0);
  const recording = {};
  const capturing = lab.flagValue('--capture');
  const contract = require(path.join(HERE, 'lib', 'chits-jobs-contract.js'));
  const allowedBy = Object.fromEntries(Object.keys(contract.OPERATIONS).map((key) => [key, contract.allowedStatuses()(key)]));
  const allowed = capturing ? () => [] : (route) => allowedBy[route] || [];
  const scenarios = lab.scenariosOf(routes, WORLDS, EXTRAS, {});
  const tested = await lab.checkRoutes(server.address().port, scenarios, recording, allowed, () => ({}));
  server.close();
  if (capturing) {
    fs.writeFileSync(capturing, JSON.stringify(recording, null, 1));
    console.log('captured ' + Object.keys(recording).length + ' answers over ' + Object.keys(routes).length + ' routes');
    process.exit(0);
  }
  checkContract(routes);
  checkCodesRegistered(recording);
  const at = (id) => recording[ROUTE + '|' + id];
  check('a caller who is not signed in is refused with 401', at('signed-out') && at('signed-out').status === 401);
  check('a key is refused 403 (the route is in no key scope)', at('a-key-asks') && at('a-key-asks').status === 403);
  check('a plain actor is refused 403 CHIT_NOT_PERMITTED and nothing is opened', at('staff-asks') && at('staff-asks').status === 403 && at('staff-asks').body.code === 'CHIT_NOT_PERMITTED');
  check('a manager is let in: 200', at('open-by-a-manager') && at('open-by-a-manager').status === 200);
  check('a filter that resolves to too many clients is 400 CHIT_TOO_MANY', at('open-too-many-clients-for-the-filter') && at('open-too-many-clients-for-the-filter').body.code === 'CHIT_TOO_MANY');
  check('the second call of a business inside a minute is 429 RATE_LIMITED', at('open-asked-twice-in-a-minute-second') && at('open-asked-twice-in-a-minute-second').body.code === 'RATE_LIMITED');
  check('a 422 names every failing field (no body fields: plug, role, period)', at('open-no-body-fields') && /plug/.test(JSON.stringify(at('open-no-body-fields').body)) && /period/.test(JSON.stringify(at('open-no-body-fields').body)));
  const proved = allowlistWorld.checkAllowList(recording, contract.OPERATIONS, check);
  const coverage = lab.coverageOf(tested);
  const onDisk = JSON.parse(fs.readFileSync(TESTED_FILE, 'utf8'));
  const mine = Object.fromEntries(Object.keys(onDisk).filter(lab.mine).sort().map((route) => [route, onDisk[route]]));
  if (lab.argv.includes('--write')) {
    const others = Object.fromEntries(Object.keys(onDisk).filter((route) => !lab.mine(route)).map((route) => [route, onDisk[route]]));
    const merged = Object.assign(others, coverage);
    fs.writeFileSync(TESTED_FILE, JSON.stringify(Object.fromEntries(Object.keys(merged).sort().map((route) => [route, merged[route]])), null, 1) + '\n');
    allowlistWorld.writeEvidence(EVIDENCE_FILE, lab.mine, proved);
  } else {
    check('docs/contracts/api-error-tests.json lists exactly the statuses these scenarios cover for ' + ROUTE, sameValue(mine, coverage), { onDisk: mine, covered: coverage });
    check('docs/contracts/api-hardening-evidence-areas.json says output_allowlist for exactly this route when its success answers held here', sameValue(allowlistWorld.evidenceOf(EVIDENCE_FILE, lab.mine), proved), { proved: Object.keys(proved) });
  }
  console.log('\n  ' + lab.count.passed + ' checks, ' + lab.count.failed + ' failed');
  process.exit(lab.count.failed ? 1 : 0);
})().catch((failure) => {
  console.log('  FAIL  the test itself failed: ' + (failure && failure.stack ? failure.stack.split('\n').slice(0, 3).join(' | ') : failure));
  process.exit(1);
});
