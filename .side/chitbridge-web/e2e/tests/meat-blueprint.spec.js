// POWERPLAY — Athi's meat scenario, end to end, registering the stores against prod. Person A (Meat-bp-store) authors
// a meat catalogue (names + AI-enrich + photos) and publishes it as a blueprint; wholesale + retail inherit it BY
// REFERENCE, each with its own price. Screenshots at each stage into wizard-shots/meat-*.
const { test, expect } = require('@playwright/test');
const { mintInContext } = require('../fixtures');
const fs = require('fs');
const path = require('path');

/**
 * ⚠️ A PRICE IS `{ amount, currency }`, NEVER A BARE NUMBER (lib/money.js). Reading `.price` directly gave
 * "[object Object]" and read as a broken inherit — the assertion was stale, the feature was fine.
 */
const amountOf = (p) => (p && typeof p === "object") ? p.amount : p;
const currencyOf = (p) => (p && typeof p === "object") ? p.currency : null;
const SHOTS = path.join(__dirname, '..', 'wizard-shots');
async function shot(page, n) { fs.mkdirSync(SHOTS, { recursive: true }); await page.waitForTimeout(250); await page.screenshot({ path: path.join(SHOTS, n), fullPage: true }); }
const slugOf = (name) => (String(name || 'store').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'store') + '@v1';
const ITEMS = ['Chicken', 'Mutton', 'Fish', 'Prawn', 'Egg'];

test.describe('Meat blueprint · POWERPLAY (publish → inherit)', () => {
  test('[MEAT-01] Meat-bp-store publishes; wholesale + retail inherit with own price', async ({ browser }) => {
    test.setTimeout(300_000);

    // ── Store A — Meat-bp-store: author + enrich + photos + publish ────────────────────────────────────
    const A = await mintInContext(browser, { name: 'Meat-bp-store ' + Date.now() });
    const srcKey = slugOf(A.name);
    await A.page.evaluate(() => { UI.catf = null; UI.cw = null; UI.nav = 'cataloguesetup'; renderApp(); });
    await A.page.waitForTimeout(400);
    await A.page.locator('#cw_purpose').fill('A meat supplier — chicken, mutton, fish, prawn and egg');
    await A.page.evaluate(() => cwUnderstand());
    await A.page.evaluate(() => { cwNext(); cwNext(); cwNext(); });   // → step 4 (Manual)
    await A.page.evaluate(() => cwBulkMode('csv'));
    await A.page.locator('#cw_bulk_csv').fill('name\n' + ITEMS.join('\n'));
    await A.page.evaluate(() => cwImportCSV());
    await A.page.evaluate(() => cwFinish());
    await A.page.waitForTimeout(1500);
    await shot(A.page, 'meat-01-A-face.png');
    const itemCount = await A.page.evaluate(() => (UI.catf && UI.catf.items || []).length);
    console.log('A face items:', itemCount);
    expect(itemCount, 'A built a meat catalogue').toBeGreaterThanOrEqual(5);

    // AI enrich (tolerant — meat may enrich local names/category more reliably than a botanical binomial)
    await A.page.evaluate(() => catfEnrichAI());
    let chick = null;
    for (let t = 0; t < 18; t++) { chick = await A.page.evaluate(() => (UI.catf.items || []).find((i) => (i.product || i.name) === 'Chicken')); if (chick && (chick.local_names || chick.botanical_name || chick.category)) break; await A.page.waitForTimeout(1000); }
    console.log('Chicken enriched → local:', chick && chick.local_names, '· botanical:', chick && chick.botanical_name, '· category:', chick && chick.category);
    await shot(A.page, 'meat-01b-A-enriched.png');

    // photos by filename
    const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEklEQVR42mP8z8BQz0AEYBxVSFENAJd0A/3nQ0f0AAAAAElFTkSuQmCC', 'base64');
    await A.page.locator('#catf_photo_input').setInputFiles([
      { name: 'Chicken.png', mimeType: 'image/png', buffer: PNG },
      { name: 'Mutton.png', mimeType: 'image/png', buffer: PNG },
    ]);
    for (let t = 0; t < 12; t++) { const ok = await A.page.evaluate(() => { const it = (UI.catf.items || []).find((i) => (i.product || i.name) === 'Chicken'); return !!(it && it._photo); }); if (ok) break; await A.page.waitForTimeout(400); }

    await A.page.evaluate(() => catfPublishBlueprint());
    await A.page.waitForTimeout(2500);
    await shot(A.page, 'meat-02-A-published.png');

    let srcListed = false;
    for (let t = 0; t < 8; t++) { const s = await A.page.evaluate(() => window.api('catalogueSources')).catch(() => []); srcListed = Array.isArray(s) && s.some((x) => x.key === srcKey); if (srcListed) break; await A.page.waitForTimeout(600); }
    expect(srcListed, 'meat blueprint listed: ' + srcKey).toBeTruthy();
    console.log('blueprint published:', srcKey);

    // ── Distributor helper ─────────────────────────────────────────────────────────────────────────────
    async function distributorAdopts(label, storeName, priceByItem) {
      const D = await mintInContext(browser, { name: storeName });
      const sources = await D.page.evaluate(() => window.api('catalogueSources')).catch(() => []);
      expect(Array.isArray(sources) && sources.some((s) => s.key === srcKey), label + ' sees the meat blueprint').toBeTruthy();
      const struct = await D.page.evaluate((k) => window.api('catalogueStruct', { body: { source: k } }), srcKey);
      const names = (struct && struct.finishes || []).map((x) => x.name);
      const chickRef = (struct && struct.finishes || []).find((x) => x.name === 'Chicken');
      console.log(label + ' inherits:', names.join(', '), '· Chicken photo:', !!(chickRef && chickRef.photo), '· local:', chickRef && chickRef.local_names);
      expect(names, label + ' inherits the meat names by reference').toContain('Chicken');
      await D.page.evaluate(([k, com]) => window.api('catalogueAdopt', { body: { source: k, commercials: com, visible: true } }), [srcKey, priceByItem]);
      const mine = await D.page.evaluate(() => window.api('catalogueMine'));
      const cat = (mine && mine.catalogues || []).find((c) => c.source === srcKey);
      const price = cat && ((cat.resolved && cat.resolved.items || []).find((i) => i.name === 'Chicken') || {}).commercials;
      console.log(label + ' resolved Chicken price:', price && price.price);
      await shot(D.page, 'meat-03-' + label.toLowerCase() + '.png');
      return { names, price: price && price.price };
    }

    const whole = await distributorAdopts('Wholesale', 'Meat Wholesale ' + Date.now(), { Chicken: { price: 28000 }, Mutton: { price: 62000 } });
    const retail = await distributorAdopts('Retail', 'Meat Retail ' + Date.now(), { Chicken: { price: 240 }, Mutton: { price: 780 } });

    expect(whole.names, 'wholesale inherited').toContain('Chicken');
    expect(retail.names, 'retail inherited').toContain('Chicken');
    expect(String(amountOf(whole.price)), 'wholesale own price').toBe('28000');
    expect(currencyOf(whole.price), 'and the price carries its currency — the point of the money shape').toBeTruthy();
    expect(String(amountOf(retail.price)), 'retail own price').toBe('240');
    expect(currencyOf(retail.price), 'and the price carries its currency').toBeTruthy();
    console.log('POWERPLAY DONE — one meat blueprint, two distributors, own prices:', whole.price, 'vs', retail.price);
  });
});
