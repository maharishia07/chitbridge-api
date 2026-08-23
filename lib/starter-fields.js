// @stage tested
// @stage-note The standard column set a vertical starts from. Data, not behaviour — the schema seeder and the
// catalogue UI both read it so an empty catalogue is not a blank page.
'use strict';
/**
 * starter-fields.js — what a catalogue in this trade is expected to carry.
 *
 * Athi, 2026-08-06: *"initially when the registration happens the catalogue is empty, it has nothing and maybe the
 * standard fields, now the definition needs to be given — this is where we tried doing based on vertical. We can
 * provide a list of columns, a standard set which can be used."*
 *
 * Today a new entity gets `name · quantity · price` from schema-bootstrap and nothing else, so the first thing a
 * gold dealer sees is a form that cannot describe a gold bar. The vertical sets below are the standard starting
 * point: adopt one and the declaration — and therefore the template, the preflight and the export — is immediately
 * shaped like the trade.
 *
 * ── THIS IS A STARTING POINT, NOT A CEILING ────────────────────────────────────────────────────────────────────
 * A merchant adopts a set, then extends it from their own spreadsheet (csv-preflight.applyDecisions). The vertical
 * answers "what does this trade usually record"; their file answers "what do WE record". Both end up in the same
 * declaration, which is what makes the entity's format stable from then on.
 *
 * ── THE `leg` IS NOT DECORATION ────────────────────────────────────────────────────────────────────────────────
 * Each field says where its value is meant to COME FROM — the four-leg model:
 *   cb        the business types it (it exists nowhere else — this is the gap CB fills)
 *   system    an existing system already holds it (ERP, WMS) — a connector's job, not a person's
 *   customer  the buyer supplies it at order time — it is not a catalogue value at all
 *   compute   derived from the others (AI or arithmetic)
 *   standard  it belongs to an external standard (HS code, GS1) and is carried BY REFERENCE
 * Only `cb` and `standard` fields belong on a product form; a `customer` field on a product row is a modelling
 * mistake, and marking it here is what stops one being created.
 *
 * ⚠️ DUPLICATED, KNOWINGLY: `CATF_REQUIRED` in chitbridge-web/public/app/cap-catalogue.js holds the same sets for
 * the setup wizard. This is the server-side copy because the schema seeder cannot reach into the browser. The test
 * beside this file compares the two when the web repo is present and fails on drift. Collapsing them into one
 * shared file means changing how the wizard loads its knowledge base — worth doing, not worth doing today.
 *
 * ── ZERO DEPENDENCIES · TIER A ─────────────────────────────────────────────────────────────────────────────────
 */

/** Every catalogue has these, whatever the trade. */
const BASE = [
  { field_key: 'name',  field_name: 'Product', field_type: 'text',   leg: 'cb', required: true },
  { field_key: 'unit',  field_name: 'Unit',    field_type: 'text',   leg: 'cb', required: false },
  { field_key: 'price', field_name: 'Price',   field_type: 'number', leg: 'cb', required: false },
  { field_key: 'code',  field_name: 'Code / HSN', field_type: 'text', leg: 'standard', required: false },
  { field_key: 'desc',  field_name: 'Description', field_type: 'text', leg: 'cb', required: false },
];

const VERTICALS = {
  gold: { title: 'Gold / bullion', unit: 'g', fields: [
    { field_key: 'fineness',    field_name: 'Fineness',        field_type: 'number', leg: 'cb' },
    { field_key: 'assay_cert',  field_name: 'Assay certificate', field_type: 'text', leg: 'cb' },
    { field_key: 'bar_serial',  field_name: 'Bar serial',      field_type: 'text',   leg: 'cb' },
    { field_key: 'hs_code',     field_name: 'HS code',         field_type: 'text',   leg: 'standard' },
  ] },
  coffee: { title: 'Coffee', unit: 'kg', fields: [
    { field_key: 'origin_farm',   field_name: 'Origin farm',   field_type: 'text',   leg: 'cb' },
    { field_key: 'varietal',      field_name: 'Varietal',      field_type: 'text',   leg: 'cb' },
    { field_key: 'cupping_score', field_name: 'Cupping score', field_type: 'number', leg: 'cb' },
    { field_key: 'moisture_pct',  field_name: 'Moisture %',    field_type: 'number', leg: 'system' },
    { field_key: 'hs_code',       field_name: 'HS code',       field_type: 'text',   leg: 'standard' },
  ] },
  /**
   * ── ⚠️ `batch_no` AND `expiry` WERE HERE, AND THAT WAS THE BUG (removed 2026-08-13) ───────────────────────────
   * A batch is not a property of a PRODUCT. It is a property of a CONSIGNMENT, and putting it on the item means
   * every new lot needs a new catalogue row — a thousand lots a year is a thousand products a year, each carrying
   * its own version history (b146). The catalogue quietly becomes a lot ledger, which is exactly the unbounded
   * growth Athi asked us to prevent. The CSV importer even allows `batch_no` as the identity key, so this was not
   * hypothetical: it was one declaration away from happening.
   *
   * The lot now travels on the MOVEMENT — `line.lot {batch, expiry, serial}`, GS1 (10)/(17)/(21) — where it is
   * co-held with the counterparty and can actually answer a recall.
   *
   * ⭐ WHAT STAYS ON THE PRODUCT IS THE DECLARATION, exactly as Odoo models it: the item says whether it is
   * lot-tracked at all, and how long it lasts. Both are true of every unit ever made, which is the test for
   * belonging here. `shelf_life_days` is a property of the product; the expiry DATE it implies is a property of
   * the lot, and confusing the two is how a batch ends up in a catalogue.
   */
  pharma: { title: 'Pharma', unit: 'unit', fields: [
    { field_key: 'tracking',          field_name: 'Tracked by',        field_type: 'choice', leg: 'cb',
      options: ['none', 'lot', 'serial'], note: 'Whether movements of this product must carry a batch or a serial.' },
    { field_key: 'shelf_life_days',   field_name: 'Shelf life (days)', field_type: 'number', leg: 'cb',
      note: 'A property of the product. The expiry DATE it implies belongs to the lot, not here.' },
    { field_key: 'active_ingredient', field_name: 'Active ingredient', field_type: 'text', leg: 'cb' },
    { field_key: 'storage_temp',      field_name: 'Storage temp',      field_type: 'number', leg: 'system' },
  ] },
  paint: { title: 'Paint / finishes', unit: 'litre', fields: [
    { field_key: 'texture_family',      field_name: 'Texture family',       field_type: 'text',   leg: 'cb' },
    { field_key: 'colour_combination',  field_name: 'Colour combination',   field_type: 'text',   leg: 'cb' },
    { field_key: 'sheen',               field_name: 'Sheen',                field_type: 'text',   leg: 'cb' },
    { field_key: 'coverage_sqft_per_litre', field_name: 'Coverage (sq ft/L)', field_type: 'number', leg: 'cb' },
    { field_key: 'stock_litres',        field_name: 'Stock (litres)',       field_type: 'number', leg: 'system', via: 'ERP' },
    // room_area_sqft (customer) and litres_needed (compute) are deliberately NOT product fields — see the header.
  ] },
  veg: { title: 'Veg market', unit: 'kg', fields: [
    { field_key: 'grade',       field_name: 'Grade',       field_type: 'text', leg: 'cb' },
    { field_key: 'source_farm', field_name: 'Source farm', field_type: 'text', leg: 'cb' },
  ] },
  retail: { title: 'Retail shop', unit: 'piece', fields: [
    { field_key: 'brand', field_name: 'Brand', field_type: 'text', leg: 'cb' },
  ] },
  trade: { title: 'Trade / export', unit: 'unit', fields: [
    { field_key: 'hs_code',        field_name: 'HS code',        field_type: 'text', leg: 'standard' },
    { field_key: 'origin_country', field_name: 'Origin country', field_type: 'text', leg: 'cb' },
    // incoterm is the CUSTOMER's at order time, not a property of the product.
  ] },
  /**
   * ⭐⭐ THE FIRST VERTICAL THAT DOES NOT SELL A THING. Athi, 2026-08-23: *"we are currently working with use
   * cases mostly of type goods… now we have to create a use case for service, and then goods and services."*
   *
   * Every vertical above sells an object and its unit is an object's unit — gram, litre, piece, kg. **A service
   * catalogue line is a RATE, not a product**: what the work is, the unit it is sold in, and what an hour of it
   * costs. Nothing is in stock, nothing is delivered, and the quantity is not known when it is ordered.
   *
   * ⚠️⚠️ AND THE QUANTITY BEING UNKNOWN IS THE WHOLE DIFFERENCE, not a detail. A goods line is a QUANTITY
   * promised and its events draw it down to zero; a service line is an OUTCOME promised and its events ACCRUE,
   * with no target to converge on. `b152` already gave the line spine both directions (`deliver` vs `add`) —
   * this vertical is what lets the catalogue describe the second one. See `SPEC-service-usecase.md`.
   *
   * ⚠️ `estimate_required` earns its place because of what §2 of that spec calls the disputable moment:
   * exceeding a goods quantity is an error to be corrected, while exceeding a service estimate is ordinary —
   * and it is exactly where the customer and the workshop disagree. A trade that promised an estimate and did
   * not give one has lost the argument before it starts.
   */
  service: { title: 'Service / labour', unit: 'hour', fields: [
    /* The base label is 'Product'. There is no product here — the thing sold is the work. */
    { field_key: 'name', field_name: 'Service', field_type: 'text', leg: 'cb', required: true },
    { field_key: 'skill',        field_name: 'Skill or trade',   field_type: 'text',   leg: 'cb',
      note: 'What kind of person does this — mechanic, electrician, surveyor.' },
    { field_key: 'min_charge',   field_name: 'Minimum charge',   field_type: 'number', leg: 'cb',
      note: 'The call-out: what is owed even when the work turns out to be nothing.' },
    { field_key: 'estimate_req', field_name: 'Estimate required', field_type: 'choice', leg: 'cb',
      options: ['no', 'yes'],
      note: 'Whether work may not start until an estimate has been given and accepted.' },
    { field_key: 'sla_hours',    field_name: 'Respond within (hours)', field_type: 'number', leg: 'cb' },
    /* ⭐ SAC, not HSN. India's GST classifies GOODS by HSN and SERVICES by SAC — the goods verticals above
       carry `hs_code` for the same reason. Adopting the jurisdiction's own split rather than inventing one. */
    { field_key: 'sac_code',     field_name: 'SAC code',         field_type: 'text',   leg: 'standard' },
  ] },
};

/** Fields whose value does not come from the business, so they never become product columns. */
const NOT_PRODUCT_LEGS = ['customer', 'compute'];

/**
 * starterFor(vertical) → { title, unit, fields } — BASE plus the vertical's own, ready to seed a schema.
 * An unknown or absent vertical returns the base set, which is correct rather than empty: every catalogue has one.
 */
function starterFor(vertical) {
  const v = VERTICALS[String(vertical || '').toLowerCase().trim()] || null;
  const extra = v ? v.fields.filter((f) => !NOT_PRODUCT_LEGS.includes(f.leg)) : [];
  /**
   * ⚠️ A VERTICAL MAY NOW RELABEL A BASE FIELD, and `service` is why it had to. Every vertical before it sells
   * an object, so BASE calling the first field **"Product"** was true everywhere. On a service catalogue,
   * "Product: Engine diagnosis" is simply wrong — the word describes a thing where there is none.
   *
   * ⭐ Same key, later wins. Concatenating produced TWO fields with `field_key: 'name'` rather than one
   * overridden — a form with the same input twice, which is worse than the wrong label. Verified before
   * changing it that **no vertical duplicates a BASE key today**, so nothing existing moves.
   */
  const merged = new Map();
  for (const f of [...BASE, ...extra]) merged.set(f.field_key, Object.assign({}, merged.get(f.field_key), f));
  const fields = [...merged.values()].map((f, i) => Object.assign({ required: false }, f, { display_order: i + 1 }));
  return { vertical: v ? String(vertical).toLowerCase().trim() : null, title: v ? v.title : 'General', unit: v ? v.unit : 'piece', fields };
}

/** The list a person picks from at setup. */
function list() {
  return Object.entries(VERTICALS).map(([key, v]) => ({ key, title: v.title, unit: v.unit, field_count: BASE.length + v.fields.length }));
}

module.exports = { starterFor, list, BASE, VERTICALS, NOT_PRODUCT_LEGS };
