/* bank-demo-report.js — the books-after table, the bank reconciliation statement and the three cards (nothing loaded yet, lines added, a file that could not be read) of public/bank-demo.html (split from bank-demo.js).
 * OWNS      the painting of those views from the engine's carried figures: the bank-account ledger as it will read, the reconciliation laid out the way an auditor reads one (books, the statement lines not
 *           yet in them, the statement, the difference, a tick ONLY when no statement line is left outside the books), and the cards.
 * FLOW      bank-demo.js paint() → report.paintBooks / paintBrs / the cards → html into the three panes; nothing is read back
 * CALLED BY public/app/bank-demo.js (CBBankDemoReport.create(host)); loaded before it by public/bank-demo.html.
 * ⭐ NO MONEY IS COMPUTED HERE: every figure is one the engines carried (brs, ledger, line amounts); a subtotal is shown only when the engine carries it (brs.not_in_books).
 * CARD      16-finance/bank-reconciliation-and-bank-rail
 * CONTROLS  BKS017-R90 the report · BKS017-B14 print · BKS017-B15 see the reconciliation · BKS017-B16 deal with the lines left · BKS017-N02 a problem · BKS017-B17 try again · BKS017-B18 the column map
 */
(function (root) {
  'use strict';
  var host = null /* the page's own functions (el, amountText, standing, countsOf …), given by create() */;
  function successCard(added) {
    if (!added) return '';
    return (
      '<div class="bd-card" data-testid="bd-added"><div class="bd-mark" aria-hidden="true">✓</div><h2>' + esc(host.plural(added.count, 'line', 'lines') + ' added to the demo books') + '</h2>' +
      '<p>The bank account now reads <b>' + esc(added.balance) + '</b>.' + (added.open ? ' ' + esc(host.plural(added.open, 'line still needs', 'lines still need')) + ' you, and those are the only lines not in the books.' : ' Every statement line is in the books.') + '</p>' +
      '<div class="bd-card-acts"><button type="button" class="bd-btn bd-go" data-act="view" data-v="brs" data-cbsid="BKS017-B15">See the bank reconciliation</button>' +
      (added.open ? '<button type="button" class="bd-btn" data-act="firstneed" data-cbsid="BKS017-B16">Deal with the ' + added.open + '</button>' : '') + '</div>' +
      '<p class="bd-why">Demo: nothing was saved. Start again to run it again.</p></div>'
    );
  }

  function emptyCard() {
    return (
      '<div class="bd-card" data-testid="bd-empty"><div class="bd-mark" aria-hidden="true">' + host.labKit.badge({ icon: 'bank' }) + '</div><h2>Start with a bank statement</h2>' +
      '<p>Load the sample, or your own CSV from your bank. We compare it with the books, show what is missing, and add it only when you say so.</p>' +
      '<p class="bd-why">A file you load stays on this device.</p></div>'
    );
  }

  function problemCard(loadRefusal) {
    if (!loadRefusal) return '';
    var map = loadRefusal.text ? '<button type="button" class="bd-btn" data-act="showmap" data-cbsid="BKS017-B18">Tell us which column is which</button>' : '';
    return (
      '<div class="bd-problem" role="alert" data-cbsid="BKS017-N02"><b>' + esc(loadRefusal.why) + '</b>' + (map ? '<span>The first row may name columns we do not know.</span>' + map : '') +
      '<button type="button" class="bd-btn" data-act="retry" data-cbsid="BKS017-B17">Try again</button></div>'
    );
  }

  function paintBooks(model, posted, openingMinor) {
    var rows = (model.projection && model.projection.ledger) || [],
      ready = host.countsOf(model).ready,
      said = ready ? 'The bank account as it will read once the ' + host.plural(ready, 'ready line is', 'ready lines are') + ' in (opening ' + host.amountText({ amount_minor: openingMinor, currency: host.CURRENCY }) + '). Preview: not yet in the books.' : posted ? 'The bank account as it reads now, with the ' + host.plural(posted, 'line', 'lines') + ' added in this demo marked.' : 'The bank account as it reads now. Nothing is waiting to be added.';
    host.el('bd_books').innerHTML =
      '<p class="bd-note">' + esc(said) + '</p>' +
      '<table class="bd-table"><thead><tr><th>Date</th><th>What</th><th class="bd-r">In (AUD)</th><th class="bd-r">Out (AUD)</th><th class="bd-r">Balance (AUD)</th></tr></thead><tbody>' +
      rows.map(function (r) {
        var proposed = r.state === 'proposed',
          mine = /^DEMO-/.test(r.entry_no || '');
        return '<tr class="' + (proposed ? 'bd-prop' : '') + '"><td class="bd-d">' + esc(host.preview.dateText(r.date)) + '</td><td>' + esc(r.narration) + (proposed ? ' ' + host.tag('go-tag', 'To add') : mine ? ' ' + host.tag('ok', 'Added') : '') + '</td><td class="bd-m">' + (host.preview.minorOf(r.dr) ? esc(host.amountText(r.dr)) : '') + '</td><td class="bd-m">' + (host.preview.minorOf(r.cr) ? esc(host.amountText(r.cr)) : '') + '</td><td class="bd-m">' + esc(host.amountText(r.balance)) + '</td></tr>';
      }).join('') + '</tbody></table>';
  }

  function zeroMoney() {
    return host.amountText({ amount_minor: 0, currency: host.CURRENCY });
  }
  /** one line of the report: its date, the words, the carried amount */
  function itemRow(date, words, minor) {
    return '<tr class="bd-i"><td>' + esc(host.preview.dateText(date)) + '</td><td>' + esc(words) + '</td><td class="bd-r">' + esc(host.amountText({ amount_minor: minor, currency: host.CURRENCY })) + '</td></tr>';
  }
  /** the group's heading and its lines; a group with none is one row with 0.00, so the statement never looks unfinished */
  function groupRows(heading, rows) {
    if (!rows.length) return '<tr class="bd-i"><td colspan="2">' + heading + '</td><td class="bd-r">' + zeroMoney() + '</td></tr>';
    return '<tr class="bd-g"><td colspan="3">' + heading + ' (' + rows.length + ')</td></tr>' + rows.join('');
  }
  /** a total row, shown only when the engine carries the figure (never added up here) */
  function totalRow(words, money) {
    return money ? '<tr class="bd-k"><td colspan="2">' + words + '</td><td class="bd-r">' + esc(host.amountText(money)) + '</td></tr>' : '';
  }
  /** the last row: the difference the engine carried, a pending note while lines are outside the books, and the tick ONLY when none is */
  function differenceRow(recon, outsideCount, done) {
    var pending = done ? '' : ' <span class="bd-pending">' + esc(host.plural(outsideCount, 'statement line', 'statement lines') + ' not in the books yet') + '</span>';
    var tick = done ? ' <span class="bd-tick" aria-label="Reconciled">\u2713</span>' : '';
    return '<tr class="bd-res"><td colspan="2">Difference' + pending + '</td><td class="bd-r">' + esc(host.amountText(recon.difference_before).replace(/^-/, '')) + tick + '</td></tr>';
  }
  function reportHead(recon, model) {
    return '<header class="bd-sheet-h"><div><h2>Bank reconciliation</h2><p class="bd-sheet-sub"><b>Demo, sample data</b> \u00b7 ' + esc(host.ACCOUNT) + ' \u00b7 as at ' + esc(host.dateWords(recon.statement_date || host.lastDate(model))) + ' \u00b7 amounts in ' + host.CURRENCY + '</p></div>' +
      '<div class="bd-sheet-acts"><button type="button" class="lk-btn" data-act="print" data-cbsid="BKS017-B14">Print</button><button type="button" class="bd-link" data-act="view" data-v="lines" data-cbsid="BKS017-B29">Back to the lines</button><button type="button" class="bd-link" data-act="reset" data-cbsid="BKS017-B30">Start again</button></div></header>';
  }
  /** the statement lines not yet in the books, as report rows, by side */
  function outsideRows(outside, key) {
    return outside.filter(function (item) { return item.line[key]; }).map(function (item) { return itemRow(item.line.date, item.line.narration, item.line[key]); });
  }
  /** the entries of the books that are not yet on the statement (the engine's match() says which), as report rows, by side */
  function ledgerRows(ledger, key) {
    return ledger.filter(function (row) { return row[key]; }).map(function (row) { return itemRow(row.date, row.narration, row[key]); });
  }
  /** the bank reconciliation as an auditor reads one: the statement balance, what the books hold that the statement does not, the books; the difference with a tick ONLY when no statement line is left outside the books */
  function paintBrs(model, ledger) {
    var recon = model.projection && model.projection.brs;
    if (!recon) return void (host.el('bd_brs').innerHTML = '');
    var outside = model.items.filter(function (item) {
      var state = host.standing(item, model.results[item.key]);
      return state !== 'in' && state !== 'posted';
    });
    var carried = recon.not_in_books || {},
      done = !outside.length && host.preview.minorOf(recon.difference_before) === 0;
    var amountMarkup = function (value) { return esc(host.amountText(value)); };
    var leftOut = outside.length ? '<tr class="bd-g"><td colspan="3">Statement lines not yet in the books</td></tr>' + outsideRows(outside, 'credit_minor').concat(outsideRows(outside, 'debit_minor')).join('') + totalRow('Receipts', carried.in) + totalRow('Payments', carried.out) : '';
    host.el('bd_brs').innerHTML =
      '<div class="bd-report"><article class="bd-sheet" data-cbsid="BKS017-R90">' + reportHead(recon, model) +
      '<table><tbody><tr class="bd-k"><td colspan="2">Balance as per bank statement</td><td class="bd-r">' + amountMarkup(recon.closing_statement) + '</td></tr>' +
      groupRows('Add: receipts not yet on the statement', ledgerRows(ledger, 'dr_minor')) +
      groupRows('Less: payments not yet on the statement', ledgerRows(ledger, 'cr_minor')) + leftOut +
      '<tr class="bd-k"><td colspan="2">Balance as per books</td><td class="bd-r">' + amountMarkup(recon.closing_books_before) + '</td></tr>' + differenceRow(recon, outside.length, done) + '</tbody></table>' +
      '<p class="bd-foot">' + (done ? 'Reconciled to the statement of ' + esc(host.dateWords(recon.statement_date || host.lastDate(model))) + '.' : 'Not reconciled yet. The tick appears when no statement line is left outside the books.') + '</p>' +
      '<div class="bd-sign"><span>Prepared by: sample</span></div></article></div>';
  }
  /** create(host) → the painters; host is the page's own functions */
  function create(pageHost) {
    host = pageHost;
    return { paintBooks: paintBooks, paintBrs: paintBrs, successCard: successCard, emptyCard: emptyCard, problemCard: problemCard };
  }
  root.CBBankDemoReport = { create: create };
})(typeof globalThis !== 'undefined' ? globalThis : this);
