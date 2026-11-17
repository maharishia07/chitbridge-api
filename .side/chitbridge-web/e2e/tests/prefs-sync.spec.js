// prefs-sync.spec.js — b166: does the LOOK follow the person, the way the language does?
//
// ⚠️ Same shape as locale-sync.spec.js and for the same reason: the whole feature is about a device the person
// has never opened, so the test has to DESTROY local state and reload. That erasure is the experiment.
//
// ⚠️⚠️ IT WRITES TO THE SHARED ACCOUNT, so every path restores in `finally`. A theme left behind here would
// repaint every later spec's screenshots and change the computed colours they assert on — and those would fail
// somewhere else entirely, with nothing pointing back to this file.

const { test, expect } = require('@playwright/test');
const { mintEntity } = require('../fixtures');

const KEYS = ['cb_theme', 'cb_fs', 'cb_motion'];

const restore = async (page) => {
  await page.evaluate(async (keys) => {
    keys.forEach((k) => { try { localStorage.removeItem(k); } catch (_) {} });
    try { await window.api('savePrefs', { params: { kind: 'ui' }, body: {} }); } catch (_) {}
    try { window.themeApply('cream'); window.appearanceApply(); } catch (_) {}
  }, KEYS);
};

test.describe('b166 · the look belongs to the person', () => {
  test.describe.configure({ timeout: 240_000 });

  test('[UI-01] ⭐ the migration is live — appearance stores and comes back', async ({ page }) => {
    await mintEntity(page);
    try {
      const saved = await page.evaluate(() =>
        window.api('savePrefs', { params: { kind: 'ui' }, body: { theme: 'hc', fs: 'l', motion: 'reduce' } }));
      /* Before b166 the route answers {pending:true} — the local choice still applies, so the screen looks
         right and nothing tells you the column is missing. Only this reply distinguishes "saved" from
         "silently not saved anywhere". */
      expect(saved.pending, 'b166 has run — not the pre-migration fallback').toBeFalsy();
      expect(saved.ok, 'the write was accepted').toBe(true);

      const back = await page.evaluate(async () => {
        const r = await window.api('me', { query: { _t: Date.now() } });
        return ((r && r.entity) || r || {}).ui_prefs || null;
      });
      expect(back, '/me returns it on the next boot').toMatchObject({ theme: 'hc', fs: 'l', motion: 'reduce' });
    } finally { await restore(page); }
  });

  test('[UI-02] ⚠️ a device that has never seen this person still shows their theme', async ({ page }) => {
    await mintEntity(page);
    try {
      await page.evaluate(() =>
        window.api('savePrefs', { params: { kind: 'ui' }, body: { theme: 'hc', fs: 'l' } }));

      /* The new-device simulation: signed in, but with no idea who is reading. If the choice lived only in
         localStorage — the defect b166 closes — the reload below comes back on the default cream theme. */
      await page.evaluate((keys) => keys.forEach((k) => { try { localStorage.removeItem(k); } catch (_) {} }), KEYS);
      await page.reload();
      await page.getByTestId('nav-compose').waitFor({ state: 'visible', timeout: 20_000 });
      /* Poll, do not sleep — the boot /me call is measured at ~4s, and hydration is DELIBERATELY late so the
         cache paints first and the screen is never blank waiting on a preference. */
      await page.waitForFunction(
        () => document.documentElement.getAttribute('data-theme') === 'hc',
        null, { timeout: 30_000 }
      );

      const after = await page.evaluate(() => ({
        theme: document.documentElement.getAttribute('data-theme'),
        ink: getComputedStyle(document.documentElement).getPropertyValue('--ink').trim(),
        fs: (function () { try { return localStorage.getItem('cb_fs'); } catch (_) { return null; } })(),
      }));
      expect(after.theme, 'the server told this browser who is reading').toBe('hc');
      /* ⚠️ NOT JUST THE ATTRIBUTE — the TOKENS. A hydrate that stamped data-theme without calling themeApply
         would pass an attribute check and leave the reader on the old palette, which is the failure that
         actually matters to someone who needs 7:1. */
      expect(after.ink.toLowerCase(), 'and the palette actually repainted').toBe('#000000');
      expect(after.fs, 'text size travelled too').toBe('l');
    } finally { await restore(page); }
  });

  test('[UI-03] changing a theme in the UI syncs it, without being asked to', async ({ page }) => {
    await mintEntity(page);
    try {
      await page.evaluate(() => window.themeSet('calm'));
      /* The push is debounced at 400ms and fire-and-forget — the setting has already applied locally, so
         nothing on screen depends on this landing. Poll the server rather than assuming a timing. */
      await expect.poll(async () => page.evaluate(async () => {
        const r = await window.api('me', { query: { _t: Date.now() } });
        return (((r && r.entity) || r || {}).ui_prefs || {}).theme || null;
      }), { timeout: 25_000, intervals: [1500] }).toBe('calm');
    } finally { await restore(page); }
  });

  test('[UI-04] the two preference sets are independent', async ({ page }) => {
    await mintEntity(page);
    try {
      await page.evaluate(async () => {
        await window.api('savePrefs', { params: { kind: 'ui' }, body: { theme: 'calm' } });
        await window.api('savePrefs', { params: { kind: 'locale' }, body: { locale: 'de-DE' } });
      });
      const both = await page.evaluate(async () => {
        const r = await window.api('me', { query: { _t: Date.now() } });
        const e = (r && r.entity) || r || {};
        return { ui: e.ui_prefs, loc: e.locale_prefs };
      });
      /* ⚠️ ONE HANDLER SERVES BOTH, so the failure to guard against is a shared code path writing one set into
         the other's column — which would be invisible until someone's language silently became a theme. */
      expect(both.ui, 'the appearance set holds only appearance').toMatchObject({ theme: 'calm' });
      expect(both.ui.locale, 'and no locale leaked into it').toBeUndefined();
      expect(both.loc, 'the locale set holds only locale').toMatchObject({ locale: 'de-DE' });
      expect(both.loc.theme, 'and no theme leaked into it').toBeUndefined();
    } finally {
      await restore(page);
      await page.evaluate(() => window.api('savePrefs', { params: { kind: 'locale' }, body: {} }).catch(() => {}));
    }
  });

  test('[UI-05] an unknown preference set is refused, and a bad value with it', async ({ page }) => {
    await mintEntity(page);
    const out = await page.evaluate(async () => {
      const grab = async (fn) => { try { await fn(); return 'accepted'; } catch (e) { return String(e && e.message || e); } };
      return {
        badKind: await grab(() => window.api('savePrefs', { params: { kind: 'sql' }, body: { theme: 'hc' } })),
        badValue: await grab(() => window.api('savePrefs', { params: { kind: 'ui' }, body: { motion: 'wobble' } })),
      };
    });
    /* ⚠️ :kind SELECTS A COLUMN NAME. If it were ever interpolated into SQL rather than used to look one up,
       this is the test that would have noticed — an unknown kind must be a refusal, never a query. */
    expect(out.badKind, 'an unknown set is refused').not.toBe('accepted');
    expect(out.badValue, 'and an unknown motion value with it').not.toBe('accepted');
  });
});
