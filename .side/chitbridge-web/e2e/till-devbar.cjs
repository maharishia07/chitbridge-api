/* till-devbar.cjs — THE BUILD RIBBON ([TILL-177])
 *
 * Athi: *"can you bring similar to this in counter app also — I couldn't check various sizes and can't trace
 * for speed etc. also number the screens."*
 *
 * ⚠️⚠️ THE FIRST THING ASSERTED IS THAT IT IS OFF. A ribbon a cashier can see is a row of controls that do
 * nothing for them, sitting on the most valuable strip of a working screen. Everything else here is only
 * worth having if that holds.
 *
 * Run: node e2e/till-devbar.cjs
 */
'use strict';
const { chromium } = require('@playwright/test');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', 'public');
const T = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json',
            '.svg':'image/svg+xml', '.png':'image/png', '.webmanifest':'application/manifest+json' };
let bad = 0;
const say = (l, ok, d) => { console.log('  ' + String(l).padEnd(34) + '· ' + d + '  ' + (ok ? 'OK' : (bad++, '✗ FAILED'))); };

(async () => {
  let calls = 0;
  const srv = http.createServer(async (q, r) => {
    const url = q.url.split('?')[0];
    if (url.startsWith('/api/')) {
      calls++;
      await new Promise((x) => setTimeout(x, 40));      /* something to measure */
      r.writeHead(200, { 'content-type': 'application/json' }); return r.end('{"ok":true}');
    }
    const f = path.join(ROOT, decodeURIComponent(url).replace(/^\/+/, '') || 'index.html');
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('no'); }
    r.writeHead(200, { 'content-type': T[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(r);
  });
  await new Promise((r) => srv.listen(0, r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  const b = await chromium.launch();
  const p = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
  await p.goto(base + '/till.html');
  await p.waitForFunction(() => typeof window.screenSet === 'function', null, { timeout: 30000 });

  console.log('\n── a shop never sees it ' + '─'.repeat(36));
  const off = await p.evaluate(() => {
    const el = document.getElementById('devbar');
    const r = el.getBoundingClientRect();
    return { on: devOn(), shows: Math.round(r.width) + 'x' + Math.round(r.height) };
  });
  say('it is off by default', off.on === false, 'devOn() is false');
  /* ⚠️ [hidden] must WIN here too — the lesson of [TILL-148], applied before it could be repeated */
  say('and takes no space at all', off.shows === '0x0', 'devbar measures ' + off.shows);

  console.log('\n── turned on ' + '─'.repeat(47));
  const on = await p.evaluate(() => {
    devSet(true);
    const el = document.getElementById('devbar');
    return { on: devOn(), h: Math.round(el.getBoundingClientRect().height),
             screen: (document.querySelector('[data-testid="till-dev-screen"]') || {}).innerText,
             sizes: document.querySelectorAll('.devsw button').length };
  });
  say('the ribbon appears', on.on && on.h > 10, on.h + 'px tall');
  /* ⭐ NUMBER THE SCREENS — the ask, and the reason a fault report can name what it is about */
  say('it names the screen', /^CTR-\d+ · /.test(on.screen || ''), '"' + on.screen + '"');
  say('and offers the sizes', on.sizes === 4, on.sizes + ' widths');

  console.log('\n── the number follows the screen ' + '─'.repeat(27));
  const moved = await p.evaluate(async () => {
    const before = document.querySelector('[data-testid="till-dev-screen"]').innerText;
    openHealth();
    await new Promise((r) => setTimeout(r, 300));
    devPaint();
    const during = document.querySelector('[data-testid="till-dev-screen"]').innerText;
    healthClose();
    await new Promise((r) => setTimeout(r, 200));
    devPaint();
    return { before, during, after: document.querySelector('[data-testid="till-dev-screen"]').innerText };
  });
  say('a dialog changes the number', moved.during !== moved.before, moved.before + ' → ' + moved.during);
  say('and closing it changes it back', moved.after === moved.before, moved.during + ' → ' + moved.after);
  /* ⚠️ every code must be unique, or numbering them has bought nothing */
  const codes = await p.evaluate(() => CTR_SCREENS.map((s) => s.code));
  say('every code is unique', new Set(codes).size === codes.length, codes.length + ' screens numbered');

  console.log('\n── a size is a frame, not a lie ' + '─'.repeat(28));
  const sized = await p.evaluate(async () => {
    devSize('mob');
    await new Promise((r) => setTimeout(r, 200));
    const w = document.querySelector('.wrap');
    return { framed: document.body.classList.contains('devframed'),
             width: Math.round(w.getBoundingClientRect().width) };
  });
  /* ⭐ the page really narrows, so every rule that keys off width behaves as it would on the device */
  say('the page really narrows', sized.framed && sized.width <= 392, 'the counter is ' + sized.width + 'px wide');
  const backFull = await p.evaluate(async () => {
    devSize('full'); await new Promise((r) => setTimeout(r, 200));
    return Math.round(document.querySelector('.wrap').getBoundingClientRect().width);
  });
  say('and goes back', backFull > 1000, 'full width is ' + backFull + 'px');

  console.log('\n── speed, measured where every call passes ' + '─'.repeat(17));
  const timed = await p.evaluate(async (api) => {
    CloudHost.key = 'k'; CloudHost.api = api; HOST = CloudHost;
    for (let i = 0; i < 4; i++) { try { await fetchBy(api + '/api/till/verify', {}, 5000); } catch (_) {} }
    devPaint();
    return { text: (document.querySelector('[data-testid="till-dev-speed"]') || {}).innerText,
             n: DEV_T.length, mid: devStats() && devStats().mid };
  }, base);
  say('it counts the calls', timed.n >= 4, timed.n + ' recorded');
  say('and reports a real time', timed.mid >= 30, 'median ' + timed.mid + 'ms (the server sleeps 40ms)');
  /* ⭐ the median and the worst, never a mean — one timeout would drag an average into nonsense */
  say('median and worst, not a mean', /mid/.test(timed.text) && /worst/.test(timed.text), '"' + timed.text + '"');

  const gone = await p.evaluate(() => { devSet(false); const el = document.getElementById('devbar');
    return { on: devOn(), shows: Math.round(el.getBoundingClientRect().height) }; });
  say('and it can be put away', gone.on === false && gone.shows === 0, 'back to nothing');

  fs.mkdirSync(path.join(__dirname, '..', 'png'), { recursive: true });
  await p.evaluate(() => { devSet(true); devSize('lap'); });
  await p.waitForTimeout(300);
  await p.screenshot({ path: path.join(__dirname, '..', 'png', 'DevBar.png'), clip: { x: 0, y: 0, width: 1400, height: 120 } });

  await b.close(); srv.close();
  console.log(bad ? '\n' + bad + ' failed' : '\nthe ribbon names the screen, frames the size, and times the line');
  process.exit(bad ? 1 : 0);
})();
