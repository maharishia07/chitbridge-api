/* app/pick.js — CBPick: open the catalogue over any screen and hand the selection back. · CARD 06-catalogue-pim/catalogue-picker
 *
 * OWNS      CBPick.open / confirm / cancel: the catalogue picker shown over any screen, resolving with the chosen lines
 * CALLED BY public/app.html (script tag); public/app/cap-chit2.js, public/app/cap-worklist.js (CBPick.open)
 * FLOW      CBPick.open(opts) -> CBCatUI.pickerHTML in a dialog -> confirm -> Promise of lines, or null on cancel
 * CARD      06-catalogue-pim/catalogue-picker
 *
 *
 * Athi, 2026-08-23: *"if it is a module, we should be able to call it on top of any other screen on its own and
 * pass the selection back to the calling system, can't we?"* — after the worklist's picker came up with no
 * search bar, no styling, and "your catalogue is empty" flashing before the read had finished.
 *
 * ⭐⭐ HE IS DESCRIBING THE FIX FOR THE CAUSE, NOT THE SYMPTOM. Four screens each assembled the picker by hand —
 * compose (app.html:4764), Suppliers (6729), Network (cap-network.js:1375) and the worklist. The first three
 * call `CBCatUI.pickerHTML()`, which is *"the whole picker: cart bar, search box, list, in that order"* and
 * which is also the only place `ensureCss()` runs. The worklist wired the two hosts itself and called
 * `cart.paint()` — so it got rows and nothing else: no header, therefore **no search box**, and no stylesheet,
 * therefore **no styling at all**. Exactly what he screenshotted.
 *
 * ⚠️ A FOURTH CORRECT COPY WOULD NOT HAVE FIXED IT. The next screen to want a catalogue would assemble a fifth,
 * and would get one of the four parts wrong — because "open the catalogue" is genuinely four decisions (modal,
 * loading state, renderer, commit) and nothing was holding them together. This holds them.
 *
 *     const lines = await CBPick.open({
 *       title:    'Take materials',
 *       subtitle: line.particulars,
 *       confirm:  'Add to this line',
 *       catalogue: () => ensureCatalogue().then(toPickerItems),   // or an array
 *     });
 *     if (!lines) return;            // cancelled — the caller decides what to restore
 *     record(lines);                 // [{ item_id, name, unit, price, qty }]
 *
 * ⚠️ IT RESOLVES, IT DOES NOT CALL BACK INTO THE SCREEN. The caller keeps its own control flow, which is what
 * makes this callable from a card, a modal, a line, or a screen that does not exist yet. `null` means cancelled
 * and is deliberately different from `[]` (opened, picked nothing, pressed confirm).
 *
 * ⚠️ AND IT OWNS THE MODAL IT OPENS, INCLUDING PUTTING BACK WHAT IT COVERED. A picker opened from inside a card
 * replaces that card — #modalhost holds one thing — so `onClose` is where the caller repaints what was there.
 */
var CBPick = (function () {
  'use strict';
  /* ⭐ money.round — THE one rounder (C:devSPEC-money-one-reader.md): CBMoney (engine/money.js) in a page,
     lib/money.js in node. Looked up PER CALL, because on the shop screen an engine can load before money.js does.
     ⚠️⚠️ NO FALLBACK COPY (retired 2026-09-28, the loader step): every page that loads this file loads
     engine/money.js FIRST (tests/one-rounding-rule.test.cjs checks each one), and a page that somehow has no
     money.js SAYS so here — it never rounds a second way. */
  var MONEY_ = null;
  function money_() {
    var M = typeof CBMoney !== 'undefined' && CBMoney.round ? CBMoney : MONEY_;
    if (M === null && typeof require === 'function') {
      try {
        M = MONEY_ = require('./money');
      } catch (_) {
        M = MONEY_ = false;
      }
    }
    if (M && M.round) return M;
    throw new Error('CBMoney is not loaded — /engine/money.js is missing from this page');
  }
  function roundMoney_(n) {
    return money_().round(n);
  }
  /* ⭐ ONE READER FOR A STORED PRICE (2026-09-28, M20): money.priceOf reads every stored shape — {amount}, a bare
     number, a numeric string — and answers null for "no price". This file read `d.price.amount` raw, so a price
     stored as "12.50" reached the cart as TEXT (review §21: the counter billed it, the storefront called it unpriced). */
  function priceOf_(v) {
    return money_().priceOf(v);
  }

  var HOST_LIST = 'cbpick_pk';
  var HOST_BAR = 'cbcartbar_pk';
  var open_ = null; // the one in flight; a second open replaces it
  function tx_(s) {
    return typeof tx === 'function' ? tx(s) : s;
  }

  /**
   * ⭐ THE ITEM SHAPE, IN ONE PLACE. Every caller was mapping its own products into the cart's shape and every
   * mapping was slightly different. `name` is the alias cart-ui reads; everything else rides along on a spread,
   * so a row keeps its unit, its code and its quantity model.
   */
  function toItems(list) {
    return (list || [])
      .map(function (item, index) {
        var d = item.item_data || item;
        var pv = priceOf_(d.price),
          price = pv === null ? undefined : pv; /* absent stays absent, as before */
        return {
          item_id: item.item_id || d.item_id || 'pk' + index,
          item_data: Object.assign({}, d, {
            name: d.name || d.particulars || '',
            unit: d.unit || 'unit',
            price: price
          })
        };
      })
      .filter(function (x) {
        return x.item_data.name;
      });
  }

  /**
   * What the caller gets back: plain rows, already priced, with the quantity the person chose.
   *
   * ⚠️⚠️ `cart.selected()`, NOT `cart.lines()` — and this is the second half of the bug Athi hit. `lines(ns)`
   * returns `Object.keys(s.sel).length`, a COUNT. The worklist's commit did `(cart.lines() || []).map(...)`,
   * which throws "map is not a function" on a number, straight into its own catch — so pressing "Add to this
   * line" recorded nothing and flashed a failure toast, which is the *"some message on the top"* he saw. The
   * picker was not broken cosmetically; the commit never worked at all.
   *
   * ⭐ `selected()` is the accessor that returns the rows, each already carrying the price that COUNTS for it
   * (`unitPrice`, after any offer), so no caller re-decides what a line costs.
   */
  function linesOf(cart) {
    return (cart.selected() || []).map(function (item) {
      /* ⭐ `unit_price` is the price that COUNTS — the catalogue's, or an offer's if one beat it. cart-ui
         computes it once precisely so no screen decides again what a line costs. Fall back only for a row
         that predates it. */
      var raw = item.unit_price != null ? item.unit_price : priceOf_(item.price);
      var price = Number(raw) || 0;
      var qty = Number(item.qty || 1) || 1;
      var total = item.line_total != null && isFinite(item.line_total) ? Number(item.line_total) : qty * price;
      return {
        item_id: item.item_id || null,
        name: item.name || '',
        unit: item.unit || null,
        code: item.code || null,
        price: price,
        qty: qty,
        amount: roundMoney_(total)
      };
    });
  }

  function shell(o, body) {
    return (
      '<div class="mhd"><div class="t">' +
      esc(o.title || tx_('Catalogue')) +
      '</div>' +
      (o.subtitle ? '<div class="s">' + esc(o.subtitle) + '</div>' : '') +
      '</div>' +
      '<div class="mbody" style="padding:11px 12px">' +
      body +
      '</div>' +
      '<div class="mfoot"><button data-cbsid="CMP003" data-testid="pick-cancel" onclick="CBPick.cancel()">' +
      esc(tx_('Cancel')) +
      '</button>' +
      '<button class="pri" data-testid="pick-confirm" onclick="CBPick.confirm()">' +
      esc(o.confirm || tx_('Use these')) +
      '</button></div>'
    );
  }

  /**
   * ⚠️ THE READING STATE IS NOT DECORATION. "Your catalogue is empty — add parts under Catalogue" is a true
   * sentence about an empty catalogue and a LIE about one that has not been read yet, and it is the first thing
   * a person saw. Compose already had the answer (`skeletonHTML`), so this is not a new idea — it is the same
   * one, moved somewhere every caller gets it.
   */
  function paintLoading(o) {
    var skel =
      typeof CBCatUI !== 'undefined' && CBCatUI.skeletonHTML
        ? CBCatUI.skeletonHTML({ rows: 7 })
        : '<div style="padding:20px;color:var(--grey)"><span class="spin"></span> ' + esc(tx_('reading…')) + '</div>';
    modal(
      shell(
        o,
        '<div style="font-size:var(--fs-2);color:var(--grey);padding:2px 2px 9px">' +
          '<span class="spin"></span> ' +
          esc(tx_('reading your catalogue…')) +
          '</div>' +
          skel
      ),
      true, { pop: 'POP210' }
    );
  }

  function paintPicker(o, cart) {
    /* ⭐ THE SANCTIONED ENTRY — bar, SEARCH BOX and list together, and the only path that injects the
       renderer's stylesheet. Everything this module exists to stop getting wrong is inside this one call. */
    modal(
      shell(
        o,
        CBCatUI.pickerHTML(cart, {
          barEl: HOST_BAR,
          listEl: HOST_LIST,
          checkoutLabel: o.confirm || tx_('Use these'),
          cartTitle: o.cartTitle || tx_('Selected'),
          emptyHint: o.emptyHint || tx_('Press + on what you want'),
          empty: o.empty || tx_('Nothing here matches that.'),
          emptyAll: o.emptyAll || tx_('Your catalogue is empty — add products under Catalogue and they appear here.'),
          placeholder: o.placeholder || tx_('Search this catalogue…'),
          categories: o.categories || null,
          searchTestid: 'pick-search',
          listTestid: 'pick-list',
          /* Checking out of the cart popup IS confirming — the same act, so it must not be a second path. */
          onCheckout: function () {
            CBPick.confirm();
          }
        })
      ),
      true, { pop: 'POP210' }
    );
  }

  return {
    /**
     * open(opts) → Promise<lines[]|null>
     *   title · subtitle · confirm · cartTitle · emptyHint · empty · emptyAll · placeholder · categories
     *   catalogue : an array of products, or a function returning one (or a promise of one)
     *   onClose   : optional; runs after the modal closes, whichever way it closed
     */
    open: function (opts) {
      var o = opts || {};
      if (typeof CBCart === 'undefined' || typeof CBCatUI === 'undefined' || typeof modal !== 'function') {
        if (typeof toast === 'function') toast(tx_('The catalogue picker is not loaded yet — try again.'));
        return Promise.resolve(null);
      }
      if (open_) {
        try {
          open_.finish(null);
        } catch (e) {
          /* the old one is going away regardless */
        }
      }

      return new Promise(function (resolve) {
        var state = {
          o: o,
          cart: null,
          done: false,
          finish: function (val) {
            if (state.done) return;
            state.done = true;
            open_ = null;
            try {
              if (state.cart && state.cart.close) state.cart.close();
            } catch (e) { /* best effort: failing here changes nothing the user sees */ }
            if (typeof closeModal === 'function') closeModal();
            if (typeof o.onClose === 'function') {
              try {
                o.onClose(val);
              } catch (e) { /* best effort: failing here changes nothing the user sees */ }
            }
            resolve(val);
          }
        };
        open_ = state;

        paintLoading(o);

        var src = o.catalogue;
        Promise.resolve(typeof src === 'function' ? src() : src)
          .then(function (list) {
            if (state.done) return; // cancelled while the read was in flight
            /* ⭐ THE VIEW WHEN THE CALLER HAS ONE (rule 3, CART-OUTLET-RULES): a payload with `items` is the catalogue view itself — offers,
             rates, stock stamps ride in and the rows print exactly as on every other outlet. A bare array is the raw list (the fallback). */
            var cat = list && !Array.isArray(list) && Array.isArray(list.items) ? list : { shop: { bridge_id: 'self' }, items: toItems(list) };
            state.cart = CBCart.create(cat, { listEl: HOST_LIST, barEl: HOST_BAR, renderer: CBCatUI });
            paintPicker(o, state.cart);
          })
          .catch(function (e) {
            if (state.done) return;
            modal(
              shell(
                o,
                '<div style="padding:18px;color:var(--disp);font-size:var(--fs-2)">' +
                  esc(typeof MSG !== 'undefined' && MSG.fail ? MSG.fail('read the catalogue', e) : tx_('Could not read the catalogue.')) +
                  '</div>'
              ),
              true, { pop: 'POP210' }
            );
          });
      });
    },

    /** The footer's primary, and the cart popup's checkout — one act, one path. */
    confirm: function () {
      if (!open_) return;
      var lines = open_.cart ? linesOf(open_.cart) : [];
      if (!lines.length) {
        if (typeof toast === 'function') toast(open_.o.emptyHint || tx_('Nothing picked yet'));
        return;
      }
      open_.finish(lines);
    },

    cancel: function () {
      if (open_) open_.finish(null);
    },

    /** Exposed for the same reason cart-ui exposes its mappers: so a caller can shape a list without a copy. */
    toItems: toItems
  };
})();
