'use strict';
/**
 * form-handshake.js — WHICH INPUTS FILL WHICH FORM, computed from declarations alone.
 *
 * Athi, 2026-07-29: "this should be generic — ITR-2 and Form 16 can be replaced by any form and any input. At the time
 * of catalogue building, the form and the input should be derived, so the catalogue owner knows what input the form
 * will be filled with."
 *
 * So nothing here knows about tax. THREE THINGS ARE DATA, and none of them is code:
 *   1. the FORM      — what must be true at the end   (the catalogue's declared schema, lib/order-input.js)
 *   2. the SOURCE    — what a document carries        (a declaration: label + field map)
 *   3. the MAPPING   — which source field lands where (inside the source declaration)
 *
 * ONE ENGINE, TWO CALL SITES — this is the point:
 *   • BUILD time  → coverage(form, sources)            "a Form 16 fills 12 of these 17; ask the customer for 5"
 *   • FILL  time  → resolve(form, sources, documents)  the actual values, each stamped with where it came from
 * The owner sees at design time exactly what the customer will experience at fill time, because it is the same
 * function. A promise made by a different code path than the one that keeps it is not a promise.
 *
 * WHAT THIS IS NOT: it does not read PDFs. Deriving a source's field map by SCANNING a document is OCR/layout work —
 * expensive, unreliable, and deliberately NOT a dependency of the handshake. A source declaration can be typed,
 * imported from a schema, or (later) produced by a scanner. The handshake works identically either way, so the
 * generic mechanism never waits on the hardest part.
 */

// ── read a dotted path out of a document, safely (no prototype walking) ──
function get(obj, path) {
  if (!obj || typeof obj !== 'object' || typeof path !== 'string') return undefined;
  let cur = obj;
  for (const key of path.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined;
    if (!Object.prototype.hasOwnProperty.call(cur, key)) return undefined;
    cur = cur[key];
  }
  return cur;
}
const isEmpty = (v) => v === undefined || v === null || v === '';

/**
 * A SOURCE declaration — deliberately shown with abstract names, because no domain belongs in this file:
 *   { key: 'source_a', label: 'Source A', map: { 'section.field_on_document': 'field_on_form', … } }
 * `map` is source-path → form-field. Anything the source carries that is not in `map` is IGNORED, never smuggled
 * onto the form — the form's declaration stays the only thing that decides what the business receives.
 */
// T3.4 · the default key is INDEXED. It used to default to the literal 'source', so two sources without an explicit
// key collided: `bySource[s.key] = []` wiped the earlier one, and coverage reported the wrong attribution while
// `covered` still read 100% — wrong with no visible symptom. Both also read the SAME document in resolve().
function normalise(source, i) {
  const key = (source && source.key) ? String(source.key) : `source_${i == null ? 0 : i}`;
  return { key, label: String((source && source.label) || (source && source.key) || 'Source'),
           map: (source && source.map && typeof source.map === 'object') ? source.map : {} };
}

/**
 * BUILD TIME — what would this set of sources fill, if supplied?
 * Pure declaration maths: no documents needed, which is exactly why the catalogue owner can be told at design time.
 * Returns { declared, required, covered[], residue[], requiredResidue[], pct, bySource{} }.
 *
 * ⚠️ T3.4 · `covered` is an UPPER BOUND on what resolve() will actually fill, not an equality. It answers "which
 * fields COULD this source supply", from declarations alone. At fill time a mapped path may be empty or absent in
 * the real document, so resolve() can fill fewer. Stating it as an equality (as an earlier note did) was only true
 * for the case where every source is supplied and every mapped path holds a value.
 * The relationship that DOES hold, and is asserted by test: resolve().filled ⊆ coverage().covered.
 */
function coverage(formSchema, sources) {
  const props = (formSchema && formSchema.properties) || {};
  const declared = Object.keys(props);
  const required = (formSchema && formSchema.required) || [];
  const list = (Array.isArray(sources) ? sources : []).map((s, i) => normalise(s, i));

  const owner = {};          // form field → the FIRST source that claims it (declaration order = precedence)
  const bySource = {};
  for (const s of list) {
    bySource[s.key] = [];
    for (const target of Object.values(s.map)) {
      if (!Object.prototype.hasOwnProperty.call(props, target)) continue;   // a source cannot invent a field
      if (owner[target]) continue;                                          // earlier source wins
      owner[target] = s.key;
      bySource[s.key].push(target);
    }
  }
  const covered = Object.keys(owner);
  const residue = declared.filter((f) => !owner[f]);
  return {
    declared, required, covered, residue,
    requiredResidue: required.filter((f) => !owner[f]),   // what the customer MUST still supply
    pct: declared.length ? Math.round((covered.length / declared.length) * 100) : 0,
    bySource, owner,
  };
}

/**
 * FILL TIME — actually resolve values from the supplied documents.
 * `documents` is { sourceKey: <the document object> }. Every value carries its provenance, so a contested number can
 * always be traced back to the document that produced it (and to a dispute, later).
 * Returns { value, provenance, filled[], residue[], missingRequired[] }.
 */
function resolve(formSchema, sources, documents) {
  const props = (formSchema && formSchema.properties) || {};
  const required = (formSchema && formSchema.required) || [];
  const list = (Array.isArray(sources) ? sources : []).map((s, i) => normalise(s, i));
  const docs = (documents && typeof documents === 'object') ? documents : {};

  const value = {}, provenance = {};
  for (const s of list) {
    const doc = docs[s.key];
    if (!doc) continue;                                   // declared but not supplied yet — that is normal
    for (const [path, target] of Object.entries(s.map)) {
      if (!Object.prototype.hasOwnProperty.call(props, target)) continue;
      if (!isEmpty(value[target])) continue;              // first source wins, same precedence as coverage()
      const v = get(doc, path);
      if (isEmpty(v)) continue;
      value[target] = v;
      provenance[target] = { source: s.key, label: s.label, path, filled_by: 'document' };
    }
  }
  const filled = Object.keys(value);
  const residue = Object.keys(props).filter((f) => isEmpty(value[f]));
  return { value, provenance, filled, residue, missingRequired: required.filter((f) => isEmpty(value[f])) };
}

/** One line for the wizard: "Form 16 → fills 12 of 17 (71%); 5 left for the customer, 1 of them required." */
function summarise(cov, sources) {
  const names = (Array.isArray(sources) ? sources : []).map((s, i) => normalise(s, i)).map((s) => s.label).join(' + ') || 'no source';
  return `${names} → fills ${cov.covered.length} of ${cov.declared.length} (${cov.pct}%); `
       + `${cov.residue.length} left for the customer`
       + (cov.requiredResidue.length ? `, ${cov.requiredResidue.length} of them required` : '');
}

module.exports = { coverage, resolve, summarise, get };
