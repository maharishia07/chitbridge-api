'use strict';
/* e2e/dues-aged-live.cjs — W21 proof on a SIT box: a firm seat (default aud1@seedefirmau) opens a client's "Who owes whom" (network.html?open=<id>&view=dues) and reads the AGED table
 * in the firm's voice: "Customers owe <client>" · "<client> owes suppliers", the buckets Current · 1–30 · 31–60 · 61–90 · 90+ · Total, a total row, no sideways scroll at 1366 and 390.
 * env: API (api base, never production), WEB (tree with public/), CODE (the tester code, from the box env, never written to a file), USER_NAME, OUT. Read only: sign-in and reads. */
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const API = process.env.API || 'http://127.0.0.1:3994', OUT = process.env.OUT || '/out', USER = process.env.USER_NAME || 'aud1@seedefirmau', CODE = process.env.CODE;
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
  const R = await call('POST', '/api/actors/login', { username: USER, otp: CODE });
  if (!R.token) throw new Error('sign-in failed for ' + USER);
  const sess = { token: R.token, role: R.role || 'actor', name: R.name || USER, entity: R.entity, bridgeId: R.bridgeId, duty: R.duty };
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
    await ctx.route('http://localhost:3000/**', async (r) => { /* the page's default api base is answered by the same proxy */
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
    let duesApi = null; /* the api's own answer to the page's dues read: the proof of which side has rows (acc17b dues-zero-party: the server drops a party with nothing open) */
    page.on('response', (r) => { if (r.url().includes('/api/books/dues') && r.status() === 200) r.json().then((j) => { duesApi = j; }).catch(() => {}); });
    await page.goto(base + '/');
    await page.waitForSelector('[data-testid^="practice-row-"]', { timeout: 40000 }).catch(async (e) => { await page.screenshot({ path: OUT + '/fail-home.png' }); console.log('home text: ' + (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ').slice(0, 300)); throw e; });
    const rows = await page.$$eval('[data-testid^="practice-row-"]', (els) => els.map((e) => ({ id: e.getAttribute('data-testid').replace('practice-row-', ''), t: e.innerText })));
    const row = rows[0], id = row.id, name = row.t.split('\n')[0].replace(/^[^A-Za-z0-9]+/, '').trim(); /* the row's "last opened" mark is not part of the name */
    await page.goto(base + '/network.html?open=' + encodeURIComponent(id) + '&view=dues');
    await pause(2500);
    const seat = page.locator('[data-testid="nw-seat-auditor"]'); if (await seat.count()) await seat.click(); /* a firm holding two kinds of access picks the auditor seat */
    await pause(3500);
    await page.locator('[data-testid="bv-tab-dues"]').click().catch(() => {});
    await page.waitForSelector('[data-testid="bv-dues-customers"]', { timeout: 40000 }).catch(() => {});
    await pause(3500);
    const tag = vp.tag + ' ' + name + ': ';
    const head = (s) => page.locator('[data-testid="' + s + '"]').innerText().catch(() => '');
    const hc = (await head('bv-dues-customers-head')).trim(), hs = (await head('bv-dues-suppliers-head')).trim();
    console.log(tag + 'headings "' + hc + '" | "' + hs + '"');
    ok(tag + 'heading "Customers owe ' + name + '"', hc === 'Customers owe ' + name, hc);
    ok(tag + 'heading "' + name + ' owes suppliers"', hs === name + ' owes suppliers', hs);
    const body = (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
    ok(tag + 'no owner wording on the firm page', !/Customers owe you|You owe suppliers/.test(body));
    const c = (await page.locator('[data-testid="bv-dues-customers"]').innerText().catch(() => '')).replace(/\s+/g, ' ');
    console.log(tag + 'customers table: ' + c.slice(0, 500));
    const custRows = duesApi ? (duesApi.parties || []).filter((p) => p.side === 'customer' && Number(p.balance_minor) !== 0).length : -1;
    ok(tag + 'the api answered the dues read (' + custRows + ' customers with a balance)', custRows >= 0, 'no /api/books/dues answer seen');
    if (custRows === 0) { /* a side with no one owing says so in a sentence: no columns, no lone Total row */
      ok(tag + 'empty customers side says "Nobody owes ' + name + '"', c === 'Nobody owes ' + name, c);
      ok(tag + 'no Total row on an empty side', !/Total/.test(c));
    } else {
    ok(tag + 'columns Current · 1–30 · 31–60 · 61–90 · 90+ · Total', vp.width < 500 || ['current', '1–30', '31–60', '61–90', '90+', 'total'].every((x) => c.toLowerCase().includes(x)), c.slice(0, 200));
    if (vp.width < 500) console.log(tag + 'first card: ' + (await page.locator('[data-testid="bv-row-0"]').first().innerHTML().catch(() => '')).replace(/<[^>]+>/g, '|').replace(/[|]+/g, "|").slice(0, 400));
    ok(tag + 'a Total row', /Total/.test(c));
    }
    const over = await page.evaluate(() => {
      const d = document.documentElement;
      const wide = Array.from(document.querySelectorAll('body *')).filter((n) => { const s = getComputedStyle(n); return /auto|scroll/.test(s.overflowX) && n.scrollWidth > n.clientWidth + 1 && n.clientWidth > 0 && n.getClientRects().length; }).map((n) => (n.id || n.className || n.tagName).toString().slice(0, 40));
      return { doc: d.scrollWidth - d.clientWidth, wide };
    });
    ok(tag + 'no sideways scroll (doc ' + over.doc + ', inner ' + over.wide.join(',') + ')', over.doc <= 0 && over.wide.length === 0);
    ok(tag + 'no page error', threw.length === 0, threw.join(';'));
    await page.screenshot({ path: OUT + '/dues-aged-' + vp.tag + '.png', fullPage: true });
    await ctx.close();
  }
  await b.close(); srv.close();
  console.log('\n' + (fail ? 'FAIL' : 'all ok') + ': ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
