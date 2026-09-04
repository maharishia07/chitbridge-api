// lib/profile.js — the ENTITY TRADE PROFILE. Makes Trade-ready individual-specific: the entity's declared trade mode,
// markets, sectors and ADOPTED voluntary certs drive exactly which standards apply to IT. Required = MANDATORY (derived,
// regulatory: voluntary=false) ∪ ADOPTED (voluntary certs the entity opted into). Plus resolvePath — the forward roadmap
// (which markets you could reach next, and what to add). Reuses the readiness engine. WITH RLS via withEntity.
// See SPEC-entity-profile.md.
const { withEntity, query, readBatch } = require('../db');
const readiness = require('./readiness');
const vaultcrypto = require('./vaultcrypto');   // F1 — vault stored encrypted (AES-256-GCM, key in env, never in DB)

const DEFAULT = { trade_mode: 'domestic', markets: [], sectors: [], adopted: [] };

// ── TRADE DOCUMENTS VAULT (b100) — the recurring inputs, gathered ONCE, that pre-fill authority forms. ──
//
// ⭐⭐ REBUILT 2026-08-16 AS REPEATABLE SECTIONS OF FREE ROWS (Athi: *"add the name of the details and then the
// value as well, so we don't need to look at the entire world... we give option like bank, licence details and so
// on, let them add more rows if they want to"*).
//
// ⚠️ WHY THE FIXED FIELD LIST HAD TO GO: every registration key it whitelisted — gstin · pan · iec · ad_code ·
// lut · ifsc · pincode — is INDIAN. A German supplier has USt-IdNr and IBAN; a US one has EIN and a routing
// number; neither had anywhere to put them. A whitelist means every new jurisdiction is a code change, which
// never converges. The user naming their own rows is universal by construction and costs nothing to maintain.
//
// ⚠️ WHAT WE GIVE UP, AND HOW IT IS BOUGHT BACK: the vault exists to PRE-FILL authority forms, and pre-filling is
// a machine matching a form field to a row. Free-text names break that — "IEC" / "iec no" / "Import Export Code"
// are one thing to a human and three to a matcher. So a row may carry an OPTIONAL `tag`: a stable key set when
// the user picks a suggested name, absent when they type their own. Pre-fill and verification read the tag; the
// row stores and displays either way. The standard is an index over the user's data, never a gate in front of it.
//
// ⚠️ NO SQL MIGRATION: `vault` is one jsonb column holding an encrypted envelope, so the shape lives inside the
// ciphertext. Old group-shaped payloads are converted on READ (see legacyToSections) — nothing is stranded.
const SECTION_TYPES = {
  identity:  'Business identity',
  signatory: 'Authorised signatory',
  bank:      'Bank',
  licence:   'Licence & registration',
  logistics: 'Logistics defaults',
  other:     'Other details',
};
// ⚠️ CAPS, NOT A WHITELIST. Free-form input still has to be bounded — an unbounded payload is a storage and a
// decrypt-cost problem regardless of how legitimate its contents are. Bound the SHAPE; leave the meaning open.
const VAULT_LIMITS = { sections: 40, rows: 40, name: 80, value: 240, label: 80, tag: 40 };

// Tags we recognise at source (reuse the KYB/verify layer). ⚠️ This list makes a row VERIFIABLE — it never makes
// a row ALLOWED. A row with an unknown tag, or no tag, is stored exactly the same; it simply cannot be checked.
const VERIFIABLE_TAGS = ['gstin', 'pan', 'iec', 'lei'];

const _s = (x, n) => String(x == null ? '' : x).trim().slice(0, n);

// keep the shape, bound the size, drop empties — never trust the raw payload
function sanitizeVault(v) {
  if (!v || typeof v !== 'object') return { sections: [] };
  const src = Array.isArray(v.sections) ? v.sections : legacyToSections(v);
  const sections = [];
  for (const sec of src.slice(0, VAULT_LIMITS.sections)) {
    if (!sec || typeof sec !== 'object') continue;
    const type = SECTION_TYPES[sec.type] ? sec.type : 'other';
    const rows = [];
    for (const r of (Array.isArray(sec.rows) ? sec.rows : []).slice(0, VAULT_LIMITS.rows)) {
      if (!r || typeof r !== 'object') continue;
      const name = _s(r.name, VAULT_LIMITS.name), value = _s(r.value, VAULT_LIMITS.value);
      // ⚠️ A row needs a VALUE to be worth storing, but not a name — a value under a section the user has
      // labelled is still meaningful. A name with no value is an empty box they opened and did not fill.
      if (!value) continue;
      const row = { name, value };
      const tag = _s(r.tag, VAULT_LIMITS.tag).toLowerCase(); if (tag) row.tag = tag;
      rows.push(row);
    }
    if (rows.length) sections.push({ type, label: _s(sec.label, VAULT_LIMITS.label), rows });
  }
  return { sections };
}

// ── b100 → 2026-08-16 shape. Converted on read so existing vaults keep working with no migration and no data
// loss; the legacy key becomes the row's TAG, so anything already gathered stays verifiable and pre-fillable. ──
const LEGACY_GROUPS = { identity: 'identity', signatory: 'signatory', registrations: 'licence', banking: 'bank', logistics: 'logistics' };
const LEGACY_LABELS = {
  legal_name: 'Legal name', trade_name: 'Trade / brand name', address: 'Address', city: 'City', state: 'State',
  pincode: 'PIN / ZIP', country: 'Country', email: 'Email', phone: 'Phone',
  name: 'Name', designation: 'Designation',
  gstin: 'GSTIN', pan: 'PAN', iec: 'IEC', ad_code: 'AD code', lut: 'LUT',
  bank_name: 'Bank name', account_no: 'Account no.', ifsc: 'IFSC', swift: 'SWIFT / BIC', ad_branch: 'AD branch',
  port_loading: 'Port of loading', incoterm: 'Preferred Incoterm', mode: 'Mode',
};
function legacyToSections(v) {
  const out = [];
  for (const g of Object.keys(LEGACY_GROUPS)) {
    const grp = v[g]; if (!grp || typeof grp !== 'object') continue;
    const rows = Object.keys(grp)
      .filter((k) => String(grp[k] || '').trim() !== '')
      .map((k) => ({ name: LEGACY_LABELS[k] || k, value: String(grp[k]), tag: k }));
    if (rows.length) out.push({ type: LEGACY_GROUPS[g], label: '', rows });
  }
  return out;
}

async function getVault(entity_id) {
  try {
    const r = await withEntity(entity_id, (c) => c.query('SELECT vault FROM entity_profile WHERE entity_id = $1', [entity_id]));
    const raw = vaultcrypto.decryptVault((r.rows[0] && r.rows[0].vault) || null);   // stored = ciphertext envelope → decrypt (F1)
    /* ⚠️ NORMALISE ON READ. A vault written before 2026-08-16 is group-shaped; sanitizeVault converts it via
       legacyToSections, so callers only ever see {sections}. Nothing is rewritten in the database — the old
       ciphertext stands until the user next saves, which is what makes this shape change migration-free. */
    return sanitizeVault(raw);
  } catch (_) { return {}; }   // pre-b100 (column missing) → empty, non-fatal
}
async function saveVault(entity_id, v) {
  const vault = sanitizeVault(v);
  const envelope = vaultcrypto.encryptVault(vault);   // F1 — throws 503 VAULT_ENC_UNCONFIGURED if no key → fail closed (never store plaintext)
  try {
    await withEntity(entity_id, (c) => c.query(
      `INSERT INTO entity_profile (entity_id, vault, updated_at) VALUES ($1,$2,now())
       ON CONFLICT (entity_id) DO UPDATE SET vault=EXCLUDED.vault, updated_at=now()`,
      [entity_id, JSON.stringify(envelope)]));
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
    /* ⭐ ONE network round trip (db.readBatch); the transaction path stays as the fallback. */
    const sql = 'SELECT trade_mode, markets, sectors, adopted FROM entity_profile WHERE entity_id = $1';
    let r;
    try { r = (await readBatch(entity_id, null, [{ text: sql, params: [entity_id] }]))[0]; }
    catch (_) { r = await withEntity(entity_id, (c) => c.query(sql, [entity_id])); }
    if (r.rows[0]) { base.trade_mode = r.rows[0].trade_mode; base.markets = r.rows[0].markets || []; base.sectors = r.rows[0].sectors || []; base.adopted = r.rows[0].adopted || []; }
  } catch (_) {}   // pre-b96 → default
  base.vault = await getVault(entity_id);      // separate guarded read → unaffected if b100 not run
  try { base.invoice_party = await invoiceParty(entity_id); } catch (_) { base.invoice_party = null; }   /* the Invoice row's supplier block */
  base.vault_encrypted = vaultcrypto.isConfigured();   // F1 — UI warns + refuses real data when encryption isn't configured
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

/**
 * ⭐ invoiceParty — the supplier block of a tax invoice, and what is MISSING for it. Athi, 2026-09-04: "invoice needs to
 * bring the shop name, GSTN, address, phone number and so on — see where those details are; if not, provide provision
 * to add it in profile and bring it; and that has to be tied with trade ready".
 * Sources, in precedence: the vault's "Business identity" rows by TAG (legal_name · trade_name · address · city ·
 * state · pincode · country · email · phone) — the same rows the authority forms pre-fill from — then the identities
 * row (display_name · gstn · address · phone · email · country). PAN is derived from the GSTIN (chars 3–12). The
 * required set follows GST Rule 46: name · GSTIN · address · state (from the GSTIN) — phone or email to reach the
 * supplier. Readiness reads the same function, so Trade ready and the Invoice row can never disagree.
 */
const GST_STATES = { '01':'Jammu & Kashmir','02':'Himachal Pradesh','03':'Punjab','04':'Chandigarh','05':'Uttarakhand','06':'Haryana','07':'Delhi','08':'Rajasthan','09':'Uttar Pradesh','10':'Bihar','11':'Sikkim','12':'Arunachal Pradesh','13':'Nagaland','14':'Manipur','15':'Mizoram','16':'Tripura','17':'Meghalaya','18':'Assam','19':'West Bengal','20':'Jharkhand','21':'Odisha','22':'Chhattisgarh','23':'Madhya Pradesh','24':'Gujarat','26':'Dadra & Nagar Haveli and Daman & Diu','27':'Maharashtra','29':'Karnataka','30':'Goa','31':'Lakshadweep','32':'Kerala','33':'Tamil Nadu','34':'Puducherry','35':'Andaman & Nicobar','36':'Telangana','37':'Andhra Pradesh','38':'Ladakh','97':'Other Territory' };
async function invoiceParty(entity_id) {
  const { query } = require('../db');
  const r = await query('SELECT display_name, gstn, address, phone, email, country, currency_code FROM identities WHERE identity_id = $1', [entity_id]);
  const me = r.rows[0] || {};
  let vault = { sections: [] };
  try { vault = await getVault(entity_id); } catch (_) {}
  const tag = {};
  for (const sec of (vault.sections || [])) {
    if (sec.type !== 'identity') continue;
    for (const row of (sec.rows || [])) if (row.tag && row.value && tag[row.tag] === undefined) tag[row.tag] = String(row.value).trim();
  }
  const gstin = String(tag.gstin || me.gstn || '').trim().toUpperCase();
  const stateCode = /^d{2}/.test(gstin) ? gstin.slice(0, 2) : (tag.state_code || null);
  const party = {
    legal_name: tag.legal_name || null,
    trade_name: tag.trade_name || me.display_name || null,
    name: tag.legal_name || me.display_name || null,
    gstin: gstin || null,
    pan: /^d{2}[A-Z]{5}d{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(gstin) ? gstin.slice(2, 12) : (tag.pan || null),
    address: tag.address || me.address || null,
    city: tag.city || null, state: tag.state || (stateCode ? GST_STATES[stateCode] || null : null), state_code: stateCode,
    pincode: tag.pincode || null, country: tag.country || me.country || null,
    phone: tag.phone || me.phone || null, email: tag.email || me.email || null,
    currency: me.currency_code || 'INR',
  };
  const missing = [];
  if (!party.name) missing.push('name');
  if (!party.gstin) missing.push('gstin');
  if (!party.address) missing.push('address');
  if (!party.state) missing.push('state');
  if (!party.phone && !party.email) missing.push('phone or email');
  party.missing = missing; party.complete = missing.length === 0;
  party.fix = 'Settings › Documents › Business identity (legal name · address · city · state · PIN · phone · email), GSTIN on Profile';
  return party;
}
module.exports = { getProfile, saveProfile, getVault, saveVault, resolveProfileReadiness, resolvePath, SECTION_TYPES, VERIFIABLE_TAGS, sanitizeVault, invoiceParty, GST_STATES };
