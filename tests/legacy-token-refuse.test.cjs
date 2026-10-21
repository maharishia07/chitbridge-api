/**
 * tests/legacy-token-refuse.test.cjs — K-SEC PR A LANDING CHECK: a person token with no jti is refused ONLY when the owner
 * turns LEGACY_TOKEN_REFUSE on, and until then passes exactly as before — counted, so the day nobody holds one is visible.
 *
 * Proves, through the REAL middleware/auth.js with the database stubbed (the tests/auth-middleware.test.js pattern):
 *   · flag OFF (the default): a legacy token passes, is counted as used, and nobody is signed out
 *   · flag ON: the same token answers 401 SESSION_UPGRADE with a sentence; a listed session (jti) still passes
 *   · the shop's own auto-raise token (kind 'auto' + jti, 60 s) passes either way; a long-lived 'auto' token never does
 *   · issueToken counts legacy mints, customers apart (Athi's default (a): customers exempt, counted separately)
 *   · /health shows the counts; lib/autoraise.js signs kind 'auto' with a jti
 * Run: node tests/legacy-token-refuse.test.cjs · no network, no DB.
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-secret-for-legacy-refuse';
delete process.env.LEGACY_TOKEN_REFUSE;
const API = path.join(__dirname, '..');
const DEV = 'dev-legacy-0001';
const JTI = 'jti-listed-0001';

/* ── the database: the shop row lists one session (JTI) under DEV ───────────────────────────────────────────── */
const SHOP_ROW = { policy_flags: { devices: { [DEV]: { sessions: [{ jti: JTI, iat: 1, exp: 9999999999, surface: 'web' }] } } } };
const q = async () => ({ rows: [SHOP_ROW], rowCount: 1 });
const dbPath = require.resolve(path.join(API, 'db'));
require.cache[dbPath] = {
  id: dbPath,
  filename: dbPath,
  loaded: true,
  exports: {
    query: q,
    withEntity: async (id, fn) => fn({ query: q }),
    withTransaction: async (fn) => fn({ query: q }),
    readBatch: async () => ({}),
    trySavepoint: async (_d, fn) => fn()
  }
};
const schemaPath = require.resolve(path.join(API, 'lib', 'schema'));
require.cache[schemaPath] = {
  id: schemaPath,
  filename: schemaPath,
  loaded: true,
  exports: { hasColumn: async () => true, has: async () => true, columns: async () => [], table: async () => ({}) }
};
const auth = require(path.join(API, 'middleware', 'auth'));
const sessions = require(path.join(API, 'lib', 'person-session'));
const identityAuth = require(path.join(API, 'lib', 'identity-auth'));

let pass = 0,
  fail = 0;
async function it(what, fn) {
  try {
    await fn();
    pass++;
    console.log('  ok  ' + what);
  } catch (e) {
    fail++;
    console.log('  FAIL ' + what + '\n       ' + e.message);
  }
}
function call(token, device) {
  const req = { headers: { authorization: 'Bearer ' + token }, method: 'GET', originalUrl: '/api/chits', path: '/api/chits', url: '/api/chits' };
  if (device) req.headers['x-device-id'] = device;
  const out = { status: null, body: null, nexted: false };
  const res = {
    locals: {},
    status: (n) => ((out.status = n), res),
    json: (b) => ((out.body = b), res)
  };
  return auth(req, res, () => (out.nexted = true)).then(() => ({ out, res }));
}
const sign = (claims, opts) => jwt.sign(claims, process.env.JWT_SECRET, Object.assign({ algorithm: 'HS256' }, opts || {}));
const SHOP = { identity_id: 'shop1', bridge_id: 'shop1.br', display_name: 'Shop', identity_type: 'entity' };
const legacy = sign(SHOP, { expiresIn: '7d' });
const listed = sign(Object.assign({ kind: 'person', jti: JTI, device_id: DEV, surface: 'web' }, SHOP), { expiresIn: '7d' });
const autoTok = sign(Object.assign({ auto: true, kind: 'auto', jti: 'auto-1' }, SHOP), { expiresIn: '60s' });
const autoLong = sign(Object.assign({ auto: true, kind: 'auto', jti: 'auto-2' }, SHOP), { expiresIn: '7d' });

(async () => {
  console.log('— flag OFF (the default): nobody is signed out —');
  await it('the refusal is off unless LEGACY_TOKEN_REFUSE is set', async () => assert.strictEqual(sessions.refusingLegacy(), false));
  await it('a legacy token (no jti) passes exactly as before, marked kind legacy and counted as used', async () => {
    const before = sessions.legacyCounts().used;
    const { out, res } = await call(legacy);
    assert.strictEqual(out.nexted, true, 'a legacy token was refused with the flag off: ' + JSON.stringify(out.body));
    assert.strictEqual(res.locals.kind, 'legacy');
    assert.strictEqual(sessions.legacyCounts().used, before + 1);
  });

  console.log('— flag ON: the landing check —');
  process.env.LEGACY_TOKEN_REFUSE = '1';
  await it('⭐ a legacy token answers 401 SESSION_UPGRADE with a sentence, and is counted as refused', async () => {
    const before = sessions.legacyCounts().refused;
    const { out } = await call(legacy);
    assert.strictEqual(out.nexted, false, 'a legacy token got through with the flag on');
    assert.strictEqual(out.status, 401);
    assert.strictEqual(out.body.code, 'SESSION_UPGRADE');
    assert.ok(/Sign in again/.test(out.body.message), 'no sentence for the person: ' + out.body.message);
    assert.strictEqual(sessions.legacyCounts().refused, before + 1);
  });
  await it('a listed session (jti on its own device) still passes', async () => {
    const { out } = await call(listed, DEV);
    assert.strictEqual(out.nexted, true, JSON.stringify(out.body));
  });
  await it("the shop's own auto-raise token (kind auto, jti, 60 s) still passes", async () => {
    const { out, res } = await call(autoTok);
    assert.strictEqual(out.nexted, true, JSON.stringify(out.body));
    assert.strictEqual(res.locals.kind, 'auto');
  });
  await it("an 'auto' token that lives longer than 120 s is not one of ours — refused", async () => {
    const { out } = await call(autoLong);
    assert.strictEqual(out.status, 401);
    assert.strictEqual(out.body.code, 'AUTO_TOKEN');
  });
  await it("'true' also turns it on; anything else leaves it off", async () => {
    process.env.LEGACY_TOKEN_REFUSE = 'true';
    assert.strictEqual(sessions.refusingLegacy(), true);
    process.env.LEGACY_TOKEN_REFUSE = 'yes please';
    assert.strictEqual(sessions.refusingLegacy(), false);
  });
  delete process.env.LEGACY_TOKEN_REFUSE;

  console.log('— the mints are counted —');
  await it('a sign-in with no device id is a legacy mint, counted', async () => {
    const before = sessions.legacyCounts().minted;
    const tok = jwt.decode(await identityAuth.issueToken(q, SHOP, {}));
    assert.ok(!tok.jti);
    assert.strictEqual(sessions.legacyCounts().minted, before + 1);
  });
  await it('a storefront customer token is counted APART (exempt from the refusal for now)', async () => {
    const c = sessions.legacyCounts();
    await identityAuth.issueToken(q, { identity_id: 'c1', identity_type: 'customer', parent_entity_id: 'shop1' });
    const d = sessions.legacyCounts();
    assert.strictEqual(d.customer_minted, c.customer_minted + 1);
    assert.strictEqual(d.minted, c.minted);
  });
  await it('/health shows legacy_tokens; autoraise signs kind auto with a jti', async () => {
    const server = fs.readFileSync(path.join(API, 'server.js'), 'utf8');
    const raise = fs.readFileSync(path.join(API, 'lib', 'autoraise.js'), 'utf8');
    assert.ok(/legacy_tokens: require\('\.\/lib\/person-session'\)\.legacyCounts\(\)/.test(server));
    assert.ok(/kind: 'auto',\s*jti: require\('crypto'\)\.randomUUID\(\)/.test(raise));
  });

  console.log('\n  ' + pass + ' passed · ' + fail + ' failed · ' + (pass + fail) + ' checks');
  if (fail) process.exit(1);
})();
