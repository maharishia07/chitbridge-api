#!/usr/bin/env node
// @type: contract
/**
 * rail-161-service-catches.test.cjs — RAIL-161: GET, resolve, pause and answer on /api/service/:chit_id answer a fault as problem+json, never the driver's words.
 *
 * OWNS      the proof that a database fault on these four routes answers 500 INTERNAL with none of the thrown text, that a known Postgres refusal answers the 4xx lib/knownerr maps,
 *           and that the success answers are unchanged.
 * CALLED BY scripts/guards.cjs · CI. No database, no network: the real routes/service.js over a stand-in sign-in and db.
 * FLOW      stub db + auth → real router on an express app → request over http → status · code · content type · no leak
 * CARD      03-disputes-service-and-register/service-request-sla-pause
 */
'use strict';
const path = require('path');
const http = require('http');
const express = require('express');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';

const ROOT = path.join(__dirname, '..');
const SHOP = '11111111-1111-4111-8111-111111111111';
const CHIT = '33333333-3333-4333-8333-333333333333';
const PAUSE = '44444444-4444-4444-8444-444444444444';
let fault = null;

/* the stand-in db: a held chit, no clock yet; any call can be made to throw what Postgres or the connection would */
const run = async (sql) => {
  if (fault) throw fault;
  if (/FROM chit_header/.test(sql)) return { rows: [{ role: 'x' }] };
  if (/UPDATE chit_sla/.test(sql)) return { rows: [{ resolved_at: new Date(0), resolution_code: 'fixed' }] };
  if (/chit_sla_pause_answer|chit_sla_pause\(/.test(sql)) return { rows: [{ copies: 1 }] };
  return { rows: [] };
};
const stubDb = { query: run };
const dbPath = require.resolve(path.join(ROOT, 'db'));
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { withEntity: async (id, fn) => fn(stubDb), onEntity: async (id, db, fn) => (typeof db === 'function' ? db(stubDb) : fn(stubDb)), pool: {} } };
const authPath = require.resolve(path.join(ROOT, 'middleware', 'auth'));
const stubAuth = (req, res, next) => {
  req.identity = { identity_id: SHOP, identity_type: 'entity', display_name: 'Test' };
  next();
};
stubAuth.entityOf = (req) => req.identity.identity_id;
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: stubAuth };

const app = express();
app.use(express.json());
app.use((req, res, next) => {
  req.id = 'req-test';
  next();
});
app.use('/api/service', require(path.join(ROOT, 'routes', 'service.js')));

let failed = 0;
let total = 0;
const check = (ok, label) => {
  total++;
  if (!ok) failed++;
  console.log((ok ? 'ok   ' : 'FAIL ') + label);
};
const ask = (server, method, url, body) =>
  new Promise((resolve) => {
    const data = JSON.stringify(body || {});
    const req = http.request({ port: server.address().port, method, path: url, headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } }, (res) => {
      let text = '';
      res.on('data', (c) => (text += c));
      res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'] || '', text, body: (() => { try { return JSON.parse(text); } catch (e) { return {}; } })() }));
    });
    req.end(data);
  });

(async () => {
  const server = app.listen(0);
  const base = '/api/service/' + CHIT;
  const routes = [
    ['GET', base, {}],
    ['POST', base + '/resolve', { resolution_code: 'fixed' }],
    ['POST', base + '/pause', { reason: 'waiting_on_parts' }],
    ['POST', base + '/pause/' + PAUSE + '/answer', { accepted: true }]
  ];
  const label = (m, u) => m + ' ' + u.replace(CHIT, ':chit').replace(PAUSE, ':pause');

  /* a success is unchanged */
  fault = null;
  const got = await ask(server, 'GET', base);
  check(got.status === 200 && got.body.tracked === false && got.body.chit_id === CHIT, 'GET untracked → 200 {tracked:false} (got ' + got.status + ')');
  const res = await ask(server, 'POST', base + '/resolve', { resolution_code: 'fixed' });
  check(res.status === 200 && res.body.message === 'Resolution recorded' && res.body.resolution_code === 'fixed', 'resolve → 200 Resolution recorded (got ' + res.status + ')');
  const ans = await ask(server, 'POST', base + '/pause/' + PAUSE + '/answer', { accepted: true });
  check(ans.status === 200 && ans.body.message === 'Pause accepted' && ans.body.copies === 1, 'answer → 200 Pause accepted (got ' + ans.status + ')');
  const own = (fault = Object.assign(new Error('a pause cannot answer its own claim'), { code: 'P0001' })) && (await ask(server, 'POST', base + '/pause/' + PAUSE + '/answer', { accepted: true }));
  check(own.status === 409 && own.body.error === 'Your own claim', 'answer on its own claim stays 409 Your own claim (got ' + own.status + ')');

  /* a database fault: Postgres's own words, then a plain connection error */
  const faults = [
    Object.assign(new Error('syntax error at or near "SELECT" in SELECT secret FROM chit_sla'), { code: '42601' }),
    new Error('connect ECONNREFUSED 10.0.0.5:5432')
  ];
  for (const f of faults) {
    fault = f;
    for (const [m, u, b] of routes) {
      const a = await ask(server, m, u, b);
      check(a.status === 500 && a.body.code === 'INTERNAL' && /problem\+json/.test(a.type), label(m, u) + ' fault → 500 INTERNAL problem+json (got ' + a.status + ' ' + a.body.code + ')');
      check(!/SELECT|syntax|42601|ECONNREFUSED|10\.0\.0\.5|chit_sla/.test(a.text), label(m, u) + ' fault → none of the thrown text');
    }
  }

  /* a known Postgres refusal: the population boundary is a 409, a statement timeout a 503 */
  fault = Object.assign(new Error('a test entity cannot trade with a production one'), { code: '23514' });
  for (const [m, u, b] of routes) {
    const a = await ask(server, m, u, b);
    check(a.status === 409 && a.body.code === 'POPULATION_BOUNDARY', label(m, u) + ' known refusal → 409 POPULATION_BOUNDARY (got ' + a.status + ')');
  }
  fault = Object.assign(new Error('canceling statement due to statement timeout'), { code: '57014' });
  for (const [m, u, b] of routes) {
    const a = await ask(server, m, u, b);
    check(a.status === 503 && a.body.code === 'STATEMENT_TIMEOUT', label(m, u) + ' timeout → 503 STATEMENT_TIMEOUT (got ' + a.status + ')');
  }
  server.close();
  console.log(total + ' checks' + (failed ? ', ' + failed + ' FAILED' : ''));
  process.exit(failed ? 1 : 0);
})();
