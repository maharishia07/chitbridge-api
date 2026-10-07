/**
 * tests/jwt-rotation.test.cjs — E10: the signing secret can be rotated without signing anybody out.
 *
 * Proved against the REAL middleware/auth.js and the REAL lib/jwt-verify.js (db stubbed). The request log's `kind` is read from
 * res.locals, exactly where server.js reads it.
 *   · a token signed with JWT_SECRET_PREV → next() (200), logged kind:'rotated'
 *   · a token signed with neither          → 401 TOKEN_INVALID
 *   · JWT_SECRET_PREV UNSET: byte-for-byte today — the 401 body has no `code`, a PREV-signed token is refused, kind unchanged
 *   · an expired token stays expired, PREV or not; signToken signs with JWT_SECRET only; one verifier in the tree
 *
 * Run: node tests/jwt-rotation.test.cjs · no network, no DB.
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');

const NEW = 'new-secret-at-least-32-characters-long-xxxx', OLD = 'old-secret-at-least-32-characters-long-xxxx';
process.env.JWT_SECRET = NEW;
delete process.env.JWT_SECRET_PREV;

const dbPath = require.resolve('../db');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: {
  query: async () => ({ rows: [], rowCount: 0 }), withEntity: async (id, fn) => fn({ query: async () => ({ rows: [] }) }),
  withTransaction: async (fn) => fn({ query: async () => ({ rows: [] }) }), readBatch: async () => ({}), trySavepoint: async (_d, fn) => fn() } };
const schemaPath = require.resolve('../lib/schema');
require.cache[schemaPath] = { id: schemaPath, filename: schemaPath, loaded: true,
  exports: { hasColumn: async () => true, has: async () => true, columns: async () => [], table: async () => ({}) } };
const auth = require('../middleware/auth');

let pass = 0;
const ita = (what, fn) => fn().then(() => { pass++; console.log('  ok  ' + what); },
  (e) => { console.log('  FAIL ' + what + '\n       ' + e.message); process.exitCode = 1; });

function call(token) {
  const req = { headers: {}, method: 'GET', originalUrl: '/api/chits', path: '/api/chits' };
  if (token) req.headers.authorization = 'Bearer ' + token;
  const out = { status: null, body: null, nexted: false };
  const res = { locals: {}, status: (n) => { out.status = n; return res; }, json: (b) => { out.body = b; return res; } };
  return auth(req, res, () => { out.nexted = true; }).then(() => ({ out, kind: res.locals.kind || null }));
}
const claims = { identity_id: 'shop1', identity_type: 'entity' };
const sign = (secret) => jwt.sign(claims, secret, { algorithm: 'HS256', expiresIn: '7d' });

(async () => {
  console.log('— PREV unset: exactly today —');
  await ita('a token signed with JWT_SECRET passes, logged legacy (no jti), as before', async () => {
    const r = await call(sign(NEW));
    assert.strictEqual(r.out.nexted, true); assert.strictEqual(r.kind, 'legacy');
  });
  await ita('a token signed with the OLD secret is refused, and the 401 body is byte-for-byte today (no code)', async () => {
    const r = await call(sign(OLD));
    assert.strictEqual(r.out.status, 401); assert.strictEqual(r.out.nexted, false);
    assert.strictEqual(JSON.stringify(r.out.body), JSON.stringify({ error: 'Unauthorised', message: 'Invalid token' }));
  });
  await ita('PREV set to an empty string is the same as unset', async () => {
    process.env.JWT_SECRET_PREV = '';
    const r = await call(sign(OLD));
    delete process.env.JWT_SECRET_PREV;
    assert.strictEqual(r.out.status, 401); assert.strictEqual(r.out.body.code, undefined);
  });
  await ita('the verifier throws what jwt.verify throws (same name and message)', async () => {
    const { verifyJwt } = require('../lib/jwt-verify');
    let a, b;
    const t = sign(OLD);
    try { jwt.verify(t, NEW, { algorithms: ['HS256'] }); } catch (e) { a = e; }
    try { verifyJwt(t); } catch (e) { b = e; }
    assert.ok(a && b); assert.strictEqual(b.name, a.name); assert.strictEqual(b.message, a.message);
  });

  console.log('— PREV set: the window —');
  process.env.JWT_SECRET_PREV = OLD;
  await ita('a token signed with PREV passes (200) and is logged kind:rotated', async () => {
    const r = await call(sign(OLD));
    assert.strictEqual(r.out.nexted, true); assert.strictEqual(r.out.status, null); assert.strictEqual(r.kind, 'rotated');
  });
  await ita('a token signed with the new JWT_SECRET still passes, not logged rotated', async () => {
    const r = await call(sign(NEW));
    assert.strictEqual(r.out.nexted, true); assert.notStrictEqual(r.kind, 'rotated');
  });
  await ita('a token signed with neither is 401 TOKEN_INVALID', async () => {
    const r = await call(sign('a-third-secret-at-least-32-characters-xxxxx'));
    assert.strictEqual(r.out.status, 401); assert.strictEqual(r.out.nexted, false);
    assert.strictEqual(r.out.body.code, 'TOKEN_INVALID');
  });
  await ita('an expired PREV-signed token is still expired: PREV never revives a token', async () => {
    const r = await call(jwt.sign(claims, OLD, { algorithm: 'HS256', expiresIn: -10 }));
    assert.strictEqual(r.out.status, 401); assert.match(r.out.body.message, /expired/i);
  });
  await ita('alg:none is still refused in the window', async () => {
    const h = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const b = Buffer.from(JSON.stringify(claims)).toString('base64url');
    const r = await call(h + '.' + b + '.');
    assert.strictEqual(r.out.nexted, false); assert.strictEqual(r.out.status, 401);
  });

  console.log('— one signer, one verifier —');
  await ita('signToken signs with JWT_SECRET only (a PREV-signed token never comes out)', async () => {
    const { signToken } = require('../lib/identity-auth');
    const t = signToken({ identity_id: 'shop1', identity_type: 'entity' }, null);
    jwt.verify(t, NEW, { algorithms: ['HS256'] });
    assert.throws(() => jwt.verify(t, OLD, { algorithms: ['HS256'] }));
  });
  delete process.env.JWT_SECRET_PREV;
  await ita('no file outside lib/jwt-verify.js verifies a JWT with JWT_SECRET', async () => {
    const root = path.join(__dirname, '..'), bad = [];
    const re = /\bjwt\.verify\(|require\(['"]jsonwebtoken['"]\)\.verify\(/;
    (function walk(d) {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        if (['node_modules', '.git', 'tests', 'tools'].includes(e.name)) continue;
        const p = path.join(d, e.name), rel = path.relative(root, p).replace(/\\/g, '/');
        if (e.isDirectory()) walk(p);
        else if (/\.(js|cjs|mjs)$/.test(e.name) && rel !== 'lib/jwt-verify.js' && re.test(fs.readFileSync(p, 'utf8'))) bad.push(rel);
      }
    })(root);
    assert.deepStrictEqual(bad, [], 'a second verifier: ' + bad.join(', '));
  });

  console.log('\n  ' + pass + ' checks');
})();
