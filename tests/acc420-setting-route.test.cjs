#!/usr/bin/env node
// @type: unit
/**
 * tests/acc420-setting-route.test.cjs — POST /api/books/setting CALLED THROUGH THE LIVE ROUTE (ACC-420 / 1138 proof Finding 1): the contract carries pack_version and pack_from, so a valid restamp answers 200
 * with the stamp in the answer, and a backward restamp or a day that is not a period start is refused in words. Before the fix the closed body refused both keys: every restamp answered 422.
 * Expected values written first: restamp 1.0.0 -> 1.0.1 from 2026-10-01 (a period start) = 200, pack_version {from, version '1.0.1', was '1.0.0'}; 1.0.0 -> 1.0.0 (backward/same) = 422 BOOKS_PACK_BACKWARD;
 * 1.0.1 from 2026-10-15 (not a period start) = 422 BOOKS_PACK_FROM; no pack keys = 200 with pack_version null (the old answer, key added).
 * OWNS the route-level proof that the route contract (lib/books-contract.js POST /setting) lets the restamp door in. CALLED BY CI (scripts/guards-list-4.cjs). No database, no network: the shop, the store and the auth seat are stubbed; the router, its schema check and the restamp rules are the real ones.
 * Mutation (the proof it bites): drop 'pack_version', 'pack_from' from the contract body -> the first check goes red (422).
 */
'use strict';
const assert = require('assert'), http = require('http'), path = require('path');
process.env.NODE_ENV = 'test'; process.env.DATABASE_URL = ''; process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
const load = (rel) => require(path.join(__dirname, '..', rel));
const put = (rel, exports) => { const id = require.resolve(path.join(__dirname, '..', rel)); require.cache[id] = { id, filename: id, loaded: true, exports }; };

const Reg = load('lib/regulation');
const AU0 = Reg.packFor('AU', '1.0.0');
const AU1 = Object.assign({}, AU0, { version: '1.0.1', marker: 'new' });
const realFor = Reg.packFor.bind(Reg);
Reg.packFor = (c, v) => (String(c).toUpperCase() === 'AU' ? (v == null || v === '' || v === '1.0.1' ? AU1 : v === '1.0.0' ? AU0 : null) : realFor(c, v));

const E = 'aaaaaaaa-1111-4111-8111-111111111111';
const shop = { enabled: true, country: 'AU', fy_start_month: 7, functional_currency: 'AUD', walkin_grain: 'day', pack_version: '1.0.0' };
const logged = [], kept = [];
const auth = Object.assign((req, res, next) => next(), { entityOf: (req) => (req.identity && (req.identity.parent_entity_id || req.identity.identity_id)) || E });
put('middleware/auth.js', auth);
const Db = load('db'); Db.withEntity = async (e, fn) => fn({});
const S = load('lib/books-store'); S.settingOf = async () => shop; S.saveSetting = async () => {}; S.logChange = async (h, e, c) => { logged.push(c); };
load('lib/books-store-pack').addPackHistory = async (h, e, rows, v) => { kept.push({ rows, v }); };
load('lib/schema').hasColumn = async () => true;
load('lib/country-setup').gate = async () => ({ country: 'AU' });
load('lib/books-period').returnStateFor = async () => ({ periods: [{ start: '2026-07-01' }, { start: '2026-10-01' }, { start: '2027-01-01' }] });
load('lib/books-hooks').forget = () => {};
load('lib/books').settingOf = async () => shop;

const express = require('express');
const app = express();
app.use(express.json());
app.use((req, res, next) => { req.identity = { identity_id: E, identity_type: 'entity', role: 'owner' }; next(); });
app.use('/api/books', load('routes/books'));
let n = 0;
const ok = async (what, fn) => { try { await fn(); n++; console.log('  ok  ' + what); } catch (e) { console.log('  ✗ ' + what + '\n      ' + e.message); process.exitCode = 1; } };

(async () => {
  const server = http.createServer(app); await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const post = async (body) => { const r = await fetch('http://127.0.0.1:' + server.address().port + '/api/books/setting', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, b: await r.json().catch(() => null) }; };
  await ok('a valid restamp (1.0.1 from the period start 2026-10-01) answers 200 with the stamp in the answer', async () => {
    const r = await post({ pack_version: '1.0.1', pack_from: '2026-10-01' });
    assert.strictEqual(r.status, 200, r.status + ' ' + JSON.stringify(r.b).slice(0, 300));
    assert.deepStrictEqual([r.b.pack_version.version, r.b.pack_version.from, r.b.pack_version.was], ['1.0.1', '2026-10-01', '1.0.0']);
    assert.strictEqual(kept.length, 1); assert.ok(logged.some((c) => c.field === 'pack_version'));
  });
  await ok('a backward restamp (1.0.0 is not newer than what the shop reads) is refused in words, nothing kept', async () => {
    const before = kept.length, r = await post({ pack_version: '1.0.0', pack_from: '2027-01-01' });
    assert.ok(r.status >= 400 && r.status < 500, String(r.status));
    assert.ok(JSON.stringify(r.b).includes('BOOKS_PACK_BACKWARD'), JSON.stringify(r.b).slice(0, 300));
    assert.strictEqual(kept.length, before);
  });
  await ok('a day that is not the first day of a tax period is refused in words, nothing kept', async () => {
    const before = kept.length, r = await post({ pack_version: '1.0.1', pack_from: '2026-10-15' });
    assert.ok(r.status >= 400 && r.status < 500, String(r.status));
    assert.ok(JSON.stringify(r.b).includes('BOOKS_PACK_FROM'), JSON.stringify(r.b).slice(0, 300));
    assert.strictEqual(kept.length, before);
  });
  await ok('no pack keys: the old call still answers 200, pack_version null', async () => {
    const r = await post({ walkin_grain: 'shift' });
    assert.strictEqual(r.status, 200, JSON.stringify(r.b)); assert.strictEqual(r.b.pack_version, null);
  });
  console.log(n + ' checks'); server.close(); setTimeout(() => process.exit(process.exitCode || 0), 200);
})();
