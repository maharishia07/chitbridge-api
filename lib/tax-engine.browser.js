/* GENERATED FILE — DO NOT EDIT. Written by chitbridge-api/scripts/vendor-tax.cjs from lib/tax.js + lib/tax-slab.js.
 *
 * THE TAX ENGINE, IN THE BROWSER AND ON THE TILL. The server files are the master; this copy exists so a till can price a bill
 * with the internet unplugged, and so the screen shows the same figure the chit will carry. tests/tax-vendor.test.js regenerates
 * this file and fails if it differs — the same discipline that keeps app/offers.js and lib/offers-engine.js identical.
 *
 * Exposes  window.CBTax = { determine, supplyType, r2, systemProvider, slab: { resolve, slabOf, indexSlabs, applyToLine, ... } }
 */
(function (root) {
  'use strict';

/* ── from lib/tax-slab.js — what rate a product carries ─────────────────────────────────────────────────── */
var __slab = (function () {
// @stage tested
// @stage-note Which slab answers for this product, and WHO answered. Pure — no I/O, no DB, no rate table.
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
  return { GST_SLAB_RATES: GST_SLAB_RATES, SLAB_KEY: SLAB_KEY, SLAB_NAME_KEY: SLAB_NAME_KEY, RATE_KEY: RATE_KEY, slabOf: slabOf, indexSlabs: indexSlabs, categoryIdsOf: categoryIdsOf, resolve: resolve, setOn: setOn, applyToLine: applyToLine, describe: describe };
})();

/* ── from lib/tax.js — what that rate becomes between two addresses ─────────────────────────────────────── */
var __tax = (function () {
// @stage tested
// @stage-note GST determination: two addresses in, INV-01 vocabulary out. Pure — no I/O, no rate tables, no DB.
/**
 * tax.js — the determination, not the rates.
 *
 * Athi, 2026-09-02: *"how the tax computation happens and how do we borrow the existing well proven modules"*,
 * and then: *"build tax.js with the two-address context and INV-01 field names."*
 *
 * ── ⭐⭐ WHAT WAS BORROWED, AND WHAT WAS DELIBERATELY NOT ───────────────────────────────────────────────────────
 *
 * BORROWED — **the provider seam**. Every serious platform does the same thing and it is the right thing: define
 * an interface, ship a naive default, delegate real determination outward. Medusa's `ITaxProvider` is two methods
 * (`getIdentifier()`, `getTaxLines(itemLines, shippingLines, context)`) returning
 * `{rate, code, name, provider_id, line_item_id}`, with a built-in `system` provider as the placeholder and
 * Avalara/TaxJar behind the same seam. That shape is proven and costs nothing to adopt.
 *
 * ⚠️ NOT BORROWED — **their context**. Medusa's `TaxCalculationContext` carries ONE address: the destination.
 * Indian GST needs TWO, because the comparison between the supplier's state and the PLACE OF SUPPLY is the entire
 * decision between CGST+SGST and IGST. Copying that interface as written would have built the defect in on day
 * one. So the seam is theirs and the context is ours.
 *
 * BORROWED — **the vocabulary of the GSTN e-invoice schema (INV-01)**, because the field names are the standard
 * an Indian buyer's system already speaks. `SellerDtls` · `BuyerDtls` · `ItemList` · `ValDtls` · `TranDtls`,
 * and inside them `Gstin` · `LglNm` · `Pos` · `HsnCd` · `AssAmt` · `GstRt` · `CgstAmt` · `SgstAmt` · `IgstAmt` ·
 * `TotItemVal` · `RndOffAmt` · `TotInvVal`. If our output already speaks that, "e-invoice ready" and "Tally
 * compatible" stop being claims and become a mapping.
 *
 * ⚠️ THE NAMES WERE VERIFIED, NOT REMEMBERED — and one of them was wrong. Seller and buyer carry **`State`**, not
 * `Stcd`; `Stcd` exists only in `DispDtls`/`ShipDtls`. That is exactly the kind of detail that passes review, ships,
 * and is rejected by the IRP months later.
 *
 * ⚠️⚠️ NOT BORROWED, AND NEVER TO BE — **rate tables**. This file ships no rates. A stale rate in our repository
 * is a compliance liability wearing the costume of a feature: it is wrong silently, it is wrong for everyone, and
 * nobody discovers it until a return is filed. A rate arrives per line — from the entity's own HSN declarations,
 * or from a provider whose business is keeping them current.
 *
 * ── ZERO DEPENDENCIES · TIER A ─────────────────────────────────────────────────────────────────────────────────
 */

/* ── money ─────────────────────────────────────────────────────────────────────────────────────────────────── */

/** 2dp, half-up, on a value already in the invoice currency. Never a place to be clever. */
function r2(n) {
  const x = Number(n) || 0;
  return Math.round((x + Number.EPSILON) * 100) / 100;
}
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/* ── the one decision GST turns on ─────────────────────────────────────────────────────────────────────────── */

/**
 * supplyType(sellerState, placeOfSupply) → 'intra' | 'inter' | 'unknown'
 *
 * ⚠️⚠️ THIS IS THE WHOLE REASON THE CONTEXT NEEDS TWO ADDRESSES. Same goods, same price, same buyer: if the place
 * of supply is the seller's own state the tax is CGST+SGST, and if it is another state it is IGST. Get it
 * backwards and the invoice is not merely displaying a wrong number — the wrong tax has been charged, under the
 * wrong heads, and the buyer cannot claim the credit.
 *
 * ⚠️ AND 'unknown' IS A REAL ANSWER. A missing place of supply must not silently default to intra-state — that is
 * the guess that produces a confidently wrong invoice. The caller is told, and decides.
 */
function supplyType(sellerState, placeOfSupply) {
  const a = String(sellerState == null ? '' : sellerState).trim();
  const b = String(placeOfSupply == null ? '' : placeOfSupply).trim();
  if (!a || !b) return 'unknown';
  /* State codes are two-digit strings ("29"); a leading zero must not be lost by a numeric comparison. */
  return a.replace(/^0+/, '') === b.replace(/^0+/, '') ? 'intra' : 'inter';
}

/* ── one line ──────────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * itemLine(line, ctx, i) → an ItemList entry.
 *
 * ⚠️⚠️ ORDER OF OPERATIONS: DISCOUNT FIRST, THEN TAX ON WHAT REMAINS. `AssAmt = TotAmt − Discount`, and the rate
 * applies to `AssAmt`. Taxing before the discount overcharges; discounting after tax under-remits. Either way it
 * is a compliance error rather than a display bug, and it is the single most common way a hand-built invoice is
 * wrong.
 *
 * ⚠️ INCLUSIVE PRICING IS DECLARED, NEVER INFERRED. If a catalogue's prices already contain tax, the assessable
 * value is `gross × 100 / (100 + rate)`. Guessing this is how a price becomes wrong by exactly the tax rate — an
 * error large enough to lose money on every line and subtle enough to look like a rounding problem.
 */
function itemLine(line, ctx, i) {
  const l = line || {};
  const qty = num(l.qty !== undefined ? l.qty : l.quantity) || 0;
  const unitPrice = num(l.unit_price !== undefined ? l.unit_price : l.price);
  const rate = num(l.rate !== undefined ? l.rate : l.gst_rate);
  const gross = r2(qty * unitPrice);
  const discount = r2(num(l.discount));

  const net = Math.max(0, r2(gross - discount));
  const assessable = ctx.priceIncludesTax ? r2(net * 100 / (100 + rate)) : net;
  /* zero-rated (SEZ) or a composition seller: the rate is recorded, nothing is charged. */
  const taxTotal = ctx.zeroRate ? 0 : r2(assessable * rate / 100);

  /**
   * ⭐ THE SPLIT IS ARITHMETIC, THE DECISION WAS MADE ABOVE. Intra-state halves the rate into CGST and SGST;
   * inter-state puts the whole rate on IGST. Halving an odd rate (5% → 2.5% + 2.5%) is exact in the rate and can
   * be a half-paisa in the amount, so CGST takes the rounded half and SGST takes the remainder — the two always
   * sum to the total, which is what a counterparty's system reconciles against.
   */
  /* ⭐ ONE HEAD FOR A VAT-TYPE SCHEME (b202: DE-VAT-19, FR-VAT-20 …). VAT does not split by state; it is charged in
     full on a domestic supply and, between businesses across a border, not charged at all (export zero-rated /
     reverse charge in the buyer's country). The GST heads stay 0 so an Indian reader of the block is not misled. */
  let CgstAmt = 0, SgstAmt = 0, IgstAmt = 0, TaxAmt = 0;
  if (ctx.scheme !== 'GST') {
    if (ctx.supply === 'domestic') TaxAmt = taxTotal;
  } else if (ctx.supply === 'inter') {
    IgstAmt = taxTotal;
  } else if (ctx.supply === 'intra') {
    CgstAmt = r2(taxTotal / 2);
    SgstAmt = r2(taxTotal - CgstAmt);
  }

  return {
    SlNo: String(i + 1),
    PrdDesc: String(l.name || l.description || l.PrdDesc || ''),
    IsServc: l.is_service ? 'Y' : 'N',
    HsnCd: String(l.hsn || l.hsn_code || l.HsnCd || ''),
    Qty: qty,
    Unit: String(l.unit || ''),
    UnitPrice: r2(unitPrice),
    TotAmt: gross,
    Discount: discount,
    AssAmt: assessable,
    GstRt: rate,
    IgstAmt, CgstAmt, SgstAmt,
    /* Not INV-01 — the single head of a non-GST scheme (VAT · TVA · IVA · consumption tax). 0 under GST. */
    TaxAmt,
    CesRt: num(l.cess_rate),
    CesAmt: r2(assessable * num(l.cess_rate) / 100),
    TotItemVal: r2(assessable + IgstAmt + CgstAmt + SgstAmt + TaxAmt + r2(assessable * num(l.cess_rate) / 100)),
    /* Not INV-01 — ours, so a caller can join a computed line back to the chit line it came from. */
    _line_id: l.id !== undefined ? l.id : null,
  };
}

/* ── the invoice ───────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * determine({ seller, buyer, lines, priceIncludesTax, reverseCharge, supplyKind }) → the INV-01 shape + notes.
 *
 * `seller` { Gstin, LglNm, State, … }   ·   `buyer` { Gstin, LglNm, Pos, State, … }
 *
 * ⚠️ `Pos` (place of supply) IS NOT THE BUYER'S ADDRESS. It is usually the delivery state, and for services it
 * can be neither party's registered state. It is therefore taken as its own field and falls back to the buyer's
 * `State` only when absent — with a note saying so, because a silent fallback is how the wrong tax gets charged
 * without anyone being able to see why afterwards.
 */
function determine(input) {
  const inp = input || {};
  const seller = inp.seller || {};
  const buyer = inp.buyer || {};
  const notes = [];

  let pos = String(buyer.Pos || buyer.place_of_supply || '').trim();
  if (!pos && (buyer.State || buyer.state)) {
    pos = String(buyer.State || buyer.state).trim();
    notes.push('Place of supply was not given, so the buyer\'s state was used. For a delivery elsewhere, or for '
      + 'a service, state the place of supply — it, not the address, decides the tax.');
  }
  const sellerState = String(seller.State || seller.state || '').trim();
  /* The scheme comes from the LINES (the slab each cites carries it) or the caller; GST unless someone says otherwise.
     Mixed schemes on one invoice are not a thing — one seller, one jurisdiction — so the first rated line decides. */
  const linesIn = Array.isArray(inp.lines) ? inp.lines : [];
  const firstScheme = (linesIn.find((l) => l && l.tax_scheme) || {}).tax_scheme;
  const scheme = String(inp.scheme || firstScheme || 'GST').trim().toUpperCase() || 'GST';
  let supply;
  if (scheme === 'GST') {
    supply = supplyType(sellerState, pos);
  } else {
    /* A VAT-type scheme turns on the BORDER, not the state: same country → domestic (full rate); another country
       → cross-border (nothing charged between businesses); unknown when either country is missing. */
    const sc = String(seller.Country || seller.country || '').trim().toUpperCase();
    const bc = String(buyer.Country || buyer.country || '').trim().toUpperCase();
    supply = (!sc || !bc) ? 'unknown' : (sc === bc ? 'domestic' : 'cross');
    if (supply === 'cross') notes.push('Cross-border supply: no ' + scheme + ' is charged. The buyer accounts for it in their own country (reverse charge / import). The rate is stated for the record.');
    if (supply === 'unknown') notes.push('The ' + (sc ? 'buyer' : 'seller') + ' has no country on record, so domestic vs cross-border cannot be decided. Nothing was assumed.');
  }
  if (supply === 'unknown' && scheme === 'GST') {
    notes.push(sellerState
      ? 'No place of supply, so CGST/SGST vs IGST cannot be decided. Nothing was assumed.'
      : 'The seller has no state on record, so CGST/SGST vs IGST cannot be decided. Nothing was assumed.');
  }

  const priceIncludesTax = !!inp.priceIncludesTax;
  const reverseCharge = !!inp.reverseCharge;
  /**
   * ⭐ REGISTRATION TYPE DECIDES WHAT MAY BE CHARGED, BEFORE ANY RATE DOES (Tally's M1/M2; STUDY §6 G2).
   *   seller composition → the invoice carries NO tax: the dealer pays a flat % on turnover and may not collect
   *                        GST from the buyer. The slab rate is still recorded per line (for the trader's own
   *                        books) but every head is zero and the total is the assessable value.
   *   buyer sez          → zero-rated supply (with LUT): rate 0 on the invoice, SupTyp SEZWOP, credit retained.
   *   buyer unregistered → B2C, by definition (also what a missing GSTIN already implied).
   * `RegType` on either party: 'regular' | 'composition' | 'unregistered' | 'sez'. Absent = regular.
   */
  const regOf = (p) => String(p.RegType || p.reg_type || p.gst_registration || 'regular').trim().toLowerCase();
  const sellerComposition = regOf(seller) === 'composition';
  const buyerSez = regOf(buyer) === 'sez';
  const buyerUnregistered = regOf(buyer) === 'unregistered';
  const zeroRate = sellerComposition || buyerSez || !!inp.zeroRated;
  if (sellerComposition) notes.push('Composition scheme: no GST is charged on this invoice. The tax is paid on turnover, and the buyer cannot claim credit.');
  if (buyerSez) notes.push('Supply to an SEZ unit: zero-rated (under LUT). The rate is stated for the record; no tax is charged.');
  const ctx = { supply, priceIncludesTax, zeroRate, scheme };
  const ItemList = (Array.isArray(inp.lines) ? inp.lines : []).map((l, i) => itemLine(l, ctx, i));

  /**
   * ⚠️⚠️ SUMMED PER SLAB, ROUNDED ONCE — not rounded per line and added up. Every line is already 2dp, but the
   * INVOICE total is what a counterparty reconciles, and the round-off is a declared field (`RndOffAmt`) rather
   * than a silent adjustment. A paise mismatch here is not cosmetic: it is the single most common reason a
   * counterparty's system rejects an otherwise correct invoice.
   */
  const bySlab = {};
  let AssVal = 0, CgstVal = 0, SgstVal = 0, IgstVal = 0, CesVal = 0, Discount = 0, TaxVal = 0;
  for (const it of ItemList) {
    AssVal += it.AssAmt; CgstVal += it.CgstAmt; SgstVal += it.SgstAmt; TaxVal += it.TaxAmt || 0;
    IgstVal += it.IgstAmt; CesVal += it.CesAmt; Discount += it.Discount;
    const k = String(it.GstRt);
    const s = bySlab[k] || (bySlab[k] = { GstRt: it.GstRt, AssVal: 0, CgstVal: 0, SgstVal: 0, IgstVal: 0 });
    s.AssVal += it.AssAmt; s.CgstVal += it.CgstAmt; s.SgstVal += it.SgstAmt; s.IgstVal += it.IgstAmt;
  }
  AssVal = r2(AssVal); CgstVal = r2(CgstVal); SgstVal = r2(SgstVal);
  IgstVal = r2(IgstVal); CesVal = r2(CesVal); Discount = r2(Discount); TaxVal = r2(TaxVal);
  for (const k of Object.keys(bySlab)) {
    const s = bySlab[k];
    s.AssVal = r2(s.AssVal); s.CgstVal = r2(s.CgstVal); s.SgstVal = r2(s.SgstVal); s.IgstVal = r2(s.IgstVal);
  }

  const beforeRound = r2(AssVal + CgstVal + SgstVal + IgstVal + CesVal + TaxVal);
  const TotInvVal = Math.round(beforeRound);
  const RndOffAmt = r2(TotInvVal - beforeRound);

  /**
   * ⚠️ REVERSE CHARGE IS SHOWN, NOT COLLECTED. When the buyer accounts for the tax, the invoice still states the
   * rate and the amount — the buyer needs both to self-assess — but the seller does not collect it, so the
   * payable is the assessable value alone. Printing the tax-inclusive total as the amount due would ask the
   * customer to pay tax twice, once here and once to the government.
   */
  const AmountPayable = reverseCharge ? Math.round(r2(AssVal + Discount * 0)) : TotInvVal;
  if (reverseCharge) {
    notes.push('Reverse charge: the buyer accounts for the tax. The tax is stated for their records; '
      + 'only the taxable value is payable to you.');
  }
  if (priceIncludesTax) {
    notes.push('Your prices include tax, so the taxable value was worked back out of each price.');
  }

  return {
    TranDtls: {
      TaxSch: scheme,
      SupTyp: String(inp.supplyKind || (buyerSez ? 'SEZWOP' : ((buyer.Gstin && !buyerUnregistered) ? 'B2B' : 'B2C'))),
      RegRev: reverseCharge ? 'Y' : 'N',
      IgstOnIntra: 'N',
    },
    SellerDtls: pick(seller, ['Gstin', 'LglNm', 'TrdNm', 'Addr1', 'Addr2', 'Loc', 'Pin', 'State', 'Ph', 'Em']),
    BuyerDtls: Object.assign(
      pick(buyer, ['Gstin', 'LglNm', 'TrdNm', 'Addr1', 'Addr2', 'Loc', 'Pin', 'State', 'Ph', 'Em']),
      { Pos: pos }),
    ItemList,
    ValDtls: { AssVal, CgstVal, SgstVal, IgstVal, CesVal, StCesVal: 0, Discount, RndOffAmt, TotInvVal, TaxVal },
    /* Ours, beside the standard shape rather than inside it — a caller needs these and INV-01 has nowhere for them. */
    _cb: { scheme, supply, place_of_supply: pos, seller_state: sellerState, slabs: Object.values(bySlab),
           amount_payable: AmountPayable, reverse_charge: reverseCharge, price_includes_tax: priceIncludesTax,
           notes },
  };
}

function pick(o, keys) {
  const src = o || {};
  const out = {};
  for (const k of keys) {
    const v = src[k] !== undefined ? src[k] : src[k.toLowerCase()];
    if (v !== undefined && v !== null && String(v) !== '') out[k] = v;
  }
  return out;
}

/* ── the provider seam ─────────────────────────────────────────────────────────────────────────────────────── */

/**
 * ⭐ THE SEAM, BORROWED FROM MEDUSA'S ITaxProvider AND WIDENED. Same two methods, same "return tax lines" idea —
 * so a future Avalara/ClearTax provider is a drop-in — but the context carries BOTH parties, because a provider
 * that cannot see the place of supply cannot answer an Indian question.
 *
 * ⚠️ THE DEFAULT PROVIDER DETERMINES NOTHING IT WAS NOT TOLD. It applies the rate on the line and splits it by
 * the supply type. It has no rate table, so it can never be stale — and it can never answer "what rate is this?"
 * either. That question belongs to the entity's HSN declarations or to a real provider, and pretending otherwise
 * is how a compliance liability gets shipped as a convenience.
 */
const systemProvider = {
  getIdentifier() { return 'cb_system'; },
  getTaxLines(lines, context) {
    const out = determine(Object.assign({}, context, { lines }));
    return out.ItemList.map((it) => ({
      line_item_id: it._line_id,
      rate: it.GstRt,
      code: it.HsnCd,
      name: out._cb.supply === 'inter' ? 'IGST' : 'CGST+SGST',
      provider_id: 'cb_system',
      CgstAmt: it.CgstAmt, SgstAmt: it.SgstAmt, IgstAmt: it.IgstAmt, AssAmt: it.AssAmt,
    }));
  },
};
  return { determine: determine, supplyType: supplyType, systemProvider: systemProvider, r2: r2 };
})();

  root.CBTax = { determine: __tax.determine, supplyType: __tax.supplyType, systemProvider: __tax.systemProvider, r2: __tax.r2, slab: __slab };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.CBTax;   /* the till loads it as a module too */
})(typeof window !== 'undefined' ? window : this);
