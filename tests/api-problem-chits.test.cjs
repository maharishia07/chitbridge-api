#!/usr/bin/env node
/**
 * api-problem-chits.test.cjs — API-4 sweep, chits: every refusal of routes/chits.js is a Problem body AND still carries the keys it answered before.
 *
 * OWNS      the proof that each refusal of the 60 chit routes is a Problem body and still carries the keys it answered before (docs/contracts/api-legacy.json, recorded from the
 *           code before the sweep), the proof that no success answer changed, and this file's rows of docs/contracts/api-error-tests.json (the statuses each route is tested for,
 *           which the register's error_tests column reads). Also: no answer outside the statuses the route's contract declares (lib/chits-contract.js), every code a refusal
 *           carries is a row of the error-code table, and the contract's words and schemas as units (the schemas agree with the express-validator chains they replaced).
 * CALLED BY scripts/guards.cjs · CI. No database, no network: the real route file (routes/chits.js) over a stand-in db and auth.
 * FLOW      route list (read from the router itself) x world (signed out, a key, staff, a bad id, a failing db, an empty db) + the named extras
 *           → real route → body → Problem fields present · frozen legacy keys equal · no leak on a 5xx · statuses tested → manifest
 *
 *   node tests/api-problem-chits.test.cjs                    check
 *   node tests/api-problem-chits.test.cjs --write            rewrite this file's rows of docs/contracts/api-error-tests.json
 *   node tests/api-problem-chits.test.cjs --capture F        (run on the code BEFORE the change) record each answer, every route, every status, to file F
 *   node tests/api-problem-chits.test.cjs --compare F        replay the scenarios on this code and compare each answer with the capture F: the old keys in the old order, byte for byte
 *   node tests/api-problem-chits.test.cjs --freeze F         merge the refusals of a capture F (for the routes the contract holds) into docs/contracts/api-legacy.json
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
const MOUNT = '/api/chits';
/** the route file this mount serves (named in full so the graph links this test to it) */
const ROUTE_FILE = 'routes/chits.js';
const MINE = (route) => route.includes(' ' + MOUNT + '/') || route.endsWith(' ' + MOUNT);
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
const OTHER = '33333333-3333-4333-8333-333333333333';
const STAFF_ID = '44444444-4444-4444-8444-444444444444';
const OWNER = { identity_id: SHOP, identity_type: 'entity', display_name: 'Test shop', bridge_id: 'TESTSHOP' };
const STAFF = { identity_id: STAFF_ID, parent_entity_id: SHOP, identity_type: 'actor', access_level: 'editor', display_name: 'Test staff', bridge_id: 'TESTSHOP' };
const VIEWER = Object.assign({}, STAFF, { access_level: 'viewer' });
const SECRET_SQL = 'relation "chit_header" does not exist -- SELECT secret FROM vault';
const FRESH = { realAuth: false, who: OWNER, asKey: false, keyScopes: ['till'], db: 'ok', sqlRows: null, jsonThrows: false, migrated: false };
const world = Object.assign({}, FRESH);

/** the rows a statement gets: a scenario's own rows first, then nothing (or the secret failure when the db is down) */
function rowsFor(sql) {
  if (world.sqlRows) {
    const given = world.sqlRows(String(sql));
    if (given) return given;
  }
  if (world.db === 'fail') throw new Error(SECRET_SQL);
  if (world.migrated && /information_schema/.test(sql)) return { rows: [{ '?column?': 1 }], rowCount: 1 }; /* lib/schema: every table and column is there */
  if (/SELECT COUNT\(/i.test(sql)) return { rows: [{ count: '0' }], rowCount: 1 }; /* a count of nothing is 0, not no row */
  return { rows: [], rowCount: 0 };
}
const mock = (relative, exported) => {
  const file = require.resolve(path.join(HERE, relative));
  require.cache[file] = { id: file, filename: file, loaded: true, exports: exported };
};
/** an error the way pg raises one: a message and a SQLSTATE code */
const sqlError = (code) => Object.assign(new Error('pg ' + code), { code });

function installStubs() {
  const client = { query: async (sql) => rowsFor(sql) };
  const textOfStatement = (statement) => (typeof statement === 'string' ? statement : (statement && (statement.text || statement.sql)) || '');
  const known = {
    query: async (sql) => rowsFor(sql),
    withEntity: async (id, run) => run(client),
    withTransaction: async (run) => run(client),
    onEntity: async (id, db, run) => run(client),
    readBatch: async (id, statements) => (statements || []).map((statement) => rowsFor(textOfStatement(statement))),
    trySavepoint: async (db, run, fallback) => {
      try {
        return await run(db);
      } catch (failure) {
        return fallback;
      }
    }
  };
  const db = new Proxy(known, { get: (target, name) => (name in target ? target[name] : typeof name === 'symbol' || name === 'then' ? undefined : async () => ({ rows: [], rowCount: 0 })) });
  mock('db', db);
  mock('db/index', db);
  const realAuth = require(path.join(HERE, 'middleware', 'auth'));
  const { holderOf } = require(path.join(HERE, 'lib', 'holder'));
  const stubAuth = (req, res, next) => {
    if (world.realAuth) return realAuth(req, res, next);
    req.identity = world.who;
    if (world.asKey) {
      req.api_key = { jti: 'j1', scopes: world.keyScopes };
      req.till = holderOf({ kind: 'api_key', jti: 'j1', scopes: world.keyScopes }, {}, null);
    } else req.till = holderOf(Object.assign({ kind: 'session' }, world.who), null, null);
    return next();
  };
  mock('middleware/auth', Object.assign(stubAuth, realAuth, { entityOf: (req) => req.identity.parent_entity_id || req.identity.identity_id }));
  console.error = () => undefined; /* the routes log a 5xx here; the scenarios read the answer */
  const say = console.log;
  console.log = (...parts) => (typeof parts[0] === 'string' && parts[0].startsWith('{"t":') ? undefined : say(...parts)); /* the structured log lines (lib/logger) are not this test's output */
}

/* ── the scenarios: every route the router holds x the worlds, then the named extras ─────────────────────── */
const PARAM_VALUES = { id: PARTY, chit_id: PARTY, subject_id: PARTY, raida_id: PARTY, dispute_id: PARTY, from: PARTY };
const WORLDS = [
  { id: 'signed-out', setup: { realAuth: true } },
  { id: 'key-asks', setup: { asKey: true } },
  { id: 'staff-asks', setup: { who: STAFF } },
  { id: 'bad-id', setup: {}, badId: true },
  { id: 'db-fails', setup: { db: 'fail' } },
  { id: 'nothing-found', setup: {} }
];
const BODY_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'];

/** { 'METHOD /full/path': template } for every route the router holds, read from the router itself */
function routesOf(router, mount) {
  const found = {};
  router.stack
    .filter((layer) => layer.route)
    .forEach((layer) =>
      Object.keys(layer.route.methods).forEach((method) => {
        const full = layer.route.path === '/' ? mount : mount + layer.route.path;
        found[method.toUpperCase() + ' ' + full] = full;
      })
    );
  return found;
}
const urlOf = (template, bad) => template.replace(/:(\w+)/g, (all, name) => (bad ? 'nope' : PARAM_VALUES[name] || PARTY));

/** the extras: an answer the generic worlds cannot reach (a named refusal inside a handler) */
const X = (id, route, status, extra) => Object.assign({ id, route, expect: status, setup: {} }, extra);
/** a stand-in db that raises one SQLSTATE for statements matching a pattern */
const raising = (pattern, code) => (sql) => {
  if (pattern.test(sql)) throw sqlError(code);
  return null;
};
/** a stand-in db that answers one statement with given rows */
const answering = (pattern, rows) => (sql) => (pattern.test(sql) ? { rows, rowCount: rows.length } : null);
/** several answers at once: the first pattern that matches gives its rows */
const answeringAll = (pairs) => (sql) => {
  const found = pairs.find(([pattern]) => pattern.test(sql));
  return found ? { rows: found[1], rowCount: found[1].length } : null;
};
/** a stand-in db that fails with text a caller must never see, for statements matching a pattern */
const breaking = (pattern) => (sql) => {
  if (pattern.test(sql)) throw new Error(SECRET_SQL);
  return null;
};
const C = MOUNT;
const COPY_ROW = { entity_id: SHOP, '?column?': 1 };
const CHIT_ROW = { chit_id: PARTY, all_recipients: [{ entity_id: SHOP, display_name: 'Test shop' }, { entity_id: OTHER, display_name: 'Other shop', role: 'Act' }], purpose: 'order', created_at: '2026-10-01T00:00:00.000Z', role: 'Sent' };
const EXTRAS = [
  /* ── the lists and the read ── */
  X('a-chit-is-listed', 'GET ' + C + '/sent', 200, { setup: { sqlRows: answering(/SELECT ch.chit_id, ch.all_recipients/, [CHIT_ROW]) } }),
  X('a-chit-is-in-the-inbox', 'GET ' + C + '/inbox', 200, { url: C + '/inbox?status=pending&q=tea&folder_id=' + PARTY, setup: { sqlRows: answering(/SELECT ch.chit_id/, [CHIT_ROW]) } }),
  X('a-draft-is-listed', 'GET ' + C + '/folder', 200, { url: C + '/folder?view=trash&sort=amount&dir=asc&date_from=2026-01-01', setup: { sqlRows: answering(/SELECT DISTINCT ON/, [CHIT_ROW]) } }),
  X('rollup-by-state', 'GET ' + C + '/rollup', 200, { url: C + '/rollup?group_by=state&direction=sent&assigned_to=me' }),
  X('unread-for-staff', 'GET ' + C + '/unread', 200, { setup: { who: STAFF, sqlRows: answering(/chit_reads/, [{ chit_id: PARTY }]) } }),
  X('unread-for-staff-fails', 'GET ' + C + '/unread', 500, { setup: { who: STAFF, db: 'fail' } }),
  X('pulse-answers', 'GET ' + C + '/pulse', 200, { setup: { sqlRows: answering(/MAX(created_at)/, [{ h: '2026-10-01T00:00:00.000Z', s: null, c: null, n: 3 }]) } }),
  X('costs-not-migrated', 'GET ' + C + '/:chit_id/costs', 503, { patch: { cost: { canRead: async () => true, read: async () => null } } }),
  X('costs-read', 'GET ' + C + '/:chit_id/costs', 200, { patch: { cost: { canRead: async () => true, read: async () => ({ rows: [], total: null }) } } }),
  X('not-a-bill', 'GET ' + C + '/:chit_id/use', 409, { patch: { 'tax-copy': { copyOf: async () => ({ current_status: 'pending' }), billReceived: () => false } } }),
  X('use-read', 'GET ' + C + '/:chit_id/use', 200, { patch: { 'tax-copy': { copyOf: async () => ({ current_status: 'pending' }), billReceived: () => true }, 'bill-use': { forCopy: async () => ({ lines: [] }) } } }),
  X('overlay-without-a-catalogue', 'GET ' + C + '/:chit_id/catalogue-overlay', 200, { url: C + '/' + PARTY + '/catalogue-overlay?q=milk&comment=fresh' }),
  X('messages-of-a-participant', 'GET ' + C + '/:chit_id/messages', 200, { url: C + '/' + PARTY + '/messages?thread_type=external&dispute=1&line_id=' + OTHER, setup: { sqlRows: answeringAll([[/SELECT 1 FROM chit_status/, [COPY_ROW]], [/FROM chit_messages/, [{ message_id: OTHER, message_text: 'Hello' }]]]) } }),
  X('messages-table-missing', 'GET ' + C + '/:chit_id/messages', 200, { setup: { sqlRows: (sql) => { throw Object.assign(new Error('relation "chit_messages" does not exist'), { code: '42P01' }); } } }),
  X('disputes-of-a-participant', 'GET ' + C + '/:chit_id/disputes', 200, { setup: { sqlRows: answeringAll([[/SELECT entity_id FROM chit_status/, [COPY_ROW]], [/SELECT all_recipients FROM chit_header/, [CHIT_ROW]]]) } }),
  X('disputes-table-missing', 'GET ' + C + '/:chit_id/disputes', 200, { setup: { sqlRows: (sql) => { throw Object.assign(new Error('relation "chit_disputes" does not exist'), { code: '42P01' }); } } }),
  X('diagnosis-of-a-participant', 'GET ' + C + '/:chit_id/diagnosis', 200, { setup: { sqlRows: answeringAll([[/SELECT 1 FROM chit_status/, [COPY_ROW]], [/FROM chit_header/, [{ auto_subject: 'Order', schema_version: 2 }]], [/FROM chit_detail/, [{ line_items: [{ particulars: 'Tea' }] }]], [/FROM chit_disputes/, [{ dispute_id: OTHER, category: 'quality', status: 'open', mode: 'two_sided' }]]]) } }),
  X('diagnosis-table-missing', 'GET ' + C + '/:chit_id/diagnosis', 200, { setup: { sqlRows: (sql) => { throw Object.assign(new Error('relation "chit_disputes" does not exist'), { code: '42P01' }); } } }),
  X('dispute-queue-table-missing', 'GET ' + C + '/disputes/queue', 200, { url: C + '/disputes/queue?status=all&side=mine&q=tea&sort=new&page=1&limit=10', setup: { sqlRows: (sql) => { throw Object.assign(new Error('relation "chit_disputes" does not exist'), { code: '42P01' }); } } }),
  X('children-of-a-chit', 'GET ' + C + '/:id/children', 200, { setup: { sqlRows: answering(/summary_json->'trace' AS trace/, [{ chit_id: OTHER, entity_id: SHOP }]) } }),
  X('trace-seed-is-not-visible', 'GET ' + C + '/:id/trace', 404, { url: C + '/' + PARTY + '/trace?dir=backward&network=net1' }),
  X('batches-listed', 'GET ' + C + '/trace/batches', 200, { setup: { sqlRows: answering(/summary_json->'trace' AS trace, created_at/, [{ chit_id: PARTY, trace: { product: 'Tea', qty: 3, is_origin: true }, all_recipients: [] }]) } }),
  X('batch-asked-for', 'GET ' + C + '/trace/by-batch', 200, { url: C + '/trace/by-batch?q=B1' }),
  X('batch-trace-fails', 'GET ' + C + '/trace/by-batch', 500, { url: C + '/trace/by-batch?q=B1', setup: { db: 'fail' } }),
  /* ── the register and the raida (the schema is there: the statements are the library's own) ── */
  X('attachables-fail', 'GET ' + C + '/register/attachables', 500, { patch: { raida: { attachables: async () => { throw new Error(SECRET_SQL); } } } }),
  X('attachables', 'GET ' + C + '/register/attachables', 200, { setup: { migrated: true } }),
  X('subjects-listed', 'GET ' + C + '/register/subjects', 200, { url: C + '/register/subjects?type_key=audit&open=1', setup: { migrated: true } }),
  X('subjects-fail', 'GET ' + C + '/register/subjects', 500, { setup: { migrated: true, sqlRows: breaking(/register_subject/) } }),
  X('register-opened', 'POST ' + C + '/register/subjects', 200, { body: { type_key: 'audit', name: 'Q4 audit' }, setup: { migrated: true } }),
  X('register-open-fails', 'POST ' + C + '/register/subjects', 500, { body: { type_key: 'audit', name: 'Q4 audit' }, setup: { migrated: true, sqlRows: breaking(/register_subject/) } }),
  X('register-open-refused', 'POST ' + C + '/register/subjects', 400, { body: { type_key: 'audit' }, patch: { raida: { subjectFor: async () => { throw Object.assign(new Error('Name the register.'), { status: 400 }); } } } }),
  X('register-close-unknown', 'POST ' + C + '/register/subjects/:subject_id/close', 400, { setup: { migrated: true } }),
  X('register-close-gate', 'POST ' + C + '/register/subjects/:subject_id/close', 409, { patch: { raida: { closeSubject: async () => { throw Object.assign(new Error('2 entries are still open.'), { status: 409, outstanding: [{ raida_id: PARTY }, { raida_id: OTHER }] }); } } } }),
  X('register-close-fails', 'POST ' + C + '/register/subjects/:subject_id/close', 500, { setup: { migrated: true, sqlRows: breaking(/register_subject/) } }),
  X('library-listed', 'GET ' + C + '/register/templates', 200, { setup: { migrated: true } }),
  X('library-fails', 'GET ' + C + '/register/templates', 500, { setup: { migrated: true, sqlRows: breaking(/register_template/) } }),
  X('template-kind-missing', 'POST ' + C + '/register/templates', 400, { body: {}, setup: { migrated: true } }),
  X('template-save-fails', 'POST ' + C + '/register/templates', 500, { body: { title: 'Late delivery', kind: 'risk', body: 'x' }, setup: { migrated: true } }),
  X('entry-kind-missing', 'POST ' + C + '/register/subjects/:subject_id/entries', 400, { body: {}, setup: { migrated: true } }),
  X('entry-record-fails', 'POST ' + C + '/register/subjects/:subject_id/entries', 500, { body: { kind: 'risk', body: 'x' }, setup: { migrated: true } }),
  X('entry-needs-a-disposition', 'POST ' + C + '/register/entries/:raida_id/close', 400, { body: { body: 'done' }, setup: { migrated: true } }),
  X('entry-close-fails', 'POST ' + C + '/register/entries/:raida_id/close', 500, { body: { disposition: 'resolved' }, setup: { migrated: true, sqlRows: breaking(/raida/) } }),
  X('walk-answers', 'GET ' + C + '/register/walk/:from', 200, { url: C + '/register/walk/' + PARTY + '?backwards=1&depth=2', setup: { migrated: true } }),
  X('walk-fails', 'GET ' + C + '/register/walk/:from', 500, { setup: { migrated: true, sqlRows: breaking(/raida/) } }),
  X('revise-unknown-entry', 'POST ' + C + '/register/entries/:raida_id/revise', 400, { body: { body: 'new' }, setup: { migrated: true } }),
  X('revise-fails', 'POST ' + C + '/register/entries/:raida_id/revise', 500, { body: { body: 'new' }, setup: { migrated: true, sqlRows: breaking(/raida/) } }),
  X('accept-unknown-entry', 'POST ' + C + '/register/entries/:raida_id/accept', 400, { body: { rationale: 'ok' }, setup: { migrated: true } }),
  X('accept-fails', 'POST ' + C + '/register/entries/:raida_id/accept', 500, { body: { rationale: 'ok' }, setup: { migrated: true, sqlRows: breaking(/raida/) } }),
  X('report-read', 'GET ' + C + '/raida/report', 200, { url: C + '/raida/report?subject_id=' + PARTY + '&standard=iso9001', setup: { migrated: true } }),
  X('report-fails', 'GET ' + C + '/raida/report', 500, { setup: { migrated: true, sqlRows: breaking(/raida/) } }),
  X('chit-register-read', 'GET ' + C + '/:chit_id/raida', 200, { url: C + '/' + PARTY + '/raida?line_id=' + OTHER, setup: { migrated: true } }),
  X('chit-register-fails', 'GET ' + C + '/:chit_id/raida', 500, { setup: { migrated: true, sqlRows: breaking(/raida/) } }),
  X('chit-register-refused', 'GET ' + C + '/:chit_id/raida', 403, { patch: { raida: { list: async () => { throw Object.assign(new Error('Nope.'), { status: 403 }); } } } }),
  X('entry-on-a-chit-not-mine', 'POST ' + C + '/:chit_id/raida', 404, { body: { kind: 'risk', body: 'x' }, setup: { migrated: true } }),
  X('entry-on-a-chit-kind-missing', 'POST ' + C + '/:chit_id/raida', 400, { body: {}, setup: { migrated: true, sqlRows: answering(/SELECT 1 FROM chit_header/, [{ '?column?': 1 }]) } }),
  X('entry-on-a-chit-fails', 'POST ' + C + '/:chit_id/raida', 500, { body: { kind: 'risk', body: 'x' }, setup: { migrated: true, sqlRows: answeringAll([[/SELECT 1 FROM chit_header/, [{ '?column?': 1 }]], [/raida/, null]]) } }),
  X('chit-entry-needs-a-disposition', 'POST ' + C + '/:chit_id/raida/:raida_id/close', 400, { body: { body: 'x' }, setup: { migrated: true } }),
  X('chit-entry-close-fails', 'POST ' + C + '/:chit_id/raida/:raida_id/close', 500, { body: { body: 'x' }, patch: { raida: { close: async () => { throw new Error(SECRET_SQL); } } } }),
  X('dispute-link-unknown-entry', 'POST ' + C + '/:chit_id/raida/:raida_id/dispute', 400, { body: { dispute_id: OTHER }, setup: { migrated: true } }),
  X('dispute-link-fails', 'POST ' + C + '/:chit_id/raida/:raida_id/dispute', 500, { body: { dispute_id: OTHER }, setup: { migrated: true, sqlRows: breaking(/raida/) } }),
  X('networks-listed', 'GET ' + C + '/trace/networks', 200, { setup: { sqlRows: answering(/network_id/, [{ network_id: 'net1', is_operator: true, edges: '2' }]) } })
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
      if (one.badId && !routes[route].includes(':')) return;
      generic.push({ id: one.id, route, url: urlOf(routes[route], one.badId), body: BODY_METHODS.includes(method) ? {} : undefined, setup: one.setup });
    });
  });
  const extras = EXTRAS.map((one) => Object.assign({}, one, { url: one.url || urlOf(routes[one.route] || '', false), extra: true }));
  return generic.concat(extras.filter((one) => routes[one.route]));
}

/** a scenario that needs a row the stand-in db cannot make swaps one library function for its answer, then puts the real one back */
function applyPatch(patch) {
  const undo = [];
  Object.keys(patch || {}).forEach((which) =>
    Object.keys(patch[which]).forEach((name) => {
      const owner = require(path.join(HERE, 'lib', which));
      undo.push([owner, name, owner[name]]);
      owner[name] = patch[which][name];
    })
  );
  return () => undo.forEach(([owner, name, original]) => (owner[name] = original));
}

async function runScenario(port, scenario) {
  Object.assign(world, FRESH, scenario.setup);
  require(path.join(HERE, 'lib', 'schema'))._reset(); /* what the schema probe learned in one scenario is not known to the next */
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

/** the sign-in middleware's own 401 is still the old body: tested, not yet a Problem (a follow-up for the auth middleware) */
const inherited = (scenario, answer) => answer.status === 401 && scenario.id === 'signed-out';

/** the contract of the chit routes: its rows, and the statuses a test may see from a route (the base of a sweep has neither) */
function contractOrNull() {
  try {
    return require(path.join(HERE, 'lib', 'chits-contract.js'));
  } catch (failure) {
    return null;
  }
}

/** run every scenario; `held` = the routes the contract holds (check mode) or null (capture and compare: every route) */
async function checkRoutes(port, scenarios, recording, held) {
  const tested = {};
  const contract = held ? contractOrNull() : null;
  const allowed = contract ? contract.allowedStatuses() : null;
  const capturing = argv.includes('--capture') || argv.includes('--compare');
  for (const scenario of scenarios) {
    const answer = await runScenario(port, scenario);
    const label = scenario.route + ' · ' + scenario.id;
    recording[scenario.route + '|' + scenario.id] = { route: scenario.route, status: answer.status, type: answer.type, body: answer.json, text: answer.json ? undefined : answer.text.slice(0, 300) };
    if (capturing) continue;
    if (answer.status >= 400) (tested[scenario.route] = tested[scenario.route] || new Set()).add(answer.status);
    check(label + ': answers (not a hang)', answer.status !== 0);
    if (scenario.expect !== undefined) check(label + ': answers the status it is built to reach (' + scenario.expect + ')', answer.status === scenario.expect, [answer.status, answer.text.slice(0, 200)]);
    if (answer.status < 400) continue;
    check(label + ': ' + answer.status + ' is a status the contract declares for this route', allowed(scenario.route).includes(answer.status), allowed(scenario.route));
    if (inherited(scenario, answer)) continue;
    checkProblemBody(label, answer);
    if (answer.status >= 500) check(label + ': a 5xx says nothing of its cause', !/SELECT|vault|relation "/.test(answer.text), answer.text);
    else checkLegacy(label, answer, legacyOf(scenario.route, scenario.id));
  }
  return tested;
}

/** the routes with a contract row: { 'METHOD /full/path' } */
function heldRoutes() {
  const contract = contractOrNull();
  return new Set(contract ? Object.keys(contract.OPERATIONS) : []);
}

/** a capture becomes frozen answers: { route: { answers: [{ scenario, status, body_keys, fixture }] } } (4xx and 5xx only, the 401 of the sign-in middleware left out; only the routes the contract holds) */
function freeze(captureFile) {
  const recording = JSON.parse(fs.readFileSync(captureFile, 'utf8'));
  const file = JSON.parse(fs.readFileSync(LEGACY_FILE, 'utf8'));
  const held = heldRoutes();
  Object.keys(recording).forEach((key) => {
    const one = recording[key];
    const scenario = key.split('|')[1];
    if (!held.has(one.route) || one.status < 400 || (one.status === 401 && scenario === 'signed-out') || !one.body) return;
    const entry = (file.routes[one.route] = file.routes[one.route] || { answers: [] });
    if (!entry.answers.some((answer) => answer.scenario === scenario)) entry.answers.push({ scenario, status: one.status, body_keys: one.body, fixture: one.body });
  });
  /* the routes already frozen keep their places in the file; this file's own are added after them, sorted */
  const theirs = Object.keys(file.routes).filter((route) => !MINE(route));
  file.routes = Object.fromEntries(theirs.concat(Object.keys(file.routes).filter(MINE).sort()).map((route) => [route, file.routes[route]]));
  fs.writeFileSync(LEGACY_FILE, JSON.stringify(file, null, 1) + '\n');
  console.log('froze ' + Object.keys(file.routes).filter(MINE).length + ' routes');
}

/* ── replay: this code's answers against the capture of the code before the sweep ────────────────────────── */
const KNOWN_IDS = [SHOP, PARTY, OTHER, STAFF_ID];
const UUID_TEXT = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const TIME_TEXT = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g;
/** a body as text with what a run makes new (a fresh id, a moment) blanked, so two runs can be compared */
const steadyText = (value) => JSON.stringify(value === undefined ? null : value).replace(UUID_TEXT, (id) => (KNOWN_IDS.includes(id) ? id : '<id>')).replace(TIME_TEXT, '<time>');

/**
 * one answer against its capture: a success is identical (same status, same body, key order included); a refusal keeps the old keys, in the old order and with the old values,
 * and gains only Problem fields after them. Returns null when it holds, else the difference in words.
 */
function differenceOf(before, now, converted) {
  if (before.status !== now.status) return 'status ' + before.status + ' became ' + now.status;
  if (!converted) return before.type === now.type && steadyText(before.body) === steadyText(now.body) && (before.text || '') === (now.text || '') ? null : 'a route the sweep has not reached yet answered differently';
  const wasProblem = /problem\+json/.test(before.type || '');
  const isProblem = /problem\+json/.test(now.type || '');
  if (before.status < 400 || !before.body || before.status === 401) return steadyText(before.body) === steadyText(now.body) && (before.text || '') === (now.text || '') ? null : 'the success body changed: ' + steadyText(before.body).slice(0, 160) + ' became ' + steadyText(now.body).slice(0, 160);
  if (wasProblem) return steadyText(before.body) === steadyText(now.body) ? null : 'an answer that was already a Problem changed';
  if (!isProblem) return 'a refusal that was not a Problem is not one now (content-type ' + now.type + ')';
  const oldKeys = Object.keys(before.body);
  const nowKeys = Object.keys(now.body || {});
  const kept = nowKeys.slice(0, oldKeys.length);
  if (!sameValue(kept, oldKeys)) return 'the old keys ' + oldKeys.join(',') + ' are now ' + kept.join(',');
  const changed = oldKeys.filter((name) => steadyText(before.body[name]) !== steadyText(now.body[name]));
  if (changed.length) return 'old keys changed value: ' + changed.map((name) => name + ' ' + JSON.stringify(before.body[name]).slice(0, 60) + ' became ' + JSON.stringify(now.body[name]).slice(0, 60)).join('; ');
  const extra = nowKeys.slice(oldKeys.length).filter((name) => !PROBLEM_FIELDS.includes(name));
  return extra.length ? 'keys beyond the old ones and the Problem fields: ' + extra.join(',') : null;
}

function compare(captureFile, recording, held) {
  const before = JSON.parse(fs.readFileSync(captureFile, 'utf8'));
  const keys = Object.keys(before);
  const different = [];
  keys.forEach((key) => {
    const now = recording[key];
    const why = now ? differenceOf(before[key], now, held.has(before[key].route)) : 'the scenario no longer runs';
    if (why) different.push(key + ' — ' + why);
  });
  const same = keys.length - different.length;
  console.log('replay: ' + same + ' of ' + keys.length + ' answers identical (refusals: the old keys, the old order, the old values)');
  different.forEach((line) => console.log('  DIFFERENT  ' + line));
  process.exitCode = different.length ? 1 : 0;
}

/** lib/chits-contract.js as a unit: the words of a refusal and of a fault, as the chit routes always said them */
function checkWords() {
  console.log('\n-- lib/chits-contract.js: the chit refusals as a unit --');
  const words = require(path.join(HERE, 'lib', 'chits-contract.js'));
  const asked = { id: 'r1', path: '/x' };
  const spec = words.said({ error: 'Not found', message: 'Chit not found' }, 'NOT_FOUND');
  check('said: the old body is kept as it was, the detail is its sentence, the code is the one named', sameValue(spec.legacy, { error: 'Not found', message: 'Chit not found' }) && spec.detail === 'Chit not found' && spec.code === 'NOT_FOUND', spec);
  const own = words.said({ error: 'Over', code: 'OVER_LIMIT', message: 'Too much' }, 'CHIT_CONFLICT');
  check('said: a body that carries its own code keeps it as the Problem code', own.code === 'OVER_LIMIT' && own.legacy.code === 'OVER_LIMIT', own);
  const bare = words.said({ error: 'Forbidden' }, 'CHIT_NOT_PERMITTED', 'This login holds no copy of this chit.');
  check('said: a body of one bare word gets a plain detail and keeps its single key', bare.detail === 'This login holds no copy of this chit.' && sameValue(Object.keys(bare.legacy), ['error']), bare);
  const hidden = words.failed(new Error(SECRET_SQL), asked, 'List failed');
  check('failed: a 500 INTERNAL that says nothing of its cause, the label of the screen kept', hidden.status === 500 && hidden.code === 'INTERNAL' && hidden.legacy.error === 'List failed' && !JSON.stringify(hidden).includes('vault'), hidden);
  const carried = words.faultOf(Object.assign(new Error('Nope.'), { status: 403 }), asked, 'Reprice failed');
  check('faultOf: an error that carries a status keeps it, and the old sentence stays the safe one', carried.status === 403 && carried.code === 'CHIT_NOT_PERMITTED' && carried.legacy.message === 'Something went wrong — please try again.' && carried.legacy.error === 'Reprice failed', carried);
  const meant = words.faultOf(Object.assign(new Error('Nope.'), { status: 403 }), asked, 'Failed to open the register', { words: true });
  check('faultOf: with words asked, a refusal a library meant says its own sentence', meant.status === 403 && meant.legacy.message === 'Nope.' && meant.detail === 'Nope.', meant);
  const server = words.faultOf(Object.assign(new Error(SECRET_SQL), { status: 502 }), asked, 'Failed to open the register', { words: true });
  check('faultOf: a 5xx keeps its status and says nothing of its cause', server.status === 502 && server.code === 'INTERNAL' && !JSON.stringify(server).includes('vault'), server);
  const plain = words.faultOf(new Error(SECRET_SQL), asked, 'Failed to assign');
  check('faultOf: an error with no status is a 500', plain.status === 500 && plain.code === 'INTERNAL', plain);
}

/** every code a refusal can carry is a row of docs/error-codes.json with its shopkeeper sentence written: the codes the answers carried, and the codes the route file names beside said(...) */
function checkCodes(recording) {
  console.log('\n-- the codes are in the table --');
  const registered = new Set(JSON.parse(fs.readFileSync(path.join(HERE, 'docs', 'error-codes.json'), 'utf8')).codes.filter((row) => row.shopkeeper !== 'PENDING').map((row) => row.code));
  const held = heldRoutes();
  const carried = new Set(Object.values(recording).filter((one) => held.has(one.route) && one.status >= 400 && one.body && one.body.code && /problem/.test(one.type)).map((one) => one.body.code));
  const lowerCase = [...carried].filter((code) => !/^[A-Z]/.test(code));
  const missing = [...carried].filter((code) => /^[A-Z]/.test(code) && !registered.has(code));
  check('every code the refusals carried is a row of the code table with its sentence written: ' + carried.size + ' codes', missing.length === 0, missing);
  const source = fs.readFileSync(path.join(HERE, ROUTE_FILE), 'utf8').split('\n').filter((line) => /said\(/.test(line)).join('\n');
  const named = new Set([...source.matchAll(/'([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+|NOT_FOUND)'/g)].map((match) => match[1]));
  const unnamed = [...named].filter((code) => !registered.has(code));
  check('every code the route file names beside said(...) is a row of the code table: ' + named.size + ' codes', unnamed.length === 0, unnamed);
  check('the codes in lower case are the ones the old body carried, kept as they were (' + lowerCase.join(', ') + ')', lowerCase.every((code) => ['status_conflict', 'reason_required', 'disputes_unknown'].includes(code) || /^[a-z_]+$/.test(code)));
}

process.on('unhandledRejection', (failure) => console.log('  (unhandled rejection: ' + String(failure && failure.message).slice(0, 80) + ')'));
(async () => {
  if (flagValue('--freeze')) return freeze(flagValue('--freeze'));
  installStubs();
  const router = require(path.join(HERE, ROUTE_FILE));
  const routes = routesOf(router, MOUNT);
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
          throw new Error(SECRET_SQL);
        }
        return write(body);
      };
    }
    next();
  });
  app.use(express.json());
  app.use(MOUNT, router);
  const server = app.listen(0);
  const recording = {};
  const replaying = argv.includes('--capture') || argv.includes('--compare');
  const held = replaying ? null : heldRoutes();
  const mine = replaying ? routes : Object.fromEntries(Object.keys(routes).filter((route) => held.has(route)).map((route) => [route, routes[route]]));
  const tested = await checkRoutes(server.address().port, scenariosOf(mine), recording, held);
  server.close();
  if (flagValue('--capture')) {
    fs.writeFileSync(flagValue('--capture'), JSON.stringify(recording, null, 1));
    console.log('captured ' + Object.keys(recording).length + ' answers over ' + Object.keys(routes).length + ' routes');
    process.exit(0);
  }
  if (flagValue('--compare')) {
    compare(flagValue('--compare'), recording, heldRoutes());
    process.exit(process.exitCode || 0);
  }
  checkWords();
  checkCodes(recording);
  const legacy = JSON.parse(fs.readFileSync(LEGACY_FILE, 'utf8')).routes;
  const frozen = Object.keys(legacy).filter(MINE).reduce((sum, route) => sum + legacy[route].answers.length, 0);
  check('every refusal recorded before the sweep is replayed against the code: ' + frozen + ' answers, each once', frozen > 20, frozen);
  check('a caller who is not signed in is refused with 401 on every route that asks for sign-in', Object.keys(recording).filter((key) => key.endsWith('|signed-out')).every((key) => recording[key].status === 401));
  check('a 500 never says its cause: no answer of any route carries the database text', Object.values(recording).every((one) => !JSON.stringify(one.body || {}).includes('vault')));
  const coverage = Object.fromEntries(Object.keys(tested).sort().map((route) => [route, [...tested[route]].sort((a, b) => a - b)]));
  const onDisk = JSON.parse(fs.readFileSync(TESTED_FILE, 'utf8'));
  const rows = Object.fromEntries(Object.keys(onDisk).filter(MINE).sort().map((route) => [route, onDisk[route]]));
  if (argv.includes('--write')) {
    const others = Object.fromEntries(Object.keys(onDisk).filter((route) => !MINE(route)).map((route) => [route, onDisk[route]]));
    const merged = Object.assign(others, coverage);
    fs.writeFileSync(TESTED_FILE, JSON.stringify(Object.fromEntries(Object.keys(merged).sort().map((route) => [route, merged[route]])), null, 1) + '\n');
  } else check('docs/contracts/api-error-tests.json lists exactly the statuses these scenarios cover for routes/chits.js', sameValue(rows, coverage), { onDisk: Object.keys(rows).length, covered: Object.keys(coverage).length });
  console.log('\n  ' + passed + ' checks, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
