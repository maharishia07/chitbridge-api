/* ADOPTED from chitbridge-engines v1.57.1 · regulation · sha256 99324e7bc565cc0544626a78d2680aaecf06e8b0a74030e530f59fc3014c5b21 — DO NOT EDIT HERE. Change it in chitbridge-engines, release a version, then run tools/adopt.cjs. */
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
var BUILT_IN_ = [['CBRegIN', './reg-in'], ['CBRegAU', './reg-au'], ['CBRegAE', './reg-ae'], ['CBRegSG', './reg-sg'], ['CBRegMY', './reg-my'], ['CBRegUS', './reg-us'], ['CBRegJP', './reg-jp']];   /* v1.34.0 (AU1): Australia; v1.37.0 (AE1): the UAE — the one line a new country adds (packs/TEMPLATE.md, tools/new-pack.cjs) */
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
