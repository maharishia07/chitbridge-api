// MODULE: Suppliers — CRUD is cross-entity: B adds A (another entity) as a supplier, edits, removes.
// FLOW A (runnable): mint → nav-suppliers → the add box renders.
// FLOW B (CRUD): mint A (the supplier), mint B (the buyer), B adds A by A's email → edit → remove.
// LOCATORS: nav-suppliers · sup-add-input · sup-add · sup-row-* · sup-nick · sup-category · sup-notes · sup-save · sup-remove
const { test, expect } = require('@playwright/test');
const { mintEntity, mintInContext } = require('../fixtures');

test.describe('Module · Suppliers', () => {
  test('[SUP-01] suppliers screen loads with the add box', async ({ page }) => {
    await mintEntity(page);
    await page.getByTestId('nav-suppliers').click();
    await expect(page.getByTestId('sup-add-input')).toBeVisible();
    await expect(page.getByTestId('sup-add')).toBeVisible();
  });

  test('[SUP-02] CRUD — B adds A as a supplier, edits, removes', async ({ page, browser }) => {
    const A = await mintInContext(browser);                            // entity A = the supplier (fresh context → real email)
    await A.context.close();                                           // only A's email is needed; B is the main session
    await mintEntity(page);                                            // entity B = the buyer (the authed session)

    /**
     * ⚠️ THE CONFIRM IS NO LONGER A BROWSER DIALOG (2026-08-16). It used to be a native confirm(), which Playwright
     * auto-DISMISSES unless a handler says otherwise — hence the `page.on('dialog', …)` that used to live here.
     * Add / remove now go through the app's own confirmAsk() modal, so the dialog handler became a no-op: nobody
     * pressed "Add supplier", no row appeared, and this failed at `sup-row-` with "element(s) not found" as though
     * the SCREEN were broken. Same false signal as before, opposite cause. Press the real button instead.
     */
    const confirmOK = () => page.getByTestId('confirm-ok').click();

    await test.step('CREATE — add A by email', async () => {
      await page.getByTestId('nav-suppliers').click();
      await page.getByTestId('sup-add-input').fill(A.email);
      await page.getByTestId('sup-add').click();
      await confirmOK();
      await expect(page.locator('[data-testid^="sup-row-"]').first()).toBeVisible();
    });
    await test.step('READ + UPDATE — open, Edit, save a nickname', async () => {
      /* The record moved to a slide-over on the LEFT (2026-08-16), opened by the row's ⓘ — NOT by selecting the
         row, which means "show me their catalogue". Tagged rather than matched by text: getByText('Edit') also
         matches the modal's own "Edit <name>" heading once it opens. */
      await page.locator('[data-testid^="sup-details-"]').first().click();
      await page.getByTestId('sup-edit').click();
      await page.getByTestId('sup-nick').fill('Local yard');
      await page.getByTestId('sup-save').click();
      /* ⚠️ WAIT FOR THE MODAL TO GO. Save closes it only after the PATCH resolves, so the next step raced ahead and
         its click landed on the still-open form — reported as "<label class="fl">Notes"> … intercepts pointer
         events", which reads like a broken button rather than a step taken too early. */
      await expect(page.locator('#modalhost')).toBeEmpty();
    });
    await test.step('DELETE — remove from list', async () => {
      /* ⚠️ NO SECOND ⓘ CLICK. Saving leaves the record panel OPEN — correctly, you are still looking at that
         supplier — so re-opening it meant clicking ⓘ *through* the panel already covering it, reported as
         "<span>—</span> from #supslide_host … intercepts pointer events". Remove is right there; press it. */
      await page.getByTestId('sup-remove').click();
      await confirmOK();
      await expect(page.locator('[data-testid^="sup-row-"]')).toHaveCount(0);
    });
  });
});
