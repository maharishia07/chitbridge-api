// lib/boilerplate.js — the DDL keystone: a BOILERPLATE is the sealed mould that DECLARES which sources it inherits
// (a brand catalogue + N standards) and binds locale. Entities minted from it resolve THEIR boilerplate's declared
// sources — not "all active standards" globally. Shared-reference (WITHOUT RLS). Self-healing: tables absent → null.
const { query } = require('../db');

// resolveBoilerplate(key, version?) → { key, version, label, locale, brand, standards:{facet:'src@ver'}, sources:[…] }
async function resolveBoilerplate(key, version) {
  if (!key) return null;
  try {
    const bp = await query(
      `SELECT boilerplate_key, version, label, region_code, locale FROM boilerplate
        WHERE boilerplate_key = $1 AND active = true ${version ? 'AND version = $2' : ''}
        ORDER BY minted_at DESC LIMIT 1`, version ? [key, version] : [key]);
    const row = bp.rows[0];
    if (!row) return null;
    const src = await query(
      `SELECT source_key, source_kind, facet FROM boilerplate_sources WHERE boilerplate_key = $1 AND version = $2`,
      [row.boilerplate_key, row.version]);
    // fold locale from region_layer (b81) under the boilerplate's own bound locale
    let regionLoc = {};
    try {
      const rl = await query(`SELECT currency, units, language, jurisdiction FROM region_layer WHERE region_code = $1`, [row.region_code]);
      if (rl.rows[0]) regionLoc = rl.rows[0];
    } catch (_) { /* region_layer absent */ }

    const standards = {};   // facet -> 'source_key@version' (version defaults v1 for these shared refs)
    let brand = null;
    for (const s of src.rows) {
      const ref = s.source_key.includes('@') ? s.source_key : (s.source_key + '@v1');
      if (s.source_kind === 'brand') brand = ref;
      else if (s.facet) standards[s.facet] = ref;
    }
    return {
      key: row.boilerplate_key, version: row.version, label: row.label, region_code: row.region_code,
      locale: Object.assign({ currency: regionLoc.currency, units: regionLoc.units, jurisdiction: regionLoc.jurisdiction }, row.locale || {}),
      brand, standards, sources: src.rows,
    };
  } catch (_) { /* boilerplate tables not present yet → null (seam falls back to global) */ }
  return null;
}

// the boilerplate an entity was minted from (per-entity stamp, b73/b88). WITH RLS → read inside withEntity by the caller.
async function entityBoilerplateKey(withEntity, entity_id) {
  if (!entity_id) return null;
  try {
    const r = await withEntity(entity_id, (c) => c.query(
      `SELECT boilerplate_key FROM entity_governance WHERE entity_id = $1 LIMIT 1`, [entity_id]));
    return (r.rows[0] && r.rows[0].boilerplate_key) || null;
  } catch (_) { return null; }
}

module.exports = { resolveBoilerplate, entityBoilerplateKey };
