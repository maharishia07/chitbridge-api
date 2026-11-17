/**
 * books-grant-list.js — ACC-176 part of books-grant-view.js: the list a read is shown in.
 *
 * OWNS      the list configuration of one read (columns, search, drill, empty state), the Day book's filters and their address, its keyboard (c checks, q asks), and the two aged tables of Who owes whom
 * CALLED BY books-grant-view.js (through root.CBBooksGrantKit)
 * FLOW      kit.paintRows(host, report) → CBList mounted in host; the narrowing is remembered and written to the address
 * CARD      04-network/ACC-176-AUDITOR-GRANT
 *
 * Paints what the server answered and computes nothing. Loaded before books-grant-view.js (network.html).
 */
(function (root) {
  'use strict';
  var grantKit = root.CBBooksGrantKit; /* created by books-grant-reports.js, which loads first */
  grantKit.paintRows = paintRows;
  grantKit.duesVoice = duesVoice;
  function paintRows(host, report) {
    if (report.panels) return paintDues(host, report);
    var rows = report.rows(grantKit.viewState.answer || {}).concat(grantKit.totalRows(report.k, grantKit.viewState.answer || {})).map(function (row, n) {
      return Object.assign({ _n: n }, row);
    });
    var config = Object.assign({ foldHead: true } /* a phone's head folds to one chip */, listConfig(report, rows));
    if (report.k === 'daybook') narrowDaybook(host, config);
    grantKit.viewState.o.mountList(host, config);
    if (report.k === 'daybook') { wireDaybook(host, report); root.setTimeout(function () { rememberNarrowing(host); }, 0); }
  }
  /* ── A3C rank 3: review by exception. The Day book's Mark · Evidence · Type filters (books-grant-filters.js) on the one list control; the choice is remembered for this client and rides the address (&dbf_mark= &dbf_ev= &dbf_kind=) ── */
  function narrowDaybook(host, config) {
    var F = root.CBBooksGrantFilters;
    if (!F) return;
    var all = F.filtersFor(grantKit.viewState.mk, { fl: grantKit.flagsOn() ? grantKit.viewState.fl : null, period: function () { return grantKit.viewState.period; }, currency: function () { return grantKit.viewState.answer && grantKit.viewState.answer.currency; }, region: function () { return grantKit.viewState.answer && grantKit.viewState.answer.country; }, rows: function () { return (grantKit.viewState.answer && grantKit.viewState.answer.entries) || []; } });
    config.filters = all.filter(function (f) { return f.key !== 'mark' || grantKit.markable({ k: 'daybook' }); });
    if (grantKit.viewState.dbf === undefined) grantKit.viewState.dbf = F.fromAddress(root.location.search); /* the first Day book of this client reads the address; later ones, what the person chose */
    var kept = {};
    config.filters.forEach(function (f) { if (grantKit.viewState.dbf[f.key]) kept[f.key] = grantKit.viewState.dbf[f.key]; });
    config.preset = { filt: kept };
  }
  /** after any press or change in the list: remember the narrowing and write it to the address (replace, never a new history entry) */
  function rememberNarrowing(host) {
    var filters = root.CBBooksGrantFilters, inst = host.__cbl;
    if (!filters || !inst || !inst.r) return;
    grantKit.viewState.dbf = JSON.parse(JSON.stringify(inst.r.filt || {})); /* the list's own remembered choices (api.state() also needs its column choices, which a fresh list has not made) */
    if (grantKit.afterYearEnd() !== !!grantKit.viewState.yeRead && grantKit.current().k === 'daybook' && !grantKit.viewState.day) grantKit.reload(); /* Year end · Dated after it is a different read (the days after the period): once per change, never in a loop */
    writeNarrowingAddress(filters);
  }
  /** the narrowing rides the address (replace, never a new history entry) */
  function writeNarrowingAddress(filters) {
    if (!root.history || !root.history.replaceState) return;
    try {
      var url = narrowedAddress(filters);
      if (url !== root.location.pathname + root.location.search + (root.location.hash || '')) root.history.replaceState(root.history.state, '', url);
    } catch (failure) { if (root.cbQuiet) root.cbQuiet('books-grant:narrowing', failure); }
  }
  /** this page's address with the Day book's narrowing in place of the old one */
  function narrowedAddress(filters) {
    var query = new root.URLSearchParams(root.location.search);
    filters.paramNames().forEach(function (name) { query.delete(name); });
    var more = filters.toAddress(grantKit.viewState.dbf), text = query.toString() + (more ? (query.toString() ? '&' : '') + more : '');
    var url = root.location.pathname + (text ? '?' + text : '') + (root.location.hash || '');
    return url;
  }
  /** A3C rank 8: on a focused Day book row "c" checks it and moves down, "q" opens its question; never while typing */
  function wireDaybook(host, report) {
    if (host.__bvKeys) return;
    host.__bvKeys = true;
    var settle = function () {
      if (!host.isConnected) { root.document.removeEventListener('change', settle); root.document.removeEventListener('click', settle); return; }
      root.setTimeout(function () { rememberNarrowing(host); }, 0);
    };
    root.document.addEventListener('change', settle); /* the Filters pop-up sits outside the list: listen on the page */
    root.document.addEventListener('click', settle);
    host.addEventListener('keydown', function (event) { onRowKey(host, report, event); });
  }
  /** a key on a focused Day book row: c checks it and moves down, q opens its question */
  function onRowKey(host, report, event) {
    var keyed = keyedRow(host, report, event);
    if (!keyed) return;
    event.preventDefault();
    var entry = keyed.entry, mark = keyed.mark;
    if (event.key === 'q') { mark.sheet(entry.entry_id, { title: entry.entry_no, opener: keyed.rowEl }); return; }
    var rowsNow = [].slice.call(host.querySelectorAll('[data-row]')), next = rowsNow[rowsNow.indexOf(keyed.rowEl) + 1];
    if (mark.mayCheck(entry.entry_id) && mark.markOf(entry.entry_id).state === 'none') mark.set(entry.entry_id, 'clear', '', null);
    if (next) next.focus();
  }
  /** the row, its entry and the mark helper a key press is for (null when the key is not ours: typing, a modifier, marking off, no row) */
  function keyedRow(host, report, event) {
    var mark = grantKit.viewState.mk;
    if (!isRowKey(event) || !mark || !grantKit.markable(report)) return null;
    var rowEl = event.target.closest('[data-row]');
    if (!rowEl) return null;
    var entry = report.rows(grantKit.viewState.answer || {})[Number(rowEl.getAttribute('data-row'))];
    return entry && entry.entry_id ? { rowEl: rowEl, entry: entry, mark: mark } : null;
  }
  /** c or q, on its own, and not while typing in a field */
  function isRowKey(event) {
    var target = event.target;
    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || !target || !target.closest) return false;
    if (event.key !== 'c' && event.key !== 'q') return false;
    return !(/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable);
  }
  /** W21: the two headings in the reader's voice: a firm reads "Customers owe <client>" and "<client> owes suppliers"; the owner's own books say you (no member = the owner) */
  function duesVoice(client) {
    return client ? { customer: grantKit.words('Customers owe') + ' ' + client, supplier: client + ' ' + grantKit.words('owes suppliers') } : { customer: grantKit.words('Customers owe you'), supplier: grantKit.words('You owe suppliers') };
  }
  /** E15: the empty side of Who owes whom in the reader's voice, as the owner's own Dues says it ("Nobody owes you money" · "You owe nobody") */
  function duesNobody(client, who) {
    if (who === 'customer') return client ? grantKit.words('Nobody owes') + ' ' + client : grantKit.words('Nobody owes you money');
    return client ? client + ' ' + grantKit.words('owes nobody') : grantKit.words('You owe nobody');
  }
  /** the aged figures of one row (the server's follow_up, days past due) as the table's columns */
  function agedRow(row) {
    var fu = row.follow_up || {};
    return Object.assign({}, row, { age_not_due: fu.not_due, age_d0_30: fu.d0_30, age_d31_60: fu.d31_60, age_d61_90: fu.d61_90, age_d90_plus: fu.d90_plus });
  }
  /** the total row of one side: the server's own aged_totals (nothing is added up here) */
  function agedTotalRow(who, total) {
    if (!total) return [];
    return [{ _total: true, name: grantKit.words('Total'), side: who, age_not_due: total.not_due, age_d0_30: total.d0_30, age_d31_60: total.d31_60, age_d61_90: total.d61_90, age_d90_plus: total.d90_plus, balance_minor: total.balance_minor }];
  }
  /** Who owes whom: two aged tables, customers owe and the shop owes suppliers (Current · 1–30 · 31–60 · 61–90 · 90+ days past due), each with its total row, no net total */
  function paintDues(host, report) {
    var all = report.rows(grantKit.viewState.answer || {}), voice = duesVoice(grantKit.viewState.o && grantKit.viewState.o.member && grantKit.viewState.o.member.name), totals = (grantKit.viewState.answer && grantKit.viewState.answer.aged_totals) || {};
    var member = grantKit.viewState.o && grantKit.viewState.o.member && grantKit.viewState.o.member.name, heads = { customer: voice.customer, supplier: voice.supplier };
    /* fd17: ONE heading line per side; a side with nobody owing is that line plus its sentence (no list, no head), the sentence is still the side's own (bv-dues-customers / bv-dues-suppliers) */
    host.classList.add('bv-dues');
    host.innerHTML = ['customer', 'supplier'].map(function (who) {
      var empty = !all.some(function (row) { return row.side === who; }), tid = who === 'customer' ? 'customers' : 'suppliers', id = who === 'customer' ? 'bv_dues_c' : 'bv_dues_s';
      return '<div class="bv-dues-side' + (empty ? ' bv-dues-nil' : '') + '"><h3 class="sub" data-testid="bv-dues-' + tid + '-head">' + esc(heads[who]) + '</h3>' +
        (empty ? '<span class="tag" id="' + id + '" data-testid="bv-dues-' + tid + '">' + esc(duesNobody(member, who)) + '</span>' : '<div id="' + id + '" data-testid="bv-dues-' + tid + '"></div>') + '</div>';
    }).join('');
    ['customer', 'supplier'].forEach(function (who) {
      var parties = all.filter(function (row) { return row.side === who; }).map(agedRow);
      if (!parties.length) return; /* said in the heading line above */ /* E15: the server drops a party with nothing open; a side with no party is an empty sentence, never a lone Total row */
      var rows = (parties.length ? parties.concat(agedTotalRow(who, totals[who])) : []).map(function (row, n) { return Object.assign({ _n: n }, row); });
      var config = listConfig(report, rows);
      config.key = 'books-grant-dues-' + who;
      config.empty = { title: duesNobody(grantKit.viewState.o && grantKit.viewState.o.member && grantKit.viewState.o.member.name, who) };
      grantKit.viewState.o.mountList(grantKit.$(who === 'customer' ? 'bv_dues_c' : 'bv_dues_s'), Object.assign({ foldHead: true }, config));
    });
  }
  /** the Mark column is drawn only when the server says marking is on */
  function shownCols(report) {
    var last = ['pl', 'tb', 'bs'].indexOf(report.k) >= 0 && !grantKit.compareDrawn(report) ? grantKit.CMP_COLS : [];
    var cols = report.cols.filter(function (column) { return (column[2] !== 'mark' || grantKit.markable(report)) && (column[2] !== 'flag' || grantKit.flagsOn()) && (column[2] !== 'explain' || grantKit.explainOn()) && last.indexOf(column[0]) < 0; });
    return report.k === 'daybook' && grantKit.viewState.since ? cols.concat([['recorded_text', 'Posted']]) : cols; /* rank 10: the changed list says when and by whom each entry was posted */
  }
  var HTML_KINDS = ['mark', 'flag', 'evidence', 'risk', 'explain']; /* the columns whose cell is html */
  var HTML_NAMES = ['change_minor', 'party_ref', 'lock_note'];
  var KEPT_KINDS = ['mark', 'flag', 'evidence']; /* the Mark and Evidence chips and the Party · ref are never cut to make room (list-ctl keep) */
  /** an amount, a percent, a net balance or a risk count: right-aligned */
  function isNumberColumn(column) {
    return [grantKit.MONEY, grantKit.PCT, grantKit.DRCR, 'risk'].indexOf(column[2]) >= 0;
  }
  /** a cell of html (escaped where it was built) rather than text */
  function isHtmlColumn(column) {
    return HTML_KINDS.indexOf(column[2]) >= 0 || HTML_NAMES.indexOf(column[0]) >= 0;
  }
  /** which columns stay on a narrow screen: the first, the name, the party and the amounts (1), the rest go first (2) Last year and % go first on a narrow screen: the amount and its change stay */
  function columnPriority(column, index) {
    if (index === 0 || column[0] === 'name' || column[0] === 'party_ref' || column[2] === 'risk') return 1;
    return column[2] === grantKit.MONEY && grantKit.CMP_COLS.indexOf(column[0]) < 0 ? 1 : 2;
  }
  /** a column's width: its own in the Day book, else by what it holds */
  function columnWidth(column) {
    if (grantKit.DAYBOOK_W[column[0]]) return grantKit.DAYBOOK_W[column[0]];
    if (column[2] === 'mark') return 190;
    return column[2] === grantKit.MONEY ? 140 : 180;
  }
  /** one column of the list: how it is headed, sized, sorted, kept and painted */
  function listColumn(column, index) {
    return {
      html: isHtmlColumn(column),
      key: column[0],
      label: grantKit.words(column[1]),
      prio: columnPriority(column, index),
      num: isNumberColumn(column),
      sort: column[2] === 'risk' ? true : undefined, dir0: column[2] === 'risk' ? -1 : undefined, /* Risk is the one Day book column the reader sorts: most risks first (a press on the header; the page opens in book order) */
      keep: KEPT_KINDS.indexOf(column[2]) >= 0 || column[0] === 'party_ref',
      w: columnWidth(column),
      cell: function (row) {
        return grantKit.figure(row, column);
      },
      value: function (row) {
        if (column[2] === 'risk') return (row.risk_list || []).length;
        return row[column[0]] == null ? '' : String(row[column[0]]);
      }
    };
  }
  /** what a click on a row opens: an account's ledger or an entry (drill), a Months row's Day book; nothing else */
  function rowOpener(report) {
    if (report.drill) return function (row) { grantKit.drill(report, row); };
    if (report.k !== 'periods') return undefined;
    return function (row) { if (row.start_date && row.end_date) grantKit.openMonth(String(row.start_date).slice(0, 10), String(row.end_date).slice(0, 10)); }; /* a Months row opens that month's Day book */
  }
  /** the list's configuration for one report: its columns, search, drill and empty state */
  var SEARCH_FROM = 10;
  var BAR_FROM = 12;
  function listConfig(report, rows) {
    return {
      key: 'books-grant-' + report.k,
      /* R4 17 Nov: no first sort. The Day book opens in the book's own order (day, then number: the api's order); the risk-first order opened it with the three after-period-end entries of June 2026 above July 2025 and, at 1366, the Risk column is not even in view to explain why. Most risks first is one press on Risk (kept for the reader), or the Risk filters below */
      csv: false /* read only: no copy of the books leaves this screen */,
      tools: { search: rows.length >= SEARCH_FROM, bar: rows.length > BAR_FROM } /* W19: a short list is read at a glance; no search box under ten rows, no tools bar up to twelve (T6: first data by 20% / 30%) */,
      defaultCols: shownCols(report).map(function (column) { return column[0]; }) /* an auditor sees every column the server sent (Credit, Amount), not the list's first three */,
      rows: function () {
        return rows;
      },
      id: function (row) {
        return row._n;
      },
      rowTid: function (row) {
        return 'bv-row-' + row._n;
      },
      columns: shownCols(report).map(listColumn),
      search: function (row) {
        return report.cols
          .map(function (column) {
            return row[column[0]];
          })
          .join(' ');
      },
      rowClass: function (row) { return row.change_over ? 'bv-over' : ''; },
      onOpen: rowOpener(report),
      empty: report.k === 'daybook' && grantKit.viewState.since ? { title: grantKit.words('Nothing has changed since your last check'), body: grantKit.words('No entries were posted since then.') } : { title: grantKit.words('Nothing to show here'), body: grantKit.words(grantKit.viewState.day || !grantKit.viewState.range ? 'These books have no entries for this day.' : 'These books have no entries in this period.') }
    };
  }
})(typeof window !== 'undefined' ? window : globalThis);
