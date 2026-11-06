#!/usr/bin/env node
// @type: contract
/**
 * api-auth-first.test.cjs — API-37 (decided 2026-11-06): AUTH FIRST, 401 BEFORE 404, on every route that needs a sign-in.
 *
 * OWNS      the whole-app proof of API-STANDARD S6 "auth first": every route that has a credential middleware in front of it, called
 *           SIGNED OUT with a random uuid in every :param and a junk body, answers 401 — never 404, 400, 422 or 500. A signed-out caller
 *           learns nothing about which ids exist (OWASP API Security 2023 API1 and API2; RFC 9110 sec 15.5.2).
 * CALLED BY scripts/guards.cjs · CI. No database, no network: the real server.js over tools/load-app.cjs (the walk the public-door test also uses).
 * FLOW      leavesOf(app) → keep the routes with a credential middleware → request with uuids in the path and junk in the body → status 401
 * Run: node tests/api-auth-first.test.cjs · MIN whole-app · refusal-path (a signed-out caller is stopped at the door before any id is judged)
 * ⚠️ Public storefront routes keyed by shop are NOT credential routes here (no middleware in front): SEC-97 decides those per route.
 * CARD      28-platform-and-operations/api-standard
 */
'use strict';
const path = require('path');
const http = require('http');
const API = path.join(__dirname, '..');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-secret-for-auth-first';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
process.env.LOG_LEVEL = 'critical'; /* one line per request would bury the result */

const { stubDatabase, loadApp, leavesOf } = require(path.join(API, 'tools', 'load-app.cjs'));
stubDatabase(API);
const app = loadApp(API);

/* the same notion of "a credential middleware" as tests/limiter-paths.test.cjs */
const GUARD_NAME = /^(auth|customerAuth|requireScope|admin|requireAdmin|authenticate|verifyToken|requireAuth|authed|requireRole)$/;
const guardish = (fn) => fn.__guard || GUARD_NAME.test(fn.name || '');
const norm = (entry) => (typeof entry === 'function' ? { fn: entry, always: true } : entry);
const covers = (entry, routePath) => entry.always || entry.layer.match(routePath.slice(entry.prefix.length) || '/') === true;
const needsSignIn = (leaf) => leaf.chain.map(norm).some((entry) => guardish(entry.fn) && covers(entry, leaf.path));

/* the platform-key doors: admin() answers 503 while CB_ADMIN_KEY is unset and 403 for a wrong key. They take a key, not a sign-in, and the id is judged only after it. */
const KEY_DOORS = new Set(['POST /api/channels/:id/approve', 'POST /api/channels/:id/template-approve', 'POST /api/channels/:id/revoke']);

const UUID = '3f2b8c1e-5a47-4d0e-9b6c-7e1d2a4f8c90';
const FILL = (routePath) => routePath.replace(/:[A-Za-z_]+\??/g, UUID);
const JUNK = JSON.stringify({ junk: [null, { x: '"' }], id: UUID, name: 12345 });
const METHODS_WITH_BODY = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function call(port, method, urlPath) {
  return new Promise((resolve) => {
    const headers = { 'x-forwarded-for': '10.0.0.' + (1 + Math.floor(Math.random() * 250)) };
    const withBody = METHODS_WITH_BODY.has(method);
    if (withBody) Object.assign(headers, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(JUNK) });
    const request = http.request({ port, path: urlPath, method, headers }, (response) => {
      response.resume();
      response.on('end', () => resolve(response.statusCode));
    });
    request.on('error', () => resolve(0));
    if (withBody) request.write(JUNK);
    request.end();
  });
}

(async () => {
  const leaves = leavesOf(app).filter((leaf) => typeof leaf.path === 'string' && leaf.method !== 'OPTIONS' && needsSignIn(leaf));
  const keyed = leaves.filter((leaf) => KEY_DOORS.has(leaf.method + ' ' + leaf.path));
  const checkable = leaves.filter((leaf) => !keyed.includes(leaf));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const wrong = [];
  for (const leaf of checkable) {
    const status = await call(port, leaf.method, FILL(leaf.path));
    if (status !== 401) wrong.push(status + ' ' + leaf.method + ' ' + leaf.path);
  }
  server.close();
  console.log('  ' + leaves.length + ' routes need a sign-in; ' + wrong.length + ' did not answer 401 signed out');
  const sane = leaves.length > 300 && keyed.length === KEY_DOORS.size; /* a stale exemption would quietly permit whatever takes that path next */
  console.log('  ' + (sane ? 'ok  ' : 'FAIL') + '  the walk found the signed-in routes (a walk that finds nothing would pass everything)');
  console.log('  ' + (wrong.length ? 'FAIL' : 'ok  ') + '  every signed-in route answers 401 signed out, ids and body ignored');
  wrong.forEach((line) => console.log('        ' + line));
  process.exit(sane && !wrong.length ? 0 : 1);
})();
