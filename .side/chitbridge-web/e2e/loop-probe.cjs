/* loop-probe.cjs — Is the product page looping on a catalogue like Athi's? His localhost tab stays "busy" after every load on
 * 2026-09-04 morning (many declared columns, values in all of them, the new tabs). A fresh entity in the specs never
 * hits that shape. Mimic it on prod, open the product, then COUNT API calls over 20s: a settled page makes a handful
 * (auto-refresh every 20s); a loop makes dozens.  node e2e/loop-probe.cjs */
const { chromium } = require('@playwright/test');
const { mintEntity, addProduct, clickNav, settle } = require('./fixtures');

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 860 }, baseURL: process.env.CB_WEB_BASE || 'https://chitbridge-web.vercel.app' });
  const page = await ctx.newPage();
  const calls = [];
  page.on('request', (r) => { if (/\/api\//.test(r.url())) calls.push(r.method() + ' ' + r.url().replace(/^https?:\/\/[^/]+/, '')); });
  try {
    await mintEntity(page);
    for (const v of ['gold', 'paint', 'trade']) {
      await page.evaluate(async (vv) => { try { await api('prodStarterAdopt', { body: { vertical: vv } }); } catch (e) {} }, v);
    }
    await addProduct(page, { name: 'Rice Ponni Boiled', price: 610 });
    /* fill every declared column, like he did */
    await clickNav(page, 'catalogue'); await settle(page);
    await page.locator('[data-testid^="cat-product-"]').first().click();
    await page.getByTestId('cat-edit').click();
    const inputs = page.locator('#ct_declared input[data-key]');
    const n = await inputs.count();
    for (let i = 0; i < n; i++) { const el = inputs.nth(i); const t = await el.getAttribute('data-type'); await el.fill(t === 'number' ? '100' : 'x'); }
    await page.getByTestId('cat-save').click(); await settle(page);
    console.log('declared columns filled:', n);
    for (const tab of ['product', 'offers', 'pricing', 'product']) {
      calls.length = 0;
      await page.getByTestId('prod-tab-' + tab).click();
      await page.waitForTimeout(20000);
      console.log('tab ' + tab + ': ' + calls.length + ' API calls in 20s' + (calls.length > 12 ? '  ⚠️ LOOP?' : ''));
      if (calls.length > 12) { const tally = {}; calls.forEach((c) => { tally[c] = (tally[c] || 0) + 1; }); console.log(JSON.stringify(tally, null, 1).slice(0, 1500)); }
    }
  } catch (e) { console.error('FAILED: ' + e.message); process.exitCode = 1; }
  finally { await browser.close(); }
})();
