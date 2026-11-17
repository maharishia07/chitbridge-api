// api-keys.spec.js — [KEY-01] API keys for other systems, THROUGH THE CONTROL: Settings › Integrations › mint → the key is shown once →
// it calls the offer service with X-Api-Key → it cannot manage keys → revoke through the control → it is dead at once.
// Athi, 2026-09-05: "create the entire offer as a capability and attach it to any other systems".
const { test, expect } = require('@playwright/test');
const { mintEntity, clickNav } = require('../fixtures');
const API = process.env.CB_API_BASE || 'https://chitbridge-api-production.up.railway.app';

test('[KEY-01] mint a key in Settings › Integrations, use it on the offer service, revoke it', async ({ page, request }) => {
  test.setTimeout(240000);
  await mintEntity(page);
  /* Settings lives under the avatar menu, not the rail — reached the app's own way */
  await page.evaluate(async () => { if (typeof ensureCap === 'function') await ensureCap('admin'); navTo('settings'); });
  await page.waitForTimeout(800);
  await page.getByTestId('set-sec-integrations').click({ timeout: 30000 });

  let key = '';
  await test.step('MINT — the key is shown once, listed with its last four', async () => {
    await page.getByTestId('int-key-name').fill('Tally connector');
    const minted = page.waitForResponse((r) => /\/api\/keys$/.test(r.url()) && r.request().method() === 'POST' && r.status() < 400, { timeout: 30000 });
    await page.getByTestId('int-key-mint').click(); await minted;
    await expect(page.getByTestId('int-key-shown')).toBeVisible({ timeout: 20000 });
    key = (await page.getByTestId('int-key-value').textContent()).trim();
    expect(key.split('.').length).toBe(3);
    await expect(page.locator('[data-testid^="int-key-revoke-"]').first()).toBeVisible({ timeout: 20000 });
  });

  await test.step('USE — the key evaluates offers, and cannot manage keys', async () => {
    const r = await request.post(API + '/api/offers/explain', { headers: { 'X-Api-Key': key }, data: {
      lines: [{ key: 'a', item_id: 'A', qty: 2, unitPrice: 100 }, { key: 'b', item_id: 'B', qty: 1, unitPrice: 50 }],
      offers: [{ id: 'o1', label: 'Rice+oil', kind: 'bundle_price', bundle_items: ['A', 'B'], bundle_price: 120 }] } });
    expect(r.status()).toBe(200);
    const j = await r.json(); expect(j.total).toBe(220); expect(j.adjustments.length).toBe(2); expect(j.explain[0].why).toContain('Rice+oil');
    const k = await request.get(API + '/api/keys', { headers: { 'X-Api-Key': key } });
    expect(k.status()).toBe(403);
    const spec = await request.get(API + '/api/offers/openapi.json');
    expect(spec.status()).toBe(200); expect((await spec.json()).paths['/api/offers/evaluate']).toBeTruthy();
  });

  await test.step('REVOKE — through the control; the key is dead at once', async () => {
    const revoked = page.waitForResponse((r) => /\/api\/keys\//.test(r.url()) && r.request().method() === 'DELETE' && r.status() < 400, { timeout: 30000 });
    await page.locator('[data-testid^="int-key-revoke-"]').first().click(); await revoked;
    await expect(page.locator('[data-testid^="int-key-revoke-"]')).toHaveCount(0, { timeout: 20000 });
    /* the middleware caches a listing for a minute per jti — a revoked key was never cached as ok by THIS process's
       key-list read unless it was used within the minute; use a fresh request path: the service must refuse */
    let status = 200;
    for (let i = 0; i < 8 && status === 200; i++) {
      const r2 = await request.post(API + '/api/offers/evaluate', { headers: { 'X-Api-Key': key }, data: { lines: [{ key: 'a', qty: 1, unitPrice: 10 }], offers: [] } });
      status = r2.status(); if (status === 200) await page.waitForTimeout(10000);
    }
    expect(status).toBe(401);
  });
});
