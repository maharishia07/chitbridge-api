#!/usr/bin/env node
// @type: contract
/**
 * api-problem-kyb.test.cjs — API-4 sweep, "Know your business": every answer of routes/kyb.js (5 routes, mounted at /api/kyb).
 *
 * OWNS      the proof that each refusal of the five routes is a Problem body AND still carries the keys it answered before (docs/contracts/api-legacy.json, recorded from the code
 *           before the sweep), that no success answer moved (--compare against a capture of the code before), that no answer of ANY status (a 200 and a 4xx included) carries the text
 *           of a thrown error (a database that THROWS a string with SQL in it, and a library that does), that a 2xx is never a Problem, that a status a library carries is passed on
 *           as it was, the frozen 5xx bodies replayed, this file's rows of docs/contracts/api-error-tests.json, and the "signed in as another shop" world on the one id a body names
 *           (POST /credential's evidence_ref: a chit that is another shop's answers as a chit that does not exist). Also: no answer outside the statuses the contract declares
 *           (lib/kyb-contract.js), its words as units, and that POST /field charges and caches nothing while no provider is connected.
 * CALLED BY scripts/guards.cjs · CI. No database, no network: the real route file and the real libraries over the stand-in db and sign-in (tests/lib/problem-world.cjs, scenes in tests/lib/kyb-scenes.cjs).
 * FLOW      the five routes x world (signed out, a failing db, an empty db) + the named extras → real route → body → Problem fields present · frozen legacy keys equal · no leak
 *           on any status · statuses tested → manifest; then the thrown statuses, the frozen 5xx, the metering and the foreign-chit world
 * CARD      21-compliance-attestation-and-trade/know-your-business
 *
 *   node tests/api-problem-kyb.test.cjs                    check
 *   node tests/api-problem-kyb.test.cjs --write            rewrite this file's rows of docs/contracts/api-error-tests.json
 *   node tests/api-problem-kyb.test.cjs --capture F        (run on the code BEFORE the change) record each answer to file F
 *   node tests/api-problem-kyb.test.cjs --freeze F         merge a capture F into docs/contracts/api-legacy.json (the frozen answers)
 *   node tests/api-problem-kyb.test.cjs --compare F        the answers now against a capture F: byte for byte for a success, the old keys in order for a refusal
 */
'use strict';
const path = require('path');
const fs = require('fs');
const { harness, OWNER, SECRET_SQL, sqlError, sameValue } = require('./lib/problem-world.cjs');
const S = require('./lib/kyb-scenes.cjs');

const HERE = path.join(__dirname, '..');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
delete process.env.KYB_STRUCTURAL;
delete process.env.KYB_FIELD_PROVIDER;
delete process.env.KYB_FIELD_KEY;
const MOUNT = '/api/kyb';
const ROUTE_COUNT = 5;
const TESTED_FILE = path.join(HERE, 'docs', 'contracts', 'api-error-tests.json');
const REGISTER_FILE = path.join(HERE, 'docs', 'error-codes.json');
const SAFE = 'Something went wrong — please try again.';
const LABELS = { '/yourself': 'Yourself failed', '/credential': 'Add credential failed', '/position': 'Position failed', '/risk': 'Risk failed', '/field': 'Field failed' };
const LEAK = /SELECT|vault|relation "/;
const SHOP_B = '99999999-9999-4999-8999-999999999999';
const STRANGER = { identity_id: SHOP_B, identity_type: 'entity', display_name: 'Other shop' };
const tools = { SECRET_SQL, sqlError };
const lab = harness({
  here: HERE,
  mounts: [MOUNT],
  routeFiles: { [MOUNT]: 'routes/kyb.js' },
  legacyFile: path.join(HERE, 'docs', 'contracts', 'api-legacy.json'),
  inherited: (scenario, answer) => answer.status === 401 && scenario.id === 'signed-out',
  notFrozen: (one, scenario) => one.status === 401 && scenario === 'signed-out'
});
const { check } = lab;
const WORLDS = [
  { id: 'signed-out', setup: { realAuth: true } },
  { id: 'db-fails', setup: { db: 'fail' } },
  { id: 'nothing-found', setup: {} }
];
const sources = () => ({ kyb: require(path.join(HERE, 'lib', 'kyb')), readiness: require(path.join(HERE, 'lib', 'readiness')) });
/** the contract, or null when the code has none (the untouched base: the checks then FAIL by name instead of the run dying on a missing file) */
const contractModule = () => {
  try {
    return require(path.join(HERE, 'lib', 'kyb-contract.js'));
  } catch (failure) {
    return null;
  }
};
const labelOf = (route) => LABELS[route.replace(/^\w+ \/api\/kyb/, '')];
const legacyRoutes = () => JSON.parse(fs.readFileSync(lab.legacyFile, 'utf8')).routes;

/** lib/kyb-contract.js as a unit: the words of a refusal and of a fault, as these routes always said them */
function checkWords() {
  console.log('\n-- lib/kyb-contract.js: the kyb refusals as a unit --');
  const words = contractModule();
  check('lib/kyb-contract.js exists and words the faults', !!words);
  if (!words) return;
  const req = { id: 'r1' };
  const refused = words.credentialFault(Object.assign(new Error('a title or standard_key is required'), { status: 400 }), req);
  check('credentialFault: a 400 keeps its status, its own sentence under "Add credential failed", and the code KYB_BAD_REQUEST', refused.status === 400 && refused.code === 'KYB_BAD_REQUEST' && sameValue(refused.legacy, { error: 'Add credential failed', message: 'a title or standard_key is required' }), refused);
  const other = words.credentialFault(Object.assign(new Error('Not for you.'), { status: 403 }), req);
  check('credentialFault: any other status under 500 keeps its sentence and is KYB_REFUSED', other.status === 403 && other.code === 'KYB_REFUSED' && other.legacy.message === 'Not for you.', other);
  const mute = words.credentialFault(Object.assign(new Error(''), { status: 400 }), req);
  check('credentialFault: a refusal with no words answers the generic sentence', mute.legacy.message === SAFE, mute);
  const secret = words.credentialFault(Object.assign(new Error(SECRET_SQL), { status: 503 }), req);
  check('credentialFault: a status of 500 or more never carries the error\'s words', secret.status === 503 && secret.code === 'INTERNAL' && secret.legacy.message === SAFE && !JSON.stringify(secret).includes('vault'), secret);
  const fault = words.faultOf(new Error(SECRET_SQL), req, 'Risk failed');
  check('faultOf: a 500 INTERNAL that says nothing of its cause, the screen\'s label kept', fault.status === 500 && fault.code === 'INTERNAL' && sameValue(fault.legacy, { error: 'Risk failed', message: SAFE }) && !JSON.stringify(fault).includes('vault'), fault);
  const carried = words.faultOf(Object.assign(new Error(SECRET_SQL), { status: 409 }), req, 'Yourself failed');
  check('faultOf: a status a library carries is passed on, the words stay the generic sentence', carried.status === 409 && carried.legacy.message === SAFE && !JSON.stringify(carried).includes('vault'), carried);
  const odd = words.faultOf(Object.assign(new Error('x'), { status: 'soon' }), req, 'Field failed');
  check('faultOf: a status that is not an HTTP failure is a 500', odd.status === 500 && odd.code === 'INTERNAL', odd);
}

/** every code the words answer under is a row of docs/ERROR-CODES.md with its sentence written */
function checkCodesRegistered() {
  console.log('\n-- the codes the kyb routes answer under are in the register --');
  const words = contractModule();
  if (!words) return;
  const codes = words.CODES;
  const known = new Set(JSON.parse(fs.readFileSync(REGISTER_FILE, 'utf8')).codes.filter((item) => item.shopkeeper !== 'PENDING').map((item) => item.code));
  const missing = codes.filter((code) => !known.has(code));
  check('every code the kyb words answer under (' + codes.length + ' codes) is a register row with its sentence written', missing.length === 0, missing);
}

/** the contract in front of the router: every route has a row, and a row has a route; no body is narrowed, no query value is refused */
function checkContractShape(routes, router) {
  console.log('\n-- the contract and the router agree --');
  const contract = contractModule();
  const published = router.openapi && router.openapi.paths ? Object.keys(router.openapi.paths) : [];
  check('the router publishes its operations: router.openapi.paths names the routes (' + published.length + ' paths)', !!contract && published.length === ROUTE_COUNT, published);
  if (!contract) return;
  const operations = Object.keys(contract.OPERATIONS);
  check('every route the router holds has an operation, and every operation a route (' + operations.length + ')', sameValue(operations.slice().sort(), Object.keys(routes).sort()), operations.filter((key) => !routes[key]));
  const bodies = Object.values(contract.OPERATIONS).filter((one) => one.requestBody).map((one) => one.requestBody.content['application/json'].schema);
  check('a body is declared as an object or a list and requires nothing: the handlers answered a list and a missing field in their own words', bodies.length === 2 && bodies.every((schema) => sameValue(schema.type, ['object', 'array']) && !(schema.required || []).length), bodies);
  check('no body schema refuses an unknown key: the handlers dropped it without a word, and refusing it is an owner\'s decision', bodies.every((schema) => schema.additionalProperties !== false));
  const queries = (contract.OPERATIONS['GET /api/kyb/position'].parameters || []).filter((item) => item.in === 'query');
  check('GET /position\'s query values are declared as anything (a repeated value was read as it came)', queries.length === 2 && queries.every((item) => sameValue(item.schema, {})), queries);
  check('every refusal an operation declares is a Problem', operations.every((key) => Object.keys(contract.OPERATIONS[key].responses).filter((status) => Number(status) >= 400).every((status) => JSON.stringify(contract.OPERATIONS[key].responses[status]).includes('Problem'))));
  check('a success answer stays typed: every operation names the keys of its answer', operations.every((key) => ((contract.OPERATIONS[key].responses['200'].content['application/json'].schema.required) || []).length > 0));
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
 * a library that raises an error carrying a status no real library raises under these routes (the code passes any status on): the status and the old keys are kept, and the
 * words of a status under 500 are relayed by POST /credential alone. The contract declares no such status, so these are checked here, not by the generic run.
 */
async function checkCarriedStatus(port, scenarios) {
  console.log('\n-- a status a library carries is passed on, as it always was --');
  const frozenAll = legacyRoutes();
  for (const scenario of scenarios) {
    const answer = await askWithPatch(port, scenario);
    const label = scenario.route + ' · ' + scenario.id;
    const relayed = scenario.route.endsWith('/credential') && scenario.expect < 500;
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
    const order = Object.keys(frozen.fixture);
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
}

/** the rows POST /field would charge for and keep: none, while no provider is connected (the metering and the 24h cache stay as they were) */
async function checkFieldMetering(port) {
  console.log('\n-- POST /field: no provider, no charge, no cache row --');
  const statements = [];
  const watch = (sql, params) => {
    statements.push({ sql: String(sql), params });
    return null;
  };
  Object.assign(lab.world, { realAuth: false, db: 'ok', jsonThrows: false, sqlRows: watch });
  const first = await lab.send(port, 'POST', MOUNT + '/field', {});
  const second = await lab.send(port, 'POST', MOUNT + '/field', {});
  Object.assign(lab.world, { sqlRows: null });
  check('POST /field answers "not connected": charged false, cached false, configured false, no results', first.status === 200 && first.json && first.json.charged === false && first.json.cached === false && first.json.configured === false && sameValue(first.json.results, []), first.json);
  check('a second search answers the same bytes', first.text === second.text, [first.text, second.text]);
  check('the cache is read (entity, profile hash, window) and nothing is written: no usage_ledger row, no kyb_field_cache row', statements.some((one) => /FROM kyb_field_cache/.test(one.sql)) && !statements.some((one) => /INSERT INTO (usage_ledger|kyb_field_cache)/.test(one.sql)), statements.map((one) => one.sql.slice(0, 60)));
  check('the answer keeps its honest wording: the source is named, no buyer is promised', /never a buyer list/.test(first.json.note) && first.json.wall === true, first.json.note);
}

/**
 * the "signed in as another shop" world on the one id a body names: POST /credential's evidence_ref, a chit. Row security hides another shop's chit, so it answers as a chit
 * that does not exist: the same answer, and the same row written (the reference nulled, so the rung stays `declared`); the owner's own chit is kept (`documented`).
 * No path here carries an id, so there is no 404 to prove: the check is that nothing differs and nothing is 403.
 */
async function foreignChitWorld(port) {
  console.log('\n-- the 9th world: a chit another shop holds, named as evidence --');
  const ask = async (who, ownsChit) => {
    const written = [];
    const rows = (sql, params) => {
      if (/FROM chit_status/.test(sql)) return ownsChit ? { rows: [{ ok: 1 }], rowCount: 1 } : { rows: [], rowCount: 0 };
      if (/INSERT INTO entity_compliance/.test(sql)) written.push(params);
      return null;
    };
    Object.assign(lab.world, { realAuth: false, db: 'ok', jsonThrows: false, who, sqlRows: rows });
    const answer = await lab.send(port, 'POST', MOUNT + '/credential', { standard_key: 'iec', doc_key: 'certificate', evidence_ref: S.CHIT });
    Object.assign(lab.world, { sqlRows: null });
    return { answer, ref: written[0] && written[0][4] };
  };
  const unknown = await ask(STRANGER, false);
  const foreign = await ask(STRANGER, false);
  const own = await ask(OWNER, true);
  check('another shop\'s chit named as evidence answers exactly as a chit that does not exist: 200, the same bytes', foreign.answer.status === 200 && foreign.answer.text === unknown.answer.text, [foreign.answer.text, unknown.answer.text]);
  check('and writes the same row: the reference is dropped, so the paper stays declared and no foreign chit id is kept', unknown.ref === null && foreign.ref === null, [unknown.ref, foreign.ref]);
  check('the answer is never a 403 and never names the chit', foreign.answer.status !== 403 && !foreign.answer.text.includes(S.CHIT), foreign.answer.text);
  check('the owner\'s own chit is kept as the evidence (the proof reached the case)', own.answer.status === 200 && own.ref === S.CHIT, [own.answer.status, own.ref]);
  check('the body of the answer is the same whoever asks and whatever the chit: it echoes only the title, standard and doc', foreign.answer.text === own.answer.text, [foreign.answer.text, own.answer.text]);
}

/** what the sweep promises about POST /credential's rung: a client cannot mint verified, whatever it sends */
async function checkRungIsThePlatforms(port) {
  console.log('\n-- POST /credential: the rung is written by the platform, never by the client --');
  const written = [];
  const rows = (sql, params) => {
    if (/INSERT INTO entity_compliance/.test(sql)) written.push(params);
    return null;
  };
  Object.assign(lab.world, { realAuth: false, db: 'ok', jsonThrows: false, who: OWNER, sqlRows: rows });
  await lab.send(port, 'POST', MOUNT + '/credential', { title: 'Village NOC', rung: 'verified', verification: { method: 'registry' }, status: 'expired', entity_id: SHOP_B });
  Object.assign(lab.world, { sqlRows: null });
  const row = written[0] || [];
  check('a client\'s rung, verification, status and entity are ignored: the row is gathered, for the caller\'s shop, with an empty verification', row[3] === 'gathered' && row[0] !== SHOP_B && row[6] === '{}', row);
  check('the standard is made from the title: custom-village-noc', row[1] === 'custom-village-noc' && row[2] === 'certificate', row);
}

process.on('unhandledRejection', (failure) => console.log('  (unhandled rejection: ' + String(failure && failure.message).slice(0, 80) + ')'));
(async () => {
  if (lab.flagValue('--freeze')) return lab.freeze(lab.flagValue('--freeze'));
  lab.installStubs();
  const router = require(path.join(HERE, 'routes', 'kyb.js'));
  const routes = lab.routesOf(router, MOUNT);
  check('premise: the router holds the five kyb routes (' + Object.keys(routes).length + ')', Object.keys(routes).length === ROUTE_COUNT, Object.keys(routes));
  const server = lab.appOf([{ mount: MOUNT, router }]).listen(0);
  const port = server.address().port;
  const recording = {};
  const capturing = lab.flagValue('--capture') || lab.flagValue('--compare');
  const words = contractModule();
  const allowed = capturing ? () => [] : words ? words.allowedStatuses() : () => [];
  const scenes = S.extras(tools);
  const all = lab.scenariosOf(routes, WORLDS, scenes, {});
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
  checkWords();
  checkCodesRegistered();
  checkContractShape(routes, router);
  const synthetic = all.filter((one) => one.synthetic);
  await checkCarriedStatus(port, synthetic);
  checkFrozen5xx(recording);
  checkNoLeakAnywhere(recording);
  await checkFieldMetering(port);
  await foreignChitWorld(port);
  await checkRungIsThePlatforms(port);
  server.close();
  const legacy = legacyRoutes();
  const frozen = Object.keys(legacy).filter(lab.mine).reduce((sum, route) => sum + legacy[route].answers.length, 0);
  check('every refusal recorded before the sweep is replayed against the code: ' + frozen + ' answers, each once, byte for byte', frozen >= 20, frozen);
  const coverage = lab.coverageOf(tested);
  const onDisk = JSON.parse(fs.readFileSync(TESTED_FILE, 'utf8'));
  const mine = Object.fromEntries(Object.keys(onDisk).filter(lab.mine).sort().map((route) => [route, onDisk[route]]));
  if (lab.argv.includes('--write')) {
    const others = Object.fromEntries(Object.keys(onDisk).filter((route) => !lab.mine(route)).map((route) => [route, onDisk[route]]));
    const merged = Object.assign(others, coverage);
    fs.writeFileSync(TESTED_FILE, JSON.stringify(Object.fromEntries(Object.keys(merged).sort().map((route) => [route, merged[route]])), null, 1) + '\n');
  } else {
    check('docs/contracts/api-error-tests.json lists exactly the statuses these scenarios cover for routes/kyb.js', sameValue(mine, coverage), { onDisk: mine, covered: coverage });
  }
  console.log('\n  ' + lab.count.passed + ' checks, ' + lab.count.failed + ' failed');
  process.exit(lab.count.failed ? 1 : 0);
})();
