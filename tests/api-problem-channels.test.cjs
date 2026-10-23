#!/usr/bin/env node
// @type: contract
/**
 * api-problem-channels.test.cjs — API-4 sweep, the channels: every refusal of routes/channels.js (10 routes, mounted at /api/channels).
 *
 * OWNS      the proof that each refusal of the channel routes is a Problem body AND still carries the keys it answered before (docs/contracts/api-legacy.json, recorded from the
 *           code before the sweep), that no success answer moved (--compare against a capture of the code before), this file's rows of docs/contracts/api-error-tests.json
 *           (the statuses each route is tested for, which the register's error_tests column reads), and the "signed in as another shop" world: a binding addressed by an id in the
 *           path answers another shop's id exactly as it answers an unknown id (API-STANDARD S35, tests/lib/foreign-id-world.cjs), recorded in docs/contracts/api-hardening-evidence.json.
 *           Also: the old relay modes kept exactly (which routes pass a library's sentence on, at which statuses), the three platform doors with and without their key, every 503 replayed
 *           word for word, no thrown text in any answer, and lib/channels-contract.js as units.
 * CALLED BY scripts/guards.cjs · CI. No database, no network: the real routes/channels.js and the real lib/channels.js over the stand-in db and sign-in (tests/lib/problem-world.cjs,
 *           the scenes in tests/lib/channels-scenes.cjs).
 * FLOW      route list (read from the router) x world (signed out, staff, a failing db, an empty db, a bad id) + the named scenes → real route → body →
 *           Problem fields present · frozen legacy keys equal · no leak on a 5xx · statuses tested → manifest; then the foreign-id world → evidence
 * CARD      11-crm-and-marketing/channels
 *
 *   node tests/api-problem-channels.test.cjs                    check
 *   node tests/api-problem-channels.test.cjs --write            rewrite this file's rows of docs/contracts/api-error-tests.json and api-hardening-evidence.json
 *   node tests/api-problem-channels.test.cjs --capture F        (run on the code BEFORE the change) record each answer to file F
 *   node tests/api-problem-channels.test.cjs --freeze F         merge a capture F into docs/contracts/api-legacy.json (the frozen answers)
 *   node tests/api-problem-channels.test.cjs --compare F        the answers now against a capture F: byte for byte for a success, the old keys in order for a refusal
 */
'use strict';
const path = require('path');
const fs = require('fs');
const express = require('express');
const { harness, PARTY, OWNER, STAFF, SECRET_SQL, sameValue, answering, raising, firstOf } = require('./lib/problem-world.cjs');
const scenes = require('./lib/channels-scenes.cjs');
const foreign = require('./lib/foreign-id-world.cjs');

const HERE = path.join(__dirname, '..');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
const MOUNT = '/api/channels';
const OTHER_SHOP = '99999999-9999-4999-8999-999999999999';
const STRANGER = { identity_id: OTHER_SHOP, identity_type: 'entity', display_name: 'Other shop' };
const TESTED_FILE = path.join(HERE, 'docs', 'contracts', 'api-error-tests.json');
const EVIDENCE_FILE = path.join(HERE, 'docs', 'contracts', 'api-hardening-evidence.json');
const REGISTER_FILE = path.join(HERE, 'docs', 'error-codes.json');
const SAFE = 'Something went wrong — please try again.';
const tools = { PARTY, OWNER, STAFF, SECRET_SQL, answering, raising, firstOf };
/** the scenes that are answers the sweep ADDS (the schema's refusal): never frozen */
const ADDED = new Set(scenes.extras(tools).filter((one) => one.after).map((one) => one.id));
const asked = { adminHeader: null };
const lab = harness({
  here: HERE,
  mounts: [MOUNT],
  routeFiles: { [MOUNT]: 'routes/channels.js' },
  legacyFile: path.join(HERE, 'docs', 'contracts', 'api-legacy.json'),
  inherited: (scenario, answer) => answer.status === 401 && scenario.id === 'signed-out',
  notFrozen: (one, scenario) => (one.status === 401 && scenario === 'signed-out') || ADDED.has(scenario),
  before: (scenario) => prepare(scenario)
});
const { check } = lab;
const sources = () => ({ channels: require(path.join(HERE, 'lib', 'channels')) });
const WORLDS = [
  { id: 'signed-out', setup: { realAuth: true } },
  { id: 'staff-asks', setup: { who: STAFF } },
  { id: 'db-fails', setup: { db: 'fail' } },
  { id: 'nothing-found', setup: {} },
  { id: 'bad-id', setup: {}, badId: true }
];
const contractModule = () => require(path.join(HERE, 'lib', 'channels-contract.js'));

/** the platform key a scenario sets on the server and the one it sends; the schema cache forgotten so every scenario reads its own columns */
function prepare(scenario) {
  const setup = scenario.setup || {};
  asked.adminHeader = setup.adminKey || null;
  if (setup.envKey) process.env.CB_ADMIN_KEY = setup.envKey;
  else delete process.env.CB_ADMIN_KEY;
  require(path.join(HERE, 'lib', 'schema'))._reset();
}

/** the router behind a front that adds the platform key header a scenario asks to send (the harness sends no headers of its own) */
function withKeyHeader(router) {
  const front = express.Router();
  front.use((req, res, next) => {
    if (asked.adminHeader) req.headers['x-cb-admin-key'] = asked.adminHeader;
    next();
  });
  front.use(router);
  return front;
}

/** lib/channels-contract.js as a unit: the words of a refusal and of a fault, as these routes always said them */
function checkWords() {
  console.log('\n-- lib/channels-contract.js: the channel refusals as a unit --');
  const words = contractModule();
  const req = { id: 'r1' };
  const refused = words.faultOf(Object.assign(new Error('Unknown channel'), { status: 400 }), req, 'Bind failed', 'below500');
  check('faultOf: a refusal below 500 keeps its status and its sentence under the screen label', refused.status === 400 && refused.code === 'CHANNEL_BAD_REQUEST' && sameValue(refused.legacy, { error: 'Bind failed', message: 'Unknown channel' }), refused);
  const taken = words.faultOf(Object.assign(new Error('That business number is already in use.'), { status: 409 }), req, 'Bind failed', 'below500');
  check('faultOf: 409 is CHANNEL_ADDRESS_TAKEN', taken.status === 409 && taken.code === 'CHANNEL_ADDRESS_TAKEN', taken);
  const missing = words.faultOf(Object.assign(new Error('Channels not migrated yet (b123).'), { status: 503, code: 'CHANNEL_STORE_MISSING' }), req, 'Revoke failed', 'any');
  check('faultOf: relay "any" passes a 503 sentence on, with the library\'s own code', missing.status === 503 && missing.code === 'CHANNEL_STORE_MISSING' && missing.legacy.message === 'Channels not migrated yet (b123).', missing);
  const held = words.faultOf(Object.assign(new Error('Channels not migrated yet (b123).'), { status: 503 }), req, 'Bind failed', 'below500');
  check('faultOf: relay "below500" does NOT pass a 503 sentence on: the status stays, the words are the safe sentence', held.status === 503 && sameValue(held.legacy, { error: 'Bind failed', message: SAFE }) && held.detail !== 'Channels not migrated yet (b123).', held);
  const none = words.faultOf(Object.assign(new Error(SECRET_SQL), { status: 503 }), req, 'List failed', 'none');
  check('faultOf: relay "none" keeps the status and never the words', none.status === 503 && sameValue(none.legacy, { error: 'List failed', message: SAFE }) && !JSON.stringify(none).includes('vault'), none);
  const fault = words.faultOf(new Error(SECRET_SQL), req, 'Unbind failed', 'any');
  check('faultOf: an error with no status is a 500 that says nothing of its cause', fault.status === 500 && fault.code === 'INTERNAL' && sameValue(fault.legacy, { error: 'Unbind failed', message: SAFE }) && !JSON.stringify(fault).includes('vault'), fault);
  const off = words.adminOff();
  check('adminOff: the 503 sentence, error then message, as it always was', off.code === 'ADMIN_DISABLED' && sameValue(off.legacy, { error: 'Admin disabled', message: 'CB_ADMIN_KEY is not set on this server.' }), off);
  const wrong = words.adminWrongKey();
  check('adminWrongKey: the bare Forbidden', wrong.code === 'ADMIN_KEY_WRONG' && sameValue(wrong.legacy, { error: 'Forbidden' }), wrong);
  const schema = words.schemaOptions.legacy([{ field: '(body)', detail: '(body) must be an object.' }]);
  check('schemaOptions: a body the schema refuses is answered 400 in the express-validator body', words.schemaOptions.status === 400 && sameValue(schema, { error: 'Validation failed', details: [{ field: '(body)', message: '(body) must be an object.' }] }), schema);
}

/** every code the words answer under is a row of docs/ERROR-CODES.md with its sentence written */
function checkCodesRegistered() {
  console.log('\n-- the codes the channel routes answer under are in the register --');
  const codes = contractModule().CODES;
  const known = new Set(JSON.parse(fs.readFileSync(REGISTER_FILE, 'utf8')).codes.filter((row) => row.shopkeeper !== 'PENDING').map((row) => row.code));
  const missing = codes.filter((code) => !known.has(code));
  check('every code the channel words answer under (' + codes.length + ' codes) is a register row with its sentence written', missing.length === 0, missing);
}

/** the contract in front of the router: every route has a row, and a row has a route; the platform doors ask for no session; ids stay plain text */
function checkContractShape(routes) {
  console.log('\n-- the contract and the router agree --');
  const contract = contractModule();
  const operations = Object.keys(contract.OPERATIONS);
  check('every route the router holds has an operation, and every operation a route (' + operations.length + ')', sameValue(operations.slice().sort(), Object.keys(routes).sort()), operations.filter((key) => !routes[key]));
  ['approve', 'revoke', 'template-approve'].forEach((door) => {
    const operation = contract.OPERATIONS['POST /api/channels/:id/' + door];
    check('POST /:id/' + door + ' is a platform door: no session security, no 401, the platform key\'s 403 and 503 declared', sameValue(operation.security, []) && !('401' in operation.responses) && '403' in operation.responses && '503' in operation.responses, Object.keys(operation.responses));
  });
  check('a bind is answered 201, as it always was', '201' in contract.OPERATIONS['POST /api/channels'].responses && !('200' in contract.OPERATIONS['POST /api/channels'].responses));
  check('a binding id is plain text: the library asks the database and says its own 404', contract.OPERATIONS['DELETE /api/channels/:id'].parameters[0].schema.type === 'string' && !contract.OPERATIONS['DELETE /api/channels/:id'].parameters[0].schema.pattern);
  check('a body keeps its named fields and requires none (the library answers a missing one in its own words)', Object.values(contract.OPERATIONS).filter((one) => one.requestBody).every((one) => !(one.requestBody.content['application/json'].schema.required || []).length));
  check('every refusal an operation declares is a Problem', operations.every((key) => Object.keys(contract.OPERATIONS[key].responses).filter((status) => Number(status) >= 400).every((status) => JSON.stringify(contract.OPERATIONS[key].responses[status]).includes('Problem'))));
}

/**
 * the harness judges a 5xx as "says nothing of its cause" and replays no frozen body for it; a 503 here is a deliberate refusal ("not migrated yet", "admin disabled") whose words a
 * screen or an operator reads, so each frozen 503 is replayed here: the same status and every old key, byte for byte and in order
 */
function checkFrozen503(recording) {
  console.log('\n-- the frozen 503 answers are replayed --');
  const legacy = JSON.parse(fs.readFileSync(lab.legacyFile, 'utf8')).routes;
  let replayed = 0;
  Object.keys(legacy).filter(lab.mine).forEach((route) =>
    legacy[route].answers.filter((frozen) => frozen.status === 503).forEach((frozen) => {
      const now = recording[route + '|' + frozen.scenario];
      const order = Object.keys(frozen.fixture);
      replayed++;
      check(route + ' · ' + frozen.scenario + ': the frozen 503 body is kept, key by key and in order', !!now && now.status === 503 && sameValue(order.map((name) => now.body[name]), order.map((name) => frozen.fixture[name])) && sameValue(Object.keys(now.body).slice(0, order.length), order), now && now.body);
    })
  );
  check('at least ten 503 answers were frozen and replayed (' + replayed + ')', replayed >= 10, replayed);
}

/** the relay modes: a library error with a status is answered with its own sentence on exactly the routes and statuses the catches always passed it on (a 503 stands for "a status the library raised") */
function checkRelayModes(recording) {
  console.log('\n-- the old relay modes are kept --');
  const said = (key) => recording[key] && recording[key].body && recording[key].body.message;
  const relays = [
    'POST /api/channels/:id/provider-ref|relay-provider-ref',
    'POST /api/channels/:id/auto-raise|relay-auto-raise',
    'POST /api/channels/:id/approve|relay-approve',
    'POST /api/channels/:id/revoke|relay-revoke',
    'DELETE /api/channels/:id|relay-unbind'
  ];
  relays.forEach((key) => check(key.split('|')[0] + ': a library error with a status is passed on with its own sentence at any status (the old "any")', said(key) === 'Because: library words.', said(key)));
  const held = [
    'GET /api/channels|relay-list',
    'GET /api/channels/outbound|relay-outbound',
    'POST /api/channels|relay-bind',
    'POST /api/channels/:id/template|relay-template',
    'POST /api/channels/:id/template-approve|relay-template-approve'
  ];
  held.forEach((key) => check(key.split('|')[0] + ': a library error with a 5xx status says only the safe sentence (the old "never" / "below 500")', said(key) === SAFE && recording[key].status === 500, recording[key]));
}

/** the "signed in as another shop" world: every route with a binding addressed by an id in its path that a shop (not the platform) may call (API-STANDARD S35) */
async function foreignWorld(port) {
  console.log('\n-- the 9th world: signed in as another shop --');
  const C = MOUNT;
  const rows = scenes.rowsOf(tools);
  const mineOnly = (answer) => (sql, params) => (params && params[1] === OWNER.identity_id ? answer(sql, params) : null);
  const asks = [
    ['POST /api/channels/:id/provider-ref', 'POST', C + '/' + scenes.BINDING + '/provider-ref', { provider_ref: '1234567890' }, rows.providerRef],
    ['POST /api/channels/:id/auto-raise', 'POST', C + '/' + scenes.BINDING + '/auto-raise', { on: true }, rows.autoRaise],
    ['POST /api/channels/:id/template', 'POST', C + '/' + scenes.BINDING + '/template', { name: 'order_status_update', state: 'pending' }, rows.template],
    ['DELETE /api/channels/:id', 'DELETE', C + '/' + scenes.BINDING, undefined, rows.removed]
  ];
  const cases = asks.map(([route, method, url, body, answer]) => ({
    route,
    play: async (who, planted) => {
      prepare({ setup: {} });
      Object.assign(lab.world, { realAuth: false, db: 'ok', who: who === 'owner' ? OWNER : STRANGER, sqlRows: planted ? mineOnly(answer) : null });
      return lab.send(port, method, url, body);
    }
  }));
  const seen = foreign.recorder();
  const failures = await foreign.runCases(cases, seen.record);
  failures.forEach((sentence) => check('foreign id: ' + sentence, false));
  asks.forEach(([route]) => check(route + ': another shop\'s id answers exactly as an unknown id (404, same body); the owner\'s own id is not a 404', !failures.some((one) => one.startsWith(route))));
  return seen.proved();
}

/** no answer of any scenario carries the text a failing database or a patched library threw; the one stored provider text a 200 passes on (GET /outbound) is a recorded finding, held as it is */
function checkNoThrownText(recording) {
  console.log('\n-- no thrown text in any answer --');
  const answers = Object.keys(recording).map((key) => [key, JSON.stringify(recording[key].body || recording[key].text || '')]);
  const leaking = answers.filter(([, text]) => /SELECT|vault|relation "/.test(text)).map(([key]) => key);
  check('no answer, whatever its status, carries the database text a scene threw (' + answers.length + ' answers scanned)', leaking.length === 0, leaking);
  const outbound = recording['GET /api/channels/outbound|outbound-page'];
  check('FINDING held as it is: GET /outbound lists a stored receipt\'s reason, which lib/whatsapp-out.js fills with the provider\'s own error text (SEC-95 owns the sender, not this sweep)', !!outbound && outbound.status === 200 && JSON.stringify(outbound.body).includes(scenes.PROVIDER_TEXT), outbound && outbound.body);
}

process.on('unhandledRejection', (failure) => console.log('  (unhandled rejection: ' + String(failure && failure.message).slice(0, 80) + ')'));
(async () => {
  if (lab.flagValue('--freeze')) return lab.freeze(lab.flagValue('--freeze'));
  lab.installStubs();
  delete require.cache[require.resolve(path.join(HERE, 'lib', 'schema'))]; /* the sign-in loaded the real one over the real db before the stand-in was put in place */
  const router = require(path.join(HERE, 'routes', 'channels.js'));
  const routes = lab.routesOf(router, MOUNT);
  const server = lab.appOf([{ mount: MOUNT, router: withKeyHeader(router) }]).listen(0);
  const port = server.address().port;
  const recording = {};
  const capturing = lab.flagValue('--capture') || lab.flagValue('--compare');
  const allowed = capturing ? () => [] : contractModule().allowedStatuses();
  const scenarios = lab.scenariosOf(routes, WORLDS, scenes.extras(tools).concat(scenes.relays()), { id: scenes.BINDING });
  const tested = await lab.checkRoutes(port, scenarios, recording, allowed, sources);
  if (lab.flagValue('--capture')) {
    server.close();
    fs.writeFileSync(lab.flagValue('--capture'), JSON.stringify(recording, null, 1));
    console.log('captured ' + Object.keys(recording).length + ' answers over ' + Object.keys(routes).length + ' routes');
    process.exit(0);
  }
  if (lab.flagValue('--compare')) {
    server.close();
    lab.compare(lab.flagValue('--compare'), recording);
    process.exit(0);
  }
  checkWords();
  checkCodesRegistered();
  checkContractShape(routes);
  checkFrozen503(recording);
  checkRelayModes(recording);
  checkNoThrownText(recording);
  const proved = await foreignWorld(port);
  server.close();
  const legacy = JSON.parse(fs.readFileSync(lab.legacyFile, 'utf8')).routes;
  const frozen = Object.keys(legacy).filter(lab.mine).reduce((sum, route) => sum + legacy[route].answers.length, 0);
  check('every refusal recorded before the sweep is replayed against the code: ' + frozen + ' answers, each once, byte for byte', frozen > 80, frozen);
  check('a caller who is not signed in is refused with 401 on every route that asks for a session', Object.keys(recording).filter((key) => key.endsWith('|signed-out') && !/\/(approve|revoke|template-approve)\|/.test(key)).every((key) => recording[key].status === 401));
  check('a 500 never says its cause: no 5xx answer of any route carries the database text', Object.values(recording).filter((one) => one.status >= 500).every((one) => !/SELECT|vault|relation "/.test(JSON.stringify(one.body || {}))));
  const coverage = lab.coverageOf(tested);
  const onDisk = JSON.parse(fs.readFileSync(TESTED_FILE, 'utf8'));
  const mine = Object.fromEntries(Object.keys(onDisk).filter(lab.mine).sort().map((route) => [route, onDisk[route]]));
  if (lab.argv.includes('--write')) {
    const others = Object.fromEntries(Object.keys(onDisk).filter((route) => !lab.mine(route)).map((route) => [route, onDisk[route]]));
    const merged = Object.assign(others, coverage);
    fs.writeFileSync(TESTED_FILE, JSON.stringify(Object.fromEntries(Object.keys(merged).sort().map((route) => [route, merged[route]])), null, 1) + '\n');
    foreign.writeEvidence(EVIDENCE_FILE, lab.mine, proved);
  } else {
    check('docs/contracts/api-error-tests.json lists exactly the statuses these scenarios cover for routes/channels.js', sameValue(mine, coverage), { onDisk: Object.keys(mine).length, covered: Object.keys(coverage).length });
    check('docs/contracts/api-hardening-evidence.json says exactly what the foreign-id world showed', sameValue(foreign.evidenceOf(EVIDENCE_FILE, lab.mine), proved), proved);
  }
  console.log('\n  ' + lab.count.passed + ' checks, ' + lab.count.failed + ' failed');
  process.exit(lab.count.failed ? 1 : 0);
})();
