// a11y-theme.spec.js — the accessibility themes, and the promise their cards make.
//
// ⚠️ e2e/a11y-contrast.cjs already proves the COLOUR MATHS holds for all 15 themes. This spec proves the other
// half, which maths cannot reach: that the themes are reachable, that clicking one actually repaints, and that
// the card says out loud who it is for and which standard it meets. Athi asked for exactly that — *"can we
// build theme related to special needs so it can be spelt loud and clear?"* — and a theme that is measured but
// unfindable, or findable but unexplained, has not answered it.

const { test, expect } = require('@playwright/test');
const { mintEntity } = require('../fixtures');

test.describe('Accessibility themes · spelt out and measured', () => {
  test.describe.configure({ timeout: 180_000 });

  test('[A11Y-01] all five render, each naming who it is for and its standard', async ({ page }) => {
    await mintEntity(page);
    const seen = await page.evaluate(() => {
      const T = window.THEMES || {};
      return Object.keys(T).filter((k) => T[k].a11y).map((k) => ({
        key: k, level: T[k].a11y.level, forWho: T[k].a11y.forWho, standard: T[k].a11y.standard, says: T[k].a11y.says,
      }));
    });
    expect(seen.length, 'five accessibility themes').toBe(5);
    /* ⚠️ Every field is load-bearing on the card. A theme declaring a level but no `forWho` renders a badge over
       an empty line — measured, and still telling the reader nothing. */
    for (const t of seen) {
      expect(t.level, t.key + ' declares a level').toMatch(/^AAA?$/);
      expect((t.forWho || '').length, t.key + ' names who it is for').toBeGreaterThan(3);
      expect((t.standard || '').length, t.key + ' names its standard').toBeGreaterThan(3);
      expect((t.says || '').length, t.key + ' says what it does').toBeGreaterThan(10);
    }
  });

  test('[A11Y-02] ⭐ choosing High Contrast actually repaints the page', async ({ page }) => {
    await mintEntity(page);
    const before = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--ink').trim());
    await page.evaluate(() => window.themeSet('hc'));
    await page.waitForTimeout(400);
    const after = await page.evaluate(() => ({
      ink: getComputedStyle(document.documentElement).getPropertyValue('--ink').trim(),
      attr: document.documentElement.getAttribute('data-theme'),
    }));
    /* ⚠️ THIS IS THE CLASS THAT SHIPPED TWICE. A mangled onclick left every swatch calling themeSet with a
       garbage string — it looked like a dead button and passed every parse check. Only pressing it catches it. */
    expect(after.attr, 'the theme is stamped on the document').toBe('hc');
    expect(after.ink.toLowerCase(), 'High Contrast puts ink at pure black').toBe('#000000');
    expect(after.ink, 'and that is a real change').not.toBe(before);
  });

  test('[A11Y-03] ⚠️ the dark high-contrast theme flips its paired ink to black', async ({ page }) => {
    await mintEntity(page);
    await page.evaluate(() => window.themeSet('hcdark'));
    await page.waitForTimeout(400);
    const v = await page.evaluate(() => {
      const cs = getComputedStyle(document.documentElement);
      return { onAccent: cs.getPropertyValue('--on-accent').trim(), scheme: cs.colorScheme,
               ink: cs.getPropertyValue('--ink').trim() };
    });
    /* Every accent here is LIGHT so it can clear 7:1 on black — which makes a white button label invisible.
       A theme that overrides a surface must override its partner in the same edit; this is that assertion. */
    expect(v.onAccent.toLowerCase(), 'button labels go black on the light accents').toBe('#000000');
    expect(v.ink.toLowerCase(), 'body text is white').toBe('#ffffff');
    expect(v.scheme, 'the UA is told the page is dark, so caret and scrollbars follow').toContain('dark');
  });

  test('[A11Y-04] ⭐ Colour Vision replaces the green/red pair, not the background', async ({ page }) => {
    await mintEntity(page);
    const cream = await page.evaluate(() => {
      window.themeSet('cream');
      const cs = getComputedStyle(document.documentElement);
      return { ok: cs.getPropertyValue('--ok').trim(), disp: cs.getPropertyValue('--disp').trim() };
    });
    await page.waitForTimeout(300);
    const cvd = await page.evaluate(() => {
      window.themeSet('cvd');
      const cs = getComputedStyle(document.documentElement);
      return { ok: cs.getPropertyValue('--ok').trim(), disp: cs.getPropertyValue('--disp').trim(),
               paper: cs.getPropertyValue('--paper').trim() };
    });
    /* ⚠️ THE POINT OF THE THEME. Colour blindness is not fixed by changing the ground — it is fixed by not
       encoding meaning in the one pair the reader cannot separate. If a future edit "simplified" this theme into
       a background tweak, these two assertions are what would notice. */
    expect(cvd.ok, 'the success colour must move').not.toBe(cream.ok);
    expect(cvd.disp, 'and the dispute colour with it').not.toBe(cream.disp);
    /* Okabe–Ito vermillion is an ORANGE — red channel high, green mid, blue near zero. A theme that quietly
       drifted back to a red would pass the "it moved" test above and fail the people it was built for. */
    const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    const [r, g, b] = rgb(cvd.disp);
    expect(r, 'the dispute colour is an orange, not a red').toBeGreaterThan(b + 60);
    expect(g, 'with a real green component, which a red does not have').toBeGreaterThan(b + 20);
  });

  test('[A11Y-05] ⚠️ Soft Paper deliberately does NOT maximise contrast', async ({ page }) => {
    await mintEntity(page);
    const v = await page.evaluate(() => {
      window.themeSet('softpaper');
      const cs = getComputedStyle(document.documentElement);
      return { ink: cs.getPropertyValue('--ink').trim(), paper: cs.getPropertyValue('--paper').trim() };
    });
    /* ⚠️⚠️ THE ASSERTION THAT LOOKS BACKWARDS AND IS NOT. Pure black on pure white increases glare and
       letter-swimming for many dyslexic readers, so this theme uses a soft brown on a tinted ground on purpose.
       A well-meaning later edit that "fixed" it to #000 on #FFF would break the theme's whole reason to exist —
       and would look like an improvement in every other test. This is the guard against that. */
    expect(v.ink.toLowerCase(), 'ink is a soft dark, not pure black').not.toBe('#000000');
    expect(v.paper.toLowerCase(), 'the page is tinted, not white').not.toBe('#ffffff');
  });

  test('[A11Y-06] the palette groups them and states the standard in the UI', async ({ page }) => {
    await mintEntity(page);
    const html = await page.evaluate(() => window.themePaletteHTML());
    expect(html, 'the group is labelled').toContain('Designed for specific needs');
    expect(html, 'WCAG is named in the interface, not only in the code').toContain('WCAG');
    expect(html, 'and the colour-blind palette is credited').toContain('Okabe');
    /* Athi's standing rule: if a standard is followed, it is said out loud in the menu. */
    expect(html, 'each row names its audience').toMatch(/dyslexia|low vision|colour blindness/i);
    for (const k of ['hc', 'hcdark', 'cvd', 'calm', 'softpaper']) {
      expect(html, k + ' is reachable from the palette').toContain('data-testid="theme-' + k + '"');
    }
  });
});
