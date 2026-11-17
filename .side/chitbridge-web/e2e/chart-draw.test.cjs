/**
 * chart-draw.test.cjs — REP-36: the shared chart helper (public/engine/chart-draw.js, CBDraw), run outside the browser.
 * Geometry and labels of the status bar and the month strip, the accessible words of every new svg, the Trend chart UNCHANGED by the lift, and the
 * palette measured in all 16 themes with ui-standard's own contrastRatio (previous 3:1 on the page and the card; a theme that needs more than the 55%
 * mix, or whose accent falls to ink, is PRINTED, never hidden).
 * Run: node e2e/chart-draw.test.cjs   (exit 1 on any failure)
 */
// UNIT      26/Charts
'use strict';
const fs = require('fs'),
  path = require('path'),
  vm = require('vm'),
  crypto = require('crypto');
const read = (file) => fs.readFileSync(path.join(__dirname, '..', 'public', file), 'utf8');
let failures = 0;
const check = (condition, message) => {
  console.log((condition ? '  ok ' : '  FAIL ') + message);
  if (!condition) failures++;
};

/* the helper, alone (it needs only the page's esc) */
const ctx = { console, esc: (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]) };
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(read('engine/chart-draw.js'), ctx, { filename: 'engine/chart-draw.js' });
vm.runInContext(read('engine/chart-draw-status.js'), ctx, { filename: 'engine/chart-draw-status.js' });
vm.runInContext(read('engine/chart-draw-rows.js'), ctx, { filename: 'engine/chart-draw-rows.js' });
const D = ctx.CBDraw;

console.log('the Trend chart is unchanged by the lift (a fixed fixture, byte-compared by hash)');
{
  const points = [];
  for (let i = 0; i < 12; i++) points.push({ key: 'k' + i, label: 'M' + i, value: i === 5 ? null : 1000 + i * 370, line: i < 3 ? null : 900 + i * 200, hatch: i === 11, title: 't' + i, lineTitle: 'l' + i });
  const svg = D.bars(points, { width: 390, height: 170, id: 'tr', tid: 'tr', aria: 'Sales' }) + '\n' + D.spark([1, 2, null, 5, 3], { aria: 's' });
  const sha = crypto.createHash('sha256').update(svg, 'utf8').digest('hex');
  check(sha === 'e06178b755d41b34aa3563e16fb1e35b2d0f368943c88ef9edafc6b89777f341', 'bars() + spark() on the fixture hash to the pre-REP-36 output ' + sha.slice(0, 12));
  check(/stroke:var\(--muted,#6f6450\)/.test(svg), 'the previous line keeps the Trend page colour when no previous colour is passed');
  check(/stroke:rgb\(1,2,3\)/.test(D.bars(points, { width: 390, previous: 'rgb(1,2,3)', id: 'x' })), 'a caller-measured previous colour reaches the dashed line');
  check(/<title>Sales<\/title><desc>12 months/.test(D.spark([1, 2], { aria: 's', title: 'Sales', desc: '12 months' })), 'a sparkline given title + desc carries both');
}

console.log('status bar: geometry and words');
{
  const parts = [
    { kind: 'good', value: 6, label: '6 in order', short: 'ok' },
    { kind: 'watch', value: 3, label: '3 to watch', short: 'watch' },
    { kind: 'help', value: 1, label: '1 needs help', short: 'help' },
    { kind: 'help', value: 0, label: 'none' }
  ];
  const boxes = D.geometry.status(parts, 320);
  check(boxes.length === 3, 'a part with no count is not drawn');
  check(Math.abs(boxes[0].w / boxes[1].w - 2) < 1e-9 && Math.abs(boxes[1].w / boxes[2].w - 3) < 1e-9, 'widths are in the proportion of the counts');
  check(Math.abs(boxes[2].x + boxes[2].w - 320) < 1e-9, 'the parts and their gaps fill the width exactly');
  check(boxes.every((box, i) => i === 0 || box.x >= boxes[i - 1].x + boxes[i - 1].w), 'no part overlaps the last');
  const svg = D.statusBar(parts, { width: 320, id: 's1', title: 'Clients by status' });
  check(/role="img"/.test(svg) && /aria-labelledby="s1-t s1-d"/.test(svg) && /<title id="s1-t">Clients by status<\/title>/.test(svg), 'role, aria-labelledby and a title');
  check(/<desc id="s1-d">6 in order, 3 to watch, 1 needs help<\/desc>/.test(svg), 'the desc is the text equivalent of every figure');
  check((svg.match(/<title>(6 in order|3 to watch|1 needs help)<\/title>/g) || []).length === 3, 'each part has its own title');
  check(/data-kind="good"/.test(svg) && /url\(#s1-w\)/.test(svg) && /url\(#s1-h\)/.test(svg), 'good solid, watch hatched, help dotted: never colour alone');
  check(/viewBox="0 0 320 34"/.test(svg) && /max-width:320px/.test(svg), 'fits: viewBox 320 wide, max-width, scales down');
  check(D.statusBar([{ kind: 'good', value: 0 }], {}) === '' && D.statusBar([], {}) === '', 'no counts, no invented shape');
  const texts = svg.match(/<text [^>]*>[^<]*<\/text>/g) || [];
  check(texts.length === 3 && ['6 ok', '3 watch', '1 help'].every((words, i) => texts[i].endsWith('>' + words + '</text>')), 'figures printed under the bar, with short words where the part is wide');
  check(texts.every((t) => parseFloat(/x="([\d.]+)"/.exec(t)[1]) + (/>([^<]*)</.exec(t)[1].length * 6.5) / 2 <= 320 + 0.01), 'a label never runs past the right edge');
  check(!/NaN|undefined/.test(svg), 'no NaN or undefined');
}

console.log('month strip: geometry and words');
{
  const names = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ');
  const months = names.map((label, i) => ({ label, state: i < 9 ? 'locked' : i < 11 ? 'open' : 'running' }));
  const cells = D.geometry.strip(months, 18, 4);
  check(cells.length === 12 && cells[11].x + cells[11].size === 12 * 18 + 11 * 4, '12 squares, 260 wide');
  check(260 <= 390 - 32, 'fits a 390 phone with a 16 px gutter');
  const svg = D.monthStrip(months, { id: 'm1', title: 'Months locked' });
  check((svg.match(/data-state="locked"/g) || []).length === 9 && (svg.match(/data-state="open"/g) || []).length === 2 && (svg.match(/data-state="running"/g) || []).length === 1, 'nine locked, two open, one running');
  check(/<desc id="m1-d">Jan: locked, Feb: locked/.test(svg) && /Dec: running<\/desc>/.test(svg), 'the desc names every month and its state');
  check(/<title>Nov: open<\/title>/.test(svg) && /<title>Dec: running<\/title>/.test(svg), 'each square has a title for a screen reader');
  check(/<title>Dec: en cours<\/title>/.test(D.monthStrip(months, { id: 'm2', words: { locked: 'verrouillé', open: 'ouvert', running: 'en cours' } })), 'the words are the caller\'s (translated)');
  check(/<circle/.test(svg) && (svg.match(/<circle/g) || []).length === 1, 'running has its own shape (a dot), not colour alone');
  check(D.monthStrip([], {}) === '' && !/NaN|undefined/.test(svg), 'no months, no shape; no NaN');
}

console.log('palette: measured in all 16 themes with ui-standard contrastRatio');
{
  const ui = { console, window: {}, document: { addEventListener() {} }, esc: (s) => String(s), tx: (s) => s, txf: (s) => s, fmtMoney: String, toast() {}, CBAction: { run() {} }, CBStr: 0 };
  ui.CBSTR = { en: {}, ta: {}, hi: {}, ar: {}, fr: {} };
  ui.window = ui;
  vm.createContext(ui);
  ['app/ui.js', 'app/strings-ta.js', 'app/strings-hi.js', 'app/strings-ar.js', 'app/strings-fr.js', 'app/strings-ui-standard.js', 'app/ui-standard.js'].forEach((file) => vm.runInContext(read(file), ui, { filename: file }));
  const contrast = vm.runInContext('CBUiStandard', ui).contrastRatio;
  vm.runInContext(read('engine/screen.js'), ctx, { filename: 'engine/screen.js' });
  const themes = ctx.CBScreen.APP_THEMES,
    keys = Object.keys(themes);
  check(keys.length === 16, '16 themes: ' + keys.length);
  /* Cream is the page's own :root; a chosen theme re-points the names (finance.html :root[data-themed]): page = --paper, accent text = --blue-d */
  const CREAM = { page: '#FCFAF5', card: '#fffdf8', ink: '#2a2418', accent: '#1f5f5b', blueD: '#174A87' };
  const rows = keys.map((key) => {
    const v = key === 'cream' ? {} : themes[key].vars;
    const vars = key === 'cream' ? { ink: CREAM.ink, page: CREAM.page, card: CREAM.card, accent: CREAM.accent } : { ink: v['--ink'] || CREAM.ink, page: v['--paper'] || CREAM.page, card: v['--card'] || CREAM.card, accent: v['--blue-d'] || CREAM.blueD };
    const p = D.palette(vars, contrast),
      at = (colour, ground) => contrast(colour, ground);
    const worst = (colour) => Math.min(at(colour, vars.page), at(colour, vars.card));
    const old45 = worst(D.mix(vars.ink, vars.page, 45));
    return { key, p, vars, actual: worst(vars.ink), previous: worst(p.previous), old45, accent: worst(p.accent), good: worst(p.good), watch: worst(p.watch), bad: worst(p.bad) };
  });
  console.log('  theme       actual prev(mix%) 45%-mix accent  good  watch bad   fellBack');
  rows.forEach((r) => console.log('  ' + r.key.padEnd(11) + ' ' + r.actual.toFixed(1).padStart(5) + ' ' + r.previous.toFixed(1).padStart(5) + '(' + r.p.previousMix + ') ' + r.old45.toFixed(1).padStart(6) + ' ' + r.accent.toFixed(1).padStart(6) + ' ' + r.good.toFixed(1).padStart(5) + ' ' + r.watch.toFixed(1).padStart(5) + ' ' + r.bad.toFixed(1).padStart(4) + '  ' + (r.p.fellBack.join(',') || '-')));
  check(rows.every((r) => r.actual >= 4.5), 'actual (ink) >= 4.5:1 on the page and the card in all 16');
  check(rows.every((r) => r.previous >= 3), 'previous >= 3:1 on the page and the card in all 16 (after the mix is raised where needed)');
  check(rows.every((r) => r.accent >= 3), 'the accent mark >= 3:1 in all 16 (a failing accent falls back to ink)');
  check(rows.every((r) => r.good >= 3 && r.watch >= 3 && r.bad >= 3), 'good, watch, bad >= 3:1 in all 16');
  const raised = rows.filter((r) => r.p.previousMix > 55).map((r) => r.key + '@' + r.p.previousMix);
  console.log('  previous mix raised above 55%: ' + (raised.join(' ') || 'none') + ' · a 45% mix would fail on ' + rows.filter((r) => r.old45 < 3).length + ' of 16');
  console.log('  accent fell back to ink: ' + (rows.filter((r) => r.p.fellBack.indexOf('accent') >= 0).map((r) => r.key).join(' ') || 'none'));
  check(rows.filter((r) => r.old45 < 3).length > 0, 'the check can fail: a 45% mix does fail somewhere (so 3:1 is really being measured)');
}

console.log('compare (REP-66b): the nine hand-computed rows, geometry from the carried change only');
{
  const rows = [
    { label: 'A', now: 12000000, before: 15000000, changePct: -20, state: 'ok', title: 'A' },
    { label: 'B', now: 5500000, before: 5000000, changePct: 10, state: 'ok' },
    { label: 'C', now: 3333300, before: 3000000, changePct: 11.1, state: 'ok' },
    { label: 'D', now: 4200000, before: 0, changePct: null, state: 'no_last_year', words: 'no last year yet' },
    { label: 'E', now: 100000, before: 10000, changePct: 900, state: 'ok' },
    { label: 'F', now: 2998500, before: 3000000, changePct: 0, state: 'ok' },
    { label: 'G', now: 6000000, before: 9000000, changePct: -33.3, state: 'stale', title: 'books in to 30 Sep' },
    { label: 'H', now: 8000000, before: 2000000, changePct: null, state: 'short_last_year', words: 'no full last year' },
    { label: 'I', now: null, before: null, changePct: null, state: 'mixed', words: 'two currencies' }
  ];
  const svg = D.compare(rows, { id: 'cm', tid: 'cm', title: 'Sales', desc: 'd', width: 320 });
  const w = (kind, i) => { const m = new RegExp('<rect x="[\0-9.]+" y="[\0-9.]+" width="([\0-9.]+)"[^>]*data-testid="cm-' + kind + '-' + i + '"').exec(svg); return m && m[1] !== undefined ? Number(m[1]) : null; };
  const txt = (i) => { const m = new RegExp('data-testid="cm-change-' + i + '"[^>]*>(.*?)</text>').exec(svg); return m ? m[1].replace(/<[^>]+>/g, '').trim() : null; };
  check(w('before', 0) === 83 && w('now', 0) === 66.4, 'A: last year at half the room 83, this year 0.8 of it = 66.4 (' + w('now', 0) + ')');
  check(txt(0) === '▼ −20.0%' && txt(1) === '▲ +10.0%' && txt(2) === '▲ +11.1%', 'A, B, C print the carried figure with a sign and a glyph: ' + [0, 1, 2].map(txt).join(' | '));
  check(w('now', 4) === 166 && /stroke:var\(--card,#fffdf8\);stroke-width:1.5/.test(svg) && txt(4) === '▲ +900.0%', 'E: +900.0% printed true, the bar capped at the full 166 with a broken end');
  check(txt(5) === '0.0%' && w('now', 5) === 83, 'F: zero prints 0.0%, no sign, no glyph, the two bars equal');
  check(w('now', 3) === null && txt(3) === 'no last year yet' && /data-state="no_last_year"/.test(svg) && /stroke-dasharray/.test(svg), 'D: no bar, a dashed empty line and the words, never 0%');
  check(/fill:url\(#cm-hatch\)/.test(svg) && /<title>books in to 30 Sep<\/title>/.test(svg) && txt(6) === '▼ −33.3%', 'G: stale is hatched, the true figure printed, the words in the title');
  check(w('now', 7) === null && w('now', 8) === null && txt(8) === 'two currencies', 'H and I: no bars, only their words');
  check(/role="img"/.test(svg) && /<title id="cm-t">Sales<\/title><desc id="cm-d">d<\/desc>/.test(svg) && /--rp-actual:/.test(svg), 'accessible head and the palette custom properties');
  check(D.compare([], {}) === '' && D.changeText(-0) === '0.0%' && D.changeText(null) === '', 'no rows is nothing; minus zero is 0.0%');
  const money = D.compare([{ label: 'Sales', now: 120, before: 150, changePct: -20, state: 'ok' }], { id: 'mm', tid: 'mm', mode: 'money', width: 320 });
  check(/data-testid="mm-before-0"/.test(money), 'money mode draws the pair on one scale (largest figure = the room)');
  /* E17: the caller's codes (opts.codes) land on the picture's chart, parts and legend; with none passed, nothing is written and the output is unchanged */
  const codes = { chart: 'T-P01', part: 'T-P02', legend: 'T-P03' }, count = (svg, c) => svg.split('data-cbsid="' + c + '"').length - 1;
  const sb = D.statusBar([{ kind: 'good', value: 3, label: 'a: 3' }, { kind: 'watch', value: 2, label: 'b: 2' }], { id: 'sb', tid: 'sb', codes });
  check(count(sb, 'T-P01') === 1 && count(sb, 'T-P02') === 2 && count(sb, 'T-P03') === 2, 'statusBar: one chart code, a part code per part, a legend code per figure');
  const ms = D.monthStrip([{ label: 'Jan', state: 'locked' }, { label: 'Feb', state: 'open' }], { id: 'ms', tid: 'ms', labels: true, codes });
  check(count(ms, 'T-P01') === 1 && count(ms, 'T-P02') === 2 && count(ms, 'T-P03') === 2, 'monthStrip: chart, a part per month, a legend per month label');
  const cm = D.compare([{ label: 'A', now: 8, before: 10, changePct: -20, state: 'ok' }], { id: 'cc', tid: 'cc', codes });
  check(count(cm, 'T-P01') === 1 && count(cm, 'T-P02') === 1 && count(cm, 'T-P03') === 2, 'compare: chart, a part per row, a legend for the label and for the change');
  check(!/data-cbsid/.test(D.statusBar([{ kind: 'good', value: 3 }], { id: 'n', tid: 'n' })) && !/data-cbsid/.test(D.compare([{ label: 'A', now: 8, before: 10, changePct: -20 }], { id: 'n', tid: 'n' })), 'no codes passed: no data-cbsid');
}

console.log(failures ? failures + ' FAILED' : 'all ok');
process.exit(failures ? 1 : 0);
