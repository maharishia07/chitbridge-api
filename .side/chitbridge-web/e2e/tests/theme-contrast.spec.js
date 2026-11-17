// theme-contrast.spec.js — EVERY THEME, EVERY SCREEN, CHECKED BY MACHINE.
//
// Athi, 2026-08-17: *"interms of maintenance, is it kind of tabled and easily done or everytime we have to test
// for all colors? it has to be done in a way easy to maintain."*
//
// Adding a theme IS a table entry — eight lines in THEMES. What was NOT maintainable is that ~1,500 colours are
// still hardcoded where no theme can reach them, so a new theme could look right on the two screens someone
// happened to open and be unreadable on the ninth. That is not a thing a person can hold in their head, and
// "test all the colours by hand" is not a plan.
//
// ⭐ SO THE MACHINE DOES IT. This walks every theme across every main screen, computes the real contrast ratio of
// every piece of text against the background actually behind it, and fails with a list. Adding a theme now costs
// one table entry and one test run — and the test, not a person, decides whether it is finished.
//
// ⚠️ THE THRESHOLD IS DELIBERATELY LENIENT (3:1). WCAG AA wants 4.5:1 for body text, and this app does not clear
// that everywhere even in its default theme — so failing at 4.5 would report the EXISTING design rather than the
// theme, and a test that always fails teaches people to ignore it. 3:1 catches "cannot read this", which is the
// thing a broken theme actually does. The gap between 3 and 4.5 is a separate, deliberate piece of work.
//
// ⚠️ IT COMPARES EACH THEME TO THE DEFAULT, not to an absolute bar. A theme is judged on whether IT introduced a
// failure — that is the question when adding one — so the baseline is whatever Cream already scores.

const { test, expect } = require('@playwright/test');
const { mintEntity, seedDemo } = require('../fixtures');

const SCREENS = ['task', 'order', 'suppliers', 'catalogue', 'catsetup', 'mis'];
/* Below this a screen is an empty state — a heading and a "nothing here yet" line — and measuring it proves
   nothing. Deliberately low: the point is to catch a BLANK screen, not to police how busy a screen is. */
const MIN_TEXT_NODES = 25;

/* Contrast maths, run inside the page. Walks up for the real background, because a transparent element sits on
   whatever is behind it — comparing against `transparent` is how these checks quietly pass on everything. */
const AUDIT = `(() => {
  const lum = (c) => { const m = /rgba?\\((\\d+), (\\d+), (\\d+)/.exec(c); if (!m) return null;
    const v = [+m[1],+m[2],+m[3]].map(x => { x/=255; return x <= 0.03928 ? x/12.92 : Math.pow((x+0.055)/1.055, 2.4); });
    return 0.2126*v[0] + 0.7152*v[1] + 0.0722*v[2]; };
  /* ⚠️ ALPHA MUST BE COMPOSITED, not treated as its own colour. A translucent white pill over the dark navy
     topbar resolves to a MID tone that white text sits on happily — but read literally, rgba(255,255,255,.24)
     looks like near-white and every label on it is reported unreadable. Blend it over what is behind it. */
  const parse = (c) => { const m = /rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)(?:,\\s*([\\d.]+))?/.exec(c);
    return m ? { r:+m[1], g:+m[2], b:+m[3], a: m[4] === undefined ? 1 : +m[4] } : null; };
  const over = (fg, bg) => ({ r: fg.r*fg.a + bg.r*(1-fg.a), g: fg.g*fg.a + bg.g*(1-fg.a), b: fg.b*fg.a + bg.b*(1-fg.a), a: 1 });
  const bgOf = (el) => {
    const stack = []; let n = el, g = 0;
    while (n && n !== document.documentElement && g++ < 40) {
      const c = parse(getComputedStyle(n).backgroundColor);
      if (c && c.a > 0) { stack.push(c); if (c.a === 1) break; }
      n = n.parentElement;
    }
    let base = parse(getComputedStyle(document.body).backgroundColor) || { r:255,g:255,b:255,a:1 };
    for (let i = stack.length - 1; i >= 0; i--) base = over(stack[i], base);
    return 'rgb(' + Math.round(base.r) + ', ' + Math.round(base.g) + ', ' + Math.round(base.b) + ')';
  };
  const out = [];
  /* ⚠️⚠️ TEXT NODES, NOT LEAF ELEMENTS — and this is the bug that made an earlier version of this test USELESS.
     Skipping any element with children means a row whose text sits inside nested spans is never checked at all.
     It reported 40 of 42 combinations clean while the catalogue screen had category chips at 1.63:1 — dark text
     on a dark chip, plainly invisible to anyone looking at it. A test that returns green on a broken screen is
     worse than no test, because it stops you looking. */
  const w = document.createTreeWalker(document.querySelector('.shell'), NodeFilter.SHOW_TEXT);
  let node;
  while ((node = w.nextNode())) {
    const s = (node.nodeValue || '').trim();
    if (!s) continue;
    const el = node.parentElement;
    if (!el || el.closest('.moderibbon')) continue;
    if (el.closest('[aria-hidden="true"]')) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0) continue;
    const f = lum(cs.color), b = lum(bgOf(el));
    if (f === null || b === null) continue;
    const r = (Math.max(f,b) + 0.05) / (Math.min(f,b) + 0.05);
    /* ⚠️ Record enough to FIND it. A bare tag name sends you hunting through a screen; the text, the inline
       style and the ancestor that actually supplied the background are what identify the one element. */
    if (r < 3) {
      let src = el, guard = 0;
      while (src && getComputedStyle(src).backgroundColor === 'rgba(0, 0, 0, 0)' && guard++ < 40) src = src.parentElement;
      out.push({
        sel: (el.className || el.tagName).toString().slice(0, 40),
        text: s.slice(0, 24),
        style: (el.getAttribute('style') || '').slice(0, 70),
        from: src ? ((src.className || src.tagName).toString().slice(0, 34) + ' [' + (src.getAttribute('style') || '').slice(0, 40) + ']') : '?',
        fg: cs.color, bg: bgOf(el), r: +r.toFixed(2),
      });
    }
  }
  return out;
})()`;

test.describe('Theme contrast · every theme, every screen', () => {
  /**
   * ⚠️ RAISED FROM 180s FOR THE SEED. 13 themes × 6 screens fitted in three minutes only while the screens
   * were EMPTY; a populated account is far more text to walk on every pass, and walking it is the entire
   * point. ⭐ A timeout is not a contrast result — it reports nothing while looking like a failure, which is
   * the one outcome this test must never produce.
   */
  test.describe.configure({ timeout: 420_000 });

  /**
   * ⚠️⚠️ THE STATE THE SCREEN IS IN WHEN IT LOADS IS NOT THE STATE THE USER SEES.
   *
   * This test navigated to a screen and measured whatever painted — so it only ever judged the RESTING state.
   * A selected row, a filter chip strip, an open menu, a picked checkbox: none of them existed at the moment of
   * measurement, so none of them were ever checked. It reported the catalogue screen CLEAN in dark on the same
   * build where Athi photographed unreadable category chips and an unreadable selected row.
   *
   * A contrast test that only sees the resting state is a test that passes the screenshot it was not shown.
   */
  const PREP = {
    catalogue: async (page) => {
      const row = page.locator('[data-testid^="cat-product-"]').first();
      if (await row.count()) { await row.click({ timeout: 4000 }).catch(() => {}); }   // selected row + its detail
    },
    task: async (page) => {
      const r = page.locator('.lrow').first();
      if (await r.count()) { await r.click({ timeout: 4000 }).catch(() => {}); }
    },
  };
  const prep = async (page, screen) => { if (PREP[screen]) { await PREP[screen](page); await page.waitForTimeout(400); } };

  test('[THEME-01] no theme makes text unreadable that the default theme does not', async ({ page }) => {
    await mintEntity(page);
    /**
     * ⭐⭐ THE SEED THIS TEST ASKED FOR, IN ITS OWN WORDS. The `thin` guard below already said *"the fix is to
     * SEED the screen, never to lower the bar"* — it just had nothing to seed with. `seedDemo` (backlog M3)
     * files six chits with two disputes, three priorities and two catalogue items, so the audit walks real
     * rows, real flags and real chips instead of an empty state.
     *
     * ⚠️ AND IT IS WHY THIS TEST FAILED IN A FULL BATCH AND PASSED ALONE — not flakiness. A 64-spec run leaves
     * the shared account full, so the batch reached states the solo run never did. **The batch was the honest
     * measurement and the solo run was the optimistic one.** Seeding gives the honest one at the cost of one
     * spec instead of sixty-four.
     *
     * ⚠️ Idempotent, so a re-run measures the same page rather than a bigger one.
     */
    await seedDemo(page);
    const themes = await page.evaluate(() => Object.keys(window.THEMES || {}));
    expect(themes.length, 'THEMES must be readable from the page').toBeGreaterThan(1);

    /* ⚠️⚠️ COUNT WHAT IS ON THE SCREEN BEFORE TRUSTING A CLEAN RESULT.
       A fresh entity has an EMPTY catalogue: no product rows, no category chips, nothing to measure. This test
       reported the catalogue screen clean in every theme while it was rendering an empty state — and it was on
       exactly that screen, with 58 real products, that Athi photographed unreadable chips and an unreadable
       selected segment. Zero failures out of zero elements is not a pass, it is a test that did not run. */
    const density = async () => page.evaluate(`(() => {
      const w = document.createTreeWalker(document.querySelector('.shell'), NodeFilter.SHOW_TEXT);
      let n = 0, node; while ((node = w.nextNode())) { if ((node.nodeValue || '').trim()) n++; } return n;
    })()`);

    // Baseline: whatever the DEFAULT theme already scores, per screen. A theme is judged against this.
    const base = {}, thin = [];
    await page.evaluate(() => window.themeApply('cream'));
    for (const s of SCREENS) {
      await page.evaluate((n) => window.navTo(n), s);
      await page.waitForTimeout(500);
      await prep(page, s);
      const d = await density();
      if (d < MIN_TEXT_NODES) thin.push(`${s} (${d} text nodes)`);
      base[s] = (await page.evaluate(AUDIT)).length;
    }
    /* Reported, not silently tolerated. If this fires, the fix is to SEED the screen, never to lower the bar. */
    expect(thin, 'these screens were too empty to have been measured at all — a clean result here means nothing:\n  '
      + thin.join('\n  ')).toEqual([]);

    const regressions = [];
    for (const th of themes) {
      if (th === 'cream') continue;
      await page.evaluate((t) => window.themeApply(t), th);
      for (const s of SCREENS) {
        await page.evaluate((n) => window.navTo(n), s);
        await page.waitForTimeout(500);
        await prep(page, s);
        const bad = await page.evaluate(AUDIT);
        if (bad.length > base[s]) {
          regressions.push(`${th} / ${s}: ${bad.length} unreadable vs ${base[s]} in the default` +
            bad.slice(0, 3).map((b) => `\n      · "${b.text}" in .${b.sel} — ${b.fg} on ${b.bg} = ${b.r}:1` +
              `\n        style[${b.style}]  bg from: ${b.from}`).join(''));
        }
      }
    }
    await page.evaluate(() => window.themeApply('cream'));

    expect(regressions, 'a theme must not introduce unreadable text:\n' + regressions.join('\n')).toEqual([]);
  });
});
