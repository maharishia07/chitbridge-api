/* till-dayimg.cjs — THE SHOP'S OWN PICTURE ACTUALLY GETS KEPT ([TILL-100])
 *
 * Athi: "start your day, i was trying to update the photo, it is not getting uploaded... the image is not
 * loading." The write went through ls.set(), which does NOT throw — it returns false — so the try/catch around
 * it was dead code and a refused picture vanished without a word.
 *
 * ⚠️ This uploads a REAL file through the REAL <input type=file>, because the bug lived in the path between
 * the file and the store, and no state probe touches that path.
 */
'use strict';
const { chromium } = require('@playwright/test');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', 'public');
const T = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json',
            '.svg':'image/svg+xml', '.png':'image/png', '.webmanifest':'application/manifest+json' };
let bad = 0;
const say = (l, ok, d) => { console.log(String(l).padEnd(12) + '· ' + d + '  ' + (ok ? 'OK' : (bad++, '✗ FAILED'))); };

/* ⚠️ A BIG one: the original bug only appeared on a picture large enough to be refused. 2000x1500 of noise
   is ~2MB as a PNG — comfortably past what localStorage would have taken as a data URL. */
function bigPng() {
  const { createCanvas } = (() => { try { return require('canvas'); } catch (_) { return {}; } })();
  if (!createCanvas) return null;
  const c = createCanvas(2000, 1500), x = c.getContext('2d');
  for (let i = 0; i < 4000; i++) {
    x.fillStyle = 'rgb(' + (i * 7 % 255) + ',' + (i * 13 % 255) + ',' + (i * 29 % 255) + ')';
    x.fillRect((i * 37) % 2000, (i * 53) % 1500, 40, 40);
  }
  return c.toBuffer('image/png');
}

(async () => {
  const srv = http.createServer((q, r) => {
    const rel = decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
    const f = path.join(ROOT, rel);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('no'); }
    r.writeHead(200, { 'content-type': T[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(r);
  });
  await new Promise(r => srv.listen(0, r));
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1500, height: 1000 } });
  const threw = []; p.on('pageerror', e => threw.push(e.message));
  await p.goto('http://127.0.0.1:' + srv.address().port + '/till.html');
  await p.waitForFunction(() => typeof window.dayImgPick === 'function', null, { timeout: 30000 });
  await p.evaluate(() => {
    window.S = { shop: { country: 'IN', name: 'Mayur Bhavan', currency: 'INR' }, items: [], offers: [], at: new Date().toISOString() };
    setMode('sell');
  });

  /* build the file in the page, so no extra dependency is needed to make a big picture */
  const made = await p.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 2400; c.height = 1800;
    const x = c.getContext('2d');
    for (let i = 0; i < 3000; i++) {
      x.fillStyle = 'rgb(' + (i * 7 % 255) + ',' + (i * 13 % 255) + ',' + (i * 29 % 255) + ')';
      x.fillRect((i * 37) % 2400, (i * 53) % 1800, 60, 60);
    }
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    window.__bytes = new Uint8Array(await blob.arrayBuffer());
    return { w: c.width, h: c.height, bytes: window.__bytes.length };
  });
  console.log('a picture   · ' + made.w + '×' + made.h + ' PNG, ' + Math.round(made.bytes / 1024) + ' KB');
  /* ⚠️⚠️ NO ASSERTION ON THE FIXTURE'S SIZE. The first cut demanded this synthetic picture exceed 1.5MB,
     which tested the TEST: flat colour blocks compress to almost nothing as PNG, and a real phone photograph
     is 3-8MB. What matters is not how big the input was but that the OUTPUT is bounded, which is asserted
     below. [[feedback-name-vs-behaviour]] */

  const file = path.join(require('os').tmpdir(), 'cb-day.png');
  fs.writeFileSync(file, Buffer.from(await p.evaluate(() => Array.from(window.__bytes))));

  await p.evaluate(() => { window.__toasts = []; const t = window.toastLine;
    window.toastLine = function (m) { window.__toasts.push(m); return t && t(m); }; });

  /* ⚠️ DRIVE THE REAL CONTROL: open the hub, the day section, and the + that asks for a file */
  await p.click('[data-testid="till-side-open"]');
  /**
   * ⚠️⚠️ ENSURE OPEN, DO NOT TOGGLE ([TILL-148]). This used to click the heading unconditionally. 'day' is
   * already the open section after the start-of-day panel, so the click CLOSED it — and the harness only
   * passed because .mbody set display and so drew a collapsed section anyway. With [hidden] finally winning,
   * the blind toggle became a real miss. The button states its own answer in aria-expanded; ask it.
   */
  if ((await p.getAttribute('[data-testid="till-msec-btn-day"]', 'aria-expanded')) !== 'true')
    await p.click('[data-testid="till-msec-btn-day"]');
  await p.waitForSelector('[data-testid="till-day-img-add"]', { timeout: 4000 });
  const chooser = p.waitForEvent('filechooser');
  await p.click('[data-testid="till-day-img-add"]');
  await (await chooser).setFiles(file);
  await p.waitForTimeout(1200);

  const kept = await p.evaluate(() => ({
    big: (ls.get(shopLs('cb_till_dayimg'), '') || '').length,
    icon: (ls.get(shopLs('cb_till_dayicon'), '') || '').length,
    shown: !!document.querySelector('[data-testid="till-day-img"] img'),
    toasts: window.__toasts.slice(-2),
  }));
  /* ⭐ THE POINT OF THE RESIZE: whatever came in, what is KEPT fits in a store shared with everything else
     this counter holds. 1280px of JPEG is a few hundred KB at worst. */
  say('kept', kept.big > 1000 && kept.big < 700000,
    'the picture is ' + Math.round(kept.big / 1024) + ' KB stored, bounded under 700 KB');
  say('an icon', kept.icon > 200 && kept.icon < 40000, 'the icon is ' + Math.round(kept.icon / 1024) + ' KB — what the panel draws');
  say('on screen', kept.shown, 'the morning panel draws it');
  /* ⚠️⚠️ AND IT SAID SO — the original fault was total silence */
  say('it spoke', kept.toasts.some((m) => /saved/i.test(m)), '"' + (kept.toasts[kept.toasts.length - 1] || '(nothing)') + '"');

  /* the popup Athi asked for */
  await p.click('[data-testid="till-day-img"]');
  await p.waitForTimeout(250);
  say('popup', await p.evaluate(() => !!document.querySelector('#dayimgdlg[open] img')), 'pressing the icon opens it big');
  await p.evaluate(() => dayImgClose());

  /* ⚠️ AND A REFUSED WRITE MUST SAY SO. Fill the store, then try again. */
  await p.evaluate(() => { window.__toasts = []; ls.set = function () { ls.last = { why: 'refused' }; return false; }; });
  const ch2 = p.waitForEvent('filechooser');
  await p.click('[data-testid="till-day-img-change"]');
  await (await ch2).setFiles(file);
  await p.waitForTimeout(1200);
  const said = await p.evaluate(() => window.__toasts.slice(-1)[0] || '');
  say('refusal', /would not keep/i.test(said), '"' + said + '"');

  if (threw.length) console.log('⚠️ threw: ' + threw.slice(0, 3).join(' | '));
  console.log(bad ? ('\n' + bad + ' FAILED') : '\nthe picture is resized, kept, shown — and a refusal is said out loud');
  await b.close(); srv.close(); process.exit(bad ? 1 : 0);
})();
