// MODULE: Storefront — a customer orders from a public shop → a chit lands back with the shop.
// FLOW: open shop → pick a finish → Order → qty/name/contact → Send code → OTP → Place order → "Order placed".
// DATA: CB_SHOP_BRIDGE = a seeded public shop's bridge id; the sign-in code from fixtures (E2E_TESTER_CODE on a deployed api).
// LOCATORS: shop-order-* · shop-combo · shop-qty · shop-name · shop-area · shop-contact · shop-send-code · shop-otp · shop-place-order
const { test, expect } = require('@playwright/test');
require('../fixtures').needCode(test);   // SEC1: no sign-in code for this target (E2E_TESTER_CODE) → the file SKIPS with a CI warning
const { shopCheckout } = require('../flows/storefront');
const { DEV_OTP } = require('../fixtures');

test.describe('Module · Storefront', () => {
  test('[SHOP-01] customer places an order → chit', async ({ page }) => {
    const bridge = process.env.CB_SHOP_BRIDGE;
    test.skip(!bridge, 'set CB_SHOP_BRIDGE to a seeded public shop bridge id');

    /* 2026-09-06: this spec pressed a single-product 'order' button from the finish cards — a control the shared picker never
       draws — and was red in five browsers for it. The customer's path IS the cart: + on a row, then the one checkout driver. */
    await test.step('open the shop, put the first line in the basket', async () => {
      await page.goto(`/shop.html?bridge=${bridge}`);
      const add = page.locator('[data-testid="cart-add"]').first(); await add.waitFor({ timeout: 40000 }); await add.click();
      await expect(page.locator('[data-testid^="cart-count-"]').first()).toBeVisible();
    });
    await test.step('checkout → contact → code → place the order', async () => {
      const cr = await shopCheckout(page, { name: 'E2E Customer' });
      const cj = await cr.json().catch(() => ({}));
      expect(cr.status(), JSON.stringify(cj).slice(0, 200)).toBeLessThan(400);
      await expect(page.getByText(/Order placed/i)).toBeVisible({ timeout: 20000 });
    });
  });
});
