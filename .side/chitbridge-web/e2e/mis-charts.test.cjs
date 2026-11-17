/**
 * mis-charts.test.cjs — MISCH: the MIS pictures' adapters (public/app/mis-charts.js) and the two new CBDraw kinds (hbars, cashLine), run outside the browser.
 * The adapters only rename and word what the server carried: a null stays null (never 0), the lowest cash day is found by the SERVER's date, the bp → % is a unit change only.
 * Run: node e2e/mis-charts.test.cjs   (exit 1 on any failure)
 */
'use strict';
const fs = require('fs'),
  path = require('path'),
  vm = require('vm');
const read = (file) => fs.readFileSync(path.join(__dirname, '..', 'public', file), 'utf8');
let failures = 0;
const check = (condition, message) => {
  console.log((condition ? '  ok ' : '  FAIL ') + message);
  if (!condition) failures++;
};
const ctx = { console, esc: (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]) };
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(read('engine/chart-draw.js'), ctx);
vm.runInContext(read('engine/chart-draw-status.js'), ctx);
vm.runInContext(read('engine/chart-draw-rows.js'), ctx);
vm.runInContext(read('app/mis-charts.js'), ctx);
const D = ctx.CBDraw,
  MC = ctx.MC;
const deps = { tx: (s) => s, money: (m, c) => c + ' ' + (m / 100).toFixed(2), date: (t) => new Date(t).toISOString().slice(0, 7), cur: 'AUD' };

console.log('sales points');
{
  const slots = [
    { key: '2026-09', gross_minor: 1000, last_year: { gross_minor: 800 }, coverage: {} },
    { key: '2026-10', gross_minor: null, last_year: { gross_minor: null }, coverage: {} },
    { key: '2026-11', gross_minor: 500, last_year: { gross_minor: 700 }, coverage: { partial: true } }
  ];
  const p = MC.salesPoints(slots, 'month', deps);
  check(p.length === 3 && p[0].value === 1000 && p[0].line === 800, 'value and line are the carried figures');
  check(p[1].value === null && /missing/.test(p[1].title), 'a slot with no record stays null and says missing');
  check(p[2].hatch === true && p[0].hatch === false, 'a running period is hatched');
  check(MC.keyWords('2026-W05', 'week', deps).label === 'W05', 'a week key is words');
  check(MC.salesTable(slots, 'month', deps).rows[0][0].indexOf('2026') === 0 && MC.salesTable(slots, 'month', deps).rows.length === 3, 'the table has every slot, newest first');
}

console.log('dues by age');
{
  const a = { aged_totals: { customer: { not_due: 500, d0_30: 300, d31_60: 0, d61_90: 0, d90_plus: 100 }, supplier: null } };
  const c = MC.duesRows(a, 'customer', deps);
  check(c.rows.length === 5 && c.rows[0].value === 500 && c.rows[0].hatch === false && c.rows[1].hatch === true, 'five ages, not-due first, late ones marked');
  check(MC.duesRows(a, 'supplier', deps).rows.length === 0, 'a side the server did not send draws nothing, not zeros');
  const svg = D.hbars(c.rows, { width: 320, id: 'h', tid: 'h' });
  check((svg.match(/data-testid="h-bar-/g) || []).length === 5 && /<title id="h-t">/.test(svg), 'hbars draws a bar per row with an accessible head');
  check(D.hbars([], {}) === '', 'no rows, no svg');
  const bar = (i) => Number(new RegExp('width="([\\d.]+)" height="[\\d.]+" rx="2" data-testid="h-bar-' + i).exec(svg)[1]);
  check(bar(0) > bar(1) && bar(1) > bar(4) && bar(3) <= 2, 'bar widths follow the figures (500 > 300 > 100)');
}

console.log('income and expense lines');
{
  const pl = { by_line: { income: [{ label: 'Sales', amount_minor: 2000, prior_minor: 1000, change_bp: 10000 }], expense: [{ label: 'Rent', amount_minor: 300, prior_minor: 300, change_bp: 0 }] } };
  const r = MC.plRows(pl, deps);
  check(r.rows.length === 2 && r.rows[0].changePct === 100 && r.rows[1].changePct === 0, 'bp becomes % by unit only (10000 bp = 100%)');
  const svg = D.compare(r.rows, { width: 320, mode: 'money', id: 'p', tid: 'p', title: 't' });
  check(/p-now-0/.test(svg) && /p-before-1/.test(svg), 'compare in money mode draws both bars');
}

console.log('cash 30 days');
{
  const series = [0, 1, 2, 3].map((i) => ({ date: '2026-11-0' + (i + 1), balance_minor: [1000, 400, -200, 300][i] }));
  const c = MC.cashPoints({ series, lowest: { date: '2026-11-03', balance_minor: -200 } }, deps);
  check(c.lowestAt === 2 && c.lowestWords === 'AUD -2.00' && c.startWords === 'AUD 10.00' && c.endWords === 'AUD 3.00', 'the lowest day is the server\'s date, found by key');
  const svg = D.cashLine(c.points, { width: 400, id: 'c', tid: 'c', title: 't', startWords: c.startWords, endWords: c.endWords, lowestAt: c.lowestAt, lowestWords: c.lowestWords });
  check(/c-lowest"/.test(svg) && /c-start"/.test(svg) && /c-end"/.test(svg) && /stroke-dasharray:4 3/.test(svg), 'start, end and lowest dots; the zero line is dashed when the balance crosses it');
  check(D.cashLine([{ value: 1 }], {}) === '', 'one point is no line');
  const none = MC.cashPoints({ series: [], lowest: null }, deps);
  check(none.points.length === 0 && D.cashLine(none.points) === '', 'no series, no picture');
  const gap = D.cashLine([{ value: 1 }, { value: null }, { value: 2 }, { value: 3 }], { id: 'g', tid: 'g' });
  check((/ d="([^"]*)"/.exec(gap)[1].match(/M/g) || []).length === 2, 'the line breaks at a day with no figure');
}
console.log('overview adapters (months · profit · weekdays)');
{
  const bars = [
    { from: '2026-09-01', to: '2026-09-30', running: false, sold_minor: 1000, last_year_minor: 800 },
    { from: '2026-10-01', to: '2026-10-28', running: true, sold_minor: null, last_year_minor: null }
  ];
  const m = MC.monthPoints(bars, deps);
  check(m[0].value === 1000 && m[0].line === 800 && !m[0].hatch && m[1].value === null && m[1].line === null && m[1].hatch, 'month bars: value and last-year line as the server sent them, the running month hatched, a missing month null (never 0)');
  const t = MC.monthTable(bars, 'sold_minor', deps, true);
  check(t.rows.length === 2 && t.rows[1][1] === '—' && t.rows[0][2] === 'AUD 8.00', 'month table: oldest first as the bars are, a missing figure is a dash');
  const p = MC.profitPoints([{ from: '2026-09-01', running: false, profit_minor: -300 }], deps);
  check(p[0].value === -300 && p[0].line === null, 'profit keeps its sign and has no last-year line');
  const days = [{ iso: 1, day: '2026-10-26', sold_minor: 500, last_year_day: '2025-10-27', last_year_minor: 400 }, { iso: 2, day: '2026-10-27', sold_minor: null, last_year_day: '2025-10-28', last_year_minor: null }];
  const w = MC.weekdayPoints(days, Object.assign({}, deps, { date: (t, o) => new Date(t).toISOString().slice(0, 10) + ':' + o.weekday }));
  check(w[0].value === 500 && w[0].line === 400 && w[0].label === '2026-10-26:short' && w[1].value === null && w[1].line === null, 'weekday bars: this week solid, same weekday last year the line, a day with no figure null');
  check(MC.weekdayTable(days, deps).rows.length === 2 && D.bars(w, { id: 'w', tid: 'w' }).indexOf('w-bar-2026-10-26') > 0, 'weekday table has one row a day and the bars draw');
}
console.log(failures ? failures + ' FAILED' : 'ALL PASS');
process.exit(failures ? 1 : 0);
