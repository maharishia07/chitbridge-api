#!/usr/bin/env node
// @type: contract
/**
 * ctr-157-offer-live-signal.test.cjs - CTR-157 (R45): saving a definition (an offer made live, paused or changed) tells every open counter.
 *
 * OWNS      the proof that PUT /api/definitions/:id sends the shop-changed signal (lib/shopchanged, the bell) after the save is stored, that a refused save (a clash, a missing id)
 *           sends nothing, and that a create and a retire still send theirs. Before this, only the create and the retire rang the bell, so an offer made live from a draft
 *           stayed unseen at the counter until someone pressed F4 (the 24 Oct walk, R45).
 * MIN       the minimum this guard must show: one signal for a live save, none for a refusal.
 * CALLED BY scripts/guards.cjs / CI. No database, no network: the real routes/definitions.js over a stand-in db and auth.
 * FLOW      stub db + auth + shopchanged -> real router on an express app -> PUT -> status + signals heard
 * CARD      07-catalogue-and-pricing/definitions
 * TRACE     CTR-157 - R45 (PM/WALK-TRIAGE-2026-10-24.md)
 */
'use strict';
const path = require('path');
const http = require('http');
const express = require('express');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-secret-for-ctr-157';
const API = path.join(__dirname, '..');
const SHOP = '11111111-1111-4111-8111-111111111111';
const DRAFT = '33333333-3333-4333-8333-333333333333';
const TEA = '55555555-5555-4555-8555-555555555555';

let SIGNALS = [];
let DEFS = {};
const answer = (sql, p) => {
  const s = String(sql);
  if (/FROM definition d/.test(s) && /d\.status = 'live'/.test(s)) return [];
  if (/FROM catalogue_items/.test(s)) return [{ item_id: TEA, item_data: { name: 'Filter Coffee', categories: ['drinks'] } }];
  if (/SELECT \* FROM definition WHERE definition_id/.test(s)) return DEFS[p[0]] ? [DEFS[p[0]]] : [];
  if (/SELECT rules FROM definition_version/.test(s)) return DEFS[p[0]] ? [{ rules: DEFS[p[0]].rules }] : [];
  if (/^\s*INSERT INTO definition \(/.test(s)) return [{ definition_id: 'new-1', kind: p[1], sub_kind: p[2], name: p[3], status: p[6] }];
  if (/^\s*UPDATE definition/.test(s)) return [Object.assign({}, DEFS[p[0]], { status: p[3] || DEFS[p[0]].status })];
  return [];
};
const q = async (sql, params) => { const rows = answer(sql, params || []); return { rows, rowCount: rows.length }; };
const tx = { query: q };
const stub = (rel, exports) => { const f = require.resolve(path.join(API, rel)); require.cache[f] = { id: f, filename: f, loaded: true, exports }; };
stub('db', { query: q, pool: { query: q, connect: async () => Object.assign({ release() {} }, tx) }, withEntity: async (id, fn) => fn(tx),
  withTransaction: async (fn) => fn(tx), onEntity: async (id, db, fn) => fn(tx), readBatch: async () => [{ rows: [] }],
  trySavepoint: async (db, fn, fb) => { try { return await fn(db); } catch (_) { return fb; } } });
const auth = (req, res, next) => { req.identity = { identity_id: SHOP }; next(); };
auth.entityOf = (req) => req.identity.identity_id; auth.requireScope = () => (req, res, next) => next();
stub('middleware/auth', auth);
stub('lib/shopchanged', { shopChanged: (entity, what) => { SIGNALS.push({ entity, what }); return 1; } });

const app = express();
app.use(express.json());
app.use('/api/definitions', require(path.join(API, 'routes', 'definitions')));

let pass = 0, fail = 0;
const t = (name, ok, extra) => { if (ok) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? '\n       ' + extra : '')); } };
const call = (port, method, url, body) => new Promise((res, rej) => {
  const data = body ? JSON.stringify(body) : '';
  const r = http.request({ host: '127.0.0.1', port, method, path: url, headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } }, (s) => {
    let raw = ''; s.on('data', (c) => (raw += c)); s.on('end', () => { let j = null; try { j = JSON.parse(raw); } catch (_) { j = null; } res({ status: s.statusCode, body: j }); });
  });
  r.on('error', rej); r.end(data);
});

(async () => {
  const srv = app.listen(0, '127.0.0.1'); await new Promise((r) => srv.once('listening', r));
  const port = srv.address().port;
  const reset = () => {
    SIGNALS = [];
    DEFS = { [DRAFT]: { definition_id: DRAFT, entity_id: SHOP, kind: 'offer', sub_kind: 'amount_off', name: 'Tea 5 off', status: 'draft', current_version: 1,
      rules: { amount: 5, scope: 'line', applies_to: { item_ids: [TEA] } } } };
  };
  console.log('\n== CTR-157: a saved definition rings the counter ==\n');

  reset();
  let r = await call(port, 'PUT', '/api/definitions/' + DRAFT, { status: 'live', confirmed: true });
  t('PUT status live answers 200', r.status === 200, JSON.stringify(r));
  t('...and the shop is told once, for this shop', SIGNALS.length === 1 && SIGNALS[0].entity === SHOP, JSON.stringify(SIGNALS));

  reset();
  r = await call(port, 'PUT', '/api/definitions/' + DRAFT, { status: 'paused' });
  t('a pause is heard too (the offer must leave the next bill)', r.status === 200 && SIGNALS.length === 1, JSON.stringify(SIGNALS));

  reset();
  r = await call(port, 'PUT', '/api/definitions/99999999-9999-4999-8999-999999999999', { status: 'live', confirmed: true });
  t('a save that finds nothing sends no signal', r.status === 404 && SIGNALS.length === 0, JSON.stringify({ r, SIGNALS }));

  reset();
  r = await call(port, 'POST', '/api/definitions', { kind: 'category', name: 'Tiffin' });
  t('a create still sends its signal', r.status === 201 && SIGNALS.length === 1, JSON.stringify(SIGNALS));

  srv.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
