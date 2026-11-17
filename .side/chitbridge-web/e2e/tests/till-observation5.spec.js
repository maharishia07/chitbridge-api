// [TILL-08] OBSERVATION 5 — everything Athi found by using the counter on 2026-09-10, driven through the real page.
//
// ⚠️ WHY THESE ARE WORTH A SPEC AND NOT A UNIT TEST. Every figure in his four screenshots was CORRECT. What was
// wrong was what the counter said about them — a word doing two jobs, an offer that named itself twice, a
// discount with no offer named at all. None of that is visible to arithmetic; all of it is visible to a person,
// and it cost him his confidence in the product ("I am now totally out of confidence").
//
// ⭐ So this drives the SCREEN and reads the WORDS. It is the only kind of test that could have caught any of it.
const { test, expect } = require('@playwright/test');
const { mintEntity, addProduct } = require('../fixtures');

test('[TILL-08] the counter says what it is doing — offers, MRP, and the two ways to add', async ({ page, context }) => {
  test.setTimeout(420000);
  await mintEntity(page, { fresh: true, name: 'Obs5 ' + Date.now().toString().slice(-6) });

  await test.step('a shelf: one plain product with an MRP, and a biscuit that carries an offer', async () => {
    await addProduct(page, { name: 'Hair oil 100 ml', unit: 'piece', price: 48, code: 'OIL5' });
    await addProduct(page, { name: 'Cream biscuit 75 g', unit: 'packet', price: 9, code: 'BIS5' });
    /* MRP is what the shelf row must NAME rather than call a saving */
    await page.evaluate(async () => {
      const r = await api('prodList', { query: { limit: 200 } });
      const list = Array.isArray(r) ? r : ((r && (r.items || r.products)) || []);
      for (const p of list) {
        const d = p.item_data || p, nm = String(d.name || '');
        if (/Hair oil/.test(nm)) await api('prodEdit', { params: { id: p.item_id }, body: { item_data: Object.assign({}, d, { mrp: 55, category: 'Personal care' }) } });
        if (/Cream biscuit/.test(nm)) await api('prodEdit', { params: { id: p.item_id }, body: { item_data: Object.assign({}, d, { mrp: 11, category: 'Biscuits' }) } });
      }
    });
  });

  await test.step('and a buy-2-get-1 on biscuits', async () => {
    const made = await page.evaluate(async () => {
      try {
        return await api('defAdd', { body: { kind: 'offer', sub_kind: 'buy_x_get_y', name: 'Buy 2 biscuits, get 1 free',
          status: 'live', rules: { kind: 'buy_x_get_y', label: 'Buy 2 biscuits, get 1 free', buy: 2, get: 1,
                                   applies_to: { category: 'Biscuits' } } } });
      } catch (e) { return { failed: (e && e.message) || String(e) }; }
    });
    /* ⚠️ if the shop cannot declare an offer the rest of this spec is measuring nothing — say so here, loudly,
       rather than letting four later assertions fail one at a time with unrelated messages */
    expect(made && !made.failed, 'the offer could not be created: ' + JSON.stringify(made)).toBeTruthy();
  });

  let till;
  await test.step('pair a counter and take the shop', async () => {
    const key = await page.evaluate(async () => {
      if (typeof ensureCap === 'function') await ensureCap('admin');   /* keysMint lives in cap-admin, loaded on demand */
      const r = await api('keysMint', { body: { name: 'obs5 counter', scopes: ['till'], days: 1 } });
      return (r && (r.key || r.api_key)) || null;
    });
    expect(key, 'no till key was minted — the counter cannot be paired').toBeTruthy();
    till = await context.newPage();
    await till.goto('/till.html#key=' + encodeURIComponent(key));
    await till.waitForFunction(() => window.CBOffers && window.CBTax, null, { timeout: 40000 });
    await till.evaluate(() => refresh());
    await till.waitForSelector('[data-testid="till-hit-0"]', { timeout: 40000 });
  });

  await test.step('⭐⭐⭐ the shelf names the MRP and never calls the gap a saving', async () => {
    /**
     * Finding 1 + 4, which were one bug: "look at the first 3 products from the list, all show save, but in the
     * cart it is not appearing" — because the shelf's "save" was MRP minus price, a standing fact about the
     * product, while the cart's "save" was an offer coming off a bill. One word, two meanings, and the only
     * conclusion available was that the arithmetic was broken.
     */
    const shelf = await till.locator('#hits').textContent();
    expect(shelf, 'the struck-through figure is unlabelled again — it reads as a price, not an MRP').toMatch(/MRP/);
    expect(shelf, 'the shelf calls the MRP gap a "save" again — that word belongs to offers alone')
      .not.toMatch(/save/i);
  });

  await test.step('⭐⭐ a single click CHOOSES; a double click adds', async () => {
    /* Finding 7: "by just clicking the list it gets added to the cart, that is not my intention." */
    await till.click('[data-testid="till-hit-0"]');
    await expect(till.locator('[data-testid="till-total"]'),
      'a single click billed the product — adding must be deliberate').toHaveText('₹0.00');
    await till.dblclick('[data-testid="till-hit-0"]');
    await expect(till.locator('[data-testid="till-total"]'),
      'a double click did not add — the counter has no mouse route to the bill').not.toHaveText('₹0.00');
  });

  await test.step('⭐ and the + button adds too, for touch', async () => {
    const before = await till.locator('[data-testid="till-total"]').textContent();
    await till.click('[data-testid="till-add-0"]');
    await expect(till.locator('[data-testid="till-total"]')).not.toHaveText(before);
  });

  await test.step('⭐⭐⭐ every offer on a line is named, with its own amount', async () => {
    /**
     * Finding 5, and the one that mattered: "if you say this is because we have setup multiple offers and all are
     * applied, then all the applicable offers must showcase in the list. Without listing the offer it is applied
     * then it is much worse."
     */
    /**
     * ⚠️ THREE UNITS THE WAY THE COUNTER MEANS IT. Clicking + three times does NOT work and should not: after an
     * add the box clears and the list reverts to the whole shop, so row 0 is a different product by the second
     * press (this spec caught exactly that — four hair oils on the bill). The footer advertises the real gesture,
     * '3* quantity', and that is what a shopkeeper types.
     */
    await till.fill('#q', '3*cream biscuit');
    await till.waitForSelector('[data-testid="till-hit-0"]');
    await till.press('#q', 'Enter');
    const note = await till.locator('#cart').textContent();
    expect(note, 'the line does not say what came off for that offer').toMatch(/−|-\s*₹/);
    /**
     * moved 2026-09-17: since the design pass of 2026-09-16 the offer on a line is a CHIP — its words are the TERMS
     * ("Buy 2 get 1 free", what a cashier acts on) and the offer's NAME and what it did ("1 free, 1 set of this product")
     * are its title (text budget: a fact beside a number moves to title=). The same four facts, read where they now live.
     */
    const chip = till.locator('#cart .ochip:not(.pend)').first();
    const title = await chip.getAttribute('title');
    expect(title, 'the offer that took money off is not named on the line').toMatch(/Buy 2 biscuits, get 1 free/);
    /* ⭐ and it says what the LABEL cannot: how many were free, and that this product earned it */
    expect(title, 'the line no longer says how many units were free').toMatch(/1 free/);
    expect(title, 'the line does not say the set was earned by this product').toMatch(/set of this product/i);
    /* ⚠️ and it must NOT repeat the scheme's own terms — the duplication Athi queried: said once, as the chip */
    expect((await chip.textContent()).match(/buy 2 get 1/ig) || [], 'the chip states the terms more than once').toHaveLength(1);
    expect(title, 'the name and the note restate "buy 2 get 1" after the chip already says it').not.toMatch(/buy 2 get 1/i);
  });

  await test.step('⭐⭐ "Saved" is shown as a sum, with every part named', async () => {
    /* "your computation is fine — where you save (9.99 + 25.00 + ...) so it gives an idea what are the savings" */
    const totals = await till.locator('#totals').textContent();
    expect(totals, 'the bill shows a saving with nothing behind it').toMatch(/Saved/);
    expect(totals, 'the saving is a lump again — it must name what it is made of')
      .toMatch(/Buy 2 biscuits, get 1 free/);
  });

  await test.step('⭐⭐ tapping a bill line marks it and points the shelf at that product', async () => {
    /* Findings 4 and 6: "when I select any product from the cart, the list should go to the product" and
       "Ctrl up or down should work for that particular product". */
    await till.click('[data-testid="till-line-0"] .nm');
    const marked = await till.locator('#cart .row.sel').count();
    expect(marked, 'no bill line is in action after tapping one').toBe(1);
    const sel = await till.evaluate(() => {
      const el = document.querySelector('.hit.sel');
      return el ? el.getAttribute('data-item') : null;
    });
    const want = await till.evaluate(() => String(CART[CARTSEL].item_id));
    expect(sel, 'the shelf did not follow the bill line that was tapped').toBe(want);
  });

  await test.step('⭐⭐ Ctrl+↑ changes the line in action, not always the last one', async () => {
    const before = await till.evaluate(() => CART[CARTSEL].qty);
    await till.keyboard.press('Control+ArrowUp');
    const after = await till.evaluate(() => CART[CARTSEL].qty);
    expect(after, 'Ctrl+↑ did not change the line that was marked').toBeGreaterThan(before);
  });
});

test('[TILL-09] the shelf loads past its first page, all the way to the last product', async ({ page, context }) => {
  /**
   * Finding 2: "lazy loading is not happening in the list — only the first selected product is moving up and
   * down, but it has to load the next set of products until the last."
   *
   * ⚠️⚠️ IT WAS A HARD SIXTY (limit:60, .slice(0,60)) on a counter whose own header read "10,436 products". The
   * rest existed only if you typed the right letters, and nothing said so — the list simply ended, which is
   * indistinguishable from a shop that small.
   */
  test.setTimeout(420000);
  await mintEntity(page, { fresh: true, name: 'Deep ' + Date.now().toString().slice(-6) });

  const WANT = 85;                                  /* more than one page, few enough to create in one call */
  await test.step('a shelf deeper than one page', async () => {
    const made = await page.evaluate(async (n) => {
      const items = [];
      for (let i = 1; i <= n; i++) items.push({ name: 'Deep item ' + String(i).padStart(3, '0'), price: 10 + i, unit: 'piece', code: 'DP' + i });
      try { return await api('prodAddMany', { body: { items } }); }
      catch (e) { return { failed: (e && e.message) || String(e) }; }
    }, WANT);
    expect(made && !made.failed, 'the deep shelf could not be created: ' + JSON.stringify(made)).toBeTruthy();
  });

  let till;
  await test.step('pair a counter', async () => {
    const key = await page.evaluate(async () => {
      if (typeof ensureCap === 'function') await ensureCap('admin');   /* keysMint lives in cap-admin, loaded on demand */
      const r = await api('keysMint', { body: { name: 'deep counter', scopes: ['till'], days: 1 } });
      return (r && (r.key || r.api_key)) || null;
    });
    till = await context.newPage();
    await till.goto('/till.html#key=' + encodeURIComponent(key));
    await till.waitForFunction(() => window.CBSearch, null, { timeout: 40000 });
    await till.evaluate(() => refresh());
    await till.waitForSelector('[data-testid="till-hit-0"]', { timeout: 40000 });
  });

  await test.step('⭐ the first page is 60, and the counter knows there are more', async () => {
    const first = await till.evaluate(() => ({ rows: hits().length, more: HAS_MORE, shelf: (S.items || []).length }));
    expect(first.shelf, 'the counter did not take the whole shelf').toBeGreaterThanOrEqual(80);
    expect(first.rows, 'the first page is no longer 60 rows').toBe(60);
    expect(first.more, 'the counter does not know there are more products to show').toBe(true);
  });

  await test.step('⭐⭐ and it keeps loading until the last product, not one page and stop', async () => {
    const end = await till.evaluate(() => {
      let guard = 0;
      while (HAS_MORE && guard++ < 500) showMore();
      return { rows: hits().length, more: HAS_MORE, shelf: (S.items || []).length };
    });
    expect(end.more, 'the list still claims there is more after loading everything').toBe(false);
    expect(end.rows, 'the list stopped short of the shelf — products are unreachable by scrolling')
      .toBe(end.shelf);
  });

  await test.step('⚠️ and a new question starts a new first page', async () => {
    /* or a two-letter search inherits the depth of the last one and redraws thousands of rows */
    await till.fill('#q', 'deep item 0');
    const back = await till.evaluate(() => SHOWN);
    expect(back, 'SHOWN was not reset when the question changed').toBe(60);
  });
});
