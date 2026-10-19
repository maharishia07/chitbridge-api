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
 * CARD storefront-and-catalogue/catalogue-write
 */
const { query, withEntity } = require('../db');
const log = require('./logger');
const money = require('./money');
const catcols = require('./catalogue-columns');
const regional = require('./regional');

/** the entity's default schema, or null when it has never had one */
async function defaultSchemaId(entity_id) {
  const r = await query(
    `SELECT schema_id FROM entity_schemas
     WHERE entity_id = $1 AND status='active' AND is_default=true LIMIT 1`,
    [entity_id]
  );
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
     FROM schema_fields WHERE schema_id = $1`,
    [schema_id]
  );
  return f.rows;
}

/** Pure: the schema's rules against rows already in hand. No I/O. */
function validateAgainst(fieldRows, item_data) {
  for (const field of fieldRows || []) {
    if (field.field_key === 'quantity') continue;
    /* ⚠️ a stamped price is { amount, currency }, and String() on that is "[object Object]" → NaN → "must be a
       number". Found in production: it refused a legitimate round-trip edit. Judge money on its AMOUNT. */
    const rawV = item_data ? item_data[field.field_key] : undefined;
    const v = (money.isMoney(rawV) ? String(rawV.amount) : rawV == null ? '' : String(rawV)).trim();
    if (field.required && !v) return field.field_name + ' is required';
    if (field.field_type === 'number' && v !== '' && !catcols.IDENT_KEYS.has(field.field_key)) {
      const n = Number(v);
      if (Number.isNaN(n)) return field.field_name + ' must be a number';
      if (n < 0) return field.field_name + ' cannot be negative';
      if (field.min_value != null && n < Number(field.min_value)) return field.field_name + ' must be at least ' + field.min_value;
    }
  }
  return null;
}

/**
 * ── ⭐⭐⭐ writeItems({ entity_id, items }) — THE WHOLE SEQUENCE, OR NOTHING ───────────────────────────────────
 *
 * opts.db (optional, move-in W1.6): the caller's connection — the insert runs on its transaction (the caller commits or rolls back), and NOTHING is
 * metered here: the caller calls meterItems(entity_id, rows) after its commit, so a rolled-back caller meters nothing.
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
  if (!items.every((item) => item && typeof item === 'object' && !Array.isArray(item)))
    return { ok: false, status: 400, error: 'validation', message: 'Every item must be an object.' };

  const schema_id = await defaultSchemaId(entity_id);
  const currency = await regional.currencyFor(entity_id);

  const ruleRows = await schemaFieldsOf(schema_id);
  const list = [];
  for (let i = 0; i < items.length; i++) {
    const verr = validateAgainst(ruleRows, items[i]);
    if (verr) list.push({ index: i, message: verr });
  }
  if (list.length) {
    return { ok: false, status: 400, error: 'Invalid product', message: list.length + ' item(s) were refused and nothing was written.', invalid: list };
  }

  const decl = await catcols.ensureDeclaredMany({
    query,
    entity_id,
    schema_id,
    items,
    ensureSchema: (e) => require('./schema-bootstrap').ensureDefaultSchema(e)
  });
  /* ⭐ C4: the declaration gate refuses a NEW item that carries a server-owned key (media/image) — the batch is refused whole,
     with the same shape as the validation refusal above */
  if (decl.invalid.length) {
    return {
      ok: false,
      status: 400,
      error: 'Invalid product',
      code: decl.invalid[0].code || undefined,
      message: decl.invalid.length + ' item(s) were refused and nothing was written.',
      invalid: decl.invalid
    };
  }
  const sid = decl.schema_id || schema_id;

  /* ⚠️ STAMP AFTER VALIDATION, on the raw shape, so the schema still saw the number a person typed */
  const stamped = decl.items.map((item) => JSON.stringify(money.stampItem(item, currency)));

  /* move-in W1.6 (2026-10-18): a caller that owns the transaction (opts.db — the move-in's withEntity handle) has the insert on IT, so a refusal later in
     that transaction rolls the products back with everything else; otherwise the insert opens its own, as before */
  const r = opts.db ? await insertStamped(opts.db, entity_id, sid, stamped) : await withEntity(entity_id, (db) => insertStamped(db, entity_id, sid, stamped));

  /* ⭐ metered after the write, best-effort, never blocking — but NOT inside a caller's transaction (opts.db): that caller meters after its commit
     (meterItems), so a rolled-back move-in meters nothing */
  if (!opts.db) meterItems(entity_id, r.rows);

  /* ⚠️ THE DECLARATION TRAVELS BACK. The bulk route reports which columns were newly declared and any
     warnings with them; dropping it in the extraction would have quietly emptied that half of the response.
     A refactor that loses a field is not invisible, which was the whole condition for doing it. */
  return { ok: true, rows: r.rows, schema_id: sid, declared: decl };
}

/** meterItems(entity_id, rows) — one catalogue.item meter per written row ({ item_id }), best-effort, never blocking. writeItems calls it after its own
 *  insert; a caller that passed opts.db calls it once its transaction has COMMITTED (routes/books.js POST /move-in/import) */
function meterItems(entity_id, rows) {
  try {
    const meter = require('./meter').meter;
    for (const row of rows || [])
      meter(entity_id, 'catalogue.item', { detail: row.item_id }).catch(log.orElse('catalogue-write writeItems: failed — carried on without it'));
  } catch (e) {
    log.fellBack('catalogue-write writeItems: the helper failed — carried on without it', e);
  }
}

/** the insert itself, on the caller's connection: rows already validated, declared and stamped (JSON text each) */
function insertStamped(db, entity_id, schema_id, stamped) {
  return db.query(
    `INSERT INTO catalogue_items (entity_id, schema_id, item_data)
     SELECT $1, $2, x FROM unnest($3::jsonb[]) AS x
     RETURNING *`,
    [entity_id, schema_id, stamped]
  );
}

/* the columns a caller may ask back — `c.` prefixed, because UPDATE … FROM unnest would otherwise return u's columns too */
function returningOf(cols) {
  if (!cols) return 'c.item_id';
  if (cols === '*') return 'c.*';
  const list = (Array.isArray(cols) ? cols : String(cols).split(',')).map((x) => String(x).trim()).filter(Boolean);
  if (!list.length || !list.every((x) => /^[a-z_]+$/.test(x))) throw new Error('patchItems: bad returning ' + cols);
  return list.map((x) => 'c.' + x).join(', ');
}

/**
 * ── ⭐⭐⭐ patchItems(db, entity_id, edits, opts) — THE ONE UPDATE OF A PRODUCT (CAT-W1, 14 Oct) ─────────────────
 *
 * 21 statements in eight files each wrote `UPDATE catalogue_items` their own way — some merged, some replaced, one
 * dropped the COALESCE. They all come through here now; tests/one-writer.test.cjs fails on a second writer.
 *
 * db       a connection: withEntity's client (or anything with .query). The caller owns the transaction.
 * edits    [{ item_id, merge }]   top-level jsonb merge (`||`) — merge-patch for flat product keys
 *          [{ item_id, replace }] the whole item_data (the caller already merged, validated and stamped it)
 *          [{ item_id, active }]  is_active (soft remove / restore); may ride with merge or replace
 *          or ONE change for many ids: { ids, merge | replace | active }
 * opts     { returning: '*' | 'item_id, item_data' | [cols] (default item_id), activeOnly: only rows still active }
 * → the pg result ({ rows, rowCount }) — ONE statement however many rows.
 *
 * ⚠️ the same id twice in one call is folded first (merges compose, a replace wins), because UPDATE … FROM updates a row
 * once with whichever input row it meets — "the last line of the sheet wins" is decided here, not by chance.
 * ⚠️ updated_at moves only when item_data does: a soft remove never touched it.
 */
async function patchItems(db, entity_id, edits, opts) {
  const o = opts || {};
  const text = edits && !Array.isArray(edits) ? edits : null;
  const list = text ? (text.ids || []).map((id) => ({ item_id: id, merge: text.merge, replace: text.replace, active: text.active })) : edits || [];
  const byId = new Map();
  for (const e of list) {
    if (!e || e.item_id == null) continue;
    const id = String(e.item_id);
    const prev = byId.get(id) || { mode: null, data: null, active: null };
    let next = Object.assign({}, prev);
    if (e.replace !== undefined) next = { mode: 'replace', data: e.replace, active: prev.active };
    else if (e.merge !== undefined) next = { mode: prev.mode || 'merge', data: Object.assign({}, prev.data, e.merge), active: prev.active };
    if (typeof e.active === 'boolean') next.active = e.active;
    byId.set(id, next);
  }
  if (!byId.size) return { rows: [], rowCount: 0 };
  const ids = [],
    datas = [],
    modes = [],
    actives = [];
  byId.forEach((item, id) => {
    ids.push(id);
    datas.push(item.mode ? JSON.stringify(item.data || {}) : null);
    modes.push(item.mode);
    actives.push(item.active);
  });
  return db.query(
    `UPDATE catalogue_items AS c
        SET item_data = CASE u.mode WHEN 'merge'   THEN COALESCE(c.item_data, '{}'::jsonb) || u.data::jsonb
                                    WHEN 'replace' THEN u.data::jsonb
                                    ELSE c.item_data END,
            is_active = COALESCE(u.active, c.is_active),
            updated_at = CASE WHEN u.mode IS NULL THEN c.updated_at ELSE NOW() END
       FROM unnest($1::uuid[], $2::text[], $3::text[], $4::boolean[]) AS u(id, data, mode, active)
      WHERE c.item_id = u.id AND c.entity_id = $5${o.activeOnly ? ' AND c.is_active = true' : ''}
    RETURNING ${returningOf(o.returning)}`,
    [ids, datas, modes, actives, entity_id]
  );
}

/**
 * patchWhere(db, match, merge) — the same merge for every product whose item_data[field] equals a value (a slab takeover,
 * a help desk refining its answer by qa_id). match { field, value, entity_id?, activeOnly?, activate? } → the pg result.
 * ⚠️ without entity_id the connection's RLS context is the only scope — call it inside withEntity.
 */
async function patchWhere(db, match, merge) {
  const m = match || {};
  if (!/^[a-z_]+$/.test(String(m.field || ''))) throw new Error('patchWhere: bad field ' + m.field);
  const args = [String(m.value), JSON.stringify(merge || {}), m.field];
  let where = `item_data->>$3 = $1`;
  if (m.entity_id) {
    args.push(m.entity_id);
    where = `entity_id = $4 AND ` + where;
  }
  if (m.activeOnly) where = `is_active = true AND ` + where;
  return db.query(
    `UPDATE catalogue_items SET item_data = COALESCE(item_data, '{}'::jsonb) || $2::jsonb,${m.activate ? ' is_active = true,' : ''} updated_at = NOW()
      WHERE ${where}`,
    args
  );
}

/**
 * ⭐ the codes a shop is already using, so a sequence can be allocated against fact rather than a counter.
 * ⚠️ BOTH SPELLINGS. The till reads `d.code || d.sku` and a spreadsheet may have supplied either, so a sequence
 * that looked at only one would hand out a code the other half of the catalogue already holds.
 */
async function codesInUse(entity_id) {
  const r = await withEntity(entity_id, (db) =>
    db.query(
      `SELECT COALESCE(item_data->>'code', item_data->>'sku') AS code
       FROM catalogue_items
      WHERE entity_id = $1 AND COALESCE(item_data->>'code', item_data->>'sku') IS NOT NULL`,
      [entity_id]
    )
  );
  return r.rows.map((x) => x.code).filter(Boolean);
}

/** how many sellable products the shop has — what "is this catalogue empty?" means */
async function countItems(entity_id) {
  const r = await withEntity(entity_id, (db) =>
    db.query(`SELECT COUNT(*)::int AS n FROM catalogue_items WHERE entity_id = $1 AND is_active IS NOT false`, [entity_id])
  );
  return (r.rows[0] && r.rows[0].n) || 0;
}

module.exports = { writeItems, meterItems, insertStamped, patchItems, patchWhere, codesInUse, countItems, defaultSchemaId, schemaFieldsOf, validateAgainst };
