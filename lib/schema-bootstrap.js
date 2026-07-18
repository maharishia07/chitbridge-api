// lib/schema-bootstrap.js — provision a freshly minted entity's DEFAULT schema (reviewer build-item 2).
// The bug: a new entity has no active entity_schemas row, so its catalogue/compose 404s (app.html:1193). This gives it a
// minimal Product schema (Product/Quantity/Price) at mint time. IDEMPOTENT (returns the existing active schema if present)
// and NON-FATAL (a mint/verify must never fail because the default schema couldn't be written). ONE implementation, called
// from wherever an entity is minted — the live signup path now, and the governed path when unification lands (Q2) — so it
// is not built twice. Mirrors the manual POST /api/schemas/create-default logic (plain query, no entity context needed).
const { query } = require('../db');

async function ensureDefaultSchema(entity_id) {
  if (!entity_id) return { created: false, reason: 'no entity_id' };
  try {
    const existing = await query(
      "SELECT schema_id FROM entity_schemas WHERE entity_id = $1 AND status = 'active' LIMIT 1", [entity_id]);
    if (existing.rows.length) return { created: false, schema_id: existing.rows[0].schema_id, existed: true };

    const s = await query(
      `INSERT INTO entity_schemas (entity_id, schema_name, schema_type, source, status, is_default)
       VALUES ($1, 'Product Schema', 'product', 'manual', 'active', true) RETURNING schema_id`, [entity_id]);
    const schema_id = s.rows[0].schema_id;
    // field_key MUST match what the catalogue/compose UI writes: name·unit·price·code·desc (saveNewProduct → item_data).
    // The name field was keyed 'product' → the UI sends 'name' → validateItem 400'd "Product is required" on every add
    // for a default-schema entity. Keep the label "Product" but key it 'name' so the contract matches usage.
    await query(
      `INSERT INTO schema_fields (schema_id, field_name, field_key, field_type, required, min_value, display_order) VALUES
         ($1, 'Product',  'name',     'text',   true, null, 1),
         ($1, 'Quantity', 'quantity', 'number', true, 1,    2),
         ($1, 'Price',    'price',    'number', true, 0,    3)`, [schema_id]);
    return { created: true, schema_id };
  } catch (e) {
    // never block a mint on this — an un-provisioned entity can still create its schema via the manual route.
    console.warn('[schema-bootstrap] ensureDefaultSchema non-fatal:', e.message);
    return { created: false, error: e.message };
  }
}

module.exports = { ensureDefaultSchema };
