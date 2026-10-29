#!/usr/bin/env node
// @type: contract
/**
 * api-problem-privacy.test.cjs — API-4 sweep, the privacy routes: every answer of routes/privacy.js (4 routes, mounted at /api/privacy).
 *
 * ⚠️ PERSONAL DATA. Every name, phone and e-mail in this file and in tests/lib/privacy-scenes.cjs is an obviously made-up placeholder (zeros, example.test, "Test customer", "Other Person").
 * No answer, log line or report may carry a real-looking name, phone number or e-mail.
 *
 * OWNS      the proof that each refusal of the four routes is a Problem body AND still carries the keys it answered before (docs/contracts/api-legacy.json, recorded from the code
 *           before the sweep), that no success answer moved (--compare against a capture of the code before: the facts, the shopper's answer, the consent row, the request record),
 *           that no answer of ANY status (a 200 and a 4xx included) carries the text of a thrown error or another shopper's data, that a 2xx is never a Problem, that a status a library
 *           carries is passed on as it was (a status under 500 relays its fixed words, a carried 5xx answers the generic 500), the frozen 5xx bodies replayed, this file's rows of
 *           docs/contracts/api-error-tests.json, and the "who is asking" proof in place of the foreign-id world (these routes have NO id in their path; the shopper and the shop come
 *           from the token alone, so a body that names another shop or shopper changes nothing and returns nothing of theirs). Also: no answer outside the statuses the contract
 *           declares (lib/privacy-contract.js), its words as units, GET /facts as a pass-through of lib/privacy.js, and that a write appends exactly one row.
 * CALLED BY scripts/guards.cjs · CI. No database, no network: the real route file and the real library over the stand-in db and sign-in (tests/lib/problem-world.cjs, scenes in tests/lib/privacy-scenes.cjs).
 * FLOW      the four routes x world (signed out, a failing db, an empty db) + the named extras → real route → body → Problem fields present · frozen legacy keys equal · no leak
 *           on any status · statuses tested → manifest; then the carried statuses, the frozen 5xx, the door, the token-only proof and the append-only proof
 * CARD      11-crm-and-marketing/privacy-consent
 *
 *   node tests/api-problem-privacy.test.cjs                    check
 *   node tests/api-problem-privacy.test.cjs --write            rewrite this file's rows of docs/contracts/api-error-tests.json
 *   node tests/api-problem-privacy.test.cjs --capture F        (run on the code BEFORE the change) record each answer to file F
 *   node tests/api-problem-privacy.test.cjs --freeze F         merge a capture F into docs/contracts/api-legacy.json (the frozen answers)
 *   node tests/api-problem-privacy.test.cjs --compare F        the answers now against a capture F: byte for byte for a success, the old keys in order for a refusal
 */
'use strict';
const path = require('path');
const fs = require('fs');
const { harness, SECRET_SQL, sqlError, sameValue } = require('./lib/problem-world.cjs');
const S = require('./lib/privacy-scenes.cjs');

const HERE = path.join(__dirname, '..');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
/* the facts read the environment: every provider off, no notice, no contact, no region, so a run says the same on every machine; a scene that wants one sets it for its own request */
['PRIVACY_NOTICE_VERSION', 'PRIVACY_CONTACT', 'RESEND_API_KEY', 'WHATSAPP_TOKEN', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'RAILWAY_REPLICA_REGION', 'RAILWAY_REGION'].forEach((name) => delete process.env[name]);
const MOUNT = '/api/privacy';
const ROUTE_COUNT = 4;
const TESTED_FILE = path.join(HERE, 'docs', 'contracts', 'api-error-tests.json');
const REGISTER_FILE = path.join(HERE, 'docs', 'error-codes.json');
const SAFE = 'Something went wrong — please try again.';
const LEAK = /SELECT secret|catalogue_items|relation "/;
const KEYS = { FACTS: 'GET /api/privacy/facts', ME: 'GET /api/privacy/me', CONSENT: 'POST /api/privacy/me/consent', REQUESTS: 'POST /api/privacy/me/requests' };
const SHOPPER_ROUTES = [KEYS.ME, KEYS.CONSENT, KEYS.REQUESTS];
/** what belongs to ANOTHER shopper or another shop: none of these may ever be in an answer of ME */
const OTHERS_VALUES = [S.OTHERS.name, S.OTHERS.phone, S.OTHERS.email, S.OTHERS.note, S.OTHER, S.SHOP_B, S.OTHER_B];
const lab = harness({
  here: HERE,
  mounts: [MOUNT],
  routeFiles: { [MOUNT]: 'routes/privacy.js' },
  legacyFile: path.join(HERE, 'docs', 'contracts', 'api-legacy.json'),
  leak: LEAK,
  inherited: (scenario, answer) => answer.status === 401 && (scenario.id === 'signed-out' || /token|sign-in/.test(scenario.id)) /* the sign-in's own body: customer-auth, not this route (R2-8) */,
  notFrozen: (one, scenario) => one.status === 401,
  before: async () => {
    require(path.join(HERE, 'lib', 'schema'))._reset(); /* the table-present answer is cached for a minute */
    require(path.join(HERE, 'lib', 'privacy')).forget(); /* so is the library's: every scene starts clean */
  }
});
const { check } = lab;
const WORLDS = [
  { id: 'signed-out', setup: { realAuth: true } },
  { id: 'db-fails', setup: { db: 'fail' } },
  { id: 'nothing-found', setup: {} }
];
const sources = () => ({ pv: require(path.join(HERE, 'lib', 'privacy')), schema: require(path.join(HERE, 'lib', 'schema')) });
/** the contract, or null when the code has none (the untouched base: the checks then FAIL by name instead of the run dying on a missing file) */
const contractModule = () => {
  try {
    return require(path.join(HERE, 'lib', 'privacy-contract.js'));
  } catch (failure) {
    return null;
  }
};
const legacyRoutes = () => JSON.parse(fs.readFileSync(lab.legacyFile, 'utf8')).routes;
/** the world of one hand case: signed in by the stand-in (a shopper of the shop) or by the real sign-in with the given token header, over the given rows */
const asWorld = (options, patch) => {
  sources().schema._reset();
  sources().pv.forget();
  return Object.assign(lab.world, { realAuth: false, db: 'ok', jsonThrows: false, sqlRows: S.world(options) }, patch || {});
};
const stop = () => Object.assign(lab.world, { sqlRows: null, realAuth: false });
const ask = async (port, method, url, body, header, options) => {
  asWorld(options, header ? { realAuth: true } : {});
  const answer = await lab.send(port, method, MOUNT + url, body, undefined, header ? { authorization: header } : undefined);
  stop();
  return answer;
};
const textOf = (answer) => answer.text || '';

/** lib/privacy-contract.js as a unit: the words of a fault, as these routes always said them */
function checkWords() {
  console.log('\n-- lib/privacy-contract.js: the faults as a unit --');
  const words = contractModule();
  check('lib/privacy-contract.js exists and words the faults', !!words);
  if (!words) return;
  const req = { id: 'r1' };
  const refused = words.faultOf(Object.assign(new Error('This sign-in is not tied to a shop.'), { status: 403, code: 'NO_SHOP' }), req);
  check('faultOf: a refusal the route meant (403) keeps its status, its code and its fixed sentence, in the old key order', refused.status === 403 && refused.code === 'NO_SHOP' && sameValue(refused.legacy, { code: 'NO_SHOP', error: 'This sign-in is not tied to a shop.', message: 'This sign-in is not tied to a shop.' }) && refused.detail === 'This sign-in is not tied to a shop.', refused);
  const nameless = words.faultOf(Object.assign(new Error('Say yes or no.'), { status: 400 }), req);
  check('faultOf: a refusal with no code of its own answers under REFUSED', nameless.status === 400 && nameless.code === 'REFUSED' && nameless.legacy.code === 'REFUSED', nameless);
  const why = words.faultOf(Object.assign(new Error('No.'), { status: 403, code: 'NO_CONSENT', why: 'Because.' }), req);
  check('faultOf: a `why` rides after the three old keys', sameValue(Object.keys(why.legacy), ['code', 'error', 'message', 'why']) && why.legacy.why === 'Because.', why);
  const migrated = words.faultOf(Object.assign(new Error('Privacy records need migration b306 — not run yet.'), { status: 503, code: 'PRIVACY_NOT_MIGRATED' }), req);
  check('faultOf: the migration not run is 503 PRIVACY_NOT_MIGRATED with the old `error` word', migrated.status === 503 && migrated.code === 'PRIVACY_NOT_MIGRATED' && sameValue(migrated.legacy, { code: 'PRIVACY_NOT_MIGRATED', error: 'Not migrated yet', message: 'Privacy records need migration b306 — not run yet.' }), migrated);
  const plain = words.faultOf(new Error(SECRET_SQL), req);
  check('faultOf: an error with no status is a 500 INTERNAL, the generic sentence, nothing of its cause', plain.status === 500 && plain.code === 'INTERNAL' && sameValue(plain.legacy, { error: 'Failed', message: SAFE }) && !LEAK.test(JSON.stringify(plain)), plain);
  const coded = words.faultOf(sqlError('42501'), req);
  check('faultOf: a database error (a SQLSTATE code, no status) answers the generic 500 and carries no code of its own', coded.status === 500 && coded.code === 'INTERNAL' && !JSON.stringify(coded).includes('42501'), coded);
  const carried = words.faultOf(Object.assign(new Error(S.RELAYED), { status: 502 }), req);
  check('faultOf: a carried 5xx is NOT relayed (it never was): the generic 500 and none of its words', carried.status === 500 && !JSON.stringify(carried).includes(S.RELAYED) && carried.legacy.message === SAFE, carried);
  [0, 99, 301, 399, 'soon', 404.5, null].forEach((status) => {
    const odd = words.faultOf(Object.assign(new Error('x'), { status }), req);
    check('faultOf: a status of ' + JSON.stringify(status) + ' is not an HTTP failure under 500: the generic 500', odd.status === 500 && odd.legacy.message === SAFE, odd);
  });
}

/** every code the words answer under is a row of docs/ERROR-CODES.md with its sentence written */
function checkCodesRegistered() {
  console.log('\n-- the codes the privacy routes answer under are in the register --');
  const words = contractModule();
  if (!words) return;
  const known = new Set(JSON.parse(fs.readFileSync(REGISTER_FILE, 'utf8')).codes.filter((item) => item.shopkeeper !== 'PENDING').map((item) => item.code));
  const missing = words.CODES.filter((code) => !known.has(code));
  check('every code the privacy words answer under (' + words.CODES.length + ' codes) is a register row with its sentence written', missing.length === 0, missing);
}

/** the contract in front of the router: every route has a row, and a row has a route; no body is narrowed, nothing is refused that was taken */
function checkContractShape(routes, router) {
  console.log('\n-- the contract and the router agree --');
  const contract = contractModule();
  const published = router.openapi && router.openapi.paths ? Object.keys(router.openapi.paths) : [];
  check('the router publishes its operations: router.openapi.paths names the four routes (' + published.length + ' paths)', !!contract && published.length === 4, published);
  if (!contract) return;
  const operations = Object.keys(contract.OPERATIONS);
  check('every route the router holds has an operation, and every operation a route (' + operations.length + ')', sameValue(operations.slice().sort(), Object.keys(routes).sort()), operations.filter((key) => !routes[key]));
  const bodies = Object.values(contract.OPERATIONS).filter((one) => one.requestBody).map((one) => one.requestBody.content['application/json'].schema);
  check('the two bodies are declared as an object or a list and require nothing: the handlers answered a list and a missing field in the library\'s own words', bodies.length === 2 && bodies.every((schema) => sameValue(schema.type, ['object', 'array']) && !(schema.required || []).length), bodies);
  check('no body schema refuses an unknown key: the handlers never read it, and refusing it is an owner\'s decision (strict_input stays open)', bodies.every((schema) => schema.additionalProperties !== false));
  check('every field the handlers read is declared as anything (a text where a yes was wanted is the library\'s 400, not the schema\'s)', bodies.every((schema) => Object.values(schema.properties).every((one) => sameValue(one, {}))) && sameValue(Object.keys(bodies[0].properties).concat(Object.keys(bodies[1].properties)).sort(), ['allowed', 'channel', 'kind', 'purpose']));
  check('the two writes are declared as 201, the two reads as 200', [KEYS.CONSENT, KEYS.REQUESTS].every((key) => contract.OPERATIONS[key].responses['201']) && [KEYS.FACTS, KEYS.ME].every((key) => contract.OPERATIONS[key].responses['200']));
  check('GET /facts asks for no sign-in (public); the three shopper routes ask for a bearer token', sameValue(contract.OPERATIONS[KEYS.FACTS].security, []) && SHOPPER_ROUTES.every((key) => sameValue(contract.OPERATIONS[key].security, [{ bearer: [] }])));
  check('every refusal an operation declares is a Problem', operations.every((key) => Object.keys(contract.OPERATIONS[key].responses).filter((status) => Number(status) >= 400).every((status) => JSON.stringify(contract.OPERATIONS[key].responses[status]).includes('Problem'))));
  /* R2-13 (#390): the success schema is derived from recorded answers; a handler that answers a passed-through expression is recorded OPEN with its reason in docs/contracts/api-output-shapes.json — honest, not untyped by accident */
  const shapes = require('../docs/contracts/api-output-shapes.json');
  const shapeRow = (key) => (shapes.routes || shapes)[key] || {};
  check('a success answer stays typed: every operation names the keys of its answer, or its recorded shape is open with a reason (R2-13)', operations.every((key) => (contract.OPERATIONS[key].responses[contract.OPERATIONS[key].responses['201'] ? '201' : '200'].content['application/json'].schema.required || []).length > 0 || (shapeRow(key).open || []).some((item) => item.reason)));
  const declared = (key) => Object.keys(contract.OPERATIONS[key].responses).map(Number);
  check('the shopper routes declare the 403 of a sign-in with no shop; the two writes also 400 and 503 (a sentence of the library, the migration not run)', SHOPPER_ROUTES.every((key) => declared(key).includes(403)) && [KEYS.CONSENT, KEYS.REQUESTS].every((key) => [400, 503].every((status) => declared(key).includes(status))), declared(KEYS.CONSENT));
  check('premise: no path of the four routes carries an id or a name (the foreign-id world, S35, has nothing to be played on)', Object.keys(routes).every((key) => !key.includes(':')), Object.keys(routes));
}

/** a library that raises an error carrying a status: the status and the old keys are kept, the words relayed only under 500 (the old catch); none carries foreign words today */
async function checkCarriedStatus(port, scenarios) {
  console.log('\n-- a status a library carries is passed on, as it always was --');
  const frozenAll = legacyRoutes();
  const modules = sources();
  for (const scenario of scenarios) {
    const undo = [];
    Object.keys(scenario.patch).forEach((which) => Object.keys(scenario.patch[which]).forEach((name) => { undo.push([modules[which], name, modules[which][name]]); modules[which][name] = scenario.patch[which][name]; }));
    asWorld({ prefs: S.HELD.prefs, requests: S.HELD.requests });
    const method = scenario.route.split(' ')[0];
    const answer = await lab.send(port, method, scenario.url, method === 'GET' ? undefined : scenario.body === undefined ? {} : scenario.body);
    undo.forEach(([owner, name, original]) => { owner[name] = original; });
    stop();
    const label = scenario.route + ' · ' + scenario.id;
    const frozen = (frozenAll[scenario.route] || { answers: [] }).answers.find((one) => one.scenario === scenario.id);
    const keys = frozen ? Object.keys(frozen.fixture) : [];
    const relays = scenario.expect !== 500;
    check(label + ': the status is passed on (' + scenario.expect + ')', answer.status === scenario.expect, [answer.status, answer.text]);
    check(label + ': ' + (relays ? 'the library\'s words are relayed' : 'the generic sentence is all that is said, none of its words'), answer.json && (relays ? answer.json.message === scenario.says : answer.json.message === SAFE && !answer.text.includes(scenario.says)), answer.json);
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
  check('at least twenty 5xx answers were frozen and replayed here (' + replayed + '); the thrown 5xx of every relay mode (502, 503, 503 not migrated) are replayed one by one in the carried-status checks', replayed >= 20, replayed);
}

/** a 2xx is never a Problem, and no answer of any status carries the text of a thrown error or another shopper's data */
function checkNoLeakAnywhere(recording) {
  console.log('\n-- the body scan: a 2xx is never a Problem, and no body carries a thrown text or another shopper\'s data --');
  const keys = Object.keys(recording);
  const successes = keys.filter((key) => recording[key].status < 300);
  check('a 2xx answer is never a Problem (' + successes.length + ' answers)', successes.every((key) => !/problem/.test(recording[key].type) && !(recording[key].body && recording[key].body.type && recording[key].body.request_id !== undefined && recording[key].body.code)), successes.filter((key) => /problem/.test(recording[key].type)));
  const text = (key) => JSON.stringify(recording[key].body || {}) + (recording[key].text || '');
  const leaking = keys.filter((key) => LEAK.test(text(key)));
  check('no answer of any status, a 200 and a 4xx included, carries the database text (' + keys.length + ' answers scanned)', leaking.length === 0, leaking);
  const foreign = keys.filter((key) => OTHERS_VALUES.some((value) => text(key).includes(value)));
  check('no answer of any status carries another shopper\'s or another shop\'s name, phone, e-mail, id or note (' + keys.length + ' answers scanned, ' + OTHERS_VALUES.length + ' values)', foreign.length === 0, foreign);
  const thrown = KEYS.FACTS + '|facts-library-throws';
  const faults = keys.filter((key) => recording[key].status === 500 && key !== thrown);
  check('GET /facts has no catch: when its library throws, the server one error handler (server.js) answers a Problem 500 with its own generic words and none of the cause', recording[thrown].status === 500 && recording[thrown].body.message === 'Something went wrong' && recording[thrown].body.code === 'INTERNAL' && !LEAK.test(recording[thrown].text || JSON.stringify(recording[thrown].body)), recording[thrown]);
  check('every plain fault of a shopper route says only the generic sentence (' + faults.length + ' answers)', faults.every((key) => recording[key].body && recording[key].body.message === SAFE), faults.filter((key) => !recording[key].body || recording[key].body.message !== SAFE));
  const signedOut = keys.filter((key) => key.endsWith('|signed-out'));
  check('a caller who is not signed in is refused with 401 on the three shopper routes, and GET /facts answers anyone', signedOut.length === ROUTE_COUNT && signedOut.filter((key) => !key.startsWith(KEYS.FACTS)).every((key) => recording[key].status === 401) && recording[KEYS.FACTS + '|signed-out'].status === 200);
  const facts = keys.filter((key) => key.startsWith(KEYS.FACTS) && key !== thrown);
  check('GET /facts answers 200 whether or not the database is up: it reads none (' + facts.length + ' answers)', facts.every((key) => recording[key].status === 200));
}

/** GET /facts is lib/privacy.js and nothing else: the same body, the cache header it always set */
async function checkFactsPassThrough(port) {
  console.log('\n-- GET /facts: a pass-through of lib/privacy.js --');
  const modules = sources();
  const seen = [];
  const answer = await ask(port, 'GET', '/facts', undefined, undefined, { seen });
  check('the body is exactly what lib/privacy.js facts() says now', answer.status === 200 && sameValue(answer.json, JSON.parse(JSON.stringify(modules.pv.facts()))), answer.json);
  check('anyone may cache it for five minutes (the header it always set)', answer.cache === 'public, max-age=300', answer.cache);
  check('it reads no database (0 trips)', seen.length === 0, seen);
  check('the notice and the contact say, in words, that the owner has not published them yet', /No privacy notice is published yet/.test(answer.json.notice) && /No privacy contact is named yet/.test(answer.json.contact_line) && answer.json.notice_version === null && answer.json.contact === null);
}

/** the door: a shopper's token only; an owner's, an expired, a broken or no token is the sign-in's 401; a shopper with no shop is a 403 before ANY lookup */
async function checkDoor(port) {
  console.log('\n-- the door: a shopper\'s token only, and a shop it belongs to, before any lookup --');
  const calls = [['GET', '/me', undefined, KEYS.ME], ['POST', '/me/consent', { channel: 'sms', purpose: 'marketing', allowed: true }, KEYS.CONSENT], ['POST', '/me/requests', { kind: 'access' }, KEYS.REQUESTS]];
  for (const [method, url, body, key] of calls) {
    const none = await ask(port, method, url, body, 'Bearer ', { seen: [] });
    const asOwner = [];
    const owner = await ask(port, method, url, body, 'Bearer ' + require('jsonwebtoken').sign({ identity_id: S.SHOP, identity_type: 'entity' }, process.env.JWT_SECRET, { algorithm: 'HS256' }), { seen: asOwner });
    const tied = [];
    const noShop = await ask(port, method, url, body, S.token(null), { seen: tied });
    check(key + ': no token and an owner\'s token are both the sign-in\'s 401, and nothing is looked up', none.status === 401 && owner.status === 401 && asOwner.length === 0, [none.status, owner.status, asOwner.length]);
    check(key + ': a shopper\'s token with no shop is 403 NO_SHOP, a Problem, and nothing is looked up', noShop.status === 403 && noShop.json.code === 'NO_SHOP' && /problem\+json/.test(noShop.type) && noShop.json.message === 'This sign-in is not tied to a shop.' && noShop.json.error === noShop.json.message && tied.length === 0, [noShop.status, noShop.text, tied.length]);
  }
}

/** these routes take no id: the shop and the shopper are the token's. A body that names another shop or shopper changes nothing and brings back nothing of theirs. */
async function checkTokenOnly(port) {
  console.log('\n-- the shopper and the shop come from the token alone (no path id: S35 has nothing to be played on) --');
  const hostile = { shop: S.SHOP_B, shop_entity_id: S.SHOP_B, owner_entity_id: S.SHOP_B, party_id: S.OTHER, identity_id: S.OTHER, noted_by: S.OTHER, created_by: S.OTHER, who: S.OTHERS.name, country: 'AU', received_at: '2000-01-01T00:00:00Z', basis: 'legitimate_use', source: 'staff' };
  const given = [['POST', '/me/consent', Object.assign({ channel: 'sms', purpose: 'marketing', allowed: true }, hostile)], ['POST', '/me/requests', Object.assign({ kind: 'access' }, hostile)], ['GET', '/me?identity_id=' + S.OTHER + '&party_id=' + S.OTHER + '&shop=' + S.SHOP_B, undefined]];
  for (const [method, url, body] of given) {
    const seen = [];
    const answer = await ask(port, method, url, body, undefined, Object.assign({ seen }, S.OTHERS_ROWS));
    const params = [].concat(...seen.map((one) => one.params || [])).map((value) => (Array.isArray(value) ? value.join('|') : String(value)));
    const label = method + ' ' + url.split('?')[0];
    check(label + ': it is answered (2xx) although the body names others', answer.status >= 200 && answer.status < 300, [answer.status, answer.text]);
    check(label + ': the database is handed no id, name or value of another shop or shopper (' + seen.length + ' statements)', seen.length > 0 && !params.some((value) => OTHERS_VALUES.some((other) => value.includes(other)) || value === '2000-01-01T00:00:00.000Z' || value === 'AU'), params);
    check(label + ': the answer carries nothing of another shop or shopper', !OTHERS_VALUES.some((value) => textOf(answer).includes(value)) && !/"country":"AU"/.test(textOf(answer)), textOf(answer).slice(0, 200));
  }
  const filed = [];
  const answer = await ask(port, 'POST', '/me/requests', Object.assign({ kind: 'access' }, hostile), undefined, { seen: filed });
  const insert = filed.find((one) => /INSERT INTO privacy_request/.test(one.sql));
  check('the request is written for the token\'s shopper at the token\'s shop, in the shop\'s country, as them: owner, party, country, by', !!insert && insert.params[0] === S.SHOP && insert.params[1] === S.ME && insert.params[2] === 'Test customer' && insert.params[4] === 'IN' && insert.params[7] === S.ME && insert.params[5] !== '2000-01-01T00:00:00.000Z', insert && insert.params);
  check('the 201 record carries that shopper and no other', answer.status === 201 && answer.json.request.party_id === S.ME && answer.json.request.who === 'Test customer', answer.json);
}

/** two shoppers of one shop, and one shopper in two shops: each is told only their own rows (row security stand-in: a read is filtered by its owner and party) */
async function checkEachSeesOwn(port) {
  console.log('\n-- each shopper is told only their own rows --');
  const mine = [S.prefRow(S.SHOP, S.ME, 'sms', 'marketing', true, 'consent', 1), S.prefRow(S.SHOP, S.OTHER, 'email', 'marketing', true, 'consent', 2), S.prefRow(S.SHOP_B, S.ME, 'phone', 'marketing', true, 'consent', 3)];
  const rows = { prefs: mine, requests: [S.requestRow(S.SHOP, S.ME, 'access', 'Test customer', 'note-a'), S.requestRow(S.SHOP, S.OTHER, 'erase', S.OTHERS.name, 'note-b'), S.requestRow(S.SHOP_B, S.ME, 'erase', 'Test customer', 'note-c')] };
  const asMe = await ask(port, 'GET', '/me', undefined, S.token(S.SHOP), rows);
  const asOther = await ask(port, 'GET', '/me', undefined, S.token(S.SHOP, { identity_id: S.OTHER }), rows);
  const inOtherShop = await ask(port, 'GET', '/me', undefined, S.token(S.SHOP_B), rows);
  const channels = (answer) => answer.json.consent.history.map((one) => one.channel).join();
  const notes = (answer) => answer.json.requests.requests.map((one) => one.answer).join();
  check('the shopper is told their own consent and request at this shop, and nothing of the other shopper or the other shop', asMe.status === 200 && channels(asMe) === 'sms' && notes(asMe) === 'note-a' && !textOf(asMe).includes(S.OTHERS.name), [channels(asMe), notes(asMe)]);
  check('the other shopper of the same shop is told only theirs', asOther.status === 200 && channels(asOther) === 'email' && notes(asOther) === 'note-b' && !textOf(asOther).includes('Test customer'), [channels(asOther), notes(asOther)]);
  check('the same shopper signed in to another shop is told only what that shop holds', inOtherShop.status === 200 && channels(inOtherShop) === 'phone' && notes(inOtherShop) === 'note-c', [channels(inOtherShop), notes(inOtherShop)]);
}

/** a write appends exactly one row and changes none; a read writes nothing */
async function checkAppendOnly(port) {
  console.log('\n-- a write appends one row; nothing is updated or deleted; a read writes nothing --');
  const writes = (seen) => seen.filter((one) => /^\s*(INSERT|UPDATE|DELETE)/i.test(one.sql));
  const read = [];
  await ask(port, 'GET', '/me', undefined, undefined, { seen: read, prefs: S.HELD.prefs, requests: S.HELD.requests });
  check('GET /me writes nothing', read.length > 0 && writes(read).length === 0, writes(read));
  const consent = [];
  const gave = await ask(port, 'POST', '/me/consent', { channel: 'sms', purpose: 'marketing', allowed: false }, undefined, { seen: consent, prefs: S.HELD.prefs });
  const written = writes(consent);
  check('a "no" after a "yes" is ONE new row (an INSERT, noted by the shopper, with the withdrawal stamped) and nothing is updated', gave.status === 201 && written.length === 1 && /^INSERT INTO party_contact_pref/.test(written[0].sql) && written[0].params[7] === S.ME && /\$8, now\(\)/.test(written[0].sql) && gave.json.pref.withdrawn_at !== null, written.map((one) => one.sql.slice(0, 60)));
  const asked = [];
  const filed = await ask(port, 'POST', '/me/requests', { kind: 'erase' }, undefined, { seen: asked });
  const entered = writes(asked);
  check('a request is ONE new register entry (an INSERT); erasing happens elsewhere, not from this page', filed.status === 201 && entered.length === 1 && /^INSERT INTO privacy_request/.test(entered[0].sql) && filed.json.request.kind === 'erase' && filed.json.request.answered_at === null, entered.map((one) => one.sql.slice(0, 60)));
  const refused = [];
  await ask(port, 'POST', '/me/consent', { channel: 'pigeon', purpose: 'marketing', allowed: true }, undefined, { seen: refused });
  check('a refused consent writes nothing', writes(refused).length === 0, writes(refused));
}

process.on('unhandledRejection', (failure) => console.log('  (unhandled rejection: ' + String(failure && failure.message).slice(0, 80) + ')'));
(async () => {
  if (lab.flagValue('--freeze')) return lab.freeze(lab.flagValue('--freeze'));
  lab.installStubs();
  delete require.cache[require.resolve(path.join(HERE, 'lib', 'schema'))]; /* the sign-in loaded the real one over the real db: the routes get one over the stand-in */
  const router = require(path.join(HERE, 'routes', 'privacy.js'));
  const routes = lab.routesOf(router, MOUNT);
  check('premise: the router holds the four privacy routes (' + Object.keys(routes).length + ')', Object.keys(routes).length === ROUTE_COUNT && sameValue(Object.keys(routes).sort(), Object.values(KEYS).sort()), Object.keys(routes));
  const app = lab.appOf([{ mount: MOUNT, router }]);
  app.use((err, req, res, next) => require(path.join(HERE, 'lib', 'problem')).fromError(req, res, err, { error: 'Server error', message: 'Something went wrong' })); /* the call server.js ends with (its error handler, :527-542): GET /facts has no catch of its own */
  const server = app.listen(0);
  const port = server.address().port;
  const recording = {};
  const capturing = lab.flagValue('--capture') || lab.flagValue('--compare');
  const words = contractModule();
  const allowed = capturing ? () => [] : words ? words.allowedStatuses() : () => [];
  const all = lab.scenariosOf(routes, WORLDS, S.extras(), {});
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
  await checkFactsPassThrough(port);
  await checkDoor(port);
  await checkTokenOnly(port);
  await checkEachSeesOwn(port);
  await checkAppendOnly(port);
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
  } else {
    check('docs/contracts/api-error-tests.json lists exactly the statuses these scenarios cover for routes/privacy.js', sameValue(mine, coverage), { onDisk: mine, covered: coverage });
  }
  console.log('\n  ' + lab.count.passed + ' checks, ' + lab.count.failed + ' failed');
  process.exit(lab.count.failed ? 1 : 0);
})();
