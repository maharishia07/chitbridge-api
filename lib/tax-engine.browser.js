/* ADOPTED BUNDLE from chitbridge-engines · reg-in v1.48.1 + reg-au v1.48.1 + reg-ae v1.48.1 + regulation v1.48.1 + tax-packs v1.37.0 + tax-slab v1.2.0 + tax v1.49.0 — DO NOT EDIT HERE. Each part below is a release, unchanged. */
/* ADOPTED from chitbridge-engines v1.48.1 · reg-in · sha256 2e02f5085f6fd1ad926f49e3315d35f3e476f656b045a0cd659e62808e840bb8 — DO NOT EDIT HERE. Change it in chitbridge-engines, release a version, then run tools/adopt.cjs. */
/* chitbridge-engines · reg-in. Edited ONLY in chitbridge-engines/src/reg-in.js; every platform adopts a released version of it. */
(function (root) {
'use strict';
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
  ppe:                       { st: 'bs', side: 'assets',      label: 'Property, plant and equipment' },
  investments:               { st: 'bs', side: 'assets',      label: 'Investments' },
  inventories:               { st: 'bs', side: 'assets',      label: 'Inventories' },
  trade_receivables:         { st: 'bs', side: 'assets',      label: 'Trade receivables' },
  cash_equivalents:          { st: 'bs', side: 'assets',      label: 'Cash and cash equivalents' },
  short_term_loans_advances: { st: 'bs', side: 'assets',      label: 'Short-term loans and advances' },
  other_current_assets:      { st: 'bs', side: 'assets',      label: 'Other current assets' },
  share_capital:             { st: 'bs', side: 'equity',      label: "Share capital / Owners' funds" },
  reserves_surplus:          { st: 'bs', side: 'equity',      label: 'Reserves and surplus' },
  borrowings:                { st: 'bs', side: 'liabilities', label: 'Borrowings' },
  trade_payables:            { st: 'bs', side: 'liabilities', label: 'Trade payables' },
  other_current_liabilities: { st: 'bs', side: 'liabilities', label: 'Other current liabilities' },
  short_term_provisions:     { st: 'bs', side: 'liabilities', label: 'Short-term provisions' },
  suspense:                  { st: 'bs', side: 'liabilities', label: 'Suspense (must be nil at close)' },
  branch:                    { st: 'bs', side: 'liabilities', label: 'Branch / divisions (eliminated)' },
  revenue_operations:        { st: 'pl', side: 'income',      label: 'Revenue from operations' },
  other_income:              { st: 'pl', side: 'income',      label: 'Other income' },
  purchases_stock:           { st: 'pl', side: 'expense',     label: 'Purchases of stock-in-trade' },
  cost_materials:            { st: 'pl', side: 'expense',     label: 'Cost of materials consumed' },
  changes_inventories:       { st: 'pl', side: 'expense',     label: 'Changes in inventories of finished goods, work-in-progress and stock-in-trade' },
  employee_benefits:         { st: 'pl', side: 'expense',     label: 'Employee benefits expense' },
  finance_costs:             { st: 'pl', side: 'expense',     label: 'Finance costs' },
  depreciation:              { st: 'pl', side: 'expense',     label: 'Depreciation and amortization expense' },
  other_expenses:            { st: 'pl', side: 'expense',     label: 'Other expenses' },
};

const GROUPS_IN = [
  /* ── the 15 primary groups ── */
  { code: 'capital',              name: 'Capital Account',           type: 'personal', nature: 'equity',    side: 'cr', parent: null,                  range: [3000, 3199], sch3: 'share_capital' },
  { code: 'current_assets',       name: 'Current Assets',            type: 'real',     nature: 'asset',     side: 'dr', parent: null,                  range: [1800, 1899], sch3: 'other_current_assets' },
  { code: 'current_liabilities',  name: 'Current Liabilities',       type: 'personal', nature: 'liability', side: 'cr', parent: null,                  range: [2400, 2899], sch3: 'other_current_liabilities' },
  { code: 'fixed_assets',         name: 'Fixed Assets',              type: 'real',     nature: 'asset',     side: 'dr', parent: null,                  range: [1000, 1099], sch3: 'ppe' },
  { code: 'investments',          name: 'Investments',               type: 'real',     nature: 'asset',     side: 'dr', parent: null,                  range: [1100, 1199], sch3: 'investments' },
  { code: 'loans_liability',      name: 'Loans (Liability)',         type: 'personal', nature: 'liability', side: 'cr', parent: null,                  range: [2030, 2099], sch3: 'borrowings' },
  { code: 'misc_expenses_asset',  name: 'Misc. Expenses (ASSET)',    type: 'nominal',  nature: 'asset',     side: 'dr', parent: null,                  range: [1900, 1999], sch3: 'other_current_assets' },
  { code: 'suspense',             name: 'Suspense A/c',              type: 'personal', nature: 'liability', side: 'cr', parent: null,                  range: [2900, 2999], sch3: 'suspense' },
  { code: 'branch_divisions',     name: 'Branch / Divisions',        type: 'personal', nature: 'liability', side: 'cr', parent: null,                  range: [9000, 9999], sch3: 'branch' },
  { code: 'direct_expenses',      name: 'Direct Expenses',           type: 'nominal',  nature: 'expense',   side: 'dr', parent: null,                  range: [5100, 5999], sch3: 'cost_materials' },
  { code: 'direct_incomes',       name: 'Direct Incomes',            type: 'nominal',  nature: 'income',    side: 'cr', parent: null,                  range: [4100, 4199], sch3: 'revenue_operations' },
  { code: 'indirect_expenses',    name: 'Indirect Expenses',         type: 'nominal',  nature: 'expense',   side: 'dr', parent: null,                  range: [6000, 6999], sch3: 'other_expenses' },
  { code: 'indirect_incomes',     name: 'Indirect Incomes',          type: 'nominal',  nature: 'income',    side: 'cr', parent: null,                  range: [4200, 4999], sch3: 'other_income' },
  { code: 'purchase_accounts',    name: 'Purchase Accounts',         type: 'nominal',  nature: 'expense',   side: 'dr', parent: null,                  range: [5000, 5099], sch3: 'purchases_stock' },
  { code: 'sales_accounts',       name: 'Sales Accounts',            type: 'nominal',  nature: 'income',    side: 'cr', parent: null,                  range: [4000, 4099], sch3: 'revenue_operations' },
  /* ── the 13 sub-groups ── */
  { code: 'bank_accounts',        name: 'Bank Accounts',             type: 'real',     nature: 'asset',     side: 'dr', parent: 'current_assets',      range: [1500, 1599], sch3: 'cash_equivalents' },
  { code: 'bank_od',              name: 'Bank OD A/c',               type: 'personal', nature: 'liability', side: 'cr', parent: 'loans_liability',     range: [2020, 2029], sch3: 'borrowings' },
  { code: 'cash_in_hand',         name: 'Cash-in-Hand',              type: 'real',     nature: 'asset',     side: 'dr', parent: 'current_assets',      range: [1400, 1499], sch3: 'cash_equivalents' },
  { code: 'deposits_asset',       name: 'Deposits (Asset)',          type: 'real',     nature: 'asset',     side: 'dr', parent: 'current_assets',      range: [1600, 1699], sch3: 'short_term_loans_advances' },
  { code: 'duties_taxes',         name: 'Duties & Taxes',            type: 'personal', nature: 'liability', side: 'cr', parent: 'current_liabilities', range: [2200, 2299], sch3: 'other_current_liabilities' },
  { code: 'loans_advances_asset', name: 'Loans & Advances (Asset)',  type: 'personal', nature: 'asset',     side: 'dr', parent: 'current_assets',      range: [1700, 1799], sch3: 'short_term_loans_advances' },
  { code: 'provisions',           name: 'Provisions',                type: 'personal', nature: 'liability', side: 'cr', parent: 'current_liabilities', range: [2300, 2399], sch3: 'short_term_provisions' },
  { code: 'reserves_surplus',     name: 'Reserves & Surplus',        type: 'personal', nature: 'equity',    side: 'cr', parent: 'capital',             range: [3200, 3999], sch3: 'reserves_surplus' },
  { code: 'secured_loans',        name: 'Secured Loans',             type: 'personal', nature: 'liability', side: 'cr', parent: 'loans_liability',     range: [2000, 2009], sch3: 'borrowings' },
  { code: 'stock_in_hand',        name: 'Stock-in-Hand',             type: 'real',     nature: 'asset',     side: 'dr', parent: 'current_assets',      range: [1200, 1299], sch3: 'inventories' },
  { code: 'sundry_creditors',     name: 'Sundry Creditors',          type: 'personal', nature: 'liability', side: 'cr', parent: 'current_liabilities', range: [2100, 2199], sch3: 'trade_payables' },
  { code: 'sundry_debtors',       name: 'Sundry Debtors',            type: 'personal', nature: 'asset',     side: 'dr', parent: 'current_assets',      range: [1300, 1399], sch3: 'trade_receivables' },
  { code: 'unsecured_loans',      name: 'Unsecured Loans',           type: 'personal', nature: 'liability', side: 'cr', parent: 'loans_liability',     range: [2010, 2019], sch3: 'borrowings' },
];

/**
 * ⭐ THE LEDGERS THE POSTING RULES NAME (by role). A shop may add its own (a second bank, a named expense) — these are the
 * ones every shop starts with, so a rule can always find its account. Parties are NOT listed: a customer is a line on
 * `debtors` carrying the party's id (a sub-ledger — SAP reconciliation account, ERPNext party_type/party, Odoo partner_id),
 * a supplier a line on `creditors`, exactly as Tally's bill-wise party ledgers sit under Sundry Debtors / Creditors.
 */
const LEDGERS_IN = [
  { role: 'stock',             code: '1200', name: 'Stock-in-hand',                group: 'stock_in_hand' },
  { role: 'ppe_buildings',             code: '1010', name: 'Buildings',                                         group: 'fixed_assets' },
  { role: 'accdep_buildings',          code: '1011', name: 'Accumulated depreciation — buildings',              group: 'fixed_assets' },
  { role: 'ppe_plant',                 code: '1020', name: 'Plant and machinery',                               group: 'fixed_assets' },
  { role: 'accdep_plant',              code: '1021', name: 'Accumulated depreciation — plant and machinery',    group: 'fixed_assets' },
  { role: 'ppe_furniture',             code: '1030', name: 'Furniture and fittings',                            group: 'fixed_assets' },
  { role: 'accdep_furniture',          code: '1031', name: 'Accumulated depreciation — furniture and fittings', group: 'fixed_assets' },
  { role: 'ppe_vehicles',              code: '1040', name: 'Vehicles',                                          group: 'fixed_assets' },
  { role: 'accdep_vehicles',           code: '1041', name: 'Accumulated depreciation — vehicles',               group: 'fixed_assets' },
  { role: 'ppe_office',                code: '1050', name: 'Office equipment',                                  group: 'fixed_assets' },
  { role: 'accdep_office',             code: '1051', name: 'Accumulated depreciation — office equipment',       group: 'fixed_assets' },
  { role: 'ppe_computers',             code: '1060', name: 'Computers',                                         group: 'fixed_assets' },
  { role: 'accdep_computers',          code: '1061', name: 'Accumulated depreciation — computers',              group: 'fixed_assets' },
  { role: 'debtors',           code: '1300', name: 'Customers (Sundry Debtors)',   group: 'sundry_debtors' },
  { role: 'cash',              code: '1400', name: 'Cash',                         group: 'cash_in_hand' },
  { role: 'bank',              code: '1500', name: 'Bank',                         group: 'bank_accounts' },
  { role: 'upi',               code: '1510', name: 'UPI collections',              group: 'bank_accounts' },
  { role: 'card',              code: '1520', name: 'Card settlements',             group: 'bank_accounts' },
  { role: 'prepaid_expenses',          code: '1810', name: 'Prepaid expenses',                                  group: 'current_assets' },
  { role: 'accrued_income',            code: '1820', name: 'Income accrued but not received',                   group: 'current_assets' },
  { role: 'supplier_advance',  code: '1700', name: 'Advances to suppliers',        group: 'loans_advances_asset' },
  { role: 'creditors',         code: '2100', name: 'Suppliers (Sundry Creditors)', group: 'sundry_creditors' },
  { role: 'secured_loan',              code: '2000', name: 'Secured loans (term loans)',                        group: 'secured_loans' },
  { role: 'unsecured_loan',            code: '2010', name: 'Unsecured loans',                                   group: 'unsecured_loans' },
  { role: 'bank_od',                   code: '2020', name: 'Bank overdraft / cash credit',                      group: 'bank_od' },
  { role: 'output_cgst',       code: '2200', name: 'Output CGST',                  group: 'duties_taxes' },
  { role: 'output_sgst',       code: '2201', name: 'Output SGST',                  group: 'duties_taxes' },
  { role: 'output_igst',       code: '2202', name: 'Output IGST',                  group: 'duties_taxes' },
  { role: 'input_cgst',        code: '2210', name: 'Input CGST',                   group: 'duties_taxes' },
  { role: 'input_sgst',        code: '2211', name: 'Input SGST',                   group: 'duties_taxes' },
  { role: 'input_igst',        code: '2212', name: 'Input IGST',                   group: 'duties_taxes' },
  /* v1.16.0 — GST Compensation Cess Act 2017: its own pair, beside the three heads (cess credit pays ONLY cess, s.11(2)). Under Duties & Taxes, so Schedule III reads them like the GST heads. */
  { role: 'output_cess',       code: '2203', name: 'Output Cess',                  group: 'duties_taxes' },
  { role: 'input_cess',        code: '2213', name: 'Input Cess',                   group: 'duties_taxes' },
  /* v1.20.0 — REVERSE CHARGE: the tax the BUYER owes on a notified supply (s.9(3) / 9(4)), its own ledger per head so it can never be set off against input credit (s.49(4), Rule 86(2)): paid in cash by the challan (gst_payment's `rcm`). */
  { role: 'rcm_cgst',          code: '2204', name: 'RCM payable — CGST',           group: 'duties_taxes' },
  { role: 'rcm_sgst',          code: '2205', name: 'RCM payable — SGST',           group: 'duties_taxes' },
  { role: 'rcm_igst',          code: '2206', name: 'RCM payable — IGST',           group: 'duties_taxes' },
  { role: 'tds_payable',       code: '2220', name: 'TDS payable',                  group: 'duties_taxes' },
  { role: 'customer_advance',  code: '2400', name: 'Advances from customers',      group: 'current_liabilities' },
  { role: 'outstanding_expenses',      code: '2410', name: 'Outstanding expenses',                              group: 'current_liabilities' },
  { role: 'salary_payable',            code: '2420', name: 'Salary and wages payable',                          group: 'current_liabilities' },
  { role: 'income_in_advance',         code: '2430', name: 'Income received in advance',                        group: 'current_liabilities' },
  { role: 'suspense',          code: '2900', name: 'Suspense',                     group: 'suspense' },
  { role: 'capital',           code: '3000', name: 'Capital',                      group: 'capital' },
  { role: 'drawings',          code: '3100', name: 'Drawings',                     group: 'capital' },
  { role: 'retained',          code: '3900', name: 'Profit and loss (retained)',   group: 'reserves_surplus' },
  { role: 'sales',             code: '4000', name: 'Sales',                        group: 'sales_accounts' },
  { role: 'sales_returns',     code: '4090', name: 'Sales returns',                group: 'sales_accounts' },
  { role: 'interest_received', code: '4200', name: 'Interest received',            group: 'indirect_incomes' },
  { role: 'gain_on_disposal',          code: '4250', name: 'Profit on sale of fixed assets',                    group: 'indirect_incomes' },
  { role: 'fx_gain_loss',              code: '4260', name: 'Exchange gain or loss',                             group: 'indirect_incomes' },   /* v1.45.0 (FX1): Ind AS 21 ¶28/¶23 — realised and unrealised, one ledger; its balance may be either side */
  { role: 'purchases',         code: '5000', name: 'Purchases',                    group: 'purchase_accounts' },
  { role: 'purchase_returns',  code: '5090', name: 'Purchase returns',             group: 'purchase_accounts' },
  { role: 'changes_in_inventories',    code: '5050', name: 'Changes in inventories of stock-in-trade',          group: 'purchase_accounts', sch3: 'changes_inventories' },
  { role: 'discount_allowed',  code: '6800', name: 'Discount allowed',             group: 'indirect_expenses' },
  { role: 'bad_debts',         code: '6850', name: 'Bad debts written off',        group: 'indirect_expenses' },
  { role: 'depreciation',              code: '6200', name: 'Depreciation',                                      group: 'indirect_expenses', sch3: 'depreciation' },
  { role: 'loss_on_disposal',          code: '6210', name: 'Loss on sale of fixed assets',                      group: 'indirect_expenses' },
  { role: 'round_off',         code: '6900', name: 'Round off',                    group: 'indirect_expenses' },
];

/** ⭐ what a shop pays for that is not stock — the drawer's "expense" chit carries one of these (SPEC-books §6) */
const EXPENSE_CLASSES_IN = [
  { role: 'wages',           code: '5100', name: 'Wages',                        group: 'direct_expenses', sch3: 'employee_benefits' },
  { role: 'freight_inward',  code: '5110', name: 'Freight and cartage inward',   group: 'direct_expenses' },
  { role: 'packing',         code: '5120', name: 'Packing materials',            group: 'direct_expenses' },
  { role: 'rent',            code: '6010', name: 'Rent',                         group: 'indirect_expenses' },
  { role: 'salary',          code: '6020', name: 'Salaries',                     group: 'indirect_expenses', sch3: 'employee_benefits' },
  { role: 'electricity',     code: '6030', name: 'Electricity and water',        group: 'indirect_expenses' },
  { role: 'telephone',       code: '6040', name: 'Telephone and internet',       group: 'indirect_expenses' },
  { role: 'transport',       code: '6050', name: 'Transport and delivery',       group: 'indirect_expenses' },
  { role: 'repairs',         code: '6060', name: 'Repairs and maintenance',      group: 'indirect_expenses' },
  { role: 'stationery',      code: '6070', name: 'Printing and stationery',      group: 'indirect_expenses' },
  { role: 'fuel',            code: '6080', name: 'Fuel',                         group: 'indirect_expenses' },
  { role: 'interest_paid',    code: '6150', name: 'Interest on loans',            group: 'indirect_expenses', sch3: 'finance_costs' },
  { role: 'bank_charges',    code: '6090', name: 'Bank charges',                 group: 'indirect_expenses', sch3: 'finance_costs' },
  { role: 'commission_paid', code: '6100', name: 'Commission paid',              group: 'indirect_expenses' },
  { role: 'advertising',     code: '6110', name: 'Advertising',                  group: 'indirect_expenses' },
  { role: 'professional',    code: '6120', name: 'Professional fees',            group: 'indirect_expenses' },
  { role: 'staff_welfare',   code: '6130', name: 'Staff welfare',                group: 'indirect_expenses', sch3: 'employee_benefits' },
  /* v1.16.0 (year-journey gap 3): Insurance is a standard indirect expense in Tally's and Zoho's charts; 6140 is the free code between 6130 and 6150 in the group's own 6000-6999 range (nextCode finds 6000 first, which the group keeps for itself). Schedule III: Other expenses (the group's line). */
  { role: 'insurance',       code: '6140', name: 'Insurance',                    group: 'indirect_expenses' },
  { role: 'sundry_expense',  code: '6190', name: 'Sundry expenses',              group: 'indirect_expenses' },
];

/** ⭐ money that comes in and is not a sale — the `income` chit's classes (SPEC-books §6). interest_received IS the ledger 4200. */
const INCOME_CLASSES_IN = [
  { role: 'interest_received',   code: '4200', name: 'Interest received',   group: 'indirect_incomes' },
  { role: 'commission_received', code: '4210', name: 'Commission received', group: 'indirect_incomes' },
  { role: 'rent_received',       code: '4220', name: 'Rent received',       group: 'indirect_incomes' },
  { role: 'discount_received',   code: '4230', name: 'Discount received',   group: 'indirect_incomes' },
  { role: 'scrap_sales',         code: '4240', name: 'Scrap sales',         group: 'indirect_incomes' },
  { role: 'sundry_income',       code: '4290', name: 'Sundry income',       group: 'indirect_incomes' },
];

/**
 * ⭐ v1.14.0 (books-rules R2) — THE DEPRECIATION RATES, AS DATA. Per asset class: the ledger pair (cost, accumulated), the
 * Income-tax Act Appendix I block rate on WDV (`it_rate`, per cent) and the Companies Act Schedule II useful life
 * (`life`, years). Buildings are the non-residential / non-factory case (10% · 60 years); a shop with another kind adds
 * its own class. posting.depreciationFor reads these — no rate lives in a rule.
 */
const ASSET_CLASSES_IN = [
  { class: 'buildings',  cost_role: 'ppe_buildings',  acc_role: 'accdep_buildings',  it_rate: 10, life: 60 },
  { class: 'plant',      cost_role: 'ppe_plant',      acc_role: 'accdep_plant',      it_rate: 15, life: 15 },
  { class: 'furniture',  cost_role: 'ppe_furniture',  acc_role: 'accdep_furniture',  it_rate: 10, life: 10 },
  { class: 'vehicles',   cost_role: 'ppe_vehicles',   acc_role: 'accdep_vehicles',   it_rate: 15, life: 8 },
  { class: 'office',     cost_role: 'ppe_office',     acc_role: 'accdep_office',     it_rate: 15, life: 5 },
  { class: 'computers',  cost_role: 'ppe_computers',  acc_role: 'accdep_computers',  it_rate: 40, life: 3 },
];
/** the basis a depreciation follows, by entity type: a company → Schedule II; everyone else → Income-tax Act WDV */
const ENTITY_BASES_IN = {
  company:     { basis: 'schedule_ii', methods: ['slm', 'wdv'], residual_pct: 5, prorata: 'days' },
  proprietor:  { basis: 'it_act_wdv' }, partnership: { basis: 'it_act_wdv' }, llp: { basis: 'it_act_wdv' },
  huf:         { basis: 'it_act_wdv' }, trust:       { basis: 'it_act_wdv' },
};

/* ── the India tax pack (CGST/IGST Act, GSTN schemas): the object tax-packs.PACKS.IN is ── */
const TAX_IN = Object.freeze({
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
  const p = pack || PACK, sch3 = r.sch3 || g.sch3;
  const line = (p.sch3 && Object.prototype.hasOwnProperty.call(p.sch3, sch3)) ? p.sch3[sch3] : null;
  return { tally_group: g.name, sch3: sch3, sch3_line: line ? line.label : null, statement: line ? line.st : null,
           saft: { category: g.nature.toUpperCase(), code: sch3 } };
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
  cess: { output: 'output_cess', input: 'input_cess', rcm: null },
};

function refuse_(why) { var e = new Error(why); e.refused = true; return e; }
/**
 * ⭐ setOff({ output, input }, minor) → { utilised: [{ from, against, amount }], payable, carried } — THE ORDER OF SET-OFF, India's (b3). The balances are handed in as they came and
 * read by `minor` (the core's one amount reader), so the answer is in MINOR units. Moved verbatim from posting.gstSetOff_: CGST Act s.49A / s.49(5) — IGST credit first (→ IGST, CGST,
 * SGST); CGST credit → CGST, then IGST; SGST credit → SGST, then IGST; CGST and SGST never cross; and, v1.16.0, GST Compensation Cess Act s.11(2): cess credit pays ONLY cess, and
 * cess is paid ONLY by cess credit. Reverse-charge tax is never set off (s.49(4), Rule 86(2)): the core pays it in cash and never hands it here.
 */
function setOff(o, minor) {
  var output = o.output, input = o.input;
  var out = {}, inp = {};
  TAX_HEADS.forEach(function (h) {
    out[h] = minor((output || {})[h]); inp[h] = minor((input || {})[h]);
    if (out[h] < 0 || inp[h] < 0) throw refuse_('A GST balance is never negative here — pass the credit balance of output and the debit balance of input.');
  });
  var used = [];
  var use = function (from, against) { var a = Math.min(inp[from], out[against]); if (a > 0) { inp[from] -= a; out[against] -= a; used.push({ from: from, against: against, amount: a }); } };
  use('igst', 'igst'); use('igst', 'cgst'); use('igst', 'sgst');
  use('cgst', 'cgst'); use('cgst', 'igst');
  use('sgst', 'sgst'); use('sgst', 'igst');
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
  setOffNarration: 'GST set-off',
};

/** records — Companies Act 2013 s.128(5): books of account kept in good order for not less than EIGHT financial years immediately preceding; CGST Act 2017 s.36:
 *  accounts and records kept 72 months from the due date of the annual return for the year they belong to (longer while an appeal or investigation runs) */
const RECORDS = { years: { standard: 8, gst_months: 72 },
                  cite: 'Companies Act 2013 s.128(5); CGST Act 2017 s.36 (72 months from the annual return\'s due date; s.36 proviso: a year after an appeal or investigation ends)' };

/**
 * ⭐ depreciation.compute(rows, base, ctx) → { total, rate, per } for ONE asset class — India's law, moved verbatim from posting.depreciationFor (b4). `rows` are the assets of the class
 * ({ id, c (the class row), cost, wdv (opening written-down value), days (in use this year), added (bought this year), proceeds }), amounts in MINOR units; `base` the entity's basis; ctx { method, diy
 * (days in the year) }. Income-tax Act WDV (it_act_wdv): the block rate on the written-down value, an addition put to use under 180 days before the year end takes half the rate (s.32(1)(ii)
 * second proviso), sale proceeds come off the block, the older part first. Companies Act Schedule II (schedule_ii): the useful life, a 5% residual, straight-line or written-down, additions pro rata
 * by days. The class total is the block's for the Income-tax basis, the sum of the assets' for Schedule II; the core adds any rounding drift to the first asset.
 */
function depreciationCompute(rs, base, ctx) {
  var x = { method: ctx.method }, diy = ctx.diy, c = rs[0].c, total = 0, rate = 0, per = [];
  var half = function (r) { return r.added && r.days < 180; };
  if (base.basis === 'it_act_wdv') {
    var O = 0, F = 0, H = 0, S = 0;
    rs.forEach(function (r) { if (!r.added) O += r.wdv; else if (half(r)) H += r.cost; else F += r.cost; S += r.proceeds; });
    var older = O + F, left = Math.max(0, older - S), halfLeft = Math.max(0, H - Math.max(0, S - older));
    total = Math.round(left * c.it_rate / 100 + halfLeft * c.it_rate / 200);
    rate = !left && halfLeft ? c.it_rate / 2 : c.it_rate;
    per = rs.map(function (r) { return Math.round(r.added ? r.cost * c.it_rate / (half(r) ? 200 : 100) : r.wdv * c.it_rate / 100); });
  } else {
    var life = c.life, res = (base.residual_pct || 0) / 100;
    rate = x.method === 'slm' ? Math.round((1 - res) / life * 10000) / 100 : Math.round((1 - Math.pow(res, 1 / life)) * 10000) / 100;
    per = rs.map(function (r) {
      var cost = r.cost, ch;
      if (x.method === 'slm') {
        if (cost === null) throw refuse_('Schedule II straight-line needs the cost of asset ' + r.id + '.');
        ch = (cost - cost * res) / life * r.days / diy;
        if (r.wdv !== null) ch = Math.min(ch, Math.max(0, r.wdv - cost * res));
      } else {
        ch = (r.wdv !== null ? r.wdv : cost * r.days / diy) * (1 - Math.pow(res, 1 / life));
      }
      return Math.round(Number(ch.toPrecision(15)));
    });
    total = per.reduce(function (s, v) { return s + v; }, 0);
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
const GST_PAIRS = [['output_cgst', 'input_cgst', 'cgst', 'CGST'], ['output_sgst', 'input_sgst', 'sgst', 'SGST'], ['output_igst', 'input_igst', 'igst', 'IGST'],
  ['output_cess', 'input_cess', 'cess', 'Cess']];
/** SCHEDULE III AGEING — trade receivables: not due · < 6 months · 6 months–1 year · 1–2 years · 2–3 years · > 3 years, each split undisputed / disputed; trade payables: not due · < 1 year · 1–2 · 2–3 · > 3 years. */
const AGE_RECEIVABLE_IN = [['not_due', null], ['lt_6m', [0, 6]], ['m6_1y', [6, 12]], ['y1_2', [12, 24]], ['y2_3', [24, 36]], ['gt_3y', [36, null]]];
const AGE_PAYABLE_IN = [['not_due', null], ['lt_1y', [0, 12]], ['y1_2', [12, 24]], ['y2_3', [24, 36]], ['gt_3y', [36, null]]];
const PRESENTATION = {
  lines: SCH3,
  lineOf: function (a) { return a.sch3; },
  labelOf: function (a) { return a.sch3_line; },
  placed: function (a, key) { return Object.assign({}, a, { sch3: key }); },
  taxNetting: GST_PAIRS.map(function (g) {
    return { output: g[0], input: g[1], creditRole: 'gst_credit_' + g[2], payableRole: 'gst_payable_' + g[2],
             creditName: 'Balances with government authorities — ' + g[3] + ' credit', payableName: 'GST payable — ' + g[3] };
  }),
  creditLine: 'other_current_assets', payableLine: 'other_current_liabilities', profitLine: 'reserves_surplus',
  ownerCapitalBases: ['proprietor', 'partnership'],
  ageing: { receivable: AGE_RECEIVABLE_IN, payable: AGE_PAYABLE_IN },
  labels: {
    advancesFromCustomers: 'Advances from customers', advancesToSuppliers: 'Advances to suppliers',
    profitToDate: 'Profit for the year to date', profitLine: 'Reserves and surplus',
    openingCapital: 'Opening capital', netProfitToDate: 'Add: Net profit for the year to date', netLossToDate: 'Less: Net loss for the year to date', drawings: 'Less: Drawings', capitalAccount: 'Capital account',
    openingStock: 'Opening stock', closingStock: 'Closing stock',
  },
};
/** the groups the core reads by KIND: Tally's group codes (loans, cash, bank are used by posting from b6) */
const CHART = {
  paymentModes: { cash: 'cash', bank: 'bank', upi: 'upi', card: 'card', cheque: 'bank' },   /* how a payment mode lands: the REAL account money comes into. A cheque posts only on clearing, into the bank (C3). */
  kinds: { tax: 'duties_taxes', stock: 'stock_in_hand', cash: 'cash_in_hand', bank: 'bank_accounts',
           loans: ['loans_liability', 'secured_loans', 'unsecured_loans', 'bank_od'],
           sales: 'sales_accounts', purchases: 'purchase_accounts', directIncome: 'direct_incomes', directExpense: 'direct_expenses',
           indirectIncome: 'indirect_incomes', indirectExpense: 'indirect_expenses' },
};

/** the words a refusal quotes (b6): the standard behind a rule */
const CITE = { inventoryFormula: 'AS 2 para 16', lowerOfCostNrv: 'AS 2 para 5' };
/** the ledger an accrued expense is owed on: wages, salaries and staff welfare (Schedule III: employee benefits expense) are salary payable; the rest are outstanding expenses */
function accrualPayableFor(a) { return a && a.sch3 === 'employee_benefits' ? 'salary_payable' : 'outstanding_expenses'; }

/**
 * ⭐ checks.msme(balances, asOf, opt, day) → the open debits older than they may be — ⚠️ FOR A CA TO CONFIRM (spec §12). MSMED Act s.15: a buyer pays a micro/small supplier within the agreed period, never
 * beyond 45 days; IT s.43B(h) disallows the buyer's deduction for dues paid late. Flags every open debit older than min(its credit days, 45) on asOf. Moved verbatim from receivables.msmeFlags (b7);
 * `day` is the core's date reader. Each option is off until the supplier turns it on (null).
 */
function msmeCheck(bs, asOf, opt, day) {
  var o = opt || {}; if (!o.on) return null;
  var cap = Number(o.days) > 0 ? Number(o.days) : 45, today = day(asOf);
  return ((bs && bs.debits) || []).filter(function (d) { return d.balance > 0; }).map(function (d) {
    var agreed = Math.min(cap, Math.max(0, day(d.due) - day(d.date))), age = today - day(d.date);
    return { debit: d.id, party: d.party, age_days: age, limit_days: agreed, beyond: age > agreed };
  }).filter(function (r) { return r.beyond; });
}

/* ⭐ BANK STATEMENTS (b7) — India's banks: the header cells each prints (PRESETS, verify:true until checked against a real file) and the whole words a narration uses (RULES), moved verbatim from bank-recon. */
const BANK_PRESETS = {
  sbi:   { bank: 'State Bank of India', verify: true, note: 'Txn Date · Value Date · Description · Ref No./Cheque No. · Debit · Credit · Balance',
           map: { date: ['Txn Date'], value_date: ['Value Date'], narration: ['Description'], ref: ['Ref No./Cheque No.', 'Ref No'], debit: ['Debit'], credit: ['Credit'], balance: ['Balance'] } },
  hdfc:  { bank: 'HDFC Bank', verify: true, note: 'Date · Narration · Chq./Ref.No. · Value Dt · Withdrawal Amt. · Deposit Amt. · Closing Balance',
           map: { date: ['Date'], narration: ['Narration'], ref: ['Chq./Ref.No.', 'Chq/Ref No'], value_date: ['Value Dt'], debit: ['Withdrawal Amt.'], credit: ['Deposit Amt.'], balance: ['Closing Balance'] } },
  icici: { bank: 'ICICI Bank', verify: true, note: 'S No. · Value Date · Transaction Date · Cheque Number · Transaction Remarks · Withdrawal Amount (INR ) · Deposit Amount (INR ) · Balance (INR )',
           map: { date: ['Transaction Date'], value_date: ['Value Date'], cheque_no: ['Cheque Number'], narration: ['Transaction Remarks'], debit: ['Withdrawal Amount (INR )'], credit: ['Deposit Amount (INR )'], balance: ['Balance (INR )'] } },
  axis:  { bank: 'Axis Bank', verify: true, note: 'SRL NO · Tran Date · CHQNO · PARTICULARS · DR · CR · BAL · SOL',
           map: { date: ['Tran Date'], cheque_no: ['CHQNO'], narration: ['PARTICULARS'], debit: ['DR'], credit: ['CR'], balance: ['BAL'] } },
  kotak: { bank: 'Kotak Mahindra Bank', verify: true, note: 'Sl. No. · Transaction Date · Value Date · Description · Chq / Ref No. · Debit · Credit · Dr / Cr · Balance (balance carries a Dr / Cr marker)',
           map: { date: ['Transaction Date'], value_date: ['Value Date'], narration: ['Description'], ref: ['Chq / Ref No.', 'Chq/Ref No'], debit: ['Debit'], credit: ['Credit'], balance: ['Balance'] } },
};
const BANK_KEYWORDS = {
  default: {
    charges: ['CHRG', 'CHRGS', 'CHARGES', 'CHARGE', 'CHG', 'CHGS', 'SMS CHG', 'GST ON CHG', 'GST ON CHARGES', 'SERVICE CHARGE', 'AMC', 'ANNUAL FEE', 'DEBIT CARD FEE', 'MIN BAL', 'MAINTENANCE CHARGES'],
    interest: ['INT', 'INTEREST', 'INTEREST CR', 'INT CR', 'INT.PD', 'INT PD', 'CREDIT INTEREST', 'SB INT', 'INT PAID'],
    atm: ['ATM', 'ATM WDL', 'CASH WDL', 'CASH WITHDRAWAL', 'NFS', 'ATM CASH', 'SELF WITHDRAWAL'],
    cash_deposit: ['CASH DEPOSIT', 'CASH DEP', 'CDM', 'BY CASH'],
    cheque_return: ['RTN', 'RETURN', 'RETURNED', 'CHQ RET', 'CHQ RTN', 'CHEQUE RETURN', 'INWARD RETURN', 'I/W RETURN', 'BOUNCE', 'DISHONOUR', 'DISHONOURED'],
    transfer: ['UPI', 'NEFT', 'IMPS', 'RTGS'],
  },
  sbi: { charges: ['SMS ALERT CHARGES', 'ATM AMC'], interest: ['CREDIT INTEREST'] },
  hdfc: { charges: ['CHQ BOOK ISSUE', 'FUNDS TRANSFER CHARGES'], interest: ['INT.PD'] },
  icici: { charges: ['GST-', 'SMS CHARGES'], interest: ['INT.PD'] },
  axis: { charges: ['SERVICE CHRG'], interest: ['INT.PD'] },
  kotak: { charges: ['CHG'], interest: ['INTEREST CREDITED'] },
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
    return { code: a.code, role: a.role || '', name: a.name, group: a.group, tally_group: a.tally_group, nature: a.nature,
             statement: a.statement, sch3: a.sch3, sch3_line: a.sch3_line, saft_category: a.saft.category, saft_code: a.saft.code };
  },
  groupName: function (row) { return row.tally_group; },   /* the group name trial_balance.csv prints beside a code */
  taxScheme: 'GSTIN',
  taxTable: { TaxType: 'GST', Description: 'Goods and Services Tax' },
  taxLine: function (a) { var m = /^(output|input)_(cgst|sgst|igst|cess)$/.exec(a.role || ''); return m && a.group === 'duties_taxes' ? { dir: m[1], code: m[2].toUpperCase() } : null; },
  taxPercentage: function (t, rate) { var n = Number(rate); return t.code === 'CESS' ? null : rate == null || rate === '' || !Number.isFinite(n) ? null : String(t.code === 'IGST' ? n : n / 2); },
  taxCodeDescription: function (a) { return a.name.replace(/^(Output|Input)\s+/, ''); },
  tallyXml: function (kit) {
  var c = kit.c, pos = kit.pos, dp = c.dp, P = c.P, codeBook = kit.codeBook, billwise_ = kit.billwise, dec = kit.dec, xml_ = kit.xml, day_ = kit.day;
  var deb = P.accountOf(c.pack, 'debtors').code, cre = P.accountOf(c.pack, 'creditors').code;
  /* Tally: a DEBIT is a negative amount with ISDEEMEDPOSITIVE Yes */
  var amt = function (netDr) { return dec(-netDr, dp); };
  var partyName = function (id) { var p = c.parties[String(id)]; return p ? (p.name + ' (' + (p.party_no || id) + ')') : String(id); };   /* an unknown party's ledger is its id — the same name its master gets below */
  var ledgerName = function (a, party) { return party && (a.code === deb || a.code === cre) ? partyName(party) : a.name; };
  var masters = [];
  codeBook().forEach(function (a) {
    if (a.code === deb || a.code === cre) return;
    var o = (pos.open.accounts[a.code] || { net_minor: 0 }).net_minor;
    masters.push('<TALLYMESSAGE><LEDGER NAME="' + xml_(a.name) + '" ACTION="Create"><NAME.LIST><NAME>' + xml_(a.name) + '</NAME><NAME>' + xml_(a.code) + '</NAME></NAME.LIST>'
      + '<PARENT>' + xml_(a.tally_group) + '</PARENT><OPENINGBALANCE>' + amt(o) + '</OPENINGBALANCE></LEDGER></TALLYMESSAGE>');
  });
  Object.keys(c.parties).sort().forEach(function (k) {
    var p = c.parties[k], code = p.side === 'supplier' ? cre : deb, a = P.accountOf(c.pack, code);
    var o = ((pos.open.parties[code] || {})[k] || { net_minor: 0 }).net_minor, gst = (p.tax_ids || []).find(function (t) { return t.scheme === 'GSTIN'; });
    masters.push('<TALLYMESSAGE><LEDGER NAME="' + xml_(partyName(k)) + '" ACTION="Create"><NAME.LIST><NAME>' + xml_(partyName(k)) + '</NAME></NAME.LIST>'
      + '<PARENT>' + xml_(a.tally_group) + '</PARENT><ISBILLWISEON>Yes</ISBILLWISEON>'
      + (gst ? '<PARTYGSTIN>' + xml_(gst.value) + '</PARTYGSTIN>' : '') + (p.state_code ? '<LEDSTATENAME>' + xml_(p.state_code) + '</LEDSTATENAME>' : '')
      + '<OPENINGBALANCE>' + amt(o) + '</OPENINGBALANCE></LEDGER></TALLYMESSAGE>');
  });
  /* M7a: no ghost ledgers — a party a voucher names but `parties` does not list still gets its master, under its control account's group */
  c.unknown.forEach(function (p) {
    var code = p.side === 'supplier' ? cre : deb, a = P.accountOf(c.pack, code), o = ((pos.open.parties[code] || {})[p.party_id] || { net_minor: 0 }).net_minor;
    masters.push('<TALLYMESSAGE><LEDGER NAME="' + xml_(partyName(p.party_id)) + '" ACTION="Create"><NAME.LIST><NAME>' + xml_(partyName(p.party_id)) + '</NAME></NAME.LIST>'
      + '<PARENT>' + xml_(a.tally_group) + '</PARENT><ISBILLWISEON>Yes</ISBILLWISEON><OPENINGBALANCE>' + amt(o) + '</OPENINGBALANCE></LEDGER></TALLYMESSAGE>');
  });
  var byEntry = Object.create(null), order = [];
  c.moves.forEach(function (l) { var k = l.jv_no || l.entry_id; if (!byEntry[k]) { byEntry[k] = []; order.push(k); } byEntry[k].push(l); });
  order.sort(function (p, q) { var a = byEntry[p][0], b = byEntry[q][0]; return (day_(a.date) - day_(b.date)) || String(p).localeCompare(String(q)); });
  var vouchers = order.map(function (k) {
    var ls = byEntry[k], h = ls[0];
    return '<TALLYMESSAGE><VOUCHER VCHTYPE="Journal" ACTION="Create"><DATE>' + h.date.replace(/-/g, '') + '</DATE><VOUCHERTYPENAME>Journal</VOUCHERTYPENAME>'
      + '<VOUCHERNUMBER>' + xml_(k) + '</VOUCHERNUMBER>' + (h.narration ? '<NARRATION>' + xml_(h.narration) + '</NARRATION>' : '')
      + ls.map(function (l) {
        var a = c.acct(l), net = Number(l.dr_minor || 0) - Number(l.cr_minor || 0);
        var bills = l.party && (a.code === deb || a.code === cre) ? billwise_(c, l, net) : [];
        return '<ALLLEDGERENTRIES.LIST><LEDGERNAME>' + xml_(ledgerName(a, l.party)) + '</LEDGERNAME><ISDEEMEDPOSITIVE>' + (net > 0 ? 'Yes' : 'No') + '</ISDEEMEDPOSITIVE>'
          + '<AMOUNT>' + amt(net) + '</AMOUNT>'
          + bills.map(function (b) { return '<BILLALLOCATIONS.LIST><NAME>' + xml_(b.name) + '</NAME><BILLTYPE>' + b.type + '</BILLTYPE><AMOUNT>' + amt(b.minor) + '</AMOUNT></BILLALLOCATIONS.LIST>'; }).join('')
          + '</ALLLEDGERENTRIES.LIST>';
      }).join('') + '</VOUCHER></TALLYMESSAGE>';
  });
  var e = c.x.entity || {};
  return '<?xml version="1.0" encoding="UTF-8"?>\r\n<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA>'
    + '<REQUESTDESC><REPORTNAME>All Masters</REPORTNAME><STATICVARIABLES><SVCURRENTCOMPANY>' + xml_(e.name || '') + '</SVCURRENTCOMPANY></STATICVARIABLES></REQUESTDESC>'
    + '<REQUESTDATA>\r\n' + masters.concat(vouchers).join('\r\n') + '\r\n</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>\r\n';
  },
};

/** the fiscal year: April to March, written '2026-27' */
const FISCAL_YEAR = { startMonth: 4, label: 'split' };

/**
 * v1.45.0 (FX1) — FOREIGN CURRENCY: the rate the TAX value of a foreign-currency supply uses, and the accounting standard the books follow. A rate is evidence the
 * owner enters or imports (source + date on every entry that used it) — the pack names WHICH rate the law wants, never a number.
 */
const FX_IN = {
  standard: 'Ind AS 21 / AS 11: a foreign-currency transaction at the spot rate of its date; monetary items at the closing rate; differences to profit or loss',
  tax_rate_source: 'official',
  tax_rate_rule: 'CGST Rules r.34: goods at the rate notified by CBIC under s.14 Customs Act on the time of supply; services at the RBI reference rate (GAAP)',
  official_name: 'CBIC customs exchange rate notification',
};

/**
 * ⭐ THE PACK. The first block is the shape accounts-packs.PACKS.IN has always had (the chart rows keep their top-level names because
 * withAccounts and every caller read them there); the rest is the regulation contract (regulation.js). One object, one source.
 */
const PACK = {
  id: 'IN', version: '1.0.0', name: 'India · GST', verified: true,
  country: 'IN', basis: "Tally's 28 predefined groups · Schedule III Division I", currency: 'INR', fy_start_month: FISCAL_YEAR.startMonth,
  sch3: SCH3, groups: GROUPS_IN, ledgers: LEDGERS_IN,
  expense_classes: EXPENSE_CLASSES_IN, income_classes: INCOME_CLASSES_IN,
  asset_classes: ASSET_CLASSES_IN, entity_bases: ENTITY_BASES_IN,
  fiscalYear: FISCAL_YEAR,
  accountExtras: accountExtras,
  presentation: PRESENTATION, chart: CHART,
  depreciation: { assetClasses: ASSET_CLASSES_IN, entityBases: ENTITY_BASES_IN, compute: depreciationCompute },
  checks: { msme: msmeCheck }, bank: BANK, export: EXPORT,
  cite: CITE, accrualPayableFor: accrualPayableFor,
  setOff: setOff, eventAliases: EVENT_ALIASES, messages: MESSAGES,
  taxHeads: TAX_HEADS, payHeads: TAX_HEADS, optionalHeads: ['cess'], taxLedgers: TAX_LEDGERS,
  rcmSettlement: 'cash',   /* v1.48.1: reverse-charge tax is paid in CASH, never set off against credit (s.49(4), Rule 86(2)) — the core's `rcm` option is this rule */
  voucherSeries: VOUCHER_SERIES_IN, manualSeries: MANUAL_SERIES_IN, voucherFormat: '{series}/{fy}/{n:6}',
  tax: TAX_IN,
  fx: FX_IN,
  /* v1.48.0 (W2-BOOKS): how long the law keeps the books — read by the platform's book packs (delete_after) and screens; was a typed 8 in the api */
  records: RECORDS, retentionYears: 8,   /* Companies Act 2013 s.128(5): eight financial years */
  /* v1.42.0 (CS2): the country's own locale (BCP 47 format tag, the languages offered, the usual currency — the row CBLocale.REGIONS.IN carried) and its IANA zones (one: the
     Country setup step sets identities.timezone from it without asking; a multi-zone country asks). docs/COUNTRY-STANDARD.md A1 `locale`, A3 `timeZones`. */
  locale: { format: 'en-IN', langs: ['en', 'hi', 'ta', 'te', 'bn', 'mr', 'gu', 'kn', 'ml', 'pa'], cur: ['INR'] },
  timeZones: ['Asia/Kolkata'],
  /* v1.41.0 (CPS1): what this pack LEAVES OUT and why, in its own words — read by tools/country-matrix.cjs (docs/COUNTRY-STANDARD.md A10); a key names a member of the standard */
  scope: {
    out: {
      'tax.standard_rate': 'GST is slab-rated — the rate menu IS the law; there is no one standard rate (the sample cart bills at the highest slab)',
      'tax.supplyKinds': "a line's rate comes from its HSN slab (the tax-slab engine), not from a supply kind named on the line",
      supplyKindOf: 'the same: the slab decides, by HSN code (tax-slab.resolve)',
      payroll: 'no payroll engine exists yet; PF · ESI · TDS on salary are named here so they are not forgotten',
    },
    partial: {},
  },
};

const EXPORTS = PACK;

/* ⭐ ONE FILE, EVERY HOST: node takes module.exports; a page, the TV and the shop PC take window.CBRegIN. */
if (typeof module !== 'undefined' && module.exports) module.exports = EXPORTS;
if (root && typeof root.window !== 'undefined') root.window.CBRegIN = EXPORTS;
})(typeof globalThis !== 'undefined' ? globalThis : this);

/* ADOPTED from chitbridge-engines v1.48.1 · reg-au · sha256 39bb1eb6853287747ae9f82a67d1de14db1a35172b6bc3d8c78a1c3e56931a38 — DO NOT EDIT HERE. Change it in chitbridge-engines, release a version, then run tools/adopt.cjs. */
/* chitbridge-engines · reg-au. Edited ONLY in chitbridge-engines/src/reg-au.js; every platform adopts a released version of it. */
(function (root) {
'use strict';
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
  ppe:                    { st: 'bs', side: 'assets',      label: 'Property, plant and equipment' },
  investments:            { st: 'bs', side: 'assets',      label: 'Investments' },
  inventories:            { st: 'bs', side: 'assets',      label: 'Inventories' },
  trade_receivables:      { st: 'bs', side: 'assets',      label: 'Trade and other receivables' },
  cash:                   { st: 'bs', side: 'assets',      label: 'Cash and cash equivalents' },
  other_current_assets:   { st: 'bs', side: 'assets',      label: 'Other current assets' },
  equity:                 { st: 'bs', side: 'equity',      label: "Owner's equity / Share capital" },
  retained_earnings:      { st: 'bs', side: 'equity',      label: 'Retained earnings' },
  borrowings:             { st: 'bs', side: 'liabilities', label: 'Borrowings' },
  trade_payables:         { st: 'bs', side: 'liabilities', label: 'Trade and other payables' },
  statutory_liabilities:  { st: 'bs', side: 'liabilities', label: 'GST and other statutory liabilities' },
  other_current_liabilities: { st: 'bs', side: 'liabilities', label: 'Other current liabilities' },
  provisions:             { st: 'bs', side: 'liabilities', label: 'Provisions' },
  suspense:               { st: 'bs', side: 'liabilities', label: 'Suspense (must be nil at close)' },
  revenue:                { st: 'pl', side: 'income',      label: 'Revenue' },
  other_income:           { st: 'pl', side: 'income',      label: 'Other income' },
  cost_of_sales:          { st: 'pl', side: 'expense',     label: 'Cost of sales' },
  changes_inventories:    { st: 'pl', side: 'expense',     label: 'Changes in inventories' },
  employee_benefits:      { st: 'pl', side: 'expense',     label: 'Employee benefits expense' },
  finance_costs:          { st: 'pl', side: 'expense',     label: 'Finance costs' },
  depreciation:           { st: 'pl', side: 'expense',     label: 'Depreciation and amortisation expense' },
  other_expenses:         { st: 'pl', side: 'expense',     label: 'Other expenses' },
};

/* ── the chart's groups: the code ranges keep reg-in's numbering (1xxx assets · 2xxx liabilities · 3xxx equity · 4xxx income · 5xxx cost of sales · 6xxx operating expenses) so a CA moving a client in reads the same shape ── */
const GROUPS_AU = [
  /* ── primary ── */
  { code: 'equity',                  name: 'Equity',                        type: 'personal', nature: 'equity',    side: 'cr', parent: null,                      range: [3000, 3199], line: 'equity' },
  { code: 'current_assets',          name: 'Current Assets',                type: 'real',     nature: 'asset',     side: 'dr', parent: null,                      range: [1800, 1899], line: 'other_current_assets' },
  { code: 'current_liabilities',     name: 'Current Liabilities',           type: 'personal', nature: 'liability', side: 'cr', parent: null,                      range: [2400, 2899], line: 'other_current_liabilities' },
  { code: 'non_current_assets',      name: 'Non-current Assets',            type: 'real',     nature: 'asset',     side: 'dr', parent: null,                      range: [1000, 1099], line: 'ppe' },
  { code: 'investments',             name: 'Investments',                   type: 'real',     nature: 'asset',     side: 'dr', parent: null,                      range: [1100, 1199], line: 'investments' },
  { code: 'non_current_liabilities', name: 'Non-current Liabilities',       type: 'personal', nature: 'liability', side: 'cr', parent: null,                      range: [2030, 2099], line: 'borrowings' },
  { code: 'suspense',                name: 'Suspense',                      type: 'personal', nature: 'liability', side: 'cr', parent: null,                      range: [2900, 2999], line: 'suspense' },
  { code: 'cost_of_sales',           name: 'Cost of Sales',                 type: 'nominal',  nature: 'expense',   side: 'dr', parent: null,                      range: [5100, 5999], line: 'cost_of_sales' },
  { code: 'other_income',            name: 'Other Income',                  type: 'nominal',  nature: 'income',    side: 'cr', parent: null,                      range: [4200, 4999], line: 'other_income' },
  { code: 'operating_expenses',      name: 'Operating Expenses',            type: 'nominal',  nature: 'expense',   side: 'dr', parent: null,                      range: [6000, 6999], line: 'other_expenses' },
  { code: 'purchases',               name: 'Purchases',                     type: 'nominal',  nature: 'expense',   side: 'dr', parent: null,                      range: [5000, 5099], line: 'cost_of_sales' },
  { code: 'sales',                   name: 'Sales',                         type: 'nominal',  nature: 'income',    side: 'cr', parent: null,                      range: [4000, 4199], line: 'revenue' },
  /* ── sub-groups ── */
  { code: 'bank_accounts',           name: 'Bank Accounts',                 type: 'real',     nature: 'asset',     side: 'dr', parent: 'current_assets',          range: [1500, 1599], line: 'cash' },
  { code: 'bank_overdraft',          name: 'Bank Overdraft',                type: 'personal', nature: 'liability', side: 'cr', parent: 'non_current_liabilities', range: [2020, 2029], line: 'borrowings' },
  { code: 'cash_on_hand',            name: 'Cash on Hand',                  type: 'real',     nature: 'asset',     side: 'dr', parent: 'current_assets',          range: [1400, 1499], line: 'cash' },
  { code: 'deposits',                name: 'Deposits and Bonds',            type: 'real',     nature: 'asset',     side: 'dr', parent: 'current_assets',          range: [1600, 1699], line: 'other_current_assets' },
  { code: 'gst_and_statutory',       name: 'GST and Statutory Liabilities', type: 'personal', nature: 'liability', side: 'cr', parent: 'current_liabilities',     range: [2200, 2299], line: 'statutory_liabilities' },
  { code: 'advances',                name: 'Advances and Prepayments',      type: 'personal', nature: 'asset',     side: 'dr', parent: 'current_assets',          range: [1700, 1799], line: 'other_current_assets' },
  { code: 'provisions',              name: 'Provisions',                    type: 'personal', nature: 'liability', side: 'cr', parent: 'current_liabilities',     range: [2300, 2399], line: 'provisions' },
  { code: 'retained_earnings',       name: 'Retained Earnings',             type: 'personal', nature: 'equity',    side: 'cr', parent: 'equity',                  range: [3200, 3999], line: 'retained_earnings' },
  { code: 'loans',                   name: 'Loans',                         type: 'personal', nature: 'liability', side: 'cr', parent: 'non_current_liabilities', range: [2000, 2019], line: 'borrowings' },
  { code: 'inventory',               name: 'Inventory',                     type: 'real',     nature: 'asset',     side: 'dr', parent: 'current_assets',          range: [1200, 1299], line: 'inventories' },
  { code: 'trade_creditors',         name: 'Trade Creditors',               type: 'personal', nature: 'liability', side: 'cr', parent: 'current_liabilities',     range: [2100, 2199], line: 'trade_payables' },
  { code: 'trade_debtors',           name: 'Trade Debtors',                 type: 'personal', nature: 'asset',     side: 'dr', parent: 'current_assets',          range: [1300, 1399], line: 'trade_receivables' },
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
  { role: 'stock',                    code: '1200', name: 'Inventory on hand',                             group: 'inventory' },
  { role: 'ppe_buildings',            code: '1010', name: 'Buildings',                                     group: 'non_current_assets' },
  { role: 'accdep_buildings',         code: '1011', name: 'Accumulated depreciation — buildings',          group: 'non_current_assets' },
  { role: 'ppe_plant',                code: '1020', name: 'Plant and equipment',                           group: 'non_current_assets' },
  { role: 'accdep_plant',             code: '1021', name: 'Accumulated depreciation — plant and equipment', group: 'non_current_assets' },
  { role: 'ppe_furniture',            code: '1030', name: 'Furniture and fittings',                        group: 'non_current_assets' },
  { role: 'accdep_furniture',         code: '1031', name: 'Accumulated depreciation — furniture and fittings', group: 'non_current_assets' },
  { role: 'ppe_vehicles',             code: '1040', name: 'Motor vehicles',                                group: 'non_current_assets' },
  { role: 'accdep_vehicles',          code: '1041', name: 'Accumulated depreciation — motor vehicles',     group: 'non_current_assets' },
  { role: 'ppe_office',               code: '1050', name: 'Office equipment',                              group: 'non_current_assets' },
  { role: 'accdep_office',            code: '1051', name: 'Accumulated depreciation — office equipment',   group: 'non_current_assets' },
  { role: 'ppe_computers',            code: '1060', name: 'Computers',                                     group: 'non_current_assets' },
  { role: 'accdep_computers',         code: '1061', name: 'Accumulated depreciation — computers',          group: 'non_current_assets' },
  { role: 'debtors',                  code: '1300', name: 'Customers (Trade debtors)',                     group: 'trade_debtors' },
  { role: 'cash',                     code: '1400', name: 'Cash on hand',                                  group: 'cash_on_hand' },
  { role: 'bank',                     code: '1500', name: 'Business bank account',                         group: 'bank_accounts' },
  { role: 'card',                     code: '1520', name: 'Card and EFTPOS settlements',                   group: 'bank_accounts' },
  { role: 'prepaid_expenses',         code: '1810', name: 'Prepayments',                                   group: 'current_assets' },
  { role: 'accrued_income',           code: '1820', name: 'Accrued income',                                group: 'current_assets' },
  { role: 'supplier_advance',         code: '1700', name: 'Advances to suppliers',                         group: 'advances' },
  { role: 'creditors',                code: '2100', name: 'Suppliers (Trade creditors)',                   group: 'trade_creditors' },
  { role: 'secured_loan',             code: '2000', name: 'Secured loans',                                 group: 'loans' },
  { role: 'unsecured_loan',           code: '2010', name: 'Unsecured loans',                               group: 'loans' },
  { role: 'bank_od',                  code: '2020', name: 'Bank overdraft',                                group: 'bank_overdraft' },
  /* GST Act s.9-40 (liable for GST on taxable supplies you make — 1A) and s.11-20 (entitled to input tax credits on creditable acquisitions — 1B) */
  { role: 'gst_collected',            code: '2200', name: 'GST collected',                                 group: 'gst_and_statutory' },
  { role: 'gst_paid',                 code: '2210', name: 'GST paid',                                      group: 'gst_and_statutory' },
  /* PRESENT, UNUSED until the payroll round: TAA 1953 Sch 1 s.12-35 (withholding from salary — BAS W2); Superannuation Guarantee (Administration) Act 1992 */
  { role: 'payg_withholding_payable', code: '2220', name: 'PAYG withholding payable',                      group: 'gst_and_statutory' },
  { role: 'super_payable',            code: '2230', name: 'Superannuation payable',                        group: 'gst_and_statutory' },
  { role: 'customer_advance',         code: '2400', name: 'Customer deposits (advances)',                  group: 'current_liabilities' },
  { role: 'accrued_expenses',         code: '2410', name: 'Accrued expenses',                              group: 'current_liabilities' },
  { role: 'wages_payable',            code: '2420', name: 'Wages and salaries payable',                    group: 'current_liabilities' },
  { role: 'income_in_advance',        code: '2430', name: 'Income received in advance',                    group: 'current_liabilities' },
  { role: 'suspense',                 code: '2900', name: 'Suspense',                                      group: 'suspense' },
  { role: 'capital',                  code: '3000', name: "Owner's capital",                               group: 'equity' },
  { role: 'drawings',                 code: '3100', name: 'Drawings',                                      group: 'equity' },
  { role: 'retained',                 code: '3900', name: 'Retained earnings',                             group: 'retained_earnings' },
  { role: 'sales',                    code: '4000', name: 'Sales',                                         group: 'sales' },
  { role: 'sales_export',             code: '4010', name: 'Export sales (GST-free)',                       group: 'sales' },
  { role: 'sales_gst_free',           code: '4020', name: 'GST-free sales',                                group: 'sales' },
  { role: 'sales_input_taxed',        code: '4030', name: 'Input-taxed sales',                             group: 'sales' },
  { role: 'sales_returns',            code: '4090', name: 'Sales returns and allowances',                  group: 'sales' },
  { role: 'interest_received',        code: '4200', name: 'Interest received',                             group: 'other_income' },
  { role: 'gain_on_disposal',         code: '4250', name: 'Gain on disposal of assets',                    group: 'other_income' },
  { role: 'fx_gain_loss',             code: '4260', name: 'Foreign exchange gain or loss',                 group: 'other_income' },   /* v1.45.0 (FX1): AASB 121 ¶28/¶23 */
  { role: 'purchases',                code: '5000', name: 'Purchases',                                     group: 'purchases' },
  { role: 'purchase_returns',         code: '5090', name: 'Purchase returns',                              group: 'purchases' },
  { role: 'changes_in_inventories',   code: '5050', name: 'Changes in inventories',                        group: 'purchases', line: 'changes_inventories' },
  { role: 'discount_allowed',         code: '6800', name: 'Discounts allowed',                             group: 'operating_expenses' },
  { role: 'bad_debts',                code: '6850', name: 'Bad debts written off',                         group: 'operating_expenses' },
  { role: 'depreciation',             code: '6200', name: 'Depreciation',                                  group: 'operating_expenses', line: 'depreciation' },
  { role: 'loss_on_disposal',         code: '6210', name: 'Loss on disposal of assets',                    group: 'operating_expenses' },
  { role: 'round_off',                code: '6900', name: 'Rounding',                                      group: 'operating_expenses' },
];

/** what a shop pays for that is not stock — the drawer's "expense" chit carries one of these. Superannuation expense is here so the slot exists (the calculation is a later round). */
const EXPENSE_CLASSES_AU = [
  { role: 'wages',           code: '5100', name: 'Wages',                                   group: 'cost_of_sales',      line: 'employee_benefits' },
  { role: 'freight_inward',  code: '5110', name: 'Freight inwards',                         group: 'cost_of_sales' },
  { role: 'packing',         code: '5120', name: 'Packaging',                               group: 'cost_of_sales' },
  { role: 'rent',            code: '6010', name: 'Rent',                                    group: 'operating_expenses' },
  { role: 'salary',          code: '6020', name: 'Salaries',                                group: 'operating_expenses', line: 'employee_benefits' },
  { role: 'superannuation',  code: '6025', name: 'Superannuation (employer contributions)', group: 'operating_expenses', line: 'employee_benefits' },
  { role: 'electricity',     code: '6030', name: 'Electricity, gas and water',              group: 'operating_expenses' },
  { role: 'telephone',       code: '6040', name: 'Telephone and internet',                  group: 'operating_expenses' },
  { role: 'transport',       code: '6050', name: 'Freight and delivery',                    group: 'operating_expenses' },
  { role: 'repairs',         code: '6060', name: 'Repairs and maintenance',                 group: 'operating_expenses' },
  { role: 'stationery',      code: '6070', name: 'Printing and stationery',                 group: 'operating_expenses' },
  { role: 'fuel',            code: '6080', name: 'Motor vehicle expenses',                  group: 'operating_expenses' },
  { role: 'bank_charges',    code: '6090', name: 'Bank and merchant fees',                  group: 'operating_expenses', line: 'finance_costs' },
  { role: 'commission_paid', code: '6100', name: 'Commission paid',                         group: 'operating_expenses' },
  { role: 'advertising',     code: '6110', name: 'Advertising',                             group: 'operating_expenses' },
  { role: 'professional',    code: '6120', name: 'Accounting and legal fees',               group: 'operating_expenses' },
  { role: 'staff_welfare',   code: '6130', name: 'Staff amenities',                         group: 'operating_expenses', line: 'employee_benefits' },
  { role: 'insurance',       code: '6140', name: 'Insurance',                               group: 'operating_expenses' },
  { role: 'interest_paid',   code: '6150', name: 'Interest paid',                           group: 'operating_expenses', line: 'finance_costs' },
  { role: 'sundry_expense',  code: '6190', name: 'Sundry expenses',                         group: 'operating_expenses' },
];

/** money that comes in and is not a sale — the `income` chit's classes. interest_received IS the ledger 4200. */
const INCOME_CLASSES_AU = [
  { role: 'interest_received',   code: '4200', name: 'Interest received',   group: 'other_income' },
  { role: 'commission_received', code: '4210', name: 'Commission received', group: 'other_income' },
  { role: 'rent_received',       code: '4220', name: 'Rent received',       group: 'other_income' },
  { role: 'discount_received',   code: '4230', name: 'Discounts received',  group: 'other_income' },
  { role: 'scrap_sales',         code: '4240', name: 'Scrap sales',         group: 'other_income' },
  { role: 'sundry_income',       code: '4290', name: 'Sundry income',       group: 'other_income' },
];

/**
 * ⭐ DEPRECIATION AS DATA — Division 40 ITAA 1997. `life` is the Commissioner's effective life in years (TR 2022/1, Table B — general items;
 * a shop with another kind adds its own class with the life from the ruling). The rates FOLLOW from the life: prime cost 100 ÷ life (s.40-75),
 * diminishing value 200 ÷ life for an asset first held on or after 10 May 2006 (s.40-72). Buildings are not Division 40 assets: capital works
 * are deducted under Division 43 at 2.5% a year (40 years, s.43-25) on cost — prime cost only.
 *   ato.gov.au › Depreciation and capital expenses and allowances › General depreciation rules – capital allowances; TR 2022/1 (effective life).
 */
const ASSET_CLASSES_AU = [
  { class: 'buildings', cost_role: 'ppe_buildings', acc_role: 'accdep_buildings', life: 40, methods: ['prime_cost'], cite: 'Div 43 ITAA 1997 s.43-25: capital works 2.5% a year' },
  { class: 'plant',     cost_role: 'ppe_plant',     acc_role: 'accdep_plant',     life: 10, cite: 'TR 2022/1 Table B — set per asset; 10 years is the general placeholder' },
  { class: 'furniture', cost_role: 'ppe_furniture', acc_role: 'accdep_furniture', life: 10, cite: 'TR 2022/1 Table B: furniture, freestanding — 10 years' },
  { class: 'vehicles',  cost_role: 'ppe_vehicles',  acc_role: 'accdep_vehicles',  life: 8,  cite: 'TR 2022/1 Table B: motor vehicles, cars — 8 years' },
  { class: 'office',    cost_role: 'ppe_office',    acc_role: 'accdep_office',    life: 5,  cite: 'TR 2022/1 Table B: office machines (photocopiers, printers) — 5 years' },
  { class: 'computers', cost_role: 'ppe_computers', acc_role: 'accdep_computers', life: 4,  cite: 'TR 2022/1 Table B: computers, desktop — 4 years (laptops 2)' },
];
/** every entity type follows Division 40 (a company, a sole trader, a partnership, a trust); the owner-capital bases are the sole trader and the partnership */
const ENTITY_BASES_AU = {
  company:     { basis: 'div40', methods: ['prime_cost', 'diminishing_value'], prorata: 'days' },
  sole_trader: { basis: 'div40', methods: ['prime_cost', 'diminishing_value'], prorata: 'days' },
  partnership: { basis: 'div40', methods: ['prime_cost', 'diminishing_value'], prorata: 'days' },
  trust:       { basis: 'div40', methods: ['prime_cost', 'diminishing_value'], prorata: 'days' },
};

/* ── the Australia tax pack (the GST Act): the object tax-packs.PACKS.AU is ── */
const TAX_AU = Object.freeze({
    country: 'AU',
    scheme: 'GST',
    /* the border decides, never a state: one head on a domestic supply, nothing across the border (exports are GST-free, Div 38-E) */
    supply: 'border',
    rates: Object.freeze([0, 10]),
    standard_rate: 10,                                   /* s.9-70: 10% of the value of the taxable supply */
    invoice_round_to: 0.01,                              /* to the cent; the total is the sum of its components, never a rounded figure posted */
    /**
     * ⭐ THE THREE SUPPLY KINDS AS DATA. A line names its kind (`supply_kind`); tax.determine reads this table and puts the kind's rate on the line,
     * saying WHY in the invoice's notes and in `_cb.kinds`. `credit` is whether the input tax credits on what was bought to make the supply may be
     * claimed; `bas` is the label the sale is reported at. A line that names no kind is taxable at its own rate.
     *   ato.gov.au › GST › When to charge GST (and when not to): "Taxable sales", "GST-free sales", "Input-taxed sales".
     */
    supplyKinds: Object.freeze({
      taxable:     Object.freeze({ id: 'taxable',     name: 'Taxable supply',     rate: 10, credit: true,  bas: 'G1',
                                   why: 'GST at 10% applies (GST Act s.9-5, s.9-70).', cite: 'GST Act 1999 s.9-5 (taxable supplies), s.9-70 (10%)' }),
      gst_free:    Object.freeze({ id: 'gst_free',    name: 'GST-free supply',    rate: 0,  credit: true,  bas: 'G3',
                                   why: 'GST-free: no GST is charged on this line, and the input tax credits on what was bought to make it may still be claimed (GST Act Division 38 — basic food, most health and education, exports).',
                                   cite: 'GST Act 1999 Div 38; ato.gov.au › GST-free sales' }),
      input_taxed: Object.freeze({ id: 'input_taxed', name: 'Input-taxed supply', rate: 0,  credit: false, bas: 'G1',
                                   why: 'Input-taxed: no GST is charged on this line, and no input tax credit may be claimed on what was bought to make it (GST Act Division 40 — financial supplies, residential rent).',
                                   cite: 'GST Act 1999 Div 40; ato.gov.au › Input-taxed sales' }),
    }),
    /**
     * ⭐ TAX INVOICES — GST Act s.29-70; ato.gov.au › GST › Tax invoices. A sale of A$82.50 (GST inclusive) or more needs a tax invoice for the buyer to
     * claim a credit (s.29-80(1) with GST Regulations 2019 s.29-80.01: the "low-value threshold" is $82.50, i.e. $75 plus GST); the seller must give one
     * within 28 days of a request. A tax invoice for A$1,000 or more must ALSO show the buyer's identity or ABN (s.29-70(1)(c)(ii)).
     */
    taxInvoice: Object.freeze({
      from_minor: 8250,                                  /* A$82.50 including GST */
      buyer_identity_from_minor: 100000,                 /* A$1,000 */
      within_days: 28,
      cite: 'GST Act 1999 s.29-70(1) (contents), s.29-80 + GST Regulations 2019 s.29-80.01 ($82.50); ato.gov.au/businesses-and-organisations/gst-excise-and-indirect-taxes/gst/tax-invoices',
    }),
    /** when a business must register — GST Act s.23-15 ($75,000 GST turnover; $150,000 for a non-profit); taxi / ride-sourcing from the first dollar (s.144-5) */
    registration: Object.freeze({ turnover_minor: 7500000, nonprofit_minor: 15000000, cite: 'GST Act 1999 s.23-15, s.144-5; ato.gov.au › Registering for GST' }),
    source: 'A New Tax System (Goods and Services Tax) Act 1999: s.9-5 / s.9-70 (taxable supply, 10%), Div 38 (GST-free), Div 40 (input taxed), s.29-70 / s.29-80 (tax invoices), s.23-15 (registration); ato.gov.au GST pages as read 2026-10',
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
  for (var i = 0; i < 11; i++) sum += (Number(s[i]) - (i === 0 ? 1 : 0)) * ABN_WEIGHTS[i];
  if (sum % 89 !== 0) return { ok: false, abn: s, formatted: null, why: 'The ABN check digits do not match — a digit is wrong or two are swapped.' };
  return { ok: true, abn: s, formatted: s.slice(0, 2) + ' ' + s.slice(2, 5) + ' ' + s.slice(5, 8) + ' ' + s.slice(8, 11), why: null };
}
const ABN = { valid: function (v) { return abnCheck(v).ok; }, check: abnCheck, weights: ABN_WEIGHTS, cite: 'abr.business.gov.au › Format of the ABN (modulus 89)' };

/**
 * ⭐ taxInvoice(total_minor) → what a document for this total must be — read from TAX_AU.taxInvoice (s.29-70 / s.29-80):
 *   { required, buyer_identity, must: [the contents a tax invoice needs, s.29-70(1)], cite }
 *   required         a tax invoice (the words "Tax invoice", the seller's identity and ABN, the date, what was sold, the GST) — from A$82.50 incl. GST
 *   buyer_identity   the buyer's identity or ABN must be on it too — from A$1,000
 * Below A$82.50 a receipt is enough for the buyer's credit; the seller may still issue a tax invoice.
 */
function taxInvoice(totalMinor) {
  var t = TAX_AU.taxInvoice, m = Math.abs(Number(totalMinor) || 0);
  var required = m >= t.from_minor, buyer = m >= t.buyer_identity_from_minor;
  var must = required ? ['the words "Tax invoice"', "the seller's identity (business name)", "the seller's ABN", 'the date of issue', 'a brief description of what is sold, with quantity and price',
                         'the GST amount, or "Total price includes GST" when the GST is exactly one-eleventh of the total', 'the extent to which each sale is a taxable sale'] : [];
  if (buyer) must.push("the buyer's identity or ABN");
  return { required: required, buyer_identity: buyer, within_days: t.within_days, must: must, cite: t.cite };
}

/** supplyKindOf(line) → the kind row a line names (`supply_kind` | `tax_kind`), taxable when it names none, null when it names one the pack does not know */
function supplyKindOf(line) {
  var l = line || {}, k = String(l.supply_kind || l.tax_kind || 'taxable').trim().toLowerCase().replace(/-/g, '_');
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
  { q: 1, months: [7, 8, 9],   due: [10, 28], words: 'Jul–Sep' },
  { q: 2, months: [10, 11, 12], due: [2, 28],  words: 'Oct–Dec' },
  { q: 3, months: [1, 2, 3],   due: [4, 28],  words: 'Jan–Mar' },
  { q: 4, months: [4, 5, 6],   due: [7, 28],  words: 'Apr–Jun' },
];
function pad2_(n) { return String(n).padStart(2, '0'); }
function ymd_(y, m, d) { return y + '-' + pad2_(m) + '-' + pad2_(d); }
function lastDay_(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
function basPeriods(o) {
  var x = o || {}, fq = String(x.frequency || 'quarterly').toLowerCase(), y = parseInt(String(x.fy || ''), 10);
  if (!(y > 0)) throw refuse_("BAS periods need the financial year they are in, as '2026-27' or 2026 (the year it starts, 1 July).");
  if (fq !== 'quarterly' && fq !== 'monthly') throw refuse_('A BAS is lodged quarterly or monthly — not "' + String(x.frequency).slice(0, 20) + '".');
  var label = y + '-' + pad2_((y + 1) % 100);
  if (fq === 'quarterly') return QUARTERS_AU.map(function (q) {
    var ys = q.months[0] >= 7 ? y : y + 1, ye = q.months[2] >= 7 ? y : y + 1, yd = q.due[0] >= 7 ? y : y + 1;
    if (q.q === 4) yd = y + 1;                                                   /* Q4 (Apr–Jun) is due 28 July of the NEXT calendar year */
    return { period: ys + '-Q' + q.q, label: label + ' Q' + q.q + ' (' + q.words + ' ' + ys + ')', frequency: 'quarterly',
             start: ymd_(ys, q.months[0], 1), end: ymd_(ye, q.months[2], lastDay_(ye, q.months[2])), due: ymd_(yd, q.due[0], q.due[1]) };
  });
  var out = [];
  for (var i = 0; i < 12; i++) {
    var m = ((6 + i) % 12) + 1, yy = m >= 7 ? y : y + 1, nm = m === 12 ? 1 : m + 1, ny = m === 12 ? yy + 1 : yy;
    out.push({ period: yy + '-' + pad2_(m), label: label + ' ' + yy + '-' + pad2_(m), frequency: 'monthly', start: ymd_(yy, m, 1), end: ymd_(yy, m, lastDay_(yy, m)), due: ymd_(ny, nm, 21) });
  }
  return out;
}
/**
 * ⭐ bas({ period, simpler? }, rows) → the BAS labels READ FROM THE POSTED LEDGERS of that period — nothing is recomputed from invoices.
 *   `rows` are the period's ledger MOVEMENTS by role, as ledger.accumulate gives them: [{ role, dr_minor, cr_minor }] (a code with no role is a shop's own ledger and is not a GST label).
 *   Labels (ato.gov.au › GST labels on your BAS), every amount in CENTS:
 *     G1  Total sales — GST inclusive (the form's "Does the amount at G1 include GST? Yes"): every sales ledger's net credit plus 1A
 *     G2  Export sales (`sales_export`)   G3  Other GST-free sales (`sales_gst_free`)   — nil until a shop posts there (see LEDGERS_AU)
 *     G10 Capital purchases (the ppe_* ledgers' net debit)   G11 Non-capital purchases (purchases, purchase returns and every expense class)
 *     1A  GST on sales (`gst_collected` net credit)   1B  GST on purchases (`gst_paid` net debit)   9  the net amount: 1A − 1B (positive = payable, negative = refund, s.35-5)
 *   `simpler: true` (Simpler BAS — GST turnover under A$10 million, the default since 1 July 2017) answers G1, 1A and 1B only.
 *   ⚠️ G10 / G11 are read GST-EXCLUSIVE: the ledger holds all GST paid in one account, so the split of 1B between capital and non-capital is not in the
 *   ledgers; the answer says so (`g10_g11_basis`). The ATO accepts either basis on the full BAS when stated consistently.
 */
const BAS_LABELS = {
  G1: 'Total sales', G2: 'Export sales', G3: 'Other GST-free sales', G10: 'Capital purchases', G11: 'Non-capital purchases',
  '1A': 'GST on sales', '1B': 'GST on purchases', 9: 'Your payment or refund amount',
};
function bas(o, rows) {
  var x = o || {}, byRole = Object.create(null);
  if (!x.period) throw refuse_("A BAS needs its period ('2026-Q1' or '2026-07').");
  (rows || []).forEach(function (r) {
    if (!r || !r.role) return;
    var a = byRole[r.role] || (byRole[r.role] = { dr: 0, cr: 0 });
    a.dr += int_(r.dr_minor, r.role); a.cr += int_(r.cr_minor, r.role);
  });
  var cr = function (role) { var a = byRole[role]; return a ? a.cr - a.dr : 0; }, dr = function (role) { var a = byRole[role]; return a ? a.dr - a.cr : 0; };
  var sum = function (roles, f) { return roles.reduce(function (s, r) { return s + f(r); }, 0); };
  var oneA = cr('gst_collected'), oneB = dr('gst_paid');
  var salesRoles = ['sales', 'sales_export', 'sales_gst_free', 'sales_input_taxed', 'sales_returns'];
  var g1 = sum(salesRoles, cr) + oneA;
  var labels = { G1: g1, '1A': oneA, '1B': oneB, 9: oneA - oneB };
  /* v1.39.0 (BAS1): the ledger ROLES each label was read from, so a screen can open what a figure counts — the same lists the sums above use */
  var capitalRoles = ASSET_CLASSES_AU.map(function (c) { return c.cost_role; }), nonCapitalRoles = ['purchases', 'purchase_returns'].concat(EXPENSE_CLASSES_AU.map(function (e) { return e.role; }));
  var roles = { G1: salesRoles.concat(['gst_collected']), '1A': ['gst_collected'], '1B': ['gst_paid'], 9: ['gst_collected', 'gst_paid'], G2: ['sales_export'], G3: ['sales_gst_free'], G10: capitalRoles, G11: nonCapitalRoles };
  if (!x.simpler) {
    labels.G2 = cr('sales_export'); labels.G3 = cr('sales_gst_free');
    labels.G10 = sum(capitalRoles, dr);
    labels.G11 = sum(nonCapitalRoles, dr);
  }
  var out = { period: x.period, simpler: !!x.simpler, labels: {}, payable_minor: Math.max(0, oneA - oneB), refund_minor: Math.max(0, oneB - oneA),
              g10_g11_basis: x.simpler ? null : 'GST-exclusive (the ledgers hold all GST paid in one account)', cite: 'ato.gov.au › GST labels on your BAS; Simpler BAS (turnover under A$10 million)' };
  Object.keys(labels).forEach(function (k) { out.labels[k] = { label: BAS_LABELS[k], minor: labels[k], roles: roles[k].slice() }; });
  return out;
}
function int_(v, where) { var n = v == null ? 0 : Number(v); if (!Number.isInteger(n)) throw refuse_('A ledger amount is a whole number of cents — ' + where + ' is not.'); return n; }

/** voucher series — the same standard prefixes as reg-in (Athi, 2026-10-02: "Follow the standard"); 'MJ' is a person's own entry of any kind */
const VOUCHER_SERIES_AU = { Sales: 'SV', Purchase: 'PV', Receipt: 'RV', Payment: 'PY', Contra: 'CV', 'Credit note': 'CN', 'Debit note': 'DN', Journal: 'JV' };
const MANUAL_SERIES_AU = 'MJ';

/**
 * ⭐ accountExtras(row, group, pack) → the fields of a chart account that are Australia's own: the group's name, the statement line the ledger lands on
 * (the row's, else its group's) with that line's label and statement ('bs' | 'pl'). The field is `line` — there is no Schedule III here.
 */
function accountExtras(r, g, pack) {
  const p = pack || PACK, key = r.line || g.line;
  const line = (p.presentation && p.presentation.lines && Object.prototype.hasOwnProperty.call(p.presentation.lines, key)) ? p.presentation.lines[key] : null;
  return { group_name: g.name, line: key, line_label: line ? line.label : null, statement: line ? line.st : null };
}

/** ⭐ THE TAX HEADS (b2): ONE — `gst`. Output tax lands on GST collected (1A), input tax on GST paid (1B); no reverse-charge ledger (Div 84 is a later round, refused by name). */
const TAX_HEADS = ['gst'];
const TAX_LEDGERS = { gst: { output: 'gst_collected', input: 'gst_paid', rcm: null } };

function refuse_(why) { var e = new Error(why); e.refused = true; return e; }
/**
 * ⭐ setOff({ output, input }, minor) → { utilised, payable, carried, refund } — ONE head, so the order is trivial: GST paid (1B) against GST collected (1A).
 * What is left of 1A is payable (BAS 9); what is left of 1B is a REFUND the ATO pays (GST Act s.35-5), not a credit carried into the next period —
 * it is returned as `carried` so the core's shape holds, and named `refund` beside it. Amounts in MINOR units, read by `minor` (the core's one reader).
 */
function setOff(o, minor) {
  var out = minor((o.output || {}).gst), inp = minor((o.input || {}).gst);
  if (out < 0 || inp < 0) throw refuse_('A GST balance is never negative here — pass the credit balance of GST collected and the debit balance of GST paid.');
  var a = Math.min(inp, out), used = a > 0 ? [{ from: 'gst', against: 'gst', amount: a }] : [];
  return { utilised: used, payable: { gst: out - a }, carried: { gst: inp - a }, refund: inp - a };
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
  paymentRef: { label: 'Payment reference number', ask: 'Which payment? Give the ATO payment reference number from the BAS payment slip.', hint: 'The payment reference number on the BAS', narration: 'BAS payment' },
  setOffNarration: 'GST set-off',
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
function depreciationCompute(rs, base, ctx) {
  var c = rs[0].c, diy = ctx.diy, m = String(ctx.method || 'prime_cost');
  if (m === 'slm') m = 'prime_cost'; else if (m === 'wdv') m = 'diminishing_value';
  if (c.methods && c.methods.indexOf(m) < 0) m = c.methods[0];
  var rate = m === 'prime_cost' ? Math.round(10000 / c.life) / 100 : Math.round(20000 / c.life) / 100;
  var per = rs.map(function (r) {
    if (r.cost === null && r.wdv === null) throw refuse_('Division 40 needs the cost or the opening adjustable value of asset ' + r.id + '.');
    var open = r.wdv !== null && r.wdv !== undefined ? r.wdv : r.cost;
    var ch = (m === 'prime_cost' ? r.cost : open) * r.days / diy * rate / 100;
    ch = Math.min(ch, Math.max(0, open));
    return Math.round(Number(ch.toPrecision(15)));
  });
  return { total: per.reduce(function (s, v) { return s + v; }, 0), rate: rate, per: per };
}

/**
 * ⭐ THE STATEMENTS' FORM (b5) — AASB 101, as the ledger presents them. `lines` is the statement table above; `lineOf / labelOf / placed` read and set the
 * statement-line fields of a ledger record (`line`, `line_label`); `taxNetting` nets GST paid against GST collected (one head) — a net debit is a refund due
 * (an other current asset), a net credit stays under the statutory-liabilities line; `profitLine` takes the year's profit to date; `ownerCapitalBases` are
 * the entity bases whose capital is one account; `ageing` is the common 30 / 60 / 90-day practice in MONTHS (AASB 7 para 37 asks for an age analysis and
 * prescribes no buckets — there is no statutory table).
 */
const AGE_AU = [['not_due', null], ['lt_1m', [0, 1]], ['m1_2', [1, 2]], ['m2_3', [2, 3]], ['gt_3m', [3, null]]];
const PRESENTATION = {
  lines: LINES_AU,
  lineOf: function (a) { return a.line; },
  labelOf: function (a) { return a.line_label; },
  placed: function (a, key) { return Object.assign({}, a, { line: key, line_label: LINES_AU[key] ? LINES_AU[key].label : null }); },
  taxNetting: [{ output: 'gst_collected', input: 'gst_paid', creditRole: 'gst_refund_due', payableRole: 'gst_payable',
                 creditName: 'GST refund due from the ATO', payableName: 'GST payable to the ATO' }],
  creditLine: 'other_current_assets', payableLine: 'statutory_liabilities', profitLine: 'retained_earnings',
  ownerCapitalBases: ['sole_trader', 'partnership'],
  ageing: { receivable: AGE_AU, payable: AGE_AU },
  labels: {
    advancesFromCustomers: 'Customer deposits', advancesToSuppliers: 'Advances to suppliers',
    profitToDate: 'Profit for the year to date', profitLine: 'Retained earnings',
    openingCapital: 'Opening capital', netProfitToDate: 'Add: Net profit for the year to date', netLossToDate: 'Less: Net loss for the year to date', drawings: 'Less: Drawings', capitalAccount: "Owner's equity",
    openingStock: 'Opening inventory', closingStock: 'Closing inventory',
  },
};
/** the groups the core reads by KIND, and how a payment mode lands: the REAL account money comes into (EFT, BPAY, PayID and a cheque reach the bank; EFTPOS is a card settlement) */
const CHART = {
  paymentModes: { cash: 'cash', bank: 'bank', eft: 'bank', bpay: 'bank', payid: 'bank', cheque: 'bank', card: 'card', eftpos: 'card' },
  kinds: { tax: 'gst_and_statutory', stock: 'inventory', cash: 'cash_on_hand', bank: 'bank_accounts',
           loans: ['non_current_liabilities', 'loans', 'bank_overdraft'],
           sales: 'sales', purchases: 'purchases', directIncome: 'sales', directExpense: 'cost_of_sales',
           indirectIncome: 'other_income', indirectExpense: 'operating_expenses' },
};

/** the words a refusal quotes (b6): AASB 102 Inventories — cost formulas (FIFO / weighted average, para 25); measured at the lower of cost and net realisable value (para 9) */
const CITE = { inventoryFormula: 'AASB 102 para 25', lowerOfCostNrv: 'AASB 102 para 9' };
/** the ledger an accrued expense is owed on: wages, salaries, superannuation and staff amenities (employee benefits) are wages payable; the rest are accrued expenses */
function accrualPayableFor(a) { return a && a.line === 'employee_benefits' ? 'wages_payable' : 'accrued_expenses'; }

/* ⭐ BANK STATEMENTS (b7) — the amount prefixes and the whole words a narration uses. No bank's header cells are recorded yet (a preset is added once checked against a real file). */
const BANK = {
  amountPrefixes: ['$', 'a$', 'aud'], minorUnit: 'cents', presets: {},
  keywords: { default: {
    charges: ['FEE', 'FEES', 'ACCOUNT FEE', 'MERCHANT FEE', 'MONTHLY FEE', 'SERVICE FEE', 'BANK CHARGE'],
    interest: ['INTEREST', 'INT', 'CREDIT INTEREST', 'INTEREST PAID'],
    atm: ['ATM', 'WDL', 'WITHDRAWAL', 'CASH OUT'],
    cash_deposit: ['CASH DEPOSIT', 'DEPOSIT CASH', 'CASH DEP'],
    cheque_return: ['DISHONOUR', 'DISHONOURED', 'RETURNED', 'REVERSAL'],
    transfer: ['EFT', 'BPAY', 'OSKO', 'PAYID', 'DIRECT CREDIT', 'DIRECT DEBIT', 'TRANSFER', 'NPP'],
  } },
};

/** the fiscal year: 1 July to 30 June, written '2026-27' (the ATO writes "2026–27 income year") — ato.gov.au › Financial year */
const FISCAL_YEAR = { startMonth: 7, label: 'split' };

/**
 * ⭐ MOVE IN FROM XERO / QUICKBOOKS ONLINE (IM1, v1.38.0) — THE MAPPING TABLE, IN ONE PLACE, AS DATA. An Australian practice exports a client's
 * books and ChitBridge takes them in; this is where THEIR account type lands in OUR chart (a group key of GROUPS_AU), which of their system accounts
 * IS one of our role ledgers (debtors · creditors · the GST account), and which of their tax codes is which of our three supply kinds (TAX_AU.supplyKinds).
 * Sources: the Xero Accounting OpenAPI `Account.Type` / `SystemAccount` enums and the AU default tax types (developer.xero.com › Types and Codes); the
 * QBO `Account.AccountType` list (developer.intuit.com › AccountList report) and the AU GST codes (Simpler GST and the detailed list) — research record
 * chitbridge-web docs/research/XERO-QBO-EXPORTS-2026-10.md (IM0). The importer (api lib/move-in) reads this and guesses nothing of its own.
 *   groupFor(source, type)         → the group key, or null (a type with no home here — the row is SKIPPED and said, never guessed)
 *   roleFor(source, systemOrType)  → the role ledger their control account IS (Xero SystemAccount DEBTORS → 'debtors'; QBO type AccountsReceivable → 'debtors'), or null
 *   supplyKindFor(source, code)    → the supply-kind row (taxable · gst_free · input_taxed), null when the code means "no GST applies and nothing is reported"
 *                                    (BAS Excluded · Out of Scope · GST on Imports: not a supply kind — the line carries no tax and the importer says so), or
 *                                    undefined when the code is not one this table knows (the person picks)
 * ⚠️ A QBO Simpler-GST file carries `GST` · `GST free` · `Out of Scope` only; the detailed list is here too so an older file reads. Names are matched
 *    case- and space-insensitively; Xero's TaxType CODES (OUTPUT, INPUT …) and its display NAMES (GST on Income …) both resolve.
 */
const MOVE_IN_XERO = {
  accountTypes: {
    BANK: 'bank_accounts', CURRENT: 'current_assets', CURRLIAB: 'current_liabilities', DEPRECIATN: 'non_current_assets', DIRECTCOSTS: 'cost_of_sales',
    EQUITY: 'equity', EXPENSE: 'operating_expenses', FIXED: 'non_current_assets', INVENTORY: 'inventory', LIABILITY: 'current_liabilities',
    NONCURRENT: 'non_current_assets', OTHERINCOME: 'other_income', OVERHEADS: 'operating_expenses', PREPAYMENT: 'advances', REVENUE: 'sales',
    SALES: 'sales', TERMLIAB: 'non_current_liabilities', PAYG: 'gst_and_statutory',
  },
  /* Xero SystemAccount → the role ledger it IS. GST: Xero keeps ONE net GST account; its balance lands on GST collected (BAS 1A) and the importer says so. */
  systemAccounts: { DEBTORS: 'debtors', CREDITORS: 'creditors', GST: 'gst_collected', RETAINEDEARNINGS: 'retained', ROUNDING: 'round_off', WAGEPAYABLES: 'wages_payable' },
  /* TaxType code or display name → supply kind id; null = no GST and not reported (not a supply kind) */
  taxCodes: {
    OUTPUT: 'taxable', INPUT: 'taxable', 'GST ON INCOME': 'taxable', 'GST ON EXPENSES': 'taxable', 'GST ON CAPITAL': 'taxable', CAPEXINPUT: 'taxable',
    EXEMPTOUTPUT: 'gst_free', EXEMPTEXPENSES: 'gst_free', EXEMPTCAPITAL: 'gst_free', EXEMPTEXPORT: 'gst_free', 'GST FREE INCOME': 'gst_free', 'GST FREE EXPENSES': 'gst_free',
    'GST FREE CAPITAL': 'gst_free', 'GST FREE EXPORTS': 'gst_free',
    INPUTTAXED: 'input_taxed', 'INPUT TAXED': 'input_taxed',
    BASEXCLUDED: null, 'BAS EXCLUDED': null, GSTONIMPORTS: null, 'GST ON IMPORTS': null,
  },
  cite: 'developer.xero.com › Types and Codes (Account types, System accounts, AU tax types); XeroAPI OpenAPI Account.Type / SystemAccount',
};
const MOVE_IN_QBO = {
  accountTypes: {
    BANK: 'bank_accounts', ACCOUNTSRECEIVABLE: 'trade_debtors', OTHERCURRENTASSET: 'current_assets', FIXEDASSET: 'non_current_assets', OTHERASSET: 'non_current_assets',
    ACCOUNTSPAYABLE: 'trade_creditors', CREDITCARD: 'current_liabilities', OTHERCURRENTLIABILITY: 'current_liabilities', LONGTERMLIABILITY: 'non_current_liabilities',
    EQUITY: 'equity', INCOME: 'sales', OTHERINCOME: 'other_income', COSTOFGOODSSOLD: 'cost_of_sales', EXPENSE: 'operating_expenses', OTHEREXPENSE: 'operating_expenses',
    /* the Account List report writes the type with spaces ("Accounts receivable (A/R)", "Other Current Assets"): normalised to the keys above by typeKey_ */
  },
  /* a QBO TYPE that IS one of our role ledgers (QBO has no SystemAccount flag; the type says it) */
  systemAccounts: { ACCOUNTSRECEIVABLE: 'debtors', ACCOUNTSPAYABLE: 'creditors' },
  taxCodes: {
    GST: 'taxable', 'GST ON CAPITAL': 'taxable', 'GST ON NON-CAPITAL': 'taxable', 'GST ON NONCAPITAL': 'taxable',
    'GST FREE': 'gst_free', 'GST-FREE': 'gst_free', 'GST FREE EXPORT': 'gst_free', 'GST-FREE CAPITAL': 'gst_free', 'GST FREE CAPITAL': 'gst_free', 'GST-FREE NON-CAPITAL': 'gst_free', 'GST FREE NON-CAPITAL': 'gst_free',
    'INPUT TAX': 'input_taxed', 'INPUT TAXED': 'input_taxed',
    'OUT OF SCOPE': null,
  },
  cite: 'developer.intuit.com › AccountList report account_type values; Intuit AU "Setting up GST" (detailed codes) and "Simpler GST" (GST · GST Free · Out of Scope)',
};
const MOVE_IN_SOURCES = { xero: MOVE_IN_XERO, qbo: MOVE_IN_QBO };
/** "Accounts receivable (A/R)" · "Other Current Liability" · "ACCPAY" → one key: letters and digits only, upper case, the bracketed part dropped */
function typeKey_(s) { return String(s == null ? '' : s).replace(/\([^)]*\)/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ''); }
/** the QBO Account List report writes the PLURAL ("Other Current Assets", "Fixed Assets", "Expenses", "Other Current Liabilities"); the API enum is singular — one key for both (v1.38.1) */
function singular_(k) { return k.replace(/IES$/, 'Y').replace(/S$/, ''); }
function lookup_(table, k) { if (Object.prototype.hasOwnProperty.call(table, k)) return table[k]; var s = singular_(k); return s !== k && Object.prototype.hasOwnProperty.call(table, s) ? table[s] : null; }
function codeKey_(s) { return String(s == null ? '' : s).toUpperCase().replace(/\s+/g, ' ').trim(); }
function sourceOf_(source) { var k = String(source == null ? '' : source).trim().toLowerCase(); return Object.prototype.hasOwnProperty.call(MOVE_IN_SOURCES, k) ? MOVE_IN_SOURCES[k] : null; }
function groupFor(source, type) { var s = sourceOf_(source); return s ? lookup_(s.accountTypes, typeKey_(type)) : null; }
function roleFor(source, sys) { var s = sourceOf_(source); return s ? lookup_(s.systemAccounts, typeKey_(sys)) : null; }
function supplyKindFor(source, code) {
  var s = sourceOf_(source); if (!s) return undefined;
  var k = codeKey_(code), k2 = k.replace(/-/g, ' ');
  var t = s.taxCodes;
  var id = Object.prototype.hasOwnProperty.call(t, k) ? t[k] : Object.prototype.hasOwnProperty.call(t, k2) ? t[k2] : undefined;
  if (id === undefined) return undefined;
  return id === null ? null : TAX_AU.supplyKinds[id];
}
const MOVE_IN = { sources: Object.keys(MOVE_IN_SOURCES), xero: MOVE_IN_XERO, qbo: MOVE_IN_QBO, groupFor: groupFor, roleFor: roleFor, supplyKindFor: supplyKindFor,
  cite: 'chitbridge-web docs/research/XERO-QBO-EXPORTS-2026-10.md (IM0, official sources only)' };

/**
 * ⭐ THE PACK — the regulation contract (regulation.js) in one object. The chart rows keep their top-level names (groups · ledgers · expense_classes ·
 * income_classes) because chart.js reads them there; `sch3` is the contract's NAME for the statement-line table — its content here is AASB 101's.
 */
/** v1.45.0 (FX1) — FOREIGN CURRENCY: which rate the tax value of a foreign-currency supply uses (data; the rate itself is evidence the owner enters or imports) */
const FX_AU = {
  standard: 'AASB 121: a foreign-currency transaction at the spot rate of its date; monetary items at the closing rate; differences to profit or loss',
  tax_rate_source: 'official',
  tax_rate_rule: 'GST Act s 9-85 (GST Regulations r 9-85.01): an ATO-accepted rate — the RBA rate, or a published bank rate used consistently — at the time the GST is attributed',
  official_name: 'RBA or another ATO-accepted rate',
};

const PACK = {
  id: 'AU', version: '1.0.0', name: 'Australia · GST', verified: false,
  country: 'AU', basis: 'AASB 101 statement lines · Division 40 ITAA 1997 · ATO BAS labels', currency: 'AUD',
  sch3: LINES_AU, groups: GROUPS_AU, ledgers: LEDGERS_AU,
  expense_classes: EXPENSE_CLASSES_AU, income_classes: INCOME_CLASSES_AU,
  asset_classes: ASSET_CLASSES_AU, entity_bases: ENTITY_BASES_AU,
  fiscalYear: FISCAL_YEAR,
  accountExtras: accountExtras,
  presentation: PRESENTATION, chart: CHART,
  depreciation: { assetClasses: ASSET_CLASSES_AU, entityBases: ENTITY_BASES_AU, compute: depreciationCompute },
  bank: BANK,
  cite: CITE, accrualPayableFor: accrualPayableFor,
  setOff: setOff, eventAliases: EVENT_ALIASES, messages: MESSAGES,
  taxHeads: TAX_HEADS, payHeads: TAX_HEADS, optionalHeads: [], taxLedgers: TAX_LEDGERS,
  voucherSeries: VOUCHER_SERIES_AU, manualSeries: MANUAL_SERIES_AU, voucherFormat: '{series}/{fy}/{n:6}',
  tax: TAX_AU,
  fx: FX_AU,
  /* v1.42.0 (CS2): the country's own locale (en-AU — 1,234,567.50 · 13/10/2026) and its IANA zones. Australia is MULTI-ZONE (three standard offsets, DST in the south-east only):
     the Country setup step ASKS which one, with the browser's zone preselected when it is one of these. Sydney first — the most populous, and the fallback when the browser's zone
     is not Australian. The list is the IANA canonical zones for AU (tzdata `zone1970.tab`): no aliases (Australia/Canberra, Australia/NSW …), so a stored value is always canonical. */
  locale: { format: 'en-AU', langs: ['en'], cur: ['AUD'] },
  timeZones: ['Australia/Sydney', 'Australia/Melbourne', 'Australia/Brisbane', 'Australia/Perth', 'Australia/Adelaide', 'Australia/Darwin', 'Australia/Hobart',
              'Australia/Broken_Hill', 'Australia/Lindeman', 'Australia/Eucla', 'Australia/Lord_Howe'],
  /* Australia's own rule functions (none is called by the core; the api / web read them by name) */
  abn: ABN, taxInvoice: taxInvoice, supplyKindOf: supplyKindOf,
  moveIn: MOVE_IN,                                                    /* v1.38.0 (IM1): Xero / QBO account types, system accounts and tax codes → this chart */
  /* v1.39.0 (BAS1): the return's own words — `short` is what a screen calls it, `authority` / `portal` where the shop lodges it (ChitBridge prepares, it does not lodge) */
  returns: { id: 'BAS', name: 'Business activity statement', short: 'BAS', authority: 'ATO', portal: 'ATO Online services for business', frequencies: ['quarterly', 'monthly'], labels: BAS_LABELS, periods: basPeriods, bas: bas },
  thresholds: { registration: TAX_AU.registration, monthly_from_minor: 2000000000, simpler_bas_below_minor: 1000000000,
                cite: 'GST Act 1999 s.23-15 (register at $75,000), s.27-15 (monthly tax periods from $20 million); ato.gov.au › Simpler BAS ($10 million)' },
  retentionYears: 5,   /* TAA 1953 Sch 1 s.382-5: keep records for five years; ato.gov.au › How long to keep your records */
  /* v1.48.0 (W2-BOOKS): the same number as a records table (the standard's `records` shape, as AE carries it) — five years from when the record was prepared or the transaction completed, whichever is later */
  records: { years: { standard: 5 }, cite: 'TAA 1953 Sch 1 s.382-5 (five years, from the later of preparing the record and completing the transaction); ato.gov.au › Records you need to keep › How long to keep your records' },
  /* v1.41.0 (CPS1): what this pack LEAVES OUT and why, in its own words — read by tools/country-matrix.cjs (docs/COUNTRY-STANDARD.md A10); a key names a member of the standard */
  scope: {
    out: {
      'tax.rcm': 'Div 84 reverse charge on imported services is a later round (docs/design/core-vs-packs/AU1-FOLLOW-UP.md §3)',
      payroll: 'PAYG withholding, superannuation guarantee and Single Touch Payroll are OUT OF SCOPE (this file\'s header) — named so they are not forgotten',
    },
    partial: {
      bank: 'amount prefixes and keywords only; no bank\'s CSV preset until a real statement is read (AU1 follow-up §3)',
    },
  },
};

const EXPORTS = PACK;

/* ⭐ ONE FILE, EVERY HOST: node takes module.exports; a page, the TV and the shop PC take window.CBRegAU. */
if (typeof module !== 'undefined' && module.exports) module.exports = EXPORTS;
if (root && typeof root.window !== 'undefined') root.window.CBRegAU = EXPORTS;
})(typeof globalThis !== 'undefined' ? globalThis : this);

/* ADOPTED from chitbridge-engines v1.48.1 · reg-ae · sha256 469e5f4c5064049cf6e7a7e400b98eb88e5446e273acafddde29e009dc814128 — DO NOT EDIT HERE. Change it in chitbridge-engines, release a version, then run tools/adopt.cjs. */
/* chitbridge-engines · reg-ae. Edited ONLY in chitbridge-engines/src/reg-ae.js; every platform adopts a released version of it. */
(function (root) {
'use strict';
// @stage tested
// @stage-note [BOOKS · REGULATION PACK] United Arab Emirates: the chart of accounts, IFRS-style statement lines, VAT (5%, zero-rated and exempt supply kinds), the TRN
// @stage-note format, the FTA tax-invoice particulars (full and simplified), the VAT201 boxes read from posted ledgers, tax periods and the 28th-day due date.
// @stage-note DATA first, small rule functions beside it — the SHAPE of reg-au, not its content. Every rule cites the article it was read from.
/**
 * reg-ae.js — THE UNITED ARAB EMIRATES REGULATION PACK (round AE1, v1.37.0, 2026-10-12).
 *
 * Owner, 2026-10-12: "segregate India and Australia and we should be able to add other countries as a selection list very quickly, next is UAE".
 * A country is ONE pack registered in regulation.js (one line in BUILT_IN_); the accounting core knows no country. This file holds what is UAE LAW
 * and not accounting principle, and NOTHING that is not in the research record: chitbridge-web docs/research/UAE-VAT-FACTS-2026-10.md (round AE0,
 * official sources only — the FTA's consolidated Decree-Law and Executive Regulation, the FTA returns guide, the MoF e-invoicing decisions).
 * Short names in the comments below are that file's: DL = Federal Decree-Law No. 8 of 2017 on VAT as amended to FDL 16 of 2024
 * (https://tax.gov.ae/Datafolder/Files/Legislation/2025/Federal-Decree-Law-No-8-of-2017-and-amendments.pdf); ER = Cabinet Decision No. 52 of 2017,
 * the Executive Regulation, as amended to CD 100 of 2024 (https://tax.gov.ae/Datafolder/Files/Legislation/Executive%20Regulation%20of%20Federal%20Decree%20Law%20No%208%20of%202017%20-%20Publish%20-%2004%2010%202024.pdf);
 * TPL = Federal Decree-Law No. 28 of 2022 on Tax Procedures (https://tax.gov.ae/Datafolder/Files/Legislation/2025/Federal%20Decree-Law%20No.%2028%20of%202022%20-%20publishing%2003%2012%202025.pdf);
 * TPL-ER = Cabinet Decision No. 74 of 2023 (https://tax.gov.ae/Datafolder/Files/Legislation/Cabinet%20Decision%20No.%2074%20of%202023%20on%20Executive%20Regulation%20of%20Federal%20Decree-Law%20No.%2028%20of%202022%20on%20Tax%20Procedures%20-%20For%20Publishing.pdf);
 * RET = FTA "VAT User Guide | Returns", Aug 2021 (https://tax.gov.ae/DataFolder/Files/Pdf/VAT%20Returns%20User%20GuideEnglishV40%2015%2008%202021%20SEP2021.pdf);
 * EI-MF = MoF "UAE Electronic Invoice Mandatory Fields" v1.0 (https://mof.gov.ae/wp-content/uploads/2026/02/UAE-Electronic-Invoice-mandatory-fields_V-1.0-23Feb2026.pdf);
 * EI-GL = MoF "UAE Electronic Invoicing Guidelines" v1.1 (https://mof.gov.ae/wp-content/uploads/2026/06/UAE-Electronic-Invoicing-Guidelines_V-1.1-01June2026.pdf);
 * MD243 / MD244 / MD66 / CD106 = the MoF e-invoicing decisions (URLs on each row below); CTL = Federal Decree-Law No. 47 of 2022 on Corporate Tax
 * (https://mof.gov.ae/wp-content/uploads/2026/01/Federal-Decree-Law-No.-47-of-2022-and-its-amendments-en-v13.1.26.pdf); DZ = the FTA's Designated Zones list
 * (https://tax.gov.ae/-/media/Files/FTA/links/Legislation/VAT/ar/05-designated-zones.pdf).
 *
 * ⚠️ `verified: false` until a UAE accountant has read it — the articles are as consolidated when written (2026-10); the FTA's text is the authority, this
 *    file is the record of it.
 * ⚠️ WHAT THE PACK LEAVES OUT, because the research found no official text for it (AE0 §14) — nothing below invents it:
 *    · a TRN check digit or fixed prefix (trn.check is a 15-digit FORMAT check only);
 *    · the Emirate sub-box letters 1a–1g of the return (Box 1 is answered for ONE Emirate, the one handed in, and says so);
 *    · the four Designated Zones that take the FTA's count from 23 to 27 (the 23 named ones are data; the count note says 27);
 *    · the reporting-to-FTA window for e-invoices (MD243 Art. 6(6): "within the timeline prescribed by the Minister", not yet fixed);
 *    · Cabinet decisions adding reverse-charge categories under DL Art. 48(8) (only the three categories in the Decree-Law itself are rows);
 *    · the VAT administrative-penalty amounts (Cabinet Decision 40 of 2017 as amended — not fetched);
 *    · Arabic terms: the research quotes English only, so no `label_ar` is carried yet; when an Arabic-reading accountant supplies them they sit BESIDE
 *      each English `label` (structure, never a mirrored second table), as plain strings with no bidi control marks (an LTR page must not carry U+200F).
 *    OUT OF SCOPE (later rounds, said by name): tax.determine does not yet assess UAE reverse charge on a purchase (the ledger `rcm_vat`, the return's
 *    Boxes 3 and 10 and the `rcm.categories` data are ready for it); the Profit Margin Scheme; the Tax Refunds for Tourists Scheme (Box 2); input-tax
 *    apportionment and the capital assets scheme (Box 9 adjustments); Designated-Zone supplies; Corporate Tax COMPUTATION (the payable ledger and the
 *    rate bands are present, nothing posts to them); e-invoice GENERATION (PINT-AE) — the mandate's dates and scope are data here.
 *
 * The shape a pack must have is written and checked in regulation.js (CBRegulation.validate); packs/TEMPLATE.md walks every member.
 *
 * ── ZERO DEPENDENCIES · DATA (and small rule functions) · NO CLOCK ──────────────────────────────────────────
 */

/* ── the statement lines — 'bs' | 'pl' — IFRS wording: IAS 1 Presentation of Financial Statements paras 54 (financial position) and 82 / 102 (profit or loss, by nature). The UAE prescribes no statutory statement form (no Schedule III); Corporate Tax starts from accounting income (CTL) ── */
const LINES_AE = {
  ppe:                    { st: 'bs', side: 'assets',      label: 'Property, plant and equipment' },
  investments:            { st: 'bs', side: 'assets',      label: 'Investments' },
  inventories:            { st: 'bs', side: 'assets',      label: 'Inventories' },
  trade_receivables:      { st: 'bs', side: 'assets',      label: 'Trade and other receivables' },
  cash:                   { st: 'bs', side: 'assets',      label: 'Cash and cash equivalents' },
  other_current_assets:   { st: 'bs', side: 'assets',      label: 'Other current assets' },
  equity:                 { st: 'bs', side: 'equity',      label: "Share capital / Owner's equity" },
  retained_earnings:      { st: 'bs', side: 'equity',      label: 'Retained earnings' },
  borrowings:             { st: 'bs', side: 'liabilities', label: 'Borrowings' },
  trade_payables:         { st: 'bs', side: 'liabilities', label: 'Trade and other payables' },
  tax_liabilities:        { st: 'bs', side: 'liabilities', label: 'VAT and other tax liabilities' },
  other_current_liabilities: { st: 'bs', side: 'liabilities', label: 'Other current liabilities' },
  provisions:             { st: 'bs', side: 'liabilities', label: 'Provisions' },
  suspense:               { st: 'bs', side: 'liabilities', label: 'Suspense (must be nil at close)' },
  revenue:                { st: 'pl', side: 'income',      label: 'Revenue' },
  other_income:           { st: 'pl', side: 'income',      label: 'Other income' },
  cost_of_sales:          { st: 'pl', side: 'expense',     label: 'Cost of sales' },
  changes_inventories:    { st: 'pl', side: 'expense',     label: 'Changes in inventories' },
  employee_benefits:      { st: 'pl', side: 'expense',     label: 'Employee benefits expense' },
  finance_costs:          { st: 'pl', side: 'expense',     label: 'Finance costs' },
  depreciation:           { st: 'pl', side: 'expense',     label: 'Depreciation and amortisation expense' },
  income_tax:             { st: 'pl', side: 'expense',     label: 'Income tax expense (Corporate Tax)' },
  other_expenses:         { st: 'pl', side: 'expense',     label: 'Other expenses' },
};

/* ── the chart's groups: the code ranges keep reg-in's and reg-au's numbering (1xxx assets · 2xxx liabilities · 3xxx equity · 4xxx income · 5xxx cost of sales · 6xxx operating expenses) so an accountant moving a client in reads the same shape ── */
const GROUPS_AE = [
  /* ── primary ── */
  { code: 'equity',                  name: 'Equity',                        type: 'personal', nature: 'equity',    side: 'cr', parent: null,                      range: [3000, 3199], line: 'equity' },
  { code: 'current_assets',          name: 'Current assets',                type: 'real',     nature: 'asset',     side: 'dr', parent: null,                      range: [1800, 1899], line: 'other_current_assets' },
  { code: 'current_liabilities',     name: 'Current liabilities',           type: 'personal', nature: 'liability', side: 'cr', parent: null,                      range: [2400, 2899], line: 'other_current_liabilities' },
  { code: 'non_current_assets',      name: 'Non-current assets',            type: 'real',     nature: 'asset',     side: 'dr', parent: null,                      range: [1000, 1099], line: 'ppe' },
  { code: 'investments',             name: 'Investments',                   type: 'real',     nature: 'asset',     side: 'dr', parent: null,                      range: [1100, 1199], line: 'investments' },
  { code: 'non_current_liabilities', name: 'Non-current liabilities',       type: 'personal', nature: 'liability', side: 'cr', parent: null,                      range: [2030, 2099], line: 'borrowings' },
  { code: 'suspense',                name: 'Suspense',                      type: 'personal', nature: 'liability', side: 'cr', parent: null,                      range: [2900, 2999], line: 'suspense' },
  { code: 'cost_of_sales',           name: 'Cost of sales',                 type: 'nominal',  nature: 'expense',   side: 'dr', parent: null,                      range: [5100, 5999], line: 'cost_of_sales' },
  { code: 'other_income',            name: 'Other income',                  type: 'nominal',  nature: 'income',    side: 'cr', parent: null,                      range: [4200, 4999], line: 'other_income' },
  { code: 'operating_expenses',      name: 'Operating expenses',            type: 'nominal',  nature: 'expense',   side: 'dr', parent: null,                      range: [6000, 6999], line: 'other_expenses' },
  { code: 'purchases',               name: 'Purchases',                     type: 'nominal',  nature: 'expense',   side: 'dr', parent: null,                      range: [5000, 5099], line: 'cost_of_sales' },
  { code: 'sales',                   name: 'Revenue',                       type: 'nominal',  nature: 'income',    side: 'cr', parent: null,                      range: [4000, 4199], line: 'revenue' },
  /* ── sub-groups ── */
  { code: 'bank_accounts',           name: 'Bank accounts',                 type: 'real',     nature: 'asset',     side: 'dr', parent: 'current_assets',          range: [1500, 1599], line: 'cash' },
  { code: 'bank_overdraft',          name: 'Bank overdraft',                type: 'personal', nature: 'liability', side: 'cr', parent: 'non_current_liabilities', range: [2020, 2029], line: 'borrowings' },
  { code: 'cash_on_hand',            name: 'Cash on hand',                  type: 'real',     nature: 'asset',     side: 'dr', parent: 'current_assets',          range: [1400, 1499], line: 'cash' },
  { code: 'deposits',                name: 'Deposits',                      type: 'real',     nature: 'asset',     side: 'dr', parent: 'current_assets',          range: [1600, 1699], line: 'other_current_assets' },
  { code: 'tax_liabilities',         name: 'VAT and tax liabilities',       type: 'personal', nature: 'liability', side: 'cr', parent: 'current_liabilities',     range: [2200, 2299], line: 'tax_liabilities' },
  { code: 'advances',                name: 'Advances and prepayments',      type: 'personal', nature: 'asset',     side: 'dr', parent: 'current_assets',          range: [1700, 1799], line: 'other_current_assets' },
  { code: 'provisions',              name: 'Provisions',                    type: 'personal', nature: 'liability', side: 'cr', parent: 'current_liabilities',     range: [2300, 2399], line: 'provisions' },
  { code: 'retained_earnings',       name: 'Retained earnings',             type: 'personal', nature: 'equity',    side: 'cr', parent: 'equity',                  range: [3200, 3999], line: 'retained_earnings' },
  { code: 'loans',                   name: 'Loans',                         type: 'personal', nature: 'liability', side: 'cr', parent: 'non_current_liabilities', range: [2000, 2019], line: 'borrowings' },
  { code: 'inventory',               name: 'Inventory',                     type: 'real',     nature: 'asset',     side: 'dr', parent: 'current_assets',          range: [1200, 1299], line: 'inventories' },
  { code: 'trade_creditors',         name: 'Trade payables',                type: 'personal', nature: 'liability', side: 'cr', parent: 'current_liabilities',     range: [2100, 2199], line: 'trade_payables' },
  { code: 'trade_debtors',           name: 'Trade receivables',             type: 'personal', nature: 'asset',     side: 'dr', parent: 'current_assets',          range: [1300, 1399], line: 'trade_receivables' },
];

/**
 * ⭐ THE LEDGERS THE POSTING RULES NAME (by role) — every role regulation.REQUIRED_ROLES lists, plus the UAE's own. A customer is a line on `debtors`
 * carrying the party's id, a supplier a line on `creditors` (sub-ledgers, as in reg-in).
 * VAT: ONE head — `output_vat` (Due Tax, VAT201 Boxes 1 and 12) and `input_vat` (Recoverable Tax, Boxes 9 and 13). `rcm_vat` is the Due Tax a
 * registrant accounts for on a supply to himself (DL Art. 48(1): an import of Concerned Goods or Services "shall be treated as making a Taxable Supply to
 * himself, and shall be responsible for … accounting for Due Tax" — Box 3); its recovery lands on `input_vat` (Box 10). `corporate_tax_payable` is PRESENT so
 * the books have the slot (CTL Art. 48: settle "within (9) nine months from the end of the relevant Tax Period"); nothing posts to it — the computation is
 * a later round. `sales_zero_rated` · `sales_export` · `sales_exempt` · `purchases_reverse_charge` are present so Boxes 3, 4 and 5 can be READ from posted
 * ledgers when a shop posts there; the counter's posting rules land every sale on `sales` by rate, so they stay nil until a rule or a manual entry uses them.
 */
const LEDGERS_AE = [
  { role: 'stock',                    code: '1200', name: 'Inventory on hand',                             group: 'inventory' },
  { role: 'ppe_buildings',            code: '1010', name: 'Buildings',                                     group: 'non_current_assets' },
  { role: 'accdep_buildings',         code: '1011', name: 'Accumulated depreciation — buildings',          group: 'non_current_assets' },
  { role: 'ppe_plant',                code: '1020', name: 'Plant and equipment',                           group: 'non_current_assets' },
  { role: 'accdep_plant',             code: '1021', name: 'Accumulated depreciation — plant and equipment', group: 'non_current_assets' },
  { role: 'ppe_furniture',            code: '1030', name: 'Furniture and fittings',                        group: 'non_current_assets' },
  { role: 'accdep_furniture',         code: '1031', name: 'Accumulated depreciation — furniture and fittings', group: 'non_current_assets' },
  { role: 'ppe_vehicles',             code: '1040', name: 'Motor vehicles',                                group: 'non_current_assets' },
  { role: 'accdep_vehicles',          code: '1041', name: 'Accumulated depreciation — motor vehicles',     group: 'non_current_assets' },
  { role: 'ppe_office',               code: '1050', name: 'Office equipment',                              group: 'non_current_assets' },
  { role: 'accdep_office',            code: '1051', name: 'Accumulated depreciation — office equipment',   group: 'non_current_assets' },
  { role: 'ppe_computers',            code: '1060', name: 'Computers',                                     group: 'non_current_assets' },
  { role: 'accdep_computers',         code: '1061', name: 'Accumulated depreciation — computers',          group: 'non_current_assets' },
  { role: 'debtors',                  code: '1300', name: 'Customers (Trade receivables)',                 group: 'trade_debtors' },
  { role: 'cash',                     code: '1400', name: 'Cash on hand',                                  group: 'cash_on_hand' },
  { role: 'bank',                     code: '1500', name: 'Business bank account',                         group: 'bank_accounts' },
  { role: 'card',                     code: '1520', name: 'Card settlements',                              group: 'bank_accounts' },
  { role: 'prepaid_expenses',         code: '1810', name: 'Prepayments',                                   group: 'current_assets' },
  { role: 'accrued_income',           code: '1820', name: 'Accrued income',                                group: 'current_assets' },
  { role: 'supplier_advance',         code: '1700', name: 'Advances to suppliers',                         group: 'advances' },
  { role: 'creditors',                code: '2100', name: 'Suppliers (Trade payables)',                    group: 'trade_creditors' },
  { role: 'secured_loan',             code: '2000', name: 'Secured loans',                                 group: 'loans' },
  { role: 'unsecured_loan',           code: '2010', name: 'Unsecured loans',                               group: 'loans' },
  { role: 'bank_od',                  code: '2020', name: 'Bank overdraft',                                group: 'bank_overdraft' },
  /* DL Art. 2 and 3: tax on every Taxable Supply at 5% — Output VAT (Due Tax, RET Box 1 / 12); DL Art. 54: Recoverable Tax — Input VAT (RET Box 9 / 13) */
  { role: 'output_vat',               code: '2200', name: 'Output VAT',                                    group: 'tax_liabilities' },
  { role: 'input_vat',                code: '2210', name: 'Input VAT',                                     group: 'tax_liabilities' },
  /* DL Art. 48(1): the registrant accounts for Due Tax on an import of Concerned Goods or Services as a supply to himself — RET Box 3 (recovered in Box 10 on input_vat) */
  { role: 'rcm_vat',                  code: '2220', name: 'VAT due under reverse charge',                  group: 'tax_liabilities' },
  /* PRESENT, UNUSED until the Corporate Tax round: CTL Art. 3 (0% to AED 375,000, 9% above — Cabinet Decision 116 of 2022), Art. 48 (payable within 9 months of the Tax Period) */
  { role: 'corporate_tax_payable',    code: '2230', name: 'Corporate tax payable',                         group: 'tax_liabilities' },
  { role: 'customer_advance',         code: '2400', name: 'Customer deposits (advances)',                  group: 'current_liabilities' },
  { role: 'accrued_expenses',         code: '2410', name: 'Accrued expenses',                              group: 'current_liabilities' },
  { role: 'wages_payable',            code: '2420', name: 'Wages and salaries payable',                    group: 'current_liabilities' },
  { role: 'income_in_advance',        code: '2430', name: 'Income received in advance',                    group: 'current_liabilities' },
  { role: 'suspense',                 code: '2900', name: 'Suspense',                                      group: 'suspense' },
  { role: 'capital',                  code: '3000', name: "Owner's capital / Share capital",               group: 'equity' },
  { role: 'drawings',                 code: '3100', name: 'Drawings',                                      group: 'equity' },
  { role: 'retained',                 code: '3900', name: 'Retained earnings',                             group: 'retained_earnings' },
  { role: 'sales',                    code: '4000', name: 'Sales (standard-rated)',                        group: 'sales' },
  /* RET Box 4 (zero-rated supplies, DL Art. 45) — exports are head 1 of Art. 45, kept on their own ledger so they can be read apart */
  { role: 'sales_zero_rated',         code: '4010', name: 'Zero-rated sales',                              group: 'sales' },
  { role: 'sales_export',             code: '4020', name: 'Export sales (zero-rated)',                     group: 'sales' },
  /* RET Box 5 (exempt supplies, DL Art. 46) */
  { role: 'sales_exempt',             code: '4030', name: 'Exempt sales',                                  group: 'sales' },
  { role: 'sales_returns',            code: '4090', name: 'Sales returns and allowances',                  group: 'sales' },
  { role: 'interest_received',        code: '4200', name: 'Interest received',                             group: 'other_income' },
  { role: 'gain_on_disposal',         code: '4250', name: 'Gain on disposal of assets',                    group: 'other_income' },
  { role: 'fx_gain_loss',             code: '4260', name: 'Foreign exchange gain or loss',                 group: 'other_income' },   /* v1.45.0 (FX1): IAS 21 ¶28/¶23 */
  { role: 'purchases',                code: '5000', name: 'Purchases',                                     group: 'purchases' },
  /* RET Box 3 (the net value of supplies received under reverse charge) — nil until a shop posts the base of such a purchase here */
  { role: 'purchases_reverse_charge', code: '5010', name: 'Purchases under reverse charge (imports)',      group: 'purchases' },
  { role: 'purchase_returns',         code: '5090', name: 'Purchase returns',                              group: 'purchases' },
  { role: 'changes_in_inventories',   code: '5050', name: 'Changes in inventories',                        group: 'purchases', line: 'changes_inventories' },
  { role: 'discount_allowed',         code: '6800', name: 'Discounts allowed',                             group: 'operating_expenses' },
  { role: 'bad_debts',                code: '6850', name: 'Bad debts written off',                         group: 'operating_expenses' },
  { role: 'depreciation',             code: '6200', name: 'Depreciation',                                  group: 'operating_expenses', line: 'depreciation' },
  { role: 'loss_on_disposal',         code: '6210', name: 'Loss on disposal of assets',                    group: 'operating_expenses' },
  /* PRESENT, UNUSED: the Corporate Tax charge of the year (IAS 1 para 82(d) tax expense) — posted by a manual entry until the Corporate Tax round */
  { role: 'corporate_tax_expense',    code: '6300', name: 'Corporate tax expense',                         group: 'operating_expenses', line: 'income_tax' },
  { role: 'round_off',                code: '6900', name: 'Rounding',                                      group: 'operating_expenses' },
];

/** what a shop pays for that is not stock — the drawer's "expense" chit carries one of these */
const EXPENSE_CLASSES_AE = [
  { role: 'wages',           code: '5100', name: 'Wages',                                   group: 'cost_of_sales',      line: 'employee_benefits' },
  { role: 'freight_inward',  code: '5110', name: 'Freight inwards',                         group: 'cost_of_sales' },
  { role: 'packing',         code: '5120', name: 'Packaging',                               group: 'cost_of_sales' },
  { role: 'rent',            code: '6010', name: 'Rent',                                    group: 'operating_expenses' },
  { role: 'salary',          code: '6020', name: 'Salaries',                                group: 'operating_expenses', line: 'employee_benefits' },
  { role: 'end_of_service',  code: '6025', name: 'End-of-service benefits',                 group: 'operating_expenses', line: 'employee_benefits' },
  { role: 'electricity',     code: '6030', name: 'Electricity and water',                   group: 'operating_expenses' },
  { role: 'telephone',       code: '6040', name: 'Telephone and internet',                  group: 'operating_expenses' },
  { role: 'transport',       code: '6050', name: 'Freight and delivery',                    group: 'operating_expenses' },
  { role: 'repairs',         code: '6060', name: 'Repairs and maintenance',                 group: 'operating_expenses' },
  { role: 'stationery',      code: '6070', name: 'Printing and stationery',                 group: 'operating_expenses' },
  { role: 'fuel',            code: '6080', name: 'Motor vehicle expenses',                  group: 'operating_expenses' },
  { role: 'bank_charges',    code: '6090', name: 'Bank and merchant fees',                  group: 'operating_expenses', line: 'finance_costs' },
  { role: 'commission_paid', code: '6100', name: 'Commission paid',                         group: 'operating_expenses' },
  { role: 'advertising',     code: '6110', name: 'Advertising',                             group: 'operating_expenses' },
  { role: 'professional',    code: '6120', name: 'Accounting and legal fees',               group: 'operating_expenses' },
  { role: 'staff_welfare',   code: '6130', name: 'Staff welfare',                           group: 'operating_expenses', line: 'employee_benefits' },
  { role: 'insurance',       code: '6140', name: 'Insurance',                               group: 'operating_expenses' },
  { role: 'interest_paid',   code: '6150', name: 'Interest paid',                           group: 'operating_expenses', line: 'finance_costs' },
  { role: 'licence_fees',    code: '6160', name: 'Trade licence and government fees',       group: 'operating_expenses' },
  { role: 'sundry_expense',  code: '6190', name: 'Sundry expenses',                         group: 'operating_expenses' },
];

/** money that comes in and is not a sale — the `income` chit's classes. interest_received IS the ledger 4200. */
const INCOME_CLASSES_AE = [
  { role: 'interest_received',   code: '4200', name: 'Interest received',   group: 'other_income' },
  { role: 'commission_received', code: '4210', name: 'Commission received', group: 'other_income' },
  { role: 'rent_received',       code: '4220', name: 'Rent received',       group: 'other_income' },
  { role: 'discount_received',   code: '4230', name: 'Discounts received',  group: 'other_income' },
  { role: 'scrap_sales',         code: '4240', name: 'Scrap sales',         group: 'other_income' },
  { role: 'sundry_income',       code: '4290', name: 'Sundry income',       group: 'other_income' },
];

/**
 * ⭐ DEPRECIATION AS DATA — IFRS (IAS 16 Property, Plant and Equipment). The UAE has NO tax depreciation table in the research record: Corporate Tax takes
 * accounting income (CTL), and IAS 16 paras 50–62 make the useful life, the residual value and the method the ENTITY's own estimates. So the lives below are
 * POLICY DEFAULTS a shop edits, not law — `policy: true` on every row says so. Straight-line on cost less residual value (IAS 16 para 62), pro rata by days
 * from the date the asset is available for use (para 55). Nothing here cites a UAE statute because none was found; the VAT facts file carries no depreciation rule.
 */
const ASSET_CLASSES_AE = [
  { class: 'buildings', cost_role: 'ppe_buildings', acc_role: 'accdep_buildings', life: 25, policy: true, cite: 'IAS 16 paras 50–62: the useful life is the entity\'s estimate — a default, not law' },
  { class: 'plant',     cost_role: 'ppe_plant',     acc_role: 'accdep_plant',     life: 10, policy: true, cite: 'IAS 16 paras 50–62: a default, not law' },
  { class: 'furniture', cost_role: 'ppe_furniture', acc_role: 'accdep_furniture', life: 5,  policy: true, cite: 'IAS 16 paras 50–62: a default, not law' },
  { class: 'vehicles',  cost_role: 'ppe_vehicles',  acc_role: 'accdep_vehicles',  life: 5,  policy: true, cite: 'IAS 16 paras 50–62: a default, not law' },
  { class: 'office',    cost_role: 'ppe_office',    acc_role: 'accdep_office',    life: 5,  policy: true, cite: 'IAS 16 paras 50–62: a default, not law' },
  { class: 'computers', cost_role: 'ppe_computers', acc_role: 'accdep_computers', life: 3,  policy: true, cite: 'IAS 16 paras 50–62: a default, not law' },
];
/** every entity type follows IAS 16 straight-line (a company, a sole establishment, a partnership); the owner-capital bases are the sole establishment and the partnership */
const ENTITY_BASES_AE = {
  company:            { basis: 'ias16', methods: ['slm'], prorata: 'days' },
  sole_establishment: { basis: 'ias16', methods: ['slm'], prorata: 'days' },
  partnership:        { basis: 'ias16', methods: ['slm'], prorata: 'days' },
};

/* ── the UAE tax pack (the VAT Decree-Law and its Executive Regulation): the object tax-packs.PACKS.AE is ── */
const TAX_AE = Object.freeze({
    country: 'AE',
    scheme: 'VAT',
    /* the border decides, never an Emirate: one head on a domestic supply; across the border nothing is charged — an export is zero-rated (DL Art. 45(1)) and the
       recipient accounts for an import (DL Art. 48(1)); a supply treated as made in another Implementing State carries no tax and is not labelled "Tax Invoice" (DL Art. 66) */
    supply: 'border',
    rates: Object.freeze([0, 5]),
    standard_rate: 5,                                    /* DL Art. 3: "a standard rate of 5% Tax shall be imposed on any supply or Import" */
    /* ER Art. 61 "Fractions of Fils": tax calculated to a fraction of a fils may be rounded "to the nearest Fils on a mathematical rounding", PER SUPPLY (each line) — permitted,
       not required; RET §3.2: the return takes amounts to the nearest fils. The total is the sum of its fils-rounded lines; a declared rounding amount belongs only in the
       e-invoice's document-level field (EI-GL Appendix note 5). money.round is that half-up rounder. */
    invoice_round_to: 0.01,
    line_tax_rounding: 'half_up_to_fils',
    /* DL Art. 69: a supply in another currency is converted to AED "according to the exchange rate approved by the Central Bank of the State at the date of supply";
       ER Art. 59(1)(k): the rate of exchange applied is printed on the invoice */
    fx_source: 'UAE Central Bank rate at the date of supply (DL Art. 69); the rate applied is printed on the invoice (ER Art. 59(1)(k))',
    /**
     * ⭐ THE SUPPLY KINDS AS DATA. A line names its kind (`supply_kind`); tax.determine reads this table and puts the kind's rate on the line, saying WHY in the invoice's
     * notes and in `_cb.kinds` (`box` is the VAT201 box the supply is reported in — RET Boxes 1, 4, 5). `credit` is whether the input tax on what was bought to make the
     * supply is recoverable. A line that names no kind is standard-rated at its own rate. "Out of scope" is NOT a category the Decree-Law defines (AE0 §3: tax is imposed
     * on Taxable and Deemed Supplies and Imports, DL Art. 2; anything else is outside Art. 2) — so it is not a kind here; such a line is simply not billed with VAT.
     */
    supplyKinds: Object.freeze({
      standard:   Object.freeze({ id: 'standard',   name: 'Standard-rated supply', rate: 5, credit: true,  box: '1',
                                  why: 'VAT at the standard rate of 5% (DL Art. 3).', cite: 'DL Art. 3' }),
      zero_rated: Object.freeze({ id: 'zero_rated', name: 'Zero-rated supply',     rate: 0, credit: true,  box: '4',
                                  why: 'Zero-rated: VAT at 0% on this line, and the input tax on what was bought to make it is still recoverable (DL Art. 45 — exports outside the Implementing States, international transport, the first supply of residential buildings within three years, education and basic healthcare, investment precious metals, crude oil and natural gas; conditions in ER Arts. 30–41).',
                                  cite: 'DL Art. 45 (as amended by DL 18 of 2022); ER Arts. 30–41; RET Box 4' }),
      exempt:     Object.freeze({ id: 'exempt',     name: 'Exempt supply',         rate: 0, credit: false, box: '5',
                                  why: 'Exempt: no VAT on this line, and the input tax on what was bought to make it is not recoverable (DL Art. 46 — specified financial services, residential buildings not zero-rated, bare land, local passenger transport; ER Arts. 42–45).',
                                  cite: 'DL Art. 46; ER Arts. 42–45; RET Box 5' }),
    }),
    /**
     * ⭐ TAX INVOICES — DL Art. 65(1): "A Registrant making a Taxable Supply shall issue an original Tax Invoice"; DL Art. 67: within 14 days of the date of supply.
     * ER Art. 59(5): a SIMPLIFIED tax invoice may be issued (not under reverse charge) where the recipient is not a Registrant, or is a Registrant and the
     * Consideration does not exceed AED 10,000; ER Art. 59(13)(1): a simplified invoice is issued on the date of supply. ER Art. 59(3): none is required for a
     * wholly zero-rated supply when sufficient records are kept. The particulars are in taxInvoice() below.
     */
    taxInvoice: Object.freeze({
      simplified_upto_minor: 1000000,                    /* AED 10,000 — ER Art. 59(5)(b) */
      within_days: 14,                                   /* DL Art. 67 */
      summary_within_days_of_month_end: 14,              /* ER Art. 59(13): a summary invoice within 14 days of the end of the calendar month */
      cite: 'DL Art. 65(1), Art. 67; ER Art. 59(1) (full), 59(2) (simplified), 59(3), 59(5), 59(6), 59(13)',
    }),
    /** when a business must (or may) register — ER Art. 7(1): mandatory at AED 375,000; ER Art. 8(1): voluntary at AED 187,500 (supplies OR taxable expenses); DL Art. 13(2): a non-resident with no other person liable registers with no threshold */
    registration: Object.freeze({ mandatory_minor: 37500000, voluntary_minor: 18750000, lookback_months: 12, lookahead_days: 30, apply_within_days: 30, non_resident_threshold: null,
                                  cite: 'ER Art. 7(1)(2), Art. 8(1); DL Art. 13(1)(2), Art. 17, Art. 19' }),
    /**
     * ⭐ REVERSE CHARGE AS DATA — the three categories the Decree-Law itself names (DL Art. 48). Further categories come by Cabinet decision under Art. 48(8); none was
     * fetched in AE0, so none is a row (a row is added only with its decision cited). ⚠️ tax.determine does not yet assess a UAE reverse charge (its rcm path is India's
     * state-split one); the ledger `rcm_vat` and RET Boxes 3 / 10 are ready for the round that does. `codes` is empty: the UAE has no HSN / SAC lookup for these.
     */
    rcm: Object.freeze({
      source: 'DL Art. 48(1)–(8); ER Arts. 48, 50',
      categories: Object.freeze([
        Object.freeze({ id: 'import_goods',    kind: 'goods',   name: 'Import of Concerned Goods for the business (conditions in ER Art. 48(1); otherwise tax is paid at import under ER Art. 50)', codes: Object.freeze([]),
          rates: Object.freeze([Object.freeze({ rate: 5, itc: true })]), always: true, supplier: 'a supplier outside the State', recipient: 'a Taxable Person importing for his Business', cite: 'DL Art. 48(1); ER Art. 48(1), Art. 50' }),
        Object.freeze({ id: 'import_services', kind: 'service', name: 'Import of Concerned Services for the business', codes: Object.freeze([]),
          rates: Object.freeze([Object.freeze({ rate: 5, itc: true })]), always: true, supplier: 'a supplier outside the State', recipient: 'a Taxable Person importing for his Business', cite: 'DL Art. 48(1)' }),
        Object.freeze({ id: 'hydrocarbons_b2b', kind: 'goods',  name: 'Crude or refined oil, natural gas or Pure Hydrocarbons supplied by a Registrant to a Registrant who will resell them or use them to produce or distribute energy (written declaration and TRN verification before the date of supply)', codes: Object.freeze([]),
          rates: Object.freeze([Object.freeze({ rate: 5, itc: true })]), always: true, supplier: 'a Registrant', recipient: 'a Registrant reselling or producing / distributing energy', cite: 'DL Art. 48(3)–(6)' }),
      ]),
    }),
    source: 'Federal Decree-Law No. 8 of 2017 on VAT as amended to FDL 16 of 2024: Arts. 2–3 (5%), 45 (zero rate), 46 (exempt), 48 (reverse charge), 65–67 (tax invoices), 69 (AED), 70 (credit notes), 79 (TRN); Cabinet Decision No. 52 of 2017 (Executive Regulation) as amended to CD 100 of 2024: Arts. 7–8 (thresholds), 59–61 (invoices, credit notes, fils), 62–64 (tax periods, due date), 71–72 (records); as read 2026-10 (AE0)',
});

/**
 * ⭐ TRN — the Tax Registration Number: 15 digits; its first 10 digits are the TIN (EI-MF glossary rows 11–12: "A unique 10-digit identifier and the first 10 digits of the
 * 15-digit TRN"; the FTA's TRN-verification field takes exactly 15 characters). DL Art. 79: the TRN goes on every Tax Return, Tax Invoice, Tax Credit Note and tax document.
 * ⚠️ NO CHECK DIGIT IS PUBLISHED (AE0 §4, §14): this is a FORMAT check — 15 digits, spaces and dashes ignored — and nothing more; whether the number is registered is the
 * FTA's answer (TRN verification on tax.gov.ae), never this file's. The Peppol scheme of the seller's electronic identifier is the fixed value 0235 (EI-MF field 12).
 * trn.check(v) → { ok, trn (15 digits), tin (the first 10), why (null when ok) }; trn.valid(v) → boolean.
 */
function trnCheck(v) {
  var s = String(v == null ? '' : v).replace(/[\s-]/g, '');
  if (!/^\d{15}$/.test(s)) return { ok: false, trn: null, tin: null, why: 'A TRN is 15 digits.' };
  return { ok: true, trn: s, tin: s.slice(0, 10), why: null };
}
const TRN = { valid: function (v) { return trnCheck(v).ok; }, check: trnCheck, digits: 15, tin_digits: 10, check_digit: null, peppol_scheme: '0235',
              cite: 'EI-MF glossary rows 11–12 and field 12; DL Art. 79; no checksum found in an official source (AE0 §14)' };

/* ER Art. 59(1) — the particulars of a FULL tax invoice, (a) to (l), as quoted in AE0 §6.2 */
const FULL_INVOICE_FIELDS = [
  ['a', 'the words "Tax Invoice" clearly displayed on the invoice'],
  ['b', 'the name, address and Tax Registration Number of the Registrant making the supply'],
  ['c', 'the name, address and Tax Registration Number of the Recipient where he is a Registrant'],
  ['d', 'a sequential Tax Invoice number or a unique number which enables identification of the Tax Invoice and its order in any sequence of invoices'],
  ['e', 'the date of issuing the Tax Invoice'],
  ['f', 'the date of supply if different from the date the Tax Invoice was issued'],
  ['g', 'a description of the Goods or Services supplied'],
  ['h', 'for each Good or Service, the unit price, the quantity or volume supplied, the rate of Tax and the amount payable expressed in AED'],
  ['i', 'the amount of any discount offered'],
  ['j', 'the gross amount payable expressed in AED'],
  ['k', 'the Tax amount charged expressed in AED, together with the rate of exchange applied where the currency is converted from a currency other than the UAE dirham'],
  ['l', 'where the Recipient is required to account for Tax: a statement that the Recipient is required to account for Tax, and a reference to the relevant provision of the Decree-Law (Art. 48)'],
];
/* ER Art. 59(2) — the particulars of a SIMPLIFIED tax invoice, (a) to (e), as quoted in AE0 §6.3 */
const SIMPLIFIED_INVOICE_FIELDS = [
  ['a', 'the words "Tax Invoice" clearly displayed on the invoice'],
  ['b', 'the name, address and Tax Registration Number of the Registrant making the supply'],
  ['c', 'the date of issuing the Tax Invoice'],
  ['d', 'a description of the Goods or Services supplied'],
  ['e', 'the total Consideration and the Tax amount charged expressed in AED'],
];
/**
 * ⭐ taxInvoice(total_minor, { buyer_registered?, reverse_charge?, wholly_zero_rated?, implementing_state? }) → what a document for this supply must be, read from TAX_AE.taxInvoice:
 *   { required, kind: 'full' | 'simplified' | null, simplified_allowed, title, buyer_trn, within_days, issue, must: [the particulars, ER Art. 59(1) or 59(2)], cite, why? }
 *   kind              the LEAST a registrant must issue: 'simplified' when ER Art. 59(5) allows one (the recipient is not a Registrant, or is one and the Consideration
 *                     is at most AED 10,000 — never under reverse charge), else 'full'. A full invoice is always allowed; the FTA may require one (ER Art. 59(15)).
 *   required          false for a wholly zero-rated supply when sufficient records are kept (ER Art. 59(3)), and for a supply treated as made in another Implementing
 *                     State, whose document is not labelled "Tax Invoice" and carries no tax (DL Art. 66; ER Art. 59(12) — the recipient's registration number in that
 *                     State and a statement identifying the supply go on it instead).
 *   buyer_trn         the recipient's name, address and TRN must be on it (full invoice, recipient a Registrant — ER Art. 59(1)(c))
 *   within_days       14 from the date of supply (DL Art. 67); a simplified invoice is issued ON the date of supply (ER Art. 59(13)(1)), so 0
 * The language of the document is `language` below (TPL Art. 5): English is accepted; an Arabic translation may be demanded later.
 */
function taxInvoice(totalMinor, opt) {
  var t = TAX_AE.taxInvoice, o = opt || {}, m = Math.abs(Number(totalMinor) || 0);
  var registrant = !!o.buyer_registered, rcm = !!o.reverse_charge;
  var base = { title: 'Tax Invoice', cite: t.cite };
  if (o.implementing_state) return Object.assign(base, { required: false, kind: null, simplified_allowed: false, title: null, buyer_trn: false, within_days: null, issue: null, must: [],
    why: 'A supply treated as made in another Implementing State: the document is not labelled "Tax Invoice" and includes no Tax; it carries the recipient\'s tax registration number in that State and a statement identifying the supply as between a supplier in the State and a Recipient in an Implementing State (DL Art. 66; ER Art. 59(12)).' });
  if (o.wholly_zero_rated) return Object.assign(base, { required: false, kind: null, simplified_allowed: !rcm && (!registrant || m <= t.simplified_upto_minor), buyer_trn: false, within_days: t.within_days, issue: null, must: [],
    why: 'A wholly zero-rated supply needs no Tax Invoice when sufficient records of the supply are kept (ER Art. 59(3)); one may still be issued.' });
  var simplifiedAllowed = !rcm && (!registrant || m <= t.simplified_upto_minor);
  var kind = simplifiedAllowed ? 'simplified' : 'full';
  var must = (kind === 'full' ? FULL_INVOICE_FIELDS : SIMPLIFIED_INVOICE_FIELDS)
    .filter(function (f) { return kind !== 'full' || ((f[0] !== 'c' || registrant) && (f[0] !== 'l' || rcm)); })
    .map(function (f) { return '(' + f[0] + ') ' + f[1]; });
  return Object.assign(base, { required: true, kind: kind, simplified_allowed: simplifiedAllowed, buyer_trn: kind === 'full' && registrant,
    within_days: kind === 'simplified' ? 0 : t.within_days, issue: kind === 'simplified' ? 'on the date of supply (ER Art. 59(13)(1))' : 'within 14 days of the date of supply (DL Art. 67)',
    must: must });
}

/**
 * ⭐ TAX CREDIT NOTES — DL Art. 70(1): issued "when a reduction of Output Tax occurs in relation to any supply"; the particulars are ER Art. 60(1) (as amended by CD 100 of 2024),
 * quoted in AE0 §7. ⚠️ THERE IS NO "TAX DEBIT NOTE" IN THE UAE LAW (no debit-note article in the DL or ER): an under-charge is corrected by a further tax invoice. The books'
 * own DN series (a purchase return to a supplier) is a voucher, never a tax document.
 */
const CREDIT_NOTE = {
  title: 'Tax Credit Note', buyer_created_title: 'Tax Credit Note created by buyer',
  must: [
    '(a) the words "Tax Credit Note" clearly displayed',
    '(b) the name, address and Tax Registration Number of the Registrant making the supply',
    '(c) the name, address and Tax Registration Number of the Recipient where he is a Registrant',
    '(d) the date of issuing the Tax Credit Note',
    '(e) the value of the supply shown on the Tax Invoice, the correct amount of the value of the supply, the difference between those two amounts, and the Tax charged that relates to that difference in AED (a second note against the same invoice starts from the value as adjusted by the previous note)',
    '(f) a brief explanation of the circumstances giving rise to the issuing of the Tax Credit Note',
    '(g) information sufficient to identify the supply to which the Tax Credit Note relates',
  ],
  debit_note: null,
  cite: 'DL Art. 70(1), Art. 1; ER Art. 60(1), 60(3), 60(4); MD243 Art. 6(2) (the e-credit-note triggers)',
};

/**
 * ⭐ THE LANGUAGE RULE, exactly as the source says (AE0 §6.4): the VAT Decree-Law and its Executive Regulation contain no language clause for the invoice itself. TPL Art. 5:
 * tax returns, records and documents are submitted to the Authority in Arabic; the Authority may accept them in another language provided an Arabic translation is given if
 * requested; the person who translates bears the accuracy and the cost. TPL-ER Art. 5(1): "The Authority may accept data, information, records and any other documents
 * related to any Tax that are submitted to the Authority in English". So an English invoice is lawful; an Arabic translation may be demanded later, at the taxpayer's cost.
 */
const LANGUAGE = { document: 'any', records_on_request: 'ar', english_accepted: true, translation_cost: 'taxpayer',
                   cite: 'TPL Art. 5(1)–(3); TPL-ER Art. 5(1)–(2); TPL Art. 24(b) (failing to submit in Arabic when requested is a violation); EI-GL §5.1 (the e-invoicing framework supports Arabic and English)' };

/** supplyKindOf(line) → the kind row a line names (`supply_kind` | `tax_kind`), standard when it names none, null when it names one the pack does not know */
function supplyKindOf(line) {
  var l = line || {}, k = String(l.supply_kind || l.tax_kind || 'standard').trim().toLowerCase().replace(/-/g, '_');
  return Object.prototype.hasOwnProperty.call(TAX_AE.supplyKinds, k) ? TAX_AE.supplyKinds[k] : null;
}

/**
 * ⭐ TAX PERIODS AND THE RETURN — ER Art. 62(1): the standard Tax Period is three calendar months ending on the date the Authority determines; the FTA assigns it (a
 * monthly period for some, RET §2.1). RET §2.1 names the four staggers: 1 (tax year ending 31 Jan) Feb–Apr · May–Jul · Aug–Oct · Nov–Jan; 2 (ending Feb) Mar–May · Jun–Aug ·
 * Sep–Nov · Dec–Feb; 3 (ending 31 Mar) Apr–Jun · Jul–Sep · Oct–Dec · Jan–Mar; 4 (ending 31 Dec) monthly. ER Art. 64(1): the return is received by the Authority "no later
 * than the 28th day following the end of the Tax Period", and the payment by the same day (Art. 64(3)). RET §2.1: a nil return is still due.
 * periods({ stagger, year }) → the periods that START in that calendar year, each { period, label, start, end, due }; `stagger` is 1 · 2 · 3 · 4 (or 'monthly') — the
 * one the FTA assigned, read from the registration; it is never guessed. ⚠️ A due date on a weekend or a national holiday moves to the first business day after it
 * (RET §2.1) — that needs a calendar, which this pure file does not have; the date here is the statutory one (`due_rule` says so).
 */
const STAGGERS_AE = { 1: { first_month: 2, tax_year_end: 'January' }, 2: { first_month: 3, tax_year_end: 'February' }, 3: { first_month: 4, tax_year_end: 'March' }, 4: { first_month: 1, tax_year_end: 'December', monthly: true } };
const MONTHS_ = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DUE_RULE = 'the 28th day after the end of the Tax Period (ER Art. 64(1)); a weekend or national holiday moves it to the first business day after (RET §2.1) — a calendar decides that, not this file';
function pad2_(n) { return String(n).padStart(2, '0'); }
function ymd_(y, m, d) { return y + '-' + pad2_(m) + '-' + pad2_(d); }
function lastDay_(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
function periods(o) {
  var x = o || {}, y = parseInt(String(x.year || ''), 10), key = String(x.stagger == null ? '' : x.stagger).toLowerCase();
  if (key === 'monthly') key = '4';
  if (!(y > 0)) throw refuse_('VAT periods need the calendar year they start in (year: 2026).');
  var st = Object.prototype.hasOwnProperty.call(STAGGERS_AE, key) ? STAGGERS_AE[key] : null;
  if (!st) throw refuse_('The FTA assigns the Tax Period (ER Art. 62): say which stagger — 1 (Feb–Apr …), 2 (Mar–May …), 3 (Apr–Jun …) or 4 (monthly) — as on the registration; it is never guessed.');
  var out = [], span = st.monthly ? 1 : 3, count = st.monthly ? 12 : 4;
  for (var i = 0; i < count; i++) {
    var m0 = st.first_month + i * span, ys = y + Math.floor((m0 - 1) / 12), ms = ((m0 - 1) % 12) + 1;
    var m1 = m0 + span - 1, ye = y + Math.floor((m1 - 1) / 12), me = ((m1 - 1) % 12) + 1;
    var md = m1 + 1, yd = y + Math.floor((md - 1) / 12), mdd = ((md - 1) % 12) + 1;
    var id = st.monthly ? ys + '-' + pad2_(ms) : ys + '-' + pad2_(ms) + '/' + ye + '-' + pad2_(me);
    var label = st.monthly ? MONTHS_[ms - 1] + ' ' + ys : MONTHS_[ms - 1] + '–' + MONTHS_[me - 1] + ' ' + (ys === ye ? ys : ys + '/' + ye);
    out.push({ period: id, label: label, stagger: Number(key), frequency: st.monthly ? 'monthly' : 'quarterly', start: ymd_(ys, ms, 1), end: ymd_(ye, me, lastDay_(ye, me)), due: ymd_(yd, mdd, 28), due_rule: DUE_RULE });
  }
  return out;
}

/**
 * ⭐ VAT201 — the return's boxes READ FROM THE POSTED LEDGERS of the period (RET §3 and RET-UM): nothing is recomputed from invoices.
 *   vat201({ period, emirate? }, rows) — `rows` are the period's ledger MOVEMENTS by role, as ledger.accumulate gives them: [{ role, dr_minor, cr_minor }] (a code with no
 *   role is a shop's own ledger and is not a box). Every amount in FILS (RET §3.2: "to the nearest fils"); each box has the form's three columns — amount (net of VAT),
 *   vat, adjustment (always 0 here: bad-debt relief, the six-month claw-back and the apportionment wash-up are the shop's manual figures, said in `adjustments`).
 *     1   Standard rated supplies — amount: sales + sales_returns net credit (credit notes reduce it, RET Box 1); vat: output_vat net credit. The form splits Box 1 BY EMIRATE
 *         (ER Art. 72(2): the Emirate of the fixed establishment most closely connected to the supply); the ledgers carry no Emirate, so the whole of Box 1 is answered for the ONE
 *         Emirate handed in (`emirate`, one of `emirates`) and `emirate_basis` says so. The sub-box letters 1a–1g are not in any official text (AE0 §14) and are not used.
 *     2   Tax Refunds provided to Tourists — pre-populated by the FTA (Planet Tax Free); not read (null).
 *     3   Supplies subject to the reverse charge provisions — amount: purchases_reverse_charge net debit; vat: rcm_vat net credit (DL Art. 48(1)).
 *     4   Zero-rated supplies — sales_zero_rated + sales_export net credit (amount only).   5  Exempt supplies — sales_exempt net credit (amount only).
 *     6   Goods imported into the UAE — auto-populated from customs declarations linked to the TRN; not read (null).   7  Adjustments to goods imported — manual; not read (null).
 *     8   Totals — the sum of what was read of Boxes 1–7.
 *     9   Standard rated expenses — amount: purchases, purchase_returns and every expense class, net debit; vat: input_vat net debit (the Recoverable VAT column: what was posted
 *         to Input VAT is what the shop judged recoverable — ⚠️ the amount is read VAT-EXCLUSIVE and INCLUDES zero-rated and exempt purchases, because the ledgers hold them under
 *         the same accounts; `box9_basis` says so).
 *     10  Supplies subject to the reverse charge provisions (recovery) — ⚠️ the ledgers hold ALL recoverable input VAT in one account (Input VAT), so the reverse-charge recovery
 *         sits inside Box 9's VAT here; the shop moves it to Box 10 on the form and Box 13 is the same either way (`box10_basis`).
 *     11  Totals — Box 9 + Box 10.   12  Total value of due tax — the VAT column of Box 8.   13  Total value of recoverable tax — the VAT column of Box 11.
 *     14  Payable tax for the period — Box 12 − Box 13 (positive: pay by the due date; negative: `refund_minor`, refundable on request — Box 15, Form VAT311 — or carried forward).
 *     15  Whether a refund is requested — the shop's choice, not read.   Profit Margin Scheme flag — not read (the scheme is out of scope).
 */
const BOX_LABELS = {
  1: 'Standard rated supplies', 2: 'Tax Refunds provided to Tourists under the Tax Refunds for Tourists Scheme', 3: 'Supplies subject to the reverse charge provisions',
  4: 'Zero-rated supplies', 5: 'Exempt supplies', 6: 'Goods imported into the UAE', 7: 'Adjustments to goods imported into the UAE', 8: 'Totals',
  9: 'Standard rated expenses', 10: 'Supplies subject to the reverse charge provisions', 11: 'Totals',
  12: 'Total value of due tax for the period', 13: 'Total value of recoverable tax for the period', 14: 'Payable tax for the period',
  15: 'Do you wish to request a refund for the above amount of excess recoverable tax',
};
const EMIRATES = ['Abu Dhabi', 'Dubai', 'Sharjah', 'Ajman', 'Umm Al Quwain', 'Ras Al Khaimah', 'Fujairah'];
function vat201(o, rows) {
  var x = o || {}, byRole = Object.create(null);
  if (!x.period) throw refuse_("A VAT return needs its period ('2026-02/2026-04' or '2026-01', as returns.periods names them).");
  var emirate = x.emirate == null ? null : String(x.emirate);
  if (emirate !== null && EMIRATES.indexOf(emirate) < 0) throw refuse_('The Emirate of the fixed establishment is one of ' + EMIRATES.join(', ') + ' — not "' + emirate.slice(0, 30) + '".');
  (rows || []).forEach(function (r) {
    if (!r || !r.role) return;
    var a = byRole[r.role] || (byRole[r.role] = { dr: 0, cr: 0 });
    a.dr += int_(r.dr_minor, r.role); a.cr += int_(r.cr_minor, r.role);
  });
  var cr = function (role) { var a = byRole[role]; return a ? a.cr - a.dr : 0; }, dr = function (role) { var a = byRole[role]; return a ? a.dr - a.cr : 0; };
  var sum = function (roles, f) { return roles.reduce(function (s, r) { return s + f(r); }, 0); };
  /* v1.39.0 (BAS1): every read box carries the ledger ROLES behind its two columns (`roles.amount`, `roles.vat`), so a screen can open what a figure counts */
  var expenseRoles = ['purchases', 'purchase_returns'].concat(EXPENSE_CLASSES_AE.map(function (e) { return e.role; }));
  var box = function (n, amount, vat, extra, rolesA, rolesV) { return Object.assign({ box: n, label: BOX_LABELS[n], amount_minor: amount, vat_minor: vat, adjustment_minor: 0, roles: { amount: (rolesA || []).slice(), vat: (rolesV || []).slice() } }, extra || {}); };
  var b1 = box(1, sum(['sales', 'sales_returns'], cr), cr('output_vat'), { emirate: emirate }, ['sales', 'sales_returns'], ['output_vat']);
  var b3 = box(3, dr('purchases_reverse_charge'), cr('rcm_vat'), null, ['purchases_reverse_charge'], ['rcm_vat']);
  var b4 = box(4, sum(['sales_zero_rated', 'sales_export'], cr), 0, null, ['sales_zero_rated', 'sales_export'], []), b5 = box(5, cr('sales_exempt'), 0, null, ['sales_exempt'], []);
  var b9 = box(9, sum(expenseRoles, dr), dr('input_vat'), null, expenseRoles, ['input_vat']);
  var b10 = box(10, 0, 0, null, [], []);
  var b8 = box(8, b1.amount_minor + b3.amount_minor + b4.amount_minor + b5.amount_minor, b1.vat_minor + b3.vat_minor, null,
               b1.roles.amount.concat(b3.roles.amount, b4.roles.amount, b5.roles.amount), b1.roles.vat.concat(b3.roles.vat));
  var b11 = box(11, b9.amount_minor + b10.amount_minor, b9.vat_minor + b10.vat_minor, null, b9.roles.amount, b9.roles.vat);
  var due = b8.vat_minor, rec = b11.vat_minor, net = due - rec;
  var boxes = {};
  [b1, box(2, null, null, { note: 'pre-populated by the FTA from the Tax Refunds for Tourists Scheme; not read from the ledgers' }), b3, b4, b5,
   box(6, null, null, { note: 'auto-populated by the FTA from customs declarations linked to the TRN; not read from the ledgers' }),
   box(7, null, null, { note: 'a manual correction of Box 6; not read from the ledgers' }), b8, b9, b10, b11,
   { box: 12, label: BOX_LABELS[12], vat_minor: due, roles: { amount: [], vat: b8.roles.vat.slice() } }, { box: 13, label: BOX_LABELS[13], vat_minor: rec, roles: { amount: [], vat: b11.roles.vat.slice() } },
   { box: 14, label: BOX_LABELS[14], vat_minor: net, roles: { amount: [], vat: b8.roles.vat.concat(b11.roles.vat) } },
   { box: 15, label: BOX_LABELS[15], answer: null, note: 'the shop\'s choice: a refund by Form VAT311, or carried forward; not read from the ledgers', roles: { amount: [], vat: [] } }]
    .forEach(function (b) { boxes[b.box] = b; });
  return { form: 'VAT201', period: x.period, emirate: emirate, boxes: boxes, payable_minor: Math.max(0, net), refund_minor: Math.max(0, -net),
           emirate_basis: 'the whole of Box 1 is reported under ' + (emirate || 'the Emirate of the fixed establishment (none was handed in)') + ' — the ledgers carry no Emirate (ER Art. 72(2))',
           box9_basis: 'VAT-exclusive, and including zero-rated and exempt purchases (the ledgers hold them under the same accounts); the VAT column is what was posted to Input VAT',
           box10_basis: 'the ledgers hold all recoverable input VAT in one account, so the reverse-charge recovery sits inside Box 9\'s VAT here; Box 13 is the same either way',
           adjustments: 'the adjustment column is 0: bad-debt relief, the unpaid-supplier claw-back and the input-tax apportionment wash-up are the shop\'s own figures',
           cite: 'RET (FTA VAT Returns guide, Aug 2021) §3.2 and Boxes 1–15; RET-UM (EmaraTax VAT201 user manual, Oct 2022); ER Art. 64(5), Art. 72' };
}
function int_(v, where) { var n = v == null ? 0 : Number(v); if (!Number.isInteger(n)) throw refuse_('A ledger amount is a whole number of fils — ' + where + ' is not.'); return n; }

/** voucher series — the same standard prefixes as reg-in and reg-au (Athi, 2026-10-02: "Follow the standard"); 'MJ' is a person's own entry of any kind. ER Art. 59(1)(d): a sequential or unique invoice number. */
const VOUCHER_SERIES_AE = { Sales: 'SV', Purchase: 'PV', Receipt: 'RV', Payment: 'PY', Contra: 'CV', 'Credit note': 'CN', 'Debit note': 'DN', Journal: 'JV' };
const MANUAL_SERIES_AE = 'MJ';

/**
 * ⭐ accountExtras(row, group, pack) → the fields of a chart account that are the UAE's own: the group's name, the statement line the ledger lands on (the row's, else its
 * group's) with that line's label and statement ('bs' | 'pl'). The field is `line` — IFRS wording, no Schedule III.
 */
function accountExtras(r, g, pack) {
  const p = pack || PACK, key = r.line || g.line;
  const line = (p.presentation && p.presentation.lines && Object.prototype.hasOwnProperty.call(p.presentation.lines, key)) ? p.presentation.lines[key] : null;
  return { group_name: g.name, line: key, line_label: line ? line.label : null, statement: line ? line.st : null };
}

/** ⭐ THE TAX HEADS (b2): ONE — `vat`. Output tax lands on Output VAT, input tax on Input VAT, and the tax a registrant accounts for on a supply to himself (DL Art. 48(1)) on `rcm_vat`. */
const TAX_HEADS = ['vat'];
const TAX_LEDGERS = { vat: { output: 'output_vat', input: 'input_vat', rcm: 'rcm_vat' } };

function refuse_(why) { var e = new Error(why); e.refused = true; return e; }
/**
 * ⭐ setOff({ output, input }, minor) → { utilised, payable, carried, excess } — ONE head: Recoverable Tax (Input VAT, Box 13) against Due Tax (Output VAT, Box 12). What is left
 * of the due tax is payable by the due date (Box 14 positive); what is left of the recoverable tax is an EXCESS the shop may have refunded on request (Box 15, Form VAT311) or
 * carried forward — returned as `carried` so the core's shape holds, and named `excess` beside it; the engine never chooses between the two. Reverse-charge Due Tax (rcm_vat)
 * is part of Box 12 and is netted the same way on the form: hand it in WITHIN `output.vat` (the core's cash-only `rcm` option is India's s.49(4), not the UAE's).
 * Amounts in MINOR units, read by `minor` (the core's one reader).
 */
function setOff(o, minor) {
  var out = minor((o.output || {}).vat), inp = minor((o.input || {}).vat);
  if (out < 0 || inp < 0) throw refuse_('A VAT balance is never negative here — pass the credit balance of Output VAT and the debit balance of Input VAT.');
  var a = Math.min(inp, out), used = a > 0 ? [{ from: 'vat', against: 'vat', amount: a }] : [];
  return { utilised: used, payable: { vat: out - a }, carried: { vat: inp - a }, excess: inp - a };
}
/** no stored event was ever posted under another name here: the neutral rules are the only names (a new pack carries no legacy aliases) */
const EVENT_ALIASES = {};
/** the sentences a refusal says when it has to name this country's own terms */
const MESSAGES = {
  nothingToSetOff: 'Nothing to set off: no Input VAT (recoverable tax, Box 13) meets Output VAT (due tax, Box 12) this period.',
  payHeadUnknown: 'A VAT payment is one head — vat.',
  rcmHeadUnknown: 'Reverse-charge VAT is one head — vat.',
  paymentEmpty: 'A VAT payment needs the vat head with an amount.',
  rcmNotBuilt: {},
  /* v1.48.0 (W2-BOOKS): the words a VAT payment is recorded under — the EmaraTax payment reference (a GIBAN transfer or the portal's receipt; RET-UM §Payments)
     and the narration the entry carries. ONE word per country: the platform never says "challan" to an Emirati shop. */
  paymentRef: { label: 'Payment reference', ask: 'Which payment? Give the EmaraTax payment reference (the GIBAN transfer reference).', hint: 'The EmaraTax payment reference', narration: 'VAT payment' },
  setOffNarration: 'VAT set-off',
};

/**
 * ⭐ depreciation.compute(rows, base, ctx) → { total, rate, per } for ONE asset class — IAS 16 straight-line. `rows` are the assets of the class ({ id, c (the class row), cost,
 * wdv (opening carrying amount; null for one bought this year), days (held this year), added, proceeds }), amounts in MINOR units; ctx { method, diy (days in the year) }.
 *   straight-line (IAS 16 para 62): (cost − residual value) × days held ÷ days in the year × 100 ÷ useful life; residual value is the asset's own (`residual`, default 0).
 * The charge never takes the carrying amount below the residual value. Only 'slm' is offered (the core's 'prime_cost' word is read as the same): a diminishing-balance rate
 * would be an estimate this file has no source for. ⚠️ Disposal (gain or loss against the carrying amount, IAS 16 para 68) is a separate event — `proceeds` are not read here.
 * Each asset is rounded once; the class total is their sum (the core adds any drift to the first asset).
 */
function depreciationCompute(rs, base, ctx) {
  var c = rs[0].c, diy = ctx.diy, m = String(ctx.method || 'slm');
  if (m === 'prime_cost' || m === 'straight_line') m = 'slm';
  if (m !== 'slm') throw refuse_('IAS 16 depreciation here is straight-line (slm) — a diminishing-balance rate is an estimate this pack has no source for.');
  var rate = Math.round(10000 / c.life) / 100;         /* the percentage a screen prints; the charge divides by the life itself, so a 3-year life is a third, not 33.33% */
  var per = rs.map(function (r) {
    if (r.cost === null && r.wdv === null) throw refuse_('IAS 16 depreciation needs the cost or the opening carrying amount of asset ' + r.id + '.');
    var open = r.wdv !== null && r.wdv !== undefined ? r.wdv : r.cost, residual = Math.max(0, Number(r.residual) || 0);
    var cost = r.cost !== null && r.cost !== undefined ? r.cost : open;
    var ch = (cost - residual) * r.days / diy / c.life;
    ch = Math.min(ch, Math.max(0, open - residual));
    return Math.round(Number(ch.toPrecision(15)));
  });
  return { total: per.reduce(function (s, v) { return s + v; }, 0), rate: rate, per: per };
}

/**
 * ⭐ THE STATEMENTS' FORM (b5) — IAS 1 wording, as the ledger presents them. `lines` is the statement table above; `lineOf / labelOf / placed` read and set the statement-line
 * fields of a ledger record (`line`, `line_label`); `taxNetting` nets Input VAT against Output VAT (one head) — a net debit is VAT recoverable from the FTA (an other current
 * asset), a net credit stays under the tax-liabilities line; `rcm_vat` and `corporate_tax_payable` stay their own liabilities; `profitLine` takes the year's profit to date;
 * `ownerCapitalBases` are the entity bases whose capital is one account; `ageing` is the common 30 / 60 / 90-day practice in MONTHS (IFRS 7 para 37 asks for an age analysis
 * and prescribes no buckets — there is no statutory table).
 */
const AGE_AE = [['not_due', null], ['lt_1m', [0, 1]], ['m1_2', [1, 2]], ['m2_3', [2, 3]], ['gt_3m', [3, null]]];
const PRESENTATION = {
  lines: LINES_AE,
  lineOf: function (a) { return a.line; },
  labelOf: function (a) { return a.line_label; },
  placed: function (a, key) { return Object.assign({}, a, { line: key, line_label: LINES_AE[key] ? LINES_AE[key].label : null }); },
  taxNetting: [{ output: 'output_vat', input: 'input_vat', creditRole: 'vat_recoverable', payableRole: 'vat_payable',
                 creditName: 'VAT recoverable from the FTA', payableName: 'VAT payable to the FTA' }],
  creditLine: 'other_current_assets', payableLine: 'tax_liabilities', profitLine: 'retained_earnings',
  ownerCapitalBases: ['sole_establishment', 'partnership'],
  ageing: { receivable: AGE_AE, payable: AGE_AE },
  labels: {
    advancesFromCustomers: 'Customer deposits', advancesToSuppliers: 'Advances to suppliers',
    profitToDate: 'Profit for the year to date', profitLine: 'Retained earnings',
    openingCapital: 'Opening capital', netProfitToDate: 'Add: Net profit for the year to date', netLossToDate: 'Less: Net loss for the year to date', drawings: 'Less: Drawings', capitalAccount: "Owner's equity",
    openingStock: 'Opening inventory', closingStock: 'Closing inventory',
  },
};
/** the groups the core reads by KIND, and how a payment mode lands: the REAL account money comes into (a bank transfer and a cheque reach the bank; a card is a card settlement; no UPI here) */
const CHART = {
  paymentModes: { cash: 'cash', bank: 'bank', transfer: 'bank', cheque: 'bank', card: 'card' },
  kinds: { tax: 'tax_liabilities', stock: 'inventory', cash: 'cash_on_hand', bank: 'bank_accounts',
           loans: ['non_current_liabilities', 'loans', 'bank_overdraft'],
           sales: 'sales', purchases: 'purchases', directIncome: 'sales', directExpense: 'cost_of_sales',
           indirectIncome: 'other_income', indirectExpense: 'operating_expenses' },
};

/** the words a refusal quotes (b6): IAS 2 Inventories — cost formulas (FIFO / weighted average, para 25); measured at the lower of cost and net realisable value (para 9) */
const CITE = { inventoryFormula: 'IAS 2 para 25', lowerOfCostNrv: 'IAS 2 para 9' };
/** the ledger an accrued expense is owed on: wages, salaries, end-of-service benefits and staff welfare (employee benefits) are wages payable; the rest are accrued expenses */
function accrualPayableFor(a) { return a && a.line === 'employee_benefits' ? 'wages_payable' : 'accrued_expenses'; }

/* ⭐ BANK STATEMENTS (b7) — the amount prefixes and the whole words a narration uses. No bank's header cells are recorded yet (a preset is added once checked against a real file). */
const BANK = {
  amountPrefixes: ['aed', 'dhs', 'dh', 'د.إ'], minorUnit: 'fils', presets: {},
  keywords: { default: {
    charges: ['CHARGES', 'FEE', 'FEES', 'BANK CHARGES', 'SERVICE CHARGE', 'VAT ON CHARGES'],
    interest: ['INTEREST', 'CREDIT INTEREST', 'PROFIT PAID'],
    atm: ['ATM', 'CASH WITHDRAWAL', 'WITHDRAWAL'],
    cash_deposit: ['CASH DEPOSIT', 'CDM DEPOSIT', 'CASH DEP'],
    cheque_return: ['RETURNED CHEQUE', 'CHEQUE RETURN', 'RETURNED', 'REVERSAL'],
    transfer: ['TRANSFER', 'FTS', 'UAEFTS', 'IPP', 'AANI', 'SWIFT', 'DIRECT DEBIT', 'DIRECT CREDIT'],
  } },
};

/**
 * ⭐ THE FISCAL YEAR: the calendar year, written '2026' — the DEFAULT. The VAT law sets no accounting year (the Tax Period is the FTA's, ER Art. 62); Corporate Tax runs on the
 * entity's own financial year (CTL: "financial years beginning on or after 1 June 2023"). A shop whose year starts elsewhere says so once in its own books setting
 * (`fy_start_month`, read by accounts-packs.yearOf_ and resolve(ctx.pack)); the REGISTERED pack carries only fiscalYear (regulation.js refuses a contradicting fy_start_month).
 */
const FISCAL_YEAR = { startMonth: 1, label: 'single' };

/** the seven Emirates, in the order the FTA's Designated Zones list groups them (DZ); RET Box 1 reports standard-rated supplies by Emirate (ER Art. 72(2)) */
/** the Designated Zones named in the FTA's list (Cabinet Decision 59 of 2017 as amended by 35 of 2018) — DATA, 23 names; DL Art. 50: a Designated Zone "shall be treated as being outside the State". ⚠️ an FTA news item of 30 Oct 2021 says 27 — the four later additions were not found in a fetched official document (AE0 §14) */
const DESIGNATED_ZONES = {
  'Abu Dhabi': ['Free Trade Zone of Khalifa Port', 'Abu Dhabi Airport Free Zone', 'Khalifa Industrial Zone', 'Al Ain International Airport Free Zone', 'Al Butain International Airport Free Zone'],
  'Dubai': ['Jebel Ali Free Zone (North-South)', 'Dubai Cars and Automotive Zone (DUCAMZ)', 'Dubai Textile City', 'Free Zone Area in Al Quoz', 'Free Zone Area in Al Qusais', 'Dubai Aviation City', 'Dubai Airport Free Zone', 'International Humanitarian City – Jebel Ali'],
  'Sharjah': ['Hamriyah Free Zone', 'Sharjah Airport International Free Zone'],
  'Ajman': ['Ajman Free Zone'],
  'Umm Al Quwain': ['Umm Al Quwain Free Trade Zone in Ahmed Bin Rashid Port', 'Umm Al Quwain Free Trade Zone on Sheikh Mohammed Bin Zayed Road'],
  'Ras Al Khaimah': ['RAK Free Trade Zone', 'RAK Maritime City Free Zone', 'RAK Airport Free Zone'],
  'Fujairah': ['Fujairah Free Zone', 'FOIZ (Fujairah Oil Industry Zone)'],
};
const DESIGNATED = { zones: DESIGNATED_ZONES, count: 23, count_note: 'FTA news of 30 Oct 2021 says "a full list of all 27 Designated Zones"; the four additions were not found in a fetched official document — treat this as data to be refreshed from the FTA page, not a constant',
                     cite: 'DL Arts. 50–52; ER Art. 51; FTA list (Cabinet Decision 59 of 2017 as amended by 35 of 2018) https://tax.gov.ae/-/media/Files/FTA/links/Legislation/VAT/ar/05-designated-zones.pdf' };

/** records — TPL-ER Art. 3(1): five years after the Tax Period (a Taxable Person); ER Art. 71(2): real-estate VAT records 15 years; TPL-ER Art. 3(2)(3): the extensions */
const RECORDS = { years: { standard: 5, real_estate_vat: 15, real_estate_tpl: 7, dispute_extra: 4, audit_extra: 4, voluntary_disclosure_extra: 1 },
                  emirate_evidence: 'records must prove the Emirate of the fixed establishment related to each supply (ER Art. 72(2)); an e-commerce supplier above AED 100,000,000 a year proves the Emirate where the supply is received (ER Art. 72(3)–(6))',
                  einvoices: 'stored within the State for the Tax Procedures Law timeline (MD243 Art. 11)',
                  cite: 'DL Art. 78(1); ER Art. 71(1)(2), Art. 72; TPL-ER Art. 3(1)–(3); MD243 Art. 11' };

/** the Tax Period and the return, as data (ER Arts. 62, 64; RET §2.1) — the mechanism is returns.periods above */
const TAX_PERIOD = { standard_months: 3, assigned_by: 'FTA', staggers: STAGGERS_AE, due_day: 28, next_business_day: true, nil_return: true, due_rule: DUE_RULE,
                     cite: 'ER Art. 62(1)–(3), Art. 64(1)(3)(5); DL Art. 71; RET §2.1' };

/**
 * ⭐ E-INVOICING — the mandate's scope and dates as DATA (MoF decisions; AE0 §12). Generation (PINT-AE, the 5-corner model) is a later round; what is decided is recorded here
 * so a screen can say when a shop is in scope. B2C is OUT until the Minister decides otherwise (MD244 Art. 5(2)).
 */
const EINVOICE = {
  model: '5-corner DCTCE (Decentralised Continuous Transaction Control and Exchange), Peppol PINT-AE', spec_id: 'urn:peppol:pint:billing-1@ae-1', participant_scheme: '0235',
  scope: { b2b: true, b2g: true, g2b: true, g2g: true, b2c: false, regardless_of_vat_registration: true,
           excluded: ['sovereign government transactions', 'airline passenger tickets (Electronic Ticket) and ancillary services (EMD)', 'airline cargo under an Airway Bill (24 months only)', 'financial services exempt from VAT or zero-rated under ER Art. 42'],
           cite: 'MD243 Arts. 3–4; MD244 Art. 5(2); EI-MF §2; EI-GL §6.2' },
  phases: [
    { from: '2026-07-01', kind: 'pilot_and_voluntary', cite: 'MD244 Art. 3(4), Art. 4' },
    { revenue_at_least_minor: 5000000000, asp_by: '2026-10-30', live: '2027-01-01', cite: 'MD244 Art. 5(1)(a) as amended by MD66 Art. One (ASP by 30 Oct 2026, was 31 Jul 2026)' },
    { revenue_below_minor: 5000000000, asp_by: '2027-03-31', live: '2027-07-01', cite: 'MD244 Art. 5(1)(b)' },
    { kind: 'government', asp_by: '2027-03-31', live: '2027-10-01', cite: 'MD244 Art. 5(1)(c)' },
  ],
  revenue_definition: 'the gross income earned by a Person during the most recent Accounting Period, based on the financial statements (MD244 Art. 1)',
  issue_within_days: 14,                       /* MD243 Art. 6(5): from the Date of Business Transaction (the earlier of the transaction date or receipt of payment); a Registrant: DL Art. 67 */
  report_to_fta_within: null,                  /* MD243 Art. 6(6): "within the timeline prescribed by the Minister" — not yet fixed in any fetched decision (AE0 §14) */
  doc_types: ['invoice', 'credit_note'],       /* MD243 Art. 6; no debit note */
  transaction_flags: ['free_trade_zone', 'deemed_supply', 'margin_scheme', 'summary_invoice', 'continuous_supply', 'disclosed_agent_billing', 'ecommerce', 'exports'],   /* EI-MF field 5 */
  mandatory_fields: 51,                        /* EI-MF §4.1 — the list itself is the MoF's document, not copied here */
  system_failure_notice_days: 2,               /* MD243 Art. 12 (business days) */
  penalties: { not_implemented_per_month_minor: 500000, late_document_each_minor: 10000, late_document_month_cap_minor: 500000, failure_notice_per_day_minor: 100000,
               voluntary_adopters_exempt: true, cite: 'CD106 Arts. 2–3 and annex; EI-GL §8.2' },
  cite: 'TPL Art. 4(bis); MD243 (https://mof.gov.ae/wp-content/uploads/2025/09/Ministerial-Decision-no.-243-of-2025-on-the-Electronic-Invoicing-System.pdf); MD244 (https://mof.gov.ae/wp-content/uploads/2025/09/Ministerial-Decision-No.-244-of-2025-on-the-Implementation-of-the-Electronic-Invoicing-System.pdf); MD66 of 2026; CD106 of 2025; EI-GL v1.1; EI-MF v1.0',
};

/** Corporate Tax as DATA (CTL; AE0 §11) — the chart has the payable and the expense; NOTHING computes it yet */
const CORPORATE_TAX = {
  law: 'Federal Decree-Law No. 47 of 2022 (amended by 60/2023, 40/2024, 28/2025)', from: 'financial years beginning on or after 2023-06-01',
  bands: [{ upto_minor: 37500000, rate: 0, cite: 'CTL Art. 3(1)(a); Cabinet Decision 116 of 2022 Arts. 2–3' }, { above_minor: 37500000, rate: 9, cite: 'CTL Art. 3(1)(b); CD116' }],
  qualifying_free_zone_person: { qualifying_income_rate: 0, other_rate: 9, cite: 'CTL Art. 3(2)' },
  small_business_relief: { revenue_upto_minor: 300000000, periods_ending_by: '2026-12-31', extension_announced: 'to tax periods ending on or before 2029-12-31 (Ministerial Decision 131, MoF news 7 Aug 2026 — text not fetched)', cite: 'MD73 Art. 2' },
  top_up_tax: { rate: 15, from: '2025-01-01', group_revenue_eur: 750000000, cite: 'CTL Art. 3(3); Cabinet Decision 142 of 2024' },
  return_months: 9, pay_months: 9, cite: 'CTL Arts. 3, 48, 53(1); CD116; MD73; CD142; MoF Corporate Tax page',
};

/**
 * ⭐ THE PACK — the regulation contract (regulation.js) in one object. The chart rows keep their top-level names (groups · ledgers · expense_classes · income_classes) because
 * chart.js reads them there; `sch3` is the contract's NAME for the statement-line table — its content here is IAS 1's.
 */
/** v1.45.0 (FX1) — FOREIGN CURRENCY: which rate the tax value of a foreign-currency supply uses (data; the rate itself is evidence the owner enters or imports) */
const FX_AE = {
  standard: 'IAS 21: a foreign-currency transaction at the spot rate of its date; monetary items at the closing rate; differences to profit or loss',
  tax_rate_source: 'official',
  tax_rate_rule: 'VAT Decree-Law Art. 69: the UAE Central Bank rate at the date of supply; the rate applied is printed on the invoice (ER Art. 59(1)(k))',
  official_name: 'CBUAE exchange rate',
};

const PACK = {
  id: 'AE', version: '1.0.0', name: 'United Arab Emirates · VAT', verified: false,
  country: 'AE', basis: 'IAS 1 statement lines · IAS 16 straight-line (entity policy) · FTA VAT201 boxes', currency: 'AED',
  sch3: LINES_AE, groups: GROUPS_AE, ledgers: LEDGERS_AE,
  expense_classes: EXPENSE_CLASSES_AE, income_classes: INCOME_CLASSES_AE,
  asset_classes: ASSET_CLASSES_AE, entity_bases: ENTITY_BASES_AE,
  fiscalYear: FISCAL_YEAR,
  accountExtras: accountExtras,
  presentation: PRESENTATION, chart: CHART,
  depreciation: { assetClasses: ASSET_CLASSES_AE, entityBases: ENTITY_BASES_AE, compute: depreciationCompute },
  bank: BANK,
  cite: CITE, accrualPayableFor: accrualPayableFor,
  setOff: setOff, eventAliases: EVENT_ALIASES, messages: MESSAGES,
  taxHeads: TAX_HEADS, payHeads: TAX_HEADS, optionalHeads: [], taxLedgers: TAX_LEDGERS,
  rcmSettlement: 'netted',   /* v1.48.1: reverse-charge Due Tax (Box 3) is part of Box 12 and nets against Recoverable Tax on the form (RET §3.2) — not India's cash-only rule */
  voucherSeries: VOUCHER_SERIES_AE, manualSeries: MANUAL_SERIES_AE, voucherFormat: '{series}/{fy}/{n:6}',
  tax: TAX_AE,
  fx: FX_AE,
  /* v1.42.0 (CS2): the country's own locale (the row CBLocale.REGIONS.AE carried — an Arabic-region format; direction follows the LANGUAGE, locale.dir) and its one IANA zone */
  locale: { format: 'ar-AE', langs: ['ar', 'en', 'hi', 'ur', 'ml'], cur: ['AED'] },
  timeZones: ['Asia/Dubai'],
  /* the UAE's own rule functions and data (none is called by the core; the api / web read them by name) */
  trn: TRN, taxInvoice: taxInvoice, creditNote: CREDIT_NOTE, supplyKindOf: supplyKindOf, language: LANGUAGE,
  /* v1.39.0 (BAS1): the return's own words — `short` is what a screen calls it, `authority` / `portal` where the shop files it (ChitBridge prepares, it does not file) */
  returns: { id: 'VAT201', name: 'VAT return (Form VAT201)', short: 'VAT return', authority: 'FTA', portal: 'EmaraTax', frequencies: ['quarterly', 'monthly'], staggers: STAGGERS_AE, labels: BOX_LABELS, emirates: EMIRATES, periods: periods, vat201: vat201 },
  thresholds: { registration: TAX_AE.registration, simplified_invoice_upto_minor: TAX_AE.taxInvoice.simplified_upto_minor,
                einvoice_phase1_revenue_minor: 5000000000, corporate_tax_zero_band_minor: 37500000, small_business_relief_revenue_minor: 300000000,
                cite: 'ER Arts. 7–8 (registration); ER Art. 59(5) (AED 10,000); MD244 Art. 5(1) (AED 50,000,000); CD116 (AED 375,000); MD73 (AED 3,000,000)' },
  taxPeriod: TAX_PERIOD, records: RECORDS, retentionYears: 5,   /* TPL-ER Art. 3(1)(a): five years following the Tax Period */
  emirates: EMIRATES, designatedZones: DESIGNATED, einvoice: EINVOICE, corporateTax: CORPORATE_TAX,
  /* v1.41.0 (CPS1): what this pack LEAVES OUT and what is only PARTLY there, in its own words (the header's list, as data) — read by tools/country-matrix.cjs
     (docs/COUNTRY-STANDARD.md A10); a key names a member of the standard */
  scope: {
    out: {
      payroll: 'no payroll engine exists yet; named here so it is not forgotten',
    },
    partial: {
      taxId: 'a 15-digit FORMAT check only — no TRN check digit or fixed prefix was found in an official source (AE0 §14)',
      'tax.rcm': 'the three Decree-Law categories are data and the rcm_vat ledger exists; tax.determine does not yet assess UAE reverse charge on a purchase',
      returnBuilder: 'Box 1 is answered for ONE Emirate (the one handed in) — the sub-boxes 1a–1g are not split; Boxes 2 · 6 · 7 · 15 are left to the FTA',
      designatedZones: '23 zones are named; the FTA news count of 27 is noted — the four additions were not found in a fetched official document',
      einvoice: 'the mandate (dates, scope, mandatory fields, doc types) is data; PINT-AE generation is not built; the FTA reporting window is not yet fixed by the Minister',
      directTax: 'the rate bands and the payable ledger are present; nothing computes or posts Corporate Tax',
      sch3: 'English labels only; an Arabic label_ar beside each label waits for an Arabic-reading accountant (AE0 §14)',
    },
  },
};

const EXPORTS = PACK;

/* ⭐ ONE FILE, EVERY HOST: node takes module.exports; a page, the TV and the shop PC take window.CBRegAE. */
if (typeof module !== 'undefined' && module.exports) module.exports = EXPORTS;
if (root && typeof root.window !== 'undefined') root.window.CBRegAE = EXPORTS;
})(typeof globalThis !== 'undefined' ? globalThis : this);

/* ADOPTED from chitbridge-engines v1.48.1 · regulation · sha256 2a17f548b62f7ac91b79934fe29bd7d5fa81a53cb91a57a3b126b084ec0bc0e7 — DO NOT EDIT HERE. Change it in chitbridge-engines, release a version, then run tools/adopt.cjs. */
/* chitbridge-engines · regulation. Edited ONLY in chitbridge-engines/src/regulation.js; every platform adopts a released version of it. */
(function (root) {
'use strict';
// @stage tested
// @stage-note [BOOKS · REGULATION] The registry of country regulation packs and the contract a pack must meet: register · packFor · lookup · resolve · list · validate · status.
// @stage-note The accounting core never reads a global country: it is handed a pack (ctx.pack) and, when it is not, asks resolve(ctx) here.
/**
 * regulation.js — THE REGISTRY OF COUNTRY PACKS, AND THE CONTRACT THEY MEET (core-vs-packs step a3, v1.21.0, 2026-10-03).
 *
 * Athi, 2026-10-03: accounting principle and a country's regulation are SEPARATE layers; a country is a plug-in. docs/design/core-vs-packs/PLAN.md.
 * The core (posting, ledger, period, receivables …) holds double entry and the mechanisms; a PACK holds one country's chart, tax heads, set-off
 * order, statutory presentation, depreciation law, fiscal year and voucher prefixes. This file knows no country's law: it only knows which packs
 * are registered, which one a caller means, and whether a pack is whole.
 *
 * ── THE CONTRACT ───────────────────────────────────────────────────────────────────────────────────────────
 *   REQUIRED lists every member a pack must have (name · type), and `since` the step that made it required. A pack that fails validate() is refused
 *   by register() — never half-loaded. A pack may carry OPTIONAL members (tax · returns · einvoice · thresholds · bank · export · checks ·
 *   retentionYears); the core never calls them. The members are described in the plan, section 2.2.
 *   REQUIRED_ROLES lists the ledger ROLES the core looks up by name (debtors · creditors · round_off · suspense · stock · …): validate() refuses a pack whose chart has no ledger with one of them, and one whose
 *   taxLedgers[head].output / input / rcm names a role the chart lacks (rcm may be null — the core then refuses reverse charge on that head by name).
 *   ⚠️ A pack states its year ONCE, in fiscalYear. accounts-packs.yearOf_ still reads a legacy fy_start_month first (an ENTITY's own start month, handed in as ctx.pack), so a REGISTERED pack must carry no
 *   fy_start_month — or the one equal to fiscalYear.startMonth, as reg-in does; register() refuses a contradiction. A new country pack (reg-ae …) carries fiscalYear only.
 *   resolve({ pack }) validates a pack handed in and refuses one that is not whole, in plain words. A new BUILT-IN pack registers by one line in BUILT_IN_ (its script global and file) — nothing else here changes.
 *     id            ISO 3166-1 alpha-2, upper case       version     'major.minor.patch'      name   what a person reads      verified   boolean
 *     currency      the functional-currency default      fiscalYear  { startMonth 1-12, label 'split' | 'single' }
 *     groups · ledgers · expense_classes · income_classes   the chart, as rows (accounts-packs documents the row shapes)
 *     sch3          the statutory statement lines, in statement order     asset_classes · entity_bases   the depreciation tables
 *     accountExtras(row, group, pack) → the account fields that are the country's own (b1)     voucherSeries · manualSeries · voucherFormat   the voucher prefixes and shape (b1)
 *     taxHeads · payHeads · optionalHeads · taxLedgers   the tax heads in line order, the heads a payment may name, the heads shown only with an amount, and each head's output / input / rcm ledger (b2)
 *     setOff({ output, input }, minor) → { utilised, payable, carried } in minor units — the ORDER of set-off; eventAliases { oldName: neutralName }; messages — the refusals that name the country's terms (b3)
 *     messages.paymentRef { label, ask, hint, narration } · messages.setOffNarration — the words a statutory tax payment / set-off is recorded under (v1.48.0; MAY, checked for shape when present)
 *     rcmSettlement 'cash' | 'netted' — how reverse-charge tax is settled: paid in cash beside the set-off (IN s.49(4)) or netted on the return with the recoverable tax (AE Box 12/13) (v1.48.1; MUST for a pack with an rcm ledger)
 *     depreciation { assetClasses, entityBases, compute(rows, base, ctx) → { total, rate, per } } — the depreciation law, per asset class, in minor units (b4)
 *     presentation { lines, lineOf, labelOf, placed, taxNetting, creditLine, payableLine, profitLine, ownerCapitalBases, ageing, labels } — the form of the statements; chart.kinds — the groups the core reads by kind (b5)
 *     chart.paymentModes — mode → the real account it lands on; cite — the standards a refusal quotes; accrualPayableFor(account) → the ledger an accrued expense is owed on (b6)
 *
 * ── WHICH PACK ─────────────────────────────────────────────────────────────────────────────────────────────
 *   resolve({ pack?, country? }) → the pack object a caller handed in (ctx.pack), else the registered pack for ctx.country, else DEFAULT.
 *   lookup(country)              → the registered pack, or — for a country with no pack — the DEFAULT one with { fallback: true, asked } said, never silent.
 *   packFor(id, version?)        → the registered pack or null. Case and spaces do not matter; an unknown id or version is null, never a guess.
 *   status(country, { name? })   → { country, name, pack, version, books, code, why }: whether books may open there, and the ONE sentence when not (v1.36.0).
 *
 * ── ZERO DEPENDENCIES BUT THE PACKS · NO CLOCK · NO STORAGE ──────────────────────────────────────────────────
 */
/* ⭐ v1.28.0 (review fix): the BUILT-IN packs, registered below. A country pack is added by listing its script global and file here — one entry, no other edit; register() and the core know no country. The default (IN) comes first. */
var BUILT_IN_ = [['CBRegIN', './reg-in'], ['CBRegAU', './reg-au'], ['CBRegAE', './reg-ae']];   /* v1.34.0 (AU1): Australia; v1.37.0 (AE1): the UAE — the one line a new country adds (packs/TEMPLATE.md, tools/new-pack.cjs) */
function builtIns_() {
  var G = (typeof globalThis !== 'undefined' ? globalThis : root), out = [];
  BUILT_IN_.forEach(function (b) {
    var v = (G[b[0]] && G[b[0]].id) ? G[b[0]] : null;
    if (!v && typeof require === 'function') v = require(b[1]);
    if (v) out.push(v);
  });
  return out;
}

/** [member, type, since]: type 'string' | 'boolean' | 'number' | 'object' | 'array' | 'function'; a dotted member is read through its parent */
const REQUIRED = [
  ['id', 'string', 'a'], ['version', 'string', 'a'], ['name', 'string', 'a'], ['verified', 'boolean', 'a'], ['currency', 'string', 'a'],
  ['fiscalYear', 'object', 'a'], ['fiscalYear.startMonth', 'number', 'a'], ['fiscalYear.label', 'string', 'a'],
  ['groups', 'array', 'a'], ['ledgers', 'array', 'a'], ['expense_classes', 'array', 'a'], ['income_classes', 'array', 'a'],
  ['sch3', 'object', 'a'], ['asset_classes', 'array', 'a'], ['entity_bases', 'object', 'a'],
  ['accountExtras', 'function', 'b1'], ['voucherSeries', 'object', 'b1'], ['manualSeries', 'string', 'b1'], ['voucherFormat', 'string', 'b1'],
  ['taxHeads', 'array', 'b2'], ['payHeads', 'array', 'b2'], ['optionalHeads', 'array', 'b2'], ['taxLedgers', 'object', 'b2'],
  ['setOff', 'function', 'b3'], ['eventAliases', 'object', 'b3'], ['messages', 'object', 'b3'],
  ['depreciation', 'object', 'b4'], ['depreciation.assetClasses', 'array', 'b4'], ['depreciation.entityBases', 'object', 'b4'], ['depreciation.compute', 'function', 'b4'],
  ['presentation', 'object', 'b5'], ['presentation.lines', 'object', 'b5'], ['presentation.lineOf', 'function', 'b5'], ['presentation.labelOf', 'function', 'b5'], ['presentation.placed', 'function', 'b5'],
  ['presentation.taxNetting', 'array', 'b5'], ['presentation.creditLine', 'string', 'b5'], ['presentation.payableLine', 'string', 'b5'], ['presentation.profitLine', 'string', 'b5'],
  ['presentation.ownerCapitalBases', 'array', 'b5'], ['presentation.ageing', 'object', 'b5'], ['presentation.labels', 'object', 'b5'], ['chart', 'object', 'b5'], ['chart.kinds', 'object', 'b5'],
  ['chart.paymentModes', 'object', 'b6'], ['chart.kinds.loans', 'array', 'b6'], ['chart.kinds.cash', 'string', 'b6'], ['chart.kinds.bank', 'string', 'b6'], ['cite', 'object', 'b6'], ['cite.inventoryFormula', 'string', 'b6'], ['cite.lowerOfCostNrv', 'string', 'b6'], ['accrualPayableFor', 'function', 'b6'],
];

/** members a pack MAY have — the core never calls them; the engines at its edges (receivables, bank-recon, bookpack) refuse in plain words when theirs is missing. Checked for type only when present. */
/** the ledger ROLES the core looks up by name (posting · ledger · period · receivables · bookpack) — a pack must carry a ledger with each, or the core fails mid-book; every taxLedgers[head].output / input / rcm must name one too */
const REQUIRED_ROLES = ['debtors', 'creditors', 'round_off', 'suspense', 'stock', 'retained', 'sales', 'purchases', 'sales_returns', 'purchase_returns', 'changes_in_inventories', 'cash', 'bank', 'capital', 'drawings', 'depreciation', 'customer_advance', 'supplier_advance', 'prepaid_expenses', 'accrued_income', 'income_in_advance', 'gain_on_disposal', 'loss_on_disposal', 'bad_debts'];
/* fx: v1.45.0 (FX1) — { standard, tax_rate_source, tax_rate_rule, official_name }: which rate the law wants for the tax value of a foreign-currency supply (never a number) */
const OPTIONAL = [['tax', 'object'], ['returns', 'object'], ['einvoice', 'object'], ['thresholds', 'object'], ['bank', 'object'], ['export', 'object'], ['checks', 'object'], ['retentionYears', 'number'], ['moveIn', 'object'], ['scope', 'object'],
                  ['locale', 'object'], ['timeZones', 'array'], ['fx', 'object']];   /* moveIn: v1.38.0 (IM1) — their account types / tax codes → this chart, as data. scope: v1.41.0 (CPS1) — { out, partial }: what the pack leaves out and why, in its own words (docs/COUNTRY-STANDARD.md A10). locale · timeZones: v1.42.0 (CS2) — the country's { format, langs, cur } and its IANA zones (A1 · A3), so the Country setup step reads the PACK and not locale.js / govcontext.js */

function typeOk_(v, t) {
  if (t === 'array') return Array.isArray(v);
  if (t === 'object') return v !== null && typeof v === 'object' && !Array.isArray(v);
  return typeof v === t;
}
function read_(o, path) {
  var parts = path.split('.'), v = o;
  for (var i = 0; i < parts.length; i++) { if (v === null || v === undefined) return undefined; v = v[parts[i]]; }
  return v;
}

/** validate(pack) → the REQUIRED members it lacks or has the wrong type for, each as 'member (type)' — [] when the pack is whole */
function validate(pack) {
  if (pack === null || typeof pack !== 'object') return REQUIRED.map(function (r) { return r[0] + ' (' + r[1] + ')'; });
  var missing = REQUIRED.filter(function (r) { return !typeOk_(read_(pack, r[0]), r[1]); }).map(function (r) { return r[0] + ' (' + r[1] + ')'; });
  OPTIONAL.forEach(function (o) { if (pack[o[0]] !== undefined && !typeOk_(pack[o[0]], o[1])) missing.push(o[0] + ' (' + o[1] + ', when present)'); });
  if (typeof pack.id === 'string' && !/^[A-Z]{2}$/.test(pack.id) && missing.indexOf('id (string)') < 0) missing.push('id (an ISO 3166-1 alpha-2 code, upper case)');
  if (typeof pack.version === 'string' && !/^\d+\.\d+\.\d+$/.test(pack.version) && missing.indexOf('version (string)') < 0) missing.push('version (major.minor.patch)');
  if (pack.fiscalYear && typeof pack.fiscalYear.startMonth === 'number' && !(pack.fiscalYear.startMonth >= 1 && pack.fiscalYear.startMonth <= 12 && Math.floor(pack.fiscalYear.startMonth) === pack.fiscalYear.startMonth)) missing.push('fiscalYear.startMonth (1-12)');
  if (pack.fiscalYear && typeof pack.fiscalYear.label === 'string' && pack.fiscalYear.label !== 'split' && pack.fiscalYear.label !== 'single') missing.push("fiscalYear.label ('split' or 'single')");
  /* v1.48.0: a pack that names its payment-reference words names all four, as strings — a platform paints them as the label, the question, the hint and the narration */
  if (pack.messages && pack.messages.paymentRef != null) {
    var pr = pack.messages.paymentRef;
    if (typeof pr !== 'object' || ['label', 'ask', 'hint', 'narration'].some(function (k) { return typeof pr[k] !== 'string' || !pr[k]; })) missing.push('messages.paymentRef with label, ask, hint and narration (strings)');
  }
  if (pack.messages && pack.messages.setOffNarration != null && typeof pack.messages.setOffNarration !== 'string') missing.push('messages.setOffNarration (string)');
  if (pack.retentionYears != null && !(typeof pack.retentionYears === 'number' && pack.retentionYears > 0)) missing.push('retentionYears above nothing');
  /* v1.48.1: a pack whose chart holds a reverse-charge ledger says how that tax is settled — the platform's close pays it in cash or refuses to guess a netting it cannot post */
  var hasRcm = !!(pack.taxLedgers && typeof pack.taxLedgers === 'object' && Object.keys(pack.taxLedgers).some(function (h) { return pack.taxLedgers[h] && pack.taxLedgers[h].rcm; }));
  if (hasRcm && pack.rcmSettlement !== 'cash' && pack.rcmSettlement !== 'netted') missing.push("rcmSettlement ('cash' or 'netted') for a pack with a reverse-charge ledger");
  if (!hasRcm && pack.rcmSettlement != null) missing.push('rcmSettlement on a pack with no reverse-charge ledger');
  if (Array.isArray(pack.ledgers)) {
    var roles = Object.create(null);
    pack.ledgers.forEach(function (l) { if (l && l.role) roles[l.role] = true; });
    REQUIRED_ROLES.forEach(function (r) { if (!roles[r]) missing.push('a ledger with role ' + r); });
    if (pack.taxLedgers && typeof pack.taxLedgers === 'object') Object.keys(pack.taxLedgers).forEach(function (h) {
      var t = pack.taxLedgers[h] || {};
      ['output', 'input', 'rcm'].forEach(function (k) {   /* rcm may be null: the head has no reverse-charge ledger, and the core refuses it by name */
        if (k === 'rcm' && t[k] == null) return;
        if (!t[k] || !roles[t[k]]) missing.push('taxLedgers.' + h + '.' + k + ' naming a ledger role in the chart');
      });
    });
  }
  return missing;
}

const REGISTRY = Object.create(null);          /* id → [packs, in the order registered] */
const DEFAULT = 'IN';

/** register(pack) → the pack — refused (throws) when it fails validate() or when that id + version is already registered */
function register(pack) {
  var bad = validate(pack);
  if (bad.length) throw new Error('A regulation pack is refused: it lacks ' + bad.join(', ') + '.');
  var list = REGISTRY[pack.id] || (REGISTRY[pack.id] = []);
  if (list.some(function (p) { return p.version === pack.version; })) throw new Error('The regulation pack ' + pack.id + '@' + pack.version + ' is already registered.');
  /* accounts-packs.yearOf_ prefers a legacy fy_start_month over fiscalYear. An ENTITY's pack may override the month (resolve accepts it), but a REGISTERED country pack must not contradict its own fiscalYear — a pack with fiscalYear carries no fy_start_month (reg-ae must not) */
  if (pack.fy_start_month !== undefined && pack.fy_start_month !== pack.fiscalYear.startMonth) throw new Error('A regulation pack is refused: it carries fy_start_month ' + pack.fy_start_month + ' beside fiscalYear.startMonth ' + pack.fiscalYear.startMonth + ' — a pack states its year once, in fiscalYear.');
  list.push(pack);
  return pack;
}
function key_(id) { return String(id == null ? '' : id).trim().toUpperCase(); }
/** packFor('in') → the latest registered pack for that id; packFor('IN', '1.0.0') → that exact version; an unknown id or version is null, never a guess */
function packFor(id, version) {
  var list = REGISTRY[key_(id)];
  if (!list || !list.length) return null;
  if (version == null || version === '') return list[list.length - 1];
  for (var i = 0; i < list.length; i++) if (list[i].version === String(version)) return list[i];
  return null;
}
/** the packs registered, the latest version of each id, in the order the ids were first registered */
function list() { return Object.keys(REGISTRY).map(function (k) { return REGISTRY[k][REGISTRY[k].length - 1]; }); }
/** lookup(country) → its pack, or the DEFAULT one marked { fallback: true, asked } — an unknown country is said, never silent */
function lookup(country) {
  var c = key_(country), p = packFor(c);
  if (p) return p;
  return Object.assign({ fallback: true, asked: c || null }, packFor(DEFAULT));
}
/**
 * resolve(ctx, { strict? }) → ctx.pack when one was handed in; else lookup(ctx.country), else the DEFAULT pack.
 * ⭐ { strict: true } is what a RUNTIME uses (Athi, 2026-10-03: a shop with no country is REFUSED — no silent fallback to India): no pack and no country is
 * a refusal in plain words, and so is a country with no pack — the books are never opened on a guess. The lenient form above is kept ONLY because every
 * existing caller and test hands in no country and has always read India; it still says so ({ fallback: true }) when the country was unknown.
 */
function resolve(ctx, opt) {
  var c = ctx || {};
  if (c.pack !== null && typeof c.pack === 'object') {
    var bad = validate(c.pack);
    if (bad.length) throw refuse_('The regulation pack handed in is not whole: it lacks ' + bad.slice(0, 5).join(', ') + (bad.length > 5 ? ' and ' + (bad.length - 5) + ' more' : '') + '.');
    return c.pack;
  }
  if (opt && opt.strict) {
    var id = key_(c.country);
    if (!id) throw refuse_('This shop has no country, so no regulation pack applies. Set the shop country before its books are opened; they are never opened on a guess.');
    var p = packFor(id, c.pack_version);
    if (!p) throw refuse_('There is no regulation pack for ' + id + (c.pack_version ? ' version ' + String(c.pack_version).slice(0, 20) : '') + ' yet, so its books cannot be opened.');
    return p;
  }
  return lookup(c.country || DEFAULT);
}
function refuse_(why) { var e = new Error(why); e.refused = true; e.status = 422; return e; }

/**
 * ⭐ v1.36.0 (CS1): status(country, { name? }) → WHAT A SHOP IN THAT COUNTRY GETS, SAID ONCE — the server's books gate and the
 * Country setup screen both read this object, so a country with no pack is told in the same words everywhere (Athi, 2026-10-03:
 * a shop with no country is refused; a country with no pack is said, never silently India). The lookup() fallback above stays
 * for READING old chits only; nothing that OPENS books reads it.
 *   { country: 'AU', name: 'Australia', pack: null, version: null, books: false, code: 'NO_COUNTRY_PACK', why: '<the sentence>' }
 *   { country: 'IN', name: 'India', pack: 'IN', version: '1.0.0', books: true, code: null, why: null }
 *   { country: null, …, books: false, code: 'NO_COUNTRY', why: 'Set the shop country first …' }
 * name is what a person reads (the caller's locale knows it); without one the ISO code stands in — never a guess.
 */
function status(country, opt) {
  var c = key_(country), name = (opt && opt.name) ? String(opt.name) : '';
  if (!c) return { country: null, name: '', pack: null, version: null, books: false, code: 'NO_COUNTRY', why: 'Set the shop country first. The books never open on a guess.' };
  var p = packFor(c);
  if (p) return { country: c, name: name || p.name, pack: p.id, version: p.version, books: true, code: null, why: null };
  return { country: c, name: name || c, pack: null, version: null, books: false, code: 'NO_COUNTRY_PACK',
    why: 'ChitBridge does not keep books for ' + (name || c) + ' yet — selling and the rail still work; books arrive when its pack ships.' };
}

builtIns_().forEach(register);

const EXPORTS = { DEFAULT, REQUIRED, REQUIRED_ROLES, OPTIONAL, register, packFor, lookup, resolve, list, validate, status };

/* ⭐ ONE FILE, EVERY HOST: node takes module.exports; a page, the TV and the shop PC take window.CBRegulation. */
if (typeof module !== 'undefined' && module.exports) module.exports = EXPORTS;
if (root && typeof root.window !== 'undefined') root.window.CBRegulation = EXPORTS;
})(typeof globalThis !== 'undefined' ? globalThis : this);

/* ADOPTED from chitbridge-engines v1.37.0 · tax-packs · sha256 e3885990e20a64aada0f545316e520176ff3601d9d5a6c6b2d73ce56b00c6248 — DO NOT EDIT HERE. Change it in chitbridge-engines, release a version, then run tools/adopt.cjs. */
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
/* ⭐ v1.21.0 (core-vs-packs a2): the India tax pack moved, unchanged, to src/reg-in.js (its `tax` member). PACKS.IN is that same frozen object.
   v1.28.0 (review fix): no second registry — PACKS is read from the regulation registry (every registered pack's `tax` member), as accounts-packs reads its chart. */
var REG_ = (typeof CBRegulation !== 'undefined' && CBRegulation && CBRegulation.list) ? CBRegulation : null;
if (!REG_ && typeof require === 'function') REG_ = require('./regulation');
if (!REG_) throw new Error('tax-packs.js needs regulation.js (CBRegulation, with the India pack) loaded before it — add the regulation scripts ahead of this one on the page; see the CHANGELOG, v1.28.0.');
const PACKS = Object.freeze(REG_.list().reduce(function (t, p) { if (p.tax) t[p.id] = p.tax; return t; }, {}));

const DEFAULT_COUNTRY = REG_.DEFAULT;

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

/* ADOPTED from chitbridge-engines v1.49.0 · tax · sha256 62ec56f708bc5697293a8304e205d682dbdf4ca4d6ae904254dbe160ec4907bb — DO NOT EDIT HERE. Change it in chitbridge-engines, release a version, then run tools/adopt.cjs. */
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
 * → { assessable, tax, base } — `assessable` is the line's taxable value; `tax` is the heads' sum before the split;
 *   `base` is the value the rate was applied to (= assessable on an exclusive line).
 *
 * ⭐⭐ v1.43.0 (ENG-R1) — A TAX-INCLUSIVE LINE TOTALS EXACTLY ITS PRICE. The shopper paid `net`, so the invoice line says `net`.
 * Before, the taxable value and the tax were each rounded and then re-added: 2 × 65.00 @ 5% intra printed 130.01 (123.81 + 3.10
 * + 3.10), 3 × 40.00 @ 18% intra 119.99. Now the TAX is computed as it always was (the rate on the worked-back base, each head
 * rounded once, half-up) and the TAXABLE VALUE is the remainder: assessable = net − tax. The cent lands in the taxable value,
 * never in the tax. ⚠️ ONE RULE FOR EVERY PACK, because every pack rounds the TAX per line, half-up, and none fixes the taxable
 * value's last cent: IN — INV-01 carries each item's tax (the IRP allows ±Rs 1 against AssAmt × rate); AU — the ATO lets a
 * supplier round per line or per invoice, and determine() has always rounded per line; AE — ER Art. 61, tax rounded to the fils
 * per supply, half-up (reg-ae `line_tax_rounding`).
 * `supply` / `split` (optional — determine() passes them): the tax taken out is the SUM OF THE HEADS lineHeads gives, so an
 * intra-state line's CGST + SGST (each at half the rate) is exactly what leaves the price. Without them, the whole rate, as before.
 * A line on which no head is levied (zero-rated, a cross-border or undecided supply) keeps the worked-back base — unchanged.
 *
 * ⭐⭐ v1.49.0 (ENG-FIX2, the Claude review C2 · H1 · H7) — ONE EXACT BASE, ONE ROUNDING PER HEAD, THE CESS INSIDE THE PRICE.
 *   H1: v1.43.0 rounded the worked-back base and then rounded each head again — a cent HIGH, always upward, on 9% of AU prices and 5% of
 *       AE ones (AU $9.95 billed GST 0.91 for 0.90); a shop over-reported on every BAS 1A. Every head is now its rate on the EXACT base,
 *       rounded once, half-up: tax = round(price × rate ÷ (100 + rate)), taxable = price − tax.
 *   C2: an MRP already contains the compensation cess, so the base is worked back by (100 + rate + cess rate) — MRP 140 @ 28% + 12% is
 *       taxable 100 · GST 28 · cess 12 · total 140 (v1.43.0 billed 153.13, more than the printed MRP). `cessRate` is the new, optional input.
 *   H7: the cess follows zero-rating as the GST heads always did (a composition seller charged 0 GST and 12 cess).
 * Told the supply, the heads it took out ride on the answer (`heads`); given a cess rate, so does the cess (`cess`) — PRESENT ONLY THEN, so
 * every caller that did not ask keeps the three-key shape { assessable, tax, base }. itemLine paints these heads; it never re-derives them.
 */
function splitLineTax({ net, rate, cessRate, priceIncludesTax, zeroRate, supply, split }) {
  const n = Math.max(0, num(net)), rt = num(rate), cessRt = zeroRate ? 0 : num(cessRate);
  const told = supply !== undefined, splits = split === undefined ? true : !!split;
  const levied = !zeroRate && (!told || (splits ? (supply === 'intra' || supply === 'inter') : supply === 'domestic'));
  const exact = priceIncludesTax ? n * 100 / (100 + rt + cessRt) : n;
  const base = r2(exact);
  const heads = told ? lineHeads({ supply, split: splits, assessable: exact, rate: zeroRate ? 0 : rt }) : null;
  let tax = zeroRate ? 0 : r2(exact * rt / 100);
  if (heads && levied) tax = r2(heads.cgst + heads.sgst + heads.igst + heads.vat);
  const cess = r2(exact * cessRt / 100);
  const assessable = priceIncludesTax && levied ? Math.max(0, r2(n - tax - cess)) : base;
  const out = { assessable, tax, base };
  if (cessRate !== undefined) out.cess = cess;
  if (heads) out.heads = heads;
  return out;
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
  /* v1.43.0: on an inclusive line `assessable` is net − the heads − the cess, so TotItemVal = net exactly; v1.49.0: the heads and the
     cess are the split's own (one exact base, one rounding each) — this paints them, it never works them out again */
  const split = splitLineTax({ net, rate, cessRate: num(l.cess_rate), priceIncludesTax: ctx.priceIncludesTax, zeroRate: ctx.zeroRate,
    supply: ctx.supply, split: ctx.split });
  const assessable = split.assessable, base = split.base, CesAmt = split.cess;

  /**
   * ⭐ THE SPLIT IS ARITHMETIC, THE DECISION WAS MADE ABOVE. Intra-state halves the rate into CGST and SGST;
   * inter-state puts the whole rate on IGST. Halving an odd rate (5% → 2.5% + 2.5%) is exact in the rate and can
   * be a half-paisa in the amount, so CGST takes the rounded half and SGST takes the remainder — the two always
   * sum to the total, which is what a counterparty's system reconciles against.
   */
  /* ⭐ ONE HEAD FOR A VAT-TYPE SCHEME (b202: DE-VAT-19, FR-VAT-20 …). VAT does not split by state; it is charged in
     full on a domestic supply and, between businesses across a border, not charged at all (export zero-rated /
     reverse charge in the buyer's country). The GST heads stay 0 so an Indian reader of the block is not misled. */
  /* each head at its own rate on the taxable value (v1.12.0) — a zero-rated line carries no rate into the heads; told the supply (determine
     always is) the split handed them over, the fallback is for a caller that built a ctx without one */
  const heads = split.heads || lineHeads({ tax: split.tax, supply: ctx.supply, split: ctx.split, assessable: base, rate: ctx.zeroRate ? 0 : rate });
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
    /* the split's cess: its rate on the exact base, inside an MRP (v1.49.0 C2), 0 when the invoice is zero-rated (H7) */
    CesAmt,
    TotItemVal: r2(assessable + IgstAmt + CgstAmt + SgstAmt + TaxAmt + CesAmt),
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
  /* ⭐ v1.34.0 (AU1): the seller's OWN country's pack decides when it carries this scheme — two countries both call their tax 'GST' (India splits by
     state, Australia does not), so the scheme alone cannot pick the pack. A seller with no country, or a scheme its pack does not carry, reads as before. */
  const pack = (homePack && String(homePack.scheme || '').toUpperCase() === scheme) ? homePack : P.packForScheme(scheme);
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
   *   seller unregistered → NO tax may be collected (v1.49.0, ENG-FIX2 C1): a seller not registered for the scheme cannot charge it, in
   *                        every pack — India below the threshold, an AU business under $75k, a UAE trader under the mandatory limit.
   *                        The counter always said so through `zeroRated`; the server's invoice path reads the party and did not.
   *                        ⚠️ Reverse charge is NOT silenced by it: an unregistered SUPPLIER is the commonest RCM case — the recipient
   *                        self-assesses that line's heads (see the RCM branch below), the supplier's own heads stay 0.
   * `RegType` on either party: 'regular' | 'composition' | 'unregistered' | 'sez'. Absent = regular.
   */
  const regOf = (p) => String(p.RegType || p.reg_type || p.gst_registration || 'regular').trim().toLowerCase();
  const sellerComposition = regOf(seller) === 'composition';
  const sellerUnregistered = regOf(seller) === 'unregistered';
  const buyerSez = regOf(buyer) === 'sez';
  const buyerUnregistered = regOf(buyer) === 'unregistered';
  const zeroRatedSupply = sellerComposition || buyerSez || !!inp.zeroRated;
  const zeroRate = zeroRatedSupply || sellerUnregistered;
  if (sellerComposition) notes.push('Composition scheme: no GST is charged on this invoice. The tax is paid on turnover, and the buyer cannot claim credit.');
  if (sellerUnregistered) notes.push('The seller is not registered for ' + scheme + ', so no ' + scheme + ' is charged on this invoice. The rate is stated for the record; the buyer gets no credit.');
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
  const rcmPack = inp.rcm && split && !zeroRatedSupply && pack && pack.rcm ? pack : null;
  const supplierRegistered = !!String(seller.Gstin || seller.gstin || '').trim() && regOf(seller) !== 'unregistered';
  const recipientRegistered = !!String(buyer.Gstin || buyer.gstin || '').trim() && regOf(buyer) !== 'unregistered';
  const rcmOf = [], kindsOf = [];
  /**
   * ⭐ v1.34.0 (AU1) — A LINE'S SUPPLY KIND FROM THE PACK (GST Act Div 38 GST-free · Div 40 input taxed; the table is the pack's `supplyKinds`, none is
   * named here). A line that names a kind (`supply_kind`) takes that kind's rate — 0 for a GST-free or input-taxed line — and the invoice SAYS WHY, in
   * the notes and in `_cb.kinds` (present only when a line named one, so every other invoice keeps its shape). A pack with no table reads as before.
   */
  const kinds = pack && pack.supplyKinds && typeof pack.supplyKinds === 'object' ? pack.supplyKinds : null;
  const ItemList = linesIn.map((l, i) => {
    let line = l || {};
    const named = kinds && (line.supply_kind || line.tax_kind);
    if (named) {
      const key = String(named).trim().toLowerCase().replace(/-/g, '_');
      const kind = Object.prototype.hasOwnProperty.call(kinds, key) ? kinds[key] : null;
      if (!kind) notes.push('Line ' + (i + 1) + ': "' + String(named).slice(0, 20) + '" is not a supply kind this pack knows (' + Object.keys(kinds).join(', ') + '); the line\'s own rate was used.');
      else {
        const given = line.rate !== undefined && line.rate !== null && line.rate !== '' ? line.rate : line.gst_rate;
        const rate = kind.rate === 0 ? 0 : (given !== undefined && given !== null && given !== '' ? num(given) : num(kind.rate));
        line = Object.assign({}, line, { rate });
        if (kind.rate === 0) notes.push('Line ' + (i + 1) + ': ' + kind.why);
        kindsOf[i] = { line: i, kind: kind.id || key, rate, credit: kind.credit, bas: kind.bas || null, why: kind.why || null };
        /* v1.37.0 (AE1): a pack whose return is not a BAS names the kind's return BOX (reg-ae: VAT201 Box 1 · 4 · 5) — present only when the pack's row has one, so every AU row keeps its shape */
        if (kind.box != null) kindsOf[i].box = String(kind.box);
      }
    }
    const cat = rcmPack ? P.rcmCategoryFor(rcmPack, { id: line.rcm_category, code: line.hsn || line.hsn_code || line.HsnCd }) : null;
    if (!cat || !recipientRegistered || !(cat.always || !supplierRegistered)) return itemLine(line, ctx, i);
    const given = line.rate !== undefined && line.rate !== null ? line.rate : line.gst_rate;
    const hasRate = given !== undefined && given !== null && given !== '';
    const opt = (hasRate ? cat.rates.find((r) => r.rate === num(given)) : null) || cat.rates[0];
    const rate = hasRate ? num(given) : num(opt.rate);
    if (hasRate && opt.rate !== null && opt.rate !== num(given)) notes.push('Line ' + (i + 1) + ': ' + rate + '% is not a rate the notification gives for ' + cat.name + ' (' + cat.rates.map((r) => r.rate).join(' or ') + '%); credit was read as for the first option.');
    /* the recipient self-assesses this line: its heads are computed even when the (unregistered) supplier may charge none */
    const it = itemLine(Object.assign({}, line, { rate }), Object.assign({}, ctx, { priceIncludesTax: false, zeroRate: false }), i);
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
    if (it.TaxAmt) s.TaxVal = (s.TaxVal || 0) + it.TaxAmt;   /* v1.34.0: the ONE head of a scheme that does not split (AU GST, a VAT) — absent when nil, so every India slab keeps its shape */
  }
  AssVal = r2(AssVal); CgstVal = r2(CgstVal); SgstVal = r2(SgstVal);
  IgstVal = r2(IgstVal); CesVal = r2(CesVal); Discount = r2(Discount); TaxVal = r2(TaxVal);
  for (const k of Object.keys(bySlab)) {
    const s = bySlab[k];
    s.AssVal = r2(s.AssVal); s.CgstVal = r2(s.CgstVal); s.SgstVal = r2(s.SgstVal); s.IgstVal = r2(s.IgstVal); s.CesVal = r2(s.CesVal);
    if (s.TaxVal !== undefined) s.TaxVal = r2(s.TaxVal);
  }
  const kindLines = kindsOf.filter(Boolean);

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
           ...(kindLines.length ? { kinds: kindLines } : {}),   /* v1.34.0: the supply kind each line named (GST-free · input-taxed · taxable), with why */
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
  /* v1.34.0 (AU1): the ONE head of a scheme that does not split is named by its scheme, lower case — `gst` for Australia, `vat` for a VAT country — the same
     name the country's pack gives the head (reg-au taxHeads: ['gst']), so the books post by_rate[rate].gst as they post India's cgst. Absent on every India slab. */
  const single = String(cb.scheme || 'tax').toLowerCase();
  for (const s of (cb.slabs || [])) {
    const rt = num(s.GstRt), one = num(s.TaxVal);
    by_rate[String(rt)] = { taxable: r2(num(s.AssVal)), cgst: r2(num(s.CgstVal)), sgst: r2(num(s.SgstVal)), igst: r2(num(s.IgstVal)),
                            tax: r2(num(s.CgstVal) + num(s.SgstVal) + num(s.IgstVal) + num(s.CesVal) + one) };
    if (num(s.CesVal)) by_rate[String(rt)].cess = r2(num(s.CesVal));     /* v1.16.0: the slab's cess, so the books post it; absent when nil (the shape is unchanged for every other invoice) */
    if (one) by_rate[String(rt)][single] = r2(one);
    if (!rt) continue;
    if (one && supply === 'domestic') heads.push({ name: String(cb.scheme || 'TAX').toUpperCase(), rate: rt, base: r2(num(s.AssVal)), amount: r2(one) });
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
