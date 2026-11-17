// [NET-CAT-01] A BRAND PUBLISHES ITS PRODUCT CHANGES — A STORE AT THE BRAND'S PRICE MOVES WITH IT; A STORE WITH ITS OWN IS ASKED.
//
// Athi, 2026-09-17: "if the price changed it has to reflect to the store" → "suggest only, build publish changes as you
// recommended." A brand, two stores: FOLLOWS sells the kettle at the brand's price, OWN at its own. The brand changes the
// kettle's price, adds a product, and publishes — first for a moment a few seconds ahead (applied by the next read, no
// worker), then from the screen with "Publish now". OWN is shown the new price and answers Keep, then Use.
const { test, expect } = require('@playwright/test');
const { mintEntity, mintInContext, approveJoins } = require('../fixtures');
const API = process.env.CB_API_BASE || 'https://chitbridge-api-production.up.railway.app';

const app = (page, name, opts) => page.evaluate(async ({ name, opts }) => {
  try { return { ok: true, body: await api(name, opts || {}) }; }
  catch (e) { return { ok: false, message: (e && e.message) || String(e) }; }
}, { name, opts });

test('[NET-CAT-01] publish changes: followers move, own prices are asked, nothing lands before its moment', async ({ page, browser, request }) => {
  test.setTimeout(480000);
  const stamp = Date.now().toString().slice(-6);

  /* ── the BRAND: two products, published as its network catalogue ── */
  await mintEntity(page, { fresh: true, name: 'CatBrand ' + stamp });
  await page.evaluate(async () => { if (typeof ensureCap === 'function') await ensureCap('admin'); });
  const idOf = async (name) => page.evaluate(async (nm) => {
    const r = await api('prodList', { query: { limit: 200 } });
    const list = Array.isArray(r) ? r : ((r && (r.items || r.products)) || []);
    const hit = list.find((x) => String(((x.item_data || x).name) || '') === nm);
    return hit ? { id: hit.item_id || hit.id, d: hit.item_data || hit } : null;
  }, name);
  for (const p of [{ name: 'Smart kettle', code: 'CK-1', price: 2000 }, { name: 'Desk lamp', code: 'CL-1', price: 1000 }]) {
    const r = await app(page, 'prodAdd', { body: { item_data: { name: p.name, code: p.code, price: p.price, mrp: p.price, unit: 'piece', category: 'Home' } } });
    expect(r.ok, r.message).toBe(true);
  }
  const sourceKey = 'catbrand-' + stamp + '@v1';
  const pub = await app(page, 'catSourcePut', { body: { source_key: sourceKey, title: 'CatBrand ' + stamp, items: [
    { name: 'Smart kettle', sku: 'CK-1', code: 'CK-1', price: 2000, mrp: 2000, unit: 'piece', category: 'Home' },
    { name: 'Desk lamp', sku: 'CL-1', code: 'CL-1', price: 1000, mrp: 1000, unit: 'piece', category: 'Home' }] } });
  expect(pub.ok, pub.message).toBe(true);

  /* ── two STORES ── */
  const mkStore = async (label, kettle) => {
    const st = await mintInContext(browser, { fresh: true, name: label + ' ' + stamp });
    await st.page.evaluate(async () => { if (typeof ensureCap === 'function') await ensureCap('admin'); });
    /* the name its customers — and its brand — know it by */
    const idt = await app(st.page, 'vaultSave', { body: { vault: { sections: [{ type: 'identity', label: 'Business identity',
      rows: [{ name: 'Trade / brand name', value: label + ' store ' + stamp, tag: 'trade_name' }] }] } } });
    expect(idt.ok, idt.message).toBe(true);
    const ad = await app(st.page, 'catalogueAdopt', { body: { source: sourceKey,
      commercials: { 'Smart kettle': { price: kettle, unit: 'piece' }, 'Desk lamp': { price: 950, unit: 'piece' } } } });
    expect(ad.ok, ad.message).toBe(true);
    st.handle = await st.page.evaluate(async () => {
      await api('saveProfile', { body: { catalogue_visibility: 'public' } });
      const me = await api('me'); const e = (me && me.entity) || me || {}; return e.user_id || e.bridge_id;
    });
    return st;
  };
  const follows = await mkStore('Follows', 2000);
  const own = await mkStore('Own', 2200);
  const kettleAt0 = async (st) => {
    const v = await (await request.get(API + '/api/catalogue/' + encodeURIComponent(st.handle))).json();
    return [].concat(...(v.finishes || []).map((f) => f.items || [])).some((i) => i.name === 'Smart kettle');
  };

  await test.step('⭐⭐ a store that only ASKED sells none of the brand\'s products — until the brand approves it', async () => {
    expect(await kettleAt0(follows), '⚠️ a store outside the network sells the brand\'s product').toBe(false);
    expect(await approveJoins(page), 'the two stores did not ask to join by adopting').toBe(2);
    expect(await kettleAt0(follows), 'an approved store still cannot sell the product').toBe(true);
  });
  const kettleAt = async (st) => {
    const v = await (await request.get(API + '/api/catalogue/' + encodeURIComponent(st.handle))).json();
    const it = [].concat(...(v.finishes || []).map((f) => f.items || [])).find((i) => i.name === 'Smart kettle');
    const p = it && it.commercials && it.commercials.price;
    return p && typeof p === 'object' ? Number(p.amount) : Number(p);
  };

  /* ── the brand changes its product ── */
  const kettle = await idOf('Smart kettle');
  expect((await app(page, 'prodEdit', { params: { id: kettle.id }, body: { item_data: Object.assign({}, kettle.d, { price: 1800 }) } })).ok).toBe(true);
  expect((await app(page, 'prodAdd', { body: { item_data: { name: 'Toaster', code: 'CT-1', price: 2500, mrp: 2500, unit: 'piece', category: 'Home' } } })).ok).toBe(true);

  await test.step('⭐ the brand sees what its stores do not have yet — and nothing has reached them', async () => {
    const v = (await app(page, 'netOffers')).body;
    const c = (v.brand.catalogue || []).find((x) => x.source_key === sourceKey);
    expect(c, 'the brand is not shown its catalogue').toBeTruthy();
    const ch = c.changes.find((x) => x.name === 'Smart kettle');
    expect(ch && ch.fields, 'the price change is not listed').toContainEqual({ field: 'price', from: 2000, to: 1800 });
    expect(c.candidates.map((x) => x.name)).toContain('Toaster');
    expect(await kettleAt(follows), 'an unpublished change reached a store').toBe(2000);
  });

  await test.step('⏳ a publish for a moment ahead waits — then the first read after it applies it', async () => {
    const soon = new Date(Date.now() + 8000).toISOString();
    const r = await app(page, 'netCatPublish', { body: { source_key: sourceKey, at: soon } });
    expect(r.ok, r.message).toBe(true);
    expect(r.body.applied).toBe(false);
    expect(r.body.followed, 'the store at the brand\'s price was not marked as following').toBe(1);
    expect(await kettleAt(follows), 'a waiting publish reached a store early').toBe(2000);
    await page.waitForTimeout(9000);
    expect(await kettleAt(follows), 'the store at the brand\'s price did not move').toBe(1800);
    expect(await kettleAt(own), '⚠️ a store\'s OWN price was overwritten').toBe(2200);
  });

  await test.step('⭐⭐ the store with its own price is asked — Keep leaves it alone and the question goes', async () => {
    const n = ((await app(own.page, 'netOffers')).body.store.price_notices || []).find((x) => x.name === 'Smart kettle');
    expect(n, 'the store was not shown the brand\'s new price').toBeTruthy();
    expect([n.suggested, n.yours]).toEqual([1800, 2200]);
    await own.page.evaluate(async () => { await goIntTab('netoffers'); });
    await expect(own.page.getByTestId('netc-notices')).toContainText('Smart kettle', { timeout: 30000 });
    await own.page.getByTestId('netc-keep-0').click();
    await expect(own.page.getByTestId('netc-notices')).toHaveCount(0, { timeout: 30000 });
    expect(await kettleAt(own)).toBe(2200);
    const again = ((await app(follows.page, 'netOffers')).body.store.price_notices || []);
    expect(again.length, 'a following store was asked about a price it already follows').toBe(0);
  });

  await test.step('⭐⭐ from the screen: publish at next opening shows it waiting; cancel; publish now (twice) adds the toaster', async () => {
    const k2 = await idOf('Smart kettle');
    expect((await app(page, 'prodEdit', { params: { id: k2.id }, body: { item_data: Object.assign({}, k2.d, { price: 1700 }) } })).ok).toBe(true);
    await page.evaluate(async () => { await goIntTab('netoffers'); });
    const card = page.getByTestId('netc-' + sourceKey);
    await expect(card).toContainText('Smart kettle', { timeout: 30000 });
    await page.getByTestId('netc-publish').click();
    await expect(page.getByTestId('netc-pending')).toBeVisible({ timeout: 30000 });
    expect(await kettleAt(follows), 'next opening means not now').toBe(1800);
    await page.getByTestId('netc-cancel').click();
    await expect(page.getByTestId('netc-pending')).toHaveCount(0, { timeout: 30000 });
    const toaster = await idOf('Toaster');
    await page.getByTestId('netc-add-' + toaster.id).locator('input').check();
    await page.getByTestId('netc-publish-now').click();
    await expect(page.getByTestId('netc-publish-now')).toContainText('NOW');
    await page.getByTestId('netc-publish-now').click();
    await expect(page.getByTestId('netc-uptodate')).toBeVisible({ timeout: 30000 });
    expect(await kettleAt(follows)).toBe(1700);
    const v = await (await request.get(API + '/api/catalogue/' + encodeURIComponent(follows.handle))).json();
    const names = [].concat(...(v.finishes || []).map((f) => f.items || [])).map((i) => i.name);
    expect(names, 'the toaster is shared but unpriced at the store — so it is held back, not sold at nothing').not.toContain('Toaster');
  });

  await test.step('⭐ Use takes the brand\'s price — and the store follows it from then on', async () => {
    const list = (await app(own.page, 'netOffers')).body.store.price_notices || [];
    const i = list.findIndex((x) => x.name === 'Smart kettle');
    expect(i, 'the second price change was not suggested').toBeGreaterThanOrEqual(0);
    expect(list[i].suggested).toBe(1700);
    await own.page.evaluate(async () => { if (typeof netoReload === 'function') netoReload(); });
    await own.page.getByTestId('netc-use-' + i).click();
    await expect(own.page.getByTestId('netc-notices')).toHaveCount(0, { timeout: 30000 });
    expect(await kettleAt(own)).toBe(1700);
  });

  /* ── [NET-CAT-02] who is in the network, and withdrawing — from one store, from all, and back ── */
  const lampAt = async (st) => {
    const v = await (await request.get(API + '/api/catalogue/' + encodeURIComponent(st.handle))).json();
    const it = [].concat(...(v.finishes || []).map((f) => f.items || [])).find((i) => i.name === 'Desk lamp');
    if (!it) return null;
    const p = it.commercials && it.commercials.price;
    return p && typeof p === 'object' ? Number(p.amount) : Number(p);
  };
  const catOf = async () => ((await app(page, 'netOffers')).body.brand.catalogue || []).find((x) => x.source_key === sourceKey);
  const noticeOf = async (st, kind) => ((await app(st.page, 'netOffers')).body.store.price_notices || []).find((x) => x.name === 'Desk lamp' && x.kind === kind);

  await test.step('⭐ the brand sees its stores by name; each store sees the network it belongs to', async () => {
    const b = (await app(page, 'netOffers')).body.brand;
    const names = (b.members || []).map((m) => m.name);
    expect(names.some((n) => /Follows/.test(n)) && names.some((n) => /Own/.test(n)), 'the brand cannot see who is in its network: ' + names).toBe(true);
    await page.evaluate(async () => { await goIntTab('netoffers'); });
    await expect(page.getByTestId('neto-members')).toContainText('Own', { timeout: 30000 });
    const nets = (await app(own.page, 'netOffers')).body.store.networks || [];
    expect(nets.some((n) => String(n.brand_name).indexOf('CatBrand') >= 0), 'the store cannot see the network it is in').toBe(true);
  });

  await test.step('⭐⭐ withdraw the lamp from ONE store (from the screen) — gone there, still sold at the other', async () => {
    const c = await catOf();
    const i = c.published.indexOf('Desk lamp'), j = c.stores.findIndex((s) => /Own/.test(s.name));
    expect(i >= 0 && j >= 0, 'the lamp or the store is not offered for withdrawal').toBe(true);
    await page.evaluate(async () => { if (typeof netoReload === 'function') netoReload(); });
    await page.getByTestId('netc-shared').evaluate((d) => { if (!d.open) d.open = true; });
    await expect(page.getByTestId('netc-out-' + i)).toBeVisible({ timeout: 30000 });
    await page.getByTestId('netc-at-open-' + i).click();
    await page.getByTestId('netc-at-' + i + '-' + j).locator('input').check();
    await page.getByTestId('netc-publish-now').click();
    const published = page.waitForResponse((r) => r.url().indexOf('/catalogue/publish') >= 0 && r.request().method() === 'POST', { timeout: 45000 });
    await page.getByTestId('netc-publish-now').click();
    expect((await published).status(), 'the publish was refused').toBe(200);
    await expect(page.getByTestId('netc-at-open-' + i)).toContainText('withdrawn from 1', { timeout: 30000 });
    /* the server's record, not the screen's memory of the ticks */
    const after = await catOf();
    expect(after.withdrawn_at['Desk lamp'] || [], 'the brand\'s record does not say where it was withdrawn: ' + JSON.stringify(after.log && after.log[0])).toHaveLength(1);
    expect(await lampAt(own), 'the lamp is still offered at the store it was withdrawn from').toBe(null);
    expect(await lampAt(follows), 'withdrawing at one store took it from another').toBe(950);
    expect(await noticeOf(own, 'withdrawn'), 'the store was not told').toBeTruthy();
    expect(await noticeOf(follows, 'withdrawn'), 'a store it was NOT withdrawn from was told it was').toBeFalsy();
  });

  await test.step('⚠️⚠️ the store saving its own prices cannot bring it back', async () => {
    const r = await app(own.page, 'catalogueAdopt', { body: { source: sourceKey, commercials: { 'Smart kettle': { price: 1700, unit: 'piece' } } } });
    expect(r.ok, r.message).toBe(true);
    expect(await lampAt(own), 'a store save undid the brand\'s withdrawal').toBe(null);
  });

  await test.step('⭐ restored at that store — back at the store\'s own price, and the store is told', async () => {
    const own_id = (await catOf()).stores.find((s) => /Own/.test(s.name)).id;
    const r = await app(page, 'netCatPublish', { body: { source_key: sourceKey, at: 'now', restore_at: { 'Desk lamp': [own_id] } } });
    expect(r.ok, r.message).toBe(true);
    expect(await lampAt(own), 'the store\'s own price was lost while the product was withdrawn').toBe(950);
    expect(await noticeOf(own, 'restored')).toBeTruthy();
  });

  await test.step('⭐⭐ withdrawn from ALL stores — then shared again, and every store has it back at its own price', async () => {
    const c = await catOf();
    const i = c.published.indexOf('Desk lamp');
    await page.evaluate(async () => { if (typeof netoReload === 'function') netoReload(); });
    await page.getByTestId('netc-shared').evaluate((d) => { if (!d.open) d.open = true; });
    await expect(page.getByTestId('netc-out-' + i)).toBeVisible({ timeout: 30000 });
    await page.getByTestId('netc-out-' + i).locator('input').first().check();
    await page.getByTestId('netc-publish-now').click();
    const published = page.waitForResponse((r) => r.url().indexOf('/catalogue/publish') >= 0 && r.request().method() === 'POST', { timeout: 45000 });
    await page.getByTestId('netc-publish-now').click();
    expect((await published).status(), 'the publish was refused').toBe(200);
    await expect(page.getByTestId('netc-uptodate')).toBeVisible({ timeout: 30000 });
    expect([await lampAt(own), await lampAt(follows)]).toEqual([null, null]);
    expect(await noticeOf(follows, 'withdrawn'), 'a store that sold it was not told').toBeTruthy();
    const lamp = await idOf('Desk lamp');
    const back = await app(page, 'netCatPublish', { body: { source_key: sourceKey, at: 'now', add: [lamp.id] } });
    expect(back.ok, back.message).toBe(true);
    expect([await lampAt(own), await lampAt(follows)]).toEqual([950, 950]);
  });
});
