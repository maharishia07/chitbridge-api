// [LAZY] A REPAINT MUST NOT TAKE BACK THE ROWS SOMEBODY ASKED FOR.
//
// ── ⚠️⚠️⚠️ THE FAULT THIS FILE STANDS AGAINST ────────────────────────────────────────────────────────────────
//
// Athi, INC-260912-0XJN: *"it says 500 products but only 12 rows are listed."*
//
// AND THE COUNT WAS RIGHT. `lazyWrap` reset its window to 50 on every rebuild — and the catalogue rebuilds
// constantly: the twenty-second refresh, the categories arriving, the tax slabs, the offers. Press "Show 50
// more" three times, reach row 200, a timer fires, and you are back at fifty while the header still says how
// many there really are. Measured on the deployed page before the fix: revealed 60, repainted, back to 50.
//
// ⚠️ AND IT TOOK THE SCROLL WITH IT — paintProdList restores scrollTop onto a box that just lost three quarters
// of its height, so the restore lands past the end and the list jumps. Two symptoms, one cause.
//
// ⚠️⚠️ AND IT WAS NEVER ONLY THE CATALOGUE. lazyWrap is shared by the chit history, the message thread and both
// dispute lists; none of them had been noticed. Fixed in lazyWrap itself, which is why this spec asserts on the
// primitive as well as on the screen. [[feedback-repaint-locally]]
//
// Run: npx playwright test tests/lazy-window.spec.js --reporter=line
const { test, expect } = require('@playwright/test');
const { mintEntity } = require('../fixtures');
const API = process.env.CB_API_BASE || 'https://chitbridge-api-production.up.railway.app';

test('[LAZY-01] revealed rows survive the refresh that repaints the list', async ({ page }) => {
  test.setTimeout(420000);
  await mintEntity(page, { fresh: true, name: 'Lazy ' + Date.now().toString().slice(-6) });
  const token = await page.evaluate(() => SESSION.token);
  const H = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };

  /* ⚠ more than one chunk, or there is nothing to lose */
  const items = [];
  for (let i = 1; i <= 60; i++) items.push({ name: 'Probe item ' + i, price: 10 + i, unit: 'NOS' });
  const r = await page.request.post(API + '/api/products/bulk', { headers: H, data: { items: items } });
  expect(r.ok(), 'could not seed the catalogue').toBeTruthy();

  await page.evaluate(() => { try { navTo('catalogue'); } catch (_) {} });
  await expect.poll(async () => page.evaluate(() => (UI.prods || []).length), { timeout: 60000 }).toBe(60);
  await page.waitForTimeout(2500);

  /* the header counts every match, and says so — that half was always right */
  await expect(page.locator('#ct_count')).toContainText('60');

  const out = await page.evaluate(() => {
    const first = LAZY.prodlist.shown;
    lazyReveal('prodlist');                 /* what a person pressing "Show 50 more" does */
    const revealed = LAZY.prodlist.shown;
    paintProdList();                        /* what the twenty-second refresh does, unasked */
    return { first: first, revealed: revealed, afterRepaint: LAZY.prodlist.shown,
             bar: (document.querySelector('#ct_rows .listend') || {}).textContent || '' };
  });

  expect(out.first, 'the first draw is one chunk').toBe(50);
  expect(out.revealed, 'pressing Show more did not reveal the rest').toBe(60);
  /* ⭐ THE ASSERTION THAT MATTERS: the repaint must not take them back */
  expect(out.afterRepaint, 'a repaint collapsed the list back to one chunk').toBe(60);
  expect(out.bar, 'and the end of the list says so').toContain('end of list');
});

test('[LAZY-02] but a list that has SHRUNK goes back to one chunk', async ({ page }) => {
  test.setTimeout(420000);
  await mintEntity(page, { fresh: true, name: 'Lazy2 ' + Date.now().toString().slice(-6) });
  const token = await page.evaluate(() => SESSION.token);
  const H = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
  const items = [];
  for (let i = 1; i <= 60; i++) items.push({ name: 'Probe item ' + i, price: 10 + i, unit: 'NOS' });
  await page.request.post(API + '/api/products/bulk', { headers: H, data: { items: items } });
  await page.evaluate(() => { try { navTo('catalogue'); } catch (_) {} });
  await expect.poll(async () => page.evaluate(() => (UI.prods || []).length), { timeout: 60000 }).toBe(60);
  await page.waitForTimeout(2500);

  /**
   * ⚠️ KEEPING THE WINDOW IS ONLY RIGHT WHILE IT STILL FITS. A filter that narrows the list to twelve must not
   * leave a bar reading "60 of 12" — showing more than exists is a worse lie than collapsing.
   */
  const out = await page.evaluate(() => {
    lazyReveal('prodlist');
    const revealed = LAZY.prodlist.shown;
    lazyWrap('prodlist', LAZY.prodlist.items.slice(0, 12), LAZY.prodlist.cardFn);
    return { revealed: revealed, shrunk: LAZY.prodlist.shown, total: LAZY.prodlist.total };
  });
  expect(out.revealed).toBe(60);
  expect(out.total).toBe(12);
  expect(out.shrunk, 'a shrunken list must not claim a window bigger than itself').toBe(12);
});
