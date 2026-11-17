/* walk-kb-list-search.cjs - THE LIST SEARCH BOX SHOWS ITS OWN FOCUS RING (keyboard rule 6a, WCAG 2.4.7 / 2.4.11; proof run sit-grund-2026-11-14, FAILS.md)
 * Renders public/list-lab.html (the list control on a bare page), Tabs to the search input [data-cbl-q] and reads what the FOCUSED ELEMENT itself draws: an outline of
 * non-zero width in the theme's focus colour (the same --cl-blue the other list controls use). A ring on the pill around it does not count - the proof pack reads the element.
 * Goes red when the input's own :focus-visible rule in list-ctl.js is taken away (the old pill-only ring).   1366 x 768 and 390 x 844.
 * Run: NODE_PATH=<dir with @playwright/test> node e2e/walk-kb-list-search.cjs        (exits 1 on a failure)                                                  */
'use strict';
const { chromium } = require('@playwright/test');
const { serve } = require('./lib/serve.cjs');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok  ' + m); } else { fail++; console.log('  XX  ' + m); } };

(async () => {
  const S = await serve(), browser = await chromium.launch();
  for (const [w, h] of [[1366, 768], [390, 844]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, serviceWorkers: 'block' });
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    const page = await ctx.newPage();
    await page.goto(S.url('/list-lab.html'));
    await page.waitForSelector('[data-cbl-q]');
    let landed = false;
    for (let i = 0; i < 40 && !landed; i++) { await page.keyboard.press('Tab'); landed = await page.evaluate(() => document.activeElement && document.activeElement.hasAttribute('data-cbl-q')); }
    ok(landed, w + ' · Tab reaches the search input');
    const ring = await page.evaluate(() => {
      const el = document.activeElement, s = getComputedStyle(el), pill = getComputedStyle(el.closest('.cbl-search'));
      return { style: s.outlineStyle, width: parseFloat(s.outlineWidth), color: s.outlineColor, focusVisible: el.matches(':focus-visible'), pillBorder: pill.borderTopColor, probe: [s.outlineStyle, s.outlineWidth, s.outlineColor, s.boxShadow, s.borderTopColor].join('|') };
    });
    ok(ring.focusVisible, w + ' · the keyboard focus is :focus-visible on the input');
    ok(ring.style !== 'none' && ring.width >= 2 && ring.color !== 'rgba(0, 0, 0, 0)', w + ' · the input itself draws a ' + ring.width + 'px ' + ring.style + ' outline (' + ring.color + ')');
    const inView = await page.evaluate(() => { const r = document.activeElement.getBoundingClientRect(); return r.width > 0 && r.left >= 0 && r.right <= innerWidth; });
    ok(inView, w + ' · the focused search box is inside the window');
    await ctx.close();
  }
  await browser.close(); S.close();
  console.log(pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
