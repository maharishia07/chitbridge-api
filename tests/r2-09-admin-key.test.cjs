#!/usr/bin/env node
/**
 * tests/r2-09-admin-key.test.cjs — R2-09: the platform key of the three channel doors (approve, template-approve, revoke).
 * A key under 32 characters never arms the door (503, as when it is unset); a right key passes, a wrong one of ANY length gets one 403;
 * and each door is under the sign-in budget (30 per 15 min, header ratelimit-limit), not only the blanket 500.
 * Run: node tests/r2-09-admin-key.test.cjs · no network, no DB.
 */
'use strict';
const path = require('path');
const http = require('http');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-secret-for-r2-09';
process.env.NODE_ENV = 'test';
const API = path.join(__dirname, '..');
const { stubDatabase, loadApp } = require(path.join(API, 'tools', 'load-app.cjs'));
stubDatabase();
const app = loadApp();

let checks = 0;
let failed = 0;
const check = (ok, label) => { checks++; if (!ok) failed++; console.log((ok ? 'ok   ' : 'FAIL ') + label); };
const ID = '33333333-3333-4333-8333-333333333333';
const DOORS = ['approve', 'template-approve', 'revoke'];
const ask = (server, door, key) => new Promise((resolve) => {
  const headers = { 'content-type': 'application/json', 'content-length': 2 };
  if (key !== undefined) headers['x-cb-admin-key'] = key;
  const req = http.request({ port: server.address().port, method: 'POST', path: '/api/channels/' + ID + '/' + door, headers }, (res) => {
    res.resume();
    res.on('end', () => resolve({ status: res.statusCode, limit: res.headers['ratelimit-limit'] }));
  });
  req.end('{}');
});

(async () => {
  const server = http.createServer(app).listen(0, '127.0.0.1');
  await new Promise((r) => server.on('listening', r));
  const LONG = 'k'.repeat(40);
  for (const door of DOORS) {
    process.env.CB_ADMIN_KEY = 'short-platform-key';
    check((await ask(server, door, 'short-platform-key')).status === 503, door + ': a key under 32 characters does not arm the door, even when it is sent back');
    process.env.CB_ADMIN_KEY = 'x'.repeat(31);
    check((await ask(server, door, 'x'.repeat(31))).status === 503, door + ': 31 characters is still too short');
    process.env.CB_ADMIN_KEY = LONG;
    const wrong = await ask(server, door, 'z');
    check(wrong.status === 403, door + ': a wrong key of another length is the same 403');
    check((await ask(server, door, 'k'.repeat(39))).status === 403, door + ': a key one short is the same 403');
    check((await ask(server, door, undefined)).status === 403, door + ': no key is a 403');
    const right = await ask(server, door, LONG);
    check(right.status !== 403 && right.status !== 503, door + ': the right key passes the gate (answer ' + right.status + ')');
    check(String(wrong.limit) === '30', door + ': the sign-in budget (30) is on the door, header says ' + wrong.limit);
    process.env.CB_ADMIN_KEY = 'x'.repeat(32);
    check((await ask(server, door, 'x'.repeat(32))).status !== 503, door + ': 32 characters arms it');
  }
  /* past the budget: the 31st wrong key in one window is a 429 from the limiter, not a 403 */
  process.env.CB_ADMIN_KEY = LONG;
  let last = 0;
  for (let i = 0; i < 32; i++) last = (await ask(server, 'revoke', 'wrong')).status;
  check(last === 429, 'revoke: past the 30-per-window budget the door answers 429 (last answer ' + last + ')');
  server.close();
  console.log(checks + ' checks' + (failed ? ', ' + failed + ' did not hold' : ''));
  process.exit(failed ? 1 : 0);
})();
