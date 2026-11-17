/* testing-report.cjs — N07: the Report's section 5 compares the PLAN (the board's case definitions) with what ran.
 *
 * ⭐ A planted board: 3 cases defined, 2 executed (1 passed, 1 failed). The stand-in API computes the §5a rows from
 * those planted cases the way the server does (latest word per case) and the page must print exactly those numbers.
 * ⭐ And: no JUDGEMENT heading (source 'needs a person') carries generated prose — they ask, and nothing more.
 * Run: node e2e/testing-report.cjs  · one headless browser, a static server, no network.
 */
'use strict';
const { chromium } = require('@playwright/test');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', 'public');
const T = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
let bad = 0;
const say = (l, ok, d) => { console.log('  ' + String(l).padEnd(62) + '· ' + d + '  ' + (ok ? 'OK' : (bad++, '✗ FAILED'))); };

const CASES = [
  { case_key: 'ENG-01', name: 'ENG-01', title: 'a', test_type: 'unit', module_key: 'ENG', layer: 'engine' },
  { case_key: 'ENG-02', name: 'ENG-02', title: 'b', test_type: 'unit', module_key: 'ENG', layer: 'engine' },
  { case_key: 'WEB-01', name: 'WEB-01', title: 'c', test_type: 'acceptance', module_key: 'WEB', layer: 'web' },
];
const LATEST = { 'ENG-01': 'pass', 'ENG-02': 'fail' };
const ASKS = 'What was planned that did not happen, and why?';
function plan() {
  const m = {};
  CASES.forEach((c) => {
    const a = m[c.layer] || (m[c.layer] = { layer: c.layer, planned: 0, executed: 0, passed: 0 });
    a.planned++; if (LATEST[c.case_key]) a.executed++; if (LATEST[c.case_key] === 'pass') a.passed++;
  });
  return Object.keys(m).map((k) => m[k]);
}
function report() {
  const levels = plan(), sum = (k) => levels.reduce((t, x) => t + x[k], 0);
  return { standard: 'ISO/IEC/IEEE 29119-3 · Test Completion Report', supersedes: 'IEEE 829', generated_at: '2026-10-08T09:00:00Z',
    scope: 'the whole board', project: null,
    names: { case: 'c', run: 'r', incident: 'i', report: 'x' },
    sections: [
      { id: '2', title: 'Test results', source: 'measured', body: { totals: { total: 3, passed: 1, failed: 1, blocked: 0, skipped: 0, untested: 1, high_untested: 0 },
        tested: 2, coverage_pct: 67, pass_pct: 50, by_feature: [] } },
      { id: '5a', title: 'Comparison against the plan', source: 'measured',
        body: { levels, planned: sum('planned'), executed: sum('executed'), passed: sum('passed'), note: 'Planned = cases defined.' } },
      { id: '5', title: 'Deviations from the test plan', source: 'needs a person', asks: ASKS },
      { id: '6', title: 'Test completion evaluation', source: 'needs a person', asks: 'Were the exit criteria met?', caveats: [] },
    ] };
}

(async () => {
  const web = http.createServer((q, r) => {
    const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '') || 'index.html');
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('no'); }
    r.writeHead(200, { 'content-type': T[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r);
  });
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
  const api = http.createServer((q, r) => {
    const j = (c, o) => { r.writeHead(c, Object.assign({ 'content-type': 'application/json' }, cors)); r.end(JSON.stringify(o)); };
    if (q.method === 'OPTIONS') { r.writeHead(204, cors); return r.end(); }
    if (!/^Bearer tok/.test(q.headers.authorization || '')) return j(401, { message: 'no token' });
    const u = q.url.split('?')[0];
    if (u === '/api/testing/cases') return j(200, { cases: CASES, count: CASES.length });
    if (u === '/api/testing/results') return j(200, { results: [], count: 0 });
    if (u === '/api/testing/stale') return j(200, { stale: [] });
    if (u === '/api/testing/coverage') return j(200, { areas: [], groups: {} });
    if (u === '/api/testing/runs') return j(200, { runs: [], count: 0, project: null, projects: [] });
    if (u === '/api/testing/report') return j(200, report());
    return j(404, { message: 'not here' });
  });
  await new Promise((res) => web.listen(0, '127.0.0.1', res));
  await new Promise((res) => api.listen(0, '127.0.0.1', res));
  const API = 'http://127.0.0.1:' + api.address().port, BASE = 'http://127.0.0.1:' + web.address().port;
  const b = await chromium.launch();
  try {
    const ctx = await b.newContext({ viewport: { width: 1400, height: 900 } });
    await ctx.addInitScript(() => { localStorage.setItem('cb_sess', JSON.stringify({ token: 'tok-1', entity: 'Test shop' })); });
    const p = await ctx.newPage();
    const errs = []; p.on('pageerror', (e) => errs.push(String(e)));
    await p.goto(BASE + '/testing.html?api=' + encodeURIComponent(API));
    await p.waitForSelector('#t_rep', { timeout: 15000 });
    await p.evaluate(() => { setView('report'); });
    await p.waitForSelector('[data-testid="plan-table"]', { timeout: 15000 });

    console.log('\n── ⭐ §5: planned · executed · passed, per level');
    const rows = await p.$$eval('[data-testid="plan-table"] tr', (trs) => trs.slice(1).map((t) => Array.from(t.children).map((c) => c.textContent.trim())));
    const sh = (n) => (n ? String(n) : '—');
    const want = plan().map((x) => [x.layer, sh(x.planned), sh(x.executed), sh(x.passed)]).concat([['All levels', '3', '2', '1']]);
    say('three defined, two executed, one passed, by level', JSON.stringify(rows) === JSON.stringify(want), JSON.stringify(rows));
    say('the totals row is the board\'s 3 · 2 · 1', rows[rows.length - 1].join('|') === 'All levels|3|2|1', rows[rows.length - 1].join('|'));

    console.log('\n── ⭐ a judgement heading is never filled by the app');
    const judged = await p.$$eval('.sec.ask', (els) => els.map((e) => ({ h: e.previousElementSibling.textContent.trim(),
      body: e.textContent.replace(/Needs a person/, '').trim() })));
    const five = judged.filter((x) => /^5Deviations/.test(x.h))[0];
    say('section 5 stays a judgement: it asks, and only asks', !!five && five.body === ASKS, five ? five.body : 'missing');
    say('judgement sections are only their question (no figure sentence)',
      judged.length >= 2 && judged.every((x) => !/\b\d+ of \d+\b|passed|executed/i.test(x.body)), judged.map((x) => x.h).join(' | '));
    say('no page errors', errs.length === 0, errs.join(' ') || 'none');
  } finally { await b.close(); web.close(); api.close(); }
  console.log(bad ? '\n' + bad + ' FAILED' : '\nall OK');
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
