/* real-api.cjs — THE REAL STACK FOR A WALK (round WX-L2C, 2026-10-13): chitbridge-api's server.js as a CHILD of the walk, against the
 * local Postgres the loader filled (api docs/SIM-LOAD.md), stopped when the walk ends. A `--real` walk uses it; the fixture walks never do.
 *
 * ⭐ NEW PATH (rule 4): e2e/lib/walk.cjs serves the site and e2e/lib/standin.cjs answers /api/** inside the page; neither can start the api.
 *   tools/sim-load.cjs starts the api IN-PROCESS for the load but runs its main on require — it cannot be reused as a library. This file is the
 *   one place a walk starts the api, with the same env the loader gives it (JWT_SECRET · DEV_OTP · RLS_GUARD · RATE_LIMIT_MAX · LOG_LEVEL), plus
 *   ALLOWED_ORIGINS for the walk's own static server (server.js's CORS allowlist, a 403 otherwise) and DEV_OTP_IN_RESPONSE so a co-assist's
 *   first code is readable (lib/dev-otp.js echoOptIn — development only; a sealed NODE_ENV refuses it anyway).
 *
 *   const R = require('./lib/real-api.cjs');
 *   const api = await R.start({ origin: w.base });        // { base, j, owner(), viewer(), billTo(), stop() }
 *   const token = await api.owner();                      // the loader's shop (simstores · 123456) through /api/signin
 *   ...
 *   await api.stop();
 * Env: CB_API_DIR (default ../chitbridge-api beside this checkout) · CB_DB (default the loader's postgres://postgres:pw@127.0.0.1:5432/cb_sim)
 *      CB_SHOP (simstores) · CB_OTP (123456). A database URL whose host is not local is refused here too (the loader's rule). */
'use strict';
const TD = require('./today.cjs');
const path = require('path'), net = require('net');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const API_DIR = process.env.CB_API_DIR || path.join(ROOT, '..', 'chitbridge-api');
const DB = process.env.CB_DB || 'postgres://postgres:pw@127.0.0.1:5432/cb_sim';
const SHOP = process.env.CB_SHOP || 'simstores';
const OTP = process.env.CB_OTP || '123456';

function localOnly(url) {
  let u; try { u = new URL(url); } catch (_) { return false; }
  const h = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  return ['localhost', '127.0.0.1', '::1'].includes(h) || /^[a-z][a-z0-9_-]*$/.test(h);
}
const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); s.on('error', rej); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function start(opts) {
  const o = opts || {};
  if (!localOnly(DB)) throw new Error('real-api: ' + DB.replace(/:[^:@/]+@/, ':***@') + ' is not a local database — a walk never touches a remote one');
  const port = await freePort(), base = 'http://127.0.0.1:' + port;
  const env = Object.assign({}, process.env, {
    DATABASE_URL: DB, NODE_ENV: 'development', PORT: String(port), HOST: '127.0.0.1',
    JWT_SECRET: process.env.JWT_SECRET && process.env.JWT_SECRET.length >= 32 ? process.env.JWT_SECRET : 'walk-real-local-only-secret-' + 'x'.repeat(24),
    DEV_OTP: OTP, DEV_OTP_IN_RESPONSE: 'true', RLS_GUARD: process.env.RLS_GUARD || 'off', LOG_LEVEL: process.env.LOG_LEVEL || 'warn',
    RATE_LIMIT_MAX: process.env.RATE_LIMIT_MAX || '10000000',
    ALLOWED_ORIGINS: [o.origin, 'http://localhost:3000', 'http://localhost:5173'].filter(Boolean).join(','),
  });
  const child = spawn(process.execPath, ['server.js'], { cwd: API_DIR, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const log = [];
  child.stdout.on('data', (d) => { log.push(String(d)); if (process.env.REAL_API_LOG) process.stdout.write(d); });
  child.stderr.on('data', (d) => { log.push(String(d)); if (process.env.REAL_API_LOG) process.stderr.write(d); });
  let up = false;
  for (let i = 0; i < 150 && !up; i++) { try { const r = await fetch(base + '/health'); up = r.ok; } catch (_) {} if (!up) await sleep(200); if (child.exitCode != null) break; }
  if (!up) { try { child.kill(); } catch (_) {} throw new Error('real-api: the api did not answer /health on ' + base + '\n' + log.join('').slice(-1500)); }

  async function j(p, opt) {
    opt = opt || {};
    const r = await fetch(base + p, { method: opt.method || 'GET', headers: Object.assign({ 'content-type': 'application/json' }, opt.token ? { authorization: 'Bearer ' + opt.token } : {}), body: opt.body ? JSON.stringify(opt.body) : undefined });
    let b = null; try { b = await r.json(); } catch (_) {}
    return { status: r.status, b: b || {} };
  }
  const must = (r, what) => { if (r.status >= 300) throw new Error('real-api: ' + what + ' → HTTP ' + r.status + ' ' + JSON.stringify(r.b).slice(0, 300)); return r.b; };

  /** the shop's token, through the ONE sign-in door (lib/signin.js who(): a bare word is a user_id) */
  async function owner() {
    await j('/api/signin/ask', { method: 'POST', body: { mode: 'login', user_id: SHOP } });
    const v = must(await j('/api/signin/verify', { method: 'POST', body: { mode: 'login', user_id: SHOP, otp: OTP } }), 'owner sign-in');
    return v.token;
  }
  /** a view-only co-assist of the shop: { login, otp } — created once (409 → reused), the first code echoed by DEV_OTP_IN_RESPONSE */
  async function viewer(token, key) {
    key = key || 'velview';
    const r = await j('/api/actors', { method: 'POST', token, body: { display_name: 'Vel Viewer', actor_key: key, hat: 'view_only', access_level: 'viewer' } });
    const login = (r.b && (r.b.login_format || (r.b.actor && r.b.actor.login_format))) || (key + '@' + SHOP);
    if (r.status >= 300 && r.status !== 409) throw new Error('real-api: add viewer → HTTP ' + r.status + ' ' + JSON.stringify(r.b).slice(0, 300));
    /* FX-L2C (2026-10-13): the POST alone must make a viewer (routes/actors.js now stores access_level) — no PATCH behind it, so the walk's L20
       proves the row the POST made is what the server refuses on */
    return { login, otp: (r.b && (r.b.dev_otp || r.b.otp)) || OTP, created: r.status < 300, level: r.status < 300 ? 'viewer' : null };
  }
  /**
   * a counter bill naming the party (the loader's own shape, tools/sim-load.cjs step 5: recipients self · business_json.customer · the
   * invoice from lib/tax-lines.invoiceFor, the ONE calculation) — the door the flow's step 5 says ends a lead. One line, cash.
   */
  async function billTo(token, party, opt) {
    const TL = require(path.join(API_DIR, 'lib', 'tax-lines'));
    const me = must(await j('/api/entities/me', { token }), 'who am I'); const meRow = me.entity || me.identity || me;
    const have = must(await j('/api/products?limit=50', { token }), 'products'); const rows = have.items || have.products || have.rows || [];
    const it = rows[0]; if (!it) throw new Error('real-api: the shop has no products to bill');
    const d = it.item_data || it, price = Number(d.price) || 10, rate = Number(d.gst_rate) || 5;
    const lines = [{ particulars: d.name, quantity: 1, unit: d.unit || 'nos', price, total: price, item_id: it.item_id || it.id, hsn: d.hsn, gst_rate: rate }];
    const seller = TL.partyOf({ gstn: meRow.gstn, display_name: meRow.display_name, country: meRow.country || 'IN', policy_flags: meRow.policy_flags }, { entity_id: String(meRow.identity_id || meRow.entity_id || '') });
    const buyer = { LglNm: party.display_name, Gstin: null, State: null, Country: seller.Country || 'IN', RegType: 'unregistered', Ph: null, Em: null, entity_id: null, Pos: seller.State };
    const at = TD.nowIso();
    const inv = TL.invoiceFor({ lines, seller, buyer, currency: 'INR', at, priceIncludesTax: true }).invoice;
    const total = Number(inv.ValDtls && inv.ValDtls.TotInvVal) || price;
    const no = 'WX/' + String(Date.now()).slice(-6);   /* clock-ok: a unique bill-no suffix */
    const body = { recipients: [{ self: true, name: 'self' }], purpose: 'order', subject: 'Counter sale ' + no, manual_subject: 'Counter sale ' + no, client_ref: no,
      business_json: { customer: { name: party.display_name, party_id: party.party_id }, till: { id: 'C1', name: 'Counter 1', host: 'walk', by: null }, bill_no: no, billed_at: at, catalogue_version: null,
        payment: { mode: 'cash', paid: total, change: 0, parts: [{ how: 'cash', amount: total }] }, slip: 'cash', terms: null, credit_override: null, invoice: inv },
      line_items: lines };
    const r = await j('/api/chits/send', { method: 'POST', token, body });
    return { status: r.status, b: r.b, no, total };
  }
  async function stop() { try { child.kill('SIGTERM'); } catch (_) {} await sleep(300); try { child.kill('SIGKILL'); } catch (_) {} }
  return { base, port, j, must, owner, viewer, billTo, stop, log: () => log.join(''), shop: SHOP, otp: OTP };
}

module.exports = { start, SHOP, OTP, DB, API_DIR };
