/**
 * tests/idem3-till-reward.test.cjs — the counter's two points writes are SAFE TO REPEAT (contract pass, 7 Nov 2026).
 * POST /api/till/reward and POST /api/till/reward/claim move points; a retry that lost its answer must not move them twice.
 * Both sit behind the ONE gate (middleware/idempotency requireKey, bearer form) and the counter sends the key (tools/tally-connector/till.html tillKeyOf).
 * Hand-computed, per route: no key → 422 IDEMPOTENCY_KEY_REQUIRED and 0 settlements · key K1 → 1 settlement · K1 again, same body → the first answer, still 1
 * · K1 with another body → 422 IDEMPOTENCY_CONFLICT, still 1 · a claim with no ref (it stamps Date.now()) retried under K1 → still 1 move.
 * Offline: the real routes/till.js, the real gate on its in-memory store (no table), reward-store counted.
 * Run: node tests/idem3-till-reward.test.cjs
 */
'use strict';
const path = require('path');
const http = require('http');
const express = require('express');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
const HERE = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const mock = (relative, exported) => { const file = require.resolve(path.join(HERE, relative)); require.cache[file] = { id: file, filename: file, loaded: true, exports: exported }; };

const SHOP = '11111111-1111-4111-8111-111111111111';
const realAuth = require(path.join(HERE, 'middleware', 'auth'));
const { holderOf } = require(path.join(HERE, 'lib', 'holder'));
mock('middleware/auth', Object.assign((req, res, next) => {
  req.identity = { identity_id: SHOP, identity_type: 'entity', display_name: 'Test shop' };
  req.api_key = { jti: 'j1', scopes: ['till'] };
  req.till = holderOf({ kind: 'api_key', jti: 'j1', scopes: ['till'] }, null, null);
  next();
}, realAuth, { entityOf: (req) => req.identity.identity_id }));
const missing = () => Object.assign(new Error('relation "idempotency_key" does not exist'), { code: '42P01' });
const db = { query: async () => { throw missing(); }, withEntity: async () => { throw missing(); }, withTransaction: async () => { throw missing(); }, trySavepoint: async (h, run, fallback) => run().catch(() => fallback) };
mock('db', new Proxy(db, { get: (t, n) => (n in t ? t[n] : typeof n === 'symbol' || n === 'then' ? undefined : async () => ({ rows: [], rowCount: 0 })) }));
mock('db/index', require('../db'));

const store = require(path.join(HERE, 'lib', 'reward-store'));
let settled = 0, claimed = 0, billThere = true;
store.programme = async () => ({ name: 'Points', walk_in_earns: true });
store.settle = async () => { if (!billThere) throw Object.assign(new Error('no bill'), { code: 'BILL_NOT_RECORDED', say: 'The bill has not arrived yet.' }); settled++; return { before: { points: 100 }, added: 10 }; };
store.claim = async () => { claimed++; return { ok: true, points: 40 }; };
console.error = () => undefined; console.warn = () => undefined;

const call = (port, p, body, key) => new Promise((done) => {
  const b = JSON.stringify(body);
  const headers = Object.assign({ 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b) }, key ? { 'Idempotency-Key': key } : {});
  const r = http.request({ host: '127.0.0.1', port, path: p, method: 'POST', headers }, (res) => {
    let raw = ''; res.on('data', (c) => (raw += c));
    res.on('end', () => { let j = {}; try { j = JSON.parse(raw || '{}'); } catch (_) { /* reads as {} */ } done({ status: res.statusCode, headers: res.headers, body: j }); });
  });
  r.end(b);
});

(async () => {
  console.log('\n══ idem3 · the counter points writes are safe to repeat ══');
  const app = express();
  app.use(express.json());
  app.use('/api/till', require(path.join(HERE, 'routes', 'till')));
  const srv = app.listen(0);
  const port = srv.address().port;
  try {
    const reward = { ref: 'C1/26-27/0009', holder: { scheme: 'phone', value: '9840012345' }, spend: 0 };
    const bare = await call(port, '/api/till/reward', reward);
    ok('reward · no key → 422 IDEMPOTENCY_KEY_REQUIRED', bare.status === 422 && bare.body.code === 'IDEMPOTENCY_KEY_REQUIRED', bare.status + ' ' + JSON.stringify(bare.body).slice(0, 200));
    ok('reward · …and nothing settled', settled === 0, 'settled ' + settled);
    const first = await call(port, '/api/till/reward', reward, 'K1');
    ok('reward · key K1 → 200, settled once', first.status === 200 && settled === 1, first.status + ' settled ' + settled);
    const again = await call(port, '/api/till/reward', reward, 'K1');
    ok('reward · K1 again → the first answer, marked a replay, still settled once', again.status === 200 && JSON.stringify(again.body) === JSON.stringify(first.body) && again.headers['x-idempotent-replay'] === 'true' && settled === 1, 'settled ' + settled);
    const other = await call(port, '/api/till/reward', Object.assign({}, reward, { spend: 5 }), 'K1');
    ok('reward · K1 with another body → 422 IDEMPOTENCY_CONFLICT, still once', other.status === 422 && other.body.code === 'IDEMPOTENCY_CONFLICT' && settled === 1, other.status + ' ' + JSON.stringify(other.body).slice(0, 200));

    billThere = false;
    const early = Object.assign({}, reward, { ref: 'C1/26-27/0010' });
    const wait = await call(port, '/api/till/reward', early, 'K3');
    billThere = true;
    const later = await call(port, '/api/till/reward', early, 'K3');
    ok('reward · 409 BILL_NOT_RECORDED is not the keys answer: the same key sent after the bill lands settles once', wait.status === 409 && later.status === 200 && later.headers['x-idempotent-replay'] !== 'true' && settled === 2, wait.status + ' ' + later.status + ' settled ' + settled);

    const claim = { from: { scheme: 'phone', value: '9840012345' }, to: { scheme: 'identity', value: SHOP } };
    const cBare = await call(port, '/api/till/reward/claim', claim);
    ok('claim · no key → 422 IDEMPOTENCY_KEY_REQUIRED, nothing moved', cBare.status === 422 && cBare.body.code === 'IDEMPOTENCY_KEY_REQUIRED' && claimed === 0, cBare.status + ' moved ' + claimed);
    const cFirst = await call(port, '/api/till/reward/claim', claim, 'K2');
    ok('claim · key K2 → 200, 40 moved once', cFirst.status === 200 && cFirst.body.moved === 40 && claimed === 1, cFirst.status + ' moved ' + claimed);
    const cAgain = await call(port, '/api/till/reward/claim', claim, 'K2');
    ok('claim · K2 again (no ref, so the server stamps a new one) → the first answer, still ONE move', cAgain.status === 200 && JSON.stringify(cAgain.body) === JSON.stringify(cFirst.body) && claimed === 1, 'moved ' + claimed);
    const cOther = await call(port, '/api/till/reward/claim', Object.assign({}, claim, { ref: 'x' }), 'K2');
    ok('claim · K2 with another body → 422 IDEMPOTENCY_CONFLICT, still one move', cOther.status === 422 && cOther.body.code === 'IDEMPOTENCY_CONFLICT' && claimed === 1, cOther.status);
  } finally { srv.close(); }
  console.log('\n  ' + (fail ? '✗' : '✓') + ' ' + pass + ' passed · ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})();
