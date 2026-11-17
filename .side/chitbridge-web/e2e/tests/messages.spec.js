// MODULE: Messages — on a chit, INTERNAL (your team only) vs EXTERNAL (the counterparty sees it). The channel toggle is
// the point: the same composer sends to two different audiences. (On a self-chit both land with you; the toggle + send
// are what's exercised. The true internal-stays-internal privacy is a multi-entity assertion — noted below.)
// LOCATORS: msg-tab · msg-channel-internal · msg-channel-external · msg-body · msg-send
const { test, expect } = require('@playwright/test');
const { mintEntity, composeSelfChit, settle } = require('../fixtures');

test.describe('Module · Messages', () => {
  test('[MSG-01] send an internal note and an external message on a chit', async ({ page }) => {
    await mintEntity(page);
    const subject = 'E2E msg ' + Date.now();
    await composeSelfChit(page, subject);
    await page.getByTestId('nav-task').click();
    await page.getByText(subject).first().click();
    await settle(page);
    await page.getByTestId('msg-tab').click();

    // The composer is hidden until you click "✏️ New message" (a toggle, no testid). Internal is the default channel.
    const openComposer = async () => {
      if (await page.locator('[data-testid="msg-body"]:visible').count() === 0)
        await page.getByRole('button', { name: /New message/i }).first().click();
    };

    await test.step('INTERNAL — a team-only note (default channel)', async () => {
      await openComposer();
      await page.locator('[data-testid="msg-body"]:visible').first().fill('Internal: check stock before confirming.');
      await page.locator('[data-testid="msg-send"]:visible').first().click();
      await settle(page);
      await expect(page.getByText(/check stock/i).first()).toBeVisible();
    });

    await test.step('EXTERNAL — the channel toggle works (delivery to a counterparty is proven in MSG-02, 2-entity)', async () => {
      await openComposer();
      const ext = page.locator('[data-testid="msg-channel-external"]:visible').first();
      await expect(ext, 'the internal/external channel toggle must exist').toBeVisible();
      await ext.click();                                    // switching to External must work
      await page.locator('[data-testid="msg-body"]:visible').first().fill('External: your order is confirmed.');
      await page.locator('[data-testid="msg-send"]:visible').first().click();
      await settle(page);
      // On a SELF-chit there's no counterparty to receive it — the internal-stays-internal / external-delivered split
      // is a 2-entity assertion, covered by MSG-02. Here we've proven the toggle + send path.
    });
  });

  /**
   * ⭐ MSG-02 LIVES IN message-privacy.spec.js NOW — as six real assertions across two entities, not a skeleton.
   *
   * ⚠️ It sat here as `test.skip('needs a 2nd entity')` — a written-down intention where the proof should be, on
   * the single most consequential claim the messaging layer makes. A skipped test reads as covered in a run
   * summary; that is the whole danger of leaving one behind.
   */
});
