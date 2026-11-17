/* app/cap-mis.js — CB FINANCE › REPORTS: the rail measured, by the server, as one list (T3-P4-ACCOUNT, 2026-10-14).
 * CARD 26-reporting-mis-and-bi/mis
 *
 * Owner, 14 Oct: "follow the same design standards or better … much simpler". The workshop's MIS (cap-admin.js misScreen · _loadMIS) draws seven
 * bands over TWO answers: the server's one measurement (GET /api/folders/mis → lib/measure, the engine the folder pane, the scorecard and Home's rail
 * read) and a SECOND set of sums the browser makes over inbox + sent (committed · forecast · ageing · unattended). Only the first is one calculation.
 * ⭐ ONE CALCULATION (CLAUDE.md rule 2): this tab paints the server's measurement and nothing else — no sum, no age, no rate is worked out here.
 * ⭐ EVERY NUMBER OPENS WHAT IT COUNTS: a count is a door into the small app whose list holds those chits (CB CRM › Chits in · out · stuck; CB Tasks &
 *   Orders for the closed ones). Overdue counts with the rail's rule on the server (railMeasure: the shop's own notes are never overdue), so the number
 *   here and the stuck list it opens agree.
 * ⭐ ONE WINDOW RULE: misWindow(period) is the `since` both this tab and the workshop's MIS send (lifted from cap-admin.js _loadMIS — one copy).
 * Dropped from the workshop MIS, and why: Position · Flow · Friction · Trust · Plan · Tax bands (browser sums, a second answer), the sparkline,
 *   "✨ Explain" (AI narration over a client sum), the two-pane rail. A statutory tax figure is CB Accounts' GST close, not a report tile.
 * Host globals (finance.html, as cap-finance-cash.js): api · EP (CB_MIS_EP misMetrics) · esc · tx · txn · CBList · CBLocale · ftNav · FIN.
 * OWNS      the Reports tab's state (FM) and the two MIS rules both surfaces share — misWindow (period → since) and misReadAt (the read stamp)
 * RPT2: #/reports/trend hands fmMount/fmLoad to app/cap-mis-trend.js (trMount/trLoad); fmViews links the two views.
 * CALLED BY public/finance.html (script tag) · public/app/cap-finance.js (fmLoad · fmMount) · public/app/cap-mis-trend.js (fmLoad · fmViews · fmMount) · public/app/cap-admin.js (misWindow · misReadAt, at 1112 and 1323;
 *           app.html only loads this file through ensureCap, CAP_WITH admin: shop · settings · mis)
 * FLOW  Reports tab → fmMount() → fmLoad() → GET /api/folders/mis?since=misWindow(period) → fmPaintTop() (misReadAt) + CBList rows (fmRows) → a figure → ftNav(list)
 * Flow step: R2R · reports (docs/process/flows.json).
 */
'use strict';

/** the window a period means, as the `since` the server measures over ('7' · '30' · 'all' → ISO or undefined) — the ONE rule (cap-admin.js _loadMIS reads it too) */
function misWindow(period) {
  var d = period === 'all' || !period ? null : parseInt(period, 10);
  return d ? new Date(Date.now() - d * 864e5).toISOString() : undefined;
}
/** the ONE read stamp of a measurement — "live · 10:32", WHEN the page read the server's figures (W2-SHOP, 15 Oct: the workshop MIS in
 *  cap-admin.js and this tab each wrote their own; the cart's stock stamp is the only other "as of" and one-cart.cjs keeps it that way) */
function misReadAt(readAtMs) {
  return tx('live') + ' · ' + CBLocale.time(readAtMs);
}

var FM = { gen: 0, period: '30', r: null, state: 'loading', err: null, api: null, asOf: null };

function fmPeriod() {
  return FM.period;
}
function fmSetPeriod(p) {
  FM.period = p;
  fmPaintTop();
  fmLoad();
}

/** the measures of one answer: the rows of the list — label · the three figures · where each opens (null = a duration, not a door) */
var FM_ROWS = [
  {
    key: 'count',
    label: 'Chits',
    pick: function (m) {
      return m.count;
    },
    door: { all: '/tasks.html', received: '/tasks.html?view=orders_in', sent: '/tasks.html?view=orders_out' },
    opens: 'Tasks & Orders'
  },
  {
    key: 'open',
    label: 'Open',
    pick: function (m) {
      return m.open;
    },
    door: { all: '/crm.html#/chits', received: '/crm.html#/chits?tab=in', sent: '/crm.html#/chits?tab=out' },
    opens: 'CRM › Chits'
  },
  {
    key: 'overdue',
    label: 'Stuck',
    pick: function (m) {
      return m.overdue;
    },
    door: { all: '/crm.html#/chits?tab=stuck', received: '/crm.html#/chits?tab=stuck', sent: '/crm.html#/chits?tab=stuck' },
    opens: 'CRM › Chits › Stuck'
  },
  {
    key: 'unread',
    label: 'Not read yet',
    pick: function (m) {
      return m.unread;
    },
    door: { all: '/crm.html#/chits', received: '/crm.html#/chits?tab=in', sent: '/crm.html#/chits?tab=out' },
    opens: 'CRM › Chits'
  },
  {
    key: 'closed',
    label: 'Closed',
    pick: function (m) {
      return m.closed;
    },
    door: { all: '/tasks.html?view=done', received: '/tasks.html?view=done', sent: '/tasks.html?view=done' },
    opens: 'Tasks & Orders › Done'
  },
  {
    key: 'disputed',
    label: 'In dispute',
    pick: function (m) {
      return m.disputes && m.disputes.open;
    },
    door: { all: '/tasks.html', received: '/tasks.html?view=orders_in', sent: '/tasks.html?view=orders_out' },
    opens: 'Tasks & Orders'
  },
  {
    key: 'oldest',
    label: 'Oldest, in days',
    pick: function (m) {
      return m.clock && m.clock.oldest_age_days;
    },
    door: null
  },
  {
    key: 'median',
    label: 'Typical age, in days',
    pick: function (m) {
      return m.clock && m.clock.median_age_days;
    },
    door: null
  }
];
var FM_COLS = ['all', 'received', 'sent'];

async function fmLoad(quiet) {
  if (pcOn()) return pcLoad(); /* MISCH: #/reports/pictures (app/cap-mis-pictures.js) */
  if (trOn()) return trLoad(quiet); /* RPT2: #/reports/trend is the Trend view (app/cap-mis-trend.js) */
  var g = ++FM.gen;
  if (!quiet) {
    FM.state = 'loading';
    if (FM.api) FM.api.refresh();
  }
  try {
    var reply = await api('misMetrics', { query: { since: misWindow(FM.period) } });
    if (g !== FM.gen) return;
    FM.r = reply || null;
    FM.asOf = Date.now();
    FM.state = 'ready';
    FM.err = null;
    ftNav();
  } catch (e) {
    if (g !== FM.gen) return;
    if (typeof cblog === 'function') cblog('error', 'reports: ' + ((e && e.message) || e));
    FM.state = e && e.status === 403 ? 'denied' : 'error';
    FM.err = e;
  }
  fmPaintTop();
  if (FM.api) FM.api.refresh();
}
function fmRetry() {
  fmLoad();
}

function fmRows() {
  var r = FM.r;
  if (!r || FM.state !== 'ready') return [];
  return FM_ROWS.map(function (item) {
    var row = { key: item.key, label: item.label, door: item.door, opens: item.opens };
    FM_COLS.forEach(function (c) {
      var m = r[c] || {};
      var v = item.pick(m);
      row[c] = v === null || v === undefined ? null : Number(v);
    });
    return row;
  });
}
/** a figure, or a door into the list that holds it: never a 0 the server did not send (null → —) */
function fmCell(row, col) {
  var v = row[col];
  if (v === null || v === undefined) return '<span class="fm-none" data-testid="fm-' + esc(row.key) + '-' + esc(col) + '">—</span>';
  if (!row.door) return '<span data-testid="fm-' + esc(row.key) + '-' + esc(col) + '">' + esc(String(v)) + '</span>';
  return (
    '<a class="fm-n" href="' +
    esc(row.door[col]) +
    '" data-testid="fm-' +
    esc(row.key) +
    '-' +
    esc(col) +
    '" title="' +
    esc(tx('Opens') + ' ' + row.opens) +
    '">' +
    esc(String(v)) +
    '</a>'
  );
}
function fmCols() {
  var num = function (col) {
    return function (row) {
      return fmCell(row, col);
    };
  };
  return [
    {
      key: 'what',
      label: tx('Measure'),
      prio: 1,
      w: 200,
      cell: function (row) {
        return tx(row.label);
      }
    },
    {
      key: 'all',
      label: tx('All'),
      prio: 2,
      w: 110,
      num: true,
      html: true,
      cell: num('all'),
      value: function (row) {
        return row.all;
      }
    },
    {
      key: 'received',
      label: tx('Received'),
      prio: 3,
      w: 120,
      num: true,
      html: true,
      cell: num('received'),
      value: function (row) {
        return row.received;
      }
    },
    {
      key: 'sent',
      label: tx('Sent'),
      prio: 3,
      w: 110,
      num: true,
      html: true,
      cell: num('sent'),
      value: function (row) {
        return row.sent;
      }
    }
  ];
}
/** the row's next level: what the figure means and where it opens — the measure's own words, no second number */
function fmNext(row) {
  var words = {
    count: tx('Every chit copy this shop holds in the window, open or closed.'),
    open: tx('Not yet answered, finished, cancelled or rejected.'),
    overdue: tx('Open for longer than your stuck rule allows. Your own notes to yourself are never stuck.'),
    unread: tx('A copy nobody has opened yet — yours on received chits, theirs on sent ones.'),
    closed: tx('Completed, cancelled or rejected in the window.'),
    disputed: tx('A dispute is open on the chit.'),
    oldest: tx('How long the oldest chit in the window has existed.'),
    median: tx('The middle age: half the chits are younger, half older. One very old chit does not move it.')
  };
  return (
    '<div class="fm-next" data-testid="fm-next-' +
    esc(row.key) +
    '"><p class="sub">' +
    esc(words[row.key] || '') +
    '</p>' +
    (row.door ? '<p class="sub">' + esc(tx('A number opens') + ' ' + row.opens + '.') + '</p>' : '') +
    '</div>'
  );
}
function fmHead() {
  var r = FM.r,
    notices = [];
  if (r && FM.state === 'ready') {
    notices.push({
      tid: 'fm-rule',
      text:
        tx('Stuck = open for more than') + ' ' + txn('{count} day', '{count} days', Number(r.overdue_days)) + '. ' + tx('Change it under Settings › Policy.')
    });
    if (r.truncated)
      notices.push({ cls: 'warn', tid: 'fm-truncated', text: tx('Counted over the first 5,000 chits only — the rest are not in these figures.') });
  }
  return { title: tx('Reports'), notices: notices };
}
function fmPaintTop() {
  var el = document.getElementById('fm_top');
  if (!el) return;
  var pill = function (p, words) {
    return (
      '<button data-cbsid="FIN008-B02" type="button" class="tab" aria-pressed="' +
      (FM.period === p ? 'true' : 'false') +
      '" data-testid="fm-period-' +
      p +
      '" onclick="fmSetPeriod(\'' +
      p +
      '\')">' +
      esc(words) +
      '</button>'
    );
  };
  var asOf =
    FM.state === 'ready' && FM.asOf ? '<span class="sub" data-testid="fm-asof" style="margin-inline-start:12px">' + esc(misReadAt(FM.asOf)) + '</span>' : '';
  el.innerHTML =
    fmViews('measures') +
    '<div class="tabs" role="group" aria-label="' +
    esc(tx('Which window')) +
    '" style="margin:10px 20px 0;display:flex;align-items:center;flex-wrap:wrap">' +
    pill('7', txn('{count} day', '{count} days', 7)) +
    pill('30', txn('{count} day', '{count} days', 30)) +
    pill('all', tx('All time')) +
    asOf +
    '</div>';
}
/** RPT2: the two Reports views as links — Measures (this list) · Trend (app/cap-mis-trend.js); the address decides which is drawn */
function fmViews(current) {
  var link = function (view, href, words) {
    return (
      '<a class="tab" href="' +
      href +
      '" data-testid="fm-view-' +
      view +
      '"' +
      (current === view ? ' aria-current="page"' : '') +
      '>' +
      esc(tx(words)) +
      '</a>'
    );
  };
  return (
    '<nav class="tabs" aria-label="' +
    esc(tx('Reports')) +
    '" data-testid="fm-views" style="margin:10px 20px 0">' +
    link('measures', '#/reports', 'Measures') +
    link('trend', '#/reports/trend', 'Trend') +
    link('pictures', '#/reports/pictures', 'Pictures') +
    '</nav>'
  );
}
function fmDeniedWords() {
  return FM.state === 'denied'
    ? { title: tx('This sign-in cannot open the reports.'), sub: (FM.err && FM.err.message) || '' }
    : { title: tx('Could not read the reports.'), sub: tx('Nothing was lost. Try again.') };
}
function fmMount(frame) {
  if (pcOn()) return pcMount(); /* MISCH: the Pictures view (app/cap-mis-pictures.js) */
  if (trOn()) return trMount(frame); /* RPT2: the Trend view (app/cap-mis-trend.js) */
  var node = document.getElementById('screen');
  if (!node) return;
  ftNav();
  node.className = 'screen flush';
  node.innerHTML = '<div id="fm_top" data-testid="fm-top"></div><div id="fm_list" data-testid="fm-list" style="flex:1 1 auto;min-height:0"></div>';
  fmPaintTop();
  FM.api = CBList.mount(document.getElementById('fm_list'), {
    key: 'fin-reports',
    t: tx,
    rows: fmRows,
    id: function (row) {
      return row.key;
    },
    rowTid: function (row) {
      return 'fm-row-' + row.key;
    },
    columns: fmCols(),
    defaultCols: ['what', 'all', 'received', 'sent'],
    cardMax: 4,
    fill: false,
    head: fmHead,
    state: function () {
      return FM.state === 'ready' ? 'ready' : FM.state === 'loading' ? 'loading' : 'error';
    },
    error: fmDeniedWords,
    onRetry: fmRetry,
    empty: { title: tx('Nothing measured yet') },
    search: function (row) {
      return tx(row.label);
    },
    next: fmNext
  });
  if (!frame) fmLoad(!!FM.r);
}
