/**
 * chart-smoke.cjs — Run the chart renderers outside the browser with real-shaped data, because an SVG that draws a label off the
 * edge of its own viewBox, or emits NaN into a width, looks like a blank card and says nothing about why.
 */
const fs = require('fs');
const src = fs.readFileSync(require('path').join(__dirname, '..', 'public', 'testing.html'), 'utf8');
/* the page has more than one inline script (K-SEC PR A put a tiny device one first): take the one that holds the renderers */
const script = (src.match(/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/g) || [])
  .map((b) => b.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, ''))
  .find((b) => b.includes('function chartLegend('));
if (!script) throw new Error('no inline script holds chartLegend');

/* pull just the renderers, with the one helper they need */
const pick = (name) => {
  const i = script.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('no ' + name);
  let d = 0, j = script.indexOf('{', i);
  for (let k = j; k < script.length; k++) {
    if (script[k] === '{') d++;
    else if (script[k] === '}') { d--; if (!d) return script.slice(i, k + 1); }
  }
  throw new Error('unbalanced ' + name);
};

const code = [
  "function esc(s){ return String(s == null ? '' : s).replace(/[&<>\"]/g, function(c){",
  "  return ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '\"':'&quot;' })[c]; }); }",
  script.slice(script.indexOf('var CHART_TONES'), script.indexOf('function chartLegend')),
  pick('chartLegend'), pick('chartStack'), pick('chartTrend'),
].join('\n');
const F = new Function(code + '; return { chartStack, chartTrend, chartLegend };')();

const AREAS = [
  { key: 'CTR', total: 10, passed: 4, failed: 2, blocked: 1, untested: 3 },
  { key: 'SLIP', total: 3, passed: 3, failed: 0, blocked: 0, untested: 0 },
  { key: 'SYNC', total: 3, passed: 0, failed: 0, blocked: 0, untested: 3 },
  { key: 'AVERYLONGMODULENAME', total: 5, passed: 5, failed: 0, blocked: 0, untested: 0 },
];
const TREND = [
  { at: '2026-09-08T10:00:00Z', run_label: 'a', passed: 12, failed: 3, blocked: 0, total: 15 },
  { at: '2026-09-09T10:00:00Z', run_label: 'b', passed: 20, failed: 1, blocked: 2, total: 23 },
  { at: '2026-09-10T10:00:00Z', run_label: 'c', passed: 30, failed: 0, blocked: 0, total: 30 },
];

let bad = 0;
const check = (what, svg, vbW, vbH) => {
  const nan = /NaN|undefined|Infinity/.test(svg);
  if (nan) { bad++; console.log('  NaN/undefined in ' + what); }
  /* every x/y must sit inside the declared viewBox — a label outside it is simply not drawn */
  const m = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
  if (!m) { bad++; console.log('  no viewBox in ' + what); return; }
  const W = +m[1], H = +m[2];
  let worst = 0;
  [...svg.matchAll(/\bx="([\d.-]+)"/g)].forEach((x) => { worst = Math.max(worst, +x[1]); });
  [...svg.matchAll(/\bwidth="([\d.-]+)"/g)].forEach(() => {});
  const ys = [...svg.matchAll(/\by="([\d.-]+)"/g)].map((y) => +y[1]);
  const maxY = ys.length ? Math.max(...ys) : 0;
  const fits = worst <= W && maxY <= H;
  if (!fits) { bad++; }
  console.log('  ' + (fits && !nan ? 'ok    ' : 'BAD   ') + what.padEnd(22)
    + 'viewBox ' + W + '×' + H + '  rightmost x ' + worst.toFixed(0) + '  lowest y ' + maxY.toFixed(0)
    + '  rects ' + (svg.match(/<rect/g) || []).length);
};

console.log('\n  chart smoke test\n');
check('by area', F.chartStack(AREAS, { label: 'x' }));
check('single row', F.chartStack([AREAS[0]], { label: 'x' }));
check('trend', F.chartTrend(TREND));
console.log('  empty rows        → ' + JSON.stringify(F.chartStack([], {}).slice(0, 46)));
console.log('  one sitting       → ' + JSON.stringify(F.chartTrend([TREND[0]]).slice(0, 60)));
console.log('\n  ' + bad + ' problems\n');
process.exitCode = bad ? 1 : 0;
