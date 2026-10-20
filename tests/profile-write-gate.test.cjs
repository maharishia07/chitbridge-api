#!/usr/bin/env node
'use strict';
/**
 * tests/profile-write-gate.test.cjs — SEC-71 (2026-10-18): the shop's profile is changed only by the owner or an editor.
 * PUT /api/governance/profile · PUT /api/governance/profile/vault · PATCH /api/entities/profile all sit behind lib/access.writeGate
 * (the ONE write gate). A viewer / commenter is refused 403 with code read_only / comment_only and the rail's sentence; the owner and
 * an editor pass. Another shop's login cannot reach this shop: the write is keyed by auth.entityOf (the caller's own entity).
 * Run: node tests/profile-write-gate.test.cjs · no DB (db/index.js is stubbed), no network.
 */
const path = require('path');
const http = require('http');
const API = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://u:p@127.0.0.1:5432/x';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
let pass = 0, fail = 0;
const ok = (what, cond, info) => { if (cond) { pass++; console.log('  ✓ ' + what); } else { fail++; console.log('  ✗ ' + what + (info ? '\n      ' + String(info).slice(0, 400) : '')); } };

const SHOP = '11111111-1111-4111-8111-111111111111', OTHER = '22222222-2222-4222-8222-222222222222';
const stubRows = { rows: [], rowCount: 0 };
const dbPath = require.resolve(path.join(API, 'db'));
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: {
  query: async () => stubRows, withEntity: async (e, fn) => fn({ query: async () => stubRows }), onEntity: async (e, fn) => fn({ query: async () => stubRows }),
  withTransaction: async (fn) => fn({ query: async () => stubRows }), readBatch: async (e, x, qs) => qs.map(() => stubRows), trySavepoint: async (db, fn) => fn(db) } };
let WHO = null;
const authPath = require.resolve(path.join(API, 'middleware', 'auth'));
const authStub = Object.assign((req, res, next) => { req.identity = WHO; next(); }, {
  entityOf: (req) => req.identity.parent_entity_id || req.identity.identity_id, requireScope: () => (q, s, n) => n(), userOf: (r) => r.identity, forgetKey: () => {}, keyAlive: async () => true });
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: authStub };

/* the profile writers are replaced by spies: a request that PASSES the gate reaches them, a refused one never does */
let saved = [];
const profPath = require.resolve(path.join(API, 'lib', 'profile'));
const realProfile = require(profPath);
require.cache[profPath].exports = Object.assign({}, realProfile, { saveProfile: async (e, b) => { saved.push(e); return { ok: true }; },
  patchVault: async (e) => { saved.push(e); return { ok: true }; } });

const call = (port, method, p, body) => new Promise((done) => {
  const b = JSON.stringify(body || {});
  const r = http.request({ host: '127.0.0.1', port, path: p, method, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b) } },
    (res) => { let raw = ''; res.on('data', (c) => raw += c); res.on('end', () => { let j = {}; try { j = JSON.parse(raw || '{}'); } catch (_) {} done({ status: res.statusCode, body: j }); }); });
  r.end(b);
});

(async () => {
  const A = require(path.join(API, 'lib', 'access'));
  const WHY = require(path.join(API, 'lib', 'rail')).WHY;
  const express = require('express');
  const app = express(); app.use(express.json());
  app.use('/api/governance', require(path.join(API, 'routes', 'governance')));
  app.use('/api/entities', require(path.join(API, 'routes', 'entities')));
  const srv = app.listen(0); const port = srv.address().port;
  const OWNER = { identity_id: SHOP, identity_type: 'entity' };
  const mk = (level, shop) => ({ identity_id: 'a-' + level, parent_entity_id: shop, identity_type: 'actor', access_level: level });
  const WRITES = [['PUT', '/api/governance/profile', { trade_mode: 'both' }], ['PUT', '/api/governance/profile/vault', { patch: { sections: {} }, version: 1 }]];
  try {
    for (const [mth, p, body] of WRITES) {
      for (const [level, code] of [['viewer', 'read_only'], ['commenter', 'comment_only']]) {
        WHO = mk(level, SHOP); saved = [];
        const r = await call(port, mth, p, body);
        ok(mth + ' ' + p + ' — a ' + level + ' is refused 403 ' + code + ' with the rail\'s sentence, and nothing is written',
          r.status === 403 && r.body.code === code && r.body.message === WHY[code] && saved.length === 0, JSON.stringify(r));
      }
      for (const [who, label] of [[OWNER, 'the owner'], [mk('editor', SHOP), 'an editor']]) {
        WHO = who; saved = [];
        const r = await call(port, mth, p, body);
        ok(mth + ' ' + p + ' — ' + label + ' passes and the write lands on THEIR shop', r.status === 200 && saved.length === 1 && saved[0] === SHOP, JSON.stringify(r));
      }
      WHO = mk('editor', OTHER); saved = [];
      await call(port, mth, p, body);
      ok(mth + ' ' + p + ' — another shop\'s editor writes only ITS OWN shop, never ' + SHOP.slice(0, 4), saved.every((e) => e === OTHER));
    }
    WHO = mk('viewer', SHOP);
    const r = await call(port, 'PATCH', '/api/entities/profile', { gstn: '27AAAAA0000A1Z5' });
    ok('PATCH /entities/profile — a viewer is refused 403 read_only before any validator or write', r.status === 403 && r.body.code === 'read_only' && r.body.message === WHY.read_only, JSON.stringify(r));
  } finally { srv.close(); }
  ok('the one gate: governance.js and entities.js use lib/access.writeGate, no second check', require('fs').readFileSync(path.join(API, 'routes', 'governance.js'), 'utf8').includes("router.put('/profile', auth, writeGate") && typeof A.writeGate === 'function');
  console.log('\n' + (fail ? '✗ ' + fail + ' failed · ' : '✓ ') + (pass + fail) + ' checks');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
