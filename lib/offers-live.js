/**
 * offers-live.js — THE SELLER'S LIVE OFFERS, APPLIED TO A SET OF LINES — the one function every path calls.
 *
 * Athi, 2026-09-05: "how does it become a chit when it comes through WhatsApp? check there also — either the offer and tax
 * etc applied correctly." The storefront order path applied the live offers (routes/catalogue.js applyLiveOffers); the send
 * path (/chits/send — Compose, Record a sale, the WhatsApp capture) decorated the TAX and never the offers. This module is
 * that function, moved out of the route so the send path can call the same one: the seller's live offers (catalogue-view
 * liveOffers), the same engine (lib/offers-engine, vendored from app/offers.js), the same per-line result the storefront
 * gets — `offer { label, off }` on the line, `total` lowered, `price` kept (a chit is evidence).
 *
 *   applyLiveOffers(entity, items, total, { withEntity }) → { items, total, applied }
 *     entity: the SELLER's identities row ({ identity_id, currency_code }); items: chit lines ({ item_id, sku, d?, price,
 *     quantity, total, kind }); lines that already carry `offer` or `discount` are left alone (a client that applied its own).
 */
'use strict';
const money = require('./money');
async function applyLiveOffers(entity, items, total, deps) {
  try {
    const withEntity = (deps && deps.withEntity) || require('../db').withEntity;
    const catalogueView = require('./catalogue-view');
    const eng = require('./offers-engine').CBOffers;
    if (!entity || !entity.identity_id) return { items, total, applied: [] };
    const offers = await catalogueView.liveOffers({ entity_id: entity.identity_id, withEntity });
    if (!offers.length || !eng || !eng.evaluate || !eng.perLine) return { items, total, applied: [] };
    const lines = [];
    items.forEach((it, i) => {
      if (!it || it.kind === 'payload' || !Number.isFinite(Number(it.price)) || !(Number(it.quantity) > 0)) return;
      if (it.offer || (it.discount != null && Number(it.discount) > 0)) return;   /* already carries one — never twice */
      const d = it.d || it.item_data || {};
      lines.push({ key: String(i), item_id: it.item_id || (it.ref && it.ref.item_id) || null, sku: it.sku || (d.sku || d.code) || (it.ref && it.ref.code) || null, excluded: Array.isArray(d.offers_excluded) ? d.offers_excluded.map(String) : [],
        categories: Array.isArray(d.categories) ? d.categories.map(String) : [], qty: Number(it.quantity), unitPrice: Number(it.price) });
    });
    if (!lines.length) return { items, total, applied: [] };
    const ev = eng.evaluate({ lines, offers, ctx: { now: new Date(), currency: entity.currency_code || 'INR' } });
    const per = eng.perLine(ev, lines) || {};
    let newTotal = 0; const applied = [];
    items.forEach((it, i) => {
      const p = per[String(i)];
      if (p && p.off > 0) {
        const base = Number.isFinite(Number(it.total)) ? Number(it.total) : Number(it.price) * Number(it.quantity);
        it.offer = { offer_id: p.offer_id || null, label: p.label || 'offer', off: money.round2(p.off) };
        it.discount = money.round2(p.off);
        it.total = money.round2(base - p.off);
        applied.push({ scope: 'line', label: it.offer.label, amount: it.offer.off, item_id: it.item_id || null });
      }
      if (Number.isFinite(Number(it.total))) newTotal += Number(it.total);
    });
    (ev.adjustments || []).forEach((a) => {
      if (a.scope === 'line' || a.scope === 'note') return;
      const amt = money.round2(Math.abs(Number(a.amount) || 0)); if (!amt) return;
      applied.push({ scope: a.scope || 'cart', label: a.label || a.kind, amount: amt, offer_id: a.offer_id || null });
      newTotal -= amt;
    });
    return { items, total: money.round2(Math.max(0, newTotal)), applied };
  } catch (_) { return { items, total, applied: [] }; }
}
module.exports = { applyLiveOffers };
