'use strict';
/**
 * e2e/walk-client-nav.cjs — l16 R4-2b (Athi walking sit-au): inside an acting-as client, Back (browser AND in-app) goes up ONE level within that client and never to the network page.
 * practice -> client (Open books) -> Books tab -> Bank (auditor) / Day book (adviser) -> browser Back x3 (Books, client Home, practice) -> Forward x3; then in-app back (client page, then practice list).
 * Also: the header names the client (plainly, no "Working on") with one press back to Clients; the Clients crumb leads to the practice list; the practice list marks the last-opened client ("Last opened" chip in its row), scrolled into view and focused.
 * env: API, WEB (tree with public/), TOK (json of tokens), SEATS (auditor:coastal-advisers-au,adviser:bayside-books-au), OUT. Read only; the browser runs on a SIT box, never the laptop.
 */
const { chromium } = require('playwright');
const http = require('http'), https = require('https'), fs = require('fs'), path = require('path');
const API = process.env.API || 'https://staging.129-225-90-80.sslip.io', OUT = process.env.OUT || '/out';
if (/railway|vercel/i.test(API)) throw new Error('STOP: production is never a target');
const ROOT = process.env.WEB || path.join(__dirname, '..'), PUB = path.join(ROOT, 'public');
const TOK = JSON.parse(fs.readFileSync(process.env.TOK || path.join(OUT, '.tok.json'), 'utf8'));
const SEATS = (process.env.SEATS || 'auditor:coastal-advisers-au,adviser:bayside-books-au').split(',').map((s) => s.split(':'));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (what, cond, info) => { if (cond) { pass++; console.log('  ok   ' + what); } else { fail++; console.log('  FAIL ' + what + (info ? ' :: ' + String(info).slice(0, 300) : '')); } };
async function serve() {
  const target = new URL(API), lib = target.protocol === 'https:' ? https : http;
  const srv = http.createServer((q, r) => {
    const url = q.url.split('?')[0];
    if (url === '/config.js') { r.writeHead(200, { 'content-type': 'text/javascript' }); return r.end('window.CB_API = location.origin;'); }
    if (url.startsWith('/api/') || url === '/health') {
      const up = lib.request({ host: target.hostname, port: target.port || 443, path: q.url, method: q.method, headers: Object.assign({}, q.headers, { host: target.host }) }, (resp) => { r.writeHead(resp.statusCode, resp.headers); resp.pipe(r); });
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
  return 'http://127.0.0.1:' + srv.address().port;
}
/* l16 R5-1: the header's last visible control must end inside the screen (and inside its bar), and no element of the page scrolls sideways (the document alone is not enough: main.scroll was panning 58 px) */
async function headerFit(page) {
  return page.evaluate(() => {
    const bar = document.querySelector('.cbsh-bar'), vis = (n) => n.getClientRects().length && getComputedStyle(n).visibility !== 'hidden';
    const kids = bar ? Array.from(bar.querySelectorAll('button,a,.cbsh-av')).filter(vis) : [];
    const lastRight = Math.max.apply(null, kids.map((n) => Math.round(n.getBoundingClientRect().right)).concat([0]));
    const wide = Array.from(document.querySelectorAll('body *')).filter((n) => { const c = getComputedStyle(n); return /auto|scroll/.test(c.overflowX) && n.scrollWidth > n.clientWidth + 1 && n.clientWidth > 0 && vis(n); }).map((n) => (n.id || n.className || n.tagName).toString().slice(0, 30) + ' ' + (n.scrollWidth - n.clientWidth));
    return { lastRight, barRight: bar ? Math.round(bar.getBoundingClientRect().right) : 0, w: innerWidth, bar: bar ? bar.scrollWidth - bar.clientWidth : 0, doc: document.documentElement.scrollWidth - innerWidth, wide };
  });
}
const where = (page) => { const u = new URL(page.url()); return u.pathname + u.search + u.hash; };
async function seatSheet(page, seat) { const b = page.locator('[data-testid="nw-seat-' + seat + '"]'); if (await b.count()) await b.click(); }
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const base = await serve(), b = await chromium.launch();
  for (const [seat, key] of SEATS) for (const vp of [{ width: 1366, height: 768, tag: '1366' }, { width: 390, height: 844, tag: '390' }]) {
    const tag = seat + ' ' + vp.tag;
    const ctx = await b.newContext({ viewport: vp, locale: 'en-AU', timezoneId: 'Australia/Sydney', serviceWorkers: 'block', isMobile: vp.width < 500, hasTouch: vp.width < 500 });
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
    const page = await ctx.newPage();
    await page.goto(base + '/');
    await page.waitForSelector('[data-testid^="practice-row-"]', { timeout: 40000 });
    const rows = await page.$$eval('[data-testid^="practice-row-"]', (els) => els.map((e) => ({ id: e.getAttribute('data-testid').replace('practice-row-', ''), t: e.innerText })));
    const row = rows.find((r) => new RegExp(seat === 'auditor' ? 'Auditor' : 'Accountant', 'i').test(r.t)) || rows[0];
    const id = row.id, name = row.t.split('\n')[0].trim();
    console.log(tag + ' client ' + id + ' ' + name);
    await page.locator('[data-testid="practice-open-' + id + '"]').click();
    await pause(1500); await seatSheet(page, seat); await pause(3500);
    ok(tag + ': Open books lands on the client (the address names it)', where(page).indexOf('/network.html?open=' + id) === 0, where(page));
    ok(tag + ': the header names the client plainly, one press back to Clients', (await page.locator('[data-testid="shell-working"]').count()) === 1 && (await page.locator('[data-testid="shell-working"] b').innerText()).length > 0);
    ok(tag + ': the breadcrumb Clients > client > screen is on the client page', (await page.locator('[data-testid="ba-crumbs"]').count()) >= 1);
    { const f = await headerFit(page); ok(tag + ': client page header ends inside the screen (last control right ' + f.lastRight + ' of ' + f.w + ', bar overflow ' + f.bar + ')', f.lastRight <= f.w && f.bar <= 0 && f.doc <= 0, JSON.stringify(f)); }
    await page.screenshot({ path: OUT + '/nav-' + seat + '-1-client-' + vp.tag + '.png' });
    await page.locator('[data-testid="bv-tab-tb"]').click(); await pause(2500);
    ok(tag + ': a screen of the books is a history entry (view in the address)', /view=tb/.test(where(page)), where(page));
    if (seat === 'auditor') await page.locator('[data-testid="bv-bank"]').click();
    else await page.evaluate(() => { location.assign(CBBooksActing.addressOf(CBBooksActing.current().store)); });
    await page.waitForURL(/accounts\.html/, { timeout: 20000 }); await pause(5000);
    ok(tag + ': the client screen shows the crumbs and the client name in the header', (await page.locator('[data-testid="crumb-screen"]').count()) === 1 && (await page.locator('[data-testid="shell-working"]').count()) === 1, where(page));
    { const f = await headerFit(page); ok(tag + ': books screen header ends inside the screen (last control right ' + f.lastRight + ' of ' + f.w + ', bar overflow ' + f.bar + ') and no inner scroller pans sideways', f.lastRight <= f.w && f.bar <= 0 && f.doc <= 0 && f.wide.length === 0, JSON.stringify(f)); }
    await page.screenshot({ path: OUT + '/nav-' + seat + '-2-books-' + vp.tag + '.png' });
    await page.goBack(); await pause(4000);
    ok(tag + ': browser Back 1 -> the client Books (not the network list)', where(page).indexOf('/network.html?open=' + id) === 0 && /view=tb/.test(where(page)), where(page));
    await page.goBack(); await pause(3500);
    ok(tag + ': browser Back 2 -> the client Home', where(page).indexOf('/network.html?open=' + id) === 0 && !/view=/.test(where(page)) && (await page.locator('[data-testid="ba-crumbs"]').count()) >= 1, where(page));
    await page.goBack(); await pause(4500);
    ok(tag + ': browser Back 3 -> the practice list, last client marked', new URL(page.url()).pathname === '/' && (await page.locator('[data-testid="practice-last-chip"]').count()) >= 1, where(page));
    const focus = await page.evaluate(() => { const a = document.activeElement; return a && a.getAttribute && a.getAttribute('data-row'); });
    ok(tag + ': the marked row has keyboard focus', String(focus) === id, String(focus));
    ok(tag + ': the marked row is in view', await page.evaluate((i) => { const n = document.querySelector('[data-testid="practice-row-' + i + '"]'); if (!n) return false; const r = n.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight; }, id));
    await page.screenshot({ path: OUT + '/nav-' + seat + '-3-practice-' + vp.tag + '.png' });
    await page.goForward(); await pause(4000);
    ok(tag + ': Forward 1 -> the client Home', where(page).indexOf('/network.html?open=' + id) === 0, where(page));
    await page.goForward(); await pause(3000);
    ok(tag + ': Forward 2 -> the client Books', /view=tb/.test(where(page)), where(page));
    await page.goForward(); await pause(4500);
    ok(tag + ': Forward 3 -> the client screen again', where(page).indexOf('/accounts.html') === 0, where(page));
    await page.locator('[data-testid="ba-back"]').click(); await pause(4000);
    ok(tag + ': in-app back from the screen -> the client page', where(page).indexOf('/network.html?open=' + id) === 0, where(page));
    await page.locator('[data-testid="ba-back"], [data-testid="bv-back"]').first().click(); await pause(4500);
    ok(tag + ': in-app back from the client page -> the practice list', new URL(page.url()).pathname === '/' && (await page.locator('[data-testid^="practice-row-"]').count()) > 0, where(page));
    await ctx.close();
  }
  await b.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('WALK FAILED', e && e.stack || e); process.exit(1); });
