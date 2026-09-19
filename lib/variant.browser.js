/* GENERATED — DO NOT EDIT. Written by chitbridge-api/scripts/vendor-till.cjs. Edit the master and re-run. */
// @stage tested
// @stage-note a byte-for-byte copy of the master, which is the thing the tests cover (scripts/vendor-till.cjs).
/**
 * variant.js — ONE PRODUCT, MANY COMBINATIONS, AND A NAME FOR EACH ([TILL-76] / CBVariant)
 *
 * Athi, 2026-09-19: *"that need not be only a restaurant problem, i could visualise in multiple other
 * industries too — same product, but combinations can be different. in the cart, it has to be identified as a
 * separate item, possibly product code with some other field to distinguish it differently. if the same choice
 * is chosen again, it has to be added to the existing cart."*
 *
 * And: *"these are all should be as a module and we should be able to re-use… a proper write-up has to be
 * there, can we create a helper function so we can re-use where required."*
 *
 * ── ⭐⭐⭐ WHAT THIS IS ────────────────────────────────────────────────────────────────────────────────────
 *
 * A VARIANT is a product plus the choices made about it. Paneer pizza with cola and paneer pizza with pepsi
 * are one product and two variants. So are 8mm rod cut to 4 ft and to 6 ft; a shirt in blue/L and blue/M; a
 * service with next-day rather than standard delivery. It is not a restaurant idea — it is what happens
 * whenever a catalogue entry is narrower than the thing actually sold.
 *
 * ── ⚠️⚠️ THE RULE EVERYTHING HERE EXISTS TO KEEP ──────────────────────────────────────────────────────────
 *
 *   **The same set of choices must always produce the same name, and a different set must never produce it.**
 *
 * Break the first half and a bill grows two identical rows — a kitchen makes two of something ordered once, a
 * warehouse picks twice. Break the second and two different things merge into one line and somebody receives
 * the wrong goods. Both failures are silent: the arithmetic stays correct and the bill is simply wrong.
 *
 * ⭐ THE NAME IS `item_id | group:option, …` SORTED. Sorting is the whole trick: a signature built in the order
 * somebody happened to tap is not a signature, it is a recording of their hand movements. This engine was
 * extracted the day that bug was found — inside a group allowing two extras, Paneer-then-Cheese and
 * Cheese-then-Paneer were two different lines.
 *
 * ── ⚠️ WHAT THIS ENGINE DOES NOT DO ───────────────────────────────────────────────────────────────────────
 *
 * It does not hold a cart, price a bill, or know what a line is. It answers four questions about a set of
 * choices — what is it called, what does it cost, how do we say it, and is it complete — and every surface
 * that sells (the counter, the storefront, order capture, the connector) asks the same one. A second opinion
 * about whether two combinations are the same is how two systems come to disagree about one order.
 * [[project-js-unification]] [[feedback-no-duplicate-functions]]
 *
 * ── HOW TO USE IT ─────────────────────────────────────────────────────────────────────────────────────────
 *
 *   var groups = CBVariant.groupsOf(product);           // what may be chosen, [] when nothing may
 *   var missing = CBVariant.missing(groups, chosen);    // required groups still unanswered, by name
 *   var key     = CBVariant.keyOf(product.item_id, chosen);   // the line's identity — merge on this
 *   var extra   = CBVariant.addedPrice(chosen);         // what the choices add to one unit
 *   var words   = CBVariant.words(chosen, money);       // "Hot · Paneer +₹20.00"
 *   CBVariant.same(a, b)                                // do two sets of choices mean the same thing
 *
 * A CHOICE is `{ group, option, price }`. Nothing else is read, so any surface can build one.
 */
(function (root) {
  'use strict';

  /** ⚠️ a choice with no group is unsortable and unmergeable — it is dropped rather than silently misfiled */
  function clean(mods) {
    return (Array.isArray(mods) ? mods : []).filter(function (m) {
      return m && String(m.group || '').length && String(m.option || '').length;
    });
  }

  /**
   * ⭐⭐⭐ THE CANONICAL NAME FOR A SET OF CHOICES. Sorted, so one set has exactly one spelling however it was
   * arrived at — typed, tapped, restored from a parked bill, or handed over by an API in whatever order it
   * felt like.
   * ⚠️ DO NOT "OPTIMISE" THE SORT AWAY. Callers happen to build these in group order today; a draft restored
   * from storage or a line arriving from another system does not.
   */
  function sig(mods) {
    var list = clean(mods);
    if (!list.length) return '';
    return list.map(function (m) { return m.group + ':' + m.option; }).sort().join(',');
  }

  /**
   * ⭐ THE LINE'S IDENTITY: the product code, and the choices that narrow it. Athi's *"product code with some
   * other field to distinguish it differently"*, exactly.
   * ⚠️ A PRODUCT WITH NO CHOICES KEEPS ITS PLAIN ID, so nothing changes for the ninety per cent of catalogues
   * that have no variants at all.
   */
  function keyOf(itemId, mods) {
    var s = sig(mods);
    return s ? (String(itemId) + '|' + s) : String(itemId);
  }

  /** do two sets of choices mean the same thing — the question a merge is really asking */
  function same(a, b) { return sig(a) === sig(b); }

  /** ⭐ what the choices add to ONE unit. Never to the line: quantity is the caller's business. */
  function addedPrice(mods) {
    var t = clean(mods).reduce(function (sum, m) { return sum + (Number(m.price) || 0); }, 0);
    return Math.round(t * 100) / 100;
  }

  /** the options a product offers, or [] — a shape check, so a malformed catalogue row cannot throw a till */
  function groupsOf(item) {
    var m = (item && (item.modifiers || (item.item_data && item.item_data.modifiers))) || null;
    return Array.isArray(m) ? m.filter(function (g) {
      return g && g.name && Array.isArray(g.options) && g.options.length;
    }) : [];
  }

  /**
   * ⚠️ WHICH REQUIRED GROUPS ARE STILL UNANSWERED, by name, so a screen can say *"Choose Spice"* rather than
   * refusing with no reason. An empty array means the variant is complete and may be sold.
   */
  function missing(groups, mods) {
    var picked = {};
    clean(mods).forEach(function (m) { picked[m.group] = true; });
    return (Array.isArray(groups) ? groups : [])
      .filter(function (g) { return g && g.required && !picked[g.name]; })
      .map(function (g) { return g.name; });
  }

  /**
   * ⭐ HOW TO SAY IT. Two forms, because two surfaces need different things and neither should invent its own:
   *   words()      "Hot · Paneer +₹20.00"   — a bill line, where the money matters
   *   wordsPlain() "Hot · Paneer"           — a kitchen ticket, where it does not
   * ⚠️ money IS PASSED IN. This engine never formats a currency; CBMoney owns that, and a second opinion about
   * how to write ₹ is how one screen comes to disagree with another. [[feedback-adopt-dont-reinvent]]
   */
  function wordsPlain(mods) {
    return clean(mods).map(function (m) { return m.option; }).join(' · ');
  }
  function words(mods, money) {
    var fmt = (typeof money === 'function') ? money : function (v) { return String(v); };
    return clean(mods).map(function (m) {
      return m.option + (Number(m.price) ? ' +' + fmt(Number(m.price)) : '');
    }).join(' · ');
  }

  /**
   * ⭐ REGROUP A FLAT LIST BACK INTO ITS GROUPS — what a chooser needs to reopen on an existing line.
   * ⚠️ A group the product no longer offers is dropped: a shop that changed its menu since the line was added
   * must not have a chooser that cannot draw itself.
   */
  function byGroup(mods, groups) {
    var allowed = null;
    if (Array.isArray(groups)) {
      allowed = {};
      groups.forEach(function (g) { if (g && g.name) allowed[g.name] = true; });
    }
    var out = {};
    if (allowed) Object.keys(allowed).forEach(function (nm) { out[nm] = []; });
    clean(mods).forEach(function (m) {
      if (allowed && !allowed[m.group]) return;
      (out[m.group] = out[m.group] || []).push({ group: m.group, option: m.option, price: Number(m.price) || 0 });
    });
    return out;
  }

  var EXPORTS = {
    sig: sig,
    keyOf: keyOf,
    same: same,
    addedPrice: addedPrice,
    groupsOf: groupsOf,
    missing: missing,
    words: words,
    wordsPlain: wordsPlain,
    byGroup: byGroup
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = EXPORTS;
  root.CBVariant = EXPORTS;
})(typeof globalThis !== 'undefined' ? globalThis : this);
