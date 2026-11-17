/**
 * e2e/lib/real-stack.cjs — THE REAL STACK UNDER A WALK (round WX, 2026-10-13): the api (../chitbridge-api/server.js) spawned as a
 * child of the walk, against a LOCAL Postgres that tools/sim-load.cjs filled, with DEV_OTP armed — so a walk's `--real` mode drives the
 * screens this checkout serves against real routes, real RLS and three real years of a shop. Nothing here is a stand-in.
 *
 * ⚠️ LOCAL ONLY. The database URL must be localhost (the same rule the loader holds); NODE_ENV is development; the api listens on
 * 127.0.0.1 on a free port and allows ONLY the walk's own web origin (ALLOWED_ORIGINS). The child dies with the walk (stop()).
 *
 *   const R = require('./lib/real-stack.cjs');
 *   const stack = await R.up({ webBase });                      // → { api, stop }
 *   const owner = await R.signIn(stack.api, 'simstores@test.example');   // → { token, entity, session }  (session = the cb_sess the apps store)
 *   const shopper = await R.shopperOrder(stack.api, bridgeId, { contact, name, lines });   // the storefront's own two calls
 *
 * Env it reads: CB_REAL_DB (postgres://postgres:pw@127.0.0.1:5432/cb_sim) · CB_API_DIR (../chitbridge-api beside this checkout).
 */
'use strict';
const path = require('path'), http = require('http'), { spawn } = require('child_process');

const API_DIR = process.env.CB_API_DIR || path.join(__dirname, '..', '..', '..', 'chitbridge-api');
const DB = process.env.CB_REAL_DB || 'postgres://postgres:pw@127.0.0.1:5432/cb_sim';
const OTP = '123456', OTP_CUSTOMER = '123123';

/** j(url, { method, token, body }) → { status, b } — a JSON call, never throws on a status */
function j(url, o) {
  o = o || {};
  return new Promise((res, rej) => {
    const u = new URL(url), body = o.body === undefined ? null : JSON.stringify(o.body);
    const q = http.request({ host: u.hostname, port: u.port, path: u.pathname + u.search, method: o.method || (body ? 'POST' : 'GET'),
      headers: Object.assign({ 'content-type': 'application/json' }, o.token ? { authorization: 'Bearer ' + o.token } : {}, o.headers || {}) }, (r) => {
      let s = ''; r.setEncoding('utf8'); r.on('data', (c) => { s += c; });
      r.on('end', () => { let b = null; try { b = JSON.parse(s); } catch (_) { b = { raw: s.slice(0, 300) }; } res({ status: r.statusCode, b }); });
    });
    q.on('error', rej); if (body) q.write(body); q.end();
  });
}

function localOnly(url) { let u; try { u = new URL(url); } catch (_) { return false; } return ['localhost', '127.0.0.1', '::1'].includes(u.hostname); }

/** up({ webBase }) → { api, stop() } — the api on a free port, allowing the walk's web origin */
async function up(o) {
  o = o || {};
  if (!localOnly(DB)) throw new Error('real-stack: CB_REAL_DB must be a localhost database — ' + DB);
  const port = await new Promise((res) => { const s = http.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
  const env = Object.assign({}, process.env, {
    NODE_ENV: 'development', PORT: String(port), HOST: '127.0.0.1', DATABASE_URL: DB, DEV_OTP: OTP, LOG_LEVEL: process.env.CB_API_LOG || 'warn',
    JWT_SECRET: process.env.JWT_SECRET || 'walk-local-secret-never-for-a-live-server-0123456789',
    SHOP_CLOCK_ALLOW: '1', RATE_LIMIT_MAX: '100000', AUTH_RATE_LIMIT_MAX: '100000', CHECK_LOGIN_RATE_LIMIT_MAX: '100000', CATALOGUE_RATE_LIMIT_MAX: '100000',
    ALLOWED_ORIGINS: [o.webBase, 'http://localhost:3000'].filter(Boolean).join(','),
  });
  const child = spawn(process.execPath, ['server.js'], { cwd: API_DIR, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const log = []; const keep = (c) => { const s = String(c); log.push(s); if (log.length > 200) log.shift(); if (process.env.CB_API_LOG) process.stderr.write(s); };
  child.stdout.on('data', keep); child.stderr.on('data', keep);
  const api = 'http://127.0.0.1:' + port;
  const t0 = Date.now();   /* clock-ok: a wait timer */
  while (Date.now() - t0 < 30000) {   /* clock-ok: a wait timer */
    if (child.exitCode !== null) throw new Error('real-stack: the api exited ' + child.exitCode + '\n' + log.join(''));
    try { const r = await j(api + '/health'); if (r.status === 200) break; } catch (_) {}
    await new Promise((r) => setTimeout(r, 250));
  }
  return { api, child, log: () => log.join(''), stop() { try { child.kill('SIGTERM'); } catch (_) {} } };
}

/** the cb_sess the apps store after an owner verifies (app.html entFromVerify → sessPersist) */
function sessionOf(v, email) {
  const e = (v && v.entity) || {};
  return JSON.stringify({ token: v.token, role: 'entity', name: e.display_name || email, entity: e.display_name || email, bridgeId: e.bridge_id || null, shop: 'open' });
}

/** the owner's sign-in, the two calls the Sign in screen makes (register mode:login → verify) */
async function signIn(api, email) {
  const a = await j(api + '/api/entities/register', { body: { email, mode: 'login' } });
  if (a.status !== 200) throw new Error('real-stack: sign-in ask refused ' + a.status + ' ' + JSON.stringify(a.b).slice(0, 200));
  const v = await j(api + '/api/entities/verify', { body: { email, otp: OTP } });
  if (v.status !== 200 || !v.b.token) throw new Error('real-stack: verify refused ' + v.status + ' ' + JSON.stringify(v.b).slice(0, 200));
  return { token: v.b.token, entity: v.b.entity || null, answer: v.b, session: sessionOf(v.b, email) };
}

/** an employee's sign-in (name@shop) — the actor door, used for a view-only login */
async function signInActor(api, username) {
  const a = await j(api + '/api/actors/login', { body: { username, otp: OTP } });
  if (a.status !== 200 || !a.b.token) throw new Error('real-stack: actor sign-in refused ' + a.status + ' ' + JSON.stringify(a.b).slice(0, 200));
  const x = a.b;
  return { token: x.token, answer: x, session: JSON.stringify({ token: x.token, role: 'actor', name: x.name || x.display_name || username, entity: (x.entity && x.entity.display_name) || x.entity_name || '', bridgeId: (x.entity && x.entity.bridge_id) || x.bridge_id || null, shop: 'open' }) };
}

/** a view-only employee: made once (actor_key), its one-time code re-minted on every later run (POST /actors/:id/otp), then signed in */
async function viewer(api, token, shopUserId, key) {
  key = key || 'viewer1';
  const a = await j(api + '/api/actors', { token, body: { display_name: 'View Only', actor_key: key, access_level: 'viewer' } });
  let otp = a.status === 200 ? (a.b.otp || (a.b.actor && a.b.actor.otp)) : null;
  if (!otp) {
    const list = await j(api + '/api/actors', { token });
    const rows = (list.b && (list.b.actors || list.b.rows || list.b.items)) || [];
    const me = rows.find((x) => x.actor_key === key || x.user_id === key + '@' + shopUserId);
    if (!me) throw new Error('real-stack: viewer ' + key + ' not found (' + a.status + ' ' + JSON.stringify(a.b).slice(0, 120) + ')');
    const re = await j(api + '/api/actors/' + me.identity_id + '/otp', { token, body: {} });
    if (re.status !== 200) throw new Error('real-stack: viewer code not re-minted ' + re.status + ' ' + JSON.stringify(re.b).slice(0, 120));
    otp = (re.b && re.b.dev_otp) || OTP;   /* DEV_OTP armed: the employee code is the fixed one (lib/dev-otp) even when the answer does not echo it */
  }
  const l = await j(api + '/api/actors/login', { body: { username: key + '@' + shopUserId, otp } });
  if (l.status !== 200 || !l.b.token) throw new Error('real-stack: viewer sign-in refused ' + l.status + ' ' + JSON.stringify(l.b).slice(0, 200));
  const x = l.b;
  return { token: x.token, answer: x, session: JSON.stringify({ token: x.token, role: 'actor', name: x.name || x.display_name || 'View Only', entity: (x.entity && x.entity.display_name) || x.entity_name || '', bridgeId: (x.entity && x.entity.bridge_id) || x.bridge_id || null, shop: 'open' }) };
}

/** a shopper on the public storefront: order/start (the code) then order/confirm (the order) — the same two calls shop.html makes */
async function shopperOrder(api, bridgeId, o) {
  const s = await j(api + '/api/catalogue/' + encodeURIComponent(bridgeId) + '/order/start', { body: { identifier: o.contact, name: o.name }, headers: { 'idempotency-key': crypto.randomUUID() } }); /* API-3 S36: one key per attempt */
  if (s.status !== 200) throw new Error('real-stack: order/start refused ' + s.status + ' ' + JSON.stringify(s.b).slice(0, 200));
  const c = await j(api + '/api/catalogue/' + encodeURIComponent(bridgeId) + '/order/confirm', { headers: { 'idempotency-key': crypto.randomUUID() }, body: Object.assign({ identifier: o.contact, name: o.name, otp: s.b.dev_otp || OTP_CUSTOMER, location: o.location || '', fulfilment: o.fulfilment || 'delivery', line_items: o.lines }, o.extra || {}) });
  if (c.status !== 200) throw new Error('real-stack: order/confirm refused ' + c.status + ' ' + JSON.stringify(c.b).slice(0, 300));
  return c.b;
}

/**
 * billByNo(no) → chit_id | null — the walk's own bill found by its number, read straight from the LOCAL database (the api's pg).
 * ⚠️ Why not a route: the loader's three years run 2026-04 → 2029-03, so every newest-first read (till/bills, the Task list) is topped by
 * future-dated bills and a bill made today is never on the first page (finding F-LOAD in docs/testing/WX-O2C-2026-10-13.md).
 */
async function billByNo(no) {
  if (!localOnly(DB)) throw new Error('real-stack: billByNo reads a localhost database only');
  const { Client } = require(path.join(API_DIR, 'node_modules', 'pg'));
  const c = new Client({ connectionString: DB }); await c.connect();
  try { const r = await c.query("SELECT chit_id FROM chit_header WHERE business_json->>'bill_no' = $1 ORDER BY created_at DESC LIMIT 1", [no]); return r.rows[0] ? String(r.rows[0].chit_id) : null; }
  finally { await c.end(); }
}
/** lastWalkBill() → { no, chit_id, total } — the newest credit bill to Ravi Stores from a WALK's counter (D…; the loader's is C1), same reason as billByNo */
async function lastWalkBill() {
  if (!localOnly(DB)) throw new Error('real-stack: lastWalkBill reads a localhost database only');
  const { Client } = require(path.join(API_DIR, 'node_modules', 'pg'));
  const c = new Client({ connectionString: DB }); await c.connect();
  try {
    const r = await c.query("SELECT chit_id, business_json->>'bill_no' AS no, summary_json->>'total_value' AS total FROM chit_header WHERE business_json->>'bill_no' LIKE 'D%' AND business_json::text ILIKE '%credit%' AND business_json::text LIKE '%Ravi Stores%' ORDER BY created_at DESC LIMIT 1");
    return r.rows[0] ? { no: r.rows[0].no, chit_id: String(r.rows[0].chit_id), total: String(r.rows[0].total) } : null;
  } finally { await c.end(); }
}

module.exports = { up, j, billByNo, lastWalkBill, signIn, signInActor, viewer, shopperOrder, sessionOf, OTP, OTP_CUSTOMER, DB, API_DIR };
