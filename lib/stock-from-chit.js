/**
 * ── lib/stock-from-chit.js · WHICH CHITS MOVE STOCK, AND HOW ───────────────────────────────────────────────────
 *
 * Athi, 2026-09-10: *"wire goods-in and sales to post movements."*
 *
 * ⭐⭐⭐ THE RULE THIS FILE ENFORCES: **STOCK MOVES WHEN GOODS MOVE.** Not when an order is placed, not when an
 * invoice is raised. That single line settles every case below and is why the list of chits that move stock is
 * much shorter than the list of chits that mention products:
 *
 *   goods received    → `purchase`   IN   · the goods are on the shelf, and the cost price is known
 *   a counter bill    → `sale`       OUT  · the customer is holding the bag; a till bill IS the handover
 *   an order          → nothing           · a promise, not a movement. Stock moves when it is despatched.
 *   a draft           → nothing           · nothing has happened at all
 *   a despatch note   → nothing YET       · see the warning below
 *
 * ⚠️⚠️ DESPATCH IS DELIBERATELY NOT WIRED, and it is the one that would look like an omission. For a counter shop
 * the sale and the handover are the same event, so posting on both a bill and a despatch note would take the
 * stock out TWICE. Which of the two is authoritative depends on whether a business despatches against orders or
 * sells across a counter, and that is a question about the business, not about the code. It needs Athi, and it
 * needs the B2B despatch flow to be in scope; guessing would corrupt a ledger that cannot be edited afterwards.
 *
 * ⭐ THE DERIVATION IS PURE (`movementsFor`), on purpose. Everything hard here is shape-reading — where the item
 * id lives, which of two cost figures is the real one — and shape-reading is exactly what should be testable
 * without a database. `postFor` is the thin part that writes.
 */
const store = require('./stock-store');

function num(v) { const n = Number(v); return isFinite(n) ? n : null; }

/**
 * ⚠️ THE ITEM ID LIVES IN TWO DIFFERENT PLACES depending on which screen built the chit: the counter's sale puts
 * it at the TOP LEVEL of a line, and its goods-in puts it inside `item_data`. That is an inconsistency in the two
 * builders (tools/tally-connector/till.js — `chitOf` vs `chitOfDoc`) and it should be settled there eventually.
 * Reading both here is the honest fix for today; guessing one and silently skipping every line of the other shape
 * would have produced a stock ledger that was simply missing half the shop.
 */
function itemIdOf(line) {
  const d = line && line.item_data;
  const id = (line && line.item_id) || (d && d.item_id) || null;
  return id ? String(id) : null;
}

/** ⚠️ line_id is stamped at the door by mint.lines() and survives an edit, so it is a better key than a position */
function lineRefOf(line, i) {
  const d = line && line.item_data;
  return String((line && line.line_id) || (d && d.line_id) || (i + 1));
}

/**
 * ⭐⭐ WHICH COST GOES INTO THE VALUATION — and this is a real accounting decision, not a field choice.
 *
 * Goods-in captures two figures: the supplier's `price` (their rate on the invoice) and `item_data.unit_cost`,
 * which is that rate PLUS this line's share of freight, loading and duty. **Ind AS 2 says inventory cost includes
 * those**, so the landed figure is the correct one and the bare rate would understate every margin in the shop.
 * ⚠️ And what is NOT in either of them is the refundable GST — goods-in records tax separately and RCV-07 asserts
 * it stays out of the landed cost. That is the same standard, and it was already right before this file existed.
 */
function rateOf(line) {
  const d = (line && line.item_data) || {};
  const landed = num(d.unit_cost);
  if (landed !== null && landed >= 0) return landed;
  const bare = num(line && line.price);
  return (bare !== null && bare >= 0) ? bare : null;
}

/**
 * chit → the movements it implies. Returns [] for the great majority of chits, which is the point.
 *   { chit_id, purpose, is_draft, business_json, line_items, created_at }
 */
function movementsFor(chit) {
  const c = chit || {};
  if (c.is_draft) return [];
  const bj = c.business_json || {};
  const purpose = String(c.purpose || '');
  const lines = Array.isArray(c.line_items) ? c.line_items : [];
  if (!lines.length) return [];

  let reason = null;
  if (purpose === 'receipt' || bj.doc === 'receipt') reason = 'purchase';
  /* ⚠️ A COUNTER BILL, NOT ANY ORDER. `bill_no` is what the till stamps on a sale it has just handed over; an
     order raised in the app carries no bill number because nothing has left the shop yet. */
  else if (purpose === 'order' && bj.bill_no) reason = 'sale';
  else return [];

  /* the document's own number — the SAME client_ref the chit deduped on, which is what makes a replay harmless */
  const ref = String(bj.client_ref || bj.bill_no || bj.doc_no || c.chit_id || '').slice(0, 64);
  if (!ref) return [];
  const at = c.created_at || bj.billed_at || bj.doc_at || null;

  const out = [];
  lines.forEach((l, i) => {
    const item_id = itemIdOf(l);
    const qty = num(l && l.quantity);
    /* ⚠️ A LINE WITH NO PRODUCT ID CANNOT MOVE STOCK. A free-text line ("labour", "delivery") is a real thing to
       bill for and not a thing on a shelf, so it is skipped rather than refused — but see `skipped` below: it is
       counted and reported, because "half the lines silently did nothing" is how this feature would rot. */
    if (!item_id || qty === null || qty <= 0) return;
    const mv = { item_id, reason, qty, unit: (l && l.unit) || null,
                 ref, line_ref: lineRefOf(l, i), at,
                 lot: (l && l.item_data && l.item_data.lot) || null,
                 note: (l && l.particulars) ? String(l.particulars).slice(0, 120) : null };
    if (reason === 'purchase') {
      const rate = rateOf(l);
      /* ⚠️ NO COST PRICE, NO RECEIPT. The engine would refuse it anyway; catching it here means the reason can
         name the line rather than arriving as a bare validation failure from three layers down. */
      if (rate === null) { out.push({ skip: true, item_id, line_ref: mv.line_ref,
        why: 'no cost price on this line, so the stock cannot be valued' }); return; }
      mv.rate = rate;
    }
    out.push(mv);
  });
  return out;
}

/**
 * ⭐ POST THEM. Idempotent through `store.post` — the unique index on (entity, ref, line_ref, reason) means a
 * replayed bill moves nothing, which matters because replaying is what the counter's queue does for a living.
 *
 * ⚠️⚠️ IT NEVER THROWS, AND THAT IS A TRADE, NOT A CONVENIENCE. It runs after the chit is committed, so a failure
 * here must not take down a sale that has already happened. The cost of that choice is that a failed movement is
 * lost until somebody notices — which is survivable ONLY because the movements are re-derivable from the chit at
 * any time (this same function, same ref, same idempotency), so a backfill can heal it. Say so, log it, and do
 * not pretend the gap is not there.
 */
async function postFor(entity_id, chit, withEntity, opts) {
  const wanted = movementsFor(chit);
  if (!wanted.length) return { moved: 0, skipped: [], failed: [], duplicate: 0 };
  const result = { moved: 0, skipped: [], failed: [], duplicate: 0 };
  for (const mv of wanted) {
    if (mv.skip) { result.skipped.push(mv); continue; }
    try {
      const r = await store.post(entity_id, mv, withEntity, opts);
      if (!r.ok) result.failed.push({ line_ref: mv.line_ref, why: r.why });
      else if (r.duplicate) result.duplicate++;
      else result.moved++;
    } catch (e) {
      result.failed.push({ line_ref: mv.line_ref, why: String(e && e.message) });
    }
  }
  return result;
}

module.exports = { movementsFor, postFor, itemIdOf, rateOf };
