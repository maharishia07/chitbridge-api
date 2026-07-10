// lib/catalogue-build.js — FIRST LIGHT of the `ai:catalogue-structure@v1` slot.
// The AI handler that turns a CATALOGUE SOURCE (a brand PDF) into: (a) a client-facing SCHEMA (the fields a finish
// carries) and (b) structured ITEMS with COLOUR. Same shape as lib/compliance.js:
//   • DETERMINISTIC FLOOR = the AI-handler's structured output, SEEDED from the source (royale-play.pdf · Taana Baana
//     textures — read + structured by the handler). This is the "interpret once → the schema/items" step.
//   • routes/assist.js adds a model-drafted designer INTRO when a model is configured (best-effort; degrades cleanly).
//   • Returns the PROPOSAL (a draft the business confirms) — mint to a real catalogue_schema/items later.
// IP-safe: encodes the STRUCTURE + colour palettes; cites the source. Colours are representative hex for the demo.

const SOURCES = {
  'beta-royale-play@v1': {
    source: 'royale-play.pdf',
    for_entity: 'Beta',
    title: 'Beta Traders — Royale Play designer wall finishes',
    collection: 'Taana Baana',
    // The SCHEMA the client chooses by — three facets: Design · Colour · Application.
    schema: {
      name: 'Designer Wall Finish',
      facets: { design: ['texture_family', 'region', 'effect', 'scale'], colour: ['combinations', 'sheen'], application: ['tools', 'coats'] },
      fields: [
        { key: 'name',           label: 'Finish',              type: 'text' },
        { key: 'texture_family', label: 'Texture',             type: 'enum',  values: ['weave', 'check', 'tie-dye', 'polka', 'thread', 'geometric'] },
        { key: 'region',         label: 'Region',              type: 'enum',  values: ['North', 'South', 'East', 'West'] },
        { key: 'effect',         label: 'Effect',              type: 'multi', values: ['luminous', 'rustic', 'bold', 'playful', 'earthy', 'elegant'] },
        { key: 'scale',          label: 'Best for',            type: 'enum',  values: ['single big wall', 'accent', 'large space'] },
        { key: 'sheen',          label: 'Sheen',               type: 'enum',  values: ['matte', 'metallic', 'pearl'] },
        { key: 'combinations',   label: 'Colour combinations', type: 'colour-combos' },
        { key: 'tools',          label: 'Applied with',        type: 'multi', values: ['sponge', 'trowel', 'roller', 'brush', 'special tool'] },
        { key: 'coats',          label: 'Coats',               type: 'text' },
      ],
    },
    items: [
      { name: 'Tussar', texture_family: 'weave', region: 'East', effect: ['luminous', 'elegant'], scale: 'single big wall', sheen: 'metallic',
        inspiration: 'Bhagalpur tussar silk — catches the light and draws the eye.', tools: ['trowel', 'sponge'], coats: '1 base + 2 effect',
        combinations: [ { name: 'Silk Route',   colours: [{ name: 'Raw Silk', hex: '#C9A86A' }, { name: 'Bronze Glow', hex: '#8C6B3F' }] },
                        { name: 'Golden Weave', colours: [{ name: 'Antique Gold', hex: '#B8860B' }, { name: 'Champagne', hex: '#D8C89A' }] } ] },
      { name: 'Madras Check', texture_family: 'check', region: 'South', effect: ['rustic', 'bold'], scale: 'large space', sheen: 'matte',
        inspiration: 'The handloom check — crisscrossed lines bring rustic symmetry and theatre.', tools: ['roller', 'brush'], coats: '1 base + 1 effect',
        combinations: [ { name: 'Rustic Grid', colours: [{ name: 'Terracotta', hex: '#B5651D' }, { name: 'Slate', hex: '#4A5A5A' }] },
                        { name: 'Sunbaked',    colours: [{ name: 'Ochre', hex: '#CC7722' }, { name: 'Umber', hex: '#8B5A2B' }] } ] },
      { name: 'Bandhej', texture_family: 'tie-dye', region: 'West', effect: ['earthy', 'bold'], scale: 'accent', sheen: 'matte',
        inspiration: 'The ancient tie-dye of Gujarat & Rajasthan — dots stamped over a crinkled, freshly-dyed look.', tools: ['sponge', 'special tool'], coats: '1 base + 2 effect',
        combinations: [ { name: 'Desert Bloom', colours: [{ name: 'Madder Red', hex: '#A83232' }, { name: 'Sand', hex: '#D8C3A5' }] },
                        { name: 'Indigo Tie',   colours: [{ name: 'Indigo', hex: '#3F5E78' }, { name: 'Sand', hex: '#D8C3A5' }] } ] },
      { name: 'Ikkat', texture_family: 'thread', region: 'South', effect: ['elegant', 'luminous'], scale: 'single big wall', sheen: 'pearl',
        inspiration: 'Pochampally ikat — a soft, blurry weave that lets furniture and accents pop.', tools: ['trowel', 'brush'], coats: '1 base + 2 effect',
        combinations: [ { name: 'Blurred Weave', colours: [{ name: 'Teal Blur', hex: '#2E7C7C' }, { name: 'Ivory', hex: '#F0EAD6' }] },
                        { name: 'Coral Thread',  colours: [{ name: 'Coral', hex: '#E2725B' }, { name: 'Ivory', hex: '#F0EAD6' }] } ] },
      { name: 'Pom Pom', texture_family: 'polka', region: 'North', effect: ['playful', 'bold'], scale: 'accent', sheen: 'matte',
        inspiration: 'Pure joy — bursts of colour in playful dots over a textured ground.', tools: ['sponge', 'special tool'], coats: '1 base + 1 effect',
        combinations: [ { name: 'Festive Dots', colours: [{ name: 'Marigold', hex: '#F4A81D' }, { name: 'Rose', hex: '#D6567B' }] },
                        { name: 'Playful Sky',  colours: [{ name: 'Sky', hex: '#6FA8DC' }, { name: 'Marigold', hex: '#F4A81D' }] } ] },
      { name: 'Kilim', texture_family: 'geometric', region: 'West', effect: ['rustic', 'earthy'], scale: 'large space', sheen: 'matte',
        inspiration: 'Nomadic flat-weave geometry — bold motifs for a statement wall.', tools: ['roller', 'trowel'], coats: '1 base + 2 effect',
        combinations: [ { name: 'Nomad Geometry', colours: [{ name: 'Rust', hex: '#9C4A2F' }, { name: 'Cream', hex: '#EDE1C8' }] },
                        { name: 'Olive Weave',    colours: [{ name: 'Olive', hex: '#6B6B3A' }, { name: 'Cream', hex: '#EDE1C8' }] } ] },
    ],
  },
};

// LAYER SPLIT (the whole point): the SCHEMA + COLOUR + DESIGN is the EXPENSIVE, SHARED, minted-ONCE layer — the
// brand/source catalogue every retailer reuses (WITHOUT RLS, a share-read reference). An entity like Beta does NOT
// redo the interpretation — it ADOPTS the shared catalogue and only overlays its own COMMERCIALS (per-entity, WITH
// RLS). These are the only fields the retailer fills.
const { query } = require('../db');   // catalogue_source is WITHOUT RLS → plain query() (no withEntity)
const VERSION = 'v1';

const COMMERCIALS_FIELDS = [
  { key: 'price_per_litre', label: 'Price / litre', type: 'money' },
  { key: 'pack_sizes',      label: 'Pack sizes',    type: 'multi', values: ['1L', '4L', '10L', '20L'] },
  { key: 'coverage_sqft',   label: 'Coverage (sq ft / L)', type: 'number' },
  { key: 'availability',    label: 'Availability',  type: 'enum', values: ['in stock', 'made to order', 'discontinued'] },
  { key: 'lead_time_days',  label: 'Lead time (days)', type: 'number' },
  { key: 'applicator_service', label: 'Applicator service offered', type: 'bool' },
];

function getSource(key) { return SOURCES[key] || null; }   // code-only accessor (kept for callers/tests)

// loadSource(key) → DB-FIRST read of the shared source (catalogue_source, WITHOUT RLS → plain query), self-healing to
// the code SOURCES seed if the table/row is absent or the DB is down. Normalised to the shape build() expects. This is
// the "minted once IN THE DB, read by reference" wiring — update the catalogue = update the row, not code.
async function loadSource(sourceKey) {
  // Two-tier read: try with the b78 columns (owner + experience + formatting); fall back to the base set if b78 isn't
  // applied yet; fall back to the code seed if the table is absent entirely. Fully self-healing.
  let row = null;
  try {
    const r = await query(
      `SELECT source_key, version, for_vertical, title, collection, schema, items, commercials_fields,
              owner_entity_id, experience, formatting
         FROM catalogue_source WHERE source_key = $1 AND active = true LIMIT 1`, [sourceKey]);
    row = r.rows[0];
  } catch (_) {
    try {
      const r2 = await query(
        `SELECT source_key, version, for_vertical, title, collection, schema, items, commercials_fields
           FROM catalogue_source WHERE source_key = $1 AND active = true LIMIT 1`, [sourceKey]);
      row = r2.rows[0];
    } catch (_2) { row = null; }
  }
  if (row && Array.isArray(row.items) && row.items.length) {
    return { _fromDb: true, source: 'royale-play.pdf', for_entity: 'Beta', for_vertical: row.for_vertical,
      title: row.title, collection: row.collection, version: row.version || VERSION,
      schema: row.schema || {}, items: row.items,
      commercials_fields: (Array.isArray(row.commercials_fields) && row.commercials_fields.length) ? row.commercials_fields : COMMERCIALS_FIELDS,
      owner_entity_id: row.owner_entity_id || null, experience: row.experience || {}, formatting: row.formatting || {} };
  }
  return SOURCES[sourceKey] || null;
}

async function listSources() {
  try {
    const r = await query(`SELECT source_key, title, items FROM catalogue_source WHERE active = true`);
    if (r.rows.length) return r.rows.map((row) => ({ key: row.source_key, for_entity: 'Beta', title: row.title, item_count: (row.items || []).length, from_db: true }));
  } catch (_) { /* fall through to code */ }
  return Object.keys(SOURCES).map((k) => ({ key: k, for_entity: SOURCES[k].for_entity, title: SOURCES[k].title, item_count: SOURCES[k].items.length }));
}

// build(sourceKey) → the structured PROPOSAL, split by LAYER (shared = schema+design+colour; entity = commercials).
// DB-first (via loadSource), self-healing to code. Async now.
async function build(sourceKey) {
  const s = await loadSource(sourceKey); if (!s) return null;
  const comFields = s.commercials_fields || COMMERCIALS_FIELDS;
  const colours = s.items.reduce((n, it) => n + (it.combinations || []).reduce((m, c) => m + (c.colours || []).length, 0), 0);
  return {
    source: s.source || 'royale-play.pdf', for_entity: s.for_entity || 'Beta', title: s.title, collection: s.collection,
    from_db: !!s._fromDb,
    owner_entity_id: s.owner_entity_id || null,      // b78 — the brand entity that AUTHORS this source (source-as-entity)
    experience: s.experience || {},                  // b78 — the customer-experience blueprint that CASCADES with the catalogue
    formatting: s.formatting || {},                  // b78 — brand formatting that cascades
    layers: { shared: 'schema + design + colour + images + EXPERIENCE (minted ONCE by the brand/source — cascades to every distributor)',
              entity: 'commercials only (price · pack · availability — the retailer fills these, per-entity)' },
    // Beta inherits by REFERENCE, not by copy (cb-core-principle: share-read immutable reference). Pointer + version +
    // commercials overlay only. No image/colour/design duplicated; version-frozen until it adopts a newer version.
    adoption_model: { source_ref: sourceKey, version: s.version || VERSION, stores: 'reference + commercials only (no content copy)',
                      overlay: 'commercials keyed by shared item name/id' },
    schema: s.schema, items: s.items, commercials_fields: comFields,
    counts: { finishes: s.items.length, fields: (s.schema && s.schema.fields ? s.schema.fields.length : 0), combinations: s.items.reduce((n, it) => n + (it.combinations || []).length, 0), colours },
  };
}

// resolve(sourceKey, commercials) → the SHARED catalogue (by reference) with the entity's COMMERCIALS overlaid per item.
async function resolve(sourceKey, commercials) {
  const b = await build(sourceKey); if (!b) return null;
  const com = commercials || {};
  b.items = b.items.map((it) => Object.assign({}, it, { commercials: com[it.name] || null }));
  b.adopted = Object.keys(com).length;
  return b;
}

module.exports = { getSource, listSources, build, resolve, VERSION };
