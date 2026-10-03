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
