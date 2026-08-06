// routes/products.js — B3.7a Catalogue items (products) CRUD + search
const express = require('express');
const router  = express.Router();
const { safeErr } = require('../lib/respond');
const { body } = require('express-validator');
const { query, withEntity } = require('../db');
const { validate } = require('../middleware/validate');
const auth = require('../middleware/auth');
const money = require('../lib/money');          // a price is never a bare number — stamped on write
const regional = require('../lib/regional');    // the currency comes from the ENTITY, never from the request
const csv = require('../lib/csv');              // catalogue export — a merchant can leave the way they arrived
const orderInput = require('../lib/order-input'); // the shop's declared contract — the template is a projection of it
const preflight = require('../lib/csv-preflight'); // read an upload BEFORE it becomes data — proposes, never decides
const starter   = require('../lib/starter-fields'); // the standard column set for a trade — an empty catalogue is not a blank page

/**
 * A DELIBERATE refusal must not be reported as an internal failure.
 *
 * Found live: the currency-mismatch guard fired correctly — nothing was stored — but the caller got
 * `500 "Something went wrong — please try again."` because the catch blocks discarded `e.status`. Retrying would
 * never have helped, and the one message that would have explained the problem ("this catalogue is priced in INR")
 * was thrown away. A guard that refuses for a good reason and reports a bad one teaches the user nothing.
 *
 * Deliberate 4xx keeps its status and its message; anything else stays a sanitised 500.
 */
function fail(res, e, label) {
  if (e && e.status && e.status >= 400 && e.status < 500) {
    return res.status(e.status).json({ error: label, message: e.message });
  }
  return res.status(500).json({ error: label, message: safeErr(e) });
}
const ctx = (req) => req.identity.parent_entity_id || req.identity.identity_id;

async function defaultSchemaId(entity_id) {
  const r = await query(
    `SELECT schema_id FROM entity_schemas
     WHERE entity_id = $1 AND status='active' AND is_default=true LIMIT 1`, [entity_id]);
  return r.rows[0]?.schema_id || null;
}

// Validate a product against its schema fields. Returns an error message, or null if valid.
// Rules: required fields not empty · number fields numeric, not negative, respect min_value.
// `quantity` is excluded — the customer sets it at order time.
async function validateItem(schema_id, item_data) {
  if (!schema_id) return null;
  const f = await query(
    `SELECT field_key, field_name, field_type, required, min_value
     FROM schema_fields WHERE schema_id = $1`, [schema_id]);
  for (const field of f.rows) {
    if (field.field_key === 'quantity') continue;
    // A stamped price is `{amount, currency}`, and String() on that is "[object Object]" → NaN → "must be a number".
    // Found in production, not in tests: it rejected a legitimate ROUND-TRIP EDIT (read an item, change the name,
    // write it back) and it also swallowed the currency-mismatch case before money.stampPrice could refuse it
    // properly — so the spoof was blocked by accident of ordering rather than by the guard built for it.
    // Validate a money value on its AMOUNT; the currency is checked at stamping, where it belongs.
    const rawV = item_data?.[field.field_key];
    const v = (money.isMoney(rawV) ? String(rawV.amount) : (rawV == null ? '' : String(rawV))).trim();
    if (field.required && !v) return `${field.field_name} is required`;
    if (field.field_type === 'number' && v !== '') {
      const n = Number(v);
      if (Number.isNaN(n))            return `${field.field_name} must be a number`;
      if (n < 0)                      return `${field.field_name} cannot be negative`;
      if (field.min_value != null && n < Number(field.min_value))
                                      return `${field.field_name} must be at least ${field.min_value}`;
    }
  }
  return null;
}

/** The accepted format + the shop's contract, built once so preflight, import and template cannot disagree. */
async function catalogueShape(entity_id) {
  const labels = {};   // field_key → the name the merchant sees, so their own column heading matches their own field
  let oi = orderInput.resolve(null);
  try {
    const f = await withEntity(entity_id, (db) => db.query(
      `SELECT face FROM catalogue_face WHERE entity_id = $1`, [entity_id]));
    const face = (f.rows[0] && f.rows[0].face) || {};
    oi = orderInput.resolve(face.order_input || (face.method ? { preset: face.method } : null));
  } catch (_) { /* no face declared → the cart default, which is how the shop behaves */ }

  let schema = null;
  const sid = await defaultSchemaId(entity_id);
  if (sid) {
    const f = await query(`SELECT field_key, field_name FROM schema_fields WHERE schema_id=$1 ORDER BY display_order`, [sid]);
    schema = { properties: Object.fromEntries(f.rows.map((x) => [x.field_key, {}])) };
    for (const x of f.rows) if (x.field_name) labels[x.field_key] = x.field_name;
  }
  const seen = await withEntity(entity_id, (db) => db.query(
    `SELECT item_data FROM catalogue_items WHERE entity_id=$1 AND is_active=true
     ORDER BY created_at DESC LIMIT 200`, [entity_id]));
  const observed = [];
  for (const row of seen.rows) {
    for (const k of Object.keys(row.item_data || {})) if (!observed.includes(k)) observed.push(k);
  }
  return { schema_id: sid, labels, template: csv.templateFor({ schema, orderInput: oi, observed }), orderInput: oi };
}

// CREATE — add a product
router.post('/', auth, [ body('item_data').isObject() ], validate, async (req, res) => {
  try {
    const entity_id = ctx(req);
    const schema_id = await defaultSchemaId(entity_id);
    const verr = await validateItem(schema_id, req.body.item_data);
    if (verr) return res.status(400).json({ error: 'Invalid product', message: verr });
    // STAMP: the price acquires the OWNING ENTITY's currency here and nowhere else. Validation runs first, on the
    // raw shape, so the schema still sees the number a person typed.
    const item_data = money.stampItem(req.body.item_data, await regional.currencyFor(entity_id));
    const r = await withEntity(entity_id, (db) => db.query(
      `INSERT INTO catalogue_items (entity_id, schema_id, item_data)
       VALUES ($1,$2,$3) RETURNING *`,
      [entity_id, schema_id, JSON.stringify(item_data)]));
    res.json({ message: 'Product added', item: r.rows[0] });
  } catch (e) { fail(res, e, 'Add failed'); }
});

// READ + SEARCH — list my products, optional ?q=
router.get('/', auth, async (req, res) => {
  try {
    const entity_id = ctx(req);
    const q = (req.query.q || '').trim();
    const r = await withEntity(entity_id, (db) => q
      ? db.query(
          `SELECT * FROM catalogue_items
           WHERE entity_id=$1 AND is_active=true AND item_data::text ILIKE $2
           ORDER BY created_at DESC`, [entity_id, `%${q}%`])
      : db.query(
          `SELECT * FROM catalogue_items
           WHERE entity_id=$1 AND is_active=true
           ORDER BY created_at DESC`, [entity_id]));
    res.json({ items: r.rows, count: r.rows.length });
  } catch (e) { res.status(500).json({ error: 'List failed', message: safeErr(e) }); }
});

// EXPORT — the whole catalogue as CSV. "A merchant can leave" is the same argument that justified the Medusa
// mapper; import already existed and export did not, so the round trip was one-way. That is lock-in whether or not
// anyone intended it.
//
// A GET returning a file, so it works from a browser link, curl, or a spreadsheet's "import from URL" — no client
// code required to be useful.
router.get('/export.csv', auth, async (req, res) => {
  try {
    const entity_id = ctx(req);
    const r = await withEntity(entity_id, (db) => db.query(
      `SELECT item_data FROM catalogue_items
       WHERE entity_id=$1 AND is_active=true ORDER BY created_at DESC`, [entity_id]));
    const items = r.rows.map((x) => x.item_data || {});

    // The schema orders the columns where it can; anything an item carries beyond it is still exported, because a
    // column dropped here is data lost on the way back in.
    let schema = null;
    try {
      const sid = await defaultSchemaId(entity_id);
      if (sid) {
        const f = await query(`SELECT field_key FROM schema_fields WHERE schema_id=$1 ORDER BY display_order`, [sid]);
        schema = { properties: Object.fromEntries(f.rows.map((x) => [x.field_key, {}])) };
      }
    } catch (_) { /* no schema is fine — columns then come from the items themselves */ }

    const body = csv.toCSV(items, { schema });
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="catalogue-${stamp}.csv"`);
    // Excel assumes the system codepage without this and mangles every non-ASCII product name.
    res.send('﻿' + body);
  } catch (e) { fail(res, e, 'Export failed'); }
});

/**
 * TEMPLATE — the blank upload sheet for THIS catalogue.
 *
 * Athi, 2026-08-06: *"each entity will have its own catalogue style and accepted format, so the template can be
 * downloaded and the same format uploaded — that makes the system stable."*
 *
 * The header row is a PROJECTION OF THE DECLARATION, so there is no template file anywhere that can drift out of
 * step with the schema. A cart catalogue is asked for `price`; a range catalogue for `price_min`/`price_max`; a
 * payload catalogue for no price at all.
 *
 * Returns JSON rather than the file directly, because the guidance cannot live inside the CSV — a comment row would
 * be parsed as a product. The client writes `csv` to a file and shows `notes` beside it.
 */
router.get('/template', auth, async (req, res) => {
  try {
    const { template, orderInput: oi } = await catalogueShape(ctx(req));
    res.json({ ...template, preset: oi.preset, filename: `catalogue-template-${oi.preset}.csv` });
  } catch (e) { fail(res, e, 'Template failed'); }
});

/**
 * PREFLIGHT — read an uploaded file BEFORE any of it becomes data.
 *
 * Athi, 2026-08-06: *"what if the columns are different, or named differently? do we have a parser before uploading
 * and providing any suggestion?"*
 *
 * ⚠️ THIS ROUTE WRITES NOTHING. It reads the catalogue only to work out the accepted format, and returns a report:
 * which incoming column maps to which field, what was matched only by similarity and needs confirming, what is
 * blocked, what is unrecognised, and which rows would fail and why. The commit half is deliberately NOT built —
 * bulk-writing someone's catalogue from a guessed mapping is exactly the destructive step that needs a spec and a
 * human gate, and the report is useful on its own.
 *
 * `ready:false` means a person still has to look. It is never a soft warning the client may skip past.
 */
router.post('/import/preflight', auth, [ body('csv').isString() ], validate, async (req, res) => {
  try {
    const entity_id = ctx(req);
    const text = String(req.body.csv || '');
    if (!text.trim()) return res.status(400).json({ error: 'Nothing to read', message: 'The file is empty.' });

    // The accepted format, built by the SAME function the download template uses — one definition, so a merchant
    // who fills our own sheet can never be told a column is unrecognised.
    const { template, labels, orderInput: oi } = await catalogueShape(entity_id);
    const parsed = csv.parseCSV(text);
    // preflight() wants rows positionally, so a duplicate header cannot silently collapse into one key.
    const rows = parsed.rows.map((r) => parsed.headers.map((h) => r[h]));
    const report = preflight.preflight({ headers: parsed.headers, rows, template, labels });

    res.json({ report, accepted: template.columns, optional: template.optional, preset: oi.preset, dry_run: true });
  } catch (e) { fail(res, e, 'Could not read the file'); }
});

/** How many rows one upload may carry. Stated, and reported when it bites — never a silent truncation. */
const IMPORT_MAX_ROWS = 2000;

/**
 * IMPORT — the commit half, with a decision required for every column.
 *
 * Body: { csv, decisions:[{incoming, action:'map'|'create'|'ignore', field}], confirm:true }
 *
 * ⚠️ WHAT THIS WILL NOT DO, BY CONSTRUCTION:
 *   · It never deletes. A product missing from the file is left exactly as it is — this is an import, not a sync.
 *     "Replace my catalogue with this file" is a different, destructive act and is not built.
 *   · It never changes an existing field's name, type or requiredness. New fields are created OPTIONAL, because a
 *     newly-required column would retroactively invalidate every product already stored.
 *   · It never acts on the preflight's own suggestions. A column with no decision is ignored.
 *   · It refuses outright while the file still has row errors, rather than importing "the good ones" and leaving a
 *     person to work out which lines are missing.
 *
 * It re-runs the preflight server-side. The client's report is a display artifact and is never trusted.
 */
router.post('/import', auth, [ body('csv').isString(), body('decisions').isArray() ], validate, async (req, res) => {
  try {
    const entity_id = ctx(req);
    if (req.body.confirm !== true) {
      return res.status(400).json({ error: 'Not confirmed', message: 'Nothing was imported — this needs an explicit confirmation.' });
    }
    const text = String(req.body.csv || '');
    if (!text.trim()) return res.status(400).json({ error: 'Nothing to import', message: 'The file is empty.' });

    const { schema_id, template, labels } = await catalogueShape(entity_id);
    const parsed = csv.parseCSV(text);
    if (parsed.rows.length > IMPORT_MAX_ROWS) {
      return res.status(413).json({ error: 'Too many rows',
        message: `This file has ${parsed.rows.length} rows and one upload can carry ${IMPORT_MAX_ROWS}. Nothing was imported — split the file and it will all go in.` });
    }
    const rows = parsed.rows.map((r) => parsed.headers.map((h) => r[h]));
    const report = preflight.preflight({ headers: parsed.headers, rows, template, labels });
    const rowErrors = report.issues.filter((i) => i.severity === 'error');
    if (rowErrors.length) {
      return res.status(409).json({ error: 'The file has problems', report,
        message: `${rowErrors.length} row problem(s) must be fixed first. Nothing was imported.` });
    }

    const applied = preflight.applyDecisions({ headers: parsed.headers, rows, template, labels, decisions: req.body.decisions });
    if (applied.errors.length) {
      return res.status(400).json({ error: 'Those choices do not hold up', messages: applied.errors,
        message: applied.errors[0] + ' Nothing was imported.' });
    }
    if (!applied.items.length) {
      return res.status(400).json({ error: 'Nothing to import',
        message: 'No row had a product name once your choices were applied, so there was nothing to create.' });
    }

    const currency = await regional.currencyFor(entity_id);

    // EXTEND THE DECLARATION FIRST. The new columns have to exist before the products that use them, and doing it
    // in this order means a failure here leaves nothing half-imported.
    let sid = schema_id;
    const created = [];
    if (applied.newFields.length) {
      if (!sid) {
        const boot = await require('../lib/schema-bootstrap').ensureDefaultSchema(entity_id);
        sid = boot.schema_id || null;
      }
      if (!sid) return res.status(500).json({ error: 'No catalogue definition', message: 'Your catalogue has no definition to add columns to.' });
      const ord = await query(`SELECT COALESCE(MAX(display_order),0) AS m FROM schema_fields WHERE schema_id=$1`, [sid]);
      let n = Number(ord.rows[0].m) || 0;
      for (const f of applied.newFields) {
        // A concurrent import could be adding the same column; the guard is a re-check, not a race-free claim.
        const dup = await query(`SELECT 1 FROM schema_fields WHERE schema_id=$1 AND field_key=$2`, [sid, f.field_key]);
        if (dup.rows.length) continue;
        await query(
          `INSERT INTO schema_fields (schema_id, field_name, field_key, field_type, required, display_order)
           VALUES ($1,$2,$3,$4,false,$5)`, [sid, f.field_name, f.field_key, f.field_type, ++n]);
        created.push(f.field_key);
      }
    }

    // Then the products. Match on SKU where the file carries one: a second upload of the same sheet should correct
    // the catalogue, not double it.
    const existing = await withEntity(entity_id, (db) => db.query(
      `SELECT item_id, item_data FROM catalogue_items WHERE entity_id=$1 AND is_active=true`, [entity_id]));
    const bySku = new Map();
    for (const r of existing.rows) {
      const s = String((r.item_data || {}).sku || '').trim();
      if (s) bySku.set(s, r);
    }

    const outcome = [];
    for (let i = 0; i < applied.items.length; i++) {
      const item = applied.items[i], line = applied.lines[i];
      const sku = String(item.sku || '').trim();
      const prior = sku ? bySku.get(sku) : null;
      try {
        const merged = prior ? Object.assign({}, prior.item_data, item) : item;   // an update is a patch, not a wipe
        // The SAME validation the single-add form runs. Without this a bulk upload could create products that
        // typing them in one at a time would have refused — the rules would depend on how you arrived, which is
        // not a rule at all.
        const verr = await validateItem(sid, merged);
        if (verr) { outcome.push({ line, sku, action: 'failed', name: item.name, message: verr }); continue; }
        const stamped = money.stampItem(merged, currency);
        if (prior) {
          await withEntity(entity_id, (db) => db.query(
            `UPDATE catalogue_items SET item_data=$1, updated_at=NOW() WHERE item_id=$2 AND entity_id=$3`,
            [JSON.stringify(stamped), prior.item_id, entity_id]));
          outcome.push({ line, sku, action: 'updated', name: item.name });
        } else {
          await withEntity(entity_id, (db) => db.query(
            `INSERT INTO catalogue_items (entity_id, schema_id, item_data) VALUES ($1,$2,$3)`,
            [entity_id, sid, JSON.stringify(stamped)]));
          outcome.push({ line, sku, action: 'created', name: item.name });
        }
      } catch (e) {
        outcome.push({ line, sku, action: 'failed', name: item.name, message: e.message });
      }
    }

    const failed = outcome.filter((o) => o.action === 'failed');
    res.json({
      message: `${outcome.filter((o) => o.action === 'created').length} added, ${outcome.filter((o) => o.action === 'updated').length} updated`
        + (failed.length ? `, ${failed.length} failed` : '')
        + (created.length ? ` · added ${created.length} new column(s) to your catalogue` : ''),
      created_columns: created, outcome,
      summary: { created: outcome.filter((o) => o.action === 'created').length,
        updated: outcome.filter((o) => o.action === 'updated').length, failed: failed.length },
    });
  } catch (e) { fail(res, e, 'Import failed'); }
});

/**
 * STARTER COLUMNS — the standard set for a trade, so an empty catalogue is not a blank page.
 *
 * GET  → the list to pick from.  POST {vertical} → adopt it, adding whatever the schema does not already have.
 * Adoption is ADDITIVE: it never removes or retypes a column the entity already uses.
 */
router.get('/starter-columns', auth, async (req, res) => {
  try {
    const v = req.query.vertical;
    res.json(v ? { starter: starter.starterFor(v), verticals: starter.list() } : { verticals: starter.list() });
  } catch (e) { fail(res, e, 'Could not list the standard sets'); }
});

router.post('/starter-columns', auth, [ body('vertical').isString() ], validate, async (req, res) => {
  try {
    const entity_id = ctx(req);
    const set = starter.starterFor(req.body.vertical);
    if (!set.vertical) return res.status(400).json({ error: 'Unknown trade', message: 'That is not one of the standard sets.' });

    let sid = await defaultSchemaId(entity_id);
    if (!sid) {
      const boot = await require('../lib/schema-bootstrap').ensureDefaultSchema(entity_id);
      sid = boot.schema_id || null;
    }
    if (!sid) return res.status(500).json({ error: 'No catalogue definition', message: 'Your catalogue has no definition to add columns to.' });

    const have = await query(`SELECT field_key, COALESCE(MAX(display_order),0) OVER () AS m FROM schema_fields WHERE schema_id=$1`, [sid]);
    const keys = new Set(have.rows.map((r) => r.field_key));
    let n = have.rows.length ? Number(have.rows[0].m) || 0 : 0;
    const added = [];
    for (const f of set.fields) {
      if (keys.has(f.field_key)) continue;                 // additive only — never retype what is already in use
      await query(
        `INSERT INTO schema_fields (schema_id, field_name, field_key, field_type, required, display_order)
         VALUES ($1,$2,$3,$4,false,$5)`, [sid, f.field_name, f.field_key, f.field_type, ++n]);
      added.push(f.field_key);
    }
    res.json({ message: added.length ? `Added ${added.length} column(s) from the ${set.title} set` : 'Your catalogue already has all of those columns',
      vertical: set.vertical, added, unchanged: set.fields.filter((f) => keys.has(f.field_key)).map((f) => f.field_key) });
  } catch (e) { fail(res, e, 'Could not adopt the standard set'); }
});

// UPDATE — edit a product
router.patch('/:id', auth, [ body('item_data').isObject() ], validate, async (req, res) => {
  try {
    const entity_id = ctx(req);
    const verr = await validateItem(await defaultSchemaId(entity_id), req.body.item_data);
    if (verr) return res.status(400).json({ error: 'Invalid product', message: verr });
    // STAMP on edit too — a round-trip that read `{amount,currency}` and writes it back is accepted only while the
    // currency still agrees with the entity's; a different one is refused (see money.stampPrice).
    const item_data = money.stampItem(req.body.item_data, await regional.currencyFor(entity_id));
    const r = await withEntity(entity_id, (db) => db.query(
      `UPDATE catalogue_items SET item_data=$1, updated_at=NOW()
       WHERE item_id=$2 AND entity_id=$3 RETURNING *`,
      [JSON.stringify(item_data), req.params.id, entity_id]));
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json({ message: 'Product updated', item: r.rows[0] });
  } catch (e) { fail(res, e, 'Update failed'); }
});

// DELETE — soft remove
router.delete('/:id', auth, async (req, res) => {
  try {
    const entity_id = ctx(req);
    const r = await withEntity(entity_id, (db) => db.query(
      `UPDATE catalogue_items SET is_active=false
       WHERE item_id=$1 AND entity_id=$2 RETURNING item_id`,
      [req.params.id, entity_id]));
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json({ message: 'Product removed' });
  } catch (e) { res.status(500).json({ error: 'Delete failed', message: safeErr(e) }); }
});

module.exports = router;
