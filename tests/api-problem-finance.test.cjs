#!/usr/bin/env node
// @type: contract
/**
 * api-problem-finance.test.cjs — API-4 sweep, finance: every refusal of routes/folders.js, routes/facts.js and routes/pricing.js.
 *
 * OWNS      the proof that each refusal of the folders, Home-facts and pricing routes is a Problem body AND still carries the keys it answered before
 *           (docs/contracts/api-legacy.json, recorded from the code before the sweep), and this file's rows of docs/contracts/api-error-tests.json
 *           (the statuses each of these routes is tested for, which the register's error_tests column reads). Also: no answer outside the statuses the
 *           route's contract declares (lib/folders-contract.js · lib/facts-contract.js · lib/pricing-contract.js), and those modules' words as units; the "signed in
 *           as another shop" world on the eleven routes addressed by an id or a name (API-STANDARD S35, tests/lib/foreign-id-world.cjs; its proof is this file's rows of
 *           docs/contracts/api-hardening-evidence-areas.json, and what it shows for the routes that cannot hold is printed as a table, never hidden); a 2xx is never a
 *           Problem; and the scenes in which each route's library (or the database under it) THROWS a string with SQL in it, scanned in every answer, 2xx included.
 * CALLED BY scripts/guards.cjs · CI. No database, no network: the real route files over a stand-in db and auth.
 * FLOW      route list (read from the router itself; not empty) x world (signed out, a key, staff, a bad id, a failing db, an empty db) + the named extras
 *           → real route → body → Problem fields present · frozen legacy keys equal · no leak on a 5xx · statuses tested → manifest
 *           then: the three throwing scenes (the db throws a string · the libraries throw an Error · the libraries throw a string) → no answer carries the SQL;
 *           the frozen 5xx bodies replayed word for word; the foreign-id world (shop B asks shop A's id) → evidence
 *
 *   node tests/api-problem-finance.test.cjs                    check
 *   node tests/api-problem-finance.test.cjs --write            rewrite this file's rows of docs/contracts/api-error-tests.json and api-hardening-evidence-areas.json
 *   node tests/api-problem-finance.test.cjs --capture F        (run on the code BEFORE the change) record each answer to file F
 *   node tests/api-problem-finance.test.cjs --freeze F         merge a capture F into docs/contracts/api-legacy.json (the frozen answers)
 */
'use strict';
const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');
const foreign = require('./lib/foreign-id-world.cjs');

const HERE = path.join(__dirname, '..');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
const LEGACY_FILE = path.join(HERE, 'docs', 'contracts', 'api-legacy.json');
const TESTED_FILE = path.join(HERE, 'docs', 'contracts', 'api-error-tests.json');
const EVIDENCE_FILE = path.join(HERE, 'docs', 'contracts', 'api-hardening-evidence-areas.json');
const MOUNTS = ['/api/folders', '/api/facts', '/api/pricing'];
/** the route files these mounts serve (named in full so the graph links this test to each of them) */
const ROUTE_FILES = { '/api/folders': 'routes/folders.js', '/api/facts': 'routes/facts.js', '/api/pricing': 'routes/pricing.js' };
const MINE = (route) => MOUNTS.some((mount) => route.includes(' ' + mount + '/') || route.endsWith(' ' + mount));
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

/* ── stand-ins: auth and db ────────────────────────────────────────────────────────────────────────────────── */
const SHOP = '11111111-1111-4111-8111-111111111111';
const PARTY = '22222222-2222-4222-8222-222222222222';
const OWNER = { identity_id: SHOP, identity_type: 'entity', display_name: 'Test shop' };
const STAFF = { identity_id: '44444444-4444-4444-8444-444444444444', parent_entity_id: SHOP, identity_type: 'actor', access_level: 'editor' };
const SECRET_SQL = 'relation "folder" does not exist -- SELECT secret FROM vault';
/** shop B: the stranger of the foreign-id world, a second owner of a second shop */
const OTHER_SHOP = '33333333-3333-4333-8333-333333333333';
const STRANGER = { identity_id: OTHER_SHOP, identity_type: 'entity', display_name: 'Other shop' };
const FRESH = { realAuth: false, who: OWNER, asKey: false, keyScopes: ['till'], db: 'ok', sqlRows: null, jsonThrows: false, plant: [], threw: 0, throwLibs: null };
const world = Object.assign({}, FRESH);

/**
 * the rows a statement gets: a scenario's own rows first, then the rows PLANTED for a shop (visible only to a client opened for that shop: what RLS and
 * `WHERE entity_id = $n` give), then nothing (or the secret failure when the db is down). `entity` is the shop the client was opened for (withEntity).
 */
function rowsFor(sql, params, entity) {
  const text = String(sql);
  if (world.db === 'throws-string') {
    world.threw++;
    throw SECRET_SQL; /* a bare string, as a driver or a careless library can throw one */
  }
  if (world.sqlRows) {
    const given = world.sqlRows(text, params || []);
    if (given) return given;
  }
  const planted = world.plant.find((one) => one.pattern.test(text) && one.owner === entity);
  if (planted) return { rows: planted.rows || [], rowCount: planted.rowCount === undefined ? (planted.rows || []).length : planted.rowCount };
  if (world.db === 'fail') {
    world.threw++;
    throw new Error(SECRET_SQL);
  }
  return { rows: [], rowCount: 0 };
}
const mock = (relative, exported) => {
  const file = require.resolve(path.join(HERE, relative));
  require.cache[file] = { id: file, filename: file, loaded: true, exports: exported };
};
/** an error the way pg raises one: a message and a SQLSTATE code */
const sqlError = (code) => Object.assign(new Error('pg ' + code), { code });

function installStubs() {
  const realAuth = require(path.join(HERE, 'middleware', 'auth'));
  const stubAuth = (req, res, next) => {
    if (world.realAuth) return realAuth(req, res, next);
    req.identity = world.who;
    if (world.asKey) req.api_key = { jti: 'j1', scopes: world.keyScopes };
    return next();
  };
  mock('middleware/auth', Object.assign(stubAuth, realAuth, { entityOf: (req) => req.identity.parent_entity_id || req.identity.identity_id }));
  const clientOf = (entity) => ({ query: async (sql, params) => rowsFor(sql, params, entity) });
  const known = {
    query: async (sql, params) => rowsFor(sql, params, undefined),
    withEntity: async (id, run) => run(clientOf(id)),
    withTransaction: async (run) => run(clientOf(undefined)),
    readBatch: async () => {
      if (world.db === 'throws-string') {
        world.threw++;
        throw SECRET_SQL;
      }
      return [{ rows: [], rowCount: 0 }];
    }
  };
  const db = new Proxy(known, { get: (target, name) => (name in target ? target[name] : typeof name === 'symbol' || name === 'then' ? undefined : async () => ({ rows: [], rowCount: 0 })) });
  mock('db', db);
  mock('db/index', db);
  console.error = () => undefined; /* the routes log a 5xx here; the scenarios read the answer */
}

/* ── the scenarios: every route the routers hold x the worlds, then the named extras ─────────────────────── */
const INV = () => require(path.join(HERE, 'lib', 'folder-inventory'));
const PARAM_VALUES = { id: PARTY, rule_id: PARTY, message_id: PARTY, code: 'B-2100', card: 'till', chit_id: PARTY };
const WORLDS = [
  { id: 'signed-out', setup: { realAuth: true } },
  { id: 'key-asks', setup: { asKey: true } },
  { id: 'staff-asks', setup: { who: STAFF } },
  { id: 'bad-id', setup: {}, badId: true },
  { id: 'db-fails', setup: { db: 'fail' } },
  { id: 'nothing-found', setup: {} }
];
const BODY_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'];

/** { 'METHOD /full/path': template } for every route a router holds, read from the router itself */
function routesOf(router, mount) {
  const found = {};
  router.stack.filter((layer) => layer.route).forEach((layer) => Object.keys(layer.route.methods).forEach((method) => {
    const full = layer.route.path === '/' ? mount : mount + layer.route.path;
    found[method.toUpperCase() + ' ' + full] = full;
  }));
  return found;
}
const urlOf = (template, bad) => template.replace(/:(\w+)/g, (all, name) => (bad ? 'nope' : PARAM_VALUES[name] || PARTY));

/** the extras: an answer the generic worlds cannot reach (a named refusal inside a handler) */
const X = (id, route, status, extra) => Object.assign({ id, route, expect: status, setup: {} }, extra);
const F = '/api/folders';
const sysId = (code) => INV().sysId(code);
/** a stand-in db that raises one SQLSTATE for statements matching a pattern */
const raising = (pattern, code) => (sql) => {
  if (pattern.test(sql)) throw sqlError(code);
  return null;
};
/** a stand-in db that answers one statement with given rows */
const answering = (pattern, rows) => (sql) => (pattern.test(sql) ? { rows, rowCount: rows.length } : null);
const BAD_WHEN = { when: { nonsense: 'x' } };
const FOLDER_ROW = (extra) => Object.assign({ folder_id: PARTY, name: 'Mayur', scope: 'task', kind: 'filed' }, extra);
const EXTRAS = [
  /* the express-validator chains: a validation refusal keeps its { error, details } body */
  X('name-missing', 'POST ' + F, 400, { body: {} }),
  X('name-too-long', 'POST ' + F, 400, { body: { name: 'x'.repeat(61) } }),
  X('db-fails-with-a-name', 'POST ' + F, 500, { body: { name: 'Mayur' }, setup: { db: 'fail' } }),
  X('parent-not-an-id', 'POST ' + F, 400, { body: { name: 'Mayur', parent_id: 'nope' } }),
  X('parent-not-found', 'POST ' + F, 400, { body: { name: 'Mayur', parent_id: PARTY } }),
  X('view-folder-not-migrated', 'POST ' + F, 503, { body: { name: 'Mayur', kind: 'view' }, setup: { sqlRows: raising(/INSERT INTO folder/, '42703') } }),
  X('view-folder-made', 'POST ' + F, 200, { body: { name: 'Mayur', kind: 'view' }, setup: { sqlRows: answering(/INSERT INTO folder/, [FOLDER_ROW({ kind: 'view' })]) } }),
  X('folder-made-before-b133', 'POST ' + F, 200, { body: { name: 'Mayur' }, setup: { sqlRows: raising(/INSERT INTO folder \(entity_id, parent_id, name, scope\)/, '42703') } }),
  X('db-fails-with-a-name', 'PATCH ' + F + '/:id', 500, { body: { name: 'Mayur' }, setup: { db: 'fail' } }),
  X('folder-not-found', 'PATCH ' + F + '/:id', 404, { body: { name: 'Mayur' } }),
  X('nothing-to-update', 'PATCH ' + F + '/:id', 400, { body: {} }),
  X('own-parent', 'PATCH ' + F + '/:id', 400, { body: { parent_id: PARTY } }),
  X('name-empty', 'PATCH ' + F + '/:id', 400, { body: { name: '' } }),
  X('renamed', 'PATCH ' + F + '/:id', 200, { body: { name: 'Mayur' }, setup: { sqlRows: answering(/UPDATE folder SET/, [FOLDER_ROW()]) } }),
  X('db-fails-with-a-chit', 'POST ' + F + '/move', 500, { body: { chit_id: PARTY }, setup: { db: 'fail' } }),
  X('chit-not-an-id', 'POST ' + F + '/move', 400, { body: { chit_id: 'nope' } }),
  X('chit-missing', 'POST ' + F + '/move', 400, { body: {} }),
  X('into-a-system-folder', 'POST ' + F + '/move', 400, { body: { chit_id: PARTY, folder_id: sysId('B-2100') } }),
  X('into-a-shops-view-folder', 'POST ' + F + '/move', 400, { body: { chit_id: PARTY, folder_id: PARTY }, setup: { sqlRows: answering(/to_jsonb\(f\)->>'kind' AS kind/, [{ kind: 'view' }]) } }),
  X('folder-not-found', 'POST ' + F + '/move', 400, { body: { chit_id: PARTY, folder_id: PARTY } }),
  X('wrong-side', 'POST ' + F + '/move', 400, { body: { chit_id: PARTY, folder_id: PARTY, direction: 'sent' }, setup: { sqlRows: answering(/SELECT scope FROM folder/, [{ scope: 'task' }]) } }),
  X('move-retried-without-scope', 'POST ' + F + '/move', 400, { body: { chit_id: PARTY, folder_id: PARTY }, setup: { sqlRows: raising(/SELECT scope FROM folder/, '42703') } }),
  X('switched-off-folder', 'GET ' + F + '/:id/chits', 404, { url: F + '/' + sysId('E-6000') + '/chits' }),
  X('switched-off-folder', 'GET ' + F + '/:id/metrics', 404, { url: F + '/' + sysId('E-6000') + '/metrics' }),
  X('system-rule-is-fixed', 'POST ' + F + '/:id/rules', 400, { url: F + '/' + sysId('B-2100') + '/rules', body: {} }),
  X('system-rule-shown', 'GET ' + F + '/:id/rules', 200, { url: F + '/' + sysId('B-2100') + '/rules' }),
  X('db-fails-with-a-rule', 'POST ' + F + '/:id/rules', 500, { body: { when: { doc: 'invoice' } }, setup: { db: 'fail' } }),
  X('condition-unknown', 'POST ' + F + '/:id/rules', 400, { body: BAD_WHEN }),
  X('rules-not-migrated', 'POST ' + F + '/:id/rules', 503, { body: { when: { doc: 'invoice' } }, setup: { sqlRows: raising(/INSERT INTO folder_rule/, '42P01') } }),
  X('rules-not-migrated', 'DELETE ' + F + '/rules/:rule_id', 503, { setup: { sqlRows: raising(/DELETE FROM folder_rule/, '42P01') } }),
  X('db-fails-with-a-change', 'PATCH ' + F + '/rules/:rule_id', 500, { body: { name: 'Mayur' }, setup: { db: 'fail' } }),
  X('rule-nothing-to-update', 'PATCH ' + F + '/rules/:rule_id', 400, { body: {} }),
  X('rule-condition-unknown', 'PATCH ' + F + '/rules/:rule_id', 400, { body: BAD_WHEN }),
  X('rule-not-found', 'PATCH ' + F + '/rules/:rule_id', 404, { body: { name: 'Mayur' } }),
  X('rule-update-not-migrated', 'PATCH ' + F + '/rules/:rule_id', 503, { body: { name: 'Mayur' }, setup: { sqlRows: raising(/UPDATE folder_rule/, '42P01') } }),
  X('preview-db-fails', 'POST ' + F + '/rules/preview', 500, { body: { when: { doc: 'invoice' } }, setup: { db: 'fail' } }),
  X('preview-condition-unknown', 'POST ' + F + '/rules/preview', 400, { body: BAD_WHEN }),
  X('rules-list-not-migrated', 'GET ' + F + '/rules', 200, { setup: { sqlRows: raising(/FROM folder_rule/, '42P01') } }),
  X('rule-id-not-an-id', 'PATCH ' + F + '/rules/:rule_id', 400, { url: F + '/rules/nope', body: { name: 'x' } }),
  X('rule-id-not-an-id', 'DELETE ' + F + '/rules/:rule_id', 400, { url: F + '/rules/nope' }),
  /* the inventory */
  X('not-the-owner', 'PUT ' + F + '/inventory/:code', 403, { setup: { who: STAFF }, body: { on: true } }),
  X('no-such-code', 'PUT ' + F + '/inventory/:code', 404, { url: F + '/inventory/nope', body: { on: true } }),
  X('nothing-to-switch', 'PUT ' + F + '/inventory/:code', 400, { body: {} }),
  X('on-not-true-or-false', 'PUT ' + F + '/inventory/:code', 400, { body: { on: 'yes' } }),
  X('track-always-on', 'PUT ' + F + '/inventory/:code', 400, { url: F + '/inventory/T', body: { on: false } }),
  X('level-unknown', 'PUT ' + F + '/inventory/:code', 400, { body: { msg: 'loud' } }),
  X('track-has-no-level', 'PUT ' + F + '/inventory/:code', 409, { url: F + '/inventory/T', body: { msg: 'none' } }),
  X('dispute-level-fixed', 'PUT ' + F + '/inventory/:code', 409, { url: F + '/inventory/DSP', body: { msg: 'none' } }),
  X('level-above-ceiling', 'PUT ' + F + '/inventory/:code', 409, { url: F + '/inventory/RT-4090', body: { msg: 'external' } }),
  X('switched', 'PUT ' + F + '/inventory/:code', 200, { body: { on: true } }),
  X('policy-fails', 'PUT ' + F + '/inventory/:code', 500, { body: { on: true }, patch: { policy: { set: async () => { throw new Error(SECRET_SQL); } } } }),
  X('policy-refuses', 'PUT ' + F + '/inventory/:code', 400, { body: { on: true }, patch: { policy: { set: async () => { throw Object.assign(new Error('Policy refuses that.'), { status: 400 }); } } } }),
  X('policy-not-migrated', 'PUT ' + F + '/inventory/:code', 503, { body: { on: true }, patch: { policy: { set: async () => { throw Object.assign(new Error('Policy flags are not migrated on this environment (b130).'), { status: 503 }); } } } }),
  /* messages, worklist, the rest of the reads */
  X('message-not-an-id', 'POST ' + F + '/messages/:message_id/mark', 400, { url: F + '/messages/nope/mark', body: { read: true } }),
  X('message-not-mine', 'POST ' + F + '/messages/:message_id/mark', 404, { body: { read: true } }),
  X('read-state-not-migrated', 'POST ' + F + '/messages/:message_id/mark', 503, { body: { read: true }, setup: { sqlRows: raising(/chit_message_mark/, '42883') } }),
  X('message-marked', 'POST ' + F + '/messages/:message_id/mark', 200, { body: { read: true }, setup: { sqlRows: answering(/chit_message_mark/, [{ n: 1 }]) } }),
  X('badge-count', 'GET ' + F + '/messages', 200, { url: F + '/messages?count=1' }),
  X('actor-sees-theirs', 'GET ' + F + '/messages', 200, { setup: { who: STAFF } }),
  X('due-date-not-a-date', 'GET ' + F + '/worklist', 400, { url: F + '/worklist?due_on=tomorrow' }),
  X('actor-worklist', 'GET ' + F + '/worklist', 200, { setup: { who: STAFF } }),
  X('groupsum-order', 'GET ' + F + '/groupsum', 200, { url: F + '/groupsum?scope=order&folder_id=' + PARTY + '&chit_ids=' + PARTY }),
  X('mis-since', 'GET ' + F + '/mis', 200, { url: F + '/mis?since=2026-01-01' }),
  X('mis-since-junk', 'GET ' + F + '/mis', 200, { url: F + '/mis?since=junk' }),
  X('reconcile-order', 'GET ' + F + '/reconcile', 200, { url: F + '/reconcile?scope=order' }),
  X('folders-before-b133', 'GET ' + F, 200, { setup: { sqlRows: raising(/f\.scope,/, '42703') } }),
  X('system-folders-fail', 'GET ' + F, 200, { patch: { views: { systemFolders: async () => { throw new Error(SECRET_SQL); } } } }),
  X('inventory-read', 'GET ' + F + '/inventory', 200, {}),
  X('vocabulary-answer-fails', 'GET ' + F + '/rules/vocabulary', 500, { setup: { jsonThrows: true } }),
  X('vocabulary', 'GET ' + F + '/rules/vocabulary', 200, {}),
  X('inventory-read-fails', 'GET ' + F + '/inventory', 500, { patch: { views: { flagsOf: async () => { throw new Error(SECRET_SQL); } } } }),
  /* the Home facts */
  X('no-such-card', 'GET /api/facts/:card', 404, { url: '/api/facts/nope' }),
  X('prototype-name-is-no-card', 'GET /api/facts/:card', 404, { url: '/api/facts/constructor' }),
  X('key-sees-no-figures', 'GET /api/facts/:card', 403, { setup: { asKey: true } }),
  X('key-sees-no-rail', 'GET /api/facts/rail/chits', 403, { setup: { asKey: true } }),
  X('card-builder-fails', 'GET /api/facts/:card', 500, { patch: { home: { BUILD: { till: async () => { throw new Error(SECRET_SQL); } } } } }),
  X('rail-builder-fails', 'GET /api/facts/rail/chits', 500, { patch: { home: { railChits: async () => { throw new Error(SECRET_SQL); } } } }),
  X('card-answers', 'GET /api/facts/:card', 200, { patch: { home: { BUILD: { till: async () => ({ lines: [] }) } } } }),
  /* pricing */
  X('no-lines', 'POST /api/pricing/price', 400, { setup: { who: OWNER }, body: {} }),
  X('lines-not-a-list', 'POST /api/pricing/price', 400, { body: { lines: 'tea' } }),
  X('key-has-pricing-scope', 'POST /api/pricing/price', 400, { setup: { asKey: true, keyScopes: ['pricing'] }, body: {} }),
  X('priced-with-structure', 'POST /api/pricing/price', 200, { body: { lines: [{ qty: 2, listPrice: 10, pricing: { kind: 'fixed', amount: 8 } }] } }),
  X('shelf-fails', 'POST /api/pricing/price', 500, { setup: { db: 'fail' }, body: { lines: [{ code: 'tea', qty: 1 }] } }),
  X('kinds-answer-fails', 'GET /api/pricing/kinds', 500, { setup: { jsonThrows: true } }),
  X('kinds', 'GET /api/pricing/kinds', 200, {})
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

/** the words of the planted SQL (SECRET_SQL), in any answer */
const LEAK = /vault|SELECT secret|relation "folder"/;
/** how many times a throwing stand-in was reached, by route: the scan must never pass on a scene whose throw was not reached */
const threwBy = {};

/**
 * the throwing scenes (API-STANDARD R2-3 a, T-2): the database under the route throws a BARE STRING with SQL in it, then every library the routes call throws an
 * Error carrying it, then a string. Each route is asked with a body that gets past its schema and its own refusals, so the library is what fails.
 */
const THROW_BODIES = {
  'POST /api/folders': { name: 'Mayur' },
  'PATCH /api/folders/:id': { name: 'Mayur' },
  'POST /api/folders/move': { chit_id: PARTY },
  'POST /api/folders/:id/rules': { when: { doc: 'invoice' } },
  'PATCH /api/folders/rules/:rule_id': { name: 'Mayur' },
  'POST /api/folders/rules/preview': { when: { doc: 'invoice' } },
  'POST /api/folders/messages/:message_id/mark': { read: true },
  'PUT /api/folders/inventory/:code': { on: true },
  'POST /api/pricing/price': { lines: [{ code: 'tea', qty: 1 }] }
};
const THROW_WORLDS = [
  { id: 'db-throws-a-string', setup: { db: 'throws-string' } },
  { id: 'libraries-throw-an-error', setup: { throwLibs: 'error' } },
  { id: 'libraries-throw-a-string', setup: { throwLibs: 'string' } }
];
const THROWING = new Set(THROW_WORLDS.map((one) => one.id));

/** routes that call no library the libraries scenes can break: only a failing db (or a failing answer) can reach them */
const LIBRARY_FREE = new Set(['POST /api/folders', 'PATCH /api/folders/:id', 'DELETE /api/folders/:id', 'POST /api/folders/move', 'POST /api/folders/messages/:message_id/mark']);
/** the throwing scenes of every route the router holds (a route with no library of its own is asked in the db scene only) */
function throwScenarios(routes) {
  const found = [];
  const bodyOf = (route) => THROW_BODIES[route] || (BODY_METHODS.includes(route.split(' ')[0]) ? {} : undefined);
  Object.keys(routes).sort().forEach((route) => THROW_WORLDS.filter((one) => one.setup.db || !LIBRARY_FREE.has(route)).forEach((one) => found.push({ id: one.id, route, url: urlOf(routes[route], false), body: bodyOf(route), setup: one.setup })));
  return found;
}

/** every scenario as { id, route, url, body, setup, extra } */
function scenariosOf(routes) {
  const generic = [];
  Object.keys(routes).sort().forEach((route) => {
    const method = route.split(' ')[0];
    WORLDS.forEach((one) => {
      if (one.badId && !routes[route].includes(':')) return;
      generic.push({ id: one.id, route, url: urlOf(routes[route], one.badId), body: BODY_METHODS.includes(method) ? {} : undefined, setup: one.setup });
    });
  });
  const extras = EXTRAS.map((one) => Object.assign({}, one, { url: one.url || urlOf(routes[one.route] || '', false), extra: true }));
  return generic.concat(extras.filter((one) => routes[one.route]));
}

/** a scenario that needs a row the stand-in db cannot make swaps one library function for its answer, then puts the real one back */
function applyPatch(patch) {
  const modules = {
    policy: require(path.join(HERE, 'lib', 'policy')),
    views: require(path.join(HERE, 'lib', 'folder-views')),
    home: require(path.join(HERE, 'lib', 'home-facts'))
  };
  const undo = [];
  Object.keys(patch || {}).forEach((which) => Object.keys(patch[which]).forEach((name) => {
    const given = patch[which][name];
    const owner = modules[which];
    if (name === 'BUILD') {
      Object.keys(given).forEach((card) => {
        undo.push([owner.BUILD, card, owner.BUILD[card]]);
        owner.BUILD[card] = given[card];
      });
      return;
    }
    undo.push([owner, name, owner[name]]);
    owner[name] = given;
  }));
  return () => undo.forEach(([owner, name, original]) => (owner[name] = original));
}

/** every library function the folders, Home-facts and pricing routes call, made to throw (an Error carrying the SQL, or the bare string); the function returned puts them back */
function throwingLibraries(kind) {
  const homeLib = require(path.join(HERE, 'lib', 'home-facts'));
  const lib = (name) => require(path.join(HERE, 'lib', name));
  const targets = [
    [lib('policy'), ['get', 'set']],
    [lib('folder-views'), ['flagsOf', 'switchesOf', 'whensOf', 'rowsFor', 'members', 'systemFolders', 'systemById']],
    [lib('folder-rules'), ['list', 'create', 'update', 'remove', 'preview']],
    [lib('assign'), ['byPerson']],
    [lib('groupsum'), ['requirement']],
    [lib('select'), ['rows']],
    [lib('services'), ['shelfOf']],
    [homeLib, ['railChits']],
    [homeLib.BUILD, Object.keys(homeLib.BUILD)]
  ];
  const thrower = async () => {
    world.threw++;
    throw kind === 'string' ? SECRET_SQL : new Error(SECRET_SQL);
  };
  const undo = [];
  targets.forEach(([owner, names]) => names.forEach((name) => {
    undo.push([owner, name, owner[name]]);
    owner[name] = thrower;
  }));
  return () => undo.forEach(([owner, name, original]) => (owner[name] = original));
}

async function runScenario(port, scenario) {
  Object.assign(world, FRESH, scenario.setup);
  const restore = world.throwLibs ? throwingLibraries(world.throwLibs) : applyPatch(scenario.patch);
  const method = scenario.route.split(' ')[0];
  const answer = await send(port, method, scenario.url, scenario.body === undefined && BODY_METHODS.includes(method) ? {} : scenario.body);
  restore();
  return Object.assign(answer, { threw: world.threw });
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
  (answer.status === 401 && scenario.id === 'signed-out') || (answer.status === 403 && /pricing\/price/.test(scenario.route) && scenario.setup && scenario.setup.asKey && !scenario.setup.keyScopes);
/** the statuses a test may see from a route, by the contract of the area that owns it */
function allowedFor() {
  const area = { '/api/folders': 'folders-contract.js', '/api/facts': 'facts-contract.js', '/api/pricing': 'pricing-contract.js' };
  const made = Object.fromEntries(Object.keys(area).map((mount) => [mount, require(path.join(HERE, 'lib', area[mount])).allowedStatuses()]));
  return (route) => made[MOUNTS.find((mount) => route.includes(' ' + mount + '/') || route.endsWith(' ' + mount))](route);
}

/** the shape of a 2xx the extras expect to be an answer, not a refusal: nothing to judge, only the status */
async function checkRoutes(port, scenarios, recording) {
  const tested = {};
  const allowed = argv.includes('--capture') ? null : allowedFor();
  for (const scenario of scenarios) {
    const answer = await runScenario(port, scenario);
    const label = scenario.route + ' · ' + scenario.id;
    recording[scenario.route + '|' + scenario.id] = { route: scenario.route, status: answer.status, body: answer.json, type: answer.type };
    threwBy[scenario.route] = (threwBy[scenario.route] || 0) + answer.threw;
    if (answer.status >= 400) (tested[scenario.route] = tested[scenario.route] || new Set()).add(answer.status);
    if (argv.includes('--capture')) continue;
    check(label + ': answers (not a hang)', answer.status !== 0);
    check(label + ': no word of the planted SQL in the answer, whatever its status (a 2xx included)', !LEAK.test(answer.text), answer.text.slice(0, 200));
    if (scenario.expect !== undefined) check(label + ': answers the status it is built to reach (' + scenario.expect + ')', answer.status === scenario.expect, [answer.status, answer.text.slice(0, 200)]);
    if (answer.status < 400) continue;
    check(label + ': ' + answer.status + ' is a status the contract declares for this route', allowed(scenario.route).includes(answer.status), allowed(scenario.route));
    if (inherited(scenario, answer)) continue;
    checkProblemBody(label, answer);
    if (answer.status >= 500 && THROWING.has(scenario.id)) check(label + ': a throwing scene answers 500 with the screen\'s label, never the thrown text', answer.status === 500 && answer.json && answer.json.status === 500, answer.json);
    if (answer.status >= 500) check(label + ': a 5xx says nothing of its cause', !/SELECT|vault|relation "/.test(answer.text), answer.text);
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
    if (one.status < 400 || (one.status === 401 && scenario === 'signed-out') || !one.body) return;
    if (one.status === 403 && /pricing\/price/.test(one.route) && scenario === 'key-asks') return; /* requireScope's own 403: not this route's answer */
    const entry = (file.routes[one.route] = file.routes[one.route] || { answers: [] });
    if (!entry.answers.some((answer) => answer.scenario === scenario)) entry.answers.push({ scenario, status: one.status, body_keys: one.body, fixture: one.body });
  });
  /* the routes already frozen keep their places in the file; this file's own are added after them, sorted */
  const theirs = Object.keys(file.routes).filter((route) => !MINE(route));
  file.routes = Object.fromEntries(theirs.concat(Object.keys(file.routes).filter(MINE).sort()).map((route) => [route, file.routes[route]]));
  fs.writeFileSync(LEGACY_FILE, JSON.stringify(file, null, 1) + '\n');
  console.log('froze ' + Object.keys(file.routes).filter(MINE).length + ' routes');
}

/** lib/folders-contract.js as a unit: the words of a refusal and of a fault, as the folders always said them */
function checkFolderWords() {
  console.log('\n-- lib/folders-contract.js: the folders refusals as a unit --');
  const words = require(path.join(HERE, 'lib', 'folders-contract.js'));
  const status = (code, text) => words.faultOf(Object.assign(new Error(text || 'Because.'), { status: code }), { id: 'r1' }, 'Rule create failed');
  [[400, 'FOLDER_BAD_REQUEST'], [404, 'NOT_FOUND'], [503, 'FOLDER_NOT_MIGRATED']].forEach(([code, name]) => {
    const spec = status(code);
    check('faultOf: a refusal with status ' + code + ' keeps its status, its words and the screen\'s label (' + name + ')', spec.status === code && spec.code === name && sameValue(spec.legacy, { error: 'Rule create failed', message: 'Because.' }), spec);
  });
  const odd = status(409);
  check('faultOf: any other status keeps its own status and says its words', odd.status === 409 && odd.legacy.message === 'Because.', odd);
  const server = status(502, SECRET_SQL);
  check('faultOf: a 5xx other than 503 says nothing of its cause', server.status === 500 && !JSON.stringify(server).includes('vault') && server.legacy.message !== SECRET_SQL, server);
  const plain = words.faultOf(new Error(SECRET_SQL), { id: 'r1' }, 'List failed');
  check('faultOf: anything else is a 500 INTERNAL that says nothing of its cause, the label kept', plain.status === 500 && plain.code === 'INTERNAL' && plain.legacy.error === 'List failed' && !JSON.stringify(plain).includes('vault'), plain);
  const invalid = words.invalidFolder([{ field: 'id', code: 'WRONG_VALUE', detail: 'x' }, { field: 'name', code: 'MISSING_FIELD', detail: 'y' }]);
  check('validation: the old { error, details } body, field by field, with the sentences express-validator gave', invalid.error === 'Validation failed' && sameValue(invalid.details, [{ field: 'id', message: 'Invalid value' }, { field: 'name', message: 'Invalid value' }]), invalid);
  const named = words.invalidFolder([{ field: 'name', code: 'MISSING_FIELD', detail: 'y' }], { name: 'Name required' });
  check('validation: a field the route gave its own sentence says it', named.details[0].message === 'Name required', named);
}

/**
 * the schemas that replaced the express-validator chains refuse exactly what the chains refused: an id must be a uuid, a name 1 to 60 characters once trimmed.
 * Run the chain itself and the schema on the same values. (The one difference is a name that is not text at all - a number, a list: the chain read it as text, the schema asks for text.)
 */
const NEWLINE = String.fromCharCode(10);
const TAB = String.fromCharCode(9);
const SMILE = String.fromCodePoint(0x1f600);
const E_ACUTE = String.fromCharCode(0xe9);
async function checkChainsAgree() {
  console.log(NEWLINE + '-- the schemas agree with the chains they replaced --');
  const { body, validationResult } = require('express-validator');
  const { bodyEngine } = require(path.join(HERE, 'middleware', 'validate'));
  const contract = require(path.join(HERE, 'lib', 'folders-contract.js'));
  const operation = contract.operationFor('POST /');
  const schema = operation.requestBody.content['application/json'].schema;
  const ok = bodyEngine.compile(schema);
  const chainOk = async (value) => {
    const request = { body: { name: value } };
    await body('name').trim().isLength({ min: 1, max: 60 }).run(request);
    return validationResult(request).isEmpty();
  };
  const names = ['', ' ', '   ', 'a', ' a ', 'Mayur', 'x'.repeat(59), 'x'.repeat(60), 'x'.repeat(61), ' ' + 'x'.repeat(60) + ' ', '  ' + 'x'.repeat(61) + '  ', 'a b', 'a' + TAB + 'b', NEWLINE + ' a ' + NEWLINE, SMILE.repeat(60), SMILE.repeat(61), E_ACUTE.repeat(60), E_ACUTE.repeat(61)];
  let disagree = [];
  for (const value of names) if ((await chainOk(value)) !== ok({ name: value })) disagree.push(JSON.stringify(value).slice(0, 30));
  check('the name schema and the chain agree on ' + names.length + ' names (empty, spaces, edges at 60/61, emoji)', disagree.length === 0, disagree);
  const idChain = async (value) => {
    const { param } = require('express-validator');
    const request = { params: { id: value } };
    await param('id').isUUID().run(request);
    return validationResult(request).isEmpty();
  };
  const idOk = bodyEngine.compile(contract.UUID_SCHEMA);
  const ids = ['', 'nope', '11111111-2222-4333-8444-555555555555', '11111111-2222-3333-4444-555555555555', 'AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE', '11111111222243338444555555555555', '11111111-2222-4333-8444-55555555555', '11111111-2222-4333-8444-5555555555555', '0e763a46-401c-5eb1-a107-f96037c680e1', 'g1111111-2222-4333-8444-555555555555', ' 11111111-2222-4333-8444-555555555555', '00000000-0000-0000-0000-000000000000'];
  disagree = [];
  for (const value of ids) if ((await idChain(value)) !== idOk(value)) disagree.push(value);
  check('the uuid schema and isUUID() agree on ' + ids.length + ' ids (case, dashes, length, a system folder v5 id, the nil id)', disagree.length === 0, disagree);
}

/** the contracts of the Home facts and of pricing: every row is a real route, a public route has no sign-in, a gated one says its gate */
function checkOtherContracts() {
  console.log('\n-- lib/facts-contract.js · lib/pricing-contract.js --');
  const pricing = require(path.join(HERE, 'lib', 'pricing-contract.js'));
  const kinds = pricing.OPERATIONS['GET /api/pricing/kinds'];
  check('pricing: the kinds list is public: no credentials asked, so no 401 declared', !kinds.security.length && !('401' in kinds.responses), Object.keys(kinds.responses));
  const price = pricing.OPERATIONS['POST /api/pricing/price'];
  check('pricing: the price call takes a session or a key, and a key must have the pricing scope (403)', price.security.length === 2 && '403' in price.responses, price.security);
  const facts = require(path.join(HERE, 'lib', 'facts-contract.js'));
  check('facts: both routes are for a signed-in person and say a key is refused (403)', Object.values(facts.OPERATIONS).every((operation) => '403' in operation.responses && '401' in operation.responses));
}

/** lib/contract-kit.js as built for this sweep: a public row, and a schema that refuses with the status a route always used */
function checkKitWidening() {
  console.log('\n-- lib/contract-kit.js: public rows and the status of the schema refusal --');
  const kit = require(path.join(HERE, 'lib', 'contract-kit.js'));
  const contract = kit.contractOf({ mount: '/api/x', routes: { 'GET /open': { summary: 'Open', public: true }, 'POST /thing/:id': { summary: 'Change', invalid: 400, body: ['name'] }, 'GET /thing': { summary: 'Read', query: ['page'] } } });
  const open = contract.OPERATIONS['GET /api/x/open'];
  check('kit: a public row asks for no credentials and declares no 401', sameValue(open.security, []) && !('401' in open.responses), open);
  const change = contract.OPERATIONS['POST /api/x/thing/:id'];
  check('kit: a row that says invalid: 400 declares 400, not 422, for its schema refusal', '400' in change.responses && !('422' in change.responses), Object.keys(change.responses));
  check('kit: a row that says nothing still declares 422', '422' in contract.OPERATIONS['GET /api/x/thing'].responses);
}

/**
 * the premise of every scan above: the route list is the router's own and is not empty (a scan over nothing passes), it is the register's list for these three
 * files, every contract operation has a route, and every route met a THROWING stand-in at least once (a scan whose throw was never reached proves nothing)
 */
function checkPremise(routes) {
  console.log('\n-- the premise: a scan never passes on an empty list or on a throw that was not reached --');
  const keys = Object.keys(routes).sort();
  check('the route list is not empty (' + keys.length + ' routes read from the three routers)', keys.length > 0, keys);
  const register = JSON.parse(fs.readFileSync(path.join(HERE, 'docs', 'api-register.json'), 'utf8')).routes.filter((row) => MINE(row.key)).map((row) => row.key).sort();
  check('the routers hold exactly the routes the register lists for routes/folders.js · routes/facts.js · routes/pricing.js', sameValue(keys, register), { router: keys.length, register: register.length });
  const operations = ['folders', 'facts', 'pricing'].flatMap((area) => Object.keys(require(path.join(HERE, 'lib', area + '-contract.js')).OPERATIONS));
  check('every operation a contract declares has a route (' + operations.length + ' operations)', operations.every((key) => routes[key]), operations.filter((key) => !routes[key]));
  const unreached = keys.filter((key) => !threwBy[key]);
  check('every route met a throwing stand-in at least once, so the scan of its answers is about a real throw', unreached.length === 0, unreached);
  check('negative control: the scan sees the planted SQL when it is in a body, and not when it is absent', LEAK.test(JSON.stringify({ message: SECRET_SQL })) && !LEAK.test(JSON.stringify({ error: 'Failed', message: 'Something went wrong' })));
}

/** a 2xx is never a Problem: a success keeps its own shape (R2-3 a) */
function checkSuccessNotProblem(recording) {
  const successes = Object.keys(recording).filter((key) => recording[key].status < 400);
  check('a 2xx is never a Problem: every one of the ' + successes.length + ' success answers keeps its own shape', successes.length > 0 && successes.every((key) => !/problem\+json/.test(recording[key].type)), successes.filter((key) => /problem\+json/.test(recording[key].type)));
}

/**
 * every frozen 5xx (a 500 that names the screen, a 503 "not migrated yet") is replayed: the same status, every old key, byte for byte and in order
 * (the harness judges a 5xx as "says nothing of its cause" and would not notice a changed word)
 */
function checkFrozenServerAnswers(recording) {
  console.log('\n-- the frozen 5xx answers are replayed word for word --');
  const legacy = JSON.parse(fs.readFileSync(LEGACY_FILE, 'utf8')).routes;
  let replayed = 0;
  Object.keys(legacy).filter(MINE).forEach((route) => legacy[route].answers.filter((frozen) => frozen.status >= 500).forEach((frozen) => {
    const now = recording[route + '|' + frozen.scenario];
    const order = Object.keys(frozen.fixture);
    replayed++;
    check(route + ' · ' + frozen.scenario + ': the frozen ' + frozen.status + ' body is kept, key by key and in order', !!now && now.status === frozen.status && !!now.body && sameValue(order.map((name) => now.body[name]), order.map((name) => frozen.fixture[name])) && sameValue(Object.keys(now.body).slice(0, order.length), order), now && now.body);
  }));
  check('at least thirty frozen 5xx answers were replayed (' + replayed + ': the 500 of every route and the 503 of an update not run)', replayed >= 30, replayed);
}

/* ── the 9th world: signed in as another shop (API-STANDARD S35, tests/lib/foreign-id-world.cjs) ─────────────── */
const FOLDER_A = '55555555-5555-4555-8555-555555555555';
const FOLDER_B = '66666666-6666-4666-8666-666666666666';
const FOLDER_C = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const RULE_A = '77777777-7777-4777-8777-777777777777';
const MESSAGE_A = '88888888-8888-4888-8888-888888888888';
const RULE_ROW = { rule_id: RULE_A, folder_id: FOLDER_A, name: 'Mayur', when: { doc: 'invoice' }, enabled: true, sort: 0, stop_processing: false, match_count: 0 };
/** a row that only shop A client can read (what the WHERE entity_id = $n of the query and the row policy give) */
const ownedByA = (pattern, rows, rowCount) => ({ pattern, owner: SHOP, rows, rowCount });
const HOME_TILL = { home: { BUILD: { till: async () => ({ lines: [] }) } } };
/**
 * what each id route is expected to show, and why:
 *   holds        another shop's id answers the 404 an unknown id answers, byte for byte; the owner's own id is not a 404
 *   unknown-200  the route answers 200 for an unknown id (no row touched), so another shop's id gets that same 200; nothing leaks, and the column cannot pass (API-4c 2b, cb-finance)
 *   name         the path holds a NAME that is the same for every shop (a Home card, an inventory code), not a record: no foreign id exists (a public_ids candidate; cb-security decides)
 *   leak         another shop's id is answered differently from an unknown id (FINDING, not fixed here)
 */
const ID_ROUTES = [
  { route: 'DELETE /api/folders/:id', method: 'DELETE', url: () => F + '/' + FOLDER_A, expect: 'unknown-200', plant: [ownedByA(/DELETE FROM folder WHERE/, [], 1)] },
  { route: 'DELETE /api/folders/rules/:rule_id', method: 'DELETE', url: () => F + '/rules/' + RULE_A, expect: 'unknown-200', plant: [ownedByA(/DELETE FROM folder_rule/, [], 1)] },
  { route: 'GET /api/facts/:card', method: 'GET', url: (planted) => '/api/facts/' + (planted ? 'till' : 'nope'), expect: 'name', patch: HOME_TILL },
  { route: 'GET /api/folders/:id/chits', method: 'GET', url: () => F + '/' + FOLDER_A + '/chits', expect: 'unknown-200', plant: [ownedByA(/FROM chit_status cs/, [{ chit_id: PARTY, direction: 'received', current_status: 'sent', _total: '1' }])] },
  { route: 'GET /api/folders/:id/metrics', method: 'GET', url: () => F + '/' + FOLDER_A + '/metrics', expect: 'unknown-200', plant: [ownedByA(/SELECT scope FROM folder WHERE/, [{ scope: 'task' }])] },
  { route: 'GET /api/folders/:id/rules', method: 'GET', url: () => F + '/' + FOLDER_A + '/rules', expect: 'unknown-200', plant: [ownedByA(/FROM folder_rule WHERE/, [RULE_ROW])] },
  { route: 'PATCH /api/folders/:id', method: 'PATCH', url: () => F + '/' + FOLDER_A, body: { name: 'Mayur' }, expect: 'holds', plant: [ownedByA(/UPDATE folder SET/, [FOLDER_ROW({ folder_id: FOLDER_A })])] },
  { route: 'PATCH /api/folders/rules/:rule_id', method: 'PATCH', url: () => F + '/rules/' + RULE_A, body: { name: 'Mayur' }, expect: 'holds', plant: [ownedByA(/UPDATE folder_rule SET/, [RULE_ROW])] },
  {
    route: 'POST /api/folders/:id/rules', method: 'POST', url: () => F + '/' + FOLDER_A + '/rules', body: { when: { doc: 'invoice' } }, expect: 'leak',
    /* the rule table's foreign key to the folder table: it checks the folder EXISTS whoever owns it (referential-integrity checks bypass row security), and the insert names no owner check */
    sqlRows: (planted) => (sql, params) => {
      if (!/INSERT INTO folder_rule/.test(sql)) return null;
      if (!(planted && params[1] === FOLDER_A)) throw sqlError('23503');
      return { rows: [RULE_ROW], rowCount: 1 };
    }
  },
  { route: 'POST /api/folders/messages/:message_id/mark', method: 'POST', url: () => F + '/messages/' + MESSAGE_A + '/mark', body: { read: true }, expect: 'holds', plant: [ownedByA(/chit_message_mark/, [{ n: 1 }])] },
  { route: 'PUT /api/folders/inventory/:code', method: 'PUT', url: (planted) => F + '/inventory/' + (planted ? 'B-2100' : 'nope'), body: { on: true }, expect: 'name' }
];

/** one ask of the foreign-id world: shop B (the stranger) or shop A (the owner), with shop A's record planted or not */
async function askForeign(port, one, who, planted) {
  Object.assign(world, FRESH, { who: who === 'owner' ? OWNER : STRANGER, plant: planted ? one.plant || [] : [], sqlRows: one.sqlRows ? one.sqlRows(planted) : null });
  const restore = applyPatch(one.patch);
  const answer = await send(port, one.method, one.url(planted), one.body === undefined && BODY_METHODS.includes(one.method) ? {} : one.body);
  restore();
  return answer;
}

/** what the three asks showed, in one word: holds · name · unknown-200 · leak · other */
function classify(shown) {
  const { unknown, foreign: other, own } = shown;
  const alike = (left, right) => foreign.comparable(left) === foreign.comparable(right);
  if (unknown.status === 404 && other.status === 404 && alike(other, unknown) && own.status !== 404) return 'holds';
  if (unknown.status === 404 && other.status === own.status && other.status < 300 && alike(other, own)) return 'name';
  if (unknown.status < 300 && other.status === unknown.status && alike(other, unknown)) return 'unknown-200';
  if (other.status < 300 && unknown.status >= 500) return 'leak';
  return 'other';
}

/** the foreign-id world on the eleven routes addressed by an id or a name; returns the routes that held, for the evidence file */
async function foreignWorld(port) {
  console.log('\n-- the 9th world: signed in as another shop (' + ID_ROUTES.length + ' routes addressed by an id or a name) --');
  const cases = ID_ROUTES.map((one) => ({ route: one.route, play: (who, planted) => askForeign(port, one, who, planted) }));
  const seen = foreign.recorder();
  const failures = await foreign.runCases(cases, seen.record);
  for (const one of ID_ROUTES) {
    const shown = { unknown: await askForeign(port, one, 'stranger', false), foreign: await askForeign(port, one, 'stranger', true), own: await askForeign(port, one, 'owner', true) };
    const kind = classify(shown);
    console.log('  foreign id · ' + one.route + ': unknown ' + shown.unknown.status + ' · another shop\'s ' + shown.foreign.status + ' · own ' + shown.own.status + ' → ' + kind + (kind === 'leak' ? ' (FINDING for cb-security: the answers differ)' : ''));
    check(one.route + ': the world shows what is recorded for it (' + one.expect + ')', kind === one.expect, kind);
    check(one.route + ': the column is proved exactly for the routes that hold', (kind === 'holds') === !failures.some((sentence) => sentence.startsWith(one.route + ':')), failures.filter((sentence) => sentence.startsWith(one.route + ':')));
  }
  check('three of the eleven id routes hold (another shop\'s id is the unknown id\'s 404, byte for byte)', Object.keys(seen.proved()).length === ID_ROUTES.filter((one) => one.expect === 'holds').length, Object.keys(seen.proved()));
  return seen.proved();
}

/**
 * ids in the BODY: the caller's own second folder is planted beside another shop's (R2-2 (8), T-13). A parent or a folder named in a body must be answered
 * for another shop's id exactly as for an unknown one. POST /api/folders (parent_id) and POST /api/folders/move (folder_id) look the folder up under the caller's shop and do.
 * PATCH /api/folders/:id parent_id does not look it up: the foreign key accepts any folder that exists, whoever owns it (FINDING, printed, not fixed here).
 */
async function bodyIdWorld(port) {
  console.log('\n-- ids in the body: the caller\'s own second folder, another shop\'s folder, and an unknown one --');
  const ask = async (method, url, body, rows) => {
    Object.assign(world, FRESH, { who: STRANGER, sqlRows: rows || null, plant: [ownedByA(/SELECT 1 FROM folder WHERE/, [{ '?column?': 1 }]), ownedByA(/SELECT scope FROM folder WHERE/, [{ scope: 'task' }])] });
    return send(port, method, url, body);
  };
  const create = (parent) => ask('POST', F, { name: 'Mayur', parent_id: parent });
  const [foreignParent, unknownParent] = [await create(FOLDER_A), await create('99999999-9999-4999-8999-999999999999')];
  check('POST /api/folders: another shop\'s folder as the parent answers exactly as an unknown parent (400, same body)', foreignParent.status === 400 && foreign.comparable(foreignParent) === foreign.comparable(unknownParent), [foreignParent.status, unknownParent.status]);
  const move = (folder) => ask('POST', F + '/move', { chit_id: PARTY, folder_id: folder });
  const [foreignFolder, unknownFolder] = [await move(FOLDER_A), await move('99999999-9999-4999-8999-999999999999')];
  check('POST /api/folders/move: another shop\'s folder answers exactly as an unknown folder (400, same body)', foreignFolder.status === 400 && foreign.comparable(foreignFolder) === foreign.comparable(unknownFolder), [foreignFolder.status, unknownFolder.status]);
  /* the table as PostgreSQL has it: shop B owns FOLDER_B and FOLDER_C (its own second folder); folder.parent_id has a foreign key to folder(folder_id) that checks existence under any owner */
  const exists = new Set([FOLDER_A, FOLDER_B, FOLDER_C]);
  const patch = (parent) => ask('PATCH', F + '/' + FOLDER_B, { parent_id: parent }, (sql, params) => {
    if (!/UPDATE folder SET/.test(sql)) return null;
    if (!exists.has(params[0])) throw sqlError('23503');
    return { rows: [FOLDER_ROW({ folder_id: FOLDER_B, parent_id: params[0] })], rowCount: 1 };
  });
  const [own, other, unknown] = [await patch(FOLDER_C), await patch(FOLDER_A), await patch('99999999-9999-4999-8999-999999999999')];
  const same = foreign.comparable(other) === foreign.comparable(unknown);
  console.log('  body id · PATCH /api/folders/:id parent_id: own second folder ' + own.status + ' · another shop\'s folder ' + other.status + ' · unknown folder ' + unknown.status + (same ? '' : ' → FINDING for cb-security: the answers differ'));
  check('PATCH /api/folders/:id parent_id: the three asks answered (the stand-in reached the update)', own.status === 200 && other.status > 0 && unknown.status > 0, [own.status, other.status, unknown.status]);
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
    if (world.jsonThrows) {
      /* the answer cannot be written: the first res.json that is not a Problem throws, as a body that cannot be serialised would */
      const write = res.json.bind(res);
      let armed = true;
      res.json = (body) => {
        if (armed && !/problem/.test(String(res.get('Content-Type') || ''))) {
          armed = false;
          world.threw++;
          throw new Error(SECRET_SQL);
        }
        return write(body);
      };
    }
    next();
  });
  app.use(express.json());
  mounted.forEach((one) => app.use(one.mount, one.router));
  const server = app.listen(0);
  const recording = {};
  const port = server.address().port;
  const tested = await checkRoutes(port, scenariosOf(routes).concat(throwScenarios(routes)), recording);
  if (flagValue('--capture')) {
    server.close();
    fs.writeFileSync(flagValue('--capture'), JSON.stringify(recording, null, 1));
    console.log('captured ' + Object.keys(recording).length + ' answers over ' + Object.keys(routes).length + ' routes');
    process.exit(0);
  }
  checkFolderWords();
  await checkChainsAgree();
  checkOtherContracts();
  checkKitWidening();
  checkPremise(routes);
  checkSuccessNotProblem(recording);
  checkFrozenServerAnswers(recording);
  const proved = await foreignWorld(port);
  await bodyIdWorld(port);
  server.close();
  const legacy = JSON.parse(fs.readFileSync(LEGACY_FILE, 'utf8')).routes;
  const frozen = Object.keys(legacy).filter(MINE).reduce((sum, route) => sum + legacy[route].answers.length, 0);
  check('every refusal recorded before the sweep is replayed against the code: ' + frozen + ' answers, each once, byte for byte', frozen > 100, frozen);
  const answers = Object.values(recording);
  check('a caller who is not signed in is refused with 401 on every route that asks for sign-in', Object.keys(recording).filter((key) => key.endsWith('|signed-out')).every((key) => recording[key].status === 401 || /pricing\/kinds/.test(key)));
  check('a 500 never says its cause: no answer of any route carries the database text', answers.every((one) => !JSON.stringify(one.body || {}).includes('vault')));
  const coverage = Object.fromEntries(Object.keys(tested).sort().map((route) => [route, [...tested[route]].sort((a, b) => a - b)]));
  const onDisk = JSON.parse(fs.readFileSync(TESTED_FILE, 'utf8'));
  const mine = Object.fromEntries(Object.keys(onDisk).filter(MINE).sort().map((route) => [route, onDisk[route]]));
  if (argv.includes('--write')) {
    const others = Object.fromEntries(Object.keys(onDisk).filter((route) => !MINE(route)).map((route) => [route, onDisk[route]]));
    const merged = Object.assign(others, coverage);
    fs.writeFileSync(TESTED_FILE, JSON.stringify(Object.fromEntries(Object.keys(merged).sort().map((route) => [route, merged[route]])), null, 1) + '\n');
    foreign.writeEvidence(EVIDENCE_FILE, MINE, proved);
  } else {
    check('docs/contracts/api-hardening-evidence-areas.json says foreign_id_404 for exactly the routes that held here', sameValue(foreign.evidenceOf(EVIDENCE_FILE, MINE), proved), { onDisk: Object.keys(foreign.evidenceOf(EVIDENCE_FILE, MINE)), held: Object.keys(proved) });
    check('docs/contracts/api-error-tests.json lists exactly the statuses these scenarios cover for routes/folders.js · routes/facts.js · routes/pricing.js', sameValue(mine, coverage), { onDisk: Object.keys(mine).length, covered: Object.keys(coverage).length });
  }
  console.log('\n  ' + passed + ' checks, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
