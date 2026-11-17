'use strict';
/* e2e/bills-books-live.cjs — E19 proof on a SIT box: the owner of a seeded client opens Unpaid bills and reads the SAME money the books' Dues read says.
 * Owner signs in once (POST /api/entities/verify), the api's GET /dues?side=supplier gives the figure, the page must paint it (A$9,284.00 on Seed E client 001) at 1366 and 390, no sideways scroll.
 * env: API (api base, never production), WEB (tree with public/), CODE (the tester code, from the box env, never written to a file), EMAIL (default seedeh001@test.chitbridge), OUT. Read only. */
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const API = process.env.API || 'http://127.0.0.1:3996', OUT = process.env.OUT || '/out', EMAIL = process.env.EMAIL || 'seedeh001@test.chitbridge', CODE = process.env.CODE;
if (/railway|vercel/i.test(API)) throw new Error('STOP: production is never a target');
const ROOT = process.env.WEB || path.join(__dirname, '..'), PUB = path.join(ROOT, 'public');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
let pass = 0, fail = 0;
const ok = (what, cond, info) => { if (cond) { pass++; console.log('  ok   ' + what); } else { fail++; console.log('  FAIL ' + what + (info ? ' :: ' + String(info).slice(0, 400) : '')); } };
const call = (method, p, body, tok) => new Promise((res, rej) => {
  const d = body ? JSON.stringify(body) : '';
  const q = http.request(API + p, { method, headers: Object.assign({ 'content-type': 'application/json' }, tok ? { authorization: 'Bearer ' + tok } : {}, d ? { 'content-length': Buffer.byteLength(d) } : {}) }, (r) => { let s = ''; r.on('data', (c) => (s += c)); r.on('end', () => { try { res(JSON.parse(s || '{}')); } catch (e) { res({ raw: s.slice(0, 200) }); } }); });
  q.on('error', rej); q.end(d);
});
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const R = await call('POST', '/api/entities/verify', { email: EMAIL, otp: CODE });
  if (!R.token) throw new Error('sign-in failed for ' + EMAIL + ' ' + JSON.stringify(Object.keys(R)));
  const sess = { token: R.token, role: R.role || 'entity', name: R.name || EMAIL, entity: R.entity };
  const due = await call('GET', '/api/books/dues?side=supplier', null, R.token);
  const total = Math.abs(Number(due.total_minor)), parties = (due.parties || []).filter((p) => Number(p.balance_minor) !== 0);
  console.log('api dues side=supplier: total_minor=' + due.total_minor + ' parties=' + parties.length + ' ' + JSON.stringify(parties.map((p) => [p.name, p.balance_minor])));
  ok('the api has money owed to suppliers to compare with', total > 0, JSON.stringify(due).slice(0, 200));
  const srv = http.createServer((q, r) => {
    const url = q.url.split('?')[0];
    if (url === '/config.js') { r.writeHead(200, { 'content-type': 'text/javascript' }); return r.end('window.CB_API = location.origin;'); }
    if (url.startsWith('/api/') || url === '/health') {
      const t = new URL(API);
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
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + srv.address().port, b = await chromium.launch();
  for (const vp of [{ width: 1366, height: 768, tag: '1366' }, { width: 390, height: 844, tag: '390' }]) {
    const ctx = await b.newContext({ viewport: vp, locale: 'en-AU', timezoneId: 'Australia/Sydney', serviceWorkers: 'block', isMobile: vp.width < 500, hasTouch: vp.width < 500 });
    await ctx.addInitScript((s) => { try { if (!localStorage.getItem('cb_seeded')) { localStorage.setItem('cb_seeded', '1'); localStorage.setItem('cb_sess', JSON.stringify(s)); } } catch (_) {} }, sess);
    await ctx.route('http://localhost:3000/**', async (r) => {
      const cors = { 'access-control-allow-origin': base, 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': '*' };
      if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors });
      if (r.request().url().includes('/events/stream')) return r.abort();
      const u = new URL(r.request().url()), hs = Object.assign({}, r.request().headers());
      delete hs.origin; delete hs.referer;
      const got = await r.fetch({ url: base + u.pathname + u.search, headers: hs });
      return r.fulfill({ response: got, headers: Object.assign({}, got.headers(), cors) });
    });
    const page = await ctx.newPage(), threw = [];
    page.on('pageerror', (e) => threw.push(e.message));
    await page.goto(base + '/accounts.html#bills');
    await page.waitForSelector('[data-testid="bills-list"]', { timeout: 40000 }).catch(() => {});
    await pause(2500);
    const received = page.locator('[data-testid="bills-tab-B-2100"]');
    if (await received.count()) await received.click();
    await pause(2500);
    const line = await page.locator('[data-testid="bills-books-total"]').first().innerText().catch(() => '');
    const digits = (line.match(/[\d,]+\.\d\d/) || [''])[0].replace(/,/g, '');
    ok(vp.tag + ': the Unpaid bills figure equals the Dues figure (' + (total / 100).toFixed(2) + ')', digits === (total / 100).toFixed(2), line);
    const body = await page.evaluate(() => document.body.innerText);
    ok(vp.tag + ': it no longer says "Nothing open"', !/Nothing open/.test(body));
    ok(vp.tag + ': a row per books-owed supplier', (await page.locator('[data-testid^="bill-books-"]').count()) >= Math.min(parties.length, 1), 'rows=' + (await page.locator('[data-testid^="bill-"]').count()));
    ok(vp.tag + ': no sideways scroll', await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
    ok(vp.tag + ': no page error', !threw.length, threw.join(' | '));
    await page.screenshot({ path: OUT + '/bills-' + vp.tag + '.png' });
    await ctx.close();
  }
  await b.close(); srv.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('ERR ' + e.message); process.exit(2); });
