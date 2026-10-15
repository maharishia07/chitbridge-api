/**
 * tests/keys-kinds.test.cjs — SET-WALK1 · W15 (2026-10-15): the key kind "testing" is the platform role's, never a shop owner's.
 *
 * Offline: the real routes/keys.js over a stand-in db and auth. Held here:
 *   · GET /api/keys `scopes` for a SHOP login has no 'testing'; for a PLATFORM login (owner_scope 'platform') it has
 *   · POST /api/keys { scopes: ['testing'] } from a shop → 403 NOT_PLATFORM with a sentence, nothing minted
 *   · a shop's own kind (till) still mints
 * Run: node tests/keys-kinds.test.cjs
 */
'use strict';
const path = require('path');
const http = require('http');
const express = require('express');
const API = path.join(__dirname, '..');
let pass = 0, fail = 0;
const t = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log('  ' + (ok ? 'ok  ' : 'FAIL') + '  ' + label.padEnd(84) + (ok ? '' : JSON.stringify(got) + '   want ' + JSON.stringify(want)));
};
const mock = (rel, exports) => { const f = require.resolve(API + rel); require.cache[f] = { id: f, filename: f, loaded: true, exports }; };
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

const SHOP = { identity_id: 'e1', identity_type: 'entity', owner_scope: 'entity' };
const PLATFORM = { identity_id: 'p1', identity_type: 'entity', owner_scope: 'platform' };
let WHO = SHOP, minted = 0;
mock('/middleware/auth', Object.assign((req, res, next) => { req.identity = WHO; next(); }, {
  entityOf: (req) => req.identity.identity_id, requireScope: () => (req, res, next) => next(), forgetKey: () => {},
  SCOPE_NAMES: ['services', 'offers', 'pricing', 'tax', 'invoice', 'till', 'connector', 'testing'],
}));
const db = { query: async () => ({ rows: [{ policy_flags: { api_keys: [] } }], rowCount: 1 }), withTransaction: async (fn) => fn({ query: async () => ({ rows: [], rowCount: 1 }) }), withEntity: async (e, fn) => fn({ query: async () => ({ rows: [], rowCount: 1 }) }), readBatch: async () => [{ rows: [], rowCount: 0 }] };
mock('/db', db); mock('/db/index', db);
mock('/lib/policy', { patchKey: async () => { minted++; return {}; }, get: async () => ({}), defaults: () => ({}), flagOf: () => null });
mock('/lib/platformroot', { isPlatform: (req) => req.identity.owner_scope === 'platform', isRoot: () => false });

const app = express(); app.use(express.json());
app.use('/api/keys', require(API + '/routes/keys'));
const call = (port, method, p, body) => new Promise((ok) => {
  const data = body ? JSON.stringify(body) : null;
  const req = http.request({ port, path: p, method, headers: data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {} }, (res) => {
    let s = ''; res.on('data', (c) => { s += c; }); res.on('end', () => { let j = null; try { j = JSON.parse(s); } catch (_) {} ok({ status: res.statusCode, json: j }); });
  });
  if (data) req.write(data); req.end();
});

(async () => {
  const srv = app.listen(0); const port = srv.address().port;
  console.log('\n-- W15: the kinds a login may mint --\n');
  let r = await call(port, 'GET', '/api/keys');
  t('a shop login: scopes has every kind but testing', r.json.scopes, ['services', 'offers', 'pricing', 'tax', 'invoice', 'till', 'connector']);
  WHO = PLATFORM; r = await call(port, 'GET', '/api/keys');
  t('the platform role: testing is offered', r.json.scopes.indexOf('testing') >= 0, true);
  WHO = SHOP; r = await call(port, 'POST', '/api/keys', { name: 'build', scopes: ['testing'] });
  t('a shop asking for a testing key → 403 NOT_PLATFORM, a sentence, nothing minted', [r.status, r.json.code, typeof r.json.message, minted], [403, 'NOT_PLATFORM', 'string', 0]);
  r = await call(port, 'POST', '/api/keys', { name: 'counter', scopes: ['till'] });
  t('a shop\'s own kind (till) still mints', [r.status, !!(r.json && r.json.key)], [201, true]);
  srv.close();
  console.log('\n  ' + (pass + fail) + ' checks · ' + fail + ' failed\n');   /* the guard runner reads "<n> checks" */
  process.exit(fail ? 1 : 0);
})();
