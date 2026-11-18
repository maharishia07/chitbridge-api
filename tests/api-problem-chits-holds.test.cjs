#!/usr/bin/env node
// @type: contract
/**
 * api-problem-chits-holds.test.cjs — API sweep for what a person holds: every answer of routes/chits-holds.js (GET /api/chits/holds, GET /api/chits/my-work, POST /api/chits/hand-over-all).
 *
 * OWNS      the proof that each refusal of the three routes is a Problem body, that no answer says a failure's cause, these routes' rows of docs/contracts/api-error-tests.json (the statuses each is tested for,
 *           which the register's error_tests column reads), that their success answers hold only the keys the closed schema of lib/chits-holds-contract.js lists (docs/contracts/api-hardening-evidence-areas.json,
 *           output_allowlist), and that no answer is outside the statuses that contract declares.
 * CALLED BY scripts/guards.cjs · CI. No database, no network: the real routes/chits-holds.js and the real lib/assign-holds over a stand-in db and auth (tests/lib/problem-world.cjs); lib/assign-bulk (the ONE assign
 *           writer) is answered by a stand-in, its own proof being tests/assign-holds.test.cjs and the assign real-stack tests.
 * FLOW      route x world (signed out, a key, staff, a failing db) + the named extras → real route → body → Problem fields present · no leak on a 5xx · statuses tested → manifest · success answers → allow-list evidence
 * CARD      01-rail-core-the-chit/assign
 *
 *   node tests/api-problem-chits-holds.test.cjs            check
 *   node tests/api-problem-chits-holds.test.cjs --write    rewrite these routes' rows of docs/contracts/api-error-tests.json and api-hardening-evidence-areas.json
 *   node tests/api-problem-chits-holds.test.cjs --capture F   record each answer (with its request) to file F
 * The three routes are new (ASSIGN-NET L11 + L9): there is no answer from before the sweep to freeze, so no refusal is compared with api-legacy.json.
 */
'use strict';
const path = require('path');
const fs = require('fs');
const { harness, OWNER, STAFF, SECRET_SQL, sameValue, answering, firstOf } = require('./lib/problem-world.cjs');
const allowlistWorld = require('./lib/allowlist-world.cjs');

const HERE = path.join(__dirname, '..');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
process.env.HOLDS_PER_MIN = process.env.MY_WORK_PER_MIN = process.env.HAND_OVER_PER_MIN = '1'; /* each scene below asks as its own person; the three pairs that share one meet their door's limiter */
const MOUNT = '/api/chits';
const FILE = 'routes/chits-holds.js';
const HOLDS = 'GET /api/chits/holds';
const MY_WORK = 'GET /api/chits/my-work';
const HAND_OVER = 'POST /api/chits/hand-over-all';
const ROUTES = [HOLDS, MY_WORK, HAND_OVER];
const TESTED_FILE = path.join(HERE, 'docs', 'contracts', 'api-error-tests.json');
const EVIDENCE_FILE = path.join(HERE, 'docs', 'contracts', 'api-hardening-evidence-areas.json');
const REGISTER_FILE = path.join(HERE, 'docs', 'error-codes.json');
const FROM = '44444444-4444-4444-8444-444444444444';
const TO = '55555555-5555-4555-8555-555555555555';
const CHIT = '77777777-7777-4777-8777-777777777777';
const CHIT_TWO = '88888888-8888-4888-8888-888888888888';
const SUBJECT = '66666666-6666-4666-8666-666666666666';
const FOLLOWUP = '99999999-9999-4999-8999-999999999999';
const lab = harness({
  here: HERE,
  mounts: [MOUNT],
  routeFiles: { [MOUNT]: FILE },
  owns: (route) => ROUTES.includes(route),
  before: async (scenario) => {
    require(path.join(HERE, 'lib', 'crm-followups.js')).forget(); /* what the follow-up probe learned in one scene is not known to the next */
    bulkImpl = async () => { throw new Error('no stand-in set'); };
    if (scenario.before) scenario.before();
  },
  legacyFile: path.join(HERE, 'docs', 'contracts', 'api-legacy.json'),
  inherited: (scenario, answer) => answer.status === 401 && scenario.id === 'signed-out',
  notFrozen: (one, scenario) => one.status === 401 && scenario === 'signed-out',
  added: () => true /* new routes: no refusal of them was ever frozen */
});
const { check } = lab;
const WORLDS = [
  { id: 'signed-out', setup: { realAuth: true } },
  { id: 'a-key-asks', setup: { asKey: true } },
  { id: 'staff-asks', setup: { who: STAFF } },
  { id: 'db-fails', setup: { db: 'fail' } }
];
/* the ONE assign writer, answered by the scene: lib/assign-bulk is wrapped BEFORE lib/assign-holds loads it */
let bulkImpl = async () => { throw new Error('no stand-in set'); };
const bulkAnswers = (answer) => () => { bulkImpl = async () => answer; };
const bulkFails = (error) => () => { bulkImpl = async () => { throw error; }; };
const refusal = (status, message) => Object.assign(new Error(message), { status, code: 'CHIT_BAD_REQUEST' });

const MANAGER = Object.assign({}, STAFF, { hat: 'manager' });
const AT = '2026-11-17T10:00:00.000Z';
const TEAM = [{ id: FROM, display_name: 'Asha' }, { id: TO, display_name: 'Ravi' }];
const teamRows = answering(/FROM identities WHERE parent_entity_id = \$1 AND identity_type = 'actor'/, TEAM);
const followupTable = answering(/to_regclass\('party_interaction'\)/, [{ i: true, f: true }]);
/** the rows the holds, my-work and hand-over statements read: the person list, the counts per kind, the held chits, the open follow-ups */
const heldCounts = (rows) => answering(/FROM unnest\(\$2::uuid\[\]\) AS ids\(id\)/, rows);
const heldChits = (rows) => answering(/AS plug, \(SELECT r ->> 'entity_id'/, rows);
const workList = (rows) => answering(/cs\.current_status AS status/, rows);
const followupCount = (rows) => answering(/COUNT\(\*\)::int AS n FROM party_followup/, rows);
const followupList = (rows) => answering(/SELECT followup_id, what, party_id, updated_at FROM party_followup/, rows);
const followupIds = (rows) => answering(/SELECT followup_id FROM party_followup WHERE owner_entity_id = \$1 AND assignee_user_id = \$2/, rows);
const rowsOf = (...answers) => ({ sqlRows: firstOf(...answers) });

const X = (id, route, status, o) => Object.assign({ id, route, expect: status, setup: {} }, o || {});
const EXTRAS = [
  /* GET /holds */
  X('holds-listed', HOLDS, 200, { setup: rowsOf(teamRows, heldCounts([{ actor_id: FROM, plug: 'task', n: 3 }, { actor_id: FROM, plug: 'client', n: 1 }, { actor_id: TO, plug: 'task', n: 1 }]), followupTable, followupCount([{ actor_id: FROM, n: 2 }])) }),
  X('holds-nobody-holds-anything', HOLDS, 200, { setup: rowsOf(teamRows) }),
  X('holds-one-person-asked', HOLDS, 200, { url: MOUNT + '/holds?actor_id=' + TO, setup: rowsOf(teamRows) }),
  X('holds-by-a-manager', HOLDS, 200, { setup: Object.assign({ who: MANAGER }, rowsOf(teamRows, heldCounts([{ actor_id: FROM, plug: 'task', n: 1 }]))) }),
  X('holds-a-value-asked-twice', HOLDS, 422, { url: MOUNT + '/holds?actor_id=' + FROM + '&actor_id=' + TO }),
  X('holds-asked-twice-in-a-minute-first', HOLDS, 200, { twin: 'holds', setup: rowsOf(teamRows) }),
  X('holds-asked-twice-in-a-minute-second', HOLDS, 429, { twin: 'holds', setup: rowsOf(teamRows) }),
  X('holds-fails', HOLDS, 500, { setup: { sqlRows: (sql) => { if (/FROM identities/.test(sql)) throw new Error(SECRET_SQL); return null; } } }),
  /* GET /my-work */
  X('my-work-listed', MY_WORK, 200, { setup: rowsOf(heldCounts([{ actor_id: OWNER.identity_id, plug: 'task', n: 1 }, { actor_id: OWNER.identity_id, plug: 'client', n: 1 }]), workList([{ chit_id: CHIT, plug: 'task', status: 'pending', assigned_at: AT, subject: 'Pack the order', subject_id: null }, { chit_id: CHIT_TWO, plug: 'client', status: 'pending', assigned_at: '2026-11-16T10:00:00.000Z', subject: null, subject_id: SUBJECT }])) }),
  X('my-work-with-follow-ups', MY_WORK, 200, { setup: rowsOf(followupTable, heldCounts([]), followupCount([{ actor_id: OWNER.identity_id, n: 1 }]), followupList([{ followup_id: FOLLOWUP, what: 'Ring about the quote', party_id: SUBJECT, updated_at: AT }])) }),
  X('my-work-nothing-held', MY_WORK, 200, {}),
  X('my-work-one-row-asked', MY_WORK, 200, { url: MOUNT + '/my-work?limit=1', setup: rowsOf(heldCounts([{ actor_id: OWNER.identity_id, plug: 'task', n: 2 }]), workList([{ chit_id: CHIT, plug: 'task', status: 'pending', assigned_at: AT, subject: 'Pack the order', subject_id: null }])) }),
  X('my-work-a-value-asked-twice', MY_WORK, 422, { url: MOUNT + '/my-work?limit=1&limit=2' }),
  X('my-work-asked-twice-in-a-minute-first', MY_WORK, 200, { twin: 'my-work' }),
  X('my-work-asked-twice-in-a-minute-second', MY_WORK, 429, { twin: 'my-work' }),
  X('my-work-fails', MY_WORK, 500, { setup: { sqlRows: (sql) => { if (/chit_status/.test(sql)) throw new Error(SECRET_SQL); return null; } } }),
  /* POST /hand-over-all */
  X('hand-over-nothing-held', HAND_OVER, 200, { body: { from_actor_id: FROM, to_actor_id: TO }, setup: rowsOf(teamRows) }),
  X('hand-over-moved-with-skips', HAND_OVER, 200, {
    body: { from_actor_id: FROM, to_actor_id: TO, note: 'Asha is on leave' },
    setup: rowsOf(teamRows, heldChits([{ chit_id: CHIT, plug: 'task', subject_id: null }, { chit_id: CHIT_TWO, plug: 'client', subject_id: SUBJECT }])),
    before: bulkAnswers({ assigned: [{ chit_id: CHIT }], skipped: [{ chit_id: CHIT_TWO, code: 'TARGET_CANNOT_HOLD', reason: 'That person cannot hold this work.' }], previous: [{ chit_id: CHIT, actor_id: FROM }] })
  }),
  X('hand-over-to-the-pool-with-follow-ups', HAND_OVER, 200, { body: { from_actor_id: FROM, to_actor_id: null }, setup: rowsOf(teamRows, followupTable, followupIds([{ followup_id: FOLLOWUP }])) }),
  X('hand-over-a-group-the-new-holder-is-refused', HAND_OVER, 200, { body: { from_actor_id: FROM, to_actor_id: TO }, setup: rowsOf(teamRows, heldChits([{ chit_id: CHIT, plug: 'task', subject_id: null }])), before: bulkFails(refusal(400, 'This person is view-only.')) }),
  X('hand-over-by-a-manager', HAND_OVER, 200, { body: { from_actor_id: FROM, to_actor_id: TO }, setup: Object.assign({ who: MANAGER }, rowsOf(teamRows)) }),
  X('hand-over-to-yourself', HAND_OVER, 400, { body: { from_actor_id: FROM, to_actor_id: FROM }, setup: rowsOf(teamRows) }),
  X('hand-over-to-someone-not-on-the-team', HAND_OVER, 400, { body: { from_actor_id: FROM, to_actor_id: CHIT }, setup: rowsOf(teamRows) }),
  X('hand-over-from-someone-not-on-the-team', HAND_OVER, 404, { body: { from_actor_id: CHIT, to_actor_id: TO }, setup: rowsOf(teamRows) }),
  X('hand-over-the-rail-refuses-the-whole-call', HAND_OVER, 403, { body: { from_actor_id: FROM, to_actor_id: TO }, setup: rowsOf(teamRows, heldChits([{ chit_id: CHIT, plug: 'task', subject_id: null }])), before: bulkFails(Object.assign(new Error('Only the partner or a manager can assign clients.'), { status: 403 })) }),
  X('hand-over-asked-twice-in-a-minute-first', HAND_OVER, 200, { twin: 'hand-over', body: { from_actor_id: FROM, to_actor_id: TO }, setup: rowsOf(teamRows) }),
  X('hand-over-asked-twice-in-a-minute-second', HAND_OVER, 429, { twin: 'hand-over', body: { from_actor_id: FROM, to_actor_id: TO }, setup: rowsOf(teamRows) }),
  X('hand-over-fails', HAND_OVER, 500, { body: { from_actor_id: FROM, to_actor_id: TO }, setup: rowsOf(teamRows, heldChits([{ chit_id: CHIT, plug: 'task', subject_id: null }])), before: bulkFails(new Error(SECRET_SQL)) }),
  X('hand-over-no-body-fields', HAND_OVER, 422, { body: {} }),
  X('hand-over-extra-key', HAND_OVER, 422, { body: { from_actor_id: FROM, holder: TO } }),
  X('hand-over-bad-from-id', HAND_OVER, 422, { body: { from_actor_id: 'nope', to_actor_id: TO } }),
  X('hand-over-bad-to-id', HAND_OVER, 422, { body: { from_actor_id: FROM, to_actor_id: 7 } }),
  X('hand-over-note-too-long', HAND_OVER, 422, { body: { from_actor_id: FROM, to_actor_id: TO, note: 'x'.repeat(201) } })
];

/* every scene asks as its own person (a limiter counts per person or business), except the two of a pair, which say the same `twin` */
EXTRAS.forEach((scene) => {
  const base = (scene.setup && scene.setup.who) || OWNER;
  const at = [...new Set(EXTRAS.map((one) => one.twin || one.id))].indexOf(scene.twin || scene.id) + 1;
  scene.setup = Object.assign({}, scene.setup, { who: Object.assign({}, base, { identity_id: '3000' + String(at).padStart(4, '0') + '-3333-4333-8333-333333333333' }) });
});

/** the contract as a unit: each route has an operation and every refusal an operation declares is a Problem */
function checkContract(routes) {
  console.log('\n-- the contract and the router agree --');
  const contract = require(path.join(HERE, 'lib', 'chits-holds-contract.js'));
  check('the three routes the router holds each have an operation, and each operation a route', sameValue(Object.keys(contract.OPERATIONS).sort(), Object.keys(routes).sort()), Object.keys(routes));
  check('every refusal an operation declares is a Problem', Object.values(contract.OPERATIONS).every((operation) => Object.keys(operation.responses).filter((status) => Number(status) >= 400).every((status) => JSON.stringify(operation.responses[status]).includes('roblem'))));
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
  lab.installStubs();
  const bulk = require(path.join(HERE, 'lib', 'assign-bulk.js'));
  bulk.bulkAssign = (...args) => bulkImpl(...args); /* BEFORE routes/chits-holds.js loads lib/assign-holds, which takes the function when it loads */
  const router = require(path.join(HERE, FILE));
  const routes = lab.routesOf(router, MOUNT);
  const server = lab.appOf([{ mount: MOUNT, router }]).listen(0);
  const recording = {};
  const capturing = lab.flagValue('--capture');
  const contract = require(path.join(HERE, 'lib', 'chits-holds-contract.js'));
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
  const at = (route, id) => recording[route + '|' + id];
  check('a caller who is not signed in is refused with 401 on every route', ROUTES.every((route) => at(route, 'signed-out') && at(route, 'signed-out').status === 401));
  check('a key is refused 403 on the two routes that need the partner or a manager', [HOLDS, HAND_OVER].every((route) => at(route, 'a-key-asks') && at(route, 'a-key-asks').status === 403));
  check('a plain actor is refused 403 CHIT_NOT_PERMITTED before anything is read, on the two manager routes', [HOLDS, HAND_OVER].every((route) => at(route, 'staff-asks') && at(route, 'staff-asks').status === 403 && at(route, 'staff-asks').body.code === 'CHIT_NOT_PERMITTED'));
  check('a plain actor reads their own work: 200', at(MY_WORK, 'staff-asks') && at(MY_WORK, 'staff-asks').status === 200);
  check('a manager is let in on holds and on hand-over: 200', at(HOLDS, 'holds-by-a-manager').status === 200 && at(HAND_OVER, 'hand-over-by-a-manager').status === 200);
  check('a hand-over to oneself is 400 CHIT_BAD_REQUEST, a person not on the team 404 ACTOR_NOT_FOUND', at(HAND_OVER, 'hand-over-to-yourself').body.code === 'CHIT_BAD_REQUEST' && at(HAND_OVER, 'hand-over-from-someone-not-on-the-team').body.code === 'ACTOR_NOT_FOUND');
  check('a group the new holder is refused is a named skip, never a refusal of the call', at(HAND_OVER, 'hand-over-a-group-the-new-holder-is-refused').body.skipped.length === 1 && at(HAND_OVER, 'hand-over-a-group-the-new-holder-is-refused').body.skipped[0].code === 'TARGET_CANNOT_HOLD');
  check('the writer refusing the whole call (403) is 403 CHIT_NOT_PERMITTED and a plain fault is a 500 that says nothing of its cause', at(HAND_OVER, 'hand-over-the-rail-refuses-the-whole-call').body.code === 'CHIT_NOT_PERMITTED' && !/SELECT|vault|relation "/.test(JSON.stringify(at(HAND_OVER, 'hand-over-fails').body)));
  check('a 422 names every failing field (no body fields: from_actor_id)', /from_actor_id/.test(JSON.stringify(at(HAND_OVER, 'hand-over-no-body-fields').body)));
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
    check('docs/contracts/api-error-tests.json lists exactly the statuses these scenarios cover for the three routes', sameValue(mine, coverage), { onDisk: mine, covered: coverage });
    check('docs/contracts/api-hardening-evidence-areas.json says output_allowlist for exactly the routes whose success answers held here', sameValue(allowlistWorld.evidenceOf(EVIDENCE_FILE, lab.mine), proved), { proved: Object.keys(proved) });
  }
  console.log('\n  ' + lab.count.passed + ' checks, ' + lab.count.failed + ' failed');
  process.exit(lab.count.failed ? 1 : 0);
})().catch((failure) => {
  console.log('  FAIL  the test itself failed: ' + (failure && failure.stack ? failure.stack.split('\n').slice(0, 3).join(' | ') : failure));
  process.exit(1);
});
