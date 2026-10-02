/* ADOPTED from chitbridge-engines v1.16.0 · accounts-packs · sha256 6b28f3c9cc7f6a039baf586616dd55e42e11821d52b236c52cf1cc698e2ccb7e — DO NOT EDIT HERE. Change it in chitbridge-engines, release a version, then run tools/adopt.cjs. */
/* chitbridge-engines · accounts-packs. Edited ONLY in chitbridge-engines/src/accounts-packs.js; every platform adopts a released version of it. */
(function (root) {
'use strict';
// @stage tested
// @stage-note [BOOKS] A country's chart of accounts as DATA — groups (Tally's 28), numbered ledgers, expense and income
// @stage-note classes, the Schedule III line and SAF-T grouping beside every code, the fiscal year and the number formats.
// @stage-note The posting engine reads it; nothing here posts anything. tests/accounts-packs.test.js holds it whole.
/**
 * accounts-packs.js — WHAT A COUNTRY'S LEDGERS ARE CALLED, NUMBERED AND HOW THEY BEHAVE, AS DATA (v1.8.0, 2026-09-29).
 *
 * Athi, 2026-09-28: *"we don't claim as an accounting system until we are well confident, but still record the information
 * according to principle."* — and 2026-09-29: *"a proper number for the ledger for each person, sale / purchase, and income,
 * expenses. so we can very quickly aggregate against portfolio … find out the entire logic from standard or other
 * implementations so we don't do anything different."* [SPEC-books-v2.md §2 · RESEARCH-ledger-design-2026-09-29.md §6.2]
 * ⚠️⚠️ THIS IS NOT A CLAIM TO BE ACCOUNTING SOFTWARE. It names and numbers ledgers the way a CA already reads them.
 *
 * v1.16.0: GST Compensation Cess ledgers 2203 / 2213; the Insurance expense class (6140); voucherNo(series, fy, n) + VOUCHER_SERIES + MANUAL_SERIES.
 *
 * ⭐ INDIA FIRST, AS DATA ([[feedback-country-first]]) — a country is an ENTRY here, never a branch in posting.js.
 *
 * ── A LEDGER ROW (v1.8.0) ──────────────────────────────────────────────────────────────────────────────────────
 *   role   what a posting rule names — 'debtors', 'output_cgst', 'rent' … (v1.7.0 called this `code`; the VALUES are
 *          unchanged, so every rule keeps working). Rules name ROLES, never numbers (SAP account determination,
 *          ERPNext/Odoo account_type): a shop may renumber and no rule moves.
 *   code   the 4-digit ledger number, first digit = class (1 assets · 2 liabilities · 3 equity · 4 income · 5 purchases
 *          and direct costs · 6 indirect expenses · 9 memo) — the common SME convention (QuickBooks/Xero, SKR04/PCG class
 *          order). India prescribes no numbers; Schedule III fixes only the statement lines, stored beside the code.
 *   group  the Tally group it sits under (Tally's 28 predefined groups — what every Indian CA reads)
 *   sch3   the Schedule III (Division I) line it lands on · saft {category, code} — the grouping a SAF-T-shaped export
 *          uses (India has no SAF-T mandate; the OECD shape is used as a completeness checklist, research offload §1)
 *
 * ── A GROUP ────────────────────────────────────────────────────────────────────────────────────────────────────
 *   type    personal (Dr the receiver, Cr the giver) · real (Dr what comes in, Cr what goes out) · nominal (Dr expenses
 *           and losses, Cr incomes and gains) — the golden rule a line follows
 *   nature  asset · liability · equity · income · expense — where it lands in a trial balance
 *   side    'dr' or 'cr' — its NORMAL balance
 *   range   [lo, hi] — the codes a ledger under this group may take; a shop's own ledger gets the next free one
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

const PACKS = {
  IN: { country: 'IN', basis: "Tally's 28 predefined groups · Schedule III Division I", currency: 'INR', fy_start_month: 4,
        sch3: SCH3, groups: GROUPS_IN, ledgers: LEDGERS_IN,
        expense_classes: EXPENSE_CLASSES_IN, income_classes: INCOME_CLASSES_IN,
        asset_classes: ASSET_CLASSES_IN, entity_bases: ENTITY_BASES_IN },
};
const DEFAULT_COUNTRY = 'IN';
const own = function (o, k) { return !!o && Object.prototype.hasOwnProperty.call(o, k); };

/** the pack for a country — or the default one, said so (`fallback: true`), never silently */
function packFor(country) {
  const c = String(country || '').trim().toUpperCase();
  if (own(PACKS, c)) return PACKS[c];
  return Object.assign({ fallback: true, asked: c || null }, PACKS[DEFAULT_COUNTRY]);
}
/** a group by its key */
function groupOf(pack, key) { return ((pack || {}).groups || []).find((g) => g.code === key) || null; }
/** every ledger row a pack has — ledgers, expense classes, income classes — each with its kind */
function rows_(p) {
  return [].concat(
    (p.ledgers || []).map((r) => ['ledger', r]),
    (p.expense_classes || []).map((r) => ['expense_class', r]),
    (p.income_classes || []).map((r) => ['income_class', r]));
}
/**
 * accountOf(pack, roleOrCode) → { role, code, name, group, tally_group, type, nature, side, sch3, sch3_line, statement,
 * saft, kind } — the one lookup the posting engine uses — or null. Accepts a ROLE ('debtors') or a CODE ('1300').
 * `type`, `nature` and `side` come from the account's GROUP; `sch3` from the row when it names one, else its group's.
 */
function accountOf(pack, key) {
  const p = pack || {};
  const k = String(key == null ? '' : key);
  const hit = rows_(p).find(([, r]) => r.role === k) || rows_(p).find(([, r]) => r.code === k);
  if (!hit) return null;
  const [kind, r] = hit;
  const g = groupOf(p, r.group);
  if (!g) return null;
  const sch3 = r.sch3 || g.sch3;
  const line = (p.sch3 && own(p.sch3, sch3)) ? p.sch3[sch3] : null;
  return { role: r.role, code: r.code, name: r.name, group: g.code, tally_group: g.name, type: g.type, nature: g.nature,
           side: g.side, sch3: sch3, sch3_line: line ? line.label : null, statement: line ? line.st : null,
           saft: { category: g.nature.toUpperCase(), code: sch3 }, kind: kind };
}
/** ⭐ the chart as a tree: primary groups → sub-groups → ledgers (with codes), in code order — what a screen draws */
function tree(pack) {
  const p = pack || {};
  const byGroup = {};
  rows_(p).forEach(([kind, r]) => {
    if (!byGroup[r.group]) byGroup[r.group] = [];
    if (!byGroup[r.group].some((x) => x.code === r.code)) byGroup[r.group].push({ role: r.role, code: r.code, name: r.name, kind: kind });
  });
  const node = (g) => ({ group: g.code, name: g.name, nature: g.nature, range: g.range,
    ledgers: (byGroup[g.code] || []).slice().sort((a, b) => a.code.localeCompare(b.code)),
    children: (p.groups || []).filter((c) => c.parent === g.code).map(node) });
  return (p.groups || []).filter((g) => !g.parent).map(node)
    .sort((a, b) => (a.range ? a.range[0] : 0) - (b.range ? b.range[0] : 0));
}
/**
 * ⭐ nextCode(pack, groupKey, taken) → the next free 4-digit code in that group's range, or null when it is full — for a
 * ledger a shop adds (Tally ledger creation, ERPNext account tree). `taken` = the codes already used by this shop.
 */
function nextCode(pack, groupKey, taken) {
  const g = groupOf(pack, groupKey); if (!g || !g.range) return null;
  const used = {};
  rows_(pack || {}).forEach(([, r]) => { used[r.code] = 1; });
  (taken || []).forEach((c) => { used[String(c)] = 1; });
  for (let n = g.range[0]; n <= g.range[1]; n++) { const s = String(n); if (!used[s]) return s; }
  return null;
}

/**
 * ⭐ withAccounts(pack, shopRows) → a copy of the pack that also knows the ledgers a SHOP added: rows { code, name, group }
 * (role null — the rules never name them). ⚠️ Refused (throws 409), never merged: a code outside its group's range, a
 * code or name already in the chart (a CODE CLASH), an unknown group, a code that is not 4 digits.
 */
function withAccounts(pack, shopRows) {
  const p = pack || {}, used = {}, names = {}, extra = [];
  rows_(p).forEach(([, r]) => { used[r.code] = r.role || r.name; names[String(r.name).toLowerCase()] = r.code; });
  (shopRows || []).forEach((r, i) => {
    const bad = (why) => { const e = new Error('Shop ledger #' + (i + 1) + ' (' + String(r && r.name).slice(0, 40) + '): ' + why); e.status = 409; throw e; };
    const code = String(r && r.code == null ? '' : r.code), name = String((r && r.name) || '').trim();
    if (!/^\d{4}$/.test(code)) bad('the code "' + code.slice(0, 20) + '" is not 4 digits.');
    const g = groupOf(p, r.group); if (!g) bad('there is no group "' + r.group + '".');
    if (!g.range || +code < g.range[0] || +code > g.range[1]) bad('code ' + code + ' is outside ' + g.name + ' (' + (g.range || []).join('–') + ').');
    if (own(used, code)) bad('code ' + code + ' is already ' + used[code] + ' — a code clash.');
    if (!name) bad('it has no name.');
    if (own(names, name.toLowerCase())) bad('the name is already ledger ' + names[name.toLowerCase()] + '.');
    used[code] = name; names[name.toLowerCase()] = code;
    extra.push({ role: null, code: code, name: name, group: g.code, shop: true });
  });
  return Object.assign({}, p, { ledgers: (p.ledgers || []).concat(extra) });
}

/* ═══ THE FISCAL YEAR AND THE NUMBER FORMATS — no clock: every date is an argument ═══ */

/**
 * ⚠️ v1.8.1 (critic H2): a date is a REAL CALENDAR DAY written YYYY-MM-DD and nothing else — no datetime
 * ('2026-09-05T10:00:00Z'), no unpadded '2026-9-5', no 30 February, no month 13. Anything else is null, and every
 * caller refuses on null. The one rule, shared: posting, ledger and bookpack all ask dayOf().
 */
function ymd_(s) {
  const m = typeof s === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(s) : null;
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3], t = new Date(Date.UTC(y, mo - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return null;
  return { y: y, m: mo, d: d };
}
/** ⭐ dayOf('2026-09-29') → the day number (days since 1970-01-01, no clock, no zone), or null when it is not a real YYYY-MM-DD day */
function dayOf(date) { const t = ymd_(date); return t ? Math.round(Date.UTC(t.y, t.m - 1, t.d) / 86400000) : null; }
/** ⭐ fiscalYearOf('2026-09-29', pack) → '2026-27' (India: April–March; the pack says where the year starts) */
function fiscalYearOf(date, pack) {
  const t = ymd_(date); if (!t) return null;
  const start = (pack && pack.fy_start_month) || 4;
  const y = t.m >= start ? t.y : t.y - 1;
  if (start === 1) return String(y);
  return y + '-' + String((y + 1) % 100).padStart(2, '0');
}
/** ⭐ periodOf('2026-09-29', pack) → 6 (September is the 6th month of an April year). Period 0 is "brought forward". */
function periodOf(date, pack) {
  const t = ymd_(date); if (!t) return null;
  const start = (pack && pack.fy_start_month) || 4;
  return ((t.m - start + 12) % 12) + 1;
}
/** fyRange('2026-27', pack) → { start: '2026-04-01', end: '2027-03-31' } */
function fyRange(fy, pack) {
  const y = parseInt(String(fy || ''), 10); if (!(y > 0)) return null;
  const start = (pack && pack.fy_start_month) || 4;
  const s = new Date(Date.UTC(y, start - 1, 1)), e = new Date(Date.UTC(y + 1, start - 1, 0));
  return { start: s.toISOString().slice(0, 10), end: e.toISOString().slice(0, 10) };
}
/** periodRange('2026-27', 6, pack) → { start: '2026-09-01', end: '2026-09-30' } */
function periodRange(fy, period, pack) {
  const y = parseInt(String(fy || ''), 10), p = Number(period);
  if (!(y > 0) || !(p >= 1 && p <= 12)) return null;
  const start = (pack && pack.fy_start_month) || 4;
  const m0 = start - 1 + (p - 1);
  const s = new Date(Date.UTC(y, m0, 1)), e = new Date(Date.UTC(y, m0 + 1, 0));
  return { start: s.toISOString().slice(0, 10), end: e.toISOString().slice(0, 10) };
}
/** ⭐ partyNo(42) → 'P-00042' — one series per shop across customers and suppliers, assigned once, never reused */
function partyNo(n) { const k = Math.floor(Number(n)); return k > 0 ? 'P-' + String(k).padStart(5, '0') : null; }
/** ⭐ voucherNo('SV', '2026-27', 41) → 'SV/2026-27/000041' — one series per voucher type (and 'MJ' for a person's own entry), gap-free per shop per fiscal year per series. null for a nonsense series, year or counter. */
function voucherNo(series, fy, n) {
  const k = Math.floor(Number(n)), s = String(series == null ? '' : series);
  return /^[A-Z]{2,3}$/.test(s) && fy && k > 0 ? s + '/' + fy + '/' + String(k).padStart(6, '0') : null;
}
/** ⭐ jvNo('2026-27', 123) → 'JV/2026-27/000123' — the Journal series; kept as it was (vouchers already numbered JV/ keep their numbers). voucherNo('JV', …) is the same answer. */
function jvNo(fy, n) { return voucherNo('JV', fy, n); }
/**
 * ⭐ VOUCHER_SERIES (v1.16.0; Athi, 2026-10-02: "Follow the standard") — Tally's voucher types and the prefix of each one's own number series.
 * 'MJ' is the single series for a person's OWN entry of any kind ("as long as we know that it is manual without too much of interpretation");
 * the entry keeps its voucher type beside it as a field.
 */
const VOUCHER_SERIES = { Sales: 'SV', Purchase: 'PV', Receipt: 'RV', Payment: 'PY', Contra: 'CV', 'Credit note': 'CN', 'Debit note': 'DN', Journal: 'JV' };
const MANUAL_SERIES = 'MJ';

const EXPORTS = { PACKS, DEFAULT_COUNTRY, SCH3, packFor, groupOf, accountOf, tree, nextCode, withAccounts,
                  dayOf, fiscalYearOf, periodOf, fyRange, periodRange, partyNo, jvNo, voucherNo, VOUCHER_SERIES, MANUAL_SERIES };

/* ⭐ ONE FILE, EVERY HOST: node takes module.exports; a page, the TV and the shop PC take window.CBAccountsPacks. */
if (typeof module !== 'undefined' && module.exports) module.exports = EXPORTS;
if (root && typeof root.window !== 'undefined') root.window.CBAccountsPacks = EXPORTS;
})(typeof globalThis !== 'undefined' ? globalThis : this);
