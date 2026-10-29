#!/usr/bin/env node
/**
 * api-problem-assist.test.cjs — API-4 sweep, the assistant: every answer of routes/assist.js (22 routes: the assistant, the conform check, the catalogue-source authoring, containers and regions, the help desk).
 *
 * OWNS      the proof that each refusal of the assistant routes is a Problem body AND still carries the keys it answered before (docs/contracts/api-legacy.json, recorded from the code
 *           before the sweep), that the assistant's own 503 and 502 (the answers the web client falls through on) are replayed word for word, that no success answer moved (--compare against
 *           a capture of the code before), this file's rows of docs/contracts/api-error-tests.json, and the "signed in as another shop" world for the two routes that name a record in the path
 *           (API-STANDARD S35, tests/lib/foreign-id-world.cjs). Also: no answer outside the statuses the route's contract declares (lib/assist-contract.js), its words as units, and that no answer
 *           of any status (a 200 too) carries the words of a failure the stand-in raised (round-1 rule 8).
 * CALLED BY scripts/guards.cjs · CI. No database, no network: the real route file over a stand-in db, auth, token and model (tests/lib/problem-world.cjs).
 * FLOW      route list (read from the router) x world (signed out, staff, a stranger, a bad id, a failing db, an empty db) + the named extras (tests/lib/assist-scenes.cjs) → real route →
 *           body → Problem fields present · frozen legacy keys equal · frozen 5xx replayed · no leak → manifest; then the foreign-id world
 * CARD      28-platform-and-operations/assist
 *
 *   node tests/api-problem-assist.test.cjs                    check
 *   node tests/api-problem-assist.test.cjs --write            rewrite this file's rows of docs/contracts/api-error-tests.json and api-hardening-evidence-areas.json
 *   node tests/api-problem-assist.test.cjs --capture F        (run on the code BEFORE the change) record each answer to file F
 *   node tests/api-problem-assist.test.cjs --freeze F         merge a capture F into docs/contracts/api-legacy.json (the frozen answers)
 *   node tests/api-problem-assist.test.cjs --compare F        the answers now against a capture F: byte for byte for a success, the old keys in order for a refusal
 */
'use strict';
const path = require('path');
const fs = require('fs');
const { harness, OWNER, STAFF, SHOP, SECRET_SQL, sameValue, raising, answering, firstOf } = require('./lib/problem-world.cjs');
const scenes = require('./lib/assist-scenes.cjs');
const FOREIGN = require('./lib/foreign-id-world.cjs');

const HERE = path.join(__dirname, '..');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
process.env.PLATFORM_ROOT_ENTITY = SHOP; /* the shop that signs in is the deployment's root: a platform-owned source may be rewritten by it (a scene signs in as a stranger to be refused) */
delete process.env.ASSIST_LLM_PROVIDER; /* the model is off unless a scene switches it on */
const MOUNT = '/api/assist';
const ROUTE_FILE = 'routes/assist.js';
const ASSISTANT = 'POST ' + MOUNT;
/** the routes behind the real sign-in (middleware/auth); the assistant's other routes are open or take a soft sign-in */
const SIGNED_IN = ['POST /catalogue-adopt', 'GET /catalogue-mine', 'PUT /catalogue-source', 'PUT /container', 'GET /erp-handoffs', 'PUT /region-override', 'GET /penetration', 'POST /publish', 'GET /gaps', 'POST /resolve', 'GET /whoami'].map((key) => key.replace(' ', ' ' + MOUNT));
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
  { id: 'stranger-asks', setup: { who: STRANGER } },
  { id: 'bad-id', setup: {}, badId: true },
  { id: 'db-fails', setup: { db: 'fail' } },
  { id: 'nothing-found', setup: {} }
];
const sources = () => ({
  ai: require(path.join(HERE, 'lib', 'ai')),
  compliance: require(path.join(HERE, 'lib', 'compliance')),
  catalogueBuild: require(path.join(HERE, 'lib', 'catalogue-build')),
  catalogueWrite: require(path.join(HERE, 'lib', 'catalogue-write')),
  container: require(path.join(HERE, 'lib', 'container')),
  regional: require(path.join(HERE, 'lib', 'regional')),
  jwt: require(path.join(HERE, 'lib', 'jwt-verify')),
  log: require(path.join(HERE, 'lib', 'logger')),
  clock: Date,
  dice: Math
});
const contractModule = () => require(path.join(HERE, 'lib', 'assist-contract.js'));
const extrasList = () => scenes.extras({ SHOP, SECRET_SQL, raising, answering, firstOf, standard: require(path.join(HERE, 'lib', 'compliance')).listTemplates()[0].standard });

/** lib/assist-contract.js as a unit: the words of a refusal and of a fault, as these routes always said them */
function checkWords() {
  console.log('\n-- lib/assist-contract.js: the refusals as a unit --');
  const contract = contractModule();
  const req = { id: 'r1' };
  const lost = contract.failed(new Error(SECRET_SQL), req, { ok: false, error: 'x' });
  check('failed: the route\'s own keys and the safe sentence, never the cause', lost.status === 500 && !JSON.stringify(lost).includes('vault'), lost);
  const gated = contract.words.assistGated();
  check('assistGated: the three old keys, in their order', sameValue(Object.keys(gated.legacy), ['error', 'code', 'message']) && gated.legacy.error === 'assist_unavailable' && gated.legacy.code === 'ASSIST_GATED', gated);
  const signIn = contract.words.assistSignIn();
  check('assistSignIn: assist_unavailable with the code the client may key on', signIn.legacy.error === 'assist_unavailable' && signIn.legacy.code === 'ASSIST_SIGN_IN' && signIn.code === 'ASSIST_SIGN_IN', signIn);
  const off = contract.words.assistOff();
  check('assistOff: assist_unavailable with no code key of its own', off.legacy.error === 'assist_unavailable' && !('code' in off.legacy), off);
  const fixed = contract.words.ownedByAnother('This product container is owned by another brand.');
  check('ownedByAnother: the library\'s own sentence rides in the old key error', fixed.legacy.ok === false && fixed.legacy.error === 'This product container is owned by another brand.', fixed);
}

/** every code the words answer under is a row of docs/ERROR-CODES.md with its sentence written */
function checkCodesRegistered(contract) {
  console.log('\n-- the codes the assistant routes answer under are in the register --');
  const known = new Set(JSON.parse(fs.readFileSync(REGISTER_FILE, 'utf8')).codes.filter((row) => row.shopkeeper !== 'PENDING').map((row) => row.code));
  const missing = contract.CODES.filter((code) => !known.has(code));
  check('every code the assistant words (' + contract.CODES.length + ') answer under is a register row with its sentence written', missing.length === 0, missing);
}

/** the contract in front of the router: every route has a row, and a row has a route; no body or query is refused for its shape (the assistant took every one before) */
function checkContractShape(routes) {
  console.log('\n-- the contract and the router agree --');
  const contract = contractModule();
  const operations = Object.keys(contract.OPERATIONS);
  check('every route the router holds has an operation, and every operation a route (' + operations.length + ')', sameValue(operations.slice().sort(), Object.keys(routes).sort()), operations.filter((key) => !routes[key]));
  check('the contract holds 22 operations', operations.length === 22 && Object.keys(routes).length === 22, [operations.length, Object.keys(routes).length]);
  const bodies = operations.filter((key) => contract.OPERATIONS[key].requestBody);
  check('no write refuses a body for its shape: a list is taken as it always was', bodies.every((key) => [].concat(contract.OPERATIONS[key].requestBody.content['application/json'].schema.type).includes('array')), bodies);
  check('no body field is required and none is typed: the handlers answer a missing value in their own sentences', bodies.every((key) => !(contract.OPERATIONS[key].requestBody.content['application/json'].schema.required || []).length));
  const queried = operations.filter((key) => (contract.OPERATIONS[key].parameters || []).some((one) => one.in === 'query'));
  check('a query value is declared as anything: a repeated key is read as it always was', queried.every((key) => contract.OPERATIONS[key].parameters.filter((one) => one.in === 'query').every((one) => !one.schema.type)), queried);
  check('every refusal an operation declares is a Problem', operations.every((key) => Object.keys(contract.OPERATIONS[key].responses).filter((status) => Number(status) >= 400).every((status) => JSON.stringify(contract.OPERATIONS[key].responses[status]).includes('Problem'))));
  check('the assistant declares the two statuses its client falls through on', ['503', '502'].every((status) => contract.OPERATIONS[ASSISTANT].responses[status]));
}

/** the assistant's non-200s are its contract: each frozen 5xx is replayed and must come back with its status and every frozen word */
function checkFrozenFiveHundreds(recording, legacy) {
  console.log('\n-- the frozen 5xx answers, replayed word for word --');
  const mine = Object.keys(legacy).filter(lab.mine);
  const frozen = mine.flatMap((route) => legacy[route].answers.filter((one) => one.status >= 500).map((one) => ({ route, one })));
  check('the assistant\'s 503 and 502 are among the frozen answers', ['assist_unavailable', 'Assistant upstream error', 'Assistant error'].every((word) => frozen.some((item) => item.route === ASSISTANT && item.one.fixture.error === word)));
  frozen.forEach(({ route, one }) => {
    const now = recording[route + '|' + one.scenario];
    const same = now && now.status === one.status && Object.keys(one.fixture).every((name) => sameValue(now.body && now.body[name], one.fixture[name]));
    check(route + ' · ' + one.scenario + ': ' + one.status + ' answers every frozen word, byte for byte', !!same, now && now.body);
  });
  return frozen.length;
}

/* the routes this file's API-8 sweep closed (2026-10-29); the other assist shapes predate the sweep and are judged in their own pass */
const SWEPT = ['GET /catalogue-mine', 'GET /penetration', 'GET /regions'].map((key) => key.replace(' /', ' ' + MOUNT + '/'));
/**
 * output_allowlist in the shop's own world (API-8, S34), as tests/api-problem-entities.test.cjs: the generator's stand-in database cannot reach catalogue-mine's rows (it answers 503), so here every
 * swept route whose 200 schema is closed (additionalProperties false, derived from the answers and the handler's own keys) has every recorded 200 fit that schema, and the allow-list filter drops
 * nothing from it: a key the schema does not list would be cut, so a drop here is an answer that moved. → { route: { output_allowlist: true } }
 */
function checkAllowList(recording) {
  console.log('\n-- the closed success schemas hold every recorded 200 --');
  const proved = {};
  const operations = contractModule().OPERATIONS;
  const engine = require(path.join(HERE, 'middleware', 'validate.js')).bodyEngine;
  const { prune } = require(path.join(HERE, 'lib', 'output-allowlist.js'));
  SWEPT.forEach((route) => {
    const schema = (((operations[route].responses[200] || {}).content || {})['application/json'] || {}).schema;
    if (!schema || schema.additionalProperties !== false) return;
    const answers = Object.values(recording).filter((one) => one.route === route && one.status === 200 && one.body);
    const fits = engine.compile(schema);
    const held = answers.length > 0 && answers.every((one) => fits(one.body) && prune(schema, one.body).dropped.length === 0);
    check(route + ': every recorded 200 (' + answers.length + ') holds only the keys its operation lists (a closed schema the answers fit)', held, { answers: answers.length, errors: fits.errors });
    if (held) proved[route] = { output_allowlist: true };
  });
  return proved;
}
/** the swept routes the evidence file says output_allowlist for */
function allowListEvidenceOnDisk() {
  const routes = JSON.parse(fs.readFileSync(EVIDENCE_FILE, 'utf8')).routes || {};
  return Object.fromEntries(Object.keys(routes).filter((route) => SWEPT.includes(route) && routes[route].output_allowlist).sort().map((route) => [route, { output_allowlist: true }]));
}
/** write the swept routes' output_allowlist rows into the evidence file (other routes and columns stay as they are) */
function writeAllowList(proved) {
  const onDisk = JSON.parse(fs.readFileSync(EVIDENCE_FILE, 'utf8'));
  const routes = onDisk.routes || {};
  SWEPT.filter((route) => routes[route]).forEach((route) => {
    delete routes[route].output_allowlist;
    if (!Object.keys(routes[route]).length) delete routes[route];
  });
  Object.keys(proved).forEach((route) => (routes[route] = Object.assign(routes[route] || {}, proved[route])));
  const sorted = Object.fromEntries(Object.keys(routes).sort().map((route) => [route, routes[route]]));
  fs.writeFileSync(EVIDENCE_FILE, JSON.stringify(Object.assign({}, onDisk, { routes: sorted }), null, 1) + '\n');
}

/* ── the foreign-id world (API-STANDARD S35): shop B asks for shop A's record by its id ── */
const BRAND_ROW = { source_key: 'brand-x@v1', version: 'v1', for_vertical: null, title: 'T', collection: 'C', schema: {}, items: [{ name: 'Tussar', combinations: [] }], commercials_fields: [], owner_entity_id: scenes.OTHER, experience: {}, formatting: {}, pending: null };
const CONTAINER_ROW = { container_id: 'a/b', owner_entity_id: scenes.OTHER, source_key: 's', name: 'N', current_version: 1 };
const VERSION_ROW = { container_id: 'a/b', version: 1, content: {}, schema: {}, schema_version: null, minted_at: '2026-10-01T00:00:00.000Z' };
/** the routes of this file that name a record by an id in the path: a container and a catalogue source */
const FOREIGN_ROUTES = () => [
  { route: 'GET ' + MOUNT + '/container/:id', url: MOUNT + '/container/a%2Fb', method: 'GET', rows: firstOf(answering(/FROM product_container/, [CONTAINER_ROW]), answering(/FROM product_version/, [VERSION_ROW])) },
  { route: 'GET ' + MOUNT + '/catalogue-source/:key', url: MOUNT + '/catalogue-source/brand-x@v1', method: 'GET', rows: answering(/FROM catalogue_source s LEFT JOIN identities/, [BRAND_ROW]) }
];

/** one play(who, planted) of a foreign-id route: sets the world and asks as the stranger (shop B) or as the owner (shop A); the record is planted for the asking only when `planted` */
function playFor(port, item) {
  return async (who, planted) => {
    Object.assign(world, { realAuth: false, who: who === 'owner' ? OWNER : STRANGER, asKey: false, db: 'ok', sqlRows: planted ? item.rows : null, jsonThrows: false, noCustomer: false });
    return lab.send(port, item.method, item.url, item.body);
  };
}

async function checkForeignIds(port) {
  console.log('\n-- signed in as another shop: a foreign id answers exactly as an unknown id (S35) --');
  const recording = FOREIGN.recorder();
  const items = FOREIGN_ROUTES();
  const failures = await FOREIGN.runCases(items.map((item) => ({ route: item.route, play: playFor(port, item) })), recording.record);
  console.log('  foreign id: ' + (items.length - failures.length) + ' of ' + items.length + ' routes held');
  failures.forEach((sentence) => console.log('  FINDING ' + sentence));
  return { proved: recording.proved(), failures, asked: items.length };
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
  server.close();
  checkWords();
  checkCodesRegistered(contractModule());
  checkContractShape(routes);
  const legacy = JSON.parse(fs.readFileSync(lab.legacyFile, 'utf8')).routes;
  const frozen = Object.keys(legacy).filter(lab.mine).reduce((sum, route) => sum + legacy[route].answers.length, 0);
  check('every refusal recorded before the sweep is replayed against the code: ' + frozen + ' answers, each once, byte for byte', frozen > 50, frozen);
  const fiveHundreds = checkFrozenFiveHundreds(recording, legacy);
  check('the frozen 5xx replayed are ' + fiveHundreds + ' (the assistant\'s 503s and 502s, and every 500 and 503 of the rest)', fiveHundreds > 20, fiveHundreds);
  check('a caller who is not signed in is refused with 401 on every route that asks for a sign-in (' + SIGNED_IN.length + ')', SIGNED_IN.every((route) => recording[route + '|signed-out'] && recording[route + '|signed-out'].status === 401));
  /* round-1 rule 8: a scene that makes the stand-in raise the database's own words is scanned in EVERY answer, a 200 included */
  const leaking = (key) => /vault|SELECT secret/.test(JSON.stringify(recording[key].body || recording[key].text || ''));
  const raised = scenarios.filter((one) => one.throws || one.id === 'db-fails').map((one) => one.route + '|' + one.id).filter((key) => recording[key]);
  check('a scene that raises the database\'s words answers none of them, in any status (' + raised.length + ' answers scanned, 200s included)', raised.filter(leaking).length === 0, raised.filter(leaking));
  const refused = Object.keys(recording).filter((key) => recording[key].status >= 400);
  check('a refusal or a 500 never says its cause: no answer of 400 and over carries the database text', refused.filter(leaking).length === 0, refused.filter(leaking));
  check('a 2xx is never a Problem: every success answer keeps its own shape', Object.keys(recording).filter((key) => recording[key].status < 400).every((key) => !/problem\+json/.test(recording[key].type)));
  const coverage = lab.coverageOf(tested);
  const onDisk = JSON.parse(fs.readFileSync(TESTED_FILE, 'utf8'));
  const mine = Object.fromEntries(Object.keys(onDisk).filter(lab.mine).sort().map((route) => [route, onDisk[route]]));
  const judged = coverage;
  const allowed200 = checkAllowList(recording);
  if (lab.argv.includes('--write')) {
    const others = Object.fromEntries(Object.keys(onDisk).filter((route) => !lab.mine(route)).map((route) => [route, onDisk[route]]));
    const merged = Object.assign(others, judged);
    fs.writeFileSync(TESTED_FILE, JSON.stringify(Object.fromEntries(Object.keys(merged).sort().map((route) => [route, merged[route]])), null, 1) + '\n');
    FOREIGN.writeEvidence(EVIDENCE_FILE, lab.mine, foreign.proved);
    writeAllowList(allowed200);
  } else {
    check('docs/contracts/api-error-tests.json lists exactly the statuses these scenarios cover for routes/assist.js', sameValue(mine, judged), { onDisk: Object.keys(mine).length, covered: Object.keys(judged).length });
    check('docs/contracts/api-hardening-evidence-areas.json says foreign_id_404 for exactly the routes that held here', sameValue(FOREIGN.evidenceOf(EVIDENCE_FILE, lab.mine), foreign.proved), { onDisk: Object.keys(FOREIGN.evidenceOf(EVIDENCE_FILE, lab.mine)).length, held: Object.keys(foreign.proved).length });
    /* the area test writes this file (--write) and the register reads it: it is committed with the sweep, and checked exactly (laptop1, 29 Oct) */
    const claimed = Object.keys(allowListEvidenceOnDisk()).sort();
    const held = Object.keys(allowed200).filter((route) => allowed200[route]).sort();
    check('docs/contracts/api-hardening-evidence-areas.json says output_allowlist for exactly the swept routes whose 200 held closed here', sameValue(claimed, held), { claimed, held });
  }
  console.log('\n  ' + lab.count.passed + ' checks, ' + lab.count.failed + ' failed');
  process.exit(lab.count.failed ? 1 : 0);
})();
