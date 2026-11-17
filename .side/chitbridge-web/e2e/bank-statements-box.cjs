/* bank-statements-box.cjs — THE STATEMENTS BOX OF THE BANK PAGE (l16, W15-51; app/cap-bank-statements.js; api b872).
 * Pattern: bank-recon-page.cjs — Playwright, a stand-in API answering INSIDE the page (stateful for the box), a free port for the static server; nothing leaves the machine.
 *
 *  1  the box opens on a bare Bank page: the account × month grid reads "Oct missing" style gaps; the new copy line is there; the plain picker keeps its device-only sentence
 *  2  Add statement: the account is required, the file is required; the period comes from the reader (CBBankRecon.parse), the POST carries the sha256 of the UTF-8 text (ONE hash) and the text, nothing else
 *  3  the month fills (✓ 1); the same file again is refused in the server's words ("Already in the box"); a file that is not a statement is refused before anything is sent
 *  4  an overlapping file says so (the server's words) and the cell flags it
 *  5  Read loads a kept file into the ONE reader (bankTake): the lines are matched as for a picked file, the box folds
 *  6  before the SQL runs (503): the box says so in words, the plain picker still works
 *  7  1366×768: nothing scrolls sideways; every new control wears its id; no page error
 * Screenshots: e2e/shots/stmts-{box,filled,read,pending}-laptop.png
 */
'use strict';
const { chromium } = require('@playwright/test');
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const ROOT = path.join(__dirname, '..'), PUB = path.join(ROOT, 'public'), SHOTS = path.join(__dirname, 'shots');
const T = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok  ' + m); } else { fail++; console.log('  XX  ' + m); } };
const books = require('./lib/books-api.cjs');
const C = require('./lib/contract.cjs');   /* every stand-in answer for a contract route is held to the API's shape (M43) */
const json = (r, status, o) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(o) });
const tok = (c) => { const e = (o) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_'); return e({ alg: 'none' }) + '.' + e(Object.assign({ exp: Math.floor(Date.now() / 1000) + 86400 }, c)); };
const OWNER = { token: tok({ identity_id: 'ent-M', identity_type: 'entity' }), role: 'entity', name: 'Mayur', entity: 'Mayur Bhavan' };

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

/** the box's stand-in: what the api answers, in its shapes (lib/bank-statement-file.js); stateful so Add then list reads back */
function stand(pending) {
  const S = { reqs: [], posts: [], reads: [], files: [], pending: !!pending, ledgerCalls: [] };
  S.list = (query) => {
    const months = monthsEnding(query.get('to') || '2026-11', Number(query.get('months') || 6));
    const account = { account_id: 'acc-1500', code: '1500', name: 'Bank', label: (S.files[0] || {}).label || null };
    const cells = months.map((month) => { const here = S.files.filter((f) => f.period_from <= lastDay(month) && f.period_to >= month + '-01'), newest = here.slice().sort((x, y) => y.period_to.localeCompare(x.period_to))[0]; return { account_id: 'acc-1500', month, missing: !here.length, file_ids: here.map((f) => f.id), overlaps: here.some((f) => f.overlaps), newest_id: newest ? newest.id : null, newest_name: newest ? newest.name : null, newest_to: newest ? newest.period_to : null }; });
    const win = S.files.filter((f) => f.period_from <= lastDay(months[months.length - 1]) && f.period_to >= months[0] + '-01'), page = win.slice().sort((x, y) => y.period_to.localeCompare(x.period_to)).slice(0, Number(query.get('limit') || 25));
    return { currency: 'INR', months, accounts: [account], cells, files: page.map((f) => Object.assign({}, f, { text: undefined, sha: undefined })), total: win.length, next: null, older: S.files.length - win.length };
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

  async function open(S) {
    const ctx = await b.newContext({ viewport: { width: 1366, height: 768 }, locale: 'en-AU', timezoneId: 'Australia/Sydney', serviceWorkers: 'block' });
    await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
    await ctx.clock.setFixedTime(new Date('2026-11-16T10:00:00+11:00')); /* ONE today */
    ctx.on('request', (rq) => { S.reqs.push({ m: rq.method(), u: rq.url(), h: rq.headers(), d: rq.postData() || '' }); });
    await ctx.route('**/api/**', (r0) => { const r = C.wrap(r0);
      const u = new URL(r.request().url()), p = u.pathname, m = r.request().method();
      if (p === '/api/entities/me') return json(r, 200, { entity: { display_name: 'Mayur Bhavan', currency_code: 'INR', ledger_on: true } });
      if (p === '/api/books/health') return json(r, 200, Object.assign(books.health(), { year: { fiscal_year: '2026-27', from: '2026-07-01', start_month: 7 }, country: books.csStatus('AU', 'Australia') })); /* the shop's year (July to June) */
      if (p === '/api/books/todo') return json(r, 200, []);
      if (p === '/api/books/accounts') return json(r, 200, { accounts: ACCOUNTS.map((a) => Object.assign({ account_id: 'acc-' + a.code, tally_group: 'Group', nature: 'asset', active: true }, a)) });
      if (p === '/api/books/dues') return json(r, 200, books.dues([]));
      if (p === '/api/books/bank/log') return json(r, 200, { currency: 'INR', account: { account_id: 'acc-1500', code: '1500', name: 'Bank' }, marks: [], statements: [], posted: [], exceptions: [] });
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
    await ctx.addInitScript((s) => { try { if (!localStorage.getItem('cb_seeded')) { localStorage.setItem('cb_seeded', '1'); localStorage.setItem('cb_sess', JSON.stringify(s)); } } catch (_) {} }, OWNER);
    const p = await ctx.newPage();
    p.on('pageerror', (e) => { threw.push(e.message); if (process.env.DEBUG_PE) console.log('  !! pageerror: ' + e.message); });
    await p.goto(base + '/accounts.html#bank');
    await p.waitForSelector('[data-testid="bank-file"]', { timeout: 15000, state: 'attached' });
    return { ctx, p };
  }
  const pick = (p, name, text) => p.setInputFiles('[data-testid="bank-stmts-file"]', { name, mimeType: 'text/csv', buffer: Buffer.from(text) });
  const sideways = (p) => p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth && document.querySelector('.main').scrollWidth <= document.querySelector('.main').clientWidth);

  /* ── 1 · THE BOX ON A BARE PAGE ── */
  const S = stand(), { ctx, p } = await open(S);
  await p.waitForSelector('[data-testid="bank-stmts-grid"]', { timeout: 10000 });
  const gaps = await p.locator('.bks-miss').count();
  ok(gaps === 5 && /Missing/.test(await p.textContent('.bks-grid')) && /Nov/.test(await p.textContent('.bks-grid')), 'the grid: one account, the year July to June, July to November read "Missing", the months to come do not (' + gaps + ')');
  ok(/Nothing kept yet/.test(await p.textContent('[data-testid="bank-stmts-sum"]')), 'the summary says so: "Nothing kept yet"');
  ok(/Kept on our server for the record period; visible to the accountant or auditor you give access\./.test(await p.textContent('[data-testid="bank-stmts-kept"]')), 'the box says, in its own line, where the file is kept and who sees it');
  /* W15-62: ONE door - the plain picker's file field and its sentence step aside; the quiet secondary lives in the box */
  ok(!(await p.locator('label:has([data-testid="bank-file"])').isVisible()) && !(await p.isVisible('[data-testid="bank-private"]')) && await p.locator('[data-testid="bank-stmts-add-go"]').isVisible(), 'W15-62: one "Add statement" door - the old picker (and its "never uploaded" line) is not a second door');
  ok(/Just read a file, don't keep it/.test(await p.textContent('[data-testid="bank-stmts-justread"]')) && /Not sent to our server/.test(await p.textContent('[data-testid="bank-stmts-justread"]')), 'W15-62: the quiet choice says what it does');
  { const [fc] = await Promise.all([p.waitForEvent('filechooser', { timeout: 4000 }).catch(() => null), p.click('[data-testid="bank-stmts-justread-go"]')]); ok(!!fc, 'W15-62: it opens the file picker (the one reader of the page)'); }
  ok(await sideways(p), '1366 px: nothing scrolls sideways');
  await p.screenshot({ path: path.join(SHOTS, 'stmts-box-laptop.png') });
  await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(300);
  ok(await sideways(p) && await p.locator('[data-testid="bank-stmts-justread-go"]').isVisible(), 'W15-62 · 390x844: nothing scrolls sideways and the quiet "Just read a file" choice shows');
  await p.screenshot({ path: path.join(SHOTS, 'stmts-box-phone.png') });
  await p.setViewportSize({ width: 1366, height: 768 });

  /* ── 2 · ADD ── */
  await p.click('[data-testid="bank-stmts-add-go"]');
  ok(/Pick the statement file first/.test(await p.textContent('#bks_out')) && S.posts.length === 0, 'no file: asked for, nothing sent');
  await pick(p, 'not-a-statement.csv', 'hello\nthis is not a statement');
  await p.click('[data-testid="bank-stmts-add-go"]');
  await p.waitForSelector('#bks_out [data-testid="pe-refused"]');
  ok(S.posts.length === 0, 'a file that is not a statement is refused in words before anything is sent (' + (await p.textContent('#bks_out')).trim().slice(0, 60) + ')');
  await p.fill('[data-testid="bank-stmts-label"]', '..1234');
  await pick(p, 'sep.csv', SEP);
  await p.click('[data-testid="bank-stmts-add-go"]');
  await p.waitForSelector('[data-testid="bank-stmts-kept-say"]');
  const post = S.posts[0];
  ok(post && post.account === '1500' && post.period_from === '2026-09-01' && post.period_to === '2026-09-25', 'the POST names the account and the period the reader found (' + (post && post.account + ' ' + post.period_from + ' to ' + post.period_to) + ')');
  ok(post && post.sha256 === sha(SEP) && post.text === SEP && post.name === 'sep.csv' && post.currency === 'INR' && post.label === '..1234', 'the sha256 is of the UTF-8 text (the ONE hash), the text is the file, the currency the reader\'s or the ledger\'s');
  ok(post && Object.keys(post).sort().join() === 'account,currency,label,name,period_from,period_to,sha256,text', 'the body names nothing else (no who, no when, no source)');
  /* ── 3 · THE MONTH FILLS · A DUPLICATE ── */
  await p.waitForSelector('[data-testid="bank-stmts-have-acc-1500-2026-09"]');
  ok(/1/.test(await p.textContent('[data-testid="bank-stmts-have-acc-1500-2026-09"]')) && await p.locator('.bks-miss').count() === 4, 'September fills; four months are still missing');
  ok(/4 missing/.test(await p.textContent('[data-testid="bank-stmts-sum"]')), 'the summary follows: "4 missing"');
  await pick(p, 'sep-again.csv', SEP);
  await p.click('[data-testid="bank-stmts-add-go"]');
  await p.waitForSelector('#bks_out [data-testid="pe-refused"]');
  ok(/Already in the box/.test(await p.textContent('#bks_out')), 'the same file again is refused in the server\'s words: "Already in the box"');
  /* ── 4 · OVERLAP ── */
  await pick(p, 'cross.csv', CROSS);
  await p.click('[data-testid="bank-stmts-add-go"]');
  await p.waitForSelector('[data-testid="bank-stmts-kept-say"]');
  ok(/overlaps 1 other statement/.test(await p.textContent('#bks_out')) && await p.locator('.bks-flag').count() >= 1, 'a crossing file is kept, the answer says it overlaps, and the cell and the row carry the flag');
  await p.screenshot({ path: path.join(SHOTS, 'stmts-filled-laptop.png') });
  ok(await p.locator('[data-testid^="bank-stmts-file-"]').count() === 2, 'both files are listed with their period, name and who added');

  /* ── 5 · READ → THE ONE READER ── */
  const reads0 = S.reads.length;
  await p.click('[data-testid="bank-stmts-filesbox"] summary'); /* the kept files sit in a closed list on the home (W15-84) */
  await p.locator('[data-testid="bank-stmts-file-f1"] [data-testid="bank-stmts-read"]').click();
  await p.waitForSelector('[data-testid="bank-list"].cbl [data-status]', { timeout: 10000 });
  ok(S.reads.length === reads0 + 1 && S.reads[S.reads.length - 1].use === 'read' && !!S.reads[S.reads.length - 1].h.authorization, 'Read fetches the kept bytes with the seat\'s own headers (use=read)');
  ok(S.ledgerCalls.length >= 1 && /from=2026-09-01&to=2026-09-25/.test(S.ledgerCalls[S.ledgerCalls.length - 1]), 'the page\'s own reader took it: the ledger is read for the statement\'s dates (' + S.ledgerCalls[S.ledgerCalls.length - 1] + ')');
  ok(await p.locator('[data-testid="bank-stmts-grid"]').count() === 0 && await p.locator('[data-testid="bank-home-trail"]').count() === 1, 'the home gives way once a statement is on screen: the trail (← Bank) is all that is left of the box (W15-84)');
  await p.screenshot({ path: path.join(SHOTS, 'stmts-read-laptop.png') });
  const toBooks = S.reqs.filter((r) => r.m === 'POST' && /\/api\/books\/(events|payments|entries)/.test(r.u));
  ok(S.posts.length === 3 && toBooks.length === 0, 'nothing was posted to the books by Read (no entry, event or payment; only the three Add presses went to the box)' + (toBooks.length ? ' — ' + toBooks.map((r) => r.u).join(' ') : ''));
  /* ── 5b · W15-75 · a statement that does not carry the bank's closing balance: the box to type it is REACHABLE while a statement is on screen (it sat inside a form folded to display:none) ── */
  const NOBAL = SEP.split('\n').map((l, n) => (n === 0 ? l : l.replace(/,[^,]*$/, ''))).join('\n'); /* the same statement without its Closing Balance column */
  await p.setInputFiles('[data-testid="bank-file"]', { name: 'no-balance.csv', mimeType: 'text/csv', buffer: Buffer.from(NOBAL) });
  await p.waitForSelector('[data-testid="bank-bal-ask"], [data-testid="bank-currency"], .pe-bad', { timeout: 10000 }).catch(async () => { await p.screenshot({ path: path.join(SHOTS, 'stmts-nobal-debug.png') }); });
  if (await p.locator('[data-testid="bank-currency"]').isVisible()) { await p.fill('[data-testid="bank-currency"]', 'INR'); await p.click('[data-testid="bank-currency-go"]'); }
  await p.waitForSelector('[data-testid="bank-bal-ask"]', { timeout: 10000, state: 'attached' }).catch(() => {});
  const askVisible = await p.locator('#bk_bal_q').isVisible().catch(() => false);
  ok(askVisible, 'W15-75: "Type it from the statement" - the closing balance box is on screen, not hidden in the folded form');
  if (askVisible) { await p.fill('#bk_bal_q', '109016.40'); await p.click('[data-testid="bank-bal-quick-go"]'); await p.waitForTimeout(500); ok(await p.locator('[data-testid="bank-finish-ask"]').count() === 0, 'W15-75: typing it in the band and pressing Show the difference works (the ask is gone)'); }
  await p.screenshot({ path: path.join(SHOTS, 'stmts-balance-laptop.png') });
  await ctx.close();

  /* ── 6 · BEFORE THE SQL RUNS ── */
  const P = stand(true), c2 = await open(P);
  await c2.p.waitForSelector('[data-testid="bank-stmts-sum"]');
  await c2.p.waitForFunction(() => /Starts after an update/.test(document.querySelector('[data-testid="bank-stmts-sum"]').textContent), null, { timeout: 8000 });
  ok(await c2.p.locator('[data-testid="bank-stmts-add"]').count() === 0 && await c2.p.locator('[data-testid="bank-file"]').count() === 1, 'a 503 says "Starts after an update" in the box; the plain picker is untouched');
  await c2.p.screenshot({ path: path.join(SHOTS, 'stmts-pending-laptop.png') });
  await c2.ctx.close();

  /* ── 7 · IDS · NO ERROR ── */
  const ids = ['BKS014-I12', 'BKS014-I13', 'BKS014-B41', 'BKS014-B42', 'BKS014-B43', 'BKS014-B44', 'BKS014-B45'];
  const src = fs.readFileSync(path.join(PUB, 'app', 'cap-bank-statements.js'), 'utf8') + fs.readFileSync(path.join(PUB, 'app', 'cap-bank-home.js'), 'utf8'); /* the missing-month button (B44) moved to the home */
  ok(ids.every((id) => src.indexOf('data-cbsid="' + id + '"') >= 0), 'every control the box draws wears its id (' + ids.join(' ') + ')');
  ok(!/\.parse\(/.test(src.replace(/CBBankRecon\.parse\(text, \{ format: 'auto'[^\n]*\n/, '')), 'the box holds no second parser: its only parse call is the reader\'s own, for the period');
  ok(...C.finish());
  ok(threw.length === 0, 'no page error' + (threw.length ? ': ' + threw[0] : ''));
  await b.close(); srv.close();
  console.log('\n  bank-statements-box: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('  XX  the harness stopped: ' + e.message); process.exit(1); });
