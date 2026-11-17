// [TILL-28] THE COUNTER WEARS A SCREEN FROM THE LIBRARY. Athi, 2026-09-17: *"a library of different designs and colour
// schemes so people, or their system, can pick up the required format."* The quick keys are drawn by lib/screen-kit
// (/engine/screen.js). This drives the counter the way a cashier does:
//   · the × on a key marks it SOLD OUT for today — it leaves the keys and waits in the tray, and the tray brings it back;
//   · ⚙ Screen → Style / Keys / Colours changes what the keys look like and the ground they sit on;
//   · a sold-out item is still billable from search (only the key is gone, not the product).
const { test, expect } = require('@playwright/test');
const { mintEntity, addProduct } = require('../fixtures');

// ⭐ point the counter at a local build: CB_TILL_BASE=http://localhost:5173
const TILL = process.env.CB_TILL_BASE || '';

test('[TILL-28] sold-out tray, key styles and colour schemes on the counter', async ({ page, context }) => {
  test.setTimeout(420000);
  await mintEntity(page, { fresh: true, name: 'Scr ' + Date.now().toString().slice(-6) });
  await addProduct(page, { name: 'Idli 2 pc', unit: 'plate', price: 40, code: 'IDL28' });
  await addProduct(page, { name: 'Masala dosa', unit: 'plate', price: 70, code: 'DOS28' });
  await addProduct(page, { name: 'Filter coffee', unit: 'cup', price: 25, code: 'COF28' });

  let till;
  await test.step('pair a counter', async () => {
    const key = await page.evaluate(async () => {
      if (typeof ensureCap === 'function') await ensureCap('admin');
      const r = await api('keysMint', { body: { name: 'screen counter', scopes: ['till'], days: 1 } });
      return (r && (r.key || r.api_key)) || null;
    });
    expect(key, 'no till key was minted').toBeTruthy();
    till = await context.newPage();
    const errors = [];
    till.on('pageerror', (e) => errors.push(e.message));
    till.errors = errors;
    await till.goto(TILL + '/till.html#key=' + encodeURIComponent(key));
    await till.waitForFunction(() => window.CBOffers && window.CBScreen, null, { timeout: 40000 });
    await till.evaluate(() => refresh());
    await expect(till.locator('[data-testid="till-quick-2"]')).toBeVisible({ timeout: 40000 });
  });

  await test.step('the keys are the library’s', async () => {
    await expect(till.locator('[data-testid="till-quick-0"]')).toHaveClass(/sk-tile/);
    await expect(till.locator('.quick')).toHaveClass(/sk-style-classic/);
  });

  let soldName;
  await test.step('⭐ × on a key → sold out today → in the tray → back on the keys', async () => {
    const key0 = till.locator('[data-testid="till-quick-0"]');
    soldName = (await key0.locator('b').first().innerText()).trim();
    const keysBefore = await till.locator('[data-testid^="till-quick-"]').evaluateAll(
      (els) => els.filter((e) => /^till-quick-\d+$/.test(e.dataset.testid)).length);
    await till.locator('[data-testid="till-quick-hide-0"]').click();
    await expect(till.locator('[data-testid="till-soldout"]')).toBeVisible();
    await expect(till.locator('[data-testid="till-soldout-0"]')).toContainText(soldName);
    const keysAfter = await till.locator('[data-testid^="till-quick-"]').evaluateAll(
      (els) => els.filter((e) => /^till-quick-\d+$/.test(e.dataset.testid)).map((e) => e.innerText));
    expect(keysAfter.length, 'the sold-out key is still on the keys').toBe(keysBefore - 1);
    expect(keysAfter.join('|')).not.toContain(soldName);

    /* ⚠️ sold out is a KEY state, not a product state — search still finds it (the cashier may have been wrong) */
    const found = await till.evaluate((n) => ((S && S.items) || []).some((i) => i.name === n), soldName);
    expect(found, 'marking sold out removed the product from the counter').toBe(true);

    /* it survives a reload the same day */
    await till.reload();
    await till.waitForFunction(() => window.CBScreen, null, { timeout: 40000 });
    await expect(till.locator('[data-testid="till-soldout-0"]')).toContainText(soldName, { timeout: 40000 });

    await till.locator('[data-testid="till-soldout-0"]').click();
    await expect(till.locator('[data-testid="till-soldout"]')).toHaveCount(0);
    const back = await till.locator('[data-testid^="till-quick-"]').evaluateAll(
      (els) => els.filter((e) => /^till-quick-\d+$/.test(e.dataset.testid)).map((e) => e.innerText).join('|'));
    expect(back, 'the tray did not bring the key back').toContain(soldName);
  });

  await test.step('⭐⭐ ⚙ Screen: style, keys and colours change the screen', async () => {
    const ground = () => till.evaluate(() => getComputedStyle(document.body).backgroundColor);
    const before = await ground();
    await till.evaluate(() => openSettings('screen'));
    await expect(till.locator('[data-testid="till-set-preset"]')).toBeVisible();

    /* every preset and key style in the library is offered */
    const offered = await till.evaluate(() => ({
      presets: [...document.querySelectorAll('#set_preset option')].map((o) => o.value),
      tiles: [...document.querySelectorAll('#set_tile option')].map((o) => o.value),
      lib: { presets: Object.keys(CBScreen.PRESETS), tiles: Object.keys(CBScreen.TILES) },
    }));
    expect(offered.presets.sort()).toEqual(offered.lib.presets.sort());
    expect(offered.tiles.sort()).toEqual(offered.lib.tiles.sort());

    await till.locator('[data-testid="till-set-tile"]').selectOption('hotkey');
    await expect(till.locator('.quick')).toHaveClass(/sk-style-hotkey/);

    await till.locator('[data-testid="till-set-theme"]').selectOption('navy');
    await expect.poll(ground, { message: 'navy did not repaint the counter' }).not.toBe(before);
    await till.screenshot({ path: 'test-results/till-28-navy-hotkey.png' });

    await till.locator('[data-testid="till-set-preset"]').selectOption('counterClassic');
    await expect(till.locator('.quick')).toHaveClass(/sk-style-classic/);
    await expect.poll(ground, { message: 'the classic preset did not bring its own colours back' }).toBe(before);

    /* the choice is kept on this device */
    await till.locator('[data-testid="till-set-tile"]').selectOption('colourBlock');
    await till.reload();
    await till.waitForFunction(() => window.CBScreen, null, { timeout: 40000 });
    await expect(till.locator('.quick')).toHaveClass(/sk-style-colourBlock/, { timeout: 40000 });
  });

  await test.step('it still bills', async () => {
    await till.locator('[data-testid="till-quick-0"]').click();
    await expect.poll(() => till.evaluate(() => CART.length)).toBe(1);
    expect(till.errors, 'the counter threw').toEqual([]);
  });
});

// [TILL-29] ON A PHONE, SELLING IS THREE STEPS — Items · Bill · Pay, with a bar at the thumb that always says how many lines and
// how much. Nothing on the sell screen is dropped: each part sits on one of the three steps. A desktop never sees the bar.
test('[TILL-29] a phone sells in three steps and the bill fits the screen', async ({ page, browser }) => {
  test.setTimeout(420000);
  await mintEntity(page, { fresh: true, name: 'Ph ' + Date.now().toString().slice(-6) });
  await addProduct(page, { name: 'Masala dosa', unit: 'plate', price: 70, code: 'DOS29' });
  await addProduct(page, { name: 'Filter coffee', unit: 'cup', price: 25, code: 'COF29' });
  const key = await page.evaluate(async () => {
    if (typeof ensureCap === 'function') await ensureCap('admin');
    const r = await api('keysMint', { body: { name: 'phone counter', scopes: ['till'], days: 1 } });
    return (r && (r.key || r.api_key)) || null;
  });
  expect(key, 'no till key was minted').toBeTruthy();

  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const till = await phone.newPage();
  const errors = [];
  till.on('pageerror', (e) => errors.push(e.message));
  await till.goto(TILL + '/till.html#key=' + encodeURIComponent(key));
  await till.waitForFunction(() => window.CBScreen, null, { timeout: 40000 });
  await till.evaluate(() => refresh());
  await expect(till.locator('[data-testid="till-quick-1"]')).toBeVisible({ timeout: 40000 });

  const bar = till.locator('[data-testid="till-stepbar"]');
  await test.step('Items: keys on screen, the bill is not, Pay waits for a line', async () => {
    await expect(bar).toBeVisible();
    await expect(till.locator('[data-testid="till-step-pick"]')).toHaveAttribute('aria-current', 'step');
    await expect(till.locator('#cart')).toBeHidden();
    await expect(till.locator('[data-testid="till-step-pay"]')).toBeDisabled();
  });

  await test.step('adding stays on Items and the bar counts it', async () => {
    await till.locator('[data-testid="till-quick-0"]').click();
    await till.locator('[data-testid="till-quick-0"]').click();
    await till.locator('[data-testid="till-quick-1"]').click();
    await expect(till.locator('[data-testid="till-step-count"]')).toHaveText('2');
    await expect(till.locator('[data-testid="till-step-pick"]')).toHaveAttribute('aria-current', 'step');
  });

  await test.step('⭐ Bill: every line with its value, inside the screen', async () => {
    await till.locator('[data-testid="till-step-bill"]').click();
    await expect(till.locator('[data-testid="till-line-1"]')).toBeVisible();
    await expect(till.locator('#save')).toBeHidden();
    for (const k of [0, 1]) {
      const box = await till.locator(`[data-testid="till-amt-${k}"]`).boundingBox();
      expect(box, `line ${k} has no value on screen`).toBeTruthy();
      expect(box.x + box.width, `line ${k}'s value runs off the phone`).toBeLessThanOrEqual(390);
    }
    const wide = await till.evaluate(() => document.documentElement.scrollWidth);
    expect(wide, 'the page scrolls sideways on a phone').toBeLessThanOrEqual(390);
    await expect(till.locator('[data-testid="till-cart-cols"] .pqh')).toHaveCount(0);   /* no empty column left behind */
  });

  await test.step('Pay: the ways to pay and Save, not the lines', async () => {
    await till.locator('[data-testid="till-step-pay"]').click();
    await expect(till.locator('#save')).toBeVisible();
    await expect(till.locator('#pay')).toBeVisible();
    await expect(till.locator('#cart')).toBeHidden();
    /* the TOTAL stays on the Pay step (the line count lives in the folded breakdown, as on a desktop) */
    await expect(till.locator('[data-testid="till-total"]')).toBeVisible();
    const net = await till.evaluate(() => money(billMoney().net));
    await expect(till.locator('[data-testid="till-total"]')).toContainText(net);
    await expect(till.locator('[data-testid="till-step-bill"]')).toContainText(net);
  });

  await test.step('clearing the bill starts the next customer at Items', async () => {
    await till.evaluate(() => clearBill());
    await expect(till.locator('[data-testid="till-step-pick"]')).toHaveAttribute('aria-current', 'step');
    await expect(till.locator('[data-testid="till-step-pay"]')).toBeDisabled();
  });
  expect(errors, 'the phone counter threw').toEqual([]);
  await phone.close();

  await test.step('a desktop counter has no step bar', async () => {
    const desk = await page.context().newPage();
    await desk.setViewportSize({ width: 1366, height: 768 });
    await desk.goto(TILL + '/till.html#key=' + encodeURIComponent(key));
    await desk.waitForFunction(() => window.CBScreen, null, { timeout: 40000 });
    await expect(desk.locator('body')).not.toHaveClass(/\bsteps\b/);
    await expect(desk.locator('[data-testid="till-stepbar"]')).toBeHidden();
    await desk.close();
  });
});
