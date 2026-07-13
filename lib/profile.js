// lib/profile.js — the ENTITY TRADE PROFILE. Makes Trade-ready individual-specific: the entity's declared trade mode,
// markets, sectors and ADOPTED voluntary certs drive exactly which standards apply to IT. Required = MANDATORY (derived,
// regulatory: voluntary=false) ∪ ADOPTED (voluntary certs the entity opted into). Plus resolvePath — the forward roadmap
// (which markets you could reach next, and what to add). Reuses the readiness engine. WITH RLS via withEntity.
// See SPEC-entity-profile.md.
const { withEntity, query } = require('../db');
const readiness = require('./readiness');

const DEFAULT = { trade_mode: 'domestic', markets: [], sectors: [], adopted: [] };

// ── TRADE DOCUMENTS VAULT (b100) — the recurring inputs, gathered ONCE, that pre-fill authority forms. The schema below
// is the whitelist (groups → allowed field keys); anything else in the payload is ignored. `verify` marks IDs that can be
// checked at source (reuse the KYB/verify layer). This is the "know what to gather, gather that way" store. ──
const VAULT_SCHEMA = {
  identity:      { label: 'Business identity',  fields: ['legal_name', 'trade_name', 'address', 'city', 'state', 'pincode', 'country', 'email', 'phone'] },
  signatory:     { label: 'Authorised signatory', fields: ['name', 'designation'] },
  registrations: { label: 'Registrations',      fields: ['gstin', 'pan', 'iec', 'ad_code', 'lut'], verify: ['gstin', 'pan', 'iec'] },
  banking:       { label: 'Banking',            fields: ['bank_name', 'account_no', 'ifsc', 'swift', 'ad_branch'] },
  logistics:     { label: 'Logistics defaults', fields: ['port_loading', 'incoterm', 'mode'] },
};

// keep only known groups/keys, coerce to string, trim — never trust the raw payload shape
function sanitizeVault(v) {
  const out = {};
  if (!v || typeof v !== 'object') return out;
  for (const g of Object.keys(VAULT_SCHEMA)) {
    const src = v[g]; if (!src || typeof src !== 'object') continue;
    const grp = {};
    for (const k of VAULT_SCHEMA[g].fields) {
      if (src[k] != null && String(src[k]).trim() !== '') grp[k] = String(src[k]).trim().slice(0, 240);
    }
    if (Object.keys(grp).length) out[g] = grp;
  }
  return out;
}

async function getVault(entity_id) {
  try {
    const r = await withEntity(entity_id, (c) => c.query('SELECT vault FROM entity_profile WHERE entity_id = $1', [entity_id]));
    return (r.rows[0] && r.rows[0].vault) || {};
  } catch (_) { return {}; }   // pre-b100 (column missing) → empty, non-fatal
}
async function saveVault(entity_id, v) {
  const vault = sanitizeVault(v);
  try {
    await withEntity(entity_id, (c) => c.query(
      `INSERT INTO entity_profile (entity_id, vault, updated_at) VALUES ($1,$2,now())
       ON CONFLICT (entity_id) DO UPDATE SET vault=EXCLUDED.vault, updated_at=now()`,
      [entity_id, JSON.stringify(vault)]));
  } catch (e) {
    // F6 (reviewer 2026-07-13): don't blanket-503. Only the actual "column/table missing" (pre-b100) is a 503;
    // a permission error / constraint / RLS denial / connection drop must surface as itself, not be masked.
    if (e && (e.code === '42703' || e.code === '42P01')) {   // undefined_column / undefined_table
      const err = new Error('Trade vault not migrated yet (b100).'); err.status = 503; err.code = 'VAULT_STORE_MISSING'; throw err;
    }
    throw e;   // real error → route's safeErr keeps it generic for 5xx, but it's logged, not hidden
  }
  return { vault };
}

async function getProfile(entity_id) {
  const base = { ...DEFAULT };
  try {
    const r = await withEntity(entity_id, (c) => c.query(
      'SELECT trade_mode, markets, sectors, adopted FROM entity_profile WHERE entity_id = $1', [entity_id]));
    if (r.rows[0]) { base.trade_mode = r.rows[0].trade_mode; base.markets = r.rows[0].markets || []; base.sectors = r.rows[0].sectors || []; base.adopted = r.rows[0].adopted || []; }
  } catch (_) {}   // pre-b96 → default
  base.vault = await getVault(entity_id);      // separate guarded read → unaffected if b100 not run
  return base;
}
async function saveProfile(entity_id, p) {
  const trade_mode = p && p.trade_mode === 'export' ? 'export' : 'domestic';
  const markets = Array.isArray(p && p.markets) ? p.markets : [];
  const sectors = Array.isArray(p && p.sectors) ? p.sectors : [];
  const adopted = Array.isArray(p && p.adopted) ? p.adopted : [];
  await withEntity(entity_id, (c) => c.query(
    `INSERT INTO entity_profile (entity_id, trade_mode, markets, sectors, adopted, updated_at)
     VALUES ($1,$2,$3,$4,$5, now())
     ON CONFLICT (entity_id) DO UPDATE SET trade_mode=EXCLUDED.trade_mode, markets=EXCLUDED.markets,
       sectors=EXCLUDED.sectors, adopted=EXCLUDED.adopted, updated_at=now()`,
    [entity_id, trade_mode, markets, sectors, adopted]));
  return getProfile(entity_id);
}

async function voluntaryMap() {
  try { const r = await query('SELECT standard_key, voluntary FROM standard_source'); const m = {}; r.rows.forEach(x => { m[x.standard_key] = x.voluntary; }); return m; }
  catch (_) { return {}; }
}
function summ(items) {
  const met = items.filter(i => i.status === 'gathered' || i.status === 'expiring').length;
  return { total: items.length, met, pending: items.length - met, percent: items.length ? Math.round((met / items.length) * 100) : 0,
    ready: items.length > 0 && met === items.length,
    verified: items.filter(i => i.rung === 'verified').length, adopted: items.filter(i => i.tier === 'adopted').length, mandatory: items.filter(i => i.tier === 'mandatory').length };
}

// resolveProfileReadiness(entity) → the entity's OWN required set (mandatory ∪ adopted), across its markets & sectors.
async function resolveProfileReadiness(entity_id) {
  const p = await getProfile(entity_id);
  const vol = await voluntaryMap();
  const sectors = p.sectors.length ? p.sectors : ['paint'];
  const markets = p.trade_mode === 'export' ? (p.markets.length ? p.markets : ['EU']) : ['IN'];
  const origin = 'IN';
  const byKey = {};
  for (const sector of sectors) {
    for (const market of markets) {
      const rd = await readiness.resolveForDestination(entity_id, market, sector, origin);
      for (const it of (rd.clearances || [])) { const k = it.standard + '|' + it.doc; if (!byKey[k]) byKey[k] = it; }
    }
  }
  // mandatory (regulatory) always in; a VOLUNTARY standard is in only if the entity ADOPTED it.
  const items = Object.values(byKey)
    .filter(it => { const v = !!vol[it.standard]; return v ? p.adopted.indexOf(it.standard) >= 0 : true; })
    .map(it => ({ ...it, tier: vol[it.standard] ? 'adopted' : 'mandatory' }));
  return { profile: p, clearances: items, summary: summ(items) };
}

// resolvePath(entity) → the forward roadmap: readiness per destination + the standards to add, with current markets marked.
async function resolvePath(entity_id) {
  const p = await getProfile(entity_id);
  const vol = await voluntaryMap();
  const sector = (p.sectors[0]) || 'paint';
  const matrix = await readiness.resolveLaneMatrix(entity_id, sector, 'IN');
  const current = new Set(p.trade_mode === 'export' ? p.markets : ['IN']);
  const lanes = (matrix.lanes || []).map(l => ({ ...l, in_profile: current.has(l.dest_key) }));
  return { profile: p, sector, lanes, adoptable: Object.keys(vol).filter(k => vol[k] && p.adopted.indexOf(k) < 0) };
}

module.exports = { getProfile, saveProfile, getVault, saveVault, resolveProfileReadiness, resolvePath, VAULT_SCHEMA };
