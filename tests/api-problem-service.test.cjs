#!/usr/bin/env node
// @type: contract
/**
 * api-problem-service.test.cjs — API-4 sweep, the service clock: every answer of routes/service.js (7 routes: the clock · start · respond · resolve · pause · end the pause · answer the pause).
 *
 * OWNS      the proof that each refusal of the service routes is a Problem body AND still carries the keys it answered before (docs/contracts/api-legacy.json, recorded from the code before
 *           the sweep), that the 500 and the 503 (the "b147 not run" answer the screen reads) are replayed word for word, that no success answer moved (--compare against a capture of the code
 *           before), this file's rows of docs/contracts/api-error-tests.json, and the "signed in as another shop" world for the seven routes that name a chit in the path (API-STANDARD S35,
 *           tests/lib/foreign-id-world.cjs), recorded in docs/contracts/api-hardening-evidence-areas.json. Also: no answer outside the statuses the route's contract declares (lib/service-contract.js),
 *           its words as units, a real answer fits its declared schema, a column that is in no list never leaves (S34), an unknown body key is refused by name (S33), and that no answer of any status
 *           (a 200 too) carries the words of a failure the stand-in raised (round-1 rule 8: the database stand-in THROWS).
 * CALLED BY scripts/guards.cjs · CI. No database, no network: the real route file over a stand-in db and auth (tests/lib/problem-world.cjs).
 * FLOW      route list (read from the router) x world (signed out, staff, a stranger, a bad id, a failing db, an empty db) + the named extras (tests/lib/service-scenes.cjs) → real route →
 *           body → Problem fields present · frozen legacy keys equal · no leak → statuses tested → manifest; then the foreign-id world
 * CARD      02-tasks-orders-and-workflow/README
 *
 *   node tests/api-problem-service.test.cjs                    check
 *   node tests/api-problem-service.test.cjs --write            rewrite this file's rows of docs/contracts/api-error-tests.json and api-hardening-evidence-areas.json
 *   node tests/api-problem-service.test.cjs --capture F        (run on the code BEFORE the change) record each answer to file F
 *   node tests/api-problem-service.test.cjs --freeze F         merge a capture F into docs/contracts/api-legacy.json (the frozen answers)
 *   node tests/api-problem-service.test.cjs --compare F        the answers now against a capture F: byte for byte for a success, the old keys in order for a refusal
 */
'use strict';
const path = require('path');
const fs = require('fs');
const { harness, OWNER, STAFF, SECRET_SQL, sameValue, answering, firstOf } = require('./lib/problem-world.cjs');
const scenes = require('./lib/service-scenes.cjs');
const FOREIGN = require('./lib/foreign-id-world.cjs');

const HERE = path.join(__dirname, '..');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
const MOUNT = '/api/service';
const ROUTE_FILE = 'routes/service.js';
const ROUTE_COUNT = 7;
let AFTER = new Set();
const lab = harness({
  here: HERE,
  mounts: [MOUNT],
  routeFiles: { [MOUNT]: ROUTE_FILE },
  legacyFile: path.join(HERE, 'docs', 'contracts', 'api-legacy.json'),
  inherited: (scenario, answer) => answer.status === 401 && scenario.id === 'signed-out',
  notFrozen: (one, scenario) => (one.status === 401 && scenario === 'signed-out') || AFTER.has(scenario),
  cannotRide: () => []
});
const { check, world } = lab;
const TESTED_FILE = path.join(HERE, 'docs', 'contracts', 'api-error-tests.json');
const REGISTER_FILE = path.join(HERE, 'docs', 'error-codes.json');
const EVIDENCE_FILE = path.join(HERE, 'docs', 'contracts', 'api-hardening-evidence-areas.json');
const STRANGER = { identity_id: scenes.STRANGER_ID, identity_type: 'entity', display_name: 'Shop B' };
const WORLDS = [
  { id: 'signed-out', setup: { realAuth: true } },
  { id: 'staff-asks', setup: { who: STAFF } },
  { id: 'stranger-asks', setup: { who: STRANGER } },
  { id: 'bad-id', setup: {}, badId: true },
  { id: 'db-fails', setup: { db: 'fail' } },
  { id: 'nothing-found', setup: {} }
];
const EVIDENCE_COLUMNS = ['foreign_id_404', 'output_allowlist'];
const VALUES = { chit_id: scenes.CHIT, pause_id: scenes.PAUSE };
const sources = () => ({});
const contractModule = () => require(path.join(HERE, 'lib', 'service-contract.js'));
const extrasList = () => scenes.extras({ STAFF, SECRET_SQL, answering, firstOf });
const leaking = (value) => /vault|SELECT secret|relation "/.test(JSON.stringify(value || ''));

/** lib/service-contract.js as a unit: the words of a refusal and of a fault, as these routes always said them */
function checkWords() {
  console.log('\n-- lib/service-contract.js: the refusals as a unit --');
  const contract = contractModule();
  const lost = contract.serviceFault(new Error(SECRET_SQL), { id: 'r1' });
  check('serviceFault: a 500 whose old keys are the safe sentence, never the cause', lost.status === 500 && !leaking(lost) && lost.legacy.error === 'Failed', lost);
  const behind = contract.serviceFault(Object.assign(new Error('x'), { code: '42P01' }), { id: 'r1' });
  check('serviceFault: a missing table is the plain 503 with the old two keys', behind.status === 503 && behind.code === 'SERVICE_NOT_MIGRATED' && sameValue(Object.keys(behind.legacy), ['error', 'message']), behind);
  check('isOwnClaim: the SQL function\'s refusal is told from a fault', contract.isOwnClaim(new Error('a party cannot answer its own claim')) && !contract.isOwnClaim(new Error('boom')) && !contract.isOwnClaim(null));
  const row = contract.pick({ a: 1, b: 2, c: 3 }, ['c', 'a', 'z']);
  check('pick: only the named columns, in the order named', sameValue(row, { c: 3, a: 1 }), row);
  check('the column lists are the b147 tables: 15 and 11', contract.RECORD_COLUMNS.length === 15 && contract.PAUSE_COLUMNS.length === 11);
  check('the old two-key bodies are kept (error, message) for every word with a message', ['badPriority', 'badResolution', 'badReason', 'alreadyPaused', 'notOpen', 'ownClaim', 'notMigrated', 'notTracked'].every((name) => sameValue(Object.keys(contract.words[name]().legacy), ['error', 'message'])));
}

/** every code the words answer under is a row of docs/ERROR-CODES.md with its sentence written */
function checkCodesRegistered(contract) {
  console.log('\n-- the codes the service routes answer under are in the register --');
  const known = new Set(JSON.parse(fs.readFileSync(REGISTER_FILE, 'utf8')).codes.filter((row) => row.shopkeeper !== 'PENDING').map((row) => row.code));
  const missing = contract.CODES.filter((code) => !known.has(code));
  check('every code the service words (' + contract.CODES.length + ') answer under is a register row with its sentence written', missing.length === 0, missing);
  const spoken = Object.keys(contract.words).map((name) => contract.words[name]().code);
  check('every word names a code of CODES', spoken.every((code) => contract.CODES.includes(code)), spoken);
}

/** the contract in front of the router: every route has a row, a row has a route, every body is closed, every refusal a Problem */
function checkContractShape(routes) {
  console.log('\n-- the contract and the router agree --');
  const contract = contractModule();
  const operations = Object.keys(contract.OPERATIONS);
  check('premise: the router holds ' + ROUTE_COUNT + ' routes (a scan of an empty list proves nothing)', Object.keys(routes).length === ROUTE_COUNT, Object.keys(routes));
  check('every route the router holds has an operation, and every operation a route (' + operations.length + ')', sameValue(operations.slice().sort(), Object.keys(routes).sort()), operations.filter((key) => !routes[key]));
  const bodies = operations.filter((key) => contract.OPERATIONS[key].requestBody);
  const schemaOf = (key) => contract.OPERATIONS[key].requestBody.content['application/json'].schema;
  check('every write names the keys its handler reads and refuses any other (additionalProperties false): ' + bodies.length + ' bodies', bodies.length === 6 && bodies.every((key) => schemaOf(key).additionalProperties === false), bodies);
  check('every success answer is an allow-list (additionalProperties false at the top)', operations.every((key) => contract.OPERATIONS[key].responses[200].content['application/json'].schema.additionalProperties === false));
  check('every refusal an operation declares is a Problem', operations.every((key) => Object.keys(contract.OPERATIONS[key].responses).filter((status) => Number(status) >= 400).every((status) => JSON.stringify(contract.OPERATIONS[key].responses[status]).includes('Problem'))));
  check('the 503 "b147 not run" is declared on every route, as an extension (the handler does not write the literal)', operations.every((key) => (contract.OPERATIONS[key]['x-service-refusals'] || []).some((one) => one.status === 503)));
}

/** the frozen 500 and 503 answers, replayed: each must come back with its status and every frozen word, byte for byte */
function checkFrozenFaults(recording, legacy) {
  console.log('\n-- the frozen 500 and 503 answers, replayed word for word --');
  const mine = Object.keys(legacy).filter(lab.mine);
  const frozen = mine.flatMap((route) => legacy[route].answers.filter((one) => one.status >= 500).map((one) => ({ route, one })));
  check('both faults are among the frozen answers: the 503 (b147 not run) and the 500', [503, 500].every((status) => frozen.some((item) => item.one.status === status)));
  frozen.forEach(({ route, one }) => {
    const now = recording[route + '|' + one.scenario];
    const same = now && now.status === one.status && Object.keys(one.fixture).every((name) => sameValue(now.body && now.body[name], one.fixture[name]));
    check(route + ' · ' + one.scenario + ': ' + one.status + ' answers every frozen word, byte for byte', !!same, now && now.body);
  });
  return frozen.length;
}

/** a real answer fits the schema its route declares (the contract is not only a document) */
function checkAnswersFitSchema(recording) {
  console.log('\n-- a real answer fits its declared schema --');
  const contract = contractModule();
  const { bodyEngine } = require(path.join(HERE, 'middleware', 'validate'));
  const picked = ['GET /api/service/:chit_id|get-tracked', 'GET /api/service/:chit_id|get-untracked', 'PUT /api/service/:chit_id|put-start', 'POST /api/service/:chit_id/respond|respond-ok', 'POST /api/service/:chit_id/resolve|resolve-ok', 'POST /api/service/:chit_id/pause|pause-ok', 'POST /api/service/:chit_id/pause/:pause_id/end|end-ok', 'POST /api/service/:chit_id/pause/:pause_id/answer|answer-reject'];
  picked.forEach((entry) => {
    const [route] = entry.split('|');
    const answer = recording[entry];
    const valid = answer && answer.status === 200 && bodyEngine.compile(contract.OPERATIONS[route].responses[200].content['application/json'].schema)(answer.body);
    check(entry + ': the 200 answer fits the declared schema (no key beyond it)', !!valid, answer && answer.body);
  });
}

/** the routes whose planted extra column stayed out of a 200 answer: { route: { output_allowlist: true } } (the generated case cannot reach pause and end, whose stand-in rows always say "already paused") */
const ALLOW_ROUTES = ['GET /api/service/:chit_id', 'POST /api/service/:chit_id/pause', 'POST /api/service/:chit_id/pause/:pause_id/end'];
function checkAllowList(recording) {
  console.log('\n-- a column that is in no list never leaves (S34) --');
  const kept = {};
  ALLOW_ROUTES.forEach((route) => {
    const answer = Object.keys(recording).filter((key) => key.startsWith(route + '|') && key.endsWith('-extra-column')).map((key) => recording[key])[0];
    const clean = !!answer && answer.status === 200 && !JSON.stringify(answer.body).includes(scenes.EXTRA_COLUMN) && !leaking(answer.body);
    check(route + ': the scene answered 200 and carries neither the planted column nor its words', clean, answer && answer.body);
    if (clean) kept[route] = { output_allowlist: true };
  });
  const tracked = recording['GET /api/service/:chit_id|get-tracked'];
  check('the record has exactly the 15 b147 columns and a pause its 11 plus `mine`', tracked && Object.keys(tracked.body.record).length === 15 && tracked.body.pauses.every((one) => Object.keys(one).length === 12), tracked && tracked.body.record);
  check('`mine` is true on the pause this shop raised and false on the other party\'s', tracked && tracked.body.pauses[0].mine === true && tracked.body.pauses[1].mine === false);
  return kept;
}

/** S33: a key nobody reads is refused by name, in the old "Validation failed" words, before any lookup */
function checkStrictInput(recording) {
  console.log('\n-- an unknown key is refused by name (S33) --');
  const keyed = Object.keys(recording).filter((key) => key.endsWith('-unknown-key'));
  check('premise: six routes were asked with an extra key (every write that takes a body)', keyed.length === 6, keyed);
  keyed.forEach((key) => {
    const answer = recording[key];
    const named = answer.status === 400 && answer.body.error === 'Validation failed' && answer.body.details.some((one) => one.field === 'zz_unknown_field') && (answer.body.errors || []).some((one) => one.field === 'zz_unknown_field');
    check(key + ': 400, the old "Validation failed" body, the key named', named, answer.body);
  });
  const list = recording['PUT /api/service/:chit_id|put-list-body'];
  check('a list sent as the body is refused (400), as the old chain would have read nothing from it', list && list.status === 400, list && list.body);
  const wrong = recording['POST /api/service/:chit_id/pause/:pause_id/answer|answer-wrong-kind'];
  check('a wrong kind keeps the old words: details [{ field, message: "Invalid value" }]', wrong && sameValue(wrong.body.details, [{ field: 'accepted', message: 'Invalid value' }]), wrong && wrong.body);
}

/* ── the foreign-id world (API-STANDARD S35): shop B asks for shop A's chit by its id ── */
/** one play(who, planted) of a foreign-id route: sets the world and asks as the stranger (shop B) or as the owner (shop A); the chit is planted for shop A only */
function playFor(port, item) {
  return async (who, planted) => {
    Object.assign(world, { realAuth: false, who: who === 'owner' ? OWNER : STRANGER, asKey: false, db: 'ok', sqlRows: planted ? item.rows : null, jsonThrows: false, noCustomer: false });
    return lab.send(port, item.method, item.url, item.body);
  };
}

async function checkForeignIds(port) {
  console.log('\n-- signed in as another shop: a foreign id answers exactly as an unknown id (S35) --');
  const recording = FOREIGN.recorder();
  const items = scenes.foreignRoutes(answering);
  const failures = await FOREIGN.runCases(items.map((item) => ({ route: item.route, play: playFor(port, item) })), recording.record);
  console.log('  foreign id: ' + (items.length - failures.length) + ' of ' + items.length + ' routes held');
  failures.forEach((sentence) => console.log('  FINDING ' + sentence));
  check('all ' + items.length + ' routes that name a chit hold the 9th world', failures.length === 0 && items.length === ROUTE_COUNT, failures);
  return { proved: recording.proved() };
}

/** round-1 rule 8 and R2-3: a scene that makes the stand-in raise the database's words is scanned in EVERY answer, a 200 included */
function checkNoRelay(recording, scenarios) {
  console.log('\n-- the database stand-in throws; no answer says what it threw --');
  const raised = scenarios.filter((one) => one.throws || one.id === 'db-fails').map((one) => one.route + '|' + one.id).filter((key) => recording[key]);
  const thrown = raised.filter((key) => !key.endsWith('|db-fails'));
  check('premise: ' + raised.length + ' answers were built to follow a thrown error, ' + thrown.length + ' of them by a named scene', raised.length >= 12 && thrown.length === 5, raised);
  check('a scene that raises the database\'s words answers none of them, in any status (200s included)', raised.filter((key) => leaking(recording[key].body || recording[key].text)).length === 0, raised.filter((key) => leaking(recording[key].body)));
  check('every named scene ends in a 500 (a thrown error is a fault of ours), and no failing-db world answers a 2xx', thrown.every((key) => recording[key].status === 500) && raised.every((key) => recording[key].status >= 400), raised.filter((key) => recording[key].status < 400));
  const refused = Object.keys(recording).filter((key) => recording[key].status >= 400);
  check('no answer of 400 and over, and no answer at all, carries the database text (' + Object.keys(recording).length + ' answers)', Object.keys(recording).filter((key) => leaking(recording[key].body)).length === 0 && refused.length > 0);
  check('a 2xx is never a Problem: every success answer keeps its own shape', Object.keys(recording).filter((key) => recording[key].status < 400).every((key) => !/problem\+json/.test(recording[key].type)));
}

/** the door: no sign-in is 401 on every route (the sign-in middleware's own answer); the clock has no role gate, so a member of staff reads and writes as the shop does */
function checkDoor(recording, routes) {
  console.log('\n-- the door --');
  check('signed out: 401 on all ' + ROUTE_COUNT + ' routes', Object.keys(routes).every((route) => recording[route + '|signed-out'] && recording[route + '|signed-out'].status === 401));
  check('a member of staff is not turned away at the door: the clock is the shop\'s', recording['PUT /api/service/:chit_id|put-start-by-staff'].status === 200);
}

process.on('unhandledRejection', (failure) => console.log('  (unhandled rejection: ' + String(failure && failure.message).slice(0, 80) + ')'));
(async () => {
  AFTER = new Set(extrasList().filter((one) => one.after).map((one) => one.id));
  if (lab.flagValue('--freeze')) return lab.freeze(lab.flagValue('--freeze'));
  lab.installStubs();
  const router = require(path.join(HERE, ROUTE_FILE));
  const routes = lab.routesOf(router, MOUNT);
  const server = lab.appOf([{ mount: MOUNT, router }]).listen(0);
  const recording = {};
  const capturing = lab.flagValue('--capture') || lab.flagValue('--compare');
  const declared = capturing ? () => [] : contractModule().allowedStatuses();
  const scenarios = lab.scenariosOf(routes, WORLDS, extrasList(), VALUES);
  const tested = await lab.checkRoutes(server.address().port, scenarios, recording, declared, sources);
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
  const foreign = await checkForeignIds(server.address().port);
  server.close();
  checkWords();
  checkCodesRegistered(contractModule());
  checkContractShape(routes);
  checkAnswersFitSchema(recording);
  const allowList = checkAllowList(recording);
  const proved = Object.fromEntries(Object.keys(Object.assign({}, foreign.proved, allowList)).sort().map((route) => [route, Object.assign({}, foreign.proved[route], allowList[route])]));
  checkStrictInput(recording);
  checkDoor(recording, routes);
  const legacy = JSON.parse(fs.readFileSync(lab.legacyFile, 'utf8')).routes;
  const frozen = Object.keys(legacy).filter(lab.mine).reduce((sum, route) => sum + legacy[route].answers.length, 0);
  check('every refusal recorded before the sweep is replayed against the code: ' + frozen + ' answers, each once, byte for byte', frozen > 40, frozen);
  const faults = checkFrozenFaults(recording, legacy);
  check('the frozen 500 and 503 replayed are ' + faults + ' (both statuses, several routes)', faults >= 6, faults);
  checkNoRelay(recording, scenarios);
  const coverage = lab.coverageOf(tested);
  const onDisk = JSON.parse(fs.readFileSync(TESTED_FILE, 'utf8'));
  const mine = Object.fromEntries(Object.keys(onDisk).filter(lab.mine).sort().map((route) => [route, onDisk[route]]));
  if (lab.argv.includes('--write')) {
    const others = Object.fromEntries(Object.keys(onDisk).filter((route) => !lab.mine(route)).map((route) => [route, onDisk[route]]));
    const merged = Object.assign(others, coverage);
    fs.writeFileSync(TESTED_FILE, JSON.stringify(Object.fromEntries(Object.keys(merged).sort().map((route) => [route, merged[route]])), null, 1) + '\n');
    FOREIGN.writeEvidence(EVIDENCE_FILE, lab.mine, proved, EVIDENCE_COLUMNS);
  } else {
    check('docs/contracts/api-error-tests.json lists exactly the statuses these scenarios cover for routes/service.js', sameValue(mine, coverage), { onDisk: Object.keys(mine).length, covered: Object.keys(coverage).length });
    check('docs/contracts/api-hardening-evidence-areas.json says foreign_id_404 and output_allowlist for exactly what held here', sameValue(FOREIGN.evidenceOf(EVIDENCE_FILE, lab.mine, EVIDENCE_COLUMNS), proved), { onDisk: Object.keys(FOREIGN.evidenceOf(EVIDENCE_FILE, lab.mine, EVIDENCE_COLUMNS)).length, held: Object.keys(proved).length });
  }
  console.log('\n  ' + lab.count.passed + ' checks, ' + lab.count.failed + ' failed');
  process.exit(lab.count.failed ? 1 : 0);
})();
