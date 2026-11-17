/**
 * books-grant-words.js — ACC-176b: THE OWNER'S PLAIN WORDS for what a firm did in his books.
 *
 * OWNS      a logged route in plain words ("opened the trial balance") · the owner's weekly line and its latest three figures · the list of what the firm posted for him (CBList) · the given-access list grouped one row per firm · the chooser when a firm holds two open grants
 * CALLED BY books-grant-member.js (Who looked, the weekly line, Access I gave)
 * FLOW      route(pattern) → words · weekly(actions, tell) → { text, n } · groupGiven(given) → one row per grantee · posted(mountList, rows) → CBList of the delegated actions
 * CARD      04-network/ACC-176B-ADVISER-REQUIREMENT
 *
 * Decides nothing and adds nothing up: every figure is the server's total_minor in the action's own currency, said by CBBooksActing.figure; a firm's two roles are two grants, shown as one row.
 *   CBBooksGrantWords.route · .weekly · .groupGiven · .posted · .choose
 */
(function (root) {
  'use strict';
  var ROUTES = {
    'GET /accounts': 'opened the chart of accounts',
    'GET /daybook': 'opened the day book',
    'GET /ledger/:account': 'opened a ledger',
    'GET /trial-balance': 'opened the trial balance',
    'GET /pl': 'opened the profit and loss',
    'GET /bs': 'opened the balance sheet',
    'GET /dues': 'opened who owes whom',
    'GET /cashflow': 'opened the cash flow',
    'GET /periods': 'opened the closed months',
    'GET /year/:fy/status': 'opened the year state',
    'GET /terms': 'opened the payment terms',
    'GET /fx-rates': 'opened the exchange rates',
    'GET /health': 'opened the books health',
    'GET /cheques': 'opened the cheques',
    'GET /bank/rail': 'opened the bank lines',
    'GET /bank/log': 'opened the bank log',
    'POST /bank/marks': 'answered bank lines',
    'POST /bank/statements': 'signed off a bank statement',
    'POST /events': 'added a bank line to the books',
    'POST /payments': 'recorded a payment from a bank line',
    'GET /returns': 'opened the tax returns',
    'GET /': 'opened the waiting entries',
    'POST /': 'prepared a journal',
    'POST /preview': 'previewed a journal',
    'GET /:id': 'opened an entry',
    'POST /:id/review': 'reviewed an entry',
    'POST /:id/accept': 'accepted an entry',
    'POST /:id/return': 'sent an entry back'
  };
  function words(s) {
    return typeof root.tx === 'function' ? root.tx(s) : s;
  }
  /** a logged "METHOD /route" in plain words; a route not listed: "looked at the books" */
  function route(pattern) {
    var text = String(pattern || '').trim();
    var key = /^[A-Z]+ /.test(text) ? text : 'GET ' + text;
    return words(ROUTES[key] || 'looked at the books');
  }

  /** when an action was done: the server's own moments, newest wins */
  function actionAt(a) {
    return a.accepted_at || a.updated_at || (a.prepared && a.prepared.at) || a.created_at || '';
  }
  /** the owner's weekly line: the count, the firm(s), and the figure of each of the latest three actions (each in its own currency, never added) */
  function weekly(actions, total, tell) {
    var n = total || (actions || []).length;
    var firms = {};
    (actions || []).forEach(function (a) { if (a.prepared && a.prepared.firm) firms[a.prepared.firm] = 1; });
    var latest = (actions || []).slice().sort(function (a, b) { return actionAt(b) < actionAt(a) ? -1 : 1; }).slice(0, 3);
    var figures = latest.map(function (a) { return root.CBBooksActing.figure(a.total_minor, a.currency); }).filter(function (f) { return f !== '—'; });
    return tell('Posted for you this week') + ': ' + n + ' ' + tell(n === 1 ? 'entry or action by' : 'entries and actions by') + ' ' + Object.keys(firms).join(', ') +
      (figures.length ? ': ' + figures.join(' · ') + (n > figures.length ? ' (' + tell('latest') + ' ' + figures.length + ')' : '') : '') + '.';
  }

  /** what the firm posted for the owner, one row per action: date, kind, amount, by whom, client ref (the same actionsList answer) */
  function posted(mountList, rows, when, tell) {
    var KIND = { journal: 'Journal', reverse: 'Reversal', lock: 'Lock a month', unlock: 'Open a month', year_close: 'Close the year' };
    var by = function (a) { return a.prepared ? a.prepared.name + (a.prepared.firm ? ', ' + a.prepared.firm : '') : '—'; };
    var col = function (key, label, prio, w, text, sortValue) { return { key: key, label: tell(label), prio: prio, w: w, cell: text, value: sortValue || text }; };
    mountList(root.document.getElementById('bg_list'), {
      key: 'books-grants-posted',
      rows: function () { return rows; },
      id: function (a) { return a.action_id; },
      rowTid: function (a) { return 'bg-posted-' + a.action_id; },
      columns: [
        col('at', 'Date', 1, 170, function (a) { return when(actionAt(a)); }, function (a) { return actionAt(a); }),
        col('kind', 'What', 1, 160, function (a) { return tell(KIND[a.kind] || a.kind || '—'); }),
        col('amount', 'Amount', 1, 140, function (a) { return root.CBBooksActing.figure(a.total_minor, a.currency); }, function (a) { return Number(a.total_minor) || 0; }),
        col('by', 'By', 2, 220, by),
        col('ref', 'Client ref', 3, 160, function (a) { return a.client_ref || '—'; })
      ],
      search: function (a) { return [by(a), a.client_ref, a.kind].join(' '); },
      empty: { title: tell('Nothing was posted for you this week'), body: tell('Entries your accountant posts are listed here.') }
    });
  }

  var PRESET_ORDER = ['adviser', 'auditor'];
  /** the access given, one row per grantee firm: the preferred grant's fields, every role it holds, and its open grants (an adviser grant wins over an auditor's) */
  function groupGiven(given) {
    var by = {};
    var order = [];
    (given || []).forEach(function (g) {
      var id = String(g.grantee_entity);
      if (!by[id]) { by[id] = []; order.push(id); }
      by[id].push(g);
    });
    return order.map(function (id) {
      var all = by[id];
      var open = all.filter(function (g) { return g.state === 'live' || g.state === 'edge_off'; });
      var pool = open.length ? open : all;
      var pick = pool.filter(function (g) { return g.preset === 'adviser'; })[0] || pool[0];
      var presets = PRESET_ORDER.filter(function (p) { return all.some(function (g) { return g.preset === p; }); });
      var purposes = all.map(function (g) { return g.purpose; }).filter(function (p, i, list) { return p && list.indexOf(p) === i; });
      return Object.assign({}, pick, { grant_id: 'firm-' + id, grants: all, open: open, presets: presets, purpose: purposes.join(' · ') });
    });
  }

  /** two open grants under one firm: tell which one, each with its own Change date / End access */
  function choose(sheet, closeSheet, group, label, handlers, name) {
    var esc2 = root.esc || String;
    sheet('<h2>' + esc2(words(label)) + '</h2><div class="bg-form" data-testid="bg-choose">' + group.open.map(function (g, i) {
      return '<div class="nw-acts"><span class="sub">' + esc2(name(g.preset)) + '</span><button data-cbsid="NET004-B11" type="button" class="act" data-grant-pick="' + i + '" data-testid="bg-pick-' + esc2(g.preset) + '">' + esc2(words(label)) + '</button></div>';
    }).join('') + '<div class="nw-acts"><button data-cbsid="NET004-B12" type="button" class="act quiet" id="bg_cancel3" data-testid="bg-cancel3">' + esc2(words('Cancel')) + '</button></div></div>');
    var host = root.document.querySelector('[data-testid="bg-choose"]');
    Array.prototype.forEach.call(host.querySelectorAll('[data-grant-pick]'), function (button) {
      button.onclick = function () { closeSheet(); handlers(group.open[Number(button.getAttribute('data-grant-pick'))]); };
    });
    root.document.getElementById('bg_cancel3').onclick = closeSheet;
  }
  root.CBBooksGrantWords = { route: route, weekly: weekly, groupGiven: groupGiven, posted: posted, choose: choose };
})(typeof window !== 'undefined' ? window : globalThis);
