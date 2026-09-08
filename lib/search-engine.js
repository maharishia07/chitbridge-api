/* app/search.js — HOW A SHOPKEEPER FINDS A PRODUCT.  (classic script, shared global scope)
 *
 * Athi, 2026-09-08: *"if the regex selects product based on ac co, means aachi coriander — the first two or three characters get the
 * first set of letters before the break, and the next set looks at the next word in the same product, will it bring the name faster?"*
 * and then, once it existed in the counter: *"make it one shared file for both."*
 *
 * ── ⚠️ WHY THIS IS A FILE OF ITS OWN ──────────────────────────────────────────────────────────────────────────
 * The counter and the Catalogue screen must answer "ac co" the same way. Two implementations of a search are two
 * definitions of what a shop's own words mean, and they drift the first time one of them is improved. Same
 * discipline as app/offers.js and the tax engine: ONE master here, copied to the places that cannot load it
 * (the API serves the till's cached copy), with a test that fails the day they differ.
 *
 * ── THE THREE PASSES, SHARPEST FIRST ──────────────────────────────────────────────────────────────────────────
 *   1 · WORD START   every word typed begins a word in the product.  "aa cor" · "brit mar" · "an co 1"
 *                    Order is free, so "co ac" is the same as "ac co".
 *   2 · SUBSTRING    one word typed, found anywhere.  "riander" · half a code.
 *   3 · LETTERS      the letters typed, in order, inside one word each.  "ac" for Aachi · "crd" for curd.
 *                    Generous by nature, so it runs only when the first two found nothing, and ranks last.
 * An exact barcode beats all three and returns alone.
 *
 * ── ⚠️ WHAT IT MUST NEVER DO ──────────────────────────────────────────────────────────────────────────────────
 * · Never a regular expression per item per keystroke: at ten thousand products that is the whole budget. The
 *   searchable text is built ONCE per item and cached on it; a keystroke is then indexOf per word.
 * · Never normalise one side only. The text turns every break into a space, so the QUERY must too, or a typed
 *   "BULK-000001" is one token with a hyphen and matches nothing — which is exactly what happened (2026-09-08).
 * · Never invent a match. If nothing matches, the answer is nothing, and the screen says so.
 */
// @stage tested
// @stage-note What "ac co" means, for the counter and for the Catalogue. Pure — no I/O, no DB, no network; the API only serves the file.
(function (root) {
  'use strict';

  var CACHE = '_cbSearchText';

  /**
   * every break becomes a space, with one at each end, so " tok" means "a word starts here"
   *
   * ⚠️⚠️ IN ANY SCRIPT. This kept only a-z0-9, so "தக்காளி" folded to nine spaces, the token list came out empty, and an empty token
   * list means "no query" — which returns the whole shelf. A shopkeeper typing Tamil saw a list starting with Tomato and pressing
   * Enter added Tomato, whatever they had asked for. lib/itemmatch.js paid for exactly this in August, on a real Tamil order, where
   * every line matched a junk row and the chit showed a confident ₹6,800 of fiction.
   * ⚠️ p{M} IS NOT OPTIONAL: Tamil vowel signs (ா ெ ூ) are Marks, not Letters. Keeping only letters and numbers would strip them
   * and mangle every word into a different word — the subtler half of the same bug.
   */
  var KEEP = /[\p{L}\p{N}\p{M}]/u;
  function normalise(t) {
    var out = ' ', s = String(t == null ? '' : t).toLowerCase();
    for (var n = 0; n < s.length; n++) out += KEEP.test(s[n]) ? s[n] : ' ';
    return out + ' ';
  }

  /** the words a person typed, normalised exactly as the text they are searching */
  function tokens(q) {
    var t = normalise(q).split(' ');
    var out = [];
    for (var i = 0; i < t.length; i++) if (t[i]) out.push(t[i]);
    return out;
  }

  /**
   * the searchable text of one item, built ONCE and kept on it.
   *   opts.fields  which keys to read (the default suits a till item and a catalogue row alike)
   *   opts.text    a screen's own words for an item — the Catalogue searches its category names and the offers in
   *                effect, which are not fields on the product at all
   *   opts.stamp   what those words depend on. When it changes the text is rebuilt, so a renamed category or an offer
   *                that ended overnight cannot go on being findable. Pass ONE stamp string per paint, not per item.
   * ⚠️ The expensive half is building the text — on the Catalogue that means resolving each product's offers and tax
   * rate. Doing it per keystroke on ten thousand products is what makes a search box feel broken.
   */
  /* ⭐ alias_text is what a SUPPLIER calls this product (routes/till.js ships it), so their code finds our item at goods-in */
  /**
   * ⭐⭐ "synonyms" IS WHAT A SHOP CALLS ITS OWN PRODUCTS — thakkali, vengayam, milagai. It is a field on the product
   * that lib/itemmatch.js has read since August for WhatsApp orders and consolidation; the counter never saw it, so
   * the same word resolved in a message and failed at the till. One authority, read by both now.
   * ("alias_text" is the other direction: what a SUPPLIER calls it. Both belong in the words you can search by.)
   */
  var DEFAULT_FIELDS = ['name', 'code', 'sku', 'category', 'brand', 'variant', 'grade', 'unit', 'hsn', 'desc',
                        'alias_text', 'synonym_text'];
  function textOf(item, opts) {
    if (!item || typeof item !== 'object') return ' ';
    var o = Array.isArray(opts) ? { fields: opts } : (opts || {});
    var held = item[CACHE];
    if (held && held.stamp === (o.stamp || '')) return held.text;
    var t;
    if (typeof o.text === 'function') { t = normalise(o.text(item)); }
    else {
      var f = o.fields || DEFAULT_FIELDS, parts = [];
      for (var i = 0; i < f.length; i++) { var v = item[f[i]]; if (v != null && typeof v !== 'object' && String(v)) parts.push(String(v)); }
      t = normalise(parts.join(' '));
    }
    var box = { stamp: o.stamp || '', text: t };
    try { Object.defineProperty(item, CACHE, { value: box, enumerable: false, writable: true, configurable: true }); }
    catch (_) { item[CACHE] = box; }      /* a frozen row still searches, it just recomputes */
    return t;
  }
  /** the shop changed: every cached text is stale */
  function forget(items) { (items || []).forEach(function (i) { if (i && i[CACHE]) { try { delete i[CACHE]; } catch (_) { i[CACHE] = null; } } }); }

  /**
   * ⭐ THE SQUEEZE: a doubled letter is the commonest slip in transliterated Indian English — aachi/achi,
   * massala/masala, chilli/chili, mattar/matar. Collapsing runs of the same letter on BOTH sides makes those the
   * same word without any distance arithmetic at all.
   * ⚠️ It never merges two real things: "grade 11" and "grade 1" squeeze differently only in digits, which is why
   * digits are left alone.
   */
  function squeeze(t) {
    var out = '', last = '';
    for (var i = 0; i < t.length; i++) {
      var c = t[i];
      if (c === last && !(c >= '0' && c <= '9')) continue;
      out += c; last = c;
    }
    return out;
  }
  function squeezedAll(hay, toks) {
    var words = squeeze(hay).split(' ');
    for (var i = 0; i < toks.length; i++) {
      var want = squeeze(toks[i]), found = false;
      for (var w = 0; w < words.length && !found; w++) if (words[w] === want || words[w].indexOf(want) === 0) found = true;
      if (!found) return false;
    }
    return true;
  }
  /**
   * ⭐ ONE EDIT, AND NOT A CHARACTER MORE. The same rule lib/itemmatch.js applies on the message path — fix typing,
   * never merge two real things.
   * ⚠️ FIVE LETTERS OR MORE. At four, one edit reaches half the shelf: "rice" and "nice", "dal" and "oil".
   * ⚠️ AND NEVER ON A NUMBER. "500" and "100" are one edit apart and they are not the same order.
   */
  function near(a, b) {
    if (a === b) return true;
    if (Math.abs(a.length - b.length) > 1) return false;
    var i = 0, j = 0, slips = 0;
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) { i++; j++; continue; }
      if (++slips > 1) return false;
      if (a.length === b.length) { i++; j++; }
      else if (a.length > b.length) i++;
      else j++;
    }
    return (slips + (a.length - i) + (b.length - j)) <= 1;
  }
  function nearAll(hay, toks) {
    var words = hay.split(' ');
    for (var i = 0; i < toks.length; i++) {
      var tok = toks[i], found = false;
      if (tok.length < 5 || /^[0-9]+$/.test(tok)) {                 /* short words and numbers are compared exactly */
        for (var e = 0; e < words.length && !found; e++) if (words[e] === tok) found = true;
      } else {
        for (var w = 0; w < words.length && !found; w++) if (near(tok, words[w])) found = true;
      }
      if (!found) return false;
    }
    return true;
  }

  function startsAll(hay, toks) {
    for (var i = 0; i < toks.length; i++) if (hay.indexOf(' ' + toks[i]) < 0) return false;
    return true;
  }
  /** each typed word as a subsequence of SOME single word: "ac" ⊂ "aachi" */
  function lettersAll(hay, toks) {
    var words = hay.split(' ');
    for (var t = 0; t < toks.length; t++) {
      var tok = toks[t], found = false;
      for (var w = 0; w < words.length && !found; w++) {
        var word = words[w]; if (word.length < tok.length) continue;
        var n = 0;
        for (var c = 0; c < word.length && n < tok.length; c++) if (word[c] === tok[n]) n++;
        if (n === tok.length) found = true;
      }
      if (!found) return false;
    }
    return true;
  }

  /**
   * search(items, query, opts) → the matching items, closest first.
   *   opts.limit   how many (default 60; a screen that lazily renders its own rows passes Infinity)
   *   opts.fields · opts.text · opts.stamp   see textOf
   *   opts.barcode a key holding an exact code that should win outright (default 'barcode'; '' turns it off)
   *   opts.name    the key to rank on (default 'name')
   */
  function search(items, query, opts) {
    var o = opts || {}, limit = o.limit || 60, nameKey = o.name || 'name';
    var bcKey = (o.barcode === undefined) ? 'barcode' : o.barcode;
    var list = items || [];
    var raw = String(query == null ? '' : query).trim();
    if (!raw) return list.slice(0, limit);

    var flat = raw.toLowerCase();
    if (bcKey) for (var b = 0; b < list.length; b++) if (String(list[b][bcKey] || '').toLowerCase() === flat) return [list[b]];

    var toks = tokens(raw);
    /* ⚠️ SOMETHING WAS TYPED AND NOTHING SURVIVED IT — punctuation alone, or a script this fold cannot keep. That is NOT "no query",
       and answering with the whole shelf is how a wrong product gets added by somebody pressing Enter. */
    if (!toks.length) return raw ? [] : list.slice(0, limit);

    var starts = [], loose = [], letters = [], typo = [];
    for (var k = 0; k < list.length && starts.length < limit; k++) {
      var it = list[k], hay = textOf(it, o);
      if (startsAll(hay, toks)) { starts.push(it); continue; }
      if (loose.length < limit && toks.length === 1 && hay.indexOf(toks[0]) >= 0) { loose.push(it); continue; }
      if (letters.length < limit && lettersAll(hay, toks)) { letters.push(it); continue; }
      /* ⚠️ THE FORGIVING PASSES RANK LAST, and are collected separately so an exact match is never pushed below a
         guess. A shopkeeper who typed the name right must not have to look past somebody's spelling mistake. */
      if (typo.length < limit && (squeezedAll(hay, toks) || nearAll(hay, toks))) typo.push(it);
    }
    var first = toks[0];
    var nameOf = (typeof nameKey === 'function') ? nameKey : function (x) { return x[nameKey]; };
    starts.sort(function (a, c) {
      var an = String(nameOf(a) || '').toLowerCase(), cn = String(nameOf(c) || '').toLowerCase();
      var ap = an.indexOf(first) === 0 ? 0 : 1, cp = cn.indexOf(first) === 0 ? 0 : 1;
      if (ap !== cp) return ap - cp;
      return an.length - cn.length;
    });
    return starts.concat(loose, letters, typo).slice(0, limit);
  }

  root.CBSearch = { search: search, textOf: textOf, tokens: tokens, forget: forget, normalise: normalise };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.CBSearch;
})(typeof window !== 'undefined' ? window : this);
