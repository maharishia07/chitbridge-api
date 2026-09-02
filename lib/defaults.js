// @stage tested
// @stage-note Catalogue declares, row overrides, system records which answered. Pure — no I/O, no DB.
'use strict';
/**
 * defaults.js — the catalogue declares it, a row overrides it, and we know which answered.
 *
 * Athi, 2026-09-02: *"unit, offers, pricing model etc — each row knows the details? that has to be like
 * availability, system defined, but the business can change it, how do we bring it?"* and, on which of them a
 * merchant actually varies per product: *"unit yes, pricing model rarely, offers never."*
 *
 * ── ⭐⭐ THIS PATTERN ALREADY EXISTS THREE TIMES. THIS IS THE FOURTH COAT, NOT A FOURTH MECHANISM. ───────────────
 *
 *   currency        the ENTITY declares it · every price inherits · nobody ever types it        (money.js)
 *   unit            the CATALOGUE declares an allowed set · each item picks from it             (face.units)
 *   adopted lines   the SOURCE declares · the adopter's `commercials` overlay wins per field    (catalogue-read)
 *
 * One rule wearing three coats: **a default declared once, overridden where it differs, with the system knowing
 * which of the two answered.** The third of those — `referencedLine` — already returns per-field provenance
 * (`'source'` vs `'own'`) and is proven live, so the shape is not a guess.
 *
 * ── ⚠️ A BLANK CELL MEANS *INHERIT*, NOT *CLEAR* ───────────────────────────────────────────────────────────────
 * The same rule availability just taught us: absent is not a value. A merchant who clears the `unit` column to
 * tidy their sheet is not saying "these products have no unit" — they are saying nothing, and the catalogue
 * default answers. Writing `unit: ''` instead would silently destroy every override in one upload, and the file
 * would look completely reasonable.
 *
 * ── ⚠️ AND CHANGING THE DEFAULT MOVES EVERY ROW THAT DID NOT OVERRIDE ──────────────────────────────────────────
 * That is the intended behaviour — it is the same reason a product stores a category ID and not the word, so a
 * rename propagates. But it is invisible unless a screen says so, and data that changes by itself reads as a
 * bug. `usage()` below exists for exactly that sentence: *"38 products use the catalogue default."*
 *
 * ── ZERO DEPENDENCIES · TIER A ─────────────────────────────────────────────────────────────────────────────────
 */

/**
 * ⚠️⚠️ WHAT MAY BE DEFAULTED, AND — the part that decides whether the screen is usable — WHETHER IT EARNS A
 * COLUMN. Athi's answer is the registry: *"unit yes, pricing model rarely, offers never."*
 *
 * `column: 'always'`  a real column; people genuinely maintain it per product
 * `column: 'if-varies'` a column ONLY when some row actually differs; otherwise it is a catalogue setting and
 *                      never appears in a sheet at all
 * `column: 'never'`   not a cell. Applying an offer to forty products is a screen action over a selection —
 *                      putting it in a spreadsheet would be the wide-sheet problem all over again
 */
const DEFAULTABLE = {
  unit: {
    column: 'always',
    faceKey: 'default_unit',
    label: 'Unit',
    help: 'The unit this product is sold in. Blank means the catalogue default.',
  },
  pricing_model: {
    column: 'if-varies',
    faceKey: 'default_pricing_model',
    label: 'Pricing model',
    help: 'How the price is arrived at. Blank means the catalogue default — most catalogues use one throughout.',
  },
  /**
   * ⚠️ NEVER A COLUMN, AND THAT IS NOT THE SAME AS "not per row". An offer CAN apply to one product; it is just
   * not something anybody maintains by typing into a cell, forty rows at a time. See the note in the header.
   */
  offers: { column: 'never', faceKey: 'default_offers', label: 'Offers', help: 'Applied from the Offers screen.' },
};

/** Keys that appear in a sheet at all (before the if-varies test). */
const COLUMN_KEYS = Object.keys(DEFAULTABLE).filter((k) => DEFAULTABLE[k].column !== 'never');

const blank = (v) => v === null || v === undefined || (typeof v !== 'object' && String(v).trim() === '');

/** The catalogue's declared defaults, from the face. Tolerant of a face that has none. */
function declared(face) {
  const f = (face && typeof face === 'object') ? face : {};
  const d = (f.defaults && typeof f.defaults === 'object') ? f.defaults : {};
  const out = {};
  for (const [key, spec] of Object.entries(DEFAULTABLE)) {
    /* Accept both `defaults.unit` and the older flat `face.default_unit`, so a face written either way resolves. */
    const v = !blank(d[key]) ? d[key] : (!blank(f[spec.faceKey]) ? f[spec.faceKey] : undefined);
    if (v !== undefined) out[key] = v;
  }
  /**
   * ⭐ ONE ALLOWED UNIT IS ALREADY AN ANSWER. cap-catalogue has done this since it was written — *"one allowed
   * unit → name it in the commercials label; several → items carry their own"*. If a catalogue trades in exactly
   * one unit, nobody should be asked per product, so that single unit IS the default.
   */
  if (out.unit === undefined && Array.isArray(f.units) && f.units.length === 1 && !blank(f.units[0])) {
    out.unit = f.units[0];
  }
  return out;
}

/**
 * resolve(key, item_data, face) → { value, from }
 *
 * `from` ∈ 'row' | 'catalogue' | 'none'. The caller shows the VALUE and, where it matters, can say where it came
 * from — never both as two columns.
 */
function resolve(key, item_data, face) {
  const it = (item_data && typeof item_data === 'object') ? item_data : {};
  if (!blank(it[key])) return { value: it[key], from: 'row' };
  const d = declared(face);
  if (d[key] !== undefined) return { value: d[key], from: 'catalogue' };
  return { value: undefined, from: 'none' };
}

/**
 * effective(item_data, face) → a row with the defaults filled in.
 *
 * ⚠️ IT RETURNS A COPY AND NEVER MUTATES. The stored row must keep meaning "I did not say" — the moment a
 * resolved value is written back into `item_data`, the override and the inheritance become indistinguishable and
 * changing the catalogue default stops reaching that row. Resolution is a READ, permanently.
 */
function effective(item_data, face) {
  const it = (item_data && typeof item_data === 'object') ? item_data : {};
  const out = Object.assign({}, it);
  for (const key of Object.keys(DEFAULTABLE)) {
    if (DEFAULTABLE[key].column === 'never') continue;
    const r = resolve(key, it, face);
    if (r.from === 'catalogue') out[key] = r.value;
  }
  return out;
}

/**
 * usage(items, face) → { unit: { overridden: n, inherited: n, varies: bool }, … }
 *
 * ⭐ THE SENTENCE A SCREEN NEEDS. Changing a catalogue default silently moves every row that did not override,
 * which is correct and looks like a bug unless somebody is told the count first. It also answers the `if-varies`
 * question — whether a column has earned its place in this catalogue's sheet.
 */
function usage(items, face) {
  const list = Array.isArray(items) ? items : [];
  const d = declared(face);
  const out = {};
  for (const key of Object.keys(DEFAULTABLE)) {
    if (DEFAULTABLE[key].column === 'never') continue;
    let overridden = 0, inherited = 0;
    const seen = new Set();
    for (const it of list) {
      const r = resolve(key, it, face);
      if (r.from === 'row') { overridden++; seen.add(String(r.value)); }
      else if (r.from === 'catalogue') inherited++;
    }
    if (d[key] !== undefined) seen.add(String(d[key]));
    out[key] = { overridden, inherited, distinct: seen.size, varies: seen.size > 1, default: d[key] };
  }
  return out;
}

/**
 * columnsFor(items, face) → the defaultable keys this catalogue's sheet should carry.
 *
 * ⚠️ THIS IS THE WHOLE ANTI-WIDE-SHEET RULE, IN ONE FUNCTION. `always` earns a column; `if-varies` earns one only
 * when the catalogue actually varies; `never` never does. A catalogue that prices everything one way never sees
 * a pricing column, and does not have to wonder what it is for.
 */
function columnsFor(items, face) {
  const u = usage(items, face);
  return COLUMN_KEYS.filter((k) => DEFAULTABLE[k].column === 'always' || (u[k] && u[k].varies));
}

module.exports = { DEFAULTABLE, COLUMN_KEYS, declared, resolve, effective, usage, columnsFor };
