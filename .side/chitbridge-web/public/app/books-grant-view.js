/**
 * books-grant-view.js — ACC-176, THE AUDITOR'S SIDE: a member's books, READ ONLY.
 *
 * OWNS      the books view a firm opens from "My network" for one member store: for an auditor the "Viewing <store> — read only" band, for an adviser the frozen "Acting for <store>, <currency>" banner (CBBooksActing) with its store switch and an "Actions" tab (the queues); the back link; six reads (Trial balance · Profit and loss · Balance sheet · Day book · Who owes whom · Closed months) as CBLists
 * CALLED BY network-app.js ("Open books" on a member row that holds a live grant)
 * FLOW      mount(host, o) → GET /api/books/<read> with the headers of CBBooksActing (the server checks the grant on every look and writes the log row) → rows + totals painted as the server sent them; a refusal is shown in the server's words
 * CARD      04-network/ACC-176-AUDITOR-GRANT
 *
 * This screen has NO write control: nothing here adds, changes or exports a book (the adviser's writes live in books-actions-view.js, which this screen only mounts). It paints what the server answered and computes nothing. A look the server refuses (a grant that ended, a part not open to an auditor)
 * is said in its own sentence, never as an empty table.
 *   CBBooksGrantView.mount(host, { call, member: { id, name, role }, onBack, onSwitch, stores, mountList, sheet, closeSheet }) → { destroy }
 *
 * THE PERIOD (W8/W14/W15/W17/W18, Athi 16 Nov): ONE control (period-pick.js) at the right of the tabs line picks the year or a month for every read; the page opens on the year under review (the server's `under_review`) and the period rides the address (&fy= or &from=&to=). tb and bs read it as 'as at <to>', p&l and the day book as from – to.
 *
 * ACC-176c: a trial balance, profit and loss or balance sheet row opens that account's ledger; a Day book row opens its entry (books-grant-drill.js).
 *
 * REUSE (named in the PR): CBBooksGrantDrill · CBList (via mountList) · CBBooksGrantApi (endpoints) · CBBooksActing (headers, banner, figure) · CBBooksActionsView (the queues) · the page's own call (token, base, 401)
 */
(function (root) {
  'use strict';
  var grantKit = root.CBBooksGrantKit; /* created by books-grant-reports.js, which loads first */
  grantKit.words = words;
  grantKit.$ = $;
  grantKit.current = current;
  grantKit.onActions = onActions;
  grantKit.afterYearEnd = afterYearEnd;
  grantKit.rereadChoices = rereadChoices;
  grantKit.openMonth = openMonth;
  grantKit.paintList = paintList;
  grantKit.drill = drill;
  grantKit.alive = alive;
  grantKit.reload = reload;
  grantKit.viewState = { host: null, o: {}, report: 'tb', day: '', answer: null, why: null, mk: null, period: null, range: null, choices: undefined };
  /** where a reviewer lands: the auditor on the Day book (the entries are the job), the adviser on the trial balance */
  function viewKnown(k) {
    return k === grantKit.ACTIONS || grantKit.REPORTS.some(function (r) { return r.k === k; });
  }
  function homeOf(options) {
    return options && options.member && options.member.role === 'adviser' ? 'tb' : 'daybook';
  }
  function words(s) {
    return typeof root.tx === 'function' ? root.tx(s) : s;
  }
  function $(id) {
    return root.document.getElementById(id);
  }
  function current() {
    return grantKit.REPORTS.filter(function (r) {
      return r.k === grantKit.viewState.report;
    })[0];
  }
  /** the firm's "Actions" tab is open: the queues, not a read */
  function onActions() {
    return grantKit.viewState.report === grantKit.ACTIONS;
  }
  function isAdviser() {
    return grantKit.viewState.o.member.role === 'adviser';
  }
  /** JET (ASA 560): "Year end · Dated after it" is pressed (the list's choice, or the address on the first read): the Day book reads the days after the period, through the same route */
  function afterYearEnd() {
    var F = root.CBBooksGrantFilters, chosen = grantKit.viewState.dbf !== undefined ? grantKit.viewState.dbf : F ? F.fromAddress(root.location.search) : {};
    return !!F && chosen.ye === 'dated';
  }

  /* ── the read ── */
  /** the period in force: the one value every read takes (and the Day book's `range`, kept as {from, to} for the marks and the empty line) */
  function usePeriod(period) {
    grantKit.viewState.period = period;
    grantKit.viewState.range = period && period.from ? { from: period.from, to: period.to } : null;
  }
  /** the choices of this client, read ONCE (GET /periods?marks=1: the year under review, each year, each month with its state and checked n of m); the period opens on the year under review (current FY only when none) unless the address named one */
  /** fix1117 F3: the first screen is never an empty period. A client whose first financial year has not ended has no year under review (the api says null), and a year under review may hold no entries: either way the books open on the latest year that holds entries (the api's years, newest first), so "Checked 0 of 0 · Nothing to show" never greets a client with entries. RC walk 17 Nov: the current year with entries comes first (below) */
  function periodWithEntries(choices, review) {
    var years = (choices && choices.years) || [], busy = years.filter(function (y) { return Number(y.entries) > 0; })[0];
    var today = new Date().toISOString().slice(0, 10), now = years.filter(function (y) { return Number(y.entries) > 0 && String(y.from).slice(0, 10) <= today && today <= String(y.to).slice(0, 10); })[0];
    var held = review && years.filter(function (y) { return y.fy === review.fy; })[0];
    if (review && (!held || Number(held.entries) > 0 || !busy)) return review; /* fyreview 17 Nov: a FIRM seat opens the client on the year under review, the value Home year-end band and the practice list show (the api under_review, read once here); Xero Practice and CaseWare open the engagement period. The OWNER books are another screen and keep the current year */
    if (now) return { fy: now.fy, from: now.from, to: now.to }; /* no year under review, or it holds nothing: the CURRENT financial year, when it holds entries, as Xero and MYOB open the current period; the year under review (a closed year) is one pick away */
    return busy ? { fy: busy.fy, from: busy.from, to: busy.to } : review;
  }
  function choose() {
    if (grantKit.viewState.choices !== undefined || !alive()) return Promise.resolve();
    return root.CBBooksGrantApi.run(grantKit.viewState.o.call, 'readPeriods', { query: { marks: 1 }, headers: root.CBBooksActing.headers() }).then(function (a) {
      grantKit.viewState.choices = a || null;
      var named = root.CBPeriodPick.filled(grantKit.viewState.period, a), review = a && a.under_review;
      review = periodWithEntries(a, review);
      usePeriod(named || (review ? { kind: 'year', fy: review.fy, from: review.from, to: review.to } : null)); /* W15/W17: the year under review, never "this month" or "as at today" */
    }, function () { grantKit.viewState.choices = null; usePeriod(grantKit.viewState.period && grantKit.viewState.period.from ? grantKit.viewState.period : null); });
  }
  /** E16: a mark changes the dropdown's "checked n/m" lines too: the choices are read again (the server's own counts, the same GET /periods?marks=1) and the slot repainted, the period kept */
  function rereadChoices() {
    if (!alive() || !grantKit.viewState.choices) return;
    root.CBBooksGrantApi.run(grantKit.viewState.o.call, 'readPeriods', { query: { marks: 1 }, headers: root.CBBooksActing.headers() }).then(function (a) {
      if (!alive() || !a) return;
      grantKit.viewState.choices = a;
      var report = current();
      if (report) fillPeriodSlot(report);
    }, function () { /* the lines stay as they were; the next open reads them fresh */ });
  }
  /** the period control mounts into the named slot of the header line (CBBooksActing.periodSlot, W19): ONE function, ONE call in paint(); moving it is changing that call. Nothing in a refused or Actions screen. */
  function fillPeriodSlot(report) {
    var slot = $('bv_period_slot');
    if (slot) slot.innerHTML = !report.k || grantKit.viewState.why || !grantKit.viewState.choices ? '' : root.CBPeriodPick.control(grantKit.viewState.choices, grantKit.viewState.period, pickPeriod);
  }
  /** a period chosen: every view follows it (the typed day is dropped), the address records it */
  function pickPeriod(period) {
    usePeriod(period);
    grantKit.viewState.day = '';
    tell();
    reload().then(function () { var box = $('bv_period'); if (box) box.focus(); });
  }
  /** a Months row opens that month's Day book */
  function openMonth(from, to) {
    var row = ((grantKit.viewState.choices && grantKit.viewState.choices.periods) || []).filter(function (p) { return String(p.start_date).slice(0, 10) === from; })[0];
    usePeriod({ kind: 'month', fy: row ? row.fiscal_year : null, from: from, to: to });
    grantKit.viewState.day = '';
    grantKit.viewState.report = 'daybook';
    tell();
    reload();
  }
  /** GET /periods names no currency: a month's sales would print as a dash. The store's currency is learned once from the Day book's own answer (the period it opens on) */
  function knowCurrency() {
    var acting = root.CBBooksActing.current() || {};
    if (current().k !== 'periods' || acting.currency || !grantKit.viewState.range) return Promise.resolve();
    return root.CBBooksGrantApi.run(grantKit.viewState.o.call, 'readDaybook', { query: { from: grantKit.viewState.range.from, to: grantKit.viewState.range.to }, headers: root.CBBooksActing.headers() }).then(function (a) { root.CBBooksActing.setCurrency(a && a.currency); }, function () { /* no currency learned: the figures show a dash, never a wrong symbol */ });
  }
  function load() {
    if (onActions()) return Promise.resolve();
    var report = current();
    if (report.k === 'periods') grantKit.viewState.choices = undefined; /* the Months list is read fresh each time it is opened */
    return choose().then(function () { return alive() ? knowCurrency() : null; }).then(function () { return !alive() ? null : report.k === 'periods' ? monthsOfPeriod() : readReport(report); });
  }
  /** the Months list: the months of the period's year, from the one read of the choices (no second trip) */
  function monthsOfPeriod() {
    var fy = grantKit.viewState.period && grantKit.viewState.period.fy;
    var c = grantKit.viewState.choices || {};
    /* E4: the lock line (books_start, lock_date, gaps) is the same /periods answer's: carried across, or lockLines() finds nothing to draw */
    grantKit.viewState.answer = { periods: (c.periods || []).filter(function (p) { return !fy || p.fiscal_year === fy; }), books_start: c.books_start || null, lock_date: c.lock_date || null, gaps: c.gaps || [] };
    grantKit.viewState.why = null;
    return Promise.resolve();
  }
  var flagsRead = null; /* the flags read of the Day book just answered (cap-flag.js load): readReport waits for it so the Saved column and its filter paint with the rows */
  function readReport(report) {
    return root.CBBooksGrantApi.run(grantKit.viewState.o.call, report.ep, { query: grantKit.queryOf(report), headers: root.CBBooksActing.headers() }).then(
      function (answer) { keepAnswer(report, answer); },
      function (failure) { keepFailure(failure); }
    ).then(function () { var held = flagsRead; flagsRead = null; return held; }); /* the page paints once the flags answered (or failed: never a reason to hold the books back) */
  }
  /** a read answered: the answer, the since watermark and the server's gross profit are kept, and the helpers are told which entries it holds */
  function keepAnswer(report, answer) {
    grantKit.viewState.answer = answer;
    grantKit.viewState.seen = report.k === 'daybook' && grantKit.viewState.since && answer ? { to: answer.seen_to, total: answer.total, since: answer.since } : null; /* rank 10: the watermark of what this screen listed: Mark as checked sends it back */
    if (grantKit.viewState.o.onRead) grantKit.viewState.o.onRead(); /* the first books read answered 200: the seat the person chose may now be remembered */
    if (report.k === 'pl' && answer && answer.gross_profit) answer.gross_profit_minor = answer.gross_profit.gross_profit_minor; /* the server's gross profit, named like its other totals */
    grantKit.viewState.why = null;
    ingestEntries(report, answer);
    ingestExplained(report, answer);
    root.CBBooksActing.setCurrency(answer && answer.currency);
  }
  /** the Day book's entries go to the three helpers: each entry carries its mark, its evidence and my bookmark */
  function ingestEntries(report, answer) {
    if (report.k !== 'daybook') return;
    if (grantKit.viewState.mk) grantKit.viewState.mk.ingest(answer && answer.entries, answer); /* ACC-358: each entry carries its mark */
    if (grantKit.viewState.ev) grantKit.viewState.ev.ingest(answer && answer.entries); /* CMP062: and its evidence */
    if (grantKit.viewState.fl) flagsRead = grantKit.viewState.fl.load(((answer && answer.entries) || []).map(function (e) { return e.entry_id; }).filter(Boolean)); /* CMP066: my bookmarks of these entries, ONE read per 200; a failed read draws no chip rather than saying none */
  }
  /** the P&L's flagged lines: my explanations of them, ONE read */
  function ingestExplained(report, answer) {
    if (report.k !== 'pl') return;
    if (grantKit.viewState.fa && answer && answer.compare) flagsRead = grantKit.viewState.fa.load(grantKit.plRows(answer).filter(function (r) { return r.change_over; }).map(grantKit.explainId).filter(Boolean)); /* my explanations of the flagged lines, ONE read; a failed read draws no button rather than saying none */
  }
  /** a read failed: a 401 goes up to the page, anything else is said by the frame (never the server's raw word) */
  function keepFailure(failure) {
    if (failure.status === 401) throw failure;
    grantKit.viewState.answer = null;
    grantKit.viewState.why = true; /* the frame says it (CBShell.readFailed); the server's raw word is never printed */
    grantKit.viewState.failure = { status: failure.status || 0, detail: failure.status === 403 ? failure.message : '' };
  }

  /* ── the screen ── */
  /** a phone (the header's 700 px rule) holds the screen pick as ONE select, not seven buttons */
  function phone() {
    return typeof root.matchMedia === 'function' && root.matchMedia('(max-width: 700px)').matches;
  }
  function tabs() {
    if (phone()) return '';
    var all = grantKit.REPORTS.map(function (r) {
      return { k: r.k, label: r.label };
    });
    if (isAdviser()) all.push({ k: grantKit.ACTIONS, label: 'Actions' });
    return all.map(function (r) {
      return (
        '<button data-cbsid="NET005-B02" type="button" id="bv_tab_' + r.k + '" class="act' + (grantKit.viewState.report === r.k ? '' : ' quiet') + '" data-report="' + r.k + '" data-testid="bv-tab-' + r.k + '" aria-pressed="' + (grantKit.viewState.report === r.k) + '">' + esc(words(r.label)) + '</button>'
      );
    }).join('') + prepareButton() + bankButton();
  }
  /** the phone's screen pick: the library Select (ui-select.js, as period-pick.js uses) with the same screens as the buttons, and the Bank / Prepare ways as its last lines; the address follows the pick (onView) */
  function tabSelect() {
    if (!phone() || grantKit.viewState.why || !root.ui || typeof root.ui.select !== 'function') return '';
    var options = grantKit.REPORTS.map(function (r) { return { value: r.k, label: words(r.label) }; });
    if (isAdviser()) options.push({ value: grantKit.ACTIONS, label: words('Actions') }, { value: '_prepare', label: words('Prepare a journal') });
    else options.push({ value: '_bank', label: words('Bank') });
    return '<span class="bv-tabsel" data-testid="bv-tabsel">' + root.ui.select({
      mount: 'NET005-U02', label: 'Books', bare: true, id: 'bv_tabsel', testid: 'bv-tab-select', value: grantKit.viewState.report, options: options,
      onChange: function (value) {
        if (value === '_prepare') return openPrepare();
        if (value === '_bank') return openBank();
        grantKit.viewState.report = value;
        tell();
        reload().then(function () { var box = $('bv_tabsel'); if (box) box.focus(); });
      }
    }) + '</span>';
  }
  /** W15-71: the auditor's way to the client's Bank (home, kept statements, a month's lines, who matched, the sign-off) and Month lock: the books page in the auditor's seat, read only */
  function bankButton() {
    return !isAdviser() && !grantKit.viewState.why ? '<button data-cbsid="NET005-B10" type="button" class="act quiet" id="bv_bank" data-testid="bv-bank">' + esc(words('Bank')) + '</button>' : '';
  }
  function openBank() {
    var report = grantKit.viewState.report, carry = (report ? '&view=' + encodeURIComponent(report) : '') + (grantKit.viewState.period ? root.CBPeriodPick.toAddress(grantKit.viewState.period) : ''); /* E10: the screen and the period ride to Bank and back */
    root.location.assign(root.CBBooksActing.auditAddressOf(root.CBBooksActing.current().store, 'bank', carry));
  }
  /** the adviser's way to prepare a journal: the owner's books page, opened to act for this store (CBBooksActing.addressOf), where Save prepares (or posts, when the owner's grant says adviser_posts) */
  function prepareButton() {
    return isAdviser() && !grantKit.viewState.why ? '<button data-cbsid="NET005-B03" type="button" class="act" id="bv_prepare" data-testid="bv-prepare">' + esc(words('Prepare a journal')) + '</button>' : '';
  }
  function openPrepare() {
    root.location.assign(root.CBBooksActing.addressOf(root.CBBooksActing.current().store, 'journal'));
  }
  /** the band: an auditor is told it is read only; an adviser gets the frozen banner naming the store and its currency, with the store switch */
  function band(report) {
    var ctx = grantKit.viewState.why ? '' : '<span class="bv-ctx" data-testid="bv-ctx">' + grantKit.asAt(report) + (grantKit.viewState.choices ? '' : grantKit.periodLine(report)) + grantKit.dayPick(report) + '</span>' + (grantKit.viewState.why ? '' : grantKit.lockLines(report)) + tabSelect(); /* the date the figures stand at, with its Day pick: one place, the header line; the period dropdown says the period, so the Period tag is only the fallback */
    root.CBBooksActing.css(); /* the one header line's rules, for the auditor's band too (the adviser's banner draws them itself) */
    if (isAdviser()) return root.CBBooksActing.banner(grantKit.viewState.o.stores, screenName(), false, ctx);
    return (
      '<div class="bv-band" role="status" data-testid="bv-band">' + root.CBBooksActing.crumbs(screenName(), false) + '<span class="tag bv-ro" data-testid="bv-readonly">' + esc(words('read only')) + '</span>' + ctx + root.CBBooksActing.periodSlot() +
      '<button data-cbsid="NET005-B01" type="button" class="act quiet" id="bv_back" data-testid="bv-back">← ' + esc(words('Clients')) + '</button></div>'
    );
  }
  /** the name of the screen on show, for the breadcrumb */
  function screenName() {
    if (onActions()) return words('Queues');
    var r = grantKit.REPORTS.filter(function (x) { return x.k === grantKit.viewState.report; })[0];
    return r ? words(r.label) : '';
  }
  /** l16 R4-2b: a screen of the client's books is a history entry: the page is told (onView) so Back and Forward can restore it */
  function tell() {
    if (grantKit.viewState.o.onView) grantKit.viewState.o.onView(grantKit.viewState.report, grantKit.viewState.period);
  }
  function wireBand() {
    var back = function () { root.CBBooksActing.leave(); grantKit.viewState.o.onBack(); };
    if (isAdviser()) root.CBBooksActing.wireBanner(grantKit.viewState.host, { onBack: back, onSwitch: grantKit.viewState.o.onSwitch });
    else $('bv_back').onclick = back;
  }
  /** the screen pick changes form at the phone width: repaint once when the width crosses it (bound once per page) */
  var breakpointBound = false;
  function followBreakpoint() {
    if (breakpointBound || typeof root.matchMedia !== 'function') return;
    breakpointBound = true;
    var query = root.matchMedia('(max-width: 700px)'), again = function () { if (grantKit.viewState.host && grantKit.viewState.host.isConnected && grantKit.viewState.report) paint(); };
    if (query.addEventListener) query.addEventListener('change', again);
  }
  function paint() {
    followBreakpoint();
    var report = onActions() ? { day: null, facts: [] } : current();
    grantKit.viewState.host.innerHTML =
      band(report) +
      '<div class="nw-acts bv-tabrow" data-testid="bv-tabs" role="group" aria-label="' + esc(words('Books')) + '">' + tabs() +
      (!grantKit.viewState.why && report.k === 'daybook' ? grantKit.TABROW_CSS + grantKit.sinceBar() : '') /* fd1117: the since toggle (and, in that view, its count and Mark as checked) sits IN the tab row, not on a row of its own: the first entry stays under the ceiling */ +
      (grantKit.viewState.why ? '' : '<span class="bv-totals">' + grantKit.facts(report) + '</span>') + '</div>' +
      (grantKit.viewState.why ? '<div class="nw-why" id="bv_why" data-testid="bv-why"></div>' : '') +
      '<div class="nw-list" id="bv_list" data-testid="bv-list"></div>' +
      (grantKit.markable(report) ? '<div id="bv_marks" class="bv-marks" data-testid="bv-marks"></div>' : '') /* fd17: the slot keeps the bar's height before its answer comes; fd1117: the marks bar (count and All queries) sits UNDER the list with the notes, so the first data row stays where the ceiling holds it */ +
      (grantKit.viewState.why ? '' : grantKit.riskNote(report) + grantKit.cmpNote(report)) /* under the list too: the first data row stays where the ceiling holds it */ +
      (grantKit.viewState.why || report.k !== 'tb' ? '' : '<div id="bv_bank_tb">' + grantKit.bankTbLine() + '</div>') /* RANK 9: the bank agreement of the day the trial balance is drawn at: UNDER the list, so the first data row stays where the w19 ceiling holds it */;
    wirePainted(report);
  }
  /** the painted screen's controls are wired: the band, the failure frame, the period slot, the buttons, the day box and the list */
  function wirePainted(report) {
    wireBand();
    if (grantKit.viewState.why && $('bv_why')) root.CBShell.readFailed($('bv_why'), { what: words('These books'), status: grantKit.viewState.failure && grantKit.viewState.failure.status, detail: grantKit.viewState.failure && grantKit.viewState.failure.detail, retry: function () { reload(); } });
    fillPeriodSlot(report);
    if ($('bv_prepare')) $('bv_prepare').onclick = openPrepare;
    if ($('bv_bank')) $('bv_bank').onclick = openBank;
    wireTabButtons();
    grantKit.wireBankTbLine();
    grantKit.wireSince();
    if (onActions()) grantKit.mountQueues();
    else if (!grantKit.viewState.why) { paintList(report); grantKit.paintMarkBar(report); }
  }
  /** a tab press opens that read and gives the tab focus */
  function wireTabButtons() {
    Array.prototype.forEach.call(grantKit.viewState.host.querySelectorAll('[data-report]'), function (button) {
      button.onclick = function () {
        grantKit.viewState.report = button.getAttribute('data-report');
        tell();
        reload().then(function () {
          $('bv_tab_' + grantKit.viewState.report).focus();
        });
      };
    });
    if ($('bv_day')) $('bv_day').onchange = pickDay;
  }
  /** the list: the day book, or (All queries pressed) every open query with its age, across periods */
  function paintList(report) {
    if (grantKit.viewState.queriesOnly && grantKit.markable(report)) {
      var host = $('bv_list');
      host.innerHTML = grantKit.viewState.mk.queries();
      Array.prototype.forEach.call(host.querySelectorAll('[data-mk-q]'), function (b) {
        b.onclick = function () { grantKit.viewState.mk.sheet(b.getAttribute('data-mk-q'), { title: (b.querySelector('b') || {}).textContent, opener: b }); };
      });
    } else grantKit.paintRows($('bv_list'), report);
  }
  function pickDay() {
    grantKit.viewState.day = $('bv_day').value;
    reload();
  }
  /** a row opens what is behind it (ACC-176c): an account's ledger (a code on the row), or the journal entry a Day book row is; books-grant-drill.js paints both, read only */
  function drill(report, row) {
    var ctx = { mk: grantKit.viewState.mk, ev: grantKit.viewState.ev, call: grantKit.viewState.o.call, sheet: grantKit.viewState.o.sheet, mountList: grantKit.viewState.o.mountList, day: grantKit.viewState.day, period: grantKit.viewState.period /* D1 (A3C): the ledger opens on the period the trial balance was read for, not on this year to today */, currency: grantKit.viewState.answer && grantKit.viewState.answer.currency };
    if (report.drill === 'entry') root.CBBooksGrantDrill.openEntry(ctx, row, ctx.currency, null);
    else if (row.code) root.CBBooksGrantDrill.openLedger(ctx, { code: row.code, name: row.name });
  }
  /** E9: the client is still open (CBBooksActing holds its context). After "← Clients" the context is gone: a read still in flight must neither be sent without the store's header nor paint a band that names it */
  function alive() {
    return !!root.CBBooksActing.current();
  }
  function reload() {
    var mine = grantKit.viewState;
    return load().then(function () { if (alive() && grantKit.viewState === mine) paint(); }, function () {
      if (grantKit.viewState.o.onEnded) grantKit.viewState.o.onEnded();
    });
  }
  var stopForgetting = null;
  /** the answer and the day of the store that was open are forgotten when the store changes */
  function forget() {
    grantKit.viewState = { host: grantKit.viewState.host, o: grantKit.viewState.o, report: homeOf(grantKit.viewState.o), day: '', answer: null, why: null, mk: grantKit.viewState.mk, period: null, range: null, choices: undefined, since: false, seen: null };
    grantKit.newMarks();
  }
  /** after Open books: focus lands on the books heading (the acting band), not on a button that has gone */
  function focusHeading() {
    var head = $('ba_band');
    if (!head) return; /* E18: no heading, no focus: the whole pane took a black outline */
    head.setAttribute('tabindex', '-1');
    head.focus();
  }
  /** a firm's bell row for a colleague's reply on my note arrives as &note=<entry id>: read and forgotten from the address when this script loads (the network page rewrites its address before it mounts the Day book), the Day book then opens that entry's note sheet once (cap-flag.js, kind 'posting') */
  function askedNote() {
    var asked = { note: '', mark: '', day: '', label: '' };
    try {
      var query = new root.URLSearchParams(root.location.search);
      asked.note = query.get('note') || '';
      asked.mark = query.get('mark') || '';
      asked.day = (query.get('mday') || '').slice(0, 10);
      asked.label = (query.get('nl') || '').slice(0, 80);
      if (asked.note || asked.mark) forgetAskedAddress(query);
    } catch (failure) {
      if (root.cbQuiet) root.cbQuiet('books-grant:note-address', failure);
    }
    return asked;
  }
  /** the note's four words leave the address (replace, never a new history entry) */
  function forgetAskedAddress(query) {
    if (!root.history || !root.history.replaceState) return;
    ['note', 'mark', 'mday', 'nl'].forEach(function (name) { query.delete(name); });
    root.history.replaceState(root.history.state, '', root.location.pathname + (query.toString() ? '?' + query.toString() : '') + (root.location.hash || ''));
  }
  var pendingNote = askedNote();
  /**
   * the bell's rows arrive here (rail-bell.js): &note=<id> a colleague's reply on my note (an entry's, or the CLIENT's own: its id is the client's, the sheet then carries the client's NAME),
   * &mark=<entry id> a Query on this client's books (its thread opens, the entry named by its own number)
   */
  function openAskedNote(asked) {
    if (!asked || grantKit.viewState.report !== 'daybook') return;
    openAskedMark(asked);
    if (asked.note) openAskedFlag(asked, grantKit.viewState.o.member || {});
  }
  /** &mark=<entry id>: a Query on this client's books: its thread opens */
  function openAskedMark(asked) {
    if (!asked.mark || !grantKit.viewState.mk) return;
      grantKit.viewState.markDay = asked.day; /* the open list answers for the CURRENT window: an older entry's thread is found by its own day */
      grantKit.viewState.mk.load([asked.mark]).then(function () { grantKit.viewState.markDay = ''; grantKit.viewState.mk.sheet(asked.mark, { title: asked.label || undefined }); }); /* the entry's own label from the bell (nl), when the page has not shown the entry */
  }
  /** &note=<id>: my note on an entry, or on the client itself (its id is the client's): the sheet opens once */
  function openAskedFlag(asked, member) {
    if (member.id && asked.note === String(member.id) && root.CBFlag && grantKit.viewState.o.call) {
      var client = root.CBFlag.use({ call: grantKit.viewState.o.call, kind: 'client', entity: function () { return member.id; } });
      if (!client.off()) client.load([asked.note]).then(function () { client.sheet(asked.note, { label: member.name }); });
    } else if (grantKit.viewState.fl && !grantKit.viewState.fl.off()) grantKit.viewState.fl.load([asked.note]).then(function () { grantKit.viewState.fl.sheet(asked.note, { label: asked.label || undefined }); }); /* R2 17 Nov: the note is read by its OWN id (POST /flags/query is not windowed by year): an entry outside the year the Day book opened on has no chip row loaded, so the sheet said 'Nothing saved'. The entry's words (the note's own label), never its raw id */
  }
  function mount(host, options) {
    var asked = pendingNote;
    pendingNote = null;
    grantKit.viewState = { host: host, o: options, report: viewKnown(options.view) ? options.view : homeOf(options), day: '', answer: null, why: null, mk: null, period: options.period || null, range: null, choices: undefined, since: grantKit.sinceAsked(), seen: null };
    grantKit.newMarks();
    root.CBBooksActing.enter({ id: options.member.id, name: options.member.name }, options.member.role === 'adviser' ? 'adviser' : 'auditor', options.member.posting);
    if (stopForgetting) stopForgetting();
    stopForgetting = root.CBBooksActing.onClear(forget);
    Promise.resolve(reload()).then(focusHeading, focusHeading).then(function () { openAskedNote(asked); });
    return {
      /** Back or Forward to another screen of this client's books */
      setView: function (report, period) {
        var moved = period !== undefined && !root.CBPeriodPick.same(period && period.from ? period : grantKit.viewState.period, grantKit.viewState.period);
        if (!viewKnown(report) || (report === grantKit.viewState.report && !moved)) return;
        grantKit.viewState.report = report;
        if (period !== undefined) usePeriod(root.CBPeriodPick.filled(period, grantKit.viewState.choices) || period);
        reload();
      },
      destroy: function () {
        host.innerHTML = '';
      }
    };
  }
  root.CBBooksGrantView = { mount: mount, duesVoice: grantKit.duesVoice };
})(typeof window !== 'undefined' ? window : globalThis);
