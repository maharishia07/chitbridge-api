/* ADOPTED from chitbridge-engines v1.65.0 · ledger · sha256 488cabe73a4c6d199dc107a1bbb00765714c5abf12cd609a47f43602fbb7ea7b — DO NOT EDIT HERE. Change it in chitbridge-engines, release a version, then run tools/adopt.cjs. */
/* chitbridge-engines · ledger. Edited ONLY in chitbridge-engines/src/ledger.js; every platform adopts a released version of it. */
(function (root) {
'use strict';
// @stage tested
// @stage-note [BOOKS v2] Balances as at a date from period rows + the lines of the open period; trial balance, P&L,
// @stage-note balance sheet (the pack's statement lines), party statement, ageing (the pack's buckets), year carryforward, control checks.
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

var PACKS_ = null, REG_ = null;
function R_() {
  var R = (typeof CBRegulation !== 'undefined' && CBRegulation.resolve) ? CBRegulation : REG_;
  if (R === null && typeof require === 'function') { try { R = REG_ = require('./regulation'); } catch (_) { R = REG_ = false; } }
  return R || null;
}
function P_() {
  var P = (typeof CBAccountsPacks !== 'undefined' && CBAccountsPacks.accountOf) ? CBAccountsPacks : PACKS_;
  if (P === null && typeof require === 'function') { try { P = PACKS_ = require('./accounts-packs'); } catch (_) { P = PACKS_ = false; } }
  return P || null;
}
/** the chart: o.pack, else the registry's for o.country; o.accounts (the shop's own ledgers) added through withAccounts (a clash refused) */
function pack_(o) {
  var P = P_(), R = R_(), p = (o && o.pack) || (R ? R.resolve(o) : null);
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
 * dr_minor nor cr_minor present (a v1.7.0 line carries dr/cr — it would read as nothing), a negative side, both sides, no side.
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
 *   accounts[code] { code, role, name, group, the pack's statement-line fields, statement, side, dr_minor, cr_minor, net_minor (dr − cr) }
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
      var r = acc[a.code] || (acc[a.code] = { code: a.code, role: a.role, name: a.name, group: a.group, sch3: a.sch3, sch3_line: a.sch3_line, line: a.line, line_label: a.line_label,   /* A6 (v1.61.0): a pack whose statement field is `line` keeps it — its balance sheet had no lines */
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

/* the statement lines of one statement, each with its accounts, in the pack's order (pack.presentation.lines) */
function linesOf_(pack, accts, sign) {
  var pr = pack.presentation, table = pr.lines || {}, lines = {}, order = Object.keys(table);
  accts.forEach(function (a) {
    var amt = sign(a); if (!amt) return;
    var k = pr.lineOf(a), S = own_(table, k) || {};
    var L = lines[k] || (lines[k] = { line: k, label: S.label || pr.labelOf(a) || k, side: S.side || null, amount_minor: 0, accounts: [] });
    var entry = { code: a.code, role: a.role, name: a.name, amount_minor: amt };
    if (a.parties != null) entry.parties = a.parties;          /* v1.14.0: an advance line says how many parties it gathers */
    L.amount_minor += amt; L.accounts.push(entry);
  });
  return order.filter(function (k) { return lines[k]; }).map(function (k) { return lines[k]; })
    .concat(Object.keys(lines).filter(function (k) { return order.indexOf(k) < 0; }).map(function (k) { return lines[k]; }));
}

/**
 * ⭐ profitAndLoss({ pack?, balances?, lines, from, to }) → { income[], expenses[], total_income_minor,
 * total_expenses_minor, profit_minor } by the pack's statement line. from and to in ONE fiscal year (a P&L never spans a close).
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
  var income = linesOf_(pack, moved.filter(function (a) { return a.nature === 'income'; }), function (a) { return -a.mv_minor; });
  var expenses = linesOf_(pack, moved.filter(function (a) { return a.nature !== 'income'; }), function (a) { return a.mv_minor; });
  var ti = income.reduce(function (s, l) { return s + l.amount_minor; }, 0), te = expenses.reduce(function (s, l) { return s + l.amount_minor; }, 0);
  return { from: x.from, to: x.to, income: income, expenses: expenses, total_income_minor: ti, total_expenses_minor: te, profit_minor: ti - te };
}

/**
 * v1.14.0 (R4, R8) — PRESENTATION ONLY, as the pack's statutory form asks (pack.presentation). The ledger lines are never changed; the
 * accounts the sheet is drawn from are re-sorted into the line the form puts them on, so both sides move by the same amount.
 *   R4  tax is netted per head (pack.presentation.taxNetting: an output ledger against its input ledger): a net DEBIT with the authority goes to the
 *       pack's creditLine; a net CREDIT stays one entry under its payableLine. Any other account of the pack's tax group (chart.kinds.tax) in debit moves
 *       to the creditLine the same way.
 *   R8  a party in CREDIT on debtors (an over-payment, an advance) is an ADVANCE FROM A CUSTOMER — a liability; a party in DEBIT
 *       on creditors is an ADVANCE TO A SUPPLIER — an asset. Trade receivables / payables are the sums of the parties the right way round.
 */
function presented_(pack, b, bs) {
  var P = P_(), pr = pack.presentation, add = [], drop = Object.create(null);
  var oca = pr.creditLine, ocl = pr.payableLine, taxGroup = pack.chart.kinds.tax;
  var virt = function (base, over) { return Object.assign({}, base, over); };
  pr.taxNetting.forEach(function (g) {
    /* A2 (v1.58.0): a no-credit head names no input ledger (input: null) — its output alone is the payable, placed on the payable line */
    var o = P.accountOf(pack, g.output), i = g.input === null ? null : P.accountOf(pack, g.input); if (!o || (g.input !== null && !i)) return;
    var ao = b.accounts[o.code], ai = i ? b.accounts[i.code] : null; if (!ao && !ai) return;
    drop[o.code] = 1; if (i) drop[i.code] = 1;
    var net = (ao ? ao.net_minor : 0) + (ai ? ai.net_minor : 0);
    if (net > 0) add.push(pr.placed(virt(ai || ao, { code: (i || o).code, role: g.creditRole, name: g.creditName, nature: 'asset', net_minor: net }), oca));
    else if (net < 0) add.push(pr.placed(virt(ao || ai, { code: o.code, role: g.payableRole, name: g.payableName, nature: 'liability', net_minor: net }), ocl));
  });
  bs.forEach(function (a) {
    if (a.group === taxGroup && !drop[a.code] && a.nature === 'liability' && a.net_minor > 0) { drop[a.code] = 1; add.push(pr.placed(virt(a, { nature: 'asset' }), oca)); }
  });
  var party = function (ctlRole, advRole, advName, debtorSide) {
    var c = P.accountOf(pack, ctlRole), adv = P.accountOf(pack, advRole), acc = c ? b.accounts[c.code] : null;
    if (!c || !adv || !acc) return;
    var parts = b.parties[c.code] || {}, mine = 0, opp = 0, n = 0;
    Object.keys(parts).forEach(function (q) {
      var v = parts[q].net_minor;
      if (debtorSide ? v < 0 : v > 0) { opp += v; n++; } else mine += v;
    });
    var rest = acc.net_minor - mine - opp;                       /* lines with no party stay where they are (controls names them) */
    drop[c.code] = 1;
    add.push(virt(acc, { net_minor: mine + rest }));
    if (opp) add.push(pr.placed(virt(acc, { role: advRole, code: adv.code, name: adv.name || advName, nature: debtorSide ? 'liability' : 'asset', net_minor: opp, parties: n }), pr.lineOf(adv)));
  };
  party('debtors', 'customer_advance', pr.labels.advancesFromCustomers, true);
  party('creditors', 'supplier_advance', pr.labels.advancesToSuppliers, false);
  return bs.filter(function (a) { return !drop[a.code]; }).concat(add);
}
/**
 * v1.16.0 (year-journey gap 6) — AN OWNER'S CAPITAL AS ONE ACCOUNT (a proprietor's, a partnership's: the pack names these bases, pack.presentation.ownerCapitalBases). The
 * final accounts of such an entity show ONE Capital account: opening capital + net profit (or − net loss) − drawings. balanceSheet({ …, entity_basis }) gathers capital,
 * retained (the profit of years already closed — it is the owner's) and drawings with the year's profit to date into one head with those three lines.
 * PRESENTATION ONLY: no ledger line changes, and the totals are identical either way. Any other basis the pack knows keeps the ordinary grouping; an unknown one is refused, never defaulted.
 */
var CAPITAL_ROLES_ = ['capital', 'retained', 'drawings'];
function capitalBasis_(pack, basis) {
  if (basis == null || basis === '') return false;
  var bases = (pack.depreciation || {}).entityBases || {};
  if (!Object.prototype.hasOwnProperty.call(bases, basis)) throw refuse_('The entity basis "' + String(basis).slice(0, 40) + '" is not one the pack knows (' + Object.keys(bases).join(', ') + ') — never a default.');
  return pack.presentation.ownerCapitalBases.indexOf(basis) >= 0;
}
function capitalAccount_(accts, pl, labels) {
  var sum = function (roles) { return accts.filter(function (a) { return roles.indexOf(a.role) >= 0; }).reduce(function (s, a) { return s - a.net_minor; }, 0); };
  var opening = sum(['capital', 'retained']), draw = sum(['drawings']);
  if (!opening && !draw && !pl) return null;
  var cap = accts.filter(function (a) { return a.role === 'capital'; })[0] || accts[0];
  var lines = [{ code: cap ? cap.code : null, role: 'capital', name: labels.openingCapital, amount_minor: opening },
               { code: null, role: pl < 0 ? 'net_loss_to_date' : 'profit_to_date', name: pl < 0 ? labels.netLossToDate : labels.netProfitToDate, amount_minor: pl },
               { code: (accts.filter(function (a) { return a.role === 'drawings'; })[0] || {}).code || null, role: 'drawings', name: labels.drawings, amount_minor: draw }];
  return { line: 'capital_account', label: labels.capitalAccount, side: 'cr', amount_minor: opening + pl + draw, accounts: lines };
}
/**
 * ⭐ balanceSheet({ pack?, balances?, lines, asOf, entity_basis? }) → { assets[], liabilities[], total_assets_minor,
 * total_liabilities_minor, profit_to_date_minor, balanced } by the pack's statement line. The year's P&L so far (not yet carried
 * forward) is shown inside the pack's profit line as "Profit for the year to date".
 */
function balanceSheet(o) {
  var x = o || {}, pack = pack_(x), basis = capitalBasis_(pack, x.entity_basis), pr = pack.presentation;
  var b = balanceAsAt(x), all = Object.keys(b.accounts).sort().map(function (k) { return b.accounts[k]; });
  var bs = presented_(pack, b, all.filter(function (a) { return a.statement === 'bs'; }));
  var own_cap = basis ? bs.filter(function (a) { return CAPITAL_ROLES_.indexOf(a.role) >= 0; }) : [];   /* v1.16.0: gathered into ONE Capital account below */
  if (own_cap.length) bs = bs.filter(function (a) { return own_cap.indexOf(a) < 0; });
  var pl = all.filter(function (a) { return a.statement === 'pl'; }).reduce(function (s, a) { return s - a.net_minor; }, 0);
  var assets = linesOf_(pack, bs.filter(function (a) { return a.nature === 'asset'; }), function (a) { return a.net_minor; });
  var liab = linesOf_(pack, bs.filter(function (a) { return a.nature !== 'asset'; }), function (a) { return -a.net_minor; });
  if (basis) {
    var capLine = capitalAccount_(own_cap, pl, pr.labels);
    if (capLine) liab.unshift(capLine);
  } else if (pl) {
    var rs = liab.find(function (l) { return l.line === pr.profitLine; });
    if (!rs) { rs = { line: pr.profitLine, label: (pr.lines[pr.profitLine] || {}).label || pr.labels.profitLine, side: 'cr', amount_minor: 0, accounts: [] }; liab.push(rs); }
    rs.amount_minor += pl; rs.accounts.push({ code: null, role: 'profit_to_date', name: pr.labels.profitToDate, amount_minor: pl });
  }
  var ta = assets.reduce(function (s, l) { return s + l.amount_minor; }, 0), tl = liab.reduce(function (s, l) { return s + l.amount_minor; }, 0);
  return { as_of: x.asOf, fiscal_year: b.fiscal_year, assets: assets, liabilities: liab, total_assets_minor: ta,
           total_liabilities_minor: tl, profit_to_date_minor: pl, balanced: ta === tl };
}

/**
 * ⭐ tradingAccount({ pack?, balances?, lines, from, to }) → the TRADING ACCOUNT, then the P&L's indirect items — v1.14.0 (R7).
 * Sales, returns, purchases, direct expenses, opening and closing stock → GROSS profit; indirect income and expenses → NET profit
 * (ICAI final accounts of a non-company; ITR-3 / ITR-5 Part A). Built from the chart's own groups on balanceAsAt — no new account,
 * and the statement-line profitAndLoss is unchanged. All minor units; same arguments and one-fiscal-year refusal as profitAndLoss.
 *   cost_of_goods_sold = opening stock + purchases − purchase returns + direct expenses − closing stock
 *   gross_profit = net sales + direct income − cost of goods sold      net_profit = gross + indirect income − indirect expenses
 * ⚠️ REFUSED when the net profit does not equal profitAndLoss's, or when Stock-in-hand moved outside closing_stock (its
 * movement must be exactly the opposite of changes_in_inventories) — it would not show opening and closing stock truthfully.
 */
function tradingAccount(o) {
  var x = o || {}, pack = pack_(x), P = P_(), K = pack.chart.kinds, lb = pack.presentation.labels;
  if (day_(x.from) === null || day_(x.to) === null) throw refuse_('A trading account needs from and to as YYYY-MM-DD.');
  if (day_(x.from) > day_(x.to)) throw refuse_('A trading account runs from a day to a later one (' + x.from + ' → ' + x.to + ').');
  var fy = P.fiscalYearOf(x.from, pack);
  if (fy !== P.fiscalYearOf(x.to, pack)) throw refuse_('A trading account stays inside one fiscal year (' + x.from + ' → ' + x.to + ').');
  var end = balanceAsAt(Object.assign({}, x, { asOf: x.to })).accounts;
  var fyStart = P.fyRange(fy, pack).start, atStart = x.from === fyStart;
  var start = atStart ? {} : balanceAsAt(Object.assign({}, x, { asOf: ymd_(day_(x.from) - 1) })).accounts;
  var mv = function (k) { var a = end[k], s = start[k] || { dr_minor: 0, cr_minor: 0 }; return (a.dr_minor - s.dr_minor) - (a.cr_minor - s.cr_minor); };
  var acct = function (k) { var a = end[k]; return { code: a.code, role: a.role, name: a.name, group: a.group, nature: a.nature, statement: a.statement, mv_minor: mv(k) }; };
  var pl = Object.keys(end).filter(function (k) { return end[k].statement === 'pl'; }).sort().map(acct);
  var sumOf = function (list, sign) { return list.reduce(function (s, a) { return s + sign * a.mv_minor; }, 0); };
  var inG = function (g, except) { return pl.filter(function (a) { return a.group === g && (except || []).indexOf(a.role) < 0; }); };
  var roleOf = function (r) { return pl.filter(function (a) { return a.role === r; }); };
  /* A1 (v1.59.0): a chart whose direct income IS its sales group (or direct expense its purchases group) counts that group ONCE — six packs
     (AU AE SG MY US JP) names one group for both, and the trading account showed every sale twice */
  var sales = inG(K.sales, ['sales_returns']), sret = roleOf('sales_returns'), dinc = K.directIncome === K.sales ? [] : inG(K.directIncome);
  var purch = inG(K.purchases, ['purchase_returns', 'changes_in_inventories']), pret = roleOf('purchase_returns'), dexp = K.directExpense === K.purchases ? [] : inG(K.directExpense);
  var chg = roleOf('changes_in_inventories'), iinc = inG(K.indirectIncome), iexp = inG(K.indirectExpense);
  /* stock: closing from the balance at `to`; opening from the day before `from` (period 0 on the year's first day) */
  var stockKeys = Object.keys(end).filter(function (k) { return end[k].group === K.stock; });
  var closing = stockKeys.reduce(function (s, k) { return s + end[k].net_minor; }, 0), opening = 0;
  if (atStart) {
    var rowsSrc = Array.isArray(x.balances) ? x.balances : (x.lines || []);
    rowsSrc.filter(Boolean).forEach(function (r, i) {
      if (r.fiscal_year !== fy || Number(r.period) !== 0 || (r.party != null && r.party !== '')) return;
      var a = acct_(pack, r, 'opening row ' + (i + 1));
      if (a.group !== K.stock) return;
      var sd = Array.isArray(x.balances) ? rowSides_(r, 'opening row ' + (i + 1)) : sides_(r, 'opening row ' + (i + 1));
      opening = add_(opening, sd[0] - sd[1], 'opening stock');
    });
  } else opening = Object.keys(start).filter(function (k) { return start[k].group === K.stock; }).reduce(function (s, k) { return s + start[k].net_minor; }, 0);
  var moved = sumOf(chg, 1), outside = (opening - closing) - moved;
  if (outside) throw refuse_('Stock-in-hand moved by ' + Math.abs(outside) + ' minor units outside closing stock — the Trading account cannot show opening and closing stock truthfully.');
  var netSales = sumOf(sales, -1) - sumOf(sret, 1), dincome = sumOf(dinc, -1);
  var purchases = sumOf(purch, 1), pReturns = sumOf(pret, -1), direct = sumOf(dexp, 1);
  var cogs = opening + purchases - pReturns + direct - closing, gross = netSales + dincome - cogs;
  var iincome = sumOf(iinc, -1), iexpense = sumOf(iexp, 1), net = gross + iincome - iexpense;
  var plProfit = pl.reduce(function (s, a) { return s - a.mv_minor; }, 0);
  if (net !== plProfit) throw refuse_('The trading account\'s net profit (' + net + ') is not the profit and loss\'s (' + plProfit + ') — an account is outside the chart\'s direct / indirect groups.');
  var rows = function (list, sign) { return list.filter(function (a) { return a.mv_minor; }).map(function (a) { return { code: a.code, role: a.role, name: a.name, amount_minor: sign * a.mv_minor }; }); };
  var stk = (stockKeys.length ? end[stockKeys[0]] : { code: null });
  var stockRow = function (role, name, v) { return v ? [{ code: stk.code, role: role, name: name, amount_minor: v }] : []; };
  return { from: x.from, to: x.to,
           sales_minor: sumOf(sales, -1), sales_returns_minor: sumOf(sret, 1), net_sales_minor: netSales, direct_income_minor: dincome,
           opening_stock_minor: opening, purchases_minor: purchases, purchase_returns_minor: pReturns, direct_expenses_minor: direct,
           closing_stock_minor: closing, cost_of_goods_sold_minor: cogs, gross_profit_minor: gross,
           indirect_income_minor: iincome, indirect_expenses_minor: iexpense, net_profit_minor: net,
           lines: { trading_dr: stockRow('opening_stock', lb.openingStock, opening).concat(rows(purch, 1), rows(sret, 1), rows(dexp, 1)),
                    trading_cr: rows(sales, -1).concat(rows(pret, -1), rows(dinc, -1), stockRow('closing_stock', lb.closingStock, closing)),
                    pl_dr: rows(iexp, 1), pl_cr: rows(iinc, -1) } };
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
 * ⭐ AGEING BUCKETS — the pack's (pack.presentation.ageing): each side's list of [bucket, [from, to] months] in order, the first being "not due". Age runs from the DUE date
 * (the transaction date where there is none).
 * ⚠️ THE BOUNDARY (a convention, stated for the accountant — critic L7): a bucket INCLUDES its upper edge. A document exactly at an edge on asOf stays in the lower bucket; the
 * day after it is in the next. The exported constants are the DEFAULT pack's buckets, unchanged.
 */
const AGE_DEFAULT_ = (function () {
  var R = R_(), d = R && R.packFor(R.DEFAULT);
  if (!d) throw new Error('ledger.js needs regulation.js (CBRegulation, with the India pack) loaded before it — add the regulation scripts ahead of this one on the page; see the CHANGELOG, v1.28.0.');
  return (d.presentation && d.presentation.ageing) || { receivable: [], payable: [] };
})();
const AGE_RECEIVABLE = AGE_DEFAULT_.receivable;
const AGE_PAYABLE = AGE_DEFAULT_.payable;

/**
 * ⭐⭐ ageing(docs, asOf, side?, { pack?, country? }) → { as_of, side, buckets: { undisputed:{…}, disputed:{…} }, by_party, total_minor,
 * unapplied_minor } — docs are receivables.outstanding(items).by_ref values (or any { ref, party, due_date, date,
 * outstanding_minor, disputed }). A negative document (money not yet applied) is not aged: it is unapplied_minor.
 */
function ageing(docs, asOf, side, opt) {
  var today = day_(asOf); if (today === null) throw refuse_('Ageing needs asOf as YYYY-MM-DD — never the machine\'s today.');
  var R = R_(), pk = (opt && opt.pack) || (R ? R.resolve(opt) : null), A = pk && pk.presentation && pk.presentation.ageing;
  if (!A) throw refuse_('The regulation pack names no ageing buckets.');
  var B = side === 'payable' ? A.payable : A.receivable;
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
 * into role `retained` as one balance row — no journal entry.
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

const EXPORTS = { AGE_RECEIVABLE, AGE_PAYABLE, minor, linesOf, accumulate, balanceAsAt, trialBalance, profitAndLoss, balanceSheet, tradingAccount,
                  partyStatement, ageing, carryForward, controls };

/* ⭐ ONE FILE, EVERY HOST: node takes module.exports; a page, the TV and the shop PC take window.CBLedger. */
if (typeof module !== 'undefined' && module.exports) module.exports = EXPORTS;
if (root && typeof root.window !== 'undefined') root.window.CBLedger = EXPORTS;
})(typeof globalThis !== 'undefined' ? globalThis : this);
