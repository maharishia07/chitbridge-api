#!/usr/bin/env node
'use strict';
/**
 * tests/set80-currency-lock.test.cjs — SET-80 + SET-81 (2026-11-08): the shop's currency is locked once it has traded, on EVERY door.
 *
 * Critic: PM/designs/SET-80-currency-lock.CRITIC.md. ONE lock: lib/country-setup.currencyLockRefusal (reads constitution()).
 *   · PATCH /api/entities/profile {currency_code} on a shop that holds a product / a chit / a books entry → 409 COUNTRY_CHANGE_IS_NEW_ENTITY, nothing written
 *   · an untraded shop → 200; the SAME currency on a traded shop → 200; a co-assist → 403 before the lock
 *   · SET-81: an unknown ISO code (XYZ) and a malformed one (zz9) → 400 CURRENCY_MALFORMED, on the profile AND in network-build
 *   · network-build updateNode on a traded store moving its currency → a plan.problems row, nothing written
 *   · guard: every `UPDATE identities … currency_code` in routes/ and lib/ names currencyLockRefusal (a fourth door cannot appear)
 * Run: node tests/set80-currency-lock.test.cjs · no DB, no network.
 * CARD      20-settings-governance-and-plan
 */
const path = require('path');
const http = require('http');
const fs = require('fs');
const API = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://u:p@127.0.0.1:5432/x';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
let pass = 0, fail = 0;
const ok = (what, cond, info) => { if (cond) { pass++; console.log('  ✓ ' + what); } else { fail++; console.log('  ✗ ' + what + (info ? '\n      ' + String(info).slice(0, 400) : '')); } };

const SHOP = '11111111-1111-4111-8111-111111111111', STORE = '33333333-3333-4333-8333-333333333333';
let ID = { currency_code: 'INR', country: 'IN' };           /* the shop row */
let CONST = { products: false, chits: false, entries: false }; /* what the shop holds */
let WRITES = [];
const fake = async (sql) => {
  const t = String(sql).trim();
  if (/information_schema/.test(t)) return { rows: [{ '?column?': 1 }], rowCount: 1 };
  if (/country-setup constituted/.test(t)) return { rows: [CONST], rowCount: 1 };
  if (/FROM constitution/.test(t)) return { rows: [{ constitution_key: 'base', version: 'v2', governance: { allowed: {} }, capabilities: [] }] };
  if (/^SELECT identity_id FROM identities WHERE bridge_id/.test(t)) return { rows: [{ identity_id: STORE }], rowCount: 1 };
  if (/^SELECT .*FROM identities/.test(t)) return { rows: [ID], rowCount: 1 };
  if (/^UPDATE identities/.test(t)) { WRITES.push(t.slice(0, 30)); return { rows: [{ bridge_id: 'CBX' }], rowCount: 1 }; }
  return { rows: [], rowCount: 0 };
};
const H = { query: fake };
const dbPath = require.resolve(path.join(API, 'db'));
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: {
  query: fake, withEntity: async (e, fn) => fn(H), onEntity: async (e, fn) => fn(H), withTransaction: async (fn) => fn(H),
  readBatch: async (e, x, qs) => qs.map(() => ({ rows: [], rowCount: 0 })), trySavepoint: async (db, fn) => fn(db) } };
let WHO = { identity_id: SHOP, identity_type: 'entity' };
const authPath = require.resolve(path.join(API, 'middleware', 'auth'));
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: Object.assign((req, res, next) => { req.identity = WHO; next(); }, {
  entityOf: (req) => req.identity.parent_entity_id || req.identity.identity_id, requireScope: () => (q, s, n) => n(), userOf: (r) => r.identity, forgetKey: () => {}, keyAlive: async () => true }) };

const call = (port, method, p, body) => new Promise((done) => {
  const b = JSON.stringify(body || {});
  const r = http.request({ host: '127.0.0.1', port, path: p, method, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b) } },
    (res) => { let raw = ''; res.on('data', (c) => raw += c); res.on('end', () => { let j = {}; try { j = JSON.parse(raw || '{}'); } catch (_) {} done({ status: res.statusCode, body: j }); }); });
  r.end(b);
});

(async () => {
  const CS = require(path.join(API, 'lib', 'country-setup'));
  const { currencyRefusal } = require(path.join(API, 'lib', 'govresolve'));
  console.log('\n── the one lock (lib/country-setup.currencyLockRefusal) ──');
  ok('currencyLockRefusal is exported', typeof CS.currencyLockRefusal === 'function');
  if (typeof CS.currencyLockRefusal === 'function') {
    for (const [leg, c] of [['a product', { products: true }], ['a chit', { chits: true }], ['a books entry', { entries: true }]]) {
      CONST = Object.assign({ products: false, chits: false, entries: false }, c);
      const r = await CS.currencyLockRefusal(H, SHOP, 'USD');
      ok('traded by ' + leg + ' (INR to USD): refused 409 COUNTRY_CHANGE_IS_NEW_ENTITY with the sentence', !!r && r.status === 409 && r.code === 'COUNTRY_CHANGE_IS_NEW_ENTITY' && /INR/.test(r.message) && /Register a new business/.test(r.message), JSON.stringify(r));
    }
    CONST = { products: true, chits: false, entries: false };
    ok('traded, the SAME currency re-sent (any case): null (idempotent)', (await CS.currencyLockRefusal(H, SHOP, 'inr')) === null);
    CONST = { products: false, chits: false, entries: false };
    ok('untraded: null, the currency may still be corrected', (await CS.currencyLockRefusal(H, SHOP, 'USD')) === null);
  }

  console.log('\n── PATCH /api/entities/profile ──');
  const express = require('express');
  const app = express(); app.use(express.json());
  app.use('/api/entities', require(path.join(API, 'routes', 'entities')));
  const srv = app.listen(0); const port = srv.address().port;
  const patch = (b) => call(port, 'PATCH', '/api/entities/profile', b);
  try {
    for (const [leg, c] of [['one product', { products: true }], ['only a chit', { chits: true }], ['only a books entry', { entries: true }]]) {
      ID = { currency_code: 'INR', country: 'IN' }; WRITES = [];
      CONST = Object.assign({ products: false, chits: false, entries: false }, c);
      const r = await patch({ currency_code: 'USD' });
      ok('INR shop with ' + leg + ', USD: 409 COUNTRY_CHANGE_IS_NEW_ENTITY, nothing written', r.status === 409 && r.body.code === 'COUNTRY_CHANGE_IS_NEW_ENTITY' && WRITES.length === 0, JSON.stringify(r));
    }
    CONST = { products: false, chits: false, entries: false }; WRITES = [];
    let r = await patch({ currency_code: 'USD' });
    ok('untraded shop: USD is 200 and the row is written', r.status === 200 && WRITES.length === 1, JSON.stringify(r));
    CONST = { products: true, chits: false, entries: false }; WRITES = [];
    r = await patch({ currency_code: 'INR' });
    ok('traded shop re-sends its own currency: 200', r.status === 200, JSON.stringify(r));
    WHO = { identity_id: 'a-1', parent_entity_id: SHOP, identity_type: 'actor' }; WRITES = [];
    r = await patch({ currency_code: 'USD' });
    ok('a co-assist: 403 CURRENCY_ENTITY_ONLY, before the lock, nothing written', r.status === 403 && r.body.code === 'CURRENCY_ENTITY_ONLY' && WRITES.length === 0, JSON.stringify(r));
    WHO = { identity_id: SHOP, identity_type: 'entity' };
    CONST = { products: false, chits: false, entries: false };
    for (const bad of ['XYZ', 'zz9']) {
      WRITES = [];
      r = await patch({ currency_code: bad });
      ok('SET-81: ' + bad + ': 400 CURRENCY_MALFORMED, nothing written', r.status === 400 && r.body.code === 'CURRENCY_MALFORMED' && WRITES.length === 0, JSON.stringify(r));
    }
  } finally { srv.close(); }

  console.log('\n── SET-81 · govresolve.currencyRefusal ──');
  ok('XYZ (three letters, not ISO 4217): CURRENCY_MALFORMED', ((await currencyRefusal(SHOP, 'XYZ')) || {}).code === 'CURRENCY_MALFORMED');
  ok('a real code (SGD) still passes', (await currencyRefusal(SHOP, 'SGD')) === null);

  console.log('\n── network-build updateNode ──');
  const run = require(path.join(API, 'lib', 'network-build-run'));
  const mk = (cur) => ({ u: { key: 'k', name: 'Store', bridge_id: 'CBX', place: { to: { currency: cur, city: 'Pune' } } }, x: { plan: { problems: [] }, entity: SHOP, me: SHOP, updated: [] } });
  ok('updateNode is exported', typeof run.updateNode === 'function');
  if (typeof run.updateNode === 'function') {
    ID = { currency_code: 'INR', country: 'IN' }; CONST = { products: true, chits: false, entries: false }; WRITES = [];
    let { u, x } = mk('USD'); await run.updateNode(H, u, x);
    ok('traded store moving INR to USD: a plan.problems row, nothing written', x.plan.problems.length === 1 && /new business/i.test(x.plan.problems[0].reason) && WRITES.length === 0, JSON.stringify(x.plan.problems));
    ({ u, x } = mk('XYZ')); WRITES = []; await run.updateNode(H, u, x);
    ok('SET-81: XYZ in a plan: a plan.problems row, nothing written', x.plan.problems.length === 1 && WRITES.length === 0, JSON.stringify(x.plan.problems));
    CONST = { products: false, chits: false, entries: false }; ({ u, x } = mk('USD')); WRITES = []; await run.updateNode(H, u, x);
    ok('untraded store: the move is written', x.plan.problems.length === 0 && WRITES.length === 1, JSON.stringify(x.plan.problems));
  }

  console.log('\n── guard: every UPDATE identities ... currency_code names the lock ──');
  const files = [];
  for (const d of ['routes', 'lib']) for (const f of fs.readdirSync(path.join(API, d))) if (/\.(js|cjs)$/.test(f)) files.push(d + '/' + f);
  const offenders = [];
  for (const f of files) {
    const src = fs.readFileSync(path.join(API, f), 'utf8');
    /* each UPDATE identities statement (up to its closing backtick) that assigns currency_code */
    /* the fill-only-when-null form (the sign-in stamp: currency_code = COALESCE(currency_code, $3)) changes nothing that exists, so it is not a door */
    const re = /UPDATE\s+identities\b[^`]*?\bcurrency_code\s*=(?!\s*COALESCE\(\s*currency_code\s*,)/;
    if (re.test(src) && !/currencyLockRefusal\s*\(/.test(src)) offenders.push(f);
  }
  ok('no file writes identities.currency_code without calling currencyLockRefusal', offenders.length === 0, offenders.join(', '));
  console.log('\n' + (fail ? '✗ ' + fail + ' failed · ' : '✓ ') + (pass + fail) + ' checks');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
