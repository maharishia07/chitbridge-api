/* ADOPTED from chitbridge-engines v1.8.1 · ledger · sha256 7378e5a94634bb56e7ef51bc0c2053d1b15db46d29b6713d5bbf50d43891906e — DO NOT EDIT HERE. Change it in chitbridge-engines, release a version, then run tools/adopt.cjs. */
/* chitbridge-engines · ledger. Edited ONLY in chitbridge-engines/src/ledger.js; every platform adopts a released version of it. */
(function (root) {
'use strict';
// @stage tested
// @stage-note [BOOKS v2] Balances as at a date from period rows + the lines of the open period; trial balance, P&L,
// @stage-note balance sheet (Schedule III lines), party statement, Schedule III ageing, year carryforward, control checks.
// @stage-note No storage, no clock: rows in, figures out. tests/ledger.test.js runs 20,000 events end to end.
/**
 * ledger.js — WHAT THE LINES ADD UP TO (v1.8.0, 2026-09-29; hardened v1.8.1, 2026-09-30). [SPEC-books-v2.md §0, §6; RESEARCH-ledger-design §6]
 *
 * Athi, 2026-09-29: *"summarise on a regular basis, so you won't go and read all the data again and again."* ⭐ So a
 * balance is never a scan of history: it is the brought-forward row (period 0) + the month rows before the month asked
 * for + the lines of that month up to the day (Oracle GL_BALANCES, SAP GLT0). ⚠️ Screens say Ledger, Trial balance,
 * Dues — never "accounting" / "books of account" until Athi says so.
 *
 * ── THE SHAPES (money ALWAYS in integer minor units) ─────────────────────────────────────────────────────────────
 *   line     { entry_id?, jv_no?, date:'YYYY-MM-DD', fiscal_year, period (0–12), code | account (role), party?,
 *              dr_minor, cr_minor, ref?, narration?, is_opening? }            — what posting.post() gives, flattened
 *   balance  { fiscal_year, period, code, party (null = the account's own total), dr_minor, cr_minor }
 *            ⭐ BOTH grains are kept (account, and account+party) — the control check compares them.
 *
 * ⭐⭐ THE CONTRACT, WRITTEN ONCE (v1.8.1 — critic H1; v1.8.0 said two different things here and in its test). With p =
 * the period of asOf:
 *   · no `balances`            LINES-ONLY: every line of the year up to asOf counts (the check of the rows).
 *   · `balances` given         the rows of periods 0 … p−1 ALWAYS count; lines of those periods are ignored (the rows
 *                              already are those lines — counting both would double them).
 *   · period p itself          ⭐ GIVEN LINES ARE NEVER SKIPPED: when any line of period p is handed in, period p is read
 *                              from the LINES (up to asOf) and a period-p row, if present, is not used. When NO line of
 *                              period p is handed in, its ROW is used — a row is a whole month, so that is only allowed
 *                              when asOf is the month's LAST day; mid-month it is refused by name, never guessed.
 *   · { prefer: 'rows' }       the explicit exception: period p from its ROW even though lines are given — the rows'
 *                              own, independent closing figure (bookpack's tie check). Month-end asOf only.
 *   So the one writer may pass EITHER rows 0 … p−1 + the open month's lines, OR rows 0 … p + no lines at a month end;
 *   both give the same figures. Nothing is inferred from the calendar any more.
 * ⚠️ A stored LINE is one positive debit OR one positive credit in whole minor units (v1.8.1 — critic M3, L5): a negative
 * amount, both sides, neither side, or a v1.7.0 line with dr/cr and no dr_minor/cr_minor is refused by line number.
 * ⚠️ A year's period 0 is the carryforward of the one before (carryForward()) — a year never reads another year's lines.
 */

var PACKS_ = null;
function P_() {
  var P = (typeof CBAccountsPacks !== 'undefined' && CBAccountsPacks.accountOf) ? CBAccountsPacks : PACKS_;
  if (P === null && typeof require === 'function') { try { P = PACKS_ = require('./accounts-packs'); } catch (_) { P = PACKS_ = false; } }
  return P || null;
}
/** the chart: o.pack, else the country's; o.accounts (the shop's own ledgers) added through withAccounts (a clash refused) */
function pack_(o) {
  var P = P_(), p = (o && o.pack) || (P ? P.packFor((o && o.country) || 'IN') : null);
  return o && Array.isArray(o.accounts) && o.accounts.length && P ? P.withAccounts(p, o.accounts) : p;
}
function refuse_(why, status) { var e = new Error(why); e.status = status || 422; return e; }

/* ── dates: 'YYYY-MM-DD' ↔ a day number, no clock, no zone ── */
/* v1.8.1 (H2): ONE date rule — accounts-packs.dayOf: a real calendar day as YYYY-MM-DD, else null */
function day_(s) { var P = P_(); return P && P.dayOf ? P.dayOf(s) : null; }
function ymd_(n) { return new Date(n * 86400000).toISOString().slice(0, 10); }
function addMonths_(s, k) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '')); if (!m) return null;
  var y = +m[1], mo = +m[2] - 1 + k, d = +m[3];
  var last = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, mo, Math.min(d, last))).toISOString().slice(0, 10);
}

/** ⚠️ a stored amount is a SAFE INTEGER — a huge or non-numeric string is refused by name, never coerced */
function int_(v, where) {
  var n = typeof v === 'number' ? v : (typeof v === 'string' && /^-?\d{1,16}$/.test(v) ? Number(v) : NaN);
  if (!Number.isSafeInteger(n)) throw refuse_('Not a whole minor-unit amount at ' + where + ': ' + String(v).slice(0, 40) + '.');
  return n;
}
function add_(a, b, where) { var s = a + b; if (!Number.isSafeInteger(s)) throw refuse_('A total overflowed at ' + where + '.'); return s; }
/** ⭐ minor(v, where) → the stored amount as a safe integer, or a refusal naming where — the one reader bookpack shares */
function minor(v, where) { return int_(v, where || 'an amount'); }
/**
 * v1.8.1 (M3, L5) — a stored LINE's two sides: one positive debit OR one positive credit. Refused by name: neither
 * dr_minor nor cr_minor present (a v1.7.0 line carries dr/cr — it would read as 0), a negative side, both sides, no side.
 */
function sides_(l, where) {
  if (l.dr_minor == null && l.cr_minor == null) throw refuse_('No dr_minor or cr_minor at ' + where + ' — a ledger line carries minor units (a v1.7.0 dr/cr line is not one).');
  var dr = l.dr_minor == null ? 0 : int_(l.dr_minor, where), cr = l.cr_minor == null ? 0 : int_(l.cr_minor, where);
  if (dr < 0 || cr < 0) throw refuse_('A negative amount at ' + where + ' — a line is one positive debit or credit.');
  if (dr && cr) throw refuse_('Both a debit and a credit at ' + where + ' — a line is one positive debit or credit.');
  if (!dr && !cr) throw refuse_('Neither a debit nor a credit at ' + where + ' — a line is one positive debit or credit.');
  return [dr, cr];
}
/** a period ROW's two sides: both may be set (a month has debits and credits), neither may be negative */
function rowSides_(r, where) {
  var dr = r.dr_minor == null ? 0 : int_(r.dr_minor, where), cr = r.cr_minor == null ? 0 : int_(r.cr_minor, where);
  if (dr < 0 || cr < 0) throw refuse_('A negative amount at ' + where + ' — a row keeps debits and credits apart, both positive.');
  return [dr, cr];
}
/** fiscal year and period of a line or row: present and 0–12, or a refusal — an unstamped entry is in no balance (H2) */
function period_(r, where) {
  var p = Number(r.period);
  if (r.fiscal_year == null || r.fiscal_year === '' || r.period == null || !Number.isInteger(p) || p < 0 || p > 12)
    throw refuse_('No fiscal year or period (0–12) at ' + where + ' — an unstamped entry would be in no balance.');
  return p;
}

/** the account a line or row names — its code, role, name and mapping — or a refusal naming it */
function acct_(pack, x, where) {
  var P = P_(), key = x.code != null && x.code !== '' ? String(x.code) : String(x.account == null ? '' : x.account);
  var a = P && pack ? P.accountOf(pack, key) : null;
  if (!a) throw refuse_('The account "' + key + '" (' + where + ') is not in the chart.');
  return a;
}
function own_(o, k) { return Object.prototype.hasOwnProperty.call(o, k) ? o[k] : null; }

/**
 * ⭐ linesOf(entry, extra?) → the entry's lines, flattened and stamped: date, fiscal_year, period, entry_id, jv_no,
 * narration, is_opening, code. What posting.post() returns goes in; rows ready for the journal come out.
 */
function linesOf(entry, extra) {
  var e = entry || {}, x = extra || {};
  return (e.lines || []).map(function (l, i) {
    return { entry_id: x.entry_id != null ? x.entry_id : (e.entry_id != null ? e.entry_id : null), jv_no: x.jv_no || e.jv_no || null,
             line_no: i + 1, date: e.date || x.date || null, fiscal_year: e.fiscal_year, period: e.period, is_opening: !!e.is_opening,
             code: l.code, account: l.account, party: l.party || null, dr_minor: l.dr_minor, cr_minor: l.cr_minor,
             currency: l.currency, ref: l.ref || e.ref || null, narration: e.narration || null,
             rate: l.rate !== undefined ? l.rate : undefined };   /* v1.8.1: the tax rate travels (SAF-T TaxInformation) */
  });
}

/**
 * ⭐ accumulate(lines, pack?) → the period rows those lines make, at BOTH grains: (fy, period, code, party:null) and
 * (fy, period, code, party). What the server's one writer upserts; what lines-only mode is checked against.
 */
function accumulate(lines, opt) {
  var pack = pack_(opt), map = Object.create(null), out = [];
  (lines || []).forEach(function (l, i) {
    var a = acct_(pack, l, 'line ' + (i + 1)), s = sides_(l, 'line ' + (i + 1)), dr = s[0], cr = s[1];
    period_(l, 'line ' + (i + 1));
    var keys = [null]; if (l.party) keys.push(String(l.party));
    keys.forEach(function (p) {
      var k = l.fiscal_year + '|' + l.period + '|' + a.code + '|' + (p == null ? '' : p);
      var r = map[k] || (map[k] = out[out.push({ fiscal_year: l.fiscal_year, period: l.period, code: a.code, role: a.role, party: p, dr_minor: 0, cr_minor: 0 }) - 1]);
      r.dr_minor = add_(r.dr_minor, dr, k); r.cr_minor = add_(r.cr_minor, cr, k);
    });
  });
  return out;
}

/**
 * ⭐⭐ balanceAsAt({ pack?, balances?, lines, asOf, party? }) → { fiscal_year, period, as_of, accounts, parties }
 *   accounts[code] { code, role, name, group, sch3_line, statement, side, dr_minor, cr_minor, net_minor (dr − cr) }
 *   parties[code][party] { dr_minor, cr_minor, net_minor }
 * ⭐ See THE CONTRACT at the top of this file: rows of periods 0 … p−1 always; period p from its LINES whenever any are
 * given (never skipped), else from its row (month-end asOf only); { prefer: 'rows' } = period p from its row on purpose.
 * No `balances` → every line of the year up to asOf (lines-only mode).
 */
function balanceAsAt(o) {
  var x = o || {}, pack = pack_(x), P = P_();
  if (day_(x.asOf) === null) throw refuse_('A balance needs asOf as YYYY-MM-DD — never the machine\'s today.');
  var fy = P.fiscalYearOf(x.asOf, pack), p = P.periodOf(x.asOf, pack), cut = day_(x.asOf);
  var acc = Object.create(null), par = Object.create(null);   /* own keys only: a stored code or party of "__proto__" is just a key */
  var put = function (a, party, dr, cr, where) {
    if (party == null) {
      var r = acc[a.code] || (acc[a.code] = { code: a.code, role: a.role, name: a.name, group: a.group, sch3: a.sch3, sch3_line: a.sch3_line,
                                               statement: a.statement, side: a.side, nature: a.nature, dr_minor: 0, cr_minor: 0 });
      r.dr_minor = add_(r.dr_minor, dr, where); r.cr_minor = add_(r.cr_minor, cr, where);
    } else {
      var pp = par[a.code] || (par[a.code] = Object.create(null)), q = pp[party] || (pp[party] = { dr_minor: 0, cr_minor: 0 });
      q.dr_minor = add_(q.dr_minor, dr, where); q.cr_minor = add_(q.cr_minor, cr, where);
    }
  };
  var useRows = Array.isArray(x.balances), preferRows = x.prefer === 'rows';
  if (x.prefer != null && !preferRows) throw refuse_('Unknown prefer "' + String(x.prefer).slice(0, 20) + '" — the only one is \'rows\'.');
  var monthEnd = P.periodRange(fy, p, pack).end === x.asOf;
  if (preferRows && !useRows) throw refuse_('prefer: \'rows\' needs the period rows (balances).');
  if (preferRows && !monthEnd) throw refuse_('prefer: \'rows\' needs asOf on the last day of its month (' + x.asOf + ' is not) — a row is a whole month.');
  /* stamped or refused: every line and row says its year and period (an unstamped one would be in no balance — H2) */
  var lines = (x.lines || []).filter(Boolean).map(function (l, i) { return { l: l, n: i + 1, p: period_(l, 'line ' + (i + 1)) }; });
  /* ⭐ H1: period p comes from its LINES whenever any are given; from its ROW only when none are, or on prefer:'rows' */
  var linesOfP = lines.some(function (q) { return q.l.fiscal_year === fy && q.p === p; });
  var rowForP = useRows && (preferRows || !linesOfP);
  if (useRows) x.balances.forEach(function (b, i) {
    if (!b) return;
    var bp = period_(b, 'balance row ' + (i + 1));
    if (b.fiscal_year !== fy || !(bp < p || (rowForP && bp === p))) return;
    if (bp === p && !monthEnd) throw refuse_('A balance on ' + x.asOf + ' needs the lines of its month: the rows hold period ' + p + ' but none of its lines were given, and a row is a whole month.');
    var a = acct_(pack, b, 'balance row ' + (i + 1)), s = rowSides_(b, 'balance row ' + (i + 1));
    put(a, b.party == null || b.party === '' ? null : String(b.party), s[0], s[1], 'balance row ' + (i + 1));
  });
  lines.forEach(function (q) {
    var l = q.l, lp = q.p, where = 'line ' + q.n;
    if (l.fiscal_year !== fy) return;
    if (useRows ? (lp !== p || rowForP) : lp > p) return;      /* rows given: earlier periods are in the rows already */
    if (lp !== 0 && day_(l.date) === null) throw refuse_('No date (YYYY-MM-DD) at ' + where + '.');
    if (lp === p && lp !== 0 && day_(l.date) > cut) return;
    var a = acct_(pack, l, where), s = sides_(l, where), dr = s[0], cr = s[1];
    put(a, null, dr, cr, where);
    if (l.party) put(a, String(l.party), dr, cr, where);
  });
  Object.keys(acc).forEach(function (k) { acc[k].net_minor = acc[k].dr_minor - acc[k].cr_minor; });
  Object.keys(par).forEach(function (c) { Object.keys(par[c]).forEach(function (q) { par[c][q].net_minor = par[c][q].dr_minor - par[c][q].cr_minor; }); });
  return { fiscal_year: fy, period: p, as_of: x.asOf, accounts: acc, parties: par };
}

/**
 * ⭐ trialBalance(o) → { as_of, rows[{ code, role, name, group, debit_minor, credit_minor }], total_dr_minor,
 * total_cr_minor, balanced } — each account's NET on its side, sorted by code; nil accounts left out.
 */
function trialBalance(o) {
  var b = balanceAsAt(o), rows = [], d = 0, c = 0;
  Object.keys(b.accounts).sort().forEach(function (k) {
    var a = b.accounts[k]; if (!a.net_minor) return;
    var r = { code: a.code, role: a.role, name: a.name, group: a.group, debit_minor: a.net_minor > 0 ? a.net_minor : 0, credit_minor: a.net_minor < 0 ? -a.net_minor : 0 };
    d += r.debit_minor; c += r.credit_minor; rows.push(r);
  });
  return { fiscal_year: b.fiscal_year, as_of: b.as_of, rows: rows, total_dr_minor: d, total_cr_minor: c, balanced: d === c };
}

/* the Schedule III lines of one statement, each with its accounts, in the pack's order */
function sch3Group_(pack, accts, st, sign) {
  var lines = {}, order = Object.keys(pack.sch3 || {});
  accts.forEach(function (a) {
    var amt = sign(a); if (!amt) return;
    var k = a.sch3, S = own_(pack.sch3 || {}, k) || {};
    var L = lines[k] || (lines[k] = { line: k, label: S.label || a.sch3_line || k, side: S.side || null, amount_minor: 0, accounts: [] });
    L.amount_minor += amt; L.accounts.push({ code: a.code, role: a.role, name: a.name, amount_minor: amt });
  });
  return order.filter(function (k) { return lines[k]; }).map(function (k) { return lines[k]; })
    .concat(Object.keys(lines).filter(function (k) { return order.indexOf(k) < 0; }).map(function (k) { return lines[k]; }));
}

/**
 * ⭐ profitAndLoss({ pack?, balances?, lines, from, to }) → { income[], expenses[], total_income_minor,
 * total_expenses_minor, profit_minor } by Schedule III line. from and to in ONE fiscal year (a P&L never spans a close).
 */
function profitAndLoss(o) {
  var x = o || {}, pack = pack_(x), P = P_();
  if (day_(x.from) === null || day_(x.to) === null) throw refuse_('A profit and loss needs from and to as YYYY-MM-DD.');
  if (day_(x.from) > day_(x.to)) throw refuse_('A profit and loss runs from a day to a later one (' + x.from + ' → ' + x.to + ').');
  if (P.fiscalYearOf(x.from, pack) !== P.fiscalYearOf(x.to, pack)) throw refuse_('A profit and loss stays inside one fiscal year (' + x.from + ' → ' + x.to + ').');
  var end = balanceAsAt(Object.assign({}, x, { asOf: x.to })).accounts;
  var fyStart = P.fyRange(P.fiscalYearOf(x.from, pack), pack).start;
  var start = x.from === fyStart ? {} : balanceAsAt(Object.assign({}, x, { asOf: ymd_(day_(x.from) - 1) })).accounts;
  var moved = Object.keys(end).map(function (k) {
    var a = end[k], s = start[k] || { dr_minor: 0, cr_minor: 0 };
    return Object.assign({}, a, { mv_minor: (a.dr_minor - s.dr_minor) - (a.cr_minor - s.cr_minor) });
  }).filter(function (a) { return a.statement === 'pl'; }).sort(function (p, q) { return p.code < q.code ? -1 : 1; });
  var income = sch3Group_(pack, moved.filter(function (a) { return a.nature === 'income'; }), 'pl', function (a) { return -a.mv_minor; });
  var expenses = sch3Group_(pack, moved.filter(function (a) { return a.nature !== 'income'; }), 'pl', function (a) { return a.mv_minor; });
  var ti = income.reduce(function (s, l) { return s + l.amount_minor; }, 0), te = expenses.reduce(function (s, l) { return s + l.amount_minor; }, 0);
  return { from: x.from, to: x.to, income: income, expenses: expenses, total_income_minor: ti, total_expenses_minor: te, profit_minor: ti - te };
}

/**
 * ⭐ balanceSheet({ pack?, balances?, lines, asOf }) → { assets[], liabilities[], total_assets_minor,
 * total_liabilities_minor, profit_to_date_minor, balanced } by Schedule III line. The year's P&L so far (not yet carried
 * forward) is shown inside Reserves & surplus as "Profit for the year to date".
 */
function balanceSheet(o) {
  var x = o || {}, pack = pack_(x);
  var b = balanceAsAt(x), all = Object.keys(b.accounts).sort().map(function (k) { return b.accounts[k]; });
  var bs = all.filter(function (a) { return a.statement === 'bs'; });
  var pl = all.filter(function (a) { return a.statement === 'pl'; }).reduce(function (s, a) { return s - a.net_minor; }, 0);
  var assets = sch3Group_(pack, bs.filter(function (a) { return a.nature === 'asset'; }), 'bs', function (a) { return a.net_minor; });
  var liab = sch3Group_(pack, bs.filter(function (a) { return a.nature !== 'asset'; }), 'bs', function (a) { return -a.net_minor; });
  if (pl) {
    var rs = liab.find(function (l) { return l.line === 'reserves_surplus'; });
    if (!rs) { rs = { line: 'reserves_surplus', label: ((pack.sch3 || {}).reserves_surplus || {}).label || 'Reserves and surplus', side: 'cr', amount_minor: 0, accounts: [] }; liab.push(rs); }
    rs.amount_minor += pl; rs.accounts.push({ code: null, role: 'profit_to_date', name: 'Profit for the year to date', amount_minor: pl });
  }
  var ta = assets.reduce(function (s, l) { return s + l.amount_minor; }, 0), tl = liab.reduce(function (s, l) { return s + l.amount_minor; }, 0);
  return { as_of: x.asOf, fiscal_year: b.fiscal_year, assets: assets, liabilities: liab, total_assets_minor: ta,
           total_liabilities_minor: tl, profit_to_date_minor: pl, balanced: ta === tl };
}

/**
 * ⭐ partyStatement({ pack?, balances?, lines, party, code?, from, to }) → { opening_minor, rows[{ date, jv_no, ref,
 * narration, dr_minor, cr_minor, running_minor }], closing_minor } — one party on one control account (default: the
 * party's own lines on debtors, or creditors when it has none). Running balance is dr − cr (a supplier's is negative).
 * `lines`: every line of the months the range touches (the opening reads the rows before them).
 */
function partyStatement(o) {
  var x = o || {}, pack = pack_(x), P = P_(), party = String(x.party || '');
  if (!party) throw refuse_('A statement names its party.');
  if (day_(x.from) === null || day_(x.to) === null) throw refuse_('A statement needs from and to as YYYY-MM-DD.');
  if (day_(x.from) > day_(x.to)) throw refuse_('A statement runs from a day to a later one (' + x.from + ' → ' + x.to + ').');
  var code = x.code ? acct_(pack, { code: x.code }, 'statement').code : null;
  if (!code) {
    var mine = (x.lines || []).filter(function (l) { return l && String(l.party) === party; });
    var deb = P.accountOf(pack, 'debtors').code, cre = P.accountOf(pack, 'creditors').code;
    code = mine.some(function (l) { return acct_(pack, l, 'statement').code === deb; }) || !mine.length ? deb : cre;
  }
  /* the opening: everything before `from` in its fiscal year — period 0 (brought forward, opening entries) included */
  var opening = 0, fy = P.fiscalYearOf(x.from, pack), prev = ymd_(day_(x.from) - 1);
  if (P.fiscalYearOf(prev, pack) === fy) {
    var q = (balanceAsAt(Object.assign({}, x, { asOf: prev })).parties[code] || {})[party];
    opening = q ? q.net_minor : 0;
  } else {                                                              /* from = the year's first day: period 0 only */
    var zero = function (r) { return r && r.fiscal_year === fy && Number(r.period) === 0 && String(r.party) === party && acct_(pack, r, 'opening').code === code; };
    var src = Array.isArray(x.balances) ? x.balances : (x.lines || []);
    src.filter(zero).forEach(function (r) { var s = rowSides_(r, 'opening'); opening = add_(opening, s[0] - s[1], 'opening'); });
  }
  var f = day_(x.from), t = day_(x.to), run = opening, rows = [];
  (x.lines || []).filter(function (l) {
    if (!l || String(l.party) !== party || Number(l.period) === 0 || acct_(pack, l, 'statement').code !== code) return false;
    var d = day_(l.date); return d >= f && d <= t;
  }).sort(function (p, q) { return (day_(p.date) - day_(q.date)) || (Number(p.period) - Number(q.period)) || String(p.jv_no || p.entry_id || '').localeCompare(String(q.jv_no || q.entry_id || '')); })
    .forEach(function (l, i) {
      var s = sides_(l, 'a line of ' + (l.jv_no || l.entry_id || l.date)), dr = s[0], cr = s[1];
      run = add_(run, dr - cr, 'statement');
      rows.push({ date: l.date, jv_no: l.jv_no || null, entry_id: l.entry_id != null ? l.entry_id : null, ref: l.ref || null,
                  narration: l.narration || null, is_opening: !!l.is_opening, dr_minor: dr, cr_minor: cr, running_minor: run });
    });
  return { party: party, code: code, from: x.from, to: x.to, opening_minor: opening, rows: rows, closing_minor: run };
}

/**
 * ⭐ SCHEDULE III AGEING — trade receivables: not due · < 6 months · 6 months–1 year · 1–2 years · 2–3 years · > 3 years,
 * each split undisputed / disputed; trade payables: not due · < 1 year · 1–2 · 2–3 · > 3 years. Age runs from the DUE date
 * (the transaction date where there is none). Division I, as amended 24 Mar 2021.
 * ⚠️ THE BOUNDARY (a convention, stated for the CA — critic L7): a bucket INCLUDES its upper edge. A document exactly 6
 * months overdue on asOf is still '< 6 months' (lt_6m); the day after, it is '6 months – 1 year'. Same at 1, 2, 3 years.
 */
const AGE_RECEIVABLE = [['not_due', null], ['lt_6m', [0, 6]], ['m6_1y', [6, 12]], ['y1_2', [12, 24]], ['y2_3', [24, 36]], ['gt_3y', [36, null]]];
const AGE_PAYABLE = [['not_due', null], ['lt_1y', [0, 12]], ['y1_2', [12, 24]], ['y2_3', [24, 36]], ['gt_3y', [36, null]]];

/**
 * ⭐⭐ ageing(docs, asOf, side?) → { as_of, side, buckets: { undisputed:{…}, disputed:{…} }, by_party, total_minor,
 * unapplied_minor } — docs are receivables.outstanding(items).by_ref values (or any { ref, party, due_date, date,
 * outstanding_minor, disputed }). A negative document (money not yet applied) is not aged: it is unapplied_minor.
 */
function ageing(docs, asOf, side) {
  var today = day_(asOf); if (today === null) throw refuse_('Ageing needs asOf as YYYY-MM-DD — never the machine\'s today.');
  var B = side === 'payable' ? AGE_PAYABLE : AGE_RECEIVABLE;
  var zero = function () { var z = {}; B.forEach(function (b) { z[b[0]] = 0; }); return z; };
  var out = { undisputed: zero(), disputed: zero() }, per = Object.create(null), tot = 0, un = 0;   /* a party id of "__proto__" is just a key */
  var list = Array.isArray(docs) ? docs : Object.keys(docs || {}).map(function (k) { return docs[k]; });
  list.forEach(function (d, i) {
    if (!d) return;
    var m = int_(d.outstanding_minor || 0, 'document ' + (d.ref || i + 1));
    if (m < 0) { un += m; return; }
    if (!m) return;
    var from = d.due_date || d.date, key = 'not_due';
    if (day_(from) === null) throw refuse_('Document ' + (d.ref || i + 1) + ' has no due date or date to age from.');
    /* overdue by (from, from + hi months] lands in that bucket; the first bucket whose upper edge it has not passed */
    if (day_(from) < today) {
      key = B[B.length - 1][0];
      for (var j = 1; j < B.length; j++) { var hi = B[j][1][1]; if (hi === null || today <= day_(addMonths_(from, hi))) { key = B[j][0]; break; } }
    }
    var bag = d.disputed ? out.disputed : out.undisputed;
    bag[key] += m; tot += m;
    var pp = per[d.party] || (per[d.party] = { undisputed: zero(), disputed: zero(), total_minor: 0 });
    pp[d.disputed ? 'disputed' : 'undisputed'][key] += m; pp.total_minor += m;
  });
  return { as_of: asOf, side: side === 'payable' ? 'payable' : 'receivable', buckets: out, by_party: per,
           total_minor: tot, unapplied_minor: un, bucket_keys: B.map(function (b) { return b[0]; }) };
}

/**
 * ⭐⭐ carryForward({ pack?, balances?, lines, fiscal_year }) → { from, to, rows, retained_minor, balanced } — the period-0
 * rows of the NEXT year: every balance-sheet account (and account+party) at its closing; every P&L account's net rolled
 * into role `retained` (3900) as one balance row — no journal entry (SAP carryforward, Tally P&L A/c).
 * ⚠️ v1.8.1 (critic M8, SPEC-books-v2 §0 "Suspense must be nil to close"): when role `suspense` (2900) is not nil the year
 * is NOT carried — { ok: false, why, suspense_minor (dr − cr), rows: [] }. The year-close route blocks on it. ok: true otherwise.
 */
function carryForward(o) {
  var x = o || {}, pack = pack_(x), P = P_();
  var r = P.fyRange(x.fiscal_year, pack); if (!r) throw refuse_('Unknown fiscal year "' + x.fiscal_year + '".');
  var b = balanceAsAt(Object.assign({}, x, { asOf: r.end }));
  var next = P.fiscalYearOf(ymd_(day_(r.end) + 1), pack), ret = P.accountOf(pack, 'retained');
  var sus = P.accountOf(pack, 'suspense'), susNet = sus && b.accounts[sus.code] ? b.accounts[sus.code].net_minor : 0;
  if (susNet) return { ok: false, from: x.fiscal_year, to: next, rows: [], balanced: false, suspense_minor: susNet,
                       why: 'The year cannot close: Suspense (' + sus.code + ') is not nil — it holds ' + Math.abs(susNet) + ' minor units ' + (susNet > 0 ? 'debit' : 'credit') + '. Clear the opening difference first.' };
  var rows = [], pl = 0, d = 0, c = 0;
  var push = function (a, party, net) {
    if (!net) return;
    var row = { fiscal_year: next, period: 0, code: a.code, role: a.role, party: party, dr_minor: net > 0 ? net : 0, cr_minor: net < 0 ? -net : 0 };
    rows.push(row); if (party == null) { d += row.dr_minor; c += row.cr_minor; }
  };
  var retNet = 0;
  Object.keys(b.accounts).sort().forEach(function (k) {
    var a = b.accounts[k];
    if (a.statement === 'pl') { pl += a.net_minor; return; }
    if (a.code === ret.code) { retNet += a.net_minor; return; }
    push(a, null, a.net_minor);
    Object.keys(b.parties[k] || {}).sort().forEach(function (q) { push(a, q, b.parties[k][q].net_minor); });
  });
  push(ret, null, retNet + pl);
  return { ok: true, from: x.fiscal_year, to: next, rows: rows, retained_minor: -(retNet + pl), profit_minor: -pl, balanced: d === c, suspense_minor: 0 };
}

/**
 * ⭐⭐⭐ controls({ pack?, balances?, lines, asOf, recompute_lines?, carried? }) → { ok, mismatches[{ name, … }], checked }
 * — never auto-fixed:
 *   line_malformed                       (v1.8.1, M3) a stored line that is negative, two-sided, side-less or unstamped —
 *                                        named by line number and left OUT of every figure below
 *   debtors_control / creditors_control   the account's total = Σ its party balances
 *   party_missing                        a line on debtors/creditors names no party
 *   day_unbalanced                       a day whose debits ≠ credits (from the lines given)
 *   entry_unbalanced                     an entry (entry_id) whose debits ≠ credits
 *   trial_balance                        Σ debit balances ≠ Σ credit balances
 *   rows_vs_lines                        (when balances AND recompute_lines are given) a period row ≠ the Σ of its lines.
 *                                        v1.8.1 (M4): BOTH sides are walked — a row with no lines behind it (a phantom)
 *                                        is named, and so is a line with no row — and period 0 is compared too (opening
 *                                        entries ARE lines). `recompute_lines` = every line behind the rows given;
 *                                        `carried` = the rows carryForward() made for this year (they have no lines).
 * ⚠️ WHAT ok: true DOES NOT MEAN: the books are arithmetically consistent, not that they are right. A sale posted to
 * the wrong side, or a supplier parked on debtors, still balances — no trial balance can see it.
 */
function controls(o) {
  var x = o || {}, pack = pack_(x), P = P_(), bad = [];
  /* M3: a malformed stored line is NAMED here (balanceAsAt alone would refuse the whole read) and kept out of the sums */
  var wellFormed = function (list, where) {
    var good = [];
    (list || []).forEach(function (l, i) {
      if (!l) return;
      try { period_(l, 'line ' + (i + 1)); sides_(l, 'line ' + (i + 1)); acct_(pack, l, 'line ' + (i + 1)); good.push({ l: l, n: i + 1 }); }
      catch (e) { bad.push({ name: 'line_malformed', in: where, line: i + 1, entry_id: l.entry_id != null ? l.entry_id : null, why: e.message }); }
    });
    return good;
  };
  var good = wellFormed(x.lines, 'lines'), y = Object.assign({}, x, { lines: good.map(function (g) { return g.l; }) });
  var b = balanceAsAt(y);
  ['debtors', 'creditors'].forEach(function (role) {
    var a = P.accountOf(pack, role), acc = b.accounts[a.code], parts = b.parties[a.code] || {};
    var sum = Object.keys(parts).reduce(function (s, q) { return s + parts[q].net_minor; }, 0);
    var tot = acc ? acc.net_minor : 0;
    if (tot !== sum) bad.push({ name: role + '_control', code: a.code, account_minor: tot, parties_minor: sum, difference_minor: tot - sum });
  });
  var days = Object.create(null), ents = Object.create(null), ctl = Object.create(null);   /* L4: an entry_id of "__proto__" is just a key */
  ['debtors', 'creditors'].forEach(function (r) { ctl[P.accountOf(pack, r).code] = r; });
  good.forEach(function (g) {
    var l = g.l, a = acct_(pack, l, 'line ' + g.n), s = sides_(l, 'line ' + g.n), dr = s[0], cr = s[1];
    if (ctl[a.code] && !l.party) bad.push({ name: 'party_missing', line: g.n, code: a.code, entry_id: l.entry_id != null ? l.entry_id : null });
    var dk = l.date || '(no date)', dd = days[dk] || (days[dk] = [0, 0]); dd[0] += dr; dd[1] += cr;
    if (l.entry_id != null) { var ek = String(l.entry_id), ee = ents[ek] || (ents[ek] = [0, 0]); ee[0] += dr; ee[1] += cr; }
  });
  Object.keys(days).sort().forEach(function (k) { if (days[k][0] !== days[k][1]) bad.push({ name: 'day_unbalanced', date: k, dr_minor: days[k][0], cr_minor: days[k][1] }); });
  Object.keys(ents).forEach(function (k) { if (ents[k][0] !== ents[k][1]) bad.push({ name: 'entry_unbalanced', entry_id: k, dr_minor: ents[k][0], cr_minor: ents[k][1] }); });
  var tb = trialBalance(y);
  if (!tb.balanced) bad.push({ name: 'trial_balance', dr_minor: tb.total_dr_minor, cr_minor: tb.total_cr_minor });
  if (Array.isArray(x.balances) && Array.isArray(x.recompute_lines)) {
    var key = function (r, code) { return r.fiscal_year + '|' + r.period + '|' + code + '|' + (r.party == null ? '' : r.party); };
    var want = Object.create(null), have = Object.create(null);
    var into = function (map, k, dr, cr) { var t = map[k] || (map[k] = { dr_minor: 0, cr_minor: 0 }); t.dr_minor = add_(t.dr_minor, dr, k); t.cr_minor = add_(t.cr_minor, cr, k); };
    accumulate(wellFormed(x.recompute_lines, 'recompute_lines').map(function (g) { return g.l; }), { pack: pack })
      .forEach(function (r) { into(want, key(r, r.code), r.dr_minor, r.cr_minor); });
    (x.carried || []).forEach(function (r, i) { if (!r) return; var s = rowSides_(r, 'carried row ' + (i + 1)); into(want, key(r, acct_(pack, r, 'carried row ' + (i + 1)).code), s[0], s[1]); });
    x.balances.forEach(function (r, i) { if (!r) return; var s = rowSides_(r, 'balance row ' + (i + 1)); into(have, key(r, acct_(pack, r, 'balance row ' + (i + 1)).code), s[0], s[1]); });
    var all = Object.create(null); Object.keys(want).concat(Object.keys(have)).forEach(function (k) { all[k] = 1; });
    Object.keys(all).sort().forEach(function (k) {                       /* the UNION: a phantom row and a rowless line both show */
      var h = have[k] || { dr_minor: 0, cr_minor: 0 }, w = want[k] || { dr_minor: 0, cr_minor: 0 };
      if (h.dr_minor !== w.dr_minor || h.cr_minor !== w.cr_minor)
        bad.push({ name: 'rows_vs_lines', key: k, row: h, lines: w, why: !want[k] ? 'a row with no lines behind it' : (!have[k] ? 'lines with no row' : 'the row differs from its lines') });
    });
  }
  return { ok: bad.length === 0, as_of: x.asOf, mismatches: bad, checked: ['line_malformed', 'debtors_control', 'creditors_control', 'party_missing', 'day_unbalanced', 'entry_unbalanced', 'trial_balance'].concat(x.recompute_lines ? ['rows_vs_lines'] : []) };
}

const EXPORTS = { AGE_RECEIVABLE, AGE_PAYABLE, minor, linesOf, accumulate, balanceAsAt, trialBalance, profitAndLoss, balanceSheet,
                  partyStatement, ageing, carryForward, controls };

/* ⭐ ONE FILE, EVERY HOST: node takes module.exports; a page, the TV and the shop PC take window.CBLedger. */
if (typeof module !== 'undefined' && module.exports) module.exports = EXPORTS;
if (root && typeof root.window !== 'undefined') root.window.CBLedger = EXPORTS;
})(typeof globalThis !== 'undefined' ? globalThis : this);
