// THE PATH — a source store authors a veg BLUEPRINT; two distributors inherit it BY REFERENCE, each with its own
// unit + price. Proves: publish-as-blueprint (b78) → listable source → struct → adopt+commercials (b75). Names only
// (photos are a later pass). Runs against whatever baseURL is configured (prod by default).
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
async function shot(page, n) { fs.mkdirSync(SHOTS, { recursive: true }); await page.waitForTimeout(200); await page.screenshot({ path: path.join(SHOTS, n), fullPage: true }); }
const slugOf = (name) => (String(name || 'store').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'store') + '@v1';

test.describe('Veg blueprint · publish → inherit (the path)', () => {
  test('[VEG-01] source store publishes; wholesale (ton) + retail (kg) inherit with own price', async ({ browser }) => {
    test.setTimeout(240_000);

    // ── Store A — Veg-bp-store: author the blueprint (5 veg, names only) ───────────────────────────────
    const A = await mintInContext(browser, { name: 'Veg-bp-store ' + Date.now() });
    const srcKey = slugOf(A.name);
    await A.page.evaluate(() => { UI.catf = null; UI.cw = null; UI.nav = 'cataloguesetup'; renderApp(); });
    await A.page.waitForTimeout(400);
    await A.page.locator('#cw_purpose').fill('A vegetable supplier — tomato, onion, potato, carrot, spinach');
    await A.page.evaluate(() => cwUnderstand());
    await A.page.evaluate(() => { cwNext(); cwNext(); cwNext(); });   // → step 4 (Manual)
    await A.page.evaluate(() => cwBulkMode('csv'));
    await A.page.locator('#cw_bulk_csv').fill('name\nTomato\nOnion\nPotato\nCarrot\nSpinach');
    await A.page.evaluate(() => cwImportCSV());
    await A.page.evaluate(() => cwFinish());
    await A.page.waitForTimeout(1500);
    await shot(A.page, 'veg-01-A-face.png');

    const itemCount = await A.page.evaluate(() => (UI.catf && UI.catf.items || []).length);
    console.log('A face items:', itemCount);
    expect(itemCount, 'A built a 5-veg catalogue').toBeGreaterThanOrEqual(5);

    // AI ENRICH — fill local + botanical names (they then travel in the blueprint). Needs b113 skill in prod.
    await A.page.evaluate(() => catfEnrichAI());
    let tomato = null;
    for (let t = 0; t < 18; t++) { tomato = await A.page.evaluate(() => (UI.catf.items || []).find((i) => (i.product || i.name) === 'Tomato')); if (tomato && tomato.botanical_name) break; await A.page.waitForTimeout(1000); }
    console.log('Tomato enriched → botanical:', tomato && tomato.botanical_name, '· local:', tomato && tomato.local_names);
    expect(tomato && tomato.botanical_name, 'AI filled Tomato botanical name').toBeTruthy();
    await shot(A.page, 'veg-01b-A-enriched.png');

    // PHOTOS — attach by filename (Tomato.png → the "Tomato" item). Downscaled thumbnail; travels in the blueprint.
    const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEklEQVR42mP8z8BQz0AEYBxVSFENAJd0A/3nQ0f0AAAAAElFTkSuQmCC', 'base64');
    await A.page.locator('#catf_photo_input').setInputFiles([
      { name: 'Tomato.png', mimeType: 'image/png', buffer: PNG },
      { name: 'Onion.png', mimeType: 'image/png', buffer: PNG },
    ]);
    let tomatoPhoto = null;
    for (let t = 0; t < 12; t++) { tomatoPhoto = await A.page.evaluate(() => { const it = (UI.catf.items || []).find((i) => (i.product || i.name) === 'Tomato'); return it && it._photo ? it._photo.slice(0, 20) : null; }); if (tomatoPhoto) break; await A.page.waitForTimeout(400); }
    console.log('Tomato photo attached:', !!tomatoPhoto);
    expect(tomatoPhoto, 'photo matched to the Tomato item by filename').toBeTruthy();

    // publish as a blueprint
    await A.page.evaluate(() => catfPublishBlueprint());
    await A.page.waitForTimeout(2500);
    await shot(A.page, 'veg-02-A-published.png');

    // it should now be listable as a source
    let srcListed = false;
    for (let t = 0; t < 8; t++) {
      const sources = await A.page.evaluate(() => window.api('catalogueSources')).catch(() => []);
      srcListed = Array.isArray(sources) && sources.some((s) => s.key === srcKey);
      if (srcListed) { console.log('blueprint listed:', srcKey, '·', (sources.find((s) => s.key === srcKey) || {}).item_count, 'items'); break; }
      await A.page.waitForTimeout(600);
    }
    expect(srcListed, 'published blueprint appears in catalogue sources: ' + srcKey).toBeTruthy();

    // ── A distributor helper: sees the blueprint, adopts it with ITS OWN price ─────────────────────────
    async function distributorAdopts(label, storeName, priceByVeg) {
      const D = await mintInContext(browser, { name: storeName });
      // sees the source
      const sources = await D.page.evaluate(() => window.api('catalogueSources')).catch(() => []);
      expect(Array.isArray(sources) && sources.some((s) => s.key === srcKey), label + ' sees the veg blueprint').toBeTruthy();
      // structure it (the shared design/items by reference)
      const struct = await D.page.evaluate((k) => window.api('catalogueStruct', { body: { source: k } }), srcKey);
      const names = (struct && struct.finishes || []).map((x) => x.name);
      console.log(label + ' sees items by reference:', names.join(', '));
      expect(names, label + ' inherits the veg names by reference').toContain('Tomato');
      // the AI enrichment travels in the blueprint too (by reference)
      const tomatoRef = (struct && struct.finishes || []).find((x) => x.name === 'Tomato');
      console.log(label + ' inherited Tomato botanical:', tomatoRef && tomatoRef.botanical_name, '· photo:', !!(tomatoRef && tomatoRef.photo));
      expect(tomatoRef && tomatoRef.botanical_name, label + ' inherits the AI enrichment by reference').toBeTruthy();
      expect(tomatoRef && tomatoRef.photo, label + ' inherits the PHOTO by reference').toBeTruthy();
      // adopt with OWN commercials (price), and record it
      const adopt = await D.page.evaluate(([k, com]) => window.api('catalogueAdopt', { body: { source: k, commercials: com, visible: true } }), [srcKey, priceByVeg]);
      console.log(label + ' adopt:', JSON.stringify(adopt).slice(0, 120));
      // read back its own resolved catalogue
      const mine = await D.page.evaluate(() => window.api('catalogueMine'));
      const cat = (mine && mine.catalogues || []).find((c) => c.source === srcKey);
      const tomato = cat && (cat.resolved && cat.resolved.items || []).find((i) => i.name === 'Tomato');
      const price = tomato && tomato.commercials && tomato.commercials.price;
      console.log(label + ' resolved Tomato price:', price);
      await shot(D.page, 'veg-03-' + label.toLowerCase() + '.png');
      return { price, names };
    }

    // Wholesale — sells by the TON (big price); Retail — sells by the KG (small price). Same blueprint, own commercials.
    const whole = await distributorAdopts('Wholesale', 'Veg Wholesale ' + Date.now(), { Tomato: { price: 24000 }, Onion: { price: 18000 } });
    const retail = await distributorAdopts('Retail', 'Veg Retail ' + Date.now(), { Tomato: { price: 30 }, Onion: { price: 25 } });

    // The PATH is proven: both inherited the SAME names by reference, each with its OWN price.
    expect(whole.names, 'wholesale inherited by reference').toContain('Tomato');
    expect(retail.names, 'retail inherited by reference').toContain('Tomato');
    expect(String(amountOf(whole.price)), 'wholesale set its own (ton) price').toBe('24000');
    expect(currencyOf(whole.price), 'and the price carries its currency — the point of the money shape').toBeTruthy();
    expect(String(amountOf(retail.price)), 'retail set its own (kg) price').toBe('30');
    expect(currencyOf(retail.price), 'and the price carries its currency').toBeTruthy();
    console.log('PATH PROVEN — one blueprint, two distributors, own prices:', whole.price, 'vs', retail.price);
  });
});
