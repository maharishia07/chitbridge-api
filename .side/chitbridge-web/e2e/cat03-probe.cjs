/* cat03-probe.cjs — [CAT-03], second pass: the API is fine (adopt → schemaFields returns fineness), so the fault is on the screen.
   This walks the spec's exact steps in a real browser and then reports what the form actually holds. */
'use strict';
const { chromium } = require('@playwright/test');
const { mintEntity, settle } = require('./fixtures');
const WEB = process.env.CB_WEB_BASE || 'https://chitbridge-web.vercel.app';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ baseURL: WEB });
  page.on('pageerror', (e) => console.log('  page threw: ' + e.message));
  await mintEntity(page, { fresh: true, name: 'CAT03 ' + Date.now().toString().slice(-6) });

  const adopt = await page.evaluate(async () => { try { return await api('prodStarterAdopt', { body: { vertical: 'gold' } }); } catch (e) { return { error: String(e && e.message) }; } });
  console.log('adopt:', (adopt && adopt.message) || JSON.stringify(adopt));

  await page.getByTestId('nav-catalogue').click();
  await settle(page);
  console.log('after opening Catalogue · UI._catFields =', JSON.stringify(await page.evaluate(() => (UI._catFields || []).map((f) => f.field_key))));

  const btn = page.getByTestId('cat-new-product');
  await btn.waitFor({ state: 'visible', timeout: 20000 });
  await btn.click();
  await page.waitForTimeout(2500);

  const state = await page.evaluate(() => ({
    prodMode: UI.prodMode,
    cached: (UI._catFields || []).map((f) => f.field_key),
    declaredList: (typeof ctDeclaredList === 'function' ? ctDeclaredList() : []).map((f) => f.field_key),
    wrapExists: !!document.getElementById('ct_declared_wrap'),
    wrapHidden: (document.getElementById('ct_declared_wrap') || {}).hidden,
    declaredHtmlLen: ((document.getElementById('ct_declared') || {}).innerHTML || '').length,
    fineness: !!document.querySelector('[data-testid="cat-field-fineness"]'),
    formOnScreen: !!document.querySelector('[data-testid="cat-field-name"]'),
  }));
  console.log('after New product:', JSON.stringify(state, null, 1));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
