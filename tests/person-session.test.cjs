/**
 * tests/person-session.test.cjs — M05: a person session is LISTED, BOUND to one device, and REVOCABLE (D3, D14).
 *
 * Proved against the REAL middleware/auth.js, the REAL routes/signin.js, the REAL lib/identity-auth.js issueToken and the
 * REAL lib/person-session.js. Only the database is stubbed: one in-memory identities table whose transactions run one at a
 * time (the row lock FOR UPDATE takes in Postgres).
 *
 * The three invariants of MASTER-BUILD row 9:
 *   I-a  a revoked jti is refused within 60 s — on this process at once; on another process when its cache entry ages out,
 *        and a cache entry is never older than 60 s (fake clock, lib/person-session.setClock)
 *   I-b  a session is bound to one device — a copied token with another (or no) X-Device-Id is 401 DEVICE_MISMATCH
 *   I-c  sign-in on device B never revokes device A — also five sign-ins at once all stay listed
 * And the STOP condition: a token issued before M05 (no jti / device_id) keeps working, unchanged, until its own exp.
 *
 * Run: node tests/person-session.test.cjs · no network beyond 127.0.0.1, no DB.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const jwt = require('jsonwebtoken');
const express = require('express');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-secret-for-person-session';
const API = path.join(__dirname, '..');

/* ── the database: identities rows by id; every transaction waits for the one before it (FOR UPDATE) ───────────── */
const ROWS = {
  shop1: { identity_type: 'entity', display_name: 'Shop One', bridge_id: 'b-shop1', policy_flags: {
    api_keys: [{ jti: 'k-till', scopes: ['till'], till: { id: 'C1' } }] } },
  emp1: { identity_type: 'actor', break_status: 'active', hat: 'act', access_level: 'editor', parent_entity_id: 'shop1' },
};
let FAIL_WRITES = false;
const SQL_SEEN = [];
const clone = (x) => JSON.parse(JSON.stringify(x));
const q = async (sql, params) => {
  const s = String(sql); SQL_SEEN.push(s);
  const row = ROWS[params && params[0]];
  if (/^\s*UPDATE identities SET policy_flags = jsonb_set/.test(s)) {
    if (FAIL_WRITES) throw new Error('simulated write failure');
    if (!/'\{devices\}'/.test(s)) throw new Error('a write touched more than policy_flags.devices');
    row.policy_flags = Object.assign({}, row.policy_flags || {}, { devices: JSON.parse(params[1]) });
    return { rows: [], rowCount: 1 };
  }
  if (/SELECT policy_flags FROM identities/.test(s)) return { rows: row ? [{ policy_flags: clone(row.policy_flags || {}) }] : [], rowCount: row ? 1 : 0 };
  if (/break_status/.test(s)) return { rows: row && row.identity_type === 'actor' ? [clone(row)] : [], rowCount: 1 };
  if (/SELECT display_name, bridge_id FROM identities/.test(s)) return { rows: row ? [{ display_name: row.display_name, bridge_id: row.bridge_id }] : [] };
  return { rows: [], rowCount: 0 };
};
let lock = Promise.resolve();
const withTransaction = (fn) => {
  const run = lock.then(() => fn({ query: q }));
  lock = run.catch(() => {});
  return run;
};
const dbPath = require.resolve(path.join(API, 'db'));
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: {
  query: q, pool: { query: q, connect: async () => ({ query: q, release() {} }) },
  withEntity: async (id, fn) => fn({ query: q }), withTransaction, onEntity: async (id, db, fn) => fn({ query: q }),
  readBatch: async () => ({}), trySavepoint: async (db, fn, fb) => { try { return await fn(db); } catch (_) { return fb; } },
} };
const schemaPath = require.resolve(path.join(API, 'lib', 'schema'));
require.cache[schemaPath] = { id: schemaPath, filename: schemaPath, loaded: true,
  exports: { hasColumn: async () => true, has: async () => true, columns: async () => [], table: async () => ({}) } };

const sessions = require(path.join(API, 'lib', 'person-session'));
const identityAuth = require(path.join(API, 'lib', 'identity-auth'));
const auth = require(path.join(API, 'middleware', 'auth'));

let T = Date.now();   // the listing's clock (lib/person-session.setClock); jwt.verify keeps the real one
sessions.setClock(() => T);

let pass = 0, fail = 0;
const t = (name, ok, extra) => { if (ok) { pass++; console.log('  ok  ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? '\n       ' + extra : '')); } };

/* ── the app: the real routes, plus a probe that reports what auth built ──────────────────────────────────────── */
let lastLocals = null;
const app = express();
app.use(express.json());
app.use((req, res, next) => { res.on('finish', () => { lastLocals = Object.assign({}, res.locals); }); next(); });
app.use('/api/signin', require(path.join(API, 'routes', 'signin')));
app.get('/api/probe', auth, (req, res) => res.json({ till: req.till, session: req.session || null }));
app.post('/api/chits/send', auth, (req, res) => res.json({ ok: true }));

let base;
const call = (method, url, { token, device, body } = {}) => new Promise((resolve, reject) => {
  const data = body ? JSON.stringify(body) : null;
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = 'Bearer ' + token;
  if (device) headers['x-device-id'] = device;
  if (data) headers['content-length'] = Buffer.byteLength(data);
  const r = http.request(base + url, { method, headers }, (res) => {
    let s = ''; res.on('data', (c) => { s += c; });
    res.on('end', () => { let j = null; try { j = JSON.parse(s); } catch (_) {} resolve({ status: res.statusCode, body: j }); });
  });
  r.on('error', reject); if (data) r.write(data); r.end();
});

const OWNER = { identity_id: 'shop1', identity_type: 'entity', display_name: 'Shop One', bridge_id: 'b-shop1', email: 'o@x.in' };
const EMP = { identity_id: 'emp1', identity_type: 'actor', display_name: 'Ravi', bridge_id: 'b-emp1', parent_entity_id: 'shop1',
              actor_key: 'ravi', actor_role: 'staff', actor_type: 'human' };
const DEV_A = 'devA-11111111', DEV_B = 'devB-22222222', DEV_C = 'devC-33333333';
const devs = () => ROWS.shop1.policy_flags.devices || {};
const dec = (tok) => jwt.decode(tok);

(async () => {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = 'http://127.0.0.1:' + server.address().port;
  try {
    console.log('\n── the token: who gets a session, how long it lives (D3) ──');
    const legacy = await identityAuth.issueToken(q, OWNER);
    const L = dec(legacy);
    t('a sign-in that names no device gets TODAY\'s token: no jti, no device_id, 7 days', !L.jti && !L.device_id && !L.kind && L.exp - L.iat === 7 * 86400);
    t('  …and nothing is listed for it', Object.keys(devs()).length === 0);
    const tokA = await identityAuth.issueToken(q, OWNER, { device_id: DEV_A, surface: 'till' });
    const A = dec(tokA);
    t('a phone at the counter (surface till) gets kind person + jti + device_id, 30 days',
      A.kind === 'person' && !!A.jti && A.device_id === DEV_A && A.surface === 'till' && A.exp - A.iat === 30 * 86400);
    const tokW = await identityAuth.issueToken(q, OWNER, { device_id: DEV_C, surface: 'index' });
    t('a web page (any other surface) gets 7 days', dec(tokW).exp - dec(tokW).iat === 7 * 86400);
    t('the jti is listed under its device in the SHOP\'s policy_flags.devices',
      devs()[DEV_A] && devs()[DEV_A].sessions.some((s) => s.jti === A.jti && s.exp === A.exp && s.surface === 'till'));
    t('  …the listing write touched policy_flags.devices only (jsonb_set) — api_keys untouched',
      ROWS.shop1.policy_flags.api_keys.length === 1 && SQL_SEEN.some((s) => /jsonb_set\(COALESCE\(policy_flags, '\{\}'::jsonb\), '\{devices\}'/.test(s)));
    const tokE = await identityAuth.issueToken(q, EMP, { device_id: DEV_B, surface: 'till' });
    t('an employee\'s session is listed under the shop (parent), not their own row',
      devs()[DEV_B] && devs()[DEV_B].sessions.some((s) => s.jti === dec(tokE).jti && s.by === 'emp1') && !ROWS.emp1.policy_flags);
    t('a customer token is never a person session (storefront unchanged)',
      !dec(await identityAuth.issueToken(q, { identity_id: 'c1', identity_type: 'customer', parent_entity_id: 'shop1' }, { device_id: DEV_A })).jti);
    FAIL_WRITES = true;
    const fallback = dec(await identityAuth.issueToken(q, OWNER, { device_id: DEV_C }));
    FAIL_WRITES = false;
    t('⚠️ if the listing cannot be written the sign-in STILL succeeds — with a legacy token, never a refusal', !fallback.jti && fallback.identity_id === 'shop1');
    const ent = fs.readFileSync(path.join(API, 'routes', 'entities.js'), 'utf8'), act = fs.readFileSync(path.join(API, 'routes', 'actors.js'), 'utf8');
    t('both sign-in doors hand issueToken the device the page named (deviceOfSignin)',
      /issueToken\(query, identity, require\('\.\.\/lib\/person-session'\)\.deviceOfSignin\(req\)\)/.test(ent)
      && /issueToken\(db, a, require\('\.\.\/lib\/person-session'\)\.deviceOfSignin\(req\)\)/.test(act));
    t('deviceOfSignin: body device_id or X-Device-Id; neither → null (legacy)',
      sessions.deviceOfSignin({ body: { device_id: DEV_A }, headers: {} }).device_id === DEV_A
      && sessions.deviceOfSignin({ body: {}, headers: { 'x-device-id': DEV_B } }).device_id === DEV_B
      && sessions.deviceOfSignin({ body: {}, headers: {} }).device_id === null
      && sessions.deviceIdOf('__proto__') === null && sessions.deviceIdOf('short') === null);

    console.log('\n── STOP condition: a token from before M05 keeps working ──');
    let r = await call('GET', '/api/probe', { token: legacy });
    t('a legacy token (no jti) with NO X-Device-Id → 200, the M04 holder unchanged',
      r.status === 200 && r.body.till.holder === 'person:shop1' && r.body.till.session === null && r.body.session === null, JSON.stringify(r.body));
    t('  …and the request log marks it kind:\'legacy\'', lastLocals && lastLocals.kind === 'legacy');
    const oldStyle = jwt.sign({ identity_id: 'emp1', identity_type: 'actor', parent_entity_id: 'shop1' }, process.env.JWT_SECRET, { expiresIn: '7d' });
    r = await call('POST', '/api/chits/send', { token: oldStyle, body: {} });
    t('a legacy EMPLOYEE token on a write route → 200 (nobody signed out by M05)', r.status === 200);
    t('  …auth reads no listing for it (no policy_flags read) — honoured until its own exp, as before',
      (() => { SQL_SEEN.length = 0; return true; })() && (await call('GET', '/api/probe', { token: legacy })).status === 200
      && !SQL_SEEN.some((x) => /SELECT policy_flags/.test(x)));

    console.log('\n── I-b: a session is bound to ONE device ──');
    r = await call('GET', '/api/probe', { token: tokA, device: DEV_A });
    t('the session on its own device → 200, held by the device: holder dev:<device_id>, req.session set',
      r.status === 200 && r.body.till.holder === 'dev:' + DEV_A && r.body.till.device_id === DEV_A && r.body.till.kind === 'person'
      && r.body.session && r.body.session.jti === A.jti && r.body.session.surface === 'till', JSON.stringify(r.body));
    t('  …and the request log marks it kind:\'person\'', lastLocals && lastLocals.kind === 'person');
    r = await call('GET', '/api/probe', { token: tokA, device: DEV_B });
    t('T8: the same token copied to another device (other X-Device-Id) → 401 DEVICE_MISMATCH', r.status === 401 && r.body.code === 'DEVICE_MISMATCH');
    t('  …logged with its code', lastLocals && lastLocals.code === 'DEVICE_MISMATCH');
    r = await call('GET', '/api/probe', { token: tokA });
    t('the same token with NO X-Device-Id → 401 DEVICE_MISMATCH', r.status === 401 && r.body.code === 'DEVICE_MISMATCH');
    const forged = jwt.sign({ identity_id: 'shop1', identity_type: 'entity', kind: 'person', jti: 'not-listed', device_id: DEV_A }, process.env.JWT_SECRET, { expiresIn: '7d' });
    r = await call('GET', '/api/probe', { token: forged, device: DEV_A });
    t('a jti that was never listed → 401 SESSION_EXPIRED', r.status === 401 && r.body.code === 'SESSION_EXPIRED');

    console.log('\n── I-c: sign-in on device B never revokes device A ──');
    const tokA2 = await identityAuth.issueToken(q, OWNER, { device_id: DEV_B, surface: 'till' });
    r = await call('GET', '/api/probe', { token: tokA, device: DEV_A });
    const r2 = await call('GET', '/api/probe', { token: tokA2, device: DEV_B });
    t('the owner signs in on device B → device A still 200, device B 200', r.status === 200 && r2.status === 200);
    t('  …the employee\'s session on device B is still listed beside it', devs()[DEV_B].sessions.some((s) => s.jti === dec(tokE).jti));
    const five = await Promise.all([1, 2, 3, 4, 5].map((i) => identityAuth.issueToken(q, OWNER, { device_id: 'devP-0000000' + i, surface: 'till' })));
    t('five devices signing in at the same moment — all five listed (locked read, devices-only write)',
      five.every((tk) => { const d = dec(tk); return d.jti && devs()[d.device_id] && devs()[d.device_id].sessions.some((s) => s.jti === d.jti); }));
    r = await call('GET', '/api/probe', { token: tokA, device: DEV_A });
    t('  …and device A is still 200 after all of them', r.status === 200);

    console.log('\n── renew · logout · sessions · devices ──');
    r = await call('POST', '/api/signin/renew', { token: tokA2, device: DEV_B });
    const N = r.body && r.body.token && dec(r.body.token);
    t('renew → a new jti on the same device, same life (till: 30 d), same identity claims',
      r.status === 200 && N && N.jti !== dec(tokA2).jti && N.device_id === DEV_B && N.exp - N.iat === 30 * 86400
      && N.identity_id === 'shop1' && N.display_name === 'Shop One', JSON.stringify(r.body));
    r = await call('GET', '/api/probe', { token: tokA2, device: DEV_B });
    t('  …the old jti is refused at once (SESSION_EXPIRED)', r.status === 401 && r.body.code === 'SESSION_EXPIRED');
    const again = await call('POST', '/api/signin/renew', { token: tokA2, device: DEV_B });
    t('  …a renew repeated with the old token within 60 s answers the SAME new session (idempotent)',
      again.status === 200 && dec(again.body.token).jti === N.jti, JSON.stringify(again.body));
    T += 61000;
    const late = await call('POST', '/api/signin/renew', { token: tokA2, device: DEV_B });
    t('  …after 60 s the old token cannot renew any more (401)', late.status === 401);
    T -= 61000;
    r = await call('POST', '/api/signin/renew', { token: legacy, device: DEV_C, body: { surface: 'index' } });
    t('a LEGACY token renewed with X-Device-Id becomes a listed session — no second sign-in needed',
      r.status === 200 && dec(r.body.token).jti && dec(r.body.token).device_id === DEV_C && dec(r.body.token).exp - dec(r.body.token).iat === 7 * 86400);
    r = await call('POST', '/api/signin/renew', { token: legacy });
    t('  …without a device it answers 400 NO_DEVICE (and the legacy token keeps working)', r.status === 400 && r.body.code === 'NO_DEVICE');
    r = await call('GET', '/api/signin/sessions', { token: N && again.body.token, device: DEV_B });
    t('GET /sessions lists MY sessions across my devices, marks the current one, never another person\'s',
      r.status === 200 && r.body.sessions.some((s) => s.current && s.device_id === DEV_B) && r.body.sessions.some((s) => s.device_id === DEV_A)
      && r.body.sessions.every((s) => s.jti !== dec(tokE).jti), JSON.stringify(r.body).slice(0, 300));
    r = await call('GET', '/api/signin/devices', { token: tokA, device: DEV_A });
    t('GET /devices (owner) lists every device with its sessions count', r.status === 200 && r.body.devices.length >= 8
      && r.body.devices.find((d) => d.device_id === DEV_B).sessions === 2);
    r = await call('GET', '/api/signin/devices', { token: tokE, device: DEV_B });
    t('GET /devices for an employee → 403 (owner only)', r.status === 403);
    r = await call('POST', '/api/signin/sessions/revoke', { token: tokE, device: DEV_B, body: { jti: A.jti } });
    t('an employee cannot end the owner\'s session → 403', r.status === 403);
    r = await call('POST', '/api/signin/sessions/revoke', { token: tokE, device: DEV_B, body: { device_id: DEV_A } });
    t('an employee cannot remove a device → 403', r.status === 403);
    r = await call('POST', '/api/signin/logout', { token: legacy });
    t('logout with a legacy token → 200 (nothing listed to remove; the page clears itself)', r.status === 200 && r.body.legacy === true);
    r = await call('POST', '/api/signin/logout', { token: tokE, device: DEV_B });
    t('logout removes my jti → 200', r.status === 200 && r.body.removed === true);
    r = await call('GET', '/api/probe', { token: tokE, device: DEV_B });
    t('  …and the logged-out token is refused at once on this process (SESSION_EXPIRED)', r.status === 401 && r.body.code === 'SESSION_EXPIRED');
    r = await call('GET', '/api/probe', { token: again.body.token, device: DEV_B });
    t('  …the other person on the same device is still signed in', r.status === 200);
    const keyTok = jwt.sign({ identity_id: 'shop1', identity_type: 'entity', kind: 'api_key', jti: 'k-till', scopes: ['till'] }, process.env.JWT_SECRET);
    r = await call('POST', '/api/signin/logout', { token: keyTok });
    t('a KEY on /api/signin/logout → 403 (a key cannot sign in or out)', r.status === 403);
    const sigSrc = fs.readFileSync(path.join(API, 'routes', 'signin.js'), 'utf8');
    t('  …and every /api/signin route carries personOnly (KEY_CANNOT_SIGN_IN), whatever the key scopes say',
      (sigSrc.match(/router\.(get|post)\(/g) || []).length === (sigSrc.match(/router\.(get|post)\('[^']+', auth, personOnly/g) || []).length);

    console.log('\n── I-a: a revoked jti is refused within 60 s (fake clock) ──');
    const tokR = await identityAuth.issueToken(q, OWNER, { device_id: 'devR-44444444', surface: 'till' });
    const R = dec(tokR);
    const t0 = T;
    r = await call('GET', '/api/probe', { token: tokR, device: 'devR-44444444' });
    t('t0: the session answers 200 (its verdict is now cached on this process)', r.status === 200);
    /* ANOTHER server process revokes it: the listing changes in the database, this process's cache is not told */
    T = t0 + 10000;
    const d = ROWS.shop1.policy_flags.devices['devR-44444444'];
    d.sessions = d.sessions.filter((s) => s.jti !== R.jti);
    T = t0 + 59999;
    r = await call('GET', '/api/probe', { token: tokR, device: 'devR-44444444' });
    t('t0+59.999 s: still served from this process\'s cache (the window is real and bounded)', r.status === 200);
    T = t0 + 60000;
    r = await call('GET', '/api/probe', { token: tokR, device: 'devR-44444444' });
    t('⭐ t0+60 s: REFUSED (SESSION_EXPIRED) — no cache entry outlives 60 s, so a revoke anywhere lands within 60 s',
      r.status === 401 && r.body.code === 'SESSION_EXPIRED');
    t('the bound is the constant: CACHE_MS === 60000', sessions.CACHE_MS === 60000);
    const tokS = await identityAuth.issueToken(q, OWNER, { device_id: 'devS-55555555', surface: 'till' });
    await call('GET', '/api/probe', { token: tokS, device: 'devS-55555555' });   // cached ok
    r = await call('POST', '/api/signin/sessions/revoke', { token: tokA, device: DEV_A, body: { jti: dec(tokS).jti } });
    const r3 = await call('GET', '/api/probe', { token: tokS, device: 'devS-55555555' });
    t('the owner revokes a jti on THIS process → refused at once (the cache is forgotten after the write)',
      r.status === 200 && r.body.removed === true && r3.status === 401 && r3.body.code === 'SESSION_EXPIRED');

    console.log('\n── the owner removes a device ──');
    const tokD = await identityAuth.issueToken(q, EMP, { device_id: 'devD-66666666', surface: 'till' });
    await call('GET', '/api/probe', { token: tokD, device: 'devD-66666666' });   // cached ok
    r = await call('POST', '/api/signin/sessions/revoke', { token: tokA, device: DEV_A, body: { device_id: 'devD-66666666' } });
    const r4 = await call('GET', '/api/probe', { token: tokD, device: 'devD-66666666' });
    t('device revoked → its session is refused at once with DEVICE_REVOKED',
      r.status === 200 && r4.status === 401 && r4.body.code === 'DEVICE_REVOKED', JSON.stringify(r4.body));
    let threw = null;
    try { await identityAuth.issueToken(q, EMP, { device_id: 'devD-66666666', surface: 'till' }); } catch (e) { threw = e; }
    t('signing in again on the removed device is refused (DEVICE_REVOKED) — only the owner lets it back', threw && threw.code === 'DEVICE_REVOKED');
    r = await call('GET', '/api/probe', { token: tokA, device: DEV_A });
    t('  …device A is untouched by another device\'s removal', r.status === 200);
    t('the doors answer a removed device 403 DEVICE_REVOKED in words (not a 500)',
      /err\.code === 'DEVICE_REVOKED'/.test(ent) && /err\.code === 'DEVICE_REVOKED'/.test(act));

    console.log('\n── one shape ──');
    t('auth builds the session holder in lib/holder.js (one builder)', auth.holderOf === require(path.join(API, 'lib', 'holder')).holderOf);
    const srv = fs.readFileSync(path.join(API, 'server.js'), 'utf8');
    t('server.js mounts /api/signin, allows the X-Device-Id header, logs kind',
      /app\.use\('\/api\/signin',\s+require\('\.\/routes\/signin'\)\)/.test(srv) && /'X-Device-Id'/.test(srv) && /kind: \(res\.locals && res\.locals\.kind\)/.test(srv));
    const fields = fs.readFileSync(path.join(API, 'docs', 'FIELDS.md'), 'utf8');
    t('docs/FIELDS.md has policy_flags.devices and the token claims', /policy_flags\.devices/.test(fields) && /`jti`/.test(fields) && /`device_id`/.test(fields));
  } catch (e) {
    fail++; console.log('  FAIL threw: ' + (e && e.stack || e));
  } finally {
    server.close();
  }
  console.log('\n  ' + pass + ' passed · ' + fail + ' failed · ' + (pass + fail) + ' checks');
  process.exit(fail ? 1 : 0);
})();
