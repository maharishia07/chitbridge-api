// locale-sync.spec.js — b165: does the reader's choice actually follow the PERSON?
//
// ⚠️ THIS IS THE ONLY TEST THAT CAN PROVE b165, because the whole feature is about what happens on a device the
// person has never used. Everything else about localisation can be checked in one browser; "your language
// follows you" cannot. So this test deliberately DESTROYS local state and reloads — that erasure is the
// experiment, not a side effect of it.
//
// ⚠️⚠️ IT WRITES TO THE SHARED ACCOUNT, AND THAT IS WHY EVERY PATH RESTORES. In the `authed` project mintEntity
// reuses one long-lived entity, so a locale left behind here would re-format money and dates for every spec that
// runs afterwards — and those specs would fail somewhere else entirely, with no clue pointing back here. The
// restore lives in `finally` so it also runs when an assertion throws, which is exactly when a half-applied
// change would otherwise be left lying around.

const { test, expect } = require('@playwright/test');
const { mintEntity } = require('../fixtures');

const KEYS = ['cb_locale', 'cb_lang', 'cb_nu', 'cb_hc', 'cb_ca', 'cb_fw'];

/** Put the account back to "nothing chosen" — both on the server and in this browser. */
const restore = async (page) => {
  await page.evaluate(async (keys) => {
    keys.forEach((k) => { try { localStorage.removeItem(k); } catch (_) {} });
    try { await window.api('savePrefs', { params: { kind: 'locale' }, body: {} }); } catch (_) {}
    try { window.CBLocale.apply(); } catch (_) {}
  }, KEYS);
};

test.describe('b165 · the localisation choice belongs to the person', () => {
  test.describe.configure({ timeout: 240_000 });

  test('[LOC-07] ⭐ the migration is live — the server stores and returns the choice', async ({ page }) => {
    await mintEntity(page);
    try {
      const saved = await page.evaluate(async () => {
        const r = await window.api('savePrefs', { params: { kind: 'locale' }, body: { locale: 'de-DE', hc: 'h23' } });
        return r || {};
      });
      /* ⚠️ THE ASSERTION THAT PROVES THE MIGRATION RAN. Before b165 the route answers {pending:true} — the local
         choice still applies, so the screen looks correct and nothing tells you the column is missing. Only the
         shape of this reply distinguishes "saved" from "silently not saved anywhere". */
      expect(saved.pending, 'b165 has run — the API is not in its pre-migration fallback').toBeFalsy();
      expect(saved.ok, 'the write was accepted').toBe(true);
      expect(saved.locale_prefs, 'and it echoes what it stored').toMatchObject({ locale: 'de-DE', hc: 'h23' });

      const back = await page.evaluate(async () => {
        const r = await window.api('me', { query: { _t: Date.now() } });
        const e = (r && r.entity) || r || {};
        return e.locale_prefs || null;
      });
      expect(back, '/me returns it on the next boot').toMatchObject({ locale: 'de-DE', hc: 'h23' });
    } finally {
      await restore(page);
    }
  });

  test('[LOC-08] ⚠️ a device that has never seen this person still shows their language', async ({ page }) => {
    await mintEntity(page);
    try {
      await page.evaluate(async () => {
        await window.api('savePrefs', { params: { kind: 'locale' }, body: { locale: 'de-DE' } });
      });

      /* ⚠️ THE NEW-DEVICE SIMULATION. Wiping these six keys leaves the browser in exactly the state a phone the
         person has never opened would be in: signed in, but with no idea who is reading. If the choice lived
         only in localStorage — which is the defect b165 closes — the reload below comes back in en-IN. */
      await page.evaluate((keys) => keys.forEach((k) => { try { localStorage.removeItem(k); } catch (_) {} }), KEYS);
      await page.reload();
      await page.getByTestId('nav-compose').waitFor({ state: 'visible', timeout: 20_000 });
      /**
       * ⚠️ POLL, DO NOT SLEEP — and the first version of this test slept 2.5s and failed for that reason alone.
       * The boot /me call has been MEASURED at ~4s against production, so hydration lands well after first paint;
       * a fixed wait shorter than that reports "the server never told this browser" when the truth is "the answer
       * had not arrived yet". A flaky-looking failure that is really a timing assumption is the worst kind,
       * because the obvious next move is to go hunting in code that was working.
       *
       * ⚠️ It also asserts something real about the design: hydration is DELIBERATELY late. The cache paints
       * first so the screen is never blank waiting on a preference, and the server only overrides when it
       * differs. Waiting for the late arrival is testing the intended behaviour, not working around it.
       */
      await page.waitForFunction(
        () => { try { return localStorage.getItem('cb_locale') === 'de-DE'; } catch (_) { return false; } },
        null, { timeout: 30_000 }
      );

      const after = await page.evaluate(() => ({
        locale: window.CBLocale.locale(),
        cached: (function () { try { return localStorage.getItem('cb_locale'); } catch (_) { return null; } })(),
        money: window.CBLocale.money(1234.5, 'EUR'),
      }));
      expect(after.locale, 'the server told this browser who is reading').toBe('de-DE');
      expect(after.cached, 'and it was written back to the local cache').toBe('de-DE');
      /* German grouping: 1.234,50 — the dot and comma swap. Proof the hydrate reached the FORMATTERS and not
         just a stored string nobody consults. */
      expect(after.money, 'and the formatters actually moved with it').toContain('1.234,50');
    } finally {
      await restore(page);
    }
  });

  test('[LOC-09] the restore path works, so the shared account is left as it was found', async ({ page }) => {
    await mintEntity(page);
    await restore(page);
    const state = await page.evaluate(async () => {
      const r = await window.api('me', { query: { _t: Date.now() } });
      const e = (r && r.entity) || r || {};
      return { prefs: e.locale_prefs, locale: window.CBLocale.locale() };
    });
    /* ⚠️ This test exists to keep the other two honest. A cleanup that quietly stopped working would leave the
       shared account in German and break unrelated specs days later, with nothing pointing back here. */
    expect(Object.keys(state.prefs || {}).length, 'the stored choice is cleared').toBe(0);
    expect(state.locale, 'and the reader is back on the platform default').toBe('en-IN');
  });
});
