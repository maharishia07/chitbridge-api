// demo-offers.spec.js — SHOWCASE (DEMO=1 only): two products, every offer kind in different combinations, and the screens that show each —
// the Setup › Offers register, each product's Offers tab (the cart breakdown), the compose cart with both lines.
// Athi, 2026-09-05: "if the offer is for the entire chit or based on slab, how will this be displayed … create a
// couple of products, add each type of offer and show it here, for different combinations".
const { test, expect } = require('@playwright/test');
const { mintEntity, addProduct, clickNav, settle, dismissModal, openTab } = require('../fixtures');
const path = require('path');
const OUT = process.env.DEMO_OUT || path.join(__dirname, '..', 'demo-out');

test('demo: every offer kind, two products, the screens', async ({ page }) => {
  test.skip(!process.env.DEMO, 'set DEMO=1 to stage the showcase');
  test.setTimeout(420000);
  require('fs').mkdirSync(OUT, { recursive: true });
  await mintEntity(page);
  await addProduct(page, { name: 'Basmati 25kg', price: 1000 });
  await addProduct(page, { name: 'Ponni Boiled 10kg', price: 600 });

  const ids = await page.evaluate(async () => {
    const rows = await api('prodList');
    const f = (n) => { const p = rows.find((x) => ((x.item_data || x).name || '') === n); return p ? { id: p.item_id || p.id, d: p.item_data || p } : null; };
    const b = f('Basmati 25kg'), p = f('Ponni Boiled 10kg');
    /* tax: Basmati cites the governed 18%, Ponni the governed 5% — so the footer shows tax after offers */
    await api('prodEdit', { params: { id: b.id }, body: { item_data: Object.assign({}, b.d, { tax_slab: 'IN-GST-18', tax_slab_name: 'GST 18%', gst_rate: 18 }) } });
    await api('prodEdit', { params: { id: p.id }, body: { item_data: Object.assign({}, p.d, { tax_slab: 'IN-GST-5', tax_slab_name: 'GST 5%', gst_rate: 5 }) } });
    return { basmati: b.id, ponni: p.id };
  });

  const offers = [
    { sub: 'percent_off', name: 'Basmati 10% off', rules: { percent: 10, scope: 'line', priority: 1, applies_to: { item_ids: [ids.basmati] } } },
    { sub: 'tier_price',  name: 'Basmati bulk price', rules: { tiers: [{ qty: 10, price: 950 }, { qty: 20, price: 900 }], scope: 'line', priority: 2, applies_to: { item_ids: [ids.basmati] } } },
    { sub: 'amount_off',  name: 'Ponni ₹50 off a bag', rules: { amount: 50, scope: 'line', priority: 1, applies_to: { item_ids: [ids.ponni] } } },
    { sub: 'buy_x_get_y', name: 'Ponni buy 5 get 1', rules: { buy: 5, get: 1, scope: 'line', priority: 2, applies_to: { item_ids: [ids.ponni] } } },
    { sub: 'threshold',   name: 'Spend ₹5,000 → 5% off the order', rules: { min_amount: 5000, percent: 5, scope: 'cart', priority: 9 } },
    { sub: 'shipping',    name: 'Free shipping over ₹3,000', rules: { free: true, min_amount: 3000, priority: 10 } },
  ];
  const made = await page.evaluate(async (offers) => {
    const out = [];
    for (const o of offers) { const r = await api('defAdd', { body: { kind: 'offer', sub_kind: o.sub, name: o.name, rules: o.rules, status: 'live', confirmed: true } }); out.push({ name: o.name, id: r && r.definition && r.definition.definition_id, status: r && r.definition && r.definition.status }); }
    return out;
  }, offers);
  console.log('MADE ' + JSON.stringify(made));
  /* seeded through the API, not Setup — so drop the page's offers cache the way Setup's after-change hook does */
  await page.evaluate(() => { UI._ctOffers = undefined; UI._ctOffersThen = []; });
  expect(made.every((m) => m.status === 'live'), JSON.stringify(made)).toBe(true);

  const shot = async (name, sel) => { const el = sel ? page.locator(sel).first() : page; await el.screenshot({ path: path.join(OUT, name + '.png') }); console.log('SHOT ' + name); };

  await test.step('Setup › Offers — the register + the six months', async () => {
    await clickNav(page, 'catalogue'); await settle(page); await dismissModal(page);
    await page.evaluate(() => goCatsetSec('offers')); await settle(page);
    await expect(page.getByTestId('catset-offer-plan')).toBeVisible({ timeout: 25000 });
    await page.waitForTimeout(1500);
    await shot('1-setup-offers-register', '#detailpane');
  });

  for (const [key, label] of [['basmati', '2-basmati-offers-tab'], ['ponni', '3-ponni-offers-tab']]) {
    await test.step('product Offers tab — ' + key, async () => {
      await clickNav(page, 'catalogue'); await settle(page); await dismissModal(page);
      await page.getByTestId('cat-product-' + ids[key]).click();
      await page.getByTestId('prod-tab-offers').click();
      /* the offers list loads once per session and repaints the tab when it lands — poll by re-clicking the tab */
      await expect.poll(async () => { await page.getByTestId('prod-tab-offers').click().catch(() => {}); return page.getByTestId('prod-offer-preview').count(); }, { timeout: 30000, intervals: [1000] }).toBeGreaterThan(0);
      await page.waitForTimeout(1200);
      await shot(label, '#detailpane');
      await openTab(page, 'pricing');
      await expect(page.getByTestId('prod-tax-preview')).toBeVisible({ timeout: 25000 });
      await page.waitForTimeout(600);
      await shot(label.replace('offers-tab', 'pricing-tax-tab'), '#detailpane');
    });
  }

  await test.step('the catalogue list rows', async () => {
    await clickNav(page, 'catalogue'); await settle(page); await dismissModal(page);
    await expect(page.locator('[data-testid^="cbcat-tags-"]').first()).toBeVisible({ timeout: 25000 });
    await shot('4-catalogue-rows', '#panel');
  });

  await test.step('compose — both lines, the cart breakdown', async () => {
    await clickNav(page, 'compose'); await settle(page);
    for (const ln of [{ item: 'Basmati 25kg', qty: 12, price: 1000 }, { item: 'Ponni Boiled 10kg', qty: 6, price: 600 }]) {
      await page.getByTestId('chit-item-name').fill(ln.item);
      await page.getByTestId('chit-item-qty').fill(String(ln.qty));
      await page.getByTestId('chit-item-price').fill(String(ln.price));
      await page.getByTestId('chit-item-add').click();
      await page.waitForTimeout(800);
    }
    await page.waitForTimeout(1500);
    await shot('5-compose-cart', '#panel');
    const probe = await page.evaluate(() => ({ savings: CC.savings, notes: CC.offerNotes, lines: (CC.items || []).map((it) => ({ name: it.particulars, qty: it.qty, price: it.price, off: it._offer_off, why: it._offer_why, auto: !!it._auto_offer })) }));
    console.log('CART ' + JSON.stringify(probe));
  });
});
