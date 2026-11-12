/* ADOPTED from chitbridge-engines v1.89.0 · offers · sha256 03ca0b51d6f9529336f46924de98e1627ff45bb4a9a8a73991ffff8081521ecb — DO NOT EDIT HERE. Change it in chitbridge-engines, release a version, then run tools/adopt.cjs. */
/* chitbridge-engines · offers. Edited ONLY in chitbridge-engines/src/offers.js; every platform adopts a released version of it. */
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
 *
 * OWNS      the offer kinds (percent off · amount off · tier price · threshold · bundle · buy X get Y · mix and match · shipping · price range), their stacking order, the running net per line, and the words a row may advertise (promise · terms · forLine) — no storage, no clock of its own beyond `now`
 * CALLED BY the api (lib/offers-engine.js, offers-live.js, offer-clash.js, catalogue-view.js, exposure.js, reward-store.js, routes/offers.js, definitions.js, catalogue.js, relationships.js, till.js) and the web (P/engine/offers.js → catalogue-ui.offersHTML, compose) through the adopted copy
 * FLOW      lines + offers + ctx ──▶ normaliseLine_ · evaluationContext_ ──▶ compareOffers_ (stacking order) ──▶ per offer: qualifyOffer_ (window · scope) → KINDS[kind].apply → foldAdjustment_ (capped at the running net) ──▶ evaluationResult_ { adjustments · notes · skipped · explain }
 * CARD      07-offers-pricing-and-combos/offers-engine-public-service
 */
(function (root) {
  'use strict';
  /* ⭐ money.round — THE one rounder (C:devSPEC-money-one-reader.md), found wherever this copy runs: CBMoney in
     a page, lib/money.js on the server. Looked up PER CALL, because on the shop screen an engine can load before
     money.js does. ⚠️ The fallback is the SAME rule, only for a page where money.js failed to load — and
     tests/money-round.test.js holds every copy of it equal to money.round. */
  var MONEY_ = null;
  /** the money engine: CBMoney in a page, else lib/money.js required once and remembered in MONEY_ (false = it could not be loaded) */
  function moneyEngine_() {
    var moneyEngine = typeof CBMoney !== 'undefined' && CBMoney.round ? CBMoney : MONEY_;
    if (moneyEngine === null && typeof require === 'function') {
      try {
        moneyEngine = MONEY_ = require('./money');
      } catch (_) {
        moneyEngine = MONEY_ = false;
      }
    }
    return moneyEngine;
  }
  /** the SAME rounding rule as money.round, for a page where money.js failed to load */
  function fallbackRound_(amount) {
    var x = Number(amount);
    if (!isFinite(x)) return x;
    var rounded = Math.round(Number((Math.abs(x) * 100).toPrecision(15))) / 100;
    return x < 0 && rounded !== 0 ? -rounded : rounded;
  }
  /** round one amount by THE rule: money.round when it is there, the same rule inline when it is not */
  function roundMoney_(amount) {
    var moneyEngine = moneyEngine_();
    if (moneyEngine && moneyEngine.round) return moneyEngine.round(amount);
    return fallbackRound_(amount);
  }

  var moneyOf_ = function (value) {
    return roundMoney_(Number(value) || 0);
  };

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
      /** % off the eligible lines one by one, or off the eligible subtotal as one cart-level adjustment */
      apply: function (offer, ctx) {
        var percent = Number(offer.percent) || 0;
        if (percent <= 0) return [];
        if (offer.scope === 'cart') {
          var base = ctx.eligibleSubtotal;
          if (!base) return [];
          return [adjustmentOf_(offer, 'cart', null, -moneyOf_((base * percent) / 100), percent + '% off ' + ctx.money(base) + ' of eligible lines')];
        }
        return ctx.eligible.map(function (item) {
          return adjustmentOf_(offer, 'line', item.key, -moneyOf_((item.gross * percent) / 100), percent + '% off ' + ctx.money(item.gross));
        });
      }
    },

    /** A flat amount off. ⚠️ Capped at the base so a discount can never make a total negative. */
    amount_off: {
      scope: 'either',
      /** a flat amount off the cart or off each eligible line (per line, or per item when `per` says so), capped at the base */
      apply: function (offer, ctx) {
        var amount = Number(offer.amount) || 0;
        if (amount <= 0) return [];
        var base = offer.scope === 'cart' ? ctx.eligibleSubtotal : null;
        if (offer.scope === 'cart') {
          if (!base) return [];
          /* ⚠️ A flat ₹500 off a ₹300 order must not pay the customer ₹200. Capped, and the cap is REPORTED —
             a silently reduced discount is a number the customer cannot reconcile against the advertised offer. */
          var give = Math.min(amount, base);
          return [
            adjustmentOf_(
              offer,
              'cart',
              null,
              -moneyOf_(give),
              ctx.money(give) + ' off' + (give < amount ? ' (capped at the order value of ' + ctx.money(base) + ')' : '')
            )
          ];
        }
        /**
         * ── ⭐⭐⭐ "₹20 OFF" — OFF THE LINE, OR OFF EACH ONE? ────────────────────────────────────────────────
         *
         * Athi, observation 6, division F: *"Rs 20 off on cooking oil, it is PER ITEM — if it is 3, then 3 × 20,
         * 60 Rs."* He authored the offer meaning one thing and the engine did the other, and neither was wrong:
         * the form said only "Amount off" and never asked.
         *
         * ⚠️⚠️ THE DEFAULT DOES NOT MOVE. Every offer already written means what it has always meant — a flat
         * amount off the line — because changing that silently would reprice live offers in shops that never
         * asked for it, and a shopkeeper would find out at the counter. `per: 'item'` is a deliberate choice the
         * author makes on the form, and the badge says which one it is.
         * ⚠️ Still capped at the line: 3 × ₹20 off a ₹40 line gives ₹40, never a refund.
         */
        var perItem = String(offer.per || '') === 'item';
        return ctx.eligible.map(function (item) {
          var want = perItem ? moneyOf_(amount * (Number(item.qty) || 0)) : amount;
          var allowed = Math.min(want, item.gross);
          var each = perItem ? ctx.money(amount) + ' off each' : ctx.money(allowed) + ' off';
          return adjustmentOf_(offer, 'line', item.key, -moneyOf_(allowed), each + (allowed < want ? ' (capped at the line value)' : ''));
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
      /** one price-change adjustment per eligible line that reaches a tier; nothing when the offer has no tiers */
      apply: function (offer, ctx) {
        var tiers = sortedTiers_(offer.tiers);
        if (!tiers.length) return [];
        return ctx.eligible
          .map(function (item) {
            return tierAdjustment_(offer, ctx, tiers, item);
          })
          .filter(Boolean);
      }
    },

    /**
     * THRESHOLD — "discount above a certain amount", exactly as Athi described. Spend or quantity, then a reward.
     * ⚠️ Reports the SHORTFALL when it does not fire, because "you are ₹300 away" is the single most useful thing
     * a cart can say, and it is information the engine already has and would otherwise throw away.
     */
    threshold: {
      scope: 'cart',
      /** the cart-level reward once the spend or quantity minimum is met; a note (with the shortfall) when it is not */
      apply: function (offer, ctx) {
        var state = thresholdState(offer, ctx);
        /* ⚠️ A THRESHOLD WITH NO THRESHOLD IS NOT "always on" — it is an unfinished offer, and it says so
           rather than firing on every basket or vanishing without a word. */
        if (!state.stated) return [note(offer, 'no minimum stated — this offer is unfinished', 0)];
        if (!state.met) return thresholdShortfall_(offer, state, ctx);
        var metText = thresholdMetText_(state, ctx);
        if (offer.get_item_id) return thresholdReward_(offer, ctx, metText);
        if (offer.percent) {
          return [adjustmentOf_(offer, 'cart', null, -moneyOf_((ctx.eligibleSubtotal * Number(offer.percent)) / 100), offer.percent + '% off — ' + metText)];
        }
        var amount = Math.min(Number(offer.amount) || 0, ctx.eligibleSubtotal);
        /* ⚠️ Met, but nothing to give. Silence here reads as "you did not qualify", which is the opposite. */
        if (!amount) return [note(offer, 'threshold met, but no discount is stated on the offer', 0)];
        return [adjustmentOf_(offer, 'cart', null, -moneyOf_(amount), ctx.money(amount) + ' off — ' + metText)];
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
      /** the named items together for one price: complete sets only, the saving shared across the set's lines pro rata */
      apply: function (offer, ctx) {
        var ids = (Array.isArray(offer.bundle_items) ? offer.bundle_items : []).map(String).filter(Boolean);
        var price = Number(offer.bundle_price) || 0;
        if (ids.length < 2 || price <= 0) return [note(offer, 'a bundle needs two or more items and a price — this offer is unfinished', 0)];
        var held = ids.map(function (id) {
          return bundleHold_(offer, ctx, id);
        });
        var missing = ids.filter(function (id, index) {
          return !held[index];
        });
        if (missing.length)
          return [
            note(offer, 'not yet — the bundle needs ' + missing.length + ' more item' + (missing.length === 1 ? '' : 's') + ' in the order', missing.length)
          ];
        var sets = Math.min.apply(
          null,
          held.map(function (item) {
            return Math.floor(item.qty);
          })
        );
        if (offer.max_sets) sets = Math.min(sets, Number(offer.max_sets));
        if (sets <= 0) return [];
        return bundleLines_(offer, ctx, held, price, sets);
      }
    },

    buy_x_get_y: {
      scope: 'line',
      /** buy X get Y: free (or part-priced) units per product, or a different reward product when `get_item_id` names one */
      apply: function (offer, ctx) {
        var x = Number(offer.buy) || 0,
          y = Number(offer.get) || 0;
        if (x <= 0 || y <= 0) return [];
        var percent = offer.get_percent == null ? 100 : Number(offer.get_percent); // 100 = free
        if (offer.get_item_id) return buyXGetItem_(offer, ctx, x, y, percent);
        return buyXGetSame_(offer, ctx, x, y, percent);
      }
    },

    /**
     * ── ⭐⭐⭐ MIX AND MATCH — ANY TWO IN THIS CATEGORY, GET THE CHEAPEST FREE ──────────────────────────────────
     *
     * Athi, 2026-09-10: *"we cannot offer for different product, but in cloth line it works as per category, so
     * possibly we need to have a different naming convention to state that."* Then, asked which unit is free:
     * *"cheapest free for mix and match."*
     *
     * ⭐⭐ THE FAULT THIS KIND EXISTS TO FIX WAS A NAME, NOT AN ARITHMETIC. `buy_x_get_y` used to pool every
     * eligible line and give away the cheapest units, so "Buy 2 biscuits, get 1 free" on a basket of three
     * Cookies and one Cream biscuit took the ₹9 biscuit off — earned by the Cookies, taken from a line holding a
     * single packet. Correct under mix-and-match and not what the shop had written down. Athi asked why a line
     * showed ₹0.00, which is how it was found.
     *
     * ⚠️ SO THE TWO ARE NOW SEPARATE KINDS, and neither can be mistaken for the other:
     *
     *     buy_x_get_y     buy 2 of THIS, get 1 of THIS free      earned per product
     *     mix_and_match   buy any 2 in Biscuits, cheapest free   earned across the eligible lines
     *
     * ⭐ A kirana means the first; an apparel floor means the second. One kind cannot mean both, and a shop must
     * never have to discover which by reading a bill.
     *
     * ⚠️⚠️ AND IT SAYS THE RULE ON THE LINE. "1 × free" on a ₹9 item beside a ₹31 one is unreadable without
     * "the cheapest qualifying unit" — that is the whole lesson of observation 5: the arithmetic was never wrong,
     * the silence was. The words are here, and the numbers ride in `detail` so a screen need not parse prose.
     */
    mix_and_match: {
      scope: 'line',
      /** mix and match: the free units are the cheapest across all eligible lines, spilling onto the next-cheapest line */
      apply: function (offer, ctx) {
        var x = Number(offer.buy) || 0,
          y = Number(offer.get) || 0;
        if (x <= 0 || y <= 0) return [];
        var percent = offer.get_percent == null ? 100 : Number(offer.get_percent); // 100 = free

        /* ⚠️ unitNow, not the list price: a quantity break that re-priced a line is honoured before a free unit
           is valued off it, or the offer gives away more than the line is actually worth. */
        var pool = ctx.eligible.slice().sort(function (first, second) {
          return unitNow(first) - unitNow(second);
        });
        var totalQty = pool.reduce(function (total, item) {
          return total + item.qty;
        }, 0);
        var sets = Math.floor(totalQty / (x + y));
        if (offer.max_sets) sets = Math.min(sets, Number(offer.max_sets));
        if (sets <= 0) return [];
        return mixFreeLines_(offer, pool, { sets: sets, percent: percent, buy: x, get: y, pool: totalQty });
      }
    },

    /** SHIPPING — free, flat, or a percentage. Its own scope because it is not part of goods value. */
    shipping: {
      scope: 'shipping',
      /** a shipping offer: free, flat, or a percentage off the shipping charge; a note when it states no term or its minimum is not reached */
      apply: function (offer, ctx) {
        /**
         * ⚠️⚠️ A SHIPPING OFFER WITH NO TERM RETURNED NOTHING AND SAID NOTHING. The form's only shipping field is
         * "% off shipping (blank = free)", so leaving it blank — which the label invites — produced an offer with
         * no `free`, no `flat` and no `percent`: it evaluated to an empty list, appeared on no breakdown, and was
         * indistinguishable from an offer nobody had triggered. An offer that cannot fire has to say so.
         */
        if (!(offer.free || offer.flat != null || Number(offer.percent) > 0))
          return [note(offer, 'no shipping term stated — set free shipping, a flat rate, or a percentage', 0)];
        /* ⭐ FREE SHIPPING FROM AN AMOUNT (Athi, 2026-09-06 23:0x: "free shipping like a price threshold — when the amount reaches, show free
           shipping on the cart"). Below it the shortfall is reported, exactly as a spend threshold does, because "you are ₹300 away from
           free delivery" is the most useful thing a basket can say. */
        var minA = Number(offer.min_amount) || 0;
        if (minA > 0 && ctx.eligibleSubtotal < minA)
          return [
            note(offer, 'not yet — ' + ctx.money(moneyOf_(minA - ctx.eligibleSubtotal)) + ' more for free delivery', moneyOf_(minA - ctx.eligibleSubtotal))
          ];
        var ship = Number(ctx.shipping) || 0;
        if (!ship) return [];
        return shippingAdjustments_(offer, ctx, ship);
      }
    },

    /**
     * PRICE RANGE — a declared band rather than a discount. The seller states the floor and ceiling and the agreed
     * price must sit inside it. ⚠️ It produces NO adjustment: it is a CONSTRAINT, and reporting a violation is the
     * whole job. Silently clamping a negotiated price into the band would overwrite what two parties agreed.
     */
    price_range: {
      scope: 'line',
      /** a constraint, not a discount: one note per eligible line whose unit price sits outside the seller's band */
      apply: function (offer, ctx) {
        return ctx.eligible
          .map(function (item) {
            var floorPrice = offer.min == null ? -Infinity : Number(offer.min);
            var ceilingPrice = offer.max == null ? Infinity : Number(offer.max);
            if (item.unitPrice >= floorPrice && item.unitPrice <= ceilingPrice) return null;
            return note(
              offer,
              ctx.money(item.unitPrice) +
                ' is outside the seller’s band ' +
                (offer.min != null ? ctx.money(offer.min) : '—') +
                '–' +
                (offer.max != null ? ctx.money(offer.max) : '—'),
              0,
              item.key
            );
          })
          .filter(Boolean);
      }
    }
  };

  /* ── helpers of the kinds above (each is the body of one KINDS apply, moved out so no function runs past a screen) ─────────── */

  /** the tiers sorted by their quantity, smallest first (a copy; the offer's own list is not touched) */
  function sortedTiers_(tiers) {
    return (tiers || []).slice().sort(function (first, second) {
      return (first.qty || 0) - (second.qty || 0);
    });
  }
  /** the highest tier this quantity reaches, or null when it reaches none (tiers are sorted, smallest first) */
  function tierHit_(tiers, quantity) {
    var matchedTier = null;
    for (var index = 0; index < tiers.length; index++) if (quantity >= (tiers[index].qty || 0)) matchedTier = tiers[index];
    return matchedTier;
  }
  /* ⭐ SAY THE PERCENTAGE (Athi, 2026-09-06 23:4x: "show 15% discount applied?") — stated when the slab was written as one, worked
   out from the two prices when it was written as a price, so the sentence reads the same either way. */
  function tierPercentWords_(matchedTier, wasPrice, now) {
    var percent = tierPercentOf(matchedTier) != null ? Number(tierPercentOf(matchedTier)) : wasPrice > 0 ? Math.round((1 - now / wasPrice) * 1000) / 10 : 0;
    return percent > 0 ? (percent % 1 === 0 ? String(percent) : percent.toFixed(1)) + '% off · ' : '';
  }
  /** the re-price adjustment for one eligible line at its tier, or null when no tier is reached or the tier would not lower the price */
  function tierAdjustment_(offer, ctx, tiers, item) {
    var tierQty = pooledQty_(item);
    var matchedTier = tierHit_(tiers, tierQty);
    if (!matchedTier) return null;
    var wasPrice = item.unitPrice,
      now = tierPriceOf(matchedTier, wasPrice);
    if (now == null) return null;
    if (!(now < wasPrice)) return null; /* ⚠️ never silently RAISE a price from a tier table */
    var percentWords = tierPercentWords_(matchedTier, wasPrice, now);
    return adjustmentOf_(
      offer,
      'line',
      item.key,
      -moneyOf_((wasPrice - now) * item.qty),
      'qty ' + tierQty + (tierQty !== item.qty ? ' of this product' : '') + ' reaches the ' + matchedTier.qty + '+ tier · ' + percentWords + ctx.money(wasPrice) + ' → ' + ctx.money(now) + ' each',
      'price'
    );
  }

  /**
   * ⭐ ONE PRODUCT ON TWO LINES COUNTS TOGETHER (M4a, CAT-252/253/233, 2026-11-12). A product scanned twice is still five of that product, so a
   * quantity break, a minimum order size and buy-X-get-Y read the SUM of qty over the lines that share its item_id. Never across DIFFERENT
   * items (3 of A + 2 of B is not five of anything; only a declared bundle or a mix-and-match joins items). A line without an item_id stands alone.
   * `lines` is the set that counts (the offer's own eligible lines); the quantity is stamped on each as `item_qty`.
   */
  function sameItemQty_(lines, line) {
    var ownQty = Number(line && line.qty) || 0;
    if (!line || line.item_id == null || line.item_id === '') return ownQty;
    return lines.reduce(function (total, other) {
      return String(other.item_id) === String(line.item_id) ? total + (Number(other.qty) || 0) : total;
    }, 0);
  }
  /** the quantity of this line's PRODUCT in the offer: `item_qty` when evaluate() stamped it, else the line's own */
  function pooledQty_(line) {
    return line.item_qty != null ? line.item_qty : line.qty;
  }
  /** is this line opted out of THIS offer — `excluded` carries the offer's id or '*' (every offer) */
  function isExcluded_(offer, line) {
    var list = line && line.excluded;
    return Array.isArray(list) && (list.indexOf('*') >= 0 || (offer && offer.id != null && list.map(String).indexOf(String(offer.id)) >= 0));
  }

  /** every line of the WHOLE basket (not only the qualifying ones) that is this catalogue item: where a cross-item reward is looked for */
  function heldItems_(ctx, itemId, offer) {
    return (ctx.all || []).filter(function (item) {
      /* a line opted out of THIS offer is not a reward or a member (M4a critic): the offer was switched off on it */
      return String(item.item_id) === String(itemId) && !(offer && isExcluded_(offer, item));
    });
  }
  /** "free" at 100%, else "<n>% off" */
  function freeOrOff_(percent) {
    return percent === 100 ? 'free' : percent + '% off';
  }
  /** "free" at 100%, else "at <n>% off" (the reward not yet in the basket) */
  function freeOrAtOff_(percent) {
    return percent === 100 ? 'free' : 'at ' + percent + '% off';
  }
  /** the structured claim a caller ADDS to the basket for an earned reward item — never a sentence to parse */
  function rewardClaim_(offer, name, quantity, percent) {
    return { item_id: offer.get_item_id, name: name, qty: quantity, percent: percent, unitPrice: 0, offer_id: offer.id || null, label: offer.label || '' };
  }
  /** the "not yet" note of a threshold: the shortfall against the spend minimum and/or the quantity minimum (both when both are stated) */
  function thresholdShortfall_(offer, state, ctx) {
    var firstGap = state.gaps[0],
      secondGap = state.gaps[1];
    return [
      note(offer, 'not yet — ' + thresholdGap(firstGap, ctx.money) + (secondGap ? ' (or ' + thresholdGap(secondGap, ctx.money) + ')' : ''), firstGap.short)
    ];
  }
  /** the sentence saying how the basket met the threshold (by quantity or by spend) */
  function thresholdMetText_(state, ctx) {
    return state.by === 'qty'
      ? 'order of ' + state.have + ' item' + (state.have === 1 ? '' : 's') + ' meets the ' + state.minQ + '-item threshold'
      : 'order of ' + ctx.money(state.have) + ' meets the ' + ctx.money(state.minA) + ' threshold';
  }
  /** the reward item of a met threshold: its line discounted when it is in the basket, else a note carrying the claim */
  function thresholdReward_(offer, ctx, metText) {
    /* ⭐ A REWARD ITEM ON A THRESHOLD ("spend ₹5,000, get a free 1 kg sugar"): the same claim shape as buy X get Y,
       so the screen can add it in one press. If the item is already in the basket its line is discounted instead. */
    var rewardQty = Number(offer.get_qty) || 1,
      rewardPercent = offer.get_percent == null ? 100 : Number(offer.get_percent);
    var rewardName = offer.get_item_name || 'the reward item';
    var held = heldItems_(ctx, offer.get_item_id, offer);
    if (held.length) {
      var takeQty = Math.min(rewardQty, held[0].qty);
      return [
        adjustmentOf_(
          offer,
          'line',
          held[0].key,
          -moneyOf_((unitNow(held[0]) * takeQty * rewardPercent) / 100),
          takeQty + ' × ' + freeOrOff_(rewardPercent) + ' ' + rewardName + ' — ' + metText
        )
      ];
    }
    var earnedNote = note(offer, 'earned ' + rewardQty + ' × ' + rewardName + ' ' + freeOrAtOff_(rewardPercent) + ' — ' + metText, 0, offer.get_item_id);
    earnedNote.claim = rewardClaim_(offer, rewardName, rewardQty, rewardPercent);
    return [earnedNote];
  }
  /**
   * one bundle member as the basket holds it (M4a, CAT-252): the UNITS of every line of that catalogue item that has not opted out of THIS
   * offer, each at its own line's list price, dearest first (so line order never changes the answer). null when none is held. An opted-out
   * line (`excluded`) is no member: the bundle must not price an item the offer was switched off on.
   */
  function bundleHold_(offer, ctx, itemId) {
    var lines = heldItems_(ctx, itemId, offer);
    if (!lines.length) return null;
    var units = [];
    lines.forEach(function (line) {
      for (var count = 0; count < Math.floor(Number(line.qty) || 0); count++) units.push({ key: line.key, price: line.unitPrice });
    });
    units.sort(function (first, second) {
      return second.price - first.price;
    });
    return { units: units, qty: units.length };
  }
  /** one complete set's saving shared over its units by price (last takes the remainder), added to the per-line totals */
  function addSetSaving_(totals, units, setSave, sum) {
    var given = 0;
    units.forEach(function (unit, index) {
      var share = index === units.length - 1 ? moneyOf_(setSave - given) : moneyOf_(setSave * (unit.price / (sum || 1)));
      given += share;
      if (totals.byKey[unit.key] == null) {
        totals.byKey[unit.key] = 0;
        totals.order.push(unit.key);
      }
      totals.byKey[unit.key] = moneyOf_(totals.byKey[unit.key] + share);
    });
  }
  /** the bundle's saving, set by set: a set saves only when its own units' prices exceed the bundle price (never a negative saving) */
  function bundleLines_(offer, ctx, held, price, sets) {
    var totals = { byKey: {}, order: [] },
      save = 0;
    for (var setIndex = 0; setIndex < sets; setIndex++) {
      var units = held.map(function (member) {
        return member.units[setIndex];
      });
      var sum = units.reduce(function (total, unit) {
        return total + unit.price;
      }, 0);
      var setSave = moneyOf_(sum - price);
      if (setSave <= 0) continue;
      save = moneyOf_(save + setSave);
      addSetSaving_(totals, units, setSave, sum);
    }
    if (save <= 0) return [note(offer, "the bundle price is not below the items' prices — nothing to give", 0)];
    return totals.order.map(function (key) {
      return adjustmentOf_(
        offer,
        'line',
        key,
        -totals.byKey[key],
        (offer.label || 'bundle') + ' — ' + sets + ' set' + (sets === 1 ? '' : 's') + ' at ' + ctx.money(price) + ' (saves ' + ctx.money(save) + ')',
        'bundle'
      );
    });
  }
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
  function buyXGetItem_(offer, ctx, x, y, percent) {
    var rname = offer.get_item_name || 'the free item';
    var held = heldItems_(ctx, offer.get_item_id, offer);
    /* ⭐ v1.49.0 (ENG-FIX2 H8): a reward unit that ALSO qualifies is given, so it cannot be bought as well — "buy 1 get 1" with the
       same item on 2 units is ONE set (was two: both units counted as bought AND went free, the line read 0). The held reward
       units inside the qualifying pool are taken out of the bought count; a reward outside the scope is exactly what it was. */
    var heldInPool = held.reduce(function (total, item) {
      return total + (inPool(ctx.eligible, item) ? Number(item.qty) || 0 : 0);
    }, 0);
    var sets0 = setsEarned(x, y, ctx.eligibleQty, heldInPool, offer.max_sets);
    if (sets0 <= 0) return [];
    var want = sets0 * y;
    var list = [],
      left = want;
    for (var count = 0; count < held.length && left > 0; count++) {
      var takeQty = Math.min(left, held[count].qty);
      list.push(
        adjustmentOf_(
          offer,
          'line',
          held[count].key,
          -moneyOf_((unitNow(held[count]) * takeQty * percent) / 100),
          takeQty + ' × ' + freeOrOff_(percent) + ' ' + rname + ' — buy ' + x + ' get ' + y + ' (' + sets0 + ' set' + (sets0 === 1 ? '' : 's') + ')'
        )
      );
      left -= takeQty;
    }
    /* ⚠️ NAMED, AND CARRYING THE ITEM ID, so a screen can offer to add it in one press rather than
       telling somebody to go and find it. A promise the buyer cannot act on is only half kept. */
    if (left > 0) list.push(buyXRewardNote_(offer, rname, left, percent));
    return list;
  }
  /** the note for a reward item that is earned but not in the basket: named, and carrying the claim a screen adds in one press */
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
  function buyXRewardNote_(offer, rname, left, percent) {
    var earnedNote = note(offer, 'earned ' + left + ' × ' + rname + ' ' + freeOrAtOff_(percent) + ' — added to your order', 0, offer.get_item_id);
    earnedNote.claim = rewardClaim_(offer, rname, left, percent);
    return earnedNote;
  }
  /**
   * ── ⭐⭐⭐ THE SETS ARE EARNED PER PRODUCT, NOT ACROSS THE BASKET (Athi, 2026-09-10) ──────────────────
   *
   * He asked the question that found this: *"how come buy 2 get 1 free makes the price 0?"* and then said
   * what he meant by the offer: *"2 packets is ₹18, but you get 3 packs instead of 2."*
   *
   * ⚠️⚠️ THIS POOLED EVERY ELIGIBLE LINE AND GAVE AWAY THE CHEAPEST UNITS. Three Cookies at ₹31 and one
   * Cream biscuit at ₹9 made four "biscuit" units, so the set was earned by the Cookies and the free unit
   * was taken from the biscuit — a line holding one packet went to ₹0.00 having earned nothing. Correct
   * under mix-and-match, and not what the shop wrote down.
   *
   * ⭐ Athi's ruling, asked directly and knowing it costs the shop MORE (₹31 off instead of ₹9): *"we
   * cannot offer for different product."* Buying two of a thing earns a free one OF THAT THING.
   *
   * ⚠️ AND THE CATEGORY READING IS NOT WRONG, IT IS A DIFFERENT OFFER: *"in cloth line it works as per
   * category, so possibly we need to have a different naming convention to state that."* Backlogged — a
   * mix-and-match kind, named so nobody has to guess which one a shop meant. Until that exists, this kind
   * means the narrow thing, because the narrow thing cannot surprise anybody.
   *
   * ⚠️ `max_sets` STAYS A BILL-WIDE BUDGET, spent in line order. Read per line it would silently multiply
   * by the number of products on the bill — a cap of 2 on a bill of five lines would allow ten.
   */
  function buyXGetSame_(offer, ctx, x, y, percent) {
    var budget = offer.max_sets ? Number(offer.max_sets) : Infinity,
      groups = [],
      byProduct = {};
    ctx.eligible.forEach(function (item) {
      /* a PRODUCT is its item_id; a line without one stands alone */
      var product = item.item_id == null || item.item_id === '' ? 'line:' + item.key : 'item:' + item.item_id;
      if (!byProduct[product]) groups.push((byProduct[product] = { lines: [], qty: pooledQty_(item) }));
      byProduct[product].lines.push(item);
    });
    var out = [];
    groups.forEach(function (group) {
      var sets = Math.min(Math.floor(group.qty / (x + y)), budget);
      if (sets <= 0) return;
      budget -= sets;
      freeUnitsOfProduct_(offer, group.lines, { sets: sets, percent: percent, buy: x, get: y }).forEach(function (entry) {
        out.push(entry);
      });
    });
    return out;
  }
  /** the free units of one product: the CHEAPEST units across its lines (the kind's own rule), so line order never changes the answer */
  function freeUnitsOfProduct_(offer, lines, plan) {
    var left = plan.sets * plan.get;
    var cheapestFirst = lines.slice().sort(function (first, second) {
      return unitNow(first) - unitNow(second);
    });
    var out = [];
    cheapestFirst.forEach(function (item) {
      var free = Math.min(left, Number(item.qty) || 0);
      if (free <= 0) return;
      left -= free;
      out.push(
        adjustmentOf_(
          offer,
          'line',
          item.key,
          -moneyOf_((unitNow(item) * free * plan.percent) / 100),
          free + ' × ' + freeOrOff_(plan.percent) + ' — buy ' + plan.buy + ' get ' + plan.get + ' (' + plan.sets + ' set' + (plan.sets === 1 ? '' : 's') + ' of this product)',
          null,
          { free: free, sets: plan.sets, percent: plan.percent, buy: plan.buy, get: plan.get }
        )
      );
    });
    return out;
  }
  /** the free units of a mix-and-match: taken from the cheapest line first, never more than a line holds, spilling onto the next */
  function mixFreeLines_(offer, pool, plan) {
    var freeUnits = plan.sets * plan.get,
      out = [];
    for (var index = 0; index < pool.length && freeUnits > 0; index++) {
      /* ⚠️ capped at the line's OWN quantity — the free units spill onto the next-cheapest line, they do not
         take more from one line than it holds */
      var take = Math.min(freeUnits, pool[index].qty);
      out.push(
        adjustmentOf_(
          offer,
          'line',
          pool[index].key,
          -moneyOf_((unitNow(pool[index]) * take * plan.percent) / 100),
          take +
            ' × ' +
            freeOrOff_(plan.percent) +
            ' — the cheapest qualifying unit' +
            (plan.sets === 1 ? '' : 's') +
            ', across ' +
            plan.pool +
            ' in the offer',
          null,
          { free: take, sets: plan.sets, percent: plan.percent, buy: plan.buy, get: plan.get, cheapest: true, pool: plan.pool }
        )
      );
      freeUnits -= take;
    }
    return out;
  }
  /** the shipping adjustment for a charge that is not zero: free, a flat rate, or a percentage off (nothing when none applies) */
  function shippingAdjustments_(offer, ctx, ship) {
    if (offer.free) return [adjustmentOf_(offer, 'shipping', null, -moneyOf_(ship), 'free shipping')];
    if (offer.flat != null) {
      var flatSaving = ship - Number(offer.flat);
      return flatSaving > 0 ? [adjustmentOf_(offer, 'shipping', null, -moneyOf_(flatSaving), 'flat shipping at ' + ctx.money(offer.flat))] : [];
    }
    if (offer.percent) return [adjustmentOf_(offer, 'shipping', null, -moneyOf_((ship * Number(offer.percent)) / 100), offer.percent + '% off shipping')];
    return [];
  }

  /** ⭐ THE RUNNING UNIT VALUE. A line's `gross` is what it is worth after the offers already applied (decision 1, 2026-09-06); a free or
      discounted unit is valued from THAT, so a quantity break and a buy-X-get-Y on one product cannot give away more than the line holds. */
  /** is this line one of the eligible (qualifying) lines — by the key evaluate() assigned */
  function inPool(eligible, line) {
    return (eligible || []).some(function (e) {
      return e.key === line.key;
    });
  }
  /**
   * how many "buy X get Y" sets a pool of qualifying units earns when `held` of the REWARD units sit inside that pool (v1.49.0, H8): the
   * largest n with n × x bought units left after the free ones are taken — n × x ≤ pool − min(n × y, held); max_sets caps it. With the
   * reward outside the pool (held 0) it is floor(pool ÷ x), as before; with the whole line both bought and given it is floor(qty ÷ (x + y)).
   */
  function setsEarned(x, y, pool, held, maxSets) {
    var sets = Math.floor(pool / x);
    if (maxSets) sets = Math.min(sets, Number(maxSets));
    while (sets > 0 && sets * x > pool - Math.min(sets * y, held)) sets--;
    return sets;
  }
  function unitNow(line) {
    var quantity = Number(line && line.qty) || 0,
      gross = Number(line && line.gross);
    if (quantity > 0 && isFinite(gross)) return moneyOf_(gross / quantity);
    return Number(line && line.unitPrice) || 0;
  }
  /**
   * ⚠️ `detail` IS THE FACTS, `why` IS THE SENTENCE. Athi, 2026-09-10, reading a cart line: *"Rusk family offer
   * message — where from it comes, why it seems duplicated or something wrong."* The counter was printing the
   * label and then the whole of `why`, which repeats the offer's own terms: "Buy 2 biscuits, get 1 free · 1 ×
   * free — buy 2 get 1 (1 set of this product)".
   *
   * ⭐ A SCREEN CANNOT FIX THAT BY CUTTING THE PROSE UP. `why` is one string, it is written to be read whole, and
   * every word of it goes through translation — so any caller picking it apart with a regex breaks the first time
   * it is translated, silently, in the language nobody here reads. Handing over the numbers instead lets each
   * screen say as much or as little as it has room for, in its own words.
   */
  function adjustmentOf_(offer, scope, target, amount, sentence, basis, detail) {
    var adjustment = {
      offer_id: offer.id || null,
      label: offer.label || offer.kind,
      kind: offer.kind,
      scope: scope,
      target: target,
      amount: amount,
      basis: basis || 'discount',
      why: sentence
    };
    if (detail) adjustment.detail = detail;
    return adjustment;
  }
  /* A NOTE is an explanation with no money attached — "you are ₹300 away", "outside the band". It rides in the
     same list so a caller cannot show the adjustments and forget the reasons. */
  function note(offer, sentence, shortfall, target) {
    return {
      offer_id: offer.id || null,
      label: offer.label || offer.kind,
      kind: offer.kind,
      scope: 'note',
      target: target || null,
      amount: 0,
      basis: 'note',
      why: sentence,
      shortfall: shortfall || 0
    };
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
  function thresholdState(offer, ctx) {
    var state = thresholdMinimums_(offer);
    if (!state.stated || !ctx) return state;
    return thresholdMeasured_(state, ctx);
  }
  /** the minimums an offer states (spend and/or quantity), before any basket is measured against them */
  function thresholdMinimums_(offer) {
    var minA = Number(offer.min_amount != null ? offer.min_amount : offer.min_subtotal) || 0;
    var minQ = Number(offer.min_qty) || 0;
    return { minA: minA, minQ: minQ, stated: !!(minA || minQ), met: false, by: null, have: 0, gaps: [] };
  }
  /** measure the eligible basket against the minimums: met by amount, met by quantity, or both shortfalls (either one satisfies it) */
  function thresholdMeasured_(state, ctx) {
    var heldAmount = Number(ctx.eligibleSubtotal) || 0,
      heldQty = Number(ctx.eligibleQty) || 0;
    if (state.minA && heldAmount >= state.minA) {
      state.met = true;
      state.by = 'amount';
      state.have = heldAmount;
      return state;
    }
    if (state.minQ && heldQty >= state.minQ) {
      state.met = true;
      state.by = 'qty';
      state.have = heldQty;
      return state;
    }
    if (state.minA) state.gaps.push({ qty: false, short: moneyOf_(state.minA - heldAmount) });
    if (state.minQ) state.gaps.push({ qty: true, short: state.minQ - heldQty });
    return state;
  }
  function thresholdGap(needed, money) {
    return needed.qty ? needed.short + ' more item(s) needed' : money(needed.short) + ' more needed';
  }
  /** The CONDITION in words — what promise() puts in the badge, from the same fields apply() measures. */
  function thresholdCond(offer, money) {
    var state = thresholdState(offer, null),
      parts = [];
    if (state.minA) parts.push('over ' + money(state.minA));
    if (state.minQ) parts.push('of ' + state.minQ + '+ items');
    return parts.join(' or ');
  }

  /* ── conditions ─────────────────────────────────────────────────────────────────────────────────────────────
   * ⚠️ A MISSING CONDITION MEANS "NO RESTRICTION", NEVER "FAILS". An offer with no region declared applies in
   * every region; an offer with no window is always live. The opposite default would silently disable every
   * offer written before a field existed — the same rule products.js applies to a missing status.
   */
  function within(offer, ctx) {
    return windowRefusal_(offer, ctx.now) || placeRefusal_(offer, ctx) || groupRefusal_(offer, ctx);
  }
  /** the validity window: why the offer has not started or has ended, else null */
  function windowRefusal_(offer, now) {
    if (offer.valid_from && new Date(offer.valid_from) > now) return 'not started (from ' + offer.valid_from + ')';
    if (offer.valid_to) {
      /* An end DATE means the end OF that day. "valid to 31 Oct" ending at 00:00 on the 31st is the kind of
         off-by-one a customer notices and nobody can defend. */
      var end = new Date(offer.valid_to);
      if (/^\d{4}-\d{2}-\d{2}$/.test(String(offer.valid_to))) end.setUTCHours(23, 59, 59, 999);
      if (end < now) return 'expired (' + offer.valid_to + ')';
    }
    return null;
  }
  /** the region and currency gates: why the offer is for another place, else null (a field missing on either side is no restriction) */
  function placeRefusal_(offer, ctx) {
    if (offer.region && ctx.region && String(offer.region).toLowerCase() !== String(ctx.region).toLowerCase()) return 'other region (' + offer.region + ')';
    if (offer.currency && ctx.currency && String(offer.currency) !== String(ctx.currency)) return 'other currency (' + offer.currency + ')';
    return null;
  }
  /* ⭐ CUSTOMER-ONLY OFFERS FAIL CLOSED (Athi, 2026-09-06: "each customer gets a personalised discount… through the Suppliers menu").
     An offer "Only for" a group or one customer applies when the viewer's groups — what the SELLER's customer list says about
     them (lib/customer-groups), never self-asserted — include it. No groups in the context = a stranger = not eligible. The line
     this replaces let such an offer through whenever the context said nothing, which is a promise to a stranger. */
  function groupRefusal_(offer, ctx) {
    if (!offer.customer_group) return null;
    var groups = Array.isArray(ctx.customer_groups) ? ctx.customer_groups.map(String) : ctx.customer_group ? [String(ctx.customer_group)] : [];
    if (groups.indexOf(String(offer.customer_group)) < 0) return 'only for ' + (offer.customer_name || offer.customer_group);
    return null;
  }

  /* Which lines an offer touches. No selector = every line. */
  /**
   * ⭐ EVERY KEY `applies_to` MAY CARRY. Listed here, in one place, because this is the list a scope is judged
   * against — and a key added to eligibleFor without being added here would start failing closed the moment
   * somebody used it, which is the opposite mistake and just as bad.
   * ⚠️ IF YOU TEACH eligibleFor A NEW KEY, ADD IT HERE IN THE SAME EDIT.
   */
  var SCOPE_KEYS = ['item_ids', 'skus', 'category', 'category_ids', 'min_qty', 'min_qty_by_item', 'min_unit_price', 'max_unit_price'];

  /** '' when the scope is readable; otherwise the keys that mean nothing here, for the message that says so */
  function unreadableScope(offer) {
    var scope = offer && offer.applies_to;
    if (!scope || typeof scope !== 'object') return ''; /* absent = every line, which is a real scope */
    var keys = Object.keys(scope).filter(function (item) {
      return scope[item] != null && scope[item] !== '';
    });
    if (!keys.length) return ''; /* written but empty = every line, same as absent */
    var known = keys.filter(function (item) {
      return SCOPE_KEYS.indexOf(item) >= 0;
    });
    if (known.length) return ''; /* at least one key narrows it — that is a scope */
    return keys.join(', ');
  }

  function eligibleFor(offer, lines) {
    var scope = offer.applies_to;
    /* ⭐ THE OVERRIDE. Governance flows one way — a category offer reaches every product under it — and the product's
       only answer is an explicit opt-out: `item_data.offers_excluded` = [offer ids], carried on the line as
       `excluded`. Athi, 2026-09-04: "no two directions — governance or override". */
    /* '*' = every offer (the item's "Shown to customers" switch for offers is off — lib/exposure.js) */
    lines = lines.filter(function (item) {
      return !isExcluded_(offer, item);
    });
    if (!scope) return lines.slice();
    var inScope = lines.filter(function (item) {
      if (!inLists(scope, item)) return false;
      if (scope.min_unit_price != null && item.unitPrice < Number(scope.min_unit_price)) return false;
      if (scope.max_unit_price != null && item.unitPrice > Number(scope.max_unit_price)) return false;
      return true;
    });
    /* ⭐ A MINIMUM ORDER SIZE (Athi, 2026-09-06): "10% off when you take 5 or more" — the PRODUCT's quantity must reach it. Lines of the SAME
       item_id count together (M4a, 2026-11-12: the same product scanned twice is five of it; money-critic M4a); a basket of 3 of A + 2 of B still
       does not make five of anything: different items never sum. */
    return inScope.filter(function (item) {
      var minimumQty = minQtyFor(offer, item);
      return !(minimumQty > 0 && sameItemQty_(inScope, item) < minimumQty);
    });
  }

  /* ⭐ TARGETS ARE A UNION. An offer ticked on a product AND scoped to a category reaches the product even when it
     sits elsewhere (Athi, 2026-09-05: "adi offer 2 — not applied — no line qualifies" on a rice product he had
     ticked it on; the offer was also scoped to Fruits & Vegetables). item_ids · skus · category / category_ids:
     if ANY of the lists is present, the line must be in AT LEAST ONE of them. The price bounds in eligibleFor stay AND.
     Lifted out of eligibleFor (v1.46.0) so covers() asks the SAME question — one scope test, not two. */
  function catsOf_(scope) {
    return [].concat(scope.category ? [String(scope.category)] : [], Array.isArray(scope.category_ids) ? scope.category_ids.map(String) : []);
  }
  function inLists(scope, line) {
    var hits = [listHit_(scope.item_ids, line, 'item_id'), listHit_(scope.skus, line, 'sku'), categoryHit_(catsOf_(scope), line)];
    var asked = hits.filter(function (answer) {
      return answer !== null;
    });
    return asked.length === 0 || asked.indexOf(true) >= 0;
  }
  /** null when the scope names no such id list; else whether this line's value is in it */
  function listHit_(list, line, field) {
    if (!(Array.isArray(list) && list.length)) return null;
    return list.map(String).indexOf(String(line[field])) >= 0;
  }
  /** null when the scope names no category; else whether the line sits in at least one of them */
  function categoryHit_(wantCats, line) {
    if (!wantCats.length) return null;
    var lineCats = (line.categories || (line.category ? [line.category] : [])).map(String);
    return wantCats.some(function (item) {
      return lineCats.indexOf(item) >= 0;
    });
  }

  /**
   * ── ⭐⭐ DOES THIS OFFER REACH THAT ITEM? — covers(offer, item) (v1.46.0) ──────────────────────────────────────
   *
   * `item` is { item_id, sku, category | categories } — a catalogue row, no quantity and no price. The answer is the
   * scope alone: the same union of lists evaluate() judges a line by, a product's own opt-out (`excluded`) included,
   * and a scope this engine cannot read reaches NOTHING (evaluate() refuses it the same way). The quantity and price
   * bounds are not asked: they decide whether a BASKET earns the offer, not whether the item is on its shelf.
   */
  function covers(offer, item) {
    if (!offer || !item) return false;
    if (unreadableScope(offer)) return false;
    if (isExcluded_(offer, item)) return false;
    return offer.applies_to ? inLists(offer.applies_to, item) : true;
  }

  /**
   * ── ⭐⭐ TWO OFFERS ON ONE SHELF — overlaps(a, b, items) and clashes(o, others, items) (v1.46.0) ──────────────────
   *
   * commercetools' rule, adopted: only ONE item-level discount may apply to an item; bill-level ones can stack. So two
   * live item-level discounts that reach the same item are a collision worth NAMING before they run, not a race the
   * stacking order settles in silence. This was the Offer Lab's own private test (offer-lab-next.html, 2026-09-26);
   * it lives here so the lab, the shelf and the SERVER's save (api routes/definitions.js) ask one question.
   *
   * overlaps(a, b, items) → the items (from `items`, a catalogue: [{ item_id, sku, category | categories }]) both
   *   reach, or `true` when they overlap without a catalogue to name them (the same category, the same id, or an
   *   offer with no scope at all), or `false`. An item list and a category list need the catalogue to meet.
   * clashes(o, others, items) → [{ offer, items }] — the others that are ALSO item-level discounts and overlap o.
   *   Which statuses count (live, draft…) is the caller's: the engine knows offers, not a shelf's workflow.
   */
  var ITEM_LEVEL = { percent_off: 1, amount_off: 1, tier_price: 1 };
  function itemLevel(offer) {
    return !!(offer && ITEM_LEVEL[offer.kind] && offer.scope !== 'cart' && offer.scope !== 'shipping');
  }
  function ids_(scope, listName) {
    return scope && Array.isArray(scope[listName]) ? scope[listName].map(String) : [];
  }
  function overlaps(offerA, offerB, items) {
    if (!bothReadable_(offerA, offerB)) return false;
    var list = Array.isArray(items) ? items : [];
    var both = list.filter(function (item) {
      return covers(offerA, item) && covers(offerB, item);
    });
    if (both.length) return both;
    return scopesMeet_(offerA, offerB);
  }
  /** are both offers present with a scope this engine can read? */
  function bothReadable_(offerA, offerB) {
    return !!offerA && !!offerB && !unreadableScope(offerA) && !unreadableScope(offerB);
  }
  /** an offer that reaches everything: a readable scope that names no item, sku or category */
  function scopeIsWide_(offer) {
    return (
      !unreadableScope(offer) && !(ids_(offer.applies_to, 'item_ids').length || ids_(offer.applies_to, 'skus').length || catsOf_(offer.applies_to || {}).length)
    );
  }
  /** do two lists share at least one entry? */
  function sharesAny_(listA, listB) {
    return listA.some(function (item) {
      return listB.indexOf(item) >= 0;
    });
  }
  /** with no item of the catalogue reached by both: do the scopes still meet (either one is wide, or they name the same thing)? */
  function scopesMeet_(offerA, offerB) {
    /* no item of the catalogue given is reached by both — they still meet if their lists name the same thing (a partial
       catalogue, such as the server's few rows, must not hide two offers on one category) */
    var scopeA = offerA.applies_to || {},
      scopeB = offerB.applies_to || {};
    if (scopeIsWide_(offerA) || scopeIsWide_(offerB)) return true;
    return (
      sharesAny_(ids_(scopeA, 'item_ids'), ids_(scopeB, 'item_ids')) ||
      sharesAny_(ids_(scopeA, 'skus'), ids_(scopeB, 'skus')) ||
      sharesAny_(catsOf_(scopeA), catsOf_(scopeB))
    );
  }
  function clashes(offer, others, items) {
    if (!itemLevel(offer)) return [];
    return (others || [])
      .filter(function (x) {
        return x && x !== offer && (x.id == null || String(x.id) !== String(offer.id)) && itemLevel(x);
      })
      .map(function (x) {
        var overlap = overlaps(offer, x, items);
        return overlap ? { offer: x, items: overlap === true ? [] : overlap } : null;
      })
      .filter(Boolean);
  }

  /**
   * compound(percents) → the one percentage that many percentages come to when each is taken on what the last left —
   * the stacking rule evaluate() applies to percent_off offers (percent on percent: 10% then 10% is 19%, never 20%).
   * For a screen that shows the combined figure before anything is in a basket (the Offer Lab's offer + loyalty).
   * Not rounded: the caller rounds what it shows.
   */
  function compound(percents) {
    var keep = (percents || []).reduce(function (total, item) {
      var x = Math.min(100, Math.max(0, Number(item) || 0));
      return total * (1 - x / 100);
    }, 1);
    return (1 - keep) * 100;
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
  function promise(offer, ctx) {
    if (!offer) return null;
    var context = Object.assign({ now: new Date() }, ctx || {});
    if (within(offer, context) !== null) return null;
    return terms(offer, context);
  }
  /**
   * terms(o, ctx) → the same sentence as promise(), WITHOUT the window gate — for a register that lists what an
   * offer says even when it is scheduled or expired (Setup › Offers, 2026-09-05). A badge must stay gated
   * (promise); a management list must not, or a future offer reads as an empty row.
   */
  function terms(offer, ctx) {
    if (!offer) return null;
    var context = Object.assign({ now: new Date() }, ctx || {});
    /* ⚠️ The SAME gate evaluate() uses. A second copy of "is this live?" is how a badge and a basket come to
       disagree about the same offer on the same screen. */
    var money =
      typeof context.money === 'function'
        ? context.money
        : function (figure) {
            return String(figure);
          };
    var percent = Number(offer.percent) || 0;
    var amount = Number(offer.amount) || 0;
    return kindTerms_(offer, context, money, percent, amount);
  }
  /** the sentence for one kind of offer (null for the kinds that advertise nothing on a row) */
  function kindTerms_(offer, context, money, percent, amount) {
    switch (offer.kind) {
      case 'percent_off':
        return percentOffTerms_(offer, context, percent);
      case 'amount_off':
        return amountOffTerms_(offer, context, money, amount);
      case 'tier_price':
        return tierTerms_(offer, context, money);
      case 'threshold':
        return thresholdTerms_(offer, money, percent, amount);
      case 'buy_x_get_y':
        return buyXTerms_(offer);
      case 'mix_and_match':
        return mixTerms_(offer);
      /* ⚠️ Shipping is an ORDER-level benefit and belongs on the basket, not on a product row: a single item
         cannot promise free delivery on its own, and saying so per row would be a promise the line cannot keep. */
      case 'shipping':
        return null;

      case 'price_range':
        return null; /* a band is the price, not a discount off one — the row already shows it */

      default:
        return null;
    }
  }
  /* a basket-level offer says so — "25% off the order total" (Athi, 2026-09-06: the tag must carry the offer's detail) */
  /* the condition rides the sentence — "10% off 5+" — a badge never promises what the basket will refuse */
  function percentOffTerms_(offer, context, percent) {
    return percent > 0 ? percent + '% off' + (offer.scope === 'cart' ? ' the order total' : '') + minQtyWords(offer, context) : null;
  }
  /* ⭐ "₹20 off each" and "₹20 off" are different offers, so the promise says which — a badge that hides the
     difference is the ambiguity that made the author and the engine mean two things (observation 6, div F). */
  function amountOffTerms_(offer, context, money, amount) {
    return amount > 0
      ? money(amount) + ' off' + (offer.scope === 'cart' ? ' the order total' : String(offer.per || '') === 'item' ? ' each' : '') + minQtyWords(offer, context)
      : null;
  }
  /**
   * ⭐ THE QUANTITY BREAK IS THE ONE THAT MOST NEEDS ITS CONDITION. "₹170 each" is a lie without "from 10";
   * the buyer is looking at a row priced ₹180 and would read the badge as the price they pay for one.
   */
  function tierTerms_(offer, context, money) {
    var tiers = sortedTiers_(offer.tiers);
    /* ⚠️ A BREAK THAT CANNOT FIRE MUST NOT BE ADVERTISED (Athi, 2026-09-06 22:47: one break of "₹180 each from 5" was offered on every
       product, Rice at ₹80 included — apply() refuses to raise a price, so the badge promised what the basket would decline).
       When the caller names the row (forLine passes ctx.line), only a break BELOW that row's own price may be promised. */
    var linePrice = rowPriceOf_(context);
    if (linePrice)
      tiers = tiers.filter(function (item) {
        var tierPrice = tierPriceOf(item, linePrice);
        return tierPrice != null && tierPrice < linePrice;
      });
    var first = tiers[0];
    if (!first || !first.qty) return null;
    /* ⭐ SAY IT THE WAY IT WAS WRITTEN (Athi, 2026-09-06 23:52). A ladder of percentages reads as percentages — "5% off from 3, up to 15%" —
       because a price quoted beside a row that still costs the list price reads as the price you pay now. A slab written as a price each
       keeps saying the price each, which is what that seller meant. */
    if (tierPercentOf(first) != null && first.price == null) return tierPercentTerms_(tiers, first);
    return tierPriceTerms_(tiers, first, linePrice, money);
  }
  /** the row's own unit price when the caller names the row (forLine passes ctx.line), else 0 */
  function rowPriceOf_(context) {
    return context.line && Number(context.line.unitPrice) > 0 ? Number(context.line.unitPrice) : 0;
  }
  /** a ladder of percentages: "5% off from 3, up to 15% off" */
  function tierPercentTerms_(tiers, first) {
    var top = tiers[tiers.length - 1],
      topPercent = Number(tierPercentOf(top)) || 0,
      firstPercent = Number(tierPercentOf(first)) || 0;
    return firstPercent + '% off from ' + first.qty + (tiers.length > 1 && topPercent > firstPercent ? ', up to ' + topPercent + '% off' : '');
  }
  /** a slab written as a price: "₹170 each from 10 (3 price breaks)" */
  function tierPriceTerms_(tiers, first, linePrice, money) {
    var shown = tierPriceOf(first, linePrice || Number(first.price) || 0);
    if (shown == null) return null;
    return money(shown) + ' each from ' + first.qty + (tiers.length > 1 ? ' (' + tiers.length + ' price breaks)' : '');
  }
  /** "10% off orders over ₹500": the threshold's reward and its condition, from the same fields apply() measures */
  function thresholdTerms_(offer, money, percent, amount) {
    /* ⚠️ THE SAME FIELDS apply() MEASURES — see thresholdState. This read `min_subtotal`, which nothing writes. */
    if (!thresholdState(offer, null).stated) return null;
    var give = percent > 0 ? percent + '% off' : amount > 0 ? money(amount) + ' off' : null;
    return give ? give + ' orders ' + thresholdCond(offer, money) : null;
  }
  /** "Buy 3 get 1 free", or "Buy 3 get 1 <reward item> free" when the reward is a different product */
  function buyXTerms_(offer) {
    var x = Number(offer.buy) || 0,
      y = Number(offer.get) || 0;
    if (!x || !y) return null;
    /* ⭐ NAME THE REWARD when it is a different product — "Buy 3 get 1 free" beside a bag of rice reads as
       a fourth bag, which is not what is on offer. */
    if (offer.get_item_id) return 'Buy ' + x + ' get ' + y + ' ' + (offer.get_item_name || 'free item') + ' free';
    return 'Buy ' + x + ' get ' + y + ' free';
  }
  /**
   * ⚠️⚠️ THE BADGE MUST SAY "ANY", or the two kinds are indistinguishable on a shelf — and a customer who
   * reads "Buy 2 get 1 free" on a ₹500 shirt and is given a ₹200 one free has been told the wrong thing by
   * us, not by the shop. The scope's own word is used when there is one ("any 2 in Shirts"), because
   * mix-and-match without naming what it mixes across is only half a promise.
   */
  function mixTerms_(offer) {
    var mixBuy = Number(offer.buy) || 0,
      mixGet = Number(offer.get) || 0;
    if (!mixBuy || !mixGet) return null;
    var where = mixScopeWord_(offer);
    return (
      'Buy any ' +
      mixBuy +
      (where ? ' in ' + where : '') +
      ', get ' +
      mixGet +
      (Number(offer.get_percent) >= 0 && Number(offer.get_percent) !== 100 ? ' at ' + Number(offer.get_percent) + '% off' : ' free') +
      ' — the cheapest'
    );
  }
  /** the word naming what a mix-and-match mixes across: its category, or '' */
  function mixScopeWord_(offer) {
    return (offer.applies_to && (offer.applies_to.category || (Array.isArray(offer.applies_to.category_ids) && offer.applies_to.category_ids[0]))) || '';
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
    var rowLine = line || {};
    var out = [];
    for (var index = 0; index < (offers || []).length; index++) {
      var entry = rowPromise_(rowLine, offers[index], ctx);
      if (entry) out.push(entry);
    }
    return out;
  }
  /** one offer's honest advertisement for one row, { offer_id, label, promise, kind }, or null (basket-level, not for this row, or it cannot fire) */
  function rowPromise_(rowLine, offer, ctx) {
    /* Cart-scope offers describe the ORDER, not this product — they belong on the basket. A SPEND THRESHOLD is one of them (Athi,
       2026-09-06 23:1x: "drop the row badge, keep threshold at cart level only"): the basket says how far the order is from it, which is
       where a shopper can act on it; a row promising "10% off orders over ₹500" cannot say whether this order will get there. */
    if (offer && isBasketLevel_(offer)) return null;
    if (!eligibleFor(offer, [Object.assign({ qty: Math.max(1, minQtyFor(offer, rowLine) || 1) }, rowLine)]).length)
      return null; /* the row may advertise "10% off 5+"; the basket enforces the 5 */
    var promised = promise(offer, Object.assign({}, ctx, { line: rowLine }));
    if (!promised) return null;
    return { offer_id: offer.id, label: offer.label || promised, promise: promised, kind: offer.kind };
  }
  /** is this offer about the ORDER (cart scope, or a spend threshold) rather than a product? */
  function isBasketLevel_(offer) {
    return offer.scope === 'cart' || offer.kind === 'threshold';
  }

  /** Does any live offer touch this row? The "On offer" filter, computed the same way the badge is. */
  function onOffer(line, offers, ctx) {
    return forLine(line, offers, ctx).length > 0;
  }

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
  /** the most an adjustment may take: a line's running net, the eligible lines' running sum for a basket-level one, no limit for shipping */
  function roomFor(adjustment, runningNet, elig) {
    if (adjustment.scope === 'line') return adjustment.target != null && runningNet[adjustment.target] != null ? runningNet[adjustment.target] : null;
    if (adjustment.scope === 'cart')
      return moneyOf_(
        elig.reduce(function (total, item) {
          return total + (runningNet[item.key] || 0);
        }, 0)
      );
    return null;
  }
  /** allocate a basket-level amount across the eligible lines by their running net — the last line takes the rounding remainder, no line
      goes below 0, and the adjustment is trimmed to what actually came off (v1.49.0), so the lines always explain the total */
  function allocateCart(adjustment, runningNet, elig, cartShares) {
    var give = Math.abs(Number(adjustment.amount) || 0),
      base = elig.reduce(function (total, item) {
        return total + (runningNet[item.key] || 0);
      }, 0),
      left = give,
      given = 0;
    elig.forEach(function (item, index) {
      var have = runningNet[item.key] || 0;
      var share = index === elig.length - 1 ? moneyOf_(left) : base > 0 ? moneyOf_((give * have) / base) : 0;
      if (share > have) share = moneyOf_(have);
      left = moneyOf_(left - share);
      if (share <= 0) return;
      runningNet[item.key] = moneyOf_(have - share);
      given = moneyOf_(given + share);
      (cartShares[item.key] = cartShares[item.key] || []).push({
        offer_id: adjustment.offer_id || null,
        label: adjustment.label,
        kind: adjustment.kind,
        amount: -share
      });
    });
    if (given < give) {
      adjustment.amount = -given;
      adjustment.capped = true;
    }
  }
  /** v1.49.0 (M4): a percentage above 100 is not a discount — the offer is refused in words, never applied as a credit */
  function overHundred(offer) {
    var fields = ['percent', 'get_percent'];
    for (var index = 0; index < fields.length; index++) {
      var value = offer[fields[index]];
      if (value != null && value !== '' && Number(value) > 100)
        return fields[index].replace('_', ' ') + ' ' + value + ' is more than 100 — a discount cannot exceed the price, so this offer was not applied';
    }
    return null;
  }

  function evaluate(input) {
    input = input || {};
    var lines = (input.lines || []).map(normaliseLine_);
    var ctx = evaluationContext_(input);
    var subtotal = moneyOf_(
      lines.reduce(function (total, item) {
        return total + item.gross;
      }, 0)
    );

    var offers = (input.offers || []).slice().sort(compareOffers_);
    /* ⭐ THE RUNNING NET PER LINE — what each line is worth after the offers applied so far. A percentage is taken on it (percent on percent),
       an amount is capped at it, a basket-level offer is measured on the sum of it and ALLOCATED across the eligible lines by it. The
       engine hands `line_net` and `cart_shares` out, so every reader (row, tax, the recording at send) uses this one rule. */
    var pass = { ctx: ctx, lines: lines, net: {}, cartShares: {}, adjustments: [], notes: [], skipped: [] };
    lines.forEach(function (item) {
      pass.net[item.key] = item.gross;
    });
    applyOffers_(pass, offers);
    return evaluationResult_(pass, subtotal);
  }
  /** one input line rebuilt from the fields the rules read: key, ids, categories, opt-outs, quantity, unit price, gross */
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
  function normaliseLine_(item, index) {
    var quantity = Number(item.qty) || 0,
      unitPrice = Number(item.unitPrice) || 0;
    var cats = Array.isArray(item.categories) ? item.categories.map(String) : item.category ? [String(item.category)] : [];
    return {
      key: item.key == null ? String(index) : item.key,
      item_id: item.item_id,
      sku: item.sku,
      category: item.category,
      categories: cats,
      excluded: Array.isArray(item.excluded) ? item.excluded.map(String) : [],
      qty: quantity,
      unitPrice: unitPrice,
      gross: moneyOf_(quantity * unitPrice)
    };
  }
  /** the context object `ctx` may be passed inside the input; an absent or non-object one reads as empty */
  function inputContextOf_(input) {
    return input.ctx && typeof input.ctx === 'object' ? input.ctx : {};
  }
  /** the viewer's customer groups: the list on the input, else the one on its ctx, else none */
  function customerGroupsOf_(input, inputCtx) {
    return Array.isArray(input.customer_groups) ? input.customer_groups : Array.isArray(inputCtx.customer_groups) ? inputCtx.customer_groups : [];
  }
  /** the shipping charge: the input's figure, else the ctx's, as a number (0 when neither is a number) */
  function shippingOf_(input, inputCtx) {
    return Number(input.shipping != null ? input.shipping : inputCtx.shipping) || 0;
  }
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
  function moneyFormatterOf_(input, inputCtx) {
    return (
      input.money ||
      inputCtx.money ||
      function (amount) {
        var currency = input.currency || inputCtx.currency || '';
        if (currency && typeof CBLocale !== 'undefined') {
          try {
            return CBLocale.money(moneyOf_(amount), currency);
          } catch (_) {
            return unlabelledMoney_(amount, currency);
          }
        }
        return unlabelledMoney_(amount, currency);
      }
    );
  }
  /** an amount with the currency code beside it, or a plain number marked as having no stated currency */
  function unlabelledMoney_(amount, currency) {
    return currency ? currency + ' ' + moneyOf_(amount) : moneyOf_(amount) + ' (currency not stated)';
  }
  /* ⚠️ THE CALLERS PASS `ctx: { now, currency, customer_groups, money }` AND THIS READ ONLY TOP-LEVEL FIELDS — so every context a cart
     sent was silently ignored: currency fell to '', now to the clock, and (2026-09-06, found by [OFF-03]) the viewer's groups never
     reached within(), so a customer-only offer printed its badge (forLine takes ctx directly) and never priced. Both shapes are read now;
     a top-level field still wins. */
  function evaluationContext_(input) {
    var inputCtx = inputContextOf_(input);
    return {
      now: input.now || inputCtx.now ? new Date(input.now || inputCtx.now) : new Date(),
      region: input.region || inputCtx.region,
      currency: input.currency || inputCtx.currency,
      customer_group: input.customer_group || inputCtx.customer_group,
      customer_groups: customerGroupsOf_(input, inputCtx),
      shipping: shippingOf_(input, inputCtx),
      money: moneyFormatterOf_(input, inputCtx)
    };
  }
  /** the stacking order: exclusive first, then `priority` (low first), then line-level before basket-level, then percentages before amounts */
  function compareOffers_(first, second) {
    /* ⭐ EXCLUSIVE MEANS "INSTEAD OF THE OTHERS" (Athi, 2026-09-06 19:29: an exclusive 25% for one customer, and the Flat 10% still applied
       because it ran first at order 0). An exclusive offer runs before every non-exclusive one, whatever the stacking numbers say; among
       exclusives, and among the rest, the stacking order decides. So when it fires, nothing else applies — and the notes say why. */
    var exclusiveRankA = first.exclusive ? 0 : 1,
      exclusiveRankB = second.exclusive ? 0 : 1;
    if (exclusiveRankA !== exclusiveRankB) return exclusiveRankA - exclusiveRankB;
    var priorityA = Number(first.priority) || 0,
      priorityB = Number(second.priority) || 0;
    if (priorityA !== priorityB) return priorityA - priorityB;
    /* line-level offers before basket-level ones at the same order: a basket offer is taken on the subtotal AFTER the lines are finished */
    var basketRankA = isBasketLevel_(first) ? 1 : 0,
      basketRankB = isBasketLevel_(second) ? 1 : 0;
    if (basketRankA !== basketRankB) return basketRankA - basketRankB;
    /* ⭐ THE INDUSTRY STANDARD (Athi, 2026-09-06 20:0x): offers apply in order, each on the RUNNING amount. At equal stacking order the
       result must not depend on how the array happened to be listed: percentages before amounts, then the rest. */
    return kindRank_(first) - kindRank_(second);
  }
  /** 0 for the percentage-style kinds, 1 for amount off, 2 for the rest: the order they run at equal stacking order */
  function kindRank_(offer) {
    var rankOf = { percent_off: 0, tier_price: 0, amount_off: 1 };
    return rankOf[offer.kind] != null ? rankOf[offer.kind] : 2;
  }
  /** note that an offer was not applied, and why */
  function skipOffer_(pass, offer, reason) {
    pass.skipped.push({ offer_id: offer.id, label: offer.label, why: reason });
  }
  /** apply the offers in stacking order; once an exclusive offer has moved something, every later one is skipped and says so */
  function applyOffers_(pass, offers) {
    var stop = false;
    offers.forEach(function (item) {
      if (stop) {
        skipOffer_(pass, item, 'an exclusive offer already applied');
        return;
      }
      var picked = qualifyOffer_(pass, item);
      if (!picked) return;
      var moved = foldAdjustments_(pass, askKind_(pass, item, picked.kind, picked.elig), picked.elig);
      if (moved && item.exclusive) stop = true;
    });
  }
  /** step 1 — may this offer run on this basket? Answers { kind, elig } or null (the reason is already in `skipped`). */
  /**
   * ── ⚠️⚠️ A SCOPE THIS ENGINE CANNOT READ IS NOT A SCOPE OF "EVERYTHING" ─────────────────────────────────
   *
   * Found 2026-09-10, and only because I mistyped a test: I wrote `applies_to: { categories: [...] }` where
   * eligibleFor reads `category` / `category_ids`. It recognised no list, so `lists` stayed 0, so the "must
   * be in at least one list" test never ran — and a BISCUITS-only offer silently applied to the whole
   * basket. Hair oil and shampoo counted as biscuits: ₹40 off a bill that owed ₹9.
   *
   * ⭐⭐ THE FAILURE MODE IS THE WORST ONE AVAILABLE: it is silent, it is in the shop's disfavour, and it
   * scales with the size of the basket. Athi's fear about this product, in his own words, is *"if someone
   * uses this product and if they lose money, I have to pay or I have to go to prison."* An offer whose
   * scope we cannot read is exactly that, and it needs no bug elsewhere to happen — one renamed field, one
   * import written by hand, one integration spelling a word the plural way.
   *
   * ⚠️ DELIBERATELY NOT "ALSO ACCEPT `categories`". Athi, asked directly, chose the strict answer: refuse.
   * Accepting the plural would fix today's spelling and leave the class of fault in place — the next
   * unrecognised key would fail open just as quietly. A misspelling must be LOUD.
   *
   * ⚠️ AN ABSENT OR EMPTY `applies_to` STILL MEANS EVERYTHING. That is a real, intended scope ("10% off the
   * whole shop") and is not what this catches. This catches an applies_to that was WRITTEN, carries keys,
   * and says nothing this engine understands — i.e. somebody meant to narrow it and we cannot tell how.
   */
  function qualifyOffer_(pass, offer) {
    var kind = KINDS[offer.kind];
    if (!kind) {
      skipOffer_(pass, offer, 'unknown kind: ' + offer.kind);
      return null;
    }
    var refusal = within(offer, pass.ctx) || overHundred(offer);
    if (refusal) {
      skipOffer_(pass, offer, refusal);
      return null;
    }
    var unreadable = unreadableScope(offer);
    if (unreadable) {
      skipOffer_(pass, offer, 'scope not understood, so it was not applied: ' + unreadable);
      return null;
    }

    var elig0 = eligibleFor(offer, pass.lines);
    if (!elig0.length) {
      skipOffer_(pass, offer, 'no line qualifies');
      return null;
    }
    /* the kind sees each eligible line at its RUNNING worth (`gross`), with the list figure beside it (`list_gross`); unitPrice stays the list price a tier or a free unit is valued at */
    var elig = elig0.map(function (entry) {
      return Object.assign({}, entry, { list_gross: entry.gross, gross: moneyOf_(pass.net[entry.key]), item_qty: sameItemQty_(elig0, entry) });
    });
    return { kind: kind, elig: elig };
  }
  /** step 2 — ask the kind for its adjustments on the eligible lines. */
  /**
   * ⚠️ EVERY line, not only the qualifying ones — a cross-item reward ("buy rice, get oil free") has to
   * look for the OIL, which by definition is not in the set that qualified. This is the second half of
   * the two-place change the normaliser above warns about: a rule that reads something the ctx does not
   * carry fails silently, with no missing property anywhere to find.
   */
  function askKind_(pass, offer, kind, elig) {
    return (
      kind.apply(offer, {
        eligible: elig,
        eligibleSubtotal: moneyOf_(
          elig.reduce(function (total, entry) {
            return total + entry.gross;
          }, 0)
        ),
        eligibleQty: elig.reduce(function (total, entry) {
          return total + entry.qty;
        }, 0),
        all: pass.lines,
        shipping: pass.ctx.shipping,
        money: pass.ctx.money,
        now: pass.ctx.now
      }) || []
    );
  }
  /** step 3 — fold the kind's answers into adjustments / notes / the running net; answers whether anything moved. */
  function foldAdjustments_(pass, out, elig) {
    var moved = false;
    out.forEach(function (entry) {
      if (foldAdjustment_(pass, entry, elig)) moved = true;
    });
    return moved;
  }
  /** fold one answer: a note goes to the notes; an adjustment is capped at what it lands on, recorded, and taken off the running net */
  function foldAdjustment_(pass, entry, elig) {
    if (entry.basis === 'note') {
      pass.notes.push(entry);
      return false;
    }
    /* ⭐ v1.49.0 (ENG-FIX2 M4): NOTHING IS WORTH MORE THAN WHAT IT LANDS ON. A reward valued at the LIST price (a threshold's free item, a
       cross-item free unit, a tier after a percent) landed on a line already discounted: the line floored at 0 but `goods_adjustment`
       and `total` summed the uncapped amounts, so the OTHER lines were under-charged (R 50% off + "R free" + S: total 50, lines 100).
       Capped here, in the one fold every adjustment passes, at the line's running net or the eligible lines' running sum — and SAID. */
    var room = roomFor(entry, pass.net, elig);
    if (room !== null && -entry.amount > room) {
      if (room <= 0) {
        pass.skipped.push({ offer_id: entry.offer_id, label: entry.label, why: 'nothing left to take off — ' + entry.why });
        return false;
      }
      entry.amount = -moneyOf_(room);
      entry.capped = true;
      entry.why += ' (capped at what it is now worth, ' + pass.ctx.money(moneyOf_(room)) + ')';
    }
    pass.adjustments.push(entry);
    if (entry.scope === 'line' && entry.target != null && pass.net[entry.target] != null)
      pass.net[entry.target] = Math.max(0, moneyOf_(pass.net[entry.target] + entry.amount));
    else if (entry.scope === 'cart') allocateCart(entry, pass.net, elig, pass.cartShares);
    return true;
  }
  /** the sum of the adjustments' amounts: the shipping ones when `shippingOnly`, else every other */
  function adjustmentTotal_(adjustments, shippingOnly) {
    return moneyOf_(
      adjustments
        .filter(function (item) {
          return (item.scope === 'shipping') === shippingOnly;
        })
        .reduce(function (total, item) {
          return total + item.amount;
        }, 0)
    );
  }
  /** the audit trail: every applied offer, every note, every rejected offer, with the reason for each */
  function explainLines_(pass) {
    return pass.adjustments
      .map(function (item) {
        return item.label + ': ' + item.why;
      })
      .concat(
        pass.notes.map(function (item) {
          return item.label + ' — ' + item.why;
        })
      )
      .concat(
        pass.skipped.map(function (item) {
          return (item.label || item.offer_id) + ' not applied — ' + item.why;
        })
      );
  }
  /** the breakdown evaluate() returns: totals, the running net per line, each line's share of every basket-level offer, and the audit trail */
  function evaluationResult_(pass, subtotal) {
    var goods = adjustmentTotal_(pass.adjustments, false);
    var shipAdj = adjustmentTotal_(pass.adjustments, true);
    return {
      subtotal: subtotal,
      adjustments: pass.adjustments,
      notes: pass.notes,
      skipped: pass.skipped,
      goods_adjustment: goods,
      /* the running net per line after everything, and each line's share of every basket-level offer — the one allocation rule */
      line_net: pass.net,
      cart_shares: pass.cartShares,
      shipping: moneyOf_(pass.ctx.shipping + shipAdj),
      /* ⚠️ Never below zero. Adjustments are capped individually, but stacking several could still overshoot, and
         a negative total is not a refund — it is a bug that looks like one. */
      total: Math.max(0, moneyOf_(subtotal + goods + pass.ctx.shipping + shipAdj)),
      /* ⭐ THE AUDIT TRAIL. Every applied offer, every rejected one, and the reason for both — this is what makes
         a price defensible six months later, and it is why `skipped` is returned rather than discarded. */
      explain: explainLines_(pass)
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
    return ((res && res.notes) || [])
      .map(function (item) {
        return item.claim;
      })
      .filter(Boolean);
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
    (lines || []).forEach(function (item, index) {
      gross[item.key == null ? String(index) : String(item.key)] = moneyOf_((Number(item.qty) || 0) * (Number(item.unitPrice) || 0));
    });
    var out = {};
    ((res && res.adjustments) || []).forEach(function (item) {
      accumulateLine_(out, item);
    });
    if (lines)
      Object.keys(out).forEach(function (item) {
        var lineGross = gross[item];
        if (lineGross == null) return;
        if (out[item].off > lineGross) {
          out[item].off = lineGross;
          out[item].capped = true;
        }
      });
    return out;
  }
  /** add one line-scope adjustment onto the line it names (offers, last reason and label, total taken off) */
  function accumulateLine_(out, item) {
    if (item.scope !== 'line' || item.target == null) return;
    var takenOff = Math.abs(Number(item.amount) || 0);
    if (!takenOff) return;
    var row = lineRow_(out, String(item.target));
    row.off = moneyOf_(row.off + takenOff);
    row.why = item.why || '';
    row.offer_id = item.offer_id || null;
    row.label = item.label || '';
    if (item.offer_id && row.offers.indexOf(item.offer_id) < 0) row.offers.push(item.offer_id);
  }
  /** the accumulated row for a line key, created empty on first use */
  function lineRow_(out, key) {
    return out[key] || (out[key] = { off: 0, why: '', offer_id: null, label: '', offers: [], capped: false });
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
    var count = 0,
      perUnit = Number(unitPrice) || 0;
    [].concat(offers || []).forEach(function (item) {
      if (!item) return;
      var state = thresholdState(item, null);
      if (state.minQ) count = Math.max(count, state.minQ);
      if (state.minA && perUnit > 0) count = Math.max(count, Math.ceil(state.minA / perUnit));
      if (item.buy) count = Math.max(count, (Number(item.buy) || 0) + (item.get_item_id ? 0 : Number(item.get) || 0));
      (item.tiers || []).forEach(function (entry) {
        if (entry && entry.qty) count = Math.max(count, Number(entry.qty) || 0);
      });
    });
    /* ⚠️ Capped. A tier that starts at 5,000 must not produce a "5,000 ×" example nobody can read. */
    return count > 1 ? Math.min(count, 999) : 3;
  }

  /**
   * timeStatus(o, now) → 'scheduled' | 'active' | 'expired' — the TIME axis, separate from the lifecycle (draft ·
   * live · retired). The words are the ones Shopify, WooCommerce and Google Merchant promotions use, adopted as-is
   * (Athi, 2026-09-05: "futuristic, current, expired — is there a standard term?"). Derived from within(), so the
   * chip and the basket can never disagree about a date.
   */
  function timeStatus(offer, now) {
    var gate = within(offer || {}, { now: now || new Date() });
    if (gate === null) return 'active';
    if (/^not started/.test(gate)) return 'scheduled';
    if (/^expired/.test(gate)) return 'expired';
    return 'active'; /* region / currency / group gates are not TIME */
  }
  /**
   * scopeLabel(o) → 'the order total' | 'each line' | 'on shipping' | 'per set' — WHAT the amount comes off (the promise carries the "off").
   * Athi, 2026-09-05: "if ₹100 off is on the total bill that should be explicit". One phrase, from the engine's own
   * notion of scope, so the category row, the product tab and the Setup list cannot disagree.
   */
  /** the minimum order size this offer asks of THIS line: per product (applies_to.min_qty_by_item[item_id], the lab's row box) first, else per offer (applies_to.min_qty) */
  function minQtyFor(offer, line) {
    var scope = offer && offer.applies_to;
    if (!scope) return 0;
    var by = scope.min_qty_by_item;
    if (by && line && line.item_id != null && by[String(line.item_id)] != null) return Number(by[String(line.item_id)]) || 0;
    return Number(scope.min_qty) || 0;
  }
  /** " 5+" when the offer asks for a minimum order size — for the row at hand when the context names one (forLine), else the offer's own */
  function minQtyWords(offer, ctx) {
    var minimum = minQtyFor(offer, ctx && ctx.line);
    return minimum > 1 ? ' ' + minimum + '+' : '';
  }
  /** ⭐ A TIER MAY BE A PERCENTAGE (Athi, 2026-09-06: "so it need not be price dependent"): `price` is the price of record at that volume;
      `percent` is that much off THIS line's own price, so one rule fits every product. Anything else is an unfinished tier. */
  /** ⭐ THE ONE READER OF A TIER'S PERCENT (R44, 2026-10-24): the Offer Lab saved `pct` until web PR #393; those offers are still in the database,
      so `pct` is read as an alias. `percent` wins when both are present; blank or missing → null. */
  function tierPercentOf(tier) {
    if (!tier) return null;
    var value = tier.percent != null && tier.percent !== '' ? tier.percent : tier.pct;
    return value != null && value !== '' ? value : null;
  }
  function tierPriceOf(tier, unitPrice) {
    if (!tier) return null;
    if (tier.price != null && tier.price !== '') return moneyOf_(Number(tier.price));
    var tierPercent = tierPercentOf(tier);
    if (tierPercent != null && Number(unitPrice) > 0) return moneyOf_(Number(unitPrice) * (1 - Number(tierPercent) / 100));
    return null;
  }
  function scopeLabel(offer) {
    var x = offer || {};
    if (x.kind === 'shipping') return 'on shipping';
    /* ⚠️ mix_and_match counts in sets too — the difference between them is WHICH unit is free, not how the
       sets are counted, and a scope label that disagreed would misdescribe one of the two. */
    if (x.kind === 'buy_x_get_y' || x.kind === 'mix_and_match') return 'per set';
    if (x.kind === 'tier_price') return 'per unit from the tier';
    /* the promise already says "off" ("10% off", "₹10.00 off") — the scope names only WHAT it comes off (Athi, 2026-09-06: "two times off is coming") */
    if (x.scope === 'cart' || x.kind === 'threshold') return 'the order total';
    return 'each line';
  }
  root.CBOffers = {
    evaluate: evaluate,
    promise: promise,
    terms: terms,
    timeStatus: timeStatus,
    scopeLabel: scopeLabel,
    forLine: forLine,
    onOffer: onOffer,
    claims: claims,
    perLine: perLine,
    sampleQty: sampleQty,
    KINDS: KINDS,
    kinds: Object.keys(KINDS),
    covers: covers,
    overlaps: overlaps,
    clashes: clashes,
    compound: compound
  };
})(typeof window !== 'undefined' ? window : this);
