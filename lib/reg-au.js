/* ADOPTED from chitbridge-engines v1.110.10 · reg-au · sha256 edebc79322a32cf0febfe333b443ae1ef8d0b0ccad0132ac8617cb0d9750361a — DO NOT EDIT HERE. Change it in chitbridge-engines, release a version, then run tools/adopt.cjs. */
/* chitbridge-engines · reg-au. Edited ONLY in chitbridge-engines/src/reg-au.js; every platform adopts a released version of it. */
/*
 * OWNS      the Australia regulation pack: its chart, AASB 101 lines, Division 40 depreciation, GST 10% with its supply kinds, the BAS periods and labels, the dated penalty unit and records rules, as data.
 * CALLED BY regulation.js (the registry), tax-packs.js (its tax member), gst-returns.js (the BAS), the api and the web (adopted copies).
 * FLOW      loaded by the registry ──▶ validated against the country standard ──▶ handed to the accounting core and the tax engines as one frozen object
 * CARD      15-tax-and-country-packs/country-packs-jurisdiction
 */
(function (root) {
  'use strict';
  /* R1 (v1.51.0): the shared country helpers — src/pack-kit.js, loaded before this pack; a change there re-runs every country's golden */
  var KIT = (root && root.CBPackKit) || (typeof require === 'function' ? require('./pack-kit') : null);
  var refuse_ = KIT.refuse,
    pad2_ = KIT.pad2,
    ymd_ = KIT.ymd,
    lastDay_ = KIT.lastDay;
  /* Australia's Xero / QBO move-in map (src/reg-au-movein.js), loaded before this pack */
  var MOVE_IN_MAP = (root && root.CBRegAUMoveIn) || (typeof require === 'function' ? require('./reg-au-movein') : null);
  // @stage tested
  // @stage-note [BOOKS · REGULATION PACK] Australia: the chart of accounts, the statement lines, GST (10%, three supply kinds), the tax-invoice rule,
  // @stage-note the ABN check, BAS periods and labels, Division 40 depreciation. DATA first, small rule functions beside it — the SHAPE of reg-in, not its content.
  /**
   * reg-au.js — THE AUSTRALIA REGULATION PACK (round AU1, v1.34.0, 2026-10-12; v1.38.0 IM1: the Xero / QuickBooks move-in map, `moveIn`).
   *
   * PLAN-2026-10-12 §B.1-2: a country is ONE pack registered in regulation.js; the accounting core knows no country. This file holds what is
   * Australian LAW and not accounting principle: the chart a shop starts with, the statement wording (AASB 101 — there is no Schedule III here),
   * GST as data (A New Tax System (Goods and Services Tax) Act 1999, "the GST Act"), the tax-invoice thresholds, the ABN format and checksum,
   * the BAS periods and labels, and Division 40 ITAA 1997 depreciation. Every rule cites the ATO page or the section it comes from.
   *
   * ⚠️ `verified: false` until an Australian accountant has read it — the thresholds and lives are as published when written (2026-10); the ATO page
   *    is the authority, this file is the record of it. OUT OF SCOPE (later rounds): PAYG withholding, superannuation guarantee and Single Touch
   *    Payroll CALCULATIONS — their payable ledgers are in the chart so the books have the slot, nothing posts to them yet; the simplified
   *    depreciation rules for small business (Subdiv 328-D, instant asset write-off); balancing adjustments on disposal (s.40-285); reverse charge on
   *    imported services (Div 84); fuel tax credits; wine equalisation tax; luxury car tax. The Xero / QuickBooks move-in MAP is here (`moveIn`, v1.38.0); the importer itself is the api's.
   *
   * The shape a pack must have is written and checked in regulation.js (CBRegulation.validate).
   *
   * ── ZERO DEPENDENCIES · DATA (and small rule functions) · NO CLOCK ──────────────────────────────────────────
   */

  /* ── the statement lines — 'bs' | 'pl' — AASB 101 Presentation of Financial Statements paras 54 (balance sheet) and 82 / 102 (profit or loss, by nature) ── */
  const LINES_AU = {
    ppe: { st: 'bs', side: 'assets', label: 'Property, plant and equipment', term: 'non_current' },
    investments: { st: 'bs', side: 'assets', label: 'Investments' },
    inventories: { st: 'bs', side: 'assets', label: 'Inventories', term: 'current' },
    trade_receivables: { st: 'bs', side: 'assets', label: 'Trade and other receivables', term: 'current' },
    cash: { st: 'bs', side: 'assets', label: 'Cash and cash equivalents', term: 'current' },
    other_current_assets: { st: 'bs', side: 'assets', label: 'Other current assets', term: 'current' },
    equity: { st: 'bs', side: 'equity', label: "Owner's equity / Share capital" },
    retained_earnings: { st: 'bs', side: 'equity', label: 'Retained earnings' },
    borrowings: { st: 'bs', side: 'liabilities', label: 'Borrowings' },
    trade_payables: { st: 'bs', side: 'liabilities', label: 'Trade and other payables', term: 'current' },
    statutory_liabilities: { st: 'bs', side: 'liabilities', label: 'GST and other statutory liabilities', term: 'current' },
    other_current_liabilities: { st: 'bs', side: 'liabilities', label: 'Other current liabilities', term: 'current' },
    provisions: { st: 'bs', side: 'liabilities', label: 'Provisions' },
    suspense: { st: 'bs', side: 'liabilities', label: 'Suspense (must be nil at close)' },
    revenue: { st: 'pl', side: 'income', label: 'Revenue' },
    other_income: { st: 'pl', side: 'income', label: 'Other income' },
    cost_of_sales: { st: 'pl', side: 'expense', label: 'Cost of sales' },
    changes_inventories: { st: 'pl', side: 'expense', label: 'Changes in inventories' },
    employee_benefits: { st: 'pl', side: 'expense', label: 'Employee benefits expense' },
    finance_costs: { st: 'pl', side: 'expense', label: 'Finance costs' },
    depreciation: { st: 'pl', side: 'expense', label: 'Depreciation and amortisation expense' },
    other_expenses: { st: 'pl', side: 'expense', label: 'Other expenses' }
  };

  /* ── the chart's groups: the code ranges keep reg-in's numbering (1xxx assets · 2xxx liabilities · 3xxx equity · 4xxx income · 5xxx cost of sales · 6xxx operating expenses) so a CA moving a client in reads the same shape ── */
  const GROUPS_AU = [
    /* ── primary ── */
    { code: 'equity', name: 'Equity', type: 'personal', nature: 'equity', side: 'cr', parent: null, range: [3000, 3199], line: 'equity' },
    {
      code: 'current_assets',
      name: 'Current Assets',
      type: 'real',
      nature: 'asset',
      side: 'dr',
      parent: null,
      range: [1800, 1899],
      line: 'other_current_assets'
    },
    {
      code: 'current_liabilities',
      name: 'Current Liabilities',
      type: 'personal',
      nature: 'liability',
      side: 'cr',
      parent: null,
      range: [2400, 2899],
      line: 'other_current_liabilities'
    },
    { code: 'non_current_assets', name: 'Non-current Assets', type: 'real', nature: 'asset', side: 'dr', parent: null, range: [1000, 1099], line: 'ppe' },
    { code: 'investments', name: 'Investments', type: 'real', nature: 'asset', side: 'dr', parent: null, range: [1100, 1199], line: 'investments' },
    {
      code: 'non_current_liabilities',
      name: 'Non-current Liabilities',
      type: 'personal',
      nature: 'liability',
      side: 'cr',
      parent: null,
      range: [2030, 2099],
      line: 'borrowings'
    },
    { code: 'suspense', name: 'Suspense', type: 'personal', nature: 'liability', side: 'cr', parent: null, range: [2900, 2999], line: 'suspense' },
    { code: 'cost_of_sales', name: 'Cost of Sales', type: 'nominal', nature: 'expense', side: 'dr', parent: null, range: [5100, 5999], line: 'cost_of_sales' },
    { code: 'other_income', name: 'Other Income', type: 'nominal', nature: 'income', side: 'cr', parent: null, range: [4200, 4999], line: 'other_income' },
    {
      code: 'operating_expenses',
      name: 'Operating Expenses',
      type: 'nominal',
      nature: 'expense',
      side: 'dr',
      parent: null,
      range: [6000, 6999],
      line: 'other_expenses'
    },
    { code: 'purchases', name: 'Purchases', type: 'nominal', nature: 'expense', side: 'dr', parent: null, range: [5000, 5099], line: 'cost_of_sales' },
    { code: 'sales', name: 'Sales', type: 'nominal', nature: 'income', side: 'cr', parent: null, range: [4000, 4199], line: 'revenue' },
    /* ── sub-groups ── */
    { code: 'bank_accounts', name: 'Bank Accounts', type: 'real', nature: 'asset', side: 'dr', parent: 'current_assets', range: [1500, 1599], line: 'cash' },
    {
      code: 'bank_overdraft',
      name: 'Bank Overdraft',
      type: 'personal',
      nature: 'liability',
      side: 'cr',
      parent: 'non_current_liabilities',
      range: [2020, 2029],
      line: 'borrowings',
      term: 'current' /* an overdraft is repayable on demand: AASB 101 para 69 */
    },
    { code: 'cash_on_hand', name: 'Cash on Hand', type: 'real', nature: 'asset', side: 'dr', parent: 'current_assets', range: [1400, 1499], line: 'cash' },
    {
      code: 'deposits',
      name: 'Deposits and Bonds',
      type: 'real',
      nature: 'asset',
      side: 'dr',
      parent: 'current_assets',
      range: [1600, 1699],
      line: 'other_current_assets'
    },
    {
      code: 'gst_and_statutory',
      name: 'GST and Statutory Liabilities',
      type: 'personal',
      nature: 'liability',
      side: 'cr',
      parent: 'current_liabilities',
      range: [2200, 2299],
      line: 'statutory_liabilities'
    },
    {
      code: 'advances',
      name: 'Advances and Prepayments',
      type: 'personal',
      nature: 'asset',
      side: 'dr',
      parent: 'current_assets',
      range: [1700, 1799],
      line: 'other_current_assets'
    },
    {
      code: 'provisions',
      name: 'Provisions',
      type: 'personal',
      nature: 'liability',
      side: 'cr',
      parent: 'current_liabilities',
      range: [2300, 2399],
      line: 'provisions'
    },
    {
      code: 'retained_earnings',
      name: 'Retained Earnings',
      type: 'personal',
      nature: 'equity',
      side: 'cr',
      parent: 'equity',
      range: [3200, 3999],
      line: 'retained_earnings'
    },
    {
      code: 'loans',
      name: 'Loans',
      type: 'personal',
      nature: 'liability',
      side: 'cr',
      parent: 'non_current_liabilities',
      range: [2000, 2019],
      line: 'borrowings'
    },
    { code: 'inventory', name: 'Inventory', type: 'real', nature: 'asset', side: 'dr', parent: 'current_assets', range: [1200, 1299], line: 'inventories' },
    {
      code: 'trade_creditors',
      name: 'Trade Creditors',
      type: 'personal',
      nature: 'liability',
      side: 'cr',
      parent: 'current_liabilities',
      range: [2100, 2199],
      line: 'trade_payables'
    },
    {
      code: 'trade_debtors',
      name: 'Trade Debtors',
      type: 'personal',
      nature: 'asset',
      side: 'dr',
      parent: 'current_assets',
      range: [1300, 1399],
      line: 'trade_receivables'
    }
  ];

  /**
   * ⭐ THE LEDGERS THE POSTING RULES NAME (by role) — every role regulation.REQUIRED_ROLES lists, plus Australia's own. A customer is a line on
   * `debtors` carrying the party's id, a supplier a line on `creditors` (sub-ledgers, as in reg-in).
   * GST: ONE head — `gst_collected` (BAS 1A) and `gst_paid` (BAS 1B). PAYG withholding payable (BAS W2) and superannuation payable are PRESENT
   * so the books have the slot; nothing posts to them until the payroll round (PAYG / super / STP are out of scope here).
   * `sales_export` · `sales_gst_free` · `sales_input_taxed` are present so BAS G2 / G3 can be READ from posted ledgers when a shop posts there;
   * the counter's posting rules land every sale on `sales` by rate, so they stay nil until a rule or a manual entry uses them.
   */
  const LEDGERS_AU = [
    { role: 'stock', code: '1200', name: 'Inventory on hand', group: 'inventory' },
    { role: 'ppe_buildings', code: '1010', name: 'Buildings', group: 'non_current_assets' },
    { role: 'accdep_buildings', code: '1011', name: 'Accumulated depreciation — buildings', group: 'non_current_assets' },
    { role: 'ppe_plant', code: '1020', name: 'Plant and equipment', group: 'non_current_assets' },
    { role: 'accdep_plant', code: '1021', name: 'Accumulated depreciation — plant and equipment', group: 'non_current_assets' },
    { role: 'ppe_furniture', code: '1030', name: 'Furniture and fittings', group: 'non_current_assets' },
    { role: 'accdep_furniture', code: '1031', name: 'Accumulated depreciation — furniture and fittings', group: 'non_current_assets' },
    { role: 'ppe_vehicles', code: '1040', name: 'Motor vehicles', group: 'non_current_assets' },
    { role: 'accdep_vehicles', code: '1041', name: 'Accumulated depreciation — motor vehicles', group: 'non_current_assets' },
    { role: 'ppe_office', code: '1050', name: 'Office equipment', group: 'non_current_assets' },
    { role: 'accdep_office', code: '1051', name: 'Accumulated depreciation — office equipment', group: 'non_current_assets' },
    { role: 'ppe_computers', code: '1060', name: 'Computers', group: 'non_current_assets' },
    { role: 'accdep_computers', code: '1061', name: 'Accumulated depreciation — computers', group: 'non_current_assets' },
    { role: 'debtors', code: '1300', name: 'Customers (Trade debtors)', group: 'trade_debtors' },
    { role: 'cash', code: '1400', name: 'Cash on hand', group: 'cash_on_hand' },
    { role: 'bank', code: '1500', name: 'Business bank account', group: 'bank_accounts' },
    { role: 'card', code: '1520', name: 'Card and EFTPOS settlements', group: 'bank_accounts' },
    { role: 'prepaid_expenses', code: '1810', name: 'Prepayments', group: 'current_assets' },
    { role: 'accrued_income', code: '1820', name: 'Accrued income', group: 'current_assets' },
    { role: 'supplier_advance', code: '1700', name: 'Advances to suppliers', group: 'advances' },
    { role: 'creditors', code: '2100', name: 'Suppliers (Trade creditors)', group: 'trade_creditors' },
    { role: 'secured_loan', code: '2000', name: 'Secured loans', group: 'loans' },
    { role: 'unsecured_loan', code: '2010', name: 'Unsecured loans', group: 'loans' },
    { role: 'bank_od', code: '2020', name: 'Bank overdraft', group: 'bank_overdraft' },
    /* GST Act s.9-40 (liable for GST on taxable supplies you make — 1A) and s.11-20 (entitled to input tax credits on creditable acquisitions — 1B) */
    { role: 'gst_collected', code: '2200', name: 'GST collected', group: 'gst_and_statutory' },
    { role: 'gst_paid', code: '2210', name: 'GST paid', group: 'gst_and_statutory' },
    /* PRESENT, UNUSED until the payroll round: TAA 1953 Sch 1 s.12-35 (withholding from salary — BAS W2); Superannuation Guarantee (Administration) Act 1992 */
    { role: 'payg_withholding_payable', code: '2220', name: 'PAYG withholding payable', group: 'gst_and_statutory' },
    { role: 'super_payable', code: '2230', name: 'Superannuation payable', group: 'gst_and_statutory' },
    { role: 'customer_advance', code: '2400', name: 'Customer deposits (advances)', group: 'current_liabilities' },
    { role: 'accrued_expenses', code: '2410', name: 'Accrued expenses', group: 'current_liabilities' },
    { role: 'wages_payable', code: '2420', name: 'Wages and salaries payable', group: 'current_liabilities' },
    { role: 'income_in_advance', code: '2430', name: 'Income received in advance', group: 'current_liabilities' },
    { role: 'suspense', code: '2900', name: 'Suspense', group: 'suspense' },
    { role: 'capital', code: '3000', name: "Owner's capital", group: 'equity' },
    { role: 'drawings', code: '3100', name: 'Drawings', group: 'equity' },
    { role: 'retained', code: '3900', name: 'Retained earnings', group: 'retained_earnings' },
    { role: 'sales', code: '4000', name: 'Sales', group: 'sales' },
    { role: 'sales_export', code: '4010', name: 'Export sales (GST-free)', group: 'sales' },
    { role: 'sales_gst_free', code: '4020', name: 'GST-free sales', group: 'sales' },
    { role: 'sales_input_taxed', code: '4030', name: 'Input-taxed sales', group: 'sales' },
    { role: 'sales_returns', code: '4090', name: 'Sales returns and allowances', group: 'sales' },
    { role: 'interest_received', code: '4200', name: 'Interest received', group: 'other_income' },
    { role: 'gain_on_disposal', code: '4250', name: 'Gain on disposal of assets', group: 'other_income' },
    { role: 'fx_gain_loss', code: '4260', name: 'Foreign exchange gain or loss', group: 'other_income' } /* v1.45.0 (FX1): AASB 121 ¶28/¶23 */,
    { role: 'purchases', code: '5000', name: 'Purchases', group: 'purchases' },
    { role: 'purchase_returns', code: '5090', name: 'Purchase returns', group: 'purchases' },
    { role: 'changes_in_inventories', code: '5050', name: 'Changes in inventories', group: 'purchases', line: 'changes_inventories' },
    { role: 'discount_allowed', code: '6800', name: 'Discounts allowed', group: 'operating_expenses' },
    { role: 'bad_debts', code: '6850', name: 'Bad debts written off', group: 'operating_expenses' },
    { role: 'depreciation', code: '6200', name: 'Depreciation', group: 'operating_expenses', line: 'depreciation' },
    { role: 'loss_on_disposal', code: '6210', name: 'Loss on disposal of assets', group: 'operating_expenses' },
    { role: 'round_off', code: '6900', name: 'Rounding', group: 'operating_expenses' }
  ];

  /** what a shop pays for that is not stock — the drawer's "expense" chit carries one of these. Superannuation expense is here so the slot exists (the calculation is a later round). */
  const EXPENSE_CLASSES_AU = [
    { role: 'wages', code: '6015', name: 'Wages', group: 'operating_expenses', line: 'employee_benefits' },
    { role: 'freight_inward', code: '5110', name: 'Freight inwards', group: 'cost_of_sales' },
    { role: 'packing', code: '5120', name: 'Packaging', group: 'cost_of_sales' },
    { role: 'rent', code: '6010', name: 'Rent', group: 'operating_expenses' },
    { role: 'salary', code: '6020', name: 'Salaries', group: 'operating_expenses', line: 'employee_benefits' },
    { role: 'superannuation', code: '6025', name: 'Superannuation (employer contributions)', group: 'operating_expenses', line: 'employee_benefits' },
    { role: 'electricity', code: '6030', name: 'Electricity, gas and water', group: 'operating_expenses' },
    { role: 'telephone', code: '6040', name: 'Telephone and internet', group: 'operating_expenses' },
    { role: 'transport', code: '6050', name: 'Freight and delivery', group: 'operating_expenses' },
    { role: 'repairs', code: '6060', name: 'Repairs and maintenance', group: 'operating_expenses' },
    { role: 'stationery', code: '6070', name: 'Printing and stationery', group: 'operating_expenses' },
    { role: 'fuel', code: '6080', name: 'Motor vehicle expenses', group: 'operating_expenses' },
    { role: 'bank_charges', code: '6090', name: 'Bank and merchant fees', group: 'operating_expenses', line: 'finance_costs' },
    { role: 'commission_paid', code: '6100', name: 'Commission paid', group: 'operating_expenses' },
    { role: 'advertising', code: '6110', name: 'Advertising', group: 'operating_expenses' },
    { role: 'professional', code: '6120', name: 'Accounting and legal fees', group: 'operating_expenses' },
    { role: 'staff_welfare', code: '6130', name: 'Staff amenities', group: 'operating_expenses', line: 'employee_benefits' },
    { role: 'insurance', code: '6140', name: 'Insurance', group: 'operating_expenses' },
    { role: 'interest_paid', code: '6150', name: 'Interest paid', group: 'operating_expenses', line: 'finance_costs' },
    { role: 'sundry_expense', code: '6190', name: 'Sundry expenses', group: 'operating_expenses' }
  ];

  /** money that comes in and is not a sale — the `income` chit's classes. interest_received IS the ledger 4200. */
  const INCOME_CLASSES_AU = [
    { role: 'interest_received', code: '4200', name: 'Interest received', group: 'other_income' },
    { role: 'commission_received', code: '4210', name: 'Commission received', group: 'other_income' },
    { role: 'rent_received', code: '4220', name: 'Rent received', group: 'other_income' },
    { role: 'discount_received', code: '4230', name: 'Discounts received', group: 'other_income' },
    { role: 'scrap_sales', code: '4240', name: 'Scrap sales', group: 'other_income' },
    { role: 'sundry_income', code: '4290', name: 'Sundry income', group: 'other_income' }
  ];

  /**
   * ⭐ DEPRECIATION AS DATA — Division 40 ITAA 1997. `life` is the Commissioner's effective life in years (TR 2022/1, Table B — general items;
   * a shop with another kind adds its own class with the life from the ruling). The rates FOLLOW from the life: prime cost 100 ÷ life (s.40-75),
   * diminishing value 200 ÷ life for an asset first held on or after 10 May 2006 (s.40-72). Buildings are not Division 40 assets: capital works
   * are deducted under Division 43 at 2.5% a year (40 years, s.43-25) on cost — prime cost only.
   *   ato.gov.au › Depreciation and capital expenses and allowances › General depreciation rules – capital allowances; TR 2022/1 (effective life).
   */
  const ASSET_CLASSES_AU = [
    {
      class: 'buildings',
      cost_role: 'ppe_buildings',
      acc_role: 'accdep_buildings',
      life: 40,
      methods: ['prime_cost'],
      cite: 'Div 43 ITAA 1997 s.43-25: capital works 2.5% a year'
    },
    {
      class: 'plant',
      cost_role: 'ppe_plant',
      acc_role: 'accdep_plant',
      life: 10,
      cite: 'TR 2022/1 Table B — set per asset; 10 years is the general placeholder'
    },
    { class: 'furniture', cost_role: 'ppe_furniture', acc_role: 'accdep_furniture', life: 10, cite: 'TR 2022/1 Table B: furniture, freestanding — 10 years' },
    { class: 'vehicles', cost_role: 'ppe_vehicles', acc_role: 'accdep_vehicles', life: 8, cite: 'TR 2022/1 Table B: motor vehicles, cars — 8 years' },
    {
      class: 'office',
      cost_role: 'ppe_office',
      acc_role: 'accdep_office',
      life: 5,
      cite: 'TR 2022/1 Table B: office machines (photocopiers, printers) — 5 years'
    },
    {
      class: 'computers',
      cost_role: 'ppe_computers',
      acc_role: 'accdep_computers',
      life: 4,
      cite: 'TR 2022/1 Table B: computers, desktop — 4 years (laptops 2)'
    }
  ];
  /** every entity type follows Division 40 (a company, a sole trader, a partnership, a trust); the owner-capital bases are the sole trader and the partnership */
  const ENTITY_BASES_AU = {
    company: { basis: 'div40', methods: ['prime_cost', 'diminishing_value'], prorata: 'days' },
    sole_trader: { basis: 'div40', methods: ['prime_cost', 'diminishing_value'], prorata: 'days' },
    partnership: { basis: 'div40', methods: ['prime_cost', 'diminishing_value'], prorata: 'days' },
    trust: { basis: 'div40', methods: ['prime_cost', 'diminishing_value'], prorata: 'days' }
  };

  /* ── the Australia tax pack (the GST Act): the object tax-packs.PACKS.AU is ── */
  const TAX_AU = Object.freeze({
    country: 'AU',
    scheme: 'GST',
    /* l16-country (ACC-352, v1.98.0): what a shop's registration and tax-id screens read from the pack instead of a typed country: the schemes a registered shop can be on, the second ids beside the tax id, the licence rows only this country has,
       the tax-id schemes a party may carry (partyIds), whether its tax id is checked by the profile map, whether its return is read from the rail, and the vault tags whose length hint applies here. Australia: one GST scheme (regular); the ACN beside the ABN. */
    registrationForm: { partyIds: ['ABN', 'TIN', 'VAT'], schemes: ['regular'], idCheck: null, secondIds: [['ACN', 'acn']], extraIds: [], hintTags: [], railReturn: false },
    /* ⭐ TIMING (l16-aupack, 16 Nov 2026): WHEN the tax on a sale or a purchase is reported. The shop's own basis (`gst_basis`, one value per shop) decides what an open invoice or bill carried in at the start date does on payment; read by tax-packs.openingCarry. UNCONFIRMED: no primary page was read (ato.gov.au answered 403; see RULE-WATCH). */
    timing: Object.freeze({
      bases: Object.freeze(['cash', 'accrual']),
      opening: Object.freeze({ accrual: 'already_reported', cash: 'on_payment' }),
      cite: 'GST Act 1999 s.29-5 (non-cash: attributable on the earlier of invoice or payment), s.29-40 (cash: attributable when paid); ato.gov.au/businesses-and-organisations/gst-excise-and-indirect-taxes/gst/accounting-for-gst-in-your-business/choosing-an-accounting-method',
      status: 'unconfirmed'
    }),
    /* the border decides, never a state: one head on a domestic supply, nothing across the border (exports are GST-free, Div 38-E) */
    supply: 'border',
    rates: Object.freeze([0, 10]),
    /* R6-01: an export is GST-free only when the sale STATES it (tax.determine `isExport`), never on the buyer's address. The cite is the pack's own and UNREAD (ato.gov.au refuses automated fetches); a person confirms the wording. */
    export: Object.freeze({
      cite: "GST Act s.38-185 (GST-free exports; the pack's own cite, text unread)",
      evidence: 'a record that the goods were exported or the service used outside Australia, kept with the invoice (the export conditions of s.38-185, unread: confirm with the ATO).',
      must_state: true /* the sale must STATE the export (R6-01) */,
      status: 'unread'
    }),
    standard_rate: 10 /* s.9-70: 10% of the value of the taxable supply */,
    invoice_round_to: 0.01 /* to the cent; the total is the sum of its components, never a rounded figure posted */,
    prices_include_tax: true /* v1.65.0: the shelf price convention — displayed prices include GST (ACL s.48) */,
    /**
     * ⭐ THE THREE SUPPLY KINDS AS DATA. A line names its kind (`supply_kind`); tax.determine reads this table and puts the kind's rate on the line,
     * saying WHY in the invoice's notes and in `_cb.kinds`. `credit` is whether the input tax credits on what was bought to make the supply may be
     * claimed; `bas` is the label the sale is reported at. A line that names no kind is taxable at its own rate.
     *   ato.gov.au › GST › When to charge GST (and when not to): "Taxable sales", "GST-free sales", "Input-taxed sales".
     */
    supplyKinds: Object.freeze({
      taxable: Object.freeze({
        id: 'taxable',
        name: 'Taxable supply',
        short: 'Taxable',
        rate: 10,
        credit: true,
        bas: 'G1',
        why: 'GST at 10% applies (GST Act s.9-5, s.9-70).',
        cite: 'GST Act 1999 s.9-5 (taxable supplies), s.9-70 (10%)'
      }),
      gst_free: Object.freeze({
        id: 'gst_free',
        name: 'GST-free supply',
        short: 'GST-free',
        rate: 0,
        credit: true,
        bas: 'G3',
        why: 'GST-free: no GST is charged on this line, and the input tax credits on what was bought to make it may still be claimed (GST Act Division 38 — basic food, most health and education, exports).',
        cite: 'GST Act 1999 Div 38; ato.gov.au › GST-free sales'
      }),
      input_taxed: Object.freeze({
        id: 'input_taxed',
        name: 'Input-taxed supply',
        short: 'Input-taxed',
        rate: 0,
        credit: false,
        bas: 'G4',
        why: 'Input-taxed: no GST is charged on this line, and no input tax credit may be claimed on what was bought to make it (GST Act Division 40 — financial supplies, residential rent).',
        cite: 'GST Act 1999 Div 40; ato.gov.au › Input-taxed sales'
      })
    }),
    /**
     * ⭐ TAX INVOICES — GST Act s.29-70; ato.gov.au › GST › Tax invoices. A sale of A$82.50 (GST inclusive) or more needs a tax invoice for the buyer to
     * claim a credit (s.29-80(1) with GST Regulations 2019 s.29-80.01: the "low-value threshold" is $82.50, i.e. $75 plus GST); the seller must give one
     * within 28 days of a request. A tax invoice for A$1,000 or more must ALSO show the buyer's identity or ABN (s.29-70(1)(c)(ii)).
     */
    taxInvoice: Object.freeze({
      /* ACC-7 (v1.90.0): the thresholds as DATED rows {from, to, cite}, read by tax-packs.rowAsOf on the bill's own date; the flat members below are the row still open, kept for readers that never had a date.
         A date no row covers has no rule (taxInvoice answers required false and says so). UNVERIFIED (12 Nov 2026): no primary source could be read (ato.gov.au and AustLII answered 403). The only history we hold is the critic's unconfirmed note: A$50 ex-GST to 30 Jun 2007, A$75 ex-GST (A$82.50 inclusive) from 1 Jul 2007 (Treasury 2007-08 budget paper, snippet only), so the row starts 2007-07-01 and earlier days have NO row. */
      rows: Object.freeze([
        Object.freeze({
          from: '2007-07-01',
          to: null,
          from_minor: 8250,
          buyer_identity_from_minor: 100000,
          cite: 'unverified: no primary text read (ato.gov.au 403, AustLII 403). Secondary only: GST Act 1999 s.29-70(1), s.29-80 + GST Regulations 2019 s.29-80.01, tax invoice at A$82.50 incl. GST (A$75 ex-GST) from 1 Jul 2007; buyer identity or ABN from A$1,000. Whether the law says "more than" or "or more" the threshold is NOT confirmed; the engine reads A$82.50 and above (>=). 16 Nov 2026 (cb-country, ato.gov.au still 403, snippets of ATO pages via search only): ATO "When you can claim a GST credit" is reported as "more than $82.50", ATO "BAS and GST tips" as "$82.50 or more" — the two ATO pages disagree; the Regulations 2019 s.29-80.01 amount is reported as $75 with no invoice needed at $75 or less (GST-exclusive), which favours "more than $82.50". PROPOSED (needs Athi yes, new pack version): required = m > from_minor. Not changed here',
          status: 'unconfirmed'
        })
      ]),
      from_minor: 8250 /* A$82.50 including GST */,
      buyer_identity_from_minor: 100000 /* A$1,000 */,
      within_days: 28,
      cite: 'GST Act 1999 s.29-70(1) (contents), s.29-80 + GST Regulations 2019 s.29-80.01 ($82.50); ato.gov.au/businesses-and-organisations/gst-excise-and-indirect-taxes/gst/tax-invoices'
    }),
    /**
     * ⭐ ADJUSTMENT NOTE (ACC-192 slice 2, critic plan §8) — a price change after a tax invoice is an adjustment event (GST Act 1999 s.19-10, change in consideration). The supplier has an
     * INCREASING adjustment attributed when it becomes aware (s.29-20(1)); the recipient's matching DECREASING adjustment is attributable only when it holds an adjustment note (s.29-20(3)),
     * which the supplier must give within 28 days of a request or of becoming aware (s.29-75(2)). ONE document title for both directions; the paper states which. AU has no "debit note" in the Act.
     * ⚠️ cite-check: the ATO's adjustment-note information determination (the approved form and its contents) was NOT read for this row — its title, number and must-list are unverified, so
     * `contents` is held back (null) and `print_ok` is false: no screen prints a must-list as law until a person reads the determination and fills this row (29 Oct clause-letter lesson).
     */
    adjustmentNote: Object.freeze({
      title: 'Adjustment note',
      directions: Object.freeze({ increase: 'Increasing adjustment (supplier: s.29-20(1))', decrease: 'Decreasing adjustment (recipient: s.29-20(3))' }),
      event: 'GST Act 1999 s.19-10',
      within_days: 28 /* s.29-75(2): from the request or from becoming aware */,
      contents: null,
      print_ok: false,
      status: 'cite-check',
      cite_check: ['the ATO adjustment-note information determination (title, number, approved form, must-list)', 'whether an adjustment note is required when the change is below any threshold'],
      cite: 'GST Act 1999 s.19-10, s.29-20(1) and (3), s.29-75(2); ato.gov.au › Adjustment notes (not read for this row)'
    }),
    /** when a business must register — GST Act s.23-15 ($75,000 GST turnover; $150,000 for a non-profit); taxi / ride-sourcing from the first dollar (s.144-5) */
    registration: Object.freeze({
      turnover_minor: 7500000,
      nonprofit_minor: 15000000,
      cite: 'GST Act 1999 s.23-15, s.144-5; ato.gov.au › Registering for GST'
    }),
    source:
      'A New Tax System (Goods and Services Tax) Act 1999: s.9-5 / s.9-70 (taxable supply, 10%), Div 38 (GST-free), Div 40 (input taxed), s.29-70 / s.29-80 (tax invoices), s.23-15 (registration); ato.gov.au GST pages as read 2026-10'
  });

  /**
   * ⭐ ABN — the Australian Business Number: 11 digits with a checksum (abr.business.gov.au › Help › Format of the ABN; ATO "ABN format"):
   *   1. subtract 1 from the first digit;  2. multiply each digit by its weight 10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19;  3. the sum is divisible by 89.
   * abn.check(v) → { ok, abn (the 11 digits), formatted ('NN NNN NNN NNN'), why (null when ok) }; abn.valid(v) → boolean. Spaces and dashes are ignored.
   * This is a FORMAT check: whether the number is registered and active is the ABR's answer (ABN Lookup), never this file's.
   */
  const ABN_WEIGHTS = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];
  function abnCheck(v) {
    var s = String(v == null ? '' : v).replace(/[\s-]/g, '');
    if (!/^\d{11}$/.test(s)) return { ok: false, abn: null, formatted: null, why: 'An ABN is 11 digits.' };
    var sum = 0;
    for (var index = 0; index < 11; index++) sum += (Number(s[index]) - (index === 0 ? 1 : 0)) * ABN_WEIGHTS[index];
    if (sum % 89 !== 0) return { ok: false, abn: s, formatted: null, why: 'The ABN check digits do not match — a digit is wrong or two are swapped.' };
    return { ok: true, abn: s, formatted: s.slice(0, 2) + ' ' + s.slice(2, 5) + ' ' + s.slice(5, 8) + ' ' + s.slice(8, 11), why: null };
  }
  const ABN = {
    valid: function (v) {
      return abnCheck(v).ok;
    },
    check: abnCheck,
    weights: ABN_WEIGHTS,
    cite: 'abr.business.gov.au › Format of the ABN (modulus 89)'
  };

  /**
   * ⭐ taxInvoice(total_minor) → what a document for this total must be — read from TAX_AU.taxInvoice (s.29-70 / s.29-80):
   *   { required, buyer_identity, must: [the contents a tax invoice needs, s.29-70(1)], cite }
   *   required         a tax invoice (the words "Tax invoice", the seller's identity and ABN, the date, what was sold, the GST) — from A$82.50 incl. GST
   *   buyer_identity   the buyer's identity or ABN must be on it too — from A$1,000
   * Below A$82.50 a receipt is enough for the buyer's credit; the seller may still issue a tax invoice.
   */
  function taxInvoice(totalMinor, opt) {
    var t = TAX_AU.taxInvoice,
      m = Math.abs(Number(totalMinor) || 0);
    /* ACC-7: the row in force on the bill's own day is picked by the caller with tax-packs.rowAsOf (the one dated-row reader) and handed in as opt.row — invoice.build does; `opt.dated` says it looked.
       A caller that did not look reads the open row (as before); a day no row covers (opt.dated, no row) has no rule and says so. */
    var row = opt && opt.dated ? opt.row : t.rows[t.rows.length - 1];
    if (!row)
      return { required: false, buyer_identity: false, within_days: t.within_days, must: [], cite: t.cite, why: 'No GST tax-invoice rule is in force on the date of this bill (the row we hold starts 1 Jul 2007; earlier days are not read).' };
    var required = m >= row.from_minor,
      buyer = m >= row.buyer_identity_from_minor;
    var must = required
      ? [
          'the words "Tax invoice"',
          "the seller's identity (business name)",
          "the seller's ABN",
          'the date of issue',
          'a brief description of what is sold, with quantity and price',
          'the GST amount, or "Total price includes GST" when the GST is exactly one-eleventh of the total',
          'the extent to which each sale is a taxable sale'
        ]
      : [];
    if (buyer) must.push("the buyer's identity or ABN");
    var out = { required: required, buyer_identity: buyer, within_days: t.within_days, must: must, cite: t.cite };
    /* v1.73.0 (invoice reader): the sentence the paper carries when the buyer is missing — present only when the buyer is asked for, so every other answer keeps its shape */
    if (buyer) out.buyer_why = "From A$1,000 a tax invoice shows the buyer's identity or ABN (GST Act s.29-70(1)(c)(ii)).";
    return out;
  }

  /** supplyKindOf(line) → the kind row a line names (`supply_kind` | `tax_kind`), taxable when it names none, null when it names one the pack does not know */
  function supplyKindOf(line) {
    var l = line || {},
      k = String(l.supply_kind || l.tax_kind || 'taxable')
        .trim()
        .toLowerCase()
        .replace(/-/g, '_');
    return Object.prototype.hasOwnProperty.call(TAX_AU.supplyKinds, k) ? TAX_AU.supplyKinds[k] : null;
  }

  /**
   * ⭐ BAS — the Business Activity Statement (ato.gov.au › Business activity statements (BAS); "GST labels on your BAS"; "Due dates for lodging and paying your BAS").
   * periods({ frequency, fy }) → the BAS periods of one financial year, each { period, label, start, end, due }:
   *   quarterly (the default: GST turnover under A$20 million, s.27-5) — Q1 Jul–Sep due 28 Oct · Q2 Oct–Dec due 28 Feb · Q3 Jan–Mar due 28 Apr · Q4 Apr–Jun due 28 Jul;
   *   monthly (required from A$20 million turnover, s.27-15; optional below) — due the 21st of the following month.
   *   ⚠️ A due date that falls on a weekend or public holiday moves to the next business day (and a registered agent's lodgment program may give longer) —
   *   that needs a calendar, which this pure file does not have; the date here is the statutory one. `fy` is '2026-27' or 2026 (the year the FY STARTS, 1 July).
   */
  const QUARTERS_AU = [
    { q: 1, months: [7, 8, 9], due: [10, 28], words: 'Jul–Sept' },
    { q: 2, months: [10, 11, 12], due: [2, 28], words: 'Oct–Dec' },
    { q: 3, months: [1, 2, 3], due: [4, 28], words: 'Jan–Mar' },
    { q: 4, months: [4, 5, 6], due: [7, 28], words: 'Apr–Jun' }
  ];
  /** RW1-10: a month the way the rest of the product writes it in English (September is 'Sept') */
  const MONTH_WORDS_AU = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec'];
  function basPeriods(o) {
    var x = o || {},
      fq = String(x.frequency || 'quarterly').toLowerCase(),
      y = parseInt(String(x.fy || ''), 10);
    if (!(y > 0)) throw refuse_("BAS periods need the financial year they are in, as '2026-27' or 2026 (the year it starts, 1 July).");
    if (fq !== 'quarterly' && fq !== 'monthly') throw refuse_('A BAS is lodged quarterly or monthly — not "' + String(x.frequency).slice(0, 20) + '".');
    var label = 'FY' + pad2_((y + 1) % 100); /* 'FY27' = the year ending June 2027; the period IDs ('2026-Q1', '2026-07') never change — they are in stored data */
    if (fq === 'quarterly')
      return QUARTERS_AU.map(function (item) {
        var ys = item.months[0] >= 7 ? y : y + 1,
          ye = item.months[2] >= 7 ? y : y + 1,
          yd = item.due[0] >= 7 ? y : y + 1;
        if (item.q === 4) yd = y + 1; /* Q4 (Apr–Jun) is due 28 July of the NEXT calendar year */
        return {
          period: ys + '-Q' + item.q,
          label: label + ' Q' + item.q + ' (' + item.words + ' ' + ys + ')',
          frequency: 'quarterly',
          start: ymd_(ys, item.months[0], 1),
          end: ymd_(ye, item.months[2], lastDay_(ye, item.months[2])),
          due: ymd_(yd, item.due[0], item.due[1])
        };
      });
    var out = [];
    for (var index = 0; index < 12; index++) {
      var m = ((6 + index) % 12) + 1,
        yy = m >= 7 ? y : y + 1,
        nm = m === 12 ? 1 : m + 1,
        ny = m === 12 ? yy + 1 : yy;
      out.push({
        period: yy + '-' + pad2_(m),
        label: label + ' ' + MONTH_WORDS_AU[m - 1] + ' ' + yy, /* 'FY27 Jul 2026' (RW1-10: not the raw year-month); the period ID stays '2026-07' */
        frequency: 'monthly',
        start: ymd_(yy, m, 1),
        end: ymd_(yy, m, lastDay_(yy, m)),
        due: ymd_(ny, nm, 21)
      });
    }
    return out;
  }
  /**
   * ⭐ bas({ period, simpler? }, rows) → the BAS labels READ FROM THE POSTED LEDGERS of that period — nothing is recomputed from invoices.
   *   `rows` are the period's ledger MOVEMENTS by role, as ledger.accumulate gives them: [{ role, dr_minor, cr_minor }] (a code with no role is a shop's own ledger and is not a GST label).
   *   Labels (ato.gov.au › GST labels on your BAS), every amount in CENTS:
   *     G1  Total sales — GST inclusive (the form's "Does the amount at G1 include GST? Yes"): every sales ledger's net credit plus 1A
   *     G2  Export sales (`sales_export`)   G3  Other GST-free sales (`sales_gst_free`)   G4  Input taxed sales (`sales_input_taxed`, v1.90.0) — nil until a shop posts there (see LEDGERS_AU)
   *     Hand check: 1A = (G1 − G2 − G3 − G4) / 11 (GST is one-eleventh of a GST-inclusive taxable sale, GST Act s.9-70).
   *     G10 Capital purchases (the ppe_* ledgers' net debit)   G11 Non-capital purchases (purchases, purchase returns and every expense class)
   *     1A  GST on sales (`gst_collected` net credit)   1B  GST on purchases (`gst_paid` net debit)   9  the net amount: 1A − 1B (positive = payable, negative = refund, s.35-5)
   *   `simpler: true` (Simpler BAS — GST turnover under A$10 million, the default since 1 July 2017) answers G1, 1A and 1B only.
   *   G10 / G11 BASIS (decided by Athi 22 Nov 2026, ACC-351 / walk AP-F-09; DECISIONS.md:544): from the period that starts on or after the row's `from` in `returns.g10_g11` they are reported GST-INCLUSIVE, as the ATO BAS instructions,
   *   Step 3 (Purchases) ask: each is the purchase amount including the GST on it, and 1B stays the GST on them. Source: ATO BAS instructions, Step 3 (G10 Capital purchases, G11 Non-capital purchases) — NOT re-fetched live:
   *   ato.gov.au answered HTTP 403 on 16 Nov and again on 22 Nov 2026, so the wording is the decision record's (DECISIONS DEC-267), not a fresh read. An EARLIER period keeps its EXCLUSIVE row: a return already shown never changes (a new pack row applies from its start date).
   *   The GST of a purchase is NOT recomputed: the host reads it from the posted entry (the gst_paid line of a purchase whose base is a capital ledger, else non-capital) and passes it as rows of role gst_paid tagged
   *   `for: 'capital' | 'non_capital'` (rows sum to the 1B movement, so 1B is the same). An untagged gst_paid row counts as non-capital. Whether G11 counts GST-free and input-taxed purchases is still not confirmed (ACC-351), unchanged.
   *   FOLD NOTE (1129): walkz below said inclusive for every period; Athi's 22 Nov decision above dates it (a period before 2026-10-01 stays exclusive). The memo movement gst_on_capital is kept as the fallback when no gst_paid row is tagged for:capital.
   *   ⭐ WALK Z Z-F-02 (21 Nov 2026): G10 and G11 are GST-INCLUSIVE, like G1: the ATO's BAS instructions say "The amounts you report at all these labels must include GST" (the ATO lists the labels, G10 and G11 among them; the sentence does not name them) (ato.gov.au › Choosing an accounting method,
   *   read through a search snippet of the page; the ATO page itself answered HTTP 403 to the fetch — cb-country re-reads it in a browser). The GST of a purchase is in the ONE gst_paid ledger, so its capital part
   *   arrives as the memo movement `gst_on_capital` (the host reads it from the entries that carry both a GST line and a capital-asset line; returns.capitalGst names it):
   *   G10 = capital ledgers' net debit + gst_on_capital · G11 = non-capital net debit + (1B − gst_on_capital). With no memo row all of 1B lands in G11: G10 + G11 is still the whole purchases including GST.
   *   Wages, salaries and superannuation are NOT purchases and are not reported at G11 (they belong to W1/W2 and the super return).
   */
  /** the expense classes that are NOT purchases for the BAS (PAYG and super are reported elsewhere): left out of G11 (Z-F-03) */
  const NOT_A_PURCHASE_AU = ['wages', 'salary', 'superannuation'];
  /** the memo movement the host adds: GST paid on entries that also carry a capital-asset line (the capital part of 1B) */
  const GST_ON_CAPITAL_ROLE = 'gst_on_capital';
  const BAS_LABELS = {
    G1: 'Total sales',
    G2: 'Export sales',
    G3: 'Other GST-free sales',
    G4: 'Input taxed sales',
    G10: 'Capital purchases',
    G11: 'Non-capital purchases',
    '1A': 'GST on sales',
    '1B': 'GST on purchases',
    9: 'Your payment or refund amount'
  };
  /** G10 / G11 basis as DATED rows (the pack's own data; read by the period's first day). A row earlier than `from` keeps the figure a filed return showed. */
  const G10_G11_ROWS = Object.freeze([
    Object.freeze({
      from: '2000-07-01',
      to: '2026-09-30',
      basis: 'exclusive',
      cite: 'as the pack read them before 22 Nov 2026: GST-exclusive (the ledgers hold all GST paid in one account); ACC-351 — kept for every period that starts before the next row',
      status: 'unconfirmed'
    }),
    Object.freeze({
      from: '2026-10-01',
      to: null,
      basis: 'inclusive',
      cite: 'ATO BAS instructions, Step 3 (Purchases: G10 Capital purchases, G11 Non-capital purchases, GST included); Athi 22 Nov: from the first unlodged period, 1 Oct 2026 (DECISIONS.md, AP-F-09). NOT re-fetched live: ato.gov.au answered HTTP 403',
      status: 'unconfirmed'
    })
  ]);
  /** the first day of a BAS period id: '2026-Q1' (Jul-Sep 2026) → 2026-07-01 · '2027-Q3' → 2027-01-01 · '2026-07' → 2026-07-01; null when unreadable */
  function basStart_(period) {
    var q = /^(\d{4})-Q([1-4])$/.exec(String(period)),
      m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(String(period));
    if (q) return ymd_(Number(q[1]), QUARTERS_AU[Number(q[2]) - 1].months[0], 1);
    return m ? ymd_(Number(m[1]), Number(m[2]), 1) : null;
  }
  /** the G10 / G11 row in force for a period: the row that covers its first day (an unreadable id reads the open row) */
  function g10g11For_(period) {
    var day = basStart_(period),
      found = null;
    G10_G11_ROWS.forEach(function (row) {
      if (day == null ? row.to == null : row.from <= day && (row.to == null || day <= row.to)) found = row;
    });
    return found || G10_G11_ROWS[G10_G11_ROWS.length - 1];
  }
  function bas(o, rows) {
    var x = o || {},
      byRole = Object.create(null),
      gstFor = { capital: 0, non_capital: 0 };
    if (!x.period) throw refuse_("A BAS needs its period ('2026-Q1' or '2026-07').");
    (rows || []).forEach(function (item) {
      if (!item || !item.role) return;
      var a = byRole[item.role] || (byRole[item.role] = { dr: 0, cr: 0 });
      a.dr += int_(item.dr_minor, item.role);
      a.cr += int_(item.cr_minor, item.role);
      if (item.role === 'gst_paid') gstFor[item.for === 'capital' ? 'capital' : 'non_capital'] += int_(item.dr_minor, item.role) - int_(item.cr_minor, item.role);
    });
    var inclusive = g10g11For_(x.period).basis === 'inclusive';
    var cr = function (role) {
        var a = byRole[role];
        return a ? a.cr - a.dr : 0;
      },
      dr = function (role) {
        var a = byRole[role];
        return a ? a.dr - a.cr : 0;
      };
    var sum = function (nestedRoles, f) {
      return nestedRoles.reduce(function (total, item) {
        return total + f(item);
      }, 0);
    };
    var oneA = cr('gst_collected'),
      oneB = dr('gst_paid');
    /* fix/bas-monday: 'sales_taxed_other' is a TAXED receipt booked to an income ledger that is not a sales ledger (Sundry income): the caller reads it by the entry's GST line, not by the account, so G1 is taxable supplies by tax code */
    var salesRoles = ['sales', 'sales_export', 'sales_gst_free', 'sales_input_taxed', 'sales_returns', 'sales_taxed_other'];
    var g1 = sum(salesRoles, cr) + oneA;
    var labels = { G1: g1, '1A': oneA, '1B': oneB, 9: oneA - oneB };
    /* v1.39.0 (BAS1): the ledger ROLES each label was read from, so a screen can open what a figure counts — the same lists the sums above use */
    var capitalRoles = ASSET_CLASSES_AU.map(function (item) {
        return item.cost_role;
      }),
      nonCapitalRoles = ['purchases', 'purchase_returns'].concat(
        EXPENSE_CLASSES_AU.filter(function (e) {
          return NOT_A_PURCHASE_AU.indexOf(e.role) < 0;
        }).map(function (e) {
          return e.role;
        })
      );
    var roles = {
      G1: salesRoles.concat(['gst_collected']),
      '1A': ['gst_collected'],
      '1B': ['gst_paid'],
      9: ['gst_collected', 'gst_paid'],
      G2: ['sales_export'],
      G3: ['sales_gst_free'],
      G4: ['sales_input_taxed'],
      G10: inclusive ? capitalRoles.concat(['gst_paid']) : capitalRoles /* inclusive: the GST of a capital purchase is read from gst_paid rows tagged for: 'capital' */,
      G11: inclusive ? nonCapitalRoles.concat(['gst_paid']) : nonCapitalRoles
    };
    if (!x.simpler) {
      labels.G2 = cr('sales_export');
      labels.G3 = cr('sales_gst_free');
      labels.G4 = cr('sales_input_taxed'); /* ACC-233 (v1.90.0): input-taxed sales (Div 40) are in G1 and reported again at G4, read from the ledger a kind-carrying line posted to */
      var capitalGst = Math.min(Math.max(dr(GST_ON_CAPITAL_ROLE), 0), Math.max(oneB, 0)); /* walkz: the capital part of 1B by the memo movement, never more than 1B */
      var capitalPart = gstFor.capital > 0 ? gstFor.capital : capitalGst; /* decAU: rows tagged for:capital win; the memo is the fallback when none is tagged */
      labels.G10 = sum(capitalRoles, dr) + (inclusive ? capitalPart : 0);
      labels.G11 = sum(nonCapitalRoles, dr) + (inclusive ? oneB - capitalPart : 0);
    }
    var out = {
      period: x.period,
      simpler: !!x.simpler,
      labels: {},
      payable_minor: Math.max(0, oneA - oneB),
      refund_minor: Math.max(0, oneB - oneA),
      g10_g11_basis: x.simpler ? null : inclusive ? 'GST-inclusive (ATO BAS Step 3; 1B is the GST on them)' : 'GST-exclusive (the ledgers hold all GST paid in one account)',
      cite: 'ato.gov.au › GST labels on your BAS; Simpler BAS (turnover under A$10 million)'
    };
    Object.keys(labels).forEach(function (item) {
      out.labels[item] = { label: BAS_LABELS[item], minor: labels[item], roles: roles[item].slice() };
    });
    return out;
  }
  function int_(v, where) {
    return KIT.int(v, where, 'cents');
  }

  /** voucher series — the same standard prefixes as reg-in (Athi, 2026-10-02: "Follow the standard"); 'MJ' is a person's own entry of any kind */
  const VOUCHER_SERIES_AU = { Sales: 'SV', Purchase: 'PV', Receipt: 'RV', Payment: 'PY', Contra: 'CV', 'Credit note': 'CN', 'Debit note': 'DN', Journal: 'JV' };
  const MANUAL_SERIES_AU = 'MJ';

  /**
   * ⭐ accountExtras(row, group, pack) → the fields of a chart account that are Australia's own: the group's name, the statement line the ledger lands on
   * (the row's, else its group's) with that line's label and statement ('bs' | 'pl'). The field is `line` — there is no Schedule III here.
   */
  function accountExtras(r, g, pack) {
    return KIT.lineExtras(r, g, pack || PACK);
  }

  /** ⭐ THE TAX HEADS (b2): ONE — `gst`. Output tax lands on GST collected (1A), input tax on GST paid (1B); no reverse-charge ledger (Div 84 is a later round, refused by name). */
  const TAX_HEADS = ['gst'];
  const TAX_LEDGERS = { gst: { output: 'gst_collected', input: 'gst_paid', rcm: null } };

  /**
   * ⭐ setOff({ output, input }, minor) → { utilised, payable, carried, refund } — ONE head, so the order is trivial: GST paid (1B) against GST collected (1A).
   * What is left of 1A is payable (BAS 9); what is left of 1B is a REFUND the ATO pays (GST Act s.35-5), not a credit carried into the next period —
   * it is returned as `carried` so the core's shape holds, and named `refund` beside it. Amounts in MINOR units, read by `minor` (the core's one reader).
   */
  function setOff(o, minor) {
    return KIT.singleHeadSetOff(o, minor, {
      head: 'gst',
      leftover: 'refund',
      negative: 'A GST balance is never negative here — pass the credit balance of GST collected and the debit balance of GST paid.'
    });
  }
  /** a stored event keeps the type name it was posted under; the core's rule is the neutral one */
  const EVENT_ALIASES = { gst_setoff: 'tax_setoff', gst_payment: 'tax_payment' };
  /** the sentences a refusal says when it has to name this country's own terms */
  const MESSAGES = {
    nothingToSetOff: 'Nothing to set off: no GST paid (1B) meets GST collected (1A) this period.',
    payHeadUnknown: 'A GST payment is one head — gst.',
    rcmHeadUnknown: 'Reverse charge is one head — gst.',
    paymentEmpty: 'A GST payment needs the gst head with an amount.',
    rcmNotBuilt: { gst: 'Reverse charge on imported services (GST Act Division 84) is not built — post it as a manual entry.' },
    /* v1.48.0 (W2-BOOKS): the words a BAS payment is recorded under — the ATO's payment reference number (on the BAS payment slip; ato.gov.au › How to pay)
     and the narration the entry carries. ONE word per country: the platform never says "challan" to an Australian shop. */
    paymentRef: {
      label: 'Payment reference number',
      ask: 'Which payment? Give the ATO payment reference number from the BAS payment slip.',
      hint: 'The payment reference number on the BAS',
      narration: 'BAS payment'
    },
    setOffNarration: 'GST set-off'
  };

  /**
   * ⭐ depreciation.compute(rows, base, ctx) → { total, rate, per } for ONE asset class — Division 40 ITAA 1997. `rows` are the assets of the class
   * ({ id, c (the class row), cost, wdv (opening adjustable value; null for one bought this year), days (held this year), added, proceeds }), amounts in
   * MINOR units; ctx { method: 'prime_cost' | 'diminishing_value' (the core's 'slm' | 'wdv' are read as the same), diy (days in the year) }.
   *   prime cost (s.40-75):          cost × days held ÷ days in the year × 100 ÷ effective life
   *   diminishing value (s.40-72):   opening adjustable value (cost in the first year) × days held ÷ days in the year × 200 ÷ effective life
   * The decline never takes the adjustable value below nil. A class whose `methods` exclude the one asked (buildings: Div 43 prime cost only) uses the
   * one it allows. ⚠️ Disposal is a BALANCING ADJUSTMENT (s.40-285), a separate event — `proceeds` are not read here. Each asset is rounded once;
   * the class total is their sum (the core adds any drift to the first asset).
   */
  function depreciationCompute(list, base, ctx) {
    var c = list[0].c,
      diy = ctx.diy,
      m = String(ctx.method || 'prime_cost');
    if (m === 'slm') m = 'prime_cost';
    else if (m === 'wdv') m = 'diminishing_value';
    if (c.methods && c.methods.indexOf(m) < 0) m = c.methods[0];
    var rate = m === 'prime_cost' ? Math.round(10000 / c.life) / 100 : Math.round(20000 / c.life) / 100;
    var per = list.map(function (item) {
      if (item.cost === null && item.wdv === null) throw refuse_('Division 40 needs the cost or the opening adjustable value of asset ' + item.id + '.');
      var open = item.wdv !== null && item.wdv !== undefined ? item.wdv : item.cost;
      var ch = ((((m === 'prime_cost' ? item.cost : open) * item.days) / diy) * rate) / 100;
      ch = Math.min(ch, Math.max(0, open));
      return Math.round(Number(ch.toPrecision(15)));
    });
    return {
      total: per.reduce(function (total, item) {
        return total + item;
      }, 0),
      rate: rate,
      per: per
    };
  }

  /**
   * ⭐ THE STATEMENTS' FORM (b5) — AASB 101, as the ledger presents them. `lines` is the statement table above; `lineOf / labelOf / placed` read and set the
   * statement-line fields of a ledger record (`line`, `line_label`); `taxNetting` nets GST paid against GST collected (one head) — a net debit is a refund due
   * (an other current asset), a net credit stays under the statutory-liabilities line; `profitLine` takes the year's profit to date; `ownerCapitalBases` are
   * the entity bases whose capital is one account; `ageing` is the common 30 / 60 / 90-day practice in MONTHS (AASB 7 para 37 asks for an age analysis and
   * prescribes no buckets — there is no statutory table).
   */
  const AGE_AU = [
    ['not_due', null],
    ['lt_1m', [0, 1]],
    ['m1_2', [1, 2]],
    ['m2_3', [2, 3]],
    ['gt_3m', [3, null]]
  ];
  /** the current / non-current `term` of a statement line (a ledger or a group may carry its own, which wins): AASB 101 (Presentation of Financial Statements) para 60 asks for the split, para 66 names the current assets (the operating cycle, within 12 months, cash) and para 69 the current liabilities. A line whose answer turns on the settlement date (borrowings, provisions, investments) carries NO term here — it is shown unclassified, never guessed. */
  const TERM_CITE_AU = 'AASB 101 paras 60, 66 and 69 (current / non-current)';
  const PRESENTATION = {
    lines: LINES_AU,
    lineOf: function (a) {
      return a.line;
    },
    labelOf: function (a) {
      return a.line_label;
    },
    placed: function (a, key) {
      return Object.assign({}, a, { line: key, line_label: LINES_AU[key] ? LINES_AU[key].label : null });
    },
    taxNetting: [
      {
        output: 'gst_collected',
        input: 'gst_paid',
        creditRole: 'gst_refund_due',
        payableRole: 'gst_payable',
        creditName: 'GST refund due from the ATO',
        payableName: 'GST payable to the ATO'
      }
    ],
    creditLine: 'other_current_assets',
    payableLine: 'statutory_liabilities',
    profitLine: 'retained_earnings',
    ownerCapitalBases: ['sole_trader', 'partnership'],
    ageing: { receivable: AGE_AU, payable: AGE_AU },
    termCite: TERM_CITE_AU,
    labels: {
      advancesFromCustomers: 'Customer deposits',
      advancesToSuppliers: 'Advances to suppliers',
      profitToDate: 'Profit for the year to date',
      profitLine: 'Retained earnings',
      openingCapital: 'Opening capital',
      netProfitToDate: 'Add: Net profit for the year to date',
      netLossToDate: 'Less: Net loss for the year to date',
      drawings: 'Less: Drawings',
      capitalAccount: "Owner's equity",
      openingStock: 'Opening inventory',
      closingStock: 'Closing inventory'
    }
  };
  /** the payment modes an Australian shop is offered, in order — every id is a key of CHART.paymentModes (tests/country-payments.test.js); no UPI here. A cheque posts when it clears, so it is not offered at the till. */
  const PAYMENTS = Object.freeze([
    Object.freeze({ id: 'cash', label: 'Cash' }),
    Object.freeze({ id: 'bank', label: 'Bank' }),
    Object.freeze({ id: 'card', label: 'Card' }),
    Object.freeze({ id: 'eft', label: 'EFT' })
  ]);
  /** the groups the core reads by KIND, and how a payment mode lands: the REAL account money comes into (EFT, BPAY, PayID and a cheque reach the bank; EFTPOS is a card settlement) */
  const CHART = {
    paymentModes: { cash: 'cash', bank: 'bank', eft: 'bank', bpay: 'bank', payid: 'bank', cheque: 'bank', card: 'card', eftpos: 'card' },
    kinds: {
      tax: 'gst_and_statutory',
      stock: 'inventory',
      cash: 'cash_on_hand',
      bank: 'bank_accounts',
      loans: ['non_current_liabilities', 'loans', 'bank_overdraft'],
      sales: 'sales',
      purchases: 'purchases',
      directIncome: 'sales',
      directExpense: 'cost_of_sales',
      indirectIncome: 'other_income',
      indirectExpense: 'operating_expenses'
    }
  };

  /** the words a refusal quotes (b6): AASB 102 Inventories — cost formulas (FIFO / weighted average, para 25); measured at the lower of cost and net realisable value (para 9) */
  const CITE = { inventoryFormula: 'AASB 102 para 25', lowerOfCostNrv: 'AASB 102 para 9' };
  /** the ledger an accrued expense is owed on: wages, salaries, superannuation and staff amenities (employee benefits) are wages payable; the rest are accrued expenses */
  function accrualPayableFor(a) {
    return a && a.line === 'employee_benefits' ? 'wages_payable' : 'accrued_expenses';
  }

  /* ⭐ BANK STATEMENTS (b7) — the amount prefixes and the whole words a narration uses; presets = a LAYOUT, not a bank (none named until its file is read), verify:true. NO tax row here: GST on a fee comes from the rule's tax code (learn), never from "it is a fee" (auditor to confirm).
   B5-01 (Fable review 5): PHRASES only. A bare FEE / INT / INTEREST / WDL / WITHDRAWAL named an account for "SMITH LEGAL PROFESSIONAL FEE", "INT TRANSFER FROM J SMITH" and "WITHDRAWAL ONLINE ... TFR SMITH PLUMBING"; bank-recon now tries a party before these words and never calls a word-rule proposal ready without the person's tick. */
  const BANK = {
    amountPrefixes: ['$', 'a$', 'aud'], minorUnit: 'cents',
    /* FIN-115 (14 Nov): the headers a bank prints (Westpac / St.George "Narrative", NAB "Transaction Details") and the two exports with NO header row (CommBank NetBank: date, signed amount, description, balance; ANZ: date, signed amount, description). The banks publish no column list (ANZ, Westpac, NAB and CommBank help pages read on 14 Nov name the export but not its columns), so every one is verify:true: CommBank's order is from a converter vendor's page (statement-converter.pages.dev, "date, amount, description, and running balance"; debits negative), ANZ's from the same shape, NAB's from the Transaction Details heading its export carries. A file that fits none is refused in words; one whose descriptions all read blank is warned. */
    presets: {
      narrative: { bank: 'Narrative layout', verify: true, note: 'Date · Narrative · Debit Amount · Credit Amount · Balance', map: { date: ['Date'], narration: ['Narrative'], debit: ['Debit Amount'], credit: ['Credit Amount'], balance: ['Balance'] } },
      westpac: { bank: 'Westpac / St.George', verify: true, note: 'Date · Narrative · Debit Amount · Credit Amount · Balance', map: { date: ['Date'], narration: ['Narrative'], debit: ['Debit Amount'], credit: ['Credit Amount'], balance: ['Balance'] } },
      nab: { bank: 'NAB', verify: true, note: 'Date · Amount · Transaction Details · Balance', map: { date: ['Date'], amount: ['Amount'], narration: ['Transaction Details'], balance: ['Balance'] } },
      cba: { bank: 'CommBank NetBank (no header row)', verify: true, note: 'Date · Amount (money out is negative) · Description · Balance', map: {}, headerless: { count: 4, map: { date: 0, amount: 1, narration: 2, balance: 3 } } },
      anz: { bank: 'ANZ (no header row)', verify: true, note: 'Date · Amount (money out is negative) · Description', map: {}, headerless: { count: 3, map: { date: 0, amount: 1, narration: 2 } } }
    },
    keywords: {
      default: {
        charges: ['ACCOUNT FEE', 'MERCHANT FEE', 'MONTHLY FEE', 'SERVICE FEE', 'BANK CHARGE'],
        interest: ['CREDIT INTEREST', 'INTEREST PAID'],
        atm: ['ATM', 'ATM WITHDRAWAL', 'CASH OUT'],
        cash_deposit: ['CASH DEPOSIT', 'DEPOSIT CASH', 'CASH DEP'],
        cheque_return: ['DISHONOUR', 'DISHONOURED', 'RETURNED', 'REVERSAL'],
        transfer: ['EFT', 'BPAY', 'OSKO', 'PAYID', 'DIRECT CREDIT', 'DIRECT DEBIT', 'TRANSFER', 'NPP'],
        own_transfer: ['TRANSFER TO SAVINGS', 'TRANSFER FROM SAVINGS', 'TO SAVINGS', 'FROM SAVINGS', 'OWN ACCOUNT', 'INTERNAL TRANSFER'],
        tax_office: ['ATO', 'BAS', 'TAX OFFICE', 'ACTIVITY STATEMENT'],
        card_settlement: ['CARD SETTLEMENT', 'EFTPOS', 'MERCHANT SETTLEMENT']
      }
    }
  };

  /** the fiscal year: 1 July to 30 June, written '2026-27' (the ATO writes "2026–27 income year") — ato.gov.au › Financial year */
  const FISCAL_YEAR = { startMonth: 7, label: 'split' };

  /**
   * ⭐ THE PACK — the regulation contract (regulation.js) in one object. The chart rows keep their top-level names (groups · ledgers · expense_classes ·
   * income_classes) because chart.js reads them there; `sch3` is the contract's NAME for the statement-line table — its content here is AASB 101's.
   */
  /** v1.45.0 (FX1) — FOREIGN CURRENCY: which rate the tax value of a foreign-currency supply uses (data; the rate itself is evidence the owner enters or imports) */
  const FX_AU = {
    standard: 'AASB 121: a foreign-currency transaction at the spot rate of its date; monetary items at the closing rate; differences to profit or loss',
    tax_rate_source: 'official',
    tax_rate_rule:
      'GST Act s 9-85 (GST Regulations r 9-85.01): an ATO-accepted rate — the RBA rate, or a published bank rate used consistently — at the time the GST is attributed',
    official_name: 'RBA or another ATO-accepted rate'
  };

  /**
   * ⭐ EXPORT RULES (ACC-188, P1-7) — what Australia's book pack says that is Australia's, in the shape bookpack's exportOf_ reads (reg-in.js EXPORT is the first):
   * the code book's columns (the statement line, the AASB group; SAF-T grouping = the account's nature, Australia has no SAF-T mandate so the OECD shape is a completeness list, as for India),
   * the tax lines of a SAF-T-shaped file (a GST line: the gst_collected ledger is output GST, gst_paid is input GST; ONE head, so the rate is the percentage as given, never halved) and the
   * ABN as the registration type. No tallyXml: an Australian practice does not import Tally XML, so bookpack leaves tally.xml out for this pack.
   */
  const GST_TAX_LINE_ROLES = { gst_collected: 'output', gst_paid: 'input' };
  const EXPORT = {
    codeBookColumns: ['code', 'role', 'name', 'group', 'group_name', 'nature', 'statement', 'line', 'line_label', 'saft_category', 'saft_code'],
    codeBookRow: function (a) {
      return {
        code: a.code,
        role: a.role || '',
        name: a.name,
        group: a.group,
        group_name: a.group_name,
        nature: a.nature,
        statement: a.statement,
        line: a.line,
        line_label: a.line_label,
        saft_category: String(a.nature || '').toUpperCase(),
        saft_code: a.line || a.group
      };
    },
    groupName: function (row) {
      return row.group_name;
    } /* the group name trial_balance.csv prints beside a code */,
    taxScheme: 'ABN',
    taxTable: { TaxType: 'GST', Description: 'Goods and Services Tax' },
    taxLine: function (a) {
      return GST_TAX_LINE_ROLES[a.role] ? { dir: GST_TAX_LINE_ROLES[a.role], code: 'GST' } : null;
    },
    taxPercentage: function (t, rate) {
      var n = Number(rate);
      return rate == null || rate === '' || !Number.isFinite(n) ? null : String(n);
    },
    taxCodeDescription: function (a) {
      return a.role === 'gst_paid' ? 'GST on purchases' : 'GST on sales';
    }
  };

  const PACK = {
    /* v1.65.0: the counter slip's titles in the shop's languages (first = the main line); the till reads them, never types a country's title */
    /* v1.65.0: coin rounding at the counter — the CASH tender rounds to step_minor; the difference posts as round-off */
    cashRounding: Object.freeze({
      'step_minor': 5,
      'tender': 'cash',
      'cite': 'cash totals round to the nearest 5c (RBA, since 1992); card and other tenders pay the exact total ⚠'
    }),
    slip: Object.freeze({
      'langs': ['en'],
      'titles': { 'tax': { 'en': 'Tax invoice' }, 'credit_note': { 'en': 'Adjustment note' }, 'held': { 'en': 'Bill — not a tax invoice' }, 'plain': { 'en': 'Receipt' } },
      'cite': 'GST Act s.29-70: the words "Tax invoice"; credit_note: GST Act Div 29-B ("adjustment note", s.29-75, ATO GSTR 2013/1); `held` (v1.73.0): a sale over A$1,000 saved without the buyer named (s.29-70(1)(c)(ii)) prints as a bill, not a tax invoice'
    }),
    id: 'AU',
    version: '1.0.0',
    name: 'Australia · GST',
    verified: false,
    country: 'AU',
    basis: 'AASB 101 statement lines · Division 40 ITAA 1997 · ATO BAS labels',
    currency: 'AUD',
    sch3: LINES_AU,
    groups: GROUPS_AU,
    ledgers: LEDGERS_AU,
    expense_classes: EXPENSE_CLASSES_AU,
    retired: [{ code: '5100', name: 'Wages (before 6015)', group: 'operating_expenses', line: 'employee_benefits' }],
    income_classes: INCOME_CLASSES_AU,
    asset_classes: ASSET_CLASSES_AU,
    entity_bases: ENTITY_BASES_AU,
    fiscalYear: FISCAL_YEAR,
    accountExtras: accountExtras,
    presentation: PRESENTATION,
    chart: CHART,
    payments: PAYMENTS /* v1.90.0: the tenders a shop here is offered, ids of chart.paymentModes (no UPI) */,
    depreciation: { assetClasses: ASSET_CLASSES_AU, entityBases: ENTITY_BASES_AU, compute: depreciationCompute },
    bank: BANK,
    cite: CITE,
    accrualPayableFor: accrualPayableFor,
    setOff: setOff,
    eventAliases: EVENT_ALIASES,
    messages: MESSAGES,
    taxHeads: TAX_HEADS,
    payHeads: TAX_HEADS,
    optionalHeads: [],
    taxLedgers: TAX_LEDGERS,
    voucherSeries: VOUCHER_SERIES_AU,
    manualSeries: MANUAL_SERIES_AU,
    voucherFormat: '{series}/{fy}/{n:6}',
    tax: TAX_AU,
    fx: FX_AU,
    /* v1.42.0 (CS2): the country's own locale (en-AU — 1,234,567.50 · 13/10/2026) and its IANA zones. Australia is MULTI-ZONE (three standard offsets, DST in the south-east only):
     the Country setup step ASKS which one, with the browser's zone preselected when it is one of these. Sydney first — the most populous, and the fallback when the browser's zone
     is not Australian. The list is the IANA canonical zones for AU (tzdata `zone1970.tab`): no aliases (Australia/Canberra, Australia/NSW …), so a stored value is always canonical. */
    locale: { format: 'en-AU', langs: ['en'], cur: ['AUD'] },
    timeZones: [
      'Australia/Sydney',
      'Australia/Melbourne',
      'Australia/Brisbane',
      'Australia/Perth',
      'Australia/Adelaide',
      'Australia/Darwin',
      'Australia/Hobart',
      'Australia/Broken_Hill',
      'Australia/Lindeman',
      'Australia/Eucla',
      'Australia/Lord_Howe'
    ],
    /* Australia's own rule functions (none is called by the core; the api / web read them by name) */
    /* A-F-14 (batch 1126): the ABN is a BUSINESS number, not a GST registration (a shop under A$75,000 has one and charges no GST); the api reads `registers`, never a literal word */
    taxId: {
      name: 'ABN',
      hint: 'ABN · 11 digits',
      registers: false,
      check: function (v) {
        var r = abnCheck(v);
        return { ok: r.ok, value: r.abn != null ? r.abn : null, why: r.ok ? null : r.why };
      }
    },
    abn: ABN,
    taxInvoice: taxInvoice,
    supplyKindOf: supplyKindOf,
    moveIn: MOVE_IN_MAP.moveIn(TAX_AU.supplyKinds) /* v1.38.0 (IM1): Xero / QBO account types, system accounts and tax codes → this chart */,
    export: EXPORT,
    /* v1.39.0 (BAS1): the return's own words — `short` is what a screen calls it, `authority` / `portal` where the shop lodges it (ChitBridge prepares, it does not lodge) */
    returns: {
      id: 'BAS',
      name: 'Business activity statement',
      short: 'BAS',
      authority: 'ATO',
      portal: 'ATO Online services for business',
      frequencies: ['quarterly', 'monthly'],
      labels: BAS_LABELS,
      g10_g11: G10_G11_ROWS,
      periods: basPeriods,
      bas: bas,
      /* Z-F-02: the host reads the GST paid on entries that also hold a capital-asset line and adds it as one movement row of this role (dr_minor); bas() splits 1B by it */
      capitalGst: { tax_role: 'gst_paid', roles: ASSET_CLASSES_AU.map(function (c) { return c.cost_role; }), memo_role: GST_ON_CAPITAL_ROLE },
      unknownKind: KIT.unknownKind({
        name: 'Sale at 0% with no GST kind',
        kinds: ['taxable', 'gst_free', 'input_taxed'],
        boxes: ['G3'],
        ask: 'Is this sale taxable, GST-free or input-taxed?',
        why: 'A sale at 0% that names no kind stays on Sales (4000), so BAS G3 does not count it. We never assume GST-free: it is a list in the law, not a default.',
        cite: 'GST Act 1999 Div 38 (GST-free), Div 40 (input-taxed); ato.gov.au › GST labels on your BAS'
      })
    },
    thresholds: {
      registration: TAX_AU.registration,
      monthly_from_minor: 2000000000,
      simpler_bas_below_minor: 1000000000,
      cite: 'GST Act 1999 s.23-15 (register at $75,000), s.27-15 (monthly tax periods from $20 million); ato.gov.au › Simpler BAS ($10 million)'
    },
    /* ⭐ W-AU-8 (dated pack data, Athi 11 Nov 2026): THE COMMONWEALTH PENALTY UNIT AS DATED DATA (Crimes Act 1914 s.4AA; the amount is set by instrument). `amount_minor` is cents; the row in
       force on a date is tax-packs.rowAsOf(pack.penalty_unit, date). A penalty stated in units (a BAS failure to lodge: 1 unit per 28 days or part, up to 5) is units × the row in force on
       the day it is imposed. Nothing computes a penalty here: this is the number the units are worth. 'unconfirmed': the amounts are the RULE-WATCH 8b audit's; the 2026 instrument's page
       was opened on legislation.gov.au (title, status in force, dated 16 June 2026) but its operative section and ato.gov.au (403) were not readable. */
    penalty_unit: Object.freeze([
      Object.freeze({
        from: '2024-11-07',
        to: '2026-06-30',
        amount_minor: 330 * 100,
        cite: 'Crimes Act 1914 s.4AA: a penalty unit is A$330 from 7 Nov 2024 (RULE-WATCH 8b, secondary; the instrument that set it was not opened)',
        source: Object.freeze({ title: 'RULE-WATCH 8b audit (11 Nov 2026), secondary; ato.gov.au returned 403', url: null, instrument: null, date: '2024-11-07', primary: false }),
        status: 'unconfirmed'
      }),
      Object.freeze({
        from: '2026-07-01',
        to: null,
        amount_minor: 364 * 100,
        cite: 'Crimes Act 1914 s.4AA as set by the Crimes (Amount of a Penalty Unit) Instrument 2026 (F2026N00424): A$364 from 1 Jul 2026',
        source: Object.freeze({
          title: 'Crimes (Amount of a Penalty Unit) Instrument 2026, Federal Register of Legislation (page opened: status In force, dated 16 June 2026; the section giving the amount and the commencement was not on the page read)',
          url: 'https://www.legislation.gov.au/F2026N00424/asmade/text',
          instrument: 'F2026N00424',
          date: '2026-06-16',
          primary: true
        }),
        status: 'unconfirmed'
      })
    ]),
    retentionYears: 5 /* TAA 1953 Sch 1 s.382-5: keep records for five years; ato.gov.au › How long to keep your records */,
    /* v1.48.0 (W2-BOOKS): the same number as a records table (the standard's `records` shape, as AE carries it) — five years from when the record was prepared or the transaction completed, whichever is later */
    records: {
      years: { standard: 5 },
      cite: 'TAA 1953 Sch 1 s.382-5 (five years, from the later of preparing the record and completing the transaction); ato.gov.au › Records you need to keep › How long to keep your records'
    },
    /* v1.41.0 (CPS1): what this pack LEAVES OUT and why, in its own words — read by tools/country-matrix.cjs (docs/COUNTRY-STANDARD.md A10); a key names a member of the standard */
    scope: {
      out: {
        'tax.rcm': 'Div 84 reverse charge on imported services is a later round (docs/design/core-vs-packs/AU1-FOLLOW-UP.md §3)',
        payroll: "PAYG withholding, superannuation guarantee and Single Touch Payroll are OUT OF SCOPE (this file's header) — named so they are not forgotten"
      },
      partial: {
        bank: "amount prefixes and keywords only; no bank's CSV preset until a real statement is read (AU1 follow-up §3)"
      }
    }
  };

  const EXPORTS = PACK;

  /* ⭐ ONE FILE, EVERY HOST: node takes module.exports; a page, the TV and the shop PC take window.CBRegAU. */
  if (typeof module !== 'undefined' && module.exports) module.exports = EXPORTS;
  if (root && typeof root.window !== 'undefined') root.window.CBRegAU = EXPORTS;
})(typeof globalThis !== 'undefined' ? globalThis : this);
