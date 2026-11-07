#!/usr/bin/env node
// @type: contract
/**
 * api-problem-plumbing.test.cjs — API-4 contract pass, the three plumbing doors: GET /health, OPTIONS * and GET /api/openapi.json, asked over the REAL server.js.
 *
 * OWNS      the proof that each door still answers what its caller expects (the uptime probe: 200 and status "OK", whatever the database says; a browser: the 204 and the Access-Control headers,
 *           and the app's 403 for a refused origin; a tool: the OpenAPI JSON with its six service paths), that a fault of ours is a Problem 500 that says nothing of its cause, and this file's
 *           three rows of docs/contracts/api-error-tests.json (500, which the register's error_tests column reads). All three stay PUBLIC: no sign-in is asked.
 *           Also lib/plumbing-contract.js as a unit: one rule per door (public, no input, 500 the only own refusal), the refusal-path of a preflight (403 documented, not written) and every fault fail-closed (no cause in the body).
 * CALLED BY scripts/guards.cjs · CI. No database, no network beyond 127.0.0.1: the real server.js with a stand-in db (tools/load-app.cjs).
 * FLOW      /health 200 (db down still 200) · a forced fault (500) · OPTIONS with an allowed origin (204 + headers) and a refused one (403 ORIGIN_NOT_ALLOWED) · the router alone with a throwing allow-list (500) ·
 *           /api/openapi.json 200 and a forced fault (500) → the Problem fields · no cause → manifest
 * CARD      28-platform-and-operations/api-standard
 *
 *   node tests/api-problem-plumbing.test.cjs            check
 *   node tests/api-problem-plumbing.test.cjs --write    rewrite this file's three rows of docs/contracts/api-error-tests.json
 */
'use strict';
const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');
const { stubDatabase, loadApp } = require('../tools/load-app.cjs');

const HERE = path.join(__dirname, '..');
process.env.DATABASE_URL = '';
const TESTED_FILE = path.join(HERE, 'docs', 'contracts', 'api-error-tests.json');
const HEALTH = 'GET /health';
const PREFLIGHT = 'OPTIONS *';
const OPENAPI = 'GET /api/openapi.json';
const REQUIRED_FIELDS = ['type', 'title', 'status', 'code', 'detail', 'hint', 'request_id'];
const argv = process.argv.slice(2);
const count = { passed: 0, failed: 0 };
const sameValue = (left, right) => JSON.stringify(left) === JSON.stringify(right);
function check(label, condition, info) {
  if (condition) count.passed++;
  else count.failed++;
  if (!condition || argv.includes('--verbose')) console.log('  ' + (condition ? 'ok  ' : 'FAIL') + '  ' + label + (condition || info === undefined ? '' : '\n        ' + JSON.stringify(info).slice(0, 400)));
}

/** one request over http: { status, headers, text, json } */
function ask(port, method, url, headers) {
  return new Promise((resolve) => {
    const request = http.request({ port, host: '127.0.0.1', method, path: url, headers: headers || {} }, (response) => {
      let body = '';
      response.on('data', (part) => (body += part));
      response.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(body);
        } catch (failure) {
          json = null;
        }
        resolve({ status: response.statusCode, headers: response.headers, text: body, json });
      });
    });
    request.setTimeout(5000, () => {
      request.destroy();
      resolve({ status: 0, headers: {}, text: '', json: null });
    });
    request.on('error', () => {});
    request.end();
  });
}

/** a refusal is a Problem: the content type, every field, the status in the body, and none of the cause */
function checkProblem(label, answer, status, code, causes) {
  check(label + ': answers ' + status, answer.status === status, [answer.status, answer.text.slice(0, 120)]);
  check(label + ': content-type is application/problem+json', /application\/problem\+json/.test(String(answer.headers['content-type'])), answer.headers['content-type']);
  check(label + ': has every Problem field and the status of the answer', !!answer.json && REQUIRED_FIELDS.every((name) => answer.json[name] !== undefined) && answer.json.status === status, answer.json);
  check(label + ': the code is ' + code, !!answer.json && answer.json.code === code, answer.json && answer.json.code);
  check(label + ': says nothing of its cause', !(causes || []).some((word) => answer.text.includes(word)) && !/stack|at Object|node_modules/.test(answer.text), answer.text.slice(0, 200));
}

(async () => {
  stubDatabase();
  const app = loadApp();
  const plumbing = require('../lib/plumbing-contract');
  check('unit: each of the three contracts holds exactly one public operation with no input', [plumbing.HEALTH, plumbing.PREFLIGHT, plumbing.OPENAPI].every((one) => Object.keys(one.OPERATIONS).length === 1 && Object.values(one.OPERATIONS)[0].security.length === 0 && !Object.values(one.OPERATIONS)[0].requestBody && !Object.values(one.OPERATIONS)[0].parameters));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const seen = { [HEALTH]: new Set(), [PREFLIGHT]: new Set(), [OPENAPI]: new Set() };
  const note = (route, answer) => answer.status >= 400 && seen[route].add(answer.status);
  const operations = require('../tools/api-register.cjs').operationsOfApp();
  const quiet = ['log', 'info', 'warn', 'error'].map((name) => [name, console[name]]);

  /* ── /health: what the uptime probe reads ── */
  const up = await ask(port, 'GET', '/health');
  const KEYS = ['status', 'platform', 'version', 'db', 'db_ms', 'timestamp', 'environment', 'commit', 'region', 'web', 'audit_lost', 'money_mismatch', 'books_unposted', 'books_unposted_oldest_s', 'books_reconcile_age_s', 'books_hook_failed', 'books_switch_unread', 'books_outbox_lost', 'output_dropped', 'legacy_tokens'];
  check('/health answers 200 with no sign-in', up.status === 200, [up.status, up.text.slice(0, 120)]);
  check('/health: status is "OK" and the platform name is kept (the probe reads these)', !!up.json && up.json.status === 'OK' && up.json.platform === 'Chit and Bridge', up.json);
  check('/health: exactly the keys the operation lists, no more', !!up.json && sameValue(Object.keys(up.json).sort(), KEYS.slice().sort()), up.json && Object.keys(up.json));
  check('/health: it is JSON, not a Problem', /^application\/json/.test(String(up.headers['content-type'])) && !up.json.type, up.headers['content-type']);
  const declaredKeys = Object.keys(operations[HEALTH].responses['200'].content['application/json'].schema.properties).sort();
  check('/health: the operation declares those same keys', sameValue(declaredKeys, KEYS.slice().sort()), declaredKeys);
  check('/health: db is one of ok · slow · down (the stand-in database may be any)', ['ok', 'slow', 'down'].includes(up.json.db), up.json.db);

  const accessEvents = require('../lib/access-events');
  const realLost = accessEvents.lostCount;
  quiet.forEach(([name]) => (console[name] = () => {}));
  accessEvents.lostCount = () => {
    throw new Error('SELECT secret FROM vault -- disk full');
  };
  const faulty = await ask(port, 'GET', '/health');
  accessEvents.lostCount = realLost;
  quiet.forEach(([name, original]) => (console[name] = original));
  note(HEALTH, faulty);
  checkProblem('/health when the process counters cannot be read (a fault of ours)', faulty, 500, 'INTERNAL', ['vault', 'disk full', 'SELECT']);

  /* ── OPTIONS *: what a browser reads ── */
  const origin = 'http://localhost:5173';
  const preflight = await ask(port, 'OPTIONS', '/api/till/snapshot', { Origin: origin, 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'authorization,content-type' });
  check('a preflight from an allowed origin: 204', preflight.status === 204, [preflight.status, preflight.text.slice(0, 120)]);
  check('a preflight: the origin is echoed and credentials allowed', preflight.headers['access-control-allow-origin'] === origin && preflight.headers['access-control-allow-credentials'] === 'true', preflight.headers);
  check('a preflight: the methods and headers are listed', /GET/.test(preflight.headers['access-control-allow-methods'] || '') && /Authorization/i.test(preflight.headers['access-control-allow-headers'] || ''), preflight.headers);
  const refusedOrigin = await ask(port, 'OPTIONS', '/api/till/snapshot', { Origin: 'http://evil.example', 'Access-Control-Request-Method': 'GET' });
  checkProblem('a preflight from an origin not on the list', refusedOrigin, 403, 'ORIGIN_NOT_ALLOWED', []);
  check('the 403 is documented on the operation and is not one the route declares itself', !!operations[PREFLIGHT].responses['403'] && operations[PREFLIGHT]['x-documented-statuses'].includes(403));

  /* the router alone, with an allow-list that throws: the route hands a fault to the error handler, never answers it itself */
  const lone = express();
  const router = require('../routes/preflight');
  const keepOptions = router.withOptions;
  router.withOptions({
    origin() {
      throw new Error('SELECT secret FROM vault -- allow-list file unreadable');
    }
  });
  lone.use(router);
  lone.use((err, req, res, next) => require('../lib/problem').fromError(req, res, err));
  const loneServer = http.createServer(lone);
  await new Promise((resolve) => loneServer.listen(0, '127.0.0.1', resolve));
  quiet.forEach(([name]) => (console[name] = () => {}));
  const brokenList = await ask(loneServer.address().port, 'OPTIONS', '/anything', { Origin: origin, 'Access-Control-Request-Method': 'GET' });
  quiet.forEach(([name, original]) => (console[name] = original));
  loneServer.close();
  note(PREFLIGHT, brokenList);
  checkProblem('a preflight whose allow-list cannot be read (a fault of ours)', brokenList, 500, 'INTERNAL', ['vault', 'unreadable', 'SELECT']);
  check('withOptions hands the router back (one-line mount)', keepOptions({}) === router);

  /* ── /api/openapi.json: what a tool reads ── */
  const doc = await ask(port, 'GET', '/api/openapi.json');
  check('/api/openapi.json answers 200 with no sign-in', doc.status === 200, [doc.status, doc.text.slice(0, 120)]);
  check('/api/openapi.json: the six keys, the Problem schema and the service paths', !!doc.json && sameValue(Object.keys(doc.json).sort(), ['components', 'info', 'openapi', 'paths', 'servers', 'tags']) && !!doc.json.components.schemas.Problem && Object.keys(doc.json.paths).length > 5, doc.json && Object.keys(doc.json));
  check('/api/openapi.json: the document does not describe the plumbing doors (unchanged document)', !doc.json.paths['/health'] && !doc.json.paths['/openapi.json'], Object.keys(doc.json.paths).slice(0, 5));

  const offers = require('../routes/offers');
  const realFragment = Object.getOwnPropertyDescriptor(offers, 'openapi');
  Object.defineProperty(offers, 'openapi', {
    configurable: true,
    get() {
      throw new Error('SELECT secret FROM vault -- fragment unreadable');
    }
  });
  quiet.forEach(([name]) => (console[name] = () => {}));
  const broken = await ask(port, 'GET', '/api/openapi.json');
  quiet.forEach(([name, original]) => (console[name] = original));
  Object.defineProperty(offers, 'openapi', realFragment);
  note(OPENAPI, broken);
  checkProblem('/api/openapi.json when a fragment cannot be read (a fault of ours)', broken, 500, 'INTERNAL', ['vault', 'unreadable', 'SELECT']);
  const again = await ask(port, 'GET', '/api/openapi.json');
  check('/api/openapi.json answers again once the fault is gone', again.status === 200);
  server.close();

  const allowed = (route) => Object.keys(operations[route].responses).map(Number).filter((status) => status >= 400).concat((operations[route]['x-documented-statuses'] || []));
  Object.keys(seen).forEach((route) => check('every refusal seen on ' + route + ' is a status its operation declares', [...seen[route]].every((status) => allowed(route).includes(status)), [[...seen[route]], allowed(route)]));
  const sources = ['health', 'preflight', 'openapi'].map((name) => fs.readFileSync(path.join(HERE, 'routes', name + '.js'), 'utf8')).join('\n');
  check('the doors ask for no credential: no sign-in is read by any of the three route files', !/middleware\/auth/.test(sources));

  const coverage = Object.fromEntries(Object.keys(seen).map((route) => [route, [...seen[route]].sort((first, second) => first - second)]));
  const onDisk = JSON.parse(fs.readFileSync(TESTED_FILE, 'utf8'));
  if (argv.includes('--write')) {
    Object.assign(onDisk, coverage);
    fs.writeFileSync(TESTED_FILE, JSON.stringify(Object.fromEntries(Object.keys(onDisk).sort().map((route) => [route, onDisk[route]])), null, 1) + '\n');
  } else Object.keys(coverage).forEach((route) => check('docs/contracts/api-error-tests.json lists exactly the statuses this scenario covers for ' + route, sameValue(onDisk[route], coverage[route]), { onDisk: onDisk[route], covered: coverage[route] }));
  console.log('\n  ' + count.passed + ' checks, ' + count.failed + ' failed');
  process.exit(count.failed ? 1 : 0);
})().catch((failure) => {
  console.log('  FAIL  the test itself failed: ' + (failure && failure.stack ? failure.stack.split('\n').slice(0, 3).join(' | ') : failure));
  process.exit(1);
});
