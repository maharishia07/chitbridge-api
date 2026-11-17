/* bank17.cjs — THE BANK PAGE OPENS ON THE PERIOD IN THE ADDRESS (auditor 3x paper D2). &fy=2025-26 -> FY 2025-26, never 2026-27; the bank balance at that period end is the sign-off the api keeps (GET /bank/log), read not worked out. Pattern: fable2-seat.cjs. OUT=<dir> for shots. */
'use strict';
/* rank9.cjs — RANK 9: the bank agreement under the trial balance (one shared function, bank-tb-line.js). The api's `bank` block is stood in here; the words, the codes, the link and the no-block case are proved at 1366 and 390. */
const LINE = {
  reconciled: { account_id: 'acc-1500', code: '1500', name: 'Bank', currency: 'AUD', state: 'reconciled', period_to: '2026-06-30', statement_minor: 20336000, books_signed_minor: 20286000, unexplained_minor: 0, books_now_minor: 20286000, moved_minor: 0, signed_at: '2026-07-02 09:00:00+00' },
  unexplained: { account_id: 'acc-1500', code: '1500', name: 'Bank', currency: 'AUD', state: 'unexplained', period_to: '2026-06-30', statement_minor: 20336000, books_signed_minor: 20286000, unexplained_minor: 50000, books_now_minor: 20286000, moved_minor: 0, signed_at: null },
  moved: { account_id: 'acc-1500', code: '1500', name: 'Bank', currency: 'AUD', state: 'reconciled', period_to: '2026-06-30', statement_minor: 20336000, books_signed_minor: 20286000, unexplained_minor: 0, books_now_minor: 20296000, moved_minor: 10000, signed_at: null },
  earlier: { account_id: 'acc-1500', code: '1500', name: 'Bank', currency: 'AUD', state: 'earlier', period_to: '2026-05-31', statement_minor: 15000000, books_signed_minor: null, unexplained_minor: null, books_now_minor: null, moved_minor: null, signed_at: null },
  never: { account_id: 'acc-1500', code: '1500', name: 'Bank', currency: 'AUD', state: 'never' },
  none_by_date: { account_id: 'acc-1510', code: '1510', name: 'Savings', currency: 'AUD', state: 'none_by_date' },
  not_shared: { account_id: 'acc-1520', code: '1520', name: 'Term', currency: 'AUD', state: 'not_shared' }
};
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
      if (p === '/api/books/bank/log') return json(r, 200, { currency: 'AUD', account: { account_id: 'acc-1500', code: '1500', name: 'Bank' }, marks: [], marks_next: null, statements: [{ period_from: '2026-10-01', period_to: '2026-10-31', currency: 'AUD', difference_minor: 35432, closing_bank_minor: 99900, closing_books_minor: 64468, opening_minor: 0, by_name: 'Pat', at: '2026-11-02T01:00:00Z' }, { period_from: '2026-06-01', period_to: '2026-06-30', currency: 'AUD', difference_minor: 0, closing_bank_minor: 20336000, closing_books_minor: 20286000, opening_minor: 0, by_name: 'Pat', at: '2026-07-02T01:00:00Z' }], posted: [], exceptions: [] });
      if (p === '/api/books/bank/statement-files') {
        const to = u.searchParams.get('to') || '2026-11', ty = Number(to.slice(0, 4)), tm = Number(to.slice(5, 7)), months = [5, 4, 3, 2, 1, 0].map((k) => { const t = ty * 12 + tm - 1 - k; return Math.floor(t / 12) + '-' + String((t % 12) + 1).padStart(2, '0'); });
        const kept = (opt.kept || []).map((m) => ({ id: 'f-' + m, account_id: 'acc-1500', label: null, period_from: m + '-01', period_to: m + '-28', name: m + '.csv', size: 9, source: 'owner', overlaps: false, by_name: 'M', by_firm: null, for_client: false, added_at: '2026-11-02T01:00:00Z', read_at: null, reads: 0 }));
        const unexplained = opt.unexplained || { accounts: [{ account_id: 'acc-1500', currency: 'AUD', unexplained_minor: 35432, to: '2026-10-31' }], by_currency: [{ currency: 'AUD', unexplained_minor: 35432, to: '2026-10-31' }], currency: 'AUD', unexplained_minor: 35432, to: '2026-10-31', count: 1 };
        const asOf = u.searchParams.get('asOf'), signed = [{ period_to: '2026-10-31', statement_minor: 99900, books_signed_minor: 64468, unexplained_minor: 35432, tied: false, made_at: '2026-11-02 01:00:00+00' }, { period_to: '2026-06-30', statement_minor: 20336000, books_signed_minor: 20286000, unexplained_minor: 0, tied: true, made_at: '2026-07-02 01:00:00+00' }].filter((x) => !asOf || x.period_to <= asOf).slice(0, 1).map((x) => Object.assign({ account_id: 'acc-1500', currency: 'AUD' }, x));
        return json(r, 200, Object.assign({ currency: 'AUD', today: '2026-11-16', months, unexplained, accounts: [{ account_id: 'acc-1500', code: '1500', name: 'Bank', label: null }], cells: months.map((month) => ({ account_id: 'acc-1500', month, missing: !(opt.kept || []).includes(month), file_ids: (opt.kept || []).includes(month) ? ['f-' + month] : [], overlaps: false, newest_id: (opt.kept || []).includes(month) ? 'f-' + month : null, newest_name: (opt.kept || []).includes(month) ? month + '.csv' : null })), files: kept, total: kept.length, next: null, older: 0 }, asOf ? { signed_as_at: { asOf, accounts: signed } } : {}));
      }
      if (p === '/api/books/trial-balance') return json(r, 200, Object.assign({ currency: 'AUD', asOf: u.searchParams.get('asOf'), shown_as_at: u.searchParams.get('asOf'), fy_from: '2025-07-01', rows: [{ code: '1500', name: 'Bank', group: 'bank', dr_minor: 20286000, cr_minor: 0, net_minor: 20286000 }], bank: [], over_rule: { pct_bp: 1000, min_major: 1000, min_minor: 100000 }, compare: null, total_dr_minor: 20286000, total_cr_minor: 20286000, balanced: true }, opt.tb ? { bank: opt.tb } : {}));
      if (p === '/api/books/dues') return json(r, 200, books.dues([]));
      if (p === '/api/books/daybook') return json(r, 200, books.daybook([], { currency: 'AUD', country: 'AU' }));
      if (p === '/api/books/todo') return json(r, 200, []);
      return json(r, 200, {});
    });
    await ctx.addInitScript((s) => { try { if (!localStorage.getItem('cb_seeded')) { localStorage.setItem('cb_seeded', '1'); localStorage.setItem('cb_sess', JSON.stringify(s)); } } catch (_) {} }, FIRM);
    const p = await ctx.newPage(), threw = [];
    p.on('pageerror', (e) => threw.push(e.message));
    await p.goto(base + '/accounts.html' + (role === 'owner' ? '?x=1' : '?acting=' + CLIENT + (role === 'auditor' ? '&role=auditor' : '')) + (opt.q || '') + hash);
    await p.waitForSelector(wait, { timeout: 20000, state: 'attached' });
    await p.waitForTimeout(2500);
    return { ctx, p, S, threw };
  }
  const text = (p) => p.evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' '));
  for (const width of [1366, 390]) {
  const line = (p) => p.locator('[data-testid="bv-tb-bank"]').innerText().catch(() => '');
    {
      const { ctx, p, threw } = await open('owner', '#/tb', '[data-testid="tb-balanced"]', { width, tb: [LINE.reconciled] });
      const t = await line(p);
      ok(/Signed off to 30 Jun 2026/.test(t) && /Statement A[$]203,360[.]00/.test(t) && /nothing unexplained/.test(t) && !/differ|Difference/.test(t), width + ' · P9.1b reconciled with a timing item (statement differs from books, nothing unexplained): ' + t);
      ok(await p.locator('[data-testid="bv-tb-bank-open-acc-1500"]').count() === 1 && await p.locator('[data-cbsid="BKS004-P01"]').count() === 1, width + ' · the note and its Open Bank button carry their register codes');
      ok(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), width + ' · no horizontal page scroll');
      await p.screenshot({ path: path.join(SHOTS, 'rank9-reconciled-' + width + '.png') });
      ok(threw.length === 0, width + ' · no page error');
      await ctx.close();
    }
    {
      const { ctx, p } = await open('owner', '#/tb', '[data-testid="tb-balanced"]', { width, tb: [LINE.unexplained] });
      const t = await line(p);
      ok(/unexplained A[$]500[.]00/.test(t) && !/nothing unexplained/.test(t), width + ' · P9.2 unexplained is absolute (stored -50,000): ' + t);
      await ctx.close();
    }
    {
      const { ctx, p } = await open('owner', '#/tb', '[data-testid="tb-balanced"]', { width, tb: [LINE.moved] });
      ok(/books now differ from the figure signed by A[$]100[.]00/.test(await line(p)), width + ' · P9.9 books moved after sign-off');
      await ctx.close();
    }
    {
      const { ctx, p, S } = await open('owner', '#/tb', '[data-testid="tb-balanced"]', { width, tb: [LINE.earlier] });
      const t = await line(p);
      ok(/Signed off to 31 May 2026/.test(t) && /Statement A[$]150,000[.]00/.test(t) && /no difference shown/.test(t) && !/unexplained/.test(t), width + ' · P9.3 earlier: date and statement as signed, no difference: ' + t);
      await p.locator('[data-testid="bv-tb-bank-at-acc-1500"]').click();
      await p.waitForTimeout(800);
      ok(S.reqs.some((x) => x === 'GET /api/books/trial-balance') && (await p.locator('#tb_asof').inputValue()) === '2026-05-31', width + ' · the link reads the trial balance at the signed date');
      await ctx.close();
    }
    {
      const { ctx, p } = await open('owner', '#/tb', '[data-testid="tb-balanced"]', { width, tb: [LINE.never, LINE.none_by_date, LINE.not_shared] });
      const t = await line(p);
      ok(/No bank sign-off yet/.test(t) && /No sign-off on or before this date/.test(t) && /not shared with you/.test(t), width + ' · P9.4 / P9.4b / not shared, each in words: ' + t);
      await ctx.close();
    }
    {
      const { ctx, p } = await open('owner', '#/tb', '[data-testid="tb-balanced"]', { width, tb: null });
      ok((await line(p)) === '', width + ' · the table not migrated: no block, the page says nothing');
      await ctx.close();
    }
  }
  ok(...C.finish());
  await b.close(); srv.close();
  console.log(pass + ' ok / ' + fail + ' fail'); process.exit(fail ? 1 : 0);
})();
