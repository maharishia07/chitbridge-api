// @stage tested
// @stage-note The jurisdiction's tax slabs, served to every entity in it as read-only governance definitions.
'use strict';
/* OWNS the tax slabs a COUNTRY declares and the jurisdiction an identity row names (no country -> no jurisdiction -> no slabs, said in NO_COUNTRY_SLABS_SAY)
 * CALLED BY lib/tax-shelf (readShelf), routes/definitions (the list, the read, the pick)
 * FLOW identities.country -> jurisdiction -> region_layer.jurisdiction.tax -> governed slab rows (frozenCopy when a chit cites one)
 * CARD 15-tax-and-country-packs/country-packs-jurisdiction */
/**
 * tax-governance.js — the slabs a COUNTRY declares, not the ones an entity types.
 *
 * Athi, 2026-09-04: *"if we know very well that this is the way taxation works in every country, we have already a
 * governance layer where we have to create those and inherit here, why each entity should create one for them …
 * otherwise it has to come from governance layer and across the country."*
 *
 * ── WHERE THEY LIVE ──────────────────────────────────────────────────────────────────────────────────────────
 * `region_layer.jurisdiction` (b81) — the regional layer keyed by country, no RLS, resolved per entity through
 * `identities.country` exactly as currency already is (lib/regional.js). A slab published there is a FACT OF THE
 * JURISDICTION; a slab an entity authors as a `definition` row is a DECLARATION (an exception). The product page,
 * the category and the catalogue default pick from both; the resolver does not care which kind answered.
 *
 * ── THE SHAPE ────────────────────────────────────────────────────────────────────────────────────────────────
 *   jurisdiction.tax = { scheme:'GST', authority:'CBIC', since:'2017-07-01',
 *                       slabs:[ { id:'IN-GST-18', name:'GST 18%', rate:18, cess:0, effective_from:'2017-07-01', note } … ] }
 * Served as definition-shaped rows so every reader that already handles `kind:'tax'` needs no second code path:
 *   { definition_id:'IN-GST-18', entity_id:null, kind:'tax', sub_kind:'gst_slab', name, status:'live',
 *     current_version:1, rules:{rate, cess, effective_from, scheme}, governance:{jurisdiction, scheme, authority} }
 *
 * ⚠️ A GOVERNED ID IS NOT A UUID — `IN-GST-18` — on purpose. It cannot collide with a definition row, it reads on a
 * chit line without a lookup, and any write path that casts to uuid refuses it by construction. The routes still
 * check `isGovernedId` first so the refusal is a sentence, not a 22P02.
 *
 * ⚠️ STILL NOT A RATE TABLE IN CODE. This file ships NO rates. The rates are DATA in region_layer, put there by a
 * migration a person reads and runs, and changed the same way — which is what makes them governance, not a
 * constant somebody forgot. lib/tax.js's rule stands.
 *
 * ── ZERO DEPENDENCIES · TIER A (the DB read is injected) ─────────────────────────────────────────────────────
 */

const GOVERNED_ID = /^[A-Z]{2}-[A-Z0-9]+(-[A-Z0-9.]+)+$/; // <country>-<scheme>-<key…>, e.g. IN-GST-18 · IN-GST-CESS-12
/** TAX01-5: a number, or null. Number(null), Number(''), Number(' ') and Number([]) are all 0: a missing rate read as a live 0% slab. Only a number or a non-blank numeric string counts. */
const num = (v) => {
  if (typeof v !== 'number' && !(typeof v === 'string' && v.trim() !== '')) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Is this definition id one the jurisdiction owns (as opposed to an entity's uuid)? */
function isGovernedId(id) {
  return GOVERNED_ID.test(String(id || ''));
}

/**
 * slabsFromLayer(layer, jurisdiction) → definition-shaped rows, live, read-only.
 * Tolerant: a layer with no `tax`, no `slabs`, or a slab with no numeric rate yields nothing for that slab — a
 * governance slab without a rate would be exactly the silent nil the resolver refuses to invent.
 */
function slabsFromLayer(layer, jurisdiction) {
  return onPackMenu(rawSlabsFromLayer(layer, jurisdiction), layer, jurisdiction);
}
/** TAX01-5: the ids of the layer's slabs that carry NO usable rate — skipped by slabsFromLayer, and said by name (a "rate missing" state), never served as 0% */
function unratedSlabs(layer) {
  const t = layer && layer.jurisdiction && typeof layer.jurisdiction === 'object' && layer.jurisdiction.tax && typeof layer.jurisdiction.tax === 'object' ? layer.jurisdiction.tax : null;
  return t && Array.isArray(t.slabs) ? t.slabs.filter((s) => s && s.id && num(s.rate) === null).map((s) => String(s.id)) : [];
}
/** one layer slab as a governed definition row, its rate, cess, date, scheme and hsn read off the slab (t = the layer's tax block) */
function layerSlabRow(slab, rate, taxBlock, scheme, juris) {
  const from = slab.effective_from || taxBlock.since || null;
  return {
    definition_id: String(slab.id),
    entity_id: null,
    kind: 'tax',
    sub_kind: 'gst_slab',
    name: String(slab.name || scheme + ' ' + rate + '%'),
    note: slab.note || null,
    status: 'live',
    current_version: 1,
    created_at: from,
    updated_at: from,
    rules: {
      rate,
      cess: num(slab.cess) || 0,
      effective_from: from,
      scheme,
      hsn: Array.isArray(slab.hsn) ? slab.hsn.map(String) : []
    },
    governance: { jurisdiction: juris, scheme, authority: taxBlock.authority || null }
  };
}
/** the layer's jurisdiction.tax block when it is an object, else null */
function taxBlockOf(layer) {
  const j = layer && layer.jurisdiction && typeof layer.jurisdiction === 'object' ? layer.jurisdiction : {};
  return j.tax && typeof j.tax === 'object' ? j.tax : null;
}
/** every slab of the layer that carries a usable rate, as a governance definition row (unrated ones are skipped: see unratedSlabs) */
function rawSlabsFromLayer(layer, jurisdiction) {
  const t = taxBlockOf(layer);
  if (!t || !Array.isArray(t.slabs)) return [];
  const juris = String(jurisdiction || layer.region_code || '').toUpperCase();
  const scheme = String(t.scheme || '').toUpperCase();
  const out = [];
  for (const s of t.slabs) {
    if (!s || !s.id) continue;
    const rate = num(s.rate);
    if (rate === null) continue;
    out.push(layerSlabRow(s, rate, t, scheme, juris));
  }
  return out;
}

/** a rate the pack's dated menu names that the layer does not hold: a live slab row with the id <country>-<scheme>-<rate> and the pack's citation as its note */
function packMenuRow(juris, scheme, rate, from, cite, authority) {
  return {
    definition_id: juris + '-' + scheme + '-' + rate,
    entity_id: null,
    kind: 'tax',
    sub_kind: 'gst_slab',
    name: scheme + ' ' + rate + '%',
    note: cite || null,
    status: 'live',
    current_version: 1,
    created_at: from,
    updated_at: from,
    rules: { rate, cess: 0, effective_from: from, scheme, hsn: [] },
    governance: { jurisdiction: juris, scheme, authority }
  };
}
/** the country pack and its menu in force today when the pack DATES its rate menu under this scheme, else null (a pack with no dated menu leaves the layer's list alone) */
function datedMenuOf(juris, scheme) {
  const packs = require('./tax-packs');
  const pack = juris && scheme ? packs.packFor(juris) : null;
  if (!pack || !Array.isArray(pack.rate_menu) || !pack.rate_menu.length || String(pack.scheme || '').toUpperCase() !== scheme) return null;
  const menu = packs.menuAsOf(pack);
  return menu && Array.isArray(menu.rates) ? { pack, menu } : null;
}
/**
 * ⭐ IN-F-04 (walk IN 21 Nov): ONE RATE LIST PER COUNTRY, THE PACK'S. When the country's tax pack DATES its menu (India: tax-packs.menuAsOf, the rows of rate_menu with their
 * notification), the slabs served here are exactly the rates of the menu in force: a rate the law ended (12, 28 on 22 Sep 2025) is no longer offered, and a rate the pack names (40, 3,
 * 0.25, 1.5) is, even if region_layer was seeded before it. A layer row of the same rate keeps its id, name, note and hsn (a bill that cites IN-GST-18 still resolves); a rate the
 * layer does not hold gets the id <country>-<scheme>-<rate> and the pack's own citation as its note. A pack with no dated menu (AU, AE) leaves the layer's list as it is.
 * No rate is written in this file: they are read from the pack, whose rows each carry their source and effective date.
 */
function onPackMenu(rows, layer, jurisdiction) {
  const taxBlock = layer && layer.jurisdiction && layer.jurisdiction.tax;
  const juris = String(jurisdiction || (layer && layer.region_code) || '').toUpperCase();
  const scheme = String((taxBlock && taxBlock.scheme) || '').toUpperCase();
  const dated = datedMenuOf(juris, scheme);
  if (!dated) return rows;
  const { pack, menu } = dated;
  const authority = taxBlock.authority || null;
  return menu.rates.map((rate) => {
    const held = rows.find((row) => row.rules.rate === rate);
    if (held) return held;
    const first = pack.rate_menu.find((row) => row.rates.indexOf(rate) >= 0);
    const from = first ? first.from : menu.from;
    return packMenuRow(juris, scheme, rate, from, menu.cite, authority);
  });
}

/**
 * frozenCopy(row, at) → what a chit keeps of a governed slab. There is no definition_version to point at, so the
 * copy IS the record: id, the jurisdiction's own version key (effective_from), and the rules by value.
 */
function frozenCopy(row, at) {
  return {
    definition_id: row.definition_id,
    version: String((row.rules && row.rules.effective_from) || '1'),
    kind: row.kind,
    sub_kind: row.sub_kind,
    name: row.name,
    rules: row.rules,
    frozen_at: at,
    governance: row.governance || null
  };
}

/**
 * jurisdictionFor(entityId, { query }) → 'IN' | … | null.
 * `identities.country` when set; otherwise null. N1 (NEUTRAL-CORE, 2026-10-17): an entity with no country inherits NO slabs and is told so
 * (NO_COUNTRY_SLABS_SAY) - neither an empty currency nor INR stands in for India any more.
 */
async function jurisdictionFor(entityId, deps) {
  if (!entityId || !deps || typeof deps.query !== 'function') return null;
  try {
    const r = await deps.query('SELECT country, currency_code FROM identities WHERE identity_id = $1', [entityId]);
    const row = r.rows && r.rows[0];
    if (!row) return null;
    if (row.country) return String(row.country).trim().toUpperCase();
  } catch (_) {
    /* no identity → no jurisdiction */
  }
  return null;
}

/** governedSlabsFor(entityId, { query, regionLayer }) → rows, [] when the entity has no jurisdiction or it declares none. */
/** jurisdictionOf(identityRow) → 'IN' | 'DE' | … | null — the pure half of jurisdictionFor (one row in, one code out). */
function jurisdictionOf(row) {
  if (!row) return null;
  if (row.country) return String(row.country).trim().toUpperCase();
  return null;
}
/** governedFromRows(juris, layer, inLayer) → rows — the pure half of governedSlabsFor, for a caller that already holds the layers. */
function governedFromRows(juris, layer, inLayer) {
  if (!juris) return [];
  let rows = layer ? slabsFromLayer(layer, juris) : [];
  if (!rows.length && layer && String(layer.currency || '').toUpperCase() === 'INR' && juris !== 'IN') rows = inLayer ? slabsFromLayer(inLayer, 'IN') : [];
  return rows;
}
async function governedSlabsFor(entityId, deps) {
  const juris = await jurisdictionFor(entityId, deps);
  if (!juris || !deps || typeof deps.regionLayer !== 'function') return [];
  let layer = null;
  try {
    layer = await deps.regionLayer(juris);
  } catch (_) {
    layer = null;
  }
  let rows = layer ? slabsFromLayer(layer, juris) : [];
  const unrated = unratedSlabs(layer);
  if (unrated.length && typeof deps.onUnrated === 'function') deps.onUnrated(unrated, juris); /* TAX01-5: rate missing, said */
  /* ⚠️ A SUB-REGION OF INDIA IS STILL UNDER GST. region_layer carries TN and HI beside IN (Athi's dry-run, 2026-09-04),
     each INR, each without a tax block of its own. GST is one law for the whole country, so an INR region that
     declares no tax inherits India's — the same tax, keyed IN-GST-*, and the split still turns on the state. */
  if (!rows.length && layer && String(layer.currency || '').toUpperCase() === 'INR' && juris !== 'IN') {
    let inLayer = null;
    try {
      inLayer = await deps.regionLayer('IN');
    } catch (_) {
      inLayer = null;
    }
    rows = inLayer ? slabsFromLayer(inLayer, 'IN') : [];
  }
  return rows;
}

/** N1: the ONE sentence for a shop with no country - it inherits no tax slabs until it says where it trades */
const NO_COUNTRY_SLABS_SAY = 'No tax slabs yet \u2014 set the shop\u2019s country (Settings \u2192 Country setup) and its slabs appear.';

module.exports = {
  NO_COUNTRY_SLABS_SAY,
  GOVERNED_ID,
  isGovernedId,
  slabsFromLayer,
  unratedSlabs,
  frozenCopy,
  jurisdictionFor,
  jurisdictionOf,
  governedFromRows,
  governedSlabsFor
};
