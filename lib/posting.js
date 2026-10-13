/* ADOPTED from chitbridge-engines v1.44.1 · posting · sha256 0742a9e7a47f54796bb5df10215946779ca17649519df47372c90d8f2b677956 — DO NOT EDIT HERE. Change it in chitbridge-engines, release a version, then run tools/adopt.cjs. */
/* chitbridge-engines · posting. Edited ONLY in chitbridge-engines/src/posting.js; every platform adopts a released version of it. */
(function (root) {
'use strict';
// @stage tested
// @stage-note [BOOKS] An event in, balanced Dr/Cr lines out — refused when they do not balance to the minor unit. No
// @stage-note storage, no clock. tests/posting.test.js includes 20,000 generated events, every one balancing.
/**
 * posting.js — AN EVENT IN, BALANCED DEBIT/CREDIT LINES OUT (v1.7.0, 2026-09-28; v1.8.0 2026-09-29; hardened v1.8.1 2026-09-30). [SPEC-books.md, SPEC-books-v2.md §3]
 *
 * Athi, 2026-09-28: *"how do we journalise?"* — and then *"we don't claim as an accounting system until we are well
 * confident, but still record the information according to principle."* ⚠️⚠️ SO THIS IS A RECORD KEPT BY DOUBLE-ENTRY
 * PRINCIPLE, NOT ACCOUNTING SOFTWARE, and nothing built on it may be called "books of account" until Athi says so.
 *
 * ⭐ THE GOLDEN RULES, which every rule below follows (the account's type comes from accounts-packs):
 *   personal — Dr the receiver, Cr the giver        real — Dr what comes in, Cr what goes out
 *   nominal  — Dr expenses and losses, Cr incomes and gains
 *
 * ⭐ GRANULARITY (decided 2026-09-28): a WALK-IN sale is posted as ONE entry per counter per day (per payment mode, per tax
 * rate) at day close; any sale to a NAMED party — credit, a customer on the list, B2B with a tax id — is posted PER BILL,
 * because that party's account needs each bill. granularity() decides; the shop's setting only moves walk-in trade.
 *
 * ── A LINE ──  { account, dr, cr, party?, rate?, ref, rule }  — one of dr / cr is 0; amounts in the event's currency.
 * ── v1.8.0 ── a line also carries { code (4-digit), dr_minor, cr_minor, currency (FUNCTIONAL), txn_currency,
 *   amount_txn_minor, fx_rate }; the entry carries { fiscal_year, period (0 = opening), is_opening, rule }. New rules:
 *   purchase_bill, purchase_return, payment_made (cheque only when cleared), opening (difference → Suspense 2900),
 *   manual (owner, narration, must balance), credit_note (= return). write_off now needs the owner too.
 *   ⚠️ An event in a currency other than the functional one (ctx.functional, else the pack's) needs fx_rate — refused
 *   without it; conversion rounding is ONE named round-off line (fx_rounding: true), never spread over the others.
 * ⚠️⚠️ EXACT TO THE MINOR UNIT: every rule builds its lines in integers (minor units) and post() REFUSES anything whose debits do
 * not equal its credits — a journal that is off by one minor unit is refused, never rounded into balance.
 * ⭐ Every line carries `rule` = RULES_VERSION, so a line posted today can be re-derived by the same rules tomorrow.
 * ── v1.8.1 (the critic's review, 2026-09-29) — WHAT IS NOW REFUSED, each with its reason, ok: false ──
 *   H2  a date that is not a real calendar day written YYYY-MM-DD (none, a datetime, '2026-9-5', 30 Feb, month 13)
 *   H4  an amount or fx_rate that is not a finite number or a plain decimal string (Infinity, '0x10', true, [5], '1e3');
 *       an amount at or beyond 10^15 minor units (L1: past that a float drops minor units); a rate that turns a line into 0
 *   M1  an expense / other-income `class` that is not an expense / income account (it would flip the entry's sides)
 *   M2  a party on a line that is not debtors / creditors (the mirror of "required there")
 *   L3  a walk-in bill with no currency. The lines a valid event produces are UNCHANGED, so RULES_VERSION stays.
 * ⚠️ OPEN, FOR ATHI (critic L2): `credit_given from: 'cheque'` and `expense paid_from: 'cheque'` post to the bank at
 *   ISSUE — C3 (clearing) is enforced only on payment_received / payment_made. some systems post an issued cheque at issue; the
 *   house rule says clearing. Not changed here: it is a decision, not a guard.
 * ── v1.14.0 — BOOKS RULES R1–R8 (Athi, 2026-10-02: "follow the standard"; docs/design/books-rules/PLAN.md) ──
 *   NEW RULES, each a different Dr/Cr pattern the standard names (the only alternative was `manual`, owner-only, unchecked):
 *   closing_stock     lower of cost and NRV (the pack cites the standard); posts the DIFFERENCE from the books (Dr stock · Cr changes in
 *                     inventories, or the reverse). A closing stock needs its mode, `book`, and its value; AUTOMATIC is refused
 *                     (it needs quantities on hand, which the platform does not keep yet) — never guessed.
 *   loan_taken        Dr the mode · Cr a loan account.   loan_repaid  Dr loan principal · Dr interest (a finance cost) · Cr mode.
 *                     A loan needs a loan account (secured, unsecured, bank OD) — capital is not one.
 *   accrual           outstanding / prepaid / accrued_income / income_in_advance; `reverse` swaps the sides on the first day of the
 *                     next period and must name what it reverses.
 *   tax_setoff        the pack's order of set-off, by the same taxSetOff() the app calls (one calculation; gstSetOff is its older name).
 *   tax_payment       Dr output tax per head · Cr the mode (the statutory payment). Needs a head with an amount, a known mode.
 *   depreciation      Dr depreciation · Cr accumulated depreciation, per class; the amounts come from depreciationFor().
 *   asset_disposal    Dr proceeds · Dr accumulated · Cr cost · Cr output tax · the balance is profit or loss on sale.
 *   WIDENED: purchase_bill takes `accept: 'resale' (default) | 'asset' | 'use'` — resale is unchanged, so no old answer moves.
 *   BUILDERS: gstSetOff(o) and depreciationFor(o) are pure, in the daySummary pattern. Rates live in the pack (data).
 * ── v1.16.0 — OPTIONAL TAX HEADS, VOUCHER TYPES, CONTRA, THE DISHONOURED CHEQUE (Athi, 2026-10-02: "Follow the standard") ──
 *   HEADS     a tax row carries a figure per head of the pack (pack.taxHeads, in line order); an OPTIONAL head (pack.optionalHeads) is in a summary or a set-off answer only when a figure for it was handed in.
 *             The order of set-off is the pack's (pack.setOff); a set-off without an optional head is unchanged.
 *   VOUCHERS  VOUCHER_TYPE_OF (event → Sales · Purchase · Receipt · Payment · Contra · Credit note · Debit note · Journal, each choice reasoned
 *             at the table) and voucherTypeOf(event, { manual }) → { type, series }; post() returns it as `voucher`. A person's own entry is series MJ.
 *   NEW RULES contra (between cash and bank-type accounts) and cheque_dishonoured (a cleared cheque the bank returned: Dr the party · Cr Bank, + the charge).
 *   No existing event's lines change, so RULES_VERSION stays.
 */
const RULES_VERSION = 'posting-1.2';   /* v1.14.0: closing stock, loans, accruals, tax set-off and payment, depreciation; v1.8.0 purchases, payments made, opening, manual */

var MONEY_ = null, PACKS_ = null, REG_ = null;
function M_() {
  var M = (typeof CBMoney !== 'undefined' && CBMoney.round) ? CBMoney : MONEY_;
  if (M === null && typeof require === 'function') { try { M = MONEY_ = require('./money'); } catch (_) { M = MONEY_ = false; } }
  return M || null;
}
function P_() {
  var P = (typeof CBAccountsPacks !== 'undefined' && CBAccountsPacks.accountOf) ? CBAccountsPacks : PACKS_;
  if (P === null && typeof require === 'function') { try { P = PACKS_ = require('./accounts-packs'); } catch (_) { P = PACKS_ = false; } }
  return P || null;
}
function R_() {
  var R = (typeof CBRegulation !== 'undefined' && CBRegulation.resolve) ? CBRegulation : REG_;
  if (R === null && typeof require === 'function') { try { R = REG_ = require('./regulation'); } catch (_) { R = REG_ = false; } }
  return R || null;
}
/** the default pack, read at load by the tables below — an engine that cannot see the registry says so in plain words instead of loading empty */
function defaultPack_() {
  var R = R_(), d = R && R.packFor(R.DEFAULT);
  if (!d) throw new Error('posting.js needs regulation.js (CBRegulation, with the India pack) loaded before it — add the regulation scripts ahead of this one on the page; see the CHANGELOG, v1.28.0.');
  return d;
}
function decimals_(cur) { var M = M_(); return M && M.decimals ? M.decimals(cur) : 2; }
/**
 * ⚠️ v1.8.1 (critic H4, L1) — WHAT COUNTS AS AN AMOUNT: a finite number, or a plain decimal string. The reading is
 * money.priceOf's (the one reader every engine shares — no second parser here); on top of it a bare object/array and an
 * exponent string are refused, because a stored amount is never written that way. Absent (null / undefined / '') = 0.
 * ⚠️ THE CEILING: 10^15 minor units. toPrecision(15) keeps 15 significant digits, so beyond it minor units are silently lost
 * (₹90071992547409.91 came back 90071992547409.90); refused by name instead.
 */
const MINOR_CEILING = 1e15;
function num_(v, what) {
  var M = M_();
  if (!M || !M.priceOf) throw refuse_('Posting needs the money engine (it reads every amount).');
  var n = (v !== null && typeof v === 'object') || (typeof v === 'string' && /[eE]/.test(v)) ? null : M.priceOf(v);
  if (n === null) throw refuse_('Not an amount (' + what + '): ' + typeof v + ' ' + String(v).slice(0, 40) + ' — a finite number or a plain decimal string.');
  return n;
}
function toMinor(amount, cur, what) {
  if (amount == null || amount === '') return 0;
  var raw = num_(amount, what || 'an amount') * Math.pow(10, decimals_(cur));
  if (!(Math.abs(raw) < MINOR_CEILING)) throw refuse_('The amount ' + String(amount).slice(0, 40) + ' is beyond what this record holds exactly (10^15 minor units).');
  return Math.round(Number(raw.toPrecision(15)));
}
function fromMinor(minor, cur) { var f = Math.pow(10, decimals_(cur)); return Number((minor / f).toFixed(decimals_(cur))); }

/** the rule an event type means: through the pack's eventAliases (a stored event keeps its old type name; the rule is the neutral one) */
function ruleOf_(pack, type) {
  var a = pack && pack.eventAliases;
  return a && Object.prototype.hasOwnProperty.call(a, type) ? a[type] : type;
}
/** the name a pack's own accountants still use for a neutral event type, else the type itself */
function aliasFor_(pack, neutral) {
  var a = (pack && pack.eventAliases) || {}, hit = Object.keys(a).filter(function (k) { return a[k] === neutral; })[0];
  return hit || neutral;
}
/** how a payment mode lands: the REAL account money comes into. A cheque posts only on clearing, into the bank (C3). */
/* the modes a payment can come in by, and the real account each lands on — the pack's (chart.paymentModes); the export is the DEFAULT pack's table, unchanged */
const MODE_ACCOUNT = (function () { var d = defaultPack_(); return (d.chart && d.chart.paymentModes) || {}; })();
/** own keys only: a stored mode of "constructor" or "__proto__" is an unknown mode, never an inherited function */
function mode_(key, k) {
  var modes = ((((k && k.pack) || {}).chart) || {}).paymentModes;
  if (!modes) throw refuse_('The regulation pack names no payment modes, so no payment can be posted.');
  return Object.prototype.hasOwnProperty.call(modes, key) ? modes[key] : undefined;
}

/**
 * ⭐ granularity(ctx) → 'bill' | 'day' | 'shift' — how a SALE is posted.
 *   ctx: { setting: 'day' (default) | 'bill' | 'shift', party?, credit?, tax_id? (an older name of this field is still read) }
 * A named party, a credit sale or a buyer with a tax id is ALWAYS per bill: their own account needs each bill.
 */
function granularity(ctx) {
  var c = ctx || {};
  if (c.party || c.credit || c.tax_id || c.gstin) return 'bill';
  return c.setting === 'bill' || c.setting === 'shift' ? c.setting : 'day';
}

/* ── the lines a rule builds, in minor units, then checked and turned into amounts ── */
function L_(account, dr, cr, extra) { return Object.assign({ account: account, dr: dr, cr: cr }, extra || {}); }
/** the pack that names the tax heads (in line order) and the ledger each lands on: pack.taxHeads, pack.taxLedgers[head].output | .input | .rcm */
function taxPack_(k) {
  var p = k && k.pack;
  if (!p || !Array.isArray(p.taxHeads) || !p.taxLedgers) throw refuse_('The regulation pack names no tax heads, so no tax can be posted.');
  return p;
}
/** a row of tax figures keyed by head, from a record that may carry any of them: { taxable: 0, <head>: amount … } */
function headRow_(k, t) {
  var row = { taxable: 0 };
  taxPack_(k).taxHeads.forEach(function (h) { row[h] = (t || {})[h]; });
  return row;
}
/** rows → lines: the base amount, then each head of the pack in ITS order, on the ledger the pack names for that head and side ('output' | 'input') */
function taxLines_(rows, cur, side, prefix, k) {
  var p = taxPack_(k), out = [];
  (rows || []).forEach(function (r) {
    var rate = r.rate != null ? String(r.rate) : undefined;
    var add = function (acct, amt) { var m = toMinor(amt, cur); if (m) out.push(side === 'cr' ? L_(acct, 0, m, { rate: rate }) : L_(acct, m, 0, { rate: rate })); };
    add(prefix.base, r.taxable);
    p.taxHeads.forEach(function (h) { add(p.taxLedgers[h][prefix.tax], r[h]); });
  });
  return out;
}
function modeLines_(modes, cur, side, ctx) {
  var out = [];
  Object.keys(modes || {}).forEach(function (key) {
    var acct = mode_(key, ctx); var m = toMinor(modes[key], cur);
    if (!m) return;
    out.push(side === 'dr' ? L_(acct || ('?' + key), m, 0) : L_(acct || ('?' + key), 0, m));
  });
  return out;
}
/**
 * round_off = what was CHARGED minus what the lines add up to. Rounded UP (₹9.99 billed as ₹10) the shop collected the
 * extra minor unit: Cr round off. Rounded DOWN it gave a minor unit away: Dr round off. (The walk-in test caught this sign wrong.)
 */
function roundOff_(v, cur) { var m = toMinor(v, cur); if (!m) return []; return m > 0 ? [L_('round_off', 0, m)] : [L_('round_off', -m, 0)]; }
/** a purchase rounded UP means the shop PAID the extra minor unit: Dr round off (the mirror of a sale) */
function roundOffPaid_(v, cur) { var m = toMinor(v, cur); if (!m) return []; return m > 0 ? [L_('round_off', m, 0)] : [L_('round_off', 0, -m)]; }
/** lines handed in whole (opening, manual): { account, dr?, cr?, party? } → minor-unit lines */
function givenLines_(rows, cur) {
  return (rows || []).map(function (r) {
    var dr = toMinor(r.dr || 0, cur), cr = toMinor(r.cr || 0, cur);
    return L_(String(r.account == null ? '' : r.account), dr, cr, r.party ? { party: r.party } : null);
  });
}
/**
 * v1.8.1 (critic M1) — the `class` of an expense / other income must BE one: accountOf(...).kind 'expense_class' /
 * 'income_class'; or a ledger that is also listed as such a class (interest_received 4200 is both — accountOf finds the
 * ledger first); or a ledger the SHOP added (role null) under an expense / income group. Anything else — sales, capital,
 * output tax, cash — would flip the entry's sides while still being labelled an expense, and is refused by name.
 */
function classOf_(k, cls, want) {
  if (!k || !k.pack || !k.P) return;
  var a = k.P.accountOf(k.pack, cls); if (!a) return;                  /* not in the chart: post() refuses it by name */
  var list = (want === 'expense' ? k.pack.expense_classes : k.pack.income_classes) || [];
  var ok = a.kind === want + '_class'
    || (a.kind === 'ledger' && a.role != null && list.some(function (r) { return r.role === a.role; }))
    || (a.kind === 'ledger' && a.role == null && a.nature === want && a.statement === 'pl');
  if (!ok) throw refuse_('"' + String(cls).slice(0, 40) + '" (' + a.code + ' ' + a.name + ') is not an ' + want + ' class — posting ' + (want === 'expense' ? 'an expense' : 'other income') + ' to it would flip the entry\'s sides.');
}
function owner_(e) { if (e.owner !== true) throw refuse_('Only the owner may post a ' + String(e.type).replace('_', ' ') + '.'); }

const RULES = {
  /** walk-in trade of one counter for one day (or shift): Dr each payment mode · Cr sales per rate · Cr output tax */
  walkin_day: function (e, cur, k) {
    return modeLines_(e.modes, cur, 'dr', k).concat(taxLines_(e.by_rate, cur, 'cr', { base: 'sales', tax: 'output' }, k), roundOff_(e.round_off, cur));
  },
  /**
   * a sale to a named party, per bill: Dr the party for what is unpaid · Dr any mode paid at the till · Cr sales · Cr tax.
   * (L11) An OVER-paid bill lands Cr debtors — the party is in credit on its own account. The chart's
   * customer_advance 2400 / supplier_advance 1700 are not used by any rule; an advance is a payment_received sitting on account.
   */
  sale_bill: function (e, cur, k) {
    var credit = taxLines_(e.by_rate, cur, 'cr', { base: 'sales', tax: 'output' }, k);
    var paid = modeLines_(e.paid, cur, 'dr', k), rOff = roundOff_(e.round_off, cur);
    var owed = sum_(credit, 'cr') - sum_(paid, 'dr') - sum_(rOff, 'dr') + sum_(rOff, 'cr');
    var lines = paid.concat(credit, rOff);
    if (owed) lines.unshift(owed > 0 ? L_('debtors', owed, 0, { party: e.party }) : L_('debtors', 0, -owed, { party: e.party }));
    return lines;
  },
  /** a payment received: Dr where the money came in · Cr the party. A cheque only once CLEARED (C3). */
  payment_received: function (e, cur, k) {
    if (e.mode === 'cheque' && e.cheque_status !== 'cleared') throw refuse_('A cheque is posted when it CLEARS, not when it is received (it is ' + (e.cheque_status || 'received') + ').');
    var acct = mode_(e.mode, k); if (!acct) throw refuse_('Unknown payment mode "' + e.mode + '".');
    var m = toMinor(e.amount, cur);
    return [L_(acct, m, 0), L_('debtors', 0, m, { party: e.party })];
  },
  /** credit given with no sale (D2): Dr the party · Cr the cash or bank it left from. No tax — nothing was sold. */
  credit_given: function (e, cur, k) {
    var acct = mode_(e.from || 'cash', k); if (!acct) throw refuse_('Unknown source "' + e.from + '".');
    var m = toMinor(e.amount, cur);
    return [L_('debtors', m, 0, { party: e.party }), L_(acct, 0, m)];
  },
  /** an expense by class: Dr the class (+ input tax) · Cr what paid it — a mode, or the supplier when on credit */
  expense: function (e, cur, k) {
    classOf_(k, e.class, 'expense');
    var dr = [L_(e.class, toMinor(e.amount, cur), 0)].concat(taxLines_(e.input_tax ? [Object.assign({ taxable: 0 }, e.input_tax)] : [], cur, 'dr', { base: e.class, tax: 'input' }, k).filter(function (l) { return l.account !== e.class; }));
    var total = sum_(dr, 'dr');
    var cr = e.supplier ? [L_('creditors', 0, total, { party: e.supplier })] : [L_(mode_(e.paid_from || 'cash', k) || ('?' + e.paid_from), 0, total)];
    return dr.concat(cr);
  },
  /** other income by class: Dr where it came in · Cr the class */
  other_income: function (e, cur, k) {
    classOf_(k, e.class, 'income');
    var m = toMinor(e.amount, cur);
    return [L_(mode_(e.into || 'cash', k) || ('?' + e.into), m, 0), L_(e.class, 0, m)];
  },
  /**
   * a return / credit note: Dr sales returns per rate · Dr output tax back · Cr the party, or Cr the mode refunded.
   * (L13) ONE or the other: a return partly refunded in cash and partly credited has no rule yet and is refused as
   * unbalanced — post it as two events (a return credited + a payment made back), or as a manual entry.
   */
  return: function (e, cur, k) {
    var dr = taxLines_(e.by_rate, cur, 'dr', { base: 'sales_returns', tax: 'output' }, k);
    var total = sum_(dr, 'dr');
    var cr = e.party && !e.refund ? [L_('debtors', 0, total, { party: e.party })] : modeLines_(e.refund, cur, 'cr', k);
    return dr.concat(cr);
  },
  /** a write-off (owner only, with a reason): Dr bad debts · Cr the party */
  write_off: function (e, cur) {
    owner_(e);
    if (!String(e.reason || '').trim()) throw refuse_('A write-off needs a reason.');
    var m = toMinor(e.amount, cur);
    return [L_('bad_debts', m, 0), L_('debtors', 0, m, { party: e.party })];
  },
  /** a credit note is a return by another name (the document a tax return lists) */
  credit_note: function (e, cur, k) { return RULES.return(e, cur, k); },
  /** a purchase, per bill: Dr purchases per rate · Dr input tax · Cr any mode paid · Cr the supplier for the rest */
  purchase_bill: function (e, cur, k) {
    var base = purchaseBase_(e, k), dr = taxLines_(e.by_rate, cur, 'dr', { base: base, tax: 'input' }, k), rOff = roundOffPaid_(e.round_off, cur);
    var rc = rcmLines_(e.rcm, cur, base, k);                     /* v1.20.0: reverse charge — the buyer's own tax, never the supplier's */
    var paid = modeLines_(e.paid, cur, 'cr', k);
    var owed = sum_(dr, 'dr') + sum_(rc.dr, 'dr') + sum_(rOff, 'dr') - sum_(rOff, 'cr') - sum_(paid, 'cr') - sum_(rc.cr, 'cr');
    var lines = dr.concat(rc.dr, rOff, paid, rc.cr);
    if (owed) lines.push(owed > 0 ? L_('creditors', 0, owed, { party: e.party }) : L_('creditors', -owed, 0, { party: e.party }));
    return lines;
  },
  /** goods sent back to a supplier: Dr the supplier (or the mode refunded) · Cr purchase returns per rate · Cr input tax back */
  purchase_return: function (e, cur, k) {
    var cr = taxLines_(e.by_rate, cur, 'cr', { base: 'purchase_returns', tax: 'input' }, k);
    var total = sum_(cr, 'cr');
    var dr = e.party && !e.refund ? [L_('creditors', total, 0, { party: e.party })] : modeLines_(e.refund, cur, 'dr', k);
    return dr.concat(cr);
  },
  /** a payment made to a supplier: Dr the supplier · Cr where it left from. A cheque only once CLEARED (C3). */
  payment_made: function (e, cur, k) {
    if (e.mode === 'cheque' && e.cheque_status !== 'cleared') throw refuse_('A cheque is posted when it CLEARS, not when it is issued (it is ' + (e.cheque_status || 'issued') + ').');
    var acct = mode_(e.mode, k); if (!acct) throw refuse_('Unknown payment mode "' + e.mode + '".');
    var m = toMinor(e.amount, cur);
    return [L_('creditors', m, 0, { party: e.party }), L_(acct, 0, m)];
  },
  /**
   * v1.14.0 R1 — a closing stock: the stock account is brought to the VALUE counted, so it always holds the latest valuation and
   * `changes_in_inventories` holds opening − closing for any period. Dr stock · Cr changes (value above the books), or the reverse.
   */
  closing_stock: function (e, cur, k) {
    if (e.mode === 'automatic') throw refuse_('Automatic closing stock needs quantities on hand, which the platform does not keep yet (inventory lifecycle: designed, not built) — enter the closing value (mode: \'manual\').');
    if (e.mode !== 'manual') throw refuse_('A closing stock needs its mode — \'manual\' or \'automatic\' (the shop setting).');
    if (e.book == null || e.book === '') throw refuse_('A closing stock needs `book` — the stock on the books before it (balanceAsAt on Stock-in-hand); it is never assumed.');
    if (e.method != null && e.method !== 'fifo' && e.method !== 'weighted_average') throw refuse_('A cost formula is FIFO or weighted average (' + k.pack.cite.inventoryFormula + ').');
    var hasCost = e.cost != null && e.cost !== '', hasNrv = e.nrv != null && e.nrv !== '', hasAmt = e.amount != null && e.amount !== '';
    if (!hasAmt && !(hasCost && hasNrv)) throw refuse_('A closing stock needs its value — amount, or cost and nrv.');
    var v = hasAmt ? toMinor(e.amount, cur) : null, book = toMinor(e.book, cur);
    if (hasCost && hasNrv) {
      var c = toMinor(e.cost, cur), n = toMinor(e.nrv, cur), low = Math.min(c, n);
      if (v !== null && v !== low) throw refuse_('A closing stock is valued at the lower of cost and net realisable value (' + k.pack.cite.lowerOfCostNrv + ') — ' + fromMinor(v, cur) + ' is ' + (v > low ? 'above' : 'not') + ' ' + (n <= c ? 'NRV ' + fromMinor(n, cur) : 'cost ' + fromMinor(c, cur)) + '.');
      v = low;
    }
    if (v < 0 || book < 0) throw refuse_('A closing stock value is never negative.');
    var d = v - book;
    if (!d) throw refuse_('The stock on the books (' + fromMinor(book, cur) + ') already equals the closing value — nothing to post.');
    return d > 0 ? [L_('stock', d, 0), L_('changes_in_inventories', 0, d)] : [L_('changes_in_inventories', -d, 0), L_('stock', 0, -d)];
  },
  /** v1.14.0 R5 — a loan taken: Dr where the money came in · Cr the loan account */
  loan_taken: function (e, cur, k) {
    var loan = loanOf_(k, e.loan), acct = mode_(e.into || 'bank', k); if (!acct) throw refuse_('Unknown payment mode "' + e.into + '".');
    var m = toMinor(e.amount, cur);
    return [L_(acct, m, 0), L_(loan, 0, m)];
  },
  /** v1.14.0 R5 — a repayment: Dr the loan (principal) · Dr interest on loans (a finance cost) · Cr where it left from. A cheque only once CLEARED (C3). */
  loan_repaid: function (e, cur, k) {
    var loan = loanOf_(k, e.loan), from = e.from || 'bank';
    if (from === 'cheque' && e.cheque_status !== 'cleared') throw refuse_('A cheque is posted when it CLEARS, not when it is issued (it is ' + (e.cheque_status || 'issued') + ').');
    var acct = mode_(from, k); if (!acct) throw refuse_('Unknown payment mode "' + from + '".');
    var pr = toMinor(e.principal, cur), it = toMinor(e.interest, cur);
    if (!pr && !it) throw refuse_('A repayment needs a principal or interest.');
    var lines = [];
    if (pr) lines.push(L_(loan, pr, 0));
    if (it) lines.push(L_('interest_paid', it, 0));
    return lines.concat([L_(acct, 0, pr + it)]);
  },
  /**
   * v1.14.0 R6 — an accrual at a period end (an expense belongs to the period it was incurred in). `reverse: true` swaps every
   * line's side — posted on the first day of the next period, so the real bill posts normally. Names what it reverses.
   */
  accrual: function (e, cur, k) {
    var kinds = { outstanding: 'expense', prepaid: 'expense', accrued_income: 'income', income_in_advance: 'income' };
    if (!Object.prototype.hasOwnProperty.call(kinds, e.kind)) throw refuse_('An accrual is outstanding, prepaid, accrued_income or income_in_advance.');
    if (e.reverse && !String(e.reverses || '').trim()) throw refuse_('A reversal names the accrual it reverses (reverses: its ref).');
    classOf_(k, e.class, kinds[e.kind]);
    var m = toMinor(e.amount, cur), a = k && k.pack && k.P ? k.P.accountOf(k.pack, e.class) : null;
    var payable = k.pack.accrualPayableFor(a);
    var lines = e.kind === 'outstanding' ? [L_(e.class, m, 0), L_(payable, 0, m)]
      : e.kind === 'prepaid' ? [L_('prepaid_expenses', m, 0), L_(e.class, 0, m)]
      : e.kind === 'accrued_income' ? [L_('accrued_income', m, 0), L_(e.class, 0, m)]
      : [L_(e.class, m, 0), L_('income_in_advance', 0, m)];
    return e.reverse ? lines.map(function (l) { return L_(l.account, l.cr, l.dr); }) : lines;
  },
  /** v1.14.0 R3 — the set-off of tax credit against tax owed, in the order the pack's law gives (taxSetOff): Dr output_<against> · Cr input_<from> */
  tax_setoff: function (e, cur, k) {
    var p = taxPack_(k), so = taxSetOff_(p, e.output, e.input, cur);
    if (!so.utilised.length) throw refuse_(p.messages.nothingToSetOff);
    var lines = [];
    so.utilised.forEach(function (u) { lines.push(L_(p.taxLedgers[u.against].output, u.amount, 0), L_(p.taxLedgers[u.from].input, 0, u.amount)); });
    return lines;
  },
  /** v1.14.0 R3 — the statutory payment: Dr output tax per head · Cr where it was paid from. A cheque only once CLEARED. */
  tax_payment: function (e, cur, k) {
    var p = taxPack_(k), heads = e.heads && typeof e.heads === 'object' ? e.heads : {}, rcmHeads = rcmHeads_(p);
    Object.keys(heads).forEach(function (h) { if (p.payHeads.indexOf(h) < 0) throw refuse_(p.messages.payHeadUnknown); });
    if (e.mode === 'cheque' && e.cheque_status !== 'cleared') throw refuse_('A cheque is posted when it CLEARS, not when it is issued (it is ' + (e.cheque_status || 'issued') + ').');
    var acct = mode_(e.mode, k); if (!acct) throw refuse_('Unknown payment mode "' + e.mode + '".');
    var lines = [], total = 0, rcm = e.rcm && typeof e.rcm === 'object' ? e.rcm : {};
    Object.keys(rcm).forEach(function (h) { if (rcmHeads.indexOf(h) < 0) throw refuse_(p.messages.rcmHeadUnknown); });
    p.payHeads.forEach(function (h) { var m = toMinor(heads[h], cur); if (m) { lines.push(L_(p.taxLedgers[h].output, m, 0)); total += m; } });
    /* v1.20.0: the reverse-charge liability is paid by this payment, in cash — Dr the head's reverse-charge ledger */
    rcmHeads.forEach(function (h) { var m = toMinor(rcm[h], cur); if (m) { lines.push(L_(p.taxLedgers[h].rcm, m, 0)); total += m; } });
    if (!total) throw refuse_(p.messages.paymentEmpty);
    return lines.concat([L_(acct, 0, total)]);
  },
  /** v1.14.0 R2 — depreciation by class: Dr depreciation · Cr that class's accumulated depreciation (amounts from depreciationFor) */
  depreciation: function (e, cur, k) {
    var rows = Array.isArray(e.by_class) ? e.by_class : [];
    if (!rows.length) throw refuse_('A depreciation entry needs at least one class with an amount.');
    var lines = [];
    rows.forEach(function (r) {
      var c = assetClass_(k, r && r.class), m = toMinor(r.amount, cur);
      if (!(m > 0)) throw refuse_('The depreciation of "' + c.class + '" needs an amount above nothing.');
      lines.push(L_('depreciation', m, 0), L_(c.acc_role, 0, m));
    });
    return lines;
  },
  /**
   * v1.14.0 R2 — an asset sold or scrapped: Dr where the proceeds came in (or the buyer) + tax · Dr accumulated depreciation ·
   * Cr the asset's cost · Cr output tax · the balance is the profit (Cr) or loss (Dr) on sale.
   */
  asset_disposal: function (e, cur, k) {
    var c = assetClass_(k, e.asset_class), cost = toMinor(e.cost, cur), acc = toMinor(e.accumulated, cur), pro = toMinor(e.proceeds, cur);
    if (acc > cost) throw refuse_('The accumulated depreciation (' + fromMinor(acc, cur) + ') is above the asset\'s cost (' + fromMinor(cost, cur) + ').');
    var tax = taxLines_([headRow_(k, e.tax)], cur, 'cr', { base: 'sales', tax: 'output' }, k).filter(function (l) { return l.account !== 'sales'; });
    var due = pro + sum_(tax, 'cr'), lines = [];
    var from = e.party ? L_('debtors', due, 0, { party: e.party }) : L_(mode_(e.into || 'cash', k) || ('?' + e.into), due, 0);
    if (due) lines.push(from);
    if (acc) lines.push(L_(c.acc_role, acc, 0));
    lines.push(L_(c.cost_role, 0, cost));
    lines = lines.concat(tax);
    var gain = pro + acc - cost;
    if (gain > 0) lines.push(L_('gain_on_disposal', 0, gain)); else if (gain < 0) lines.push(L_('loss_on_disposal', -gain, 0));
    return lines;
  },
  /**
   * opening balances (period 0): the lines as handed in; whatever does not balance goes to Suspense (2900), which must be
   * nil before the year can close (the opening-difference account).
   */
  opening: function (e, cur) {
    var lines = givenLines_(e.lines, cur);
    var diff = sum_(lines, 'dr') - sum_(lines, 'cr');
    if (diff) lines.push(diff > 0 ? L_('suspense', 0, diff) : L_('suspense', -diff, 0));
    return lines;
  },
  /**
   * v1.16.0 (year-journey gap 2) — a cheque that CLEARED and was later returned by the bank: Dr the party (the bill is owed again) ·
   * Cr Bank for the amount, and a bank charge: Dr bank charges · Cr Bank. It must name the receipt it reverses (`reverses`: that
   * payment_received's ref) — the books-side partner of receivables.reverseItems(items, reverses, date), which reopens the bill.
   * A cheque that bounced BEFORE clearing never posted (C3), so it has nothing to reverse and no event.
   */
  cheque_dishonoured: function (e, cur) {
    if (!String(e.reverses || '').trim()) throw refuse_('A dishonoured cheque names the receipt it reverses (reverses: the payment_received ref).');
    var m = toMinor(e.amount, cur), ch = toMinor(e.charge, cur);
    if (!(m > 0)) throw refuse_('A dishonoured cheque needs the amount it was for.');
    if (ch < 0) throw refuse_('A bank charge is never negative.');
    var lines = [L_('debtors', m, 0, { party: e.party }), L_('bank', 0, m)];
    if (ch) lines.push(L_('bank_charges', ch, 0), L_('bank', 0, ch));
    return lines;
  },
  /**
   * v1.16.0 — a CONTRA (a Contra voucher): money moved between the shop's own cash and bank-type accounts (the pack's cash, bank and
   * settlement accounts): Dr where it went · Cr where it came from. No party, no tax; the same account on both sides is refused.
   */
  contra: function (e, cur, k) {
    var to = cashBank_(k, e.to, 'to'), from = cashBank_(k, e.from, 'from');
    if (to === from) throw refuse_('A contra moves money between two different accounts (both are ' + to + ').');
    var m = toMinor(e.amount, cur);
    return [L_(to, m, 0), L_(from, 0, m)];
  },
  /**
   * a manual journal entry (owner only, with a narration): the lines as handed in, which must balance exactly.
   * (L12) It may name ANY account in the chart, retained 3900 included — some systems block direct postings to the profit account;
   * here the owner-only door and the narration are the guard. Noted, not refused.
   */
  manual: function (e, cur) {
    owner_(e);
    if (!String(e.narration || '').trim()) throw refuse_('A manual entry needs a narration — what it is for.');
    return givenLines_(e.lines, cur);
  },
};
/* ── v1.14.0 helpers: the loan account, the asset class, the base of a purchase, the tax heads ── */
/** v1.16.0: a contra's two ends — a payment mode (the pack's: cash, bank …, cheque→bank) or a ledger of the shop's under Cash-in-Hand / Bank Accounts */
function cashBank_(k, x, side) {
  var key = x == null ? '' : String(x), acct = mode_(key, k), kinds = k.pack.chart.kinds;
  if (acct) return acct;
  var a = k && k.pack && k.P && key ? k.P.accountOf(k.pack, key) : null;
  if (a && a.kind === 'ledger' && (a.group === kinds.cash || a.group === kinds.bank)) return a.role || a.code;
  throw refuse_('A contra ' + side + ' is ' + Object.keys(k.pack.chart.paymentModes).filter(function (m) { return m !== 'cheque'; }).join(', ') + ' or a cash / bank ledger — "' + key.slice(0, 40) + '" is not.');
}
/** the heads of the pack that have a reverse-charge ledger, in the pack's order */
function rcmHeads_(p) { return p.taxHeads.filter(function (h) { return !!p.taxLedgers[h].rcm; }); }
/**
 * v1.20.0 — REVERSE CHARGE ON A PURCHASE. `rows` are the tax engine's `moneyOf(inv).rcm.rows` ({ rate, itc, <a figure per head> }): the tax is the
 * BUYER's, computed once when the bill was assessed and read here. Per head: Cr its reverse-charge ledger (the liability) and Dr its input ledger when the credit
 * is allowed — or Dr the same base account as the bill when it is not (the tax is then a cost). The supplier is credited WITHOUT it (the caller
 * nets it out of `owed`). Each row must say itc true or false — never guessed; a head the pack has no reverse-charge ledger for is refused by name.
 */
function rcmLines_(rows, cur, base, k) {
  var p = taxPack_(k), heads = rcmHeads_(p), out = { dr: [], cr: [] };
  if (rows == null || (Array.isArray(rows) && !rows.length)) return out;
  if (!Array.isArray(rows)) throw refuse_('rcm is a list of rows { rate, itc, ' + heads.join(', ') + ' } (tax.moneyOf(inv).rcm.rows).');
  rows.forEach(function (r, i) {
    if (!r || typeof r !== 'object') throw refuse_('rcm row ' + (i + 1) + ' is not a row.');
    if (r.itc !== true && r.itc !== false) throw refuse_('rcm row ' + (i + 1) + ' must say itc: true or false — whether the credit is allowed is never guessed.');
    p.taxHeads.forEach(function (h) { if (heads.indexOf(h) < 0 && toMinor(r[h], cur)) throw refuse_((p.messages.rcmNotBuilt || {})[h] || ('Reverse charge on ' + h + ' is not built in this pack.')); });
    var rate = r.rate != null ? String(r.rate) : undefined;
    heads.forEach(function (h) {
      var m = toMinor(r[h], cur); if (!m) return;
      out.dr.push(L_(r.itc ? p.taxLedgers[h].input : base, m, 0, { rate: rate }));
      out.cr.push(L_(p.taxLedgers[h].rcm, 0, m, { rate: rate }));
    });
  });
  return out;
}
function loanOf_(k, loan) {
  var a = k && k.pack && k.P ? k.P.accountOf(k.pack, loan) : null;
  if (!a || k.pack.chart.kinds.loans.indexOf(a.group) < 0) throw refuse_('A loan needs a loan account (Secured loans, Unsecured loans, Bank OD) — "' + String(loan == null ? '' : loan).slice(0, 40) + '"' + (a ? ' is ' + a.code + ' ' + a.name : ' is not in the chart') + '.');
  return a.role || a.code;
}
/** the pack's asset classes (pack.depreciation.assetClasses), as the names a message lists: buildings, plant … */
function classNames_(k) { return ((((k && k.pack) || {}).depreciation || {}).assetClasses || []).map(function (r) { return r.class; }).join(', '); }
function assetClass_(k, cls) {
  var list = ((((k && k.pack) || {}).depreciation || {}).assetClasses) || [], c = null;
  list.forEach(function (r) { if (c === null && r.class === cls) c = r; });
  if (!c) throw refuse_(cls == null || cls === '' ? 'An asset needs its asset_class (' + classNames_(k) + ').' : 'There is no asset class "' + String(cls).slice(0, 40) + '" in the pack.');
  return c;
}
/** where a purchase bill's base amount lands: resale → purchases (as ever) · asset → the class's cost ledger · use → an expense class */
function purchaseBase_(e, k) {
  var acc = e.accept == null || e.accept === '' ? 'resale' : e.accept;
  if (acc === 'resale') return 'purchases';
  if (acc === 'asset') {
    if (e.asset_class == null || e.asset_class === '') throw refuse_('A bill accepted as an asset needs its asset_class (' + classNames_(k) + ').');
    return assetClass_(k, e.asset_class).cost_role;
  }
  if (acc === 'use') {
    if (e.class == null || e.class === '') throw refuse_('A bill accepted for use needs its expense class.');
    classOf_(k, e.class, 'expense'); return e.class;
  }
  throw refuse_('Accept is resale, asset or use.');
}
function sum_(lines, side) { return (lines || []).reduce(function (s, l) { return s + (l[side] || 0); }, 0); }
function refuse_(why) { var e = new Error(why); e.refused = true; return e; }

/**
 * ⭐⭐⭐ post(event, ctx) → { ok, lines, totals, rule, why }
 *   event: { type, ref, date, currency, … the rule's fields }     ctx: { pack?, country? }
 * Refuses — never repairs — when: the type has no rule · a line names an account the pack does not have · a line is
 * negative or both-sided · the debits do not equal the credits TO THE MINOR UNIT · nothing would be posted ·
 * (v1.8.1) the date is not a real YYYY-MM-DD day · an amount or rate is not a finite plain number or is too large ·
 * a class that is not one · a party on a non-party line · a rate that turns a line into nothing.
 */
function post(event, ctx) {
  var e = event || {}, x = ctx || {};
  var P = P_(), R = R_(), pack = x.pack || (R ? R.resolve(x) : null);
  var rule = Object.prototype.hasOwnProperty.call(RULES, ruleOf_(pack, e.type)) ? RULES[ruleOf_(pack, e.type)] : null;
  if (!rule) return { ok: false, why: 'There is no posting rule for "' + e.type + '".', lines: [] };
  var cur = String(e.currency || '').toUpperCase();
  if (!/^[A-Z]{3}$/.test(cur)) return { ok: false, why: 'The event has no currency — an amount is labelled, never assumed.', lines: [] };
  /* H2: no date, a datetime, '2026-9-5', 30 Feb — the entry would post and then be in no balance, or in half of them */
  if (!P || !P.dayOf) return { ok: false, why: 'Posting needs the accounts-packs engine (it stamps the fiscal year and period).', lines: [] };
  if (P.dayOf(e.date) === null) return { ok: false, why: 'An entry needs its date as YYYY-MM-DD — a real calendar day, no time of day (got ' + (e.date == null ? 'none' : String(e.date).slice(0, 30)) + ').', lines: [] };
  if (pack && P && Array.isArray(x.accounts) && x.accounts.length) {           /* the shop's own ledgers (a clash refused) */
    try { pack = P.withAccounts(pack, x.accounts); } catch (err) { return { ok: false, why: err.message, lines: [] }; }
  }
  /* ⭐ the FUNCTIONAL currency the books are kept in; an event in another one needs its rate (never assumed) */
  var fn = String(x.functional || (pack && pack.currency) || cur).toUpperCase();
  var fx = 1;
  if (cur !== fn) {
    try { fx = e.fx_rate == null || e.fx_rate === '' ? NaN : num_(e.fx_rate, 'fx_rate'); } catch (err) { return { ok: false, why: err.message, lines: [] }; }
    if (!(fx > 0)) return { ok: false, why: 'An entry in ' + cur + ' needs its rate to ' + fn + ' (fx_rate) — a rate is evidence, never assumed.', lines: [] };
  }
  var raw;
  try { raw = rule(e, cur, { pack: pack, P: P }); } catch (err) { return { ok: false, why: err.message, lines: [] }; }
  var bad = [];
  raw.forEach(function (l) {
    var a = pack && P ? P.accountOf(pack, l.account) : null;
    if (a) l.account = a.role;                                         /* a code handed in ('1300') becomes its role */
    l.code = a ? a.code : null;
    if (l.dr < 0 || l.cr < 0 || (l.dr && l.cr) || (!l.dr && !l.cr)) bad.push('a line on ' + l.account + ' is not one positive debit or credit');
    if (pack && P && !a) bad.push('the account "' + l.account + '" is not in the chart');
    if ((l.account === 'debtors' || l.account === 'creditors') && !l.party) bad.push('a line on ' + l.account + ' names no party');
    /* M2: the mirror — a party lives ONLY on the two control accounts; on cash or capital it would grow a phantom sub-ledger */
    if (l.party && l.account !== 'debtors' && l.account !== 'creditors') bad.push('a line on ' + l.account + ' names a party (' + String(l.party).slice(0, 40) + ') — only a debtors or creditors line carries one');
  });
  if (!raw.length) bad.push('nothing to post');
  var dr = sum_(raw, 'dr'), cr = sum_(raw, 'cr');
  if (!Number.isSafeInteger(dr) || !Number.isSafeInteger(cr)) bad.push('the entry\'s total is beyond what this record holds exactly');
  if (dr !== cr) bad.push('the debits (' + fromMinor(dr, cur) + ') do not equal the credits (' + fromMinor(cr, cur) + ')');
  if (bad.length) return { ok: false, why: 'Not posted: ' + bad[0] + '.', problems: bad, lines: [] };
  /* into the functional currency, line by line; what rounding leaves is ONE round-off line, named, never spread */
  var scale = Math.pow(10, decimals_(fn) - decimals_(cur));
  var out = raw.map(function (l) {
    return { l: l, fdr: Math.round(l.dr * fx * scale), fcr: Math.round(l.cr * fx * scale) };
  });
  /* H4: the one-positive-side rule is checked AGAIN on the converted lines — a rate of 1e-9 zeroed every line, 1e300 made them Infinity */
  var cbad = [];
  out.forEach(function (o) {
    if (!Number.isSafeInteger(o.fdr) || !Number.isSafeInteger(o.fcr) || o.fdr >= MINOR_CEILING || o.fcr >= MINOR_CEILING)
      cbad.push('at the rate ' + fx + ' the line on ' + o.l.account + ' is beyond what this record holds exactly');
    else if ((o.l.dr && !o.fdr) || (o.l.cr && !o.fcr))
      cbad.push('at the rate ' + fx + ' the line on ' + o.l.account + ' (' + fromMinor(o.l.dr || o.l.cr, cur) + ' ' + cur + ') becomes nothing in ' + fn);
  });
  if (cbad.length) return { ok: false, why: 'Not posted: ' + cbad[0] + '.', problems: cbad, lines: [] };
  var fdr = out.reduce(function (s, o) { return s + o.fdr; }, 0), fcr = out.reduce(function (s, o) { return s + o.fcr; }, 0);
  if (fdr !== fcr) out.push({ l: { account: 'round_off', code: (P && pack && P.accountOf(pack, 'round_off') || {}).code || null, dr: 0, cr: 0, fx_line: true },
                              fdr: fdr < fcr ? fcr - fdr : 0, fcr: fdr > fcr ? fdr - fcr : 0 });
  var fy = P && pack ? P.fiscalYearOf(e.date, pack) : null;
  var opening = e.type === 'opening';
  var lines = out.map(function (o) {
    var l = o.l;
    var ln = { account: l.account, code: l.code || null, dr: fromMinor(o.fdr, fn), cr: fromMinor(o.fcr, fn),
               dr_minor: o.fdr, cr_minor: o.fcr, currency: fn,
               txn_currency: cur, amount_txn_minor: l.dr || l.cr || 0, fx_rate: fx,
               ref: e.ref || null, rule: RULES_VERSION };
    if (l.party) ln.party = l.party;
    if (l.rate !== undefined) ln.rate = l.rate;
    if (l.fx_line) ln.fx_rounding = true;
    return ln;
  });
  var tdr = lines.reduce(function (s, l) { return s + l.dr_minor; }, 0), tcr = lines.reduce(function (s, l) { return s + l.cr_minor; }, 0);
  return { ok: true, type: e.type, date: e.date || null, currency: fn, txn_currency: cur,
           fiscal_year: fy, period: opening ? 0 : (P && pack ? P.periodOf(e.date, pack) : null), is_opening: opening,
           voucher: voucherTypeOf(e, { pack: pack }), narration: e.narration || e.reason || null, lines: lines,
           totals: { dr: fromMinor(tdr, fn), cr: fromMinor(tcr, fn), dr_minor: tdr, cr_minor: tcr }, rule: RULES_VERSION };
}

/**
 * ⭐ daySummary(bills, head, { pack?, country? }) → a walkin_day event: the walk-in bills of one counter for one day (or shift), summed per
 * payment mode and per tax rate. `bills` are { currency, pay: { <mode>: amount … }, taxes: [{ rate, taxable, <each tax head of the pack> }],
 * round_off? } — named-party bills must not be here (granularity() sends them per bill), and are REFUSED. A head the pack calls optional is
 * in a rate's row only when it carries an amount; every other head is always there.
 */
function daySummary(bills, head, opt) {
  var h = head || {}, cur = null, modes = {}, rates = {}, rOff = 0, refused = [];
  var R = R_(), pk = (opt && opt.pack) || (R ? R.resolve(opt) : null), heads = taxPack_({ pack: pk }).taxHeads, optional = pk.optionalHeads || [];
  (bills || []).forEach(function (b, i) {
    if (b.party || b.credit || b.tax_id || b.gstin) { refused.push(i); return; }
    var c = String(b.currency || '').toUpperCase();
    if (!/^[A-Z]{3}$/.test(c)) throw refuse_('Walk-in bill ' + i + ' has no currency — an amount is labelled, never assumed.');   /* L3: the FIRST bill slipped in */
    if (cur && c !== cur) throw refuse_('Walk-in bills in two currencies (' + cur + ', ' + c + ') cannot share one entry.');
    cur = c;
    Object.keys(b.pay || {}).forEach(function (k) { modes[k] = (modes[k] || 0) + toMinor(b.pay[k], cur); });
    (b.taxes || []).forEach(function (t) {
      var k = String(t.rate); rates[k] = rates[k] || heads.reduce(function (z, f) { z[f] = 0; return z; }, { rate: t.rate, taxable: 0 });
      ['taxable'].concat(heads).forEach(function (f) { rates[k][f] += toMinor(t[f], cur); });
    });
    rOff += toMinor(b.round_off, cur);
  });
  if (refused.length) throw refuse_('Bills ' + refused.join(', ') + ' name a party — they are posted per bill, not in the day\'s summary.');
  var m = function (v) { return fromMinor(v, cur); };
  var mo = {}; Object.keys(modes).forEach(function (k) { mo[k] = m(modes[k]); });
  return { type: 'walkin_day', ref: h.ref || null, date: h.date || null, counter: h.counter || null, currency: cur,
           bills: (bills || []).length, modes: mo,
           by_rate: Object.keys(rates).map(function (k) { var r = rates[k]; var o = { rate: r.rate, taxable: m(r.taxable) }; heads.forEach(function (f) { if (optional.indexOf(f) < 0 || r[f]) o[f] = m(r[f]); }); return o; }),
           round_off: m(rOff) };
}

/**
 * ⭐ taxSetOff({ pack?, country?, ref?, date, period?, currency?, output: { <head>… }, input: { <head>… }, rcm? }) → { ok, utilised, payable,
 * carried, event } — v1.14.0 (R3), neutral since v1.24.0. The inputs are the BALANCES: the credit balance of each output head and the debit
 * balance of each input head, in major units. The ORDER of set-off is the pack's law (`pack.setOff`); what credit cannot cover is `payable` (by a
 * statutory payment: tax_payment); unused credit is `carried`. `event` is a tax_setoff event the rule recomputes identically. A head the pack
 * calls optional is in the answer only when a figure for it was handed in.
 */
function taxSetOff(o) {
  var x = o || {}, R = R_(), p = x.pack || (R ? R.resolve(x) : null), cur = String(x.currency || (p && p.currency) || '').toUpperCase();
  try {
    taxPack_({ pack: p });
    var so = taxSetOff_(p, x.output, x.input, cur), m = function (v) { return fromMinor(v, cur); }, heads = hasOptional_(p, x) ? p.payHeads : p.payHeads.filter(function (h) { return (p.optionalHeads || []).indexOf(h) < 0; }), h = function (r) { var q = {}; heads.forEach(function (k) { q[k] = m(r[k]); }); return q; };
    var side = function (r) { var q = {}; heads.forEach(function (k) { q[k] = m(toMinor((r || {})[k], cur)); }); return q; };
    var res = { ok: true, utilised: so.utilised.map(function (u) { return { from: u.from, against: u.against, amount: m(u.amount) }; }), payable: h(so.payable), carried: h(so.carried),
             event: { type: 'tax_setoff', ref: x.ref || null, date: x.date || null, period: x.period || null, currency: cur, output: side(x.output), input: side(x.input) } };
    if (x.rcm != null) {
      /* v1.20.0 — reverse-charge tax is NEVER set off: no credit is used against it, it joins the payment, in cash (the pack's rcm heads).
         The answer names it only when it was handed in, so every other call keeps its shape. */
      var rc = {}, cash = {}; rcmHeads_(p).forEach(function (k) { var v = toMinor((x.rcm || {})[k], cur); if (v < 0) throw refuse_('A reverse-charge balance is never negative here.'); rc[k] = m(v); cash[k] = m(so.payable[k] + v); });
      res.rcm = rc; res.cash = cash; res.event.rcm = rc;
    }
    return res;
  } catch (err) { if (err && err.refused) return { ok: false, why: err.message, utilised: [] }; throw err; }
}
/**
 * ⭐ gstSetOff(o) — the name this function has always had (the app and the API call it): taxSetOff with the India pack's own name for the event it
 * returns (`gst_setoff`). One calculation — it IS taxSetOff.
 */
function gstSetOff(o) {
  var r = taxSetOff(o), x = o || {}, R = R_(), p = x.pack || (R ? R.resolve(x) : null);
  if (r.event) r.event.type = aliasFor_(p, r.event.type);
  return r;
}
/** a figure for an OPTIONAL head was handed in on either side: the answer then names that head; with none, the answer keeps its other heads exactly as before */
function hasOptional_(p, x) {
  var opt = p.optionalHeads || [];
  return [x && x.output, x && x.input].some(function (r) { return r && opt.some(function (h) { return r[h] != null && r[h] !== ''; }); });
}
/** the arithmetic, in minor units — taxSetOff and the tax_setoff rule both call it, so there is one answer; the ORDER is the pack's (`pack.setOff`) */
function taxSetOff_(p, output, input, cur) {
  return p.setOff({ output: output, input: input }, function (v) { return toMinor(v, cur); });
}

/**
 * ⭐ depreciationFor({ entity, method?, fiscal_year, date, ref?, assets, pack? }) → { ok, basis, by_class, by_asset, event } — v1.14.0 (R2).
 *   assets: [{ id, class, cost?, put_to_use?, opening_wdv?, sold?: { proceeds } }] — an asset bought this year has cost and put_to_use;
 *   one brought forward has opening_wdv (and cost, for a straight-line entity).
 *   The LAW — which basis an entity follows, the rates and useful lives, the residual value, the half rate for a short year — is the pack's
 *   (`pack.depreciation`: assetClasses, entityBases, compute); this function keeps what is not law: the checks on what was handed in, the grouping by
 *   class, and the drift (any rounding or block adjustment sits on the class's first asset). The class `amount` is what posts. by_asset is each asset's own figure.
 *   Refuses an unknown entity (never a default rate), an entity that needs a method and has none, an asset without class / cost or opening_wdv, a
 *   put_to_use outside the year (and after `date`).
 */
function depreciationFor(o) {
  var x = o || {}, P = P_(), R = R_(), pack = x.pack || (R ? R.resolve(x) : null);
  try {
    if (!P || !pack) throw refuse_('Depreciation needs the accounts-packs engine.');
    var dep = pack.depreciation;
    if (!dep || typeof dep.compute !== 'function') throw refuse_('The regulation pack has no depreciation rules.');
    var bases = dep.entityBases || {}, base = Object.prototype.hasOwnProperty.call(bases, x.entity) ? bases[x.entity] : null;
    if (!base) throw refuse_('Depreciation needs the entity type the pack knows — ' + Object.keys(bases).join(', ') + ' — got "' + String(x.entity).slice(0, 40) + '"; never a default rate.');
    var rg = P.fyRange(x.fiscal_year, pack); if (!rg) throw refuse_('Depreciation needs the fiscal year (e.g. 2026-27).');
    if (P.dayOf(x.date) === null) throw refuse_('Depreciation needs its date as YYYY-MM-DD.');
    if (base.methods && base.methods.indexOf(x.method) < 0) throw refuse_('A ' + x.entity + '\'s depreciation needs its method — ' + base.methods.join(' or ') + '.');
    if (!Array.isArray(x.assets) || !x.assets.length) throw refuse_('Depreciation needs the assets.');
    var d0 = P.dayOf(rg.start), d1 = P.dayOf(rg.end), diy = d1 - d0 + 1, cur = pack.currency, m2 = function (v) { return fromMinor(v, cur); };
    var rows = x.assets.map(function (a, i) {
      var w = 'asset ' + (a && a.id != null ? a.id : i + 1), c = assetClass_({ pack: pack }, a && a.class);
      var cost = a.cost != null && a.cost !== '' ? toMinor(a.cost, cur) : null, wdv = a.opening_wdv != null && a.opening_wdv !== '' ? toMinor(a.opening_wdv, cur) : null;
      if (cost === null && wdv === null) throw refuse_(w + ' needs its cost or its opening_wdv.');
      var put = null, days = diy;
      if (a.put_to_use != null && a.put_to_use !== '') {
        put = P.dayOf(a.put_to_use);
        if (put === null) throw refuse_(w + ': put_to_use is not a YYYY-MM-DD day.');
        if (put > P.dayOf(x.date)) throw refuse_(w + ' is put to use after the depreciation date.');
        if (put > d1) throw refuse_(w + ' is put to use after the year ends.');
        if (put < d0 && wdv === null) throw refuse_(w + ' was put to use before the year — give its opening_wdv.');
        if (put >= d0) days = d1 - put + 1;
      } else if (wdv === null) throw refuse_(w + ' needs its put_to_use.');
      var added = wdv === null;                               /* bought this year: cost counts, pro rata or at a part rate (the pack says) */
      return { id: a.id != null ? a.id : i + 1, c: c, cost: cost, wdv: wdv, days: days, added: added, proceeds: a.sold ? toMinor(a.sold.proceeds, cur) : 0 };
    });
    var order = [], byC = {};
    rows.forEach(function (r) { if (!byC[r.c.class]) { byC[r.c.class] = []; order.push(r.c.class); } byC[r.c.class].push(r); });
    var clsOut = [], assetOut = [];
    order.forEach(function (name) {
      var rs = byC[name], res = dep.compute(rs, base, { method: x.method, diy: diy }), total = res.total, rate = res.rate, per = res.per;
      var drift = total - per.reduce(function (s, v) { return s + v; }, 0);
      per[0] += drift;
      rs.forEach(function (r, i) { assetOut.push({ id: r.id, class: name, amount: m2(per[i]) }); });
      clsOut.push({ class: name, rate: rate, amount: m2(total), minor: total });
    });
    var posting = clsOut.filter(function (c) { return c.minor > 0; }).map(function (c) { return { class: c.class, amount: c.amount }; });
    return { ok: true, basis: base.basis, by_class: clsOut.map(function (c) { return { class: c.class, rate: c.rate, amount: c.amount }; }), by_asset: assetOut,
             event: posting.length ? { type: 'depreciation', ref: x.ref || null, date: x.date, currency: cur, basis: base.basis, by_class: posting } : null };
  } catch (err) { if (err && err.refused) return { ok: false, why: err.message }; throw err; }
}

/**
 * ⭐ VOUCHER_TYPE_OF — event type → voucher type (v1.16.0; Athi, 2026-10-02: "Follow the standard"). Each choice, and why:
 *   Sales          sale_bill, walkin_day, the day's takings                                  — a sale is a Sales voucher
 *   Purchase       purchase_bill                                                              — a Purchase voucher
 *   Receipt        payment_received · other_income · loan_taken                               — money IN: interest/commission received and a loan received go through Receipt
 *   Payment        payment_made · credit_given · loan_repaid · tax_payment · cheque_dishonoured
 *                  — money OUT of cash/bank: a supplier paid, credit handed over, an EMI from the bank, and the statutory tax payment
 *                  (a Payment voucher); a bounced cleared cheque takes the money back OUT of the bank to the party
 *   Expense        expense → Payment when paid at once; Purchase when a supplier's bill is booked on credit (the supplier field)
 *   Contra         contra                                                                     — between cash and bank-type accounts, no party
 *   Credit note    credit_note · return                                                       — a sales return
 *   Debit note     purchase_return                                                            — goods back to a supplier
 *   Journal        closing_stock · accrual · depreciation · tax_setoff · write_off · asset_disposal · opening · manual
 *                  — no cash or bank moves: an adjustment between ledgers (set-off is credit against credit; a disposal is a many-legged
 *                  entry with a profit or loss; the opening is a Journal)
 * ⚠️ A PERSON'S OWN entry (type 'manual', source 'manual', or { manual: true }) takes the single series MJ whatever its type, and keeps
 * its voucher type beside it: voucher_type on the event (Payment · Receipt · Contra · Journal …), else the type this table gives it.
 */
const KIND_OF = {
  walkin_day: 'Sales', sale_bill: 'Sales', purchase_bill: 'Purchase',
  payment_received: 'Receipt', other_income: 'Receipt', loan_taken: 'Receipt',
  payment_made: 'Payment', credit_given: 'Payment', loan_repaid: 'Payment', tax_payment: 'Payment', cheque_dishonoured: 'Payment', expense: 'Payment',
  contra: 'Contra', credit_note: 'Credit note', return: 'Credit note', purchase_return: 'Debit note',
  closing_stock: 'Journal', accrual: 'Journal', depreciation: 'Journal', tax_setoff: 'Journal', write_off: 'Journal', asset_disposal: 'Journal', opening: 'Journal', manual: 'Journal',
};
/* the names the default pack's accountants still use for a neutral event type (eventAliases): in the exported table beside the neutral ones, so every caller written before still finds its type */
const ALIASES_ = (function () { return defaultPack_().eventAliases || {}; })();
const VOUCHER_TYPE_OF = Object.keys(KIND_OF).reduce(function (t, k) { t[k] = KIND_OF[k]; return t; }, {});
Object.keys(ALIASES_).forEach(function (a) { if (Object.prototype.hasOwnProperty.call(KIND_OF, ALIASES_[a])) VOUCHER_TYPE_OF[a] = KIND_OF[ALIASES_[a]]; });
/**
 * ⭐ voucherTypeOf(event, { manual? }) → { type: 'Sales', series: 'SV', manual: false } — the voucher type and number series of an event, or
 * null for a type with no rule. A manual entry is { type: <its kind>, series: 'MJ', manual: true }.
 */
function voucherTypeOf(event, opts) {
  var e = event || {}, o = opts || {}, R = R_(), pk = R ? R.resolve(o) : null, S = pk && pk.voucherSeries, kind = ruleOf_(pk, e.type);
  if (!S || !Object.prototype.hasOwnProperty.call(KIND_OF, kind)) return null;
  var manual = o.manual === true || e.source === 'manual' || e.type === 'manual';
  var type = KIND_OF[kind];
  if (e.type === 'expense' && e.supplier) type = 'Purchase';
  if (manual && e.voucher_type != null && Object.prototype.hasOwnProperty.call(S, e.voucher_type)) type = e.voucher_type;
  return { type: type, series: manual ? pk.manualSeries : S[type], manual: manual };
}

/** ⭐ balanced(lines, currency) → true when the debits equal the credits to the minor unit — the nightly check's question */
function balanced(lines, currency, opt) {
  var R = R_(), pk = (opt && opt.pack) || (R ? R.resolve(opt) : null);
  var cur = String(currency || (pk && pk.currency) || '').toUpperCase(), d = 0, c = 0;
  (lines || []).forEach(function (l) { d += toMinor(l.dr, cur); c += toMinor(l.cr, cur); });
  return d === c;
}

const EXPORTS = { RULES_VERSION, MODE_ACCOUNT, TYPES: Object.keys(RULES).concat(Object.keys(ALIASES_)), VOUCHER_TYPE_OF, granularity, post, daySummary, taxSetOff, gstSetOff, depreciationFor, balanced, voucherTypeOf };

/* ⭐ ONE FILE, EVERY HOST: node takes module.exports; a page, the TV and the shop PC take window.CBPosting. */
if (typeof module !== 'undefined' && module.exports) module.exports = EXPORTS;
if (root && typeof root.window !== 'undefined') root.window.CBPosting = EXPORTS;
})(typeof globalThis !== 'undefined' ? globalThis : this);
