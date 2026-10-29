#!/usr/bin/env node
// @type: contract
/**
 * api-problem-crm.test.cjs — API-4 sweep, the CRM: every refusal of routes/crm.js (24 routes, mounted at /api/crm).
 *
 * OWNS      the proof that each refusal of the CRM routes is a Problem body AND still carries the keys it answered before (docs/contracts/api-legacy.json, recorded from the
 *           code before the sweep), that no success answer moved (--compare against a capture of the code before), this file's rows of docs/contracts/api-error-tests.json
 *           (the statuses each route is tested for, which the register's error_tests column reads), and the "signed in as another shop" world: a record addressed by an id in
 *           the path answers another shop's id exactly as it answers an unknown id (API-STANDARD S35, tests/lib/foreign-id-world.cjs), recorded in
 *           docs/contracts/api-hardening-evidence-areas.json. Also: no answer outside the statuses the contract declares (lib/crm-contract.js) and its words as units.
 * CALLED BY scripts/guards.cjs · CI. No database, no network: the real routes/crm.js and the real libraries over the in-memory stand-in (tests/support/crm-stub.cjs,
 *           the world and the scenes in tests/lib/crm-scenes.cjs).
 * FLOW      route list (read from the router) x world (signed out, a key, a viewer, staff, a failing db, an empty db, a bad id) + the named scenes → real route → body →
 *           Problem fields present · frozen legacy keys equal · no leak on a 5xx · statuses tested → manifest; then the foreign-id world → evidence
 * CARD      11-crm-and-marketing/crm-routes
 *
 *   node tests/api-problem-crm.test.cjs                    check
 *   node tests/api-problem-crm.test.cjs --write            rewrite this file's rows of docs/contracts/api-error-tests.json and api-hardening-evidence-areas.json
 *   node tests/api-problem-crm.test.cjs --capture F        (run on the code BEFORE the change) record each answer to file F
 *   node tests/api-problem-crm.test.cjs --freeze F         merge a capture F into docs/contracts/api-legacy.json (the frozen answers)
 *   node tests/api-problem-crm.test.cjs --compare F        the answers now against a capture F: byte for byte for a success, the old keys in order for a refusal
 */
'use strict';
const path = require('path');
const fs = require('fs');
const { harness, sameValue } = require('./lib/problem-world.cjs');
const S = require('./lib/crm-scenes.cjs');
const foreign = require('./lib/foreign-id-world.cjs');

const HERE = path.join(__dirname, '..');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
const MOUNT = '/api/crm';
const TESTED_FILE = path.join(HERE, 'docs', 'contracts', 'api-error-tests.json');
const EVIDENCE_FILE = path.join(HERE, 'docs', 'contracts', 'api-hardening-evidence-areas.json');
const REGISTER_FILE = path.join(HERE, 'docs', 'error-codes.json');
const ADDED = new Set(S.extras().filter((one) => one.after).map((one) => one.id));
const { make, row } = require('./support/crm-stub.cjs');
const stub = make();
const D = stub.data;
let W = S.FRESH_WORLD();
const lab = harness({
  here: HERE,
  mounts: [MOUNT],
  routeFiles: { [MOUNT]: 'routes/crm.js' },
  legacyFile: path.join(HERE, 'docs', 'contracts', 'api-legacy.json'),
  inherited: (scenario, answer) => answer.status === 401 && scenario.id === 'signed-out',
  notFrozen: (one, scenario) => (one.status === 401 && scenario === 'signed-out') || ADDED.has(scenario),
  before: (scenario) => prepare(scenario)
});
const { check } = lab;
const WORLDS = [
  { id: 'signed-out', setup: { signedOut: true } },
  { id: 'key-asks', setup: { key: true } },
  { id: 'viewer-asks', setup: { who: 'viewer' } },
  { id: 'staff-asks', setup: { who: 'staff' } },
  { id: 'db-fails', setup: { db: 'fail' } },
  { id: 'nothing-found', setup: { empty: true } },
  { id: 'bad-id', setup: {}, badId: true }
];
const contractModule = () => require(path.join(HERE, 'lib', 'crm-contract.js'));

/** the stand-in database in the state a scenario asks for, and the sign-in it asks as */
function prepare(scenario) {
  const asked = scenario.setup || {};
  W = S.FRESH_WORLD();
  S.seed(D, W, row);
  D.extra = S.extraOf(D, W);
  require(path.join(HERE, 'lib', 'schema'))._reset();
  require(path.join(HERE, 'lib', 'crm-followups')).forget();
  if (asked.world) Object.assign(W, asked.world);
  if (asked.empty) Object.assign(D, { cust: [], sup: [], followups: [], interactions: [], walk: [] });
  if (scenario.data) scenario.data(D, W);
  if (scenario.world) scenario.world(W);
  if (asked.world && asked.world.migrated === false) D.migrated = false;
  require(path.join(HERE, 'lib', 'privacy')).forget();
  D.pre = asked.db === 'fail' ? async () => { throw new Error(S.SECRET_SQL); } : S.preOf(D, W, row);
  const login = S.LOGINS[asked.who || 'owner'];
  stub.as(login.entity, { identity: login.identity, key: !!asked.key, signedOut: !!asked.signedOut });
}

/** the modules a scene may swap a function of: a library call that fails like a database (the scene's `patch`) */
const sources = () => ({
  local: require(path.join(HERE, 'lib', 'local-identity')),
  memberships: require(path.join(HERE, 'lib', 'memberships')),
  leads: require(path.join(HERE, 'lib', 'crm-leads'))
});

/** lib/crm-contract.js as a unit: the words of a refusal and of a fault, as these routes always said them */
function checkWords() {
  console.log('\n-- lib/crm-contract.js: the CRM refusals as a unit --');
  const words = contractModule();
  const req = { id: 'r1' };
  const refused = words.crmFault(Object.assign(new Error('Because.'), { status: 409, code: 'EXISTS', why: 'W' }), req);
  check('crmFault: a refusal keeps its status, code, sentence and why', refused.status === 409 && refused.code === 'EXISTS' && sameValue(refused.legacy, { code: 'EXISTS', error: 'Because.', message: 'Because.', why: 'W' }), refused);
  const bare = words.crmFault(Object.assign(new Error('Because.'), { status: 400 }), req);
  check('crmFault: a refusal with no code is REFUSED', bare.code === 'REFUSED' && bare.legacy.code === 'REFUSED' && !('why' in bare.legacy), bare);
  const b276 = words.crmFault(Object.assign(new Error('long'), { code: 'CRM_NOT_MIGRATED', status: 503 }), req);
  check('crmFault: b276 not run is the short 503', b276.status === 503 && sameValue(b276.legacy, { code: 'CRM_NOT_MIGRATED', error: 'Not migrated yet', message: 'CRM needs migration b276 — not run yet.' }), b276);
  const tableGone = words.crmFault(Object.assign(new Error('relation "party_followup" does not exist'), { code: '42P01' }), req);
  check('crmFault: a missing table is the same 503', tableGone.status === 503 && tableGone.code === 'CRM_NOT_MIGRATED', tableGone);
  const privacy = words.crmFault(Object.assign(new Error('Privacy records need migration b306 — not run yet.'), { code: 'PRIVACY_NOT_MIGRATED', status: 503 }), req);
  check('crmFault: privacy not run keeps its sentence under "Not migrated yet"', privacy.status === 503 && privacy.legacy.error === 'Not migrated yet' && privacy.legacy.message.includes('b306'), privacy);
  const leads = words.crmFault(Object.assign(new Error('Lead stages arrive after the next update.'), { code: 'LEADS_NOT_MIGRATED', status: 503 }), req);
  check('crmFault: leads not run sends its sentence as error and message', leads.legacy.error === leads.legacy.message && leads.code === 'LEADS_NOT_MIGRATED', leads);
  const fault = words.crmFault(new Error(S.SECRET_SQL), req);
  check('crmFault: anything else is a 500 that says nothing of its cause', fault.status === 500 && fault.code === 'INTERNAL' && sameValue(fault.legacy, { error: 'Failed', message: 'Something went wrong — please try again.' }) && !JSON.stringify(fault).includes('vault'), fault);
  const key = words.keyFence();
  check('keyFence: the sign-in sentence, SIGN_IN', key.code === 'SIGN_IN' && sameValue(key.legacy, { code: 'SIGN_IN', error: 'Sign in to use CRM.', message: 'Sign in to use CRM.' }), key);
  const schema = words.schemaOptions.legacy([{ detail: 'body must be an object.' }]);
  check('schemaOptions: a body the schema refuses is answered 400 in the CRM\'s own three keys', words.schemaOptions.status === 400 && sameValue(schema, { code: 'CRM_BAD_REQUEST', error: 'body must be an object.', message: 'body must be an object.' }), schema);
}

/** every code the words answer under is a row of docs/ERROR-CODES.md with its sentence written */
function checkCodesRegistered() {
  console.log('\n-- the codes the CRM routes answer under are in the register --');
  const codes = contractModule().CODES;
  const known = new Set(JSON.parse(fs.readFileSync(REGISTER_FILE, 'utf8')).codes.filter((item) => item.shopkeeper !== 'PENDING').map((item) => item.code));
  const missing = codes.filter((code) => !known.has(code));
  check('every code the CRM words answer under (' + codes.length + ' codes) is a register row with its sentence written', missing.length === 0, missing);
}

/** the contract in front of the router: every route has a row, and a row has a route; ids stay plain text so the handler's own sentence answers */
function checkContractShape(routes) {
  console.log('\n-- the contract and the router agree --');
  const contract = contractModule();
  const operations = Object.keys(contract.OPERATIONS);
  check('every route the router holds has an operation, and every operation a route (' + operations.length + ')', sameValue(operations.slice().sort(), Object.keys(routes).sort()), operations.filter((key) => !routes[key]));
  const record = contract.OPERATIONS['GET /api/crm/parties/:id'];
  check('a malformed party id is still the handler\'s 400 BAD_ID: the path argument is plain text', record.parameters[0].schema.type === 'string' && !record.parameters[0].schema.pattern, record.parameters);
  check('a body keeps its named fields and requires none (the handlers answer a missing one in their own words)', Object.values(contract.OPERATIONS).filter((one) => one.requestBody).every((one) => !(one.requestBody.content['application/json'].schema.required || []).length));
  check('every refusal an operation declares is a Problem', operations.every((key) => Object.keys(contract.OPERATIONS[key].responses).filter((status) => Number(status) >= 400).every((status) => JSON.stringify(contract.OPERATIONS[key].responses[status]).includes('Problem'))));
}

/**
 * the harness judges a 5xx as "says nothing of its cause" and replays no frozen body for it; a 503 here is a deliberate refusal ("not migrated yet", in the words a screen maps
 * to its own line), so each frozen 503 is replayed here: the same status and every old key, byte for byte and in order
 */
function checkFrozen503(recording) {
  console.log('\n-- the frozen 503 answers (a migration not run) are replayed --');
  const legacy = JSON.parse(fs.readFileSync(lab.legacyFile, 'utf8')).routes;
  let replayed = 0;
  Object.keys(legacy).filter(lab.mine).forEach((route) => legacy[route].answers.filter((frozen) => frozen.status === 503).forEach((frozen) => {
    const now = recording[route + '|' + frozen.scenario];
    const order = Object.keys(frozen.fixture);
    replayed++;
    check(route + ' · ' + frozen.scenario + ': the frozen 503 body is kept, key by key and in order', !!now && now.status === 503 && sameValue(order.map((name) => now.body[name]), order.map((name) => frozen.fixture[name])) && sameValue(Object.keys(now.body).slice(0, order.length), order), now && now.body);
  }));
  check('at least ten 503 answers were frozen and replayed (' + replayed + ')', replayed >= 10, replayed);
}

/**
 * output_allowlist in the CRM's own world (API-8, S34): the generator's stand-in database answers 404 or 422 to a record read, so the routes addressed by a party id could not be proved
 * there. Here every route whose 200 schema is closed (additionalProperties false, derived from the answers and the handler's own keys) has every recorded 200 fit that schema, and
 * the allow-list filter drops nothing from it: a key the schema does not list would be cut, so a drop here is an answer that moved. → { route: { output_allowlist: true } }
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
/** the CRM routes the evidence file says output_allowlist for */
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

/** the "signed in as another shop" world: every route addressed by an id or a name in its path (API-STANDARD S35) */
async function foreignWorld(port) {
  console.log('\n-- the 9th world: signed in as another shop --');
  const C = MOUNT;
  const asks = [
    ['GET /api/crm/parties/:id', 'GET', '/parties/' + S.IDS.chola],
    ['GET /api/crm/parties/:id/timeline', 'GET', '/parties/' + S.IDS.chola + '/timeline'],
    ['GET /api/crm/parties/:id/contact-prefs', 'GET', '/parties/' + S.IDS.chola + '/contact-prefs'],
    ['POST /api/crm/parties/:id/contact-prefs', 'POST', '/parties/' + S.IDS.chola + '/contact-prefs', { channel: 'phone', purpose: 'service', allowed: false }],
    ['POST /api/crm/parties/:id/interactions', 'POST', '/parties/' + S.IDS.chola + '/interactions', { kind: 'note', body: 'x' }],
    ['POST /api/crm/parties/:id/outcome', 'POST', '/parties/' + S.IDS.lead + '/outcome', { outcome: 'interested' }],
    ['POST /api/crm/parties/:id/stage', 'POST', '/parties/' + S.IDS.lead + '/stage', { stage: 'trial' }],
    ['DELETE /api/crm/parties/:id', 'DELETE', '/parties/' + S.IDS.plain],
    ['PATCH /api/crm/followups/:id', 'PATCH', '/followups/' + S.P(21), { done: true }],
    ['DELETE /api/crm/followups/:id', 'DELETE', '/followups/' + S.P(21)],
    ['DELETE /api/crm/groups/:name', 'DELETE', '/groups/Dealers']
  ];
  const cases = asks.map(([route, method, url, body]) => ({
    route,
    play: async (who, planted) => {
      prepare({ setup: { who: who === 'owner' ? 'owner' : 'stranger' } });
      if (!planted) Object.assign(D, { cust: D.cust.filter((one) => one.owner !== SHOP_A), sup: [], followups: D.followups.filter((one) => one.owner !== SHOP_A) });
      return lab.send(port, method, MOUNT + url, body).catch(() => null);
    }
  }));
  const seen = foreign.recorder();
  const failures = await foreign.runCases(cases, seen.record);
  failures.forEach((sentence) => check('foreign id: ' + sentence, false));
  asks.forEach(([route]) => check(route + ': another shop\'s id answers exactly as an unknown id (404, same body); the owner\'s own id is not a 404', !failures.some((one) => one.startsWith(route))));
  return seen.proved();
}
const SHOP_A = S.SHOP;

process.on('unhandledRejection', (failure) => console.log('  (unhandled rejection: ' + String(failure && failure.message).slice(0, 80) + ')'));
(async () => {
  if (lab.flagValue('--freeze')) {
    lab.freeze(lab.flagValue('--freeze'));
    process.exit(0);
  }
  const router = require(path.join(HERE, 'routes', 'crm.js'));
  const routes = lab.routesOf(router, MOUNT);
  const server = lab.appOf([{ mount: MOUNT, router }]).listen(0);
  const port = server.address().port;
  const recording = {};
  const capturing = lab.flagValue('--capture') || lab.flagValue('--compare');
  const allowed = capturing ? () => [] : contractModule().allowedStatuses();
  const values = { id: S.IDS.chola, name: 'Dealers', key: 'regular' };
  const scenarios = lab.scenariosOf(routes, WORLDS, S.extras(), values);
  const tested = await lab.checkRoutes(port, scenarios, recording, allowed, sources);
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
  checkFrozen503(recording);
  const proved = await foreignWorld(port);
  const allowed200 = checkAllowList(recording);
  server.close();
  stub.close();
  const legacy = JSON.parse(fs.readFileSync(lab.legacyFile, 'utf8')).routes;
  const frozen = Object.keys(legacy).filter(lab.mine).reduce((sum, route) => sum + legacy[route].answers.length, 0);
  check('every refusal recorded before the sweep is replayed against the code: ' + frozen + ' answers, each once, byte for byte', frozen > 100, frozen);
  check('a caller who is not signed in is refused with 401 on every route', Object.keys(recording).filter((key) => key.endsWith('|signed-out')).every((key) => recording[key].status === 401));
  check('a 500 never says its cause: no answer of any route carries the database text', Object.values(recording).filter((one) => one.status >= 500).every((one) => !/SELECT|vault|relation "/.test(JSON.stringify(one.body || {}))));
  const coverage = lab.coverageOf(tested);
  const onDisk = JSON.parse(fs.readFileSync(TESTED_FILE, 'utf8'));
  const mine = Object.fromEntries(Object.keys(onDisk).filter(lab.mine).sort().map((route) => [route, onDisk[route]]));
  if (lab.argv.includes('--write')) {
    const others = Object.fromEntries(Object.keys(onDisk).filter((route) => !lab.mine(route)).map((route) => [route, onDisk[route]]));
    const merged = Object.assign(others, coverage);
    fs.writeFileSync(TESTED_FILE, JSON.stringify(Object.fromEntries(Object.keys(merged).sort().map((route) => [route, merged[route]])), null, 1) + '\n');
    foreign.writeEvidence(EVIDENCE_FILE, lab.mine, proved);
    writeAllowList(allowed200);
  } else {
    check('docs/contracts/api-hardening-evidence-areas.json says output_allowlist for exactly the CRM routes whose 200 held closed here', sameValue(allowListEvidenceOnDisk(), allowed200), { onDisk: Object.keys(allowListEvidenceOnDisk()).length, held: Object.keys(allowed200).length });
    check('docs/contracts/api-error-tests.json lists exactly the statuses these scenarios cover for routes/crm.js', sameValue(mine, coverage), { onDisk: Object.keys(mine).length, covered: Object.keys(coverage).length });
    check('docs/contracts/api-hardening-evidence-areas.json says exactly what the foreign-id world showed', sameValue(foreign.evidenceOf(EVIDENCE_FILE, lab.mine), proved), proved);
  }
  console.log('\n  ' + lab.count.passed + ' checks, ' + lab.count.failed + ' failed');
  process.exit(lab.count.failed ? 1 : 0);
})();
