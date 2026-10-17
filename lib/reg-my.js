/* ADOPTED from chitbridge-engines v1.61.0 · reg-my · sha256 71ba0952a2d500daf32ee9484f730223b2c6426499ebe7bd3793a3da6bb88bce — DO NOT EDIT HERE. Change it in chitbridge-engines, release a version, then run tools/adopt.cjs. */
/* chitbridge-engines · reg-my. Edited ONLY in chitbridge-engines/src/reg-my.js; every platform adopts a released version of it. */
(function (root) {
'use strict';
/* the shared country helpers (R1) — src/pack-kit.js, loaded before this pack */
var KIT = (root && root.CBPackKit) || (typeof require === 'function' ? require('./pack-kit') : null);
var refuse_ = KIT.refuse, pad2_ = KIT.pad2, ymd_ = KIT.ymd, lastDay_ = KIT.lastDay;
// @stage poc
// @stage-note [BOOKS · REGULATION PACK] Malaysia · SST: the chart of accounts, the statement lines, SST as data, and the country's own rule functions.
// @stage-note Scaffolded by tools/new-pack.cjs from packs/TEMPLATE.md — DATA first, small rule functions beside it; the SHAPE of reg-au / reg-ae, not their content.
/**
 * reg-my.js — THE MALAYSIA · SST REGULATION PACK.
 *
 * ⭐ HOW THIS PACK IS MADE AND CHANGED: C:/dev/docs/15-tax-and-country-packs/RUNBOOK-ADD-A-COUNTRY.md (the steps, in order, and what each proves).
 *   Facts first (runbook §1, one file per country beside the runbook, every line cited); a caller never names this country — it asks
 *   CBCountry (src/country.js) for the standard members below (taxId · returns · invoice · connectors · numbering · words).
 *
 * Built from C:/dev/docs/15-tax-and-country-packs/COUNTRY-MY-FACTS.md (2026-10-16) — from knowledge, every ⚠ there is UNVERIFIED against the RMCD MySST portal / Acts 806 and 807.
 * SST is TWO single-stage taxes (sales tax, service tax) with NO input credit: one head `sst`, the whole output is payable.
 * ⚠️ `verified: false` until a local accountant has read it.
 * ⚠️ WHAT THE PACK LEAVES OUT (what the research marked "not found in an official source") — listed, never guessed: the 6% / 8% service-tax split by service; designated areas (Labuan, Langkawi, Tioman); low-value goods tax; e-Invoice (MyInvois) submission; capital allowances; the SST registration-number check digit (none published).
 *
 * The shape a pack must have is written and checked in regulation.js (CBRegulation.validate); packs/TEMPLATE.md walks every member.
 *
 * ── ZERO DEPENDENCIES · DATA (and small rule functions) · NO CLOCK ──────────────────────────────────────────
 */

/* ── the statement lines — 'bs' | 'pl' — MFRS / MPERS (IFRS-based, = IAS 1) wording ⚠ ── */
const LINES = {
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
  tax_liabilities:        { st: 'bs', side: 'liabilities', label: 'SST and other tax liabilities' },
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
  { code: 'tax_liabilities',         name: 'SST and tax liabilities', type: 'personal', nature: 'liability', side: 'cr', parent: 'current_liabilities', range: [2200, 2299], line: 'tax_liabilities' },
  { code: 'advances',                name: 'Advances and prepayments', type: 'personal', nature: 'asset',     side: 'dr', parent: 'current_assets',          range: [1700, 1799], line: 'other_current_assets' },
  { code: 'provisions',              name: 'Provisions',               type: 'personal', nature: 'liability', side: 'cr', parent: 'current_liabilities',     range: [2300, 2399], line: 'provisions' },
  { code: 'retained_earnings',       name: 'Retained earnings',        type: 'personal', nature: 'equity',    side: 'cr', parent: 'equity',                  range: [3200, 3999], line: 'retained_earnings' },
  { code: 'loans',                   name: 'Loans',                    type: 'personal', nature: 'liability', side: 'cr', parent: 'non_current_liabilities', range: [2000, 2019], line: 'borrowings' },
  { code: 'inventory',               name: 'Inventory',                type: 'real',     nature: 'asset',     side: 'dr', parent: 'current_assets',          range: [1200, 1299], line: 'inventories' },
  { code: 'trade_creditors',         name: 'Trade payables',           type: 'personal', nature: 'liability', side: 'cr', parent: 'current_liabilities',     range: [2100, 2199], line: 'trade_payables' },
  { code: 'trade_debtors',           name: 'Trade receivables',        type: 'personal', nature: 'asset',     side: 'dr', parent: 'current_assets',          range: [1300, 1399], line: 'trade_receivables' },
];

/** ⭐ THE LEDGERS THE POSTING RULES NAME (by role) — every role regulation.REQUIRED_ROLES lists, the tax ledgers, and the country's own (each with its cite) */
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
  /* the one SST head's output ledger (Act 806 / 807). SST is single-stage: the regulation contract still wants an input ledger, so one exists but nothing is set off against it: SST paid on purchases is a cost ⚠ */
  { role: 'output_sst',          code: '2200', name: 'Output SST',                              group: 'tax_liabilities' },
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

/** ⭐ DEPRECIATION AS DATA — MFRS 116 straight-line with POLICY lives (policy: true); tax capital allowances (Income Tax Act 1967 Sch 3) are out of scope */
const ASSET_CLASSES = [
  { class: 'plant',     cost_role: 'ppe_plant',     acc_role: 'accdep_plant',     life: 10, policy: true, cite: 'MFRS 116 para 50, entity policy life' },
  { class: 'furniture', cost_role: 'ppe_furniture', acc_role: 'accdep_furniture', life: 5,  policy: true, cite: 'MFRS 116 para 50, entity policy life' },
  { class: 'computers', cost_role: 'ppe_computers', acc_role: 'accdep_computers', life: 3,  policy: true, cite: 'MFRS 116 para 50, entity policy life' },
];
const ENTITY_BASES = {
  company:     { basis: 'straight_line', methods: ['slm'], prorata: 'days' },
  sole_trader: { basis: 'straight_line', methods: ['slm'], prorata: 'days' },
  partnership: { basis: 'straight_line', methods: ['slm'], prorata: 'days' },
};

/* ── the tax pack (the object tax-packs.PACKS.MY is) — every number from COUNTRY-MY-FACTS.md, with its Act (⚠ = unverified) ── */
const TAX = Object.freeze({
    country: 'MY',
    scheme: 'SST',
    supply: 'border',                                    /* no state split (Act 806); designated areas Labuan/Langkawi/Tioman are out of scope */
    rates: Object.freeze([0, 5, 6, 8, 10]),              /* sales tax 5 | 10 (Act 806, Rates of Tax Order 2018); service tax 8, and 6 for F&B / telecoms / parking / logistics (Act 807, from 1 Mar 2024) ⚠ */
    standard_rate: 10,                                   /* sales tax standard rate (Act 806) ⚠ */
    invoice_round_to: 0.01,                              /* sen; the 5-sen cash rounding is a tender rule (BNM), not the invoice's ⚠ */
    idName: 'SST registration no.',
    supplyKinds: Object.freeze({
      standard:   Object.freeze({ id: 'standard', name: 'Taxable goods (sales tax 10%)', rate: 10, credit: false, box: 'sales_10', why: 'Sales tax at 10% (Sales Tax Act 2018).', cite: 'Act 806 ⚠' }),
      sales_5:    Object.freeze({ id: 'sales_5', name: 'Taxable goods (sales tax 5%)', rate: 5, credit: false, box: 'sales_5', why: 'Sales tax at 5% (Sales Tax (Rates of Tax) Order 2018).', cite: 'Act 806 Rates Order ⚠' }),
      service_8:  Object.freeze({ id: 'service_8', name: 'Taxable service (service tax 8%)', rate: 8, credit: false, box: 'service_8', why: 'Service tax at 8% (Service Tax Act 2018, from 1 Mar 2024).', cite: 'Act 807 ⚠' }),
      service_6:  Object.freeze({ id: 'service_6', name: 'Taxable service (service tax 6%)', rate: 6, credit: false, box: 'service_6', why: 'Service tax at 6% (food and beverage, telecoms, parking, logistics).', cite: 'Act 807 Rate Order 2024 ⚠' }),
      exempt:     Object.freeze({ id: 'exempt', name: 'Exempt / not taxable', rate: 0, credit: false, box: 'exempt', why: 'Not subject to SST (an exempted good or a service that is not prescribed).', cite: 'Act 806 Exemption Order ⚠' }),
    }),
    registration: Object.freeze({ mandatory_minor: 50000000, voluntary_minor: 0, lookback_months: 12, cite: 'RM500,000 taxable sales or services in 12 months (F&B RM1.5 million) — RMCD guides ⚠' }),
    source: 'Sales Tax Act 2018 (Act 806) · Service Tax Act 2018 (Act 807) · RMCD MySST guides — from COUNTRY-MY-FACTS.md, NOT yet read against the official pages (verified:false)',
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

/** ⭐ THE TAX HEADS: ONE — `sst` (sales tax and service tax together, single-stage, no input side); no reverse-charge ledger until the round that builds it */
const TAX_HEADS = ['sst'];
const TAX_LEDGERS = { sst: { output: 'output_sst', input: null, rcm: null } };   /* SST is single-stage: no input credit (Act 806/807) — SST paid on a purchase is part of its cost (A2, v1.58.0) */

/** setOff({ output, input }, minor) → { utilised: [], payable, carried } — SST is single-stage: NO input credit (Act 806 / 807), the whole output is payable ⚠ */
function setOff(o, minor) {
  return KIT.noCreditSetOff(o, minor, { head: 'sst', negative: 'An SST balance is never negative here — pass the credit balance of Output SST.' });
}
const EVENT_ALIASES = {};
const MESSAGES = {
  nothingToSetOff: 'Nothing to set off: SST has no input credit, the whole output is payable.',
  payHeadUnknown: 'A SST payment is one head — sst.',
  rcmHeadUnknown: 'Reverse-charge SST is one head — sst.',
  paymentEmpty: 'A SST payment needs the sst head with an amount.',
  paymentRef: { label: 'Payment reference', ask: 'Which payment? Give the RMCD MySST payment reference (FPX or DuitNow).', hint: 'The MySST payment reference', narration: 'SST payment' },
  setOffNarration: 'SST (no input credit)',
  rcmNotBuilt: { sst: 'Reverse charge is not built in this pack yet — post it as a manual entry.' },
};

/* ── SST-02 — one return per TWO-month taxable period (Jan–Feb, Mar–Apr, …), due the last day of the month after the period (RMCD) ⚠ ── */
const MONTHS_ = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const SST02_LABELS = { sales: 'Total value of taxable sales and services', output_sst: 'SST payable' };
function periods(o) {
  var x = o || {}, y = parseInt(String(x.year || x.fy || ''), 10);
  if (!(y > 0)) throw refuse_('SST periods need the year they start in (year: 2026).');
  var out = [];
  for (var i = 0; i < 6; i++) {
    var a = 1 + i * 2, b = a + 1, d = b + 1, yd = y + (d > 12 ? 1 : 0), md = ((d - 1) % 12) + 1;
    out.push({ period: y + '-' + pad2_(a) + '/' + y + '-' + pad2_(b), label: MONTHS_[a - 1] + '–' + MONTHS_[b - 1] + ' ' + y, frequency: 'bimonthly',
               start: ymd_(y, a, 1), end: ymd_(y, b, lastDay_(y, b)), due: ymd_(yd, md, lastDay_(yd, md)), due_rule: 'the last day of the month after the two-month taxable period (RMCD) ⚠' });
  }
  return out;
}
function net_(rows, role, side) { return (rows || []).filter(function (r) { return r.role === role; }).reduce(function (t, r) { var d = KIT.int(r.dr_minor, role, 'sen'), c = KIT.int(r.cr_minor, role, 'sen'); return t + (side === 'cr' ? c - d : d - c); }, 0); }
/** buildReturn(pack, period, movements) → the SST-02 in returnFor's ONE screen shape: sales (amount) and output SST (tax); payable = output; no input box (single-stage) */
function buildReturn(pack, period, movements) {
  var rows = movements || [], sales = net_(rows, 'sales', 'cr') - net_(rows, 'sales_returns', 'dr'), out = net_(rows, 'output_sst', 'cr'), R = pack.returns;
  var boxes = [KIT.returnRow('sales', SST02_LABELS.sales, sales, null, [], null), KIT.returnRow('output_sst', SST02_LABELS.output_sst, null, out, [], null)];
  return { ok: true, pack: pack.id, form: R.id, name: R.name, short: R.short, authority: R.authority, portal: R.portal, period: period, currency: pack.currency, columns: ['amount', 'tax'],
           boxes: boxes, payable_minor: Math.max(0, out), refund_minor: 0, net_minor: out,
           notes: ['SST has no input credit: the whole output SST is payable.', 'Sales tax (5% / 10%) and service tax (6% / 8%) are not split here — one sales ledger.'], cite: 'SST-02 (RMCD) ⚠', detail: { sales: sales, output: out } };
}

/** depreciation.compute(rows, base, ctx) → { total, rate, per } for ONE asset class — straight-line over the life, pro rata by days, never below nil (MFRS 116) */
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
  taxNetting: [{ output: 'output_sst', input: null, creditRole: 'sst_recoverable', payableRole: 'sst_payable', creditName: 'SST recoverable', payableName: 'SST payable' }],   /* the input ledger is never set off (single-stage), so only the payable side is ever used */
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
/** the groups the core reads by KIND, and how a payment mode lands — DuitNow lands in the bank, FPX is a bank transfer (no UPI outside India) */
const CHART = {
  paymentModes: { cash: 'cash', bank: 'bank', transfer: 'bank', cheque: 'bank', card: 'card', duitnow: 'bank', fpx: 'bank' },
  kinds: { tax: 'tax_liabilities', stock: 'inventory', cash: 'cash_on_hand', bank: 'bank_accounts',
           loans: ['non_current_liabilities', 'loans', 'bank_overdraft'],
           sales: 'sales', purchases: 'purchases', directIncome: 'sales', directExpense: 'cost_of_sales',
           indirectIncome: 'other_income', indirectExpense: 'operating_expenses' },
};
/** the words a refusal quotes — MFRS 102 (= IAS 2) */
const CITE = { inventoryFormula: 'IAS 2 para 25', lowerOfCostNrv: 'IAS 2 para 9' };
function accrualPayableFor(a) { return a && a.line === 'employee_benefits' ? 'wages_payable' : 'accrued_expenses'; }

/* bank statements: the amount prefixes and the whole words a narration uses — RM / MYR; no preset until checked against a real file */
const BANK = {
  amountPrefixes: ['myr', 'rm'], minorUnit: 'minor units', presets: {},
  keywords: { default: { charges: ['CHARGES', 'FEE', 'FEES'], interest: ['INTEREST'], atm: ['ATM', 'WITHDRAWAL'], cash_deposit: ['CASH DEPOSIT'], cheque_return: ['RETURNED', 'REVERSAL'], transfer: ['TRANSFER'] } },
};

/** the fiscal year — the company chooses its year end (Companies Act 2016); January is only the default ⚠; a shop whose year starts elsewhere says so in its own books setting; the REGISTERED pack carries only fiscalYear */
const FISCAL_YEAR = { startMonth: 1, label: 'single' };

/** ⭐ THE PACK — the regulation contract (regulation.js) in one object; `sch3` is the contract's NAME for the statement-line table */
const PACK = {
  id: 'MY', version: '1.0.0', name: 'Malaysia · SST', verified: false,
  country: 'MY', basis: 'MFRS statement lines · MFRS 116 straight-line · RMCD SST-02', currency: 'MYR',
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
  taxId: { name: 'SST registration no.', hint: 'W10-1808-31000011', check: function (v) { var s = String(v == null ? '' : v).trim().toUpperCase().replace(/\s+/g, '');
      if (/^[A-Z]\d{2}-\d{4}-\d{8}$/.test(s)) return { ok: true, value: s, why: null };
      return { ok: false, value: s, why: 'An SST registration number looks like W10-1808-31000011 (a letter, 2 digits, 4 digits, 8 digits).' }; } },
  returns: { id: 'SST-02', name: 'SST return (SST-02)', short: 'SST return', authority: 'RMCD', portal: 'MySST', frequencies: ['bimonthly'], labels: SST02_LABELS, periods: periods, build: buildReturn },
  locale: { format: 'en-MY', langs: ['en', 'ms'] },
  timeZones: ['Asia/Kuala_Lumpur'],
  retentionYears: 7,
  records: { years: { standard: 7 }, cite: 'Act 806 / Act 807 (seven years); Companies Act 2016 s.245 ⚠' },
  invoice: { requiredLines: ['trade_name', 'tax_id', 'address'], cite: 'Act 806 / 807 regulations: supplier name, address and SST registration number on an invoice ⚠' },
  connectors: [{ id: 'sqlaccount', name: 'SQL Account', fits: 'none' }, { id: 'autocount', name: 'AutoCount', fits: 'none' }, { id: 'xero', name: 'Xero', fits: 'none' }, { id: 'quickbooks', name: 'QuickBooks', fits: 'none' }],
  numbering: { default: { dating: 'fy', resets: 'never', dayRollHour: 0 }, law: 'none_found' },
  words: { taxName: 'SST', registration: 'SST registration', returnShort: 'SST return', taxId: 'SST registration no.', postcode: 'Postcode', region: 'State' },
  payments: ['cash', 'duitnow', 'fpx', 'card'],
  scope: { out: { 'tax.rcm': 'reverse charge / imported services is a later round', 'tax.supply': 'designated areas (Labuan, Langkawi, Tioman) are out of scope', einvoice: 'MyInvois e-Invoice submission is out of scope', depreciation: 'capital allowances (Income Tax Act 1967 Sch 3) are out of scope', payroll: 'payroll is out of scope' },
           partial: { returns: 'SST-02 reads sales and output SST; the split by sales-tax 5/10 and service-tax 6/8 needs per-kind sales ledgers', taxId: 'no check digit is published for the SST registration number' } },
};

const EXPORTS = PACK;

/* ⭐ ONE FILE, EVERY HOST: node takes module.exports; a page, the TV and the shop PC take window.CBRegMY. */
if (typeof module !== 'undefined' && module.exports) module.exports = EXPORTS;
if (root && typeof root.window !== 'undefined') root.window.CBRegMY = EXPORTS;
})(typeof globalThis !== 'undefined' ? globalThis : this);
