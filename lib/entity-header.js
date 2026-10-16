'use strict';
/**
 * entity-header.js — N19: ONE header read. GET /api/entities/header -> { business, licences[], trade_ready }.
 *
 * The shell's sheet (public/app/shell.js) fills itself from exactly this shape. ONE read (I19): the shop's row, its profile (sectors +
 * vault), its gathered licences and its identity-document verdicts go out together through db.readBatch — ONE round trip, plus the two
 * cached schema probes. lib/kyb.yourself() / resolveReadiness are many trips (standards, documents, boilerplate, the invoice header)
 * and are not called; the licence rows come from the same entity_compliance rows they read, with kyb.daysUntil and readiness.rungOf.
 * No band, penalty or core list lives here: they are lib/licence-rules.js (data, country-keyed). The page computes nothing.
 *
 * The identity-document verdicts are read only through lib/iddoc-verify.js (the guard): available() / docsStatement() / docsState().
 *
 * OWNS      the shell sheet's one header read: the business, its licences (days left, band) and the trade-ready verdict — one readBatch.
 * CALLED BY routes/entities.js (GET /api/entities/header) and lib/sides.js (its trade_ready figure).
 * FLOW      read(entity) → readBatch(shop row · profile · licences · document verdicts) → build() → { business, licences[], trade_ready }
 * CARD      20-settings-governance-and-plan/entity-header
 */
const rules = require('./licence-rules');
const log = require('./logger');
const kyb = require('./kyb');
const iddoc = require('./iddoc-verify');
const PM = require('./profile-map');
const lotfields = require('./lotfields');
const packWords = require('./pack-words');   /* AU-WORDS: the trade-ready checks are the shop's pack's list, the tax id called by its word */

const has = (v) => v != null && String(v).trim() !== '';
const PAN_OF_GSTIN = /^\d{2}([A-Z]{5}\d{4}[A-Z])[1-9A-Z]Z[0-9A-Z]$/;
const TRADE_LICENCE = /trade.?licen|shop.?(and|&)?.?establish/i;   /* a gathered row that IS the trade licence (the UAE's check; licence-rules SHOP matches the same words) */

/** the four statements, in order: me · profile · gathered licences · identity-document verdicts. */
function statements(entity_id, { policyFlags }) {
  return [
    { text: 'SELECT display_name, address, phone, gstn, country, currency_code, vertical' + (policyFlags ? ', policy_flags' : '') + ' FROM identities WHERE identity_id = $1', params: [entity_id] },
    { text: 'SELECT sectors, vault FROM entity_profile WHERE entity_id = $1', params: [entity_id] },
    { text: 'SELECT standard_key, doc_key, status, evidence_ref, valid_until, verification FROM entity_compliance WHERE entity_id = $1', params: [entity_id] },
    iddoc.docsStatement(entity_id),
  ];
}

/** the vault's "Business identity" rows by tag, plus the best rung each tag holds */
function vaultTags(vault) {
  const tag = {}, rung = {};
  for (const sec of ((vault && vault.sections) || [])) for (const row of (sec.rows || [])) {
    if (!row || !row.tag || !has(row.value)) continue;
    if (tag[row.tag] === undefined) tag[row.tag] = String(row.value).trim();
    if (PM.rank(row.rung) > PM.rank(rung[row.tag])) rung[row.tag] = row.rung;
  }
  return { tag, rung };
}

/** the trade-ready checks: the PACK's list (pack-words.tradeChecksFor, AU-WORDS), each marked done from what the shop holds.
 *  IN asks Address · Phone · PAN on file · GSTIN; AU Address · Phone · ABN; AE Address · Phone · TRN · Trade licence; no country → Address · Phone · Tax number. `key` is the code. */
function tradeChecksOf({ country, docs, address, addrRung, gstin, compliance }) {
  const doneOf = {
    address: has(address) && PM.rank(addrRung) >= PM.rank('copied'),
    phone: !!(docs.PHONE && docs.PHONE.verified),
    pan: !!(docs.PAN && docs.PAN.held) || PAN_OF_GSTIN.test(gstin),
    tax_id: has(gstin),
    trade_licence: (compliance || []).some((row) => TRADE_LICENCE.test(String(row.standard_key || '') + ' ' + String(row.doc_key || ''))),
  };
  return packWords.tradeChecksFor(country).map((check) => ({ key: check.key, label: check.label, done: !!doneOf[check.key] }));
}

/**
 * build — pure. input: { me, profile, compliance[], docs (docsState), vault (decrypted+sanitised), now }.
 * `now` is for tests only.
 */
function build({ me, profile, compliance, docs, vault, now }) {
  me = me || {}; profile = profile || {};
  const { tag, rung } = vaultTags(vault);
  const country = me.country || null;   /* GOV-AU1: unknown → no country's licence rules (licence-rules.rulesFor), never India's */
  const address = tag.address || me.address || null;
  const gstin = String(tag.gstin || me.gstn || '').trim().toUpperCase();
  const flags = (me.policy_flags && typeof me.policy_flags === 'object') ? me.policy_flags : {};
  const prov = (flags.profile_provenance && flags.profile_provenance.address) || {};
  const addrRung = PM.rank(prov.rung) > PM.rank(rung.address) ? prov.rung : rung.address;

  const business = {
    name: me.display_name || null,
    legal_name: tag.legal_name || null,
    address,
    phone: tag.phone || me.phone || null,
    currency: me.currency_code || null,   /* AU-WORDS: the shop's money (identities.currency_code) — the shell paints its symbol as the money icon; null = unknown, the page shows ¤ */
  };

  /* licences: every gathered row (whatever schemes the shop holds) + every core scheme not yet held, as "not added" */
  const sectors = (Array.isArray(profile.sectors) ? profile.sectors : (profile.sectors ? [profile.sectors] : []));
  const pack = lotfields.packFor([me.vertical].concat(sectors));
  const coreSet = new Set(rules.coreSchemes(country, pack ? pack.key : null));
  const seen = new Set();
  const licences = (compliance || []).map((c) => {
    const rule = rules.ruleFor(country, c.standard_key, c.doc_key);
    const days = kyb.daysUntil(c.valid_until);
    const band = rules.bandOf(rule, days);
    if (rule) seen.add(rule.scheme);
    const ver = c.verification || {};
    return {
      scheme: rule ? rule.scheme : String(c.standard_key || ''),
      label: rule ? rule.label : String(c.doc_key || c.standard_key || '').replace(/[_-]+/g, ' '),
      number_masked: ver.number_masked || null,
      valid_until: require('./books-engines').ymd(c.valid_until),   /* a `date` column (b90) — THE reader, the same day in every zone */
      days_left: days, band,
      core: !!(rule && coreSet.has(rule.scheme)),
      renew_url: (rule && rule.renew_url) || null,
      note: rules.noteOf(rule, band),
      rule_verified: rule ? rule.verified === true : null,   /* false = the rule's source is not cited yet ("verify") */
    };
  });
  for (const r of rules.rulesFor(country).schemes) {
    if (!coreSet.has(r.scheme) || seen.has(r.scheme)) continue;
    licences.push({ scheme: r.scheme, label: r.label, number_masked: null, valid_until: null, days_left: null, band: null,
      core: true, renew_url: r.renew_url || null, note: null, rule_verified: r.verified === true });
  }

  const checks = tradeChecksOf({ country, docs: docs || {}, address, addrRung, gstin, compliance });
  return { business, licences, trade_ready: { checks, done: checks.every((check) => check.done) } };
}

/**
 * read — the whole header for one entity: the two cached probes, ONE readBatch, build(). The route (GET /api/entities/header) and
 * the CB Sides panel (lib/sides.js — the Trade-proof row IS trade_ready, 3 of 4) both call THIS, so the proof is computed once.
 * Throws on a database failure; the caller words it.
 */
async function read(entity_id, actor_id) {
  const schema = require('./schema');
  const { readBatch } = require('../db');
  /* two cached probes: the batch aborts whole on a missing table / column (deploy-before-migration) */
  const [docsOn, cols] = await Promise.all([iddoc.available(), schema.hasColumns('identities', ['policy_flags'])]);
  const st = statements(entity_id, { policyFlags: !!cols.policy_flags });
  const out = await readBatch(entity_id, actor_id, docsOn ? st : st.slice(0, 3));
  const prof = (out[1].rows || [])[0] || {};
  let vault = null;
  try { vault = require('./profile').sanitizeVault(require('./vaultcrypto').decryptVault(prof.vault || null)); } catch (e) { log.fellBack('entity-header read: the helper failed — answered with nothing', e); vault = null; }
  return build({ me: (out[0].rows || [])[0], profile: prof, vault, compliance: out[2].rows || [], docs: docsOn ? iddoc.docsState(out[3].rows) : {} });
}

module.exports = { statements, build, vaultTags, read };
