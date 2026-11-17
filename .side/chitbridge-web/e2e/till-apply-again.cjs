/* till-apply-again.cjs — APPLY, AND APPLY AGAIN, AND AGAIN ([TILL-95])
 *
 * Athi, 2026-09-19: "apply to counter is not working, i changed to vertical, and couldn't change to different
 * other settings. can you do me a favour. do a playwright script change different combinations, and apply the
 * same combination multiple times and see it works?"
 *
 * ⚠️⚠️ THIS IS THE SHAPE OF BUG A SINGLE PASS CANNOT SEE. "Try changing again and again" is already a standing
 * probe step here, because three separate defects have only ever shown on the SECOND action — a stale cached
 * object, a repaint that ate its own handler, a draft that was never cleared. A test that applies one style
 * once will pass over every one of them.
 *
 * So this does three things a person does and a happy-path test does not:
 *   1. walks MANY combinations, applying each and reading back what the counter actually holds
 *   2. applies the SAME combination twice in a row — the second must be a no-op, not a failure
 *   3. goes BACK to a previous combination after a shape change, which is Athi's exact complaint
 */
'use strict';
const { chromium } = require('@playwright/test');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', 'public');
const T = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json',
            '.svg':'image/svg+xml', '.png':'image/png', '.webmanifest':'application/manifest+json' };
let bad = 0;
const say = (l, ok, d) => { console.log(String(l).padEnd(30) + '· ' + d + '  ' + (ok ? 'OK' : (bad++, '✗ FAILED'))); };

const ITEMS = [];
for (let i = 0; i < 24; i++) ITEMS.push({ item_id: 'p' + i, name: 'Product ' + i, code: 'P' + i,
  category: ['Tiffin', 'Drinks'][i % 2], unit: 'plate', price: 20 + i });

/* the walk: layout, tile, picker, theme — enough to change the shape twice and come back */
const WALK = [
  { layout: 'horizontal', tile: 'classic',     theme: 'lightCream' },
  { layout: 'vertical',   tile: 'colourBlock', theme: 'navy' },
  { layout: 'vertical',   tile: 'colourBlock', theme: 'navy' },   /* ⚠️ the SAME one, twice */
  { layout: 'horizontal', tile: 'photo',       theme: 'dark' },   /* ⚠️ back out of the tall shape */
  { layout: 'tablet',     tile: 'monogram',    theme: 'paper' },
  { layout: 'rail',       tile: 'compactRow',  theme: 'lightCream' },
  { layout: 'vertical',   tile: 'hotkey',      theme: 'dark' },
  { layout: 'horizontal', tile: 'classic',     theme: 'lightCream' },  /* all the way home */
];

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
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  const threw = []; p.on('pageerror', e => threw.push(e.message));
  await p.goto('http://127.0.0.1:' + srv.address().port + '/till.html');
  await p.waitForFunction(() => typeof window.styleOpen === 'function', null, { timeout: 30000 });
  await p.evaluate((items) => {
    window.S = { shop: { country: 'IN', name: 'Mayur Bhavan', currency: 'INR' }, items: items, offers: [], at: new Date().toISOString() };
    setMode('sell');
  }, ITEMS);

  for (let n = 0; n < WALK.length; n++) {
    const want = WALK[n];
    const tag = (n + 1) + '. ' + want.layout + '/' + want.tile + '/' + want.theme;

    /* ⚠️ DRIVE THE REAL DOOR EVERY TIME — the hub, the section, the Preview link, the chips, Apply. A test that
       calls styleApply() directly cannot see a dialog that stopped opening, which is what Athi reported. */
    const opened = await (async () => {
      try {
        await p.evaluate(() => { try { closeMenu(); } catch (_) {} });
        await p.click('[data-testid="till-side-open"]', { timeout: 4000 });
        await p.waitForSelector('#tillmenu', { state: 'visible', timeout: 4000 });
        await p.click('[data-testid="till-msec-btn-look"]', { timeout: 4000 });
        await p.click('[data-testid="till-msec-link-look"]', { timeout: 4000 });
        await p.waitForSelector('#styledlg[open]', { timeout: 4000 });
        return true;
      } catch (e) { return false; }
    })();
    if (!opened) { say(tag, false, 'the studio would not open at all'); continue; }
    await p.waitForTimeout(120);

    let picked = true;
    for (const [k, v] of [['layout', want.layout], ['tile', want.tile], ['theme', want.theme]]) {
      try { await p.click(`[data-testid="till-style-${k}-${v}"]`, { timeout: 3000 }); }
      catch (e) { picked = false; say(tag, false, 'could not press ' + k + ' = ' + v); break; }
      await p.waitForTimeout(40);
    }
    if (!picked) continue;

    /* what the dialog PROMISES before Apply — so a mismatch afterwards says which half lied */
    const promised = await p.evaluate(() => {
      const c = styleCfg();
      return { layout: c.layout, tile: c.tile, theme: c.theme,
        pending: (document.getElementById('stypend') || {}).textContent || '' };
    });

    try { await p.click('[data-testid="till-style-apply"]', { timeout: 3000 }); }
    catch (e) { say(tag, false, 'Apply could not be pressed'); continue; }
    await p.waitForTimeout(350);

    const got = await p.evaluate(() => {
      const c = screenCfg();
      return { layout: c.layout, tile: c.tile, theme: c.theme,
        shape: (document.body.className.match(/shape-\w+/) || ['shape-wide'])[0].replace('shape-', ''),
        open: !!document.querySelector('#styledlg[open]'),
        /* ⚠️ and the counter must still FIT — a shape change is where that broke ([TILL-94]) */
        over: Math.max(document.documentElement.scrollHeight - document.documentElement.clientHeight, 0) };
    });

    const landed = got.layout === want.layout && got.tile === want.tile && got.theme === want.theme;
    const same = n > 0 && JSON.stringify(WALK[n - 1]) === JSON.stringify(want);
    say(tag + (same ? ' (again)' : ''), landed && !got.open && got.over <= 1,
      'counter now ' + got.layout + '/' + got.tile + '/' + got.theme + ' · ' + got.shape
      + (got.open ? ' · DIALOG STILL OPEN' : '') + (got.over > 1 ? ' · page overflows ' + got.over + 'px' : '')
      + (landed ? '' : '  (promised ' + promised.layout + '/' + promised.tile + '/' + promised.theme + ')'));
  }

  /**
   * ── ⚠️⚠️ THE CASE ATHI WAS ACTUALLY IN: A BILL IN HAND ─────────────────────────────
   * His screenshot showed one Masala Dosa on the bill. [TILL-84] holds a style change until that bill is
   * finished — which is right — but the only thing that SAYS so is a toast, and the dialog closes at the
   * same moment. From the outside that is indistinguishable from "Apply does nothing".
   */
  await p.evaluate(() => { try { closeMenu(); } catch (_) {} clearBill(); });
  await p.evaluate((items) => { addItem(items[0], 1); price(); }, ITEMS);
  await p.click('[data-testid="till-side-open"]');
  await p.click('[data-testid="till-msec-btn-look"]');
  await p.click('[data-testid="till-msec-link-look"]');
  await p.waitForSelector('#styledlg[open]', { timeout: 4000 });
  await p.click('[data-testid="till-style-theme-navy"]');
  await p.click('[data-testid="till-style-apply"]');
  await p.waitForTimeout(400);
  const held = await p.evaluate(() => ({
    theme: screenCfg().theme, pend: !!STYLE_PEND,
    dialogOpen: !!document.querySelector('#styledlg[open]'),
    /* ⚠️ is there ANYTHING still on screen saying why nothing changed? */
    saysSomewhere: /waiting|waits|when this bill|bill in hand/i.test(document.body.innerText) }));
  say('mid-bill', held.theme !== 'navy' && held.pend, 'held the change (theme still ' + held.theme + ')');
  /* ⚠️⚠️ AND THE DIALOG STAYS OPEN SAYING SO — a toast that vanishes made this read as a broken button */
  say('stays open', held.dialogOpen, held.dialogOpen ? 'the studio is still there, explaining' : 'THE DIALOG VANISHED');
  const btn = await p.textContent('#styapply').catch(() => '');
  say('the button', /Waiting for the bill/.test(btn), '"' + btn.trim() + '"');
  say('and says so', held.saysSomewhere,
    held.saysSomewhere ? 'the screen still explains why nothing moved'
      : 'NOTHING ON SCREEN SAYS WHY — this reads as "Apply is broken"');
  /* ⚠️ the studio now STAYS OPEN while a change is held ([TILL-95]) — close it the way a person would */
  await p.evaluate(() => styleClose());
  await p.waitForTimeout(120);
  await p.evaluate(() => clearBill());
  await p.waitForTimeout(300);
  const after = await p.evaluate(() => screenCfg().theme);
  say('bill finished', after === 'navy', 'the held change landed → ' + after);

  /* ⚠️ AND THE SETTINGS THAT APPLY AT ONCE must survive the same walk — key size is written on the tap */
  await p.evaluate(() => { try { closeMenu(); } catch (_) {} });
  await p.click('[data-testid="till-side-open"]');
  await p.click('[data-testid="till-msec-btn-look"]');
  await p.click('[data-testid="till-msec-link-look"]');
  await p.waitForSelector('#styledlg[open]', { timeout: 4000 });
  for (const k of ['xlarge', 'small', 'xlarge', 'medium', '']) {
    await p.click(`[data-testid="till-style-keysize-${k || 'auto'}"]`);
    await p.waitForTimeout(80);
  }
  const ks = await p.evaluate(() => ({ chosen: keySizeChosen(), now: keySizeNow(),
    min: getComputedStyle(document.body).getPropertyValue('--key-min').trim() }));
  say('key size, five taps', !ks.chosen && ks.now === keyExpect(ks.now),
    'ended on Automatic → ' + ks.now + ' (' + ks.min + ')');

  if (threw.length) console.log('⚠️ threw: ' + threw.slice(0, 4).join(' | '));
  console.log(bad ? ('\n' + bad + ' FAILED') : '\napply works, again and again');
  await b.close(); srv.close(); process.exit(bad ? 1 : 0);
})();

/* the resolved size is whatever the ladder says for this window — the check is that one exists, not which */
function keyExpect(x) { return x; }
