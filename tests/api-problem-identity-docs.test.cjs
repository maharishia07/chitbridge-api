#!/usr/bin/env node
// @type: contract
/**
 * api-problem-identity-docs.test.cjs — API-4 sweep, a person's own identity documents: every answer of routes/identity-docs.js (4 routes, mounted at /api/identity).
 *
 * ⚠️ PERSONAL DATA. Every number in this file and in tests/lib/identity-docs-scenes.cjs is an obviously made-up placeholder (zeros, AAAAA0000A). No answer, log line or report may
 * carry a real-looking Aadhaar, PAN, voter, licence or phone number.
 *
 * OWNS      the proof that each refusal of the four routes is a Problem body AND still carries the keys it answered before (docs/contracts/api-legacy.json, recorded from the code
 *           before the sweep), that no success answer moved (--compare against a capture of the code before: masking, the stamp, the code flow), that no answer of ANY status (a 200
 *           and a 4xx included) carries the text of a thrown error or a full document number, that a 2xx is never a Problem, that a status a library carries is passed on as it was,
 *           the frozen 5xx bodies replayed, this file's rows of docs/contracts/api-error-tests.json, the "signed in as another shop" world on the two POST routes (the person comes from
 *           the token, so another shop's record answers as no record) and on the `identity_id` a body or query may name (a foreign or unknown person answers alike, 403, never the
 *           record), the masking per scheme (Aadhaar never stored), the verification-code flow end to end (issue, wrong attempts, lock, expiry, stamp), and that `dev_otp` rides a
 *           200 only where lib/dev-otp.js allows it. Also: no answer outside the statuses the contract declares (lib/identity-docs-contract.js) and its words as units.
 * CALLED BY scripts/guards.cjs · CI. No database, no network: the real route file and the real libraries over the stand-in db and sign-in (tests/lib/problem-world.cjs, scenes in tests/lib/identity-docs-scenes.cjs).
 * FLOW      the four routes x world (signed out, a failing db, an empty db) + the named extras → real route → body → Problem fields present · frozen legacy keys equal · no leak
 *           on any status · statuses tested → manifest; then the thrown statuses, the frozen 5xx, the masking, the code flow and the foreign worlds
 * CARD      18-identity-sign-in-and-access/README
 *
 *   node tests/api-problem-identity-docs.test.cjs                    check
 *   node tests/api-problem-identity-docs.test.cjs --write            rewrite this file's rows of docs/contracts/api-error-tests.json and api-hardening-evidence-areas.json
 *   node tests/api-problem-identity-docs.test.cjs --capture F        (run on the code BEFORE the change) record each answer to file F
 *   node tests/api-problem-identity-docs.test.cjs --freeze F         merge a capture F into docs/contracts/api-legacy.json (the frozen answers)
 *   node tests/api-problem-identity-docs.test.cjs --compare F        the answers now against a capture F: byte for byte for a success, the old keys in order for a refusal
 */
'use strict';
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { harness, OWNER, STAFF, SECRET_SQL, sqlError, sameValue } = require('./lib/problem-world.cjs');
const FOREIGN = require('./lib/foreign-id-world.cjs');
const S = require('./lib/identity-docs-scenes.cjs');

const HERE = path.join(__dirname, '..');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
process.env.VAULT_ENC_KEY = Buffer.alloc(32, 7).toString('base64'); /* a made-up key, for this run only */
['DEV_OTP', 'DEV_OTP_IN_RESPONSE', 'SMS_PROVIDER', 'SMS_API_KEY', 'OTP_EMAIL_ENABLED', 'RESEND_API_KEY'].forEach((name) => delete process.env[name]);
const MOUNT = '/api/identity';
const ROUTE_COUNT = 4;
const TESTED_FILE = path.join(HERE, 'docs', 'contracts', 'api-error-tests.json');
const EVIDENCE_FILE = path.join(HERE, 'docs', 'contracts', 'api-hardening-evidence-areas.json');
const REGISTER_FILE = path.join(HERE, 'docs', 'error-codes.json');
const SAFE = 'Something went wrong — please try again.';
const LEAK = /SELECT secret|catalogue_items|relation "/;
const SHOP_B = '99999999-9999-4999-8999-999999999999';
const STRANGER = { identity_id: SHOP_B, identity_type: 'entity', display_name: 'Other shop' };
const tools = { SECRET_SQL, sqlError };
const KEYS = { GET: 'GET /api/identity/documents', PUT: 'PUT /api/identity/documents/:scheme', CODE: 'POST /api/identity/documents/:scheme/code', VERIFY: 'POST /api/identity/documents/:scheme/verify' };
/** what a document number looks like once the route has normalised it: none of these may ever be in an answer */
const FULL_VALUES = [S.VALUES.PHONE, '+0000000000', S.VALUES.EMAIL, S.VALUES.PAN, S.VALUES.VOTER_ID, S.VALUES.DL, S.VALUES.AADHAAR, '0000 0000 0000', '10000000000'];
const lab = harness({
  here: HERE,
  mounts: [MOUNT],
  routeFiles: { [MOUNT]: 'routes/identity-docs.js' },
  legacyFile: path.join(HERE, 'docs', 'contracts', 'api-legacy.json'),
  leak: /SELECT secret|catalogue_items|relation "/ /* the stand-in's own SQL text: the word 'vault' is in a code of this area (VAULT_ENC_UNCONFIGURED) */,
  inherited: (scenario, answer) => answer.status === 401 && scenario.id === 'signed-out',
  notFrozen: (one, scenario) => one.status === 401 && scenario === 'signed-out',
  before: async () => require(path.join(HERE, 'lib', 'schema'))._reset() /* the table-present answer is cached for a minute: every scene starts clean */
});
const { check } = lab;
const WORLDS = [
  { id: 'signed-out', setup: { realAuth: true } },
  { id: 'db-fails', setup: { db: 'fail' } },
  { id: 'nothing-found', setup: {} }
];
const sources = () => ({ schema: require(path.join(HERE, 'lib', 'schema')), notify: require(path.join(HERE, 'lib', 'notify')), devOtp: require(path.join(HERE, 'lib', 'dev-otp')) });
/** the contract, or null when the code has none (the untouched base: the checks then FAIL by name instead of the run dying on a missing file) */
const contractModule = () => {
  try {
    return require(path.join(HERE, 'lib', 'identity-docs-contract.js'));
  } catch (failure) {
    return null;
  }
};
const legacyRoutes = () => JSON.parse(fs.readFileSync(lab.legacyFile, 'utf8')).routes;
const sha = (text) => crypto.createHash('sha256').update(text).digest('hex');
const asWorld = (who, options, patch) => Object.assign(lab.world, { realAuth: false, who, db: 'ok', jsonThrows: false, sqlRows: S.world(options) }, patch || {});
const stop = () => Object.assign(lab.world, { sqlRows: null, who: OWNER });

/** lib/identity-docs-contract.js as a unit: the words of a fault and of a library's refusal, as these routes always said them */
function checkWords() {
  console.log('\n-- lib/identity-docs-contract.js: the refusals as a unit --');
  const words = contractModule();
  check('lib/identity-docs-contract.js exists and words the faults', !!words);
  if (!words) return;
  const req = { id: 'r1' };
  const refused = words.faultOf(Object.assign(new Error('That person is not one of your co-assists.'), { status: 403, code: 'IDOC_SUBJECT_FORBIDDEN' }), req);
  check('faultOf: a refusal the route meant (403) keeps its status, its code and its fixed sentence', refused.status === 403 && refused.code === 'IDOC_SUBJECT_FORBIDDEN' && sameValue(refused.legacy, { error: 'IDOC_SUBJECT_FORBIDDEN', message: 'That person is not one of your co-assists.' }) && refused.detail === 'That person is not one of your co-assists.', refused);
  const plain = words.faultOf(new Error(SECRET_SQL), req);
  check('faultOf: an error with no status is a 500 INTERNAL, the generic sentence, nothing of its cause', plain.status === 500 && plain.code === 'INTERNAL' && sameValue(plain.legacy, { error: 'Server error', message: SAFE }) && !LEAK.test(JSON.stringify(plain)), plain);
  const coded = words.faultOf(sqlError('42501'), req);
  check('faultOf: the error\'s own `code` is still the old `error` key (FROZEN; listed for cb-security), the sentence stays generic', coded.status === 500 && coded.legacy.error === '42501' && coded.legacy.message === SAFE && coded.detail !== '42501', coded);
  const unreachable = words.faultOf(Object.assign(new Error(RELAYED_WORDS), { status: 503 }), req);
  check('faultOf: a thrown 503 relays its own words in the old `message` (FROZEN), the Problem detail stays generic', unreachable.status === 503 && unreachable.code === 'INTERNAL' && unreachable.legacy.message === RELAYED_WORDS && unreachable.detail !== RELAYED_WORDS, unreachable);
  const odd = words.faultOf(Object.assign(new Error('x'), { status: 'soon' }), req);
  check('faultOf: a status that is not an HTTP failure is a 500', odd.status === 500, odd);
  const library = words.libraryRefusal({ status: 429, body: { error: 'Locked', code: 'OTP_LOCKED', message: 'Too many incorrect attempts — request a new code.' } });
  check('libraryRefusal: a body the library built keeps its status, its code and every old key', library.status === 429 && library.code === 'OTP_LOCKED' && sameValue(Object.keys(library.legacy), ['error', 'code', 'message']) && library.detail === library.legacy.message, library);
}
const RELAYED_WORDS = S.RELAYED;

/** every code the words answer under is a row of docs/ERROR-CODES.md with its sentence written */
function checkCodesRegistered() {
  console.log('\n-- the codes the identity routes answer under are in the register --');
  const words = contractModule();
  if (!words) return;
  const known = new Set(JSON.parse(fs.readFileSync(REGISTER_FILE, 'utf8')).codes.filter((item) => item.shopkeeper !== 'PENDING').map((item) => item.code));
  const missing = words.CODES.filter((code) => !known.has(code));
  check('every code the identity words answer under (' + words.CODES.length + ' codes) is a register row with its sentence written', missing.length === 0, missing);
}

/** the contract in front of the router: every route has a row, and a row has a route; no body is narrowed, no query value is refused */
function checkContractShape(routes, router) {
  console.log('\n-- the contract and the router agree --');
  const contract = contractModule();
  const published = router.openapi && router.openapi.paths ? Object.keys(router.openapi.paths) : [];
  check('the router publishes its operations: router.openapi.paths names the routes (' + published.length + ' paths)', !!contract && published.length === 4, published);
  if (!contract) return;
  const operations = Object.keys(contract.OPERATIONS);
  check('every route the router holds has an operation, and every operation a route (' + operations.length + ')', sameValue(operations.slice().sort(), Object.keys(routes).sort()), operations.filter((key) => !routes[key]));
  const bodies = Object.values(contract.OPERATIONS).filter((one) => one.requestBody).map((one) => one.requestBody.content['application/json'].schema);
  check('the three bodies are declared as an object or a list and require nothing: the handlers answered a list and a missing field in their own words', bodies.length === 3 && bodies.every((schema) => sameValue(schema.type, ['object', 'array']) && !(schema.required || []).length), bodies);
  check('no body schema refuses an unknown key: the handlers dropped it without a word, and refusing it is an owner\'s decision (strict_input stays open)', bodies.every((schema) => schema.additionalProperties !== false));
  const queries = [].concat(...Object.values(contract.OPERATIONS).map((one) => (one.parameters || []).filter((item) => item.in === 'query')));
  check('every query value is declared as anything (a repeated value was read as it came)', queries.length >= 4 && queries.every((item) => sameValue(item.schema, {})), queries);
  check('a document value, a code and a consent are declared as anything: a number was taken as a phone, a number as a code', sameValue(contract.OPERATIONS[KEYS.PUT].requestBody.content['application/json'].schema.properties.value, {}) && sameValue(contract.OPERATIONS[KEYS.VERIFY].requestBody.content['application/json'].schema.properties.code, {}));
  check('every refusal an operation declares is a Problem', operations.every((key) => Object.keys(contract.OPERATIONS[key].responses).filter((status) => Number(status) >= 400).every((status) => JSON.stringify(contract.OPERATIONS[key].responses[status]).includes('Problem'))));
  /* R2-13 (#390): the 200 schema is derived from recorded answers; a handler that answers a passed-through expression is recorded OPEN with its reason in docs/contracts/api-output-shapes.json — honest, not untyped by accident */
  const shapes = require('../docs/contracts/api-output-shapes.json');
  const shapeRow = (key) => (shapes.routes || shapes)[key] || {};
  check('a success answer stays typed: every operation names the keys of its answer, or its recorded shape is open with a reason (R2-13)', operations.every((key) => ((contract.OPERATIONS[key].responses['200'].content['application/json'].schema.required) || []).length > 0 || (shapeRow(key).open || []).some((item) => item.reason)));
  const declared = (key) => Object.keys(contract.OPERATIONS[key].responses).map(Number);
  check('POST /code declares the statuses lib/iddoc-verify.js can answer: 400, 409 and 503 beside the 404 and the 403', [400, 403, 404, 409, 503].every((status) => declared(KEYS.CODE).includes(status)), declared(KEYS.CODE));
  check('POST /verify declares 400 and 429 (a computed status: both literals written) beside the 404 and the 403', [400, 403, 404, 429, 503].every((status) => declared(KEYS.VERIFY).includes(status)), declared(KEYS.VERIFY));
}

/** a library that raises an error carrying a status: the status and the old keys are kept, and the words are relayed whatever the status (the old catch); none carries foreign words today */
async function checkCarriedStatus(port, scenarios) {
  console.log('\n-- a status a library carries is passed on, its words relayed, as it always was --');
  const frozenAll = legacyRoutes();
  const modules = sources();
  for (const scenario of scenarios) {
    const undo = [];
    Object.keys(scenario.patch).forEach((which) => Object.keys(scenario.patch[which]).forEach((name) => { undo.push([modules[which], name, modules[which][name]]); modules[which][name] = scenario.patch[which][name]; }));
    asWorld(OWNER, {});
    const method = scenario.route.split(' ')[0];
    const answer = await lab.send(port, method, scenario.url, method === 'GET' ? undefined : scenario.body === undefined ? {} : scenario.body);
    undo.forEach(([owner, name, original]) => { owner[name] = original; });
    stop();
    const label = scenario.route + ' · ' + scenario.id;
    const frozen = (frozenAll[scenario.route] || { answers: [] }).answers.find((one) => one.scenario === scenario.id);
    const keys = frozen ? Object.keys(frozen.fixture) : [];
    check(label + ': the status is passed on (' + scenario.expect + ')', answer.status === scenario.expect, [answer.status, answer.text]);
    check(label + ': the old keys are kept and the words are relayed', answer.json && answer.json.message === scenario.says && typeof answer.json.error === 'string', answer.json);
    check(label + ': the answer is a Problem with a code', answer.json && /problem\+json/.test(answer.type) && typeof answer.json.code === 'string' && answer.json.status === answer.status, answer.type);
    check(label + ': it was frozen before the sweep, status and every old key in order', !!frozen && frozen.status === answer.status && sameValue(keys.map((name) => answer.json[name]), keys.map((name) => frozen.fixture[name])) && sameValue(Object.keys(answer.json).slice(0, keys.length), keys), frozen);
  }
}

/** every 5xx body frozen before the sweep is replayed: the same status and every old key, key by key and in order */
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
  check('at least twenty 5xx answers were frozen and replayed (' + replayed + ')', replayed >= 20, replayed);
}

/** a 2xx is never a Problem, and no answer of any status carries the text of a thrown error or a full document number */
function checkNoLeakAnywhere(recording) {
  console.log('\n-- the body scan: a 2xx is never a Problem, and no body carries a thrown text or a full number --');
  const keys = Object.keys(recording);
  const successes = keys.filter((key) => recording[key].status < 300);
  check('a 2xx answer is never a Problem (' + successes.length + ' answers)', successes.every((key) => !/problem/.test(recording[key].type) && !(recording[key].body && recording[key].body.type && recording[key].body.request_id !== undefined && recording[key].body.code)), successes.filter((key) => /problem/.test(recording[key].type)));
  const text = (key) => JSON.stringify(recording[key].body || {}) + (recording[key].text || '');
  const leaking = keys.filter((key) => LEAK.test(text(key)));
  check('no answer of any status, a 200 and a 4xx included, carries the database text (' + keys.length + ' answers scanned)', leaking.length === 0, leaking);
  const echoing = keys.filter((key) => FULL_VALUES.some((value) => text(key).includes(value)));
  check('no answer of any status carries a full document number or e-mail where the code masks it (' + keys.length + ' answers scanned, ' + FULL_VALUES.length + ' spellings)', echoing.length === 0, echoing);
  const faults = keys.filter((key) => recording[key].status === 500);
  check('every plain fault says only the generic sentence (' + faults.length + ' answers)', faults.every((key) => recording[key].body && recording[key].body.message === SAFE), faults.filter((key) => !recording[key].body || recording[key].body.message !== SAFE));
  check('a caller who is not signed in is refused with 401 on every route', keys.filter((key) => key.endsWith('|signed-out')).length === ROUTE_COUNT && keys.filter((key) => key.endsWith('|signed-out')).every((key) => recording[key].status === 401));
}

/** the masking per scheme: what is handed to the database is the mask, the hash and the sealed value; Aadhaar is never stored */
async function checkMasking(port) {
  console.log('\n-- masking: what the database is handed, and what the person is told --');
  const wanted = [
    ['PHONE', S.VALUES.PHONE, '•••••0000', true],
    ['EMAIL', ' Nobody@Example.TEST ', 'n•••@example.test', true],
    ['PAN', 'aaaaa 0000-a', 'AAA••••00A', true],
    ['VOTER_ID', S.VALUES.VOTER_ID, '•••0000', true],
    ['DL', S.VALUES.DL, '••••0000', true],
    ['AADHAAR', '0000 0000 0000', 'XXXX XXXX 0000', false]
  ];
  for (const [scheme, typed, mask, stored] of wanted) {
    const seen = [];
    asWorld(OWNER, { seen });
    const answer = await lab.send(port, 'PUT', MOUNT + '/documents/' + scheme, { value: typed });
    stop();
    const write = seen.find((one) => /INSERT INTO identity_documents/.test(one.sql));
    const params = write ? write.params : [];
    const normalised = scheme === 'EMAIL' ? S.VALUES.EMAIL : scheme === 'AADHAAR' ? S.VALUES.AADHAAR : scheme === 'PAN' ? S.VALUES.PAN : typed;
    check(scheme + ': the answer is 200 and tells the mask ' + mask + ', never the number', answer.status === 200 && answer.json && answer.json.document && answer.json.document.value_masked === mask && !FULL_VALUES.some((value) => answer.text.includes(value)), answer.text);
    check(scheme + ': the database is handed the mask and the document hash (a sha256 of SCHEME:value, keyed for Aadhaar by SEC-101) (' + (stored ? 'a sealed value' : 'NO value at all') + ')', params[4] === mask && params[5] === require(path.join(HERE, 'routes', 'identity-docs.js')).docHash(scheme, normalised) && (stored ? typeof params[6] === 'string' && !params[6].includes(normalised) : params[6] === null), params.map((value, index) => (index === 6 ? typeof value : value)));
  }
  const listed = [];
  asWorld(OWNER, { seen: listed, docs: S.GOT });
  await lab.send(port, 'GET', MOUNT + '/documents');
  stop();
  const read = listed.find((one) => /FROM identity_documents/.test(one.sql));
  check('GET selects the mask and the verdict only: never value_enc, value_hash or the pending code', !!read && !/value_enc|value_hash|verification_ref/.test(read.sql), read && read.sql);
}

/** ask for a code the stand-in way and read what is kept: the code itself is never stored, only its hash with an expiry and a count of wrong tries */
async function checkCodeFlow(port) {
  console.log('\n-- the code flow end to end: issue, a wrong attempt, lock, expiry, the stamp --');
  const modules = sources();
  const verifyLib = require(path.join(HERE, 'lib', 'iddoc-verify'));
  const undo = [[modules.devOtp, 'mayExposeOtp', modules.devOtp.mayExposeOtp], [modules.notify, 'sendOtpSms', modules.notify.sendOtpSms]];
  modules.devOtp.mayExposeOtp = () => true;
  modules.notify.sendOtpSms = async () => ({ delivered: true });
  const seen = [];
  asWorld(OWNER, { seen, record: { owner: S.SHOP, scheme: 'PHONE', value: S.VALUES.PHONE } });
  const issued = await lab.send(port, 'POST', MOUNT + '/documents/PHONE/code', {});
  stop();
  undo.forEach(([owner, name, original]) => { owner[name] = original; });
  const saved = seen.find((one) => /SET verification_ref = \$3/.test(one.sql));
  const ref = saved && saved.params[2];
  const parts = verifyLib.unpack(ref);
  check('a code is issued: 200 delivery sent, sent_to masked, expires_in 10 minutes', issued.status === 200 && issued.json && issued.json.delivery === 'sent' && issued.json.sent_to === '*****0000' && issued.json.expires_in === '10 minutes' && !issued.text.includes(S.VALUES.PHONE), issued.json);
  check('what is kept is otp:<sha256>:<expiry>:0, and the code itself is nowhere in it', !!parts && parts.tries === 0 && parts.hash === sha(S.SHOP + ':PHONE:' + issued.json.dev_otp), ref);
  check('the expiry is ten minutes ahead', !!parts && Math.abs(parts.exp - (Date.now() + verifyLib.TTL_MS)) < 60000, parts);
  const type = async (code, tries, expiresIn) => {
    const pendingRef = verifyLib.pack(issued.json.dev_otp, S.SHOP + ':PHONE', Date.now() + (expiresIn === undefined ? verifyLib.TTL_MS : expiresIn), tries);
    const writes = [];
    asWorld(OWNER, { seen: writes, record: { owner: S.SHOP, scheme: 'PHONE', value: S.VALUES.PHONE, ref: pendingRef } });
    const answer = await lab.send(port, 'POST', MOUNT + '/documents/PHONE/verify', { code });
    stop();
    return { answer, writes };
  };
  const right = await type(String(issued.json.dev_otp), 0);
  const stamped = right.writes.find((one) => /SET status = 'verified'/.test(one.sql));
  check('the right code verifies: 200 verified true with the stamp, the row is marked verified by otp:phone and the pending code is cleared', right.answer.status === 200 && right.answer.json.verified === true && right.answer.json.verified_at === S.STAMP && !!stamped && stamped.params[2] === 'otp:phone' && /verification_ref = NULL/.test(stamped.sql), right.answer.json);
  const wrong = await type('000000', 0);
  const counted = wrong.writes.find((one) => /SET verification_ref = \$3/.test(one.sql));
  check('a wrong code is 400 OTP_WRONG, says 4 left, and the count of wrong tries goes up by one', wrong.answer.status === 400 && wrong.answer.json.code === 'OTP_WRONG' && /4 attempts left/.test(wrong.answer.json.message) && verifyLib.unpack(counted && counted.params[2]).tries === 1, wrong.answer.json);
  const last = await type('000000', 4);
  check('the fifth wrong code locks: 429 OTP_LOCKED', last.answer.status === 429 && last.answer.json.code === 'OTP_LOCKED', last.answer.json);
  const locked = await type(String(issued.json.dev_otp), 5);
  check('a locked code refuses even the right code: 429 OTP_LOCKED, nothing stamped', locked.answer.status === 429 && !locked.writes.some((one) => /SET status = 'verified'/.test(one.sql)), locked.answer.json);
  const expired = await type(String(issued.json.dev_otp), 0, -1000);
  check('an expired code refuses the right code: 400 OTP_EXPIRED, nothing stamped', expired.answer.status === 400 && expired.answer.json.code === 'OTP_EXPIRED' && !expired.writes.some((one) => /SET status = 'verified'/.test(one.sql)), expired.answer.json);
}

/** `dev_otp` rides a 200 only where lib/dev-otp.js mayExposeOtp() allows it: here it does not, so no answer of the recorded run carries it */
async function checkDevOtpGate(port, recording) {
  console.log('\n-- dev_otp: only where lib/dev-otp.js allows it --');
  const carrying = Object.keys(recording).filter((key) => /dev_otp/.test(JSON.stringify(recording[key].body || {})));
  check('no recorded answer carries dev_otp while the environment does not allow it (' + Object.keys(recording).length + ' answers)', carrying.length === 0, carrying);
  const modules = sources();
  const before = modules.devOtp.mayExposeOtp;
  modules.devOtp.mayExposeOtp = () => true;
  asWorld(OWNER, { record: { owner: S.SHOP, scheme: 'PHONE', value: S.VALUES.PHONE } });
  const allowed = await lab.send(port, 'POST', MOUNT + '/documents/PHONE/code', {});
  stop();
  modules.devOtp.mayExposeOtp = before;
  check('where it is allowed, the 200 carries it (and the gate is the one function, not a copy)', allowed.status === 200 && /^\d{6}$/.test(String(allowed.json.dev_otp)), allowed.json);
}

/** the two POST routes are addressed by a scheme NAME; the person is the token. Another shop's record answers exactly as no record (404), the own record is reached. */
async function foreignRecordWorld(port) {
  console.log('\n-- the 9th world: signed in as another shop, asking for a record the first shop holds --');
  const modules = sources();
  const make = (scheme, last) => async (who, planted) => {
    const undo = [[modules.notify, 'sendOtpSms', modules.notify.sendOtpSms]];
    modules.notify.sendOtpSms = async () => ({ delivered: true });
    const ref = S.pending(S.SHOP, scheme, 0);
    asWorld(who === 'owner' ? OWNER : STRANGER, { record: planted ? { owner: S.SHOP, scheme, value: S.VALUES.PHONE, ref } : null });
    const answer = await lab.send(port, 'POST', MOUNT + '/documents/' + scheme + '/' + last, last === 'verify' ? { code: S.FIXED_CODE } : {});
    stop();
    undo.forEach(([owner, name, original]) => { owner[name] = original; });
    return answer;
  };
  const recorder = FOREIGN.recorder();
  const failures = await FOREIGN.runCases([{ route: KEYS.CODE, play: make('PHONE', 'code') }, { route: KEYS.VERIFY, play: make('PHONE', 'verify') }], recorder.record);
  check('POST /code and POST /verify: another shop\'s record answers as no record (404, the same bytes), the own record is reached, never a 403 and never the record', failures.length === 0, failures);
  return recorder.proved();
}

/** `identity_id` (a body or a query) may name another person. A person that is not the caller's own co-assist answers one 403 whoever they are: foreign, unknown, a shop, a colleague of the staff. */
async function foreignIdentityWorld(port) {
  console.log('\n-- the person a body or query names: foreign = unknown = refused alike, never the record --');
  const strangerActor = S.STRANGER_ACTOR;
  const unknown = '00000000-0000-4000-8000-000000000000';
  const ask = async (who, route, named) => {
    const options = { docs: S.GOT, actors: { [S.ACTOR]: S.SHOP, [strangerActor]: SHOP_B }, record: { owner: S.ACTOR, scheme: 'PHONE', value: S.VALUES.PHONE, ref: S.pending(S.ACTOR, 'PHONE', 0) } };
    asWorld(who, options);
    const url = MOUNT + (route === 'GET' ? '/documents?identity_id=' + named : route === 'PUT' ? '/documents/PHONE' : '/documents/PHONE/' + route);
    const body = route === 'GET' ? undefined : route === 'PUT' ? { value: S.VALUES.PHONE, identity_id: named } : route === 'verify' ? { code: S.FIXED_CODE, identity_id: named } : { identity_id: named };
    const answer = await lab.send(port, route === 'GET' ? 'GET' : route === 'PUT' ? 'PUT' : 'POST', url, body);
    stop();
    return answer;
  };
  for (const route of ['GET', 'PUT', 'code', 'verify']) {
    const foreign = await ask(OWNER, route, strangerActor);
    const nobody = await ask(OWNER, route, unknown);
    const aShop = await ask(OWNER, route, SHOP_B);
    const own = await ask(OWNER, route, S.ACTOR);
    check(route + ': another shop\'s co-assist, an unknown id and another shop\'s id answer alike (403, the same bytes)', foreign.status === 403 && nobody.status === 403 && aShop.status === 403 && foreign.text === nobody.text && foreign.text === aShop.text, [foreign.text, nobody.text]);
    check(route + ': the refusal names no one and carries no record (no mask, no id)', !/XXXX|•••|\*\*\*/.test(foreign.text) && !foreign.text.includes(strangerActor) && foreign.json.code === 'IDOC_SUBJECT_FORBIDDEN', foreign.text);
    check(route + ': the owner\'s own co-assist is reached (not refused)', own.status !== 403, own.status);
  }
  const colleague = await ask(STAFF, 'GET', S.ACTOR);
  check('a co-assist may not name a colleague: 403, other words, no lookup of the colleague', colleague.status === 403 && colleague.json.code === 'IDOC_SUBJECT_FORBIDDEN' && /Only the account owner/.test(colleague.json.message), colleague.text);
}

/** the scenes that set the sender to throw must still answer 200 and never echo the provider's words */
function checkSenderWords(recording) {
  console.log('\n-- the sender fails: the answer still says only "not sent" --');
  ['code-phone-sender-throws', 'code-email-sender-throws'].forEach((id) => {
    const one = recording[KEYS.CODE + '|' + id];
    check(id + ': a 200 "not_sent" that names no cause', one && one.status === 200 && one.body && one.body.delivery === 'not_sent' && !LEAK.test(JSON.stringify(one.body)), one && one.body);
  });
}

process.on('unhandledRejection', (failure) => console.log('  (unhandled rejection: ' + String(failure && failure.message).slice(0, 80) + ')'));
(async () => {
  if (lab.flagValue('--freeze')) return lab.freeze(lab.flagValue('--freeze'));
  lab.installStubs();
  delete require.cache[require.resolve(path.join(HERE, 'lib', 'schema'))]; /* the sign-in loaded the real one over the real db: the routes get one over the stand-in */
  const router = require(path.join(HERE, 'routes', 'identity-docs.js'));
  const routes = lab.routesOf(router, MOUNT);
  check('premise: the router holds the four identity routes (' + Object.keys(routes).length + ')', Object.keys(routes).length === ROUTE_COUNT, Object.keys(routes));
  const server = lab.appOf([{ mount: MOUNT, router }]).listen(0);
  const port = server.address().port;
  const recording = {};
  const capturing = lab.flagValue('--capture') || lab.flagValue('--compare');
  const words = contractModule();
  const allowed = capturing ? () => [] : words ? words.allowedStatuses() : () => [];
  const all = lab.scenariosOf(routes, WORLDS, S.extras(tools), {});
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
  await checkCarriedStatus(port, all.filter((one) => one.synthetic));
  checkFrozen5xx(recording);
  checkNoLeakAnywhere(recording);
  checkSenderWords(recording);
  await checkMasking(port);
  await checkCodeFlow(port);
  await checkDevOtpGate(port, recording);
  const proved = await foreignRecordWorld(port);
  await foreignIdentityWorld(port);
  server.close();
  const legacy = legacyRoutes();
  const frozen = Object.keys(legacy).filter(lab.mine).reduce((sum, route) => sum + legacy[route].answers.length, 0);
  check('every refusal recorded before the sweep is replayed against the code: ' + frozen + ' answers, each once, byte for byte', frozen >= 60, frozen);
  const coverage = lab.coverageOf(tested);
  const onDisk = JSON.parse(fs.readFileSync(TESTED_FILE, 'utf8'));
  const mine = Object.fromEntries(Object.keys(onDisk).filter(lab.mine).sort().map((route) => [route, onDisk[route]]));
  if (lab.argv.includes('--write')) {
    const others = Object.fromEntries(Object.keys(onDisk).filter((route) => !lab.mine(route)).map((route) => [route, onDisk[route]]));
    const merged = Object.assign(others, coverage);
    fs.writeFileSync(TESTED_FILE, JSON.stringify(Object.fromEntries(Object.keys(merged).sort().map((route) => [route, merged[route]])), null, 1) + '\n');
    FOREIGN.writeEvidence(EVIDENCE_FILE, lab.mine, proved);
  } else {
    check('docs/contracts/api-error-tests.json lists exactly the statuses these scenarios cover for routes/identity-docs.js', sameValue(mine, coverage), { onDisk: mine, covered: coverage });
    check('docs/contracts/api-hardening-evidence-areas.json says foreign_id_404 for exactly the routes that held here', sameValue(FOREIGN.evidenceOf(EVIDENCE_FILE, lab.mine), proved), { onDisk: Object.keys(FOREIGN.evidenceOf(EVIDENCE_FILE, lab.mine)).length, held: Object.keys(proved).length });
  }
  console.log('\n  ' + lab.count.passed + ' checks, ' + lab.count.failed + ' failed');
  process.exit(lab.count.failed ? 1 : 0);
})();
