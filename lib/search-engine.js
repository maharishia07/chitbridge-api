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

  /** every break becomes a space, with one at each end, so " tok" means "a word starts here" */
  function normalise(t) {
    var out = ' ', s = String(t == null ? '' : t).toLowerCase();
    for (var n = 0; n < s.length; n++) {
      var c = s.charCodeAt(n);
      out += ((c >= 97 && c <= 122) || (c >= 48 && c <= 57)) ? s[n] : ' ';
    }
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
  var DEFAULT_FIELDS = ['name', 'code', 'sku', 'category', 'brand', 'variant', 'grade', 'unit', 'hsn', 'desc'];
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
    if (!toks.length) return list.slice(0, limit);

    var starts = [], loose = [], letters = [];
    for (var k = 0; k < list.length && starts.length < limit; k++) {
      var it = list[k], hay = textOf(it, o);
      if (startsAll(hay, toks)) { starts.push(it); continue; }
      if (loose.length < limit && toks.length === 1 && hay.indexOf(toks[0]) >= 0) { loose.push(it); continue; }
      if (letters.length < limit && lettersAll(hay, toks)) letters.push(it);
    }
    var first = toks[0];
    var nameOf = (typeof nameKey === 'function') ? nameKey : function (x) { return x[nameKey]; };
    starts.sort(function (a, c) {
      var an = String(nameOf(a) || '').toLowerCase(), cn = String(nameOf(c) || '').toLowerCase();
      var ap = an.indexOf(first) === 0 ? 0 : 1, cp = cn.indexOf(first) === 0 ? 0 : 1;
      if (ap !== cp) return ap - cp;
      return an.length - cn.length;
    });
    return starts.concat(loose, letters).slice(0, limit);
  }

  root.CBSearch = { search: search, textOf: textOf, tokens: tokens, forget: forget, normalise: normalise };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.CBSearch;
})(typeof window !== 'undefined' ? window : this);
