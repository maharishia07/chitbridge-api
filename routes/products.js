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
    const entity_id = ctx(req);

    // The shop's own declared contract. Never from the request — a caller must not be able to ask for a band sheet
    // on a cart shop and then be refused at order time.
    let oi = orderInput.resolve(null);
    try {
      const f = await withEntity(entity_id, (db) => db.query(
        `SELECT face FROM catalogue_face WHERE entity_id = $1`, [entity_id]));
      const face = (f.rows[0] && f.rows[0].face) || {};
      oi = orderInput.resolve(face.order_input || (face.method ? { preset: face.method } : null));
    } catch (_) { /* no face declared yet → the cart default, which is what the shop behaves as */ }

    let schema = null;
    const sid = await defaultSchemaId(entity_id);
    if (sid) {
      const f = await query(
        `SELECT field_key FROM schema_fields WHERE schema_id=$1 ORDER BY display_order`, [sid]);
      schema = { properties: Object.fromEntries(f.rows.map((x) => [x.field_key, {}])) };
    }

    // What the catalogue ACTUALLY uses, not only what it registered. Found live: Gamma's items carry `code` and
    // `desc` with no active default schema, so a schema-only template would have asked for neither and a filled
    // sheet would have come back two columns short.
    const seen = await withEntity(entity_id, (db) => db.query(
      `SELECT item_data FROM catalogue_items WHERE entity_id=$1 AND is_active=true
       ORDER BY created_at DESC LIMIT 200`, [entity_id]));
    const observed = [];
    for (const row of seen.rows) {
      for (const k of Object.keys(row.item_data || {})) if (!observed.includes(k)) observed.push(k);
    }

    const t = csv.templateFor({ schema, orderInput: oi, observed });
    res.json({ ...t, preset: oi.preset, filename: `catalogue-template-${oi.preset}.csv` });
  } catch (e) { fail(res, e, 'Template failed'); }
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
