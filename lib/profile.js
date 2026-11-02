// lib/profile.js — the ENTITY TRADE PROFILE.   CARD 28-platform-and-operations/know-your-business
// OWNS the entity profile and its vault (read · save · merge-patch) · CALLED BY routes/governance.js, routes/entities.js, lib/entity-header.js.
// FLOW  getProfile → readVault → sanitizeVault → saveVault (settleRungs → mirrorUpiId → writeVaultRow → mirrorIdentity_) · patchVault (version check → applyVaultPatch → saveVault)
// Makes Trade-ready individual-specific: the entity's declared trade mode,
// markets, sectors and ADOPTED voluntary certs drive exactly which standards apply to IT. Required = MANDATORY (derived,
// regulatory: voluntary=false) ∪ ADOPTED (voluntary certs the entity opted into). Plus resolvePath — the forward roadmap
// (which markets you could reach next, and what to add). Reuses the readiness engine. WITH RLS via withEntity.
// See SPEC-entity-profile.md.
const { withEntity, query, readBatch } = require('../db');
const log = require('./logger');
const readiness = require('./readiness');
const vaultcrypto = require('./vaultcrypto'); // F1 — vault stored encrypted (AES-256-GCM, key in env, never in DB)

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
  identity: 'Business identity',
  signatory: 'Authorised signatory',
  bank: 'Bank',
  licence: 'Licence & registration',
  logistics: 'Logistics defaults',
  other: 'Other details',
  signature:
    'Bill signature' /* SET-WALK1 W27: what prints on the bill — rows by tag (trade_name · legal_name · tax_id · address · phone · email · footer · logo · order · paper), written by CB Settings › Print setup through the merge-patch */
};
// ⚠️ CAPS, NOT A WHITELIST. Free-form input still has to be bounded — an unbounded payload is a storage and a
// decrypt-cost problem regardless of how legitimate its contents are. Bound the SHAPE; leave the meaning open.
const VAULT_LIMITS = { sections: 40, rows: 40, name: 80, value: 240, label: 80, tag: 40 };

// Tags we recognise at source (reuse the KYB/verify layer). ⚠️ This list makes a row VERIFIABLE — it never makes
// a row ALLOWED. A row with an unknown tag, or no tag, is stored exactly the same; it simply cannot be checked.
const VERIFIABLE_TAGS = ['gstin', 'pan', 'iec', 'lei'];

const _s = (x, n) =>
  String(x == null ? '' : x)
    .trim()
    .slice(0, n);

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
      const name = _s(r.name, VAULT_LIMITS.name),
        value = _s(r.value, VAULT_LIMITS.value);
      // ⚠️ A row needs a VALUE to be worth storing, but not a name — a value under a section the user has
      // labelled is still meaningful. A name with no value is an empty box they opened and did not fill.
      if (!value) continue;
      const row = { name, value };
      const tag = _s(r.tag, VAULT_LIMITS.tag).toLowerCase();
      if (tag) row.tag = tag;
      /* ⭐ PROVENANCE RIDES THE ROW (profile-map.js): source · as_of · rung. The rung is PLATFORM-WRITTEN — a client save is
         'declared' unless the same tag+value is already held higher (then the held rung survives the round trip). */
      if (r.source) row.source = _s(r.source, 80);
      if (r.as_of && !isNaN(Date.parse(r.as_of))) row.as_of = new Date(r.as_of).toISOString();
      const rung = String(r.rung || 'declared').toLowerCase();
      row.rung = ['declared', 'copied', 'checked', 'verified'].includes(rung) ? rung : 'declared';
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
  legal_name: 'Legal name',
  trade_name: 'Trade / brand name',
  address: 'Address',
  city: 'City',
  state: 'State',
  pincode: 'PIN / ZIP',
  country: 'Country',
  email: 'Email',
  phone: 'Phone',
  name: 'Name',
  designation: 'Designation',
  gstin: 'GSTIN',
  pan: 'PAN',
  iec: 'IEC',
  ad_code: 'AD code',
  lut: 'LUT',
  bank_name: 'Bank name',
  account_no: 'Account no.',
  ifsc: 'IFSC',
  swift: 'SWIFT / BIC',
  ad_branch: 'AD branch',
  port_loading: 'Port of loading',
  incoterm: 'Preferred Incoterm',
  mode: 'Mode'
};
function legacyToSections(v) {
  const out = [];
  for (const g of Object.keys(LEGACY_GROUPS)) {
    const grp = v[g];
    if (!grp || typeof grp !== 'object') continue;
    const rows = Object.keys(grp)
      .filter((item) => String(grp[item] || '').trim() !== '')
      .map((item) => ({ name: LEGACY_LABELS[item] || item, value: String(grp[item]), tag: item }));
    if (rows.length) out.push({ type: LEGACY_GROUPS[g], label: '', rows });
  }
  return out;
}

/* ⭐ SET-WALK1 · W25: the vault's VERSION is entity_profile.updated_at as whole microseconds (text) — exact across the wire, no
   millisecond rounding of a timestamptz. The GET answers it (vault_version); a save names it; a save over a newer one is refused (409). */
const VERSION_SQL = '(extract(epoch from updated_at) * 1000000)::bigint::text';
/** the held vault with its version: { vault: {sections}, version: '…' | null } — null = no row yet (a first fill needs no version) */
async function readVault(entity_id) {
  try {
    const result = await withEntity(entity_id, (client) =>
      client.query('SELECT vault, ' + VERSION_SQL + ' AS version FROM entity_profile WHERE entity_id = $1', [entity_id])
    );
    const row = result.rows[0] || null;
    const raw = vaultcrypto.decryptVault((row && row.vault) || null); // stored = ciphertext envelope → decrypt (F1)
    /* ⚠️ NORMALISE ON READ. A vault written before 2026-08-16 is group-shaped; sanitizeVault converts it via
       legacyToSections, so callers only ever see {sections}. Nothing is rewritten in the database — the old
       ciphertext stands until the user next saves, which is what makes this shape change migration-free. */
    return { vault: sanitizeVault(raw), version: row && row.version != null ? String(row.version) : null };
  } catch (e) {
    log.fellBack('profile readVault: the read failed — answered with an empty set', e);
    return { vault: {}, version: null };
  } // pre-b100 (column missing) → empty, non-fatal
}
/** the vault alone — its own statement, unchanged (the send goldens pin this SQL text; the version rides only where a save needs it) */
async function getVault(entity_id) {
  try {
    const r = await withEntity(entity_id, (c) => c.query('SELECT vault FROM entity_profile WHERE entity_id = $1', [entity_id]));
    return sanitizeVault(vaultcrypto.decryptVault((r.rows[0] && r.rows[0].vault) || null));
  } catch (e) {
    log.fellBack('profile getVault: the read failed — answered with an empty set', e);
    return {};
  } // pre-b100 (column missing) → empty, non-fatal
}
/** 409 in words: the vault on the server moved since this screen read it */
function vaultChanged() {
  const err = new Error('Changed since you opened it — reload?');
  err.status = 409;
  err.code = 'VAULT_CHANGED';
  err.say = err.message;
  return err;
}
/** the rows the held vault carries, by tag + value — what a save may keep a rung for */
function heldRowsByTagValue(held) {
  const byTagValue = {};
  for (const section of held.sections || []) for (const row of section.rows || []) if (row.tag) byTagValue[row.tag + '\u0000' + row.value] = row;
  return byTagValue;
}
/* ⚠️ A CLIENT CANNOT CLAIM A RUNG. Unless the caller is the platform (opts.trusted — profile sync, verification), every row
   falls to 'declared', except a row whose tag+value the held vault already carries higher: that keeps its rung. */
async function settleRungs(entity_id, vault, opts) {
  let held = {};
  try {
    held = heldRowsByTagValue((opts && opts.held) || (await getVault(entity_id)));
  } catch (e) {
    /* W25: patchVault hands the vault it just read — no second trip */
    log.fellBack('profile saveVault: failed — carried on without it', e);
  }
  for (const section of vault.sections)
    for (const row of section.rows) {
      const heldRow = row.tag ? held[row.tag + '\u0000' + row.value] : null;
      if (heldRow && heldRow.rung) {
        row.rung = heldRow.rung;
        if (heldRow.source) row.source = heldRow.source;
        if (heldRow.as_of) row.as_of = heldRow.as_of;
      } else {
        row.rung = 'declared';
        delete row.source;
        delete row.as_of;
      }
    }
}
/* ⭐ THE ONE ROW THAT IS MEANT TO BE SHOWN (payment loop, level 1): a UPI id is a public payee address — it goes on a
   QR for strangers to scan. It rides policy_flags.profile_provenance.upi_id beside the vault, so the storefront reads
   it from the identities row it already opens (no vault decrypt on a public page). Nothing else in the vault is mirrored. */
async function mirrorUpiId(entity_id, vault) {
  try {
    let upi = null;
    for (const section of vault.sections)
      for (const row of section.rows)
        if (row.tag === 'upi_id' && isUpiId(row.value))
          upi = { value: String(row.value).trim(), source: row.source || 'profile', as_of: row.as_of || null, rung: row.rung || 'declared' };
    const policy = require('./policy'); /* T2-POLICY: the one writer of policy_flags */
    if (upi) await policy.patchKey(null, entity_id, ['profile_provenance', 'upi_id'], upi);
    else
      await policy.patchKey(null, entity_id, ['profile_provenance', 'upi_id'], null, {
        op: 'remove',
        when: { path: ['profile_provenance', 'upi_id'], exists: true }
      });
  } catch (e) {
    require('./logger').warn('profile.saveVault: the UPI id was not mirrored — the shop page shows the previous one', { entity_id, err: e && e.message });
  }
}
/** the missing-column / missing-table errors of a pre-b100 database → 503 in words; any other error surfaces as itself */
function vaultWriteFailure(e) {
  // F6 (reviewer 2026-07-13): don't blanket-503. Only the actual "column/table missing" (pre-b100) is a 503;
  // a permission error / constraint / RLS denial / connection drop must surface as itself, not be masked.
  if (e && (e.code === '42703' || e.code === '42P01')) {
    // undefined_column / undefined_table
    const err = new Error('Trade vault not migrated yet (b100).');
    err.status = 503;
    err.code = 'VAULT_STORE_MISSING';
    return err;
  }
  return e; // real error → route's safeErr keeps it generic for 5xx, but it's logged, not hidden
}
/* ⭐ W25: the write is CONDITIONAL on the version the client read (`expect`) — the check and the write are one statement, so two
   screens saving at once cannot both win; a first fill (no row yet) passes with no version. → the new version, or null */
async function writeVaultRow(entity_id, envelope, expect) {
  try {
    const result = await withEntity(entity_id, (client) =>
      client.query(
        `INSERT INTO entity_profile (entity_id, vault, updated_at) VALUES ($1,$2,now())
       ON CONFLICT (entity_id) DO UPDATE SET vault=EXCLUDED.vault, updated_at=now()` +
          (expect ? ` WHERE ${VERSION_SQL.replace('updated_at', 'entity_profile.updated_at')} = $3` : '') +
          ` RETURNING ${VERSION_SQL} AS version`,
        expect ? [entity_id, JSON.stringify(envelope), expect] : [entity_id, JSON.stringify(envelope)]
      )
    );
    if (expect && !(result && result.rowCount)) throw vaultChanged();
    return result && result.rows && result.rows[0] && result.rows[0].version != null ? String(result.rows[0].version) : null;
  } catch (e) {
    if (e && e.code === 'VAULT_CHANGED') throw e;
    throw vaultWriteFailure(e);
  }
}
/** save a whole vault: rungs settled, the UPI id mirrored, written (conditionally when `opts.expect` names a version), the identity mirrored → { vault, version } */
async function saveVault(entity_id, v, opts) {
  const vault = sanitizeVault(v);
  if (!(opts && opts.trusted)) await settleRungs(entity_id, vault, opts);
  await mirrorUpiId(entity_id, vault);
  const envelope = vaultcrypto.encryptVault(vault); // F1 — throws 503 VAULT_ENC_UNCONFIGURED if no key → fail closed (never store plaintext)
  const version = await writeVaultRow(entity_id, envelope, opts && opts.expect != null ? String(opts.expect) : null);
  /* ⭐ T2-POLICY (SET4): the Business identity rows' tax number and address go THROUGH the one writer to the identities columns (the
     record the tax lines and the counter read). A trusted save is applyProfileMap's, which wrote the columns itself. */
  if (!(opts && opts.trusted)) await mirrorIdentity_(entity_id, vault);
  return { vault, version };
}
/** W25: a merge-patch (lib/vault-patch) over the held vault, written only if the version still matches → { vault, version }; 409 VAULT_CHANGED otherwise */
async function patchVault(entity_id, patch, version, opts) {
  const held = await readVault(entity_id);
  if (held.version && String(version || '') !== held.version) throw vaultChanged();
  const next = require('./vault-patch').applyVaultPatch(held.vault, patch);
  return saveVault(entity_id, next, Object.assign({}, opts || {}, { expect: held.version, held: held.vault }));
}

/** T2-NATDEF: the shop's own country off a getProfile answer (its invoice party: the vault's tag, else identities.country) — upper-cased, none → null.
 *  ONE reader for the trade origin: readiness, kyb.position and the readiness/path reads below — never India by default. */
function countryOfProfile(p) {
  const c = p && ((p.invoice_party && p.invoice_party.country) || p.country);
  return c ? String(c).trim().toUpperCase() || null : null;
}

/** ONE reading of the GSTIN checker's refusal (profile-map.gstinChecksum, adopted from the engines): it answers 'format' both for a wrong SHAPE and for a
 *  PAN holder letter (character 6) outside CPHFATBLJG. The two are told apart without a second regex: put a valid holder letter in and ask again — if the
 *  shape then passes, the holder letter was the reason ('pan_type'). Web country setup mirrors this (cap-country.js csuGstinCheck). */
function gstinCheck(gstin) {
  const profileMap = require('./profile-map');
  const verdict = profileMap.gstinChecksum(gstin);
  if (verdict.ok) return verdict;
  if (verdict.reason !== 'format') return { ok: false, reason: 'check', expected: verdict.expected };
  const upper = String(gstin || '')
    .trim()
    .toUpperCase();
  return { ok: false, reason: profileMap.gstinChecksum(upper.slice(0, 5) + 'C' + upper.slice(6)).reason === 'format' ? 'format' : 'pan_type' };
}
const GSTIN_WHY = {
  format: 'That does not look like a GSTIN (15 characters, e.g. 27AAPFU0939F1ZV).',
  pan_type:
    'The PAN inside the GSTIN (characters 3–12) has no valid holder type at place 6 — P person, C company, F firm, H HUF, T trust, A association, B body of individuals, L local authority, J juridical person, G government.',
  check: 'That GSTIN does not check out — look at the last character.'
};
/**
 * ⭐⭐ T2-POLICY (SET4, 2026-10-14) · THE SHOP'S TAX NUMBER AND ADDRESS — one store (identities.gstn · identities.address), one writer.
 * Three statements wrote them (routes/entities.js PATCH /profile · country-setup.save · applyProfileMap), each with its own check —
 * the profile's was "a GSTIN is 15 characters" for every country. Now:
 *   taxIdRefusal(country, number)   → null | { code: 'TAX_ID_BAD', why } — THE check, from the pack taxIdWordOf names: a GSTIN by its
 *                                     own checksum (profile-map.gstinChecksum), an ABN / TRN by the pack's validator, any number ≤ 40.
 *   shopIdentitySql(fields, at)     → { sql: 'gstn = $n, address = $m', params } — only the keys PRESENT in `fields` (null clears one);
 *                                     for a caller that writes other columns in the same statement (no extra trip).
 *   setShopIdentity(db, entity_id, fields, { country }) → runs it alone, after the check when the country is known.
 * The guard (scripts/guards.cjs policy-one-writer) fails on any other `gstn =` / `address =` written to a shop's own identities row.
 * ⚠️ Readers keep their precedence this round (invoiceParty: a Business identity row first) — flipping it would change a printed
 * invoice for any shop whose two values differ today; the vault save now writes through (mirrorIdentity_), so they converge.
 */
function taxIdRefusal(country, number) {
  const text = String(number == null ? '' : number)
    .trim()
    .toUpperCase();
  if (!text) return null;
  const bad = (why) => ({ code: 'TAX_ID_BAD', why });
  if (text.length > 40) return bad('That tax number is too long.');
  let pack = null;
  try {
    pack = country ? require('./regulation').packFor(String(country).toUpperCase()) : null;
  } catch (e) {
    log.fellBack('profile taxIdRefusal: no pack for that country — the number is checked by length only', e);
    pack = null;
  }
  if (taxIdWordOf(pack) === 'GSTIN') {
    const gstinVerdict = gstinCheck(text);
    if (!gstinVerdict.ok) return bad(GSTIN_WHY[gstinVerdict.reason] || GSTIN_WHY.check);
    return null;
  }
  /* R5 (engines v1.53.0): the country registry answers the check — a new country's own `taxId`, AU/AE through its frozen adapters; no country named here */
  const id = pack ? require('./country').taxId(pack) : null;
  if (id && id.check) {
    const ck = id.check(text);
    if (!ck.ok) return bad(ck.why || 'That tax number does not check out.');
  }
  return null;
}
function shopIdentitySql(fields, at) {
  const f = fields || {};
  const sets = [],
    params = [];
  let n = at || 1;
  const own = (k) => Object.prototype.hasOwnProperty.call(f, k);
  if (own('tax_id')) {
    sets.push('gstn = $' + n++);
    params.push(f.tax_id == null || f.tax_id === '' ? null : f.tax_id);
  }
  if (own('address')) {
    sets.push('address = $' + n++);
    params.push(f.address == null || f.address === '' ? null : f.address);
  }
  return { sql: sets.join(', '), params };
}
async function setShopIdentity(db, entity_id, fields, opts) {
  const o = opts || {};
  if (o.country !== undefined && fields && fields.tax_id) {
    const r = taxIdRefusal(o.country, fields.tax_id);
    if (r) throw Object.assign(new Error(r.why), { status: 400, code: r.code, say: r.why });
  }
  const s = shopIdentitySql(fields, 1);
  if (!s.sql) return { rowCount: 0, rows: [] };
  const run = db && typeof db.query === 'function' ? db.query.bind(db) : require('../db').query;
  return run('UPDATE identities SET ' + s.sql + ' WHERE identity_id = $' + (s.params.length + 1), s.params.concat([entity_id]));
}
/** the vault's Business identity rows → the columns, through the one writer; a number the pack refuses stays a vault row only (logged) */
async function mirrorIdentity_(entity_id, vault) {
  const tag = {};
  for (const sec of vault.sections || [])
    if (sec.type === 'identity')
      for (const r of sec.rows || [])
        if ((r.tag === 'gstin' || r.tag === 'address') && r.value && tag[r.tag] === undefined) tag[r.tag] = String(r.value).trim();
  if (!tag.gstin && !tag.address) return;
  const { query: statement } = require('../db');
  const me = (await statement('SELECT country, gstn, address FROM identities WHERE identity_id = $1', [entity_id])).rows[0];
  if (!me) return;
  const fields = {};
  if (tag.address && tag.address !== me.address) fields.address = tag.address;
  if (tag.gstin && tag.gstin !== String(me.gstn || '').trim()) {
    const r = taxIdRefusal(me.country, tag.gstin);
    if (r) require('./logger').warn('profile.saveVault: the Business identity tax number was kept in the vault only — ' + r.why, { entity_id });
    else fields.tax_id = tag.gstin;
  }
  await setShopIdentity(null, entity_id, fields);
}

async function getProfile(entity_id) {
  const base = { ...DEFAULT };
  try {
    /* ⭐ ONE network round trip (db.readBatch); the transaction path stays as the fallback. */
    const sql = 'SELECT trade_mode, markets, sectors, adopted FROM entity_profile WHERE entity_id = $1';
    let r;
    try {
      r = (await readBatch(entity_id, null, [{ text: sql, params: [entity_id] }]))[0];
    } catch (_) {
      r = await withEntity(entity_id, (c) => c.query(sql, [entity_id]));
    }
    if (r.rows[0]) {
      base.trade_mode = r.rows[0].trade_mode;
      base.markets = r.rows[0].markets || [];
      base.sectors = r.rows[0].sectors || [];
      base.adopted = r.rows[0].adopted || [];
    }
  } catch (e) {
    log.fellBack('profile getProfile: the read failed — carried on without it', e);
  } // pre-b96 → default
  const held = await readVault(entity_id); // separate guarded read → unaffected if b100 not run
  base.vault = held.vault;
  base.vault_version = held.version; /* W25: the version a save names (null before the first fill) */
  try {
    base.invoice_party = await invoiceParty(entity_id);
  } catch (e) {
    log.fellBack('profile getProfile: failed — answered with nothing', e);
    base.invoice_party = null;
  } /* the Invoice row's supplier block */
  base.vault_encrypted = vaultcrypto.isConfigured(); // F1 — UI warns + refuses real data when encryption isn't configured
  return base;
}
/**
 * isExporter(entity_id) → true only when the shop declared trade_mode = 'export' (the Trade-ready switch: it sells outside its own country/installation).
 * NET-39 (Athi, 2026-10-25): a shop is shown to ANOTHER installation only then. FAILS CLOSED: no profile, no table, a failed read → false (domestic).
 * entity_profile is FORCE-RLS, so it is read as the shop itself (withEntity), never joined across shops.
 */
async function isExporter(entity_id) {
  try {
    const read = await withEntity(entity_id, (client) => client.query('SELECT trade_mode FROM entity_profile WHERE entity_id = $1', [entity_id]));
    return !!(read.rows[0] && read.rows[0].trade_mode === 'export');
  } catch (failure) {
    log.fellBack('profile isExporter: the read failed — the shop is treated as domestic, so not shown abroad', failure);
    return false;
  }
}
async function saveProfile(entity_id, p) {
  const trade_mode = p && p.trade_mode === 'export' ? 'export' : 'domestic';
  const markets = Array.isArray(p && p.markets) ? p.markets : [];
  const sectors = Array.isArray(p && p.sectors) ? p.sectors : [];
  const adopted = Array.isArray(p && p.adopted) ? p.adopted : [];
  await withEntity(entity_id, (c) =>
    c.query(
      `INSERT INTO entity_profile (entity_id, trade_mode, markets, sectors, adopted, updated_at)
     VALUES ($1,$2,$3,$4,$5, now())
     ON CONFLICT (entity_id) DO UPDATE SET trade_mode=EXCLUDED.trade_mode, markets=EXCLUDED.markets,
       sectors=EXCLUDED.sectors, adopted=EXCLUDED.adopted, updated_at=now()`,
      [entity_id, trade_mode, markets, sectors, adopted]
    )
  );
  return getProfile(entity_id);
}

async function voluntaryMap() {
  try {
    const r = await query('SELECT standard_key, voluntary FROM standard_source');
    const m = {};
    r.rows.forEach((x) => {
      m[x.standard_key] = x.voluntary;
    });
    return m;
  } catch (e) {
    log.fellBack('profile voluntaryMap: the read failed — answered with an empty set', e);
    return {};
  }
}
function summ(items) {
  const met = items.filter((item) => item.status === 'gathered' || item.status === 'expiring').length;
  return {
    total: items.length,
    met,
    pending: items.length - met,
    percent: items.length ? Math.round((met / items.length) * 100) : 0,
    ready: items.length > 0 && met === items.length,
    verified: items.filter((item) => item.rung === 'verified').length,
    adopted: items.filter((item) => item.tier === 'adopted').length,
    mandatory: items.filter((item) => item.tier === 'mandatory').length
  };
}

// resolveProfileReadiness(entity) → the entity's OWN required set (mandatory ∪ adopted), across its markets & sectors.
async function resolveProfileReadiness(entity_id) {
  const p = await getProfile(entity_id);
  const vol = await voluntaryMap();
  /* TRADE-SRV1 G2: the shop's stated country and sectors (readiness.laneOf) — asked when unstated, never India / paint / EU */
  const lane = await readiness.laneOf(entity_id, {}); /* VERT-1: the trade from THE resolver (laneOf → govresolve.verticalOf) */
  const origin = lane.origin;
  if (!origin) return { profile: p, asked: lane.asked, code: lane.code, why: lane.why, clearances: [], summary: summ([]) };
  const sectors = p.sectors.length ? p.sectors : [null]; /* no sector: the rules for every product */
  const markets = p.trade_mode === 'export' ? p.markets : [origin]; /* export with no market named: only the home rules, and the markets are asked */
  if (!markets.length) markets.push(origin);
  const byKey = {};
  for (const sector of sectors) {
    for (const market of markets) {
      const rd = await readiness.resolveForDestination(entity_id, market, sector, origin);
      for (const it of rd.clearances || []) {
        const k = it.standard + '|' + it.doc;
        if (!byKey[k]) byKey[k] = it;
      }
    }
  }
  // mandatory (regulatory) always in; a VOLUNTARY standard is in only if the entity ADOPTED it.
  const items = Object.values(byKey)
    .filter((item) => {
      const v = !!vol[item.standard];
      return v ? p.adopted.indexOf(item.standard) >= 0 : true;
    })
    .map((item) => ({ ...item, tier: vol[item.standard] ? 'adopted' : 'mandatory' }));
  const asked = lane.asked.concat(p.trade_mode === 'export' && !p.markets.length ? ['markets'] : []);
  return { profile: p, asked, code: lane.code, why: lane.why, clearances: items, summary: summ(items) };
}

// resolvePath(entity) → the forward roadmap: readiness per destination + the standards to add, with current markets marked.
async function resolvePath(entity_id) {
  const p = await getProfile(entity_id);
  const vol = await voluntaryMap();
  const sector = (await require('./govresolve').verticalOf(entity_id))
    .key; /* VERT-1 · TRADE-SRV1 G2: the stated sector and country (resolveLaneMatrix → laneOf), never paint / India */
  const matrix = await readiness.resolveLaneMatrix(entity_id, sector, null);
  const current = new Set(p.trade_mode === 'export' ? p.markets : matrix.origin ? [matrix.origin] : []);
  const lanes = (matrix.lanes || []).map((item) => ({ ...item, in_profile: current.has(item.dest_key) }));
  return {
    profile: p,
    sector,
    origin: matrix.origin,
    asked: matrix.asked,
    code: matrix.code,
    why: matrix.why,
    lanes,
    adoptable: Object.keys(vol).filter((item) => vol[item] && p.adopted.indexOf(item) < 0)
  };
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
 * ⭐ The shop's name is the profile's name (Athi, 2026-10-01): "The account's own name wins everywhere it is shown; a trade
 * name copied in from Tally or the vault only fills it when it is empty. The two should match, and when they differ the
 * profile page says so." So trade_name reads identities.display_name first. legal_name is a SEPARATE fact and is untouched,
 * and so is `name` (legal name first) — what a tax invoice prints as the legal name.
 */
const GST_STATES = {
  '01': 'Jammu & Kashmir',
  '02': 'Himachal Pradesh',
  '03': 'Punjab',
  '04': 'Chandigarh',
  '05': 'Uttarakhand',
  '06': 'Haryana',
  '07': 'Delhi',
  '08': 'Rajasthan',
  '09': 'Uttar Pradesh',
  '10': 'Bihar',
  '11': 'Sikkim',
  '12': 'Arunachal Pradesh',
  '13': 'Nagaland',
  '14': 'Manipur',
  '15': 'Mizoram',
  '16': 'Tripura',
  '17': 'Meghalaya',
  '18': 'Assam',
  '19': 'West Bengal',
  '20': 'Jharkhand',
  '21': 'Odisha',
  '22': 'Chhattisgarh',
  '23': 'Madhya Pradesh',
  '24': 'Gujarat',
  '26': 'Dadra & Nagar Haveli and Daman & Diu',
  '27': 'Maharashtra',
  '29': 'Karnataka',
  '30': 'Goa',
  '31': 'Lakshadweep',
  '32': 'Kerala',
  '33': 'Tamil Nadu',
  '34': 'Puducherry',
  '35': 'Andaman & Nicobar',
  '36': 'Telangana',
  '37': 'Andhra Pradesh',
  '38': 'Ladakh',
  '97': 'Other Territory'
};
/** the store's profile as the map reads it: identities row + Business identity rows by tag → { key: { value, source, as_of, rung } } */
async function profileValues(entity_id) {
  const { query: statement } = require('../db');
  const r = await statement('SELECT display_name, gstn, address, phone, email, country, currency_code, policy_flags FROM identities WHERE identity_id = $1', [
    entity_id
  ]);
  const me = r.rows[0] || {};
  const flags = me.policy_flags && typeof me.policy_flags === 'object' ? me.policy_flags : {};
  let vault = { sections: [] };
  try {
    vault = await getVault(entity_id);
  } catch (e) {
    log.fellBack('profile profileValues: failed — carried on without it', e);
  }
  const v = {};
  const fromCol = (k, val, extra) => {
    if (val != null && String(val).trim() !== '') v[k] = Object.assign({ value: String(val).trim(), source: 'profile', rung: 'declared' }, extra || {});
  };
  fromCol('trade_name', me.display_name);
  fromCol('gstin', me.gstn);
  fromCol('address', me.address);
  fromCol('phone', me.phone);
  fromCol('email', me.email);
  fromCol('country', me.country);
  fromCol('currency', me.currency_code);
  if (flags.gst_registration) fromCol('reg_type', flags.gst_registration);
  const prov = flags.profile_provenance && typeof flags.profile_provenance === 'object' ? flags.profile_provenance : {};
  for (const k of Object.keys(prov)) if (v[k] && prov[k] && prov[k].value === v[k].value) v[k] = Object.assign({}, v[k], prov[k]);
  for (const sec of vault.sections || [])
    for (const row of sec.rows || [])
      if (row.tag && row.value) {
        const k = row.tag;
        const incoming = { value: row.value, source: row.source || 'vault', as_of: row.as_of || null, rung: row.rung || 'declared' };
        /* the shop's name is the profile's name (Athi, 2026-10-01): the profile's value is kept whatever the vault's rung; the vault's differing value rides on it */
        if (k === 'trade_name' && v[k] && v[k].source === 'profile') {
          if (String(incoming.value).trim() !== v[k].value)
            v[k] = Object.assign({}, v[k], { other: { value: String(incoming.value).trim(), source: incoming.source, rung: incoming.rung } });
          continue;
        }
        if (!v[k] || require('./profile-map').rank(row.rung) >= require('./profile-map').rank(v[k].rung)) v[k] = incoming;
      }
  return v;
}
/** N2: the vault's Business-identity row names - the tax number and its registration are the shop's COUNTRY PACK's words (pack-words.wordsFor: GSTIN for India, ABN for Australia, 'Tax number' with no pack) */
/** the vault labels for the country this sync states, else the one the identity already holds */
async function vaultLabelsFor(entityId, values) {
  if (values.country && values.country.value) return vaultLabels(values.country.value);
  const held = (await require('../db').query('SELECT country FROM identities WHERE identity_id = $1', [entityId])).rows[0];
  return vaultLabels(held && held.country);
}
function vaultLabels(country) {
  const said = require('./pack-words').wordsFor(country ? String(country).toUpperCase() : null);
  return {
    legal_name: 'Legal name',
    trade_name: 'Trade / brand name',
    address: 'Address',
    city: 'City',
    state: 'State',
    pincode: 'PIN / ZIP',
    country: 'Country',
    email: 'Email',
    phone: 'Phone',
    gstin: said.taxId,
    pan: 'PAN',
    reg_type: said.registration + ' type',
    currency: 'Currency',
    upi_id: 'UPI id',
    bank_account: 'Bank account',
    ifsc: 'IFSC'
  };
}
/** write what the map decided: the identities columns it owns + Business identity rows (trusted: rungs as given) */
async function applyProfileMap(entity_id, values, meta) {
  const { query: statement } = require('../db');
  /* ⚠️ email and phone on identities are SIGN-IN identifiers (unique, the OTP goes there) — a profile sync must never overwrite
     them (a duplicate email from the store's books collided with another entity's login, [PRO-01] 2026-09-05). They live on the
     Business identity rows only; the invoice header reads them from there. */
  /* T2-POLICY (SET4): the tax number and address through the one writer's fragment (shopIdentitySql), in this same statement */
  const own = {};
  const provenance = {};
  const prov = (k, x) => {
    provenance[k] = { source: x.source || null, as_of: x.as_of || null, rung: x.rung || 'declared', value: x.value };
  };
  if (values.gstin && values.gstin.value) {
    const r = taxIdRefusal(values.country && values.country.value, values.gstin.value); /* the country this sync states, else no pack check (as before) */
    if (r) require('./logger').warn('profile.applyProfileMap: tax number not written to the profile — ' + r.why, { entity_id });
    else {
      own.tax_id = values.gstin.value;
      prov('gstin', values.gstin);
    }
  }
  if (values.address && values.address.value) {
    own.address = values.address.value;
    prov('address', values.address);
  }
  const idSql = shopIdentitySql(own, 2);
  const sets = idSql.sql ? [idSql.sql] : [],
    args = [entity_id].concat(idSql.params);
  if (values.country && values.country.value) {
    args.push(values.country.value);
    sets.push('country = $' + args.length);
    prov('country', values.country);
  }
  if (values.currency && values.currency.value) {
    args.push(String(values.currency.value).toUpperCase().slice(0, 3));
    sets.push('currency_code = $' + args.length);
  }
  if (sets.length) await statement('UPDATE identities SET ' + sets.join(', ') + ' WHERE identity_id = $1', args);
  const pf = {};
  pf.profile_provenance = provenance;
  if (values.reg_type && values.reg_type.value) {
    const g = require('./policy').coerce('gst_registration', String(values.reg_type.value).toLowerCase());
    if (g !== undefined) pf.gst_registration = g;
    else
      require('./logger').warn('profile.applyProfileMap: GST registration type not one we know — the flag keeps its value', {
        entity_id,
        value: values.reg_type.value
      });
  }
  await require('./policy').patchKey(null, entity_id, [], pf, { op: 'merge' }); /* T2-POLICY: the one writer of policy_flags */
  let vault = { sections: [] };
  try {
    vault = await getVault(entity_id);
  } catch (e) {
    log.fellBack('profile applyProfileMap: failed — carried on without it', e);
  }
  const sections = (vault.sections || []).slice();
  let sec = sections.find((item) => item.type === 'identity');
  if (!sec) {
    sec = { type: 'identity', label: 'Business identity', rows: [] };
    sections.push(sec);
  }
  const LABELS = await vaultLabelsFor(entity_id, values);
  for (const k of Object.keys(LABELS)) {
    const x = values[k];
    if (!x || !x.value) continue;
    const i = sec.rows.findIndex((item) => item.tag === k);
    const row = { name: LABELS[k], value: x.value, tag: k, source: x.source || undefined, as_of: x.as_of || undefined, rung: x.rung || 'declared' };
    if (i >= 0) sec.rows[i] = row;
    else sec.rows.push(row);
  }
  await saveVault(entity_id, { sections }, { trusted: true });
  return { columns: sets.length, rows: sec.rows.length };
}

/**
 * ⭐ taxIdWordOf(country | pack) → THE pack's own word for a shop's tax id — the ONE reader (STD2; country-setup.taxIdOf folded in here):
 * the pack's `tax.idName` (engines GOV-SPIN ask) · India's `export.taxScheme` ('GSTIN') · reg-au's `abn` validator → 'ABN' · reg-ae's `trn` → 'TRN'.
 * null when there is no pack or the pack names none — never 'GSTIN' for an unstated country (the caller says "tax number" in its own words).
 * Read by: catalogue-view (the storefront's tax_id_word) · invoiceParty below · country-setup.countries (`tax.id`) · till /snapshot (shop.tax_id_word).
 */
function taxIdWordOf(text) {
  let p = text;
  try {
    if (typeof text === 'string') p = text ? require('./regulation').packFor(text.toUpperCase()) : null;
  } catch (e) {
    log.fellBack('profile taxIdWordOf: the helper failed — answered with nothing', e);
    p = null;
  }
  if (!p) return null;
  if (p.tax && p.tax.idName) return String(p.tax.idName);
  if (p.export && p.export.taxScheme) return String(p.export.taxScheme);
  return require('./country').taxId(p).word; /* R5: the registry's word (ABN · TRN · a new country's own) */
}

/** does the pack split the shop's tax by state (India's CGST/SGST and IGST, pack.tax.supply 'state')? no pack -> no */
function splitsByStateOf(pack) {
  return !!(pack && pack.tax && pack.tax.supply === 'state');
}
async function invoiceParty(entity_id) {
  const { query: statement } = require('../db');
  const r = await statement('SELECT display_name, gstn, address, phone, email, country, currency_code FROM identities WHERE identity_id = $1', [entity_id]);
  const me = r.rows[0] || {};
  let vault = { sections: [] };
  try {
    vault = await getVault(entity_id);
  } catch (e) {
    log.fellBack('profile invoiceParty: failed — carried on without it', e);
  }
  const tag = {};
  for (const sec of vault.sections || []) {
    if (sec.type !== 'identity') continue;
    for (const row of sec.rows || []) if (row.tag && row.value && tag[row.tag] === undefined) tag[row.tag] = String(row.value).trim();
  }
  const gstin = String(tag.gstin || me.gstn || '')
    .trim()
    .toUpperCase();
  /* CX4 (R4): the shop's pack decides what the number is — a state and a PAN are read off it only under India's state-split GST (as
     tax-lines.partyOf); an ABN's or a TRN's first digits are not a state. The missing word is the pack's own tax id. */
  const pack = (() => {
    try {
      return require('./regulation').packFor(
        String(tag.country || me.country || '').toUpperCase()
      ); /* GOV-AU1: none → no pack (the documented no-pack path), never India's */
    } catch (e) {
      log.fellBack('profile invoiceParty: the helper failed — answered with nothing', e);
      return null;
    }
  })();
  const splitsByState = splitsByStateOf(pack); /* N2: no pack is neutral - the state-split reading is India's pack alone */
  const idWord = taxIdWordOf(pack);
  const stateCode = splitsByState && /^\d{2}/.test(gstin) ? gstin.slice(0, 2) : tag.state_code || null;
  const party = {
    legal_name: tag.legal_name || null,
    trade_name: me.display_name || tag.trade_name || null,
    name: tag.legal_name || me.display_name || null,
    gstin: gstin || null,
    pan: splitsByState && /^\d{2}[A-Z]{5}\d{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(gstin) ? gstin.slice(2, 12) : tag.pan || null,
    address: tag.address || me.address || null,
    city: tag.city || null,
    state: tag.state || (stateCode ? GST_STATES[stateCode] || null : null),
    state_code: stateCode,
    pincode: tag.pincode || null,
    country: tag.country || me.country || null,
    phone: tag.phone || me.phone || null,
    email: tag.email || me.email || null,
    upi_id: tag.upi_id || null /* the QR on an order (payment loop, level 1) */,
    currency: me.currency_code || (pack && pack.currency) || null /* STD2: a shop nobody gave money is asked (country-setup.MONEY_UNSTATED), never INR */
  };
  const missing = [];
  if (!party.name) missing.push('name');
  if (!party.gstin) missing.push(idWord === 'GSTIN' ? 'gstin' : idWord || 'tax number');
  if (!party.address) missing.push('address');
  if (!party.state && splitsByState) missing.push('state'); /* N2: a state is asked only where the pack splits tax by state */
  if (!party.phone && !party.email) missing.push('phone or email');
  party.missing = missing;
  party.complete = missing.length === 0;
  party.fix =
    'Settings › Documents › Business identity (legal name · address · city · state · PIN · phone · email), ' + (idWord || 'the tax number') + ' on Profile';
  return party;
}
/**
 * ⭐ MOVED TO THE CAPABILITY (lib/jurisdiction.js). "Is this a payee address we may show" is a fact about a payment
 * scheme, not about a profile, and it is needed by products that will never open a vault.
 * ⚠️ Re-exported under the old name so nothing that imports it breaks.
 */
const jurisdiction = require('./jurisdiction');
const isUpiId = jurisdiction.isPayeeHandle;
/** the mirrored copy on an identities row (policy_flags.profile_provenance.upi_id) → the id, or null */
function upiOf(policy_flags) {
  try {
    const v = policy_flags && policy_flags.profile_provenance && policy_flags.profile_provenance.upi_id && policy_flags.profile_provenance.upi_id.value;
    return isUpiId(v) ? String(v).trim() : null;
  } catch (e) {
    log.fellBack('profile upiOf: failed — answered with nothing', e);
    return null;
  }
}

/**
 * ⭐ THE BRIDGE BETWEEN A STORED PROFILE AND THE CAPABILITY. This is the ONE thing that genuinely belongs here: it
 * knows where a shop's declared payee addresses are KEPT (mirrored onto the identities row beside the vault). The
 * capability then decides what any of that means.
 * ⚠️ Today only UPI is mirrored, so this reads one key. A second scheme adds a line here and a row there — not a
 * rewrite of anything that calls payWays.
 */
function payeesOf(policy_flags) {
  return { upi: upiOf(policy_flags) };
}
/** ⚠️ kept under the old signature so existing callers do not change; the decision itself is the capability's */
function payWays({ country, policy_flags }) {
  return jurisdiction.payWays({ country, payees: payeesOf(policy_flags) });
}

module.exports = {
  isExporter,
  gstinCheck,
  GSTIN_WHY,
  countryOfProfile,
  isUpiId,
  upiOf,
  payeesOf,
  payWays,
  countryOf: jurisdiction.countryOf,
  PAY_SCHEMES: jurisdiction.PAY_SCHEMES,
  PAY_RECORD_ONLY: jurisdiction.PAY_RECORD_ONLY,
  profileValues,
  applyProfileMap,
  getProfile,
  saveProfile,
  getVault,
  readVault,
  saveVault,
  patchVault,
  vaultChanged,
  resolveProfileReadiness,
  resolvePath,
  SECTION_TYPES,
  VERIFIABLE_TAGS,
  sanitizeVault,
  invoiceParty,
  taxIdWordOf,
  GST_STATES,
  taxIdRefusal,
  shopIdentitySql,
  setShopIdentity
};
