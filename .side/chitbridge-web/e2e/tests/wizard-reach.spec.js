'use strict';
/* wizard-reach.spec.js — ── THE PRIMARY ACTION MUST BE ON THE SCREEN ──────────────────────────────────────────────────────────────────
 *
 * Athi, 2026-08-23, with a screenshot of the IoT wizard: *"I couldn't progress after the first step."* The Next
 * button was painted, correct, and **at y=2483 in a 1408-tall viewport** — outside the world, unclickable, and
 * unscrollable because the frame is `position:fixed; overflow:hidden`.
 *
 * ⚠️⚠️ WHY IT ONLY HAPPENED TO HIM: the wizard positions itself by copying `#panel`'s rect —
 * *"reuses the app's own coordinates instead of guessing"*, which is a good instinct and a real trap. A rect is
 * measured in DOCUMENT space; a `position:fixed` box is placed in VIEWPORT space. They agree only while the
 * panel fits on screen. His co-assists list is long, so his panel was tall, so the box ran off the bottom. On a
 * test entity with two co-assists it fits, and everything looks fine — which is exactly why this spec stretches
 * the panel rather than trusting whatever the shared account happens to hold today.
 *
 * ⭐ THE RULE, stated so it outlives this one wizard: an overlay that cannot scroll must never be taller than
 * the viewport, and its primary action must be inside it. Every co-assist type is checked, because the four
 * share one frame and a fix applied to the instance rather than the class has a shelf life.
 */
const { test, expect } = require('@playwright/test');
const { mintEntity, clickNav } = require('../fixtures');

const TYPES = ['human', 'iot', 'erp', 'ai'];

test.describe('Co-assist wizard · reachable', () => {
  test('[WIZ-01] the wizard footer stays inside the viewport, however long the screen behind it is', async ({ page }) => {
    test.setTimeout(4 * 60 * 1000);
    await mintEntity(page);

    for (const type of TYPES) {
      await test.step(type, async () => {
        await clickNav(page, 'coassists');
        /* ⚠️ Make the screen behind TALLER THAN THE VIEWPORT — the condition his account meets and a fresh
           one does not. Without this the spec passes on broken code, which is worse than not having it. */
        await page.evaluate(() => {
          const el = document.getElementById('panel') || document.querySelector('.panel');
          if (el) el.style.minHeight = '2400px';
        });
        await page.getByTestId('coassist-new').click();
        await page.getByTestId(`coassist-type-${type}`).click();

        const next = page.getByTestId('coassist-wiz-next');
        await expect(next, `the ${type} wizard rendered no primary action`).toBeVisible({ timeout: 20000 });

        const fits = await next.evaluate((el) => {
          const b = el.getBoundingClientRect();
          return { top: Math.round(b.top), bottom: Math.round(b.bottom), vh: window.innerHeight };
        });
        expect(fits.bottom,
          `${type}: the wizard's primary action is at ${fits.top}..${fits.bottom} in a ${fits.vh}px viewport — `
          + 'painted, but outside the screen. The frame is position:fixed and overflow:hidden, so nothing can '
          + 'scroll it into view and the wizard cannot be completed at all.').toBeLessThanOrEqual(fits.vh);
        expect(fits.top, `${type}: the primary action is above the top of the viewport`).toBeGreaterThanOrEqual(0);

        /**
         * ⭐ Reachability is not geometry alone — prove it takes the click and ADVANCES.
         *
         * ⚠️ Not `expect(#actorwiz).toBeVisible()`: that host is a zero-size div whose child is the fixed
         * frame, so Playwright calls it hidden and the spec accuses the app of doing nothing. The step
         * counter is the honest witness — it is the wizard saying which step it is on.
         */
        await next.click({ timeout: 10000 });
        await expect(page.getByText(/\b2 of \d\b/), `${type}: pressing Next did not advance the step`)
          .toBeVisible({ timeout: 10000 });

        await page.evaluate(() => { if (window.awClose) awClose(); });
        await page.waitForTimeout(300);
      });
    }
  });
});
