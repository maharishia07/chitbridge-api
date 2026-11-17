// [SCREEN-01] THE SCREEN LIBRARY, ON ONE PAGE. Athi, 2026-09-17: *"a library of different designs and colour schemes so
// people, or their system, can pick up the required format."* lib/screen-kit (served as /engine/screen.js) holds the
// registries; /screen-gallery.html draws every entry of every one. This proves nothing in a registry is missing from the
// page someone chooses from, and that each colour scheme actually repaints it.
const { test, expect } = require('@playwright/test');

const BASE = process.env.CB_TILL_BASE || '';

test('[SCREEN-01] every scheme, preset, key style, picker and layout is on the gallery', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(BASE + '/screen-gallery.html');
  await page.waitForFunction(() => window.CBScreen && document.querySelector('[data-testid^="gal-preset-"]'), null, { timeout: 30000 });

  const reg = await page.evaluate(() => ({
    themes: Object.keys(CBScreen.THEMES), presets: Object.keys(CBScreen.PRESETS), tiles: Object.keys(CBScreen.TILES),
    pickers: Object.keys(CBScreen.PICKERS), layouts: Object.keys(CBScreen.LAYOUTS),
  }));
  /* the library is not allowed to shrink quietly — a registry that lost entries is a regression, not a tidy-up */
  expect(reg.themes.length, 'colour schemes').toBeGreaterThanOrEqual(4);
  expect(reg.presets.length, 'presets').toBeGreaterThanOrEqual(9);
  expect(reg.tiles.length, 'key styles').toBeGreaterThanOrEqual(6);
  expect(reg.pickers.length, 'pickers').toBeGreaterThanOrEqual(7);

  for (const [kind, keys] of [['theme', reg.themes], ['preset', reg.presets], ['tile', reg.tiles], ['picker', reg.pickers], ['layout', reg.layouts]]) {
    for (const k of keys) await expect(page.locator(`[data-testid="gal-${kind}-${k}"]`), `${kind} ${k} is not on the gallery`).toHaveCount(1);
  }

  const grounds = new Set();
  for (const k of reg.themes) {
    await page.locator(`[data-testid="gal-theme-${k}"]`).click();
    await expect(page.locator(`[data-testid="gal-theme-${k}"]`)).toHaveAttribute('aria-pressed', 'true');
    grounds.add(await page.evaluate(() => getComputedStyle(document.body).backgroundColor));
    await page.screenshot({ path: `test-results/screen-gallery-${k}.png`, fullPage: false });
  }
  /* ⚠️ a scheme that does not change the ground is a label, not a scheme */
  expect(grounds.size, 'each colour scheme paints its own ground: ' + [...grounds].join(' · ')).toBe(reg.themes.length);
  expect(errors, 'the gallery threw').toEqual([]);
});

/* ⚠️⚠️ [SCREEN-02] "COMPACT ROW" BROKE A PLAIN NAME ONE LETTER PER LINE. .sk-row .sk-name had min-width:0 and
 * nothing to grow into, so any row short on space took it all out of the name — down to zero — and the base
 * overflow-wrap:anywhere rule then wrapped "Veg Biryani" ten lines tall, one character each. Reachable live:
 * Counter rail and Handheld both ship this tile. Proven against the REAL preset row (622px), not the gallery's
 * own narrow side-by-side comparison column, which squeezes all six tile styles into one shared width on
 * purpose and is not the width a shop's own rail ever renders at. */
test('[SCREEN-02] a compact-row product name stays on one line, at the real preset width', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(BASE + '/screen-gallery.html');
  await page.waitForFunction(() => window.CBScreen, null, { timeout: 30000 });
  await page.locator('[data-testid="gal-preset-counterRail"]').click();

  const names = await page.evaluate(() => Array.from(document.querySelectorAll('#preview .sk-tile.sk-row .sk-name')).map((el) => {
    const r = el.getBoundingClientRect();
    return { text: el.textContent, width: r.width, height: r.height, wrapped: el.scrollHeight > r.height + 2 };
  }));
  expect(names.length, 'Counter rail is compactRow — there should be rows to check').toBeGreaterThan(0);
  for (const n of names) {
    expect(n.width, `"${n.text}" claims real width, not a sliver`).toBeGreaterThan(40);
    expect(n.wrapped, `"${n.text}" stays one line tall — a compact row must not grow per key`).toBe(false);
  }
  expect(errors, 'the gallery threw').toEqual([]);
});
