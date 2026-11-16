#!/usr/bin/env node
// @type: contract
/**
 * api-problem-books-grants.test.cjs — API-4 sweep for the member's grant routes of ACC-176: every answer of routes/books-grants.js (6 routes).
 *
 * OWNS      the proof that each refusal of the grant routes is a Problem body AND keeps the keys it answered in (docs/contracts/api-legacy.json, frozen at this sweep's first run),
 *           that no answer says a failure's cause, this file's rows of docs/contracts/api-error-tests.json (the statuses each route is tested for, which the register's error_tests
 *           column reads), that each route's success answers hold only the keys its closed schema lists (docs/contracts/api-hardening-evidence-areas.json, output_allowlist), and that
 *           no answer is outside the statuses lib/books-grants-contract.js declares.
 * CALLED BY scripts/guards.cjs · CI. No database, no network: the real routes/books-grants.js over a stand-in db and auth (tests/lib/problem-world.cjs).
 * FLOW      route list (read from the router) x world (signed out, a key, staff, a bad id, a failing db, nothing found) + the named extras → real route → body →
 *           Problem fields present · frozen legacy keys equal · no leak on a 5xx · statuses tested → manifest · success answers → allow-list evidence
 * CARD      04-network/ACC-176-AUDITOR-GRANT
 *
 *   node tests/api-problem-books-grants.test.cjs                    check
 *   node tests/api-problem-books-grants.test.cjs --write            rewrite this file's rows of docs/contracts/api-error-tests.json and api-hardening-evidence-areas.json
 *   node tests/api-problem-books-grants.test.cjs --capture F        record each answer to file F
 *   node tests/api-problem-books-grants.test.cjs --freeze F         merge a capture F into docs/contracts/api-legacy.json (the frozen answers)
 */
'use strict';
const path = require('path');
const fs = require('fs');
const { harness, STAFF, SECRET_SQL, sameValue, answering, raising, firstOf } = require('./lib/problem-world.cjs');
const allowlistWorld = require('./lib/allowlist-world.cjs');

const HERE = path.join(__dirname, '..');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
const MOUNT = '/api/books-grants';
const FILE = 'routes/books-grants.js';
const TESTED_FILE = path.join(HERE, 'docs', 'contracts', 'api-error-tests.json');
const EVIDENCE_FILE = path.join(HERE, 'docs', 'contracts', 'api-hardening-evidence-areas.json');
const REGISTER_FILE = path.join(HERE, 'docs', 'error-codes.json');
const GRANT_ID = '33333333-3333-4333-8333-333333333333';
const PARENT = '88888888-8888-4888-8888-888888888888';
const SHOP = '11111111-1111-4111-8111-111111111111';
const lab = harness({
  here: HERE,
  mounts: [MOUNT],
  routeFiles: { [MOUNT]: FILE },
  legacyFile: path.join(HERE, 'docs', 'contracts', 'api-legacy.json'),
  inherited: (scenario, answer) => answer.status === 401 && scenario.id === 'signed-out',
  notFrozen: (one, scenario) => one.status === 401 && scenario === 'signed-out'
});
const { check } = lab;
const WORLDS = [
  { id: 'signed-out', setup: { realAuth: true } },
  { id: 'a-key-asks', setup: { asKey: true } },
  { id: 'staff-asks', setup: { who: STAFF } },
  { id: 'bad-id', setup: {}, badId: true },
  { id: 'db-fails', setup: { db: 'fail' } },
  { id: 'nothing-found', setup: {} }
];
const X = (id, route, status, extra) => Object.assign({ id, route, expect: status, setup: {} }, extra);

/** one grant row as the store returns it (lib/books-grant GRANT_COLUMNS): the keys of the closed answer, nothing more */
const GRANT = (more) => Object.assign({ grant_id: GRANT_ID, grantor_entity: SHOP, grantee_entity: PARENT, preset: 'auditor', can_see_costs: true, purpose: 'audit of the books', granted_by: SHOP, granted_at: '2026-11-01T10:00:00.000Z', expires_at: '2027-11-01T10:00:00.000Z', revoked_at: null, revoked_by: null }, more);
const REVOKED = GRANT({ revoked_at: '2026-11-02T10:00:00.000Z', revoked_by: SHOP });
const FUTURE = '2027-06-01T00:00:00.000Z';
/** the member test of lib/network-membership: this business is the network parent */
const IS_PARENT = answering(/AS member/, [{ member: true }]);
/** the migration is not run: the grant table is missing (42P01) */
const NOT_RUN = raising(/books_access_grant|books_access_log/, '42P01');
const OPEN_ONE = (row) => answering(/FROM books_access_grant WHERE grant_id/, [row]);
const WROTE = (row) => firstOf(answering(/UPDATE books_access_grant SET/, [row]), answering(/INSERT INTO books_access_grant/, [row]), answering(/INSERT INTO access_events|access_events/, [{ event_id: 1 }]));
const LISTED = answering(/FROM books_access_grant g/, [{ grant_id: GRANT_ID, grantor_entity: SHOP, grantee_entity: PARENT, preset: 'auditor', can_see_costs: true, purpose: 'audit of the books', granted_at: '2026-11-01T10:00:00.000Z', expires_at: '2099-11-01T10:00:00.000Z', revoked_at: null, edge_live: true }]);
const LOOKS = answering(/FROM books_access_log/, [{ at: '2026-11-03T10:00:00.000Z', grant_id: GRANT_ID, grantee_entity: PARENT, actor_identity_id: PARENT, route_pattern: '/ledger/:account', query_shape: 'none', status: 200, outcome: 'allowed' }]);
const GIVE_BODY = { grantee: PARENT, consent: true };
/** a firm's adviser-level person: an editor of the whole entity (middleware/books-grant mayUseGrant 'adviser') — passes the list gate, is not the owner */
const FIRM_ADVISER = Object.assign({}, STAFF, { whole_entity: true });
const FIRM_AUDITOR = Object.assign({}, STAFF, { access_level: 'commenter', whole_entity: true, can_see_costs: true });
const EXTRAS = [
  X('consent-asked-twice', 'GET /api/books-grants/consent', 422, { url: MOUNT + '/consent?can_see_costs=true&can_see_costs=false' }),
  X('consent-read-by-staff', 'GET /api/books-grants/consent', 200, { setup: { who: STAFF } }),
  X('consent-with-costs', 'GET /api/books-grants/consent', 200, { url: MOUNT + '/consent?can_see_costs=true' }),
  X('consent-without-costs', 'GET /api/books-grants/consent', 200, { url: MOUNT + '/consent?can_see_costs=false' }),
  X('list-not-switched-on', 'GET /api/books-grants', 503, { setup: { sqlRows: NOT_RUN } }),
  X('list-read', 'GET /api/books-grants', 200, { setup: { sqlRows: LISTED } }),
  X('practice-not-switched-on', 'GET /api/books-grants/practice', 503, { setup: { sqlRows: NOT_RUN } }),
  X('list-read-by-firm-adviser', 'GET /api/books-grants', 200, { setup: { who: FIRM_ADVISER, sqlRows: LISTED } }),
  X('list-read-by-firm-auditor', 'GET /api/books-grants', 200, { setup: { who: FIRM_AUDITOR, sqlRows: LISTED } }),
  X('give-no-consent', 'POST /api/books-grants', 422, { body: { grantee: PARENT, consent: false } }),
  X('give-past-end-date', 'POST /api/books-grants', 422, { body: { grantee: PARENT, consent: true, expires_at: '2020-01-01T00:00:00.000Z' } }),
  X('give-too-short-a-purpose', 'POST /api/books-grants', 422, { body: { grantee: PARENT, consent: true, purpose: 'ab' } }),
  X('give-not-the-parent', 'POST /api/books-grants', 422, { body: GIVE_BODY, setup: { sqlRows: answering(/AS member/, [{ member: false }]) } }),
  X('give-already-open', 'POST /api/books-grants', 409, { body: GIVE_BODY, setup: { sqlRows: firstOf(IS_PARENT, answering(/SELECT 1 FROM books_access_grant/, [{ '?column?': 1 }])) } }),
  X('give-not-switched-on', 'POST /api/books-grants', 503, { body: GIVE_BODY, setup: { sqlRows: firstOf(IS_PARENT, NOT_RUN) } }),
  X('give-db-fails', 'POST /api/books-grants', 500, { body: GIVE_BODY, setup: { sqlRows: IS_PARENT, db: 'fail' } }),
  X('give-made', 'POST /api/books-grants', 201, { body: Object.assign({ purpose: 'audit of the books', expires_at: FUTURE, can_see_costs: false }, GIVE_BODY), setup: { sqlRows: firstOf(IS_PARENT, WROTE(GRANT({ can_see_costs: false }))) } }),
  X('change-unknown-grant', 'PATCH /api/books-grants/:id', 404, { url: MOUNT + '/' + GRANT_ID, body: { expires_at: FUTURE } }),
  X('change-past-end-date', 'PATCH /api/books-grants/:id', 422, { url: MOUNT + '/' + GRANT_ID, body: { expires_at: '2020-01-01T00:00:00.000Z' }, setup: { sqlRows: OPEN_ONE(GRANT()) } }),
  X('change-not-switched-on', 'PATCH /api/books-grants/:id', 503, { url: MOUNT + '/' + GRANT_ID, body: { expires_at: FUTURE }, setup: { sqlRows: NOT_RUN } }),
  X('change-db-fails', 'PATCH /api/books-grants/:id', 500, { url: MOUNT + '/' + GRANT_ID, body: { expires_at: FUTURE }, setup: { db: 'fail' } }),
  X('change-made', 'PATCH /api/books-grants/:id', 200, { url: MOUNT + '/' + GRANT_ID, body: { expires_at: FUTURE }, setup: { sqlRows: firstOf(OPEN_ONE(GRANT()), WROTE(GRANT({ expires_at: FUTURE }))) } }),
  X('revoke-unknown-grant', 'POST /api/books-grants/:id/revoke', 404, { url: MOUNT + '/' + GRANT_ID + '/revoke' }),
  X('revoke-with-a-body-it-does-not-read', 'POST /api/books-grants/:id/revoke', 422, { url: MOUNT + '/' + GRANT_ID + '/revoke', body: { surprise: 1 } }),
  X('revoke-not-switched-on', 'POST /api/books-grants/:id/revoke', 503, { url: MOUNT + '/' + GRANT_ID + '/revoke', setup: { sqlRows: NOT_RUN } }),
  X('revoke-db-fails', 'POST /api/books-grants/:id/revoke', 500, { url: MOUNT + '/' + GRANT_ID + '/revoke', setup: { db: 'fail' } }),
  X('revoke-made', 'POST /api/books-grants/:id/revoke', 200, { url: MOUNT + '/' + GRANT_ID + '/revoke', setup: { sqlRows: firstOf(OPEN_ONE(GRANT()), WROTE(REVOKED)) } }),
  X('log-limit-asked-twice', 'GET /api/books-grants/log', 422, { url: MOUNT + '/log?limit=5&limit=6' }),
  X('log-not-switched-on', 'GET /api/books-grants/log', 503, { setup: { sqlRows: NOT_RUN } }),
  X('log-read', 'GET /api/books-grants/log', 200, { url: MOUNT + '/log?limit=50', setup: { sqlRows: LOOKS } })
];

/** the contract as a unit: every route has an operation and every operation a route; every refusal an operation declares is a Problem; the words never carry a cause */
function checkContract(routes) {
  console.log('\n-- the contract and the router agree --');
  const contract = require(path.join(HERE, 'lib', 'books-grants-contract.js'));
  const operations = Object.keys(contract.OPERATIONS);
  check('every route the router holds has an operation, and every operation a route (' + operations.length + ')', sameValue(operations.slice().sort(), Object.keys(routes).sort()), operations.filter((key) => !routes[key]));
  const refusalsAreProblems = Object.values(contract.OPERATIONS).every((operation) => Object.keys(operation.responses).filter((status) => Number(status) >= 400).every((status) => JSON.stringify(operation.responses[status]).includes('problem')));
  check('every refusal an operation declares is a Problem', refusalsAreProblems);
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
  const router = require(path.join(HERE, FILE));
  const routes = lab.routesOf(router, MOUNT);
  const server = lab.appOf([{ mount: MOUNT, router }]).listen(0);
  const recording = {};
  const capturing = lab.flagValue('--capture');
  const contract = require(path.join(HERE, 'lib', 'books-grants-contract.js'));
  const allowedBy = Object.fromEntries(Object.keys(contract.OPERATIONS).map((key) => [key, contract.allowedStatuses()(key)]));
  const allowed = capturing ? () => [] : (route) => allowedBy[route] || [];
  const scenarios = lab.scenariosOf(routes, WORLDS, EXTRAS, { id: GRANT_ID });
  const tested = await lab.checkRoutes(server.address().port, scenarios, recording, allowed, () => ({}));
  server.close();
  if (capturing) {
    fs.writeFileSync(capturing, JSON.stringify(recording, null, 1));
    console.log('captured ' + Object.keys(recording).length + ' answers over ' + Object.keys(routes).length + ' routes');
    process.exit(0);
  }
  checkContract(routes);
  checkCodesRegistered(recording);
  check('a caller who is not signed in is refused with 401 on every route', Object.keys(recording).filter((key) => key.endsWith('|signed-out')).every((key) => recording[key].status === 401));
  check('a key is refused with 403 SIGN_IN_FOR_BOOKS_GRANT on every route but the consent words', Object.keys(recording).filter((key) => key.endsWith('|a-key-asks') && !key.includes('/consent')).every((key) => recording[key].status === 403 && recording[key].body && recording[key].body.code === 'SIGN_IN_FOR_BOOKS_GRANT'));
  check('a co-assist is refused with 403 on every route but the consent words (only the owner changes who reads the books)', Object.keys(recording).filter((key) => key.endsWith('|staff-asks') && !key.includes('/consent')).every((key) => recording[key].status === 403));
  const listAs = (id) => recording['GET /api/books-grants|' + id];
  check('the owner reading the list sees the grant the shop GAVE (given has 1) and the received side', listAs('list-read') && listAs('list-read').body && listAs('list-read').body.given.length === 1, listAs('list-read') && listAs('list-read').body);
  check('a firm person at adviser level reads the list (200) and sees NO given grants — received side only', ['list-read-by-firm-adviser', 'list-read-by-firm-auditor'].every((id) => listAs(id) && listAs(id).status === 200 && Array.isArray(listAs(id).body.given) && listAs(id).body.given.length === 0 && Array.isArray(listAs(id).body.received)), [listAs('list-read-by-firm-adviser'), listAs('list-read-by-firm-auditor')]);
  /* S34: the success answers hold only the keys their closed schema lists */
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
    check('docs/contracts/api-error-tests.json lists exactly the statuses these scenarios cover for routes/books-grants.js', sameValue(mine, coverage), { onDisk: mine, covered: coverage });
    check('docs/contracts/api-hardening-evidence-areas.json says output_allowlist for exactly the grant routes whose success answers held here', sameValue(allowlistWorld.evidenceOf(EVIDENCE_FILE, lab.mine), proved), { proved: Object.keys(proved) });
  }
  console.log('\n  ' + lab.count.passed + ' checks, ' + lab.count.failed + ' failed');
  process.exit(lab.count.failed ? 1 : 0);
})().catch((failure) => {
  console.log('  FAIL  the test itself failed: ' + (failure && failure.stack ? failure.stack.split('\n').slice(0, 3).join(' | ') : failure));
  process.exit(1);
});
