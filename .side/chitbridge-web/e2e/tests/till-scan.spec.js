// [TILL-27] A SCAN ADDS ONE — AND THE COUNTER LIVES THROUGH IT.
//
// Found 2026-09-17 by the Prestige demo: typing a product's exact code into the search box froze the counter until the tab
// crashed. scanned() ran on every repaint; once the search stopped clearing after an add (2026-09-16), each repaint found the same
// code and added it again — add → paintHits → scanned → add. The scanner's trailing Enter would also have added a second one.
// Also here: a counter opened for the first time, online, reads its shop by itself instead of waiting for ↻.
const { test, expect } = require('@playwright/test');
const { mintEntity } = require('../fixtures');
const TILL = process.env.CB_TILL_BASE || '';

const app = (page, name, opts) => page.evaluate(async ({ name, opts }) => {
  try { return { ok: true, body: await api(name, opts || {}) }; }
  catch (e) { return { ok: false, message: (e && e.message) || String(e) }; }
}, { name, opts });

test('[TILL-27] a scanned code adds exactly one, survives a repaint, and a later Enter adds another', async ({ page, context }) => {
  test.setTimeout(300000);
  await mintEntity(page, { fresh: true, name: 'Scan ' + Date.now().toString().slice(-6) });
  await page.evaluate(async () => { if (typeof ensureCap === 'function') await ensureCap('admin'); });
  const CODE = 'SC-TEA-250';
  const made = await app(page, 'prodAdd', { body: { item_data: { name: 'Scan test tea 250g', price: 120, unit: 'piece', code: CODE } } });
  expect(made.ok, made.message).toBe(true);
  await app(page, 'prodAdd', { body: { item_data: { name: 'Scan test tea 500g', price: 230, unit: 'piece', code: CODE + '0' } } });
  const id = (await app(page, 'counterAdd', { body: { name: 'Scan desk' } })).body.counter.id;
  const key = (await app(page, 'counterOpen', { params: { id } })).body.key;

  const till = await context.newPage();
  let crashed = false;
  till.on('crash', () => { crashed = true; });
  await till.goto(TILL + '/till.html#key=' + encodeURIComponent(key));

  await test.step('⭐ a new counter reads its shop by itself — nobody presses ↻', async () => {
    await till.waitForSelector('[data-testid="till-hit-0"]', { timeout: 60000 });
  });

  const qty = () => till.evaluate((code) => CART.filter((c) => /250g/.test(c.name)).reduce((s, c) => s + c.qty, 0), CODE);

  await test.step('⚠️⚠️ a scan (code + Enter) adds ONE, and the counter does not freeze', async () => {
    await till.locator('#q').fill(CODE, { timeout: 8000 });
    await till.keyboard.press('Enter');
    expect(crashed, 'the counter tab crashed on a scanned code').toBe(false);
    expect(await qty(), 'a scan added the wrong number').toBe(1);
    expect(await till.evaluate(() => CART.length), 'the longer code that merely STARTS with the scan was added too').toBe(1);
  });

  await test.step('⚠️ a repaint or a shop re-read with the code still in the box adds nothing', async () => {
    await till.evaluate(() => { paintHits(); paintHits(); });
    await till.evaluate(() => refresh());
    expect(await qty(), 'a repaint billed the scanned item again').toBe(1);
  });

  await test.step('⭐ a person pressing Enter afterwards still adds another', async () => {
    await till.waitForTimeout(600);
    await till.locator('#q').press('Enter');
    expect(await qty()).toBe(2);
  });

  await test.step('⭐ the next scan types over the armed box and adds again', async () => {
    await till.locator('#q').pressSequentially(CODE, { delay: 5 });
    await till.keyboard.press('Enter');
    expect(await qty(), 'a second scan of the same code').toBe(3);
    expect(crashed).toBe(false);
  });
});
