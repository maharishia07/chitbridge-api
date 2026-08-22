// lib/schema-bootstrap.js — provision a freshly minted entity's DEFAULT schema (reviewer build-item 2).
// The bug: a new entity has no active entity_schemas row, so its catalogue/compose 404s (app.html:1193). This gives it a
// minimal Product schema (Product/Quantity/Price) at mint time. IDEMPOTENT (returns the existing active schema if present)
// and NON-FATAL (a mint/verify must never fail because the default schema couldn't be written). ONE implementation, called
// from wherever an entity is minted — the live signup path now, and the governed path when unification lands (Q2) — so it
// is not built twice. Mirrors the manual POST /api/schemas/create-default logic (plain query, no entity context needed).
const { query } = require('../db');

/**
 * ⭐⭐ THE ONE PLACE THE TWO VISIBILITY VOCABULARIES MEET (N5).
 *
 * An entity DECLARES `identities.catalogue_visibility` — `public` · `network` · `private`. A shop is SERVED off
 * `entity_schemas.visibility` — `public` · `restricted` · `private` — which is also what the b49 RLS policy on
 * `catalogue_items` keys on. Two vocabularies, two columns, one fact.
 *
 * ⚠️⚠️ AND NOTHING KEPT THEM IN STEP. This translation ran ONCE, inside `ensureDefaultSchema`, during
 * REGISTRATION — before anyone had chosen anything. Afterwards the Settings control wrote only the identities
 * column, `PATCH /api/schemas/visibility` existed with **no caller anywhere in the front end**, and the served
 * column never moved again. An owner set their shop to public, the screen agreed, and the shop stayed private.
 *
 * ⭐ THE SILENT FAILURE IS THE WHOLE PROBLEM: everything reported success. The write succeeded, the read of the
 * written column succeeded, the UI reflected it — and the column that decides what the world sees was a
 * different one. This codebase keeps producing that exact shape.
 *
 * ⭐ SO IT IS A FUNCTION NOW, not a line inside a bootstrap. Two call sites, one rule: whoever changes the
 * declaration writes the served column through the same translation that created it.
 *
 * ⚠️ `network` MAPS TO `public` AT THE SCHEMA LEVEL, and that is deliberate and pre-existing — the schema
 * column only decides whether the shop is SERVABLE; who may actually see it is narrowed downstream. Changing
 * that mapping here would quietly alter what "network" means, so it is preserved exactly.
 */
function schemaVisibilityFor(declared) {
  return (declared === 'public' || declared === 'network') ? 'public' : 'private';
}

async function ensureDefaultSchema(entity_id) {
  if (!entity_id) return { created: false, reason: 'no entity_id' };
  try {
    const existing = await query(
      "SELECT schema_id FROM entity_schemas WHERE entity_id = $1 AND status = 'active' LIMIT 1", [entity_id]);
    if (existing.rows.length) return { created: false, schema_id: existing.rows[0].schema_id, existed: true };

    /**
     * ── THERE ARE TWO PUBLISH GATES, AND THIS ONE IS THE OLD ONE ────────────────────────────────────────────
     *
     * `entity_schemas.visibility` defaults to 'private', and `catalogue-view.buildPublicView` requires
     * `visibility = 'public'` before it will report a shop as available. b114 then added the REAL publish act —
     * `identities.catalogue_visibility` — and nothing reconciled the two. A shop is only reachable when BOTH say
     * public, and only one of them is the one anybody sets.
     *
     * That was invisible while every entity was published by hand (dept-store-demo calls
     * `PATCH /api/schemas/visibility` explicitly, which is why it passed). The network build made it visible: a
     * minted store is created with `catalogue_visibility` already set from its design, its schema is bootstrapped
     * here at first sign-in with the default 'private', and the storefront then answered 404 for a store the
     * operator had explicitly designed as public. Found by prove-network-mint.js; three unit suites and a passing
     * mint could not see it, because each half was doing exactly what it said.
     *
     * So: if the owner has ALREADY declared the catalogue open, the schema must not be a second, silent gate.
     * Narrow by construction — an ordinary signup is 'private' at this moment (b114's default), so its schema
     * stays private and nothing about the existing path changes. Only an entity whose exposure was decided
     * BEFORE its first sign-in — which today means a network-minted store — takes the other branch.
     *
     * `network` counts as open here: the b114 flag decides WHO may read it, and a network-only warehouse that its
     * own siblings cannot see is not protected, it is broken.
     */
    let declared = 'private';
    try {
      const d = await query('SELECT catalogue_visibility FROM identities WHERE identity_id = $1', [entity_id]);
      declared = (d.rows[0] && d.rows[0].catalogue_visibility) || 'private';
    } catch (_) { /* pre-b114 schema — fall through as private, exactly as before */ }
    const schemaVisibility = schemaVisibilityFor(declared);

    const s = await query(
      `INSERT INTO entity_schemas (entity_id, schema_name, schema_type, source, status, is_default, visibility)
       VALUES ($1, 'Product Schema', 'product', 'manual', 'active', true, $2) RETURNING schema_id`,
      [entity_id, schemaVisibility]);
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

module.exports = { ensureDefaultSchema, schemaVisibilityFor };
