/**
 * flows/storefront.js — THE STOREFRONT CHECKOUT, DRIVEN ONCE (Design 2: a driver is how a screen is operated; a spec supplies the job).
 * Lifted from tour-two.spec.js on 2026-09-06 when [SHOP-01] was found still pressing a single-product "order" button the shared
 * picker no longer draws (5 profiles red for a control that does not exist). Two specs, one way to check out.
 *
 *   shopCheckout(page, { name?, contact, otp? }) → the /order/confirm response
 *     precondition: something is in the cart (fixtures.shopAdd, or a cart-add click)
 */
const DEV_OTP = process.env.DEV_OTP || '123456';
async function shopCheckout(page, o) {
  o = o || {};
  /* the compact bar ("🛒 6 ✕") opens into the cart, where Checkout lives */
  if (!(await page.getByTestId('cart-checkout').isVisible().catch(() => false))) { await page.locator('[data-testid^="cart-cbcart"]').first().click(); }
  await page.getByTestId('cart-checkout').click({ timeout: 20000 });
  /* the checkout is a two-step sheet — Pickup or delivery → Who you are (the review is folded into the second); "Continue" carries it to the contact step */
  for (let i = 0; i < 5 && !(await page.getByTestId('shop-contact').isVisible().catch(() => false)); i++) {
    const modeBtn = page.getByTestId('shop-mode-delivery');   /* the first step asks Pickup or Delivery; the address field only exists for Delivery */
    if (await modeBtn.isVisible().catch(() => false) && !(await page.getByTestId('shop-area').isVisible().catch(() => false))) await modeBtn.click();
    if (await page.getByTestId('shop-area').isVisible().catch(() => false)) {
      await page.getByTestId('shop-area').fill(o.area || 'Perumbakkam, Chennai 600126');
      const d = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
      const dt = page.getByTestId('shop-date'); if (await dt.isVisible().catch(() => false)) { await dt.fill(d).catch(async () => { await dt.type(d); }); }
      const tm = page.getByTestId('shop-time'); if (await tm.isVisible().catch(() => false)) {
        const tag = await tm.evaluate((el) => el.tagName + ':' + (el.type || ''));
        if (/SELECT/.test(tag)) await tm.selectOption({ index: 1 }).catch(() => {}); else await tm.fill(/time/.test(tag) ? '10:00' : 'morning').catch(() => {});
      }
    }
    const next = page.getByRole('button', { name: /Next|Continue/i }).first();   /* Review says "Continue →" */
    if (await next.isVisible().catch(() => false)) { await next.click({ timeout: 10000 }); await page.waitForTimeout(400); } else break;
  }
  /* Who you are: a name and a contact; ONE button carries both halves — "Send me a code", then "Place order" */
  const nameBox = page.getByTestId('shop-name'); if (await nameBox.isVisible().catch(() => false)) await nameBox.fill(o.name || 'E2E Customer');
  await page.getByTestId('shop-contact').fill(o.contact || ('e2e' + Date.now() + '@test.example'));
  const submit = page.locator('[data-testid="shop-cart-submit"], [data-testid="shop-send-code"]').first();
  const started = page.waitForResponse((r) => /\/order\/start$/.test(r.url()) && r.request().method() === 'POST', { timeout: 30000 });
  await submit.click({ timeout: 20000 }); const sr = await started;
  const sj = await sr.json().catch(() => ({})); const otp = o.otp || sj.dev_otp || DEV_OTP;
  const otpBox = page.locator('[data-testid="shop-otp"], #o_otp, input[inputmode="numeric"]').first();
  await otpBox.waitFor({ timeout: 20000 }); await otpBox.fill(otp);
  const confirmed = page.waitForResponse((r) => /\/order\/confirm$/.test(r.url()) && r.request().method() === 'POST', { timeout: 45000 });
  await page.locator('[data-testid="shop-cart-submit"], [data-testid="shop-place-order"]').first().click({ timeout: 20000 });
  await page.locator('[data-testid="confirm-ok"]').click({ timeout: 10000 }); /* UX-6: Place order asks first; the yes sends */
  return confirmed;
}
module.exports = { shopCheckout };
