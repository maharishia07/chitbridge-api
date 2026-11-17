// MODULE: Catalogue — FULL CRUD on a product (the worked example; the same pattern extends to suppliers/chits/co-assists).
// C: New product → name+price → Add.  R: open it → view shows the values.  U: Edit → change price → Save.  D: Delete.
// LOCATORS: nav-catalogue · cat-new-product · cat-field-name/price · cat-add · cat-product-* · cat-edit · cat-save · cat-delete
const { test, expect } = require('@playwright/test');
const { mintEntity, settle } = require('../fixtures');

test.describe('Module · Catalogue (full CRUD)', () => {
  test('[CAT-01] create → read → update → delete a product', async ({ page }) => {
    await mintEntity(page);
    const name = 'E2E Widget ' + Date.now();

    await test.step('CREATE', async () => {
      await page.getByTestId('nav-catalogue').click();
      await page.getByTestId('cat-new-product').click();
      await page.getByTestId('cat-field-name').fill(name);
      await page.getByTestId('cat-field-price').fill('250');
      await page.getByTestId('cat-add').click();
      await settle(page);
      await expect(page.getByText(name).first()).toBeVisible();  // renders in list + detail (title/code) → .first()
    });

    await test.step('READ', async () => {
      /**
       * ⚠️⚠️ THIS WAS getByText('250', { exact:false }).first() — AND THAT MATCHES ANY TEXT CONTAINING "250"
       * ANYWHERE ON THE PAGE. A row count, an id, a timestamp, another product's price. The shared `authed`
       * entity accumulates through a batch, so by the time this ran the catalogue held other people's products
       * and "250" was liable to be found somewhere that had nothing to do with this test — passing for the wrong
       * reason on a good day and failing on a bad one. Same class as CHIT-01: asserting against a SCREEN.
       *
       * ⚠️ AND `.first()` MADE IT WORSE, not safer. It silences the strict-mode error that would have said "23
       * elements matched" — the one signal that the locator was wrong.
       *
       * ⭐ THE VIEW PANE HAD NO HANDLE ON ITS PRICE, which is WHY the spec was reduced to hunting text. It has
       * one now (`cat-view-price`, the detail header) so the question can be asked of the element that answers
       * it. A feature that cannot be addressed precisely will always be tested imprecisely.
       */
      await expect(page.getByTestId('cat-view-price'),
        'the view pane shows the price it was created with').toContainText('250');
    });

    await test.step('UPDATE', async () => {
      await page.getByTestId('cat-edit').click();
      const price = page.getByTestId('cat-field-price');
      await price.waitFor({ state: 'visible' });
      await price.fill('999');
      await expect(price).toHaveValue('999');   // guard: the edit form actually holds the new value before saving
      /* ⚠️ WAIT ON THE WRITE, NOT ON THE CLICK (the design-2 driver rule). This step asserted the view 10s after
         pressing Save; the first run after an API deploy took longer than that to PATCH + reload, so the header
         still read ₹250 — the old price — and the failure looked like a broken save. Waiting for the PATCH
         itself makes a slow save a wait and a refused save a status code, which are different findings. */
      const saved = page.waitForResponse((r) => /\/api\/products\//.test(r.url()) && r.request().method() === 'PATCH', { timeout: 45000 });
      await page.getByTestId('cat-save').click();
      const resp = await saved;
      expect(resp.status(), 'PATCH /products/:id refused the edit').toBeLessThan(400);
      await settle(page);
      /* ⭐ AND THE UPDATE IS ASSERTED THE SAME WAY — on the element, not on the page. §37 proved the feature
         healthy end to end (saveProduct → loadCatalogue → paintProdDetail all fine); what was failing was how
         the SPEC read the result. */
      await expect(page.getByTestId('cat-view-price'),
        'the view pane shows the edited price, not the old one').toContainText('999');
      await expect(page.getByTestId('cat-view-price'),
        'and the old price is gone — a repaint that appended would pass a contains-check').not.toContainText('250');
    });

    await test.step('DELETE', async () => {
      /* ⚠️ IN-APP CONFIRM NOW, NOT window.confirm() — delProduct routes through confirmAsk (2026-08-16, the
         native-dialog sweep). The old `page.once('dialog', …)` handler is not just unnecessary, it is a trap:
         it never fires, so it silently does nothing, and the click alone would leave the modal open with the
         product still there. Confirming a destructive action is now a real click on a real button. */
      await page.getByTestId('cat-delete').click();
      await page.getByTestId('confirm-ok').click();
      await expect(page.getByText(name)).toHaveCount(0);         // gone from the list
    });
  });
});

/**
 * [CAT-03] A DECLARED COLUMN REACHES THE PRODUCT FORM — and round-trips.
 *
 * Athi, 2026-09-03 (observation 4): columns added from a trade template showed in Catalogue setup › Columns,
 * the template and the export, and NOT on the product. prodEditForm was eight hard-coded inputs; nothing bound
 * the declaration to the form. This drives the path that used to fail: declare through the same API the
 * Columns panel uses, open New product, and the declared column must be there — then hold its value through
 * Add, View and Edit.
 *
 * ⚠️ A FRESH ENTITY, on purpose. The shared `authed` account accumulates columns across runs, so "the gold
 * columns appear" would pass there for the wrong reason. Declaring BEFORE the first visit to Catalogue also
 * means the once-per-session declaration cache is filled after the declare, not before it.
 */
test('[CAT-03] a column declared in Setup appears on the product form and round-trips', async ({ page }) => {
  await mintEntity(page);
  const name = 'E2E Bar ' + Date.now();

  await test.step('DECLARE — the gold starter set, through the API the Columns panel calls', async () => {
    const r = await page.evaluate(async () => {
      try { return await api('prodStarterAdopt', { body: { vertical: 'gold' } }); } catch (e) { return { error: String(e && e.message) }; }
    });
    expect(r && r.error, 'starter adopt failed: ' + JSON.stringify(r)).toBeFalsy();
  });

  await test.step('NEW PRODUCT — the declared column is on the form', async () => {
    await page.getByTestId('nav-catalogue').click();
    await settle(page);
    /* ⚠️ NOT the cat-setup guard addProduct uses: that button is the always-visible header Setup link and it
       NAVIGATES to Catalogue setup — the first run of this spec left the catalogue that way and waited 20s for
       a button on a screen it had just left. */
    const add = page.getByTestId('cat-new-product');
    await add.waitFor({ state: 'visible', timeout: 20000 });
    await add.click();
    await expect(page.getByTestId('cat-declared')).toBeVisible();
    await expect(page.getByTestId('cat-field-fineness')).toBeVisible();   // gold: Fineness, number
    await expect(page.getByTestId('cat-field-fineness')).toHaveAttribute('data-type', 'number');
    await page.getByTestId('cat-field-name').fill(name);
    await page.getByTestId('cat-field-price').fill('7200');
    await page.getByTestId('cat-field-fineness').fill('999.9');
    const saved = page.waitForResponse((r) => /\/api\/products/.test(r.url()) && r.request().method() === 'POST' && r.status() < 400, { timeout: 45000 });
    await page.getByTestId('cat-add').click();
    await saved;
    await settle(page);
  });

  await test.step('VIEW — the value shows as a labelled row, not only inside "All fields"', async () => {
    /* fact sheet (2026-09-05): the declared value is a FACT on the Details outcome line, closed or open */
    await expect(page.getByTestId('prod-fact-fineness')).toContainText('999.9');
    await page.getByTestId('prod-tab-product').click();
    const view = page.locator('.itab');
    await expect(view.getByText('Fineness', { exact: true }).first()).toBeVisible();
    await expect(view.getByText('999.9', { exact: true }).first()).toBeVisible();
  });

  await test.step('EDIT — the input carries the value, and a change round-trips as a number', async () => {
    await page.getByTestId('cat-edit').click();
    const f = page.getByTestId('cat-field-fineness');
    await expect(f).toHaveValue('999.9');
    await f.fill('995');
    const saved = page.waitForResponse((r) => /\/api\/products\//.test(r.url()) && r.request().method() === 'PATCH' && r.status() < 400, { timeout: 45000 });
    await page.getByTestId('cat-save').click();
    const resp = await saved;
    const body = await resp.json().catch(() => ({}));
    const stored = body && body.item && body.item.item_data && body.item.item_data.fineness;
    expect(stored, 'fineness must be stored as a NUMBER, not the string typed').toBe(995);
    await settle(page);
    await expect(page.locator('.itab').getByText('995', { exact: true }).first()).toBeVisible({ timeout: 15000 });   /* on the Details outcome line AND in the row */
  });
});
