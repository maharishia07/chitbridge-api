// @stage tested
// @stage-note [GOVERNANCE · COUNTRY SETUP] The entity's governance profile — country · currency · financial-year start · tax
// @stage-note registration — read once, set once by the owner after registration, and the gate every books route asks before it opens.
'use strict';
/**
 * OWNS the entity's country · currency · year start · tax registration, and countries() — the registered packs as the setup step offers them
 * CALLED BY routes/governance (GET/PUT /country-setup), routes/entities (GET /constitutions), the books routes (the gate)
 * FLOW read once → set once by the owner → every books route asks it before it opens
 * CARD 20-settings-governance-and-plan/country-setup
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
 * ── THE CONSTITUTION (CS2, 2026-10-13; owner: "at the time of registration … the country can change") ───────────────────────
 *   Country and currency are FIXED the moment the shop has ANY product or ANY transaction — a chit of any kind, a books entry, an opening
 *   balance: isConstituted(h, entity) is the ONE check (catalogue_items · chit_header · journal_entry, one EXISTS read). Before that it is
 *   still first-time setup: the owner may CORRECT the country on the step, and everything DERIVED is set again from the new pack in the same
 *   transaction — currency · financial year · tax scheme · time zone (the pack's one zone, or the one the owner picked of several) · the chart
 *   (books.reseedUnposted: a switched-on, never-posted ledger is seeded fresh — nothing exists, so nothing is converted). Logged who/when
 *   (books_change_log, when the ledger tables exist). After it: country and currency NEVER change — refused with the sentence and
 *   "Register a new business for <country>" (DECISIONS 2026-10-03). No conversion or migration path exists, by decision.
 *   timezone  identities.timezone — written HERE from the pack (M196 wrote the browser's at register; M210 dayOf reads it)
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
const log = require('./logger');
const R = require('./regulation'); /* adopted v1.36.0: status(country, { name }); reg-au came with it (AU1) */
const CACHE_MS = 60000;
const cache = new Map(); /* entity → { st, until } — the gate's answer, a minute at a time */
const SCHEMES = ['regular', 'composition'];
const ISO2 = /^[A-Z]{2}$/,
  ISO3 = /^[A-Z]{3}$/;
/**
 * ⭐ STD2: THE ONE SENTENCE for a shop whose money or year nobody stated (GOV-AU1 for MONEY — the NO_COUNTRY pattern). Code `NO_MONEY`;
 * read by books.enable / books-store.saveSetting (refused, 422) and till /snapshot (shop.money_why, painted beside "Money is …"). Never typed twice.
 */
const MONEY_UNSTATED = require('./regional').NO_CURRENCY_SAYS; /* N1: the words live with the reader that needs them (regional.currencyRead) */
/** ⭐ N0 (Athi, 2026-10-17: "get the country and currency set up at any cost"): THE ONE SENTENCE for a shop with no country or no money, which issues no document. Codes NO_COUNTRY / NO_MONEY; read by documentGate and the Country setup banner. */
const DOC_UNSTATED = 'Set the shop’s country and money first (Settings → Country setup) — nothing is billed or issued on a guess.';
/**
 * ⭐ T2-NATDEF: THE ONE READER OF A STATED CURRENCY — the first of `vals` that names one, upper-cased; none → null, never INR by name.
 * A caller with null prints the amount without a symbol (bill-privacy.money) or refuses with MONEY_UNSTATED / NO_MONEY; decimals(null) is 2.
 */
function currencyStated(...vals) {
  for (const v of vals) {
    const c = String(v == null ? '' : v)
      .trim()
      .toUpperCase();
    if (c) return c;
  }
  return null;
}
/**
 * ⭐ SEC3 · THE ONE "WHAT MONEY IS THIS SHOP IN" — its own stated currency, else its country PACK's, else null (never a guess; the caller
 * says MONEY_UNSTATED with code NO_MONEY). Lifted from till /snapshot (CX0 + STD2); the device signal chit is the second caller.
 * INT6a: read through currencyStated (one reader).
 */
function shopMoney(own, country) {
  const pack = !currencyStated(own) && country ? R.packFor(String(country)) : null;
  return currencyStated(own, pack && pack.currency);
}
/** the words beside an installation's own country — offerOf, acceptAtSignup and the register panel's row say it the same way (STD2) */
const RUNS_IN = (name) => 'this ChitBridge runs in ' + name;

/** the country's name a person reads — the ISO region name node's ICU carries (Intl.DisplayNames); else the code stands in, never a guess */
function nameOf(code) {
  if (!code) return '';
  try {
    const n = new Intl.DisplayNames(['en'], { type: 'region' }).of(code);
    if (n && n !== code && !/unknown/i.test(n)) return n;
  } catch (e) {
    log.fellBack('country-setup nameOf: did not parse — carried on without it', e, 'debug');
  }
  return code;
}
async function migrated() {
  return schema.hasColumn('entity_governance', 'country_setup_at');
}
function refuse_(code, message, nestedStatus) {
  const e = new Error(message);
  e.refused = true;
  e.status = nestedStatus || 422;
  e.code = code;
  e.say = message;
  return e;
}
/** a zone Intl knows (the one check — a renamed or mistyped zone must never reach identities.timezone, where it would blank every date) */
function zoneOk(z) {
  try {
    new Intl.DateTimeFormat('en', { timeZone: z });
    return true;
  } catch (e) {
    log.fellBack('country-setup zoneOk: did not parse — answered no', e, 'debug');
    return false;
  }
}
/** the IANA zones a pack names (engines v1.42.0 `timeZones`); [] for a pack-less country or an older pack */
function zonesOf(pack) {
  return pack && Array.isArray(pack.timeZones) ? pack.timeZones.slice() : [];
}
/** the tax's display name for a screen: the pack's own word (Consumption tax), else its scheme (GST) — never the scheme code alone (JCT) */
function taxNameOf_(pack) {
  return (pack.words && pack.words.taxName) || (pack.tax && pack.tax.scheme) || null;
}
/**
 * ⭐ the countries the setup step OFFERS = exactly the registered packs (CS1's rule), whatever the browser's locale — with what each pack derives.
 * GOV-SPIN widened it (additive): `tax { scheme, id, return }` and `languages` — what the register panel shows will apply, from the pack.
 */
function countries() {
  return R.list().map((item) => ({
    code: item.id,
    name: nameOf(item.id),
    currency: item.currency,
    fy_start_month: item.fiscalYear ? item.fiscalYear.startMonth : null,
    zones: zonesOf(item),
    locale: item.locale && item.locale.format ? item.locale.format : null,
    books: true,
    tax: {
      scheme: (item.tax && item.tax.scheme) || null,
      name: taxNameOf_(item),
      id: require('./profile').taxIdWordOf(item),
      return: (item.returns && item.returns.name) || null
    },
    languages: item.locale && Array.isArray(item.locale.langs) ? item.locale.langs.slice() : []
  }));
}

/* ── THE CONSTITUTION ─────────────────────────────────────────────────────────────────────────────────────────────────────── */
const SQL_CONST = `SELECT /* country-setup constituted */ EXISTS(SELECT 1 FROM catalogue_items WHERE entity_id = $1) AS products,
                          EXISTS(SELECT 1 FROM chit_header WHERE entity_id = $1) AS chits`;
const SQL_CONST_LEDGER = `, EXISTS(SELECT 1 FROM journal_entry WHERE entity_id = $1) AS entries`;
/**
 * constitution(h, entity) → { fixed, by: { products, chits, entries } } — ONE read: does the shop hold any product, any chit (of any kind,
 * either copy), any books entry (an opening balance is one). journal_entry is asked only once b273 created it (schema.hasTable).
 */
async function constitution(h, entity) {
  const ledger = await schema.hasTable('journal_entry');
  const r = (await h.query(SQL_CONST + (ledger ? SQL_CONST_LEDGER : ''), [entity])).rows[0] || {};
  const by = { products: !!r.products, chits: !!r.chits, entries: !!r.entries };
  return { fixed: by.products || by.chits || by.entries, by };
}
/** isConstituted(h, entity) → true once a product or a transaction exists: the country and the currency are fixed for good */
async function isConstituted(h, entity) {
  return (await constitution(h, entity)).fixed;
}
/** the words for WHAT fixed it — the refusal names it */
function fixedBy_(by) {
  const list = [];
  if (by.products) list.push('products');
  if (by.chits) list.push('chits');
  if (by.entries) list.push('books entries');
  return list.join(', ') || 'transactions';
}

/* ── READ ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────── */
const SQL_ID = `SELECT /* country-setup */ country, currency_code, gstn, timezone, policy_flags FROM identities WHERE identity_id = $1`;
const SQL_GOV = `SELECT /* country-setup */ fy_start_month, tax_registration, setup_source, country_setup_at FROM entity_governance WHERE entity_id = $1`;
/** the raw facts, two reads inside the shop's own transaction (h = the withEntity handle); gov is null before b299 */
async function facts(h, entity) {
  const mig = await migrated();
  const id = (await h.query(SQL_ID, [entity])).rows[0] || null;
  const gov = mig ? (await h.query(SQL_GOV, [entity])).rows[0] || null : null;
  return { mig, id, gov };
}
/** the tax facts as the step reads them: registered is true (a number, or the owner said so), false (ONLY the owner's explicit "not registered") or null (unknown, never assumed false) */
function taxFactsOf(taxReg, number, flags) {
  const flagged = flags.gst_registration ? String(flags.gst_registration).toLowerCase() : null;
  const scheme = (taxReg && taxReg.scheme) || flagged;
  return {
    registered: taxReg && typeof taxReg.registered === 'boolean' ? taxReg.registered : number ? true : null,
    number,
    scheme: scheme && SCHEMES.indexOf(scheme) >= 0 ? scheme : number ? 'regular' : null
  };
}
/** what the owner sent as "registered": true · false (only an explicit no) · null (not said — unknown is a state, never coerced to false, Athi 29 Oct) */
function registeredOf(answer) {
  if (answer === true || answer === 'yes' || answer === 'true') return true;
  return answer === false || answer === 'no' || answer === 'false' ? false : null;
}
/* ── ACC-198 · THE ONE READER OF "IS THIS SHOP REGISTERED FOR ITS TAX" (Athi 29 Oct, R13: unknown is a QUESTION, never a yes, never a no) ── */
const REGISTRATION_UNKNOWN = 'TAX_REGISTRATION_UNKNOWN';
/**
 * registrationOf({ number, scheme, tax_registration }) → 'regular' | 'composition' | 'unregistered' | 'unknown'. `number` = the tax id
 * (identities.gstn), `scheme` = policy_flags.gst_registration, `tax_registration` = entity_governance's { registered, scheme } (null = not said).
 * An owner's "not registered" wins; a number (or "registered") is a registration, its scheme as stated; nothing said and no number → 'unknown'.
 */
function registrationOf(given) {
  const facts = given || {};
  const said = saidOf_(facts.tax_registration);
  const scheme = String(said.scheme || facts.scheme || '').toLowerCase();
  if (said.registered === false || scheme === 'unregistered') return 'unregistered';
  if (said.registered !== true && !String(facts.number || '').trim()) return 'unknown';
  return scheme === 'composition' ? 'composition' : 'regular';
}
/** entity_governance.tax_registration as an object ({} when nothing was said) */
function saidOf_(taxRegistration) {
  return taxRegistration && typeof taxRegistration === 'object' ? taxRegistration : {};
}
/** registrationAsk(country) → { code, question } — what a reader answers for 'unknown', in the pack's word for its tax (tax-shelf.taxWordOf) */
function registrationAsk(country) {
  return { code: REGISTRATION_UNKNOWN, question: 'Is this business registered for ' + require('./tax-shelf').taxWordOf(country) + '?' };
}
/**
 * profile(h, entity, opt) → what the Country setup screen paints and the gate reads. { constitution: false } (the gate's minute-cached read)
 * skips the EXISTS read — the gate never needs to know whether the country may still change.
 */
async function profile(h, entity, opt) {
  const { mig, id, gov } = await facts(h, entity);
  const con = opt && opt.constitution === false ? null : await constitution(h, entity);
  const country = id && id.country ? String(id.country).toUpperCase() : null;
  const st = R.status(country, { name: nameOf(country) });
  const flags = id && id.policy_flags && typeof id.policy_flags === 'object' ? id.policy_flags : {};
  const taxReg = gov && gov.tax_registration && typeof gov.tax_registration === 'object' ? gov.tax_registration : null;
  const number = (taxReg && taxReg.number) || (id && id.gstn) || null;
  const pack = st.pack ? R.packFor(st.pack) : null;
  const fy = (gov && gov.fy_start_month) || (pack && pack.fiscalYear && pack.fiscalYear.startMonth) || null;
  return {
    migrated: mig,
    done: !!(gov && gov.country_setup_at),
    set_at: gov && gov.country_setup_at ? new Date(gov.country_setup_at).toISOString() : null,
    /* ⭐ required = the step must be completed before the books open: only once b299 holds the mark, and never for a shop it backfilled */
    required: mig && !(gov && gov.country_setup_at),
    country: { code: country, name: st.name || '' },
    currency: id && id.currency_code ? String(id.currency_code).toUpperCase() : pack ? pack.currency : null,
    fy_start_month: fy,
    tax: taxFactsOf(taxReg, number, flags),
    timezone: (id && id.timezone) || null,
    /* CS2: the pack's zones (one → set without asking; several → the step asks); the constitution (country · money fixed?) and what fixed it; the countries offered */
    zones: zonesOf(pack),
    constituted: con ? con.fixed : null,
    constituted_by: con ? con.by : null,
    countries: countries(),
    source: gov && gov.setup_source && typeof gov.setup_source === 'object' ? gov.setup_source : {},
    pack: { id: st.pack, version: st.version, books: st.books, code: st.code, why: st.why }
  };
}

/* ── WRITE ────────────────────────────────────────────────────────────────────────────────────────────────────────────────── */
/** N0: saving the step IS the one-tap confirm of an assumed (b299) country — its source stops saying backfill */
function confirmedSource(sourceMap) {
  return /^backfill/.test(sourceMap.country || '') ? Object.assign({}, sourceMap, { country: 'confirmed by the owner' }) : sourceMap;
}
/** what the owner may send: { country, currency, fy_start_month, tax: { registered, number, scheme }, source: { field: words } } → clean or a 400 in words */
function clean(b) {
  const o = b || {};
  const country = String(o.country || '')
    .trim()
    .toUpperCase();
  if (!ISO2.test(country)) throw refuse_('COUNTRY_SETUP_BAD', 'Pick the country the shop trades from.', 400);
  const currency = String(o.currency || '')
    .trim()
    .toUpperCase();
  if (!ISO3.test(currency)) throw refuse_('COUNTRY_SETUP_BAD', 'Pick the money the shop keeps its prices in (a three-letter code, like INR).', 400);
  const fy = Number(o.fy_start_month);
  if (!(Number.isInteger(fy) && fy >= 1 && fy <= 12)) throw refuse_('COUNTRY_SETUP_BAD', 'Pick the month the financial year starts.', 400);
  const t = o.tax && typeof o.tax === 'object' ? o.tax : {};
  const registered = registeredOf(t.registered);
  const number = registered === true
    ? String(t.number || '')
        .trim()
        .toUpperCase()
    : '';
  let scheme = registered === true
    ? String(t.scheme || 'regular')
        .trim()
        .toLowerCase()
    : null;
  if (registered === true && !number) throw refuse_('COUNTRY_SETUP_BAD', 'Registered for tax: type the registration number, or say not registered.', 400);
  /* ⭐ T2-POLICY (SET4): THE tax-number check — profile.taxIdRefusal, from the pack taxIdWordOf names (a GSTIN by its checksum, an ABN or
     TRN by the pack's validator, any number ≤ 40). The same check the profile's own save makes, so the column has one rule. */
  const idBad = require('./profile').taxIdRefusal(country, number);
  if (idBad) throw refuse_('COUNTRY_SETUP_BAD', idBad.why, 400);
  if (registered === true && country === 'IN') {
    if (SCHEMES.indexOf(scheme) < 0) throw refuse_('COUNTRY_SETUP_BAD', 'GST registration: regular or composition.', 400);
  } else if (registered === true && SCHEMES.indexOf(scheme) < 0) scheme = 'regular';
  const src = {};
  const s = o.source && typeof o.source === 'object' ? o.source : {};
  for (const k of ['country', 'currency', 'fy_start_month', 'tax', 'timezone']) if (s[k] != null) src[k] = String(s[k]).slice(0, 60);
  /* CS2: the zone the owner picked (a multi-zone country) — an IANA name Intl knows, or nothing (the pack's one zone is set without asking) */
  const timezone = String(o.timezone || '').trim();
  if (timezone && !zoneOk(timezone))
    throw refuse_('COUNTRY_SETUP_BAD', 'That time zone is not one the system knows (an IANA name, like Australia/Sydney).', 400);
  return {
    country,
    currency,
    fy_start_month: fy,
    tax: { registered, number: number || null, scheme },
    timezone: timezone || null,
    source: confirmedSource(src)
  };
}
/**
 * ⭐ derive(v, cur, pack) → the facts as the PACK sets them when the country is (re)chosen — ONE calculation, the server's:
 *   currency · fy_start_month from the pack; the tax scheme reset to 'regular' unless the pack is India's (composition is a GST scheme);
 *   timezone: the pack's one zone, else the owner's pick when it is one of the pack's, else refused in words (a multi-zone country ASKS).
 * A pack-less country derives nothing: what the owner typed stands, and the zone stays what registration wrote.
 */
function derive(v, cur, pack) {
  const out = Object.assign({}, v, { tax: Object.assign({}, v.tax) });
  const zones = zonesOf(pack);
  if (pack) {
    out.currency = pack.currency;
    out.fy_start_month = pack.fiscalYear ? pack.fiscalYear.startMonth : v.fy_start_month;
    if (v.country !== 'IN' && out.tax.scheme === 'composition') out.tax.scheme = 'regular';
  }
  if (zones.length === 1) out.timezone = zones[0];
  else if (zones.length > 1) {
    if (!v.timezone || zones.indexOf(v.timezone) < 0)
      throw refuse_('COUNTRY_SETUP_ZONE', "Pick the shop's time zone in " + nameOf(v.country) + ': ' + zones.join(', ') + '.', 400);
    out.timezone = v.timezone;
  } else out.timezone = v.timezone || (cur && cur.timezone) || null;
  return out;
}
/** tax_registration as the column holds it: SQL NULL while the owner has not said (unknown is never stored as { registered: false }) */
function taxJson(facts) {
  return facts.registered === null ? null : JSON.stringify(facts);
}
/**
 * save(h, entity, body, by) → the profile after the write. ONE transaction (the caller's withEntity): identities (country · currency
 * · gstn · policy_flags.gst_registration · timezone), entity_governance (fy · tax · sources · the mark) and, when the country changed on a
 * switched-on, never-posted ledger, the chart seeded fresh (books.reseedUnposted). 503 before b299.
 * CS2: BEFORE the shop is constituted (no product, no transaction) the country may be corrected and everything derived is set again from the
 * new pack (derive). AFTER it, a different country OR a different currency is refused — "Register a new business for <country>" (Athi,
 * 2026-10-03; sharpened 2026-10-13). The same country may be re-saved (FY, tax or zone corrected) and the mark moves. `by` is logged.
 */
async function save(h, entity, body, by) {
  if (!(await migrated()))
    throw refuse_('COUNTRY_SETUP_NOT_MIGRATED', 'Country setup arrives after the next update. Selling and the rail work meanwhile.', 503);
  let v = clean(body);
  const cur = await profile(h, entity);
  const pack = R.packFor(v.country);
  const countryChanged = !!(cur.country.code && cur.country.code !== v.country);
  const currencyChanged = !!(cur.currency && cur.currency !== v.currency);
  if (cur.constituted && (countryChanged || currencyChanged)) {
    throw refuse_(
      'COUNTRY_CHANGE_IS_NEW_ENTITY',
      'This shop is set up for ' +
        (cur.country.name || cur.country.code) +
        ' and ' +
        (cur.currency || 'its money') +
        ' and already has ' +
        fixedBy_(cur.constituted_by || {}) +
        ' — country and money never change. Register a new business for ' +
        (countryChanged ? nameOf(v.country) : 'another country or currency') +
        '.',
      409
    );
  }
  if (countryChanged) v = derive(v, cur, pack); /* first-time setup, the country corrected: the pack sets what it derives */
  else {
    /* the same country: what the owner typed stands (a currency is a suggestion, never a limit); the ZONE still comes from the pack — its one zone, or one of its several */
    const zones = zonesOf(pack);
    if (zones.length === 1) v.timezone = zones[0];
    else if (zones.length > 1) {
      if (!v.timezone && zones.indexOf(cur.timezone) >= 0) v.timezone = cur.timezone;
      if (!v.timezone || zones.indexOf(v.timezone) < 0)
        throw refuse_('COUNTRY_SETUP_ZONE', "Pick the shop's time zone in " + nameOf(v.country) + ': ' + zones.join(', ') + '.', 400);
    } else v.timezone = v.timezone || cur.timezone || null;
  }
  /* T2-POLICY: the tax number through the one writer's fragment ($4, profile.shopIdentitySql) and the flag through policy's ($5,
     policy.patchSql — coerced like every flag write); still ONE statement */
  const idSql = require('./profile').shopIdentitySql({ tax_id: v.tax.number }, 4);
  const pfSql = require('./policy').patchSql([], v.tax.registered && v.tax.scheme ? { gst_registration: v.tax.scheme } : {}, { op: 'merge' }, 5);
  await h.query(
    `UPDATE identities SET country = $2, currency_code = $3, ${idSql.sql},
        ${pfSql.sql},
        timezone = COALESCE($6, timezone)
      WHERE identity_id = $1`,
    [entity, v.country, v.currency].concat(idSql.params, pfSql.params, [v.timezone])
  );
  const r = await h.query(
    `UPDATE entity_governance SET fy_start_month = $2, tax_registration = $3::jsonb, setup_source = $4::jsonb, country_setup_at = now() WHERE entity_id = $1`,
    [entity, v.fy_start_month, taxJson(v.tax), JSON.stringify(v.source)]
  );
  if (!r.rowCount) {
    /* a shop minted before b254's trigger has no stamp row: the same row the trigger would have written (base @ platform-0) */
    await h.query(
      `INSERT INTO entity_governance (entity_id, constitution_key, installation_key, fy_start_month, tax_registration, setup_source, country_setup_at)
       VALUES ($1, 'base', 'platform-0', $2, $3::jsonb, $4::jsonb, now()) ON CONFLICT (entity_id) DO UPDATE
         SET fy_start_month = EXCLUDED.fy_start_month, tax_registration = EXCLUDED.tax_registration, setup_source = EXCLUDED.setup_source, country_setup_at = now()`,
      [entity, v.fy_start_month, taxJson(v.tax), JSON.stringify(v.source)]
    );
  }
  if (countryChanged) {
    /* the chart of a switched-on, never-posted ledger is seeded fresh from the new pack — same transaction; nothing posted exists (isConstituted) so nothing is converted.
       Before b272 there is no ledger to re-seed: reseedUnposted answers null (settingOf reads 42P01 as null) — not a reason to refuse the country.
       ⚠️ FX-AU1: NOT in a swallowing savepoint any more — a re-seed that fails must fail the correction (one transaction), never save AU beside
       India's chart and year. Its refusal (BOOKS_CONSTITUTED) reaches the owner in words. */
    const db = require('../db');
    const reseeded = await require('./books').reseedUnposted(h, entity, { country: v.country, by });
    /* who/when: the ledger's change log when it exists (the same log every ledger field writes to); the mark itself moves above */
    const S = require('./books-store');
    const rows = [
      ['country', cur.country.code, v.country],
      ['currency', cur.currency, v.currency],
      ['timezone', cur.timezone, v.timezone],
      ['fy_start_month', cur.fy_start_month, v.fy_start_month]
    ];
    for (const [field, old, now] of rows)
      if (String(old == null ? '' : old) !== String(now == null ? '' : now))
        await db.trySavepoint(h, () => S.logChange(h, entity, { by, table_name: 'entity_governance', row_id: entity, field, old, new: now }), null);
    forget(entity);
    const out = await profile(h, entity);
    out.rederived = { from: cur.country.code, to: v.country, chart: reseeded ? reseeded.accounts_added : 0, by: by || null, at: new Date().toISOString() };
    return out;
  }
  forget(entity);
  return profile(h, entity);
}

/* ── AT REGISTRATION (FX-AU1) ─────────────────────────────────────────────────────────────────────────────────────────────── */
/**
 * ⭐ guessOf(ctx) → { country, currency, timezone, source } — the browser's guess (CBGov.payload, M196) as registration STORES it, so a shop the
 * owner was shown as another country is never stored as India. null = no guess → identities.country NULL (no default since b376, GOV-AU1).
 * The SOURCE words are the server's, from the evidence, never the browser's label: the country is "your time zone" only when the zone sent
 * names that country (govcontext's own ZONES map — one rule), else "the language your browser reports"; the zone is "your device clock";
 * the currency is "the usual currency in <country>" only when it is that pack's money. Nothing guessed → nothing labelled.
 * Flow step: Onboarding · Register (docs/process/flows.json).
 */
function guessOf(ctx) {
  const c = ctx && typeof ctx === 'object' ? ctx : null;
  if (!c) return null;
  const country = ISO2.test(String(c.country || '').toUpperCase()) ? String(c.country).toUpperCase() : null;
  const currency = ISO3.test(String(c.currency_code || '').toUpperCase()) ? String(c.currency_code).toUpperCase() : null;
  const tz = String(c.timezone || '');
  const timezone = /^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+){1,2}$/.test(tz) && zoneOk(tz) ? tz : null;
  if (!country && !currency && !timezone) return null;
  if (!globalThis.CBGov) require('./govcontext.browser.js');
  const source = {};
  if (country)
    source.country =
      timezone && globalThis.CBGov && globalThis.CBGov.regionFromZone(timezone) === country ? 'your time zone' : 'the language your browser reports';
  const pack = country ? R.packFor(country) : null;
  if (currency) source.currency = pack && pack.currency === currency ? 'the usual currency in ' + nameOf(country) : 'your browser';
  if (timezone) source.timezone = 'your device clock';
  return { country, currency, timezone, source };
}
/**
 * noteGuess(h, entity, guess) — the guess's source words onto entity_governance.setup_source (b299's key, no new one), only while the step is
 * NOT done (a confirmed answer is never relabelled). The row the b254 trigger made, or the same row save() would make. false before b299.
 */
async function noteGuess(h, entity, guess) {
  if (!guess || !Object.keys(guess.source || {}).length || !(await migrated())) return false;
  await h.query(
    `INSERT INTO entity_governance (entity_id, constitution_key, installation_key, setup_source) VALUES ($1, 'base', 'platform-0', $2::jsonb)
     ON CONFLICT (entity_id) DO UPDATE SET setup_source = EXCLUDED.setup_source WHERE entity_governance.country_setup_at IS NULL`,
    [entity, JSON.stringify(guess.source)]
  );
  return true;
}

/* ── A REGIONAL SPIN STATES ITS COUNTRY (GOV-SPIN, 2026-10-14) ─────────────────────────────────────────────────────────────── */
/**
 * Athi, 14 Oct: "if we deploy a spin in australia region for australian businesses, then we setup governance layer as Australia … and they
 * have to accept to continue". The installation this api runs as (INSTALLATION_KEY, else 'platform-0') may STATE a country (b382). When it
 * does, registration OFFERS that country first, with its source in words; the registrant accepts it with reg-agree; another country is
 * possible only inside the constitution's `allowed.countries` (tighten-only; null = every registered pack). Nothing here invents a country.
 *   source codes: 'installation' (the installation states it) · 'browser' (the time-zone guess, M196) · 'chosen' (the registrant picked another)
 * Flow step: Onboarding · Register (docs/process/flows.json).
 */
const SOURCES = ['installation', 'browser', 'chosen'];
/**
 * ⭐ shopCountrySql(n) → the SQL that names the OWNING shop's country for a row added under it (a supplier, an actor, a connector, an integration):
 * `(SELECT country FROM identities WHERE identity_id = $n)`. GOV-AU1 (#164): every INSERT INTO identities names its country — these five read
 * it from ONE fragment (STD2), never a default. n = the placeholder number of the shop's identity_id in that statement.
 */
function shopCountrySql(n) {
  return '(SELECT country FROM identities WHERE identity_id = $' + Number(n) + ')';
}
/**
 * ⭐ abroadSql(alias, n) → the SQL test "this chit copy is a trade ABROAD" for the shop whose identity_id is $n (TRADE-SRV1 G3, the chit
 * lists' ?abroad=1): the copy's money (summary_json.currency_code) is not the shop's, OR a party on it (all_recipients — the sender is one)
 * has a country that is not the shop's. Both facts are already stored; no column, no backfill. Unstated on either side → not abroad
 * (`<>` against NULL is not true): an unknown is never counted as foreign. ⚠️ A counterparty's identities row hidden by RLS reads as
 * unknown — the currency test still holds for it. Pure; tested in tests/trade-srv1.test.cjs.
 */
function abroadSql(alias, n) {
  const a = String(alias).replace(/[^a-z_]/gi, ''),
    id = '$' + Number(n);
  const shopCur = '(SELECT currency_code FROM identities WHERE identity_id = ' + id + ')';
  return (
    '(upper(' +
    a +
    ".summary_json->>'currency_code') <> upper(" +
    shopCur +
    ')' +
    ' OR EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(' +
    a +
    ".all_recipients) = 'array' THEN " +
    a +
    ".all_recipients ELSE '[]'::jsonb END) r" +
    " JOIN identities i ON i.identity_id = CASE WHEN r->>'entity_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN (r->>'entity_id')::uuid END" +
    ' WHERE upper(i.country) <> upper(' +
    shopCountrySql(n) +
    ')))'
  );
}
function installationKey() {
  return String(process.env.INSTALLATION_KEY || '').trim() || 'platform-0';
}
/**
 * atSignup() → { installation: { key, country, name, fallback }, allowed: [ISO-2] | null, countries: [pack rows] } — what the register panel
 * paints, read from the ONE cascade (govresolve.resolveInstallationGovernance, cached a minute). `countries` is exactly the packs a registrant
 * may choose (allowed ∩ registered). Never throws: an unreadable installation answers country null (the panel then shows the browser's guess).
 */
async function atSignup() {
  const key = installationKey();
  let g = null;
  try {
    g = await require('./govresolve').resolveInstallationGovernance(key);
  } catch (e) {
    /* STD2: never silent — the panel then states no installation country and shows the browser's guess, which is what the person sees */
    require('./logger').warn('country-setup.atSignup: installation unread — the register panel offers no stated country', { key, why: String(e && e.message) });
    g = null;
  }
  const country = (g && g.basics && g.basics.country) || null;
  const allowed =
    g && g.allowed && Array.isArray(g.allowed.countries) && g.allowed.countries.length ? g.allowed.countries.map((item) => String(item).toUpperCase()) : null;
  const list = countries().filter((item) => !allowed || allowed.indexOf(item.code) >= 0);
  /* the installation's own zone — the zone a several-zone country falls back to when the device's is not one of its own. ⚠️ The ROW's zone when it
     is one of the stated country's pack zones: base's `allowed.timezones` (b74) lists IN/US/MX/UK zones only, and bounded() would swap an
     Australian spin's Australia/Sydney for Asia/Kolkata (custodian finding, GOV-SPIN) — the pack is the authority on its own country's zones. */
  const rowZone = g && g.installation && g.installation.timezone,
    packZones = country ? zonesOf(R.packFor(country)) : [];
  const timezone = rowZone && packZones.indexOf(rowZone) >= 0 ? rowZone : (g && g.basics && g.basics.timezone) || null;
  return { installation: { key, country, name: nameOf(country), fallback: !!(g && g.fallback) }, allowed, countries: list, timezone };
}
/** may(country, at) → true when a registrant may take this country here: a registered pack, inside the envelope */
function mayTake(country, at) {
  return !!(country && at && at.countries.some((item) => item.code === country));
}
/**
 * offerOf(guess, at) → the guess-shaped answer registration STORES (registerNew, in place of guessOf's): { country, currency, timezone, source, by }.
 * The installation's stated country wins over the browser's; its money is that pack's; the device's zone is kept only when it is one of the
 * pack's (else the pack's one zone, else the installation's own when it is the pack's, else none — Country setup asks). No installation
 * country → the browser's guess unchanged (by 'browser'), or null. The words in `source` are what Country setup paints beside each value.
 */
function offerOf(guess, at) {
  const stated = at && at.installation && at.installation.country;
  if (!stated) return guess ? Object.assign({}, guess, { by: guess.country ? 'browser' : null }) : null;
  const pack = R.packFor(stated),
    zones = zonesOf(pack),
    name = nameOf(stated);
  const devZone = guess && guess.timezone,
    instZone = at.timezone;
  const timezone =
    devZone && zones.indexOf(devZone) >= 0
      ? devZone
      : zones.length === 1
        ? zones[0]
        : instZone && zones.indexOf(instZone) >= 0
          ? instZone
          : !zones.length
            ? devZone || null
            : null;
  const source = { country: RUNS_IN(name) };
  const currency = (pack && pack.currency) || (guess && guess.country === stated ? guess.currency : null) || null;
  if (currency) source.currency = 'the usual currency in ' + name;
  if (timezone) source.timezone = timezone === devZone ? 'your device clock' : 'the ' + name + ' pack';
  return { country: stated, currency, timezone, source, by: 'installation' };
}
/**
 * sourceOf(country, at, zone) → the source code the server RECORDS for a country taken at sign-up — 'installation' (this ChitBridge states it) ·
 * 'browser' (the device zone's country, M196) · 'chosen'. ONE rule: acceptAtSignup records it, offered() shows it before the tick (STD2).
 */
function sourceOf(country, at, zone) {
  if (!globalThis.CBGov) require('./govcontext.browser.js');
  const zoneCountry = globalThis.CBGov && zone ? globalThis.CBGov.regionFromZone(String(zone)) : '';
  return country === (at && at.installation && at.installation.country) ? 'installation' : country === zoneCountry ? 'browser' : 'chosen';
}
/**
 * offered(at, zone) → at.countries, each row with `offer { timezone, from, source }` — the zone the server WILL store if this country is accepted
 * (offerOf's rule, the device zone first) and the source it will record (sourceOf). The register panel paints these; it computes nothing (STD2,
 * was register-form regZoneFor / regSourceOf). zone = the device's IANA zone (GET /entities/constitutions?tz=); an unknown zone counts as none.
 */
function offered(at, zone) {
  const tz = zone && zoneOk(String(zone)) ? String(zone) : null;
  return (at.countries || []).map((item) => {
    const off = offerOf({ country: null, currency: null, timezone: tz }, { installation: { country: item.code }, timezone: at.timezone });
    return Object.assign({}, item, { offer: { timezone: off.timezone || null, from: off.source.timezone || null, source: sourceOf(item.code, at, tz) } });
  });
}
/**
 * stampAtSignup(h, identity) — SET-38 (walk R6): the registrant ACCEPTED the country, money and zone they were shown (reg-agree), so Country
 * setup is done and Accounts open. Stamps through the ONE writer (save(): identities · entity_governance · country_setup_at), never a second
 * UPDATE. The country stays changeable until the constitution is fixed (save's own rule, DECISIONS 2026-10-13) — the stamp locks nothing.
 * What the pack cannot answer yet (no money, no year, a multi-zone country with no zone, a number that fails its check) is left unstamped:
 * the step then ASKS, as before. In a savepoint — a refusal never costs the sign-up. → true when stamped.
 */
async function stampAtSignup(handle, identity, words) {
  const setup = await profile(handle, identity, { constitution: false });
  if (setup.done) return false;
  if (!setup.country.code || !setup.currency || !setup.fy_start_month) {
    log.fellBack('country-setup stampAtSignup: the pack gave no country, money or year — left unstamped, the step asks', new Error('COUNTRY_SETUP_UNANSWERED'), 'info');
    return false;
  }
  /* what the owner accepted carries the same words on money and year, so the step reads "you accepted it", not "what you set" (tax stays "not set yet") */
  const source = Object.assign({ currency: words, fy_start_month: words }, setup.source);
  /* ⭐ tax: the sign-up never answers "are you registered?" — the owner does. profile() gives registered null (unknown) unless a number or an earlier answer exists, clean() keeps null, and save() stores SQL NULL, never { registered: false }. "Not registered" is stored only from the owner's explicit choice in the step. */
  const body = { country: setup.country.code, currency: setup.currency, fy_start_month: setup.fy_start_month, tax: setup.tax, timezone: setup.timezone, source };
  let refusal = null;
  const stamped = await require('../db').trySavepoint(
    handle,
    async () => {
      try {
        await save(handle, identity, body, 'registration');
      } catch (failure) {
        refusal = failure;
        throw failure;
      }
      return true;
    },
    false
  );
  if (!stamped) log.fellBack('country-setup stampAtSignup: refused (' + ((refusal && refusal.code) || 'error') + ') — left unstamped, the step asks', refusal || new Error('unstamped'), 'info');
  return stamped;
}
/** the accepted country's words onto setup_source (only while the step is not done), then the stamp — b299's key, the one writer */
async function recordAcceptance(handle, identity, words) {
  if (!(await migrated())) return;
  await handle.query(
    `UPDATE entity_governance SET setup_source = COALESCE(setup_source, '{}'::jsonb) || jsonb_build_object('country', $2::text)
                    WHERE entity_id = $1 AND country_setup_at IS NULL`,
    [identity, words]
  );
  await stampAtSignup(handle, identity, words);
}
/**
 * acceptAtSignup(identity, ctx, at) — the country the registrant ACCEPTED with reg-agree (verify, routes/signin.js). ctx: the register panel's
 * payload { country, country_source }. → { country, source } to record, or null when nothing acceptable was sent (then nothing changes).
 *   · the source is the SERVER's call from the facts, never the page's label: the installation's own country is 'installation'; the device's
 *     zone country is 'browser'; anything else allowed is 'chosen'. A country outside the envelope is refused (null) — the offer stands.
 *   · the stored country MOVES only when it differs, only while Country setup is not done, and only while the shop holds nothing
 *     (isConstituted) — a sign-in can never re-country a trading shop. Moving re-derives the money (the pack's) and the zone (kept if the
 *     pack's, else its one zone, else none), the same rule as offerOf. h = a withEntity handle.
 */
async function acceptAtSignup(h, identity, ctx, at) {
  const want = ISO2.test(String((ctx && ctx.country) || '').toUpperCase()) ? String(ctx.country).toUpperCase() : null;
  if (!want || SOURCES.indexOf(String(ctx.country_source || '')) < 0 || !mayTake(want, at)) return null;
  const source = sourceOf(want, at, ctx.timezone);
  const id = (await h.query(`SELECT country, timezone FROM identities WHERE identity_id = $1`, [identity])).rows[0] || {};
  if (String(id.country || '').toUpperCase() !== want) {
    const mig = await migrated();
    const done = mig
      ? ((await h.query(`SELECT country_setup_at FROM entity_governance WHERE entity_id = $1`, [identity])).rows[0] || {}).country_setup_at
      : null;
    if (done || (await isConstituted(h, identity))) return null;
    const off = offerOf({ country: null, currency: null, timezone: id.timezone || null }, { installation: { country: want }, timezone: at.timezone });
    await h.query(`UPDATE identities SET country = $2, currency_code = COALESCE($3, currency_code), timezone = $4 WHERE identity_id = $1`, [
      identity,
      want,
      off.currency,
      off.timezone
    ]);
    forget(identity);
  }
  const words = source === 'installation' ? RUNS_IN(nameOf(want)) : source === 'browser' ? 'your time zone' : 'you chose it at sign-up';
  await recordAcceptance(h, identity, words);
  return { country: want, source };
}

/* ── THE GATE ─────────────────────────────────────────────────────────────────────────────────────────────────────────────── */
/** status(h, entity) → { books, code, why, required, country } — cached a minute; a read that throws keeps the last answer (or opens) and says so */
async function status(h, entity) {
  const k = String(entity),
    c = cache.get(k),
    now = Date.now(); /* clock-ok: a cache TTL, not a posting date */
  if (c && c.until > now) return c.st;
  let p;
  try {
    p = await profile(h, entity, { constitution: false });
  } catch (e) {
    console.warn(
      '[country-setup] profile unread for ' + k + ': ' + String(e && e.message).slice(0, 200) + (c ? ' — last answer stands' : ' — gate open for this call')
    );
    return c ? c.st : { books: true, code: null, why: null, required: false, country: null, unread: true };
  }
  const st = !p.country.code
    ? { books: false, code: 'NO_COUNTRY', why: p.pack.why, required: p.required, country: p.country }
    : !p.pack.books
      ? { books: false, code: 'NO_COUNTRY_PACK', why: p.pack.why, required: p.required, country: p.country }
      : p.required
        ? {
            books: false,
            code: 'COUNTRY_SETUP_PENDING',
            why: 'Finish the country setup first — country, money, financial year and tax registration.',
            required: true,
            country: p.country
          }
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
/** N3: the shop's own facts, one read - country, money, zone. null = no row (or a read that threw: a blip is no evidence, so the gate stays open) */
async function statedFacts(read, entity) {
  try {
    return (await read('SELECT country, currency_code, timezone FROM identities WHERE identity_id = $1', [entity])).rows[0] || null;
  } catch (failure) {
    log.fellBack('country-setup statedFacts: did not read - gate open for this call', failure, 'debug');
    return null;
  }
}
/**
 * documentRefusal(row) -> null when the shop has stated its country AND its money (its own, else its country pack's); else
 * { status: 422, code: NO_COUNTRY | NO_MONEY, message: DOC_UNSTATED }. An India shop, backfilled or not, passes unchanged.
 */
function documentRefusal(row) {
  if (!row) return null;
  const country = row.country ? String(row.country).trim().toUpperCase() : '';
  if (!country) return { status: 422, code: 'NO_COUNTRY', message: DOC_UNSTATED };
  if (!shopMoney(row.currency_code, country)) return { status: 422, code: 'NO_MONEY', message: DOC_UNSTATED };
  return null;
}
/** documentGate(read, entity) -> the refusal or null; `read` is a (sql, params) query function */
async function documentGate(read, entity) {
  return documentRefusal(await statedFacts(read, entity));
}
/**
 * N3 (NEUTRAL-CORE): the shop's CLOCK - { zone, locale } from its identity row: its own zone, else its country pack's first zone; the locale is the pack's
 * money/date tag. Nothing stated -> { zone: null, locale: null }: a reader then cuts at UTC, never at India's clock.
 */
function clockOf(row) {
  const found = row || {};
  const pack = found.country ? R.packFor(String(found.country).trim().toUpperCase()) : null;
  return { zone: String(found.timezone || '').trim() || zonesOf(pack)[0] || null, locale: localeOfPack(pack) };
}
/** the date/money locale tag a pack names (en-IN, en-AU ...), or null */
function localeOfPack(pack) {
  return (pack && pack.locale && pack.locale.format) || null;
}
/** a date as the shop writes it (31 Oct 2026): its locale, its zone; no clock stated -> UTC and an unambiguous day-month-year form */
function datePhrase(date, clock) {
  const zone = clock && clock.zone && zoneOk(clock.zone) ? clock.zone : 'UTC';
  return new Date(date).toLocaleDateString((clock && clock.locale) || 'en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: zone });
}
/** a SQL CASE that names the zone of a row's country from the registered packs (alias.country -> the pack's first zone); NULL when no pack names one - the SQL twin of clockOf */
function zoneCaseSql(alias) {
  if (!/^\w+$/.test(alias)) throw new Error('zoneCaseSql: a plain alias');
  const arms = R.list()
    .filter((pack) => ISO2.test(pack.id) && /^[A-Za-z0-9_/+-]+$/.test(zonesOf(pack)[0] || ''))
    .map((pack) => "WHEN '" + pack.id + "' THEN '" + zonesOf(pack)[0] + "'");
  return arms.length ? 'CASE ' + alias + '.country ' + arms.join(' ') + ' END' : 'NULL';
}
/** N4: the month a country's financial year starts, from its pack; null when the country is unstated or has no pack */
function fyStartOf(country) {
  const pack = country ? R.packFor(String(country).trim().toUpperCase()) : null;
  return (pack && pack.fiscalYear && pack.fiscalYear.startMonth) || null;
}
/* ACC-198: the shop's registration answer, a minute at a time (the gate's pattern); save() forgets it */
const regCache = new Map();
/**
 * registrationOfShop(entity) → registrationOf over the shop's own rows (identities + entity_governance, read under its RLS), or null before
 * b299 (no place an answer could be kept, so nothing is asked). Read by books-hooks only for a seller with no tax number.
 */
async function registrationOfShop(entity) {
  const key = String(entity),
    cached = regCache.get(key),
    now = Date.now(); /* clock-ok: a cache TTL, not a posting date */
  if (cached && cached.until > now) return cached.answer;
  if (!(await migrated())) return null;
  const answer = await require('../db').withEntity(entity, async (handle) => {
    const rows = await facts(handle, entity);
    const identity = rows.id || {};
    const said = saidOf_(rows.gov && rows.gov.tax_registration);
    const flags = identity.policy_flags && typeof identity.policy_flags === 'object' ? identity.policy_flags : {};
    return registrationOf({ number: said.number || identity.gstn, scheme: flags.gst_registration, tax_registration: rows.gov ? rows.gov.tax_registration : null });
  });
  regCache.set(key, { answer, until: now + CACHE_MS });
  return answer;
}
function forget(entity) {
  cache.delete(String(entity));
  regCache.delete(String(entity));
}
function _reset() {
  cache.clear();
  regCache.clear();
}

module.exports = {
  currencyStated,
  migrated,
  profile,
  clean,
  derive,
  save,
  status,
  gate,
  forget,
  registrationOf,
  registrationAsk,
  registrationOfShop,
  REGISTRATION_UNKNOWN,
  nameOf,
  stampAtSignup,
  countries,
  constitution,
  isConstituted,
  zonesOf,
  guessOf,
  noteGuess,
  atSignup,
  offerOf,
  offered,
  sourceOf,
  acceptAtSignup,
  installationKey,
  SOURCES,
  MONEY_UNSTATED,
  DOC_UNSTATED,
  documentGate,
  documentRefusal,
  statedFacts,
  clockOf,
  datePhrase,
  zoneCaseSql,
  fyStartOf,
  shopMoney,
  RUNS_IN,
  shopCountrySql,
  abroadSql,
  SCHEMES,
  _reset
};
