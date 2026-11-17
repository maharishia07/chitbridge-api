/* bank-lines.js — THE LINES of a bank statement: ONE row control, shared by the no-login demo, the owner's Bank page, the Add sheet and the adviser's seat (W15-12 to W15-17).
 * OWNS      the row of a statement line as the list control draws it (a status ICON, the date, the payee as the bank wrote it, the amount), the status chips that filter (All · In your books · Ready to add · Needs you),
 *           the Filters set (one per fact a line carries: direction, date, amount, kind, GST, how sure, look-alikes) and search, and ONE open row at a time: a panel under the line that the host fills.
 * CALLED BY public/app/bank-demo.js · public/app/cap-bank.js (bankList) · public/app/cap-bank-sheet.js. It builds the OPTIONS of CBList.mount; the list control (list-ctl.js) does the drawing, the keys, the resizing.
 * FLOW      a host turns its statement lines into rows (rowOfItem) → options({ rows, panel, … }) → CBList.mount(host, options) → a press opens the panel → the host's controller takes the answer → afterAnswer(id) opens the next line that needs one.
 * ⭐ NO MONEY IS COMPUTED HERE. Amounts, the entry, the tax and each line's standing are the controller's (bank-preview.js, bank-project.js); the filters group CARRIED figures (a band is a comparison against a fixed edge, never a sum).
 * CARD      16-finance/bank-reconciliation-and-bank-rail
 * CONTROLS  CMP064 the status icon (CBLabKit.statusIcon) · CMP036 the status chips (the list's views, merged with the filters) · CMP033/CMP035 the Filters
 */
(function (root) {
  'use strict';
  var STATUS = { need: 'Needs you', ready: 'Ready to add', in: 'In your books', done: 'Added', books: 'Not on the statement', lock: 'Month locked' };
  /** pending first: what a person must still answer sits at the top */
  var ORDER = { lock: 0, need: 0, ready: 1, books: 2, done: 3, in: 4 };
  /** the chip's words on a phone, where four full words do not fit on one row */
  var SHORT = { in: 'In books', ready: 'Ready', need: 'Needs you', books: 'Not on statement' };
  var KIND_WORDS = {
    transfer: 'Transfer between your accounts', tax_payment: 'Tax paid to the tax office', card_settlement: 'Card takings', cash: 'Cash', loan_received: 'Loan received', loan_repaid: 'Loan repaid',
    expense: 'Expense', other_income: 'Other income', payment_received: 'Customer receipt', payment_made: 'Supplier payment', contra: 'Transfer', cheque_dishonoured: 'Returned cheque'
  };
  var CLASS_WORDS = { bank_charges: 'Bank fee', interest_received: 'Interest', interest_paid: 'Interest' };
  function sayText(text) {
    return typeof root.tx === 'function' ? root.tx(text) : text;
  }
  /** the controller's one standing for a line → the status the row shows */
  function statusOfStanding(standing) {
    if (standing === 'in') return 'in';
    if (standing === 'ready') return 'ready';
    if (standing === 'posted') return 'done';
    if (standing === 'closed') return 'lock'; /* the month is locked: shown with a padlock, answered on the band */
    return 'need'; /* wait · need · failed: a person has something to do or to read */
  }
  /** what the engine says the line is, in the owner's words: its closed list first (transfer, tax, card takings), else the proposal's event; '' when it proposes nothing */
  function kindOf(item) {
    var what = item.what && item.what.kind,
      event = item.event || {};
    if (what && KIND_WORDS[what]) return KIND_WORDS[what];
    if (event.class && CLASS_WORDS[event.class]) return CLASS_WORDS[event.class];
    return KIND_WORDS[event.type] || '';
  }
  /** the tax a line carries, from the controller's own tax record: with it · none · a tax invoice is asked; '' when the line proposes no entry */
  function gstOf(item) {
    if (item.needs === 'tax_invoice') return 'Needs a tax invoice';
    if (item.tax && item.tax.tax_minor) return 'With tax';
    return item.entry || item.state === 'in_books' ? 'No tax' : '';
  }
  /** how sure the proposal is: what you taught or a party you know is High, only the bank's words is Medium, a line with no proposal is None; a line already in the books needs no guess */
  function sureOf(item) {
    if (item.state === 'in_books') return '';
    if (!item.event && !item.entry) return 'No proposal';
    return item.basis === 'taught' || item.basis === 'party' ? 'High' : 'Medium';
  }
  /** one controller item (+ its result) → the row the list draws. `standing` is CBBankPreview.standing(item, result): the ONE split of a file. */
  function rowOfItem(item, result, standing) {
    var line = item.line || {},
      out = (line.debit_minor || 0) > 0;
    return {
      id: item.key,
      item: item,
      result: result || null,
      status: statusOfStanding(standing),
      standing: standing,
      date: line.date || '',
      narration: String(line.narration || '').trim() || 'This line',
      out: out,
      amount_minor: out ? line.debit_minor : line.credit_minor || 0,
      kind: kindOf(item),
      gst: gstOf(item),
      sure: sureOf(item),
      look: false
    };
  }
  /** rows from the controller's view: each line with its standing; the look-alikes (same day, same amount, same side) are marked, a fact of the file read once */
  function rowsOfModel(model) {
    var rows = (model.items || []).map(function (item) {
      var result = (model.results || {})[item.key];
      return rowOfItem(item, result, root.CBBankPreview.standing(item, result));
    });
    markLookAlikes(rows);
    return rows;
  }
  function markLookAlikes(rows) {
    var seen = {};
    rows.forEach(function (row) {
      var key = row.date + '|' + (row.out ? 'o' : 'i') + '|' + row.amount_minor;
      seen[key] = (seen[key] || 0) + 1;
    });
    rows.forEach(function (row) {
      row.look = seen[row.date + '|' + (row.out ? 'o' : 'i') + '|' + row.amount_minor] > 1;
    });
  }
  /** a pending-first order: Needs you, Ready, then what is in the books; by date within each */
  function sorted(rows) {
    return rows.slice().sort(function (first, second) {
      return (ORDER[first.status] - ORDER[second.status]) || String(first.date).localeCompare(String(second.date));
    });
  }
  /** the Monday of a day's week, as 'YYYY-MM-DD' (UTC arithmetic on the date only: no clock, no zone) */
  function weekOf(iso) {
    var parts = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
    if (!parts) return '';
    var day = new Date(Date.UTC(+parts[1], +parts[2] - 1, +parts[3])),
      back = (day.getUTCDay() + 6) % 7;
    day.setUTCDate(day.getUTCDate() - back);
    return day.toISOString().slice(0, 10);
  }
  var BANDS = [
    ['under', 'Under 100', function (minor) { return minor < 10000; }],
    ['mid', '100 to 999.99', function (minor) { return minor >= 10000 && minor < 100000; }],
    ['over', '1,000 and over', function (minor) { return minor >= 100000; }]
  ];
  function bandOf(minor) {
    return BANDS.filter(function (band) { return band[2](minor); })[0][0];
  }
  /** the distinct values a fact takes over the rows, in first-seen order, as list options */
  function distinct(rows, valueOf, labelOf) {
    var seen = {},
      list = [];
    rows.forEach(function (row) {
      var value = valueOf(row);
      if (value && !seen[value]) {
        seen[value] = 1;
        list.push({ v: value, label: labelOf ? labelOf(value) : value });
      }
    });
    return list;
  }
  /** one filter, shown only when the lines give a choice (two or more values, or one that is not every line) */
  function filterOf(cfg, spec) {
    var rows = function () { return cfg.rows(); };
    var options = function () {
      return spec.options(rows());
    };
    return {
      key: spec.key,
      label: sayText(spec.label),
      all: sayText(spec.all || 'Any'),
      options: options,
      hide: function () {
        var list = options(),
          all = rows().length;
        return !list.length || (list.length === 1 && rows().filter(function (row) { return spec.match(row, list[0].v); }).length === all);
      },
      match: spec.match
    };
  }
  function filtersOf(cfg) {
    var weeks = function (rows) {
      return distinct(rows.slice().sort(function (a, b) { return String(a.date).localeCompare(String(b.date)); }), function (row) { return weekOf(row.date); }, function (monday) {
        return sayText('Week of') + ' ' + root.CBBankBand.dayText(monday).replace(/ \d{4}$/, '');
      });
    };
    return [
      { key: 'status', label: 'Status', all: 'All', options: function (rows) { return ['need', 'ready', 'in', 'books'].filter(function (key) { return key !== 'books' || rows.some(function (row) { return row.status === 'books'; }); }).map(function (key) { return { v: key, label: sayText(STATUS[key]) }; }); }, match: function (row, value) { return row.status === value || (value === 'in' && row.status === 'done') || (value === 'need' && row.status === 'lock'); } },
      { key: 'dir', label: 'Money', all: 'In and out', options: function (rows) { return distinct(rows, function (row) { return row.out ? 'out' : 'in'; }, function (value) { return sayText(value === 'out' ? 'Money out' : 'Money in'); }); }, match: function (row, value) { return (row.out ? 'out' : 'in') === value; } },
      { key: 'week', label: 'Date', all: 'Any date', options: weeks, match: function (row, value) { return weekOf(row.date) === value; } },
      { key: 'band', label: 'Amount', all: 'Any amount', options: function (rows) { return BANDS.filter(function (band) { return rows.some(function (row) { return band[2](row.amount_minor); }); }).map(function (band) { return { v: band[0], label: sayText(band[1]) }; }); }, match: function (row, value) { return bandOf(row.amount_minor) === value; } },
      { key: 'kind', label: 'What it looks like', all: 'Any', options: function (rows) { return distinct(rows, function (row) { return row.kind; }, sayText); }, match: function (row, value) { return row.kind === value; } },
      { key: 'gst', label: 'Tax', all: 'Any', options: function (rows) { return distinct(rows, function (row) { return row.gst; }, sayText); }, match: function (row, value) { return row.gst === value; } },
      { key: 'sure', label: 'How sure', all: 'Any', options: function (rows) { return distinct(rows, function (row) { return row.sure; }, sayText); }, match: function (row, value) { return row.sure === value; } },
      { key: 'look', label: 'Look-alikes', all: 'Any', options: function (rows) { return rows.some(function (row) { return row.look; }) ? [{ v: 'yes', label: sayText('Same day, same amount') }] : []; }, match: function (row, value) { return value === 'yes' && row.look; } }
    ].map(function (def) { return filterOf(cfg, def); });
  }
  /** the status chips: the list's own saved views, merged with the filters, each with its icon and its count (CMP036) */
  function viewsOf(cfg) {
    var kit = root.CBLabKit,
      onlyBooks = cfg.rows().some(function (row) { return row.status === 'books'; }); /* "Not on the statement": a chip only where the page has such lines (the owner's page) */
    var chip = function (key, label, status) {
      return { key: key, label: sayText(label), iconHtml: status ? kit.statusIcon({ status: status, name: '' }).replace(/<span class="lk-sr">[^<]*<\/span>/, '') : '', labelHtml: '<span class="bl-chip-l"><span class="bl-lg">' + root.esc(sayText(label)) + '</span><span class="bl-sh">' + root.esc(sayText(SHORT[key] || label)) + '</span></span>', filt: status ? { status: status } : {}, tip: '' };
    };
    return { merge: true, tid: 'bank-status', items: [chip('all', 'All', ''), chip('in', STATUS.in, 'in'), chip('ready', STATUS.ready, 'ready'), chip('need', STATUS.need, 'need')].concat(onlyBooks ? [chip('books', STATUS.books, 'books')] : []) };
  }
  /**
   * options(cfg) → the options of CBList.mount
   *   cfg.key · cfg.rows() → rows (rowOfItem) in the order to show · cfg.panel(row) → html of the open row · cfg.fmt(minor) → money text · cfg.tid(row) → data-testid of a row
   *   cfg.extra { columns, actions, head, wrapStatus(row, iconHtml) } what a page adds (the owner's page: the row actions of the rail, and the rail's own state on the icon's cell)
   */
  function options(cfg) {
    var labKit = root.CBLabKit,
      extra = cfg.extra || {};
    var amountCell = function (outSide) {
      return function (row) {
        return row.out === outSide && row.amount_minor ? '<span class="bl-amt bl-' + (outSide ? 'out' : 'in') + '">' + root.esc(cfg.fmt(row.amount_minor)) + '</span>' : '';
      };
    };
    return Object.assign(
      {
        key: cfg.key,
        t: sayText,
        rows: function () { return sorted(cfg.rows()); },
        id: function (row) { return row.id; },
        rowTid: cfg.tid || function (row) { return 'bank-row-' + row.id; },
        oneOpen: true,
        foldHead: true /* View · Grid / Lines · Columns · CSV · Expand under ONE menu: the head stays short */,
        defaultCols: ['status', 'date', 'payee', 'out', 'in'],
        views: viewsOf(cfg),
        columns: [
          { key: 'status', label: sayText('Status'), prio: 1, keep: true, w: 44, sort: 'status', html: true, cell: function (row) { var icon = labKit.statusIcon({ status: row.status, name: sayText(STATUS[row.status]) }); return extra.wrapStatus ? extra.wrapStatus(row, icon) : icon; } },
          { key: 'date', label: sayText('Date'), prio: 2, w: 112, sort: 'date', cell: function (row) { return root.CBBankPreview.dateText(row.date); } },
          { key: 'payee', label: sayText('Payee as the bank wrote it'), prio: 3, w: 380, html: true, cell: function (row) { return '<span class="bl-pay" data-testid="bank-payee">' + root.esc(row.narration) + '</span>'; } },
          { key: 'out', label: sayText('Out'), prio: 4, keep: true, num: true, w: 140, sort: 'amount', html: true, cell: amountCell(true) },
          { key: 'in', label: sayText('In'), prio: 4, keep: true, num: true, w: 140, html: true, cell: amountCell(false) }
        ].concat(extra.columns || []),
        filters: filtersOf(cfg),
        search: function (row) { return [row.narration, root.CBBankPreview.dateText(row.date), cfg.fmt(row.amount_minor), row.kind, sayText(STATUS[row.status])].join(' '); },
        sorts: [
          { key: 'status', label: sayText('Pending first'), cmp: function (a, b) { return ORDER[a.status] - ORDER[b.status]; } },
          { key: 'date', label: sayText('Date'), cmp: function (a, b) { return String(a.date).localeCompare(String(b.date)); } },
          { key: 'amount', label: sayText('Amount'), cmp: function (a, b) { return a.amount_minor - b.amount_minor; } }
        ],
        next: cfg.panel,
        empty: { title: sayText('Nothing in that file') }
      },
      extra.actions ? { actions: extra.actions } : {},
      extra.head ? { head: extra.head } : {}
    );
  }
  /**
   * mount(host, cfg) → { list, refresh(), openNext(afterId) }: the list, painted; refresh() paints it again from the host's rows (the open row, the filters and the search stay); openNext opens the next line that needs an answer after the one just answered
   */
  function mount(host, cfg) {
    root.CBList.reset && root.CBList.reset(cfg.key);
    var list = root.CBList.mount(host, options(cfg));
    return {
      list: list,
      refresh: function () { list.refresh(); },
      /** after an answer: the next line (in the order shown) that still needs one opens; none left, the open row closes */
      openNext: function (afterId) {
        var rows = sorted(cfg.rows()),
          at = Math.max(-1, rows.map(function (row) { return row.id; }).indexOf(afterId)),
          pending = function (row) { return row.status === 'need' || row.status === 'ready'; },
          next = rows.slice(at + 1).filter(pending)[0] || rows.filter(pending)[0];
        if (next) list.open(next.id, true);
        else if (afterId) list.open(afterId, false);
        return next ? next.id : '';
      }
    };
  }
  root.CBBankLines = { options: options, mount: mount, rowOfItem: rowOfItem, rowsOfModel: rowsOfModel, sorted: sorted, statusOfStanding: statusOfStanding, STATUS: STATUS, markLookAlikes: markLookAlikes, weekOf: weekOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.CBBankLines;
})(typeof globalThis !== 'undefined' ? globalThis : this);
