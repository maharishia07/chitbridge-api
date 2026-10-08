/**
 * tests/signin-routes.test.cjs — M06 (SPEC-iam-build PR 6 "SW-5"): /api/signin/ask · verify · pin, the MOVED handlers.
 *
 * ⚠️ THE RISKIEST IAM MOVE, so the proof is in three layers:
 *   1. GOLDEN — every old path answers exactly what it answered BEFORE the move. tests/fixtures/signin-parity.golden.json
 *      was recorded by this same file running against origin/main (cf349d2) before a line moved:
 *          node tests/signin-routes.test.cjs --golden <root of the pre-move api> tests/fixtures/signin-parity.golden.json
 *      Status, body (token → its claims without iat/exp) and every identities row the request touched (codes, attempts,
 *      locks, PIN) must be equal. A changed word on a refusal fails here.
 *   2. ALIAS PARITY — every old path and the new door are the SAME handler function (router stacks), and the same request
 *      through each gives the same answer and the same row changes.
 *   3. THE ROW'S INVARIANTS — every sign-in attempt that names a known person writes ONE signin_events row; a missing b282
 *      logs an error and never blocks sign-in; no value outside the b282 CHECK lists is ever written.
 *
 * Run: node tests/signin-routes.test.cjs · no network beyond 127.0.0.1, no DB (an in-memory identities table).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');

const argv = process.argv.slice(2);
const GOLDEN = argv[0] === '--golden';
const API = GOLDEN ? path.resolve(argv[1]) : path.join(__dirname, '..');
const GOLDEN_FILE = GOLDEN ? path.resolve(argv[2]) : path.join(__dirname, 'fixtures', 'signin-parity.golden.json');
const need = (m) => require(require.resolve(m, { paths: [API, __dirname] }));
const jwt = need('jsonwebtoken');
const express = need('express');
const bcrypt = need('bcryptjs');

Object.assign(process.env, { JWT_SECRET: 'test-only-secret-signin-routes', NODE_ENV: 'test', DEV_OTP: '123456', DEV_OTP_IN_RESPONSE: 'true' });
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

/* ── normalising: what may differ between two runs (time, salt) is reduced to what it MEANS ──────────────────────── */
const when = (v) => (v instanceof Date ? 'T+' + Math.round((v.getTime() - Date.now()) / 60000) + 'm' : v);
function normBody(b) {
  if (!b || typeof b !== 'object') return b;
  const o = JSON.parse(JSON.stringify(b));
  if (typeof o.token === 'string') {
    const c = jwt.decode(o.token) || {}; delete c.iat; delete c.exp; o.token = { claims: c };
  }
  return o;
}
const ROW_FIELDS = ['otp_code', 'otp_expires_at', 'otp_attempts', 'pin_hash', 'pin_attempts', 'pin_locked_at', 'pin_set_at', 'status',
                    'email_verified', 'last_active_at'];
function snapshot() {
  const out = {};
  for (const [id, r] of Object.entries(DB)) {
    const o = {};
    ROW_FIELDS.forEach((f) => {
      let v = r[f];
      if (f === 'pin_hash' && v) v = bcrypt.compareSync('1234', v) ? 'hash:1234' : bcrypt.compareSync('4321', v) ? 'hash:4321' : 'hash:other';
      if (v !== undefined) o[f] = when(v);
    });
    out[id] = o;
  }
  return out;
}

/* ── the scenarios: OLD path → its NEW door (null = no new door for this request; see the note on each) ─────────── */
const S = [
  // ask = POST /api/entities/register (mode:'login') — the login half, moved
  { id: 'ask.entity.email', old: ['POST', '/api/entities/register'], neu: ['POST', '/api/signin/ask'], body: { email: 'owner@shop.test', mode: 'login' } },
  { id: 'ask.entity.email.nomode', old: ['POST', '/api/entities/register'], neu: ['POST', '/api/signin/ask'], body: { email: 'owner@shop.test' } },
  { id: 'ask.entity.userid', old: ['POST', '/api/entities/register'], neu: ['POST', '/api/signin/ask'], body: { user_id: 'shopone', mode: 'login' } },
  { id: 'ask.entity.name', old: ['POST', '/api/entities/register'], neu: ['POST', '/api/signin/ask'], body: { user_id: 'Shop One', mode: 'login' } },
  { id: 'ask.unknown.email', old: ['POST', '/api/entities/register'], neu: ['POST', '/api/signin/ask'], body: { email: 'nobody@x.test', mode: 'login' } },
  { id: 'ask.unknown.name', old: ['POST', '/api/entities/register'], neu: ['POST', '/api/signin/ask'], body: { user_id: 'nobody', mode: 'login' } },
  { id: 'ask.ambiguous', old: ['POST', '/api/entities/register'], neu: ['POST', '/api/signin/ask'], body: { user_id: 'Twin', mode: 'login' } },
  { id: 'ask.store.noinbox', old: ['POST', '/api/entities/register'], neu: ['POST', '/api/signin/ask'], body: { user_id: 'net.store', mode: 'login' } },
  { id: 'ask.actor.pin', old: ['POST', '/api/entities/register'], neu: ['POST', '/api/signin/ask'], body: { user_id: 'ravi@shopone.br', mode: 'login' } },
  { id: 'ask.actor.display', old: ['POST', '/api/entities/register'], neu: ['POST', '/api/signin/ask'], body: { user_id: 'ravi@Shop One', mode: 'login' } },
  { id: 'ask.actor.first', old: ['POST', '/api/entities/register'], neu: ['POST', '/api/signin/ask'], body: { user_id: 'mala@shopone.br', mode: 'login' } },
  { id: 'ask.empty', old: ['POST', '/api/entities/register'], neu: ['POST', '/api/signin/ask'], body: { mode: 'login' } },
  // registration stays on /register only — the new door never creates (asserted below, not a parity pair)
  { id: 'register.new', old: ['POST', '/api/entities/register'], neu: null, body: { email: 'new@shop.test', display_name: 'New Shop', user_id: 'newshop-one' } },
  // verify = POST /api/entities/verify, moved whole
  { id: 'verify.entity.ok', old: ['POST', '/api/entities/verify'], neu: ['POST', '/api/signin/verify'], body: { email: 'owner@shop.test', otp: '111111' } },
  { id: 'verify.entity.userid.ok', old: ['POST', '/api/entities/verify'], neu: ['POST', '/api/signin/verify'], body: { user_id: 'shopone', otp: '111111' } },
  { id: 'verify.entity.wrong', old: ['POST', '/api/entities/verify'], neu: ['POST', '/api/signin/verify'], body: { email: 'owner@shop.test', otp: '000000' } },
  { id: 'verify.entity.wrong.x6', old: ['POST', '/api/entities/verify'], neu: ['POST', '/api/signin/verify'], body: { email: 'owner@shop.test', otp: '000000' }, times: 6 },
  { id: 'verify.unknown', old: ['POST', '/api/entities/verify'], neu: ['POST', '/api/signin/verify'], body: { email: 'nobody@x.test', otp: '111111' } },
  { id: 'verify.none', old: ['POST', '/api/entities/verify'], neu: ['POST', '/api/signin/verify'], body: { otp: '111111' } },
  { id: 'verify.otp.5digits', old: ['POST', '/api/entities/verify'], neu: ['POST', '/api/signin/verify'], body: { email: 'owner@shop.test', otp: '11111' } },
  { id: 'verify.actor.pin.ok', old: ['POST', '/api/entities/verify'], neu: ['POST', '/api/signin/verify'], body: { user_id: 'ravi@shopone.br', pin: '1234' } },
  { id: 'verify.actor.pin.wrong.x5', old: ['POST', '/api/entities/verify'], neu: ['POST', '/api/signin/verify'], body: { user_id: 'ravi@shopone.br', pin: '9999' }, times: 5 },
  { id: 'verify.actor.pin.missing', old: ['POST', '/api/entities/verify'], neu: ['POST', '/api/signin/verify'], body: { user_id: 'ravi@shopone.br' } },
  { id: 'verify.actor.pin.5digits', old: ['POST', '/api/entities/verify'], neu: ['POST', '/api/signin/verify'], body: { user_id: 'ravi@shopone.br', pin: '12345' } },
  { id: 'verify.actor.locked', old: ['POST', '/api/entities/verify'], neu: ['POST', '/api/signin/verify'], body: { user_id: 'lockd@shopone.br', pin: '1234' } },
  { id: 'verify.actor.first.otp', old: ['POST', '/api/entities/verify'], neu: ['POST', '/api/signin/verify'], body: { user_id: 'mala@shopone.br', otp: '654321' } },
  // POST /api/actors/login (key@Display Name / key@user-id) → the SAME verify handler, actor-login words
  { id: 'login.pin.display', old: ['POST', '/api/actors/login'], neu: ['POST', '/api/signin/verify'], body: { username: 'ravi@Shop One', pin: '1234' } },
  { id: 'login.pin.userid', old: ['POST', '/api/actors/login'], neu: ['POST', '/api/signin/verify'], body: { username: 'ravi@shopone', pin: '1234' } },
  { id: 'login.pin.wrong.x6', old: ['POST', '/api/actors/login'], neu: ['POST', '/api/signin/verify'], body: { username: 'ravi@shop one', pin: '0000' }, times: 6 },
  { id: 'login.pin.missing', old: ['POST', '/api/actors/login'], neu: ['POST', '/api/signin/verify'], body: { username: 'ravi@shop one' } },
  { id: 'login.pin.letters', old: ['POST', '/api/actors/login'], neu: ['POST', '/api/signin/verify'], body: { username: 'ravi@shop one', pin: '12a4' } },
  { id: 'login.pin.5digits', old: ['POST', '/api/actors/login'], neu: ['POST', '/api/signin/verify'], body: { username: 'ravi@shop one', pin: '12345' } },
  { id: 'login.otp.first', old: ['POST', '/api/actors/login'], neu: ['POST', '/api/signin/verify'], body: { username: 'mala@shop one', otp: '654321' } },
  { id: 'login.otp.wrong', old: ['POST', '/api/actors/login'], neu: ['POST', '/api/signin/verify'], body: { username: 'mala@shop one', otp: '000000' } },
  { id: 'login.otp.missing', old: ['POST', '/api/actors/login'], neu: ['POST', '/api/signin/verify'], body: { username: 'mala@shop one' } },
  { id: 'login.removed', old: ['POST', '/api/actors/login'], neu: ['POST', '/api/signin/verify'], body: { username: 'gone@shop one', pin: '1234' } },
  { id: 'login.locked', old: ['POST', '/api/actors/login'], neu: ['POST', '/api/signin/verify'], body: { username: 'lockd@shop one', pin: '1234' } },
  { id: 'login.noat', old: ['POST', '/api/actors/login'], neu: ['POST', '/api/signin/verify'], body: { username: 'ravi', pin: '1234' } },
  { id: 'login.ambiguous', old: ['POST', '/api/actors/login'], neu: ['POST', '/api/signin/verify'], body: { username: 'ravi@twin', pin: '1234' } },
  { id: 'login.noentity', old: ['POST', '/api/actors/login'], neu: ['POST', '/api/signin/verify'], body: { username: 'x@nowhere', pin: '1234' } },
  { id: 'login.noactor', old: ['POST', '/api/actors/login'], neu: ['POST', '/api/signin/verify'], body: { username: 'zz@shop one', pin: '1234' } },
  // an empty body names no door: through /api/actors/login it is the actor door's 400; /api/signin/verify reads it as the entity door
  { id: 'login.nobody', old: ['POST', '/api/actors/login'], neu: null, body: {} },
  // GET /api/actors/check-login — kept answering (app.html#/login reads it until PR 14); moved, unchanged
  { id: 'check.pin', old: ['GET', '/api/actors/check-login?username=' + encodeURIComponent('ravi@Shop One')], neu: null },
  { id: 'check.first', old: ['GET', '/api/actors/check-login?username=' + encodeURIComponent('mala@shop one')], neu: null },
  { id: 'check.removed', old: ['GET', '/api/actors/check-login?username=' + encodeURIComponent('gone@shop one')], neu: null },
  { id: 'check.userid', old: ['GET', '/api/actors/check-login?username=' + encodeURIComponent('ravi@shopone')], neu: null },
  { id: 'check.noat', old: ['GET', '/api/actors/check-login?username=ravi'], neu: null },
  { id: 'check.noentity', old: ['GET', '/api/actors/check-login?username=' + encodeURIComponent('x@nowhere')], neu: null },
  // pin = POST /api/actors/set-pin, moved
  { id: 'pin.set', old: ['POST', '/api/actors/set-pin'], neu: ['POST', '/api/signin/pin'], token: 'ravi', body: { pin: '4321', confirm_pin: '4321' } },
  { id: 'pin.mismatch', old: ['POST', '/api/actors/set-pin'], neu: ['POST', '/api/signin/pin'], token: 'ravi', body: { pin: '4321', confirm_pin: '4322' } },
  { id: 'pin.5digits', old: ['POST', '/api/actors/set-pin'], neu: ['POST', '/api/signin/pin'], token: 'ravi', body: { pin: '43210', confirm_pin: '43210' } },
  { id: 'pin.owner', old: ['POST', '/api/actors/set-pin'], neu: ['POST', '/api/signin/pin'], token: 'owner', body: { pin: '4321', confirm_pin: '4321' } },
  { id: 'pin.noauth', old: ['POST', '/api/actors/set-pin'], neu: ['POST', '/api/signin/pin'], body: { pin: '4321', confirm_pin: '4321' } },
];

async function run(sc, door) {
  reset();
  const [method, url] = sc[door];
  const responses = [];
  for (let i = 0; i < (sc.times || 1); i++) {
    const r = await call(method, url, { body: sc.body, token: sc.token ? TOK[sc.token]() : null });
    responses.push({ status: r.status, body: normBody(r.body) });
  }
  if (!GOLDEN && typeof signin.events === 'object' && signin.events.flush) await signin.events.flush();
  return { responses, rows: snapshot(), inserts: INSERTS.length, events: EVENTS.slice() };
}
const strip = (x) => ({ responses: x.responses, rows: x.rows, inserts: x.inserts });
/* the ONLY keys the new door may add to an old answer (routes/signin.js header): ask's kind + need, NO_ACCOUNT's code.
   Removed from the new door's answer only where the old answer lacks them — every other key and value must match. */
const ADDED = ['kind', 'need', 'code', 'id'];   /* id: M14 — the stored id a mobile or e-mail resolved to */
const withoutAdded = (n, o) => Object.assign({}, n, { responses: n.responses.map((r, i) => {
  const ob = (o.responses[i] || {}).body || {}, b = Object.assign({}, r.body);
  ADDED.forEach((k) => { if (!(k in ob)) delete b[k]; });
  return { status: r.status, body: b };
}) });
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const firstDiff = (a, b) => {
  const A = JSON.stringify(a, null, 1).split('\n'), B = JSON.stringify(b, null, 1).split('\n');
  for (let i = 0; i < Math.max(A.length, B.length); i++) if (A[i] !== B[i]) return 'line ' + i + ': ' + A[i] + '  ≠  ' + B[i];
  return '';
};

(async () => {
  hush();
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = 'http://127.0.0.1:' + server.address().port;
  try {
    if (GOLDEN) {
      const out = {};
      for (const sc of S) out[sc.id] = strip(await run(sc, 'old'));
      fs.mkdirSync(path.dirname(GOLDEN_FILE), { recursive: true });
      fs.writeFileSync(GOLDEN_FILE, JSON.stringify({ recorded_from: 'pre-move api (origin/main cf349d2)', scenarios: out }, null, 1) + '\n');
      say('golden written: ' + Object.keys(out).length + ' scenarios → ' + GOLDEN_FILE);
      return;
    }
    const golden = JSON.parse(fs.readFileSync(GOLDEN_FILE, 'utf8')).scenarios;
    const events = signin.events;

    say('\n── 1 · every old path answers exactly what it answered before the move (golden, recorded pre-move) ──');
    const OLD = {};
    for (const sc of S) {
      OLD[sc.id] = await run(sc, 'old');
      const g = golden[sc.id];
      t(sc.id.padEnd(28) + ' ' + sc.old.join(' ').slice(0, 44), !!g && same(strip(OLD[sc.id]), g), g ? firstDiff(strip(OLD[sc.id]), g) : 'no golden');
    }

    say('\n── 2 · alias parity: the same request through the new door gives the same answer and the same rows ──');
    for (const sc of S.filter((x) => x.neu)) {
      const n = withoutAdded(await run(sc, 'neu'), OLD[sc.id]);
      t(sc.id.padEnd(28) + ' ' + sc.neu.join(' '), same(strip(n), strip(OLD[sc.id])), firstDiff(strip(n), strip(OLD[sc.id])));
      t('  …and writes the same signin_events rows', same(n.events, OLD[sc.id].events), firstDiff(n.events, OLD[sc.id].events));
    }
    const handleOf = (router, method, p) => {
      const l = router.stack.find((x) => x.route && x.route.path === p && x.route.methods[method]);
      return l ? l.route.stack[l.route.stack.length - 1].handle : null;
    };
    const verifyH = handleOf(signin, 'post', '/verify'), askH = handleOf(signin, 'post', '/ask'), pinH = handleOf(signin, 'post', '/pin');
    t('the old paths ARE the new handlers (router stacks, same function)',
      !!verifyH && handleOf(entities, 'post', '/verify') === verifyH && handleOf(actors, 'post', '/login') === verifyH
      && !!pinH && handleOf(actors, 'post', '/set-pin') === pinH && !!askH && signin.handlers.ask === askH && signin.handlers.verify === verifyH);
    const regLayer = entities.stack.find((x) => x.route && x.route.path === '/register');
    t('  …and /api/entities/register runs the same ask handler before registration', !!regLayer && regLayer.route.stack.some((l) => l.handle === askH));

    say('\n── 3 · what the new door adds, and what it never does ──');
    reset();
    let r = await call('POST', '/api/signin/ask', { body: { email: 'nobody@x.test' } });
    t('ask never creates: an unknown e-mail with no mode → 400 NO_ACCOUNT, no INSERT', r.status === 400 && r.body.code === 'NO_ACCOUNT' && INSERTS.length === 0);
    r = await call('POST', '/api/signin/ask', { body: { id: 'shopone' } });
    t('ask takes a user id as { id }: entity → need code', r.status === 200 && r.body.need === 'code' && r.body.kind === 'entity');
    r = await call('POST', '/api/signin/ask', { body: { id: 'ravi@shopone.br' } });
    t('  actor with a PIN → need pin', r.status === 200 && r.body.need === 'pin' && r.body.kind === 'actor' && r.body.use_pin === true);
    r = await call('POST', '/api/signin/ask', { body: { id: 'ravi@Shop One' } });
    t('  key@Display Name resolves too (I5)', r.status === 200 && r.body.need === 'pin' && r.body.user_id === 'ravi@shopone.br');
    r = await call('POST', '/api/signin/verify', { body: { id: 'ravi@shopone.br', pin: '1234' } });
    t('verify takes { id } (a stored user id)', r.status === 200 && jwt.decode(r.body.token).identity_id === 'ravi');
    reset();
    r = await call('POST', '/api/signin/verify', { body: { id: 'owner@shop.test', otp: '111111' } });
    t('  …and an e-mail as { id }', r.status === 200 && jwt.decode(r.body.token).identity_id === 'shop1');
    r = await call('GET', '/api/actors/check-login?username=ravi%40Shop%20One');
    t('check-login still answers (app.html#/login reads it until PR 14) — not 410', r.status === 200 && r.body.valid === true);

    say('\n── 4 · signin_events: one row per attempt that names a known person ──');
    const one = async (label, method, url, body, want, token) => {
      reset();
      await call(method, url, { body, token: token ? TOK[token]() : null });
      await events.flush();
      const ok = EVENTS.length === 1 && Object.keys(want).every((k) => EVENTS[0][k] === want[k]);
      t(label, ok, JSON.stringify(EVENTS));
    };
    await one('ask (entity)              → ask · otp', 'POST', '/api/signin/ask', { id: 'shopone' }, { action: 'ask', method: 'otp', entity_id: 'shop1', identity_id: 'shop1' });
    await one('ask (actor with PIN)      → ask · pin', 'POST', '/api/signin/ask', { id: 'ravi@shopone.br' }, { action: 'ask', method: 'pin', entity_id: 'shop1', identity_id: 'ravi' });
    await one('verify ok (owner)         → in · otp', 'POST', '/api/signin/verify', { email: 'owner@shop.test', otp: '111111' }, { action: 'in', method: 'otp', identity_id: 'shop1' });
    await one('verify ok (actor PIN)     → in · pin, shop slot = parent', 'POST', '/api/signin/verify', { user_id: 'ravi@shopone.br', pin: '1234' }, { action: 'in', method: 'pin', entity_id: 'shop1', identity_id: 'ravi' });
    await one('wrong PIN                 → fail · PIN_WRONG', 'POST', '/api/signin/verify', { user_id: 'ravi@shopone.br', pin: '9999' }, { action: 'fail', method: 'pin', code: 'PIN_WRONG' });
    await one('wrong code                → fail · OTP_WRONG', 'POST', '/api/signin/verify', { email: 'owner@shop.test', otp: '000000' }, { action: 'fail', method: 'otp', code: 'OTP_WRONG' });
    await one('locked account            → locked · PIN_LOCKED', 'POST', '/api/actors/login', { username: 'lockd@shop one', pin: '1234' }, { action: 'locked', method: 'pin', code: 'PIN_LOCKED' });
    await one('removed co-assist         → fail · ACCESS_REMOVED', 'POST', '/api/actors/login', { username: 'gone@shop one', pin: '1234' }, { action: 'fail', code: 'ACCESS_REMOVED' });
    await one('actors/login alias ok     → in · pin', 'POST', '/api/actors/login', { username: 'ravi@shop one', pin: '1234' }, { action: 'in', method: 'pin', identity_id: 'ravi' });
    await one('set a PIN                 → link · pin', 'POST', '/api/signin/pin', { pin: '4321', confirm_pin: '4321' }, { action: 'link', method: 'pin', identity_id: 'ravi' }, 'ravi');
    reset();
    for (let i = 0; i < 5; i++) await call('POST', '/api/signin/verify', { body: { user_id: 'ravi@shopone.br', pin: '9999' } });
    await events.flush();
    t('wrong PIN ×5 → 4 fail rows, then one locked · PIN_LOCKED', EVENTS.length === 5 && EVENTS.slice(0, 4).every((e) => e.action === 'fail')
      && EVENTS[4].action === 'locked' && EVENTS[4].code === 'PIN_LOCKED' && DB.ravi.pin_locked_at === 'NOW', JSON.stringify(EVENTS.map((e) => e.action)));
    reset();
    await call('POST', '/api/signin/ask', { body: { id: 'nobody' } });
    await call('POST', '/api/signin/verify', { body: { email: 'nobody@x.test', otp: '111111' } });
    await events.flush();
    t('an unknown id writes no row (no shop to file it under — the request log carries NO_ACCOUNT)', EVENTS.length === 0);
    reset();
    await call('POST', '/api/signin/verify', { body: { email: 'owner@shop.test', otp: '111111', device_id: 'dev-abcdef12', surface: 'till' },
      headers: { 'user-agent': 'UA-test', 'x-forwarded-for': '203.0.113.9' } });
    await events.flush();
    t('the row carries device, surface, ua and a valid ip', EVENTS.length === 1 && EVENTS[0].device_id === 'dev-abcdef12' && EVENTS[0].surface === 'till'
      && EVENTS[0].ua === 'UA-test' && EVENTS[0].ip === '203.0.113.9', JSON.stringify(EVENTS[0]));

    say('\n── 5 · a missing b282 logs an error and never blocks sign-in ──');
    reset(); LOGS = []; events._resetWindow();
    B282 = false;
    const a1 = await call('POST', '/api/signin/verify', { body: { email: 'owner@shop.test', otp: '111111' } });
    reset(); B282 = false;
    const a2 = await call('POST', '/api/actors/login', { body: { username: 'ravi@shop one', pin: '1234' } });
    reset(); B282 = false;
    const a3 = await call('POST', '/api/signin/ask', { body: { id: 'shopone' } });
    await events.flush();
    t('sign-in succeeds with the table missing (verify 200, alias 200, ask 200)', a1.status === 200 && !!a1.body.token && a2.status === 200 && !!a2.body.token && a3.status === 200);
    const errs = LOGS.filter((l) => /^error /.test(l) && /signin_events/.test(l));
    t('  …and it is SAID: log.error signin_events with code 42P01', errs.length >= 1 && /42P01/.test(errs[0]), JSON.stringify(errs));
    t('  …once per window, not once per sign-in (3 attempts → 1 line)', errs.length === 1, String(errs.length));
    t('  …and the writer reports what happened', (await events.record({ entity_id: 'shop1', identity_id: 'shop1', action: 'in', method: 'otp' })).written === false);
    reset(); LOGS = []; EVENT_FAIL = '42501';
    const a4 = await call('POST', '/api/signin/verify', { body: { email: 'owner@shop.test', otp: '111111' } });
    await events.flush();
    t('any other write failure (an RLS refusal) is also logged, and sign-in still succeeds', a4.status === 200
      && LOGS.some((l) => /^error /.test(l) && /signin_events/.test(l) && /42501/.test(l)));

    say('\n── 6 · the writer never writes a value outside the b282 CHECK lists ──');
    reset(); LOGS = [];
    const bad1 = await events.record({ entity_id: 'shop1', action: 'login', method: 'otp' });
    const bad2 = await events.record({ entity_id: 'shop1', action: 'in', method: 'sms' });
    const bad3 = await events.record({ action: 'in', method: 'otp' });
    t('action outside the CHECK → not written, logged', bad1.written === false && EVENTS.length === 0 && LOGS.some((l) => /^error .*signin_events/.test(l) && /login/.test(l)));
    t('method outside the CHECK → not written', bad2.written === false && EVENTS.length === 0);
    t('no entity_id (NOT NULL) → not written', bad3.written === false && EVENTS.length === 0);
    const b282 = fs.readFileSync(path.join(API, 'migrations', 'b282_signin_events.sql'), 'utf8');
    const list = (col) => (b282.match(new RegExp(col + "\\s+text[^\\n]*CHECK \\(" + col + " IN \\(([^)]*)\\)")) || [])[1].split(',').map((x) => x.trim().replace(/'/g, ''));
    t('the writer\'s lists ARE the migration\'s CHECK lists', same(events.ACTIONS, list('action')) && same(events.METHODS, list('method')));

    say('\n── 7 · one PIN engine, and the doors that are guarded ──');
    const src = (f) => fs.readFileSync(path.join(API, f), 'utf8');
    const routesSrc = fs.readdirSync(path.join(API, 'routes')).filter((f) => f.endsWith('.js')).map((f) => src('routes/' + f)).join('\n');
    t('no route compares or hashes a PIN itself (bcrypt lives in lib/identity-auth.js only)', !/bcrypt\.(compare|hash)\(/.test(routesSrc));
    t('actors.js no longer holds a login, a check-login body or a set-pin body',
      !/pin_attempts = \$1/.test(src('routes/actors.js')) && !/function splitLogin/.test(src('routes/actors.js')) && !/bcrypt/.test(src('routes/actors.js')));
    const server_ = src('server.js');
    t('authLimiter covers the new doors', /authLimiter/.test(server_) && /'\/api\/signin\/ask'/.test(server_) && /'\/api\/signin\/verify'/.test(server_) && /'\/api\/signin\/pin'/.test(server_));
  } catch (e) {
    fail++; say('  FAIL threw: ' + ((e && e.stack) || e));
  } finally {
    server.close();
  }
  if (GOLDEN) return;
  say('\n' + (pass + fail) + ' checks · ' + pass + ' passed · ' + fail + ' failed');
  process.exitCode = fail ? 1 : 0;
})();
