/**
 * no-wrapper-leak.spec.js — the string wrapper must never appear ON the screen.
 *
 * ⚠️⚠️ FOUR TIMES IN ONE SITTING A SOURCE-READING CHECK SAID CLEAN AND THE BROWSER SAID OTHERWISE. Wrapping
 * 87 labels in `tx()` needs two different forms — `${tx('X')}` inside a template literal, `' + tx('X') + '`
 * inside string concatenation — and **both are valid JavaScript**. Put the wrong one in and nothing throws,
 * `node --check` passes, and the reader sees the wrapper characters printed where the word should be.
 *
 * ⭐⭐ SO THIS IS THE ONLY HONEST DETECTOR: the rendered page. Every heuristic I wrote to infer the context
 * from source was right most of the time and wrong a few times, which is the worst ratio to have — good
 * enough to look trustworthy. Backtick parity on the line missed multi-line templates; parity from the top of
 * the file missed backticks inside comments; "is there a `${` after the last `}`" missed a line whose active
 * interpolation came earlier. Each refinement caught the previous miss and hid the next.
 *
 * ⚠️ AND `render-smoke` COULD NOT HAVE FOUND THESE. It renders 27 screens and asserts they produce markup —
 * it does not open a chit, and it does not read the text a person ends up looking at. A leak on the mode
 * ribbon sat on top of EVERY screen for a whole commit while 27 checks reported green.
 *
 * ⭐ It seeds first, because an empty screen renders almost nothing — the two chit-detail leaks were invisible
 * until there was a chit to open.
 */
const { test, expect } = require('@playwright/test');
const { mintEntity, clickNav, seedDemo } = require('../fixtures');

/** The wrapper as it looks when it FAILED to run: the characters, not the value. */
const LEAK = /(\$\{tx\(|\+ tx\(|\{esc\()/;

test.describe('String layer · the wrapper never shows', () => {
  test.describe.configure({ timeout: 300_000 });

  test('[WRAP-01] no screen prints the tx() wrapper instead of the word', async ({ page }) => {
    await mintEntity(page);
    await clickNav(page, 'task');
    await page.waitForTimeout(1500);
    await seedDemo(page);
    await page.reload();
    await page.waitForTimeout(4000);

    const found = [];
    for (const screen of ['task', 'order', 'drafts', 'catalogue', 'suppliers', 'mis', 'messages']) {
      await page.evaluate((n) => { if (typeof navTo === 'function') navTo(n); }, screen);
      await page.waitForTimeout(1100);
      const hit = await page.evaluate((src) => {
        const m = (document.body.innerText || '').match(new RegExp(src));
        return m ? m[0] : null;
      }, LEAK.source);
      if (hit) found.push(screen + ': ' + hit);
    }

    /* ⚠️ AND AN OPEN CHIT — where two of the four leaks lived, on a screen no smoke test renders. */
    await page.evaluate(() => navTo('task'));
    await page.waitForTimeout(1100);
    const row = page.locator('.lrow').first();
    if (await row.count()) { await row.click().catch(() => {}); await page.waitForTimeout(2500); }
    const detail = await page.evaluate((src) => {
      const m = (document.body.innerText || '').match(new RegExp(src));
      return m ? m[0] : null;
    }, LEAK.source);
    if (detail) found.push('chit detail: ' + detail);

    expect(found, 'the wrapper is being printed instead of the word:\n  ' + found.join('\n  ')).toEqual([]);
  });
});
