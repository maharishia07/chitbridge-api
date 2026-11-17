/* cmdb-fields.cjs — the CMDB record page draws a record's FIELD LEDGER (View 4): chips by status, find, click for detail.
 *
 * Athi, 2026-10-09: "create the ledger and connect to cmdb". The real ledger is the API's data/cmdb/CAP-FIELDS-PRODUCT-*.json;
 * this spec serves a small FIXED sample (e2e/fixtures/cmdb-fields-sample.json) so it needs no sibling checkout, and checks the
 * page against it: every count is read off the file, none typed here.
 * Run: sh C:/dev/toolset/e2e.sh <checkout> e2e/cmdb-fields.cjs
 */
'use strict';
const { chromium } = require('@playwright/test');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', 'public');
const T = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
let bad = 0;
const say = (l, ok, d) => { console.log('  ' + String(l).padEnd(66) + '· ' + d + '  ' + (ok ? 'OK' : (bad++, '✗ FAILED'))); };

(async () => {
  const REC = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'cmdb-fields-sample.json'), 'utf8'));
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
    if (u === '/api/testing/cmdb/' + REC.ci) return j(200, { ci: REC.ci, version: 1, current_version: 1, record: REC, flags: ['1 fields not used'] });
    if (u === '/api/testing/cmdb/CAP-PLAIN') return j(200, { ci: 'CAP-PLAIN', version: 1, current_version: 1, record: { ci: 'CAP-PLAIN', title: 'Plain', entries: [], process: [], exits: [] }, flags: [] });
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
  const n = (s) => REC.fields.filter((f) => f.status === s || (f.also || []).indexOf(s) >= 0).length;

  console.log('\n── the ledger is drawn, with its counts ──');
  await p.goto(BASE + '/cmdb/record.html?api=' + encodeURIComponent(API) + '#' + REC.ci);
  await p.waitForSelector('#sec4:not([hidden]) #frows tr[data-k]', { timeout: 15000 });
  say('View 4 shows, one row per field', await p.locator('#frows tr[data-k]').count() === REC.fields.length, REC.fields.length + ' rows');
  say('the header counts the fields', /fields in the ledger/.test(await p.textContent('#facts')) && (await p.textContent('#facts')).indexOf(String(REC.fields.length)) >= 0, 'facts');
  const chips = await p.evaluate(() => Array.from(document.querySelectorAll('#fchips .chip')).map((c) => c.textContent));
  say('a chip per status that exists, with its count', chips.some((c) => /not used · /.test(c)) && chips.some((c) => /complete · /.test(c)) && !chips.some((c) => /no meaning/.test(c)) === (n('no-meaning') === 0), chips.join(' | ').slice(0, 110));

  console.log('\n── filter by status, find, and click a field ──');
  await p.click('#fchips [data-f="not-used"]');
  say('"not used" shows only the not-used fields', await p.locator('#frows tr[data-k]').count() === n('not-used'), n('not-used') + ' rows');
  say('the pressed chip says so (aria-pressed)', await p.getAttribute('#fchips [data-f="not-used"]', 'aria-pressed') === 'true', 'aria-pressed');
  await p.click('#fchips [data-f="all"]');
  await p.fill('#fq', 'hsn');
  const found = await p.locator('#frows tr[data-k]').evaluateAll((t) => t.map((x) => x.getAttribute('data-k')));
  say('typing "hsn" keeps only fields whose key or meaning has it', found.length >= 1 && found.every((k) => /hsn/i.test(k) || /hsn/i.test((REC.fields.find((f) => f.key === k) || {}).means || '')), found.join(', '));
  await p.fill('#fq', '');
  const ex = REC.fields.find((f) => f.shown_in.length && f.finding);
  await p.click('#frows tr[data-k="' + ex.key + '"]');
  const d = await p.textContent('#fdd');
  say('clicking a field shows where it is shown, who sets it, its finding', ex.shown_in.every((s) => d.indexOf(s) >= 0) && d.indexOf(ex.set_by) >= 0 && d.indexOf(ex.finding) >= 0, ex.key);
  say('the detail is headed by the field', (await p.textContent('#fdt')) === ex.key, await p.textContent('#fdt'));
  await p.focus('#frows tr[data-k="' + REC.fields[0].key + '"]'); await p.keyboard.press('Enter');
  say('Enter on a focused row selects it (keyboard)', (await p.textContent('#fdt')) === REC.fields[0].key, await p.textContent('#fdt'));
  await p.screenshot({ path: path.join(__dirname, 'shots', 'cmdb-fields.png'), fullPage: true }).catch(() => {});

  console.log('\n── a record without fields shows no ledger ──');
  await p.goto(BASE + '/cmdb/record.html?api=' + encodeURIComponent(API) + '#CAP-PLAIN');
  await p.waitForFunction(() => document.getElementById('title').textContent === 'Plain', null, { timeout: 10000 });
  say('View 4 stays hidden', await p.evaluate(() => document.getElementById('sec4').hidden), 'hidden');
  say('no page errors', errs.length === 0, errs.length ? errs.join(' | ').slice(0, 120) : 'none');

  await b.close(); web.close(); api.close();
  console.log('\n' + (bad ? '✗ ' + bad + ' FAILED\n' : '✓ all good\n'));
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
