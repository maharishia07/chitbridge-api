/* app/chart-sample.js — the REP-36 theme sample page (public/chart-sample.html): the shared chart helper in each of the 16 themes, contrast measured.
 * CARD 26-reporting-mis-and-bi/charts
 * OWNS      the sample's panels and its measured summary (window.CB_CHART_SAMPLE = the rows, for the e2e shot).
 * CALLED BY public/chart-sample.html.
 * READS     CBScreen.APP_THEMES (the avatar's themes) · CBDraw (engine/chart-draw.js) · CBUiStandard.contrastRatio (the one measure). Fetches nothing; the figures are demo figures.
 * FLOW      load -> one panel per theme: the theme's own tokens set on the panel -> CBDraw.paletteNow(panel) -> bars · spark · statusBar · monthStrip -> summary.
 * Flow step: R2R · reports (docs/process/flows.json).
 */
'use strict';

var CS_MONTHS = monthNames('short'); /* helpers.js: the one month words */
var CS_THIS = [42, 48, 51, 47, 55, 60, 58, 63, 61, 66, 70, null];
var CS_LAST = [40, 44, 46, 50, 49, 52, 55, 54, 58, 57, 62, 66];

/** a theme's own tokens set on its panel, the way the avatar sets them on the page (finance.html :root[data-themed]): the page is the theme's paper, the accent text its blue-d */
function csThemeStyle(theme) {
  var vars = theme.vars || {};
  var set = Object.keys(vars)
    .map(function (name) {
      return name + ':' + vars[name];
    })
    .join(';');
  return set + ';--page:var(--paper);--accent-text:var(--blue-d,#174A87);--grey:var(--grey,#6f6450)';
}
/** the twelve months of the sample bars: this year, last year, the hatched part-month and its titles */
function csPoints() {
  return CS_MONTHS.map(function (name, at) {
    return {
      key: name,
      label: name,
      value: CS_THIS[at],
      line: CS_LAST[at],
      hatch: at === 10,
      title: name + ' · ' + (CS_THIS[at] === null ? 'missing' : CS_THIS[at]),
      lineTitle: 'Last year · ' + CS_LAST[at]
    };
  });
}
function csStrip() {
  return CS_MONTHS.map(function (name, at) {
    return { label: name, state: at < 9 ? 'locked' : at === 9 ? 'open' : 'running' };
  });
}
/** the five sample charts of one theme, each drawn with that theme's measured palette */
function csCharts(key, palette) {
  return (
    '<div class="card"><b>Column with previous</b>' +
    CBDraw.bars(csPoints(), { width: 300, height: 120, id: 'cs-bars-' + key, tid: 'cs-bars-' + key, aria: 'Demo sales by month, with last year', actual: palette.actual, previous: palette.previous }) +
    '</div><div class="card"><b>Sparkline</b><div class="row">' +
    CBDraw.spark(CS_THIS, { width: 120, height: 28, stroke: palette.actual, aria: 'Demo sales this year', title: 'Demo sales', desc: 'Eleven months, rising from 42 to 70', tid: 'cs-spark-' + key }) +
    '</div></div><div class="card"><b>Status bar</b>' +
    CBDraw.statusBar(
      [
        { kind: 'good', value: 9, label: '9 clients in order', short: 'ok' },
        { kind: 'watch', value: 4, label: '4 clients to watch', short: 'watch' },
        { kind: 'help', value: 2, label: '2 clients need help', short: 'help' }
      ],
      { width: 300, id: 'cs-status-' + key, tid: 'cs-status-' + key, title: 'Demo clients by status', palette: palette }
    ) +
    '</div><div class="card"><b>Year on year</b>' +
    CBDraw.compare(
      [
        { label: 'Client A', now: 12000000, before: 15000000, changePct: -20, state: 'ok', title: 'Client A: down 20.0%' },
        { label: 'Client E', now: 100000, before: 10000, changePct: 900, state: 'ok', title: 'Client E: up 900.0%, bar capped' },
        { label: 'Client G', now: 6000000, before: 9000000, changePct: -33.3, state: 'stale', title: 'Client G: books in to 30 Sep' }
      ],
      { width: 300, id: 'cs-cmp-' + key, tid: 'cs-cmp-' + key, title: 'Demo sales this year against last year', desc: 'Three demo clients, this year over last year', palette: palette }
    ) +
    '</div><div class="card"><b>Month strip</b>' +
    CBDraw.monthStrip(csStrip(), { id: 'cs-strip-' + key, tid: 'cs-strip-' + key, title: 'Demo months locked', labels: true, palette: palette }) +
    '</div>'
  );
}
/** the worst contrast of a colour over the panel's page and over its card */
function csWorst(contrast, colour, grounds) {
  return Math.min(contrast(colour, grounds.page), contrast(colour, grounds.card));
}
/** one panel: its measured palette, then the four charts drawn with it, then the figures */
function csRow(key, theme, panel, contrast) {
  panel.insertAdjacentHTML('beforeend', '<div class="card" data-testid="cs-probe"></div>');
  var grounds = { page: getComputedStyle(panel).backgroundColor, card: getComputedStyle(panel.lastChild).backgroundColor };
  panel.removeChild(panel.lastChild);
  var palette = CBDraw.paletteNow(contrast, panel);
  panel.insertAdjacentHTML('beforeend', csCharts(key, palette));
  var row = {
    key: key,
    name: theme.name,
    previousMix: palette.previousMix,
    previous: csWorst(contrast, palette.previous, grounds),
    actual: csWorst(contrast, palette.actual, grounds),
    accent: csWorst(contrast, palette.accent, grounds),
    fellBack: palette.fellBack
  };
  panel.insertAdjacentHTML(
    'beforeend',
    '<p class="nums" data-testid="cs-nums-' + key + '">actual ' + row.actual.toFixed(1) + ' · previous ' + row.previous.toFixed(1) + ' (mix ' + row.previousMix + '%) · accent ' + row.accent.toFixed(1) + ' · fell back: ' + (row.fellBack.join(', ') || 'none') + '</p>'
  );
  return row;
}
/** draw one panel per theme, then the measured summary (and window.CB_CHART_SAMPLE for the e2e shot) */
function csMount() {
  var contrast = CBUiStandard.contrastRatio;
  var themes = CBScreen.APP_THEMES;
  var grid = document.getElementById('grid');
  var rows = Object.keys(themes).map(function (key) {
    var panel = document.createElement('section');
    panel.className = 'panel';
    panel.setAttribute('data-testid', 'cs-panel-' + key);
    if (key !== 'cream') panel.setAttribute('style', csThemeStyle(themes[key]) + ';background:var(--page);color:var(--ink)');
    panel.innerHTML = '<h2>' + esc(themes[key].name) + '</h2>';
    grid.appendChild(panel);
    return csRow(key, themes[key], panel, contrast);
  });
  var belowThree = rows.filter(function (row) {
    return row.previous < 3;
  });
  var raised = rows.filter(function (row) {
    return row.previousMix > 55;
  });
  document.getElementById('summary').textContent =
    'Previous clears 3:1 on the page and the card in ' + (rows.length - belowThree.length) + ' of ' + rows.length + ' themes. ' +
    (raised.length ? 'Mix raised above 55% in ' + raised.map(function (row) { return row.name; }).join(', ') + '.' : 'No theme needed more than the 55% mix.');
  window.CB_CHART_SAMPLE = rows;
}
csMount();
