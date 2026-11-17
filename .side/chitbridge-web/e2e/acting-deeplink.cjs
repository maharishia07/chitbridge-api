/* acting-deeplink.cjs — AN AUDITOR (OR ADVISER) OPENS accounts.html?acting=<client>#/bank DIRECTLY AND LANDS ON THE BANK; NO LIVE GRANT = A SENTENCE IN PLACE, NEVER A BOUNCE (l16 Fable round 2 deep-link bug).
 *  A auditor grant, address WITHOUT &role  -> Bank, read-only band  B adviser grant, no &role -> Bank, Acting band  C auditor grant + &role=auditor still works
 *  D revoked grant -> refusal sentence, page stays, no books read  E unknown id -> same  F auditor grant but &role=adviser -> refused (no escalation)  G owner (no acting) unchanged */
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
  async function open(grants, query, hash, wait) {
    const S = { reqs: [], bad: [] };
    const ctx = await b.newContext({ viewport: { width: 1366, height: 768 }, locale: 'en-AU', timezoneId: 'Australia/Sydney', serviceWorkers: 'block' });
    await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
    await ctx.clock.setFixedTime(new Date('2026-11-16T10:00:00+11:00'));
    ctx.on('response', (rs) => { if (/\/api\//.test(rs.url()) && rs.status() >= 400) S.bad.push(rs.status() + ' ' + new URL(rs.url()).pathname); });
    await ctx.route('**/api/**', (r) => {
      const u = new URL(r.request().url()), p = u.pathname, m = r.request().method();
      S.reqs.push(m + ' ' + p);
      if (p === '/api/entities/me') return json(r, 200, { entity: { display_name: 'Eastlake Fresh', currency_code: 'AUD' } });
      if (p === '/api/books-grants') return json(r, 200, { given: [], received: grants });
      /* the api's own rule: /attention is an ADVISER read (ADVISER_EXTRA_READS), closed to the auditor; /fx-revalue is closed to both (GRANT_HELD_BACK) */
      if (p === '/api/books/attention') return grants.some((g) => g.preset === 'adviser') ? json(r, 200, { from: u.searchParams.get('from'), to: u.searchParams.get('to'), total: 0, no_tax_invoice: 0, no_file: 0, no_source: 0, open_queries: null, needs: 0 }) : refused(r, 'GRANT_ROUTE_NOT_LISTED', 'This part of the books is not open to an auditor.');
      if (p === '/api/books/fx-revalue') return refused(r, 'GRANT_ROUTE_NOT_LISTED', 'This part of the books is not open to a grant.');
      if (p === '/api/books/health') return json(r, 200, Object.assign(books.health(), { currency: 'AUD', year: { fiscal_year: '2026-27', from: '2026-07-01', start_month: 7 }, country: books.csStatus('AU', 'Australia') }));
      if (p === '/api/books/accounts') return json(r, 200, { accounts: [{ code: 'G-BANK', name: 'Bank accounts', is_group: true, role: null, parent_code: null }, { code: '1500', name: 'Bank', is_group: false, role: 'bank', parent_code: 'G-BANK', active: true }].map((a) => Object.assign({ account_id: 'acc-' + a.code, tally_group: null, nature: 'asset', active: true }, a)) });
      if (p === '/api/books/periods' && m === 'GET') return json(r, 200, { under_review: { fy: '2026-27', from: '2026-07-01', to: '2027-06-30' }, years: [{ fy: '2026-27', from: '2026-07-01', to: '2027-06-30', months: 12, locked: 0, entries: 0, checked: null, of: null }], periods: [1, 2, 3, 4].map((n) => Object.assign(books.periodRow('2026-27', n, 'open'), { start_date: '2026-' + String(n + 6).padStart(2, '0') + '-01', end_date: '2026-' + String(n + 6).padStart(2, '0') + '-28' })) });
      if (p === '/api/books/bank/log') return json(r, 200, { currency: 'AUD', account: { account_id: 'acc-1500', code: '1500', name: 'Bank' }, marks: [], marks_next: null, statements: [{ period_from: '2026-10-01', period_to: '2026-10-31', currency: 'AUD', difference_minor: 35432, closing_bank_minor: 0, closing_books_minor: 0, opening_minor: 0, by_name: 'Pat', at: '2026-11-02T01:00:00Z' }], posted: [], exceptions: [] });
      if (p === '/api/books/bank/statement-files') {
        const months = ['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11'];
        return json(r, 200, { currency: 'AUD', months, accounts: [{ account_id: 'acc-1500', code: '1500', name: 'Bank', label: null }], cells: months.map((month) => ({ account_id: 'acc-1500', month, missing: true, file_ids: [], overlaps: false, newest_id: null, newest_name: null })), files: [], total: 0, next: null, older: 0 });
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
    await p.goto(base + '/accounts.html?' + query + hash);
    await p.waitForSelector(wait, { timeout: 20000, state: 'attached' }).catch(() => {});
    await p.waitForTimeout(2500);
    return { ctx, p, S, threw };
  }
  const text = (p) => p.evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' '));
  const G = (o) => Object.assign({ grant_id: 'g1', grantor_entity: CLIENT, grantor_name: 'Eastlake Fresh', preset: 'auditor', state: 'live', revoked_at: null, ended_at: null }, o);
  const here = (p) => new URL(p.url()).pathname;
  const BANK = '[data-testid="bank-stmts-grid"]', BAND = '[data-testid="ba-band"]', NO = '[data-testid="acting-refused"]';
  const cases = [
    ['A', [G()], 'acting=' + CLIENT, BANK, true, /Eastlake Fresh[\s\S]*read only/],
    ['B', [G({ preset: 'adviser' })], 'acting=' + CLIENT, BANK, true, /Acting for Eastlake Fresh/],
    ['C', [G()], 'acting=' + CLIENT + '&role=auditor', BANK, true, /Eastlake Fresh[\s\S]*read only/],
    ['D', [G({ state: 'revoked', revoked_at: '2026-11-01' })], 'acting=' + CLIENT, NO, false, /no longer|not.*access/i],
    ['E', [G({ grantor_entity: 'ent-OTHER' })], 'acting=' + CLIENT, NO, false, /no longer|not.*access/i],
    ['F', [G()], 'acting=' + CLIENT + '&role=adviser', NO, false, /no longer|not.*access/i]
  ];
  for (const [id, grants, q, wait, lands, say] of cases) {
    const { ctx, p, S, threw } = await open(grants, q, '#/bank', wait);
    const t = await text(p);
    ok(here(p) === '/accounts.html', id + ' · the page stays on accounts.html (no bounce): ' + here(p));
    if (lands) { ok((await p.locator(BANK).count()) === 1 && (await p.locator(BAND).count()) === 1, id + ' · the Bank is open under the acting band'); ok(say.test(t), id + ' · the band says whose books: ' + say); }
    else {
      ok((await p.locator(NO).count()) === 1 && say.test(t), id + ' · refused in place with a sentence');
      const read = S.reqs.filter((x) => x.indexOf('/api/books/bank') >= 0 || x.indexOf('/api/books/daybook') >= 0 || x.indexOf('/api/books/health') >= 0 || x.indexOf('/api/books/accounts') >= 0);
      ok(read.length === 0, id + ' · no book of the client was read: ' + read.join(','));
    }
    ok(threw.length === 0, id + ' · no page error ' + threw.join(';'));
    await p.screenshot({ path: path.join(SHOTS, 'deeplink-' + id + '.png') });
    await ctx.close();
  }
  { /* G: the owner opens his own books, no acting */
    const { ctx, p, S } = await open([], '', '#/daybook', '[data-testid="acc-content"]');
    ok(here(p) === '/accounts.html' && (await p.locator(BAND).count()) === 0 && (await p.locator(NO).count()) === 0, 'G · no acting: no band, no refusal');
    await ctx.close();
  }
  ok(...C.finish());
  await b.close();
  srv.close();
  console.log('\n' + (fail ? 'FAIL' : 'all ok') + ': ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
