#!/usr/bin/env node
// @type: contract
/**
 * api-problem-forms.test.cjs — API-4 stage-2 sweep, the authority forms: every answer of routes/forms.js (8 routes, mounted at /api/forms).
 *
 * OWNS      the proof that each refusal of the eight routes is a Problem body AND still carries the keys it answered before (docs/contracts/api-legacy.json, recorded from the code
 *           before the sweep), that no success answer moved (--compare against a capture of the code before), that no answer of ANY status (a 200 and a 4xx included) carries the text
 *           of a thrown error (a database that THROWS a string with SQL in it, and a library that does), that a 2xx is never a Problem, that a status a library carries is passed on
 *           as it was, the frozen 5xx bodies replayed, this file's rows of docs/contracts/api-error-tests.json, the "signed in as another shop" world on the three routes that name an
 *           issued form (S35), the caller's OWN second record on POST /attach (a chit of another shop answers as a chit that does not exist), and the body schemas that refuse a key
 *           the route never named (Q18) while accepting every key a caller sends. Also: no answer outside the statuses the contract declares (lib/forms-contract.js) and its words as units.
 * CALLED BY scripts/guards.cjs · CI. No database, no network: the real route file and the real libraries over the stand-in db and sign-in (tests/lib/problem-world.cjs, scenes in tests/lib/forms-scenes.cjs).
 * FLOW      the eight routes x world (signed out, a viewer, another shop, a bad id, a failing db, an empty db) + the named extras → real route → body → Problem fields present · frozen legacy keys
 *           equal · no leak on any status · statuses tested → manifest; then the carried statuses, the frozen 5xx, the body scan, the foreign-id worlds and the body schemas
 * CARD      21-compliance-attestation-and-trade/functions/authority-forms
 *
 *   node tests/api-problem-forms.test.cjs                    check
 *   node tests/api-problem-forms.test.cjs --write            rewrite this file's rows of docs/contracts/api-error-tests.json and api-hardening-evidence-areas.json
 *   node tests/api-problem-forms.test.cjs --capture F        (run on the code BEFORE the change) record each answer to file F
 *   node tests/api-problem-forms.test.cjs --freeze F         merge a capture F into docs/contracts/api-legacy.json (the frozen answers)
 *   node tests/api-problem-forms.test.cjs --compare F        the answers now against a capture F: byte for byte for a success, the old keys in order for a refusal
 */
'use strict';
const path = require('path');
const fs = require('fs');
const { harness, OWNER, SECRET_SQL, sqlError, sameValue } = require('./lib/problem-world.cjs');
const FOREIGN = require('./lib/foreign-id-world.cjs');
const S = require('./lib/forms-scenes.cjs');

const HERE = path.join(__dirname, '..');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
delete process.env.FORMS_REGISTRY;
const MOUNT = '/api/forms';
const ROUTE_COUNT = 8;
const TESTED_FILE = path.join(HERE, 'docs', 'contracts', 'api-error-tests.json');
const EVIDENCE_FILE = path.join(HERE, 'docs', 'contracts', 'api-hardening-evidence-areas.json');
const REGISTER_FILE = path.join(HERE, 'docs', 'error-codes.json');
const SAFE = 'Something went wrong — please try again.';
const LABELS = {
  'GET /api/forms': 'List forms failed',
  'GET /api/forms/:key': 'Get form failed',
  'POST /api/forms/:key/resolve': 'Resolve form failed',
  'POST /api/forms/:key/issue': 'Issue form failed',
  'GET /api/forms/instances/all': 'List instances failed',
  'GET /api/forms/instances/:id': 'Get instance failed',
  'POST /api/forms/instances/:id/sign': 'Sign form failed',
  'POST /api/forms/instances/:id/attach': 'Attach form failed'
};
/* the stand-in db's secret sentence (a form's own text names the vault as a source, so the word alone proves nothing) */
const LEAK = /SELECT secret|relation "catalogue_items"|does not exist/;
/** scenes whose database error carries a SQLSTATE: the old 5xx body echoed it as `code`, and `code` is the Problem's own key now (INTERNAL), so it cannot ride */
const SQLSTATE_SCENES = ['issue-write-fails', 'issue-db-fails-on-the-write', 'instance-not-an-id', 'instances-read-fails', 'sign-write-fails'];
const STRANGER = { identity_id: S.SHOP_B, identity_type: 'entity', display_name: 'Other shop' };
const VIEWER = { identity_id: '77777777-7777-4777-8777-777777777777', parent_entity_id: S.SHOP, identity_type: 'actor', access_level: 'viewer', display_name: 'Test viewer' };
const AFTER = new Set();
const tools = { SECRET_SQL, sqlError };
const lab = harness({
  here: HERE,
  mounts: [MOUNT],
  routeFiles: { [MOUNT]: 'routes/forms.js' },
  legacyFile: path.join(HERE, 'docs', 'contracts', 'api-legacy.json'),
  inherited: (scenario, answer) => answer.status === 401 && scenario.id === 'signed-out',
  notFrozen: (one, scenario) => (one.status === 401 && scenario === 'signed-out') || AFTER.has(scenario),
  cannotRide: (route, scenario) => (SQLSTATE_SCENES.includes(scenario) ? ['code'] : [])
});
const { check } = lab;
const WORLDS = [
  { id: 'signed-out', setup: { realAuth: true } },
  { id: 'viewer-asks', setup: { who: VIEWER } },
  { id: 'stranger-asks', setup: { who: STRANGER } },
  { id: 'bad-id', setup: {}, badId: true },
  { id: 'db-fails', setup: { db: 'fail' } },
  { id: 'nothing-found', setup: {} }
];
const lib = (name) => require(path.join(HERE, 'lib', name));
const sources = () => ({ forms: lib('forms'), storage: lib('storage') });
/** the contract, or null when the code has none (the untouched base: the checks then FAIL by name instead of the run dying on a missing file) */
const contractModule = () => {
  try {
    return require(path.join(HERE, 'lib', 'forms-contract.js'));
  } catch (failure) {
    return null;
  }
};
const labelOf = (route) => LABELS[route];
const legacyRoutes = () => JSON.parse(fs.readFileSync(lab.legacyFile, 'utf8')).routes;
const extrasList = () => S.extras(tools);

/** lib/forms-contract.js as a unit: the words of a refusal and of a fault, as these routes always said them */
function checkWords() {
  console.log('\n-- lib/forms-contract.js: the forms refusals as a unit --');
  const words = contractModule();
  check('lib/forms-contract.js exists and words the faults', !!words);
  if (!words) return;
  const req = { id: 'r1' };
  const notReady = words.faultOf(Object.assign(new Error('Form is not ready — required fields unresolved: Applicant'), { status: 400, code: 'FORM_NOT_READY', unresolved: [{ id: 'applicant', label: 'Applicant' }] }), req, 'Issue form failed');
  check('faultOf: a form that is not ready keeps 400, its code FORM_NOT_READY, its own sentence and the list of what is missing, in the old key order', notReady.status === 400 && notReady.code === 'FORM_NOT_READY' && sameValue(Object.keys(notReady.legacy), ['error', 'code', 'message', 'unresolved']) && notReady.legacy.message.startsWith('Form is not ready'), notReady);
  const missing = words.faultOf(Object.assign(new Error('Unknown form: x'), { status: 404 }), req, 'Get form failed');
  check('faultOf: a 404 keeps its sentence and answers FORMS_NOT_FOUND; no `code` key was sent before, so none rides', missing.status === 404 && missing.code === 'FORMS_NOT_FOUND' && !('code' in missing.legacy) && missing.legacy.message === 'Unknown form: x', missing);
  const clash = words.faultOf(Object.assign(new Error('Form is already signed'), { status: 409 }), req, 'Sign form failed');
  check('faultOf: 409 is FORMS_ALREADY_SIGNED, 403 is FORMS_NOT_PARTICIPANT, any other under 500 is FORMS_BAD_REQUEST (400) or FORMS_REFUSED', clash.code === 'FORMS_ALREADY_SIGNED' && words.faultOf(Object.assign(new Error('x'), { status: 403 }), req, 'x').code === 'FORMS_NOT_PARTICIPANT' && words.faultOf(Object.assign(new Error('x'), { status: 400 }), req, 'x').code === 'FORMS_BAD_REQUEST' && words.faultOf(Object.assign(new Error('x'), { status: 418 }), req, 'x').code === 'FORMS_REFUSED');
  const mute = words.faultOf(Object.assign(new Error(''), { status: 400 }), req, 'Sign form failed');
  check('faultOf: a refusal with no words answers the generic sentence', mute.legacy.message === SAFE, mute);
  const store = words.faultOf(Object.assign(new Error('Forms not migrated yet (b108).'), { status: 503, code: 'FORMS_STORE_MISSING' }), req, 'Issue form failed');
  check('faultOf: the missing forms store is a 503 FORMS_STORE_MISSING whose message is the generic sentence, as before', store.status === 503 && store.code === 'FORMS_STORE_MISSING' && store.legacy.message === SAFE && store.legacy.code === 'FORMS_STORE_MISSING', store);
  const fault = words.faultOf(Object.assign(new Error(SECRET_SQL), { code: '22P02' }), req, 'Issue form failed');
  check('faultOf: a database fault is a 500 INTERNAL that says nothing of its cause and does not echo the SQLSTATE', fault.status === 500 && fault.code === 'INTERNAL' && sameValue(fault.legacy, { error: 'Issue form failed', message: SAFE }) && !JSON.stringify(fault).includes('vault'), fault);
  const carried = words.faultOf(Object.assign(new Error(SECRET_SQL), { status: 502 }), req, 'Issue form failed');
  check('faultOf: a status of 500 or more is passed on, its words stay the generic sentence', carried.status === 502 && carried.legacy.message === SAFE && !JSON.stringify(carried).includes('vault'), carried);
  const odd = words.faultOf(Object.assign(new Error('x'), { status: 'soon' }), req, 'Sign form failed');
  check('faultOf: a status that is not an HTTP failure is a 500', odd.status === 500 && odd.code === 'INTERNAL', odd);
}

/** every code the words answer under is a row of docs/ERROR-CODES.md with its sentence written */
function checkCodesRegistered() {
  console.log('\n-- the codes the forms routes answer under are in the register --');
  const words = contractModule();
  if (!words) return;
  const known = new Set(JSON.parse(fs.readFileSync(REGISTER_FILE, 'utf8')).codes.filter((item) => item.shopkeeper !== 'PENDING').map((item) => item.code));
  const missing = words.CODES.filter((code) => !known.has(code));
  check('every code the forms words answer under (' + words.CODES.length + ' codes) is a register row with its sentence written', missing.length === 0, missing);
}

/** the body schema of every write route: it names the keys the handler reads, requires none (the handler words its own 400), and refuses any other key (Q18) */
function bodyOf(contract, key) {
  return contract.OPERATIONS[key].requestBody.content['application/json'].schema;
}

/** the contract in front of the router: every route has a row, and a row has a route */
function checkContractShape(routes, router) {
  console.log('\n-- the contract and the router agree --');
  const contract = contractModule();
  const published = router.openapi && router.openapi.paths ? Object.keys(router.openapi.paths) : [];
  check('the router publishes its operations: router.openapi.paths names the routes (' + published.length + ' paths)', !!contract && published.length === ROUTE_COUNT, published);
  if (!contract) return;
  const operations = Object.keys(contract.OPERATIONS);
  check('every route the router holds has an operation, and every operation a route (' + operations.length + ')', sameValue(operations.slice().sort(), Object.keys(routes).sort()), operations.filter((key) => !routes[key]));
  const writes = operations.filter((key) => key.startsWith('POST '));
  check('the four write routes declare a body: an object or a list, requiring nothing (the handlers word their own 400)', writes.length === 4 && writes.every((key) => sameValue(bodyOf(contract, key).type, ['object', 'array']) && !(bodyOf(contract, key).required || []).length), writes);
  check('Q18: every body schema is CLOSED: a key the route never named is refused by name', writes.every((key) => bodyOf(contract, key).additionalProperties === false), writes.filter((key) => bodyOf(contract, key).additionalProperties !== false));
  const named = {
    'POST /api/forms/:key/resolve': ['context_ref', 'manual'],
    'POST /api/forms/:key/issue': ['context_ref', 'manual'],
    'POST /api/forms/instances/:id/sign': ['name', 'designation'],
    'POST /api/forms/instances/:id/attach': ['chit_id']
  };
  check('each body names exactly the keys its handler reads (the web page sends no others)', writes.every((key) => sameValue(Object.keys(bodyOf(contract, key).properties).sort(), named[key].slice().sort())), writes.map((key) => Object.keys(bodyOf(contract, key).properties)));
  const query = (contract.OPERATIONS['GET /api/forms/instances/all'].parameters || []).filter((item) => item.in === 'query');
  check('GET /instances/all\'s query value is declared as anything (a repeated value was read as it came, and answered 400 in the handler\'s words)', query.length === 1 && sameValue(query[0].schema, {}), query);
  check('every refusal an operation declares is a Problem', operations.every((key) => Object.keys(contract.OPERATIONS[key].responses).filter((status) => Number(status) >= 400).every((status) => JSON.stringify(contract.OPERATIONS[key].responses[status]).includes('Problem'))));
  check('the refusals a library raises are published beside each route they can reach (x-forms-refusals on 7 of 8 routes)', operations.filter((key) => (contract.OPERATIONS[key]['x-forms-refusals'] || []).length > 0).length === 7);
}

/** the safe shape of a refusal built by a scene that makes a library throw: patch the module, ask once, put it back */
async function askWithPatch(port, scenario) {
  const modules = sources();
  const undo = [];
  Object.keys(scenario.patch || {}).forEach((which) => Object.keys(scenario.patch[which]).forEach((name) => {
    undo.push([modules[which], name, modules[which][name]]);
    modules[which][name] = scenario.patch[which][name];
  }));
  Object.assign(lab.world, { realAuth: false, db: 'ok', sqlRows: null, jsonThrows: false });
  const method = scenario.route.split(' ')[0];
  const answer = await lab.send(port, method, scenario.url, method === 'GET' ? undefined : scenario.body === undefined ? {} : scenario.body);
  undo.forEach(([owner, name, original]) => (owner[name] = original));
  return answer;
}

/**
 * a library that raises an error carrying a status no real library raises under these routes (409, 502): the code passes any status on, with the words of a status under 500 relayed.
 * The contract declares no such status, so these are checked here, not by the generic run.
 */
async function checkCarriedStatus(port, scenarios) {
  console.log('\n-- a status a library carries is passed on, as it always was --');
  const frozenAll = legacyRoutes();
  for (const scenario of scenarios) {
    const answer = await askWithPatch(port, scenario);
    const label = scenario.route + ' · ' + scenario.id;
    const relayed = scenario.expect < 500;
    const frozen = (frozenAll[scenario.route] || { answers: [] }).answers.find((one) => one.scenario === scenario.id);
    const keys = frozen ? Object.keys(frozen.fixture) : [];
    check(label + ': the status is passed on (' + scenario.expect + ')', answer.status === scenario.expect, [answer.status, answer.text]);
    check(label + ': the old keys, error and message, are kept; the words are the generic sentence unless a refusal is relayed', answer.json && answer.json.error === labelOf(scenario.route) && (relayed ? answer.json.message === scenario.says : answer.json.message === SAFE), answer.json);
    check(label + ': the answer is a Problem with a code', answer.json && /problem\+json/.test(answer.type) && typeof answer.json.code === 'string' && answer.json.status === answer.status, answer.type);
    check(label + ': the error\'s own text (the database sentence) is nowhere in the answer', !LEAK.test(answer.text), answer.text);
    check(label + ': it was frozen before the sweep, status and every old key in order', !!frozen && frozen.status === answer.status && sameValue(keys.map((name) => answer.json[name]), keys.map((name) => frozen.fixture[name])) && sameValue(Object.keys(answer.json).slice(0, keys.length), keys), frozen);
  }
}

/** every 5xx body frozen before the sweep (a fault, the answer that could not be written) is replayed: the same status and every old key, key by key and in order */
function checkFrozen5xx(recording) {
  console.log('\n-- the frozen 5xx answers are replayed --');
  const legacy = legacyRoutes();
  let replayed = 0;
  Object.keys(legacy).filter(lab.mine).forEach((route) => legacy[route].answers.filter((frozen) => frozen.status >= 500 && recording[route + '|' + frozen.scenario]).forEach((frozen) => {
    const now = recording[route + '|' + frozen.scenario];
    const gone = SQLSTATE_SCENES.includes(frozen.scenario) ? ['code'] : [];
    const order = Object.keys(frozen.fixture).filter((name) => !gone.includes(name));
    replayed++;
    check(route + ' · ' + frozen.scenario + ': the frozen ' + frozen.status + ' body is kept, key by key and in order', now.status === frozen.status && sameValue(order.map((name) => now.body[name]), order.map((name) => frozen.fixture[name])) && sameValue(Object.keys(now.body).slice(0, order.length), order), now.body);
  }));
  check('at least ten 5xx answers were frozen and replayed (' + replayed + ')', replayed >= 10, replayed);
}

/** a 2xx is never a Problem, and no answer of any status carries the text of a thrown error (the scene makes the database and the library throw a sentence with SQL in it) */
function checkNoLeakAnywhere(recording) {
  console.log('\n-- the body scan: a 2xx is never a Problem, and no body carries a thrown text --');
  const keys = Object.keys(recording);
  const successes = keys.filter((key) => recording[key].status < 300);
  check('a 2xx answer is never a Problem (' + successes.length + ' answers)', successes.every((key) => !/problem/.test(recording[key].type) && !(recording[key].body && recording[key].body.type && recording[key].body.request_id !== undefined && recording[key].body.code)), successes.filter((key) => /problem/.test(recording[key].type)));
  const leaking = keys.filter((key) => LEAK.test(JSON.stringify(recording[key].body || {})) || /relation "/.test(recording[key].text || ''));
  check('no answer of any status, a 200 and a 4xx included, carries the database text (' + keys.length + ' answers scanned)', leaking.length === 0, leaking);
  const faults = keys.filter((key) => recording[key].status >= 500);
  check('every fault says only the generic sentence (' + faults.length + ' answers)', faults.every((key) => recording[key].body && recording[key].body.message === SAFE), faults.filter((key) => !recording[key].body || recording[key].body.message !== SAFE));
  check('a caller who is not signed in is refused with 401 on every route', keys.filter((key) => key.endsWith('|signed-out')).every((key) => recording[key].status === 401));
  const viewers = keys.filter((key) => key.endsWith('|viewer-asks') && key.startsWith('POST ') && !key.includes('/resolve|'));
  check('a viewer\'s write is refused with 403 on issue, sign and attach (' + viewers.length + ' of 3; resolve is a free preview), a Problem whose code is the rail\'s word', viewers.length === 3 && viewers.every((key) => recording[key].status === 403 && recording[key].body.code === 'read_only'), viewers.map((key) => [key, recording[key].status]));
}

/** a viewer opening the list is told what may not be pressed, and the owner is not */
async function checkMayOnTheList(port) {
  console.log('\n-- GET / tells the screen what this login may do --');
  const ask = async (who) => {
    Object.assign(lab.world, { realAuth: false, db: 'ok', jsonThrows: false, sqlRows: null, who });
    return lab.send(port, 'GET', MOUNT);
  };
  const viewer = await ask(VIEWER);
  const owner = await ask(OWNER);
  const refused = (answer) => ['issue', 'sign', 'attach'].every((name) => answer.json.may[name].may === false && answer.json.may[name].code === 'read_only');
  const allowed = (answer) => ['issue', 'sign', 'attach'].every((name) => answer.json.may[name].may === true);
  check('a viewer\'s list says issue, sign and attach are not allowed; the owner\'s says they are', !!viewer.json && !!owner.json && refused(viewer) && allowed(owner), [viewer.json && viewer.json.may, owner.json && owner.json.may]);
  check('the list holds the same four forms for both', viewer.json.forms.length === 4 && sameValue(viewer.json.forms, owner.json.forms), viewer.json.forms);
}

/** one play(who, planted) of a foreign-id route: sets the world and asks as the stranger (shop B) or as the owner (shop A); the record is planted for shop A only */
function playFor(port, item) {
  return async (who, planted) => {
    Object.assign(lab.world, { realAuth: false, who: who === 'owner' ? OWNER : STRANGER, asKey: false, db: 'ok', sqlRows: S.universal(planted), jsonThrows: false, noCustomer: false });
    return lab.send(port, item.method, item.url, item.body);
  };
}

/** the three routes that name an issued form: another shop's form answers exactly as one that does not exist (S35) */
async function checkForeignIds(port) {
  console.log('\n-- signed in as another shop: a foreign form id answers exactly as an unknown id (S35) --');
  const recording = FOREIGN.recorder();
  const items = [
    { route: 'GET /api/forms/instances/:id', method: 'GET', url: MOUNT + '/instances/' + S.INSTANCE },
    { route: 'POST /api/forms/instances/:id/sign', method: 'POST', url: MOUNT + '/instances/' + S.INSTANCE + '/sign', body: { name: 'R Kumar' } },
    { route: 'POST /api/forms/instances/:id/attach', method: 'POST', url: MOUNT + '/instances/' + S.INSTANCE + '/attach', body: { chit_id: S.CHIT } }
  ];
  const failures = await FOREIGN.runCases(items.map((item) => ({ route: item.route, play: playFor(port, item) })), recording.record);
  console.log('  foreign id: ' + (items.length - failures.length) + ' of ' + items.length + ' routes held');
  failures.forEach((sentence) => console.log('  FINDING ' + sentence));
  check('the three routes that name an issued form answer a foreign id as an unknown one, never 403 (' + Object.keys(recording.proved()).length + ' of ' + items.length + ')', failures.length === 0, failures);
  return { proved: recording.proved(), failures, asked: items.length };
}

/**
 * the caller's OWN second record: POST /attach names an issued form in the path AND a chit in the body. The form is the caller's own; the chit is another shop's. It must answer
 * exactly as a chit that does not exist (the same 403 bytes), and the caller's own chit is filed. The plant for the stranger is the caller's own instance with a chit of shop B.
 */
async function checkSecondRecord(port) {
  console.log('\n-- POST /attach: the caller\'s own form, another shop\'s chit --');
  const ask = async (chit, planted) => {
    const rows = (sql, params) => {
      const text = String(sql);
      if (/FROM form_instance WHERE entity_id = \$1 AND form_id = \$2/.test(text)) return { rows: [S.row()], rowCount: 1 };
      if (/FROM chit_header WHERE chit_id = \$1 AND entity_id = \$2/.test(text)) return planted && params[0] === chit && params[1] === S.SHOP ? { rows: [{ all_recipients: [{ entity_id: S.SHOP, role: 'receiver' }] }], rowCount: 1 } : { rows: [], rowCount: 0 };
      return null;
    };
    Object.assign(lab.world, { realAuth: false, who: OWNER, db: 'ok', jsonThrows: false, sqlRows: rows });
    const modules = sources();
    const original = modules.storage.putForParticipants;
    modules.storage.putForParticipants = async () => 'att-0001';
    const answer = await lab.send(port, 'POST', MOUNT + '/instances/' + S.INSTANCE + '/attach', { chit_id: chit });
    modules.storage.putForParticipants = original;
    return answer;
  };
  const unknown = await ask(S.OTHER_CHIT, false);
  const foreign = await ask(S.OTHER_CHIT, false);
  const own = await ask(S.CHIT, true);
  check("another shop's chit named on the caller's own form answers exactly as a chit that does not exist: 403, the same bytes", foreign.status === 403 && foreign.text === unknown.text, [foreign.text, unknown.text]);
  check('the answer is a Problem and never names the chit', /problem\+json/.test(foreign.type) && !foreign.text.includes(S.OTHER_CHIT), foreign.text);
  check("the caller's own chit is filed (the proof reached the case)", own.status === 200 && own.json && own.json.chit_id === S.CHIT, [own.status, own.text]);
}

/** Q18: an unknown body key is refused by name with the Problem's field list, and a known key is accepted */
async function checkClosedBodies(port) {
  console.log('\n-- Q18: a key the route never named is refused; every key it names is accepted --');
  const ask = async (route, url, body, setup, patch) => {
    const answer = await askWithPatch(port, { route, url, body, patch: patch || {} });
    return answer;
  };
  Object.assign(lab.world, { who: OWNER });
  const refused = await ask('POST /api/forms/:key/resolve', MOUNT + '/' + S.FORM + '/resolve', { manual: S.FULL, junk: 1 });
  check('POST /resolve with an unknown key is a 422 Problem that names the key', refused.status === 422 && /problem\+json/.test(refused.type) && /junk/.test(refused.text), [refused.status, refused.text.slice(0, 200)]);
  const accepted = await ask('POST /api/forms/:key/resolve', MOUNT + '/' + S.FORM + '/resolve', { manual: S.FULL, context_ref: null });
  check('POST /resolve with both keys it names (context_ref, manual) is accepted', accepted.status === 200, [accepted.status, accepted.text.slice(0, 200)]);
  const asList = await ask('POST /api/forms/:key/resolve', MOUNT + '/' + S.FORM + '/resolve', [1, 2]);
  check('a body that is a list is still accepted, as it was (the handler read it as nothing)', asList.status === 200, [asList.status, asList.text.slice(0, 200)]);
}

process.on('unhandledRejection', (failure) => console.log('  (unhandled rejection: ' + String(failure && failure.message).slice(0, 80) + ')'));
(async () => {
  extrasList().filter((one) => one.after).forEach((one) => AFTER.add(one.id));
  if (lab.flagValue('--freeze')) return lab.freeze(lab.flagValue('--freeze'));
  lab.installStubs();
  const router = require(path.join(HERE, 'routes', 'forms.js'));
  const routes = lab.routesOf(router, MOUNT);
  check('premise: the router holds the eight forms routes (' + Object.keys(routes).length + ')', Object.keys(routes).length === ROUTE_COUNT, Object.keys(routes));
  const server = lab.appOf([{ mount: MOUNT, router }]).listen(0);
  const port = server.address().port;
  const recording = {};
  const capturing = lab.flagValue('--capture') || lab.flagValue('--compare');
  const words = contractModule();
  const allowed = capturing ? () => [] : words ? words.allowedStatuses() : () => [];
  const all = lab.scenariosOf(routes, WORLDS, extrasList(), { key: S.FORM, id: S.INSTANCE });
  const ordinary = capturing ? all : all.filter((one) => !one.synthetic);
  const tested = await lab.checkRoutes(port, ordinary, recording, allowed, sources);
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
  check('premise: the scenes reached something on every route (' + Object.keys(tested).length + ' of ' + ROUTE_COUNT + ' routes answered a refusal)', Object.keys(tested).length === ROUTE_COUNT, Object.keys(tested));
  checkWords();
  checkCodesRegistered();
  checkContractShape(routes, router);
  await checkCarriedStatus(port, all.filter((one) => one.synthetic));
  checkFrozen5xx(recording);
  checkNoLeakAnywhere(recording);
  await checkMayOnTheList(port);
  const foreign = await checkForeignIds(port);
  await checkSecondRecord(port);
  await checkClosedBodies(port);
  server.close();
  const legacy = legacyRoutes();
  const frozen = Object.keys(legacy).filter(lab.mine).reduce((sum, route) => sum + legacy[route].answers.length, 0);
  check('every refusal recorded before the sweep is replayed against the code: ' + frozen + ' answers, each once, byte for byte', frozen >= 40, frozen);
  const coverage = lab.coverageOf(tested);
  const onDisk = JSON.parse(fs.readFileSync(TESTED_FILE, 'utf8'));
  const mine = Object.fromEntries(Object.keys(onDisk).filter(lab.mine).sort().map((route) => [route, onDisk[route]]));
  if (lab.argv.includes('--write')) {
    const others = Object.fromEntries(Object.keys(onDisk).filter((route) => !lab.mine(route)).map((route) => [route, onDisk[route]]));
    const merged = Object.assign(others, coverage);
    fs.writeFileSync(TESTED_FILE, JSON.stringify(Object.fromEntries(Object.keys(merged).sort().map((route) => [route, merged[route]])), null, 1) + '\n');
    FOREIGN.writeEvidence(EVIDENCE_FILE, lab.mine, foreign.proved);
  } else {
    check('docs/contracts/api-error-tests.json lists exactly the statuses these scenarios cover for routes/forms.js', sameValue(mine, coverage), { onDisk: mine, covered: coverage });
    check('docs/contracts/api-hardening-evidence-areas.json says foreign_id_404 for exactly the routes that held here', sameValue(FOREIGN.evidenceOf(EVIDENCE_FILE, lab.mine), foreign.proved), { onDisk: Object.keys(FOREIGN.evidenceOf(EVIDENCE_FILE, lab.mine)).length, held: Object.keys(foreign.proved).length });
  }
  console.log('\n  ' + lab.count.passed + ' checks, ' + lab.count.failed + ' failed');
  process.exit(lab.count.failed ? 1 : 0);
})();
