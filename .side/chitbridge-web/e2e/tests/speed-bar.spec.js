// [BAR] THE FOUR THINGS YOU CAN DO IN THE SPEED TAB SIT ABOVE THE NUMBERS, AND NEVER MOVE.
//
// ── ⭐⭐⭐ WHY THIS EXISTS ─────────────────────────────────────────────────────────────────────────────────────
//
// Athi, 2026-09-13: *"Clear this screen and Clear everything have to be a chip, not visible as an action icon.
// Also, at the bottom, Write this up and Snapshot — it has to be on the top as a chip with clear instruction,
// so people know it. These options are not going to change, so let them be on the top."*
//
// ⚠️⚠️ AND HE IS RIGHT ABOUT WHERE, NOT ONLY HOW. "Write this up" sat at the FOOT of the reading — the one place
// a person never reaches until they have finished reading and decided to do nothing. The whole reason the Speed
// area exists is to turn a slow screen into a filed finding, and the control that does that was below the fold.
// A reset under the figures has the same problem in reverse: it is found after you have already believed them.
//
// ⚠️ AND THE ORDER IS PART OF THE ASSERTION. "They are not going to change, so let them be on the top" means the
// bar must not depend on what the reading says — a control that appears and disappears has to be re-learned.
//
// Run: npx playwright test tests/speed-bar.spec.js --reporter=line
const { test, expect } = require('@playwright/test');
const { mintEntity } = require('../fixtures');

const CHIPS = ['diag-raise', 'diag-snapshot', 'diag-clear-screen', 'diag-clear-all'];

async function speed(page) {
  const sw = page.locator('[data-testid="vp-test"]');
  await expect(sw).toBeVisible({ timeout: 45000 });
  if (!((await sw.textContent()) || '').includes('on')) await sw.click();
  await page.locator('[data-testid="screen-cases"]').first().click();
  await expect(page.locator('#cbcasespanel')).toBeVisible({ timeout: 30000 });
  const modal = page.locator('#modalhost .modal');
  if (await modal.count()) await page.locator('#modalhost .modal button').last().click();
  await page.evaluate(() => testArea('diag'));
}

test('[BAR-01] all four are chips, at the top, with the instruction', async ({ page }) => {
  test.setTimeout(300000);
  await mintEntity(page, { fresh: true, name: 'Bar ' + Date.now().toString().slice(-6) });
  await speed(page);

  for (const id of CHIPS) {
    await expect(page.locator('[data-testid="' + id + '"]'), id + ' is missing').toBeVisible();
  }

  /**
   * ⭐ ABOVE THE NUMBERS. Asserted by POSITION on the rendered page, not by where the string sits in the
   * source: the whole complaint was about what a person meets first, and only geometry answers that.
   */
  const bar = await page.locator('[data-testid="diag-raise"]').boundingBox();
  const body = await page.locator('#cbcasespanel').boundingBox();
  expect(bar, 'the bar did not render').toBeTruthy();
  expect(bar.y - body.y, 'the bar is not near the top of the panel').toBeLessThan(150);

  /**
   * ⚠️ A CHIP WITH ONLY AN ICON IS A CONTROL YOU HAVE TO PRESS TO FIND OUT WHAT IT WAS — so each of the four
   * still says what it does. It said so TWICE: once as its own title=, and again as four bullets printed
   * underneath, which is what the cut list removed. The words survived; the copy of them did not, and the
   * assertion follows them onto the chips. [[feedback-improvise-update-cases]]
   */
  await expect(page.locator('[data-testid="diag-raise"]'))
    .toHaveAttribute('title', /Create form/);
  await expect(page.locator('[data-testid="diag-snapshot"]'))
    .toHaveAttribute('title', /every call of this visit/);
  await expect(page.locator('[data-testid="diag-clear-screen"]'))
    .toHaveAttribute('title', /Throw away/);
  /* ⭐ and the answer to "is it user-id dependent?" is still reachable, on the button that asks it */
  await expect(page.locator('[data-testid="diag-clear-all"]'),
    'whose readings am I throwing away? must be answerable at the destructive control')
    .toHaveAttribute('title', /cannot touch anybody else/);

  /* ⚠️ AND THE PANEL NO LONGER SAYS IT OUT LOUD. This is the cut itself, asserted — without it the bullets
     could come back and every line above would still pass. */
  const panel = page.locator('#cbcasespanel');
  await expect(panel, 'the instruction bullets are back').not.toContainText('puts these numbers into');
});

test('[BAR-02] the bar is there before anything has been measured, and after', async ({ page }) => {
  test.setTimeout(300000);
  await mintEntity(page, { fresh: true, name: 'Bar2 ' + Date.now().toString().slice(-6) });
  await speed(page);

  /**
   * ⚠️⚠️ THE EMPTY STATE IS THE ONE THAT USED TO LOSE IT. testDiagHTML returns early when there is nothing
   * recorded, and an early return that skips the bar leaves a person on a blank Speed tab with no way to write
   * anything up and no way to start again — exactly when they most want both.
   */
  await page.evaluate(() => { try { if (window.CBCALLS) window.CBCALLS.length = 0; } catch (_) {} testArea('diag'); });
  for (const id of CHIPS) {
    await expect(page.locator('[data-testid="' + id + '"]'), id + ' vanished on an empty reading').toBeVisible();
  }

  /* clearing must not take the bar with it either — that is the same early return, one press later */
  await page.locator('[data-testid="diag-clear-screen"]').click();
  await page.waitForTimeout(1500);
  for (const id of CHIPS) {
    await expect(page.locator('[data-testid="' + id + '"]'), id + ' vanished after a clear').toBeVisible();
  }
  /* ⚠️ the banner says WHICH clear it is measuring from — the word alone would pass on a stale reading */
  /**
   * ⚠️ TWO SENTENCES SAY IT, AND WHICH ONE DEPENDS ON WHETHER ANYTHING HAS BEEN MEASURED SINCE. With calls
   * recorded the figures header says "measured from the clear at"; with none, the empty state says "Cleared
   * at 19:30:53. Threw away N recorded call(s)". Asserting one of them made this spec depend on how fast the
   * page happened to make a call after the click.
   */
  await expect(page.locator('#cbcasespanel')).toContainText(/Cleared at|measured from the clear/);
});
