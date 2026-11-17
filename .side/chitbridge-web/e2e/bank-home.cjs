/* bank-home.cjs — THE BANK HOME (l16, W15-84; app/cap-bank-home.js). Pattern: bank-statements-box.cjs (Playwright, a stand-in API answering inside the page, a free port; nothing leaves the machine).
 *  1  the menu's Bank lands on the home: the account × month grid (Aug ✓ signed off, Sep ● not signed off, the rest Missing) and a card "September 2026 · Not signed off yet · Continue"
 *  2  a month pressed opens its lines; the trail reads "← Bank › account › September 2026"; Back (button) returns to the home; the browser's Back does the same, Forward opens the lines again
 *  3  the menu's Bank from the lines lands on the home (never the last statement); no Add statement toggle over the lines
 *  4  keyboard only (focus the month, Enter, Back, Enter); 1366×768 and 390×844 need no page scroll
 *  5  W15-100 the scale seed (10 accounts × 120 months): one FY at a time with a year stepper from the pack, newest-first cards (three + "and n more"), the kept files a server-paged CBList (25 a page, search), All years, each row's year count, the overlap inside its cell; 1366 and 390, keyboard
 * OUT=<dir> says where the shots go. */
'use strict';
const { chromium } = require('@playwright/test');
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const ROOT = path.join(__dirname, '..'), PUB = path.join(ROOT, 'public'), SHOTS = process.env.OUT || path.join(__dirname, "shots");
const T = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok  ' + m); } else { fail++; console.log('  XX  ' + m); } };
const books = require('./lib/books-api.cjs');
const C = require('./lib/contract.cjs');   /* every stand-in answer for a contract route is held to the API's shape (M43) */
const json = (r, status, o) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(o) });
const tok = (c) => { const e = (o) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_'); return e({ alg: 'none' }) + '.' + e(Object.assign({ exp: Math.floor(Date.now() / 1000) + 86400 }, c)); };
const OWNER = { token: tok({ identity_id: 'ent-M', identity_type: 'entity' }), role: 'entity', name: 'Mayur', entity: 'Mayur Bhavan' };
const AU = Object.assign({}, OWNER, { country: 'AU' }); /* the pack gives the year (July to June) and the years to keep */

const SEP = [
  'Account No: 50100123456789',
  'Date,Narration,Chq./Ref.No.,Value Dt,Withdrawal Amt.,Deposit Amt.,Closing Balance',
  '01/09/26,UPI-RAVI STORES-ravi@okbank-ZZMARKER7731,UPI0001,01/09/26,,12000.00,112000.00',
  '05/09/26,CHQ PAID-0001234-KV TRADERS,0001234,05/09/26,5000.00,,107000.00',
  '25/09/26,NEFT-UNKNOWN PARTY XYZ,N123456,25/09/26,,3500.00,109016.40'
].join('\n');
/** a second file whose dates cross the first (20 Sep to 10 Oct) */
const CROSS = [
  'Date,Narration,Chq./Ref.No.,Value Dt,Withdrawal Amt.,Deposit Amt.,Closing Balance',
  '20/09/26,CHQ PAID-0009999-SOME PAYEE,0009999,20/09/26,100.00,,100.00',
  '10/10/26,SMS ALERT CHARGES,,10/10/26,23.60,,76.40'
].join('\n');
const ACCOUNTS = [
  { code: 'G-BANK', name: 'Bank accounts', is_group: true, role: null, parent_code: null },
  { code: '1500', name: 'Bank', is_group: false, role: 'bank', parent_code: 'G-BANK', active: true }
];
const sha = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');
const monthsEnding = (end, count) => { const out = []; let y = Number(end.slice(0, 4)), m = Number(end.slice(5, 7)); for (let n = 0; n < count; n++) { out.unshift(y + '-' + String(m).padStart(2, '0')); m -= 1; if (m === 0) { m = 12; y -= 1; } } return out; };
const lastDay = (month) => month + '-' + String(new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate()).padStart(2, '0');

const ACC = (n) => ({ account_id: 'acc-' + (1499 + n), code: String(1499 + n), name: n === 1 ? 'Bank' : 'Account ' + n, label: null });
const MONTH_NAMES = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const fileOf = (id, account, from, to, name, seq) => ({ id, account_id: account.account_id, label: null, period_from: from, period_to: to, currency: 'INR', name, size: 100, mime: 'text/csv', kind: 'bank_statement', source: 'owner', overlaps: false, by_name: 'Mayur', by_firm: null, for_client: false, added_at: to + 'T00:00:00Z', read_at: null, reads: 0, text: 'x', sha: String(seq), seq });
/** the box's stand-in: what the api answers (lib/bank-statement-page.js): the year's cells, ONE page of files newest first, total, next (a cursor), older */
function stand() {
  const S = { reqs: [], posts: [], reads: [], files: [], pending: false, ledgerCalls: [], signed: [], accts: [ACC(1)], maxFiles: 0 };
  S.list = (query) => {
    const months = monthsEnding(query.get('to') || '2026-11', Number(query.get('months') || 6)), first = months[0] + '-01', last = lastDay(months[months.length - 1]);
    const inWin = S.files.filter((f) => f.period_from <= last && f.period_to >= first);
    const cells = [];
    for (const account of S.accts) for (const month of months) {
      const here = inWin.filter((f) => f.account_id === account.account_id && f.period_from <= lastDay(month) && f.period_to >= month + '-01');
      const newest = here.slice().sort((x, y) => y.period_to.localeCompare(x.period_to))[0];
      cells.push({ account_id: account.account_id, month, missing: !here.length, file_ids: here.map((f) => f.id), overlaps: here.some((f) => f.overlaps), newest_id: newest ? newest.id : null, newest_name: newest ? newest.name : null, newest_to: newest ? newest.period_to : null });
    }
    const q = String(query.get('q') || '').toLowerCase().trim();
    const nameOf = (f) => (S.accts.find((a) => a.account_id === f.account_id) || {}).name || '';
    let match = inWin.filter((f) => !q || f.name.toLowerCase().includes(q) || nameOf(f).toLowerCase().includes(q) || (q.length >= 3 && MONTH_NAMES.some((m, i) => m.startsWith(q) && (Number(f.period_to.slice(5, 7)) === i + 1 || Number(f.period_from.slice(5, 7)) === i + 1))));
    match = match.sort((x, y) => y.period_to.localeCompare(x.period_to) || y.seq - x.seq);
    const limit = query.get('limit') ? Number(query.get('limit')) : match.length, after = query.get('after');
    const from = after ? match.findIndex((f) => f.id === after) + 1 : 0, page = match.slice(from, from + limit);
    S.maxFiles = Math.max(S.maxFiles, page.length);
    return { currency: 'INR', months, accounts: S.accts, cells, files: page.map((f) => Object.assign({}, f, { text: undefined, sha: undefined })), total: match.length, next: from + limit < match.length ? page[page.length - 1].id : null, older: S.files.length - inWin.length };
  };
  return S;
}
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
  const threw = [];

  async function open(S, opts) {
    const accts = (opts && opts.accts) || S.accts, chart = [ACCOUNTS[0]].concat(accts.map((a) => ({ code: a.code, name: a.name, is_group: false, role: 'bank', parent_code: 'G-BANK', active: true })));
    const ctx = await b.newContext({ viewport: { width: 1366, height: 768 }, locale: 'en-AU', timezoneId: 'Australia/Sydney', serviceWorkers: 'block' });
    await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
    await ctx.clock.setFixedTime(new Date('2026-11-16T10:00:00+11:00')); /* ONE today for every walk */
    ctx.on('request', (rq) => { S.reqs.push({ m: rq.method(), u: rq.url(), h: rq.headers(), d: rq.postData() || '' }); });
    await ctx.route('**/api/**', (r0) => { const r = C.wrap(r0);
      const u = new URL(r.request().url()), p = u.pathname, m = r.request().method();
      if (p === '/api/entities/me') return json(r, 200, { entity: { display_name: 'Mayur Bhavan', currency_code: 'INR', ledger_on: true } });
      if (p === '/api/books/health') return json(r, 200, Object.assign(books.health(), { year: { fiscal_year: '2026-27', from: '2026-07-01', start_month: 7 }, country: books.csStatus('AU', 'Australia') })); /* the shop's year and country, as the page reads them */
      if (p === '/api/books/todo') return json(r, 200, []);
      if (p === '/api/books/accounts') return json(r, 200, { accounts: chart.map((a) => Object.assign({ account_id: 'acc-' + a.code, tally_group: 'Group', nature: 'asset', active: true }, a)) });
      if (p === '/api/books/dues') return json(r, 200, books.dues([]));
      if (p === '/api/books/bank/log') return json(r, 200, { currency: 'INR', account: { account_id: 'acc-1500', code: '1500', name: 'Bank' }, marks: [], statements: S.signedBy ? S.signedBy[u.searchParams.get('account')] || [] : S.signed, posted: [], exceptions: [] });
      if (p === '/api/books/bank/rail') return json(r, 200, { currency: 'INR', from: u.searchParams.get('from'), to: u.searchParams.get('to'), me: 'Mayur Bhavan', books: { parties: [], open_items: [] }, rail_chits: [], parties: [], may: { ask: { ok: true } } });
      if (p === '/api/books/ledger/1500') { S.ledgerCalls.push(u.search); return json(r, 200, books.ledger('1500', 'Bank', [], { from: u.searchParams.get('from'), to: u.searchParams.get('to'), opening_minor: 10000000, closing_minor: 10000000 })); }
      if (p === '/api/books/periods' && m === 'GET') return json(r, 200, books.periods([]));
      if (p === '/api/books/events' && m === 'GET') return json(r, 200, books.eventsAnswer({ events: [], picks: {} }));
      if (p === '/api/books/bank/statement-files' && S.pending) return json(r, 503, { code: 'BOOKS_NOT_MIGRATED', error: 'The statements box arrives after the next update.', message: 'The statements box arrives after the next update.', detail: 'The statements box arrives after the next update.' });
      if (p === '/api/books/bank/statement-files' && m === 'GET') return json(r, 200, S.list(u.searchParams));
      if (p === '/api/books/bank/statement-files' && m === 'POST') {
        const body = r.request().postDataJSON(); S.posts.push(body);
        const same = S.files.find((f) => f.sha === body.sha256);
        if (same) return json(r, 409, { code: 'ALREADY_IN_BOX', error: 'Already in the box: this file is kept for 1 Sep 2026 to 25 Sep 2026.', message: 'Already in the box: this file is kept for 1 Sep 2026 to 25 Sep 2026.', detail: 'Already in the box: this file is kept for 1 Sep 2026 to 25 Sep 2026.' });
        const crossed = S.files.filter((f) => f.period_from <= body.period_to && f.period_to >= body.period_from);
        const file = { id: 'f' + (S.files.length + 1), account_id: 'acc-1500', label: body.label || null, period_from: body.period_from, period_to: body.period_to, currency: body.currency, name: body.name, size: body.text.length, mime: 'text/csv', kind: 'bank_statement', source: 'owner', overlaps: crossed.length > 0, by_name: 'Mayur', by_firm: null, for_client: false, added_at: new Date().toISOString(), read_at: null, reads: 0, text: body.text, sha: body.sha256 };
        S.files.push(file);
        return json(r, 201, { file: Object.assign({}, file, { text: undefined, sha: undefined }), overlaps: crossed.map((f) => ({ id: f.id, name: f.name, period_from: f.period_from, period_to: f.period_to })), words: crossed.length ? 'Kept. It overlaps 1 other statement of this account (1 Sep 2026 to 25 Sep 2026). Both are shown.' : 'Kept.' });
      }
      const file = /^\/api\/books\/bank\/statement-files\/([^/]+)\/file$/.exec(p);
      if (file) { const found = S.files.find((f) => f.id === file[1]); S.reads.push({ id: file[1], use: u.searchParams.get('use'), h: r.request().headers() }); return found ? r.fulfill({ status: 200, headers: { 'content-type': 'application/octet-stream', 'x-content-type-options': 'nosniff', 'cache-control': 'private, no-store' }, body: found.text }) : json(r, 404, { code: 'NOT_FOUND', error: 'Not found', message: 'No such statement in this shop.' }); }
      return json(r, 200, {});
    });
    await ctx.addInitScript((s) => { try { if (!localStorage.getItem('cb_seeded')) { localStorage.setItem('cb_seeded', '1'); localStorage.setItem('cb_sess', JSON.stringify(s)); } } catch (_) {} }, (opts && opts.session) || AU);
    const p = await ctx.newPage();
    p.on('pageerror', (e) => { threw.push(e.message); if (process.env.DEBUG_PE) console.log('  !! pageerror: ' + e.message); });
    await p.goto(base + '/accounts.html#bank');
    await p.waitForSelector('[data-testid="bank-file"]', { timeout: 15000, state: 'attached' });
    return { ctx, p };
  }
  const SEPAUG = SEP.replace(/\/09\/26/g, '/08/26').replace('25/08/26', '29/08/26');
  const row = (id, from, to, name, text) => ({ id, account_id: 'acc-1500', label: null, period_from: from, period_to: to, currency: 'INR', name, size: text.length, mime: 'text/csv', kind: 'bank_statement', source: 'owner', overlaps: false, by_name: 'Mayur', by_firm: null, for_client: false, added_at: to + 'T00:00:00Z', read_at: null, reads: 0, text, sha: sha(text) });
  const S = stand();
  S.signed = [{ period_from: '2026-08-01', period_to: '2026-08-29', at: '2026-09-02T01:00:00Z', by_name: 'Mayur', difference_minor: 0, tied: true, currency: 'INR' }];
  S.files.push(row('f1', '2026-08-01', '2026-08-29', 'aug.csv', SEPAUG), row('f2', '2026-09-01', '2026-09-25', 'sep.csv', SEP));
  const { ctx, p } = await open(S);
  const shot = (name) => p.screenshot({ path: path.join(SHOTS, name) });
  const fits = () => p.evaluate(() => document.querySelector('.main').scrollHeight <= document.querySelector('.main').clientHeight + 2 && document.documentElement.scrollWidth <= document.documentElement.clientWidth);
  const text = (sel) => p.textContent(sel);
  const trail = '[data-testid="bank-home-trail"]', grid = '[data-testid="bank-stmts-grid"]', lines = '[data-testid="bank-list"].cbl [data-status]', sepCell = '[data-testid="bank-home-month-acc-1500-2026-09"]';
  /* 1 */
  await p.waitForSelector(grid, { timeout: 10000 });
  await p.waitForSelector('[data-testid="bank-home-card-acc-1500-2026-09"]');
  ok(/✓/.test(await text('[data-testid="bank-stmts-have-acc-1500-2026-08"]')) && /●/.test(await text('[data-testid="bank-stmts-have-acc-1500-2026-09"]')) && (await p.locator('.bks-miss').count()) === 2 && (await p.locator('.bkh-future').count()) === 8 && (await p.locator('[data-testid="bank-stmts-current-acc-1500-2026-11"]').count()) === 1, 'home: FY 2026-27, Aug ✓ signed off, Sep ● not signed off, Jul and Oct Missing, Nov (16 Nov) Not due yet, the seven months to come are not Missing (miss ' + (await p.locator('.bks-miss').count()) + ', to come ' + (await p.locator('.bkh-future').count()) + ', head ' + (await text('.bks-grid thead')).replace(/\s+/g, ' ') + ')');
  ok(/September 2026/.test(await text('[data-testid="bank-home-cards"]')) && /Continue/.test(await text('[data-testid="bank-home-cards"]')) && (await p.locator('[data-testid="bank-home-card-acc-1500-2026-08"]').count()) === 0, 'one card, for September only, with Continue');
  ok((await p.locator(trail).count()) === 0 && !(await p.locator('[data-testid="bank-form"]').isVisible()), 'the home has no trail and the plain picker form is folded away');
  ok(await fits(), '1366: the home needs no page scroll and nothing scrolls sideways');
  await shot('01-home-1366.png');
  /* 2 */
  await p.click(sepCell);
  await p.waitForSelector(lines, { timeout: 10000 });
  ok(/Bank/.test(await text(trail)) && /September 2026/.test(await text(trail)), 'lines: the trail reads ' + (await text(trail)).replace(/\s+/g, ' ').trim());
  ok(/#bank\/1500\/2026-09/.test(await p.evaluate(() => location.hash)), 'the address names the statement (#bank/1500/2026-09)');
  ok((await p.locator('[data-testid="bank-stmts-toggle"]').count()) === 0, 'no "Add statement" toggle over the lines');
  ok(await fits(), '1366: the lines with the trail need no page scroll');
  console.log('  GEOM ' + JSON.stringify(await p.evaluate(() => ['.content', '#bk_body', '.pe-bank', '#bk_stmts', '.bkh-trail', '#bk_res', '[data-testid="bank-list"]'].map((q) => { const n = document.querySelector(q); if (!n) return q; const r = n.getBoundingClientRect(); return q + ' top ' + Math.round(r.top) + ' h ' + Math.round(r.height) + ' mb ' + getComputedStyle(n).marginBottom + ' pt ' + getComputedStyle(n).paddingTop; }))));
  await shot('02-lines-1366.png');
  await p.click('[data-testid="bank-home-back"]');
  await p.waitForSelector(grid);
  ok(!(await p.evaluate(() => location.hash)).includes('/') && (await p.locator('[data-testid="bank-list"]').count()) === 0, 'Back returns to the home (#bank, no lines)');
  await shot('03-back-home-1366.png');
  await p.click('[data-testid="bank-home-continue"]');
  await p.waitForSelector(lines, { timeout: 10000 });
  await p.goBack();
  await p.waitForSelector(grid);
  ok((await p.locator('[data-testid="bank-list"]').count()) === 0, "the browser's Back does the same (Continue opened the same lines first)");
  await p.goForward();
  await p.waitForSelector(lines, { timeout: 10000 });
  ok((await p.locator(trail).count()) === 1, "the browser's Forward opens the lines again");
  /* 3 */
  await p.click('[data-testid="acc-nav-bank"]');
  await p.waitForSelector(grid, { timeout: 10000 });
  ok((await p.locator('[data-testid="bank-list"]').count()) === 0 && (await p.locator(trail).count()) === 0, 'menu Bank from the lines lands on the home, not on the last statement');
  await shot('04-menu-bank-home-1366.png');
  /* 4 · keyboard only */
  await p.focus(sepCell);
  await p.keyboard.press('Enter');
  await p.waitForSelector('[data-testid="bank-home-back"]', { timeout: 10000 });
  await p.focus('[data-testid="bank-home-back"]');
  ok((await p.evaluate(() => document.activeElement.getAttribute('data-testid'))) === 'bank-home-back', 'keyboard: the Back control takes focus');
  await p.keyboard.press('Enter');
  await p.waitForSelector(grid);
  await p.waitForTimeout(300);
  ok(await p.evaluate(() => /bkh-cell|bkh-go|bks-tog/.test(document.activeElement.className)), "keyboard: after Back focus lands on the home's first press");
  /* 4b · a reload or a bookmark on #bank/<account>/<month> reopens that statement (the router read the whole hash as a page name and fell to To do) */
  await p.goto(base + '/accounts.html#bank/1500/2026-09');
  await p.waitForSelector(lines, { timeout: 15000 });
  ok(/September 2026/.test(await text(trail)) && /#bank\/1500\/2026-09/.test(await p.evaluate(() => location.hash)), 'a reload on #bank/1500/2026-09 reopens that account and month, not To do');
  await p.goto(base + '/accounts.html#bank/1500/2026-01');
  await p.waitForSelector(grid, { timeout: 15000 });
  ok((await p.locator(lines).count()) === 0 && /^#bank/.test(await p.evaluate(() => location.hash)), 'a month with no statement kept lands on the Bank home');
  /* 4c · Enter on Add statement keeps the keyboard on that button, opening the box or closing it */
  const tog = '[data-testid="bank-stmts-toggle"]', focusedTog = () => p.evaluate(() => document.activeElement && document.activeElement.getAttribute('data-testid'));
  await p.focus(tog);
  await p.keyboard.press('Enter');
  await p.waitForTimeout(200);
  ok((await focusedTog()) === 'bank-stmts-toggle', 'Enter on Add statement: focus stays on Add statement (' + (await focusedTog()) + ')');
  await p.keyboard.press('Enter');
  await p.waitForTimeout(200);
  ok((await focusedTog()) === 'bank-stmts-toggle', 'Enter again, to close the open box: focus stays on the button (' + (await focusedTog()) + ')');
  /* 5 · phone */
  await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(400);
  ok(await fits(), '390: the home needs no page scroll and nothing scrolls sideways');
  await shot('05-home-390.png');
  await p.click(sepCell);
  await p.waitForSelector(trail, { timeout: 10000 }); await p.waitForTimeout(500);
  ok(await fits(), '390: the lines with the trail: no page scroll, nothing sideways');
  await shot('06-lines-390.png');
  await p.click('[data-testid="bank-home-back"]');
  await p.waitForSelector(grid);
  await shot('07-back-home-390.png');
  /* ══ W15-100 · THE SCALE SEED: 10 accounts × 120 months of kept files (Athi 16 Nov: "100s of months and statements, the latest on top") ══ */
  async function scale() {
    const accts = Array.from({ length: 10 }, (_, n) => ACC(n + 1));
    const files = [];
    const pad = (n) => String(n).padStart(2, '0');
    let seq = 0;
    for (let k = 0; k < 120; k++) { /* 2016-11 … 2026-10: the newest statement is October 2026 */
      const month = monthsEnding('2026-10', 120)[k];
      for (const a of accts) {
        if (a.code === '1500' && (month === '2026-04' || month === '2026-05')) continue; /* two gaps in FY 2025-26 */
        seq += 1;
        files.push(fileOf('f' + seq, a, month + '-01', lastDay(month), 'stmt-' + a.code + '-' + month + '.csv', seq));
      }
    }
    seq += 1;
    files.push(Object.assign(fileOf('fx' + seq, accts[0], '2026-09-20', '2026-10-10', 'cross-1500.csv', seq), { overlaps: true })); /* a file crossing Sep and Oct */
    const S2 = Object.assign(stand(), { files, accts, signedBy: {} });
    S2.signedBy['1500'] = monthsEnding('2026-03', 9).map((month) => ({ period_from: month + '-01', period_to: lastDay(month), at: '2026-09-02T01:00:00Z', by_name: 'Mayur', difference_minor: 0, tied: true, currency: 'INR' })); /* 2025-07 … 2026-03 signed off */
    const { ctx, p } = await open(S2, { accts, session: AU });
    const view = (w, h) => p.setViewportSize({ width: w, height: h }).then(() => p.waitForTimeout(350));
    const fitsNow = async () => { const r = await p.evaluate(() => { const m = document.querySelector('.main'); return { h: m.scrollHeight, c: m.clientHeight, w: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }; }); const good = r.h <= r.c + 2 && r.w <= r.cw; if (!good) console.log('  FIT ' + JSON.stringify(r) + ' ' + JSON.stringify(await p.evaluate(() => ['#bk_stmts', '.bkh-body', '.pe-bank', '#bk_body', '.content', '.main', '#bk_res', '[data-testid="bank-form"]', '#bk_out'].map((q) => { const n = document.querySelector(q); return n ? q + ' h' + Math.round(n.getBoundingClientRect().height) + ' sh' + n.scrollHeight + ' top' + Math.round(n.getBoundingClientRect().top) : q; })))); return good; };
    const clipped = () => p.evaluate(() => Array.from(document.querySelectorAll('.bks-grid td button, .bks-grid td span.bks-sum, .bks-grid td')).filter((n) => n.scrollWidth > n.clientWidth + 1).map((n) => n.getAttribute('data-testid') || n.tagName).slice(0, 5));
    const fyNow = () => p.textContent('[data-testid="bank-home-fy-now"]');
    const retention = await p.evaluate(() => Number((shopReg() || {}).retentionYears || 0));
    await p.waitForSelector('[data-testid="bank-home-fy-now"]', { timeout: 15000 });
    ok(retention > 0, 'the AU pack states the record-keeping years: ' + retention);
    /* 1 · one year, the one holding the newest statement */
    ok(/FY 2026-27/.test(await fyNow()), 'the year opens on the one holding the newest statement: ' + (await fyNow()));
    const logs = S2.reqs.filter((r) => /bank\/log/.test(r.u));
    ok(logs.length === 10 && logs.every((r) => /marks_limit=0/.test(r.u) && new RegExp('from=' + (2026 - (retention - 1)) + '-07-01').test(r.u) && /to=2027-06-30/.test(r.u)), 'the Bank home asks for the sign-offs only: no marks, ' + retention + ' years (from the first day of the oldest year), once per account (' + logs.length + ')');
    ok((await p.locator('.bks-grid thead th').count()) === 14, 'one year: twelve months across (plus the account and the year count)');
    const first = S2.reqs.filter((r) => /statement-files/.test(r.u) && r.m === 'GET')[0];
    ok(first && /months=12/.test(first.u) && /to=2027-06/.test(first.u) && /limit=25/.test(first.u), 'the box is read for ONE year and ONE page: ' + (first && first.u.replace(/^.*\/api/, '')));
    ok((await p.locator('.bks-grid tbody tr').count()) === 10, 'ten accounts, ten rows');
    await shot2('10-fy-1366.png');
    /* 2 · the year step: tallies */
    await p.click('[data-testid="bank-home-fy-prev"]');
    await p.waitForFunction(() => /FY 2025-26/.test(document.querySelector('[data-testid="bank-home-fy-now"]').textContent));
    ok(/^9 ✓ · 1 ● · 2 missing$/.test((await p.textContent('[data-testid="bank-home-tally-acc-1500"]')).trim()), 'the row ends with the year: ' + (await p.textContent('[data-testid="bank-home-tally-acc-1500"]')).trim());
    ok(/^0 ✓ · 12 ● · 0 missing$/.test((await p.textContent('[data-testid="bank-home-tally-acc-1501"]')).trim()), 'an account with every month kept and none signed: 0 ✓ · 12 ● · 0 missing');
    ok((await p.evaluate(() => document.activeElement.getAttribute('data-testid'))) === 'bank-home-fy-prev', 'keyboard: after the step focus stays on the press used');
    await shot2('11-fy-prev-1366.png');
    /* 3 · cards: newest three, then "and n more" */
    await p.click('[data-testid="bank-home-fy-next"]');
    await p.waitForFunction(() => /FY 2026-27/.test(document.querySelector('[data-testid="bank-home-fy-now"]').textContent));
    const cards = await p.locator('[data-testid^="bank-home-card-"]').count();
    ok(cards === 3 && /and \d+ more/.test(await p.textContent('[data-testid="bank-home-more"]')), 'the unfinished months: the newest three cards, then ' + (await p.textContent('[data-testid="bank-home-more"]')));
    ok(/October 2026/.test(await p.textContent('[data-testid^="bank-home-card-"]')), 'newest first: the top card is October 2026');
    await shot2('12-cards-1366.png');
    await p.click('[data-testid="bank-home-more"]');
    const all = await p.locator('[data-testid^="bank-home-card-"]').count();
    ok(all > 3 && /Show fewer/.test(await p.textContent('[data-testid="bank-home-more"]')) && (await fitsNow()), 'and n more opens the whole list (' + all + ' unfinished months) inside its own box; the page still fits');
    await shot2('13-cards-all-1366.png');
    await p.click('[data-testid="bank-home-more"]');
    ok((await p.locator('[data-testid^="bank-home-card-"]').count()) === 3, 'Show fewer folds it back to three');
    /* 4 · overlap sits inside its cell (W15-99) */
    const ov = await p.evaluate(() => {
      const flag = document.querySelector('[data-testid="bank-stmts-cross-acc-1500-2026-10"]'), cell = flag && flag.closest('td'), next = cell && cell.nextElementSibling;
      if (!flag) return null;
      const a = flag.getBoundingClientRect(), c = cell.getBoundingClientRect(), n = next.getBoundingClientRect();
      return { inside: a.left >= c.left - 0.5 && a.right <= c.right + 0.5 && a.top >= c.top - 0.5 && a.bottom <= c.bottom + 0.5, overNext: a.right > n.left + 0.5, count: cell.querySelector('.bkh-cell').textContent.trim() };
    });
    ok(ov && ov.inside && !ov.overNext && /2/.test(ov.count), 'two statements in October: "' + (ov && ov.count) + '" with the ⚠ inside the cell, nothing over November');
    ok((await clipped()).length === 0, '1366: no cell clips its words ' + JSON.stringify(await clipped()));
    ok(await fitsNow(), '1366: ten accounts × ten years: no page scroll, nothing sideways');
    /* 5 · the kept files: newest on top, 25 a page, searched, the server does it */
    await p.click('[data-testid="bank-stmts-filesbox"] summary');
    await p.waitForSelector('[data-testid^="bank-stmts-file-"]', { timeout: 10000 });
    const page1 = await p.locator('[data-testid^="bank-stmts-file-"]').count();
    ok(page1 === 25 && /1–25 of 41/.test(await p.textContent('[data-testid="bank-stmts-pageof"]')), 'kept files: 25 on a page, "' + (await p.textContent('[data-testid="bank-stmts-pageof"]')).trim() + '"');
    const topId = await p.locator('[data-testid^="bank-stmts-file-"]').first().getAttribute('data-testid');
    ok(/stmt-1509-2026-10/.test(await p.locator('[data-testid^="bank-stmts-file-"]').first().textContent()), 'newest on top: the first row is ' + (await p.locator('[data-testid^="bank-stmts-file-"]').first().textContent()).replace(/\s+/g, ' ').slice(0, 80));
    ok(await fitsNow(), '1366: the files list open: no page scroll');
    ok(await p.evaluate(() => { const n = document.querySelector('[data-testid="bank-stmts-next"]'), r = n.getBoundingClientRect(), hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!hit && (hit === n || n.contains(hit)); }), '1366: Previous and Next are on screen');
    await shot2('14-files-1366.png');
    await p.focus('[data-testid="bank-stmts-next"]');
    await p.keyboard.press('Enter');
    await p.waitForFunction(() => /26–41 of 41/.test((document.querySelector('[data-testid="bank-stmts-pageof"]') || {}).textContent || ''));
    ok(S2.reqs.some((r) => /after=/.test(r.u)), 'keyboard: Next reads the next page from the server (a cursor, not a skip count)');
    await p.focus('[data-testid="bank-stmts-prev"]');
    await p.keyboard.press('Enter');
    await p.waitForFunction(() => /1–25 of/.test((document.querySelector('[data-testid="bank-stmts-pageof"]') || {}).textContent || ''));
    const box = p.locator('[data-testid="bank-stmts-files"] input[type="search"], [data-testid="bank-stmts-files"] input').first();
    await box.fill('Account 3');
    await p.waitForFunction(() => /1–4 of 4\b/.test((document.querySelector('[data-testid="bank-stmts-pageof"]') || {}).textContent || ''), null, { timeout: 8000 });
    ok(S2.reqs.some((r) => /[?&]q=Account(\+|%20)3/.test(r.u)), 'search: "Account 3" goes to the server (q=Account 3) and answers its 4 files of the year (July to October)');
    await box.fill('');
    await box.fill('stmt-1500-2026-08');
    await p.waitForFunction(() => /1–1 of 1\b/.test((document.querySelector('[data-testid="bank-stmts-pageof"]') || {}).textContent || ''), null, { timeout: 8000 });
    ok(true, 'search by file name finds the one file');
    await box.fill('');
    await p.waitForFunction(() => /1–25 of 41/.test((document.querySelector('[data-testid="bank-stmts-pageof"]') || {}).textContent || ''), null, { timeout: 8000 });
    const big = S2.reqs.filter((r) => /statement-files/.test(r.u) && r.m === 'GET' && !/limit=(25|1)\b/.test(r.u));
    ok(big.length === 0 && S2.maxFiles <= 25, 'never the whole box: every read asked for at most one year and one page of 25 (largest answer ' + S2.maxFiles + ' files)');
    /* 6 · All years: one row per year the pack says to keep */
    await p.click('[data-testid="bank-stmts-filesbox"] summary');
    await p.click('[data-testid="bank-home-fy-all"]');
    await p.waitForSelector('[data-testid^="bank-home-all-"]', { timeout: 10000 });
    const rows = await p.locator('[data-testid^="bank-home-all-"]').count();
    ok(rows === retention, 'All years: one row per year to keep records for (' + rows + ' = ' + retention + '), "' + (await p.locator('[data-testid^="bank-home-all-"]').first().textContent()).trim() + '"');
    ok(/FY 2026-27/.test(await p.locator('[data-testid^="bank-home-all-"]').first().textContent()), 'newest year on top');
    ok(await fitsNow() && (await clipped()).length === 0, '1366: All years fits');
    await shot2('15-allyears-1366.png');
    await p.locator('.bkh-allrow').nth(1).click();
    await p.waitForFunction(() => /FY 2025-26/.test(document.querySelector('[data-testid="bank-home-fy-now"]').textContent));
    ok(true, 'a year row opens that year');
    /* 7 · the stepper reaches back exactly the record-keeping years, then stops */
    let steps = 0;
    while (await p.locator('[data-testid="bank-home-fy-prev"]').isEnabled()) { await p.click('[data-testid="bank-home-fy-prev"]'); await p.waitForTimeout(60); steps += 1; if (steps > 20) break; }
    ok(steps === retention - 2, 'the stepper stops at the oldest year to keep (' + (steps + 2) + ' years back = ' + retention + ')');
    for (let n = 0; n < steps + 1; n++) await p.click('[data-testid="bank-home-fy-next"]');
    /* 8 · the phone */
    await view(390, 844);
    ok(await fitsNow(), '390: the home with ten accounts needs no page scroll and nothing sideways');
    ok((await clipped()).length === 0, '390: no cell clips its words ' + JSON.stringify(await clipped()));
    await shot2('20-home-390.png');
    await p.click('[data-testid="bank-home-fy-prev"]');
    await p.waitForTimeout(300);
    await shot2('21-fy-prev-390.png');
    await p.click('[data-testid="bank-home-fy-next"]');
    await p.waitForTimeout(300);
    const cards390 = await p.locator('[data-testid^="bank-home-card-"]').count();
    ok(cards390 === 3, '390: three cards, then "and n more"');
    await shot2('22-cards-390.png');
    await p.click('[data-testid="bank-stmts-filesbox"] summary');
    await p.waitForSelector('[data-testid^="bank-stmts-file-"]', { timeout: 10000 });
    ok(await fitsNow(), '390: the files list open: no page scroll');
    const card = await p.evaluate(() => {
      const row = document.querySelector('[data-testid^="bank-stmts-file-"]'), l1 = row && row.querySelector('.bkf-l1'), l2 = row && row.querySelector('.bkf-l2'), r = row && row.querySelector('[data-testid="bank-stmts-read"]');
      if (!row || !l1 || !l2 || !r) return null;
      const a = l1.getBoundingClientRect(), b = l2.getBoundingClientRect(), c = r.getBoundingClientRect();
      return { two: b.top >= a.bottom - 1, icon: c.width >= 24 && c.height >= 24, label: !!r.getAttribute('aria-label'), clip: l2.scrollWidth > l2.clientWidth ? 'cut' : 'whole', text: l1.textContent.trim() + ' / ' + l2.textContent.trim() };
    });
    ok(card && card.two && card.icon && card.label, '390: each file is two lines, "Account · month" with Read and Download as icon presses (24 px or more, labelled): ' + (card && card.text));
    const pg = await p.evaluate(() => { const n = document.querySelector('[data-testid="bank-stmts-next"]'); if (!n) return null; const r = n.getBoundingClientRect(), hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2), b = document.querySelector('.bkh-body').getBoundingClientRect(); return { in: !!hit && (hit === n || n.contains(hit)), r: [Math.round(r.top), Math.round(r.bottom)], body: [Math.round(b.top), Math.round(b.bottom)] }; });
    ok(pg && pg.in, '390: Previous and Next are on screen without scrolling the page ' + JSON.stringify(pg));
    const head = (await p.textContent('[data-testid="bank-stmts-sum"]')).trim();
    ok(/^Oct ✓ · (\d+ missing|Every month is kept)$/.test(head) && (await p.evaluate(() => { const n = document.querySelector('[data-testid="bank-stmts-sum"]'); return n.scrollWidth <= n.clientWidth; })), '390: the header line reads whole, not clipped: "' + head + '"');
    await shot2('23-files-390.png');
    await p.click('[data-testid="bank-stmts-filesbox"] summary');
    await p.click('[data-testid="bank-home-fy-all"]');
    await p.waitForSelector('[data-testid^="bank-home-all-"]', { timeout: 10000 });
    ok(await fitsNow(), '390: All years fits');
    await shot2('24-allyears-390.png');
    await ctx.close();
    async function shot2(name) { await p.screenshot({ path: path.join(SHOTS, name) }); }
  }
  await scale();

  ok(...C.finish());

  ok(threw.length === 0, 'no page error' + (threw.length ? ': ' + threw[0] : ''));
  await b.close(); srv.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
