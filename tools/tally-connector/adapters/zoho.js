/**
 * ADAPTER: Zoho Books (REST) — the shape a hosted system attaches through: fetch() instead of a local port.
 *   readProducts(): GET /books/v3/items?organization_id=…            → { items:[{ item_id, name, sku, unit, rate, hsn_or_sac, status }] }
 *   pushOrder():    POST /books/v3/invoices?organization_id=…       { customer_name?, reference_number, line_items:[{ name, quantity, rate, discount }] }
 *   pushReceipt():  POST /books/v3/customerpayments               { customer_id, payment_mode, amount, reference_number, invoices:[{ invoice_id, amount_applied }] } (2026-09-05)
 *   ensure():       the one Walk-in contact (every invoice needs a customer_id) · ensureParty(buyer): a customer with gst_no + place_of_contact, once
 *   B2B invoices carry customer_id · gst_treatment business_gst · gst_no · place_of_supply (two-letter state) · the org GST tax group per line
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
  /* GST state code (first two digits of a GSTIN) → the two-letter code Zoho's place_of_supply / place_of_contact take */
  const STATE_ABBR = { '01': 'JK', '02': 'HP', '03': 'PB', '04': 'CH', '05': 'UK', '06': 'HR', '07': 'DL', '08': 'RJ', '09': 'UP', '10': 'BR', '11': 'SK', '12': 'AR', '13': 'NL', '14': 'MN', '15': 'MZ', '16': 'TR', '17': 'ML', '18': 'AS', '19': 'WB', '20': 'JH', '21': 'OD', '22': 'CG', '23': 'MP', '24': 'GJ', '26': 'DN', '27': 'MH', '29': 'KA', '30': 'GA', '31': 'LD', '32': 'KL', '33': 'TN', '34': 'PY', '35': 'AN', '36': 'TS', '37': 'AP', '38': 'LA' };
  const abbr = (code) => STATE_ABBR[String(code || '').padStart(2, '0')] || null;
  let _taxes = null, _walkin = null;
  /** the org's GST tax groups (GST5 · GST12 …), read once — a line names its tax by id, Zoho splits CGST/SGST vs IGST from the place of supply */
  async function taxIdFor(rate) {
    if (rate == null || !(Number(rate) >= 0)) return null;
    if (!_taxes) { try { _taxes = ((await call('GET', '/books/v3/settings/taxes')).taxes || []); } catch (_) { _taxes = []; } }
    const want = Number(rate);
    const hit = _taxes.find((t) => Number(t.tax_percentage) === want && /group|tax/.test(String(t.tax_type || 'tax'))) || _taxes.find((t) => Number(t.tax_percentage) === want);
    return hit ? hit.tax_id : null;
  }
  async function findContact(name) {
    try { const j = await call('GET', '/books/v3/contacts?search_text=' + encodeURIComponent(name)); return (j.contacts || []).find((c) => String(c.contact_name).toLowerCase() === String(name).toLowerCase()) || null; } catch (_) { return null; }
  }
  return {
    name: 'zoho',
    /** the one contact every walk-in order books under (Zoho needs a customer_id on every invoice) */
    async ensure() {
      const name = z.customer_name || 'Walk-in';
      let c = await findContact(name);
      if (!c) { if (dry) { log('[dry] would create contact ' + name); return { existing: [], created: [], would_create: [name] }; } const j = await call('POST', '/books/v3/contacts', { contact_name: name, contact_type: 'customer', gst_treatment: 'consumer' }); c = j.contact || {}; _walkin = c.contact_id || null; return { existing: [], created: [name] }; }
      _walkin = c.contact_id || null; return { existing: [name], created: [] };
    },
    /** a registered buyer → a customer contact with their GSTIN and place of contact, once (B2B, 2026-09-05) */
    async ensureParty(buyer) {
      const name = String(buyer.name || buyer.gstin || 'Customer').trim().slice(0, 200);
      const have = await findContact(name);
      if (have) return { name, created: null, customer_id: have.contact_id };
      const body = { contact_name: name, company_name: name, contact_type: 'customer', gst_treatment: 'business_gst', gst_no: buyer.gstin, place_of_contact: abbr(buyer.state_code) || undefined,
        billing_address: (buyer.addr || buyer.loc || buyer.pin) ? { address: buyer.addr || '', city: buyer.loc || '', zip: buyer.pin || '', state: abbr(buyer.state_code) || '', country: 'India' } : undefined };
      if (dry) { log('[dry] Zoho contact:\n' + JSON.stringify(body, null, 2)); return { name, created: null, would_create: name }; }
      const j = await call('POST', '/books/v3/contacts', body); const c = j.contact || {};
      return { name, created: name, customer_id: c.contact_id || null };
    },
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
      /* B2B: the buyer's own contact (GSTIN, place of contact) and the place of supply from the chit's invoice; a walk-in
         books under the one Walk-in contact. The tax per line is the org's GST group for that rate — Zoho splits it. */
      const b2b = order.b2b || null;
      let customer_id = null;
      if (b2b) { const p = await this.ensureParty(b2b.buyer); customer_id = p.customer_id || null; }
      if (!customer_id) { if (!_walkin) await this.ensure(); customer_id = _walkin; }
      const lines = [];
      for (const l of order.lines) {
        const listed = l.list_price != null ? l.list_price : l.price, gross = Math.round(listed * l.qty * 100) / 100;
        const amount = l.total != null ? Math.round(Number(l.total) * 100) / 100 : gross;
        const disc = gross > 0 && amount < gross ? (Math.round((1 - amount / gross) * 10000) / 100) + '%' : undefined;   /* an offer = a discount on the line, the amount stays the chit's */
        const rate = l.gst_rate != null ? l.gst_rate : (b2b && (b2b.items.find((x) => x.name === l.name) || {}).rate);
        const tax_id = b2b ? await taxIdFor(rate) : null;
        lines.push({ name: l.name, description: l.code ? 'code ' + l.code : undefined, quantity: l.qty, rate: listed, unit: l.unit || undefined, discount: disc, ...(l.hsn ? { hsn_or_sac: l.hsn } : {}), ...(tax_id ? { tax_id } : {}) });
      }
      const body = { customer_id: customer_id || undefined, ...(customer_id ? {} : { customer_name: z.customer_name || order.buyer }), reference_number: 'CB-' + String(order.chit_id).slice(0, 8), date: (order.at || new Date().toISOString()).slice(0, 10),
        notes: 'ChitBridge order ' + order.chit_id + ' from ' + order.buyer + ((order.lines || []).some((l) => l.offer && l.offer.label) ? ' · offers: ' + [...new Set(order.lines.filter((l) => l.offer && l.offer.label).map((l) => l.offer.label))].join(', ') : ''),
        ...(b2b ? { gst_treatment: 'business_gst', gst_no: b2b.buyer.gstin, place_of_supply: abbr(b2b.place_of_supply) || undefined } : { gst_treatment: 'consumer' }),
        line_items: lines };
      if (dry) { log('[dry] Zoho invoice for ' + order.chit_id + ':\n' + JSON.stringify(body, null, 2)); return { ref: 'dry-run' }; }
      const j = await call('POST', '/books/v3/invoices', body);
      const inv = j.invoice || {}; return { ref: inv.invoice_number || inv.invoice_id || 'created', their_id: inv.invoice_id || null, their_party: inv.customer_id || null };
    },
    /* ══ THE BUYER'S SIDE: the seller as a vendor, the purchase as a Bill (Zoho's purchase invoice) with the ITC on the lines ══ */
    async ensureSupplier(seller) {
      const name = String(seller.name || seller.gstin || 'Supplier').trim().slice(0, 200);
      const have = await findContact(name);
      if (have) return { name, created: null, vendor_id: have.contact_id };
      const body = { contact_name: name, company_name: name, contact_type: 'vendor', gst_treatment: seller.gstin ? 'business_gst' : 'business_none', gst_no: seller.gstin || undefined, place_of_contact: abbr(seller.state_code) || undefined,
        billing_address: (seller.addr || seller.loc || seller.pin) ? { address: seller.addr || '', city: seller.loc || '', zip: seller.pin || '', state: abbr(seller.state_code) || '', country: 'India' } : undefined };
      if (dry) { log('[dry] Zoho vendor:\n' + JSON.stringify(body, null, 2)); return { name, created: null, would_create: name }; }
      const j = await call('POST', '/books/v3/contacts', body); const c = j.contact || {};
      return { name, created: name, vendor_id: c.contact_id || null };
    },
    /** POST /books/v3/bills — the seller's invoice in my books; the line tax group is my ITC, Zoho splits it from source/destination of supply */
    async pushPurchase(p) {
      const s = await this.ensureSupplier(p.seller); const vendor_id = s.vendor_id || null;
      if (!vendor_id && !dry) throw new Error('no vendor contact for ' + p.seller.name);
      const lines = [];
      for (const it of p.items) lines.push({ name: it.name, quantity: it.qty, rate: it.rate, unit: it.unit || undefined, ...(it.hsn ? { hsn_or_sac: it.hsn } : {}), ...(it.rate > 0 && it.ass < Math.round(it.rate * it.qty * 100) / 100 ? { discount: (Math.round((1 - it.ass / (it.rate * it.qty)) * 10000) / 100) + '%' } : {}), ...(await taxIdFor(it.gst_rate) ? { tax_id: await taxIdFor(it.gst_rate) } : {}) });
      const inputTax = Math.round(((p.taxes.cgst || 0) + (p.taxes.sgst || 0) + (p.taxes.igst || 0) + (p.taxes.cess || 0)) * 100) / 100;
      const body = { vendor_id: vendor_id || undefined, bill_number: p.ref, date: (p.at || new Date().toISOString()).slice(0, 10), reference_number: p.ref,
        gst_treatment: p.seller.gstin ? 'business_gst' : 'business_none', gst_no: p.seller.gstin || undefined, source_of_supply: abbr(p.seller.state_code) || undefined, destination_of_supply: abbr(p.buyer_state) || undefined,
        notes: 'ChitBridge purchase ' + p.chit_id + ' from ' + p.seller.name + ' · seller invoice ' + p.ref + ' · ITC ' + inputTax, line_items: lines };
      if (dry) { log('[dry] Zoho bill for ' + p.chit_id + ':\n' + JSON.stringify(body, null, 2)); return { ref: 'dry-run', input_tax: inputTax }; }
      const j = await call('POST', '/books/v3/bills', body); const b = j.bill || {};
      return { ref: b.bill_number || b.bill_id || 'created', their_id: b.bill_id || null, input_tax: inputTax };
    },
    /** a payment recorded in ChitBridge → a Customer Payment applied to that order's invoice (needs the invoice the order push created) */
    async pushReceipt(p) {
      const o = p.order || {};
      if (!o.their_id) return { ref: null, skipped: 'no Zoho invoice on record for this order (the order push did not create one)' };
      if (!(Number(p.amount) > 0)) return { ref: null, skipped: 'no amount on the payment' };
      const MODE = { cash: 'cash', card: 'creditcard', bank: 'banktransfer', upi: 'others', other: 'others' };
      const body = { customer_id: o.their_party || undefined, payment_mode: MODE[p.method] || 'others', amount: Math.round(Number(p.amount) * 100) / 100, date: (p.at || new Date().toISOString()).slice(0, 10),
        reference_number: p.ref || ('CB-' + String(p.chit_id).slice(0, 8)), description: 'ChitBridge payment ' + String(p.method || '').toUpperCase() + ' for order ' + p.chit_id,
        invoices: [{ invoice_id: o.their_id, amount_applied: Math.round(Number(p.amount) * 100) / 100 }] };
      if (dry) { log('[dry] Zoho customer payment for ' + p.chit_id + ':\n' + JSON.stringify(body, null, 2)); return { ref: 'dry-run' }; }
      const j = await call('POST', '/books/v3/customerpayments', body);
      const pay = j.payment || {}; return { ref: pay.payment_number || pay.payment_id || 'created' };
    },
  };
};
