/* till-maint-shot.cjs — DOES THE MAINTENANCE SCREEN LOOK LIKE png/MaintV2.png? (2026-09-18)
 *
 * ⚠️⚠️ THIS EXISTS BECAUSE I BUILT THREE SCREENS FROM PROSE WITH THE RENDERS SITTING ON DISK, and Athi had to
 * send them back twice. The guards prove the wiring; nothing proved the LOOK, so "it passes" and "it resembles
 * the drawing" were unrelated facts. [[feedback-open-the-render-first]]
 *
 * It seeds a shop shaped like the one in the render — the same products, the same faults, the same two ticked
 * rows — so the screenshot can be put beside design-handoff/png/MaintV2.png and read as a comparison rather
 * than as a picture of whatever data happened to be around.
 *
 * Run: node e2e/till-maint-shot.cjs            (serves ./public itself, no deploy needed)
 */
'use strict';
const { chromium } = require('@playwright/test');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'public');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
                '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

/* ⚠️ the render's own shelf, faults and all — that is what makes the two pictures comparable */
const ITEMS = [
  { item_id: 'i1',  name: 'Idli (2 pc)',      code: 'TIF-0101', category: 'Tiffin', unit: 'plate', price: 40 },
  { item_id: 'i2',  name: 'Ghee Podi Idli',   code: 'TIF-0102', category: 'Tiffin', unit: 'plate', price: 70 },
  { item_id: 'i3',  name: 'Sambar Idli',      code: 'TIF-0104', category: 'Tiffin', unit: 'plate', price: 66 },
  { item_id: 'i4',  name: 'Rava Idli',        code: 'TIF-0105', category: 'Tiffin', unit: 'plate', price: 60 },
  { item_id: 'i5',  name: 'Kanchipuram Idli', code: 'TIF-0106', category: 'Tiffin', unit: 'plate', price: 65 },
  { item_id: 'i6',  name: 'Plain Dosa',       code: 'TIF-0110', category: 'Tiffin', unit: 'plate', price: 55 },
  { item_id: 'i7',  name: 'Masala Dosa',      code: 'TIF-0111', category: 'Tiffin', unit: 'plate', price: 70 },
  { item_id: 'i8',  name: 'Mysore Bonda',     code: 'SNK-0203', category: 'Snacks', unit: 'plate', price: 0 },
  { item_id: 'i9',  name: 'Kesari Bath',      code: 'TIF-0120', category: 'Tiffin', unit: 'plate', price: 35,
    status: 'unavailable' },
  { item_id: 'i10', name: 'Ghee Roast',       code: 'TIF-0113', category: 'Tiffin', unit: 'plate', price: 95 },
];

(async () => {
  const srv = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
    const file = path.join(ROOT, rel);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('no'); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((r) => srv.listen(0, r));
  const base = 'http://127.0.0.1:' + srv.address().port;

  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
  const threw = [];
  p.on('pageerror', (e) => threw.push(e.message));
  await p.goto(base + '/till.html');
  await p.waitForFunction(() => typeof window.setMode === 'function' && !!window.CBSearch, null, { timeout: 30000 });

  const out = await p.evaluate((items) => {
    window.S = { shop: { country: 'IN', name: 'Mayur Bhavan' }, items: items, offers: [], at: new Date().toISOString() };
    /* the groups the render names, so "Not on any key" has something to be true against */
    try {
      const o = tillOpt();
      o.groups = { Morning: ['i1','i2','i3','i4','i6','i7','i9','i10'], Afternoon: ['i1','i6'],
                   Evening: ['i2','i7'], Night: ['i10'] };
      tillOptSet({ groups: o.groups, group: 'Morning' });
    } catch (e) { /* no key on this bare page — the badge simply will not draw */ }
    /* the morning's work, so "Changed today" is true of the row the render marks */
    CHANGED = { price: [{ item_id: 'i7', name: 'Masala Dosa', was: 65, now: 70 }], stock: [] };
    setMode('maintain');
    CARD_ID = 'i3';
    PICKED_IDS = ['i5', 'i8'];
    paintHits(); paintCard(); paintChips();
    const bar = document.querySelector('[data-testid="till-pickbar"]');
    return {
      badges: Array.from(document.querySelectorAll('.rbadge')).map((x) => x.textContent),
      shelf: (document.querySelector('[data-testid="till-shelf-count"]') || {}).innerText || '',
      bar: bar ? bar.innerText.replace(/\s+/g, ' ') : '(no bar)',
      chips: Array.from(document.querySelectorAll('#chips button, .chips button')).map((x) => x.innerText.replace(/\s+/g, ' ')),
      card: (document.getElementById("cardbox") || {}).innerText || '',
    };
  }, ITEMS);

  console.log('badges · ' + out.badges.join(' | '));
  console.log('shelf  · ' + out.shelf.replace(/\s+/g, ' '));
  console.log('bar    · ' + out.bar);
  console.log('chips  · ' + out.chips.join(' / '));
  console.log('card   · ' + out.card.replace(/\s+/g, ' ').slice(0, 240));

  const shot = path.join(__dirname, 'shots', 'maint-v2.png');
  fs.mkdirSync(path.dirname(shot), { recursive: true });
  await p.screenshot({ path: shot, fullPage: false });
  console.log('wrote ' + shot);

  /* ⭐⭐ AND THE PHONE, which png/MaintV2Phone.png draws as a bottom sheet over the list. A separate page,
     because the shape is decided when the page boots. */
  const ph = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  ph.on('pageerror', (e) => threw.push('phone: ' + e.message));
  await ph.goto(base + '/till.html');
  await ph.waitForFunction(() => typeof window.setMode === 'function' && !!window.CBSearch, null, { timeout: 30000 });
  const pout = await ph.evaluate((items) => {
    window.S = { shop: { country: 'IN', name: 'Mayur Bhavan' }, items: items, offers: [], at: new Date().toISOString() };
    CHANGED = { price: [], stock: [] };
    setMode('maintain');
    CARD_ID = 'i3';
    paintHits(); paintCard(); paintChips();
    const r = document.querySelector('.right').getBoundingClientRect();
    return { body: document.body.className,
             sheetTop: Math.round(r.top), sheetH: Math.round(r.height),
             closeSeen: !!document.querySelector('[data-testid="card-close"]')
               && getComputedStyle(document.querySelector('[data-testid="card-close"]')).display !== 'none' };
  }, ITEMS);
  /* ⚠️ THE SHEET SLIDES. Measuring or screenshotting straight after paintCard() catches it mid-transition
     — transform read translateY(740px) and the sheet looked broken when it was simply still moving. */
  await ph.waitForFunction(() => {
    const r = document.querySelector('.right');
    return r && getComputedStyle(r).transform === 'matrix(1, 0, 0, 1, 0, 0)';
  }, null, { timeout: 4000 });
  const pgeo = await ph.evaluate(() => {
    const r = document.querySelector('.right').getBoundingClientRect();
    return { top: Math.round(r.top), h: Math.round(r.height) };
  });
  pout.sheetTop = pgeo.top; pout.sheetH = pgeo.h;
  console.log('phone  · body="' + pout.body + '" sheet top=' + pout.sheetTop + ' h=' + pout.sheetH + ' close=' + pout.closeSeen);
  const pshot = path.join(__dirname, 'shots', 'maint-v2-phone.png');
  await ph.screenshot({ path: pshot, fullPage: false });
  console.log('wrote ' + pshot);

  if (threw.length) { console.log('THREW · ' + threw.join(' | ')); process.exitCode = 1; }
  await b.close();
  srv.close();
})();
