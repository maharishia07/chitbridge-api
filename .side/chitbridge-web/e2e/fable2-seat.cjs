/* fable2-seat.cjs — THE ACCOUNTANT SEAT ASKS ONLY THE DOORS IT MAY USE; THE BANK SHOWS THE SIGN-OFFS THE PRACTICE ROW COUNTS (l16 Fable round 2: R2-2, R2-3). Pattern: audbank.cjs (Playwright, a stand-in api inside the page, a free port).
 *  A  the accountant seat (a firm owner acting under an ADVISER grant): the Day book reads GET /attention (the api's ADVISER_EXTRA_READS answers it) and says no "could not be read"; Month lock never asks GET /fx-revalue (held back from every grant) and shows no failure line; no 403 reaches the page.
 *  B  the Bank, no statement file kept but one signed-off statement (A$354.32 left unexplained): the summary says "Signed off to ..." and "A$354.32 unexplained" as the practice row does; the month is "Signed off", never "Missing".
 *  D  (l16 fable3) R3-1/R3-2: kept files -> the first line still says the sign-off and A$354.32; the month in progress (Nov, shop day 16 Nov) is "Not due yet", never counted Missing
 *  E  (l16 fable3) the unexplained sum is the api's: two currencies are two figures, never one; the date is the locale's (31 Oct 2026), not 2026-10-31
 *  F  (l16 fable3) R3-3: the read-only seat is not asked to type the closing balance; the owner still is
 *  G  (l16 fable3) the grant list that could not be read has its own sentence; a real refusal keeps the old one
 *  C  the auditor seat: the evidence strip is not asked at all (the door is closed to him) and says nothing. OUT=<dir> says where the shots go. */
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
    const ctx = await b.newContext({ viewport: { width: 1366, height: 768 }, locale: 'en-AU', timezoneId: 'Australia/Sydney', serviceWorkers: 'block' });
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
      if (p === '/api/books/bank/log') return json(r, 200, { currency: 'AUD', account: { account_id: 'acc-1500', code: '1500', name: 'Bank' }, marks: [], marks_next: null, statements: [{ period_from: '2026-10-01', period_to: '2026-10-31', currency: 'AUD', difference_minor: 35432, closing_bank_minor: 0, closing_books_minor: 0, opening_minor: 0, by_name: 'Pat', at: '2026-11-02T01:00:00Z' }], posted: [], exceptions: [] });
      if (p === '/api/books/bank/statement-files') {
        const months = ['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11'];
        const kept = (opt.kept || []).map((m) => ({ id: 'f-' + m, account_id: 'acc-1500', label: null, period_from: m + '-01', period_to: m + '-28', name: m + '.csv', size: 9, source: 'owner', overlaps: false, by_name: 'M', by_firm: null, for_client: false, added_at: '2026-11-02T01:00:00Z', read_at: null, reads: 0 }));
        const unexplained = opt.unexplained || { accounts: [{ account_id: 'acc-1500', currency: 'AUD', unexplained_minor: 35432, to: '2026-10-31' }], by_currency: [{ currency: 'AUD', unexplained_minor: 35432, to: '2026-10-31' }], currency: 'AUD', unexplained_minor: 35432, to: '2026-10-31', count: 1 };
        return json(r, 200, { currency: 'AUD', today: '2026-11-16', months, unexplained, accounts: [{ account_id: 'acc-1500', code: '1500', name: 'Bank', label: null }], cells: months.map((month) => ({ account_id: 'acc-1500', month, missing: !(opt.kept || []).includes(month), file_ids: (opt.kept || []).includes(month) ? ['f-' + month] : [], overlaps: false, newest_id: (opt.kept || []).includes(month) ? 'f-' + month : null, newest_name: (opt.kept || []).includes(month) ? month + '.csv' : null })), files: kept, total: kept.length, next: null, older: 0 });
      }
      if (p === '/api/books/dues') return json(r, 200, books.dues([]));
      if (p === '/api/books/daybook') return json(r, 200, books.daybook([], { currency: 'AUD', country: 'AU' }));
      if (p === '/api/books/todo') return json(r, 200, []);
      if (p === '/api/books/cheques') return json(r, 200, C.example('GET /api/books/cheques'));
      return json(r, 200, {});
    });
    await ctx.addInitScript((s) => { try { if (!localStorage.getItem('cb_seeded')) { localStorage.setItem('cb_seeded', '1'); localStorage.setItem('cb_sess', JSON.stringify(s)); } } catch (_) {} }, FIRM);
    const p = await ctx.newPage(), threw = [];
    p.on('pageerror', (e) => threw.push(e.message));
    await p.goto(base + '/accounts.html?acting=' + CLIENT + (role === 'auditor' ? '&role=auditor' : '') + hash);
    await p.waitForSelector(wait, { timeout: 20000, state: 'attached' });
    await p.waitForTimeout(2500);
    return { ctx, p, S, threw };
  }
  const text = (p) => p.evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' '));
  {
    const { ctx, p, S, threw } = await open('adviser', '#/daybook', '[data-testid="ba-band"]');
    const t = await text(p);
    ok(S.reqs.some((x) => x === 'GET /api/books/attention'), 'A · the Day book reads the evidence counts in the accountant seat');
    ok(!/could not be read/i.test(t), 'A · no "could not be read" line in the Day book');
    ok(!S.bad.some((x) => /attention/.test(x)), 'A · no 403 on /attention');
    await p.evaluate(() => { location.hash = '#/lock'; });
    await p.waitForTimeout(2500);
    ok(!S.reqs.some((x) => /fx-revalue/.test(x)), 'A · Month lock never asks /fx-revalue in a grant seat');
    ok(S.bad.length === 0 && threw.length === 0, 'A · no 4xx and no page error in the seat: ' + JSON.stringify(S.bad.concat(threw)));
    await p.screenshot({ path: path.join(SHOTS, 'fable2-A-lock.png') });
    await ctx.close();
  }
  {
    const { ctx, p } = await open('adviser', '#/bank', '[data-testid="bank-stmts-grid"]');
    const t = await text(p);
    ok(/No statement file kept/.test(t) && /Signed off to 31 Oct 2026/.test(t) && !/2026-10-31/.test(t) && /A\$354\.32 unexplained/.test(t), 'B · the Bank says what the practice row says: signed off to 31 Oct, A$354.32 unexplained: ' + t.slice(t.indexOf('Statements'), t.indexOf('Statements') + 160));
    ok((await p.locator('[data-testid="bank-stmts-unfiled-acc-1500-2026-10"]').count()) === 1 && (await p.locator('[data-testid="bank-stmts-miss-acc-1500-2026-10"]').count()) === 0, 'B · October is "Signed off", not "Missing"');
    ok((await p.locator('[data-testid="bank-stmts-miss-acc-1500-2026-09"]').count()) === 1, 'B · September (no sign-off) stays Missing');
    await p.screenshot({ path: path.join(SHOTS, 'fable2-B-bank.png') });
    await ctx.close();
  }
  {
    const { ctx, p } = await open('adviser', '#/bank', '[data-testid="bank-stmts-grid"]', { kept: ['2026-09', '2026-10'] });
    const t = await text(p), sum = await p.locator('[data-testid="bank-stmts-sum"]').innerText();
    ok(/✓/.test(sum) && /Signed off to 31 Oct 2026/.test(sum) && /A[$]354[.]32 unexplained/.test(sum), 'D · kept files: the first line carries the sign-off and A$354.32: ' + sum);
    ok(/3 missing/.test(sum), 'D · Jun, Jul, Aug are missing; November (16 Nov) is not counted: ' + sum);
    ok((await p.locator('[data-testid="bank-stmts-current-acc-1500-2026-11"]').count()) === 1 && (await p.locator('[data-testid="bank-stmts-miss-acc-1500-2026-11"]').count()) === 0, 'D · November is "Not due yet", never Missing');
    await p.screenshot({ path: path.join(SHOTS, 'fable3-D-kept-1366.png') });
    await p.setViewportSize({ width: 390, height: 844 });
    await p.waitForTimeout(600);
    await p.screenshot({ path: path.join(SHOTS, 'fable3-D-kept-390.png') });
    await ctx.close();
  }
  {
    const two = { accounts: [{ account_id: 'acc-1500', currency: 'AUD', unexplained_minor: 35432, to: '2026-10-31' }, { account_id: 'acc-1600', currency: 'USD', unexplained_minor: 10000, to: '2026-10-31' }], by_currency: [{ currency: 'AUD', unexplained_minor: 35432, to: '2026-10-31' }, { currency: 'USD', unexplained_minor: 10000, to: '2026-10-31' }], currency: null, unexplained_minor: null, to: '2026-10-31', count: 2 };
    const { ctx, p } = await open('adviser', '#/bank', '[data-testid="bank-stmts-grid"]', { kept: ['2026-10'], unexplained: two });
    const sum = await p.locator('[data-testid="bank-stmts-sum"]').innerText();
    ok(/A[$]354[.]32 AUD/.test(sum) && /100[.]00 USD/.test(sum) && !/454[.]32/.test(sum), 'E · two currencies: one figure each, never added: ' + sum);
    await p.screenshot({ path: path.join(SHOTS, 'fable3-E-two-currencies-1366.png') });
    await ctx.close();
  }
  {
    const { ctx, p } = await open('auditor', '#/bank', '[data-testid="bank-stmts-grid"]', { kept: ['2026-10'] });
    const html = await p.evaluate(() => { try { BKB.brs = null; const host = document.createElement('div'); host.id = 'bk_brs'; document.body.appendChild(host); bankBrsPaint(); return host.innerHTML ; } catch (e) { return 'ERR ' + e.message; } });
    ok(!/ERR/.test(html) && !/Type it from the statement/.test(html) && !/<input/.test(html), 'F · the auditor is not asked to type the closing balance, and gets no box: ' + html.slice(0, 160));
    ok(/does not say the bank's closing balance/.test(html), 'F · the read-only seat is told, in words');
    await ctx.close();
  }
  {
    const { ctx, p } = await open('adviser', '#/bank', '[data-testid="acting-unread"]', { grants: 500 });
    const t = await text(p);
    ok(/could not be read/.test(t) && !/do not have access/.test(t) && (await p.locator('[data-testid="read-failed-retry"]').count()) === 1, 'G · a failed grant list says it could not be read, with Try again: ' + t.slice(0, 160));
    await p.screenshot({ path: path.join(SHOTS, 'fable3-G-unread-1366.png') });
    await ctx.close();
  }
  {
    const { ctx, p } = await open('adviser', '#/bank', '[data-testid="acting-refused"]', { grants: 403 });
    const t = await text(p);
    ok(/do not have access/.test(t) && (await p.locator('[data-testid="acting-unread"]').count()) === 0, 'G · a real refusal (403) keeps "no current access"');
    await ctx.close();
  }
  {
    const { ctx, S } = await open('auditor', '#/lock', '[data-testid="ba-band"]');
    ok(!S.reqs.some((x) => /attention|fx-revalue/.test(x)), 'C · the auditor seat asks neither /attention nor /fx-revalue');
    ok(S.bad.length === 0, 'C · no 4xx in the auditor seat: ' + JSON.stringify(S.bad));
    await ctx.close();
  }
  ok(...C.finish());
  await b.close();
  srv.close();
  console.log('\n' + (fail ? 'FAIL' : 'all ok') + ': ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
