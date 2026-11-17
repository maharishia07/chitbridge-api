/* boot-ledger-on.cjs — THE FIRST SCREEN ASKS /me, NOT /books/health (l16 polish1). GET /api/books/health answers 404 LEDGER_OFF by design for a shop with no ledger,
 * so app.html's once-per-session check and crm.html's boot read each put a red failed request in the console. /me now carries `ledger_on`.
 * Pattern: bank-home.cjs (Playwright, a stand-in API answering inside the page, a free port; nothing leaves the machine). Runs on a SIT box, never on the laptop.
 * For each page (app · crm · accounts · network) and each shop (the Coastal firm: ledger on · a shop with none): no failed request, no console error, no page error;
 * (an api that says it) the shop with no ledger is NEVER asked GET /books/health, draws the off card on accounts and no Dues column on crm.
 * OUT=<dir> says where the shots go. */
'use strict';
const { chromium } = require('@playwright/test');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..'), PUB = path.join(ROOT, 'public'), SHOTS = process.env.OUT || path.join(__dirname, 'shots');
const T = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok  ' + m); } else { fail++; console.log('  XX  ' + m); } };
const books = require('./lib/books-api.cjs');
const C = require('./lib/contract.cjs');
const crmApi = require('./lib/crm-api.cjs');
const example = (key) => JSON.parse(JSON.stringify(C.load().routes.filter((e) => e.key === key)[0].example));   /* the contract's own example, edited (as walk-books-door does) */   /* every stand-in answer for a contract route is held to the API's shape (M43) */
const json = (r, status, o) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(o) });
const tok = (c) => { const e = (o) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_'); return e({ alg: 'none' }) + '.' + e(c) + '.x'; };
const OWNER = { token: tok({ identity_id: 'ent-M', identity_type: 'entity' }), role: 'entity', name: 'Coastal', entity: 'Coastal Supplies' };
(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const srv = http.createServer((q, r) => {
    const rel = decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '');
    const f = (!rel || rel === 'index.html') ? path.join(ROOT, 'index.html') : path.join(PUB, rel);
    if (((!f.startsWith(PUB)) && f !== path.join(ROOT, 'index.html')) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('no'); }
    r.writeHead(200, { 'content-type': T[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(r);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  const b = await chromium.launch();
  /* mode: true / false = an api that says ledger_on; 'old' / 'old-off' = an api older than the field (no ledger_on in /me): the page must ask GET /books/health the old way, never call every shop "off" */
  for (const mode of [true, false, 'old', 'old-off']) {
    const old = typeof mode === 'string', on = old ? mode === 'old' : mode;
    for (const page of ['app.html', 'crm.html', 'accounts.html', 'network.html']) {
      const label = page + ' · ' + (old ? 'old api, ' : '') + (on ? 'ledger on' : 'no ledger');
      const ctx = await b.newContext({ viewport: { width: 1366, height: 768 }, locale: 'en-AU', timezoneId: 'Australia/Sydney', serviceWorkers: 'block' });
      await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
      const seen = [], bad = [], errs = [];
      await ctx.route('**/api/**', (r0) => { const r = C.wrap(r0);
        const p = new URL(r.request().url()).pathname;
        seen.push(p);
        if (p === '/api/entities/me') return json(r, 200, { entity: { display_name: 'Coastal Supplies', currency_code: 'AUD', country: 'AU', capabilities: [], ...(old ? {} : { ledger_on: on }) } });
        if (p === '/api/books/health') return on ? json(r, 200, books.health()) : json(r, 404, { code: 'LEDGER_OFF', message: 'This shop has not switched the ledger on.' });
        if (p === '/api/books/todo') return json(r, 200, []);
        if (p === '/api/crm/parties') return json(r, 200, crmApi.listPage([]));
        if (p === '/api/crm/followups') return json(r, 200, crmApi.followups([]));
        if (p === '/api/network-offers') { const ex = example('GET /api/network-offers'); ex.store = Object.assign({}, ex.store, { networks: [] }); return json(r, 200, ex); }
        return json(r, 200, {});
      });
      await ctx.addInitScript((s) => { try { localStorage.setItem('cb_sess', JSON.stringify(s)); } catch (_) {} }, OWNER);
      const p = await ctx.newPage();
      p.on('response', (rs) => { if (rs.status() >= 400 && /\/api\//.test(rs.url())) bad.push(rs.status() + ' ' + new URL(rs.url()).pathname); });
      p.on('console', (m) => { if (m.type() === 'error' && (m.location().url || '').indexOf('127.0.0.1') >= 0) errs.push(m.text().slice(0, 140)); }); /* the stand-in aborts every address outside the machine: only this page's own errors count */
      p.on('pageerror', (e) => errs.push('pageerror ' + e.message.slice(0, 140)));
      await p.goto(base + '/' + page);
      await p.waitForTimeout(2500);
      ok(bad.length === 0 || (old && !on), label + ': no failed request' + (bad.length ? ' (' + bad.join(', ') + ')' : ''));
      ok(errs.length === 0, label + ': a clean console' + (errs.length ? ' (' + errs[0] + ')' : ''));
      if (!on && !old) ok(seen.indexOf('/api/books/health') < 0, label + ': never asks GET /books/health');
      if (page === 'accounts.html') ok((await p.locator('[data-testid="acc-off"]').count()) === (on ? 0 : 1), label + ': ' + (on ? 'the page opens' : 'the off card is shown'));
      if (page === 'crm.html' && !on) ok(!(await p.evaluate(() => (typeof CRM !== 'undefined' ? CRM.ledger : null))), label + ': no Dues column');
      await p.screenshot({ path: path.join(SHOTS, 'boot-' + page.replace('.html', '') + (on ? '-on' : '-off') + '.png') });
      await ctx.close();
    }
  }
  ok(...C.finish());
  await b.close(); srv.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
