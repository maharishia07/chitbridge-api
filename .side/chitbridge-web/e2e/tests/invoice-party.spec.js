// invoice-party.spec.js — [INV-03] The invoice's supplier block comes from the profile + the Business identity vault; what is missing is named on
// the Invoice row AND on Trade ready (same reader). Fill the vault → both clear.
const { test, expect } = require('@playwright/test');
const { mintEntity, addProduct, clickNav, settle } = require('../fixtures');

test('[INV-03] supplier details on the invoice, missing fields named, tied to Trade ready', async ({ page }) => {
  test.setTimeout(300000);
  await mintEntity(page);
  await clickNav(page, 'catalogue');
  await addProduct(page, { name: 'Basmati 25kg', unit: 'bag', price: 1000, code: 'BAS-25' });

  await test.step('FRESH — the header is incomplete and says what is missing', async () => {
    await page.getByTestId('prod-tab-invoice').click();
    await expect(page.getByTestId('prod-invoice-missing')).toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId('prod-invoice-missing')).toContainText('gstin');
    await expect(page.getByTestId('prod-outcome-invoice')).toContainText('missing');
    const rd = await page.evaluate(async () => { if (typeof ensureCap === 'function') await ensureCap('readiness'); return await api('readinessOwn'); });
    const inv = ((rd && rd.clearances) || []).find((c) => c.doc === 'invoice_header');
    expect(inv && inv.status, 'Trade ready carries the invoice header as a pending clearance').toBe('pending');
  });

  await test.step('FILL — GSTIN on the profile, the rest in the Business identity vault', async () => {
    await page.evaluate(async () => { if (typeof ensureCap === 'function') await ensureCap('admin');
      await api('saveProfile', { body: { gstn: '29ABCDE1234F1Z5', address: '12 Market Road' } });
      await api('vaultSave', { body: { vault: { sections: [{ type: 'identity', label: 'Business identity', rows: [
        { name: 'Legal name', tag: 'legal_name', value: 'Basmati Traders Pvt Ltd' },
        { name: 'City', tag: 'city', value: 'Bengaluru' },
        { name: 'PIN', tag: 'pincode', value: '560001' },
        { name: 'Phone', tag: 'phone', value: '+91 98450 00000' },
      ] }] } } });
      UI._party = undefined; UI._me = null;
    });
    await page.evaluate(() => prodRepaintSection('invoice'));
    await page.waitForFunction(() => UI._party && UI._party.complete === true, null, { timeout: 30000 });
    await page.evaluate(() => prodRepaintSection('invoice'));
    await expect(page.getByTestId('prod-invoice-missing')).toHaveCount(0);
    const sup = page.getByTestId('prod-invoice-supplier');
    await expect(sup).toContainText('Basmati Traders Pvt Ltd');
    await expect(sup).toContainText('29ABCDE1234F1Z5');
    await expect(sup).toContainText('ABCDE1234F');          /* PAN, derived from the GSTIN */
    await expect(sup).toContainText('Karnataka');           /* state, from the GSTIN's first two digits */
    await expect(sup).toContainText('560001');
    await expect(sup).toContainText('98450');
    const rd = await page.evaluate(async () => { if (typeof ensureCap === 'function') await ensureCap('readiness'); return await api('readinessOwn'); });
    const inv = ((rd && rd.clearances) || []).find((c) => c.doc === 'invoice_header');
    expect(inv && inv.status, 'Trade ready now holds the invoice header as gathered').toBe('gathered');
  });
});
