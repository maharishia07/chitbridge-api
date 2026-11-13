#!/usr/bin/env node
/**
 * cat-167-cors-allowlist.test.cjs — CAT-167 (proof 2026-11-14): the browser may call the API only from the ALLOWED_ORIGINS set.
 * @type regression
 * OWNS      the proof, driving the REAL server.js over HTTP with an Origin header: a listed origin gets Access-Control-Allow-Origin echoed;
 *           an unlisted one (any other port) is refused 403 ORIGIN_NOT_ALLOWED with no allow header; no Origin (curl, server-to-server) passes;
 *           the default set (ALLOWED_ORIGINS unset) is vercel.app + localhost:5173 + localhost:3000 and nothing else.
 * CALLED BY scripts/guards.cjs · CI. No database, no network beyond 127.0.0.1 (the db is a stand-in, listen() a no-op as in tests/api-csp.test.cjs).
 * FLOW      env ALLOWED_ORIGINS → load server.js → GET /health with each Origin → status + header
 *   node tests/cat-167-cors-allowlist.test.cjs [default]   (the second form runs the default-set half; the first runs the env half)
 */
'use strict';
const http = require('http');
const path = require('path');
const { API, ok, done, mock, standInDb, call } = require('./lib/cat-proof-kit.cjs');
const DEFAULT_RUN = process.argv[2] === 'default';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-secret-cat-167-0000000000';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
if (DEFAULT_RUN) delete process.env.ALLOWED_ORIGINS; else process.env.ALLOWED_ORIGINS = ' https://shop.example , http://localhost:4173 ';
mock('db', standInDb(() => ({ rows: [], rowCount: 0 })).db);
require('express').application.listen = function () { return { close() {} }; };
const realLog = console.log, realErr = console.error, realWarn = console.warn;
const quiet = () => { console.log = () => undefined; console.error = () => undefined; console.warn = () => undefined; };
const loud = () => { console.log = realLog; console.error = realErr; console.warn = realWarn; };
const { spawnSync } = require('child_process');

(async () => {
  quiet();
  const app = require(path.join(API, 'server.js'));
  const server = http.createServer(app).listen(0);
  const port = server.address().port;
  const get = (origin) => call(port, 'GET', '/health', undefined, origin ? { Origin: origin } : {});
  const listed = DEFAULT_RUN ? 'http://localhost:5173' : 'https://shop.example';
  const r1 = await get(listed), r2 = await get(DEFAULT_RUN ? 'http://localhost:4173' : 'http://localhost:9999'), r3 = await get(null);
  const r4 = DEFAULT_RUN ? await get('https://chitbridge-web.vercel.app') : await get('http://localhost:4173');
  const r5 = DEFAULT_RUN ? await get('http://localhost:3000') : await get('http://localhost:5173');
  loud();
  ok('a listed origin is answered with its own Access-Control-Allow-Origin', r1.headers['access-control-allow-origin'] === listed, JSON.stringify([r1.status, r1.headers['access-control-allow-origin']]));
  ok('an unlisted origin (another port) is refused 403 ORIGIN_NOT_ALLOWED, no allow header', r2.status === 403 && r2.body.code === 'ORIGIN_NOT_ALLOWED' && !r2.headers['access-control-allow-origin'], JSON.stringify([r2.status, r2.body.code]));
  ok('no Origin header (server-to-server, curl) is not refused', r3.status !== 403, r3.status);
  if (DEFAULT_RUN) {
    ok('default set: vercel.app is allowed', r4.headers['access-control-allow-origin'] === 'https://chitbridge-web.vercel.app', r4.status);
    ok('default set: localhost:3000 is allowed', r5.headers['access-control-allow-origin'] === 'http://localhost:3000', r5.status);
  } else {
    ok('ALLOWED_ORIGINS replaces the default: a default origin (localhost:5173) is now refused', r5.status === 403, r5.status);
    ok('a second listed origin (spaces trimmed) is allowed', r4.headers['access-control-allow-origin'] === 'http://localhost:4173', r4.status);
    const d = spawnSync(process.execPath, [__filename, 'default'], { env: process.env, encoding: 'utf8' });
    ok('the default-set half passes in its own process', d.status === 0, d.stdout + d.stderr);
  }
  server.close();
  done();
})();
