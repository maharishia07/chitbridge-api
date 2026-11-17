/* empty-shot.cjs — Photograph the register as a brand-new entity meets it: nothing recorded, nowhere to record it yet. */
const { chromium } = require('@playwright/test');
const path = require('path');
const { mintEntity } = require('./fixtures');
const OUT = path.join(__dirname, 'register-shots');
require('fs').mkdirSync(OUT, { recursive: true });

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 },
    baseURL: process.env.CB_WEB_BASE || 'http://localhost:5173' });
  const page = await ctx.newPage();
  const shot = async (name) => {
    await page.waitForTimeout(700);
    const el = page.locator('[data-testid="register-panel"]');
    const target = (await el.count()) ? el : page;
    await target.screenshot({ path: path.join(OUT, name + '.png') });
    console.log('  ✓ ' + name + '.png');
  };
  try {
    await mintEntity(page);
    await page.evaluate(() => navTo('raida'));
    await page.locator('[data-testid="register-panel"][data-ready="1"]').waitFor({ timeout: 30000 });
    await shot('0-empty');

    /* And the same form opened as the + from anywhere, with an order in scope. */
    await page.evaluate(() => cbRegisterFor('11111111-2222-3333-4444-555555555555', 'Full service — TN 09 BZ 4512'));
    await page.getByTestId('raida-quickadd').waitFor({ timeout: 25000 });
    await page.waitForTimeout(700);
    await page.locator('#modalhost .modal').screenshot({ path: path.join(OUT, '0-quickadd.png') });
    console.log('  ✓ 0-quickadd.png');
    console.log('\nShots in ' + OUT);
  } catch (e) { console.error('FAILED: ' + e.message); process.exitCode = 1; }
  finally { await browser.close(); }
})();
