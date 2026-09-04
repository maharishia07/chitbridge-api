// @stage tested
// @stage-note Which slab answers for this product, and WHO answered. Pure — no I/O, no DB, no rate table.
'use strict';
/**
 * tax-slab.js — a named tax slab, cited by a product, inherited when it is not.
 *
 * Athi, 2026-09-03: *"in india tax is not simple, each product has different tax criteria, so it has to be
 * product specific, but there are slabs, so define slab and attach the slab to the product, check how other
 * products are doing"*.
 *
 * ── ⭐⭐ WHAT THE OTHER PRODUCTS DO, AND WHAT WAS TAKEN FROM THEM ────────────────────────────────────────────────
 *
 * Tally, Zoho Books and Odoo all land on the SAME shape, independently, which is the strongest evidence a shape
 * is right: **a named tax rate is its own record, a product points at it, and an unset product inherits.**
 *
 *   Tally      "GST Rate Details" set at Stock Item · Stock Group · Company — the item's own answer wins, else
 *              the group's, else the company's. That THREE-LEVEL fallback is the part copied here verbatim.
 *   Zoho       a "Tax" record (name + rate), selected on an item; unset items fall to the org default.
 *   Odoo       `account.tax` records, defaulted per product category (`property_account_..._categ_id`).
 *
 * ⚠️ NOT COPIED — their tax ENGINE. Odoo's `account.tax` carries computation modes, sequences and repartition
 * lines because it also POSTS the entries. We do not post; `tax.js` determines and stops. Importing their engine
 * would be importing an accounting ledger we do not have.
 *
 * ⚠️⚠️ AND STILL NO RATE TABLE. `tax.js` says it plainly and it holds here: this file ships **no** rates. The
 * merchant authors the slabs — "GST 5%", "GST 18%" — as `definition` rows they own, version and freeze. A rate
 * hard-coded in our repository would be wrong silently, wrong for everyone, and discovered at filing time.
 * `GST_SLAB_RATES` below is a list of the rates the SCHEME defines, offered as a picker; it is not a mapping from
 * any product to any rate, and nothing here resolves one.
 *
 * ── ⭐ THE SHAPE IS defaults.js's, DELIBERATELY ────────────────────────────────────────────────────────────────
 * `defaults.js` already says "the catalogue declares it, a row overrides it, and we know which answered", and
 * returns `{ value, from }` for exactly that reason. This is the same rule with one extra rung in the middle (the
 * category), so it returns the same kind of answer — a value AND the source that produced it — using the same
 * vocabulary. It is deliberately NOT registered in `DEFAULTABLE`: that registry decides which keys earn a
 * SPREADSHEET COLUMN, and a slab must never be one (see the SYSTEM field note in column-rules.js).
 *
 * ── ZERO DEPENDENCIES · TIER A ─────────────────────────────────────────────────────────────────────────────────
 */

/**
 * The rates the GST scheme itself defines. ⚠️ A MENU, NOT A MAPPING — this says which numbers are legal to type,
 * not which one any product attracts. That second question is per-HSN, changes at every Council meeting, and is
 * the merchant's (or their CA's) to answer. Offering it as a picker stops "18.5" being typed; it decides nothing.
 */
const GST_SLAB_RATES = [0, 0.25, 3, 5, 12, 18, 28];

/** The key a product cites a slab by. ⚠️ Named once — the web mirror, the RESERVED list and the SYSTEM field all
    have to agree, and three string literals is how they stop agreeing. */
const SLAB_KEY = 'tax_slab';
const SLAB_NAME_KEY = 'tax_slab_name';
const RATE_KEY = 'gst_rate';

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const blank = (v) => v === null || v === undefined || String(v).trim() === '';

/**
 * normalise(definition) → { id, name, rate, cess, hsn, effective_from, label } | null
 *
 * Accepts a raw `definition` row (with `rules` joined on) OR the flattened shape the front end keeps
 * (`{ id, name, rules }`), because both exist and a second reader is how the two drift.
 */
function slabOf(def) {
  const d = def || {};
  const id = d.definition_id || d.id || null;
  if (!id) return null;
  /* ⚠️ IDEMPOTENT. A slab that has ALREADY been normalised (no `rules`, a top-level `rate`) must survive a second
     pass unchanged — the send path handed the shelf's normalised slabs back in as an array and every rate came out
     null, so every chit line went unrated while the product page beside it showed 18% ([TAX-03], 2026-09-05). */
  const r = (d.rules && typeof d.rules === 'object') ? d.rules : ((d.rules === undefined && d.rate !== undefined) ? d : {});
  const rate = num(r.rate);
  return {
    id: String(id),
    name: String(d.name || r.label || '').trim(),
    /* ⚠️ `null`, NOT 0, when no rate is declared. Zero is a REAL GST answer (exempt/nil-rated goods), so
       defaulting an unanswered slab to 0 would make "nobody said" indistinguishable from "nil-rated" — and the
       invoice would look correct while charging nothing. */
    rate,
    cess: num(r.cess) === null ? 0 : num(r.cess),
    hsn: Array.isArray(r.hsn) ? r.hsn.map(String).filter(Boolean) : (blank(r.hsn) ? [] : [String(r.hsn)]),
    effective_from: blank(r.effective_from) ? null : String(r.effective_from),
    label: String(r.label || d.name || '').trim(),
    /* The scheme the slab belongs to — GST unless the governance layer says otherwise (b202: DE-VAT-19 …). tax.js
       reads it off the line to pick the head: CGST/SGST/IGST for GST, ONE head for a VAT-type scheme. */
    scheme: String(r.scheme || 'GST').trim().toUpperCase() || 'GST',
  };
}

/** Index a list of slab definitions by id. Tolerant of a list that is already normalised. */
function indexSlabs(list) {
  const m = new Map();
  for (const d of (Array.isArray(list) ? list : [])) {
    const s = slabOf(d);
    if (s) m.set(s.id, s);
  }
  return m;
}

/** The category ids a product cites — BOTH shapes, the same rule core.js's catgIdsOf follows. */
function categoryIdsOf(item_data) {
  const d = item_data || {};
  if (Array.isArray(d.categories)) return d.categories.map(String).filter(Boolean);
  if (d.category) return [String(d.category)];        // legacy single — read, never written again
  return [];
}

/**
 * ⭐⭐ resolve({ item_data, face, slabs, categories, asOf }) → the answer AND who gave it.
 *
 *   { slab_id, rate, cess, name, hsn, source, effective_from, pending }
 *
 * `source` ∈ 'product' | 'category' | 'catalogue' | 'none' — the same "which one answered" contract defaults.js
 * returns, because a screen that shows a rate without saying where it came from cannot be argued with. "GST 5% —
 * from category Grains" is checkable; a bare "5%" is a number someone has to trust.
 *
 * INPUTS
 *   item_data   the product row (free-form jsonb).           `item_data.tax_slab` is a definition_id.
 *   face        the catalogue face.                          `face.tax.default_slab` is a definition_id.
 *   slabs       kind:'tax' definitions — array or Map.
 *   categories  kind:'category' definitions — array or Map.  `rules.default_slab` is a definition_id.
 *   asOf        ISO date for the effective_from check. Defaults to today.
 *
 * ⚠️⚠️ THE ORDER IS TALLY'S AND IT IS NOT NEGOTIABLE: the product's own citation wins outright, then the FIRST
 * category it sits in that declares one, then the catalogue. Reversing any pair would make the general answer
 * override the specific one — which is the whole reason a per-product slab exists.
 *
 * ⚠️ A PRODUCT IN THREE CATEGORIES TAKES THE FIRST THAT ANSWERS, in the order the product lists them. Two
 * categories with different slabs is a genuine ambiguity that no rule here can settle honestly, so the choice is
 * DECLARED (first wins, and the answer names which category it was) rather than hidden behind a max/min. The
 * caller can see the source and say so.
 */
function resolve(input) {
  const inp = input || {};
  const it = (inp.item_data && typeof inp.item_data === 'object') ? inp.item_data : {};
  const face = (inp.face && typeof inp.face === 'object') ? inp.face : {};
  const slabs = (inp.slabs instanceof Map) ? inp.slabs : indexSlabs(inp.slabs);
  const cats = (inp.categories instanceof Map) ? inp.categories : new Map(
    (Array.isArray(inp.categories) ? inp.categories : []).map((c) => [String(c.definition_id || c.id), c]));

  const answer = (slab, source, extra) => Object.assign({
    slab_id: slab ? slab.id : null,
    rate: slab ? slab.rate : null,
    cess: slab ? slab.cess : 0,
    name: slab ? (slab.name || slab.label) : null,
    scheme: slab ? (slab.scheme || 'GST') : null,
    hsn: slab ? slab.hsn : [],
    effective_from: slab ? slab.effective_from : null,
    /**
     * ⚠️ A SLAB DATED IN THE FUTURE IS REPORTED, NOT SKIPPED. Silently falling through to the catalogue default
     * because a rate starts next month would charge the OLD rate with nothing on screen to say why — the same
     * class of failure as tax.js's "unknown place of supply", and the same answer: say it, let the caller decide.
     */
    pending: !!(slab && slab.effective_from && slab.effective_from > (inp.asOf || new Date().toISOString().slice(0, 10))),
    source,
  }, extra || {});

  /* 1 · the product's own citation. */
  const own = blank(it[SLAB_KEY]) ? null : String(it[SLAB_KEY]);
  if (own) {
    const s = slabs.get(own);
    /**
     * ⚠️⚠️ AN UNRESOLVABLE ID FALLS BACK TO THE TRAVELLING COPY, NOT TO THE CATEGORY. A counterparty holding my
     * product in THEIR copy cannot resolve MY definition_id and never will ([[reference-cb-core-principle]]) —
     * but the rate rode along beside it. Inheriting their own category's slab instead would silently re-rate my
     * goods under their tax rules, which is exactly the wrong answer and looks completely reasonable.
     */
    if (s) return answer(s, 'product');
    const copied = num(it[RATE_KEY]);
    if (copied !== null) {
      return answer({ id: own, name: String(it[SLAB_NAME_KEY] || '').trim() || null, rate: copied,
                      cess: num(it.cess_rate) === null ? 0 : num(it.cess_rate), hsn: [], effective_from: null },
                    'product', { unresolved: true });
    }
    /* ⭐ THE CITATION IS DEAD — FALL THROUGH, AND SAY SO. Athi, 2026-09-05: "for some reason an existing slab can be
       made unavailable — retired, a jurisdiction change, mismanagement — the engine should detect that and allow
       another one to attach." The chain continues (category → catalogue); the answer carries `cited` and
       `unresolved: true` so every screen says "cites X, which is not active — using Y", and the product pane offers
       the attach. Only when NOTHING below answers is the source 'none'. (Until today this returned 'none' here —
       "say so rather than inherit" — which left a product with a good category default showing no rate at all.) */
    return Object.assign(resolveBelow(it, cats, slabs, face, answer), { unresolved: true, cited: own });
  }
  return resolveBelow(it, cats, slabs, face, answer);
}

/* The rungs below the product's own citation — ONE function, reached with or without a dead citation above it. */
function resolveBelow(it, cats, slabs, face, answer) {

  /**
   * 1b · a BARE RATE with no slab. `gst_rate` is a declarable catalogue column with a full synonym set in
   * csv-preflight, so a merchant who imports a sheet of HSN codes and GST rates has typed the answer already.
   * Returning 'none' beside a row that plainly states 18 would be the software disagreeing with the data in front
   * of it. It is the PRODUCT's own answer, so it ranks exactly where a slab citation does.
   */
  const bare = num(it[RATE_KEY]);
  if (bare !== null) {
    return answer({ id: null, name: String(it[SLAB_NAME_KEY] || '').trim() || null, rate: bare,
                    cess: num(it.cess_rate) === null ? 0 : num(it.cess_rate), hsn: [], effective_from: null },
                  'product');
  }

  /* 2 · the first category that declares one, in the product's own order. */
  /* ⭐ EVERY CATEGORY IS HEARD, AND A DISAGREEMENT IS SAID. Athi, 2026-09-05: "what if the product is in two or more
     categories and they are in different slabs?" — until today the first category with a slab won, in list order,
     silently. Now the first still answers (nothing goes blank), but when the categories name DIFFERENT slabs the
     answer carries `conflict` and every screen says so: the product must cite a slab itself. */
  /* ⭐ A CATEGORY INHERITS ITS PARENT'S SLAB. Athi, 2026-09-05: "I applied 5% for the top category — this means it
     should automatically reflect the categories underneath?" Yes: a category that names no slab asks its parent
     (`rules.parent`), up the tree, and the answer says which ancestor spoke. */
  const heard = [];
  for (const cid of categoryIdsOf(it)) {
    const own = cats.get(cid);
    let c = own, hops = 0, via = null;
    while (c && hops++ < 16) {
      const dflt = c.rules && c.rules.default_slab;
      if (!blank(dflt)) { const s = slabs.get(String(dflt)); if (s) { via = { c, s }; } break; }
      const pid = c.rules && c.rules.parent;
      c = blank(pid) ? null : cats.get(String(pid));
    }
    if (via) heard.push({ category_id: cid, category_name: (own && own.name) || null, slab_id: via.s.id, slab_name: via.s.name || via.s.label || null, rate: via.s.rate,
                          inherited_from: via.c === own ? null : ((via.c.name || String(via.c.definition_id || via.c.id))) });
  }
  if (heard.length) {
    const first = heard[0];
    const distinct = new Set(heard.map((h) => String(h.slab_id)));
    return answer(slabs.get(String(first.slab_id)), 'category',
      Object.assign({ via_category_id: first.category_id, via_category_name: first.category_name, inherited_from: first.inherited_from || null }, distinct.size > 1 ? { conflict: heard } : {}));
  }

  /* 3 · the catalogue's declared default. Accepts the nested key and a flat one, exactly as defaults.declared does. */
  const t = (face.tax && typeof face.tax === 'object') ? face.tax : {};
  const cdflt = !blank(t.default_slab) ? t.default_slab : (!blank(face.default_tax_slab) ? face.default_tax_slab : null);
  if (cdflt) {
    const s = slabs.get(String(cdflt));
    if (s) return answer(s, 'catalogue');
  }

  /* ⚠️ 'none' IS A REAL ANSWER, and it is not 0%. Nobody has said what this product attracts; a caller that
     needs a rate must refuse or ask, never assume nil-rated. Same rule as tax.js's 'unknown' supply type. */
  return answer(null, 'none');
}

/**
 * ⭐ setOn(item_data, slab) — write the citation AND the travelling copy, in one act, in place.
 *
 * ⚠️⚠️ BOTH, ALWAYS, AND THIS IS THE ONLY FUNCTION THAT WRITES EITHER. Exactly the rule `catgSetOn` follows for
 * categories: the id is MY reference (edit the slab and every product of mine follows), the name and the rate are
 * a VALUE copy for a counterparty who cannot resolve my definition_id — [[reference-cb-core-principle]]. Written
 * apart, they drift; written here, they cannot.
 *
 * ⚠️ CLEARING MEANS INHERIT, NOT ZERO. Passing null removes all three keys, so the product falls back to its
 * category and then the catalogue — it does not become a nil-rated product. (defaults.js: "a blank cell means
 * INHERIT, not CLEAR".)
 */
function setOn(item_data, slab) {
  const d = (item_data && typeof item_data === 'object') ? item_data : {};
  const s = slab && slab.rules !== undefined ? slabOf(slab) : slab;
  if (!s || !s.id) {
    delete d[SLAB_KEY]; delete d[SLAB_NAME_KEY]; delete d[RATE_KEY];
    return d;
  }
  d[SLAB_KEY] = String(s.id);
  d[SLAB_NAME_KEY] = s.name || s.label || '';
  /* ⚠️ Only when there IS a rate. A slab authored with no rate yet must not stamp `gst_rate: 0` onto a product —
     that copy is what a counterparty reads, and it would read as "nil-rated" rather than "not stated". */
  if (s.rate === null || s.rate === undefined) delete d[RATE_KEY]; else d[RATE_KEY] = s.rate;
  return d;
}

/**
 * ⭐ applyToLine(line, resolved) → the same line with the rate tax.js reads.
 *
 * ⚠️ IT DOES NOT OVERWRITE A RATE THE LINE ALREADY CARRIES. A stamped chit line holds the rate that was frozen
 * onto it; re-resolving at read time is exactly how a stamped document starts changing after the fact. Resolution
 * fills a GAP — it never corrects history.
 *
 * ⚠️ AND IT WRITES NOTHING WHEN THE ANSWER IS 'none'. An absent rate is what makes tax.js's ItemList show 0 tax
 * AND lets a caller see that nobody declared one; writing 0 would make the two indistinguishable.
 */
function applyToLine(line, resolved) {
  const l = (line && typeof line === 'object') ? line : {};
  const r = resolved || {};
  if (l.rate !== undefined || l.gst_rate !== undefined) return l;
  if (r.rate === null || r.rate === undefined) return l;
  l.gst_rate = r.rate;
  if (r.cess) l.cess_rate = r.cess;
  if (r.slab_id) l.tax_slab = r.slab_id;
  if (r.name) l.tax_slab_name = r.name;
  /* Where the answer came from, on the line itself — the same reason a picked storefront line carries
     `ref.how: 'picked'`. A dispute can then tell an explicit rate apart from an inherited one. */
  l.tax_source = r.source;
  return l;
}

/** The sentence a screen shows. ⚠️ One phrasing, so View, the product pane and a chit read alike. */
function describe(resolved) {
  const r = resolved || {};
  const dead = (r && r.unresolved && r.cited) ? 'Cites slab "' + r.cited + '", which is not active here. ' : '';
  const clash = (r && Array.isArray(r.conflict) && r.conflict.length > 1)
    ? ' ⚠️ Its categories disagree — ' + r.conflict.map((h) => (h.category_name || h.category_id) + ' ' + (h.rate === null || h.rate === undefined ? '?' : h.rate + '%')).join(' vs ') + ' — cite a slab on the product to settle it.'
    : '';
  if (!r || r.source === 'none') return dead
    ? dead + 'Nothing below it answers either — attach another slab, or set a category or catalogue default.'
    : 'Not set — no slab on the product, its categories or the catalogue.';
  const head = (r.name ? r.name : (r.rate === null ? 'a slab' : 'GST ' + r.rate + '%'))
    + (r.rate !== null && r.name ? ' — ' + r.rate + '%' : '');
  const from = r.source === 'product' ? 'on this product'
             : r.source === 'category' ? ('from category ' + (r.via_category_name || 'it belongs to') + (r.inherited_from ? ' (inherits ' + r.inherited_from + ')' : ''))
             : 'catalogue default';
  return dead + (dead ? 'Using ' : '') + head + ' · ' + from + (r.pending ? ' · not in force until ' + r.effective_from : '') + clash;
}

module.exports = { GST_SLAB_RATES, SLAB_KEY, SLAB_NAME_KEY, RATE_KEY,
                   slabOf, indexSlabs, categoryIdsOf, resolve, setOn, applyToLine, describe };
