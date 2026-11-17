/* bank-band.js — THE BAND over a bank statement's lines: the ONE painter shared by the no-login demo, the owner's Bank page and the adviser's seat of the same page (W15-18 to W15-23, W15-27).
 * OWNS      the band's words and shape: the account named large, the statement period and the number of lines, the presentation currency said ONCE ("All amounts in Australian dollars (AUD)", IAS 1 para 51(d)-(e)),
 *           the "Right account?" line, three equal slim tiles (Statement · Your books · Difference), the "n lines to go" line under them and the "n of m in your books" progress bar.
 * CALLED BY public/app/bank-demo.js · public/app/cap-bank.js (bankFinish). Loaded after lab-kit.js (the tiles are CBLabKit.figure CMP060, the bar its .lk-bar).
 * FLOW      a host gathers CARRIED facts (the parse, the statement check, the engine's figures) → rightAccount(facts) → html(band) → the host puts the string in its slot.
 * ⭐ NO MONEY IS COMPUTED HERE. Every figure arrives as text its host made with the ONE money formatter; every "agrees" is a comparison of two carried figures or the engine check's own item. A fact the file or the books
 *   do not carry is said as "not in this file" (never assumed, never defaulted): an unknown stays unknown.
 * ⭐ THE ENGINE'S CHECK IS THE SOURCE where it ran (CBBankStatementCheck: account, opening against the books and against the last closing, overlap, gap); this file only words its items. Without it the host passes the plain facts.
 * CARD      16-finance/bank-reconciliation-and-bank-rail
 * CONTROLS  CMP065 the bank band: D01 the band · D02 the right-account line · D03 the lines-to-go line (CMP060 the tiles, CMP021 the bar)
 */
(function (root) {
  'use strict';
  var NO_PLURAL = { yen: 1, yuan: 1, won: 1, baht: 1, renminbi: 1 };
  function sayText(text) {
    return typeof root.tx === 'function' ? root.tx(text) : text;
  }
  function many(count, one, other) {
    return count + ' ' + sayText(count === 1 ? one : other);
  }
  /** '2026-10-02' → '2 Oct 2026' */
  function dayText(iso) {
    var parts = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
    return parts ? +parts[3] + ' ' + monthNames('short')[+parts[2] - 1] + ' ' + parts[1] : String(iso || '');
  }
  /** the period as a person says it: "2 Oct to 31 Oct 2026" (the year once when both ends share it) */
  function periodText(from, to) {
    if (!from || !to) return '';
    var a = dayText(from),
      b = dayText(to);
    return a.slice(-4) === b.slice(-4) ? a.slice(0, -5) + ' ' + sayText('to') + ' ' + b : a + ' ' + sayText('to') + ' ' + b;
  }
  /** 'AUD' → "Australian dollars": the reader's own currency name (CBLocale.currencyName / Intl), the last word in lower case and plural */
  function currencyWords(code) {
    var name = code;
    try {
      name = (root.CBLocale && root.CBLocale.currencyName && root.CBLocale.currencyName(code)) || new Intl.DisplayNames(['en-AU'], { type: 'currency' }).of(code) || code;
    } catch (unavailable) {
      name = code;
    }
    if (name === code) return code;
    return String(name).replace(/(\S+)$/, function (last) {
      var low = last.toLowerCase();
      return NO_PLURAL[low] || /s$/.test(low) ? low : low + 's';
    });
  }
  /** the one currency line of the band: "All amounts in Australian dollars (AUD)" */
  function currencyLine(code) {
    return sayText('All amounts in') + ' ' + currencyWords(code) + ' (' + code + ')';
  }
  /* ── "Right account?": each fact as { id, state: 'ok' | 'bad' | 'none', text } ── */
  function item(id, state, text) {
    return { id: id, state: state, text: text };
  }
  /** the engine check's item of a code, or null */
  function checkItem(check, code) {
    return ((check && check.items) || []).filter(function (one) { return one.code === code; })[0] || null;
  }
  /** the line breaks the reader named while it checked the running balance */
  function balanceBreaks(parsed) {
    return ((parsed && parsed.warnings) || []).filter(function (words) { return /does not follow from the line before/.test(words); }).length;
  }
  /** 1 · the opening against the books */
  function openingFact(fact, parsed, check, books) {
    if (parsed.opening_minor == null) return item('opening', 'none', sayText('The file does not state its opening balance'));
    var differs = checkItem(check, 'opening_not_books') || (!check && books != null && Number(books) !== Number(parsed.opening_minor));
    if (differs) return item('opening', 'bad', sayText('Opening') + ' ' + fact.fmt(parsed.opening_minor) + ' ' + sayText('differs from your books') + (books != null ? ' (' + fact.fmt(books) + ')' : ''));
    var agreeWords = books != null || check ? sayText('agrees with your books') : sayText('(worked from the file)');
    return item('opening', 'ok', sayText('Opening') + ' ' + fact.fmt(parsed.opening_minor) + ' ' + agreeWords);
  }
  /** 2 · the running balance adds up line by line: the reader's own break warnings against the lines that carry a balance */
  function runningFact(parsed) {
    var carry = (parsed.lines || []).filter(function (line) { return line.balance_minor != null; }).length,
      breaks = balanceBreaks(parsed);
    if (!carry) return item('running', 'none', sayText('The file has no running balance to check'));
    if (breaks) return item('running', 'bad', sayText('Balance breaks on') + ' ' + many(breaks, 'line', 'lines') + ' ' + sayText('of') + ' ' + carry + ' (' + sayText('a line may be missing') + ')');
    return item('running', 'ok', sayText('Balance adds up on') + ' ' + carry + ' ' + sayText('of') + ' ' + carry + ' ' + sayText('lines'));
  }
  /** 3 · the currency */
  function currencyFact(fact, parsed) {
    var said = fact.statementCurrency || parsed.currency || '';
    if (said && fact.currency && said !== fact.currency) return item('currency', 'bad', sayText('The file is in') + ' ' + said + ', ' + sayText('the account in') + ' ' + fact.currency);
    return item('currency', 'ok', sayText('Currency') + ' ' + (fact.currency || said));
  }
  /** 4 · the account number: the file's tail against the one the account holds */
  function numberFact(fact, check) {
    var account = check && check.account,
      mismatch = checkItem(check, 'account_mismatch') || checkItem(check, 'account_unknown'),
      masked = (account && account.masked) || '';
    if (mismatch) return item('number', 'bad', mismatch.why);
    if (masked && fact.accountNumber) return item('number', 'ok', sayText('Account number') + ' ' + masked + ' ' + sayText('matches the account'));
    if (masked) return item('number', 'none', sayText('Account number') + ' ' + masked + ' ' + sayText('is in the file; the account holds none to compare'));
    if (fact.accountNumber) return item('number', 'none', sayText('Account no.') + ' ' + fact.accountNumber + ' ' + sayText('held; the file carries none'));
    return item('number', 'none', sayText('Account no.') + ': ' + sayText('not in this file'));
  }
  /** 5 · the earlier statement: continuity */
  function previousFact(fact, check) {
    var gap = checkItem(check, 'period_gap'),
      overlap = checkItem(check, 'period_overlap') || checkItem(check, 'period_repeat'),
      lastClose = checkItem(check, 'opening_not_last_closing');
    var broken = overlap || lastClose || gap;
    if (broken) return item('previous', 'bad', broken.why);
    if (fact.previous && fact.previous.to) return item('previous', 'ok', sayText('Follows the statement to') + ' ' + dayText(fact.previous.to) + (fact.previous.by ? ', ' + sayText('signed off by') + ' ' + fact.previous.by : ''));
    return item('previous', 'none', sayText('No earlier statement'));
  }
  /**
   * rightAccount(f) → [item]
   *   f.parsed {opening_minor, from, to, lines[], warnings[]} · f.check the engine's statement check (or null) · f.fmt(minor) the host's money text
   *   f.booksOpening_minor the books' balance the day before the statement starts, as carried (null when not read) · f.currency · f.statementCurrency
   *   f.accountNumber what the account HOLDS, masked ('****1234') or '' · f.previous { to, closing_minor, by } the last statement loaded before this one, or null
   */
  function rightAccount(fact) {
    var parsed = fact.parsed || {};
    return [
      openingFact(fact, parsed, fact.check, fact.booksOpening_minor),
      runningFact(parsed),
      currencyFact(fact, parsed),
      numberFact(fact, fact.check),
      previousFact(fact, fact.check)
    ];
  }
  var MARK = { ok: '✓', bad: '✕', none: '○' };
  /** the one small button that opens the "Right account?" facts (Fiori: the header stays one line; the detail is a press away). Open at once when any fact differs. */
  function toggleHtml(items, tid) {
    if (!items || !items.length) return '';
    var bad = items.some(function (one) { return one.state === 'bad'; }),
      agree = items.filter(function (one) { return one.state === 'ok'; }).length,
      open = items.length - agree;
    return '<button type="button" class="bb-rtoggle' + (bad ? ' bb-bad' : '') + '" data-bb-toggle aria-expanded="' + bad + '" data-testid="' + root.esc(tid) + '-toggle">' + root.esc(sayText('Right account?')) + ' ' + MARK.ok + ' ' + agree + (open ? ' · ' + (bad ? MARK.bad : MARK.none) + ' ' + open : '') + ' <span aria-hidden="true">▾</span></button>';
  }
  function rightHtml(items, testId, extraHtml) {
    var agree = items.filter(function (one) { return one.state === 'ok'; }).length,
      open = items.filter(function (one) { return one.state === 'none'; }).length;
    return (
      '<div class="bb-right' + (items.some(function (one) { return one.state === 'bad'; }) ? ' bb-has-bad' : '') + '"' + (items.some(function (one) { return one.state === 'bad'; }) ? '' : ' hidden') + ' data-cbsid="CMP065-D02" data-testid="' + root.esc(testId) + '" role="group" aria-label="' + root.esc(sayText('Right account?')) + '"><b>' + root.esc(sayText('Right account?')) + '</b>' +
      (agree ? '<span class="bb-sum bb-ok" data-testid="' + root.esc(testId) + '-agree">' + MARK.ok + ' ' + agree + ' ' + root.esc(sayText('agree')) + '</span>' : '') +
      (open ? '<span class="bb-sum bb-none" data-testid="' + root.esc(testId) + '-open">' + MARK.none + ' ' + open + ' ' + root.esc(sayText('not in the file')) + '</span>' : '') +
      items.map(function (one) {
        return '<span class="bb-chk bb-' + one.state + '" data-check="' + root.esc(one.id) + '" data-state="' + one.state + '"><span aria-hidden="true">' + MARK[one.state] + '</span> ' + root.esc(one.text) + '</span>';
      }).join('') + (extraHtml || '') + '</div>'
    );
  }
  /** the three figures of the band (Statement · Your books · Difference), or '' when the host gave no statement closing */
  function tilesHtml(fact, prefix, tied) {
    var label = fact.labelKit || root.CBLabKit;
    if (fact.statement == null || !label || !label.figure) return '';
    return (
      '<div class="bb-tiles" data-testid="' + root.esc(prefix) + '-tiles">' +
      label.figure({ label: sayText('Statement'), value: fact.statement, line: true }) +
      label.figure({ label: sayText('Your books'), value: fact.books, line: true }) +
      label.figure({ label: sayText('Difference'), value: fact.difference, line: true, loud: true, good: tied }) +
      '</div>'
    );
  }
  /** the bar of lines already in the books, or '' when the statement has no lines */
  function progressHtml(fact, prefix) {
    return fact.total
      ? '<div class="bb-progress"><div class="lk-bar" role="progressbar" aria-valuemin="0" aria-valuemax="' + fact.total + '" aria-valuenow="' + (fact.inBooks || 0) + '" aria-label="' + root.esc((fact.inBooks || 0) + ' ' + sayText('of') + ' ' + fact.total + ' ' + sayText('in your books')) + '"><i style="width:' + Math.round(((fact.inBooks || 0) / fact.total) * 100) + '%"></i></div><span class="bb-pnote" data-testid="' + root.esc(prefix) + '-progress">' + root.esc((fact.inBooks || 0) + ' ' + sayText('of') + ' ' + fact.total + ' ' + sayText('in your books')) + '</span></div>'
      : '';
  }
  /** the go row: the lines to go (or "Nothing left to add"), what is unexplained, the progress bar and the currency line */
  function goRowHtml(fact, prefix, tied, curHtml) {
    var go = tied ? sayText('Nothing left to add') : many(fact.toGo || 0, 'line to go', 'lines to go');
    return (
      '<div class="bb-gorow"><span class="bb-go" data-cbsid="CMP065-D03" data-testid="' + root.esc(prefix) + '-togo" aria-live="polite">' + root.esc(go) + (fact.unexplained ? ' · ' + root.esc(sayText('Unexplained')) + ' ' + root.esc(fact.unexplained) : '') + '</span>' + progressHtml(fact, prefix) + '</div>' + curHtml + '</div>'
    );
  }
  /** the head of the band: the account, its period and lines, the way back, the toggle, the currency (when no tiles) and the actions */
  function headHtml(fact, prefix, hasTiles, curHtml) {
    return (
      '<div class="bb-head"><h2 class="bb-name" data-testid="' + root.esc(prefix) + '-account">' + root.esc(fact.account || '') + '</h2>' +
      '<span class="bb-period" data-testid="' + root.esc(prefix) + '-period">' + root.esc(periodText(fact.from, fact.to)) + (fact.count != null ? ' · ' + root.esc(many(fact.count, 'line', 'lines')) : '') + '</span>' +
      (fact.change || '') + toggleHtml(fact.right, prefix) +
      (hasTiles ? '' : curHtml) +
      (fact.actions ? '<span class="bb-acts">' + fact.actions + '</span>' : '') + '</div>'
    );
  }
  /**
   * html(f) → the band
   *   f.account name · f.from · f.to · f.count lines · f.currency · f.change (html of the way back, "Wrong account? Change") · f.actions (html at the right of the figures: Add, Sign off, More)
   *   f.right [item] (rightAccount) · f.statement · f.books · f.difference (the host's money text, or '' when the statement's closing was not given)
   *   f.toGo · f.inBooks · f.total lines · f.unexplained (text shown only when it is not nil) · f.nil · f.tid (prefix of the testids)
   */
  function html(fact) {
    var prefix = fact.tid || 'bank-band',
      tied = !!fact.nil,
      tiles = tilesHtml(fact, prefix, tied),
      curHtml = '<span class="bb-cur" data-testid="' + root.esc(prefix) + '-currency">' + root.esc(currencyLine(fact.currency || '')) + '</span>';
    return (
      '<section class="bb' + (tied ? ' bb-nil' : '') + '" data-cbsid="CMP065-D01" data-testid="' + root.esc(prefix) + '" data-tied="' + tied + '" aria-label="' + root.esc(sayText('Bank statement')) + '">' +
      headHtml(fact, prefix, !!tiles, curHtml) +
      (fact.right && fact.right.length ? rightHtml(fact.right, prefix + '-right', fact.rightAct) : '') +
      (tiles ? '<div class="bb-row2">' : '') + tiles +
      (tiles ? goRowHtml(fact, prefix, tied, curHtml) : '') +
      '</section>'
    );
  }
  if (root.document && !root.CBBankBand) root.document.addEventListener('click', function (event) {
    var button = event.target.closest && event.target.closest('[data-bb-toggle]');
    if (!button) return;
    var panel = button.closest('.bb').querySelector('.bb-right'),
      open = panel.hidden;
    panel.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
  });
  root.CBBankBand = { html: html, rightAccount: rightAccount, periodText: periodText, currencyLine: currencyLine, currencyWords: currencyWords, dayText: dayText };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.CBBankBand;
})(typeof globalThis !== 'undefined' ? globalThis : this);
