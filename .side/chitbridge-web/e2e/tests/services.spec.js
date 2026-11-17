// services.spec.js — [SVC-01] The governed capabilities as SERVICES (rung 2): with one key scoped 'services', another system prices a line
// by the entity's tiered structure, gets the tax slab a product resolves to, computes GST on a walk-in sale, and builds
// a whole invoice (pricing → offers → tax) — the same figures the two-party tour shows on the chit. One contract lists all.
const { test, expect } = require('@playwright/test');
const { mintEntity, addProduct, clickNav } = require('../fixtures');
const API = process.env.CB_API_BASE || 'https://chitbridge-api-production.up.railway.app';

test('[SVC-01] pricing, tax and invoice as services, one key, one contract', async ({ page, request }) => {
  test.setTimeout(300000);
  await mintEntity(page, { fresh: true });
  await clickNav(page, 'catalogue');
  await addProduct(page, { name: 'Basmati 25kg', unit: 'bag', price: 1000, code: 'BAS-25' });
  const pid = await page.evaluate(() => UI.prodSel); expect(pid).toBeTruthy();

  /* the shelf: GST 5% slab cited, a 10% offer, a tiered structure (10 → 950, 50 → 900), a GSTIN for the state */
  await page.evaluate(async ({ pid }) => {
    const slab = (await api('defAdd', { body: { kind: 'tax', name: 'GST 5', rules: { rate: 5 }, status: 'live' } })).definition.definition_id;
    await api('defAdd', { body: { kind: 'offer', name: 'Basmati 10% off', sub_kind: 'percent_off', rules: { kind: 'percent_off', percent: 10, applies_to: { item_ids: [pid] } }, status: 'live', confirmed: true } });
    const tiers = [{ qty: 10, price: 950 }, { qty: 50, price: 900 }];
    const pd = (await api('defAdd', { body: { kind: 'pricing', name: 'Bulk bags', sub_kind: 'tiered', rules: { tiers }, status: 'live' } })).definition;
    const r = await api('prodList', { query: { limit: 50 } }); const p = (r.items || r || []).find((x) => (x.item_id || x.id) === pid);
    const copy = { pricing_def: String(pd.definition_id), pricing_def_name: pd.name || 'Bulk bags', pricing_kind: 'tiered', pricing_tiers: tiers, pricing_amount: null, pricing_min: null, pricing_max: null };
    await api('prodEdit', { params: { id: pid }, body: { item_data: Object.assign({}, p.item_data, { tax_slab: slab }, copy) } });
    await api('saveProfile', { body: { gstn: '29ABCDE1234F1Z5', address: '12 Market Road, Bengaluru' } });
  }, { pid });

  const k = await page.evaluate(async () => { if (typeof ensureCap === 'function') await ensureCap('admin'); return api('keysMint', { body: { name: 'services spec', scopes: ['services'], days: 1 } }); });
  expect(k.key).toBeTruthy();
  const H = { 'X-Api-Key': k.key };

  await test.step('PRICING — 6 bags at the list price, 10 at 950, 60 at 900; by code, no structure sent', async () => {
    const r = await request.post(API + '/api/pricing/price', { headers: H, data: { lines: [{ key: 'a', code: 'BAS-25', qty: 6 }, { key: 'b', code: 'BAS-25', qty: 10 }, { key: 'c', item_id: pid, qty: 60 }] } });
    expect(r.status()).toBe(200); const j = await r.json();
    expect(j.lines.map((l) => l.unit_price)).toEqual([1000, 950, 900]);
    expect(j.lines[1].structure).toBe('tiered'); expect(j.lines[1].bands.length).toBe(3);
  });

  await test.step('TAX — the slab a line resolves to; GST on a walk-in sale splits CGST/SGST in Karnataka', async () => {
    const r = await request.post(API + '/api/tax/rate', { headers: H, data: { lines: [{ key: 'a', code: 'BAS-25' }] } });
    expect(r.status()).toBe(200); const j = await r.json(); expect(j.lines[0].gst_rate).toBe(5); expect(j.lines[0].slab).toBe('GST 5');
    const c = await request.post(API + '/api/tax/compute', { headers: H, data: { buyer: { name: 'Walk-in' }, lines: [{ key: 'a', code: 'BAS-25', name: 'Basmati 25kg', qty: 6, listPrice: 1000, discount: 600 }] } });
    expect(c.status()).toBe(200); const t = await c.json();
    expect(t.invoice.ValDtls.AssVal).toBe(5400); expect(t.invoice.ValDtls.CgstVal + t.invoice.ValDtls.SgstVal).toBe(270); expect(t.invoice.ValDtls.IgstVal).toBe(0);
    expect(t.invoice._cb.supply).toBe('intra');
  });

  await test.step('INVOICE — the whole pipeline: 6 × list 1,000 → 10% off 600 → taxable 5,400 → GST 270 → 5,670', async () => {
    const r = await request.post(API + '/api/invoice/build', { headers: H, data: { buyer: { name: 'Priya (buyer)' }, lines: [{ key: 'a', code: 'BAS-25', qty: 6 }] } });
    expect(r.status()).toBe(200); const j = await r.json();
    expect(j.pricing[0].unit_price).toBe(1000);
    expect(j.offers.total).toBe(5400); expect(j.offers.adjustments.length).toBe(1);
    expect(j.rates[0].gst_rate).toBe(5);
    expect(j.invoice.ItemList[0].Discount).toBe(600); expect(j.invoice.ValDtls.AssVal).toBe(5400);
    expect(j.invoice.ValDtls.CgstVal + j.invoice.ValDtls.SgstVal).toBe(270); expect(j.invoice.ValDtls.TotInvVal).toBe(5670);
    /* ten bags: the tier re-prices first, then the offer, then the tax */
    const r2 = await request.post(API + '/api/invoice/build', { headers: H, data: { buyer: { name: 'Priya' }, lines: [{ key: 'a', code: 'BAS-25', qty: 10 }] } });
    const j2 = await r2.json();
    expect(j2.pricing[0].unit_price).toBe(950); expect(j2.offers.total).toBe(8550);
    /* 8,550 + 5% = 8,977.50 — the invoice rounds off to the rupee (RndOffAmt), as an Indian tax invoice does */
    expect(j2.invoice.ValDtls.CgstVal + j2.invoice.ValDtls.SgstVal).toBe(427.5); expect(j2.invoice.ValDtls.TotInvVal).toBe(8978); expect(Math.abs(j2.invoice.ValDtls.RndOffAmt)).toBe(0.5);
  });

  await test.step('THE CONTRACT — one document lists every service; a wrong scope is refused', async () => {
    const o = await request.get(API + '/api/openapi.json'); expect(o.status()).toBe(200); const d = await o.json();
    for (const p of ['/api/offers/explain', '/api/pricing/price', '/api/tax/compute', '/api/invoice/build', '/api/keys']) expect(d.paths[p], p).toBeTruthy();
    const k2 = await page.evaluate(async () => { if (typeof ensureCap === 'function') await ensureCap('admin'); return api('keysMint', { body: { name: 'pricing only', scopes: ['pricing'], days: 1 } }); });
    const no = await request.post(API + '/api/invoice/build', { headers: { 'X-Api-Key': k2.key }, data: { lines: [{ qty: 1, listPrice: 1 }] } });
    expect(no.status()).toBe(403);
  });
});
