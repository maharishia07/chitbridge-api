/**
 * tests/signin-ask-pin-register.test.cjs — what POST /api/signin/ask · /pin and POST /api/entities/register · /verify DO.
 *
 * The real routers (entities, actors, signin) over an in-memory identities table (the stand-in of tests/signin-routes.test.cjs, which
 * proves the old paths and the new door are ONE handler; this file holds the behaviour of each route on its own):
 *   · ask: a known id is sent a code (kind says PIN or code), an unknown id is NO_ACCOUNT, an empty body is refused 400, a store with no inbox is refused
 *   · entities/register: login mode asks for a code for a known shop; an unknown e-mail registers a NEW shop row (one INSERT)
 *   · entities/verify: the right code signs in (a token whose claims name the shop), a wrong one is refused with no token, six wrong codes lock
 *   · pin: a signed-in co-assist sets a PIN that then signs in; a mismatch / 5 digits is 400; no token is 401; the PIN is stored as a hash
 * Run: node tests/signin-ask-pin-register.test.cjs · no network beyond 127.0.0.1, no DB.
 */
'use strict';
const path = require('path');
const http = require('http');
const API = path.join(__dirname, '..');

const need = (m) => require(require.resolve(m, { paths: [API, __dirname] }));
const jwt = need('jsonwebtoken');
const express = need('express');
const bcrypt = need('bcryptjs');

Object.assign(process.env, { JWT_SECRET: 'test-only-secret-signin-routes', NODE_ENV: 'development', DEV_OTP: '123456', DEV_OTP_IN_RESPONSE: 'true', DATABASE_URL: 'postgres://cb@127.0.0.1:5432/cb_test' /* SEC1: the fixed codes work on a LOCAL stack only */ });
['OTP_EMAIL_ENABLED', 'RESEND_API_KEY', 'PLATFORM_ROOT_ENTITY', 'DEV_OTP_CUSTOMER'].forEach((k) => { delete process.env[k]; });

/* ── output: the routes talk on the console; keep ours, collect theirs ───────────────────────────────────────────── */
const say = console.log.bind(console);
let LOGS = [];
const hush = () => { ['log', 'warn', 'error', 'info'].forEach((k) => { console[k] = (...a) => { LOGS.push(k + ' ' + a.map(String).join(' ')); }; }); };
let pass = 0, fail = 0;
const t = (name, ok, extra) => { if (ok) { pass++; say('  ok  ' + name); } else { fail++; say('  FAIL ' + name + (extra ? '\n       ' + extra : '')); } };

/* ── the database: one identities table, a tiny SQL reader that refuses what it does not understand ───────────────── */
const H1234 = bcrypt.hashSync('1234', 4);
const FUT = (min) => new Date(Date.now() + min * 60000);
const SEED = () => ({
  shop1: { identity_type: 'entity', display_name: 'Shop One', user_id: 'shopone', email: 'owner@shop.test', bridge_id: 'B-SHOP1',
           status: 'active', otp_code: '111111', otp_expires_at: FUT(30), otp_attempts: 0 },
  twinA: { identity_type: 'entity', display_name: 'Twin', user_id: 'twin-a', email: 'a@twin.test', bridge_id: 'B-TA', status: 'active' },
  twinB: { identity_type: 'entity', display_name: 'Twin', user_id: 'twin-b', email: 'b@twin.test', bridge_id: 'B-TB', status: 'active' },
  store1: { identity_type: 'entity', display_name: 'Net Store', user_id: 'net.store', email: null, bridge_id: 'B-NS', status: 'active' },
  ravi: { identity_type: 'actor', parent_entity_id: 'shop1', actor_key: 'ravi', user_id: 'ravi@shopone.br', display_name: 'Ravi',
          email: 'ravi@mail.test', owner_scope: 'scope-from-row', bridge_id: 'B-RAVI', actor_role: 'staff', actor_type: 'human',
          break_status: 'active', status: 'active', pin_hash: H1234, pin_attempts: 0, hat: 'act', access_level: 'editor' },
  mala: { identity_type: 'actor', parent_entity_id: 'shop1', actor_key: 'mala', user_id: 'mala@shopone.br', display_name: 'Mala',
          bridge_id: 'B-MALA', actor_role: 'staff', actor_type: 'human', break_status: 'active', status: 'pending',
          otp_code: '654321', otp_expires_at: FUT(24 * 60), otp_attempts: 0 },
  gone: { identity_type: 'actor', parent_entity_id: 'shop1', actor_key: 'gone', user_id: 'gone@shopone.br', display_name: 'Gone',
          bridge_id: 'B-GONE', break_status: 'removed', status: 'active', pin_hash: H1234, pin_attempts: 0 },
  lockd: { identity_type: 'actor', parent_entity_id: 'shop1', actor_key: 'lockd', user_id: 'lockd@shopone.br', display_name: 'Locked',
           bridge_id: 'B-LOCK', break_status: 'active', status: 'active', pin_hash: H1234, pin_attempts: 5, pin_locked_at: 'PAST' },
});
let DB = {}, EVENTS = [], INSERTS = [], B282 = true, EVENT_FAIL = null;
const reset = () => {
  DB = SEED(); Object.keys(DB).forEach((k) => { DB[k].identity_id = k; });
  EVENTS = []; INSERTS = []; B282 = true; EVENT_FAIL = null;
};
const lc = (v) => (v == null ? v : String(v).toLowerCase());
const splitTop = (s, sep) => {            // split on `sep` outside parentheses
  const out = []; let d = 0, cur = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '(') d++; else if (c === ')') d--;
    if (d === 0 && s.startsWith(sep, i)) { out.push(cur); cur = ''; i += sep.length - 1; continue; }
    cur += c;
  }
  out.push(cur); return out.map((x) => x.trim()).filter(Boolean);
};
const P = (params, n) => params[Number(n) - 1];
function where(clause, params) {
  const conds = clause.split(/\s+AND\s+/i);
  return Object.values(DB).filter((r) => conds.every((c) => {
    let m;
    if ((m = c.match(/^LOWER\((\w+)\) = LOWER\(\$(\d+)\)$/))) return lc(r[m[1]]) === lc(P(params, m[2]));
    if ((m = c.match(/^LOWER\((\w+)\) = \$(\d+)$/))) return lc(r[m[1]]) === P(params, m[2]);
    if ((m = c.match(/^(\w+) = \$(\d+)$/))) return r[m[1]] === P(params, m[2]);
    if ((m = c.match(/^(\w+) = '([^']*)'$/))) return r[m[1]] === m[2];
    throw new Error('stub db: unknown condition ' + c);
  }));
}
function value(expr, params, row) {
  let m;
  if ((m = expr.match(/^\$(\d+)$/))) return P(params, m[1]);
  if (/^NOW\(\)$/i.test(expr)) return 'NOW';
  if (/^NULL$/i.test(expr)) return null;
  if (/^TRUE$/i.test(expr)) return true;
  if (/^-?\d+$/.test(expr)) return Number(expr);
  if ((m = expr.match(/^'([^']*)'$/))) return m[1];
  if ((m = expr.match(/^COALESCE\((\w+), 0\) \+ 1$/i))) return (row[m[1]] || 0) + 1;
  if ((m = expr.match(/^COALESCE\((\w+), \$(\d+)\)$/i))) return row[m[1]] != null ? row[m[1]] : P(params, m[2]);
  throw new Error('stub db: unknown value ' + expr);
}
async function q(sql, params) {
  params = params || [];
  const s = String(sql).replace(/\s+/g, ' ').trim();
  let m;
  if ((m = s.match(/^INSERT INTO signin_events \(([^)]+)\) VALUES/i))) {
    if (!B282) { const e = new Error('relation "signin_events" does not exist'); e.code = '42P01'; throw e; }
    if (EVENT_FAIL) { const e = new Error('simulated'); e.code = EVENT_FAIL; throw e; }
    const row = {}; m[1].split(',').map((x) => x.trim()).forEach((c, i) => { row[c] = params[i] === undefined ? null : params[i]; });
    EVENTS.push(row); return { rows: [], rowCount: 1 };
  }
  if (/^INSERT INTO identities/i.test(s)) { INSERTS.push(params); return { rows: [], rowCount: 1 }; }
  if (/FROM (constitution|installation)\b/i.test(s)) return { rows: [] };
  if ((m = s.match(/^SELECT (.+?) FROM identities WHERE (.+)$/i))) {
    const cols = m[1].split(',').map((x) => x.trim());
    /* projected to the columns the statement names — a column it did not SELECT is not in the row (as in Postgres) */
    const rows = where(m[2], params).map((r) => {
      const o = {}; cols.forEach((c) => { o[c] = c === '1' ? 1 : (r[c] === undefined ? null : r[c]); }); return o; });
    return { rows, rowCount: rows.length };
  }
  if ((m = s.match(/^UPDATE identities SET (.+?) WHERE (.+)$/i))) {
    const sets = splitTop(m[1], ',');
    const hit = where(m[2], params);
    hit.forEach((r) => sets.forEach((a) => {
      const k = a.match(/^(\w+) = (.+)$/); if (!k) throw new Error('stub db: unknown SET ' + a);
      r[k[1]] = value(k[2].trim(), params, r);
    }));
    return { rows: [], rowCount: hit.length };
  }
  if (/policy_flags/.test(s)) return { rows: [] };
  throw new Error('stub db: unknown statement ' + s.slice(0, 120));
}
const stub = (rel, exports) => { const p = require.resolve(path.join(API, rel)); require.cache[p] = { id: p, filename: p, loaded: true, exports }; };
stub('db', { query: q, pool: { query: q, connect: async () => ({ query: q, release() {} }) },
  withEntity: async (id, fn) => fn({ query: q }), withTransaction: async (fn) => fn({ query: q }), onEntity: async (id, db, fn) => fn({ query: q }),
  readBatch: async () => ({}), trySavepoint: async (db, fn, fb) => { try { return await fn(db); } catch (_) { return fb; } } });
stub('lib/schema', { hasColumn: async () => true, has: async () => true, columns: async () => [], table: async () => ({}) });
stub('lib/schema-bootstrap', { ensureDefaultSchema: async () => {} });
stub('lib/rootlink', { connect: async () => null });
stub('lib/istest', { atRegistration: () => ({ population: null, entity_kind: 'customer' }), ready: async () => true });

/* ── the app: the real routers, mounted where server.js mounts them ─────────────────────────────────────────────── */
const entities = require(path.join(API, 'routes', 'entities'));
const actors = require(path.join(API, 'routes', 'actors'));
const signin = require(path.join(API, 'routes', 'signin'));
const app = express();
app.use(express.json());
app.use('/api/entities', entities);
app.use('/api/signin', signin);
app.use('/api/actors', actors);

let base;
const call = (method, url, { token, body, headers } = {}) => new Promise((resolve, reject) => {
  const data = body ? JSON.stringify(body) : null;
  const h = Object.assign({ 'content-type': 'application/json' }, headers || {});
  if (token) h.authorization = 'Bearer ' + token;
  if (data) h['content-length'] = Buffer.byteLength(data);
  const r = http.request(base + url, { method, headers: h }, (res) => {
    let s = ''; res.on('data', (c) => { s += c; });
    res.on('end', () => { let j = null; try { j = JSON.parse(s); } catch (_) {} resolve({ status: res.statusCode, body: j }); });
  });
  r.on('error', reject); if (data) r.write(data); r.end();
});
const TOK = {
  ravi: () => jwt.sign({ identity_id: 'ravi', bridge_id: 'B-RAVI', display_name: 'Ravi', identity_type: 'actor', owner_scope: 'actor',
                         actor_key: 'ravi', parent_entity_id: 'shop1' }, process.env.JWT_SECRET, { expiresIn: '1h' }),
  owner: () => jwt.sign({ identity_id: 'shop1', bridge_id: 'B-SHOP1', display_name: 'Shop One', identity_type: 'entity', owner_scope: 'entity' },
                        process.env.JWT_SECRET, { expiresIn: '1h' }),
};


const post = (url, body, token) => call('POST', url, { body, token });
(async () => {
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + server.address().port;
  hush();
  const results = [];
  const T = (n, ok, x) => results.push([n, ok, x]);
  try {
    let r;
    /* ── ask ── */
    reset();
    r = await post('/api/signin/ask', { id: 'owner@shop.test' });
    const ONE = (x) => x.status === 200 && x.body.need === 'pin_or_code' && Object.keys(x.body).every((k) => ['message', 'need', 'dev_otp'].includes(k)); /* SEC-143: the same to everyone */
    T('ask: a known shop e-mail gets the one ask answer (no kind, no id)', ONE(r), JSON.stringify(r.body));
    T('ask: the code is stored on the row with an expiry', DB.shop1.otp_code != null && DB.shop1.otp_expires_at instanceof Date && DB.shop1.otp_expires_at.getTime() > Date.now());
    reset();
    r = await post('/api/signin/ask', { id: 'ravi@shopone.br' });
    T('ask: a co-assist with a PIN gets the same answer (no use_pin) and no code is made', ONE(r) && DB.ravi.otp_code == null, JSON.stringify(r.body));
    reset();
    r = await post('/api/signin/ask', { id: 'nobody@x.test' });
    T('ask: an unknown id gets the same answer, nothing created', ONE(r) && !r.body.token, JSON.stringify(r.body));
    r = await post('/api/signin/ask', {});
    T('ask: an empty body is refused 400', r.status === 400 && !r.body.token, JSON.stringify(r.body));
    r = await post('/api/signin/ask', { id: 'net.store' });
    T('ask: a network store with no inbox gets the same answer (no operator_issued, no handle)', ONE(r) && !('operator_issued' in r.body), JSON.stringify(r.body));
    r = await post('/api/signin/ask', { id: 'Twin' });
    T('ask: a name two shops share gets the same answer, no choice picked, no list', ONE(r) && !r.body.token && !('choices' in r.body), JSON.stringify(r.body));

    /* ── entities/register ── */
    reset();
    r = await post('/api/entities/register', { email: 'owner@shop.test', mode: 'login' });
    T('register (login mode): a known shop is asked for a code — 200, nothing registered', r.status === 200 && INSERTS.length === 0 && DB.shop1.otp_code != null, JSON.stringify(r.body) + ' inserts ' + INSERTS.length);
    reset();
    r = await post('/api/entities/register', { email: 'new@shop.test', display_name: 'New Shop', user_id: 'newshop-one' });
    T('register: a new e-mail registers a NEW shop row (exactly one INSERT) and a code is issued', r.status === 200 && INSERTS.length === 1 && /code/i.test(r.body.message), JSON.stringify(r.body) + ' inserts ' + INSERTS.length);
    reset();
    r = await post('/api/entities/register', { email: 'not-an-email', display_name: 'X' });
    T('register: a malformed e-mail is refused 400 and nothing is inserted', r.status === 400 && INSERTS.length === 0, JSON.stringify(r.body));

    /* ── entities/verify ── */
    reset();
    r = await post('/api/entities/verify', { email: 'owner@shop.test', otp: '111111' });
    const claims = r.body && r.body.token ? jwt.decode(r.body.token) : {};
    T('verify: the right code signs in — 200, a token naming the shop, entity back', r.status === 200 && claims.identity_id === 'shop1' && claims.identity_type === 'entity' && r.body.entity && r.body.entity.identity_id === 'shop1', JSON.stringify(r.body).slice(0, 200));
    reset();
    r = await post('/api/entities/verify', { email: 'owner@shop.test', otp: '000000' });
    T('verify: a wrong code is refused 400 with NO token, and the miss is counted on the row', r.status === 400 && !r.body.token && DB.shop1.otp_attempts === 1, JSON.stringify(r.body));
    reset();
    for (let i = 0; i < 6; i++) await post('/api/entities/verify', { email: 'owner@shop.test', otp: '000000' });
    r = await post('/api/entities/verify', { email: 'owner@shop.test', otp: '111111' });
    T('verify: after six wrong codes even the RIGHT code is refused (locked), no token', r.status >= 400 && !r.body.token, r.status + ' ' + JSON.stringify(r.body));
    reset();
    r = await post('/api/entities/verify', { email: 'owner@shop.test', otp: '11111' });
    T('verify: a 5-digit code is refused 400', r.status === 400 && !r.body.token, JSON.stringify(r.body));
    r = await post('/api/entities/verify', { email: 'nobody@x.test', otp: '111111' });
    T('verify: an unknown e-mail is refused with no token', r.status >= 400 && !r.body.token, JSON.stringify(r.body));
    reset();
    r = await post('/api/entities/verify', { user_id: 'ravi@shopone.br', pin: '1234' });
    T('verify: a co-assist signs in with the right PIN (token names the actor and its shop)', r.status === 200 && jwt.decode(r.body.token).identity_id === 'ravi' && jwt.decode(r.body.token).parent_entity_id === 'shop1', JSON.stringify(r.body).slice(0, 200));

    /* ── pin ── */
    reset();
    r = await post('/api/signin/pin', { pin: '4321', confirm_pin: '4321' }, TOK.ravi());
    T('pin: a signed-in co-assist sets a PIN — 200, stored as a bcrypt hash (never the digits)', r.status === 200 && bcrypt.compareSync('4321', DB.ravi.pin_hash) && DB.ravi.pin_hash !== '4321', JSON.stringify(r.body));
    r = await post('/api/entities/verify', { user_id: 'ravi@shopone.br', pin: '4321' });
    T('pin: the new PIN signs in, the old one no longer does', r.status === 200 && !!r.body.token && (await post('/api/entities/verify', { user_id: 'ravi@shopone.br', pin: '1234' })).status >= 400);
    reset();
    r = await post('/api/signin/pin', { pin: '4321', confirm_pin: '4322' }, TOK.ravi());
    T('pin: confirm that does not match is 400 and the PIN is unchanged', r.status === 400 && bcrypt.compareSync('1234', DB.ravi.pin_hash), JSON.stringify(r.body));
    r = await post('/api/signin/pin', { pin: '43210', confirm_pin: '43210' }, TOK.ravi());
    T('pin: five digits is 400 and the PIN is unchanged', r.status === 400 && bcrypt.compareSync('1234', DB.ravi.pin_hash), JSON.stringify(r.body));
    r = await post('/api/signin/pin', { pin: '4321', confirm_pin: '4321' });
    T('pin: no token is 401 and nothing is written', r.status === 401 && bcrypt.compareSync('1234', DB.ravi.pin_hash), JSON.stringify(r.body));
    r = await post('/api/signin/pin', { pin: '4321', confirm_pin: '4321' }, TOK.owner());
    T('pin: the shop owner (not an actor) is refused 400 - only actors hold a PIN', r.status === 400 && DB.shop1.pin_hash == null, JSON.stringify(r.body));
  } catch (e) { results.push(['test crashed: ' + ((e && e.stack) || e), false]); }
  server.close();
  results.forEach(([n, ok, x]) => t(n, ok, x));
  say('\n' + pass + ' passed · ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
