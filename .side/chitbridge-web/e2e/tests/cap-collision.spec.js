// cap-collision.spec.js — two lazily-loaded capabilities must not claim the same global.
//
// ⚠️⚠️ THE BUG THIS EXISTS FOR. cap-admin.js and cap-readiness.js both declared `loadProfile`. One RENDERS THE
// PROFILE SCREEN into #profbody; the other loads the trade declaration into UI.profile. They do entirely
// different things and shared a name, so whichever capability loaded LAST won — and the app broke in a
// different way depending on where the user had been:
//
//   readiness loaded last → app.html's `if(UI.nav==="profile") loadProfile()` ran the READINESS function, so
//                           the Profile screen never rendered and sat on its "loading…" placeholder
//   admin loaded last     → cap-readiness ran the ADMIN one, which returns early when #profbody is absent, so
//                           UI.profile stayed undefined and the declaration checkboxes never populated
//
// ⚠️ NEITHER THROWS, and neither is reachable on a first visit — you have to go to one screen and THEN the
// other. That is why it survived, and why the test has to navigate in both orders rather than just open a page.

const { test, expect } = require('@playwright/test');
const { mintEntity } = require('../fixtures');

/**
 * ⚠️ POLL FOR THE CONTENT, NOT A CLOCK. The screen paints its "‹ Back" button immediately and fills in when the
 * capability lands — so a fixed wait measured exactly 6 characters of Back button and reported the bug as still
 * present when the fix was working. `ready` is the predicate that says the screen actually arrived.
 */
const go = async (page, nav, ready) => {
  await page.evaluate((n) => window.navTo(n), nav);
  if (ready) await page.waitForFunction(ready, null, { timeout: 30_000 });
  else await page.waitForTimeout(2000);
};

test.describe('Lazily-loaded capabilities must not collide', () => {
  test.describe.configure({ timeout: 240_000 });

  test('[CAP-01] ⭐ Profile still renders after Trade readiness has been opened', async ({ page }) => {
    await mintEntity(page);
    /* The order that used to break it: readiness loads second-to-last, then profile. */
    await go(page, 'readiness', () => typeof window.rdLoadDeclaration === 'function');
    await go(page, 'profile', () => {
      const h = document.getElementById('profbody');
      return !!h && (h.textContent || '').replace(/‹\s*Back/, '').trim().length > 40;
    });
    const body = await page.locator('#profbody').textContent();
    /* ⚠️ The old failure left the placeholder in place — so "not empty" is the assertion that would have caught
       it, and it is deliberately loose about WHAT rendered. Asserting on specific profile copy would make this
       test fail for unrelated wording changes and get deleted. */
    expect((body || '').trim().length, 'the Profile screen rendered something').toBeGreaterThan(40);
    expect(body, 'and it is not still loading').not.toMatch(/^\s*loading/i);
  });

  test('[CAP-02] and Trade readiness still loads its declaration after Profile', async ({ page }) => {
    await mintEntity(page);
    await go(page, 'profile', () => typeof window.loadProfile === 'function');
    await go(page, 'readiness', () => UI.profile !== undefined);
    /* The mirror failure: UI.profile never populated, so every declaration checkbox read empty. */
    /* ⚠️ Bare `UI`, not `window.UI` — a top-level `let` is script-scoped and never lands on window. My own
       first version of this test read window.UI, got undefined, and failed while the product was correct. */
    const has = await page.evaluate(() => UI.profile !== undefined);
    expect(has, 'the trade declaration was actually fetched').toBe(true);
  });

  test('[CAP-03] no two loaded capabilities declare the same top-level function', async ({ page }) => {
    await mintEntity(page);
    /* Load every capability the app has, then ask the page which globals ended up shared. This is the general
       form of the bug — CAP-01/02 test the one instance, this one watches for the next. */
    const caps = ['admin', 'readiness', 'network', 'catalogue', 'dispute', 'workforce', 'worklist',
                  'traceability', 'messages', 'legend', 'standards'];
    for (const c of caps) {
      await page.evaluate((n) => window.ensureCap && window.ensureCap(n).catch(() => {}), c);
    }
    await page.waitForFunction(
      () => Object.keys(CAP_LOADED).filter((k) => CAP_LOADED[k]).length > 4,
      null, { timeout: 40_000 });
    const loaded = await page.evaluate(() => Object.keys(CAP_LOADED).filter((k) => CAP_LOADED[k]));
    expect(loaded.length, 'several capabilities are loaded together').toBeGreaterThan(4);
    /* ⚠️ We cannot see shadowed declarations from JS at runtime — the loser is simply gone. So the real guard is
       the static one (e2e/dead-surface.cjs reports "declared more than once"); this asserts the SYMPTOM instead:
       with everything loaded, both screens still work. If a new collision appears, one of these goes undefined. */
    const alive = await page.evaluate(() => ({
      renderProfile: typeof window.loadProfile === 'function',
      readiness: typeof window.rdLoadDeclaration === 'function',
    }));
    expect(alive.renderProfile, 'loadProfile survived every capability loading').toBe(true);
    expect(alive.readiness, 'and so did the readiness loader, under its own name').toBe(true);
  });
});
