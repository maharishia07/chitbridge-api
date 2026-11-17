// [LAB-01] THE OFFER LAB, ON THE REAL CATALOGUE — and an offer attached to a CATEGORY, overridden on one product.
//
// Athi, 2026-09-11: "can you bring the real catalogue into offer lab instead of test data — which entity opens and
// its catalogue", "anything should be possible", and "if it is attached to a category it applies to all products;
// one or two products we should be able to override with different offers."
//
// ⚠️ WHY A SPEC AND NOT A UNIT TEST. The lab COULD already read the real catalogue — it was a button nobody
// pressed, so it opened on five invented products and a shop proving an offer was proving it against a shop that
// does not exist. That failure has no symptom: the numbers are all correct, for the wrong catalogue.
const { test, expect } = require('@playwright/test');
const { mintEntity, addProduct } = require('../fixtures');

test('[LAB-01] the lab opens on your own catalogue, scopes an offer to a category, and lets one product out', async ({ page, context }) => {
  test.setTimeout(420000);
  const stamp = Date.now().toString().slice(-6);
  await mintEntity(page, { fresh: true, name: 'Lab ' + stamp });

  await test.step('a real catalogue: two biscuits and something that is not one', async () => {
    await addProduct(page, { name: 'Lab cookies ' + stamp, unit: 'packet', price: 100, code: 'LC' + stamp });
    await addProduct(page, { name: 'Lab hamper ' + stamp, unit: 'box', price: 1000, code: 'LH' + stamp });
    await addProduct(page, { name: 'Lab soap ' + stamp, unit: 'piece', price: 50, code: 'LS' + stamp });
    await page.evaluate(async (s) => {
      const r = await api('prodList', { query: { limit: 200 } });
      const list = Array.isArray(r) ? r : ((r && (r.items || r.products)) || []);
      for (const p of list) {
        const d = p.item_data || p, nm = String(d.name || '');
        if (!nm.includes(s)) continue;
        const cat = /soap/i.test(nm) ? 'Lab cleaning' : 'Lab biscuits';
        await api('prodEdit', { params: { id: p.item_id }, body: { item_data: Object.assign({}, d, { category: cat }) } });
      }
    }, stamp);
  });

  await test.step('the browser holds a signed-in session, as it does after a real sign-in', async () => {
    /**
     * ⚠️ THE FIXTURE CLEARS cb_sess and signs in through the API, so SESSION lives in memory and nothing is
     * persisted — while a REAL sign-in goes through setSession(), which writes it. The lab is a separate page and
     * can only read what is on disk, so this calls the app's OWN persistence rather than writing the key by hand:
     * driving the function the product uses is the only way this proves anything about the product.
     */
    await page.evaluate(() => { if (typeof setSession === 'function') setSession({}); });
    const held = await page.evaluate(() => { try { return !!JSON.parse(localStorage.getItem('cb_sess') || 'null'); } catch (_) { return false; } });
    expect(held, 'the app did not persist a session, so no separate page can read one').toBe(true);
  });

  const lab = await context.newPage();
  await test.step('⭐⭐⭐ it opens on YOUR catalogue, not on sample products', async () => {
    /* the lab reads the session the app left in this browser, so it must be opened in the same context */
    await lab.goto('/offer-lab.html');
    await lab.waitForFunction(() => typeof PRODUCTS !== 'undefined' && window.CBOffers, null, { timeout: 40000 });
    /* ⚠️ it loads the catalogue asynchronously on boot — wait for the real thing, do not race it */
    await lab.waitForFunction((s) => PRODUCTS.some((p) => String(p.item_data.name).includes(s)), stamp, { timeout: 40000 });

    /**
     * ⚠️ ASSERTED AGAINST THE SESSION, NOT A LITERAL. mintEntity's  is a label for the TEST — the entity is
     * actually registered as e2eco-…, so an expectation of 'Lab ' was testing my own assumption and failed three
     * times while the lab was right. Ask the browser who it is signed in as and check the lab agrees.
     */
    const who = await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('cb_sess') || '{}'); return s.entity || s.name || ''; });
    expect(who, 'the browser holds no entity name to compare against').toBeTruthy();
    const src = await lab.locator('#src').textContent();
    expect(src, 'the lab does not name the shop it is showing').toContain(who);
    expect(src, 'the lab is still on the sample set').not.toMatch(/sample/i);

    const names = await lab.evaluate(() => PRODUCTS.map((p) => p.item_data.name).join(' | '));
    expect(names, 'the invented products are still there').not.toMatch(/Sunflower oil|Grapes/);
  });

  await test.step('⭐⭐ the catalogue STRUCTURE came with it — categories, with counts', async () => {
    /**
     * ⚠️ THE MAPPER READ `categories`/`category_ids` AND THE CATALOGUE WRITES `category`, so every product used to
     * arrive uncategorised — and a category-scoped offer then matched nothing, silently. The lab reported "no line
     * qualifies", which reads as a rule that is wrong rather than a field lost in transit.
     */
    const cats = await lab.evaluate(() => CATS.map((c) => c.name + ':' + c.n).join(' | '));
    expect(cats, 'the categories did not survive the read — a category offer can match nothing').toMatch(/Lab biscuits:2/);
    expect(cats).toMatch(/Lab cleaning:1/);
    await expect(lab.locator('#scope-cat'), 'there is no category picker').toBeVisible();
  });

  await test.step('⭐⭐⭐ an offer attached to a CATEGORY reaches every product in it', async () => {
    await lab.selectOption('#scope-cat', 'Lab biscuits');
    const out = await lab.evaluate((s) => {
      /* 10% off, scoped by the picker — then ask the engine what it does to a basket of all three */
      setOn('pct', true); setV('pct-v', 10); labRepaint();
      const sel = PRODUCTS.map((p) => ({ item_id: p.item_id, quantity: 1 }));
      const r = evalFor('', sel);
      const by = {};
      PRODUCTS.forEach((p) => { by[p.item_data.name] = r.ev.line_net[String(p.item_id)]; });
      return { by, scope: JSON.stringify((labOffers()[0] || {}).applies_to || {}) };
    }, stamp);
    expect(out.scope, 'the offer was not scoped to the category that was picked').toMatch(/Lab biscuits/);
    expect(out.by['Lab cookies ' + stamp], 'a biscuit did not get the category offer').toBe(90);
    expect(out.by['Lab hamper ' + stamp], 'a biscuit did not get the category offer').toBe(900);
    expect(out.by['Lab soap ' + stamp], 'a product OUTSIDE the category was discounted').toBe(50);
  });

  await test.step('⭐⭐⭐ and ONE product can be held out of it', async () => {
    /**
     * Athi: "one or two products we should be able to override with different offers." The opt-out is the
     * product's only answer to a category offer — his own rule from 2026-09-04, "no two directions, governance or
     * override". Held out, the hamper keeps its list price while the category offer still reaches the cookies.
     */
    await expect(lab.locator('[data-testid^="lab-optout-"]').first(),
      'the opt-out tick is not offered even though a category is scoped').toBeVisible({ timeout: 15000 });

    const out = await lab.evaluate((s) => {
      const hamper = PRODUCTS.filter((p) => /hamper/i.test(p.item_data.name))[0];
      labOptOut(hamper.item_id, true);
      const sel = PRODUCTS.map((p) => ({ item_id: p.item_id, quantity: 1 }));
      const r = evalFor('', sel);
      const by = {};
      PRODUCTS.forEach((p) => { by[p.item_data.name] = r.ev.line_net[String(p.item_id)]; });
      return by;
    }, stamp);
    expect(out['Lab hamper ' + stamp], 'the held-out product still took the category offer').toBe(1000);
    expect(out['Lab cookies ' + stamp], 'holding one product out broke the offer for the others').toBe(90);
  });

  await test.step("⚠️ and the opt-out does NOT take the product out of its own offer", async () => {
    /**
     * ⚠️⚠️ THE BUG THIS CATCHES, which I wrote and then removed: excluding with the platform's '*' marker means
     * "out of EVERY offer" — so the product would lose its own offer too, which is the exact opposite of an
     * override. The exclusion must name the CATEGORY-scoped ids and nothing else.
     */
    const out = await lab.evaluate(() => {
      const hamper = PRODUCTS.filter((p) => /hamper/i.test(p.item_data.name))[0];
      /* its own offer, on this product alone, beside the category one it is held out of */
      const offers = labOffers().concat([{ id: 'own', label: 'Hamper 25%', kind: 'percent_off', percent: 25,
                                           scope: 'line', applies_to: { item_ids: [String(hamper.item_id)] } }]);
      const lines = engineLines(PRODUCTS.map((p) => ({ item_id: p.item_id, quantity: 1 })));
      const ev = CBOffers.evaluate({ lines: lines, offers: offers, ctx: { now: new Date(), currency: 'INR' } });
      return { hamper: ev.line_net[String(hamper.item_id)] };
    });
    expect(out.hamper, "the opt-out also blocked the product's OWN offer — that is not an override, it is a mute")
      .toBe(750);
  });
});
