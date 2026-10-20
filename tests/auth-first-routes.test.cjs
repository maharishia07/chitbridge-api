/**
 * tests/auth-first-routes.test.cjs — SEC-73: an unauthenticated caller gets 401, never 400.
 *
 * Six routes used to run `validate` BEFORE `auth` (written `validate, auth,` on one line, invisible to the old line scan
 * in tests/auth-before-validate): POST /chits/assign-bulk, PUT /chits/:id/void, POST /relationships/suppliers,
 * PATCH /relationships/suppliers/:id, POST /relationships/customers, PATCH /relationships/customers/:id.
 * A stranger who sent a bad body was told which fields the route wants (400) instead of being refused (401).
 *
 * Proof: the REAL routers and the REAL middleware/auth.js, only the database stubbed. Each route gets a body that FAILS
 * its validators, with no credential -> 401 and the validation detail absent. A signed-in caller with the same bad body
 * still gets 400 (nothing changes for people who are allowed in).
 *
 * Run: node tests/auth-first-routes.test.cjs · 127.0.0.1 only, no DB.
 */
'use strict';
const path = require('path');
const http = require('http');
const jwt = require('jsonwebtoken');
const express = require('express');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-secret-for-auth-first-routes';
const API = path.join(__dirname, '..');

const q = async () => ({ rows: [], rowCount: 0 });
const tx = { query: q };
const dbPath = require.resolve(path.join(API, 'db'));
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: {
  query: q, pool: { query: q, connect: async () => Object.assign({ release() {} }, tx) },
  withEntity: async (id, fn) => fn(tx), withTransaction: async (fn) => fn(tx), onEntity: async (id, db, fn) => fn(tx),
  readBatch: async () => ({}), trySavepoint: async (db, fn, fb) => { try { return await fn(db); } catch (_) { return fb; } },
} };
const schemaPath = require.resolve(path.join(API, 'lib', 'schema'));
require.cache[schemaPath] = { id: schemaPath, filename: schemaPath, loaded: true,
  exports: { hasColumn: async () => true, has: async () => true, columns: async () => [], table: async () => ({}) } };

let pass = 0, fail = 0;
const t = (name, ok, extra) => { if (ok) { pass++; console.log('  ok  ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? '\n       ' + extra : '')); } };

const app = express();
app.use(express.json());
app.use('/api/chits', require(path.join(API, 'routes', 'chits')));
app.use('/api/relationships', require(path.join(API, 'routes', 'relationships')));

/* a body that fails every one of these routes' validators */
const UUID = '11111111-1111-4111-8111-111111111111';
const ROUTES = [
  ['POST',  '/api/chits/assign-bulk',                 { chit_ids: 'nope', target_actor_id: 'nope' }],
  ['PUT',   '/api/chits/' + UUID + '/void',           { reason: '' }],
  ['POST',  '/api/relationships/suppliers',           { preferred: 'maybe', supply_kind: 'bogus' }],
  ['PATCH', '/api/relationships/suppliers/' + UUID,   { preferred: 'maybe', supply_kind: 'bogus' }],
  ['POST',  '/api/relationships/customers',           {}],
  ['PATCH', '/api/relationships/customers/' + UUID,   { segment_override: 'bogus' }],
];

const send = (srv, method, url, body, token) => new Promise((resolve, reject) => {
  const data = JSON.stringify(body);
  const headers = { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) };
  if (token) headers.Authorization = 'Bearer ' + token;
  const r = http.request({ host: '127.0.0.1', port: srv.address().port, path: url, method, headers }, (res) => {
    let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => resolve({ status: res.statusCode, body: b }));
  });
  r.on('error', reject); r.end(data);
});

(async () => {
  const srv = app.listen(0, '127.0.0.1');
  await new Promise((r) => srv.once('listening', r));
  const token = jwt.sign({ identity_id: 'E1', identity_type: 'entity' }, process.env.JWT_SECRET, { algorithm: 'HS256' });
  console.log('\n── unauthenticated + bad body: 401, no validation detail ──');
  for (const [method, url, body] of ROUTES) {
    const r = await send(srv, method, url, body, null);
    t(method + ' ' + url.replace(UUID, ':id') + ' -> 401 (not 400)', r.status === 401, 'got ' + r.status + ' ' + r.body.slice(0, 120));
    t('  …and the answer names no field', !/errors|msg|param|isIn|required/i.test(r.body.replace(/Unauthori[sz]ed|Authentication required/gi, '')), r.body.slice(0, 160));
  }
  console.log('\n── signed in + bad body: the validators still answer 400 (no change for people let in) ──');
  for (const [method, url, body] of ROUTES) {
    const r = await send(srv, method, url, body, token);
    t(method + ' ' + url.replace(UUID, ':id') + ' signed-in -> 400 from the validators', r.status === 400, 'got ' + r.status);
  }
  srv.close();
  console.log('\n  ══ ' + pass + ' passed · ' + fail + ' failed ══\n');
  process.exit(fail ? 1 : 0);
})();
