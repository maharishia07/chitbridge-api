// theme-picker.spec.js — does clicking a theme actually change the theme?
//
// ⚠️ WHY THIS EXISTS: the palette shipped broken twice in one sitting and every existing spec stayed green.
//   · the menu threw `BT is not defined` and never opened — caught only as "a menu item is missing"
//   · then the cards emitted `themeSet('" + k + "')` LITERALLY, so every swatch called themeSet with a garbage
//     string, themeSet found no such theme and returned early. A dead button that looked designed.
//
// Both were reachable by CLICKING ONE SWATCH. theme-contrast measures themes by calling themeApply() directly,
// which is exactly the path a user never takes — so it proved the palettes are legible while the control that
// selects them did nothing.

const { test, expect } = require('@playwright/test');
const { mintEntity } = require('../fixtures');

test.describe('Theme picker · the control, not the palette', () => {
  test.describe.configure({ timeout: 150_000 });

  test('[THP-01] ⭐ clicking a theme card applies that theme', async ({ page }) => {
    await mintEntity(page);
    await page.getByTestId('icon-avatar').click();
    /* INTEGRATION (CBAvatar, the frozen menu): the theme swatches and the language buttons are always shown in the menu - there is no Theme / Language section to open (avsec-theme / avsec-lang are gone) and no theme-picker box; the group is the 'Theme' group inside avatar-menu. */
    await expect(page.getByTestId('avatar-menu').getByRole('group', { name: 'Theme' }), 'the palette is in the menu').toBeVisible();

    const before = await page.evaluate(() => ({
      attr: document.documentElement.getAttribute('data-theme'),
      paper: getComputedStyle(document.documentElement).getPropertyValue('--paper').trim(),
    }));

    await page.getByTestId('theme-dark').click();
    await page.waitForTimeout(600);

    const after = await page.evaluate(() => ({
      attr: document.documentElement.getAttribute('data-theme'),
      paper: getComputedStyle(document.documentElement).getPropertyValue('--paper').trim(),
      stored: (() => { try { return localStorage.getItem('cb_theme'); } catch (_) { return null; } })(),
    }));

    expect(after.attr, 'the root must carry the chosen theme').toBe('dark');
    /* ⚠️ THE TOKEN, NOT JUST THE ATTRIBUTE. `data-theme` is a label; --paper actually moving is the theme being
       APPLIED. A themeSet that set the attribute and failed to write the variables would pass on the attribute
       alone, and the screen would not change — which is precisely the symptom being tested for. */
    expect(after.paper, 'the tokens must actually move, not just the attribute').not.toBe(before.paper);
    expect(after.stored, 'the choice must persist').toBe('dark');
  });

  test('[THP-02] the choice survives a reload', async ({ page }) => {
    await mintEntity(page);
    await page.getByTestId('icon-avatar').click();
    await page.getByTestId('theme-slate').click();
    await page.waitForTimeout(500);
    await page.reload();
    await page.waitForTimeout(2500);
    expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme')),
      'a theme chosen is a theme kept').toBe('slate');
    // leave the shared account as we found it
    await page.evaluate(() => window.themeSet && window.themeSet('cream'));
  });

  test('[THP-03] every registered theme has a card, and each card is clickable', async ({ page }) => {
    await mintEntity(page);
    await page.getByTestId('icon-avatar').click();
    const keys = await page.evaluate(() => Object.keys(window.THEMES || {}));
    expect(keys.length, 'themes must be readable').toBeGreaterThan(3);
    for (const k of keys) {
      /* ⚠️ ENABLED, not merely present. `all:unset` on a button — which the first palette used — strips enough
         that it is worth asserting the thing can still be pressed rather than only that it is drawn. */
      await expect(page.getByTestId('theme-' + k), 'a card for ' + k).toBeEnabled();
    }
  });
});
