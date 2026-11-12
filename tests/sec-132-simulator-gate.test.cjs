/**
 * tests/sec-132-simulator-gate.test.cjs — SEC-132 (C12, 2026-11-12; Athi: gate the simulator). /api/simulator/* (content · lead · feedback) answered anyone, signed in or not, in production.
 * Now it answers only OFF a sealed environment (lib/dev-otp isSealed: production · uat · staging · live · prod, NODE_ENV trimmed and lower-cased), unless SIMULATOR_ENABLED=1 is set on purpose;
 * sealed and not enabled, it is EXACTLY what an unknown path answers (same status, same body), so the tour cannot be told from any other missing route.
 * The real routes/simulator.js behind a bare app; the database is a stand-in. Run: node tests/sec-132-simulator-gate.test.cjs
 */
'use strict';
const path = require('path');
const http = require('http');
const express = require('express');

process.env.JWT_SECRET = 'test-only-secret-sec-132';
const API = path.join(__dirname, '..');
let pass = 0, fail = 0;
const t = (name, ok, extra) => { if (ok) { pass++; console.log('  ok  ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? '\n       ' + extra : '')); } };
const q = async () => ({ rows: [], rowCount: 0 });
const stub = (rel, exports) => { const p = require.resolve(path.join(API, rel)); require.cache[p] = { id: p, filename: p, loaded: true, exports }; };
stub('db', { query: q, withEntity: async (id, fn) => fn({ query: q }), withTransaction: async (fn) => fn({ query: q }), readBatch: async () => ({}), trySavepoint: async (d, fn) => fn() });

const app = express();
app.use(express.json());
app.use('/api/simulator', require(path.join(API, 'routes', 'simulator')));
app.use((req, res) => res.status(404).json({ error: 'Not found', path: 'unknown' })); // the app's own "no such route"
let base;
const call = (method, url, body) => new Promise((resolve, reject) => {
  const data = body ? JSON.stringify(body) : null;
  const h = { 'content-type': 'application/json' };
  if (data) h['content-length'] = Buffer.byteLength(data);
  const r = http.request(base + url, { method, headers: h }, (res) => {
    let s = ''; res.on('data', (c) => { s += c; });
    res.on('end', () => resolve({ status: res.statusCode, raw: s.slice(0, 160) }));
  });
  r.on('error', reject); if (data) r.write(data); r.end();
});
const LEAD = { name: 'Asha', email: 'asha@example.com' };
const ROUTES = [['GET', '/api/simulator/content'], ['POST', '/api/simulator/lead', LEAD], ['POST', '/api/simulator/feedback', { section: 'home', message: 'hi' }]];
const envIs = (node_env, enabled) => { process.env.NODE_ENV = node_env; if (enabled === undefined) delete process.env.SIMULATOR_ENABLED; else process.env.SIMULATOR_ENABLED = enabled; };

(async () => {
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + server.address().port;
  try {
    const missing = await call('GET', '/api/nothing-here');
    for (const env of ['production', ' Production ', 'staging', 'uat', 'live', 'prod']) {
      envIs(env);
      const seen = await Promise.all(ROUTES.map(([m, u, b]) => call(m, u, b)));
      t('sealed (' + JSON.stringify(env) + '): all three simulator routes answer what an unknown path answers (404)', seen.every((r) => r.status === 404 && r.raw === missing.raw), JSON.stringify(seen));
    }
    envIs('production', '1');
    let seen = await Promise.all(ROUTES.map(([m, u, b]) => call(m, u, b)));
    t('sealed but SIMULATOR_ENABLED=1 (on purpose): the routes answer again (not the missing-route 404)', seen.every((r) => r.raw !== missing.raw), JSON.stringify(seen));
    envIs('production', '0');
    seen = await call('GET', '/api/simulator/content');
    t('SIMULATOR_ENABLED=0 stays closed', seen.status === 404 && seen.raw === missing.raw, JSON.stringify(seen));
    for (const env of ['development', 'test', '']) {
      envIs(env);
      seen = await Promise.all(ROUTES.map(([m, u, b]) => call(m, u, b)));
      t('not sealed (' + JSON.stringify(env) + '): the routes answer as before (control)', seen.every((r) => r.raw !== missing.raw), JSON.stringify(seen));
    }
  } finally {
    await new Promise((r) => server.close(r));
  }
  console.log(`\n${pass + fail} checks · ${pass} passed · ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
