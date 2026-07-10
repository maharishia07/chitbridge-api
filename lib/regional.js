// lib/regional.js — REGIONAL SCATTER (6a): "spin the globe". Resolve a container's presentation + governance for a
// customer REGION, then SEAL it into an immutable resolved blueprint (resolve-at-mint, cache-forever; runtime just
// dereferences). Hybrid merge: global container content < regional override < auto-cascaded basics (currency/units/
// language/jurisdiction). Self-healing: degrades to just the container content if b81 isn't applied.
const { query } = require('../db');
const container = require('./container');

async function regionLayer(region) {
  try { const r = await query('SELECT region_code, currency, units, language, jurisdiction FROM region_layer WHERE region_code = $1', [region]); return r.rows[0] || null; }
  catch (_) { return null; }
}
async function regionOverride(containerId, region) {
  try { const r = await query('SELECT overrides FROM container_region_override WHERE container_id = $1 AND region_code = $2', [containerId, region]); return (r.rows[0] && r.rows[0].overrides) || {}; }
  catch (_) { return {}; }
}

// setRegionOverride: the source authors a per-region delta on its OWN container (owner-gated). Throws {status:403}.
async function setRegionOverride(owner, containerId, region, overrides) {
  const c = await container.getContainer(containerId);
  if (!c) { const e = new Error('Unknown container.'); e.status = 404; throw e; }
  if (c.owner_entity_id && String(c.owner_entity_id) !== String(owner)) { const e = new Error('This container is owned by another brand.'); e.status = 403; throw e; }
  await query(
    `INSERT INTO container_region_override (container_id, region_code, overrides, updated_at) VALUES ($1,$2,$3::jsonb, now())
     ON CONFLICT (container_id, region_code) DO UPDATE SET overrides = EXCLUDED.overrides, updated_at = now()`,
    [containerId, region, JSON.stringify(overrides || {})]);
  return { container_id: containerId, region_code: region };
}

// resolveRegional(container, version?, region) → the SEALED resolved blueprint for that region. Cache hit → return the
// sealed view (runtime dereference). Else compute the merge, SEAL it (immutable), return. version omitted → current.
async function resolveRegional(containerId, version, region) {
  const c = await container.resolveContainer(containerId, (version != null && version !== '') ? Number(version) : undefined);
  if (!c) return null;
  const v = c.version;
  // cache: the sealed resolved blueprint (immutable per container/version/region)
  try {
    const cached = await query('SELECT resolved, sealed_at FROM resolved_blueprint WHERE container_id=$1 AND version=$2 AND region_code=$3', [containerId, v, region]);
    if (cached.rows[0]) return { container_id: containerId, version: v, region, resolved: cached.rows[0].resolved, sealed: true, sealed_at: cached.rows[0].sealed_at };
  } catch (_) { /* b81 absent → compute below, seal will no-op */ }
  // compute: global content < regional override < auto-cascaded basics
  const layer = (await regionLayer(region)) || {};
  const ov = await regionOverride(containerId, region);
  const resolved = Object.assign({}, c.content || {}, ov, {
    _region: region,
    _basics: { currency: layer.currency || null, units: layer.units || null, language: layer.language || null },
    _jurisdiction: layer.jurisdiction || {},
    _under: containerId + '@' + v,
  });
  // seal (immutable; NO overwrite of an existing seal)
  try { await query('INSERT INTO resolved_blueprint (container_id, version, region_code, resolved) VALUES ($1,$2,$3,$4::jsonb) ON CONFLICT (container_id, version, region_code) DO NOTHING', [containerId, v, region, JSON.stringify(resolved)]); }
  catch (_) { /* b81 absent → cannot seal; still return the computed view */ }
  return { container_id: containerId, version: v, region, resolved, sealed: false };
}

module.exports = { resolveRegional, setRegionOverride, regionLayer };
