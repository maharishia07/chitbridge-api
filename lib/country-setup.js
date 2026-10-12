// @stage tested
// @stage-note [GOVERNANCE · COUNTRY SETUP] The entity's governance profile — country · currency · financial-year start · tax
// @stage-note registration — read once, set once by the owner after registration, and the gate every books route asks before it opens.
'use strict';
/**
 * lib/country-setup.js — COUNTRY SETUP (CS1, 2026-10-12): the step an owner completes after registration, before the books open.
 *
 * Athi, 2026-10-03 (DECISIONS "Country packs: the three switch decisions"): a shop with NO country is REFUSED, no silent India
 * fallback; a country with no pack is SAID; a country change is a NEW entity. Until this file, `identities.country` defaulted to 'IN'
 * at the database (000_baseline) and lib/books.enable() read `|| 'IN'` — every shop on earth kept Indian books and nobody was told.
 *
 * ── ONE HOME PER FACT (no copy) ──────────────────────────────────────────────────────────────────────────────────────────────
 *   country            identities.country          (M196 writes the time-zone country at verify, COALESCE; this step CONFIRMS it)
 *   currency           identities.currency_code
 *   tax number         identities.gstn             (India's GSTIN; a generic country's tax number sits in the same column — one number, one home)
 *   tax scheme         identities.policy_flags.gst_registration   ('regular' | 'composition', what lib/profile already reads as reg_type)
 *   fy_start_month · tax_registration { registered, number?, scheme? } · setup_source { field: 'your time zone' | 'typed' | … } · country_setup_at
 *                      entity_governance (b299)    the entity's governance stamp — the row the pack is picked from
 *   The pack itself is never stored: regulation.status(country) answers it from the registry, every time.
 *
 * ── BEFORE b299 RUNS ─────────────────────────────────────────────────────────────────────────────────────────────────────────
 *   profile() still answers (migrated:false, the identities facts, fy from the pack); save() answers 503 COUNTRY_SETUP_NOT_MIGRATED in
 *   words; the gate refuses only a pack-less country (identities.country decides) — a shop that was fine yesterday is fine today.
 *
 * ── THE GATE ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
 *   gate(h, entity) throws { refused, status: 422, code: NO_COUNTRY | NO_COUNTRY_PACK | COUNTRY_SETUP_PENDING, message } — the sentence is
 *   regulation.status()'s (engines v1.36.0 — CS1 on top of AU1; v1.35.0 lacked reg-au, do not adopt it), so the server and the Country setup screen say the same words. One cached read per shop per
 *   minute (the books-hooks pattern); save() forgets it. A read that THROWS is logged and the gate stays open for that call — a database
 *   blip is not evidence about a shop's country, and it must not turn the ledger off.
 *
 * Flow step: Onboarding · after Register → Country setup → the app. (docs/process/flows.json is PM1's, not merged yet.)
 */
const schema = require('./schema');
const R = require('./regulation');                 /* adopted v1.36.0: status(country, { name }); reg-au came with it (AU1) */
const CACHE_MS = 60000;
const cache = new Map();                           /* entity → { st, until } — the gate's answer, a minute at a time */
const SCHEMES = ['regular', 'composition'];
const ISO2 = /^[A-Z]{2}$/, ISO3 = /^[A-Z]{3}$/;

/** the country's name a person reads — the ISO region name node's ICU carries (Intl.DisplayNames); else the code stands in, never a guess */
function nameOf(code) {
  if (!code) return '';
  try { const n = new Intl.DisplayNames(['en'], { type: 'region' }).of(code); if (n && n !== code && !/unknown/i.test(n)) return n; } catch (_) {}
  return code;
}
async function migrated() { return schema.hasColumn('entity_governance', 'country_setup_at'); }
function refuse_(code, message, status) { const e = new Error(message); e.refused = true; e.status = status || 422; e.code = code; e.say = message; return e; }

/* ── READ ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────── */
const SQL_ID = `SELECT /* country-setup */ country, currency_code, gstn, timezone, policy_flags FROM identities WHERE identity_id = $1`;
const SQL_GOV = `SELECT /* country-setup */ fy_start_month, tax_registration, setup_source, country_setup_at FROM entity_governance WHERE entity_id = $1`;
/** the raw facts, two reads inside the shop's own transaction (h = the withEntity handle); gov is null before b299 */
async function facts(h, entity) {
  const mig = await migrated();
  const id = (await h.query(SQL_ID, [entity])).rows[0] || null;
  const gov = mig ? ((await h.query(SQL_GOV, [entity])).rows[0] || null) : null;
  return { mig, id, gov };
}
/** profile(h, entity) → what the Country setup screen paints and the gate reads */
async function profile(h, entity) {
  const { mig, id, gov } = await facts(h, entity);
  const country = id && id.country ? String(id.country).toUpperCase() : null;
  const st = R.status(country, { name: nameOf(country) });
  const flags = (id && id.policy_flags && typeof id.policy_flags === 'object') ? id.policy_flags : {};
  const taxReg = (gov && gov.tax_registration && typeof gov.tax_registration === 'object') ? gov.tax_registration : null;
  const number = (taxReg && taxReg.number) || (id && id.gstn) || null;
  const scheme = (taxReg && taxReg.scheme) || (flags.gst_registration ? String(flags.gst_registration).toLowerCase() : null);
  const pack = st.pack ? R.packFor(st.pack) : null;
  const fy = (gov && gov.fy_start_month) || (pack && pack.fiscalYear && pack.fiscalYear.startMonth) || null;
  return {
    migrated: mig,
    done: !!(gov && gov.country_setup_at),
    set_at: gov && gov.country_setup_at ? new Date(gov.country_setup_at).toISOString() : null,
    /* ⭐ required = the step must be completed before the books open: only once b299 holds the mark, and never for a shop it backfilled */
    required: mig && !(gov && gov.country_setup_at),
    country: { code: country, name: st.name || '' },
    currency: (id && id.currency_code) ? String(id.currency_code).toUpperCase() : (pack ? pack.currency : null),
    fy_start_month: fy,
    tax: { registered: taxReg ? !!taxReg.registered : !!number, number, scheme: scheme && SCHEMES.indexOf(scheme) >= 0 ? scheme : (number ? 'regular' : null) },
    timezone: (id && id.timezone) || null,
    source: (gov && gov.setup_source && typeof gov.setup_source === 'object') ? gov.setup_source : {},
    pack: { id: st.pack, version: st.version, books: st.books, code: st.code, why: st.why },
  };
}

/* ── WRITE ────────────────────────────────────────────────────────────────────────────────────────────────────────────────── */
/** what the owner may send: { country, currency, fy_start_month, tax: { registered, number, scheme }, source: { field: words } } → clean or a 400 in words */
function clean(b) {
  const o = b || {};
  const country = String(o.country || '').trim().toUpperCase();
  if (!ISO2.test(country)) throw refuse_('COUNTRY_SETUP_BAD', 'Pick the country the shop trades from.', 400);
  const currency = String(o.currency || '').trim().toUpperCase();
  if (!ISO3.test(currency)) throw refuse_('COUNTRY_SETUP_BAD', 'Pick the money the shop keeps its prices in (a three-letter code, like INR).', 400);
  const fy = Number(o.fy_start_month);
  if (!(Number.isInteger(fy) && fy >= 1 && fy <= 12)) throw refuse_('COUNTRY_SETUP_BAD', 'Pick the month the financial year starts.', 400);
  const t = (o.tax && typeof o.tax === 'object') ? o.tax : {};
  const registered = t.registered === true || t.registered === 'yes' || t.registered === 'true';
  let number = registered ? String(t.number || '').trim().toUpperCase() : '';
  let scheme = registered ? String(t.scheme || 'regular').trim().toLowerCase() : null;
  if (registered && !number) throw refuse_('COUNTRY_SETUP_BAD', 'Registered for tax: type the registration number, or say not registered.', 400);
  if (number.length > 40) throw refuse_('COUNTRY_SETUP_BAD', 'That tax number is too long.', 400);
  if (registered && country === 'IN') {
    /* ⭐ India: the GSTIN check we already make (profile-map.gstinChecksum) — a wrong check digit is said, not stored */
    const ck = require('./profile-map').gstinChecksum(number);
    if (!ck.ok) throw refuse_('COUNTRY_SETUP_BAD', ck.reason === 'format' ? 'That does not look like a GSTIN (15 characters, e.g. 33AAAAA0000A1Z5).' : 'That GSTIN does not check out — look at the last character.', 400);
    if (SCHEMES.indexOf(scheme) < 0) throw refuse_('COUNTRY_SETUP_BAD', 'GST registration: regular or composition.', 400);
  } else if (registered && SCHEMES.indexOf(scheme) < 0) scheme = 'regular';
  const src = {}; const s = (o.source && typeof o.source === 'object') ? o.source : {};
  for (const k of ['country', 'currency', 'fy_start_month', 'tax']) if (s[k] != null) src[k] = String(s[k]).slice(0, 60);
  return { country, currency, fy_start_month: fy, tax: { registered, number: number || null, scheme }, source: src };
}
/**
 * save(h, entity, body) → the profile after the write. ONE transaction (the caller's withEntity): identities (country · currency
 * · gstn · policy_flags.gst_registration) and entity_governance (fy · tax · sources · the mark). 503 before b299. Set ONCE: a second save
 * with a DIFFERENT country is refused — a country change is a NEW entity (Athi, 2026-10-03); the same country may be re-saved (currency,
 * FY or tax corrected) and the mark moves.
 */
async function save(h, entity, body) {
  if (!(await migrated())) throw refuse_('COUNTRY_SETUP_NOT_MIGRATED', 'Country setup arrives after the next update. Selling and the rail work meanwhile.', 503);
  const v = clean(body);
  const cur = await profile(h, entity);
  if (cur.done && cur.country.code && cur.country.code !== v.country) throw refuse_('COUNTRY_CHANGE_IS_NEW_ENTITY', 'This shop is set up for ' + (cur.country.name || cur.country.code) + '. A shop in another country is a new registration.', 409);
  await h.query(
    `UPDATE identities SET country = $2, currency_code = $3, gstn = $4,
        policy_flags = COALESCE(policy_flags, '{}'::jsonb) || $5::jsonb
      WHERE identity_id = $1`,
    [entity, v.country, v.currency, v.tax.number, JSON.stringify(v.tax.registered && v.tax.scheme ? { gst_registration: v.tax.scheme } : {})]);
  const r = await h.query(
    `UPDATE entity_governance SET fy_start_month = $2, tax_registration = $3::jsonb, setup_source = $4::jsonb, country_setup_at = now() WHERE entity_id = $1`,
    [entity, v.fy_start_month, JSON.stringify(v.tax), JSON.stringify(v.source)]);
  if (!r.rowCount) {
    /* a shop minted before b254's trigger has no stamp row: the same row the trigger would have written (base @ platform-0) */
    await h.query(
      `INSERT INTO entity_governance (entity_id, constitution_key, installation_key, fy_start_month, tax_registration, setup_source, country_setup_at)
       VALUES ($1, 'base', 'platform-0', $2, $3::jsonb, $4::jsonb, now()) ON CONFLICT (entity_id) DO UPDATE
         SET fy_start_month = EXCLUDED.fy_start_month, tax_registration = EXCLUDED.tax_registration, setup_source = EXCLUDED.setup_source, country_setup_at = now()`,
      [entity, v.fy_start_month, JSON.stringify(v.tax), JSON.stringify(v.source)]);
  }
  forget(entity);
  return profile(h, entity);
}

/* ── THE GATE ─────────────────────────────────────────────────────────────────────────────────────────────────────────────── */
/** status(h, entity) → { books, code, why, required, country } — cached a minute; a read that throws keeps the last answer (or opens) and says so */
async function status(h, entity) {
  const k = String(entity), c = cache.get(k), now = Date.now();   /* clock-ok: a cache TTL, not a posting date */
  if (c && c.until > now) return c.st;
  let p;
  try { p = await profile(h, entity); }
  catch (e) {
    console.warn('[country-setup] profile unread for ' + k + ': ' + String(e && e.message).slice(0, 200) + (c ? ' — last answer stands' : ' — gate open for this call'));
    return c ? c.st : { books: true, code: null, why: null, required: false, country: null, unread: true };
  }
  const st = !p.country.code ? { books: false, code: 'NO_COUNTRY', why: p.pack.why, required: p.required, country: p.country }
    : !p.pack.books ? { books: false, code: 'NO_COUNTRY_PACK', why: p.pack.why, required: p.required, country: p.country }
    : p.required ? { books: false, code: 'COUNTRY_SETUP_PENDING', why: 'Finish the country setup first — country, money, financial year and tax registration.', required: true, country: p.country }
    : { books: true, code: null, why: null, required: false, country: p.country, pack: p.pack.id, version: p.pack.version };
  cache.set(k, { st, until: now + CACHE_MS });
  return st;
}
/** gate(h, entity): throws the 422 refusal (code + the sentence) when the books may not open for this shop */
async function gate(h, entity) {
  const st = await status(h, entity);
  if (!st.books) throw refuse_(st.code, st.why, 422);
  return st;
}
function forget(entity) { cache.delete(String(entity)); }
function _reset() { cache.clear(); }

module.exports = { migrated, profile, clean, save, status, gate, forget, nameOf, SCHEMES, _reset };
