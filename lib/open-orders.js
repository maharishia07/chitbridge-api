'use strict';
/**
 * lib/open-orders.js — THE OPEN ORDERS, ONE DEFINITION (M168). The till's order list (GET /api/till/tasks) and Home's Orders card
 * (lib/home-facts orders) both ask THIS function, so "19 orders open" on Home and "🛒 2" on the till can never be two answers.
 * An order is open for a side when its chit says that side (sideOf), and some line still has quantity remaining (lib/deliverline —
 * events, never a stored total). Trips: select.rows (1) + one chit_detail read + ONE progress read (progressMany), whatever the count.
 */
const select = require('./select');
const deliverline = require('./deliverline');
const { withEntity } = require('../db');

/**
 * ⭐⭐ WHICH WAY DOES AN ORDER FACE? (2026-09-08)
 *
 * An order we SEND is a purchase; an order we RECEIVE is a sale. That held until the ordinary Indian case turned up: a supplier who
 * is not on ChitBridge cannot be a recipient of a chit, so a shop's own purchase order has to be recorded as a SELF chit — and a
 * self chit lands as direction 'received', exactly like a customer's order to us. Direction stopped being enough to tell them apart.
 *
 * ⚠️ SO IT IS DECLARED, NOT INFERRED. `business_json.side` says 'buy' or 'sell', written by whoever creates the order. A chit that
 * does not say keeps the old meaning, which is what every chit written before today meant.
 */
function sideOf(head, bj) {
  const said = (bj && typeof bj.side === 'string') ? bj.side.toLowerCase() : null;
  if (said === 'buy' || said === 'sell') return said;
  return head.direction === 'sent' ? 'buy' : 'sell';
}
/** M126: the storefront's own words for an order (summary_json.order_details) as the till needs them; null when it is not an online order */
function orderOf(sum) {
  const d = sum && typeof sum === 'object' ? sum.order_details : null;
  if (!d || d.channel !== 'online') return null;
  return { channel: 'online', fulfilment: d.fulfilment === 'pickup' ? 'pickup' : 'delivery',
           address: d.address || null, requested_delivery: d.requested_delivery || null, remark: d.remark || null, name: d.name || null };
}

/** kind 'receive' (orders WE SENT, goods to count in) or 'despatch' (orders WE RECEIVED, goods to send) → [task] */
async function tasks(entity_id, kind, limit) {
  const want = kind === 'receive' ? 'buy' : 'sell';
  const since = new Date(Date.now() - 120 * 24 * 3600 * 1000).toISOString();
  /* ⚠️ BOTH DIRECTIONS, and sideOf decides — a purchase order for an off-platform supplier arrives as 'received' and is still a purchase */
  let heads = await select.rows(entity_id, { purpose: 'order', since, limit: 300 });
  /* ⭐ a supplier's counter bill reaches me as purpose 'invoice' + counter_bill (routes/chits.js billCopyFor) — goods to
     count in, so goods-in reads those too (only those: an app invoice is not a counter's delivery) */
  if (kind === 'receive') {
    const bills = await select.rows(entity_id, { purpose: 'invoice', direction: 'received', since, limit: 300 });
    heads = heads.concat(bills.map((h) => Object.assign({ _counterBillOnly: true }, h)))
      .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  }
  if (!heads.length) return [];
  return withEntity(entity_id, async (db) => {
    const ids = heads.map((h) => h.chit_id);
    const li = await db.query(
      `SELECT h.chit_id, d.line_items, h.business_json
         FROM chit_header h
         LEFT JOIN chit_detail d ON d.chit_id = h.chit_id AND d.entity_id = h.entity_id
        WHERE h.entity_id = $1 AND h.chit_id = ANY($2::uuid[])`, [entity_id, ids]);
    const byId = new Map(li.rows.map((r) => [String(r.chit_id), r]));
    const prog = await deliverline.progressMany(entity_id, ids, db).catch(() => null);
    /* M129b: an order the OLD counter despatched (a D/… note against it, no movement ever written) is not open.
       M162b: nor is an order a BILL was made against (the bill's business_json.order.from = the order's chit id) - the till's done-write may never have happened.
       ONE read answers both, for every order, not one per order. */
    const marks = (await db.query(
      `SELECT DISTINCT CASE WHEN business_json->>'doc' = 'despatch' THEN business_json->'against'->>'chit_id' END AS against,
                       CASE WHEN business_json->>'doc' IS DISTINCT FROM 'despatch' THEN business_json->'order'->>'from' END AS billed
         FROM chit_header
        WHERE entity_id = $1 AND ((business_json->>'doc' = 'despatch' AND business_json->'against'->>'chit_id' = ANY($2::text[]))
                               OR (business_json->>'bill_no' IS NOT NULL AND business_json->'order'->>'from' = ANY($2::text[])))`,
      [entity_id, ids.map(String)]).catch(() => ({ rows: [] }))).rows;
    const despatched = new Set(marks.filter((r) => r.against).map((r) => String(r.against)));
    const billed = new Set(marks.filter((r) => r.billed).map((r) => String(r.billed)));
    const out = [];
    for (const h of heads) {
      const det = byId.get(String(h.chit_id)) || {};
      const bj = det.business_json || {};
      if (h._counterBillOnly && bj.counter_bill !== true) continue;
      /* ⭐ A SUPPLIER'S COUNTER BILL SENT TO ME is goods to count in (the two-sided counter bill, 2026-10-01): a purchase,
         whatever its direction says — and receiving every line accepts it (routes/chits.js deliver-lines) */
      const theirBill = require('./tax-copy').billReceived(Object.assign({}, h, { business_json: bj }), entity_id);
      if (bj.bill_no && !theirBill) continue;       /* MY counter sale is a record, not a task */
      if ((theirBill ? 'buy' : sideOf(h, bj)) !== want) continue;   /* the other way round belongs to the other screen */
      if (out.length >= limit) break;
      const p0 = prog && prog.get ? prog.get(String(h.chit_id)) : null;
      const lines = (Array.isArray(det.line_items) ? det.line_items : []).map((l, i) => {
        /* M162: the id the line has in chit_line (a storefront order's JSON carries none) - without it nothing could be written against the line */
        const line_id = deliverline.lineIdOf(h.chit_id, l, i + 1);
        const p = (p0 && p0.get) ? p0.get(line_id) : null;
        const ordered = Number(l.quantity) || 0;
        const moved = (p && p.delivered != null) ? Number(p.delivered) : 0;
        return { line_id,
                 item_id: (l.item_data && l.item_data.item_id) || l.item_id || null,
                 name: l.particulars || l.name || '', unit: l.unit || 'piece',
                 rate: l.price == null ? null : Number(l.price),
                 ordered, moved, remaining: Math.max(0, Math.round((ordered - moved) * 1000) / 1000) };
      });
      if (!lines.length) continue;
      if (lines.every((l) => l.remaining <= 0)) continue;      /* nothing owed: not a task */
      if (despatched.has(String(h.chit_id)) && lines.every((l) => !(l.moved > 0))) continue;   /* M129b */
      if (billed.has(String(h.chit_id))) continue;   /* M162b */
      out.push({ chit_id: h.chit_id, at: h.created_at,
                 subject: h.manual_subject || h.auto_subject || '',
                 party: (orderOf(h.summary_json) || {}).name || h.counterparty_name || (bj.party && bj.party.name) || '', party_id: h.counterparty_id || null,
                 ref: bj.order_no || bj.ref || null,
                 /* M74: the till's order list shows it (who · ₹ · age · STATUS) */
                 status: h.current_status || null,
                 /* M126: how an ONLINE order was placed (summary_json.order_details, written by the storefront) - the till bills it
                    as ordered (Delivery / Pickup) instead of packing it; null for an order typed or sent in any other way */
                 order: orderOf(h.summary_json), lines });
    }
    return out;
  });
}

module.exports = { tasks, sideOf, orderOf };
