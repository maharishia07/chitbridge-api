/**
 * lv13-assist-container-gates.test.cjs — LV-13 (lens verify 22 Nov): PUT /api/assist/container and PUT /api/assist/region-override are the owner's or a platform operator's, through the real route order.
 * HAND-COMPUTED  a staff seat (parent_entity_id set) and an API key: 403 OWNER_ONLY in words, nothing written · the owner: reaches the door · a platform operator: reaches the door ·
 *                an OWNERLESS container's region override: the owner is answered 404 as for an unknown one, nothing written; only a platform operator writes it.
 * Fails on the parent: both routes were `auth` only, so the staff seat passed and any caller wrote an ownerless container's override.
 * Run: node tests/lv13-assist-container-gates.test.cjs
 */
'use strict';
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.DATABASE_URL = '';
const path = require('path');
const http = require('http');
const express = require('express');
const API = path.join(__dirname, '..');
const OWNER_ID = 'aaaaaaaa-7777-4111-8111-111111111111', STAFF_ID = 'bbbbbbbb-7777-4111-8111-111111111111';
let WHO = 'owner', WRITES = [];
const IDENT = {
  owner: { identity_id: OWNER_ID, identity_type: 'entity' },
  staff: { identity_id: STAFF_ID, identity_type: 'actor', parent_entity_id: OWNER_ID, access_level: 'editor' },
  platform: { identity_id: OWNER_ID, identity_type: 'entity', owner_scope: 'platform' }
};
const dbPath = require.resolve(path.join(API, 'db'));
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: {
  query: async (sql, p) => { WRITES.push(String(sql).replace(/\s+/g, ' ').slice(0, 40)); return { rows: [], rowCount: 1 }; },
  queryAs: async () => ({ rows: [] }), withEntity: async (id, fn) => fn({ query: async () => ({ rows: [] }) }), readBatch: async () => ({}), trySavepoint: async (d, fn) => fn(d), onEntity: async (i, d, fn) => fn({ query: async () => ({ rows: [] }) }) } };
const authPath = require.resolve(path.join(API, 'middleware', 'auth'));
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: Object.assign(
  (req, res, next) => { req.identity = Object.assign({}, IDENT[WHO === 'key' ? 'owner' : WHO]); if (WHO === 'key') req.api_key = { id: 'k' }; next(); },
  { entityOf: (req) => req.identity.parent_entity_id || req.identity.identity_id, requireScope: () => (q, s, n) => n(), allowsKey: () => false }) };
const container = require(path.join(API, 'lib', 'container'));
container.getContainer = async (id) => (id === 'own' ? { container_id: id, owner_entity_id: OWNER_ID } : id === 'seed' ? { container_id: id, owner_entity_id: null } : null);
container.authorContainer = async (owner, b) => { WRITES.push('author'); return { container: { container_id: b.container_id }, version: { version: 1 } }; };
const app = express(); app.use(express.json()); app.use('/api/assist', require(path.join(API, 'routes', 'assist')));
let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + JSON.stringify(why).slice(0, 300) : '')); } };
const call = (port, p, body) => new Promise((done) => {
  const b = JSON.stringify(body);
  const r = http.request({ host: '127.0.0.1', port, path: p, method: 'PUT', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b) } },
    (res) => { let raw = ''; res.on('data', (c) => raw += c); res.on('end', () => { let j = {}; try { j = JSON.parse(raw || '{}'); } catch (_) { j = { raw }; } done({ status: res.statusCode, body: j }); }); });
  r.end(b);
});
(async () => {
  const srv = app.listen(0), port = srv.address().port;
  const run = async (who, p, body) => { WHO = who; WRITES = []; return call(port, '/api/assist' + p, body); };
  const refused = (r) => r.status === 403 && r.body.code === 'OWNER_ONLY' && r.body.may === false;
  const container1 = { container_id: 'own', name: 'Paint', content: { colour: 'red' } };
  for (const who of ['staff', 'key']) {
    const a = await run(who, '/container', container1), b = await run(who, '/region-override', { container_id: 'own', region: 'IN', overrides: { x: 1 } });
    ok(who + ': PUT /container is refused 403 OWNER_ONLY in words, nothing written', refused(a) && !WRITES.includes('author'), a);
    ok(who + ': PUT /region-override is refused 403 OWNER_ONLY in words, nothing written', refused(b) && !WRITES.some((w) => /INSERT INTO container_region/.test(w)), b);
  }
  const own = await run('owner', '/region-override', { container_id: 'own', region: 'IN', overrides: { x: 1 } });
  ok('owner: sets the override of its own container', own.status === 200 && own.body.ok === true, own);
  const oc = await run('owner', '/container', container1);
  ok('owner: reaches the container door (not a seat refusal)', !refused(oc), oc);
  const seedOwner = await run('owner', '/region-override', { container_id: 'seed', region: 'IN', overrides: { x: 1 } });
  ok('owner: an ownerless container answers as an unknown one (404), nothing written', seedOwner.status === 404 && !WRITES.some((w) => /INSERT INTO container_region/.test(w)), seedOwner);
  const seedPlatform = await run('platform', '/region-override', { container_id: 'seed', region: 'IN', overrides: { x: 1 } });
  ok('platform operator: writes the ownerless container override', seedPlatform.status === 200 && WRITES.some((w) => /INSERT INTO container_region/.test(w)), seedPlatform);
  const pc = await run('platform', '/container', container1);
  ok('platform operator: reaches the container door', !refused(pc), pc);
  srv.close();
  console.log('\n' + (fail ? '  x ' + fail + ' failed' : '  ✓ ' + pass + ' passed') + ' · ' + (pass + fail) + ' checks\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
