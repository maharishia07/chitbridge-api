// MODULE: Co-assists — the actors that act for an entity: PERSON, IoT device, ERP/API system, AI agent.
// FLOW A: prove EVERY type path is reachable (human / IoT / ERP / AI) — the "does it cover IoT/ERP" answer.
// FLOW B (CRUD·create): create a human co-assist end to end → an invite is issued.
// LOCATORS: nav-coassists · coassist-new · coassist-type-{human|iot|erp|ai} · coassist-wiz-next · coassist-wiz-back · aw_name · aw_key
const { test, expect } = require('@playwright/test');
const { mintEntity, addCoassist } = require('../fixtures');

test.describe('Module · Co-assists', () => {
  test('[COA-01] every co-assist type is reachable (human · IoT · ERP · AI)', async ({ page }) => {
    await mintEntity(page);
    await page.getByTestId('nav-coassists').click();
    await page.getByTestId('coassist-new').click();
    for (const type of ['human', 'iot', 'erp', 'ai']) {
      await test.step(`type: ${type}`, async () => {
        await expect(page.getByTestId(`coassist-type-${type}`)).toBeVisible();
        await page.getByTestId(`coassist-type-${type}`).click();
        // left the type grid → its wizard step (ready types) or explore preview (both carry a Back)
        await expect(page.getByTestId('coassist-wiz-back').first()).toBeVisible();
        await page.getByTestId('coassist-wiz-back').first().click();   // back to the type grid for the next type
        await expect(page.getByTestId('coassist-type-human')).toBeVisible();
      });
    }
  });

  test('[COA-02] CRUD·create — add a human co-assist → invite issued', async ({ page }) => {
    await mintEntity(page);
    /**
     * ⚠️ THIS WALK WENT STALE AND THE SPEC WENT WITH IT. It clicked Next exactly twice, because
     * `AW_STEPS.human` was ['who','hat'] when it was written. A third step ('docs') was added, so two clicks
     * now stop ON the last step — the invite never issues, and the wizard is left covering the screen for
     * whatever runs next.
     *
     * ⭐ So the walk moved into `addCoassist()` and both call sites use it: a wizard that grows a step is now
     * one edit, not a hunt through the specs that happen to open it.
     */
    await addCoassist(page, { name: 'Anitha E2E' });
    await expect(page.getByText(/Anitha E2E/).first(), 'the new co-assist is not on the roster').toBeVisible();
  });
});
