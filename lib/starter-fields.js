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
  pharma: { title: 'Pharma', unit: 'unit', fields: [
    { field_key: 'batch_no',          field_name: 'Batch no',          field_type: 'text', leg: 'cb' },
    { field_key: 'active_ingredient', field_name: 'Active ingredient', field_type: 'text', leg: 'cb' },
    { field_key: 'expiry',            field_name: 'Expiry',            field_type: 'text', leg: 'cb' },
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
  const fields = [...BASE, ...extra].map((f, i) => Object.assign({ required: false }, f, { display_order: i + 1 }));
  return { vertical: v ? String(vertical).toLowerCase().trim() : null, title: v ? v.title : 'General', unit: v ? v.unit : 'piece', fields };
}

/** The list a person picks from at setup. */
function list() {
  return Object.entries(VERTICALS).map(([key, v]) => ({ key, title: v.title, unit: v.unit, field_count: BASE.length + v.fields.length }));
}

module.exports = { starterFor, list, BASE, VERTICALS, NOT_PRODUCT_LEGS };
