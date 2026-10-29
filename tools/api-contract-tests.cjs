#!/usr/bin/env node
/*
 * OWNS      the contract tests GENERATED from each route's own schema (API-STANDARD S18, schema-level cases that need no data): what a request with a field missing, a field of the wrong kind, or nothing at all is answered.
 *           Also docs/contracts/api-contract-results.json, the proof the register's missing_input_answer column and part of error_tests read (never filled by hand, S15).
 *           And the HARDENING cases (S33-S36): one per route for strict_input, output_allowlist, foreign_id_404 and idempotent_money_write, run on the real app with a stand-in
 *           database → docs/contracts/api-hardening-results.json, and api-hardening-evidence.json listing only the routes whose case passed (the register reads it).
 * CALLED BY tests/api-contract.test.cjs (guards.cjs) · tools/api-register.cjs (reads the results file) · by hand: --write after a schema changes.
 * FLOW      tools/load-app.cjs (server.js offline) ──▶ every route whose stack holds schemaValidate(operation) ──▶ cases from the operation's schema ──▶ run the route's OWN middleware ──▶ results per "METHOD path"
 * CARD      28-platform-and-operations/api-standard
 *
 *   node tools/api-contract-tests.cjs           run every generated case, compare with the committed results (exit 1 on a failed case or a drift)
 *   node tools/api-contract-tests.cjs --write   run, then rewrite docs/contracts/api-contract-results.json, api-hardening-results.json and api-hardening-evidence.json
 * Other cases that need data (role 403, a real 409) are T2 on realstack, not here. No database is touched and nothing leaves the machine: the schema cases run the middleware alone; the hardening cases serve the app on 127.0.0.1 inside this process.
 */
'use strict';
process.env.OUTPUT_ALLOWLIST = 'enforce'; /* the generated output_allowlist case needs the filter to cut for real */
const fs = require('fs');
const path = require('path');
const { bodySchemaOf, urlSchemaOf } = require('../middleware/validate');

const ROOT = path.resolve(__dirname, '..');
const RESULTS_FILE = path.join(ROOT, 'docs', 'contracts', 'api-contract-results.json');
const SAMPLES = { string: 'x', integer: 1, number: 1, boolean: true, array: [], object: {} };
const WRONG = { string: 12345, integer: 'abc', number: 'abc', boolean: 'maybe', array: 'abc', object: 'abc' };
const NOTHING_SENT = 'nothing sent';

/** a value that fits a schema (its first example, else the first enum value, else a sample of its type; an object carries every required property) */
function sampleOf(schema) {
  const shape = schema || {};
  if (Array.isArray(shape.examples) && shape.examples.length) return shape.examples[0]; /* a pattern a bare 'x' cannot meet names its own example */
  if (shape.enum) return shape.enum[0];
  if (shape.examples) return shape.examples[0]; /* a schema that states a valid value (JSON Schema 2020 examples) — a pattern or an anyOf the type alone cannot meet */
  const type = [].concat(shape.type || 'object')[0];
  if (type !== 'object') return SAMPLES[type];
  const made = {};
  (shape.required || []).forEach((name) => {
    made[name] = sampleOf((shape.properties || {})[name]);
  });
  return made;
}

/** the places a request carries input for this operation: { where: 'body'|'url', schema } */
function placesOf(operation) {
  const places = [];
  if (bodySchemaOf(operation)) places.push({ where: 'body', schema: bodySchemaOf(operation) });
  if (urlSchemaOf(operation)) places.push({ where: 'url', schema: urlSchemaOf(operation) });
  return places;
}

/** a request with one place replaced: the body is req.body, the url facts are req.params (path ids and query values alike) */
const requestOf = (valid, place, value) => ({ id: 'contract-test', path: '/', body: place === 'body' ? value : valid.body, params: place === 'url' ? value : valid.url, query: {} });

/** what the middleware answered: whether it let the request through, the status and the Problem body */
function runCheck(check, request) {
  const seen = { accepted: false, status: null, body: null };
  const res = {
    locals: {},
    status(code) {
      seen.status = code;
      return res;
    },
    set() {
      return res;
    },
    json(body) {
      seen.body = body;
      return res;
    }
  };
  check(request, res, () => {
    seen.accepted = true;
  });
  return seen;
}

/** the request that is fully valid for an operation: a body and url facts built from its schemas */
function validRequestOf(places) {
  const of = (where) => places.find((place) => place.where === where);
  return { body: of('body') ? sampleOf(of('body').schema) : undefined, url: of('url') ? sampleOf(of('url').schema) : {} };
}

/** the cases for one place of the request: nothing sent, each needed field left out, each field of the wrong kind */
function casesForPlace(valid, { where, schema }) {
  const required = schema.required || [];
  const whole = where === 'body' ? valid.body : valid.url;
  const refused = (name, value, fields, code) => ({ name, valid, place: where, value, expect: { fields, code } });
  const cases = [
    required.length
      ? refused(NOTHING_SENT + ': every needed ' + where + ' field is named', {}, required, 'MISSING_FIELD')
      : { name: NOTHING_SENT + ': nothing is needed, so it is let through', valid, place: where, value: {}, expect: 'accept' }
  ];
  required.forEach((name) => cases.push(refused(where + ' field ' + name + ' left out is named', Object.assign({}, whole, { [name]: undefined }), [name], 'MISSING_FIELD')));
  Object.keys(schema.properties || {}).forEach((name) => {
    const type = [].concat((schema.properties[name] || {}).type || [])[0];
    /* a url value is text already: a number is a fine id, so a string is never the wrong kind there */
    if (WRONG[type] !== undefined && !(where === 'url' && type === 'string')) cases.push(refused(where + ' field ' + name + ' of the wrong kind is named', Object.assign({}, whole, { [name]: WRONG[type] }), [name], 'WRONG_VALUE'));
  });
  return cases;
}

/** every case of one operation, the valid request first */
function casesFor(operation) {
  const places = placesOf(operation);
  const valid = validRequestOf(places);
  const first = { name: 'a valid request is let through', valid, place: 'body', value: valid.body, expect: 'accept' };
  return places.reduce((all, place) => all.concat(casesForPlace(valid, place)), [first]);
}

/** what is wrong with a refusal that was expected: the wrong status, a field not named, or a field named with the wrong code; null when it is right */
function refusalFault(expected, seen, wantStatus) {
  if (seen.status !== wantStatus) return 'answered ' + seen.status + ', expected ' + wantStatus;
  const errors = (seen.body && seen.body.errors) || [];
  const missing = expected.fields.filter((name) => !errors.some((entry) => entry.field === name));
  if (missing.length) return 'did not name ' + missing.join(', ');
  const wrongCode = errors.filter((entry) => expected.fields.includes(entry.field) && entry.code !== expected.code);
  return wrongCode.length ? 'named it with code ' + wrongCode[0].code + ', expected ' + expected.code : null;
}

/** run one case against the route's middleware; returns the sentence that failed, or null */
function judge(item, check) {
  const wantStatus = (check.schemaOptions && check.schemaOptions.status) || 422;
  const seen = runCheck(check, requestOf(item.valid, item.place, item.value));
  if (item.expect === 'accept') return seen.accepted ? null : 'was refused (' + seen.status + ') but should pass';
  return seen.accepted ? 'was let through but should be refused' : refusalFault(item.expect, seen, wantStatus);
}

/** every route whose stack holds schemaValidate: { 'METHOD path': check function } (the loader walks the real app, offline) */
function schemaRoutes(root) {
  const app = appForCases(root);
  const found = {};
  require('./load-app.cjs').leavesOf(app, true).forEach((leaf) => {
    const check = leaf.fns.find((fn) => fn && fn.schemaOperation);
    if (check) found[leaf.method + ' ' + leaf.path] = check;
  });
  return found;
}

/** the result row of one route, and the sentences for its failed cases */
function runRoute(key, check) {
  const cases = casesFor(check.schemaOperation);
  const failed = cases.map((item) => ({ item, why: judge(item, check) })).filter((outcome) => outcome.why);
  const inputCases = (failure) => failure.item.name.startsWith(NOTHING_SENT) || failure.item.name.includes('left out');
  const row = { cases: cases.length, failed: failed.length, missing_input_ok: !failed.some(inputCases), statuses: [(check.schemaOptions && check.schemaOptions.status) || 422] };
  return { row, sentences: failed.map((failure) => key + ': ' + failure.item.name + ' ' + failure.why) };
}

/** run all generated cases: { results: {key: row}, failures: [sentence] } */
function runAll(routes) {
  const results = {};
  const failures = [];
  Object.keys(routes)
    .sort()
    .forEach((key) => {
      const done = runRoute(key, routes[key]);
      results[key] = done.row;
      failures.push(...done.sentences);
    });
  return { results, failures };
}

/* ── THE HARDENING CASES (API-STANDARD S33-S36, Athi 23 Oct: every hardening column proved by a repeatable test, not by evidence JSON alone) ──
 * One generated case per route for each column it applies to:
 *   strict_input           the route's own schema check, sent a valid body plus one key it does not declare → a 400 or 422 Problem naming that key
 *   output_allowlist       the real app answers a read whose row holds an extra column (the canary) → a 2xx body without the canary
 *   foreign_id_404         another shop's id gets exactly the answer an unknown id gets, and that answer is a 404
 *   idempotent_money_write no Idempotency-Key → 422 IDEMPOTENCY_KEY_REQUIRED; the same key and body again → the same answer, marked a replay
 * The app is served on 127.0.0.1 inside this process with a signed shop token; the database is a stand-in (tools/load-app.cjs) and nothing leaves the machine. */
const CALLER_SHOP = '00000000-0000-4000-8000-00000000c0a1';
const OTHER_SHOP = '00000000-0000-4000-8000-00000000f0e1';
const PATH_ID = '00000000-0000-4000-8000-0000000001d1';
const UNKNOWN_FIELD = 'zz_unknown_field';
const CANARY = 'leak_canary';
const CASE_WAIT_MS = 4000;
const HARDENING_FILE = path.join(ROOT, 'docs', 'contracts', 'api-hardening-results.json');
const EVIDENCE_FILE = path.join(ROOT, 'docs', 'contracts', 'api-hardening-evidence.json');
const FORMAT_SAMPLES = { uuid: PATH_ID, 'date-time': '2026-01-01T00:00:00.000Z', date: '2026-01-01', email: 'case@example.com', uri: 'https://example.com/case' };
const NO_ROWS = { rows: [], rowCount: 0 };

/** what the stand-in database holds now: 'none' (no world: every read is empty), 'missing' (nothing exists), 'own' (the caller's row), 'foreign' (another shop's row) */
const world = { mode: 'none', fields: {}, keys: new Map() };

/** a value that fits one field's schema, its format honoured (an id that must be a uuid gets one) */
const fittingValue = (schema) => (schema && FORMAT_SAMPLES[schema.format]) || sampleOf(schema || { type: 'string' });

/** the columns a row needs by their names: the shop columns hold the row's owner, ids, dates, amounts, flags and bags a value of their kind */
const COLUMN_KINDS = [
  [/^(entity_id|identity_id|owner_id|owner_entity_id|shop_id|parent_entity_id|from_entity_id|business_id)$/i, (owner) => owner],
  [/(^|_)id$/i, () => PATH_ID],
  [/(_at|_on|date|_time|expires|since|until)$/i, () => FORMAT_SAMPLES['date-time']],
  [/(amount|total|qty|quantity|count|price|rate|balance|paise|cents|percent|version|seq|score|number)$/i, () => 1],
  [/^(is|has|can|was|allow)_|(_ok|enabled|active|approved|sealed|paid)$/i, () => false],
  [/(lines|items|rows|list|tags|ids)$/i, () => []],
  [/(_json|flags|meta|metadata|data|payload|settings|config|details|extra)$/i, () => ({})]
];

/** one column's value: the owner for a shop column, the answer schema's sample for a declared field, else a value of the kind its name says */
function columnValue(name, schema, owner) {
  const kind = COLUMN_KINDS.find(([pattern]) => pattern.test(name));
  if (kind && kind[0] === COLUMN_KINDS[0][0]) return owner;
  if (schema) return fittingValue(schema);
  return kind ? kind[1](owner) : 'x';
}

/** a row that answers ANY column a handler reads; its own keys are the answer's declared fields plus the canary, so a handler that passes the row through whole leaks the canary */
function rowOf(fields, owner) {
  const keys = Object.keys(fields).concat(CANARY);
  const valueOf = (name) => (name === CANARY ? 'this column is not in the answer schema' : columnValue(name, fields[name], owner));
  const plain = (name) => typeof name === 'symbol' || name in Object.prototype || name === 'then' || name === 'toJSON';
  return new Proxy(
    {},
    {
      get: (target, name) => (plain(name) ? Object.prototype[name] : valueOf(name)),
      has: (target, name) => typeof name === 'string',
      ownKeys: () => keys,
      getOwnPropertyDescriptor: (target, name) => ({ value: valueOf(name), enumerable: true, configurable: true, writable: true })
    }
  );
}

/** the idempotency_key table (b109) of middleware/idempotency.js, held in memory: claim, read back, settle, drop */
function keyTableAnswer(sql, params) {
  const verb = sql.trim().split(/\s+/)[0].toUpperCase();
  const slot = params[0] + '\n' + (verb === 'SELECT' && params.length === 4 ? params[2] : params[1]);
  const held = world.keys.get(slot);
  if (verb === 'SELECT') return held ? { rows: [Object.assign({ expired: false }, held)], rowCount: 1 } : NO_ROWS;
  if (verb === 'INSERT') return claimKey(slot, held, params);
  if (held) settleKey(verb, sql, slot, held, params);
  return { rows: [], rowCount: held ? 1 : 0 };
}

/** INSERT: the key is claimed in progress, unless someone holds it already */
function claimKey(slot, held, params) {
  if (held) return NO_ROWS;
  world.keys.set(slot, { idem_key: params[1], req_hash: params[4], state: 'in_progress' });
  return { rows: [{ idem_key: params[1] }], rowCount: 1 };
}

/** UPDATE records the settled answer; DELETE drops the key (a delete of an in-progress claim leaves a settled one alone) */
function settleKey(verb, sql, slot, held, params) {
  if (verb === 'UPDATE') Object.assign(held, { state: 'done', status: params[2], response: JSON.parse(params[3]) });
  else if (verb === 'DELETE' && !(/in_progress/.test(sql) && held.state !== 'in_progress')) world.keys.delete(slot);
}

/** does the world's row exist for this statement: an insert always makes one; another shop's row is hidden from the caller's RLS scope and from any statement that filters by the caller's id */
function rowVisible(sql, params, entity) {
  if (/^\s*insert\b/i.test(sql)) return true;
  if (world.mode === 'own') return true;
  return world.mode === 'foreign' && entity !== CALLER_SHOP && !params.includes(CALLER_SHOP);
}

/** the stand-in database's answer to every statement (tools/load-app.cjs stubDatabase answer) */
function worldAnswer(sql, params, entity) {
  if (/\bidempotency_key\b/i.test(sql)) return keyTableAnswer(sql, params);
  if (world.mode === 'none' || !rowVisible(sql, params, entity)) return NO_ROWS;
  const returnsRows = /^\s*(select|with)\b/i.test(sql) || /\breturning\b/i.test(sql);
  return { rows: returnsRows ? [rowOf(world.fields, world.mode === 'foreign' ? OTHER_SHOP : CALLER_SHOP)] : [], rowCount: 1 };
}

/** every field an answer schema declares, nested ones too (a list's items are rows), as { name: schema } */
function declaredFields(schema, into, depth) {
  const found = into || {};
  if (!schema || (depth || 0) > 3) return found;
  Object.keys(schema.properties || {}).forEach((name) => {
    if (!(name in found)) found[name] = schema.properties[name];
    declaredFields(schema.properties[name], found, (depth || 0) + 1);
  });
  return declaredFields(schema.items, found, (depth || 0) + 1);
}

/** the url of a route with its path ids filled from its url schema (an id-like name gets a uuid), and its required query values */
function urlOf(leaf, operation) {
  const urlSchema = urlSchemaOf(operation) || { properties: {}, required: [] };
  /* an id-like name whose schema states no shape (contract-kit's default { type: 'string', minLength: 1 }) gets a uuid too: a route that
     refuses a non-uuid id at its door (POST /chits/:chit_id/payment) is then reached, as it is by a real caller */
  const stated = (schema) => schema && (schema.format || schema.pattern || schema.enum || schema.examples);
  const valueFor = (name) => (stated(urlSchema.properties[name]) || (urlSchema.properties[name] && !/id$/i.test(name)) ? fittingValue(urlSchema.properties[name]) : /id$/i.test(name) ? PATH_ID : 'x');
  const named = [];
  const filled = leaf.path.replace(/:(\w+)/g, (match, name) => named.push(name) && encodeURIComponent(valueFor(name)));
  const query = (urlSchema.required || []).filter((name) => !named.includes(name)).map((name) => name + '=' + encodeURIComponent(valueFor(name)));
  return filled + (query.length ? '?' + query.join('&') : '');
}

/** the body a valid request carries (its schema's sample), or none for a route that takes none */
const bodyFor = (leaf, operation) => (bodySchemaOf(operation) ? sampleOf(bodySchemaOf(operation)) : ['POST', 'PUT', 'PATCH'].includes(leaf.method) ? {} : undefined);

/** parse an answer's text as JSON when it is JSON */
function parsedBody(text) {
  try {
    return text ? JSON.parse(text) : null;
  } catch (notJson) {
    return text;
  }
}

/** one request to the app on 127.0.0.1: { status, headers, body }; no answer within CASE_WAIT_MS is status 0 */
function sendCase(port, { method, url, body, headers }) {
  const text = body === undefined ? '' : JSON.stringify(body);
  return new Promise((resolve) => {
    const sent = require('http').request({ host: '127.0.0.1', port, method, path: url, headers: Object.assign({ 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) }, headers) }, (answer) => {
      const parts = [];
      answer.on('data', (part) => parts.push(part));
      answer.on('end', () => resolve({ status: answer.statusCode, headers: answer.headers, body: parsedBody(Buffer.concat(parts).toString()) }));
    });
    sent.setTimeout(CASE_WAIT_MS, () => sent.destroy(new Error('no answer within ' + CASE_WAIT_MS + ' ms')));
    sent.on('error', (failure) => resolve({ status: 0, headers: {}, body: failure.message }));
    sent.end(text);
  });
}

/** the shop's token every case carries (an entity token, signed with the walk's secret) */
const shopToken = () => require('jsonwebtoken').sign({ identity_id: CALLER_SHOP, identity_type: 'entity', bridge_id: 'CB-CASE', display_name: 'Case shop' }, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: '1h' });

/** play one request in a world: { status, headers, body } */
async function playIn(mode, target, extra) {
  Object.assign(world, { mode, fields: target.fields });
  const headers = Object.assign({ authorization: 'Bearer ' + target.token }, extra && extra.headers);
  return sendCase(target.port, { method: target.leaf.method, url: target.url, body: target.body, headers });
}

/** does any key of a JSON value, at any depth, equal the name */
const holdsKey = (value, name) => !!value && typeof value === 'object' && Object.keys(value).some((key) => key === name || holdsKey(value[key], name));

/** an answer without the parts that differ on every request (its request id) */
const comparable = (answer) => JSON.stringify({ status: answer.status, body: answer.body && typeof answer.body === 'object' ? Object.assign({}, answer.body, { request_id: undefined }) : answer.body });

/** strict_input: the route's schema check refuses a valid body plus one undeclared key, with a 400 or 422 Problem naming that key; null when it does */
function strictInputCase(check) {
  if (!check || !bodySchemaOf(check.schemaOperation)) return 'the route has no body schema check, so an unknown key is never looked at';
  const valid = validRequestOf(placesOf(check.schemaOperation));
  const seen = runCheck(check, requestOf(valid, 'body', Object.assign({}, valid.body, { [UNKNOWN_FIELD]: 'x' })));
  if (seen.accepted) return 'let ' + UNKNOWN_FIELD + ' through';
  if (![400, 422].includes(seen.status)) return 'answered ' + seen.status + ', expected 400 or 422';
  const named = ((seen.body && seen.body.errors) || []).some((entry) => entry.field === UNKNOWN_FIELD);
  return named && seen.body.type ? null : 'refused without naming ' + UNKNOWN_FIELD + ' in a Problem';
}

/** output_allowlist: a 2xx answer, from a row that holds the canary column, does not hold the canary */
async function outputAllowlistCase(target) {
  const answer = await playIn('own', target);
  if (answer.status < 200 || answer.status > 299) return 'not reached: answered ' + answer.status;
  return holdsKey(answer.body, CANARY) ? 'the answer holds ' + CANARY + ', a column the answer schema does not list' : null;
}

/** foreign_id_404: another shop's id is answered exactly as an unknown id, and that is a 404 (while the caller's own id is found, so the 404 is about whose id it is) */
async function foreignIdCase(target) {
  const ownAnswer = await playIn('own', target);
  if (ownAnswer.status === 404) return "not reached: the caller's own id answered 404 too";
  const missing = await playIn('missing', target);
  if (missing.status !== 404) return 'an unknown id answered ' + missing.status + ', not 404';
  const foreign = await playIn('foreign', target);
  return comparable(foreign) === comparable(missing) ? null : "another shop's id answered " + foreign.status + ', not the unknown id\'s 404';
}

/** idempotent_money_write: no key is refused 422 IDEMPOTENCY_KEY_REQUIRED; a key sent twice with the same body gets the same answer, marked a replay */
async function idempotentCase(target) {
  const bare = await playIn('own', target);
  if (bare.status !== 422 || !bare.body || bare.body.code !== 'IDEMPOTENCY_KEY_REQUIRED') return 'no key answered ' + bare.status + ', not 422 IDEMPOTENCY_KEY_REQUIRED';
  const keyed = { headers: { 'idempotency-key': 'case-' + target.leaf.method + target.url } };
  const first = await playIn('own', target, keyed);
  const again = await playIn('own', target, keyed);
  if (again.headers['x-idempotent-replay'] !== 'true') return 'the second send with the same key was run again, not replayed';
  return JSON.stringify([first.status, first.body]) === JSON.stringify([again.status, again.body]) ? null : 'the replay answered differently from the first send';
}

/** which hardening cases a route gets: { column: run } for each column that applies to it (tools/api-register.cjs hardeningApplies) */
function casesOfRoute(leaf, applies, check) {
  const cases = {};
  if (applies.strict_input) cases.strict_input = async () => strictInputCase(check);
  if (applies.output_allowlist) cases.output_allowlist = outputAllowlistCase;
  if (applies.foreign_id_404) cases.foreign_id_404 = foreignIdCase;
  if (applies.idempotent_money_write) cases.idempotent_money_write = idempotentCase;
  return cases;
}

/** run every hardening case of every route on an app already served at port: { results: {key: {column: {pass, why?}}}, evidence: {key: {column: true}} } */
async function runHardening(app, port, facts) {
  const results = {};
  const token = shopToken();
  for (const leaf of facts.leaves) {
    const key = leaf.method + ' ' + leaf.path;
    const operation = facts.operations[key];
    const target = { leaf, port, token, url: urlOf(leaf, operation), body: bodyFor(leaf, operation), fields: facts.fieldsOf(operation) };
    const cases = casesOfRoute(leaf, facts.appliesOf(leaf, operation), leaf.fns.find((fn) => fn && fn.schemaOperation));
    for (const column of Object.keys(cases)) {
      world.keys.clear();
      const fault = await cases[column](column === 'output_allowlist' ? exampleTarget(target, key) : target);
      (results[key] = results[key] || {})[column] = fault ? { pass: false, why: fault } : { pass: true };
    }
  }
  return { results, evidence: evidenceOf(results) };
}

/** output_allowlist plays a request known to reach the route's success answer when the derived shape (tools/api-allowlist.cjs → docs/contracts/api-output-shapes.json) holds one: a body of empty fields is often refused by the handler's own rule, which is no answer to look at */
function exampleTarget(target, key) {
  const shape = require('../lib/output-allowlist').shapeOf(key);
  return shape && shape.example ? Object.assign({}, target, { url: shape.example.url, body: shape.example.body }) : target;
}

/** the routes whose generated cases passed, per column: the only thing docs/contracts/api-hardening-evidence.json may say */
function evidenceOf(results) {
  const evidence = {};
  Object.keys(results).forEach((key) => {
    const passed = Object.keys(results[key]).filter((column) => results[key][column].pass);
    if (passed.length) evidence[key] = Object.fromEntries(passed.map((column) => [column, true]));
  });
  return evidence;
}

/** the facts the cases need from the register: each route's operation, which columns apply, and the fields its answer declares */
function hardeningFacts(app) {
  const register = require('./api-register.cjs');
  const scope = register.hardeningScope();
  const seen = new Set();
  return {
    leaves: require('./load-app.cjs').leavesOf(app, true).filter((leaf) => !seen.has(leaf.method + ' ' + leaf.path) && seen.add(leaf.method + ' ' + leaf.path)),
    operations: register.operationsOfApp(),
    appliesOf: (leaf, operation) => register.hardeningApplies(leaf, operation, scope),
    fieldsOf: (operation) => register.successSchemas(operation).reduce((fields, schema) => declaredFields(schema, fields), {})
  };
}

/** serve the app on a free port of 127.0.0.1 for the cases, logs quiet; runCases(port) → its result; the server closes after */
async function servedFor(app, runCases) {
  const server = require('http').createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const loud = ['log', 'info', 'warn', 'error'].map((name) => [name, console[name]]);
  loud.forEach(([name]) => (console[name] = () => {}));
  try {
    return await runCases(server.address().port);
  } finally {
    loud.forEach(([name, keep]) => (console[name] = keep));
    server.close();
  }
}

/** every hardening case of the real app: { results, evidence } */
async function hardeningCases(root) {
  const app = appForCases(root || ROOT);
  return servedFor(app, (port) => runHardening(app, port, hardeningFacts(app)));
}

/** the real app loaded once for every generated case: the stand-in database plays the world, limits are lifted, and nothing may call out */
function appForCases(root) {
  ['RATE_LIMIT_MAX', 'AUTH_RATE_LIMIT_MAX', 'CHECK_LOGIN_RATE_LIMIT_MAX', 'CATALOGUE_RATE_LIMIT_MAX', 'ASSIST_RATE_LIMIT_MAX'].forEach((name) => (process.env[name] = '100000'));
  global.fetch = async () => {
    throw new Error('the generated cases make no outbound call');
  };
  const loader = require('./load-app.cjs');
  loader.stubDatabase(root, worldAnswer);
  return loader.loadApp(root);
}

const HARDENING_ABOUT = 'generated by node tools/api-contract-tests.cjs --write: one case per route for each hardening column that applies (API-STANDARD S33-S36), run on the real app with a stand-in database; api-hardening-evidence.json lists only the cases that pass';
const EVIDENCE_ABOUT = "Evidence for the hardening columns (API-STANDARD S33-S36): routes['METHOD /path'][column] = true only when that route's generated case passed (tools/api-contract-tests.cjs, results in api-hardening-results.json). Written by --write, never by hand.";
const hardeningTextOf = (results) => JSON.stringify({ version: 1, about: HARDENING_ABOUT, routes: results }, null, 1) + '\n';
const evidenceTextOf = (evidence) => JSON.stringify({ about: EVIDENCE_ABOUT, routes: evidence }, null, 1) + '\n';

const ABOUT = 'generated by node tools/api-contract-tests.cjs --write: the schema-level contract cases of every route that validates its input against its own schema (API-STANDARD S18)';
const textOf = (results) => JSON.stringify({ version: 1, about: ABOUT, routes: results }, null, 1) + '\n';

/** a committed file equals what the cases give, or --write rewrites it; the sentence for a drift, else null */
function keptOrWritten(file, text, writing) {
  if (writing) fs.writeFileSync(file, text);
  else if ((fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '') !== text) return path.relative(ROOT, file).split(path.sep).join('/') + ' differs from what the cases give: run node tools/api-contract-tests.cjs --write';
  return null;
}

/** one line per hardening column: how many routes it applies to, and how many passed their generated case */
function hardeningLines(results) {
  const tally = {};
  Object.values(results).forEach((row) =>
    Object.keys(row).forEach((column) => {
      tally[column] = tally[column] || { ran: 0, passed: 0 };
      tally[column].ran++;
      tally[column].passed += row[column].pass ? 1 : 0;
    })
  );
  return Object.keys(tally)
    .sort()
    .map((column) => '  hardening ' + column + ': ' + tally[column].passed + ' of ' + tally[column].ran + ' routes pass');
}

/** command line: run, compare with the committed files, print the one "<n> passed, <m> failed" line and the hardening tally (a hardening case that fails is a route without evidence, not a failed run) */
async function main(argv) {
  const { results, failures } = runAll(schemaRoutes(ROOT));
  const total = Object.keys(results).reduce((sum, key) => sum + results[key].cases, 0);
  const hardening = await hardeningCases(ROOT);
  const writing = argv.includes('--write') && !failures.length;
  const drifts = [
    keptOrWritten(RESULTS_FILE, textOf(results), writing),
    keptOrWritten(HARDENING_FILE, hardeningTextOf(hardening.results), writing),
    keptOrWritten(EVIDENCE_FILE, evidenceTextOf(hardening.evidence), writing)
  ].filter(Boolean);
  failures.push(...drifts);
  failures.forEach((sentence) => console.log('  FAIL ' + sentence));
  hardeningLines(hardening.results).forEach((line) => console.log(line));
  console.log(Math.max(0, total - failures.length) + ' passed, ' + failures.length + ' failed');
  process.exitCode = failures.length ? 1 : 0;
}

if (require.main === module) main(process.argv.slice(2)).then(() => process.exit(process.exitCode || 0));
module.exports = { casesFor, judge, runCheck, runAll, sampleOf, placesOf, schemaRoutes, textOf, RESULTS_FILE, hardeningCases, runHardening, servedFor, appForCases, hardeningTextOf, evidenceTextOf, world, CANARY, CALLER_SHOP, HARDENING_FILE, EVIDENCE_FILE };
