/**
 * tests/sec-148-register-address-cap.test.cjs — SEC-148 (C12, 2026-11-12): POST /api/entities/register and the e-mail it sends.
 *   1. a PER-ADDRESS cap (REGISTER_PER_ADDRESS_MAX per hour; here 2) counted before anything is looked up, so a held address and a free one are capped alike:
 *      the same 429 RATE_LIMITED body for both, a different address is not affected, and the key ignores letter case and spaces;
 *   2. a mailer outage reads the same on both paths: the new address ("We couldn't send your code") and the held address (the "already on file" notice
 *      failing) say the SAME words — before, the held path said "Verification code sent" while the fresh one admitted the failure.
 * The real routes/entities.js and routes/signin.js; only the database and the mailer are stand-ins. No network beyond 127.0.0.1, no DB.
 * Run: node tests/sec-148-register-address-cap.test.cjs
 */
'use strict';
const path = require('path');
const http = require('http');
const express = require('express');

process.env.JWT_SECRET = 'test-only-secret-sec-148';
process.env.REGISTER_PER_ADDRESS_MAX = '2';
['DEV_OTP', 'OTP_EMAIL_ENABLED', 'RESEND_API_KEY', 'PLATFORM_ROOT_ENTITY'].forEach((k) => { delete process.env[k]; });
const API = path.join(__dirname, '..');
let pass = 0, fail = 0;
const t = (name, ok, extra) => { if (ok) { pass++; console.log('  ok  ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? '\n       ' + extra : '')); } };

const HELD = new Set(['held@shop.test']);   // addresses a record already holds (a party a shop minted: no account, but identities.email is one global unique)
let INSERTS = 0;
const q = async (sql, args) => {
  const text = String((sql && sql.text) || sql);
  if (/^\s*INSERT INTO identities/.test(text)) {
    INSERTS++;
    if (HELD.has(String(args[3]))) throw Object.assign(new Error('duplicate key'), { code: '23505', constraint: 'identities_email_key' });
    return { rows: [], rowCount: 1 };
  }
  return { rows: [], rowCount: 0 };
};
const stub = (rel, exports) => { const p = require.resolve(path.join(API, rel)); require.cache[p] = { id: p, filename: p, loaded: true, exports }; };
stub('db', { query: q, withEntity: async (id, fn) => fn({ query: q }), withTransaction: async (fn) => fn({ query: q }), readBatch: async () => ({}), trySavepoint: async (d, fn) => fn() });
stub('lib/schema', { hasColumn: async () => true, has: async () => true, hasTable: async () => false, columns: async () => [], table: async () => ({}) });
let MAIL = { delivered: true };   // what the mailer does: both the code mail and the "already on file" notice
const realNotify = require(path.join(API, 'lib', 'notify'));
stub('lib/notify', Object.assign({}, realNotify, { sendOtpEmail: async () => MAIL, sendEmail: async () => MAIL }));

const app = express();
app.use(express.json());
app.use('/api/entities', require(path.join(API, 'routes', 'entities')));
let base;
const register = (email) => new Promise((resolve, reject) => {
  const data = JSON.stringify({ email, display_name: 'Shop ' + Math.random().toString(36).slice(2, 6) });
  const r = http.request(base + '/api/entities/register', { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } }, (res) => {
    let s = ''; res.on('data', (c) => { s += c; });
    res.on('end', () => { let j = null; try { j = JSON.parse(s); } catch (_) { /* a non-JSON body shows in the failure text */ } resolve({ status: res.statusCode, body: j, raw: s.slice(0, 300) }); });
  });
  r.on('error', reject); r.write(data); r.end();
});
const quiet = (fn) => async () => { const k = console.log; console.log = () => {}; try { return await fn(); } finally { console.log = k; } };

(async () => {
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + server.address().port;
  try {
    console.log('— 1 · the per-address cap —');
    const f1 = await quiet(() => register('new@shop.test'))(), f2 = await quiet(() => register('new@shop.test'))(), f3 = await quiet(() => register('new@shop.test'))();
    t('a free address: the first two asks pass (200)', f1.status === 200 && f2.status === 200, f1.raw + ' | ' + f2.raw);
    t('a free address: the third ask in the hour is 429 RATE_LIMITED', f3.status === 429 && f3.body && f3.body.code === 'RATE_LIMITED', f3.raw);
    const h1 = await quiet(() => register('held@shop.test'))(), h2 = await quiet(() => register('held@shop.test'))(), h3 = await quiet(() => register('held@shop.test'))();
    t('a HELD address: the first two asks pass (200), as a free one', h1.status === 200 && h2.status === 200, h1.raw + ' | ' + h2.raw);
    t('a HELD address: the third ask is 429 too', h3.status === 429, h3.raw);
    t('…the SAME 429 status and body for a held address and a free one (the cap says nothing about who holds it)', h3.status === f3.status && JSON.stringify(h3.body && { error: h3.body.error, code: h3.body.code, message: h3.body.message }) === JSON.stringify(f3.body && { error: f3.body.error, code: f3.body.code, message: f3.body.message }), f3.raw + ' vs ' + h3.raw);
    const other = await quiet(() => register('someone-else@shop.test'))();
    t('a different address is not affected by that cap', other.status === 200, other.raw);
    const mixed = await quiet(() => register('  NEW@Shop.Test '))();
    t('the key ignores letter case and spaces: the same address typed in capitals is capped too', mixed.status === 429, mixed.raw);

    console.log('— 2 · a mailer outage reads the same on both paths —');
    MAIL = { delivered: false };
    const nf = await quiet(() => register('outage-free@shop.test'))();
    HELD.add('outage-held@shop.test');
    const oh = await quiet(() => register('outage-held@shop.test'))();
    t('a NEW address with the mailer down says "We couldn\'t send your code" (the honest words)', nf.status === 200 && /couldn.t send your code/.test(nf.body.message), nf.raw);
    t('a HELD address with the mailer down says the SAME words (before: "Verification code sent")', oh.status === 200 && oh.body.message === nf.body.message, oh.raw + ' vs ' + nf.raw);
    MAIL = { delivered: true };
    HELD.add('ok-held@shop.test');
    const okf = await quiet(() => register('ok-free@shop.test'))(), okh = await quiet(() => register('ok-held@shop.test'))();
    t('with the mailer up both say "Verification code sent to your email"', okf.body.message === 'Verification code sent to your email' && okh.body.message === okf.body.message, okf.raw + ' vs ' + okh.raw);
  } finally {
    await new Promise((r) => server.close(r));
  }
  console.log(`\n${pass + fail} checks · ${pass} passed · ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
