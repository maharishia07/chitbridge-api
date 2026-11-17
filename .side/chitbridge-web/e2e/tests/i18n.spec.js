// i18n.spec.js — the string registry: does choosing a language actually change what the app says?
//
// Athi, 2026-08-16: *"each icon we have to change the language — if french is using then all the icon should show
// french. If the icon text is hardcoded, we need to make it language friendly."*
//
// ⚠️ SCOPE, STATED HONESTLY: the RAIL is translated and the rest of the app is not. This spec asserts exactly
// that and no more. A test that implied full coverage would be the same lie as a picker that implies it.

const { test, expect } = require('@playwright/test');
const { mintEntity } = require('../fixtures');

test.describe('i18n · the rail speaks the chosen language', () => {
  test.describe.configure({ timeout: 150_000 });

  /**
   * ⚠️ THIS ASSERTS THE DIRECTION THAT SHOWS ON SCREEN, and my first version had it backwards.
   *
   * I first failed the run when a registry key had no rail item — and it flagged `nav.disputes`, which is a
   * CONDITIONALLY RENDERED item, not a dead key. A rail is not a fixed list: entries appear with a capability,
   * a role or a folder, so "every translation must have a visible item" is false by construction and the test
   * was reporting its own wrong premise as a defect.
   *
   * The failure a user actually meets is the opposite one: an item IS on screen and has no translation, so it
   * stays English in the middle of a Tamil rail. Orphans are only tidiness — reported, never failed, because a
   * red build for an unused string teaches people to ignore the colour.
   */
  test('[I18N-01] nothing on the rail is left untranslated in a registered language', async ({ page }) => {
    await mintEntity(page);
    const report = await page.evaluate(() => {
      const reg = window.CBI18N || {};
      const langs = Object.keys(reg).filter((l) => l !== 'en');
      const railKeys = [...document.querySelectorAll('.menu [data-testid^="nav-"]')]
        .map((b) => 'nav.' + b.getAttribute('data-testid').replace(/^nav-/, ''))
        // sub-items (a folder, "new folder") are data, not chrome — they are the user's own words
        .filter((k) => !/^nav\.newfolder/.test(k));
      const missing = {}, orphans = {};
      langs.forEach((l) => {
        const gaps = railKeys.filter((k) => !reg[l][k]);
        if (gaps.length) missing[l] = gaps;
        const extra = Object.keys(reg[l]).filter((k) => k.startsWith('nav.') && railKeys.indexOf(k) < 0);
        if (extra.length) orphans[l] = extra;
      });
      return { langs, railKeys, missing, orphans };
    });
    expect(report.langs.length, 'more than English must be registered').toBeGreaterThan(0);
    expect(report.railKeys.length, 'the rail must have rendered').toBeGreaterThan(4);
    if (Object.keys(report.orphans).length) {
      console.log('NOTE · translations with no rail item on this account (usually conditional items): '
        + JSON.stringify(report.orphans));
    }
    expect(report.missing, 'every rail item on screen must have a translation in each registered language')
      .toEqual({});
  });

  test('[I18N-02] ⭐ switching to Tamil changes the rail, and back to English restores it', async ({ page }) => {
    await mintEntity(page);
    const railText = () => page.evaluate(() =>
      [...document.querySelectorAll('.menu [data-testid^="nav-"]')].map((b) => b.textContent.trim()).join(' | '));

    const before = await railText();
    expect(before, 'the rail must render before we can test it changing').toContain('Catalogue');

    await page.evaluate(() => window.cbSetLang('ta'));
    await page.waitForTimeout(700);
    const ta = await railText();
    expect(ta, 'the Tamil rail must not read the same as the English one').not.toEqual(before);
    expect(ta, 'Catalogue must render in Tamil').toContain('பட்டியல்');

    await page.evaluate(() => window.cbSetLang('en'));
    await page.waitForTimeout(700);
    expect(await railText(), 'switching back must restore English exactly').toEqual(before);
  });

  test('[I18N-03] an unknown language falls back to English rather than blanking the rail', async ({ page }) => {
    await mintEntity(page);
    const before = await page.evaluate(() =>
      [...document.querySelectorAll('.menu [data-testid^="nav-"]')].map((b) => b.textContent.trim()).join(' | '));
    /* ⚠️ Written straight to storage, bypassing cbSetLang's guard — because the value that will actually appear
       here one day is a stale one saved by an older build, not one a picker offered. */
    await page.evaluate(() => { try { localStorage.setItem('cb_lang', 'xx'); } catch (_) {} });
    await page.reload();
    await page.waitForTimeout(2500);
    const after = await page.evaluate(() =>
      [...document.querySelectorAll('.menu [data-testid^="nav-"]')].map((b) => b.textContent.trim()).join(' | '));
    expect(after, 'an unknown language must degrade to English, never to blanks or key names').toEqual(before);
    expect(after, 'a raw key must never reach the screen').not.toContain('nav.');
    await page.evaluate(() => { try { localStorage.removeItem('cb_lang'); } catch (_) {} });
  });

  test('[I18N-04] the picker is beside the theme, and says what is still English', async ({ page }) => {
    await mintEntity(page);
    await page.getByTestId('icon-avatar').click();
    /* INTEGRATION (CBAvatar, the frozen menu): the theme swatches and the language buttons are always shown in the menu - there is no Theme / Language section to open (avsec-theme / avsec-lang are gone) and no theme-picker box; the group is the 'Theme' group inside avatar-menu. */
    await expect(page.getByTestId('avatar-menu').getByRole('group', { name: 'Theme' }), 'the palette is beside the language picker').toBeVisible();
    await expect(page.getByTestId('lang-picker'), 'the language picker is in the menu').toBeVisible();
    const body = await page.getByTestId('lang-picker').locator('..').textContent();
    /* ⚠️ The honesty note is part of the feature. Four language buttons imply the app speaks four; it does not
       yet, and letting it imply otherwise is how someone switches to Tamil, sees English, and reports a bug. */
    expect(body, 'the picker must say the rest of the app is still English').toMatch(/still English/i);
  });
});
