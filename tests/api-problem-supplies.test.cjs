#!/usr/bin/env node
// @type: contract
/**
 * api-problem-supplies.test.cjs — API-4 sweep, the supplies: every answer of routes/supplies.js (5 routes, /api/supplies: what a shop buys to USE — the list, add, edit, a purchase, an issue).
 *
 * OWNS      the proof that each refusal of the supplies routes is a Problem body AND still carries the keys it answered before (docs/contracts/api-legacy.json, recorded from the code
 *           before the sweep), that no success answer moved (--compare against a capture of the code before), this file's rows of docs/contracts/api-error-tests.json (the statuses each
 *           route is tested for), and the "signed in as another shop" world for the two routes that name a supply by an id in the path (API-STANDARD S35, tests/lib/foreign-id-world.cjs),
 *           recorded in docs/contracts/api-hardening-evidence-areas.json. Also: no answer of ANY status (a 200 included) carries the text of a thrown error, a 2xx is never a Problem, the
 *           frozen 500 and 503 bodies are replayed word for word, no answer outside the statuses the contract declares (lib/supplies-contract.js), its words as units, and the one finding
 *           the sweep lists for cb-security (the unit of a stock line, echoed in a refusal's sentence).
 * CALLED BY scripts/guards.cjs · CI. No database, no network: the real route file and the real stores over a stand-in db and sign-in (tests/lib/problem-world.cjs, scenes in tests/lib/supplies-scenes.cjs).
 * FLOW      route list (read from the router) x world (signed out, staff, a bad id, a failing db, an empty db) + the named extras (tests/lib/supplies-scenes.cjs) → real route →
 *           body → Problem fields present · frozen legacy keys equal · no leak · statuses tested → manifest; then the foreign-id world
 * CARD      16-finance/supplies-routes
 *
 *   node tests/api-problem-supplies.test.cjs                    check
 *   node tests/api-problem-supplies.test.cjs --write            rewrite this file's rows of docs/contracts/api-error-tests.json and api-hardening-evidence-areas.json
 *   node tests/api-problem-supplies.test.cjs --capture F        (run on the code BEFORE the change) record each answer to file F
 *   node tests/api-problem-supplies.test.cjs --freeze F         merge a capture F into docs/contracts/api-legacy.json (the frozen answers)
 *   node tests/api-problem-supplies.test.cjs --compare F        the answers now against a capture F: byte for byte for a success, the old keys in order for a refusal
 */
'use strict';
const path = require('path');
const fs = require('fs');
const { harness, OWNER, STAFF, SECRET_SQL, SHOP, sameValue, raising, answering, firstOf } = require('./lib/problem-world.cjs');
const scenes = require('./lib/supplies-scenes.cjs');
const FOREIGN = require('./lib/foreign-id-world.cjs');

const HERE = path.join(__dirname, '..');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
const MOUNT = '/api/supplies';
const ROUTE_FILE = 'routes/supplies.js';
const ROUTE_COUNT = 5;
const lab = harness({
  here: HERE,
  mounts: [MOUNT],
  routeFiles: { [MOUNT]: ROUTE_FILE },
  legacyFile: path.join(HERE, 'docs', 'contracts', 'api-legacy.json'),
  inherited: (scenario, answer) => answer.status === 401 && scenario.id === 'signed-out',
  notFrozen: (one, scenario) => one.status === 401 && scenario === 'signed-out'
});
const { check, world } = lab;
const TESTED_FILE = path.join(HERE, 'docs', 'contracts', 'api-error-tests.json');
const REGISTER_FILE = path.join(HERE, 'docs', 'error-codes.json');
const EVIDENCE_FILE = path.join(HERE, 'docs', 'contracts', 'api-hardening-evidence-areas.json');
const STRANGER = { identity_id: scenes.STRANGER_ID, identity_type: 'entity', display_name: 'Shop B' };
const WORLDS = [
  { id: 'signed-out', setup: { realAuth: true } },
  { id: 'staff-asks', setup: { who: STAFF } },
  { id: 'bad-id', setup: {}, badId: true },
  { id: 'db-fails', setup: { db: 'fail' } },
  { id: 'nothing-found', setup: {} }
];
const sources = () => ({});
const contractModule = () => require(path.join(HERE, 'lib', 'supplies-contract.js'));
const extrasList = () => scenes.extras({ OWNER, STAFF, SECRET_SQL, raising, answering, firstOf });
/** the scenes that answer a sentence carrying the unit of a stock line (a caller's word, or the one stored from an earlier call): the finding listed for cb-security */
const UNIT_ECHO = ['buy-unit-differs-from-the-balance', 'issue-unit-differs-from-the-balance'];
const THROWN = /SELECT|vault|relation "|secret/;

/** lib/supplies-contract.js as a unit: the words of a refusal and of a fault, as these routes always said them */
function checkWords() {
  console.log('\n-- lib/supplies-contract.js: the refusals as a unit --');
  const words = contractModule();
  const req = { id: 'r1' };
  const refused = words.words.refused('a supply needs a name');
  check('refused: the library\'s sentence rides in the old keys (error validation, message)', refused.code === 'SUPPLY_INVALID' && refused.legacy.error === 'validation' && refused.legacy.message === 'a supply needs a name' && refused.detail === 'a supply needs a name', refused);
  const missing = words.words.notFound();
  check('notFound: the old body is { error: "Not found" } and nothing else', sameValue(missing.legacy, { error: 'Not found' }) && missing.code === 'NOT_FOUND', missing);
  const later = words.words.notReady();
  check('notReady: the 503 sentence is the old one (Not ready, run b217 first)', later.code === 'SUPPLIES_NOT_MIGRATED' && sameValue(later.legacy, { error: 'Not ready', message: 'run b217 first' }), later);
  const lost = words.faultOf(new Error(SECRET_SQL), req, 'Could not record the purchase');
  check('faultOf: the screen\'s own label and the safe sentence, never the cause', lost.status === 500 && lost.legacy.error === 'Could not record the purchase' && !THROWN.test(JSON.stringify(lost)), lost);
  check('notMigrated: a missing table is a 42P01 and nothing else', words.notMigrated({ code: '42P01' }) === true && words.notMigrated({ code: '23505' }) === false && words.notMigrated(null) === false);
}

/** every code the words answer under is a row of docs/ERROR-CODES.md with its sentence written */
function checkCodesRegistered(contract) {
  console.log('\n-- the codes the supplies routes answer under are in the register --');
  const known = new Set(JSON.parse(fs.readFileSync(REGISTER_FILE, 'utf8')).codes.filter((row) => row.shopkeeper !== 'PENDING').map((row) => row.code));
  const missing = contract.CODES.filter((code) => !known.has(code));
  check('every code the supplies words (' + contract.CODES.length + ') answer under is a register row with its sentence written', missing.length === 0, missing);
}

/** the contract in front of the router: every route has an operation and an operation a route; nothing here can be refused for its shape (the old code never did) */
function checkContractShape(routes) {
  console.log('\n-- the contract and the router agree --');
  const contract = contractModule();
  const operations = Object.keys(contract.OPERATIONS);
  check('premise: the router holds ' + ROUTE_COUNT + ' routes (an empty list would pass every scan)', Object.keys(routes).length === ROUTE_COUNT, Object.keys(routes));
  check('every route the router holds has an operation, and every operation a route (' + operations.length + ')', sameValue(operations.slice().sort(), Object.keys(routes).sort()), operations.filter((key) => !routes[key]));
  const bodies = operations.filter((key) => contract.OPERATIONS[key].requestBody);
  check('every write declares a body that may be an object or a list: the handlers read a list as an empty body and answer their own 400', bodies.every((key) => sameValue(contract.OPERATIONS[key].requestBody.content['application/json'].schema.type, ['object', 'array'])), bodies);
  check('no body names a key as required and none is closed (an unknown key was dropped before, and still is)', bodies.every((key) => { const one = contract.OPERATIONS[key].requestBody.content['application/json'].schema; return !one.required && one.additionalProperties === undefined; }));
  check('every refusal an operation declares is a Problem', operations.every((key) => Object.keys(contract.OPERATIONS[key].responses).filter((status) => Number(status) >= 400).every((status) => JSON.stringify(contract.OPERATIONS[key].responses[status]).includes('Problem'))));
  check('a malformed path argument is still the route\'s own answer, never a 400 of the schema: the id is plain text', operations.filter((key) => key.includes(':')).every((key) => contract.OPERATIONS[key].parameters.every((one) => one.schema.type === 'string' && !one.schema.pattern)));
}

/** the frozen 500 and 503 bodies of the untouched code, replayed: the same status and every old key, byte for byte and in order */
function checkFrozen5xx(recording) {
  console.log('\n-- the frozen 5xx answers are replayed --');
  const legacy = JSON.parse(fs.readFileSync(lab.legacyFile, 'utf8')).routes;
  let replayed = 0;
  Object.keys(legacy).filter(lab.mine).forEach((route) => legacy[route].answers.filter((frozen) => frozen.status >= 500).forEach((frozen) => {
    const now = recording[route + '|' + frozen.scenario];
    const order = Object.keys(frozen.fixture);
    replayed++;
    check(route + ' · ' + frozen.scenario + ': the frozen ' + frozen.status + ' body is kept, key by key and in order', !!now && now.status === frozen.status && sameValue(order.map((name) => now.body[name]), order.map((name) => frozen.fixture[name])) && sameValue(Object.keys(now.body).slice(0, order.length), order), now && now.body);
  }));
  check('at least ten 5xx answers were frozen and replayed (' + replayed + ')', replayed >= 10, replayed);
}

/** no answer of any status carries a thrown text; a 2xx is never a Problem; the unit echo is the one listed finding */
function checkLeaks(recording) {
  console.log('\n-- no thrown text in any answer; a 2xx is never a Problem --');
  const asked = Object.keys(recording).filter((key) => /leaks-nothing$/.test(key));
  check('the scenes that make the database THROW a string with SQL in it ran (' + asked.length + ' of 6)', asked.length === 6, asked);
  check('no answer of ANY status (2xx, 4xx, 5xx) carries the thrown text', Object.keys(recording).every((key) => !THROWN.test(JSON.stringify(recording[key].body || recording[key].text || ''))), Object.keys(recording).filter((key) => THROWN.test(JSON.stringify(recording[key].body || ''))));
  check('a 2xx is never a Problem: every success answer keeps its own shape', Object.keys(recording).filter((key) => recording[key].status < 400).every((key) => !/problem\+json/.test(recording[key].type)));
  const echoed = Object.keys(recording).filter((key) => UNIT_ECHO.some((id) => key.endsWith('|' + id)));
  check('the unit-echo scenes ran (' + echoed.length + ' of ' + UNIT_ECHO.length + ')', echoed.length === UNIT_ECHO.length);
  const purchase = recording['POST ' + MOUNT + '/purchase|buy-unit-differs-from-the-balance'];
  const issue = recording['POST ' + MOUNT + '/:id/issue|issue-unit-differs-from-the-balance'];
  console.log('  FINDING cb-security: lib/inventory.js:189 words a refusal with the unit of the stored balance and the unit sent; routes/supplies.js:125 answers it (400 message) and lib/supply-store.js purchase() lists it in failed[].why of a 200: ' + JSON.stringify([purchase && purchase.body && purchase.body.failed, issue && issue.body && issue.body.message]).slice(0, 300));
  check('the unit echo is exactly what the finding says: the stored unit and the unit sent, in a 400 message and in a 200 failed[].why', !!purchase && !!issue && /counted in bottle.*movement is in carton/.test(JSON.stringify(purchase.body)) && /counted in bottle.*movement is in carton/.test(JSON.stringify(issue.body)), [purchase && purchase.body, issue && issue.body]);
}

/* ── the foreign-id world (API-STANDARD S35): shop B asks for shop A's supply by its id ── */
const FOREIGN_ROUTES = () => [
  { route: 'PATCH ' + MOUNT + '/:id', url: MOUNT + '/' + scenes.ITEM, method: 'PATCH', body: { name: 'Floor cleaner 5L' } },
  { route: 'POST ' + MOUNT + '/:id/issue', url: MOUNT + '/' + scenes.ITEM + '/issue', method: 'POST', body: { qty: 2, ref: 'USE-1' } }
];

/** one play(who, planted) of a foreign-id route: sets the world and asks as the stranger (shop B) or as the owner (shop A); the supply is planted for shop A only */
function playFor(port, item) {
  return async (who, planted) => {
    Object.assign(world, { realAuth: false, who: who === 'owner' ? OWNER : STRANGER, asKey: false, db: 'ok', sqlRows: scenes.ownedBy(SHOP, planted), jsonThrows: false, noCustomer: false });
    return lab.send(port, item.method, item.url, item.body);
  };
}

async function checkForeignIds(port) {
  console.log('\n-- signed in as another shop: a foreign id answers exactly as an unknown id (S35) --');
  const recording = FOREIGN.recorder();
  const items = FOREIGN_ROUTES();
  const edit = items[0];
  const failures = await FOREIGN.runCases([{ route: edit.route, play: playFor(port, edit) }], recording.record);
  console.log('  foreign id: ' + (1 - failures.length) + ' of 1 routes held the 404 proof');
  failures.forEach((sentence) => console.log('  FINDING ' + sentence));
  /* the issue answers an unknown id 400 ("no such supply"), not 404: it cannot pass the 404 proof, and it is NOT a leak when another shop's id answers exactly the same (request id aside) */
  const issue = items[1];
  const play = playFor(port, issue);
  const unknown = await play('stranger', false);
  const foreign = await play('stranger', true);
  const own = await play('owner', true);
  const verdict = await FOREIGN.foreignIdCase(playFor(port, issue));
  check('issue: another shop\'s id answers byte for byte as an unknown id (status, type and body, request id masked)', FOREIGN.comparable(foreign) === FOREIGN.comparable(unknown), [foreign.text, unknown.text]);
  check('issue: the unknown id answers 400, not 404, so foreign_id_404 stays false and is listed (API-4c), never a 403 or the record', unknown.status === 400 && foreign.status === 400 && /answered 400, not 404/.test(String(verdict)), [unknown.status, foreign.status, verdict]);
  check('issue: the owner\'s own id is not refused (it answers 200)', own.status === 200, [own.status, own.text]);
  return { proved: recording.proved(), failures, asked: items.length };
}

/** a key in the body naming another shop's supply reaches no statement: every id a write hands to SQL is looked up under the caller's shop first (the finance pass lesson) */
async function checkIdsInTheBody(port) {
  console.log('\n-- an id in the body or the path never reaches SQL before it was looked up under the caller\'s shop --');
  const seen = [];
  const recorded = (sql, params) => { seen.push({ sql: String(sql), params }); return null; };
  const ask = async (method, url, body) => {
    seen.length = 0;
    Object.assign(world, { realAuth: false, who: OWNER, asKey: false, db: 'ok', sqlRows: firstOf(recorded, scenes.extras({ OWNER, STAFF, SECRET_SQL, raising, answering, firstOf }).find((one) => one.id === 'buy-an-id-in-the-body-is-not-read').setup.sqlRows), jsonThrows: false, noCustomer: false });
    return lab.send(port, method, url, body);
  };
  await ask('POST', MOUNT + '/purchase', { ref: 'BILL-1', lines: [{ name: 'Floor cleaner', supply_item_id: scenes.UNKNOWN_ITEM, item_id: scenes.UNKNOWN_ITEM, qty: 1, cost: 40 }] });
  check('purchase: an id named in a line is handed to no statement (the line is found by its name, under the shop)', seen.length > 0 && seen.every((one) => !JSON.stringify(one.params || []).includes(scenes.UNKNOWN_ITEM)), seen.filter((one) => JSON.stringify(one.params || []).includes(scenes.UNKNOWN_ITEM)));
  check('purchase: every statement that reads or writes a supply carries the caller\'s shop as its first parameter', seen.filter((one) => /supply_item/.test(one.sql)).every((one) => (one.params || [])[0] === SHOP), seen.filter((one) => /supply_item/.test(one.sql)).map((one) => one.params && one.params[0]));
  await ask('PATCH', MOUNT + '/' + scenes.UNKNOWN_ITEM, { name: 'x' });
  check('edit: the UPDATE is bounded by the shop and the id (WHERE entity_id = $1 AND supply_item_id = $2)', seen.some((one) => /UPDATE supply_item[\s\S]*WHERE entity_id = \$1 AND supply_item_id = \$2/.test(one.sql) && one.params[0] === SHOP && one.params[1] === scenes.UNKNOWN_ITEM), seen.map((one) => one.sql.slice(0, 40)));
  await ask('POST', MOUNT + '/' + scenes.UNKNOWN_ITEM + '/issue', { qty: 1 });
  check('issue: the supply is looked up under the shop first, and an unknown one writes no stock statement', seen.length === 1 && /SELECT name, keep_stock, unit FROM supply_item WHERE entity_id = \$1 AND supply_item_id = \$2/.test(seen[0].sql) && !seen.some((one) => /stock_/.test(one.sql)), seen.map((one) => one.sql.slice(0, 50)));
}

process.on('unhandledRejection', (failure) => console.log('  (unhandled rejection: ' + String(failure && failure.message).slice(0, 80) + ')'));
(async () => {
  if (lab.flagValue('--freeze')) return lab.freeze(lab.flagValue('--freeze'));
  lab.installStubs();
  const router = require(path.join(HERE, ROUTE_FILE));
  const routes = lab.routesOf(router, MOUNT);
  const server = lab.appOf([{ mount: MOUNT, router }]).listen(0);
  const recording = {};
  const capturing = lab.flagValue('--capture') || lab.flagValue('--compare');
  const declared = capturing ? () => [] : contractModule().allowedStatuses();
  const scenarios = lab.scenariosOf(routes, WORLDS, extrasList());
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
  await checkIdsInTheBody(server.address().port);
  server.close();
  checkWords();
  checkCodesRegistered(contractModule());
  checkContractShape(routes);
  checkFrozen5xx(recording);
  checkLeaks(recording);
  const legacy = JSON.parse(fs.readFileSync(lab.legacyFile, 'utf8')).routes;
  const frozen = Object.keys(legacy).filter(lab.mine).reduce((sum, route) => sum + legacy[route].answers.length, 0);
  check('every refusal recorded before the sweep is replayed against the code: ' + frozen + ' answers, each once, byte for byte', frozen > 20, frozen);
  check('a caller who is not signed in is refused with 401 on every route', Object.keys(recording).filter((key) => key.endsWith('|signed-out')).length === ROUTE_COUNT && Object.keys(recording).filter((key) => key.endsWith('|signed-out')).every((key) => recording[key].status === 401));
  const coverage = lab.coverageOf(tested);
  const onDisk = JSON.parse(fs.readFileSync(TESTED_FILE, 'utf8'));
  const mine = Object.fromEntries(Object.keys(onDisk).filter(lab.mine).sort().map((route) => [route, onDisk[route]]));
  if (lab.argv.includes('--write')) {
    const others = Object.fromEntries(Object.keys(onDisk).filter((route) => !lab.mine(route)).map((route) => [route, onDisk[route]]));
    const merged = Object.assign(others, coverage);
    fs.writeFileSync(TESTED_FILE, JSON.stringify(Object.fromEntries(Object.keys(merged).sort().map((route) => [route, merged[route]])), null, 1) + '\n');
    FOREIGN.writeEvidence(EVIDENCE_FILE, lab.mine, foreign.proved);
  } else {
    check('docs/contracts/api-error-tests.json lists exactly the statuses these scenarios cover for routes/supplies.js', sameValue(mine, coverage), { onDisk: Object.keys(mine).length, covered: Object.keys(coverage).length });
    check('docs/contracts/api-hardening-evidence-areas.json says foreign_id_404 for exactly the routes that held here', sameValue(FOREIGN.evidenceOf(EVIDENCE_FILE, lab.mine), foreign.proved), { onDisk: Object.keys(FOREIGN.evidenceOf(EVIDENCE_FILE, lab.mine)).length, held: Object.keys(foreign.proved).length });
  }
  console.log('\n  ' + lab.count.passed + ' checks, ' + lab.count.failed + ' failed');
  process.exit(lab.count.failed ? 1 : 0);
})();
