/**
 * ── lib/mint-product.js · THE ONE WAY A PRODUCT ENTERS A CATALOGUE ─────────────────────────────────────────────
 *
 * Extracted 2026-09-10, when adopting a supplier's delivery became a second way to create a product.
 *
 * ⭐⭐⭐ AND routes/products.js ALREADY WROTE DOWN WHY THIS MATTERS, about an earlier version of the same mistake:
 *
 *   *"THE CSV IMPORT ALREADY DID THIS CORRECTLY and this route did not, which is the part that made it a bug
 *    rather than a design: the SAME act — adding a product with a new field — behaved differently depending on
 *    which door it came through. One writer, so there is one behaviour."*
 *
 * Adoption is a third door. Writing its own INSERT would have re-made exactly the bug that comment describes, so
 * the chain lives here and every door calls it:
 *
 *   1 · ensureDeclared  — a field the catalogue has never declared gets declared, so the Columns panel, the
 *                         template and the export cannot answer "what are my columns" three different ways.
 *   2 · stampItem       — the price acquires the OWNING entity's currency here and nowhere else.
 *   3 · INSERT          — one statement, under the entity's own RLS.
 *   4 · meter + bell    — after the write, best-effort, never blocking.
 *
 * ⚠️ NOTHING HERE DECIDES WHETHER A PRODUCT *MAY* BE CREATED. That is lib/adopt.js for a delivery and the form's
 * own validation for a person. This is the act, once the decision is made — keeping the two apart is what stops a
 * policy from being quietly re-implemented at a second door.
 */
'use strict';

async function mintProduct(o) {
  const { query, withEntity, entity_id, schema_id, item_data, rid } = o;
  const catcols = require('./catalogue-columns');
  const money = require('./money');
  const regional = require('./regional');

  const decl = await catcols.ensureDeclared({
    query, entity_id, schema_id, item_data,
    ensureSchema: (e) => require('./schema-bootstrap').ensureDefaultSchema(e),
    validate: o.validate,
  });
  if (decl.error) return { error: decl.error };

  /* ⚠️ VALIDATION RUNS FIRST, ON THE RAW SHAPE, so the schema still sees the number a person typed — stamping a
     currency before validating would show a form error about a value nobody entered. */
  const stamped = money.stampItem(decl.item_data, await regional.currencyFor(entity_id));

  const r = await withEntity(entity_id, (db) => db.query(
    `INSERT INTO catalogue_items (entity_id, schema_id, item_data)
     VALUES ($1,$2,$3) RETURNING *`,
    [entity_id, decl.schema_id || schema_id, JSON.stringify(stamped)]));

  try { require('./meter').meter(entity_id, 'catalogue.item',
    { detail: r.rows[0] && r.rows[0].item_id, rid }).catch(() => {}); } catch (_) {}
  try { require('./shopchanged').shopChanged(entity_id, o.note || 'product added'); } catch (_) {}

  return { item: r.rows[0], declared: decl.declared, warnings: decl.warnings };
}

module.exports = { mintProduct };
