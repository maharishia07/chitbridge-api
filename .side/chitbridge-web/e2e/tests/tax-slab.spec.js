// MODULE: Tax slabs — author a slab, make it live, attach it to a product, and READ THE INVOICE BACK.
// author (draft) → make live → catalogue default answers an unattached product → attach on Pricing & tax →
// the resolved slab and its source in View → the intra/inter split computed by lib/tax.js itself.
// LOCATORS: catset-sec-tax · catset-tax-new · cbdef-sub · cbdef-name · cbdef-rule-rate · cbdef-save ·
//           .catset-drow (Make live) · catset-tax-default · cat-edit · prod-tab-pricing · prod-tax ·
//           prod-tax-slab · prod-tax-resolved · prod-tax-preview · prod-tax-preview-intra · prod-tax-preview-inter
//
// Athi, 2026-09-03: "in india tax is not simple, each product has different tax criteria, so it has to be product
// specific, but there are slabs, so define slab and attach the slab to the product" — and, on every attach screen:
// "each tab in the catalogue is going to attach those and it has to showcase the outcome … so it can be verified
// then and there."
//
// ⚠️⚠️ THE ASSERTIONS READ THE ARITHMETIC, NOT A LABEL. A pane that renders "GST 18%" beside a split it computed
// its own way would pass any text check and be wrong on the invoice. So the preview publishes what tax.js
// returned as data-* attributes (INV-01 names: AssAmt · GstRt · CgstAmt · SgstAmt · IgstAmt · TotItemVal) and this
// spec checks the NUMBERS: intra must be rate/2 on each head, inter the whole rate on IGST, and the two must sum
// to the same total. That is the only version of this test that can fail for the right reason.
//
// ⚠️ A FRESH ENTITY, on purpose — the shared account accumulates slabs across runs and "a slab is listed" would
// pass for the wrong reason. Every write is waited on (the response), never a screen timeout.
//
// ⚠️ CANNOT BE RUN FROM THE AUTHORING MACHINE: there is no database reachable there (the API's DATABASE_URL is a
// placeholder). Written against the deployed app — `CB_WEB_BASE`, per playwright.config.js — and run on prod.
const { test, expect } = require('@playwright/test');
const { mintEntity, addProduct, clickNav, settle, dismissModal, openTab } = require('../fixtures');

const isDefWrite = (r, method) => /\/api\/definitions/.test(r.url()) && r.request().method() === method && r.status() < 400;
const isFaceWrite = (r) => /\/api\/catalogue-face/.test(r.url()) && r.request().method() === 'PUT' && r.status() < 400;
const num = async (loc, attr) => Number(await loc.getAttribute(attr));
/**
 * Pick an option by the words a person reads. ⚠️ NOT `selectOption({label})` — that matches the label EXACTLY,
 * and these options read "E2E GST 18 1757… · 18%", so an exact match would need the spec to rebuild the option
 * text and would then break the moment the rate suffix changed. Find the option, take its value.
 */
async function selectByText(sel, text) {
  const opt = sel.locator('option', { hasText: text }).first();
  await opt.waitFor({ state: 'attached', timeout: 20000 });
  await sel.selectOption(await opt.getAttribute('value'));
}

test('[TAX-01] define a slab → make it live → attach it → read the invoice split back', async ({ page }) => {
  test.setTimeout(240000);
  await mintEntity(page);

  const PRICE = 100;                       // ⭐ chosen so every expected figure is exact: 18% of 100 = 18, halves 9/9
  const prod = 'Tax Rice ' + Date.now();
  const slabName = 'E2E GST 18 ' + Date.now();
  const lowName = 'E2E GST 5 ' + Date.now();
  await addProduct(page, { name: prod, price: PRICE });

  const openTax = async () => {
    await clickNav(page, 'catsetup');
    await page.getByTestId('catset-sec-tax').click();
    await settle(page);
  };
  const row = (n) => page.locator('.catset-drow', { hasText: n.slice(0, 14) }).first();

  const authorSlab = async (name, rate) => {
    await page.getByTestId('catset-tax-new').click();
    await expect(page.getByTestId('cbdef-name')).toBeVisible({ timeout: 20000 });
    const sub = page.getByTestId('cbdef-sub');
    if (await sub.count()) await sub.selectOption('gst_slab');   // repaints the form; fill AFTER it
    await page.getByTestId('cbdef-name').fill(name);
    await page.getByTestId('cbdef-rule-rate').fill(String(rate));
    const saved = page.waitForResponse((r) => isDefWrite(r, 'POST'), { timeout: 45000 });
    await page.getByTestId('cbdef-save').click();
    await saved;
    await settle(page);
    await expect(row(name)).toBeVisible();
    await expect(row(name)).toContainText(/draft/i);             // ⚠️ a slab is authored as a DRAFT, like every definition
  };
  const makeLive = async (name) => {
    const saved = page.waitForResponse((r) => isDefWrite(r, 'PUT'), { timeout: 45000 });
    await row(name).getByText(/^(Make live|Publish)$/)   /* the row says Publish since the publish-on-a-date work (b203) */.click();
    await saved;
    await settle(page);
    await expect(row(name)).toContainText(/live/i);
  };

  await test.step('AUTHOR — two slabs, saved as drafts, then published', async () => {
    await openTax();
    await authorSlab(slabName, 18);
    await authorSlab(lowName, 5);
    await makeLive(slabName);
    await makeLive(lowName);
  });

  await test.step('CATALOGUE DEFAULT — a product that names no slab still has an answer', async () => {
    /* ⚠️ ONLY LIVE SLABS ARE OFFERED here. A draft catalogue-wide default would apply to every product that
       inherits, which is most of them. */
    const picker = page.getByTestId('catset-tax-default');
    await expect(picker).toBeVisible({ timeout: 20000 });
    /* F5 W1b: the picker is a DRAFT — Save asks first (the workshop's confirmAsk modal); only "Set rate" writes the face */
    await selectByText(picker, lowName.slice(0, 14));
    const saved = page.waitForResponse(isFaceWrite, { timeout: 45000 });
    await page.getByTestId('catset-tax-save').click();
    await page.getByTestId('confirm-ok').click();
    await saved;
    await settle(page);
  });

  const openPricingPane = async () => {
    await clickNav(page, 'catalogue');
    await settle(page);
    await dismissModal(page);
    await page.locator('[data-testid^="cat-product-"]', { hasText: prod }).first().click();
    await openTab(page, 'pricing');
    await expect(page.getByTestId('prod-tax')).toBeVisible({ timeout: 20000 });
  };

  await test.step('INHERIT — with no slab of its own, the product shows the CATALOGUE DEFAULT and says so', async () => {
    await openPricingPane();
    const resolved = page.getByTestId('prod-tax-resolved');
    await expect(resolved).toBeVisible({ timeout: 25000 });
    /* ⭐ THE SOURCE IS PART OF THE ANSWER. "GST 5% — catalogue default" is checkable; a bare 5% is a number
       somebody has to trust. */
    await expect(resolved).toContainText(/catalogue default/i);
    await expect(resolved).toContainText('5%');
  });

  await test.step('ATTACH — pick the 18% slab on Pricing & tax, and the outcome moves BEFORE saving', async () => {
    await page.getByTestId('cat-edit').click();
    await openTab(page, 'pricing');
    const sel = page.getByTestId('prod-tax-slab');
    await expect(sel).toBeVisible({ timeout: 25000 });
    await selectByText(sel, slabName.slice(0, 14));
    /* ⚠️⚠️ "verified then and there" — the preview must follow the SELECT, not the saved product. If this
       assertion needed a save first, the pane would be answering a question nobody asked. */
    await expect(page.getByTestId('prod-tax-preview-intra')).toHaveAttribute('data-rate', '18', { timeout: 15000 });

    const saved = page.waitForResponse(
      (r) => /\/api\/products/.test(r.url()) && r.request().method() === 'PATCH' && r.status() < 400,   /* the product save is a PATCH (prodEdit), not a PUT */
      { timeout: 45000 });
    await page.getByTestId('cat-save').click();
    await saved;
    await settle(page);
  });

  await test.step('READ IT BACK — the resolved slab, its source, and the split lib/tax.js produced', async () => {
    await openPricingPane();
    const resolved = page.getByTestId('prod-tax-resolved');
    await expect(resolved).toBeVisible({ timeout: 25000 });
    /* The product's own citation must now WIN over the catalogue default it was inheriting a moment ago. */
    await expect(resolved).toContainText('18%');
    await expect(resolved).toContainText(/on this product/i);

    await expect(page.getByTestId('prod-tax-preview')).toBeVisible();
    const intra = page.getByTestId('prod-tax-preview-intra');
    const inter = page.getByTestId('prod-tax-preview-inter');

    /* ── the arithmetic, on one unit at ₹100 ─────────────────────────────────────────────────────────────────── */
    expect(await num(intra, 'data-rate')).toBe(18);
    expect(await num(intra, 'data-ass')).toBe(PRICE);
    /* ⚠️ INTRA HALVES THE RATE ACROSS CGST AND SGST. Same goods, same price, same buyer — only the place of
       supply differs, and getting this backwards charges the wrong tax under the wrong heads. */
    expect(await num(intra, 'data-cgst')).toBeCloseTo(PRICE * 18 / 100 / 2, 2);
    expect(await num(intra, 'data-sgst')).toBeCloseTo(PRICE * 18 / 100 / 2, 2);
    expect(await num(intra, 'data-igst')).toBe(0);

    /* ⚠️ INTER PUTS THE WHOLE RATE ON IGST, and nothing on the state heads. */
    expect(await num(inter, 'data-igst')).toBeCloseTo(PRICE * 18 / 100, 2);
    expect(await num(inter, 'data-cgst')).toBe(0);
    expect(await num(inter, 'data-sgst')).toBe(0);

    /* ⭐ THE TWO HALVES SUM TO THE WHOLE, and both cases reach the same line total — which is precisely what a
       counterparty's system reconciles against, and the one figure a rounding slip shows up in. */
    expect(await num(intra, 'data-cgst') + await num(intra, 'data-sgst')).toBeCloseTo(await num(inter, 'data-igst'), 2);
    expect(await num(intra, 'data-total')).toBeCloseTo(await num(inter, 'data-total'), 2);
    expect(await num(intra, 'data-total')).toBeCloseTo(PRICE * 1.18, 2);
  });

  await test.step('INHERIT AGAIN — clearing the slab falls back, it does not zero the tax', async () => {
    /* ⚠️⚠️ THE ONE THAT WOULD BE MISSED. "— inherit —" removing the citation but leaving a stale gst_rate copy
       behind, or writing a 0, would both look like a blank field and mean something very different on an
       invoice. defaults.js: a blank cell means INHERIT, not CLEAR. */
    await page.getByTestId('cat-edit').click();
    await openTab(page, 'pricing');
    const sel = page.getByTestId('prod-tax-slab');
    await expect(sel).toBeVisible({ timeout: 25000 });
    await sel.selectOption('');
    await expect(page.getByTestId('prod-tax-preview-intra')).toHaveAttribute('data-rate', '5', { timeout: 15000 });
    const saved = page.waitForResponse(
      (r) => /\/api\/products/.test(r.url()) && r.request().method() === 'PATCH' && r.status() < 400,
      { timeout: 45000 });
    await page.getByTestId('cat-save').click();
    await saved;
    await settle(page);

    await openPricingPane();
    await expect(page.getByTestId('prod-tax-resolved')).toContainText(/catalogue default/i, { timeout: 25000 });
    expect(await num(page.getByTestId('prod-tax-preview-inter'), 'data-igst')).toBeCloseTo(PRICE * 5 / 100, 2);
  });
});

/**
 * [TAX-02] THE JURISDICTION'S SLABS ARRIVE WITHOUT ANYONE AUTHORING THEM.
 * Athi, 2026-09-04: "we have already a governance layer where we have to create those and inherit here, why each
 * entity should create one for them." A fresh entity (INR → IN) opens Setup › Tax and finds India's GST slabs listed
 * as governance, picks one on a product, and the invoice split follows — no slab of its own anywhere.
 * ⚠️ Needs migration b201 on the database. Until it has run the list has no governed rows and this test SKIPS,
 * saying so, rather than failing on a migration nobody has been asked to run.
 */
test('[TAX-02] a governed slab is inherited, picked on a product, and the split follows', async ({ page }) => {
  test.setTimeout(180000);
  await mintEntity(page);
  const prod = 'Governed Rice ' + Date.now();
  await addProduct(page, { name: prod, price: 100 });

  await clickNav(page, 'catsetup');
  await page.getByTestId('catset-sec-tax').click();
  await settle(page);
  /* ⚠️ The list paints "reading…" first and fills on its own read — count AFTER a row exists, not the instant the
     section opens ([TAX-02] skipped twice on a catalogue that had the rows). */
  await page.locator('.catset-drow').first().waitFor({ timeout: 20000 }).catch(() => {});
  const governed = page.locator('.catset-drow.gov');
  const n = await governed.count().catch(() => 0);
  test.skip(n === 0, 'no governed slabs listed — migration b201 (India GST on region_layer) has not been applied');
  await expect(governed.first()).toContainText(/governance/i);
  await expect(page.locator('.catset-drow.gov', { hasText: 'GST 18%' })).toHaveCount(1);
  /* no Edit / Retire / Make live on a governed row */
  await expect(governed.first().getByText('Edit', { exact: true })).toHaveCount(0);

  await clickNav(page, 'catalogue'); await settle(page); await dismissModal(page);
  await page.locator('[data-testid^="cat-product-"]', { hasText: prod }).first().click();
  await page.getByTestId('cat-edit').click();
  await openTab(page, 'pricing');
  const sel = page.getByTestId('prod-tax-slab');
  /* when the picker is missing, say what the page holds and what the API answers — the two must agree */
  await expect(sel).toBeVisible({ timeout: 25000 }).catch(async (e) => {
    const why = await page.evaluate(async () => { const c = (typeof cbDefsCached === 'function') ? cbDefsCached('tax') : 'n/a'; const r = await api('defList', { query: { kind: 'tax', status: 'live' } }).catch((x) => ({ err: String(x.message) })); const pane = (document.querySelector('[data-testid="prod-pane-pricing"]') || {}).innerText; return { cached: Array.isArray(c) ? c.map((d) => d.definition_id || d.id) : c, api: r.err || (r.definitions || []).map((d) => d.definition_id), pane: String(pane || '').slice(0, 200) }; });
    throw new Error(e.message + ' PROBE ' + JSON.stringify(why));
  });
  await sel.selectOption('IN-GST-18');
  await expect(page.getByTestId('prod-tax-preview-intra')).toHaveAttribute('data-rate', '18', { timeout: 15000 });
  const saved = page.waitForResponse((r) => /\/api\/products\//.test(r.url()) && r.request().method() === 'PATCH' && r.status() < 400, { timeout: 45000 });
  await page.getByTestId('cat-save').click();
  await saved; await settle(page);
  await openTab(page, 'pricing');
  const resolved = page.getByTestId('prod-tax-resolved');
  await expect(resolved).toBeVisible({ timeout: 25000 });
  await expect(resolved).toContainText('18%');
  await expect(resolved).toContainText(/on this product/i);
});
