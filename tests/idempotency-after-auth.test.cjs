'use strict';
/**
 * idempotency-after-auth.test.cjs — SEC (outside review 2026-10-23, finding 2): AN IDEMPOTENT REPLAY ANSWERS ONLY AFTER AUTH.
 *
 * middleware/idempotency.js used to answer a held key after checking only the token's SIGNATURE. A revoked session, a removed
 * device or a deactivated actor could read a stored answer (a chit, a session) that a fresh request would have been refused.
 * Now the route's own middleware/auth runs first. This test runs the REAL auth, the REAL jwt-verify and the REAL person-session
 * against a stubbed database, and the REAL idempotency (its memory store: the durable store shares the same answerAfterAuth).
 *
 * Proves: a valid replay still returns the stored answer (X-Idempotent-Replay); a revoked session, a removed device and a
 * deactivated actor each get the SAME refusal as a fresh request (not the stored answer, not a 409/422); a refusal is never
 * recorded as the key's answer; the public money doors (requireKey, no bearer) are untouched.
 * Run: node tests/idempotency-after-auth.test.cjs   · no network, no DB.
 */
const assert = require('assert'), path = require('path'), fs = require('fs');
const API = path.join(__dirname, '..');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-secret-for-auth-guards';
const jwt = require('jsonwebtoken');

let pass = 0, fail = 0;
const ita = async (what, fn) => { try { await fn(); pass++; console.log('  ok  ' + what); } catch (e) { fail++; console.log('  FAIL ' + what + '\n      ' + e.message); } };

/* ── the stub database: the shop's policy_flags (devices) and the actor row; the idempotency store is OFF (memory) ── */
const SHOP = 'shop-1', ACTOR = 'actor-1', DEVICE = 'dev-1';
let devices = {}, actorRow = { break_status: 'active', hat: 'act' };
const dbStub = {
  query: async (sql) => {
    if (/policy_flags FROM identities/.test(sql)) return { rows: [{ policy_flags: { devices } }] };
    if (/break_status/.test(sql)) return { rows: actorRow ? [actorRow] : [] };
    return { rows: [] };
  },
  withEntity: async () => { throw Object.assign(new Error('no table'), { code: '42P01' }); },
  withTransaction: async (fn) => fn({ query: async () => ({ rows: [] }) })
};
const stub = (rel, exports) => { const id = path.join(API, rel); require.cache[require.resolve(id)] = { id, filename: id, loaded: true, exports }; };
stub('db', dbStub);
stub('lib/schema', { hasColumn: async () => false, has: async () => true, columns: async () => [], table: async () => ({}) });
stub('lib/logger', { warn() {}, info() {}, debug() {}, error() {}, critical() {}, fellBack() {} });
const idempotency = require(path.join(API, 'middleware', 'idempotency'));
const sessions = require(path.join(API, 'lib', 'person-session'));
const nowS = Math.floor(Date.now() / 1000);

const listed = (jti) => ({ [DEVICE]: { sessions: [{ jti, iat: nowS, exp: nowS + 3600, surface: 'web' }] } });
let seq = 0;
/** a person (shop owner) token on DEVICE, listed; or an actor's */
function person(kind) {
  const jti = 'jti-' + kind + '-' + (++seq);
  const claims = kind === 'actor'
    ? { identity_id: ACTOR, identity_type: 'actor', parent_entity_id: SHOP, jti, device_id: DEVICE }
    : { identity_id: SHOP, identity_type: 'entity', jti, device_id: DEVICE };
  devices = listed(jti);
  return { jti, token: jwt.sign(claims, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: 3600 }) };
}

/** one request through idempotency (and, behind it, the route's own auth) */
function send(who, o) {
  const x = o || {};
  const headers = { authorization: 'Bearer ' + who.token, 'x-device-id': DEVICE };
  if (x.key) headers['idempotency-key'] = x.key;
  const req = { id: 'r' + (++seq), method: 'POST', path: '/api/chits', originalUrl: '/api/chits', body: x.body || { a: 1 }, headers };
  const res = { statusCode: 200, headers: {}, body: undefined, locals: {},
    status(s) { this.statusCode = s; return this; }, setHeader(k, v) { this.headers[k] = v; }, json(b) { this.body = b; return this; } };
  const out = { ran: false };
  return new Promise((resolve) => {
    const done = () => resolve(Object.assign(out, { status: res.statusCode, body: res.body, headers: res.headers }));
    /* the route behind idempotency: it runs the SAME auth first, as every protected route does, then answers */
    idempotency(req, res, () => require(path.join(API, 'middleware', 'auth'))(req, res, () => {
      out.ran = true; res.status(201).json({ id: 'chit-1' }); done();
    }));
    setTimeout(done, 80); /* a refusal never calls next */
  });
}
const reset = () => { idempotency._memory.clear(); actorRow = { break_status: 'active', hat: 'act' }; };
const revokeSession = (who) => { devices = {}; sessions.forget(who.jti); };

(async () => {
  console.log('— a replay answers only after the route\'s own auth —');

  await ita('a valid replay still returns the stored answer, marked X-Idempotent-Replay, and the route ran once', async () => {
    reset(); const me = person('owner');
    const first = await send(me, { key: 'k1' });
    assert.ok(first.ran && first.status === 201);
    const again = await send(me, { key: 'k1' });
    assert.strictEqual(again.ran, false, 'the route ran a second time');
    assert.strictEqual(again.status, 201); assert.deepStrictEqual(again.body, { id: 'chit-1' });
    assert.strictEqual(again.headers['X-Idempotent-Replay'], 'true');
  });

  const noId = (b) => Object.assign({}, b, { request_id: undefined }); /* API-4b: a Problem body carries its own request's id */
  await ita('a REVOKED session replaying a stored key gets the fresh-request refusal (401 SESSION_EXPIRED), not the stored answer', async () => {
    reset(); const me = person('owner');
    await send(me, { key: 'k2' });
    revokeSession(me);
    const replay = await send(me, { key: 'k2' });
    const fresh = await send(me, { key: 'k2-other' });
    assert.strictEqual(replay.status, 401); assert.strictEqual(replay.body.code, 'SESSION_EXPIRED');
    assert.deepStrictEqual(noId(replay.body), noId(fresh.body), 'the replay refusal differs from the fresh refusal');
    assert.strictEqual(replay.headers['X-Idempotent-Replay'], undefined);
  });

  await ita('a REMOVED device replaying a stored key gets 401 DEVICE_REVOKED, same as a fresh request', async () => {
    reset(); const me = person('owner');
    await send(me, { key: 'k3' });
    devices = { [DEVICE]: Object.assign({ revoked_at: new Date().toISOString() }, listed(me.jti)[DEVICE]) }; sessions.forget(me.jti);
    const replay = await send(me, { key: 'k3' });
    const fresh = await send(me, { key: 'k3-other' });
    assert.strictEqual(replay.status, 401); assert.strictEqual(replay.body.code, 'DEVICE_REVOKED');
    assert.deepStrictEqual(noId(replay.body), noId(fresh.body));
  });

  await ita('a DEACTIVATED actor replaying a stored key gets 401 "access has been revoked", same as a fresh request', async () => {
    reset(); const me = person('actor');
    const first = await send(me, { key: 'k4' });
    assert.ok(first.ran, 'the live actor could not post: ' + JSON.stringify(first.body));
    actorRow = { break_status: 'deactivated', hat: 'act' };
    const replay = await send(me, { key: 'k4' });
    const fresh = await send(me, { key: 'k4-other' });
    assert.strictEqual(replay.status, 401); assert.ok(/revoked/.test(replay.body.message));
    assert.deepStrictEqual(noId(replay.body), noId(fresh.body));
  });

  await ita('a removed actor (no row) is refused on replay too', async () => {
    reset(); const me = person('actor');
    await send(me, { key: 'k4b' });
    actorRow = null;
    const replay = await send(me, { key: 'k4b' });
    assert.strictEqual(replay.status, 401);
  });

  await ita('a refused token gets auth\'s 401 even for a key reused with another body (no 422/409 leak of the key\'s state)', async () => {
    reset(); const me = person('owner');
    await send(me, { key: 'k5', body: { a: 1 } });
    revokeSession(me);
    const other = await send(me, { key: 'k5', body: { a: 2 } });
    assert.strictEqual(other.status, 401);
  });

  await ita('a refusal is never recorded as the key\'s answer: after a 401 claim, the real holder\'s retry runs', async () => {
    reset(); const bad = person('owner'); revokeSession(bad);
    const refused = await send(bad, { key: 'k6' });
    assert.strictEqual(refused.status, 401);
    const good = person('owner');
    const retry = await send(good, { key: 'k6' });
    assert.ok(retry.ran && retry.status === 201, 'the key was poisoned by the 401: ' + retry.status);
  });

  await ita('a 403 (viewer refused) is never recorded: after promotion the same key runs the route', async () => {
    reset(); const me = person('actor');
    actorRow = { break_status: 'active', hat: 'view_only' };
    const refused = await send(me, { key: 'k8' });
    assert.strictEqual(refused.status, 403, 'the viewer was not refused: ' + refused.status);
    actorRow = { break_status: 'active', hat: 'act' };
    const after = await send(me, { key: 'k8' });
    assert.ok(after.ran && after.status === 201, 'the key replayed the old 403: ' + after.status);
    assert.strictEqual(after.headers['X-Idempotent-Replay'], undefined);
  });

  await ita('a stranger with no token and a key is untouched: no claim, the route\'s auth answers its own 401', async () => {
    reset();
    const req = { id: 'x', method: 'POST', path: '/api/chits', body: {}, headers: { 'idempotency-key': 'k7' } };
    let nexted = false;
    idempotency(req, { setHeader() {}, status() { return this; }, json() { return this; } }, () => { nexted = true; });
    assert.ok(nexted); assert.strictEqual(idempotency._memory.size(), 0);
  });

  await ita('the public money doors keep their own scope: requireKey holds the key with needsAuth unset (no bearer, no auth call)', async () => {
    const src = fs.readFileSync(path.join(API, 'middleware', 'idempotency.js'), 'utf8');
    const publicClaim = src.slice(src.indexOf('function requireKey'), src.indexOf('requireIdempotencyKey.addsStatuses'));
    assert.ok(!/needsAuth/.test(publicClaim), 'requireKey must not run bearer auth');
    assert.ok(/needsAuth: true/.test(src.slice(src.indexOf('module.exports = function idempotency'), src.indexOf('const KEY_REQUIRED'))), 'the bearer door must ask for auth');
    assert.strictEqual((src.match(/answerAfterAuth\(req, res, next, outcome\.existing/g) || []).length, 2, 'both stores must answer through answerAfterAuth');
    assert.ok(!/answerExisting\(req, res, outcome\.existing/.test(src), 'no store may answer a held key without the auth step');
  });

  console.log('\n  ' + (pass + fail) + ' checks' + (fail ? ', ' + fail + ' FAILED' : ''));
  process.exit(fail ? 1 : 0);
})();
