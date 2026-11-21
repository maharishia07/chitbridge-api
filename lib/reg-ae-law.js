/* ADOPTED from chitbridge-engines v1.102.0 · reg-ae-law · sha256 6b09f4a26d61b7f6f10d14def453db83a43e4e2551663c9c453c78f6e9a248a2 — DO NOT EDIT HERE. Change it in chitbridge-engines, release a version, then run tools/adopt.cjs. */
/* chitbridge-engines · reg-ae-law. Edited ONLY in chitbridge-engines/src/reg-ae-law.js; every platform adopts a released version of it. */
/*
 * OWNS      the UAE's laws the regulation pack states as DATA: the Designated Zones by Emirate (VAT Decree-Law Art. 50), the e-invoicing mandate's scope, phases and penalties (MoF decisions), and Corporate Tax (CTL) bands and reliefs. DATA only; no code path.
 * CALLED BY reg-ae.js (pack.designatedZones, pack.einvoice, pack.corporateTax: read by the registration and e-invoicing screens and the country matrix). Moved out of reg-ae.js unchanged (v1.98.0 file-size ceiling).
 * FLOW      reg-ae.js requires this file ──▶ { DESIGNATED, EINVOICE, CORPORATE_TAX } ──▶ the pack's members of those names
 * CARD      15-tax-and-country-packs/country-packs-jurisdiction
 */
(function (root) {
  'use strict';
  // @stage tested
  // @stage-note The UAE's zones, e-invoicing mandate and Corporate Tax data, moved out of reg-ae.js with no change of data.
  /** the seven Emirates, in the order the FTA's Designated Zones list groups them (DZ); RET Box 1 reports standard-rated supplies by Emirate (ER Art. 72(2)) */
  /** the Designated Zones named in the FTA's list (Cabinet Decision 59 of 2017 as amended by 35 of 2018) — DATA, 23 names; DL Art. 50: a Designated Zone "shall be treated as being outside the State". ⚠️ an FTA news item of 30 Oct 2021 says 27 — the four later additions were not found in a fetched official document (AE0 §14) */
  const DESIGNATED_ZONES = {
    'Abu Dhabi': [
      'Free Trade Zone of Khalifa Port',
      'Abu Dhabi Airport Free Zone',
      'Khalifa Industrial Zone',
      'Al Ain International Airport Free Zone',
      'Al Butain International Airport Free Zone'
    ],
    'Dubai': [
      'Jebel Ali Free Zone (North-South)',
      'Dubai Cars and Automotive Zone (DUCAMZ)',
      'Dubai Textile City',
      'Free Zone Area in Al Quoz',
      'Free Zone Area in Al Qusais',
      'Dubai Aviation City',
      'Dubai Airport Free Zone',
      'International Humanitarian City – Jebel Ali'
    ],
    'Sharjah': ['Hamriyah Free Zone', 'Sharjah Airport International Free Zone'],
    'Ajman': ['Ajman Free Zone'],
    'Umm Al Quwain': ['Umm Al Quwain Free Trade Zone in Ahmed Bin Rashid Port', 'Umm Al Quwain Free Trade Zone on Sheikh Mohammed Bin Zayed Road'],
    'Ras Al Khaimah': ['RAK Free Trade Zone', 'RAK Maritime City Free Zone', 'RAK Airport Free Zone'],
    'Fujairah': ['Fujairah Free Zone', 'FOIZ (Fujairah Oil Industry Zone)']
  };
  const DESIGNATED = {
    zones: DESIGNATED_ZONES,
    count: 23,
    count_note:
      'FTA news of 30 Oct 2021 says "a full list of all 27 Designated Zones"; the four additions were not found in a fetched official document — treat this as data to be refreshed from the FTA page, not a constant',
    cite: 'DL Arts. 50–52; ER Art. 51; FTA list (Cabinet Decision 59 of 2017 as amended by 35 of 2018) https://tax.gov.ae/-/media/Files/FTA/links/Legislation/VAT/ar/05-designated-zones.pdf'
  };

  /**
   * ⭐ E-INVOICING — the mandate's scope and dates as DATA (MoF decisions; AE0 §12). Generation (PINT-AE, the 5-corner model) is a later round; what is decided is recorded here
   * so a screen can say when a shop is in scope. B2C is OUT until the Minister decides otherwise (MD244 Art. 5(2)).
   */
  const EINVOICE = {
    model: '5-corner DCTCE (Decentralised Continuous Transaction Control and Exchange), Peppol PINT-AE',
    spec_id: 'urn:peppol:pint:billing-1@ae-1',
    participant_scheme: '0235',
    scope: {
      b2b: true,
      b2g: true,
      g2b: true,
      g2g: true,
      b2c: false,
      regardless_of_vat_registration: true,
      excluded: [
        'sovereign government transactions',
        'airline passenger tickets (Electronic Ticket) and ancillary services (EMD)',
        'airline cargo under an Airway Bill (24 months only)',
        'financial services exempt from VAT or zero-rated under ER Art. 42'
      ],
      cite: 'MD243 Arts. 3–4; MD244 Art. 5(2); EI-MF §2; EI-GL §6.2'
    },
    phases: [
      { from: '2026-07-01', kind: 'pilot_and_voluntary', cite: 'MD244 Art. 3(4), Art. 4' },
      {
        revenue_at_least_minor: 5000000000,
        asp_by: '2026-10-30',
        live: '2027-01-01',
        cite: 'MD244 Art. 5(1)(a) as amended by MD66 Art. One (ASP by 30 Oct 2026, was 31 Jul 2026)'
      },
      { revenue_below_minor: 5000000000, asp_by: '2027-03-31', live: '2027-07-01', cite: 'MD244 Art. 5(1)(b)' },
      { kind: 'government', asp_by: '2027-03-31', live: '2027-10-01', cite: 'MD244 Art. 5(1)(c)' }
    ],
    revenue_definition: 'the gross income earned by a Person during the most recent Accounting Period, based on the financial statements (MD244 Art. 1)',
    issue_within_days: 14 /* MD243 Art. 6(5): from the Date of Business Transaction (the earlier of the transaction date or receipt of payment); a Registrant: DL Art. 67 */,
    report_to_fta_within: null /* MD243 Art. 6(6): "within the timeline prescribed by the Minister" — not yet fixed in any fetched decision (AE0 §14) */,
    doc_types: ['invoice', 'credit_note'] /* MD243 Art. 6; no debit note */,
    transaction_flags: [
      'free_trade_zone',
      'deemed_supply',
      'margin_scheme',
      'summary_invoice',
      'continuous_supply',
      'disclosed_agent_billing',
      'ecommerce',
      'exports'
    ] /* EI-MF field 5 */,
    mandatory_fields: 51 /* EI-MF §4.1 — the list itself is the MoF's document, not copied here */,
    system_failure_notice_days: 2 /* MD243 Art. 12 (business days) */,
    penalties: {
      not_implemented_per_month_minor: 500000,
      late_document_each_minor: 10000,
      late_document_month_cap_minor: 500000,
      failure_notice_per_day_minor: 100000,
      voluntary_adopters_exempt: true,
      cite: 'CD106 Arts. 2–3 and annex; EI-GL §8.2'
    },
    cite: 'TPL Art. 4(bis); MD243 (https://mof.gov.ae/wp-content/uploads/2025/09/Ministerial-Decision-no.-243-of-2025-on-the-Electronic-Invoicing-System.pdf); MD244 (https://mof.gov.ae/wp-content/uploads/2025/09/Ministerial-Decision-No.-244-of-2025-on-the-Implementation-of-the-Electronic-Invoicing-System.pdf); MD66 of 2026; CD106 of 2025; EI-GL v1.1; EI-MF v1.0'
  };

  /** Corporate Tax as DATA (CTL; AE0 §11) — the chart has the payable and the expense; NOTHING computes it yet */
  const CORPORATE_TAX = {
    law: 'Federal Decree-Law No. 47 of 2022 (amended by 60/2023, 40/2024, 28/2025)',
    from: 'financial years beginning on or after 2023-06-01',
    bands: [
      { upto_minor: 37500000, rate: 0, cite: 'CTL Art. 3(1)(a); Cabinet Decision 116 of 2022 Arts. 2–3' },
      { above_minor: 37500000, rate: 9, cite: 'CTL Art. 3(1)(b); CD116' }
    ],
    qualifying_free_zone_person: { qualifying_income_rate: 0, other_rate: 9, cite: 'CTL Art. 3(2)' },
    small_business_relief: {
      revenue_upto_minor: 300000000,
      periods_ending_by: '2026-12-31',
      extension_announced: 'to tax periods ending on or before 2029-12-31 (Ministerial Decision 131, MoF news 7 Aug 2026 — text not fetched)',
      cite: 'MD73 Art. 2'
    },
    top_up_tax: { rate: 15, from: '2025-01-01', group_revenue_eur: 750000000, cite: 'CTL Art. 3(3); Cabinet Decision 142 of 2024' },
    return_months: 9,
    pay_months: 9,
    cite: 'CTL Arts. 3, 48, 53(1); CD116; MD73; CD142; MoF Corporate Tax page'
  };

  /* AE-F-03 (Walk AE 21 Nov): the legal forms a UAE business is set up as, asked once at Country setup (a shop's own answer, never inferred). The forms of a company are those of the
     Commercial Companies Law (Federal Decree-Law 32 of 2021, Art. 10: general partnership, limited partnership, public and private joint stock, limited liability company); a sole
     establishment, a branch of a foreign company and a free-zone establishment or company are the other ways a licence is held. Text of the Law unread here: the list is data to refresh
     from the Ministry of Economy's company-forms page; it only labels the shop, nothing is computed from it. */
  var LEGAL_FORMS = [
    { value: 'sole', label: 'Sole establishment' },
    { value: 'llc', label: 'Limited liability company (LLC)' },
    { value: 'partnership', label: 'Partnership' },
    { value: 'joint_stock', label: 'Joint stock company (public or private)' },
    { value: 'free_zone_est', label: 'Free-zone establishment (FZE)' },
    { value: 'free_zone_co', label: 'Free-zone company (FZ-LLC)' },
    { value: 'branch', label: 'Branch of a foreign company' }
  ];
  var EXPORTS = { DESIGNATED: DESIGNATED, EINVOICE: EINVOICE, CORPORATE_TAX: CORPORATE_TAX, LEGAL_FORMS: LEGAL_FORMS };
  /* ⭐ ONE FILE, EVERY HOST: node takes module.exports; a page takes window.CBRegAELaw (loaded before the pack that reads it). */
  if (typeof module !== 'undefined' && module.exports) module.exports = EXPORTS;
  if (root && typeof root.window !== 'undefined') root.window.CBRegAELaw = EXPORTS;
})(typeof globalThis !== 'undefined' ? globalThis : this);
