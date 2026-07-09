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
const COMMERCIALS_FIELDS = [
  { key: 'price_per_litre', label: 'Price / litre', type: 'money' },
  { key: 'pack_sizes',      label: 'Pack sizes',    type: 'multi', values: ['1L', '4L', '10L', '20L'] },
  { key: 'coverage_sqft',   label: 'Coverage (sq ft / L)', type: 'number' },
  { key: 'availability',    label: 'Availability',  type: 'enum', values: ['in stock', 'made to order', 'discontinued'] },
  { key: 'lead_time_days',  label: 'Lead time (days)', type: 'number' },
  { key: 'applicator_service', label: 'Applicator service offered', type: 'bool' },
];

function getSource(key) { return SOURCES[key] || null; }
function listSources() { return Object.keys(SOURCES).map((k) => ({ key: k, for_entity: SOURCES[k].for_entity, title: SOURCES[k].title, item_count: SOURCES[k].items.length })); }

// build(sourceKey) → the structured PROPOSAL, split by LAYER:
//   shared (minted once, reused by all)   = schema · items (design + colour)
//   entity (Beta fills only these)        = commercials_fields
function build(sourceKey) {
  const s = getSource(sourceKey); if (!s) return null;
  const colours = s.items.reduce((n, it) => n + (it.combinations || []).reduce((m, c) => m + (c.colours || []).length, 0), 0);
  return {
    source: s.source, for_entity: s.for_entity, title: s.title, collection: s.collection,
    layers: { shared: 'schema + design + colour + images (minted ONCE at the brand/source layer — reused by every retailer)',
              entity: 'commercials only (price · pack · availability — the retailer fills these, per-entity)' },
    // Beta inherits by REFERENCE, not by copy (cb-core-principle: share-read immutable reference). It stores only a
    // pointer + version + its commercials overlay keyed by the shared item id. No image/colour/design is duplicated;
    // version-freeze means Beta's ref stays on v1 until it consciously adopts a newer brand version.
    adoption_model: { source_ref: sourceKey, version: 'v1', stores: 'reference + commercials only (no content copy)',
                      overlay: 'commercials keyed by shared item name/id' },
    schema: s.schema, items: s.items, commercials_fields: COMMERCIALS_FIELDS,
    counts: { finishes: s.items.length, fields: s.schema.fields.length, combinations: s.items.reduce((n, it) => n + (it.combinations || []).length, 0), colours },
  };
}

// resolve(sourceKey, commercials) → the SHARED catalogue with the entity's COMMERCIALS overlaid per item (keyed by
// name). This is the read model: design/colour come from the shared source (by reference); price/pack from the entity.
function resolve(sourceKey, commercials) {
  const b = build(sourceKey); if (!b) return null;
  const com = commercials || {};
  b.items = b.items.map((it) => Object.assign({}, it, { commercials: com[it.name] || null }));
  b.adopted = Object.keys(com).length;
  return b;
}

module.exports = { getSource, listSources, build, resolve, VERSION: 'v1' };
