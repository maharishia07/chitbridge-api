/* ADOPTED from chitbridge-engines v1.57.1 · country · sha256 b5f798afa364b9effff4f51365357ce5f6d9cd99e8cf7738b41d348de030b3fb — DO NOT EDIT HERE. Change it in chitbridge-engines, release a version, then run tools/adopt.cjs. */
/* chitbridge-engines · country. Edited ONLY in chitbridge-engines/src/country.js; every platform adopts a released version of it. */
(function (root) {
'use strict';
// @stage tested
// @stage-note [BOOKS · COUNTRY REGISTRY] the ONE door a caller asks about a country: its tax ID, its return, its words for screens (R5, v1.53.0).
// @stage-note A caller never names a country (`if (cc === 'AU')`, `pack.abn || pack.trn`); it asks here, and a new country answers through its own pack.
/**
 * country.js — THE COUNTRY REGISTRY (split R5, DESIGN-COUNTRY-ENGINE-SPLIT §4 · DESIGN-SG-COUNTRY-ENGINE §2 · TRIAL-SG-RUNBOOK-2026-10-16).
 * Athi, 2026-10-16: "when we create another country what code change we are expecting to the existing code … and how we can avoid that".
 * Answer: callers ask this file for a STANDARD member; a new country's pack carries that member; nothing existing is edited.
 *
 *   ids()                       → ['IN', 'AU', 'AE', …] — the registered packs, in registry order
 *   packFor(code)               → the pack, or null — NEVER a silent India (unlike regulation.lookup)
 *   taxId(codeOrPack)           → { word, hint, check(v) → { ok, value, why } | null, legacy } — the tax-ID's name, an example, and its check
 *   returnInfo(codeOrPack)      → { form, short, authority, portal, frequencies, builds } | null — the return the pack names (null: none in the books, e.g. India's is read from the rail)
 *   meta(codeOrPack)            → { invoice, connectors, numbering, words, payments } — screen data the pack carries (each null when it carries none)
 *   contractGaps(codeOrPack)    → ['taxId', …] — the standard members the pack does not answer yet (Country Lab shows them)
 *
 * ⭐ THE STANDARD MEMBERS a pack carries for this door (a new country fills them; IN · AU · AE are answered by the frozen adapters below):
 *   taxId:   { name: 'UEN', hint: '201912345K', check(v) → { ok, value, why } }
 *   returns: { id, short, authority, portal, frequencies, periods(o), build(pack, period, movements, opts) }   (gst-returns.returnFor asks `build`)
 *   invoice: { requiredLines: ['trade_name', 'tax_id', …] } · connectors: [{ id, name, fits }] · numbering: { default: docnumber scheme } · words: { taxName, … }
 *
 * ── NEEDS regulation (the pack registry) · NO CLOCK · NO STORAGE ─────────────────────────────────────────────
 */
var G = typeof globalThis !== 'undefined' ? globalThis : root;
/** the pack registry, found when asked (a page may load this file before regulation) */
function reg_() { return (G.CBRegulation && G.CBRegulation.packFor) ? G.CBRegulation : (typeof require === 'function' ? require('./regulation') : null); }

/* ⭐ LEGACY ADAPTERS — the three packs written before this door; their members keep their own names (abn · trn; India's check is the profile-map engine's).
   FROZEN: never a row for a new country — a new country carries `taxId` itself. Words and hints are what the screens showed before R5 (web cap-country.js:86); requiredLines the print setup's (web cap-print.js:33). */
var LEGACY_ = {
  IN: { word: 'GSTIN', hint: '27AAPFU0939F1ZV', member: null, requiredLines: ['trade_name', 'tax_id', 'address'] },
  AU: { word: 'ABN', hint: 'ABN · 11 digits', member: 'abn', requiredLines: ['trade_name', 'tax_id'] },
  AE: { word: 'TRN', hint: 'TRN · 15 digits', member: 'trn', requiredLines: ['trade_name', 'tax_id', 'address'] },
};

function packOf_(x) {
  if (x && typeof x === 'object') return x;
  var code = String(x == null ? '' : x).trim().toUpperCase();
  var R = reg_(); if (!code || !R) return null;
  return R.packFor(code) || null;   /* packFor answers null for an unknown id; it never throws */
}
function ids() { var R = reg_(); return R ? R.list().map(function (p) { return p.id; }) : []; }
function packFor(code) { return packOf_(String(code == null ? '' : code)); }

/** one shape for every check: { ok, value, why } — abn.check answers { ok, abn, formatted, why }, trn.check { ok, trn, tin, why } */
function normalCheck_(fn, key) {
  return function (v) {
    var r = fn(v) || {};
    return { ok: !!r.ok, value: r.value != null ? r.value : (r[key] != null ? r[key] : (r.formatted != null ? r.formatted : null)), why: r.ok ? null : (r.why || null) };
  };
}
function taxId(x) {
  var p = packOf_(x);
  if (!p) return { word: null, hint: null, check: null, legacy: false };
  if (p.taxId && typeof p.taxId === 'object') {
    var t = p.taxId;
    return { word: t.name || (p.tax && p.tax.idName) || null, hint: t.hint || null, check: typeof t.check === 'function' ? normalCheck_(t.check, 'value') : null, legacy: false };
  }
  var L = Object.prototype.hasOwnProperty.call(LEGACY_, p.id) ? LEGACY_[p.id] : null;
  if (L) {
    var m = L.member && p[L.member];
    return { word: L.word, hint: L.hint, check: m && typeof m.check === 'function' ? normalCheck_(m.check, L.member) : null, legacy: true };
  }
  return { word: (p.tax && p.tax.idName) || null, hint: null, check: null, legacy: false };
}
function returnInfo(x) {
  var p = packOf_(x), R = p && p.returns;
  if (!R || !R.id) return null;
  return { form: R.id, short: R.short || R.id, name: R.name || R.id, authority: R.authority || null, portal: R.portal || null,
           frequencies: Array.isArray(R.frequencies) ? R.frequencies.slice() : [], builds: typeof R.build === 'function' || R.id === 'BAS' };
}
function meta(x) {
  var p = packOf_(x) || {};
  var pick = function (k) { return p[k] && typeof p[k] === 'object' ? p[k] : null; };
  var L = p.id && Object.prototype.hasOwnProperty.call(LEGACY_, p.id) ? LEGACY_[p.id] : null;
  return { invoice: pick('invoice') || (L ? { requiredLines: L.requiredLines.slice(), legacy: true } : null), connectors: Array.isArray(p.connectors) ? p.connectors.slice() : null, numbering: pick('numbering'), words: pick('words'),
           payments: Array.isArray(p.payments) ? p.payments.slice() : null };
}
var STANDARD_ = ['taxId', 'returns', 'invoice', 'connectors', 'numbering', 'words'];
function contractGaps(x) {
  var p = packOf_(x); if (!p) return STANDARD_.slice();
  var t = taxId(p), r = returnInfo(p), m = meta(p);
  return STANDARD_.filter(function (k) {
    if (k === 'taxId') return !t.check && !(t.legacy && p.id === 'IN');
    if (k === 'returns') return !r;
    return m[k] == null;
  });
}

const EXPORTS = { ids: ids, packFor: packFor, taxId: taxId, returnInfo: returnInfo, meta: meta, contractGaps: contractGaps, STANDARD: STANDARD_.slice() };

/* ⭐ ONE FILE, EVERY HOST: node takes module.exports; a page takes window.CBCountries (after regulation and the packs). */
if (typeof module !== 'undefined' && module.exports) module.exports = EXPORTS;
if (root && typeof root.window !== 'undefined') root.window.CBCountries = EXPORTS;   /* CBCountries, not CBCountry: the web's Country setup screen owns window.CBCountry */
})(typeof globalThis !== 'undefined' ? globalThis : this);
