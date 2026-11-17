// MODULE: Tax on the chit — the network computes your liability (STUDY-gst-structure-2026-09-04 §4 · G1 G3 G4).
// Two entities: SELLER has a product citing a governed slab; BUYER receives the chit. The seller's ledger shows output
// tax; the buyer's shows input credit for the same figures; completing the copy freezes the invoice.
// LOCATORS: nav-mis · mis-band-tax · mis-tax-* ; the API is asserted through page.evaluate(api(...)) — the same client call.
const { test, expect } = require('@playwright/test');
const { mintEntity, mintInContext, addProduct, clickNav, settle, composeChit, dismissModal, openTab } = require('../fixtures');

const month = () => new Date().toISOString().slice(0, 7);

test('[TAX-03] a rated chit line → seller output · buyer ITC · frozen at completed', async ({ browser, page }) => {
  test.setTimeout(300000);
  /* SELLER in the default context */
  const seller = await mintEntity(page);
  /* ⚠️ A LEDGER IS PER GSTIN. A fresh entity has none, so the engine honestly says "place of supply unknown" and
     charges nothing (tax 0, not a guess). Both parties get one through the same save the Profile form uses —
     Karnataka (29) sells to Maharashtra (27): inter-state, one IGST head. */
  const setGstin = (pg, g) => pg.evaluate(async (gstn) => api('saveProfile', { body: { gstn } }), g);
  await setGstin(page, '29ABCDE1234F1Z5');
  const prod = 'Taxed Rice ' + Date.now();
  await addProduct(page, { name: prod, price: 1000 });

  await test.step('SELLER — the product cites the governed 18% slab', async () => {
    await clickNav(page, 'catalogue'); await settle(page); await dismissModal(page);
    await page.locator('[data-testid^="cat-product-"]', { hasText: prod }).first().click();
    await page.getByTestId('cat-edit').click();
    await openTab(page, 'pricing');
    const sel = page.getByTestId('prod-tax-slab');
    await expect(sel).toBeVisible({ timeout: 25000 });
    await sel.selectOption('IN-GST-18');
    const saved = page.waitForResponse((r) => /\/api\/products\//.test(r.url()) && r.request().method() === 'PATCH' && r.status() < 400, { timeout: 45000 });
    await page.getByTestId('cat-save').click(); await saved; await settle(page);
  });

  /* BUYER in a clean context */
  const buyer = await mintInContext(browser, {});
  try {
    await setGstin(buyer.page, '27ABCDE1234F1Z5');
    await test.step('SELLER sends a chit with that product line to BUYER', async () => {
      await composeChit(page, { subject: 'Tax ledger ' + Date.now(), item: prod, qty: 2, price: 1000, recipients: [buyer.name] });
    });

    let chitId = null;
    await test.step('SELLER ledger: output tax 360 on 2,000 (18%), the line rated at send', async () => {
      const led = await page.evaluate(async (m) => api('taxLedger', { query: { month: m } }), month());
      expect(led.count).toBeGreaterThanOrEqual(1);
      const row = led.rows.find((r) => r.side === 'output' && /Tax ledger/.test(r.subject || ''));
      expect(row, 'the sent chit appears as output').toBeTruthy();
      expect(row.heads.taxable).toBe(2000);
      /* when this fails, say WHY: was the line rated at send, and could the engine decide the supply? */
      const why = await page.evaluate(async (id) => { try { const i = await api('taxInvoice', { params: { id } }); const it = (i.invoice.ItemList || [])[0] || {}; const c = await api('chit', { params: { id } }).catch(() => null); const li = c && (c.line_items || (c.detail && c.detail.line_items) || (c.chit && c.chit.line_items)); return { line0: Array.isArray(li) ? li[0] : (li || 'no line_items on ' + Object.keys(c || {}).join(',')), rated: i.rated, unrated: i.unrated, GstRt: it.GstRt, supply: i.invoice._cb && i.invoice._cb.supply, notes: i.invoice._cb && i.invoice._cb.notes, seller: i.seller, buyer: i.buyer }; } catch (e) { return { error: String(e && e.message) }; } }, row.chit_id);
      expect(row.heads.tax, 'tax on the row — ' + JSON.stringify(why)).toBe(360);
      expect(row.provisional).toBe(true);
      chitId = row.chit_id;
    });

    await test.step('BUYER ledger: the SAME figures as input credit (both regular)', async () => {
      const led = await buyer.page.evaluate(async (m) => api('taxLedger', { query: { month: m } }), month());
      const row = led.rows.find((r) => r.chit_id === chitId);
      expect(row, 'the received copy appears on the buyer side').toBeTruthy();
      expect(row.side).toBe('itc');
      expect(row.heads.tax).toBe(360);
      expect(led.itc.tax).toBeGreaterThanOrEqual(360);
    });

    await test.step('BUYER completes the copy → the invoice is FROZEN on it', async () => {
      const r = await buyer.page.evaluate(async (id) => { try { return await api('status', { params: { id }, body: { status: 'completed' } }); } catch (e) { return { error: String(e && e.message) }; } }, chitId);
      expect(r && !r.error, 'status → completed: ' + JSON.stringify(r).slice(0, 200)).toBeTruthy();
      const inv = await buyer.page.evaluate(async (id) => api('taxInvoice', { params: { id } }), chitId);
      expect(inv.frozen).toBe(true);
      expect(inv.invoice.ValDtls.IgstVal + inv.invoice.ValDtls.CgstVal + inv.invoice.ValDtls.SgstVal).toBe(360);
    });

    await test.step('MIS › Tax band shows the month for the seller', async () => {
      await clickNav(page, 'mis'); await settle(page);
      await page.getByTestId('mis-band-tax').click();
      await expect(page.getByTestId('mis-tax-output')).toContainText('360', { timeout: 25000 });
    });
  } finally { await buyer.context.close(); }
});
