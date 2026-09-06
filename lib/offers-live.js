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
 *   applyLiveOffers(entity, items, total, { withEntity, viewer }) → { items, total, applied }   (viewer = the BUYER's identity_id, for customer-only offers)
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
    /* the buyer's standing with the seller (deps.viewer = their identity_id) — read beside the offers, one batch; a counter sale or a capture has no viewer */
    const cg = require('./customer-groups');
    const [offers, groups] = await Promise.all([
      catalogueView.liveOffers({ entity_id: entity.identity_id, withEntity, all: true }).then((all) => all),
      cg.groupsOf({ seller_id: entity.identity_id, viewer_id: (deps && deps.viewer) || null, withEntity })
    ]).then(([all, gs]) => [cg.offersFor(all, gs), gs]);
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
    const ev = eng.evaluate({ lines, offers, ctx: { now: new Date(), currency: entity.currency_code || 'INR', customer_groups: groups } });
    const per = eng.perLine(ev, lines) || {};
    let newTotal = 0; const applied = [];
    items.forEach((it, i) => {
      const p = per[String(i)];
      if (p && p.off > 0) {
        const base = Number.isFinite(Number(it.total)) ? Number(it.total) : Number(it.price) * Number(it.quantity);
        /* the PROMISE text the cart's badge printed ("10% off") rides the line beside the offer's name ("Flat 10%") — the order page says the same words as the cart ([PAR-03]) */
        var promise = null; try { var src = offers.find(function (o) { return String(o.id) === String(p.offer_id); }); promise = (src && eng.promise) ? eng.promise(src, { now: new Date(), currency: entity.currency_code || 'INR', customer_groups: groups, money: function (n) { return String(n); } }) : null; } catch (_) { promise = null; }
        /* ⭐ ALL THE OFFERS ON THE LINE (2026-09-06, a customer-only 10% on top of a Flat 10%): perLine SUMS the amounts but keeps the LAST
           label, so the order page said "Tier1 10% −₹40" where the cart said two rows. `parts` carries each offer with its own amount and
           promise; label/promise join them for a single-badge reader. */
        var parts = (ev.adjustments || []).filter(function (a) { return a.scope === 'line' && String(a.target) === String(i) && Math.abs(Number(a.amount) || 0) > 0; })
          .map(function (a) { var src = offers.find(function (o) { return String(o.id) === String(a.offer_id); }); var pr = null; try { pr = (src && eng.promise) ? eng.promise(src, { now: new Date(), currency: entity.currency_code || 'INR', customer_groups: groups, money: function (n) { return String(n); } }) : null; } catch (_) {}
            return { offer_id: a.offer_id || null, label: a.label || (src && src.label) || 'offer', off: money.round2(Math.abs(Number(a.amount) || 0)), promise: pr || undefined, scope: 'line' }; });
        if (parts.length > 1) { it.offer = { offer_id: parts[0].offer_id, label: parts.map(function (x) { return x.label; }).join(' + '), off: money.round2(p.off), promise: parts.map(function (x) { return x.promise || x.label; }).join(' + '), parts: parts }; }
        else it.offer = { offer_id: p.offer_id || null, label: p.label || 'offer', off: money.round2(p.off), promise: promise || undefined };
        it.discount = money.round2(p.off);
        it.total = money.round2(base - p.off);
        applied.push({ scope: 'line', label: it.offer.label, amount: it.offer.off, item_id: it.item_id || null });
      }
      if (Number.isFinite(Number(it.total))) newTotal += Number(it.total);
    });
    /* ⭐ CART-SCOPE OFFERS LAND ON THE LINES (Athi, 2026-09-06: "the discount showcased in the cart, but not applied when the order placed").
       A "10% off the basket" used to lower only the returned total — the chit's lines never carried it, so the order page, the invoice and
       the Tally voucher all said the pre-offer money. Now each cart-scope adjustment is prorated across the priced lines by their net (the
       rule the live cart already uses for tax), recorded on each line as a part with scope 'cart' (`offer.line_off` keeps the line-only
       share for the row's price), and listed once in `applied` — the summary keeps that as the record. */
    /* ⭐ THE ENGINE ALLOCATED THE BASKET OFFERS (decision 1, 2026-09-06: industry standard — percent on percent; a basket offer on the subtotal
       after line offers, split by running net). `ev.cart_shares[key]` is each line's share per basket offer; `ev.line_net[key]` its worth after
       everything. The line records every part; `line_off` keeps the row's own share (decision 3: the row shows line offers only). */
    const cartAdj = (ev.adjustments || []).filter((a) => a.scope !== 'line' && a.scope !== 'note' && Math.abs(Number(a.amount) || 0) > 0);
    if (cartAdj.length) {
      items.forEach((it, i) => {
        const shares = (ev.cart_shares && ev.cart_shares[String(i)]) || []; if (!shares.length) return;
        const cur = it.offer || null;
        const parts = cur && Array.isArray(cur.parts) ? cur.parts.slice() : (cur ? [{ offer_id: cur.offer_id || null, label: cur.label, off: Number(cur.off) || 0, promise: cur.promise, scope: 'line' }] : []);
        shares.forEach((sh) => { var src = offers.find(function (o) { return String(o.id) === String(sh.offer_id); }); var pr = null; try { pr = (src && eng.promise) ? eng.promise(src, { now: new Date(), currency: entity.currency_code || 'INR', customer_groups: groups, money: function (n) { return String(n); } }) : null; } catch (_) {}
          parts.push({ offer_id: sh.offer_id || null, label: sh.label || 'offer', off: money.round2(Math.abs(Number(sh.amount) || 0)), scope: 'cart', promise: pr || undefined }); });
        const total = money.round2(parts.reduce((t, p) => t + (Number(p.off) || 0), 0)), lineOff = money.round2(parts.filter((p) => p.scope !== 'cart').reduce((t, p) => t + (Number(p.off) || 0), 0));
        it.offer = { offer_id: parts[0].offer_id, label: parts.map((p) => p.label).join(' + '), off: total, line_off: lineOff, promise: parts.map((p) => p.promise || p.label).join(' + '), parts };
        it.discount = total; it.total = money.round2(Number(it.price) * Number(it.quantity) - total);
      });
      cartAdj.forEach((a) => applied.push({ scope: a.scope || 'cart', label: a.label || a.kind, amount: money.round2(Math.abs(Number(a.amount) || 0)), offer_id: a.offer_id || null, prorated: true }));
      newTotal = 0; items.forEach((it) => { if (Number.isFinite(Number(it.total))) newTotal += Number(it.total); });
    }
    return { items, total: money.round2(Math.max(0, newTotal)), applied };
  } catch (_) { return { items, total, applied: [] }; }
}
module.exports = { applyLiveOffers };
