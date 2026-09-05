/**
 * lib/services.js — THE GOVERNED CAPABILITIES AS SERVICES: the shared plumbing behind /api/offers · /api/pricing ·
 * /api/tax · /api/invoice. Rung 2 of the ladder (Athi, 2026-09-05: "the doors become the product"): another system
 * keeps its screens and calls ours for the governed answer — the SAME engines the storefront, compose and the chit use.
 *
 * Every service is STATELESS by default: lines in, answers out. A caller may bring its own structures/offers/rates,
 * or omit them and get THIS entity's shelf (the catalogue's products by item_id or code, its live offers, its tax
 * slabs) — read once per request through the same readers the order path uses.
 *
 * Order of evaluation on a line, everywhere: pricing structure → offers → tax.
 */
'use strict';
const { query, withEntity } = require('../db');
const pricing = require('./pricing-engine').CBPricing;
const offersEng = require('./offers-engine').CBOffers;
const taxShelf = require('./tax-shelf');
const T = require('./tax-lines');
const tax = require('./tax');
const catalogueView = require('./catalogue-view');
const regional = require('./regional');

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const R2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** a line as the services read it: { key, item_id, code, name, qty, listPrice, pricing?, discount?, gst_rate?, cess_rate?, hsn?, categories } */
function normLines(body) {
  return (Array.isArray(body && body.lines) ? body.lines : []).map((l, i) => ({
    key: String(l.key != null ? l.key : i), item_id: l.item_id || null, code: l.code || l.sku || null, name: l.name || l.particulars || '',
    qty: num(l.qty != null ? l.qty : l.quantity) || 0,
    listPrice: num(l.listPrice != null ? l.listPrice : (l.unitPrice != null ? l.unitPrice : l.price)),
    pricing: (l.pricing && typeof l.pricing === 'object') ? l.pricing : null,
    discount: num(l.discount) || 0, gst_rate: num(l.gst_rate), cess_rate: num(l.cess_rate) || 0, hsn: l.hsn || null, unit: l.unit || '',
    categories: Array.isArray(l.categories) ? l.categories.map(String) : [], excluded: Array.isArray(l.excluded) ? l.excluded.map(String) : [] }));
}

/** this entity's shelf: products (by item_id / code), tax slabs, categories, face — one read */
async function shelfOf(entity_id) {
  const sh = await taxShelf.readShelf(entity_id, { withEntity, query, regionLayer: regional.regionLayer, getFace: (eid) => catalogueView.getFace({ entity_id: eid, withEntity }) }, { withItems: true });
  const items = (sh && sh.items) || [];
  const byId = new Map(), byCode = new Map(), idOfCode = new Map();
  for (const it of items) { const d = it.item_data || {}; byId.set(String(it.item_id), d); const c = String(d.code || d.sku || '').trim().toLowerCase(); if (c && !byCode.has(c)) { byCode.set(c, d); idOfCode.set(c, String(it.item_id)); } }
  const idOf = (l) => (l.item_id ? String(l.item_id) : (l.code && idOfCode.get(String(l.code).trim().toLowerCase())) || null);
  return { shelf: sh, items, byId, byCode, idOf, productOf: (l) => (l.item_id && byId.get(String(l.item_id))) || (l.code && byCode.get(String(l.code).trim().toLowerCase())) || null };
}

/** ── PRICING: the unit price at the quantity, from the line's own structure or the product's travelling copy ── */
function priceLine(l, product) {
  const d = l.pricing ? Object.assign({}, product || {}, { pricing_kind: l.pricing.kind || l.pricing.pricing_kind, pricing_tiers: l.pricing.tiers || l.pricing.pricing_tiers, pricing_amount: l.pricing.amount != null ? l.pricing.amount : l.pricing.pricing_amount, pricing_min: l.pricing.min != null ? l.pricing.min : l.pricing.pricing_min, pricing_max: l.pricing.max != null ? l.pricing.max : l.pricing.pricing_max, pricing_def_name: l.pricing.name || l.pricing.pricing_def_name || null }) : (product || {});
  const list = l.listPrice != null ? l.listPrice : num(product && product.price && typeof product.price === 'object' ? product.price.amount : (product && product.price));
  const u = pricing.unitPrice(d, l.qty || 1, list);
  return { key: l.key, item_id: l.item_id, code: l.code, name: l.name || (product && product.name) || '', qty: l.qty, list_price: list, unit_price: u.amount, structure: u.kind || null, structure_name: u.name || null, tier: u.tier, why: u.why, violation: u.violation, bands: u.kind === 'tiered' ? pricing.bands(d, list) : [] };
}

/** ── OFFERS: what comes off, and why ── */
async function offerLines(entity_id, priced, offers, ctx) {
  const list = Array.isArray(offers) && offers.length ? offers : (entity_id ? await catalogueView.liveOffers({ entity_id, withEntity }) : []);
  const lines = priced.map((p, i) => ({ key: p.key, item_id: p.item_id, sku: p.code, categories: p.categories || [], excluded: p.excluded || [], qty: p.qty, unitPrice: p.unit_price }));
  const c = Object.assign({ now: new Date(), currency: 'INR' }, ctx || {});
  if (typeof c.money !== 'function') c.money = (n) => String(c.currency || 'INR') + ' ' + R2(n).toFixed(2);
  if (!list.length || !offersEng) return { ev: { subtotal: lines.reduce((t, l) => t + l.unitPrice * l.qty, 0), total: lines.reduce((t, l) => t + l.unitPrice * l.qty, 0), adjustments: [], notes: [], skipped: [] }, per: {}, offers_considered: 0 };
  const ev = offersEng.evaluate({ lines, offers: list, ctx: c });
  return { ev, per: offersEng.perLine ? (offersEng.perLine(ev, lines) || {}) : {}, offers_considered: list.length };
}

/** ── TAX: the rate each line resolves to (from the caller, else the entity's shelf), then the INV-01 block ── */
/* the caller may name a line by CODE; the tax decorator matches by item_id or name, so the shelf answers the id first */
function rateLines(lines, sh) {
  const shelf = sh && sh.shelf ? sh.shelf : sh;
  const asLines = lines.map((l) => { const prod = sh && sh.productOf ? sh.productOf(l) : null; return { item_id: l.item_id || (sh && sh.idOf ? sh.idOf(l) : null), name: l.name || (prod && prod.name) || '', particulars: l.name || (prod && prod.name) || '', gst_rate: l.gst_rate, cess_rate: l.cess_rate, hsn: l.hsn }; });
  const dec = shelf ? T.decorate(asLines, shelf) : asLines;
  return lines.map((l, i) => Object.assign({}, l, { name: l.name || asLines[i].name, item_id: l.item_id || asLines[i].item_id, gst_rate: dec[i].gst_rate != null ? num(dec[i].gst_rate) : l.gst_rate, cess_rate: num(dec[i].cess_rate) || l.cess_rate || 0, hsn: dec[i].hsn || l.hsn || null, tax_slab_name: dec[i].tax_slab_name || null, tax_source: dec[i].tax_source || (l.gst_rate != null ? 'caller' : null), tax_scheme: dec[i].tax_scheme || l.tax_scheme || null }));
}
async function partyOfEntity(entity_id, extra) {
  const r = await query('SELECT identity_id, gstn, display_name, policy_flags, country FROM identities WHERE identity_id = $1', [entity_id]);
  return T.partyOf(r.rows[0] || {}, Object.assign({ entity_id: String(entity_id) }, extra || {}));
}
function party(p, fallback) {
  if (!p || typeof p !== 'object') return fallback || {};
  const g = p.Gstin || p.gstin || null;
  return Object.assign({}, fallback || {}, { Gstin: g, LglNm: p.LglNm || p.name || (fallback && fallback.LglNm) || null, State: p.State || p.state || T.stateOfGstin(g) || (fallback && fallback.State) || null,
    Pos: p.Pos || p.pos || undefined, Country: (p.Country || p.country || (fallback && fallback.Country) || null), RegType: p.RegType || p.reg_type || (fallback && fallback.RegType) || 'regular' });
}
function computeTax({ seller, buyer, lines, priceIncludesTax, reverseCharge, scheme }) {
  return tax.determine({ seller: seller || {}, buyer: buyer || {}, scheme,
    lines: lines.map((l) => ({ id: l.key, name: l.name, qty: l.qty, unit_price: l.unit_price != null ? l.unit_price : l.listPrice, unit: l.unit || '', discount: l.discount || 0, rate: l.gst_rate != null ? l.gst_rate : 0, cess_rate: l.cess_rate || 0, hsn: l.hsn || '', tax_scheme: l.tax_scheme || undefined })),
    priceIncludesTax: !!priceIncludesTax, reverseCharge: !!reverseCharge });
}

module.exports = { normLines, shelfOf, priceLine, offerLines, rateLines, partyOfEntity, party, computeTax, R2, num };
