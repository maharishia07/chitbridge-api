// MODULE: Offers — the LIFECYCLE, driven end to end through the controls a person uses.
// [OFF-01] author (draft) → edit → make live → attach to a product → seen on the product → retire → gone.
// [OFF-02] TWO offers on ONE product → the combined outcome on the product page, checked against the engine.
// LOCATORS: catset-sec-offers · catset-offer-new · cbdef-sub · cbdef-name · cbdef-rule-percent · cbdef-save ·
//           .catset-drow (Edit / Make live / Retire) · cat-edit · prod-tab-offers · cat-offer-<id> · prod-pane-offers
//
// Athi, 2026-09-03: "i created one, couldn't edit and how will you attach to a product" → "run the life cycle using
// playwright and fix the bugs". Two bugs came out of the first sentence alone: Edit from Catalogue setup looked the
// offer up in a list only the Definitions screen loads (silent no-op), and Setup had no way to make an offer LIVE —
// while a product's Offers tab lists live offers only. This spec is the guard against both, and the rest of the cycle.
//
// ⚠️ A FRESH ENTITY, on purpose: the shared account accumulates offers across runs and "the offer is listed" would pass
// for the wrong reason. Every write is waited on (the response), never a screen timeout.
const { test, expect } = require('@playwright/test');
const { mintEntity, addProduct, clickNav, settle, dismissModal } = require('../fixtures');

const isDefWrite = (r, method) => /\/api\/definitions/.test(r.url()) && r.request().method() === method && r.status() < 400;
/* The rendered money is `symbol + raw number` (CBCart.fmt, grouping off by default) — so the digits are the number. */
const num = (s) => Number(String(s || '').replace(/[^0-9.]/g, ''));

test('[OFF-01] author → edit → live → attach → seen → retire', async ({ page }) => {
  test.setTimeout(180000);
  await mintEntity(page);
  const prod = 'Offer Rice ' + Date.now();
  const offerName = 'E2E ten off ' + Date.now();
  await addProduct(page, { name: prod, price: 100 });

  const row = () => page.locator('.catset-drow', { hasText: offerName.slice(0, 12) }).first();
  const openOffersSection = async () => {
    await clickNav(page, 'catsetup');
    await page.getByTestId('catset-sec-offers').click();
    await settle(page);
  };

  await test.step('AUTHOR — a 10% offer, saved as a draft', async () => {
    await openOffersSection();
    await page.getByTestId('catset-offer-new').click();
    await expect(page.getByTestId('cbdef-name')).toBeVisible();
    const sub = page.getByTestId('cbdef-sub');
    if (await sub.count()) await sub.selectOption('percent_off');       // repaints the form; fill AFTER it
    await page.getByTestId('cbdef-name').fill(offerName);
    await page.getByTestId('cbdef-rule-percent').fill('10');
    const saved = page.waitForResponse((r) => isDefWrite(r, 'POST'), { timeout: 45000 });
    await page.getByTestId('cbdef-save').click();
    await saved;
    await settle(page);
    await expect(row()).toBeVisible();
    await expect(row()).toContainText(/draft/i);
  });

  await test.step('EDIT — from Setup, the form opens WITH the offer in it (this was a silent no-op)', async () => {
    await row().getByText('Edit', { exact: true }).click();
    const name = page.getByTestId('cbdef-name');
    await expect(name).toBeVisible({ timeout: 15000 });
    await expect(name).toHaveValue(offerName);                         // the lookup found it
    await name.fill(offerName + ' v2');
    const saved = page.waitForResponse((r) => isDefWrite(r, 'PUT'), { timeout: 45000 });
    await page.getByTestId('cbdef-save').click();
    await saved;
    await settle(page);
    await expect(row()).toContainText('v2');                           // the Setup list refreshed, not only Definitions
  });

  await test.step('LIVE — from the same list', async () => {
    const saved = page.waitForResponse((r) => isDefWrite(r, 'PUT'), { timeout: 45000 });
    await row().getByText(/^(Make live|Publish)$/)   /* the row says Publish since the publish-on-a-date work (b203) */.click();
    await saved;
    await settle(page);
    await expect(row()).toContainText(/live/i);
    await expect(row().getByText('Back to draft', { exact: true })).toBeVisible();
  });

  let offerId = null;
  await test.step('ATTACH — Edit › Offers on the product, tick it', async () => {
    await clickNav(page, 'catalogue');
    await settle(page);
    await page.locator('[data-testid^="cat-product-"]', { hasText: prod }).first().click();
    await page.getByTestId('cat-edit').click();
    await page.getByTestId('prod-tab-offers').click();
    const chip = page.getByTestId('prod-pane-offers').locator('[data-testid^="cat-offer-"]', { hasText: offerName.slice(0, 12) }).first();
    await expect(chip).toBeVisible({ timeout: 20000 });                 // live → it is offered here
    offerId = (await chip.getAttribute('data-testid')).replace('cat-offer-', '');
    const saved = page.waitForResponse((r) => isDefWrite(r, 'PUT'), { timeout: 45000 });
    await chip.click();
    await saved;
    await settle(page);
    await expect(page.getByTestId('cat-offer-' + offerId)).toContainText('✓');
  });

  await test.step('SEEN — View › Offers lists it with its terms', async () => {
    await page.getByText('Cancel', { exact: true }).first().click();  // back to View, tab stays on Offers
    await settle(page);
    const pane = page.getByTestId('prod-pane-offers');
    await expect(pane).toContainText(offerName.slice(0, 12), { timeout: 15000 });
    await expect(pane).toContainText('10% off');
  });

  await test.step('RETIRE — and it leaves the product', async () => {
    await openOffersSection();
    await row().getByText('Retire', { exact: true }).click();
    const ok = page.getByTestId('confirm-ok');
    if (await ok.isVisible().catch(() => false)) {
      /* Retire is a DELETE that never deletes — the row survives as "retired" so chits that cite it stay explicable. */
      const saved = page.waitForResponse((r) => isDefWrite(r, 'DELETE'), { timeout: 45000 });
      await ok.click();
      await saved;
    }
    await settle(page);
    await expect(row()).toContainText(/retired/i);

    await clickNav(page, 'catalogue');
    await settle(page);
    await page.locator('[data-testid^="cat-product-"]', { hasText: prod }).first().click();
    await page.getByTestId('prod-tab-offers').click();
    await expect(page.getByTestId('prod-pane-offers')).not.toContainText(offerName.slice(0, 12), { timeout: 15000 });
  });
});

// ── [OFF-02] TWO OFFERS ON ONE PRODUCT ────────────────────────────────────────────────────────────────────────
// LOCATORS: catset-sec-offers · catset-offer-new · cbdef-sub · cbdef-name · cbdef-rule-percent ·
//           cbdef-rule-amount · cbdef-rule-priority · cbdef-rule-exclusive · cbdef-preview · cbdef-save ·
//           .catset-drow · cat-edit · prod-tab-offers · cat-offer-<id> · prod-offer-preview ·
//           prod-offer-preview-total · prod-offer-break-1
//
// Athi, 2026-09-03: "can we give two offers at once, can we include two offers to one product, how does it apply,
// each screen should showcase the outcome" and "the ENTIRE calculation should showcase how it will be reflected in
// the shopping cart, so it can be verified then and there."
//
// ⚠️⚠️ THE ASSERTION THAT MATTERS IS THE AGREEMENT, not the presence of a panel. The preview is only worth
// anything if the number on it is the number the engine returns for the same basket — so the rendered total is
// compared against CBOffers.evaluate() run in the page, on a line built the same way. A preview that merely
// EXISTS would pass while showing a price the cart will not honour, which is the whole failure it exists to stop.
//
// ⚠️ WHAT THIS DOES NOT COVER: the compose CART end to end. These offers target the product by applies_to.item_ids,
// and composeChit() types a line by NAME — a typed line carries no item_id, so no targeted offer can fire on it and
// the walk would assert nothing. Adding the product through compose's catalogue picker is the missing half. What is
// asserted instead is that compose LOADS both offers into CC.offers (ccLoadOffers), which is the input the cart
// prices from; the pricing itself is proven by e2e/offers-combined.test.cjs and e2e/offers-kinds.test.cjs against
// the same evaluate().
test('[OFF-02] two live offers on one product — the product page shows the combined outcome', async ({ page }) => {
  test.setTimeout(240000);
  await mintEntity(page);
  const stamp = Date.now();
  const prod = 'Combo Rice ' + stamp;
  const PRICE = 1000;
  const nameA = 'E2E ten pc ' + stamp;      // 10% off, priority 1
  const nameB = 'E2E flat off ' + stamp;    // 100 off, priority 2
  await addProduct(page, { name: prod, price: PRICE });

  const row = (n) => page.locator('.catset-drow', { hasText: n.slice(0, 14) }).first();
  const openOffersSection = async () => {
    await clickNav(page, 'catsetup');
    await page.getByTestId('catset-sec-offers').click();
    await settle(page);
  };
  /* ⭐ ONE authoring walk, called twice. Two copies of it would drift the first time a field moved. */
  const author = async (name, sub, rules) => {
    await openOffersSection();
    await page.getByTestId('catset-offer-new').click();
    await expect(page.getByTestId('cbdef-name')).toBeVisible();
    await page.getByTestId('cbdef-sub').selectOption(sub);      // repaints the form; fill AFTER it
    await page.getByTestId('cbdef-name').fill(name);
    for (const k of Object.keys(rules)) {
      const f = page.getByTestId('cbdef-rule-' + k);
      if (rules[k] === true) await f.check(); else await f.fill(String(rules[k]));
    }
    /* ⭐ THE OUTCOME STRIP IS PART OF THE FORM, so it is asserted where it is authored. */
    await expect(page.getByTestId('cbdef-preview')).toBeVisible();
    const created = page.waitForResponse((r) => isDefWrite(r, 'POST'), { timeout: 45000 });
    await page.getByTestId('cbdef-save').click();
    await created;
    await settle(page);
    const live = page.waitForResponse((r) => isDefWrite(r, 'PUT'), { timeout: 45000 });
    await row(name).getByText(/^(Make live|Publish)$/)   /* the row says Publish since the publish-on-a-date work (b203) */.click();
    await live;
    await settle(page);
    await expect(row(name)).toContainText(/live/i);
  };

  await test.step('AUTHOR — 10% off, then a flat amount off, both live', async () => {
    await author(nameA, 'percent_off', { percent: '10', priority: '1' });
    await author(nameB, 'amount_off', { amount: '100', priority: '2' });
  });

  let pid = null;
  await test.step('ATTACH BOTH to the one product', async () => {
    await clickNav(page, 'catalogue');
    await settle(page);
    await page.locator('[data-testid^="cat-product-"]', { hasText: prod }).first().click();
    await page.getByTestId('cat-edit').click();
    await page.getByTestId('prod-tab-offers').click();
    const pane = page.getByTestId('prod-pane-offers');
    for (const n of [nameA, nameB]) {
      const chip = pane.locator('[data-testid^="cat-offer-"]', { hasText: n.slice(0, 14) }).first();
      await expect(chip).toBeVisible({ timeout: 20000 });
      const saved = page.waitForResponse((r) => isDefWrite(r, 'PUT'), { timeout: 45000 });
      await chip.click();
      await saved;
      await settle(page);
    }
    pid = await page.evaluate(() => UI.prodSel);
    expect(pid).toBeTruthy();
  });

  await test.step('⭐⭐ THE CART PREVIEW — both offers, in order, with the price they produce', async () => {
    const prev = page.getByTestId('prod-offer-preview');
    await expect(prev).toBeVisible({ timeout: 20000 });
    /* Both offers are named, and the breakdown says what each of them did. */
    await expect(prev).toContainText(nameA.slice(0, 14));
    await expect(prev).toContainText(nameB.slice(0, 14));
    await expect(page.getByTestId('prod-offer-break-1')).toContainText('10% off');

    /* ⭐⭐ THE AGREEMENT. Same line, same offers, same engine — run in the page, compared to what is rendered. */
    const engine = await page.evaluate((a) => {
      const on = (UI._ctOffers || []).filter(function (o) {
        const at = (o.rules && o.rules.applies_to) || {};
        return Array.isArray(at.item_ids) && at.item_ids.indexOf(a.id) >= 0;
      }).map(function (o) { return o.rules; });
      const lines = [{ key: '0', item_id: a.id, sku: null, categories: [], qty: 1, unitPrice: a.price }];
      const ev = CBOffers.evaluate({ lines: lines, offers: on });
      return { total: ev.total, applied: ev.adjustments.length, offers: on.length };
    }, { id: pid, price: PRICE });

    expect(engine.offers).toBe(2);
    expect(engine.applied).toBe(2);                       // both landed on the one line
    expect(engine.total).toBe(800);                       // 1000 - 10% - 100
    expect(num(await page.getByTestId('prod-offer-preview-total').textContent())).toBe(engine.total);
  });

  await test.step('SEEN IN VIEW TOO — the read-only tab shows the same calculation', async () => {
    await page.getByText('Cancel', { exact: true }).first().click();   // back to View, tab stays on Offers
    await settle(page);
    await expect(page.getByTestId('prod-offer-preview')).toBeVisible({ timeout: 15000 });
    expect(num(await page.getByTestId('prod-offer-preview-total').textContent())).toBe(800);
  });

  await test.step('⚠️ EXCLUSIVE — make the first one exclusive and the second is SKIPPED, with the reason', async () => {
    await openOffersSection();
    await row(nameA).getByText('Edit', { exact: true }).click();
    await expect(page.getByTestId('cbdef-name')).toHaveValue(nameA, { timeout: 15000 });
    await page.getByTestId('cbdef-rule-exclusive').check();
    const saved = page.waitForResponse((r) => isDefWrite(r, 'PUT'), { timeout: 45000 });
    await page.getByTestId('cbdef-save').click();
    await saved;
    await settle(page);

    await clickNav(page, 'catalogue');
    await settle(page);
    await page.locator('[data-testid^="cat-product-"]', { hasText: prod }).first().click();
    await page.getByTestId('prod-tab-offers').click();
    const brk = page.getByTestId('prod-offer-break-1');
    await expect(brk).toBeVisible({ timeout: 20000 });
    /* ⭐ The SKIPPED row is the answer to "how does it apply" — the second offer is named, struck, and explained. */
    await expect(brk).toContainText('an exclusive offer already applied');
    expect(num(await page.getByTestId('prod-offer-preview-total').textContent())).toBe(900);   // only the 10%
  });

  await test.step('THE CART IS FED THE SAME OFFERS — compose loads both', async () => {
    await clickNav(page, 'compose');
    await settle(page);
    /* ccLoadOffers() runs when compose opens and resolves on its own time — poll for the arrival rather than
       reading CC.offers once, the moment after the click. */
    await expect.poll(async () => page.evaluate((names) => names.map(function (n) {
      return (typeof CC !== 'undefined' && CC.offers || []).some(function (o) { return String(o.label || '').indexOf(n) >= 0; });
    }), [nameA.slice(0, 14), nameB.slice(0, 14)]), { timeout: 20000 }).toEqual([true, true]);
    await dismissModal(page);
  });

  /* ⭐ THE HALF THAT WAS MISSING (2026-09-04): a typed line naming MY product IS that product (ccMatchMine), so the
     product-targeted offers fire in compose exactly as on the storefront — the same evaluate, the same lines. */
  await test.step('COMPOSE — typing the product name makes the targeted offers fire on the line', async () => {
    /* dismissModal above may have closed the compose panel itself (Escape) — open it again, as the fixture does */
    await clickNav(page, 'compose'); await settle(page);
    await expect(page.getByTestId('chit-item-name')).toBeVisible({ timeout: 20000 });
    await page.getByTestId('chit-item-name').fill(prod);
    await page.getByTestId('chit-item-qty').fill('3');
    await page.getByTestId('chit-item-price').fill('1000');
    await page.getByTestId('chit-item-add').click();
    const probe = () => page.evaluate(() => {
      const items = (typeof CC !== 'undefined' && CC.items) || [];
      const mine = items.find((it) => !it._auto_offer);
      let adj = null, lines = null, offers = null;
      try { lines = ccOfferLines(); offers = (CC.offers || []).map((o) => ({ id: o.id, kind: o.kind, scope: o.scope, applies_to: o.applies_to, status: o.status })); adj = CBOffers.evaluate({ lines, offers: CC.offers }).adjustments; } catch (e) { adj = String(e && e.message); }
      let sync = null, fm = null;
      try { ccSyncOffers(); sync = { off: CC.items[0] && CC.items[0]._offer_off, savings: CC.savings, notes: CC.offerNotes }; } catch (e) { sync = 'ERR ' + String(e && e.message); }
      try { fm = fmtMoney(3000, (typeof myCur === 'function') ? myCur() : 'INR'); } catch (e) { fm = 'ERR ' + String(e && e.message); }
      return { matched: !!(mine && mine.item_id), off: items.some((it) => (it._offer_off || 0) > 0 || it._auto_offer), savings: (typeof CC !== 'undefined' && CC.savings) || 0, sync, fm, lines, offers, adj };
    });
    await expect.poll(async () => { const r = await probe(); return { matched: r.matched, off: r.off }; }, { timeout: 20000 }).toMatchObject({ matched: true, off: true })
      .catch(async (e) => { throw new Error(e.message + ' PROBE ' + JSON.stringify(await probe()).slice(0, 1500)); });
  });
});
