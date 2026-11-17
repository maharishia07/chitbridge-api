/* board-ran.cjs — the test board says how many ran in the LAST run, in its header and in the area table's Ran column.
 *
 * Athi, 2026-10-07: he opened the board and saw 0 results, and nothing said how many tests the latest run touched
 * beside how many cases exist. ⭐ Against a stand-in API (the five reads the page makes on load), two runs: the newer
 * one touched two board cases, the older one a third. Ran must count the newer run only; Done counts both.
 * ⭐ b292 (2026-10-07): the PROJECT. A Project field beside "This sitting", kept on this device and sent with a tap;
 * a Project filter on Summary and Report that reads with ?project= — and the header follows it.
 * Run: node e2e/board-ran.cjs   · one headless browser, a static server, no network.
 */
'use strict';
const { chromium } = require('@playwright/test');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', 'public');
const T = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
let bad = 0;
const say = (l, ok, d) => { console.log('  ' + String(l).padEnd(62) + '· ' + d + '  ' + (ok ? 'OK' : (bad++, '✗ FAILED'))); };

const NEW = '11111111-1111-4111-8111-111111111111', OLD = '22222222-2222-4222-8222-222222222222';
const K = (f) => 'chitbridge-api/tests/' + f;
const CASES = [
  { case_key: K('a.test.cjs'), name: K('a.test.cjs'), title: 'a', test_type: 'unit', module_key: 'chitbridge-api/tests', areas: ['api'] },
  { case_key: K('b.test.cjs'), name: K('b.test.cjs'), title: 'b', test_type: 'unit', module_key: 'chitbridge-api/tests', areas: ['api', 'engine'] },
  { case_key: K('c.test.cjs'), name: K('c.test.cjs'), title: 'c', test_type: 'unit', module_key: 'chitbridge-api/tests', areas: ['engine'] },
  { case_key: 'CTR-01', name: 'CTR-01', title: 'never run', test_type: 'acceptance', module_key: 'CTR', areas: ['web'] },
];
const R = (k, run, status, at) => ({ case_key: k, run_id: run, status, at, layer: 'engine', tester_name: 'guards CI', run_kind: 'unit' });
const RESULTS = [R(K('a.test.cjs'), NEW, 'pass', '2026-10-07T10:05:00Z'), R(K('b.test.cjs'), NEW, 'fail', '2026-10-07T10:05:00Z'),
  R(K('c.test.cjs'), OLD, 'pass', '2026-10-06T09:00:00Z')];
const RUNS = [
  { run_id: NEW, run_label: 'guards abc1234', started: '2026-10-07T10:04:00Z', finished: '2026-10-07T10:05:00Z', testers: 'guards CI', total: '2', passed: '1', failed: '1', blocked: '0', skipped: '0' },
  { run_id: OLD, run_label: 'guards 0000000', started: '2026-10-06T09:00:00Z', finished: '2026-10-06T09:00:00Z', testers: 'guards CI', total: '1', passed: '1', failed: '0', blocked: '0', skipped: '0' },
];

(async () => {
  const web = http.createServer((q, r) => {
    const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '') || 'index.html');
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('no'); }
    r.writeHead(200, { 'content-type': T[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r);
  });
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
  const asked = [], full = [], posted = [];
  /* ⭐ the board has seen two projects; Stage 1's own last run is the OLD one, a single result */
  const PROJECTS = [{ project: 'Stage 2', runs: 1 }, { project: 'Stage 1', runs: 1 }];
  const runsFor = (p) => p === 'Stage 1' ? [Object.assign({}, RUNS[1], { project: 'Stage 1' })]
    : p === 'Stage 2' ? [Object.assign({}, RUNS[0], { project: 'Stage 2' })] : RUNS;
  const api = http.createServer((q, r) => {
    const j = (c, o) => { r.writeHead(c, Object.assign({ 'content-type': 'application/json' }, cors)); r.end(JSON.stringify(o)); };
    if (q.method === 'OPTIONS') { r.writeHead(204, cors); return r.end(); }
    if (!/^Bearer tok/.test(q.headers.authorization || '')) return j(401, { message: 'no token' });
    const u = q.url.split('?')[0]; asked.push(u); full.push(q.url);
    const pj = new URL(q.url, 'http://x').searchParams.get('project');
    if (q.method === 'POST' && u === '/api/testing/results') {
      let t = ''; q.on('data', (c) => { t += c; });
      return q.on('end', () => { const body = JSON.parse(t || '{}'); posted.push(body);
        j(200, { run_id: body.run_id, project: body.project || null, recorded: 1, results: [] }); });
    }
    if (u === '/api/testing/cases') return j(200, { cases: CASES, count: CASES.length });
    if (u === '/api/testing/results') return j(200, { results: RESULTS, count: RESULTS.length });
    if (u === '/api/testing/stale') return j(200, { stale: [] });
    if (u === '/api/testing/coverage') return j(200, { areas: [], groups: {} });
    if (u === '/api/testing/runs') return j(200, { runs: runsFor(pj), count: runsFor(pj).length, project: pj, projects: PROJECTS });
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

    console.log('\n── ⭐ the header: how many ran in the last run, when, who');
    await p.goto(BASE + '/testing.html?api=' + encodeURIComponent(API));
    await p.waitForSelector('[data-testid="ran-last"]', { timeout: 15000 });
    const head = (await p.textContent('[data-testid="ran-last"]')).replace(/\s+/g, ' ').trim();
    say('the last run\'s own count, not every result ever', /^2 ran in the last run · /.test(head), head);
    say('it names who ran it', / · guards CI$/.test(head), head.split(' · ').pop());
    say('the runs were read with the summary, no second fetch', asked.filter((u) => u === '/api/testing/runs').length === 1,
      asked.filter((u) => u === '/api/testing/runs').length + ' reads of /runs');

    console.log('\n── ⭐ the area table: Ran beside Total, the last run only');
    await p.evaluate(() => { setView('summary'); });
    await p.waitForSelector('table.mtx', { timeout: 10000 });
    const m = await p.evaluate(() => {
      const t = document.querySelector('table.mtx');
      const heads = [...t.querySelector('tr').querySelectorAll('th')].map((x) => x.textContent.trim());
      const at = heads.indexOf('Ran'), tot = heads.indexOf('Total');
      const rowOf = (label) => [...t.querySelectorAll(':scope > tbody > tr.arow, :scope > tr.arow')]
        .find((r) => (r.querySelector('.area') || {}).textContent === label);
      const cell = (tr) => tr ? tr.children[at].textContent.trim() : null;
      const foot = t.querySelector('tr.foot');
      const firstRow = t.querySelector('tr.arow');
      const width = (tr) => [...tr.children].reduce((n, c) => n + (parseInt(c.getAttribute('colspan'), 10) || 1), 0);
      return { heads, at, tot, api: cell(rowOf('API')), engine: cell(rowOf('Engine')), web: cell(rowOf('Web')),
        foot: cell(foot), footDone: foot ? foot.children[at + 1].textContent.trim() : null,
        nHead: heads.length, nRow: firstRow ? width(firstRow) : 0, nFoot: foot ? width(foot) : 0,
        tier: (t.querySelector('tr.tier td') || {}).colSpan };
    });
    say('a Ran column, right after Total', m.at > 0 && m.at === m.tot + 1, m.heads.slice(-6).join(' | '));
    say('API row: a and b ran last', m.api === '2', 'API ' + m.api);
    say('Engine row: b ran last, c only in the run before', m.engine === '1', 'Engine ' + m.engine);
    say('Web row: the manual case never ran → 0', m.web === '0', 'Web ' + m.web);
    say('Everything: 2 ran, 3 ever done', m.foot === '2' && m.footDone === '3', 'Ran ' + m.foot + ' · Done ' + m.footDone);
    say('every row is as wide as the header', m.nRow === m.nHead && m.nFoot === m.nHead && m.tier === m.nHead,
      'head ' + m.nHead + ' · row ' + m.nRow + ' · foot ' + m.nFoot + ' · tier ' + m.tier);
    fs.mkdirSync(path.join(__dirname, 'shots'), { recursive: true });
    await p.screenshot({ path: path.join(__dirname, 'shots', 'board-ran.png'), fullPage: false }).catch(() => {});

    console.log('\n── ⭐ b292: the Project field, kept on this device, sent with a tap');
    await p.evaluate(() => { setView('cases'); });
    const fld = await p.evaluate(() => {
      const run = document.getElementById('f_run'), f = document.getElementById('f_proj');
      return { there: !!f, beside: !!(f && run && run.compareDocumentPosition(f) & Node.DOCUMENT_POSITION_FOLLOWING
        && f.parentElement === run.parentElement), label: (document.querySelector('label[for="f_proj"]') || {}).textContent };
    });
    say('a Project field beside "This sitting", labelled', fld.there && fld.beside && fld.label === 'Project', JSON.stringify(fld));
    await p.fill('#f_proj', '  Stage 1 ');
    const kept = await p.evaluate(() => localStorage.getItem('cb_testproject'));
    say('typed → kept on this device, trimmed', kept === 'Stage 1', String(kept));
    await p.evaluate(() => mark(CASES[3].case_key, 'pass'));
    for (let i = 0; i < 20 && !posted.length; i++) await p.waitForTimeout(100);
    say('a tap carries the project', posted.length === 1 && posted[0].project === 'Stage 1', JSON.stringify((posted[0] || {}).project));

    console.log('\n── ⭐ b292: the Project filter — Summary and Report, and the header follows it');
    await p.evaluate(() => { setView('summary'); });
    await p.waitForSelector('[data-testid="project-filter"]', { state: 'visible', timeout: 10000 });
    const opts = await p.$$eval('[data-testid="project-filter"] option', (o) => o.map((x) => x.textContent));
    say('the projects seen, "All" first', opts.join('|') === 'All|Stage 2|Stage 1', opts.join(' | '));
    full.length = 0;
    await p.selectOption('[data-testid="project-filter"]', 'Stage 1');
    await p.waitForFunction(() => /^1 ran in the last run/.test(document.querySelector('[data-testid="ran-last"]').textContent.trim()), null, { timeout: 10000 }).catch(() => {});
    const h1 = (await p.textContent('[data-testid="ran-last"]')).replace(/\s+/g, ' ').trim();
    say('Summary reads with ?project=', full.some((x) => x === '/api/testing/runs?project=Stage%201')
      && full.some((x) => x === '/api/testing/coverage?project=Stage%201'), full.join(' '));
    say('the header is Stage 1\'s last run (1), not the board\'s (2)', /^1 ran in the last run · /.test(h1), h1);
    full.length = 0;
    await p.evaluate(() => { setView('report'); });
    for (let i = 0; i < 30 && !full.some((x) => /\/report/.test(x)); i++) await p.waitForTimeout(100);
    const fv = await p.isVisible('[data-testid="project-filter"]');
    say('Report shows the filter and reads with it', fv && full.indexOf('/api/testing/report?project=Stage%201') >= 0, full.join(' '));
    await p.evaluate(() => { setView('cases'); });
    say('Cases does not show it', !(await p.isVisible('[data-testid="project-filter"]')), 'hidden');
    await p.evaluate(() => { setView('summary'); });
    await p.selectOption('[data-testid="project-filter"]', '');
    await p.waitForFunction(() => /^2 ran in the last run/.test(document.querySelector('[data-testid="ran-last"]').textContent.trim()), null, { timeout: 10000 }).catch(() => {});
    const h2 = (await p.textContent('[data-testid="ran-last"]')).replace(/\s+/g, ' ').trim();
    say('All → the whole board again', /^2 ran in the last run · /.test(h2), h2);

    console.log('\n── an empty board says so');
    await p.evaluate(() => { RUNS = []; repaintCurrent(); });
    const none = (await p.textContent('[data-testid="ran-last"]')).trim();
    say('no run yet → said in words, never a 0 that looks like a result', none === 'No run yet', none);
    say('no page errors', errs.length === 0, errs.length ? errs.join(' | ').slice(0, 120) : 'none');
  } finally {
    await b.close(); web.close(); api.close();
  }
  console.log('\n' + (bad ? '✗ ' + bad + ' FAILED\n' : '✓ all good\n'));
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
