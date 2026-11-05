#!/usr/bin/env node
/**
 * api-problem-entities.test.cjs — API-4 sweep, the entities: every answer of routes/entities.js (24 routes: sign-up and sign-in, the profile, policy, routing, populations, erasure).
 *
 * OWNS      the proof that each refusal of the entities routes is a Problem body AND still carries the keys it answered before (docs/contracts/api-legacy.json, recorded from the code
 *           before the sweep), that no success answer moved (--compare against a capture of the code before), this file's rows of docs/contracts/api-error-tests.json (the statuses
 *           each route is tested for, which the register's error_tests column reads), and the "signed in as another shop" world for the routes that name a record by an id in the path
 *           (API-STANDARD S35, tests/lib/foreign-id-world.cjs), recorded in docs/contracts/api-hardening-evidence-areas.json. Also: no answer outside the statuses the route's contract declares
 *           (lib/entities-contract.js), its words as units, and that sign-in (POST /register, POST /verify) answers what it answered before: those two are RECORDED here (byte for byte),
 *           never judged, since their refusals are routes/signin.js's.
 * CALLED BY scripts/guards.cjs · CI. No database, no network: the real route file over a stand-in db and auth (tests/lib/problem-world.cjs).
 * FLOW      route list (read from the router) x world (signed out, staff, a stranger, a bad id, a failing db, an empty db) + the named extras (tests/lib/entities-scenes.cjs) → real route →
 *           body → Problem fields present · frozen legacy keys equal · no leak on a 5xx · statuses tested → manifest; then the foreign-id world
 * CARD      28-platform-and-operations/entities-routes
 *
 *   node tests/api-problem-entities.test.cjs                    check
 *   node tests/api-problem-entities.test.cjs --write            rewrite this file's rows of docs/contracts/api-error-tests.json and api-hardening-evidence-areas.json
 *   node tests/api-problem-entities.test.cjs --capture F        (run on the code BEFORE the change) record each answer to file F
 *   node tests/api-problem-entities.test.cjs --freeze F         merge a capture F into docs/contracts/api-legacy.json (the frozen answers)
 *   node tests/api-problem-entities.test.cjs --compare F        the answers now against a capture F: byte for byte for a success, the old keys in order for a refusal
 */
'use strict';
const path = require('path');
const fs = require('fs');
const { harness, OWNER, STAFF, SHOP, SECRET_SQL, sameValue, raising, answering, firstOf } = require('./lib/problem-world.cjs');
const scenes = require('./lib/entities-scenes.cjs');
const FOREIGN = require('./lib/foreign-id-world.cjs');

const HERE = path.join(__dirname, '..');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
process.env.PLATFORM_ROOT_ENTITY = SHOP; /* the shop that signs in is the deployment's root: the platform doors let it through (a scene swaps in a copy with no root) */
const MOUNT = '/api/entities';
const ROUTE_FILE = 'routes/entities.js';
/** sign-in and sign-up: recorded byte for byte, never judged (their refusals are routes/signin.js's, an area of its own) */
const SIGN_IN = ['POST ' + MOUNT + '/register', 'POST ' + MOUNT + '/verify'];
const ANY_STATUS = [400, 401, 403, 404, 409, 422, 429, 500, 503];
const lab = harness({
  here: HERE,
  mounts: [MOUNT],
  routeFiles: { [MOUNT]: ROUTE_FILE },
  legacyFile: path.join(HERE, 'docs', 'contracts', 'api-legacy.json'),
  before: () => require(path.join(HERE, 'lib', 'schema'))._reset(), /* every scenario meets the column probes (lib/schema.js caches a yes for good) as the first read of a fresh process does */
  inherited: (scenario, answer) => (answer.status === 401 && scenario.id === 'signed-out') || SIGN_IN.includes(scenario.route),
  notFrozen: (one, scenario) => (one.status === 401 && scenario === 'signed-out') || AFTER.has(scenario) || SIGN_IN.includes(one.route),
  cannotRide: (route, scenario) => (HINT_SCENES.includes(scenario) && route.endsWith('/routing') ? ['hint'] : HINT_SCENES.includes(scenario) && route.endsWith('/desk') ? ['hint'] : []) /* the Problem owns `hint`: a null hint cannot ride */
});
const { check, world } = lab;
const TESTED_FILE = path.join(HERE, 'docs', 'contracts', 'api-error-tests.json');
const REGISTER_FILE = path.join(HERE, 'docs', 'error-codes.json');
const EVIDENCE_FILE = path.join(HERE, 'docs', 'contracts', 'api-hardening-evidence-areas.json');
const HINT_SCENES = ['routing-team-outside-network-no-hint', 'desk-not-for-this-population-no-hint'];
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
  platform: require(path.join(HERE, 'lib', 'platformroot')),
  header: require(path.join(HERE, 'lib', 'entity-header')),
  sides: require(path.join(HERE, 'lib', 'sides')),
  plans: require(path.join(HERE, 'lib', 'plans')),
  govresolve: require(path.join(HERE, 'lib', 'govresolve')),
  search: require(path.join(HERE, 'lib', 'network-search')) /* NET-39: the Where picker's places, so its 500 can be shown */
});
const contractModule = () => require(path.join(HERE, 'lib', 'entities-contract.js'));

/** lib/platformroot.js as a deployment with NO root configured: loaded fresh with the variable unset (it reads it once, when it loads), then the real one put back */
function platformWithoutRoot() {
  const file = require.resolve(path.join(HERE, 'lib', 'platformroot'));
  require(file); /* the real one first, so the cache holds it to put back */
  const kept = require.cache[file];
  delete require.cache[file];
  const was = process.env.PLATFORM_ROOT_ENTITY;
  delete process.env.PLATFORM_ROOT_ENTITY;
  const copy = require(file);
  process.env.PLATFORM_ROOT_ENTITY = was;
  require.cache[file] = kept;
  return copy;
}
const extrasList = () => scenes.extras({ OWNER, STAFF, SECRET_SQL, raising, answering, firstOf, nobodyRoot: NOBODY });
const NOBODY = platformWithoutRoot();
const AFTER = new Set(extrasList().filter((one) => one.after).map((one) => one.id));

/** lib/entities-contract.js as a unit: the words of a refusal and of a fault, as these routes always said them */
function checkWords() {
  console.log('\n-- lib/entities-contract.js: the refusals as a unit --');
  const words = contractModule();
  const req = { id: 'r1' };
  const lost = words.failed(new Error(SECRET_SQL), req, 'Search failed');
  check('failed: the screen\'s own label and the safe sentence, never the cause', lost.status === 500 && lost.legacy.error === 'Search failed' && !JSON.stringify(lost).includes('vault'), lost);
  const policyRefused = words.policyFault(Object.assign(new Error('x is platform-bound and cannot be changed'), { status: 400 }), req);
  check('policyFault: a refusal of the policy library keeps its status and its sentence', policyRefused.status === 400 && policyRefused.legacy.message === 'x is platform-bound and cannot be changed' && policyRefused.legacy.error === 'Policy update failed', policyRefused);
  const kind = words.policyFault(Object.assign(new Error('Not offered.'), { status: 400, code: 'REG_KIND_NOT_OFFERED' }), req);
  check('policyFault: a refusal that carries a code keeps it', kind.code === 'REG_KIND_NOT_OFFERED' && kind.legacy.code === 'REG_KIND_NOT_OFFERED', kind);
  const fault = words.policyFault(new Error(SECRET_SQL), req);
  check('policyFault: anything else is a 500 that says nothing of its cause', fault.status === 500 && !JSON.stringify(fault).includes('vault'), fault);
  const owner = words.words.policyOwnerOnly('Only the owner may change this.');
  check('policyOwnerOnly: the old keys are kept (may · why · message · code)', owner.legacy.may === false && owner.legacy.why === 'Only the owner may change this.' && owner.legacy.code === 'OWNER_ONLY', owner);
  const fixed = words.words.userIdFixed('shop-a');
  check('userIdFixed: the sentence names the id and the id rides in the old key user_id', /"shop-a"/.test(fixed.detail) && fixed.legacy.user_id === 'shop-a', fixed);
  const outside = words.words.teamOutsideNetwork(Object.assign(new Error('outside'), { hint: 'Pick one.' }));
  check('teamOutsideNetwork: the database\'s own sentence and hint ride along', outside.legacy.message === 'outside' && outside.hint === 'Pick one.', outside);
  const pending = words.words.currencyRefused({ code: 'CURRENCY_NOT_ALLOWED', message: 'XYZ is not available here.', allowed: ['INR'] });
  check('currencyRefused: the library\'s code, sentence and allowed list are kept whole', pending.code === 'CURRENCY_NOT_ALLOWED' && sameValue(pending.legacy, { error: 'Currency not permitted', code: 'CURRENCY_NOT_ALLOWED', message: 'XYZ is not available here.', allowed: ['INR'] }), pending);
}

/** every code the words answer under is a row of docs/ERROR-CODES.md with its sentence written */
function checkCodesRegistered(contract) {
  console.log(String.fromCharCode(10) + '-- the codes the entities routes answer under are in the register --');
  const known = new Set(JSON.parse(fs.readFileSync(REGISTER_FILE, 'utf8')).codes.filter((row) => row.shopkeeper !== 'PENDING').map((row) => row.code));
  const missing = contract.CODES.filter((code) => !known.has(code));
  check('every code the entities words (' + contract.CODES.length + ') answer under is a register row with its sentence written', missing.length === 0, missing);
}

/** the contract in front of the router: every route but sign-in has a row, and a row has a route; a body keeps its typed fields */
function checkContractShape(routes) {
  console.log('\n-- the contract and the router agree --');
  const contract = contractModule();
  const operations = Object.keys(contract.OPERATIONS);
  const swept = Object.keys(routes).filter((key) => !SIGN_IN.includes(key));
  check('every route the router holds but sign-in has an operation, and every operation a route (' + operations.length + ')', sameValue(operations.slice().sort(), swept.sort()), operations.filter((key) => !routes[key]));
  check('the contract holds 23 operations: the 25 routes less POST /register and POST /verify', operations.length === 23 && Object.keys(routes).length === 25, [operations.length, Object.keys(routes).length]);
  const bodies = operations.filter((key) => contract.OPERATIONS[key].requestBody);
  check('every write declares a body that is an object (a list is the schema\'s 400)', bodies.every((key) => contract.OPERATIONS[key].requestBody.content['application/json'].schema.type === 'object'), bodies);
  check('every refusal an operation declares is a Problem', operations.every((key) => Object.keys(contract.OPERATIONS[key].responses).filter((status) => Number(status) >= 400).every((status) => JSON.stringify(contract.OPERATIONS[key].responses[status]).includes('Problem'))));
  check('a malformed path argument is still a 404 or the route\'s own answer, never a 400: the path arguments are plain text', operations.filter((key) => key.includes(':')).every((key) => contract.OPERATIONS[key].parameters.every((one) => one.schema.type === 'string' && !one.schema.pattern)));
}

/* ── the foreign-id world (API-STANDARD S35): shop B asks for shop A's record by its id ── */
/** the routes of this file that name a record by an id in the path: the erasure (an identity) and a population's desk (a code of the platform's own registry) */
const FOREIGN_ROUTES = () => [
  { route: 'PATCH ' + MOUNT + '/:id/erase', url: MOUNT + '/' + scenes.OTHER + '/erase', method: 'PATCH', body: {} },
  { route: 'PUT ' + MOUNT + '/populations/:code/desk', url: MOUNT + '/populations/live/desk', method: 'PUT', body: { desk_entity_id: scenes.OTHER } }
];

/** one play(who, planted) of a foreign-id route: sets the world and asks as the stranger (shop B) or as the owner (shop A); the record is planted for the owner only */
function playFor(port, item) {
  return async (who, planted) => {
    const rows = planted ? () => ({ rows: [{ sealed: false }], rowCount: 1 }) : null;
    Object.assign(world, { realAuth: false, who: who === 'owner' ? OWNER : STRANGER, asKey: false, db: 'ok', sqlRows: rows, jsonThrows: false, noCustomer: false });
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
/**
 * output_allowlist in the shop's own world (API-8, S34): the generator's stand-in database cannot reach the sign-in, the root-only reads or the lib-backed reads of these routes, so here every route whose
 * 200 schema is closed (additionalProperties false, derived from the answers and the handler's own keys) has every recorded 200 fit that schema, and the allow-list filter drops nothing from it:
 * a key the schema does not list would be cut, so a drop here is an answer that moved. → { route: { output_allowlist: true } }
 */
function checkAllowList(recording) {
  console.log('\n-- the closed success schemas hold every recorded 200 --');
  const proved = {};
  const operations = contractModule().OPERATIONS;
  const engine = require(path.join(HERE, 'middleware', 'validate.js')).bodyEngine;
  const { prune } = require(path.join(HERE, 'lib', 'output-allowlist.js'));
  Object.keys(operations).sort().filter((route) => !SIGN_IN.includes(route)).forEach((route) => {
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
/** the shop's routes the evidence file says output_allowlist for */
function allowListEvidenceOnDisk() {
  const routes = JSON.parse(fs.readFileSync(EVIDENCE_FILE, 'utf8')).routes || {};
  return Object.fromEntries(Object.keys(routes).filter((route) => lab.mine(route) && routes[route].output_allowlist).sort().map((route) => [route, { output_allowlist: true }]));
}
/** write this file's output_allowlist rows into the evidence file (other routes and columns stay as they are) */
function writeAllowList(proved) {
  const onDisk = JSON.parse(fs.readFileSync(EVIDENCE_FILE, 'utf8'));
  const routes = onDisk.routes || {};
  Object.keys(routes).filter(lab.mine).forEach((route) => {
    delete routes[route].output_allowlist;
    if (!Object.keys(routes[route]).length) delete routes[route];
  });
  Object.keys(proved).forEach((route) => (routes[route] = Object.assign(routes[route] || {}, proved[route])));
  const sorted = Object.fromEntries(Object.keys(routes).sort().map((route) => [route, routes[route]]));
  fs.writeFileSync(EVIDENCE_FILE, JSON.stringify(Object.assign({}, onDisk, { routes: sorted }), null, 1) + '\n');
}

(async () => {
  if (lab.flagValue('--freeze')) return lab.freeze(lab.flagValue('--freeze'));
  lab.installStubs();
  const router = require(path.join(HERE, ROUTE_FILE));
  const routes = lab.routesOf(router, MOUNT);
  const server = lab.appOf([{ mount: MOUNT, router }]).listen(0);
  const recording = {};
  const capturing = lab.flagValue('--capture') || lab.flagValue('--compare');
  const declared = capturing ? () => [] : contractModule().allowedStatuses();
  const allowed = (route) => (SIGN_IN.includes(route) ? ANY_STATUS : declared(route));
  const scenarios = lab.scenariosOf(routes, WORLDS, extrasList());
  const tested = await lab.checkRoutes(server.address().port, scenarios, recording, allowed, sources);
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
  const allowed200 = checkAllowList(recording);
  server.close();
  checkWords();
  checkCodesRegistered(contractModule());
  checkContractShape(routes);
  const legacy = JSON.parse(fs.readFileSync(lab.legacyFile, 'utf8')).routes;
  const frozen = Object.keys(legacy).filter(lab.mine).reduce((sum, route) => sum + legacy[route].answers.length, 0);
  check('every refusal recorded before the sweep is replayed against the code: ' + frozen + ' answers, each once, byte for byte', frozen > 100, frozen);
  check('a caller who is not signed in is refused with 401 on every route that asks for a sign-in', Object.keys(recording).filter((key) => key.endsWith('|signed-out') && !key.includes('/constitutions') && !SIGN_IN.some((route) => key.startsWith(route + '|'))).every((key) => recording[key].status === 401));
  const leaks = (key) => JSON.stringify(recording[key].body || {}).includes('vault');
  const refused = Object.keys(recording).filter((key) => recording[key].status >= 400);
  check('a refusal or a 500 never says its cause: no answer of 400 and over carries the database text', refused.filter(leaks).length === 0, refused.filter(leaks));
  const SEC94 = ['me-capabilities-fail-leaks-nothing', 'mis-counts-fail-leaks-nothing', 'routing-plain-check-violation', 'desk-plain-check-violation'];
  const thrown = Object.keys(recording).filter((key) => SEC94.some((id) => key.endsWith('|' + id)));
  check('SEC-94: a thrown error never appears in the body, 200 or 4xx or 5xx (' + thrown.length + ' of ' + SEC94.length + ' scenes ran)', thrown.length === SEC94.length && thrown.every((key) => !/vault|secret_role|42501|connected as|superuser=/.test(JSON.stringify(recording[key].body || {}))), thrown.map((key) => [key, recording[key].status, (JSON.stringify(recording[key].body).match(/.{30}(vault|secret_role|42501|connected as|superuser=).{30}/) || [])[0]]));
  check('a 2xx is never a Problem: every success answer keeps its own shape', Object.keys(recording).filter((key) => recording[key].status < 400).every((key) => !/problem\+json/.test(recording[key].type)));
  const coverage = lab.coverageOf(tested);
  const onDisk = JSON.parse(fs.readFileSync(TESTED_FILE, 'utf8'));
  const mine = Object.fromEntries(Object.keys(onDisk).filter(lab.mine).sort().map((route) => [route, onDisk[route]]));
  const judged = Object.fromEntries(Object.keys(coverage).filter((route) => !SIGN_IN.includes(route)).map((route) => [route, coverage[route]]));
  if (lab.argv.includes('--write')) {
    const others = Object.fromEntries(Object.keys(onDisk).filter((route) => !lab.mine(route)).map((route) => [route, onDisk[route]]));
    const merged = Object.assign(others, judged);
    fs.writeFileSync(TESTED_FILE, JSON.stringify(Object.fromEntries(Object.keys(merged).sort().map((route) => [route, merged[route]])), null, 1) + '\n');
    FOREIGN.writeEvidence(EVIDENCE_FILE, lab.mine, foreign.proved);
    writeAllowList(allowed200);
  } else {
    check('docs/contracts/api-hardening-evidence-areas.json says output_allowlist for exactly the shop routes whose 200 held closed here', sameValue(allowListEvidenceOnDisk(), allowed200), { onDisk: Object.keys(allowListEvidenceOnDisk()).length, held: Object.keys(allowed200).length });
    check('docs/contracts/api-error-tests.json lists exactly the statuses these scenarios cover for routes/entities.js (sign-in apart)', sameValue(mine, judged), { onDisk: Object.keys(mine).length, covered: Object.keys(judged).length });
    check('docs/contracts/api-hardening-evidence-areas.json says foreign_id_404 for exactly the routes that held here', sameValue(FOREIGN.evidenceOf(EVIDENCE_FILE, lab.mine), foreign.proved), { onDisk: Object.keys(FOREIGN.evidenceOf(EVIDENCE_FILE, lab.mine)).length, held: Object.keys(foreign.proved).length });
  }
  console.log('\n  ' + lab.count.passed + ' checks, ' + lab.count.failed + ' failed');
  process.exit(lab.count.failed ? 1 : 0);
})();
