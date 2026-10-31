/**
 * ── lib/stock-from-chit.js · WHICH CHITS MOVE STOCK, AND HOW ───────────────────────────────────────────────────
 * OWNS movementsFor · postFor · trackingFor · CALLED BY routes/chits.js (send) and the counter's bill path
 * FLOW chit → movementsFor (pure) → trackingFor (lib/stocked.flagsFor: the trade + both product flags, one query) → postFor      CARD 13-inventory-stock-and-traceability/on-hand-and-movements
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
const logger = require('./logger');
const stocked = require('./stocked'); /* R104: the ONE read of a product's stock flags (batch_tracked · stocked) and the trade's default */
const gs1 = require('./gs1'); /* lotOf — what a lot IS (batch · serial · expiry), one definition */

function num(v) {
  if (v === null || v === undefined || (typeof v === 'string' && v.trim() === '')) return null; /* RAIL-146c: Number(null) is 0 — a missing cost is no cost (a no_cost skip), never a free stock line */
  const n = Number(v);
  return isFinite(n) ? n : null;
}

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
  return String((line && line.line_id) || (d && d.line_id) || i + 1);
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
  return bare !== null && bare >= 0 ? bare : null;
}

/**
 * ⚠️⚠️ THE LOT IS AN OBJECT ON THE RECEIPT (T3-FIXES, STK-FIX1). Goods-in writes `item_data.lot = { batch, expiry, mrp, … }`
 * (the till's lotSet — the lotfields pack's own keys). Reading `d.lot` as the batch made every received batch ONE lot,
 * '[OBJECT OBJECT]' after lotKey, with no expiry (the date sat inside the object) — so FEFO and a recall saw one pool.
 * The batch is `lot.batch`, else `lot.serial` (a serial-tracked pack); the date is `lot.expiry`, else `lot.best_before`.
 * The object is normalised by gs1.lotOf (the one definition of a lot's shape, as lib/amend uses); a flat
 * `item_data.batch` / `expiry` (older chits) and a string `lot` are still read. Nothing here invents a batch.
 *
 * The shapes a line may carry, all read HERE and nowhere else (STK-FIX1b, 2026-10-14):
 *   item_data.lot = { batch, expiry, … }     the door's shape (lotSet / rcvAdd) — the common one; `serial` for a serial-tracked pack
 *   item_data.lot = "AC2431"                   a bare batch code; expiry then from item_data.expiry / expires_at
 *   item_data.lot = "(10)AC2431(17)280331"     the typed/scanned GS1 form — gs1.parseElementString reads (10) and (17)
 *   item_data.batch / item_data.expiry         the flat older shape
 *
 * ⚠️⚠️ A BATCH THAT CANNOT BE READ IS REFUSED, WITH A SENTENCE AND A CODE — never stored as a guess (STK-FIX1b). Before this,
 * `{ batch: { no: 'X' } }` fell through gs1.lotOf as "nothing said" and the line went in as untracked POOL stock — a guess,
 * stored. Refused: a lot that is not an object (an array, a boolean), a batch or serial that is itself an object, a code
 * gs1.lotOf cannot accept (over 20 characters, control characters), an expiry or best-before that is not YYYY-MM-DD —
 * a wrong date is worse than an absent one. A line that says NOTHING about a lot is not an error: untracked stock, lot ''.
 * The sentence is for the log and the counter; the CODE is what a caller branches on (the 14 Oct standards review).
 *
 * → { lot: 'AC2431' | null, expires_at: 'YYYY-MM-DD' | null }  ·  { refuse: <sentence>, code: 'batch_unreadable' | 'expiry_unreadable' }
 */
function lotOf(line) {
  const d = (line && line.item_data) || {};
  const said = (v) => v != null && String(v).trim() !== '';
  const flatExpiry = said(d.expiry) ? d.expiry : said(d.expires_at) ? d.expires_at : null;
  let src = d.lot;
  if (src == null || src === '') {
    src = said(d.batch) || flatExpiry != null || said(d.best_before) ? { batch: d.batch, expiry: flatExpiry, best_before: d.best_before } : null;
  }
  if (src == null) return { lot: null, expires_at: null };
  if (typeof src === 'string' || typeof src === 'number') {
    const s = String(src).trim();
    if (!s) return { lot: null, expires_at: null };
    const typed = s.indexOf('(') >= 0 ? gs1.parseElementString(s) : null;
    src = typed ? Object.assign({ expiry: flatExpiry }, typed) : { batch: s, expiry: flatExpiry };
  }
  if (typeof src !== 'object' || Array.isArray(src)) return refuse('batch');
  const batch = src.batch != null ? src.batch : src.batch_no;
  const serial = src.serial;
  const expiry = src.expiry != null ? src.expiry : src.expiry_date;
  if ((batch != null && typeof batch === 'object') || (serial != null && typeof serial === 'object')) return refuse('batch');
  const l = gs1.lotOf(src) || {};
  if (said(batch) && !l.batch) return refuse('batch');
  if (said(serial) && !l.serial) return refuse('batch');
  if (said(expiry) && !l.expiry) return refuse('expiry');
  if (said(src.best_before) && !l.best_before) return refuse('expiry');
  return { lot: l.batch || l.serial || null, expires_at: l.expiry || l.best_before || null };
}
function refuse(what) {
  return what === 'batch'
    ? { refuse: 'the batch cannot be read — up to 20 printed characters, as on the pack. Not received into stock', code: 'batch_unreadable' }
    : { refuse: 'the expiry is not a date (YYYY-MM-DD). Not received into stock', code: 'expiry_unreadable' };
}

/**
 * chit → the movements it implies. Returns [] for the great majority of chits, which is the point.
 *   { chit_id, purpose, is_draft, business_json, line_items, created_at }
 */
function movementsFor(chit, opt) {
  const c = chit || {};
  const useOf = opt && typeof opt.useOf === 'function' ? opt.useOf : null; /* a receipt against a bill I bought — usesForReceipt */
  if (c.is_draft) return [];
  const bj = c.business_json || {};
  const purpose = String(c.purpose || '');
  const lines = Array.isArray(c.line_items) ? c.line_items : [];
  if (!lines.length) return [];

  let reason = null,
    against = null;
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
  /**
   * ⭐⭐ A RETURN PUTS IT BACK (2026-09-18). 'sale_return' has been in the REASONS table since b214 and allowed
   * by the CHECK constraint since b217 — and nothing in the whole codebase ever wrote one. The vocabulary
   * existed, the path did not, so a counter that took goods back moved no stock at all.
   * ⚠️ NO RATE IS REQUIRED on a sale return, which is deliberate in lib/inventory: what a customer brings back
   * re-enters at what it left at, and inventing a fresh rate here would quietly revalue the shelf.
   * ⚠️ ITS OWN 'ref' IS THE CREDIT-NOTE NUMBER, not the original bill's. The idempotency index is
   * (entity_id, ref, line_ref, reason) — two partial returns of one line share a line_ref, so sharing the ref
   * as well would silently dedupe the second one away.
   */
  else if (purpose === 'credit_note' || bj.doc === 'credit_note') reason = 'sale_return';
  else return [];

  /* the document's own number — the SAME client_ref the chit deduped on, which is what makes a replay harmless */
  const ref = String(bj.client_ref || bj.bill_no || bj.doc_no || c.chit_id || '').slice(0, 64);
  if (!ref) return [];
  const at = c.created_at || bj.billed_at || bj.doc_at || null;

  const out = [];
  lines.forEach((item, index) => {
    const item_id = itemIdOf(item);
    const qty = num(item && item.quantity);
    /* ⚠️ A LINE WITH NO PRODUCT ID CANNOT MOVE STOCK. A free-text line ("labour", "delivery") is a real thing to
       bill for and not a thing on a shelf, so it is skipped rather than refused — but see `skipped` below: it is
       counted and reported, because "half the lines silently did nothing" is how this feature would rot. */
    if (!item_id || qty === null || qty <= 0) return;
    /**
     * ⚠️ THE BATCH AND ITS DATE COME OFF THE RECEIPT, where goods-in already captured them — lotfields decides
     * what a vertical must ask for, the screen asks, and this reads what it got. Nothing here invents a batch.
     * The date is what FEFO sorts on, so a receipt that carried one must not lose it here.
     * ⚠️ Each line is ITS OWN lot: two batch lines of one receipt are two movements under two keys. A line whose
     * batch or expiry cannot be read is REFUSED here (a named skip with its code) — the rest of the chit still posts.
     */
    const line_ref = lineRefOf(item, index);
    const read = lotOf(item);
    if (read.refuse) {
      out.push({ skip: true, item_id, line_ref, why: read.refuse, code: read.code });
      return;
    }
    const mv = {
      item_id,
      reason,
      qty,
      unit: (item && item.unit) || null,
      ref,
      line_ref,
      at,
      against,
      lot: read.lot,
      expires_at: read.expires_at,
      note: item && item.particulars ? String(item.particulars).slice(0, 120) : null
    };
    if (reason === 'purchase' && useOf && useOf(item) !== 'resale') {
      out.push({
        skip: true,
        item_id,
        line_ref: mv.line_ref,
        code: useOf(item) === 'asset' ? 'not_stock_asset' : 'not_stock_use',
        why:
          useOf(item) === 'asset'
            ? 'an asset, not stock — received, not put on the shelf'
            : "for the shop's own use, not stock — received, not put on the shelf"
      });
      return;
    }
    if (reason === 'purchase') {
      const rate = rateOf(item);
      /* ⚠️ NO COST PRICE, NO RECEIPT. The engine would refuse it anyway; catching it here means the reason can
         name the line rather than arriving as a bare validation failure from three layers down. */
      if (rate === null) {
        out.push({ skip: true, item_id, line_ref: mv.line_ref, code: 'no_cost', why: 'no cost price on this line, so the stock cannot be valued' });
        return;
      }
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
 * ⭐⭐ WHICH OF THESE PRODUCTS KEEP THEIR STOCK PER BATCH, AND WHICH ARE COUNTED AT ALL — asked ONCE for the whole chit, not once per line.
 *
 * ⚠️ TWO QUERIES, NOT N+1. A bill with thirty lines would otherwise be thirty round trips to Mumbai on the
 * hottest path in the product, and this runs on every send. The trade is one trip; the per-product flags are one
 * query over the ids the chit actually names — and since R104 that ONE query carries both flags (lib/stocked.flagsFor:
 * `batch_tracked` and `stocked`), so "made to order" costs no second read and no second pass over the lines.
 * ⚠️ AND IT FAILS SAFE TOWARDS "NOT TRACKED" AND "COUNTED". If the profile cannot be read, stock is kept as one pool rather
 * than refused for want of a batch number — a shop must not stop being able to record a delivery because a
 * lookup failed, and an untracked balance can be split later, whereas a refused receipt is simply lost.
 * → Map(item_id → { tracked, counted })
 */
async function trackingFor(entity_id, item_ids, withEntity, opts) {
  /* VERT-1: the shop's trade from THE resolver (govresolve.verticalOf, inside flagsFor); a caller's own sectors still win (tests, a known profile) */
  return (await stocked.flagsFor(entity_id, item_ids, withEntity, opts)).by;
}

/**
 * R104: why this movement is not posted — the line's own skip (free text, own use, no cost, an unreadable batch), or `not_stocked`:
 * a dish cooked to order is sold, not taken off a shelf. A NAMED skip, same shape as `not_stock_use`, counted in result.skipped; null = post it.
 */
function skipOf(movement, flags) {
  if (movement.skip) return movement;
  const flag = flags.get(movement.item_id);
  if (!flag || flag.counted !== false) return null;
  return { skip: true, item_id: movement.item_id, line_ref: movement.line_ref, code: 'not_stocked', why: 'not counted as stock (made to order), so this line moves nothing' };
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
/**
 * ⭐⭐ ONLY GOODS FOR RESALE GO ON THE SHELF (Athi, 2026-10-01 — lib/bill-use). A receipt counted in against a bill I bought
 * names that bill (`against.chit_id`) and each line the bill's line (`item_data.line_id`). What the buyer said the goods are
 * for is on MY copy of that bill (business_json.use): a line for the shop's own use, or an asset, is received but never
 * stock. Nothing chosen = resale — a receipt line already carries one of MY products (item_id), which is the catalogue's
 * own answer. One read, only for a receipt against something; unreadable → resale (a missing movement is invisible, a
 * spare one is found at the next count — the same posture as alreadyGone).
 * → (line) → 'resale' | 'use' | 'asset'
 */
async function usesForReceipt(entity_id, chit, withEntity) {
  const bj = (chit && chit.business_json) || {};
  const against = bj.against && bj.against.chit_id;
  const isReceipt = String((chit && chit.purpose) || '') === 'receipt' || bj.doc === 'receipt';
  if (!isReceipt || !against) return null;
  let chosen = null;
  try {
    const r = await withEntity(entity_id, (db) =>
      db.query(`SELECT business_json->'use' AS use FROM chit_header WHERE entity_id = $1 AND chit_id = $2`, [entity_id, against])
    );
    chosen = require('./bill-use').chosenOf({ use: r.rows[0] && r.rows[0].use });
  } catch (e) {
    logger.fellBack('stock-from-chit usesForReceipt: the read failed — answered with nothing', e);
    return null;
  }
  if (!chosen.bill && !Object.keys(chosen.lines).length) return null;
  return (line) => {
    const id = line && ((line.item_data && line.item_data.line_id) || line.line_id);
    return (id && chosen.lines[String(id)]) || chosen.bill || 'resale';
  };
}

async function postFor(entity_id, chit, withEntity, opts) {
  const useOf = await usesForReceipt(entity_id, chit, withEntity);
  return postMovements(entity_id, movementsFor(chit, useOf ? { useOf } : null), withEntity, opts);
}

/**
 * ⭐ THE ONE POST LOOP (OPS-5): the movements a chit implies (postFor) and the movements a counted-in bill implies
 * (lib/delivered-stock) both go through here — the guard, the flags, the store — so there is one posting path, not two.
 */
async function postMovements(entity_id, wanted, withEntity, opts) {
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
  if (gone) return { moved: 0, skipped: [], failed: [], duplicate: 0, short: [], why: 'these goods already left on ' + gone };

  const ids = [...new Set(wanted.filter((item) => !item.skip).map((item) => item.item_id))];
  const flags = await trackingFor(entity_id, ids, withEntity, opts);

  for (const mv of wanted) {
    /* R104: a dish cooked to order is skipped BY NAME (not_stocked), never silently — sendStock logs result.skipped */
    const skip = skipOf(mv, flags);
    if (skip) {
      result.skipped.push(skip);
      continue;
    }
    mv.tracked = flags.get(mv.item_id).tracked === true; /* every posted id has its answer: trackingFor answers each id it was asked */
    try {
      /**
       * ⭐⭐ OUT GOES THROUGH issue(), IN GOES THROUGH post(). A sale of tracked stock has no batch on it — the
       * till does not show stock and so cannot pick one — so the server picks by FEFO and may split the line
       * across batches. A receipt always names its batch, because goods-in asked for it.
       */
      const out = inventoryDirection(mv.reason);
      const r = out === 'out' ? await store.issue(entity_id, mv, withEntity, opts) : await store.post(entity_id, mv, withEntity, opts);
      if (!r.ok) {
        result.failed.push({ line_ref: mv.line_ref, why: r.why });
        continue;
      }
      result.moved += r.moved != null ? r.moved : r.duplicate ? 0 : 1;
      result.duplicate += r.duplicate === true ? 1 : r.duplicate || 0;
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
  const against = (wanted.find((item) => item && item.against) || {}).against;
  if (!against) return null;
  try {
    const o = await withEntity(entity_id, (db) =>
      db.query(
        `SELECT business_json->>'client_ref' AS ref, business_json->>'bill_no' AS bill
         FROM chit_header WHERE entity_id = $1 AND chit_id = $2`,
        [entity_id, against]
      )
    );
    const refs = [o.rows[0] && o.rows[0].ref, o.rows[0] && o.rows[0].bill].filter(Boolean);
    if (!refs.length) return null;
    const m = await withEntity(entity_id, (db) =>
      db.query(
        `SELECT ref FROM stock_movement
        WHERE entity_id = $1 AND reason = 'sale' AND ref = ANY($2::text[]) LIMIT 1`,
        [entity_id, refs]
      )
    );
    return m.rows[0] ? m.rows[0].ref : null;
  } catch (e) {
    logger.fellBack('stock-from-chit alreadyGone: the read failed — answered with nothing', e);
    return null;
  } /* cannot tell → post it; a doubled movement is findable, a missing one is not */
}

/** ⚠️ asked of the ENGINE's own table, so a reason added there cannot be mis-routed here */
function inventoryDirection(reason) {
  const r = require('./inventory').REASONS[reason];
  return r ? r.dir : null;
}

// ═══ OPS-5 (ST-19) · GOODS COUNTED IN AGAINST A SUPPLIER BILL I RECEIVED GO ON THE SHELF ═══════════════════════════
// WHY: a supplier's invoice is `purpose invoice`, so stock-from-chit.movementsFor reads it as nothing, and deliver-lines wrote only
// chit_line_delivery. Counting a bill in therefore never reached stock (the 18 Oct walk: PO → bill → goods in 50+30, stock unchanged).
// ⭐ DERIVED FROM THE STORED ROWS, NOT THE REQUEST: the ref is 'GI:' + delivery_id, so a replay, a lost post and an app retry all
// post the same movement once (the stock index is entity · ref · line_ref · reason · lot). Only kind 'deliver' — an 'add' is a charge, not goods.
// ⚠️ ONLY AN EXACT OR SYNONYM MATCH to MY catalogue: the supplier's own item_id is theirs and is ignored, and a fuzzy match would put
// permanent, append-only stock on a possibly wrong product. No match → a named skip `item_unmatched`.
// ⚠️ NOT TWICE: a receipt I already raised against this bill moved the goods (the existing path) → every row is skipped `already_received`.
// The reverse order (a receipt raised AFTER the bill was counted in) is not guarded here.
// ⚠️ A TAKE-BACK (quantity below zero) is a named skip `take_back_not_posted`; the shelf is corrected at the next count.
// OWNS  movementsForDelivered · postDelivered (called by lib/deliverline.js record, a delivery on a bill's private copy)
const NOT_STOCK = {
  asset: { code: 'not_stock_asset', says: 'an asset, not stock — counted in, not put on the shelf' },
  use: { code: 'not_stock_use', says: "for the shop's own use, not stock — counted in, not put on the shelf" }
};
const skipDelivered = (row, code, reason) => ({ skip: true, item_id: null, line_ref: String(row.line_id), code, why: reason });

/** a refusal sentence for a row that is not goods for the shelf, or null when it is: a receipt already moved them, no line, a take-back, not resale */
function notGoods(row, context) {
  const quantity = Number(row.quantity);
  if (context.received) return skipDelivered(row, 'already_received', 'a receipt against this bill already put these goods on the shelf');
  if (!context.lineOf.get(String(row.line_id))) return skipDelivered(row, 'no_line', 'the line is not on this bill any more');
  if (!(quantity > 0)) return skipDelivered(row, 'take_back_not_posted', 'a take-back is not posted to stock; correct the shelf at the next count');
  const useWord = context.useOf.get(String(row.line_id));
  if (useWord === 'resale') return null;
  const named = useWord === 'asset' ? NOT_STOCK.asset : NOT_STOCK.use;
  return skipDelivered(row, named.code, named.says);
}

/** MY product for a bill line: an exact or synonym match of its name only (never the supplier's item_id, never a fuzzy guess), else null */
function myItemOf(line, catalogue) {
  const found = require('./itemmatch').match(String(line.particulars || line.name || '').trim(), '', catalogue);
  const sure = found && found.item && !found.unmatched && !found.ambiguous && (found.how === 'exact' || found.how === 'synonym');
  return sure ? String(found.item.item_id) : null;
}

/** what one stored delivery row implies: a movement, or a named skip */
function oneRow(row, context) {
  const refused = notGoods(row, context);
  if (refused) return refused;
  const line = context.lineOf.get(String(row.line_id));
  const itemId = myItemOf(line, context.catalogue);
  if (!itemId) return skipDelivered(row, 'item_unmatched', 'the line is not one of your products by name, so it was not put on the shelf');
  const rate = rateOf(line);
  if (rate === null) return skipDelivered(row, 'no_cost', 'no cost price on this line, so the stock cannot be valued');
  const batch = lotOf(line);
  if (batch.refuse) return skipDelivered(row, batch.code, batch.refuse);
  return {
    item_id: itemId,
    reason: 'purchase',
    qty: Number(row.quantity),
    unit: row.unit || line.unit || null,
    rate,
    ref: 'GI:' + row.delivery_id,
    line_ref: String(row.line_id),
    at: row.delivered_at || null,
    against: null,
    lot: batch.lot,
    expires_at: batch.expires_at,
    note: line.particulars ? String(line.particulars).slice(0, 120) : null
  };
}

/**
 * movementsForDelivered({ copy, rows, catalogue, received }) → the movements and skips for the stored delivery rows of one bill.
 * copy is my copy (line_items, business_json); catalogue is mine; received is true when a receipt already moved the goods.
 */
function movementsForDelivered({ copy, rows, catalogue, received }) {
  const billUse = require('./bill-use').effective(copy, catalogue);
  const context = {
    catalogue,
    received: !!received,
    lineOf: new Map((copy.line_items || []).filter((item) => item && item.line_id).map((item) => [String(item.line_id), item])),
    useOf: new Map(billUse.lines.map((item) => [String(item.line_id), item.use]))
  };
  return (rows || []).map((row) => oneRow(row, context));
}

/** the stored goods-in rows of this bill on my copy (kind deliver only) */
function deliveriesOf(db, entity_id, chit_id) {
  return db
    .query(
      `SELECT delivery_id::text AS delivery_id, line_id::text AS line_id, quantity, unit, delivered_at
         FROM chit_line_delivery WHERE entity_id = $1 AND chit_id = $2 AND kind = 'deliver' ORDER BY created_at`,
      [entity_id, chit_id]
    )
    .then((reply) => reply.rows);
}

/** has a receipt of mine against this bill been raised? (it posts its own movements) */
function receiptExists(db, entity_id, chit_id) {
  return db
    .query(
      `SELECT 1 FROM chit_header WHERE entity_id = $1 AND business_json #>> '{against,chit_id}' = $2
          AND (purpose = 'receipt' OR business_json ->> 'doc' = 'receipt') AND role <> 'Draft' LIMIT 1`,
      [entity_id, String(chit_id)]
    )
    .then((reply) => reply.rows.length > 0);
}

/** the reads, on one handle; tests hand in their own */
async function readDelivered(entity_id, chit_id) {
  const { withEntity } = require('../db');
  const copy = await require('./tax-copy').copyOf(chit_id, entity_id);
  if (!copy) return null;
  return withEntity(entity_id, async (db) => ({
    copy,
    rows: await deliveriesOf(db, entity_id, chit_id),
    received: await receiptExists(db, entity_id, chit_id),
    catalogue: await require('./itemmatch').loadCatalogue(entity_id, { strict: true })
  }));
}

/**
 * postDelivered(entity_id, chit_id, opts, deps) → the post reply { moved, skipped, failed, duplicate, short }. NEVER THROWS: the delivery
 * has already been recorded and must stand; a failed read says `catalogue_unread` (stock pending) in `failed`, and it is logged.
 * deps: { readDelivered, post } — the reads and the posting; the defaults are the real ones.
 */
async function postDelivered(entity_id, chit_id, opts, deps) {
  const given = deps || {};
  const empty = { moved: 0, skipped: [], failed: [], duplicate: 0, short: [] };
  try {
    const reads = await (given.readDelivered || readDelivered)(entity_id, chit_id);
    if (!reads || !reads.rows.length) return empty;
    const post = given.post || module.exports.postMovements; /* looked up at call time, so a test can stand in the store */
    return await post(entity_id, movementsForDelivered(reads), given.withEntity || require('../db').withEntity, opts);
  } catch (e) {
    logger.fellBack('delivered-stock postDelivered: the goods were counted in; their stock post failed — pending', e);
    return { ...empty, failed: [{ line_ref: null, why: 'stock_pending: ' + String(e && e.message) }] };
  }
}

module.exports = { movementsForDelivered, postDelivered };

module.exports = { movementsFor, postFor, postMovements, movementsForDelivered, postDelivered, usesForReceipt, itemIdOf, rateOf, lotOf, trackingFor };
