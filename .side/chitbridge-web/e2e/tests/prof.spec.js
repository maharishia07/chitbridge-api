// MODULE: Profile round trips — the reads it costs to paint.
// FLOW: open the profile on a WARM /me (the common path) and count what still goes to the network.
// LOCATORS: nav-profile · iam-sec-regional
const { test, expect } = require('@playwright/test');
const { mintEntity, openAvatarItem } = require('../fixtures');

test.describe('Module · Profile reads', () => {
  /**
   * ⭐⭐ Athi, 2026-08-20: *"Just to bring the profile, are we looping or all gets in a single read?"*
   *
   * ⚠️⚠️ THE COLLAPSE ONLY EVER RAN ON THE COLD PATH. loadProfile() fetches /me with
   * ?include=readiness,channels,vault and seeds the sub-loaders' latches from the response — but only after
   * meTake(). /me is PREFETCHED at sign-in, so by the time anyone opens Profile `UI._me` is already set and an
   * early return fires first, leaving the latches unset. iamLoadTrade and iamLoadChannels then each fetched on
   * their own, from inside the RENDERER rather than any mount step.
   *
   * ⚠️ THIS TEST IS THE MEASUREMENT THAT WAS MISSING. screen-reads.cjs is STATIC — it counts reads on code
   * paths and would not have seen this, because both paths exist in the source and only one of them runs.
   */
  test('[PROF-01] a warm profile open does not re-fetch what /me already carried', async ({ page }) => {
    test.setTimeout(180000);
    await mintEntity(page);
    /* Let the sign-in prefetch land, so this is the WARM path — the one people actually take. */
    await page.waitForTimeout(4000);

    const seen = [];
    page.on('request', (r) => {
      const u = r.url();
      if (u.indexOf('/api/') >= 0) seen.push(u.split('/api/')[1].split('?')[0]);
    });

    await openAvatarItem(page, 'nav-profile');
    /* Wait for a control that only exists once the profile has actually painted. */
    await page.getByTestId('iam-sec-regional').waitFor({ timeout: 40000 });
    await page.waitForTimeout(5000);

    /**
     * ⚠️⚠️ BARE `UI`, NEVER `window.UI`. UI is declared with `let` at top-level script scope, which creates a
     * binding in the global LEXICAL environment — reachable by name from any script in the realm, but NOT a
     * property of window. Every probe written as `window.UI && UI._me` returns undefined no matter what the
     * real value is, and then reports it as "the profile did not paint". guard-static warns about exactly this
     * class ("no spec reads or writes a let/const global off window").
     */
    const state = await page.evaluate(() => ({
      hasMe: !!UI._me,
      included: (UI._me && UI._me.included) ? Object.keys(UI._me.included) : [],
      rdLatched: !!UI._rdSumLoaded,
      chansLatched: !!UI._chansLoaded,
      nav: UI.nav,
    }));
    /* If this is not the warm path the measurement below means nothing — say so rather than pass vacuously. */
    expect(state.hasMe, 'the profile must have painted from /me: ' + JSON.stringify(state)).toBeTruthy();

    const readiness = seen.filter((u) => u.indexOf('governance/readiness') === 0).length;
    const channels = seen.filter((u) => u.indexOf('channels') === 0).length;

    /* ⭐ THE ASSERTION. Both of these came back in the /me the app already had. */
    expect(readiness, 'readiness was in ?include= and must not be fetched again: ' + seen.join(' · ')).toBe(0);
    expect(channels, 'channels was in ?include= and must not be fetched again: ' + seen.join(' · ')).toBe(0);
    expect(state.rdLatched && state.chansLatched, 'both latches must be seeded from /me').toBeTruthy();

    /* ⚠️ actors is NOT yet an include — it is still one read, and this records that honestly rather than
       pretending the screen is down to one. Making it an include needs the actor query extracted to a shared
       library function first; the /me bundle is explicit that it must not re-implement its parts. */
    const actors = seen.filter((u) => u === 'actors').length;
    expect(actors, 'actors is still a separate read — see the backlog').toBeLessThanOrEqual(1);
  });
});
