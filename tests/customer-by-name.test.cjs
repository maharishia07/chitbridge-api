'use strict';
/**
 * customer-by-name.test.cjs — POST /customers { name } adds a customer who is NOT on ChitBridge (Athi, 2026-10-02:
 * "we cannot raise a credit without the name … as a named customer"). Offline: the real router and the real
 * lib/local-identity.mint run against an in-memory stand-in for db, so nothing here needs Postgres.
 * Run: node tests/customer-by-name.test.cjs
 */
const assert = require('assert'), path = require('path'), http = require('http'), fs = require('fs');
const API = path.join(__dirname, '..');
let pass = 0;
const ita = async (what, fn) => { try { await fn(); pass++; console.log('  ok  ' + what); } catch (e) { console.log('  FAIL ' + what + '\n      ' + e.message); process.exitCode = 1; } };

/* ── the stand-in database: identities + customer_list, recognised by their SQL ── */
const ids = [ { identity_id: 'S1', bridge_id: 'B-S1', display_name: 'Acme Traders', user_id: 'acmetraders' },
              { identity_id: 'S2', bridge_id: 'B-S2', display_name: 'Bharat Stores', user_id: 'bharatstores' } ];
const custs = [];
let current = 'S1';
const fold = (n) => String(n).trim().replace(/\s+/g, ' ').toLowerCase();
async function run(sql, p) {
  sql = String(sql).replace(/\s+/g, ' ');
  if (/^SELECT user_id, bridge_id FROM identities WHERE identity_id/.test(sql)) return { rows: ids.filter((i) => i.identity_id === p[0]) };
  if (/FROM identities WHERE parent_entity_id = \$1 AND user_id LIKE/.test(sql))
    return { rows: ids.filter((i) => i.parent_entity_id === p[0] && i.user_id.startsWith(p[1].replace('%', '')) && fold(i.display_name) === p[2]) };
  if (/^SELECT user_id FROM identities WHERE user_id LIKE/.test(sql))
    return { rows: ids.filter((i) => i.user_id.startsWith(p[0].replace('%', ''))).sort((a, b) => b.user_id.length - a.user_id.length || (a.user_id < b.user_id ? 1 : -1)).slice(0, 1) };
  if (/^INSERT INTO identities/.test(sql)) { const r = { identity_id: 'N' + ids.length, bridge_id: p[0], display_name: p[1], user_id: p[2], parent_entity_id: p[3] }; ids.push(r); return { rows: [r] }; }
  if (/^UPDATE identities SET otp_contact/.test(sql)) { const r = ids.find((i) => i.identity_id === p[0] && i.parent_entity_id === p[3]); if (p[1]) r.otp_contact = p[1]; if (p[2]) r.gstn = p[2]; return { rows: [] }; }
  if (/^SELECT identity_id, display_name, user_id, bridge_id FROM identities WHERE bridge_id/.test(sql)) return { rows: [] };
  if (/^INSERT INTO customer_list/.test(sql)) {
    if (custs.find((c) => c.o === p[0] && c.c === p[1])) return { rows: [] };
    custs.push({ o: p[0], c: p[1] }); return { rows: [{ customer_list_id: 'CL' + custs.length }] };
  }
  throw new Error('unexpected SQL: ' + sql.slice(0, 80));
}
const fakeDb = { query: run };
const dbPath = require.resolve(path.join(API, 'db'));
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: {
  query: run, withEntity: async (o, fn) => fn(fakeDb), trySavepoint: async (db, fn, fb) => { try { return await fn(); } catch (_) { return fb; } } } };
const authPath = require.resolve(path.join(API, 'middleware', 'auth'));
const authFn = (req, res, next) => { req.identity = { identity_id: current }; next(); };
authFn.entityOf = (req) => req.identity.identity_id;
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: authFn };

const express = require('express');
const app = express(); app.use(express.json()); app.use('/', require(path.join(API, 'routes', 'relationships.js')));

function post(port, body) {
  return new Promise((resolve, reject) => {
    const d = JSON.stringify(body);
    const r = http.request({ port, method: 'POST', path: '/customers', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(d) } },
      (res) => { let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(b || '{}') })); });
    r.on('error', reject); r.end(d);
  });
}

(async () => {
  const srv = app.listen(0); const port = srv.address().port;
  await ita('add by name -> 200, minted ~owner.cus handle, on_rail false, one-sided in words', async () => {
    const first = await post(port, { name: 'Ravi Kumar', phone: '98400 12345', gstin: '33abcde1234f1z5' });
    assert.strictEqual(first.status, 200, JSON.stringify(first.body));
    const c = first.body.customer;
    assert.strictEqual(c.user_id, '~acmetraders.cus-0001');
    assert.strictEqual(c.display_name, 'Ravi Kumar');
    assert.strictEqual(c.on_rail, false);
    assert.strictEqual(c.one_sided.why, 'not on ChitBridge — bills stay with you');
    assert.strictEqual(c.added_via, 'manual');
  });
  await ita('phone and GSTIN land where the till customers query reads them (otp_contact, gstn)', async () => {
    const row = ids.find((i) => i.user_id === '~acmetraders.cus-0001');
    assert.strictEqual(row.otp_contact, '9840012345'); assert.strictEqual(row.gstn, '33ABCDE1234F1Z5');
    const till = fs.readFileSync(path.join(API, 'routes', 'till.js'), 'utf8');
    assert.ok(/i\.otp_contact AS phone, i\.gstn/.test(till), 'till snapshot no longer reads otp_contact/gstn');
    assert.ok(/FROM customer_list c/.test(till));
  });
  await ita('re-adding the same name (typed differently) -> 409 already in your customer list', async () => {
    const again = await post(port, { name: '  ravi   KUMAR ' });
    assert.strictEqual(again.status, 409);
    assert.ok(/already in your customer list/.test(again.body.message));
    assert.strictEqual(custs.length, 1);
  });
  await ita('neither handle nor name -> 400 in words', async () => {
    const r = await post(port, {});
    assert.strictEqual(r.status, 400);
    assert.ok(JSON.stringify(r.body).includes('Give a User ID or email for a ChitBridge business, or a name for a local customer'));
  });
  await ita('an email typed as a name is refused (mint fence)', async () => {
    assert.strictEqual((await post(port, { name: 'a@b.com' })).status, 400);
  });
  await ita('another shop cannot add it by its ~ handle -> 404', async () => {
    current = 'S2';
    const r = await post(port, { handle: '~acmetraders.cus-0001' });
    assert.strictEqual(r.status, 404);
    current = 'S1';
  });
  await ita('another shop adding the same NAME gets its own party', async () => {
    current = 'S2';
    const r = await post(port, { name: 'Ravi Kumar' });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.customer.user_id, '~bharatstores.cus-0001');
    current = 'S1';
  });
  await ita('ONE-SIDED: mayTrade refuses a minted customer, so the till offers no entity_id and the bill is never sent', async () => {
    const istest = require(path.join(API, 'lib', 'istest.js'));
    const minted = ids.find((i) => i.user_id === '~acmetraders.cus-0001');
    const stub = { query: async () => ({ rows: [{ display_name: minted.display_name, status: 'active', user_id: minted.user_id, on_rail: false, same_world: true }] }) };
    const t = await istest.mayTrade('S1', minted.identity_id, stub);
    assert.strictEqual(t.ok, false); assert.ok(/not on ChitBridge/.test(t.why));
    assert.ok(/mayTradeSql\('i', '\$1'\)/.test(fs.readFileSync(path.join(API, 'routes', 'till.js'), 'utf8')), 'snapshot rail_entity_id must come from mayTradeSql');
    assert.ok(require(path.join(API, 'lib', 'handle.js')).isMinted(minted.user_id));
  });
  srv.close();
  console.log(pass + ' checks passed');
})();
