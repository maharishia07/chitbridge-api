// lib/conformance.js — LIGHT, ADVISORY conformance check (proof of "the standard actively governs at runtime").
// Reads each ACTIVE canonical standard's required-items template from standard_source (b85/b87) and reports which
// required items are MISSING from the supplied process data. Deterministic (no AI yet); the AI co-assist is the later
// upgrade that adds SEMANTIC contradiction judgement on top of this checklist. Crucially it is ADVISORY:
//   • it NEVER mutates or blocks the chit — it returns a verdict/receipt;
//   • the model stays "co-assist PROPOSES → human AUTHORIZES", the rail stays governance-absolute.
// Self-healing: standard_source absent → nothing to check → { status:'pass' }.
const { query } = require('../db');

function present(v) { return v != null && String(v).trim() !== ''; }
// Look for `key` on the object, and one level into common nested shapes (a chit's fields / item_data / items).
function hasItem(data, key) {
  if (!data || typeof data !== 'object') return false;
  if (present(data[key])) return true;
  for (const k of ['fields', 'item_data', 'items', 'data', 'business_json']) {
    const v = data[k];
    if (Array.isArray(v)) { if (v.some(o => o && present(o[key]))) return true; }
    else if (v && typeof v === 'object' && present(v[key])) return true;
  }
  return false;
}

// checkConformance(data, scope='chit') → { status, scope, advisory, note, checked[], gaps[] }
// SCOPE-AWARE: a standard's required items apply to a specific level. EXIM (trade) → 'chit' (hs_code/incoterms are on
// the chit); ISO 9000 (quality) → 'entity' (a quality_manual lives on the entity, not each chit). Every active standard
// is still READ (proving assimilation) and listed in `checked`, but gaps are only raised for the ones whose scope
// matches — otherwise every chit would falsely fail ISO 9000. A standard with no declared scope defaults to 'entity'.
async function checkConformance(data, scope) {
  scope = scope || 'chit';
  const checked = [], gaps = [];
  try {
    const r = await query(
      `SELECT standard_key, version, facet, title, template FROM standard_source WHERE active = true ORDER BY facet`);
    for (const s of r.rows) {
      const ref = s.standard_key + '@' + s.version;
      const required = (s.template && Array.isArray(s.template.required)) ? s.template.required : [];
      const stdScope = (s.template && s.template.scope) || 'entity';
      const applied = stdScope === scope;
      checked.push({ ref, facet: s.facet, title: s.title, required, scope: stdScope, applied });
      if (applied) for (const item of required) if (!hasItem(data, item)) gaps.push({ standard: ref, facet: s.facet, missing: item });
    }
  } catch (_) { /* standard_source absent → nothing to check */ }
  return {
    status: gaps.length ? 'flagged' : 'pass',
    scope,
    advisory: true,
    note: 'Advisory only — a co-assist proposes, a human authorizes. The chit is not blocked or altered.',
    checked, gaps,
  };
}

// captureFieldsForEntity(entity_id) → the CHIT-SCOPE required fields this entity's assimilated standards must GATHER at
// order time → [{ field, standard, facet, title }]. Scoped to the entity's BOILERPLATE-declared standards (else global
// active). This is what the storefront turns into a capture FORM — the standard directing what to collect (not just flag).
async function captureFieldsForEntity(entity_id) {
  let keys = null;
  try {
    const { entityBoilerplateKey, resolveBoilerplate } = require('./boilerplate');
    const { withEntity } = require('../db');
    const bk = await entityBoilerplateKey(withEntity, entity_id);
    if (bk) { const bp = await resolveBoilerplate(bk); if (bp) keys = Object.values(bp.standards || {}).map(r => String(r).split('@')[0]); }
  } catch (_) { /* no boilerplate → global */ }
  const out = [];
  try {
    const r = keys && keys.length
      ? await query(`SELECT standard_key, version, facet, title, template FROM standard_source WHERE active = true AND standard_key = ANY($1)`, [keys])
      : await query(`SELECT standard_key, version, facet, title, template FROM standard_source WHERE active = true`);
    for (const s of r.rows) {
      if (((s.template && s.template.scope) || 'entity') !== 'chit') continue;
      const ref = s.standard_key + '@' + (s.version || 'v1');
      for (const f of ((s.template && Array.isArray(s.template.required)) ? s.template.required : []))
        out.push({ field: f, standard: ref, facet: s.facet, title: s.title });
    }
  } catch (_) { /* standard_source absent */ }
  return out;
}

module.exports = { checkConformance, captureFieldsForEntity };
