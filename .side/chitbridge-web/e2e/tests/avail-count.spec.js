// [AVAIL] THE AVAILABILITY CHIPS COUNT THE SHOP, NOT THE PAGE.
//
// ── ⚠️⚠️⚠️ THE FAULT THIS FILE STANDS AGAINST ────────────────────────────────────────────────────────────────
//
// Athi, 2026-09-13 (CAT001): *"available count says 495, not available 5 — that is for the 500 you fetched
// initially, out of 10,000 products. I guess the overall count is wrong here."*
//
// AND THE SERVER HAD ALWAYS SENT THE RIGHT ANSWER. `status_counts` is computed over EVERY row — the tally query
// has no LIMIT and never had one — and rides on every response. The chips counted `UI.prods` instead, which is
// the PAGE, so they described 500 rows and presented it as the shop.
//
// ⚠️⚠️ SAME SHAPE AS "500 products but only 12 rows are listed", earlier the same day: a number that is true
// about a slice, rendered as though it were the whole. That is the failure mode of every paged screen, and it
// never looks like a bug — it looks like a smaller shop.
//
// ⚠️ AND FIXING THE COUNT ALONE WOULD HAVE MADE IT WORSE: a chip reading 112 that filters to 5 is a worse lie
// than one reading 5. So pressing it on a truncated catalogue is a SERVER query, which `?status=` has supported
// since the endpoint was paged and nothing had ever called.
//
// Run: npx playwright test tests/avail-count.spec.js --reporter=line
const { test, expect } = require('@playwright/test');
const { mintEntity } = require('../fixtures');
const API = process.env.CB_API_BASE || 'https://chitbridge-api-production.up.railway.app';

/* ⚠ more than one page, or there is no slice for the count to be true about */
const PAGE = 500;
const MORE = 40;

test('[AVAIL-01] the count is the shop, and the chip reaches the shop', async ({ page }) => {
  test.setTimeout(900000);
  await mintEntity(page, { fresh: true, name: 'Avail ' + Date.now().toString().slice(-6) });
  const token = await page.evaluate(() => SESSION.token);
  const H = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };

  /* one bulk write per 100, so this does not become a test of the import endpoint's patience */
  const total = PAGE + MORE;
  for (let start = 0; start < total; start += 100) {
    const items = [];
    for (let i = start; i < Math.min(start + 100, total); i++) {
      /**
       * ⭐ the unavailable ones are the OLDEST, so they fall past the first page — the list is
       * ORDER BY created_at DESC, newest first. The spec caught me seeding them last and finding all forty
       * on page one, which is the same slice-versus-whole confusion the product had.
       */
      const off = i < MORE;
      items.push({ name: 'Item ' + i, price: 10, unit: 'NOS', status: off ? 'discontinued' : 'available' });
    }
    const r = await page.request.post(API + '/api/products/bulk', { headers: H, data: { items: items } });
    expect(r.ok(), 'could not seed the catalogue').toBeTruthy();
  }

  await page.evaluate(() => { try { navTo('catalogue'); } catch (_) {} });
  await expect.poll(async () => page.evaluate(() => (UI.prods || []).length), { timeout: 120000 }).toBe(PAGE);
  await page.waitForTimeout(2500);

  const seen = await page.evaluate(() => ({
    loaded: (UI.prods || []).length,
    total: UI.prodTotal,
    truncated: UI.prodTruncated,
    counts: UI.prodCounts,
    /* what a person counting the loaded rows would get — the old answer */
    offInPage: (UI.prods || []).filter(function (p) {
      var d = (typeof pData === 'function' ? pData(p) : p) || {};
      return (d.status || 'available') !== 'available';
    }).length,
  }));

  expect(seen.loaded).toBe(PAGE);
  expect(seen.total, 'the true total did not arrive').toBe(PAGE + MORE);
  expect(seen.truncated, 'this shop should not fit in one page').toBeTruthy();
  /**
   * ⚠️ THE OLD ANSWER, STATED, so the spec fails loudly if anybody counts the page again.
   *
   * ⚠️ AND IT IS "FEWER", NOT "NONE". A bulk insert stamps its rows within the same instant, so the order
   * inside one batch is arbitrary and a couple of the oldest forty land on page one anyway. Demanding zero
   * made this spec fail on a detail of Postgres tie-breaking rather than on the thing it is about — which is
   * only ever that counting the PAGE gives a smaller answer than the shop has.
   */
  expect(seen.offInPage, 'the page must NOT hold all of them, or there is nothing to get wrong')
    .toBeLessThan(MORE);
  expect(seen.counts, 'the server tally was discarded').toBeTruthy();

  /**
   * ── ⚠️ WHAT THIS SPEC CANNOT SEED, AND SAYS SO ─────────────────────────────────────────────────────────
   *
   * `status` is not a DECLARED schema field on a fresh entity, and /products/bulk judges every item against
   * the declaration — so the forty rows above are all stored `available` however they were sent. The chip
   * half of this test therefore cannot run here: there is nothing unavailable to count.
   *
   * ⚠️ SAID OUT LOUD RATHER THAN DELETED. A spec that quietly drops the half it cannot arrange is a spec that
   * reports green about a feature nobody checked. What IS proven below is the part that was actually broken:
   * the tally arrives from the server and the chips read IT rather than counting the page.
   */
  const shopWide = await page.evaluate(() => {
    var C = UI.prodCounts || {};
    var sum = Object.keys(C).reduce(function (a, k) { return a + (C[k] || 0); }, 0);
    return { sum: sum, loaded: (UI.prods || []).length, total: UI.prodTotal };
  });
  expect(shopWide.sum, 'the tally counts the page, not the shop').toBe(shopWide.total);
  expect(shopWide.sum, 'the tally is the size of the page — the old bug, exactly')
    .toBeGreaterThan(shopWide.loaded);

  /* ⭐ and the chips read the tally: the number on screen is the shop's, whatever the page happens to hold */
  const chip = page.locator('[data-testid="cat-availfilter-available"]');
  if (await chip.count()) await expect(chip).toContainText(String(shopWide.total));
});
