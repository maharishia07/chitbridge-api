/* ADOPTED from chitbridge-engines v1.31.0 · receivables · sha256 54d8cab011fee559f22a7e8392a29ca7ed9b561a2038e06c725ae68bdaaade82 — DO NOT EDIT HERE. Change it in chitbridge-engines, release a version, then run tools/adopt.cjs. */
/* chitbridge-engines · receivables. Edited ONLY in chitbridge-engines/src/receivables.js; every platform adopts a released version of it. */
(function (root) {
'use strict';
// @stage tested
// @stage-note [CREDIT P1] What a party owes and what reduced it: due dates, the oldest-due-first PROPOSAL, the check of
// @stage-note what the supplier confirmed, bounce reversal, balances, ageing, statements, metrics, and the C6 options.
// @stage-note No storage, no clock: every date is an argument. tests/receivables.test.js runs every branch.
/**
 * receivables.js — WHAT A PARTY OWES, AND WHAT CLEARED IT (v1.7.0, 2026-09-28; party items v1.8.0; hardened v1.8.1 2026-09-30). [SPEC-credit-lifecycle.md §4, §11]
 *
 * Athi: *"the payment won't exactly tie to the bills — they pay through cheque or cash or any other mode … the details
 * have to be matched against the bill, and the remaining should carry on to the next one."* Decided the same day (§11):
 *   D1  the rule (oldest DUE first) only PROPOSES — the supplier confirms or changes it; "if they change it, it is their wish".
 *   C4  each party records its own facts; "if there are dispute the payment cannot be adjust against" — REFUSED here, not warned.
 *   C3  a cheque counts on CLEARING, never on receipt.
 *   D2  a debit need not be a sale: sale · credit_given · opening_balance · debit_note — this engine does not care which.
 *
 * ── THE SHAPES ─────────────────────────────────────────────────────────────────────────────────────────────────
 *   debit       { id, kind, party, date:'YYYY-MM-DD', amount, currency, credit_days?, due?, disputed? }
 *   credit      { id, kind: payment|return|credit_note|write_off, party, date, amount, currency, mode?,
 *                 cheque?: { no, bank, date, status: received|deposited|cleared|bounced, cleared_on? }, disputed?, void? }
 *   allocation  { id?, credit, debit, amount, on?:'YYYY-MM-DD', reverses? }   — APPEND-ONLY: a correction is a reversal
 *               row ({ reverses: <allocation id>, amount }), never an edit. A reversed allocation is not live.
 *
 * ⚠️⚠️ EXACT TO THE MINOR UNIT: every sum is done in the currency's MINOR UNITS (integers) — decimals from money.decimals —
 * and only turned back into an amount at the edge. Currencies are never mixed: a mixed set is refused, never converted.
 * ⚠️ NO CLOCK. "Today" is always `asOf`, passed in. A receivable aged by the machine's clock would age differently on
 * the counter, the server and a statement printed tomorrow.
 *
 * ── v1.8.0 (2026-09-29): PARTY ITEMS — ROWS, NEVER UPDATES ── [SPEC-books-v2.md §0, §3; ERPNext Payment Ledger Entry]
 *   party_item  { party, side: receivable|payable, ref_kind: bill|advance|on_account|allocation|reversal|status,
 *                 ref, against_ref, amount_minor (SIGNED integer), currency, date, due_date? (bills), status?, reverses?,
 *                 kind? (the source kind: sale, credit_given, payment, return …) }
 *   ⭐ outstanding of a document = Σ amount_minor of the rows whose against_ref is that document. A bill is +amount
 *   against itself; a payment is −amount against ITSELF (an advance sitting on account); an allocation moves it: −a
 *   against the bill, +a against the payment. A bounce is a REVERSAL row per row of that payment. A dispute or a cheque
 *   step is a STATUS row (amount 0) — the latest one wins, and a disputed document is frozen (C4).
 *   The v1.7.0 shapes stay: fromItems(items) turns rows back into { debits, credits, allocations } so propose() and
 *   check() run unchanged — propose → the owner confirms → confirmItems() emits the rows (D1).
 *
 * ── v1.8.1 (the critic's review, 2026-09-29): A STORED ROW IS DISTRUSTED ──
 *   H3   reverseItems() needs `item_id` (the row's own id, which the database assigns) on every money row it reverses —
 *        refused by name without it. Identity is NEVER the row's position in an array: the same rows fetched in another
 *        order, or per document, reversed the same money again.
 *   M5   outstanding() — and so fromItems / proposeItems / confirmItems — refuses, naming the row: an allocation whose
 *        halves do not pair off (Σ of a payment's allocation rows ≠ 0), a half with the wrong sign, a half stamped with a
 *        party other than its documents'. ⚠️ So outstanding() takes a party's WHOLE item set, never one document's rows.
 *   M6   a dispute on an uncleared cheque is its own status row and survives clearing (dispute rows and cheque-step rows
 *        are read apart: by_ref[].disputed, by_ref[].status).
 *   M10  itemsOfBill / itemsOfPayment read `amount` the way posting does: finite, a plain number, under 10^15 minor units.
 *   L4   every map keyed by a stored id has no prototype; a cheque step is looked up by OWN key.
 */

/* money, found wherever this copy runs — CBMoney on a page, ./money in node (looked up per call: load order is free) */
var MONEY_ = null, REG_ = null;
function R_() {
  var R = (typeof CBRegulation !== 'undefined' && CBRegulation.resolve) ? CBRegulation : REG_;
  if (R === null && typeof require === 'function') { try { R = REG_ = require('./regulation'); } catch (_) { R = REG_ = false; } }
  return R || null;
}
/** the pack a call means: opt.pack, else the registry's for opt.country (a currency a document does not name is the pack's — pack.currency) */
function pack_(opt) { var R = R_(); if (!R) throw new Error('Receivables needs the regulation engine to name a currency a document leaves out.'); return (opt && opt.pack) || R.resolve(opt); }
function dflt_(opt) { return pack_(opt).currency; }
function M_() {
  var M = (typeof CBMoney !== 'undefined' && CBMoney.round) ? CBMoney : MONEY_;
  if (M === null && typeof require === 'function') { try { M = MONEY_ = require('./money'); } catch (_) { M = MONEY_ = false; } }
  return M || null;
}
function decimals_(cur) { var M = M_(); return M && M.decimals ? M.decimals(cur) : 2; }
function toMinor(amount, cur) { var f = Math.pow(10, decimals_(cur)); return Math.round(Number((Number(amount) * f).toPrecision(15))); }
function fromMinor(minor, cur) { var f = Math.pow(10, decimals_(cur)); return Number((minor / f).toFixed(decimals_(cur))); }

const DEBIT_KINDS = ['sale', 'credit_given', 'opening_balance', 'debit_note'];
const CREDIT_KINDS = ['payment', 'return', 'credit_note', 'write_off'];
const CHEQUE_NEXT = { received: ['deposited'], deposited: ['cleared', 'bounced'], cleared: [], bounced: [] };
/** own keys only: a stored status of "constructor" is not a cheque step (it was an inherited function — a TypeError) */
function next_(s) { return Object.prototype.hasOwnProperty.call(CHEQUE_NEXT, s) ? CHEQUE_NEXT[s] : null; }

/* ── dates: 'YYYY-MM-DD' ↔ a day number (no clock, no time zone) ── */
function day(s) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
  if (!m) return null;
  return Math.round(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000);
}
function ymd(n) { return new Date(n * 86400000).toISOString().slice(0, 10); }

/** refuse unless every row is in ONE currency — the currency, or throws a 409 naming them */
function oneCurrency(rows, where) {
  var set = {};
  (rows || []).forEach(function (r) { if (r && r.currency) set[String(r.currency).toUpperCase()] = 1; });
  var cs = Object.keys(set);
  if (cs.length > 1) {
    var e = new Error('Cannot mix currencies in ' + (where || 'one account') + ': ' + cs.join(' + ') + '. An amount is labelled, never converted — keep one account per currency.');
    e.status = 409; e.currencies = cs; throw e;
  }
  return cs[0] || null;
}

/** ⭐ dueDate(debit, terms) → 'YYYY-MM-DD': its own due date, else its date + its credit days, else + the terms' days */
function dueDate(debit, terms) {
  var d = debit || {};
  if (d.due && day(d.due) !== null) return d.due;
  var base = day(d.date); if (base === null) return null;
  var days = d.credit_days != null ? Number(d.credit_days) : (terms && terms.credit_days != null ? Number(terms.credit_days) : 0);
  return ymd(base + Math.max(0, Math.floor(days || 0)));
}

/** the allocations that still count: not a reversal row, and not reversed by one */
function live(allocations) {
  var gone = Object.create(null);
  (allocations || []).forEach(function (a) { if (a && a.reverses != null) gone[a.reverses] = 1; });
  return (allocations || []).filter(function (a) { return a && a.reverses == null && !(a.id != null && gone[a.id]); });
}

/**
 * ⭐ usable(credit) → { ok, why }: may this credit reduce what is owed? A disputed or voided credit may not (C4); a
 * cheque only once CLEARED (C3). "Received, not cleared" is said in words, because it is the question a collector asks.
 */
function usable(credit) {
  var c = credit || {};
  if (c.void) return { ok: false, why: 'This entry was voided.' };
  if (c.disputed) return { ok: false, why: 'This payment is in dispute — it cannot be applied to any bill until the dispute is settled.' };
  if (c.cheque) {
    var st = c.cheque.status || 'received';
    if (st === 'bounced') return { ok: false, why: 'Cheque ' + (c.cheque.no || '') + ' bounced — it pays nothing.' };
    if (st !== 'cleared') return { ok: false, why: 'Cheque ' + (c.cheque.no || '') + ' is ' + st + ', not cleared — it is applied on clearing.' };
  }
  return { ok: true };
}

/**
 * ⭐ cheque(credit, to, on) → { ok, credit, why }: one step in a cheque's life, received → deposited → cleared | bounced.
 * Returns a NEW credit; the old one is untouched. A step out of order is refused with the order it must follow.
 */
function cheque(credit, to, on) {
  var c = credit || {};
  if (!c.cheque) return { ok: false, why: 'This payment is not a cheque.' };
  var from = c.cheque.status || 'received';
  if ((next_(from) || []).indexOf(to) < 0)
    return { ok: false, why: 'A cheque that is ' + from + ' cannot become ' + to + '. The order is received → deposited → cleared or bounced.' };
  var ch = Object.assign({}, c.cheque, { status: to });
  if (to === 'cleared') ch.cleared_on = on || null;
  if (to === 'bounced') ch.bounced_on = on || null;
  return { ok: true, credit: Object.assign({}, c, { cheque: ch }) };
}

/**
 * ⭐ balances(debits, credits, allocations, asOf?) → per debit and per credit, in amounts:
 *   debits[]  { id, amount, allocated, balance, due, state: open | part-paid | paid, overdue }
 *   credits[] { id, amount, allocated, unapplied (On Account), usable, why }
 * `overdue` only when asOf is given (never the machine's today).
 */
function balances(debits, credits, allocations, asOf) {
  var cur = oneCurrency([].concat(debits || [], credits || []), 'one account');
  var L = live(allocations), today = asOf ? day(asOf) : null;
  var onD = Object.create(null), onC = Object.create(null);
  L.forEach(function (a) { var m = toMinor(a.amount, cur); onD[a.debit] = (onD[a.debit] || 0) + m; onC[a.credit] = (onC[a.credit] || 0) + m; });
  var ds = (debits || []).map(function (d) {
    var amt = toMinor(d.amount, cur), got = onD[d.id] || 0, bal = amt - got, due = dueDate(d);
    return { id: d.id, kind: d.kind, party: d.party, date: d.date, due: due, amount: fromMinor(amt, cur),
             allocated: fromMinor(got, cur), balance: fromMinor(bal, cur),
             state: bal <= 0 ? 'paid' : (got > 0 ? 'part-paid' : 'open'), disputed: !!d.disputed,
             overdue: today !== null && bal > 0 && day(due) < today };
  });
  var cs = (credits || []).map(function (c) {
    var amt = toMinor(c.amount, cur), used = onC[c.id] || 0, u = usable(c);
    return { id: c.id, kind: c.kind, party: c.party, date: c.date, amount: fromMinor(amt, cur), allocated: fromMinor(used, cur),
             unapplied: fromMinor(u.ok ? amt - used : 0, cur), usable: u.ok, why: u.why || '' };
  });
  return { currency: cur, debits: ds, credits: cs };
}

/**
 * ⭐⭐ propose(debits, credit, ctx) → { ok, allocations, on_account, skipped, why } — the SUGGESTION, and nothing more.
 *   ctx: { credits, allocations, against?: [debit ids] }
 * Oldest DUE first (ties: the older bill, then the id); or only the named debits, in that order, when `against` is given.
 * Disputed debits are SKIPPED and listed with the reason. It changes nothing: what is written is what the supplier confirms,
 * checked by check(). [§11 D1]
 */
function propose(debits, credit, ctx) {
  var c = credit || {}, x = ctx || {};
  var u = usable(c); if (!u.ok) return { ok: false, why: u.why, allocations: [], on_account: 0, skipped: [] };
  var all = [].concat(x.credits || []);
  if (!all.some(function (k) { return k.id === c.id; })) all.push(c);
  var cur;
  try { cur = oneCurrency([].concat(debits || [], all), 'this payment and these bills'); } catch (e) { return { ok: false, why: e.message, allocations: [], on_account: 0, skipped: [] }; }
  var b = balances(debits, all, x.allocations);
  var mine = b.credits.find(function (k) { return k.id === c.id; });
  var left = toMinor(mine ? mine.unapplied : 0, cur);
  var open = b.debits.filter(function (d) { return d.party === c.party && toMinor(d.balance, cur) > 0; });
  var skipped = open.filter(function (d) { return d.disputed; })
    .map(function (d) { return { debit: d.id, why: 'In dispute — nothing is applied to it until the dispute is settled.' }; });
  open = open.filter(function (d) { return !d.disputed; });
  if (x.against && x.against.length) {
    open = x.against.map(function (id) { return open.find(function (d) { return d.id === id; }); }).filter(Boolean);
  } else {
    open.sort(function (p, q) { return (day(p.due) - day(q.due)) || (day(p.date) - day(q.date)) || String(p.id).localeCompare(String(q.id)); });
  }
  var out = [];
  open.forEach(function (d) {
    if (left <= 0) return;
    var take = Math.min(left, toMinor(d.balance, cur));
    if (take > 0) { out.push({ credit: c.id, debit: d.id, amount: fromMinor(take, cur) }); left -= take; }
  });
  return { ok: true, allocations: out, on_account: fromMinor(left, cur), skipped: skipped, currency: cur };
}

/**
 * ⭐⭐⭐ check(confirmed, debits, credits, allocations) → { ok, problems[], why } — what the supplier CONFIRMED, before
 * it is written. Refuses (does not warn):
 *   · an amount that is not positive · a debit or credit that does not exist · two parties in one allocation
 *   · a disputed payment or a disputed debit (C4) · a payment that cannot be applied (an uncleared cheque, C3)
 *   · more than a payment has left · more than a debit still owes · two currencies
 */
function check(confirmed, debits, credits, allocations) {
  var problems = [];
  var cur;
  try { cur = oneCurrency([].concat(debits || [], credits || []), 'these bills and payments'); }
  catch (e) { return { ok: false, problems: [e.message], why: e.message }; }
  var byD = Object.create(null), byC = Object.create(null);
  (debits || []).forEach(function (d) { byD[d.id] = d; });
  (credits || []).forEach(function (c) { byC[c.id] = c; });
  var b = balances(debits, credits, allocations);
  var leftD = Object.create(null), leftC = Object.create(null);
  b.debits.forEach(function (d) { leftD[d.id] = toMinor(d.balance, cur); });
  b.credits.forEach(function (c) { leftC[c.id] = toMinor(c.unapplied, cur); });
  (confirmed || []).forEach(function (a, i) {
    var n = '#' + (i + 1) + ' ';
    var d = byD[a.debit], c = byC[a.credit], m = toMinor(a.amount, cur);
    if (!(m > 0)) { problems.push(n + 'the amount must be more than zero.'); return; }
    if (!d) { problems.push(n + 'there is no bill ' + a.debit + '.'); return; }
    if (!c) { problems.push(n + 'there is no payment ' + a.credit + '.'); return; }
    if (d.party !== c.party) { problems.push(n + 'the payment and the bill belong to different parties.'); return; }
    if (d.disputed) { problems.push(n + 'bill ' + d.id + ' is in dispute — nothing can be applied to it.'); return; }
    var u = usable(c); if (!u.ok) { problems.push(n + u.why); return; }
    if (m > leftC[c.id]) { problems.push(n + 'payment ' + c.id + ' has only ' + fromMinor(Math.max(0, leftC[c.id]), cur) + ' left to apply.'); return; }
    if (m > leftD[d.id]) { problems.push(n + 'bill ' + d.id + ' only owes ' + fromMinor(Math.max(0, leftD[d.id]), cur) + '.'); return; }
    leftC[c.id] -= m; leftD[d.id] -= m;
  });
  return { ok: problems.length === 0, problems: problems, why: problems[0] || '' };
}

/**
 * ⭐ reverse(allocations, creditId, on) → { rows, reopened } — a bounced or withdrawn payment. Append-only: one reversal
 * row per live allocation of that credit ({ reverses, credit, debit, amount, on }), and the bills it reopens.
 */
function reverse(allocations, creditId, on) {
  var rows = live(allocations).filter(function (a) { return a.credit === creditId; })
    .map(function (a) { return { reverses: a.id, credit: a.credit, debit: a.debit, amount: a.amount, on: on || null }; });
  var re = Object.create(null); rows.forEach(function (r) { re[r.debit] = 1; });
  return { rows: rows, reopened: Object.keys(re) };
}

const BUCKETS = [['not_due', null, 0], ['d1_30', 1, 30], ['d31_60', 31, 60], ['d61_90', 61, 90], ['d90_plus', 91, null]];
/**
 * ⭐ ageing(debits, credits, allocations, asOf) → { currency, total, buckets, by_party } — what is owed, by how long it
 * has been OVERDUE on asOf: not due · 1–30 · 31–60 · 61–90 · 90+ days. Balances after live allocations.
 */
function ageing(debits, credits, allocations, asOf) {
  var today = day(asOf); if (today === null) throw new Error('ageing needs asOf as YYYY-MM-DD — never the machine\'s today.');
  var b = balances(debits, credits, allocations, asOf), cur = b.currency;
  var zero = function () { var o = {}; BUCKETS.forEach(function (k) { o[k[0]] = 0; }); return o; };
  var tot = zero(), per = Object.create(null), all = 0;
  b.debits.forEach(function (d) {
    var m = toMinor(d.balance, cur); if (m <= 0) return;
    var late = today - day(d.due), key = 'not_due';
    BUCKETS.forEach(function (k) { if (k[1] !== null && late >= k[1] && (k[2] === null || late <= k[2])) key = k[0]; });
    tot[key] += m; all += m;
    per[d.party] = per[d.party] || zero(); per[d.party][key] += m;
  });
  var money = function (o) { var r = {}; Object.keys(o).forEach(function (k) { r[k] = fromMinor(o[k], cur); }); return r; };
  var parties = Object.create(null); Object.keys(per).forEach(function (p) { parties[p] = money(per[p]); });
  return { currency: cur, as_of: asOf, total: fromMinor(all, cur), buckets: money(tot), by_party: parties };
}

/**
 * ⭐ statement(party, debits, credits, from, to) → { opening, lines, closing } — what the party owed at `from`, every debit
 * and every USABLE credit in date order with a running balance, and what they owe at `to`. An uncleared or disputed credit
 * is LISTED (with why) but does not reduce the balance — the statement says what it is, not what it hopes.
 */
function statement(party, debits, credits, from, to) {
  var D = (debits || []).filter(function (d) { return d.party === party; });
  var C = (credits || []).filter(function (c) { return c.party === party; });
  var cur = oneCurrency([].concat(D, C), 'one statement');
  var f = day(from), t = day(to);
  var rows = D.map(function (d) { return { date: d.date, kind: d.kind, ref: d.id, dr: toMinor(d.amount, cur), cr: 0, counts: true }; })
    .concat(C.map(function (c) { var u = usable(c); return { date: c.date, kind: c.kind, ref: c.id, dr: 0, cr: toMinor(c.amount, cur), counts: u.ok, why: u.why || '' }; }))
    .sort(function (p, q) { return (day(p.date) - day(q.date)) || (q.dr - p.dr) || String(p.ref).localeCompare(String(q.ref)); });
  var open = 0, bal, lines = [];
  rows.forEach(function (r) { if (f !== null && day(r.date) < f && r.counts) open += r.dr - r.cr; });
  bal = open;
  rows.forEach(function (r) {
    var d = day(r.date);
    if ((f !== null && d < f) || (t !== null && d > t)) return;
    if (r.counts) bal += r.dr - r.cr;
    lines.push({ date: r.date, kind: r.kind, ref: r.ref, debit: fromMinor(r.dr, cur), credit: fromMinor(r.cr, cur),
                 counted: r.counts, why: r.why || '', balance: fromMinor(bal, cur) });
  });
  return { party: party, currency: cur, from: from, to: to, opening: fromMinor(open, cur), lines: lines, closing: fromMinor(bal, cur) };
}

/**
 * ⭐ metrics(debits, credits, allocations, ctx) → the credit cycle, on ctx.asOf:
 *   outstanding · overdue · dso (outstanding ÷ debits raised in the last ctx.days, × days; default 90)
 *   avg_days_to_pay (debits fully paid: the last allocation's `on` − the debit's date) · on_time_pct (paid by their due)
 *   utilisation (outstanding ÷ ctx.limit, when a limit is given)
 * A number that cannot be worked out is null, never 0 — "no data" and "zero days" are different answers.
 */
function metrics(debits, credits, allocations, ctx) {
  var x = ctx || {}, today = day(x.asOf); if (today === null) throw new Error('metrics needs asOf as YYYY-MM-DD.');
  var b = balances(debits, credits, allocations, x.asOf), cur = b.currency;
  var out = 0, over = 0;
  b.debits.forEach(function (d) { var m = toMinor(d.balance, cur); if (m > 0) { out += m; if (d.overdue) over += m; } });
  var span = Number(x.days) > 0 ? Number(x.days) : 90, raised = 0;
  (debits || []).forEach(function (d) { var dd = day(d.date); if (dd !== null && dd > today - span && dd <= today) raised += toMinor(d.amount, cur); });
  var lastOn = Object.create(null); live(allocations).forEach(function (a) { var o = day(a.on); if (o !== null && (lastOn[a.debit] == null || o > lastOn[a.debit])) lastOn[a.debit] = o; });
  var paid = b.debits.filter(function (d) { return d.state === 'paid' && lastOn[d.id] != null; });
  var avg = paid.length ? paid.reduce(function (s, d) { return s + (lastOn[d.id] - day(d.date)); }, 0) / paid.length : null;
  var onTime = paid.length ? paid.filter(function (d) { return lastOn[d.id] <= day(d.due); }).length / paid.length * 100 : null;
  var limit = x.limit != null ? toMinor(x.limit, cur) : null;
  return { currency: cur, as_of: x.asOf, outstanding: fromMinor(out, cur), overdue: fromMinor(over, cur),
           dso: raised > 0 ? Math.round(out / raised * span * 10) / 10 : null,
           avg_days_to_pay: avg === null ? null : Math.round(avg * 10) / 10,
           on_time_pct: onTime === null ? null : Math.round(onTime * 10) / 10,
           utilisation_pct: limit ? Math.round(out / limit * 1000) / 10 : null };
}

/* ═══ C6 — THE OPTIONS, OFF UNTIL THE SUPPLIER TURNS THEM ON (§11). Each returns null when its option is off. ═══ */

/** interestDue(debitBalance, asOf, opt) — simple interest on an overdue balance: rate_pm % a month, after grace_days */
function interestDue(d, asOf, opt) {
  var o = opt || {}; if (!o.on) return null;
  var late = day(asOf) - day(d.due || dueDate(d)) - (Number(o.grace_days) || 0);
  var cur = d.currency || dflt_(opt), bal = toMinor(d.balance != null ? d.balance : d.amount, cur);
  if (!(late > 0) || bal <= 0) return { days: Math.max(0, late || 0), amount: 0, currency: cur };
  return { days: late, amount: fromMinor(Math.round(bal * (Number(o.rate_pm) || 0) / 100 * late / 30), cur), currency: cur };
}
/** earlyDiscount(debit, paidOn, opt) — pct % off when paid within within_days of the bill */
function earlyDiscount(d, paidOn, opt) {
  var o = opt || {}; if (!o.on) return null;
  var cur = d.currency || dflt_(opt);
  if (day(paidOn) - day(d.date) > (Number(o.within_days) || 0)) return { eligible: false, amount: 0, currency: cur };
  return { eligible: true, amount: fromMinor(Math.round(toMinor(d.amount, cur) * (Number(o.pct) || 0) / 100), cur), currency: cur };
}
/** pdcReminders(credits, asOf, opt) — post-dated cheques still in hand: to deposit today or overdue for deposit */
function pdcReminders(credits, asOf, opt) {
  var o = opt || {}; if (!o.on) return null;
  var today = day(asOf);
  return (credits || []).filter(function (c) { return c.cheque && (c.cheque.status || 'received') === 'received' && day(c.cheque.date) !== null; })
    .map(function (c) { var due = day(c.cheque.date); return { credit: c.id, no: c.cheque.no, date: c.cheque.date, amount: c.amount,
      state: due > today ? 'not_yet' : (due === today ? 'deposit_today' : 'overdue_for_deposit') }; })
    .filter(function (r) { return r.state !== 'not_yet' || (day(r.date) - today) <= (Number(o.lead_days) || 0); });
}
/**
 * The check on dues to small suppliers paid late is the pack's (pack.checks, moved verbatim from here); this keeps the frozen name it has always had: (balances, asOf, opt).
 * Each option is off until the supplier turns it on (null); a pack with no such check answers null — there is nothing to flag.
 */
function msmeFlags(bs, asOf, opt) {
  var pk = pack_(opt), ck = pk.checks && pk.checks.msme;
  return typeof ck === 'function' ? ck(bs, asOf, opt, day) : null;
}

/* ═══ v1.8.0 — PARTY ITEMS: every change is a new row ═══ */

const ITEM_KINDS = ['bill', 'advance', 'on_account', 'allocation', 'reversal', 'status'];
const ITEM_STATUSES = ['disputed', 'undisputed', 'received', 'deposited', 'cleared', 'bounced'];
function refuseItem_(why) { var e = new Error(why); e.status = 422; return e; }
/** ⚠️ a stored amount must be a SAFE INTEGER — a huge or non-numeric string is refused by name, never coerced */
function int_(v, where) {
  var n = typeof v === 'number' ? v : (typeof v === 'string' && /^-?\d{1,16}$/.test(v) ? Number(v) : NaN);
  if (!Number.isSafeInteger(n)) throw refuseItem_('Not a whole minor-unit amount at ' + where + ': ' + String(v).slice(0, 40) + '.');
  return n;
}
/**
 * v1.8.1 (critic M10) — an `amount` handed to itemsOfBill / itemsOfPayment becomes minor units the way posting reads one:
 * money.priceOf (finite; a number or a plain decimal string — never true, [5], '0x10', an exponent string), under 10^15
 * minor units (past that a float drops minor units), and a safe integer. Infinity became amount_minor: Infinity before.
 */
function amountMinor_(v, cur, where) {
  var M = M_();
  if (!M || !M.priceOf) throw refuseItem_('Party items need the money engine (it reads every amount).');
  var n = (v !== null && typeof v === 'object') || (typeof v === 'string' && /[eE]/.test(v)) ? null : M.priceOf(v);
  if (n === null) throw refuseItem_('Not an amount at ' + where + ': ' + typeof v + ' ' + String(v).slice(0, 40) + ' — a finite number or a plain decimal string.');
  var raw = n * Math.pow(10, decimals_(cur));
  if (!(Math.abs(raw) < 1e15)) throw refuseItem_('The amount at ' + where + ' is beyond what this record holds exactly (10^15 minor units).');
  return int_(Math.round(Number(raw.toPrecision(15))), where);
}
function side_(x) { return x && x.side === 'payable' ? 'payable' : 'receivable'; }
function row_(o) { var r = {}; Object.keys(o).forEach(function (k) { if (o[k] !== undefined) r[k] = o[k]; }); return r; }

/** ⭐ itemsOfBill(debit, terms) → [ the bill row ]: +amount against itself, with its due date (date + credit days) */
function itemsOfBill(debit, terms) {
  var d = debit || {}, cur = String(d.currency || '').toUpperCase();
  if (!d.id || !d.party) throw refuseItem_('A bill row needs its id and its party.');
  if (!/^[A-Z]{3}$/.test(cur)) throw refuseItem_('A bill row needs its currency.');
  var m = d.amount_minor != null ? int_(d.amount_minor, d.id) : amountMinor_(d.amount, cur, 'bill ' + d.id);
  if (!(m > 0)) throw refuseItem_('A bill must be more than zero.');
  return [row_({ party: d.party, side: side_(d), ref_kind: 'bill', kind: d.kind || 'sale', ref: d.id, against_ref: d.id,
                 amount_minor: m, currency: cur, date: d.date || null, due_date: dueDate(d, terms) })];
}

/**
 * ⭐ itemsOfPayment(credit) → rows: a payment (or a return, credit note, write-off) sits −amount against ITSELF until
 * allocated. A cheque not yet cleared is only a STATUS row (C3) — its money row comes with itemsOfCheque(…,'cleared').
 * A disputed credit is recorded AND frozen (a status row after it) — v1.8.1 (M6): an UNCLEARED cheque too; its dispute
 * row is a row about the DOCUMENT, not about the cheque's state, so it is still there when the cheque clears.
 * A voided one records nothing.
 */
function itemsOfPayment(credit) {
  var c = credit || {}, cur = String(c.currency || '').toUpperCase();
  if (c.void) return [];
  if (!c.id || !c.party) throw refuseItem_('A payment row needs its id and its party.');
  if (!/^[A-Z]{3}$/.test(cur)) throw refuseItem_('A payment row needs its currency.');
  var m = c.amount_minor != null ? int_(c.amount_minor, c.id) : amountMinor_(c.amount, cur, 'payment ' + c.id);
  if (!(m > 0)) throw refuseItem_('A payment must be more than zero.');
  var base = { party: c.party, side: side_(c), currency: cur, date: c.date || null, kind: c.kind || 'payment' };
  var money = row_(Object.assign({}, base, { ref_kind: (c.kind || 'payment') === 'payment' ? 'advance' : 'on_account',
                                              ref: c.id, against_ref: c.id, amount_minor: -m }));
  if (c.cheque && (c.cheque.status || 'received') !== 'cleared') {
    var held = [row_(Object.assign({}, base, { ref_kind: 'status', ref: c.id, against_ref: c.id, amount_minor: 0,
                                               status: c.cheque.status || 'received', pending_minor: -m }))];
    if (c.disputed) held.push(statusItem(c, 'disputed', c.date));
    return held;
  }
  var out = [money];
  if (c.disputed) out.push(statusItem(c, 'disputed', c.date));
  return out;
}

/** ⭐ statusItem(doc, status, on) → ONE status row (amount 0): disputed · undisputed · a cheque step. The latest wins. */
function statusItem(doc, status, on) {
  var d = doc || {};
  if (ITEM_STATUSES.indexOf(status) < 0) throw refuseItem_('Unknown status "' + status + '". One of: ' + ITEM_STATUSES.join(', ') + '.');
  if (!d.id && !d.ref) throw refuseItem_('A status row names its document.');
  var ref = d.ref || d.id;
  return row_({ party: d.party, side: side_(d), ref_kind: 'status', ref: ref, against_ref: d.against_ref || ref,
                amount_minor: 0, currency: d.currency ? String(d.currency).toUpperCase() : undefined, date: on || null, status: status });
}

/**
 * ⭐ itemsOfCheque(items, ref, to, on) → rows for one step of a cheque already recorded: a status row; on CLEARED also the
 * money row (the amount the first status row held as pending). The order received → deposited → cleared | bounced is
 * enforced from the rows themselves. ⚠️ BOUNCED here is a bounce BEFORE clearing — a status row and nothing else, because
 * no money had moved. A cheque that CLEARED and is later dishonoured is not a step of this function (cleared → bounced
 * is refused): it is reverseItems(items, ref, on), which undoes its money row and every allocation made from it.
 */
function itemsOfCheque(items, ref, to, on) {
  var mine = (items || []).filter(function (r) { return r && r.ref === ref; });
  var st = mine.filter(function (r) { return r.ref_kind === 'status' && next_(r.status); });
  var from = st.length ? st[st.length - 1].status : 'received';
  if ((next_(from) || []).indexOf(to) < 0)
    throw refuseItem_('A cheque that is ' + from + ' cannot become ' + to + '. The order is received → deposited → cleared or bounced.');
  var first = mine[0]; if (!first) throw refuseItem_('There is no cheque ' + ref + '.');
  var out = [statusItem({ ref: ref, party: first.party, side: first.side, currency: first.currency }, to, on)];
  if (to === 'cleared') {
    var pend = mine.filter(function (r) { return r.pending_minor != null; });
    var m = pend.length ? int_(pend[0].pending_minor, ref) : 0;
    if (m) out.push(row_({ party: first.party, side: first.side, ref_kind: 'advance', kind: 'payment', ref: ref, against_ref: ref,
                           amount_minor: m, currency: first.currency, date: on || null }));
  }
  return out;
}

/**
 * ⭐ reverseItems(items, ref, on) → reversal rows: every money row of that document (its own row and its allocations),
 * negated, each naming the row it reverses by that row's `item_id`. Rows already reversed are not reversed twice.
 * ⚠️⚠️ v1.8.1 (critic H3): every money row of the document MUST carry `item_id` — the id the database gave the row. A
 * row without one is REFUSED by name. v1.8.0 fell back to the row's position in the array ('PY1#3'), so the same rows in
 * another order, or a per-document fetch, reversed the same money a second time (a payment then OWED BY the customer).
 */
function reverseItems(items, ref, on) {
  var all = items || [], done = Object.create(null);
  all.forEach(function (r) { if (r && r.ref_kind === 'reversal' && r.reverses != null) done[String(r.reverses)] = 1; });
  var out = [];
  all.forEach(function (r, i) {
    if (!r || r.ref !== ref || r.ref_kind === 'status' || r.ref_kind === 'reversal') return;
    var m = int_(r.amount_minor, ref); if (!m) return;
    if (r.item_id == null || r.item_id === '')
      throw refuseItem_('Row ' + (i + 1) + ' of ' + ref + ' (' + r.ref_kind + ' against ' + r.against_ref + ') has no item_id — a reversal must name the row it reverses, never its position.');
    if (done[String(r.item_id)]) return;
    out.push(row_({ party: r.party, side: r.side, ref_kind: 'reversal', kind: r.kind, ref: ref, against_ref: r.against_ref,
                    amount_minor: -m, currency: r.currency, date: on || null, reverses: r.item_id, reverses_kind: r.ref_kind }));
  });
  return out;
}

/**
 * ⭐ reopenedBy(rows) → the documents (bills) a set of reversal rows REOPENS — the against_ref of every reversal of an
 * allocation half that sat against a bill, each once, in the order met. v1.31.0 (M29): the one answer to "which bills
 * did this reversal reopen" — the words a screen paints after a Reverse come from here, never a second count.
 */
function reopenedBy(rows) {
  var seen = Object.create(null), out = [];
  (rows || []).forEach(function (r) {
    if (!r || r.ref_kind !== 'reversal' || r.reverses_kind !== 'allocation' || r.against_ref === r.ref) return;
    var k = String(r.against_ref); if (seen[k]) return; seen[k] = 1; out.push(k);
  });
  return out;
}

/**
 * ⭐⭐ outstanding(items) → { currency, by_ref, by_party, total_minor, total } — Σ per against_ref, and per party.
 *   by_ref[ref] { party, side, kind, bill_minor, outstanding_minor, outstanding, due_date, date, status (the latest
 *                 cheque step), disputed (the latest dispute row) }
 * `items` = a party's (or a shop's) WHOLE item set — every row of every document the rows name.
 * Refuses (throws 409/422), naming the row — never coerced, never netted quietly:
 *   · two currencies · a non-integer or oversized amount · an unknown ref_kind
 *   · (v1.8.1, M5) allocation rows of one payment that do not pair off (Σ ≠ 0 — a half is missing: money created or lost)
 *   · (M5) an allocation half with the wrong sign (− against the bill, + against the payment; a reversal the opposite)
 *   · (M5) an allocation row stamped with a party other than the party of a document it names; a document with two parties
 */
function outstanding(items, opt) {
  var rows = (items || []).filter(Boolean);
  var cur = oneCurrency(rows, 'one set of party items');
  /* L4: no prototype — an against_ref of "__proto__" wrote Object.prototype.outstanding_minor; a party of "constructor" read a function */
  var by = Object.create(null), party = Object.create(null), tot = 0;
  var docParty = Object.create(null), docKind = Object.create(null), pairSum = Object.create(null), pairAt = Object.create(null);
  rows.forEach(function (r, i) {                                   /* first: what each document is, and whose */
    if (ITEM_KINDS.indexOf(r.ref_kind) < 0) throw refuseItem_('Row ' + (i + 1) + ' has an unknown ref_kind "' + r.ref_kind + '".');
    var own = r.ref === r.against_ref && (r.ref_kind === 'bill' || r.ref_kind === 'advance' || r.ref_kind === 'on_account' || (r.ref_kind === 'status' && r.pending_minor != null));
    if (!own) return;
    var k = r.ref, p = String(r.party);
    if (docParty[k] !== undefined && docParty[k] !== p) throw refuseItem_('Row ' + (i + 1) + ': document ' + k + ' is stamped with two parties (' + docParty[k] + ', ' + p + ').');
    docParty[k] = p;
    if (r.ref_kind === 'bill') docKind[k] = 'bill'; else if (!docKind[k]) docKind[k] = 'credit';
  });
  rows.forEach(function (r, i) {
    var m = int_(r.amount_minor, 'row ' + (i + 1));
    var k = r.against_ref, o = by[k] || (by[k] = { ref: k, party: r.party, side: r.side || 'receivable', kind: null, bill_minor: 0,
                                                   outstanding_minor: 0, due_date: null, date: null, status: null, disputed: false });
    if (r.ref_kind === 'status' && r.ref === k) {                  /* M6: a dispute row and a cheque step are read apart */
      if (r.status === 'disputed') o.disputed = true;
      else if (r.status === 'undisputed') o.disputed = false;
      else o.status = r.status;
    }
    if (r.ref === k && r.ref_kind !== 'status' && r.ref_kind !== 'reversal' && r.ref_kind !== 'allocation') {
      o.kind = r.ref_kind; o.date = r.date || o.date; if (r.due_date) o.due_date = r.due_date;
      if (r.ref_kind === 'bill') o.bill_minor += m;
    }
    var undo = r.ref_kind === 'reversal' && r.reverses_kind === 'allocation';
    if (r.ref_kind === 'allocation' || undo) {                     /* M5: a stored allocation half is checked, not trusted */
      var where = 'Row ' + (i + 1) + ' (' + r.ref_kind + ' of ' + r.ref + ' against ' + r.against_ref + ')';
      [r.ref, r.against_ref].forEach(function (d) {
        if (docParty[d] !== undefined && docParty[d] !== String(r.party)) throw refuseItem_(where + ' is stamped party ' + r.party + ', but ' + d + ' belongs to ' + docParty[d] + '.');
      });
      var want = (docKind[k] === 'bill' ? -1 : docKind[k] === 'credit' ? 1 : 0) * (undo ? -1 : 1);
      if (want && m && (m > 0) !== (want > 0)) throw refuseItem_(where + ' has the wrong sign (' + m + '): an allocation is − against the bill and + against the payment.');
      pairSum[r.ref] = (pairSum[r.ref] || 0) + m; if (pairAt[r.ref] === undefined) pairAt[r.ref] = i + 1;
    }
    o.outstanding_minor += m;
    party[r.party] = (party[r.party] || 0) + m; tot += m;
    if (!Number.isSafeInteger(tot)) throw refuseItem_('The party items overflow a safe total at row ' + (i + 1) + '.');
  });
  Object.keys(pairSum).forEach(function (k) {
    if (pairSum[k] !== 0) throw refuseItem_('The allocation rows of ' + k + ' do not pair off: they sum to ' + pairSum[k] + ', not 0 — one half of an allocation is missing or altered (first at row ' + pairAt[k] + ').');
  });
  Object.keys(by).forEach(function (k) { by[k].outstanding = fromMinor(by[k].outstanding_minor, cur || dflt_(opt)); });
  return { currency: cur, by_ref: by, by_party: party, total_minor: tot, total: fromMinor(tot, cur || dflt_(opt)) };
}

/**
 * ⭐ fromItems(items) → { debits, credits, allocations } in the v1.7.0 shapes, so propose() / check() / ageing() /
 * statement() run on the rows unchanged. Net allocations per (payment, bill) after reversals; a bounced payment is void;
 * disputed documents carry disputed: true; an uncleared cheque is a credit with its cheque status (not usable).
 */
function fromItems(items, opt) {
  var o = outstanding(items, opt), cur = o.currency || dflt_(opt);
  var debits = [], credits = [], pairs = Object.create(null);
  (items || []).forEach(function (r) {
    if (!r || r.ref_kind !== 'allocation' && !(r.ref_kind === 'reversal' && r.ref !== r.against_ref)) return;
    if (r.ref === r.against_ref) return;
    var key = r.ref + '\u0000' + r.against_ref;
    pairs[key] = (pairs[key] || 0) - int_(r.amount_minor, r.ref);
  });
  Object.keys(o.by_ref).forEach(function (k) {
    var d = o.by_ref[k];
    if (d.kind === 'bill') {
      debits.push({ id: k, kind: 'sale', party: d.party, date: d.date, due: d.due_date, amount: fromMinor(d.bill_minor, cur), currency: cur, disputed: d.disputed });
    }
  });
  var seen = Object.create(null);
  (items || []).forEach(function (r) {
    if (!r || r.ref !== r.against_ref || seen[r.ref]) return;
    if (r.ref_kind !== 'advance' && r.ref_kind !== 'on_account' && !(r.ref_kind === 'status' && r.pending_minor != null)) return;
    seen[r.ref] = 1;
    var st = o.by_ref[r.ref] || {};
    /* its own money: the advance / on-account rows, less the reversals OF those rows (a dishonoured cheque nets to 0) */
    var money = function (x) { return x.ref_kind === 'advance' || x.ref_kind === 'on_account' || (x.ref_kind === 'reversal' && (x.reverses_kind === 'advance' || x.reverses_kind === 'on_account')); };
    var mine = (items || []).filter(function (x) { return x && x.ref === r.ref && x.against_ref === r.ref && money(x); });
    var own = mine.reduce(function (s, x) { return s - int_(x.amount_minor, r.ref); }, 0);
    var reversed = mine.some(function (x) { return x.ref_kind === 'reversal'; });
    var amt = own || reversed ? own : (r.pending_minor != null ? -int_(r.pending_minor, r.ref) : 0);
    var c = { id: r.ref, kind: r.kind || 'payment', party: r.party, date: r.date, amount: fromMinor(amt, cur), currency: cur, disputed: !!st.disputed };
    if (st.status && next_(st.status)) c.cheque = { status: st.status };
    if (st.status === 'bounced' || (reversed && own === 0)) c.void = true;
    credits.push(c);
  });
  var allocations = Object.keys(pairs).filter(function (k) { return pairs[k] > 0; }).map(function (k) {
    var p = k.split('\u0000'); return { credit: p[0], debit: p[1], amount: fromMinor(pairs[k], cur) };
  });
  return { currency: o.currency, debits: debits, credits: credits, allocations: allocations };
}

/** ⭐ proposeItems(items, creditRef, ctx) → propose() on the rows: the SUGGESTION, oldest due first, disputed skipped (D1) */
function proposeItems(items, creditRef, ctx) {
  var v = fromItems(items, ctx), c = v.credits.find(function (k) { return k.id === creditRef; });
  if (!c) return { ok: false, why: 'There is no payment ' + creditRef + ' to apply.', allocations: [], on_account: 0, skipped: [] };
  return propose(v.debits, c, Object.assign({}, ctx || {}, { credits: v.credits, allocations: v.allocations }));
}

/**
 * ⭐⭐ confirmItems(items, confirmed, on) → { ok, rows, problems, why } — what the owner CONFIRMED, checked by check()
 * against the rows (disputed frozen C4, uncleared cheque C3, never more than is left), then the allocation rows: for each
 * −amount against the bill and +amount against the payment. Nothing is written by this engine; the caller inserts rows.
 */
function confirmItems(items, confirmed, on, opt) {
  var v = fromItems(items, opt);
  var ck = check(confirmed, v.debits, v.credits, v.allocations);
  if (!ck.ok) return { ok: false, rows: [], problems: ck.problems, why: ck.why };
  var cur = v.currency || dflt_(opt), o = outstanding(items, opt), rows = [];
  (confirmed || []).forEach(function (a) {
    var m = toMinor(a.amount, cur), d = o.by_ref[a.debit], c = o.by_ref[a.credit];
    rows.push(row_({ party: d.party, side: d.side, ref_kind: 'allocation', ref: a.credit, against_ref: a.debit, amount_minor: -m, currency: cur, date: on || null }));
    rows.push(row_({ party: c.party, side: c.side, ref_kind: 'allocation', ref: a.credit, against_ref: a.credit, amount_minor: m, currency: cur, date: on || null }));
  });
  return { ok: true, rows: rows, problems: [], why: '' };
}

const EXPORTS = { DEBIT_KINDS, CREDIT_KINDS, dueDate, usable, cheque, live, balances, propose, check, reverse, ageing,
                  statement, metrics, interestDue, earlyDiscount, pdcReminders, msmeFlags,
                  ITEM_KINDS, ITEM_STATUSES, itemsOfBill, itemsOfPayment, statusItem, itemsOfCheque, reverseItems, reopenedBy,
                  outstanding, fromItems, proposeItems, confirmItems };

/* ⭐ ONE FILE, EVERY HOST: node takes module.exports; a page, the TV and the shop PC take window.CBReceivables. */
if (typeof module !== 'undefined' && module.exports) module.exports = EXPORTS;
if (root && typeof root.window !== 'undefined') root.window.CBReceivables = EXPORTS;
})(typeof globalThis !== 'undefined' ? globalThis : this);
