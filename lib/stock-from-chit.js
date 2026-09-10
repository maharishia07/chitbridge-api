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
 *   a despatch note   → `sale`       OUT  · the goods have left the building
 *   an order          → nothing           · a promise, not a movement. Stock moves when it is HANDED OVER.
 *   a draft           → nothing           · nothing has happened at all
 *
 * ── ⚠️⚠️ DESPATCH AND THE COUNTER BILL CAN BOTH BE THE SAME HANDOVER ─────────────────────────────────────────
 * This was left unwired for a day because of exactly that: post on both and the stock leaves TWICE, silently and
 * permanently. The question looked like it needed a business decision — does this shop despatch against orders,
 * or sell across a counter?
 *
 * ⭐ IT DID NOT, BECAUSE THE DOCUMENT SAYS WHICH IT IS. A despatch note carries `against.chit_id` — the order it
 * is despatching. The collision only exists when the goods on that order ALREADY left on a counter bill, and a
 * counter bill stamps its own number as the movement's `ref`. So the despatch can simply ask: has anything
 * already gone out against this order? If it has, the goods left once and it says so; if not, this despatch IS
 * the handover. No flag, no policy, no shop configuring anything — the documents already know.
 *
 * ⚠️ A DESPATCH WITH NO ORDER BEHIND IT still moves stock. Goods leaving with no paperwork behind them is a real
 * despatch, not an incomplete one, and refusing it would lose the movement entirely.
 *
 * ⭐ THE DERIVATION IS PURE (`movementsFor`), on purpose. Everything hard here is shape-reading — where the item
 * id lives, which of two cost figures is the real one — and shape-reading is exactly what should be testable
 * without a database. `postFor` is the thin part that writes.
 */
const store = require('./stock-store');
const lotfields = require('./lotfields');

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

  let reason = null, against = null;
  if (purpose === 'receipt' || bj.doc === 'receipt') reason = 'purchase';
  /* ⚠️ A COUNTER BILL, NOT ANY ORDER. `bill_no` is what the till stamps on a sale it has just handed over; an
     order raised in the app carries no bill number because nothing has left the shop yet. */
  else if (purpose === 'order' && bj.bill_no) reason = 'sale';
  /* ⭐ A DESPATCH NOTE — the goods have left. `against` is the order being despatched, and postFor uses it to
     check the same goods did not already leave on a counter bill. */
  else if (purpose === 'delivery_note' || bj.doc === 'despatch') {
    reason = 'sale';
    against = (bj.against && bj.against.chit_id) || null;
  }
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
    /**
     * ⚠️ THE BATCH AND ITS DATE COME OFF THE RECEIPT, where goods-in already captured them — lotfields decides
     * what a vertical must ask for, the screen asks, and this reads what it got. Nothing here invents a batch.
     * The date is what FEFO sorts on, so a receipt that carried one must not lose it here.
     */
    const d = (l && l.item_data) || {};
    const lot = d.lot || (d.batch ? String(d.batch) : null) || null;
    const mv = { item_id, reason, qty, unit: (l && l.unit) || null,
                 ref, line_ref: lineRefOf(l, i), at, against,
                 lot, expires_at: d.expiry || d.expires_at || null,
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
/**
 * ⭐⭐ WHICH OF THESE PRODUCTS KEEP THEIR STOCK PER BATCH — asked ONCE for the whole chit, not once per line.
 *
 * ⚠️ TWO QUERIES, NOT N+1. A bill with thirty lines would otherwise be thirty round trips to Mumbai on the
 * hottest path in the product, and this runs on every send. The sector is one row; the per-product flags are one
 * query over the ids the chit actually names.
 * ⚠️ AND IT FAILS SAFE TOWARDS "NOT TRACKED". If the profile cannot be read, stock is kept as one pool rather
 * than refused for want of a batch number — a shop must not stop being able to record a delivery because a
 * lookup failed, and an untracked balance can be split later, whereas a refused receipt is simply lost.
 */
async function trackingFor(entity_id, item_ids, withEntity, opts) {
  const o = opts || {};
  let sectors = o.sectors || null;
  const flags = new Map();
  try {
    if (!sectors) {
      const p = await withEntity(entity_id, (db) => db.query(
        `SELECT sectors FROM entity_profile WHERE entity_id = $1`, [entity_id]));
      const row = p.rows[0] || {};
      sectors = row.sectors || [];
    }
    if (item_ids.length) {
      const r = await withEntity(entity_id, (db) => db.query(
        `SELECT item_id, item_data->'batch_tracked' AS flag FROM catalogue_items
          WHERE entity_id = $1 AND item_id = ANY($2::uuid[])`, [entity_id, item_ids]));
      for (const x of r.rows) if (x.flag !== null && x.flag !== undefined) flags.set(String(x.item_id), x.flag === true);
    }
  } catch (_) { sectors = sectors || []; }

  const out = new Map();
  for (const id of item_ids) {
    const item = flags.has(id) ? { item_data: { batch_tracked: flags.get(id) } } : {};
    out.set(id, lotfields.tracksBatch({ sectors, item }).tracked);
  }
  return out;
}

/**
 * ⭐ POST THEM. Idempotent through the store — the unique index on (entity, ref, line_ref, reason, lot) means a
 * replayed bill moves nothing, which matters because replaying is what the counter's queue does for a living.
 *
 * ⚠️⚠️ IT NEVER THROWS, AND THAT IS A TRADE, NOT A CONVENIENCE. It runs after the chit is committed, so a failure
 * here must not take down a sale that has already happened. The cost of that choice is that a failed movement is
 * lost until somebody notices — survivable ONLY because the movements are re-derivable from the chit at any time
 * (this same function, same ref, same idempotency), so a backfill can heal it. Say so, log it, and do not
 * pretend the gap is not there.
 */
async function postFor(entity_id, chit, withEntity, opts) {
  const wanted = movementsFor(chit);
  if (!wanted.length) return { moved: 0, skipped: [], failed: [], duplicate: 0, short: [] };
  const result = { moved: 0, skipped: [], failed: [], duplicate: 0, short: [] };

  /**
   * ⭐⭐⭐ HAVE THESE GOODS ALREADY LEFT? Asked ONCE per despatch, not per line.
   *
   * A despatch against an order whose goods already went out on a counter bill would take the same stock out a
   * second time — silently, and into an append-only log that cannot be edited afterwards. The order's own
   * document number is what a counter bill stamps as the movement ref, so one lookup settles it.
   *
   * ⚠️ IT FAILS TOWARDS POSTING. If the order cannot be read, the movement is written rather than skipped: a
   * missing movement is invisible until a count months later, while a doubled one shows up as stock that does
   * not exist and gets found. Neither is good; one is findable.
   */
  const gone = await alreadyGone(entity_id, wanted, withEntity);
  if (gone) return { moved: 0, skipped: [], failed: [], duplicate: 0, short: [],
                     why: 'these goods already left on ' + gone };

  const ids = [...new Set(wanted.filter((m) => !m.skip).map((m) => m.item_id))];
  const tracked = await trackingFor(entity_id, ids, withEntity, opts);

  for (const mv of wanted) {
    if (mv.skip) { result.skipped.push(mv); continue; }
    mv.tracked = tracked.get(mv.item_id) === true;
    try {
      /**
       * ⭐⭐ OUT GOES THROUGH issue(), IN GOES THROUGH post(). A sale of tracked stock has no batch on it — the
       * till does not show stock and so cannot pick one — so the server picks by FEFO and may split the line
       * across batches. A receipt always names its batch, because goods-in asked for it.
       */
      const out = inventoryDirection(mv.reason);
      const r = out === 'out' ? await store.issue(entity_id, mv, withEntity, opts)
                              : await store.post(entity_id, mv, withEntity, opts);
      if (!r.ok) { result.failed.push({ line_ref: mv.line_ref, why: r.why }); continue; }
      result.moved += (r.moved != null ? r.moved : (r.duplicate ? 0 : 1));
      result.duplicate += (r.duplicate === true ? 1 : (r.duplicate || 0));
      /* ⚠️ A SHORT PICK IS REPORTED. It means the shelf and the record disagree, which is a thing to go and count
         — not an error, and never a reason to have refused the sale. */
      if (r.short) result.short.push({ line_ref: mv.line_ref, item_id: mv.item_id, by: r.short });
    } catch (e) {
      result.failed.push({ line_ref: mv.line_ref, why: String(e && e.message) });
    }
  }
  return result;
}

/**
 * ⚠️ THE ORDER'S OWN NUMBER IS THE KEY, because that is what a counter bill stamps on its movements. Returns the
 * document number the goods already left on, or null when they have not.
 */
async function alreadyGone(entity_id, wanted, withEntity) {
  const against = (wanted.find((m) => m && m.against) || {}).against;
  if (!against) return null;
  try {
    const o = await withEntity(entity_id, (db) => db.query(
      `SELECT business_json->>'client_ref' AS ref, business_json->>'bill_no' AS bill
         FROM chit_header WHERE entity_id = $1 AND chit_id = $2`, [entity_id, against]));
    const refs = [o.rows[0] && o.rows[0].ref, o.rows[0] && o.rows[0].bill].filter(Boolean);
    if (!refs.length) return null;
    const m = await withEntity(entity_id, (db) => db.query(
      `SELECT ref FROM stock_movement
        WHERE entity_id = $1 AND reason = 'sale' AND ref = ANY($2::text[]) LIMIT 1`, [entity_id, refs]));
    return m.rows[0] ? m.rows[0].ref : null;
  } catch (_) { return null; }   /* cannot tell → post it; a doubled movement is findable, a missing one is not */
}

/** ⚠️ asked of the ENGINE's own table, so a reason added there cannot be mis-routed here */
function inventoryDirection(reason) {
  const r = require('./inventory').REASONS[reason];
  return r ? r.dir : null;
}

module.exports = { movementsFor, postFor, itemIdOf, rateOf, trackingFor };
