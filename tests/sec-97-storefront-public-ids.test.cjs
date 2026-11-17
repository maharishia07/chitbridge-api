/**
 * tests/sec-97-storefront-public-ids.test.cjs — SEC-97 (C12, 2026-11-12): the storefront routes keyed by a shop id.
 * The generator called five of them a foreign-id leak ("another shop's id answers 200/422/403, an unknown id 404"). The decision (cb-security + cb-api): the id is a PUBLISHED
 * bridge_id / network id, public by design, exactly as the sibling doors already listed in docs/contracts/api-hardening-scope.json public_ids (GET /:bridge_id, order/start,
 * support/start, network-store GET). So this test holds both halves:
 *   1. the register's rule: foreign_id_404 does NOT apply to the five (tools/api-register hardeningApplies) — red on main, where it applied and the register showed a pass over a generated failure;
 *   2. the behaviour that makes "public by design" true: an UNKNOWN shop is answered ONE way across the whole family (the same 404 NOT_FOUND as GET /:bridge_id), and an unknown
 *      network the same 404 NO_SUCH_NETWORK; nothing about a shop's existence is told beyond what GET /api/catalogue/:bridge_id already publishes.
 * Run: node tests/sec-97-storefront-public-ids.test.cjs · no network beyond 127.0.0.1, no DB (db stubbed: every read finds nothing).
 */
'use strict';
const path = require('path');
const http = require('http');
const express = require('express');

process.env.JWT_SECRET = 'test-only-secret-sec-97';
process.env.NETWORK_ORDERS = '1';
const API = path.join(__dirname, '..');
let pass = 0, fail = 0;
const t = (name, ok, extra) => { if (ok) { pass++; console.log('  ok  ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? '\n       ' + extra : '')); } };

const FIVE = [
  ['GET', '/api/catalogue/:bridge_id/support/preview'],
  ['POST', '/api/catalogue/:bridge_id/login/verify'],
  ['POST', '/api/catalogue/:bridge_id/support'],
  ['POST', '/api/catalogue/:bridge_id/order/confirm'],
  ['POST', '/api/catalogue/network-store/:networkId/order']
];

/* ── 1 · the register's rule ── */
const reg = require(path.join(API, 'tools', 'api-register.cjs'));
const scope = reg.hardeningScope();
for (const [method, route] of FIVE) {
  const applies = reg.hardeningApplies({ method, path: route, fns: [] }, null, scope);
  t(method + ' ' + route + ' → foreign_id_404 does not apply (a published id)', applies.foreign_id_404 === false && scope.publicIds.has(method + ' ' + route));
}
const stranger = reg.hardeningApplies({ method: 'GET', path: '/api/chits/:chit_id', fns: [] }, null, scope);
t('control: a shop-owned id (GET /api/chits/:chit_id) is STILL held to foreign_id_404', stranger.foreign_id_404 === true);

/* ── 2 · the behaviour: an unknown shop is answered one way ── */
const q = async () => ({ rows: [], rowCount: 0 });
const stub = (rel, exports) => { const p = require.resolve(path.join(API, rel)); require.cache[p] = { id: p, filename: p, loaded: true, exports }; };
stub('db', { query: q, withEntity: async (id, fn) => fn({ query: q }), withTransaction: async (fn) => fn({ query: q }), readBatch: async () => ({}), trySavepoint: async (d, fn) => fn() });
stub('lib/schema', { hasColumn: async () => true, has: async () => true, hasTable: async () => false, columns: async () => [], table: async () => ({}) });
const app = express();
app.use(express.json());
app.use('/api/catalogue', require(path.join(API, 'routes', 'catalogue')));
let base;
const call = (method, url, body) => new Promise((resolve, reject) => {
  const data = body ? JSON.stringify(body) : null;
  const h = { 'content-type': 'application/json', 'idempotency-key': 'sec97-' + Math.random().toString(36).slice(2) };
  if (data) h['content-length'] = Buffer.byteLength(data);
  const r = http.request(base + url, { method, headers: h }, (res) => {
    let s = ''; res.on('data', (c) => { s += c; });
    res.on('end', () => { let j = null; try { j = JSON.parse(s); } catch (_) { /* shown raw below */ } resolve({ status: res.statusCode, body: j, raw: s.slice(0, 200) }); });
  });
  r.on('error', reject); if (data) r.write(data); r.end();
});
const SHOP = 'no-such-shop', CONTACT = { phone: '+919876543210', otp: '123456' };

(async () => {
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + server.address().port;
  try {
    const reference = await call('GET', '/api/catalogue/' + SHOP);
    t('reference: the public door GET /:bridge_id answers an unknown shop 404 NOT_FOUND', reference.status === 404 && reference.body && reference.body.code === 'NOT_FOUND', reference.raw);
    const sameAs = async (label, method, url, body) => {
      const r = await call(method, url, body);
      t(label + ' → the unknown shop is the family\'s 404 (status ' + r.status + ')', r.status === 404 && r.body && reference.body && r.body.code === reference.body.code, r.raw);
    };
    await sameAs('GET  :bridge_id/support/preview', 'GET', '/api/catalogue/' + SHOP + '/support/preview');
    await sameAs('POST :bridge_id/login/verify', 'POST', '/api/catalogue/' + SHOP + '/login/verify', CONTACT);
    await sameAs('POST :bridge_id/support', 'POST', '/api/catalogue/' + SHOP + '/support', Object.assign({ observed: 'It broke' }, CONTACT));
    await sameAs('POST :bridge_id/order/confirm', 'POST', '/api/catalogue/' + SHOP + '/order/confirm', Object.assign({ line_items: [{ particulars: 'Rice', quantity: 1, unit: 'kg' }] }, CONTACT));
  } finally {
    await new Promise((r) => server.close(r));
  }
  console.log(`\n${pass + fail} checks · ${pass} passed · ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
