'use strict';
// @type: unit
/**
 * chart-sample.test.cjs — REP-36: the theme sample page (public/chart-sample.html + public/app/chart-sample.js) run outside the browser.
 *
 * OWNS      the proof that the sample draws one panel per theme with that theme's own tokens, measures contrast with the one measure (CBUiStandard.contrastRatio, here chart-draw's own
 *           twin), names a theme whose previous-year colour needed a stronger mix IN WORDS (never hidden), and that the page loads the chart helper before the sample.
 * CALLED BY by hand and the QA gate: node e2e/chart-sample.test.cjs   (exit 1 on any failure)
 * CARD      26-reporting-mis-and-bi/charts
 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const pub = (file) => fs.readFileSync(path.join(__dirname, '..', 'public', file), 'utf8');
let failures = 0;
const check = (condition, message) => {
  console.log((condition ? '  ok ' : '  FAIL ') + message);
  if (!condition) failures++;
};

/** a panel the sample can fill: it keeps the html inserted into it, and answers the computed colours the theme sets */
function fakePanel(tokens) {
  const panel = { html: '', attrs: {}, lastChild: { id: 'probe' }, tokens: tokens || {}, className: '' };
  panel.insertAdjacentHTML = (where, html) => { panel.html += html; };
  panel.removeChild = () => {};
  panel.setAttribute = (name, value) => { panel.attrs[name] = value; };
  panel.appendChild = () => {};
  Object.defineProperty(panel, 'innerHTML', { get: () => panel.html, set: (value) => { panel.html = value; } });
  return panel;
}

/** the page, stubbed: two themes (cream and a flat one whose page and ink are almost the same), the helper files, the sample */
function runSample(themes) {
  const panels = [];
  const summary = { textContent: '' };
  const ctx = {
    console,
    window: null,
    esc: (text) => String(text == null ? '' : text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]),
    monthNames: () => ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
    CBScreen: { APP_THEMES: themes },
    document: {
      createElement: () => { const panel = fakePanel(); panels.push(panel); return panel; },
      getElementById: (id) => (id === 'summary' ? summary : { appendChild: () => {} }),
      documentElement: {}
    },
    getComputedStyle: (element) => ({
      backgroundColor: 'rgb(252,250,245)',
      getPropertyValue: (name) => (element && element.tokens && element.tokens[name]) || ''
    })
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  ['engine/chart-draw.js', 'engine/chart-draw-status.js', 'engine/chart-draw-rows.js'].forEach((file) => vm.runInContext(pub(file), ctx, { filename: file }));
  ctx.CBUiStandard = { contrastRatio: ctx.CBDraw.contrastRatio };
  const originalCreate = ctx.document.createElement;
  ctx.document.createElement = () => {
    const panel = originalCreate();
    panel.tokens = { '--ink': '#222222', '--paper': '#fafafa' };
    return panel;
  };
  vm.runInContext(pub('app/chart-sample.js'), ctx, { filename: 'app/chart-sample.js' });
  return { ctx, panels, summary };
}

console.log('the sample draws one panel per theme and measures it');
const themes = { cream: { name: 'Cream', vars: {} }, slate: { name: 'Slate', vars: { '--ink': '#222222' } } };
const run = runSample(themes);
check(run.panels.length === 2, 'one panel for each of the two themes');
check(run.ctx.CB_CHART_SAMPLE.length === 2 && run.ctx.CB_CHART_SAMPLE.every((row) => typeof row.actual === 'number' && typeof row.previous === 'number'), 'the rows the e2e shot reads carry the measured contrast of actual and previous');
check(/Previous clears 3:1 on the page and the card in \d+ of 2 themes\./.test(run.summary.textContent), 'the summary says in words how many themes clear 3:1');
check(run.panels.every((panel) => /Column with previous/.test(panel.html) && /Month strip/.test(panel.html)), 'every panel carries the five charts, drawn with its own palette');

console.log('a theme that needed a stronger mix is named in words, never hidden (it fell back, and the page says so)');
const tight = runSample({ flat: { name: 'Flat', vars: {} } });
tight.ctx.CB_CHART_SAMPLE.forEach((row) => {
  const raised = row.previousMix > 55;
  check(!raised || /Mix raised above 55% in Flat\./.test(tight.summary.textContent), 'a raised mix (' + row.previousMix + '%) is printed in the summary, or none was needed');
});
check(/No theme needed more than the 55% mix\.|Mix raised above 55% in/.test(tight.summary.textContent), 'the summary always ends with one of its two sentences');

console.log('the page loads the helper before the sample, with no network call');
const html = pub('chart-sample.html');
const order = ['/engine/chart-draw.js', '/engine/chart-draw-status.js', '/engine/chart-draw-rows.js', '/app/chart-sample.js'].map((src) => html.indexOf('src="' + src + '"'));
check(order.every((at) => at > 0) && order.every((at, i) => i === 0 || at > order[i - 1]), 'chart-draw (core, status, rows) is loaded before app/chart-sample.js');
check(!/fetch\(|XMLHttpRequest/.test(pub('app/chart-sample.js')), 'chart-sample.js fetches nothing: the figures are demo figures');

if (failures) {
  console.log('\n' + failures + ' FAILED');
  process.exit(1);
}
console.log('\nall ok');
