/* ADOPTED from chitbridge-engines v1.64.1 · pack-kit · sha256 265fed3faa84578d00043d07aef4eab0176827cff617dc583ea1e160a9147f37 — DO NOT EDIT HERE. Change it in chitbridge-engines, release a version, then run tools/adopt.cjs. */
/* chitbridge-engines · pack-kit. Edited ONLY in chitbridge-engines/src/pack-kit.js; every platform adopts a released version of it. */
(function (root) {
'use strict';
// @stage tested
// @stage-note [BOOKS · COUNTRY HELPERS] what every country pack does the same way, written once (DESIGN-COUNTRY-ENGINE-SPLIT R1, v1.51.0).
// @stage-note A pack is its own engine; it calls these. A change here re-runs every country's golden (tests/golden.test.js).
/**
 * pack-kit.js — THE COUNTRY HELPERS (R1). Athi, 2026-10-16: "each country should have its own engine … if there are shared functionalities,
 * that has to be handled as a helper functions" and "if there is a change to the helper function, then every engine should be tested."
 *
 * Lifted VERBATIM from reg-in / reg-au / reg-ae; what differed between the copies (a unit word, a head name, a sentence) is now an argument.
 *   refuse(why)                              → an Error marked `refused` (the one way a pack says no)
 *   pad2(n) · ymd(y, m, d) · lastDay(y, m)   → calendar strings, UTC, no clock
 *   int(v, where, unit)                      → a ledger amount as a whole number of `unit` ('cents', 'fils'), else refused
 *   lineExtras(r, g, pack)                   → { group_name, line, line_label, statement } from pack.presentation.lines (IFRS-worded packs)
 *   singleHeadSetOff(o, minor, { head, negative, leftover }) → { utilised, payable, carried, [leftover] } for a ONE-head tax (GST AU, VAT AE)
 *   noCreditSetOff(o, minor, { head, negative }) → { utilised: [], payable, carried } for a SINGLE-STAGE tax with NO input credit (SST, US sales tax): the whole output is payable
 *   returnRow(code, label, amount, tax, roles, note)  → one box of a return in the shape gst-returns.returnFor hands a screen (R2)
 *
 * ── ZERO DEPENDENCIES · NO CLOCK · NO STORAGE ──────────────────────────────────────────────────────────────
 */
function refuse(why) { var e = new Error(why); e.refused = true; return e; }
function pad2(n) { return String(n).padStart(2, '0'); }
function ymd(y, m, d) { return y + '-' + pad2(m) + '-' + pad2(d); }
function lastDay(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
function int(v, where, unit) { var n = v == null ? 0 : Number(v); if (!Number.isInteger(n)) throw refuse('A ledger amount is a whole number of ' + unit + ' — ' + where + ' is not.'); return n; }
function lineExtras(r, g, pack) {
  const p = pack, key = r.line || g.line;
  const line = (p.presentation && p.presentation.lines && Object.prototype.hasOwnProperty.call(p.presentation.lines, key)) ? p.presentation.lines[key] : null;
  return { group_name: g.name, line: key, line_label: line ? line.label : null, statement: line ? line.st : null };
}
/** a return's box as one row: { code, label, amount_minor, tax_minor, roles, note } — moved from gst-returns.row_ (R2); a BAS label has one figure, a VAT201 box two */
function returnRow(code, label, amount, tax, roles, note) { return { code: String(code), label: label, amount_minor: amount == null ? null : amount, tax_minor: tax == null ? null : tax, roles: roles || [], note: note || null }; }
function singleHeadSetOff(o, minor, w) {
  var h = w.head, out = minor((o.output || {})[h]), inp = minor((o.input || {})[h]);
  if (out < 0 || inp < 0) throw refuse(w.negative);
  var a = Math.min(inp, out), used = a > 0 ? [{ from: h, against: h, amount: a }] : [];
  var r = { utilised: used, payable: {}, carried: {} };
  r.payable[h] = out - a; r.carried[h] = inp - a; r[w.leftover] = inp - a;
  return r;
}

function noCreditSetOff(o, minor, w) {
  var h = w.head, out = minor((o.output || {})[h]), inp = minor((o.input || {})[h]);
  if (out < 0 || inp < 0) throw refuse(w.negative);
  var r = { utilised: [], payable: {}, carried: {} };
  r.payable[h] = out; r.carried[h] = 0;
  return r;
}

const EXPORTS = { noCreditSetOff: noCreditSetOff, refuse: refuse, pad2: pad2, ymd: ymd, lastDay: lastDay, int: int, lineExtras: lineExtras, singleHeadSetOff: singleHeadSetOff, returnRow: returnRow };

/* ⭐ ONE FILE, EVERY HOST: node takes module.exports; a page, the TV and the shop PC take window.CBPackKit (loaded before any pack). */
if (typeof module !== 'undefined' && module.exports) module.exports = EXPORTS;
if (root && typeof root.window !== 'undefined') root.window.CBPackKit = EXPORTS;
})(typeof globalThis !== 'undefined' ? globalThis : this);
