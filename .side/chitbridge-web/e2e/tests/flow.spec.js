// FLOW: the 2-day DEFINITION OF DONE — a human walks, screen by screen (with a trace), a MINTED path for TWO different
// entities, each landing in a working app. (verified→gated→minted: the verify + gate steps activate once Q3's gate and
// Q2's governed-mint land; today this asserts the MINTED half that exists, so the spec grows as those land.)
const { test, expect } = require('@playwright/test');
const { mintEntity } = require('../fixtures');

test.describe('FLOW · mint two entities (DoD)', () => {
  test('[FLOW-01] two distinct entities mint through the real front door', async ({ page }) => {
    const a = await test.step('Entity 1 — mint', async () => mintEntity(page));
    await expect(page).toHaveURL(/#\/app/);
    await expect(page.locator('#root')).toBeVisible();

    await test.step('Reset session', async () => {
      await page.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); } catch (e) {} });
    });

    const b = await test.step('Entity 2 — mint', async () => mintEntity(page));
    await expect(page).toHaveURL(/#\/app/);
    await expect(page.locator('#root')).toBeVisible();

    expect(a.email).not.toEqual(b.email);
    // TODO(DoD): pick DIFFERENT verticals for the two entities (helpdesk vs catalogue/RoyalPlay) by clicking a specific
    // onb-bp-<key> instead of .first(); and assert each entity's Catalogue opens without a 404 (needs catalogue testids).
  });
});
