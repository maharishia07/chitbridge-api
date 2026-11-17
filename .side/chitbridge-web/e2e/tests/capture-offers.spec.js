// capture-offers.spec.js — [CAP-02] A CAPTURED MESSAGE GETS THE SAME OFFER AND TAX AS A STOREFRONT ORDER. The seller's Grapes carry a 5% rate and a
// live 10% offer. A WhatsApp message "2 kg grapes" becomes a chit through the one send path (to self, with its channel in
// business_json.via — exactly what the intake page posts after a human confirms). The chit's line carries the list price,
// the discount, the offer's name and the rate; its invoice says ₹378 — the storefront's figure for the same basket.
// Athi, 2026-09-05: "how does it become a chit when it comes through WhatsApp? check there also — the offer and tax applied."
const { test, expect } = require('@playwright/test');
const { mintEntity, addProduct, clickNav } = require('../fixtures');

test('[CAP-02] a WhatsApp-captured order carries the seller\'s offer and rate, and invoices like the storefront', async ({ page }) => {
  test.setTimeout(240000);
  await mintEntity(page, { fresh: true });
  /* a REGISTERED seller: GST is charged only by a seller with a GSTIN — the view, the send and the invoice all read that one fact */
  await page.evaluate(async () => { await api('saveProfile', { body: { gstn: '33AABCK1234F1Z6' } }); });
  await clickNav(page, 'catalogue');
  await addProduct(page, { name: 'Grapes', unit: 'kg', price: 200, code: 'GRP-1' });
  const out = await page.evaluate(async () => {
    const list = await api('prodList', { query: { limit: 50 } }); const items = list.items || list.products || list.rows || (Array.isArray(list) ? list : []);
    const g = items.find((x) => /^grapes$/i.test(((x.item_data || {}).name || '')));
    await api('prodEdit', { params: { id: g.item_id }, body: { item_data: Object.assign({}, g.item_data, { gst_rate: 5, hsn: '0806' }) } });
    const today = new Date().toISOString().slice(0, 10), later = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    const H = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + SESSION.token };
    await fetch(CFG.API_BASE + '/api/definitions', { method: 'POST', headers: H, body: JSON.stringify({ kind: 'offer', sub_kind: 'percent_off', name: 'Flat 10%', status: 'live', confirmed: true, rules: { kind: 'percent_off', label: 'Flat 10%', percent: 10, scope: 'line', valid_from: today, valid_to: later } }) });
    /* the captured message, as the intake page sends it after the human confirms: to self, the lines the reader made, the channel */
    const r = await fetch(CFG.API_BASE + '/api/chits/send', { method: 'POST', headers: H, body: JSON.stringify({
      recipients: [{ name: 'self', role: 'to' }], subject: 'WhatsApp: 2 kg grapes', manual_subject: 'WhatsApp: 2 kg grapes', purpose: 'general',
      line_items: [{ particulars: 'Grapes', quantity: 2, unit: 'kg', price: 200, total: 400 }],
      business_json: { via: { channel: 'whatsapp', from: '+919876543210', at: new Date().toISOString() } } }) });
    const j = await r.json(); const id = j.chit_id || (j.chit && j.chit.chit_id);
    const c = await api('chit', { params: { id } });
    const inv = await (await fetch(CFG.API_BASE + '/api/invoice/' + id, { headers: H })).json();
    return { status: r.status, id, lines: (c.detail && c.detail.line_items) || c.line_items || [], heads: inv.heads, sells: inv.sells, via: c.header && c.header.business_json && c.header.business_json.via };
  });
  expect(out.status, 'the send').toBeLessThan(300);
  const l = out.lines.find((x) => /grapes/i.test(String(x.particulars || x.name || '')));
  expect(l, 'the captured line').toBeTruthy();
  expect(Number(l.price), 'list price kept').toBe(200);
  expect(Number(l.discount), 'the offer came off').toBe(40);
  expect(l.offer && l.offer.label).toBe('Flat 10%');
  expect(Number(l.total)).toBe(360);
  expect(Number(l.gst_rate), 'the rate rides the line').toBe(5);
  expect(out.via && out.via.channel, 'the channel stays on the chit').toBe('whatsapp');
  expect(out.heads && Number(out.heads.total), 'the invoice: 360 + 5% = 378, the storefront\'s figure').toBe(378);
});
