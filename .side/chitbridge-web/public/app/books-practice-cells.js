/**
 * books-practice-cells.js — l16/firm-dash part of books-practice.js: the cells of the client list.
 *
 * OWNS      one client's cells (status, bank agreement, queries, year end, checked, what changed) and the detail sheet that explains them in words
 * CALLED BY books-practice.js (through root.CBPracticeKit); loaded before it
 * FLOW      practiceKit.statusCell(row) … → the cell's html from the server's row; practiceKit.detailHTML(row, band) → the sheet's lines
 * CARD      04-network/ACC-176-AUDITOR-GRANT
 *
 * Decides nothing and computes nothing: every state, date and reason is the server's.
 */
(function (root) {
  'use strict';
  var practiceKit = (root.CBPracticeKit = root.CBPracticeKit || {});
  practiceKit.statusCell = statusCell;
  practiceKit.trend = trend;
  practiceKit.basCell = basCell;
  practiceKit.queriesCell = queriesCell;
  practiceKit.yearLabel = yearLabel;
  practiceKit.yendCell = yendCell;
  practiceKit.bankWords = bankWords;
  practiceKit.checkedWords = checkedWords;
  practiceKit.checkedLeft = checkedLeft;
  practiceKit.checkedCell = checkedCell;
  practiceKit.figureOrWhy = figureOrWhy;
  practiceKit.sheetAddress = sheetAddress;
  practiceKit.sheetHTML = sheetHTML;
  practiceKit.detailHTML = detailHTML;
  practiceKit.bankCell = bankCell;
  practiceKit.changedCell = changedCell;
  function statusCell(r) {
    /* A3P rank 1: on Year end the Status is a chip only (the reasons move to the opened row), so Due fits at 1366 */
    var why = practiceKit.bandNow() !== 'pipeline' && r.health.reasons && r.health.reasons.length ? ' <span class="sub">· ' + practiceKit.escapeHtml(r.health.reasons.slice(0, 2).join(' · ')) + '</span>' : '';
    return '<span class="tag ' + (practiceKit.STATUS_CLASS[r.health.status] || '') + '" data-testid="practice-status-' + practiceKit.escapeHtml(r.entity_id) + '">' + practiceKit.escapeHtml(practiceKit.translate(r.health.words)) + '</span>' + why;
  }
  function trend(r) {
    var v = r.health.sales_trend_pct;
    return v == null ? '—' : (v > 0.5 ? '▲ ' : v < -0.5 ? '▼ ' : '► ') + (v > 0 ? '+' : '') + Math.round(v) + '%';
  }
  function basCell(r) {
    if (!r.bas.due_date) return '—';
    return practiceKit.escapeHtml(r.bas.form || '') + ' ' + practiceKit.escapeHtml(practiceKit.dayWords(r.bas.due_date)) + (r.bas.due_in_days != null && r.bas.due_in_days <= 30 ? ' <span class="sub">(' + practiceKit.escapeHtml(r.bas.due_in_days) + ' ' + practiceKit.escapeHtml(practiceKit.translate('days')) + ')</span>' : '');
  }
  /** the queries of a client in words: "2 waiting on client" · "1 on us" (with its age once over 14 days) · "—" */
  function queriesCell(r) {
    var q = r.queries, parts = [];
    if (!q.open) return '—';
    if (q.on_client) parts.push(practiceKit.escapeHtml(q.on_client) + ' ' + practiceKit.escapeHtml(practiceKit.translate('waiting on client')));
    if (q.on_us) parts.push(practiceKit.escapeHtml(q.on_us) + ' ' + practiceKit.escapeHtml(practiceKit.translate('on us')) + (q.waiting_over_14 ? ' <span class="sub">(' + practiceKit.escapeHtml(q.oldest_days) + ' ' + practiceKit.escapeHtml(practiceKit.translate('days')) + ')</span>' : ''));
    return parts.join(' · ');
  }
  /** the last year end's label for the header, from the server's own year_end (the pack's label as stored: '2025-26' → FY25-26) */
  function yearLabel() {
    var row = ((practiceKit.practiceState.data && practiceKit.practiceState.data.clients) || []).filter(function (r) { return r.year_end; })[0];
    return row ? 'FY' + String(row.year_end.fy).replace(/^dd(dd)/, '$1') : '';
  }
  /** the year-end cells: the same figures the Complete and Checked tiles count (the server's year_end), never the quarter */
  function yendCell(r) {
    var y = r.year_end;
    /* fix1117 F4: an older seed or a client with no year-end answer still reads: the stage when there is one, else the bank's own words (F2), never a bare dash */
    if (!y && !r.stage) return r.bank && r.bank.state === 'unexplained' ? practiceKit.escapeHtml(bankWords(r)) : '—';
    if (y && y.first_year) return practiceKit.escapeHtml(practiceKit.translate('First year'));
    if (!y) return '<span class="bp-yend" data-cbsid="HOM001-P16"><b data-testid="practice-stage-' + practiceKit.escapeHtml(r.entity_id) + '">' + practiceKit.escapeHtml(practiceKit.translate(practiceKit.stageWord(r.stage))) + '</b>' + blockerWords(r) + '</span>';
    var figures = practiceKit.escapeHtml(y.locked) + '/' + practiceKit.escapeHtml(y.of) + ' ' + practiceKit.escapeHtml(practiceKit.translate('locked')) + ' · ' + (y.bank_to_end ? practiceKit.escapeHtml(practiceKit.translate('bank to')) + ' ' + practiceKit.escapeHtml(shortDay(y.end)) : practiceKit.escapeHtml(bankWords(r)));
    /* F4 (17 Nov): ONE line per client, the stage and the one blocker; the figures sit in the title and one press away on the sheet (no second statement of the blocker, so the row is not two lines) */
    return r.stage ? '<span class="bp-yend" data-cbsid="HOM001-P16" title="' + practiceKit.escapeHtml(figures.replace(/<[^>]*>/g, '')) + '"><b data-testid="practice-stage-' + practiceKit.escapeHtml(r.entity_id) + '">' + practiceKit.escapeHtml(practiceKit.translate(practiceKit.stageWord(r.stage))) + '</b>' + blockerWords(r) + '</span>' : figures;
  }
  /** B1: what stands between the row and its next stage, in words, from the server's stage_blocker (never decided here): "· 3 months not locked" · "· no bank statement signed" · "· not checked" · "· 1 query open" */
  function blockerWords(r) {
    var blocker = r.stage_blocker;
    if (!blocker) return r.bank && r.bank.state === 'unexplained' ? ' · ' + practiceKit.escapeHtml(bankWords(r)) : ''; /* fix1117 F2: no blocker named, the bank's unexplained amount (the row's own field) still shows */
    if (blocker === 'months') return r.year_end ? monthsNotLocked(r.year_end) : '';
    if (blocker === 'bank') return ' · ' + practiceKit.escapeHtml(bankWords(r));
    if (blocker === 'checked') return ' · ' + practiceKit.escapeHtml(practiceKit.translate('not checked'));
    if (blocker === 'queries') return ' · ' + practiceKit.escapeHtml(r.queries.open) + ' ' + practiceKit.escapeHtml(practiceKit.translate(r.queries.open === 1 ? 'query open' : 'queries open'));
    return '';
  }
  /** the months of the year not yet locked, in words */
  function monthsNotLocked(yearEnd) {
    var left = yearEnd.of - yearEnd.locked;
    return ' · ' + practiceKit.escapeHtml(left) + ' ' + practiceKit.escapeHtml(practiceKit.translate(left === 1 ? 'month not locked' : 'months not locked'));
  }
  /** F1 (17 Nov): the bank's words from the one answer the Bank page reads (the client's newest sign-off, bank.state / unexplained_minor / reconciled_to): the same words the Bank page uses ('{a} unexplained' · 'Signed off to {d}'), never a second wording; 'bank not to year end' only when the answer carries no sign-off figure */
  function bankWords(r) {
    var b = r.bank || {};
    if (b.state === 'none') return practiceKit.translate('no bank statement signed');
    if (b.state === 'unexplained') return practiceKit.translate('{a} unexplained').replace('{a}', bankLeft(r));
    return b.reconciled_to ? practiceKit.translate('Signed off to {d}').replace('{d}', practiceKit.dayWords(b.reconciled_to)) : practiceKit.translate('bank not to year end');
  }
  function shortDay(iso) {
    try { return new Date(String(iso).slice(0, 10) + 'T00:00:00Z').toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' }); } catch (failure) { if (root.cbQuiet) root.cbQuiet('practice:shortday', failure); return practiceKit.dayWords(iso); }
  }
  /** W3 (Athi, 16 Nov): the Checked cell says the share WITH the counts, so a big book's 50% pending is not read like a small one's; the share rounds DOWN and is never 100% unless every entry is checked */
  function checkedWords(e) {
    if (!e) return '—';
    if (!(e.of > 0)) return practiceKit.translate('No entries');
    if (e.checked >= e.of) return practiceKit.translate('All') + ' ' + e.of + ' ' + practiceKit.translate('checked');
    return Math.min(99, Math.floor((e.checked * 100) / e.of)) + '% · ' + e.checked + ' ' + practiceKit.translate('of') + ' ' + e.of;
  }
  /** entries still to check: the cell's sort, largest first (a client with no figure sorts last) */
  function checkedLeft(r) {
    var e = r.year_end && r.year_end.entries;
    return e ? e.of - e.checked : -1;
  }
  function checkedCell(r) {
    var e = r.year_end && r.year_end.entries;
    if (!e && r.checked && r.checked.of > 0) e = { checked: r.checked.n, of: r.checked.of }; /* fix1117 F4: no year-end answer, the quarter's own count */
    return e ? practiceKit.escapeHtml(checkedWords(e)) + (e.capped ? ' <span class="sub">' + practiceKit.escapeHtml(practiceKit.translate('over 5000')) + '</span>' : '') : '—';
  }
  /** what a client row opens to: the health figures read from the client's own books, each with its words; a figure the server holds back says so */
  /** B7: why a figure is not there, from the server's health.withheld: costs the grant does not show → "costs not shared"; more than one currency → said so; null otherwise (then "—" is no data). Never 0. */
  function withheldWord(r, notCosts) {
    var w = (r.health && r.health.withheld) || {};
    return w.costs && !notCosts ? practiceKit.translate('costs not shared') : w.currencies ? practiceKit.translate('more than one currency') : '';
  }
  /** notCosts: a figure no cost gate hides (the cash in bank): only a mixed currency explains its absence */
  function figureOrWhy(r, value, shown, notCosts) {
    return value == null ? practiceKit.escapeHtml(withheldWord(r, notCosts) || '—') : shown;
  }
  /* A3P rank 2: the opened Year end row is the year-end sheet: five facts from the row's own year_end, queries and bas (the figures in the cells, never a second read), each a link into that client with the year picked.
     Addresses come from CBBooksActing (the one place that builds them): the client's screen (&view=, &fy=) and the auditor's Bank. No year_end (books not on): one sentence, no link. */
  var SHEET_LINK = 'HOM001-P15';
  function sheetAddress(r, view) {
    var A = root.CBBooksActing, fy = r.year_end && r.year_end.fy;
    if (!A || !fy) return '';
    var carry = '&fy=' + encodeURIComponent(fy), store = { id: r.entity_id };
    return view === 'bank' ? A.auditAddressOf(store, 'bank', carry) : A.clientAddress(store, '&view=' + encodeURIComponent(view) + carry);
  }
  function sheetLine(r, key, label, value, view) {
    var href = sheetAddress(r, view), text = '<b>' + value + '</b>';
    return '<div class="bp-fig" data-testid="practice-sheet-' + key + '-' + practiceKit.escapeHtml(r.entity_id) + '"><span class="sub">' + practiceKit.escapeHtml(practiceKit.translate(label)) + '</span>' +
      (href ? '<a class="bp-link" href="' + practiceKit.escapeHtml(href) + '" data-cbsid="' + SHEET_LINK + '" data-testid="practice-sheet-go-' + key + '-' + practiceKit.escapeHtml(r.entity_id) + '">' + text + '</a>' : text) + '</div>';
  }
  function sheetHTML(client) {
    var y = client.year_end;
    if (!y) return '<p class="sub" data-testid="practice-sheet-none-' + practiceKit.escapeHtml(client.entity_id) + '">' + practiceKit.escapeHtml(practiceKit.translate('Books are not on for this client yet.')) + '</p>';
    var e = y.entries, queryInfo = client.queries, locked = practiceKit.escapeHtml(y.locked) + ' ' + practiceKit.escapeHtml(practiceKit.translate('of')) + ' ' + practiceKit.escapeHtml(y.of);
    return '<div class="bp-sheet" data-testid="practice-sheet-' + practiceKit.escapeHtml(client.entity_id) + '">' +
      sheetLine(client, 'months', 'Months locked', locked, 'periods') +
      sheetLine(client, 'bank', 'Bank to year end', y.bank_to_end ? practiceKit.escapeHtml(practiceKit.translate('Yes, to')) + ' ' + practiceKit.escapeHtml(shortDay(y.end)) : practiceKit.escapeHtml(practiceKit.translate('Not yet')), 'bank') +
      sheetLine(client, 'checked', 'Entries checked', e ? practiceKit.escapeHtml(e.checked) + ' ' + practiceKit.escapeHtml(practiceKit.translate('of')) + ' ' + practiceKit.escapeHtml(e.of) : '—', 'daybook') +
      sheetLine(client, 'queries', 'Queries', queryInfo.open ? queriesCell(client) : practiceKit.escapeHtml(practiceKit.translate('None')), 'daybook') +
      sheetLine(client, 'due', 'Return due', client.bas.due_date ? basCell(client) : practiceKit.escapeHtml(practiceKit.translate('No date')), 'periods') + '</div>';
  }
  function whyLine(r) {
    var h = r.health;
    return h.reasons && h.reasons.length ? '<p class="sub">' + practiceKit.escapeHtml(practiceKit.translate('Why')) + ': ' + practiceKit.escapeHtml(h.reasons.join(' · ')) + '</p>' : '';
  }
  function detailHTML(client, band) {
    if (band === 'pipeline') return '<div class="bp-detail" data-testid="practice-detail-' + practiceKit.escapeHtml(client.entity_id) + '">' + sheetHTML(client) + practiceKit.stripHTML(client) + practiceKit.pairHTML(client) + whyLine(client) + '</div>';
    var health = client.health, held = withheldWord(client) || practiceKit.translate('Not shown');
    var line = function (label, value) { return '<div class="bp-fig"><span class="sub">' + practiceKit.escapeHtml(practiceKit.translate(label)) + '</span><b>' + value + '</b></div>'; };
    return (
      '<div class="bp-detail" data-testid="practice-detail-' + practiceKit.escapeHtml(client.entity_id) + '">' + practiceKit.stripHTML(client) + practiceKit.pairHTML(client) +
      line('Sales vs 3-month average', practiceKit.escapeHtml(trend(client))) +
      line('Margin this quarter', figureOrWhy(client, health.gross_margin_pct, practiceKit.escapeHtml(health.gross_margin_pct) + '%')) +
      line('Cash and bank', figureOrWhy(client, health.cash_minor, practiceKit.escapeHtml(practiceKit.money(health.cash_minor, client.currency)), true)) +
      line('Bills due in 30 days', health.bills_due_30_minor == null ? practiceKit.escapeHtml(held) : practiceKit.escapeHtml(practiceKit.money(health.bills_due_30_minor, client.currency))) +
      line('Cash for those bills', health.bills_due_30_minor == null ? practiceKit.escapeHtml(held) : health.cash_days == null ? practiceKit.escapeHtml(practiceKit.translate('Covers them')) : practiceKit.escapeHtml(practiceKit.translate('Runs out in')) + ' ' + practiceKit.escapeHtml(health.cash_days) + ' ' + practiceKit.escapeHtml(practiceKit.translate('days'))) +
      line('Customers owe, over 60 days late', health.receivables_over60_minor == null ? practiceKit.escapeHtml(held) : practiceKit.escapeHtml(practiceKit.money(health.receivables_over60_minor, client.currency)) + (health.receivables_over60_share_pct == null ? '' : ' (' + practiceKit.escapeHtml(health.receivables_over60_share_pct) + '%)')) +
      line('Bank', client.bank.state === 'none' ? practiceKit.escapeHtml(practiceKit.translate('No statement')) : client.bank.state === 'reconciled' ? practiceKit.escapeHtml(practiceKit.translate('Reconciled')) + ' ' + practiceKit.escapeHtml(practiceKit.translate('to')) + ' ' + practiceKit.escapeHtml(practiceKit.dayWords(client.bank.reconciled_to)) : practiceKit.escapeHtml(bankLeft(client)) + ' ' + practiceKit.escapeHtml(practiceKit.translate('unexplained'))) +
      line('Profit this quarter', figureOrWhy(client, health.profit_quarter_minor, practiceKit.escapeHtml(practiceKit.money(health.profit_quarter_minor, client.currency)))) +
      line('Months not locked', practiceKit.escapeHtml(client.months_unlocked)) +
      line('Access ends', practiceKit.escapeHtml(practiceKit.dayWords(client.grant.expires_at))) +
      whyLine(client) +
      '</div>'
    );
  }
  /** what is left unexplained, as the api carries it: one figure per currency (CUR-1), never two currencies added; an older answer's one figure in the client's currency */
  function bankLeft(r) {
    var b = r.bank, lines = b.by_currency || [];
    return lines.length ? lines.map(function (l) { return practiceKit.money(l.unexplained_minor, l.currency); }).join(' · ') : practiceKit.money(b.unexplained_minor, b.currency || r.currency);
  }
  /** the bank as the client's signed statements carry it: reconciled to a date, or the amount left unexplained, or no statement signed */
  function bankCell(r) {
    var b = r.bank;
    if (b.state === 'none') return '<span class="sub">' + practiceKit.escapeHtml(practiceKit.translate('No statement')) + '</span>';
    var to = practiceKit.escapeHtml(practiceKit.translate('to')) + ' ' + practiceKit.escapeHtml(practiceKit.dayWords(b.reconciled_to));
    return b.state === 'unexplained' ? '<span data-testid="practice-bank-' + practiceKit.escapeHtml(r.entity_id) + '">' + practiceKit.escapeHtml(bankLeft(r)) + ' ' + practiceKit.escapeHtml(practiceKit.translate('unexplained')) + '</span><br><span class="sub">' + to + '</span>' : practiceKit.escapeHtml(practiceKit.translate('Reconciled')) + ' <span class="sub">' + to + '</span>';
  }
  /** rank 10: the quiet warning on a row, the server's own count (never added up here): 'N since I checked', or 'N since access began' before the first Mark as checked; a link to the changed entries (the Day book, newest first). Nothing shows when it is 0. */
  var CHANGED_LINK = 'HOM001-B05';
  function changedCell(r) {
    var c = r.changed, A = root.CBBooksActing;
    if (!c || !(c.n > 0)) return '';
    var words = c.n + ' ' + practiceKit.translate(c.never ? 'since access began' : 'since I checked'), title = practiceKit.translate('Books changed since your last check') + (c.since ? ' · ' + practiceKit.dayWords(c.since) : '');
    var href = A && A.clientAddress ? A.clientAddress({ id: r.entity_id }, '&view=daybook&since=mine') : '';
    return href ? '<a class="bp-link" href="' + practiceKit.escapeHtml(href) + '" title="' + practiceKit.escapeHtml(title) + '" data-cbsid="' + CHANGED_LINK + '" data-testid="practice-changed-' + practiceKit.escapeHtml(r.entity_id) + '">' + practiceKit.escapeHtml(words) + '</a>' : practiceKit.escapeHtml(words);
  }
})(typeof window !== 'undefined' ? window : globalThis);
