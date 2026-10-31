// routes/combo-templates.js — [OFFR-06] saved, reusable combo/modifier group sets — b266.   CARD 07-offers-pricing-and-combos/combo-templates
// FLOW  auth → list (paged) / get / save / delete → withEntity (the caller's own entity only)
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
const PL = require('../lib/page-limit'); /* LIM2: the ONE pager — asked = a page (server max), not asked = every row, as before */
const PAGE_DEFAULT = 50,
  PAGE_MAX = 200; /* one page of this file's lists */
const router = express.Router();
const { problem } = require('../lib/problem'); // API-STANDARD S1: the one error writer; each answer's old body is frozen in docs/contracts/api-legacy.json
const { schemaValidate } = require('../middleware/validate'); // S9: the request is checked against the route's own schema
const { said, validationOptions, faultOf, contract } = require('../lib/combo-templates-contract'); // the contract (each route's operation) and the words of a refusal
const { withEntity } = require('../db');
const auth = require('../middleware/auth');

/** the schema check of one route (its own operation in lib/combo-templates-contract.js), as a list to spread after the gates: a route that takes no input has none.
 *  A malformed save keeps its old 400 "Validation failed" body (validationOptions). */
function checked(route) {
  const operation = contract.operationFor(route);
  return operation.parameters || operation.requestBody ? [schemaValidate(operation, validationOptions)] : [];
}
const ctx = (req) => auth.entityOf(req);

/** ⚠️ a name is the whole point of "save as" — an unnamed row is a row nobody can find again to reopen */
function badName(name) {
  const text = String(name || '').trim();
  if (!text) return 'A name is required — this is what you will look for when you come back to reuse it.';
  if (text.length > 120) return 'That name is too long — keep it under 120 characters.';
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
router.get('/', auth, ...checked('GET /'), async (req, res) => {
  try {
    const entity_id = ctx(req);
    const r = await withEntity(entity_id, (db) =>
      db.query(
        `SELECT ${COLS} FROM combo_templates
       WHERE entity_id=$1 ORDER BY created_at DESC LIMIT 200`,
        [entity_id]
      )
    );
    res.json(PL.pageOut('templates', r.rows, PL.pageArgs(req.query, PAGE_DEFAULT, PAGE_MAX)));
  } catch (e) {
    problem(req, res, faultOf(e, req, 'Could not read your saved combos'));
  }
});

// POST /api/combo-templates  { name, definition, price? }  — "Save as"
router.post('/', auth, ...checked('POST /'), async (req, res) => {
  try {
    const entity_id = ctx(req);
    const nameErr = badName(req.body.name);
    if (nameErr) return problem(req, res, said(400, 'COMBO_NAME_INVALID', 'Invalid name', nameErr));
    const defErr = badDefinition(req.body.definition);
    if (defErr) return problem(req, res, said(400, 'COMBO_INVALID', 'Invalid combo', defErr));
    const priceErr = badPrice(req.body.price);
    if (priceErr) return problem(req, res, said(400, 'COMBO_PRICE_INVALID', 'Invalid price', priceErr));
    const price = req.body.price === undefined || req.body.price === null || req.body.price === '' ? null : Number(req.body.price);
    const r = await withEntity(entity_id, (db) =>
      db.query(
        `INSERT INTO combo_templates (entity_id, name, definition, price) VALUES ($1,$2,$3,$4)
       RETURNING ${COLS}`,
        [entity_id, String(req.body.name).trim(), JSON.stringify(req.body.definition), price]
      )
    );
    res.json({ message: 'Saved', template: r.rows[0] });
  } catch (e) {
    problem(req, res, faultOf(e, req, 'Could not save this combo'));
  }
});

// PATCH /api/combo-templates/:id  { name?, definition?, price?, product_item_id? } — rename, replace what it
// holds, or link it to a product that already exists (see modLabAdoptExisting() in offer-lab-next.html —
// "bring an already-live combo into this library" without pushing a duplicate product for it).
router.patch('/:id', auth, ...checked('PATCH /:id'), async (req, res) => {
  try {
    const entity_id = ctx(req);
    if ('name' in req.body) {
      const nameErr = badName(req.body.name);
      if (nameErr) return problem(req, res, said(400, 'COMBO_NAME_INVALID', 'Invalid name', nameErr));
    }
    if ('definition' in req.body) {
      const defErr = badDefinition(req.body.definition);
      if (defErr) return problem(req, res, said(400, 'COMBO_INVALID', 'Invalid combo', defErr));
    }
    if ('price' in req.body) {
      const priceErr = badPrice(req.body.price);
      if (priceErr) return problem(req, res, said(400, 'COMBO_PRICE_INVALID', 'Invalid price', priceErr));
    }
    const cur = await withEntity(entity_id, (db) =>
      db.query(`SELECT name, definition, price, product_item_id FROM combo_templates WHERE id=$1 AND entity_id=$2`, [req.params.id, entity_id])
    );
    if (!cur.rows.length) return problem(req, res, { status: 404, code: 'NOT_FOUND', detail: 'Not found', legacy: { error: 'Not found' } });
    const name = 'name' in req.body ? String(req.body.name).trim() : cur.rows[0].name;
    const definition = 'definition' in req.body ? req.body.definition : cur.rows[0].definition;
    const price = 'price' in req.body ? (req.body.price === null || req.body.price === '' ? null : Number(req.body.price)) : cur.rows[0].price;
    /* ⚠️ NOT VALIDATED AGAINST catalogue_items HERE — same "not a foreign key" tolerance as the column
     * itself (b267): a bogus or cross-entity id simply never resolves at push time and that push falls back
     * to a clean create, exactly like a dangling link left by a deleted product. */
    const product_item_id = 'product_item_id' in req.body ? (req.body.product_item_id ? String(req.body.product_item_id) : null) : cur.rows[0].product_item_id;
    const r = await withEntity(entity_id, (db) =>
      db.query(
        `UPDATE combo_templates SET name=$1, definition=$2, price=$3, product_item_id=$4, updated_at=NOW()
       WHERE id=$5 AND entity_id=$6 RETURNING ${COLS}`,
        [name, JSON.stringify(definition), price, product_item_id, req.params.id, entity_id]
      )
    );
    res.json({ message: 'Updated', template: r.rows[0] });
  } catch (e) {
    problem(req, res, faultOf(e, req, 'Could not update this combo'));
  }
});

/** push to a product the template already links to: the template's name, modifiers and price merged over it; → { item, verb } or { refusal: { status, body } } */
async function updateLinkedProduct(entity_id, existing, wantedFields) {
  const productsRouter = require('./products'),
    money = require('../lib/money'),
    regional = require('../lib/regional');
  const merged = productsRouter.mergePatch(existing.item_data || {}, wantedFields);
  const schema_id = await productsRouter.defaultSchemaId(entity_id);
  const decl = await require('../lib/catalogue-columns').ensureDeclared({
    query: require('../db').query,
    entity_id,
    schema_id,
    item_data: merged,
    stored: existing.item_data || {} /* C4: the product's own media rides through unchanged */,
    ensureSchema: (e) => require('../lib/schema-bootstrap').ensureDefaultSchema(e),
    validate: (data, rows) => productsRouter.validateAgainst(rows, data)
  });
  if (decl.error)
    return { refusal: { status: 400, code: 'PRODUCT_INVALID', body: { error: 'Invalid product', code: decl.code || undefined, message: decl.error } } };
  const stamped = money.stampItem(decl.item_data, await regional.currencyFor(entity_id));
  const written = await withEntity(entity_id, (db) =>
    require('../lib/catalogue-write').patchItems(db, entity_id /* CAT-W1: the one product writer */, [{ item_id: existing.item_id, replace: stamped }], {
      returning: '*'
    })
  );
  return { item: written.rows[0], verb: 'updated' };
}
/** push as a NEW product (the link is absent or stale): needs a price; → { item, verb } or { refusal: { status, body } } */
async function createPushedProduct(entity_id, template, wantedFields, requestId) {
  if (template.price == null)
    return {
      refusal: {
        status: 400,
        code: 'COMBO_PRICE_REQUIRED',
        body: { error: 'Price is required', message: 'Give this combo a price before pushing it as a new product.' }
      }
    };
  const productsRouter = require('./products');
  const schema_id = await productsRouter.defaultSchemaId(entity_id);
  const made = await require('../lib/mint-product').mintProduct({
    query: require('../db').query,
    withEntity,
    entity_id,
    schema_id,
    item_data: wantedFields,
    rid: requestId,
    validate: (data, rows) => productsRouter.validateAgainst(rows, data),
    note: 'combo pushed from saved template'
  });
  if (made.error) return { refusal: { status: 400, code: 'PRODUCT_INVALID', body: { error: 'Invalid product', message: made.error } } };
  return { item: made.item, verb: 'created' };
}
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
router.post('/:id/push', auth, ...checked('POST /:id/push'), async (req, res) => {
  try {
    const entity_id = ctx(req);
    /* [OFFR-04] a push writes the product's name, modifiers and price — the same gate as PATCH /products (lib/cost.writeRefusal) */
    const refused = await require('../lib/cost').writeRefusal(req, entity_id, ['name', 'modifiers', 'price']);
    if (refused) return problem(req, res, { status: 403, code: 'COST_BLIND', detail: refused.message, legacy: refused });
    /* SPD-32: the template and the product it is linked to are read in ONE transaction (was two); both reads stay under this shop's RLS scope. */
    const { cur, linked } = await withEntity(entity_id, async (db) => {
      const template = await db.query(`SELECT name, definition, price, product_item_id FROM combo_templates WHERE id=$1 AND entity_id=$2`, [req.params.id, entity_id]);
      const link = template.rows[0] && template.rows[0].product_item_id;
      const prod = link ? await db.query(`SELECT item_id, item_data FROM catalogue_items WHERE item_id=$1 AND entity_id=$2 AND is_active=true`, [link, entity_id]) : null;
      return { cur: template, linked: prod };
    });
    if (!cur.rows.length) return problem(req, res, { status: 404, code: 'NOT_FOUND', detail: 'Not found', legacy: { error: 'Not found' } });
    const t = cur.rows[0];
    const defErr = badDefinition(t.definition);
    if (defErr) return problem(req, res, { status: 400, code: 'COMBO_INVALID', detail: defErr, legacy: { error: 'Invalid combo', message: defErr } });

    const wantedFields = { name: t.name, modifiers: t.definition };
    if (t.price != null) wantedFields.price = Number(t.price);

    const existing = (linked && linked.rows[0]) || null; // absent → the link is stale; fall through to create

    const outcome = existing ? await updateLinkedProduct(entity_id, existing, wantedFields) : await createPushedProduct(entity_id, t, wantedFields, req.id);
    if (outcome.refusal) {
      const { status, code, body } = outcome.refusal; /* the product writer's refusal: its status, its own code when it names one, the old body */
      return problem(req, res, { status, code: body.code || code, detail: body.message, legacy: body });
    }
    const { item, verb } = outcome;

    const r2 = await withEntity(entity_id, (db) =>
      db.query(`UPDATE combo_templates SET product_item_id=$1, updated_at=NOW() WHERE id=$2 AND entity_id=$3 RETURNING ${COLS}`, [
        item.item_id,
        req.params.id,
        entity_id
      ])
    );
    res.json({ message: verb === 'created' ? 'Product created' : 'Product updated', verb, item, template: r2.rows[0] });
  } catch (e) {
    problem(req, res, faultOf(e, req, 'Could not push this combo to your products'));
  }
});

// DELETE /api/combo-templates/:id
router.delete('/:id', auth, ...checked('DELETE /:id'), async (req, res) => {
  try {
    const entity_id = ctx(req);
    const r = await withEntity(entity_id, (db) =>
      db.query(`DELETE FROM combo_templates WHERE id=$1 AND entity_id=$2 RETURNING id`, [req.params.id, entity_id])
    );
    if (!r.rows.length) return problem(req, res, { status: 404, code: 'NOT_FOUND', detail: 'Not found', legacy: { error: 'Not found' } });
    res.json({ message: 'Deleted' });
  } catch (e) {
    problem(req, res, faultOf(e, req, 'Could not delete this combo'));
  }
});

router.openapi = { paths: contract.pathsOf(), schemas: {} };
module.exports = router;
