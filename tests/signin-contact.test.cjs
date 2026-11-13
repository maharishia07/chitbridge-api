/**
 * CARD  18-identity-sign-in-and-access/sign-in
 * tests/signin-contact.test.cjs — M14 (DECISIONS 2026-10-08): SIGN IN WITH A MOBILE NUMBER OR AN E-MAIL; the .br / .cr grammar
 * is added BEHIND THE SCENES. The one lookup (lib/identity-auth.js findLoginIdentity) resolves a contact to the person behind it:
 *   · the account's own sign-in e-mail (owner)                      · a VERIFIED identity document, PHONE or EMAIL (owner, employee)
 *   · a customer's own contact (identities.phone / otp_contact)    · one contact on several accounts → 409 CHOOSE_IDENTITY, never a guess
 * and /api/signin/ask answers `id` — the stored id the page verifies with — so a person never types `ravi@shop.br`.
 * Invariants: an UNVERIFIED document opens nothing (M18's rule); a missing identity_documents table still signs an owner in by e-mail;
 * every door that worked before (a user id, key@Shop, a typed .br id) answers exactly as it did.
 *
 * Run: node tests/signin-contact.test.cjs · no network beyond 127.0.0.1, no DB (an in-memory identities + identity_documents table).
 */
'use strict';
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const API = path.join(__dirname, '..');
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

Object.assign(process.env, { JWT_SECRET: 'test-only-secret-signin-contact', NODE_ENV: 'development', DEV_OTP: '123456', DATABASE_URL: 'postgres://cb@127.0.0.1:5432/cb_test' /* SEC1: the fixed codes work on a LOCAL stack only */ });
['OTP_EMAIL_ENABLED', 'RESEND_API_KEY', 'FROM_EMAIL', 'PLATFORM_ROOT_ENTITY', 'DEV_OTP_IN_RESPONSE', 'DEV_OTP_CUSTOMER', 'SMS_PROVIDER'].forEach((k) => { delete process.env[k]; });

const say = console.log.bind(console);
['log', 'warn', 'error', 'info'].forEach((k) => { console[k] = () => {}; });
let pass = 0, fail = 0;
const t = (name, ok, extra) => { if (ok) { pass++; say('  ok  ' + name); } else { fail++; say('  FAIL ' + name + (extra ? '\n       ' + extra : '')); } };

/* ── the database ───────────────────────────────────────────────────────────────────────────────────────────────────── */
const docHash = (scheme, raw) => crypto.createHash('sha256').update(String(scheme) + ':' + String(raw)).digest('hex');
const FUT = (min) => new Date(Date.now() + min * 60000);
let DB = {}, DOCS = [], DOCS_TABLE = true;
const reset = () => {
  DB = {
    /* two shops. Athi owns Mayur Bhavan and is also an employee at Alpha; his mobile is VERIFIED on both */
    mayur: { identity_type: 'entity', display_name: 'Mayur Bhavan', user_id: 'mayuri123', email: 'athi@mayur.test', bridge_id: 'B-MAYUR', status: 'active', otp_attempts: 0 },
    alpha: { identity_type: 'entity', display_name: 'Alpha Timers', user_id: 'alpha-timers', email: 'owner@alpha.test', bridge_id: 'B-ALPHA', status: 'active', otp_attempts: 0 },
    athiAtAlpha: { identity_type: 'actor', parent_entity_id: 'alpha', actor_key: 'athi', user_id: 'athi@alpha-timers.br', display_name: 'Athi',
                   email: null, bridge_id: 'B-AA', actor_role: 'staff', actor_type: 'human', break_status: 'active', status: 'active', pin_hash: bcrypt.hashSync('2580', 4), pin_attempts: 0 },
    /* Bala: first day at Mayur Bhavan — the owner shared the code, no PIN yet; his mobile is verified, his e-mail is NOT */
    bala: { identity_type: 'actor', parent_entity_id: 'mayur', actor_key: 'bala', user_id: 'bala@mayuri123.br', display_name: 'Bala',
            email: null, bridge_id: 'B-BALA', actor_role: 'staff', actor_type: 'human', break_status: 'active', status: 'active',
            otp_code: '123456', otp_expires_at: FUT(24 * 60), otp_attempts: 0, pin_hash: null, pin_attempts: 0 },
    /* Kavi: a customer of Mayur Bhavan, by e-mail (the storefront's .cr handle is the email column; otp_contact the address) */
    kavi: { identity_type: 'customer', parent_entity_id: 'mayur', display_name: 'Kavi', email: 'kavi=mail.test@mayuri123.cr', phone: null,
            otp_contact: 'kavi@mail.test', bridge_id: 'B-KAVI', status: 'active', otp_attempts: 0 },
  };
  Object.keys(DB).forEach((k) => { DB[k].identity_id = k; });
  DOCS = [
    { identity_id: 'mayur', scheme: 'PHONE', value_hash: docHash('PHONE', '9876543210'), status: 'verified', verified_at: 'NOW' },
    { identity_id: 'athiAtAlpha', scheme: 'PHONE', value_hash: docHash('PHONE', '+9876543210'), status: 'verified', verified_at: 'NOW' },
    { identity_id: 'bala', scheme: 'PHONE', value_hash: docHash('PHONE', '9000000001'), status: 'verified', verified_at: 'NOW' },
    { identity_id: 'bala', scheme: 'EMAIL', value_hash: docHash('EMAIL', 'bala@mail.test'), status: 'pending', verified_at: null },
  ];
  DOCS_TABLE = true;
};
const lc = (v) => (v == null ? v : String(v).toLowerCase());
const P = (params, n) => params[Number(n) - 1];
const splitTop = (s, sep) => { const out = []; let d = 0, cur = ''; for (let i = 0; i < s.length; i++) { const c = s[i]; if (c === '(') d++; else if (c === ')') d--;
  if (d === 0 && s.startsWith(sep, i)) { out.push(cur); cur = ''; i += sep.length - 1; continue; } cur += c; } out.push(cur); return out.map((x) => x.trim()).filter(Boolean); };
function cond(c, params, r) {
  let m; c = c.trim();
  if (c.startsWith('(') && c.endsWith(')')) return splitTop(c.slice(1, -1), ' OR ').some((x) => cond(x, params, r));
  if ((m = c.match(/^LOWER\((\w+)\) = LOWER\(\$(\d+)\)$/))) return lc(r[m[1]]) === lc(P(params, m[2]));
  if ((m = c.match(/^LOWER\((\w+)\) = \$(\d+)$/))) return lc(r[m[1]]) === P(params, m[2]);
  if ((m = c.match(/^(\w+) = \$(\d+)$/))) return r[m[1]] === P(params, m[2]);
  if ((m = c.match(/^(\w+) = '([^']*)'$/))) return r[m[1]] === m[2];
  if ((m = c.match(/^(\w+) IS NOT NULL$/))) return r[m[1]] != null;
  if ((m = c.match(/^(\w+) = ANY\(\$(\d+)::(?:text|uuid)\[\]\)$/))) return (P(params, m[2]) || []).indexOf(r[m[1]]) >= 0;
  throw new Error('stub db: unknown condition ' + c);
}
const where = (rows, clause, params) => rows.filter((r) => splitTop(clause, ' AND ').every((c) => cond(c, params, r)));
function value(expr, params, row) { let m;
  if ((m = expr.match(/^\$(\d+)$/))) return P(params, m[1]);
  if (/^NOW\(\)$/i.test(expr)) return 'NOW'; if (/^NULL$/i.test(expr)) return null; if (/^TRUE$/i.test(expr)) return true;
  if (/^-?\d+$/.test(expr)) return Number(expr); if ((m = expr.match(/^'([^']*)'$/))) return m[1];
  if ((m = expr.match(/^COALESCE\((\w+), 0\) \+ 1$/i))) return (row[m[1]] || 0) + 1;
  if ((m = expr.match(/^COALESCE\((\w+), \$(\d+)\)$/i))) return row[m[1]] != null ? row[m[1]] : P(params, m[2]);
  throw new Error('stub db: unknown value ' + expr); }
async function q(sql, params) { params = params || []; const s = String(sql).replace(/\s+/g, ' ').trim(); let m;
  if (/^INSERT INTO (signin_events|identities)/i.test(s)) return { rows: [], rowCount: 1 };
  if (/FROM (constitution|installation)\b/i.test(s) || /policy_flags/.test(s)) return { rows: [] };
  if ((m = s.match(/^SELECT DISTINCT identity_id FROM identity_documents WHERE (.+)$/i))) {
    if (!DOCS_TABLE) throw new Error('relation "identity_documents" does not exist');
    const seen = new Set(); return { rows: where(DOCS, m[1], params).filter((d) => !seen.has(d.identity_id) && seen.add(d.identity_id)).map((d) => ({ identity_id: d.identity_id })) };
  }
  if (/identity_documents/i.test(s)) throw new Error('stub db: a second reader of identity_documents: ' + s.slice(0, 100));
  if ((m = s.match(/^SELECT (.+?) FROM identities WHERE (.+)$/i))) { const cols = m[1].split(',').map((x) => x.trim());
    const rows = where(Object.values(DB), m[2], params).map((r) => { const o = {}; cols.forEach((c) => { o[c] = c === '1' ? 1 : (r[c] === undefined ? null : r[c]); }); return o; });
    return { rows, rowCount: rows.length }; }
  if ((m = s.match(/^UPDATE identities SET (.+?) WHERE (.+)$/i))) { const hit = where(Object.values(DB), m[2], params);
    hit.forEach((r) => splitTop(m[1], ',').forEach((a) => { const k = a.match(/^(\w+) = (.+)$/); if (!k) throw new Error('stub db: unknown SET ' + a); r[k[1]] = value(k[2].trim(), params, r); }));
    return { rows: [], rowCount: hit.length }; }
  throw new Error('stub db: unknown statement ' + s.slice(0, 120)); }
const stub = (rel, exports) => { const p = require.resolve(path.join(API, rel)); require.cache[p] = { id: p, filename: p, loaded: true, exports }; };
stub('db', { query: q, pool: { query: q, connect: async () => ({ query: q, release() {} }) }, withEntity: async (id, fn) => fn({ query: q }),
  withTransaction: async (fn) => fn({ query: q }), onEntity: async (id, db, fn) => fn({ query: q }), readBatch: async () => ({}),
  trySavepoint: async (db, fn, fb) => { try { return await fn(db); } catch (_) { return fb; } } });
stub('lib/schema', { hasColumn: async () => true, hasColumns: async () => true, hasTable: async () => DOCS_TABLE, has: async () => true, columns: async () => [], table: async () => ({}) });
stub('lib/schema-bootstrap', { ensureDefaultSchema: async () => {} });
stub('lib/rootlink', { connect: async () => null });
stub('lib/istest', { atRegistration: () => ({ population: null, entity_kind: 'customer' }), ready: async () => true });

const app = express(); app.use(express.json());
app.use('/api/entities', require(path.join(API, 'routes', 'entities')));
app.use('/api/signin', require(path.join(API, 'routes', 'signin')));
let base;
const call = (method, url, body, token) => new Promise((resolve, reject) => { const data = body ? JSON.stringify(body) : null;
  const h = { 'content-type': 'application/json' }; if (token) h.authorization = 'Bearer ' + token; if (data) h['content-length'] = Buffer.byteLength(data);
  const r = http.request(base + url, { method, headers: h }, (res) => { let s = ''; res.on('data', (c) => { s += c; }); res.on('end', () => { let j = null; try { j = JSON.parse(s); } catch (_) {} resolve({ status: res.statusCode, body: j || {} }); }); });
  r.on('error', reject); if (data) r.write(data); r.end(); });
const claims = (tok) => { try { return jwt.decode(tok) || {}; } catch (_) { return {}; } };
const ask = (id) => call('POST', '/api/signin/ask', { id });
const ONE = (r) => r.status === 200 && r.body.need === 'pin_or_code' && Object.keys(r.body).every((k) => ['message', 'need', 'dev_otp'].includes(k)); /* SEC-143: ask says the same to everyone */
const verify = (id, cred) => call('POST', '/api/signin/verify', Object.assign({ id }, cred));

(async () => {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = 'http://127.0.0.1:' + server.address().port;
  try {
    say('M14 — sign in with a mobile number or an e-mail; the grammar is added behind the scenes');

    say('\n── the owner, by the e-mail the shop signed up with, and by a verified mobile ──');
    reset();
    let a = await ask('athi@mayur.test');
    t('owner by e-mail: the one ask answer (no kind, no id), and the code is stored on the shop', ONE(a) && !!DB.mayur.otp_code, JSON.stringify(a.body));
    let v = await verify('athi@mayur.test', { otp: '123456' });
    t('   …and 123456 signs the owner in (token is the shop)', v.status === 200 && claims(v.body.token).identity_id === 'mayur', v.status + ' ' + JSON.stringify(v.body).slice(0, 120));
    reset(); DOCS = DOCS.filter((d) => d.identity_id !== 'athiAtAlpha');   /* only Mayur holds this number now */
    a = await ask('98765 43210');
    t('⭐ owner by mobile (typed with a space): found through the VERIFIED phone document — the one answer, the code stored on the shop', ONE(a) && !!DB.mayur.otp_code, JSON.stringify(a.body));
    v = await verify('9876543210', { otp: '123456' });
    t('   …and the code signs the owner in by the same number', v.status === 200 && claims(v.body.token).identity_id === 'mayur', v.status + ' ' + JSON.stringify(v.body).slice(0, 120));
    v = await verify('mayuri123', { otp: '123456' });
    t('   a spent code is spent: verifying again with it is refused', v.status === 400, v.status);

    say('\n── the employee, by mobile: first-time code → signed in and asked to set a PIN → the PIN works ──');
    reset();
    a = await ask('9000000001');
    t('⭐ employee by mobile: the one answer (no kind, no id); the code is stored on bala', ONE(a) && !!DB.bala.otp_code, JSON.stringify(a.body));
    v = await verify('bala@mayuri123.br', { otp: '123456' });
    t('   the code signs Bala in under Mayur Bhavan and says requires_pin_setup', v.status === 200 && claims(v.body.token).identity_id === 'bala' && claims(v.body.token).parent_entity_id === 'mayur' && v.body.requires_pin_setup === true, v.status + ' ' + JSON.stringify(v.body).slice(0, 160));
    const sp = await call('POST', '/api/signin/pin', { pin: '4826', confirm_pin: '4826' }, v.body.token);
    t('   /api/signin/pin sets it', sp.status === 200 && !!DB.bala.pin_hash, sp.status + ' ' + JSON.stringify(sp.body));
    a = await ask('9000000001');
    t('   next time by the same mobile: the same answer, and no code issued', ONE(a) && !DB.bala.otp_code, JSON.stringify(a.body));
    v = await verify('9000000001', { pin: '4826' });
    t('   ⭐ the PIN signs him in BY MOBILE (no .br typed) and does not ask again', v.status === 200 && claims(v.body.token).identity_id === 'bala' && !v.body.requires_pin_setup, v.status + ' ' + JSON.stringify(v.body).slice(0, 120));
    a = await ask('bala@mail.test');
    t('⚠️ an UNVERIFIED e-mail document opens nothing (M18): the one answer, no code made', ONE(a) && !DB.bala.otp_code, JSON.stringify(a.body));
    DOCS.find((d) => d.scheme === 'EMAIL').status = 'verified'; DOCS.find((d) => d.scheme === 'EMAIL').verified_at = 'NOW';
    a = await ask('Bala@Mail.test');
    t('   verified, the same e-mail finds him (case-insensitively): the same answer, and he has a PIN so no code', ONE(a) && !DB.bala.otp_code, JSON.stringify(a.body));

    say('\n── the customer, by the e-mail the storefront proved ──');
    reset();
    a = await ask('kavi@mail.test');
    t('⭐ customer by e-mail: the one answer (no kind, no handle); the customer\'s own fixed code (123123) is set', ONE(a) && DB.kavi.otp_code === '123123', JSON.stringify(a.body) + ' otp=' + DB.kavi.otp_code);
    v = await verify('kavi@mail.test', { otp: '123123' });
    t('   the code signs the customer in: a customer token under the shop, no PIN step, no onboarding (status untouched)', v.status === 200 && claims(v.body.token).identity_type === 'customer' && claims(v.body.token).parent_entity_id === 'mayur' && !('requires_pin_setup' in v.body) && DB.kavi.status === 'active', v.status + ' ' + JSON.stringify(v.body).slice(0, 160));
    v = await verify('kavi=mail.test@mayuri123.cr', { otp: '123123' });
    t('   the .cr handle the chooser would hand back also verifies (grammar behind the scenes) — the spent code is refused', v.status === 400, v.status);

    say('\n── one contact, two people: the door asks which — never guesses ──');
    reset();
    a = await ask('+98765 43210');
    t('⭐ SEC-143: a mobile on the owner here and the employee there: the one answer, no list of choices, no code made', ONE(a) && !('choices' in a.body) && !DB.mayur.otp_code && !DB.athiAtAlpha.otp_code, a.status + ' ' + JSON.stringify(a.body));
    a = await ask('athi@alpha-timers.br');
    t('   a typed stored id still gets the one answer (the PIN employee: no code)', ONE(a) && !DB.athiAtAlpha.otp_code, JSON.stringify(a.body));
    /* SEC-143 (Athi 2026-11-07): the chooser comes AFTER the secret. The owner (code) and the employee (PIN) share one mobile. */
    const FUTURE = new Date(Date.now() + 3600e3);
    DB.mayur.otp_code = '123456'; DB.mayur.otp_expires_at = FUTURE;
    v = await verify('9876543210', { pin: '2580' });
    t('   ⭐ the secret opens ONE account (his PIN): signed in as the employee at Alpha, no chooser', v.status === 200 && claims(v.body.token).identity_id === 'athiAtAlpha', v.status + ' ' + JSON.stringify(v.body).slice(0, 120));
    reset(); DB.mayur.otp_code = '123456'; DB.mayur.otp_expires_at = FUTURE;
    v = await verify('9876543210', { otp: '123456' });
    t('   ⭐ the code opens ONE account (the owner\'s): signed in as the owner', v.status === 200 && claims(v.body.token).identity_id === 'mayur', v.status + ' ' + JSON.stringify(v.body).slice(0, 120));
    reset(); delete DB.athiAtAlpha.pin_hash; DB.athiAtAlpha.otp_code = '123456'; DB.athiAtAlpha.otp_expires_at = FUTURE; DB.mayur.otp_code = '123456'; DB.mayur.otp_expires_at = FUTURE;
    v = await verify('9876543210', { otp: '123456' });
    const chosen = (v.body.choices || []).map((c) => c.kind + ':' + c.id).sort().join(' | ');
    t('   ⭐ the secret opens TWO accounts: 409 CHOOSE_IDENTITY listing exactly those two', v.status === 409 && v.body.code === 'CHOOSE_IDENTITY' && chosen === 'employee:athi@alpha-timers.br | owner:mayuri123' && !v.body.token, v.status + ' ' + chosen);
    t('   …and listing opened nothing: both codes are still held', DB.mayur.otp_code === '123456' && DB.athiAtAlpha.otp_code === '123456');
    v = await verify('mayuri123', { otp: '123456' });
    t('   …then the chosen stored id with the same code signs that account in', v.status === 200 && claims(v.body.token).identity_id === 'mayur', v.status + ' ' + JSON.stringify(v.body).slice(0, 100));
    reset(); DB.mayur.otp_code = '123456'; DB.mayur.otp_expires_at = FUTURE;
    const missBefore = JSON.stringify([DB.mayur.otp_attempts || 0, DB.athiAtAlpha.pin_attempts || 0, DB.athiAtAlpha.otp_attempts || 0]);
    v = await verify('9876543210', { pin: '1111' });
    const gh = await verify('9999999999', { pin: '1111' });
    t('   a wrong secret: the one refusal, the same as an unknown contact', v.status === 400 && v.body.code === 'SIGNIN_REFUSED' && JSON.stringify(v.body) === JSON.stringify(gh.body), v.status + ' ' + JSON.stringify(v.body).slice(0, 100));
    t('   …and NO account was charged a miss (the owner\'s code and the employee\'s PIN are both untouched)', JSON.stringify([DB.mayur.otp_attempts || 0, DB.athiAtAlpha.pin_attempts || 0, DB.athiAtAlpha.otp_attempts || 0]) === missBefore, JSON.stringify([DB.mayur.otp_attempts, DB.athiAtAlpha.pin_attempts, DB.athiAtAlpha.otp_attempts]));
    for (let i = 0; i < 6; i++) await verify('9876543210', { pin: '1111' });
    v = await verify('athi@alpha-timers.br', { pin: '2580' });
    t('   ⭐ even after many wrong tries on the contact, the other account still signs in by its own id (nobody is locked out)', v.status === 200 && claims(v.body.token).identity_id === 'athiAtAlpha', v.status + ' ' + JSON.stringify(v.body).slice(0, 100));
    v = await verify('9876543210', { pin: '2580' });
    t('   …but the contact itself is shut after its misses (5 per window), even for the right secret', v.status === 400 && v.body.code === 'SIGNIN_REFUSED', v.status + ' ' + JSON.stringify(v.body).slice(0, 100));
    await require(path.join(API, 'lib', 'dev-otp')).contactGuessReset('9876543210');
    reset();
    v = await verify('athi@alpha-timers.br', { pin: '2580' });
    t('   …and the chosen id signs him in at Alpha (the stored-id door has its own budget)', v.status === 200 && claims(v.body.token).identity_id === 'athiAtAlpha', v.status + ' ' + JSON.stringify(v.body).slice(0, 120));
    /* SEC-143 round 4: a proven secret pays back exactly ONE miss (budget 5): 4 misses, a sign-in, 2 misses shuts; it never washes the count out */
    const dev = require(path.join(API, 'lib', 'dev-otp'));
    const miss = (n) => (async () => { for (let k = 0; k < n; k++) await verify('9876543210', { pin: '1111' }); })();
    await dev.contactGuessReset('9876543210'); reset();
    await miss(4);
    v = await verify('9876543210', { pin: '2580' });
    t('   4 misses, then the right PIN: signed in (and one miss paid back: 3 left on the books)', v.status === 200 && claims(v.body.token).identity_id === 'athiAtAlpha', v.status);
    await miss(1);
    v = await verify('9876543210', { pin: '2580' });
    t('   ⭐ …4 on the books after one more miss: the contact still opens', v.status === 200 && claims(v.body.token).identity_id === 'athiAtAlpha', v.status + ' ' + JSON.stringify(v.body).slice(0, 80));
    await dev.contactGuessReset('9876543210');
    await miss(4); await verify('9876543210', { pin: '2580' }); await miss(2);
    v = await verify('9876543210', { pin: '2580' });
    t('   ⭐ 4 misses, a sign-in (pays back one), 2 misses = 5 on the books: the contact is shut, even for the right PIN', v.status === 400 && v.body.code === 'SIGNIN_REFUSED', v.status + ' ' + JSON.stringify(v.body).slice(0, 80));
    await dev.contactGuessReset('9876543210'); reset();
    let misses = 0, shut = false;
    while (misses < 12 && !shut) { await miss(1); misses++; shut = (await verify('9876543210', { pin: '2580' })).status === 400; }
    t('   ⭐ one wrong guess, one own sign-in, repeated: only the FIRST sign-in of the window pays a miss back, so the contact shuts within 6 misses (took ' + misses + ')', shut && misses <= 6, 'misses ' + misses);
    await dev.contactGuessReset('9876543210');

    await dev.contactGuessReset('9876543210');
    for (let k = 0; k < 8; k++) await dev.contactGuessMiss('9876543210');
    await Promise.all(Array.from({ length: 10 }, () => dev.contactGuessRefund('9876543210')));
    t('   ⭐ ten refunds at once on a shut contact (8 misses): at most one is paid, the contact stays shut', await dev.contactGuessShut('9876543210'), 'open after 10 concurrent refunds');
    await dev.contactGuessReset('9876543210');

    /* SEC-143 round 2: a wrong PIN costs the same time with no account, 1, 2 or 3 PIN holders behind the contact (and for a code) */
    const median = (xs) => xs.slice().sort((p, q) => p - q)[Math.floor(xs.length / 2)];
    const timed = async (id, cred) => { const t0 = process.hrtime.bigint(); await verify(id, cred); return Number(process.hrtime.bigint() - t0) / 1e6; };
    const pairedRatio = async (x, y, n) => { const r = []; for (let k = 0; k < n; k++) { const a1 = await x(), b1 = await y(); r.push(a1 / Math.max(b1, 0.01)); } return median(r); };
    const holder = (k, n) => { DB[k] = { identity_type: 'actor', parent_entity_id: 'alpha', actor_key: k, user_id: k + '@alpha-timers.br', display_name: k, bridge_id: 'B-' + k, actor_role: 'staff', actor_type: 'human', break_status: 'active', status: 'active', pin_hash: bcrypt.hashSync('2580', 10), pin_attempts: 0, identity_id: k }; DOCS.push({ identity_id: k, scheme: 'PHONE', value_hash: docHash('PHONE', '9876543210'), status: 'verified', verified_at: 'NOW' }); };
    reset(); DB.athiAtAlpha.pin_hash = bcrypt.hashSync('2580', 10);
    const cases = [['1 PIN holder', 0], ['2 PIN holders', 1], ['3 PIN holders', 2]];
    await verify('9999999999', { pin: '1111' });
    for (const [label, extra] of cases) {
      for (let k = 0; k < extra; k++) holder('pp' + k);
      await dev.contactGuessReset('9876543210');
      const wrong = () => timed('9876543210', { pin: '1111' }).then(async (ms) => { await dev.contactGuessReset('9876543210'); return ms; });
      const rr = await pairedRatio(wrong, () => timed('9999999999', { pin: '1111' }), 7);
      t('   ⭐ timing: a wrong PIN at a contact shared with the owner, with ' + label + ' takes as long as an unknown contact (paired ratio ' + rr.toFixed(2) + ')', rr > 0.8 && rr < 1.25, String(rr));
    }
    await dev.contactGuessReset('9876543210');
    const rc = await pairedRatio(() => timed('9876543210', { otp: '000000' }), () => timed('9999999999', { pin: '1111' }), 7);
    await dev.contactGuessReset('9876543210');
    t('   …and a wrong code at that contact takes the same (paired ratio ' + rc.toFixed(2) + ')', rc > 0.8 && rc < 1.25, String(rc));
    reset();
    DB.athiAtAlpha.break_status = 'removed';
    a = await ask('9876543210');
    t('   a removed employee is not offered: the number is the owner\'s alone again (the owner gets the code)', ONE(a) && !!DB.mayur.otp_code, a.status + ' ' + JSON.stringify(a.body).slice(0, 120));

    say('\n── nothing that worked before changes ──');
    reset();
    a = await ask('bala@mayuri123.br');
    t('a typed .br id: the one answer, the first-day code stored', ONE(a) && !!DB.bala.otp_code, JSON.stringify(a.body));
    a = await ask('mayuri123');
    t('a user id: the one answer, the code stored on the shop', ONE(a) && !!DB.mayur.otp_code, JSON.stringify(a.body));
    a = await call('POST', '/api/entities/register', { display_name: 'athi@mayur.test', email: 'athi@mayur.test', mode: 'login' });
    t('the old door by e-mail: 200, the same one answer, and no kind/id leak onto it', a.status === 200 && !('kind' in a.body) && !('id' in a.body) && a.body.need === 'pin_or_code', JSON.stringify(a.body));
    a = await ask('nobody@nowhere.test');
    t('an unknown e-mail: the one answer, nothing created', ONE(a) && Object.keys(DB).length === 5, a.status + ' ' + JSON.stringify(a.body));
    a = await ask('9999999999');
    t('an unknown mobile: the one answer', ONE(a), a.status + ' ' + JSON.stringify(a.body));
    reset(); DOCS_TABLE = false;
    a = await ask('athi@mayur.test');
    t('⚠️ identity_documents not migrated yet: the owner still signs in by e-mail (the document lookup is skipped, not a 500)', ONE(a) && !!DB.mayur.otp_code, a.status + ' ' + JSON.stringify(a.body));
    a = await ask('9000000001');
    t('   …and a mobile is simply not found yet (the one answer, no crash)', ONE(a), a.status + ' ' + JSON.stringify(a.body));

    say('\n── M202 · a shop-named door adds the @shop behind the scenes ──');
    reset();
    a = await call('POST', '/api/signin/ask', { id: 'bala', shop: 'mayuri123' });
    t('a bare short id + the shop the counter names → found (the one answer, the first-day code stored)', ONE(a) && !!DB.bala.otp_code, a.status + ' ' + JSON.stringify(a.body));
    a = await ask('bala');
    t('the same short id with NO shop context → not found (never guessed across shops): the one answer', ONE(a), a.status + ' ' + JSON.stringify(a.body));
    a = await call('POST', '/api/signin/ask', { id: 'bala', shop: 'alpha-timers' });
    t('…and named at ANOTHER shop → not found there: the one answer', ONE(a), a.status + ' ' + JSON.stringify(a.body));
    a = await call('POST', '/api/signin/ask', { id: '9876543210', shop: 'alpha-timers' });
    t('a shared mobile with a shop named: the one answer, no list of choices', ONE(a) && !('choices' in a.body), a.status + ' ' + JSON.stringify(a.body));
    a = await call('POST', '/api/signin/ask', { id: 'athi@mayur.test', shop: 'alpha-timers' });
    t('an e-mail still works with a shop named: the one answer, the code stored', ONE(a) && !!DB.mayur.otp_code, a.status + ' ' + JSON.stringify(a.body));
    a = await call('POST', '/api/signin/ask', { id: 'mayuri123', shop: 'alpha-timers' });
    t('an owner exact handle still works with a shop named (falls back to the exact id)', ONE(a), a.status + ' ' + JSON.stringify(a.body));
    v = await call('POST', '/api/signin/verify', { id: 'bala', shop: 'mayuri123', otp: '123456' });
    t('verify with the short id + shop signs the same person in', v.status === 200 && claims(v.body.token).identity_id === 'bala', v.status + ' ' + JSON.stringify(v.body).slice(0, 120));
  } finally { server.close(); }
  say('\n' + (pass + fail) + ' checks · ' + pass + ' passed · ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { say('ERROR ' + (e && e.stack || e)); process.exit(1); });
