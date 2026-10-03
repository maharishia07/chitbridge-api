/* ADOPTED BUNDLE from chitbridge-engines · tax-packs v1.20.0 + tax-slab v1.2.0 + tax v1.20.0 — DO NOT EDIT HERE. Each part below is a release, unchanged. */
/* ADOPTED from chitbridge-engines v1.20.0 · tax-packs · sha256 3ef519adebb1da0de7b6ced61f0d728c8075bb9b0251a20099ae31d826cb272e — DO NOT EDIT HERE. Change it in chitbridge-engines, release a version, then run tools/adopt.cjs. */
/* chitbridge-engines · tax-packs. Edited ONLY in chitbridge-engines/src/tax-packs.js; every platform adopts a released version of it. */
(function (root) {
'use strict';
/**
 * tax-packs.js — WHAT A COUNTRY'S TAX IS, AS DATA. The tax engines hold the arithmetic; this file holds the country.
 *
 * Athi, 2026-09-27: *"we create the tax engine in such a way that it works for any country and each platform can refer
 * this codebase."* So a country is an ENTRY here, never a branch in tax.js. Adding one is a data change with its own tests;
 * the engines do not change.
 *
 * ── WHAT A PACK SAYS ────────────────────────────────────────────────────────────────────────────────────────────
 *   country           ISO 3166-1 alpha-2
 *   scheme            the scheme code a slab and an invoice carry ('GST', 'VAT' …)
 *   supply            how the supply is classified, which decides the heads:
 *                       'state'  — the seller's state against the PLACE OF SUPPLY: same state → split across two heads
 *                                  (CGST + SGST), another state → one head (IGST). India.
 *                       'border' — the seller's country against the buyer's: domestic → the full rate on one head,
 *                                  cross-border → nothing charged (the buyer accounts for it). A VAT country.
 *   rates             the rates the scheme DEFINES, offered as a picker. ⚠️ A MENU, NOT A MAPPING: it says which numbers
 *                     are legal to type, not which one a product attracts (that is per HSN, and the merchant's).
 *   invoice_round_to  the unit the invoice TOTAL rounds to; the difference is declared as RndOffAmt, never hidden.
 *   source            where the rule comes from, so it can be checked rather than believed.
 *
 * ⭐ DEFAULT_COUNTRY is the pack a party with NO country is read under. It is India because every invoice this engine has
 * ever produced was read that way — the default is not new, it is NAMED here instead of being a bare 'GST' inside tax.js.
 * ⚠️ A scheme with no pack (a slab citing 'VAT' before its country is written) keeps the behaviour it always had: the
 * border rule, and a whole-unit round. That round is wrong for most VAT countries — a pack for the country fixes it.
 *
 * ── ZERO DEPENDENCIES · DATA ONLY ───────────────────────────────────────────────────────────────────────────────
 */
const PACKS = Object.freeze({
  IN: Object.freeze({
    country: 'IN',
    scheme: 'GST',
    supply: 'state',
    rates: Object.freeze([0, 0.25, 3, 5, 12, 18, 28]),
    /* ⭐ TO THE PAISA (Athi, 2026-10-02: "keep it up to paisa … one computation and one value"). The total is the sum
       of its declared components; a rupee-rounded figure, if ever shown, is displayed beside it — never posted. */
    invoice_round_to: 0.01,
    /* ⭐ REVERSE CHARGE AS DATA (v1.20.0). s.9(3) CGST Act: the Government notifies categories whose tax the RECIPIENT pays; s.9(4):
       the same where an UNREGISTERED supplier supplies a registered recipient. tax.determine reads this table; nothing in tax.js
       names a category. Each row: id · kind · section · name · codes (SAC / HSN prefixes, matched left to right) · rates (the legal
       rate options, with whether credit is allowed at that rate; a line that gives no rate takes the first) · always (true: the
       recipient pays whoever the supplier is; false: only when the supplier is unregistered) · supplier / recipient (who must be what)
       · notification (number and date) and serial. ⚠️ The serials and rates are as notified when written (2026-10); the notification
       is the authority — confirm against the Gazette before filing a return. Goods rows carry rate null: the line's own HSN rate stands. */
    rcm: Object.freeze({
      source: 'CGST Act 2017 s.9(3), s.9(4); IGST Act 2017 s.5(3), s.5(4); Notification 13/2017-Central Tax (Rate) dated 28-06-2017 (services) and Notification 4/2017-Central Tax (Rate) dated 28-06-2017 (goods), each as amended; Rule 86(2) and s.49(4) for the cash-only payment',
      categories: Object.freeze([
        Object.freeze({ id: 'gta', kind: 'service', section: '9(3)', name: 'Goods transport agency (GTA) service, goods by road', codes: Object.freeze(['9965', '9967']),
          rates: Object.freeze([Object.freeze({ rate: 5, itc: false, note: 'without input tax credit on goods and services used in the supply' }), Object.freeze({ rate: 18, itc: true, note: 'with credit; the GTA opts by declaration (from 22-09-2025; 12% before)' })]),
          always: true, supplier: 'goods transport agency', recipient: 'a registered person, factory, society, co-operative society, body corporate, partnership firm or casual taxable person',
          notification: '13/2017-CT(Rate) dated 28-06-2017', serial: '1' }),
        Object.freeze({ id: 'legal', kind: 'service', section: '9(3)', name: "Legal services by an advocate or a firm of advocates", codes: Object.freeze(['9982']),
          rates: Object.freeze([Object.freeze({ rate: 18, itc: true })]), always: true, supplier: 'an individual advocate (including a senior advocate) or a firm of advocates', recipient: 'any business entity',
          notification: '13/2017-CT(Rate) dated 28-06-2017', serial: '2' }),
        Object.freeze({ id: 'arbitral', kind: 'service', section: '9(3)', name: 'Services of an arbitral tribunal', codes: Object.freeze(['9982']),
          rates: Object.freeze([Object.freeze({ rate: 18, itc: true })]), always: true, supplier: 'an arbitral tribunal', recipient: 'any business entity',
          notification: '13/2017-CT(Rate) dated 28-06-2017', serial: '3' }),
        Object.freeze({ id: 'sponsorship', kind: 'service', section: '9(3)', name: 'Sponsorship services', codes: Object.freeze(['9983', '998397']),
          rates: Object.freeze([Object.freeze({ rate: 18, itc: true })]), always: true, supplier: 'any person', recipient: 'a body corporate or a partnership firm',
          notification: '13/2017-CT(Rate) dated 28-06-2017', serial: '4' }),
        Object.freeze({ id: 'govt_services', kind: 'service', section: '9(3)', name: 'Services by the Central or a State Government, Union territory or local authority to a business entity (the notified exceptions apart)', codes: Object.freeze(['9991']),
          rates: Object.freeze([Object.freeze({ rate: 18, itc: true })]), always: true, supplier: 'the Central Government, a State Government, a Union territory or a local authority', recipient: 'any business entity',
          notification: '13/2017-CT(Rate) dated 28-06-2017', serial: '5' }),
        Object.freeze({ id: 'director', kind: 'service', section: '9(3)', name: 'Services by a director of a company or body corporate to that company or body corporate', codes: Object.freeze([]),
          rates: Object.freeze([Object.freeze({ rate: 18, itc: true })]), always: true, supplier: 'a director', recipient: 'the company or body corporate',
          notification: '13/2017-CT(Rate) dated 28-06-2017, as amended by 29/2018-CT(Rate)', serial: null }),
        Object.freeze({ id: 'insurance_agent', kind: 'service', section: '9(3)', name: 'Services by an insurance agent to a person carrying on insurance business', codes: Object.freeze(['9971']),
          rates: Object.freeze([Object.freeze({ rate: 18, itc: true })]), always: true, supplier: 'an insurance agent', recipient: 'a person carrying on insurance business',
          notification: '13/2017-CT(Rate) dated 28-06-2017', serial: null }),
        Object.freeze({ id: 'recovery_agent', kind: 'service', section: '9(3)', name: 'Services by a recovery agent to a bank, financial institution or non-banking financial company', codes: Object.freeze(['9971']),
          rates: Object.freeze([Object.freeze({ rate: 18, itc: true })]), always: true, supplier: 'a recovery agent', recipient: 'a bank, financial institution or NBFC',
          notification: '13/2017-CT(Rate) dated 28-06-2017', serial: null }),
        Object.freeze({ id: 'security', kind: 'service', section: '9(3)', name: 'Security services (other than by a body corporate) to a registered person', codes: Object.freeze(['9985']),
          rates: Object.freeze([Object.freeze({ rate: 18, itc: true })]), always: true, supplier: 'any person other than a body corporate', recipient: 'a registered person',
          notification: '13/2017-CT(Rate) dated 28-06-2017, as amended by 29/2018-CT(Rate)', serial: null }),
        Object.freeze({ id: 'rent_unregistered', kind: 'service', section: '9(4)', name: 'Renting of immovable property by an unregistered person to a registered person', codes: Object.freeze(['9972']),
          rates: Object.freeze([Object.freeze({ rate: 18, itc: true })]), always: false, supplier: 'an unregistered person', recipient: 'a registered person',
          notification: '13/2017-CT(Rate) dated 28-06-2017, as amended by 5/2022-CT(Rate) dated 13-07-2022', serial: null }),
        Object.freeze({ id: 'cashew', kind: 'goods', section: '9(3)', name: 'Cashew nuts, not shelled or peeled, from an agriculturist', codes: Object.freeze(['0801']),
          rates: Object.freeze([Object.freeze({ rate: null, itc: true })]), always: true, supplier: 'an agriculturist', recipient: 'a registered person',
          notification: '4/2017-CT(Rate) dated 28-06-2017', serial: null }),
        Object.freeze({ id: 'raw_cotton', kind: 'goods', section: '9(3)', name: 'Raw cotton from an agriculturist', codes: Object.freeze(['5201']),
          rates: Object.freeze([Object.freeze({ rate: null, itc: true })]), always: true, supplier: 'an agriculturist', recipient: 'a registered person',
          notification: '4/2017-CT(Rate) dated 28-06-2017', serial: null }),
        Object.freeze({ id: 'tobacco_leaves', kind: 'goods', section: '9(3)', name: 'Tobacco leaves from an agriculturist', codes: Object.freeze(['2401']),
          rates: Object.freeze([Object.freeze({ rate: null, itc: true })]), always: true, supplier: 'an agriculturist', recipient: 'a registered person',
          notification: '4/2017-CT(Rate) dated 28-06-2017', serial: null }),
        Object.freeze({ id: 'bidi_wrapper_leaves', kind: 'goods', section: '9(3)', name: 'Bidi wrapper leaves (tendu)', codes: Object.freeze(['1404']),
          rates: Object.freeze([Object.freeze({ rate: null, itc: true })]), always: true, supplier: 'any person', recipient: 'a registered person',
          notification: '4/2017-CT(Rate) dated 28-06-2017', serial: null }),
        Object.freeze({ id: 'silk_yarn', kind: 'goods', section: '9(3)', name: 'Silk yarn made out of raw silk or silk worm cocoons, by a manufacturer of silk yarn', codes: Object.freeze(['5004', '5005', '5006']),
          rates: Object.freeze([Object.freeze({ rate: null, itc: true })]), always: true, supplier: 'a manufacturer of silk yarn', recipient: 'a registered person',
          notification: '4/2017-CT(Rate) dated 28-06-2017', serial: null }),
      ]),
    }),
    /* ⭐ v1.19.0 — COMPLIANCE THRESHOLDS AS DATA, each with the notification it comes from (a threshold is law, not code: it
       changes by notification, so it is a row here and never a number inside einvoice.js). All money is in PAISE.
       Re-check at filing / GSP-connection time; `from` is the first day the row applies, the latest row not after `asOf` wins. */
    einvoice: Object.freeze({
      /* e-invoicing (IRN) is mandatory for a registered person whose aggregate turnover in ANY financial year from 2017-18 onward
         EXCEEDS the limit — Rule 48(4) CGST Rules, limits notified under it. B2B, export, SEZ, deemed export only; never a B2C bill. */
      aato_thresholds: Object.freeze([
        Object.freeze({ from: '2020-10-01', above_minor: 500e7 * 100, cite: 'Notification 61/2020-Central Tax (30 Jul 2020): above Rs 500 crore' }),
        Object.freeze({ from: '2021-01-01', above_minor: 100e7 * 100, cite: 'Notification 88/2020-Central Tax (10 Nov 2020): above Rs 100 crore' }),
        Object.freeze({ from: '2021-04-01', above_minor: 50e7 * 100, cite: 'Notification 5/2021-Central Tax (8 Mar 2021): above Rs 50 crore' }),
        Object.freeze({ from: '2022-04-01', above_minor: 20e7 * 100, cite: 'Notification 1/2022-Central Tax (24 Feb 2022): above Rs 20 crore' }),
        Object.freeze({ from: '2022-10-01', above_minor: 10e7 * 100, cite: 'Notification 17/2022-Central Tax (1 Aug 2022): above Rs 10 crore' }),
        Object.freeze({ from: '2023-08-01', above_minor: 5e7 * 100, cite: 'Notification 10/2023-Central Tax (10 May 2023): above Rs 5 crore' }),
      ]),
      /* who is outside it whatever the turnover: Notification 13/2020-Central Tax (21 Mar 2020) as amended — insurers, banks, NBFCs,
         GTAs, passenger transport, multiplex admission, SEZ units (other than SEZ developers), a government department / local
         authority. The caller says `exempt_class`; the engine does not guess a business's class. */
      exempt_note: 'Notification 13/2020-Central Tax (as amended): insurer, bank / NBFC, GTA, passenger transport, multiplex admission, SEZ unit, government department / local authority',
      /* an invoice must be REPORTED to the IRP within this many days of its date, for this turnover — the IRP rejects an older one.
         ⚠️ an IRP / GSTN advisory (13 Dec 2024), not a notification; it said 30 days from 1 Apr 2025 for aggregate turnover Rs 10 crore and above. */
      reporting_window: Object.freeze([
        Object.freeze({ from: '2025-04-01', at_least_minor: 10e7 * 100, days: 30, cite: 'GSTN advisory, 13 Dec 2024 (IRP): 30 days from the invoice date, turnover Rs 10 crore and above, from 1 Apr 2025' }),
      ]),
      /* the document types an IRN is issued for, and the schema's own codes (INV-01 DocDtls.Typ) */
      doc_types: Object.freeze({ invoice: 'INV', credit_note: 'CRN', debit_note: 'DBN' }),
      /* SupTyp values that an e-invoice is issued for (INV-01 TranDtls.SupTyp). B2C is not among them. */
      sup_types: Object.freeze(['B2B', 'SEZWP', 'SEZWOP', 'EXPWP', 'EXPWOP', 'DEXP']),
      schema: 'GSTN e-invoice schema INV-01, version 1.1 (einvoice1.gst.gov.in, "e-Invoice Schema version 1.1")',
    }),
    /* HSN digits an invoice must carry, by the supplier's aggregate turnover of the PRECEDING financial year:
       up to Rs 5 crore: 4 digits · above Rs 5 crore: 6 digits — Notification 78/2020-Central Tax (15 Oct 2020), from 1 Apr 2021;
       and the schema accepts only 4, 6 or 8. */
    hsn_digits: Object.freeze([
      Object.freeze({ from: '2021-04-01', above_minor: 0, digits: 4, cite: 'Notification 78/2020-Central Tax (15 Oct 2020): 4 digits up to Rs 5 crore' }),
      Object.freeze({ from: '2021-04-01', above_minor: 5e7 * 100, digits: 6, cite: 'Notification 78/2020-Central Tax (15 Oct 2020): 6 digits above Rs 5 crore' }),
    ]),
    /* the e-way bill: CGST Rules 2017 r.138 (s.68 CGST Act). */
    ewb: Object.freeze({
      /* r.138(1): a consignment whose value EXCEEDS Rs 50,000 needs an e-way bill before it moves. The value is the invoice total
         (transaction value plus every tax and cess, r.138(1) Explanation). A State may notify a different limit for movement
         WITHIN that State (r.138(14) proviso): it is passed in by the caller (`state_threshold_minor`), never guessed here. */
      value_threshold_minor: 50000 * 100,
      threshold_cite: 'CGST Rules 2017, r.138(1): consignment value exceeding Rs 50,000',
      /* movements that are not decided by value alone. `always` → required whatever the value (r.138(1) provisos); `by` → who generates it. */
      movements: Object.freeze({
        supply: Object.freeze({ always: false, by: 'consignor', cite: 'r.138(1): supply of goods' }),
        sales_return: Object.freeze({ always: false, by: 'consignor', cite: 'r.138(1): return of goods' }),
        inward_unregistered: Object.freeze({ always: false, by: 'recipient', cite: 'r.138(3): inward supply from an unregistered person; the registered recipient generates it' }),
        job_work_inter_state: Object.freeze({ always: true, by: 'principal', cite: 'r.138(1) proviso: goods sent by a principal to a job worker in another State, whatever the value' }),
        handicraft_inter_state: Object.freeze({ always: true, by: 'consignor', cite: 'r.138(1) proviso: handicraft goods moved inter-State by a person exempt from registration, whatever the value' }),
      }),
      /* r.138(10): validity — one day for each 200 km (20 km for an over-dimensional cargo), part of a day counts as a day */
      validity_km_per_day: 200, validity_km_per_day_odc: 20,
      max_distance_km: 4000,
      /* the portal's transport-mode codes and subtype / document codes (e-way bill JSON, offline bulk format and API v1.03) */
      modes: Object.freeze({ road: 1, rail: 2, air: 3, ship: 4 }),
      doc_types: Object.freeze({ invoice: 'INV', bill_of_supply: 'BIL', bill_of_entry: 'BOE', delivery_challan: 'CHL', credit_note: 'CNT', other: 'OTH' }),
      sub_supply_types: Object.freeze({ supply: 1, import: 2, export: 3, job_work: 4, own_use: 5, job_work_returns: 6, sales_return: 7, others: 8 }),
      schema: 'NIC e-way bill system, "Generate e-way bill by JSON" (bulk upload format 1.0.0621, the field names of API v1.03)',
    }),
    source: 'CGST Act 2017 + IGST Act 2017 ss.7-8 (intra vs inter-state by place of supply); GSTN e-invoice schema INV-01; the rate menu as the engine has carried it since 2026-09-03',
  }),
});

const DEFAULT_COUNTRY = 'IN';

/** packFor('in') → the pack for that country, or null. Case and spaces do not matter; an unknown country is null, never a guess. */
function packFor(country) {
  const c = String(country == null ? '' : country).trim().toUpperCase();
  return Object.prototype.hasOwnProperty.call(PACKS, c) ? PACKS[c] : null;
}

/** packForScheme('gst') → the pack whose scheme that is, or null. One scheme, one pack — a second would be ambiguous. */
function packForScheme(scheme) {
  const s = String(scheme == null ? '' : scheme).trim().toUpperCase();
  for (const k of Object.keys(PACKS)) if (PACKS[k].scheme === s) return PACKS[k];
  return null;
}

/**
 * rcmCategoryFor(pack, { id?, code? }) → the reverse-charge category (by id, or the first whose code prefix the SAC / HSN starts with), or null.
 * A lookup in the pack's DATA — it decides nothing about who pays; tax.determine applies the supplier's registration to it.
 */
function rcmCategoryFor(pack, q) {
  const list = (pack && pack.rcm && pack.rcm.categories) || [], x = q || {};
  if (x.id != null && x.id !== '') { const id = String(x.id); for (const c of list) if (c.id === id) return c; return null; }
  const code = String(x.code == null ? '' : x.code).replace(/\s+/g, '');
  if (!code) return null;
  for (const c of list) for (const p of c.codes) if (code.indexOf(p) === 0) return c;
  return null;
}

const EXPORTS = { PACKS, DEFAULT_COUNTRY, packFor, packForScheme, rcmCategoryFor };

/* ⭐ ONE FILE, EVERY HOST: node takes module.exports; a page, the TV and the shop PC take window.CBTaxPacks. */
if (typeof module !== 'undefined' && module.exports) module.exports = EXPORTS;
if (root && typeof root.window !== 'undefined') root.window.CBTaxPacks = EXPORTS;
})(typeof globalThis !== 'undefined' ? globalThis : this);

/* ADOPTED from chitbridge-engines v1.2.0 · tax-slab · sha256 439500a95910ff8bd55d4a1c422e2c4e810f509c7a6af2f1cd4e34aa239bc98d — DO NOT EDIT HERE. Change it in chitbridge-engines, release a version, then run tools/adopt.cjs. */
/* chitbridge-engines · tax-slab. Edited ONLY in chitbridge-engines/src/tax-slab.js; every platform adopts a released version of it. */
(function (root) {
'use strict';
// @stage tested
// @stage-note Which slab answers for this product, and WHO answered. Pure — no I/O, no DB, no rate table.
/**
 * tax-slab.js — a named tax slab, cited by a product, inherited when it is not.
 *
 * Athi, 2026-09-03: *"in india tax is not simple, each product has different tax criteria, so it has to be
 * product specific, but there are slabs, so define slab and attach the slab to the product, check how other
 * products are doing"*.
 *
 * ── ⭐⭐ WHAT THE OTHER PRODUCTS DO, AND WHAT WAS TAKEN FROM THEM ────────────────────────────────────────────────
 *
 * Tally, Zoho Books and Odoo all land on the SAME shape, independently, which is the strongest evidence a shape
 * is right: **a named tax rate is its own record, a product points at it, and an unset product inherits.**
 *
 *   Tally      "GST Rate Details" set at Stock Item · Stock Group · Company — the item's own answer wins, else
 *              the group's, else the company's. That THREE-LEVEL fallback is the part copied here verbatim.
 *   Zoho       a "Tax" record (name + rate), selected on an item; unset items fall to the org default.
 *   Odoo       `account.tax` records, defaulted per product category (`property_account_..._categ_id`).
 *
 * ⚠️ NOT COPIED — their tax ENGINE. Odoo's `account.tax` carries computation modes, sequences and repartition
 * lines because it also POSTS the entries. We do not post; `tax.js` determines and stops. Importing their engine
 * would be importing an accounting ledger we do not have.
 *
 * ⚠️⚠️ AND STILL NO RATE TABLE. `tax.js` says it plainly and it holds here: this file ships **no** rates. The
 * merchant authors the slabs — "GST 5%", "GST 18%" — as `definition` rows they own, version and freeze. A rate
 * hard-coded in our repository would be wrong silently, wrong for everyone, and discovered at filing time.
 * `GST_SLAB_RATES` below is a list of the rates the SCHEME defines, offered as a picker; it is not a mapping from
 * any product to any rate, and nothing here resolves one.
 *
 * ── ⭐ THE SHAPE IS defaults.js's, DELIBERATELY ────────────────────────────────────────────────────────────────
 * `defaults.js` already says "the catalogue declares it, a row overrides it, and we know which answered", and
 * returns `{ value, from }` for exactly that reason. This is the same rule with one extra rung in the middle (the
 * category), so it returns the same kind of answer — a value AND the source that produced it — using the same
 * vocabulary. It is deliberately NOT registered in `DEFAULTABLE`: that registry decides which keys earn a
 * SPREADSHEET COLUMN, and a slab must never be one (see the SYSTEM field note in column-rules.js).
 *
 * ── ZERO DEPENDENCIES · TIER A ─────────────────────────────────────────────────────────────────────────────────
 */

/**
 * The rates the GST scheme itself defines. ⚠️ A MENU, NOT A MAPPING — this says which numbers are legal to type,
 * not which one any product attracts. That second question is per-HSN, changes at every Council meeting, and is
 * the merchant's (or their CA's) to answer. Offering it as a picker stops "18.5" being typed; it decides nothing.
 * ⭐ 2026-09-28: THE NUMBERS LIVE IN THE INDIA PACK (tax-packs: IN.rates) — GST_SLAB_RATES below reads them there, so
 * the menu is changed as data, once, for every surface.
 */
/* ⭐ THE COUNTRY IS DATA (tax-packs, 2026-09-28): found wherever this runs — window.CBTaxPacks on a page (the bundle
   loads it first), lib/tax-packs.js on the server. ⚠️ It FAILS LOUDLY when absent: there is no second copy of a country's
   rules in here to fall back to, and a quiet default would be exactly the second copy the packs exist to remove. */
var PACKS_ = null;
/* a slab that names no scheme belongs to the DEFAULT country's (tax-packs: India → 'GST', as it always did) */
function homeScheme_() { var P = taxPacks_(); return P.packFor(P.DEFAULT_COUNTRY).scheme; }
function taxPacks_() {
  var P = (typeof CBTaxPacks !== 'undefined' && CBTaxPacks.packFor) ? CBTaxPacks
        : (root.window && root.window.CBTaxPacks && root.window.CBTaxPacks.packFor) ? root.window.CBTaxPacks : PACKS_;
  if (P === null && typeof require === 'function') { try { P = PACKS_ = require('./tax-packs'); } catch (_) { P = PACKS_ = false; } }
  if (!P || !P.packFor) throw new Error('the tax-packs engine is not loaded — load it before this one (a country\'s tax rules are data, and without them nothing can be decided)');
  return P;
}

/** The key a product cites a slab by. ⚠️ Named once — the web mirror, the RESERVED list and the SYSTEM field all
    have to agree, and three string literals is how they stop agreeing. */
const SLAB_KEY = 'tax_slab';
const SLAB_NAME_KEY = 'tax_slab_name';
const RATE_KEY = 'gst_rate';

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const blank = (v) => v === null || v === undefined || String(v).trim() === '';

/**
 * normalise(definition) → { id, name, rate, cess, hsn, effective_from, label } | null
 *
 * Accepts a raw `definition` row (with `rules` joined on) OR the flattened shape the front end keeps
 * (`{ id, name, rules }`), because both exist and a second reader is how the two drift.
 */
function slabOf(def) {
  const d = def || {};
  const id = d.definition_id || d.id || null;
  if (!id) return null;
  /* ⚠️ IDEMPOTENT. A slab that has ALREADY been normalised (no `rules`, a top-level `rate`) must survive a second
     pass unchanged — the send path handed the shelf's normalised slabs back in as an array and every rate came out
     null, so every chit line went unrated while the product page beside it showed 18% ([TAX-03], 2026-09-05). */
  const r = (d.rules && typeof d.rules === 'object') ? d.rules : ((d.rules === undefined && d.rate !== undefined) ? d : {});
  const rate = num(r.rate);
  return {
    id: String(id),
    name: String(d.name || r.label || '').trim(),
    /* ⚠️ `null`, NOT 0, when no rate is declared. Zero is a REAL GST answer (exempt/nil-rated goods), so
       defaulting an unanswered slab to 0 would make "nobody said" indistinguishable from "nil-rated" — and the
       invoice would look correct while charging nothing. */
    rate,
    cess: num(r.cess) === null ? 0 : num(r.cess),
    hsn: Array.isArray(r.hsn) ? r.hsn.map(String).filter(Boolean) : (blank(r.hsn) ? [] : [String(r.hsn)]),
    effective_from: blank(r.effective_from) ? null : String(r.effective_from),
    label: String(r.label || d.name || '').trim(),
    /* The scheme the slab belongs to — GST unless the governance layer says otherwise (b202: DE-VAT-19 …). tax.js
       reads it off the line to pick the head: CGST/SGST/IGST for GST, ONE head for a VAT-type scheme. */
    scheme: String(r.scheme || homeScheme_()).trim().toUpperCase() || homeScheme_(),
  };
}

/** Index a list of slab definitions by id. Tolerant of a list that is already normalised. */
function indexSlabs(list) {
  const m = new Map();
  for (const d of (Array.isArray(list) ? list : [])) {
    const s = slabOf(d);
    if (s) m.set(s.id, s);
  }
  return m;
}

/** The category ids a product cites — BOTH shapes, the same rule core.js's catgIdsOf follows. */
function categoryIdsOf(item_data) {
  const d = item_data || {};
  if (Array.isArray(d.categories)) return d.categories.map(String).filter(Boolean);
  if (d.category) return [String(d.category)];        // legacy single — read, never written again
  return [];
}

/**
 * ⭐⭐ resolve({ item_data, face, slabs, categories, asOf }) → the answer AND who gave it.
 *
 *   { slab_id, rate, cess, name, hsn, source, effective_from, pending }
 *
 * `source` ∈ 'product' | 'category' | 'catalogue' | 'none' — the same "which one answered" contract defaults.js
 * returns, because a screen that shows a rate without saying where it came from cannot be argued with. "GST 5% —
 * from category Grains" is checkable; a bare "5%" is a number someone has to trust.
 *
 * INPUTS
 *   item_data   the product row (free-form jsonb).           `item_data.tax_slab` is a definition_id.
 *   face        the catalogue face.                          `face.tax.default_slab` is a definition_id.
 *   slabs       kind:'tax' definitions — array or Map.
 *   categories  kind:'category' definitions — array or Map.  `rules.default_slab` is a definition_id.
 *   asOf        ISO date for the effective_from check. Defaults to today.
 *
 * ⚠️⚠️ THE ORDER IS TALLY'S AND IT IS NOT NEGOTIABLE: the product's own citation wins outright, then the FIRST
 * category it sits in that declares one, then the catalogue. Reversing any pair would make the general answer
 * override the specific one — which is the whole reason a per-product slab exists.
 *
 * ⚠️ A PRODUCT IN THREE CATEGORIES TAKES THE FIRST THAT ANSWERS, in the order the product lists them. Two
 * categories with different slabs is a genuine ambiguity that no rule here can settle honestly, so the choice is
 * DECLARED (first wins, and the answer names which category it was) rather than hidden behind a max/min. The
 * caller can see the source and say so.
 */
function resolve(input) {
  const inp = input || {};
  const it = (inp.item_data && typeof inp.item_data === 'object') ? inp.item_data : {};
  const face = (inp.face && typeof inp.face === 'object') ? inp.face : {};
  const slabs = (inp.slabs instanceof Map) ? inp.slabs : indexSlabs(inp.slabs);
  const cats = (inp.categories instanceof Map) ? inp.categories : new Map(
    (Array.isArray(inp.categories) ? inp.categories : []).map((c) => [String(c.definition_id || c.id), c]));

  const answer = (slab, source, extra) => Object.assign({
    slab_id: slab ? slab.id : null,
    rate: slab ? slab.rate : null,
    cess: slab ? slab.cess : 0,
    name: slab ? (slab.name || slab.label) : null,
    scheme: slab ? (slab.scheme || homeScheme_()) : null,
    hsn: slab ? slab.hsn : [],
    effective_from: slab ? slab.effective_from : null,
    /**
     * ⚠️ A SLAB DATED IN THE FUTURE IS REPORTED, NOT SKIPPED. Silently falling through to the catalogue default
     * because a rate starts next month would charge the OLD rate with nothing on screen to say why — the same
     * class of failure as tax.js's "unknown place of supply", and the same answer: say it, let the caller decide.
     */
    pending: !!(slab && slab.effective_from && slab.effective_from > (inp.asOf || new Date().toISOString().slice(0, 10))),
    source,
  }, extra || {});

  /* 1 · the product's own citation. */
  const own = blank(it[SLAB_KEY]) ? null : String(it[SLAB_KEY]);
  if (own) {
    const s = slabs.get(own);
    /**
     * ⚠️⚠️ AN UNRESOLVABLE ID FALLS BACK TO THE TRAVELLING COPY, NOT TO THE CATEGORY. A counterparty holding my
     * product in THEIR copy cannot resolve MY definition_id and never will ([[reference-cb-core-principle]]) —
     * but the rate rode along beside it. Inheriting their own category's slab instead would silently re-rate my
     * goods under their tax rules, which is exactly the wrong answer and looks completely reasonable.
     */
    if (s) return answer(s, 'product');
    const copied = num(it[RATE_KEY]);
    if (copied !== null) {
      return answer({ id: own, name: String(it[SLAB_NAME_KEY] || '').trim() || null, rate: copied,
                      cess: num(it.cess_rate) === null ? 0 : num(it.cess_rate), hsn: [], effective_from: null },
                    'product', { unresolved: true });
    }
    /* ⭐ THE CITATION IS DEAD — FALL THROUGH, AND SAY SO. Athi, 2026-09-05: "for some reason an existing slab can be
       made unavailable — retired, a jurisdiction change, mismanagement — the engine should detect that and allow
       another one to attach." The chain continues (category → catalogue); the answer carries `cited` and
       `unresolved: true` so every screen says "cites X, which is not active — using Y", and the product pane offers
       the attach. Only when NOTHING below answers is the source 'none'. (Until today this returned 'none' here —
       "say so rather than inherit" — which left a product with a good category default showing no rate at all.) */
    return Object.assign(resolveBelow(it, cats, slabs, face, answer), { unresolved: true, cited: own });
  }
  return resolveBelow(it, cats, slabs, face, answer);
}

/* The rungs below the product's own citation — ONE function, reached with or without a dead citation above it. */
function resolveBelow(it, cats, slabs, face, answer) {

  /**
   * 1b · a BARE RATE with no slab. `gst_rate` is a declarable catalogue column with a full synonym set in
   * csv-preflight, so a merchant who imports a sheet of HSN codes and GST rates has typed the answer already.
   * Returning 'none' beside a row that plainly states 18 would be the software disagreeing with the data in front
   * of it. It is the PRODUCT's own answer, so it ranks exactly where a slab citation does.
   */
  const bare = num(it[RATE_KEY]);
  if (bare !== null) {
    return answer({ id: null, name: String(it[SLAB_NAME_KEY] || '').trim() || null, rate: bare,
                    cess: num(it.cess_rate) === null ? 0 : num(it.cess_rate), hsn: [], effective_from: null },
                  'product');
  }

  /* 2 · the first category that declares one, in the product's own order. */
  /* ⭐ EVERY CATEGORY IS HEARD, AND A DISAGREEMENT IS SAID. Athi, 2026-09-05: "what if the product is in two or more
     categories and they are in different slabs?" — until today the first category with a slab won, in list order,
     silently. Now the first still answers (nothing goes blank), but when the categories name DIFFERENT slabs the
     answer carries `conflict` and every screen says so: the product must cite a slab itself. */
  /* ⭐ A CATEGORY INHERITS ITS PARENT'S SLAB. Athi, 2026-09-05: "I applied 5% for the top category — this means it
     should automatically reflect the categories underneath?" Yes: a category that names no slab asks its parent
     (`rules.parent`), up the tree, and the answer says which ancestor spoke. */
  const heard = [];
  for (const cid of categoryIdsOf(it)) {
    const own = cats.get(cid);
    let c = own, hops = 0, via = null;
    while (c && hops++ < 16) {
      const dflt = c.rules && c.rules.default_slab;
      if (!blank(dflt)) { const s = slabs.get(String(dflt)); if (s) { via = { c, s }; } break; }
      const pid = c.rules && c.rules.parent;
      c = blank(pid) ? null : cats.get(String(pid));
    }
    if (via) heard.push({ category_id: cid, category_name: (own && own.name) || null, slab_id: via.s.id, slab_name: via.s.name || via.s.label || null, rate: via.s.rate,
                          inherited_from: via.c === own ? null : ((via.c.name || String(via.c.definition_id || via.c.id))) });
  }
  if (heard.length) {
    const first = heard[0];
    const distinct = new Set(heard.map((h) => String(h.slab_id)));
    return answer(slabs.get(String(first.slab_id)), 'category',
      Object.assign({ via_category_id: first.category_id, via_category_name: first.category_name, inherited_from: first.inherited_from || null }, distinct.size > 1 ? { conflict: heard } : {}));
  }

  /* 3 · the catalogue's declared default. Accepts the nested key and a flat one, exactly as defaults.declared does. */
  const t = (face.tax && typeof face.tax === 'object') ? face.tax : {};
  const cdflt = !blank(t.default_slab) ? t.default_slab : (!blank(face.default_tax_slab) ? face.default_tax_slab : null);
  if (cdflt) {
    const s = slabs.get(String(cdflt));
    if (s) return answer(s, 'catalogue');
  }

  /* ⚠️ 'none' IS A REAL ANSWER, and it is not 0%. Nobody has said what this product attracts; a caller that
     needs a rate must refuse or ask, never assume nil-rated. Same rule as tax.js's 'unknown' supply type. */
  return answer(null, 'none');
}

/**
 * ⭐ setOn(item_data, slab) — write the citation AND the travelling copy, in one act, in place.
 *
 * ⚠️⚠️ BOTH, ALWAYS, AND THIS IS THE ONLY FUNCTION THAT WRITES EITHER. Exactly the rule `catgSetOn` follows for
 * categories: the id is MY reference (edit the slab and every product of mine follows), the name and the rate are
 * a VALUE copy for a counterparty who cannot resolve my definition_id — [[reference-cb-core-principle]]. Written
 * apart, they drift; written here, they cannot.
 *
 * ⚠️ CLEARING MEANS INHERIT, NOT ZERO. Passing null removes all three keys, so the product falls back to its
 * category and then the catalogue — it does not become a nil-rated product. (defaults.js: "a blank cell means
 * INHERIT, not CLEAR".)
 */
function setOn(item_data, slab) {
  const d = (item_data && typeof item_data === 'object') ? item_data : {};
  const s = slab && slab.rules !== undefined ? slabOf(slab) : slab;
  if (!s || !s.id) {
    delete d[SLAB_KEY]; delete d[SLAB_NAME_KEY]; delete d[RATE_KEY];
    return d;
  }
  d[SLAB_KEY] = String(s.id);
  d[SLAB_NAME_KEY] = s.name || s.label || '';
  /* ⚠️ Only when there IS a rate. A slab authored with no rate yet must not stamp `gst_rate: 0` onto a product —
     that copy is what a counterparty reads, and it would read as "nil-rated" rather than "not stated". */
  if (s.rate === null || s.rate === undefined) delete d[RATE_KEY]; else d[RATE_KEY] = s.rate;
  return d;
}

/**
 * ⭐ applyToLine(line, resolved) → the same line with the rate tax.js reads.
 *
 * ⚠️ IT DOES NOT OVERWRITE A RATE THE LINE ALREADY CARRIES. A stamped chit line holds the rate that was frozen
 * onto it; re-resolving at read time is exactly how a stamped document starts changing after the fact. Resolution
 * fills a GAP — it never corrects history.
 *
 * ⚠️ AND IT WRITES NOTHING WHEN THE ANSWER IS 'none'. An absent rate is what makes tax.js's ItemList show 0 tax
 * AND lets a caller see that nobody declared one; writing 0 would make the two indistinguishable.
 */
function applyToLine(line, resolved) {
  const l = (line && typeof line === 'object') ? line : {};
  const r = resolved || {};
  if (l.rate !== undefined || l.gst_rate !== undefined) return l;
  if (r.rate === null || r.rate === undefined) return l;
  l.gst_rate = r.rate;
  if (r.cess) l.cess_rate = r.cess;
  if (r.slab_id) l.tax_slab = r.slab_id;
  if (r.name) l.tax_slab_name = r.name;
  /* Where the answer came from, on the line itself — the same reason a picked storefront line carries
     `ref.how: 'picked'`. A dispute can then tell an explicit rate apart from an inherited one. */
  l.tax_source = r.source;
  return l;
}

/** The sentence a screen shows. ⚠️ One phrasing, so View, the product pane and a chit read alike. */
function describe(resolved) {
  const r = resolved || {};
  const dead = (r && r.unresolved && r.cited) ? 'Cites slab "' + r.cited + '", which is not active here. ' : '';
  const clash = (r && Array.isArray(r.conflict) && r.conflict.length > 1)
    ? ' ⚠️ Its categories disagree — ' + r.conflict.map((h) => (h.category_name || h.category_id) + ' ' + (h.rate === null || h.rate === undefined ? '?' : h.rate + '%')).join(' vs ') + ' — cite a slab on the product to settle it.'
    : '';
  if (!r || r.source === 'none') return dead
    ? dead + 'Nothing below it answers either — attach another slab, or set a category or catalogue default.'
    : 'Not set — no slab on the product, its categories or the catalogue.';
  const head = (r.name ? r.name : (r.rate === null ? 'a slab' : 'GST ' + r.rate + '%'))
    + (r.rate !== null && r.name ? ' — ' + r.rate + '%' : '');
  const from = r.source === 'product' ? 'on this product'
             : r.source === 'category' ? ('from category ' + (r.via_category_name || 'it belongs to') + (r.inherited_from ? ' (inherits ' + r.inherited_from + ')' : ''))
             : 'catalogue default';
  return dead + (dead ? 'Using ' : '') + head + ' · ' + from + (r.pending ? ' · not in force until ' + r.effective_from : '') + clash;
}


const EXPORTS = { get GST_SLAB_RATES() { return taxPacks_().packFor('IN').rates; }, SLAB_KEY, SLAB_NAME_KEY, RATE_KEY,
                   slabOf, indexSlabs, categoryIdsOf, resolve, setOn, applyToLine, describe };

/* ⭐ ONE FILE, EVERY HOST: node takes module.exports; a page, the TV and the shop PC take window.CBTaxSlab. */
if (typeof module !== 'undefined' && module.exports) module.exports = EXPORTS;
if (root && typeof root.window !== 'undefined') root.window.CBTaxSlab = EXPORTS;
})(typeof globalThis !== 'undefined' ? globalThis : this);

/* ADOPTED from chitbridge-engines v1.20.0 · tax · sha256 38523910daabd85398684729e4faa397c711e983368149b48b4a5d2bd63f3f36 — DO NOT EDIT HERE. Change it in chitbridge-engines, release a version, then run tools/adopt.cjs. */
/* chitbridge-engines · tax. Edited ONLY in chitbridge-engines/src/tax.js; every platform adopts a released version of it. */
(function (root) {
'use strict';
// @stage tested
// @stage-note GST determination: two addresses in, INV-01 vocabulary out. Pure — no I/O, no rate tables, no DB.
/**
 * tax.js — the determination, not the rates.
 *
 * Athi, 2026-09-02: *"how the tax computation happens and how do we borrow the existing well proven modules"*,
 * and then: *"build tax.js with the two-address context and INV-01 field names."*
 *
 * ── ⭐⭐ WHAT WAS BORROWED, AND WHAT WAS DELIBERATELY NOT ───────────────────────────────────────────────────────
 *
 * BORROWED — **the provider seam**. Every serious platform does the same thing and it is the right thing: define
 * an interface, ship a naive default, delegate real determination outward. Medusa's `ITaxProvider` is two methods
 * (`getIdentifier()`, `getTaxLines(itemLines, shippingLines, context)`) returning
 * `{rate, code, name, provider_id, line_item_id}`, with a built-in `system` provider as the placeholder and
 * Avalara/TaxJar behind the same seam. That shape is proven and costs nothing to adopt.
 *
 * ⚠️ NOT BORROWED — **their context**. Medusa's `TaxCalculationContext` carries ONE address: the destination.
 * Indian GST needs TWO, because the comparison between the supplier's state and the PLACE OF SUPPLY is the entire
 * decision between CGST+SGST and IGST. Copying that interface as written would have built the defect in on day
 * one. So the seam is theirs and the context is ours.
 *
 * BORROWED — **the vocabulary of the GSTN e-invoice schema (INV-01)**, because the field names are the standard
 * an Indian buyer's system already speaks. `SellerDtls` · `BuyerDtls` · `ItemList` · `ValDtls` · `TranDtls`,
 * and inside them `Gstin` · `LglNm` · `Pos` · `HsnCd` · `AssAmt` · `GstRt` · `CgstAmt` · `SgstAmt` · `IgstAmt` ·
 * `TotItemVal` · `RndOffAmt` · `TotInvVal`. If our output already speaks that, "e-invoice ready" and "Tally
 * compatible" stop being claims and become a mapping.
 *
 * ⚠️ THE NAMES WERE VERIFIED, NOT REMEMBERED — and one of them was wrong. Seller and buyer carry **`State`**, not
 * `Stcd`; `Stcd` exists only in `DispDtls`/`ShipDtls`. That is exactly the kind of detail that passes review, ships,
 * and is rejected by the IRP months later.
 *
 * ⚠️⚠️ NOT BORROWED, AND NEVER TO BE — **rate tables**. This file ships no rates. A stale rate in our repository
 * is a compliance liability wearing the costume of a feature: it is wrong silently, it is wrong for everyone, and
 * nobody discovers it until a return is filed. A rate arrives per line — from the entity's own HSN declarations,
 * or from a provider whose business is keeping them current.
 *
 * ── ZERO DEPENDENCIES · TIER A ─────────────────────────────────────────────────────────────────────────────────
 */

/* ── money ─────────────────────────────────────────────────────────────────────────────────────────────────── */

/** 2dp, half-up, on a value already in the invoice currency. Never a place to be clever. */
/* ⭐ money.round — THE one rounder (C:devSPEC-money-one-reader.md), found wherever this copy runs: CBMoney in
   a page, lib/money.js on the server. Looked up PER CALL, because an engine can load before money.js does.
   ⚠️ The fallback is the SAME rule, only for when money.js is absent — tests/money-round holds it equal. */
var MONEY_ = null;
function roundMoney_(n) {
  var M = (typeof CBMoney !== 'undefined' && CBMoney.round) ? CBMoney : MONEY_;
  if (M === null && typeof require === 'function') { try { M = MONEY_ = require('./money'); } catch (_) { M = MONEY_ = false; } }
  if (M && M.round) return M.round(n);
  var x = Number(n); if (!isFinite(x)) return x;
  var c = Math.round(Number((Math.abs(x) * 100).toPrecision(15))) / 100;
  return (x < 0 && c !== 0) ? -c : c;
}
/* ⭐ THE COUNTRY IS DATA (tax-packs, 2026-09-28): found wherever this runs — window.CBTaxPacks on a page (the bundle
   loads it first), lib/tax-packs.js on the server. ⚠️ It FAILS LOUDLY when absent: there is no second copy of a country's
   rules in here to fall back to, and a quiet default would be exactly the second copy the packs exist to remove. */
var PACKS_ = null;
function taxPacks_() {
  var P = (typeof CBTaxPacks !== 'undefined' && CBTaxPacks.packFor) ? CBTaxPacks
        : (root.window && root.window.CBTaxPacks && root.window.CBTaxPacks.packFor) ? root.window.CBTaxPacks : PACKS_;
  if (P === null && typeof require === 'function') { try { P = PACKS_ = require('./tax-packs'); } catch (_) { P = PACKS_ = false; } }
  if (!P || !P.packFor) throw new Error('the tax-packs engine is not loaded — load it before this one (a country\'s tax rules are data, and without them nothing can be decided)');
  return P;
}

function r2(n) {
  return roundMoney_(Number(n) || 0);
}
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/* ── the one decision GST turns on ─────────────────────────────────────────────────────────────────────────── */

/**
 * supplyType(sellerState, placeOfSupply) → 'intra' | 'inter' | 'unknown'
 *
 * ⚠️⚠️ THIS IS THE WHOLE REASON THE CONTEXT NEEDS TWO ADDRESSES. Same goods, same price, same buyer: if the place
 * of supply is the seller's own state the tax is CGST+SGST, and if it is another state it is IGST. Get it
 * backwards and the invoice is not merely displaying a wrong number — the wrong tax has been charged, under the
 * wrong heads, and the buyer cannot claim the credit.
 *
 * ⚠️ AND 'unknown' IS A REAL ANSWER. A missing place of supply must not silently default to intra-state — that is
 * the guess that produces a confidently wrong invoice. The caller is told, and decides.
 */
function supplyType(sellerState, placeOfSupply) {
  const a = String(sellerState == null ? '' : sellerState).trim();
  const b = String(placeOfSupply == null ? '' : placeOfSupply).trim();
  if (!a || !b) return 'unknown';
  /* State codes are two-digit strings ("29"); a leading zero must not be lost by a numeric comparison. */
  return a.replace(/^0+/, '') === b.replace(/^0+/, '') ? 'intra' : 'inter';
}

/* ── one line ──────────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * itemLine(line, ctx, i) → an ItemList entry.
 *
 * ⚠️⚠️ ORDER OF OPERATIONS: DISCOUNT FIRST, THEN TAX ON WHAT REMAINS. `AssAmt = TotAmt − Discount`, and the rate
 * applies to `AssAmt`. Taxing before the discount overcharges; discounting after tax under-remits. Either way it
 * is a compliance error rather than a display bug, and it is the single most common way a hand-built invoice is
 * wrong.
 *
 * ⚠️ INCLUSIVE PRICING IS DECLARED, NEVER INFERRED. If a catalogue's prices already contain tax, the assessable
 * value is `gross × 100 / (100 + rate)`. Guessing this is how a price becomes wrong by exactly the tax rate — an
 * error large enough to lose money on every line and subtle enough to look like a rounding problem.
 */
/**
 * ⭐⭐⭐ ONE LINE'S TAX SPLIT — THE ONLY PLACE THIS ARITHMETIC IS ALLOWED TO EXIST. `assessable × rate ÷ 100` is
 * what an INV-01 line justifies itself by (AssAmt, GstRt → CgstAmt/SgstAmt/IgstAmt), so it is the number the
 * server's invoice will carry. A caller that instead took the shortcut `net − assessable` gets the same figure
 * MOST of the time, but not always — two roundings (assessable, then net−assessable) can land a paisa away from
 * one rounding (assessable×rate/100), and that paisa is the difference between what a customer was shown at the
 * counter and what the GST invoice later declares. So a preview (a till, a cart) calls this, not its own formula.
 * → { assessable, tax } — `assessable` is what CGST/SGST/IGST are levied on; `tax` is their sum before the split.
 */
function splitLineTax({ net, rate, priceIncludesTax, zeroRate }) {
  const n = Math.max(0, num(net)), rt = num(rate);
  const assessable = priceIncludesTax ? r2(n * 100 / (100 + rt)) : n;
  const tax = zeroRate ? 0 : r2(assessable * rt / 100);
  return { assessable, tax };
}
/**
 * ⭐⭐⭐ ONE LINE'S TAX HEADS — the only place the CGST/SGST/IGST split of a line's tax exists (v1.2.1). Intra-state:
 * CGST takes the rounded half, SGST the remainder, so the two always sum to the line's tax. Inter-state: all IGST.
 * A VAT-type scheme (no split): one head, `vat`. The counter's printed summary SUMS these per line — it must never
 * halve a rate's total on its own, or the slip and the invoice disagree by a paisa (seen 2026-10-01: a bill said
 * 10.45 / 10.45 where its invoice and ledger said 10.46 / 10.44).
 * → { cgst, sgst, igst, vat }
 */
/**
 * ⭐⭐⭐ v1.12.0 — EACH HEAD AT ITS OWN RATE, SO CGST AND SGST ARE EXACT AND EQUAL (Athi, 2026-10-02: "it cannot be
 * different. it has to be the exact … as a layman, i will question the credibility of the engine"). CGST and SGST are two
 * taxes, each levied at its own rate (half the slab) on the same taxable value — so each is computed as
 * taxable × (rate/2) / 100, rounded once, and they are equal on every line, and therefore in every total. The line's tax
 * is their SUM. (v1.9.0 halved the line's total instead — CGST the rounded half, SGST the remainder — and the odd
 * half-paisa always went to CGST: bill C2/26-27/0010 printed CGST 41.89 against SGST 41.84 over thirteen 12% lines.)
 * IGST is the whole rate on the same value. Pass `assessable` and `rate`; given only `tax` (a caller from before
 * v1.12.0), the old halving is kept so nothing that already printed changes meaning.
 */
function lineHeads({ tax, supply, split, assessable, rate }) {
  const out = { cgst: 0, sgst: 0, igst: 0, vat: 0 };
  const splits = split === undefined ? true : !!split;
  const exact = assessable !== undefined && rate !== undefined;
  const base = num(assessable), rt = num(rate), t = r2(num(tax));
  if (!splits) { if (supply === 'domestic') out.vat = exact ? r2(base * rt / 100) : t; return out; }
  if (supply === 'inter') { out.igst = exact ? r2(base * rt / 100) : t; return out; }
  if (supply === 'intra') {
    if (exact) { out.cgst = r2(base * (rt / 2) / 100); out.sgst = out.cgst; }
    else { out.cgst = r2(t / 2); out.sgst = r2(t - out.cgst); }
  }
  return out;
}
function itemLine(line, ctx, i) {
  const l = line || {};
  const qty = num(l.qty !== undefined ? l.qty : l.quantity) || 0;
  const unitPrice = num(l.unit_price !== undefined ? l.unit_price : l.price);
  const rate = num(l.rate !== undefined ? l.rate : l.gst_rate);
  const gross = r2(qty * unitPrice);
  const discount = r2(num(l.discount));

  const net = Math.max(0, r2(gross - discount));
  const { assessable, tax: taxTotal } = splitLineTax({ net, rate, priceIncludesTax: ctx.priceIncludesTax, zeroRate: ctx.zeroRate });

  /**
   * ⭐ THE SPLIT IS ARITHMETIC, THE DECISION WAS MADE ABOVE. Intra-state halves the rate into CGST and SGST;
   * inter-state puts the whole rate on IGST. Halving an odd rate (5% → 2.5% + 2.5%) is exact in the rate and can
   * be a half-paisa in the amount, so CGST takes the rounded half and SGST takes the remainder — the two always
   * sum to the total, which is what a counterparty's system reconciles against.
   */
  /* ⭐ ONE HEAD FOR A VAT-TYPE SCHEME (b202: DE-VAT-19, FR-VAT-20 …). VAT does not split by state; it is charged in
     full on a domestic supply and, between businesses across a border, not charged at all (export zero-rated /
     reverse charge in the buyer's country). The GST heads stay 0 so an Indian reader of the block is not misled. */
  /* each head at its own rate on the taxable value (v1.12.0) — a zero-rated line carries no rate into the heads */
  const heads = lineHeads({ tax: taxTotal, supply: ctx.supply, split: ctx.split, assessable, rate: ctx.zeroRate ? 0 : rate });
  const CgstAmt = heads.cgst, SgstAmt = heads.sgst, IgstAmt = heads.igst, TaxAmt = heads.vat;

  return {
    SlNo: String(i + 1),
    PrdDesc: String(l.name || l.description || l.PrdDesc || ''),
    IsServc: l.is_service ? 'Y' : 'N',
    HsnCd: String(l.hsn || l.hsn_code || l.HsnCd || ''),
    Qty: qty,
    Unit: String(l.unit || ''),
    UnitPrice: r2(unitPrice),
    TotAmt: gross,
    Discount: discount,
    AssAmt: assessable,
    GstRt: rate,
    IgstAmt, CgstAmt, SgstAmt,
    /* Not INV-01 — the single head of a non-GST scheme (VAT · TVA · IVA · consumption tax). 0 under GST. */
    TaxAmt,
    CesRt: num(l.cess_rate),
    CesAmt: r2(assessable * num(l.cess_rate) / 100),
    TotItemVal: r2(assessable + IgstAmt + CgstAmt + SgstAmt + TaxAmt + r2(assessable * num(l.cess_rate) / 100)),
    /* Not INV-01 — ours, so a caller can join a computed line back to the chit line it came from. */
    _line_id: l.id !== undefined ? l.id : null,
  };
}

/* ── the invoice ───────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * determine({ seller, buyer, lines, priceIncludesTax, reverseCharge, supplyKind }) → the INV-01 shape + notes.
 *
 * `seller` { Gstin, LglNm, State, … }   ·   `buyer` { Gstin, LglNm, Pos, State, … }
 *
 * ⚠️ `Pos` (place of supply) IS NOT THE BUYER'S ADDRESS. It is usually the delivery state, and for services it
 * can be neither party's registered state. It is therefore taken as its own field and falls back to the buyer's
 * `State` only when absent — with a note saying so, because a silent fallback is how the wrong tax gets charged
 * without anyone being able to see why afterwards.
 */
function determine(input) {
  const inp = input || {};
  const seller = inp.seller || {};
  const buyer = inp.buyer || {};
  const notes = [];

  let pos = String(buyer.Pos || buyer.place_of_supply || '').trim();
  if (!pos && (buyer.State || buyer.state)) {
    pos = String(buyer.State || buyer.state).trim();
    notes.push('Place of supply was not given, so the buyer\'s state was used. For a delivery elsewhere, or for '
      + 'a service, state the place of supply — it, not the address, decides the tax.');
  }
  const sellerState = String(seller.State || seller.state || '').trim();
  /* The scheme comes from the LINES (the slab each cites carries it) or the caller; GST unless someone says otherwise.
     Mixed schemes on one invoice are not a thing — one seller, one jurisdiction — so the first rated line decides. */
  const linesIn = Array.isArray(inp.lines) ? inp.lines : [];
  const firstScheme = (linesIn.find((l) => l && l.tax_scheme) || {}).tax_scheme;
  /* ⭐ …or the seller's COUNTRY's pack, or — for a party with no country, which is every invoice written before packs —
     the default country's (tax-packs DEFAULT_COUNTRY: India, as it always was, now named). */
  const P = taxPacks_();
  const homePack = P.packFor(seller.Country || seller.country) || P.packFor(P.DEFAULT_COUNTRY);
  const scheme = String(inp.scheme || firstScheme || (homePack && homePack.scheme) || '').trim().toUpperCase();
  if (!scheme) throw new Error('no tax scheme: the lines cite none, the caller gave none, and no pack covers the seller');
  /* ⭐ HOW THE SUPPLY IS CLASSIFIED IS THE PACK'S: 'state' splits by place of supply (India); anything else — including a
     scheme no pack describes yet — is decided at the border, as it always was. */
  const pack = P.packForScheme(scheme);
  const split = !!(pack && pack.supply === 'state');
  let supply;
  if (split) {
    supply = supplyType(sellerState, pos);
  } else {
    /* A VAT-type scheme turns on the BORDER, not the state: same country → domestic (full rate); another country
       → cross-border (nothing charged between businesses); unknown when either country is missing. */
    const sc = String(seller.Country || seller.country || '').trim().toUpperCase();
    const bc = String(buyer.Country || buyer.country || '').trim().toUpperCase();
    supply = (!sc || !bc) ? 'unknown' : (sc === bc ? 'domestic' : 'cross');
    if (supply === 'cross') notes.push('Cross-border supply: no ' + scheme + ' is charged. The buyer accounts for it in their own country (reverse charge / import). The rate is stated for the record.');
    if (supply === 'unknown') notes.push('The ' + (sc ? 'buyer' : 'seller') + ' has no country on record, so domestic vs cross-border cannot be decided. Nothing was assumed.');
  }
  if (supply === 'unknown' && split) {
    notes.push(sellerState
      ? 'No place of supply, so CGST/SGST vs IGST cannot be decided. Nothing was assumed.'
      : 'The seller has no state on record, so CGST/SGST vs IGST cannot be decided. Nothing was assumed.');
  }

  const priceIncludesTax = !!inp.priceIncludesTax;
  const reverseCharge = !!inp.reverseCharge;
  /**
   * ⭐ REGISTRATION TYPE DECIDES WHAT MAY BE CHARGED, BEFORE ANY RATE DOES (Tally's M1/M2; STUDY §6 G2).
   *   seller composition → the invoice carries NO tax: the dealer pays a flat % on turnover and may not collect
   *                        GST from the buyer. The slab rate is still recorded per line (for the trader's own
   *                        books) but every head is zero and the total is the assessable value.
   *   buyer sez          → zero-rated supply (with LUT): rate 0 on the invoice, SupTyp SEZWOP, credit retained.
   *   buyer unregistered → B2C, by definition (also what a missing GSTIN already implied).
   * `RegType` on either party: 'regular' | 'composition' | 'unregistered' | 'sez'. Absent = regular.
   */
  const regOf = (p) => String(p.RegType || p.reg_type || p.gst_registration || 'regular').trim().toLowerCase();
  const sellerComposition = regOf(seller) === 'composition';
  const buyerSez = regOf(buyer) === 'sez';
  const buyerUnregistered = regOf(buyer) === 'unregistered';
  const zeroRate = sellerComposition || buyerSez || !!inp.zeroRated;
  if (sellerComposition) notes.push('Composition scheme: no GST is charged on this invoice. The tax is paid on turnover, and the buyer cannot claim credit.');
  if (buyerSez) notes.push('Supply to an SEZ unit: zero-rated (under LUT). The rate is stated for the record; no tax is charged.');
  const ctx = { supply, priceIncludesTax, zeroRate, scheme, split };
  /**
   * ⭐ REVERSE CHARGE FROM THE PACK (v1.20.0; CGST Act s.9(3) / 9(4) — the categories are tax-packs' DATA, none is named here).
   * Opt-in: `rcm: true` says "assess this as the RECIPIENT's purchase" — the buyer is the shop, the seller its supplier — so no
   * invoice computed before v1.20.0 changes. A line is under reverse charge when the pack has a category for it (the line's
   * `rcm_category`, else its SAC / HSN) AND the recipient is registered AND (the category is always-RCM, or the supplier is
   * unregistered). Such a line carries its tax in the RCM heads (`RcmCgstAmt` · `RcmSgstAmt` · `RcmIgstAmt`, `RcmCd`, `RcmItc`) and
   * NOTHING in CgstAmt / SgstAmt / IgstAmt: the supplier charged none, so the invoice total is the supplier's bill. ITC follows the
   * rate option the line carries (GTA at 5% allows none; at 18% it does). A line with no rate takes the category's first option.
   */
  const rcmPack = inp.rcm && split && !zeroRate && pack && pack.rcm ? pack : null;
  const supplierRegistered = !!String(seller.Gstin || seller.gstin || '').trim() && regOf(seller) !== 'unregistered';
  const recipientRegistered = !!String(buyer.Gstin || buyer.gstin || '').trim() && regOf(buyer) !== 'unregistered';
  const rcmOf = [];
  const ItemList = linesIn.map((l, i) => {
    const line = l || {};
    const cat = rcmPack ? P.rcmCategoryFor(rcmPack, { id: line.rcm_category, code: line.hsn || line.hsn_code || line.HsnCd }) : null;
    if (!cat || !recipientRegistered || !(cat.always || !supplierRegistered)) return itemLine(line, ctx, i);
    const given = line.rate !== undefined && line.rate !== null ? line.rate : line.gst_rate;
    const hasRate = given !== undefined && given !== null && given !== '';
    const opt = (hasRate ? cat.rates.find((r) => r.rate === num(given)) : null) || cat.rates[0];
    const rate = hasRate ? num(given) : num(opt.rate);
    if (hasRate && opt.rate !== null && opt.rate !== num(given)) notes.push('Line ' + (i + 1) + ': ' + rate + '% is not a rate the notification gives for ' + cat.name + ' (' + cat.rates.map((r) => r.rate).join(' or ') + '%); credit was read as for the first option.');
    const it = itemLine(Object.assign({}, line, { rate }), Object.assign({}, ctx, { priceIncludesTax: false }), i);
    const heads = { cgst: it.CgstAmt, sgst: it.SgstAmt, igst: it.IgstAmt };
    it.RcmCd = cat.id; it.RcmCgstAmt = heads.cgst; it.RcmSgstAmt = heads.sgst; it.RcmIgstAmt = heads.igst; it.RcmItc = !!opt.itc;
    it.CgstAmt = 0; it.SgstAmt = 0; it.IgstAmt = 0;
    it.TotItemVal = r2(it.AssAmt + it.CesAmt);
    rcmOf[i] = { line: i, category: cat.id, section: cat.section, notification: cat.notification, serial: cat.serial, rate, itc: !!opt.itc };
    return it;
  });
  const rcmLines = rcmOf.filter(Boolean);
  if (rcmLines.length) notes.push('Reverse charge on line' + (rcmLines.length > 1 ? 's ' : ' ') + rcmLines.map((x) => x.line + 1).join(', ') + ' (' + Array.from(new Set(rcmLines.map((x) => x.category + ', ' + x.notification))).join('; ') + '): the buyer pays the tax in cash; the supplier\'s bill carries none.');

  /**
   * ⚠️⚠️ SUMMED PER SLAB, ROUNDED ONCE — not rounded per line and added up. Every line is already 2dp, but the
   * INVOICE total is what a counterparty reconciles, and the round-off is a declared field (`RndOffAmt`) rather
   * than a silent adjustment. A paise mismatch here is not cosmetic: it is the single most common reason a
   * counterparty's system rejects an otherwise correct invoice.
   */
  const bySlab = {};
  let AssVal = 0, CgstVal = 0, SgstVal = 0, IgstVal = 0, CesVal = 0, Discount = 0, TaxVal = 0;
  const rcmVal = { c: 0, s: 0, i: 0 };
  for (const it of ItemList) {
    if (it.RcmCd) { rcmVal.c += it.RcmCgstAmt; rcmVal.s += it.RcmSgstAmt; rcmVal.i += it.RcmIgstAmt; }
    AssVal += it.AssAmt; CgstVal += it.CgstAmt; SgstVal += it.SgstAmt; TaxVal += it.TaxAmt || 0;
    IgstVal += it.IgstAmt; CesVal += it.CesAmt; Discount += it.Discount;
    const k = String(it.GstRt);
    const s = bySlab[k] || (bySlab[k] = { GstRt: it.GstRt, AssVal: 0, CgstVal: 0, SgstVal: 0, IgstVal: 0, CesVal: 0 });
    s.AssVal += it.AssAmt; s.CgstVal += it.CgstAmt; s.SgstVal += it.SgstAmt; s.IgstVal += it.IgstAmt; s.CesVal += it.CesAmt;
  }
  AssVal = r2(AssVal); CgstVal = r2(CgstVal); SgstVal = r2(SgstVal);
  IgstVal = r2(IgstVal); CesVal = r2(CesVal); Discount = r2(Discount); TaxVal = r2(TaxVal);
  for (const k of Object.keys(bySlab)) {
    const s = bySlab[k];
    s.AssVal = r2(s.AssVal); s.CgstVal = r2(s.CgstVal); s.SgstVal = r2(s.SgstVal); s.IgstVal = r2(s.IgstVal); s.CesVal = r2(s.CesVal);
  }

  const beforeRound = r2(AssVal + CgstVal + SgstVal + IgstVal + CesVal + TaxVal);
  /* ⭐ the unit the total rounds to is the pack's (India: a whole rupee). A scheme with no pack keeps the whole unit it
     always had — ⚠️ wrong for most VAT countries, and the reason a country needs its pack before it bills. */
  const unit = (pack && pack.invoice_round_to) || 1;
  const roundTo = (v) => (unit === 1 ? Math.round(v) : r2(Math.round(v / unit) * unit));
  const TotInvVal = roundTo(beforeRound);
  const RndOffAmt = r2(TotInvVal - beforeRound);

  /**
   * ⚠️ REVERSE CHARGE IS SHOWN, NOT COLLECTED. When the buyer accounts for the tax, the invoice still states the
   * rate and the amount — the buyer needs both to self-assess — but the seller does not collect it, so the
   * payable is the assessable value alone. Printing the tax-inclusive total as the amount due would ask the
   * customer to pay tax twice, once here and once to the government.
   */
  const AmountPayable = reverseCharge ? roundTo(r2(AssVal + Discount * 0)) : TotInvVal;
  if (reverseCharge) {
    notes.push('Reverse charge: the buyer accounts for the tax. The tax is stated for their records; '
      + 'only the taxable value is payable to you.');
  }
  if (priceIncludesTax) {
    notes.push('Your prices include tax, so the taxable value was worked back out of each price.');
  }

  return {
    TranDtls: {
      TaxSch: scheme,
      SupTyp: String(inp.supplyKind || (buyerSez ? 'SEZWOP' : ((buyer.Gstin && !buyerUnregistered) ? 'B2B' : 'B2C'))),
      RegRev: (reverseCharge || rcmLines.length) ? 'Y' : 'N',
      IgstOnIntra: 'N',
    },
    SellerDtls: pick(seller, ['Gstin', 'LglNm', 'TrdNm', 'Addr1', 'Addr2', 'Loc', 'Pin', 'State', 'Ph', 'Em']),
    BuyerDtls: Object.assign(
      pick(buyer, ['Gstin', 'LglNm', 'TrdNm', 'Addr1', 'Addr2', 'Loc', 'Pin', 'State', 'Ph', 'Em']),
      { Pos: pos }),
    ItemList,
    ValDtls: Object.assign({ AssVal, CgstVal, SgstVal, IgstVal, CesVal, StCesVal: 0, Discount, RndOffAmt, TotInvVal, TaxVal },
      /* v1.20.0 — the RCM heads, present ONLY on an invoice with a reverse-charge line (every other invoice keeps its shape) */
      rcmLines.length ? { RcmCgstVal: r2(rcmVal.c), RcmSgstVal: r2(rcmVal.s), RcmIgstVal: r2(rcmVal.i) } : {}),
    /* Ours, beside the standard shape rather than inside it — a caller needs these and INV-01 has nowhere for them. */
    _cb: { scheme, supply, place_of_supply: pos, seller_state: sellerState, slabs: Object.values(bySlab),
           amount_payable: AmountPayable, reverse_charge: reverseCharge, price_includes_tax: priceIncludesTax,
           ...(rcmLines.length ? { rcm: rcmLines } : {}),
           notes },
  };
}

function pick(o, keys) {
  const src = o || {};
  const out = {};
  for (const k of keys) {
    const v = src[k] !== undefined ? src[k] : src[k.toLowerCase()];
    if (v !== undefined && v !== null && String(v) !== '') out[k] = v;
  }
  return out;
}

/* ── the provider seam ─────────────────────────────────────────────────────────────────────────────────────── */

/**
 * ⭐ THE SEAM, BORROWED FROM MEDUSA'S ITaxProvider AND WIDENED. Same two methods, same "return tax lines" idea —
 * so a future Avalara/ClearTax provider is a drop-in — but the context carries BOTH parties, because a provider
 * that cannot see the place of supply cannot answer an Indian question.
 *
 * ⚠️ THE DEFAULT PROVIDER DETERMINES NOTHING IT WAS NOT TOLD. It applies the rate on the line and splits it by
 * the supply type. It has no rate table, so it can never be stale — and it can never answer "what rate is this?"
 * either. That question belongs to the entity's HSN declarations or to a real provider, and pretending otherwise
 * is how a compliance liability gets shipped as a convenience.
 */
const systemProvider = {
  getIdentifier() { return 'cb_system'; },
  getTaxLines(lines, context) {
    const out = determine(Object.assign({}, context, { lines }));
    return out.ItemList.map((it) => ({
      line_item_id: it._line_id,
      rate: it.GstRt,
      code: it.HsnCd,
      name: out._cb.supply === 'inter' ? 'IGST' : 'CGST+SGST',
      provider_id: 'cb_system',
      CgstAmt: it.CgstAmt, SgstAmt: it.SgstAmt, IgstAmt: it.IgstAmt, AssAmt: it.AssAmt,
    }));
  },
};


/* ── reading an issued invoice ─────────────────────────────────────────────────────────────────────────────── */

/**
 * ⭐⭐⭐ PLACE OF SUPPLY — ONE RULE, FOR EVERY HOST (Athi, 2026-10-02; IGST Act s.10(1)(a)). Goods are supplied where their
 * movement terminates for delivery. A counter bill is handed over at the counter, so it is the SHOP's state — CGST + SGST,
 * even for a registered buyer from another state. Only a bill that RECORDS a delivery to a state (`delivery.state_code`)
 * is supplied there. Lived as two hand-kept copies (the counter page and the server) for one afternoon; here it is one.
 */
function placeOfSupply(rec, shopState) {
  const shop = String(shopState == null ? '' : shopState).trim();
  const d = (rec && typeof rec === 'object' && rec.delivery && typeof rec.delivery === 'object') ? rec.delivery : null;
  let to = d ? String(d.state_code == null ? '' : d.state_code).trim() : '';
  if (/^\d$/.test(to)) to = '0' + to;
  return /^\d{2}$/.test(to) ? to : shop;
}

/**
 * ⭐⭐⭐ moneyOf(invoice, currency?) — WHAT AN ISSUED INVOICE SAYS, IN THE HEADER'S OWN NAMES. A MAPPING, NOT A CALCULATION
 * (Athi, 2026-10-02: "the final computed values stored and the same has to be seen in every other place, no further
 * computation as the chit is frozen once it become chit"). determine() computed the invoice once; this only reads it out
 * — adding up heads the invoice already holds, nothing re-derived from prices. The counter's screen and slip, the
 * server's summary_json.money, the ledgers' readers and the buyer's popup all take their figures from here, so they can
 * never disagree about one frozen chit.
 *   { gross, savings, net, taxable, tax, total, round_off,          ← summary_json.money's names
 *     cgst, sgst, igst, cess, vat, supply, pos_state, currency_code,
 *     by_rate: { "<rate>": { taxable, cgst, sgst, igst, tax, cess? } },     ← every slab the invoice carries
 *     heads:   [ { name, rate, base, amount } ],                      ← the printed tax lines, rate > 0
 *     lines:   [ { gross, discount, taxable, cgst, sgst, igst, cess, tax, total } ] }  ← ItemList, in order
 * `net` is gross − savings (the price after offers, as the header has always meant it); `total` is the invoice's total.
 */
function moneyOf(inv, currency) {
  const v = (inv && inv.ValDtls) || {}, cb = (inv && inv._cb) || {}, items = (inv && Array.isArray(inv.ItemList)) ? inv.ItemList : [];
  const supply = cb.supply || 'unknown';
  const gross = r2(items.reduce((a, it) => a + num(it.TotAmt), 0));
  const savings = r2(num(v.Discount));
  const cgst = r2(num(v.CgstVal)), sgst = r2(num(v.SgstVal)), igst = r2(num(v.IgstVal)), cess = r2(num(v.CesVal)), vat = r2(num(v.TaxVal));
  const by_rate = {}, heads = [];
  for (const s of (cb.slabs || [])) {
    const rt = num(s.GstRt);
    by_rate[String(rt)] = { taxable: r2(num(s.AssVal)), cgst: r2(num(s.CgstVal)), sgst: r2(num(s.SgstVal)), igst: r2(num(s.IgstVal)),
                            tax: r2(num(s.CgstVal) + num(s.SgstVal) + num(s.IgstVal) + num(s.CesVal)) };
    if (num(s.CesVal)) by_rate[String(rt)].cess = r2(num(s.CesVal));     /* v1.16.0: the slab's cess, so the books post it; absent when nil (the shape is unchanged for every other invoice) */
    if (!rt) continue;
    if (supply === 'inter') heads.push({ name: 'IGST', rate: rt, base: r2(num(s.AssVal)), amount: r2(num(s.IgstVal)) });
    else if (supply === 'intra') {
      heads.push({ name: 'CGST', rate: rt / 2, base: r2(num(s.AssVal)), amount: r2(num(s.CgstVal)) });
      heads.push({ name: 'SGST', rate: rt / 2, base: r2(num(s.AssVal)), amount: r2(num(s.SgstVal)) });
    }
  }
  heads.sort((a, b) => a.rate - b.rate || (a.name < b.name ? -1 : 1));
  /* v1.20.0 — reverse charge, read from the lines that carry it (absent when none does, so every other invoice keeps its shape):
     rcm.rows is what a purchase_bill event takes as `rcm`; rcm.lines names each line's category and notification. */
  let rcm;
  const rl = Array.isArray(cb.rcm) ? cb.rcm : [];
  if (rl.length) {
    const rows = {}, ls = [];
    let rt = 0, rc = 0, rsg = 0, ri = 0;
    rl.forEach((x) => {
      const it = items[x.line] || {}, c = r2(num(it.RcmCgstAmt)), sg = r2(num(it.RcmSgstAmt)), ig = r2(num(it.RcmIgstAmt)), tx = r2(num(it.AssAmt));
      const k = x.rate + '|' + (x.itc ? 1 : 0), row = rows[k] || (rows[k] = { rate: x.rate, itc: !!x.itc, taxable: 0, cgst: 0, sgst: 0, igst: 0 });
      row.taxable += tx; row.cgst += c; row.sgst += sg; row.igst += ig; rt += tx; rc += c; rsg += sg; ri += ig;
      ls.push({ line: x.line, category: x.category, section: x.section, notification: x.notification, rate: x.rate, itc: !!x.itc, taxable: tx, cgst: c, sgst: sg, igst: ig, tax: r2(c + sg + ig) });
    });
    const rr = Object.keys(rows).sort().map((k) => { const w = rows[k]; return { rate: w.rate, itc: w.itc, taxable: r2(w.taxable), cgst: r2(w.cgst), sgst: r2(w.sgst), igst: r2(w.igst) }; });
    rcm = { taxable: r2(rt), cgst: r2(rc), sgst: r2(rsg), igst: r2(ri), tax: r2(rc + rsg + ri), rows: rr, lines: ls };
  }
  return Object.assign({
    gross, savings, net: r2(gross - savings), taxable: r2(num(v.AssVal)), tax: r2(cgst + sgst + igst + cess + vat),
    total: r2(num(v.TotInvVal)), round_off: r2(num(v.RndOffAmt)),
    cgst, sgst, igst, cess, vat, supply, pos_state: cb.place_of_supply || null, currency_code: currency || null,
    by_rate, heads,
    lines: items.map((it) => ({ gross: r2(num(it.TotAmt)), discount: r2(num(it.Discount)), taxable: r2(num(it.AssAmt)),
      cgst: r2(num(it.CgstAmt)), sgst: r2(num(it.SgstAmt)), igst: r2(num(it.IgstAmt)), cess: r2(num(it.CesAmt)),
      tax: r2(num(it.CgstAmt) + num(it.SgstAmt) + num(it.IgstAmt) + num(it.CesAmt) + num(it.TaxAmt)), total: r2(num(it.TotItemVal)) })),
  }, rcm ? { rcm } : {});
}

const EXPORTS = { determine, supplyType, systemProvider, r2, splitLineTax, lineHeads, placeOfSupply, moneyOf };

/**
 * ⭐ CBTax.slab — the counter has always asked ONE global for both halves (CBTax.slab.resolve). It is the tax-slab engine
 * itself, found where the page put it, never a copy. Not enumerable, so the export list is exactly the server's.
 * ⚠️ Load tax-slab BEFORE tax on a page (engines.json "needs"); the counter's bundle does. On the server require
 * tax-slab directly — nothing there reads .slab.
 */
Object.defineProperty(EXPORTS, 'slab', { enumerable: false, get: function () {
  return root.CBTaxSlab || (root.window && root.window.CBTaxSlab) || undefined;
} });

/* ⭐ ONE FILE, EVERY HOST: node takes module.exports; a page, the TV and the shop PC take window.CBTax. */
if (typeof module !== 'undefined' && module.exports) module.exports = EXPORTS;
if (root && typeof root.window !== 'undefined') root.window.CBTax = EXPORTS;
})(typeof globalThis !== 'undefined' ? globalThis : this);
