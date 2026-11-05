#!/usr/bin/env node
/**
 * api-problem-catalogue.test.cjs — API-4 sweep, the rest of the catalogue: the shopper's orders and documents, the product enquiries and the photo read of routes/catalogue.js, and routes/catalogue-face.js.
 *
 * OWNS      the proof that each refusal of these 9 routes is a Problem body AND still carries the keys it answered before (docs/contracts/api-legacy.json, recorded from the code before the
 *           sweep), that no success answer moved (--compare against a capture of the code before), and this file's rows of docs/contracts/api-error-tests.json. Also: no answer outside the
 *           statuses the contract declares (lib/catalogue-contract.js), its words as units, and the old enquiry chain run beside the schema that replaced it.
 *           The 11 public storefront doors of routes/catalogue.js are tests/api-problem-storefront.test.cjs's.
 * CALLED BY scripts/guards.cjs · CI. No database, no network: the real route files over a stand-in db and auth (tests/lib/problem-world.cjs).
 * FLOW      the nine routes x world (signed out, a failing db, an empty db) + the named extras (tests/lib/catalogue-scenes.cjs) → real route → body → Problem fields present ·
 *           frozen legacy keys equal · no leak on a 5xx · statuses tested → manifest
 *
 *   node tests/api-problem-catalogue.test.cjs                    check
 *   node tests/api-problem-catalogue.test.cjs --write            rewrite this file's rows of docs/contracts/api-error-tests.json
 *   node tests/api-problem-catalogue.test.cjs --capture F        (run on the code BEFORE the change) record each answer to file F
 *   node tests/api-problem-catalogue.test.cjs --freeze F         merge a capture F into docs/contracts/api-legacy.json (the frozen answers)
 *   node tests/api-problem-catalogue.test.cjs --compare F        the answers now against a capture F
 */
'use strict';
const path = require('path');
const fs = require('fs');
const { harness, PARTY, OWNER, STAFF, SECRET_SQL, sameValue, raising, answering, firstOf } = require('./lib/problem-world.cjs');
const scenes = require('./lib/catalogue-scenes.cjs');
const chainTable = require('./lib/catalogue-chains.cjs');

const HERE = path.join(__dirname, '..');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
const CATALOGUE = '/api/catalogue';
const FACE = '/api/catalogue-face';
/** the nine routes this test owns (the other eleven of routes/catalogue.js are the storefront's) */
const OWNED = [
  'GET ' + CATALOGUE + '/enquiry',
  'GET ' + CATALOGUE + '/enquiry/:item_id',
  'POST ' + CATALOGUE + '/enquiry/:item_id',
  'POST ' + CATALOGUE + '/photo-extract',
  'GET ' + CATALOGUE + '/:bridge_id/my-orders',
  'GET ' + CATALOGUE + '/:bridge_id/my-documents',
  'DELETE ' + CATALOGUE + '/:bridge_id/my-documents/:id',
  'GET ' + FACE,
  'PUT ' + FACE
];
const lab = harness({
  here: HERE,
  mounts: [CATALOGUE, FACE],
  routeFiles: { [CATALOGUE]: 'routes/catalogue.js', [FACE]: 'routes/catalogue-face.js' },
  legacyFile: path.join(HERE, 'docs', 'contracts', 'api-legacy.json'),
  owns: (route) => OWNED.includes(route),
  inherited: (scenario, answer) => answer.status === 401,
  notFrozen: (one) => one.status === 401
});
const { check } = lab;
const TESTED_FILE = path.join(HERE, 'docs', 'contracts', 'api-error-tests.json');
const REGISTER_FILE = path.join(HERE, 'docs', 'error-codes.json');
const sources = () => ({ ai: require(path.join(HERE, 'lib', 'ai')) });
const WORLDS = [
  { id: 'signed-out', setup: { realAuth: true } },
  { id: 'db-fails', setup: { db: 'fail' } },
  { id: 'nothing-found', setup: {} }
];
const contractModule = () => require(path.join(HERE, 'lib', 'catalogue-contract.js'));

/** lib/catalogue-contract.js as a unit: the words of a refusal and of a fault, as these routes always said them */
function checkWords() {
  console.log(String.fromCharCode(10) + '-- lib/catalogue-contract.js: the refusals as a unit --');
  const words = contractModule();
  const fault = (status, text) => words.aiFault(Object.assign(new Error(text), { status }), { id: 'r1' });
  const wallet = fault(402, 'Top up.');
  check('aiFault: a skill refusal keeps its status and its sentence', wallet.status === 402 && sameValue(wallet.legacy, { error: 'Photo read failed', message: 'Top up.' }), wallet);
  const empty = fault(429, '');
  check('aiFault: a refusal with no sentence says the generic one', empty.status === 429 && empty.legacy.message === 'Something went wrong — please try again.', empty);
  const server = fault(503, SECRET_SQL);
  check('aiFault: a 5xx keeps its status and says nothing of its cause', server.status === 503 && !JSON.stringify(server).includes('vault'), server);
  const plain = words.aiFault(new Error(SECRET_SQL), { id: 'r1' });
  check('aiFault: anything else is a 500 that says nothing of its cause', plain.status === 500 && !JSON.stringify(plain).includes('vault'), plain);
  const unsupported = words.words.notSupported(['a', 'b']);
  check('notSupported: the old body joins the sentences and lists them as `errors`, text as before', unsupported.legacy.message === 'a; b' && sameValue(unsupported.errors, ['a', 'b']), unsupported);
  const merged = words.mergePaths({ '/p': { get: 1 } }, { '/p': { post: 2 }, '/q': { get: 3 } });
  check('mergePaths: methods of one path from two fragments sit together', sameValue(merged, { '/p': { get: 1, post: 2 }, '/q': { get: 3 } }), merged);
}

/** every code the words and the faults answer under is a register row with its sentence written */
function checkCodesRegistered() {
  console.log(String.fromCharCode(10) + '-- the codes these routes answer under are in the register --');
  const { words } = contractModule();
  const bundle = Object.assign([], { error: 'e', message: 'm' });
  const codes = Object.keys(words).map((name) => words[name](bundle).code);
  const known = new Set(JSON.parse(fs.readFileSync(REGISTER_FILE, 'utf8')).codes.filter((row) => row.shopkeeper !== 'PENDING').map((row) => row.code));
  const missing = [...new Set(codes)].filter((code) => !known.has(code));
  check('every code these words answer under (' + new Set(codes).size + ' codes) is a register row with its sentence written', missing.length === 0, missing);
}

/** the contract in front of the routers: every owned route has an operation, a created answer is 201, the photo read lists the skill's refusals, nothing of the storefront is touched */
function checkContractShape(routes) {
  console.log(String.fromCharCode(10) + '-- the contract and the routers agree --');
  const contract = contractModule();
  const operations = Object.keys(Object.assign({}, contract.catalogue.OPERATIONS, contract.face.OPERATIONS)).sort();
  check('the nine owned routes have an operation each, and every operation is an owned route', sameValue(operations, OWNED.slice().sort()), operations);
  check('every owned route is a route the routers hold', OWNED.every((key) => routes[key]), OWNED.filter((key) => !routes[key]));
  const asked = contract.catalogue.OPERATIONS['POST ' + CATALOGUE + '/enquiry/:item_id'];
  check('the enquiry answers 201 when it is asked, and keeps its required message and its typed thread', '201' in asked.responses && !('200' in asked.responses) && sameValue(asked.requestBody.content['application/json'].schema.required, ['message_text']) && sameValue(asked.requestBody.content['application/json'].schema.properties.thread_type.enum, contract.THREADS), asked);
  const photo = contract.catalogue.OPERATIONS['POST ' + CATALOGUE + '/photo-extract'];
  check('the photo read lists the skill\'s refusals (402 · 429 · 503) beside its own 400', [402, 429, 503].every((status) => (photo['x-catalogue-refusals'] || []).some((one) => one.status === status)) && '400' in photo.responses, photo);
  const storefront = require(path.join(HERE, 'lib', 'storefront-contract.js'));
  const clash = Object.keys(storefront.OPERATIONS).filter((key) => OWNED.includes(key.split(' ')[0] + ' ' + CATALOGUE + key.split(' ')[1]));
  check('no operation here repeats one of the 11 storefront doors', clash.length === 0, clash);
}

/** the router's published paths hold both: the 11 doors and these 7, side by side */
function checkPublishedPaths() {
  const router = require(path.join(HERE, 'routes', 'catalogue.js'));
  const paths = router.openapi.paths;
  const has = (apiPath, method) => !!(paths[apiPath] && paths[apiPath][method]);
  check('routes/catalogue.js publishes its 11 public doors and its 7 signed-in routes together', has('/api/catalogue/{bridge_id}/my-orders', 'get') && has('/api/catalogue/{bridge_id}', 'get') && has('/api/catalogue/enquiry/{item_id}', 'post') && has('/api/catalogue/enquiry/{item_id}', 'get'), Object.keys(paths).length);
}

/** the old enquiry chain and the schema that replaced it refuse the same bodies */
async function checkChainsAgree() {
  console.log(String.fromCharCode(10) + '-- the schema agrees with the chain it replaced --');
  const { schemaValidate } = require(path.join(HERE, 'middleware', 'validate'));
  const contract = contractModule();
  const route = chainTable.ROUTE;
  const operation = contract.catalogue.operationFor(route);
  const outcome = await chainTable.compare(route, schemaValidate(operation, contract.schemaOptionsFor(route)));
  check(route + ': the schema and the chain agree on ' + outcome.cases + ' bodies (verdict and refusal body)', outcome.disagree.length === 0, outcome.disagree.slice(0, 6));
  chainTable.KNOWN_DIFFERENCES.forEach((one) => check(route + ': a known difference holds as recorded: ' + one.what, outcome.known.includes(one.what), outcome.known));
}

/** the sanitiser of the old chain still runs: a message is trimmed before it is stored (the stand-in answers with the text it was given) */
function checkTrimmedReachesTheRow(recording) {
  const asked = recording['POST ' + CATALOGUE + '/enquiry/:item_id|enquiry-asked'];
  const number = recording['POST ' + CATALOGUE + '/enquiry/:item_id|enquiry-number-as-text'];
  check('the enquiry text reaches the database trimmed, and a number reaches it as text, as the chain made it', asked && asked.body.created_at === 'is it fresh?' && number && number.body.created_at === '5', [asked && asked.body, number && number.body]);
}

/**
 * API-8 output allow-list (S34), the way tests/api-problem-orders.test.cjs proves it: the face read's derived 200 shape (docs/contracts/api-output-shapes.json) is CLOSED at its root
 * and every recorded 200 of it (no face yet · a saved face · a saved face with no stamp) fits it, nullable columns included; the allow-list ran for real (OUTPUT_ALLOWLIST=enforce) and cut nothing.
 */
function checkAllowList(recording) {
  console.log(String.fromCharCode(10) + '-- the closed success shape of the face read holds every recorded 200 --');
  const { shapeOf, droppedKeys } = require(path.join(HERE, 'lib', 'output-allowlist.js'));
  const engine = require(path.join(HERE, 'middleware', 'validate.js')).bodyEngine;
  const route = 'GET ' + FACE;
  const shape = shapeOf(route);
  const answers = Object.values(recording).filter((one) => one.route === route && one.status === 200 && one.body);
  const fits = shape && engine.compile(shape.schema);
  check(route + ': every recorded 200 (' + answers.length + ') fits the closed shape of its root', !!shape && shape.schema.additionalProperties === false && answers.length > 0 && answers.every((one) => fits(one.body)), { answers: answers.length, errors: fits && fits.errors });
  check('the output allow-list dropped no key from any answer', droppedKeys().length === 0, droppedKeys());
}

process.on('unhandledRejection', (failure) => console.log('  (unhandled rejection: ' + String(failure && failure.message).slice(0, 80) + ')'));
(async () => {
  if (lab.flagValue('--freeze')) return lab.freeze(lab.flagValue('--freeze'));
  lab.installStubs();
  const catalogueRouter = require(path.join(HERE, 'routes', 'catalogue.js'));
  const faceRouter = require(path.join(HERE, 'routes', 'catalogue-face.js'));
  const held = Object.assign({}, lab.routesOf(catalogueRouter, CATALOGUE), lab.routesOf(faceRouter, FACE));
  const routes = Object.fromEntries(Object.keys(held).filter((key) => OWNED.includes(key)).map((key) => [key, held[key]]));
  const server = lab.appOf([{ mount: CATALOGUE, router: catalogueRouter }, { mount: FACE, router: faceRouter }]).listen(0);
  const recording = {};
  const capturing = lab.flagValue('--capture') || lab.flagValue('--compare');
  const contract = capturing ? null : contractModule();
  const allowed = capturing ? () => [] : (route) => (contract.catalogue.allowedStatuses()(route) || []).concat(contract.face.allowedStatuses()(route) || []);
  const scenarios = lab.scenariosOf(routes, WORLDS, scenes.extras({ PARTY, OWNER, STAFF, SECRET_SQL, raising, answering, firstOf }), {});
  const tested = await lab.checkRoutes(server.address().port, scenarios, recording, allowed, sources);
  server.close();
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
  checkContractShape(held);
  checkPublishedPaths();
  await checkChainsAgree();
  checkTrimmedReachesTheRow(recording);
  checkAllowList(recording);
  const legacy = JSON.parse(fs.readFileSync(lab.legacyFile, 'utf8')).routes;
  const frozen = Object.keys(legacy).filter(lab.mine).reduce((sum, route) => sum + legacy[route].answers.length, 0);
  check('every refusal recorded before the sweep is replayed against the code: ' + frozen + ' answers, each once, byte for byte', frozen > 30, frozen);
  check('a 500 never says its cause: no answer of any route carries the database text', Object.values(recording).every((one) => !JSON.stringify(one.body || {}).includes('vault')));
  const coverage = lab.coverageOf(tested);
  const onDisk = JSON.parse(fs.readFileSync(TESTED_FILE, 'utf8'));
  const mine = Object.fromEntries(Object.keys(onDisk).filter(lab.mine).sort().map((route) => [route, onDisk[route]]));
  if (lab.argv.includes('--write')) {
    const others = Object.fromEntries(Object.keys(onDisk).filter((route) => !lab.mine(route)).map((route) => [route, onDisk[route]]));
    const merged = Object.assign(others, coverage);
    fs.writeFileSync(TESTED_FILE, JSON.stringify(Object.fromEntries(Object.keys(merged).sort().map((route) => [route, merged[route]])), null, 1) + '\n');
  } else check('docs/contracts/api-error-tests.json lists exactly the statuses these scenarios cover for the nine routes', sameValue(mine, coverage), { onDisk: Object.keys(mine).length, covered: Object.keys(coverage).length });
  console.log(String.fromCharCode(10) + '  ' + lab.count.passed + ' checks, ' + lab.count.failed + ' failed');
  process.exit(lab.count.failed ? 1 : 0);
})();
