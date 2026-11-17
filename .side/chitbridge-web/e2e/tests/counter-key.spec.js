// counter-key.spec.js — [TILL-04] THE COUNTER BILLS FOR THE SHOP YOU CLICKED IT FROM. Athi, 2026-09-08, on a counter opened from tallytest:
// "i dont know what is happening, this is counter for tallytest?" — it was not. The header read `e2eco-mts0e88b673`, a throwaway
// entity a test run had made that morning, and the footer correctly said "No GSTIN on this shop, so no GST is charged".
//
// ⚠️⚠️ THE DEFECT. counterHasKey() asked only "is there a key on this device?" — never "is it THIS shop's key?". So the first shop
// ever paired in a browser kept the counter forever: counterGo() opened /till.html with NO key in the address, and the page fell
// back to the one in localStorage. One browser, many shops, one `cb_till_key`. Nothing warned; the shop name in the corner was the
// only tell, and a long entity id had pushed it off the left edge.
//
// ⭐ Driven through the app's OWN controls — the rail, then the door — because the bug was in what the BUTTON hands over, and a
// test that called counterMint() directly would have passed on the broken build.
// ⚠️ ADDING IS A DELIBERATE ACT SINCE 2026-09-10. A click on a row CHOOSES it; the + button (or Enter) puts it
// on the bill. Athi: "by just clicking the list it gets added to the cart, that is not my intention." These specs
// clicked the row and expected a bill line — so they are what caught the change, correctly, and they drive the
// new control rather than the old one.
const { test, expect } = require('@playwright/test');
const { mintEntity, addProduct, clickNav } = require('../fixtures');

/** open the counter the way a person does: rail → Counter → "use this device", and catch the tab it opens */
async function openCounter(page, context) {
  await clickNav(page, 'counter');
  await page.getByTestId('counter-door').waitFor({ timeout: 30000 });
  const opened = context.waitForEvent('page', { timeout: 60000 });
  await page.getByTestId('counter-open-here').click();
  const till = await opened;
  /* ⚠️ the engines arrive as their own <script src>, the page's OWN functions in an inline block AFTER them — so waiting on
     CBTax alone lets a half-loaded page through, and the next evaluate() says "refresh is not defined" (it did, on the 2nd open) */
  await till.waitForFunction(() => window.CBOffers && window.CBTax && typeof window.refresh === 'function', null, { timeout: 60000 });
  await till.waitForFunction(() => document.getElementById('shopname').textContent !== 'Not paired yet', null, { timeout: 60000 });
  await till.evaluate(() => refresh());
  await till.waitForSelector('[data-testid="till-hit-0"]', { timeout: 60000 });
  return till;
}

test('[TILL-04] a second shop in the same browser gets its OWN counter, not the first shop\'s', async ({ page, context }) => {
  test.setTimeout(420000);

  let shopA;
  await test.step('shop A pairs a counter on this device', async () => {
    await mintEntity(page, { fresh: true, name: 'Shop A ' + Date.now().toString().slice(-6) });
    shopA = await page.evaluate(() => SESSION.entity);
    await addProduct(page, { name: 'Alpha rice', unit: 'kg', price: 60, code: 'ALPHA' });
    const till = await openCounter(page, context);
    const shown = await till.evaluate(() => (S && S.shop && S.shop.name) || '');
    expect(shown, 'the counter opened for a shop that is not the one it was clicked from').toBe(shopA);
    expect(await till.evaluate(() => (S.items || []).some((i) => i.name === 'Alpha rice'))).toBe(true);
    /* ⭐ and it takes some money, because a QUEUED bill is the part that would have been misfiled: refresh() calls drain(), so
       shop A's unsent sale would have gone up under shop B's key */
    await till.click('[data-testid="till-add-0"]');
    await till.click('[data-testid="till-pay-cash"]');
    await till.fill('#tendered', '500');
    await till.click('#save');
    await till.waitForSelector('#sliptitle');
    await till.click('#slipdlg button:has-text("Close")');
    expect(await till.evaluate(() => (STATE.today && STATE.today.count) || 0), 'shop A rang up a sale').toBeGreaterThan(0);
    await till.close();
  });

  await test.step('⚠️⚠️ the SAME browser now belongs to shop B — the key on this device is A\'s, and A\'s is not a key here', async () => {
    await mintEntity(page, { fresh: true, name: 'Shop B ' + Date.now().toString().slice(-6) });
    const shopB = await page.evaluate(() => SESSION.entity);
    expect(shopB).not.toBe(shopA);
    /* the stored key is still shop A's — the whole point. If counterHasKey() only asks "is there a key?", the next line reopens A. */
    expect(await page.evaluate(() => !!localStorage.getItem('cb_till_key')), 'the device still holds a key').toBe(true);
    await addProduct(page, { name: 'Beta wheat', unit: 'kg', price: 45, code: 'BETA' });

    const till = await openCounter(page, context);
    const shown = await till.evaluate(() => (S && S.shop && S.shop.name) || '');
    expect(shown, 'the counter is still billing for the FIRST shop ever paired in this browser').toBe(shopB);
    expect(shown).not.toBe(shopA);
    expect(await till.evaluate(() => (S.items || []).some((i) => i.name === 'Beta wheat')), 'shop B own shelf').toBe(true);
    expect(await till.evaluate(() => (S.items || []).some((i) => i.name === 'Alpha rice')), 'and NOT the other shop own stock').toBe(false);
    /* and the device now remembers whose key it holds, so this cannot drift back */
    expect(await page.evaluate(() => localStorage.getItem('cb_till_entity'))).toBe(await page.evaluate(() => SESSION.entityId));
    /* ⚠️⚠️ AND THE MONEY DID NOT FOLLOW. The bills, the queue and the day's count lived in a database named after the DEVICE, so
       shop A's takings showed up as shop B's — and A's unsent bills would have drained under B's key on the first refresh. */
    expect(await till.evaluate(() => (STATE.today && STATE.today.count) || 0), 'the other shop takings are on this counter').toBe(0);
    expect(await till.evaluate(async () => ((await HOST.bills()) || []).length), 'and so are its bills').toBe(0);
    await till.close();
  });
});
