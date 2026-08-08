// routes/products.js — B3.7a Catalogue items (products) CRUD + search
const express = require('express');
const router  = express.Router();
const { safeErr } = require('../lib/respond');
const { body } = require('express-validator');
const { query, withEntity } = require('../db');
const { validate } = require('../middleware/validate');
const auth = require('../middleware/auth');
const money = require('../lib/money');          // a price is never a bare number — stamped on write
const availability = require('../lib/availability');   // a quantity is not an answer without a date
const regional = require('../lib/regional');    // the currency comes from the ENTITY, never from the request
const csv = require('../lib/csv');              // catalogue export — a merchant can leave the way they arrived
const orderInput = require('../lib/order-input'); // the shop's declared contract — the template is a projection of it
const preflight = require('../lib/csv-preflight'); // read an upload BEFORE it becomes data — proposes, never decides
const identity  = require('../lib/identity');       // which line is this, and which product does it belong to
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
/**
 * Read the rules ONCE. Athi, 2026-08-06: *"any of this implementation, if it is greater than O(1), is not required
 * — it will be very costly."*
 *
 * He is right and this was mine: the import loop called validateItem() per row, and validateItem read schema_fields
 * every time. A 2000-row upload fired 2000 identical queries for a rule set that cannot change mid-import.
 *
 * The fields are now fetched once and validated in memory, so validation is O(1) in round trips however many rows
 * arrive. `validateItem` keeps its old shape for the single-add and single-edit paths, where one query IS the
 * whole cost.
 */
async function schemaFieldsOf(schema_id) {
  if (!schema_id) return [];
  const f = await query(
    `SELECT field_key, field_name, field_type, required, min_value
     FROM schema_fields WHERE schema_id = $1`, [schema_id]);
  return f.rows;
}

async function validateItem(schema_id, item_data) {
  if (!schema_id) return null;
  return validateAgainst(await schemaFieldsOf(schema_id), item_data);
}

/** Pure: the same rules, against rows already in hand. No I/O. */
function validateAgainst(fieldRows, item_data) {
  const f = { rows: fieldRows || [] };
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
  const labels = {};     // field_key → the name the merchant sees, so their own column heading matches their own field
  const required = [];   // what the schema actually insists on — NOT 'everything that is not an optional extra'
  let oi = orderInput.resolve(null);
  let face0 = {};        // the whole declared face — order_input AND identity both come from it
  try {
    const f = await withEntity(entity_id, (db) => db.query(
      `SELECT face FROM catalogue_face WHERE entity_id = $1`, [entity_id]));
    face0 = (f.rows[0] && f.rows[0].face) || {};
    oi = orderInput.resolve(face0.order_input || (face0.method ? { preset: face0.method } : null));
  } catch (_) { /* no face declared → the cart default, which is how the shop behaves */ }

  let schema = null;
  const sid = await defaultSchemaId(entity_id);
  if (sid) {
    const f = await query(`SELECT field_key, field_name, required FROM schema_fields WHERE schema_id=$1 ORDER BY display_order`, [sid]);
    schema = { properties: Object.fromEntries(f.rows.map((x) => [x.field_key, {}])) };
    for (const x of f.rows) {
      if (x.field_name) labels[x.field_key] = x.field_name;
      // The SCHEMA decides what a file must carry. Inferring it from 'not optional' told a catalogue that declares
      // code and desc that every upload was incomplete without them.
      if (x.required && x.field_key !== 'quantity') required.push(x.field_key);
    }
  }
  const seen = await withEntity(entity_id, (db) => db.query(
    `SELECT item_data FROM catalogue_items WHERE entity_id=$1 AND is_active=true
     ORDER BY created_at DESC LIMIT 200`, [entity_id]));
  const observed = [];
  for (const row of seen.rows) {
    for (const k of Object.keys(row.item_data || {})) if (!observed.includes(k)) observed.push(k);
  }
  const ident = identity.resolve(face0);
  return { schema_id: sid, labels, identity: ident, identityProblems: identity.check(ident, Object.keys((schema && schema.properties) || {})), required: required.length ? required : ['name'], template: csv.templateFor({ schema, orderInput: oi, observed }), orderInput: oi };
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
    const { template, labels, required, identity: ident, identityProblems, orderInput: oi } = await catalogueShape(entity_id);
    const parsed = csv.parseCSV(text);
    // preflight() wants rows positionally, so a duplicate header cannot silently collapse into one key.
    const rows = parsed.rows.map((r) => parsed.headers.map((h) => r[h]));
    const report = preflight.preflight({ headers: parsed.headers, rows, template, labels, required, identity: ident });

    res.json({ report, accepted: template.columns, optional: template.optional, preset: oi.preset,
      identity: ident, identity_problems: identityProblems, dry_run: true });
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

    const { schema_id, template, labels, required, identity: ident } = await catalogueShape(entity_id);
    const parsed = csv.parseCSV(text);
    if (parsed.rows.length > IMPORT_MAX_ROWS) {
      return res.status(413).json({ error: 'Too many rows',
        message: `This file has ${parsed.rows.length} rows and one upload can carry ${IMPORT_MAX_ROWS}. Nothing was imported — split the file and it will all go in.` });
    }
    const rows = parsed.rows.map((r) => parsed.headers.map((h) => r[h]));
    const report = preflight.preflight({ headers: parsed.headers, rows, template, labels, required, identity: ident });
    const rowErrors = report.issues.filter((i) => i.severity === 'error');
    if (rowErrors.length) {
      return res.status(409).json({ error: 'The file has problems', report,
        message: `${rowErrors.length} row problem(s) must be fixed first. Nothing was imported.` });
    }

    const applied = preflight.applyDecisions({ headers: parsed.headers, rows, template, labels, identity: ident, decisions: req.body.decisions });
    if (applied.errors.length) {
      return res.status(400).json({ error: 'Those choices do not hold up', messages: applied.errors,
        message: applied.errors[0] + ' Nothing was imported.' });
    }
    if (!applied.items.length) {
      return res.status(400).json({ error: 'Nothing to import',
        message: 'No row had a product name once your choices were applied, so there was nothing to create.' });
    }

    const currency = await regional.currencyFor(entity_id);
    // O(1): the rules are read once for the whole file, not once per row.
    let ruleRows = await schemaFieldsOf(schema_id);

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

    // REGISTER WHAT WE ACCEPT, so a column's position becomes a stored fact.
    //
    // Athi, 2026-08-06: *"we have to maintain the order of the column, so always the column comes the same way — we
    // cannot keep changing the column position."*
    //
    // Right, and sorting is not enough on its own. A field IN the schema has a display_order, so its position is
    // permanent. A column that only exists because some item happens to carry it has no position at all, so it can
    // only ever be ordered by a rule — and any rule that is not "where you put it" will one day move something.
    //
    // So anything a person deliberately MAPPED becomes a declared field, appended at the end in exactly the order
    // it already appears. Nothing moves at the moment of registration; from then on nothing can move at all.
    // Additive and optional, like every other extension: this records what the catalogue already accepts, it does
    // not change what it demands.
    if (sid) {
      const hv = await query(`SELECT field_key FROM schema_fields WHERE schema_id=$1`, [sid]);
      const known = new Set(hv.rows.map((r) => r.field_key));
      // The order the template renders them in — so registering changes nothing a merchant can see, today.
      const inOrder = template.columns.filter((c) => applied.mappedFields.includes(c) && !known.has(c)
        && !preflight.BLOCKED[c] && c !== 'quantity');
      if (inOrder.length) {
        const o2 = await query(`SELECT COALESCE(MAX(display_order),0) AS m FROM schema_fields WHERE schema_id=$1`, [sid]);
        let n2 = Number(o2.rows[0].m) || 0;
        for (const key of inOrder) {
          const type = preflight.NUMERIC_FIELDS.includes(key) ? 'number' : 'text';
          await query(
            `INSERT INTO schema_fields (schema_id, field_name, field_key, field_type, required, display_order)
             VALUES ($1,$2,$3,$4,false,$5)`,
            [sid, labels[key] || key, key, type, ++n2]);
          created.push(key);
        }
      }
    }

    // New columns were just added, so the rule set changed exactly once. Re-read it once — still O(1).
    if (created.length) ruleRows = await schemaFieldsOf(sid);

    // Then the products. Match on the DECLARED identity where the file carries one: a second upload of the same
    // sheet should correct the catalogue, not double it.
    //
    // `sku` was hardcoded here, which was an assumption rather than a rule — pharma identifies a lot by `batch_no`
    // and a commodity desk may need `hs_code + origin_country`. identity.resolve() falls back to ['sku'], so a
    // catalogue that has declared nothing behaves exactly as it did.
    const existing = await withEntity(entity_id, (db) => db.query(
      `SELECT item_id, item_data FROM catalogue_items WHERE entity_id=$1 AND is_active=true`, [entity_id]));
    const byIdentity = new Map();
    for (const r of existing.rows) {
      const k = identity.identityOf(r.item_data || {}, ident);
      if (k) byIdentity.set(k, r);
    }
    const idLabel = ident.key.join(' + ');

    const outcome = [];
    for (let i = 0; i < applied.items.length; i++) {
      const item = applied.items[i], line = applied.lines[i];
      const ikey = identity.identityOf(item, ident);       // null when the row carries only PART of the key
      const sku = ikey || '';
      const prior = ikey ? byIdentity.get(ikey) : null;
      try {
        // A row with a code but no name is an UPDATE to something that already exists. If nothing matches, there is
        // no product to patch and not enough to create one — say which, rather than "nothing to import".
        if (!prior && !String(item.name || '').trim()) {
          outcome.push({ line, sku, action: 'failed',
            message: ikey ? `no product here has ${idLabel} "${ikey}", and there is no name to create one with`
                         : `this row has neither a name nor a complete ${idLabel} ` });
          continue;
        }
        const merged = prior ? Object.assign({}, prior.item_data, item) : item;   // an update is a patch, not a wipe

        // A UNIT change on an existing product silently rewrites what its price means: 150/litre and 150/tonne are
        // not the same offer. Merchants do repack, so this is not refused — but it is never left unsaid.
        let warning = null;
        if (prior && item.unit && prior.item_data.unit && item.unit !== prior.item_data.unit) {
          warning = `unit changed ${prior.item_data.unit} → ${item.unit}; the price now means something different`;
        }
        // The SAME validation the single-add form runs. Without this a bulk upload could create products that
        // typing them in one at a time would have refused — the rules would depend on how you arrived, which is
        // not a rule at all.
        const verr = validateAgainst(ruleRows, merged);
        if (verr) { outcome.push({ line, sku, action: 'failed', name: item.name, message: verr }); continue; }
        const stamped = money.stampItem(merged, currency);
        if (prior) {
          await withEntity(entity_id, (db) => db.query(
            `UPDATE catalogue_items SET item_data=$1, updated_at=NOW() WHERE item_id=$2 AND entity_id=$3`,
            [JSON.stringify(stamped), prior.item_id, entity_id]));
          outcome.push({ line, sku, action: 'updated', name: item.name || prior.item_data.name, warning });
        } else {
          await withEntity(entity_id, (db) => db.query(
            `INSERT INTO catalogue_items (entity_id, schema_id, item_data) VALUES ($1,$2,$3)`,
            [entity_id, sid, JSON.stringify(stamped)]));
          outcome.push({ line, sku, action: 'created', name: item.name, warning });
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

/**
 * PUT /api/products/:id/availability   { qty, source?, as_of? }
 *
 * What this store HAS of this item, and when that was last true.
 *
 * ── WHY THIS IS NOT `PATCH /:id` WITH A FIELD ───────────────────────────────────────────────────────────────
 * Availability is not a catalogue field. A catalogue field describes the PRODUCT and is validated against the
 * schema; this describes the SHELF, changes on its own timetable, and is written by a connector far more often
 * than by a person. Putting it through validateItem would mean a stock update could be refused because an
 * unrelated required column was blank — a feed failing for a reason that has nothing to do with the feed.
 *
 * It is written into `item_data.avail`, so it lives with the item, inherits the item's per-entity RLS, and needs
 * no new table. Only the owner can write it: the UPDATE is scoped to entity_id, so there is no window between
 * checking and writing.
 */
router.put('/:id/availability', auth,
  [ body('qty').exists(), body('source').optional().isString(), body('as_of').optional().isString() ],
  validate,
  async (req, res) => {
    try {
      const entity_id = ctx(req);
      const rec = availability.stamp(req.body);
      if (!rec) {
        return res.status(400).json({ error: 'Bad quantity',
          message: 'A quantity must be zero or more. A negative figure means the feed is wrong, and storing it '
                 + 'would make a full shelf look empty.' });
      }
      const r = await withEntity(entity_id, (db) => db.query(
        `UPDATE catalogue_items
            SET item_data = COALESCE(item_data, '{}'::jsonb) || jsonb_build_object('avail', $1::jsonb),
                updated_at = NOW()
          WHERE item_id = $2 AND entity_id = $3
        RETURNING item_id, item_data`,
        [JSON.stringify(rec), req.params.id, entity_id]));
      if (!r.rows.length) return res.status(404).json({ error: 'Not found', message: 'No such item in your catalogue.' });
      res.json({ message: 'Availability updated', availability: rec });
    } catch (e) { fail(res, e, 'Availability update failed'); }
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
