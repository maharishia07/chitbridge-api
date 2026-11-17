'use strict';
/**
 * e2e/walk-firm-slow-practice.cjs — l16 R4-2 (Fable round 4): a practice answer HELD for a few seconds must never turn a firm seat's Home into the shop Home, and must never fan out calls.
 * The proxy holds GET /api/books-grants/practice for HELD_MS (default 4500); every seat loads Home LOADS times at 1366 and 390 (a fresh browser context each time).
 * Per seat, per load: FALLBACK = a firm seat whose page asked a shop card (/api/facts/till|marketing) or drew "Your clients · Open" instead of the practice; CALLS = /api calls of the load (events/stream not counted).
 * Passes: 0 fallbacks, calls <= e2e/firm-home-calls.budget.json firm_home_calls_slow_max, the loading frame (practice-loading) is seen while held, the practice then draws; a shop owner draws no practice and keeps the shop cards.
 * env: API (the box's api), WEB (public dir parent, default this repo), TOK (json of tokens), SEATS ("firmKey:firm,ownerKey:shop"), LOADS, HELD_MS, OUT. Pauses on the api's RateLimit-Remaining so the box limiter (500 / 900 s) is never hit.
 */
const { chromium } = require('playwright');
const http = require('http'), https = require('https'), fs = require('fs'), path = require('path');
const API = process.env.API || 'https://staging.129-225-90-80.sslip.io', OUT = process.env.OUT || '/out';
if (/railway|vercel/i.test(API)) throw new Error('STOP: production is never a target');
const ROOT = process.env.WEB || path.join(__dirname, '..'), PUB = path.join(ROOT, 'public');
const TOK = JSON.parse(fs.readFileSync(process.env.TOK || path.join(OUT, '.tok.json'), 'utf8'));
const SEATS = (process.env.SEATS || 'coastal-advisers-au:firm,bayside-books-au:firm,harbour-plumbing-au2:shop').split(',').map((s) => s.split(':'));
const LOADS = Number(process.env.LOADS || 8), HELD = Number(process.env.HELD_MS || 4500), SLOW_MAX = Number(JSON.parse(fs.readFileSync(path.join(__dirname, 'firm-home-calls.budget.json'), 'utf8')).firm_home_calls_slow_max || 8);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0, remaining = 999;
const ok = (what, cond, info) => { if (cond) { pass++; console.log('  ok   ' + what); } else { fail++; console.log('  FAIL ' + what + (info ? ' :: ' + String(info).slice(0, 400) : '')); } };
async function serve() {
  const target = new URL(API), lib = target.protocol === 'https:' ? https : http;
  const srv = http.createServer((q, r) => {
    const url = q.url.split('?')[0];
    if (url === '/config.js') { r.writeHead(200, { 'content-type': 'text/javascript' }); return r.end('window.CB_API = location.origin;'); }
    if (url.startsWith('/api/') || url === '/health') {
      const go = () => {
        const up = lib.request({ host: target.hostname, port: target.port || (target.protocol === 'https:' ? 443 : 80), path: q.url, method: q.method, headers: Object.assign({}, q.headers, { host: target.host }) }, (resp) => {
          const rem = Number(resp.headers['ratelimit-remaining']); if (!isNaN(rem)) remaining = rem;
          const send = () => { r.writeHead(resp.statusCode, resp.headers); resp.pipe(r); };
          if (url === '/api/books-grants/practice' && HELD > 0) { resp.pause(); setTimeout(() => { send(); resp.resume(); }, HELD); } else send(); /* the ANSWER is held, the request is sent at once */
        });
        up.on('error', (e) => { r.writeHead(502); r.end(String(e.message)); });
        q.pipe(up);
      };
      return go();
    }
    const home = url === '/' || url === '/index.html';
    const f = home ? path.join(ROOT, 'index.html') : path.join(PUB, decodeURIComponent(url).replace(/^[/]+/, ''));
    if ((!home && !f.startsWith(PUB)) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('no'); }
    r.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(r);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return 'http://127.0.0.1:' + srv.address().port;
}
async function load(browser, base, key, vp) {
  const ctx = await browser.newContext({ viewport: vp, locale: 'en-AU', timezoneId: 'Australia/Sydney', serviceWorkers: 'block', isMobile: vp.width < 500, hasTouch: vp.width < 500 });
  await ctx.addInitScript((s) => { try { if (!localStorage.getItem('cb_seeded')) { localStorage.setItem('cb_seeded', '1'); localStorage.setItem('cb_sess', JSON.stringify(s)); } } catch (_) {} }, { token: TOK[key], role: 'entity', name: key, entity: key });
  await ctx.route('http://localhost:3000/**', async (r) => {
    const cors = { 'access-control-allow-origin': base, 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': '*' };
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors });
    if (r.request().url().includes('/events/stream')) return r.abort();
    const u = new URL(r.request().url()), hs = Object.assign({}, r.request().headers());
    delete hs.origin; delete hs.referer;
    const got = await r.fetch({ url: base + u.pathname + u.search, headers: hs });
    return r.fulfill({ response: got, headers: Object.assign({}, got.headers(), cors) });
  });
  const page = await ctx.newPage(), calls = [];
  page.on('console', (m) => { if (process.env.DEBUG_CONSOLE && /error|warn/i.test(m.type())) console.log('   [console] ' + m.text().slice(0, 200)); });
  page.on('pageerror', (e) => { if (process.env.DEBUG_CONSOLE) console.log('   [pageerror] ' + e.message.slice(0, 200)); });
  page.on('request', (r) => { const u = r.url(); if (u.includes('/api/') && !u.includes('/api/events/stream')) calls.push(u.replace(/^https?:[/][/][^/]+/, '').replace(/\?.*/, '')); });
  await page.goto(base + '/');
  let sawWait = false, early = 0;
  for (let t = 0; t < (HELD + 9000) / 200; t++) {
    await pause(200);
    if (await page.locator('[data-testid="practice-loading"]').count()) sawWait = true;
    /* l16 R5-2: while the answer is held, no shop area card, no shop words and no 'Your work' is on screen (only the loading frame) */
    if (!(await page.locator('[data-testid="practice"]').count()) && (await page.evaluate(() => { const a = document.querySelector('[data-testid="shell-areas"]'); return !!a && a.getClientRects().length > 0 && /Till|Marketing|No shop yet|Your work/.test(a.innerText); }))) early++;
  }
  const st = await page.evaluate(() => ({ practice: !!document.querySelector('[data-testid="practice-list"]'), door: !!document.querySelector('[data-testid="home-your-clients"]'), till: !!document.querySelector('[data-testid="shell-card-till"]'), waiting: !!document.querySelector('[data-testid="practice-loading"]') }));
  await ctx.close();
  return { calls, sawWait, early, st, shopAsked: calls.some((c) => /\/api\/facts\/(till|marketing)/.test(c)) };
}
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const base = await serve(), b = await chromium.launch();
  for (const [key, kind] of SEATS) for (const vp of [{ width: 1366, height: 768, tag: '1366' }, { width: 390, height: 844, tag: '390' }]) {
    const tag = key + ' ' + vp.tag + ' held ' + HELD + 'ms', rows = [];
    for (let n = 0; n < LOADS; n++) { while (remaining < 140) { console.log('  (limiter: ' + remaining + ' left, waiting 60 s)'); await pause(60000); remaining = 999; } rows.push(await load(b, base, key, vp)); }
    const calls = rows.map((x) => x.calls.length), fb = rows.filter((x) => kind === 'firm' ? (x.shopAsked || x.st.door || !x.st.practice) : x.st.practice);
    console.log(tag + ' (' + kind + ') calls per load: ' + calls.join(',') + ' | fallbacks/wrong: ' + fb.length + ' of ' + rows.length);
    if (kind === 'firm') {
      ok(tag + ': no shop card or shop words on screen before the practice (samples every 0.2 s; early = ' + rows.map((x) => x.early).join() + ')', rows.every((x) => x.early === 0), rows.map((x) => x.early).join());
      ok(tag + ': 0 fallbacks to the shop Home (practice drawn, no shop card asked, no Your clients card)', fb.length === 0, JSON.stringify(fb.slice(0, 2).map((x) => x.st)) + ' ' + x0(fb));
      ok(tag + ': calls per load <= ' + SLOW_MAX + ' (max ' + Math.max(...calls) + ')', Math.max(...calls) <= SLOW_MAX, rows.find((x) => x.calls.length > SLOW_MAX) ? rows.find((x) => x.calls.length > SLOW_MAX).calls.join(' ') : '');
      ok(tag + ': the loading frame is shown while the practice is held, and gone once it is drawn', rows.every((x) => x.sawWait && !x.st.waiting), rows.map((x) => x.sawWait + '/' + x.st.waiting).join());
    } else {
      ok(tag + ': a shop owner draws no practice, keeps the shop cards, no loading frame left', rows.every((x) => !x.st.practice && x.st.till && !x.st.waiting), JSON.stringify(rows[0].st));
    }
  }
  await b.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('WALK FAILED', e && e.stack || e); process.exit(1); });
function x0(fb) { return fb.length ? 'first: ' + (fb[0].calls.length) + ' calls' : ''; }
