'use strict';
/**
 * lib/counter-bill.js — THE SHOP'S OWN COUNTER BILL, READ BY ITS NUMBER (W2-REW, 2026-10-15).
 *
 * owns       nothing — it READS the chit the counter sent with the bill number as `client_ref` (till.html chitOf → POST /api/chits/send
 *            writes it): chit_header, and chit_detail.line_items when asked. The money is `summary_json.money` (tax.moneyOf, picked
 *            by the send route — never worked out again here).
 * called by  routes/chits.js sameRefLook — "is this bill already here?" (the duplicate / collision check on every send)
 *            lib/reward-store.js settle — "what did this bill come to?" (the points are earned from the SERVER'S bill, never from
 *            what the till posted beside it). The second reader of "my bill by its number" is why this file exists: ONE query.
 * FLOW  POST /api/till/reward → reward-store.settle → byRef(db, shop, no, {lines, mine}) → basketOf → rewards.earnedOn
 *       POST /api/chits/send  → sameRefLook → byRef(db, shop, client_ref)
 * CARD  08-rewards-and-loyalty/points-and-reward-ledger
 * ⚠️ byRef takes `db` — a withEntity() handle inside its transaction (chit_header is FORCE RLS). It opens no connection.
 */

/** the duplicate check's read, byte for byte (tests/fixtures/send-golden.json pins it): header only, any direction, the first recorded */
const HEADER_SQL = `SELECT chit_id, business_json->'till'->>'id' AS till_id,
            business_json->>'billed_at' AS billed_at
       FROM chit_header WHERE entity_id = $1 AND business_json->>'client_ref' = $2
      ORDER BY created_at LIMIT 1`;

/** the same bill WITH its money and lines, and only one the shop ISSUED (a supplier's counter bill I received carries THEIR number) */
const WITH_LINES_SQL = `SELECT h.chit_id, h.business_json->'till'->>'id' AS till_id, h.business_json->>'billed_at' AS billed_at,
            h.summary_json, d.line_items
       FROM chit_header h
       LEFT JOIN chit_detail d ON d.chit_id = h.chit_id AND d.entity_id = h.entity_id
      WHERE h.entity_id = $1 AND h.sender_entity_id = $1 AND h.business_json->>'client_ref' = $2
      ORDER BY h.created_at LIMIT 1`;

/**
 * The shop's chit carrying this bill number, or null — the oldest, the order the duplicate check has always used.
 * `want.lines` brings summary_json + line_items (the reward earns from them); without it, exactly the duplicate check's read.
 */
async function byRef(db, entity_id, ref, want) {
  const result = await db.query(want && want.lines ? WITH_LINES_SQL : HEADER_SQL, [entity_id, ref]);
  return result.rows[0] || null;
}

/** what the customer PAID for this bill, off summary_json — the one pick (GET /api/till/bills and the reward both quote it) */
function paidOf(summary_json) {
  const money = (summary_json || {}).money || {};
  if (money.total != null) return money.total;
  if (money.net != null) return money.net;
  return (summary_json || {}).total_value;
}

/**
 * The bill as the rewards engine reads a basket (rewards.earnedOn): net · gross · count · lines[{ item_id, qty, net, sku, category }].
 * `catalogue` is a Map item_id → { sku, category } from the shop's own catalogue (reward-store.catalogueOf); a line it does not
 * name keeps only what the chit recorded. Pure: no money is computed, every figure is picked.
 */
function basketOf(bill, catalogue) {
  const money = ((bill && bill.summary_json) || {}).money || {};
  const lines = Array.isArray(bill && bill.line_items) ? bill.line_items : [];
  return {
    net: Number(paidOf(bill && bill.summary_json)) || 0,
    gross: Number(money.gross) || 0,
    count: lines.length,
    lines: lines.map((line) => {
      const known = (catalogue && line.item_id && catalogue.get(String(line.item_id))) || {};
      return {
        item_id: line.item_id || null,
        qty: Number(line.quantity) || 0,
        net: Number(line.total) || 0,
        sku: known.sku || null,
        category: known.category || null
      };
    })
  };
}

module.exports = { byRef, paidOf, basketOf };
