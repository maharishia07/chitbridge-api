#!/usr/bin/env node
/**
 * api-problem-products.test.cjs — API-4 sweep, the catalogue items: every answer of routes/products.js.
 *
 * OWNS      the proof that each refusal of the 26 products routes is a Problem body AND still carries the keys it answered before (docs/contracts/api-legacy.json, recorded
 *           from the code before the sweep), that no success answer moved (--compare against a capture of the code before), and this file's rows of docs/contracts/api-error-tests.json
 *           (the statuses each route is tested for, which the register's error_tests column reads). Also: no answer outside the statuses the route's contract declares
 *           (lib/products-contract.js), and that contract's words as units. The old express-validator chains run beside the schemas that replaced them, to prove they agree.
 * CALLED BY scripts/guards.cjs · CI. No database, no network: the real route file over a stand-in db and auth (tests/lib/problem-world.cjs).
 * FLOW      route list (read from the router itself) x world (signed out, staff, a failing db, an empty db) + the named extras (tests/lib/products-scenes.cjs) → real route → body →
 *           Problem fields present · frozen legacy keys equal · no leak on a 5xx · statuses tested → manifest
 *
 *   node tests/api-problem-products.test.cjs                    check
 *   node tests/api-problem-products.test.cjs --write            rewrite this file's rows of docs/contracts/api-error-tests.json
 *   node tests/api-problem-products.test.cjs --capture F        (run on the code BEFORE the change) record each answer to file F
 *   node tests/api-problem-products.test.cjs --freeze F         merge a capture F into docs/contracts/api-legacy.json (the frozen answers)
 *   node tests/api-problem-products.test.cjs --compare F        the answers now against a capture F: byte for byte for a success, the old keys in order for a refusal
 */
'use strict';
const path = require('path');
const fs = require('fs');
const { harness, PARTY, OWNER, STAFF, SECRET_SQL, sameValue, raising, answering, firstOf } = require('./lib/problem-world.cjs');
const scenes = require('./lib/products-scenes.cjs');
const chainTable = require('./lib/products-chains.cjs');

const HERE = path.join(__dirname, '..');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
const MOUNT = '/api/products';
const lab = harness({
  here: HERE,
  mounts: [MOUNT],
  routeFiles: { [MOUNT]: 'routes/products.js' },
  legacyFile: path.join(HERE, 'docs', 'contracts', 'api-legacy.json'),
  inherited: (scenario, answer) => answer.status === 401 && scenario.id === 'signed-out',
  notFrozen: (one, scenario) => one.status === 401 && scenario === 'signed-out'
});
const { check } = lab;
const TESTED_FILE = path.join(HERE, 'docs', 'contracts', 'api-error-tests.json');
const REGISTER_FILE = path.join(HERE, 'docs', 'error-codes.json');
const EVIDENCE_FILE = path.join(HERE, 'docs', 'contracts', 'api-hardening-evidence-areas.json');
const sources = () => ({
  store: require(path.join(HERE, 'lib', 'storage-object')),
  schedule: require(path.join(HERE, 'lib', 'schedule')),
  catwrite: require(path.join(HERE, 'lib', 'catalogue-write')),
  cost: require(path.join(HERE, 'lib', 'cost')),
  schema: require(path.join(HERE, 'lib', 'schema')),
  boot: require(path.join(HERE, 'lib', 'schema-bootstrap')),
  cats: require(path.join(HERE, 'lib', 'categories')),
  gov: require(path.join(HERE, 'lib', 'govresolve')),
  starter: require(path.join(HERE, 'lib', 'starter-fields'))
});
const WORLDS = [
  { id: 'signed-out', setup: { realAuth: true } },
  { id: 'staff-asks', setup: { who: STAFF } },
  { id: 'db-fails', setup: { db: 'fail' } },
  { id: 'nothing-found', setup: {} }
];
const contractModule = () => require(path.join(HERE, 'lib', 'products-contract.js'));

/** lib/products-contract.js as a unit: the words of a refusal and of a fault, as the products routes always said them */
function checkWords() {
  console.log('\n-- lib/products-contract.js: the products refusals as a unit --');
  const words = contractModule();
  const fault = (status, text) => words.faultOf(Object.assign(new Error(text || 'Because.'), { status }), { id: 'r1' }, 'Add failed');
  [[400, 'PRODUCT_BAD_REQUEST'], [404, 'NOT_FOUND'], [409, 'PRODUCT_CLASH'], [422, 'PRODUCT_REFUSED']].forEach(([status, code]) => {
    const spec = fault(status);
    check('faultOf: a refusal with status ' + status + ' keeps its status, its words and the screen\'s label (' + code + ')', spec.status === status && spec.code === code && sameValue(spec.legacy, { error: 'Add failed', message: 'Because.' }), spec);
  });
  const server = fault(502, SECRET_SQL);
  check('faultOf: a 5xx from a library says nothing of its cause', server.status === 500 && server.code === 'INTERNAL' && !JSON.stringify(server).includes('vault'), server);
  const plain = words.faultOf(new Error(SECRET_SQL), { id: 'r1' }, 'List failed');
  check('faultOf: anything else is a 500 INTERNAL that says nothing of its cause, the label kept', plain.status === 500 && plain.legacy.error === 'List failed' && !JSON.stringify(plain).includes('vault'), plain);
  const odd = words.badStatus(Object.assign(new Error('x'), { status: 400 }), 'Say this.');
  check('badStatus: the library\'s status and sentence under the label "Bad status"', odd.status === 400 && sameValue(odd.legacy, { error: 'Bad status', message: 'Say this.' }), odd);
  const declined = words.words.declined('Invalid product', { error: 'Because.', code: 'SERVER_OWNED' });
  check('declined: a server-owned key travels with its code, in the place it had', sameValue(Object.keys(declined.legacy), ['error', 'code', 'message']) && declined.code === 'SERVER_OWNED', declined);
  const plainDecl = words.words.declined('Invalid product', { error: 'Because.', code: null });
  check('declined: no code, none in the old body', sameValue(Object.keys(plainDecl.legacy), ['error', 'message']), plainDecl);
}

/** every code the words and the faults can answer under is a row of docs/ERROR-CODES.md with its sentence written */
function checkCodesRegistered() {
  console.log(String.fromCharCode(10) + '-- the codes the products routes answer under are in the register --');
  const { words, faultOf } = contractModule();
  const bundle = Object.assign([], { error: 'e', message: 'm', code: 'COST_BLIND' });
  const codes = Object.keys(words).map((name) => words[name](bundle, bundle).code);
  codes.push(words.scheduleRefused({ error: 'not_enabled' }).code, words.declined('x', { error: 'e', code: null }).code);
  [400, 404, 409, 422, 413].forEach((status) => codes.push(faultOf(Object.assign(new Error('x'), { status }), {}, 'x').code));
  const known = new Set(JSON.parse(fs.readFileSync(REGISTER_FILE, 'utf8')).codes.filter((row) => row.shopkeeper !== 'PENDING').map((row) => row.code));
  const missing = [...new Set(codes)].filter((code) => !known.has(code));
  check('every code the products words and faults answer under (' + new Set(codes).size + ' codes) is a register row with its sentence written', missing.length === 0, missing);
}

/** lib/contract-kit.js as widened for this sweep: a row's own refusals join the area's list */
function checkKitWidening() {
  console.log('\n-- lib/contract-kit.js: a row\'s own refusals --');
  const kit = require(path.join(HERE, 'lib', 'contract-kit.js'));
  const spec = { mount: '/api/x', refusals: [{ status: 400 }], refusalsWhen: 'said', extension: 'x-refusals' };
  const built = kit.contractOf(Object.assign({ routes: { 'GET /a': { summary: 'a', gates: ['said'], refusals: [{ status: 429 }] }, 'GET /b': { summary: 'b', refusals: [{ status: 429 }] }, 'GET /c': { summary: 'c', gates: ['said'] }, 'GET /d': { summary: 'd' } } }, spec));
  const listed = (route) => (built.OPERATIONS['GET /api/x' + route]['x-refusals'] || []).map((one) => one.status);
  check('kit: a row with the area gate and its own refusals lists both, the area\'s first', sameValue(listed('/a'), [400, 429]), listed('/a'));
  check('kit: a row with only its own refusals lists those', sameValue(listed('/b'), [429]), listed('/b'));
  check('kit: a row with only the gate lists the area\'s', sameValue(listed('/c'), [400]), listed('/c'));
  check('kit: a row with neither lists none', sameValue(listed('/d'), []), listed('/d'));
}

/** the contract in front of the router: every route has a row, and a row has a route; the downloads declare their media type */
function checkContractShape(routes) {
  console.log('\n-- the contract and the router agree --');
  const contract = contractModule();
  const operations = Object.keys(contract.OPERATIONS);
  check('every route the router holds has an operation, and every operation a route (' + operations.length + ')', sameValue(operations.sort(), Object.keys(routes).sort()), operations.filter((key) => !routes[key]));
  const media = (key) => Object.keys(contract.OPERATIONS[key].responses['200'].content)[0];
  check('the workbook is declared as a spreadsheet, the export as csv, a picture as bytes', /spreadsheetml/.test(media('GET /api/products/workbook.xlsx')) && media('GET /api/products/export.csv') === 'text/csv' && media('GET /api/products/media/:item_id/:mid') === 'application/octet-stream');
  const media404 = contract.OPERATIONS['GET /api/products/media/:item_id/:mid'];
  check('the picture door asks for no credentials: no security, no 401', sameValue(media404.security, []) && !('401' in media404.responses), Object.keys(media404.responses));
  const limited = ['POST /api/products/bulk', 'POST /api/products/import', 'POST /api/products/import/preflight', 'POST /api/products/lists/adopt'];
  check('the four routes behind a limiter list its 429', limited.every((key) => (contract.OPERATIONS[key]['x-products-refusals'] || []).some((one) => one.status === 429)));
  const typed = contract.OPERATIONS['POST /api/products/status/bulk'].requestBody.content['application/json'].schema;
  check('a body keeps its typed fields and its required list (ids and status)', sameValue(typed.required, ['ids', 'status']) && typed.properties.ids.type === 'array' && typed.properties.status.type === 'string', typed);
}

/** the schemas that replaced the express-validator chains refuse exactly what the chains refused */
async function checkChainsAgree() {
  console.log('\n-- the schemas agree with the chains they replaced --');
  const { schemaValidate } = require(path.join(HERE, 'middleware', 'validate'));
  const contract = contractModule();
  for (const route of Object.keys(contract.CHAINS)) {
    const outcome = await chainTable.compare(route, contract.operationFor(route), schemaValidate(contract.operationFor(route), contract.schemaOptionsFor(route)));
    check(route + ': the schema and the chain agree on ' + outcome.cases + ' bodies (verdict and refusal body)', outcome.disagree.length === 0, outcome.disagree.slice(0, 6));
    chainTable.KNOWN_DIFFERENCES.filter((one) => one.route === route).forEach((one) => check(route + ': a known difference holds as recorded: ' + one.what, outcome.known.includes(one.what), outcome.known));
  }
}

/**
 * output_allowlist in the shop's own world (API-8, S34): the generator's stand-in database answers these reads from an empty shelf, so here every route whose 200 schema is closed (additionalProperties false,
 * derived from the answers and the handler's own keys) has every recorded 200 fit that schema, and the allow-list filter drops nothing from it. A key the schema does not list would be cut, so a drop
 * here is an answer that moved. → { route: { output_allowlist: true } }
 */
function checkAllowList(recording) {
  console.log('\n-- the closed success schemas hold every recorded 200 --');
  const proved = {};
  const operations = contractModule().OPERATIONS;
  const engine = require(path.join(HERE, 'middleware', 'validate.js')).bodyEngine;
  const { prune } = require(path.join(HERE, 'lib', 'output-allowlist.js'));
  Object.keys(operations).sort().forEach((route) => {
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
/** the products routes the evidence file says output_allowlist for */
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

process.on('unhandledRejection', (failure) => console.log('  (unhandled rejection: ' + String(failure && failure.message).slice(0, 80) + ')'));
(async () => {
  if (lab.flagValue('--freeze')) return lab.freeze(lab.flagValue('--freeze'));
  lab.installStubs();
  const router = require(path.join(HERE, 'routes', 'products.js'));
  const routes = lab.routesOf(router, MOUNT);
  const server = lab.appOf([{ mount: MOUNT, router }]).listen(0);
  const recording = {};
  const capturing = lab.flagValue('--capture') || lab.flagValue('--compare');
  const allowed = capturing ? () => [] : contractModule().allowedStatuses();
  const scenarios = lab.scenariosOf(routes, WORLDS, scenes.extras({ PARTY, OWNER, STAFF, SECRET_SQL, raising, answering, firstOf }), {});
  const tested = await lab.checkRoutes(server.address().port, scenarios, recording, allowed, sources);
  server.close();
  const allowed200 = checkAllowList(recording);
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
  checkKitWidening();
  checkContractShape(routes);
  await checkChainsAgree();
  const legacy = JSON.parse(fs.readFileSync(lab.legacyFile, 'utf8')).routes;
  const frozen = Object.keys(legacy).filter(lab.mine).reduce((sum, route) => sum + legacy[route].answers.length, 0);
  check('every refusal recorded before the sweep is replayed against the code: ' + frozen + ' answers, each once, byte for byte', frozen > 100, frozen);
  check('a caller who is not signed in is refused with 401 on every route that asks for sign-in', Object.keys(recording).filter((key) => key.endsWith('|signed-out')).every((key) => recording[key].status === 401 || /media/.test(key)));
  check('a 500 never says its cause: no answer of any route carries the database text', Object.values(recording).every((one) => !JSON.stringify(one.body || {}).includes('vault')));
  const coverage = lab.coverageOf(tested);
  const onDisk = JSON.parse(fs.readFileSync(TESTED_FILE, 'utf8'));
  const mine = Object.fromEntries(Object.keys(onDisk).filter(lab.mine).sort().map((route) => [route, onDisk[route]]));
  if (lab.argv.includes('--write')) {
    const others = Object.fromEntries(Object.keys(onDisk).filter((route) => !lab.mine(route)).map((route) => [route, onDisk[route]]));
    const merged = Object.assign(others, coverage);
    fs.writeFileSync(TESTED_FILE, JSON.stringify(Object.fromEntries(Object.keys(merged).sort().map((route) => [route, merged[route]])), null, 1) + '\n');
    writeAllowList(allowed200);
  } else {
    check('docs/contracts/api-hardening-evidence-areas.json says output_allowlist for exactly the products routes whose 200 held closed here', sameValue(allowListEvidenceOnDisk(), allowed200), { onDisk: Object.keys(allowListEvidenceOnDisk()).length, held: Object.keys(allowed200).length });
    check('docs/contracts/api-error-tests.json lists exactly the statuses these scenarios cover for routes/products.js', sameValue(mine, coverage), { onDisk: Object.keys(mine).length, covered: Object.keys(coverage).length });
  }
  console.log('\n  ' + lab.count.passed + ' checks, ' + lab.count.failed + ' failed');
  process.exit(lab.count.failed ? 1 : 0);
})();
