/**
 * ADAPTER: Zoho Books (REST) — the shape a hosted system attaches through: fetch() instead of a local port.
 *   readProducts(): GET /books/v3/items?organization_id=…            → { items:[{ item_id, name, sku, unit, rate, hsn_or_sac, status }] }
 *   pushOrder():    POST /books/v3/invoices?organization_id=…       { customer_name?, reference_number, line_items:[{ name, quantity, rate, discount }] }
 * Auth: an OAuth2 access token ("Zoho-oauthtoken …"); refresh is the person's Zoho app setting (docs/zoho.md). Region-aware
 * base URL (com · in · eu · …).
 *
 * ⚠️ WRITTEN FROM ZOHO'S PUBLISHED API, PROVEN AGAINST fake-zoho.js — not yet against a live Zoho organisation. The first
 * live run may need a field name (customer_id vs customer_name, item_id on lines) corrected in this one file.
 */
'use strict';
module.exports = function zohoAdapter(cfg) {
  const z = Object.assign({ base: 'https://www.zohoapis.in', org: '', token: '', customer_name: 'Walk-in' }, cfg.zoho || {});
  const dry = !!cfg.dry, log = cfg.log || (() => {});
  const H = () => ({ Authorization: 'Zoho-oauthtoken ' + z.token, 'Content-Type': 'application/json' });
  async function call(method, p, body) {
    const url = z.base.replace(/\/$/, '') + p + (p.includes('?') ? '&' : '?') + 'organization_id=' + encodeURIComponent(z.org);
    const r = await fetch(url, { method, headers: H(), body: body ? JSON.stringify(body) : undefined });
    const t = await r.text(); let j; try { j = JSON.parse(t); } catch (_) { j = { raw: t }; }
    if (!r.ok || (j && j.code && j.code !== 0)) throw new Error('Zoho ' + r.status + ' ' + ((j && j.message) || t.slice(0, 120)));
    return j;
  }
  return {
    name: 'zoho',
    async readProducts() {
      const out = []; let page = 1;
      while (page < 50) {
        const j = await call('GET', '/books/v3/items?page=' + page + '&per_page=200');
        for (const it of (j.items || [])) if (!it.status || it.status === 'active') out.push({ name: it.name, code: it.sku || it.item_id, unit: it.unit || 'nos', price: Number(it.rate) || 0, hsn: it.hsn_or_sac || null, category: it.category_name || null, ref: it.item_id });
        if (!(j.page_context && j.page_context.has_more_page)) break; page++;
      }
      return out;
    },
    /** Zoho items carry stock_on_hand / available_stock on the same list */
    async readStock() {
      const at = new Date().toISOString(); const out = []; let page = 1;
      while (page < 50) { const j = await call('GET', '/books/v3/items?page=' + page + '&per_page=200'); for (const it of (j.items || [])) { const q = Number(it.available_stock != null ? it.available_stock : it.stock_on_hand); if (Number.isFinite(q)) out.push({ code: it.sku || it.item_id, qty: q, at }); } if (!(j.page_context && j.page_context.has_more_page)) break; page++; }
      return out;
    },
    /** the organisation: name · address · GSTIN · PAN · phone · email · currency */
    async readProfile() {
      const j = await call('GET', '/books/v3/organizations/' + encodeURIComponent(z.org)); const o = j.organization || {}; const a = o.address || {};
      const out = { legal_name: o.name, trade_name: o.name, address: [a.street_address1, a.street_address2].filter(Boolean).join(', '), city: a.city, state: a.state, pincode: a.zip, country: a.country === 'India' ? 'IN' : a.country, phone: o.phone, email: o.email, currency: o.currency_code, gstin: o.gst_no || (o.tax_settings && o.tax_settings.gst_no), pan: o.pan_no };
      for (const k of Object.keys(out)) if (!out[k]) delete out[k];
      return out;
    },
    async pushOrder(order) {
      const body = { customer_name: z.customer_name || order.buyer, reference_number: 'CB-' + String(order.chit_id).slice(0, 8), date: (order.at || new Date().toISOString()).slice(0, 10), notes: 'ChitBridge order ' + order.chit_id + ' from ' + order.buyer,
        line_items: order.lines.map((l) => ({ name: l.name, description: l.code ? 'code ' + l.code : undefined, quantity: l.qty, rate: l.list_price != null ? l.list_price : l.price, unit: l.unit || undefined,
          discount: (l.list_price != null && l.list_price > l.price) ? (Math.round((1 - l.price / l.list_price) * 10000) / 100) + '%' : undefined })) };
      if (dry) { log('[dry] Zoho invoice for ' + order.chit_id + ':\n' + JSON.stringify(body, null, 2)); return { ref: 'dry-run' }; }
      const j = await call('POST', '/books/v3/invoices', body);
      const inv = j.invoice || {}; return { ref: inv.invoice_number || inv.invoice_id || 'created' };
    },
  };
};
