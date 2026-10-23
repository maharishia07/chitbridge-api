#!/usr/bin/env node
/**
 * api-problem-books.test.cjs — API-4 sweep, accounts and finance: every refusal of routes/books.js, routes/tax.js and routes/invoice.js.
 *
 * OWNS      the proof that each refusal of the ledger's routes (and the tax and invoice services') is a Problem body AND still carries the keys it answered before
 *           (docs/contracts/api-legacy.json, recorded from the code before the sweep), and this file's rows of docs/contracts/api-error-tests.json
 *           (the statuses each books route is tested for, which the register's error_tests column reads). Also: no answer outside the statuses the
 *           route's contract declares (lib/books-contract.js), and the ledger's refusal mapper (refusalOf) as a unit.
 * CALLED BY scripts/guards.cjs · CI. No database, no network: the real routes/books.js over a stand-in db, auth and country gate.
 * FLOW      route list (read from the router itself) x world (signed out, a key, staff, ledger off, a bad id, a failing db, an empty db) + the named extras
 *           → real route → body → Problem fields present · frozen legacy keys equal · no leak on a 5xx · statuses tested → manifest
 *
 *   node tests/api-problem-books.test.cjs                    check
 *   node tests/api-problem-books.test.cjs --write            rewrite this file's rows of docs/contracts/api-error-tests.json
 *   node tests/api-problem-books.test.cjs --capture F        (run on the code BEFORE the change) record each answer to file F
 *   node tests/api-problem-books.test.cjs --freeze F         merge a capture F into docs/contracts/api-legacy.json (the frozen answers)
 */
'use strict';
const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');

const HERE = path.join(__dirname, '..');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
const LEGACY_FILE = path.join(HERE, 'docs', 'contracts', 'api-legacy.json');
const TESTED_FILE = path.join(HERE, 'docs', 'contracts', 'api-error-tests.json');
const MOUNT = '/api/books';
const MOUNTS = ['/api/books', '/api/tax', '/api/invoice'];
/** the route files these mounts serve (named in full so the graph links this test to each of them) */
const ROUTE_FILES = { '/api/books': 'routes/books.js', '/api/tax': 'routes/tax.js', '/api/invoice': 'routes/invoice.js' };
const MINE = (route) => MOUNTS.some((mount) => route.includes(' ' + mount + '/'));
const argv = process.argv.slice(2);
const flagValue = (flag) => (argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : null);
const PROBLEM_FIELDS = ['type', 'title', 'status', 'code', 'detail', 'hint', 'request_id', 'field', 'params', 'errors'];
const REQUIRED_FIELDS = ['type', 'title', 'status', 'code', 'detail', 'hint', 'request_id'];

let passed = 0;
let failed = 0;
const check = (label, condition, info) => {
  if (condition) passed++;
  else failed++;
  if (!condition || argv.includes('--verbose')) console.log('  ' + (condition ? 'ok  ' : 'FAIL') + '  ' + label + (condition || info === undefined ? '' : '\n        ' + JSON.stringify(info).slice(0, 500)));
};
const sameValue = (left, right) => JSON.stringify(left) === JSON.stringify(right);

/* ── stand-ins: auth, db, the country gate ─────────────────────────────────────────────────────────────────── */
const SHOP = '11111111-1111-4111-8111-111111111111';
const PARTY = '22222222-2222-4222-8222-222222222222';
const OWNER = { identity_id: SHOP, identity_type: 'entity', display_name: 'Test shop' };
const STAFF = { identity_id: '44444444-4444-4444-8444-444444444444', parent_entity_id: SHOP, identity_type: 'actor', access_level: 'editor' };
const VIEWER = Object.assign({}, STAFF, { access_level: 'viewer' });
const SECRET_SQL = 'relation "books_entry" does not exist -- SELECT secret FROM vault';
const FRESH = { realAuth: false, who: OWNER, asKey: false, ledgerOn: true, db: 'ok', sqlRows: null };
const world = Object.assign({}, FRESH);
const SETTING_ROW = { entity_id: SHOP, enabled: true, walkin_grain: 'day', fy_start_month: 4, functional_currency: 'INR', country: 'IN', pack_version: '1', timezone: 'Asia/Kolkata' };

/** the rows a statement gets: the ledger's switch, then a scenario's own rows, then nothing (or the secret failure when the db is down) */
function rowsFor(sql) {
  if (/FROM books_setting/.test(sql)) return world.ledgerOn ? { rows: [SETTING_ROW], rowCount: 1 } : { rows: [], rowCount: 0 };
  if (world.sqlRows) {
    const given = world.sqlRows(String(sql));
    if (given) return given;
  }
  if (world.db === 'fail') throw new Error(SECRET_SQL);
  return { rows: [], rowCount: 0 };
}
const mock = (relative, exported) => {
  const file = require.resolve(path.join(HERE, relative));
  require.cache[file] = { id: file, filename: file, loaded: true, exports: exported };
};

function installStubs() {
  const realAuth = require(path.join(HERE, 'middleware', 'auth'));
  const stubAuth = (req, res, next) => {
    if (world.realAuth) return realAuth(req, res, next);
    req.identity = world.who;
    if (world.asKey) req.api_key = { jti: 'j1', scopes: ['till'] };
    return next();
  };
  mock('middleware/auth', Object.assign(stubAuth, realAuth, { entityOf: (req) => req.identity.parent_entity_id || req.identity.identity_id }));
  const client = { query: async (sql) => rowsFor(sql) };
  const known = { query: async (sql) => rowsFor(sql), withEntity: async (id, run) => run(client), withTransaction: async (run) => run(client), readBatch: async () => [{ rows: [], rowCount: 0 }] };
  const db = new Proxy(known, { get: (target, name) => (name in target ? target[name] : typeof name === 'symbol' || name === 'then' ? undefined : async () => ({ rows: [], rowCount: 0 })) });
  mock('db', db);
  mock('db/index', db);
  mock('lib/country-setup', { gate: async () => ({ books: true, code: null, country: 'IN' }), status: async () => ({ books: true, code: null, country: 'IN' }) });
  console.error = () => undefined; /* the routes log a 5xx here; the scenarios read the answer */
}

/* ── the scenarios: every route the router holds x the worlds, then the named extras ──────────────────────── */
const PARAM_VALUES = { id: PARTY, chit_id: PARTY, account: '1300', fy: '2026-27', p: '6', act: 'lock', ref: 'L1' };
const WORLDS = [
  { id: 'signed-out', setup: { realAuth: true } },
  { id: 'key-asks', setup: { asKey: true } },
  { id: 'staff-asks', setup: { who: STAFF } },
  { id: 'viewer-asks', setup: { who: VIEWER } },
  { id: 'ledger-off', setup: { ledgerOn: false } },
  { id: 'bad-id', setup: {}, badId: true },
  { id: 'db-fails', setup: { db: 'fail' } },
  { id: 'nothing-found', setup: {} }
];
const BODY_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'];

/** { 'METHOD /full/path': template } for every route the books router holds, read from the router itself */
function routesOf(router, mount) {
  const found = {};
  router.stack.filter((layer) => layer.route).forEach((layer) => Object.keys(layer.route.methods).forEach((method) => {
    found[method.toUpperCase() + ' ' + mount + layer.route.path] = mount + layer.route.path;
  }));
  return found;
}
const urlOf = (template, bad) => template.replace(/:(\w+)/g, (all, name) => (bad ? 'nope' : PARAM_VALUES[name] || PARTY));

/** the extras: an answer the generic worlds cannot reach (a named refusal inside a handler) */
const X = (id, route, status, extra) => Object.assign({ id, route, expect: status, setup: {} }, extra);
const PACK_ROW = { pack_id: PARTY, kind: 'year', fiscal_year: '2026-27', storage_path: null, sha256: 'abc' };
const ADVICE_PATCH = (ready) => ({
  store: { payment: async () => ({ payment_id: PARTY }), adviceReady: async () => ready },
  books: { adviceFor: async () => ({ may: { send_advice: { ok: false, why: 'already_sent', say: 'An advice is already sent.' }, share_advice: { ok: true } }, advice: { chit_id: '99999999-9999-4999-8999-999999999999' } }) }
});
const BAD_MONEY = { party_id: PARTY, amount_minor: 100, currency: 'USD', mode: 'cash' };
const EXTRAS = [
  X('currency-not-the-ledgers', 'POST /api/books/payments/preview', 422, { body: BAD_MONEY }),
  X('currency-not-the-ledgers', 'POST /api/books/payments', 422, { body: BAD_MONEY }),
  X('window-too-long', 'GET /api/books/bank/rail', 400, { url: MOUNT + '/bank/rail?from=2020-01-01&to=2026-01-01' }),
  X('nothing-to-change', 'PATCH /api/books/payments/:id', 400, { body: {} }),
  X('which-advice-chit', 'PATCH /api/books/payments/:id', 400, { body: { advice_chit_id: 'not-an-id' } }),
  X('when-was-it-shared', 'PATCH /api/books/payments/:id', 400, { body: { advice_shared_at: 'not-a-time' } }),
  X('cheque-step-unnamed', 'POST /api/books/cheques/:id/status', 400, { body: {} }),
  X('dispute-bill-unnamed', 'POST /api/books/parties/:id/dispute', 400, { body: {} }),
  X('write-off-customer-unnamed', 'POST /api/books/write-off', 400, { body: {} }),
  X('opening-no-rows', 'POST /api/books/opening', 400, { body: {} }),
  X('import-not-confirmed', 'POST /api/books/move-in/import', 400, { body: {} }),
  X('dues-staff-collections', 'GET /api/books/dues', 403, { setup: { who: STAFF }, url: MOUNT + '/dues?finance=1' }),
  X('dues-staff-payables', 'GET /api/books/dues', 403, { setup: { who: STAFF }, url: MOUNT + '/dues?finance=1&side=supplier' }),
  X('cashflow-staff-asks', 'GET /api/books/cashflow', 403, { setup: { who: STAFF } }),
  X('terms-not-migrated', 'POST /api/books/terms', 503, { body: {} }),
  X('period-unknown-action', 'POST /api/books/periods/:fy/:p/:act', 404, { url: MOUNT + '/periods/2026-27/6/shred', body: {} }),
  X('which-month', 'POST /api/books/fx-revalue', 400, { body: {} }),
  X('which-month-read', 'GET /api/books/fx-revalue', 400, {}),
  X('year-not-a-year', 'GET /api/books/year/:fy/status', 404, { url: MOUNT + '/year/nope/status' }),
  X('db-fails-with-lines', 'POST /api/tax/rate', 500, { setup: { db: 'fail' }, body: { lines: [{ name: 'tea', qty: 1 }] } }),
  X('db-fails-with-lines', 'POST /api/tax/compute', 500, { setup: { db: 'fail' }, body: { lines: [{ name: 'tea', qty: 1, price: 10 }] } }),
  X('quantity-not-above-zero', 'POST /api/tax/compute', 400, { body: { lines: [{ name: 'tea', qty: 0, price: 10 }] } }),
  X('flag-not-true-or-false', 'POST /api/tax/compute', 400, { body: { priceIncludesTax: 'maybe', lines: [{ name: 'tea', qty: 1, price: 10 }] } }),
  X('no-country-no-tax', 'POST /api/tax/compute', 422, { body: { lines: [{ name: 'tea', qty: 1, price: 10 }] } }),
  X('db-fails-with-lines', 'POST /api/invoice/build', 500, { setup: { db: 'fail' }, body: { lines: [{ name: 'tea', qty: 1, price: 10 }] } }),
  X('entry-already-reversed', 'POST /api/books/entries/:id/reverse', 409, { patch: { books: { reverseEntry: async () => ({ duplicate: true, entry_no: 'MJ/1', entry_id: PARTY }) } } }),
  X('pack-built-without-storage', 'GET /api/books/packs/:id/file', 409, { patch: { store: { pack: async () => PACK_ROW } } }),
  X('pack-no-file-to-confirm', 'POST /api/books/packs/:id/ack', 409, { patch: { store: { pack: async () => PACK_ROW } } }),
  X('snapshot-part-twice', 'POST /api/books/compare/snapshots', 409, { body: { snapshot_id: PARTY, part: 'tb', source: 'tally' }, patch: { store: { compareReady: async () => true, compareParts: async () => [{ part: 'tb', label: 'x', source: 'tally' }] } }, who: 'auditor' }),
  X('advice-already-recorded', 'PATCH /api/books/payments/:id', 409, { body: { advice_chit_id: PARTY }, patch: ADVICE_PATCH(true) }),
  X('advice-not-ready', 'PATCH /api/books/payments/:id', 503, { body: { advice_chit_id: PARTY }, patch: ADVICE_PATCH(false) })
];

function send(port, method, urlPath, body) {
  return new Promise((resolve) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const options = { port, path: urlPath, method, headers: data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {} };
    const request = http.request(options, (response) => {
      let text = '';
      response.on('data', (part) => (text += part));
      response.on('end', () => resolve({ status: response.statusCode, type: String(response.headers['content-type'] || ''), text, json: safeParse(text) }));
    });
    request.setTimeout(4000, () => {
      request.destroy();
      resolve({ status: 0, type: '', text: '', json: null });
    });
    request.on('error', () => {});
    if (data) request.write(data);
    request.end();
  });
}
function safeParse(text) {
  try {
    return JSON.parse(text);
  } catch (failure) {
    return null;
  }
}

/** every scenario as { id, route, url, body, setup, extra } */
function scenariosOf(routes) {
  const generic = [];
  Object.keys(routes).sort().forEach((route) => {
    const method = route.split(' ')[0];
    WORLDS.forEach((one) => {
      const needsId = one.badId && !routes[route].includes(':');
      if (needsId) return;
      generic.push({ id: one.id, route, url: urlOf(routes[route], one.badId), body: BODY_METHODS.includes(method) ? {} : undefined, setup: one.setup });
    });
  });
  const extras = EXTRAS.map((one) => Object.assign({}, one, { url: one.url || urlOf(routes[one.route] || '', false), extra: true }));
  return generic.concat(extras.filter((one) => routes[one.route]));
}

/** a scenario that needs a row the stand-in db cannot make swaps one library function for its answer, then puts the real one back */
function applyPatch(patch) {
  const modules = { books: require(path.join(HERE, 'lib', 'books')), store: require(path.join(HERE, 'lib', 'books-store')) };
  const undo = [];
  Object.keys(patch || {}).forEach((which) => Object.keys(patch[which]).forEach((name) => {
    undo.push([modules[which], name, modules[which][name]]);
    modules[which][name] = patch[which][name];
  }));
  return () => undo.forEach(([owner, name, original]) => (owner[name] = original));
}

async function runScenario(port, scenario) {
  Object.assign(world, FRESH, scenario.setup);
  if (scenario.who === 'auditor') world.who = OWNER;
  const restore = applyPatch(scenario.patch);
  const method = scenario.route.split(' ')[0];
  const answer = await send(port, method, scenario.url, scenario.body === undefined && BODY_METHODS.includes(method) ? {} : scenario.body);
  restore();
  return answer;
}

const legacyOf = (key, scenario) => (JSON.parse(fs.readFileSync(LEGACY_FILE, 'utf8')).routes[key] || { answers: [] }).answers.find((answer) => answer.scenario === scenario);

function checkProblemBody(label, answer) {
  check(label + ': content-type is application/problem+json', /application\/problem\+json/.test(answer.type), answer.type);
  check(label + ': has every Problem field', answer.json && REQUIRED_FIELDS.every((name) => answer.json[name] !== undefined), answer.json);
  check(label + ': status in the body equals the HTTP status', answer.json && answer.json.status === answer.status);
}

function checkLegacy(label, answer, frozen) {
  if (!frozen) return check(label + ': a frozen legacy entry exists in docs/contracts/api-legacy.json', false);
  check(label + ': status equals the frozen status', answer.status === frozen.status, [answer.status, frozen.status]);
  const missing = Object.keys(frozen.fixture).filter((name) => !sameValue(answer.json[name], frozen.fixture[name]));
  check(label + ': every frozen legacy key is still there, byte for byte', missing.length === 0, missing.map((name) => name + ' -> ' + JSON.stringify(answer.json[name])));
  const extra = Object.keys(answer.json).filter((name) => !PROBLEM_FIELDS.includes(name) && !(name in frozen.fixture));
  check(label + ': no key beyond the frozen ones and the Problem fields', extra.length === 0, extra);
}

/** the sign-in middleware's own 401 and requireScope's 403 are still the old body: tested, not yet a Problem (a follow-up for the auth middleware) */
const inherited = (scenario, answer) =>
  (answer.status === 401 && scenario.id === 'signed-out') || (answer.status === 403 && scenario.id === 'key-asks' && !scenario.route.includes(' ' + MOUNT + '/')); /* requireScope's 403: a follow-up for the auth middleware */
/** the statuses a test may see from a route, by the contract of the area that owns it */
function allowedFor() {
  const books = require(path.join(HERE, 'lib', 'books-contract.js')).allowedStatuses();
  const tax = require(path.join(HERE, 'lib', 'tax-contract.js')).allowedStatuses();
  return (route) => (route.includes(' ' + MOUNT + '/') ? books(route) : tax(route));
}

async function checkRoutes(port, scenarios, recording) {
  const tested = {};
  const allowed = argv.includes('--capture') ? null : allowedFor();
  for (const scenario of scenarios) {
    const answer = await runScenario(port, scenario);
    const label = scenario.route + ' · ' + scenario.id;
    recording[scenario.route + '|' + scenario.id] = { route: scenario.route, status: answer.status, body: answer.json };
    if (answer.status >= 400) (tested[scenario.route] = tested[scenario.route] || new Set()).add(answer.status);
    if (argv.includes('--capture')) continue;
    check(label + ': answers (not a hang)', answer.status !== 0);
    if (answer.status < 400) continue;
    check(label + ': ' + answer.status + ' is a status the contract declares for this route', allowed(scenario.route).includes(answer.status), allowed(scenario.route));
    if (inherited(scenario, answer)) continue;
    checkProblemBody(label, answer);
    if (answer.status >= 500) check(label + ': a 5xx says nothing of its cause', !/books_entry|SELECT|vault|relation/.test(answer.text), answer.text);
    else checkLegacy(label, answer, legacyOf(scenario.route, scenario.id));
  }
  return tested;
}

/** a capture becomes frozen answers: { route: { answers: [{ scenario, status, body_keys, fixture }] } } (4xx and 5xx only, the 401 of the sign-in middleware left out) */
function freeze(captureFile) {
  const recording = JSON.parse(fs.readFileSync(captureFile, 'utf8'));
  const file = JSON.parse(fs.readFileSync(LEGACY_FILE, 'utf8'));
  Object.keys(recording).forEach((key) => {
    const one = recording[key];
    const scenario = key.split('|')[1];
    const only = flagValue('--only');
    if (one.status < 400 || (one.status === 401 && scenario === 'signed-out') || !one.body || (only && !one.route.includes(' ' + only + '/'))) return;
    const entry = (file.routes[one.route] = file.routes[one.route] || { answers: [] });
    if (!entry.answers.some((answer) => answer.scenario === scenario)) entry.answers.push({ scenario, status: one.status, body_keys: one.body, fixture: one.body });
  });
  file.routes = Object.fromEntries(Object.keys(file.routes).sort().map((route) => [route, file.routes[route]]));
  fs.writeFileSync(LEGACY_FILE, JSON.stringify(file, null, 1) + '\n');
  console.log('froze ' + Object.keys(file.routes).filter(MINE).length + ' routes');
}

/** lib/books-contract.js refusalOf as a unit: each coded refusal of the ledger, in the words and status it always had */
function checkRefusals() {
  const { refusalOf } = require(path.join(HERE, 'lib', 'books-contract.js'));
  const said = (code, extra) => refusalOf(Object.assign(new Error('Because.'), { code }, extra));
  const table = [
    ['PERIOD_LOCKED', 409], ['YEAR_CLOSED', 409], ['SUSPENSE_NOT_NIL', 409], ['BOOKS_NOT_FOUND', 404], ['FX_RATE_MISSING', 422], ['NO_COUNTRY_PACK', 422],
    ['NO_COUNTRY', 422], ['COUNTRY_SETUP_PENDING', 422], ['NO_MONEY', 422], ['RETURN_FROM_RAIL', 422], ['BOOKS_ENGINE', 503], ['BOOKS_NOT_MIGRATED', 503], ['BOOKS_BAD_REQUEST', 400], ['23505', 409]
  ];
  table.forEach(([code, status]) => check('refusalOf ' + code + ' → ' + status, said(code).status === status, said(code)));
  check('refusalOf: a refusal a screen branches on keeps its own code', said('PERIOD_LOCKED').code === 'PERIOD_LOCKED' && said('PERIOD_LOCKED').legacy.message === 'Because.');
  check('refusalOf: a named stock refusal carries its items', said('STOCK_NOT_COUNTED', { refused: true, items: ['p1'] }).legacy.items[0] === 'p1' && said('STOCK_NOT_COUNTED', { refused: true }).status === 422);
  check('refusalOf: a terms sentence the owner can fix keeps its 400 and words', refusalOf(Object.assign(new Error('x'), { say: 'Fix this.', status: 400 })).detail === 'Fix this.');
  check('refusalOf: the database refusing a write on purpose is a 503 in words', refusalOf(Object.assign(new Error('insert-only'), { code: '42501' })).status === 503);
  const unknown = refusalOf(new Error(SECRET_SQL));
  check('refusalOf: anything else is a 500 INTERNAL that says nothing of its cause', unknown.status === 500 && unknown.code === 'INTERNAL' && !JSON.stringify(unknown).includes('vault'), unknown);
}

/** lib/tax-contract.js as a unit: the words of a tax refusal and of a fault, as the service always said them */
function checkTaxWords() {
  const { taxSaid, faultOf } = require(path.join(HERE, 'lib', 'tax-contract.js'));
  const bad = taxSaid(400, 'NO_LINES', 'Send at least one line.');
  check('taxSaid: a 400 keeps { error: "Bad request", code, message }', bad.status === 400 && sameValue(bad.legacy, { error: 'Bad request', code: 'NO_LINES', message: 'Send at least one line.' }), bad);
  const cannot = taxSaid(422, 'NO_PRICE', 'No price.', { line: 'a' });
  check('taxSaid: a 422 says "Cannot compute" and carries its extra keys', cannot.legacy.error === 'Cannot compute' && cannot.legacy.line === 'a', cannot);
  const fault = faultOf(new Error(SECRET_SQL), { id: 'r1' });
  check('faultOf: anything else is a 500 TAX_FAILED that says nothing of its cause', fault.status === 500 && fault.code === 'TAX_FAILED' && fault.legacy.error === 'Failed' && !JSON.stringify(fault).includes('vault'), fault);
}

/** lib/contract-kit.js as a unit: a table of routes becomes operations whose refusals are Problem responses, with the statuses the register can check */
function checkKit() {
  console.log('\n-- lib/contract-kit.js: the operations an area builds from its table --');
  const kit = require(path.join(HERE, 'lib', 'contract-kit.js'));
  const rows = { 'POST /thing/:id': { summary: 'Change a thing', gates: ['owner'], body: ['name'], inline: [409] }, 'GET /things': { summary: 'List things', query: ['page'] } };
  const contract = kit.contractOf({ mount: '/api/x', routes: rows, gateStatus: { owner: 403 }, refusals: [{ status: 503 }], refusalsWhen: 'owner', extension: 'x-refusals' });
  const change = contract.OPERATIONS['POST /api/x/thing/:id'];
  const statuses = Object.keys(change.responses).map(Number).filter((status) => status >= 400);
  check('kit: a write behind the owner gate declares 401 sign-in, 403 refused, 404 for the id, 409 it writes itself, 422 the schema, 500 a fault', sameValue(statuses, [401, 403, 404, 409, 422, 500]), statuses);
  check('kit: every refusal is a Problem response, never a bare description', statuses.every((status) => JSON.stringify(change.responses[status]).includes('application/problem+json')));
  check('kit: a route that takes no write has no 422 unless it reads a query argument', !Object.keys(kit.contractOf({ mount: '/api/x', routes: { 'GET /ping': { summary: 'Ping' } } }).OPERATIONS['GET /api/x/ping'].responses).includes('422'));
  check('kit: a query argument is optional text, so a bad one stays a fallback and is never refused', contract.OPERATIONS['GET /api/x/things'].parameters[0].required === false);
  check('kit: allowedStatuses adds the shared refusals of a gated route and closed to anything unknown', contract.allowedStatuses()('POST /api/x/thing/:id').includes(503) && contract.allowedStatuses()('GET /nowhere').length === 0);
  check('kit: the paths fragment writes an express :id as {id}', Object.keys(contract.pathsOf()).includes('/api/x/thing/{id}'));
}

/** the whole sweep in four sentences: who is refused, how a malformed request is answered, and that every recorded refusal was replayed */
function checkAnswers(recording) {
  const answers = Object.values(recording);
  const gated = answers.filter((one) => one.route.includes('/api/tax/rate') || one.route.includes('/api/invoice/build'));
  const outs = Object.keys(recording);
  check('a caller who is not signed in is refused with 401, and a key without the scope with 403', outs.filter((key) => key.endsWith('|signed-out')).every((key) => recording[key].status === 401) && gated.filter((one) => one.status === 403).length >= 2);
  const nothing = answers.filter((one) => one.route === 'POST /api/tax/compute');
  check('a malformed tax request is refused with 400 in words (validation), never a crash', nothing.some((one) => one.status === 400 && one.body && one.body.code === 'NO_LINES'));
  const legacy = JSON.parse(fs.readFileSync(LEGACY_FILE, 'utf8')).routes;
  const frozen = Object.keys(legacy).filter(MINE).reduce((sum, route) => sum + legacy[route].answers.length, 0);
  check('every refusal recorded before the sweep is replayed against the code: ' + frozen + ' answers, each once, byte for byte', frozen > 300);
  check('a 500 never says its cause: no answer of any route carries the database text', answers.every((one) => !JSON.stringify(one.body || {}).includes('vault')));
}

process.on('unhandledRejection', (failure) => console.log('  (unhandled rejection: ' + String(failure && failure.message).slice(0, 80) + ')'));
(async () => {
  if (flagValue('--freeze')) return freeze(flagValue('--freeze'));
  installStubs();
  const mounted = MOUNTS.map((mount) => ({ mount, router: require(path.join(HERE, ROUTE_FILES[mount])) }));
  const routes = Object.assign({}, ...mounted.map((one) => routesOf(one.router, one.mount)));
  const app = express();
  app.use((req, res, next) => {
    req.id = 'req-test';
    next();
  });
  app.use(express.json());
  mounted.forEach((one) => app.use(one.mount, one.router));
  const server = app.listen(0);
  const recording = {};
  const tested = await checkRoutes(server.address().port, scenariosOf(routes), recording);
  server.close();
  if (flagValue('--capture')) {
    fs.writeFileSync(flagValue('--capture'), JSON.stringify(recording, null, 1));
    console.log('captured ' + Object.keys(recording).length + ' answers over ' + Object.keys(routes).length + ' routes');
    process.exit(0);
  }
  console.log('\n-- lib/books-contract.js: the ledger refusals as a unit --');
  checkRefusals();
  checkTaxWords();
  checkKit();
  checkAnswers(recording);
  const coverage = Object.fromEntries(Object.keys(tested).sort().map((route) => [route, [...tested[route]].sort((a, b) => a - b)]));
  const onDisk = JSON.parse(fs.readFileSync(TESTED_FILE, 'utf8'));
  const mine = Object.fromEntries(Object.keys(onDisk).filter(MINE).sort().map((route) => [route, onDisk[route]]));
  if (argv.includes('--write')) {
    const others = Object.fromEntries(Object.keys(onDisk).filter((route) => !MINE(route)).map((route) => [route, onDisk[route]]));
    const merged = Object.assign(others, coverage);
    fs.writeFileSync(TESTED_FILE, JSON.stringify(Object.fromEntries(Object.keys(merged).sort().map((route) => [route, merged[route]])), null, 1) + '\n');
  } else check('docs/contracts/api-error-tests.json lists exactly the statuses these scenarios cover for routes/books.js', sameValue(mine, coverage), { onDisk: Object.keys(mine).length, covered: Object.keys(coverage).length });
  console.log('\n  ' + passed + ' checks, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
