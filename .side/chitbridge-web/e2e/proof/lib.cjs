'use strict';
/* OWNS: what every proof pack shares: the flags, the page list (pages.json), the local sign-in, the browser, the write guard, the axe source.
   CALLED BY: e2e/proof/a11y.cjs, keyboard.cjs, run.cjs · stack: .github/workflows/proof.yml (e2e/lib/stack-local.cjs up) or a local `node e2e/lib/stack-local.cjs up`.
   ⚠️ LOCAL STACK ONLY unless --remote-ok <host> names the SIT box (QA proof on sit-au, 11 Nov): then base must be https://<that host>, the api is the same host, and sign-in is a
   SIT test user's tester code (--users ~/.cb-sit-users.json --server sit-au --as cbt-au-retail; the file is read, never printed). sit-in (the gate box) and production are refused by name. */
const fs = require('fs'), path = require('path');
const { guardDecision, remoteHostDecision } = require('./guard.cjs');
const RS = require('../lib/real-stack.cjs');
const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const BASE = String(arg('base', process.env.CB_PROOF_BASE || 'http://localhost:5173')).replace(/\/+$/, '');
const API = String(arg('api', process.env.CB_PROOF_API || 'http://localhost:3000')).replace(/\/+$/, '');
const SHOP = arg('shop', process.env.CB_PROOF_SHOP || 'simstores@test.example');
const HEIGHT = { 1366: 768, 390: 844 };
const WIDTHS = String(arg('widths', '1366,390')).split(',').map((s) => Number(s.trim())).filter((n) => n > 0);
const VPS = WIDTHS.map((w) => [w, HEIGHT[w] || 800]);
const PAGES = JSON.parse(fs.readFileSync(path.join(__dirname, 'pages.json'), 'utf8')).pages;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fwdN = Math.floor(Math.random() * 40000);
const REMOTE_OK = arg('remote-ok', '').toLowerCase();
const isLocal = (u) => ['localhost', '127.0.0.1', '::1'].includes(new URL(u).hostname);
if (REMOTE_OK) {
  const d = remoteHostDecision(BASE, API, REMOTE_OK);
  if (!d.ok) { console.error('refused: --remote-ok ' + REMOTE_OK + ': ' + d.why); process.exit(2); }
} else if (!isLocal(BASE) || !isLocal(API)) { console.error('refused: the proof packs run against a LOCAL stack only (' + BASE + ' · ' + API + ')'); process.exit(2); }
const HOSTS = [new URL(BASE).host, new URL(API).host];

/** → { email, session } the cb_sess the pages store, from the local api's DEV_OTP door */
async function ownShop() { if (REMOTE_OK) return remoteShop(); const s = await RS.signIn(API, SHOP); return { email: SHOP, session: s.session }; }
/** SIT: sign in as one of our own test users by the day's tester code (template + tz in the users file); -> the same { email, session } */
async function remoteShop() {
  const all = JSON.parse(fs.readFileSync(arg('users', path.join(require('os').homedir(), '.cb-sit-users.json')), 'utf8')), srv = all.servers[arg('server', 'sit-au')], email = arg('as', 'cbt-au-retail') + '@test.chitbridge';
  if (!srv || !srv.sign_in || !srv.sign_in.tester_code_template) throw new Error('remote sign-in: no tester_code_template for that server in the users file');
  if (!srv.host || new URL(srv.host).host.toLowerCase() !== new URL(API).host) throw new Error('remote sign-in: the users file host for that server is not the host being driven (the tester code is not sent to another host)');
  const tz = arg('tz', 'Australia/Sydney'), day = (o) => new Date(Date.now() + o * 864e5).toLocaleDateString('en-CA', { timeZone: tz }).replace(/-/g, '');
  const codes = [0, -1, 1].map((o) => srv.sign_in.tester_code_template.replace('{yyyymmdd}', day(o)).replace('{yymmdd}', day(o).slice(2)));
  const call = async (m, p, tok, body) => { const r = await fetch(API + p, { method: m, headers: Object.assign({ 'content-type': 'application/json', 'x-forwarded-for': '10.79.' + ((++fwdN >> 8) & 255) + '.' + (fwdN & 255) }, tok ? { authorization: 'Bearer ' + tok } : {}), body: body === undefined ? undefined : JSON.stringify(body) }); const t = await r.text(); let b; try { b = JSON.parse(t); } catch (_) { b = {}; } return { status: r.status, b }; };
  /* the api limits sign-in asks per address (a few per 15 min): verify with the tester code first, ask only when that is refused */
  let v = null; const tryCodes = async () => { for (const c of codes) { const x = await call('POST', '/api/signin/verify', null, { email, mode: 'login', otp: c }); if (x.status === 200 && x.b.token) { v = x.b; break; } } };
  await tryCodes(); if (!v) { await call('POST', '/api/signin/ask', null, { email, mode: 'login' }); await tryCodes(); }
  if (!v) throw new Error('remote sign-in refused for the test user (tester code)');
  const me = await call('GET', '/api/entities/me', v.token); v.entity = (me.b && (me.b.entity || me.b)) || {};
  return { email, session: RS.sessionOf(v, email) };
}
function playwright() { for (const m of ['playwright', '@playwright/test', 'playwright-core']) { try { return require(m); } catch (_) { /* next */ } } throw new Error('no playwright: run npm ci in e2e/ (or set NODE_PATH to e2e/node_modules)'); }
function axeSource() { return fs.readFileSync(path.join(__dirname, '..', 'vendor', 'axe-core', 'axe.min.js'), 'utf8'); }
/** the pack's browser rules: no fonts from the internet, every write to the app aborted (counted in counts.writes), off-host navigation aborted */
async function guardContext(ctx, counts) {
  /* SIT box only: the api limits 500 requests per 15 min per client address; every browser context gets its own private 10.79.x.y forwarded address, as the SIT walks do (toolset web.cjs) */
  if (REMOTE_OK) { fwdN++; await ctx.setExtraHTTPHeaders({ 'x-forwarded-for': '10.79.' + ((fwdN >> 8) & 255) + '.' + (fwdN & 255) }); }
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await ctx.route(() => true, async (r) => {
    const q = r.request(), d = guardDecision(q.method(), q.url(), HOSTS, q.isNavigationRequest());
    if (d.act === 'abort') { if (d.why === 'write' && counts) counts.writes++; return r.abort('blockedbyclient'); }
    return r.fallback();
  });
}
module.exports = { arg, argv, BASE, API, HOSTS, VPS, WIDTHS, PAGES, sleep, ownShop, playwright, axeSource, guardContext };
