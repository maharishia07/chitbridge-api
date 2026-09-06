/* app/offers.js — OFFERS AS A SUBJECT OF THEIR OWN.  (classic script, shared global scope)
 *
 * Athi, 2026-08-15: *"there are different type of offers run in different industry, some where product range,
 * price range, plus offer, discount above certain amount and so on, if we think offer is a seperate subject, we
 * can keep it as a js and see how we can call it, similarly tax etc."*
 *
 * He is right, and the reason is structural rather than tidiness: an offer is not a property of a cart, it is a
 * TERM OF TRADE. It has an author, a validity window, a jurisdiction, and it must survive into a dispute intact.
 * Baking "10% off above ₹5,000" into cart-ui would make the cart the authority on commercial policy, which it is
 * not — the same mistake as a screen owning a quantity rule.
 *
 * ── ⚠️⚠️ WHAT THIS FILE MUST NEVER DO ────────────────────────────────────────────────────────────────────────────
 * IT NEVER MUTATES A CART, A LINE, OR A PRICE. `evaluate()` is a pure function: catalogue + lines + context in, a
 * BREAKDOWN out. The caller decides what to do with it. That is what lets the same engine run in the cart, on the
 * storefront, in a quote, and again at seal time months later — and get the same answer.
 *
 * ── ⭐ EVERY ADJUSTMENT MUST EXPLAIN ITSELF ──────────────────────────────────────────────────────────────────────
 * This is the CB-specific requirement and it outranks every feature below. Disputes are the product's USP. When
 * someone asks "why was this ₹7,950 and not ₹8,400?" six months later, the answer cannot be "the engine decided".
 * So every adjustment carries: which offer, which rule fired, what the input was, and what it produced. An offer
 * engine that cannot say WHY is unusable here, however clever its arithmetic.
 *
 * ── ⚠️ NEVER APPLY WHAT WAS NOT EARNED, NEVER SILENTLY IMPROVE ───────────────────────────────────────────────────
 * cart-ui's models refuse rather than round up, because quietly ordering more than someone asked for costs them
 * money. The mirror rule here: never apply an offer whose conditions are not met, and never quietly give a better
 * price than the terms state. A surprise discount is a pricing error that happens to be pleasant, and it is still
 * a number nobody can defend in a dispute.
 *
 * ── THE VOCABULARY IS ADOPTED, NOT INVENTED ──────────────────────────────────────────────────────────────────────
 * Scopes (line / cart / shipping), predicate conditions, stacking order and exclusivity, and validity windows are
 * the standard commerce-platform model (commercetools' pricing & promotions capability, Voucherify's promotion
 * taxonomy). Using their words means a person who has run promotions elsewhere already knows what these mean, and
 * a future integration maps rather than translates.
 *
 * ── ⭐ WIRED. evaluate() is called by the cart (catalogue-ui.offersHTML) and by compose; promise()/forLine()
 * which screen calls it, and whether an offer is frozen at seal, is Athi's decision. See SPEC-offers-tax.md.
 */
(function (root) {
  'use strict';

  var R2 = function (n) { return Math.round((Number(n) || 0) * 100) / 100; };

  /* ════════════════════════════════════════════════════════════════════════════════════════════════════════════
   *  KINDS — one registry, the way cart-ui registers order models. The CATALOGUE DECLARES, the engine EVALUATES.
   * ════════════════════════════════════════════════════════════════════════════════════════════════════════════
   * Each kind is { scope, apply(ctx) -> [adjustment] }. An adjustment is:
   *   { offer_id, label, kind, scope, target, amount, basis, why }
   * `amount` is always NEGATIVE for a reduction, so a total is a plain sum and nobody has to remember a sign.
   */
  var KINDS = {

    /** % off — the commonest thing in every industry. Scope decides whether it lands on a line or the cart. */
    percent_off: {
      scope: 'either',
      apply: function (o, ctx) {
        var pct = Number(o.percent) || 0;
        if (pct <= 0) return [];
        if (o.scope === 'cart') {
          var base = ctx.eligibleSubtotal;
          if (!base) return [];
          return [adj(o, 'cart', null, -R2(base * pct / 100),
            pct + '% off ' + ctx.money(base) + ' of eligible lines')];
        }
        return ctx.eligible.map(function (l) {
          return adj(o, 'line', l.key, -R2(l.gross * pct / 100),
            pct + '% off ' + ctx.money(l.gross));
        });
      }
    },

    /** A flat amount off. ⚠️ Capped at the base so a discount can never make a total negative. */
    amount_off: {
      scope: 'either',
      apply: function (o, ctx) {
        var amt = Number(o.amount) || 0;
        if (amt <= 0) return [];
        var base = o.scope === 'cart' ? ctx.eligibleSubtotal : null;
        if (o.scope === 'cart') {
          if (!base) return [];
          /* ⚠️ A flat ₹500 off a ₹300 order must not pay the customer ₹200. Capped, and the cap is REPORTED —
             a silently reduced discount is a number the customer cannot reconcile against the advertised offer. */
          var give = Math.min(amt, base);
          return [adj(o, 'cart', null, -R2(give),
            ctx.money(give) + ' off' + (give < amt ? ' (capped at the order value of ' + ctx.money(base) + ')' : ''))];
        }
        return ctx.eligible.map(function (l) {
          var g = Math.min(amt, l.gross);
          return adj(o, 'line', l.key, -R2(g),
            ctx.money(g) + ' off' + (g < amt ? ' (capped at the line value)' : ''));
        });
      }
    },

    /**
     * TIER PRICE — the quantity break. ⚠️ THE PRICE CHANGES, IT IS NOT A DISCOUNT OFF THE LIST PRICE, and the
     * difference matters: a tier is what the seller charges at that volume, so it is the price of record. Modelled
     * as an adjustment anyway so the breakdown shows the movement, with `basis:'price'` marking it as a re-price.
     */
    tier_price: {
      scope: 'line',
      apply: function (o, ctx) {
        var tiers = (o.tiers || []).slice().sort(function (a, b) { return (a.qty || 0) - (b.qty || 0); });
        if (!tiers.length) return [];
        return ctx.eligible.map(function (l) {
          var hit = null;
          for (var i = 0; i < tiers.length; i++) if (l.qty >= (tiers[i].qty || 0)) hit = tiers[i];
          if (!hit) return null;
          var was = l.unitPrice, now = tierPriceOf(hit, was);
          if (now == null) return null;
          if (!(now < was)) return null;          /* ⚠️ never silently RAISE a price from a tier table */
          /* ⭐ SAY THE PERCENTAGE (Athi, 2026-09-06 23:4x: "show 15% discount applied?") — stated when the slab was written as one, worked
             out from the two prices when it was written as a price, so the sentence reads the same either way. */
          var pct = hit.percent != null ? Number(hit.percent) : (was > 0 ? Math.round((1 - now / was) * 1000) / 10 : 0);
          var pctW = pct > 0 ? String(Math.round(pct * 10) / 10).replace(/.0$/, '') + '% off · ' : '';
          return adj(o, 'line', l.key, -R2((was - now) * l.qty),
            'qty ' + l.qty + ' reaches the ' + hit.qty + '+ tier · ' + pctW + ctx.money(was) + ' → ' + ctx.money(now) + ' each',
            'price');
        }).filter(Boolean);
      }
    },

    /**
     * THRESHOLD — "discount above a certain amount", exactly as Athi described. Spend or quantity, then a reward.
     * ⚠️ Reports the SHORTFALL when it does not fire, because "you are ₹300 away" is the single most useful thing
     * a cart can say, and it is information the engine already has and would otherwise throw away.
     */
    threshold: {
      scope: 'cart',
      apply: function (o, ctx) {
        var s = thresholdState(o, ctx);
        /* ⚠️ A THRESHOLD WITH NO THRESHOLD IS NOT "always on" — it is an unfinished offer, and it says so
           rather than firing on every basket or vanishing without a word. */
        if (!s.stated) return [note(o, 'no minimum stated — this offer is unfinished', 0)];
        if (!s.met) {
          var g = s.gaps[0], g2 = s.gaps[1];
          return [note(o, 'not yet — ' + thresholdGap(g, ctx.money)
            + (g2 ? ' (or ' + thresholdGap(g2, ctx.money) + ')' : ''), g.short)];
        }
        var met = s.by === 'qty'
          ? 'order of ' + s.have + ' item' + (s.have === 1 ? '' : 's') + ' meets the ' + s.minQ + '-item threshold'
          : 'order of ' + ctx.money(s.have) + ' meets the ' + ctx.money(s.minA) + ' threshold';
        /* ⭐ A REWARD ITEM ON A THRESHOLD ("spend ₹5,000, get a free 1 kg sugar"): the same claim shape as buy X get Y,
           so the screen can add it in one press. If the item is already in the basket its line is discounted instead. */
        if (o.get_item_id) {
          var rq = Number(o.get_qty) || 1, rpct = o.get_percent == null ? 100 : Number(o.get_percent);
          var rname = o.get_item_name || 'the reward item';
          var held = (ctx.all || []).filter(function (l) { return String(l.item_id) === String(o.get_item_id); });
          if (held.length) {
            var tk = Math.min(rq, held[0].qty);
            return [adj(o, 'line', held[0].key, -R2(held[0].unitPrice * tk * rpct / 100),
              tk + ' × ' + (rpct === 100 ? 'free' : rpct + '% off') + ' ' + rname + ' — ' + met)];
          }
          var rn = note(o, 'earned ' + rq + ' × ' + rname + ' ' + (rpct === 100 ? 'free' : 'at ' + rpct + '% off') + ' — ' + met, 0, o.get_item_id);
          rn.claim = { item_id: o.get_item_id, name: rname, qty: rq, percent: rpct, unitPrice: 0, offer_id: o.id || null, label: o.label || '' };
          return [rn];
        }
        if (o.percent) {
          return [adj(o, 'cart', null, -R2(ctx.eligibleSubtotal * Number(o.percent) / 100),
            o.percent + '% off — ' + met)];
        }
        var amt = Math.min(Number(o.amount) || 0, ctx.eligibleSubtotal);
        /* ⚠️ Met, but nothing to give. Silence here reads as "you did not qualify", which is the opposite. */
        if (!amt) return [note(o, 'threshold met, but no discount is stated on the offer', 0)];
        return [adj(o, 'cart', null, -R2(amt), ctx.money(amt) + ' off — ' + met)];
      }
    },

    /**
     * BUY X GET Y — "plus offer". Covers BOGO (x=1,y=1,free) and every "buy 3 pay for 2" variant.
     * ⚠️ THE CHEAPEST QUALIFYING UNITS ARE THE FREE ONES. That is the near-universal convention and, more to the
     * point, it is the one that cannot be accused of inflating the discount. Choosing the dearest would be
     * generous, undocumented, and impossible to defend when a counterparty recomputes it.
     */
    /** A bundle: named items together for one price. Complete sets only; the saving lands on the set's lines pro rata. */
    bundle_price: {
      scope: 'line',
      apply: function (o, ctx) {
        var ids = (Array.isArray(o.bundle_items) ? o.bundle_items : []).map(String).filter(Boolean);
        var price = Number(o.bundle_price) || 0;
        if (ids.length < 2 || price <= 0) return [note(o, 'a bundle needs two or more items and a price — this offer is unfinished', 0)];
        var held = ids.map(function (id) { return (ctx.all || []).filter(function (l) { return String(l.item_id) === id; })[0] || null; });
        var missing = ids.filter(function (id, i) { return !held[i]; });
        if (missing.length) return [note(o, 'not yet — the bundle needs ' + missing.length + ' more item' + (missing.length === 1 ? '' : 's') + ' in the order', missing.length)];
        var sets = Math.min.apply(null, held.map(function (l) { return Math.floor(l.qty); }));
        if (o.max_sets) sets = Math.min(sets, Number(o.max_sets));
        if (sets <= 0) return [];
        var sum = held.reduce(function (t, l) { return t + l.unitPrice; }, 0);
        var save = R2((sum - price) * sets);
        if (save <= 0) return [note(o, 'the bundle price is not below the items\' prices — nothing to give', 0)];
        var out = [], given = 0;
        held.forEach(function (l, i) {
          var share = (i === held.length - 1) ? R2(save - given) : R2(save * (l.unitPrice / (sum || 1)));
          given += share;
          out.push(adj(o, 'line', l.key, -share, (o.label || 'bundle') + ' — ' + sets + ' set' + (sets === 1 ? '' : 's') + ' at ' + ctx.money(price) + ' (saves ' + ctx.money(save) + ')', 'bundle'));
        });
        return out;
      }
    },

    buy_x_get_y: {
      scope: 'line',
      apply: function (o, ctx) {
        var x = Number(o.buy) || 0, y = Number(o.get) || 0;
        if (x <= 0 || y <= 0) return [];
        var pct = o.get_percent == null ? 100 : Number(o.get_percent);   // 100 = free

        /**
         * ── ⭐⭐ A DIFFERENT PRODUCT AS THE REWARD ────────────────────────────────────────────────────────
         *
         * Athi, 2026-09-03: *"include another item from the catalogue as an offer"* — "buy rice, get oil free".
         *
         * ⚠️ WITHOUT get_item_id THIS KIND CANNOT SAY THAT. The branch below takes free units from the
         * ELIGIBLE pool, so the reward has to be something that already qualified — "buy 3 of these, get 1 of
         * these free". A reward that is a DIFFERENT product is a different sentence, and it was not
         * expressible at all.
         *
         * ⚠️⚠️ AND HERE IS THE DECISION, WHICH IS NOT A TECHNICAL ONE: **the engine never adds a line by
         * itself.** The obvious implementation puts the oil in the basket at zero, and it is wrong for this
         * product: a cart on this rail becomes a chit, and a chit is what two parties AGREED. Something the
         * customer never chose must not arrive inside that. So:
         *
         *   · the reward IS in the basket    → it is discounted, up to what was earned
         *   · the reward is NOT in the basket → a NOTE says it has been earned, and names it
         *   · earned 2, holding 1             → the one is discounted AND the note reports the remaining one
         *
         * ⭐ A note is not a lesser outcome here. evaluate() already returns notes for "you are ₹300 away" and
         * every caller shows them beside the adjustments — so an unclaimed freebie is as visible as a claimed
         * one, and claiming it stays the buyer's act.
         */
        if (o.get_item_id) {
          var sets0 = Math.floor(ctx.eligibleQty / x);
          if (o.max_sets) sets0 = Math.min(sets0, Number(o.max_sets));
          if (sets0 <= 0) return [];
          var want = sets0 * y;
          var rname = o.get_item_name || 'the free item';
          var held = (ctx.all || []).filter(function (l) { return String(l.item_id) === String(o.get_item_id); });
          var got = [], left = want;
          for (var ri = 0; ri < held.length && left > 0; ri++) {
            var tk = Math.min(left, held[ri].qty);
            got.push(adj(o, 'line', held[ri].key, -R2(held[ri].unitPrice * tk * pct / 100),
              tk + ' × ' + (pct === 100 ? 'free' : pct + '% off') + ' ' + rname
              + ' — buy ' + x + ' get ' + y + ' (' + sets0 + ' set' + (sets0 === 1 ? '' : 's') + ')'));
            left -= tk;
          }
          /* ⚠️ NAMED, AND CARRYING THE ITEM ID, so a screen can offer to add it in one press rather than
             telling somebody to go and find it. A promise the buyer cannot act on is only half kept. */
          if (left > 0) {
            /**
             * ⭐⭐ A STRUCTURED CLAIM, NOT A SENTENCE TO PARSE. Athi, 2026-09-03: *"yes, it has to be added on
             * its own when there are freebies… but you can state that explicitly."* So a caller ADDS this line,
             * and a caller that has to regex "earned 1 ×" out of prose would break the first time the wording
             * was translated — which it will be, since every string here goes through tx().
             *
             * ⚠️ THE ENGINE STILL DOES NOT MUTATE THE BASKET. evaluate() is a pure function over lines; it says
             * what is owed and what is earned. Putting a line INTO the cart from in here would make a pure
             * calculation the owner of the order — see CBOffers.claims and the cart's use of it.
             */
            var n = note(o, 'earned ' + left + ' × ' + rname + ' '
              + (pct === 100 ? 'free' : 'at ' + pct + '% off')
              + ' — added to your order', 0, o.get_item_id);
            n.claim = { item_id: o.get_item_id, name: rname, qty: left,
                        percent: pct, unitPrice: 0, offer_id: o.id || null, label: o.label || '' };
            got.push(n);
          }
          return got;
        }

        var pool = ctx.eligible.slice().sort(function (a, b) { return a.unitPrice - b.unitPrice; });
        var totalQty = pool.reduce(function (t, l) { return t + l.qty; }, 0);
        var sets = Math.floor(totalQty / (x + y));
        if (o.max_sets) sets = Math.min(sets, Number(o.max_sets));
        if (sets <= 0) return [];
        var freeUnits = sets * y, out = [];
        for (var i = 0; i < pool.length && freeUnits > 0; i++) {
          var take = Math.min(freeUnits, pool[i].qty);
          out.push(adj(o, 'line', pool[i].key, -R2(pool[i].unitPrice * take * pct / 100),
            take + ' × ' + (pct === 100 ? 'free' : pct + '% off') + ' — buy ' + x + ' get ' + y
            + ' (' + sets + ' set' + (sets === 1 ? '' : 's') + ', cheapest units taken)'));
          freeUnits -= take;
        }
        return out;
      }
    },

    /** SHIPPING — free, flat, or a percentage. Its own scope because it is not part of goods value. */
    shipping: {
      scope: 'shipping',
      apply: function (o, ctx) {
        /**
         * ⚠️⚠️ A SHIPPING OFFER WITH NO TERM RETURNED NOTHING AND SAID NOTHING. The form's only shipping field is
         * "% off shipping (blank = free)", so leaving it blank — which the label invites — produced an offer with
         * no `free`, no `flat` and no `percent`: it evaluated to an empty list, appeared on no breakdown, and was
         * indistinguishable from an offer nobody had triggered. An offer that cannot fire has to say so.
         */
        if (!(o.free || o.flat != null || Number(o.percent) > 0))
          return [note(o, 'no shipping term stated — set free shipping, a flat rate, or a percentage', 0)];
        /* ⭐ FREE SHIPPING FROM AN AMOUNT (Athi, 2026-09-06 23:0x: "free shipping like a price threshold — when the amount reaches, show free
           shipping on the cart"). Below it the shortfall is reported, exactly as a spend threshold does, because "you are ₹300 away from
           free delivery" is the most useful thing a basket can say. */
        var minA = Number(o.min_amount) || 0;
        if (minA > 0 && ctx.eligibleSubtotal < minA)
          return [note(o, 'not yet — ' + ctx.money(R2(minA - ctx.eligibleSubtotal)) + ' more for free delivery', R2(minA - ctx.eligibleSubtotal))];
        var ship = Number(ctx.shipping) || 0;
        if (!ship) return [];
        if (o.free) return [adj(o, 'shipping', null, -R2(ship), 'free shipping')];
        if (o.flat != null) {
          var d = ship - Number(o.flat);
          return d > 0 ? [adj(o, 'shipping', null, -R2(d), 'flat shipping at ' + ctx.money(o.flat))] : [];
        }
        if (o.percent) return [adj(o, 'shipping', null, -R2(ship * Number(o.percent) / 100),
          o.percent + '% off shipping')];
        return [];
      }
    },

    /**
     * PRICE RANGE — a declared band rather than a discount. The seller states the floor and ceiling and the agreed
     * price must sit inside it. ⚠️ It produces NO adjustment: it is a CONSTRAINT, and reporting a violation is the
     * whole job. Silently clamping a negotiated price into the band would overwrite what two parties agreed.
     */
    price_range: {
      scope: 'line',
      apply: function (o, ctx) {
        return ctx.eligible.map(function (l) {
          var lo = o.min == null ? -Infinity : Number(o.min);
          var hi = o.max == null ? Infinity : Number(o.max);
          if (l.unitPrice >= lo && l.unitPrice <= hi) return null;
          return note(o, ctx.money(l.unitPrice) + ' is outside the seller’s band '
            + (o.min != null ? ctx.money(o.min) : '—') + '–' + (o.max != null ? ctx.money(o.max) : '—'), 0, l.key);
        }).filter(Boolean);
      }
    }
  };

  function adj(o, scope, target, amount, why, basis) {
    return { offer_id: o.id || null, label: o.label || o.kind, kind: o.kind, scope: scope,
             target: target, amount: amount, basis: basis || 'discount', why: why };
  }
  /* A NOTE is an explanation with no money attached — "you are ₹300 away", "outside the band". It rides in the
     same list so a caller cannot show the adjustments and forget the reasons. */
  function note(o, why, shortfall, target) {
    return { offer_id: o.id || null, label: o.label || o.kind, kind: o.kind, scope: 'note',
             target: target || null, amount: 0, basis: 'note', why: why, shortfall: shortfall || 0 };
  }

  /**
   * ── ⚠️⚠️ ONE ANSWER TO "WHAT DOES THIS THRESHOLD NEED" ──────────────────────────────────────────────────────
   *
   * `apply()` and `promise()` both had to ask, and they asked DIFFERENT FIELDS: apply read `min_amount || min_qty`
   * and promise read `min_subtotal` — a key no author has ever written, because the form writes `min_amount` and
   * `min_qty`. So every threshold offer somebody authored discounted the basket correctly and ADVERTISED NOTHING:
   * promise() returned null, forLine() dropped the offer, and the row a buyer looks at said the product was on no
   * offer at all. The badge and the basket disagreeing about the same offer is the exact failure promise()'s own
   * comment warns about, and it was inside promise().
   *
   * ⚠️ AND `min_amount || min_qty` COMPARED MONEY TO A COUNT. The form offers "Spend at least" and "…or this many
   * items" side by side, so both get filled; the old code then took the SPEND figure and measured it against the
   * basket's item COUNT — "197 more item(s) needed" for a ₹300 basket against a ₹200 minimum.
   *
   * ⭐ The form says "or", so this honours "or": either minimum satisfies the offer, and when neither does, both
   * shortfalls are reported — the buyer chooses which one to close.
   */
  function thresholdState(o, ctx) {
    var minA = Number(o.min_amount != null ? o.min_amount : o.min_subtotal) || 0;
    var minQ = Number(o.min_qty) || 0;
    var st = { minA: minA, minQ: minQ, stated: !!(minA || minQ), met: false, by: null, have: 0, gaps: [] };
    if (!st.stated || !ctx) return st;
    var hA = Number(ctx.eligibleSubtotal) || 0, hQ = Number(ctx.eligibleQty) || 0;
    if (minA && hA >= minA) { st.met = true; st.by = 'amount'; st.have = hA; return st; }
    if (minQ && hQ >= minQ) { st.met = true; st.by = 'qty'; st.have = hQ; return st; }
    if (minA) st.gaps.push({ qty: false, short: R2(minA - hA) });
    if (minQ) st.gaps.push({ qty: true, short: minQ - hQ });
    return st;
  }
  function thresholdGap(g, money) {
    return g.qty ? g.short + ' more item(s) needed' : money(g.short) + ' more needed';
  }
  /** The CONDITION in words — what promise() puts in the badge, from the same fields apply() measures. */
  function thresholdCond(o, money) {
    var st = thresholdState(o, null), parts = [];
    if (st.minA) parts.push('over ' + money(st.minA));
    if (st.minQ) parts.push('of ' + st.minQ + '+ items');
    return parts.join(' or ');
  }

  /* ── conditions ─────────────────────────────────────────────────────────────────────────────────────────────
   * ⚠️ A MISSING CONDITION MEANS "NO RESTRICTION", NEVER "FAILS". An offer with no region declared applies in
   * every region; an offer with no window is always live. The opposite default would silently disable every
   * offer written before a field existed — the same rule products.js applies to a missing status.
   */
  function within(o, ctx) {
    var now = ctx.now;
    if (o.valid_from && new Date(o.valid_from) > now) return 'not started (from ' + o.valid_from + ')';
    if (o.valid_to) {
      /* An end DATE means the end OF that day. "valid to 31 Oct" ending at 00:00 on the 31st is the kind of
         off-by-one a customer notices and nobody can defend. */
      var end = new Date(o.valid_to);
      if (/^\d{4}-\d{2}-\d{2}$/.test(String(o.valid_to))) end.setUTCHours(23, 59, 59, 999);
      if (end < now) return 'expired (' + o.valid_to + ')';
    }
    if (o.region && ctx.region && String(o.region).toLowerCase() !== String(ctx.region).toLowerCase())
      return 'other region (' + o.region + ')';
    if (o.currency && ctx.currency && String(o.currency) !== String(ctx.currency))
      return 'other currency (' + o.currency + ')';
    /* ⭐ CUSTOMER-ONLY OFFERS FAIL CLOSED (Athi, 2026-09-06: "each customer gets a personalised discount… through the Suppliers menu").
       An offer "Only for" a group or one customer applies when the viewer's groups — what the SELLER's customer list says about
       them (lib/customer-groups), never self-asserted — include it. No groups in the context = a stranger = not eligible. The line
       this replaces let such an offer through whenever the context said nothing, which is a promise to a stranger. */
    if (o.customer_group) {
      var gs = Array.isArray(ctx.customer_groups) ? ctx.customer_groups.map(String) : (ctx.customer_group ? [String(ctx.customer_group)] : []);
      if (gs.indexOf(String(o.customer_group)) < 0) return 'only for ' + (o.customer_name || o.customer_group);
    }
    return null;
  }

  /* Which lines an offer touches. No selector = every line. */
  function eligibleFor(o, lines) {
    var s = o.applies_to;
    /* ⭐ THE OVERRIDE. Governance flows one way — a category offer reaches every product under it — and the product's
       only answer is an explicit opt-out: `item_data.offers_excluded` = [offer ids], carried on the line as
       `excluded`. Athi, 2026-09-04: "no two directions — governance or override". */
    /* '*' = every offer (the item's "Shown to customers" switch for offers is off — lib/exposure.js) */
    lines = lines.filter(function (l) { return !(Array.isArray(l.excluded) && (l.excluded.indexOf('*') >= 0 || (o.id != null && l.excluded.map(String).indexOf(String(o.id)) >= 0))); });
    if (!s) return lines.slice();
    return lines.filter(function (l) {
      /* ⭐ TARGETS ARE A UNION. An offer ticked on a product AND scoped to a category reaches the product even when it
         sits elsewhere (Athi, 2026-09-05: "adi offer 2 — not applied — no line qualifies" on a rice product he had
         ticked it on; the offer was also scoped to Fruits & Vegetables). item_ids · skus · category / category_ids:
         if ANY of the lists is present, the line must be in AT LEAST ONE of them. The price bounds below stay AND. */
      var wantCats = [].concat(s.category ? [String(s.category)] : [], Array.isArray(s.category_ids) ? s.category_ids.map(String) : []);
      var lists = 0, hit = false;
      if (Array.isArray(s.item_ids) && s.item_ids.length) { lists++; if (s.item_ids.map(String).indexOf(String(l.item_id)) >= 0) hit = true; }
      if (Array.isArray(s.skus) && s.skus.length) { lists++; if (s.skus.map(String).indexOf(String(l.sku)) >= 0) hit = true; }
      if (wantCats.length) { lists++; var lc2 = (l.categories || (l.category ? [l.category] : [])).map(String); if (wantCats.some(function (c) { return lc2.indexOf(c) >= 0; })) hit = true; }
      if (lists && !hit) return false;
      /* ⭐ A MINIMUM ORDER SIZE (Athi, 2026-09-06): "10% off when you take 5 or more" — the line's quantity must reach it. For a basket-level
         offer the kind measures the basket; here every line must carry the count on its own (a basket of 3 + 2 does not make one line of 5). */
      var mq = minQtyFor(o, l); if (mq > 0 && (Number(l.qty) || 0) < mq) return false;
      if (s.min_unit_price != null && l.unitPrice < Number(s.min_unit_price)) return false;
      if (s.max_unit_price != null && l.unitPrice > Number(s.max_unit_price)) return false;
      return true;
    });
  }

  /**
   * ── ⭐⭐ WHAT A ROW MAY ADVERTISE, BEFORE ANYTHING IS IN A CART ─────────────────────────────────────────────
   *
   * Athi, 2026-09-02: *"discount and offers need to be expressed i guess, otherwise people may not know"*, and
   * *"in b2b, that is the way, the products are being pushed."*
   *
   * ⚠️⚠️ UNTIL NOW A DISCOUNT WAS INVISIBLE UNTIL IT WAS TOO LATE TO INFLUENCE ANYTHING. `evaluate()` runs on a
   * CART, so the only place an offer appeared was inside the basket, after a buyer had already chosen. The
   * storefront was never even sent the offers. A buyer could not learn a discount existed until they had
   * committed — which, for a B2B seller whose whole method of pushing product IS the discount, means the
   * mechanism was switched off.
   *
   * ⭐ `promise()` is the OTHER question from `evaluate()`, and keeping them apart is the point:
   *
   *     evaluate(cart)  → what you ARE getting, in money, on these exact lines
   *     promise(offer)  → what you COULD get, in words, on this one row
   *
   * ⚠️⚠️ AND IT ALWAYS STATES THE CONDITION. Never a bare "10% off" — "10% off 5+". A badge is a promise, and a
   * row that promises 10% while the cart declines to give it (minimum not met, wrong region, expired) is worse
   * than a row that said nothing: the first is a broken commitment, the second is merely quiet. So a kind whose
   * benefit depends on a threshold puts the threshold IN the sentence, and an offer that cannot fire right now
   * returns null rather than a caveat nobody reads.
   */
  function promise(o, ctx) {
    if (!o) return null;
    var c = Object.assign({ now: new Date() }, ctx || {});
    if (within(o, c) !== null) return null;
    return terms(o, c);
  }
  /**
   * terms(o, ctx) → the same sentence as promise(), WITHOUT the window gate — for a register that lists what an
   * offer says even when it is scheduled or expired (Setup › Offers, 2026-09-05). A badge must stay gated
   * (promise); a management list must not, or a future offer reads as an empty row.
   */
  function terms(o, ctx) {
    if (!o) return null;
    var c = Object.assign({ now: new Date() }, ctx || {});
    /* ⚠️ The SAME gate evaluate() uses. A second copy of "is this live?" is how a badge and a basket come to
       disagree about the same offer on the same screen. */
    var money = (typeof c.money === 'function') ? c.money : function (n) { return String(n); };
    var pct = Number(o.percent) || 0;
    var amt = Number(o.amount) || 0;

    switch (o.kind) {
      /* a basket-level offer says so — "25% off the order total" (Athi, 2026-09-06: the tag must carry the offer's detail) */
      /* the condition rides the sentence — "10% off 5+" — a badge never promises what the basket will refuse */
      case 'percent_off':
        return pct > 0 ? pct + '% off' + (o.scope === 'cart' ? ' the order total' : '') + minQtyWords(o, c) : null;

      case 'amount_off':
        return amt > 0 ? money(amt) + ' off' + (o.scope === 'cart' ? ' the order total' : '') + minQtyWords(o, c) : null;

      /**
       * ⭐ THE QUANTITY BREAK IS THE ONE THAT MOST NEEDS ITS CONDITION. "₹170 each" is a lie without "from 10";
       * the buyer is looking at a row priced ₹180 and would read the badge as the price they pay for one.
       */
      case 'tier_price': {
        var tiers = (o.tiers || []).slice().sort(function (a, b) { return (a.qty || 0) - (b.qty || 0); });
        /* ⚠️ A BREAK THAT CANNOT FIRE MUST NOT BE ADVERTISED (Athi, 2026-09-06 22:47: one break of "₹180 each from 5" was offered on every
           product, Rice at ₹80 included — apply() refuses to raise a price, so the badge promised what the basket would decline).
           When the caller names the row (forLine passes ctx.line), only a break BELOW that row's own price may be promised. */
        var lp = (c.line && Number(c.line.unitPrice) > 0) ? Number(c.line.unitPrice) : 0;
        if (lp) tiers = tiers.filter(function (t) { var p = tierPriceOf(t, lp); return p != null && p < lp; });
        var first = tiers[0];
        if (!first || !first.qty) return null;
        /* a percentage break says the percentage when the row is unknown, and the money when it is */
        if (first.price == null && first.percent != null && !lp)
          return Number(first.percent) + '% off from ' + first.qty + (tiers.length > 1 ? ' (' + tiers.length + ' price breaks)' : '');
        var shown = tierPriceOf(first, lp || Number(first.price) || 0);
        if (shown == null) return null;
        return money(shown) + ' each from ' + first.qty
             + (tiers.length > 1 ? ' (' + tiers.length + ' price breaks)' : '');
      }

      case 'threshold': {
        /* ⚠️ THE SAME FIELDS apply() MEASURES — see thresholdState. This read `min_subtotal`, which nothing writes. */
        if (!thresholdState(o, null).stated) return null;
        var give = pct > 0 ? pct + '% off' : (amt > 0 ? money(amt) + ' off' : null);
        return give ? give + ' orders ' + thresholdCond(o, money) : null;
      }

      case 'buy_x_get_y': {
        var x = Number(o.buy) || 0, y = Number(o.get) || 0;
        if (!x || !y) return null;
        /* ⭐ NAME THE REWARD when it is a different product — "Buy 3 get 1 free" beside a bag of rice reads as
           a fourth bag, which is not what is on offer. */
        if (o.get_item_id) return 'Buy ' + x + ' get ' + y + ' ' + (o.get_item_name || 'free item') + ' free';
        return 'Buy ' + x + ' get ' + y + ' free';
      }

      /* ⚠️ Shipping is an ORDER-level benefit and belongs on the basket, not on a product row: a single item
         cannot promise free delivery on its own, and saying so per row would be a promise the line cannot keep. */
      case 'shipping':
        return null;

      case 'price_range':
        return null;   /* a band is the price, not a discount off one — the row already shows it */

      default:
        return null;
    }
  }

  /**
   * forLine(line, offers, ctx) → [{ offer_id, label, promise }] — what THIS row may honestly advertise.
   *
   * ⚠️ TARGETING IS `eligibleFor`, NOT A SECOND FILTER. That function already fails CLOSED on an unclassified
   * product (an offer aimed at Grains must not fall back to "everything"), and re-implementing the test here for
   * one line is how a badge comes to appear on a product the basket will refuse.
   *
   * ⚠️ QUANTITY IS UNKNOWN HERE, deliberately. A row is not a basket; anything whose eligibility depends on how
   * many are ordered states that as its condition rather than pretending to have met it.
   */
  function forLine(line, offers, ctx) {
    var l = line || {};
    var out = [];
    for (var i = 0; i < (offers || []).length; i++) {
      var o = offers[i];
      /* Cart-scope offers describe the ORDER, not this product — they belong on the basket. A SPEND THRESHOLD is one of them (Athi,
         2026-09-06 23:1x: "drop the row badge, keep threshold at cart level only"): the basket says how far the order is from it, which is
         where a shopper can act on it; a row promising "10% off orders over ₹500" cannot say whether this order will get there. */
      if (o && (o.scope === 'cart' || o.kind === 'threshold')) continue;
      if (!eligibleFor(o, [Object.assign({ qty: Math.max(1, minQtyFor(o, l) || 1) }, l)]).length) continue;   /* the row may advertise "10% off 5+"; the basket enforces the 5 */
      var p = promise(o, Object.assign({}, ctx, { line: l }));
      if (!p) continue;
      out.push({ offer_id: o.id, label: o.label || p, promise: p, kind: o.kind });
    }
    return out;
  }

  /** Does any live offer touch this row? The "On offer" filter, computed the same way the badge is. */
  function onOffer(line, offers, ctx) { return forLine(line, offers, ctx).length > 0; }


  /**
   * ⭐ evaluate — the only entry point.
   *
   *   lines   [{ key, item_id, sku, category, qty, unitPrice }]
   *   offers  [{ id, kind, label, scope, priority, exclusive, valid_from, valid_to, region, currency,
   *              customer_group, applies_to:{…}, …kind-specific fields }]
   *   ctx     { now, region, currency, customer_group, shipping, money(fn) }
   *
   * Returns { subtotal, adjustments, notes, skipped, shipping, total, explain }
   *
   * ⚠️ STACKING IS EXPLICIT. Offers run in `priority` order (low first) and an `exclusive` offer that fires stops
   * everything after it. Left implicit, stacking order is decided by array order — which means it is decided by
   * whatever wrote the array, and two screens will disagree about the price of the same basket.
   */
  function evaluate(input) {
    input = input || {};
    var lines = (input.lines || []).map(function (l, i) {
      var qty = Number(l.qty) || 0, up = Number(l.unitPrice) || 0;
      /**
       * ⚠️ THIS NORMALISER IS A WHITELIST, AND THAT IS WHERE THE TARGETING BUG LIVED. It rebuilds each line from
       * named fields, so anything a caller sends that is not listed here is silently dropped before any rule
       * sees it. `categories` was added to cart-ui's line and to eligibleFor, both correct, and the offer still
       * never fired — because the field died in between, with no error and no missing-property anywhere to find.
       *
       * ⭐ A whitelist is right for an engine that has to be deterministic. But it means ADDING A FIELD IS A
       * TWO-PLACE CHANGE, and the second place is invisible from either end. If a rule reads something a line
       * carries, check here first.
       */
      var cats = Array.isArray(l.categories) ? l.categories.map(String)
               : (l.category ? [String(l.category)] : []);
      return { key: l.key == null ? String(i) : l.key, item_id: l.item_id, sku: l.sku,
               category: l.category, categories: cats, excluded: Array.isArray(l.excluded) ? l.excluded.map(String) : [],
               qty: qty, unitPrice: up, gross: R2(qty * up) };
    });
    /* ⚠️ THE CALLERS PASS `ctx: { now, currency, customer_groups, money }` AND THIS READ ONLY TOP-LEVEL FIELDS — so every context a cart
       sent was silently ignored: currency fell to '', now to the clock, and (2026-09-06, found by [OFF-03]) the viewer's groups never
       reached within(), so a customer-only offer printed its badge (forLine takes ctx directly) and never priced. Both shapes are read now;
       a top-level field still wins. */
    var c0 = (input.ctx && typeof input.ctx === 'object') ? input.ctx : {};
    var ctx = {
      now: (input.now || c0.now) ? new Date(input.now || c0.now) : new Date(),
      region: input.region || c0.region, currency: input.currency || c0.currency, customer_group: input.customer_group || c0.customer_group,
      customer_groups: Array.isArray(input.customer_groups) ? input.customer_groups : (Array.isArray(c0.customer_groups) ? c0.customer_groups : []),
      shipping: Number(input.shipping != null ? input.shipping : c0.shipping) || 0,
      /**
       * ⚠️ THE DEFAULT DROPPED THE CURRENCY ENTIRELY — `String(R2(n))` renders 7950 with no symbol, no code and
       * no grouping. catalogue-ui.js injects a real formatter, but the call at the mint (app.html:4439) injects
       * nothing, so that path renders a bare number the moment anyone shows or persists a `why`.
       *
       * ⚠️ A BARE NUMBER IS NOT A NEUTRAL FALLBACK. It invites the reader to assume their own currency, which is
       * the exact assumption the rest of this codebase spends its effort preventing. The default now uses the
       * currency the caller already passed in `input.currency` and formats it through the localisation layer;
       * where even that is absent it says the amount is unlabelled rather than pretending otherwise.
       */
      money: input.money || c0.money || function (n) {
        var c = input.currency || c0.currency || '';
        if (c && typeof CBLocale !== 'undefined') { try { return CBLocale.money(R2(n), c); } catch (_) {} }
        return c ? (c + ' ' + R2(n)) : (R2(n) + ' (currency not stated)');
      }
    };
    var subtotal = R2(lines.reduce(function (t, l) { return t + l.gross; }, 0));

    var offers = (input.offers || []).slice().sort(function (a, b) {
      /* ⭐ EXCLUSIVE MEANS "INSTEAD OF THE OTHERS" (Athi, 2026-09-06 19:29: an exclusive 25% for one customer, and the Flat 10% still applied
         because it ran first at order 0). An exclusive offer runs before every non-exclusive one, whatever the stacking numbers say; among
         exclusives, and among the rest, the stacking order decides. So when it fires, nothing else applies — and the notes say why. */
      var ea = a.exclusive ? 0 : 1, eb = b.exclusive ? 0 : 1; if (ea !== eb) return ea - eb;
      var pa = Number(a.priority) || 0, pb = Number(b.priority) || 0; if (pa !== pb) return pa - pb;
      /* line-level offers before basket-level ones at the same order: a basket offer is taken on the subtotal AFTER the lines are finished */
      var sa = (a.scope === 'cart' || a.kind === 'threshold') ? 1 : 0, sb = (b.scope === 'cart' || b.kind === 'threshold') ? 1 : 0; if (sa !== sb) return sa - sb;
      /* ⭐ THE INDUSTRY STANDARD (Athi, 2026-09-06 20:0x): offers apply in order, each on the RUNNING amount. At equal stacking order the
         result must not depend on how the array happened to be listed: percentages before amounts, then the rest. */
      var KO = { percent_off: 0, tier_price: 0, amount_off: 1 }; var ka = KO[a.kind] != null ? KO[a.kind] : 2, kb = KO[b.kind] != null ? KO[b.kind] : 2;
      return ka - kb;
    });

    var adjustments = [], notes = [], skipped = [], stop = false;
    /* ⭐ THE RUNNING NET PER LINE — what each line is worth after the offers applied so far. A percentage is taken on it (percent on percent),
       an amount is capped at it, a basket-level offer is measured on the sum of it and ALLOCATED across the eligible lines by it. The
       engine hands `line_net` and `cart_shares` out, so every reader (row, tax, the recording at send) uses this one rule. */
    var net = {}; lines.forEach(function (l) { net[l.key] = l.gross; });
    var cartShares = {};
    offers.forEach(function (o) {
      if (stop) { skipped.push({ offer_id: o.id, label: o.label, why: 'an exclusive offer already applied' }); return; }
      var kind = KINDS[o.kind];
      if (!kind) { skipped.push({ offer_id: o.id, label: o.label, why: 'unknown kind: ' + o.kind }); return; }
      var bad = within(o, ctx);
      if (bad) { skipped.push({ offer_id: o.id, label: o.label, why: bad }); return; }

      var elig0 = eligibleFor(o, lines);
      if (!elig0.length) { skipped.push({ offer_id: o.id, label: o.label, why: 'no line qualifies' }); return; }
      /* the kind sees each eligible line at its RUNNING worth (`gross`), with the list figure beside it (`list_gross`); unitPrice stays the list price a tier or a free unit is valued at */
      var elig = elig0.map(function (l) { return Object.assign({}, l, { list_gross: l.gross, gross: R2(net[l.key]) }); });

      var out = kind.apply(o, {
        eligible: elig,
        eligibleSubtotal: R2(elig.reduce(function (t, l) { return t + l.gross; }, 0)),
        eligibleQty: elig.reduce(function (t, l) { return t + l.qty; }, 0),
        /**
         * ⚠️ EVERY line, not only the qualifying ones — a cross-item reward ("buy rice, get oil free") has to
         * look for the OIL, which by definition is not in the set that qualified. This is the second half of
         * the two-place change the normaliser above warns about: a rule that reads something the ctx does not
         * carry fails silently, with no missing property anywhere to find.
         */
        all: lines,
        shipping: ctx.shipping, money: ctx.money, now: ctx.now
      }) || [];

      var moved = false;
      out.forEach(function (a) {
        if (a.basis === 'note') { notes.push(a); return; }
        adjustments.push(a); moved = true;
        if (a.scope === 'line' && a.target != null && net[a.target] != null) net[a.target] = Math.max(0, R2(net[a.target] + a.amount));
        else if (a.scope === 'cart') {
          /* allocate the basket-level amount across the eligible lines by their running net — the last line takes the rounding remainder */
          var give = Math.abs(Number(a.amount) || 0), base = elig.reduce(function (t, l) { return t + (net[l.key] || 0); }, 0), left = give;
          elig.forEach(function (l, i) {
            var share = i === elig.length - 1 ? R2(left) : (base > 0 ? R2(give * (net[l.key] || 0) / base) : 0); left = R2(left - share); if (share <= 0) return;
            net[l.key] = Math.max(0, R2(net[l.key] - share));
            (cartShares[l.key] = cartShares[l.key] || []).push({ offer_id: a.offer_id || null, label: a.label, kind: a.kind, amount: -share });
          });
        }
      });
      if (moved && o.exclusive) stop = true;
    });

    var goods = R2(adjustments.filter(function (a) { return a.scope !== 'shipping'; })
                              .reduce(function (t, a) { return t + a.amount; }, 0));
    var shipAdj = R2(adjustments.filter(function (a) { return a.scope === 'shipping'; })
                                .reduce(function (t, a) { return t + a.amount; }, 0));
    return {
      subtotal: subtotal,
      adjustments: adjustments,
      notes: notes,
      skipped: skipped,
      goods_adjustment: goods,
      /* the running net per line after everything, and each line's share of every basket-level offer — the one allocation rule */
      line_net: net, cart_shares: cartShares,
      shipping: R2(ctx.shipping + shipAdj),
      /* ⚠️ Never below zero. Adjustments are capped individually, but stacking several could still overshoot, and
         a negative total is not a refund — it is a bug that looks like one. */
      total: Math.max(0, R2(subtotal + goods + ctx.shipping + shipAdj)),
      /* ⭐ THE AUDIT TRAIL. Every applied offer, every rejected one, and the reason for both — this is what makes
         a price defensible six months later, and it is why `skipped` is returned rather than discarded. */
      explain: adjustments.map(function (a) { return a.label + ': ' + a.why; })
        .concat(notes.map(function (n) { return n.label + ' — ' + n.why; }))
        .concat(skipped.map(function (s) { return (s.label || s.offer_id) + ' not applied — ' + s.why; }))
    };
  }

  /**
   * claims(result) → the lines a cart should ADD on the buyer's behalf, [{item_id, name, qty, unitPrice, …}].
   *
   * ⭐ SEPARATE FROM evaluate() ON PURPOSE. evaluate answers "what is this basket worth"; this answers "what
   * should now be in it". Keeping them apart is what lets a caller take the discounts and decline the
   * additions — the storefront may want both, a back-office repricing screen may want only the first.
   */
  function claims(res) {
    return ((res && res.notes) || []).map(function (n) { return n.claim; }).filter(Boolean);
  }

  /**
   * ── ⭐⭐ perLine(result, lines) → { <line key>: { off, why, offer_id, label, offers[], capped } } ─────────────
   *
   * The LINE-scope adjustments, accumulated onto the line each names, and CAPPED at what the line is worth.
   *
   * ⚠️ FOUR CALLERS WROTE THIS LOOP BY HAND — the cart's offer pass, its second pass after a reward is claimed,
   * the compose SEND path, and the test's mint(). Identical code, and the cap (`Math.min(off, gross)`) lived only
   * in two of them: `evaluate()` clamps the ORDER total at zero, never an individual line, so two 60% offers on
   * one line produce a −120% line in any caller that forgot. A discount larger than the thing being discounted is
   * not a rounding difference, it is a credit note nobody authorised — and it was one `Math.min` away in each of
   * four places, which is three places too many to keep right.
   *
   * ⚠️ `lines` MUST BE THE SAME ARRAY passed to evaluate(): the cap needs each line's gross, and the keys here are
   * the keys evaluate() assigned. Called without it the amounts accumulate uncapped, which is the old behaviour
   * and is only safe when the caller caps.
   */
  function perLine(res, lines) {
    var gross = {};
    (lines || []).forEach(function (l, i) {
      gross[l.key == null ? String(i) : String(l.key)] = R2((Number(l.qty) || 0) * (Number(l.unitPrice) || 0));
    });
    var out = {};
    ((res && res.adjustments) || []).forEach(function (a) {
      if (a.scope !== 'line' || a.target == null) return;
      var off = Math.abs(Number(a.amount) || 0); if (!off) return;
      var k = String(a.target);
      var row = out[k] || (out[k] = { off: 0, why: '', offer_id: null, label: '', offers: [], capped: false });
      row.off = R2(row.off + off);
      row.why = a.why || ''; row.offer_id = a.offer_id || null; row.label = a.label || '';
      if (a.offer_id && row.offers.indexOf(a.offer_id) < 0) row.offers.push(a.offer_id);
    });
    if (lines) Object.keys(out).forEach(function (k) {
      var g = gross[k]; if (g == null) return;
      if (out[k].off > g) { out[k].off = g; out[k].capped = true; }
    });
    return out;
  }

  /**
   * ── ⭐ sampleQty(offers, unitPrice) → the quantity at which these offers become interesting ──────────────────
   *
   * Athi, 2026-09-03: *"each screen should showcase the outcome"*. A worked example at qty 1 shows nothing for
   * a tier, a buy-x-get-y or a threshold — the three kinds a B2B seller reaches for first — so a preview that
   * only ever shows one unit demonstrates that the offer does nothing.
   *
   * ⚠️ DERIVED FROM THE RULES, NEVER GUESSED. The trigger is in the offer: `min_qty`, the smallest tier, the
   * buy+get set, or the spend divided by the unit price. A hard-coded 3 would show a 10+ tier not firing and
   * invite the author to conclude their tier table is broken.
   */
  function sampleQty(offers, unitPrice) {
    var q = 0, up = Number(unitPrice) || 0;
    [].concat(offers || []).forEach(function (o) {
      if (!o) return;
      var st = thresholdState(o, null);
      if (st.minQ) q = Math.max(q, st.minQ);
      if (st.minA && up > 0) q = Math.max(q, Math.ceil(st.minA / up));
      if (o.buy) q = Math.max(q, (Number(o.buy) || 0) + (o.get_item_id ? 0 : (Number(o.get) || 0)));
      (o.tiers || []).forEach(function (t) { if (t && t.qty) q = Math.max(q, Number(t.qty) || 0); });
    });
    /* ⚠️ Capped. A tier that starts at 5,000 must not produce a "5,000 ×" example nobody can read. */
    return q > 1 ? Math.min(q, 999) : 3;
  }

  /**
   * timeStatus(o, now) → 'scheduled' | 'active' | 'expired' — the TIME axis, separate from the lifecycle (draft ·
   * live · retired). The words are the ones Shopify, WooCommerce and Google Merchant promotions use, adopted as-is
   * (Athi, 2026-09-05: "futuristic, current, expired — is there a standard term?"). Derived from within(), so the
   * chip and the basket can never disagree about a date.
   */
  function timeStatus(o, now) {
    var why = within(o || {}, { now: now || new Date() });
    if (why === null) return 'active';
    if (/^not started/.test(why)) return 'scheduled';
    if (/^expired/.test(why)) return 'expired';
    return 'active';   /* region / currency / group gates are not TIME */
  }
  /**
   * scopeLabel(o) → 'the order total' | 'each line' | 'on shipping' | 'per set' — WHAT the amount comes off (the promise carries the "off").
   * Athi, 2026-09-05: "if ₹100 off is on the total bill that should be explicit". One phrase, from the engine's own
   * notion of scope, so the category row, the product tab and the Setup list cannot disagree.
   */
  /** the minimum order size this offer asks of THIS line: per product (applies_to.min_qty_by_item[item_id], the lab's row box) first, else per offer (applies_to.min_qty) */
  function minQtyFor(o, l) { var s = o && o.applies_to; if (!s) return 0; var by = s.min_qty_by_item; if (by && l && l.item_id != null && by[String(l.item_id)] != null) return Number(by[String(l.item_id)]) || 0; return Number(s.min_qty) || 0; }
  /** " 5+" when the offer asks for a minimum order size — for the row at hand when the context names one (forLine), else the offer's own */
  function minQtyWords(o, ctx) { var m = minQtyFor(o, ctx && ctx.line); return (m > 1) ? ' ' + m + '+' : ''; }
  /** ⭐ A TIER MAY BE A PERCENTAGE (Athi, 2026-09-06: "so it need not be price dependent"): `price` is the price of record at that volume;
      `percent` is that much off THIS line's own price, so one rule fits every product. Anything else is an unfinished tier. */
  function tierPriceOf(t, unitPrice) {
    if (!t) return null;
    if (t.price != null && t.price !== '') return R2(Number(t.price));
    if (t.percent != null && t.percent !== '' && Number(unitPrice) > 0) return R2(Number(unitPrice) * (1 - Number(t.percent) / 100));
    return null;
  }
  function scopeLabel(o) {
    var x = o || {};
    if (x.kind === 'shipping') return 'on shipping';
    if (x.kind === 'buy_x_get_y') return 'per set';
    if (x.kind === 'tier_price') return 'per unit from the tier';
    /* the promise already says "off" ("10% off", "₹10.00 off") — the scope names only WHAT it comes off (Athi, 2026-09-06: "two times off is coming") */
    if (x.scope === 'cart' || x.kind === 'threshold') return 'the order total';
    return 'each line';
  }
  root.CBOffers = { evaluate: evaluate, promise: promise, terms: terms, timeStatus: timeStatus, scopeLabel: scopeLabel, forLine: forLine, onOffer: onOffer, claims: claims,
    perLine: perLine, sampleQty: sampleQty, KINDS: KINDS, kinds: Object.keys(KINDS) };
})(typeof window !== 'undefined' ? window : this);
