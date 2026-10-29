'use strict';
/**
 * tests/sec101-iddoc-hash.test.cjs - SEC-101: a national ID (Aadhaar, store:false) is stored as a KEYED hash, never sha256(SCHEME:value).
 * A 12-digit number is a 10^12 space: a plain hash in a database dump is the number, offline. PHONE and EMAIL keep the plain hash
 * (sign-in recomputes it) and must stay byte for byte what main computes. No DB, no network: db, schema and auth are stubbed,
 * the route runs for real over http. Values are obviously fake. Run: node tests/sec101-iddoc-hash.test.cjs
 * MIN contract - the PUT answer shape (200 body without any hash, 503 VAULT_ENC_UNCONFIGURED) is asserted below.
 */
const assert = require('assert'), crypto = require('crypto'), http = require('http');
const KEY_A = '11'.repeat(32), KEY_B = '22'.repeat(32); // fixed fake 32-byte keys, inside this process only
const AADHAAR = '000000000000', PHONE = '000000000001', EMAIL = 'nobody@example.invalid';
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const stub = (mod, exports) => { const p = require.resolve(mod); require.cache[p] = { id: p, filename: p, loaded: true, exports }; };

const TABLE = []; // identity_documents rows, written by the route's INSERT
const rowsFor = (sql, p) => sql.includes('FROM identity_documents')
  ? TABLE.filter((r) => r.scheme === p[0] && p[1].includes(r.value_hash) && r.status === 'verified').map((r) => ({ identity_id: r.identity_id }))
  : null;
const fakeQuery = async (sql, p) => {
  if (sql.includes('SELECT country FROM identities')) return { rows: [{ country: 'IN' }] };
  const hit = rowsFor(sql, p || []); if (hit) return { rows: hit };
  if (sql.includes('FROM identities WHERE identity_id = $1')) return { rows: [{ identity_id: p[0], identity_type: 'entity' }] };
  return { rows: [] };
};
const withEntity = async (_e, fn) => fn({ query: async (sql, p) => {
  if (!sql.startsWith('INSERT INTO identity_documents')) return { rows: [] };
  const [identity_id, , , scheme, value_masked, value_hash, value_enc] = p;
  const old = TABLE.findIndex((r) => r.identity_id === identity_id && r.scheme === scheme);
  const row = { identity_id, scheme, value_masked, value_hash, value_enc, status: 'pending' };
  if (old >= 0) TABLE[old] = row; else TABLE.push(row);
  return { rows: [{ scheme, value_masked, status: 'pending', submitted_by: 'self' }] };
} });
stub('../db', { query: fakeQuery, withEntity, withTransaction: async (fn) => fn({ query: fakeQuery }) });
stub('../lib/schema', { hasTable: async () => true, hasColumn: async () => true, hasColumns: async () => true, checkAllows: async () => true });
const authFn = (req, _res, next) => { req.identity = { identity_id: 'ent-1', identity_type: 'entity' }; next(); };
authFn.entityOf = () => 'ent-1';
stub('../middleware/auth', authFn);

const routes = require('../routes/identity-docs');
const express = require('express');
const app = express(); app.use(express.json()); app.use('/', routes);

let pass = 0, queue = Promise.resolve();
const it = (what, fn) => { queue = queue.then(async () => { try { await fn(); pass++; console.log('  ok  ' + what); } catch (e) { console.log('  FAIL ' + what + '\n      ' + e.message); process.exitCode = 1; } }); };
let server, port;
const put = (scheme, value) => new Promise((resolve, reject) => {
  const data = JSON.stringify({ value });
  const r = http.request({ port, method: 'PUT', path: '/documents/' + scheme, headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } }, (res) => {
    let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => resolve({ status: res.statusCode, text: b, body: b ? JSON.parse(b) : {} }));
  });
  r.on('error', reject); r.end(data);
});
const rowOf = (scheme) => TABLE.find((r) => r.scheme === scheme);
const setKey = (k) => { if (k) process.env.VAULT_ENC_KEY = k; else delete process.env.VAULT_ENC_KEY; };

it('listen', async () => { await new Promise((ok) => { server = app.listen(0, () => { port = server.address().port; ok(); }); }); });

it('Aadhaar: the stored hash is NOT sha256(AADHAAR:value) and is 64 hex', async () => {
  setKey(KEY_A);
  const r = await put('AADHAAR', AADHAAR); assert.strictEqual(r.status, 200, r.text);
  const h = rowOf('AADHAAR').value_hash;
  assert.notStrictEqual(h, sha('AADHAAR:' + AADHAAR));
  assert.ok(/^[0-9a-f]{64}$/.test(h));
  assert.strictEqual(rowOf('AADHAAR').value_enc, null, 'the number itself is still not stored');
});
it('Aadhaar: no value_hash or key reaches the answer', async () => {
  const r = await put('AADHAAR', AADHAAR);
  assert.ok(!r.text.includes(rowOf('AADHAAR').value_hash) && !/hash/i.test(r.text) && !r.text.includes(KEY_A));
});
it('Aadhaar: the same value hashes the same twice (still the same document)', async () => {
  setKey(KEY_A); await put('AADHAAR', AADHAAR); const a = rowOf('AADHAAR').value_hash;
  await put('AADHAAR', AADHAAR); assert.strictEqual(rowOf('AADHAAR').value_hash, a);
  assert.strictEqual(TABLE.filter((r) => r.scheme === 'AADHAAR').length, 1);
  assert.strictEqual(routes.docHash('AADHAAR', AADHAAR), a);
});
it('Aadhaar: a different value gives a different hash', async () => {
  assert.notStrictEqual(routes.docHash('AADHAAR', '000000000002'), routes.docHash('AADHAAR', AADHAAR));
});
it('Aadhaar: a different VAULT_ENC_KEY gives a different hash', async () => {
  setKey(KEY_A); const a = routes.docHash('AADHAAR', AADHAAR);
  setKey(KEY_B); const b = routes.docHash('AADHAAR', AADHAAR);
  assert.notStrictEqual(a, b);
});
it('Aadhaar: a legacy row (sha256 of SCHEME:value) is still recognised as the same document; a stranger is not', async () => {
  setKey(KEY_A);
  const legacy = sha('AADHAAR:' + AADHAAR);
  assert.ok(routes.sameDocument('AADHAAR', AADHAAR, legacy), 'legacy');
  assert.ok(routes.sameDocument('AADHAAR', AADHAAR, routes.docHash('AADHAAR', AADHAAR)), 'keyed');
  assert.ok(!routes.sameDocument('AADHAAR', '000000000002', legacy), 'another number');
  assert.deepStrictEqual(routes.docHashes('AADHAAR', AADHAAR), [routes.docHash('AADHAAR', AADHAAR), legacy], 'a write stores the first only');
});
it('no key: an Aadhaar is refused 503 VAULT_ENC_UNCONFIGURED and nothing is stored', async () => {
  setKey(null); TABLE.length = 0;
  const r = await put('AADHAAR', AADHAAR);
  assert.strictEqual(r.status, 503); assert.strictEqual(r.body.code, 'VAULT_ENC_UNCONFIGURED'); assert.strictEqual(TABLE.length, 0);
  assert.throws(() => routes.docHash('AADHAAR', AADHAAR), (e) => e.status === 503 && e.code === 'VAULT_ENC_UNCONFIGURED');
});
it('PHONE and EMAIL: byte for byte sha256(SCHEME:value), with and without a key', async () => {
  for (const k of [null, KEY_A]) {
    setKey(k);
    assert.strictEqual(routes.docHash('PHONE', PHONE), sha('PHONE:' + PHONE));
    assert.strictEqual(routes.docHash('PHONE', '+' + PHONE), sha('PHONE:+' + PHONE));
    assert.strictEqual(routes.docHash('EMAIL', EMAIL), sha('EMAIL:' + EMAIL));
    assert.deepStrictEqual(routes.docHashes('PHONE', PHONE), [sha('PHONE:' + PHONE)]);
  }
});
it('PHONE and EMAIL through the route are stored with the unchanged hash', async () => {
  setKey(KEY_A); TABLE.length = 0;
  assert.strictEqual((await put('PHONE', PHONE)).status, 200); assert.strictEqual(rowOf('PHONE').value_hash, sha('PHONE:' + PHONE));
  assert.strictEqual((await put('EMAIL', EMAIL)).status, 200); assert.strictEqual(rowOf('EMAIL').value_hash, sha('EMAIL:' + EMAIL));
});
it('sign-in by a verified phone and e-mail (identity-auth) still finds the person', async () => {
  setKey(KEY_A);
  for (const r of TABLE) { r.status = 'verified'; r.verified_at = 'x'; r.identity_id = 'person-1'; }
  delete require.cache[require.resolve('../lib/identity-auth')];
  const ia = require('../lib/identity-auth');
  const byPhone = await ia.findLoginIdentity(fakeQuery, PHONE);
  assert.ok(byPhone.identity && byPhone.identity.identity_id === 'person-1', JSON.stringify(byPhone));
  const byMail = await ia.findLoginIdentity(fakeQuery, EMAIL);
  assert.ok(byMail.identity && byMail.identity.identity_id === 'person-1', JSON.stringify(byMail));
});
it('the device-key phone match (keys.js) computes the same PHONE hashes the PUT stored', async () => {
  setKey(KEY_A);
  const keys = require('../routes/keys');
  assert.ok(keys.assignedHashes(PHONE).includes(rowOf('PHONE').value_hash));
  assert.ok(keys.assignedHashes('+' + PHONE).includes(rowOf('PHONE').value_hash));
});
it('close', async () => { await new Promise((ok) => server.close(ok)); console.log('\n' + pass + ' checks'); process.exit(process.exitCode || 0); });
