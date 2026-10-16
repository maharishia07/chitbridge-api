/* ADOPTED from chitbridge-engines v1.57.1 · reg-jp · sha256 d940a7b0638f31b073c59e1ac771366677dbc71ee70d22445536c35cdc1692ad — DO NOT EDIT HERE. Change it in chitbridge-engines, release a version, then run tools/adopt.cjs. */
/* chitbridge-engines · reg-jp. Edited ONLY in chitbridge-engines/src/reg-jp.js; every platform adopts a released version of it. */
(function (root) {
'use strict';
/* the shared country helpers (R1) — src/pack-kit.js, loaded before this pack */
var KIT = (root && root.CBPackKit) || (typeof require === 'function' ? require('./pack-kit') : null);
var refuse_ = KIT.refuse, pad2_ = KIT.pad2, ymd_ = KIT.ymd, lastDay_ = KIT.lastDay;
// @stage poc
// @stage-note [BOOKS · REGULATION PACK] Japan · Consumption tax: the chart of accounts, the statement lines, consumption tax as data, and the country's own rule functions.
// @stage-note Scaffolded by tools/new-pack.cjs from packs/TEMPLATE.md — DATA first, small rule functions beside it; the SHAPE of reg-au / reg-ae, not their content.
/**
 * reg-jp.js — THE JAPAN · CONSUMPTION TAX REGULATION PACK.
 *
 * ⭐ HOW THIS PACK IS MADE AND CHANGED: C:/dev/docs/15-tax-and-country-packs/RUNBOOK-ADD-A-COUNTRY.md (the steps, in order, and what each proves).
 *   Facts first (runbook §1, one file per country beside the runbook, every line cited); a caller never names this country — it asks
 *   CBCountry (src/country.js) for the standard members below (taxId · returns · invoice · connectors · numbering · words).
 *
 * Built from C:/dev/docs/15-tax-and-country-packs/COUNTRY-JP-FACTS.md (2026-10-16) — from knowledge, every ⚠ there is UNVERIFIED against the National Tax Agency (nta.go.jp).
 * Consumption tax is VAT-like (input credit), standard 10% / reduced 8% / export 0%; JPY has NO minor unit (whole yen). The scheme code is JCT (head `jct`).
 * ⚠️ `verified: false` until a local accountant has read it.
 * ⚠️ WHAT THE PACK LEAVES OUT (what the research marked "not found in an official source") — listed, never guessed: the simplified (simplified-taxation) scheme and the 80% transitional input credit for non-qualified invoices; interim returns and their amounts by size; local consumption tax (the 2.2 of the 10 points is collected as a share, not a second tax); reverse charge on imported electronic services; the T-number check digit for individuals; J-GAAP statement forms beyond line wording; tax depreciation (statutory useful lives).
 *
 * The shape a pack must have is written and checked in regulation.js (CBRegulation.validate); packs/TEMPLATE.md walks every member.
 *
 * ── ZERO DEPENDENCIES · DATA (and small rule functions) · NO CLOCK ──────────────────────────────────────────
 */

/* ── the statement lines — 'bs' | 'pl' — J-GAAP (ASBJ) line wording ⚠ ── */
const LINES = {
  ppe:                    { st: 'bs', side: 'assets',      label: 'Property, plant and equipment' },
  investments:            { st: 'bs', side: 'assets',      label: 'Investments' },
  inventories:            { st: 'bs', side: 'assets',      label: 'Merchandise and finished goods' },
  trade_receivables:      { st: 'bs', side: 'assets',      label: 'Notes and accounts receivable - trade' },
  cash:                   { st: 'bs', side: 'assets',      label: 'Cash and deposits' },
  other_current_assets:   { st: 'bs', side: 'assets',      label: 'Other current assets' },
  equity:                 { st: 'bs', side: 'equity',      label: "Capital stock / Owner's equity" },
  retained_earnings:      { st: 'bs', side: 'equity',      label: 'Retained earnings' },
  borrowings:             { st: 'bs', side: 'liabilities', label: 'Borrowings' },
  trade_payables:         { st: 'bs', side: 'liabilities', label: 'Notes and accounts payable - trade' },
  tax_liabilities:        { st: 'bs', side: 'liabilities', label: 'Consumption tax and other tax liabilities' },
  other_current_liabilities: { st: 'bs', side: 'liabilities', label: 'Other current liabilities' },
  provisions:             { st: 'bs', side: 'liabilities', label: 'Provisions' },
  suspense:               { st: 'bs', side: 'liabilities', label: 'Suspense (must be nil at close)' },
  revenue:                { st: 'pl', side: 'income',      label: 'Net sales' },
  other_income:           { st: 'pl', side: 'income',      label: 'Non-operating income' },
  cost_of_sales:          { st: 'pl', side: 'expense',     label: 'Cost of sales' },
  changes_inventories:    { st: 'pl', side: 'expense',     label: 'Changes in inventories' },
  employee_benefits:      { st: 'pl', side: 'expense',     label: 'Employee benefits expense' },
  finance_costs:          { st: 'pl', side: 'expense',     label: 'Interest expenses' },
  depreciation:           { st: 'pl', side: 'expense',     label: 'Depreciation and amortisation expense' },
  other_expenses:         { st: 'pl', side: 'expense',     label: 'Selling, general and administrative expenses' },
};

/* ── the chart's groups: the code ranges keep reg-in's numbering (1xxx assets · 2xxx liabilities · 3xxx equity · 4xxx income · 5xxx cost of sales · 6xxx operating expenses) ── */
const GROUPS = [
  { code: 'equity',                  name: 'Equity',                   type: 'personal', nature: 'equity',    side: 'cr', parent: null,                      range: [3000, 3199], line: 'equity' },
  { code: 'current_assets',          name: 'Current assets',           type: 'real',     nature: 'asset',     side: 'dr', parent: null,                      range: [1800, 1899], line: 'other_current_assets' },
  { code: 'current_liabilities',     name: 'Current liabilities',      type: 'personal', nature: 'liability', side: 'cr', parent: null,                      range: [2400, 2899], line: 'other_current_liabilities' },
  { code: 'non_current_assets',      name: 'Non-current assets',       type: 'real',     nature: 'asset',     side: 'dr', parent: null,                      range: [1000, 1099], line: 'ppe' },
  { code: 'investments',             name: 'Investments',              type: 'real',     nature: 'asset',     side: 'dr', parent: null,                      range: [1100, 1199], line: 'investments' },
  { code: 'non_current_liabilities', name: 'Non-current liabilities',  type: 'personal', nature: 'liability', side: 'cr', parent: null,                      range: [2030, 2099], line: 'borrowings' },
  { code: 'suspense',                name: 'Suspense',                 type: 'personal', nature: 'liability', side: 'cr', parent: null,                      range: [2900, 2999], line: 'suspense' },
  { code: 'cost_of_sales',           name: 'Cost of sales',            type: 'nominal',  nature: 'expense',   side: 'dr', parent: null,                      range: [5100, 5999], line: 'cost_of_sales' },
  { code: 'other_income',            name: 'Other income',             type: 'nominal',  nature: 'income',    side: 'cr', parent: null,                      range: [4200, 4999], line: 'other_income' },
  { code: 'operating_expenses',      name: 'Operating expenses',       type: 'nominal',  nature: 'expense',   side: 'dr', parent: null,                      range: [6000, 6999], line: 'other_expenses' },
  { code: 'purchases',               name: 'Purchases',                type: 'nominal',  nature: 'expense',   side: 'dr', parent: null,                      range: [5000, 5099], line: 'cost_of_sales' },
  { code: 'sales',                   name: 'Revenue',                  type: 'nominal',  nature: 'income',    side: 'cr', parent: null,                      range: [4000, 4199], line: 'revenue' },
  { code: 'bank_accounts',           name: 'Bank accounts',            type: 'real',     nature: 'asset',     side: 'dr', parent: 'current_assets',          range: [1500, 1599], line: 'cash' },
  { code: 'bank_overdraft',          name: 'Bank overdraft',           type: 'personal', nature: 'liability', side: 'cr', parent: 'non_current_liabilities', range: [2020, 2029], line: 'borrowings' },
  { code: 'cash_on_hand',            name: 'Cash on hand',             type: 'real',     nature: 'asset',     side: 'dr', parent: 'current_assets',          range: [1400, 1499], line: 'cash' },
  { code: 'tax_liabilities',         name: 'Consumption tax and tax liabilities', type: 'personal', nature: 'liability', side: 'cr', parent: 'current_liabilities', range: [2200, 2299], line: 'tax_liabilities' },
  { code: 'advances',                name: 'Advances and prepayments', type: 'personal', nature: 'asset',     side: 'dr', parent: 'current_assets',          range: [1700, 1799], line: 'other_current_assets' },
  { code: 'provisions',              name: 'Provisions',               type: 'personal', nature: 'liability', side: 'cr', parent: 'current_liabilities',     range: [2300, 2399], line: 'provisions' },
  { code: 'retained_earnings',       name: 'Retained earnings',        type: 'personal', nature: 'equity',    side: 'cr', parent: 'equity',                  range: [3200, 3999], line: 'retained_earnings' },
  { code: 'loans',                   name: 'Loans',                    type: 'personal', nature: 'liability', side: 'cr', parent: 'non_current_liabilities', range: [2000, 2019], line: 'borrowings' },
  { code: 'inventory',               name: 'Inventory',                type: 'real',     nature: 'asset',     side: 'dr', parent: 'current_assets',          range: [1200, 1299], line: 'inventories' },
  { code: 'trade_creditors',         name: 'Trade payables',           type: 'personal', nature: 'liability', side: 'cr', parent: 'current_liabilities',     range: [2100, 2199], line: 'trade_payables' },
  { code: 'trade_debtors',           name: 'Trade receivables',        type: 'personal', nature: 'asset',     side: 'dr', parent: 'current_assets',          range: [1300, 1399], line: 'trade_receivables' },
];

/** ⭐ THE LEDGERS THE POSTING RULES NAME (by role) — every role regulation.REQUIRED_ROLES lists, the tax ledgers */
const LEDGERS = [
  { role: 'stock',                  code: '1200', name: 'Inventory on hand',                               group: 'inventory' },
  { role: 'ppe_plant',              code: '1020', name: 'Plant and equipment',                             group: 'non_current_assets' },
  { role: 'accdep_plant',           code: '1021', name: 'Accumulated depreciation — plant and equipment',  group: 'non_current_assets' },
  { role: 'ppe_furniture',          code: '1030', name: 'Furniture and fittings',                          group: 'non_current_assets' },
  { role: 'accdep_furniture',       code: '1031', name: 'Accumulated depreciation — furniture and fittings', group: 'non_current_assets' },
  { role: 'ppe_computers',          code: '1060', name: 'Computers',                                       group: 'non_current_assets' },
  { role: 'accdep_computers',       code: '1061', name: 'Accumulated depreciation — computers',            group: 'non_current_assets' },
  { role: 'debtors',                code: '1300', name: 'Customers (Trade receivables)',                   group: 'trade_debtors' },
  { role: 'cash',                   code: '1400', name: 'Cash on hand',                                    group: 'cash_on_hand' },
  { role: 'bank',                   code: '1500', name: 'Business bank account',                           group: 'bank_accounts' },
  { role: 'card',                   code: '1520', name: 'Card settlements',                                group: 'bank_accounts' },
  { role: 'prepaid_expenses',       code: '1810', name: 'Prepayments',                                     group: 'current_assets' },
  { role: 'accrued_income',         code: '1820', name: 'Accrued income',                                  group: 'current_assets' },
  { role: 'supplier_advance',       code: '1700', name: 'Advances to suppliers',                           group: 'advances' },
  { role: 'creditors',              code: '2100', name: 'Suppliers (Trade payables)',                      group: 'trade_creditors' },
  { role: 'secured_loan',           code: '2000', name: 'Secured loans',                                   group: 'loans' },
  { role: 'unsecured_loan',         code: '2010', name: 'Unsecured loans',                                 group: 'loans' },
  { role: 'bank_od',                code: '2020', name: 'Bank overdraft',                                  group: 'bank_overdraft' },
  /* output and input consumption tax of the one head (Consumption Tax Act: tax on sales, credit for tax on purchases) ⚠ */
  { role: 'output_consumption_tax',          code: '2200', name: 'Output consumption tax',                              group: 'tax_liabilities' },
  { role: 'input_consumption_tax',           code: '2210', name: 'Input consumption tax',                               group: 'tax_liabilities' },
  { role: 'customer_advance',       code: '2400', name: 'Customer deposits (advances)',                    group: 'current_liabilities' },
  { role: 'accrued_expenses',       code: '2410', name: 'Accrued expenses',                                group: 'current_liabilities' },
  { role: 'wages_payable',          code: '2420', name: 'Wages and salaries payable',                      group: 'current_liabilities' },
  { role: 'income_in_advance',      code: '2430', name: 'Income received in advance',                      group: 'current_liabilities' },
  { role: 'suspense',               code: '2900', name: 'Suspense',                                        group: 'suspense' },
  { role: 'capital',                code: '3000', name: "Owner's capital / Share capital",                 group: 'equity' },
  { role: 'drawings',               code: '3100', name: 'Drawings',                                        group: 'equity' },
  { role: 'retained',               code: '3900', name: 'Retained earnings',                               group: 'retained_earnings' },
  { role: 'sales',                  code: '4000', name: 'Sales',                                           group: 'sales' },
  { role: 'sales_returns',          code: '4090', name: 'Sales returns and allowances',                    group: 'sales' },
  { role: 'interest_received',      code: '4200', name: 'Interest received',                               group: 'other_income' },
  { role: 'gain_on_disposal',       code: '4250', name: 'Gain on disposal of assets',                      group: 'other_income' },
  { role: 'purchases',              code: '5000', name: 'Purchases',                                       group: 'purchases' },
  { role: 'purchase_returns',       code: '5090', name: 'Purchase returns',                                group: 'purchases' },
  { role: 'changes_in_inventories', code: '5050', name: 'Changes in inventories',                          group: 'purchases', line: 'changes_inventories' },
  { role: 'discount_allowed',       code: '6800', name: 'Discounts allowed',                               group: 'operating_expenses' },
  { role: 'bad_debts',              code: '6850', name: 'Bad debts written off',                           group: 'operating_expenses' },
  { role: 'depreciation',           code: '6200', name: 'Depreciation',                                    group: 'operating_expenses', line: 'depreciation' },
  { role: 'loss_on_disposal',       code: '6210', name: 'Loss on disposal of assets',                      group: 'operating_expenses' },
  { role: 'round_off',              code: '6900', name: 'Rounding',                                        group: 'operating_expenses' },
];

/** what a shop pays for that is not stock — the common classes (policy) */
const EXPENSE_CLASSES = [
  { role: 'wages',          code: '5100', name: 'Wages',                     group: 'cost_of_sales',      line: 'employee_benefits' },
  { role: 'rent',           code: '6010', name: 'Rent',                      group: 'operating_expenses' },
  { role: 'salary',         code: '6020', name: 'Salaries',                  group: 'operating_expenses', line: 'employee_benefits' },
  { role: 'electricity',    code: '6030', name: 'Electricity and water',     group: 'operating_expenses' },
  { role: 'telephone',      code: '6040', name: 'Telephone and internet',    group: 'operating_expenses' },
  { role: 'transport',      code: '6050', name: 'Freight and delivery',      group: 'operating_expenses' },
  { role: 'repairs',        code: '6060', name: 'Repairs and maintenance',   group: 'operating_expenses' },
  { role: 'bank_charges',   code: '6090', name: 'Bank and merchant fees',    group: 'operating_expenses', line: 'finance_costs' },
  { role: 'professional',   code: '6120', name: 'Accounting and legal fees', group: 'operating_expenses' },
  { role: 'insurance',      code: '6140', name: 'Insurance',                 group: 'operating_expenses' },
  { role: 'interest_paid',  code: '6150', name: 'Interest paid',             group: 'operating_expenses', line: 'finance_costs' },
  { role: 'sundry_expense', code: '6190', name: 'Sundry expenses',           group: 'operating_expenses' },
];
/** money that comes in and is not a sale. interest_received IS the ledger 4200. */
const INCOME_CLASSES = [
  { role: 'interest_received',   code: '4200', name: 'Interest received',   group: 'other_income' },
  { role: 'commission_received', code: '4210', name: 'Commission received', group: 'other_income' },
  { role: 'discount_received',   code: '4230', name: 'Discounts received',  group: 'other_income' },
  { role: 'sundry_income',       code: '4290', name: 'Sundry income',       group: 'other_income' },
];

/** ⭐ DEPRECIATION AS DATA — book depreciation: straight-line over a POLICY life (J-GAAP); the statutory tax useful lives are out of scope */
const ASSET_CLASSES = [
  { class: 'plant',     cost_role: 'ppe_plant',     acc_role: 'accdep_plant',     life: 10, policy: true, cite: 'J-GAAP, entity policy life (straight-line)' },
  { class: 'furniture', cost_role: 'ppe_furniture', acc_role: 'accdep_furniture', life: 5,  policy: true, cite: 'J-GAAP, entity policy life (straight-line)' },
  { class: 'computers', cost_role: 'ppe_computers', acc_role: 'accdep_computers', life: 3,  policy: true, cite: 'J-GAAP, entity policy life (straight-line)' },
];
const ENTITY_BASES = {
  company:     { basis: 'straight_line', methods: ['slm'], prorata: 'days' },
  sole_trader: { basis: 'straight_line', methods: ['slm'], prorata: 'days' },
  partnership: { basis: 'straight_line', methods: ['slm'], prorata: 'days' },
};

/* ── the tax pack (the object tax-packs.PACKS.JP is) — every number from COUNTRY-JP-FACTS.md (⚠ = unverified) ── */
const TAX = Object.freeze({
    country: 'JP',
    scheme: 'JCT',
    supply: 'border',                                    /* one country-wide head; no state split */
    rates: Object.freeze([0, 8, 10]),                    /* Consumption Tax Act: 10% standard (7.8 national + 2.2 local), 8% reduced (from 1 Oct 2019), 0% export ⚠ */
    standard_rate: 10,                                   /* Consumption Tax Act ⚠ */
    invoice_round_to: 1,                                 /* JPY has NO minor unit: a total is a whole yen; the fraction rule (round · floor · ceil) is the business's own per invoice per rate ⚠ */
    idName: 'Registration number (T-number)',
    supplyKinds: Object.freeze({
      standard: Object.freeze({ id: 'standard', name: 'Standard-rated supply (10%)', rate: 10, credit: true, box: 'taxable', why: 'Consumption tax at the standard rate of 10%.', cite: 'Consumption Tax Act ⚠' }),
      reduced:  Object.freeze({ id: 'reduced', name: 'Reduced-rate supply (8%)', rate: 8, credit: true, box: 'taxable', why: 'Reduced rate of 8%: food and drink (not alcohol, not dining in) and newspapers by subscription — marked on a qualified invoice.', cite: 'Consumption Tax Act, reduced rate ⚠' }),
      export:   Object.freeze({ id: 'export', name: 'Export (0%)', rate: 0, credit: true, box: 'export', why: 'Exempt from consumption tax as an export (zero-rated: the input credit is kept).', cite: 'Consumption Tax Act, export exemption ⚠' }),
      exempt:   Object.freeze({ id: 'exempt', name: 'Exempt supply', rate: 0, credit: false, box: 'exempt', why: 'Non-taxable: land, financial services, medical care, education.', cite: 'Consumption Tax Act, non-taxable transactions ⚠' }),
    }),
    registration: Object.freeze({ mandatory_minor: 10000000, voluntary_minor: 0, lookback_months: 24, cite: 'Taxable once taxable sales in the base period (two years before) exceed ¥10 million; a qualified-invoice issuer registers voluntarily ⚠' }),
    taxInvoice: Object.freeze({ simplified_upto_minor: null, within_days: null, qualified_from: '2023-10-01', cite: 'Qualified Invoice System (from 1 Oct 2023): issuer name and registration number, date, items (reduced-rate items marked), totals and tax per rate ⚠' }),
    source: 'Consumption Tax Act · National Tax Agency guides — from COUNTRY-JP-FACTS.md, NOT yet read against nta.go.jp (verified:false)',
});

/** supplyKindOf(line) → the kind row a line names (`supply_kind` | `tax_kind`), standard when it names none, null when it names one the pack does not know */
function supplyKindOf(line) {
  var l = line || {}, k = String(l.supply_kind || l.tax_kind || 'standard').trim().toLowerCase().replace(/-/g, '_');
  return Object.prototype.hasOwnProperty.call(TAX.supplyKinds, k) ? TAX.supplyKinds[k] : null;
}

/** voucher series — the same standard prefixes as every pack (Athi, 2026-10-02: "Follow the standard"); 'MJ' is a person's own entry */
const VOUCHER_SERIES = { Sales: 'SV', Purchase: 'PV', Receipt: 'RV', Payment: 'PY', Contra: 'CV', 'Credit note': 'CN', 'Debit note': 'DN', Journal: 'JV' };
const MANUAL_SERIES = 'MJ';

/** accountExtras(row, group, pack) → the fields of a chart account that are this country's own: the group's name, the statement line, its label and statement */
function accountExtras(r, g, pack) { return KIT.lineExtras(r, g, pack || PACK); }

/** ⭐ THE TAX HEADS: ONE — `jct` (consumption tax); no reverse-charge ledger until the round that builds it (the core refuses reverse charge by name) */
const TAX_HEADS = ['jct'];
const TAX_LEDGERS = { jct: { output: 'output_consumption_tax', input: 'input_consumption_tax', rcm: null } };

/** setOff({ output, input }, minor) → { utilised, payable, carried, refund } — ONE head: input tax against output tax; an excess of input tax is REFUNDED (National Tax Agency) ⚠ */
function setOff(o, minor) {
  return KIT.singleHeadSetOff(o, minor, { head: 'jct', leftover: 'refund',
    negative: 'A consumption tax balance is never negative here — pass the credit balance of Output Consumption tax and the debit balance of Input consumption tax.' });
}
const EVENT_ALIASES = {};
const MESSAGES = {
  nothingToSetOff: 'Nothing to set off: no Input consumption tax meets Output consumption tax this period.',
  payHeadUnknown: 'A consumption tax payment is one head — jct.',
  rcmHeadUnknown: 'Reverse-charge consumption tax is one head — jct.',
  paymentEmpty: 'A consumption tax payment needs the jct head with an amount.',
  paymentRef: { label: 'Payment reference', ask: 'Which payment? Give the National Tax Agency payment reference (bank transfer or e-Tax).', hint: 'The National Tax Agency payment reference', narration: 'Consumption tax payment' },
  setOffNarration: 'Consumption tax set-off',
  rcmNotBuilt: { jct: 'Reverse charge is not built in this pack yet — post it as a manual entry.' },
};

/* ── the consumption tax return — ANNUAL, for the fiscal year; due two months after its end (interim returns by size ⚠ are not built). The year starts at o.startMonth (default April, as many Japanese companies) ── */
const JCT_LABELS = { taxable_sales: 'Taxable sales', output_tax: 'Consumption tax on sales', input_tax: 'Consumption tax on purchases', net: 'Tax to pay / refund' };
function periods(o) {
  var x = o || {}, y = parseInt(String(x.year || x.fy || ''), 10), m0 = x.startMonth == null ? FISCAL_YEAR.startMonth : parseInt(String(x.startMonth), 10);
  if (!(y > 0)) throw refuse_('The consumption tax year needs the year it starts in (year: 2026).');
  if (!(m0 >= 1 && m0 <= 12)) throw refuse_('The first month of the fiscal year is 1–12.');
  var b = m0 + 11, ye = y + Math.floor((b - 1) / 12), me = ((b - 1) % 12) + 1, d = b + 2, yd = y + Math.floor((d - 1) / 12), md = ((d - 1) % 12) + 1;
  return [{ period: y + '-' + pad2_(m0) + '/' + ye + '-' + pad2_(me), label: 'FY ' + (m0 === 1 ? String(y) : y + '/' + ye), frequency: 'annual',
            start: ymd_(y, m0, 1), end: ymd_(ye, me, lastDay_(ye, me)), due: ymd_(yd, md, lastDay_(yd, md)), due_rule: 'two months after the end of the fiscal year (National Tax Agency) ⚠' }];
}
function net_(rows, role, side) { return (rows || []).filter(function (r) { return r.role === role; }).reduce(function (t, r) { var d = KIT.int(r.dr_minor, role, 'yen'), c = KIT.int(r.cr_minor, role, 'yen'); return t + (side === 'cr' ? c - d : d - c); }, 0); }
/** buildReturn(pack, period, movements) → the return in returnFor's ONE screen shape: taxable sales, output tax, input tax, net (positive pays, negative is refunded) */
function buildReturn(pack, period, movements) {
  var rows = movements || [], sales = net_(rows, 'sales', 'cr') - net_(rows, 'sales_returns', 'dr'), out = net_(rows, 'output_consumption_tax', 'cr'), inp = net_(rows, 'input_consumption_tax', 'dr'), net = out - inp, R = pack.returns;
  var boxes = [KIT.returnRow('taxable_sales', JCT_LABELS.taxable_sales, sales, null, [], 'not split by rate or export yet — enter the split on e-Tax'), KIT.returnRow('output_tax', JCT_LABELS.output_tax, null, out, [], null),
    KIT.returnRow('input_tax', JCT_LABELS.input_tax, null, inp, [], null), KIT.returnRow('net', JCT_LABELS.net, null, net, [], null)];
  return { ok: true, pack: pack.id, form: R.id, name: R.name, short: R.short, authority: R.authority, portal: R.portal, period: period, currency: pack.currency, columns: ['amount', 'tax'],
           boxes: boxes, payable_minor: Math.max(0, net), refund_minor: Math.max(0, -net), net_minor: net,
           notes: ['Amounts are whole yen.', 'Only the annual return is built; interim returns by size are not.'], cite: 'Consumption tax return (National Tax Agency) ⚠', detail: { sales: sales, output: out, input: inp } };
}

/** depreciation.compute(rows, base, ctx) → { total, rate, per } for ONE asset class — straight-line over the life, pro rata by days, never below nil (J-GAAP) */
function depreciationCompute(rs, base, ctx) {
  var c = rs[0].c, diy = ctx.diy, rate = Math.round(10000 / c.life) / 100;
  var per = rs.map(function (r) {
    if (r.cost === null && r.wdv === null) throw refuse_('Depreciation needs the cost or the opening value of asset ' + r.id + '.');
    var open = r.wdv !== null && r.wdv !== undefined ? r.wdv : r.cost, cost = r.cost !== null && r.cost !== undefined ? r.cost : open;
    var ch = Math.min(cost * r.days / diy / c.life, Math.max(0, open));
    return Math.round(Number(ch.toPrecision(15)));
  });
  return { total: per.reduce(function (s, v) { return s + v; }, 0), rate: rate, per: per };
}

const AGE = [['not_due', null], ['lt_1m', [0, 1]], ['m1_2', [1, 2]], ['m2_3', [2, 3]], ['gt_3m', [3, null]]];
const PRESENTATION = {
  lines: LINES,
  lineOf: function (a) { return a.line; },
  labelOf: function (a) { return a.line_label; },
  placed: function (a, key) { return Object.assign({}, a, { line: key, line_label: LINES[key] ? LINES[key].label : null }); },
  taxNetting: [{ output: 'output_consumption_tax', input: 'input_consumption_tax', creditRole: 'jct_recoverable', payableRole: 'jct_payable', creditName: 'Consumption tax recoverable', payableName: 'Consumption tax payable' }],
  creditLine: 'other_current_assets', payableLine: 'tax_liabilities', profitLine: 'retained_earnings',
  ownerCapitalBases: ['sole_trader', 'partnership'],
  ageing: { receivable: AGE, payable: AGE },
  labels: {
    advancesFromCustomers: 'Customer deposits', advancesToSuppliers: 'Advances to suppliers',
    profitToDate: 'Profit for the year to date', profitLine: 'Retained earnings',
    openingCapital: 'Opening capital', netProfitToDate: 'Add: Net profit for the year to date', netLossToDate: 'Less: Net loss for the year to date', drawings: 'Less: Drawings', capitalAccount: "Owner's equity",
    openingStock: 'Opening inventory', closingStock: 'Closing inventory',
  },
};
/** the groups the core reads by KIND, and how a payment mode lands — IC e-money settles on card, PayPay and bank transfer in the bank (no UPI outside India) */
const CHART = {
  paymentModes: { cash: 'cash', bank: 'bank', transfer: 'bank', cheque: 'bank', card: 'card', ic: 'card', paypay: 'bank' },
  kinds: { tax: 'tax_liabilities', stock: 'inventory', cash: 'cash_on_hand', bank: 'bank_accounts',
           loans: ['non_current_liabilities', 'loans', 'bank_overdraft'],
           sales: 'sales', purchases: 'purchases', directIncome: 'sales', directExpense: 'cost_of_sales',
           indirectIncome: 'other_income', indirectExpense: 'operating_expenses' },
};
/** the words a refusal quotes — ASBJ Statement No. 9 (inventories; the pack cites the IAS 2 wording) */
const CITE = { inventoryFormula: 'IAS 2 para 25', lowerOfCostNrv: 'IAS 2 para 9' };
function accrualPayableFor(a) { return a && a.line === 'employee_benefits' ? 'wages_payable' : 'accrued_expenses'; }

/* bank statements: the amount prefixes and the whole words a narration uses — JPY / yen (no minor unit); no preset until checked against a real file */
const BANK = {
  amountPrefixes: ['jpy', 'yen'], minorUnit: 'minor units', presets: {},
  keywords: { default: { charges: ['CHARGES', 'FEE', 'FEES'], interest: ['INTEREST'], atm: ['ATM', 'WITHDRAWAL'], cash_deposit: ['CASH DEPOSIT'], cheque_return: ['RETURNED', 'REVERSAL'], transfer: ['TRANSFER'] } },
};

/** the fiscal year — April to March is common (many Japanese companies) but the company sets its own ⚠; a shop whose year starts elsewhere says so in its own books setting; the REGISTERED pack carries only fiscalYear */
const FISCAL_YEAR = { startMonth: 4, label: 'split' };

/** ⭐ THE PACK — the regulation contract (regulation.js) in one object; `sch3` is the contract's NAME for the statement-line table */
const PACK = {
  id: 'JP', version: '1.0.0', name: 'Japan · Consumption tax', verified: false,
  country: 'JP', basis: 'J-GAAP statement lines · straight-line policy lives · consumption tax return', currency: 'JPY',
  sch3: LINES, groups: GROUPS, ledgers: LEDGERS,
  expense_classes: EXPENSE_CLASSES, income_classes: INCOME_CLASSES,
  asset_classes: ASSET_CLASSES, entity_bases: ENTITY_BASES,
  fiscalYear: FISCAL_YEAR,
  accountExtras: accountExtras,
  presentation: PRESENTATION, chart: CHART,
  depreciation: { assetClasses: ASSET_CLASSES, entityBases: ENTITY_BASES, compute: depreciationCompute },
  bank: BANK,
  cite: CITE, accrualPayableFor: accrualPayableFor,
  setOff: setOff, eventAliases: EVENT_ALIASES, messages: MESSAGES,
  taxHeads: TAX_HEADS, payHeads: TAX_HEADS, optionalHeads: [], taxLedgers: TAX_LEDGERS,
  voucherSeries: VOUCHER_SERIES, manualSeries: MANUAL_SERIES, voucherFormat: '{series}/{fy}/{n:6}',
  tax: TAX,
  /* the country's own rule functions (none is called by the core; the api / web read them by name) */
  supplyKindOf: supplyKindOf,
  /* ⭐ THE STANDARD MEMBERS (runbook §2 E3; CBCountry reads them — no caller names this country) */
  taxId: { name: 'Registration number (T-number)', hint: 'T1234567890123', check: function (v) { var s = String(v == null ? '' : v).trim().toUpperCase().replace(/[\s-]/g, '');
      if (/^T\d{13}$/.test(s)) return { ok: true, value: s, why: null };
      return { ok: false, value: s, why: 'A qualified-invoice registration number is T followed by 13 digits, like T1234567890123.' }; } },
  returns: { id: 'JCT', name: 'Consumption tax return', short: 'Consumption tax return', authority: 'National Tax Agency', portal: 'e-Tax', frequencies: ['annual'], labels: JCT_LABELS, periods: periods, build: buildReturn },
  locale: { format: 'ja-JP', langs: ['ja', 'en'] },
  timeZones: ['Asia/Tokyo'],
  retentionYears: 7,
  records: { years: { standard: 7 }, cite: 'Consumption Tax Act / Corporate Tax Act books and documents (seven years) ⚠' },
  invoice: { requiredLines: ['trade_name', 'tax_id'], cite: 'Qualified invoice: issuer name and registration number (T-number), date, items with reduced-rate items marked, totals and tax per rate ⚠' },
  connectors: [{ id: 'freee', name: 'freee', fits: 'none' }, { id: 'moneyforward', name: 'Money Forward', fits: 'none' }, { id: 'yayoi', name: 'Yayoi', fits: 'none' }],
  numbering: { default: { dating: 'fy', resets: 'never', dayRollHour: 0 }, law: 'none_found' },
  words: { taxName: 'Consumption tax', registration: 'Qualified invoice issuer registration', returnShort: 'Consumption tax return', taxId: 'T-number', postcode: 'Postal code', region: 'Prefecture' },
  payments: ['cash', 'card', 'ic', 'paypay', 'bank'],
  scope: { out: { 'tax.rcm': 'reverse charge on imported electronic services is a later round', depreciation: 'statutory tax useful lives are out of scope', einvoice: 'Peppol-based e-invoicing is out of scope', payroll: 'payroll is out of scope' },
           partial: { 'tax.line_tax_rounding': 'the shared tax engine rounds the tax of a line to 2 decimals whatever the currency; only the invoice TOTAL is rounded to the whole yen', returns: 'annual return only; interim returns by size are not built', taxId: 'the T-number shape is checked, not a check digit', 'tax.taxInvoice': 'qualified-invoice particulars are cited, the 80% transitional credit is not modelled' } },
};

const EXPORTS = PACK;

/* ⭐ ONE FILE, EVERY HOST: node takes module.exports; a page, the TV and the shop PC take window.CBRegJP. */
if (typeof module !== 'undefined' && module.exports) module.exports = EXPORTS;
if (root && typeof root.window !== 'undefined') root.window.CBRegJP = EXPORTS;
})(typeof globalThis !== 'undefined' ? globalThis : this);
