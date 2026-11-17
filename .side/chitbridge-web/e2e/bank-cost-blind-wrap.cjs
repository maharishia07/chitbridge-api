/* bank-cost-blind-wrap.cjs — l16 integ2b-wrap (16 Nov 2026, Fable r2 item 4): the cost-blind sentence wraps and reads IN FULL at 390 (and 1366) on the Statements line
 * and the log line; nothing scrolls sideways; the Statements box's bottom edge (the head) is measured and kept under the budget.
 * OWNS the proof of .bks-sum (accounts.html) wrapping. CALLED BY a SIT box by hand: sh C:/dev/toolset/sit-box-run.sh sit-grund e2e <ref> e2e/bank-cost-blind-wrap.cjs
 * Shots: e2e/shots/costblind-wrap-{phone,laptop}.png */
'use strict';
const { chromium } = require('@playwright/test');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..'), PUB = path.join(ROOT, 'public'), SHOTS = path.join(__dirname, 'shots');
const T = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const books = require('./lib/books-api.cjs');
const SAY = 'Your access does not include costs, so the bank statements are hidden.';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok  ' + m); } else { fail++; console.log('  XX  ' + m); } };
const C = require('./lib/contract.cjs');   /* every answer the stand-in serves for a route in the api contract is checked (e2e/contract.cjs holds this) */
const json = (r, status, o) => C.json(r, status, o);
const tok = (c) => { const e = (o) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_'); return e({ alg: 'none' }) + '.' + e(Object.assign({ exp: Math.floor(Date.now() / 1000) + 86400 }, c)); };
const OWNER = { token: tok({ identity_id: 'ent-M', identity_type: 'entity' }), role: 'entity', name: 'Mayur Bhavan', entity: 'Mayur Bhavan' };
const BLIND = { code: 'COST_BLIND', error: 'Forbidden', message: 'Forbidden' };
const ACCOUNTS = [{ code: 'G-BANK', name: 'Bank accounts', is_group: true, role: null, parent_code: null }, { code: '1500', name: 'Bank', is_group: false, role: 'bank', parent_code: 'G-BANK', active: true }];
(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const srv = http.createServer((q, r) => {
    const rel = decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '');
    const f = (!rel || rel === 'index.html') ? path.join(ROOT, 'index.html') : path.join(PUB, rel);
    if (((!f.startsWith(PUB)) && f !== path.join(ROOT, 'index.html')) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('no'); }
    r.writeHead(200, { 'content-type': T[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + srv.address().port, b = await chromium.launch(), threw = [];
  for (const [tag, w, h] of [['phone', 390, 844], ['laptop', 1366, 768]]) {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, locale: 'en-AU', timezoneId: 'Australia/Sydney', serviceWorkers: 'block' });
    await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
    await ctx.route('**/api/**', (r) => {
      const u = new URL(r.request().url()), p = u.pathname, m = r.request().method();
      if (p === '/api/entities/me') return json(r, 200, { entity: { display_name: 'Mayur Bhavan', currency_code: 'INR', ledger_on: true } });
      if (p === '/api/books/health') return json(r, 200, Object.assign(books.health(), { year: { fiscal_year: '2026-27', from: '2026-07-01', start_month: 7 }, country: books.csStatus('AU', 'Australia') }));
      if (p === '/api/books/todo') return json(r, 200, []);
      if (p === '/api/books/accounts') return json(r, 200, { accounts: ACCOUNTS.map((a) => Object.assign({ account_id: 'acc-' + a.code, tally_group: 'Group', nature: 'asset', active: true }, a)) });
      if (p === '/api/books/dues') return json(r, 200, books.dues([]));
      if (p === '/api/books/bank/log' || p === '/api/books/bank/statement-files') return json(r, 403, BLIND);
      if (p === '/api/books/bank/rail') return json(r, 200, { currency: 'INR', me: 'Mayur Bhavan', books: { parties: [], open_items: [] }, rail_chits: [], parties: [], may: { ask: { ok: true } } });
      if (p === '/api/books/periods' && m === 'GET') return json(r, 200, books.periods([]));
      if (p === '/api/books/events' && m === 'GET') return json(r, 200, books.eventsAnswer({ events: [], picks: {} }));
      if (p === '/api/books/ledger/1500') return json(r, 200, books.ledger('1500', 'Bank', [], { from: u.searchParams.get('from'), to: u.searchParams.get('to'), opening_minor: 0, closing_minor: 0 }));
      return json(r, 200, {});
    });
    await ctx.addInitScript((s) => { try { localStorage.setItem('cb_sess', JSON.stringify(s)); } catch (_) {} }, OWNER);
    const p = await ctx.newPage();
    p.on('pageerror', (e) => threw.push(e.message));
    await p.goto(base + '/accounts.html#bank');
    await p.waitForSelector('[data-testid="bank-stmts-sum"]', { timeout: 15000, state: 'attached' });
    await p.waitForFunction((s) => { const e = document.querySelector('[data-testid="bank-stmts-sum"]'); return e && e.textContent === s; }, SAY, { timeout: 15000 });
    await p.waitForTimeout(600);
    const m = await p.evaluate(() => {
      const lines = [...document.querySelectorAll('[data-testid="bank-stmts-sum"],[data-testid="bank-store-line"]')].filter((e) => e.getClientRects().length).map((e) => { const cs = getComputedStyle(e), r = e.getBoundingClientRect(), lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.3; return { id: e.dataset.testid, text: e.textContent, cut: e.scrollWidth > e.clientWidth + 1 || (cs.textOverflow === 'ellipsis' && cs.whiteSpace === 'nowrap'), lines: Math.round(r.height / lh), right: Math.round(r.right), nowrap: cs.whiteSpace === 'nowrap' }; });
      const box = document.querySelector('.pe-card.bks'), head = box ? Math.round(box.getBoundingClientRect().bottom) : -1;
      return { lines, head, sx: document.documentElement.scrollWidth - document.documentElement.clientWidth, w: innerWidth };
    });
    console.log(tag + ' ' + JSON.stringify(m));
    const sum = m.lines.find((l) => l.id === 'bank-stmts-sum');
    ok(!!sum && sum.text === SAY && !sum.cut && !sum.nowrap && sum.right <= m.w, tag + ': the Statements line reads in full, wrapped not cut (' + (sum && sum.lines) + ' line(s))');
    for (const l of m.lines.filter((x) => x.id === 'bank-store-line')) ok(l.text.indexOf('Your access does not include costs') === 0 && !l.cut && l.right <= m.w, tag + ': the log line reads in full');
    ok(m.sx <= 0, tag + ': no sideways scroll (' + m.sx + ')');
    const cap = tag === 'phone' ? 560 : 347; /* the line before this fix: phone 539 (cut to one line), laptop 347; the phone grows only by the wrapped lines of this one sentence */
    ok(m.head > 0 && m.head <= cap, tag + ': head budget - the Statements box ends at ' + m.head + ' px (budget ' + cap + ')');
    await p.screenshot({ path: path.join(SHOTS, 'costblind-wrap-' + tag + '.png') });
    await ctx.close();
  }
  ok(threw.length === 0, 'no page error' + (threw.length ? ': ' + threw[0] : ''));
  ok(...C.finish());
  await b.close(); srv.close();
  console.log(pass + ' ok, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
})();
