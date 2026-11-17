/**
 * books-grant-reports.js — ACC-176 part of books-grant-view.js: the six reads and what stands over them.
 *
 * OWNS      the REPORTS table (Trial balance · Profit and loss · Balance sheet · Day book · Who owes whom · Months: endpoint, day rule, rows, columns, totals), the question each read takes (queryOf), and the header lines (the date the figures stand at, the period, the lock, the facts)
 * CALLED BY books-grant-view.js (through root.CBBooksGrantKit)
 * FLOW      kit.REPORTS[n].rows(answer) → the rows as the server sent them; kit.queryOf(report) → the address query of the read
 * CARD      04-network/ACC-176-AUDITOR-GRANT
 *
 * Decides nothing and adds nothing up: totals are the server's own. Loaded before books-grant-view.js (network.html).
 */
(function (root) {
  'use strict';
  var grantKit = (root.CBBooksGrantKit = root.CBBooksGrantKit || {});
  grantKit.plRows = plRows;
  grantKit.queryOf = queryOf;
  grantKit.periodLine = periodLine;
  grantKit.lockLines = lockLines;
  grantKit.facts = facts;
  grantKit.totalRows = totalRows;
  grantKit.asAt = asAt;
  grantKit.dayPick = dayPick;
  grantKit.PCT = 'pct'; /* a column kind: basis points, painted as a signed percent */
  grantKit.CMP_COLS = ['prior_minor', 'prior_net_minor', 'prior_year_minor', 'change_minor', 'change_bp']; /* the last-year columns of the P&L, the trial balance and the balance sheet: drawn only when the server read last year (compareDrawn) */
  grantKit.DRCR = 'drcr'; /* a column kind: the trial balance's NET (debit positive), painted as an amount with Dr or Cr, never a minus */
  grantKit.MONEY = 'money'; /* a column kind: the server's minor units, painted in the answer's currency */
  grantKit.ACTIONS = 'actions'; /* the adviser's seventh tab: the three queues */
  /** each read: its endpoint, how the day box maps to its question, the rows it lists and the totals it shows (names are the server's own keys) */
  /* the Day book's seven columns fit one 1366 screen beside the menu (Entry · Date · Kind · Party · ref · Amount · Evidence · Mark) */
  grantKit.DAYBOOK_W = { entry_no: 150, posting_date: 110, kind: 100, party_ref: 250, amount_minor: 120, evidence: 150, mark: 170, flag: 70, risk: 80, explain: 120 };
  grantKit.REPORTS = [
    { k: 'tb', label: 'Trial balance', ep: 'readTB', day: 'asOf', rows: function (a) { return a.rows || []; }, cols: [['code', 'Code'], ['name', 'Account'], ['group', 'Group'], ['dr_minor', 'Debit', grantKit.MONEY], ['cr_minor', 'Credit', grantKit.MONEY], ['prior_net_minor', 'Last year', grantKit.DRCR], ['change_minor', 'Change', grantKit.MONEY], ['change_bp', '%', grantKit.PCT]], facts: [['total_dr_minor', 'Total debit'], ['total_cr_minor', 'Total credit']], drill: 'ledger' },
    { k: 'pl', label: 'Profit and loss', ep: 'readPL', day: 'to', rows: plRows, cols: [['side', 'Type'], ['code', 'Code'], ['name', 'Account'], ['amount_minor', 'Amount', grantKit.MONEY], ['prior_minor', 'Last year', grantKit.MONEY], ['change_minor', 'Change', grantKit.MONEY], ['change_bp', '%', grantKit.PCT], ['explain', 'Explain', 'explain']], facts: [['total_income_minor', 'Income'], ['total_expense_minor', 'Expense'], ['gross_profit_minor', 'Gross profit'], ['profit_minor', 'Profit']], drill: 'ledger' },
    { k: 'bs', label: 'Balance sheet', ep: 'readBS', day: 'asOf', rows: function (a) { return side(a.assets, 'Assets').concat(side(a.liabilities, 'Liabilities'), side(a.equity, 'Equity')).map(function (row) { return profitRow(row, a); }); }, cols: [['side', 'Part'], ['code', 'Code'], ['name', 'Account'], ['amount_minor', 'Amount', grantKit.MONEY], ['prior_year_minor', 'Last year', grantKit.MONEY], ['change_minor', 'Change', grantKit.MONEY], ['change_bp', '%', grantKit.PCT]], facts: [['total_assets_minor', 'Assets'], ['total_liab_equity_minor', 'Liabilities and equity']], drill: 'ledger' },
    { k: 'daybook', label: 'Day book', ep: 'readDaybook', day: 'both', rows: function (a) { return (a.entries || []).map(function (e) { return Object.assign({ amount_minor: root.CBBooksGrantDrill.amountOf(e), kind: root.dayBookKind(e), posted_by_words: root.CBBooksActing.postedByWords(e, true), party_ref: root.dayBookPartyRef(e) /* R70: the party and the document number, as the owner's Day book shows them */, recorded_text: recordedText(e), risk_list: grantKit.riskWords(Object.assign({ amount_minor: root.CBBooksGrantDrill.amountOf(e) }, e)) /* the same row the filters judge (the amount is the debits) */ /* JET: the rules this entry trips (books-grant-filters.js riskOf), one definition each */ }, e); }); }, cols: [['entry_no', 'Entry'], ['posting_date', 'Date'], ['kind', 'Kind'], ['party_ref', 'Party · ref'], ['amount_minor', 'Amount', grantKit.MONEY], ['evidence', 'Evidence', 'evidence'], ['mark', 'Mark', 'mark'], ['risk', 'Risk', 'risk'], ['flag', 'Saved', 'flag']], facts: [], drill: 'entry' },
    { k: 'dues', label: 'Who owes whom', ep: 'readDues', day: 'asOf', rows: function (a) { return a.parties || []; }, cols: [['name', 'Party'], ['age_not_due', 'Current', grantKit.MONEY], ['age_d0_30', '1–30', grantKit.MONEY], ['age_d31_60', '31–60', grantKit.MONEY], ['age_d61_90', '61–90', grantKit.MONEY], ['age_d90_plus', '90+', grantKit.MONEY], ['balance_minor', 'Total', grantKit.MONEY]], facts: [], panels: true },
    { k: 'periods', label: 'Months', ep: 'readPeriods', day: null, rows: monthRows, cols: [['month', 'Month'], ['state', 'State'], ['lock_note', 'Locked by and when'], ['entries', 'Entries'], ['sales_minor', 'Sales', grantKit.MONEY]], facts: [] }
  ];

  /** the months of the books the way the owner reads them: the month's name, a plain state, no index numbers (the opening balance row, period 0, is not a month) */
  function monthRows(answer) {
    var today = new Date().toISOString().slice(0, 10); /* months that have not begun are not the books yet */
    return ((answer && answer.periods) || []).filter(function (p) { return Number(p.period) >= 1 && !p.before_books && p.start_date && String(p.start_date).slice(0, 10) <= today; }).map(function (p) {
      var at = String(p.start_date).slice(0, 10), names = typeof root.monthNames === 'function' ? root.monthNames('long') : [];
      var who = root.CBLockWords ? root.CBLockWords.whoOf(p, p.status) : { line: '', note: '', all: [] }; /* W15-97: who locked it and when, who opened it again and why: the server's trail, read only */
      return Object.assign({}, p, { month: (names[Number(at.slice(5, 7)) - 1] || at.slice(0, 7)) + ' ' + at.slice(0, 4), state: root.CBLockWords ? root.CBLockWords.stateWord(p.status) : grantKit.words(p.status), sales_minor: Number(p.sales_minor) > 0 ? p.sales_minor : null, lock_note: (who.all.length > 1 ? who.all : who.line ? [who.line] : []).concat(who.note ? [who.note] : []).map(function (line) { return '<div>' + esc(line) + '</div>'; }).join('') });
    });
  }
  /** W20: the balance sheet's profit line is the profit of the period it is read at: "Profit 1 Jul 2025 – 30 Jun 2026", not a bare "Profit for the year" (api fy_from and the as-at day) */
  function profitRow(row, a) {
    if (row.role !== 'profit_to_date' || !a.fy_from || !a.asOf) return row;
    return Object.assign({}, row, { name: grantKit.words('Profit') + ' ' + root.shopDay(a.fy_from) + ' – ' + root.shopDay(a.asOf) });
  }
  /** the P&L's rows: each ledger with last year, the change and its flag, all the server's (by_line); the flat lists only when by_line is absent */
  function plRows(a) {
    var heads = function (list) { return [].concat.apply([], (list || []).map(function (head) { return head.accounts || []; })); };
    var by = a.by_line || {}, inc = heads(by.income), exp = heads(by.expense);
    return side(inc.length ? inc : a.income, 'Income').concat(side(exp.length ? exp : a.expense, 'Expense'));
  }
  function side(list, name) {
    return (list || []).map(function (row) {
      return Object.assign({ side: grantKit.words(name) }, row);
    });
  }
  /** the day box → the question each read takes (the server defaults every one to today) */
  function queryOf(report) {
    var period = grantKit.viewState.period, after = report.k === 'daybook' && !grantKit.viewState.day && grantKit.afterYearEnd() && root.CBBooksGrantFilters.afterRange(period);
    if (report.k === 'daybook' && grantKit.viewState.since) return { since: 'mine', limit: grantKit.SINCE_LIMIT }; /* rank 10: the server reads this person's check point; no date range (a back-dated entry is the finding) */
    grantKit.viewState.yeRead = !!after; /* JET: which days the Day book was read for, so a change of the Year end filter knows whether to read again */
    if (after) return after;
    if (!grantKit.viewState.day) return periodQuery(report, period);
    return dayQuery(report, grantKit.viewState.day);
  }
  /** no day typed: the read is for the period (as at its end for tb, bs and dues; from – to for the p&l and the day book) */
  function periodQuery(report, period) {
    if (!period || !period.from || !report.day) return {};
    if (report.day === 'asOf') return { asOf: period.to }; /* tb, bs, dues: as at the end of the period */
    return { from: period.from, to: period.to }; /* p&l, day book: for the period */
  }
  /** a day typed: that one day, in the shape the read takes */
  function dayQuery(report, day) {
    if (report.day === 'both') return { from: day, to: day };
    var query = {};
    query[report.day] = day;
    return query;
  }
  /** when and by whom an entry was posted (the server's recorded_at, shown in the shop day) */
  function recordedText(e) {
    return e && e.recorded_at ? root.shopDay(e.recorded_at) + (e.recorded_by ? ' · ' + e.recorded_by : '') : '';
  }
  /** the period the Day book shows when no day is typed: "1 Oct 2026 – 31 Oct 2026" */
  function periodLine(report) {
    if (report.k !== 'daybook' || grantKit.viewState.day || !grantKit.viewState.range) return '';
    return '<span class="tag" data-testid="bv-period">' + esc(grantKit.words('Period')) + ' ' + esc(root.shopDay(grantKit.viewState.range.from)) + ' – ' + esc(root.shopDay(grantKit.viewState.range.to)) + '</span>';
  }
  /** W22 (fd17: ONE short tag in the header line, no row of its own): the firm's Months view, the lock as Xero's lock date reads it. The tag says the lock ("Locked to 31 Jan 2026" + the count of open gaps); the full sentence (Books start Jul 2025 · Locked to 31 Jan 2026 · Open: Feb 2026 (gap)) is its title and its aria-label. Every word and date is the server's (books_start, lock_date, gaps); months before the books start are not listed */
  function lockLines(report) {
    var a = grantKit.viewState.answer;
    if (report.k !== 'periods' || !a || !a.books_start) return '';
    var names = typeof root.monthNames === 'function' ? root.monthNames('short') : [];
    var monthOf = function (m) { var at = String(m.start_date || ''); return (names[Number(at.slice(5, 7)) - 1] || at.slice(0, 7)) + ' ' + at.slice(0, 4); };
    var gaps = a.gaps || [], lock = a.lock_date ? grantKit.words('Locked to') + ' ' + root.shopDay(a.lock_date) : grantKit.words('Not locked from the books start');
    var full = [grantKit.words('Books start') + ' ' + monthOf(a.books_start), lock].concat(gaps.length ? [grantKit.words('Open') + ': ' + gaps.map(monthOf).join(', ') + ' (' + grantKit.words('gap') + ')'] : []).join(' · ');
    var short = lock + (gaps.length ? ' · ' + gaps.length + ' ' + grantKit.words('gap') : '');
    return '<span class="tag bv-lock" data-testid="bv-lock-lines" title="' + esc(full) + '" aria-label="' + esc(full) + '" data-full="' + esc(full) + '">' + esc(short) + '</span>';
  }
  function facts(report) {
    var items = report.facts
      .filter(function (f) {
        return grantKit.viewState.answer && grantKit.viewState.answer[f[0]] != null;
      })
      .map(function (f) {
        return '<span class="tag" data-testid="bv-fact-' + f[0] + '">' + esc(grantKit.words(f[1])) + ': ' + esc(grantKit.minorWords(grantKit.viewState.answer[f[0]])) + '</span>';
      });
    return items.length ? '<span class="bv-facts" data-testid="bv-facts">' + items.join('') + '</span>' : '';
  }
  /** the server's own totals as a last row (nothing is added up here) */
  function totalRows(key, a) {
    var total = grantKit.words('Total');
    if (key === 'tb' && a.total_dr_minor != null) return [{ _total: true, name: total, dr_minor: a.total_dr_minor, cr_minor: a.total_cr_minor }];
    if (key === 'pl' && a.profit_minor != null) return (a.gross_profit_minor != null ? [{ _total: true, name: grantKit.words('Gross profit (sales less cost of sales)'), amount_minor: a.gross_profit_minor }] : []).concat([{ _total: true, name: grantKit.words('Profit'), amount_minor: a.profit_minor }]);
    if (key === 'bs' && a.total_assets_minor != null) return [{ _total: true, side: grantKit.words('Assets'), name: total, amount_minor: a.total_assets_minor }, { _total: true, side: grantKit.words('Liabilities and equity'), name: total, amount_minor: a.total_liab_equity_minor }];
    return [];
  }
  /** a heading naming the date the figures stand at */
  function asAt(report) {
    var answer = grantKit.viewState.answer || {}, running = runningYear(report, answer);
    if (report.k === 'pl' && answer.from && answer.to && !grantKit.viewState.day) return forTag(answer);
    var date = asAtDay(answer);
    return date && ['tb', 'pl', 'bs', 'dues'].indexOf(report.k) >= 0 ? asAtTag(date, running) : '';
  }
  /** the day the figures stand at: the day typed, else the one the server carried */
  function asAtDay(answer) {
    return grantKit.viewState.day || answer.shown_as_at || answer.asOf || answer.as_of || answer.to || '';
  }
  /** is this year still running? fix1117 F5: the api caps asOf at the shop day, so the year's end we ASKED for is what says the year is still running */
  function runningYear(report, a) {
    var asked = report.day === 'asOf' ? queryOf(report).asOf : '';
    return !grantKit.viewState.day && a.shown_as_at && ((a.asOf && a.shown_as_at < a.asOf) || (asked && a.shown_as_at < asked));
  }
  /** the P&L's heading: for a period, never "as at" a day (W18) */
  function forTag(a) {
    return '<span class="tag" data-testid="bv-for">' + esc(grantKit.words('For')) + ' ' + esc(root.shopDay(a.from)) + ' – ' + esc(root.shopDay(a.to)) + '</span>';
  }
  /** the "As at <day>" tag, with "year to date" while the year is still running */
  function asAtTag(date, running) {
    return '<span class="tag" data-testid="bv-asat">' + esc(grantKit.words('As at')) + ' ' + esc(root.shopDay(date)) + (running ? ' · ' + esc(grantKit.words('year to date')) : '') + '</span>';
  }
  /** the Day pick (a report that can stand at one day) */
  function dayPick(report) {
    return report.day ? '<label class="sub" for="bv_day">' + esc(grantKit.words('Day')) + '</label><input data-cbsid="NET005-I01" id="bv_day" class="inp" type="date" value="' + esc(grantKit.viewState.day) + '" data-testid="bv-day">' : '';
  }
})(typeof window !== 'undefined' ? window : globalThis);
