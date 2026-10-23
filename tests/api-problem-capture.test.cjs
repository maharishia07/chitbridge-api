#!/usr/bin/env node
// @type: contract
/**
 * api-problem-capture.test.cjs — API-4 sweep, capture: every answer of routes/capture.js (12 routes, mounted at /api/capture).
 *
 * OWNS      the proof that each refusal of the nine authenticated intake routes is a Problem body AND still carries the keys it answered before (docs/contracts/api-legacy.json, recorded from
 *           the code before the sweep), that no success answer moved (--compare against a capture of the code before), this file's rows of docs/contracts/api-error-tests.json (the statuses
 *           each route is tested for, which the register's error_tests column reads), and the "signed in as another shop" world for the four routes addressed by a capture id in the path
 *           (API-STANDARD S35, tests/lib/foreign-id-world.cjs), recorded in docs/contracts/api-hardening-evidence.json. Also: no answer outside the statuses the contract declares
 *           (lib/capture-contract.js), its words as units, and a body scan: no answer of any route, a 200 included, carries the text of a thrown error, a database or a provider.
 *           The THREE WEBHOOKS are an outside contract (Meta, the e-mail provider) and are NOT swept: this file proves they answer exactly as before (every status, content type and body,
 *           signed deliveries over the real route; the always-200, the HMAC check, the verify echo), which the --compare against the capture of the code before holds byte for byte.
 * CALLED BY scripts/guards.cjs · CI. No database, no network: the real route file over a stand-in db and auth (tests/lib/problem-world.cjs), the rows of tests/lib/capture-scenes.cjs.
 * FLOW      route list (read from the router) x world (signed out, a bad id, an unknown id, a failing db, a found capture) + the named scenes → real route → body →
 *           Problem fields present · frozen legacy keys equal · no leak on a 5xx · statuses tested → manifest; then the foreign-id world, the webhook proofs and the body scan
 * CARD      11-crm-and-marketing/capture
 *
 *   node tests/api-problem-capture.test.cjs                    check
 *   node tests/api-problem-capture.test.cjs --write            rewrite this file's rows of docs/contracts/api-error-tests.json and api-hardening-evidence.json
 *   node tests/api-problem-capture.test.cjs --capture F        (run on the code BEFORE the change) record each answer to file F
 *   node tests/api-problem-capture.test.cjs --freeze F         merge a capture F into docs/contracts/api-legacy.json (the frozen answers)
 *   node tests/api-problem-capture.test.cjs --compare F        the answers now against a capture F: byte for byte for a success, the old keys in order for a refusal
 */
'use strict';
const path = require('path');
const fs = require('fs');
const { harness, OWNER, STAFF, sameValue } = require('./lib/problem-world.cjs');
const scenes = require('./lib/capture-scenes.cjs');
const FOREIGN = require('./lib/foreign-id-world.cjs');

const HERE = path.join(__dirname, '..');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
delete process.env.ANTHROPIC_API_KEY; /* the reader is stood in below; a real key must never be reachable from a test */
delete process.env.WHATSAPP_TOKEN;
const MOUNT = '/api/capture';
const ROUTE_FILE = 'routes/capture.js';
/** the three doors the providers call: signed (or the verify handshake), no session. Not swept: they answer today's bytes */
const WEBHOOKS = ['GET ' + MOUNT + '/webhook/whatsapp', 'POST ' + MOUNT + '/webhook/whatsapp', 'POST ' + MOUNT + '/webhook/email'];
/** the refusals those doors write by hand, which the contract does not declare */
const WEBHOOK_REFUSALS = { [WEBHOOKS[0]]: [403], [WEBHOOKS[1]]: [401], [WEBHOOKS[2]]: [401] };
const lab = harness({
  here: HERE,
  mounts: [MOUNT],
  routeFiles: { [MOUNT]: ROUTE_FILE },
  legacyFile: path.join(HERE, 'docs', 'contracts', 'api-legacy.json'),
  inherited: (scenario, answer) => WEBHOOKS.includes(scenario.route) || (answer.status === 401 && scenario.id === 'signed-out'),
  notFrozen: (one, scenario) => WEBHOOKS.includes(one.route) || (one.status === 401 && scenario === 'signed-out') || AFTER.has(scenario),
  before: (scenario) => prepare(scenario)
});
const { check, world } = lab;
const TESTED_FILE = path.join(HERE, 'docs', 'contracts', 'api-error-tests.json');
const REGISTER_FILE = path.join(HERE, 'docs', 'error-codes.json');
const EVIDENCE_FILE = path.join(HERE, 'docs', 'contracts', 'api-hardening-evidence.json');
const STRANGER = { identity_id: scenes.STRANGER_ID, identity_type: 'entity', display_name: 'Shop B' };
const VALUES = { id: scenes.CAP };
const WORLDS = [
  { id: 'signed-out', setup: { realAuth: true } },
  { id: 'bad-id', setup: { sqlRows: scenes.stubRows({}) }, badId: true },
  { id: 'unknown-id', setup: { sqlRows: scenes.stubRows({ owner: 'nobody' }) } },
  { id: 'db-fails', setup: { db: 'fail' } },
  { id: 'found-asks', setup: { sqlRows: scenes.stubRows({}) } },
  { id: 'staff-asks', setup: { who: STAFF, sqlRows: scenes.stubRows({}) } }
];

/** a scenario starts with the provider secrets the scene says (null removes one): the same on every run, before and after the change */
function prepare(scenario) {
  const wanted = Object.assign({}, scenes.SECRETS, scenario.env);
  Object.keys(wanted).forEach((name) => {
    if (wanted[name] === null) delete process.env[name];
    else process.env[name] = wanted[name];
  });
}

const extrasList = () => scenes.extras({ OWNER, STAFF });
const AFTER = new Set(extrasList().filter((one) => one.after).map((one) => one.id));
const sources = () => ({
  ai: require(path.join(HERE, 'lib', 'ai')),
  capture: require(path.join(HERE, 'lib', 'capture')),
  consolidate: require(path.join(HERE, 'lib', 'consolidate')),
  optout: require(path.join(HERE, 'lib', 'optout')),
  autoraise: require(path.join(HERE, 'lib', 'autoraise'))
});
const contractModule = () => require(path.join(HERE, 'lib', 'capture-contract.js'));

/** the reader (the AI slot) and the photo fetch are stood in for the whole run: a test never reaches the provider, whatever key a machine holds */
function standInTheReader() {
  const unreachable = async () => { throw Object.assign(new Error('AI not connected — set ANTHROPIC_API_KEY.'), { status: 503 }); };
  require(path.join(HERE, 'lib', 'ai')).invokeSkill = unreachable;
  require(path.join(HERE, 'lib', 'whatsapp-media')).imagesFor = async () => [];
}

/** lib/capture-contract.js as a unit: the words of a refusal and of a fault, as these routes always said them */
function checkWords() {
  console.log('\n-- lib/capture-contract.js: the refusals as a unit --');
  const contract = contractModule();
  const req = { id: 'r1' };
  const refusal = (status, message, code) => Object.assign(new Error(message), { status }, code ? { code } : {});
  const lost = contract.faultOf(new Error(scenes.SECRET_TEXT), req, 'Capture failed', 'any');
  check('faultOf: a fault with no status is the screen\'s label and the safe sentence, never the cause', lost.status === 500 && lost.legacy.error === 'Capture failed' && !JSON.stringify(lost).includes('vault'), lost);
  const meant = contract.faultOf(refusal(400, 'raw_text required'), req, 'Capture failed', 'any');
  check('faultOf: a refusal our code threw keeps its status and its own sentence (relay any)', meant.status === 400 && meant.legacy.message === 'raw_text required' && sameValue(Object.keys(meant.legacy), ['error', 'message']) && meant.code === 'INVALID_INPUT', meant);
  const bigRelay = contract.faultOf(refusal(503, 'Capture not migrated yet (b104).', 'CAPTURE_STORE_MISSING'), req, 'Capture failed', 'any');
  check('faultOf: a 503 the library meant (relay any) keeps its code and sentence', bigRelay.status === 503 && bigRelay.code === 'CAPTURE_STORE_MISSING' && bigRelay.legacy.message === 'Capture not migrated yet (b104).', bigRelay);
  const provider = contract.faultOf(refusal(502, 'AI HTTP 500: provider says SELECT secret FROM vault'), req, 'Structure failed', 'below500');
  check('faultOf: a 502 under relay below500 keeps its status and answers the safe sentence, never the provider\'s text', provider.status === 502 && provider.legacy.message === 'Something went wrong — please try again.' && !JSON.stringify(provider).includes('vault'), provider);
  const budget = contract.faultOf(refusal(402, 'AI budget used ($0.50). Add wallet credits to continue.'), req, 'Structure failed', 'below500');
  check('faultOf: a 402 under relay below500 keeps its own sentence under the register\'s AI code', budget.status === 402 && budget.code === 'AI_GATED' && /wallet credits/.test(budget.legacy.message), budget);
  const never = contract.faultOf(refusal(404, 'Capture not found'), req, 'List failed', 'none');
  check('faultOf: under relay none a status is kept and the words are the safe sentence', never.status === 404 && never.legacy.message === 'Something went wrong — please try again.', never);
  const plain = contract.faultOf(refusal(409, 'That message has already been handled'), req, 'Raise failed', 'below500');
  check('faultOf: a 409 is CAPTURE_REFUSED with its sentence', plain.code === 'CAPTURE_REFUSED' && plain.legacy.message === 'That message has already been handled', plain);
  const notFound = contract.faultOf(refusal(404, 'Capture not found'), req, 'Structure failed', 'below500');
  check('faultOf: a 404 is the register\'s NOT_FOUND', notFound.code === 'NOT_FOUND' && notFound.status === 404, notFound);
  const storesWord = contract.storesFault(refusal(503, 'Stores are not migrated on this environment (b135).'), req);
  check('storesFault: the stores route\'s 503 is STORES_NOT_MIGRATED with its sentence', storesWord.status === 503 && storesWord.code === 'STORES_NOT_MIGRATED' && storesWord.legacy.error === 'Store save failed', storesWord);
  const unreadable = contract.failed(Object.assign(new Error(scenes.SECRET_TEXT), { status: 404 }), req, 'Consolidate failed');
  check('failed: always a 500 in the screen own label, whatever status was thrown, and nothing of the cause', unreadable.status === 500 && unreadable.legacy.error === 'Consolidate failed' && !JSON.stringify(unreadable).includes('vault'), unreadable);
}

/** every code the words answer under is a row of docs/ERROR-CODES.md with its sentence written */
function checkCodesRegistered(contract) {
  console.log('\n-- the codes the capture routes answer under are in the register --');
  const known = new Set(JSON.parse(fs.readFileSync(REGISTER_FILE, 'utf8')).codes.filter((row) => row.shopkeeper !== 'PENDING').map((row) => row.code));
  const missing = contract.CODES.filter((code) => !known.has(code));
  check('every code the capture words (' + contract.CODES.length + ') answer under is a register row with its sentence written', missing.length === 0, missing);
}

/** the contract in front of the router: nine operations (the webhooks have none, by decision); a body is an object, a path argument stays plain text */
function checkContractShape(routes) {
  console.log('\n-- the contract and the router agree --');
  const contract = contractModule();
  const operations = Object.keys(contract.OPERATIONS);
  const swept = Object.keys(routes).filter((route) => !WEBHOOKS.includes(route));
  check('every route the router holds, bar the three webhooks, has an operation, and every operation a route (' + operations.length + ')', sameValue(operations.slice().sort(), swept.sort()), operations.filter((key) => !routes[key]));
  check('the contract holds 9 operations and the router 12 routes', operations.length === 9 && Object.keys(routes).length === 12, [operations.length, Object.keys(routes).length]);
  check('the three webhooks are not in the contract: a refusal declared as a Problem would be false of what they send', WEBHOOKS.every((key) => !contract.OPERATIONS[key]));
  const bodies = operations.filter((key) => contract.OPERATIONS[key].requestBody);
  check('the six write routes declare a body that is an object (a list is the one new 400)', bodies.length === 6 && bodies.every((key) => contract.OPERATIONS[key].requestBody.content['application/json'].schema.type === 'object'), bodies);
  check('a body requires none of its fields in the schema (the library answers a missing one in its own frozen words)', bodies.every((key) => !(contract.OPERATIONS[key].requestBody.content['application/json'].schema.required || []).length));
  check('every refusal an operation declares is a Problem', operations.every((key) => Object.keys(contract.OPERATIONS[key].responses).filter((status) => Number(status) >= 400).every((status) => JSON.stringify(contract.OPERATIONS[key].responses[status]).includes('Problem'))));
  check('a path argument is plain text: the library answers an unknown id in its own words', operations.filter((key) => key.includes(':')).every((key) => contract.OPERATIONS[key].parameters.every((one) => one.schema.type === 'string' && !one.schema.pattern)));
}

/**
 * the harness judges a 5xx as "says nothing of its cause" and replays no frozen body for it; every frozen 5xx is replayed here: the same status and every old key, byte for byte and in order.
 * (A 502 and a 503 are the reader's and the library's own statuses, kept as they were.)
 */
function checkFrozenFaults(recording) {
  console.log('\n-- the frozen 5xx answers are replayed --');
  const legacy = JSON.parse(fs.readFileSync(lab.legacyFile, 'utf8')).routes;
  let replayed = 0;
  Object.keys(legacy).filter(lab.mine).forEach((route) => legacy[route].answers.filter((frozen) => frozen.status >= 500).forEach((frozen) => {
    const now = recording[route + '|' + frozen.scenario];
    const order = Object.keys(frozen.fixture);
    replayed++;
    check(route + ' · ' + frozen.scenario + ': the frozen ' + frozen.status + ' body is kept, key by key and in order', !!now && now.status === frozen.status && sameValue(order.map((name) => now.body[name]), order.map((name) => frozen.fixture[name])) && sameValue(Object.keys(now.body).filter((name) => order.includes(name)), order), now && now.body);
  }));
  check('at least twelve 5xx answers were frozen and replayed (' + replayed + ')', replayed >= 12, replayed);
}

/* ── the foreign-id world (API-STANDARD S35): shop B asks for shop A's capture by its id ── */
const FOREIGN_ROUTES = () => [
  ['POST ' + MOUNT + '/:id/structure', 'POST', '/structure', {}],
  ['POST ' + MOUNT + '/:id/raise', 'POST', '/raise', {}],
  ['POST ' + MOUNT + '/:id/convert', 'POST', '/convert', { chit_id: scenes.CHIT }],
  ['POST ' + MOUNT + '/:id/dismiss', 'POST', '/dismiss', {}]
];

/** one play(who, planted) of a foreign-id route: the capture exists for shop A only when planted; shop B asks as the stranger, shop A as the owner */
function playFor(port, [, method, tail, body]) {
  return async (who, planted) => {
    const rows = scenes.stubRows({ owner: planted ? scenes.SHOP : 'nobody' });
    Object.assign(world, { realAuth: false, who: who === 'owner' ? OWNER : STRANGER, asKey: false, db: 'ok', sqlRows: rows, jsonThrows: false, noCustomer: false });
    return lab.send(port, method, MOUNT + '/' + scenes.CAP + tail, body);
  };
}

async function checkForeignIds(port) {
  console.log('\n-- signed in as another shop: a foreign id answers exactly as an unknown id (S35) --');
  const recording = FOREIGN.recorder();
  const items = FOREIGN_ROUTES();
  const failures = await FOREIGN.runCases(items.map((item) => ({ route: item[0], play: playFor(port, item) })), recording.record);
  console.log('  foreign id: ' + (items.length - failures.length) + ' of ' + items.length + ' routes held');
  failures.forEach((sentence) => console.log('  FINDING ' + sentence));
  return { proved: recording.proved(), failures, asked: items.length };
}

/** a text answer as it was recorded: its text, or (when it happens to parse as JSON, a bare number) the value written back */
const shown = (answer) => (answer.text !== undefined ? answer.text : JSON.stringify(answer.body));
/** the answer of a named scene, from the recording */
const sceneOf = (recording, route, id) => recording[route + '|' + id];
const jsonOf = (answer) => (answer ? answer.body : null);

/**
 * the three webhooks, scene by scene: the status, the content type and the body are TODAY's (these literals were read off the code before the sweep, and the --compare holds the rest byte for byte).
 * Meta's verify echo is text, never JSON and never a Problem; every signed delivery is answered 200; an unsigned body is 401 { error: 'bad signature' }.
 */
function checkWebhooks(recording) {
  console.log('\n-- the webhooks answer exactly as they did (an outside contract, not swept) --');
  const wa = WEBHOOKS[1];
  const mail = WEBHOOKS[2];
  const verify = (id) => sceneOf(recording, WEBHOOKS[0], id);
  const echo = verify('verify-ok');
  check('GET verify: the right token echoes the challenge as it came, status 200, a text answer, not JSON, not a Problem', echo.status === 200 && shown(echo) === '1158201444' && !/json/.test(echo.type) && /^text\/html/.test(echo.type), echo);
  ['verify-wrong-token', 'verify-wrong-mode', 'verify-nothing-sent', 'verify-not-configured'].forEach((id) => {
    const refused = verify(id);
    check('GET verify · ' + id + ': 403 with the bare word forbidden, text, not a Problem', refused.status === 403 && shown(refused) === 'forbidden' && /^text\/html/.test(refused.type), refused);
  });
  const answered = (route, id, status, body) => {
    const got = sceneOf(recording, route, id);
    check(route + ' · ' + id + ': ' + status + ' ' + JSON.stringify(body) + ' as application/json', !!got && got.status === status && sameValue(jsonOf(got), body) && /^application\/json/.test(got.type) && !/problem/.test(got.type), got);
  };
  answered(wa, 'wa-not-configured', 200, { ok: true, note: 'whatsapp not configured' });
  ['wa-unsigned', 'wa-wrong-signature', 'wa-signature-not-hex', 'wa-signature-of-another-body'].forEach((id) => answered(wa, id, 401, { error: 'bad signature' }));
  answered(wa, 'wa-message-captured', 200, { ok: true, captured: 1 });
  answered(wa, 'wa-message-captured-and-raised', 200, { ok: true, captured: 1 });
  answered(wa, 'wa-redelivery', 200, { ok: true, captured: 1 });
  answered(wa, 'wa-status-receipt', 200, { ok: true, captured: 0 });
  answered(wa, 'wa-two-messages', 200, { ok: true, captured: 2 });
  answered(wa, 'wa-photo-without-text', 200, { ok: true, captured: 1 });
  answered(wa, 'wa-not-our-number', 200, { ok: true, captured: 0 });
  answered(wa, 'wa-stop-reply', 200, { ok: true, captured: 1 });
  answered(wa, 'wa-stop-reply-not-recorded', 200, { ok: true, captured: 1 });
  answered(wa, 'wa-body-is-not-json', 200, { ok: true });
  answered(wa, 'wa-capture-fails', 200, { ok: true });
  answered(wa, 'wa-nothing-in-it', 200, { ok: true, captured: 0 });
  answered(mail, 'email-not-configured', 200, { ok: true, note: 'email inbound not configured' });
  ['email-unsigned', 'email-wrong-signature'].forEach((id) => answered(mail, id, 401, { error: 'bad signature' }));
  answered(mail, 'email-signature-in-the-other-header', 200, { ok: true, captured: 1 });
  answered(mail, 'email-captured', 200, { ok: true, captured: 1 });
  answered(mail, 'email-form-fields', 200, { ok: true, captured: 1 });
  answered(mail, 'email-no-binding', 200, { ok: true, note: 'no binding for that address' });
  answered(mail, 'email-no-text', 200, { ok: true, note: 'nothing to capture' });
  answered(mail, 'email-capture-fails', 200, { ok: true });
}

/** the side effects a signed delivery schedules AFTER Meta's 200 (the STOP confirmation, the auto-raise), read from what the stood-in senders were asked */
async function checkAfterTheAnswer() {
  console.log('\n-- what a delivery schedules after its 200 --');
  await new Promise((resolve) => setTimeout(resolve, 80));
  const asked = scenes.calls.slice();
  check('a STOP reply that was recorded is confirmed once, after the 200; one that could not be recorded is not confirmed', asked.filter((one) => one === 'confirmReply').length === 1, asked);
  check('a new message on an auto-raise line is raised once; a redelivery, a plain line and a STOP are not', asked.filter((one) => one.startsWith('autoraise:')).length === 1, asked);
}

/** the checks of an --capture / --compare run end here (they need no contract file) */
function finishCapture(server, recording, routes) {
  server.close();
  if (lab.flagValue('--capture')) {
    fs.writeFileSync(lab.flagValue('--capture'), JSON.stringify(recording, null, 1));
    console.log('captured ' + Object.keys(recording).length + ' answers over ' + Object.keys(routes).length + ' routes');
  } else lab.compare(lab.flagValue('--compare'), recording);
  process.exit(0);
}

process.on('unhandledRejection', (failure) => console.log('  (unhandled rejection: ' + String(failure && failure.message).slice(0, 80) + ')'));
(async () => {
  if (lab.flagValue('--freeze')) return lab.freeze(lab.flagValue('--freeze'));
  lab.installStubs();
  standInTheReader();
  const router = require(path.join(HERE, ROUTE_FILE));
  const routes = lab.routesOf(router, MOUNT);
  const server = lab.appOf([{ mount: MOUNT, router }]).listen(0);
  const port = server.address().port;
  const recording = {};
  const capturing = lab.flagValue('--capture') || lab.flagValue('--compare');
  const swept = capturing ? () => [] : contractModule().allowedStatuses();
  const allowed = (route) => (WEBHOOK_REFUSALS[route] ? WEBHOOK_REFUSALS[route] : swept(route));
  const scenarios = lab.scenariosOf(routes, WORLDS, extrasList(), VALUES);
  const tested = await lab.checkRoutes(port, scenarios, recording, allowed, sources);
  if (capturing) return finishCapture(server, recording, routes);
  const foreign = await checkForeignIds(port);
  server.close();
  checkWords();
  checkCodesRegistered(contractModule());
  checkContractShape(routes);
  checkFrozenFaults(recording);
  checkWebhooks(recording);
  await checkAfterTheAnswer();
  const legacy = JSON.parse(fs.readFileSync(lab.legacyFile, 'utf8')).routes;
  const frozen = Object.keys(legacy).filter(lab.mine).reduce((sum, route) => sum + legacy[route].answers.length, 0);
  check('every refusal recorded before the sweep is replayed against the code: ' + frozen + ' answers, each once, byte for byte', frozen > 50, frozen);
  check('a caller who is not signed in is refused with 401 on every route that asks for a sign-in', Object.keys(recording).filter((key) => key.endsWith('|signed-out') && !WEBHOOKS.some((route) => key.startsWith(route + '|'))).every((key) => recording[key].status === 401));
  const leaks = (key) => /SELECT|vault|relation "|provider says|AI HTTP|ANTHROPIC_API_KEY/.test(JSON.stringify(recording[key].body || recording[key].text || ''));
  const faults = Object.keys(recording).filter((key) => recording[key].status >= 500);
  check('a 5xx never says its cause: no answer of 500 and over carries the database or provider text (' + faults.length + ' answers)', faults.filter(leaks).length === 0, faults.filter(leaks));
  const everywhere = Object.keys(recording).filter(leaks);
  check('no answer of any route, a 200 and a relayed 4xx included, carries the text of a thrown error (a body scan: ' + Object.keys(recording).length + ' answers)', everywhere.length === 0, everywhere);
  check('a 2xx is never a Problem: every success answer keeps its own shape', Object.keys(recording).filter((key) => recording[key].status < 400).every((key) => !/problem\+json/.test(recording[key].type)));
  check('the three webhooks never answer a Problem: their content types are untouched', Object.keys(recording).filter((key) => WEBHOOKS.some((route) => key.startsWith(route + '|'))).every((key) => !/problem\+json/.test(recording[key].type)));
  const coverage = lab.coverageOf(tested);
  const onDisk = JSON.parse(fs.readFileSync(TESTED_FILE, 'utf8'));
  const mine = Object.fromEntries(Object.keys(onDisk).filter(lab.mine).sort().map((route) => [route, onDisk[route]]));
  if (lab.argv.includes('--write')) {
    const others = Object.fromEntries(Object.keys(onDisk).filter((route) => !lab.mine(route)).map((route) => [route, onDisk[route]]));
    const merged = Object.assign(others, coverage);
    fs.writeFileSync(TESTED_FILE, JSON.stringify(Object.fromEntries(Object.keys(merged).sort().map((route) => [route, merged[route]])), null, 1) + '\n');
    FOREIGN.writeEvidence(EVIDENCE_FILE, lab.mine, foreign.proved);
  } else {
    check('docs/contracts/api-error-tests.json lists exactly the statuses these scenarios cover for routes/capture.js', sameValue(mine, coverage), { onDisk: Object.keys(mine).length, covered: Object.keys(coverage).length });
    check('docs/contracts/api-hardening-evidence.json says exactly what the foreign-id world showed', sameValue(FOREIGN.evidenceOf(EVIDENCE_FILE, lab.mine), foreign.proved), foreign.proved);
  }
  check('signed in as another shop: all ' + foreign.asked + ' routes addressed by a capture id held (a foreign id answers exactly as an unknown one)', foreign.failures.length === 0, foreign.failures);
  console.log('\n  ' + lab.count.passed + ' checks, ' + lab.count.failed + ' failed');
  process.exit(lab.count.failed ? 1 : 0);
})();
