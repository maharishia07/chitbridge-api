// MODULE: LIVE CHECKS — the things shipped on 2026-08-21/22 that no guard can see.
// LOCATORS: ap-fs-* · theme-* · loc-ca · loc-pending · prof-src-toggle · icon-logout · nav-*
/**
 * ⭐⭐ THIS IS THE CHECKLIST ATHI WAS BEING ASKED TO WALK BY HAND. Everything in it was shipped on guard
 * evidence alone — render-smoke renders markup and a11y-contrast measures colour, and NEITHER looks at layout,
 * at what a control actually does, or at how many requests a screen makes.
 *
 * ⚠️⚠️ SO EACH TEST HERE ASSERTS AN EFFECT, NOT A PRESENCE. "The text size control exists" is worth nothing —
 * the question is whether the text MOVES when it is used, because 980 font-size declarations were changed on
 * the claim that they now scale, and nothing had confirmed it.
 *
 * ⚠️ WHAT IT STILL CANNOT DO is tell you whether the result looks GOOD. It can prove the type responds and that
 * nothing overflows; it cannot prove the register is right. That judgment stays human, and this narrows it to
 * one look instead of six.
 */
const { test, expect } = require('@playwright/test');
const { mintEntity, clickNav, openAvatarItem } = require('../fixtures');

/* the computed pixel size of an element, as the browser actually renders it */
const fontOf = (page, sel) => page.locator(sel).first()
  .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));

/**
 * ⭐ REACHING A SETTINGS SECTION, AND ASSERTING YOU ARRIVED.
 *
 * ⚠⚠ I BRIEFLY "FIXED" THIS INTO BEING WRONG. Reading `SET_SECS` through a truncated range showed six keys
 * and no `appearance`, so I concluded Appearance had no rail entry and routed this through a link inside
 * Governance. A probe against the live DOM says the rail carries EIGHT: work · policy · channels · governance
 * · blueprints · locale · appearance · standards. `set-sec-appearance` was there all along.
 *
 * ⚠️ READING PART OF A LIST AND CONCLUDING SOMETHING ABOUT THE WHOLE is the same mistake as a scan that
 * under-matches: both report their own blindness as a fact about the code. The probe took forty seconds and
 * settled it; three rounds of reasoning from an artefact did not.
 *
 * ⚠️ THE ARRIVAL ASSERTION STAYS — it is what turned "timeout on ap-fs-m" into "the pane did not open",
 * which is the difference between blaming a control and blaming the navigation.
 */
/**
 * ⚠️⚠️ OPEN, AND NOT A TEST BUG: A SETTINGS SECTION INTERMITTENTLY FAILS TO PAINT.
 *
 * Across two identical full runs the SAME three checks failed — but not the same three. Run one lost
 * Localisation; run two lost Appearance and kept Localisation. A locator that is wrong is wrong every time;
 * one that fails on a different section each run is reporting a RACE, not a bad selector.
 *
 * What was ruled out, each by measurement rather than by reasoning:
 *   · the rail item        — `set-sec-locale` is present, and its click does set `setSec()` to 'locale'
 *   · the renderer         — `localeSettingsHTML()` called by hand returns 52,000 characters
 *   · the dispatch         — `paintSettings` has `if (k === "locale") out = localeSettingsHTML()`
 *   · a missing dependency — locale.js is a plain synchronous script, so CBLocale is never late
 *
 * ⭐ WHAT A PERSON SEES WHEN IT HAPPENS is the part worth attention: not a blank pane and not an error, but
 * the CHIT LIST'S empty state — "Your bogie is empty · Compose" — rendered inside Settings. Someone who
 * clicked Localisation is told their rail is empty. ⚠️ `paintSettings` swallows a render throw into
 * `scrErr`, so nothing reaches the console; that is why this has never surfaced as an error report.
 *
 * ⚠️ NOT FIXED HERE. The settings screen is Athi's, the failure is intermittent, and a fix aimed at a
 * mechanism I have not identified would be a guess dressed as a repair. The checklist is left FAILING on
 * purpose — a red check that names a real race is worth more than a green one that waits it out.
 */
async function openSettingsSection(page, key, expect1) {
  await openAvatarItem(page, 'nav-settings');
  await page.getByTestId('set-sec-' + key).click();
  if (expect1) await expect(page.getByTestId(expect1), 'the ' + key + ' pane did not open').toBeVisible();
}

test.describe('Live checks · 2026-08-21/22', () => {

  /**
   * ⭐⭐ THE ONE THAT MATTERS MOST. 980 raw font sizes became `var(--fs-*)` so they would follow the reader's
   * Small/Medium/Large/Extra-large setting. Before that change roughly 43% of the type ignored it entirely.
   *
   * ⚠️ ASSERTED AS A RATIO, NOT AS PIXELS. The tokens are 11/12.5/14/16/20/28 and the multipliers 0.92/1/1.15/
   * 1.32; asserting "12.5px becomes 16.5px" would re-encode both tables in the test and fail on any tuning.
   * What must hold is that the text GROWS — the exact figure is a design decision, the response is the feature.
   */
  test('[LIVE-01] text actually resizes with the setting — the whole screen, together', async ({ page }) => {
    await mintEntity(page);
    await openAvatarItem(page, 'nav-settings');
    await openSettingsSection(page, 'appearance', 'ap-fs-m');

    const sample = '.topbar .b';   // present on every screen, and tokenised
    await page.getByTestId('ap-fs-m').click();
    const medium = await fontOf(page, sample);

    await page.getByTestId('ap-fs-xl').click();
    const xl = await fontOf(page, sample);
    expect(xl, 'Extra large must render larger than Medium').toBeGreaterThan(medium);

    await page.getByTestId('ap-fs-s').click();
    const small = await fontOf(page, sample);
    expect(small, 'Small must render smaller than Medium').toBeLessThan(medium);

    await page.getByTestId('ap-fs-m').click();
  });

  /**
   * ⚠️⚠️ THE FAILURE MODE OF THE FONT CHANGE IS OVERFLOW, AND ONLY GROWING CAN CAUSE IT. Shrinking text never
   * breaks a box; the 12px→12.5 and 13.5→14 steps do. So this looks where it would show: at the largest
   * setting, on the busiest chrome, does anything spill sideways?
   *
   * ⚠️ THE PAGE BODY, NOT AN ELEMENT. Individual wrapping is legitimate — a label taking two lines is fine. A
   * horizontal scrollbar on the document is not: it means something is wider than the screen it must fit.
   */
  test('[LIVE-02] nothing overflows sideways at Extra large', async ({ page }) => {
    await mintEntity(page);
    await openSettingsSection(page, 'appearance', 'ap-fs-m');
    await page.getByTestId('ap-fs-xl').click();

    /**
     * ⚠⚠ A SWALLOWED NAVIGATION HERE WOULD PRODUCE A FALSE GREEN, which is worse than a failure. If
     * clickNav quietly did nothing, the loop would measure the SAME screen three times and report three
     * passes — a test that claims to have checked Task, Order and Catalogue while having seen one of them.
     * So the arrival is ASSERTED, and a nav this role genuinely lacks is skipped out loud.
     */
    for (const nav of ['task', 'order', 'catalogue']) {
      const item = page.getByTestId('nav-' + nav);
      if (!(await item.isVisible().catch(() => false))) { test.info().annotations.push({ type: 'skipped', description: nav + ': not in this role’s rail' }); continue; }
      await item.click();
      await expect(item, nav + ' did not become the selected nav — the screen may not have changed').toHaveClass(/sel|on/);
      await page.waitForTimeout(400);
      const over = await page.evaluate(() =>
        document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(over, nav + ' scrolls sideways at Extra large — something is wider than the screen').toBeLessThanOrEqual(1);
    }
    await openSettingsSection(page, 'appearance', 'ap-fs-m');
    await page.getByTestId('ap-fs-m').click();
  });

  /**
   * ⭐ Athi, 2026-08-21: *"I changed to Indian calendar and the result was Sravana, but I was not aware what
   * Indian calendar means until I saw the result."* Every option must show what it would DO, and the samples
   * are generated by Intl rather than typed, so they cannot promise what the setting does not deliver.
   */
  test('[LIVE-03] every calendar option shows the date it would produce', async ({ page }) => {
    await mintEntity(page);
    await openSettingsSection(page, 'locale', 'loc-ca');
    await expect(page.getByTestId('loc-ca'), 'the Localisation pane did not open').toBeVisible();
    const opts = await page.getByTestId('loc-ca').locator('option').allTextContents();
    expect(opts.length, 'the calendar picker should offer several calendars').toBeGreaterThan(2);
    /* ⚠️ "Follow the format" has no effect of its own, so it is the one option with nothing to show. */
    const named = opts.filter((o) => !/follow the format/i.test(o));
    named.forEach((o) => expect(o, 'this option names a standard and shows nothing: ' + o).toContain('—'));
  });

  /**
   * ⭐⭐ NOTHING APPLIES UNTIL SAVE. Athi: *"what if by mistake someone changed without knowing and it will
   * reflect?"* Three things must hold together, and the third is the one that makes staging real.
   */
  test('[LIVE-04] a settings change stages, and Discard undoes it', async ({ page }) => {
    await mintEntity(page);
    await openSettingsSection(page, 'locale', 'loc-ca');

    await expect(page.getByTestId('loc-ca'), 'the Localisation pane did not open').toBeVisible();
    await page.getByTestId('loc-ca').selectOption('indian');
    await expect(page.getByTestId('loc-pending'),
      'choosing an option must raise the Not-saved-yet bar').toBeVisible();

    /* ⚠️ THE SAVED VALUE MUST NOT HAVE MOVED — staging that quietly writes is not staging. */
    const stored = await page.evaluate(() => localStorage.getItem('cb_ca'));
    expect(stored, 'nothing may reach storage before Save').toBeFalsy();

    await page.getByRole('button', { name: /discard/i }).click();
    await expect(page.getByTestId('loc-pending'), 'Discard must clear the bar').toHaveCount(0);
  });

  /**
   * ⭐ Athi: *"in the profile screen you can have a toggle to see the source if required."* Off by default —
   * where a value came from is a question people ask when something looks wrong, not on every visit.
   */
  test('[LIVE-05] the profile source marks are off until asked for', async ({ page }) => {
    await mintEntity(page);
    await openAvatarItem(page, 'nav-profile');
    /* ⚠️ THE TOGGLE LIVES IN THE REGIONAL SECTION, AND THE SECTIONS ARE COLLAPSED BY DEFAULT — only `ident`
       opens itself. iamSection omits a closed section's BODY entirely, so the control is not merely hidden, it
       is absent from the DOM. A spec that assumed otherwise fails as "element not found", which reads like a
       missing feature rather than an unopened drawer. */
    await page.getByTestId('iam-sec-regional').click();
    const toggle = page.getByTestId('prof-src-toggle');
    await expect(toggle).toBeVisible();
    await expect(toggle, 'it should offer to SHOW them, i.e. they start hidden').toContainText(/show/i);
    await toggle.click();
    await expect(toggle, 'and then offer to hide them').toContainText(/hide/i);
    /* ⚠️ CASE-INSENSITIVE, BECAUSE THE UPPERCASE IS CSS. The mark renders as `Business` in the DOM and is
       displayed as BUSINESS by `text-transform:uppercase`. Asserting the SCREEN's case tests the stylesheet,
       not the content — and fails with "element not found", which reads as a missing feature. */
    await expect(page.getByText(/^business$/i).first(),
      'a source mark should now be on screen').toBeVisible();
  });

  /**
   * ⭐⭐ THE PROFILE IN ONE REQUEST. It used to make four: /entities/me, /governance/readiness, /channels and
   * /governance/profile. `?include=` collapsed them, and `meNow()` reuses the request started at sign-in.
   *
   * ⚠️ COUNTED AT THE NETWORK, NOT IN THE SOURCE. A static scan already claims this; only the browser can say
   * whether the latches actually suppress the other three at runtime.
   */
  test('[LIVE-06] the profile paints from one request, not four', async ({ page }) => {
    await mintEntity(page);
    const seen = [];
    page.on('request', (r) => {
      const u = r.url();
      if (/\/api\/(entities\/me|governance\/readiness|channels|governance\/profile)/.test(u)) seen.push(u);
    });
    await openAvatarItem(page, 'nav-profile');
    await page.waitForTimeout(2500);
    expect(seen.length, 'the profile should need one request, not four:\n  ' + seen.join('\n  '))
      .toBeLessThanOrEqual(2);   // one, with a little room for a legitimate re-read
  });

  /**
   * ⚠️ Athi photographed this: on a 393px screen the topbar pushed Sign out off the edge. It is hidden on
   * mobile now BECAUSE IT IS A DUPLICATE — the avatar menu carries the same action — so the assertion is that
   * a way out of the app exists, not that this particular button does.
   */
  test('[LIVE-07] on a phone, there is still a way to sign out', async ({ page }) => {
    await page.setViewportSize({ width: 393, height: 851 });
    await mintEntity(page);
    const bar = await page.locator('.topbar').boundingBox();
    const avatar = await page.locator('.topbar .who .av').first().boundingBox();
    expect(avatar, 'the avatar must be on screen').toBeTruthy();
    expect(avatar.x + avatar.width,
      'the avatar menu — which holds Sign out — is pushed off the right edge').toBeLessThanOrEqual(bar.x + bar.width + 1);
    await page.locator('.topbar .who .av').first().click();
    await expect(page.getByText(/sign out/i).first(),
      'the avatar menu must offer Sign out').toBeVisible();
  });

  /**
   * ⭐⭐ THE 20-SECOND TICK MUST BE SILENT WHEN NOTHING CHANGED. `/chits/pulse` returns a watermark; the list is
   * fetched only when it moves. On an idle screen the pulse should fire and the list should not.
   *
   * ⚠️ THE WINDOW IS DELIBERATELY LONGER THAN ONE TICK. Watching for a single interval would pass by luck if
   * the timer happened to land outside it; two ticks means a list fetch has had two chances to appear.
   */
  test('[LIVE-08] an idle list polls the pulse, not the list', async ({ page }) => {
    /**
     * ⚠️ THIS CHECK HAS TO SIT AND WAIT, and its own budget was the thing that failed. The poll ticks every 20
     * seconds, so watching it needs three quarters of a minute of doing nothing — past the 60s default, which
     * reported "Test timeout exceeded" and read like a broken poll rather than a short stopwatch.
     */
    test.setTimeout(120000);
    await mintEntity(page);
    await clickNav(page, 'task');
    /**
     * ⚠️⚠️ WAIT FOR STARTUP TO FINISH BEFORE COUNTING — 3 SECONDS WAS NOT ENOUGH AND THE CHECK BLAMED THE POLL.
     * It reported 3–4 list reads on an idle screen and read like a broken optimisation. It was not: tracing the
     * watermark over four ticks returned "0.0.0.0" every time, so the pulse never moved and the gate never
     * opened. The reads came from `_renderApp`, which calls `loadList()` on every render while nav is a list
     * track — and startup renders several times as its once-per-session probes land (capabilities, helpdesk,
     * folders), each one a `bgRenderApp`.
     *
     * ⭐ SO THE WINDOW WAS THE BUG. Counting from t+3s caught the tail of app start and attributed it to the
     * 20-second poll. This waits for the renders to stop, THEN measures.
     */
    await page.waitForTimeout(12000);

    let pulses = 0, lists = 0;
    page.on('request', (r) => {
      const u = r.url();
      if (/\/api\/chits\/pulse/.test(u)) pulses++;
      else if (/\/api\/chits\/(inbox|sent)/.test(u)) lists++;
    });
    await page.waitForTimeout(45000);   // two 20s ticks, with room

    expect(pulses, 'the pulse should be asked at least once in 45s').toBeGreaterThan(0);
    expect(lists, 'nothing changed, so the list should not have been re-read (' + lists + ' fetches)')
      .toBeLessThanOrEqual(1);
  });
});
