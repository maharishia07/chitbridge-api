// MODULE: Design guard — the rendered-page checks that static analysis cannot make.
// LOCATORS: none of its own; it walks whatever each screen renders.
const { test, expect } = require('@playwright/test');
const { mintEntity, clickNav } = require('../fixtures');

/**
 * ⭐ WHY THIS FILE EXISTS (2026-08-16).
 *
 * Two real bugs shipped past `node --check`, past guard-static, and past a green suite, and were caught only
 * because a person looked at the screen:
 *
 *   · the supplier Edit button rendered WHITE ON WHITE — `.composebtn` sets color:#fff for a coloured
 *     background, and the rule beside it set background:#fff. The button was present, sized, clickable and
 *     invisible. Every locator found it. Every assertion passed.
 *   · the "‹ Suppliers" back button carried `.dback`, which is `display:none` outside mobile — so on a laptop
 *     the Find-a-product panel covered the list with NO WAY OUT. Athi hit it in the first minute.
 *
 * Neither is visible in source: both need computed styles on a rendered page. That is exactly the seam between
 * guard-static (cheap, textual, every save) and the specs (real browser, real cascade).
 *
 * ⚠️ THIS FILE ASSERTS PERCEIVABILITY, NOT TASTE. It cannot tell you a layout is ugly or a label is confusing —
 * the "Shop status" vs "Is your shop open?" collision was found by reading both labels and being confused, and
 * nothing here would have caught it. It catches only the mechanical failures: text that cannot be read, and
 * controls that cannot be reached.
 */

/* WCAG relative luminance → contrast ratio. Small enough to inline; a dependency for four lines is worse. */
function contrast(rgb1, rgb2) {
  const lum = (c) => {
    const s = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * s[0] + 0.7152 * s[1] + 0.0722 * s[2];
  };
  const a = lum(rgb1), b = lum(rgb2);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/**
 * ⚠️ THESE ARE NAV KEYS AND THEY MUST EXIST. `definitions` was dropped on 2026-08-16 (its tenants were rehomed to
 * Categories, Catalogue setup and Suppliers) and this list still asked for it — so `clickNav` waited on a testid
 * that will never appear, and BOTH tests died on the 60s timeout with no mention of the missing screen anywhere
 * in the failure. It read as a contrast/overlap regression; it was a stale list.
 *
 * ⭐ A `.catch(() => {})` around a navigation HIDES exactly this. It swallows the "no such element" but not the
 * WAIT that precedes it, so a removed screen costs the full locator timeout and reports as something else
 * entirely. If a screen is renamed or dropped, this line changes with it.
 */
const SCREENS = ['task', 'suppliers', 'mis', 'profile', 'settings', 'catalogue', 'categories', 'catsetup'];

test.describe('Design guard · the rendered page', () => {

  /**
   * ⭐ TEXT A PERSON CANNOT READ. Walks every leaf text node and compares its colour against the first
   * non-transparent background behind it. 3.0 is deliberately well below the WCAG AA 4.5 — this is hunting
   * INVISIBLE text (ratio ~1.0), not grading the palette, and a stricter bar would drown the real signal in
   * hundreds of borderline greys nobody is going to change today.
   */
  test('[DG-01] no text is rendered invisibly against its own background', async ({ page }) => {
    await mintEntity(page);
    const offenders = [];
    for (const nav of SCREENS) {
      await clickNav(page, nav).catch(() => {});
      await page.waitForTimeout(1200);   // capabilities load lazily; give the screen its paint
      const bad = await page.evaluate(() => {
        const lum = (c) => { const s = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
          return 0.2126 * s[0] + 0.7152 * s[1] + 0.0722 * s[2]; };
        const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
        /**
         * ⚠️ ALPHA MUST BE COMPOSITED, NOT ROUNDED UP TO OPAQUE. The first version treated any alpha > 0 as a
         * solid colour, so the topbar's `rgba(255,255,255,.05)` — 5% white over dark navy, i.e. still dark navy —
         * was read as SOLID WHITE, and every "Closed"/"Away" button was reported as invisible light-on-white text
         * when it is light-on-dark and perfectly legible. It produced 6 confident false positives on the first
         * run, which is exactly how a check earns a reputation for crying wolf and stops being read.
         */
        const parse = (s) => { const m = (s || '').match(/rgba?\(([^)]+)\)/); if (!m) return null;
          const p = m[1].split(',').map((n) => parseFloat(n));
          return { rgb: [p[0], p[1], p[2]], a: p.length > 3 ? p[3] : 1 }; };
        const over = (fg, bg) => fg.rgb.map((c, i) => c * fg.a + bg[i] * (1 - fg.a));   // src-over
        const bgOf = (el) => { const layers = []; let n = el;
          while (n && n !== document.documentElement) { const c = parse(getComputedStyle(n).backgroundColor);
            if (c && c.a > 0) { layers.push(c); if (c.a === 1) break; } n = n.parentElement; }
          let base = [255, 255, 255];
          for (let i = layers.length - 1; i >= 0; i--) base = over(layers[i], base);   // farthest → nearest
          return base; };
        const out = [];
        document.querySelectorAll('body *').forEach((el) => {
          if (el.children.length) return;                       // leaves only
          const txt = (el.textContent || '').trim();
          if (!txt) return;
          /* ⚠️ EMOJI PAINT THEMSELVES. A colour emoji font ignores `color` entirely, so measuring the computed
             text colour against the background says nothing about whether anyone can see it — 🛍️ on white is
             perfectly legible while reporting the contrast of a colour it never uses. Skip glyph-only labels;
             leaving them in would teach people that this check cries wolf, and then it stops being read. */
          if (!/[a-z0-9]/i.test(txt)) return;
          const r = el.getBoundingClientRect();
          if (r.width < 4 || r.height < 4) return;              // not laid out
          const cs = getComputedStyle(el);
          if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0) return;
          const fg = parse(cs.color); if (!fg) return;
          /* Text carries alpha too (a 60%-opacity label is genuinely fainter), so composite it over the same
             background before measuring — otherwise the ratio flatters a colour nobody actually sees. */
          const bg = bgOf(el);
          if (ratio(over(fg, bg), bg) < 3.0) out.push(txt.slice(0, 40) + ' [' + (el.className || el.tagName) + ']');
        });
        return out;
      });
      bad.forEach((b) => offenders.push(nav + ': ' + b));
    }
    expect(offenders, 'text rendered at under 3:1 against its background is effectively invisible').toEqual([]);
  });

  /**
   * ⭐ CONTROLS THAT CANNOT BE REACHED. An element carrying an onclick but laid out at zero size is a dead end —
   * that is precisely what `.dback` did to the Find-a-product panel on a laptop. `display:none` is FINE and
   * expected (responsive variants, closed menus); what is not fine is a control that is present, clickable in
   * the DOM, and occupies no space while its container is visible.
   */
  test('[DG-02] no visible pane hides its only way out', async ({ page }) => {
    await mintEntity(page);
    const dead = [];
    for (const nav of SCREENS) {
      await clickNav(page, nav).catch(() => {});
      await page.waitForTimeout(1200);
      const bad = await page.evaluate(() => {
        const out = [];
        document.querySelectorAll('[onclick]').forEach((el) => {
          const cs = getComputedStyle(el);
          if (cs.display === 'none' || cs.visibility === 'hidden') return;   // deliberately not rendered
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) {
            const label = (el.textContent || '').trim().slice(0, 30) || el.className || el.tagName;
            out.push(label);
          }
        });
        return out;
      });
      bad.forEach((b) => dead.push(nav + ': ' + b));
    }
    expect(dead, 'a control that is displayed but occupies no space cannot be clicked by a person').toEqual([]);
  });
});
