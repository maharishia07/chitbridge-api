/**
 * tests/signin-sessions-routes.test.cjs — what GET /api/signin/devices · GET /sessions · POST /renew · /logout · /sessions/revoke DO.
 *
 * The real routes/signin.js behind the real middleware/auth.js and lib/person-session.js; only the database is a stand-in (one shop row whose
 * policy_flags.devices is written and read back, as in Postgres). Held here:
 *   · SEC-131: after POST /logout the old token is refused 401 on every route (replay) and cannot be renewed back to life
 *   · renew: a new token works, the old one is refused on a normal route; a repeat of the old renew gets a session; a legacy token needs X-Device-Id
 *   · sessions: lists MY live sessions only; devices: owner only (a co-assist is 403 OWNER_ONLY)
 *   · revoke: one person cannot end another person's session (403, it stays alive); the owner can; a device id by a co-assist is 403
 * Run: node tests/signin-sessions-routes.test.cjs · no network beyond 127.0.0.1, no DB.
 */
'use strict';
const path = require('path');
const http = require('http');
const jwt = require('jsonwebtoken');
const express = require('express');

process.env.JWT_SECRET = 'test-only-secret-signin-sessions';
delete process.env.LEGACY_TOKEN_REFUSE;
const API = path.join(__dirname, '..');
let pass = 0, fail = 0;
const t = (name, ok, extra) => { if (ok) { pass++; console.log('  ok  ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? '\n       ' + extra : '')); } };

/* ── the database: the shop's identities row, its policy_flags kept as JSON (a copy out, a copy in) ─────────────────── */
const SHOP = 'shop1';
let FLAGS = {};
const q = async (sql) => {
  const s = String((sql && sql.text) || sql);
  if (/FROM identities/i.test(s)) return { rows: [{ policy_flags: JSON.parse(JSON.stringify(FLAGS)), identity_id: SHOP, status: 'active' }], rowCount: 1 };
  return { rows: [], rowCount: 0 };
};
const stub = (rel, exports) => { const p = require.resolve(path.join(API, rel)); require.cache[p] = { id: p, filename: p, loaded: true, exports }; };
stub('db', { query: q, withEntity: async (id, fn) => fn({ query: q }), withTransaction: async (fn) => fn({ query: q }), readBatch: async () => ({}),
  trySavepoint: async (d, fn) => fn() });
stub('lib/schema', { hasColumn: async () => true, has: async () => true, columns: async () => [], table: async () => ({}) });
stub('lib/policy', { patchKey: async (db, shop, keys, value) => { FLAGS = Object.assign({}, FLAGS, { [keys[0]]: JSON.parse(JSON.stringify(value)) }); } });

const sessions = require(path.join(API, 'lib', 'person-session'));
const app = express();
app.use(express.json());
app.use('/api/signin', require(path.join(API, 'routes', 'signin')));

let base;
const call = (method, url, { token, body, device } = {}) => new Promise((resolve, reject) => {
  const data = body ? JSON.stringify(body) : null;
  const h = { 'content-type': 'application/json' };
  if (token) h.authorization = 'Bearer ' + token;
  if (device) h['x-device-id'] = device;
  if (data) h['content-length'] = Buffer.byteLength(data);
  const r = http.request(base + url, { method, headers: h }, (res) => {
    let s = ''; res.on('data', (c) => { s += c; });
    res.on('end', () => { let j = null; try { j = JSON.parse(s); } catch (_) {} resolve({ status: res.statusCode, body: j }); });
  });
  r.on('error', reject); if (data) r.write(data); r.end();
});

const OWNER = { identity_id: SHOP, bridge_id: 'B-SHOP1', display_name: 'Shop One', identity_type: 'entity', owner_scope: 'entity' };
const CLERK = { identity_id: 'clerk1', bridge_id: 'B-CLERK', display_name: 'Clerk', identity_type: 'actor', owner_scope: 'actor', actor_key: 'clerk', parent_entity_id: SHOP };
const CLERK2 = Object.assign({}, CLERK, { identity_id: 'clerk2', bridge_id: 'B-CLERK2', actor_key: 'clerk2' });
/* list a new session for `who` on `device` and sign its token — what a sign-in does */
async function signIn(who, device, surface) {
  const s = await sessions.open(async (fn) => fn({ query: q }), SHOP, { device_id: device, surface: surface || 'web', by: who.identity_id });
  return { jti: s.jti, token: jwt.sign(Object.assign({ kind: 'person', jti: s.jti, device_id: device, surface: s.surface }, who), process.env.JWT_SECRET, { expiresIn: '1h' }) };
}

(async () => {
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + server.address().port;
  try {
    console.log('— logout (SEC-131) —');
    let a = await signIn(OWNER, 'dev-own-1');
    let r = await call('GET', '/api/signin/sessions', { token: a.token, device: 'dev-own-1' });
    t('before logout the token works: GET /sessions 200 listing it as current', r.status === 200 && r.body.sessions.length === 1 && r.body.sessions[0].current === true, JSON.stringify(r.body));
    r = await call('POST', '/api/signin/logout', { token: a.token, device: 'dev-own-1' });
    t('POST /logout 200 { ok, removed:true }', r.status === 200 && r.body.ok === true && r.body.removed === true, JSON.stringify(r.body));
    r = await call('GET', '/api/signin/sessions', { token: a.token, device: 'dev-own-1' });
    t('SEC-131: the old token is refused 401 after logout (GET /sessions)', r.status === 401, r.status + ' ' + JSON.stringify(r.body));
    r = await call('POST', '/api/signin/logout', { token: a.token, device: 'dev-own-1' });
    t('SEC-131: a second logout with the old token is 401, not a second success', r.status === 401, r.status + ' ' + JSON.stringify(r.body));
    r = await call('POST', '/api/signin/renew', { token: a.token, device: 'dev-own-1' });
    t('SEC-131: the logged-out token cannot be renewed back to life', r.status === 401, r.status + ' ' + JSON.stringify(r.body));
    r = await call('POST', '/api/signin/logout', {});
    t('logout with no token: 401', r.status === 401, String(r.status));
    const legacy = jwt.sign(OWNER, process.env.JWT_SECRET, { expiresIn: '1h' });
    r = await call('POST', '/api/signin/logout', { token: legacy });
    t('logout with a legacy token (no jti): 200 { removed:false, legacy:true } — nothing server-side to end', r.status === 200 && r.body.removed === false && r.body.legacy === true, JSON.stringify(r.body));

    console.log('— renew —');
    a = await signIn(OWNER, 'dev-own-2');
    r = await call('POST', '/api/signin/renew', { token: a.token, device: 'dev-own-2' });
    const newTok = r.body && r.body.token;
    t('POST /renew 200 with a new token, a new jti, same device', r.status === 200 && !!newTok && r.body.jti !== a.jti && r.body.device_id === 'dev-own-2', JSON.stringify(r.body));
    r = await call('GET', '/api/signin/sessions', { token: newTok, device: 'dev-own-2' });
    t('the new token works and is the only listed session', r.status === 200 && r.body.sessions.length === 1 && r.body.sessions[0].jti !== a.jti, JSON.stringify(r.body));
    r = await call('GET', '/api/signin/sessions', { token: a.token, device: 'dev-own-2' });
    t('the OLD token is refused 401 on a normal route once renewed', r.status === 401, r.status + ' ' + JSON.stringify(r.body));
    const again = await call('POST', '/api/signin/renew', { token: a.token, device: 'dev-own-2' });
    t('a repeated renew with the old token (lost reply) still answers 200 with a session', again.status === 200 && !!again.body.jti, JSON.stringify(again.body));
    r = await call('POST', '/api/signin/renew', { token: legacy });
    t('a legacy token renewed without X-Device-Id: 400 NO_DEVICE', r.status === 400 && r.body.code === 'NO_DEVICE', JSON.stringify(r.body));
    r = await call('POST', '/api/signin/renew', { token: legacy, device: 'dev-legacy' });
    t('a legacy token renewed WITH X-Device-Id becomes a listed session (200 + token + jti)', r.status === 200 && !!r.body.token && !!r.body.jti, JSON.stringify(r.body));
    r = await call('POST', '/api/signin/renew', {});
    t('renew with no token: 401', r.status === 401, String(r.status));

    console.log('— sessions and devices —');
    FLAGS = {};
    const o = await signIn(OWNER, 'dev-aaaa-0001');
    const c1 = await signIn(CLERK, 'dev-bbbb-0002', 'till');
    const c2 = await signIn(CLERK2, 'dev-bbbb-0002', 'till');
    r = await call('GET', '/api/signin/sessions', { token: c1.token, device: 'dev-bbbb-0002' });
    t('GET /sessions lists only MY sessions (clerk1 sees its own jti, not clerk2 or the owner)', r.status === 200 && r.body.sessions.length === 1 && r.body.sessions[0].jti === c1.jti && r.body.sessions[0].current === true, JSON.stringify(r.body));
    t('a co-assist is told may.devices is not ok (OWNER_ONLY)', !!(r.body.may && r.body.may.devices && r.body.may.devices.ok === false && r.body.may.devices.code === 'OWNER_ONLY'), JSON.stringify(r.body.may));
    r = await call('GET', '/api/signin/sessions', { token: o.token, device: 'dev-aaaa-0001' });
    t('the owner is told may.devices ok', r.status === 200 && r.body.may.devices.ok === true, JSON.stringify(r.body.may));
    r = await call('GET', '/api/signin/devices', { token: o.token, device: 'dev-aaaa-0001' });
    const ids = (r.body.devices || []).map((d) => d.device_id).sort().join(',');
    t('GET /devices (owner): every device with its live session count', r.status === 200 && ids === 'dev-aaaa-0001,dev-bbbb-0002' && r.body.devices.find((d) => d.device_id === 'dev-bbbb-0002').sessions === 2, JSON.stringify(r.body));
    r = await call('GET', '/api/signin/devices', { token: c1.token, device: 'dev-bbbb-0002' });
    t('GET /devices (co-assist): 403 OWNER_ONLY', r.status === 403 && r.body.code === 'OWNER_ONLY', r.status + ' ' + JSON.stringify(r.body));
    r = await call('GET', '/api/signin/devices', {});
    t('GET /devices with no token: 401', r.status === 401, String(r.status));

    console.log('— sessions/revoke —');
    r = await call('POST', '/api/signin/sessions/revoke', { token: c1.token, device: 'dev-bbbb-0002', body: { jti: c2.jti } });
    t('one person cannot end another person\'s session: clerk1 revoking clerk2\'s jti is 403', r.status === 403, r.status + ' ' + JSON.stringify(r.body));
    r = await call('GET', '/api/signin/sessions', { token: c2.token, device: 'dev-bbbb-0002' });
    t('...and clerk2\'s session is still alive (200)', r.status === 200, String(r.status));
    r = await call('POST', '/api/signin/sessions/revoke', { token: c1.token, device: 'dev-bbbb-0002', body: { jti: o.jti } });
    const ownerStill = await call('GET', '/api/signin/sessions', { token: o.token, device: 'dev-aaaa-0001' });
    t('a co-assist cannot end the OWNER\'s session either: 403, owner still signed in', r.status === 403 && ownerStill.status === 200, JSON.stringify(r.body));
    r = await call('POST', '/api/signin/sessions/revoke', { token: c1.token, device: 'dev-bbbb-0002', body: { device_id: 'dev-bbbb-0002' } });
    t('a co-assist cannot remove a device: 403 OWNER_ONLY', r.status === 403 && r.body.code === 'OWNER_ONLY', JSON.stringify(r.body));
    r = await call('POST', '/api/signin/sessions/revoke', { token: c1.token, device: 'dev-bbbb-0002', body: {} });
    t('revoke with neither jti nor device_id: 400', r.status === 400, JSON.stringify(r.body));
    r = await call('POST', '/api/signin/sessions/revoke', { token: c1.token, device: 'dev-bbbb-0002', body: { jti: 'no-such-jti' } });
    t('revoke of an unknown jti: 200 { removed:false } (nothing to end, nothing leaked)', r.status === 200 && r.body.removed === false, JSON.stringify(r.body));
    r = await call('POST', '/api/signin/sessions/revoke', { token: c1.token, device: 'dev-bbbb-0002', body: { jti: c1.jti } });
    t('a person may end their OWN session: 200 revoked:session', r.status === 200 && r.body.revoked === 'session' && r.body.removed === true, JSON.stringify(r.body));
    r = await call('GET', '/api/signin/sessions', { token: c1.token, device: 'dev-bbbb-0002' });
    t('...and that token is refused 401 afterwards', r.status === 401, String(r.status));
    r = await call('POST', '/api/signin/sessions/revoke', { token: o.token, device: 'dev-aaaa-0001', body: { jti: c2.jti } });
    t('the owner may end anyone\'s session: 200', r.status === 200 && r.body.removed === true, JSON.stringify(r.body));
    r = await call('GET', '/api/signin/sessions', { token: c2.token, device: 'dev-bbbb-0002' });
    t('...and clerk2 is refused 401 afterwards', r.status === 401, String(r.status));
    r = await call('POST', '/api/signin/sessions/revoke', { token: o.token, device: 'dev-aaaa-0001', body: { device_id: 'dev-nope-0004' } });
    t('the owner removing an unknown device: 404', r.status === 404, JSON.stringify(r.body));
    const c3 = await signIn(CLERK, 'dev-cccc-0003', 'till');
    r = await call('POST', '/api/signin/sessions/revoke', { token: o.token, device: 'dev-aaaa-0001', body: { device_id: 'dev-cccc-0003' } });
    t('the owner removing a device: 200 revoked:device', r.status === 200 && r.body.revoked === 'device', JSON.stringify(r.body));
    r = await call('GET', '/api/signin/sessions', { token: c3.token, device: 'dev-cccc-0003' });
    t('...and every token on that device is refused 401 DEVICE_REVOKED', r.status === 401 && r.body.code === 'DEVICE_REVOKED', JSON.stringify(r.body));
    r = await call('POST', '/api/signin/sessions/revoke', { body: { jti: 'x' } });
    t('revoke with no token: 401', r.status === 401, String(r.status));
  } catch (e) { fail++; console.log('  FAIL test crashed: ' + ((e && e.stack) || e)); }
  server.close();
  console.log('\n' + pass + ' passed · ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
