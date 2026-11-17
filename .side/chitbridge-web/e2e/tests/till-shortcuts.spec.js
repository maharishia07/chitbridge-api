// [TILL-30] THE COUNTER'S OWN KEYBOARD — F-KEYS DO WHAT THE BUTTONS SAY THEY DO.
//
// Athi, 2026-09-17: asked for Playwright coverage of the counter's shortcuts and function keys, so a human does
// not have to press each one by hand to know they still work. till.html binds F2/F4/F6/F7/F8/F9/F10 and Escape
// globally (its own `keydown` listener) — separate from keyboard.spec.js/keymap.spec.js, which drive the
// back-office app (compose, ?, Escape) and never open the counter at all. Until this spec, none of the
// counter's own bindings had ever been pressed by a test — only clicked, on the button that names the key
// beside its own label ("Save & print · F9").
const { test, expect } = require('@playwright/test');
const { mintEntity } = require('../fixtures');
const TILL = process.env.CB_TILL_BASE || '';

const app = (page, name, opts) => page.evaluate(async ({ name, opts }) => {
  try { return { ok: true, body: await api(name, opts || {}) }; }
  catch (e) { return { ok: false, message: (e && e.message) || String(e) }; }
}, { name, opts });

test('[TILL-30] F2 search, F7 who, F6 park and F9 finish all work from the keyboard alone', async ({ page, context }) => {
  test.setTimeout(180000);
  await mintEntity(page, { fresh: true, name: 'Keys ' + Date.now().toString().slice(-6) });
  await page.evaluate(async () => { if (typeof ensureCap === 'function') await ensureCap('admin'); });
  const made = await app(page, 'prodAdd', { body: { item_data: { name: 'Keyshortcut tea', price: 90, unit: 'piece' } } });
  expect(made.ok, made.message).toBe(true);
  const id = (await app(page, 'counterAdd', { body: { name: 'Keys desk' } })).body.counter.id;
  const key = (await app(page, 'counterOpen', { params: { id } })).body.key;

  const till = await context.newPage();
  till.on('pageerror', (e) => console.log('   till threw: ' + e.message));
  await till.goto(TILL + '/till.html#key=' + encodeURIComponent(key));
  await till.waitForSelector('[data-testid="till-hit-0"]', { timeout: 60000 });
  await till.click('[data-testid="till-add-0"]');
  await expect.poll(() => till.evaluate(() => CART.length)).toBeGreaterThan(0);

  await test.step('F2 moves focus back to the search box from somewhere else', async () => {
    await till.locator('#cname').click();
    await expect(till.locator('#cname')).toBeFocused();
    await till.keyboard.press('F2');
    await expect(till.locator('#q')).toBeFocused();
  });

  await test.step('F7 opens who-is-serving, Escape closes it without touching the bill', async () => {
    await till.keyboard.press('F7');
    await expect(till.locator('[data-testid="till-who-now"]')).toBeVisible();
    await till.keyboard.press('Escape');
    await expect(till.locator('[data-testid="till-who-now"]')).toBeHidden();
    expect(await till.evaluate(() => CART.length), 'closing the who dialog must not touch the bill').toBeGreaterThan(0);
  });

  await test.step('F6 parks the current bill, clears the screen, and it is waiting to be brought back', async () => {
    await till.keyboard.press('F6');
    await expect.poll(() => till.evaluate(() => CART.length)).toBe(0);
    await expect(till.locator('[data-testid="till-parked-0"]')).toBeVisible();
  });

  await test.step('bringing it back, taking the money and F9 finishes the sale — same as pressing Save', async () => {
    await till.click('[data-testid="till-parked-0"]');
    await expect.poll(() => till.evaluate(() => CART.length)).toBeGreaterThan(0);
    await till.click('[data-testid="till-pay-cash"]');
    const total = await till.evaluate(() => billMoney().net);
    await till.fill('#tendered', String(total));
    await till.keyboard.press('F9');
    await expect(till.locator('#sliptitle')).toBeVisible({ timeout: 15000 });
    await till.click('#slipdlg button:has-text("Close")');
    expect(await till.evaluate(() => CART.length), 'a finished sale leaves the screen clear for the next customer').toBe(0);
  });
});
