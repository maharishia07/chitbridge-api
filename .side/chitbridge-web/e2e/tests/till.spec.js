// till.spec.js — [TILL-01] THE COUNTER BILLS, WITH THE LINE UP AND WITH IT DOWN. Athi, 2026-09-07: "someone runs a store without a computer… why can't
// we develop a desktop application — the minimum sits on the desktop so the billing works faster" and "it works with IndexedDB and syncs
// with the cloud regularly". This drives the REAL page (/till.html) against the REAL API: pair once with a till key, take the shop in one
// call, bill, and find the sale in Task as an ordinary chit. Then pull the plug and bill again — the counter must not care.
// ⚠️ ADDING IS A DELIBERATE ACT SINCE 2026-09-10. A click on a row CHOOSES it; the + button (or Enter) puts it
// on the bill. Athi: "by just clicking the list it gets added to the cart, that is not my intention." These specs
// clicked the row and expected a bill line — so they are what caught the change, correctly, and they drive the
// new control rather than the old one.
const { test, expect } = require('@playwright/test');
const { mintEntity, addProduct, clickNav, settle } = require('../fixtures');
const API = process.env.CB_API_BASE || 'https://chitbridge-api-production.up.railway.app';

test('[TILL-01] a counter bills from its own copy of the shop, offline too, and each bill lands once', async ({ page, context }) => {
  test.setTimeout(300000);
  await mintEntity(page, { fresh: true, name: 'Till ' + Date.now().toString().slice(-6) });

  await test.step('a shop with two things on the shelf', async () => {
    await addProduct(page, { name: 'Tomato', unit: 'kg', price: 40, code: 'TOM' });
    await addProduct(page, { name: 'Cooking oil 1L', unit: 'litre', price: 250, code: 'OIL' });
  });

  let key;
  await test.step('a key scoped to the till — and nothing else', async () => {
    key = (await page.evaluate(async () => { if (typeof ensureCap === 'function') await ensureCap('admin');
      return api('keysMint', { body: { name: 'counter 1', scopes: ['till'], days: 1 } }); })).key;
    expect(key).toBeTruthy();
    /* the scope is a door, not a suggestion: a till key must not be able to read the chits it did not write */
    const nosy = await page.request.get(API + '/api/chits/inbox?limit=1', { headers: { 'X-Api-Key': key } });
    expect(nosy.status(), 'a till key cannot read the inbox').toBe(403);
    /* nor address anyone else */
    const outward = await page.request.post(API + '/api/chits/send', { headers: { 'X-Api-Key': key },
      data: { recipients: [{ name: 'somebody else' }], purpose: 'order', subject: 'x', line_items: [{ particulars: 'x', quantity: 1, price: 1, total: 1 }] } });
    expect(outward.status(), 'a till may only record its own sales').toBe(403);
  });

  await test.step('the whole shop in ONE call — the reason a counter feels fast', async () => {
    const r = await page.request.get(API + '/api/till/snapshot', { headers: { 'X-Api-Key': key } });
    expect(r.status()).toBe(200);
    const snap = await r.json();
    expect(snap.shop.name).toBeTruthy();
    expect(snap.items.map((i) => i.name)).toEqual(expect.arrayContaining(['Tomato', 'Cooking oil 1L']));
    expect(snap.version, 'the copy is stamped, so a bill can say which prices it used').toBeTruthy();
    for (const n of ['offers', 'slabs', 'customers']) expect(Array.isArray(snap[n]), n + ' travels with it').toBe(true);
  });

  const till = await context.newPage();
  /* the counter runs in its own page; anything it throws belongs in this test's output, not in a screenshot nobody reads */
  till.on('console', (m) => { if (m.type() === 'error') console.log('   till console: ' + m.text()); });
  till.on('pageerror', (e) => console.log('   till threw: ' + e.message));
  await test.step('the counter opens and pairs with the key once', async () => {
    await till.goto('/till.html#key=' + encodeURIComponent(key));
    await till.waitForFunction(() => window.CBOffers && window.CBTax, null, { timeout: 30000 });   /* both engines, cached from the API */
    await till.waitForFunction(() => document.getElementById('shopname').textContent !== 'Not paired yet', null, { timeout: 30000 });
    await till.evaluate(() => refresh());
    await till.waitForSelector('[data-testid="till-hit-0"]', { timeout: 30000 });
    expect(till.url(), 'the key is taken out of the address once it is stored').not.toContain('key=');
  });

  let firstNo;
  await test.step('a bill: search, add, take the money, save', async () => {
    await till.fill('#q', 'oil');
    await till.click('[data-testid="till-add-0"]');
    await expect(till.locator('[data-testid="till-total"]')).toHaveText('₹250.00');
    await till.fill('[data-testid="till-qty-0"]', '2');
    await till.locator('[data-testid="till-qty-0"]').dispatchEvent('change');
    await expect(till.locator('[data-testid="till-total"]')).toHaveText('₹500.00');
    await till.click('[data-testid="till-pay-cash"]');
    await till.fill('#tendered', '500');
    await till.click('#save');
    await expect(till.locator('#sliptitle')).toContainText('₹500.00');
    firstNo = (await till.locator('#sliptitle').textContent()).replace('Bill ', '').split(' ·')[0].trim();
    expect(firstNo, 'the number carries the counter and the financial year').toMatch(/^C1\/\d\d-\d\d\/\d{4}$/);
    await till.click('#slipdlg button:has-text("Close")');
  });

  await test.step('and it is an ordinary chit in the shop own Task, carrying the bill number', async () => {
    /* the queue drains by itself; ask the API directly rather than guessing which screen shows it */
    const seen = await page.evaluate(async (no) => {
      for (let i = 0; i < 12; i++) {
        const r = await fetch(CFG.API_BASE + '/api/chits/inbox?limit=25', { headers: { Authorization: 'Bearer ' + SESSION.token } });
        const j = await r.json().catch(() => ({}));
        const rows = j.chits || j.rows || j.items || [];
        if (rows.some((c) => String(c.manual_subject || c.auto_subject || '').indexOf(no) >= 0)) return true;
        await new Promise((res) => setTimeout(res, 2000));
      }
      return false;
    }, firstNo);
    expect(seen, 'the counter sale reached ChitBridge as a chit').toBe(true);
  });

  await test.step('THE LINE GOES DOWN — and the counter does not care', async () => {
    await context.setOffline(true);
    await till.fill('#q', 'tomato');
    await till.click('[data-testid="till-add-0"]');
    await till.click('#save');
    await expect(till.locator('#sliptitle')).toContainText('₹40.00');
    const no2 = (await till.locator('#sliptitle').textContent()).replace('Bill ', '').split(' ·')[0].trim();
    expect(no2, 'the series carries on without asking anybody').not.toBe(firstNo);
    await till.click('#slipdlg button:has-text("Close")');
    await expect(till.locator('#queuenote')).toContainText('waiting to reach ChitBridge');
    await context.setOffline(false);
    await till.evaluate(() => HOST.drain());
    await till.waitForFunction(() => document.getElementById('queuenote').textContent.indexOf('waiting') < 0, null, { timeout: 30000 });
  });

  await test.step('the day\'s takings are on the screen — the figure a shopkeeper checks at night', async () => {
    await expect(till.locator('#daypill')).toContainText('today 2');
    await expect(till.locator('#daypill')).toContainText('540.00');
  });
});

// [TILL-02] TEN THOUSAND ITEMS TRAVEL ONCE. Athi, 2026-09-08: "the catalogue with 10,000 items, if it is browsed from the net it will
// take time for every search — is it not better to bring it once and sync often?" The counter already searches its own copy; this proves
// the second half: after the first read, only what changed comes down — including the removals, which a delta of present rows cannot say.
test('[TILL-02] after the first read the counter asks only for what changed, removals included', async ({ page }) => {
  test.setTimeout(240000);
  await mintEntity(page, { fresh: true, name: 'Delta ' + Date.now().toString().slice(-6) });
  await addProduct(page, { name: 'Beans', unit: 'kg', price: 60, code: 'BEAN' });

  const key = (await page.evaluate(async () => { if (typeof ensureCap === 'function') await ensureCap('admin');
    return api('keysMint', { body: { name: 'delta till', scopes: ['till'], days: 1 } }); })).key;
  const get = async (q) => (await page.request.get(API + '/api/till/snapshot' + (q || ''), { headers: { 'X-Api-Key': key } })).json();

  const first = await get();
  expect(first.delta, 'the first read is the whole shop').toBeFalsy();
  expect(first.items.map((i) => i.name)).toContain('Beans');
  const at = first.at;
  expect(at).toBeTruthy();

  await test.step('nothing changed → nothing comes down', async () => {
    const quiet = await get('?since=' + encodeURIComponent(at));
    expect(quiet.delta).toBe(true);
    expect(quiet.items.length, 'an unchanged shop costs one small answer').toBe(0);
    expect(quiet.removed.length).toBe(0);
    expect(quiet.shop.name, 'the shop itself still travels — it is small and changes together').toBeTruthy();
  });

  await test.step('one new product → one item comes down', async () => {
    await addProduct(page, { name: 'Carrot', unit: 'kg', price: 45, code: 'CAR' });
    const d = await get('?since=' + encodeURIComponent(at));
    expect(d.items.map((i) => i.name), 'only the new one').toEqual(['Carrot']);
  });

  await test.step('a product taken off the shelf comes down as a REMOVAL', async () => {
    const beans = first.items.filter((i) => i.name === 'Beans')[0];
    expect(beans, 'the item we are about to retire').toBeTruthy();
    const gone = await page.evaluate(async (id) => {
      /* a status change MERGES onto the row rather than amending it — the app's own rule for retiring a product */
      try { return await api('prodStatus', { params: { id }, body: { status: 'retired', note: 'delta test' } }); }
      catch (e) { return { error: String(e && e.message) }; }
    }, beans.item_id);
    expect(gone && gone.error, 'could not retire the item: ' + JSON.stringify(gone)).toBeFalsy();
    const d = await get('?since=' + encodeURIComponent(at));
    expect(d.removed, 'an absence cannot be expressed by a delta of present rows, so it is named').toContain(beans.item_id);
    expect(d.items.map((i) => i.name), 'and it is not in the items').not.toContain('Beans');
  });
});
