// [TILL-03] THE TAX ACTUALLY REACHES THE COUNTER. Athi, at a live counter on 2026-09-08: "no, tax is not there" — and the health
// panel he had asked for that morning said exactly why: "No tax slabs reached this counter."
//
// ⚠️⚠️ WHY NO TEST CAUGHT IT. taxShelf.readShelf() returns `slabs` as a Map. Four in-process callers hand it straight to
// taxSlab.resolve(), which accepts a Map — correct everywhere. /api/till/snapshot does not call a function with it; it puts it on
// the wire, and JSON.stringify(new Map()) is {}. [TILL-01] asserted Array.isArray(snap.slabs) and passed for a year of runs
// because its shop has NO GSTIN: readShelf answers null for an unregistered seller, and the route's fallback is a real []. Every
// shop that actually charges GST got {} — no rate on any product, no tax on any bill, nothing thrown and nothing logged.
//
// So this spec exists to hold the one case the suite never had: a REGISTERED shop. It asserts the wire, not the code.
// ⚠️ ADDING IS A DELIBERATE ACT SINCE 2026-09-10. A click on a row CHOOSES it; the + button (or Enter) puts it
// on the bill. Athi: "by just clicking the list it gets added to the cart, that is not my intention." These specs
// clicked the row and expected a bill line — so they are what caught the change, correctly, and they drive the
// new control rather than the old one.
const { test, expect } = require('@playwright/test');
const { mintEntity, addProduct } = require('../fixtures');
const API = process.env.CB_API_BASE || 'https://chitbridge-api-production.up.railway.app';

test('[TILL-03] a registered shop own slabs survive the wire, and a rate lands on the line', async ({ page, context }) => {
  test.setTimeout(300000);
  await mintEntity(page, { fresh: true, name: 'Taxed till ' + Date.now().toString().slice(-6) });

  await test.step('a shop that CHARGES GST — the case the suite never had', async () => {
    await page.evaluate(async () => { await api('saveProfile', { body: { gstn: '33AABCK1234F1Z6', address: '5 Mount Road, Chennai' } }); });
    await addProduct(page, { name: 'Masala packet', unit: 'piece', price: 100, code: 'MSL' });
  });

  const key = (await page.evaluate(async () => { if (typeof ensureCap === 'function') await ensureCap('admin');
    return api('keysMint', { body: { name: 'tax counter', scopes: ['till'], days: 1 } }); })).key;
  expect(key).toBeTruthy();

  let slab;
  await test.step('⚠️⚠️ THE REGRESSION — what the counter is actually sent, read as text before anything parses it', async () => {
    const r = await page.request.get(API + '/api/till/snapshot', { headers: { 'X-Api-Key': key } });
    expect(r.status()).toBe(200);
    const raw = await r.text();
    /* the literal failure: a Map serialises to an empty object and every reader downstream sees "no slabs at all" */
    expect(raw, 'the slab table went out as a Map — this is the bug, byte for byte').not.toContain('"slabs":{}');
    const snap = JSON.parse(raw);
    expect(Array.isArray(snap.slabs), 'slabs must arrive as rows').toBe(true);
    test.skip(snap.slabs.length === 0, 'no governed GST slabs on this deployment — migration b201 has not been applied');
    slab = snap.slabs.find((s) => Number(s.rate) > 0) || snap.slabs[0];
    expect(slab.id, 'a slab a product can cite by id').toBeTruthy();
    expect(slab.rate, 'and a rate to charge — null here means the slab arrived hollow').not.toBe(null);
  });

  await test.step('the shop puts that slab on the packet', async () => {
    const pid = await page.evaluate(async (n) => {
      const r = await api('prodList', { query: { limit: 200 } });
      const list = Array.isArray(r) ? r : ((r && (r.items || r.products)) || []);
      const hit = list.find((x) => String(((x.item_data || x).name) || '') === n);
      return hit && (hit.item_id || hit.id);
    }, 'Masala packet');
    expect(pid).toBeTruthy();
    /* ⚠️ merge:true — a one-field editor never PATCHes the whole record (RFC 7386) */
    await page.evaluate(async (a) => api('prodEdit', { params: { id: a.pid }, body: { item_data: { tax_slab: a.slab }, merge: true } }),
      { pid, slab: slab.id });
    const snap = await (await page.request.get(API + '/api/till/snapshot', { headers: { 'X-Api-Key': key } })).json();
    const item = snap.items.find((i) => i.name === 'Masala packet');
    expect(item && item.tax_slab, 'the citation travels with the item').toBe(slab.id);
  });

  const till = await context.newPage();
  till.on('pageerror', (e) => console.log('   till threw: ' + e.message));
  await test.step('⭐⭐ AND THE COUNTER CHARGES IT — the thing Athi could not see', async () => {
    /* ⚠️ the SAME pairing sequence [TILL-01] uses — a wait invented for this spec timed out against a page that was fine */
    await till.goto('/till.html#key=' + encodeURIComponent(key));
    await till.waitForFunction(() => window.CBOffers && window.CBTax, null, { timeout: 60000 });
    await till.waitForFunction(() => document.getElementById('shopname').textContent !== 'Not paired yet', null, { timeout: 60000 });
    await till.evaluate(() => refresh());
    await till.waitForSelector('[data-testid="till-hit-0"]', { timeout: 60000 });
    const onCounter = await till.evaluate(() => (S && S.slabs || []).length);
    expect(onCounter, 'the slab table arrived at the counter empty — the Map crossed JSON again').toBeGreaterThan(0);

    /* the engine, on the counter's own copy, answering for this product */
    const answer = await till.evaluate((n) => {
      const it = (S.items || []).find((i) => i.name === n);
      return rateOf ? rateOf(it) : null;
    }, 'Masala packet');
    expect(answer, 'the counter resolved no rate from what it was sent').not.toBe(null);   /* rateOf answers a bare number */
    expect(Number(answer), 'a registered shop must charge more than nothing').toBeGreaterThan(0);

    await till.fill('#q', 'masala');
    await till.waitForSelector('[data-testid="till-hit-0"]', { timeout: 30000 });
    /**
     * ⚠️ THE ASSERTION IS THAT A RATE IS SHOWN, NOT THE ORDER OF THE WORDS. This read /GST\s*\d/ and went red on
     * 2026-09-10 against a row saying "per piece · incl. 5% GST" — the shelf row had been REWORDED, and improved
     * while it was at it, because "incl. 5% GST" is how a shopkeeper says it. The feature was right and the test
     * was pinned to a phrasing. A check that fails when the copy gets better teaches people to ignore it.
     */
    const RATE_SHOWN = /(GST\s*\d|\d+\s*%\s*GST)/;
    await expect(till.locator('[data-testid="till-hit-0"]'), 'the shelf row shows the rate it will charge').toContainText(RATE_SHOWN);
    await till.click('[data-testid="till-add-0"]');
    await expect(till.locator('#cart'), 'and so does the line on the bill').toContainText(RATE_SHOWN);
  });

  await test.step('⭐ and the health panel stops calling it fatal — the check that found this', async () => {
    const worst = await till.evaluate(() => (typeof health === 'function' ? health() : []));
    /* ⚠️ health() findings are { level, what, means, todo } — `what` carries the headline, and reading `title` here would
       have made this check pass on any counter, tax or no tax */
    const tax = (worst || []).filter((f) => String(f.what || '').toLowerCase().indexOf('tax slab') >= 0);
    expect(tax, 'the counter still reports that no tax reached it').toEqual([]);
  });
});
