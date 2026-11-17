'use strict';
/**
 * e2e/walk-firm-landing.cjs — l16 W4 + W5 (walk 16 Nov): a firm's STAFF login lands on the practice, a shop's staff keep the rail, and a firm whose practice read is
 * rate-limited (429) sees "Can't load your practice right now · Try again", never the shop Home.
 * The page is served from this repo with /api proxied to API; the practice answer is simulated (429 / empty) with a route, so the box limiter is never touched.
 * env: API (the box's api, never production), CODE (the tester code), ACTORS ("aud1@seedefirmau,acct1@seedefirmau"), WEB (repo root, default this repo), OUT.
 */
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const API = process.env.API || 'http://127.0.0.1:3991', CODE = process.env.CODE, OUT = process.env.OUT || '/tmp';
if (/railway|vercel/i.test(API)) throw new Error('STOP: production is never a target');
const ROOT = process.env.WEB || path.join(__dirname, '..'), PUB = path.join(ROOT, 'public');
const ACTORS = (process.env.ACTORS || 'aud1@seedefirmau,acct1@seedefirmau').split(',');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
let pass = 0, fail = 0;
const ok = (what, cond, info) => { if (cond) { pass++; console.log('  ok   ' + what); } else { fail++; console.log('  FAIL ' + what + (info ? ' :: ' + String(info).slice(0, 300) : '')); } };
function call(pathname, body) {
  return new Promise((res, rej) => {
    const d = JSON.stringify(body), q = http.request(API + pathname, { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(d) } }, (r) => { let s = ''; r.on('data', (c) => (s += c)); r.on('end', () => { try { res(JSON.parse(s)); } catch (_) { res({}); } }); });
    q.on('error', rej); q.write(d); q.end();
  });
}
function serve() {
  const t = new URL(API);
  const srv = http.createServer((q, r) => {
    const url = q.url.split('?')[0];
    if (url === '/config.js') { r.writeHead(200, { 'content-type': 'text/javascript' }); return r.end('window.CB_API = location.origin;'); }
    if (url.startsWith('/api/') || url === '/health') {
      const up = http.request({ host: t.hostname, port: t.port, path: q.url, method: q.method, headers: Object.assign({}, q.headers, { host: t.host }) }, (resp) => { r.writeHead(resp.statusCode, resp.headers); resp.pipe(r); });
      up.on('error', (e) => { r.writeHead(502); r.end(String(e.message)); });
      return q.pipe(up);
    }
    const home = url === '/' || url === '/index.html';
    const f = home ? path.join(ROOT, 'index.html') : path.join(PUB, decodeURIComponent(url).replace(/^[/]+/, ''));
    if ((!home && !f.startsWith(PUB)) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('no'); }
    r.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(r);
  });
  return new Promise((res) => srv.listen(0, '127.0.0.1', () => res({ srv, base: 'http://127.0.0.1:' + srv.address().port })));
}
/* one browser context: the session goes in as cb_sess (and the hint, when given); the practice answer is `mode` real | 429 | empty, or a function(count) -> mode */
async function open(browser, base, sess, hint, mode) {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, locale: 'en-AU', timezoneId: 'Australia/Sydney', serviceWorkers: 'block' });
  await ctx.addInitScript((a) => { try { if (!localStorage.getItem('cb_seeded')) { localStorage.setItem('cb_seeded', '1'); localStorage.setItem('cb_sess', JSON.stringify(a.s)); if (a.h) localStorage.setItem('cb_practice_hint', a.h + ':' + a.s.token.slice(-12)); } } catch (_) {} }, { s: sess, h: hint });
  let count = 0;
  await ctx.route('http://localhost:3000/**', async (r) => { /* the page's default api base, pointed at the box api */
    const u = new URL(r.request().url()), cors = { 'access-control-allow-origin': base, 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': '*' };
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors });
    if (u.pathname.includes('/events/stream')) return r.abort();
    if (u.pathname === '/api/books-grants/practice') {
      const m = typeof mode === 'function' ? mode(count++) : mode;
      if (m === '429') return r.fulfill({ status: 429, headers: cors, body: '{"error":"rate"}', contentType: 'application/json' });
      if (m === 'empty') return r.fulfill({ status: 200, headers: cors, body: '{"clients":[],"own_trade":true}', contentType: 'application/json' });
    }
    const hs = Object.assign({}, r.request().headers()); delete hs.origin; delete hs.referer;
    try {
      const got = await r.fetch({ url: API + u.pathname + u.search, headers: hs });
      return await r.fulfill({ response: got, headers: Object.assign({}, got.headers(), cors) });
    } catch (_) { /* the context closed with a call in flight */ }
  });
  return { ctx, page: await ctx.newPage() };
}
const has = (page, id) => page.locator('[data-testid="' + id + '"]').first().isVisible().catch(() => false);
(async () => {
  const { srv, base } = await serve(), browser = await chromium.launch(), seats = {};
  for (const u of ACTORS) {
    const R = await call('/api/actors/login', { username: u, otp: CODE });
    if (!R.token) throw new Error('login ' + u + ' ' + JSON.stringify(R).slice(0, 200));
    seats[u] = { token: R.token, role: R.role || 'actor', name: R.name || u, entity: R.entity, bridgeId: R.bridgeId, duty: R.duty };
  }
  for (const u of ACTORS) {
    console.log(u);
    /* W4, first sign-in (no hint): the one practice read decides, the page ends on Home with the practice */
    let { ctx, page } = await open(browser, base, seats[u], '', 'real');
    await page.goto(base + '/app.html#/app');
    await page.waitForSelector('[data-testid="practice-list"],[data-testid="nav-task"]', { timeout: 20000 }).catch(() => {});
    ok('W4 ' + u + ' lands on the practice Home (no hint yet)', !/app\.html/.test(page.url()) && (await has(page, 'practice-list')), page.url());
    ok('W4 ' + u + ': the rail is not the landing', !(await has(page, 'nav-task')));
    await page.goto(base + '/app.html#/app'); /* a reload / the next visit: the kept hint answers at once */
    await page.waitForSelector('[data-testid="practice-list"]', { timeout: 20000 }).catch(() => {});
    ok('W4 ' + u + ' again (hint kept) lands on the practice Home', !/app\.html/.test(page.url()) && (await has(page, 'practice-list')), page.url());
    await ctx.close();
    /* a shop's staff: the practice has no clients, the rail stays */
    ({ ctx, page } = await open(browser, base, seats[u], '', 'empty'));
    await page.goto(base + '/app.html#/app');
    await page.waitForSelector('[data-testid="nav-task"]', { timeout: 20000 }).catch(() => {});
    ok('W4 counter staff of a shop (practice empty) keep the rail', /app\.html/.test(page.url()) && (await has(page, 'nav-task')), page.url());
    await ctx.close();
  }
  /* W5: a known firm (hint 1), the practice answer 429 */
  const u = ACTORS[0];
  let { ctx, page } = await open(browser, base, seats[u], '1', '429');
  await page.goto(base + '/');
  await page.waitForSelector('[data-testid="practice-failed"]', { timeout: 20000 }).catch(() => {});
  ok('W5 known firm + 429: the calm "Try again" frame shows', await has(page, 'practice-failed'));
  ok('W5 the retry button is there', await has(page, 'read-failed-retry'));
  await page.waitForTimeout(1500);
  ok('W5 no shop Home (areas) is drawn', !(await has(page, 'shell-areas')));
  await page.screenshot({ path: path.join(OUT, 'w5-failed.png') }).catch(() => {});
  await ctx.close();
  /* Try again: the first read is 429, the retry is answered for real */
  ({ ctx, page } = await open(browser, base, seats[u], '1', (n) => (n < 1 ? '429' : 'real')));
  await page.goto(base + '/');
  await page.waitForSelector('[data-testid="read-failed-retry"]', { timeout: 20000 }).catch(() => {});
  await page.locator('[data-testid="read-failed-retry"]').click().catch(() => {});
  await page.waitForSelector('[data-testid="practice-list"]', { timeout: 20000 }).catch(() => {});
  ok('W5 Try again: the practice draws and the failed frame is gone', (await has(page, 'practice-list')) && !(await has(page, 'practice-failed')));
  await ctx.close();
  /* an unknown login (no hint) keeps hold-then-decide: no failed frame */
  ({ ctx, page } = await open(browser, base, seats[u], '', '429'));
  await page.goto(base + '/');
  await page.waitForTimeout(4000);
  ok('W5 unknown login + 429: no failed frame (hold-then-decide unchanged)', !(await has(page, 'practice-failed')));
  await ctx.close();
  await browser.close(); srv.close();
  console.log('pass ' + pass + ' fail ' + fail);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('ERR ' + e.stack); process.exit(2); });
