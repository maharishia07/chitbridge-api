/* e2e/lib/live-harbour.cjs — the shared start of the bank e2es that run against a REAL api (a SIT box's throwaway api): the web's public/ served from this checkout, /api proxied to API, the owner signed in with the daily tester code.
 * env: API (http://127.0.0.1:3998), TESTER_CODE (+ TESTER_CODE_TZ) from the box, HANDLE (harbour-plumbing-au), OUT (shots folder). Never production: the api must be loopback or a *.sslip.io SIT host. */
'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', '..'), PUB = path.join(ROOT, 'public');
const T = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
const TODAY = require('./today.cjs');
const API = process.env.API || 'http://127.0.0.1:3998';
if (/railway|vercel/i.test(API)) throw new Error('STOP: production is never a target');
const ymd = (tz, off) => { const p = TODAY.dayPlus(off, TODAY.todayIn(tz)).split('-'); return p[0].slice(2) + p[1] + p[2]; };   /* the tester code is the server's real day in the zone: the day comes from the walks' one today (e2e/lib/today.cjs), never a raw clock */
async function call(method, p, token, body) {
  const res = await fetch(API + p, { method, headers: Object.assign({ 'content-type': 'application/json' }, token ? { authorization: 'Bearer ' + token } : {}), body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text(); let json; try { json = JSON.parse(text); } catch (_) { json = text; }
  return { status: res.status, ok: res.ok, body: json };
}
async function signIn(handle) {
  const email = handle + '@test.chitbridge', cache = path.join(process.env.OUT || '.', 'token.json');
  try { const t = JSON.parse(fs.readFileSync(cache, 'utf8')).token; if ((await call('GET', '/api/entities/me', t)).ok) return t; } catch (_) { /* no usable token saved: sign in */ }
  const token = await signInFresh(email);
  try { fs.writeFileSync(cache, JSON.stringify({ token })); } catch (_) { /* the cache is a courtesy: the sign-in doors are rate limited */ }
  return token;
}
async function signInFresh(email) {
  await call('POST', '/api/signin/ask', null, { mode: 'login', email });
  const tz = process.env.TESTER_CODE_TZ || 'Asia/Kolkata';
  for (const off of [0, -1]) {
    const otp = (process.env.TESTER_CODE || '').replace('{yymmdd}', ymd(tz, off)).replace('{yyyymmdd}', '20' + ymd(tz, off));
    const v = await call('POST', '/api/signin/verify', null, { mode: 'login', otp, email });
    if (v.ok && v.body.token) return v.body.token;
  }
  throw new Error('sign-in refused');
}
/** the web served from this checkout; /api/* goes to API; /config.js says the api is this very origin */
async function serve() {
  const srv = http.createServer((q, r) => {
    const url = q.url.split('?')[0];
    if (url === '/config.js') { r.writeHead(200, { 'content-type': 'text/javascript' }); return r.end('window.CB_API = location.origin;'); }
    if (url.startsWith('/api/') || url === '/health') {
      const target = new URL(API + q.url);
      const up = http.request({ host: target.hostname, port: target.port, path: target.pathname + target.search, method: q.method, headers: Object.assign({}, q.headers, { host: target.host }) }, (resp) => { r.writeHead(resp.statusCode, resp.headers); resp.pipe(r); });
      up.on('error', (e) => { r.writeHead(502); r.end(String(e.message)); });
      return q.pipe(up);
    }
    const rel = decodeURIComponent(url).replace(/^\/+/, ''), f = path.join(PUB, rel || 'index.html');
    if (!f.startsWith(PUB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('no'); }
    r.writeHead(200, { 'content-type': T[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(r);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return { srv, base: 'http://127.0.0.1:' + srv.address().port };
}
/** a signed-in page on the bank view; the session is seeded once per context */
async function open(browser, base, token, vp, entity, target, waitSel) {
  const ctx = await browser.newContext({ viewport: vp, locale: 'en-AU', timezoneId: 'Australia/Sydney', serviceWorkers: 'block' });
  await ctx.addInitScript((s) => { try { if (!localStorage.getItem('cb_seeded')) { localStorage.setItem('cb_seeded', '1'); localStorage.setItem('cb_sess', JSON.stringify(s)); } } catch (_) {} }, { token, role: 'entity', name: entity || 'Harbour Plumbing', entity: entity || 'Harbour Plumbing' });
  /* the app talks to http://localhost:3000 on a dev host: those calls go to the real api, with the CORS answer the browser wants */
  await ctx.route('http://localhost:3000/**', async (r) => {
    const cors = { 'access-control-allow-origin': base, 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': '*' };
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors });
    if (r.request().url().includes('/events/stream')) return r.abort();
    const u = new URL(r.request().url()), hs = Object.assign({}, r.request().headers()); delete hs.origin; delete hs.referer; const got = await r.fetch({ url: API + u.pathname + u.search, headers: hs }); if (got.status() >= 400 && !globalThis.__logged) { globalThis.__logged = 1; console.log('API', got.status(), u.pathname, (await got.text()).slice(0, 300), JSON.stringify(Object.keys(hs))); }
    return r.fulfill({ response: got, headers: Object.assign({}, got.headers(), cors) });
  });
  const page = await ctx.newPage();
  const threw = (page.__threw = []);
  page.on('pageerror', (e) => threw.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') threw.push('console: ' + m.text().slice(0, 200)); });
  page.on('requestfailed', (r) => threw.push('FAILED ' + r.url().slice(0, 120)));
  page.on('response', (r) => { if (r.status() >= 400) threw.push(r.status() + ' ' + r.url().slice(-80)); });
  await page.goto(base + (target || '/accounts.html#bank')); /* target: an adviser opens '/accounts.html?acting=<client id>#bank' */
  try { await page.waitForSelector(waitSel || '[data-testid="bank-file"]', waitSel ? { timeout: 20000 } : { timeout: 20000, state: 'attached' }); /* one door: the plain picker's input may be hidden behind the Statements box (attached, not visible) */ } catch (e) { console.log('OPEN-FAILED url', page.url(), 'threw', JSON.stringify(threw), 'body', ((await page.textContent('body').catch(() => '')) || '').replace(/s+/g, ' ').slice(0, 500)); throw e; }
  return { ctx, page };
}
module.exports = { serve, open, signIn, call, API };
