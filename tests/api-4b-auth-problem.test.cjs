/**
 * tests/api-4b-auth-problem.test.cjs — API-4b: the sign-in 401 and the requireScope 403 answer the ONE Problem body.
 * OWNS     the check that middleware/auth.js refuses in application/problem+json (API-STANDARD S1) with a registered code, and that every
 *          key the old body carried (`error`, `message`, `code`, `pending`) is still there with the same value (S2), on the same status.
 * CALLED BY scripts/guards.cjs
 * No database (../db is stubbed before auth.js loads), no network. The tokens are signed here with a secret for this process only.
 */
'use strict';
const assert = require('assert');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = 'test-only-secret-for-api-4b';
let ROWS = [];
const dbPath = require.resolve('../db');
require.cache[dbPath] = {
  id: dbPath,
  filename: dbPath,
  loaded: true,
  exports: {
    query: async () => ({ rows: ROWS, rowCount: ROWS.length }),
    withEntity: async (id, fn) => fn({ query: async () => ({ rows: ROWS }) }),
    withTransaction: async (fn) => fn({ query: async () => ({ rows: ROWS }) }),
    readBatch: async () => ({}),
    trySavepoint: async (_d, fn) => fn()
  }
};
const schemaPath = require.resolve('../lib/schema');
require.cache[schemaPath] = {
  id: schemaPath,
  filename: schemaPath,
  loaded: true,
  exports: { hasColumn: async () => true, has: async () => true, columns: async () => [], table: async () => ({}) }
};
const auth = require('../middleware/auth');
const register = require('../docs/error-codes.json');

let checks = 0;
const it = async (what, fn) => {
  checks++;
  try {
    await fn();
    console.log('  ok  ' + what);
  } catch (e) {
    console.log('  FAIL ' + what + '\n       ' + e.message);
    process.exitCode = 1;
  }
};
const sign = (claims, opts) => jwt.sign(claims, process.env.JWT_SECRET, Object.assign({ algorithm: 'HS256' }, opts || {}));

/** a response double that records the status, the content type and the body */
function recorder() {
  const out = { status: null, body: null, type: null, nexted: false };
  const res = {
    locals: {},
    status(c) {
      out.status = c;
      return res;
    },
    set(k, v) {
      if (/content-type/i.test(k)) out.type = v;
      return res;
    },
    json(b) {
      out.body = b;
      return res;
    }
  };
  return { out, res };
}
/** one request through auth */
async function run(token, url) {
  const req = { headers: {}, method: 'GET', originalUrl: url || '/api/chits', path: url || '/api/chits', id: 'req-4b' };
  if (token) req.headers.authorization = 'Bearer ' + token;
  const { out, res } = recorder();
  await auth(req, res, () => {
    out.nexted = true;
  });
  return out;
}
/** the answer is a Problem: type, status in the body, a registered code, detail = the old message */
function isProblem(out, status, code) {
  assert.strictEqual(out.status, status, 'status changed: ' + out.status);
  assert.ok(/^application\/problem\+json/.test(out.type || ''), 'not problem+json: ' + out.type);
  assert.strictEqual(out.body.status, status);
  assert.strictEqual(out.body.code, code);
  assert.ok(
    register.codes.some((row) => row.code === code),
    code + ' is not in docs/ERROR-CODES.md'
  );
  assert.strictEqual(out.body.detail, out.body.message, 'detail is the old message');
  ['type', 'title', 'hint', 'request_id'].forEach((k) => assert.ok(k in out.body, 'missing ' + k));
  assert.strictEqual(out.nexted, false, 'it let the request through');
}
const keyToken = (scopes, jti) => sign({ identity_id: 'e1', identity_type: 'entity', kind: 'api_key', jti, scopes });
const listed = (rec) => [{ policy_flags: { api_keys: [rec] } }];

(async () => {
  console.log('— the sign-in 401 —');
  await it('no token: 401 problem+json TOKEN_MISSING, error + message frozen', async () => {
    const out = await run(null);
    isProblem(out, 401, 'TOKEN_MISSING');
    assert.strictEqual(out.body.error, 'Unauthorised');
    assert.strictEqual(out.body.message, 'No token provided');
  });
  await it('a malformed token: 401 problem+json TOKEN_INVALID, error + message frozen', async () => {
    const out = await run('not.a.jwt');
    isProblem(out, 401, 'TOKEN_INVALID');
    assert.strictEqual(out.body.error, 'Unauthorised');
    assert.strictEqual(out.body.message, 'Invalid token');
  });
  await it('a token that is no identity: 401 TOKEN_INVALID, same words', async () => {
    const out = await run(sign({ foo: 'bar' }));
    isProblem(out, 401, 'TOKEN_INVALID');
    assert.deepStrictEqual([out.body.error, out.body.message], ['Unauthorised', 'Invalid token']);
  });
  await it('an expired token: 401 problem+json TOKEN_EXPIRED, error + message frozen', async () => {
    const out = await run(sign({ identity_id: 'e1', identity_type: 'entity' }, { expiresIn: -60 }));
    isProblem(out, 401, 'TOKEN_EXPIRED');
    assert.strictEqual(out.body.error, 'Unauthorised');
    assert.strictEqual(out.body.message, 'Token expired — please log in again');
  });
  await it('a key no longer listed: 401 KEY_REVOKED, words frozen', async () => {
    ROWS = [{ policy_flags: { api_keys: [] } }];
    const out = await run(keyToken(['till'], 'j-gone'));
    isProblem(out, 401, 'KEY_REVOKED');
    assert.deepStrictEqual([out.body.error, out.body.message], ['Unauthorised', 'API key revoked or unknown']);
  });
  await it('a closed counter keeps its own code COUNTER_CLOSED and its message', async () => {
    ROWS = listed({ jti: 'j-closed', scopes: ['till'], till: { closed_at: '2026-10-01T00:00:00Z' } });
    const out = await run(keyToken(['till'], 'j-closed'));
    isProblem(out, 401, 'COUNTER_CLOSED');
    assert.strictEqual(out.body.error, 'Unauthorised');
    assert.ok(/^This counter was closed on 2026-10-01/.test(out.body.message));
  });
  await it('a person token on another device keeps DEVICE_MISMATCH', async () => {
    const out = await run(sign({ identity_id: 'e1', identity_type: 'entity', jti: 'p1', device_id: 'd1' }));
    isProblem(out, 401, 'DEVICE_MISMATCH');
    assert.strictEqual(out.body.message, 'This sign-in belongs to another device. Sign in on this one.');
  });
  await it('a revoked co-assist: 401 ACCESS_REVOKED, words frozen', async () => {
    ROWS = [{ break_status: 'removed', hat: 'act' }];
    const out = await run(sign({ identity_id: 'a1', identity_type: 'actor' }));
    isProblem(out, 401, 'ACCESS_REVOKED');
    assert.deepStrictEqual([out.body.error, out.body.message], ['Unauthorised', 'Your access has been revoked. Contact your admin.']);
  });

  console.log('— the scope 403 —');
  await it('a key outside its routes: 403 problem+json KEY_NOT_SCOPED, error + message frozen', async () => {
    ROWS = listed({ jti: 'j-off', scopes: ['offers'] });
    const out = await run(keyToken(['offers'], 'j-off'), '/api/chits');
    isProblem(out, 403, 'KEY_NOT_SCOPED');
    assert.strictEqual(out.body.error, 'Forbidden');
    assert.strictEqual(out.body.message, 'This key is not scoped for GET /api/chits');
  });
  await it('requireScope with the wrong scope: 403 problem+json KEY_NOT_SCOPED, words frozen', async () => {
    const { out, res } = recorder();
    auth.requireScope('till', 'books')({ api_key: { scopes: ['offers'] }, id: 'r' }, res, () => {
      out.nexted = true;
    });
    isProblem(out, 403, 'KEY_NOT_SCOPED');
    assert.deepStrictEqual([out.body.error, out.body.message], ['Forbidden', 'This key is not scoped for till / books']);
  });
  await it('an unapproved connector: 403 CONNECTOR_NOT_APPROVED keeps pending:true', async () => {
    ROWS = listed({ jti: 'j-enrol', scopes: ['till'], enrol: { approved: false, host: 'PC1' } });
    const out = await run(keyToken(['till'], 'j-enrol'), '/api/till/summary');
    isProblem(out, 403, 'CONNECTOR_NOT_APPROVED');
    assert.strictEqual(out.body.pending, true);
    assert.strictEqual(out.body.error, 'Forbidden');
    assert.ok(/waiting for approval/.test(out.body.message) && /PC1/.test(out.body.message));
  });

  console.log('— nobody new is refused, nobody is let in —');
  await it('a good session token still passes (next called, nothing written)', async () => {
    ROWS = [];
    const out = await run(sign({ identity_id: 'e1', identity_type: 'entity' }));
    assert.strictEqual(out.nexted, true);
    assert.strictEqual(out.status, null);
  });
  await it('a key that names this route still passes; requireScope lets a scoped key and a session through', async () => {
    ROWS = listed({ jti: 'j-ok', scopes: ['offers'] });
    const out = await run(keyToken(['offers'], 'j-ok'), '/api/offers');
    assert.strictEqual(out.nexted, true);
    let passed = 0;
    auth.requireScope('offers')({ api_key: { scopes: ['offers'] } }, {}, () => passed++);
    auth.requireScope('offers')({}, {}, () => passed++);
    assert.strictEqual(passed, 2);
  });

  console.log('\n  ' + checks + ' checks');
  process.exit(process.exitCode || 0);
})();
