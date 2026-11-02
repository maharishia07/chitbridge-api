/**
 * problem-world.cjs — the stand-in world the API-4 sweep tests of the catalogue run a real route file in.
 *
 * OWNS      the shared machinery of tests/api-problem-products.test.cjs and tests/api-problem-catalogue.test.cjs: a stand-in sign-in and database (the real route files
 *           run over them), every route a router holds x the worlds, the named extras, one request over http, the checks on a Problem body and on the frozen legacy keys,
 *           and the three recordings: --capture (the answers of the code BEFORE the change), --freeze (the refusals of a capture into docs/contracts/api-legacy.json) and
 *           --compare (the answers now, byte for byte against a capture).
 * CALLED BY tests/api-problem-products.test.cjs · tests/api-problem-catalogue.test.cjs · tests/api-problem-network.test.cjs. Not a test itself.
 * A scenario with `until: '<text>'` is a stream (SSE): the answer is what arrived up to that text, masked like any body, and the socket is closed then (the bell sweep, tests/lib/bell-scenes.cjs).
 * Options a sweep may add: `leak` (a RegExp for the text a 5xx must not carry: a route whose own code word is in the Problem type, e.g. VAULT_ENC_UNCONFIGURED → .../vault_enc_unconfigured, names the stand-in's SQL instead of the word), `cannotRide(route, scenario)` names the frozen keys the Problem owns (status ...) and so cannot carry, and a scenario with `after: true` is a refusal the sweep ADDS (nothing was frozen for it).
 * FLOW      harness({ here, mounts, routeFiles, ... }) → installStubs() → scenariosOf(routes) → runScenario() → record / check / compare
 * CARD      qa/offline-guards
 * No database, no network. A scenario that needs a row the stand-in cannot make says so in its own `setup.sqlRows`.
 */
'use strict';
const path = require('path');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
process.env.OUTPUT_ALLOWLIST = 'enforce'; /* S34: a sweep test runs the allow-list for real; production defaults to report */
const allowlist = require('../../lib/output-allowlist');

const SHOP = '11111111-1111-4111-8111-111111111111';
const PARTY = '22222222-2222-4222-8222-222222222222';
const OWNER = { identity_id: SHOP, identity_type: 'entity', display_name: 'Test shop' };
const STAFF = { identity_id: '44444444-4444-4444-8444-444444444444', parent_entity_id: SHOP, identity_type: 'actor', access_level: 'editor', display_name: 'Test staff' };
const CUSTOMER = { identity_id: '55555555-5555-4555-8555-555555555555', bridge_id: 'tea-shop', parent_entity_id: SHOP, display_name: 'Test customer' };
const SECRET_SQL = 'relation "catalogue_items" does not exist -- SELECT secret FROM vault';
const PROBLEM_FIELDS = ['type', 'title', 'status', 'code', 'detail', 'hint', 'request_id', 'field', 'params', 'errors'];
const REQUIRED_FIELDS = ['type', 'title', 'status', 'code', 'detail', 'hint', 'request_id'];
const BODY_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'];
const ANSWER_WAIT_MS = 4000;
const OWNED_BY_PROBLEM = ['type', 'title', 'status', 'detail', 'request_id', 'errors'];
const GENERIC_SENTENCE = /^Something went wrong( — please try again\.| on our side\.)$/; /* lib/respond SAFE_SENTENCE · lib/problem INTERNAL_DETAIL: the words of a fault, never of a refusal */
const FRESH = { realAuth: false, who: OWNER, asKey: false, db: 'ok', sqlRows: null, jsonThrows: false, noCustomer: false };

const sameValue = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const sha = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');
const safeParse = (text) => {
  try {
    return JSON.parse(text);
  } catch (failure) {
    return null;
  }
};
/** an error the way pg raises one: a message and a SQLSTATE code */
const sqlError = (code) => Object.assign(new Error('pg ' + code), { code });
/** a stand-in db that raises one SQLSTATE for statements matching a pattern */
const raising = (pattern, code) => (sql) => {
  if (pattern.test(sql)) throw sqlError(code);
  return null;
};
/** a stand-in db that answers one statement with given rows */
const answering = (pattern, rows) => (sql) => (pattern.test(sql) ? { rows, rowCount: rows.length } : null);
/** several stand-in answers, the first that has an answer wins */
const firstOf = (...answers) => (sql, params) => answers.map((answer) => answer(sql, params)).find((given) => given) || null;

/** the world a scenario sets up: the stand-in sign-in and database read it on every call */
function harness(options) {
  const { here, mounts, routeFiles } = options;
  const argv = process.argv.slice(2);
  const flagValue = (flag) => (argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : null);
  const world = Object.assign({}, FRESH);
  const count = { passed: 0, failed: 0 };
  const check = (label, condition, info) => {
    if (condition) count.passed++;
    else count.failed++;
    if (!condition || argv.includes('--verbose')) console.log('  ' + (condition ? 'ok  ' : 'FAIL') + '  ' + label + (condition || info === undefined ? '' : '\n        ' + JSON.stringify(info).slice(0, 500)));
  };
  const mine = options.owns || ((route) => mounts.some((mount) => route.includes(' ' + mount + '/') || route.endsWith(' ' + mount)));

  /** the rows a statement gets: a scenario's own rows first, then nothing (or the secret failure when the db is down) */
  function rowsFor(sql, params) {
    if (world.sqlRows) {
      const given = world.sqlRows(String(sql), params);
      if (given) return given;
    }
    if (world.db === 'fail') throw new Error(SECRET_SQL);
    return { rows: [], rowCount: 0 };
  }
  const mock = (relative, exported) => {
    const file = require.resolve(path.join(here, relative));
    require.cache[file] = { id: file, filename: file, loaded: true, exports: exported };
  };

  /** the stand-in sign-in (a business or its staff) and the stand-in database, put in the require cache before any route file loads */
  function installStubs() {
    /* the database stand-in goes in FIRST: a library a middleware loads (lib/schema binds `query` when it loads) must see the stand-in, not the real pool */
    const client = { query: async (sql, params) => rowsFor(sql, params) };
    const known = { query: async (sql, params) => rowsFor(sql, params), withEntity: async (id, run) => run(client), withTransaction: async (run) => run(client), onEntity: async (id, run) => run(client), trySavepoint: async (db, run, fallback) => run(client).catch(() => (fallback === undefined ? null : fallback)), readBatch: async (id, actor, statements) => statements.map((one) => rowsFor(one.text || one, one.params)) };
    const fallback = async () => ({ rows: [], rowCount: 0 });
    const db = new Proxy(known, { get: (target, name) => (name in target ? target[name] : typeof name === 'symbol' || name === 'then' ? undefined : fallback) });
    mock('db', db);
    mock('db/index', db);
    const realAuth = require(path.join(here, 'middleware', 'auth'));
    const stubAuth = (req, res, next) => {
      if (world.realAuth) return realAuth(req, res, next);
      req.identity = world.who;
      if (world.asKey) req.api_key = { jti: 'j1', scopes: ['till'] };
      return next();
    };
    mock('middleware/auth', Object.assign(stubAuth, realAuth, { entityOf: (req) => req.identity.parent_entity_id || req.identity.identity_id }));
    const realCustomer = require(path.join(here, 'middleware', 'customer-auth'));
    mock('middleware/customer-auth', (req, res, next) => (world.realAuth || world.noCustomer ? realCustomer(req, res, next) : ((req.customer = CUSTOMER), next())));
    if (!argv.includes('--debug')) console.error = console.warn = () => undefined; /* the routes log a 5xx here; the scenarios read the answer */
  }

  /** { 'METHOD /full/path': template } for every route a router holds, read from the router itself */
  function routesOf(router, mount) {
    const found = {};
    router.stack.filter((layer) => layer.route).forEach((layer) => Object.keys(layer.route.methods).forEach((method) => {
      const full = layer.route.path === '/' ? mount : mount + layer.route.path;
      found[method.toUpperCase() + ' ' + full] = full;
    }));
    return found;
  }
  const urlOf = (template, bad, values) => template.replace(/:(\w+)/g, (all, name) => (bad ? 'nope' : (values || {})[name] || PARTY));

  /** every scenario as { id, route, url, body, setup, extra }: each route x each generic world, then the named extras */
  function scenariosOf(routes, worlds, extras, values) {
    const generic = [];
    Object.keys(routes).sort().forEach((route) => {
      const method = route.split(' ')[0];
      worlds.forEach((one) => {
        if (one.badId && !routes[route].includes(':')) return;
        generic.push({ id: one.id, route, url: urlOf(routes[route], one.badId, values), body: BODY_METHODS.includes(method) ? {} : undefined, setup: one.setup });
      });
    });
    const named = extras.map((one) => Object.assign({}, one, { url: one.url || urlOf(routes[one.route] || '', false, values), extra: true }));
    return generic.concat(named.filter((one) => routes[one.route]));
  }

  /** one request over http: the answer's status, headers that matter, bytes, and the body as JSON when it is. `raw` = { headers, text }: the bytes as a provider signs and sends them (a webhook), not JSON; `extraHeaders` = headers added to a JSON request (a platform key); `until` = a stream (SSE) is read up to that text, then closed */
  function send(port, method, urlPath, body, raw, extraHeaders, until) {
    return new Promise((resolve) => {
      const data = raw ? raw.text : body === undefined ? null : JSON.stringify(body);
      const headers = raw ? Object.assign({ 'content-length': Buffer.byteLength(data) }, raw.headers) : Object.assign(data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {}, extraHeaders || {});
      const request = http.request({ port, path: urlPath, method, headers }, (response) => {
        const parts = [];
        const answer = () => {
          const read = Buffer.concat(parts);
          const text = until ? steady(read.toString('utf8')) : read.toString('utf8'); /* a stream's first frames carry a clock stamp: masked, as every body is */
          const bytes = until ? Buffer.from(text) : read;
          return { status: response.statusCode, type: String(response.headers['content-type'] || ''), disposition: String(response.headers['content-disposition'] || ''), cache: String(response.headers['cache-control'] || ''), bytes, text, json: safeParse(text) };
        };
        response.on('data', (part) => {
          parts.push(part);
          /* `until`: a stream never ends. The answer is what arrived up to the frame asked for, and the socket is closed so no test holds a stream open. */
          if (until && Buffer.concat(parts).toString('utf8').includes(until)) {
            resolve(answer());
            request.destroy();
          }
        });
        response.on('end', () => resolve(answer()));
      });
      request.setTimeout(ANSWER_WAIT_MS, () => {
        request.destroy();
        resolve({ status: 0, type: '', disposition: '', cache: '', bytes: Buffer.alloc(0), text: '', json: null });
      });
      request.on('error', () => {});
      if (data) request.write(data);
      request.end();
    });
  }

  /** a scenario that needs a row the stand-in db cannot make swaps one library function for its answer, then puts the real one back */
  function applyPatch(patch, modules) {
    const undo = [];
    Object.keys(patch || {}).forEach((which) => Object.keys(patch[which]).forEach((name) => {
      const owner = modules()[which];
      undo.push([owner, name, owner[name]]);
      owner[name] = patch[which][name];
    }));
    return () => undo.forEach(([owner, name, original]) => (owner[name] = original));
  }

  /** a scenario may switch process variables for its one request (`env`); the ones it set are put back (or removed) afterwards */
  function setEnv(given) {
    const before = Object.keys(given || {}).map((name) => [name, process.env[name]]);
    Object.keys(given || {}).forEach((name) => (given[name] === null ? delete process.env[name] : (process.env[name] = given[name]))); /* null = not set (process.env would store the text "null") */
    return () => before.forEach(([name, was]) => (was === undefined ? delete process.env[name] : (process.env[name] = was)));
  }

  async function runScenario(port, scenario, modules) {
    Object.assign(world, FRESH, scenario.setup);
    if (options.before) await options.before(scenario); /* a sweep whose world is a stand-in of its own (tests/support/crm-stub.cjs) sets it up here */
    const restore = applyPatch(scenario.patch, modules);
    const unset = setEnv(scenario.env);
    const method = scenario.route.split(' ')[0];
    const body = scenario.body === undefined && BODY_METHODS.includes(method) ? {} : scenario.body;
    const answer = await send(port, method, scenario.url, body, scenario.raw, scenario.headers, scenario.until);
    unset();
    restore();
    return answer;
  }

  const legacyOf = (key, scenario) => (JSON.parse(fs.readFileSync(options.legacyFile, 'utf8')).routes[key] || { answers: [] }).answers.find((answer) => answer.scenario === scenario);

  function checkProblemBody(label, answer, genericOk) {
    check(label + ': content-type is application/problem+json', /application\/problem\+json/.test(answer.type), answer.type);
    check(label + ': has every Problem field', answer.json && REQUIRED_FIELDS.every((name) => answer.json[name] !== undefined), answer.json);
    check(label + ': status in the body equals the HTTP status', answer.json && answer.json.status === answer.status);
    /* API-6 (25 Oct): a 4xx is a refusal the caller can act on, so its detail and message are the thrower's own sentence, never the generic words of a fault */
    if (answer.status < 500 && answer.json && !genericOk) check(label + ': a 4xx says its own sentence, never the generic fault words', !GENERIC_SENTENCE.test(String(answer.json.detail)) && !GENERIC_SENTENCE.test(String(answer.json.message)), [answer.json.detail, answer.json.message]);
  }

  function checkLegacy(label, answer, frozen, givenUp) {
    if (!frozen) return check(label + ': a frozen legacy entry exists in docs/contracts/api-legacy.json', false);
    check(label + ': status equals the frozen status', answer.status === frozen.status, [answer.status, frozen.status]);
    const missing = Object.keys(frozen.fixture).filter((name) => !(givenUp || []).includes(name) && !sameValue(answer.json[name], frozen.fixture[name]));
    check(label + ': every frozen legacy key is still there, byte for byte', missing.length === 0, missing.map((name) => name + ' -> ' + JSON.stringify(answer.json[name])));
    const extra = Object.keys(answer.json).filter((name) => !PROBLEM_FIELDS.includes(name) && !(name in frozen.fixture));
    check(label + ': no key beyond the frozen ones and the Problem fields', extra.length === 0, extra);
  }

  /** a body's random ids and clock stamps are the same answer on every run: they are masked before a body is kept or compared */
  const steady = (text) => text.replace(/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/g, 'UUID').replace(/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z/g, 'STAMP').replace(/(?:localhost|127\.0\.0\.1):\d+/g, 'HOST');
  /** what a capture keeps of an answer: enough to compare byte for byte later */
  const recordOf = (route, answer) => {
    const kept = answer.json ? steady(answer.text) : null;
    return {
      route,
      status: answer.status,
      type: answer.type,
      disposition: answer.disposition,
      cache: answer.cache,
      body: answer.json,
      bytes: answer.bytes.length,
      sha: kept ? sha(Buffer.from(kept)) : sha(answer.bytes),
      text: answer.json ? undefined : answer.text.slice(0, 300)
    };
  };

  /** the checks of one answer that is a refusal (4xx/5xx) */
  function judgeRefusal(label, scenario, answer, allowed) {
    check(label + ': ' + answer.status + ' is a status the contract declares for this route', allowed(scenario.route).includes(answer.status), allowed(scenario.route));
    if (options.inherited(scenario, answer)) return;
    checkProblemBody(label, answer, scenario.genericOk); /* a scene whose thrower set no sentence says so */
    if (answer.status >= 500) check(label + ': a 5xx says nothing of its cause', !(options.leak || /SELECT|vault|relation "/).test(answer.text), answer.text);
    else if (!scenario.after && !(options.added && options.added(scenario.route, scenario.id))) checkLegacy(label, answer, legacyOf(scenario.route, scenario.id), options.cannotRide ? options.cannotRide(scenario.route, scenario.id) : []); /* `after`: a refusal the sweep adds, so nothing was frozen */
  }

  /** run every scenario; record each answer; in a check run judge it. → the statuses each route was seen to refuse with */
  async function checkRoutes(port, scenarios, recording, allowed, modules) {
    const tested = {};
    const capturing = argv.includes('--capture') || argv.includes('--compare');
    const only = flagValue('--only');
    for (const scenario of scenarios) {
      if (only && !(scenario.route + ' · ' + scenario.id).includes(only)) continue;
      const answer = await runScenario(port, scenario, modules);
      const label = scenario.route + ' · ' + scenario.id;
      recording[scenario.route + '|' + scenario.id] = Object.assign(recordOf(scenario.route, answer), { request: { url: scenario.url, body: scenario.body } }); /* the request is kept so tools/api-allowlist.cjs can hand the generated output_allowlist case a request known to reach the success answer */
      if (answer.status >= 400) (tested[scenario.route] = tested[scenario.route] || new Set()).add(answer.status);
      if (capturing) {
        if (scenario.expect !== undefined && scenario.expect !== answer.status) console.log('  NOTE ' + label + ': built to reach ' + scenario.expect + ' and answered ' + answer.status + ' ' + answer.text.slice(0, 120));
        continue;
      }
      check(label + ': answers (not a hang)', answer.status !== 0);
      if (scenario.expect !== undefined) check(label + ': answers the status it is built to reach (' + scenario.expect + ')', answer.status === scenario.expect, [answer.status, answer.text.slice(0, 200)]);
      if (answer.status >= 400) judgeRefusal(label, scenario, answer, allowed);
    }
    /* S34: the output allow-list is the identity on every answer a scenario saw; a dropped key is a key a caller may read */
    if (!capturing && !only) check('the output allow-list dropped no key from any answer', allowlist.droppedKeys().length === 0, allowlist.droppedKeys());
    return tested;
  }

  /** a capture becomes frozen answers: { route: { answers: [{ scenario, status, body_keys, fixture }] } } (4xx and 5xx with a JSON body only) */
  function freeze(captureFile) {
    const recording = JSON.parse(fs.readFileSync(captureFile, 'utf8'));
    const file = JSON.parse(fs.readFileSync(options.legacyFile, 'utf8'));
    Object.keys(recording).forEach((key) => {
      const one = recording[key];
      const scenario = key.split('|')[1];
      const kept = one.body || (one.text === '' ? {} : null); /* an answer with no body at all keeps no key: its entry is empty */
      if (one.status < 400 || !kept || options.notFrozen(one, scenario)) return;
      const entry = (file.routes[one.route] = file.routes[one.route] || { answers: [] });
      if (!entry.answers.some((answer) => answer.scenario === scenario)) entry.answers.push({ scenario, status: one.status, body_keys: kept, fixture: kept });
    });
    /* the routes already frozen keep their places in the file; this file's own are added after them, sorted */
    const theirs = Object.keys(file.routes).filter((route) => !mine(route));
    file.routes = Object.fromEntries(theirs.concat(Object.keys(file.routes).filter(mine).sort()).map((route) => [route, file.routes[route]]));
    fs.writeFileSync(options.legacyFile, JSON.stringify(file, null, 1) + '\n');
    console.log('froze ' + Object.keys(file.routes).filter(mine).length + ' routes');
  }

  /** the old keys of a refusal body, in the order they were sent, are the first keys of the new body with the same values */
  function oldKeysKept(before, after) {
    const old = Object.keys(before || {}).filter((name) => !OWNED_BY_PROBLEM.includes(name));
    const now = Object.keys(after || {}).filter((name) => !OWNED_BY_PROBLEM.includes(name) && !(name === 'code' && !(before && 'code' in before)));
    const sameOrder = old.every((name, index) => now[index] === name);
    return sameOrder && old.every((name) => sameValue(before[name], after[name])) && (!before || !('errors' in before) || sameValue(before.errors, after.errors)); /* `errors` is the Problem's key too: a list kept as it was is kept */
  }

  /** one scenario judged against the capture of the code before the change → { kind, reason } where kind is 'identical' | 'kept' | 'different' */
  function compareOne(before, now) {
    if (before.status !== now.status) return { kind: 'different', reason: 'status ' + before.status + ' -> ' + now.status };
    const sameBytes = before.sha === now.sha && before.type === now.type && before.disposition === now.disposition && before.cache === now.cache;
    if (sameBytes) return { kind: 'identical', reason: '' };
    if (before.status >= 400 && before.body && now.body && /problem\+json/.test(now.type) && oldKeysKept(before.body, now.body)) return { kind: 'kept', reason: 'a Problem body that carries every old key in order' };
    if (before.status >= 400 && !before.body && /problem\+json/.test(now.type)) return { kind: 'problem-for-empty', reason: 'an empty or HTML answer is now the Problem body' };
    return { kind: 'different', reason: 'the bytes differ' };
  }

  /** --compare F: the answers now against a capture: every difference printed with its reason */
  function compare(captureFile, recording) {
    const before = JSON.parse(fs.readFileSync(captureFile, 'utf8'));
    const tally = {};
    const differences = [];
    Object.keys(before).forEach((key) => {
      const now = recording[key];
      const verdict = now ? compareOne(before[key], now) : { kind: 'different', reason: 'the scenario was not run' };
      tally[verdict.kind] = (tally[verdict.kind] || 0) + 1;
      if (verdict.kind !== 'identical' && (verdict.kind !== 'kept' || argv.includes('--verbose'))) differences.push(key + ' [' + before[key].status + ' -> ' + (now && now.status) + '] ' + verdict.kind + ': ' + verdict.reason);
    });
    const total = Object.keys(before).length;
    console.log('compared ' + total + ' answers: ' + JSON.stringify(tally));
    differences.forEach((line) => console.log('  ' + line));
    return { total, tally, differences };
  }

  /** the log of this run's own statuses, as the register's error_tests column reads them */
  function coverageOf(tested) {
    return Object.fromEntries(Object.keys(tested).sort().map((route) => [route, [...tested[route]].sort((a, b) => a - b)]));
  }

  /** the mounted app: json bodies, a request id, and the answer that cannot be written when a scenario asks (jsonThrows) */
  function appOf(mountedRouters) {
    const app = express();
    app.use((req, res, next) => {
      req.id = 'req-test';
      if (world.jsonThrows) {
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
    app.use(express.json({ limit: '12mb' }));
    mountedRouters.forEach((one) => app.use(one.mount, one.router));
    return app;
  }

  return { world, count, check, mine, legacyFile: options.legacyFile, flagValue, argv, installStubs, routesOf, urlOf, scenariosOf, send, checkRoutes, freeze, compare, coverageOf, appOf, rowsFor, routeFiles };
}

module.exports = { harness, SHOP, PARTY, OWNER, STAFF, CUSTOMER, SECRET_SQL, sameValue, raising, answering, firstOf, sqlError, here: __dirname };
