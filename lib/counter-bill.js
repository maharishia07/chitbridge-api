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
 * ⭐ CTR-204 · IS THIS REPLAY THE SAME SALE AS THE HELD BILL? Carried figures are compared, nothing is worked out (mismatch, not recompute). A FALSE "different" is
 * worse than a missed one (the till renumbers on it, which would bill the customer twice), so every doubt is "no verdict":
 *   · currency — the held money.currency_code against the replay's invoice currency, when BOTH carry one
 *   · total    — both in MINOR units of the bridge that carried it (the engine's own total step, exact), else the figure rounded by lib/money to the currency's decimals
 *   · lines    — only when EVERY line on both sides has an item_id: the sorted item_id + quantity. A line with no item_id gives no verdict on lines (a renamed item on an
 *                honest replay is the same sale; comparing quantity alone would still miss a swap, and the total already catches a change of money)
 * Anything else (receipt time, device and person stamps, tax decoration, notes) may differ on an honest replay and is never read.
 * Answers null (the same sale) or { differs: 'currency' | 'total' | 'lines' }. `held` = { summary_json, line_items }; `incoming` = { business_json, line_items }.
 */
function replayDiffers(held, incoming) {
  const heldMoney = (held && held.summary_json && held.summary_json.money) || {};
  const invoice = (incoming && incoming.business_json && incoming.business_json.invoice) || {};
  if (heldMoney.currency_code && invoice.currency && String(heldMoney.currency_code) !== String(invoice.currency)) return { differs: 'currency' };
  if (totalsDiffer(heldMoney, invoice, invoice.currency || heldMoney.currency_code || null)) return { differs: 'total' };
  return linesDiffer(held && held.line_items, incoming && incoming.line_items) ? { differs: 'lines' } : null;
}

/** the engine's own total step of a carried bridge, in minor units (exact), or null when the bill carries no bridge */
function bridgeTotalMinor(bridge) {
  const step = bridge && Array.isArray(bridge.steps) ? bridge.steps.find((item) => item && item.name === 'total') : null;
  return step && Number.isFinite(step.amount_minor) ? step.amount_minor : null;
}

/** a total figure in minor units by lib/money's own rounding and decimals for the currency (the one rule); null = not known */
function figureMinor(figure, currency) {
  const value = figure === null || figure === undefined || figure === '' ? NaN : Number(figure);
  if (!Number.isFinite(value) || !currency) return null;
  const money = require('./money');
  return Math.round(money.round(value, currency) * Math.pow(10, money.decimals(currency)));
}

/**
 * two carried totals in minor units, both known and not equal. Both carry the engine's bridge → its exact total steps; neither does → both figures rounded to the currency's
 * decimals; ONE of them does → no verdict (the stored money.total of a bill from before the bridge is rounded to 2 places, so 1.24 against a bridge's 1.235 would be a false "different").
 */
function totalsDiffer(heldMoney, invoice, currency) {
  const heldStep = bridgeTotalMinor(heldMoney.bridge);
  const sentStep = bridgeTotalMinor(invoice._cb && invoice._cb.bridge);
  if (heldStep !== null || sentStep !== null) return heldStep !== null && sentStep !== null && heldStep !== sentStep;
  const held = figureMinor(heldMoney.total, currency);
  const sent = figureMinor(invoice.ValDtls && invoice.ValDtls.TotInvVal, currency);
  return held !== null && sent !== null && held !== sent;
}

/** two line lists that are both judgeable (every line carries an item_id) and name different items or quantities */
function linesDiffer(held, sent) {
  const heldKeys = lineKeysOf(held);
  const sentKeys = lineKeysOf(sent);
  return heldKeys !== null && sentKeys !== null && heldKeys.length > 0 && sentKeys.length > 0 && heldKeys.join('|') !== sentKeys.join('|');
}

/** the identity of each line — item_id and quantity — sorted so the order a till listed them in never decides; null when any line has no item_id (no verdict) */
function lineKeysOf(lines) {
  if (!Array.isArray(lines)) return [];
  if (lines.some((line) => !(line && line.item_id))) return null;
  return lines.map((line) => String(line.item_id) + '*' + (Number(line.quantity) || 0)).sort();
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
