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
const { waiting } = require('./not-migrated');
const readiness = require('./readiness');
const govresolve = require('./govresolve'); /* VERT-13: THE resolver of the shop's trade */
const vaultcrypto = require('./vaultcrypto'); // F1 — vault stored encrypted (AES-256-GCM, key in env, never in DB)
const { boundRead } = require('./bound-read'); /* SEC-198: the identities read runs under its own id's binding */

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

const clippedText = (x, n) =>
  String(x == null ? '' : x)
    .trim()
    .slice(0, n);

// keep the shape, bound the size, drop empties — never trust the raw payload
function sanitizeVault(vault) {
  if (!vault || typeof vault !== 'object') return { sections: [] };
  const sourceSections = Array.isArray(vault.sections) ? vault.sections : legacyToSections(vault);
  const sections = [];
  for (const sec of sourceSections.slice(0, VAULT_LIMITS.sections)) {
    if (!sec || typeof sec !== 'object') continue;
    const type = SECTION_TYPES[sec.type] ? sec.type : 'other';
    const rows = [];
    for (const r of (Array.isArray(sec.rows) ? sec.rows : []).slice(0, VAULT_LIMITS.rows)) {
      if (!r || typeof r !== 'object') continue;
      const name = clippedText(r.name, VAULT_LIMITS.name),
        value = clippedText(r.value, VAULT_LIMITS.value);
      // ⚠️ A row needs a VALUE to be worth storing, but not a name — a value under a section the user has
      // labelled is still meaningful. A name with no value is an empty box they opened and did not fill.
      if (!value) continue;
      const row = { name, value };
      const tag = clippedText(r.tag, VAULT_LIMITS.tag).toLowerCase();
      if (tag) row.tag = tag;
      /* ⭐ PROVENANCE RIDES THE ROW (profile-map.js): source · as_of · rung. The rung is PLATFORM-WRITTEN — a client save is
         'declared' unless the same tag+value is already held higher (then the held rung survives the round trip). */
      if (r.source) row.source = clippedText(r.source, 80);
      if (r.as_of && !isNaN(Date.parse(r.as_of))) row.as_of = new Date(r.as_of).toISOString();
      const rung = String(r.rung || 'declared').toLowerCase();
      row.rung = ['declared', 'copied', 'checked', 'verified'].includes(rung) ? rung : 'declared';
      rows.push(row);
    }
    if (rows.length) sections.push({ type, label: clippedText(sec.label, VAULT_LIMITS.label), rows });
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
function legacyToSections(vault) {
  const out = [];
  for (const g of Object.keys(LEGACY_GROUPS)) {
    const group = vault[g];
    if (!group || typeof group !== 'object') continue;
    const rows = Object.keys(group)
      .filter((item) => String(group[item] || '').trim() !== '')
      .map((item) => ({ name: LEGACY_LABELS[item] || item, value: String(group[item]), tag: item }));
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
    const decrypted = vaultcrypto.decryptVault((row && row.vault) || null); // stored = ciphertext envelope → decrypt (F1)
    /* ⚠️ NORMALISE ON READ. A vault written before 2026-08-16 is group-shaped; sanitizeVault converts it via
       legacyToSections, so callers only ever see {sections}. Nothing is rewritten in the database — the old
       ciphertext stands until the user next saves, which is what makes this shape change migration-free. */
    return { vault: sanitizeVault(decrypted), version: row && row.version != null ? String(row.version) : null };
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
    let upiId = null;
    for (const section of vault.sections)
      for (const row of section.rows)
        if (row.tag === 'upi_id' && isUpiId(row.value))
          upiId = { value: String(row.value).trim(), source: row.source || 'profile', as_of: row.as_of || null, rung: row.rung || 'declared' };
    const policy = require('./policy'); /* T2-POLICY: the one writer of policy_flags */
    if (upiId) await policy.patchKey(null, entity_id, ['profile_provenance', 'upi_id'], upiId);
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
    const err = new Error(waiting('The trade vault', false, 'Nothing was saved.'));
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
/**
 * BB-F-10: a value the vault would CUT is refused in words, never cut in silence (a 5,000-character print signature was saved 200 and kept at 240). → the sentence of the first field over its limit, or null.
 * Reads the raw payload with the same VAULT_LIMITS sanitizeVault clips to (one list of limits); a vault read back from the row was clipped once, so it never trips this.
 */
function overLimitWords(vault) {
  const sections = vault && typeof vault === 'object' && Array.isArray(vault.sections) ? vault.sections : [];
  const longer = (text, limit) => String(text == null ? '' : text).trim().length > limit;
  for (const sec of sections.slice(0, VAULT_LIMITS.sections)) {
    if (!sec || typeof sec !== 'object') continue;
    if (longer(sec.label, VAULT_LIMITS.label)) return 'A section name is longer than ' + VAULT_LIMITS.label + ' characters. Shorten it and save again.';
    for (const row of (Array.isArray(sec.rows) ? sec.rows : []).slice(0, VAULT_LIMITS.rows)) {
      if (!row || typeof row !== 'object') continue;
      if (longer(row.name, VAULT_LIMITS.name)) return 'A name is longer than ' + VAULT_LIMITS.name + ' characters. Shorten it and save again.';
      if (longer(row.value, VAULT_LIMITS.value)) return 'A value is longer than ' + VAULT_LIMITS.value + ' characters, so it was not saved. Shorten it and save again.';
      if (longer(row.tag, VAULT_LIMITS.tag)) return 'A tag is longer than ' + VAULT_LIMITS.tag + ' characters. Shorten it and save again.';
    }
  }
  return null;
}
/** save a whole vault: rungs settled, the UPI id mirrored, written (conditionally when `opts.expect` names a version), the identity mirrored → { vault, version } */
async function saveVault(entity_id, vaultToSave, opts) {
  const tooLong = opts && opts.trusted ? null : overLimitWords(vaultToSave);
  if (tooLong) throw Object.assign(new Error(tooLong), { status: 400, code: 'INVALID_INPUT', say: tooLong });
  const vault = sanitizeVault(vaultToSave);
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

/**
 * VERIFY-TAX-01 row 6 · countryOf({ country, gstin, profile }) → ISO code | null — the party's stated country, else the one its tax number's FORMAT says
 * (GSTIN with state code and check character → IN, ABN modulus 89 → AU, TRN 15 digits → AE); a number no pack accepts is no country — never India by default.
 * The engines' country.countryOfParty does the whole read (engines v1.107.0, adopted): an ABN or TRN in the `gstn` column no longer makes a legacy AU/AE row Indian.
 */
const countryOf = (o) => require('./country').countryOfParty(o); /* the engines' ONE reader (v1.107.0 adopted): no copy and no fallback here (red1128) */

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
  const upper = String(gstin || '')
    .trim()
    .toUpperCase();
  if (verdict.reason === 'format') return { ok: false, reason: profileMap.gstinChecksum(upper.slice(0, 5) + 'C' + upper.slice(6)).reason === 'format' ? 'format' : 'pan_type' };
  /* IN-F-02: the first two digits are a STATE (the pack's list, profile-map.STATE_NAMES: 01 to 38 less the codes the Council retired, and 97 other territory), told before the check character */
  if (!gstinStateOk(upper)) return { ok: false, reason: 'state' };
  return verdict.ok ? verdict : { ok: false, reason: 'check', expected: verdict.expected };
}
/** IN-F-02: is the state code a GSTIN opens with one the GST state list names? (GSTN state code list: 01 to 38, 97 other territory; 99 is the centre's own jurisdiction, never a shop or a party.) */
function gstinStateOk(gstin) {
  const profileMap = require('./profile-map');
  const code = profileMap.stateOfGstin(gstin);
  return !!code && (!!profileMap.STATE_NAMES[code] || code === '97');
}
const GSTIN_WHY = {
  format: 'That does not look like a GSTIN (15 characters, e.g. 27AAPFU0939F1ZV).',
  pan_type:
    'The PAN inside the GSTIN (characters 3–12) has no valid holder type at place 6 — P person, C company, F firm, H HUF, T trust, A association, B body of individuals, L local authority, J juridical person, G government.',
  check: 'That GSTIN does not check out — look at the last character.',
  state: 'The first two digits of a GSTIN are its state code: 01 to 38 (or 97 for other territory). Those two are not a state.'
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
  const badTaxId = (why) => ({ code: 'TAX_ID_BAD', why });
  if (text.length > 40) return badTaxId('That tax number is too long.');
  let pack = null;
  try {
    pack = country ? require('./regulation').packFor(String(country).toUpperCase()) : null;
  } catch (e) {
    log.fellBack('profile taxIdRefusal: no pack for that country — the number is checked by length only', e);
    pack = null;
  }
  if (taxIdWordOf(pack) === 'GSTIN') {
    const gstinVerdict = gstinCheck(text);
    if (!gstinVerdict.ok) return badTaxId(GSTIN_WHY[gstinVerdict.reason] || GSTIN_WHY.check);
    return null;
  }
  /* R5 (engines v1.53.0): the country registry answers the check — a new country's own `taxId`, AU/AE through its frozen adapters; no country named here */
  const id = pack ? require('./country').taxId(pack) : null;
  if (id && id.check) {
    const checked = id.check(text);
    if (!checked.ok) return badTaxId(checked.why || 'That tax number does not check out.');
  }
  /* AE-F-02: the column holds 15 characters; a number the pack cleans is measured after the clean; anything else that long is refused in words, never a 500 */
  if (taxIdNormal(country, text).length > 15) return badTaxId('That tax number is too long: it takes up to 15 letters and digits.');
  return null;
}
/**
 * AE-F-02: taxIdNormal(country, number) → the number as the pack writes it (a TRN typed 100-2345-6780-0003 is 100234567800003; spaces and dashes gone,
 * upper case), else the typed text trimmed + upper-cased. THE one cleaner: identities.gstn is 15 characters, so a printed form with dashes (18) must never
 * reach the column (it answered 500). Called after taxIdRefusal says ok, by every writer of the number.
 */
function taxIdNormal(country, number) {
  const text = String(number == null ? '' : number)
    .trim()
    .toUpperCase();
  if (!text) return text;
  let pack = null;
  try {
    pack = country ? require('./regulation').packFor(String(country).toUpperCase()) : null;
  } catch (e) {
    return text;
  }
  const id = pack ? require('./country').taxId(pack) : null;
  if (id && id.check) {
    const checked = id.check(text);
    if (checked.ok && checked.value) return String(checked.value);
  }
  return text;
}
const IDENTITY_COLUMN = { tax_id: 'gstn', address: 'address', display_name: 'display_name' }; /* the field a caller names → the identities column it sets (A-F-66: the shop's one name rides the same writer) */
function shopIdentitySql(fields, at) {
  const ownFields = fields || {};
  const sets = [],
    params = [];
  let paramIndex = at || 1;
  Object.keys(IDENTITY_COLUMN)
    .filter((key) => Object.prototype.hasOwnProperty.call(ownFields, key))
    .forEach((key) => {
      sets.push(IDENTITY_COLUMN[key] + ' = $' + paramIndex++);
      params.push(ownFields[key] == null || ownFields[key] === '' ? null : ownFields[key]);
    });
  return { sql: sets.join(', '), params };
}
async function setShopIdentity(db, entity_id, fields, opts) {
  const options = opts || {};
  if (options.country !== undefined && fields && fields.tax_id) {
    const refusal = taxIdRefusal(options.country, fields.tax_id);
    if (refusal) throw Object.assign(new Error(refusal.why), { status: 400, code: refusal.code, say: refusal.why });
  }
  const identitySql = shopIdentitySql(fields, 1);
  if (!identitySql.sql) return { rowCount: 0, rows: [] };
  const runQuery = db && typeof db.query === 'function' ? db.query.bind(db) : require('../db').query;
  return runQuery('UPDATE identities SET ' + identitySql.sql + ' WHERE identity_id = $' + (identitySql.params.length + 1), identitySql.params.concat([entity_id]));
}
/** the Business identity rows' tax number and address, first of each: { gstin?, address? } — the one reader, for the mirror and for the owner-only gate (CTR-182) */
function identityTags(vault) {
  const tag = {};
  for (const sec of (vault && vault.sections) || [])
    if (sec.type === 'identity')
      for (const r of sec.rows || [])
        if ((r.tag === 'gstin' || r.tag === 'address') && r.value && tag[r.tag] === undefined) tag[r.tag] = String(r.value).trim();
  return tag;
}
/**
 * CTR-182: would saving this PUT /profile/vault body (a merge-patch with its version, or a whole vault) change the Business identity tax number
 * the vault holds? The held vault is read once and the body applied the way the save applies it; removing the number counts as a change. → true | false
 */
async function vaultChangesTaxId(entity_id, body) {
  const patcher = require('./vault-patch');
  const held = await readVault(entity_id);
  const next = patcher.isPatchBody(body) ? patcher.applyVaultPatch(held.vault, body.patch) : sanitizeVault(body.vault || body);
  const norm = (vault) => (identityTags(vault).gstin || '').toUpperCase();
  return norm(held.vault) !== norm(next);
}
/** A-F-66: the business name the bill signature prints (section type 'signature', tag trade_name), 2–255 characters, or '' when none is typed */
function signatureNameOf(vault) {
  const rows = ((vault && vault.sections) || []).filter((sec) => sec.type === 'signature').flatMap((sec) => sec.rows || []);
  const named = rows.find((row) => row.tag === 'trade_name');
  const name = named ? String(named.value || '').trim() : '';
  return name.length >= 2 ? name.slice(0, 255) : '';
}
/** the tax_id column to write for a typed Business identity number, or undefined when it is unchanged or the pack refuses it (then it stays a vault row only, logged) */
function taxIdToMirror(entity_id, identityRow, typed) {
  if (!typed || typed === String(identityRow.gstn || '').trim()) return undefined;
  const refusal = taxIdRefusal(identityRow.country, typed);
  if (!refusal) return taxIdNormal(identityRow.country, typed);
  require('./logger').warn('profile.saveVault: the Business identity tax number was kept in the vault only — ' + refusal.why, { entity_id });
  return undefined;
}
/** a typed value that is there and is not what the column already holds */
const differsFrom = (typed, held) => !!typed && typed !== held;
/** the vault's Business identity rows → the columns, through the one writer; a number the pack refuses stays a vault row only (logged) */
async function mirrorIdentity_(entity_id, vault) {
  const tag = identityTags(vault);
  const printedName = signatureNameOf(vault);
  if (!tag.gstin && !tag.address && !printedName) return;
  const { query: statement } = require('../db');
  const identityRow = (await statement('SELECT country, gstn, address, display_name FROM identities WHERE identity_id = $1', [entity_id])).rows[0];
  if (!identityRow) return;
  /* A-F-66: ONE shop name — the business name typed in Print setup (the bill signature's trade_name) is the shop's display_name everywhere (header, Home, print) */
  const fields = {};
  if (differsFrom(printedName, String(identityRow.display_name || '').trim())) fields.display_name = printedName; /* written with the address and tax id below, by the one writer */
  if (differsFrom(tag.address, identityRow.address)) fields.address = tag.address;
  const taxId = taxIdToMirror(entity_id, identityRow, tag.gstin);
  if (taxId !== undefined) fields.tax_id = taxId;
  await setShopIdentity(null, entity_id, fields);
}

async function getProfile(entity_id) {
  const base = { ...DEFAULT };
  try {
    /* ⭐ ONE network round trip (db.readBatch); the transaction path stays as the fallback. */
    const sql = 'SELECT trade_mode, markets, sectors, adopted FROM entity_profile WHERE entity_id = $1';
    let profileResult;
    try {
      profileResult = (await readBatch(entity_id, null, [{ text: sql, params: [entity_id] }]))[0];
    } catch (_) {
      profileResult = await withEntity(entity_id, (c) => c.query(sql, [entity_id]));
    }
    if (profileResult.rows[0]) {
      base.trade_mode = profileResult.rows[0].trade_mode;
      base.markets = profileResult.rows[0].markets || [];
      base.sectors = profileResult.rows[0].sectors || [];
      base.adopted = profileResult.rows[0].adopted || [];
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
async function saveProfile(entity_id, profileInput) {
  const trade_mode = profileInput && profileInput.trade_mode === 'export' ? 'export' : 'domestic';
  const markets = Array.isArray(profileInput && profileInput.markets) ? profileInput.markets : [];
  const sectors = Array.isArray(profileInput && profileInput.sectors) ? profileInput.sectors : [];
  const adopted = Array.isArray(profileInput && profileInput.adopted) ? profileInput.adopted : [];
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
    const sourceResult = await query('SELECT standard_key, voluntary FROM standard_source');
    const voluntaryByKey = {};
    sourceResult.rows.forEach((x) => {
      voluntaryByKey[x.standard_key] = x.voluntary;
    });
    return voluntaryByKey;
  } catch (e) {
    log.fellBack('profile voluntaryMap: the read failed — answered with an empty set', e);
    return {};
  }
}
function summ(items) {
  const metCount = items.filter((item) => item.status === 'gathered' || item.status === 'expiring').length;
  return {
    total: items.length,
    met: metCount,
    pending: items.length - metCount,
    percent: items.length ? Math.round((metCount / items.length) * 100) : 0,
    ready: items.length > 0 && metCount === items.length,
    verified: items.filter((item) => item.rung === 'verified').length,
    adopted: items.filter((item) => item.tier === 'adopted').length,
    mandatory: items.filter((item) => item.tier === 'mandatory').length
  };
}

// resolveProfileReadiness(entity) → the entity's OWN required set (mandatory ∪ adopted), across its markets & sectors.
async function resolveProfileReadiness(entity_id) {
  const profile = await getProfile(entity_id);
  const voluntary = await voluntaryMap();
  /* TRADE-SRV1 G2: the shop's stated country and sectors (readiness.laneOf) — asked when unstated, never India / paint / EU */
  const lane = await readiness.laneOf(entity_id, {}); /* VERT-1: the trade from THE resolver (laneOf → govresolve.verticalOf) */
  const origin = lane.origin;
  if (!origin) return { profile: profile, asked: lane.asked, code: lane.code, why: lane.why, clearances: [], summary: summ([]) };
  const judged = govresolve.sectorsOrTrade(profile.sectors, { key: lane.vertical }); /* VERT-13: the declared sectors, else the stated trade */
  const sectors = judged.length ? judged : [null]; /* no trade stated: the rules for every product */
  const markets = profile.trade_mode === 'export' ? profile.markets : [origin]; /* export with no market named: only the home rules, and the markets are asked */
  if (!markets.length) markets.push(origin);
  const byKey = {};
  for (const sector of sectors) {
    for (const market of markets) {
      const readinessResult = await readiness.resolveForDestination(entity_id, market, sector, origin);
      for (const it of readinessResult.clearances || []) {
        const k = it.standard + '|' + it.doc;
        if (!byKey[k]) byKey[k] = it;
      }
    }
  }
  // mandatory (regulatory) always in; a VOLUNTARY standard is in only if the entity ADOPTED it.
  const items = Object.values(byKey)
    .filter((item) => {
      const v = !!voluntary[item.standard];
      return v ? profile.adopted.indexOf(item.standard) >= 0 : true;
    })
    .map((item) => ({ ...item, tier: voluntary[item.standard] ? 'adopted' : 'mandatory' }));
  const asked = lane.asked.concat(profile.trade_mode === 'export' && !profile.markets.length ? ['markets'] : []);
  return { profile: profile, asked, code: lane.code, why: lane.why, clearances: items, summary: summ(items) };
}

// resolvePath(entity) → the forward roadmap: readiness per destination + the standards to add, with current markets marked.
async function resolvePath(entity_id) {
  const profile = await getProfile(entity_id);
  const voluntary = await voluntaryMap();
  const sector = (await govresolve.verticalOf(entity_id))
    .key; /* VERT-1 · TRADE-SRV1 G2: the stated sector and country (resolveLaneMatrix → laneOf), never paint / India */
  const matrix = await readiness.resolveLaneMatrix(entity_id, sector, null);
  const current = new Set(profile.trade_mode === 'export' ? profile.markets : matrix.origin ? [matrix.origin] : []);
  const lanes = (matrix.lanes || []).map((item) => ({ ...item, in_profile: current.has(item.dest_key) }));
  return {
    profile: profile,
    sector,
    origin: matrix.origin,
    asked: matrix.asked,
    code: matrix.code,
    why: matrix.why,
    lanes,
    adoptable: Object.keys(voluntary).filter((item) => voluntary[item] && profile.adopted.indexOf(item) < 0)
  };
}

/** the vault's 'signature' section (Print setup) as { tag: value } */
function signatureRowsByTag(vault) {
  const signature = ((vault && vault.sections) || []).filter((section) => section && section.type === 'signature')[0];
  return Object.fromEntries(((signature && signature.rows) || []).filter((row) => row && row.tag).map((row) => [row.tag, row.value || '']));
}
/**
 * ⭐ CTR-158: THE SLIP'S FOOTER LINE as Print setup saved it (rows footer + order; the rule of web public/app/cap-print.js and bill-print.html).
 * A string the slip prints; '' when the footer is saved but unticked (R25: nothing prints); null when none is saved and the counter keeps its own words.
 */
function slipFooterOfVault(vault) {
  const byTag = signatureRowsByTag(vault);
  const words = String(byTag.footer || '').replace(/[\s\u00a0]{2,}/g, ' ').trim();
  if (!words) return null;
  return (byTag.order ? byTag.order.split(',') : []).indexOf('footer') >= 0 ? words : '';
}
/** hands the slip footer to a caller that asked for it (invoiceParty's second argument), from the vault it already read */
function noteSlipFooter(side, vault) {
  if (side) side.slip_footer = slipFooterOfVault(vault);
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
  const identityResult = await statement('SELECT display_name, gstn, address, phone, email, country, currency_code, policy_flags FROM identities WHERE identity_id = $1', [
    entity_id
  ]);
  const identity = identityResult.rows[0] || {};
  const flags = identity.policy_flags && typeof identity.policy_flags === 'object' ? identity.policy_flags : {};
  let vault = { sections: [] };
  try {
    vault = await getVault(entity_id);
  } catch (e) {
    log.fellBack('profile profileValues: failed — carried on without it', e);
  }
  const fieldValues = {};
  const fromCol = (k, val, extra) => {
    if (val != null && String(val).trim() !== '') fieldValues[k] = Object.assign({ value: String(val).trim(), source: 'profile', rung: 'declared' }, extra || {});
  };
  fromCol('trade_name', identity.display_name);
  fromCol('gstin', identity.gstn);
  fromCol('address', identity.address);
  fromCol('phone', identity.phone);
  fromCol('email', identity.email);
  fromCol('country', identity.country);
  fromCol('currency', identity.currency_code);
  if (flags.gst_registration) fromCol('reg_type', flags.gst_registration);
  const prov = flags.profile_provenance && typeof flags.profile_provenance === 'object' ? flags.profile_provenance : {};
  for (const k of Object.keys(prov)) if (fieldValues[k] && prov[k] && prov[k].value === fieldValues[k].value) fieldValues[k] = Object.assign({}, fieldValues[k], prov[k]);
  for (const sec of vault.sections || [])
    for (const row of sec.rows || [])
      if (row.tag && row.value) {
        const k = row.tag;
        const incoming = { value: row.value, source: row.source || 'vault', as_of: row.as_of || null, rung: row.rung || 'declared' };
        /* the shop's name is the profile's name (Athi, 2026-10-01): the profile's value is kept whatever the vault's rung; the vault's differing value rides on it */
        if (k === 'trade_name' && fieldValues[k] && fieldValues[k].source === 'profile') {
          if (String(incoming.value).trim() !== fieldValues[k].value)
            fieldValues[k] = Object.assign({}, fieldValues[k], { other: { value: String(incoming.value).trim(), source: incoming.source, rung: incoming.rung } });
          continue;
        }
        if (!fieldValues[k] || require('./profile-map').rank(row.rung) >= require('./profile-map').rank(fieldValues[k].rung)) fieldValues[k] = incoming;
      }
  return fieldValues;
}
/** N2: the vault's Business-identity row names - the tax number and its registration are the shop's COUNTRY PACK's words (pack-words.wordsFor: GSTIN for India, ABN for Australia, 'Tax number' with no pack) */
/** the vault labels for the country this sync states, else the one the identity already holds */
async function vaultLabelsFor(entityId, values) {
  if (values.country && values.country.value) return vaultLabels(values.country.value);
  const held = (await boundRead(require('../db').query, entityId, 'SELECT country FROM identities WHERE identity_id = $1', [entityId])).rows[0];
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
  const ownValues = {};
  const provenance = {};
  const prov = (k, x) => {
    provenance[k] = { source: x.source || null, as_of: x.as_of || null, rung: x.rung || 'declared', value: x.value };
  };
  if (values.gstin && values.gstin.value) {
    const refusal = taxIdRefusal(values.country && values.country.value, values.gstin.value); /* the country this sync states, else no pack check (as before) */
    if (refusal) require('./logger').warn('profile.applyProfileMap: tax number not written to the profile — ' + refusal.why, { entity_id });
    else {
      ownValues.tax_id = taxIdNormal(values.country && values.country.value, values.gstin.value);
      prov('gstin', values.gstin);
    }
  }
  if (values.address && values.address.value) {
    ownValues.address = values.address.value;
    prov('address', values.address);
  }
  const idSql = shopIdentitySql(ownValues, 2);
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
  const policyFlags = {};
  policyFlags.profile_provenance = provenance;
  if (values.reg_type && values.reg_type.value) {
    const gstRegistration = require('./policy').coerce('gst_registration', String(values.reg_type.value).toLowerCase());
    if (gstRegistration !== undefined) policyFlags.gst_registration = gstRegistration;
    else
      require('./logger').warn('profile.applyProfileMap: GST registration type not one we know — the flag keeps its value', {
        entity_id,
        value: values.reg_type.value
      });
  }
  await require('./policy').patchKey(null, entity_id, [], policyFlags, { op: 'merge' }); /* T2-POLICY: the one writer of policy_flags */
  const identityRows = await writeIdentityRows(entity_id, values);
  return { columns: sets.length, rows: identityRows };
}
/** the vault's Business identity section, added to the sections when there is none yet */
function identitySectionOf(sections) {
  let found = sections.find((item) => item.type === 'identity');
  if (!found) {
    found = { type: 'identity', label: 'Business identity', rows: [] };
    sections.push(found);
  }
  return found;
}
/** one identity row in its section: a row with that tag is replaced in place, a new tag is appended */
function putIdentityRow(section, row) {
  const at = section.rows.findIndex((item) => item.tag === row.tag);
  if (at >= 0) section.rows[at] = row;
  else section.rows.push(row);
}
/** the Business identity rows of the vault the map decided (a row per tag, replaced in place), saved trusted → how many rows the section holds */
async function writeIdentityRows(entity_id, values) {
  let vault = { sections: [] };
  try {
    vault = await getVault(entity_id);
  } catch (e) {
    log.fellBack('profile applyProfileMap: failed — carried on without it', e);
  }
  const sections = (vault.sections || []).slice();
  const identitySection = identitySectionOf(sections);
  const LABELS = await vaultLabelsFor(entity_id, values);
  for (const k of Object.keys(LABELS)) {
    const x = values[k];
    if (x && x.value) putIdentityRow(identitySection, { name: LABELS[k], value: x.value, tag: k, source: x.source || undefined, as_of: x.as_of || undefined, rung: x.rung || 'declared' });
  }
  await saveVault(entity_id, { sections }, { trusted: true });
  return identitySection.rows.length;
}

/**
 * ⭐ taxIdWordOf(country | pack) → THE pack's own word for a shop's tax id — the ONE reader (STD2; country-setup.taxIdOf folded in here):
 * the pack's `tax.idName` (engines GOV-SPIN ask) · India's `export.taxScheme` ('GSTIN') · reg-au's `abn` validator → 'ABN' · reg-ae's `trn` → 'TRN'.
 * null when there is no pack or the pack names none — never 'GSTIN' for an unstated country (the caller says "tax number" in its own words).
 * Read by: catalogue-view (the storefront's tax_id_word) · invoiceParty below · country-setup.countries (`tax.id`) · till /snapshot (shop.tax_id_word).
 */
function taxIdWordOf(text) {
  let pack = text;
  try {
    if (typeof text === 'string') pack = text ? require('./regulation').packFor(text.toUpperCase()) : null;
  } catch (e) {
    log.fellBack('profile taxIdWordOf: the helper failed — answered with nothing', e);
    pack = null;
  }
  if (!pack) return null;
  if (pack.tax && pack.tax.idName) return String(pack.tax.idName);
  if (pack.export && pack.export.taxScheme) return String(pack.export.taxScheme);
  return require('./country').taxId(pack).word; /* R5: the registry's word (ABN · TRN · a new country's own) */
}

/** does the pack split the shop's tax by state (India's CGST/SGST and IGST, pack.tax.supply 'state')? no pack -> no */
function splitsByStateOf(pack) {
  return !!(pack && pack.tax && pack.tax.supply === 'state');
}
async function invoiceParty(entity_id, side) {
  const { query: statement } = require('../db');
  const identityResult = await statement('SELECT display_name, gstn, address, phone, email, country, currency_code FROM identities WHERE identity_id = $1', [entity_id]);
  const identity = identityResult.rows[0] || {};
  let vault = { sections: [] };
  try {
    vault = await getVault(entity_id);
  } catch (e) {
    log.fellBack('profile invoiceParty: failed — carried on without it', e);
  }
  const tag = {}; noteSlipFooter(side, vault); /* CTR-158: read off the vault already in hand */
  for (const sec of vault.sections || []) {
    if (sec.type !== 'identity') continue;
    for (const row of sec.rows || []) if (row.tag && row.value && tag[row.tag] === undefined) tag[row.tag] = String(row.value).trim();
  }
  const gstin = String(tag.gstin || identity.gstn || '')
    .trim()
    .toUpperCase();
  /* CX4 (R4): the shop's pack decides what the number is — a state and a PAN are read off it only under India's state-split GST (as
     tax-lines.partyOf); an ABN's or a TRN's first digits are not a state. The missing word is the pack's own tax id. */
  const pack = (() => {
    try {
      return require('./regulation').packFor(
        String(tag.country || identity.country || '').toUpperCase()
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
    trade_name: identity.display_name || tag.trade_name || null,
    name: tag.legal_name || identity.display_name || null,
    gstin: gstin || null,
    pan: splitsByState && /^\d{2}[A-Z]{5}\d{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(gstin) ? gstin.slice(2, 12) : tag.pan || null,
    address: tag.address || identity.address || null,
    city: tag.city || null,
    state: tag.state || (stateCode ? GST_STATES[stateCode] || null : null),
    state_code: stateCode,
    pincode: tag.pincode || null,
    country: tag.country || identity.country || null,
    phone: tag.phone || identity.phone || null,
    email: tag.email || identity.email || null,
    upi_id: tag.upi_id || null /* the QR on an order (payment loop, level 1) */,
    currency: identity.currency_code || (pack && pack.currency) || null /* STD2: a shop nobody gave money is asked (country-setup.MONEY_UNSTATED), never INR */
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
const jurisdiction = require('./jurisdiction');
const { isUpiId, upiOf, payeesOf, payWays } = require('./profile-payee'); /* the payee bridge, a part file */

module.exports = {
  isExporter,
  signatureNameOf,
  mirrorIdentity_ /* A-F-66 test */,
  gstinCheck,
  gstinStateOk,
  GSTIN_WHY,
  countryOfProfile,
  isUpiId,
  upiOf,
  payeesOf,
  payWays,
  countryOf,
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
  overLimitWords,
  invoiceParty,
  taxIdWordOf,
  GST_STATES,
  taxIdRefusal,
  taxIdNormal,
  shopIdentitySql,
  setShopIdentity,
  vaultChangesTaxId
};
