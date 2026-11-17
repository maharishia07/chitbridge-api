/* bank-demo-ask.js — the confirm popup's lines and the column map of public/bank-demo.html (split from bank-demo.js).
 * OWNS      the text of the confirm popup (each line's payee, account and the Dr and Cr lines the engine composed, each entry's own totals) and the column map for a file with a heading we do not know.
 *           (The "What is this?" side panel is gone: a line's answers now open as a panel UNDER the line, painted by bank-preview-ui.js, the same on every page — W15-14.)
 * CALLED BY public/app/bank-demo.js (it builds this with its own page functions: CBBankDemoAsk.create(host)). Loaded before it by public/bank-demo.html.
 * FLOW      press Add → confirmBody (the reach, then every line's Dr and Cr) · a file with an unknown heading → mapCard → mapping → the page reads it again
 * ⭐ NO MONEY IS COMPUTED: amounts are the engine's, formatted.
 * CARD      16-finance/bank-reconciliation-and-bank-rail
 * CONTROLS  BKS017-M01 the column map · BKS017-S07 a column choice · BKS017-B26 read the file
 */
(function (root) {
  'use strict';
  var host = null /* the page's own functions (el, doc, controller, standing, payeeOf, accountOf, nameOf …), given by create() */;
  var MAP_FIELDS = [['date', 'Date'], ['narration', 'What the bank says'], ['debit', 'Money out'], ['credit', 'Money in'], ['amount', 'One amount column (minus = out)'], ['balance', 'Balance']];

  function afterWords(model) {
    var recon = model.projection && model.projection.brs;
    return recon ? '<p class="bd-after"><b>Difference to the statement after: ' + esc(host.amountText(recon.difference_after)) + '</b></p>' : '';
  }
  /** the confirm popup: the reach first, then each line with its payee, account and the Dr and Cr lines the engine composed, each entry's own balanced flag */
  function confirmBody(text) {
    var model = host.controller().view(),
      ready = model.items.filter(function (item) { return host.standing(item, model.results[item.key]) === 'ready'; });
    var amountMarkup = function (minor) { return esc(host.amountText({ amount_minor: minor, currency: host.CURRENCY })); };
    var cards = ready.map(function (item) {
      var entry = item.entry || { lines: [] };
      var legs = (entry.lines || []).map(function (leg) {
        var dr = (leg.dr_minor || 0) > 0;
        return '<tr><td>' + (dr ? 'Dr' : 'Cr') + '</td><td>' + esc(host.nameOf(leg.account)) + '</td><td class="bd-r">' + amountMarkup(dr ? leg.dr_minor : leg.cr_minor) + '</td></tr>';
      }).join('');
      return '<li><div class="bd-lp-top"><span>' + esc(host.payeeOf(item)) + '</span><span>' + esc(host.preview.dateText(item.line.date)) + '</span></div><div class="bd-lp-sub">' + esc(host.accountOf(item)) + (item.party && item.party.status === 'new' ? ' · new payee made first' : '') + '</div><table class="bd-jt"><tbody>' + legs + '</tbody></table>' +
        (entry.balanced ? '<div class="bd-lp-sub">Dr = Cr ✓</div>' : '') + '</li>';
    }).join('');
    var facts = text.lines.map(function (words) { return esc(words.replace(/new part(y|ies)/g, function (_, tail) { return tail === 'y' ? 'new payee' : 'new payees'; })); });
    return '<p class="lk-reach">' + facts.slice(0, 2).join(' · ') + '</p><p>' + facts.slice(2).join('</p><p>') + '</p>' + afterWords(model) + '<ul class="bd-lines-pop">' + cards + '</ul><p class="bd-note">Demo: only the books on this page change. Nothing is sent or saved.</p>';
  }

  function headCells(text) {
    var first = String(text || '').split(/\r?\n/).filter(function (row) { return row.trim(); })[0] || '';
    return first.split(',').map(function (cell) { return cell.replace(/^"|"$/g, '').trim(); }).filter(Boolean);
  }

  function mapCard(text) {
    var cells = headCells(text);
    if (!cells.length) return '';
    return '<div class="bd-map" data-cbsid="BKS017-M01"><h2>Which column is which?</h2><p class="bd-why">Tell us once and we read the rest of the file. Nothing is guessed.</p><div class="bd-map-grid">' +
      MAP_FIELDS.map(function (field) {
        return '<label>' + esc(field[1]) + '<select class="bd-inp" data-cbsid="BKS017-S07" data-map="' + field[0] + '"><option value="">Not in this file</option>' + cells.map(function (cell) { return '<option value="' + esc(cell) + '">' + esc(cell) + '</option>'; }).join('') + '</select></label>';
      }).join('') + '</div><button type="button" class="bd-btn bd-go" data-act="readmap" data-cbsid="BKS017-B26">Read the file</button></div>';
  }


  /** the column map's choices as the engine's mapping: { field: 'Heading' } for every field the visitor named */
  function mapping() {
    var named = {};
    Array.prototype.forEach.call(host.doc.querySelectorAll('select[data-map]'), function (node) {
      if (node.value) named[node.getAttribute('data-map')] = node.value;
    });
    return named;
  }
  /** create(host) → { confirmBody, mapCard, mapping }: host is the page's own functions */
  function create(pageHost) {
    host = pageHost;
    return { confirmBody: confirmBody, mapCard: mapCard, mapping: mapping };
  }
  root.CBBankDemoAsk = { create: create };
})(typeof globalThis !== 'undefined' ? globalThis : this);
