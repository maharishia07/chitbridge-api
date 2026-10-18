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
 *
 * OWNS      the shared plumbing of the governed services (the caller's lines or this shop's shelf, the shop's party and price-includes-tax).
 * CALLED BY routes/tax.js · routes/pricing.js · routes/invoice.js · lib/home-facts.js
 * FLOW      lines in → shelf (items, offers, slabs) read once → pricing → offers → tax → the answer
 * CARD      15-tax-and-country-packs/tax-compute-rate-invoice-tax
 */
'use strict';
const { query, withEntity } = require('../db');
const { round: roundMoney, priceOf } = require('./money');   /* ⭐ money.round — the one rounder (SPEC-money-one-reader.md): half away from zero, on the decimal value */
const pricing = require('./pricing-engine').CBPricing;
const offersEng = require('./offers-engine').CBOffers;
const taxShelf = require('./tax-shelf');
const T = require('./tax-lines');
const tax = require('./tax');
const catalogueView = require('./catalogue-view');
const regional = require('./regional');

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const R2 = (n) => roundMoney(Number(n) || 0);

/** a line as the services read it: { key, item_id, code, name, qty, listPrice, pricing?, discount?, gst_rate?, cess_rate?, hsn?, categories } */
function normLines(body) {
  return (Array.isArray(body && body.lines) ? body.lines : []).map((item, index) => ({
    key: String(item.key != null ? item.key : index), item_id: item.item_id || null, code: item.code || item.sku || null, name: item.name || item.particulars || '',
    qty: num(item.qty != null ? item.qty : item.quantity) || 0,
    listPrice: num(item.listPrice != null ? item.listPrice : (item.unitPrice != null ? item.unitPrice : item.price)),
    pricing: (item.pricing && typeof item.pricing === 'object') ? item.pricing : null,
    discount: num(item.discount) || 0, gst_rate: num(item.gst_rate), cess_rate: num(item.cess_rate) || 0, hsn: item.hsn || null, unit: item.unit || '',
    categories: Array.isArray(item.categories) ? item.categories.map(String) : [], excluded: Array.isArray(item.excluded) ? item.excluded.map(String) : [] }));
}

/** this entity's shelf: products (by item_id / code), tax slabs, categories, face — one read */
async function shelfOf(entity_id) {
  const sh = await taxShelf.readShelf(entity_id, { withEntity, query, regionLayer: regional.regionLayer, getFace: (eid) => catalogueView.getFace({ entity_id: eid, withEntity }) }, { withItems: true });
  const items = (sh && sh.items) || [];
  /* TAX-SRV1 G3: no shelf (a GST shop with no GSTIN — tax-shelf answers null: "no GSTIN, no GST") still has PRODUCTS to price.
     The items are read on their own; `shelf` stays null, so rateLines resolves no rate for it (the counter zero-rates it too). */
  if (!sh) {
    const r = await withEntity(entity_id, (db) => db.query('SELECT item_id, item_data FROM catalogue_items WHERE entity_id = $1 AND is_active = true', [entity_id]));
    items.push(...((r && r.rows) || []));
  }
  const byId = new Map(), byCode = new Map(), idOfCode = new Map();
  for (const it of items) { const d = it.item_data || {}; byId.set(String(it.item_id), d); const c = String(d.code || d.sku || '').trim().toLowerCase(); if (c && !byCode.has(c)) { byCode.set(c, d); idOfCode.set(c, String(it.item_id)); } }
  const idOf = (l) => (l.item_id ? String(l.item_id) : (l.code && idOfCode.get(String(l.code).trim().toLowerCase())) || null);
  return { shelf: sh, items, byId, byCode, idOf, productOf: (l) => (l.item_id && byId.get(String(l.item_id))) || (l.code && byCode.get(String(l.code).trim().toLowerCase())) || null };
}

/** ── PRICING: the unit price at the quantity, from the line's own structure or the product's travelling copy ── */
function priceLine(l, product) {
  const d = l.pricing ? Object.assign({}, product || {}, { pricing_kind: l.pricing.kind || l.pricing.pricing_kind, pricing_tiers: l.pricing.tiers || l.pricing.pricing_tiers, pricing_amount: l.pricing.amount != null ? l.pricing.amount : l.pricing.pricing_amount, pricing_min: l.pricing.min != null ? l.pricing.min : l.pricing.pricing_min, pricing_max: l.pricing.max != null ? l.pricing.max : l.pricing.pricing_max, pricing_def_name: l.pricing.name || l.pricing.pricing_def_name || null }) : (product || {});
  /* ⭐ THE ONE PRICE READER — a product with no price is null here, never 0 (SPEC-money-one-reader.md, D3) */
  const list = l.listPrice != null ? l.listPrice : priceOf(product && product.price);
  /* ⚠️ undefined, never null, for "no price": the engine's num(null) is Number(null) = 0, which priced an unpriced product at 0 (TAX-SRV1; the
     engines fix — pricing.unitPrice reading null as absent — is queued, engines are serial). undefined → its own priceOf_ → null. */
  const u = pricing.unitPrice(d, l.qty || 1, list == null ? undefined : list);
  return { key: l.key, item_id: l.item_id, code: l.code, name: l.name || (product && product.name) || '', qty: l.qty, list_price: list, unit_price: u.amount, structure: u.kind || null, structure_name: u.name || null, tier: u.tier, why: u.why, violation: u.violation, bands: u.kind === 'tiered' ? pricing.bands(d, list) : [] };
}

/** ── OFFERS: what comes off, and why ── */
async function offerLines(entity_id, priced, offers, ctx) {
  const list = Array.isArray(offers) && offers.length ? offers : (entity_id ? await catalogueView.liveOffers({ entity_id, withEntity }) : []);
  const lines = priced.map((item, index) => ({ key: item.key, item_id: item.item_id, sku: item.code, categories: item.categories || [], excluded: item.excluded || [], qty: item.qty, unitPrice: item.unit_price }));
  const c = Object.assign({ now: new Date(), currency: null }, ctx || {});   /* T2-NATDEF: the caller's stated money, never INR by name */
  if (typeof c.money !== 'function') c.money = (n) => (c.currency ? String(c.currency) + ' ' : '') + R2(n).toFixed(2);
  if (!list.length || !offersEng) return { ev: { subtotal: lines.reduce((total, item) => total + item.unitPrice * item.qty, 0), total: lines.reduce((total, item) => total + item.unitPrice * item.qty, 0), adjustments: [], notes: [], skipped: [] }, per: {}, offers_considered: 0 };
  const ev = offersEng.evaluate({ lines, offers: list, ctx: c });
  return { ev, per: offersEng.perLine ? (offersEng.perLine(ev, lines) || {}) : {}, offers_considered: list.length };
}

/** ── TAX: the rate each line resolves to (from the caller, else the entity's shelf), then the INV-01 block ── */
/* the caller may name a line by CODE; the tax decorator matches by item_id or name, so the shelf answers the id first */
function rateLines(lines, sh) {
  const shelf = sh && 'shelf' in sh ? sh.shelf : sh;   /* a shelfOf() answer with shelf null = no tax shelf; its items price, they never rate */
  const asLines = lines.map((item) => { const prod = sh && sh.productOf ? sh.productOf(item) : null; return { item_id: item.item_id || (sh && sh.idOf ? sh.idOf(item) : null), name: item.name || (prod && prod.name) || '', particulars: item.name || (prod && prod.name) || '', gst_rate: item.gst_rate, cess_rate: item.cess_rate, hsn: item.hsn }; });
  const dec = shelf ? T.decorate(asLines, shelf) : asLines;
  return lines.map((item, index) => Object.assign({}, item, { name: item.name || asLines[index].name, item_id: item.item_id || asLines[index].item_id, gst_rate: dec[index].gst_rate != null ? num(dec[index].gst_rate) : item.gst_rate, cess_rate: num(dec[index].cess_rate) || item.cess_rate || 0, hsn: dec[index].hsn || item.hsn || null, tax_slab_name: dec[index].tax_slab_name || null, tax_source: dec[index].tax_source || (item.gst_rate != null ? 'caller' : null), tax_scheme: dec[index].tax_scheme || item.tax_scheme || null }));
}
/**
 * shopOf(entity_id) → { party, priceIncludesTax } — the seller as the invoice reads it AND whether its prices include tax, from the ONE
 * identities read partyOfEntity always made (policy_flags was selected and dropped). TAX-SRV1 G2: a caller that leaves the flag out gets
 * the SHOP's setting — policy.flagOf, the same read the counter (till.html taxIncluded) and every chit (tax-copy partiesFor) use.
 */
async function shopOf(entity_id, extra) {
  const r = await query('SELECT identity_id, gstn, display_name, policy_flags, country FROM identities WHERE identity_id = $1', [entity_id]);
  const row = r.rows[0] || {};
  return { party: T.partyOf(row, Object.assign({ entity_id: String(entity_id) }, extra || {})),
           priceIncludesTax: require('./policy').flagOf(row.policy_flags, 'price_includes_tax', row.country) === 'yes' };
}
async function partyOfEntity(entity_id, extra) { return (await shopOf(entity_id, extra)).party; }
/** the caller's own `priceIncludesTax` (or `price_includes_tax`) when it said one — true/false/'yes'/'no' — else undefined; anything else is null (refused) */
function saidInclusive(body) {
  const b = body || {}, v = b.priceIncludesTax !== undefined ? b.priceIncludesTax : b.price_includes_tax;
  if (v === undefined || v === null) return undefined;
  if (v === true || v === 'yes' || v === 'true') return true;
  if (v === false || v === 'no' || v === 'false') return false;
  return null;
}
function party(p, fallback) {
  if (!p || typeof p !== 'object') return fallback || {};
  const g = p.Gstin || p.gstin || null;
  return Object.assign({}, fallback || {}, { Gstin: g, LglNm: p.LglNm || p.name || (fallback && fallback.LglNm) || null, State: p.State || p.state || T.stateOfGstin(g) || (fallback && fallback.State) || null,
    Pos: p.Pos || p.pos || undefined, Country: (p.Country || p.country || (fallback && fallback.Country) || null), RegType: p.RegType || p.reg_type || (fallback && fallback.RegType) || 'regular' });
}
function computeTax({ seller, buyer, lines, priceIncludesTax, reverseCharge, scheme }) {
  const w = T.walkIn(seller, buyer);   /* ⭐ BUY1: a buyer with no country / no place of supply is taxed inside the shop — the one rule, tax-lines.walkIn */
  const det = tax.determine({ seller: seller || {}, buyer: w.buyer, scheme,
    lines: lines.map((item) => ({ id: item.key, name: item.name, qty: item.qty, unit_price: item.unit_price != null ? item.unit_price : item.listPrice, unit: item.unit || '', discount: item.discount || 0, rate: item.gst_rate != null ? item.gst_rate : 0, cess_rate: item.cess_rate || 0, hsn: item.hsn || '', tax_scheme: item.tax_scheme || undefined })),
    priceIncludesTax: !!priceIncludesTax, reverseCharge: !!reverseCharge });
  if (w.note && det._cb) det._cb.notes = (Array.isArray(det._cb.notes) ? det._cb.notes : []).concat(w.note);
  return det;
}

module.exports = { normLines, shelfOf, priceLine, offerLines, rateLines, shopOf, saidInclusive, partyOfEntity, party, computeTax, R2, num };
