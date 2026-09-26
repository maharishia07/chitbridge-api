// routes/combo-templates.js — [OFFR-06] saved, reusable combo/modifier group sets — b266.
//
// Athi, testing the Modifier Lab: "the example shown is very pathetic... what i want is something similar
// to the combo offer in a popup window with possibly combination, and also with save as option, if we are
// doing save as feature then we should be having a mechanism of open the same again."
//
// A template holds the SAME shape CBVariant (lib/variant.js) already owns and validates — an array of
// `{name, required, max, options:[{name, price}]}` groups. This route never re-validates that shape itself;
// the client runs it through CBVariant.validate() before ever offering "Save as", exactly as it already does
// before Apply. This route's only job is CRUD, scoped to the caller's own entity.
'use strict';
const express = require('express');
const router = express.Router();
const { safeErr } = require('../lib/respond');
const { body } = require('express-validator');
const { withEntity } = require('../db');
const { validate } = require('../middleware/validate');
const auth = require('../middleware/auth');

function fail(res, e, label) {
  if (e && e.status && e.status >= 400 && e.status < 500) {
    return res.status(e.status).json({ error: label, message: e.message });
  }
  return res.status(500).json({ error: label, message: safeErr(e) });
}
const ctx = (req) => auth.entityOf(req);

/** ⚠️ a name is the whole point of "save as" — an unnamed row is a row nobody can find again to reopen */
function badName(name) {
  const n = String(name || '').trim();
  if (!n) return 'A name is required — this is what you will look for when you come back to reuse it.';
  if (n.length > 120) return 'That name is too long — keep it under 120 characters.';
  return null;
}
/** ⚠️ the ONE shape check this route makes — not what variant.js already validates, just "is this an array
 *  of plausible groups at all", so a malformed body cannot wedge a row nothing can ever read back. */
function badDefinition(def) {
  if (!Array.isArray(def) || !def.length) return 'A combo needs at least one group to be worth saving.';
  for (const g of def) {
    if (!g || typeof g !== 'object' || !String(g.name || '').trim()) return 'Every group needs a name before it can be saved.';
    if (!Array.isArray(g.options) || !g.options.length) return `"${g.name}" has no options yet — add one before saving.`;
  }
  return null;
}

/** ⚠️ a price is not required to SAVE a combo (a draft, or a per-product template, may not have one of its
 *  own yet) — only to PUSH a NEW product from it (see /:id/push below). null/undefined both mean "none yet". */
function badPrice(price) {
  if (price === undefined || price === null || price === '') return null;
  const n = Number(price);
  if (!Number.isFinite(n) || n < 0) return 'Price must be a number, and cannot be negative.';
  return null;
}
const COLS = 'id, name, definition, price, product_item_id, created_at, updated_at';

// GET /api/combo-templates — the library, newest first
router.get('/', auth, async (req, res) => {
  try {
    const entity_id = ctx(req);
    const r = await withEntity(entity_id, (db) => db.query(
      `SELECT ${COLS} FROM combo_templates
       WHERE entity_id=$1 ORDER BY created_at DESC LIMIT 200`, [entity_id]));
    res.json({ templates: r.rows });
  } catch (e) { fail(res, e, 'Could not read your saved combos'); }
});

// POST /api/combo-templates  { name, definition, price? }  — "Save as"
router.post('/', auth, [ body('name').isString(), body('definition').isArray() ], validate, async (req, res) => {
  try {
    const entity_id = ctx(req);
    const nameErr = badName(req.body.name);
    if (nameErr) return res.status(400).json({ error: 'Invalid name', message: nameErr });
    const defErr = badDefinition(req.body.definition);
    if (defErr) return res.status(400).json({ error: 'Invalid combo', message: defErr });
    const priceErr = badPrice(req.body.price);
    if (priceErr) return res.status(400).json({ error: 'Invalid price', message: priceErr });
    const price = (req.body.price === undefined || req.body.price === null || req.body.price === '') ? null : Number(req.body.price);
    const r = await withEntity(entity_id, (db) => db.query(
      `INSERT INTO combo_templates (entity_id, name, definition, price) VALUES ($1,$2,$3,$4)
       RETURNING ${COLS}`,
      [entity_id, String(req.body.name).trim(), JSON.stringify(req.body.definition), price]));
    res.json({ message: 'Saved', template: r.rows[0] });
  } catch (e) { fail(res, e, 'Could not save this combo') }
});

// PATCH /api/combo-templates/:id  { name?, definition?, price?, product_item_id? } — rename, replace what it
// holds, or link it to a product that already exists (see modLabAdoptExisting() in offer-lab-next.html —
// "bring an already-live combo into this library" without pushing a duplicate product for it).
router.patch('/:id', auth, [ body('name').optional().isString(), body('definition').optional().isArray() ], validate, async (req, res) => {
  try {
    const entity_id = ctx(req);
    if ('name' in req.body) {
      const nameErr = badName(req.body.name);
      if (nameErr) return res.status(400).json({ error: 'Invalid name', message: nameErr });
    }
    if ('definition' in req.body) {
      const defErr = badDefinition(req.body.definition);
      if (defErr) return res.status(400).json({ error: 'Invalid combo', message: defErr });
    }
    if ('price' in req.body) {
      const priceErr = badPrice(req.body.price);
      if (priceErr) return res.status(400).json({ error: 'Invalid price', message: priceErr });
    }
    const cur = await withEntity(entity_id, (db) => db.query(
      `SELECT name, definition, price, product_item_id FROM combo_templates WHERE id=$1 AND entity_id=$2`, [req.params.id, entity_id]));
    if (!cur.rows.length) return res.status(404).json({ error: 'Not found' });
    const name = 'name' in req.body ? String(req.body.name).trim() : cur.rows[0].name;
    const definition = 'definition' in req.body ? req.body.definition : cur.rows[0].definition;
    const price = 'price' in req.body
      ? ((req.body.price === null || req.body.price === '') ? null : Number(req.body.price))
      : cur.rows[0].price;
    /* ⚠️ NOT VALIDATED AGAINST catalogue_items HERE — same "not a foreign key" tolerance as the column
     * itself (b267): a bogus or cross-entity id simply never resolves at push time and that push falls back
     * to a clean create, exactly like a dangling link left by a deleted product. */
    const product_item_id = 'product_item_id' in req.body
      ? (req.body.product_item_id ? String(req.body.product_item_id) : null)
      : cur.rows[0].product_item_id;
    const r = await withEntity(entity_id, (db) => db.query(
      `UPDATE combo_templates SET name=$1, definition=$2, price=$3, product_item_id=$4, updated_at=NOW()
       WHERE id=$5 AND entity_id=$6 RETURNING ${COLS}`,
      [name, JSON.stringify(definition), price, product_item_id, req.params.id, entity_id]));
    res.json({ message: 'Updated', template: r.rows[0] });
  } catch (e) { fail(res, e, 'Could not update this combo'); }
});

/**
 * ── ⭐⭐⭐ [OFFR-08] POST /api/combo-templates/:id/push — CREATE THE FIRST TIME, UPDATE EVERY TIME AFTER ──────
 *
 * Athi: "the saved combo should be able to push to product list as a new product... if it is an existing
 * combo in the product list it has to update only." One button, two outcomes, decided here — never by the
 * caller guessing whether it already has a product_item_id.
 *
 * CREATE goes through lib/mint-product.js's mintProduct() — "the one way a product enters a catalogue,"
 * exactly what POST /api/products itself calls, so a pushed combo is declared/stamped/columned the same as
 * any product a person typed by hand.
 * UPDATE reuses routes/products.js's own mergePatch() — the identical RFC 7386 rule PATCH /:id already
 * applies — so a push never clobbers whatever else has since been set on that product (an image, a
 * category) that this combo never claimed to own.
 *
 * ⚠️ A DANGLING LINK IS NOT AN ERROR. If the linked product was deleted some other way, this falls back to
 * CREATE and re-links — "push" always leaves you with a real, current product, never a refusal over a
 * pointer that no longer resolves.
 */
router.post('/:id/push', auth, async (req, res) => {
  try {
    const entity_id = ctx(req);
    const cur = await withEntity(entity_id, (db) => db.query(
      `SELECT name, definition, price, product_item_id FROM combo_templates WHERE id=$1 AND entity_id=$2`,
      [req.params.id, entity_id]));
    if (!cur.rows.length) return res.status(404).json({ error: 'Not found' });
    const t = cur.rows[0];
    const defErr = badDefinition(t.definition);
    if (defErr) return res.status(400).json({ error: 'Invalid combo', message: defErr });

    const productsRouter = require('./products');
    const catcols = require('../lib/catalogue-columns');
    const money = require('../lib/money');
    const regional = require('../lib/regional');
    const { query } = require('../db');

    const wantedFields = { name: t.name, modifiers: t.definition };
    if (t.price != null) wantedFields.price = Number(t.price);

    let existing = null;
    if (t.product_item_id) {
      const p = await withEntity(entity_id, (db) => db.query(
        `SELECT item_id, item_data FROM catalogue_items WHERE item_id=$1 AND entity_id=$2 AND is_active=true`,
        [t.product_item_id, entity_id]));
      existing = p.rows[0] || null;   // absent → the link is stale; fall through to create
    }

    let item, verb;
    if (existing) {
      const merged = productsRouter.mergePatch(existing.item_data || {}, wantedFields);
      const schema_id = await productsRouter.defaultSchemaId(entity_id);
      const decl = await catcols.ensureDeclared({
        query, entity_id, schema_id, item_data: merged,
        ensureSchema: (e) => require('../lib/schema-bootstrap').ensureDefaultSchema(e),
        validate: (data, rows) => productsRouter.validateAgainst(rows, data),
      });
      if (decl.error) return res.status(400).json({ error: 'Invalid product', message: decl.error });
      const stamped = money.stampItem(decl.item_data, await regional.currencyFor(entity_id));
      const r = await withEntity(entity_id, (db) => db.query(
        `UPDATE catalogue_items SET item_data=$1, updated_at=NOW() WHERE item_id=$2 AND entity_id=$3 RETURNING *`,
        [JSON.stringify(stamped), existing.item_id, entity_id]));
      item = r.rows[0]; verb = 'updated';
    } else {
      if (t.price == null) return res.status(400).json({ error: 'Price is required',
        message: 'Give this combo a price before pushing it as a new product.' });
      const schema_id = await productsRouter.defaultSchemaId(entity_id);
      const made = await require('../lib/mint-product').mintProduct({
        query, withEntity, entity_id, schema_id, item_data: wantedFields, rid: req.id,
        validate: (data, rows) => productsRouter.validateAgainst(rows, data),
        note: 'combo pushed from saved template',
      });
      if (made.error) return res.status(400).json({ error: 'Invalid product', message: made.error });
      item = made.item; verb = 'created';
    }

    const r2 = await withEntity(entity_id, (db) => db.query(
      `UPDATE combo_templates SET product_item_id=$1, updated_at=NOW() WHERE id=$2 AND entity_id=$3 RETURNING ${COLS}`,
      [item.item_id, req.params.id, entity_id]));
    res.json({ message: verb === 'created' ? 'Product created' : 'Product updated', verb, item, template: r2.rows[0] });
  } catch (e) { fail(res, e, 'Could not push this combo to your products'); }
});

// DELETE /api/combo-templates/:id
router.delete('/:id', auth, async (req, res) => {
  try {
    const entity_id = ctx(req);
    const r = await withEntity(entity_id, (db) => db.query(
      `DELETE FROM combo_templates WHERE id=$1 AND entity_id=$2 RETURNING id`, [req.params.id, entity_id]));
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json({ message: 'Deleted' });
  } catch (e) { fail(res, e, 'Could not delete this combo'); }
});

module.exports = router;
