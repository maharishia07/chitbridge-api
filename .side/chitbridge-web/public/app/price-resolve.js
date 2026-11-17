/* app/price-resolve.js — WHICH PRICE APPLIES, AND WHY.  (classic script, shared global scope)
 *
 * Part D of a catalogue has declared tiered, regional, time-boxed pricing since it was written:
 *
 *     pricing: [{ label, basis, by, source, amount, currency, region, validFrom, validTo,
 *                 origin, url, ref, at, as_read }]
 *
 * `cap-network.js` can author those entries — date pickers, region, a "frozen / loose · resolves at seal" badge.
 * ⚠️ AND NOTHING HAS EVER EVALUATED THEM. `cart-ui.priceOf()` reads one scalar off the item, so a catalogue could
 * declare a Diwali price for Tamil Nadu valid to 15 November and the cart would charge the flat number anyway.
 * The authoring existed, the meaning did not.
 *
 * This is the same gap `offers.js` had until it was wired, and it takes the same posture:
 *
 * ── ⚠️⚠️ PURE. IT RESOLVES, IT NEVER CHARGES ────────────────────────────────────────────────────────────────────
 * Entries in, a decision out. It mutates nothing, fetches nothing, and knows nothing about carts. That is what
 * lets the same function answer in the cart, on the storefront, in a quote, and again at seal time months later
 * and give the same answer — which is the only reason a price is defensible at all.
 *
 * ── ⭐ IT EXPLAINS ITSELF, INCLUDING WHAT LOST ──────────────────────────────────────────────────────────────────
 * `resolve()` returns the winning entry AND every entry it rejected with the reason. "Why am I paying 340 and not
 * 325?" must have an answer six months later, and "the system decided" is not one. This is the same rule offers.js
 * follows and for the same reason: disputes are the product.
 *
 * ── ⚠️ NOT WIRED. Nothing calls this yet. Where it plugs in (and whether a `by:'ref'` price may resolve at seal
 * without a human) is a decision, not a detail. See SPEC-offers-tax.md.
 
 * CALLED BY public/app.html, public/app/attach-ui.js, public/app/cap-crm.js, public/app/cap-testing.js, public/app/pick.js   [from the knowledge graph, 2026-10-18 - regenerate: node tools/graph/trace.cjs]
 */
/*
 * OWNS      which price applies and why: tiered, regional, time-boxed pricing resolved to one answer
 * CALLED BY <script src="/app/price-resolve.js"> at public/app.html:1630; scripts/price-resolve.test.mjs (run by .github/workflows/ci.yml)
 * FLOW      pricing[] entries -> filter by region and dates -> the one price that applies, with the reason
 * CARD      07-offers-pricing-and-combos/pricing-structure-price-lists
 */
(function (root) {
  'use strict';

  function num(v) {
    var n = Number(v);
    return isFinite(n) ? n : null;
  }

  /**
   * ⚠️ AN END DATE MEANS THE END OF THAT DAY. `validTo: '2026-11-15'` treated as midnight would expire an offer
   * fifteen hours before anyone thinks it does — the same off-by-one offers.js already refuses, and worth
   * refusing identically rather than cleverly.
   */
  function endOf(d) {
    var date = new Date(d);
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(d))) date.setUTCHours(23, 59, 59, 999);
    return date;
  }

  /**
   * why(entry, ctx) → null if it applies, else a SENTENCE saying why not.
   *
   * ⚠️ A MISSING CONDITION MEANS "NO RESTRICTION", NEVER "FAILS". An entry with no region applies everywhere; one
   * with no window is always live. The opposite default would silently disable every price written before a field
   * existed — the rule products.js applies to a missing status and offers.js applies to a missing region.
   */
  function why(p, ctx) {
    if (p.validFrom && new Date(p.validFrom) > ctx.now) return 'starts ' + p.validFrom;
    if (p.validTo && endOf(p.validTo) < ctx.now) return 'ended ' + p.validTo;
    if (p.region && ctx.region && String(p.region).toLowerCase() !== String(ctx.region).toLowerCase())
      return txf('for {region}, not {orderRegion}', { region: p.region, orderRegion: ctx.region });
    /* ⚠️ A CURRENCY MISMATCH IS A REFUSAL, NEVER A CONVERSION. Converting here would invent an exchange rate,
       silently, inside a pricing decision — and the rate used would be unrecorded and unarguable. If a catalogue
       needs a price in another currency, that is another Part D entry, declared by whoever owns the number. */
    if (p.currency && ctx.currency && String(p.currency) !== String(ctx.currency))
      return txf('priced in {currency}, not {orderCurrency}', { currency: p.currency, orderCurrency: ctx.currency });
    if (p.minQty != null && ctx.qty != null && ctx.qty < Number(p.minQty))
      return txf('needs {minQty}+, this order has {qty}', { minQty: p.minQty, qty: ctx.qty });
    /* `by:'ref'` with no amount is LOOSE — it resolves from its source at seal, so it cannot price an order now.
       That is not an error; it is what "loose" means, and it must be said rather than treated as a broken row. */
    if (p.by === 'ref' && num(p.amount) == null) return 'loose — resolves from ' + (p.source || 'its source') + ' at seal';
    if (num(p.amount) == null) return 'no amount set';
    return null;
  }

  /**
   * ⭐ WHICH OF THE SURVIVORS WINS.
   *
   * ⚠️ THE MOST SPECIFIC ENTRY, NOT THE CHEAPEST. Picking the lowest price would be generous, undocumented, and
   * indefensible the first time a seller asks why their contract price lost to a promotion. Specificity is
   * something a person declared; cheapness is something the code decided.
   *
   * Order: a qualifying quantity tier beats a plain price; a region-specific entry beats a general one; a
   * time-boxed entry beats an always-on one. Ties break on the HIGHER minQty, because that is the more specific
   * of two tiers, and then on declaration order — which is the catalogue owner's own sequence.
   */
  function rank(p) {
    var s = 0;
    if (p.minQty != null) s += 4;
    if (p.region) s += 2;
    if (p.validFrom || p.validTo) s += 1;
    return s;
  }

  function resolve(entries, ctx) {
    ctx = ctx || {};
    var c = {
      now: ctx.now ? new Date(ctx.now) : new Date(),
      region: ctx.region || '',
      currency: ctx.currency || '',
      qty: ctx.qty == null ? null : Number(ctx.qty)
    };
    var list = (entries || []).slice();
    var applied = [],
      rejected = [];

    list.forEach(function (item, index) {
      var bad = why(item, c);
      if (bad) rejected.push({ label: item.label || item.basis || 'entry ' + (index + 1), why: bad, entry: item });
      else applied.push({ entry: item, rank: rank(item), i: index });
    });

    if (!applied.length) {
      /**
       * ⚠️ NO APPLICABLE PRICE IS AN ANSWER, NOT A ZERO. Returning 0 or null-as-free would let an order go out at
       * nothing; the caller must be able to tell "this is free" from "we do not know what this costs". The
       * rejections come with it, so the caller can say WHY there is no price.
       */
      return {
        amount: null,
        entry: null,
        rejected: rejected,
        explain: rejected.length
          ? 'No price applies here — ' +
            rejected
              .map(function (item) {
                return item.label + ': ' + item.why;
              })
              .join('; ')
          : 'No price is declared.'
      };
    }

    applied.sort(function (first, second) {
      if (second.rank !== first.rank) return second.rank - first.rank;
      var am = first.entry.minQty == null ? -1 : Number(first.entry.minQty);
      var bm = second.entry.minQty == null ? -1 : Number(second.entry.minQty);
      if (bm !== am) return bm - am;
      return first.i - second.i;
    });

    var win = applied[0].entry;
    var others = applied.slice(1).map(function (x) {
      return { label: x.entry.label || x.entry.basis, why: 'less specific than the one that applied', entry: x.entry };
    });

    return {
      amount: num(win.amount),
      currency: win.currency || c.currency || '',
      entry: win,
      /* Both the losers that were ineligible AND the ones that merely lost — a person asking "why this price"
         deserves the whole field, not the shortlist. */
      rejected: rejected.concat(others),
      /* ⭐ The provenance rides along, so a resolved price can still say where it came from — the work done for
         "where are prices referred from" is useless if the resolver drops it. */
      provenance: root.CBCatalogue && root.CBCatalogue.priceProvenance ? root.CBCatalogue.priceProvenance(win) : '',
      /* `by:'value'` is already frozen; `by:'ref'` WITH an amount is a reading that was taken and recorded — the
         caller still decides whether to re-read it at seal. Said plainly so nobody has to infer it. */
      state: win.by === 'value' ? 'frozen (by value)' : 'by reference — recorded reading',
      explain: describe(win, c)
    };
  }

  function describe(p, c) {
    var bits = [];
    /**
     * ⚠️⚠️ THIS PASTED A CURRENCY CODE ONTO A RAW NUMBER — `'INR' + 340` rendered literally as "INR340": no
     * space, no grouping, no symbol. And the fallback chain ends in `''`, so when neither the price nor the
     * catalogue carried a currency it rendered a BARE AMOUNT — an unlabelled number, in the one function whose
     * entire job is answering "why am I paying 340 and not 325?".
     *
     * ⚠️ NOT LIVE TODAY: CBPrice is exported and nothing calls it (checked 2026-08-18). Fixed anyway, because
     * the day something does call it the defect is a wrong price in a dispute explanation, and "it was already
     * broken when we wired it up" is not a thing to discover then.
     *
     * ⚠️ AND AN ABSENT CURRENCY NOW SAYS SO. A number with no currency beside it invites the reader to assume
     * their own — which is exactly the assumption this whole codebase spends its effort preventing.
     */
    var _ccy = p.currency || c.currency || '';
    var _amt = _ccy ? (typeof CBLocale !== 'undefined' ? CBLocale.money(p.amount, _ccy) : _ccy + ' ' + p.amount) : p.amount + ' (currency not stated)';
    bits.push((p.label || p.basis || 'price') + ' = ' + _amt);
    if (p.minQty != null) bits.push(txf('for {minQty}+ units', { minQty: p.minQty }));
    if (p.region) bits.push('in ' + p.region);
    if (p.validFrom || p.validTo) bits.push('valid ' + (p.validFrom || '—') + ' to ' + (p.validTo || '—'));
    return bits.join(' · ');
  }

  /**
   * A convenience for a whole cart: resolve each line against the catalogue's Part D entries.
   * ⚠️ PER LINE, because quantity tiers are per line — a 30-unit order of one product does not earn the 30-unit
   * tier on a different product, and summing quantities across products to reach a tier would hand out a discount
   * nobody declared.
   */
  function forLines(lines, entriesFor, ctx) {
    return (lines || []).map(function (item) {
      var e = typeof entriesFor === 'function' ? entriesFor(item) : entriesFor;
      return resolve(e, Object.assign({}, ctx, { qty: item.qty }));
    });
  }

  root.CBPrice = { resolve: resolve, forLines: forLines, rank: rank, why: why };
})(typeof window !== 'undefined' ? window : this);
