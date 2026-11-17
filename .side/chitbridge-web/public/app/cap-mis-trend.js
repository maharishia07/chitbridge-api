/* app/cap-mis-trend.js — CB FINANCE › REPORTS › TREND: sales by week, month, quarter and year, each beside the same period last year (RPT2, 2026-10-17).
 * CARD 26-reporting-mis-and-bi/charts
 *
 * Athi, 17 Oct: "no one wants to see the text, only pictures, comparison, chart … 52 weeks, 12 months, quarter, say 7 years". The full view lives
 * here; Home's Till card carries only the teaser (app/shell.js, from GET /api/facts/till figures.trend).
 * ⭐ ONE CALCULATION: every figure, every "short" and every change % is the server's — GET /api/till/summary?compare=1 → rollup.series (engines
 *   v1.66.0). This page formats (money via bkMoney → CBLocale in the shop's currency) and draws (CBDraw); it adds, rounds and compares NOTHING.
 *   A change the engine gave as null is "—", never 0%. A slot with no record is an empty tick and "missing", never a zero bar.
 * ⭐ A SHORT OR RUNNING PERIOD SAYS SO: hatched bar + its note ("so far", "8 of 12 months") + the head notice; the headline is the newest CLOSED one.
 * ⭐ NEVER COLOUR ALONE: bars solid, last year a dashed line with hollow dots, part of a period hatched, missing an empty tick — the legend names each.
 * Better than the usual "sales vs last year" report because a part period is never compared as if whole: the engine refuses the change, and the
 *   bar says why in its own note, instead of printing "↓ 60%" for a shop's first, short year.
 * Host globals (finance.html): MC (app/mis-charts.js) · api · EP (CB_MIS_EP tillTrend) · esc · tx · txn · bkMoney · CBList · CBLocale · CBDraw · ftNav · fmViews.
 * OWNS      TR (this view's state) and the Trend view of CB Finance › Reports (trMount · trLoad · trPaint · trPaintChart)
 * CALLED BY public/finance.html (script tag) · public/app/cap-mis.js (trOn · trLoad · trMount: fmMount and fmLoad hand #/reports/trend here)
 * FLOW  #/reports/trend[/week|month|quarter|year] → trMount() → trLoad() → GET /api/till/summary?compare=1&period= → trPaintTop() + trPaintChart() + CBList rows
 * Flow step: R2R · reports (docs/process/flows.json).
 */
'use strict';

var TR = { gen: 0, period: 'month', answer: null, state: 'loading', err: null, api: null, resizeTimer: null };
var TR_TABS = [
  ['week', 'Weeks'],
  ['month', 'Months'],
  ['quarter', 'Quarters'],
  ['year', 'Years']
];
var TR_REFUSED = { NO_COUNTRY: 1, NO_MONEY: 1 }; /* the server's codes for "the shop's country, money or year is not set" (lib/till-summary.shopYearOf) */

/** is the Reports tab showing the Trend view? (#/reports/trend…) */
function trOn() {
  return /^#\/reports\/trend/.test(location.hash);
}
/** the tab the address names, else the last one chosen (Months first) */
function trPeriodOfHash() {
  var named = /^#\/reports\/trend\/(week|month|quarter|year)\b/.exec(location.hash);
  return named ? named[1] : TR.period;
}
function trSetPeriod(period) {
  location.hash = '#/reports/trend/' + period;
}
/** a failed read, as this view's state: the shop's year not set (422 + its code) · not allowed · anything else */
function trStateOfError(error) {
  var code = error && error.data && error.data.code;
  if (error && error.status === 422 && TR_REFUSED[code]) return 'refused';
  return error && error.status === 403 ? 'denied' : 'error';
}

/** read the tab the address names (one trip: GET /api/till/summary?compare=1); a newer read wins, a failure says which kind */
async function trLoad(quiet) {
  var generation = ++TR.gen;
  TR.period = trPeriodOfHash();
  if (!quiet) {
    TR.state = 'loading';
    trPaint();
  }
  try {
    var answer = await api('tillTrend', { query: { compare: '1', period: TR.period } });
    if (generation !== TR.gen) return;
    TR.answer = answer || null;
    TR.state = 'ready';
    TR.err = null;
  } catch (error) {
    if (generation !== TR.gen) return;
    if (typeof cblog === 'function') cblog('error', 'trend: ' + ((error && error.message) || error));
    TR.state = trStateOfError(error);
    TR.err = error;
  }
  trPaint();
}
function trRetry() {
  trLoad();
}
function trPaint() {
  trPaintTop();
  trPaintChart();
  if (TR.api) TR.api.refresh();
}
function trSlots() {
  return (TR.answer && TR.answer.slots) || [];
}

/* ── words for a period key (the key is the engine's; the words are the reader's locale) — app/mis-charts.js MC.keyWords, the one place ── */
function trDeps() {
  return { tx: tx, money: bkMoney, date: CBLocale.date, cur: TR.answer && TR.answer.currency };
}
function trKeyWords(key, period) {
  return MC.keyWords(key, period, trDeps());
}

/* ── one slot, in words (every figure the server's) ── */
function trMoney(minor) {
  return minor === null || minor === undefined ? '—' : bkMoney(minor, TR.answer && TR.answer.currency);
}
/** a change the engine gave: arrow + sign + word, never colour alone; null → "—" (never 0%) */
function trChangeWords(change) {
  if (change === null || change === undefined) return '—';
  var amount = CBLocale.number(Math.abs(change), { maximumFractionDigits: 1 });
  return change > 0 ? '↑ +' + amount + '%' : change < 0 ? '↓ −' + amount + '%' : '= 0%';
}
/** what the note column says about a slot: before the first record, a gap, running, or short (seen of expected) */
function trNote(slot, index, first) {
  var cover = slot.coverage || {},
    unit = TR.period === 'quarter' || TR.period === 'year' ? 'month' : 'day';
  if (slot.gross_minor === null) return cover.partial ? tx('nothing yet') : index < first ? tx('not on CB yet') : tx('missing');
  if (cover.partial) return tx('so far');
  if (cover.short) return cover.seen + ' ' + tx('of') + ' ' + txn('{count} ' + unit, '{count} ' + unit + 's', cover.expected);
  return '';
}
/** the slots as table rows, newest first, each with its words */
function trRows() {
  var slots = TR.state === 'ready' ? trSlots() : [];
  var first = slots.findIndex(function (slot) {
    return slot.gross_minor !== null;
  });
  if (first < 0) first = slots.length;
  return slots
    .map(function (slot, index) {
      return Object.assign({ words: trKeyWords(slot.key, TR.period), note: trNote(slot, index, first) }, slot);
    })
    .reverse();
}

/** the headline: the newest CLOSED period with a figure, against last year — or why there is no comparison */
function trHeadline() {
  var slot = trSlots()
    .filter(function (each) {
      return !each.coverage.partial && each.gross_minor !== null;
    })
    .pop();
  if (!slot) return '';
  var lastYear = slot.last_year || {};
  var against =
    slot.change_pct !== null
      ? trChangeWords(slot.change_pct) + ' ' + tx('vs last year')
      : lastYear.gross_minor !== null && lastYear.gross_minor !== undefined
        ? tx('last year was part of a period')
        : tx('no last year to compare yet');
  var short = slot.coverage.short ? ' (' + trNote(slot, 0, 0) + ')' : ''; /* a short period says so here too: a first year never reads as a whole one */
  return trKeyWords(slot.key, TR.period).title + short + ' · ' + trMoney(slot.gross_minor) + ' · ' + against;
}

/* ── the top: the two Reports views, the four tabs, the headline ── */
function trTab(pair) {
  return (
    '<button data-cbsid="FIN008-B01" type="button" class="tab" aria-pressed="' +
    (TR.period === pair[0] ? 'true' : 'false') +
    '" data-testid="tr-tab-' +
    pair[0] +
    '" onclick="trSetPeriod(\'' +
    pair[0] +
    '\')">' +
    esc(tx(pair[1])) +
    '</button>'
  );
}
function trPaintTop() {
  var box = document.getElementById('tr_top');
  if (!box) return;
  var head = TR.state === 'ready' ? trHeadline() : '';
  var refused =
    TR.state === 'refused'
      ? '<p class="sub" data-testid="tr-refused" style="margin:6px 20px">' +
        esc(tx('Set your country, money and year first.')) +
        ' <a class="act" href="/settings.html#/country" data-testid="tr-country">' +
        esc(tx('Country setup')) +
        '</a></p>'
      : '';
  box.innerHTML =
    fmViews('trend') +
    '<div class="tabs" role="group" aria-label="' +
    esc(tx('Which periods')) +
    '">' +
    TR_TABS.map(trTab).join('') +
    '</div>' +
    (head
      ? '<p data-testid="tr-headline" style="margin:4px 20px 0;font:600 var(--fs-3,17px) var(--sans,sans-serif);color:var(--ink,#2a2418)">' + esc(head) + '</p>'
      : '') +
    refused;
}

/* ── the chart: sales bars, last year's line, hatched = part of a period; the legend names each shape ── */
function trPoints() {
  return MC.salesPoints(trSlots(), TR.period, trDeps());
}
/** one legend entry: a small drawing of the shape, then its words */
function trLegendKey(drawing, words) {
  return '<span style="display:inline-flex;align-items:center;gap:5px;margin-inline-end:14px">' + drawing + esc(words) + '</span>';
}
function trLegend() {
  return (
    '<div class="sub" data-testid="tr-legend" style="margin-top:6px">' +
    trLegendKey(
      '<svg width="12" height="10" aria-hidden="true" style="width:12px;height:10px"><rect width="12" height="10" rx="2" style="fill:var(--green-d,#1f6b46)"/></svg>',
      tx('Sales')
    ) +
    trLegendKey(
      '<svg width="18" height="10" aria-hidden="true" style="width:18px;height:10px"><path d="M0 5H18" style="stroke:var(--muted,#6f6450);stroke-width:1.5;stroke-dasharray:4 3"/><circle cx="9" cy="5" r="2.5" style="fill:var(--card,#fffdf8);stroke:var(--muted,#6f6450);stroke-width:1.5"/></svg>',
      tx('Same time last year')
    ) +
    trLegendKey(
      '<svg width="12" height="10" aria-hidden="true" style="width:12px;height:10px"><rect x=".75" y=".75" width="10.5" height="8.5" style="fill:none;stroke:var(--green-d,#1f6b46);stroke-width:1.5;stroke-dasharray:2 1.5"/></svg>',
      tx('Part of a period')
    ) +
    '</div>'
  );
}
function trPaintChart() {
  var box = document.getElementById('tr_chart');
  if (!box) return;
  if (TR.state !== 'ready' || !TR.answer) {
    box.innerHTML = TR.state === 'loading' ? '<p class="hint">' + esc(tx('Loading…')) + '</p>' : '';
    return;
  }
  var points = trPoints();
  if (
    !points.some(function (point) {
      return point.value !== null;
    })
  ) {
    box.innerHTML = '<p class="hint" data-testid="tr-none">' + esc(tx('No sales summaries on CB yet.')) + '</p>';
    return;
  }
  var head = trHeadline();
  box.innerHTML =
    CBDraw.bars(points, {
      width: Math.max(240, (box.clientWidth || 640) - 8),
      height: 170,
      id: 'tr',
      tid: 'tr',
      aria: tx('Sales by period') + (head ? '. ' + head : '')
    }) + trLegend();
}
window.addEventListener('resize', function () {
  if (!trOn()) return;
  clearTimeout(TR.resizeTimer);
  TR.resizeTimer = setTimeout(trPaintChart, 150);
});

/* ── the table under the chart: the same numbers, for every reader (a screen reader, 390 px, print) ── */
function trMoneyCell(pick) {
  return function (row) {
    return '<span class="mono">' + esc(trMoney(pick(row))) + '</span>';
  };
}
/** the table's columns: period · sales · last year · change · takings · bills · note — the same figures the chart draws */
function trCols() {
  return [
    {
      key: 'period',
      label: tx('Period'),
      prio: 1,
      w: 150,
      cell: function (row) {
        return row.words.title;
      }
    },
    {
      key: 'sales',
      label: tx('Sales'),
      prio: 2,
      w: 130,
      num: true,
      html: true,
      cell: trMoneyCell(function (row) {
        return row.gross_minor;
      }),
      value: function (row) {
        return row.gross_minor;
      }
    },
    {
      key: 'lastyear',
      label: tx('Last year'),
      prio: 3,
      w: 130,
      num: true,
      html: true,
      cell: trMoneyCell(function (row) {
        return row.last_year && row.last_year.gross_minor;
      })
    },
    {
      key: 'change',
      label: tx('Change'),
      prio: 2,
      w: 100,
      num: true,
      html: true,
      cell: function (row) {
        return '<span data-testid="tr-change-' + esc(row.key) + '">' + esc(trChangeWords(row.change_pct)) + '</span>';
      }
    },
    {
      key: 'takings',
      label: tx('Takings'),
      prio: 4,
      w: 130,
      num: true,
      html: true,
      cell: trMoneyCell(function (row) {
        return row.total_minor;
      })
    },
    {
      key: 'bills',
      label: tx('Bills'),
      prio: 5,
      w: 80,
      num: true,
      cell: function (row) {
        return row.bills === null ? '—' : String(row.bills);
      }
    },
    {
      key: 'note',
      label: tx('Note'),
      prio: 3,
      w: 150,
      html: true,
      cell: function (row) {
        return '<span class="sub" data-testid="tr-note-' + esc(row.key) + '">' + esc(row.note) + '</span>';
      }
    }
  ];
}
function trHead() {
  var notices = [];
  if (
    TR.state === 'ready' &&
    trSlots().some(function (slot) {
      return slot.coverage.partial || slot.coverage.short;
    })
  )
    notices.push({ tid: 'tr-coverage', text: tx('A hatched bar is part of a period: the one running now, or a short one.') });
  return { title: tx('Trend'), notices: notices };
}
function trWords() {
  return TR.state === 'refused'
    ? { title: tx('Set your country, money and year first.'), sub: '' }
    : TR.state === 'denied'
      ? { title: tx('This sign-in cannot open the reports.'), sub: '' }
      : { title: tx('Could not read the trend.'), sub: tx('Nothing was lost. Try again.') };
}
/** the Trend view: the top, the chart box, and the table (CBList) — mounted once; the data repaints the parts */
function trMount(frame) {
  var screen = document.getElementById('screen');
  if (!screen) return;
  ftNav();
  TR.period = trPeriodOfHash();
  screen.className = 'screen flush';
  screen.innerHTML =
    '<div id="tr_top" data-testid="tr-top"></div><div id="tr_chart" data-testid="tr-chart-box" style="margin:10px 20px 0"></div><div id="tr_list" data-testid="tr-list" style="flex:1 1 auto;min-height:0"></div>';
  TR.api = CBList.mount(document.getElementById('tr_list'), {
    key: 'fin-trend',
    t: tx,
    rows: trRows,
    id: function (row) {
      return row.key;
    },
    rowTid: function (row) {
      return 'tr-row-' + row.key;
    },
    columns: trCols(),
    defaultCols: ['period', 'sales', 'lastyear', 'change', 'note'],
    cardMax: 4,
    fill: false,
    head: trHead,
    state: function () {
      return TR.state === 'ready' ? 'ready' : TR.state === 'loading' ? 'loading' : 'error';
    },
    error: trWords,
    onRetry: trRetry,
    empty: { title: tx('No sales summaries on CB yet.') },
    search: function (row) {
      return row.words.title;
    }
  });
  trPaintTop();
  trPaintChart();
  if (!frame) trLoad(!!TR.answer && TR.answer.period === TR.period); /* a new tab reads afresh — never the last tab's figures under this tab's name */
}
