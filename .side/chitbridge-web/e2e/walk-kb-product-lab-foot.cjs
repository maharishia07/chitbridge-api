/* walk-kb-product-lab-foot.cjs - PRODUCT LAB'S FOOTER COVERS NOTHING THE KEYBOARD LANDS ON (keyboard rule 6b, WCAG 2.4.11; proof run sit-grund-2026-11-14, FAILS.md)
 * Renders public/product-lab.html in the lab frame (api answered with nothing), paints the step-1 footer the way paintFoot() does and a long list of tick boxes, then:
 *   1366 x 768  the sidebar's "Collapse sidebar" button (#toggleNav) is the top element at its own centre - the page footer no longer runs across the sidebar;
 *   1366 + 390  Tab through the list to its LAST row: the focused tick box is not under the footer (elementFromPoint at its centre is the box or its row).
 * Goes red when .foot goes back to position:fixed full width (it covers the toggle) or the scroll pane loses its scroll-padding-bottom.
 * Run: NODE_PATH=<dir with @playwright/test> node e2e/walk-kb-product-lab-foot.cjs        (exits 1 on a failure) */
'use strict';
const { chromium } = require('@playwright/test');
const { serve } = require('./lib/serve.cjs');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok  ' + m); } else { fail++; console.log('  XX  ' + m); } };

/* the list and the footer as step 1 draws them (paintFoot): the real CSS of the page stays, only the rows are ours */
const PAINT = () => {
  const rows = [];
  for (let i = 1; i <= 40; i++) rows.push('<label style="display:block;padding:10px 0"><input type="checkbox" id="kb' + i + '"> Product ' + i + '</label>');
  document.getElementById('stage').innerHTML = rows.join('');
  document.getElementById('foot').innerHTML = '<span class="note" id="count">Tick what this shop sells. Add more later.</span><span class="why" id="nextwhy" role="status">Tick one product first.</span><button class="go" id="next" disabled>Next</button>';
};

async function runWidth(browser, S, w, h) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, serviceWorkers: 'block' }), T = w + ' · ';
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await ctx.route(/railway\.app/, (r) => r.fulfill({ status: 404, contentType: 'application/json', body: '{}' }));
  await ctx.route('**/api/**', (r) => r.fulfill({ status: 404, contentType: 'application/json', body: '{}' }));
  const page = await ctx.newPage();
  await page.goto(S.url('/product-lab.html'), { waitUntil: 'load' });
  await page.waitForTimeout(1500);
  await page.evaluate(PAINT);
  await page.waitForTimeout(200);
  if (w >= 1000) {
    const toggle = await page.evaluate(() => {
      const t = document.getElementById('toggleNav'); if (!t) return null;
      t.scrollIntoView({ block: 'nearest' });
      const r = t.getBoundingClientRect(), top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return { visible: r.width > 0 && r.bottom <= innerHeight, covered: !!top && !(t.contains(top) || top.contains(t)), by: top ? (top.id || top.className || top.tagName) : 'nothing' };
    });
    ok(toggle && toggle.visible, T + '#toggleNav is drawn inside the window');
    ok(toggle && !toggle.covered, T + '6b · #toggleNav is not covered (top element at its centre: ' + (toggle && toggle.by) + ')');
  }
  await page.focus('#kb1');
  for (let i = 0; i < 39; i++) await page.keyboard.press('Tab');
  await page.waitForTimeout(150);
  const last = await page.evaluate(() => {
    const el = document.activeElement, r = el.getBoundingClientRect(), top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { id: el.id, covered: !!top && !(el.contains(top) || top.contains(el) || top === el.parentElement), by: top ? (top.id || top.className || top.tagName) : 'nothing', inView: r.top >= 0 && r.bottom <= innerHeight };
  });
  ok(last.id === 'kb40', T + 'Tab reached the last row (' + last.id + ')');
  ok(last.inView && !last.covered, T + '6b · the last tick box is in view and not under the footer (top element: ' + last.by + ')');
  await ctx.close();
}

(async () => {
  const S = await serve(), browser = await chromium.launch();
  for (const [w, h] of [[1366, 768], [390, 844]]) await runWidth(browser, S, w, h);
  await browser.close(); S.close();
  console.log(pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
