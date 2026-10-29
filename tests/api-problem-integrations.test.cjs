#!/usr/bin/env node
/**
 * api-problem-integrations.test.cjs — API-1 slice 1c: every error answer of routes/integrations.js.
 *
 * OWNS      the proof that each refusal of routes/integrations.js is a Problem body AND still carries the keys it answered before
 *           (docs/contracts/api-legacy.json, recorded from the code before slice 1c), and this file's rows of docs/contracts/api-error-tests.json
 *           (the statuses each integrations route is tested for, which the register's error_tests column reads).
 *           Also lib/integrations-contract.js as a unit: 17 operations, the kit's 400 in its old words, each refusal sentence frozen, a 5xx fail-closed.
 * CALLED BY scripts/guards.cjs · CI. No database, no network: the real routes/integrations.js over stand-in db, auth, policy, keys and profile.
 * FLOW      scenario → real route → body → Problem fields present · frozen legacy keys equal · no leak on a 5xx · statuses tested → manifest
 *
 *   node tests/api-problem-integrations.test.cjs                    check
 *   node tests/api-problem-integrations.test.cjs --write            rewrite this file's rows of docs/contracts/api-error-tests.json
 *   node tests/api-problem-integrations.test.cjs --capture F        (run against the code BEFORE the change, API_ROOT=<that checkout>) record each answer to file F
 *
 * API-8 (S34, output_allowlist): the GET routes' SUCCESS answers too. Their scenes (ok: true) read the ready branch of each route: rows with every column filled, then the nullable ones null,
 * every branch of the pager (a page, a capped list) and of each library answer (a country with and without a pack, every reconcile state, a profile with checks failing).
 * tools/api-allowlist.cjs derives each route's closed schema from the capture of those answers; checkAllowList holds every recorded 200 to it.
 */
'use strict';
const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');

const HERE = path.join(__dirname, '..');
const API = process.env.API_ROOT ? path.resolve(process.env.API_ROOT) : HERE;
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
process.env.OUTPUT_ALLOWLIST = 'enforce'; /* S34: this sweep runs the allow-list for real; production defaults to report */
const LEGACY_FILE = path.join(HERE, 'docs', 'contracts', 'api-legacy.json');
const TESTED_FILE = path.join(HERE, 'docs', 'contracts', 'api-error-tests.json');
const MINE = (route) => / \/api\/integrations\//.test(route);
const argv = process.argv.slice(2);
const PROBLEM_FIELDS = ['type', 'title', 'status', 'code', 'detail', 'hint', 'request_id', 'field', 'params', 'errors'];
const REQUIRED_FIELDS = ['type', 'title', 'status', 'code', 'detail', 'hint', 'request_id'];

let passed = 0;
let failed = 0;
const check = (label, condition, info) => {
  if (condition) passed++;
  else failed++;
  console.log('  ' + (condition ? 'ok  ' : 'FAIL') + '  ' + label + (condition || info === undefined ? '' : '\n        ' + JSON.stringify(info).slice(0, 500)));
};
const sameValue = (left, right) => JSON.stringify(left) === JSON.stringify(right);

/* ── stand-ins: db, auth, policy, keys, profile, events, the storefront's visibility, the country packs ─────────── */
const mock = (relative, exported) => {
  const file = require.resolve(path.join(API, relative));
  require.cache[file] = { id: file, filename: file, loaded: true, exports: exported };
};
const SHOP = { identity_id: 'e1', identity_type: 'entity', owner_scope: 'entity' };
const CHIT = '11111111-2222-3333-4444-555555555555';
const SECRET_SQL = 'relation "identities" does not exist -- SELECT secret FROM vault';
const FRESH = { realAuth: false, who: SHOP, asKey: false, scopes: ['connector'], dbFails: false, fsFails: false, packFails: false, policyFails: false, policyRefuses: false, profileFails: false, country: null, actor: null, kitRows: [], chits: [], since: null, handle: false, stockRows: [], flags: {}, profileValues: {} };
const world = Object.assign({}, FRESH);

/** the rows a statement gets: the shop's country, the connector actor to approve, and nothing for every update (so a chit is "not found") */
function rowsFor(sql) {
  if (world.dbFails) throw new Error(SECRET_SQL);
  if (/SELECT country FROM identities/.test(sql)) return { rows: world.country ? [{ country: world.country }] : [], rowCount: 1 };
  if (/MIN\(created_at\) AS t FROM identities/.test(sql)) return { rows: [{ t: world.since }], rowCount: 1 };
  if (/connector_type IS NOT NULL AND status = 'active'/.test(sql)) return { rows: world.kitRows, rowCount: world.kitRows.length };
  if (/FROM chit_header ch/.test(sql)) return { rows: world.chits, rowCount: world.chits.length };
  if (/WHERE \(user_id = \$1 OR bridge_id = \$1\)/.test(sql)) return world.handle ? { rows: [{ identity_id: 'e1' }], rowCount: 1 } : { rows: [], rowCount: 0 };
  if (/FROM catalogue_items/.test(sql)) return { rows: world.stockRows, rowCount: world.stockRows.length };
  if (/SELECT identity_id, site, connector_config FROM identities/.test(sql)) return { rows: world.actor ? [world.actor] : [], rowCount: world.actor ? 1 : 0 };
  return { rows: [], rowCount: 0 };
}

function installStubs() {
  const realAuth = require(path.join(API, 'middleware', 'auth'));
  const stubAuth = (req, res, next) => {
    if (world.realAuth) return realAuth(req, res, next);
    req.identity = world.who;
    if (world.asKey) req.api_key = { jti: 'j1', scopes: world.scopes };
    return next();
  };
  mock('middleware/auth', Object.assign(stubAuth, realAuth, { entityOf: (req) => req.identity.identity_id }));
  const client = { query: async (sql) => rowsFor(sql) };
  const db = { query: async (sql) => rowsFor(sql), withTransaction: async (run) => run(client), withEntity: async (id, run) => run(client), readBatch: async () => [{ rows: [], rowCount: 0 }] };
  mock('db', db);
  mock('db/index', db);
  mock('lib/policy', {
    get: async () => {
      if (world.policyFails) throw new Error(SECRET_SQL);
      return Object.assign({}, world.flags);
    },
    set: async (id, patch) => {
      if (world.policyFails) throw new Error(SECRET_SQL);
      if (world.policyRefuses) throw Object.assign(new Error('Unknown or invalid policy flag: stream_owner'), { status: 400 });
      return patch;
    }
  });
  mock('routes/keys', { listOf: async () => [], setEnrol: async () => ({}), mint: async () => ({ key: 'k', name: 'n', last4: '0000' }) });
  mock('lib/profile', {
    profileValues: async () => {
      if (world.profileFails) throw new Error(SECRET_SQL);
      return world.profileValues;
    },
    applyProfileMap: async () => ({ rows: 0 })
  });
  mock('lib/events', { emit: () => 0 });
  mock('lib/catalogue-view', { catalogueVisibility: async () => 'public' });
  const regulation = require(path.join(API, 'lib', 'regulation'));
  mock('lib/regulation', Object.assign({}, regulation, {
    packFor: (country) => {
      if (world.packFails) throw new Error(SECRET_SQL);
      return regulation.packFor(country);
    }
  }));
  /* the kit's files are read with fs.readFileSync; a failing disk is the only way the kit routes can fail */
  const read = fs.readFileSync;
  fs.readFileSync = function (file) {
    if (world.fsFails && String(file).includes('tally-connector')) throw new Error('EACCES: ' + SECRET_SQL);
    return read.apply(fs, arguments);
  };
}

/* ── the scenarios: every error answer of routes/integrations.js (and the shared gates in front of it) ──────────
   inherited = the sign-in middleware's own 401, or requireScope's 403: tested, not yet a Problem (the old body, as for routes/keys.js)
   fresh     = an answer the route did not give before slice 1c (its schema's refusal): a Problem, with no frozen keys to keep */
const I = '/api/integrations';
const BAD_TOKEN = { authorization: 'Bearer not-a-token' };
const SIGNED = { authorization: 'Bearer stand-in' }; /* catalogue and download sign in only when a credential is offered */
const SCENARIOS = [
  { id: 'kit-no-token', route: 'GET /api/integrations/kit', status: 401, setup: { realAuth: true }, inherited: true },
  { id: 'kit-disk-fails', route: 'GET /api/integrations/kit', status: 500, setup: { fsFails: true } },
  { id: 'kitfile-no-token', route: 'GET /api/integrations/kit/*', status: 401, setup: { realAuth: true }, url: I + '/kit/till.js', inherited: true },
  { id: 'kitfile-not-in-kit', route: 'GET /api/integrations/kit/*', status: 404, url: I + '/kit/secrets.env' },
  { id: 'kitfile-disk-fails', route: 'GET /api/integrations/kit/*', status: 500, setup: { fsFails: true }, url: I + '/kit/till.js' },
  { id: 'docs-unknown', route: 'GET /api/integrations/docs/:id', status: 404, url: I + '/docs/nothing' },
  { id: 'docs-disk-fails', route: 'GET /api/integrations/docs/:id', status: 500, setup: { fsFails: true }, url: I + '/docs/tally' },
  { id: 'catalogue-bad-token', route: 'GET /api/integrations/catalogue', status: 401, setup: { realAuth: true }, headers: BAD_TOKEN, inherited: true },
  { id: 'catalogue-pack-fails', route: 'GET /api/integrations/catalogue', status: 500, setup: { country: 'IN', packFails: true }, headers: SIGNED },
  { id: 'download-bad-token', route: 'GET /api/integrations/download/:id', status: 401, setup: { realAuth: true }, headers: BAD_TOKEN, url: I + '/download/tally', inherited: true },
  { id: 'download-unknown', route: 'GET /api/integrations/download/:id', status: 404, url: I + '/download/nothing' },
  { id: 'download-not-for-country', route: 'GET /api/integrations/download/:id', status: 409, setup: { country: 'AU' }, headers: SIGNED, url: I + '/download/tally' },
  { id: 'download-pack-fails', route: 'GET /api/integrations/download/:id', status: 500, setup: { country: 'IN', packFails: true }, headers: SIGNED, url: I + '/download/tally' },
  { id: 'heartbeat-no-token', route: 'POST /api/integrations/heartbeat', status: 401, setup: { realAuth: true }, body: {}, inherited: true },
  { id: 'heartbeat-wrong-scope', route: 'POST /api/integrations/heartbeat', status: 403, setup: { asKey: true, scopes: ['offers'] }, body: {}, inherited: true },
  { id: 'heartbeat-bad-body', route: 'POST /api/integrations/heartbeat', status: 400, body: { name: 12345 }, fresh: true },
  { id: 'heartbeat-db-fails', route: 'POST /api/integrations/heartbeat', status: 500, setup: { dbFails: true }, body: { name: 'kit' } },
  { id: 'approve-no-token', route: 'POST /api/integrations/:actor_id/approve', status: 401, setup: { realAuth: true }, url: I + '/a1/approve', inherited: true },
  { id: 'approve-key-asks', route: 'POST /api/integrations/:actor_id/approve', status: 403, setup: { asKey: true }, url: I + '/a1/approve' },
  { id: 'approve-no-actor', route: 'POST /api/integrations/:actor_id/approve', status: 404, url: I + '/a1/approve' },
  { id: 'approve-no-key', route: 'POST /api/integrations/:actor_id/approve', status: 400, setup: { actor: { identity_id: 'a1', site: 'PC', connector_config: {} } }, url: I + '/a1/approve' },
  { id: 'approve-db-fails', route: 'POST /api/integrations/:actor_id/approve', status: 500, setup: { dbFails: true }, url: I + '/a1/approve' },
  { id: 'books-no-token', route: 'POST /api/integrations/books', status: 401, setup: { realAuth: true }, body: {}, inherited: true },
  { id: 'books-wrong-scope', route: 'POST /api/integrations/books', status: 403, setup: { asKey: true, scopes: ['offers'] }, body: {}, inherited: true },
  { id: 'books-no-chit', route: 'POST /api/integrations/books', status: 400, body: { kind: 'order' } },
  { id: 'books-not-found', route: 'POST /api/integrations/books', status: 404, body: { chit_id: CHIT } },
  { id: 'books-db-fails', route: 'POST /api/integrations/books', status: 500, setup: { dbFails: true }, body: { chit_id: CHIT } },
  { id: 'status-no-token', route: 'GET /api/integrations/status', status: 401, setup: { realAuth: true }, inherited: true },
  { id: 'status-db-fails', route: 'GET /api/integrations/status', status: 500, setup: { dbFails: true } },
  { id: 'streams-no-token', route: 'GET /api/integrations/streams', status: 401, setup: { realAuth: true }, inherited: true },
  { id: 'streams-policy-fails', route: 'GET /api/integrations/streams', status: 500, setup: { policyFails: true } },
  { id: 'putstreams-no-token', route: 'PUT /api/integrations/streams', status: 401, setup: { realAuth: true }, body: {}, inherited: true },
  { id: 'putstreams-key-asks', route: 'PUT /api/integrations/streams', status: 403, setup: { asKey: true }, body: { order: 'kit@pc' } },
  { id: 'putstreams-none-named', route: 'PUT /api/integrations/streams', status: 400, body: { colour: 'red' } },
  { id: 'putstreams-policy-refuses', route: 'PUT /api/integrations/streams', status: 400, setup: { policyRefuses: true }, body: { order: 'kit@pc' } },
  { id: 'putstreams-bad-body', route: 'PUT /api/integrations/streams', status: 422, body: { order: 12345 }, fresh: true },
  { id: 'putstreams-policy-fails', route: 'PUT /api/integrations/streams', status: 500, setup: { policyFails: true }, body: { order: 'kit@pc' } },
  { id: 'skip-no-token', route: 'POST /api/integrations/books/skip', status: 401, setup: { realAuth: true }, body: {}, inherited: true },
  { id: 'skip-key-asks', route: 'POST /api/integrations/books/skip', status: 403, setup: { asKey: true }, body: { chit_id: CHIT } },
  { id: 'skip-no-chit', route: 'POST /api/integrations/books/skip', status: 400, body: {} },
  { id: 'skip-not-found', route: 'POST /api/integrations/books/skip', status: 404, body: { chit_id: CHIT } },
  { id: 'skip-db-fails', route: 'POST /api/integrations/books/skip', status: 500, setup: { dbFails: true }, body: { chit_id: CHIT } },
  { id: 'reconcile-no-token', route: 'GET /api/integrations/reconcile', status: 401, setup: { realAuth: true }, inherited: true },
  { id: 'reconcile-db-fails', route: 'GET /api/integrations/reconcile', status: 500, setup: { policyFails: true } },
  { id: 'ask-unknown-shop', route: 'POST /api/integrations/ask/:handle/stock', status: 404, url: I + '/ask/nobody/stock', body: {} },
  { id: 'ask-db-fails', route: 'POST /api/integrations/ask/:handle/stock', status: 500, setup: { dbFails: true }, url: I + '/ask/nobody/stock', body: {} },
  { id: 'stock-unknown-shop', route: 'GET /api/integrations/stock/:handle', status: 404, url: I + '/stock/nobody' },
  { id: 'stock-db-fails', route: 'GET /api/integrations/stock/:handle', status: 500, setup: { dbFails: true }, url: I + '/stock/nobody' },
  { id: 'profilemap-no-token', route: 'GET /api/integrations/profile-map', status: 401, setup: { realAuth: true }, inherited: true },
  { id: 'profilemap-fails', route: 'GET /api/integrations/profile-map', status: 500, setup: { profileFails: true } },
  { id: 'profile-no-token', route: 'POST /api/integrations/profile', status: 401, setup: { realAuth: true }, body: {}, inherited: true },
  { id: 'profile-wrong-scope', route: 'POST /api/integrations/profile', status: 403, setup: { asKey: true, scopes: ['offers'] }, body: {}, inherited: true },
  { id: 'profile-no-fields', route: 'POST /api/integrations/profile', status: 400, body: { fields: { colour: 'red' } } },
  { id: 'profile-fails', route: 'POST /api/integrations/profile', status: 500, setup: { profileFails: true }, body: { fields: { gstin: '29ABCDE1234F1Z5' } } }
];

/* ── the success scenes (API-8): the ready branch of each GET route, from the tables' own columns ───────────────── */
const HOUR = 3600 * 1000;
const NOW = Date.now();
const ago = (hours) => new Date(NOW - hours * HOUR).toISOString();
/** an identities row as KIT_ROWS selects it (lib/connector-rows.js; last_seen and connector_config are nullable): a kit that checked in, then a bare actor */
const KIT_ROW = { identity_id: 'a1', display_name: 'Tally PC', site: 'PC1', last_seen: ago(0.01), connector_type: 'erp', connector_config: { kit: true, kit_id: 'kit@pc', adapter: 'tally', version: '1.4', key_jti: 'j1', source: { app: 'tally' }, counters: { sent: 2 }, note: 'ok', enrol: { approved: true, reason: 'gstin match', host: 'PC1' } }, status: 'active', created_at: ago(500) };
const KIT_BARE = { identity_id: 'a2', display_name: 'File PC', site: null, last_seen: null, connector_type: 'csv', connector_config: null, status: 'active', created_at: ago(400) };
const kitRowsOf = (count) => Array.from({ length: count }, (_, at) => Object.assign({}, KIT_ROW, { identity_id: 'a' + at }));
/** a chit_header + chit_status row as SQL_RECONCILE selects it (business_json books / books_request / books_skip are written by the kit and the owner, never by a column) */
const CHIT_ROW = { chit_id: CHIT, direction: 'received', purpose: 'order', auto_subject: 'Order 1', manual_subject: null, created_at: ago(30), all_recipients: [{ role: 'sender', display_name: 'Me' }, { display_name: 'Buyer' }], books: null, asked: false, skip: null, current_status: 'created', status_at: ago(30) };
const BOOKED = (system) => ({ outcome: 'ok', system, ref: 'V-1', at: ago(5), host: 'PC1' });
const CHITS = [
  { books: { order: BOOKED('tally') }, current_status: 'completed', manual_subject: 'Called subject' },
  { direction: 'sent', books: { purchase: { outcome: 'ok' } }, current_status: 'accepted', all_recipients: ['Raw Supplier'] },
  { books: { order: { outcome: 'failed', system: 'zoho', why: 'invalid_client', at: ago(2), host: 'PC1' } }, current_status: 'accepted', auto_subject: null },
  { skip: { at: ago(3), by: 'e1', why: null }, current_status: 'accepted', all_recipients: [] },
  { current_status: 'cancelled' },
  { current_status: 'created' },
  { current_status: 'accepted', status_at: ago(24 * 20), created_at: ago(24 * 21) },
  { current_status: 'accepted', status_at: ago(1), created_at: ago(2) },
  { current_status: 'completed', status_at: ago(48), created_at: ago(50) },
  { current_status: 'created', asked: true, status_at: ago(1), all_recipients: null }
].map((part) => Object.assign({}, CHIT_ROW, part));
const STOCK_ROW = { item_id: 'i1', avail: { qty: 4, source: 'connector', as_of: ago(1) } };
const stockRowsOf = (count) => Array.from({ length: count }, (_, at) => Object.assign({}, STOCK_ROW, { item_id: 'i' + at }));
/** the profile as lib/profile.profileValues holds it: fields a kit sent, a second system disagreeing on the trade name, a GSTIN, a PIN of another state */
const HELD = {
  legal_name: { value: 'Acme Pvt Ltd', source: 'tally', as_of: ago(5), rung: 'copied' },
  trade_name: { value: 'Acme', source: 'profile', as_of: ago(5), rung: 'declared', other: { value: 'ACME Traders', source: 'tally' } },
  gstin: { value: '29ABCDE1234F1Z5', source: 'tally', as_of: ago(5), rung: 'copied' },
  state: { value: 'Delhi', source: 'tally', as_of: ago(5), rung: 'copied' },
  pincode: { value: '600001', source: 'tally', as_of: ago(5), rung: 'copied' }
};
const OK = (id, route, setup, more) => Object.assign({ id, route, status: 200, ok: true, setup }, more);
const SUCCESS = [
  OK('kit-manifest', 'GET /api/integrations/kit', {}),
  OK('catalogue-anonymous', 'GET /api/integrations/catalogue', {}),
  OK('catalogue-india', 'GET /api/integrations/catalogue', { country: 'IN' }, { headers: SIGNED }),
  OK('catalogue-australia', 'GET /api/integrations/catalogue', { country: 'AU' }, { headers: SIGNED }),
  OK('status-none', 'GET /api/integrations/status', {}),
  OK('status-rows', 'GET /api/integrations/status', { kitRows: [KIT_ROW, KIT_BARE] }),
  OK('status-second-page', 'GET /api/integrations/status', { kitRows: [KIT_ROW, KIT_BARE] }, { url: I + '/status?limit=1&page=2' }),
  OK('status-capped', 'GET /api/integrations/status', { kitRows: kitRowsOf(201) }, { url: I + '/status?limit=500' }),
  OK('streams-unowned', 'GET /api/integrations/streams', {}),
  OK('streams-owned', 'GET /api/integrations/streams', { kitRows: [KIT_ROW, KIT_BARE], flags: { stream_owner: { order: 'kit@pc' } } }),
  OK('reconcile-empty', 'GET /api/integrations/reconcile', {}),
  OK('reconcile-every-state', 'GET /api/integrations/reconcile', { chits: CHITS, since: ago(24 * 10), flags: { books_at: 'accepted', books_overdue_hours: 12 } }, { url: I + '/reconcile?days=60' }),
  OK('reconcile-when-received', 'GET /api/integrations/reconcile', { chits: CHITS, since: ago(24 * 10), flags: { books_at: 'received' } }),
  OK('stock-none', 'GET /api/integrations/stock/:handle', { handle: true }, { url: I + '/stock/shop-a' }),
  OK('stock-rows', 'GET /api/integrations/stock/:handle', { handle: true, stockRows: [STOCK_ROW] }, { url: I + '/stock/shop-a' }),
  OK('stock-second-page', 'GET /api/integrations/stock/:handle', { handle: true, stockRows: stockRowsOf(3) }, { url: I + '/stock/shop-a?limit=2&page=2' }),
  OK('stock-capped', 'GET /api/integrations/stock/:handle', { handle: true, stockRows: stockRowsOf(201) }, { url: I + '/stock/shop-a?limit=500' }),
  OK('profile-map-empty', 'GET /api/integrations/profile-map', {}),
  OK('profile-map-held', 'GET /api/integrations/profile-map', { profileValues: HELD })
];

function send(port, method, urlPath, body, headers) {
  return new Promise((resolve) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const options = { port, path: urlPath, method, headers: Object.assign(data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {}, headers) };
    const request = http.request(options, (response) => {
      let text = '';
      response.on('data', (part) => (text += part));
      response.on('end', () => resolve({ status: response.statusCode, type: String(response.headers['content-type'] || ''), text, json: safeParse(text) }));
    });
    /* an async handler that throws outside its try never answers (before slice 1c: catalogue and download on a failing pack) — status 0 */
    request.setTimeout(3000, () => {
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

async function runScenario(port, scenario) {
  Object.assign(world, FRESH, scenario.setup);
  const [method, template] = scenario.route.split(' ');
  return send(port, method, scenario.url || template, scenario.body, scenario.headers);
}

const legacyOf = (key, scenario) => (JSON.parse(fs.readFileSync(LEGACY_FILE, 'utf8')).routes[key] || { answers: [] }).answers.find((answer) => answer.scenario === scenario);

function checkProblemBody(label, answer) {
  check(label + ': content-type is application/problem+json', /application\/problem\+json/.test(answer.type), answer.type);
  check(label + ': has every Problem field', answer.json && REQUIRED_FIELDS.every((name) => answer.json[name] !== undefined), answer.json);
  check(label + ': request_id is the id the server minted', answer.json && answer.json.request_id === 'req-test', answer.json && answer.json.request_id);
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

async function checkRoutes(port, recording) {
  console.log('\n-- routes/integrations.js: every refusal is a Problem and keeps its old keys --');
  const tested = {};
  for (const scenario of SCENARIOS.concat(SUCCESS)) {
    const answer = await runScenario(port, scenario);
    recording[scenario.route + '|' + scenario.id] = Object.assign({ route: scenario.route, status: answer.status, body: answer.json }, scenario.ok ? { request: { url: scenario.url || scenario.route.split(' ')[1] } } : {});
    const label = scenario.id;
    if (scenario.ok) {
      if (!argv.includes('--capture')) check(label + ': answers 200', answer.status === 200, answer.status);
      continue;
    }
    (tested[scenario.route] = tested[scenario.route] || new Set()).add(answer.status);
    if (argv.includes('--capture')) continue;
    check(label + ': answers ' + scenario.status, answer.status === scenario.status, answer.status);
    if (scenario.inherited) continue;
    checkProblemBody(label, answer);
    if (!scenario.fresh) checkLegacy(label, answer, legacyOf(scenario.route, scenario.id));
    if (scenario.status === 500) check(label + ': a 5xx says nothing of its cause', !/identities|SELECT|vault|relation|EACCES/.test(answer.text), answer.text);
  }
  return tested;
}

/* ── lib/integrations-contract.js as a unit: the operations, the kit's 400, the frozen sentences, the 5xx body ── */
function checkContract() {
  console.log('\n-- lib/integrations-contract.js: the operations and the old words --');
  const contract = require(path.join(HERE, 'lib', 'integrations-contract.js'));
  const { SAFE_SENTENCE } = require(path.join(HERE, 'lib', 'respond.js'));
  const operations = Object.keys(contract).filter((name) => name.endsWith('_OPERATION'));
  check('17 operations, one per route', operations.length === 17, operations.length);
  operations.forEach((name) => {
    const responses = contract[name].responses || {};
    check(name + ': declares the 500 every route can answer', !!responses[500]);
    const success = Object.keys(responses).filter((status) => /^2\d\d$/.test(status));
    check(name + ': each success declares a media type with a schema', success.length > 0 && success.every((status) => Object.values(responses[status].content || {}).some((media) => media.schema)));
  });
  const kit = contract.KIT_REFUSAL('chit_id required');
  check("a kit's schema refusal stays 400 INTEGRATION_BAD_REQUEST (never a 422 for a client in the field)", kit.status === 400 && kit.code === 'INTEGRATION_BAD_REQUEST');
  check('it answers in the old words it was given', sameValue(kit.legacy([{ detail: 'x' }]), { error: 'validation', message: 'chit_id required' }));
  check('with no words given, it says the first failure', contract.KIT_REFUSAL().legacy([{ detail: 'name must be text' }]).message === 'name must be text');
  const frozen = JSON.stringify(JSON.parse(fs.readFileSync(LEGACY_FILE, 'utf8')).routes);
  Object.entries(contract.SAID).forEach(([key, sentence]) => check('refusal sentence ' + key + ' is word for word a frozen legacy message', frozen.includes(JSON.stringify(sentence))));
  check('the profile refusal names the fields the profile knows', /^fields\{\} required — keys: /.test(contract.PROFILE_FIELDS_SAID()));
  check('fail closed: a 5xx keeps its old keys and never says its cause', sameValue(contract.FAILED_LEGACY, { error: 'Failed', message: SAFE_SENTENCE }));
}

/**
 * output_allowlist in this route file's own world (S34): every GET success schema is closed (additionalProperties false, derived from the recorded answers and the handler's own keys),
 * holds every recorded 200, and the allow-list filter dropped nothing from any of them.
 */
function checkAllowList(recording) {
  console.log('\n-- the closed success schemas hold every recorded 200 --');
  const contract = require(path.join(HERE, 'lib', 'integrations-contract.js'));
  const { prune, droppedCount } = require(path.join(HERE, 'lib', 'output-allowlist.js'));
  const engine = require(path.join(HERE, 'middleware', 'validate.js')).bodyEngine;
  const operations = {
    'GET /api/integrations/kit': contract.KIT_OPERATION,
    'GET /api/integrations/catalogue': contract.CATALOGUE_OPERATION,
    'GET /api/integrations/status': contract.STATUS_OPERATION,
    'GET /api/integrations/streams': contract.STREAMS_OPERATION,
    'GET /api/integrations/reconcile': contract.RECONCILE_OPERATION,
    'GET /api/integrations/stock/:handle': contract.STOCK_OPERATION,
    'GET /api/integrations/profile-map': contract.PROFILE_MAP_OPERATION
  };
  Object.keys(operations).forEach((route) => {
    const schema = operations[route].responses[200].content['application/json'].schema;
    const answers = Object.values(recording).filter((one) => one.route === route && one.status === 200 && one.body);
    check(route + ': the 200 schema is closed (additionalProperties false)', schema.additionalProperties === false, Object.keys(schema));
    const fits = engine.compile(schema);
    const held = answers.length > 0 && answers.every((one) => fits(one.body) && prune(schema, one.body).dropped.length === 0);
    check(route + ': every recorded 200 (' + answers.length + ') holds only the keys its schema lists', held, { answers: answers.length, errors: fits.errors });
  });
  check('the filter dropped no key of any answer these scenes gave', droppedCount() === 0, droppedCount());
}

process.on('unhandledRejection', (failure) => console.log('  (unhandled rejection: ' + String(failure && failure.message).slice(0, 80) + ')'));
(async () => {
  installStubs();
  const app = express();
  app.use((req, res, next) => {
    req.id = 'req-test';
    next();
  });
  app.use(express.json());
  app.use('/api/integrations', require(path.join(API, 'routes', 'integrations.js')));
  const server = app.listen(0);
  const recording = {};
  const tested = await checkRoutes(server.address().port, recording);
  server.close();
  if (argv.includes('--capture')) {
    fs.writeFileSync(argv[argv.indexOf('--capture') + 1], JSON.stringify(recording, null, 1));
    console.log('captured ' + Object.keys(recording).length + ' answers');
    process.exit(0);
  }
  checkContract();
  checkAllowList(recording);
  const coverage = Object.fromEntries(Object.keys(tested).sort().map((route) => [route, [...tested[route]].sort((a, b) => a - b)]));
  const onDisk = JSON.parse(fs.readFileSync(TESTED_FILE, 'utf8'));
  const mine = Object.fromEntries(Object.keys(onDisk).filter(MINE).sort().map((route) => [route, onDisk[route]]));
  if (argv.includes('--write')) {
    const others = Object.fromEntries(Object.keys(onDisk).filter((route) => !MINE(route)).map((route) => [route, onDisk[route]]));
    const merged = Object.assign(others, coverage);
    fs.writeFileSync(TESTED_FILE, JSON.stringify(Object.fromEntries(Object.keys(merged).sort().map((route) => [route, merged[route]])), null, 1) + '\n');
  } else check('docs/contracts/api-error-tests.json lists exactly the statuses these scenarios cover for routes/integrations.js', sameValue(mine, coverage), { onDisk: mine, covered: coverage });
  console.log('\n  ' + passed + ' checks, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
