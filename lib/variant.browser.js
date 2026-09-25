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
 *   var groups = CBVariant.groupsOf(product);           // what may be CHOSEN — strict, sale-ready only
 *   var draft  = CBVariant.groupsRaw(product);          // everything, even a group not finished yet — authoring only
 *   var missing = CBVariant.missing(groups, chosen);    // required groups still unanswered, by name
 *   var key     = CBVariant.keyOf(product.item_id, chosen);   // the line's identity — merge on this
 *   var extra   = CBVariant.addedPrice(chosen);         // what the choices add to one unit
 *   var words   = CBVariant.words(chosen, money);       // "Hot · Paneer +₹20.00"
 *   CBVariant.same(a, b)                                // do two sets of choices mean the same thing
 *
 * A CHOICE is `{ group, option, price }`. Nothing else is read, so any surface can build one.
 *
 * ── ⭐⭐⭐ AUTHORING — A CAPABILITY, NOT A SCREEN ([TILL-modauthor]) ──────────────────────────────────────────
 *
 * Everything above reads what a product offers; everything below WRITES it — same module, because one shape
 * kept in two files is how a future field means updating two. Every function is pure: a groups array in, a
 * groups array out (or `{ok,errors,groups}` for validate), no DOM, no fetch, no globals but its own argument.
 * A host decides how it looks and when it saves — a product-edit tab, a bulk importer, a future till-side
 * quick-edit — by calling the same verbs and getting back the one shape groupsOf() already reads.
 *
 *   var groups = CBVariant.addGroup(current, 'Spice level');
 *   var groups = CBVariant.setGroup(groups, 0, { required: true, max: 1 });
 *   var groups = CBVariant.addOption(groups, 0, 'Extra hot', 0);
 *   var groups = CBVariant.setOption(groups, 0, 0, { price: 10 });
 *   var { ok, errors, groups } = CBVariant.validate(groups);   // errors are words a form can show, never a throw
 *   var line = CBVariant.summary(groups);                       // "1 group · 1 option", for any host's own outcome row
 *   var picks = CBVariant.toggle(picks, groups[0], 'Hot');       // pick/unpick one option — the same rule any chooser follows
 *
 * INPUT to every verb is whatever the host is currently holding — the stored array, or the previous verb's
 * OUTPUT — normalize()d defensively either way, so a malformed or half-typed draft can never wedge the chain.
 * OUTPUT is always `[{name, required, max, options:[{name, price}]}]` exactly, and nothing else: an authoring
 * screen cannot accidentally smuggle a cost price or a supplier code into a field the counter ships to a
 * device holding a till-scoped key (see routes/till.js's own note on that projection).
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
   * ⭐⭐ EVERYTHING, EVEN A DRAFT NOT YET FINISHED — groupsOf()'s own dual-shape read (`item.modifiers` or
   * `item.item_data.modifiers`), without groupsOf()'s strictness. An authoring screen must still show the
   * group somebody is halfway through naming; a chooser at the point of sale never should. That difference is
   * the whole reason this is its own function rather than a flag on groupsOf() — one strict, one for a draft
   * in progress, and neither one guessing what the other is for.
   */
  function groupsRaw(item) {
    var m = (item && (item.modifiers || (item.item_data && item.item_data.modifiers))) || null;
    return normalize(m);
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

  /**
   * ⭐ ONE OPTION, THE STORED SHAPE ONLY.
   * ⚠️⚠️⚠️ A BLANK NAME IS KEPT, NOT DROPPED — this used to return null for one, which addOption() then fed
   * straight into cleanGroup()'s own .filter(Boolean): the option "+ Add an option" had JUST appended was
   * gone again before the very same call returned, so the button visibly did nothing. The exact rule already
   * settled for a nameless GROUP ("survives to the next edit, only dropped once something reads/saves it")
   * applies here the same way — only a genuinely non-object entry (garbage in the array, not a person's own
   * unfinished row) is dropped.
   */
  function cleanOption(o) {
    if (!o || typeof o !== 'object') return null;
    return { name: String(o.name || '').trim(), price: Math.round((Number(o.price) || 0) * 100) / 100 };
  }
  /** ⭐ ONE GROUP, THE STORED SHAPE ONLY — max is always a whole number, at least 1, whatever was typed */
  function cleanGroup(g) {
    var options = Array.isArray(g && g.options) ? g.options.map(cleanOption).filter(Boolean) : [];
    return { name: String((g && g.name) || '').trim(), required: !!(g && g.required),
             max: Math.max(1, Math.floor(Number(g && g.max)) || 1), options: options };
  }
  /**
   * ⭐⭐ THE SHAPE-GUARD FOR AUTHORING — every verb below runs its input through this first, mirroring
   * groupsOf()'s own read-side filter, so a saved draft always reads back the exact shape it was written in.
   * Anything not in `{name, required, max, options:[{name, price}]}` is dropped, never carried through —
   * a cost price or a supplier code an import tried to smuggle in has nowhere to hide.
   * ⚠️ A NAMELESS GROUP IS DROPPED HERE, not earlier — addGroup() can seed one with no name yet (mid-type),
   * and normalize() only throws it away once something else reads or saves the array, never while it is
   * still the row a person is looking at.
   */
  function normalize(raw) {
    return (Array.isArray(raw) ? raw : []).map(cleanGroup);
  }
  function normalizeSaved(raw) { return normalize(raw).filter(function (g) { return g.name; }); }

  /** ⭐ WHAT'S WRONG, IN WORDS A ROW CAN SHOW BESIDE ITSELF — never thrown; a host decides whether an error
   * blocks saving or only warns. `at` is the group's index, so a host can point at the exact row. */
  function validate(raw) {
    var groups = normalizeSaved(raw), errors = [], seenGroup = {};
    groups.forEach(function (g, gi) {
      if (seenGroup[g.name]) errors.push({ at: gi, message: '"' + g.name + '" is used twice — group names must be different.' });
      seenGroup[g.name] = true;
      if (!g.options.length) errors.push({ at: gi, message: '"' + g.name + '" has no options yet.' });
      var seenOpt = {};
      g.options.forEach(function (o) {
        if (!o.name) { errors.push({ at: gi, message: 'An option in "' + g.name + '" still needs a name.' }); return; }
        if (seenOpt[o.name]) errors.push({ at: gi, message: '"' + o.name + '" is repeated in "' + g.name + '".' });
        seenOpt[o.name] = true;
      });
    });
    return { ok: !errors.length, errors: errors, groups: groups };
  }

  function addGroup(raw, name) {
    var groups = normalize(raw);
    groups.push({ name: String(name || '').trim(), required: false, max: 1, options: [] });
    return groups;
  }
  function removeGroup(raw, gi) { var groups = normalize(raw); groups.splice(gi, 1); return groups; }
  function moveGroup(raw, from, to) {
    var groups = normalize(raw);
    if (from < 0 || from >= groups.length) return groups;
    to = Math.max(0, Math.min(groups.length - 1, to));
    var g = groups.splice(from, 1)[0]; groups.splice(to, 0, g);
    return groups;
  }
  /** patch is any of {name, required, max} — pass only what changed, same rule a merge-patch follows one level up */
  function setGroup(raw, gi, patch) {
    var groups = normalize(raw); if (!groups[gi]) return groups;
    groups[gi] = cleanGroup(Object.assign({}, groups[gi], patch));
    return groups;
  }
  function addOption(raw, gi, name, price) {
    var groups = normalize(raw); if (!groups[gi]) return groups;
    var options = groups[gi].options.concat([{ name: String(name || '').trim(), price: Number(price) || 0 }]);
    groups[gi] = cleanGroup(Object.assign({}, groups[gi], { options: options }));
    return groups;
  }
  function removeOption(raw, gi, oi) {
    var groups = normalize(raw); if (!groups[gi]) return groups;
    var options = groups[gi].options.slice(); options.splice(oi, 1);
    groups[gi] = cleanGroup(Object.assign({}, groups[gi], { options: options }));
    return groups;
  }
  function moveOption(raw, gi, from, to) {
    var groups = normalize(raw); if (!groups[gi]) return groups;
    var options = groups[gi].options.slice();
    if (from < 0 || from >= options.length) return groups;
    to = Math.max(0, Math.min(options.length - 1, to));
    var o = options.splice(from, 1)[0]; options.splice(to, 0, o);
    groups[gi] = cleanGroup(Object.assign({}, groups[gi], { options: options }));
    return groups;
  }
  /** patch is any of {name, price} */
  function setOption(raw, gi, oi, patch) {
    var groups = normalize(raw); if (!groups[gi] || !groups[gi].options[oi]) return groups;
    var options = groups[gi].options.slice();
    options[oi] = cleanOption(Object.assign({}, options[oi], patch)) || options[oi];
    groups[gi] = cleanGroup(Object.assign({}, groups[gi], { options: options }));
    return groups;
  }

  /**
   * ── ⭐⭐⭐ TOGGLE — THE ONE RULE FOR PICKING AN OPTION, SHARED BY EVERY CHOOSER (Athi: "when we create
   * modifiers, we should be able to see the behaviour where we are authoring") ───────────────────────────────
   *
   * Takes the flat CHOICE list every other function here already speaks (`[{group,option,price}]` — words(),
   * addedPrice(), missing() all read it) plus the group definition and the option name just tapped, and hands
   * back the new flat list. `max` decides everything: max 1 replaces whatever was picked (radio behaviour);
   * max > 1 adds up to that many, dropping the OLDEST pick once the limit is reached (fifo, never a silent
   * refusal). Picks in every OTHER group are untouched.
   * ⚠️ THIS IS THE SAME RULE till.html's modToggle() HARD-CODES FOR SELLING. It is not called from there yet
   * (that would be its own, separate change to tested, live selling code) — it exists here so an authoring
   * preview can show EXACTLY the behaviour a customer will get, from the one place both could someday share it.
   */
  function toggle(chosen, group, optionName) {
    var g = group || {};
    var opt = (Array.isArray(g.options) ? g.options : []).filter(function (o) { return o && o.name === optionName; })[0];
    var rest = clean(chosen).filter(function (m) { return m.group !== g.name; });
    if (!opt) return rest.concat(clean(chosen).filter(function (m) { return m.group === g.name; }));
    var mine = clean(chosen).filter(function (m) { return m.group === g.name; });
    var max = Math.max(1, Math.floor(Number(g.max)) || 1);
    var at = mine.map(function (m) { return m.option; }).indexOf(optionName);
    if (at >= 0) { mine.splice(at, 1); }
    else {
      if (max === 1) mine = [];
      if (mine.length >= max) mine.shift();
      mine.push({ group: g.name, option: optionName, price: Number(opt.price) || 0 });
    }
    return rest.concat(mine);
  }

  /** ⭐ ONE LINE, FOR ANY HOST'S OWN OUTCOME/SUMMARY ROW — never assumes a language; a host wraps it in tx() */
  function summary(raw) {
    var groups = normalizeSaved(raw);
    if (!groups.length) return 'No modifiers yet';
    var opts = groups.reduce(function (n, g) { return n + g.options.length; }, 0);
    return groups.length + ' group' + (groups.length === 1 ? '' : 's') + ' · '
         + opts + ' option' + (opts === 1 ? '' : 's');
  }

  var EXPORTS = {
    sig: sig,
    keyOf: keyOf,
    same: same,
    addedPrice: addedPrice,
    groupsOf: groupsOf,
    groupsRaw: groupsRaw,
    missing: missing,
    words: words,
    wordsPlain: wordsPlain,
    byGroup: byGroup,
    /* authoring — see the module header's "AUTHORING" section */
    normalize: normalize,
    validate: validate,
    addGroup: addGroup,
    removeGroup: removeGroup,
    moveGroup: moveGroup,
    setGroup: setGroup,
    addOption: addOption,
    removeOption: removeOption,
    moveOption: moveOption,
    setOption: setOption,
    toggle: toggle,
    summary: summary
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = EXPORTS;
  root.CBVariant = EXPORTS;
})(typeof globalThis !== 'undefined' ? globalThis : this);
