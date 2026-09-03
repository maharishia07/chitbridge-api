// @stage tested
// @stage-note The jurisdiction's tax slabs, served to every entity in it as read-only governance definitions.
'use strict';
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

const GOVERNED_ID = /^[A-Z]{2}-[A-Z0-9]+(-[A-Z0-9.]+)+$/;   // <country>-<scheme>-<key…>, e.g. IN-GST-18 · IN-GST-CESS-12
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };

/** Is this definition id one the jurisdiction owns (as opposed to an entity's uuid)? */
function isGovernedId(id) { return GOVERNED_ID.test(String(id || '')); }

/**
 * slabsFromLayer(layer, jurisdiction) → definition-shaped rows, live, read-only.
 * Tolerant: a layer with no `tax`, no `slabs`, or a slab with no numeric rate yields nothing for that slab — a
 * governance slab without a rate would be exactly the silent nil the resolver refuses to invent.
 */
function slabsFromLayer(layer, jurisdiction) {
  const j = (layer && layer.jurisdiction && typeof layer.jurisdiction === 'object') ? layer.jurisdiction : {};
  const t = (j.tax && typeof j.tax === 'object') ? j.tax : null;
  if (!t || !Array.isArray(t.slabs)) return [];
  const juris = String(jurisdiction || layer.region_code || '').toUpperCase();
  const scheme = String(t.scheme || '').toUpperCase();
  const out = [];
  for (const s of t.slabs) {
    if (!s || !s.id) continue;
    const rate = num(s.rate);
    if (rate === null) continue;
    out.push({
      definition_id: String(s.id),
      entity_id: null,
      kind: 'tax',
      sub_kind: 'gst_slab',
      name: String(s.name || (scheme + ' ' + rate + '%')),
      note: s.note || null,
      status: 'live',
      current_version: 1,
      created_at: s.effective_from || t.since || null,
      updated_at: s.effective_from || t.since || null,
      rules: { rate, cess: num(s.cess) === null ? 0 : num(s.cess), effective_from: s.effective_from || t.since || null,
               scheme, hsn: Array.isArray(s.hsn) ? s.hsn.map(String) : [] },
      governance: { jurisdiction: juris, scheme, authority: t.authority || null },
    });
  }
  return out;
}

/**
 * frozenCopy(row, at) → what a chit keeps of a governed slab. There is no definition_version to point at, so the
 * copy IS the record: id, the jurisdiction's own version key (effective_from), and the rules by value.
 */
function frozenCopy(row, at) {
  return { definition_id: row.definition_id, version: String((row.rules && row.rules.effective_from) || '1'),
           kind: row.kind, sub_kind: row.sub_kind, name: row.name, rules: row.rules, frozen_at: at,
           governance: row.governance || null };
}

/**
 * jurisdictionFor(entityId, { query }) → 'IN' | … | null.
 * `identities.country` when set; otherwise the currency's country for the one case we can infer without guessing
 * (INR is India's alone). Anything else is null — an entity with no country inherits no slabs and is told so.
 */
async function jurisdictionFor(entityId, deps) {
  if (!entityId || !deps || typeof deps.query !== 'function') return null;
  try {
    const r = await deps.query('SELECT country, currency_code FROM identities WHERE identity_id = $1', [entityId]);
    const row = r.rows && r.rows[0];
    if (!row) return null;
    if (row.country) return String(row.country).trim().toUpperCase();
    /* ⚠️ THE SAME FALLBACK regional.currencyFor USES. An entity with no country and no currency is treated as INR
       there (FALLBACK_CURRENCY), so it is India here too — [TAX-02] skipped on a fresh entity because this line
       once required an explicit INR. Two readers of one row must not disagree about what "unset" means. */
    const cur = String(row.currency_code || '').trim().toUpperCase();
    if (!cur || cur === 'INR') return 'IN';
  } catch (_) { /* no identity → no jurisdiction */ }
  return null;
}

/** governedSlabsFor(entityId, { query, regionLayer }) → rows, [] when the entity has no jurisdiction or it declares none. */
async function governedSlabsFor(entityId, deps) {
  const juris = await jurisdictionFor(entityId, deps);
  if (!juris || !deps || typeof deps.regionLayer !== 'function') return [];
  let layer = null;
  try { layer = await deps.regionLayer(juris); } catch (_) { layer = null; }
  let rows = layer ? slabsFromLayer(layer, juris) : [];
  /* ⚠️ A SUB-REGION OF INDIA IS STILL UNDER GST. region_layer carries TN and HI beside IN (Athi's dry-run, 2026-09-04),
     each INR, each without a tax block of its own. GST is one law for the whole country, so an INR region that
     declares no tax inherits India's — the same tax, keyed IN-GST-*, and the split still turns on the state. */
  if (!rows.length && layer && String(layer.currency || '').toUpperCase() === 'INR' && juris !== 'IN') {
    let inLayer = null;
    try { inLayer = await deps.regionLayer('IN'); } catch (_) { inLayer = null; }
    rows = inLayer ? slabsFromLayer(inLayer, 'IN') : [];
  }
  return rows;
}

module.exports = { GOVERNED_ID, isGovernedId, slabsFromLayer, frozenCopy, jurisdictionFor, governedSlabsFor };
