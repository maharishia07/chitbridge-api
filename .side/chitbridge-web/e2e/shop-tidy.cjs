/* shop-tidy.cjs — the online shop (public/shop.html) as a customer sees it, on a recorded catalogue (no live API).
 * Round S-tidy 2026-10-09 (S4 S7 S8 S11 S13 S16 S17): categories as headings + a jump bar · no admin words ·
 * no empty side box · "1 unit" · one colour · one footer line · no sideways scroll at 390 and 1366.
 * Run: sh C:/dev/toolset/e2e.sh <checkout> e2e/shop-tidy.cjs      (SHOT=before|after names the screenshots)
 */
'use strict';
const { chromium } = require('@playwright/test');
const http = require('http'), fs = require('fs'), path = require('path');
const PUB = path.join(__dirname, '..', 'public');
const FIX = fs.readFileSync(path.join(__dirname, 'fixtures', 'shop-catalogue.json'), 'utf8');
const SHOT = process.env.SHOT || 'after';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg' };
const PIC = '<svg xmlns="http://www.w3.org/2000/svg" width="500" height="375"><rect width="500" height="375" fill="#c9a66b"/></svg>';
let fails = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fails++; };

(async () => {
  const srv = http.createServer((q, r) => {
    let p = decodeURIComponent(q.url.split('?')[0]); if (p === '/') p = '/shop.html';
    const f = path.join(PUB, p);
    if (!f.startsWith(PUB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); }
    r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r);
  }).listen(0);
  const base = 'http://127.0.0.1:' + srv.address().port;
  const browser = await chromium.launch();
  for (const [w, h] of [[390, 844], [1366, 800]]) {
    console.log('── ' + w + 'px');
    const ctx = await browser.newContext({ viewport: { width: w, height: h } });
    const page = await ctx.newPage();
    const errs = []; page.on('pageerror', (e) => errs.push(e.message));
    await page.route(/upload\.wikimedia\.org|fonts\.(googleapis|gstatic)|cdnjs\.cloudflare/, (rt) => /wikimedia/.test(rt.request().url())
      ? rt.fulfill({ status: 200, contentType: 'image/svg+xml', body: PIC }) : rt.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    await page.route(/\/api\/catalogue\/CBXK3RPTTR(\?.*)?$/, (rt) => rt.fulfill({ status: 200, contentType: 'application/json', body: FIX }));
    await page.route(/\/api\/(assist|integrations)\//, (rt) => rt.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
    await page.goto(base + '/shop.html?s=CBXK3RPTTR', { waitUntil: 'load' });
    await page.waitForSelector('[data-testid^="cbcat-"]', { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(2500);
    await page.screenshot({ path: path.join(__dirname, 'shots', 'shop-tidy', SHOT + '-' + w + '.png') });
    const body = await page.evaluate(() => document.body.innerText);
    ok(!errs.length, 'no page errors ' + errs.join(' | ').slice(0, 200));
    ok(!/\b1 pictures?\b|\bpictures?\b/i.test(body), 'no "picture" admin word');
    ok((body.match(/shop sets prices/gi) || []).length === 1, 'footer says "shop sets prices" once (copy budget, 14 Nov)');
    const secs = await page.locator('[data-testid="shop-cat-head"]').allInnerTexts();
    ok(secs.length >= 3 && /tiffin/i.test(secs.join()) && /rice/i.test(secs.join()), 'categories render as headings: ' + secs.map((s) => s.replace(/\s+/g, ' ')).join(' | ').slice(0, 120));
    await page.locator('[data-testid="shop-cat-btn"]').click().catch(() => {});   /* the categories are an overlay panel — open it */
    const chips = await page.locator('[data-testid="shop-cat-jump"]').count();
    ok(chips >= 3, 'a jump bar with a chip per category (' + chips + ')');
    if (chips >= 3) {
      await page.locator('[data-testid="shop-cat-jump"]', { hasText: /rice/i }).first().click(); await page.waitForTimeout(500);
      const top = await page.locator('[data-testid="shop-cat-head"]', { hasText: /rice/i }).first().evaluate((e) => e.getBoundingClientRect().top);
      ok(top >= -2 && top < 300, 'a chip jumps to its heading (top=' + Math.round(top) + ')');
    }
    /* the shared row: thumbnail beside the text, no empty grey box; a row with no photo shows a placeholder tile */
    const g = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('.cbcat-row')].filter((r) => r.offsetParent);
      const bad = rows.filter((r) => { const t = r.querySelector('.cbcat-thumb'); if (!t) return false; const b = t.getBoundingClientRect(); return b.width > 140 || b.width < 20 || (t.classList.contains('cbcat-skel') && !t.querySelector('img') && !t.querySelector('.cbcat-tile')); });
      const big = [...document.querySelectorAll('[data-testid="prod-media"], [data-testid="prod-media-cover"]')].length;
      const empty = rows.filter((r) => { const t = r.querySelector('.cbcat-thumb.cbcat-skel'); if (!t) return false; const b = t.getBoundingClientRect(); return b.top < innerHeight && b.bottom > 0; }).length;
      return { rows: rows.length, empty, bad: bad.length, gallery: big, sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth };
    });
    ok(g.rows > 5 && g.bad === 0, 'rows have a tidy thumb (rows ' + g.rows + ', bad ' + g.bad + ')');
    ok(g.empty === 0, 'no empty grey thumb box on screen (' + g.empty + ')');
    ok(g.gallery === 0, 'no full-width gallery inside the list rows (' + g.gallery + ')');
    ok(g.sw <= g.cw + 1, 'no sideways scroll (' + g.sw + ' vs ' + g.cw + ')');
    /* add one and open the basket */
    await page.locator('[data-testid^="cbcat-plus"], .cbcat-plus, button:has-text("+")').first().click().catch(() => {});
    await page.waitForTimeout(500);
    const colours = await page.evaluate(() => {
      const css = getComputedStyle(document.documentElement);
      return { accent: css.getPropertyValue('--accent').trim() };
    });
    const cartOpts = await page.evaluate(() => (typeof _CART !== 'undefined' && _CART && _CART.state().opts) || {});
    ok(!cartOpts.accent || cartOpts.accent.toLowerCase() === (await page.evaluate(() => { const l = document.querySelector('.logo'); return l ? getComputedStyle(l).backgroundColor : ''; })) || /^var\(/.test(cartOpts.accent) || cartOpts.accent !== '#c0392b', 'basket accent is not the old red (' + cartOpts.accent + ')');
    await page.locator('[data-testid^="cart-cbcart"]').first().click().catch(() => {});
    await page.waitForTimeout(500);
    const pop = await page.evaluate(() => document.body.innerText);
    ok(/\b1 units?\b/.test(pop) && !/\b1 units\b/.test(pop), '"1 unit" singular in the basket');
    await page.screenshot({ path: path.join(__dirname, 'shots', 'shop-tidy', SHOT + '-' + w + '-basket.png') });
    const g2 = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
    ok(g2, 'no sideways scroll with the basket open');
    await ctx.close();
  }
  await browser.close(); srv.close();
  console.log(fails ? '\n✗ ' + fails + ' check(s) failed' : '\n✓ all shop-tidy checks passed');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
