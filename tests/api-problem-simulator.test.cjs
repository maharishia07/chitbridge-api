#!/usr/bin/env node
// @type: contract
/**
 * api-problem-simulator.test.cjs — API-4 sweep, the tour: every answer of routes/simulator.js (3 PUBLIC routes, /api/simulator: the content the /tour page renders, the lead gate, the page feedback).
 *
 * OWNS      the proof that each refusal of the three routes is a Problem body AND still carries the keys it answered before (docs/contracts/api-legacy.json, recorded from the code before the sweep), that no
 *           success answer moved (--compare against a capture of the code before: the answers, every SQL statement with its parameters, every e-mail handed to the provider and every [SIM] log line), this file's
 *           rows of docs/contracts/api-error-tests.json, and what the tour does: the lead gate mints a token with a SEPARATE secret (S1: the identity secret does not verify it, its claims and 7 days are
 *           byte for byte under a frozen clock), the notification wording and its three no-op doors. Also: no answer of ANY status (a 2xx included) carries the text of a thrown error, a 2xx is never a Problem,
 *           the frozen 500 bodies are replayed word for word, no answer outside the statuses the contract declares (lib/simulator-contract.js), its words as units, and the FINDINGS the sweep lists for
 *           cb-security: the foreign-key oracle on `leadId` (a real lead id answers 200, an unknown uuid and a non-uuid answer the same 500), a rating the column cannot hold, `name` and `section` reaching an
 *           e-mail SUBJECT unescaped, the SELECT * of /content, and the secret fallback. All three routes are signed out, so there is no "another shop" and no id in any path: the 9th world (S35) has nothing to
 *           ask; the id surface is the body's `leadId`. None is a money write.
 * CALLED BY scripts/guards.cjs · CI. No database, no network: the real route file over a stand-in db that MODELS sim_leads and sim_feedback (its foreign key and column types), and a stand-in e-mail provider
 *           (tests/lib/problem-world.cjs, scenes in tests/lib/simulator-scenes.cjs).
 * FLOW      route list (read from the router) x world (signed out, a failing db) + the named extras (tests/lib/simulator-scenes.cjs) → real route → body → Problem fields present · frozen legacy keys equal ·
 *           no leak · statuses tested → manifest; then the token, the mail, the oracle and the edges
 * CARD      qa/offline-guards
 *
 *   node tests/api-problem-simulator.test.cjs                    check
 *   node tests/api-problem-simulator.test.cjs --write            check, then record this file's rows of docs/contracts/api-error-tests.json
 *   node tests/api-problem-simulator.test.cjs --capture F        record every answer and every effect (SQL, e-mail, log line) of the code as it stands to F and F.sql
 *   node tests/api-problem-simulator.test.cjs --freeze F         merge a capture F into docs/contracts/api-legacy.json (the frozen answers)
 *   node tests/api-problem-simulator.test.cjs --compare F        the answers and effects now against a capture F: byte for byte for a success, the old keys in order for a refusal
 */
'use strict';
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { harness, SECRET_SQL, sameValue, sqlError } = require('./lib/problem-world.cjs');
const scenes = require('./lib/simulator-scenes.cjs');

const HERE = path.join(__dirname, '..');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
['RESEND_API_KEY', 'LEADS_EMAIL', 'FROM_EMAIL', 'SIM_JWT_SECRET', 'JWT_TTL'].forEach((name) => delete process.env[name]); /* the harness can only SET text: the variables a scene needs are set per scene, the rest are gone */
const MOUNT = scenes.MOUNT;
const ROUTE_COUNT = 3;
const SQL_FILE_SUFFIX = '.sql';
const THROWN = /SELECT|vault|relation "|catalogue_items/;
const SAFE_SENTENCE = 'Something went wrong — please try again.';
const COULD_NOT = 'Could not record that — please try again.';
const REAL_NOW = Date.now;
const LEAD = 'POST ' + MOUNT + '/lead';
const FEEDBACK = 'POST ' + MOUNT + '/feedback';
const CONTENT = 'GET ' + MOUNT + '/content';
const effects = {};
let effectKey = null;
let mailMode = null;
const undo = [];
const lab = harness({
  here: HERE,
  mounts: [MOUNT],
  routeFiles: { [MOUNT]: 'routes/simulator.js' },
  legacyFile: path.join(HERE, 'docs', 'contracts', 'api-legacy.json'),
  inherited: () => false,
  notFrozen: () => false,
  before: async (scenario) => {
    undo.splice(0).reverse().forEach((restore) => restore()); /* what the scene before set (a removed variable, the clock) is put back */
    Date.now = REAL_NOW;
    effectKey = scenario.route + '|' + scenario.id;
    effects[effectKey] = { sql: [], mails: [], notices: [] };
    mailMode = scenario.mail || null;
    const inner = lab.world.sqlRows;
    lab.world.sqlRows = (sql, params) => {
      effects[effectKey].sql.push({ q: crypto.createHash('sha1').update(String(sql).replace(/\s+/g, ' ')).digest('hex').slice(0, 10), sql: String(sql), p: params });
      return inner ? inner(sql, params) : null;
    };
    (scenario.unsetEnv || []).forEach((name) => {
      const was = process.env[name];
      delete process.env[name];
      undo.push(() => { if (was !== undefined) process.env[name] = was; });
    });
    if (scenario.clock) Date.now = () => scenes.CLOCK_MS; /* the token's iat and exp are then the same on every run */
  }
});
const { check } = lab;
const TESTED_FILE = path.join(HERE, 'docs', 'contracts', 'api-error-tests.json');
const REGISTER_FILE = path.join(HERE, 'docs', 'error-codes.json');
const WORLDS = [
  { id: 'signed-out', setup: { realAuth: true } },
  { id: 'db-fails', setup: { db: 'fail' } }
];
const sources = () => ({});
/** lib/simulator-contract.js, or null on the code before the sweep (so the negative control FAILS cleanly instead of throwing) */
const contractModule = () => {
  try {
    return require(path.join(HERE, 'lib', 'simulator-contract.js'));
  } catch (failure) {
    return null;
  }
};
const extrasList = () => scenes.extras({ SECRET_SQL, sqlError });
const answerOf = (recording, route, id) => recording[route + '|' + id];
const fxOf = (route, id) => effects[route + '|' + id] || { sql: [], mails: [], notices: [] };
const insertsOf = (route, id, table) => fxOf(route, id).sql.filter((one) => new RegExp('INSERT INTO ' + table).test(one.sql));

/** the stand-in e-mail provider (the `resend` package the route requires inside notify) and the [SIM] log lines, kept per scene */
function installProviders() {
  const file = require.resolve('resend');
  class FakeResend {
    constructor() {
      this.emails = {
        send: async (message) => {
          if (mailMode === 'throws') throw new Error(SECRET_SQL);
          effects[effectKey].mails.push(message);
          return { id: 'mail-1' };
        }
      };
    }
  }
  require.cache[file] = { id: file, filename: file, loaded: true, exports: { Resend: FakeResend } };
  const realLog = console.log;
  const note = (lines) => { if (effects[effectKey] && String(lines[0]).startsWith('[SIM]')) effects[effectKey].notices.push(lines.map(String).join(' ')); };
  console.log = (...lines) => (String(lines[0]).startsWith('[SIM]') ? note(lines) : realLog(...lines));
  console.error = (...lines) => note(lines);
}

/** lib/simulator-contract.js as a unit: the words of a refusal and of a fault, as the tour always said them */
function checkWords(contract) {
  console.log('\n-- lib/simulator-contract.js: the refusals as a unit --');
  check('lib/simulator-contract.js exists (the contract of the three routes)', !!contract);
  if (!contract) return;
  const { words, faultOf } = contract;
  const req = { id: 'r1' };
  const lead = words.leadFieldsMissing();
  check('leadFieldsMissing: the old body is { error } and nothing else, word for word', sameValue(lead.legacy, { error: 'A name and a valid email are required.' }) && lead.code === 'SIM_LEAD_FIELDS_MISSING' && lead.detail === 'A name and a valid email are required.', lead);
  const message = words.messageMissing();
  check('messageMissing: the old body is { error } and nothing else, word for word', sameValue(message.legacy, { error: 'A message is required.' }) && message.code === 'SIM_FEEDBACK_MESSAGE_MISSING' && message.detail === 'A message is required.', message);
  const content = faultOf(new Error(SECRET_SQL), req, 'Failed to load content');
  check('faultOf (the content read): the screen\'s label and the one safe sentence, never the cause', content.status === 500 && content.code === 'INTERNAL' && sameValue(content.legacy, { error: 'Failed to load content', message: SAFE_SENTENCE }) && !THROWN.test(JSON.stringify(content)), content);
  const write = contract.writeFaultOf(new Error(SECRET_SQL), req);
  check('writeFaultOf (the two writes): the old one-key body { error } with its sentence, never the cause', write.status === 500 && write.code === 'INTERNAL' && sameValue(write.legacy, { error: COULD_NOT }) && !THROWN.test(JSON.stringify(write)), write);
}

/** every code the words answer under is a row of docs/ERROR-CODES.md with its sentence written */
function checkCodesRegistered(contract) {
  console.log('\n-- the codes the tour routes answer under are in the register --');
  if (!contract) return check('the codes of lib/simulator-contract.js are registered', false);
  const known = new Set(JSON.parse(fs.readFileSync(REGISTER_FILE, 'utf8')).codes.filter((row) => row.shopkeeper !== 'PENDING').map((row) => row.code));
  const missing = contract.CODES.filter((code) => !known.has(code));
  check('every code the tour words (' + contract.CODES.length + ') answers under is a register row with its sentence written', missing.length === 0, missing);
}

/** the contract in front of the router: every route has an operation and an operation a route; nothing here can be refused for its shape (the old code never did) */
function checkContractShape(contract, routes, router) {
  console.log('\n-- the contract and the router agree --');
  check('premise: the router holds ' + ROUTE_COUNT + ' routes (an empty list would pass every scan)', Object.keys(routes).length === ROUTE_COUNT, Object.keys(routes));
  check('premise: no route has an id in its path, so the 9th world (S35) has nothing to ask: all three are signed out, there is no "another shop"', Object.keys(routes).every((key) => !key.includes(':')), Object.keys(routes));
  if (!contract) return check('every route has an operation', false);
  const operations = Object.keys(contract.OPERATIONS);
  check('every route the router holds has an operation, and every operation a route (' + operations.length + ')', sameValue(operations.slice().sort(), Object.keys(routes).sort()), operations.filter((key) => !routes[key]));
  check('the router publishes its operations (router.openapi) from the contract', !!(router.openapi && router.openapi.paths) && Object.keys(router.openapi.paths).length === ROUTE_COUNT, router.openapi);
  check('all three are public: no security, no 401 in any operation (a visitor has no sign-in to be refused)', operations.every((key) => sameValue(contract.OPERATIONS[key].security, []) && !('401' in contract.OPERATIONS[key].responses)), operations.map((key) => Object.keys(contract.OPERATIONS[key].responses)));
  const bodies = operations.filter((key) => contract.OPERATIONS[key].requestBody);
  check('the two writes declare a body that may be an object or a list: the handlers read a list as no fields', bodies.length === 2 && bodies.every((key) => sameValue(contract.OPERATIONS[key].requestBody.content['application/json'].schema.type, ['object', 'array'])), bodies);
  check('no body names a key as required and none is closed (an unknown key was dropped before, and still is: strict_input stays open)', bodies.every((key) => { const one = contract.OPERATIONS[key].requestBody.content['application/json'].schema; return !one.required && one.additionalProperties === undefined; }));
  check('every refusal an operation declares is a Problem', operations.every((key) => Object.keys(contract.OPERATIONS[key].responses).filter((status) => Number(status) >= 400).every((status) => JSON.stringify(contract.OPERATIONS[key].responses[status]).includes('Problem'))));
  const declared = (key) => Object.keys(contract.OPERATIONS[key].responses).filter((status) => Number(status) >= 400).map(Number).sort();
  check('the statuses declared: content 500; lead and feedback 400 and 500', sameValue(declared(CONTENT), [500]) && sameValue(declared(LEAD), [400, 500]) && sameValue(declared(FEEDBACK), [400, 500]), [CONTENT, LEAD, FEEDBACK].map(declared));
  check('the limiter\'s 429 (240 a minute per address, express-rate-limit\'s own body, not a Problem) is listed on all three under x-simulator-refusals', operations.every((key) => (contract.OPERATIONS[key]['x-simulator-refusals'] || []).some((one) => one.status === 429)));
  check('the lead answer declares exactly { token, leadId } and the feedback answer { ok }', sameValue(contract.OPERATIONS[LEAD].responses['200'].content['application/json'].schema.required, ['token', 'leadId']) && sameValue(contract.OPERATIONS[FEEDBACK].responses['200'].content['application/json'].schema.required, ['ok']));
}

/** the frozen 5xx bodies of the untouched code, replayed: the same status and every old key, byte for byte and in order */
function checkFrozen5xx(recording) {
  console.log('\n-- the frozen 500 answers are replayed --');
  const legacy = JSON.parse(fs.readFileSync(lab.legacyFile, 'utf8')).routes;
  let replayed = 0;
  Object.keys(legacy).filter(lab.mine).forEach((route) => legacy[route].answers.filter((frozen) => frozen.status >= 500).forEach((frozen) => {
    const now = recording[route + '|' + frozen.scenario];
    const order = Object.keys(frozen.fixture);
    replayed++;
    check(route + ' · ' + frozen.scenario + ': the frozen ' + frozen.status + ' body is kept, key by key and in order', !!now && now.status === frozen.status && sameValue(order.map((name) => now.body[name]), order.map((name) => frozen.fixture[name])) && sameValue(Object.keys(now.body).slice(0, order.length), order), now && now.body);
  }));
  check('at least fifteen 500 answers (every route x a failing db, a thrown answer, a rating or a lead the column refuses) were frozen and replayed (' + replayed + ')', replayed >= 15, replayed);
  check('there is no 502 or 503 on these routes to replay: no relay mode, no provider answer reaches the caller (the e-mail provider is called after the insert and never answers the visitor)', Object.keys(recording).every((key) => ![502, 503].includes(recording[key].status)));
}

/** no answer of any status carries a thrown text; a 2xx is never a Problem; every 500 says one of the fixed sentences */
function checkLeaks(recording) {
  console.log('\n-- no thrown text in any answer; a 2xx is never a Problem --');
  const asked = Object.keys(recording).filter((key) => /leaks-nothing$/.test(key));
  check('the scenes that make the database, the answer or the e-mail provider THROW a string with SQL in it ran (' + asked.length + ' of 8)', asked.length === 8, asked);
  check('six of them answered 500 and the two e-mail failures answered 200 (the provider is called after the insert and never answers the visitor)', asked.filter((key) => recording[key].status === 500).length === 6 && asked.filter((key) => recording[key].status === 200).length === 2, asked.map((key) => key + ' ' + recording[key].status));
  check('no answer of ANY status (2xx, 4xx, 5xx) carries the thrown text', Object.keys(recording).every((key) => !THROWN.test(JSON.stringify(recording[key].body || recording[key].text || ''))), Object.keys(recording).filter((key) => THROWN.test(JSON.stringify(recording[key].body || ''))));
  check('no e-mail handed to the provider carries the thrown text either', Object.keys(effects).every((key) => !THROWN.test(JSON.stringify(effects[key].mails))));
  check('a 2xx is never a Problem: every success answer keeps its own shape', Object.keys(recording).filter((key) => recording[key].status < 400).every((key) => !/problem\+json/.test(recording[key].type)));
  const fives = Object.keys(recording).filter((key) => recording[key].status === 500);
  check('every 500 is one of the three fixed bodies: the content read says its label and the one safe sentence, the two writes say "' + COULD_NOT + '" (nothing of the error is relayed or interpolated)', fives.every((key) => (recording[key].body.error === 'Failed to load content' && recording[key].body.message === SAFE_SENTENCE) || (recording[key].body.error === COULD_NOT && recording[key].body.message === undefined)), fives.map((key) => recording[key].body));
}

/** the three routes are doors for everyone: no answer is a 401, 403 or 429, and a bearer header changes nothing */
function checkDoors(recording) {
  console.log('\n-- the doors: public --');
  const statuses = new Set(Object.keys(recording).map((key) => recording[key].status));
  check('no scenario of any route (signed out, a bearer, a failing db) was answered 401, 403 or 429', ![401, 403, 429].some((status) => statuses.has(status)), [...statuses]);
  const plain = answerOf(recording, CONTENT, 'content-listed');
  const bearer = answerOf(recording, CONTENT, 'content-bearer-ignored');
  check('a bearer header on GET /content changes nothing: the same bytes as without one', plain.sha === bearer.sha && plain.status === 200 && bearer.status === 200, [plain.status, bearer.status]);
  const query = answerOf(recording, CONTENT, 'content-query-string-ignored');
  check('a query string on GET /content changes nothing (the route takes no input)', plain.sha === query.sha, [plain.sha, query.sha]);
  const listed = plain.body;
  check('GET /content answers the six lists in their order: layers, items, shapes, rules, compare, usps', sameValue(Object.keys(listed), ['layers', 'items', 'shapes', 'rules', 'compare', 'usps']) && Object.values(listed).every((rows) => Array.isArray(rows) && rows.length === 1), Object.keys(listed));
  check('the content read is six statements, no parameters, in the order of the page (layers, items, shapes, rules, compare, usps): the trips are 6 on one connection pool call each', fxOf(CONTENT, 'content-listed').sql.length === 6 && fxOf(CONTENT, 'content-listed').sql.every((one) => one.p === undefined || one.p.length === 0), fxOf(CONTENT, 'content-listed').sql.map((one) => one.sql));
  const planted = answerOf(recording, CONTENT, 'content-passes-every-column');
  check('FINDING (output_allowlist cannot pass): SELECT * hands out EVERY column of a sim_* table, so a column added to one is published at once; the planted column reaches the visitor', planted.body.layers[0].internal_note === 'planted', planted.body.layers[0]);
}

/** the lead gate: the token's secret, claims and life, byte for byte under a frozen clock; the S1 rule */
function checkToken(recording) {
  console.log('\n-- the lead gate: a token that is not a platform credential (S1) --');
  const jwt = require('jsonwebtoken');
  /** the claims of a token under a secret at the frozen clock, or null when it does not verify (a failed check, never a thrown one) */
  const verified = (token, secret) => { try { return jwt.verify(token, secret, { clockTimestamp: scenes.CLOCK_MS / 1000 }); } catch (refused) { return null; } };
  const made = answerOf(recording, LEAD, 'lead-created').body;
  check('the 200 is { token, leadId } and nothing else, in that order', sameValue(Object.keys(made), ['token', 'leadId']) && made.leadId === scenes.KNOWN_LEAD, made);
  const claims = verified(made.token, 'test-secret::sim-lead-v1') || {};
  check('the claims are { kind: sim_lead, leadId, email } plus iat and exp, signed with the secret derived from JWT_SECRET', claims.kind === 'sim_lead' && claims.leadId === scenes.KNOWN_LEAD && claims.email === 'lead@example.invalid' && claims.iat === scenes.CLOCK_MS / 1000 && sameValue(Object.keys(claims), ['kind', 'leadId', 'email', 'iat', 'exp']), claims);
  check('the token lives 7 days by default', claims.exp - claims.iat === 7 * 24 * 3600, claims.exp - claims.iat);
  check('S1: the identity secret (JWT_SECRET itself) does NOT verify it, and neither does the platform\'s own verifier', (() => { try { jwt.verify(made.token, 'test-secret'); return false; } catch (refused) { return true; } })() && (() => { try { const given = require(path.join(HERE, 'lib', 'jwt-verify')).verifyJwt(made.token); return !given || !given.claims || !given.claims.identity_id; } catch (refused) { return true; } })());
  const own = verified(answerOf(recording, LEAD, 'lead-token-with-its-own-secret').body.token, scenes.SIM_SECRET_FOR_TESTS);
  check('SIM_JWT_SECRET wins over the derived secret', !!own && own.kind === 'sim_lead');
  const short = verified(answerOf(recording, LEAD, 'lead-token-with-its-own-ttl').body.token, 'test-secret::sim-lead-v1') || {};
  check('JWT_TTL sets the life of the token (1h)', short.exp - short.iat === 3600, short.exp - short.iat);
  const bare = verified(answerOf(recording, LEAD, 'lead-token-with-no-secret-at-all').body.token, 'sim-lead-dev-only') || {};
  check('FINDING (cb-security): with neither SIM_JWT_SECRET nor JWT_SECRET the token is signed with the published literal \'sim-lead-dev-only\'; harmless only because no route verifies a sim_lead token at all', bare.kind === 'sim_lead');
  const routesText = ['routes', 'middleware', 'lib'].map((dir) => fs.readdirSync(path.join(HERE, dir)).filter((name) => name.endsWith('.js')).map((name) => dir + '/' + name)).flat();
  const readers = routesText.filter((file) => /sim-lead-dev-only|::sim-lead-v1|SIM_JWT_SECRET/.test(fs.readFileSync(path.join(HERE, file), 'utf8')) && !/routes\/simulator\.js|lib\/simulator-contract\.js/.test(file));
  check('FINDING (cb-security, cb-demo): no file other than routes/simulator.js knows the sim secret, so the token is verified nowhere: the "gate" is cosmetic and GET /content answers every visitor', readers.length === 0, readers);
}

/** the lead and the feedback as stored: the parameters of every INSERT */
function checkStored(recording) {
  console.log('\n-- what is stored --');
  const lead = (id) => insertsOf(LEAD, id, 'sim_leads');
  check('a lead stores name, e-mail and org as sent, trimmed, the e-mail lower-cased', sameValue(lead('lead-created')[0].p, ['Test Lead', 'lead@example.invalid', 'Test Org']) && sameValue(lead('lead-trimmed-and-lowered')[0].p, ['Test Lead', 'lead@example.invalid', 'Test Org']));
  check('no org, or an org of spaces, stores null', lead('lead-without-org')[0].p[2] === null && lead('lead-org-blank')[0].p[2] === null);
  check('only the three fields are read: an id, a leadId or an admin flag in the body reaches no statement (and no refusal: strict_input stays open)', lead('lead-extra-keys-dropped').length === 1 && sameValue(lead('lead-extra-keys-dropped')[0].p, ['Test Lead', 'lead@example.invalid', 'Test Org']) && answerOf(recording, LEAD, 'lead-extra-keys-dropped').status === 200);
  check('EDGES taken as they are: a number is the text of the number, a list is its elements joined by commas, "@" alone is an e-mail', sameValue(lead('lead-name-a-number')[0].p.slice(0, 1), ['12']) && sameValue(lead('lead-name-a-list')[0].p.slice(0, 1), ['Te,st']) && lead('lead-email-just-an-at-sign')[0].p[1] === '@');
  check('a refused lead writes nothing (name under 2 after the trim, no @, nothing, a list)', ['lead-name-too-short', 'lead-name-short-after-trim', 'lead-email-without-an-at-sign', 'lead-nothing-sent', 'lead-body-a-list'].every((id) => lead(id).length === 0 && answerOf(recording, LEAD, id).status === 400));
  const feedback = (id) => insertsOf(FEEDBACK, id, 'sim_feedback');
  check('a feedback stores lead_id, section, rating, message in that order', sameValue(feedback('feedback-recorded')[0].p, [scenes.KNOWN_LEAD, 'pricing', 4, 'Test message']));
  check('with only a message the other three are null', sameValue(feedback('feedback-message-only')[0].p, [null, null, null, 'Test message']));
  check('only the four fields are read: an id, a created_at or an admin flag reaches no statement', sameValue(feedback('feedback-extra-keys-dropped')[0].p, [scenes.KNOWN_LEAD, 'pricing', 4, 'Test message']));
  const rating = (id) => feedback(id)[0].p[2];
  check('the rating is +value when that is a finite number: "5" is 5, [5] is 5, true is 1, "" and null are 0, "abc" is null, -3 stays -3', rating('feedback-rating-as-text') === 5 && rating('feedback-rating-in-a-list') === 5 && rating('feedback-rating-true') === 1 && rating('feedback-rating-empty-text') === 0 && rating('feedback-rating-null') === 0 && rating('feedback-rating-not-a-number') === null && rating('feedback-rating-negative') === -3);
  check('FINDING: a rating that is finite but not a whole number the column holds (3.5, 5000000000) reaches the INSERT and is Postgres 22P02 / 22003: the generic 500, and nothing is written', ['feedback-rating-decimal', 'feedback-rating-too-big-for-the-column'].every((id) => answerOf(recording, FEEDBACK, id).status === 500 && rating(id) !== undefined));
  check('a lead id of the wrong length is ignored (lead_id null): 3 characters and 37 characters', feedback('feedback-lead-too-short-ignored')[0].p[0] === null && feedback('feedback-lead-too-long-ignored')[0].p[0] === null);
  check('a refused feedback writes nothing (nothing sent, blank, 0, a list)', ['feedback-nothing-sent', 'feedback-message-blank', 'feedback-message-zero', 'feedback-body-a-list'].every((id) => feedback(id).length === 0 && answerOf(recording, FEEDBACK, id).status === 400));
}

/** the foreign-key oracle: what a signed-out caller can learn about a lead id from the answers (SEC-100) */
function checkOracle(recording) {
  console.log('\n-- POST /feedback: the lead id is an existence oracle (SEC-100, a FINDING for cb-security) --');
  const masked = (one) => JSON.stringify([one.status, one.type, Object.assign({}, one.body, { request_id: null })]);
  const known = answerOf(recording, FEEDBACK, 'feedback-recorded');
  const unknown = answerOf(recording, FEEDBACK, 'feedback-lead-unknown-uuid');
  const dashes = answerOf(recording, FEEDBACK, 'feedback-lead-not-a-uuid');
  const hex = answerOf(recording, FEEDBACK, 'feedback-lead-36-hex-digits');
  const inList = answerOf(recording, FEEDBACK, 'feedback-lead-in-a-list');
  check('a real lead id answers 200 { ok: true }', known.status === 200 && sameValue(known.body, { ok: true }), known.body);
  check('a well-formed uuid nobody holds answers 500 (the foreign key, 23503), and a 36-character non-uuid (36 hyphens, 36 hex digits, a list holding an id) answers the very same 500: the key and the cast are not told apart', [unknown, dashes, hex, inList].every((one) => one.status === 500) && masked(unknown) === masked(dashes) && masked(dashes) === masked(hex) && masked(hex) === masked(inList), [unknown.status, dashes.status, hex.status, inList.status]);
  check('SO 200 against 500 tells a signed-out caller whether a uuid is a lead; it needs a candidate id first (gen_random_uuid, 122 random bits, never listed): rated LOW', known.status !== unknown.status);
  check('the uppercase id, and the id with its hyphens in other places, are the same lead to Postgres: 200', answerOf(recording, FEEDBACK, 'feedback-lead-uppercase').status === 200 && answerOf(recording, FEEDBACK, 'feedback-lead-hyphens-moved').status === 200);
  check('the model of the key is the baseline: sim_feedback.lead_id is a uuid column REFERENCES sim_leads(id) with no RLS on either table; rating is an integer column', (() => {
    const baseline = fs.readFileSync(path.join(HERE, 'migrations', '000_baseline_2026-10-21.sql'), 'utf8');
    const table = /CREATE TABLE public\.sim_feedback \(([\s\S]*?)\);/.exec(baseline);
    return !!table && /lead_id uuid,/.test(table[1]) && /rating integer,/.test(table[1]) && /ADD CONSTRAINT sim_feedback_lead_id_fkey FOREIGN KEY \(lead_id\) REFERENCES public\.sim_leads\(id\)/.test(baseline) && !/ROW LEVEL SECURITY[^;]*sim_(leads|feedback)|POLICY [^;]*ON public\.sim_(leads|feedback)/.test(baseline);
  })());
}

/** the notification: its three no-op doors, its wording, and what it does with a provider that throws */
function checkNotify(recording) {
  console.log('\n-- notify(): best effort, never answers the visitor --');
  const sent = fxOf(LEAD, 'lead-notify-sends');
  check('a lead mails the leads inbox once, from the default sender, with the old subject and body', sent.mails.length === 1 && sameValue(sent.mails[0], { from: 'noreply@chitandbridge.com', to: scenes.INBOX, subject: 'New tour lead: Test Lead', html: '<p><b>Test Lead</b> opened the tour.</p><p>Email: lead@example.invalid<br>Org: Test Org</p>' }), sent.mails);
  check('no org reads "—" in the body', fxOf(LEAD, 'lead-notify-without-org').mails[0].html.endsWith('Org: —</p>'), fxOf(LEAD, 'lead-notify-without-org').mails);
  check('with no key (or no inbox) nothing is sent and the subject is logged as skipped', fxOf(LEAD, 'lead-notify-skipped').mails.length === 0 && fxOf(LEAD, 'lead-notify-no-inbox-skipped').mails.length === 0 && sameValue(fxOf(LEAD, 'lead-notify-skipped').notices, ['[SIM] notify skipped (no RESEND/LEADS_EMAIL): New tour lead: Test Lead']), fxOf(LEAD, 'lead-notify-skipped').notices);
  const fromOnly = fxOf(LEAD, 'lead-notify-from-address-is-the-inbox').mails[0];
  check('with no LEADS_EMAIL the FROM_EMAIL is the inbox (and the sender)', !!fromOnly && fromOnly.to === scenes.FROM && fromOnly.from === scenes.FROM, fromOnly);
  const thrown = answerOf(recording, LEAD, 'lead-notify-throws-leaks-nothing');
  check('a provider that throws is caught: the visitor still gets the 200 and the token, and the real error is only logged', thrown.status === 200 && sameValue(Object.keys(thrown.body), ['token', 'leadId']) && fxOf(LEAD, 'lead-notify-throws-leaks-nothing').notices.some((line) => line.startsWith('[SIM] notify failed:')), fxOf(LEAD, 'lead-notify-throws-leaks-nothing').notices);
  const feedbackMail = fxOf(FEEDBACK, 'feedback-notify-sends').mails[0];
  check('a feedback mails the inbox with the old subject (section, rating and a star) and body', !!feedbackMail && feedbackMail.subject === 'Tour feedback (pricing, 4★)' && feedbackMail.html === '<p>Test message</p><p>Section: pricing · Rating: 4 · Lead: ' + scenes.KNOWN_LEAD + '</p>', feedbackMail);
  check('a rating of 0 and a blank section read "page" and no star; the body reads "—"', fxOf(FEEDBACK, 'feedback-rating-zero').mails[0].subject === 'Tour feedback (pricing)' && fxOf(FEEDBACK, 'feedback-section-blank').mails[0].subject === 'Tour feedback (page, 4★)' && fxOf(FEEDBACK, 'feedback-section-blank').mails[0].html.includes('Section: — ·'));
  check('FINDING (cb-security): the e-mail SUBJECT carries `name` and `section` as sent, line breaks included (esc() is applied to the HTML body only); the provider is Resend\'s HTTP API (a JSON field, not a raw header), so what an embedded CR/LF does is its to refuse', fxOf(LEAD, 'lead-name-with-line-break').mails[0].subject === 'New tour lead: Test\r\nBcc: x@example.invalid Lead' && fxOf(FEEDBACK, 'feedback-section-with-line-break').mails[0].subject.includes('\r\nBcc: x@example.invalid'), [fxOf(LEAD, 'lead-name-with-line-break').mails[0].subject, fxOf(FEEDBACK, 'feedback-section-with-line-break').mails[0].subject]);
  const markup = fxOf(LEAD, 'lead-name-with-markup').mails[0];
  check('markup is escaped in the HTML body (< > &) but not in the subject', markup.html.includes('<b>&lt;b&gt;Test&lt;/b&gt; &amp; Lead</b>') && markup.html.includes('&lt;i&gt;Test Org&lt;/i&gt;') && markup.subject === 'New tour lead: <b>Test</b> & Lead', markup);
  const note = fxOf(FEEDBACK, 'feedback-message-with-markup').mails[0];
  check('the feedback message and section are escaped in the body too', note.html.startsWith('<p>&lt;b&gt;Test&lt;/b&gt; &amp; message</p>') && note.html.includes('Section: &lt;i&gt;pricing&lt;/i&gt;'), note);
  check('the caller never waits for the mail: every answer above is the same with the provider throwing', answerOf(recording, FEEDBACK, 'feedback-notify-throws-leaks-nothing').status === 200);
}

/** a router mounted with no body parser at all: req.body is undefined, the handler throws a TypeError inside its try, and the answer is the safe 500 (in the real stack body-parser always leaves {} there) */
async function checkNoBodyParser(router) {
  console.log('\n-- a request that arrives with no parsed body --');
  const express = require('express');
  const app = express();
  app.use(MOUNT, router);
  const bare = app.listen(0);
  const lead = await lab.send(bare.address().port, 'POST', MOUNT + '/lead', { name: 'Test Lead', email: 'lead@example.invalid' });
  const feedback = await lab.send(bare.address().port, 'POST', MOUNT + '/feedback', { message: 'Test message' });
  bare.close();
  check('with req.body undefined both writes answer the safe 500 with their one sentence (a TypeError, caught), nothing of it relayed', [lead, feedback].every((one) => one.status === 500 && one.json && one.json.error === COULD_NOT && !THROWN.test(one.text) && !/TypeError|undefined/.test(one.text)), [lead.text, feedback.text]);
  const parsed = await (async () => {
    const real = lab.appOf([{ mount: MOUNT, router }]).listen(0);
    const answer = await lab.send(real.address().port, 'POST', MOUNT + '/lead', undefined);
    real.close();
    return answer;
  })();
  check('in the real stack a POST with no body at all is the parser\'s {}: the handler\'s own 400, not a 500', parsed.status === 400 && parsed.json && parsed.json.error === 'A name and a valid email are required.', parsed.text);
}

/** the SQL, e-mails and log lines of every scenario, against a capture of the code before: the same text and the same parameters */
function compareEffects(captureFile) {
  const before = JSON.parse(fs.readFileSync(captureFile + SQL_FILE_SUFFIX, 'utf8'));
  const keys = Object.keys(before);
  const now = (key) => effects[key] && { sql: effects[key].sql.map((one) => ({ q: one.q, p: one.p })), mails: effects[key].mails, notices: effects[key].notices };
  const different = keys.filter((key) => !effects[key] || !sameValue(before[key], now(key)));
  console.log('compared ' + keys.length + ' scenarios\' effects (SQL text hash and parameters, e-mails handed to the provider, [SIM] log lines): ' + (keys.length - different.length) + ' identical, ' + different.length + ' different');
  different.forEach((key) => console.log('  ' + key));
}

process.on('unhandledRejection', (failure) => console.log('  (unhandled rejection: ' + String(failure && failure.message).slice(0, 80) + ')'));
(async () => {
  if (lab.flagValue('--freeze')) return lab.freeze(lab.flagValue('--freeze'));
  lab.installStubs();
  installProviders();
  const router = require(path.join(HERE, 'routes', 'simulator.js'));
  const routes = lab.routesOf(router, MOUNT);
  const server = lab.appOf([{ mount: MOUNT, router }]).listen(0);
  const recording = {};
  const capturing = lab.flagValue('--capture') || lab.flagValue('--compare');
  const contract = contractModule();
  const declared = capturing || !contract ? () => [] : contract.allowedStatuses();
  const scenarios = lab.scenariosOf(routes, WORLDS, extrasList());
  const tested = await lab.checkRoutes(server.address().port, scenarios, recording, declared, sources);
  undo.splice(0).reverse().forEach((restore) => restore());
  Date.now = REAL_NOW;
  const effectsKept = Object.fromEntries(Object.keys(effects).map((key) => [key, { sql: effects[key].sql.map((one) => ({ q: one.q, p: one.p })), mails: effects[key].mails, notices: effects[key].notices }]));
  if (lab.flagValue('--capture')) {
    server.close();
    fs.writeFileSync(lab.flagValue('--capture'), JSON.stringify(recording, null, 1));
    fs.writeFileSync(lab.flagValue('--capture') + SQL_FILE_SUFFIX, JSON.stringify(effectsKept, null, 1));
    console.log('captured ' + Object.keys(recording).length + ' answers over ' + Object.keys(routes).length + ' routes, and the effects of ' + Object.keys(effectsKept).length + ' scenarios');
    process.exit(0);
  }
  if (lab.flagValue('--compare')) {
    server.close();
    lab.compare(lab.flagValue('--compare'), recording);
    compareEffects(lab.flagValue('--compare'));
    process.exit(0);
  }
  server.close();
  checkWords(contract);
  checkCodesRegistered(contract);
  checkContractShape(contract, routes, router);
  checkFrozen5xx(recording);
  checkLeaks(recording);
  checkDoors(recording);
  checkToken(recording);
  checkStored(recording);
  checkOracle(recording);
  checkNotify(recording);
  await checkNoBodyParser(router);
  const legacy = JSON.parse(fs.readFileSync(lab.legacyFile, 'utf8')).routes;
  const frozen = Object.keys(legacy).filter(lab.mine).reduce((sum, route) => sum + legacy[route].answers.length, 0);
  check('every refusal recorded before the sweep is replayed against the code: ' + frozen + ' answers, each once, byte for byte', frozen >= 30, frozen);
  const coverage = lab.coverageOf(tested);
  const onDisk = JSON.parse(fs.readFileSync(TESTED_FILE, 'utf8'));
  const mine = Object.fromEntries(Object.keys(onDisk).filter(lab.mine).sort().map((route) => [route, onDisk[route]]));
  if (lab.argv.includes('--write')) {
    const others = Object.fromEntries(Object.keys(onDisk).filter((route) => !lab.mine(route)).map((route) => [route, onDisk[route]]));
    const merged = Object.assign(others, coverage);
    fs.writeFileSync(TESTED_FILE, JSON.stringify(Object.fromEntries(Object.keys(merged).sort().map((route) => [route, merged[route]])), null, 1) + '\n');
  } else {
    check('docs/contracts/api-error-tests.json lists exactly the statuses these scenarios cover for the tour routes', sameValue(mine, coverage), { onDisk: Object.keys(mine).length, covered: Object.keys(coverage).length });
  }
  console.log('\n  ' + lab.count.passed + ' checks, ' + lab.count.failed + ' failed');
  process.exit(lab.count.failed ? 1 : 0);
})().catch((failure) => {
  console.log('  FAIL  the test itself threw: ' + String(failure && failure.stack).slice(0, 400)); /* a throw inside a check must never end as a pass with no summary */
  process.exit(1);
});
