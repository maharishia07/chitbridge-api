/* ADOPTED from chitbridge-engines v1.65.0 · reg-ae · sha256 51ef8c7ce2819eaec787a5f02344d40ef06a46954329cc3e8c472322bc7bc939 — DO NOT EDIT HERE. Change it in chitbridge-engines, release a version, then run tools/adopt.cjs. */
/* chitbridge-engines · reg-ae. Edited ONLY in chitbridge-engines/src/reg-ae.js; every platform adopts a released version of it. */
(function (root) {
'use strict';
/* R1 (v1.51.0): the shared country helpers — src/pack-kit.js, loaded before this pack; a change there re-runs every country's golden */
var KIT = (root && root.CBPackKit) || (typeof require === 'function' ? require('./pack-kit') : null);
var refuse_ = KIT.refuse, pad2_ = KIT.pad2, ymd_ = KIT.ymd, lastDay_ = KIT.lastDay;
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
    prices_include_tax: true,                       /* v1.65.0: the shelf price convention — displayed prices include VAT (FTA) */
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
/**
 * ⭐ returns.build(pack, period, movements, opts) → the VAT201 in the ONE screen shape gst-returns.returnFor promises (R2, v1.52.0: moved verbatim from
 * gst-returns.fromVat201_ so the returns engine knows no country). opts.emirate: one of returns.emirates; null = said so in the notes.
 */
function buildReturn(pack, period, movements, o) {
  var v = vat201({ period: period, emirate: o.emirate == null || o.emirate === '' ? null : o.emirate }, movements), R = pack.returns, boxes = [];
  Object.keys(v.boxes).map(Number).sort(function (a, b) { return a - b; }).forEach(function (n) {
    var x = v.boxes[n], roles = x.roles ? x.roles.amount.concat(x.roles.vat.filter(function (r) { return x.roles.amount.indexOf(r) < 0; })) : [];
    boxes.push(KIT.returnRow(n, x.label, x.amount_minor == null ? null : x.amount_minor, x.vat_minor == null ? null : x.vat_minor, roles, x.note || (n === 1 && x.emirate ? 'Emirate: ' + x.emirate : null)));
  });
  return { ok: true, pack: pack.id, form: R.id, name: R.name, short: R.short, authority: R.authority, portal: R.portal, period: v.period, currency: pack.currency, columns: ['amount', 'tax'],
           boxes: boxes, payable_minor: v.payable_minor, refund_minor: v.refund_minor, net_minor: v.boxes[14].vat_minor,
           notes: [v.emirate_basis, v.box9_basis, v.box10_basis, v.adjustments].filter(Boolean), cite: v.cite, detail: v };
}
function int_(v, where) { return KIT.int(v, where, 'fils'); }

/** voucher series — the same standard prefixes as reg-in and reg-au (Athi, 2026-10-02: "Follow the standard"); 'MJ' is a person's own entry of any kind. ER Art. 59(1)(d): a sequential or unique invoice number. */
const VOUCHER_SERIES_AE = { Sales: 'SV', Purchase: 'PV', Receipt: 'RV', Payment: 'PY', Contra: 'CV', 'Credit note': 'CN', 'Debit note': 'DN', Journal: 'JV' };
const MANUAL_SERIES_AE = 'MJ';

/**
 * ⭐ accountExtras(row, group, pack) → the fields of a chart account that are the UAE's own: the group's name, the statement line the ledger lands on (the row's, else its
 * group's) with that line's label and statement ('bs' | 'pl'). The field is `line` — IFRS wording, no Schedule III.
 */
function accountExtras(r, g, pack) { return KIT.lineExtras(r, g, pack || PACK); }

/** ⭐ THE TAX HEADS (b2): ONE — `vat`. Output tax lands on Output VAT, input tax on Input VAT, and the tax a registrant accounts for on a supply to himself (DL Art. 48(1)) on `rcm_vat`. */
const TAX_HEADS = ['vat'];
const TAX_LEDGERS = { vat: { output: 'output_vat', input: 'input_vat', rcm: 'rcm_vat' } };

/**
 * ⭐ setOff({ output, input }, minor) → { utilised, payable, carried, excess } — ONE head: Recoverable Tax (Input VAT, Box 13) against Due Tax (Output VAT, Box 12). What is left
 * of the due tax is payable by the due date (Box 14 positive); what is left of the recoverable tax is an EXCESS the shop may have refunded on request (Box 15, Form VAT311) or
 * carried forward — returned as `carried` so the core's shape holds, and named `excess` beside it; the engine never chooses between the two. Reverse-charge Due Tax (rcm_vat)
 * is part of Box 12 and is netted the same way on the form: hand it in WITHIN `output.vat` (the core's cash-only `rcm` option is India's s.49(4), not the UAE's).
 * Amounts in MINOR units, read by `minor` (the core's one reader).
 */
function setOff(o, minor) {
  return KIT.singleHeadSetOff(o, minor, { head: 'vat', leftover: 'excess',
    negative: 'A VAT balance is never negative here — pass the credit balance of Output VAT and the debit balance of Input VAT.' });
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
  /* v1.65.0: the counter slip's titles in the shop's languages (first = the main line); the till reads them, never types a country's title */
  slip: Object.freeze({"langs":["ar","en"],"titles":{"tax":{"ar":"فاتورة ضريبية","en":"Tax Invoice"},"simplified":{"ar":"فاتورة ضريبية مبسطة","en":"Simplified Tax Invoice"},"plain":{"ar":"إيصال","en":"Receipt"}},"cite":"ER Art. 59: \"Tax Invoice\"; Arabic text ⚠ not yet read by a native reader"}),
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
  returns: { id: 'VAT201', name: 'VAT return (Form VAT201)', short: 'VAT return', authority: 'FTA', portal: 'EmaraTax', frequencies: ['quarterly', 'monthly'], staggers: STAGGERS_AE, labels: BOX_LABELS, emirates: EMIRATES, periods: periods, vat201: vat201, build: buildReturn },
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
