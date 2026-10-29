/* ADOPTED from chitbridge-engines v1.73.0 · reg-in · sha256 0d879ac50376fd4a4821aeb6b818b913203a20cd68425a10afc979238612818e — DO NOT EDIT HERE. Change it in chitbridge-engines, release a version, then run tools/adopt.cjs. */
/* chitbridge-engines · reg-in. Edited ONLY in chitbridge-engines/src/reg-in.js; every platform adopts a released version of it. */
(function (root) {
  'use strict';
  /* R1 (v1.51.0): the shared country helpers — src/pack-kit.js, loaded before this pack; a change there re-runs every country's golden */
  var KIT = (root && root.CBPackKit) || (typeof require === 'function' ? require('./pack-kit') : null);
  var refuse_ = KIT.refuse;
  // @stage tested
  // @stage-note [BOOKS · REGULATION PACK] India: the chart of accounts, Schedule III lines, the GST tax pack and, as the core-vs-packs steps land,
  // @stage-note every rule that is Indian law and not accounting principle. DATA first; the rule functions arrive one area at a time (b1-b7).
  /**
   * reg-in.js — THE INDIA REGULATION PACK (core-vs-packs step a2, v1.21.0, 2026-10-03).
   *
   * Athi, 2026-10-03: *"principle should be segregated from governance, say context of the country, we will implement for two countries and
   * ensure that switch is possible"* — and: *"segregate what is pure accounting and what are pure regulations … same package for another
   * country."* docs/design/core-vs-packs/PLAN.md. The accounting CORE (posting, ledger, period, receivables …) holds double entry and the
   * mechanisms; everything that is the law of ONE country lives in a pack like this one, handed to the core as an object (ctx.pack).
   *
   * ⭐ AS-IS: this file is accounts-packs.js (the chart, Schedule III, depreciation tables) and tax-packs.js (the GST pack) MOVED — the same
   * literals, the same freezing, cut and pasted. The India answers do not change; tests/in-snapshot.test.js proves it against
   * tests/fixtures/in-v1.20.0.json. accounts-packs.PACKS.IN and tax-packs.PACKS.IN are these very objects.
   *
   * The shape a pack must have is written and checked in regulation.js (CBRegulation.validate).
   *
   * ── ZERO DEPENDENCIES · DATA (and, from b1, small rule functions) ───────────────────────────────────────────
   */

  /* ── Schedule III (Division I) lines, as keys — statement 'bs' | 'pl' — and the label a CA reads ── */
  const SCH3 = {
    ppe: { st: 'bs', side: 'assets', label: 'Property, plant and equipment' },
    investments: { st: 'bs', side: 'assets', label: 'Investments' },
    inventories: { st: 'bs', side: 'assets', label: 'Inventories' },
    trade_receivables: { st: 'bs', side: 'assets', label: 'Trade receivables' },
    cash_equivalents: { st: 'bs', side: 'assets', label: 'Cash and cash equivalents' },
    short_term_loans_advances: { st: 'bs', side: 'assets', label: 'Short-term loans and advances' },
    other_current_assets: { st: 'bs', side: 'assets', label: 'Other current assets' },
    share_capital: { st: 'bs', side: 'equity', label: "Share capital / Owners' funds" },
    reserves_surplus: { st: 'bs', side: 'equity', label: 'Reserves and surplus' },
    borrowings: { st: 'bs', side: 'liabilities', label: 'Borrowings' },
    trade_payables: { st: 'bs', side: 'liabilities', label: 'Trade payables' },
    other_current_liabilities: { st: 'bs', side: 'liabilities', label: 'Other current liabilities' },
    short_term_provisions: { st: 'bs', side: 'liabilities', label: 'Short-term provisions' },
    suspense: { st: 'bs', side: 'liabilities', label: 'Suspense (must be nil at close)' },
    branch: { st: 'bs', side: 'liabilities', label: 'Branch / divisions (eliminated)' },
    revenue_operations: { st: 'pl', side: 'income', label: 'Revenue from operations' },
    other_income: { st: 'pl', side: 'income', label: 'Other income' },
    purchases_stock: { st: 'pl', side: 'expense', label: 'Purchases of stock-in-trade' },
    cost_materials: { st: 'pl', side: 'expense', label: 'Cost of materials consumed' },
    changes_inventories: { st: 'pl', side: 'expense', label: 'Changes in inventories of finished goods, work-in-progress and stock-in-trade' },
    employee_benefits: { st: 'pl', side: 'expense', label: 'Employee benefits expense' },
    finance_costs: { st: 'pl', side: 'expense', label: 'Finance costs' },
    depreciation: { st: 'pl', side: 'expense', label: 'Depreciation and amortization expense' },
    other_expenses: { st: 'pl', side: 'expense', label: 'Other expenses' }
  };

  const GROUPS_IN = [
    /* ── the 15 primary groups ── */
    { code: 'capital', name: 'Capital Account', type: 'personal', nature: 'equity', side: 'cr', parent: null, range: [3000, 3199], sch3: 'share_capital' },
    {
      code: 'current_assets',
      name: 'Current Assets',
      type: 'real',
      nature: 'asset',
      side: 'dr',
      parent: null,
      range: [1800, 1899],
      sch3: 'other_current_assets'
    },
    {
      code: 'current_liabilities',
      name: 'Current Liabilities',
      type: 'personal',
      nature: 'liability',
      side: 'cr',
      parent: null,
      range: [2400, 2899],
      sch3: 'other_current_liabilities'
    },
    { code: 'fixed_assets', name: 'Fixed Assets', type: 'real', nature: 'asset', side: 'dr', parent: null, range: [1000, 1099], sch3: 'ppe' },
    { code: 'investments', name: 'Investments', type: 'real', nature: 'asset', side: 'dr', parent: null, range: [1100, 1199], sch3: 'investments' },
    {
      code: 'loans_liability',
      name: 'Loans (Liability)',
      type: 'personal',
      nature: 'liability',
      side: 'cr',
      parent: null,
      range: [2030, 2099],
      sch3: 'borrowings'
    },
    {
      code: 'misc_expenses_asset',
      name: 'Misc. Expenses (ASSET)',
      type: 'nominal',
      nature: 'asset',
      side: 'dr',
      parent: null,
      range: [1900, 1999],
      sch3: 'other_current_assets'
    },
    { code: 'suspense', name: 'Suspense A/c', type: 'personal', nature: 'liability', side: 'cr', parent: null, range: [2900, 2999], sch3: 'suspense' },
    {
      code: 'branch_divisions',
      name: 'Branch / Divisions',
      type: 'personal',
      nature: 'liability',
      side: 'cr',
      parent: null,
      range: [9000, 9999],
      sch3: 'branch'
    },
    {
      code: 'direct_expenses',
      name: 'Direct Expenses',
      type: 'nominal',
      nature: 'expense',
      side: 'dr',
      parent: null,
      range: [5100, 5999],
      sch3: 'cost_materials'
    },
    {
      code: 'direct_incomes',
      name: 'Direct Incomes',
      type: 'nominal',
      nature: 'income',
      side: 'cr',
      parent: null,
      range: [4100, 4199],
      sch3: 'revenue_operations'
    },
    {
      code: 'indirect_expenses',
      name: 'Indirect Expenses',
      type: 'nominal',
      nature: 'expense',
      side: 'dr',
      parent: null,
      range: [6000, 6999],
      sch3: 'other_expenses'
    },
    {
      code: 'indirect_incomes',
      name: 'Indirect Incomes',
      type: 'nominal',
      nature: 'income',
      side: 'cr',
      parent: null,
      range: [4200, 4999],
      sch3: 'other_income'
    },
    {
      code: 'purchase_accounts',
      name: 'Purchase Accounts',
      type: 'nominal',
      nature: 'expense',
      side: 'dr',
      parent: null,
      range: [5000, 5099],
      sch3: 'purchases_stock'
    },
    {
      code: 'sales_accounts',
      name: 'Sales Accounts',
      type: 'nominal',
      nature: 'income',
      side: 'cr',
      parent: null,
      range: [4000, 4099],
      sch3: 'revenue_operations'
    },
    /* ── the 13 sub-groups ── */
    {
      code: 'bank_accounts',
      name: 'Bank Accounts',
      type: 'real',
      nature: 'asset',
      side: 'dr',
      parent: 'current_assets',
      range: [1500, 1599],
      sch3: 'cash_equivalents'
    },
    {
      code: 'bank_od',
      name: 'Bank OD A/c',
      type: 'personal',
      nature: 'liability',
      side: 'cr',
      parent: 'loans_liability',
      range: [2020, 2029],
      sch3: 'borrowings'
    },
    {
      code: 'cash_in_hand',
      name: 'Cash-in-Hand',
      type: 'real',
      nature: 'asset',
      side: 'dr',
      parent: 'current_assets',
      range: [1400, 1499],
      sch3: 'cash_equivalents'
    },
    {
      code: 'deposits_asset',
      name: 'Deposits (Asset)',
      type: 'real',
      nature: 'asset',
      side: 'dr',
      parent: 'current_assets',
      range: [1600, 1699],
      sch3: 'short_term_loans_advances'
    },
    {
      code: 'duties_taxes',
      name: 'Duties & Taxes',
      type: 'personal',
      nature: 'liability',
      side: 'cr',
      parent: 'current_liabilities',
      range: [2200, 2299],
      sch3: 'other_current_liabilities'
    },
    {
      code: 'loans_advances_asset',
      name: 'Loans & Advances (Asset)',
      type: 'personal',
      nature: 'asset',
      side: 'dr',
      parent: 'current_assets',
      range: [1700, 1799],
      sch3: 'short_term_loans_advances'
    },
    {
      code: 'provisions',
      name: 'Provisions',
      type: 'personal',
      nature: 'liability',
      side: 'cr',
      parent: 'current_liabilities',
      range: [2300, 2399],
      sch3: 'short_term_provisions'
    },
    {
      code: 'reserves_surplus',
      name: 'Reserves & Surplus',
      type: 'personal',
      nature: 'equity',
      side: 'cr',
      parent: 'capital',
      range: [3200, 3999],
      sch3: 'reserves_surplus'
    },
    {
      code: 'secured_loans',
      name: 'Secured Loans',
      type: 'personal',
      nature: 'liability',
      side: 'cr',
      parent: 'loans_liability',
      range: [2000, 2009],
      sch3: 'borrowings'
    },
    {
      code: 'stock_in_hand',
      name: 'Stock-in-Hand',
      type: 'real',
      nature: 'asset',
      side: 'dr',
      parent: 'current_assets',
      range: [1200, 1299],
      sch3: 'inventories'
    },
    {
      code: 'sundry_creditors',
      name: 'Sundry Creditors',
      type: 'personal',
      nature: 'liability',
      side: 'cr',
      parent: 'current_liabilities',
      range: [2100, 2199],
      sch3: 'trade_payables'
    },
    {
      code: 'sundry_debtors',
      name: 'Sundry Debtors',
      type: 'personal',
      nature: 'asset',
      side: 'dr',
      parent: 'current_assets',
      range: [1300, 1399],
      sch3: 'trade_receivables'
    },
    {
      code: 'unsecured_loans',
      name: 'Unsecured Loans',
      type: 'personal',
      nature: 'liability',
      side: 'cr',
      parent: 'loans_liability',
      range: [2010, 2019],
      sch3: 'borrowings'
    }
  ];

  /**
   * ⭐ THE LEDGERS THE POSTING RULES NAME (by role). A shop may add its own (a second bank, a named expense) — these are the
   * ones every shop starts with, so a rule can always find its account. Parties are NOT listed: a customer is a line on
   * `debtors` carrying the party's id (a sub-ledger — SAP reconciliation account, ERPNext party_type/party, Odoo partner_id),
   * a supplier a line on `creditors`, exactly as Tally's bill-wise party ledgers sit under Sundry Debtors / Creditors.
   */
  const LEDGERS_IN = [
    { role: 'stock', code: '1200', name: 'Stock-in-hand', group: 'stock_in_hand' },
    { role: 'ppe_buildings', code: '1010', name: 'Buildings', group: 'fixed_assets' },
    { role: 'accdep_buildings', code: '1011', name: 'Accumulated depreciation — buildings', group: 'fixed_assets' },
    { role: 'ppe_plant', code: '1020', name: 'Plant and machinery', group: 'fixed_assets' },
    { role: 'accdep_plant', code: '1021', name: 'Accumulated depreciation — plant and machinery', group: 'fixed_assets' },
    { role: 'ppe_furniture', code: '1030', name: 'Furniture and fittings', group: 'fixed_assets' },
    { role: 'accdep_furniture', code: '1031', name: 'Accumulated depreciation — furniture and fittings', group: 'fixed_assets' },
    { role: 'ppe_vehicles', code: '1040', name: 'Vehicles', group: 'fixed_assets' },
    { role: 'accdep_vehicles', code: '1041', name: 'Accumulated depreciation — vehicles', group: 'fixed_assets' },
    { role: 'ppe_office', code: '1050', name: 'Office equipment', group: 'fixed_assets' },
    { role: 'accdep_office', code: '1051', name: 'Accumulated depreciation — office equipment', group: 'fixed_assets' },
    { role: 'ppe_computers', code: '1060', name: 'Computers', group: 'fixed_assets' },
    { role: 'accdep_computers', code: '1061', name: 'Accumulated depreciation — computers', group: 'fixed_assets' },
    { role: 'debtors', code: '1300', name: 'Customers (Sundry Debtors)', group: 'sundry_debtors' },
    { role: 'cash', code: '1400', name: 'Cash', group: 'cash_in_hand' },
    { role: 'bank', code: '1500', name: 'Bank', group: 'bank_accounts' },
    { role: 'upi', code: '1510', name: 'UPI collections', group: 'bank_accounts' },
    { role: 'card', code: '1520', name: 'Card settlements', group: 'bank_accounts' },
    { role: 'prepaid_expenses', code: '1810', name: 'Prepaid expenses', group: 'current_assets' },
    { role: 'accrued_income', code: '1820', name: 'Income accrued but not received', group: 'current_assets' },
    { role: 'supplier_advance', code: '1700', name: 'Advances to suppliers', group: 'loans_advances_asset' },
    { role: 'creditors', code: '2100', name: 'Suppliers (Sundry Creditors)', group: 'sundry_creditors' },
    { role: 'secured_loan', code: '2000', name: 'Secured loans (term loans)', group: 'secured_loans' },
    { role: 'unsecured_loan', code: '2010', name: 'Unsecured loans', group: 'unsecured_loans' },
    { role: 'bank_od', code: '2020', name: 'Bank overdraft / cash credit', group: 'bank_od' },
    { role: 'output_cgst', code: '2200', name: 'Output CGST', group: 'duties_taxes' },
    { role: 'output_sgst', code: '2201', name: 'Output SGST', group: 'duties_taxes' },
    { role: 'output_igst', code: '2202', name: 'Output IGST', group: 'duties_taxes' },
    { role: 'input_cgst', code: '2210', name: 'Input CGST', group: 'duties_taxes' },
    { role: 'input_sgst', code: '2211', name: 'Input SGST', group: 'duties_taxes' },
    { role: 'input_igst', code: '2212', name: 'Input IGST', group: 'duties_taxes' },
    /* v1.16.0 — GST Compensation Cess Act 2017: its own pair, beside the three heads (cess credit pays ONLY cess, s.11(2)). Under Duties & Taxes, so Schedule III reads them like the GST heads. */
    { role: 'output_cess', code: '2203', name: 'Output Cess', group: 'duties_taxes' },
    { role: 'input_cess', code: '2213', name: 'Input Cess', group: 'duties_taxes' },
    /* v1.20.0 — REVERSE CHARGE: the tax the BUYER owes on a notified supply (s.9(3) / 9(4)), its own ledger per head so it can never be set off against input credit (s.49(4), Rule 86(2)): paid in cash by the challan (gst_payment's `rcm`). */
    { role: 'rcm_cgst', code: '2204', name: 'RCM payable — CGST', group: 'duties_taxes' },
    { role: 'rcm_sgst', code: '2205', name: 'RCM payable — SGST', group: 'duties_taxes' },
    { role: 'rcm_igst', code: '2206', name: 'RCM payable — IGST', group: 'duties_taxes' },
    { role: 'tds_payable', code: '2220', name: 'TDS payable', group: 'duties_taxes' },
    { role: 'customer_advance', code: '2400', name: 'Advances from customers', group: 'current_liabilities' },
    { role: 'outstanding_expenses', code: '2410', name: 'Outstanding expenses', group: 'current_liabilities' },
    { role: 'salary_payable', code: '2420', name: 'Salary and wages payable', group: 'current_liabilities' },
    { role: 'income_in_advance', code: '2430', name: 'Income received in advance', group: 'current_liabilities' },
    { role: 'suspense', code: '2900', name: 'Suspense', group: 'suspense' },
    { role: 'capital', code: '3000', name: 'Capital', group: 'capital' },
    { role: 'drawings', code: '3100', name: 'Drawings', group: 'capital' },
    { role: 'retained', code: '3900', name: 'Profit and loss (retained)', group: 'reserves_surplus' },
    { role: 'sales', code: '4000', name: 'Sales', group: 'sales_accounts' },
    { role: 'sales_returns', code: '4090', name: 'Sales returns', group: 'sales_accounts' },
    { role: 'interest_received', code: '4200', name: 'Interest received', group: 'indirect_incomes' },
    { role: 'gain_on_disposal', code: '4250', name: 'Profit on sale of fixed assets', group: 'indirect_incomes' },
    {
      role: 'fx_gain_loss',
      code: '4260',
      name: 'Exchange gain or loss',
      group: 'indirect_incomes'
    } /* v1.45.0 (FX1): Ind AS 21 ¶28/¶23 — realised and unrealised, one ledger; its balance may be either side */,
    { role: 'purchases', code: '5000', name: 'Purchases', group: 'purchase_accounts' },
    { role: 'purchase_returns', code: '5090', name: 'Purchase returns', group: 'purchase_accounts' },
    { role: 'changes_in_inventories', code: '5050', name: 'Changes in inventories of stock-in-trade', group: 'purchase_accounts', sch3: 'changes_inventories' },
    { role: 'discount_allowed', code: '6800', name: 'Discount allowed', group: 'indirect_expenses' },
    { role: 'bad_debts', code: '6850', name: 'Bad debts written off', group: 'indirect_expenses' },
    { role: 'depreciation', code: '6200', name: 'Depreciation', group: 'indirect_expenses', sch3: 'depreciation' },
    { role: 'loss_on_disposal', code: '6210', name: 'Loss on sale of fixed assets', group: 'indirect_expenses' },
    { role: 'round_off', code: '6900', name: 'Round off', group: 'indirect_expenses' }
  ];

  /** ⭐ what a shop pays for that is not stock — the drawer's "expense" chit carries one of these (SPEC-books §6) */
  const EXPENSE_CLASSES_IN = [
    { role: 'wages', code: '5100', name: 'Wages', group: 'direct_expenses', sch3: 'employee_benefits' },
    { role: 'freight_inward', code: '5110', name: 'Freight and cartage inward', group: 'direct_expenses' },
    { role: 'packing', code: '5120', name: 'Packing materials', group: 'direct_expenses' },
    { role: 'rent', code: '6010', name: 'Rent', group: 'indirect_expenses' },
    { role: 'salary', code: '6020', name: 'Salaries', group: 'indirect_expenses', sch3: 'employee_benefits' },
    { role: 'electricity', code: '6030', name: 'Electricity and water', group: 'indirect_expenses' },
    { role: 'telephone', code: '6040', name: 'Telephone and internet', group: 'indirect_expenses' },
    { role: 'transport', code: '6050', name: 'Transport and delivery', group: 'indirect_expenses' },
    { role: 'repairs', code: '6060', name: 'Repairs and maintenance', group: 'indirect_expenses' },
    { role: 'stationery', code: '6070', name: 'Printing and stationery', group: 'indirect_expenses' },
    { role: 'fuel', code: '6080', name: 'Fuel', group: 'indirect_expenses' },
    { role: 'interest_paid', code: '6150', name: 'Interest on loans', group: 'indirect_expenses', sch3: 'finance_costs' },
    { role: 'bank_charges', code: '6090', name: 'Bank charges', group: 'indirect_expenses', sch3: 'finance_costs' },
    { role: 'commission_paid', code: '6100', name: 'Commission paid', group: 'indirect_expenses' },
    { role: 'advertising', code: '6110', name: 'Advertising', group: 'indirect_expenses' },
    { role: 'professional', code: '6120', name: 'Professional fees', group: 'indirect_expenses' },
    { role: 'staff_welfare', code: '6130', name: 'Staff welfare', group: 'indirect_expenses', sch3: 'employee_benefits' },
    /* v1.16.0 (year-journey gap 3): Insurance is a standard indirect expense in Tally's and Zoho's charts; 6140 is the free code between 6130 and 6150 in the group's own 6000-6999 range (nextCode finds 6000 first, which the group keeps for itself). Schedule III: Other expenses (the group's line). */
    { role: 'insurance', code: '6140', name: 'Insurance', group: 'indirect_expenses' },
    { role: 'sundry_expense', code: '6190', name: 'Sundry expenses', group: 'indirect_expenses' }
  ];

  /** ⭐ money that comes in and is not a sale — the `income` chit's classes (SPEC-books §6). interest_received IS the ledger 4200. */
  const INCOME_CLASSES_IN = [
    { role: 'interest_received', code: '4200', name: 'Interest received', group: 'indirect_incomes' },
    { role: 'commission_received', code: '4210', name: 'Commission received', group: 'indirect_incomes' },
    { role: 'rent_received', code: '4220', name: 'Rent received', group: 'indirect_incomes' },
    { role: 'discount_received', code: '4230', name: 'Discount received', group: 'indirect_incomes' },
    { role: 'scrap_sales', code: '4240', name: 'Scrap sales', group: 'indirect_incomes' },
    { role: 'sundry_income', code: '4290', name: 'Sundry income', group: 'indirect_incomes' }
  ];

  /**
   * ⭐ v1.14.0 (books-rules R2) — THE DEPRECIATION RATES, AS DATA. Per asset class: the ledger pair (cost, accumulated), the
   * Income-tax Act Appendix I block rate on WDV (`it_rate`, per cent) and the Companies Act Schedule II useful life
   * (`life`, years). Buildings are the non-residential / non-factory case (10% · 60 years); a shop with another kind adds
   * its own class. posting.depreciationFor reads these — no rate lives in a rule.
   */
  const ASSET_CLASSES_IN = [
    { class: 'buildings', cost_role: 'ppe_buildings', acc_role: 'accdep_buildings', it_rate: 10, life: 60 },
    { class: 'plant', cost_role: 'ppe_plant', acc_role: 'accdep_plant', it_rate: 15, life: 15 },
    { class: 'furniture', cost_role: 'ppe_furniture', acc_role: 'accdep_furniture', it_rate: 10, life: 10 },
    { class: 'vehicles', cost_role: 'ppe_vehicles', acc_role: 'accdep_vehicles', it_rate: 15, life: 8 },
    { class: 'office', cost_role: 'ppe_office', acc_role: 'accdep_office', it_rate: 15, life: 5 },
    { class: 'computers', cost_role: 'ppe_computers', acc_role: 'accdep_computers', it_rate: 40, life: 3 }
  ];
  /** the basis a depreciation follows, by entity type: a company → Schedule II; everyone else → Income-tax Act WDV */
  const ENTITY_BASES_IN = {
    company: { basis: 'schedule_ii', methods: ['slm', 'wdv'], residual_pct: 5, prorata: 'days' },
    proprietor: { basis: 'it_act_wdv' },
    partnership: { basis: 'it_act_wdv' },
    llp: { basis: 'it_act_wdv' },
    huf: { basis: 'it_act_wdv' },
    trust: { basis: 'it_act_wdv' }
  };

  /* ── the India tax pack (CGST/IGST Act, GSTN schemas): the object tax-packs.PACKS.IN is ── */
  const TAX_IN = Object.freeze({
    country: 'IN',
    scheme: 'GST',
    supply: 'state',
    /* `rates` is the menu as FIRST WRITTEN (in force to 21 Sep 2025). It stays byte-equal so every adopted reader keeps its answer;
       the dated truth is `rate_menu` below, read through tax-packs.menuAsOf(pack, asOf). */
    rates: Object.freeze([0, 0.25, 3, 5, 12, 18, 28]),
    /* ⭐ v1.72.0 (ACC-2 / W-IN-1, DECISIONS 2026-10-18 and 2026-10-24 "yes F5"): THE MENU IS DATED. A row is the rates a shop may TYPE between
       `from` and `to` (null = still in force), with the notification it comes from. A slab or bill dated in a row's window is checked against
       THAT row, never against today's — so an issued 12% bill of 2024 is never flagged, and a 40% slab of 2026 is not refused.
       ⚠️ A MENU, NOT A MAPPING: which rate a product attracts is per HSN and the merchant's (or their CA's). `only` names a rate the row
       keeps for a narrow class of goods. Status: every row after the first is "CA to confirm before ship" (ACC-2). */
    rate_menu: Object.freeze([
      Object.freeze({
        from: '2017-07-01',
        to: '2025-09-21',
        rates: Object.freeze([0, 0.25, 3, 5, 12, 18, 28]),
        cite: 'Notification 1/2017-Central Tax (Rate) dated 28-06-2017 (goods, Schedules I-VI) and 11/2017-Central Tax (Rate) dated 28-06-2017 (services), as amended to 21 Sep 2025',
        note: '1.5% (cut and polished diamonds, Notification 6/2022-Central Tax (Rate), from 18 Jul 2022) was never on this menu; CA to confirm before it is added here'
      }),
      Object.freeze({
        from: '2025-09-22',
        to: '2026-01-31',
        rates: Object.freeze([0, 0.25, 1.5, 3, 5, 18, 28, 40]),
        only: Object.freeze({ 28: 'Schedule VII (14% CGST): pan masala and tobacco products only, with compensation cess, until the cess ended on 31 Jan 2026' }),
        cite: 'Notification 9/2025-Central Tax (Rate) dated 17-09-2025, from 22 Sep 2025 (56th GST Council, 3 Sep 2025): Schedules I 2.5% · II 9% · III 20% · IV 1.5% · V 0.125% · VI 0.75% · VII 14% CGST, i.e. 5 · 18 · 40 · 3 · 0.25 · 1.5 · 28; services by Notification 15/2025-Central Tax (Rate) dated 17-09-2025',
        status: 'CA to confirm before ship'
      }),
      Object.freeze({
        from: '2026-02-01',
        to: null,
        rates: Object.freeze([0, 0.25, 1.5, 3, 5, 18, 40]),
        cite: 'Notification 19/2025-Central Tax (Rate) dated 31-12-2025, from 1 Feb 2026: Schedule VII goods (pan masala, tobacco) move to 40%, bidi to 18%; the GST compensation cess on them ends the same day (an additional excise duty and a health cess take its place, outside GST)',
        status: 'CA to confirm before ship'
      })
    ]),
    /* ⭐ v1.72.0 (F5 E1, DECISIONS 2026-10-24 "yes F5" (a)): SUGGESTED rates by SAC / HSN prefix, for a screen to OFFER with its citation. The shop
       taps "Use" or does not; nothing here is ever applied by itself, and tax-slab.resolve NEVER reads this list (tests/tax-slab-input.test.js
       proves it). Rows carry the same `codes` prefix shape as rcm.categories and are matched by the same tax-packs.byCode. Each row: id · codes ·
       rate · itc · name · note (the one short line that says when another rate applies) · from · cite · status. Only codes that can be cited
       exactly are here; the list grows by a CA's say-so, never by guesswork. */
    suggest: Object.freeze([
      Object.freeze({
        id: 'restaurant',
        codes: Object.freeze(['996331']),
        rate: 5,
        itc: false,
        name: 'Restaurant service (eating out, takeaway, delivery)',
        note: '18% with input tax credit only in "specified premises": a hotel whose room tariff was above Rs 7,500 a night in the previous year, or one that declared itself so',
        from: '2025-04-01',
        cite: 'Notification 11/2017-Central Tax (Rate) dated 28-06-2017, entry 7(ii) (5%, no ITC) and 7(vi) (18% with ITC at specified premises), as amended; "specified premises" by Notification 05/2025-Central Tax (Rate) dated 16-01-2025, from 1 Apr 2025; unchanged by 15/2025-Central Tax (Rate)',
        status: 'CA to confirm before ship'
      }),
      Object.freeze({
        id: 'hotel_room',
        codes: Object.freeze(['996311']),
        rate: 5,
        itc: false,
        name: 'Hotel accommodation, room tariff up to Rs 7,500 a night',
        note: '18% with input tax credit when the tariff is above Rs 7,500 a night',
        from: '2025-09-22',
        cite: 'Notification 11/2017-Central Tax (Rate) entry 7 (hotel accommodation), as amended by Notification 15/2025-Central Tax (Rate) dated 17-09-2025, from 22 Sep 2025: the 12% band (Rs 1,001 to 7,500) moved to 5% without ITC',
        status: 'CA to confirm before ship'
      }),
      Object.freeze({
        id: 'butter_ghee',
        codes: Object.freeze(['0405']),
        rate: 5,
        itc: true,
        name: 'Butter, ghee, dairy spreads',
        note: '12% before 22 Sep 2025',
        from: '2025-09-22',
        cite: 'Notification 9/2025-Central Tax (Rate) dated 17-09-2025, Schedule I (2.5% CGST), heading 0405, from 22 Sep 2025',
        status: 'CA to confirm before ship'
      })
    ]),
    /* ⭐ TO THE PAISA (Athi, 2026-10-02: "keep it up to paisa … one computation and one value"). The total is the sum
       of its declared components; a rupee-rounded figure, if ever shown, is displayed beside it — never posted. */
    invoice_round_to: 0.01,
    prices_include_tax: true /* v1.65.0: the shelf price convention — MRP includes all taxes (Legal Metrology) */,
    /* ⭐ REVERSE CHARGE AS DATA (v1.20.0). s.9(3) CGST Act: the Government notifies categories whose tax the RECIPIENT pays; s.9(4):
       the same where an UNREGISTERED supplier supplies a registered recipient. tax.determine reads this table; nothing in tax.js
       names a category. Each row: id · kind · section · name · codes (SAC / HSN prefixes, matched left to right) · rates (the legal
       rate options, with whether credit is allowed at that rate; a line that gives no rate takes the first) · always (true: the
       recipient pays whoever the supplier is; false: only when the supplier is unregistered) · supplier / recipient (who must be what)
       · notification (number and date) and serial. ⚠️ The serials and rates are as notified when written (2026-10); the notification
       is the authority — confirm against the Gazette before filing a return. Goods rows carry rate null: the line's own HSN rate stands. */
    rcm: Object.freeze({
      source:
        'CGST Act 2017 s.9(3), s.9(4); IGST Act 2017 s.5(3), s.5(4); Notification 13/2017-Central Tax (Rate) dated 28-06-2017 (services) and Notification 4/2017-Central Tax (Rate) dated 28-06-2017 (goods), each as amended; Rule 86(2) and s.49(4) for the cash-only payment',
      categories: Object.freeze([
        Object.freeze({
          id: 'gta',
          kind: 'service',
          section: '9(3)',
          name: 'Goods transport agency (GTA) service, goods by road',
          codes: Object.freeze(['9965', '9967']),
          rates: Object.freeze([
            Object.freeze({ rate: 5, itc: false, note: 'without input tax credit on goods and services used in the supply' }),
            Object.freeze({ rate: 18, itc: true, note: 'with credit; the GTA opts by declaration (from 22-09-2025; 12% before)' })
          ]),
          always: true,
          supplier: 'goods transport agency',
          recipient: 'a registered person, factory, society, co-operative society, body corporate, partnership firm or casual taxable person',
          notification: '13/2017-CT(Rate) dated 28-06-2017',
          serial: '1'
        }),
        Object.freeze({
          id: 'legal',
          kind: 'service',
          section: '9(3)',
          name: 'Legal services by an advocate or a firm of advocates',
          codes: Object.freeze(['9982']),
          rates: Object.freeze([Object.freeze({ rate: 18, itc: true })]),
          always: true,
          supplier: 'an individual advocate (including a senior advocate) or a firm of advocates',
          recipient: 'any business entity',
          notification: '13/2017-CT(Rate) dated 28-06-2017',
          serial: '2'
        }),
        Object.freeze({
          id: 'arbitral',
          kind: 'service',
          section: '9(3)',
          name: 'Services of an arbitral tribunal',
          codes: Object.freeze(['9982']),
          rates: Object.freeze([Object.freeze({ rate: 18, itc: true })]),
          always: true,
          supplier: 'an arbitral tribunal',
          recipient: 'any business entity',
          notification: '13/2017-CT(Rate) dated 28-06-2017',
          serial: '3'
        }),
        Object.freeze({
          id: 'sponsorship',
          kind: 'service',
          section: '9(3)',
          name: 'Sponsorship services',
          codes: Object.freeze(['9983', '998397']),
          rates: Object.freeze([Object.freeze({ rate: 18, itc: true })]),
          always: true,
          supplier: 'any person',
          recipient: 'a body corporate or a partnership firm',
          notification: '13/2017-CT(Rate) dated 28-06-2017',
          serial: '4'
        }),
        Object.freeze({
          id: 'govt_services',
          kind: 'service',
          section: '9(3)',
          name: 'Services by the Central or a State Government, Union territory or local authority to a business entity (the notified exceptions apart)',
          codes: Object.freeze(['9991']),
          rates: Object.freeze([Object.freeze({ rate: 18, itc: true })]),
          always: true,
          supplier: 'the Central Government, a State Government, a Union territory or a local authority',
          recipient: 'any business entity',
          notification: '13/2017-CT(Rate) dated 28-06-2017',
          serial: '5'
        }),
        Object.freeze({
          id: 'director',
          kind: 'service',
          section: '9(3)',
          name: 'Services by a director of a company or body corporate to that company or body corporate',
          codes: Object.freeze([]),
          rates: Object.freeze([Object.freeze({ rate: 18, itc: true })]),
          always: true,
          supplier: 'a director',
          recipient: 'the company or body corporate',
          notification: '13/2017-CT(Rate) dated 28-06-2017, as amended by 29/2018-CT(Rate)',
          serial: null
        }),
        Object.freeze({
          id: 'insurance_agent',
          kind: 'service',
          section: '9(3)',
          name: 'Services by an insurance agent to a person carrying on insurance business',
          codes: Object.freeze(['9971']),
          rates: Object.freeze([Object.freeze({ rate: 18, itc: true })]),
          always: true,
          supplier: 'an insurance agent',
          recipient: 'a person carrying on insurance business',
          notification: '13/2017-CT(Rate) dated 28-06-2017',
          serial: null
        }),
        Object.freeze({
          id: 'recovery_agent',
          kind: 'service',
          section: '9(3)',
          name: 'Services by a recovery agent to a bank, financial institution or non-banking financial company',
          codes: Object.freeze(['9971']),
          rates: Object.freeze([Object.freeze({ rate: 18, itc: true })]),
          always: true,
          supplier: 'a recovery agent',
          recipient: 'a bank, financial institution or NBFC',
          notification: '13/2017-CT(Rate) dated 28-06-2017',
          serial: null
        }),
        Object.freeze({
          id: 'security',
          kind: 'service',
          section: '9(3)',
          name: 'Security services (other than by a body corporate) to a registered person',
          codes: Object.freeze(['9985']),
          rates: Object.freeze([Object.freeze({ rate: 18, itc: true })]),
          always: true,
          supplier: 'any person other than a body corporate',
          recipient: 'a registered person',
          notification: '13/2017-CT(Rate) dated 28-06-2017, as amended by 29/2018-CT(Rate)',
          serial: null
        }),
        Object.freeze({
          id: 'rent_unregistered',
          kind: 'service',
          section: '9(4)',
          name: 'Renting of immovable property by an unregistered person to a registered person',
          codes: Object.freeze(['9972']),
          rates: Object.freeze([Object.freeze({ rate: 18, itc: true })]),
          always: false,
          supplier: 'an unregistered person',
          recipient: 'a registered person',
          notification: '13/2017-CT(Rate) dated 28-06-2017, as amended by 5/2022-CT(Rate) dated 13-07-2022',
          serial: null
        }),
        Object.freeze({
          id: 'cashew',
          kind: 'goods',
          section: '9(3)',
          name: 'Cashew nuts, not shelled or peeled, from an agriculturist',
          codes: Object.freeze(['0801']),
          rates: Object.freeze([Object.freeze({ rate: null, itc: true })]),
          always: true,
          supplier: 'an agriculturist',
          recipient: 'a registered person',
          notification: '4/2017-CT(Rate) dated 28-06-2017',
          serial: null
        }),
        Object.freeze({
          id: 'raw_cotton',
          kind: 'goods',
          section: '9(3)',
          name: 'Raw cotton from an agriculturist',
          codes: Object.freeze(['5201']),
          rates: Object.freeze([Object.freeze({ rate: null, itc: true })]),
          always: true,
          supplier: 'an agriculturist',
          recipient: 'a registered person',
          notification: '4/2017-CT(Rate) dated 28-06-2017',
          serial: null
        }),
        Object.freeze({
          id: 'tobacco_leaves',
          kind: 'goods',
          section: '9(3)',
          name: 'Tobacco leaves from an agriculturist',
          codes: Object.freeze(['2401']),
          rates: Object.freeze([Object.freeze({ rate: null, itc: true })]),
          always: true,
          supplier: 'an agriculturist',
          recipient: 'a registered person',
          notification: '4/2017-CT(Rate) dated 28-06-2017',
          serial: null
        }),
        Object.freeze({
          id: 'bidi_wrapper_leaves',
          kind: 'goods',
          section: '9(3)',
          name: 'Bidi wrapper leaves (tendu)',
          codes: Object.freeze(['1404']),
          rates: Object.freeze([Object.freeze({ rate: null, itc: true })]),
          always: true,
          supplier: 'any person',
          recipient: 'a registered person',
          notification: '4/2017-CT(Rate) dated 28-06-2017',
          serial: null
        }),
        Object.freeze({
          id: 'silk_yarn',
          kind: 'goods',
          section: '9(3)',
          name: 'Silk yarn made out of raw silk or silk worm cocoons, by a manufacturer of silk yarn',
          codes: Object.freeze(['5004', '5005', '5006']),
          rates: Object.freeze([Object.freeze({ rate: null, itc: true })]),
          always: true,
          supplier: 'a manufacturer of silk yarn',
          recipient: 'a registered person',
          notification: '4/2017-CT(Rate) dated 28-06-2017',
          serial: null
        })
      ])
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
        Object.freeze({ from: '2023-08-01', above_minor: 5e7 * 100, cite: 'Notification 10/2023-Central Tax (10 May 2023): above Rs 5 crore' })
      ]),
      /* who is outside it whatever the turnover: Notification 13/2020-Central Tax (21 Mar 2020) as amended — insurers, banks, NBFCs,
         GTAs, passenger transport, multiplex admission, SEZ units (other than SEZ developers), a government department / local
         authority. The caller says `exempt_class`; the engine does not guess a business's class. */
      exempt_note:
        'Notification 13/2020-Central Tax (as amended): insurer, bank / NBFC, GTA, passenger transport, multiplex admission, SEZ unit, government department / local authority',
      /* an invoice must be REPORTED to the IRP within this many days of its date, for this turnover — the IRP rejects an older one.
         ⚠️ an IRP / GSTN advisory (13 Dec 2024), not a notification; it said 30 days from 1 Apr 2025 for aggregate turnover Rs 10 crore and above. */
      reporting_window: Object.freeze([
        Object.freeze({
          from: '2025-04-01',
          at_least_minor: 10e7 * 100,
          days: 30,
          cite: 'GSTN advisory, 13 Dec 2024 (IRP): 30 days from the invoice date, turnover Rs 10 crore and above, from 1 Apr 2025'
        })
      ]),
      /* the document types an IRN is issued for, and the schema's own codes (INV-01 DocDtls.Typ) */
      doc_types: Object.freeze({ invoice: 'INV', credit_note: 'CRN', debit_note: 'DBN' }),
      /* SupTyp values that an e-invoice is issued for (INV-01 TranDtls.SupTyp). B2C is not among them. */
      sup_types: Object.freeze(['B2B', 'SEZWP', 'SEZWOP', 'EXPWP', 'EXPWOP', 'DEXP']),
      schema: 'GSTN e-invoice schema INV-01, version 1.1 (einvoice1.gst.gov.in, "e-Invoice Schema version 1.1")'
    }),
    /* HSN digits an invoice must carry, by the supplier's aggregate turnover of the PRECEDING financial year:
       up to Rs 5 crore: 4 digits · above Rs 5 crore: 6 digits — Notification 78/2020-Central Tax (15 Oct 2020), from 1 Apr 2021;
       and the schema accepts only 4, 6 or 8. */
    hsn_digits: Object.freeze([
      Object.freeze({ from: '2021-04-01', above_minor: 0, digits: 4, cite: 'Notification 78/2020-Central Tax (15 Oct 2020): 4 digits up to Rs 5 crore' }),
      Object.freeze({
        from: '2021-04-01',
        above_minor: 5e7 * 100,
        digits: 6,
        cite: 'Notification 78/2020-Central Tax (15 Oct 2020): 6 digits above Rs 5 crore'
      })
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
        inward_unregistered: Object.freeze({
          always: false,
          by: 'recipient',
          cite: 'r.138(3): inward supply from an unregistered person; the registered recipient generates it'
        }),
        job_work_inter_state: Object.freeze({
          always: true,
          by: 'principal',
          cite: 'r.138(1) proviso: goods sent by a principal to a job worker in another State, whatever the value'
        }),
        handicraft_inter_state: Object.freeze({
          always: true,
          by: 'consignor',
          cite: 'r.138(1) proviso: handicraft goods moved inter-State by a person exempt from registration, whatever the value'
        })
      }),
      /* r.138(10): validity — one day for each 200 km (20 km for an over-dimensional cargo), part of a day counts as a day */
      validity_km_per_day: 200,
      validity_km_per_day_odc: 20,
      max_distance_km: 4000,
      /* the portal's transport-mode codes and subtype / document codes (e-way bill JSON, offline bulk format and API v1.03) */
      modes: Object.freeze({ road: 1, rail: 2, air: 3, ship: 4 }),
      doc_types: Object.freeze({ invoice: 'INV', bill_of_supply: 'BIL', bill_of_entry: 'BOE', delivery_challan: 'CHL', credit_note: 'CNT', other: 'OTH' }),
      sub_supply_types: Object.freeze({ supply: 1, import: 2, export: 3, job_work: 4, own_use: 5, job_work_returns: 6, sales_return: 7, others: 8 }),
      schema: 'NIC e-way bill system, "Generate e-way bill by JSON" (bulk upload format 1.0.0621, the field names of API v1.03)'
    }),
    /* ⭐ v1.73.0 (invoice reader): WHAT THE DOCUMENT MUST BE, as data — read by taxInvoice() below (docs/COUNTRY-STANDARD.md `tax.taxInvoice`). */
    taxInvoice: Object.freeze({
      buyer_identity_from_minor: 5000000 /* Rs 50,000 of TAXABLE value: r.46(f) names an unregistered recipient (name, address, State) from here */,
      within_days: 30 /* services: r.47 (30 days from the supply); goods: at or before removal / delivery, s.31(1) */,
      composition_words: 'composition taxable person, not eligible to collect tax on supplies' /* r.5(1)(f): at the top of a composition dealer's bill of supply */,
      cite: 'CGST Act 2017 s.31(1)-(3), s.32(1); CGST Rules 2017 r.46(e) (GSTIN of a registered recipient), r.46(f) (name, address and State of an unregistered recipient where the taxable value is Rs 50,000 or more), r.46A (invoice-cum-bill of supply), r.47 (services: 30 days), r.49 (bill of supply), r.5(1)(f) (the composition words)'
    }),
    source:
      'CGST Act 2017 + IGST Act 2017 ss.7-8 (intra vs inter-state by place of supply); GSTN e-invoice schema INV-01; the rate menu as the engine has carried it since 2026-09-03'
  });

  /**
   * ⭐ VOUCHER_SERIES (v1.16.0; Athi, 2026-10-02: "Follow the standard") — Tally's voucher types and the prefix of each one's own number series.
   * 'MJ' is the single series for a person's OWN entry of any kind ("as long as we know that it is manual without too much of interpretation");
   * the entry keeps its voucher type beside it as a field.
   */
  const VOUCHER_SERIES_IN = { Sales: 'SV', Purchase: 'PV', Receipt: 'RV', Payment: 'PY', Contra: 'CV', 'Credit note': 'CN', 'Debit note': 'DN', Journal: 'JV' };
  const MANUAL_SERIES_IN = 'MJ';

  /**
   * ⭐ accountExtras(row, group, pack) → the fields of a chart account that are India's own: the Tally group's name, the Schedule III line the ledger lands on (the row's, else its
   * group's) with that line's label and statement ('bs' | 'pl'), and the SAF-T-shaped grouping. chart.accountOf adds these to the neutral fields — the same keys, the same values as ever.
   */
  function accountExtras(r, g, pack) {
    const p = pack || PACK,
      sch3 = r.sch3 || g.sch3;
    const line = p.sch3 && Object.prototype.hasOwnProperty.call(p.sch3, sch3) ? p.sch3[sch3] : null;
    return {
      tally_group: g.name,
      sch3: sch3,
      sch3_line: line ? line.label : null,
      statement: line ? line.st : null,
      saft: { category: g.nature.toUpperCase(), code: sch3 }
    };
  }

  /**
   * ⭐ THE TAX HEADS (b2). The heads, in the order their lines are written (that order keeps India's lines byte-identical), and the ledger each lands on for the
   * output tax a sale charges, the input tax a purchase pays and the reverse-charge tax the buyer owes (null: this head has no reverse-charge ledger).
   * `payHeads` are the heads a statutory payment may name; `optionalHeads` are the ones a summary shows only when they carry an amount.
   */
  const TAX_HEADS = ['cgst', 'sgst', 'igst', 'cess'];
  const TAX_LEDGERS = {
    cgst: { output: 'output_cgst', input: 'input_cgst', rcm: 'rcm_cgst' },
    sgst: { output: 'output_sgst', input: 'input_sgst', rcm: 'rcm_sgst' },
    igst: { output: 'output_igst', input: 'input_igst', rcm: 'rcm_igst' },
    cess: { output: 'output_cess', input: 'input_cess', rcm: null }
  };

  /**
   * ⭐ setOff({ output, input }, minor) → { utilised: [{ from, against, amount }], payable, carried } — THE ORDER OF SET-OFF, India's (b3). The balances are handed in as they came and
   * read by `minor` (the core's one amount reader), so the answer is in MINOR units. Moved verbatim from posting.gstSetOff_: CGST Act s.49A / s.49(5) — IGST credit first (→ IGST, CGST,
   * SGST); CGST credit → CGST, then IGST; SGST credit → SGST, then IGST; CGST and SGST never cross; and, v1.16.0, GST Compensation Cess Act s.11(2): cess credit pays ONLY cess, and
   * cess is paid ONLY by cess credit. Reverse-charge tax is never set off (s.49(4), Rule 86(2)): the core pays it in cash and never hands it here.
   */
  function setOff(o, minor) {
    var output = o.output,
      input = o.input;
    var out = {},
      inp = {};
    TAX_HEADS.forEach(function (item) {
      out[item] = minor((output || {})[item]);
      inp[item] = minor((input || {})[item]);
      if (out[item] < 0 || inp[item] < 0)
        throw refuse_('A GST balance is never negative here — pass the credit balance of output and the debit balance of input.');
    });
    var used = [];
    var use = function (from, against) {
      var a = Math.min(inp[from], out[against]);
      if (a > 0) {
        inp[from] -= a;
        out[against] -= a;
        used.push({ from: from, against: against, amount: a });
      }
    };
    use('igst', 'igst');
    use('igst', 'cgst');
    use('igst', 'sgst');
    use('cgst', 'cgst');
    use('cgst', 'igst');
    use('sgst', 'sgst');
    use('sgst', 'igst');
    use('cess', 'cess');
    return { utilised: used, payable: out, carried: inp };
  }
  /** a stored event keeps the type name it was posted under; the core's rule is the neutral one */
  const EVENT_ALIASES = { gst_setoff: 'tax_setoff', gst_payment: 'tax_payment' };
  /** the sentences a refusal says when it has to name this country's own terms */
  const MESSAGES = {
    nothingToSetOff: 'Nothing to set off: no input credit meets an output tax it may pay (s.49).',
    payHeadUnknown: 'A GST payment is per head — cgst, sgst, igst (and cess).',
    rcmHeadUnknown: 'Reverse-charge tax is paid per head — cgst, sgst, igst.',
    paymentEmpty: 'A GST payment needs a head with an amount (cgst, sgst, igst, cess).',
    rcmNotBuilt: { cess: 'Cess under reverse charge is not built — post it as a manual entry.' },
    /* v1.48.0 (W2-BOOKS): the words a statutory tax PAYMENT is recorded under — the reference the authority gave (India: the challan's CPIN, GST portal
     → PMT-06) and the narration the entry carries. ONE word per country, read by the platform's close & pay (never "challan" typed for another pack). */
    paymentRef: { label: 'Challan number', ask: 'Which challan? Give its number (the CPIN).', hint: 'The CPIN on the challan', narration: 'GST challan' },
    setOffNarration: 'GST set-off'
  };

  /** records — Companies Act 2013 s.128(5): books of account kept in good order for not less than EIGHT financial years immediately preceding; CGST Act 2017 s.36:
   *  accounts and records kept 72 months from the due date of the annual return for the year they belong to (longer while an appeal or investigation runs) */
  const RECORDS = {
    years: { standard: 8, gst_months: 72 },
    cite: "Companies Act 2013 s.128(5); CGST Act 2017 s.36 (72 months from the annual return's due date; s.36 proviso: a year after an appeal or investigation ends)"
  };

  /**
   * ⭐ depreciation.compute(rows, base, ctx) → { total, rate, per } for ONE asset class — India's law, moved verbatim from posting.depreciationFor (b4). `rows` are the assets of the class
   * ({ id, c (the class row), cost, wdv (opening written-down value), days (in use this year), added (bought this year), proceeds }), amounts in MINOR units; `base` the entity's basis; ctx { method, diy
   * (days in the year) }. Income-tax Act WDV (it_act_wdv): the block rate on the written-down value, an addition put to use under 180 days before the year end takes half the rate (s.32(1)(ii)
   * second proviso), sale proceeds come off the block, the older part first. Companies Act Schedule II (schedule_ii): the useful life, a 5% residual, straight-line or written-down, additions pro rata
   * by days. The class total is the block's for the Income-tax basis, the sum of the assets' for Schedule II; the core adds any rounding drift to the first asset.
   */
  function depreciationCompute(list, base, ctx) {
    var x = { method: ctx.method },
      diy = ctx.diy,
      c = list[0].c,
      total = 0,
      rate = 0,
      per = [];
    var half = function (r) {
      return r.added && r.days < 180;
    };
    if (base.basis === 'it_act_wdv') {
      var O = 0,
        F = 0,
        count = 0,
        S = 0;
      list.forEach(function (item) {
        if (!item.added) O += item.wdv;
        else if (half(item)) count += item.cost;
        else F += item.cost;
        S += item.proceeds;
      });
      var older = O + F,
        left = Math.max(0, older - S),
        halfLeft = Math.max(0, count - Math.max(0, S - older));
      total = Math.round((left * c.it_rate) / 100 + (halfLeft * c.it_rate) / 200);
      rate = !left && halfLeft ? c.it_rate / 2 : c.it_rate;
      per = list.map(function (item) {
        return Math.round(item.added ? (item.cost * c.it_rate) / (half(item) ? 200 : 100) : (item.wdv * c.it_rate) / 100);
      });
    } else {
      var life = c.life,
        res = (base.residual_pct || 0) / 100;
      rate = x.method === 'slm' ? Math.round(((1 - res) / life) * 10000) / 100 : Math.round((1 - Math.pow(res, 1 / life)) * 10000) / 100;
      per = list.map(function (item) {
        var cost = item.cost,
          ch;
        if (x.method === 'slm') {
          if (cost === null) throw refuse_('Schedule II straight-line needs the cost of asset ' + item.id + '.');
          ch = (((cost - cost * res) / life) * item.days) / diy;
          if (item.wdv !== null) ch = Math.min(ch, Math.max(0, item.wdv - cost * res));
        } else {
          ch = (item.wdv !== null ? item.wdv : (cost * item.days) / diy) * (1 - Math.pow(res, 1 / life));
        }
        return Math.round(Number(ch.toPrecision(15)));
      });
      total = per.reduce(function (sum, item) {
        return sum + item;
      }, 0);
    }
    return { total: total, rate: rate, per: per };
  }

  /**
   * ⭐ THE STATEMENTS' FORM (b5) — Schedule III Division I Part I and Ind AS 1 para 32, as the ledger presents them. `lines` is the Schedule III table (the same object as `sch3`), in statement
   * order; `lineOf / labelOf / placed` read and set the statement-line fields of a ledger record (they are India's: `sch3`, `sch3_line`); `taxNetting` names, per head, the output and input ledgers
   * that are netted (s.49 sets credit against output within a head; cess nets within its own head only, s.11(2)) and the roles and names the netted entry takes; a net debit goes to `creditLine`
   * (Other current assets — "Balances with government authorities"), a net credit stays under `payableLine`; `profitLine` takes the year's profit to date; `ownerCapitalBases` are the entity
   * bases whose capital is shown as one account (ICAI final accounts of a non-company); `ageing` is the Schedule III bucket table (Division I, as amended 24 Mar 2021), moved verbatim.
   */
  const GST_PAIRS = [
    ['output_cgst', 'input_cgst', 'cgst', 'CGST'],
    ['output_sgst', 'input_sgst', 'sgst', 'SGST'],
    ['output_igst', 'input_igst', 'igst', 'IGST'],
    ['output_cess', 'input_cess', 'cess', 'Cess']
  ];
  /** SCHEDULE III AGEING — trade receivables: not due · < 6 months · 6 months–1 year · 1–2 years · 2–3 years · > 3 years, each split undisputed / disputed; trade payables: not due · < 1 year · 1–2 · 2–3 · > 3 years. */
  const AGE_RECEIVABLE_IN = [
    ['not_due', null],
    ['lt_6m', [0, 6]],
    ['m6_1y', [6, 12]],
    ['y1_2', [12, 24]],
    ['y2_3', [24, 36]],
    ['gt_3y', [36, null]]
  ];
  const AGE_PAYABLE_IN = [
    ['not_due', null],
    ['lt_1y', [0, 12]],
    ['y1_2', [12, 24]],
    ['y2_3', [24, 36]],
    ['gt_3y', [36, null]]
  ];
  const PRESENTATION = {
    lines: SCH3,
    lineOf: function (a) {
      return a.sch3;
    },
    labelOf: function (a) {
      return a.sch3_line;
    },
    placed: function (a, key) {
      return Object.assign({}, a, { sch3: key });
    },
    taxNetting: GST_PAIRS.map(function (item) {
      return {
        output: item[0],
        input: item[1],
        creditRole: 'gst_credit_' + item[2],
        payableRole: 'gst_payable_' + item[2],
        creditName: 'Balances with government authorities — ' + item[3] + ' credit',
        payableName: 'GST payable — ' + item[3]
      };
    }),
    creditLine: 'other_current_assets',
    payableLine: 'other_current_liabilities',
    profitLine: 'reserves_surplus',
    ownerCapitalBases: ['proprietor', 'partnership'],
    ageing: { receivable: AGE_RECEIVABLE_IN, payable: AGE_PAYABLE_IN },
    labels: {
      advancesFromCustomers: 'Advances from customers',
      advancesToSuppliers: 'Advances to suppliers',
      profitToDate: 'Profit for the year to date',
      profitLine: 'Reserves and surplus',
      openingCapital: 'Opening capital',
      netProfitToDate: 'Add: Net profit for the year to date',
      netLossToDate: 'Less: Net loss for the year to date',
      drawings: 'Less: Drawings',
      capitalAccount: 'Capital account',
      openingStock: 'Opening stock',
      closingStock: 'Closing stock'
    }
  };
  /** the groups the core reads by KIND: Tally's group codes (loans, cash, bank are used by posting from b6) */
  const CHART = {
    paymentModes: {
      cash: 'cash',
      bank: 'bank',
      upi: 'upi',
      card: 'card',
      cheque: 'bank'
    } /* how a payment mode lands: the REAL account money comes into. A cheque posts only on clearing, into the bank (C3). */,
    kinds: {
      tax: 'duties_taxes',
      stock: 'stock_in_hand',
      cash: 'cash_in_hand',
      bank: 'bank_accounts',
      loans: ['loans_liability', 'secured_loans', 'unsecured_loans', 'bank_od'],
      sales: 'sales_accounts',
      purchases: 'purchase_accounts',
      directIncome: 'direct_incomes',
      directExpense: 'direct_expenses',
      indirectIncome: 'indirect_incomes',
      indirectExpense: 'indirect_expenses'
    }
  };

  /** the words a refusal quotes (b6): the standard behind a rule */
  const CITE = { inventoryFormula: 'AS 2 para 16', lowerOfCostNrv: 'AS 2 para 5' };
  /** the ledger an accrued expense is owed on: wages, salaries and staff welfare (Schedule III: employee benefits expense) are salary payable; the rest are outstanding expenses */
  function accrualPayableFor(a) {
    return a && a.sch3 === 'employee_benefits' ? 'salary_payable' : 'outstanding_expenses';
  }

  /**
   * ⭐ checks.msme(balances, asOf, opt, day) → the open debits older than they may be — ⚠️ FOR A CA TO CONFIRM (spec §12). MSMED Act s.15: a buyer pays a micro/small supplier within the agreed period, never
   * beyond 45 days; IT s.43B(h) disallows the buyer's deduction for dues paid late. Flags every open debit older than min(its credit days, 45) on asOf. Moved verbatim from receivables.msmeFlags (b7);
   * `day` is the core's date reader. Each option is off until the supplier turns it on (null).
   */
  function msmeCheck(bs, asOf, opt, day) {
    var o = opt || {};
    if (!o.on) return null;
    var cap = Number(o.days) > 0 ? Number(o.days) : 45,
      today = day(asOf);
    return ((bs && bs.debits) || [])
      .filter(function (item) {
        return item.balance > 0;
      })
      .map(function (item) {
        var agreed = Math.min(cap, Math.max(0, day(item.due) - day(item.date))),
          age = today - day(item.date);
        return { debit: item.id, party: item.party, age_days: age, limit_days: agreed, beyond: age > agreed };
      })
      .filter(function (item) {
        return item.beyond;
      });
  }

  /* ⭐ BANK STATEMENTS (b7) — India's banks: the header cells each prints (PRESETS, verify:true until checked against a real file) and the whole words a narration uses (RULES), moved verbatim from bank-recon. */
  const BANK_PRESETS = {
    sbi: {
      bank: 'State Bank of India',
      verify: true,
      note: 'Txn Date · Value Date · Description · Ref No./Cheque No. · Debit · Credit · Balance',
      map: {
        date: ['Txn Date'],
        value_date: ['Value Date'],
        narration: ['Description'],
        ref: ['Ref No./Cheque No.', 'Ref No'],
        debit: ['Debit'],
        credit: ['Credit'],
        balance: ['Balance']
      }
    },
    hdfc: {
      bank: 'HDFC Bank',
      verify: true,
      note: 'Date · Narration · Chq./Ref.No. · Value Dt · Withdrawal Amt. · Deposit Amt. · Closing Balance',
      map: {
        date: ['Date'],
        narration: ['Narration'],
        ref: ['Chq./Ref.No.', 'Chq/Ref No'],
        value_date: ['Value Dt'],
        debit: ['Withdrawal Amt.'],
        credit: ['Deposit Amt.'],
        balance: ['Closing Balance']
      }
    },
    icici: {
      bank: 'ICICI Bank',
      verify: true,
      note: 'S No. · Value Date · Transaction Date · Cheque Number · Transaction Remarks · Withdrawal Amount (INR ) · Deposit Amount (INR ) · Balance (INR )',
      map: {
        date: ['Transaction Date'],
        value_date: ['Value Date'],
        cheque_no: ['Cheque Number'],
        narration: ['Transaction Remarks'],
        debit: ['Withdrawal Amount (INR )'],
        credit: ['Deposit Amount (INR )'],
        balance: ['Balance (INR )']
      }
    },
    axis: {
      bank: 'Axis Bank',
      verify: true,
      note: 'SRL NO · Tran Date · CHQNO · PARTICULARS · DR · CR · BAL · SOL',
      map: { date: ['Tran Date'], cheque_no: ['CHQNO'], narration: ['PARTICULARS'], debit: ['DR'], credit: ['CR'], balance: ['BAL'] }
    },
    kotak: {
      bank: 'Kotak Mahindra Bank',
      verify: true,
      note: 'Sl. No. · Transaction Date · Value Date · Description · Chq / Ref No. · Debit · Credit · Dr / Cr · Balance (balance carries a Dr / Cr marker)',
      map: {
        date: ['Transaction Date'],
        value_date: ['Value Date'],
        narration: ['Description'],
        ref: ['Chq / Ref No.', 'Chq/Ref No'],
        debit: ['Debit'],
        credit: ['Credit'],
        balance: ['Balance']
      }
    }
  };
  const BANK_KEYWORDS = {
    default: {
      charges: [
        'CHRG',
        'CHRGS',
        'CHARGES',
        'CHARGE',
        'CHG',
        'CHGS',
        'SMS CHG',
        'GST ON CHG',
        'GST ON CHARGES',
        'SERVICE CHARGE',
        'AMC',
        'ANNUAL FEE',
        'DEBIT CARD FEE',
        'MIN BAL',
        'MAINTENANCE CHARGES'
      ],
      interest: ['INT', 'INTEREST', 'INTEREST CR', 'INT CR', 'INT.PD', 'INT PD', 'CREDIT INTEREST', 'SB INT', 'INT PAID'],
      atm: ['ATM', 'ATM WDL', 'CASH WDL', 'CASH WITHDRAWAL', 'NFS', 'ATM CASH', 'SELF WITHDRAWAL'],
      cash_deposit: ['CASH DEPOSIT', 'CASH DEP', 'CDM', 'BY CASH'],
      cheque_return: ['RTN', 'RETURN', 'RETURNED', 'CHQ RET', 'CHQ RTN', 'CHEQUE RETURN', 'INWARD RETURN', 'I/W RETURN', 'BOUNCE', 'DISHONOUR', 'DISHONOURED'],
      transfer: ['UPI', 'NEFT', 'IMPS', 'RTGS']
    },
    sbi: { charges: ['SMS ALERT CHARGES', 'ATM AMC'], interest: ['CREDIT INTEREST'] },
    hdfc: { charges: ['CHQ BOOK ISSUE', 'FUNDS TRANSFER CHARGES'], interest: ['INT.PD'] },
    icici: { charges: ['GST-', 'SMS CHARGES'], interest: ['INT.PD'] },
    axis: { charges: ['SERVICE CHRG'], interest: ['INT.PD'] },
    kotak: { charges: ['CHG'], interest: ['INTEREST CREDITED'] }
  };
  const BANK = { amountPrefixes: ['₹', 'rs.', 'rs', 'inr'], minorUnit: 'paise', presets: BANK_PRESETS, keywords: BANK_KEYWORDS };

  /**
   * ⭐ EXPORT RULES (b7) — what India's book pack says that is India's: the code book's columns (the Tally group, the Schedule III line, the SAF-T grouping), the tax lines of a SAF-T-shaped file (a GST line:
   * a ledger under Duties & Taxes whose role is output_/input_ + cgst|sgst|igst|cess; CGST and SGST are each HALF the bill's rate) and Tally's import XML (moved verbatim from bookpack.tallyXml;
   * ⚠️ 'not yet run against TallyPrime'). `kit` is what bookpack hands it: { c (the context), pos, codeBook(), billwise, dec, xml, day }.
   */
  const EXPORT = {
    codeBookColumns: ['code', 'role', 'name', 'group', 'tally_group', 'nature', 'statement', 'sch3', 'sch3_line', 'saft_category', 'saft_code'],
    codeBookRow: function (a) {
      return {
        code: a.code,
        role: a.role || '',
        name: a.name,
        group: a.group,
        tally_group: a.tally_group,
        nature: a.nature,
        statement: a.statement,
        sch3: a.sch3,
        sch3_line: a.sch3_line,
        saft_category: a.saft.category,
        saft_code: a.saft.code
      };
    },
    groupName: function (row) {
      return row.tally_group;
    } /* the group name trial_balance.csv prints beside a code */,
    taxScheme: 'GSTIN',
    taxTable: { TaxType: 'GST', Description: 'Goods and Services Tax' },
    taxLine: function (a) {
      var m = /^(output|input)_(cgst|sgst|igst|cess)$/.exec(a.role || '');
      return m && a.group === 'duties_taxes' ? { dir: m[1], code: m[2].toUpperCase() } : null;
    },
    taxPercentage: function (t, rate) {
      var n = Number(rate);
      return t.code === 'CESS' ? null : rate == null || rate === '' || !Number.isFinite(n) ? null : String(t.code === 'IGST' ? n : n / 2);
    },
    taxCodeDescription: function (a) {
      return a.name.replace(/^(Output|Input)\s+/, '');
    },
    tallyXml: function (kit) {
      var c = kit.c,
        pos = kit.pos,
        dp = c.dp,
        P = c.P,
        codeBook = kit.codeBook,
        billwise_ = kit.billwise,
        dec = kit.dec,
        xml_ = kit.xml,
        day_ = kit.day;
      var deb = P.accountOf(c.pack, 'debtors').code,
        cre = P.accountOf(c.pack, 'creditors').code;
      /* Tally: a DEBIT is a negative amount with ISDEEMEDPOSITIVE Yes */
      var amt = function (netDr) {
        return dec(-netDr, dp);
      };
      var partyName = function (id) {
        var p = c.parties[String(id)];
        return p ? p.name + ' (' + (p.party_no || id) + ')' : String(id);
      }; /* an unknown party's ledger is its id — the same name its master gets below */
      var ledgerName = function (a, party) {
        return party && (a.code === deb || a.code === cre) ? partyName(party) : a.name;
      };
      var masters = [];
      codeBook().forEach(function (item) {
        if (item.code === deb || item.code === cre) return;
        var o = (pos.open.accounts[item.code] || { net_minor: 0 }).net_minor;
        masters.push(
          '<TALLYMESSAGE><LEDGER NAME="' +
            xml_(item.name) +
            '" ACTION="Create"><NAME.LIST><NAME>' +
            xml_(item.name) +
            '</NAME><NAME>' +
            xml_(item.code) +
            '</NAME></NAME.LIST>' +
            '<PARENT>' +
            xml_(item.tally_group) +
            '</PARENT><OPENINGBALANCE>' +
            amt(o) +
            '</OPENINGBALANCE></LEDGER></TALLYMESSAGE>'
        );
      });
      Object.keys(c.parties)
        .sort()
        .forEach(function (item) {
          var p = c.parties[item],
            code = p.side === 'supplier' ? cre : deb,
            a = P.accountOf(c.pack, code);
          var o = ((pos.open.parties[code] || {})[item] || { net_minor: 0 }).net_minor,
            gst = (p.tax_ids || []).find(function (entry) {
              return entry.scheme === 'GSTIN';
            });
          masters.push(
            '<TALLYMESSAGE><LEDGER NAME="' +
              xml_(partyName(item)) +
              '" ACTION="Create"><NAME.LIST><NAME>' +
              xml_(partyName(item)) +
              '</NAME></NAME.LIST>' +
              '<PARENT>' +
              xml_(a.tally_group) +
              '</PARENT><ISBILLWISEON>Yes</ISBILLWISEON>' +
              (gst ? '<PARTYGSTIN>' + xml_(gst.value) + '</PARTYGSTIN>' : '') +
              (p.state_code ? '<LEDSTATENAME>' + xml_(p.state_code) + '</LEDSTATENAME>' : '') +
              '<OPENINGBALANCE>' +
              amt(o) +
              '</OPENINGBALANCE></LEDGER></TALLYMESSAGE>'
          );
        });
      /* M7a: no ghost ledgers — a party a voucher names but `parties` does not list still gets its master, under its control account's group */
      c.unknown.forEach(function (item) {
        var code = item.side === 'supplier' ? cre : deb,
          a = P.accountOf(c.pack, code),
          o = ((pos.open.parties[code] || {})[item.party_id] || { net_minor: 0 }).net_minor;
        masters.push(
          '<TALLYMESSAGE><LEDGER NAME="' +
            xml_(partyName(item.party_id)) +
            '" ACTION="Create"><NAME.LIST><NAME>' +
            xml_(partyName(item.party_id)) +
            '</NAME></NAME.LIST>' +
            '<PARENT>' +
            xml_(a.tally_group) +
            '</PARENT><ISBILLWISEON>Yes</ISBILLWISEON><OPENINGBALANCE>' +
            amt(o) +
            '</OPENINGBALANCE></LEDGER></TALLYMESSAGE>'
        );
      });
      var byEntry = Object.create(null),
        order = [];
      c.moves.forEach(function (item) {
        var k = item.jv_no || item.entry_id;
        if (!byEntry[k]) {
          byEntry[k] = [];
          order.push(k);
        }
        byEntry[k].push(item);
      });
      order.sort(function (first, second) {
        var a = byEntry[first][0],
          b = byEntry[second][0];
        return day_(a.date) - day_(b.date) || String(first).localeCompare(String(second));
      });
      var vouchers = order.map(function (item) {
        var list = byEntry[item],
          h = list[0];
        return (
          '<TALLYMESSAGE><VOUCHER VCHTYPE="Journal" ACTION="Create"><DATE>' +
          h.date.replace(/-/g, '') +
          '</DATE><VOUCHERTYPENAME>Journal</VOUCHERTYPENAME>' +
          '<VOUCHERNUMBER>' +
          xml_(item) +
          '</VOUCHERNUMBER>' +
          (h.narration ? '<NARRATION>' + xml_(h.narration) + '</NARRATION>' : '') +
          list
            .map(function (entry) {
              var a = c.acct(entry),
                net = Number(entry.dr_minor || 0) - Number(entry.cr_minor || 0);
              var bills = entry.party && (a.code === deb || a.code === cre) ? billwise_(c, entry, net) : [];
              return (
                '<ALLLEDGERENTRIES.LIST><LEDGERNAME>' +
                xml_(ledgerName(a, entry.party)) +
                '</LEDGERNAME><ISDEEMEDPOSITIVE>' +
                (net > 0 ? 'Yes' : 'No') +
                '</ISDEEMEDPOSITIVE>' +
                '<AMOUNT>' +
                amt(net) +
                '</AMOUNT>' +
                bills
                  .map(function (element) {
                    return (
                      '<BILLALLOCATIONS.LIST><NAME>' +
                      xml_(element.name) +
                      '</NAME><BILLTYPE>' +
                      element.type +
                      '</BILLTYPE><AMOUNT>' +
                      amt(element.minor) +
                      '</AMOUNT></BILLALLOCATIONS.LIST>'
                    );
                  })
                  .join('') +
                '</ALLLEDGERENTRIES.LIST>'
              );
            })
            .join('') +
          '</VOUCHER></TALLYMESSAGE>'
        );
      });
      var e = c.x.entity || {};
      return (
        '<?xml version="1.0" encoding="UTF-8"?>\r\n<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA>' +
        '<REQUESTDESC><REPORTNAME>All Masters</REPORTNAME><STATICVARIABLES><SVCURRENTCOMPANY>' +
        xml_(e.name || '') +
        '</SVCURRENTCOMPANY></STATICVARIABLES></REQUESTDESC>' +
        '<REQUESTDATA>\r\n' +
        masters.concat(vouchers).join('\r\n') +
        '\r\n</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>\r\n'
      );
    }
  };

  /** the fiscal year: April to March, written '2026-27' */
  const FISCAL_YEAR = { startMonth: 4, label: 'split' };

  /**
   * v1.45.0 (FX1) — FOREIGN CURRENCY: the rate the TAX value of a foreign-currency supply uses, and the accounting standard the books follow. A rate is evidence the
   * owner enters or imports (source + date on every entry that used it) — the pack names WHICH rate the law wants, never a number.
   */
  const FX_IN = {
    standard:
      'Ind AS 21 / AS 11: a foreign-currency transaction at the spot rate of its date; monetary items at the closing rate; differences to profit or loss',
    tax_rate_source: 'official',
    tax_rate_rule:
      'CGST Rules r.34: goods at the rate notified by CBIC under s.14 Customs Act on the time of supply; services at the RBI reference rate (GAAP)',
    official_name: 'CBIC customs exchange rate notification'
  };

  /**
   * ⭐ THE PACK. The first block is the shape accounts-packs.PACKS.IN has always had (the chart rows keep their top-level names because
   * withAccounts and every caller read them there); the rest is the regulation contract (regulation.js). One object, one source.
   */
  /**
   * ⭐ taxInvoice(total_minor, { buyer_registered, seller_reg, taxable_minor, taxable_lines, exempt_lines }) → what the document for this supply must be,
   * read from TAX_IN.taxInvoice (CGST Act s.31 · s.32; CGST Rules r.46 · r.46A · r.47 · r.49 · r.5(1)(f)):
   *   { required, kind: 'tax' | 'combined' | 'supply' | null, buyer_tax_id, buyer_identity, buyer_needs[], buyer_why, must[], why, cite, status? }
   *   kind 'tax'       a registered regular seller, a taxable supply — r.46
   *        'combined'  the same seller, taxable AND exempted lines on ONE document to an UNREGISTERED person: "invoice-cum-bill of supply" — r.46A
   *        'supply'    every line exempted (r.49), or a composition seller (s.31(3)(c); the words of r.5(1)(f) go at the top)
   *        null        an unregistered seller issues no tax invoice and collects no tax — s.32(1): a plain bill
   *   buyer_tax_id     the recipient's GSTIN goes on it — r.46(e), a registered recipient
   *   buyer_identity   the recipient's name, address and State go on it — r.46(f), an unregistered recipient, taxable value Rs 50,000 or more
   * ⚠️ r.46A names an UNREGISTERED recipient only. Taxable and exempt lines to a REGISTERED recipient answer 'tax' and SAY the exempt lines ride on it,
   *    status 'CA to confirm' — one document or two is the CA's call, never decided here.
   */
  function taxInvoice(totalMinor, opt) {
    var t = TAX_IN.taxInvoice,
      o = opt || {};
    var reg = String(o.seller_reg || 'regular')
      .trim()
      .toLowerCase();
    var base = { required: true, kind: 'tax', buyer_tax_id: false, buyer_identity: false, buyer_needs: [], buyer_why: null, must: [], why: null, cite: t.cite };
    if (reg === 'composition')
      return Object.assign(base, {
        required: false,
        kind: 'supply',
        must: [t.composition_words],
        why: 'Composition dealer: a bill of supply, never a tax invoice; no tax is collected (s.31(3)(c), s.10(4); r.49) — the words "' + t.composition_words + '" go at the top (r.5(1)(f)).'
      });
    if (reg === 'unregistered')
      return Object.assign(base, { required: false, kind: null, why: 'A person who is not registered issues no tax invoice and collects no tax (s.32(1)).' });
    var taxable = Number(o.taxable_lines) || 0,
      exempt = Number(o.exempt_lines) || 0,
      registered = !!o.buyer_registered;
    if (!taxable && exempt) return Object.assign(base, { required: false, kind: 'supply', why: 'Every line is an exempted supply: a bill of supply (r.49).' });
    if (!registered && taxable && exempt)
      return Object.assign(
        base,
        { kind: 'combined', why: 'Taxable and exempted lines to an unregistered person on one document: an invoice-cum-bill of supply (r.46A).' },
        buyerRule_(t, o, registered)
      );
    var out = Object.assign(base, buyerRule_(t, o, registered));
    if (registered && exempt) {
      out.why = 'Exempted lines ride on this tax invoice to a registered recipient; r.46A covers an unregistered recipient only — one document or two is for the CA to say.';
      out.status = 'CA to confirm';
    }
    return out;
  }
  /** who the paper must name: a registered recipient's GSTIN (r.46(e)); an unregistered one's name, address and State from Rs 50,000 taxable (r.46(f)) */
  function buyerRule_(t, o, registered) {
    if (registered) return { buyer_tax_id: true, buyer_needs: ['tax_id'], buyer_why: "The recipient's GSTIN goes on a tax invoice to a registered person (r.46(e))." };
    var over = (Number(o.taxable_minor) || 0) >= t.buyer_identity_from_minor;
    if (!over) return { buyer_needs: [], buyer_why: null };
    return {
      buyer_identity: true,
      buyer_needs: ['name', 'address', 'state'],
      buyer_why: 'From Rs 50,000 of taxable value a tax invoice to an unregistered person names the recipient, their address and State (r.46(f)).'
    };
  }

  const PACK = {
    /* v1.65.0: the counter slip's titles in the shop's languages (first = the main line); the till reads them, never types a country's title
       v1.73.0: `combined` (r.46A) and `held` (a bill saved while it could not be a tax invoice: no rate on a line, the shop's details at odds, the buyer
       not named — the words the counter printed since M41, now the pack's) */
    slip: Object.freeze({
      'langs': ['en'],
      'titles': {
        'tax': { 'en': 'Tax invoice' },
        'supply': { 'en': 'Bill of supply' },
        'combined': { 'en': 'Invoice-cum-bill of supply' },
        'held': { 'en': 'Bill — not a tax invoice' },
        'plain': { 'en': 'Cash memo' }
      },
      'cite': 'CGST Rules 46 (tax invoice) · 46A (invoice-cum-bill of supply) · 49 (bill of supply)'
    }),
    id: 'IN',
    version: '1.0.0',
    name: 'India · GST',
    verified: true,
    country: 'IN',
    basis: "Tally's 28 predefined groups · Schedule III Division I",
    currency: 'INR',
    fy_start_month: FISCAL_YEAR.startMonth,
    sch3: SCH3,
    groups: GROUPS_IN,
    ledgers: LEDGERS_IN,
    expense_classes: EXPENSE_CLASSES_IN,
    income_classes: INCOME_CLASSES_IN,
    asset_classes: ASSET_CLASSES_IN,
    entity_bases: ENTITY_BASES_IN,
    fiscalYear: FISCAL_YEAR,
    accountExtras: accountExtras,
    presentation: PRESENTATION,
    chart: CHART,
    depreciation: { assetClasses: ASSET_CLASSES_IN, entityBases: ENTITY_BASES_IN, compute: depreciationCompute },
    checks: { msme: msmeCheck },
    bank: BANK,
    export: EXPORT,
    cite: CITE,
    accrualPayableFor: accrualPayableFor,
    setOff: setOff,
    taxInvoice: taxInvoice /* v1.73.0: what the document must be (r.46 · 46A · 49) — read by invoice.build */,
    eventAliases: EVENT_ALIASES,
    messages: MESSAGES,
    taxHeads: TAX_HEADS,
    payHeads: TAX_HEADS,
    optionalHeads: ['cess'],
    taxLedgers: TAX_LEDGERS,
    rcmSettlement:
      'cash' /* v1.48.1: reverse-charge tax is paid in CASH, never set off against credit (s.49(4), Rule 86(2)) — the core's `rcm` option is this rule */,
    voucherSeries: VOUCHER_SERIES_IN,
    manualSeries: MANUAL_SERIES_IN,
    voucherFormat: '{series}/{fy}/{n:6}',
    tax: TAX_IN,
    fx: FX_IN,
    /* v1.48.0 (W2-BOOKS): how long the law keeps the books — read by the platform's book packs (delete_after) and screens; was a typed 8 in the api */
    records: RECORDS,
    retentionYears: 8 /* Companies Act 2013 s.128(5): eight financial years */,
    /* v1.42.0 (CS2): the country's own locale (BCP 47 format tag, the languages offered, the usual currency — the row CBLocale.REGIONS.IN carried) and its IANA zones (one: the
     Country setup step sets identities.timezone from it without asking; a multi-zone country asks). docs/COUNTRY-STANDARD.md A1 `locale`, A3 `timeZones`. */
    locale: { format: 'en-IN', langs: ['en', 'hi', 'ta', 'te', 'bn', 'mr', 'gu', 'kn', 'ml', 'pa'], cur: ['INR'] },
    timeZones: ['Asia/Kolkata'],
    /* v1.68.0 (move-in W1.11, DECISIONS 2026-10-18:83): no `moveIn` map yet, but the lanes that carry NO tax (contacts · items without a tax field) may move in;
     every lane with a tax code stays refused until the IN map exists. Read through country.moveInFor().noTax; the api decides which lanes carry no tax. */
    moveInNoTax: true,
    /* v1.41.0 (CPS1): what this pack LEAVES OUT and why, in its own words — read by tools/country-matrix.cjs (docs/COUNTRY-STANDARD.md A10); a key names a member of the standard */
    scope: {
      out: {
        'tax.standard_rate': 'GST is slab-rated — the rate menu IS the law; there is no one standard rate (the sample cart bills at the highest slab)',
        'tax.supplyKinds': "a line's rate comes from its HSN slab (the tax-slab engine), not from a supply kind named on the line",
        supplyKindOf: 'the same: the slab decides, by HSN code (tax-slab.resolve)',
        payroll: 'no payroll engine exists yet; PF · ESI · TDS on salary are named here so they are not forgotten'
      },
      partial: {}
    }
  };

  const EXPORTS = PACK;

  /* ⭐ ONE FILE, EVERY HOST: node takes module.exports; a page, the TV and the shop PC take window.CBRegIN. */
  if (typeof module !== 'undefined' && module.exports) module.exports = EXPORTS;
  if (root && typeof root.window !== 'undefined') root.window.CBRegIN = EXPORTS;
})(typeof globalThis !== 'undefined' ? globalThis : this);
