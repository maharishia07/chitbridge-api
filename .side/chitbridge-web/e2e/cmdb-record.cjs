/* cmdb-record.cjs — the ONE record page draws a stored CMDB record in the three views, and says so when it cannot.
 *
 * Athi, 2026-09-28: "can it be linked in the cmdb database as part of this capability, so anyone can look at this?"
 * ⭐ Against a stand-in API that answers with the record the real API SHIPS (chitbridge-api/data/cmdb/*.json), so
 * what is drawn is the real record, and every count below is read off that file rather than typed here.
 * Run: node e2e/cmdb-record.cjs
 */
'use strict';
const { chromium } = require('@playwright/test');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', 'public');
const SEED = path.join(__dirname, '..', '..', 'chitbridge-api', 'data', 'cmdb');
const T = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
let bad = 0;
const say = (l, ok, d) => { console.log('  ' + String(l).padEnd(62) + '· ' + d + '  ' + (ok ? 'OK' : (bad++, '✗ FAILED'))); };

(async () => {
  const REC = JSON.parse(fs.readFileSync(path.join(SEED, 'CAP-SIGNIN.json'), 'utf8'));
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
    if (u === '/api/testing/cmdb') return j(200, { records: [{ ci: REC.ci, title: REC.title, version: 1, flags: [] }] });
    if (u === '/api/testing/cmdb/CAP-SIGNIN') return j(200, { ci: 'CAP-SIGNIN', version: 1, current_version: 1, saved_at: '2026-09-28T20:00:00Z', record: REC, flags: [] });
    /* any other record the API ships (the GENERATED ones) is served as it is on disk */
    const ci = u.split('/').pop(), f2 = path.join(SEED, ci + '.json');
    if (u.indexOf('/api/testing/cmdb/') === 0 && /^CAP-[A-Z0-9-]+$/.test(ci) && fs.existsSync(f2)) {
      const rec = JSON.parse(fs.readFileSync(f2, 'utf8'));
      return j(200, { ci, version: 1, current_version: 1, record: rec, flags: [] });
    }
    if (u.indexOf('/api/testing/cmdb/') === 0) return j(404, { error: 'No such record', message: 'Nothing in the CMDB is called ' + u.split('/').pop() + '.' });
    return j(404, { message: 'not here' });
  });
  await new Promise((res) => web.listen(0, '127.0.0.1', res));
  await new Promise((res) => api.listen(0, '127.0.0.1', res));
  const API = 'http://127.0.0.1:' + api.address().port, BASE = 'http://127.0.0.1:' + web.address().port;
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(() => { localStorage.setItem('cb_sess', JSON.stringify({ token: 'tok-1' })); });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(String(e)));

  console.log('\n── ⭐ A RECORD, DRAWN FROM THE CLOUD — the three views ' + '─'.repeat(0));
  await p.goto(BASE + '/cmdb/record.html?api=' + encodeURIComponent(API) + '#CAP-SIGNIN');
  await p.waitForFunction(() => document.getElementById('title').textContent === 'Counter sign-in', null, { timeout: 15000 });
  const got = await p.evaluate(() => ({
    tiles: document.querySelectorAll('#capmap .cap').length,
    e: document.querySelectorAll('.node.e').length, pr: document.querySelectorAll('.node.p').length, x: document.querySelectorAll('.node.x').length,
    wires: document.querySelectorAll('#wires path').length,
    rels: document.querySelectorAll('#rels tr').length, tests: document.querySelectorAll('#tests tr').length,
    changes: document.querySelectorAll('#changes tr').length, layers: document.querySelectorAll('#layers .layer').length,
    ci: document.getElementById('tags').textContent, flag: !document.getElementById('flagline').hidden,
  }));
  say('the header names the CI', /CAP-SIGNIN/.test(got.ci), got.ci.slice(0, 60));
  say('view 1: one tile per map entry', got.tiles === REC.map.length, got.tiles + ' of ' + REC.map.length);
  say('view 2: every entry, process and exit node', got.e === REC.entries.length && got.pr === REC.process.length && got.x === REC.exits.length,
    got.e + '/' + got.pr + '/' + got.x);
  say('view 2: one line per edge', got.wires === REC.edges.length, got.wires + ' of ' + REC.edges.length);
  say('view 3: relationships, layers, tests, changes', got.rels === REC.relationships.length && got.layers === 4
    && got.tests === REC.tests.length && got.changes === REC.changes.length, [got.rels, got.layers, got.tests, got.changes].join('/'));
  say('no flags raised on a record with a way in, a way out and tests', got.flag === false, 'flagline hidden');

  await p.click('#n-p4');
  const hot = await p.evaluate(() => ({ dim: document.getElementById('mapgrid').classList.contains('dim'),
    hotNodes: document.querySelectorAll('.node.hot').length, title: document.getElementById('dt').textContent }));
  say('selecting a box follows its lines through the map', hot.dim && hot.hotNodes > 2 && /Shop gate/.test(hot.title), hot.hotNodes + ' lit · ' + hot.title);
  await p.screenshot({ path: path.join(__dirname, 'shots', 'cmdb-record.png'), fullPage: true }).catch(() => {});

  console.log('\n── ⭐ A GENERATED record — derived from the code, and its map moves between capabilities ' + '─'.repeat(0));
  const GEN = fs.readdirSync(SEED).map((n) => JSON.parse(fs.readFileSync(path.join(SEED, n), 'utf8'))).find((r) => r.source === 'generated');
  if (!GEN) say('the API ships at least one GENERATED record', false, 'none in data/cmdb');
  else {
    await p.goto(BASE + '/cmdb/record.html?api=' + encodeURIComponent(API) + '#' + GEN.ci);
    await p.waitForFunction((t) => document.getElementById('title').textContent === t, GEN.title, { timeout: 15000 });
    const g = await p.evaluate(() => ({ links: Array.from(document.querySelectorAll('#capmap a.cap')).map((a) => a.getAttribute('href')),
      nodes: document.querySelectorAll('.node').length, tag: document.getElementById('tags').textContent }));
    say('it says it was generated from the code', /generated from the code/.test(g.tag), g.tag.slice(0, 70));
    say('every other capability on its map is a link to that record', g.links.length === GEN.map.length - 1 && g.links.every((h) => /^#CAP-/.test(h)),
      g.links.length + ' links of ' + (GEN.map.length - 1));
    say('its entry, process and exit boxes are all drawn', g.nodes === GEN.entries.length + GEN.process.length + GEN.exits.length, g.nodes + ' boxes');
  }

  console.log('\n── the list, and the refusals ' + '─'.repeat(0));
  await p.goto(BASE + '/cmdb/record.html?api=' + encodeURIComponent(API));
  await p.waitForSelector('#list a.cap', { timeout: 10000 });
  say('no id → every record, each a link to its own page', await p.evaluate(() => document.querySelector('#list a.cap').getAttribute('href') === '#CAP-SIGNIN'), 'links #CAP-SIGNIN');
  await p.goto(BASE + '/cmdb/record.html?api=' + encodeURIComponent(API) + '#CAP-NOPE');
  await p.waitForSelector('#err:not([hidden])', { timeout: 10000 });
  say('an id nobody stored says so, in words', /Nothing in the CMDB is called CAP-NOPE/.test(await p.textContent('#err')), (await p.textContent('#err')).slice(0, 60));
  say('no page errors', errs.length === 0, errs.length ? errs.join(' | ').slice(0, 120) : 'none');

  await b.close(); web.close(); api.close();
  console.log('\n' + (bad ? '✗ ' + bad + ' FAILED\n' : '✓ all good\n'));
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
