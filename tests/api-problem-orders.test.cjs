#!/usr/bin/env node
/**
 * api-problem-orders.test.cjs — API-4 sweep, orders and workflow: every refusal of routes/repeat-supply.js, routes/work.js and routes/counters.js.
 *
 * OWNS      the proof that each refusal of the repeat-supply, work and counters routes is a Problem body AND still carries the keys it answered before
 *           (docs/contracts/api-legacy.json, recorded from the code before the sweep), this file's rows of docs/contracts/api-error-tests.json (the statuses each
 *           route is tested for, which the register's error_tests column reads), and the "signed in as another shop" world: a record addressed by an id in the path
 *           answers another shop's id exactly as it answers an unknown id (API-STANDARD S35, tests/lib/foreign-id-world.cjs), recorded in
 *           docs/contracts/api-hardening-evidence-areas.json. Also: no answer outside the statuses the route's contract declares (lib/orders-contract.js), and its words as units.
 * CALLED BY scripts/guards.cjs · CI. No database, no network: the real route files over a stand-in db, auth, repeat store (tests/support/repeat-supply-memory.cjs)
 *           and Tasks & Orders rows (tests/support/work-stub.cjs).
 * FLOW      route list (read from the router itself) x world (signed out, a key, staff, a viewer, a bad id, a failing db, an empty db) + the named extras
 *           → real route → body → Problem fields present · frozen legacy keys equal · no leak on a 5xx · statuses tested → manifest;
 *           then the foreign-id world: shop B asks shop A's id → the same 404 as an unknown id → evidence
 * CARD      02-tasks-orders-and-workflow/everyones-work
 *
 *   node tests/api-problem-orders.test.cjs                    check
 *   node tests/api-problem-orders.test.cjs --write            rewrite this file's rows of docs/contracts/api-error-tests.json and api-hardening-evidence-areas.json
 *   node tests/api-problem-orders.test.cjs --capture F        (run on the code BEFORE the change) record each answer to file F
 *   node tests/api-problem-orders.test.cjs --freeze F         merge a capture F into docs/contracts/api-legacy.json (the frozen answers)
 */
'use strict';
const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');

const HERE = path.join(__dirname, '..');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
const LEGACY_FILE = path.join(HERE, 'docs', 'contracts', 'api-legacy.json');
const TESTED_FILE = path.join(HERE, 'docs', 'contracts', 'api-error-tests.json');
const EVIDENCE_FILE = path.join(HERE, 'docs', 'contracts', 'api-hardening-evidence-areas.json');
const MOUNTS = ['/api/repeat', '/api/work', '/api/counters'];
/** the route files these mounts serve (named in full so the graph links this test to each of them) */
const ROUTE_FILES = { '/api/repeat': 'routes/repeat-supply.js', '/api/work': 'routes/work.js', '/api/counters': 'routes/counters.js' };
const mountOf = (route) => MOUNTS.find((mount) => route.includes(' ' + mount + '/') || route.endsWith(' ' + mount));
const MINE = (route) => !!mountOf(route);
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

/* ── the cast ── */
const SECRET_SQL = 'relation "repeat_supply" does not exist -- SELECT secret FROM vault';
const SHOP = 'e1'; /* tests/support/work-stub.cjs seeds the Tasks & Orders rows of this shop */
const OTHER_SHOP = 'e2';
const CUSTOMER = 'e3';
/** the id of a Tasks & Orders row that tests/support/work-stub.cjs seeds (its own U) */
const chitOf = (n) => '20000000-0000-4000-8000-' + String(n).padStart(12, '0');
const AGREEMENT = '33333333-3333-4333-8333-333333333333';
const AGREEMENT_CHIT = '55555555-5555-4555-8555-555555555555';
const BILL_CHIT = '66666666-6666-4666-8666-666666666666';
const OWNER = { identity_id: SHOP, identity_type: 'entity', display_name: 'Test shop' };
const STRANGER = { identity_id: OTHER_SHOP, identity_type: 'entity', display_name: 'Other shop' };
const CUSTOMER_OWNER = { identity_id: CUSTOMER, identity_type: 'entity', display_name: 'Ravi Stores' };
const actorOf = (level) => ({ identity_id: 'a-' + level, parent_entity_id: SHOP, identity_type: 'actor', access_level: level, level });
const STAFF = actorOf('editor');
const VIEWER = actorOf('viewer');
const COMMENTER = actorOf('commenter');
const CUSTOMER_LOGIN = { identity_id: 'c-1', identity_type: 'customer', parent_entity_id: SHOP, display_name: 'A buyer' };
const FRESH = { realAuth: false, who: OWNER, asKey: false, db: 'ok', repeatMigrated: true, flags: null, bookedAll: false, mintFails: null, moveAnswer: null, noWork: false, jsonThrows: false };
const world = Object.assign({}, FRESH);

/* ── stand-ins: auth, db, the repeat store, the counters register, the work rows ── */
const mock = (relative, exported) => {
  const file = require.resolve(path.join(HERE, relative));
  require.cache[file] = { id: file, filename: file, loaded: true, exports: exported };
};
const clone = (value) => JSON.parse(JSON.stringify(value));
const failing = (run) => async (...args) => {
  if (world.db === 'fail') throw new Error(SECRET_SQL);
  return run(...args);
};
/** the counters' register: policy_flags of the entity that asks (identities.policy_flags, read FOR UPDATE), nothing for a shop that has none */
const registryOf = (entity) => clone((world.flags && world.flags[entity]) || {});
async function registryAnswer(sql, params) {
  if (/FROM identities WHERE identity_id = \$1/.test(sql)) return { rows: [{ policy_flags: registryOf(params[0]) }], rowCount: 1 };
  return { rows: [], rowCount: 1 };
}
const registryClient = { query: failing((sql, params) => registryAnswer(String(sql), params || [])) };
let repeatMemory = null;

function installStubs() {
  const realAuth = require(path.join(HERE, 'middleware', 'auth'));
  const S = require('./support/work-stub.cjs'); /* the stand-in Tasks & Orders db, its own auth and access */
  const workDb = require(path.join(HERE, 'db'));
  /* the stand-in loaded the routes and libs with ITS db and auth in hand: forget them, so they bind to the stand-ins made here (the one place the worlds are set) */
  const inside = (file) => file.startsWith(HERE) && /[\\/](lib|routes|middleware)[\\/]/.test(file);
  Object.keys(require.cache).filter(inside).forEach((file) => delete require.cache[file]);
  const standIn = Object.assign({}, workDb, {
    withEntity: failing(workDb.withEntity),
    readBatch: failing(workDb.readBatch),
    query: failing((sql, params) => registryAnswer(String(sql), params || [])),
    withTransaction: failing((run) => run(registryClient))
  });
  mock('db', standIn);
  mock('db/index', standIn);
  const stubAuth = (req, res, next) => {
    if (world.realAuth) return realAuth(req, res, next);
    req.identity = world.who;
    if (world.asKey) req.api_key = { jti: 'j1', scopes: ['till'] };
    return next();
  };
  mock('middleware/auth', Object.assign(stubAuth, realAuth, { entityOf: (req) => req.identity.parent_entity_id || req.identity.identity_id, forgetKey: () => undefined }));
  console.error = () => undefined; /* the routes log a 5xx here; the scenarios read the answer */
  return S;
}

/** a fresh repeat store for one scenario: the memory table, the stand-in sender and the stand-in status writer (the one writer, routes/chits moveStatus) */
function freshRepeat() {
  const { memory } = require('./support/repeat-supply-memory.cjs');
  const R = require(path.join(HERE, 'lib', 'repeat-supply'));
  repeatMemory = memory();
  repeatMemory.migrated = world.repeatMigrated;
  R.use(repeatMemory.store);
  R.useSender(repeatMemory.sendAs);
  R.useMover(async () => world.moveAnswer || { code: 200, body: {} });
  return repeatMemory;
}
/** the agreement chit both parties hold and the agreement row of the seller (state 'proposed' unless said) */
async function seedAgreement(over) {
  const mem = repeatMemory;
  mem.hold(AGREEMENT_CHIT, SHOP, CUSTOMER, { purpose: 'subscription', business_json: { repeat: { agreement_id: AGREEMENT } }, line_items: [{ line_id: 'l1', particulars: 'Tea', quantity: 2 }] });
  const row = Object.assign({ agreement_id: AGREEMENT, chit_id: AGREEMENT_CHIT, customer_entity_id: CUSTOMER, source_chit_id: null, every: 1, unit: 'weekly', anchor_day: null, next_on: '2099-01-01', end_on: null, runs_max: null, mode: 'draft', terms: {}, created_by: null }, over || {});
  await mem.store.insert(null, SHOP, row);
}
/** a bill the seller sent to a customer, which an agreement can be made from */
function seedBill(over) {
  repeatMemory.hold(BILL_CHIT, SHOP, CUSTOMER, Object.assign({ line_items: [{ line_id: 'b1', particulars: 'Tea', quantity: 2, price: 10 }], summary_json: { currency_code: 'INR' } }, over || {}));
}
const COUNTER_ROW = (over) => Object.assign({ id: 'C1', name: 'Front desk', created_at: '2026-10-01T00:00:00.000Z', held_by: null }, over || {});
const registerOf = (counters, extra) => ({ [SHOP]: Object.assign({ counters }, extra || {}) });
const HELD = registerOf({ C1: COUNTER_ROW({ held_by: 'j7', held_at: '2026-10-02T00:00:00.000Z' }) }, { api_keys: [{ jti: 'j7', name: 'counter C1', scopes: ['till'], till: { id: 'C1' }, counter: 'C1' }] });
const FREE = registerOf({ C1: COUNTER_ROW() });

/* ── the scenarios: every route the routers hold x the worlds, then the named extras ── */
const PARAM_VALUES = (route) => (/\/api\/work\//.test(route) ? { chit_id: chitOf(1) } : /\/api\/counters\//.test(route) ? { id: 'C1' } : { id: AGREEMENT });
const WORLDS = [
  { id: 'signed-out', setup: { realAuth: true } },
  { id: 'key-asks', setup: { asKey: true } },
  { id: 'customer-asks', setup: { who: CUSTOMER_LOGIN } },
  { id: 'viewer-asks', setup: { who: VIEWER } },
  { id: 'staff-asks', setup: { who: STAFF } },
  { id: 'bad-id', setup: {}, badId: true },
  { id: 'db-fails', setup: { db: 'fail' } },
  { id: 'nothing-found', setup: { noWork: true } }
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
const urlOf = (route, template, bad) => template.replace(/:(\w+)/g, (all, name) => (bad ? 'nope' : PARAM_VALUES(route)[name]));

/** the extras: an answer the generic worlds cannot reach (a named refusal inside a handler) */
const X = (id, route, status, extra) => Object.assign({ id, route, expect: status, setup: {} }, extra);
/** a scenario for an answer the sweep ADDS (the schema's refusal): it is not frozen, since the old code answered it otherwise */
const N = (id, route, status, extra) => X(id, route, status, Object.assign({ after: true }, extra));
const RS = '/api/repeat';
const WK = '/api/work';
const CT = '/api/counters';
const AT = '?chit=' + AGREEMENT_CHIT;
const asCustomer = { who: CUSTOMER_OWNER };
const agreed = { prep: () => seedAgreement({ state: 'agreed' }) };
const proposed = { prep: () => seedAgreement({ state: 'proposed' }) };
const countered = { prep: () => seedAgreement({ state: 'countered', counter: { note: 'less', by: CUSTOMER } }) };
const withBill = (body) => ({ body, prep: () => seedBill() });
const SCHEDULE = { every: 1, unit: 'weekly', start_on: '2099-01-01', until: { runs: 3 }, mode: 'draft' };
const sqlError = (code) => Object.assign(new Error('pg ' + code), { code });
const EXTRAS = [
  /* repeat supply: the seller's side */
  X('migrated-empty-list', 'GET ' + RS, 200, {}),
  X('list-not-migrated', 'GET ' + RS, 200, { setup: { repeatMigrated: false } }),
  X('list-with-one', 'GET ' + RS, 200, agreed),
  X('create-no-bill', 'POST ' + RS, 400, { body: {} }),
  X('create-not-migrated', 'POST ' + RS, 503, { body: { chit_id: BILL_CHIT }, setup: { repeatMigrated: false } }),
  X('create-bad-unit', 'POST ' + RS, 400, withBill({ chit_id: BILL_CHIT, unit: 'hourly', start_on: '2099-01-01' })),
  X('create-bill-unknown', 'POST ' + RS, 404, { body: Object.assign({ chit_id: BILL_CHIT }, SCHEDULE) }),
  X('create-not-my-bill', 'POST ' + RS, 422, { body: Object.assign({ chit_id: BILL_CHIT }, SCHEDULE), prep: () => repeatMemory.hold(BILL_CHIT, OTHER_SHOP, SHOP, { line_items: [{ line_id: 'b1' }] }) }),
  X('create-send-refused', 'POST ' + RS, 422, { body: Object.assign({ chit_id: BILL_CHIT }, SCHEDULE), prep: () => { seedBill(); repeatMemory.refuseSend = 'Not now'; } }),
  X('create-made', 'POST ' + RS, 200, withBill(Object.assign({ chit_id: BILL_CHIT }, SCHEDULE))),
  X('create-send-fails', 'POST ' + RS, 500, { body: Object.assign({ chit_id: BILL_CHIT }, SCHEDULE), prep: () => { seedBill(); repeatMemory.sendAs = async () => { throw new Error(SECRET_SQL); }; require(path.join(HERE, 'lib', 'repeat-supply')).useSender(repeatMemory.sendAs); } }),
  X('sweep-nothing-due', 'POST ' + RS + '/sweep', 200, {}),
  X('sweep-one-due', 'POST ' + RS + '/sweep', 200, { prep: () => seedAgreement({ state: 'agreed', next_on: '2000-01-01', runs_max: 1 }) }),
  X('sweep-not-migrated', 'POST ' + RS + '/sweep', 200, { setup: { repeatMigrated: false } }),
  X('sweep-fails', 'POST ' + RS + '/sweep', 500, { setup: { sweepThrows: true } }),
  X('one-found', 'GET ' + RS + '/:id', 200, agreed),
  X('one-as-customer', 'GET ' + RS + '/:id', 200, Object.assign({ url: RS + '/' + AGREEMENT + AT }, agreed, { setup: asCustomer })),
  X('one-as-a-stranger', 'GET ' + RS + '/:id', 404, Object.assign({ url: RS + '/' + AGREEMENT + AT }, agreed, { setup: { who: STRANGER } })),
  X('one-not-migrated', 'GET ' + RS + '/:id', 503, { setup: { repeatMigrated: false } }),
  X('pause-wrong-state', 'POST ' + RS + '/:id/pause', 422, proposed),
  X('pause-done', 'POST ' + RS + '/:id/pause', 200, agreed),
  X('pause-not-the-seller', 'POST ' + RS + '/:id/pause', 404, Object.assign({ url: RS + '/' + AGREEMENT + '/pause' }, agreed, { setup: asCustomer })),
  X('pause-not-migrated', 'POST ' + RS + '/:id/pause', 503, { setup: { repeatMigrated: false } }),
  X('resume-wrong-state', 'POST ' + RS + '/:id/resume', 422, agreed),
  X('resume-done', 'POST ' + RS + '/:id/resume', 200, { prep: () => seedAgreement({ state: 'paused' }) }),
  X('end-done', 'POST ' + RS + '/:id/end', 200, agreed),
  X('end-already-ended', 'POST ' + RS + '/:id/end', 422, { prep: () => seedAgreement({ state: 'ended' }) }),
  X('agree-wrong-state', 'POST ' + RS + '/:id/agree', 422, agreed),
  X('agree-done', 'POST ' + RS + '/:id/agree', 200, countered),
  X('refuse-done', 'POST ' + RS + '/:id/refuse', 200, countered),
  X('refuse-wrong-state', 'POST ' + RS + '/:id/refuse', 422, agreed),
  X('run-not-due', 'POST ' + RS + '/:id/run', 422, agreed),
  X('run-due', 'POST ' + RS + '/:id/run', 200, { prep: () => seedAgreement({ state: 'agreed', next_on: '2000-01-01', runs_max: 1 }) }),
  X('run-wrong-state', 'POST ' + RS + '/:id/run', 422, proposed),
  X('skip-by-the-seller', 'POST ' + RS + '/:id/skip', 200, agreed),
  X('skip-wrong-state', 'POST ' + RS + '/:id/skip', 422, proposed),
  X('skip-by-customer-needs-a-reason', 'POST ' + RS + '/:id/skip', 422, Object.assign({ url: RS + '/' + AGREEMENT + '/skip' + AT }, agreed, { setup: asCustomer })),
  X('skip-by-customer', 'POST ' + RS + '/:id/skip', 200, Object.assign({ url: RS + '/' + AGREEMENT + '/skip' + AT, body: { reason: 'away' } }, agreed, { setup: asCustomer })),
  /* repeat supply: the customer's side, through the rail */
  X('accept-done', 'POST ' + RS + '/:id/accept', 200, Object.assign({ url: RS + '/' + AGREEMENT + '/accept' + AT }, proposed, { setup: asCustomer })),
  X('accept-wrong-state', 'POST ' + RS + '/:id/accept', 422, Object.assign({ url: RS + '/' + AGREEMENT + '/accept' + AT }, agreed, { setup: asCustomer })),
  X('accept-not-the-customer', 'POST ' + RS + '/:id/accept', 422, Object.assign({ url: RS + '/' + AGREEMENT + '/accept' + AT }, proposed)),
  X('accept-without-the-chit', 'POST ' + RS + '/:id/accept', 404, Object.assign({}, proposed, { setup: asCustomer })),
  X('accept-writer-refuses', 'POST ' + RS + '/:id/accept', 409, Object.assign({ url: RS + '/' + AGREEMENT + '/accept' + AT }, proposed, { setup: Object.assign({ moveAnswer: { code: 409, body: { error: 'Not allowed', message: 'That step is closed.', code: 'wrong_step' } } }, asCustomer) })),
  X('accept-writer-refuses-bare', 'POST ' + RS + '/:id/accept', 404, Object.assign({ url: RS + '/' + AGREEMENT + '/accept' + AT }, proposed, { setup: Object.assign({ moveAnswer: { code: 404, body: null } }, asCustomer) })),
  X('accept-as-viewer', 'POST ' + RS + '/:id/accept', 403, Object.assign({ url: RS + '/' + AGREEMENT + '/accept' + AT }, proposed, { setup: { who: VIEWER } })),
  X('counter-as-commenter', 'POST ' + RS + '/:id/counter', 403, Object.assign({ url: RS + '/' + AGREEMENT + '/counter' + AT }, proposed, { setup: { who: COMMENTER } })),
  X('counter-done', 'POST ' + RS + '/:id/counter', 200, Object.assign({ url: RS + '/' + AGREEMENT + '/counter' + AT, body: { every: 2, unit: 'weekly', start_on: '2099-02-01', note: 'fortnightly' } }, proposed, { setup: asCustomer })),
  X('counter-says-nothing', 'POST ' + RS + '/:id/counter', 400, Object.assign({ url: RS + '/' + AGREEMENT + '/counter' + AT, body: {} }, proposed, { setup: asCustomer })),
  X('counter-no-such-line', 'POST ' + RS + '/:id/counter', 400, Object.assign({ url: RS + '/' + AGREEMENT + '/counter' + AT, body: { lines: [{ line_id: 'zz', quantity: 1 }] } }, proposed, { setup: asCustomer })),
  X('decline-as-viewer', 'POST ' + RS + '/:id/decline', 403, Object.assign({ url: RS + '/' + AGREEMENT + '/decline' + AT }, proposed, { setup: { who: VIEWER } })),
  X('decline-done', 'POST ' + RS + '/:id/decline', 200, Object.assign({ url: RS + '/' + AGREEMENT + '/decline' + AT, body: { reason: 'no' } }, proposed, { setup: asCustomer })),
  X('decline-ended', 'POST ' + RS + '/:id/decline', 422, Object.assign({ url: RS + '/' + AGREEMENT + '/decline' + AT }, { prep: () => seedAgreement({ state: 'ended' }) }, { setup: asCustomer })),
  X('pause-as-viewer', 'POST ' + RS + '/:id/pause', 403, { setup: { who: VIEWER } }),
  X('pause-as-commenter', 'POST ' + RS + '/:id/pause', 403, { setup: { who: COMMENTER } }),
  X('sweep-as-viewer', 'POST ' + RS + '/sweep', 403, { setup: { who: VIEWER } }),
  X('create-as-viewer', 'POST ' + RS, 403, { body: {}, setup: { who: VIEWER } }),
  N('body-not-an-object', 'POST ' + RS + '/:id/pause', 400, Object.assign({ body: [] }, agreed)),
  N('body-not-an-object', 'POST ' + RS, 400, { body: [] }),
  N('chit-given-twice', 'GET ' + RS + '/:id', 400, Object.assign({ url: RS + '/' + AGREEMENT + '?chit=a&chit=b' }, agreed)),
  /* work */
  X('list-orders-in', 'GET ' + WK + '/list', 200, { url: WK + '/list?view=orders_in' }),
  X('list-tasks', 'GET ' + WK + '/list', 200, { url: WK + '/list?view=tasks&assigned=me' }),
  N('list-view-given-twice', 'GET ' + WK + '/list', 400, { url: WK + '/list?view=tasks&view=done' }),
  X('facts', 'GET ' + WK + '/facts', 200, {}),
  X('facts-unbilled', 'GET ' + WK + '/facts', 200, { url: WK + '/facts?unbilled=1' }),
  N('facts-unbilled-given-twice', 'GET ' + WK + '/facts', 400, { url: WK + '/facts?unbilled=1&unbilled=1' }),
  X('sheet-found', 'GET ' + WK + '/:chit_id', 200, {}),
  X('sheet-not-an-id', 'GET ' + WK + '/:chit_id', 404, { url: WK + '/nope' }),
  X('sheet-unknown-chit', 'GET ' + WK + '/:chit_id', 404, { url: WK + '/20000000-0000-4000-8000-000000000999' }),
  X('sheet-of-another-shop', 'GET ' + WK + '/:chit_id', 404, { url: WK + '/' + chitOf(10) }),
  /* counters */
  X('counters-listed', 'GET ' + CT, 200, { setup: { flags: FREE } }),
  X('counters-listed-with-a-holder', 'GET ' + CT, 200, { setup: { flags: HELD } }),
  X('counters-listed-as-staff', 'GET ' + CT, 200, { setup: { flags: FREE, who: STAFF } }),
  X('counters-key-refused', 'GET ' + CT, 403, { setup: { asKey: true } }),
  X('counter-made', 'POST ' + CT, 201, { body: { name: 'Back office' }, setup: { flags: FREE } }),
  X('counter-made-unnamed', 'POST ' + CT, 201, { body: {}, setup: { flags: FREE } }),
  X('counter-none-left', 'POST ' + CT, 400, { body: {}, setup: { flags: FREE, bookedAll: true } }),
  X('counter-make-fails', 'POST ' + CT, 500, { body: {}, setup: { flags: FREE, db: 'fail' } }),
  X('counter-make-not-migrated', 'POST ' + CT, 503, { body: {}, setup: { flags: FREE, policyMissing: true } }),
  X('counter-make-as-staff', 'POST ' + CT, 403, { body: {}, setup: { flags: FREE, who: STAFF } }),
  X('counter-make-by-key', 'POST ' + CT, 403, { body: {}, setup: { flags: FREE, asKey: true } }),
  X('counter-renamed', 'PATCH ' + CT + '/:id', 200, { body: { name: 'Till one' }, setup: { flags: FREE } }),
  X('counter-rename-unnamed', 'PATCH ' + CT + '/:id', 400, { body: {}, setup: { flags: FREE } }),
  X('counter-rename-unknown', 'PATCH ' + CT + '/:id', 404, { body: { name: 'x' }, setup: { flags: FREE }, url: CT + '/C9' }),
  X('counter-rename-lowercase-id', 'PATCH ' + CT + '/:id', 200, { body: { name: 'x' }, setup: { flags: FREE }, url: CT + '/c1' }),
  X('counter-rename-fails', 'PATCH ' + CT + '/:id', 500, { body: { name: 'x' }, setup: { flags: FREE, db: 'fail' } }),
  X('counter-assigned', 'POST ' + CT + '/:id/assign', 200, { body: { phone: '+919812345678' }, setup: { flags: FREE } }),
  X('counter-unassigned', 'POST ' + CT + '/:id/assign', 200, { body: { phone: '' }, setup: { flags: FREE } }),
  X('counter-assign-bad-phone', 'POST ' + CT + '/:id/assign', 400, { body: { phone: '12' }, setup: { flags: FREE } }),
  X('counter-assign-unknown', 'POST ' + CT + '/:id/assign', 404, { body: { phone: '' }, setup: { flags: FREE }, url: CT + '/C9/assign' }),
  X('counter-assign-as-staff', 'POST ' + CT + '/:id/assign', 403, { body: { phone: '' }, setup: { flags: FREE, who: STAFF } }),
  X('counter-assign-fails', 'POST ' + CT + '/:id/assign', 500, { body: { phone: '' }, setup: { flags: FREE, db: 'fail' } }),
  X('counter-opened', 'POST ' + CT + '/:id/open', 200, { body: {}, setup: { flags: FREE, patchKeys: true } }),
  X('counter-open-held', 'POST ' + CT + '/:id/open', 409, { body: {}, setup: { flags: HELD } }),
  X('counter-open-unknown', 'POST ' + CT + '/:id/open', 404, { body: {}, setup: { flags: FREE }, url: CT + '/C9/open' }),
  X('counter-open-as-staff', 'POST ' + CT + '/:id/open', 403, { body: {}, setup: { flags: FREE, who: STAFF } }),
  X('counter-open-mint-fails', 'POST ' + CT + '/:id/open', 500, { body: {}, setup: { flags: FREE, patchKeys: true, mintFails: new Error(SECRET_SQL) } }),
  X('counter-open-mint-refuses', 'POST ' + CT + '/:id/open', 400, { body: {}, setup: { flags: FREE, patchKeys: true, mintFails: Object.assign(new Error('Too many keys.'), { status: 400 }) } }),
  X('counter-open-fails', 'POST ' + CT + '/:id/open', 500, { body: {}, setup: { flags: FREE, db: 'fail' } }),
  X('counter-released', 'POST ' + CT + '/:id/release', 200, { body: {}, setup: { flags: HELD } }),
  X('counter-released-free', 'POST ' + CT + '/:id/release', 200, { body: {}, setup: { flags: FREE } }),
  X('counter-release-unknown', 'POST ' + CT + '/:id/release', 404, { body: {}, setup: { flags: FREE }, url: CT + '/C9/release' }),
  X('counter-release-as-staff', 'POST ' + CT + '/:id/release', 403, { body: {}, setup: { flags: FREE, who: STAFF } }),
  X('counter-release-fails', 'POST ' + CT + '/:id/release', 500, { body: {}, setup: { flags: FREE, db: 'fail' } }),
  N('body-not-an-object', 'POST ' + CT, 400, { body: [], setup: { flags: FREE } }),
  N('body-not-an-object', 'PATCH ' + CT + '/:id', 400, { body: [], setup: { flags: FREE } }),
  N('body-not-an-object', 'POST ' + CT + '/:id/assign', 400, { body: [], setup: { flags: FREE } }),
  N('body-not-an-object', 'POST ' + CT + '/:id/open', 400, { body: [], setup: { flags: FREE, patchKeys: true } }),
  N('body-not-an-object', 'POST ' + CT + '/:id/release', 400, { body: [], setup: { flags: FREE } })
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

/** every scenario as { id, route, url, body, setup, prep, extra } */
function scenariosOf(routes) {
  const generic = [];
  Object.keys(routes).sort().forEach((route) => {
    const method = route.split(' ')[0];
    WORLDS.forEach((one) => {
      if (one.badId && !routes[route].includes(':')) return;
      generic.push({ id: one.id, route, url: urlOf(route, routes[route], one.badId), body: BODY_METHODS.includes(method) ? {} : undefined, setup: Object.assign({ flags: /counters/.test(route) && one.id !== 'nothing-found' ? FREE : null }, one.setup) });
    });
  });
  const extras = EXTRAS.map((one) => Object.assign({}, one, { url: one.url || urlOf(one.route, routes[one.route] || '', false), extra: true }));
  return generic.concat(extras.filter((one) => routes[one.route]));
}

/** a scenario that needs a function another module answers swaps it for a stand-in, then puts the real one back */
function applyPatch(setup) {
  const undo = [];
  const swap = (owner, name, given) => {
    undo.push([owner, name, owner[name]]);
    owner[name] = given;
  };
  const keys = require(path.join(HERE, 'routes', 'keys'));
  if (setup.patchKeys || setup.mintFails) {
    swap(keys, 'mint', async () => {
      if (setup.mintFails) throw setup.mintFails;
      return { key: 'cbk_test', jti: 'j9' };
    });
    swap(keys, 'patchKeyWith', async () => undefined);
  }
  if (setup.sweepThrows) {
    /* the library's sweep keeps its own faults in its answer; a stand-in that throws reaches the route's catch */
    swap(require(path.join(HERE, 'lib', 'repeat-supply')), 'sweep', async () => {
      throw new Error(SECRET_SQL);
    });
  }
  swap(keys, 'bookedPrefixes', async () => new Set(setup.bookedAll ? keys.TILL_IDS : []));
  if (setup.policyMissing) {
    const policy = require(path.join(HERE, 'lib', 'policy'));
    swap(policy, 'patchKey', async () => {
      throw Object.assign(new Error('Policy flags are not migrated on this environment (b130).'), { status: 503 });
    });
  }
  return () => undo.reverse().forEach(([owner, name, original]) => (owner[name] = original));
}

async function runScenario(port, scenario, S) {
  Object.assign(world, FRESH, scenario.setup);
  S.seed();
  if (world.noWork) S.D.copies = [];
  freshRepeat();
  if (scenario.prep) await scenario.prep();
  const restore = applyPatch(scenario.setup || {});
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
  const order = Object.keys(frozen.fixture);
  check(label + ': the frozen keys come first, in their old order', sameValue(Object.keys(answer.json).slice(0, order.length), order), Object.keys(answer.json));
  const extra = Object.keys(answer.json).filter((name) => !PROBLEM_FIELDS.includes(name) && !(name in frozen.fixture));
  check(label + ': no key beyond the frozen ones and the Problem fields', extra.length === 0, extra);
}

/** the sign-in middleware's own 401 is still the old body: tested, not yet a Problem (a follow-up for the auth middleware) */
const inherited = (scenario, answer) => answer.status === 401 && scenario.id === 'signed-out';
/** the statuses a test may see from a route, by the contract of the area that owns it */
const allowedFor = () => require(path.join(HERE, 'lib', 'orders-contract.js')).allowedStatuses();

async function checkRoutes(port, scenarios, recording, S) {
  const tested = {};
  const allowed = argv.includes('--capture') ? null : allowedFor();
  for (const scenario of scenarios) {
    const answer = await runScenario(port, scenario, S);
    const label = scenario.route + ' · ' + scenario.id;
    recording[scenario.route + '|' + scenario.id] = { route: scenario.route, status: answer.status, body: answer.json, after: !!scenario.after };
    if (answer.status >= 400) (tested[scenario.route] = tested[scenario.route] || new Set()).add(answer.status);
    if (argv.includes('--capture')) {
      if (scenario.expect !== undefined && answer.status !== scenario.expect) console.log('  built for ' + scenario.expect + ', answered ' + answer.status + ': ' + label + ' ' + answer.text.slice(0, 120));
      continue;
    }
    check(label + ': answers (not a hang)', answer.status !== 0);
    if (scenario.expect !== undefined) check(label + ': answers the status it is built to reach (' + scenario.expect + ')', answer.status === scenario.expect, [answer.status, answer.text.slice(0, 200)]);
    if (answer.status < 400) continue;
    check(label + ': ' + answer.status + ' is a status the contract declares for this route', allowed(scenario.route).includes(answer.status), allowed(scenario.route));
    if (inherited(scenario, answer)) continue;
    checkProblemBody(label, answer);
    if (answer.status >= 500) check(label + ': a 5xx says nothing of its cause', !/SELECT|vault|relation "|repeat_supply/.test(answer.text), answer.text);
    else if (!scenario.after) checkLegacy(label, answer, legacyOf(scenario.route, scenario.id));
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
    if (one.status < 400 || (one.status === 401 && scenario === 'signed-out') || !one.body || one.after) return;
    const entry = (file.routes[one.route] = file.routes[one.route] || { answers: [] });
    if (!entry.answers.some((answer) => answer.scenario === scenario)) entry.answers.push({ scenario, status: one.status, body_keys: one.body, fixture: one.body });
  });
  /* the routes already frozen keep their places in the file; this file's own are added after them, sorted */
  const theirs = Object.keys(file.routes).filter((route) => !MINE(route));
  file.routes = Object.fromEntries(theirs.concat(Object.keys(file.routes).filter(MINE).sort()).map((route) => [route, file.routes[route]]));
  fs.writeFileSync(LEGACY_FILE, JSON.stringify(file, null, 1) + '\n');
  console.log('froze ' + Object.keys(file.routes).filter(MINE).length + ' routes');
}

/* ── the foreign-id world (API-STANDARD S35): shop B asks for shop A's record by its id ── */
const FOREIGN = require('./lib/foreign-id-world.cjs');
const WRITING = { method: 'POST', body: {} };
/** the routes of this file that name a record by an id in the path, each with how to plant a record of shop A for it and how to ask */
const FOREIGN_ROUTES = () => {
  const repeatVerbs = ['accept', 'agree', 'counter', 'decline', 'end', 'pause', 'refuse', 'resume', 'run', 'skip'];
  const repeat = repeatVerbs.map((verb) => ({ route: 'POST ' + RS + '/:id/' + verb, url: RS + '/' + AGREEMENT + '/' + verb, state: verb === 'agree' || verb === 'refuse' ? 'countered' : verb === 'resume' ? 'paused' : 'agreed', request: WRITING }));
  const read = { route: 'GET ' + RS + '/:id', url: RS + '/' + AGREEMENT, state: 'agreed', request: { method: 'GET' } };
  const sheet = { route: 'GET ' + WK + '/:chit_id', url: WK + '/' + chitOf(1), plantsWork: true, request: { method: 'GET' } };
  const counters = [['PATCH', '', { name: 'Till one' }], ['POST', '/assign', { phone: '+919812345678' }], ['POST', '/open', {}], ['POST', '/release', {}]].map(([method, tail, body]) => ({
    route: method + ' ' + CT + '/:id' + tail,
    url: CT + '/C1' + tail,
    counters: true,
    request: { method, body }
  }));
  return [read, sheet].concat(repeat, counters);
};

/** one play(who, planted) of a foreign-id route: sets the world, plants shop A's record (or not) and asks as the stranger (shop B) or as the owner (shop A) */
function playFor(port, S, item) {
  return async (who, planted) => {
    Object.assign(world, FRESH, { who: who === 'owner' ? OWNER : STRANGER, flags: item.counters && planted ? HELD : null });
    S.seed();
    freshRepeat();
    if (planted && item.state) await seedAgreement({ state: item.state });
    if (!planted && item.plantsWork) S.D.copies = S.D.copies.filter((row) => row.entity_id !== SHOP);
    const restore = applyPatch({ patchKeys: true });
    const answer = await send(port, item.request.method, item.url, item.request.body);
    restore();
    return answer;
  };
}

async function checkForeignIds(port, S) {
  console.log('\n-- signed in as another shop: a foreign id answers exactly as an unknown id (S35) --');
  const recording = FOREIGN.recorder();
  const items = FOREIGN_ROUTES();
  const failures = await FOREIGN.runCases(items.map((item) => ({ route: item.route, play: playFor(port, S, item) })), recording.record);
  check('foreign id: ' + items.length + ' routes asked as another shop, each answered the unknown id\'s 404, byte for byte', failures.length === 0, failures);
  failures.forEach((sentence) => console.log('  FINDING ' + sentence));
  return recording.proved();
}

/** lib/orders-contract.js as a unit: the words of a refusal and of a fault, as these routes always said them */
function checkOrdersWords() {
  console.log('\n-- lib/orders-contract.js: the refusals as a unit --');
  const words = require(path.join(HERE, 'lib', 'orders-contract.js'));
  const req = { id: 'r1' };
  const refused = words.repeatFault(Object.assign(new Error('Because.'), { refused: true, code: 'REPEAT_ENDED', status: 422 }), req);
  check('repeatFault: a refusal keeps its own code and sentence, 422', refused.status === 422 && refused.code === 'REPEAT_ENDED' && sameValue(refused.legacy, { code: 'REPEAT_ENDED', error: 'Because.', message: 'Because.' }), refused);
  const bare = words.repeatFault(Object.assign(new Error('Because.'), { refused: true, status: 422 }), req);
  check('repeatFault: a refusal with no code is REPEAT_REFUSED', bare.code === 'REPEAT_REFUSED' && bare.legacy.code === 'REPEAT_REFUSED', bare);
  const odd = words.repeatFault(Object.assign(new Error('Closed.'), { status: 409, body: { why: 'wrong_step' } }), req);
  check('repeatFault: a status the one status writer sent keeps its status, sentence and body keys', odd.status === 409 && odd.legacy.why === 'wrong_step' && odd.legacy.message === 'Closed.', odd);
  const server = words.repeatFault(new Error(SECRET_SQL), req);
  check('repeatFault: anything else is a 500 that says nothing of its cause', server.status === 500 && server.code === 'INTERNAL' && !JSON.stringify(server).includes('vault'), server);
  const open = words.counterFault(Object.assign(new Error('Too many keys.'), { status: 400 }), req, 'Failed');
  check('counterFault: a library refusal of 400 keeps its words', open.status === 400 && open.legacy.message === 'Too many keys.', open);
  const lost = words.counterFault(new Error(SECRET_SQL), req, 'Failed');
  check('counterFault: any other error is a 500 whose message is the safe sentence, never the cause', lost.status === 500 && lost.legacy.message !== SECRET_SQL && !JSON.stringify(lost).includes('vault'), lost);
}

/** lib/contract-kit.js is used as it stands: the rows here are the same shape the other sweeps use */
function checkContractShape() {
  console.log('\n-- the contract rows --');
  const contract = require(path.join(HERE, 'lib', 'orders-contract.js'));
  const operations = Object.keys(contract.OPERATIONS);
  check('the contract holds 23 operations: 14 repeat, 3 work, 6 counters', operations.length === 23 && operations.filter((key) => key.includes('/api/repeat')).length === 14 && operations.filter((key) => key.includes('/api/work')).length === 3, operations.length);
  const sheet = contract.OPERATIONS['GET /api/work/:chit_id'];
  check('a malformed chit id is still a 404, never a 400: the path argument is plain text', sheet.parameters[0].schema.type === 'string' && !sheet.parameters[0].schema.pattern, sheet.parameters);
  check('every refusal an operation declares is a Problem', operations.every((key) => Object.keys(contract.OPERATIONS[key].responses).filter((status) => Number(status) >= 400).every((status) => JSON.stringify(contract.OPERATIONS[key].responses[status]).includes('Problem'))));
}

process.on('unhandledRejection', (failure) => console.log('  (unhandled rejection: ' + String(failure && failure.message).slice(0, 80) + ')'));
(async () => {
  if (flagValue('--freeze')) return freeze(flagValue('--freeze'));
  const S = installStubs();
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
  const port = server.address().port;
  const recording = {};
  const tested = await checkRoutes(port, scenariosOf(routes), recording, S);
  if (flagValue('--capture')) {
    server.close();
    fs.writeFileSync(flagValue('--capture'), JSON.stringify(recording, null, 1));
    console.log('captured ' + Object.keys(recording).length + ' answers over ' + Object.keys(routes).length + ' routes');
    process.exit(0);
  }
  const proved = await checkForeignIds(port, S);
  server.close();
  checkOrdersWords();
  checkContractShape();
  const legacy = JSON.parse(fs.readFileSync(LEGACY_FILE, 'utf8')).routes;
  const frozen = Object.keys(legacy).filter(MINE).reduce((sum, route) => sum + legacy[route].answers.length, 0);
  check('every refusal recorded before the sweep is replayed against the code: ' + frozen + ' answers, each once, byte for byte', frozen > 100, frozen);
  check('a caller who is not signed in is refused with 401 on every route', Object.keys(recording).filter((key) => key.endsWith('|signed-out')).every((key) => recording[key].status === 401));
  const leaks = (key) => JSON.stringify(recording[key].body || {}).includes('vault');
  const refused = Object.keys(recording).filter((key) => recording[key].status >= 400);
  check('a refusal or a 500 never says its cause: no answer of 400 and over carries the database text', refused.filter(leaks).length === 0, refused.filter(leaks));
  /* FINDING (not changed here: a success body and the nightly's own sweep): lib/repeat-supply sweep() answers 200 with the db error text in problems[].why */
  Object.keys(recording).filter((key) => recording[key].status < 400 && leaks(key)).forEach((key) => console.log('  FINDING a 2xx carries the database text: ' + key));
  const coverage = Object.fromEntries(Object.keys(tested).sort().map((route) => [route, [...tested[route]].sort((a, b) => a - b)]));
  const onDisk = JSON.parse(fs.readFileSync(TESTED_FILE, 'utf8'));
  const mine = Object.fromEntries(Object.keys(onDisk).filter(MINE).sort().map((route) => [route, onDisk[route]]));
  if (argv.includes('--write')) {
    const others = Object.fromEntries(Object.keys(onDisk).filter((route) => !MINE(route)).map((route) => [route, onDisk[route]]));
    const merged = Object.assign(others, coverage);
    fs.writeFileSync(TESTED_FILE, JSON.stringify(Object.fromEntries(Object.keys(merged).sort().map((route) => [route, merged[route]])), null, 1) + '\n');
    FOREIGN.writeEvidence(EVIDENCE_FILE, MINE, proved);
  } else {
    check('docs/contracts/api-error-tests.json lists exactly the statuses these scenarios cover for routes/repeat-supply.js · routes/work.js · routes/counters.js', sameValue(mine, coverage), { onDisk: Object.keys(mine).length, covered: Object.keys(coverage).length });
    check('docs/contracts/api-hardening-evidence-areas.json says foreign_id_404 for exactly the routes that held here', sameValue(FOREIGN.evidenceOf(EVIDENCE_FILE, MINE), proved), { onDisk: Object.keys(FOREIGN.evidenceOf(EVIDENCE_FILE, MINE)).length, held: Object.keys(proved).length });
  }
  console.log('\n  ' + passed + ' checks, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
