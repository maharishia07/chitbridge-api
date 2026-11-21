'use strict';
/**
 * lib/receipt-lines.js — A GOODS-IN THAT CANNOT MOVE STOCK IS REFUSED IN WORDS, NEVER ANSWERED "SENT" (WALK-D D-F-01..05, 21 Nov 2026).
 *
 * OWNER     cb-operations
 * RISK      money
 * OWNS      refusalOf (pure: quantity, cost, expiry of each receipt line) · catalogueRefusal (the product and the batch it needs: one read) · RECEIPT_QTY_CEILING
 * CALLED BY routes/chits.js sendReceiptLines (a step of the send, ahead of the money)
 * FLOW      a non-draft receipt's lines → refusalOf → catalogueRefusal → { status 400, code, message, line } | null → the send answers it under the ONE error shape (lib/problem)
 * CARD      13-inventory-stock-and-traceability/on-hand-and-movements
 *
 * Before this, lib/stock-from-chit skipped such a line by name in the server log only: the walker's receipt of qty 0, -3, 1e12, no cost, a ghost item id, a batch-kept item with no
 * lot, an expired lot and the date "12/03/25" all answered 200 "Chit sent successfully" with stock unmoved (or ghost stock made). One definition of each test, read from the movement's own readers
 * (stock-from-chit rateOf · lotOf · itemIdOf, catalogue-write MAX_NUMBER, books-period isCalendarDay) — nothing is recomputed here.
 * ⚠️ A receipt AGAINST a bill I bought (business_json.against) is counted in line by line from that bill: its cost and product come from the bill, so only the quantity and the lot's date are tested there.
 * ⚠️ "Today" is the shop clock's day (lib/shop-clock today(), the zone it defaults to; the shop's own zone is not read here); a caller may hand its own.
 */
const fromChit = require('./stock-from-chit');
const stocked = require('./stocked');
const { isCalendarDay } = require('./books-period');
const { MAX_NUMBER } = require('./catalogue-write');

const RECEIPT_QTY_CEILING = MAX_NUMBER; /* a quantity at or above the catalogue's own number ceiling is a slip of the finger, not a delivery */
const isReceipt = (chit) => String((chit && chit.purpose) || '') === 'receipt' || ((chit && chit.business_json) || {}).doc === 'receipt';
const isAgainst = (chit) => !!(((chit && chit.business_json) || {}).against || {}).chit_id;
const nameOf = (line, at) => '"' + String((line && (line.name || line.particulars)) || 'line ' + (at + 1)).slice(0, 60) + '"';
const refusal = (code, at, line, message, extra) => Object.assign({ status: 400, code, line: at, message: 'Line ' + (at + 1) + ' ' + nameOf(line, at) + ': ' + message }, extra || {});

/** the live lines of a non-draft receipt → [{ line, at }], [] for anything else (a draft, an order, a removed line) */
function receiptLines(chit) {
  if (!chit || chit.is_draft || !isReceipt(chit) || !Array.isArray(chit.line_items)) return [];
  return chit.line_items.map((line, at) => ({ line, at })).filter((row) => row.line && !row.line.removed);
}

/** the quantity of one line: a number above 0 and under the ceiling → refusal | null (a text figure is the send-money step's BAD_QTY, so only a number or null lands here) */
function qtyRefusal(line, at) {
  const raw = line.quantity != null ? line.quantity : line.qty;
  const qty = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw;
  if (typeof qty !== 'number' || !isFinite(qty) || qty <= 0) return refusal('BAD_QTY', at, line, 'goods received need a quantity above 0. Nothing was put on the shelf.', { field: 'quantity' });
  if (qty >= RECEIPT_QTY_CEILING) return refusal('BAD_QTY', at, line, 'that quantity is too large to be a delivery (below ' + RECEIPT_QTY_CEILING + '). Nothing was put on the shelf.', { field: 'quantity' });
  return null;
}

/**
 * the cost of a line that names a STOCK product of mine on a direct goods-in: present and not below 0 → refusal | null.
 * RAIL-146c (decided 21 Nov 2026, the stronger of leader practice and the standard): stock is valued at cost (IAS 2; Xero, QuickBooks and Zoho require a cost on a tracked-inventory receipt), so a costless receipt of a stock item is REFUSED in words.
 * An item the shop does not count as stock (a service, a dish made to order) is not valued, so its costless line is not refused: it is SKIPPED with a no_cost note (stock-from-chit movementsFor) and the receipt still goes.
 * The test of "counted" needs the catalogue's flags, so this runs in catalogueRefusal (one read), not in the pure refusalOf.
 */
function costRefusal(line, at) {
  if (fromChit.rateOf(line) !== null) return null;
  return refusal('BAD_PRICE', at, line, 'no cost price (or one below 0), so the stock cannot be valued. Put the price paid on the line.', { field: 'price' });
}

/** the lot's expiry: a real calendar day (YYYY-MM-DD), and not already past → refusal | null. The reader is the movement's own (stock-from-chit lotOf), so what is refused here is exactly what would have been skipped there. */
function expiryRefusal(line, at, today) {
  const read = fromChit.lotOf(line);
  if (read.refuse) return refusal(read.code === 'batch_unreadable' ? 'RECEIPT_LOT_UNREADABLE' : 'RECEIPT_DATE_UNREADABLE', at, line, read.refuse + '. Write a date as year-month-day, for example 2027-03-12.', { field: 'lot' });
  if (!read.expires_at) return null;
  if (!isCalendarDay(read.expires_at)) return refusal('RECEIPT_DATE_UNREADABLE', at, line, 'the expiry ' + read.expires_at + ' is not a real date. Write it as year-month-day, for example 2027-03-12.', { field: 'lot' });
  if (read.expires_at < today) return refusal('RECEIPT_LOT_EXPIRED', at, line, 'the lot expired on ' + read.expires_at + ', so it is not taken into stock.', { field: 'lot' });
  return null;
}

/** the first line of a receipt that cannot move stock, judged on the chit alone (no read) → refusal | null. opts.today = 'YYYY-MM-DD' */
function refusalOf(chit, opts) {
  const today = (opts && opts.today) || require('./shop-clock').today(); /* the ONE clock (a day is never read off new Date() here) */
  for (const { line, at } of receiptLines(chit)) {
    const found = qtyRefusal(line, at) || expiryRefusal(line, at, today);
    if (found) return found;
  }
  return null;
}

/** the catalogue read: the ids this shop sells (one query) → Set */
async function knownIds(entity_id, ids, withEntity) {
  const reply = await withEntity(entity_id, (db) => db.query('SELECT item_id FROM catalogue_items WHERE entity_id = $1 AND item_id = ANY($2::uuid[])', [entity_id, ids]));
  return new Set(reply.rows.map((row) => String(row.item_id)));
}

/** an item id that is no uuid names no product, and must not reach the uuid cast */
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * the product and the batch it needs, one read each for the whole receipt: a line naming an item the shop does not sell → RECEIPT_ITEM_UNKNOWN; a batch-kept item with no lot → RECEIPT_LOT_REQUIRED.
 * A direct goods-in only (a receipt against a bill takes its products from the bill). → refusal | null
 */
async function catalogueRefusal(chit, entity_id, withEntity, opts) {
  if (isAgainst(chit)) return null;
  const rows = receiptLines(chit).filter((row) => fromChit.itemIdOf(row.line));
  if (!rows.length) return null;
  const ids = [...new Set(rows.map((row) => fromChit.itemIdOf(row.line)))];
  const valid = ids.filter((id) => UUID_SHAPE.test(id));
  const known = valid.length ? await knownIds(entity_id, valid, withEntity) : new Set();
  const ghost = rows.find((row) => !known.has(fromChit.itemIdOf(row.line)));
  if (ghost) return refusal('RECEIPT_ITEM_UNKNOWN', ghost.at, ghost.line, 'this is not a product in your catalogue, so nothing was put on the shelf. Add the product first.', { field: 'item_id' });
  const flags = await stocked.flagsFor(entity_id, valid, withEntity, opts || {});
  const bare = rows.find((row) => (flags.by.get(fromChit.itemIdOf(row.line)) || {}).tracked === true && !fromChit.lotOf(row.line).lot);
  if (bare) return refusal('RECEIPT_LOT_REQUIRED', bare.at, bare.line, 'this product is kept by batch, so the batch number is needed. Nothing was put on the shelf.', { field: 'lot' });
  const costless = rows.find((row) => (flags.by.get(fromChit.itemIdOf(row.line)) || {}).counted !== false && costRefusal(row.line, row.at));
  return costless ? costRefusal(costless.line, costless.at) : null;
}

module.exports = { refusalOf, catalogueRefusal, receiptLines, RECEIPT_QTY_CEILING };
