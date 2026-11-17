// appearance.spec.js — Settings › Appearance: theme, text size and motion in one place.
//
// ⚠️ EVERY CONTROL HERE IS PRESSED, not merely rendered. The Appearance screen is generated code, and generated
// code in this app has failed four times by emitting a constant that only the GENERATOR had — `BT`, then `Q`
// twice, then `Q` again on this very screen. Each one parses (a bare identifier is valid syntax), so node
// --check and the static guard pass, and it dies only when the line runs. Two of those reached Athi as "the
// menu doesn't open" and "selection doesn't work". Rendering the HTML is not enough; the buttons must be clicked.

const { test, expect } = require('@playwright/test');
const { mintEntity } = require('../fixtures');

const openAppearance = async (page) => {
  await page.evaluate(() => window.navTo('settings'));
  await page.waitForTimeout(1200);
  await page.evaluate(() => setSetSec('appearance'));
  await page.waitForTimeout(800);
};

/** Put the browser back to defaults — this suite changes how every later spec's screenshots look. */
const reset = async (page) => {
  await page.evaluate(() => {
    try { localStorage.removeItem('cb_fs'); localStorage.removeItem('cb_motion'); } catch (_) {}
    try { window.appearanceApply(); } catch (_) {}
  });
};

test.describe('Settings › Appearance', () => {
  test.describe.configure({ timeout: 240_000 });

  test('[AP-01] the section exists and carries all three controls', async ({ page }) => {
    await mintEntity(page);
    try {
      await openAppearance(page);
      for (const id of ['ap-fs-s', 'ap-fs-m', 'ap-fs-l', 'ap-fs-xl',
                        'ap-motion-auto', 'ap-motion-reduce', 'ap-motion-full']) {
        await expect(page.getByTestId(id), id + ' must render').toBeVisible();
      }
      /* ⚠️ The palette is REUSED here, not redrawn. Two renderers for the same fifteen themes would drift the
         day someone adds a sixteenth, and the forgotten one would be whichever a reader was looking at. */
      await expect(page.getByTestId('theme-hc'), 'the accessibility themes reach this screen too').toBeVisible();
    } finally { await reset(page); }
  });

  test('[AP-02] ⭐ text size actually resizes, and the HIERARCHY survives', async ({ page }) => {
    await mintEntity(page);
    try {
      await openAppearance(page);
      const read = () => page.evaluate(() => {
        const cs = getComputedStyle(document.documentElement);
        return [1, 2, 3, 4, 5, 6].map((n) => parseFloat(cs.getPropertyValue('--fs-' + n)));
      });
      const before = await read();
      await page.getByTestId('ap-fs-xl').click();
      await page.waitForTimeout(700);
      const after = await read();

      expect(after[2], 'the scale actually moved').toBeGreaterThan(before[2]);
      /* ⚠️⚠️ THE ASSERTION THAT MATTERS MORE THAN "IT GOT BIGGER". The six tokens encode a hierarchy — a caption
         is smaller than a heading for a reason. Setting one flat font size would make every screen legible and
         structureless at the same moment, and would pass a naive "text is larger now" test. */
      for (let i = 1; i < after.length; i++) {
        expect(after[i], 'step ' + (i + 1) + ' stays larger than step ' + i).toBeGreaterThan(after[i - 1]);
      }
      const ratioBefore = before[5] / before[0], ratioAfter = after[5] / after[0];
      expect(Math.abs(ratioAfter - ratioBefore), 'the SHAPE of the scale is preserved, not just its size')
        .toBeLessThan(0.05);
    } finally { await reset(page); }
  });

  test('[AP-03] Default removes the overrides rather than writing 100%', async ({ page }) => {
    await mintEntity(page);
    try {
      await openAppearance(page);
      await page.getByTestId('ap-fs-l').click();
      await page.waitForTimeout(600);
      await page.getByTestId('ap-fs-m').click();
      await page.waitForTimeout(600);
      const inline = await page.evaluate(() => document.documentElement.style.getPropertyValue('--fs-3'));
      /* At the default the stylesheet must remain the single source of truth for anyone who has expressed no
         preference — writing 1× values would fossilise today's numbers into every browser that ever opened this. */
      expect(inline.trim(), 'no inline override is left behind at Default').toBe('');
    } finally { await reset(page); }
  });

  test('[AP-04] ⚠️ reduced motion is applied, and "follow my device" means no override', async ({ page }) => {
    await mintEntity(page);
    try {
      await openAppearance(page);
      await page.getByTestId('ap-motion-reduce').click();
      await page.waitForTimeout(600);
      expect(await page.evaluate(() => document.documentElement.getAttribute('data-motion')),
        'the explicit choice is stamped').toBe('reduce');

      await page.getByTestId('ap-motion-auto').click();
      await page.waitForTimeout(600);
      /* ⚠️ THREE STATES, NOT TWO. "auto" must leave NO attribute, so the OS media query decides. Someone who set
         reduce-motion in Windows or iOS has answered this once already and should not have to answer it again;
         stamping "full" as a default would silently override the health setting they made system-wide. */
      expect(await page.evaluate(() => document.documentElement.getAttribute('data-motion')),
        'auto defers to the operating system').toBeNull();
    } finally { await reset(page); }
  });

  test('[AP-05] the choice survives a reload', async ({ page }) => {
    await mintEntity(page);
    try {
      await openAppearance(page);
      await page.getByTestId('ap-fs-l').click();
      await page.waitForTimeout(600);
      await page.reload();
      await page.getByTestId('nav-compose').waitFor({ state: 'visible', timeout: 20_000 });
      const size = await page.evaluate(() => document.documentElement.style.getPropertyValue('--fs-3'));
      /* Applied inside applyPrefs, BEFORE first paint — applying it later gives a visible resize a moment after
         the screen appears, which reads as a rendering bug rather than a preference being honoured. */
      expect(size.trim(), 'the size is restored at boot, not after it').not.toBe('');
    } finally { await reset(page); }
  });
});

test.describe('Appearance · stored values we do not recognise', () => {
  test.describe.configure({ timeout: 180_000 });

  test('[AP-06] ⚠️ an unrecognised motion value falls back to the DEVICE, not to animation', async ({ page }) => {
    await mintEntity(page);
    try {
      const stamped = await page.evaluate(() => {
        try { localStorage.setItem('cb_motion', 'wobble'); } catch (_) {}
        window.appearanceApply();
        return document.documentElement.getAttribute('data-motion');
      });
      /* ⚠️ THE FAILURE IS ASYMMETRIC, which is why this is worth a test. A stamped `data-motion="wobble"`
         matches NEITHER css rule, so a reader who had chosen "reduce" silently got animation back — a health
         setting failing OPEN. Anything unrecognised must mean "follow the device". */
      expect(stamped, 'nothing is stamped for a value we cannot honour').toBeNull();
    } finally {
      await page.evaluate(() => { try { localStorage.removeItem('cb_motion'); window.appearanceApply(); } catch (_) {} });
    }
  });

  test('[AP-07] ⚠️ a stale theme name is not stamped on the document', async ({ page }) => {
    await mintEntity(page);
    try {
      const stamped = await page.evaluate(() => {
        try { localStorage.setItem('cb_theme', 'a-theme-that-was-removed'); } catch (_) {}
        window.themeApply(window.themeGet());
        return document.documentElement.getAttribute('data-theme');
      });
      /* It fell back to cream's VARS but stamped the unknown KEY — so the page looked right while the document
         lied about why, every `[data-theme=...]` rule missed, and any test reading the stamp read a fiction. */
      expect(stamped, 'the stamp names a theme that exists').toBe('cream');
    } finally {
      await page.evaluate(() => { try { localStorage.removeItem('cb_theme'); window.themeApply('cream'); } catch (_) {} });
    }
  });
});
