// promo.spec.js — [PROMO-01] THE SHOP'S SCREEN DRAWS THE SHOP'S OWN ANSWERS. Athi, 2026-09-08: "how we can bring it to instagram, facebook,
// whatsapp status, in the tv in the shop… it is not a shopping cart, it is the advertisement of the product, dynamically based on
// the offer and other criteria" — and then: "create an excellent campaign layer, so the same can be run in the TV of the shop and
// pushed to other places."
//
// ⚠️ A CANVAS FAILS SILENTLY. If the renderer throws, the page does not go red — it shows a black rectangle, which on a television
// in a shop looks like a screen that is simply off. So this spec never asserts "no error was logged"; it samples actual PIXELS and
// insists the frame has real variety in it, then checks the same drawing survives every shape it is asked for.
const { test, expect } = require('@playwright/test');
const { mintEntity, addProduct } = require('../fixtures');

test('[PROMO-01] the shop screen builds slides from the catalogue and draws them in every shape', async ({ page, context }) => {
  test.setTimeout(300000);
  await mintEntity(page, { fresh: true, name: 'Screen ' + Date.now().toString().slice(-6) });

  await test.step('a shop with something worth advertising', async () => {
    await page.evaluate(async () => { await api('saveProfile', { body: { gstn: '33AABCK1234F1Z6', address: '5 Mount Road, Chennai' } }); });
    /**
     * ⚠️ THE FIXTURE HAS TO CARRY WHAT THE RULES READ. addProduct() writes a name, a price and a unit — and on exactly that, every
     * rule but the shop card scores nothing, because "fresh" needs a category and "price" needs an MRP. The first run of this spec
     * produced ONE slide, which is how the missing floor was found. Written through prodAdd so the rows are what a real catalogue
     * looks like: categories, MRPs, and enough of one category to be worth boasting about.
     */
    await page.evaluate(async () => {
      const veg = ['Tomato', 'Onion big', 'Potato', 'Carrot', 'Beans', 'Brinjal', 'Cabbage'];
      const rows = veg.map((n, i) => ({ name: n, code: 'PVEG' + i, unit: 'kg', category: 'Vegetables',
                                        price: 28 + i * 6, mrp: 40 + i * 8, avail: 'available' }));
      rows.push({ name: 'Ponni raw rice 5 kg', code: 'PSTA1', unit: 'bag', category: 'Rice & grains', price: 295, mrp: 360, avail: 'available' });
      rows.push({ name: 'Toor dal 1 kg', code: 'PPUL1', unit: 'packet', category: 'Pulses', price: 168, mrp: 199, avail: 'available' });
      rows.push({ name: 'Sunflower oil 1 L', code: 'POIL1', unit: 'litre', category: 'Edible oil', price: 142, mrp: 175, avail: 'available' });
      rows.push({ name: 'Milk toned 500 ml', code: 'PDAI1', unit: 'litre', category: 'Milk & curd', price: 27, mrp: 30, avail: 'available' });
      for (const r of rows) await api('prodAdd', { body: { item_data: r } });
    });
  });

  const key = (await page.evaluate(async () => { if (typeof ensureCap === 'function') await ensureCap('admin');
    return api('keysMint', { body: { name: 'shop screen', scopes: ['till'], days: 1 } }); })).key;
  expect(key).toBeTruthy();

  const tv = await context.newPage();
  const threw = [];
  tv.on('pageerror', (e) => threw.push(e.message));

  await test.step('it pairs with the counter key and builds a run of slides', async () => {
    await tv.goto('/promo.html#key=' + encodeURIComponent(key)
      + '&shop=' + encodeURIComponent(await page.evaluate(() => SESSION.entityId)));
    await tv.waitForFunction(() => window.CBOffers && window.CBTax, null, { timeout: 60000 });
    await tv.waitForFunction(() => typeof SLIDES !== 'undefined' && SLIDES.length > 0, null, { timeout: 60000 });

    const built = await tv.evaluate(() => ({ n: SLIDES.length, kinds: [...new Set(SLIDES.map((s) => s.kind))],
                                             items: (S && S.items || []).length }));
    expect(built.items, 'the screen read the shop').toBeGreaterThan(2);
    expect(built.n, 'nothing was found worth showing').toBeGreaterThan(0);
    /* it must have found more than one ANGLE — a screen that only ever says one thing is a poster, not a campaign */
    expect(built.kinds.length, 'only one kind of slide: ' + built.kinds.join(',')).toBeGreaterThan(1);
    expect(built.kinds, 'the shop card is always available').toContain('shop');
  });

  await test.step('⚠️ IT ACTUALLY DREW — pixels, not the absence of an error', async () => {
    const look = await tv.evaluate(() => {
      const c = document.getElementById('c');
      if (!c || !c.width) return { ok: false, why: 'no canvas' };
      const g = c.getContext('2d'), seen = new Set();
      for (let i = 0; i < 400; i++)
        { const d = g.getImageData((i * 37) % c.width, (i * 53) % c.height, 1, 1).data; seen.add(d[0] + ',' + d[1] + ',' + d[2]); }
      return { ok: true, colours: seen.size, w: c.width, h: c.height };
    });
    expect(look.ok, look.why).toBe(true);
    /* a blank or single-fill frame samples 1–2 colours; a drawn poster has type, a pill and a gradient */
    expect(look.colours, 'the frame looks empty — the renderer probably threw').toBeGreaterThan(12);
    expect(look.w).toBe(1920);
    expect(look.h).toBe(1080);
  });

  await test.step('⭐ every channel is the SAME campaign in a different shape', async () => {
    const want = { status: [1080, 1920], instagram: [1080, 1080], facebook: [1200, 630], tv: [1920, 1080] };
    for (const ch of Object.keys(want)) {
      await tv.click('#chan button[data-c="' + ch + '"]');
      await tv.waitForTimeout(400);
      const got = await tv.evaluate(() => { const c = document.getElementById('c');
        const g = c.getContext('2d'); const seen = new Set();
        for (let i = 0; i < 300; i++) { const d = g.getImageData((i * 31) % c.width, (i * 47) % c.height, 1, 1).data; seen.add(d[0] + ',' + d[1] + ',' + d[2]); }
        return { w: c.width, h: c.height, colours: seen.size }; });
      expect(got.w, ch + ' width').toBe(want[ch][0]);
      expect(got.h, ch + ' height').toBe(want[ch][1]);
      expect(got.colours, ch + ' drew an empty frame').toBeGreaterThan(12);
    }
  });

  await test.step('⭐ and a caption is written for the places that need words', async () => {
    await tv.click('#chan button[data-c="instagram"]');
    await tv.waitForTimeout(300);
    const cap = await tv.inputValue('#cap');
    expect(cap.length, 'no caption was written').toBeGreaterThan(20);
    expect(cap, 'the caption must name the shop').toContain(await page.evaluate(() => SESSION.entity));
    /* the television gets no caption — there is nobody there to copy it */
    await tv.click('#chan button[data-c="tv"]');
    await expect(tv.locator('#capwrap')).toBeHidden();
  });

  await test.step('the campaigns are rules, and switching one changes what plays', async () => {
    const ids = await tv.evaluate(() => [...document.getElementById('camp').options].map((o) => o.value));
    expect(ids).toContain('auto');
    expect(ids).toContain('offers');
    await tv.selectOption('#camp', 'shop');
    await tv.waitForTimeout(400);
    const only = await tv.evaluate(() => shown().every((s) => ['shop', 'spotlight'].indexOf(s.kind) >= 0));
    expect(only, 'a chosen campaign still showed slides from outside its rule').toBe(true);
  });

  expect(threw, 'the shop screen threw').toEqual([]);
  await tv.close();
});
