/* ADOPTED from chitbridge-engines v1.110.13 · ledger · sha256 7792fd7842cde0e5d8ac65296c0a3ccd410f08f2e9ec204e2e362ff347733b24 — DO NOT EDIT HERE. Change it in chitbridge-engines, release a version, then run tools/adopt.cjs. */
/* chitbridge-engines · ledger. Edited ONLY in chitbridge-engines/src/ledger.js; every platform adopts a released version of it. */
/*
 * OWNS      what the ledger lines add up to: balances as at a date from the period rows and the open month's lines, trial balance, profit and loss, balance sheet, trading account, party statement, ageing buckets, year carry-forward and the control checks (no storage, no clock)
 * CALLED BY the api (lib/books-engines.js ledger() · dues ageing, lib/books.js trialBalance · balanceSheet · profitAndLoss · partyStatement · accumulate · carryForward · controls, lib/books-period.js and lib/books-cashflow.js balanceAsAt, lib/bookpack.js linesOf, lib/period.js carryForward, routes/books.js ageing · balanceSheet · partyStatement); the web has no copy
 * FLOW      lines (+ period rows) ──▶ balanceAsAt (readMode_ → addBalanceRows_ → addStampedLines_ → addNetMinor_) ──▶ trialBalance · profitAndLoss · balanceSheet · tradingAccount · partyStatement · ageing · carryForward · controls, or a refusal that names its line
 * CARD      14-accounting/statements-tb-pandl-bs-party-statement
 */
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

  var PACKS_ = null,
    REG_ = null;
  function regulationEngine_() {
    var regulation = typeof CBRegulation !== 'undefined' && CBRegulation.resolve ? CBRegulation : REG_;
    if (regulation === null && typeof require === 'function') {
      try {
        regulation = REG_ = require('./regulation');
      } catch (_) {
        regulation = REG_ = false;
      }
    }
    return regulation || null;
  }
  function packsEngine_() {
    var packs = typeof CBAccountsPacks !== 'undefined' && CBAccountsPacks.accountOf ? CBAccountsPacks : PACKS_;
    if (packs === null && typeof require === 'function') {
      try {
        packs = PACKS_ = require('./accounts-packs');
      } catch (_) {
        packs = PACKS_ = false;
      }
    }
    return packs || null;
  }
  /** the chart: o.pack, else the registry's for o.country; o.accounts (the shop's own ledgers) added through withAccounts (a clash refused) */
  function pack_(options) {
    var packs = packsEngine_(),
      regulation = regulationEngine_(),
      chosen = (options && options.pack) || (regulation ? regulation.resolve(options) : null);
    return options && Array.isArray(options.accounts) && options.accounts.length && packs ? packs.withAccounts(chosen, options.accounts) : chosen;
  }

  /* the stored-amount readers (ledger-read.js), under the names this file has always used */
  var READ_ = (root && root.CBLedgerRead) || (typeof require === 'function' ? require('./ledger-read') : null);
  var refuse_ = READ_.refuse,
    int_ = READ_.int,
    add_ = READ_.add,
    minor = READ_.minor,
    sides_ = READ_.sides,
    rowSides_ = READ_.rowSides,
    period_ = READ_.period;

  /* ── dates: 'YYYY-MM-DD' ↔ a day number, no clock, no zone ── */
  /* v1.8.1 (H2): ONE date rule — accounts-packs.dayOf: a real calendar day as YYYY-MM-DD, else null */
  function day_(text) {
    var packs = packsEngine_();
    return packs && packs.dayOf ? packs.dayOf(text) : null;
  }
  function ymd_(dayNumber) {
    return new Date(dayNumber * 86400000).toISOString().slice(0, 10);
  }
  function addMonths_(text, months) {
    var parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(text || ''));
    if (!parts) return null;
    var y = +parts[1],
      monthIndex = +parts[2] - 1 + months,
      dayOfMonth = +parts[3];
    var last = new Date(Date.UTC(y, monthIndex + 1, 0)).getUTCDate();
    return new Date(Date.UTC(y, monthIndex, Math.min(dayOfMonth, last))).toISOString().slice(0, 10);
  }


  /** the account a line or row names — its code, role, name and mapping — or a refusal naming it */
  function acct_(pack, x, where) {
    var packs = packsEngine_(),
      key = x.code != null && x.code !== '' ? String(x.code) : String(x.account == null ? '' : x.account);
    var account = packs && pack ? packs.accountOf(pack, key) : null;
    if (!account) throw refuse_('The account "' + key + '" (' + where + ') is not in the chart.');
    return account;
  }
  function own_(object, key) {
    return Object.prototype.hasOwnProperty.call(object, key) ? object[key] : null;
  }

  /**
   * ⭐ linesOf(entry, extra?) → the entry's lines, flattened and stamped: date, fiscal_year, period, entry_id, jv_no,
   * narration, is_opening, code. What posting.post() returns goes in; rows ready for the journal come out.
   */
  function linesOf(entry, extra) {
    var e = entry || {},
      x = extra || {};
    return (e.lines || []).map(function (item, index) {
      return stampedLine_(entryStamp_(e, x), e, item, index);
    });
  }
  /** the entry-level fields every flattened line of one entry carries: id, journal number, date, fiscal year, period, opening flag */
  function entryStamp_(entry, extra) {
    return {
      entry_id: extra.entry_id != null ? extra.entry_id : entry.entry_id != null ? entry.entry_id : null,
      jv_no: extra.jv_no || entry.jv_no || null,
      date: entry.date || extra.date || null,
      fiscal_year: entry.fiscal_year,
      period: entry.period,
      is_opening: !!entry.is_opening
    };
  }
  /** one flattened line: the entry's stamp, the line's own account, sides, party and rate, and the entry's ref and narration as the fallback */
  function stampedLine_(stamp, entry, item, index) {
    return {
      entry_id: stamp.entry_id,
      jv_no: stamp.jv_no,
      line_no: index + 1,
      date: stamp.date,
      fiscal_year: stamp.fiscal_year,
      period: stamp.period,
      is_opening: stamp.is_opening,
      code: item.code,
      account: item.account,
      party: item.party || null,
      dr_minor: item.dr_minor,
      cr_minor: item.cr_minor,
      currency: item.currency,
      ref: item.ref || entry.ref || null,
      narration: entry.narration || null,
      rate: item.rate !== undefined ? item.rate : undefined
    }; /* v1.8.1: the tax rate travels (SAF-T TaxInformation) */
  }

  /**
   * ⭐ accumulate(lines, pack?) → the period rows those lines make, at BOTH grains: (fy, period, code, party:null) and
   * (fy, period, code, party). What the server's one writer upserts; what lines-only mode is checked against.
   */
  function accumulate(lines, opt) {
    var pack = pack_(opt),
      map = Object.create(null),
      out = [];
    (lines || []).forEach(function (item, index) {
      var account = acct_(pack, item, 'line ' + (index + 1)),
        sides = sides_(item, 'line ' + (index + 1)),
        debit = sides[0],
        credit = sides[1];
      period_(item, 'line ' + (index + 1));
      var keys = [null];
      if (item.party) keys.push(String(item.party));
      keys.forEach(function (party) {
        var mapKey = item.fiscal_year + '|' + item.period + '|' + account.code + '|' + (party == null ? '' : party);
        var periodRow =
          map[mapKey] ||
          (map[mapKey] = out[out.push({ fiscal_year: item.fiscal_year, period: item.period, code: account.code, role: account.role, party: party, dr_minor: 0, cr_minor: 0 }) - 1]);
        periodRow.dr_minor = add_(periodRow.dr_minor, debit, mapKey);
        periodRow.cr_minor = add_(periodRow.cr_minor, credit, mapKey);
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
  function balanceAsAt(options) {
    var x = options || {},
      pack = pack_(x),
      packs = packsEngine_();
    if (day_(x.asOf) === null) throw refuse_("A balance needs asOf as YYYY-MM-DD — never the machine's today.");
    var fiscalYear = packs.fiscalYearOf(x.asOf, pack),
      period = packs.periodOf(x.asOf, pack),
      cutDay = day_(x.asOf);
    var totals = { accounts: Object.create(null), parties: Object.create(null) }; /* own keys only: a stored code or party of "__proto__" is just a key */
    var mode = readMode_(x, packs, pack, fiscalYear, period);
    /* stamped or refused: every line and row says its year and period (an unstamped one would be in no balance — H2) */
    var lines = stampedLines_(x.lines);
    /* ⭐ H1: period p comes from its LINES whenever any are given; from its ROW only when none are, or on prefer:'rows' */
    var linesOfP = lines.some(function (item) {
      return item.l.fiscal_year === fiscalYear && item.p === period;
    });
    var scope = {
      x: x,
      pack: pack,
      fiscalYear: fiscalYear,
      period: period,
      cutDay: cutDay,
      monthEnd: mode.monthEnd,
      useRows: mode.useRows,
      rowForP: mode.useRows && (mode.preferRows || !linesOfP),
      totals: totals
    };
    if (mode.useRows) addBalanceRows_(scope);
    addStampedLines_(scope, lines);
    addNetMinor_(totals);
    return { fiscal_year: fiscalYear, period: period, as_of: x.asOf, accounts: totals.accounts, parties: totals.parties };
  }
  /** how a balance is read: from period rows (balances given) or lines only, and whether period p comes from its row on purpose (prefer: 'rows', month-end asOf only) */
  function readMode_(x, packs, pack, fiscalYear, period) {
    var useRows = Array.isArray(x.balances),
      preferRows = x.prefer === 'rows';
    if (x.prefer != null && !preferRows) throw refuse_('Unknown prefer "' + String(x.prefer).slice(0, 20) + "\" — the only one is 'rows'.");
    var monthEnd = packs.periodRange(fiscalYear, period, pack).end === x.asOf;
    if (preferRows && !useRows) throw refuse_("prefer: 'rows' needs the period rows (balances).");
    if (preferRows && !monthEnd) throw refuse_("prefer: 'rows' needs asOf on the last day of its month (" + x.asOf + ' is not) — a row is a whole month.');
    return { useRows: useRows, preferRows: preferRows, monthEnd: monthEnd };
  }
  /** the given lines (empty ones dropped), each with its number and its period — an unstamped line is refused here */
  function stampedLines_(given) {
    return (given || []).filter(Boolean).map(function (item, index) {
      return { l: item, n: index + 1, p: period_(item, 'line ' + (index + 1)) };
    });
  }
  /** add one amount to the account's total and, when a party is given, to that party's total under the account */
  function addAmount_(totals, account, party, debit, credit, where) {
    if (party == null) {
      var accountTotal =
        totals.accounts[account.code] ||
        (totals.accounts[account.code] = {
          code: account.code,
          role: account.role,
          name: account.name,
          group: account.group,
          sch3: account.sch3,
          sch3_line: account.sch3_line,
          line: account.line,
          line_label: account.line_label /* A6 (v1.61.0): a pack whose statement field is `line` keeps it — its balance sheet had no lines */,
          statement: account.statement,
          term: account.term || null /* current | non_current from the pack, else null (unclassified) */,
          side: account.side,
          nature: account.nature,
          dr_minor: 0,
          cr_minor: 0
        });
      accountTotal.dr_minor = add_(accountTotal.dr_minor, debit, where);
      accountTotal.cr_minor = add_(accountTotal.cr_minor, credit, where);
    } else {
      var partyTotals = totals.parties[account.code] || (totals.parties[account.code] = Object.create(null)),
        partyTotal = partyTotals[party] || (partyTotals[party] = { dr_minor: 0, cr_minor: 0 });
      partyTotal.dr_minor = add_(partyTotal.dr_minor, debit, where);
      partyTotal.cr_minor = add_(partyTotal.cr_minor, credit, where);
    }
  }
  /** add every period row that counts (periods before p, and p itself when it is read from its row) */
  function addBalanceRows_(scope) {
    scope.x.balances.forEach(function (item, index) {
      if (!item) return;
      addBalanceRow_(scope, item, 'balance row ' + (index + 1));
    });
  }
  /** one period row: skipped when it is another year or a period the lines already cover; refused mid-month; else added at its own grain */
  function addBalanceRow_(scope, item, where) {
    var balancePeriod = period_(item, where);
    if (!rowCounts_(scope, item, balancePeriod)) return;
    if (balancePeriod === scope.period && !scope.monthEnd)
      throw refuse_(
        'A balance on ' +
          scope.x.asOf +
          ' needs the lines of its month: the rows hold period ' +
          scope.period +
          ' but none of its lines were given, and a row is a whole month.'
      );
    var account = acct_(scope.pack, item, where),
      sides = rowSides_(item, where);
    addAmount_(scope.totals, account, rowParty_(item), sides[0], sides[1], where);
  }
  /** does this period row count: its year, and an earlier period or period p itself when that is read from its row */
  function rowCounts_(scope, item, balancePeriod) {
    var skipped = item.fiscal_year !== scope.fiscalYear || !(balancePeriod < scope.period || (scope.rowForP && balancePeriod === scope.period));
    return !skipped;
  }
  /** a row's party, or null for the account's own total */
  function rowParty_(item) {
    return item.party == null || item.party === '' ? null : String(item.party);
  }
  /** add every stamped line that counts, at the account grain and again at the party grain */
  function addStampedLines_(scope, lines) {
    lines.forEach(function (item) {
      var line = item.l,
        where = 'line ' + item.n;
      if (!lineCounts_(scope, line, item.p, where)) return;
      var account = acct_(scope.pack, line, where),
        sides = sides_(line, where),
        debit = sides[0],
        credit = sides[1];
      addAmount_(scope.totals, account, null, debit, credit, where);
      if (line.party) addAmount_(scope.totals, account, String(line.party), debit, credit, where);
    });
  }
  /** does this line count in the balance: its year, its period (rows given: earlier periods are in the rows already), and its date up to asOf; a dateless line is refused */
  function lineCounts_(scope, line, linePeriod, where) {
    if (line.fiscal_year !== scope.fiscalYear) return false;
    if (scope.useRows ? linePeriod !== scope.period || scope.rowForP : linePeriod > scope.period) return false;
    if (linePeriod !== 0 && day_(line.date) === null) throw refuse_('No date (YYYY-MM-DD) at ' + where + '.');
    if (linePeriod === scope.period && linePeriod !== 0 && day_(line.date) > scope.cutDay) return false;
    return true;
  }
  /** each total's net (debit minus credit), at the account grain and the party grain */
  function addNetMinor_(totals) {
    Object.keys(totals.accounts).forEach(function (item) {
      totals.accounts[item].net_minor = totals.accounts[item].dr_minor - totals.accounts[item].cr_minor;
    });
    Object.keys(totals.parties).forEach(function (item) {
      Object.keys(totals.parties[item]).forEach(function (partyKey) {
        totals.parties[item][partyKey].net_minor = totals.parties[item][partyKey].dr_minor - totals.parties[item][partyKey].cr_minor;
      });
    });
  }

  /**
   * ⭐ trialBalance(options) → { as_of, rows[{ code, role, name, group, debit_minor, credit_minor }], total_dr_minor,
   * total_cr_minor, balanced } — each account's NET on its side, sorted by code; nil accounts left out.
   */
  function trialBalance(options) {
    var balance = balanceAsAt(options),
      rows = [],
      totalDebit = 0,
      totalCredit = 0;
    Object.keys(balance.accounts)
      .sort()
      .forEach(function (item) {
        var account = balance.accounts[item];
        if (!account.net_minor) return;
        var row = {
          code: account.code,
          role: account.role,
          name: account.name,
          group: account.group,
          debit_minor: account.net_minor > 0 ? account.net_minor : 0,
          credit_minor: account.net_minor < 0 ? -account.net_minor : 0
        };
        totalDebit += row.debit_minor;
        totalCredit += row.credit_minor;
        rows.push(row);
      });
    return { fiscal_year: balance.fiscal_year, as_of: balance.as_of, rows: rows, total_dr_minor: totalDebit, total_cr_minor: totalCredit, balanced: totalDebit === totalCredit };
  }

  /* the statement lines of one statement, each with its accounts, in the pack's order (pack.presentation.lines).
     TERM (v1.98.0): each line says its `term` (current | non_current) when every account on it carries the same one; a line whose accounts differ (an overdraft is current,
     a loan is not classified) is cut into one line per term, same label, so a sheet can group Current / Non-current without moving an amount. No term → null, never guessed. */
  function linesOf_(pack, accts, sign) {
    var presentation = pack.presentation,
      table = presentation.lines || {},
      lines = {},
      order = Object.keys(table),
      kept = accts.filter(function (item) {
        return sign(item);
      }),
      termsOf = {};
    kept.forEach(function (item) {
      var lineKey = presentation.lineOf(item),
        seen = termsOf[lineKey] || (termsOf[lineKey] = {});
      seen[item.term || ''] = true;
    });
    kept.forEach(function (item) {
      var amount = sign(item),
        lineKey = presentation.lineOf(item),
        lineDefinition = own_(table, lineKey) || {},
        mixed = Object.keys(termsOf[lineKey]).length > 1,
        slot = mixed ? lineKey + '|' + (item.term || '') : lineKey;
      var statementLine =
        lines[slot] ||
        (lines[slot] = { line: lineKey, label: lineDefinition.label || presentation.labelOf(item) || lineKey, side: lineDefinition.side || null, term: item.term || null, amount_minor: 0, accounts: [] });
      var entry = { code: item.code, role: item.role, name: item.name, amount_minor: amount };
      if (item.term) entry.term = item.term;
      if (item.parties != null) entry.parties = item.parties; /* v1.14.0: an advance line says how many parties it gathers */
      statementLine.amount_minor += amount;
      statementLine.accounts.push(entry);
    });
    var slots = Object.keys(lines),
      rank = function (slot) {
        var at = order.indexOf(lines[slot].line);
        return at < 0 ? order.length : at;
      };
    return slots
      .map(function (slot, at) {
        return { slot: slot, at: at };
      })
      .sort(function (p, q) {
        return rank(p.slot) - rank(q.slot) || p.at - q.at;
      })
      .map(function (item) {
        return lines[item.slot];
      });
  }

  /**
   * ⭐ profitAndLoss({ pack?, balances?, lines, from, to }) → { income[], expenses[], total_income_minor,
   * total_expenses_minor, profit_minor } by the pack's statement line. from and to in ONE fiscal year (a P&L never spans a close).
   */
  function profitAndLoss(options) {
    var x = options || {},
      pack = pack_(x),
      packs = packsEngine_();
    if (day_(x.from) === null || day_(x.to) === null) throw refuse_('A profit and loss needs from and to as YYYY-MM-DD.');
    if (day_(x.from) > day_(x.to)) throw refuse_('A profit and loss runs from a day to a later one (' + x.from + ' → ' + x.to + ').');
    if (packs.fiscalYearOf(x.from, pack) !== packs.fiscalYearOf(x.to, pack))
      throw refuse_('A profit and loss stays inside one fiscal year (' + x.from + ' → ' + x.to + ').');
    var moved = movedProfitAndLossAccounts_(x, pack, packs);
    var income = linesOf_(
      pack,
      moved.filter(function (item) {
        return item.nature === 'income';
      }),
      function (account) {
        return -account.mv_minor;
      }
    );
    var expenses = linesOf_(
      pack,
      moved.filter(function (item) {
        return item.nature !== 'income';
      }),
      function (account) {
        return account.mv_minor;
      }
    );
    var totalIncome = amountTotal_(income),
      totalExpenses = amountTotal_(expenses);
    return { from: x.from, to: x.to, income: income, expenses: expenses, total_income_minor: totalIncome, total_expenses_minor: totalExpenses, profit_minor: totalIncome - totalExpenses };
  }
  /** the profit-and-loss accounts with what each moved between from and to (the balance at to less the balance the day before from), sorted by code */
  function movedProfitAndLossAccounts_(x, pack, packs) {
    var end = balanceAsAt(Object.assign({}, x, { asOf: x.to })).accounts;
    var fyStart = packs.fyRange(packs.fiscalYearOf(x.from, pack), pack).start;
    var start = x.from === fyStart ? {} : balanceAsAt(Object.assign({}, x, { asOf: ymd_(day_(x.from) - 1) })).accounts;
    return Object.keys(end)
      .map(function (item) {
        var account = end[item],
          startFigures = start[item] || { dr_minor: 0, cr_minor: 0 };
        return Object.assign({}, account, { mv_minor: account.dr_minor - startFigures.dr_minor - (account.cr_minor - startFigures.cr_minor) });
      })
      .filter(function (item) {
        return item.statement === 'pl';
      })
      .sort(function (first, second) {
        return first.code < second.code ? -1 : 1;
      });
  }
  /** the sum of the statement lines' amounts */
  function amountTotal_(statementLines) {
    return statementLines.reduce(function (total, item) {
      return total + item.amount_minor;
    }, 0);
  }

  /**
   * v1.14.0 (R4, R8) — PRESENTATION ONLY, as the pack's statutory form asks (pack.presentation). The ledger lines are never changed; the
   * accounts the sheet is drawn from are re-sorted into the line the form puts them on, so both sides move by the same amount.
   *   R4  tax is netted per head (pack.presentation.taxNetting: an output ledger against its input ledger): a net DEBIT with the authority goes to the
   *       pack's creditLine; a net CREDIT stays one entry under its payableLine. Any other account of the pack's tax group (chart.kinds.tax) in debit moves
   *       to the creditLine the same way.
   *   R9  (v1.104.0) a cash or bank account in CREDIT is an overdraft: a liability on the pack's overdraft line (role bank_od), never a negative asset (no offsetting).
   *   R8  a party in CREDIT on debtors (an over-payment, an advance) is an ADVANCE FROM A CUSTOMER — a liability; a party in DEBIT
   *       on creditors is an ADVANCE TO A SUPPLIER — an asset. Trade receivables / payables are the sums of the parties the right way round.
   */
  function presented_(pack, balance, list) {
    var packs = packsEngine_(),
      presentation = pack.presentation,
      added = [],
      drop = Object.create(null);
    var creditLine = presentation.creditLine,
      payableLine = presentation.payableLine,
      taxGroup = pack.chart.kinds.tax;
    var state = { pack: pack, balance: balance, packs: packs, presentation: presentation, added: added, drop: drop, creditLine: creditLine, payableLine: payableLine };
    presentation.taxNetting.forEach(function (item) {
      netTaxHead_(state, item);
    });
    list.forEach(function (item) {
      if (item.group === taxGroup && !drop[item.code] && item.nature === 'liability' && item.net_minor > 0) {
        drop[item.code] = 1;
        added.push(presentation.placed(variant_(item, { nature: 'asset' }), creditLine));
      }
    });
    overdrawnToLiability_(state, list);
    settleAdvances_(state, 'debtors', 'customer_advance', presentation.labels.advancesFromCustomers, true);
    settleAdvances_(state, 'creditors', 'supplier_advance', presentation.labels.advancesToSuppliers, false);
    return list
      .filter(function (item) {
        return !drop[item.code];
      })
      .concat(added);
  }
  /**
   * R9 (EL-MONEY F6, batch 1128): a cash or bank account in CREDIT is an OVERDRAFT — a liability, never a negative asset (the standards do not let an asset be offset against a liability; the pack's chart
   * already names its overdraft ledger, role bank_od, on a current-liability line). Each account of the pack's cash / bank groups with a net credit moves, as its own entry, to that line; the
   * rest of the account's group is untouched. A pack with no bank_od ledger keeps the old shape. Presentation only: both sides move by the same amount, so the sheet still balances.
   */
  function overdrawnToLiability_(state, list) {
    var kinds = state.pack.chart.kinds,
      od = state.packs.accountOf(state.pack, 'bank_od');
    if (!od) return;
    list.forEach(function (item) {
      var cashOrBank = item.group && (item.group === kinds.bank || item.group === kinds.cash);
      if (item.nature !== 'asset' || !cashOrBank || state.drop[item.code] || !(item.net_minor < 0)) return;
      state.drop[item.code] = 1;
      state.added.push(state.presentation.placed(variant_(item, { role: 'bank_od', nature: 'liability', code: item.code, name: item.name + ' (overdrawn)', term: od.term || null /* VERIFY-TAX-01 row 33: the OVERDRAFT ledger's own term, not the cash account's */ }), state.presentation.lineOf(od)));
    });
  }
  /** a copy of `base` with the fields of `over` laid on it — the ledger's own rows are never changed */
  function variant_(base, over) {
    return Object.assign({}, base, over);
  }
  /** one tax head's output ledger netted against its input ledger: a net debit goes to the credit line, a net credit stays under the payable line */
  function netTaxHead_(state, item) {
    var head = taxHeadOf_(state, item);
    if (!head) return;
    state.drop[head.outputAccount.code] = 1;
    if (head.inputAccount) state.drop[head.inputAccount.code] = 1;
    var netMinor = (head.outputBalance ? head.outputBalance.net_minor : 0) + (head.inputBalance ? head.inputBalance.net_minor : 0);
    if (netMinor > 0) state.added.push(taxCreditEntry_(state, item, head, netMinor));
    else if (netMinor < 0) state.added.push(taxPayableEntry_(state, item, head, netMinor));
  }
  /** a tax head's accounts and their balances, or null when the head is not in the chart or has no balance */
  function taxHeadOf_(state, item) {
    /* A2 (v1.58.0): a no-credit head names no input ledger (input: null) — its output alone is the payable, placed on the payable line */
    var outputAccount = state.packs.accountOf(state.pack, item.output),
      inputAccount = item.input === null ? null : state.packs.accountOf(state.pack, item.input);
    if (!outputAccount || (item.input !== null && !inputAccount)) return null;
    var outputBalance = state.balance.accounts[outputAccount.code],
      inputBalance = inputAccount ? state.balance.accounts[inputAccount.code] : null;
    if (!outputBalance && !inputBalance) return null;
    return { outputAccount: outputAccount, inputAccount: inputAccount, outputBalance: outputBalance, inputBalance: inputBalance };
  }
  /** the net-debit entry of a tax head, placed on the pack's credit line as an asset */
  function taxCreditEntry_(state, item, head, netMinor) {
    return state.presentation.placed(
      variant_(head.inputBalance || head.outputBalance, {
        code: (head.inputAccount || head.outputAccount).code,
        role: item.creditRole,
        name: item.creditName,
        nature: 'asset',
        net_minor: netMinor
      }),
      state.creditLine
    );
  }
  /** the net-credit entry of a tax head, placed on the pack's payable line as a liability */
  function taxPayableEntry_(state, item, head, netMinor) {
    return state.presentation.placed(
      variant_(head.outputBalance || head.inputBalance, {
        code: head.outputAccount.code,
        role: item.payableRole,
        name: item.payableName,
        nature: 'liability',
        net_minor: netMinor
      }),
      state.payableLine
    );
  }
  /** a control account (debtors / creditors) kept for the trade parties the right way round, with the wrong-way parties moved to an advance line */
  function settleAdvances_(state, controlRole, advanceRole, advanceName, debtorSide) {
    var control = state.packs.accountOf(state.pack, controlRole),
      advanceAccount = state.packs.accountOf(state.pack, advanceRole),
      controlBalance = control ? state.balance.accounts[control.code] : null;
    if (!control || !advanceAccount || !controlBalance) return;
    var split = splitAdvances_(state.balance.parties[control.code] || {}, debtorSide);
    var rest = controlBalance.net_minor - split.mine - split.count; /* lines with no party stay where they are (controls names them) */
    state.drop[control.code] = 1;
    state.added.push(variant_(controlBalance, { net_minor: split.mine + rest }));
    if (split.count)
      state.added.push(
        state.presentation.placed(
          variant_(controlBalance, {
            role: advanceRole,
            code: advanceAccount.code,
            name: advanceAccount.name || advanceName,
            nature: debtorSide ? 'liability' : 'asset',
            net_minor: split.count,
            parties: split.index
          }),
          state.presentation.lineOf(advanceAccount)
        )
      );
  }
  /** the parties of a control account split into the wrong-way ones (an advance: their sum and how many) and the rest (their sum, `mine`) */
  function splitAdvances_(parts, debtorSide) {
    var mine = 0,
      count = 0,
      index = 0;
    Object.keys(parts).forEach(function (item) {
      var partyNet = parts[item].net_minor;
      if (debtorSide ? partyNet < 0 : partyNet > 0) {
        count += partyNet;
        index++;
      } else mine += partyNet;
    });
    return { mine: mine, count: count, index: index };
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
    if (!Object.prototype.hasOwnProperty.call(bases, basis))
      throw refuse_(
        'The entity basis "' + String(basis).slice(0, 40) + '" is not one the pack knows (' + Object.keys(bases).join(', ') + ') — never a default.'
      );
    return pack.presentation.ownerCapitalBases.indexOf(basis) >= 0;
  }
  function capitalAccount_(accts, profitToDate, labels) {
    var sum = function (roles) {
      return accts
        .filter(function (item) {
          return roles.indexOf(item.role) >= 0;
        })
        .reduce(function (total, item) {
          return total - item.net_minor;
        }, 0);
    };
    var opening = sum(['capital', 'retained']),
      draw = sum(['drawings']);
    if (!opening && !draw && !profitToDate) return null;
    var capitalEntry =
      accts.filter(function (item) {
        return item.role === 'capital';
      })[0] || accts[0];
    var lines = [
      { code: capitalEntry ? capitalEntry.code : null, role: 'capital', name: labels.openingCapital, amount_minor: opening },
      { code: null, role: profitToDate < 0 ? 'net_loss_to_date' : 'profit_to_date', name: profitToDate < 0 ? labels.netLossToDate : labels.netProfitToDate, amount_minor: profitToDate },
      {
        code:
          (
            accts.filter(function (item) {
              return item.role === 'drawings';
            })[0] || {}
          ).code || null,
        role: 'drawings',
        name: labels.drawings,
        amount_minor: draw
      }
    ];
    return { line: 'capital_account', label: labels.capitalAccount, side: 'cr', amount_minor: opening + profitToDate + draw, accounts: lines };
  }
  /**
   * ⭐ balanceSheet({ pack?, balances?, lines, asOf, entity_basis? }) → { assets[], liabilities[], total_assets_minor,
   * total_liabilities_minor, profit_to_date_minor, balanced } by the pack's statement line. The year's P&L so far (not yet carried
   * forward) is shown inside the pack's profit line as "Profit for the year to date".
   */
  function balanceSheet(options) {
    var x = options || {},
      pack = pack_(x),
      basis = capitalBasis_(pack, x.entity_basis),
      presentation = pack.presentation;
    var balance = balanceAsAt(x),
      all = sortedAccounts_(balance);
    var list = presented_(
      pack,
      balance,
      all.filter(function (item) {
        return item.statement === 'bs';
      })
    );
    var ownerCapital = basis ? list.filter(isCapitalRole_) : []; /* v1.16.0: gathered into ONE Capital account below */
    if (ownerCapital.length)
      list = list.filter(function (item) {
        return ownerCapital.indexOf(item) < 0;
      });
    var profitToDate = profitToDateOf_(all);
    var sheet = sheetLines_(pack, list);
    addCapitalOrProfit_(sheet.liabilities, basis, ownerCapital, profitToDate, presentation);
    var totalAssets = amountTotal_(sheet.assets),
      totalLiabilities = amountTotal_(sheet.liabilities);
    var parts = {
      assets: partsOf_(sheet.assets, presentation),
      liabilities: partsOf_(sheet.liabilities, presentation)
    };
    return {
      as_of: x.asOf,
      fiscal_year: balance.fiscal_year,
      assets: sheet.assets,
      liabilities: sheet.liabilities,
      total_assets_minor: totalAssets,
      total_liabilities_minor: totalLiabilities,
      terms: { assets: parts.assets, liabilities: parts.liabilities },
      profit_to_date_minor: profitToDate,
      balanced: totalAssets === totalLiabilities
    };
  }
  /**
   * TERM (v1.98.0): which part of the statement each line belongs to — sets `part` on every line ('current' | 'non_current' from the pack's term, 'equity' for the owner's funds, null when
   * the pack states no term: shown unclassified, never guessed) and returns the subtotals { current_minor, non_current_minor, equity_minor, unclassified_minor } the sheet prints.
   */
  function partsOf_(lines, presentation) {
    var sums = { current_minor: 0, non_current_minor: 0, equity_minor: 0, unclassified_minor: 0 };
    lines.forEach(function (item) {
      var equity = item.side === 'equity' || item.line === 'capital_account' || item.line === presentation.profitLine;
      item.part = equity ? 'equity' : item.term || null;
      sums[(item.part || 'unclassified') + '_minor'] += item.amount_minor;
    });
    return sums;
  }
  /** the accounts of a balance in code order */
  function sortedAccounts_(balance) {
    return Object.keys(balance.accounts)
      .sort()
      .map(function (item) {
        return balance.accounts[item];
      });
  }
  /** does this account belong to the owner's capital (capital, retained, drawings) */
  function isCapitalRole_(account) {
    return CAPITAL_ROLES_.indexOf(account.role) >= 0;
  }
  /** the year's profit so far: minus the net of every profit-and-loss account (a net credit is a profit) */
  function profitToDateOf_(accounts) {
    return accounts
      .filter(function (item) {
        return item.statement === 'pl';
      })
      .reduce(function (total, item) {
        return total - item.net_minor;
      }, 0);
  }
  /** the balance sheet's asset lines and liability lines by the pack's statement lines */
  function sheetLines_(pack, list) {
    var assets = linesOf_(
      pack,
      list.filter(function (item) {
        return item.nature === 'asset';
      }),
      function (account) {
        return account.net_minor;
      }
    );
    var liabilities = linesOf_(
      pack,
      list.filter(function (item) {
        return item.nature !== 'asset';
      }),
      function (account) {
        return -account.net_minor;
      }
    );
    return { assets: assets, liabilities: liabilities };
  }
  /** put the profit to date on the liabilities: as the one Capital account when the entity basis asks for it, else inside the pack's profit line */
  function addCapitalOrProfit_(liabilities, basis, ownerCapital, profitToDate, presentation) {
    if (basis) {
      var capLine = capitalAccount_(ownerCapital, profitToDate, presentation.labels);
      if (capLine) liabilities.unshift(capLine);
    } else if (profitToDate) addProfitLine_(liabilities, profitToDate, presentation);
  }
  /** add the year's profit to date to the pack's profit line of the liabilities, making that line when it is not there yet */
  function addProfitLine_(liabilities, profitToDate, presentation) {
    var profitLine = liabilities.find(function (item) {
      return item.line === presentation.profitLine;
    });
    if (!profitLine) {
      profitLine = { line: presentation.profitLine, label: (presentation.lines[presentation.profitLine] || {}).label || presentation.labels.profitLine, side: 'cr', amount_minor: 0, accounts: [] };
      liabilities.push(profitLine);
    }
    profitLine.amount_minor += profitToDate;
    profitLine.accounts.push({ code: null, role: 'profit_to_date', name: presentation.labels.profitToDate, amount_minor: profitToDate });
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
  function tradingAccount(options) {
    var x = options || {},
      pack = pack_(x),
      packs = packsEngine_(),
      kinds = pack.chart.kinds,
      labels = pack.presentation.labels;
    if (day_(x.from) === null || day_(x.to) === null) throw refuse_('A trading account needs from and to as YYYY-MM-DD.');
    if (day_(x.from) > day_(x.to)) throw refuse_('A trading account runs from a day to a later one (' + x.from + ' → ' + x.to + ').');
    var range = tradingRange_(x, pack, packs);
    var plAccounts = plMovements_(range.end, range.start);
    var groups = tradingGroups_(plAccounts, kinds);
    var stock = stockBalances_(x, pack, kinds, range);
    refuseStockOutside_(stock, groups.inventoryChanges);
    var figures = tradingFigures_(groups, stock.opening, stock.closing);
    refuseUnlessProfitMatches_(figures.net_profit_minor, plAccounts);
    var stockAccount = stock.keys.length ? range.end[stock.keys[0]] : { code: null };
    return Object.assign({ from: x.from, to: x.to }, figures, { lines: tradingLines_(groups, labels, stockAccount, stock) });
  }
  /** the balances a trading account is drawn from: at `to`, and the day before `from` (none on the year's first day); a range over two fiscal years is refused */
  function tradingRange_(x, pack, packs) {
    var fiscalYear = packs.fiscalYearOf(x.from, pack);
    if (fiscalYear !== packs.fiscalYearOf(x.to, pack)) throw refuse_('A trading account stays inside one fiscal year (' + x.from + ' → ' + x.to + ').');
    var end = balanceAsAt(Object.assign({}, x, { asOf: x.to })).accounts;
    var fyStart = packs.fyRange(fiscalYear, pack).start,
      atStart = x.from === fyStart;
    var start = atStart ? {} : balanceAsAt(Object.assign({}, x, { asOf: ymd_(day_(x.from) - 1) })).accounts;
    return { fiscalYear: fiscalYear, end: end, start: start, atStart: atStart };
  }
  /** how much one account moved between the two balances (debit movement less credit movement) */
  function movementOf_(end, start, accountCode) {
    var endRow = end[accountCode],
      startRow = start[accountCode] || { dr_minor: 0, cr_minor: 0 };
    return endRow.dr_minor - startRow.dr_minor - (endRow.cr_minor - startRow.cr_minor);
  }
  /** the profit-and-loss accounts at the end balance, each with its movement (mv_minor), in code order */
  function plMovements_(end, start) {
    return Object.keys(end)
      .filter(function (item) {
        return end[item].statement === 'pl';
      })
      .sort()
      .map(function (accountCode) {
        var endRow = end[accountCode];
        return {
          code: endRow.code,
          role: endRow.role,
          name: endRow.name,
          group: endRow.group,
          nature: endRow.nature,
          statement: endRow.statement,
          mv_minor: movementOf_(end, start, accountCode)
        };
      });
  }
  /** the movement of a list of accounts, each times `sign` */
  function movementSum_(list, sign) {
    return list.reduce(function (total, item) {
      return total + sign * item.mv_minor;
    }, 0);
  }
  /** the accounts in a chart group, less the roles in `except` */
  function inGroup_(accounts, group, except) {
    return accounts.filter(function (item) {
      return item.group === group && (except || []).indexOf(item.role) < 0;
    });
  }
  /** the accounts with a role */
  function withRole_(accounts, role) {
    return accounts.filter(function (item) {
      return item.role === role;
    });
  }
  /** the profit-and-loss accounts sorted into the trading account's heads: sales, returns, direct and indirect income and expenses, stock movement */
  function tradingGroups_(plAccounts, kinds) {
    /* A1 (v1.59.0): a chart whose direct income IS its sales group (or direct expense its purchases group) counts that group ONCE — six packs
     (AU AE SG MY US JP) names one group for both, and the trading account showed every sale twice */
    var sales = inGroup_(plAccounts, kinds.sales, ['sales_returns']),
      sret = withRole_(plAccounts, 'sales_returns'),
      dinc = kinds.directIncome === kinds.sales ? [] : inGroup_(plAccounts, kinds.directIncome);
    var purch = inGroup_(plAccounts, kinds.purchases, ['purchase_returns', 'changes_in_inventories']),
      pret = withRole_(plAccounts, 'purchase_returns'),
      dexp = kinds.directExpense === kinds.purchases ? [] : inGroup_(plAccounts, kinds.directExpense);
    var inventoryChanges = withRole_(plAccounts, 'changes_in_inventories'),
      iinc = inGroup_(plAccounts, kinds.indirectIncome),
      iexp = inGroup_(plAccounts, kinds.indirectExpense);
    return { sales: sales, sret: sret, dinc: dinc, purch: purch, pret: pret, dexp: dexp, inventoryChanges: inventoryChanges, iinc: iinc, iexp: iexp };
  }
  /** the stock accounts' keys, the closing stock (from the balance at `to`) and the opening stock (from the day before `from`; period 0 on the year's first day) */
  function stockBalances_(x, pack, kinds, range) {
    var end = range.end,
      start = range.start;
    var keys = Object.keys(end).filter(function (item) {
      return end[item].group === kinds.stock;
    });
    var closing = keys.reduce(function (total, item) {
        return total + end[item].net_minor;
      }, 0),
      opening = 0;
    if (range.atStart) opening = openingStockFromRows_(x, pack, kinds, range.fiscalYear);
    else
      opening = Object.keys(start)
        .filter(function (item) {
          return start[item].group === kinds.stock;
        })
        .reduce(function (total, item) {
          return total + start[item].net_minor;
        }, 0);
    return { keys: keys, closing: closing, opening: opening };
  }
  /** the opening stock on the year's first day: the stock accounts' own period-0 rows (or lines), debit less credit */
  function openingStockFromRows_(x, pack, kinds, fiscalYear) {
    var opening = 0;
    var rowsSrc = Array.isArray(x.balances) ? x.balances : x.lines || [];
    rowsSrc.filter(Boolean).forEach(function (item, index) {
      if (!isOwnOpeningRow_(item, fiscalYear)) return;
      var where = 'opening row ' + (index + 1);
      var account = acct_(pack, item, where);
      if (account.group !== kinds.stock) return;
      var openingSides = Array.isArray(x.balances) ? rowSides_(item, where) : sides_(item, where);
      opening = add_(opening, openingSides[0] - openingSides[1], 'opening stock');
    });
    return opening;
  }
  /** is this row of the year's period 0 and the account's own (no party) */
  function isOwnOpeningRow_(item, fiscalYear) {
    return !(item.fiscal_year !== fiscalYear || Number(item.period) !== 0 || (item.party != null && item.party !== ''));
  }
  /** refused when Stock-in-hand moved outside the stock-movement account: opening less closing must be exactly what changes_in_inventories moved */
  function refuseStockOutside_(stock, inventoryChanges) {
    var moved = movementSum_(inventoryChanges, 1),
      outside = stock.opening - stock.closing - moved;
    if (outside)
      throw refuse_(
        'Stock-in-hand moved by ' +
          Math.abs(outside) +
          ' minor units outside closing stock — the Trading account cannot show opening and closing stock truthfully.'
      );
  }
  /** the trading account's figures: sales to gross profit, then the indirect items to net profit (minor units, keyed as the answer carries them) */
  function tradingFigures_(groups, opening, closing) {
    var netSales = movementSum_(groups.sales, -1) - movementSum_(groups.sret, 1),
      directIncome = movementSum_(groups.dinc, -1);
    var purchases = movementSum_(groups.purch, 1),
      purchaseReturns = movementSum_(groups.pret, -1),
      directExpenses = movementSum_(groups.dexp, 1);
    var cogs = opening + purchases - purchaseReturns + directExpenses - closing,
      gross = netSales + directIncome - cogs;
    var indirectIncome = movementSum_(groups.iinc, -1),
      indirectExpenses = movementSum_(groups.iexp, 1),
      netProfit = gross + indirectIncome - indirectExpenses;
    return {
      sales_minor: movementSum_(groups.sales, -1),
      sales_returns_minor: movementSum_(groups.sret, 1),
      net_sales_minor: netSales,
      direct_income_minor: directIncome,
      opening_stock_minor: opening,
      purchases_minor: purchases,
      purchase_returns_minor: purchaseReturns,
      direct_expenses_minor: directExpenses,
      closing_stock_minor: closing,
      cost_of_goods_sold_minor: cogs,
      gross_profit_minor: gross,
      indirect_income_minor: indirectIncome,
      indirect_expenses_minor: indirectExpenses,
      net_profit_minor: netProfit
    };
  }
  /** refused when the trading account's net profit is not the profit and loss's: an account sits outside the chart's direct / indirect groups */
  function refuseUnlessProfitMatches_(netProfit, plAccounts) {
    var plProfit = plAccounts.reduce(function (total, item) {
      return total - item.mv_minor;
    }, 0);
    if (netProfit !== plProfit)
      throw refuse_(
        "The trading account's net profit (" +
          netProfit +
          ") is not the profit and loss's (" +
          plProfit +
          ") — an account is outside the chart's direct / indirect groups."
      );
  }
  /** the accounts of a trading-account head as rows (the moved ones only), each amount times `sign` */
  function movementRows_(list, sign) {
    return list
      .filter(function (item) {
        return item.mv_minor;
      })
      .map(function (item) {
        return { code: item.code, role: item.role, name: item.name, amount_minor: sign * item.mv_minor };
      });
  }
  /** the one row an opening or closing stock amount makes (none when it is nil), on the first stock account */
  function stockRow_(stockAccount, role, name, amount) {
    return amount ? [{ code: stockAccount.code, role: role, name: name, amount_minor: amount }] : [];
  }
  /** the four statement blocks: the trading account's debit and credit sides, then the profit and loss's indirect expenses and income */
  function tradingLines_(groups, labels, stockAccount, stock) {
    return {
      trading_dr: stockRow_(stockAccount, 'opening_stock', labels.openingStock, stock.opening).concat(
        movementRows_(groups.purch, 1),
        movementRows_(groups.sret, 1),
        movementRows_(groups.dexp, 1)
      ),
      trading_cr: movementRows_(groups.sales, -1).concat(
        movementRows_(groups.pret, -1),
        movementRows_(groups.dinc, -1),
        stockRow_(stockAccount, 'closing_stock', labels.closingStock, stock.closing)
      ),
      pl_dr: movementRows_(groups.iexp, 1),
      pl_cr: movementRows_(groups.iinc, -1)
    };
  }

  /**
   * ⭐ partyStatement({ pack?, balances?, lines, party, code?, from, to }) → { opening_minor, rows[{ date, jv_no, ref,
   * narration, dr_minor, cr_minor, running_minor }], closing_minor } — one party on one control account (default: the
   * party's own lines on debtors, or creditors when it has none). Running balance is dr − cr (a supplier's is negative).
   * `lines`: every line of the months the range touches (the opening reads the rows before them).
   */
  function partyStatement(options) {
    var x = options || {},
      pack = pack_(x),
      packs = packsEngine_(),
      party = String(x.party || '');
    if (!party) throw refuse_('A statement names its party.');
    if (day_(x.from) === null || day_(x.to) === null) throw refuse_('A statement needs from and to as YYYY-MM-DD.');
    if (day_(x.from) > day_(x.to)) throw refuse_('A statement runs from a day to a later one (' + x.from + ' → ' + x.to + ').');
    var code = statementCode_(x, pack, packs, party);
    var opening = statementOpening_(x, pack, packs, party, code);
    var statement = statementRows_(x, pack, party, code, opening);
    return { party: party, code: code, from: x.from, to: x.to, opening_minor: opening, rows: statement.rows, closing_minor: statement.running };
  }
  /** the control account a statement is on: the one asked for, else debtors (or creditors when the party has lines there and none on debtors) */
  function statementCode_(x, pack, packs, party) {
    var code = x.code ? acct_(pack, { code: x.code }, 'statement').code : null;
    if (!code) {
      var mine = (x.lines || []).filter(function (item) {
        return item && String(item.party) === party;
      });
      var debtorsCode = packs.accountOf(pack, 'debtors').code,
        creditorsCode = packs.accountOf(pack, 'creditors').code;
      code =
        mine.some(function (item) {
          return acct_(pack, item, 'statement').code === debtorsCode;
        }) || !mine.length
          ? debtorsCode
          : creditorsCode;
    }
    return code;
  }
  /** the party's balance before `from` in its fiscal year — period 0 (brought forward, opening entries) included */
  function statementOpening_(x, pack, packs, party, code) {
    var fiscalYear = packs.fiscalYearOf(x.from, pack),
      prev = ymd_(day_(x.from) - 1);
    if (packs.fiscalYearOf(prev, pack) === fiscalYear) {
      var partyBalance = (balanceAsAt(Object.assign({}, x, { asOf: prev })).parties[code] || {})[party];
      return partyBalance ? partyBalance.net_minor : 0;
    }
    return openingFromRows_(x, pack, party, code, fiscalYear);
  }
  /** from = the year's first day: the party's period-0 rows (or lines) on the account, debit less credit */
  function openingFromRows_(x, pack, party, code, fiscalYear) {
    var opening = 0;
    var list = Array.isArray(x.balances) ? x.balances : x.lines || [];
    list
      .filter(function (row) {
        return isPartyOpeningRow_(row, pack, party, code, fiscalYear);
      })
      .forEach(function (item) {
        var sides = rowSides_(item, 'opening');
        opening = add_(opening, sides[0] - sides[1], 'opening');
      });
    return opening;
  }
  /** is this a period-0 row of the party on the account in that year */
  function isPartyOpeningRow_(row, pack, party, code, fiscalYear) {
    return row && row.fiscal_year === fiscalYear && Number(row.period) === 0 && String(row.party) === party && acct_(pack, row, 'opening').code === code;
  }
  /** the statement's rows: the party's lines on the account between from and to, in date order, each with the running balance (debit less credit) */
  function statementRows_(x, pack, party, code, opening) {
    var fromDay = day_(x.from),
      toDay = day_(x.to),
      running = opening,
      rows = [];
    (x.lines || [])
      .filter(function (item) {
        return inStatementRange_(item, pack, party, code, fromDay, toDay);
      })
      .sort(byDateThenEntry_)
      .forEach(function (item) {
        var row = statementRow_(item, running);
        running = row.running_minor;
        rows.push(row);
      });
    return { rows: rows, running: running };
  }
  /** is this a dated (not period-0) line of the party on the account, between the two days */
  function inStatementRange_(item, pack, party, code, fromDay, toDay) {
    if (!item || String(item.party) !== party || Number(item.period) === 0 || acct_(pack, item, 'statement').code !== code) return false;
    var lineDay = day_(item.date);
    return lineDay >= fromDay && lineDay <= toDay;
  }
  /** order lines by date, then period, then journal number (or entry id) */
  function byDateThenEntry_(first, second) {
    return (
      day_(first.date) - day_(second.date) ||
      Number(first.period) - Number(second.period) ||
      String(first.jv_no || first.entry_id || '').localeCompare(String(second.jv_no || second.entry_id || ''))
    );
  }
  /** one statement row: the line's sides, and the balance running on from the one before it */
  function statementRow_(item, runningBefore) {
    var sides = sides_(item, 'a line of ' + (item.jv_no || item.entry_id || item.date)),
      debit = sides[0],
      credit = sides[1];
    var running = add_(runningBefore, debit - credit, 'statement');
    return {
      date: item.date,
      jv_no: item.jv_no || null,
      entry_id: item.entry_id != null ? item.entry_id : null,
      ref: item.ref || null,
      narration: item.narration || null,
      is_opening: !!item.is_opening,
      dr_minor: debit,
      cr_minor: credit,
      running_minor: running
    };
  }

  /**
   * ⭐ AGEING BUCKETS — the pack's (pack.presentation.ageing): each side's list of [bucket, [from, to] months] in order, the first being "not due". Age runs from the DUE date
   * (the transaction date where there is none).
   * ⚠️ THE BOUNDARY (a convention, stated for the accountant — critic L7): a bucket INCLUDES its upper edge. A document exactly at an edge on asOf stays in the lower bucket; the
   * day after it is in the next. The exported constants are the DEFAULT pack's buckets, unchanged.
   */
  const AGE_DEFAULT_ = (function () {
    var regulation = regulationEngine_(),
      defaultPack = regulation && regulation.packFor(regulation.DEFAULT);
    if (!defaultPack)
      throw new Error(
        'ledger.js needs regulation.js (CBRegulation, with the India pack) loaded before it — add the regulation scripts ahead of this one on the page; see the CHANGELOG, v1.28.0.'
      );
    return (defaultPack.presentation && defaultPack.presentation.ageing) || { receivable: [], payable: [] };
  })();
  const AGE_RECEIVABLE = AGE_DEFAULT_.receivable;
  const AGE_PAYABLE = AGE_DEFAULT_.payable;

  /**
   * ⭐ THE FOLLOW-UP SET (FIN-72, v1.76.0) — ageing(…, { set: 'followup' }): days past the DUE date, not months, and no pack: no country's pack names
   * 30/60/90 days, so this set is neutral. [key, [from, to] days late]; the first is "not due yet" (late < 0). DUE TODAY (late 0) is d0_30 — the default months set
   * keeps a bill due today "not due"; the two are deliberately different (a collector chases a bill on its due day). Upper edges are inclusive; d90_plus is open.
   * ⚠️ A bill with no due date ages from its date, here as the months set does, so the CALLER resolves the credit days into due_date first (api books-engines.dues);
   * where there are none the follow-up ages from the bill date and says so itself: that is a different figure from the pack's, on purpose.
   */
  const AGE_FOLLOWUP = [['not_due', [null, null]], ['d0_30', [0, 30]], ['d31_60', [31, 60]], ['d61_90', [61, 90]], ['d90_plus', [91, null]]];
  /** ⭐ THE MSME SET (RC11, Athi 28 Nov 2026): ageing(…, { set: 'msme' }) — days since the BILL date (`date`, never the due date) for India's MSMED s.15 45-day rule; upper edges inclusive, a future-dated bill is in the first. */
  const AGE_MSME = [['0_30', [null, 30]], ['31_45', [31, 45]], ['46_60', [46, 60]], ['60_plus', [61, null]]];
  const AGE_SETS_ = { followup: { receivable: AGE_FOLLOWUP, payable: AGE_FOLLOWUP }, msme: { receivable: AGE_MSME, payable: AGE_MSME, basis: 'date' } };

  /** the bucket of a document by whole DAYS since `from` (the due date, or the bill date for the MSME set); a set whose first bucket has no upper edge opens with 'not due' */
  function dayKey_(buckets, from, today) {
    var late = today - day_(from),
      start = buckets[0][1][1] === null ? 1 : 0;
    if (late < 0 && start) return buckets[0][0];
    for (var bucketIndex = start; bucketIndex < buckets.length; bucketIndex++) if (buckets[bucketIndex][1][1] === null || late <= buckets[bucketIndex][1][1]) return buckets[bucketIndex][0];
    return buckets[buckets.length - 1][0];
  }

  /** the bucket of a document due on `from`, by MONTHS late (the pack's set): overdue by (from, from + hi months] lands in that bucket */
  function monthKey_(buckets, from, today) {
    if (!(day_(from) < today)) return 'not_due';
    for (var bucketIndex = 1; bucketIndex < buckets.length; bucketIndex++) {
      var upperMonths = buckets[bucketIndex][1][1];
      if (upperMonths === null || today <= day_(addMonths_(from, upperMonths))) return buckets[bucketIndex][0];
    }
    return buckets[buckets.length - 1][0];
  }

  /** the bucket list and the way to place a document: a named set's days, else the pack's months */
  function ageSetFor_(opt, side) {
    var name = opt && opt.set;
    if (name != null) return namedAgeSet_(name, side);
    return packAgeSet_(opt, side);
  }
  /** a named set's buckets (days late), placed by dayKey_; an unknown name is refused */
  function namedAgeSet_(name, side) {
    if (!AGE_SETS_[name]) throw refuse_('Ageing has no set named "' + name + '".');
    return { B: AGE_SETS_[name][side === 'payable' ? 'payable' : 'receivable'], keyOf: dayKey_, basis: AGE_SETS_[name].basis };
  }
  /** the regulation pack's buckets (months late), placed by monthKey_; a pack with none is refused */
  function packAgeSet_(opt, side) {
    var regulation = regulationEngine_(),
      pack = (opt && opt.pack) || (regulation ? regulation.resolve(opt) : null),
      ageingBuckets = pack && pack.presentation && pack.presentation.ageing;
    if (!ageingBuckets) throw refuse_('The regulation pack names no ageing buckets.');
    return { B: side === 'payable' ? ageingBuckets.payable : ageingBuckets.receivable, keyOf: monthKey_ };
  }

  /**
   * ⭐⭐ ageing(docs, asOf, side?, { pack?, country?, set? }) → { as_of, side, buckets: { undisputed:{…}, disputed:{…} }, by_party, total_minor,
   * unapplied_minor } — docs are receivables.outstanding(items).by_ref values (or any { ref, party, due_date, date,
   * outstanding_minor, disputed }). A negative document (money not yet applied) is not aged: it is unapplied_minor.
   * set: 'followup' (v1.76.0) ages the SAME documents in days past due (AGE_FOLLOWUP) instead of the pack's months; without `set` the answer is the pack's, unchanged.
   */
  function ageing(docs, asOf, side, opt) {
    var today = day_(asOf);
    if (today === null) throw refuse_("Ageing needs asOf as YYYY-MM-DD — never the machine's today.");
    var ageSet = ageSetFor_(opt, side),
      buckets = ageSet.B;
    var aged = {
      out: { undisputed: zeroBuckets_(buckets), disputed: zeroBuckets_(buckets) },
      perParty: Object.create(null),
      total: 0,
      unapplied: 0 /* a party id of "__proto__" is just a key */
    };
    var list = Array.isArray(docs)
      ? docs
      : Object.keys(docs || {}).map(function (item) {
          return docs[item];
        });
    list.forEach(function (item, index) {
      ageDocument_(aged, ageSet, today, item, index);
    });
    return {
      as_of: asOf,
      side: side === 'payable' ? 'payable' : 'receivable',
      buckets: aged.out,
      by_party: aged.perParty,
      total_minor: aged.total,
      unapplied_minor: aged.unapplied,
      bucket_keys: buckets.map(function (item) {
        return item[0];
      })
    };
  }
  /** a count of nil for every bucket key */
  function zeroBuckets_(buckets) {
    var counts = {};
    buckets.forEach(function (item) {
      counts[item[0]] = 0;
    });
    return counts;
  }
  /** a document's reference for a message: its ref, else its place in the list */
  function docRef_(item, index) {
    return item.ref || index + 1;
  }
  /** age one document: a negative one is unapplied money, a nil one is skipped, the rest is added to its bucket and to its party */
  function ageDocument_(aged, ageSet, today, item, index) {
    if (!item) return;
    var amount = int_(item.outstanding_minor || 0, 'document ' + docRef_(item, index));
    if (amount < 0) {
      aged.unapplied += amount;
      return;
    }
    if (!amount) return;
    var from = ageSet.basis === 'date' ? item.date || item.due_date : item.due_date || item.date;
    if (day_(from) === null) throw refuse_('Document ' + docRef_(item, index) + ' has no due date or date to age from.');
    var key = ageSet.keyOf(ageSet.B, from, today);
    var bucket = item.disputed ? aged.out.disputed : aged.out.undisputed;
    bucket[key] += amount;
    aged.total += amount;
    addToPartyRow_(aged, ageSet.B, item, key, amount);
  }
  /** add an aged amount to its party's row (made when the party first appears) */
  function addToPartyRow_(aged, buckets, item, key, amount) {
    var partyRow = aged.perParty[item.party] || (aged.perParty[item.party] = { undisputed: zeroBuckets_(buckets), disputed: zeroBuckets_(buckets), total_minor: 0 });
    partyRow[item.disputed ? 'disputed' : 'undisputed'][key] += amount;
    partyRow.total_minor += amount;
  }

  /**
   * ⭐⭐ carryForward({ pack?, balances?, lines, fiscal_year }) → { from, to, rows, retained_minor, balanced } — the period-0
   * rows of the NEXT year: every balance-sheet account (and account+party) at its closing; every P&L account's net rolled
   * into role `retained` as one balance row — no journal entry.
   * ⚠️ v1.8.1 (critic M8, SPEC-books-v2 §0 "Suspense must be nil to close"): when role `suspense` (2900) is not nil the year
   * is NOT carried — { ok: false, why, suspense_minor (dr − cr), rows: [] }. The year-close route blocks on it. ok: true otherwise.
   */
  function carryForward(options) {
    var x = options || {},
      pack = pack_(x),
      packs = packsEngine_();
    var yearRange = packs.fyRange(x.fiscal_year, pack);
    if (!yearRange) throw refuse_('Unknown fiscal year "' + x.fiscal_year + '".');
    var balance = balanceAsAt(Object.assign({}, x, { asOf: yearRange.end }));
    var next = packs.fiscalYearOf(ymd_(day_(yearRange.end) + 1), pack),
      retainedAccount = packs.accountOf(pack, 'retained');
    var suspenseAccount = packs.accountOf(pack, 'suspense'),
      susNet = suspenseAccount && balance.accounts[suspenseAccount.code] ? balance.accounts[suspenseAccount.code].net_minor : 0;
    if (susNet) return suspenseNotNil_(x, next, suspenseAccount, susNet);
    var carry = carriedBalances_(balance, next, retainedAccount);
    pushCarryRow_(carry, retainedAccount, null, carry.retNet + carry.profitLossNet);
    return {
      ok: true,
      from: x.fiscal_year,
      to: next,
      rows: carry.rows,
      retained_minor: -(carry.retNet + carry.profitLossNet),
      profit_minor: -carry.profitLossNet,
      balanced: carry.debitTotal === carry.creditTotal,
      suspense_minor: 0
    };
  }
  /** the answer when Suspense is not nil: the year is not carried — no rows, and the reason says how much Suspense holds */
  function suspenseNotNil_(x, next, suspenseAccount, susNet) {
    return {
      ok: false,
      from: x.fiscal_year,
      to: next,
      rows: [],
      balanced: false,
      suspense_minor: susNet,
      why:
        'The year cannot close: Suspense (' +
        suspenseAccount.code +
        ') is not nil — it holds ' +
        Math.abs(susNet) +
        ' minor units ' +
        (susNet > 0 ? 'debit' : 'credit') +
        '. Clear the opening difference first.'
    };
  }
  /** the next year's period-0 rows from the closing balance, with the profit-and-loss net and the retained net to roll into the retained row */
  function carriedBalances_(balance, next, retainedAccount) {
    var carry = { next: next, rows: [], profitLossNet: 0, retNet: 0, debitTotal: 0, creditTotal: 0 };
    Object.keys(balance.accounts)
      .sort()
      .forEach(function (item) {
        carryAccount_(carry, balance, item, retainedAccount);
      });
    return carry;
  }
  /** one account's closing: a profit-and-loss or retained account is rolled into the retained row, any other is carried at both grains */
  function carryAccount_(carry, balance, item, retainedAccount) {
    var account = balance.accounts[item];
    if (account.statement === 'pl') {
      carry.profitLossNet += account.net_minor;
      return;
    }
    if (account.code === retainedAccount.code) {
      carry.retNet += account.net_minor;
      return;
    }
    pushCarryRow_(carry, account, null, account.net_minor);
    Object.keys(balance.parties[item] || {})
      .sort()
      .forEach(function (partyKey) {
        pushCarryRow_(carry, account, partyKey, balance.parties[item][partyKey].net_minor);
      });
  }
  /** add one period-0 row of the next year (nothing when the net is nil); the account-grain rows add up to the debit and credit totals */
  function pushCarryRow_(carry, account, party, netMinor) {
    if (!netMinor) return;
    var row = { fiscal_year: carry.next, period: 0, code: account.code, role: account.role, party: party, dr_minor: netMinor > 0 ? netMinor : 0, cr_minor: netMinor < 0 ? -netMinor : 0 };
    carry.rows.push(row);
    if (party == null) {
      carry.debitTotal += row.dr_minor;
      carry.creditTotal += row.cr_minor;
    }
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
  function controls(options) {
    var x = options || {},
      pack = pack_(x),
      packs = packsEngine_(),
      mismatches = [];
    var check = { pack: pack, packs: packs, mismatches: mismatches };
    var good = wellFormed_(check, x.lines, 'lines'),
      y = Object.assign({}, x, {
        lines: good.map(function (item) {
          return item.l;
        })
      });
    var balance = balanceAsAt(y);
    ['debtors', 'creditors'].forEach(function (role) {
      checkPartyControl_(check, balance, role);
    });
    checkLineSums_(check, good);
    var trial = trialBalance(y);
    if (!trial.balanced) mismatches.push({ name: 'trial_balance', dr_minor: trial.total_dr_minor, cr_minor: trial.total_cr_minor });
    if (Array.isArray(x.balances) && Array.isArray(x.recompute_lines)) checkRowsAgainstLines_(check, x);
    return {
      ok: mismatches.length === 0,
      as_of: x.asOf,
      mismatches: mismatches,
      checked: ['line_malformed', 'debtors_control', 'creditors_control', 'party_missing', 'day_unbalanced', 'entry_unbalanced', 'trial_balance'].concat(
        x.recompute_lines ? ['rows_vs_lines'] : []
      )
    };
  }
  /** M3: the given lines that read cleanly, each with its number; a malformed stored line is NAMED here (balanceAsAt alone would refuse the whole read) and kept out of the sums */
  function wellFormed_(check, list, where) {
    var nestedGood = [];
    (list || []).forEach(function (item, index) {
      if (!item) return;
      try {
        period_(item, 'line ' + (index + 1));
        sides_(item, 'line ' + (index + 1));
        acct_(check.pack, item, 'line ' + (index + 1));
        nestedGood.push({ l: item, n: index + 1 });
      } catch (e) {
        check.mismatches.push({ name: 'line_malformed', in: where, line: index + 1, entry_id: item.entry_id != null ? item.entry_id : null, why: e.message });
      }
    });
    return nestedGood;
  }
  /** the debtors (or creditors) account must equal the sum of its party balances */
  function checkPartyControl_(check, balance, role) {
    var account = check.packs.accountOf(check.pack, role),
      accountBalance = balance.accounts[account.code],
      parts = balance.parties[account.code] || {};
    var sum = Object.keys(parts).reduce(function (total, item) {
      return total + parts[item].net_minor;
    }, 0);
    var accountTotal = accountBalance ? accountBalance.net_minor : 0;
    if (accountTotal !== sum)
      check.mismatches.push({ name: role + '_control', code: account.code, account_minor: accountTotal, parties_minor: sum, difference_minor: accountTotal - sum });
  }
  /** each well-formed line: a debtors/creditors line must name a party; its debits and credits are summed per day and per entry, and an unbalanced day or entry is named */
  function checkLineSums_(check, good) {
    var days = Object.create(null),
      ents = Object.create(null),
      controlRoles = Object.create(null); /* L4: an entry_id of "__proto__" is just a key */
    ['debtors', 'creditors'].forEach(function (item) {
      controlRoles[check.packs.accountOf(check.pack, item).code] = item;
    });
    good.forEach(function (item) {
      addLineToSums_(check, controlRoles, days, ents, item);
    });
    Object.keys(days)
      .sort()
      .forEach(function (item) {
        if (days[item][0] !== days[item][1]) check.mismatches.push({ name: 'day_unbalanced', date: item, dr_minor: days[item][0], cr_minor: days[item][1] });
      });
    Object.keys(ents).forEach(function (item) {
      if (ents[item][0] !== ents[item][1]) check.mismatches.push({ name: 'entry_unbalanced', entry_id: item, dr_minor: ents[item][0], cr_minor: ents[item][1] });
    });
  }
  /** one line: named when it is on a control account with no party, and added to its day's and its entry's debit and credit sums */
  function addLineToSums_(check, controlRoles, days, ents, item) {
    var line = item.l,
      account = acct_(check.pack, line, 'line ' + item.n),
      sides = sides_(line, 'line ' + item.n),
      debit = sides[0],
      credit = sides[1];
    if (controlRoles[account.code] && !line.party)
      check.mismatches.push({ name: 'party_missing', line: item.n, code: account.code, entry_id: line.entry_id != null ? line.entry_id : null });
    addPair_(days, line.date || '(no date)', debit, credit);
    if (line.entry_id != null) addPair_(ents, String(line.entry_id), debit, credit);
  }
  /** add a debit and a credit to the pair kept under `key` (made at [0, 0] when new) */
  function addPair_(map, key, debit, credit) {
    var totals = map[key] || (map[key] = [0, 0]);
    totals[0] += debit;
    totals[1] += credit;
  }
  /** the period rows given against the rows the lines make: the recomputed lines plus the carried rows (want) against the balance rows (have) */
  function checkRowsAgainstLines_(check, x) {
    var want = Object.create(null),
      have = Object.create(null);
    accumulate(
      wellFormed_(check, x.recompute_lines, 'recompute_lines').map(function (item) {
        return item.l;
      }),
      { pack: check.pack }
    ).forEach(function (item) {
      addRowSides_(want, periodRowKey_(item, item.code), item.dr_minor, item.cr_minor);
    });
    (x.carried || []).forEach(function (item, index) {
      if (!item) return;
      var sides = rowSides_(item, 'carried row ' + (index + 1));
      addRowSides_(want, periodRowKey_(item, acct_(check.pack, item, 'carried row ' + (index + 1)).code), sides[0], sides[1]);
    });
    x.balances.forEach(function (item, index) {
      if (!item) return;
      var sides = rowSides_(item, 'balance row ' + (index + 1));
      addRowSides_(have, periodRowKey_(item, acct_(check.pack, item, 'balance row ' + (index + 1)).code), sides[0], sides[1]);
    });
    reportRowsVsLines_(check, want, have);
  }
  /** the key of a period row: year, period, account code and party */
  function periodRowKey_(row, code) {
    return row.fiscal_year + '|' + row.period + '|' + code + '|' + (row.party == null ? '' : row.party);
  }
  /** add a row's debit and credit to the total kept under its key */
  function addRowSides_(map, mapKey, debit, credit) {
    var total = map[mapKey] || (map[mapKey] = { dr_minor: 0, cr_minor: 0 });
    total.dr_minor = add_(total.dr_minor, debit, mapKey);
    total.cr_minor = add_(total.cr_minor, credit, mapKey);
  }
  /** name every key where the rows differ from the lines — a phantom row and a rowless line both show */
  function reportRowsVsLines_(check, want, have) {
    var all = Object.create(null);
    Object.keys(want)
      .concat(Object.keys(have))
      .forEach(function (item) {
        all[item] = 1;
      });
    Object.keys(all)
      .sort()
      .forEach(function (item) {
        /* the UNION: a phantom row and a rowless line both show */
        var haveRow = have[item] || { dr_minor: 0, cr_minor: 0 },
          wantRow = want[item] || { dr_minor: 0, cr_minor: 0 };
        if (haveRow.dr_minor !== wantRow.dr_minor || haveRow.cr_minor !== wantRow.cr_minor)
          check.mismatches.push({
            name: 'rows_vs_lines',
            key: item,
            row: haveRow,
            lines: wantRow,
            why: !want[item] ? 'a row with no lines behind it' : !have[item] ? 'lines with no row' : 'the row differs from its lines'
          });
      });
  }

  const EXPORTS = {
    AGE_RECEIVABLE,
    AGE_PAYABLE,
    AGE_FOLLOWUP,
    AGE_MSME,
    minor,
    linesOf,
    accumulate,
    balanceAsAt,
    trialBalance,
    profitAndLoss,
    balanceSheet,
    tradingAccount,
    partyStatement,
    ageing,
    carryForward,
    controls
  };

  /* ⭐ ONE FILE, EVERY HOST: node takes module.exports; a page, the TV and the shop PC take window.CBLedger. */
  if (typeof module !== 'undefined' && module.exports) module.exports = EXPORTS;
  if (root && typeof root.window !== 'undefined') root.window.CBLedger = EXPORTS;
})(typeof globalThis !== 'undefined' ? globalThis : this);
