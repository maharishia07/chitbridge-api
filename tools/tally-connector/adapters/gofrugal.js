/**
 * ADAPTER: GoFrugal RetailEasy / HQ — its "WebReporter" API on the retailer's own server (grocery and pharmacy POS).
 *   readProducts(): GET  /WebReporter/api/v1/items          → { items:[{ itemId, itemName, locationId, stock:[{ stock, salePrice, mrp, itemReferenceCode, taxPercentage }] }] }
 *   readStock():    the same list — the stock per location, stamped
 *   pushOrder():    POST /WebReporter/api/v1/salesOrders    { salesOrder: { onlineReferenceNo, customerName, …, orderItems:[{ rowNo, itemId, itemName, salePrice, quantity, itemAmount, taxPercentage, discountPercentage }] } }
 *                   → { result: { status: 'Success', id } } — a SALES ORDER; GoFrugal's own billing raises the invoice from it.
 * Auth: header `X-Auth-Token: <API key>` (the retailer gets the key from GoFrugal when the API is enabled on their server).
 * No profile, no receipt, no purchase API in the published knowledge base — those steps are skipped with the reason.
 *
 * ⚠️ WRITTEN FROM GOFRUGAL'S PUBLISHED KNOWLEDGE BASE (2026-09-05), PROVEN AGAINST fake-gofrugal.js ONLY. The API is
 * enabled per retailer by GoFrugal (terms not public); the first live run may correct a field name in this one file.
 */
'use strict';
module.exports = function gofrugalAdapter(cfg) {
  const g = Object.assign({ url: 'http://localhost:8482', token: '', locationId: null }, cfg.gofrugal || {});
  const dry = !!cfg.dry, log = cfg.log || (() => {});
  const H = () => ({ 'X-Auth-Token': g.token, 'Content-Type': 'application/json', Accept: 'application/json' });
  async function call(method, p, body) {
    const r = await fetch(g.url.replace(/\/$/, '') + p, { method, headers: H(), body: body ? JSON.stringify(body) : undefined });
    const t = await r.text(); let j; try { j = JSON.parse(t); } catch (_) { j = { raw: t }; }
    if (!r.ok) throw new Error('GoFrugal ' + r.status + ' ' + t.slice(0, 120));
    return j;
  }
  const byCode = new Map();   /* our code (itemReferenceCode, else itemId) → itemId, from the last item read — the order needs GoFrugal's id */
  function flat(j) {
    const out = [];
    for (const it of (j.items || [])) {
      const s = (Array.isArray(it.stock) ? it.stock : [it.stock || {}]).filter((x) => x && (g.locationId == null || String(x.locationId || it.locationId || '') === String(g.locationId)));
      const first = s[0] || {};
      const code = String(first.itemReferenceCode || it.itemReferenceCode || it.itemId).trim();
      byCode.set(code.toLowerCase(), it.itemId);
      out.push({ itemId: it.itemId, name: it.itemName, code, price: Number(first.salePrice != null ? first.salePrice : first.mrp) || 0, mrp: Number(first.mrp) || null,
                 gst_rate: first.taxPercentage != null ? Number(first.taxPercentage) : null, qty: s.reduce((t, x) => t + (Number(x.stock) || 0), 0) });
    }
    return out;
  }
  return {
    name: 'gofrugal',
    async readProducts() {
      return flat(await call('GET', '/WebReporter/api/v1/items')).filter((p) => p.name).map((p) => ({ name: p.name, code: p.code, unit: 'nos', price: p.price, ...(p.mrp ? { list_price: p.mrp } : {}), ...(p.gst_rate != null ? { gst_rate: p.gst_rate } : {}), ref: String(p.itemId) }));
    },
    async readStock() {
      const at = new Date().toISOString();
      return flat(await call('GET', '/WebReporter/api/v1/items')).map((p) => ({ code: p.code, qty: p.qty, at }));
    },
    /** the order as a GoFrugal Sales Order — their billing turns it into the invoice; the CB reference rides onlineReferenceNo */
    async pushOrder(order) {
      if (!byCode.size) { try { flat(await call('GET', '/WebReporter/api/v1/items')); } catch (_) {} }
      const items = order.lines.map((l, i) => {
        const itemId = (l.code && byCode.get(String(l.code).toLowerCase())) || (l.item_id && byCode.get(String(l.item_id).toLowerCase())) || null;
        const listed = l.list_price != null ? l.list_price : l.price, gross = Math.round(listed * l.qty * 100) / 100, amount = l.total != null ? Math.round(Number(l.total) * 100) / 100 : gross;
        return { rowNo: i + 1, ...(itemId != null ? { itemId } : {}), itemName: l.name, salePrice: listed, quantity: l.qty, itemAmount: amount, taxPercentage: l.gst_rate != null ? l.gst_rate : 0, discountPercentage: gross > 0 && amount < gross ? Math.round((1 - amount / gross) * 10000) / 100 : 0 };
      });
      const missing = items.filter((x) => x.itemId == null).map((x) => x.itemName);
      if (missing.length) throw new Error('not in GoFrugal: ' + missing.join(', ') + ' (an order line must be one of their items)');
      const b = order.b2b ? order.b2b.buyer : null; const now = (order.at || new Date().toISOString()).replace('T', ' ').slice(0, 19);
      const body = { salesOrder: { onlineReferenceNo: 'CB-' + String(order.chit_id).slice(0, 8), onlineChildReferenceNo: String(order.chit_id), createdAt: now, updatedAt: now, status: 'pending',
        orderRemarks: 'ChitBridge order ' + order.chit_id + ' from ' + order.buyer + ((order.lines || []).some((l) => l.offer && l.offer.label) ? ' · offers: ' + [...new Set(order.lines.filter((l) => l.offer && l.offer.label).map((l) => l.offer.label))].join(', ') : ''),
        totalQuantity: items.reduce((t, x) => t + x.quantity, 0), totalAmount: Math.round((order.total || items.reduce((t, x) => t + x.itemAmount, 0)) * 100) / 100, paymentMode: 1,
        totalTaxAmount: order.b2b ? Math.round(((order.b2b.taxes.cgst || 0) + (order.b2b.taxes.sgst || 0) + (order.b2b.taxes.igst || 0)) * 100) / 100 : 0, totalDiscountAmount: Math.round(items.reduce((t, x) => t + (x.salePrice * x.quantity - x.itemAmount), 0) * 100) / 100,
        ...(g.locationId != null ? { locationId: g.locationId } : {}), customerName: b ? b.name : order.buyer, ...(b ? { customerAddressLine1: b.addr || '', customerCity: b.loc || '', customerPincode: b.pin || '', customerState: b.state_code || '' } : {}),
        orderItems: items } };
      if (dry) { log('[dry] GoFrugal sales order for ' + order.chit_id + ':\n' + JSON.stringify(body, null, 2)); return { ref: 'dry-run' }; }
      const j = await call('POST', '/WebReporter/api/v1/salesOrders', body);
      const r = j.result || {};
      if (String(r.status || '').toLowerCase() !== 'success') throw new Error('GoFrugal refused the sales order: ' + JSON.stringify(j).slice(0, 200));
      return { ref: String(r.id || 'created') };
    },
  };
};
