/**
 * public-stock-visibility.test.cjs — THE PUBLIC STOCK DOORS OBEY THE SHOP'S VISIBILITY (TOP-CORRECT item 5, 2026-10-14).
 *
 * GET /api/integrations/stock/:handle and POST /api/integrations/ask/:handle/stock are anonymous. They answered ANY active shop —
 * a private storefront, a closed one, a `network`-only one — with its stamped stock, while the storefront itself (lib/catalogue-view
 * catalogueVisibility) said "nothing here". Now both ask the storefront's own reader, and a shop that is not open to an anonymous
 * caller is answered exactly like a handle that does not exist.
 *
 * Run: node tests/public-stock-visibility.test.cjs · no DB (a recording stand-in), no network beyond 127.0.0.1.
 */
'use strict';
const assert = require('assert'), path = require('path');
const API = path.join(__dirname, '..');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';

/* the shop: one row, its visibility and status set per case */
const shop = { identity_id: 'e1', bridge_id: 'B-SHOP', catalogue_visibility: 'public', plan: 'free', params_override: {}, business_status: 'open' };
const seen = [];
const q = async (sql, params) => {
  const s = String(sql).replace(/\s+/g, ' '); seen.push(s);
  if (/SELECT identity_id FROM identities WHERE \(user_id = \$1 OR bridge_id = \$1\)/.test(s)) return { rows: params[0] === 'shop' ? [{ identity_id: 'e1' }] : [] };
  if (/SELECT catalogue_visibility, plan, params_override, bridge_id, business_status FROM identities/.test(s)) return { rows: [Object.assign({}, shop)] };
  if (/FROM cb_entity/.test(s)) return { rows: [{ same: false }] };
  return { rows: [] };
};
const dbPath = require.resolve(path.join(API, 'db'));
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: {
  query: q, pool: { query: q }, withEntity: async (id, fn) => fn({ query: async (sql) => { seen.push('withEntity: ' + String(sql).replace(/\s+/g, ' ')); return { rows: [{ item_id: 'i1', avail: 3 }] }; } }),
  withTransaction: async (fn) => fn({ query: q }), trySavepoint: async (db, fn, fb) => { try { return await fn(db); } catch (_) { return fb; } } } };
const authPath = require.resolve(path.join(API, 'middleware', 'auth'));
const fakeAuth = Object.assign((req, res, next) => { req.identity = { identity_id: 'e1', identity_type: 'entity' }; next(); },
  { entityOf: (req) => req.identity.identity_id, requireScope: () => (req, res, next) => next() });
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: fakeAuth };

const express = require('express');
const app = express(); app.use(express.json());
app.use('/api/integrations', require(path.join(API, 'routes', 'integrations')));

let pass = 0, fail = 0;
const it = async (name, fn) => { try { await fn(); pass++; console.log('  ok  ' + name); } catch (e) { fail++; console.log('  XX  ' + name + ' — ' + e.message); } };

const srv = app.listen(0, '127.0.0.1', async () => {
  const base = 'http://127.0.0.1:' + srv.address().port + '/api/integrations';
  const get = async (h) => { seen.length = 0; const r = await fetch(base + '/stock/' + h); return { status: r.status, body: await r.json() }; };
  const ask = async (h) => { seen.length = 0; const r = await fetch(base + '/ask/' + h + '/stock', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"codes":["A1"]}' }); return { status: r.status, body: await r.json() }; };
  const set = (vis, status) => { shop.catalogue_visibility = vis; shop.business_status = status || 'open'; };
  try {
    console.log('\npublic stock · the storefront\'s visibility rule, at both doors');
    const none = await get('nobody');
    await it('an unknown handle: 404 Not found, nothing read beyond the handle lookup', async () => {
      // API-1 slice 1c: the 404 is the one Problem body now; private shops are still compared to it byte for byte below
      assert.strictEqual(none.status, 404); assert.strictEqual(none.body.code, 'NOT_FOUND'); assert.ok(none.body.error, 'no error sentence');
      assert.strictEqual(seen.filter((s) => /withEntity/.test(s)).length, 0);
    });
    await it('a PUBLIC shop: 200 with its stamped figures', async () => {
      set('public'); const r = await get('shop');
      assert.strictEqual(r.status, 200); assert.deepStrictEqual(r.body.stock, [{ item_id: 'i1', avail: 3 }]);
      assert.ok(seen.some((s) => /catalogue_visibility/.test(s)), 'the visibility was never read');
    });
    await it('⛔ a PRIVATE shop: 404, the SAME answer as no shop — and its stock is never read', async () => {
      set('private'); const r = await get('shop');
      assert.strictEqual(r.status, 404, JSON.stringify(r.body)); assert.deepStrictEqual(r.body, none.body);
      assert.strictEqual(seen.filter((s) => /withEntity/.test(s)).length, 0, 'the stock was read before the gate');
    });
    await it('⛔ a CLOSED shop (shutter down, whatever it chose): 404', async () => {
      set('public', 'closed'); const r = await get('shop'); assert.strictEqual(r.status, 404, JSON.stringify(r.body));
    });
    await it('⛔ a `network`-only shop is private to an anonymous caller: 404', async () => {
      set('network'); const r = await get('shop'); assert.strictEqual(r.status, 404, JSON.stringify(r.body));
    });
    await it('the ask door obeys the same rule: private → 404; public → 200 (no connector listening here)', async () => {
      set('private'); const no = await ask('shop'); assert.strictEqual(no.status, 404, JSON.stringify(no.body)); assert.deepStrictEqual(no.body, none.body);
      set('public'); const ok = await ask('shop'); assert.strictEqual(ok.status, 200, JSON.stringify(ok.body)); assert.strictEqual(ok.body.asked, false);
    });
  } finally { srv.close(); }
  console.log('\n' + (fail ? '✗ ' + fail + ' failed, ' : '✓ ') + pass + ' passed · ' + (pass + fail) + ' checks\n');
  /* exitCode, not exit(): exit() while the closing server socket is mid-close aborts Node 24 on Windows (UV_HANDLE_CLOSING, src/win/async.c:94) */
  process.exitCode = fail ? 1 : 0;
  if (srv.closeAllConnections) srv.closeAllConnections();
});
