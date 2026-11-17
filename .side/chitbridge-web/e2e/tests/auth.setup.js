// SAVED SESSION setup — runs ONCE before the `authed` project, mints one entity, and saves its logged-in session to
// .auth/user.json. Every `authed` flow then starts already-signed-in (mintEntity short-circuits) — so re-running a single
// flow doesn't re-do onboarding. The `noauth` project (onboarding/flow/redproof) and the multi-party contexts start fresh.
// NOTE: lives under tests/ so the `setup` project (testDir './tests') actually discovers it.
const { test, expect } = require('@playwright/test');
const { mintEntity } = require('../fixtures');

const AUTH_FILE = '.auth/user.json';

test('authenticate — mint the shared session', async ({ page }) => {
  await mintEntity(page);
  await expect(page).toHaveURL(/#\/app/);
  /**
   * ⚠️ DROP `cb_vp` BEFORE SAVING — it is a VIEWPORT preference, and saving one into a shared session makes every
   * project boot in whatever layout the setup run happened to land in, regardless of the viewport it declares.
   *
   * app.html reads `lsGet('cb_vp', innerWidth <= 820 ? 'mob' : 'lap')`, so a stored value BEATS the width test.
   * A stored 'mob' put the whole nav behind a closed drawer at 1366×768 — `.appwrap.m .menu` is
   * translateX(-100%) — and KBD-01/KBD-02 failed with "element is outside of the viewport" clicking nav-compose,
   * on firefox and webkit but not the 1920 chromium project. That reads as browser-specific flake and is nothing
   * of the kind; it is one saved key. Any spec reusing this state inherits it, so the failures land on whatever
   * was changed that day and look like its fault.
   *
   * ⚠️ THIS ONLY FIXES THE TESTS. The product bug is that a real user's stored 'mob' also survives onto a desktop
   * — backlog 35. Do not read a green suite as that being handled.
   */
  await page.evaluate(() => { try { localStorage.removeItem('cb_vp'); } catch (_) {} });
  await page.context().storageState({ path: AUTH_FILE });
});
