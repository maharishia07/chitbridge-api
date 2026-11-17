/* app/cap-books-overview.js — CB ACCOUNTS › HOW WE ARE DOING: the owner's overview, one read, painted (REP-26, REQ-MIS-SHOWCASE 14, critic c26fe54e).
 * CARD 26-reporting-mis-and-bi/mis
 *
 * ⭐ ONE CALCULATION: every figure, change and sentence piece is the server's — GET /api/books/overview (lib/books-mis): sales (SOLD, tax in) · income, expenses, profit (the P&L, tax out) · to collect, to pay (Dues) · cash ahead (the Cash view, 30 days).
 *   This page formats (money bkMoney → CBLocale in the shop's currency; a percent bkPct, basis points) and draws (CBDraw). It adds, rounds and compares NOTHING.
 * ⭐ ABSENT IS NOT DRAWN: a figure the server did not send (no sales yet, no last year, a seat without costs) has no tile; the page never prints a 0 for an unknown figure, and never says "not available".
 * ⭐ "SO FAR": a running period says so in its own words; the comparison is the same dates last year (a week: the same weekdays of the same week).
 * ⭐ THE PICTURES are the MIS components, one per kind (app/mis-charts.js adapters → CBDraw): sales by month against last year (bars + line) · this week by weekday against the same week last year · profit by month · owed to you / you owe by age (hbars) · cash for 30 days (cashLine). Profit per item stays out (REP-29) and the screen says so.
 * ⭐ NEVER COLOUR ALONE: bars solid, the running month hatched (CBDraw), a table under each picture, a change is a signed percent.
 * Host globals (accounts.html): MC (app/mis-charts.js) · api · EP · esc · tx · txf · bkMoney · bkPct · bkDate · CBDraw · CBLocale.
 * OWNS      OVERVIEW (this view's state) and the How we are doing view (ovView · ovLoad · ovPaint)
 * CALLED BY public/accounts.html (BK.views.overview)
 * FLOW      #overview → ovView() → ovLoad() → GET /api/books/overview?period= → ovPaint(): headline · tiles · two pictures with their tables
 * Flow step: R2R · reports (docs/process/flows.json).
 */
'use strict';
if (typeof EP !== 'undefined') Object.assign(EP, { booksOverview: { m: 'GET', p: '/api/books/overview', ok: 'y' } /* owner · adviser · auditor: how the business is doing, one read (the seat decides the keys) */ });

var OVERVIEW = { period: 'ytd', answer: null, state: 'loading', gen: 0, timer: null };
var OV_PERIODS = [
  ['week', 'This week so far'],
  ['mtd', 'This month so far'],
  ['quarter', 'This quarter so far'],
  ['ytd', 'This year so far']
];
/* UX-137: each control and picture wears its code (register BKS026-..., one row each in the docs SCREENS.json); a tile names its own */
var OV_CODES = { retry: 'BKS026-B01', sales: 'BKS026-B02', income: 'BKS026-B03', profit: 'BKS026-B04', collect: 'BKS026-B05', pay: 'BKS026-B06', cash: 'BKS026-B07', figSales: 'BKS026-B08', figProfit: 'BKS026-B09', head: 'BKS026-P01', picSales: 'BKS026-P02', picProfit: 'BKS026-P03', pick: 'BKS026-S01' };
var OV_SAME = { week: 'the same weekdays last year', mtd: 'the same dates last year', quarter: 'the same dates last year', ytd: 'the same dates last year' };

function ovView(body) {
  body.innerHTML = '<div data-testid="ov" class="ov"><div id="ov_bar"></div><div id="ov_main"></div></div>';
  ovLoad();
}
/** one read; a newer read wins; a failure is a sentence and a button, never a half page */
async function ovLoad() {
  var generation = ++OVERVIEW.gen;
  OVERVIEW.state = 'loading';
  ovPaint();
  try {
    var answer = await api('booksOverview', { query: { period: OVERVIEW.period } });
    if (generation !== OVERVIEW.gen) return;
    OVERVIEW.answer = answer || null;
    OVERVIEW.state = 'ready';
  } catch (error) {
    if (generation !== OVERVIEW.gen) return;
    if (typeof cblog === 'function') cblog('error', 'overview: ' + ((error && error.message) || error));
    OVERVIEW.state = 'error';
  }
  ovPaint();
}
function ovPick(period) {
  OVERVIEW.period = period;
  ovLoad();
}
function ovMoney(minor) {
  return bkMoney(minor, OVERVIEW.answer && OVERVIEW.answer.currency);
}
function ovSelect() {
  return (
    '<select class="inp" id="ov_pick" data-cbsid="' + OV_CODES.pick + '" data-testid="ov-pick" aria-label="' + esc(tx('Which period')) + '" onchange="ovPick(this.value)">' +
    OV_PERIODS.map(function (item) {
      return '<option value="' + item[0] + '"' + (item[0] === OVERVIEW.period ? ' selected' : '') + '>' + esc(tx(item[1])) + '</option>';
    }).join('') +
    '</select>'
  );
}
/** the top line: the lead figure (income, tax out; sales for a reader without costs), what it is, and its change on last year, all carried */
function ovHeadline(a) {
  var lead = a.income && a.income.minor != null ? { words: 'Income', fig: a.income } : a.sales && a.sales.minor != null ? { words: 'Sales', fig: a.sales } : null;
  if (!lead) return '';
  var change = lead.fig.change_bp != null ? ' (' + bkPct(lead.fig.change_bp, true) + ' ' + esc(tx('on')) + ' ' + esc(tx(OV_SAME[a.period.word])) + ')' : '';
  return '<p data-cbsid="' + OV_CODES.head + '" data-testid="ov-headline" class="ov-head">' + esc(tx(lead.words)) + ' ' + esc(tx(OV_PERIODS.filter(function (x) { return x[0] === a.period.word; })[0][1]).toLowerCase()) + ': <b>' + esc(ovMoney(lead.fig.minor)) + '</b>' + change + '</p>';
}
/** one tile: a label, the figure, its note; a link into the page that holds the figure; absent → nothing */
function ovTile(tid, label, minor, note, href) {
  if (minor == null) return '';
  return (
    '<a class="ov-tile" href="' + href + '" data-cbsid="' + OV_CODES[tid] + '" data-testid="ov-' + tid + '"><span class="ov-l">' + esc(tx(label)) + '</span><span class="ov-v">' + esc(ovMoney(minor)) + '</span>' +
    (note ? '<span class="ov-n">' + note + '</span>' : '') + '</a>'
  );
}
function ovChange(fig) {
  return fig && fig.change_bp != null ? bkPct(fig.change_bp, true) + ' ' + esc(tx('on last year')) : '';
}
/** the headline tiles (sales · income · profit · to collect · to pay · cash): a figure the server did not send has no tile */
function ovTiles(answer) {
  var salesFig = answer.sales || {},
    cash = answer.cash;
  var tiles = [
    ovTile('sales', 'Sales, tax in', salesFig.minor, ovChange(salesFig) + (salesFig.partial ? ' · ' + esc(tx('books began part-way')) : ''), '#daybook'),
    answer.income ? ovTile('income', 'Income, tax out', answer.income.minor, ovChange(answer.income), '#pl') : '',
    answer.profit ? ovTile('profit', 'Profit', answer.profit.minor, ovChange(answer.profit), '#pl') : '',
    answer.to_collect ? ovTile('collect', 'To collect', answer.to_collect.minor, '', '#dues') : '',
    answer.to_pay ? ovTile('pay', 'To pay', answer.to_pay.minor, '', '#dues') : ''
  ];
  if (cash && cash.words) tiles.push('<a class="ov-tile ov-wide" href="/finance.html#/cash" data-cbsid="' + OV_CODES.cash + '" data-testid="ov-cash"><span class="ov-l">' + esc(tx('Cash ahead, 30 days')) + '</span><span class="ov-n">' + esc(ovMoneyWords(cash.words, OVERVIEW.answer && OVERVIEW.answer.currency)) + '</span></a>');
  return '<div class="ov-tiles">' + tiles.join('') + '</div>';
}
/** the words deps the adapters (app/mis-charts.js) take: the one text, money and date makers of this page */
function ovDeps() {
  return { tx: tx, money: bkMoney, date: CBLocale.date, cur: OVERVIEW.answer && OVERVIEW.answer.currency };
}
/** a card's chart width, so it is drawn at the size it shows (no scaling surprise at 390): half the page on a wide screen, all of it on a narrow one */
function ovWidth() {
  var box = document.getElementById('ov_main');
  return Math.max(220, Math.floor(((box && box.clientWidth) || 640) / (window.innerWidth > 900 ? 2 : 1)) - 28);
}
/** the table under a chart (a table under every chart): head + rows from the adapter, behind "Show the figures" */
function ovTable(table, code, tid) {
  if (!table || !table.rows.length) return '';
  return (
    '<details><summary data-cbsid="' + code + '" data-testid="ov-pic-' + tid + '-figures">' + esc(tx('Show the figures')) + '</summary><table class="bk-st"><thead><tr>' +
    table.head.map(function (cell, i) { return '<th scope="col"' + (i ? ' class="num"' : '') + '>' + esc(cell) + '</th>'; }).join('') + '</tr></thead><tbody>' +
    table.rows.map(function (row) { return '<tr>' + row.map(function (cell, i) { return '<td' + (i ? ' class="num"' : '') + '>' + esc(cell) + '</td>'; }).join('') + '</tr>'; }).join('') +
    '</tbody></table></details>'
  );
}
/** one picture card: title, the chart (the adapter's points through the ONE CBDraw component of its kind), its legend line and its table; nothing to draw → no card, never an empty frame */
function ovCard(tid, code, title, svg, legend, table, tableCode) {
  if (!svg) return '';
  return (
    '<section class="ov-pic" data-testid="ov-pic-' + tid + '" data-cbsid="' + code + '"><h3>' + esc(tx(title)) + '</h3>' + svg +
    (legend ? '<p class="ov-n" data-testid="ov-pic-' + tid + '-legend">' + esc(legend) + '</p>' : '') + ovTable(table, tableCode, tid) + '</section>'
  );
}
function ovHas(points) {
  return points.some(function (point) { return point.value !== null && point.value !== undefined; });
}
/** sales by month against the same month last year (bars + the dashed line), and sales by weekday: this ISO week against the same week last year */
function ovSalesCards(a) {
  var deps = ovDeps(),
    months = MC.monthPoints(a.bars, deps),
    days = MC.weekdayPoints(a.weekdays, deps);
  return (
    ovCard('sales', 'BKS026-P02', 'Sales by month, tax in', ovHas(months) ? CBDraw.bars(months, { width: ovWidth(), height: 140, id: 'ovsales', tid: 'ov-sales', aria: tx('Sales by month, tax in') }) : '', tx('Solid = sales · line = same time last year · hatched = the month so far'), MC.monthTable(a.bars, 'sold_minor', deps, true), 'BKS026-B08') +
    ovCard('weekday', 'BKS026-P04', 'This week by weekday', ovHas(days) ? CBDraw.bars(days, { width: ovWidth(), height: 140, id: 'ovweek', tid: 'ov-weekday', aria: tx('Sales by weekday this week') }) : '', tx('Solid = this week · line = the same weekday last year'), MC.weekdayTable(a.weekdays, deps), 'BKS026-B10')
  );
}
function ovProfitCard(a) {
  if (!a.profit_by_month) return '';
  var deps = ovDeps(),
    points = MC.profitPoints(a.profit_by_month, deps);
  return ovCard('profit', 'BKS026-P03', 'Profit by month', ovHas(points) ? CBDraw.bars(points, { width: ovWidth(), height: 140, id: 'ovprofit', tid: 'ov-profit', aria: tx('Profit by month') }) : '', tx('Hatched = the month so far'), MC.monthTable(a.profit_by_month, 'profit_minor', deps, false), 'BKS026-B09');
}
/** what customers owe and what we owe, each by age (hbars); a side the server did not send has no card */
function ovDuesCard(a, side) {
  var deps = ovDeps(),
    out = MC.duesRows(a, side, deps),
    key = side === 'customer' ? 'owed' : 'owe',
    title = side === 'customer' ? 'Owed to you, by age' : 'You owe, by age';
  if (!out.rows.some(function (row) { return row.value > 0; })) return '';
  var svg = CBDraw.hbars(out.rows, { width: ovWidth(), id: 'ov' + key, tid: 'ov-' + key + '-hb', title: tx(title), desc: out.rows.map(function (r) { return r.title; }).join(', ') });
  return ovCard(key, side === 'customer' ? 'BKS026-P05' : 'BKS026-P06', title, svg, tx('Hatched = late'), out.table, side === 'customer' ? 'BKS026-B11' : 'BKS026-B12');
}
/** the server's sentence states an amount as CODE + figure ("AUD 994,008.80": lib/money prints the code, never a symbol); the page's own money maker (bkMoney, CBLocale) owns the look, so each such amount in the shop's currency is re-drawn by it. The figure is the server's, read back to minor units by its own decimals; nothing is added or rounded. */
function ovMoneyWords(words, cur) {
  if (!words || !cur) return words || '';
  return String(words).replace(new RegExp('\\b' + cur + ' (-?[\\d,]+)(?:\\.(\\d+))?', 'g'), function (whole, int, frac) {
    var digits = String(frac || ''), minor = Number(String(int).replace(/,/g, '') + digits);
    return isFinite(minor) ? bkMoney(minor, cur) : whole;
  });
}
/** cash for the next 30 days (the cash view's own series, lowest day and words) */
function ovCashCard(a) {
  if (!a.cash || !a.cash.series || !a.cash.series.length) return '';
  var deps = ovDeps(),
    out = MC.cashPoints(a.cash, deps);
  var svg = CBDraw.cashLine(out.points, { width: ovWidth(), height: 140, id: 'ovcash', tid: 'ov-cashline-svg', title: tx('Cash for the next 30 days'), desc: ovMoneyWords(a.cash.words, deps.cur), startWords: out.startWords, endWords: out.endWords, lowestAt: out.lowestAt, lowestWords: out.lowestWords });
  return ovCard('cashline', 'BKS026-P07', 'Cash, next 30 days', svg, ovMoneyWords(a.cash.words, deps.cur), out.table, 'BKS026-B13');
}
/** profit PER ITEM is not drawn: it needs what each item cost (REP-29); the screen says so, never an empty chart */
function ovItemNote() {
  return '<p class="ov-n" data-testid="ov-item-note" data-cbsid="BKS026-P08">' + esc(tx('Profit per item needs the cost of each item, so it is not shown yet.')) + '</p>';
}
function ovPictures(a) {
  return '<div class="ov-pics">' + ovSalesCards(a) + ovProfitCard(a) + ovDuesCard(a, 'customer') + ovDuesCard(a, 'supplier') + ovCashCard(a) + '</div>' + ovItemNote();
}
function ovCss() {
  return [
    '<style>.ov{padding:0 12px 12px}.ov-bar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:6px 0}.ov-head{margin:4px 0 8px;font:600 var(--fs-3,17px) var(--sans,sans-serif);color:var(--ink,#2a2418)}',
    '.ov-tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin-bottom:10px}.ov-tile{display:flex;flex-direction:column;gap:2px;padding:8px 10px;border:1px solid var(--line-3,#d8ccb0);border-radius:8px;background:var(--card,#fffdf8);color:var(--ink,#2a2418);text-decoration:none}',
    '.ov-l{font-size:var(--fs-1,12px);color:var(--muted,#6f6450)}.ov-v{font:700 var(--fs-3,17px) var(--sans,sans-serif)}.ov-n{font-size:var(--fs-1,12px);color:var(--muted,#6f6450)}.ov-wide{grid-column:1/-1}',
    '.ov-pics{display:grid;grid-template-columns:1fr;gap:10px}@media(min-width:901px){.ov-pics{grid-template-columns:1fr 1fr}}.ov-pic{border:1px solid var(--line-3,#d8ccb0);border-radius:8px;padding:6px 10px;background:var(--card,#fffdf8);min-width:0;overflow:hidden}.ov-pic h3{margin:0 0 2px;font-size:var(--fs-2,14px)}.ov-pic details{font-size:var(--fs-1,12px)}.ov .bk-st .num{text-align:right}.ov-pic .bk-st{width:100%;border-collapse:collapse}.ov-pic .bk-st th{text-align:start;color:var(--muted,#6f6450);font-weight:500}</style>'
  ].join('');
}
/** paint the bar and the main area for the state the view is in: loading · error with a retry · the answer (headline, tiles, pictures) */
function ovPaint() {
  var bar = document.getElementById('ov_bar'),
    main = document.getElementById('ov_main');
  if (!bar || !main) return;
  bar.innerHTML = ovCss() + '<div class="ov-bar">' + ovSelect() + (OVERVIEW.state === 'ready' && OVERVIEW.answer && OVERVIEW.answer.sales && OVERVIEW.answer.sales.through ? '<span style="color:var(--grey);font-size:var(--fs-1)" data-testid="ov-through">' + esc(txf('Books in to {date}', { date: bkDate(OVERVIEW.answer.sales.through) })) + '</span>' : '') + '</div>';
  if (OVERVIEW.state === 'loading') main.innerHTML = '<p class="hint">' + esc(tx('Loading…')) + '</p>';
  else if (OVERVIEW.state !== 'ready' || !OVERVIEW.answer) main.innerHTML = '<p class="hint" data-testid="ov-error">' + esc(tx('This did not load.')) + ' <button class="btn" type="button" data-cbsid="' + OV_CODES.retry + '" data-testid="ov-retry" onclick="ovLoad()">' + esc(tx('Try again')) + '</button></p>';
  else {
    var answer = OVERVIEW.answer;
    main.innerHTML = ovHeadline(answer) + ovTiles(answer) + ovPictures(answer);
  }
}
window.addEventListener('resize', function () {
  clearTimeout(OVERVIEW.timer);
  OVERVIEW.timer = setTimeout(function () {
    if (document.getElementById('ov_main') && OVERVIEW.state === 'ready') ovPaint();
  }, 150);
});
