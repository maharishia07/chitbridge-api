/* bankgrid.cjs — A YEAR SIGNED OFF IN ONE GO WITH NO FILE KEPT READS AS SIGNED, FOLDED TO ONE LINE (final check gap 3). Built on bank17.cjs. — THE BANK PAGE OPENS ON THE PERIOD IN THE ADDRESS (auditor 3x paper D2). &fy=2025-26 -> FY 2025-26, never 2026-27; the bank balance at that period end is the sign-off the api keeps (GET /bank/log), read not worked out. Pattern: fable2-seat.cjs. OUT=<dir> for shots. */
'use strict';
const { chromium } = require('@playwright/test');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..'), PUB = path.join(ROOT, 'public'), SHOTS = process.env.OUT || path.join(__dirname, 'shots');
const T = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok  ' + m); } else { fail++; console.log('  XX  ' + m); } };
const books = require('./lib/books-api.cjs');
const C = require('./lib/contract.cjs');   /* every answer the stand-in serves for a route in the api contract is checked (e2e/contract.cjs holds this) */
const json = (r, status, o) => C.json(r, status, o);
const tok = (c) => { const e = (o) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_'); return e({ alg: 'none' }) + '.' + e(Object.assign({ exp: Math.floor(Date.now() / 1000) + 86400 }, c)); };
const FIRM = { token: tok({ identity_id: 'ent-FIRM', identity_type: 'entity' }), role: 'entity', name: 'Pat Accountant', entity: 'Blue Gum Books', country: 'AU', currency: 'AUD' };
const CLIENT = 'ent-CL';
const refused = (r, code, words) => json(r, 403, { code, error: words, message: words, detail: words });
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
  async function open(role, hash, wait, opt) {
    opt = opt || {};
    const S = { reqs: [], bad: [] };
    const ctx = await b.newContext({ viewport: { width: (opt && opt.width) || 1366, height: 768 }, locale: 'en-AU', timezoneId: 'Australia/Sydney', serviceWorkers: 'block' });
    await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
    await ctx.clock.setFixedTime(new Date('2026-11-16T10:00:00+11:00'));
    ctx.on('response', (rs) => { if (/\/api\//.test(rs.url()) && rs.status() >= 400) S.bad.push(rs.status() + ' ' + new URL(rs.url()).pathname); });
    await ctx.route('**/api/**', (r) => {
      const u = new URL(r.request().url()), p = u.pathname, m = r.request().method();
      S.reqs.push(m + ' ' + p);
      if (p === '/api/entities/me') return json(r, 200, { entity: { display_name: 'Eastlake Fresh', currency_code: 'AUD' } });
      if (p === '/api/books-grants' && opt.grants) return json(r, opt.grants, { code: 'X', message: 'x' });
      if (p === '/api/books-grants') return json(r, 200, { given: [], received: [{ grant_id: 'g1', grantor_entity: CLIENT, grantor_name: 'Eastlake Fresh', preset: role === 'auditor' ? 'auditor' : 'adviser', state: 'live', revoked_at: null, ended_at: null }] });
      /* the api's own rule: /attention is an ADVISER read (ADVISER_EXTRA_READS), closed to the auditor; /fx-revalue is closed to both (GRANT_HELD_BACK) */
      if (p === '/api/books/attention') return role === 'adviser' ? json(r, 200, { from: u.searchParams.get('from'), to: u.searchParams.get('to'), total: 0, no_tax_invoice: 0, no_file: 0, no_source: 0, open_queries: null, needs: 0 }) : refused(r, 'GRANT_ROUTE_NOT_LISTED', 'This part of the books is not open to an auditor.');
      if (p === '/api/books/fx-revalue') return refused(r, 'GRANT_ROUTE_NOT_LISTED', 'This part of the books is not open to a grant.');
      if (p === '/api/books/health') return json(r, 200, Object.assign(books.health(), { currency: 'AUD', year: { fiscal_year: '2026-27', from: '2026-07-01', start_month: 7 }, country: books.csStatus('AU', 'Australia') }));
      if (p === '/api/books/accounts') return json(r, 200, { accounts: [{ code: 'G-BANK', name: 'Bank accounts', is_group: true, role: null, parent_code: null }, { code: '1500', name: 'Bank', is_group: false, role: 'bank', parent_code: 'G-BANK', active: true }].map((a) => Object.assign({ account_id: 'acc-' + a.code, tally_group: null, nature: 'asset', active: true }, a)) });
      if (p === '/api/books/periods' && m === 'GET') return json(r, 200, { under_review: { fy: '2026-27', from: '2026-07-01', to: '2027-06-30' }, years: [{ fy: '2026-27', from: '2026-07-01', to: '2027-06-30', months: 12, locked: 0, entries: 0, checked: null, of: null }], periods: [1, 2, 3, 4].map((n) => Object.assign(books.periodRow('2026-27', n, 'open'), { start_date: '2026-' + String(n + 6).padStart(2, '0') + '-01', end_date: '2026-' + String(n + 6).padStart(2, '0') + '-28' })) });
      if (p === '/api/books/bank/log') return json(r, 200, { currency: 'AUD', account: { account_id: 'acc-1500', code: '1500', name: 'Bank' }, marks: [], marks_next: null, statements: (opt.wide ? [{ period_from: '2025-07-01', period_to: '2026-10-31', currency: 'AUD', difference_minor: 0, closing_bank_minor: 20286000, closing_books_minor: 20286000, opening_minor: 0, by_name: 'Pat', at: '2026-11-02T01:00:00Z' }] : []).concat([{ period_from: '2026-10-01', period_to: '2026-10-31', currency: 'AUD', difference_minor: 35432, closing_bank_minor: 99900, closing_books_minor: 64468, opening_minor: 0, by_name: 'Pat', at: '2026-11-02T01:00:00Z' }, { period_from: '2026-06-01', period_to: '2026-06-30', currency: 'AUD', difference_minor: 0, closing_bank_minor: 20336000, closing_books_minor: 20286000, opening_minor: 0, by_name: 'Pat', at: '2026-07-02T01:00:00Z' }]), posted: [], exceptions: [] });
      if (p === '/api/books/bank/statement-files') {
        const to = u.searchParams.get('to') || '2026-11', ty = Number(to.slice(0, 4)), tm = Number(to.slice(5, 7)), months = [5, 4, 3, 2, 1, 0].map((k) => { const t = ty * 12 + tm - 1 - k; return Math.floor(t / 12) + '-' + String((t % 12) + 1).padStart(2, '0'); });
        const kept = (opt.kept || []).map((m) => ({ id: 'f-' + m, account_id: 'acc-1500', label: null, period_from: m + '-01', period_to: m + '-28', name: m + '.csv', size: 9, source: 'owner', overlaps: false, by_name: 'M', by_firm: null, for_client: false, added_at: '2026-11-02T01:00:00Z', read_at: null, reads: 0 }));
        const unexplained = opt.unexplained || { accounts: [{ account_id: 'acc-1500', currency: 'AUD', unexplained_minor: 35432, to: '2026-10-31' }], by_currency: [{ currency: 'AUD', unexplained_minor: 35432, to: '2026-10-31' }], currency: 'AUD', unexplained_minor: 35432, to: '2026-10-31', count: 1 };
        const asOf = u.searchParams.get('asOf'), signed = [{ period_to: '2026-10-31', statement_minor: 99900, books_signed_minor: 64468, unexplained_minor: 35432, tied: false, made_at: '2026-11-02 01:00:00+00' }, { period_to: '2026-06-30', statement_minor: 20336000, books_signed_minor: 20286000, unexplained_minor: 0, tied: true, made_at: '2026-07-02 01:00:00+00' }].filter((x) => !asOf || x.period_to <= asOf).slice(0, 1).map((x) => Object.assign({ account_id: 'acc-1500', currency: 'AUD' }, x));
        return json(r, 200, Object.assign({ currency: 'AUD', today: '2026-11-16', months, unexplained, accounts: [{ account_id: 'acc-1500', code: '1500', name: 'Bank', label: null }], cells: months.map((month) => ({ account_id: 'acc-1500', month, missing: !(opt.kept || []).includes(month), file_ids: (opt.kept || []).includes(month) ? ['f-' + month] : [], overlaps: false, newest_id: (opt.kept || []).includes(month) ? 'f-' + month : null, newest_name: (opt.kept || []).includes(month) ? month + '.csv' : null })), files: kept, total: kept.length, next: null, older: 0 }, asOf ? { signed_as_at: { asOf, accounts: signed } } : {}));
      }
      if (p === '/api/books/dues') return json(r, 200, books.dues([]));
      if (p === '/api/books/daybook') return json(r, 200, books.daybook([], { currency: 'AUD', country: 'AU' }));
      if (p === '/api/books/todo') return json(r, 200, []);
      return json(r, 200, {});
    });
    await ctx.addInitScript((s) => { try { if (!localStorage.getItem('cb_seeded')) { localStorage.setItem('cb_seeded', '1'); localStorage.setItem('cb_sess', JSON.stringify(s)); } } catch (_) {} }, FIRM);
    const p = await ctx.newPage(), threw = [];
    p.on('pageerror', (e) => threw.push(e.message));
    await p.goto(base + '/accounts.html?acting=' + CLIENT + (role === 'auditor' ? '&role=auditor' : '') + (opt.q || '') + hash);
    await p.waitForSelector(wait, { timeout: 20000, state: 'attached' });
    await p.waitForTimeout(2500);
    return { ctx, p, S, threw };
  }
  const text = (p) => p.evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' '));
  for (const width of [1366, 390]) {
    const wide = await open('auditor', '#/bank', '[data-testid="bank-stmts-sum"]', { q: '&fy=2025-26', width, wide: true });
    const t = await text(wide.p);
    ok(await wide.p.locator('[data-testid="bank-home-folded"]').count() === 1, width + ' · signed year, no file: ONE folded line');
    ok(await wide.p.locator('[data-testid="bank-stmts-grid"]').count() === 0, width + ' · no grid of cells');
    ok(!/Missing/.test(t) && /Signed off for 6 months, no statement file kept/.test(t), width + ' · no Missing; the line says all 6 months shown are signed, no file: ' + (t.match(/Signed off for[^.]*/) || [''])[0]);
    ok(/No statement file kept/.test(t) && !/Nothing kept yet/.test(t), width + ' · summary reads No statement file kept');
    await wide.p.screenshot({ path: path.join(SHOTS, 'bankgrid-' + width + '.png') });
    ok(wide.threw.length === 0, width + ' · no page error');
    await wide.ctx.close();
  }
  {
    const part = await open('auditor', '#/bank', '[data-testid="bank-stmts-grid"]', { q: '&fy=2025-26' });
    const t = await text(part.p);
    ok(/Not signed off/.test(t) && await part.p.locator('[data-testid="bank-home-folded"]').count() === 0, 'sign-off for one month only: the other months say Not signed off, grid kept (nothing invented)');
    await part.ctx.close();
  }
  ok(...C.finish());
  await b.close(); srv.close();
  console.log(pass + ' ok / ' + fail + ' fail'); process.exit(fail ? 1 : 0);
})();
