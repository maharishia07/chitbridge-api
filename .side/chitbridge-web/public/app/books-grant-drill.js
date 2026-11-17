/**
 * books-grant-drill.js — ACC-176c, THE AUDITOR'S DRILL: from a figure to the account's ledger, from a ledger line to its journal entry. READ ONLY.
 *
 * OWNS      the two sheets an auditor opens from books-grant-view.js: an account's LEDGER (date · entry no · what · party · Dr · Cr · running balance, with the opening, the period's total Dr and Cr and the closing as the server carried them)
 *           and a journal ENTRY (who made it, when, each line's account · party · Dr · Cr); a line of an entry opens its account's ledger; a line of a ledger opens its entry
 * CALLED BY books-grant-view.js (a trial balance, profit and loss or balance sheet row · a Day book row)
 * FLOW      openLedger(ctx, account) → GET /api/books/ledger/:account?limit&after (+ the same page's entries from GET /api/books/daybook?entries= for the party names and the entry sheet) → mountList; openEntry(ctx, entry) → paints the entry the Day book or the ledger page carried
 * CARD      04-network/ACC-176-AUDITOR-GRANT
 *
 * No write control: every read goes through CBBooksGrantApi.run with the headers of CBBooksActing (X-Books-For). It paints what the server answered; running balance, opening, closing and the period's totals are the server's own (a paged ledger carries them).
 * An entry's amount is the Dr side of its carried lines, set beside the Cr side: when the two differ the sheet says so, it never recomputes a third figure.
 *   CBBooksGrantDrill.openLedger · .openEntry · .amountOf
 */
(function (root) {
  'use strict';
  var PAGE = 100; /* a ledger is read a page at a time (DISCIPLINES §2); "Show more" asks for the next, by the server's own cursor */
  var MONEY = 'money';

  function words(s) {
    return typeof root.tx === 'function' ? root.tx(s) : s;
  }
  function $(id) {
    return root.document.getElementById(id);
  }
  /** the Dr side of an entry's carried lines: what the Day book shows as the entry's amount */
  function amountOf(entry) {
    return (entry.lines || []).reduce(function (sum, line) { return sum + Number(line.dr_minor || 0); }, 0);
  }
  function crOf(entry) {
    return (entry.lines || []).reduce(function (sum, line) { return sum + Number(line.cr_minor || 0); }, 0);
  }
  function whenWords(iso) {
    if (!iso) return '';
    return root.shopStamp(iso);
  }
  function read(ctx, key, params, query) {
    return root.CBBooksGrantApi.run(ctx.call, key, { params: params, query: query, headers: root.CBBooksActing.headers() });
  }
  function show(ctx, html) {
    ctx.sheet('<div class="bd-wrap" data-testid="bd-wrap">' + html + '</div>');
    var node = $('nw_sheet');
    if (node) node.className = 'sheet wide';
  }
  function refusal(ctx, failure) {
    if (failure && failure.status === 401) throw failure;
    show(ctx, '<h2>' + esc(words('Not shown')) + '</h2><div class="nw-why" role="status" data-testid="bd-why">' + esc((failure && failure.message) || words("Couldn't open this. Nothing was changed.")) + '</div>');
  }
  function fact(label, text, tid) {
    return '<span class="tag" data-testid="bd-fact-' + tid + '">' + esc(words(label)) + ': ' + esc(text) + '</span>';
  }

  /* ── an account's ledger ── */
  /** ctx = { call, sheet, mountList, day } · account = { code, name } */
  function openLedger(ctx, account) {
    var state = { account: account, lines: [], entries: {}, answer: null, next: null };
    show(ctx, '<h2>' + esc(account.code + ' ' + account.name) + '</h2><p class="sub" data-testid="bd-loading">' + esc(words('Opening the ledger…')) + '</p>');
    return page(ctx, state, null).then(function () { paintLedger(ctx, state); }, function (failure) { refusal(ctx, failure); });
  }
  /** one page of the ledger and, for the same entries, the Day book's lines (party names, who made it) */
  function page(ctx, state, after) {
    var query = { limit: PAGE, after: after };
    if (ctx.day) query.to = ctx.day;
    else if (ctx.period && ctx.period.from && ctx.period.to) { query.from = ctx.period.from; query.to = ctx.period.to; } /* D1 (A3C): the picked period travels; a ledger is never the server's default year-to-today under a 30 June trial balance */
    return read(ctx, 'readLedger', { account: state.account.code }, query).then(function (answer) {
      state.answer = answer;
      state.next = answer.next || null;
      var ids = (answer.lines || []).map(function (line) { return line.entry_id; }).filter(Boolean);
      state.lines = state.lines.concat(answer.lines || []);
      if (ctx.mk) ctx.mk.ingest(answer.lines, answer); /* ACC-358: each ledger line carries its entry's mark */
      if (!ids.length) return null;
      return read(ctx, 'readDaybook', {}, { entries: ids.join(','), from: answer.from, to: answer.to }).then(function (book) {
        (book.entries || []).forEach(function (entry) { state.entries[entry.entry_id] = entry; });
        if (ctx.mk) ctx.mk.ingest(book.entries, book);
      });
    });
  }
  function partyOf(state, line) {
    var entry = state.entries[line.entry_id], hit = null;
    if (!entry) return '';
    (entry.lines || []).forEach(function (l) {
      if (!hit && l.code === state.account.code && Number(l.dr_minor) === Number(line.dr_minor) && Number(l.cr_minor) === Number(line.cr_minor)) hit = l;
    });
    return (hit && hit.party_name) || '';
  }
  function paintLedger(ctx, state) {
    var answer = state.answer, currency = answer.currency, totals = answer.totals || {};
    var head = '<h2 data-testid="bd-title">' + esc(answer.account.code + ' ' + answer.account.name) + '</h2><p class="sub">' + esc(root.shopDay(answer.from) + ' → ' + root.shopDay(answer.to)) + '</p>';
    var facts = '<div class="nw-acts" data-testid="bd-facts">' +
      fact('Opening', root.CBBooksActing.figure(answer.opening_minor, currency), 'opening') + (totals.dr_minor != null ? fact('Total debit', root.CBBooksActing.figure(totals.dr_minor, currency), 'dr') + fact('Total credit', root.CBBooksActing.figure(totals.cr_minor, currency), 'cr') : '') + fact('Closing', root.CBBooksActing.figure(answer.closing_minor, currency), 'closing') + '</div>';
    var more = state.next ? '<div class="nw-acts"><button data-cbsid="NET005-B05" type="button" class="act quiet" id="bd_more" data-testid="bd-more">' + esc(words('Show more')) + '</button><span class="sub">' + esc(state.lines.length + ' ' + words('of') + ' ' + answer.total) + '</span></div>' : '';
    show(ctx, head + facts + '<div class="nw-list bd-list" id="bd_list" data-testid="bd-list"></div>' + more);
    if ($('bd_more')) $('bd_more').onclick = function () {
      page(ctx, state, state.next).then(function () { paintLedger(ctx, state); }, function (failure) { refusal(ctx, failure); });
    };
    var rows = state.lines.map(function (line, n) { return Object.assign({ _n: n, party: partyOf(state, line) }, line); });
    var cols = [['date', 'Date'], ['entry_no', 'Entry'], ['what', 'What it was'], ['party', 'Party'], ['dr_minor', 'Debit', MONEY], ['cr_minor', 'Credit', MONEY], ['running_minor', 'Balance', MONEY]];
    if (ctx.mk && state.answer.mark_actions) cols.push(['mark', 'Mark', 'mark']); /* ACC-358: the marker chip (cap-mark.js); absent when marking is not switched on */
    ctx.mountList($('bd_list'), {
      key: 'books-grant-ledger',
      csv: false,
      defaultCols: cols.map(function (c) { return c[0]; }),
      rows: function () { return rows; },
      id: function (row) { return row._n; },
      rowTid: function (row) { return 'bd-line-' + row._n; },
      columns: cols.map(function (c, i) {
        return {
          key: c[0], label: words(c[1]), prio: i < 2 || c[2] ? 1 : 2, keep: c[2] === 'mark', w: c[2] === 'mark' ? 190 : c[2] ? 120 : c[0] === 'what' ? 200 : 110, html: c[2] === 'mark',
          cell: function (row) { return c[2] === 'mark' ? ctx.mk.chip(row.entry_id) : c[2] === MONEY ? root.CBBooksActing.figure(row[c[0]], currency) : c[0] === 'date' && row.date ? root.shopDay(row.date) : row[c[0]] == null || row[c[0]] === '' ? '—' : String(row[c[0]]); },
          value: function (row) { return row[c[0]] == null ? '' : String(row[c[0]]); }
        };
      }),
      search: function (row) { return [row.date, row.entry_no, row.what, row.party].join(' '); },
      onOpen: function (row) {
        var entry = state.entries[row.entry_id];
        if (entry) openEntry(ctx, entry, answer.currency, function () { paintLedger(ctx, state); });
      },
      empty: { title: words('Nothing to show here'), body: words('This account has no entries in this period.') }
    });
  }

  /** ACC-358: the entry's mark chip and the one way to ask a question about it, from the drill (not drawn when marking is not switched on) */
  function markLine(ctx, entry) {
    if (!ctx.mk || !ctx.mk.state().may) return '';
    return '<div class="nw-acts" data-testid="bd-mark">' + ctx.mk.chip(entry.entry_id) + '</div>';
  }
  /** CMP062: the entry's evidence chip (the source document and its files), from the drill; nothing when the page has no evidence control */
  function evidenceLine(ctx, entry) {
    var chip = ctx.ev && ctx.ev.chip(entry);
    return chip ? '<div class="nw-acts" data-testid="bd-evidence">' + chip + '</div>' : '';
  }
  /** who made an entry and when: the source the server carried, in words */
  function madeByWords(src) {
    return [src.by ? words('Made by') + ' ' + src.by : '', src.recorded_at ? words('recorded') + ' ' + whenWords(src.recorded_at) : '', src.doc_at ? words('bill') + ' ' + whenWords(src.doc_at) : ''].filter(Boolean).join(' · ');
  }
  /* ── a journal entry ── */
  /** entry = one Day book entry (lines carry code, name, party_name, dr_minor, cr_minor) · back = how to return to the ledger it was opened from (or null) */
  function openEntry(ctx, entry, currency, back) {
    var shown = currency || ctx.currency, debit = amountOf(entry), credit = crOf(entry), madeBy = [madeByWords(entry.source || {}), root.CBBooksActing.postedByWords(entry)].filter(Boolean).join(' · ');
    var reversal = entry.reversed_by ? '<div class="nw-why" role="status" data-testid="bd-reversed">' + esc(words('Reversed by') + ' ' + entry.reversed_by) + '</div>' : '';
    show(ctx,
      (back ? '<button data-cbsid="NET005-B04" type="button" class="act quiet" id="bd_back" data-testid="bd-back">← ' + esc(words('Back to the ledger')) + '</button>' : '') +
      '<h2 data-testid="bd-title">' + esc(entry.entry_no) + '</h2><p class="sub">' + esc(root.shopDay(entry.posting_date) + ' · ' + entry.narration) + '</p>' +
      (madeBy ? '<p class="sub" data-testid="bd-who">' + esc(madeBy) + '</p>' : '') + reversal + evidenceLine(ctx, entry) + markLine(ctx, entry) +
      '<div class="nw-acts" data-testid="bd-facts">' + fact('Amount', root.CBBooksActing.figure(debit, shown), 'amount') + fact('Total debit', root.CBBooksActing.figure(debit, shown), 'dr') + fact('Total credit', root.CBBooksActing.figure(credit, shown), 'cr') +
      (debit === credit ? '' : '<span class="tag" data-testid="bd-unbalanced">' + esc(words('Debit and credit differ')) + '</span>') + '</div>' +
      '<div class="nw-list bd-list" id="bd_list" data-testid="bd-list"></div>');
    if ($('bd_back')) $('bd_back').onclick = back;
    var rows = (entry.lines || []).map(function (line, n) { return Object.assign({ _n: n, account: line.code + ' ' + line.name, party: line.party_name || '' }, line); });
    var cols = [['account', 'Account'], ['party', 'Party'], ['dr_minor', 'Debit', MONEY], ['cr_minor', 'Credit', MONEY]];
    ctx.mountList($('bd_list'), {
      key: 'books-grant-entry',
      csv: false,
      defaultCols: cols.map(function (c) { return c[0]; }),
      rows: function () { return rows; },
      id: function (row) { return row._n; },
      rowTid: function (row) { return 'bd-jl-' + row._n; },
      columns: cols.map(function (c, i) {
        return {
          key: c[0], label: words(c[1]), prio: i === 0 || c[2] ? 1 : 2, w: c[2] ? 120 : 200,
          cell: function (row) { return c[2] === MONEY ? (Number(row[c[0]]) ? root.CBBooksActing.figure(row[c[0]], shown) : '') : row[c[0]] == null || row[c[0]] === '' ? '—' : String(row[c[0]]); },
          value: function (row) { return row[c[0]] == null ? '' : String(row[c[0]]); }
        };
      }),
      search: function (row) { return row.account + ' ' + row.party; },
      onOpen: function (row) { openLedger(ctx, { code: row.code, name: row.name }); },
      empty: { title: words('Nothing to show here'), body: words('This entry has no lines.') }
    });
  }
  root.CBBooksGrantDrill = { openLedger: openLedger, openEntry: openEntry, amountOf: amountOf };
})(typeof window !== 'undefined' ? window : globalThis);
