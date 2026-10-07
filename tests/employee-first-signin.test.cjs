/**
 * tests/employee-first-signin.test.cjs — Athi's case, 2026-10-08 (production, unsealed, DEV_OTP=123456):
 * an EMPLOYEE's first sign-in with the first-time code must end SIGNED IN and ASKED TO SET A PIN, on every door;
 * the PIN must then work. A sealed environment never accepts the fixed code.
 *
 * Root cause it guards: /api/actors/login always answered `requires_pin_setup`; the entity door (/api/entities/verify,
 * /api/signin/verify) — which a stored `.br` id reaches from every page, because its dot after the '@' reads as an
 * e-mail — signed the same first-time co-assist in and said nothing, so no page could show the set-PIN step.
 *
 * Run: node tests/employee-first-signin.test.cjs · no network beyond 127.0.0.1, no DB (an in-memory identities table).
 */
'use strict';
const path = require('path');
const http = require('http');
const API = path.join(__dirname, '..');
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

Object.assign(process.env, { JWT_SECRET: 'test-only-secret-employee-first-signin', NODE_ENV: 'development', DEV_OTP: '123456' });
['OTP_EMAIL_ENABLED', 'RESEND_API_KEY', 'FROM_EMAIL', 'PLATFORM_ROOT_ENTITY', 'DEV_OTP_IN_RESPONSE'].forEach((k) => { delete process.env[k]; });

const say = console.log.bind(console);
['log', 'warn', 'error', 'info'].forEach((k) => { console[k] = () => {}; });
let pass = 0, fail = 0;
const t = (name, ok, extra) => { if (ok) { pass++; say('  ok  ' + name); } else { fail++; say('  FAIL ' + name + (extra ? '\n       ' + extra : '')); } };

/* ── the database: the shop and one employee exactly as POST /api/actors wrote them (user_id = key@shop.br, no e-mail) ── */
const FUT = (min) => new Date(Date.now() + min * 60000);
let DB = {};
const reset = () => {
  DB = {
    shop: { identity_type: 'entity', display_name: 'Mayur Bhavan', user_id: 'mayuri123', email: 'owner@mayur.test', bridge_id: 'B-SHOP',
            status: 'active', otp_attempts: 0 },
    bala: { identity_type: 'actor', parent_entity_id: 'shop', actor_key: 'bala', user_id: 'bala@mayuri123.br', display_name: 'Bala',
            email: null, bridge_id: 'B-BALA', actor_role: 'staff', actor_type: 'human', break_status: 'active', status: 'active',
            otp_code: '123456', otp_expires_at: FUT(24 * 60), otp_attempts: 0, pin_hash: null, pin_attempts: 0 },
  };
  Object.keys(DB).forEach((k) => { DB[k].identity_id = k; });
};
const lc = (v) => (v == null ? v : String(v).toLowerCase());
const P = (params, n) => params[Number(n) - 1];
const splitTop = (s, sep) => { const out = []; let d = 0, cur = ''; for (let i = 0; i < s.length; i++) { const c = s[i]; if (c === '(') d++; else if (c === ')') d--;
  if (d === 0 && s.startsWith(sep, i)) { out.push(cur); cur = ''; i += sep.length - 1; continue; } cur += c; } out.push(cur); return out.map((x) => x.trim()).filter(Boolean); };
function where(clause, params) {
  return Object.values(DB).filter((r) => clause.split(/\s+AND\s+/i).every((c) => { let m;
    if ((m = c.match(/^LOWER\((\w+)\) = LOWER\(\$(\d+)\)$/))) return lc(r[m[1]]) === lc(P(params, m[2]));
    if ((m = c.match(/^LOWER\((\w+)\) = \$(\d+)$/))) return lc(r[m[1]]) === P(params, m[2]);
    if ((m = c.match(/^(\w+) = \$(\d+)$/))) return r[m[1]] === P(params, m[2]);
    if ((m = c.match(/^(\w+) = '([^']*)'$/))) return r[m[1]] === m[2];
    throw new Error('stub db: unknown condition ' + c); }));
}
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
  if ((m = s.match(/^SELECT (.+?) FROM identities WHERE (.+)$/i))) { const cols = m[1].split(',').map((x) => x.trim());
    const rows = where(m[2], params).map((r) => { const o = {}; cols.forEach((c) => { o[c] = c === '1' ? 1 : (r[c] === undefined ? null : r[c]); }); return o; });
    return { rows, rowCount: rows.length }; }
  if ((m = s.match(/^UPDATE identities SET (.+?) WHERE (.+)$/i))) { const hit = where(m[2], params);
    hit.forEach((r) => splitTop(m[1], ',').forEach((a) => { const k = a.match(/^(\w+) = (.+)$/); if (!k) throw new Error('stub db: unknown SET ' + a); r[k[1]] = value(k[2].trim(), params, r); }));
    return { rows: [], rowCount: hit.length }; }
  throw new Error('stub db: unknown statement ' + s.slice(0, 120)); }
const stub = (rel, exports) => { const p = require.resolve(path.join(API, rel)); require.cache[p] = { id: p, filename: p, loaded: true, exports }; };
stub('db', { query: q, pool: { query: q, connect: async () => ({ query: q, release() {} }) }, withEntity: async (id, fn) => fn({ query: q }),
  withTransaction: async (fn) => fn({ query: q }), onEntity: async (id, db, fn) => fn({ query: q }), readBatch: async () => ({}),
  trySavepoint: async (db, fn, fb) => { try { return await fn(db); } catch (_) { return fb; } } });
stub('lib/schema', { hasColumn: async () => true, has: async () => true, columns: async () => [], table: async () => ({}) });
stub('lib/schema-bootstrap', { ensureDefaultSchema: async () => {} });
stub('lib/rootlink', { connect: async () => null });
stub('lib/istest', { atRegistration: () => ({ population: null, entity_kind: 'customer' }), ready: async () => true });

const app = express(); app.use(express.json());
app.use('/api/entities', require(path.join(API, 'routes', 'entities')));
app.use('/api/actors', require(path.join(API, 'routes', 'actors')));
app.use('/api/signin', require(path.join(API, 'routes', 'signin')));
let base;
const call = (method, url, body, token) => new Promise((resolve, reject) => { const data = body ? JSON.stringify(body) : null;
  const h = { 'content-type': 'application/json' }; if (token) h.authorization = 'Bearer ' + token; if (data) h['content-length'] = Buffer.byteLength(data);
  const r = http.request(base + url, { method, headers: h }, (res) => { let s = ''; res.on('data', (c) => { s += c; }); res.on('end', () => { let j = null; try { j = JSON.parse(s); } catch (_) {} resolve({ status: res.statusCode, body: j || {} }); }); });
  r.on('error', reject); if (data) r.write(data); r.end(); });
const ID = 'bala@mayuri123.br';
const isBala = (tok) => { try { const c = jwt.decode(tok) || {}; return c.identity_id === 'bala' && c.identity_type === 'actor' && c.parent_entity_id === 'shop'; } catch (_) { return false; } };

/** the whole first day on one door: ask → code → signed in + asked for a PIN → PIN set → PIN signs in, no second asking */
async function firstDay(name, { ask, verify, pin, setPin }) {
  reset();
  say('\n── ' + name + ' ──');
  const a = await ask();
  t('ask: the first-time code is wanted (200, not a PIN)', a.status === 200 && !a.body.use_pin, JSON.stringify(a.body));
  t('   …and the stored code is still the fixed 123456 (unsealed, armed)', DB.bala.otp_code === '123456', DB.bala.otp_code);
  const v = await verify('123456');
  t('123456 signs the employee in (200, token names bala under the shop)', v.status === 200 && isBala(v.body.token), v.status + ' ' + JSON.stringify(v.body).slice(0, 160));
  t('⭐ and the answer says a PIN must be set: requires_pin_setup === true', v.body.requires_pin_setup === true, JSON.stringify(v.body).slice(0, 200));
  t('   the code is spent (otp_code cleared), no PIN yet', DB.bala.otp_code === null && !DB.bala.pin_hash);
  const s = await setPin(v.body.token);
  t('set-pin with that token: 200', s.status === 200, s.status + ' ' + JSON.stringify(s.body));
  t('   …and the row holds the PIN', !!DB.bala.pin_hash && bcrypt.compareSync('4321', DB.bala.pin_hash));
  const again = await ask();
  t('next time, ask wants the PIN (use_pin), issues no code', again.status === 200 && again.body.use_pin === true && DB.bala.otp_code === null, JSON.stringify(again.body));
  const p = await pin('4321');
  t('the PIN signs in (200) and does not ask to set one again', p.status === 200 && isBala(p.body.token) && !p.body.requires_pin_setup, p.status + ' ' + JSON.stringify(p.body).slice(0, 160));
  const w = await pin('9999');
  t('a wrong PIN is refused (400)', w.status === 400, w.status);
}

(async () => {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = 'http://127.0.0.1:' + server.address().port;
  try {
    say('employee first sign-in — unsealed, DEV_OTP=123456, employee ' + ID + ' created with the fixed code, no PIN');

    /* app.html #/login with the .br id (a dot after the '@' → the ENTITY door), and the till's user_id shape */
    await firstDay('old door · /api/entities/register + /verify { user_id }', {
      ask: () => call('POST', '/api/entities/register', { display_name: ID, email: ID, mode: 'login' }),
      verify: (otp) => call('POST', '/api/entities/verify', { user_id: ID, otp }),
      pin: (pin) => call('POST', '/api/entities/verify', { user_id: ID, pin }),
      setPin: (tok) => call('POST', '/api/actors/set-pin', { pin: '4321', confirm_pin: '4321' }, tok),
    });
    /* the new door (M06) — what M14's one sign-in module will call */
    await firstDay('new door · /api/signin/ask + /verify + /pin { id }', {
      ask: () => call('POST', '/api/signin/ask', { id: ID }),
      verify: (otp) => call('POST', '/api/signin/verify', { id: ID, otp }),
      pin: (pin) => call('POST', '/api/signin/verify', { id: ID, pin }),
      setPin: (tok) => call('POST', '/api/signin/pin', { pin: '4321', confirm_pin: '4321' }, tok),
    });
    /* the co-assist door app.html takes for key@Display Name — unchanged, must keep answering the same */
    await firstDay('actor door · /api/actors/login { username: key@Display Name }', {
      ask: async () => { const r = await call('GET', '/api/actors/check-login?username=' + encodeURIComponent('bala@mayur bhavan'));
        return { status: r.status, body: r.body.valid ? { use_pin: !!r.body.has_pin } : { error: 'not valid' } }; },
      verify: (otp) => call('POST', '/api/actors/login', { username: 'bala@mayur bhavan', otp }),
      pin: (pin) => call('POST', '/api/actors/login', { username: 'bala@mayur bhavan', pin }),
      setPin: (tok) => call('POST', '/api/actors/set-pin', { pin: '4321', confirm_pin: '4321' }, tok),
    });

    say('\n── the signal is only for a first-time co-assist ──');
    reset();
    const o = await call('POST', '/api/entities/register', { user_id: 'mayuri123', mode: 'login' });
    const ov = await call('POST', '/api/entities/verify', { user_id: 'mayuri123', otp: '123456' });
    t('the owner signs in with 123456 as before and is never asked for a PIN', o.status === 200 && ov.status === 200 && !('requires_pin_setup' in ov.body), JSON.stringify(ov.body).slice(0, 160));
    const wrong = await call('POST', '/api/entities/verify', { user_id: ID, otp: '000000' });
    t('a wrong first code is refused (400) and carries no signal', wrong.status === 400 && !('requires_pin_setup' in wrong.body), JSON.stringify(wrong.body));

    say('\n── sealed: the fixed code never exists and is never accepted ──');
    process.env.NODE_ENV = 'production';
    reset();
    const minted = require(path.join(API, 'lib', 'employee-code')).mint().otp;
    t('a sealed env mints a real code for a new employee, not DEV_OTP', /^\d{6}$/.test(minted) && minted !== '123456', minted);
    const sa = await call('POST', '/api/entities/register', { display_name: ID, email: ID, mode: 'login' });
    t('sealed ask: 200, and the stored code is no longer 123456', sa.status === 200 && DB.bala.otp_code !== '123456', sa.status + ' ' + DB.bala.otp_code);
    const sv = await call('POST', '/api/entities/verify', { user_id: ID, otp: '123456' });
    t('sealed verify with 123456: refused (400), nobody signed in', sv.status === 400 && !sv.body.token, sv.status + ' ' + JSON.stringify(sv.body));
    process.env.NODE_ENV = 'development';
  } finally { server.close(); }
  say('\n' + (pass + fail) + ' checks · ' + pass + ' passed · ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { say('ERROR ' + (e && e.stack || e)); process.exit(1); });
