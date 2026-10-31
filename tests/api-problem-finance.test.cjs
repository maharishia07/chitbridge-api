#!/usr/bin/env node
/**
 * api-problem-finance.test.cjs — API-4 sweep, finance: every refusal of routes/folders.js, routes/facts.js and routes/pricing.js.
 *
 * OWNS      the proof that each refusal of the folders, Home-facts and pricing routes is a Problem body AND still carries the keys it answered before
 *           (docs/contracts/api-legacy.json, recorded from the code before the sweep), and this file's rows of docs/contracts/api-error-tests.json
 *           (the statuses each of these routes is tested for, which the register's error_tests column reads). Also: no answer outside the statuses the
 *           route's contract declares (lib/folders-contract.js · lib/facts-contract.js · lib/pricing-contract.js), and those modules' words as units.
 * CALLED BY scripts/guards.cjs · CI. No database, no network: the real route files over a stand-in db and auth.
 * FLOW      route list (read from the router itself) x world (signed out, a key, staff, a bad id, a failing db, an empty db) + the named extras
 *           → real route → body → Problem fields present · frozen legacy keys equal · no leak on a 5xx · statuses tested → manifest
 *
 *   node tests/api-problem-finance.test.cjs                    check
 *   node tests/api-problem-finance.test.cjs --write            rewrite this file's rows of docs/contracts/api-error-tests.json
 *   node tests/api-problem-finance.test.cjs --capture F        (run on the code BEFORE the change) record each answer to file F
 *   node tests/api-problem-finance.test.cjs --freeze F         merge a capture F into docs/contracts/api-legacy.json (the frozen answers)
 *   node tests/api-problem-finance.test.cjs --compare F        the answers now against a capture F: byte for byte (status, content type, body)
 */
'use strict';
const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');

const HERE = path.join(__dirname, '..');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
process.env.OUTPUT_ALLOWLIST = 'enforce'; /* S34: a sweep test runs the allow-list for real; production defaults to report */
/* --capture / --compare replay the same answers byte for byte: the clock and Math.random are held still, so a difference is the code's and not the run's (a folder's metrics age its chits by the clock) */
if (process.argv.includes('--capture') || process.argv.includes('--compare')) {
  let drawn = 0;
  Math.random = () => ((drawn += 1) * 0.6180339887) % 1;
  const FIXED_NOW = 1800000000000;
  const RealDate = Date;
  global.Date = class extends RealDate {
    constructor(...given) {
      if (given.length) super(...given);
      else super(FIXED_NOW);
    }
    static now() {
      return FIXED_NOW;
    }
  };
}
const allowlist = require('../lib/output-allowlist');
const crypto = require('crypto');
const LEGACY_FILE = path.join(HERE, 'docs', 'contracts', 'api-legacy.json');
const TESTED_FILE = path.join(HERE, 'docs', 'contracts', 'api-error-tests.json');
const EVIDENCE_FILE = path.join(HERE, 'docs', 'contracts', 'api-hardening-evidence-areas.json'); /* the area tests' own evidence file (R2-4): this file writes the folders routes' output_allowlist rows */
const FOLDERS_MINE = (route) => route.includes(' /api/folders/') || route.endsWith(' /api/folders');
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
const FRESH = { realAuth: false, who: OWNER, asKey: false, keyScopes: ['till'], db: 'ok', sqlRows: null, jsonThrows: false };
const world = Object.assign({}, FRESH);

/** the rows a statement gets: a scenario's own rows first, then nothing (or the secret failure when the db is down) */
function rowsFor(sql) {
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
  const client = { query: async (sql) => rowsFor(sql) };
  const known = { query: async (sql) => rowsFor(sql), withEntity: async (id, run) => run(client), withTransaction: async (run) => run(client), readBatch: async () => [{ rows: [], rowCount: 0 }] };
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
/** several stand-in answers, the first that has one wins */
const firstOf = (...answers) => (sql, params) => answers.map((answer) => answer(sql, params)).find((given) => given) || null;
/** SEC-100: the folder lookup finds the folder (it is this shop's own) */
const OWN_FOLDER = answering(/SELECT 1 FROM folder WHERE folder_id = \$1 AND entity_id = \$2/, [{ '?column?': 1 }]);
/** a scenario for an answer the SEC-100 fix ADDS: the code before answered it otherwise (200 or 500), so nothing is frozen for it */
const N = (id, route, status, extra) => X(id, route, status, Object.assign({ after: true }, extra));
const BAD_WHEN = { when: { nonsense: 'x' } };
/** a folder as PATCH /:id reads it back (RETURNING folder_id, parent_id, name): the parent is nullable */
const FOLDER_BACK = (parent) => ({ folder_id: PARTY, parent_id: parent, name: 'Mayur' });
const FOLDER_ROW = (extra) => Object.assign({ folder_id: PARTY, name: 'Mayur', scope: 'task', kind: 'filed' }, extra);
/** a folder row as the folders list selects it (the folder table: migrations/000_baseline_2026-10-21.sql + b133's scope + b275's kind), count as the database answers a COUNT: text */
const FOLDER_FILED = { folder_id: PARTY, parent_id: null, name: 'Mayur', sort: 1, scope: 'task', kind: 'filed', count: '2' };
const FOLDER_VIEW = { folder_id: '33333333-3333-4333-8333-333333333333', parent_id: PARTY, name: 'Late bills', sort: 0, scope: null, kind: 'view', count: '0' };
/** folder.sort is `integer DEFAULT 0` with no NOT NULL (migrations/000_baseline): a row can hold NULL */
const FOLDER_NO_SORT = { folder_id: '99999999-9999-4999-8999-999999999999', parent_id: null, name: 'Unsorted', sort: null, scope: 'order', kind: 'filed', count: '0' };
const AT = '2026-10-01T10:00:00.000Z';
/** every term of the rule vocabulary (lib/match KEYS), so a rule's when is seen with the whole of what a rule may hold */
const WHEN_FULL = Object.fromEntries(Object.entries(require(path.join(HERE, 'lib', 'match')).KEYS).map(([key, kind]) => [key, { text: 'rice', exact: 'invoice', number: 5, bool: true }[kind]]));
/** a folder_rule row as lib/folder-rules list selects it: the first with every column filled, the second with every nullable column null */
const RULE_FULL = { rule_id: PARTY, folder_id: PARTY, name: 'Invoices', when: WHEN_FULL, enabled: true, sort: 1, stop_processing: true, last_matched_at: AT, match_count: '3', created_at: AT };
/** a rule may hold any one term of the vocabulary (lib/match validate): this one only a sender, no doc, so no term is read as required */
const RULE_FROM_ONLY = { rule_id: '88888888-8888-4888-8888-888888888888', folder_id: PARTY, name: 'From Asha', when: { from: 'asha' }, enabled: true, sort: 2, stop_processing: false, last_matched_at: null, match_count: '0', created_at: AT };
/** a rule as lib/folder-rules create RETURNs it (no last_matched_at), then as update RETURNs it (no created_at); name is nullable, match_count a bigint (text) */
const RULE_MADE = { rule_id: PARTY, folder_id: PARTY, name: 'Invoices', when: WHEN_FULL, enabled: true, sort: 1, stop_processing: true, match_count: '0', created_at: AT };
const RULE_MADE_BARE = Object.assign({}, RULE_MADE, { name: null, when: { from: 'asha' }, enabled: false, sort: 0, stop_processing: false });
const RULE_SAVED = { rule_id: PARTY, folder_id: PARTY, name: 'Invoices', when: WHEN_FULL, enabled: false, sort: 2, stop_processing: true, match_count: '3' };
const RULE_SAVED_BARE = Object.assign({}, RULE_SAVED, { name: null, when: { doc: 'invoice' } });
const RULE_BARE = { rule_id: '33333333-3333-4333-8333-333333333333', folder_id: PARTY, name: null, when: { doc: 'invoice' }, enabled: false, sort: 0, stop_processing: false, last_matched_at: null, match_count: '0', created_at: AT };
/** a message of the inbox as its statement selects it (chit_messages + the chit's header, line and status) */
const MESSAGE_FULL = { message_id: PARTY, chit_id: PARTY, line_id: PARTY, sender_display_name: 'Asha', sender_entity_id: '44444444-4444-4444-8444-444444444444', message_text: 'Ring me', created_at: AT, msg_type: 'query', read_at: AT, kept: true, manual_subject: 'Rice', auto_subject: 'Order', track: 'order', particulars: 'Ponni 24 kg', chit_status: 'pending' };
/** a product-subject message: chit_messages_subject_ck lets chit_id and line_id be NULL, and the inbox query does not filter it out; the chit joins find nothing */
const MESSAGE_PRODUCT = { message_id: '77777777-7777-4777-8777-777777777777', chit_id: null, line_id: null, sender_display_name: 'Asha', sender_entity_id: '44444444-4444-4444-8444-444444444444', message_text: 'Is it in stock', created_at: AT, msg_type: 'query', read_at: null, kept: false, manual_subject: null, auto_subject: null, track: 'task', particulars: null, chit_status: null };
const MESSAGE_BARE = { message_id: '33333333-3333-4333-8333-333333333333', chit_id: PARTY, line_id: null, sender_display_name: 'Ravi', sender_entity_id: '44444444-4444-4444-8444-444444444444', message_text: 'Hello', created_at: AT, msg_type: 'info', read_at: null, kept: false, manual_subject: null, auto_subject: null, track: 'task', particulars: null, chit_status: null };
/** a copy of a chit as lib/select rows hands it to the measure (the status words are lib/rail-actions') */
const CHIT = (extra) => Object.assign({ chit_id: PARTY, current_status: 'pending', direction: 'received', folder_id: null, created_at: '2026-09-01T10:00:00.000Z', read_at: null, touched_at: null, open_disputes: 0, resolved_disputes: 0, value: '100', currency: 'INR', assigned_to_actor_id: null, doc_kind: 'invoice', counterparty_id: PARTY, counterparty_name: 'Asha Traders' }, extra);
const CHITS = [
  CHIT({}),
  CHIT({ chit_id: '33333333-3333-4333-8333-333333333333', direction: 'sent', current_status: 'completed', folder_id: PARTY, read_at: AT, touched_at: AT, open_disputes: 1, assigned_to_actor_id: '44444444-4444-4444-8444-444444444444', value: null }),
  CHIT({ chit_id: '55555555-5555-4555-8555-555555555555', doc_kind: 'bill_received', currency: 'AED' })
];
/** a chit copy filed into a folder the shop cannot see: the reconcile's discrepancy */
const STRAY = CHIT({ chit_id: '66666666-6666-4666-8666-666666666666', folder_id: '77777777-7777-4777-8777-777777777777' });
/** a line of the worklist as its statement selects it (chit_line_assignment + chit_line + the chit's header and status) */
const WORK_ROW = { assignee_actor_id: '44444444-4444-4444-8444-444444444444', assignee_name: 'Murugan', assignee_type: 'actor', task: 'Pack', due_date: '2026-10-02', note: 'n', chit_id: PARTY, line_id: PARTY, seq: 2, state: 'doing', particulars: 'Ponni 24 kg', quantity: '10', unit: 'kg', removed: false, comment: 'c', asked_as: 'usual rice', raw_phrase: 'the usual rice', needs_human: true, delivered: '4', chit_status: 'pending', manual_subject: 'Rice', auto_subject: 'Order', sender_entity_display_name: 'Asha Traders' };
const WORK_BARE = { assignee_actor_id: null, assignee_name: null, assignee_type: null, task: null, due_date: null, note: null, chit_id: PARTY, line_id: '33333333-3333-4333-8333-333333333333', seq: 0, state: 'open', particulars: null, quantity: null, unit: null, removed: false, comment: null, asked_as: null, raw_phrase: null, needs_human: false, delivered: null, chit_status: null, manual_subject: null, auto_subject: null, sender_entity_display_name: null };
/** a system folder as lib/folder-views systemFolders builds it */
const SYSTEM_ROW = (extra) => Object.assign({ folder_id: PARTY, parent_id: null, name: 'Bills', code: 'B-2100', kind: 'view', system: true, scope: null, side: 'received', ledger: null, sort: 0, count: 0, total: 0 }, extra);
const withChits = (rows) => ({ select: { rows: async () => rows } });
const FOLDER_LIST = /ORDER BY f\.parent_id NULLS FIRST/;
const FOLDER_PAIR = answering(/SELECT folder_id, parent_id, name FROM folder/, [{ folder_id: PARTY, parent_id: null, name: 'Mayur' }, { folder_id: '33333333-3333-4333-8333-333333333333', parent_id: PARTY, name: 'Late' }]);
const FOLDER_ONE = answering(/SELECT folder_id, parent_id, name FROM folder/, [{ folder_id: PARTY, parent_id: null, name: 'Mayur' }]);
const READY = [
  X('folders-ready', 'GET ' + F, 200, { setup: { sqlRows: answering(FOLDER_LIST, [FOLDER_FILED, FOLDER_VIEW]) }, patch: withChits(CHITS) }),
  /* lib/folder-inventory ledgerOf answers { code, name, role }, { code, name, group } (a group of the chart, e.g. E-6000) or null: all three are seen */
  X('folders-ledger-role-group-null', 'GET ' + F, 200, { patch: { views: { systemFolders: async () => [SYSTEM_ROW({ ledger: { code: '2100', name: 'Suppliers', role: 'creditors' } }), SYSTEM_ROW({ code: 'E-6000', ledger: { code: '6000', name: 'Expenses', group: 'expenses' } }), SYSTEM_ROW({ code: 'R-1', ledger: null })] } } }),
  X('folders-sort-not-set', 'GET ' + F, 200, { setup: { sqlRows: answering(FOLDER_LIST, [FOLDER_NO_SORT]) } }),
  X('folders-view-count-fails', 'GET ' + F, 200, { setup: { sqlRows: answering(FOLDER_LIST, [FOLDER_FILED, FOLDER_VIEW]) }, patch: { views: { members: async () => { throw new Error(SECRET_SQL); } } } }),
  X('folders-past-the-cap', 'GET ' + F, 200, { url: F + '?limit=9999&page=2', setup: { sqlRows: answering(FOLDER_LIST, [FOLDER_FILED]) } }),
  X('rules-ready', 'GET ' + F + '/rules', 200, { setup: { sqlRows: answering(/FROM folder_rule/, [RULE_FULL, RULE_BARE, RULE_FROM_ONLY]) } }),
  X('rules-past-the-cap', 'GET ' + F + '/rules', 200, { url: F + '/rules?limit=9999&page=2', setup: { sqlRows: answering(/FROM folder_rule/, [RULE_FULL]) } }),
  X('messages-ready', 'GET ' + F + '/messages', 200, { setup: { sqlRows: answering(/FROM chit_messages m/, [MESSAGE_FULL, MESSAGE_BARE]) } }),
  X('messages-about-a-product', 'GET ' + F + '/messages', 200, { setup: { sqlRows: answering(/FROM chit_messages m/, [MESSAGE_PRODUCT]) } }),
  X('messages-past-the-cap', 'GET ' + F + '/messages', 200, { url: F + '/messages?all=1&limit=9999&page=2', setup: { sqlRows: answering(/FROM chit_messages m/, [MESSAGE_FULL]) } }),
  X('badge-count-of-two', 'GET ' + F + '/messages', 200, { url: F + '/messages?count=true', setup: { sqlRows: answering(/count\(\*\)::int AS n FROM chit_messages/, [{ n: 2 }]) } }),
  X('worklist-ready', 'GET ' + F + '/worklist', 200, { url: F + '/worklist?due_on=2026-10-02&actor_id=' + PARTY, setup: { sqlRows: answering(/WITH latest AS/, [WORK_ROW, WORK_BARE]) } }),
  X('worklist-not-migrated', 'GET ' + F + '/worklist', 200, { setup: { sqlRows: raising(/WITH latest AS/, '42P01') } }),
  X('groupsum-ready', 'GET ' + F + '/groupsum', 200, { url: F + '/groupsum?scope=order&archived=1', setup: { sqlRows: answering(/FROM chit_detail/, [{ chit_id: PARTY, line_items: [{ particulars: 'Ponni 24 kg', quantity: 2, unit: 'kg', price: 50 }, { particulars: 'Dal', quantity: 1, unit: 'kg' }] }]) }, patch: withChits(CHITS) }),
  X('mis-ready', 'GET ' + F + '/mis', 200, { patch: withChits(CHITS) }),
  X('reconcile-ready', 'GET ' + F + '/reconcile', 200, { setup: { sqlRows: FOLDER_PAIR }, patch: withChits(CHITS) }),
  /* a folder that is its own parent (a loop in the tree) is counted once: the answer used to be a stack overflow, a 500 */
  X('reconcile-folder-loop', 'GET ' + F + '/reconcile', 200, { setup: { sqlRows: answering(/SELECT folder_id, parent_id, name FROM folder/, [{ folder_id: PARTY, parent_id: PARTY, name: 'Loop' }]) }, patch: withChits(CHITS) }),
  /* two folders that are each other's parent */
  X('reconcile-two-folder-cycle', 'GET ' + F + '/reconcile', 200, { setup: { sqlRows: answering(/SELECT folder_id, parent_id, name FROM folder/, [{ folder_id: PARTY, parent_id: '33333333-3333-4333-8333-333333333333', name: 'A' }, { folder_id: '33333333-3333-4333-8333-333333333333', parent_id: PARTY, name: 'B' }]) }, patch: withChits(CHITS) }),
  X('reconcile-does-not-add-up', 'GET ' + F + '/reconcile', 200, { setup: { sqlRows: FOLDER_ONE }, patch: withChits(CHITS.concat([STRAY])) })
];
/** a filed folder's chit as GET /:id/chits selects it (chit_header + chit_status; the raiser's name a sub-select): the second with every nullable column NULL */
const FILED_CHIT = { chit_id: PARTY, sender_entity_display_name: 'Asha Traders', auto_subject: 'Order', manual_subject: 'Rice', purpose: 'order', created_at: AT, business_json: { kind: 'device_signal', device_id: 'D1', value: 4, unit: 'C' }, created_by_actor_id: '44444444-4444-4444-8444-444444444444', raiser_name: 'Murugan', direction: 'received', current_status: 'pending', _total: '2' };
const FILED_CHIT_BARE = { chit_id: '33333333-3333-4333-8333-333333333333', sender_entity_display_name: null, auto_subject: null, manual_subject: null, purpose: 'general', created_at: AT, business_json: null, created_by_actor_id: null, raiser_name: null, direction: 'sent', current_status: null, _total: '2' };
/** a bill of a view folder as lib/folder-views members answers it: a lib/select row with its lifecycle (lib/bill-steps) */
const VIEW_BILL = CHIT({ doc_kind: 'bill_received', bill: { step: 'received', code: 'B1', label: 'Received', by: null, at: AT, open: true, history: [] } });
const MEMBERS = (chits) => ({ views: { members: async () => ({ chits, counts: { open: chits.length, closed: 0, total: chits.length }, state: 'open' }) } });
/** S35: the folder read of routes/folders.js viewFolder finds a FILED folder of this shop (no row there is the unknown id's 404) */
const FILED_HERE = answering(/to_jsonb\(f\)->>'kind' AS kind FROM folder f WHERE f\.folder_id/, [{ folder_id: PARTY, name: 'Mayur', kind: null }]);
const SHOP_VIEW = answering(/to_jsonb\(f\)->>'kind' AS kind FROM folder f WHERE f\.folder_id/, [{ folder_id: PARTY, name: 'From Asha', kind: 'view' }]);
const SUBJECT_CHIT = CHIT({ chit_id: '77777777-7777-4777-8777-777777777777', manual_subject: 'Rice for Diwali', auto_subject: 'Order 7' });
/** a matched chit with every nullable column of its sample NULL: no counterparty name (lib/select: no recipient name), no status, no created_at */
const NAMELESS_CHIT = CHIT({ chit_id: '88888888-8888-4888-8888-888888888888', counterparty_name: null, current_status: null, created_at: null });
/* S34, second pass: the success side of every folders route the first pass left (a write's read-back, a filed and a view folder, nullable columns NULL in one scene and filled in another) */
const SWEEP_2 = [
  X('folder-deleted', 'DELETE ' + F + '/:id', 200, { setup: { sqlRows: answering(/DELETE FROM folder WHERE/, [{}]) } }),
  X('chit-filed', 'POST ' + F + '/move', 200, { body: { chit_id: PARTY, folder_id: PARTY }, setup: { sqlRows: firstOf(answering(/SELECT scope FROM folder/, [{ scope: 'task' }]), answering(/UPDATE chit_status SET folder_id/, [{}])) } }),
  X('chit-filed-in-a-folder-without-a-side', 'POST ' + F + '/move', 200, { body: { chit_id: PARTY, folder_id: PARTY, direction: 'sent' }, setup: { sqlRows: firstOf(answering(/SELECT scope FROM folder/, [{ scope: null }]), answering(/UPDATE chit_status SET folder_id/, [{}, {}])) } }),
  X('chit-unfiled', 'POST ' + F + '/move', 200, { body: { chit_id: PARTY, folder_id: null } }),
  X('chits-listed', 'GET ' + F + '/:id/chits', 200, { setup: { sqlRows: firstOf(FILED_HERE, answering(/AS _total/, [FILED_CHIT, FILED_CHIT_BARE])) } }),
  X('chits-past-the-cap', 'GET ' + F + '/:id/chits', 200, { url: F + '/' + PARTY + '/chits?limit=9999&archived=1', setup: { sqlRows: firstOf(FILED_HERE, answering(/AS _total/, [Object.assign({}, FILED_CHIT, { _total: '900' })])) } }),
  X('chits-of-a-system-view', 'GET ' + F + '/:id/chits', 200, { url: F + '/' + sysId('B-2100') + '/chits', patch: MEMBERS([VIEW_BILL]) }),
  X('chits-of-a-shops-view', 'GET ' + F + '/:id/chits', 200, { setup: { sqlRows: SHOP_VIEW }, patch: MEMBERS([VIEW_BILL, CHIT({})]) }),
  X('chits-of-a-view-past-the-cap', 'GET ' + F + '/:id/chits', 200, { url: F + '/' + sysId('B-2100') + '/chits?limit=1', patch: MEMBERS([VIEW_BILL, VIEW_BILL]) }),
  X('metrics-of-a-task-folder', 'GET ' + F + '/:id/metrics', 200, { setup: { sqlRows: firstOf(FILED_HERE, answering(/SELECT scope FROM folder/, [{ scope: 'task' }])) }, patch: withChits(CHITS) }),
  X('metrics-of-a-system-view', 'GET ' + F + '/:id/metrics', 200, { url: F + '/' + sysId('B-2100') + '/metrics', patch: withChits(CHITS) }),
  X('metrics-scope-read-fails', 'GET ' + F + '/:id/metrics', 200, { setup: { sqlRows: firstOf(FILED_HERE, raising(/SELECT scope FROM folder/, 'XX000')) }, patch: withChits(CHITS) }),
  X('rules-of-a-folder', 'GET ' + F + '/:id/rules', 200, { setup: { sqlRows: firstOf(OWN_FOLDER, answering(/FROM folder_rule/, [RULE_FULL, RULE_BARE, RULE_FROM_ONLY])) } }),
  X('rules-of-a-folder-not-migrated', 'GET ' + F + '/:id/rules', 200, { setup: { sqlRows: firstOf(OWN_FOLDER, raising(/FROM folder_rule/, '42P01')) } }),
  /* S35: an id no folder, rule or message of this shop has is a 404 (before: 200 with an empty list, or { deleted: 0 }); another shop's id is the same answer (tools/api-contract-tests.cjs foreign_id_404) */
  N('chits-folder-not-here', 'GET ' + F + '/:id/chits', 404, {}),
  N('metrics-folder-not-here', 'GET ' + F + '/:id/metrics', 404, {}),
  N('rules-folder-not-here', 'GET ' + F + '/:id/rules', 404, {}),
  N('folder-delete-not-here', 'DELETE ' + F + '/:id', 404, {}),
  N('rule-delete-not-here', 'DELETE ' + F + '/rules/:rule_id', 404, {}),
  X('rule-updated', 'PATCH ' + F + '/rules/:rule_id', 200, { body: { enabled: false, sort: 2 }, setup: { sqlRows: answering(/UPDATE folder_rule/, [RULE_SAVED]) } }),
  X('rule-updated-bare', 'PATCH ' + F + '/rules/:rule_id', 200, { body: { name: '' }, setup: { sqlRows: answering(/UPDATE folder_rule/, [RULE_SAVED_BARE]) } }),
  X('rule-deleted', 'DELETE ' + F + '/rules/:rule_id', 200, { setup: { sqlRows: answering(/DELETE FROM folder_rule/, [{}]) } }),
  X('preview-matched', 'POST ' + F + '/rules/preview', 200, { body: { when: { doc: 'invoice' } }, patch: withChits(CHITS.concat([SUBJECT_CHIT])) }),
  X('preview-matched-a-nameless-chit', 'POST ' + F + '/rules/preview', 200, { body: { when: { doc: 'invoice' } }, patch: withChits([NAMELESS_CHIT]) }),
  X('preview-matched-nothing', 'POST ' + F + '/rules/preview', 200, { body: { when: { doc: 'quote' } }, patch: withChits(CHITS) }),
  X('level-set', 'PUT ' + F + '/inventory/:code', 200, { url: F + '/inventory/RT-4090', body: { msg: 'none' } }),
  X('message-kept', 'POST ' + F + '/messages/:message_id/mark', 200, { body: { kept: true }, setup: { sqlRows: answering(/chit_message_mark/, [{ marked_count: '1' }]) } }),
  /* RAIL-146g: a co-assist without can_see_costs reads the sum of the sales only, with cost_hidden: the closed groupsum shape holds the blind answer too */
  X('groupsum-cost-blind', 'GET ' + F + '/groupsum', 200, { url: F + '/groupsum?scope=task', setup: { who: STAFF, sqlRows: answering(/FROM chit_detail/, [{ chit_id: PARTY, line_items: [{ particulars: 'Ponni 24 kg', quantity: 2, unit: 'kg', price: 50 }] }]) }, patch: withChits(CHITS) })
];
const EXTRAS = [
  /* the express-validator chains: a validation refusal keeps its { error, details } body */
  X('name-missing', 'POST ' + F, 400, { body: {} }),
  X('name-too-long', 'POST ' + F, 400, { body: { name: 'x'.repeat(61) } }),
  X('db-fails-with-a-name', 'POST ' + F, 500, { body: { name: 'Mayur' }, setup: { db: 'fail' } }),
  X('parent-not-an-id', 'POST ' + F, 400, { body: { name: 'Mayur', parent_id: 'nope' } }),
  X('parent-not-found', 'POST ' + F, 400, { body: { name: 'Mayur', parent_id: PARTY } }),
  X('view-folder-not-migrated', 'POST ' + F, 503, { body: { name: 'Mayur', kind: 'view' }, setup: { sqlRows: raising(/INSERT INTO folder/, '42703') } }),
  X('view-folder-made', 'POST ' + F, 200, { body: { name: 'Mayur', kind: 'view' }, setup: { sqlRows: answering(/INSERT INTO folder/, [FOLDER_ROW({ kind: 'view' })]) } }),
  /* S34: the view folder as the INSERT RETURNs it (folder_id, parent_id, name, sort, scope, kind): parent_id is NULL by the statement, sort is nullable */
  X('view-folder-made-read-back', 'POST ' + F, 200, { body: { name: 'Mayur', kind: 'view', scope: 'order' }, setup: { sqlRows: answering(/INSERT INTO folder/, [{ folder_id: PARTY, parent_id: null, name: 'Mayur', sort: null, scope: 'order', kind: 'view' }]) } }),
  X('folder-made-under-a-parent', 'POST ' + F, 200, { body: { name: 'Late', parent_id: PARTY }, setup: { sqlRows: firstOf(OWN_FOLDER, answering(/INSERT INTO folder \(entity_id, parent_id, name, scope\)/, [{ folder_id: '33333333-3333-4333-8333-333333333333', parent_id: PARTY, name: 'Late', sort: 0, scope: 'task' }])) } }),
  X('folder-made-at-the-top', 'POST ' + F, 200, { body: { name: 'Mayur', scope: 'order' }, setup: { sqlRows: answering(/INSERT INTO folder \(entity_id, parent_id, name, scope\)/, [{ folder_id: PARTY, parent_id: null, name: 'Mayur', sort: null, scope: null }]) } }),
  X('folder-made-before-b133', 'POST ' + F, 200, { body: { name: 'Mayur' }, setup: { sqlRows: raising(/INSERT INTO folder \(entity_id, parent_id, name, scope\)/, '42703') } }),
  X('db-fails-with-a-name', 'PATCH ' + F + '/:id', 500, { body: { name: 'Mayur' }, setup: { db: 'fail' } }),
  X('folder-not-found', 'PATCH ' + F + '/:id', 404, { body: { name: 'Mayur' } }),
  X('nothing-to-update', 'PATCH ' + F + '/:id', 400, { body: {} }),
  X('own-parent', 'PATCH ' + F + '/:id', 400, { body: { parent_id: PARTY } }),
  /* RAIL-137 (c): a parent BELOW the folder (the walk up from it reaches the folder) is refused; nothing is updated */
  X('parent-below-itself', 'PATCH ' + F + '/:id', 400, { body: { parent_id: '33333333-3333-4333-8333-333333333333' }, setup: { sqlRows: firstOf(OWN_FOLDER, answering(/WITH RECURSIVE up AS/, [{ '?column?': 1 }]), (sql) => { if (/UPDATE folder SET/.test(sql)) throw new Error('the cycle was written'); return null; }) } }),
  X('name-empty', 'PATCH ' + F + '/:id', 400, { body: { name: '' } }),
  N('parent-folder-not-found', 'PATCH ' + F + '/:id', 404, { body: { parent_id: '33333333-3333-4333-8333-333333333333' } }),
  N('parent-not-an-id', 'PATCH ' + F + '/:id', 404, { body: { parent_id: 'nope' } }),
  N('moved-under-own-folder', 'PATCH ' + F + '/:id', 200, { body: { parent_id: '33333333-3333-4333-8333-333333333333' }, setup: { sqlRows: firstOf(OWN_FOLDER, answering(/UPDATE folder SET/, [FOLDER_BACK('33333333-3333-4333-8333-333333333333')])) } }),
  X('renamed', 'PATCH ' + F + '/:id', 200, { body: { name: 'Mayur' }, setup: { sqlRows: answering(/UPDATE folder SET/, [FOLDER_BACK(null)]) } }),
  X('db-fails-with-a-chit', 'POST ' + F + '/move', 500, { body: { chit_id: PARTY }, setup: { db: 'fail' } }),
  X('chit-not-an-id', 'POST ' + F + '/move', 400, { body: { chit_id: 'nope' } }),
  X('chit-missing', 'POST ' + F + '/move', 400, { body: {} }),
  X('into-a-system-folder', 'POST ' + F + '/move', 400, { body: { chit_id: PARTY, folder_id: sysId('B-2100') } }),
  X('into-a-shops-view-folder', 'POST ' + F + '/move', 400, { body: { chit_id: PARTY, folder_id: PARTY }, setup: { sqlRows: answering(/to_jsonb\(f\)->>'kind' AS kind/, [{ kind: 'view' }]) } }),
  /* RAIL-137 (a): a folder_id that is not an id is the schema's 400, never the database's 500 */
  X('folder-not-an-id', 'POST ' + F + '/move', 400, { body: { chit_id: PARTY, folder_id: 'inbox' }, setup: { sqlRows: (sql) => { if (/FROM folder/.test(sql)) throw Object.assign(new Error('invalid input syntax for type uuid: "inbox"'), { code: '22P02' }); return null; } } }),
  X('folder-not-found', 'POST ' + F + '/move', 400, { body: { chit_id: PARTY, folder_id: PARTY } }),
  X('wrong-side', 'POST ' + F + '/move', 400, { body: { chit_id: PARTY, folder_id: PARTY, direction: 'sent' }, setup: { sqlRows: answering(/SELECT scope FROM folder/, [{ scope: 'task' }]) } }),
  X('move-retried-without-scope', 'POST ' + F + '/move', 400, { body: { chit_id: PARTY, folder_id: PARTY }, setup: { sqlRows: raising(/SELECT scope FROM folder/, '42703') } }),
  X('switched-off-folder', 'GET ' + F + '/:id/chits', 404, { url: F + '/' + sysId('E-6000') + '/chits' }),
  X('switched-off-folder', 'GET ' + F + '/:id/metrics', 404, { url: F + '/' + sysId('E-6000') + '/metrics' }),
  X('system-rule-is-fixed', 'POST ' + F + '/:id/rules', 400, { url: F + '/' + sysId('B-2100') + '/rules', body: {} }),
  X('system-rule-shown', 'GET ' + F + '/:id/rules', 200, { url: F + '/' + sysId('B-2100') + '/rules' }),
  X('db-fails-with-a-rule', 'POST ' + F + '/:id/rules', 500, { body: { when: { doc: 'invoice' } }, setup: { db: 'fail' } }),
  X('condition-unknown', 'POST ' + F + '/:id/rules', 400, { body: BAD_WHEN }),
  X('rules-not-migrated', 'POST ' + F + '/:id/rules', 503, { body: { when: { doc: 'invoice' } }, setup: { sqlRows: firstOf(OWN_FOLDER, raising(/INSERT INTO folder_rule/, '42P01')) } }),
  N('rule-folder-not-found', 'POST ' + F + '/:id/rules', 404, { body: { when: { doc: 'invoice' } } }),
  N('rule-made-in-own-folder', 'POST ' + F + '/:id/rules', 200, { body: { name: 'Invoices', when: WHEN_FULL, sort: 1, stop_processing: true }, setup: { sqlRows: firstOf(OWN_FOLDER, answering(/INSERT INTO folder_rule/, [RULE_MADE])) } }),
  N('rule-made-without-a-name', 'POST ' + F + '/:id/rules', 200, { body: { when: { from: 'asha' }, enabled: false }, setup: { sqlRows: firstOf(OWN_FOLDER, answering(/INSERT INTO folder_rule/, [RULE_MADE_BARE])) } }),
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
  X('message-marked', 'POST ' + F + '/messages/:message_id/mark', 200, { body: { read: true }, setup: { sqlRows: answering(/chit_message_mark/, [{ marked_count: 1 }]) } }),
  X('badge-count', 'GET ' + F + '/messages', 200, { url: F + '/messages?count=1' }),
  X('actor-sees-theirs', 'GET ' + F + '/messages', 200, { setup: { who: STAFF } }),
  X('due-date-not-a-date', 'GET ' + F + '/worklist', 400, { url: F + '/worklist?due_on=tomorrow' }),
  X('actor-worklist', 'GET ' + F + '/worklist', 200, { setup: { who: STAFF } }),
  X('groupsum-order', 'GET ' + F + '/groupsum', 200, { url: F + '/groupsum?scope=order&folder_id=' + PARTY + '&chit_ids=' + PARTY }),
  X('mis-since', 'GET ' + F + '/mis', 200, { url: F + '/mis?since=2026-01-01' }),
  N('mis-since-junk', 'GET ' + F + '/mis', 400, { url: F + '/mis?since=junk' }),
  X('reconcile-order', 'GET ' + F + '/reconcile', 200, { url: F + '/reconcile?scope=order' }),
  X('folders-before-b133', 'GET ' + F, 200, { setup: { sqlRows: raising(/f\.scope,/, '42703') } }),
  X('system-folders-fail', 'GET ' + F, 200, { patch: { views: { systemFolders: async () => { throw new Error(SECRET_SQL); } } } }),
  X('inventory-read', 'GET ' + F + '/inventory', 200, {}),
  X('vocabulary-answer-fails', 'GET ' + F + '/rules/vocabulary', 500, { setup: { jsonThrows: true } }),
  X('vocabulary', 'GET ' + F + '/rules/vocabulary', 200, {}),
  X('inventory-read-fails', 'GET ' + F + '/inventory', 500, { patch: { views: { flagsOf: async () => { throw new Error(SECRET_SQL); } } } }),
  /* S34: the READY branch of the folder reads: the database holds rows, so the real handlers and the real libraries (lib/page-limit, lib/folder-rules, lib/assign, lib/measure) run over them */
  ...READY,
  ...SWEEP_2,
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
    home: require(path.join(HERE, 'lib', 'home-facts')),
    select: require(path.join(HERE, 'lib', 'select'))
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

async function runScenario(port, scenario) {
  Object.assign(world, FRESH, scenario.setup);
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
  (answer.status === 401 && scenario.id === 'signed-out') || (answer.status === 403 && /pricing\/price/.test(scenario.route) && scenario.setup && scenario.setup.asKey && !scenario.setup.keyScopes);
/** the statuses a test may see from a route, by the contract of the area that owns it */
function allowedFor() {
  const area = { '/api/folders': 'folders-contract.js', '/api/facts': 'facts-contract.js', '/api/pricing': 'pricing-contract.js' };
  const made = Object.fromEntries(Object.keys(area).map((mount) => [mount, require(path.join(HERE, 'lib', area[mount])).allowedStatuses()]));
  return (route) => made[MOUNTS.find((mount) => route.includes(' ' + mount + '/') || route.endsWith(' ' + mount))](route);
}

/** a body's random ids and clock stamps are the same answer on every run: masked before a body is hashed */
const steady = (text) => text.replace(/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/g, 'UUID').replace(/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z/g, 'STAMP');
const shaOf = (answer) => crypto.createHash('sha256').update(steady(answer.text)).digest('hex');
/** --compare F: the answers now against a capture of the code before, byte for byte (status, content type, body); every difference printed */
function compare(captureFile, recording) {
  const before = JSON.parse(fs.readFileSync(captureFile, 'utf8'));
  const differing = Object.keys(before).filter((key) => !recording[key] || recording[key].status !== before[key].status || recording[key].type !== before[key].type || recording[key].sha !== before[key].sha);
  console.log('compared ' + Object.keys(before).length + ' answers: ' + (Object.keys(before).length - differing.length) + ' identical, ' + differing.length + ' different');
  differing.forEach((key) => console.log('  ' + key + ' [' + before[key].status + ' -> ' + (recording[key] && recording[key].status) + ']'));
  return differing.length;
}

/** the shape of a 2xx the extras expect to be an answer, not a refusal: nothing to judge, only the status */
async function checkRoutes(port, scenarios, recording) {
  const tested = {};
  const allowed = argv.includes('--capture') || argv.includes('--compare') ? null : allowedFor();
  for (const scenario of scenarios) {
    const answer = await runScenario(port, scenario);
    const label = scenario.route + ' · ' + scenario.id;
    recording[scenario.route + '|' + scenario.id] = { route: scenario.route, status: answer.status, type: answer.type, body: answer.json, sha: shaOf(answer), request: { url: scenario.url, body: scenario.body } }; /* the request is kept so tools/api-allowlist.cjs can hand the generated output_allowlist case a request known to reach the success answer */
    if (answer.status >= 400) (tested[scenario.route] = tested[scenario.route] || new Set()).add(answer.status);
    if (argv.includes('--capture') || argv.includes('--compare')) continue;
    check(label + ': answers (not a hang)', answer.status !== 0);
    if (scenario.expect !== undefined) check(label + ': answers the status it is built to reach (' + scenario.expect + ')', answer.status === scenario.expect, [answer.status, answer.text.slice(0, 200)]);
    if (answer.status < 400) continue;
    check(label + ': ' + answer.status + ' is a status the contract declares for this route', allowed(scenario.route).includes(answer.status), allowed(scenario.route));
    if (inherited(scenario, answer)) continue;
    checkProblemBody(label, answer);
    if (answer.status >= 500) check(label + ': a 5xx says nothing of its cause', !/SELECT|vault|relation "/.test(answer.text), answer.text);
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

/**
 * API-8 output allow-list (S34): the pricing kinds read's derived 200 shape (docs/contracts/api-output-shapes.json) is CLOSED at its root and every recorded 200 of it fits that shape.
 * The answer is one fixed table, so there is no nullable column; the rows of kinds[] stay open and are listed (the table owns their keys).
 */
function checkPricingAllowList(recording) {
  console.log('\n-- the closed success shape of the pricing kinds read holds every recorded 200 --');
  const route = 'GET /api/pricing/kinds';
  const shape = allowlist.shapeOf(route);
  const engine = require(path.join(HERE, 'middleware', 'validate.js')).bodyEngine;
  const answers = Object.values(recording).filter((one) => one.route === route && one.status === 200 && one.body);
  const fits = shape && engine.compile(shape.schema);
  check(route + ': every recorded 200 (' + answers.length + ') fits the closed shape of its root', !!shape && shape.schema.additionalProperties === false && answers.length > 0 && answers.every((one) => fits(one.body)), { answers: answers.length, errors: fits && fits.errors });
}

/**
 * API-8 output allow-list (S34), second pass: every folders route whose success schema is CLOSED (additionalProperties false, derived in docs/contracts/api-output-shapes.json from these
 * answers and the handler's own keys) has every recorded 200 fit that schema with nothing pruned: a key the schema does not list would be cut, so a drop is an answer that moved.
 * → { route: { output_allowlist: true } }, written to docs/contracts/api-hardening-evidence-areas.json for the folders routes only (facts and pricing keep the generator's evidence).
 */
function checkFoldersAllowList(recording) {
  console.log('\n-- the closed success shapes of the folders routes hold every recorded 200 --');
  const proved = {};
  const operations = require(path.join(HERE, 'lib', 'folders-contract.js')).OPERATIONS;
  const engine = require(path.join(HERE, 'middleware', 'validate.js')).bodyEngine;
  const { prune } = require(path.join(HERE, 'lib', 'output-allowlist.js'));
  Object.keys(operations).sort().forEach((route) => {
    const schema = (((operations[route].responses[200] || {}).content || {})['application/json'] || {}).schema;
    const answers = Object.values(recording).filter((one) => one.route === route && one.status === 200 && one.body);
    const fits = schema && engine.compile(schema);
    const held = !!schema && schema.additionalProperties === false && answers.length > 0 && answers.every((one) => fits(one.body) && prune(schema, one.body).dropped.length === 0);
    check(route + ': every recorded 200 (' + answers.length + ') holds only the keys its closed schema lists', held, { closed: !!schema && schema.additionalProperties === false, answers: answers.length, errors: fits && fits.errors });
    if (held) proved[route] = { output_allowlist: true };
  });
  return proved;
}
/** the folders routes the evidence file says output_allowlist for */
function foldersEvidenceOnDisk() {
  const routes = JSON.parse(fs.readFileSync(EVIDENCE_FILE, 'utf8')).routes || {};
  return Object.fromEntries(Object.keys(routes).filter((route) => FOLDERS_MINE(route) && routes[route].output_allowlist).sort().map((route) => [route, { output_allowlist: true }]));
}
/** write the folders output_allowlist rows into the evidence file (other routes and columns stay as they are) */
function writeFoldersEvidence(proved) {
  const onDisk = JSON.parse(fs.readFileSync(EVIDENCE_FILE, 'utf8'));
  const routes = onDisk.routes || {};
  Object.keys(routes).filter(FOLDERS_MINE).forEach((route) => {
    delete routes[route].output_allowlist;
    if (!Object.keys(routes[route]).length) delete routes[route];
  });
  Object.keys(proved).forEach((route) => (routes[route] = Object.assign(routes[route] || {}, proved[route])));
  const sorted = Object.fromEntries(Object.keys(routes).sort().map((route) => [route, routes[route]]));
  fs.writeFileSync(EVIDENCE_FILE, JSON.stringify(Object.assign({}, onDisk, { routes: sorted }), null, 1) + '\n');
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
 * S33 strict input: each of the eight folders writes refuses a body key no one reads, by name (UNKNOWN_FIELD, middleware/validate.js), in the route's own refusal
 * (400 FOLDER_INVALID with the chain's old body where the route had a chain, else 422), while every key a web caller sends (app/cap-folders.js · app/cap-messages.js · app.html) is still let through.
 */
const STRICT_WRITES = [
  ['PUT', F + '/inventory/B-2100', { on: true }, 422],
  ['POST', F, { name: 'Mayur' }, 400],
  ['PATCH', F + '/' + PARTY, { name: 'Mayur' }, 400],
  ['POST', F + '/move', { chit_id: PARTY }, 400],
  ['POST', F + '/' + PARTY + '/rules', { when: { doc: 'invoice' } }, 400],
  ['PATCH', F + '/rules/' + PARTY, { enabled: true }, 400],
  ['POST', F + '/rules/preview', { when: { doc: 'invoice' } }, 422],
  ['POST', F + '/messages/' + PARTY + '/mark', { read: true }, 422]
];
/** the bodies the web sends today, key for key: none of them may meet UNKNOWN_FIELD */
const WEB_BODIES = [
  ['POST', F, { name: 'Mayur', scope: 'order' }],
  ['PATCH', F + '/' + PARTY, { name: 'Mayur' }],
  ['POST', F + '/move', { chit_id: PARTY, folder_id: PARTY }],
  ['POST', F + '/' + PARTY + '/rules', { name: 'Invoices', when: { doc: 'invoice' } }],
  ['PATCH', F + '/rules/' + PARTY, { sort: 2 }],
  ['PATCH', F + '/rules/' + PARTY, { enabled: false }],
  ['POST', F + '/rules/preview', { when: { doc: 'invoice' } }],
  ['POST', F + '/messages/' + PARTY + '/mark', { read: true }],
  ['POST', F + '/messages/' + PARTY + '/mark', { kept: false }]
];
async function checkStrictInput(port) {
  console.log('\n-- strict input (S33): a key no one reads is refused by name; a key the web sends is not --');
  for (const [method, url, valid, status] of STRICT_WRITES) {
    Object.assign(world, FRESH);
    const answer = await send(port, method, url, Object.assign({}, valid, { zz_unknown_field: 'x' }));
    const body = answer.json || {};
    const named = (body.errors || []).some((entry) => entry.field === 'zz_unknown_field' && entry.code === 'UNKNOWN_FIELD');
    const oldBody = status === 422 || (body.error === 'Validation failed' && sameValue(body.details, [{ field: 'zz_unknown_field', message: 'Invalid value' }]));
    check(method + ' ' + url + ': zz_unknown_field is refused ' + status + ' by name, in the route\'s own refusal', answer.status === status && named && !!body.type && oldBody, { status: answer.status, body });
  }
  for (const [method, url, sent] of WEB_BODIES) {
    Object.assign(world, FRESH);
    const answer = await send(port, method, url, sent);
    const refused = ((answer.json || {}).errors || []).filter((entry) => entry.code === 'UNKNOWN_FIELD');
    check(method + ' ' + url + ' ' + JSON.stringify(sent) + ': the web\'s keys are let through the schema', refused.length === 0, refused);
  }
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
  const tested = await checkRoutes(server.address().port, scenariosOf(routes), recording);
  if (!flagValue('--capture') && !flagValue('--compare')) await checkStrictInput(server.address().port);
  server.close();
  if (flagValue('--compare')) process.exit(compare(flagValue('--compare'), recording) ? 1 : 0);
  if (flagValue('--capture')) {
    fs.writeFileSync(flagValue('--capture'), JSON.stringify(recording, null, 1));
    console.log('captured ' + Object.keys(recording).length + ' answers over ' + Object.keys(routes).length + ' routes');
    process.exit(0);
  }
  checkFolderWords();
  await checkChainsAgree();
  checkOtherContracts();
  checkKitWidening();
  checkPricingAllowList(recording);
  const foldersHeld = checkFoldersAllowList(recording);
  if (argv.includes('--write')) writeFoldersEvidence(foldersHeld);
  else check('docs/contracts/api-hardening-evidence-areas.json says output_allowlist for exactly the folders routes whose 200 held closed here', sameValue(foldersEvidenceOnDisk(), foldersHeld), { onDisk: Object.keys(foldersEvidenceOnDisk()).length, held: Object.keys(foldersHeld).length });
  const legacy = JSON.parse(fs.readFileSync(LEGACY_FILE, 'utf8')).routes;
  const frozen = Object.keys(legacy).filter(MINE).reduce((sum, route) => sum + legacy[route].answers.length, 0);
  check('every refusal recorded before the sweep is replayed against the code: ' + frozen + ' answers, each once, byte for byte', frozen > 100, frozen);
  const answers = Object.values(recording);
  check('the output allow-list dropped no key from any answer', allowlist.droppedKeys().length === 0, allowlist.droppedKeys());
  check('a caller who is not signed in is refused with 401 on every route that asks for sign-in', Object.keys(recording).filter((key) => key.endsWith('|signed-out')).every((key) => recording[key].status === 401 || /pricing\/kinds/.test(key)));
  check('a 500 never says its cause: no answer of any route carries the database text', answers.every((one) => !JSON.stringify(one.body || {}).includes('vault')));
  const coverage = Object.fromEntries(Object.keys(tested).sort().map((route) => [route, [...tested[route]].sort((a, b) => a - b)]));
  const onDisk = JSON.parse(fs.readFileSync(TESTED_FILE, 'utf8'));
  const mine = Object.fromEntries(Object.keys(onDisk).filter(MINE).sort().map((route) => [route, onDisk[route]]));
  if (argv.includes('--write')) {
    const others = Object.fromEntries(Object.keys(onDisk).filter((route) => !MINE(route)).map((route) => [route, onDisk[route]]));
    const merged = Object.assign(others, coverage);
    fs.writeFileSync(TESTED_FILE, JSON.stringify(Object.fromEntries(Object.keys(merged).sort().map((route) => [route, merged[route]])), null, 1) + '\n');
  } else check('docs/contracts/api-error-tests.json lists exactly the statuses these scenarios cover for routes/folders.js · routes/facts.js · routes/pricing.js', sameValue(mine, coverage), { onDisk: Object.keys(mine).length, covered: Object.keys(coverage).length });
  console.log('\n  ' + passed + ' checks, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
