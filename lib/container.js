// lib/container.js — the CONTAINER MODEL primitive (see SPEC-source-governed-distribution.md §7b).
// A container is a STABLE product identity that POINTS to its current immutable version. Authoring an existing
// container never mutates a version — it MINTS the next one and moves the pointer. So:
//   • resolve(container)            → the CURRENT version (the pointer) — auto-reflects the latest enhancement.
//   • resolve(container, version)   → that EXACT immutable version — what a chit pinned; verifiable forever.
// WITHOUT RLS (shared reference); writes owner-gated here (app-side), since product_container is not RLS-scoped.
const { query } = require('../db');

async function getContainer(containerId) {
  try {
    const r = await query('SELECT container_id, owner_entity_id, source_key, name, current_version FROM product_container WHERE container_id = $1', [containerId]);
    return r.rows[0] || null;
  } catch (_) { return null; }   // table absent (pre-b80) → null; caller decides
}

// authorContainer(owner, {...}) → create (v1) OR enhance (mint next immutable version + move the pointer). Owner-only
// for an existing container. Throws {status:403} on ownership violation; DB errors bubble (endpoint maps to 503).
async function authorContainer(owner, { container_id, name, source_key, content, schema, schema_version }) {
  const existing = await getContainer(container_id);
  if (existing && existing.owner_entity_id && String(existing.owner_entity_id) !== String(owner)) {
    const e = new Error('This product container is owned by another brand.'); e.status = 403; throw e;
  }
  const c = (content && typeof content === 'object') ? content : {};
  const s = (schema && typeof schema === 'object') ? schema : {};
  const sv = schema_version || null;
  if (!existing) {
    await query('INSERT INTO product_container (container_id, owner_entity_id, source_key, name, current_version) VALUES ($1,$2,$3,$4,1)',
      [container_id, owner, source_key || null, name || null]);
    await query('INSERT INTO product_version (container_id, version, content, schema, schema_version) VALUES ($1,1,$2::jsonb,$3::jsonb,$4)',
      [container_id, JSON.stringify(c), JSON.stringify(s), sv]);
    return { container_id, version: 1, is_new_container: true };
  }
  const nextV = (existing.current_version || 1) + 1;
  // product_version is INSERT-only (immutable) — this ADDS a version, never overwrites.
  await query('INSERT INTO product_version (container_id, version, content, schema, schema_version) VALUES ($1,$2,$3::jsonb,$4::jsonb,$5)',
    [container_id, nextV, JSON.stringify(c), JSON.stringify(s), sv]);
  await query('UPDATE product_container SET current_version=$2, name=COALESCE($3,name), updated_at=now() WHERE container_id=$1',
    [container_id, nextV, name || null]);
  return { container_id, version: nextV, is_new_container: false };
}

// resolveContainer(id, version?) → a SPECIFIC immutable version (chit verification) or the CURRENT version (the pointer).
async function resolveContainer(containerId, version) {
  const c = await getContainer(containerId);
  if (!c) return null;
  const v = (version != null && version !== '') ? Number(version) : c.current_version;
  let row = null;
  try {
    const r = await query('SELECT container_id, version, content, schema, schema_version, minted_at FROM product_version WHERE container_id=$1 AND version=$2', [containerId, v]);
    row = r.rows[0] || null;
  } catch (_) { row = null; }
  if (!row) return null;
  return {
    container_id: c.container_id, owner_entity_id: c.owner_entity_id, source_key: c.source_key, name: c.name,
    current_version: c.current_version, version: row.version, is_current: row.version === c.current_version,
    content: row.content || {}, schema: row.schema || {}, schema_version: row.schema_version || null, minted_at: row.minted_at,
  };
}

module.exports = { authorContainer, resolveContainer, getContainer };
