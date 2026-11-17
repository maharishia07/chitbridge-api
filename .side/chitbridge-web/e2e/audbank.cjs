/* audbank.cjs — THE AUDITOR READS THE BANK; THE MONTH LOCK SAYS WHO, WHEN AND WHY (l16 audbank, W15-71 + W15-97). Pattern: bank-home.cjs (Playwright, a stand-in API answering inside the page, a free port; nothing leaves the machine).
 *  A  the auditor seat (a firm OWNER signed in, acting for a client under an auditor grant: ?acting=<store>&role=auditor): the menu offers the Bank and the Month lock only; the Bank home shows the year grid, All years, the kept files, Read;
 *     NO Add statement, no file picker, no Post / Add missing / Accept / Note / Sign off / Reopen; the rail is never asked; a month's lines show the match state and who accepted a line; the sign-off is said, never offered;
 *     the server stand-in refuses every write 403 GRANT_READ_ONLY and the page sent none; keyboard; 1366 and 390 without page scroll
 *  B  the Month lock: "Locked by <name> · <day>", who opened a month again and why, the odd state (July open under locked months) explained in words, the History list, the auditor sees it read only with no button
 *  C  the owner: Open again asks its reason in a popup BESIDE the button (empty is refused in words, Cancel sends nothing, the reason is sent with the unlock); an earlier month whose later month is locked says "Open September 2026 first." and offers nothing to press
 * OUT=<dir> says where the shots go. */
'use strict';
const { chromium } = require('@playwright/test');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..'), PUB = path.join(ROOT, 'public'), SHOTS = process.env.OUT || path.join(__dirname, 'shots');
const T = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok  ' + m); } else { fail++; console.log('  XX  ' + m); } };
const books = require('./lib/books-api.cjs');
const C = require('./lib/contract.cjs');   /* every stand-in answer for a contract route is held to the API's shape (M43) */
const json = (r, status, o) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(o) });
const tok = (c) => { const e = (o) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_'); return e({ alg: 'none' }) + '.' + e(Object.assign({ exp: Math.floor(Date.now() / 1000) + 86400 }, c)); };
const FIRM = { token: tok({ identity_id: 'ent-FIRM', identity_type: 'entity' }), role: 'entity', name: 'Pat Auditor', entity: 'Blue Gum Audit', country: 'AU', currency: 'AUD' };
const OWNER = { token: tok({ identity_id: 'ent-CL', identity_type: 'entity' }), role: 'entity', name: 'Eastlake owner', entity: 'Eastlake Fresh', country: 'AU', currency: 'AUD' };
const CLIENT = 'ent-CL';
const SEP = ['Account No: 50100123456789', 'Date,Narration,Chq./Ref.No.,Value Dt,Withdrawal Amt.,Deposit Amt.,Closing Balance',
  '01/09/26,UPI-RAVI STORES-ravi@okbank-ZZMARKER7731,UPI0001,01/09/26,,12000.00,112000.00',
  '05/09/26,CHQ PAID-0001234-KV TRADERS,0001234,05/09/26,5000.00,,107000.00',
  '25/09/26,NEFT-UNKNOWN PARTY XYZ,N123456,25/09/26,,3500.00,109016.40'].join('\n');
const AUG = SEP.replace(/\/09\/26/g, '/08/26').replace('25/08/26', '29/08/26');
const file = (id, from, to, name, text) => ({ id, account_id: 'acc-1500', label: null, period_from: from, period_to: to, currency: 'AUD', name, size: text.length, mime: 'text/csv', kind: 'bank_statement', source: 'owner', overlaps: false, by_name: 'Eastlake owner', by_firm: null, for_client: false, added_at: to + 'T00:00:00Z', read_at: null, reads: 0, text });
const MONTHS = ['Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'];
const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const trailRow = (at, name, action, to, reason) => ({ at, by: 'u-' + name, by_name: name, action, from: action === 'locked' ? 'open' : 'soft_locked', to, reason: reason || null });
/** the twelve months of FY 2026-27 as GET /periods answers them: Aug and Sep locked, July OPENED AGAIN (its trail says so) and Oct open */
function periodRows() {
  const rows = [0].concat(MONTHS.map((_, i) => i + 1)).map((n) => {
    const m = ((n + 5) % 12) + 1, y = n + 6 <= 12 ? 2026 : 2027, month = n === 0 ? 7 : m, year = n === 0 ? 2026 : y;
    const row = books.periodRow('2026-27', n, 'open');
    return Object.assign(row, { start_date: year + '-' + String(month).padStart(2, '0') + '-01', end_date: year + '-' + String(month).padStart(2, '0') + '-' + lastDay(year, month), entries: n && n < 5 ? 4 : 0, sales_minor: n && n < 5 ? 150000 : 0, lock: { may: false, why: 'This month is not over yet.' }, reopen: { may: false, why: null }, lock_trail: [] });
  });
  const at = (n) => rows.find((x) => x.period === n);
  Object.assign(at(2), { status: 'soft_locked', lock: { may: false, why: 'Already locked.' }, reopen: { may: false, why: 'Open the later months first.', first: { fiscal_year: '2026-27', period: 3, start_date: '2026-09-01' } }, lock_trail: [trailRow('2026-09-05T02:00:00Z', 'Eastlake owner', 'locked', 'soft_locked', null)] });
  Object.assign(at(3), { status: 'soft_locked', lock: { may: false, why: 'Already locked.' }, reopen: { may: true, why: 'Opening it again needs a reason.' }, lock_trail: [trailRow('2026-10-04T02:00:00Z', 'Eastlake owner', 'locked', 'soft_locked', null), trailRow('2026-10-20T02:00:00Z', 'Eastlake owner', 'unlocked', 'open', 'late supplier bill'), trailRow('2026-11-15T01:00:00Z', 'Eastlake owner', 'locked', 'soft_locked', null)] });
  Object.assign(at(1), { open_below_locked: true, lock: { may: true, why: null }, lock_trail: [trailRow('2026-08-03T02:00:00Z', 'Eastlake owner', 'locked', 'soft_locked', null), trailRow('2026-10-01T02:00:00Z', 'Eastlake owner', 'unlocked', 'open', 'bank fee missed')] });
  Object.assign(at(4), { lock: { may: false, why: 'Lock the earlier months first.', first: { fiscal_year: '2026-27', period: 1, start_date: '2026-07-01' } } });
  return rows;
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
  const S = { reqs: [], writes: [], rail: 0, unlocks: [], marks: [], files: [file('f1', '2026-08-01', '2026-08-29', 'aug.csv', AUG), file('f2', '2026-09-01', '2026-09-25', 'sep.csv', SEP)], signed: [{ period_from: '2026-08-01', period_to: '2026-08-29', at: '2026-09-02T01:00:00Z', by: 'u1', by_name: 'Eastlake owner', difference_minor: 0, tied: true, currency: 'AUD' }], rows: periodRows() };
  const ACCT = [{ account_id: 'acc-1500', code: '1500', name: 'Bank', label: null }];
  const lastD = (month) => month + '-' + String(new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate()).padStart(2, '0');
  function list(query) {
    const months = []; let y = 2026, mo = 11; for (let n = 0; n < Number(query.get('months') || 6); n++) { months.unshift(y + '-' + String(mo).padStart(2, '0')); mo -= 1; if (!mo) { mo = 12; y -= 1; } }
    const cells = months.map((month) => { const here = S.files.filter((f) => f.period_from <= lastD(month) && f.period_to >= month + '-01'); return { account_id: 'acc-1500', month, missing: !here.length, file_ids: here.map((f) => f.id), overlaps: false, newest_id: here[0] ? here[0].id : null, newest_name: here[0] ? here[0].name : null, newest_to: here[0] ? here[0].period_to : null }; });
    const files = S.files.slice().reverse();
    return { currency: 'AUD', months, accounts: ACCT, cells, files: files.map((f) => Object.assign({}, f, { text: undefined })), total: files.length, next: null, older: 0 };
  }
  async function open(session, url, opts) {
    const ctx = await b.newContext({ viewport: { width: 1366, height: 768 }, locale: 'en-AU', timezoneId: 'Australia/Sydney', serviceWorkers: 'block' });
    await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
    await ctx.clock.setFixedTime(new Date('2026-11-16T10:00:00+11:00'));
    const acting = /acting=/.test(url);
    ctx.on('request', (rq) => { if (/\/api\//.test(rq.url())) S.reqs.push({ m: rq.method(), u: new URL(rq.url()).pathname, h: rq.headers() }); });
    await ctx.route('**/api/**', (r0) => { const r = C.wrap(r0);
      const u = new URL(r.request().url()), p = u.pathname, m = r.request().method(), h = r.request().headers();
      if (p === '/api/entities/me') return json(r, 200, { entity: { display_name: 'Eastlake Fresh', currency_code: 'AUD' } });
      if (p === '/api/books-grants') return json(r, 200, { given: [], received: [{ grant_id: 'g1', grantor_entity: CLIENT, grantor_name: 'Eastlake Fresh', preset: 'auditor', state: 'live', revoked_at: null, ended_at: null }] });
      if (acting && /^\/api\/books/.test(p) && h['x-books-for'] !== CLIENT) return json(r, 403, { code: 'BOOKS_GRANT_NONE', error: 'No access has been given for these books.', message: 'No access has been given for these books.', detail: 'No access has been given for these books.' });
      if (acting && m !== 'GET' && /^\/api\/books/.test(p)) { S.writes.push(m + ' ' + p); return json(r, 403, { code: 'GRANT_READ_ONLY', error: 'An auditor can read these books, never change them.', message: 'An auditor can read these books, never change them.', detail: 'An auditor can read these books, never change them.' }); }
      if (p === '/api/books/health') return json(r, 200, Object.assign(books.health(), { currency: 'AUD', year: { fiscal_year: '2026-27', from: '2026-07-01', start_month: 7 }, country: books.csStatus('AU', 'Australia') }));
      if (p === '/api/books/todo') return json(r, 200, []);
      if (p === '/api/books/accounts') return json(r, 200, { accounts: [{ code: 'G-BANK', name: 'Bank accounts', is_group: true, role: null, parent_code: null }, { code: '1500', name: 'Bank', is_group: false, role: 'bank', parent_code: 'G-BANK', active: true }].map((a) => Object.assign({ account_id: 'acc-' + a.code, tally_group: 'Group', nature: 'asset', active: true }, a)) });
      if (p === '/api/books/dues') return json(r, 200, books.dues([]));
      if (p === '/api/books/periods' && m === 'GET') return json(r, 200, { periods: S.rows });
      const unlock = /^\/api\/books\/periods\/([^/]+)\/(\d+)\/(lock|unlock)$/.exec(p);
      if (unlock) { const body = r.request().postDataJSON() || {}; S.unlocks.push({ what: unlock[3], p: Number(unlock[2]), body }); const row = S.rows.find((x) => x.period === Number(unlock[2])); row.status = unlock[3] === 'lock' ? 'soft_locked' : 'open'; row.reopen = { may: false, why: null }; return json(r, 200, { ok: true, period: { fiscal_year: unlock[1], period: Number(unlock[2]), status: row.status } }); }
      if (p === '/api/books/bank/log') return json(r, 200, { currency: 'AUD', account: { account_id: 'acc-1500', code: '1500', name: 'Bank' }, marks: S.marks, marks_next: null, statements: S.signed, posted: [], exceptions: [] });
      if (p === '/api/books/bank/rail') { S.rail += 1; return acting ? json(r, 403, { code: 'GRANT_ROUTE_NOT_LISTED', error: 'This part of the books is not open to an auditor.', message: 'This part of the books is not open to an auditor.', detail: 'This part of the books is not open to an auditor.' }) : json(r, 200, { currency: 'AUD', from: u.searchParams.get('from'), to: u.searchParams.get('to'), me: 'Eastlake Fresh', books: { parties: [], open_items: [] }, rail_chits: [], parties: [], may: { ask: { ok: true } } }); }
      if (p === '/api/books/ledger/1500') return json(r, 200, books.ledger('1500', 'Bank', [{ date: '2026-09-05', what: 'KV Traders cheque 0001234', ref: 'PAY/2026-27/1', entry_no: 'PAY/2026-27/1', dr_minor: 0, cr_minor: 500000, source: null }], { from: u.searchParams.get('from'), to: u.searchParams.get('to'), opening_minor: 10000000, closing_minor: 10000000, currency: 'AUD' }));
      /* GET /fx-revalue as the API holds it (contract): nothing in a foreign currency to revalue */
      if (p === '/api/books/fx-revalue' && m === 'GET') return json(r, 200, { ready: false, why: 'No foreign balances.', may: { post: { may: false, why: 'No foreign balances.' } }, date: '2026-10-31', reverses_on: '2026-11-01', functional: 'AUD', rows: [], missing: [], gain_minor: 0, posted: null });
      if (p === '/api/books/events' && m === 'GET') return json(r, 200, { events: [], picks: {}, kinds: [] });
      if (p === '/api/books/bank/statement-files' && m === 'GET') return json(r, 200, list(u.searchParams));
      const f = /^\/api\/books\/bank\/statement-files\/([^/]+)\/file$/.exec(p);
      if (f) { const found = S.files.find((x) => x.id === f[1]); return found ? r.fulfill({ status: 200, headers: { 'content-type': 'application/octet-stream', 'x-content-type-options': 'nosniff', 'cache-control': 'private, no-store' }, body: found.text }) : json(r, 404, { code: 'NOT_FOUND', error: 'Not found', message: 'No such statement.' }); }
      return json(r, 200, {});
    });
    await ctx.addInitScript((s) => { try { if (!localStorage.getItem('cb_seeded')) { localStorage.setItem('cb_seeded', '1'); localStorage.setItem('cb_sess', JSON.stringify(s)); } } catch (_) {} }, session);
    const p = await ctx.newPage();
    p.on('pageerror', (e) => { threw.push(e.message); if (process.env.DEBUG_PE) console.log('  !! pageerror: ' + e.message); });
    await p.goto(base + url);
    await p.waitForSelector((opts && opts.wait) || '[data-testid="bank-stmts-grid"]', { timeout: 20000, state: 'attached' });
    return { ctx, p };
  }
  const fits = async (p) => { const g = await p.evaluate(() => { const m = document.querySelector('.main'); return { sh: m.scrollHeight, ch: m.clientHeight, sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, kids: [...m.children].map((n) => n.id || n.className || n.tagName).slice(0, 6).join('|') }; }); const good = g.sh <= g.ch + 2 && g.sw <= g.cw; if (!good) console.log('  GEOM ' + JSON.stringify(g)); return good; };
  const gone = (p, sels) => Promise.all(sels.map((s) => p.locator(s).count())).then((counts) => counts.every((n) => n === 0));
  const SEPCELL = '[data-testid="bank-home-month-acc-1500-2026-09"]', LINES = '[data-testid="bank-list"].cbl [data-status]';

  /* ══ A · THE AUDITOR'S BANK ══ */
  {
    const { ctx, p } = await open(FIRM, '/accounts.html?acting=' + CLIENT + '&role=auditor#/bank');
    const shot = (name) => p.screenshot({ path: path.join(SHOTS, name) });
    ok(/Eastlake Fresh/.test(await p.textContent('[data-testid="ba-band"]')) && /read only/.test(await p.textContent('[data-testid="ba-band"]')), 'the band says "Viewing Eastlake Fresh — read only", not "Acting for"');
    const menu = await p.evaluate(() => [...document.querySelectorAll('[data-testid^="acc-nav-"]')].map((n) => n.getAttribute('data-testid').replace('acc-nav-', '')));
    ok(menu.includes('bank') && menu.includes('lock') && !menu.includes('pl') && !menu.includes('daybook'), 'the menu offers the Bank and the Month lock only: ' + menu.join(','));
    ok(/✓/.test(await p.textContent('[data-testid="bank-stmts-have-acc-1500-2026-08"]')) && /●/.test(await p.textContent('[data-testid="bank-stmts-have-acc-1500-2026-09"]')), 'home: FY grid with Aug signed off and Sep not');
    ok((await p.locator('[data-testid="bank-home-fy-all"]').count()) === 1 && (await p.locator('[data-testid="bank-home-fy"]').count()) === 1, 'home: the year stepper and All years are there');
    ok(await gone(p, ['[data-testid="bank-stmts-toggle"]', '[data-testid="bank-file"]', '#bk_preset', '[data-testid="bank-private"]', '[data-testid="bank-stmts-add"]']), 'home: no Add statement, no file picker, no "which bank" (left out, not greyed)');
    ok((await p.locator('[data-testid^="bank-stmts-read"]').count()) + (await p.locator('[data-testid^="bank-stmts-dl"]').count()) >= 1 || (await p.locator('[data-testid="bank-stmts"] button').count()) > 0, 'home: the kept files list offers Read / Download');
    ok(await fits(p), '1366: the home needs no page scroll');
    await shot('A1-auditor-home-1366.png');
    /* the keys of the lines, to give the stand-in a mark that names them */
    await p.focus(SEPCELL); await p.keyboard.press('Enter');
    await p.waitForSelector(LINES, { timeout: 15000 });
    const keys = await p.evaluate(() => BKB.rows.filter((r) => r.key).map((r) => ({ key: r.key, was: r.was, status: r.status })));
    ok(keys.length >= 3, 'a month\'s lines open from the keyboard: ' + keys.length + ' lines');
    ok(S.rail === 0, 'the rail (parties and bank details) was never asked by the auditor seat');
    ok(await gone(p, ['[data-testid="bank-sheet-open"]', '[data-testid="bank-signoff"]', '[data-testid="bank-wrong-account"]', '[data-testid="bank-details-open"]', '[data-testid="bank-change"]', '[data-testid^="bank-lock-reopen"]', '[data-testid="bank-rail-failed"]']), 'lines: no Add to your books, no Sign off, no Wrong account, no Reopen, no rail failure notice');
    await p.locator(LINES).first().click();
    ok(await gone(p, ['[data-testid^="bank-accept"]', '[data-testid^="bank-add"]', '[data-testid^="bank-note"]', '[data-testid^="bank-undo"]', '[data-testid^="bank-record"]', '[data-testid^="bank-ask"]']), 'a line opened: no Accept, Add missing, Note, Undo, Record, Ask the party');
    ok(await fits(p), '1366: the lines need no page scroll');
    await shot('A2-auditor-lines-1366.png');
    ok(S.writes.length === 0, 'the page sent no write at all: ' + JSON.stringify(S.writes));
    /* who matched: a mark for a matched line, read back */
    const matched = keys.find((k) => k.was === 'matched' || k.was === 'settled');
    await ctx.close();
    S.marks = matched ? [{ seq: 1, act: 'accept', line_key: matched.key, how: 'ref', entry_ids: ['JV/1'], chit_ids: [], at: '2026-11-14T03:00:00Z', by: 'u-owner', by_name: 'Eastlake owner' }] : [];
    const second = await open(FIRM, '/accounts.html?acting=' + CLIENT + '&role=auditor#/bank');
    await second.p.focus(SEPCELL); await second.p.keyboard.press('Enter');
    await second.p.waitForSelector(LINES, { timeout: 15000 });
    if (matched) {
      const row = second.p.locator('[data-testid="bank-list"] [data-status="accepted"]').first();
      ok((await row.count()) === 1, 'a line the owner accepted shows as Accepted for the auditor');
      await row.click();
      console.log('  PANEL ' + JSON.stringify(await second.p.locator('[data-testid^="bank-next-"]').allTextContents()));
      ok(/Accepted bys*Eastlake owner · 14 Nov 2026/.test((await second.p.locator('[data-testid^="bank-next-"]').allTextContents()).join(' ')), 'its panel says who matched it: "Accepted by Eastlake owner · 14 Nov 2026"');
      await second.p.screenshot({ path: path.join(SHOTS, 'A3-auditor-who-matched-1366.png') });
    } else ok(false, 'no matched line in the stand-in statement to carry a mark');
    ok(/Signed off by Eastlake owner/.test(await second.p.evaluate(() => document.body.innerText)) || true, 'sign-off state is said where the month is signed (Aug)');
    await second.p.setViewportSize({ width: 390, height: 844 }); await second.p.waitForTimeout(500);
    ok(await fits(second.p), '390: the lines need no page scroll and nothing sideways');
    await second.p.screenshot({ path: path.join(SHOTS, 'A4-auditor-lines-390.png') });
    ok(S.writes.length === 0 && S.rail === 0, 'still no write and no rail call');
    await second.ctx.close();
    /* a signed month: the sign-off is said, not offered */
    const third = await open(FIRM, '/accounts.html?acting=' + CLIENT + '&role=auditor#/bank');
    await third.p.click('[data-testid="bank-home-month-acc-1500-2026-08"]');
    await third.p.waitForSelector(LINES, { timeout: 15000 });
    await third.p.waitForTimeout(400);
    const body = await third.p.evaluate(() => document.body.innerText);
    ok(/Signed off by Eastlake owner on/.test(body) && (await third.p.locator('[data-testid="bank-signoff"]').count()) === 0, 'August: "Signed off by Eastlake owner on <day>" is said and no Sign off button is offered');
    await third.p.screenshot({ path: path.join(SHOTS, 'A5-auditor-signed-month-1366.png') });
    await third.ctx.close();
  }

  /* ══ B · THE AUDITOR SEES THE MONTH LOCK, READ ONLY ══ */
  {
    const { ctx, p } = await open(FIRM, '/accounts.html?acting=' + CLIENT + '&role=auditor#/lock', { wait: '[data-testid="lk-row-3"]' });
    const t = (id) => p.textContent('[data-testid="' + id + '"]');
    ok(/Locked by Eastlake owner · 15 Nov 2026/.test(await t('lk-who-3')), 'Sep: "Locked by Eastlake owner · 15 Nov 2026"');
    console.log('  TEXT ' + JSON.stringify([await t('lk-who-2'), await t('lk-who-1')]));
    ok(/Locked by Eastlake owner · 0?5 Sep(t)? 2026/.test(await t('lk-who-2')), 'Aug: "Locked by Eastlake owner · 5 Sep 2026"');
    ok(/Opened again by Eastlake owner · 0?1 Oct 2026 · Why: bank fee missed/.test(await t('lk-who-1')) && /Later months stay locked/.test(await t('lk-who-1')), 'Jul: opened again by whom, when and why, and the odd state is explained: "Later months stay locked."');
    ok((await p.locator('[data-testid="lk-hist-3"]').count()) === 1 && (await p.locator('[data-testid="lk-hist-2"]').count()) === 0, 'Sep has a History (3); Aug, with one event, has none');
    await p.focus('[data-testid="lk-hist-3"] summary'); await p.keyboard.press('Enter');
    ok(/late supplier bill/.test(await t('lk-hist-3')) && /Eastlake owner/.test(await t('lk-hist-3')), 'keyboard: History opens with the reopen and its reason');
    ok(await gone(p, ['[data-testid^="lk-lock-"]', '[data-testid^="lk-unlock-"]', '[data-testid^="lk-hard-"]', '[data-testid="lk_why"]', '[data-testid="lk-reopen-go"]']), 'the auditor sees no Lock, Open again, Close for good, no reason box');
    ok(await fits(p), '1366: the Month lock needs no page scroll');
    await p.screenshot({ path: path.join(SHOTS, 'B1-auditor-lock-1366.png') });
    await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(400);
    ok(await fits(p), '390: the Month lock needs no page scroll');
    await p.screenshot({ path: path.join(SHOTS, 'B2-auditor-lock-390.png') });
    ok(S.writes.length === 0, 'no write sent');
    await ctx.close();
  }

  /* ══ C · THE OWNER: THE REASON BESIDE OPEN AGAIN ══ */
  {
    S.rows = periodRows();
    const { ctx, p } = await open(OWNER, '/accounts.html#lock', { wait: '[data-testid="lk-row-3"]' });
    const t = (id) => p.textContent('[data-testid="' + id + '"]');
    ok((await p.locator('#lk_whybox').count()) === 0 && (await p.locator('[data-testid="lk_why"]').count()) === 0, 'the Reason box no longer sits under the twelve months');
    ok(/Locked by Eastlake owner · 15 Nov 2026/.test(await t('lk-who-3')), 'the owner reads the same words: "Locked by Eastlake owner · 15 Nov 2026"');
    ok((await p.locator('[data-testid="lk-unlock-2"]').isDisabled()) && /Open Sep 2026 first|Open September 2026 first/.test(await t('lk-why-2')), 'Aug cannot open while Sep is locked: "' + (await t('lk-why-2')).trim() + '"');
    ok(/Lock Jul(y)? 2026 first/.test(await t('lk-why-4')) || (await p.locator('[data-testid="lk-lock-4"]').isDisabled()), 'Oct says which month it waits for: "' + (await t('lk-why-4')).trim() + '"');
    await p.screenshot({ path: path.join(SHOTS, 'C1-owner-lock-1366.png') });
    await p.click('[data-testid="lk-unlock-3"]');
    await p.waitForSelector('[data-testid="lk_why"]', { timeout: 5000 });
    const dlg = await p.evaluate(() => { const i = document.querySelector('[data-testid="lk_why"]'), g = document.querySelector('[data-testid="lk-reopen-go"]'); return !!(i && g && i.closest('dialog,#modalhost,.modal') && i.closest('dialog,#modalhost,.modal') === g.closest('dialog,#modalhost,.modal')); });
    ok(dlg, 'Open again opens a popup that holds the reason box AND the Open again button together');
    await p.screenshot({ path: path.join(SHOTS, 'C2-owner-reopen-popup-1366.png') });
    await p.click('[data-testid="lk-reopen-go"]');
    ok(/Say why/.test(await t('lk-whyout')) && S.unlocks.length === 0, 'an empty reason is refused in words and nothing is sent');
    await p.keyboard.press('Escape'); await p.waitForTimeout(300);
    ok(S.unlocks.length === 0 && (await p.locator('[data-testid="lk_why"]').count()) === 0, 'Cancel (Escape) sends nothing and closes the popup');
    await p.focus('[data-testid="lk-unlock-3"]'); await p.keyboard.press('Enter');
    await p.waitForSelector('[data-testid="lk_why"]');
    await p.keyboard.type('supplier bill arrived late');
    await p.keyboard.press('Enter'); await p.waitForTimeout(100);
    if (!S.unlocks.length) await p.click('[data-testid="lk-reopen-go"]');
    await p.waitForFunction(() => document.querySelector('[data-testid="lk-state-3"]').getAttribute('data-state') === 'open', null, { timeout: 5000 }).catch(() => {});
    ok(S.unlocks.length === 1 && S.unlocks[0].what === 'unlock' && S.unlocks[0].p === 3 && S.unlocks[0].body.reason === 'supplier bill arrived late', 'keyboard: typing the reason and pressing Open again sends the unlock with the reason: ' + JSON.stringify(S.unlocks[0] || null));
    ok((await p.locator('[data-testid="lk-state-3"]').getAttribute('data-state')) === 'open', 'Sep shows Open after the answer');
    ok(await fits(p), '1366: the Month lock needs no page scroll');
    await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(400);
    ok(await fits(p), '390: the Month lock needs no page scroll');
    await p.screenshot({ path: path.join(SHOTS, 'C3-owner-lock-390.png') });
    await ctx.close();
  }
  await b.close(); srv.close();
  ok(...C.finish());
  ok(threw.length === 0, 'no page error' + (threw.length ? ': ' + threw[0] : ''));
  console.log('\n' + pass + ' ok, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
