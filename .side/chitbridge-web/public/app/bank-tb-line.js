/* bank-tb-line.js — RANK 9: the bank agreement under the trial balance, drawn by ONE function for all three seats (the auditor's and adviser's books view, the owner's Trial balance tab).
 * OWNS      CBBankTbLine.html(bank, o) → the note: one line per bank account of the api's `bank` block of GET /trial-balance
 * CALLED BY books-grant-view.js (auditor, adviser) · cap-books.js bkTB (owner)
 * FLOW      the answer's `bank` lines (api lib/bank-rec-log tbBankOf: the Bank page's own newest-sign-off rule) ──▶ words here ──▶ a note + one button per line. NOTHING is chosen, summed or recomputed here.
 * WORDS     "Signed off to <date> · Statement A$X · nothing unexplained" | "… · unexplained A$Y" (the Bank page's own words; unexplained is the remainder after the timing items, NOT statement minus books)
 *           · earlier than the day: the date and the statement as signed, NO difference across dates · none by the day · never · not shared (a cost-blind reader).
 * o         { money(minor, currency), day(iso), tx(english), txf(english, vars), codes: { note, open, at }, href(line) → the Bank page address, ids: prefix }
 * CARD      14-accounting/README (auditor rank 9) */
(function (root) {
  'use strict';
  /** the words of one account's line (plain text, escaped by the caller) */
  function wordsOf(line, o) {
    var say = o.tx, fill = o.txf;
    if (line.state === 'not_shared') return say('Bank agreement is not shared with you');
    if (line.state === 'never') return say('No bank sign-off yet');
    if (line.state === 'none_by_date') return say('No sign-off on or before this date');
    var cur = line.currency, sign = fill('Signed off to {d}', { d: o.day(line.period_to) }) + ' · ' + say('Statement') + ' ' + o.money(line.statement_minor, cur);
    if (line.state === 'earlier') return sign + ' · ' + say('no difference shown for this date');
    var rest = line.state === 'unexplained' ? fill('unexplained {a}', { a: o.money(line.unexplained_minor, cur) }) : say('nothing unexplained');
    return sign + ' · ' + rest + (line.moved_minor ? ' · ' + fill('books now differ from the figure signed by {a}', { a: o.money(line.moved_minor, cur) }) : '');
  }
  function html(bank, options) {
    var lines = (bank || []).filter(Boolean);
    if (!lines.length) return '';
    var many = lines.length > 1;
    return '<div class="pe-note bv-bankline" data-cbsid="' + esc(options.codes.note) + '" data-testid="bv-tb-bank">' + lines.map(function (line) {
      var id = esc(options.ids + String(line.account_id)), act = '';
      if (line.state === 'earlier') act = '<button type="button" class="act quiet" id="' + id + '_at" data-cbsid="' + esc(options.codes.at) + '" data-testid="bv-tb-bank-at-' + esc(line.account_id) + '" data-day="' + esc(line.period_to) + '">' + esc(options.txf('Trial balance at {d}', { d: options.day(line.period_to) })) + '</button>';
      else if (line.state !== 'not_shared') act = '<button type="button" class="act quiet" id="' + id + '_open" data-cbsid="' + esc(options.codes.open) + '" data-testid="bv-tb-bank-open-' + esc(line.account_id) + '" data-account="' + esc(line.account_id) + '">' + esc(options.tx('Open Bank')) + '</button>';
      return '<div data-testid="bv-tb-bank-' + esc(line.account_id) + '" data-state="' + esc(line.state) + '">' + (many ? '<b>' + esc(line.name || line.code) + '</b> · ' : '') + esc(wordsOf(line, options)) + ' ' + act + '</div>';
    }).join('') + '</div>';
  }
  /** wire the buttons of a painted note: onOpen(line) and onDay(day); the lines are looked up by account id from the same `bank` */
  function wire(host, bank, o) {
    Array.prototype.forEach.call(host.querySelectorAll('[data-account]'), function (button) {
      button.onclick = function () { var line = (bank || []).filter(function (l) { return String(l.account_id) === button.getAttribute('data-account'); })[0]; if (line && o.onOpen) o.onOpen(line); };
    });
    Array.prototype.forEach.call(host.querySelectorAll('[data-day]'), function (button) {
      button.onclick = function () { if (o.onDay) o.onDay(button.getAttribute('data-day')); };
    });
  }
  root.CBBankTbLine = { html: html, wire: wire, wordsOf: wordsOf };
})(typeof window !== 'undefined' ? window : globalThis);
