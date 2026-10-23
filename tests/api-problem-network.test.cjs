#!/usr/bin/env node
/**
 * api-problem-network.test.cjs — API-4 sweep, the network: every answer of src/routes/network.js, routes/network-design.js and routes/connections.js (23 routes).
 *
 * OWNS      the proof that each refusal of the network routes is a Problem body AND still carries the keys it answered before (docs/contracts/api-legacy.json, recorded from the code
 *           before the sweep), that no success answer moved (--compare against a capture of the code before), this file's rows of docs/contracts/api-error-tests.json (the statuses
 *           each route is tested for, which the register's error_tests column reads), and the "signed in as another shop" world: a record addressed by an id in the path answers another
 *           shop's id exactly as it answers an unknown id (API-STANDARD S35, tests/lib/foreign-id-world.cjs), recorded in docs/contracts/api-hardening-evidence.json. Also: no answer
 *           outside the statuses the route's contract declares (lib/network-contract.js), its words as units, and the schemas that replaced the connections' validator chains.
 * CALLED BY scripts/guards.cjs · CI. No database, no network: the real route files over a stand-in db, auth and network tables (tests/lib/network-memory.cjs).
 * FLOW      route list (read from the three routers) x world (signed out, staff, a bad id, a failing db, an empty db) + the named extras (tests/lib/network-scenes.cjs) → real route →
 *           body → Problem fields present · frozen legacy keys equal · no leak on a 5xx · statuses tested → manifest; then the writes switched off (503) and the foreign-id world
 * CARD      04-network/connections-and-invitations
 *
 *   node tests/api-problem-network.test.cjs                    check
 *   node tests/api-problem-network.test.cjs --write            rewrite this file's rows of docs/contracts/api-error-tests.json and api-hardening-evidence.json
 *   node tests/api-problem-network.test.cjs --capture F        (run on the code BEFORE the change) record each answer to file F
 *   node tests/api-problem-network.test.cjs --freeze F         merge a capture F into docs/contracts/api-legacy.json (the frozen answers)
 *   node tests/api-problem-network.test.cjs --compare F        the answers now against a capture F: byte for byte for a success, the old keys in order for a refusal
 */
'use strict';
const path = require('path');
const fs = require('fs');
const { harness, OWNER, STAFF, SECRET_SQL, sameValue, raising, answering, firstOf } = require('./lib/problem-world.cjs');
const scenes = require('./lib/network-scenes.cjs');
const { memory, B, NODE, EDGE, CONNECTION } = require('./lib/network-memory.cjs');
const chains = require('./lib/network-chains.cjs');
const FOREIGN = require('./lib/foreign-id-world.cjs');

const HERE = path.join(__dirname, '..');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
const MOUNTS = ['/api/network', '/api/network-design', '/api/connections'];
/** the route files these mounts serve (named in full so the graph links this test to each of them) */
const ROUTE_FILES = { '/api/network': 'src/routes/network.js', '/api/network-design': 'routes/network-design.js', '/api/connections': 'routes/connections.js' };
const lab = harness({
  here: HERE,
  mounts: MOUNTS,
  routeFiles: ROUTE_FILES,
  legacyFile: path.join(HERE, 'docs', 'contracts', 'api-legacy.json'),
  inherited: (scenario, answer) => answer.status === 401 && scenario.id === 'signed-out',
  notFrozen: (one, scenario) => (one.status === 401 && scenario === 'signed-out') || AFTER.has(scenario),
  cannotRide: (route, scenario) => (route === 'POST /api/connections/request' && scenario === 'handshake-already-there' ? ['status'] : []) /* the Problem owns `status`: the state rides in params.connection_status */
});
const { check, world } = lab;
const TESTED_FILE = path.join(HERE, 'docs', 'contracts', 'api-error-tests.json');
const REGISTER_FILE = path.join(HERE, 'docs', 'error-codes.json');
const EVIDENCE_FILE = path.join(HERE, 'docs', 'contracts', 'api-hardening-evidence.json');
const STRANGER = { identity_id: B, identity_type: 'entity', display_name: 'Shop B' };
const WORLDS = [
  { id: 'signed-out', setup: { realAuth: true } },
  { id: 'staff-asks', setup: { who: STAFF } },
  { id: 'bad-id', setup: {}, badId: true },
  { id: 'db-fails', setup: { db: 'fail' } },
  { id: 'nothing-found', setup: {} }
];
const sources = () => ({
  net: require(path.join(HERE, 'src', 'services', 'network')),
  run: require(path.join(HERE, 'lib', 'network-build-run')),
  otp: require(path.join(HERE, 'lib', 'otp')),
  membership: require(path.join(HERE, 'lib', 'network-membership'))
});
const contractModule = () => require(path.join(HERE, 'lib', 'network-contract.js'));
const extrasList = () => scenes.extras({ OWNER, STAFF, SECRET_SQL, raising, answering, firstOf });
const AFTER = new Set(extrasList().filter((one) => one.after).map((one) => one.id));

/** the network's own database (src/db.js: pool and withTx) answers through the same stand-in as the rest, before any route file loads */
function standInTreeDb() {
  const file = require.resolve(path.join(HERE, 'src', 'db.js'));
  const client = { query: async (sql, params) => lab.rowsFor(sql, params), release: () => undefined };
  const stand = { pool: { query: client.query, connect: async () => client }, withTx: async (run) => run(client) };
  require.cache[file] = { id: file, filename: file, loaded: true, exports: stand };
}

/** a second copy of the tree routes loaded with the kill switch thrown (NETWORK_WRITE_ENABLED=false): the file reads it once, when it loads */
function loadSwitchedOff() {
  const file = require.resolve(path.join(HERE, ROUTE_FILES['/api/network']));
  const enabled = require.cache[file];
  const was = process.env.NETWORK_WRITE_ENABLED;
  delete require.cache[file];
  process.env.NETWORK_WRITE_ENABLED = 'false';
  const copy = require(file);
  if (was === undefined) delete process.env.NETWORK_WRITE_ENABLED;
  else process.env.NETWORK_WRITE_ENABLED = was;
  require.cache[file] = enabled;
  return copy;
}

/** lib/network-contract.js as a unit: the words of a refusal and of a fault, as these routes always said them */
function checkWords() {
  console.log('\n-- lib/network-contract.js: the refusals as a unit --');
  const words = contractModule();
  const req = { id: 'r1' };
  const refused = words.netFault(Object.assign(new Error('only the two businesses on this connection can act on it'), { status: 403, code: 'NOT_ALLOWED' }), req);
  check('netFault: a refusal of the service keeps its status, its code and its words', refused.status === 403 && refused.code === 'NOT_ALLOWED' && sameValue(refused.legacy, { error: 'only the two businesses on this connection can act on it', code: 'NOT_ALLOWED' }), refused);
  const bare = words.netFault(Object.assign(new Error('Because.'), { status: 409 }), req);
  check('netFault: a refusal with no code is ERR, as the route always said', bare.code === 'ERR' && bare.legacy.code === 'ERR', bare);
  const lost = words.netFault(new Error(SECRET_SQL), req);
  check('netFault: anything else is a 500 that says nothing of its cause, with the code ERR it always had', lost.status === 500 && lost.code === 'ERR' && lost.legacy.code === 'ERR' && !JSON.stringify(lost).includes('vault'), lost);
  const failed = words.failed(new Error(SECRET_SQL), req, 'Load failed');
  check('failed: the screen\'s own label and the safe sentence, never the cause', failed.status === 500 && failed.legacy.error === 'Load failed' && !JSON.stringify(failed).includes('vault'), failed);
  const root = words.relayed({ status: 409, body: { error: 'Root name taken', code: 'ROOT_HANDLE_TAKEN', message: 'Taken.' } });
  check('relayed: a refusal the build made keeps its body whole and its code', root.code === 'ROOT_HANDLE_TAKEN' && sameValue(root.legacy, { error: 'Root name taken', code: 'ROOT_HANDLE_TAKEN', message: 'Taken.' }), root);
  const exists = words.words.connectionExists('pending');
  check('connectionExists: the sentence names the state, and the state travels in params (the Problem owns `status`)', /status: pending/.test(exists.detail) && exists.params.connection_status === 'pending', exists);
}

/** the refusals src/services/network.js throws, read from the service itself: err(status, 'sentence', 'CODE') → [{ status, code }] */
function serviceRefusals() {
  const source = fs.readFileSync(path.join(HERE, 'src', 'services', 'network.js'), 'utf8');
  return [...source.matchAll(/err\((\d{3}), [^\n]*?, '([A-Z_]+)'\)/g)].map((found) => ({ status: Number(found[1]), code: found[2] }));
}

/** every code the words answer under, and every code the service throws, is a row of docs/ERROR-CODES.md with its sentence written; every refusal the service throws is documented on a route */
function checkCodesRegistered(contract) {
  console.log(String.fromCharCode(10) + '-- the codes the network routes answer under are in the register --');
  const refusals = serviceRefusals();
  const codes = [...new Set(contract.CODES.concat(refusals.map((one) => one.code)))];
  const known = new Set(JSON.parse(fs.readFileSync(REGISTER_FILE, 'utf8')).codes.filter((row) => row.shopkeeper !== 'PENDING').map((row) => row.code));
  const missing = codes.filter((code) => !known.has(code));
  check('every code the network words (' + contract.CODES.length + ') and the service (' + refusals.length + ' refusals) answer under is a register row with its sentence written', missing.length === 0, missing);
  const documented = new Set(Object.values(contract.OPERATIONS).flatMap((operation) => Object.keys(operation).filter((key) => /-refusals$/.test(key)).flatMap((key) => operation[key].map((one) => one.status + ' ' + one.code))));
  const plain = (one) => (one.status === 404 && one.code === 'NOT_FOUND');
  const undocumented = refusals.filter((one) => !plain(one) && !documented.has(one.status + ' ' + one.code));
  check('every refusal the service throws is listed on a route of the contract (x-network-refusals)', undocumented.length === 0, undocumented);
}

/** the contract in front of the routers: every route has a row, and a row has a route; a body keeps its typed fields */
function checkContractShape(routes) {
  console.log('\n-- the contract and the routers agree --');
  const contract = contractModule();
  const operations = Object.keys(contract.OPERATIONS);
  check('every route the routers hold has an operation, and every operation a route (' + operations.length + ')', sameValue(operations.slice().sort(), Object.keys(routes).sort()), operations.filter((key) => !routes[key]));
  check('the contract holds 23 operations: 12 tree, 7 design, 4 handshake', operations.length === 23 && operations.filter((key) => key.includes('/api/network/')).length === 12 && operations.filter((key) => key.includes('/api/network-design')).length === 7 && operations.filter((key) => key.includes('/api/connections')).length === 4, operations.length);
  const respond = contract.OPERATIONS['PUT /api/connections/:id/respond'].requestBody.content['application/json'].schema;
  check('a body keeps its typed fields and its required list (the answer to a request is accept or reject)', sameValue(respond.required, ['action']) && respond.properties.action.type === 'string', respond);
  check('a malformed id is still a 404, never a 400: the path argument is plain text', contract.OPERATIONS['POST /api/network/connections/:id/approve'].parameters[0].schema.type === 'string' && !contract.OPERATIONS['POST /api/network/connections/:id/approve'].parameters[0].schema.pattern);
  const written = operations.filter((key) => key.startsWith('POST /api/network/'));
  check('every write of the tree lists the kill switch\'s 503', written.every((key) => contract.OPERATIONS[key].responses['503']), written.filter((key) => !contract.OPERATIONS[key].responses['503']));
  check('every refusal an operation declares is a Problem', operations.every((key) => Object.keys(contract.OPERATIONS[key].responses).filter((status) => Number(status) >= 400).every((status) => JSON.stringify(contract.OPERATIONS[key].responses[status]).includes('Problem'))));
}

/** the schemas that replaced the express-validator chains refuse exactly what the chains refused */
async function checkChainsAgree() {
  console.log('\n-- the schemas agree with the chains they replaced --');
  const { schemaValidate } = require(path.join(HERE, 'middleware', 'validate'));
  const contract = contractModule();
  for (const route of Object.keys(chains.CHAINS)) {
    const operation = contract.connections.operationFor(route);
    const comparer = chains.createComparer({ chains: chains.CHAINS, valid: chains.VALID, known: chains.known });
    const schemaCheck = schemaValidate(operation, contract.schemaOptions.connections(route));
    const outcome = await comparer.compare(route, (req, res, next) => contract.trimmedFor(route)(req, res, () => schemaCheck(req, res, next)));
    check(route + ': the trimmed schema and the chain agree on ' + outcome.cases + ' bodies (verdict and refusal body)', outcome.disagree.length === 0, outcome.disagree.slice(0, 6));
    chains.KNOWN_DIFFERENCES.filter((one) => one.route === route).forEach((one) => check(route + ': a known difference holds as recorded: ' + one.what, outcome.known.includes(one.what), outcome.known));
  }
}

/* ── the foreign-id world (API-STANDARD S35): shop B asks for shop A's record by its id ── */
const REQUEST = (method, body) => ({ method, body });
/** the routes of the network that name a record by an id in the path, each with the url that asks for it */
const FOREIGN_ROUTES = () => {
  const node = (verb) => '/api/network/entities/' + NODE.c + '/' + verb;
  const edge = (verb) => '/api/network/connections/' + EDGE + '/' + verb;
  const reads = ['subtree', 'connections'].map((verb) => ({ route: 'GET /api/network/entities/:id/' + verb, url: node(verb), request: REQUEST('GET') }));
  const claim = { route: 'POST /api/network/entities/:id/claim', url: node('claim'), request: REQUEST('POST', {}) };
  const edges = ['approve', 'decline', 'disconnect', 'resume', 'suspend'].map((verb) => ({ route: 'POST /api/network/connections/:id/' + verb, url: edge(verb), request: REQUEST('POST', {}) }));
  const respond = { route: 'PUT /api/connections/:id/respond', url: '/api/connections/' + CONNECTION + '/respond', request: REQUEST('PUT', { action: 'accept' }) };
  return reads.concat([claim], edges, [respond]);
};

/** one play(who, planted) of a foreign-id route: sets the world, plants shop A's record (or not) and asks as the stranger (shop B) or as the owner (shop A) */
function playFor(port, item) {
  return async (who, planted) => {
    const rows = planted ? memory({ tree: true, edge: { state: 'requested' }, request: true }) : memory({ lonely: true });
    Object.assign(world, { realAuth: false, who: who === 'owner' ? OWNER : STRANGER, asKey: false, db: 'ok', sqlRows: rows.answer, jsonThrows: false, noCustomer: false });
    return lab.send(port, item.request.method, item.url, item.request.body);
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
  standInTreeDb();
  const mounted = MOUNTS.map((mount) => ({ mount, router: require(path.join(HERE, ROUTE_FILES[mount])) }));
  const routes = Object.assign({}, ...mounted.map((one) => lab.routesOf(one.router, one.mount)));
  const server = lab.appOf(mounted).listen(0);
  const offRouter = loadSwitchedOff();
  const offServer = lab.appOf([{ mount: MOUNTS[0], router: offRouter }]).listen(0);
  const recording = {};
  const capturing = lab.flagValue('--capture') || lab.flagValue('--compare');
  const allowed = capturing ? () => [] : contractModule().allowedStatuses();
  const scenarios = lab.scenariosOf(routes, WORLDS, extrasList(), { id: EDGE });
  const tested = await lab.checkRoutes(server.address().port, scenarios, recording, allowed, sources);
  const switchedOff = lab.scenariosOf(Object.fromEntries(Object.entries(lab.routesOf(offRouter, MOUNTS[0])).filter(([route]) => route.startsWith('POST '))), [{ id: 'writes-switched-off', setup: {} }], [], { id: EDGE });
  const offTested = await lab.checkRoutes(offServer.address().port, switchedOff.map((one) => Object.assign({ expect: 503 }, one)), recording, allowed, sources);
  Object.keys(offTested).forEach((route) => (tested[route] = new Set([...(tested[route] || []), ...offTested[route]])));
  if (lab.flagValue('--capture')) {
    server.close();
    offServer.close();
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
  offServer.close();
  checkWords();
  checkCodesRegistered(contractModule());
  checkContractShape(routes);
  await checkChainsAgree();
  const legacy = JSON.parse(fs.readFileSync(lab.legacyFile, 'utf8')).routes;
  const frozen = Object.keys(legacy).filter(lab.mine).reduce((sum, route) => sum + legacy[route].answers.length, 0);
  check('every refusal recorded before the sweep is replayed against the code: ' + frozen + ' answers, each once, byte for byte', frozen > 100, frozen);
  check('a caller who is not signed in is refused with 401 on every route', Object.keys(recording).filter((key) => key.endsWith('|signed-out')).every((key) => recording[key].status === 401));
  const leaks = (key) => JSON.stringify(recording[key].body || {}).includes('vault');
  const refused = Object.keys(recording).filter((key) => recording[key].status >= 400);
  check('a refusal or a 500 never says its cause: no answer of 400 and over carries the database text', refused.filter(leaks).length === 0, refused.filter(leaks));
  check('a 2xx is never a Problem: every success answer keeps its own shape', Object.keys(recording).filter((key) => recording[key].status < 400).every((key) => !/problem\+json/.test(recording[key].type)));
  check('the writes switched off answer 503 on all eight writes of the tree', Object.keys(recording).filter((key) => key.endsWith('|writes-switched-off')).length === 8 && Object.keys(recording).filter((key) => key.endsWith('|writes-switched-off')).every((key) => recording[key].status === 503));
  const coverage = lab.coverageOf(tested);
  const onDisk = JSON.parse(fs.readFileSync(TESTED_FILE, 'utf8'));
  const mine = Object.fromEntries(Object.keys(onDisk).filter(lab.mine).sort().map((route) => [route, onDisk[route]]));
  if (lab.argv.includes('--write')) {
    const others = Object.fromEntries(Object.keys(onDisk).filter((route) => !lab.mine(route)).map((route) => [route, onDisk[route]]));
    const merged = Object.assign(others, coverage);
    fs.writeFileSync(TESTED_FILE, JSON.stringify(Object.fromEntries(Object.keys(merged).sort().map((route) => [route, merged[route]])), null, 1) + '\n');
    FOREIGN.writeEvidence(EVIDENCE_FILE, lab.mine, foreign.proved);
  } else {
    check('docs/contracts/api-error-tests.json lists exactly the statuses these scenarios cover for the three network route files', sameValue(mine, coverage), { onDisk: Object.keys(mine).length, covered: Object.keys(coverage).length });
    check('docs/contracts/api-hardening-evidence.json says foreign_id_404 for exactly the routes that held here', sameValue(FOREIGN.evidenceOf(EVIDENCE_FILE, lab.mine), foreign.proved), { onDisk: Object.keys(FOREIGN.evidenceOf(EVIDENCE_FILE, lab.mine)).length, held: Object.keys(foreign.proved).length });
  }
  console.log('\n  ' + lab.count.passed + ' checks, ' + lab.count.failed + ' failed');
  process.exit(lab.count.failed ? 1 : 0);
})();
