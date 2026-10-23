#!/usr/bin/env node
/**
 * api-problem-marketing.test.cjs — API-4 sweep, marketing: every refusal of routes/crm.js, marketing.js, offers.js, network-offers.js and combo-templates.js.
 *
 * OWNS      the proof that each refusal of these five routers is a Problem body AND still carries the keys it answered before (docs/contracts/api-legacy.json, recorded from the
 *           code before the sweep), and this file's rows of docs/contracts/api-error-tests.json (the statuses each route is tested for, which the register's error_tests column reads).
 *           Also: no answer outside the statuses the route's contract declares (lib/*-contract.js), and the refusal mappers of the five contracts as units.
 * CALLED BY scripts/guards.cjs · CI. No database, no network: the real routers over a stand-in db and auth.
 * FLOW      route list (read from each router) x world (signed out, a key, staff, viewer, a bad id, a failing db, an empty db) + the named extras
 *           → real route → body → Problem fields present · frozen legacy keys equal · no leak on a 5xx · statuses tested → manifest
 *
 *   node tests/api-problem-marketing.test.cjs                    check
 *   node tests/api-problem-marketing.test.cjs --write            rewrite this file's rows of docs/contracts/api-error-tests.json
 *   node tests/api-problem-marketing.test.cjs --capture F        (run on the code BEFORE the change) record each answer to file F
 *   node tests/api-problem-marketing.test.cjs --freeze F         merge a capture F into docs/contracts/api-legacy.json (the frozen answers)
 */
'use strict';
const path = require('path');
const fs = require('fs');
const express = require('express');
const kit = require('./problem-sweep-kit.cjs');

const HERE = path.join(__dirname, '..');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
const LEGACY_FILE = path.join(HERE, 'docs', 'contracts', 'api-legacy.json');
const TESTED_FILE = path.join(HERE, 'docs', 'contracts', 'api-error-tests.json');
/** the five routers: mount, route file (named in full so the graph links this test to each), and the contract module that declares its statuses */
const AREAS = [
  { mount: '/api/crm', file: 'routes/crm.js', contract: 'lib/crm-contract.js', export: 'crmContract' },
  { mount: '/api/marketing', file: 'routes/marketing.js', contract: 'lib/crm-contract.js', export: 'marketingContract' },
  { mount: '/api/offers', file: 'routes/offers.js', contract: 'lib/offers-contract.js', export: 'contract' },
  { mount: '/api/network-offers', file: 'routes/network-offers.js', contract: 'lib/network-offers-contract.js', export: 'contract' },
  { mount: '/api/combo-templates', file: 'routes/combo-templates.js', contract: 'lib/combo-templates-contract.js', export: 'contract' }
];
const MINE = (route) => AREAS.some((area) => route.includes(' ' + area.mount + '/') || route.endsWith(' ' + area.mount));
const argv = process.argv.slice(2);
const flagValue = (flag) => (argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : null);
const { check, tally } = kit.checker(argv);

/* ── stand-ins: auth and the db ────────────────────────────────────────────────────────────────────────────── */
const SHOP = '11111111-1111-4111-8111-111111111111';
const PARTY = '22222222-2222-4222-8222-222222222222';
const OWNER = { identity_id: SHOP, identity_type: 'entity', display_name: 'Test shop' };
const STAFF = { identity_id: '44444444-4444-4444-8444-444444444444', parent_entity_id: SHOP, identity_type: 'actor', access_level: 'editor' };
const VIEWER = Object.assign({}, STAFF, { access_level: 'viewer' });
const SECRET_SQL = 'relation "party_secret" does not exist -- SELECT secret FROM vault';
const FRESH = { realAuth: false, who: OWNER, asKey: false, db: 'ok', sqlRows: null };
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
  const known = {
    query: async (sql) => rowsFor(sql),
    withEntity: async (id, run) => run(client),
    withTransaction: async (run) => run(client),
    trySavepoint: async (handle, run, fallback) => run().catch(() => fallback),
    readBatch: async (entity, actor, statements) => {
      if (world.db === 'fail') throw new Error(SECRET_SQL);
      return statements.map(() => ({ rows: [], rowCount: 0 }));
    }
  };
  const db = new Proxy(known, {
    get: (target, name) => (name in target ? target[name] : typeof name === 'symbol' || name === 'then' ? undefined : async () => ({ rows: [], rowCount: 0 }))
  });
  mock('db', db);
  mock('db/index', db);
  console.error = () => undefined; /* the routes log a 5xx here; the scenarios read the answer */
  console.warn = () => undefined;
}

/* ── the scenarios: every route the routers hold x the worlds, then the named extras ────────────────────────── */
const PARAM_VALUES = { id: PARTY, key: 'vip', name: 'vip' };
const WORLDS = [
  { id: 'signed-out', setup: { realAuth: true } },
  { id: 'key-asks', setup: { asKey: true } },
  { id: 'staff-asks', setup: { who: STAFF } },
  { id: 'viewer-asks', setup: { who: VIEWER } },
  { id: 'bad-id', setup: {}, badId: true },
  { id: 'db-fails', setup: { db: 'fail' } },
  { id: 'nothing-found', setup: {} }
];
const X = (id, route, status, extra) => Object.assign({ id, route, expect: status, setup: {} }, extra);
const THROWS = () => {
  throw new Error(SECRET_SQL);
};
const throwsLater = async () => THROWS();
/** a refusal a library throws (lib/crm-followups bad()): .status, .code and the sentence */
const refusal = (status, code, message) => async () => {
  throw Object.assign(new Error(message), { status, code });
};
const MIGRATED = (sql) => (/to_regclass\('party_interaction'\)/.test(sql) ? { rows: [{ i: true, f: true }], rowCount: 1 } : undefined);
const NEED_OK = ['lib/memberships.js', 'need', async () => undefined];
const OFFER_ROW = (status) => (sql) =>
  /FROM definition WHERE entity_id = \$1 AND definition_id/.test(sql)
    ? { rows: [{ definition_id: PARTY, name: 'Spring offer', status, current_version: 1 }], rowCount: 1 }
    : undefined;
const COMBO_ROW = (sql) =>
  /FROM combo_templates WHERE id=\$1/.test(sql) ? { rows: [{ name: 'Combo', definition: [], price: null, product_item_id: null }], rowCount: 1 } : undefined;
const GOOD_COMBO = { name: 'Combo', definition: [{ name: 'Size', options: [{ name: 'Large', price: 10 }] }] };
const LINES = { lines: [{ qty: 1, unitPrice: 5 }], offers: [{ kind: 'percent_off', percent: 10 }] };
const DB_FAILS = { db: 'fail' };
/** the extras: an answer the generic worlds cannot reach (a named refusal inside a handler, a fault behind a body the handler accepts) */
const EXTRAS = [
  X('db-fails-with-party', 'POST /api/crm/followups', 500, { setup: DB_FAILS, body: { party_id: PARTY, what: 'Ring' } }),
  X('followup-not-there', 'DELETE /api/crm/followups/:id', 404, { setup: { sqlRows: MIGRATED } }),
  X('followup-not-there', 'PATCH /api/crm/followups/:id', 404, { setup: { sqlRows: MIGRATED }, body: { done: true } }),
  X('db-fails-with-group', 'POST /api/crm/groups', 500, { setup: DB_FAILS, body: { name: 'vip', add: [PARTY] } }),
  X('db-fails-with-lead', 'POST /api/crm/leads', 500, { setup: DB_FAILS, body: { name: 'Asha Rao' }, patch: [NEED_OK] }),
  X('db-fails-with-rows', 'POST /api/crm/leads/import', 500, { setup: DB_FAILS, body: { rows: [{ name: 'Asha Rao' }] }, patch: [NEED_OK] }),
  X('party-not-yours', 'POST /api/crm/parties/:id/interactions', 404, { setup: { sqlRows: MIGRATED }, body: { kind: 'note', body: 'x' } }),
  X('party-not-yours', 'POST /api/crm/parties/:id/outcome', 404, { setup: { sqlRows: MIGRATED }, body: { outcome: 'interested' } }),
  X('db-fails-with-outcome', 'POST /api/crm/parties/:id/outcome', 500, { setup: DB_FAILS, body: { outcome: 'interested' } }),
  X('lead-not-yours', 'POST /api/crm/parties/:id/stage', 404, { body: { stage: 'lead' }, patch: [NEED_OK] }),
  X('db-fails-with-stage', 'POST /api/crm/parties/:id/stage', 500, { setup: DB_FAILS, body: { stage: 'lead' }, patch: [NEED_OK] }),
  X('library-says-not-found', 'POST /api/crm/privacy-requests/:id/answer', 404, {
    body: { outcome: 'done', answer: 'Done.' },
    patch: [['lib/privacy.js', 'answerRequest', refusal(404, 'NOT_FOUND', 'No such request.')]]
  }),
  X('library-says-not-found', 'POST /api/crm/segments/:key/send', 404, {
    url: '/api/crm/segments/high_value/send',
    body: { text: 'Hello' },
    patch: [['lib/crm-groups.js', 'send', refusal(404, 'NOT_FOUND', 'No group by that name.')]]
  }),
  X('db-fails-with-text', 'POST /api/crm/segments/:key/send', 500, { setup: DB_FAILS, url: '/api/crm/segments/high_value/send', body: { text: 'Hello' } }),
  X('db-fails-with-phone', 'POST /api/crm/walk-ins/add', 500, { setup: DB_FAILS, body: { phone: '9876543210' } }),
  X('network-read-breaks', 'GET /api/network-offers', 500, { patch: [['lib/network-offers.js', 'brandView', throwsLater]] }),
  X('policy-write-breaks', 'PUT /api/network-offers/policy', 500, { body: { policy: 'opt_in' }, patch: [['lib/network-offers.js', 'mergeFlag', throwsLater]] }),
  X('price-answer-breaks', 'POST /api/network-offers/catalogue/price', 500, {
    body: { source_key: 's', name: 'n', choice: 'use' },
    patch: [['lib/network-catalogue.js', 'answer', throwsLater]]
  }),
  X('offer-not-live', 'POST /api/network-offers/:id/release', 409, { setup: { sqlRows: OFFER_ROW('draft') } }),
  X('ends-before-start', 'POST /api/network-offers/:id/release', 400, {
    setup: { sqlRows: OFFER_ROW('live') },
    body: { at: 'now', until: '2000-01-01T00:00:00Z' }
  }),
  X('release-breaks', 'POST /api/network-offers/:id/release', 500, {
    setup: { sqlRows: OFFER_ROW('live') },
    patch: [['lib/network-offers.js', 'flagsOf', throwsLater]]
  }),
  X('never-released', 'POST /api/network-offers/:id/withdraw', 409, {
    setup: { sqlRows: OFFER_ROW('live') },
    patch: [['lib/network-offers.js', 'flagsOf', async () => ({ flags: {} })]]
  }),
  X('withdraw-breaks', 'POST /api/network-offers/:id/withdraw', 500, {
    setup: { sqlRows: OFFER_ROW('live') },
    patch: [['lib/network-offers.js', 'flagsOf', throwsLater]]
  }),
  X('engine-breaks', 'POST /api/offers/evaluate', 500, { body: LINES, patch: [['lib/offers-engine.js', 'CBOffers.evaluate', THROWS]] }),
  X('engine-breaks', 'POST /api/offers/explain', 500, { body: LINES, patch: [['lib/offers-engine.js', 'CBOffers.evaluate', THROWS]] }),
  X('engine-breaks', 'GET /api/offers/kinds', 500, { patch: [['lib/offers-engine.js', 'CBOffers.kinds', { get: THROWS }]] }),
  X('document-breaks', 'GET /api/offers/openapi.json', 500, { patch: [['routes/openapi.js', 'assemble', THROWS]] }),
  X('db-fails-with-combo', 'POST /api/combo-templates', 500, { setup: DB_FAILS, body: GOOD_COMBO }),
  X('saved-combo-has-no-groups', 'POST /api/combo-templates/:id/push', 400, { setup: { sqlRows: COMBO_ROW } })
];

/** a scenario that needs a library function to fail or answer otherwise swaps it, then puts the real one back: [file, 'name' | 'Object.name', function | { get }] */
function applyPatch(patch) {
  const undo = [];
  (patch || []).forEach(([file, dotted, replacement]) => {
    const parts = dotted.split('.');
    const owner = parts.slice(0, -1).reduce((one, part) => one[part], require(path.join(HERE, file)));
    const name = parts[parts.length - 1];
    const original = Object.getOwnPropertyDescriptor(owner, name);
    Object.defineProperty(
      owner,
      name,
      typeof replacement === 'function' ? { value: replacement, writable: true, configurable: true } : Object.assign({ configurable: true }, replacement)
    );
    undo.push(() => Object.defineProperty(owner, name, original));
  });
  return () => undo.reverse().forEach((back) => back());
}

async function runScenario(port, scenario) {
  Object.assign(world, FRESH, scenario.setup);
  require(
    path.join(HERE, 'lib', 'crm-followups.js')
  ).forget(); /* the follow-up tables are checked once and remembered: every scenario starts from "not asked yet" */
  const restore = applyPatch(scenario.patch);
  const method = scenario.route.split(' ')[0];
  const answer = await kit.send(port, method, scenario.url, scenario.body === undefined && kit.BODY_METHODS.includes(method) ? {} : scenario.body);
  restore();
  return answer;
}

/** the sign-in middleware's own 401 and requireScope's 403 are still the old body: tested, not yet a Problem (a follow-up for the auth middleware) */
const inherited = (scenario, answer) =>
  (answer.status === 401 && scenario.id === 'signed-out') ||
  (answer.status === 403 &&
    scenario.id === 'key-asks' &&
    scenario.route.includes(' /api/offers/')); /* requireScope's 403: a follow-up for the auth middleware */

/** the statuses a test may see from a route, by the contract of the area that owns it */
function allowedFor() {
  const found = {};
  AREAS.forEach((area) => {
    const contract = require(path.join(HERE, area.contract))[area.export];
    Object.assign(found, Object.fromEntries(Object.keys(contract.OPERATIONS).map((key) => [key, contract.allowedStatuses()(key)])));
  });
  return (route) => found[route] || [];
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
    if (scenario.extra) check(label + ': answers the status the scenario is for (' + scenario.expect + ')', answer.status === scenario.expect, answer.status);
    if (answer.status < 400) continue;
    check(
      label + ': ' + answer.status + ' is a status the contract declares for this route',
      allowed(scenario.route).includes(answer.status),
      allowed(scenario.route)
    );
    if (inherited(scenario, answer)) continue;
    kit.checkProblemBody(check, label, answer);
    if (answer.status >= 500) check(label + ': a 5xx says nothing of its cause', !/party_secret|SELECT|vault|relation/.test(answer.text), answer.text);
    else kit.checkLegacy(check, label, answer, kit.frozenOf(LEGACY_FILE, scenario.route, scenario.id));
  }
  return tested;
}

/** lib/contract-kit.js schemaStatus: a route that keeps its old 400 for a malformed body declares 400, not the standard 422 */
function checkKitStatus() {
  const { contractOf } = require(path.join(HERE, 'lib', 'contract-kit.js'));
  const contract = contractOf({ mount: '/api/x', routes: { 'POST /thing': { summary: 'Make a thing', body: ['name'], schemaStatus: 400 } }, gateStatus: {} });
  const statuses = Object.keys(contract.OPERATIONS['POST /api/x/thing'].responses)
    .map(Number)
    .filter((status) => status >= 400);
  check('kit: a route that keeps its 400 for a malformed body declares 400 and no 422', statuses.includes(400) && !statuses.includes(422), statuses);
}

process.on('unhandledRejection', (failure) => console.log('  (unhandled rejection: ' + String(failure && failure.message).slice(0, 80) + ')'));
(async () => {
  if (flagValue('--freeze')) {
    console.log('froze ' + kit.freeze(flagValue('--freeze'), LEGACY_FILE, MINE) + ' routes');
    return;
  }
  installStubs();
  const mounted = AREAS.map((area) => ({ mount: area.mount, router: require(path.join(HERE, area.file)) }));
  const routes = Object.assign({}, ...mounted.map((one) => kit.routesOf(one.router, one.mount)));
  const app = express();
  app.use((req, res, next) => {
    req.id = 'req-test';
    next();
  });
  app.use(express.json());
  mounted.forEach((one) => app.use(one.mount, one.router));
  const server = app.listen(0);
  const recording = {};
  const tested = await checkRoutes(server.address().port, kit.scenariosOf(routes, WORLDS, EXTRAS, PARAM_VALUES), recording);
  server.close();
  if (flagValue('--capture')) {
    fs.writeFileSync(flagValue('--capture'), JSON.stringify(recording, null, 1));
    console.log('captured ' + Object.keys(recording).length + ' answers over ' + Object.keys(routes).length + ' routes');
    process.exit(0);
  }
  checkKitStatus();
  const coverage = Object.fromEntries(
    Object.keys(tested)
      .sort()
      .map((route) => [route, [...tested[route]].sort((a, b) => a - b)])
  );
  const onDisk = JSON.parse(fs.readFileSync(TESTED_FILE, 'utf8'));
  if (argv.includes('--write')) {
    const others = Object.fromEntries(
      Object.keys(onDisk)
        .filter((route) => !MINE(route))
        .map((route) => [route, onDisk[route]])
    );
    const merged = Object.assign(others, coverage);
    fs.writeFileSync(
      TESTED_FILE,
      JSON.stringify(
        Object.fromEntries(
          Object.keys(merged)
            .sort()
            .map((route) => [route, merged[route]])
        ),
        null,
        1
      ) + '\n'
    );
  } else {
    const mine = Object.fromEntries(
      Object.keys(onDisk)
        .filter(MINE)
        .sort()
        .map((route) => [route, onDisk[route]])
    );
    check('docs/contracts/api-error-tests.json lists exactly the statuses these scenarios cover for these five routers', kit.sameValue(mine, coverage), {
      onDisk: Object.keys(mine).length,
      covered: Object.keys(coverage).length
    });
  }
  console.log('\n  ' + tally.passed + ' checks, ' + tally.failed + ' failed');
  process.exit(tally.failed ? 1 : 0);
})();
