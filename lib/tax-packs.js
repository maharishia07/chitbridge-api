/* ADOPTED from chitbridge-engines v1.86.0 · tax-packs · sha256 060e6c5883026c040b0e0d8fc979ae2563f5b992f01946b02e941acbc221bb80 — DO NOT EDIT HERE. Change it in chitbridge-engines, release a version, then run tools/adopt.cjs. */
/* chitbridge-engines · tax-packs. Edited ONLY in chitbridge-engines/src/tax-packs.js; every platform adopts a released version of it. */
/*
 * OWNS      a country's tax as data (scheme, supply rule, rate menu, invoice round-off) and the ONE readers of its dated rows: rowAsOf, menuAsOf, rateOnMenu, bandFor, rateInBand, retentionYearsFor.
 * CALLED BY tax.js and tax-slab.js (the rate and the band), gst-returns.js (the dated late fee), country.js, the api and the web (adopted copies, window.CBTaxPacks).
 * FLOW      a seller's country ──▶ packFor ──▶ pack.tax ──▶ a dated row read as of a day ──▶ a rate, a band, a limit or a number of years
 * CARD      15-tax-and-country-packs/tax-compute-rate-invoice-tax
 */
(function (root) {
  'use strict';
  /**
   * tax-packs.js — WHAT A COUNTRY'S TAX IS, AS DATA. The tax engines hold the arithmetic; this file holds the country.
   *
   * Athi, 2026-09-27: *"we create the tax engine in such a way that it works for any country and each platform can refer
   * this codebase."* So a country is an ENTRY here, never a branch in tax.js. Adding one is a data change with its own tests;
   * the engines do not change.
   *
   * ── WHAT A PACK SAYS ────────────────────────────────────────────────────────────────────────────────────────────
   *   country           ISO 3166-1 alpha-2
   *   scheme            the scheme code a slab and an invoice carry ('GST', 'VAT' …)
   *   supply            how the supply is classified, which decides the heads:
   *                       'state'  — the seller's state against the PLACE OF SUPPLY: same state → split across two heads
   *                                  (CGST + SGST), another state → one head (IGST). India.
   *                       'border' — the seller's country against the buyer's: domestic → the full rate on one head,
   *                                  cross-border → nothing charged (the buyer accounts for it). A VAT country.
   *   rates             the rates the scheme DEFINES, offered as a picker. ⚠️ A MENU, NOT A MAPPING: it says which numbers
   *                     are legal to type, not which one a product attracts (that is per HSN, and the merchant's).
   *   invoice_round_to  the unit the invoice TOTAL rounds to; the difference is declared as RndOffAmt, never hidden.
   *   source            where the rule comes from, so it can be checked rather than believed.
   *
   * ⭐ DEFAULT_COUNTRY is the pack a party with NO country is read under. It is India because every invoice this engine has
   * ever produced was read that way — the default is not new, it is NAMED here instead of being a bare 'GST' inside tax.js.
   * ⚠️ A scheme with no pack (a slab citing 'VAT' before its country is written) keeps the behaviour it always had: the
   * border rule, and a whole-unit round. That round is wrong for most VAT countries — a pack for the country fixes it.
   *
   * ── ZERO DEPENDENCIES · DATA ONLY ───────────────────────────────────────────────────────────────────────────────
   */
  /* ⭐ v1.21.0 (core-vs-packs a2): the India tax pack moved, unchanged, to src/reg-in.js (its `tax` member). PACKS.IN is that same frozen object.
   v1.28.0 (review fix): no second registry — PACKS is read from the regulation registry (every registered pack's `tax` member), as accounts-packs reads its chart. */
  var REG_ = typeof CBRegulation !== 'undefined' && CBRegulation && CBRegulation.list ? CBRegulation : null;
  if (!REG_ && typeof require === 'function') REG_ = require('./regulation');
  if (!REG_)
    throw new Error(
      'tax-packs.js needs regulation.js (CBRegulation, with the India pack) loaded before it — add the regulation scripts ahead of this one on the page; see the CHANGELOG, v1.28.0.'
    );
  const PACKS = Object.freeze(
    REG_.list().reduce(function (total, item) {
      if (item.tax) total[item.id] = item.tax;
      return total;
    }, {})
  );

  const DEFAULT_COUNTRY = REG_.DEFAULT;

  /** packFor('in') → the pack for that country, or null. Case and spaces do not matter; an unknown country is null, never a guess. */
  function packFor(country) {
    const c = String(country == null ? '' : country)
      .trim()
      .toUpperCase();
    return Object.prototype.hasOwnProperty.call(PACKS, c) ? PACKS[c] : null;
  }

  /** packForScheme('gst') → the pack whose scheme that is, or null. One scheme, one pack — a second would be ambiguous. */
  function packForScheme(scheme) {
    const s = String(scheme == null ? '' : scheme)
      .trim()
      .toUpperCase();
    for (const k of Object.keys(PACKS)) if (PACKS[k].scheme === s) return PACKS[k];
    return null;
  }

  /**
   * rcmCategoryFor(pack, { id?, code? }) → the reverse-charge category (by id, or the first whose code prefix the SAC / HSN starts with), or null.
   * A lookup in the pack's DATA — it decides nothing about who pays; tax.determine applies the supplier's registration to it.
   */
  function rcmCategoryFor(pack, q) {
    const list = (pack && pack.rcm && pack.rcm.categories) || [],
      x = q || {};
    if (x.id != null && x.id !== '') {
      const id = String(x.id);
      for (const c of list) if (c.id === id) return c;
      return null;
    }
    return byCode(list, x.code);
  }

  /**
   * byCode(list, code) → the first row whose `codes` holds a prefix the SAC / HSN starts with, or null. THE one prefix matcher (v1.72.0):
   * rcmCategoryFor and suggestFor both call it, so the two lists can never match differently. Spaces inside the code are ignored; a blank code is null.
   */
  function byCode(list, code) {
    const cleanCode = String(code == null ? '' : code).replace(/\s+/g, '');
    if (!cleanCode) return null;
    for (const row of Array.isArray(list) ? list : []) for (const prefix of row.codes || []) if (cleanCode.indexOf(prefix) === 0) return row;
    return null;
  }

  /**
   * suggestFor(pack, code) → the pack's SUGGESTED rate row for that SAC / HSN (`{ id, codes, rate, itc, name, note, from, cite, status }`), or null.
   * A screen OFFERS it with its citation; the shop taps "Use" or does not. ⚠️ Never applied by itself, and tax-slab.resolve never reads it
   * (DECISIONS 2026-10-24 "yes F5" (a)). A pack without `suggest` (AU · AE …) answers null, never a guess.
   */
  function suggestFor(pack, code) {
    return byCode((pack && pack.suggest) || [], code);
  }

  /**
   * menuAsOf(pack, asOf?) → the rate menu in force on `asOf` (YYYY-MM-DD): `{ from, to, rates, cite, … }` from the pack's dated `rate_menu`
   * (ACC-2 / W-IN-1, v1.72.0). No `asOf` → the row still in force (`to` null): the menu a picker offers today, read without a clock.
   * A pack with no `rate_menu` answers its flat `rates` in the same row shape, whatever the date; no pack → null; a date before the first row → null.
   * ⚠️ A slab or bill is checked against the menu OF ITS OWN DATE, never today's: that is how an issued 12% bill is never flagged after 22 Sep 2025.
   */
  function menuAsOf(pack, asOf) {
    if (!pack || !pack.rates) return null;
    const rows = Array.isArray(pack.rate_menu) ? pack.rate_menu : null;
    if (!rows || !rows.length) return { from: null, to: null, rates: pack.rates, cite: pack.source || null };
    if (asOf == null || asOf === '') return rowInForce_(rows);
    return rowAsOf(rows, asOf);
  }
  /* the row with no end date (the law today), else the last row written */
  function rowInForce_(rows) {
    for (const row of rows) if (row.to == null) return row;
    return rows[rows.length - 1];
  }

  /**
   * rateOnMenu(pack, rate, asOf) → { ok, on_menu, row_from, status, only, why } — may a slab or bill dated `asOf` carry `rate`? v1.81.0 (CTRY-68).
   * Reads menuAsOf, so the answer is the dated DATA row of that day: 12 is on the menu on 2025-09-21 and not on 2025-09-22; 28 is on the 22 Sep 2025 row only
   * for the class its `only` line names (`only` is returned so a screen can say it). `status` is the row's 'confirmed' | 'unconfirmed' (the screen shows it).
   * No date → the row in force (no clock). A day with no menu row answers on_menu false with the reason.
   */
  function rateOnMenu(pack, rate, asOf) {
    const row = menuAsOf(pack, asOf);
    if (!row) return { ok: true, on_menu: false, row_from: null, status: null, only: null, why: 'no GST rate menu was in force on ' + String(asOf).slice(0, 10) };
    const has = Array.prototype.indexOf.call(row.rates, Number(rate)) >= 0;
    const only = row.only && row.only[Number(rate)] ? row.only[Number(rate)] : null;
    return {
      ok: true,
      on_menu: has,
      row_from: row.from,
      status: row.status || null,
      only: only,
      why: has ? (only ? rate + '% is on the menu only for: ' + only : null) : rate + '% is not on the menu in force from ' + row.from + ' (' + row.cite + ')'
    };
  }

  /** is a dated row in force on `asOf`? No asOf = the row still open (`to` null), read without a clock; an unreadable date = in force nowhere */
  function inForce_(row, asOf) {
    if (asOf == null || asOf === '') return row.to == null;
    const wantedDay = String(asOf).slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(wantedDay) && row.from <= wantedDay && (row.to == null || wantedDay <= row.to);
  }

  /**
   * rowAsOf(rows, asOf) → the DATED row in force on `asOf` (YYYY-MM-DD): `from <= day` and (`to` null or `day <= to`), else null. THE one dated-row reader of a pack's
   * moving facts (price bands, late fee, penalty unit, retention), so no two of them read "in force" differently. No `asOf` → the row still open (`to` null), read without a
   * clock, as menuAsOf does. An unreadable date answers null, never the open row. Rows are the pack's own DATA.
   */
  function rowAsOf(rows, asOf) {
    for (const row of Array.isArray(rows) ? rows : []) if (inForce_(row, asOf)) return row;
    return null;
  }

  /**
   * retentionYearsFor(pack, kinds, asOf) → the years a person in these taxes keeps records: the LONGEST `years` among the pack's dated `retention` rows whose `kind` is in `kinds`
   * and that are in force on `asOf` (none = the open rows). A pack with no `retention` rows, or no row for these kinds, answers its flat `retentionYears` (or null). Pure data read.
   */
  function retentionYearsFor(pack, kinds, asOf) {
    const wanted = Array.isArray(kinds) ? kinds : [];
    const years = ((pack && pack.retention) || []).filter((row) => wanted.indexOf(row.kind) >= 0 && inForce_(row, asOf)).map((row) => row.years);
    if (years.length) return Math.max.apply(null, years);
    return pack && typeof pack.retentionYears === 'number' ? pack.retentionYears : null;
  }

  /**
   * bandFor(pack, code, asOf) → the price-band row (pack.price_bands, dated) that names this SAC / HSN on `asOf`, or null. A row names codes by prefix (`codes`) minus the
   * prefixes it excepts (`except`); the match is byCode's, so it can never differ from the other code lists. A pack with no `price_bands`, a blank code, a code no row names
   * or a day no row covers answers null: the line keeps the rate it carried.
   */
  function bandFor(pack, code, asOf) {
    for (const row of (pack && pack.price_bands) || []) {
      if (inForce_(row, asOf) && byCode([row], code) && !byCode([{ codes: row.except || [] }], code)) return row;
    }
    return null;
  }

  /**
   * rateInBand(band, netMinor, pieces, inclusive) → { rate, side: 'up_to' | 'above' } — the rate a price band gives a line. `netMinor` is the line's value in minor units (a whole integer, after
   * discount, as the shop states it) and `pieces` its quantity: the value per piece is at or below `up_to_minor` exactly when netMinor <= up_to_minor × pieces, so the test is on integers, never a
   * division (exactly the limit is the LOWER side; one minor unit more is the upper). The limit is on the TRANSACTION (taxable) value, so a TAX-INCLUSIVE value (`inclusive`) is compared on the
   * taxable value it holds at the band's LOWER rate: netMinor × 100 <= up_to_minor × pieces × (100 + rate_up_to). A bad band, quantity or value answers null.
   */
  function rateInBand(band, netMinor, pieces, inclusive) {
    const count = Number(pieces),
      value = Number(netMinor);
    if (!band || !(band.up_to_minor > 0) || !(count > 0) || !Number.isFinite(value) || value < 0) return null;
    const factor = inclusive ? 100 + Number(band.rate_up_to) : 100;
    const atOrBelow = Number((value * 100).toPrecision(15)) <= Number((band.up_to_minor * count * factor).toPrecision(15));
    return { rate: atOrBelow ? band.rate_up_to : band.rate_above, side: atOrBelow ? 'up_to' : 'above' };
  }

  const EXPORTS = { PACKS, DEFAULT_COUNTRY, packFor, packForScheme, rcmCategoryFor, byCode, suggestFor, menuAsOf, rateOnMenu, rowAsOf, retentionYearsFor, bandFor, rateInBand };

  /* ⭐ ONE FILE, EVERY HOST: node takes module.exports; a page, the TV and the shop PC take window.CBTaxPacks. */
  if (typeof module !== 'undefined' && module.exports) module.exports = EXPORTS;
  if (root && typeof root.window !== 'undefined') root.window.CBTaxPacks = EXPORTS;
})(typeof globalThis !== 'undefined' ? globalThis : this);
