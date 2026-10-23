#!/usr/bin/env node
// @type: contract
/**
 * api-problem-attachments.test.cjs — API-4 sweep, the attachments: every answer of routes/attachments.js (2 routes, /api/attachments: put a file on a chit and give every participant their own copy; read your own copy).
 *
 * OWNS      the proof that each refusal of the attachments routes is a Problem body AND still carries the keys it answered before (docs/contracts/api-legacy.json, recorded from the code
 *           before the sweep), that no success answer moved (--compare against a capture of the code before: the answers, the bytes and headers of a download, AND every SQL statement with
 *           its parameters), this file's rows of docs/contracts/api-error-tests.json (the statuses each route is tested for), and the "signed in as another shop" world for GET /:id
 *           (API-STANDARD S35, tests/lib/foreign-id-world.cjs), recorded in docs/contracts/api-hardening-evidence-areas.json. Also: no answer of ANY status (a 200 included) carries the text of
 *           a thrown error, a 2xx is never a Problem, the frozen 500 bodies are replayed word for word, no answer outside the statuses the contract declares (lib/attachments-contract.js), its
 *           words as units, the fan-out to the participants and the internal-message rule, the headers of a download (the S2 stored-XSS defence), a foreign chit answering as an unknown one,
 *           and the findings the sweep lists for cb-security and cb-rail (a message the caller cannot see, a dispute message, a name beyond Latin-1, a storage check that never recovers).
 * CALLED BY scripts/guards.cjs · CI. No database, no network: the real route file and the real storage library over a stand-in db and sign-in (tests/lib/problem-world.cjs, scenes in tests/lib/attachments-scenes.cjs).
 * FLOW      route list (read from the router) x world (signed out, staff, a bad id, a failing db, an empty db) + the named extras (tests/lib/attachments-scenes.cjs) → real route →
 *           body → Problem fields present · frozen legacy keys equal · no leak · statuses tested → manifest; then the checks of the fan-out, the headers and the foreign-id world
 * CARD      01-rail-core-the-chit/attachments
 *
 *   node tests/api-problem-attachments.test.cjs                    check
 *   node tests/api-problem-attachments.test.cjs --write            rewrite this file's rows of docs/contracts/api-error-tests.json and api-hardening-evidence-areas.json
 *   node tests/api-problem-attachments.test.cjs --capture F        (run on the code BEFORE the change) record each answer to file F, and every SQL statement to F.sql
 *   node tests/api-problem-attachments.test.cjs --freeze F         merge a capture F into docs/contracts/api-legacy.json (the frozen answers)
 *   node tests/api-problem-attachments.test.cjs --compare F        the answers and statements now against a capture F: byte for byte for a success, the old keys in order for a refusal
 */
'use strict';
const path = require('path');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const { harness, OWNER, STAFF, SECRET_SQL, SHOP, sameValue, raising, answering, firstOf, sqlError } = require('./lib/problem-world.cjs');
const scenes = require('./lib/attachments-scenes.cjs');
const FOREIGN = require('./lib/foreign-id-world.cjs');

const HERE = path.join(__dirname, '..');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
const MOUNT = scenes.AT;
const ROUTE_FILE = 'routes/attachments.js';
const ROUTE_COUNT = 2;
const POST = 'POST ' + MOUNT;
const GET = 'GET ' + MOUNT + '/:id';
const SQL_FILE_SUFFIX = '.sql';
const SAFE_SENTENCE = 'Something went wrong — please try again.';
const sqlLog = {};
const sha = (value) => crypto.createHash('sha1').update(value).digest('hex').slice(0, 10);
/** a statement parameter as the log keeps it: a file's bytes as their length and hash, NaN as a word (JSON would turn it into null) */
const plain = (value) => (Buffer.isBuffer(value) ? '<bytes ' + value.length + ' ' + sha(value) + '>' : typeof value === 'number' && Number.isNaN(value) ? '<NaN>' : value);
const lab = harness({
  here: HERE,
  mounts: [MOUNT],
  routeFiles: { [MOUNT]: ROUTE_FILE },
  legacyFile: path.join(HERE, 'docs', 'contracts', 'api-legacy.json'),
  inherited: (scenario, answer) => answer.status === 401 && scenario.id === 'signed-out',
  notFrozen: (one, scenario) => one.status === 401 && scenario === 'signed-out',
  before: async (scenario) => {
    const key = scenario.route + '|' + scenario.id;
    sqlLog[key] = [];
    const inner = lab.world.sqlRows;
    lab.world.sqlRows = (sql, params) => {
      sqlLog[key].push({ q: sha(String(sql).replace(/\s+/g, ' ')), sql: String(sql), p: (params || []).map(plain) });
      return inner ? inner(sql, params) : null;
    };
  }
});
const { check, world } = lab;
const TESTED_FILE = path.join(HERE, 'docs', 'contracts', 'api-error-tests.json');
const REGISTER_FILE = path.join(HERE, 'docs', 'error-codes.json');
const EVIDENCE_FILE = path.join(HERE, 'docs', 'contracts', 'api-hardening-evidence-areas.json');
const BASELINE_FILE = path.join(HERE, 'migrations', '000_baseline_2026-10-21.sql');
const STRANGER = { identity_id: scenes.STRANGER_ID, identity_type: 'entity', display_name: 'Shop B' };
const WORLDS = [
  { id: 'signed-out', setup: { realAuth: true } },
  { id: 'staff-asks', setup: { who: STAFF } },
  { id: 'bad-id', setup: { sqlRows: scenes.attRows({ caller: SHOP }, sqlError) }, badId: true },
  { id: 'db-fails', setup: { db: 'fail' } },
  { id: 'nothing-found', setup: {} }
];
const sources = () => ({ storage: require(path.join(HERE, 'lib', 'storage')) });
const extrasList = () => scenes.extras({ OWNER, STAFF, SECRET_SQL, raising, answering, firstOf, sqlError });
/** lib/attachments-contract.js, or null on the code before the sweep (so the negative control FAILS cleanly instead of throwing) */
const contractModule = () => {
  try {
    return require(path.join(HERE, 'lib', 'attachments-contract.js'));
  } catch (failure) {
    return null;
  }
};
const THROWN = /SELECT|vault|relation "|secret/;
const keyOf = (route, id) => route + '|' + id;
const upKey = (id) => keyOf(POST, id);
const getKey = (id) => keyOf(GET, id);
const insertsOf = (key) => (sqlLog[key] || []).filter((one) => /INSERT INTO cb_attachment/.test(one.sql));
const entitiesOf = (key) => insertsOf(key).map((one) => one.p[0]);
const asText = (answer) => JSON.stringify({ status: answer.status, type: answer.type, text: answer.text });

/** lib/attachments-contract.js as a unit: the words of a refusal and of a fault, as these routes always said them */
function checkWords(contract) {
  console.log('\n-- lib/attachments-contract.js: the refusals as a unit --');
  if (!contract) return check('lib/attachments-contract.js exists', false);
  const { words, faultOf } = contract;
  const req = { id: 'r1' };
  check('missingFields: the old body is { error: "Bad request", message: "chit_id, name and data_base64 are required" }', sameValue(words.missingFields().legacy, { error: 'Bad request', message: 'chit_id, name and data_base64 are required' }) && words.missingFields().code === 'ATTACHMENT_FIELDS_MISSING');
  check('notParticipant: the old body is { error: "Forbidden", message: "Not a participant on this chit" }', sameValue(words.notParticipant().legacy, { error: 'Forbidden', message: 'Not a participant on this chit' }) && words.notParticipant().code === 'ATTACHMENT_NOT_A_PARTICIPANT');
  check('emptyFile: the old body is { error: "Empty file" } and nothing else', sameValue(words.emptyFile().legacy, { error: 'Empty file' }) && words.emptyFile().code === 'ATTACHMENT_EMPTY');
  check('tooLarge: the limit in the sentence is the limit the route enforces (6 MB, read from the one source)', sameValue(words.tooLarge().legacy, { error: 'Too large', message: 'Max 6 MB per file' }) && contract.MAX_BYTES === scenes.SIX_MB && words.tooLarge().code === 'BODY_TOO_LARGE');
  check('notHeld: the old body is { error: "Not found" } and nothing else', sameValue(words.notHeld().legacy, { error: 'Not found' }) && words.notHeld().code === 'NOT_FOUND');
  const lost = faultOf(new Error(SECRET_SQL), req, 'Upload failed');
  check('faultOf: the screen\'s own label and the one safe sentence, never the cause', lost.status === 500 && lost.legacy.error === 'Upload failed' && lost.legacy.message === SAFE_SENTENCE && !THROWN.test(JSON.stringify(lost)), lost);
}

/** every code the words answer under is a row of docs/ERROR-CODES.md with its sentence written */
function checkCodesRegistered(contract) {
  console.log('\n-- the codes the attachments routes answer under are in the register --');
  if (!contract) return check('lib/attachments-contract.js exists', false);
  const known = new Set(JSON.parse(fs.readFileSync(REGISTER_FILE, 'utf8')).codes.filter((row) => row.shopkeeper !== 'PENDING').map((row) => row.code));
  const missing = contract.CODES.filter((code) => !known.has(code));
  check('every code the attachments words (' + contract.CODES.length + ') answer under is a register row with its sentence written', missing.length === 0, missing);
}

/** the contract in front of the router: every route has an operation and an operation a route; nothing here can be refused for its shape (the old code never did) */
function checkContractShape(contract, routes, router) {
  console.log('\n-- the contract and the router agree --');
  check('premise: the router holds ' + ROUTE_COUNT + ' routes (an empty list would pass every scan)', Object.keys(routes).length === ROUTE_COUNT, Object.keys(routes));
  if (!contract) return check('lib/attachments-contract.js exists', false);
  const operations = Object.keys(contract.OPERATIONS);
  check('every route the router holds has an operation, and every operation a route (' + operations.length + ')', sameValue(operations.slice().sort(), Object.keys(routes).sort()), operations.filter((key) => !routes[key]));
  const body = contract.OPERATIONS[POST].requestBody.content['application/json'].schema;
  check('the upload body may be an object or a list (a list was read as no fields and answered the route\'s own 400), requires nothing and is not closed: an unknown key is dropped, as before', sameValue(body.type, ['object', 'array']) && !body.required && body.additionalProperties === undefined, body);
  check('the upload body names exactly the six fields the handler reads', sameValue(Object.keys(body.properties).sort(), ['chit_id', 'data_base64', 'line_index', 'message_id', 'mime', 'name']), Object.keys(body.properties));
  check('the upload is declared at the statuses it answers: 400 (its own refusal is the schema\'s too), 401, 403, 413, 500', sameValue(Object.keys(contract.OPERATIONS[POST].responses).map(Number).sort(), [200, 400, 401, 403, 413, 500]), Object.keys(contract.OPERATIONS[POST].responses));
  check('the download is declared at 200 (bytes), 401, 404, 422 (the schema of an id route, never answered) and 500', sameValue(Object.keys(contract.OPERATIONS[GET].responses).map(Number).sort(), [200, 401, 404, 422, 500]), Object.keys(contract.OPERATIONS[GET].responses));
  const download = contract.OPERATIONS[GET].responses[200].content;
  check('the success of the download is bytes, declared with the kit\'s media(), not a JSON shape', sameValue(Object.keys(download), ['application/octet-stream']) && download['application/octet-stream'].schema.contentMediaType === 'application/octet-stream', download);
  check('every refusal an operation declares is a Problem', operations.every((key) => Object.keys(contract.OPERATIONS[key].responses).filter((status) => Number(status) >= 400).every((status) => JSON.stringify(contract.OPERATIONS[key].responses[status]).includes('Problem'))));
  check('a malformed path id is still the route\'s own answer, never a refusal of the schema: the id is plain text', contract.OPERATIONS[GET].parameters.every((one) => one.schema.type === 'string' && !one.schema.pattern && !one.schema.format));
  check('the router carries its OpenAPI paths for both operations', !!router.openapi && !!router.openapi.paths && sameValue(Object.keys(router.openapi.paths).sort(), ['/api/attachments', '/api/attachments/{id}']), router.openapi && Object.keys(router.openapi.paths || {}));
}

/** the frozen 500 bodies of the untouched code, replayed: the same status and every old key, byte for byte and in order */
function checkFrozen5xx(recording) {
  console.log('\n-- the frozen 5xx answers are replayed --');
  const legacy = JSON.parse(fs.readFileSync(lab.legacyFile, 'utf8')).routes;
  let replayed = 0;
  Object.keys(legacy).filter(lab.mine).forEach((route) => legacy[route].answers.filter((frozen) => frozen.status >= 500).forEach((frozen) => {
    const now = recording[route + '|' + frozen.scenario];
    const order = Object.keys(frozen.fixture);
    replayed++;
    check(route + ' · ' + frozen.scenario + ': the frozen ' + frozen.status + ' body is kept, key by key and in order', !!now && now.status === frozen.status && sameValue(order.map((name) => now.body[name]), order.map((name) => frozen.fixture[name])) && sameValue(Object.keys(now.body).slice(0, order.length), order), now && now.body);
  }));
  check('at least ten 5xx answers were frozen and replayed (' + replayed + ')', replayed >= 10, replayed);
  check('no route here relays a provider or a gateway (no 502, no 503): the only 5xx is a 500', Object.keys(recording).every((key) => recording[key].status < 500 || recording[key].status === 500));
}

/** no answer of any status carries a thrown text; a 2xx is never a Problem; a 5xx says the one safe sentence */
function checkLeaks(recording) {
  console.log('\n-- no thrown text in any answer; a 2xx is never a Problem --');
  const asked = Object.keys(recording).filter((key) => /leaks-nothing$/.test(key));
  check('the scenes that make the database (or the storage library) THROW a string with SQL in it ran (' + asked.length + ' of 5)', asked.length === 5, asked);
  check('no answer of ANY status (2xx, 4xx, 5xx) carries the thrown text', Object.keys(recording).every((key) => !THROWN.test(JSON.stringify(recording[key].body || recording[key].text || ''))), Object.keys(recording).filter((key) => THROWN.test(JSON.stringify(recording[key].body || ''))));
  check('a 2xx is never a Problem: every success answer keeps its own shape', Object.keys(recording).filter((key) => recording[key].status < 400).every((key) => !/problem\+json/.test(recording[key].type)));
  const faults = Object.keys(recording).filter((key) => recording[key].status === 500);
  check('every 500 (' + faults.length + ') says the one safe sentence under the screen\'s own label, and nothing of the cause', faults.every((key) => recording[key].body && recording[key].body.message === SAFE_SENTENCE && /^(Upload|Fetch) failed$/.test(recording[key].body.error)), faults.filter((key) => !(recording[key].body && recording[key].body.message === SAFE_SENTENCE)));
}

/** both doors need a login; the staff of a shop act for the shop */
function checkDoors(recording) {
  console.log('\n-- the doors --');
  check('a caller who is not signed in is refused with 401 on both routes', [POST, GET].every((route) => recording[keyOf(route, 'signed-out')] && recording[keyOf(route, 'signed-out')].status === 401));
  const staff = insertsOf(upKey('up-staff-uploads-for-the-shop'));
  check('a staff login uploads for its SHOP: every copy is filed under the shop\'s roster, and uploaded_by is the staff login itself', staff.length === 3 && staff[0].p[0] === SHOP && staff.every((one) => one.p[8] === STAFF.identity_id), staff.map((one) => one.p[0] + '/' + one.p[8]));
  check('the answer to a staff upload carries the SHOP\'s own copy id (forEntity is the shop)', recording[upKey('up-staff-uploads-for-the-shop')].body.id === scenes.COPY_IDS[SHOP]);
}

/** a copy for every participant, one for the author of an internal message, nothing widened by the body */
function checkFanOut(recording) {
  console.log('\n-- a copy for every participant; an internal message stays single; the body cannot widen the audience --');
  const roster = [scenes.SHOP_ID, scenes.PEER_ID, scenes.THIRD_ID];
  const wide = insertsOf(upKey('up-chit-wide'));
  check('the upload fans out: one INSERT per roster entity, in roster order, each owned by that entity', sameValue(entitiesOf(upKey('up-chit-wide')), roster), entitiesOf(upKey('up-chit-wide')));
  check('every copy holds the same chit, name, mime, size, bytes and uploader, and no message or line', wide.every((one) => one.p[1] === scenes.CHIT && one.p[2] === null && one.p[3] === null && one.p[4] === 'receipt.png' && one.p[5] === 'image/png' && one.p[6] === scenes.BYTES.length && one.p[7] === wide[0].p[7] && one.p[8] === OWNER.identity_id), wide.map((one) => one.p));
  check('the answer is the uploader\'s own copy id with the name, mime and size', sameValue(recording[upKey('up-chit-wide')].body, { id: scenes.COPY_IDS[SHOP], name: 'receipt.png', mime: 'image/png', size: scenes.BYTES.length }), recording[upKey('up-chit-wide')].body);
  check('an empty or missing roster is the caller alone', sameValue(entitiesOf(upKey('up-roster-empty-is-the-caller-alone')), [SHOP]) && sameValue(entitiesOf(upKey('up-roster-null-is-the-caller-alone')), [SHOP]));
  check('a roster entry with no entity is skipped and a repeated one is filed once', sameValue(entitiesOf(upKey('up-roster-skips-entries-without-an-entity')), [scenes.PEER_ID, SHOP]), entitiesOf(upKey('up-roster-skips-entries-without-an-entity')));
  check('keys that try to widen the audience (participants, audience, entity_id, uploaded_by, size, id) change nothing: the same three copies, the caller as uploader, the real size', sameValue(entitiesOf(upKey('up-keys-that-widen-are-ignored')), roster) && insertsOf(upKey('up-keys-that-widen-are-ignored')).every((one) => one.p[8] === OWNER.identity_id && one.p[6] === scenes.BYTES.length) && recording[upKey('up-keys-that-widen-are-ignored')].body.id === scenes.COPY_IDS[SHOP]);
  check('an attachment to the caller\'s own INTERNAL message is ONE copy, the author\'s, and carries the message', sameValue(entitiesOf(upKey('up-message-internal-own')), [SHOP]) && insertsOf(upKey('up-message-internal-own'))[0].p[2] === scenes.MSG_INTERNAL);
  check('an attachment to an open message of the chit is a copy for every participant, carrying the message', sameValue(entitiesOf(upKey('up-message-open')), roster) && insertsOf(upKey('up-message-open')).every((one) => one.p[2] === scenes.MSG_OPEN));
  check('a failed insert midway stops the upload with the safe 500: the first copy was filed, the second was refused (the library files one participant at a time; its own design)', insertsOf(upKey('up-second-copy-fails')).length === 2 && recording[upKey('up-second-copy-fails')].status === 500 && insertsOf(upKey('up-first-copy-fails')).length === 1);
}

/** what is stored and what is echoed: the cut at 200 and 120, the default type, the line number */
function checkStoredAndEchoed(recording) {
  console.log('\n-- what is stored and what is echoed --');
  const stored = (id) => insertsOf(upKey(id))[0].p;
  const said = (id) => recording[upKey(id)].body;
  check('a name over 200 characters is stored cut at 200 and ECHOED WHOLE (the 200 repeats what was sent, not what was stored)', stored('up-name-is-cut-at-200-and-echoed-whole')[4].length === 200 && said('up-name-is-cut-at-200-and-echoed-whole').name.length === 300);
  check('a mime over 120 characters is stored cut at 120 and echoed whole', stored('up-mime-is-cut-at-120-and-echoed-whole')[5].length === 120 && said('up-mime-is-cut-at-120-and-echoed-whole').mime.length === 200);
  check('no mime, or an empty one, is stored and echoed as application/octet-stream', stored('up-no-mime-is-octet-stream')[5] === 'application/octet-stream' && said('up-no-mime-is-octet-stream').mime === 'application/octet-stream' && said('up-empty-mime-is-octet-stream').mime === 'application/octet-stream');
  check('a name that is an object is stored as text and echoed as the object that was sent (caller text to its own caller)', stored('up-name-an-object-is-echoed-as-sent')[4] === '[object Object]' && sameValue(said('up-name-an-object-is-echoed-as-sent').name, { any: 'thing' }));
  check('a mime that is a number is stored as its text and echoed as the number', stored('up-mime-a-number-is-echoed-as-sent')[5] === '7' && said('up-mime-a-number-is-echoed-as-sent').mime === 7);
  const lines = [['up-line-index-text-2', 2], ['up-line-index-zero', 0], ['up-line-index-null', null], ['up-line-index-fraction', 1], ['up-line-index-text-prefix', 3], ['up-line-index-negative', -4]];
  check('line_index is parseInt of whatever came: "2" is 2, 0 is 0, null is null, 1.9 is 1, "3abc" is 3, -4 is -4', lines.every(([id, want]) => stored(id)[3] === want), lines.map(([id]) => stored(id)[3]));
  const nan = ['up-line-index-abc-is-nan', 'up-line-index-empty-text-is-nan', 'up-line-index-true-is-nan'];
  check('"abc", "" and true reach the INSERT as NaN: Postgres refuses it, one INSERT is tried, nothing is filed and the answer is the safe 500', nan.every((id) => insertsOf(upKey(id)).length === 1 && insertsOf(upKey(id))[0].p[3] === '<NaN>' && recording[upKey(id)].status === 500));
  check('a line_index too big for an integer is refused by Postgres (500), nothing is filed', insertsOf(upKey('up-line-index-too-big-for-an-integer')).length === 1 && recording[upKey('up-line-index-too-big-for-an-integer')].status === 500);
  check('bytes sent as a number are read as text (a 200, size 4)', recording[upKey('up-bytes-a-number')].status === 200 && recording[upKey('up-bytes-a-number')].body.size === 4);
  check('a data: URL prefix is cut before the bytes are counted', recording[upKey('up-data-url-prefix-is-cut')].body.size === scenes.BYTES.length);
  check('exactly 6 MB is accepted and 6 MB and three bytes are refused with 413 before any copy is filed', recording[upKey('up-exactly-6mb')].status === 200 && recording[upKey('up-exactly-6mb')].body.size === scenes.SIX_MB && recording[upKey('up-over-6mb')].status === 413 && insertsOf(upKey('up-over-6mb')).length === 0);
  check('a file with no bytes after the prefix is refused 400 before any copy is filed', recording[upKey('up-empty-file')].status === 400 && insertsOf(upKey('up-empty-file')).length === 0);
}

/** a chit that is foreign and a chit nobody holds are one refusal, byte for byte (a scoped lookup, then the same 403); and what an id in the body can and cannot do */
function checkIdsInTheBody(recording) {
  console.log('\n-- ids in the body: chit_id, message_id, line_index --');
  const unknown = recording[upKey('up-chit-unknown')];
  const foreign = recording[upKey('up-chit-of-another-shop')];
  const only = recording[upKey('up-chit-held-by-another-shop-only')];
  check('chit_id: another shop\'s chit, a chit only a stranger holds and a chit nobody holds answer exactly the same 403 (status, type and body, request id masked)', unknown.status === 403 && asText(unknown) === asText(foreign) && asText(unknown) === asText(only), [unknown.text, foreign.text]);
  const lookups = ['up-chit-unknown', 'up-chit-of-another-shop'].map((id) => (sqlLog[upKey(id)] || []).filter((one) => /SELECT all_recipients FROM chit_header/.test(one.sql)));
  check('chit_id: it is looked up under the caller\'s shop first (WHERE chit_id = $1 AND entity_id = $2), and nothing is written for a chit the caller does not hold', lookups.every((one) => one.length === 1 && /WHERE chit_id = \$1 AND entity_id = \$2/.test(one[0].sql) && one[0].p[1] === SHOP) && insertsOf(upKey('up-chit-unknown')).length === 0 && insertsOf(upKey('up-chit-of-another-shop')).length === 0);
  check('chit_id: a made-up text (not a uuid) is Postgres 22P02: the safe 500 and nothing written', recording[upKey('up-chit-text-not-a-uuid')].status === 500 && insertsOf(upKey('up-chit-text-not-a-uuid')).length === 0);
  const messageLookup = (sqlLog[upKey('up-message-open')] || []).filter((one) => /FROM chit_messages/.test(one.sql));
  check('message_id: it is looked up WITHOUT an entity filter (WHERE message_id = $1 AND chit_id = $2): RLS alone says whose copy is visible', messageLookup.length === 1 && /WHERE message_id = \$1 AND chit_id = \$2/.test(messageLookup[0].sql) && !/entity_id/.test(messageLookup[0].sql.replace(/visibility_entity_id/g, '')), messageLookup.map((one) => one.sql));
  const unknownMessage = recording[upKey('up-message-unknown')];
  const hidden = recording[upKey('up-message-of-another-shop-not-visible')];
  check('message_id: a message the caller cannot see answers exactly as one nobody holds (200, same body): no existence oracle', unknownMessage.status === 200 && hidden.status === 200 && sameValue(Object.keys(unknownMessage.body), Object.keys(hidden.body)) && unknownMessage.body.id === hidden.body.id, [unknownMessage.body, hidden.body]);
  check('message_id: a text that is not a uuid is Postgres 22P02: the safe 500 and nothing written', recording[upKey('up-message-text-not-a-uuid')].status === 500 && insertsOf(upKey('up-message-text-not-a-uuid')).length === 0);
  const baseline = fs.readFileSync(BASELINE_FILE, 'utf8');
  check('the model of the table is the baseline: cb_attachment has NO foreign key (chit_id, message_id and uploaded_by are plain uuid) and an entity policy; chit_messages has an entity policy', !/ALTER TABLE ONLY public\.cb_attachment\s+ADD CONSTRAINT \w+ FOREIGN KEY/.test(baseline) && /CREATE POLICY rls_entity ON public\.cb_attachment USING/.test(baseline) && /CREATE POLICY rls_entity ON public\.chit_messages USING/.test(baseline));
}

/** FINDINGS for cb-security and cb-rail: pinned so a fix changes a check on purpose */
async function checkFindings(recording) {
  console.log('\n-- findings listed for cb-security / cb-rail (pinned as they are today; a fix changes these on purpose) --');
  const roster = [scenes.SHOP_ID, scenes.PEER_ID, scenes.THIRD_ID];
  const hidden = insertsOf(upKey('up-message-of-another-shop-not-visible'));
  console.log('  FINDING F1 cb-rail/cb-security: a file attached to a DISPUTE message (a dispute message has visibility NULL; its copies are scoped by dispute party, migrations/000_baseline_2026-10-21.sql chit_message_deliver) is filed for the WHOLE roster: the route reads only visibility_entity_id (routes/attachments.js message lookup), so a participant outside the dispute holds a stored copy (never listed to them: the thread lists by the messages they can see)');
  check('F1: an attachment to a message with visibility NULL (an open message, or a dispute message: the stand-in cannot tell them apart, and neither can the route) fans out to ALL ' + roster.length + ' participants', sameValue(entitiesOf(upKey('up-message-open')), roster));
  console.log('  FINDING F2 cb-security: a message_id the caller cannot see (a counterparty\'s internal note, a dispute they are not in) is written into EVERY roster copy as if it were visible: ' + hidden.length + ' copies carry ' + scenes.MSG_PEER_INTERNAL + ' (needs the uuid, which is never sent to the caller; no existence oracle: the answer is the same 200)');
  check('F2: all roster copies carry the message_id of a message the caller cannot see', hidden.length === roster.length && hidden.every((one) => one.p[2] === scenes.MSG_PEER_INTERNAL), hidden.map((one) => one.p[2]));
  const name = recording[getKey('get-name-beyond-latin-1-cannot-be-sent')];
  console.log('  FINDING F3 cb-rail: a file named with a character above U+00FF (Devanagari, Arabic, an emoji) uploads, then cannot be read back: Node refuses the Content-Disposition header (ERR_INVALID_CHAR), the answer is the safe 500 "Fetch failed": ' + name.status + ' ' + JSON.stringify(name.body).slice(0, 120));
  check('F3: a download of a name beyond Latin-1 answers 500 (Fetch failed) and a Latin-1 name is sent', name.status === 500 && name.body.error === 'Fetch failed' && recording[getKey('get-name-in-latin-1')].status === 200);
  const outcome = await storageAfterOneFailure();
  console.log('  FINDING F4 cb-rail/cb-platform: lib/storage.js ensureTable() keeps its FIRST result in a module variable, a rejected promise included: after one failed first query every later upload and download answers 500 until the process restarts: ' + JSON.stringify(outcome));
  check('F4: a library loaded fresh fails on its first call (the database is down) and STILL fails on the second (the database is back)', outcome.first === 'threw' && outcome.second === 'threw', outcome);
  console.log('  FINDING F5 cb-security: GET /:id reads WHERE id = $1 with no entity predicate of its own (lib/storage.js getBlob): row-level security alone decides whose copy it is (RAIL-80). The 9th world below passes where RLS applies (the cb_app role, FORCE ROW LEVEL SECURITY, baseline); it does not on a connection that bypasses RLS (the local stack runs as postgres).');
}

/** a fresh copy of lib/storage.js, called once with the database down and once with it back: does it recover? (ensureTable caches its first answer) */
async function storageAfterOneFailure() {
  const file = require.resolve(path.join(HERE, 'lib', 'storage'));
  const kept = require.cache[file];
  delete require.cache[file];
  const fresh = require(file);
  require.cache[file] = kept;
  const ask = () => fresh.getBlob(scenes.ATT, SHOP).then(() => 'answered', () => 'threw');
  Object.assign(world, { realAuth: false, who: OWNER, asKey: false, db: 'fail', sqlRows: null, jsonThrows: false, noCustomer: false });
  const first = await ask();
  Object.assign(world, { db: 'ok', sqlRows: scenes.ownedBy(SHOP, true, sqlError) });
  return { first, second: await ask() };
}

/** one raw GET: the status, EVERY header and the bytes (the harness keeps only the type, disposition and cache) */
function rawGet(port, url) {
  return new Promise((resolve) => {
    const request = http.get({ port, path: url }, (response) => {
      const parts = [];
      response.on('data', (part) => parts.push(part));
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, bytes: Buffer.concat(parts) }));
    });
    request.setTimeout(4000, () => { request.destroy(); resolve({ status: 0, headers: {}, bytes: Buffer.alloc(0) }); });
    request.on('error', () => undefined);
  });
}

/** the type each stored mime is served as, how, and under which name (S2: only png, jpeg, gif, webp, bmp and pdf render inline; SVG and everything else download) */
const DOWNLOADS = [
  ['get-png-opens-inline', 'image/png', 'inline', 'receipt.png'], ['get-jpeg-opens-inline', 'image/jpeg', 'inline', 'receipt.png'], ['get-jpg-opens-inline', 'image/jpg', 'inline', 'receipt.png'],
  ['get-gif-opens-inline', 'image/gif', 'inline', 'receipt.png'], ['get-webp-opens-inline', 'image/webp', 'inline', 'receipt.png'], ['get-bmp-opens-inline', 'image/bmp', 'inline', 'receipt.png'],
  ['get-pdf-opens-inline', 'application/pdf', 'inline', 'receipt.png'], ['get-svg-is-forced-to-download', 'application/octet-stream', 'attachment', 'logo.svg'],
  ['get-html-is-forced-to-download', 'application/octet-stream', 'attachment', 'page.html'], ['get-text-is-forced-to-download', 'application/octet-stream', 'attachment', 'note.txt'],
  ['get-no-mime-is-octet-stream', 'application/octet-stream', 'attachment', 'receipt.png'], ['get-mime-in-capitals-is-lowered', 'image/png', 'inline', 'receipt.png'],
  ['get-mime-with-parameters-is-forced-to-download', 'application/octet-stream', 'attachment', 'receipt.png'], ['get-name-is-cleaned', 'image/png', 'inline', 'abcd.png'],
  ['get-no-name-is-file', 'image/png', 'inline', 'file'], ['get-name-in-latin-1', 'application/pdf', 'inline', 'résumé.pdf']
];

/** the Content-Disposition of a download; a name beyond ASCII is checked by its ASCII frame only (how Node encodes a header above U+007F is its own business and differs by version) */
const dispositionIs = (given, how, name) => (/^[ -~]*$/.test(name) ? given === how + '; filename="' + name + '"' : new RegExp('^' + how + '; filename="r.{1,4}sum.{1,4}\.pdf"$').test(given));

/** the headers and the bytes of every download, asked raw: the S2 defence (nosniff, no inline render but images and pdf), the cache line, the bytes as stored */
async function checkDownloads(port) {
  console.log('\n-- a download: bytes as stored, headers as before (S2: stored-XSS defence) --');
  const all = scenes.extras({ OWNER, STAFF, SECRET_SQL, raising, answering, firstOf, sqlError });
  const failed = [];
  for (const [id, type, how, name] of DOWNLOADS) {
    const scene = all.find((one) => one.id === id);
    Object.assign(world, { realAuth: false, who: OWNER, asKey: false, db: 'ok', sqlRows: null, jsonThrows: false, noCustomer: false }, scene.setup);
    const got = await rawGet(port, scene.url);
    const headers = got.headers;
    const good = got.status === 200 && headers['content-type'] === type && headers['x-content-type-options'] === 'nosniff' && headers['cache-control'] === 'private, max-age=86400' && dispositionIs(headers['content-disposition'], how, name) && got.bytes.equals(scenes.BYTES);
    if (!good) failed.push({ id, status: got.status, headers });
  }
  check('all ' + DOWNLOADS.length + ' downloads answer 200 with the type, X-Content-Type-Options: nosniff, Content-Disposition, Cache-Control: private, max-age=86400 and the stored bytes', failed.length === 0, failed);
  const empty = all.find((one) => one.id === 'get-empty-bytes');
  Object.assign(world, { realAuth: false, who: OWNER, db: 'ok' }, empty.setup);
  const none = await rawGet(port, empty.url);
  check('a stored file with no bytes is a 200 with an empty body and the same headers', none.status === 200 && none.bytes.length === 0 && none.headers['x-content-type-options'] === 'nosniff', none.headers);
}

/* ── the foreign-id world (API-STANDARD S35): shop B asks for shop A's attachment by its id ── */
const FOREIGN_ROUTES = () => [{ route: GET, url: MOUNT + '/' + scenes.ATT, method: 'GET' }];

/** one play(who, planted) of the download: asks as the stranger (shop B) or as the owner (shop A); the file is planted for shop A only, and shop B also holds a file of its own (the caller's own second record) */
function playFor(port, item) {
  return async (who, planted) => {
    const caller = who === 'owner' ? scenes.SHOP_ID : scenes.STRANGER_ID;
    const mine = { id: scenes.UNKNOWN_ATT, entity: scenes.STRANGER_ID, row: scenes.fileRow({ entity_id: scenes.STRANGER_ID, name: 'mine.png' }) };
    const rows = scenes.attRows({ caller, files: (planted ? [{ id: scenes.ATT, entity: scenes.SHOP_ID, row: scenes.fileRow() }] : []).concat(who === 'owner' ? [] : [mine]) }, sqlError);
    Object.assign(world, { realAuth: false, who: who === 'owner' ? OWNER : STRANGER, asKey: false, db: 'ok', sqlRows: rows, jsonThrows: false, noCustomer: false });
    return lab.send(port, item.method, item.url);
  };
}

async function checkForeignIds(port) {
  console.log('\n-- signed in as another shop: a foreign id answers exactly as an unknown id (S35) --');
  const recording = FOREIGN.recorder();
  const items = FOREIGN_ROUTES();
  const failures = await FOREIGN.runCases(items.map((item) => ({ route: item.route, play: playFor(port, item) })), recording.record);
  console.log('  foreign id: ' + (items.length - failures.length) + ' of ' + items.length + ' routes held the 404 proof');
  failures.forEach((sentence) => console.log('  FINDING ' + sentence));
  const play = playFor(port, items[0]);
  const unknown = await play('stranger', false);
  const foreign = await play('stranger', true);
  const own = await play('owner', true);
  check('another shop\'s id answers byte for byte as an unknown id: 404, the Problem type and the same body (request id masked)', foreign.status === 404 && FOREIGN.comparable(foreign) === FOREIGN.comparable(unknown), [foreign.text, unknown.text]);
  check('the owner\'s own id is not a 404 and sends the bytes', own.status === 200 && own.bytes.equals(scenes.BYTES), own.status);
  check('the foreign id never answers 403 and never sends the record, even when the stranger holds a file of its own', foreign.status !== 403 && !foreign.bytes.equals(scenes.BYTES));
  return { proved: recording.proved(), failures, asked: items.length };
}

/** the SQL statements of every scenario, against a capture of the code before: the same text and the same parameters */
function compareStatements(captureFile) {
  const before = JSON.parse(fs.readFileSync(captureFile + SQL_FILE_SUFFIX, 'utf8'));
  const keys = Object.keys(before);
  const different = keys.filter((key) => !sqlLog[key] || !sameValue(before[key], sqlLog[key].map((one) => ({ q: one.q, p: one.p }))));
  console.log('compared ' + keys.length + ' scenarios\' statements (text hash and parameters): ' + (keys.length - different.length) + ' identical, ' + different.length + ' different');
  different.forEach((key) => console.log('  ' + key));
}

/** a capture or a compare, when one was asked for: true when this run was one */
function recordedRun(server, routes, recording) {
  const statements = Object.fromEntries(Object.keys(sqlLog).map((key) => [key, sqlLog[key].map((one) => ({ q: one.q, p: one.p }))]));
  if (lab.flagValue('--capture')) {
    server.close();
    fs.writeFileSync(lab.flagValue('--capture'), JSON.stringify(recording, null, 1));
    fs.writeFileSync(lab.flagValue('--capture') + SQL_FILE_SUFFIX, JSON.stringify(statements, null, 1));
    console.log('captured ' + Object.keys(recording).length + ' answers over ' + Object.keys(routes).length + ' routes, and the statements of ' + Object.keys(statements).length + ' scenarios');
    return true;
  }
  if (lab.flagValue('--compare')) {
    lab.compare(lab.flagValue('--compare'), recording);
    compareStatements(lab.flagValue('--compare'));
    return true;
  }
  return false;
}

/** the statuses tested per route against docs/contracts/api-error-tests.json, and the foreign-id evidence against its file; --write rewrites both */
function checkRecorded(tested, foreign) {
  const coverage = lab.coverageOf(tested);
  const onDisk = JSON.parse(fs.readFileSync(TESTED_FILE, 'utf8'));
  const mine = Object.fromEntries(Object.keys(onDisk).filter(lab.mine).sort().map((route) => [route, onDisk[route]]));
  if (!lab.argv.includes('--write')) {
    check('docs/contracts/api-error-tests.json lists exactly the statuses these scenarios cover for routes/attachments.js', sameValue(mine, coverage), { onDisk: mine, covered: coverage });
    return check('docs/contracts/api-hardening-evidence-areas.json says foreign_id_404 for exactly the routes that held here', sameValue(FOREIGN.evidenceOf(EVIDENCE_FILE, lab.mine), foreign.proved), { onDisk: Object.keys(FOREIGN.evidenceOf(EVIDENCE_FILE, lab.mine)).length, held: Object.keys(foreign.proved).length });
  }
  const others = Object.fromEntries(Object.keys(onDisk).filter((route) => !lab.mine(route)).map((route) => [route, onDisk[route]]));
  const merged = Object.assign(others, coverage);
  fs.writeFileSync(TESTED_FILE, JSON.stringify(Object.fromEntries(Object.keys(merged).sort().map((route) => [route, merged[route]])), null, 1) + '\n');
  FOREIGN.writeEvidence(EVIDENCE_FILE, lab.mine, foreign.proved);
}

process.on('unhandledRejection', (failure) => console.log('  (unhandled rejection: ' + String(failure && failure.message).slice(0, 80) + ')'));
(async () => {
  if (lab.flagValue('--freeze')) return lab.freeze(lab.flagValue('--freeze'));
  lab.installStubs();
  const router = require(path.join(HERE, ROUTE_FILE));
  const routes = lab.routesOf(router, MOUNT);
  const server = lab.appOf([{ mount: MOUNT, router }]).listen(0);
  const recording = {};
  const contract = contractModule();
  const capturing = lab.flagValue('--capture') || lab.flagValue('--compare');
  const declared = capturing || !contract ? () => [] : contract.allowedStatuses();
  const scenarios = lab.scenariosOf(routes, WORLDS, extrasList());
  const tested = await lab.checkRoutes(server.address().port, scenarios, recording, declared, sources);
  if (recordedRun(server, routes, recording)) process.exit(0);
  const port = server.address().port;
  const foreign = await checkForeignIds(port);
  await checkDownloads(port);
  await checkFindings(recording);
  server.close();
  checkWords(contract);
  checkCodesRegistered(contract);
  checkContractShape(contract, routes, router);
  checkFrozen5xx(recording);
  checkLeaks(recording);
  checkDoors(recording);
  checkFanOut(recording);
  checkStoredAndEchoed(recording);
  checkIdsInTheBody(recording);
  const legacy = JSON.parse(fs.readFileSync(lab.legacyFile, 'utf8')).routes;
  const frozen = Object.keys(legacy).filter(lab.mine).reduce((sum, route) => sum + legacy[route].answers.length, 0);
  check('every refusal recorded before the sweep is replayed against the code: ' + frozen + ' answers, each once, byte for byte', frozen > 20, frozen);
  checkRecorded(tested, foreign);
  console.log('\n  ' + lab.count.passed + ' checks, ' + lab.count.failed + ' failed');
  process.exit(lab.count.failed ? 1 : 0);
})();
