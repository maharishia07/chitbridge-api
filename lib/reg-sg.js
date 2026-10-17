/* ADOPTED from chitbridge-engines v1.61.0 · reg-sg · sha256 06846cad86d11a0430dc6837aa27d5dbf8b8f3fcbfa91d1b9b6d979fc14290e7 — DO NOT EDIT HERE. Change it in chitbridge-engines, release a version, then run tools/adopt.cjs. */
/* chitbridge-engines · reg-sg. Edited ONLY in chitbridge-engines/src/reg-sg.js; every platform adopts a released version of it. */
(function (root) {
'use strict';
/* the shared country helpers (R1) — src/pack-kit.js, loaded before this pack */
var KIT = (root && root.CBPackKit) || (typeof require === 'function' ? require('./pack-kit') : null);
var refuse_ = KIT.refuse, pad2_ = KIT.pad2, ymd_ = KIT.ymd, lastDay_ = KIT.lastDay;
// @stage poc
// @stage-note [BOOKS · REGULATION PACK] Singapore · GST: the chart of accounts, the statement lines, GST as data, and the country's own rule functions.
// @stage-note Scaffolded by tools/new-pack.cjs from packs/TEMPLATE.md — DATA first, small rule functions beside it; the SHAPE of reg-au / reg-ae, not their content.
/**
 * reg-sg.js — THE SINGAPORE · GST REGULATION PACK.
 *
 * ⭐ HOW THIS PACK IS MADE AND CHANGED: C:/dev/docs/15-tax-and-country-packs/RUNBOOK-ADD-A-COUNTRY.md (the steps, in order, and what each proves).
 *   Facts: COUNTRY-SG-FACTS.md beside the runbook. First brought up by the runbook trial (TRIAL-SG-RUNBOOK-2026-10-16.md). A caller never names
 *   Singapore — it asks CBCountry (src/country.js) for the standard members at the foot of PACK (taxId · returns · invoice · connectors · numbering · words).
 *
 * Built from C:/dev/docs/15-tax-and-country-packs/COUNTRY-SG-FACTS.md (runbook trial 2026-10-16) — every ⚠ there is unverified against iras.gov.sg / acra.gov.sg.
 * and the short names used in the comments below.
 * ⚠️ `verified: false` until a local accountant has read it.
 * ⚠️ WHAT THE PACK LEAVES OUT (what the research marked "not found in an official source") — reverse charge on imported services; CPF / payroll; F5 boxes 2–3 by supply kind; F7 corrections; the UEN check letter (ACRA publishes none).
 *
 * The shape a pack must have is written and checked in regulation.js (CBRegulation.validate); packs/TEMPLATE.md walks every member.
 *
 * ── ZERO DEPENDENCIES · DATA (and small rule functions) · NO CLOCK ──────────────────────────────────────────
 */

/* ── the statement lines — 'bs' | 'pl' — SFRS(I) 1-1 (identical to IAS 1) wording ── */
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
  tax_liabilities:        { st: 'bs', side: 'liabilities', label: 'GST and other tax liabilities' },
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
  { code: 'tax_liabilities',         name: 'GST and tax liabilities', type: 'personal', nature: 'liability', side: 'cr', parent: 'current_liabilities', range: [2200, 2299], line: 'tax_liabilities' },
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
  /* output and input tax of the one GST head (GST Act s.16 output tax; s.19–20 input tax) ⚠ */
  { role: 'output_gst',          code: '2200', name: 'Output GST',                              group: 'tax_liabilities' },
  { role: 'input_gst',           code: '2210', name: 'Input GST',                               group: 'tax_liabilities' },
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

/** ⭐ DEPRECIATION AS DATA — SFRS(I) 1-16 straight-line with POLICY lives (policy: true); tax capital allowances (Income Tax Act s.19/19A) are out of scope when there is none */
const ASSET_CLASSES = [
  { class: 'plant',     cost_role: 'ppe_plant',     acc_role: 'accdep_plant',     life: 10, policy: true, cite: 'SFRS(I) 1-16 para 50, entity policy life' },
  { class: 'furniture', cost_role: 'ppe_furniture', acc_role: 'accdep_furniture', life: 5,  policy: true, cite: 'SFRS(I) 1-16 para 50, entity policy life' },
  { class: 'computers', cost_role: 'ppe_computers', acc_role: 'accdep_computers', life: 3,  policy: true, cite: 'SFRS(I) 1-16 para 50, entity policy life' },
];
const ENTITY_BASES = {
  company:     { basis: 'straight_line', methods: ['slm'], prorata: 'days' },
  sole_trader: { basis: 'straight_line', methods: ['slm'], prorata: 'days' },
  partnership: { basis: 'straight_line', methods: ['slm'], prorata: 'days' },
};

/* ── the tax pack (the object tax-packs.PACKS.SG is) — every number from COUNTRY-SG-FACTS.md, with its section (⚠ = unverified) ── */
const TAX = Object.freeze({
    country: 'SG',
    scheme: 'GST',
    supply: 'border',                                    /* one country-wide head; no state split */
    rates: Object.freeze([0, 9]),                        /* GST Act 1993 s.16: 9% from 1 Jan 2024; 0% zero-rated (s.21) ⚠ */
    standard_rate: 9,                                    /* GST Act s.16 ⚠ */
    invoice_round_to: 0.01,                              /* cents; IRAS: GST may be rounded per line or per invoice to the nearest cent ⚠ */
    idName: 'GST registration no.',
    supplyKinds: Object.freeze({
      standard:   Object.freeze({ id: 'standard', name: 'Standard-rated supply', rate: 9, credit: true, box: 1, why: 'GST at the standard rate of 9% (GST Act s.16).', cite: 'GST Act 1993 s.16 ⚠' }),
      zero_rated: Object.freeze({ id: 'zero_rated', name: 'Zero-rated supply', rate: 0, credit: true, box: 2, why: 'Zero-rated: an export of goods or an international service (GST Act s.21).', cite: 'GST Act 1993 s.21 ⚠' }),
      exempt:     Object.freeze({ id: 'exempt', name: 'Exempt supply', rate: 0, credit: false, box: 3, why: 'Exempt (Fourth Schedule): financial services, residential property, investment precious metals.', cite: 'GST Act 1993 s.22, Fourth Schedule ⚠' }),
    }),
    registration: Object.freeze({ mandatory_minor: 100000000, voluntary_minor: 0, lookback_months: 12, cite: 'GST Act s.8, First Schedule: taxable supplies above S$1 million in a calendar year or expected in the next 12 months ⚠' }),
    registrationKinds: Object.freeze([{ id: 'regular', name: 'GST registered' }, { id: 'unregistered', name: 'Not registered' }]),
    taxInvoice: Object.freeze({ simplified_upto_minor: 100000, within_days: null, cite: 'GST (General) Regulations reg. 11: a simplified tax invoice up to S$1,000 incl. GST ⚠' }),
    source: 'GST Act 1993 · GST (General) Regulations · IRAS e-Tax guides — from COUNTRY-SG-FACTS.md, NOT yet read against iras.gov.sg (verified:false)',
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

/** ⭐ THE TAX HEADS: ONE — `gst`; no reverse-charge ledger until the round that builds it (the core refuses reverse charge by name) */
const TAX_HEADS = ['gst'];
const TAX_LEDGERS = { gst: { output: 'output_gst', input: 'input_gst', rcm: null } };

/** setOff({ output, input }, minor) → { utilised, payable, carried } — ONE head: input against output; what is left of the input is carried (an excess of input tax is REFUNDED by IRAS — `refund`) */
function setOff(o, minor) {
  return KIT.singleHeadSetOff(o, minor, { head: 'gst', leftover: 'refund',
    negative: 'A GST balance is never negative here — pass the credit balance of Output GST and the debit balance of Input GST.' });
}
const EVENT_ALIASES = {};
const MESSAGES = {
  nothingToSetOff: 'Nothing to set off: no Input GST meets Output GST this period.',
  payHeadUnknown: 'A GST payment is one head — gst.',
  rcmHeadUnknown: 'Reverse-charge GST is one head — gst.',
  paymentEmpty: 'A GST payment needs the gst head with an amount.',
  rcmNotBuilt: { gst: 'Reverse charge on imported services is not built — post it as a manual entry.' },
  paymentRef: { label: 'Payment reference', ask: 'Which payment? Give the IRAS payment reference (GIRO or PayNow).', hint: 'The IRAS payment reference', narration: 'GST payment' },
  setOffNarration: 'GST set-off',
};

/* ── GST F5 — the quarterly return, its boxes READ FROM THE POSTED LEDGERS (as reg-ae's VAT201). IRAS assigns the accounting period; quarters here follow the
      calendar unless the shop says its first month (o.firstMonth). Due: one month after the period ends (GST Act s.41, IRAS) ⚠ ── */
const MONTHS_ = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const F5_LABELS = { 1: 'Total value of standard-rated supplies', 2: 'Total value of zero-rated supplies', 3: 'Total value of exempt supplies', 4: 'Total value of (1) + (2) + (3)',
  5: 'Total value of taxable purchases', 6: 'Output tax due', 7: 'Input tax and refunds claimed', 8: 'Net GST to be paid to / claimed from IRAS' };
function periods(o) {
  var x = o || {}, y = parseInt(String(x.year || x.fy || ''), 10), m0 = parseInt(String(x.firstMonth || 1), 10);
  if (!(y > 0)) throw refuse_('GST periods need the year they start in (year: 2026).');
  if (!(m0 >= 1 && m0 <= 12)) throw refuse_('The first month of the GST quarters is 1–12, as IRAS assigned it.');
  var out = [];
  for (var i = 0; i < 4; i++) {
    var a = m0 + i * 3, ys = y + Math.floor((a - 1) / 12), ms = ((a - 1) % 12) + 1, b = a + 2, ye = y + Math.floor((b - 1) / 12), me = ((b - 1) % 12) + 1;
    var d = b + 1, yd = y + Math.floor((d - 1) / 12), md = ((d - 1) % 12) + 1;
    out.push({ period: ys + '-' + pad2_(ms) + '/' + ye + '-' + pad2_(me), label: MONTHS_[ms - 1] + '–' + MONTHS_[me - 1] + ' ' + (ys === ye ? ys : ys + '/' + ye),
               frequency: 'quarterly', start: ymd_(ys, ms, 1), end: ymd_(ye, me, lastDay_(ye, me)), due: ymd_(yd, md, lastDay_(yd, md)), due_rule: 'one month after the end of the accounting period (IRAS) ⚠' });
  }
  return out;
}
function net_(rows, role, side) { return (rows || []).filter(function (r) { return r.role === role; }).reduce(function (t, r) { var d = KIT.int(r.dr_minor, role, 'cents'), c = KIT.int(r.cr_minor, role, 'cents'); return t + (side === 'cr' ? c - d : d - c); }, 0); }
/** buildReturn(pack, period, movements) → the F5 in returnFor's ONE screen shape. ⚠️ Boxes 2 and 3 need sales ledgers per supply kind, which this chart does not have yet: read as 0 and said in the notes. */
function buildReturn(pack, period, movements) {
  var rows = movements || [], b1 = net_(rows, 'sales', 'cr') - net_(rows, 'sales_returns', 'dr'), b5 = net_(rows, 'purchases', 'dr') - net_(rows, 'purchase_returns', 'cr');
  var b6 = net_(rows, 'output_gst', 'cr'), b7 = net_(rows, 'input_gst', 'dr'), b8 = b6 - b7, R = pack.returns;
  var v = { 1: [b1, null], 2: [0, null], 3: [0, null], 4: [b1, null], 5: [b5, null], 6: [null, b6], 7: [null, b7], 8: [null, b8] };
  var boxes = Object.keys(v).map(Number).map(function (n) { return KIT.returnRow(n, F5_LABELS[n], v[n][0], v[n][1], [], n === 2 || n === 3 ? 'not split by supply kind yet — enter on myTax Portal' : null); });
  return { ok: true, pack: pack.id, form: R.id, name: R.name, short: R.short, authority: R.authority, portal: R.portal, period: period, currency: pack.currency, columns: ['amount', 'tax'],
           boxes: boxes, payable_minor: Math.max(0, b8), refund_minor: Math.max(0, -b8), net_minor: b8,
           notes: ['Boxes 2 and 3 are not read: the chart has one sales ledger.', 'Box 5 reads purchases only; expenses with GST are claimed in Box 7 as posted.'], cite: 'GST F5 (IRAS) ⚠', detail: { boxes: v } };
}


/** depreciation.compute(rows, base, ctx) → { total, rate, per } for ONE asset class — straight-line over the life, pro rata by days, never below nil (SFRS(I) 1-16) */
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
  taxNetting: [{ output: 'output_gst', input: 'input_gst', creditRole: 'gst_recoverable', payableRole: 'gst_payable', creditName: 'GST recoverable', payableName: 'GST payable' }],
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
/** the groups the core reads by KIND, and how a payment mode lands — PayNow lands in the bank, NETS on card (no UPI outside India) */
const CHART = {
  paymentModes: { cash: 'cash', bank: 'bank', transfer: 'bank', cheque: 'bank', card: 'card', paynow: 'bank', nets: 'card' },
  kinds: { tax: 'tax_liabilities', stock: 'inventory', cash: 'cash_on_hand', bank: 'bank_accounts',
           loans: ['non_current_liabilities', 'loans', 'bank_overdraft'],
           sales: 'sales', purchases: 'purchases', directIncome: 'sales', directExpense: 'cost_of_sales',
           indirectIncome: 'other_income', indirectExpense: 'operating_expenses' },
};
/** the words a refusal quotes — SFRS(I) 1-2 (= IAS 2) */
const CITE = { inventoryFormula: 'IAS 2 para 25', lowerOfCostNrv: 'IAS 2 para 9' };
function accrualPayableFor(a) { return a && a.line === 'employee_benefits' ? 'wages_payable' : 'accrued_expenses'; }

/* bank statements: the amount prefixes and the whole words a narration uses — S$ / SGD; no bank preset until checked against a real file */
const BANK = {
  amountPrefixes: ['sgd'], minorUnit: 'minor units', presets: {},
  keywords: { default: { charges: ['CHARGES', 'FEE', 'FEES'], interest: ['INTEREST'], atm: ['ATM', 'WITHDRAWAL'], cash_deposit: ['CASH DEPOSIT'], cheque_return: ['RETURNED', 'REVERSAL'], transfer: ['TRANSFER'] } },
};

/** the fiscal year — the company chooses its year (Companies Act s.197); January is only the default; a shop whose year starts elsewhere says so in its own books setting; the REGISTERED pack carries only fiscalYear */
const FISCAL_YEAR = { startMonth: 1, label: 'single' };

/** ⭐ THE PACK — the regulation contract (regulation.js) in one object; `sch3` is the contract's NAME for the statement-line table */
const PACK = {
  id: 'SG', version: '1.0.0', name: 'Singapore · GST', verified: false,
  country: 'SG', basis: 'SFRS(I) statement lines · SFRS(I) 1-16 straight-line · IRAS GST F5', currency: 'SGD',
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
  taxId: { name: 'UEN', hint: '201912345K', check: function (v) { var s = String(v == null ? '' : v).trim().toUpperCase().replace(/[\s-]/g, '');
      if (/^\d{8}[A-Z]$/.test(s) || /^(19|20)\d{2}\d{5}[A-Z]$/.test(s) || /^[TSR]\d{2}[A-Z]{2}\d{4}[A-Z]$/.test(s) || /^M[A-Z0-9]\d{7}[A-Z0-9]$/.test(s)) return { ok: true, value: s, why: null };
      return { ok: false, value: s, why: 'A UEN looks like 53312345A, 201912345K or T19LL1234A (or an M-number for GST).' }; } },
  returns: { id: 'F5', name: 'GST return (Form F5)', short: 'GST return', authority: 'IRAS', portal: 'myTax Portal', frequencies: ['quarterly'], labels: F5_LABELS, periods: periods, build: buildReturn },
  locale: { format: 'en-SG', langs: ['en', 'zh', 'ms', 'ta'] },
  timeZones: ['Asia/Singapore'],
  retentionYears: 5,
  records: { years: { standard: 5 }, cite: 'GST Act s.46; Income Tax Act s.67 (five years) ⚠' },
  invoice: { requiredLines: ['trade_name', 'tax_id', 'address'], cite: 'GST (General) Regulations reg. 11: supplier name, address and GST registration number on a tax invoice ⚠' },
  connectors: [{ id: 'xero', name: 'Xero', fits: 'none' }, { id: 'quickbooks', name: 'QuickBooks Online', fits: 'none' }, { id: 'myob', name: 'MYOB', fits: 'none' }],
  numbering: { default: { dating: 'fy', resets: 'never', dayRollHour: 0 }, law: 'none_found' },
  words: { taxName: 'GST', registration: 'GST registration', returnShort: 'GST return', taxId: 'UEN', postcode: 'Postal code', region: null },
  payments: ['cash', 'paynow', 'nets', 'card'],
  scope: { out: { 'tax.rcm': 'reverse charge on imported services is a later round', payroll: 'CPF and payroll are out of scope' }, partial: { returns: 'F5 boxes 2 and 3 need per-kind sales ledgers' } },
};

const EXPORTS = PACK;

/* ⭐ ONE FILE, EVERY HOST: node takes module.exports; a page, the TV and the shop PC take window.CBRegSG. */
if (typeof module !== 'undefined' && module.exports) module.exports = EXPORTS;
if (root && typeof root.window !== 'undefined') root.window.CBRegSG = EXPORTS;
})(typeof globalThis !== 'undefined' ? globalThis : this);
