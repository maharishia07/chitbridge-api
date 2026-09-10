/**
 * ── lib/inventory.js · WHAT A MOVEMENT DOES TO A BALANCE ───────────────────────────────────────────────────────
 *
 * Athi, 2026-09-10: *"weighted average first, one location, till doesn't show stock in v1."* The design note is
 * `C:\dev\INVENTORY-LIFECYCLE.md`; this is the pure half of it — the arithmetic and the vocabulary, no database.
 *
 * ⭐⭐ PERPETUAL INVENTORY, WEIGHTED AVERAGE, per **Ind AS 2 / IAS 2**. Two things that standard settles and we do
 * not get to re-decide:
 *   · **LIFO is prohibited in India.** FIFO or weighted average, nothing else — which is why the method is a flag
 *     with two values rather than a free choice, and why it sits beside `country` rather than beside a preference.
 *   · **Refundable tax is not inventory cost.** GST claimable as ITC never enters `rate` here. Goods-in already
 *     records it separately and RCV-07 asserts it stays out of the landed cost; that turned out to be the
 *     accounting standard rather than merely good sense.
 *
 * ⚠️ NOTHING HERE TOUCHES A DATABASE, so the counter can run it offline and the server can run it again on the
 * same movement and land in the same place. `lib/stock-store.js` is the half that knows where a balance is kept.
 */
(function (root) {

  function num(v) { var n = Number(v); return isFinite(n) ? n : null; }
  /** ⚠️ QUANTITY IS 3 DECIMALS, MONEY IS 2 — 0.125 kg is a real sale and rounding it to 0.13 is a wrong bill. */
  function q3(n) { return Math.round((Number(n) || 0) * 1000) / 1000; }
  function m2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

  /**
   * ── ⭐⭐⭐ WHY THE STOCK MOVED ─────────────────────────────────────────────────────────────────────────────────
   *
   * The single highest-value cheap thing in this whole subject. A quantity that left is not information; *why* it
   * left is. Without reason codes, shrinkage is invisible — the stock is simply wrong and nobody can say when it
   * started. With them, "₹8,400 written off as expired in July" is a number a shopkeeper can act on.
   *
   *   dir       'in' · 'out' · 'either' (a count can go both ways) · 'value' (money moves, quantity does not)
   *   rate      'required' — an inbound movement with no cost price cannot be valued, so it is refused
   *   shrink    true = this is LOSS. Separated because "what did we lose this month" is the question that pays
   *             for the feature, and it must not be answerable only by listing what a sale is not.
   */
  var REASONS = {
    opening:         { dir: 'in',     rate: 'required', says: 'opening stock' },
    purchase:        { dir: 'in',     rate: 'required', says: 'received from a supplier' },
    sale_return:     { dir: 'in',                       says: 'a customer brought it back' },
    purchase_return: { dir: 'out',                      says: 'sent back to the supplier' },
    sale:            { dir: 'out',                      says: 'sold' },
    damage:          { dir: 'out',    shrink: true,     says: 'damaged' },
    expiry:          { dir: 'out',    shrink: true,     says: 'past its date' },
    theft:           { dir: 'out',    shrink: true,     says: 'missing' },
    sample:          { dir: 'out',    shrink: true,     says: 'given away' },
    /* ⚠️ A COUNT NEVER OVERWRITES. It posts the DIFFERENCE, signed, so the history says a count happened and by
       how much it disagreed — an overwrite would erase the one fact worth keeping. */
    count_adjust:    { dir: 'either', shrink: true,     says: 'counted, and it disagreed' },
    /* Ind AS 2: lower of cost and net realisable value. Value falls, quantity does not move. */
    writedown:       { dir: 'value',                    says: 'written down to what it will fetch' },
  };
  function reasons() { return Object.keys(REASONS); }
  function isShrink(reason) { return !!(REASONS[reason] && REASONS[reason].shrink); }

  /**
   * ⚠️ A MOVEMENT IS CHECKED BEFORE IT IS APPLIED, and a refusal says which rule it broke. An unchecked movement
   * in an append-only log is permanent, and the balance it corrupts is only found weeks later at a count.
   *
   * ⚠️⚠️ TWO CONVENTIONS, AND CONFUSING THEM WAS A REAL BUG (caught by tests/stock-cycle before it shipped).
   *
   *   INPUT   a caller gives a POSITIVE quantity and the REASON decides the direction. `sale, qty: 5` removes 5.
   *   STORED  the log holds the SIGNED quantity, because a ledger you have to consult a lookup table to add up
   *           is not a ledger. `sale, qty: -5`.
   *
   * `replay()` reads stored rows and fed them back through the input rules, which promptly refused every sale for
   * having a negative quantity — so a rebuild computed a balance from the receipts alone. It failed loudly here
   * only because the rebuild test compares against the running balance; with no such test it would have looked
   * like working code and reported confident, wrong numbers.
   *
   * ⭐ THE LESSON IS GENERAL: validate input AT THE DOOR, not on the way back out of the database. Re-running an
   * input convention against stored data is checking the wrong thing. `stored: true` says "this row was already
   * validated when it was posted — take its sign as the fact it is."
   */
  function check(mv, opts) {
    var m = mv || {};
    var stored = !!(opts && opts.stored);
    var r = REASONS[m.reason];
    if (!r) return { ok: false, why: m.reason ? 'no such reason: ' + m.reason : 'a movement must say why' };
    var qty = num(m.qty);
    if (qty === null) return { ok: false, why: 'quantity must be a number' };

    if (r.dir === 'value') {
      if (q3(qty) !== 0) return { ok: false, why: 'a ' + m.reason + ' changes value, not quantity' };
      if (!(num(m.value_delta) < 0)) return { ok: false, why: 'a write-down must lower the value' };
      return { ok: true, why: null };
    }
    if (q3(qty) === 0) return { ok: false, why: 'a movement of nothing records nothing' };
    /* ⚠️ THE SIGN IS DERIVED FROM THE REASON, NEVER TRUSTED FROM THE CALLER. A sale that arrived with a positive
       quantity would otherwise ADD stock, and it would look exactly like an ordinary row. */
    if (!stored && r.dir === 'in'  && qty < 0) return { ok: false, why: m.reason + ' brings stock in; use a reason that takes stock out instead' };
    if (!stored && r.dir === 'out' && qty < 0) return { ok: false, why: m.reason + ' takes stock out; give the quantity as a positive number' };
    /**
     * ⚠️⚠️ `null >= 0` IS TRUE IN JAVASCRIPT. This was written as `!(num(m.rate) >= 0)`, and because a missing
     * rate returns null, that comparison said "yes, it has a rate" — so a purchase with no cost price sailed
     * through the one check that exists to stop it. Compare against null explicitly; never let a coercion decide
     * whether a value is present.
     */
    var rate = num(m.rate);
    if (r.rate === 'required' && (rate === null || rate < 0))
      return { ok: false, why: m.reason + ' needs a cost price — stock that comes in unvalued can never be valued later' };
    if (!m.item_id) return { ok: false, why: 'a movement must name a product' };
    return { ok: true, why: null };
  }

  /** the signed quantity a movement applies, worked out from the REASON so a caller cannot invert it */
  function signedQty(mv, opts) {
    var r = REASONS[mv && mv.reason]; if (!r) return 0;
    var qty = q3(num(mv.qty) || 0);
    if (r.dir === 'value') return 0;
    if (r.dir === 'either') return qty;                  /* a count is signed by whoever counted */
    /* a stored row already carries its sign; deriving it again is harmless but saying so keeps the two
       conventions visible at the one place that converts between them */
    if (opts && opts.stored) return qty;
    return r.dir === 'in' ? Math.abs(qty) : -Math.abs(qty);
  }

  /**
   * ── ⭐⭐ THE WEIGHTED AVERAGE ──────────────────────────────────────────────────────────────────────────────────
   *
   *   in   value += qty × rate ; qty += qty ; average = value ÷ qty
   *   out  value -= qty × average ; qty -= qty ; **average unchanged**
   *
   * That second line is the whole point of the method: issuing stock does not change what the remaining stock
   * cost. Only a receipt at a different price moves the average, which is why `rate` is required coming in and
   * meaningless going out.
   *
   * ⚠️⚠️ THREE EDGES, ALL OF WHICH HAPPEN IN A REAL SHOP:
   *  1. **Quantity reaches zero.** The average is then undefined — 0 ÷ 0. It KEEPS the last average rather than
   *     resetting to zero, because the next sale before the next delivery must still be valued at something, and
   *     "the last thing it cost" is the only honest answer available.
   *  2. **Quantity goes negative.** Allowed, on purpose (see the design note: an offline counter cannot know what
   *     is on the shelf, so it must never block a sale). Value goes negative with it and both correct themselves
   *     at the next receipt or count. Negative stock is a QUESTION, not corruption.
   *  3. **A receipt into negative stock.** The old value is negative, so a naive average comes out wrong or
   *     negative. When the balance was under water, the incoming rate simply BECOMES the average — there is no
   *     meaningful prior cost to blend with.
   */
  function apply(balance, mv, opts) {
    var b = balance || {};
    var qty0 = q3(num(b.qty) || 0), val0 = m2(num(b.value) || 0), avg0 = num(b.avg_cost) || 0;
    var ok = check(mv, opts);
    if (!ok.ok) return { ok: false, why: ok.why, qty: qty0, value: val0, avg_cost: avg0 };

    var r = REASONS[mv.reason];

    /**
     * ⚠️⚠️ ONE UNIT PER BALANCE, ENFORCED — added while wiring goods-in, where the real lines carry units.
     * A shop buys in cases and sells in pieces. Adding 5 to 60 because both are numbers is silently wrong
     * for ever, and no report would ever look odd enough to investigate.
     * ⭐ v1 REFUSES rather than converts, because a conversion needs a per-product factor and we do not have
     * one — and a wrong factor is worse than no factor. The refusal names BOTH units, so the person reading
     * it knows what to fix. The balance adopts the unit of its first movement and holds it thereafter.
     */
    var unit0 = b.unit || null, unit1 = mv.unit || null;
    if (unit0 && unit1 && String(unit0) !== String(unit1))
      return { ok: false, why: 'this stock is counted in ' + unit0 + ', and the movement is in ' + unit1
               + ' — there is no conversion between them, so it cannot be added',
               qty: qty0, value: val0, avg_cost: avg0, unit: unit0 };
    var unit = unit0 || unit1;

    if (r.dir === 'value') {
      var v1 = m2(val0 + (num(mv.value_delta) || 0));
      return { ok: true, why: null, qty: qty0, value: v1,
               avg_cost: qty0 > 0 ? m2(v1 / qty0) : avg0, moved: 0, unit: unit };
    }

    var d = signedQty(mv, opts);
    var qty1 = q3(qty0 + d), val1, avg1;

    if (d > 0) {
      var rate = num(mv.rate);
      /* an inbound with no rate is only reachable for reasons that do not require one (a sale return); it comes
         back in at what the shop currently reckons that stock costs, which is the average */
      if (rate === null) rate = avg0;
      if (qty0 <= 0) {
        /* edge 3 — nothing meaningful to blend with, so the incoming price IS the average from here */
        avg1 = m2(rate);
        val1 = m2(qty1 * avg1);
      } else {
        val1 = m2(val0 + d * rate);
        avg1 = qty1 > 0 ? m2(val1 / qty1) : avg0;       /* edge 1 */
      }
    } else {
      val1 = m2(val0 + d * avg0);                        /* out at the average — the average itself does not move */
      avg1 = avg0;
      if (qty1 === 0) val1 = 0;                          /* edge 1: no stock, no value, but the average is kept */
    }
    return { ok: true, why: null, qty: qty1, value: val1, avg_cost: avg1, moved: d, unit: unit };
  }

  /**
   * ⭐⭐ REPLAY — the balance is a cache, and this is what makes that claim checkable.
   * If a stored balance and the replay of its own movements disagree, THE LOG WINS. A consolidated number nobody
   * can rebuild is a number nobody can defend, so this ships with the feature rather than after it.
   * ⚠️ ORDER IS BY TIMESTAMP, NEVER BY ARRIVAL. Quantity is commutative and would not care; VALUE is not — a
   * receipt that syncs late from an offline counter changes the average of issues that were already valued.
   */
  function replay(movements, from) {
    var b = from || { qty: 0, value: 0, avg_cost: 0 };
    var rows = (Array.isArray(movements) ? movements : []).slice()
      .sort(function (a, z) { return String(a.at).localeCompare(String(z.at)); });
    var applied = 0, refused = [];
    rows.forEach(function (mv) {
      /* ⭐ stored:true — these rows came OUT of the log, so their sign is a fact, not a caller convention */
      var out = apply(b, mv, { stored: true });
      if (!out.ok) { refused.push({ mv: mv, why: out.why }); return; }
      b = { qty: out.qty, value: out.value, avg_cost: out.avg_cost };
      applied++;
    });
    return { qty: b.qty, value: b.value, avg_cost: b.avg_cost, applied: applied, refused: refused };
  }

  /** ⚠️ two balances agree only if BOTH the quantity and the money agree — one without the other is half an answer */
  function agrees(a, b) {
    return q3(a && a.qty) === q3(b && b.qty) && m2(a && a.value) === m2(b && b.value);
  }

  /**
   * ⭐ WHAT A SHOPKEEPER READS. Not a bare figure: what is there, what it is worth, and — the part they act on —
   * how old the number is. A quantity with no timestamp is a claim the device may not be able to support.
   */
  function says(balance, ctx) {
    var fmt = (ctx && typeof ctx.money === 'function') ? ctx.money : function (n) { return String(n); };
    var b = balance || {};
    var qty = q3(num(b.qty) || 0);
    var unit = b.unit ? ' ' + b.unit : '';
    if (qty < 0) return qty + unit + ' — less than nothing, so the shelf and the record disagree. Count it.';
    if (qty === 0) return 'none left';
    return qty + unit + ' · worth ' + fmt(m2(num(b.value) || 0))
         + (b.at ? ' · as at ' + String(b.at).slice(11, 16) : '');
  }

  var API = { REASONS: REASONS, reasons: reasons, isShrink: isShrink,
              check: check, signedQty: signedQty, apply: apply, replay: replay, agrees: agrees, says: says,
              q3: q3, m2: m2 };
  root.CBInventory = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;

})(typeof window !== 'undefined' ? window : this);
