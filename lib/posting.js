/* ADOPTED from chitbridge-engines v1.8.1 · posting · sha256 dbb4cb09c1b80e2b958b9ce0223bae66e61d0d0431d32a27a558ebe1a0df79c1 — DO NOT EDIT HERE. Change it in chitbridge-engines, release a version, then run tools/adopt.cjs. */
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
 * rate) at day close; any sale to a NAMED party — credit, a customer on the list, B2B with a GSTIN — is posted PER BILL,
 * because that party's account needs each bill. granularity() decides; the shop's setting only moves walk-in trade.
 *
 * ── A LINE ──  { account, dr, cr, party?, rate?, ref, rule }  — one of dr / cr is 0; amounts in the event's currency.
 * ── v1.8.0 ── a line also carries { code (4-digit), dr_minor, cr_minor, currency (FUNCTIONAL), txn_currency,
 *   amount_txn_minor, fx_rate }; the entry carries { fiscal_year, period (0 = opening), is_opening, rule }. New rules:
 *   purchase_bill, purchase_return, payment_made (cheque only when cleared), opening (difference → Suspense 2900),
 *   manual (owner, narration, must balance), credit_note (= return). write_off now needs the owner too.
 *   ⚠️ An event in a currency other than the functional one (ctx.functional, else the pack's) needs fx_rate — refused
 *   without it; conversion rounding is ONE named round-off line (fx_rounding: true), never spread over the others.
 * ⚠️⚠️ EXACT TO THE MINOR UNIT: every rule builds its lines in integers (paise) and post() REFUSES anything whose debits do
 * not equal its credits — a journal that is off by a paisa is refused, never rounded into balance.
 * ⭐ Every line carries `rule` = RULES_VERSION, so a line posted today can be re-derived by the same rules tomorrow.
 * ── v1.8.1 (the critic's review, 2026-09-29) — WHAT IS NOW REFUSED, each with its reason, ok: false ──
 *   H2  a date that is not a real calendar day written YYYY-MM-DD (none, a datetime, '2026-9-5', 30 Feb, month 13)
 *   H4  an amount or fx_rate that is not a finite number or a plain decimal string (Infinity, '0x10', true, [5], '1e3');
 *       an amount at or beyond 10^15 minor units (L1: past that a float drops paise); a rate that turns a line into 0
 *   M1  an expense / other-income `class` that is not an expense / income account (it would flip the entry's sides)
 *   M2  a party on a line that is not debtors / creditors (the mirror of "required there")
 *   L3  a walk-in bill with no currency. The lines a valid event produces are UNCHANGED, so RULES_VERSION stays.
 * ⚠️ OPEN, FOR ATHI (critic L2): `credit_given from: 'cheque'` and `expense paid_from: 'cheque'` post to the bank at
 *   ISSUE — C3 (clearing) is enforced only on payment_received / payment_made. Tally posts an issued cheque at issue; the
 *   house rule says clearing. Not changed here: it is a decision, not a guard.
 */
const RULES_VERSION = 'posting-1.1';   /* v1.8.0: purchases, payments made, opening, manual, fiscal stamps, minor units */

var MONEY_ = null, PACKS_ = null;
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
function decimals_(cur) { var M = M_(); return M && M.decimals ? M.decimals(cur) : 2; }
/**
 * ⚠️ v1.8.1 (critic H4, L1) — WHAT COUNTS AS AN AMOUNT: a finite number, or a plain decimal string. The reading is
 * money.priceOf's (the one reader every engine shares — no second parser here); on top of it a bare object/array and an
 * exponent string are refused, because a stored amount is never written that way. Absent (null / undefined / '') = 0.
 * ⚠️ THE CEILING: 10^15 minor units. toPrecision(15) keeps 15 significant digits, so beyond it paise are silently lost
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

/** how a payment mode lands: the REAL account money comes into. A cheque posts only on clearing, into the bank (C3). */
const MODE_ACCOUNT = { cash: 'cash', bank: 'bank', upi: 'upi', card: 'card', cheque: 'bank' };
/** own keys only: a stored mode of "constructor" or "__proto__" is an unknown mode, never an inherited function */
function mode_(k) { return Object.prototype.hasOwnProperty.call(MODE_ACCOUNT, k) ? MODE_ACCOUNT[k] : undefined; }

/**
 * ⭐ granularity(ctx) → 'bill' | 'day' | 'shift' — how a SALE is posted.
 *   ctx: { setting: 'day' (default) | 'bill' | 'shift', party?, credit?, gstin? }
 * A named party, a credit sale or a buyer with a GSTIN is ALWAYS per bill: their own account needs each bill.
 */
function granularity(ctx) {
  var c = ctx || {};
  if (c.party || c.credit || c.gstin) return 'bill';
  return c.setting === 'bill' || c.setting === 'shift' ? c.setting : 'day';
}

/* ── the lines a rule builds, in minor units, then checked and turned into amounts ── */
function L_(account, dr, cr, extra) { return Object.assign({ account: account, dr: dr, cr: cr }, extra || {}); }
function taxLines_(rows, cur, side, prefix) {
  var out = [];
  (rows || []).forEach(function (r) {
    var rate = r.rate != null ? String(r.rate) : undefined;
    var add = function (acct, amt) { var m = toMinor(amt, cur); if (m) out.push(side === 'cr' ? L_(acct, 0, m, { rate: rate }) : L_(acct, m, 0, { rate: rate })); };
    add(prefix.base, r.taxable);
    add(prefix.tax + '_cgst', r.cgst); add(prefix.tax + '_sgst', r.sgst); add(prefix.tax + '_igst', r.igst);
  });
  return out;
}
function modeLines_(modes, cur, side) {
  var out = [];
  Object.keys(modes || {}).forEach(function (k) {
    var acct = mode_(k); var m = toMinor(modes[k], cur);
    if (!m) return;
    out.push(side === 'dr' ? L_(acct || ('?' + k), m, 0) : L_(acct || ('?' + k), 0, m));
  });
  return out;
}
/**
 * round_off = what was CHARGED minus what the lines add up to. Rounded UP (₹9.99 billed as ₹10) the shop collected the
 * extra paisa: Cr round off. Rounded DOWN it gave a paisa away: Dr round off. (The walk-in test caught this sign wrong.)
 */
function roundOff_(v, cur) { var m = toMinor(v, cur); if (!m) return []; return m > 0 ? [L_('round_off', 0, m)] : [L_('round_off', -m, 0)]; }
/** a purchase rounded UP means the shop PAID the extra paisa: Dr round off (the mirror of a sale) */
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
  walkin_day: function (e, cur) {
    return modeLines_(e.modes, cur, 'dr').concat(taxLines_(e.by_rate, cur, 'cr', { base: 'sales', tax: 'output' }), roundOff_(e.round_off, cur));
  },
  /**
   * a sale to a named party, per bill: Dr the party for what is unpaid · Dr any mode paid at the till · Cr sales · Cr tax.
   * (L11) An OVER-paid bill lands Cr debtors — the party is in credit on its own account, as Tally shows it. The chart's
   * customer_advance 2400 / supplier_advance 1700 are not used by any rule; an advance is a payment_received sitting on account.
   */
  sale_bill: function (e, cur) {
    var credit = taxLines_(e.by_rate, cur, 'cr', { base: 'sales', tax: 'output' });
    var paid = modeLines_(e.paid, cur, 'dr'), rOff = roundOff_(e.round_off, cur);
    var owed = sum_(credit, 'cr') - sum_(paid, 'dr') - sum_(rOff, 'dr') + sum_(rOff, 'cr');
    var lines = paid.concat(credit, rOff);
    if (owed) lines.unshift(owed > 0 ? L_('debtors', owed, 0, { party: e.party }) : L_('debtors', 0, -owed, { party: e.party }));
    return lines;
  },
  /** a payment received: Dr where the money came in · Cr the party. A cheque only once CLEARED (C3). */
  payment_received: function (e, cur) {
    if (e.mode === 'cheque' && e.cheque_status !== 'cleared') throw refuse_('A cheque is posted when it CLEARS, not when it is received (it is ' + (e.cheque_status || 'received') + ').');
    var acct = mode_(e.mode); if (!acct) throw refuse_('Unknown payment mode "' + e.mode + '".');
    var m = toMinor(e.amount, cur);
    return [L_(acct, m, 0), L_('debtors', 0, m, { party: e.party })];
  },
  /** credit given with no sale (D2): Dr the party · Cr the cash or bank it left from. No GST — nothing was sold. */
  credit_given: function (e, cur) {
    var acct = mode_(e.from || 'cash'); if (!acct) throw refuse_('Unknown source "' + e.from + '".');
    var m = toMinor(e.amount, cur);
    return [L_('debtors', m, 0, { party: e.party }), L_(acct, 0, m)];
  },
  /** an expense by class: Dr the class (+ input tax) · Cr what paid it — a mode, or the supplier when on credit */
  expense: function (e, cur, k) {
    classOf_(k, e.class, 'expense');
    var dr = [L_(e.class, toMinor(e.amount, cur), 0)].concat(taxLines_(e.input_tax ? [Object.assign({ taxable: 0 }, e.input_tax)] : [], cur, 'dr', { base: e.class, tax: 'input' }).filter(function (l) { return l.account !== e.class; }));
    var total = sum_(dr, 'dr');
    var cr = e.supplier ? [L_('creditors', 0, total, { party: e.supplier })] : [L_(mode_(e.paid_from || 'cash') || ('?' + e.paid_from), 0, total)];
    return dr.concat(cr);
  },
  /** other income by class: Dr where it came in · Cr the class */
  other_income: function (e, cur, k) {
    classOf_(k, e.class, 'income');
    var m = toMinor(e.amount, cur);
    return [L_(mode_(e.into || 'cash') || ('?' + e.into), m, 0), L_(e.class, 0, m)];
  },
  /**
   * a return / credit note: Dr sales returns per rate · Dr output tax back · Cr the party, or Cr the mode refunded.
   * (L13) ONE or the other: a return partly refunded in cash and partly credited has no rule yet and is refused as
   * unbalanced — post it as two events (a return credited + a payment made back), or as a manual entry.
   */
  return: function (e, cur) {
    var dr = taxLines_(e.by_rate, cur, 'dr', { base: 'sales_returns', tax: 'output' });
    var total = sum_(dr, 'dr');
    var cr = e.party && !e.refund ? [L_('debtors', 0, total, { party: e.party })] : modeLines_(e.refund, cur, 'cr');
    return dr.concat(cr);
  },
  /** a write-off (owner only, with a reason): Dr bad debts · Cr the party */
  write_off: function (e, cur) {
    owner_(e);
    if (!String(e.reason || '').trim()) throw refuse_('A write-off needs a reason.');
    var m = toMinor(e.amount, cur);
    return [L_('bad_debts', m, 0), L_('debtors', 0, m, { party: e.party })];
  },
  /** a credit note is a return by another name (the document a GST return lists) */
  credit_note: function (e, cur) { return RULES.return(e, cur); },
  /** a purchase, per bill: Dr purchases per rate · Dr input tax · Cr any mode paid · Cr the supplier for the rest */
  purchase_bill: function (e, cur) {
    var dr = taxLines_(e.by_rate, cur, 'dr', { base: 'purchases', tax: 'input' }), rOff = roundOffPaid_(e.round_off, cur);
    var paid = modeLines_(e.paid, cur, 'cr');
    var owed = sum_(dr, 'dr') + sum_(rOff, 'dr') - sum_(rOff, 'cr') - sum_(paid, 'cr');
    var lines = dr.concat(rOff, paid);
    if (owed) lines.push(owed > 0 ? L_('creditors', 0, owed, { party: e.party }) : L_('creditors', -owed, 0, { party: e.party }));
    return lines;
  },
  /** goods sent back to a supplier: Dr the supplier (or the mode refunded) · Cr purchase returns per rate · Cr input tax back */
  purchase_return: function (e, cur) {
    var cr = taxLines_(e.by_rate, cur, 'cr', { base: 'purchase_returns', tax: 'input' });
    var total = sum_(cr, 'cr');
    var dr = e.party && !e.refund ? [L_('creditors', total, 0, { party: e.party })] : modeLines_(e.refund, cur, 'dr');
    return dr.concat(cr);
  },
  /** a payment made to a supplier: Dr the supplier · Cr where it left from. A cheque only once CLEARED (C3). */
  payment_made: function (e, cur) {
    if (e.mode === 'cheque' && e.cheque_status !== 'cleared') throw refuse_('A cheque is posted when it CLEARS, not when it is issued (it is ' + (e.cheque_status || 'issued') + ').');
    var acct = mode_(e.mode); if (!acct) throw refuse_('Unknown payment mode "' + e.mode + '".');
    var m = toMinor(e.amount, cur);
    return [L_('creditors', m, 0, { party: e.party }), L_(acct, 0, m)];
  },
  /**
   * opening balances (period 0): the lines as handed in; whatever does not balance goes to Suspense (2900), which must be
   * nil before the year can close (Tally's "Difference in opening balances", ERPNext's opening entry).
   */
  opening: function (e, cur) {
    var lines = givenLines_(e.lines, cur);
    var diff = sum_(lines, 'dr') - sum_(lines, 'cr');
    if (diff) lines.push(diff > 0 ? L_('suspense', 0, diff) : L_('suspense', -diff, 0));
    return lines;
  },
  /**
   * a manual journal entry (owner only, with a narration): the lines as handed in, which must balance exactly.
   * (L12) It may name ANY account in the chart, retained 3900 included — Tally blocks direct postings to its P&L A/c;
   * here the owner-only door and the narration are the guard. Noted, not refused.
   */
  manual: function (e, cur) {
    owner_(e);
    if (!String(e.narration || '').trim()) throw refuse_('A manual entry needs a narration — what it is for.');
    return givenLines_(e.lines, cur);
  },
};
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
  var rule = Object.prototype.hasOwnProperty.call(RULES, e.type) ? RULES[e.type] : null;
  if (!rule) return { ok: false, why: 'There is no posting rule for "' + e.type + '".', lines: [] };
  var cur = String(e.currency || '').toUpperCase();
  if (!/^[A-Z]{3}$/.test(cur)) return { ok: false, why: 'The event has no currency — an amount is labelled, never assumed.', lines: [] };
  var P = P_(), pack = x.pack || (P ? P.packFor(x.country || 'IN') : null);
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
           narration: e.narration || e.reason || null, lines: lines,
           totals: { dr: fromMinor(tdr, fn), cr: fromMinor(tcr, fn), dr_minor: tdr, cr_minor: tcr }, rule: RULES_VERSION };
}

/**
 * ⭐ daySummary(bills, head) → a walkin_day event: the walk-in bills of one counter for one day (or shift), summed per
 * payment mode and per tax rate. `bills` are { currency, pay: { cash, upi, card, … }, taxes: [{ rate, taxable, cgst, sgst,
 * igst }], round_off? } — named-party bills must not be here (granularity() sends them per bill), and are REFUSED.
 */
function daySummary(bills, head) {
  var h = head || {}, cur = null, modes = {}, rates = {}, rOff = 0, refused = [];
  (bills || []).forEach(function (b, i) {
    if (b.party || b.credit || b.gstin) { refused.push(i); return; }
    var c = String(b.currency || '').toUpperCase();
    if (!/^[A-Z]{3}$/.test(c)) throw refuse_('Walk-in bill ' + i + ' has no currency — an amount is labelled, never assumed.');   /* L3: the FIRST bill slipped in */
    if (cur && c !== cur) throw refuse_('Walk-in bills in two currencies (' + cur + ', ' + c + ') cannot share one entry.');
    cur = c;
    Object.keys(b.pay || {}).forEach(function (k) { modes[k] = (modes[k] || 0) + toMinor(b.pay[k], cur); });
    (b.taxes || []).forEach(function (t) {
      var k = String(t.rate); rates[k] = rates[k] || { rate: t.rate, taxable: 0, cgst: 0, sgst: 0, igst: 0 };
      ['taxable', 'cgst', 'sgst', 'igst'].forEach(function (f) { rates[k][f] += toMinor(t[f], cur); });
    });
    rOff += toMinor(b.round_off, cur);
  });
  if (refused.length) throw refuse_('Bills ' + refused.join(', ') + ' name a party — they are posted per bill, not in the day\'s summary.');
  var m = function (v) { return fromMinor(v, cur); };
  var mo = {}; Object.keys(modes).forEach(function (k) { mo[k] = m(modes[k]); });
  return { type: 'walkin_day', ref: h.ref || null, date: h.date || null, counter: h.counter || null, currency: cur,
           bills: (bills || []).length, modes: mo,
           by_rate: Object.keys(rates).map(function (k) { var r = rates[k]; return { rate: r.rate, taxable: m(r.taxable), cgst: m(r.cgst), sgst: m(r.sgst), igst: m(r.igst) }; }),
           round_off: m(rOff) };
}

/** ⭐ balanced(lines, currency) → true when the debits equal the credits to the minor unit — the nightly check's question */
function balanced(lines, currency) {
  var cur = String(currency || 'INR').toUpperCase(), d = 0, c = 0;
  (lines || []).forEach(function (l) { d += toMinor(l.dr, cur); c += toMinor(l.cr, cur); });
  return d === c;
}

const EXPORTS = { RULES_VERSION, MODE_ACCOUNT, TYPES: Object.keys(RULES), granularity, post, daySummary, balanced };

/* ⭐ ONE FILE, EVERY HOST: node takes module.exports; a page, the TV and the shop PC take window.CBPosting. */
if (typeof module !== 'undefined' && module.exports) module.exports = EXPORTS;
if (root && typeof root.window !== 'undefined') root.window.CBPosting = EXPORTS;
})(typeof globalThis !== 'undefined' ? globalThis : this);
