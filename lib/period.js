/* ADOPTED from chitbridge-engines v1.20.0 · period · sha256 bfe2c30d4803526d0120ed9fcab9f44845302efb29b3b85b75192d8ae31acc9a — DO NOT EDIT HERE. Change it in chitbridge-engines, release a version, then run tools/adopt.cjs. */
/* chitbridge-engines · period. Edited ONLY in chitbridge-engines/src/period.js; every platform adopts a released version of it. */
(function (root) {
'use strict';
// @stage tested
// @stage-note [BOOKS] The month lock and the year close as ONE pure rule: periodState, postingDate, yearClose. No storage, no clock —
// @stage-note the writer passes the periods it holds and the date it was handed; the answer says where an entry lands, or why not.
/**
 * period.js — WHICH MONTH IS OPEN, WHERE AN ENTRY LANDS, AND WHEN A YEAR MAY CLOSE (v1.20.0, 2026-10-03).
 *
 * Athi, 2026-10-03: *"take 1-5 next"* — item 5, the year journey's gap 1: *"the period lock and year close live only in the API writer;
 * the engines have none."* This is the rule the API's writer applied (chitbridge-api lib/books.js postingDateFor), written once here
 * so the API and the year journey call the SAME function. Tally refuses a voucher dated outside the open period; ERPNext locks a
 * period and closes a year with a Period Closing Voucher; the rule below is those two, in the shape the writer needs.
 *
 * ── THE SHAPE ─────────────────────────────────────────────────────────────────────────────────────────────────
 *   periods   [{ fiscal_year, period, status }]  — status 'locked' | 'closed'; a month with no row is OPEN. A row with no `period`
 *             ('2026-27', status 'closed') is the whole year — what yearClose hands back for the writer to store.
 *   event     { type, date: 'YYYY-MM-DD', … }     — the date is the DOCUMENT date; it is never changed (it is kept as `doc_date`).
 *
 * ⭐ THE RULE (one function, postingDate):
 *   · an OPENING entry, or one in an open month, lands on its own date;
 *   · a month that is locked (or closed) REFUSES a date a person TYPED — PERIOD_LOCKED / YEAR_CLOSED — and leaves nothing;
 *   · an AUTOMATIC entry (a bill the counter or a supplier chit posts by itself: AUTOMATIC) is never refused: it MOVES to the first day
 *     of the next open month — into next year when this one has none left — and `doc_date` keeps the date on the document.
 *   `strict` overrides the default (typed → strict, automatic → not): { strict: true } refuses an automatic one too.
 * ⭐ THE YEAR CLOSE (yearClose): every month locked · Suspense nil · trial balance balanced — each missing one NAMED, never fixed — and
 *   only then ledger.carryForward builds the next year's opening rows. Nothing is inferred: a figure not handed in is a refusal, never nil.
 * ⚠️ WHAT THIS DOES NOT DO: store the locks, ask who may reopen a month, or write the reason. Those are the writer's.
 */

var PACKS_ = null, LEDGER_ = null;
function P_() {
  var P = (typeof CBAccountsPacks !== 'undefined' && CBAccountsPacks.fiscalYearOf) ? CBAccountsPacks : PACKS_;
  if (P === null && typeof require === 'function') { try { P = PACKS_ = require('./accounts-packs'); } catch (_) { P = PACKS_ = false; } }
  return P || null;
}
function L_() {
  var L = (typeof CBLedger !== 'undefined' && CBLedger.carryForward) ? CBLedger : LEDGER_;
  if (L === null && typeof require === 'function') { try { L = LEDGER_ = require('./ledger'); } catch (_) { L = LEDGER_ = false; } }
  return L || null;
}
function need_() {
  var P = P_(); if (!P) throw refuse_('The period rule needs the accounts-packs engine (the fiscal year and its months).');
  return P;
}
function refuse_(why, code) { var e = new Error(why); e.refused = true; e.status = 422; if (code) e.code = code; return e; }
function pack_(o) { var P = need_(); return (o && o.pack) || P.packFor((o && o.country) || 'IN'); }

const PERIOD_LOCKED = 'That month is locked. Open it again (with a reason) to record this.';
const YEAR_CLOSED = 'That year is closed. Its books are carried forward; record this in the open year.';
/** what a chit posts by itself — never refused for its date, moved instead (a typed entry is anything else) */
const AUTOMATIC = Object.freeze(['walkin_day', 'sale_bill', 'purchase_bill', 'return', 'credit_note', 'purchase_return']);
const STATES = ['open', 'locked', 'closed'];
/** a year this engine can lock has twelve months (accounts-packs.periodRange) */
const MONTHS = 12;

/** the status of one month in the list: 'closed' (its row, or a whole-year row) beats 'locked' beats open */
function state_(periods, fy, p) {
  var st = 'open';
  (Array.isArray(periods) ? periods : []).forEach(function (r) {
    if (!r || String(r.fiscal_year) !== String(fy)) return;
    if (STATES.indexOf(r.status) < 1) return;                              /* an unknown status is ignored, never read as "locked" */
    if (r.period != null && Number(r.period) !== p) return;
    if (r.status === 'closed' || st === 'open') st = r.status;
  });
  return st;
}

/**
 * periodState(periods, date, { pack? }) → 'open' | 'locked' | 'closed' — the state of the month that `date` falls in.
 * Throws a refusal for a date that is not a real YYYY-MM-DD day (a missing date is never read as open).
 */
function periodState(periods, date, opt) {
  var P = need_(), pack = pack_(opt), fy = P.fiscalYearOf(date, pack), p = P.periodOf(date, pack);
  if (fy === null || p === null) throw refuse_('A period needs its date as YYYY-MM-DD.');
  return state_(periods, fy, p);
}

/** the first open month at or after (fy, p), crossing into later years — null after a bounded search (a stuck book is not looped on) */
function nextOpen_(periods, fy, p, pack) {
  var P = need_(), y = parseInt(fy, 10);
  for (var i = 0; i < MONTHS * 4; i++) {
    if (p > MONTHS) { p = 1; y++; }
    var f = pack && pack.fy_start_month === 1 ? String(y) : y + '-' + String((y + 1) % 100).padStart(2, '0');
    if (state_(periods, f, p) === 'open') return { fiscal_year: f, period: p, date: P.periodRange(f, p, pack).start };
    p++;
  }
  return null;
}

/**
 * ⭐ postingDate(event, periods, { strict?, pack? }) → { ok, date, doc_date, moved, fiscal_year, period, state }
 *                                                  or { ok: false, code, why, doc_date, state, period }
 * The date an entry is POSTED on. `doc_date` is always the event's own date, kept. `strict` defaults to "the event is typed"
 * (its type is not in AUTOMATIC); { strict: true } refuses a locked month even for an automatic one, { strict: false } moves a typed one.
 * code is PERIOD_LOCKED (a locked month) or YEAR_CLOSED (a closed one); `why` is the sentence the writer shows.
 */
function postingDate(event, periods, opt) {
  var ev = event || {}, o = opt || {}, P = need_(), pack = pack_(o), date = ev.date;
  var fy = P.fiscalYearOf(date, pack), p = P.periodOf(date, pack);
  if (fy === null || p === null) throw refuse_('An entry needs its date as YYYY-MM-DD.');
  var st = ev.type === 'opening' ? 'open' : state_(periods, fy, p);                    /* an opening entry is the brought-forward row: never moved or refused */
  if (st === 'open') return { ok: true, date: date, doc_date: date, moved: false, fiscal_year: fy, period: p, state: st };
  var strict = o.strict != null ? !!o.strict : AUTOMATIC.indexOf(ev.type) < 0;
  if (strict) {
    var closed = st === 'closed';
    return { ok: false, code: closed ? 'YEAR_CLOSED' : 'PERIOD_LOCKED', why: closed ? YEAR_CLOSED : PERIOD_LOCKED, doc_date: date, state: st, fiscal_year: fy, period: p };
  }
  var to = nextOpen_(periods, fy, p + 1, pack);
  if (!to) return { ok: false, code: 'PERIOD_LOCKED', why: 'No open month follows ' + fy + ' period ' + p + ' — every month ahead is locked.', doc_date: date, state: st, fiscal_year: fy, period: p };
  return { ok: true, date: to.date, doc_date: date, moved: true, fiscal_year: to.fiscal_year, period: to.period, state: st };
}

/**
 * ⭐ yearClose({ fiscal_year (or fy), periods, trialBalance?, suspense?, lines?, balances?, asOf?, pack?, … }) → { ok, refusals, carryForward, periods }
 *   refusals   [{ name, why, … }] — 'already_closed' · 'months_open' (the periods named) · 'suspense_not_nil' · 'suspense_unknown' ·
 *              'trial_balance_unbalanced' · 'trial_balance_unknown' · and ledger.carryForward's own refusal. Every one is reported at once.
 *   trialBalance  the ledger's trialBalance() answer ({ balanced, total_dr_minor, total_cr_minor }) at the year end; derived from `lines` when absent
 *   suspense      the NET minor units of role suspense (Dr − Cr) at the year end; derived from `lines` when absent
 *   carryForward  ledger.carryForward's answer ({ ok, rows, … }) — built ONLY when nothing above refused; the rest of the arguments
 *                 (lines, balances, accounts, entity …) go to it as they are, so there is one carry-forward and it is that one
 *   periods    the row the writer stores when ok — [{ fiscal_year, status: 'closed' }] — and [] otherwise
 * ⚠️ NOTHING IS ASSUMED: a Suspense or trial balance that was neither handed in nor derivable is a refusal, never "nil" / "balanced".
 */
function yearClose(o) {
  var x = o || {}, P = need_(), pack = pack_(x), fy = x.fiscal_year != null ? x.fiscal_year : x.fy, L = L_();
  var rg = P.fyRange(fy, pack); if (!rg) throw refuse_('A year close needs its fiscal year (e.g. 2026-27).');
  var bad = [], periods = Array.isArray(x.periods) ? x.periods : [];
  if (state_(periods, fy, 1) === 'closed' && state_(periods, fy, MONTHS) === 'closed') bad.push({ name: 'already_closed', why: fy + ' is already closed.' });
  var open = [];
  for (var p = 1; p <= MONTHS; p++) if (state_(periods, fy, p) === 'open') open.push(p);
  if (open.length) bad.push({ name: 'months_open', periods: open, why: 'Every month must be locked before the year closes — still open: ' + open.map(function (n) { return P.periodRange(fy, n, pack).start.slice(0, 7); }).join(', ') + '.' });
  var asOf = x.asOf || rg.end, lines = x.lines, bal = null;
  var balance = function () { if (bal === null && L && Array.isArray(lines)) bal = L.balanceAsAt(Object.assign({}, x, { asOf: asOf })); return bal; };
  var sus = x.suspense;
  if (sus == null && balance()) { var a = P.accountOf(pack, 'suspense'); sus = a && bal.accounts[a.code] ? bal.accounts[a.code].net_minor : 0; }
  if (sus == null) bad.push({ name: 'suspense_unknown', why: 'Suspense was not handed in and cannot be read — the year is not closed on a guess.' });
  else if (sus !== 0) bad.push({ name: 'suspense_not_nil', suspense_minor: sus, why: 'Suspense is not nil (' + sus + ' minor units ' + (sus > 0 ? 'debit' : 'credit') + ') — clear the opening difference first.' });
  var tb = x.trialBalance;
  if (!tb && balance()) tb = L.trialBalance(Object.assign({}, x, { asOf: asOf }));
  if (!tb || typeof tb.balanced !== 'boolean') bad.push({ name: 'trial_balance_unknown', why: 'The trial balance was not handed in and cannot be read — the year is not closed on a guess.' });
  else if (!tb.balanced) bad.push({ name: 'trial_balance_unbalanced', dr_minor: tb.total_dr_minor, cr_minor: tb.total_cr_minor, why: 'The trial balance does not balance (Dr ' + tb.total_dr_minor + ' ≠ Cr ' + tb.total_cr_minor + ').' });
  var cf = null;
  if (!bad.length) {
    if (!L) throw refuse_('A year close needs the ledger engine (carryForward).');
    cf = L.carryForward(Object.assign({}, x, { fiscal_year: fy }));
    if (!cf.ok) bad.push({ name: 'carry_forward', why: cf.why || 'The carry-forward refused.' });
  }
  return { ok: bad.length === 0, refusals: bad, carryForward: cf, periods: bad.length ? [] : [{ fiscal_year: fy, status: 'closed' }] };
}

const EXPORTS = { PERIOD_LOCKED, YEAR_CLOSED, AUTOMATIC, periodState, postingDate, yearClose };

/* ⭐ ONE FILE, EVERY HOST: node takes module.exports; a page, the TV and the shop PC take window.CBPeriod. */
if (typeof module !== 'undefined' && module.exports) module.exports = EXPORTS;
if (root && typeof root.window !== 'undefined') root.window.CBPeriod = EXPORTS;
})(typeof globalThis !== 'undefined' ? globalThis : this);
