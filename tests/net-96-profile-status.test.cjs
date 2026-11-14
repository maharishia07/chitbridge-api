#!/usr/bin/env node
/**
 * net-96-profile-status.test.cjs - NET-96 (P2, hunt 9 Nov 2026): PATCH /api/entities/profile { business_status: [] } answered 500 "Profile update failed".
 * @type regression
 * OWNS      the proof that the shop status is one of open, closed or away AS A WHOLE VALUE: an empty list, a list that holds a good word, a number and a null are refused 400 in words with nothing written; the three words are not refused.
 * CALLED BY scripts/guards.cjs · CI. No database, no network: the real route over a stand-in db and auth (the shape of tests/ctr182-gstin-owner-only.test.cjs).
 * FLOW      owner PATCH body → real route (express-validator chain) → status, message, and whether any UPDATE reached the db
 *   node tests/net-96-profile-status.test.cjs
 */
'use strict';
const path = require('path');
const express = require('express');
const http = require('http');

const HERE = path.join(__dirname, '..');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';

const SHOP = '11111111-1111-4111-8111-111111111111';
const OWNER = { identity_id: SHOP, identity_type: 'entity', display_name: 'Kaveri Mess' };

const world = { who: OWNER, key: null, writes: [], sqls: [] };
const isWrite = (sql) => /^\s*(UPDATE|INSERT|DELETE)/i.test(String(sql));
function rowsFor(sql, params) {
  const text = String(sql);
  if (isWrite(text)) { world.sqls.push(text); world.writes.push(text.replace(/\s+/g, ' ').slice(0, 60)); return { rows: [], rowCount: 1 }; }
  if (/FROM identities/.test(text)) return { rows: [{ display_name: 'Kaveri Mess', identity_id: SHOP, gstn: STORED, country: 'IN', address: '1 High St', policy_flags: { gst_registration: 'regular' } }] };
  return { rows: [], rowCount: 0 };
}
const mock = (relative, exported) => { const file = require.resolve(path.join(HERE, relative)); require.cache[file] = { id: file, filename: file, loaded: true, exports: exported }; };
function installStubs() {
  const realAuth = require(path.join(HERE, 'middleware', 'auth'));
  const { holderOf } = require(path.join(HERE, 'lib', 'holder'));
  const stubAuth = (req, res, next) => {
    req.identity = world.who;
    if (world.key) { req.api_key = { jti: 'j1', scopes: world.key }; req.till = holderOf({ kind: 'api_key', jti: 'j1', scopes: world.key }, null, null); }
    return next();
  };
  mock('middleware/auth', Object.assign(stubAuth, realAuth, { entityOf: (req) => req.identity.parent_entity_id || req.identity.identity_id, requireScope: () => (q, s, n) => n() }));
  const client = { query: async (sql, params) => rowsFor(sql, params) };
  const known = { query: async (sql, params) => rowsFor(sql, params), withEntity: async (id, run) => run(client), withTransaction: async (run) => run(client),
    trySavepoint: async (handle, run, fallback) => run().catch(() => fallback), readBatch: async (entity, actor, statements) => statements.map((s) => rowsFor(s && s.text ? s.text : s)) };
  const db = new Proxy(known, { get: (target, name) => (name in target ? target[name] : typeof name === 'symbol' || name === 'then' ? undefined : async () => ({ rows: [], rowCount: 0 })) });
  mock('db', db); mock('db/index', db);
  console.error = () => undefined; console.warn = () => undefined;
}
const call = (port, method, p, body) => new Promise((done) => {
  const b = JSON.stringify(body || {});
  const r = http.request({ host: '127.0.0.1', port, path: p, method, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b) } },
    (res) => { let raw = ''; res.on('data', (c) => (raw += c)); res.on('end', () => { let j = {}; try { j = JSON.parse(raw || '{}'); } catch (_) { j = { raw }; } done({ status: res.statusCode, body: j }); }); });
  r.end(b);
});

let pass = 0, fail = 0;
const ok = (name, cond, info) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (info ? '\n          ' + String(info).slice(0, 300) : '')); } };
const STORED = '27AAACR5055K1Z7';

(async () => {
  console.log('\n══ NET-96 · the shop status is one of three words, as a whole value ══\n');
  installStubs();
  const app = express(); app.use(express.json());
  app.use('/api/entities', require(path.join(HERE, 'routes', 'entities.js')));
  const server = app.listen(0); const port = server.address().port;
  const patch = async (body) => { Object.assign(world, { who: OWNER, key: null, writes: [], sqls: [] }); return call(port, 'PATCH', '/api/entities/profile', body); };
  try {
    for (const [label, value] of [['an empty list', []], ['a list holding a good word', ['open']], ['a number', 7], ['null', null], ['a word that is not one of the three', 'active']]) {
      const r = await patch({ business_status: value });
      ok(label + ': 400 in words, nothing written', r.status === 400 && /open, closed or away/.test(JSON.stringify(r.body)) && world.writes.length === 0, r.status + ' ' + JSON.stringify(r.body) + ' writes ' + world.writes.length);
    }
    for (const word of ['open', 'closed', 'away']) {
      const r = await patch({ business_status: word });
      ok('"' + word + '" is not refused by the status check', r.status !== 400, r.status + ' ' + JSON.stringify(r.body));
    }
  } finally { server.close(); }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exitCode = fail ? 1 : 0;
})().catch((e) => { console.error(e); process.exit(1); });
