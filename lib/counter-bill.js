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
 *       POST /api/chits/send  → sameRefLook → byRef(db, shop, client_ref) → (a replay) byRef(…, { lines }) → replayDiffers (CTR-204)
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

/**
 * ⭐ THE ONE PICK OF A BILL'S TOTAL (ACC-206 B · R3 · Athi 2026-10-30: "afterwards, everything is data, no computation anywhere").
 * The total is held in up to three stored copies of ONE engine figure — business_json.invoice.ValDtls.TotInvVal, summary_json.money.total and
 * summary_json.total_value. This READS them (only equality is asked, never an amount worked out) and answers which one stands:
 *   { total, source: 'invoice' | 'money' | 'legacy' | 'withheld' | 'none', agree: true | false, legacy_net?: true, copies: { invoice, money, total_value } }
 *   · withheld — the TR-6 operator copy (summary_json.oversight): no figure, never a mismatch
 *   · invoice  — the engine's invoice, when every other copy that is set equals it (stamps or no stamps: a chit sent before stamps existed agrees)
 *   · money    — no invoice, or an old chit: money.total, the engine's header figure
 *   · legacy_net — a chit with NO stamps whose total_value is the route's own net beside the engine's money.total (every non-counter chit before ACC-206):
 *                  one engine figure beside a figure the route once summed — NOT a disagreement between two copies, so nothing is raised
 *   · agree false — a chit written under ACC-206 (stamped) whose copies DIFFER: the engine's figure is answered, flagged, never one of them as settled
 *   · legacy   — a chit with no engine figure at all (before 7 Sep 2026): total_value as placed
 */
function pickOf(header) {
  const copies = storedCopies(header);
  const summary = (header && header.summary_json) || {};
  if (summary.oversight === true) return { total: null, source: 'withheld', agree: true, copies };
  const first = standingCopy(copies);
  if (!first) return { total: copies.total_value, source: copies.total_value === null ? 'none' : 'legacy', agree: true, copies };
  const standing = copies[first];
  const differs = ['invoice', 'money', 'total_value'].filter((name) => name !== first && copies[name] !== null && copies[name] !== standing);
  if (!differs.length) return { total: standing, source: first, agree: true, copies };
  const routeNet = !summary.stamps && differs.length === 1 && differs[0] === 'total_value'; /* every non-counter chit before ACC-206: total_value was the route's own net */
  return routeNet ? { total: standing, source: first, agree: true, legacy_net: true, copies } : { total: standing, source: first, agree: false, differs, copies };
}

/** which stored copy stands as the engine's figure: the invoice's total, else the header's money.total, else none (a chit with no engine figure at all) */
const standingCopy = (copies) => (copies.invoice !== null ? 'invoice' : copies.money !== null ? 'money' : null);

/** the three stored copies of one bill's total, each a finite number or null: the engine's invoice total, the header's money.total, the header's total_value */
function storedCopies(header) {
  const summary = (header && header.summary_json) || {};
  const invoice = header && header.business_json && header.business_json.invoice;
  const numberOf = (value) => (value === undefined || value === null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value));
  return { invoice: numberOf(invoice && invoice.ValDtls && invoice.ValDtls.TotInvVal), money: numberOf(summary.money && summary.money.total), total_value: numberOf(summary.total_value) };
}

/**
 * ⭐ CTR-204 · IS THIS REPLAY THE SAME SALE AS THE HELD BILL? Two carried figures are compared, nothing is worked out (mismatch, not recompute):
 *   · total — the held bill's stored total (pickOf: summary_json.money.total) against the total the replay carries (its invoice's ValDtls.TotInvVal)
 *   · lines — item (item_id, else the name) and quantity of each line, as a sorted list, held chit_detail.line_items against the replay's line_items
 * Anything else may differ on an honest replay (receipt time, device and person stamps, tax decoration, notes) and is never read.
 * A side that carries no figure, or no lines, gives no verdict: the replay stays a duplicate, so a bill this cannot judge is never blocked.
 * Answers null (the same sale) or { differs: 'total' | 'lines' }. `held` = { summary_json, line_items }; `incoming` = { business_json, line_items }.
 */
function replayDiffers(held, incoming) {
  const heldTotal = pickOf({ summary_json: held && held.summary_json }).total;
  const sentTotal = storedCopies({ business_json: incoming && incoming.business_json }).invoice;
  if (heldTotal !== null && sentTotal !== null && Math.abs(Number(heldTotal) - sentTotal) >= 0.0005) return { differs: 'total' };
  const heldLines = lineKeysOf(held && held.line_items);
  const sentLines = lineKeysOf(incoming && incoming.line_items);
  if (heldLines.length && sentLines.length && heldLines.join('|') !== sentLines.join('|')) return { differs: 'lines' };
  return null;
}

/** the identity of each line — item and quantity — sorted, so the order a till happened to list them in never decides */
function lineKeysOf(lines) {
  if (!Array.isArray(lines)) return [];
  return lines.map((line) => String((line && (line.item_id || line.name || line.particulars)) || '').trim().toLowerCase() + '*' + (Number(line && line.quantity) || 0)).sort();
}

/**
 * ⭐ THE ONE PICK OF A BILL'S TAXABLE VALUE (ACC-206 C1): the engine's taxable figure off summary_json.money (taxable, else net), null where the
 * bill carried none (a note, a counter credit note, a chit from before 7 Sep). Lifted from routes/till.js billMoney, which calls it. It READS;
 * nothing is subtracted here (taxable = total − tax is the engine's, stored beside the total). Used by: till billMoney · lib/cost.js (the owner's margin).
 */
function taxableOf(summary_json) {
  const money = (summary_json || {}).money || {};
  return money.taxable != null ? money.taxable : money.net != null ? money.net : null;
}

/** what the customer PAID for this bill, off the stored copies — the one pick (GET /api/till/bills and the reward both quote it); business_json is optional, the money block alone is still read */
function paidOf(summary_json, business_json) {
  const picked = pickOf({ summary_json, business_json });
  if (picked.total !== null) return picked.total;
  const money = (summary_json || {}).money || {};
  return money.net != null ? money.net : (summary_json || {}).total_value;
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

/**
 * CTR-197 / H3: the ONE condition that leaves a withdrawn counter bill out of every list that adds a day up (alias h = chit_header).
 * Read from chit_status, the rail's status table (written only by chit-move moveStatus) - never a second status key on the bill.
 * Used by: routes/till.js BILLS_SQL (Earlier bills, the day report) - lib/books-store counterBills (the day close).
 */
const WITHDRAWN_TEST = `EXISTS (SELECT 1 FROM chit_status cs WHERE cs.chit_id = h.chit_id AND cs.entity_id = h.entity_id AND cs.current_status IN ('cancelled', 'rejected'))`;
const NOT_WITHDRAWN_SQL = `AND NOT ${WITHDRAWN_TEST}`;
/** its negation: the bills the books reversed - GET /till/bills names them in `withdrawn`, so a counter that still holds one locally can drop it from its day */
const WITHDRAWN_SQL = `AND ${WITHDRAWN_TEST}`;

module.exports = { byRef, replayDiffers, paidOf, pickOf, taxableOf, basketOf, NOT_WITHDRAWN_SQL, WITHDRAWN_SQL, WITHDRAWN_TEST };
