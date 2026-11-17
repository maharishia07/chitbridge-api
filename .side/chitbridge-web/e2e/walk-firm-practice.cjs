'use strict';
/**
 * e2e/walk-firm-practice.cjs — l16/firm-dash: the firm's first screen (Practice band + client list on Home) against a REAL api on a SIT box's throwaway copy database (never production).
 * env: API (http://127.0.0.1:3997), OUT (shots folder; token-<firm>.json from the box), FIRMS (comma list, default coastal,bayside).
 * Checks per firm at 1366 and 390: the band and the rule are drawn; the list has the clients; the shop cards (Till, Marketing, Online shop) are absent; every band tile's count equals the rows its filter leaves;
 * status and action are never dropped at 390 (no field dropped, R74); no horizontal scroll; Open books is on every row. Shots go to OUT.
 * l16 firmhome (Fable round 2 R2-1): ONE load of the firm Home makes at most firm_home_calls_max /api calls (e2e/firm-home-calls.budget.json), counted here at both sizes and listed on a miss.
 */
const { chromium } = require('@playwright/test');
const http = require('http'), fs = require('fs'), path = require('path');
const API = process.env.API || 'http://127.0.0.1:3997', OUT = process.env.OUT || '/out';
if (/railway|vercel/i.test(API)) throw new Error('STOP: production is never a target');
const PUB = path.join(__dirname, '..', 'public');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
const BUDGET = JSON.parse(fs.readFileSync(path.join(__dirname, 'firm-home-calls.budget.json'), 'utf8')).firm_home_calls_max;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (what, cond, info) => { if (cond) { pass++; console.log('  ok   ' + what); } else { fail++; console.log('  FAIL ' + what + (info ? ' :: ' + String(info).slice(0, 300) : '')); } };
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
    const home = url === '/' || url === '/index.html'; /* Home is the repo-root index.html, as it deploys */
    const rel = decodeURIComponent(url).replace(/^[/]+/, ''), f = home ? path.join(PUB, '..', 'index.html') : path.join(PUB, rel);
    if ((!home && !f.startsWith(PUB)) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('no'); }
    r.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(r);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return { srv, base: 'http://127.0.0.1:' + srv.address().port };
}
async function open(browser, base, tok, vp, startUrl, early) {
  const ctx = await browser.newContext({ viewport: vp, locale: 'en-AU', timezoneId: 'Australia/Sydney', serviceWorkers: 'block' });
  await ctx.addInitScript((s) => { try { if (!localStorage.getItem('cb_seeded')) { localStorage.setItem('cb_seeded', '1'); localStorage.setItem('cb_sess', JSON.stringify(s)); } } catch (_) {} }, { token: tok.token, role: 'entity', name: tok.name });
  await ctx.route('http://localhost:3000/**', async (r) => {
    const cors = { 'access-control-allow-origin': base, 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': '*' };
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors });
    if (r.request().url().includes('/events/stream')) return r.abort();
    const u = new URL(r.request().url()), hs = Object.assign({}, r.request().headers());
    delete hs.origin; delete hs.referer;
    const got = await r.fetch({ url: API + u.pathname + u.search, headers: hs });
    return r.fulfill({ response: got, headers: Object.assign({}, got.headers(), cors) });
  });
  const page = await ctx.newPage();
  page.__threw = [];
  page.__calls = [];
  page.on('request', (r) => { const u = r.url(); if (u.includes('/api/') && !u.includes('/api/events/stream')) page.__calls.push(r.method() + ' ' + u.replace(/^https?:[/][/][^/]+/, '').slice(0, 90)); });
  page.on('pageerror', (e) => page.__threw.push(e.message));
  await page.goto(base + startUrl, early ? { waitUntil: 'commit' } : undefined);
  return { ctx, page };
}
const rowCount = (page) => page.evaluate(() => document.querySelectorAll('[data-testid="practice-list"] [data-testid^="practice-row-"]').length);
/* what a firm must never see, read from the page: a shop area in the rail or the phone bar, a shop section, the two side buttons, the Your work strip */
const shopSeen = (page) => page.evaluate(() => {
  const vis = (n) => n.getClientRects().length > 0 && getComputedStyle(n).display !== 'none' && getComputedStyle(n).visibility !== 'hidden';
  const out = [];
  ['selling', 'money', 'running', 'trade', 'labs'].forEach((id) => { if (Array.from(document.querySelectorAll('.cbsh-nv[data-go="' + id + '"]')).some(vis)) out.push('nav-' + id); });
  Array.from(document.querySelectorAll('[data-testid^="shell-area-"]')).forEach((n) => { const a = n.getAttribute('data-area'); if (a && a !== 'home' && a !== 'setup' && vis(n)) out.push('section-' + a); });
  if (Array.from(document.querySelectorAll('[data-testid="shell-sidetools"] button, .cbsh-side')).some(vis)) out.push('sides');
  if (Array.from(document.querySelectorAll('[data-testid="rail"], #railbox *')).some(vis)) out.push('your-work');
  return out;
});
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const { base } = await serve();
  const b = await chromium.launch();
  for (const firm of (process.env.FIRMS || 'coastal,bayside').split(',')) {
    const tok = JSON.parse(fs.readFileSync(path.join(OUT, 'token-' + firm + '.json'), 'utf8'));
    const truth = await (await fetch(API + '/api/books-grants/practice', { headers: { authorization: 'Bearer ' + tok.token } })).json();
    for (const vp of [{ width: 1366, height: 768, tag: '1366' }, { width: 390, height: 844, tag: '390' }]) {
      const { ctx, page } = await open(b, base, tok, vp, '/');
      await page.waitForSelector('[data-testid="practice-band"]', { timeout: 30000 }).catch(() => {});
      await page.waitForSelector('[data-testid^="practice-row-"]', { timeout: 20000 }).catch(() => {});
      await pause(4000);
      const tag = firm + ' ' + vp.tag;
      const load = page.__calls.slice(); /* the calls of the one Home load, before any tile is pressed or the page scrolled */
      console.log(tag + ' api calls in one Home load: ' + load.length + ' (budget ' + BUDGET + ')');
      ok(tag + ' one Home load makes at most ' + BUDGET + ' api calls', load.length <= BUDGET, load.length + ': ' + load.join(' | '));
      ok(tag + ' the Practice band is drawn, in the band the server opened first (' + truth.band.bands[0].key + ')', (await page.locator('[data-testid="practice-band"]').count()) === 1 && (await page.locator('[data-testid="practice-band"]').getAttribute('data-band')) === truth.band.bands[0].key);
      const tiles = await page.locator('[data-testid^="practice-tile-"]').count();
      const counts = await page.$$eval('[data-testid^="practice-tile-"] b', (els) => els.map((el) => Number(el.textContent)));
      const serverTiles = truth.band.bands[0].tiles.map((t) => t.n);
      ok(tag + ' the first band draws exactly the server tiles (at most six) with the server counts: ' + counts.join(','), tiles <= 6 && JSON.stringify(counts) === JSON.stringify(serverTiles), tiles);
      const shown = await rowCount(page);
      ok(tag + ' the client list shows rows (up to 50 at a time of ' + truth.clients.length + ')', shown > 0 && shown <= Math.min(50, truth.clients.length) + 1, shown);
      const cards = await page.evaluate(() => ['till', 'marketing', 'storefront'].map((id) => document.querySelectorAll('[data-testid="shell-card-' + id + '"]').length));
      ok(tag + ' the shop cards (Till, Marketing, Online shop) are hidden on a firm Home', cards.every((n) => n === 0), JSON.stringify(cards));
      /* l16 n12: a firm with no trade of its own sees no shop areas: no Selling/Money/Running/Trade/Labs in the rail or the phone bar, no We lean on / Leans on us buttons, no Your work strip (CBPractice.hidesShopCards, the one rule) */
      const shopy = await page.evaluate(() => {
        const vis = (n) => n.getClientRects().length > 0 && getComputedStyle(n).display !== 'none' && getComputedStyle(n).visibility !== 'hidden';
        return {
          nav: ['selling', 'money', 'running', 'trade', 'labs'].filter((id) => Array.from(document.querySelectorAll('.cbsh-nv[data-go="' + id + '"]')).some(vis)),
          sections: Array.from(document.querySelectorAll('[data-testid^="shell-area-"]')).map((n) => n.getAttribute('data-area')).filter((a) => a && a !== 'home' && a !== 'setup'),
          sides: Array.from(document.querySelectorAll('[data-testid="shell-sidetools"] button, .cbsh-side')).filter(vis).length,
          work: Array.from(document.querySelectorAll('[data-testid="rail"], #railbox *')).filter(vis).length
        };
      });
      ok(tag + ' no shop area in the rail / phone bar, none drawn on Home, no side panels, no Your work strip: ' + JSON.stringify(shopy), !shopy.nav.length && !shopy.sections.length && !shopy.sides && !shopy.work, JSON.stringify(shopy));
      ok(tag + ' no horizontal scroll', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), await page.evaluate(() => document.documentElement.scrollWidth + ' > ' + window.innerWidth));
      /* no heading wraps letter by letter: every column heading stays within two lines and no word of it is cut */
      const cut = await page.evaluate(() => {
        const out = [];
        document.querySelectorAll('[data-testid="practice-list"] .cbl-hdr').forEach((hdr) => {
          const walker = document.createTreeWalker(hdr, NodeFilter.SHOW_TEXT);
          for (let n = walker.nextNode(); n; n = walker.nextNode()) {
            const re = /\S+/g;
            let m;
            while ((m = re.exec(n.nodeValue))) {
              const r = document.createRange();
              r.setStart(n, m.index);
              r.setEnd(n, m.index + m[0].length);
              if (m[0].length > 2 && new Set([...r.getClientRects()].map((q) => Math.round(q.top))).size > 1) out.push(m[0]);
            }
          }
        });
        return out;
      });
      if (vp.tag === '1366') ok(tag + ' no heading is cut mid-word (a word of a heading sitting on two lines)', cut.length === 0, JSON.stringify(cut));
      if (vp.tag === '1366') { const st = await page.evaluate(() => { const c = [...document.querySelectorAll('[data-testid="practice-list"] .cbl-hdr > *')].find((x) => /^status/i.test(x.innerText.trim())); if (!c) return null; const w = document.createTreeWalker(c, NodeFilter.SHOW_TEXT); let n = w.nextNode(); while (n && !n.nodeValue.trim()) n = w.nextNode(); const r = document.createRange(); r.selectNodeContents(n); return { w: Math.round(c.getBoundingClientRect().width), lines: new Set([...r.getClientRects()].map((q) => Math.round(q.top))).size }; }); ok(tag + ' the Status header (minw 130) is one line and at least 130 px wide', !!st && st.lines === 1 && st.w >= 130, JSON.stringify(st)); }
      const inline = await page.evaluate(() => { const r = document.querySelector('[data-testid^="practice-row-"]'); return r ? r.innerText.replace(/\s+/g, ' ').slice(0, 400) : ''; });
      console.log(tag + ' first row: ' + inline);
      ok(tag + ' status and Open books are in the first row (never dropped)', /Needs help|Watch|Doing well|Not enough/.test(inline) && /Open books/.test(inline), inline);
      await page.screenshot({ path: path.join(OUT, firm + '-home-' + vp.tag + '.png') });
      await page.evaluate(() => { const m = document.querySelector('.cbsh-main'); const l = document.getElementById('bp_list'); if (m && l) m.scrollTop = l.offsetTop - 60; });
      await pause(800);
      await page.screenshot({ path: path.join(OUT, firm + '-list-' + vp.tag + '.png') });
      ok(tag + ' the practice section replaced the Your clients card', (await page.locator('[data-testid="home-your-clients"]').count()) === 0);
      /* a band tile is a filter: its count equals the rows it leaves (when the rows fit one page) */
      if (vp.tag === '1366') {
        for (const key of truth.band.bands[0].tiles.map((t) => t.key)) {
          const tile = page.locator('[data-testid="practice-tile-' + key + '"]');
          if (!(await tile.count())) continue;
          const asked = Number((await tile.locator('b').innerText()).trim());
          await tile.click();
          await pause(1500);
          const left = await rowCount(page);
          ok(tag + ' tile ' + key + ' says ' + asked + ' and the list it opens has ' + (asked > 50 ? '50 (first page) of ' + asked : left), asked > 50 ? left >= 50 : left === asked, left);
          if (key === 'complete') await page.screenshot({ path: path.join(OUT, firm + '-home-needs-help-' + vp.tag + '.png') });
          await page.locator('[data-testid="practice-clear"]').click().catch(() => {});
          await pause(800);
        }
        const open = page.locator('[data-testid^="practice-open-"]').first();
        if (await open.count()) {
          await open.click();
          await page.waitForURL(/network\.html\?open=/, { timeout: 15000 }).catch(() => {});
          await pause(6000);
          const text = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 300));
          ok(tag + ' Open books leads to that client\'s books page', /network\.html\?open=/.test(page.url()), page.url());
          console.log(tag + ' after Open books: ' + text);
          await page.screenshot({ path: path.join(OUT, firm + '-open-books-' + vp.tag + '.png') });
        }
      }
      /* l16 n12: no flash — a fresh load of the firm Home sampled every 0.4 s from the first byte: no shop area, side button or Your work strip at ANY sample */
      {
        const f = await open(b, base, tok, vp, '/', true), seen = [];
        for (let n = 0; n < 15; n++) { seen.push(await shopSeen(f.page).catch(() => ['(page busy)'])); await pause(400); }
        const bad = seen.map((x, n) => (x.length ? n * 0.4 + 's:' + x.join('+') : '')).filter(Boolean);
        ok(tag + ' no flash of shop areas in 15 samples at 0.4 s', bad.length === 0, bad.join(' | '));
        await f.ctx.close();
      }
      if (page.__threw.length) console.log(tag + ' page errors: ' + JSON.stringify(page.__threw.slice(0, 4)));
      await ctx.close();
    }
  }
  await b.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('WALK FAILED', e && e.stack || e); process.exit(1); });
