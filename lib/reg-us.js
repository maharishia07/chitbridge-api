/* ADOPTED from chitbridge-engines v1.57.1 · reg-us · sha256 c6da20e6dc74458181fafb9dc4afec8263a84ba88c7f00d69cd51469a3e5737d — DO NOT EDIT HERE. Change it in chitbridge-engines, release a version, then run tools/adopt.cjs. */
/* chitbridge-engines · reg-us. Edited ONLY in chitbridge-engines/src/reg-us.js; every platform adopts a released version of it. */
(function (root) {
'use strict';
/* the shared country helpers (R1) — src/pack-kit.js, loaded before this pack */
var KIT = (root && root.CBPackKit) || (typeof require === 'function' ? require('./pack-kit') : null);
var refuse_ = KIT.refuse, pad2_ = KIT.pad2, ymd_ = KIT.ymd, lastDay_ = KIT.lastDay;
// @stage poc
// @stage-note [BOOKS · REGULATION PACK] United States · Sales tax: the chart of accounts, the statement lines, sales tax as data, and the country's own rule functions.
// @stage-note Scaffolded by tools/new-pack.cjs from packs/TEMPLATE.md — DATA first, small rule functions beside it; the SHAPE of reg-au / reg-ae, not their content.
/**
 * reg-us.js — THE UNITED STATES · SALES TAX REGULATION PACK.
 *
 * ⭐ HOW THIS PACK IS MADE AND CHANGED: C:/dev/docs/15-tax-and-country-packs/RUNBOOK-ADD-A-COUNTRY.md (the steps, in order, and what each proves).
 *   Facts first (runbook §1, one file per country beside the runbook, every line cited); a caller never names this country — it asks
 *   CBCountry (src/country.js) for the standard members below (taxId · returns · invoice · connectors · numbering · words).
 *
 * Built from C:/dev/docs/15-tax-and-country-packs/COUNTRY-US-FACTS.md (2026-10-16) — from knowledge, every ⚠ there is UNVERIFIED against the state revenue departments / IRS.
 * There is NO national VAT/GST: sales tax is set by each STATE (and county/city). The pack holds the STATE BASE rates as data (tax.stateRates); the shop's
 * combined rate (state + local) is the shop's own setting. Single-stage, NO input credit (resale exemption certificates instead).
 * ⚠️ `verified: false` until a local accountant has read it.
 * ⚠️ WHAT THE PACK LEAVES OUT (what the research marked "not found in an official source") — listed, never guessed: local (county/city) rates and sourcing rules; economic nexus thresholds; marketplace facilitators; use tax on purchases; per-state product exemptions (groceries, prescriptions, clothing); the state permit-number formats; MACRS tax depreciation; payroll.
 *
 * The shape a pack must have is written and checked in regulation.js (CBRegulation.validate); packs/TEMPLATE.md walks every member.
 *
 * ── ZERO DEPENDENCIES · DATA (and small rule functions) · NO CLOCK ──────────────────────────────────────────
 */

/* ── the statement lines — 'bs' | 'pl' — US GAAP (FASB ASC 210 / 220) line wording ⚠ ── */
const LINES = {
  ppe:                    { st: 'bs', side: 'assets',      label: 'Property, plant and equipment' },
  investments:            { st: 'bs', side: 'assets',      label: 'Investments' },
  inventories:            { st: 'bs', side: 'assets',      label: 'Inventories' },
  trade_receivables:      { st: 'bs', side: 'assets',      label: 'Accounts receivable, net' },
  cash:                   { st: 'bs', side: 'assets',      label: 'Cash and cash equivalents' },
  other_current_assets:   { st: 'bs', side: 'assets',      label: 'Other current assets' },
  equity:                 { st: 'bs', side: 'equity',      label: "Stockholders' / Owner's equity" },
  retained_earnings:      { st: 'bs', side: 'equity',      label: 'Retained earnings' },
  borrowings:             { st: 'bs', side: 'liabilities', label: 'Borrowings' },
  trade_payables:         { st: 'bs', side: 'liabilities', label: 'Accounts payable and accrued liabilities' },
  tax_liabilities:        { st: 'bs', side: 'liabilities', label: 'Sales tax and other tax liabilities' },
  other_current_liabilities: { st: 'bs', side: 'liabilities', label: 'Other current liabilities' },
  provisions:             { st: 'bs', side: 'liabilities', label: 'Provisions' },
  suspense:               { st: 'bs', side: 'liabilities', label: 'Suspense (must be nil at close)' },
  revenue:                { st: 'pl', side: 'income',      label: 'Revenue' },
  other_income:           { st: 'pl', side: 'income',      label: 'Other income' },
  cost_of_sales:          { st: 'pl', side: 'expense',     label: 'Cost of goods sold' },
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
  { code: 'tax_liabilities',         name: 'Sales tax and tax liabilities', type: 'personal', nature: 'liability', side: 'cr', parent: 'current_liabilities', range: [2200, 2299], line: 'tax_liabilities' },
  { code: 'advances',                name: 'Advances and prepayments', type: 'personal', nature: 'asset',     side: 'dr', parent: 'current_assets',          range: [1700, 1799], line: 'other_current_assets' },
  { code: 'provisions',              name: 'Provisions',               type: 'personal', nature: 'liability', side: 'cr', parent: 'current_liabilities',     range: [2300, 2399], line: 'provisions' },
  { code: 'retained_earnings',       name: 'Retained earnings',        type: 'personal', nature: 'equity',    side: 'cr', parent: 'equity',                  range: [3200, 3999], line: 'retained_earnings' },
  { code: 'loans',                   name: 'Loans',                    type: 'personal', nature: 'liability', side: 'cr', parent: 'non_current_liabilities', range: [2000, 2019], line: 'borrowings' },
  { code: 'inventory',               name: 'Inventory',                type: 'real',     nature: 'asset',     side: 'dr', parent: 'current_assets',          range: [1200, 1299], line: 'inventories' },
  { code: 'trade_creditors',         name: 'Trade payables',           type: 'personal', nature: 'liability', side: 'cr', parent: 'current_liabilities',     range: [2100, 2199], line: 'trade_payables' },
  { code: 'trade_debtors',           name: 'Trade receivables',        type: 'personal', nature: 'asset',     side: 'dr', parent: 'current_assets',          range: [1300, 1399], line: 'trade_receivables' },
];

/** ⭐ THE LEDGERS THE POSTING RULES NAME (by role) — every role regulation.REQUIRED_ROLES lists and the tax ledgers */
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
  /* the sales-tax head's output ledger (tax collected for the state). Single-stage: the regulation contract still wants an input ledger, so one exists but nothing is set off against it — tax paid on resale goods is exempt by certificate, otherwise a cost ⚠ */
  { role: 'output_sales_tax',          code: '2200', name: 'Output sales tax',                              group: 'tax_liabilities' },
  { role: 'input_sales_tax',           code: '2210', name: 'Sales tax paid on purchases (no credit)',                               group: 'tax_liabilities' },
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

/** ⭐ DEPRECIATION AS DATA — the book policy: straight-line over a POLICY life (ASC 360-10); MACRS tax depreciation is out of scope */
const ASSET_CLASSES = [
  { class: 'plant',     cost_role: 'ppe_plant',     acc_role: 'accdep_plant',     life: 10, policy: true, cite: 'ASC 360-10, entity policy life (straight-line)' },
  { class: 'furniture', cost_role: 'ppe_furniture', acc_role: 'accdep_furniture', life: 5,  policy: true, cite: 'ASC 360-10, entity policy life (straight-line)' },
  { class: 'computers', cost_role: 'ppe_computers', acc_role: 'accdep_computers', life: 3,  policy: true, cite: 'ASC 360-10, entity policy life (straight-line)' },
];
const ENTITY_BASES = {
  company:     { basis: 'straight_line', methods: ['slm'], prorata: 'days' },
  sole_trader: { basis: 'straight_line', methods: ['slm'], prorata: 'days' },
  partnership: { basis: 'straight_line', methods: ['slm'], prorata: 'days' },
};

/* ── STATE BASE sales-tax rates, percent (state revenue departments; base rate only — local rates add) ⚠ unverified. DC is the district. ── */
const STATE_RATES = Object.freeze({ AL: 4, AK: 0, AZ: 5.6, AR: 6.5, CA: 7.25, CO: 2.9, CT: 6.35, DE: 0, FL: 6, GA: 4, HI: 4, ID: 6, IL: 6.25, IN: 7, IA: 6, KS: 6.5, KY: 6, LA: 4.45,
  ME: 5.5, MD: 6, MA: 6.25, MI: 6, MN: 6.875, MS: 7, MO: 4.225, MT: 0, NE: 5.5, NV: 6.85, NH: 0, NJ: 6.625, NM: 4.875, NY: 4, NC: 4.75, ND: 5, OH: 5.75, OK: 4.5, OR: 0, PA: 6,
  RI: 7, SC: 6, SD: 4.2, TN: 7, TX: 6.25, UT: 6.1, VT: 6, VA: 5.3, WA: 6.5, WV: 6, WI: 5, WY: 4, DC: 6 });
const RATE_MENU = Object.freeze(Array.from(new Set([0].concat(Object.keys(STATE_RATES).map(function (k) { return STATE_RATES[k]; })))).sort(function (a, b) { return a - b; }));

/* ── the tax pack (the object tax-packs.PACKS.US is) — every number from COUNTRY-US-FACTS.md (⚠ = unverified) ── */
const TAX = Object.freeze({
    country: 'US',
    scheme: 'STAX',
    supply: 'border',                                    /* ONE head; the state is a RATE (stateRates), not a head split: no credit moves between states */
    rates: RATE_MENU,                                    /* the distinct state base rates plus 0 — a MENU; the shop's combined rate is its own setting ⚠ */
    standard_rate: null,                                 /* NO national rate: sales tax is set by each state and locality; the shop's combined rate is its own setting */
    stateRates: STATE_RATES,                             /* state base rates, percent — state revenue departments; base rate only, local rates add ⚠ */
    invoice_round_to: 0.01,                              /* cents; prices are shown EXCLUSIVE of tax; rounding rules vary by state ⚠ */
    idName: 'EIN',
    supplyKinds: Object.freeze({
      taxable: Object.freeze({ id: 'taxable', name: 'Taxable sale', rate: null, credit: false, box: 'taxable', why: 'Sales tax at the shop\'s combined state and local rate.', cite: 'state sales tax law ⚠' }),
      exempt:  Object.freeze({ id: 'exempt', name: 'Exempt sale', rate: 0, credit: false, box: 'exempt', why: 'Exempt in this state (groceries and prescriptions vary by state).', cite: 'state sales tax law ⚠' }),
      resale:  Object.freeze({ id: 'resale', name: 'Sale for resale (certificate)', rate: 0, credit: false, box: 'resale', why: 'Exempt: the buyer gave a resale exemption certificate.', cite: 'state resale certificate rules ⚠' }),
    }),
    registration: Object.freeze({ mandatory_minor: null, voluntary_minor: null, cite: 'Registration is by state nexus (physical or economic); thresholds differ by state and are not held here ⚠' }),
    source: 'State sales tax statutes · state revenue department guides (base rates) — from COUNTRY-US-FACTS.md, NOT yet read against the official pages (verified:false)',
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

/** ⭐ THE TAX HEADS: ONE — `stax` (state sales tax, single-stage, no input side); no use-tax / reverse-charge ledger until the round that builds it */
const TAX_HEADS = ['stax'];
const TAX_LEDGERS = { stax: { output: 'output_sales_tax', input: 'input_sales_tax', rcm: null } };

/** setOff({ output, input }, minor) → { utilised: [], payable, carried } — sales tax is single-stage: NO input credit (resale exemption certificates instead), the whole output is payable ⚠ */
function setOff(o, minor) {
  return KIT.noCreditSetOff(o, minor, { head: 'stax', negative: 'A sales tax balance is never negative here — pass the credit balance of Output sales tax.' });
}
const EVENT_ALIASES = {};
const MESSAGES = {
  nothingToSetOff: 'Nothing to set off: sales tax has no input credit, the whole amount collected is payable.',
  payHeadUnknown: 'A sales tax payment is one head — stax.',
  rcmHeadUnknown: 'Reverse-charge sales tax is one head — stax.',
  paymentEmpty: 'A sales tax payment needs the stax head with an amount.',
  paymentRef: { label: 'Payment reference', ask: 'Which payment? Give the state revenue department confirmation number.', hint: 'The state payment confirmation number', narration: 'Sales tax payment' },
  setOffNarration: 'Sales tax (no input credit)',
  rcmNotBuilt: { stax: 'Reverse charge is not built in this pack yet — post it as a manual entry.' },
};

/* ── the STATE sales and use tax return — frequency set by the state (monthly · quarterly · annual), due commonly the 20th of the month after the period (varies by state) ⚠ ── */
const MONTHS_ = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const STAX_LABELS = { gross_sales: 'Gross sales', taxable_sales: 'Taxable sales', tax_collected: 'Sales tax collected' };
const STEP_MONTHS = { monthly: 1, quarterly: 3, annual: 12 };
function periods(o) {
  var x = o || {}, y = parseInt(String(x.year || x.fy || ''), 10), f = String(x.frequency || 'quarterly').toLowerCase();
  if (!(y > 0)) throw refuse_('Sales tax periods need the year they start in (year: 2026).');
  if (!STEP_MONTHS[f]) throw refuse_('A sales tax return is monthly, quarterly or annual, as the state sets it.');
  var step = STEP_MONTHS[f], out = [];
  for (var a = 1; a <= 12; a += step) {
    var b = a + step - 1, d = b + 1, yd = y + (d > 12 ? 1 : 0), md = ((d - 1) % 12) + 1;
    out.push({ period: y + '-' + pad2_(a) + '/' + y + '-' + pad2_(b), label: step === 1 ? MONTHS_[a - 1] + ' ' + y : step === 12 ? String(y) : MONTHS_[a - 1] + '–' + MONTHS_[b - 1] + ' ' + y, frequency: f,
               start: ymd_(y, a, 1), end: ymd_(y, b, lastDay_(y, b)), due: ymd_(yd, md, 20), due_rule: 'commonly the 20th of the month after the period; varies by state ⚠' });
  }
  return out;
}
function net_(rows, role, side) { return (rows || []).filter(function (r) { return r.role === role; }).reduce(function (t, r) { var d = KIT.int(r.dr_minor, role, 'cents'), c = KIT.int(r.cr_minor, role, 'cents'); return t + (side === 'cr' ? c - d : d - c); }, 0); }
/** buildReturn(pack, period, movements) → the state return in returnFor's ONE screen shape: gross sales, taxable sales, tax collected; payable = collected */
function buildReturn(pack, period, movements) {
  var rows = movements || [], gross = net_(rows, 'sales', 'cr') - net_(rows, 'sales_returns', 'dr'), col = net_(rows, 'output_sales_tax', 'cr'), R = pack.returns;
  var boxes = [KIT.returnRow('gross_sales', STAX_LABELS.gross_sales, gross, null, [], null),
    KIT.returnRow('taxable_sales', STAX_LABELS.taxable_sales, gross, null, [], 'exempt and resale sales are not split from taxable sales yet — adjust on the state form'),
    KIT.returnRow('tax_collected', STAX_LABELS.tax_collected, null, col, [], null)];
  return { ok: true, pack: pack.id, form: R.id, name: R.name, short: R.short, authority: R.authority, portal: R.portal, period: period, currency: pack.currency, columns: ['amount', 'tax'],
           boxes: boxes, payable_minor: Math.max(0, col), refund_minor: 0, net_minor: col,
           notes: ['Sales tax has no input credit: the whole tax collected is payable.', 'Each state has its own form and due date; this is the common shape.'], cite: 'state sales and use tax return ⚠', detail: { gross: gross, collected: col } };
}

/** depreciation.compute(rows, base, ctx) → { total, rate, per } for ONE asset class — straight-line over the life, pro rata by days, never below nil (ASC 360-10) */
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
  taxNetting: [{ output: 'output_sales_tax', input: 'input_sales_tax', creditRole: 'stax_recoverable', payableRole: 'stax_payable', creditName: 'Sales tax recoverable', payableName: 'Sales tax payable' }],
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
/** the groups the core reads by KIND, and how a payment mode lands — ACH, check and Zelle land in the bank (no UPI outside India) */
const CHART = {
  paymentModes: { cash: 'cash', bank: 'bank', transfer: 'bank', cheque: 'bank', card: 'card', ach: 'bank', check: 'bank', zelle: 'bank' },
  kinds: { tax: 'tax_liabilities', stock: 'inventory', cash: 'cash_on_hand', bank: 'bank_accounts',
           loans: ['non_current_liabilities', 'loans', 'bank_overdraft'],
           sales: 'sales', purchases: 'purchases', directIncome: 'sales', directExpense: 'cost_of_sales',
           indirectIncome: 'other_income', indirectExpense: 'operating_expenses' },
};
/** the words a refusal quotes — ASC 330 Inventory (the cost formulas the pack cites are IAS 2's wording) */
const CITE = { inventoryFormula: 'IAS 2 para 25', lowerOfCostNrv: 'IAS 2 para 9' };
function accrualPayableFor(a) { return a && a.line === 'employee_benefits' ? 'wages_payable' : 'accrued_expenses'; }

/* bank statements: the amount prefixes and the whole words a narration uses — USD; no preset until checked against a real file */
const BANK = {
  amountPrefixes: ['usd'], minorUnit: 'minor units', presets: {},
  keywords: { default: { charges: ['CHARGES', 'FEE', 'FEES'], interest: ['INTEREST'], atm: ['ATM', 'WITHDRAWAL'], cash_deposit: ['CASH DEPOSIT'], cheque_return: ['RETURNED', 'REVERSAL'], transfer: ['TRANSFER'] } },
};

/** the fiscal year — the calendar year is the default (many states and the IRS accept any year end) ⚠; a shop whose year starts elsewhere says so in its own books setting; the REGISTERED pack carries only fiscalYear */
const FISCAL_YEAR = { startMonth: 1, label: 'single' };

/** ⭐ THE PACK — the regulation contract (regulation.js) in one object; `sch3` is the contract's NAME for the statement-line table */
const PACK = {
  id: 'US', version: '1.0.0', name: 'United States · Sales tax', verified: false,
  country: 'US', basis: 'US GAAP statement lines · ASC 360 straight-line · state sales and use tax return', currency: 'USD',
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
  taxId: { name: 'EIN', hint: '12-3456789', check: function (v) { var s = String(v == null ? '' : v).trim().replace(/\s+/g, '');
      var m = /^(\d{2})-?(\d{7})$/.exec(s);
      if (m) return { ok: true, value: m[1] + '-' + m[2], why: null };
      return { ok: false, value: s, why: 'An EIN looks like 12-3456789 (2 digits, a dash, 7 digits).' }; } },
  returns: { id: 'STATE-ST', name: 'State sales and use tax return', short: 'Sales tax return', authority: 'State revenue department', portal: 'the state tax portal', frequencies: ['monthly', 'quarterly', 'annual'], labels: STAX_LABELS, periods: periods, build: buildReturn },
  locale: { format: 'en-US', langs: ['en'] },
  timeZones: ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Phoenix', 'America/Los_Angeles', 'America/Anchorage', 'Pacific/Honolulu'],
  retentionYears: 4,
  records: { years: { standard: 4 }, cite: 'IRS employment-tax records 4 years; many states 3–4 years ⚠' },
  invoice: { requiredLines: ['trade_name', 'address'], cite: 'A US receipt need not show a tax ID, so no tax_id line is required; state rules for sales-tax lines differ ⚠' },
  connectors: [{ id: 'quickbooks', name: 'QuickBooks Online', fits: 'none' }, { id: 'xero', name: 'Xero', fits: 'none' }, { id: 'sage', name: 'Sage', fits: 'none' }],
  numbering: { default: { dating: 'fy', resets: 'never', dayRollHour: 0 }, law: 'none_found' },
  words: { taxName: 'Sales tax', registration: 'Sales tax permit', returnShort: 'Sales tax return', taxId: 'EIN', postcode: 'ZIP code', region: 'State' },
  payments: ['cash', 'card', 'ach', 'check', 'zelle'],
  scope: { out: { 'tax.rcm': 'use tax on out-of-state purchases is a later round', 'tax.supply': 'local (county/city) rates and sourcing rules are the shop\'s own combined-rate setting', depreciation: 'MACRS tax depreciation is out of scope', einvoice: 'no national e-invoicing exists', payroll: 'payroll is out of scope' },
           partial: { returns: 'every state has its own form, frequency and due date; the pack builds a generic state return', taxId: 'a state sales-tax permit number has no common format; only the EIN is checked', 'tax.rates': 'state BASE rates only, local rates add' } },
};

const EXPORTS = PACK;

/* ⭐ ONE FILE, EVERY HOST: node takes module.exports; a page, the TV and the shop PC take window.CBRegUS. */
if (typeof module !== 'undefined' && module.exports) module.exports = EXPORTS;
if (root && typeof root.window !== 'undefined') root.window.CBRegUS = EXPORTS;
})(typeof globalThis !== 'undefined' ? globalThis : this);
