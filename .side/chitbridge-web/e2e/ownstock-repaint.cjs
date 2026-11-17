/**
 * ownstock-repaint.cjs — how often does our own shelf repaint after it opens?
 *
 * A test click on the + failed for 15 seconds with "element was detached from the DOM, retrying" — the button
 * was found every time and destroyed before the click landed. That is not a test problem if it keeps happening:
 * a person aiming at a + on a list that rebuilds under the cursor misses it too, and the miss is silent.
 *
 * Counts childList mutations on #sup_body over 12 seconds and reports when they happen, so a settling burst
 * (fine) can be told apart from a loop (not fine).
 *
 * Run: node e2e/ownstock-repaint.cjs
 */
'use strict';
const { chromium } = require('@playwright/test');
const path = require('path');

const BASE = process.env.CB_WEB_BASE || 'http://localhost:5173';
const STATE = path.join(__dirname, '.auth', 'user.json');

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ storageState: STATE, viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const say = (s) => console.log('  ' + s);

  await page.goto(BASE + '/app.html');
  await page.waitForTimeout(4000);
  await page.evaluate(() => navTo('suppliers'));
  await page.waitForTimeout(2000);

  await page.evaluate(() => {
    window.__rp = [];
    const start = performance.now();
    const attach = () => {
      const el = document.getElementById('sup_body');
      if (!el) return false;
      new MutationObserver((muts) => {
        for (const m of muts) {
          if (m.type === 'childList' && (m.addedNodes.length || m.removedNodes.length)) {
            window.__rp.push(Math.round(performance.now() - start));
          }
        }
      }).observe(el, { childList: true, subtree: true });
      return true;
    };
    /* The host does not exist until the shelf opens, so keep trying until it does. */
    const t = setInterval(() => { if (attach()) clearInterval(t); }, 100);
    selectSupplier('own');
  });

  await page.waitForTimeout(12000);
  const rp = await page.evaluate(() => window.__rp || []);
  say('mutations on #sup_body in 12s: ' + rp.length);
  if (rp.length) {
    say('  at (ms): ' + rp.slice(0, 40).join(', ') + (rp.length > 40 ? ' …' : ''));
    const late = rp.filter((t) => t > 6000);
    say(late.length
      ? '  ⚠️ ' + late.length + ' AFTER 6s — this is a loop, not a settling burst'
      : '  ✓ all within the first 6s — a settling burst, not a loop');
  }
  await browser.close();
})();
