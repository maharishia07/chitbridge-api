// [TILL-T1] ROUND T1 — the counter's morning walk of 2026-10-10 (C:/dev/TEST-LOG-2026-10-09.md, M30–M74), on a terminal
// AND a phone. Every assertion reads the SCREEN (textContent, visibility, a box), never the array behind it — the walk's
// rows were all things a person READ. [[feedback-repaint-locally]] "anything a person READS is asserted from the DOM".
//
// ⚠️ WRITTEN, NOT YET RUN (round T1 was built on a low-memory PC with no browser to spare). The first run may need its
// waits tuned; the assertions are the definition.
const { test, expect } = require('@playwright/test');
const { mintEntity, addProduct } = require('../fixtures');
const TILL = process.env.CB_TILL_BASE || '';

async function openTill(page, context, size, tag) {
  await mintEntity(page, { fresh: true, name: 't1' + tag + Date.now().toString(36) });
  await addProduct(page, { name: 'Idli', unit: 'plate', price: 40, code: 'T1ID' });
  await addProduct(page, { name: 'Filter Coffee', unit: 'cup', price: 25, code: 'T1FC' });
  const key = await page.evaluate(async () => {
    if (typeof ensureCap === 'function') await ensureCap('admin');
    const r = await api('keysMint', { body: { name: 't1 counter', scopes: ['till'], days: 1 } });
    return (r && (r.key || r.api_key)) || null;
  });
  const till = await context.newPage();
  await till.setViewportSize(size);
  await till.goto(TILL + '/till.html#key=' + encodeURIComponent(key));
  await till.waitForFunction(() => typeof paintMenu === 'function' && window.S && S.items && S.items.length >= 2, null, { timeout: 60000 });
  /* ⚠️ printing is silenced the way a person would never see — printDoc() honours a replaced window.print (M46) */
  await till.evaluate(() => { window.print = function(){ window.__printed = (window.__printed || 0) + 1; }; });
  return till;
}

test('[TILL-T1a] terminal: one name per pill, the GSTIN, shop time, the line chip, the lock face', async ({ page, context }) => {
  test.setTimeout(300000);
  const till = await openTill(page, context, { width: 1366, height: 820 }, 'a');

  await test.step('M38 — shop · counter · who, each once', async () => {
    const pill = (await till.locator('#tillpill').textContent()).trim();
    expect(pill, 'the counter pill names the counter').toMatch(/^Counter /);
    const shop = (await till.locator('#shopname').textContent()).trim();
    expect(pill).not.toBe(shop);
    const who = (await till.locator('#whopill').textContent()).trim();
    expect(who.indexOf(shop) < 0 || who === '👤 Shop login', 'the who pill does not repeat the shop name').toBe(true);
  });

  await test.step('M33 — the GSTIN row is never "true"', async () => {
    await till.evaluate(() => openMenuAt('shopdet'));
    const row = till.locator('[data-testid="till-shop-gstin"] .sv b');
    if (await row.count()) await expect(row).not.toHaveText('true');
  });

  await test.step('M37 — Cancel on "Your shop" returns to the Menu, at The shop', async () => {
    const edit = till.locator('[data-testid^="till-shop-edit-"], [data-testid^="till-shop-add-"]').first();
    await edit.click();
    await expect(till.locator('#shopdlg')).toBeVisible();
    await till.locator('#shopdlg .dlgbtns button').first().click();
    await expect(till.locator('#tillmenu')).toBeVisible();
    await expect(till.locator('[data-testid="till-shopdetails"]')).toBeVisible();
  });

  await test.step('M52/M53 — Weeks and months: a tab flips in place, plain words when empty', async () => {
    await till.evaluate(() => openMenuAt('trend'));
    const before = await till.evaluate(() => document.querySelector('#tillmenu').scrollTop);
    await till.locator('[data-testid="till-trend-day"]').click();
    await expect(till.locator('[data-testid="till-trend-day"]')).toHaveClass(/on/);
    const after = await till.evaluate(() => document.querySelector('#tillmenu').scrollTop);
    expect(after, 'the menu did not jump to the top').toBe(before);
    const none = till.locator('[data-testid="till-trend-none"]');
    if (await none.count()) await expect(none).not.toContainText('folded');
    await till.evaluate(() => closeMenu());
  });

  await test.step('M32 — a bill on a counter whose day is not opened says so on the bill, once', async () => {
    await till.evaluate(() => { const i = S.items.filter((x) => x.name === 'Filter Coffee')[0]; quickAdd(i.item_id); });
    await expect(till.locator('[data-testid="till-warn-day"]')).toHaveCount(1);
    await expect(till.locator('[data-testid="till-warn-day-fix"]')).toContainText('Open the day');
  });

  await test.step('M42 — nothing about a bill outlives the bill', async () => {
    await till.evaluate(() => parkBill());
    await expect(till.locator('#lastnote')).not.toContainText('no tax rate');
  });

  await test.step('M54 — Settings › Bills shows the number the next sale will take', async () => {
    const want = await till.evaluate(() => nextNumber(undefined, true));
    await till.evaluate(() => openSettings());
    await expect(till.locator('[data-testid="till-series-note"]')).toContainText('Next bill: ' + want);
  });

  await test.step('M55/M57 — the UPI note is its own; no "no match" before a search', async () => {
    await expect(till.locator('[data-testid="till-set-findempty"]')).toBeHidden();
    await expect(till.locator('#setupupi')).not.toContainText('at the next reset');
    await till.evaluate(() => document.getElementById('setdlg').close());
  });

  await test.step('M51 — once the line has been measured, a small chip says how it is, and opens the detail', async () => {
    await till.evaluate(() => { LINE_TRIES.push({ ok: true, ms: 900 }); paintStatus(); });
    await expect(till.locator('[data-testid="till-net"]')).toHaveText(/Line (good|slow) · \d/);
  });

  await test.step('M46 — Print never opens a pop-up and never blocks: it returns at once', async () => {
    const opened = [];
    context.on('page', (p) => opened.push(p));
    const ms = await till.evaluate(() => { const t = performance.now(); printDoc('x', '', '<p>x</p>'); return performance.now() - t; });
    expect(ms, 'printDoc returns at once').toBeLessThan(50);
    await expect.poll(() => till.evaluate(() => window.__printed || 0)).toBeGreaterThan(0);
    expect(opened.length, 'no pop-up window').toBe(0);
  });

  await test.step('M30 — the lock wears the screensaver: the shop, a clock, today, and Unlock', async () => {
    await till.evaluate(() => lockNow());
    await expect(till.locator('[data-testid="till-lock-face"] .iclock')).toHaveText(/^\d\d:\d\d$/);
    await expect(till.locator('[data-testid="till-lock-face"] .idate')).not.toBeEmpty();
    await expect(till.locator('[data-testid="till-unlock"]')).toBeVisible();
  });
});

test('[TILL-T1b] returns: shop time, the bill\'s own tender, the bill\'s own head (M43 M44 M45 M48)', async ({ page, context }) => {
  test.setTimeout(300000);
  const till = await openTill(page, context, { width: 1366, height: 820 }, 'b');
  const no = await till.evaluate(async () => {
    const i = S.items.filter((x) => x.name === 'Idli')[0];
    quickAdd(i.item_id);
    await new Promise((r) => setTimeout(r, 300));
    if (typeof pickPay === 'function') pickPay('UPI');
    await finish();
    return LAST && LAST.no;
  });
  expect(no).toBeTruthy();
  await till.evaluate((n) => retOpen(n), no);
  await test.step('M43 — the return dialog says the bill\'s date and time in shop time', async () => {
    await expect(till.locator('.retagainst')).toContainText(/\d{2} \w{3} \d{1,2}:\d{2} (am|pm)/);
  });
  await test.step('M44 — "Back as" starts as the bill was paid, and offers the shop\'s tenders', async () => {
    const how = await till.locator('[data-testid="till-ret-how"]').inputValue();
    const paid = await till.evaluate(() => retPaidBy(RET_FOR));
    expect(how).toBe(paid);
    const opts = await till.locator('[data-testid="till-ret-how"] option').allTextContents();
    expect(opts).toContain('Cash');
  });
  await test.step('M45 — the credit note carries the bill\'s head', async () => {
    await till.locator('[data-testid="till-ret-all"]').click();
    await till.evaluate(() => { window.sure = async () => true; });
    await till.evaluate(() => retIssue());
    await expect(till.locator('#slipbox [data-testid="till-slip-head"]')).toBeVisible();
    await expect(till.locator('#slipbox')).toContainText('CREDIT NOTE');
  });
  await test.step('M48 — Sales are never negative; Returns and Net say the rest', async () => {
    await till.evaluate(() => { document.getElementById('slipdlg').close(); openMenuAt('today'); });
    const today = till.locator('[data-testid="till-today"]');
    const sales = await today.locator('.trow').first().textContent();
    expect(sales, 'Sales is never negative').not.toMatch(/−/);
    await expect(today).toContainText('Returns');
    await expect(today).toContainText('Net');
  });
});

test('[TILL-T1c] phone: one keys row, categories as a panel over the items, parked bills reachable (M58 M59 M60)', async ({ page, context }) => {
  test.setTimeout(300000);
  const till = await openTill(page, context, { width: 390, height: 844 }, 'c');

  await test.step('M58 — the keys\' bar is one row; the rest is behind ⋯', async () => {
    const bar = till.locator('[data-testid="till-quick-bar"]');
    await expect(bar.locator('[data-testid="till-quick-arrange"]')).toBeHidden();
    await till.locator('[data-testid="till-quick-more"]').click();
    await expect(bar.locator('[data-testid="till-quick-arrange"]')).toBeVisible();
    await till.locator('[data-testid="till-quick-more"]').click();
    const box = await bar.boundingBox();
    expect(box.height, 'one row').toBeLessThan(60);
  });

  await test.step('categories — closed it is one button; open it lies over the items and takes no room', async () => {
    const quickTop = (await till.locator('#quick').boundingBox()).y;
    await till.locator('[data-testid="till-cat-open"]').click();
    await expect(till.locator('[data-testid="till-cat-panel"]')).toBeVisible();
    expect((await till.locator('#quick').boundingBox()).y, 'the keys did not move').toBe(quickTop);
  });

  await test.step('▦ (the visible twin of a hold) shows that category\'s items as tiles; a tile adds', async () => {
    const peek = till.locator('[data-testid^="till-cat-peek-"]').filter({ hasText: '▦' }).first();
    await peek.click();
    await expect(till.locator('[data-testid="till-cat-item-0"]')).toBeVisible();
    await till.locator('[data-testid="till-cat-item-0"]').click();
    await expect(till.locator('[data-testid="till-step-count"]')).toHaveText(/1/);
  });

  await test.step('a HOLD on a chip does what ▦ does, and does not filter', async () => {
    await till.locator('[data-testid="till-cat-peek-close"]').click();
    const chip = till.locator('#catpanel .chips button[data-cat]').first();
    const b = await chip.boundingBox();
    await till.mouse.move(b.x + 5, b.y + 5); await till.mouse.down();
    await till.waitForTimeout(700); await till.mouse.up();
    await expect(till.locator('[data-testid="till-cat-item-0"]')).toBeVisible();
    await expect(till.locator('[data-testid="till-cat-open"]')).toHaveText(/Categories/);
  });

  await test.step('a TAP on a chip filters and puts the panel away', async () => {
    const chip = till.locator('#catpanel .chips button[data-cat]').first();
    const name = await chip.getAttribute('data-cat');
    await chip.click();
    await expect(till.locator('[data-testid="till-cat-panel"]')).toBeHidden();
    await expect(till.locator('[data-testid="till-cat-open"]')).toContainText(name);
  });

  await test.step('M59 — no key names on touch, the full "Customer" label', async () => {
    await expect(till.locator('#cname')).toHaveAttribute('placeholder', 'Customer');
  });

  await test.step('M60 — a parked bill is counted on the Bill step and listed first there', async () => {
    await till.evaluate(() => parkBill());
    await expect(till.locator('[data-testid="till-step-parked"]')).toContainText('1');
    await till.locator('[data-testid="till-step-bill"]').click();
    await expect(till.locator('[data-testid="till-parked-0"]')).toBeVisible();
  });
});
