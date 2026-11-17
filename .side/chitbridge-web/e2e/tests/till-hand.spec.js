// [TILL-32] LEFT HAND / RIGHT HAND — the whole mirror, and the one place it deliberately does nothing.
//
// Athi, 2026-09-18: *"left hander / right hander, not just the menu, do we need to switch anything else, can
// you check the standard?"* → *"do the full mirror"*. The standard is the thumb zone: the comfortable arc
// mirrors with the hand, so what a thumb touches EVERY SALE has to move — the + on a shelf row, the phone's
// primary step button, the pay row and Save & print, and a key tile's corner controls.
//
// ⚠️ AND IT MUST NOT MOVE A MOUSE-DRIVEN TERMINAL. Which hand someone writes with changes nothing when they
// are holding a mouse, and a shopkeeper who sets this on the tablet must not find the 24" till rearranged.
// That exemption is the half of this feature most likely to be broken by a later CSS edit, so it is asserted.
const { test, expect } = require('@playwright/test');
const { mintEntity, addProduct } = require('../fixtures');
const TILL = process.env.CB_TILL_BASE || '';

const xOf = (page, sel) => page.locator(sel).first().evaluate((el) => Math.round(el.getBoundingClientRect().x));

test('[TILL-32] a left-handed counter moves what a thumb touches, and leaves a mouse alone', async ({ page, browser }) => {
  test.setTimeout(240000);
  await mintEntity(page, { fresh: true, name: 'hand' + Date.now().toString(36) });
  await addProduct(page, { name: 'Filter Coffee', unit: 'cup', price: 25, code: 'FC32' });
  const key = await page.evaluate(async () => {
    if (typeof ensureCap === 'function') await ensureCap('admin');
    const r = await api('keysMint', { body: { name: 'hand counter', scopes: ['till'], days: 1 } });
    return (r && (r.key || r.api_key)) || null;
  });

  /* a tablet: a real touch screen, the device this setting is FOR */
  const touch = await browser.newContext({ viewport: { width: 820, height: 1180 }, hasTouch: true, isMobile: true });
  const till = await touch.newPage();
  await till.goto(TILL + '/till.html#key=' + encodeURIComponent(key));
  await till.waitForSelector('[data-testid="till-hit-0"]', { timeout: 60000 });

  await test.step('right hand (the default) — the + sits at the far side of the row, under the thumb', async () => {
    await till.evaluate(() => { ls.set('cb_till_hand', 'right'); applyHand(); });
    expect(await till.evaluate(() => document.body.getAttribute('data-hand'))).toBe('right');
    const rowX = await xOf(till, '.hit');
    const addX = await xOf(till, '.hit .addbtn');
    expect(addX, 'the + belongs at the end of the row for a right hander').toBeGreaterThan(rowX + 100);
  });

  await test.step('⭐ left hand — the + crosses to the other side of the row', async () => {
    await till.evaluate(() => { ls.set('cb_till_hand', 'left'); applyHand(); });
    expect(await till.evaluate(() => document.body.getAttribute('data-hand'))).toBe('left');
    const rowX = await xOf(till, '.hit');
    const addX = await xOf(till, '.hit .addbtn');
    expect(addX, 'the + did not move to the left hand').toBeLessThan(rowX + 100);
  });

  await test.step('⭐ and so do the pay buttons and the button that finishes the sale', async () => {
    /* ⚠️ THE SELL PANE ONLY. Receive and despatch carry their own `.go` rows; they are display:none, so their
       buttons measure x=0 and sorted to the front — the first run of this case failed on a Clear button that
       was not on screen at all. */
    const order = await till.evaluate(() => {
      const seen = (el) => el.getBoundingClientRect().width > 0;
      const vis = (el) => el.getBoundingClientRect().x;
      const pick = (sel) => [...document.querySelectorAll(sel)].filter(seen).sort((a, b) => vis(a) - vis(b));
      return { pay: pick('#pay button').map((b) => b.textContent.trim().split(/\s+/)[0]),
               go: pick('#pane_sell .go button').map((b) => b.id || b.textContent.trim().split(/\s+/)[0]) };
    });
    /* Save & print is the primary; for a left hander it comes first across the row */
    expect(order.go[0], 'Save & print should sit under the left thumb').toBe('save');
    expect(order.pay[0], 'the pay row mirrors too').not.toBe('Cash');
  });

  await test.step('⚠️ a mouse-driven terminal is NOT rearranged, whatever the hand says', async () => {
    const desk = await browser.newContext({ viewport: { width: 1366, height: 768 } });   // no touch → pointer:fine
    const big = await desk.newPage();
    await big.goto(TILL + '/till.html#key=' + encodeURIComponent(key));
    await big.waitForSelector('[data-testid="till-hit-0"]', { timeout: 60000 });
    await big.evaluate(() => { ls.set('cb_till_hand', 'left'); applyHand(); });
    expect(await big.evaluate(() => document.body.getAttribute('data-hand')), 'the setting is still recorded').toBe('left');
    const rowX = await xOf(big, '.hit');
    const addX = await xOf(big, '.hit .addbtn');
    expect(addX, 'a mouse counter must keep its furniture where it was').toBeGreaterThan(rowX + 100);
    const goFirst = await big.evaluate(() => {
      const vis = (el) => el.getBoundingClientRect().x;
      return [...document.querySelectorAll('#pane_sell .go button')]
        .filter((el) => el.getBoundingClientRect().width > 0)
        .sort((a, b) => vis(a) - vis(b))[0].textContent.trim().split(/\s+/)[0];
    });
    expect(goFirst, 'Clear stays first on a desktop till').toBe('Clear');
    await desk.close();
  });

  await touch.close();
});
