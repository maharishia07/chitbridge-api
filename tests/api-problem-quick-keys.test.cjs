#!/usr/bin/env node
// @type: contract
/**
 * api-problem-quick-keys.test.cjs — API-4 sweep, the quick-key groups: every refusal of routes/quick-keys.js (9 routes, mounted at /api/quick-keys).
 *
 * OWNS      the proof that each refusal of the 9 routes is a Problem body AND still carries the keys it answered before (docs/contracts/api-legacy.json, recorded from the code before
 *           the sweep), that no success answer moved (--compare against a capture of the code before), that the 409 keeps `current` (the group's own row) byte for byte, this file's rows of
 *           docs/contracts/api-error-tests.json, and the "signed in as another shop" world for the five routes that name a group (API-STANDARD S35, tests/lib/foreign-id-world.cjs), recorded
 *           in docs/contracts/api-hardening-evidence-areas.json. Also: no answer of any status carries database text, no answer outside the statuses the contract declares
 *           (lib/quick-keys-contract.js), and its words as units.
 * CALLED BY scripts/guards.cjs · CI. No database, no network: the real routes/quick-keys.js and the real lib/quick-keys.js over the tables in memory (tests/lib/quick-keys-scenes.cjs).
 * FLOW      route list (read from the router) x world (signed out, a key, a failing db, an empty db, a bad id) + the named scenes → real route → body → Problem fields present ·
 *           frozen legacy keys equal · no leak · statuses tested → manifest; then the foreign-id world → evidence
 * CARD      28-platform-and-operations/quick-keys-routes
 *
 *   node tests/api-problem-quick-keys.test.cjs                    check
 *   node tests/api-problem-quick-keys.test.cjs --write            rewrite this file's rows of docs/contracts/api-error-tests.json and api-hardening-evidence-areas.json
 *   node tests/api-problem-quick-keys.test.cjs --capture F        (run on the code BEFORE the change) record each answer to file F
 *   node tests/api-problem-quick-keys.test.cjs --freeze F         merge a capture F into docs/contracts/api-legacy.json (the frozen answers)
 *   node tests/api-problem-quick-keys.test.cjs --compare F        the answers now against a capture F: byte for byte for a success, the old keys in order for a refusal
 */
'use strict';
const path = require('path');
const fs = require('fs');
const { harness, sameValue, OWNER, SECRET_SQL, SHOP } = require('./lib/problem-world.cjs');
const S = require('./lib/quick-keys-scenes.cjs');
const foreign = require('./lib/foreign-id-world.cjs');

const HERE = path.join(__dirname, '..');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
const MOUNT = '/api/quick-keys';
const TESTED_FILE = path.join(HERE, 'docs', 'contracts', 'api-error-tests.json');
const EVIDENCE_FILE = path.join(HERE, 'docs', 'contracts', 'api-hardening-evidence-areas.json');
const REGISTER_FILE = path.join(HERE, 'docs', 'error-codes.json');
const ADDED = new Set(S.extras().filter((one) => one.after).map((one) => one.id));
const lab = harness({
  here: HERE,
  mounts: [MOUNT],
  routeFiles: { [MOUNT]: 'routes/quick-keys.js' },
  legacyFile: path.join(HERE, 'docs', 'contracts', 'api-legacy.json'),
  inherited: (scenario, answer) => answer.status === 401 && scenario.id === 'signed-out',
  notFrozen: (one, scenario) => (one.status === 401 && scenario === 'signed-out') || ADDED.has(scenario),
  before: (scenario) => prepare(scenario)
});
const { check } = lab;
const WORLDS = [
  { id: 'signed-out', setup: { realAuth: true } },
  { id: 'key-asks', setup: { asKey: true } },
  { id: 'db-fails', setup: { db: 'fail' } },
  { id: 'nothing-found', setup: {} },
  { id: 'bad-id', setup: {}, badId: true }
];
const contractModule = () => require(path.join(HERE, 'lib', 'quick-keys-contract.js'));
let current = S.store();

/** the tables in the state a scenario asks for; a failing database has none (the harness throws the secret text for any statement) */
function prepare(scenario) {
  current = S.store();
  if (scenario.plant) scenario.plant(current);
  lab.world.sqlRows = (scenario.setup || {}).db === 'fail' ? null : current.answer;
}

/** lib/quick-keys-contract.js as a unit: the words of a refusal and of a fault, as these routes always said them */
function checkWords() {
  console.log('\n-- lib/quick-keys-contract.js: the quick-key refusals as a unit --');
  const words = contractModule();
  const req = { id: 'r1' };
  const row = { id: S.GROUP, version: 4, name: 'Morning' };
  const door = words.words.sessionOnly();
  check('sessionOnly: 403, its code and the old sentence', door.code === 'QUICK_KEY_SESSION_ONLY' && sameValue(door.legacy, { error: 'Forbidden', message: 'Quick-key groups are managed by a signed-in person, not by a key.' }), door);
  const conflict = words.quickKeyFault(Object.assign(new Error('changed since you last read it'), { code: 'conflict', current: row }), req);
  check('quickKeyFault: a stale version is 409 with the old three keys and `current` as it was', conflict.status === 409 && conflict.code === 'QUICK_KEY_CHANGED' && sameValue(Object.keys(conflict.legacy), ['error', 'message', 'current']) && conflict.legacy.current === row && conflict.legacy.error === 'conflict', conflict);
  const missing = words.quickKeyFault(Object.assign(new Error('not found'), { code: 'not_found' }), req);
  check('quickKeyFault: a group that is not there is 404 with the one old key', missing.status === 404 && missing.code === 'NOT_FOUND' && sameValue(missing.legacy, { error: 'Not found' }), missing);
  const invalid = words.quickKeyFault(Object.assign(new Error('name required'), { code: 'validation' }), req);
  check('quickKeyFault: a validation is 400 with the library\'s sentence', invalid.status === 400 && invalid.code === 'QUICK_KEY_INVALID' && sameValue(invalid.legacy, { error: 'validation', message: 'name required' }), invalid);
  const fault = words.quickKeyFault(new Error(SECRET_SQL), req);
  check('quickKeyFault: anything else is a 500 that says nothing of its cause', fault.status === 500 && fault.code === 'INTERNAL' && sameValue(fault.legacy, { error: 'Failed', message: 'Something went wrong — please try again.' }) && !JSON.stringify(fault).includes('vault'), fault);
  const coded = words.quickKeyFault(Object.assign(new Error(SECRET_SQL), { code: '23505' }), req);
  check('quickKeyFault: a database error with its SQLSTATE is the same 500, its text never carried', coded.status === 500 && !JSON.stringify(coded).includes('vault'), coded);
  const product = words.words.productRequired();
  check('productRequired: 400 in the old words', product.code === 'QUICK_KEY_INVALID' && sameValue(product.legacy, { error: 'validation', message: 'product_id required' }), product);
  const schema = words.schemaOptions.legacy([{ detail: '(body) must be a object.' }]);
  check('schemaOptions: a body the schema refuses is answered 400 in the route\'s own two keys', words.schemaOptions.status === 400 && sameValue(schema, { error: 'validation', message: '(body) must be a object.' }), schema);
}

/** every code the words answer under is a row of docs/ERROR-CODES.md with its sentence written */
function checkCodesRegistered() {
  console.log('\n-- the codes the quick-key routes answer under are in the register --');
  const codes = contractModule().CODES;
  const known = new Set(JSON.parse(fs.readFileSync(REGISTER_FILE, 'utf8')).codes.filter((item) => item.shopkeeper !== 'PENDING').map((item) => item.code));
  const missing = codes.filter((code) => !known.has(code));
  check('every code the quick-key words answer under (' + codes.length + ' codes) is a register row with its sentence written', missing.length === 0, missing);
}

/** the contract in front of the router: every route has a row, and a row has a route; a body is an object; the typed 409 is listed */
function checkContractShape(routes) {
  console.log('\n-- the contract and the router agree --');
  const contract = contractModule();
  const operations = Object.keys(contract.OPERATIONS);
  check('every route the router holds has an operation, and every operation a route (' + operations.length + ')', sameValue(operations.slice().sort(), Object.keys(routes).sort()), operations.filter((key) => !routes[key]));
  const bodies = operations.filter((key) => contract.OPERATIONS[key].requestBody);
  check('every route that takes a body declares an object, requiring nothing (the handlers answer a missing field in their own words)', bodies.length === 6 && bodies.every((key) => { const schema = contract.OPERATIONS[key].requestBody.content['application/json'].schema; return schema.type === 'object' && !(schema.required || []).length; }), bodies);
  check('the two stale-version routes list the 409 and carry the version in their body', ['PATCH', 'DELETE'].every((method) => { const one = contract.OPERATIONS[method + ' ' + MOUNT + '/groups/:id']; return (one['x-quick-keys-refusals'] || []).some((item) => item.status === 409 && item.code === 'QUICK_KEY_CHANGED') && 'version' in one.requestBody.content['application/json'].schema.properties; }));
  check('a group or product id in the path is a uuid in the contract; a malformed one is answered 404 by router.param before the schema (CTR-172)', operations.filter((key) => key.includes(':')).every((key) => contract.OPERATIONS[key].parameters.every((one) => one.schema.type === 'string' && !!one.schema.pattern)));
  check('every refusal an operation declares is a Problem', operations.every((key) => Object.keys(contract.OPERATIONS[key].responses).filter((status) => Number(status) >= 400).every((status) => JSON.stringify(contract.OPERATIONS[key].responses[status]).includes('Problem'))));
  check('the created answers are 201 (a group, a key) and the rest 200, as the handlers send them', ['POST ' + MOUNT + '/groups', 'POST ' + MOUNT + '/groups/:id/items'].every((key) => '201' in contract.OPERATIONS[key].responses && !('200' in contract.OPERATIONS[key].responses)));
}

/** the 409 keeps `current`: the group's own row, key for key and byte for byte, beside the old `error` and `message` */
function checkConflictBody(recording) {
  console.log('\n-- the 409 conflict body keeps `current` --');
  const planted = S.store().plantGroup(SHOP);
  [['PATCH ' + MOUNT + '/groups/:id|group-change-stale', 'PATCH'], ['DELETE ' + MOUNT + '/groups/:id|group-drop-stale', 'DELETE']].forEach(([key, method]) => {
    const body = (recording[key] || {}).body || {};
    check(method + ': 409 with error, message and current, in that order, `current` equal to the stored row', (recording[key] || {}).status === 409 && sameValue(Object.keys(body).slice(0, 3), ['error', 'message', 'current']) && body.error === 'conflict' && body.message === 'changed since you last read it' && sameValue(body.current, planted), body);
  });
}

/** no answer of any status carries a database's own text, a 200 included (the 5xx rule of the harness looks at 5xx only) */
function checkNoDatabaseText(recording) {
  const text = (one) => JSON.stringify(one.body || one.text || '');
  check('no answer of any route, whatever its status, carries the database text', Object.values(recording).every((one) => !/SELECT|vault|relation "/.test(text(one))));
  check('a success is never a Problem (no 2xx carries the Problem content type)', Object.values(recording).filter((one) => one.status < 400).every((one) => !/problem/.test(one.type)));
}

/** the "signed in as another shop" world: the routes that name a group (API-STANDARD S35) */
const ASKS = () => {
  const group = MOUNT + '/groups/' + S.GROUP;
  return [
    ['PATCH ' + MOUNT + '/groups/:id', 'PATCH', group, { name: 'Evening' }],
    ['DELETE ' + MOUNT + '/groups/:id', 'DELETE', group, { version: 1 }],
    ['POST ' + MOUNT + '/groups/:id/items', 'POST', group + '/items', { product_id: S.BUN }],
    ['PATCH ' + MOUNT + '/groups/:id/items', 'PATCH', group + '/items', { items: [{ product_id: S.TEA, position: 9 }] }]
  ];
};
/** the routes that answer 200 for a group that is not there: asked as another shop they must answer exactly as for an unknown id, and change nothing of the other shop's */
const SILENT = () => {
  const group = MOUNT + '/groups/' + S.GROUP;
  return [
    ['DELETE ' + MOUNT + '/groups/:id/items/:productId', 'DELETE', group + '/items/' + S.TEA]
  ];
};

/** one play(who, planted): the tables hold shop A's group when planted; asked as shop A or as the stranger */
function playOf(port, method, url, body, keep) {
  return async (who, planted) => {
    const tables = S.store();
    if (planted) tables.plantGroup(SHOP);
    keep.tables = tables;
    Object.assign(lab.world, { realAuth: false, who: who === 'owner' ? OWNER : S.STRANGER, asKey: false, db: 'ok', sqlRows: tables.answer });
    return lab.send(port, method, url, body).catch(() => null);
  };
}

async function foreignWorld(port) {
  console.log('\n-- the 9th world: signed in as another shop --');
  const keep = {};
  const cases = ASKS().map(([route, method, url, body]) => ({ route, play: playOf(port, method, url, body, keep) }));
  const seen = foreign.recorder();
  const failures = await foreign.runCases(cases, seen.record);
  failures.forEach((sentence) => check('foreign id: ' + sentence, false));
  ASKS().forEach(([route]) => check(route + ': another shop\'s id answers exactly as an unknown id (404, same body); the owner\'s own id is not a 404', !failures.some((one) => one.startsWith(route))));
  for (const [route, method, url, body] of SILENT()) {
    const play = playOf(port, method, url, body, keep);
    const unknown = await play('stranger', false);
    const alien = await play('stranger', true);
    const shopA = keep.tables.data;
    const untouched = shopA.items.length === 2 && shopA.items.every((one) => (one.product_id === S.TEA ? one.position === 1 : one.position === 2)) && shopA.groups.every((one) => !one.is_deleted && one.version === 1);
    check(route + ': another shop\'s group answers exactly as an unknown one (200, same body: partial on the 404 column, not a leak) and changes nothing of the other shop\'s', unknown.status === 200 && foreign.comparable(alien) === foreign.comparable(unknown) && untouched, { unknown: unknown.status, alien: alien.status, untouched });
  }
  return seen.proved();
}

process.on('unhandledRejection', (failure) => console.log('  (unhandled rejection: ' + String(failure && failure.message).slice(0, 80) + ')'));
(async () => {
  if (lab.flagValue('--freeze')) {
    lab.freeze(lab.flagValue('--freeze'));
    process.exit(0);
  }
  lab.installStubs();
  const router = require(path.join(HERE, 'routes', 'quick-keys.js'));
  const routes = lab.routesOf(router, MOUNT);
  const server = lab.appOf([{ mount: MOUNT, router }]).listen(0);
  const port = server.address().port;
  const recording = {};
  const capturing = lab.flagValue('--capture') || lab.flagValue('--compare');
  const allowed = capturing ? () => [] : contractModule().allowedStatuses();
  const scenarios = lab.scenariosOf(routes, WORLDS, S.extras(), { id: S.GROUP, productId: S.TEA });
  const tested = await lab.checkRoutes(port, scenarios, recording, allowed, () => ({}));
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
  checkConflictBody(recording);
  checkNoDatabaseText(recording);
  const drop = (scene) => recording['DELETE /api/quick-keys/groups/:id|' + scene] || {};
  check('DELETE /groups/:id: a body with a key it does not read is refused 400 naming that key (closed body, stage 2), and the version alone is accepted', drop('group-drop-unknown-key').status === 400 && /colour/.test(JSON.stringify(drop('group-drop-unknown-key').body)) && drop('group-drop').status === 200, { unknown: drop('group-drop-unknown-key').body, known: drop('group-drop').status });
  const proved = await foreignWorld(port);
  server.close();
  const legacy = JSON.parse(fs.readFileSync(lab.legacyFile, 'utf8')).routes;
  const frozen = Object.keys(legacy).filter(lab.mine).reduce((sum, route) => sum + legacy[route].answers.length, 0);
  check('every refusal recorded before the sweep is replayed against the code: ' + frozen + ' answers, each once, byte for byte', frozen >= 40, frozen);
  check('a caller who is not signed in is refused with 401 on every route', Object.keys(recording).filter((key) => key.endsWith('|signed-out')).every((key) => recording[key].status === 401));
  check('a key is refused with 403 on every route, before anything is looked up', Object.keys(recording).filter((key) => key.endsWith('|key-asks')).every((key) => recording[key].status === 403));
  const coverage = lab.coverageOf(tested);
  const onDisk = JSON.parse(fs.readFileSync(TESTED_FILE, 'utf8'));
  const mine = Object.fromEntries(Object.keys(onDisk).filter(lab.mine).sort().map((route) => [route, onDisk[route]]));
  if (lab.argv.includes('--write')) {
    const others = Object.fromEntries(Object.keys(onDisk).filter((route) => !lab.mine(route)).map((route) => [route, onDisk[route]]));
    const merged = Object.assign(others, coverage);
    fs.writeFileSync(TESTED_FILE, JSON.stringify(Object.fromEntries(Object.keys(merged).sort().map((route) => [route, merged[route]])), null, 1) + '\n');
    foreign.writeEvidence(EVIDENCE_FILE, lab.mine, proved);
  } else {
    check('docs/contracts/api-error-tests.json lists exactly the statuses these scenarios cover for routes/quick-keys.js', sameValue(mine, coverage), { onDisk: Object.keys(mine).length, covered: Object.keys(coverage).length });
    check('docs/contracts/api-hardening-evidence-areas.json says exactly what the foreign-id world showed', sameValue(foreign.evidenceOf(EVIDENCE_FILE, lab.mine), proved), proved);
  }
  console.log('\n  ' + lab.count.passed + ' checks, ' + lab.count.failed + ' failed');
  process.exit(lab.count.failed ? 1 : 0);
})();
