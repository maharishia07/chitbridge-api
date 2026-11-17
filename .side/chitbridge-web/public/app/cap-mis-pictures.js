/* app/cap-mis-pictures.js — CB FINANCE › REPORTS › PICTURES: the owner's MIS charts on one screen (MISCH, 2026-11-17).
 * CARD 26-reporting-mis-and-bi/charts
 *
 * Athi, 17 Nov: "complete the MIS, graphs, charts and so on". The pictures a shopkeeper reads at a glance, each from an EXISTING read, each with its table underneath:
 *   Sales (weeks · months · years, beside last year) · what customers owe by age · what we owe by age · income and expense against last year · cash for 30 days.
 * ⭐ ONE CALCULATION: every figure is the server's (GET /api/till/summary?compare=1 · /books/dues aged_totals · /books/pl by_line · /books/cashflow series + lowest); app/mis-charts.js only
 *   renames and words them, CBDraw only draws (engine/chart-draw.js). Money through bkMoney (CBLocale, the shop's currency). A figure not given is "—", never 0.
 * ⭐ EACH PICTURE PAINTS WHEN ITS OWN READ ANSWERS (first data fast), a failed read says so in that card only, and the others stay.
 * The overview screen (lane mis2) places the same pictures: call pcSales / pcDues / pcPl / pcCash(box, answer) with a box and the server's answer; nothing else is needed.
 * Host globals (finance.html): MC (app/mis-charts.js) · CBDraw · api · EP · esc · tx · bkMoney · CBLocale · ftNav · fmViews · cblog.
 * OWNS      PICS (this view's state) and the Pictures view of CB Finance › Reports (pcMount · pcLoad · pcSales · pcDues · pcPl · pcCash)
 * CALLED BY app/cap-mis.js (pcOn · pcMount · pcLoad: fmMount and fmLoad hand #/reports/pictures here) · app/cap-mis-trend.js is its sibling (the Trend view keeps the full table)
 * FLOW      #/reports/pictures → pcMount() → pcLoad() → four reads in parallel → each card paints on its own answer → CBDraw → svg + table toggle
 * Flow step: R2R · reports (docs/process/flows.json).
 */
'use strict';

var PICS = { gen: 0, period: 'month', sales: {}, dues: null, pl: null, cash: null, state: { sales: 'loading', dues: 'loading', pl: 'loading', cash: 'loading' }, table: {}, resizeTimer: null };
/* the one accent: ink for this period, the same ink thinned for last year (the other pictures read --rp-actual / --rp-previous from the same tokens) */
var PC_INK = 'var(--ink,#2a2418)',
  PC_GREY = 'color-mix(in srgb,var(--ink,#2a2418) 55%,var(--page,#FCFAF5))';
var PC_PERIODS = [
  ['week', 'Weeks'],
  ['month', 'Months'],
  ['year', 'Years']
];

/** is the Reports tab showing the Pictures view? */
function pcOn() {
  return /^#\/reports\/pictures/.test(location.hash);
}
function pcDeps(currency) {
  return { tx: tx, money: bkMoney, date: CBLocale.date, cur: currency };
}
/** a card's body width, so the chart is drawn at the size it shows (no scaling surprise at 390) */
function pcWidth(box, most) {
  return Math.max(220, Math.min(most || 720, (box.clientWidth || 640) - 2));
}

/** the table under a chart: head + rows from the adapter, as a plain table */
function pcTable(table) {
  if (!table || !table.rows.length) return '';
  return (
    '<table class="pc-table" style="width:100%;border-collapse:collapse;font:12px var(--mono,monospace)"><thead><tr>' +
    table.head.map(function (cell) { return '<th scope="col" style="text-align:start;padding:2px 6px;color:var(--muted,#6f6450)">' + esc(cell) + '</th>'; }).join('') +
    '</tr></thead><tbody>' +
    table.rows.map(function (row) {
      return '<tr>' + row.map(function (cell) { return '<td style="padding:2px 6px;border-top:1px solid var(--line-3,#d8ccb0)">' + esc(cell) + '</td>'; }).join('') + '</tr>';
    }).join('') +
    '</tbody></table>'
  );
}
/** a card: its title, a Table toggle, the chart box. `key` names it for the toggle and the test ids */
function pcCard(key, title, code, extra, wide) {
  return (
    '<section class="pc-card" data-testid="pc-' + key + '" data-cbsid="' + code + '" style="' + (wide ? 'grid-column:1/-1;' : '') + 'background:var(--card,#fffdf8);border:1px solid var(--line-3,#d8ccb0);border-radius:10px;padding:10px 12px;min-width:0">' +
    '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap"><h3 style="margin:0;font:600 var(--fs-2,14px) var(--sans,sans-serif);color:var(--ink,#2a2418)">' + esc(tx(title)) + '</h3>' +
    '<span style="display:inline-flex;gap:6px"><button type="button" class="tab" data-testid="pc-' + key + '-table-btn" data-cbsid="FIN008-B04" aria-pressed="false" onclick="pcToggleTable(\'' + key + '\')">' + esc(tx('Table')) + '</button></span></div>' +
    (extra ? '<div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap">' + extra + '</div>' : '') +
    '<div id="pc_' + key + '" data-testid="pc-' + key + '-box" style="margin-top:8px;min-height:60px"><p class="hint">' + esc(tx('Loading…')) + '</p></div>' +
    '<div id="pc_' + key + '_tbl" data-testid="pc-' + key + '-table" hidden style="margin-top:6px;max-height:200px;overflow:auto"></div></section>'
  );
}
function pcToggleTable(key) {
  PICS.table[key] = !PICS.table[key];
  var table = document.getElementById('pc_' + key + '_tbl'),
    button = document.querySelector('[data-testid="pc-' + key + '-table-btn"]');
  if (table) table.hidden = !PICS.table[key];
  if (button) button.setAttribute('aria-pressed', PICS.table[key] ? 'true' : 'false');
}
/** write a chart and its table into a card; `words` replaces both when there is nothing to draw (one honest sentence, no empty frame) */
function pcFill(key, svg, table, words) {
  var box = document.getElementById('pc_' + key),
    holder = document.getElementById('pc_' + key + '_tbl');
  if (!box) return;
  box.innerHTML = svg || '<p class="hint" data-testid="pc-' + key + '-none">' + esc(words) + '</p>';
  if (holder) holder.innerHTML = svg ? pcTable(table) : '';
}
function pcFail(key, error) {
  var box = document.getElementById('pc_' + key);
  if (!box) return;
  var denied = error && (error.status === 403 || error.status === 404);
  box.innerHTML = '<p class="hint" data-testid="pc-' + key + '-error">' + esc(denied ? tx('This sign-in cannot see this one.') : tx('Could not read this. Try again.')) + '</p>';
}

/* ── the pictures: each takes a box id and the server's answer (the overview screen calls these too) ── */
function pcSales(answer) {
  var box = document.getElementById('pc_sales');
  if (!box) return;
  var deps = pcDeps(answer && answer.currency),
    slots = (answer && answer.slots) || [],
    points = MC.salesPoints(slots, PICS.period, deps),
    drawn = points.some(function (point) { return point.value !== null; });
  var picture = drawn
    ? CBDraw.bars(points, { width: pcWidth(box, 1100), height: 150, actual: PC_INK, previous: PC_GREY, id: 'pcs', tid: 'pcs', aria: tx('Sales by period'), codes: { chart: 'FIN008-P06' } }) + pcSalesLegend()
    : '';
  pcFill('sales', picture, MC.salesTable(slots, PICS.period, deps), tx('No sales summaries on CB yet.'));
}
function pcSalesLegend() {
  return '<div class="sub" data-testid="pcs-legend" style="margin-top:4px;display:flex;gap:12px;flex-wrap:wrap"><span>▮ ' + esc(tx('Sales')) + '</span><span>┄○ ' + esc(tx('Same time last year')) + '</span><span>▨ ' + esc(tx('Part of a period')) + '</span></div>';
}
/** the dues card of one side (owed to you, or you owe): the carried ageing buckets as bars, late ones hatched, with the table under it */
function pcDues(side, answer) {
  var key = side === 'customer' ? 'owed' : 'owe',
    box = document.getElementById('pc_' + key);
  if (!box) return;
  var deps = pcDeps(answer && answer.currency),
    out = MC.duesRows(answer, side, deps),
    nothing = !out.rows.some(function (row) { return row.value > 0; });
  var title = side === 'customer' ? tx('Owed to you, by age') : tx('You owe, by age');
  var picture = nothing
    ? ''
    : CBDraw.hbars(out.rows, { width: pcWidth(box), id: 'pc' + key, tid: 'pc' + key, title: title, desc: out.rows.map(function (r) { return r.title; }).join(', '), codes: { chart: side === 'customer' ? 'FIN008-P07' : 'FIN008-P08' } }) +
      '<div class="sub" style="margin-top:4px">' + esc(tx('Hatched = late')) + '</div>';
  pcFill(key, picture, out.table, side === 'customer' ? tx('Nobody owes you anything open.') : tx('You owe nothing open.'));
}
/** the income and expense card: this year against last year, the carried money, with the table under it */
function pcPl(answer) {
  var box = document.getElementById('pc_pl');
  if (!box) return;
  var deps = pcDeps(answer && answer.currency),
    out = MC.plRows(answer, deps);
  var picture = out.rows.length
    ? CBDraw.compare(out.rows, { width: pcWidth(box), row: 22, mode: 'money', id: 'pcpl', tid: 'pcpl', title: tx('Income and expense, this year against last'), desc: out.rows.map(function (r) { return r.title; }).join('. '), codes: { chart: 'FIN008-P09' } }) +
      '<div class="sub" style="margin-top:4px">' + esc(tx('Solid = this year · outline = last year')) + '</div>'
    : '';
  pcFill('pl', picture, out.table, tx('No income or expense yet this year.'));
}
/** the cash card: the next 30 days as one line, its two ends and the server's lowest day labelled */
function pcCash(answer) {
  var box = document.getElementById('pc_cash');
  if (!box) return;
  var deps = pcDeps(answer && answer.currency),
    out = MC.cashPoints(answer, deps);
  var picture = CBDraw.cashLine(out.points, {
    width: pcWidth(box),
    height: 150,
    id: 'pcc',
    tid: 'pcc',
    title: tx('Cash for the next 30 days'),
    desc: (answer && answer.words) || '',
    startWords: out.startWords,
    endWords: out.endWords,
    lowestAt: out.lowestAt,
    lowestWords: out.lowestWords,
    codes: { chart: 'FIN008-P10' }
  });
  pcFill('cash', picture + (answer && answer.words ? '<p class="sub" data-testid="pcc-words" style="margin:4px 0 0">' + esc(answer.words) + '</p>' : ''), out.table, tx('No cash figures yet.'));
}

/* ── the reads ── */
function pcTab(pair) {
  return '<button type="button" class="tab" data-testid="pc-tab-' + pair[0] + '" data-cbsid="FIN008-B03" aria-pressed="' + (PICS.period === pair[0] ? 'true' : 'false') + '" onclick="pcSetPeriod(\'' + pair[0] + '\')">' + esc(tx(pair[1])) + '</button>';
}
/** the sales card's tab: one read per period, kept so a tab seen twice costs nothing */
async function pcSetPeriod(period) {
  PICS.period = period;
  var tabs = document.getElementById('pc_sales_tabs');
  if (tabs) tabs.innerHTML = PC_PERIODS.map(pcTab).join('');
  if (PICS.sales[period]) return pcSales(PICS.sales[period]);
  try {
    PICS.sales[period] = await api('tillTrend', { query: { compare: '1', period: period } });
    if (PICS.period === period) pcSales(PICS.sales[period]);
  } catch (error) {
    if (typeof cblog === 'function') cblog('error', 'pictures sales: ' + ((error && error.message) || error));
    pcFail('sales', error);
  }
}
/** one read, one card: a newer load wins; a failure stays in its own card */
function pcRead(generation, key, name, query, paint) {
  return api(name, { query: query }).then(
    function (answer) {
      if (generation === PICS.gen) paint(answer);
    },
    function (error) {
      if (generation !== PICS.gen) return;
      if (typeof cblog === 'function') cblog('error', 'pictures ' + key + ': ' + ((error && error.message) || error));
      pcFail(key, error);
    }
  );
}
/** the four reads of the Pictures view, in parallel; each card paints on its own answer or says it could not load */
function pcLoad() {
  var generation = ++PICS.gen;
  PICS.sales = {};
  var tasks = [
    pcRead(generation, 'sales', 'tillTrend', { compare: '1', period: PICS.period }, function (answer) { PICS.sales[PICS.period] = answer; pcSales(answer); }),
    pcRead(generation, 'cash', 'booksCashflow', { days: '30' }, function (answer) { PICS.cash = answer; pcCash(answer); }),
    pcRead(generation, 'pl', 'booksPL', { preset: 'ytd' }, function (answer) { PICS.pl = answer; pcPl(answer); })
  ];
  tasks.push(pcRead(generation, 'owed', 'booksDues', {}, function (answer) { PICS.dues = answer; pcDues('customer', answer); pcDues('supplier', answer); }));
  return Promise.all(tasks);
}

/** mount the Pictures view into the Reports screen */
function pcMount() {
  var screen = document.getElementById('screen');
  if (!screen) return;
  ftNav();
  screen.className = 'screen flush';
  var tabs = '<span id="pc_sales_tabs" role="group" aria-label="' + esc(tx('Which periods')) + '" style="display:inline-flex;gap:6px">' + PC_PERIODS.map(pcTab).join('') + '</span>';
  screen.innerHTML =
    '<div id="pc_top" data-testid="pc-top">' + fmViews('pictures') + '</div>' +
    '<div data-testid="pc-grid" style="flex:1 1 auto;min-height:0;overflow:auto;padding:10px 20px 20px;display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(min(100%,255px),1fr));align-content:start">' +
    pcCard('sales', 'Sales against last year', 'FIN008-P01', tabs, true) +
    pcCard('owed', 'Owed to you, by age', 'FIN008-P02') +
    pcCard('owe', 'You owe, by age', 'FIN008-P03') +
    pcCard('cash', 'Cash, next 30 days', 'FIN008-P04') +
    pcCard('pl', 'Income and expense, this year', 'FIN008-P05') +
    '</div>';
  PICS.table = {};
  PICS.dues = PICS.cash = PICS.pl = null;
  pcLoad();
}
window.addEventListener('resize', function () {
  if (!pcOn()) return;
  clearTimeout(PICS.resizeTimer);
  PICS.resizeTimer = setTimeout(function () {
    if (PICS.sales[PICS.period]) pcSales(PICS.sales[PICS.period]);
    if (PICS.dues) { pcDues('customer', PICS.dues); pcDues('supplier', PICS.dues); }
    if (PICS.cash) pcCash(PICS.cash);
    if (PICS.pl) pcPl(PICS.pl);
  }, 150);
});
