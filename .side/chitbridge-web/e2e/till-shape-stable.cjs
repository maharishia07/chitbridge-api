/* till-shape-stable.cjs — STABLE ACROSS A TURN, NOT ACROSS A MOVE (design-handoff/06-card-shape §6,
 * Phase 4.8 — HANDOVER's own risk: "columns may change on a turn; shape and size must not")
 *
 * ⚠️⚠️⚠️ THE SCENARIO THE RISK NAMES: a counter set to Automatic gets turned to show a customer something —
 * card-shape §6 rule 7 says "prices stay, tapping adds" while that happens. Before this phase, keyShapeAuto()/
 * keySizeAuto()/cardSizeAuto() read window.innerWidth/innerHeight fresh on every call, so the very next
 * repaint after a turn (the customer tapping something IS a repaint) could flip the whole grid to a
 * different shape mid-tap, then flip back the moment the counter turned away again. This proves a turn does
 * NOT flip it, and a genuine, held reorientation still does — with no reload needed, exactly as keySizeSet's
 * own comment always promised ("a moved screen re-decides by itself").
 *
 * Run: node e2e/till-shape-stable.cjs
 */
'use strict';
const { chromium } = require('@playwright/test');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', 'public');
const T = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json',
            '.svg':'image/svg+xml', '.png':'image/png', '.webmanifest':'application/manifest+json' };
let bad = 0;
const say = (l, ok, d) => { console.log('  ' + String(l).padEnd(58) + '· ' + d + '  ' + (ok ? 'OK' : (bad++, '✗ FAILED'))); };

(async () => {
  const srv = http.createServer((q, r) => {
    const url = q.url.split('?')[0];
    if (url.startsWith('/api/')) { r.writeHead(200, { 'content-type': 'application/json' }); return r.end('{"ok":true}'); }
    const f = path.join(ROOT, decodeURIComponent(url).replace(/^\/+/, '') || 'index.html');
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('no'); }
    r.writeHead(200, { 'content-type': T[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(r);
  });
  await new Promise((res) => srv.listen(0, res));
  const b = await chromium.launch();
  /* ⭐ THE REAL VIEWPORT, SET BEFORE BOOT — a portrait terminal from the first paint, so the very first call
     to keyShapeAuto() (which happens during boot, before this test ever runs) already sees it, and the
     baseline needs no grace window of its own to settle into. */
  const p = await b.newPage({ viewport: { width: 1080, height: 1920 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  await p.goto('http://127.0.0.1:' + srv.address().port + '/till.html');
  await p.waitForFunction(() => typeof window.screenSet === 'function', null, { timeout: 30000 });

  console.log('\n── ⭐⭐⭐ a portrait terminal picks Card first, exactly as spec §8 asks ' + '─'.repeat(0));
  const initial = await p.evaluate(() => ({ shape: keyShapeAuto(), size: keySizeAuto() }));
  say('a 1080×1920 portrait terminal chooses Card', initial.shape === 'card', initial.shape);
  say('and a tall standing size to match', initial.size === 'xlarge', initial.size);

  console.log('\n── ⭐⭐⭐ TURNED TO THE CUSTOMER — a few taps, then turned back — NOTHING FLIPS ' + '─'.repeat(0));
  /* ⭐ the exact shape the risk describes: the counter is turned 90° (a REAL Playwright viewport resize, the
     same event class a physical rotation fires), tapped a couple of times (each tap is a repaint, exactly
     where keyShapeAuto() used to be re-read), then turned straight back — all inside the grace window. */
  await p.setViewportSize({ width: 1920, height: 1080 });
  const readings = [];
  readings.push(await p.evaluate(() => keyShapeAuto()));   /* first tap, mid-turn */
  await p.waitForTimeout(300);
  readings.push(await p.evaluate(() => keyShapeAuto()));   /* second tap, still mid-turn, well under 2s */
  await p.setViewportSize({ width: 1080, height: 1920 });  /* turned back */
  readings.push(await p.evaluate(() => keyShapeAuto()));
  const keySizeHeld = await p.evaluate(() => keySizeAuto());
  say('every reading during the turn stayed Card', readings.every((r) => r === 'card'), JSON.stringify(readings));
  say('the size ladder held too, not just the shape', keySizeHeld === 'xlarge', keySizeHeld);

  console.log('\n── ⭐⭐ A GENUINE REMOUNT — the SAME new orientation, held past the grace window — DOES take ' + '─'.repeat(0));
  await p.setViewportSize({ width: 1920, height: 1080 });
  const still = await p.evaluate(() => keyShapeAuto());   /* the instant it changes: not yet believed */
  await p.waitForTimeout(2100);                           /* held past AUTO_STABLE_MS */
  const settled = await p.evaluate(() => keyShapeAuto());
  say('not believed the instant it changes', still === 'card', 'still Card, mid-grace-window');
  say('but adopted once the new orientation genuinely holds', settled === 'tile',
    'now ' + settled + ' — no reload needed, exactly as keySizeSet promises');

  console.log('\nconsole/page errors:', errs.length ? errs.join(' | ') : 'none');
  await b.close(); srv.close();
  console.log(bad || errs.length ? '\n' + (bad + errs.length) + ' failed'
    : '\nshape and size hold through a turn, and still re-decide themselves once a move genuinely sticks');
  process.exit(bad || errs.length ? 1 : 0);
})();
