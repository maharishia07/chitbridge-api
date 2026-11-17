// rtl.spec.js — does the interface actually mirror when the reading order does?
//
// ⚠️ THE LOGICAL-PROPERTIES SWEEP IS ONLY WORTH SOMETHING IF THIS PASSES. 378 declarations were converted and
// VIS-01 stayed pixel-identical — which proves the sweep changed nothing in LTR, and proves nothing at all about
// the case it was done for. This is that case.
//
// ⚠️ IT SETS `dir` DIRECTLY rather than choosing Arabic, deliberately: the CSS readiness and the translation are
// separate pieces of work, and this asserts the first without waiting for the second. When Arabic lands, the
// language picker sets `dir` and these same assertions carry over.

const { test, expect } = require('@playwright/test');
const { mintEntity } = require('../fixtures');

const box = (page, sel) => page.evaluate((s) => {
  const el = document.querySelector(s);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { left: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width) };
}, sel);

test.describe('RTL · the layout mirrors with the reading order', () => {
  test.describe.configure({ timeout: 150_000 });

  test('[RTL-01] ⭐ the nav rail moves to the other side', async ({ page }) => {
    await mintEntity(page);
    const ltr = await box(page, '.menu');
    expect(ltr, 'the rail must render before we can test it moving').toBeTruthy();
    const vw = await page.evaluate(() => window.innerWidth);
    expect(ltr.left, 'in LTR the rail sits on the left').toBeLessThan(vw / 2);

    await page.evaluate(() => document.documentElement.setAttribute('dir', 'rtl'));
    await page.waitForTimeout(600);
    const rtl = await box(page, '.menu');

    /* ⚠️ THE WIDTH MUST NOT CHANGE — only the side. A rail that also resizes means something is still physical
       and is fighting the mirror rather than following it. */
    expect(rtl.w, 'the rail keeps its width; only its side changes').toBe(ltr.w);
    expect(rtl.left, 'in RTL the rail must sit on the right').toBeGreaterThan(vw / 2);

    await page.evaluate(() => document.documentElement.removeAttribute('dir'));
  });

  test('[RTL-02] the pinned controls move with it', async ({ page }) => {
    await mintEntity(page);
    const before = await box(page, '#assistfab');
    test.skip(!before, 'no assistant FAB on this screen');
    const vw = await page.evaluate(() => window.innerWidth);
    expect(before.left, 'the FAB is pinned right in LTR').toBeGreaterThan(vw / 2);

    await page.evaluate(() => document.documentElement.setAttribute('dir', 'rtl'));
    await page.waitForTimeout(600);
    const after = await box(page, '#assistfab');
    /* This is what `inset-inline-end` buys: everything pinned to an edge follows the reading order instead of
       staying welded to one side of the screen. */
    expect(after.left, 'in RTL it belongs on the other side').toBeLessThan(vw / 2);
    await page.evaluate(() => document.documentElement.removeAttribute('dir'));
  });

  test('[RTL-03] ⚠️ nothing overflows sideways in RTL', async ({ page }) => {
    await mintEntity(page);
    await page.evaluate(() => document.documentElement.setAttribute('dir', 'rtl'));
    await page.waitForTimeout(800);
    const overflow = await page.evaluate(() => {
      const d = document.documentElement;
      return { scroll: d.scrollWidth, client: d.clientWidth };
    });
    /* A mirrored layout that pushes content off the edge is the classic RTL failure — a stray physical property
       fighting the mirror, which shows up as a horizontal scrollbar and nothing else. */
    expect(overflow.scroll, 'the page must not scroll sideways in RTL').toBeLessThanOrEqual(overflow.client + 2);
    await page.evaluate(() => document.documentElement.removeAttribute('dir'));
  });
});
