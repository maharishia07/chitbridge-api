// @stage tested
// @stage-note The ONE path that writes products. Extracted from routes/products.js when the counter became a
// @stage-note second caller — declare, validate, stamp, insert, meter, in that order and only in this file.
'use strict';
/**
 * catalogue-write.js — HOW A PRODUCT GETS INTO A CATALOGUE, IN ONE PLACE ([TILL-107]).
 *
 * ── ⚠️⚠️ WHY THIS FILE EXISTS ────────────────────────────────────────────────────────────────────────────────
 *
 * The bulk add in routes/products.js already did this correctly, and correctly is a lot of steps in a fixed
 * order: resolve the schema once · read the rules once · validate every row BEFORE writing any · declare the
 * columns · stamp the money · insert · meter. Each step is there because something went wrong without it, and
 * the comments in routes/products.js record which.
 *
 * Then the counter needed to write products too ([TILL-107]: a shop minting a starter catalogue, or uploading a
 * spreadsheet). A second copy of a seven-step sequence is a second copy of seven decisions, and they would
 * agree on the day they were written and quietly disagree afterwards — which is this codebase's own stated
 * failure mode, and the reason for the rule: *a second call site means a helper NOW.*
 * [[feedback-no-duplicate-functions]] [[feedback-adopt-dont-reinvent]]
 *
 * ⚠️ IT IS NOT A NEW POLICY. Nothing here decides anything routes/products.js did not already decide; the order
 * and the refusals are carried over unchanged. If this file and that route ever differ, this file is wrong.
 */
const { query, withEntity } = require('../db');
const money = require('./money');
const catcols = require('./catalogue-columns');
const regional = require('./regional');

/** the entity's default schema, or null when it has never had one */
async function defaultSchemaId(entity_id) {
  const r = await query(
    `SELECT schema_id FROM entity_schemas
     WHERE entity_id = $1 AND status='active' AND is_default=true LIMIT 1`, [entity_id]);
  return (r.rows[0] && r.rows[0].schema_id) || null;
}

/**
 * ⚠️ READ THE RULES ONCE. Athi, 2026-08-06: *"any of this implementation, if it is greater than O(1), is not
 * required — it will be very costly."* A 2000-row upload must not fire 2000 identical queries for a rule set
 * that cannot change mid-request.
 */
async function schemaFieldsOf(schema_id) {
  if (!schema_id) return [];
  const f = await query(
    `SELECT field_key, field_name, field_type, required, min_value
     FROM schema_fields WHERE schema_id = $1`, [schema_id]);
  return f.rows;
}

/** Pure: the schema's rules against rows already in hand. No I/O. */
function validateAgainst(fieldRows, item_data) {
  for (const field of (fieldRows || [])) {
    if (field.field_key === 'quantity') continue;
    /* ⚠️ a stamped price is { amount, currency }, and String() on that is "[object Object]" → NaN → "must be a
       number". Found in production: it refused a legitimate round-trip edit. Judge money on its AMOUNT. */
    const rawV = item_data ? item_data[field.field_key] : undefined;
    const v = (money.isMoney(rawV) ? String(rawV.amount) : (rawV == null ? '' : String(rawV))).trim();
    if (field.required && !v) return field.field_name + ' is required';
    if (field.field_type === 'number' && v !== '' && !catcols.IDENT_KEYS.has(field.field_key)) {
      const n = Number(v);
      if (Number.isNaN(n)) return field.field_name + ' must be a number';
      if (n < 0) return field.field_name + ' cannot be negative';
      if (field.min_value != null && n < Number(field.min_value))
        return field.field_name + ' must be at least ' + field.min_value;
    }
  }
  return null;
}

/**
 * ── ⭐⭐⭐ writeItems({ entity_id, items }) — THE WHOLE SEQUENCE, OR NOTHING ───────────────────────────────────
 *
 * @returns { ok:true, rows, schema_id } · or { ok:false, status, error, message, invalid }
 *
 * ⚠️⚠️ NOTHING IS WRITTEN IF ANY ROW IS REFUSED. Half an import is worse than none: the shop cannot tell which
 * half, and re-running it duplicates the half that landed. Validation runs over every row first.
 *
 * ⚠️ DECLARE BEFORE WRITE. catalogue_items.item_data is free-form jsonb and schema_fields declares the columns;
 * nothing binds them, so a write that skips the declaration puts a column in the data that no screen knows
 * about. catalogue-columns exists precisely to stop that, and it must be called on every path.
 */
async function writeItems(opts) {
  const entity_id = opts.entity_id;
  const items = Array.isArray(opts.items) ? opts.items : [];
  if (!items.length) return { ok: false, status: 400, error: 'validation', message: 'No products were given.' };
  if (!items.every((it) => it && typeof it === 'object' && !Array.isArray(it)))
    return { ok: false, status: 400, error: 'validation', message: 'Every item must be an object.' };

  const schema_id = await defaultSchemaId(entity_id);
  const currency = await regional.currencyFor(entity_id);

  const ruleRows = await schemaFieldsOf(schema_id);
  const bad = [];
  for (let i = 0; i < items.length; i++) {
    const verr = validateAgainst(ruleRows, items[i]);
    if (verr) bad.push({ index: i, message: verr });
  }
  if (bad.length) {
    return { ok: false, status: 400, error: 'Invalid product',
      message: bad.length + ' item(s) were refused and nothing was written.', invalid: bad };
  }

  const decl = await catcols.ensureDeclaredMany({
    query, entity_id, schema_id, items,
    ensureSchema: (e) => require('./schema-bootstrap').ensureDefaultSchema(e),
  });
  const sid = decl.schema_id || schema_id;

  /* ⚠️ STAMP AFTER VALIDATION, on the raw shape, so the schema still saw the number a person typed */
  const stamped = decl.items.map((it) => JSON.stringify(money.stampItem(it, currency)));

  const r = await withEntity(entity_id, (db) => db.query(
    `INSERT INTO catalogue_items (entity_id, schema_id, item_data)
     SELECT $1, $2, x FROM unnest($3::jsonb[]) AS x
     RETURNING *`,
    [entity_id, sid, stamped]));

  /* ⭐ metered after the write, best-effort, never blocking */
  try {
    const meter = require('./meter').meter;
    for (const row of r.rows) meter(entity_id, 'catalogue.item', { detail: row.item_id }).catch(() => {});
  } catch (_) {}

  /* ⚠️ THE DECLARATION TRAVELS BACK. The bulk route reports which columns were newly declared and any
     warnings with them; dropping it in the extraction would have quietly emptied that half of the response.
     A refactor that loses a field is not invisible, which was the whole condition for doing it. */
  return { ok: true, rows: r.rows, schema_id: sid, declared: decl };
}

/**
 * ⭐ the codes a shop is already using, so a sequence can be allocated against fact rather than a counter.
 * ⚠️ BOTH SPELLINGS. The till reads `d.code || d.sku` and a spreadsheet may have supplied either, so a sequence
 * that looked at only one would hand out a code the other half of the catalogue already holds.
 */
async function codesInUse(entity_id) {
  const r = await withEntity(entity_id, (db) => db.query(
    `SELECT COALESCE(item_data->>'code', item_data->>'sku') AS code
       FROM catalogue_items
      WHERE entity_id = $1 AND COALESCE(item_data->>'code', item_data->>'sku') IS NOT NULL`, [entity_id]));
  return r.rows.map((x) => x.code).filter(Boolean);
}

/** how many sellable products the shop has — what "is this catalogue empty?" means */
async function countItems(entity_id) {
  const r = await withEntity(entity_id, (db) => db.query(
    `SELECT COUNT(*)::int AS n FROM catalogue_items WHERE entity_id = $1 AND is_active IS NOT false`, [entity_id]));
  return (r.rows[0] && r.rows[0].n) || 0;
}

module.exports = { writeItems, codesInUse, countItems, defaultSchemaId, schemaFieldsOf, validateAgainst };
