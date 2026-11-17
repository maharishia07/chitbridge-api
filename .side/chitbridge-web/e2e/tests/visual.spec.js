// VISUAL REGRESSION (reviewer §4) — baseline SETTLED screens, diff pixels each run, fail on unexpected shift/overlap/break.
// ⚠ ONLY on STABLE flows — a screen still being redesigned "fails" on every intentional change (noise). First run creates
// the baseline; commit it once the screen is settled. Runs at the counter viewport (config). Add screens as they settle.
//
// ══ ⚠️ THIS TEST ROTTED FOR THREE WEEKS, AND THAT IS THE FAILURE WORTH LEARNING FROM ══════════════════════════════
// Baseline committed 2026-07-28. By 2026-08-16 it was failing by 41,358 px — and `app.html` had had 113 commits in
// between. Not a regression: three weeks of intentional design change measured against a snapshot nobody refreshed.
//
// ⭐ A PERMANENTLY-RED TEST IS WORSE THAN NO TEST. It fails every run, so its failure stops carrying information,
// and the one time it catches something real nobody looks. It was still red on the morning of the contrast pass,
// which is how ~773 px of genuine colour change hid inside 41k of noise.
//
// ⚠️ SO: RE-BASELINE DELIBERATELY, AND SOON AFTER A SETTLED CHANGE — not "eventually". If this screen is being
// actively redesigned, take it OUT of the suite rather than let it sit red. And when re-baselining, LOOK at the
// screen first: the point is to confirm nothing is broken, not to make the number go away. Re-based 2026-08-16
// after confirming the sign-in screen renders clean — no overlap, no clipping.
const { test, expect } = require('@playwright/test');
const { mintEntity } = require('../fixtures');

test.describe('Visual regression · settled screens only', () => {
  /**
   * ⚠️⚠️ IT WAS CALLED "entry / sign-in screen" AND HAS NEVER CAPTURED ONE. This runs in the `authed` project,
   * where a restored session boots `/app.html` straight past sign-in — so the baseline committed under that
   * name is the signed-in TASK LIST. A test whose name and subject disagree sends the next reader to the wrong
   * screen looking for a fault that is not there.
   *
   * ⚠️⚠️ AND IT COULD NEVER HAVE STAYED GREEN, re-baselined or not. The snapshot included the top-right
   * IDENTITY STRIP — the entity's display name and handle — which is different on every mint. `E2E Co 473892`
   * became `e2eco-mt3uwo8w965` with no design change whatsoever. So the baseline was guaranteed to rot on a
   * schedule set by the fixtures, and the header above blames three weeks of design change for what was partly
   * just a new account.
   *
   * ⭐ MASK THE VOLATILE, KEEP THE STRUCTURE. Playwright paints masked regions a flat colour in BOTH images, so
   * the layout of the strip is still compared — its width, its position, whether it overlaps the sign-out
   * button — while the text inside it stops voting. That is the difference between a test that measures the
   * design and one that measures the test data.
   *
   * ⭐ RE-BASED 2026-08-22 after LOOKING at both images, which is the rule this file already states. The 39,424
   * differing pixels were: the empty state gaining a real Compose button where it used to name Compose in
   * prose and make you go find it (M11); `Messages` moving from RAIL to WORK, which shifts every item below it
   * by a pixel or two; and the account name above. No overlap, no clipping, nothing unreadable — a deliberate
   * change, confirmed by eye before the number was allowed to go away.
   */
  test('[VIS-01] the signed-in task screen matches baseline', async ({ page }) => {
    await page.goto('/app.html');
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(500);                         // let it settle before the snapshot
    await expect(page).toHaveScreenshot('entry.png', {
      maxDiffPixelRatio: 0.02,
      animations: 'disabled',
      /**
       * ⚠️ MASK THE NAME AND THE AVATAR, NOT THE WHOLE STRIP. My first version masked `.who`, which also
       * contains the Open / Closed / Away presence pills — so a break in those would have stopped being
       * visible to this test. Over-masking buys a green run by removing the thing under test; the mask has to
       * be exactly as wide as the volatility, and no wider.
       *
       * ⚠️ THE AVATAR IS VOLATILE TOO — it renders the first letter of the account name, so `E` became `e`
       * with no design change at all.
       */
      mask: [page.locator('.topbar .nmwrap'), page.locator('.topbar .av')],
    });
  });
});

// POST-ACTION LAYOUT SHIFT (reviewer §5) — a keyboard/nav action must NOT make the screen jump (the operator loses their
// place — a real counter-speed killer). Anchor a stable element and assert it doesn't move after an action.
test.describe('Layout stability · no jump after an action', () => {
  test('[SHIFT-01] switching screens does not shift the sidebar', async ({ page }) => {
    await mintEntity(page);
    const anchor = page.getByTestId('nav-compose');
    const before = await anchor.boundingBox();
    await page.getByTestId('nav-task').click();
    await page.waitForTimeout(300);
    const after = await anchor.boundingBox();
    expect(Math.abs((after && after.y || 0) - (before && before.y || 0)), 'sidebar shifted after a nav action').toBeLessThan(5);
  });
});
