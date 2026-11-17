#!/usr/bin/env node
/**
 * e2e/walk-bank-store.cjs — THE BANK MARKS ON THE SERVER, WALKED (FIN-70 web half: accounts.html#bank · app/cap-bank-store.js · api #1310 bank/log, bank/marks, bank/statements).
 * The API is a stand-in answering inside the page; its three bank doors follow the api PR's own shapes (a 503 "arrives after the next update" until b864 runs).
 *
 *   F1  the 503 path: the page says "Saved on this device until the next update"; an accept still works and is kept on the device; NO mark is sent; Sign off is shown, greyed
 *   F2  the server path: an accept posts ONE mark (line key, no at or by, the file hash, no narration); a fresh login with an EMPTY device replays it from the log (the line is
 *       Accepted again); an undo is a new mark
 *   F3  a note: the note box says it is kept on the shared record; the note travels as text
 *   F4  Sign off this reconciliation by keyboard only: Tab to the button, Enter opens the popup naming account, period and difference, Esc sends nothing, Enter again then
 *       Enter on Sign off posts ONE statement with the figures the Statement tab shows (opening, bank, books, difference, currency, file hash); the signed list shows it
 *   F5  the posted-but-not-accepted lines from the log read are a named list (entry, date, amount)
 *   F6  nothing secret leaves: no request body holds a narration, the file name or the account number
 *   F7  rule 13, light and dark at 1366x768 and 390x844: AA contrast, nothing scrolls sideways, no link to app.html
 *
 *   NODE_PATH=$PWD/e2e/node_modules node e2e/walk-bank-store.cjs
 */
'use strict';
const TD = require('./lib/today.cjs');
const { chromium } = require('@playwright/test');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..'), PUB = path.join(ROOT, 'public'), SHOTS = path.join(__dirname, 'shots');
const T = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const C = require('./lib/contract.cjs'), books = require('./lib/books-api.cjs'), { measure } = require('./lib/theme-measure.cjs');
const J = C.json;
let pass = 0, fail = 0;
const ok = (id, c, m) => { if (c) { pass++; console.log(id + ' · PASS · ' + m); } else { fail++; console.log(id + ' · FAIL · ' + m); } };
const tok = (c) => { const e = (o) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_'); return e({ alg: 'none' }) + '.' + e(Object.assign({ exp: Math.floor(TD.nowMs() / 1000) + 3600 }, c)) + '.x'; };
const OWNER = { token: tok({ identity_id: 'ent-M', identity_type: 'entity' }), role: 'entity', name: 'Mayur', entity: 'Mayur Bhavan', entityId: 'ent-M' };

const HEAD = ['Account No: 50100123456789', 'Date,Narration,Chq./Ref.No.,Value Dt,Withdrawal Amt.,Deposit Amt.,Closing Balance'];
const CSV = HEAD.concat(['01/09/26,UPI-RAVI STORES-ravi@okbank-UTR778899001,UTR778899001,01/09/26,,12000.00,112000.00',
  '07/09/26,CHQ PAID-0001234-KV TRADERS,0001234,07/09/26,5000.00,,107000.00']).join('\n');
const SECRETS = ['ravi@okbank', 'RAVI STORES', 'KV TRADERS', 'statement.csv', '50100123456789'];
const ACCOUNTS = [{ code: 'G-BANK', name: 'Bank accounts', is_group: true, role: null, parent_code: null }, { code: '1500', name: 'Bank', is_group: false, role: 'bank', parent_code: 'G-BANK', active: true }];
const EXCEPTION = { code: 'POSTED_NOT_ACCEPTED', entry_id: 'e-9', entry_no: 'MJ/26-27/0009', posting_date: '2026-09-12', amount_minor: 123400, currency: 'INR', file_hash: 'abc', line_no: 3,
  why: 'Entry MJ/26-27/0009 was posted from a bank line, but no accept mark names it.' };

/** the server's state: ready=false is "before b864" (every bank door answers 503) */
function stand(ready) {
  const S = { ready, reqs: [], posts: [], marks: [], statements: [] };
  S.lines = [{ date: '2026-09-01', what: 'Receipt: Ravi Stores', ref: 'MJ/26-27/0001', source: { how_ref: 'UTR778899001' }, dr_minor: 1200000, cr_minor: 0 },
    { date: '2026-09-07', what: 'Payment: KV Traders', ref: 'MJ/26-27/0002', source: { how_ref: '0001234' }, dr_minor: 0, cr_minor: 500000 }];
  return S;
}
const NOT_YET = { type: 'about:blank', title: 'Service Unavailable', status: 503, code: 'BOOKS_NOT_MIGRATED', error: 'Service Unavailable', message: 'The shared bank reconciliation record arrives after the next update.' };

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const srv = http.createServer((q, r) => {
    const rel = decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '');
    const f = (!rel || rel === 'index.html') ? path.join(ROOT, 'index.html') : path.join(PUB, rel);
    if (((!f.startsWith(PUB)) && f !== path.join(ROOT, 'index.html')) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('no'); }
    r.writeHead(200, { 'content-type': T[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  const b = await chromium.launch();
  const threw = [];

  async function open(S, o) {
    o = o || {};
    const ctx = await b.newContext({ viewport: o.vp || { width: 1366, height: 768 }, locale: 'en-IN', timezoneId: 'Asia/Kolkata', serviceWorkers: 'block' });
    if (TD.injected) await ctx.clock.setFixedTime(TD.now());
    await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
    ctx.on('request', (rq) => { S.reqs.push({ m: rq.method(), u: rq.url(), d: rq.postData() || '' }); });
    await ctx.route('**/api/**', (r) => {
      const u = new URL(r.request().url()), p = u.pathname, m = r.request().method();
      let body = null; try { body = r.request().postDataJSON(); } catch (_) {}
      if (p === '/api/entities/me') return J(r, 200, { entity: { display_name: 'Mayur Bhavan', currency_code: 'INR', ledger_on: true } });
      if (p === '/api/books/health') return J(r, 200, books.health());
      if (p === '/api/books/todo') return J(r, 200, []);
      if (p === '/api/books/periods') return J(r, 200, books.periods([]));
      if (p === '/api/books/accounts') return J(r, 200, { accounts: ACCOUNTS.map((a) => Object.assign({ account_id: 'acc-' + a.code, tally_group: 'Group', nature: 'asset', active: true }, a)) });
      if (p === '/api/books/events' && m === 'GET') return J(r, 200, books.eventsAnswer({ events: [], picks: {} }));
      if (p === '/api/books/ledger/1500') return J(r, 200, books.ledger('1500', 'Bank', S.lines, { from: u.searchParams.get('from'), to: u.searchParams.get('to'), opening_minor: 10000000, closing_minor: 10700000 }));
      if (p === '/api/books/bank/rail') return J(r, 200, { currency: 'INR', from: u.searchParams.get('from'), to: u.searchParams.get('to'), me: 'Mayur Bhavan', books: { parties: [], open_items: [] }, rail_chits: [], parties: [], may: { ask: { ok: true } } });
      if (/^\/api\/books\/bank\/(log|marks|statements)$/.test(p)) {
        if (m !== 'GET') S.posts.push({ p, body });
        if (!S.ready) return J(r, 503, NOT_YET);
        if (p === '/api/books/bank/log') return J(r, 200, { currency: 'INR', account: { account_id: 'acc-1500', code: '1500', name: 'Bank' }, marks: S.marks, statements: S.statements.slice().reverse(), exceptions: [EXCEPTION] });
        if (p === '/api/books/bank/marks') {
          const rows = body.marks.map((x) => ({ seq: S.marks.length + 1, kind: 'mark', act: x.act, line_key: x.key, how: x.how || null, entry_ids: x.ledger || [], chit_ids: x.chits || [], note: x.text || null,
            attach_ref: x.ref || null, file_hash: body.file_hash || null, by: 'Mayur', at: '2026-11-14T09:00:00.000Z' }));
          S.marks.push(...rows); return J(r, 201, { marks: rows });
        }
        const row = Object.assign({ seq: 1, kind: 'statement', tied: body.difference_minor === 0, by: 'Mayur', at: '2026-11-14T09:05:00.000Z' }, body);
        S.statements.push(row); return J(r, 201, { statement: row });
      }
      if (p === '/api/books/dues') return J(r, 200, books.dues([]));
      return J(r, 200, {});
    });
    const seed = 'try { if (!sessionStorage.getItem("w")) { sessionStorage.setItem("w","1"); localStorage.setItem("cb_sess", ' + JSON.stringify(JSON.stringify(OWNER)) + '); '
      + (o.theme ? 'localStorage.setItem("cb_theme", ' + JSON.stringify(o.theme) + '); ' : '') + (o.keep ? '' : 'Object.keys(localStorage).filter(function (k) { return /^cb_bankrec:/.test(k); }).forEach(function (k) { localStorage.removeItem(k); }); ')
      + '} } catch (_) {}';
    await ctx.addInitScript({ content: seed });
    const pg = await ctx.newPage();
    pg.on('pageerror', (e) => threw.push(e.message));
    await pg.goto(base + '/accounts.html#bank');
    await pg.waitForSelector('[data-testid="bank-file"]', { timeout: 15000 });
    return { ctx, p: pg };
  }
  const load = async (pg) => {
    if (await pg.locator('[data-testid="bank-change"]').isVisible() && !(await pg.locator('#bk_preset').isVisible())) await pg.click('[data-testid="bank-change"]'); /* the form folds once a statement is on screen */ await pg.selectOption('#bk_preset', 'hdfc');
    await pg.setInputFiles('[data-testid="bank-file"]', { name: 'statement.csv', mimeType: 'text/csv', buffer: Buffer.from(CSV) });
    await pg.waitForSelector('[data-testid="bank-currency"], [data-testid="bank-store-line"]', { state: 'attached', timeout: 15000 }); /* the currency is asked only when the account has none on record */
    if (await pg.locator('[data-testid="bank-currency"]').count()) { await pg.fill('[data-testid="bank-currency"]', 'INR'); await pg.click('[data-testid="bank-currency-go"]'); }
    await pg.waitForSelector('[data-testid="bank-store-line"]', { state: 'attached', timeout: 15000 });
  };
  const status = (pg, i) => pg.getAttribute('[data-testid="bank-chip-s' + i + '"]', 'data-status');
  const accept = async (pg, i) => {
    await pg.click('[data-testid="bank-row-s' + i + '"] [data-caret]');
    await pg.waitForSelector('[data-testid="bank-next-s' + i + '"]', { timeout: 5000 });
    await pg.click('[data-next="s' + i + '"] [data-testid="bank-accept"]');
    await pg.waitForFunction((n) => { const e = document.querySelector('[data-testid="bank-chip-s' + n + '"]'); return e && e.getAttribute('data-status') === 'accepted'; }, i, { timeout: 5000 }).catch(() => {});
  };
  const sent = (S) => S.reqs.filter((x) => x.m !== 'GET' && /\/bank\/(marks|statements)/.test(x.u));

  /* ── F1 · before the SQL runs ── */
  let S = stand(false);
  let { ctx, p } = await open(S);
  await load(p);
  ok('F1', /Saved on this device until the next update/.test(await p.textContent('[data-testid="bank-store-line"]')), 'the one line says "Saved on this device until the next update"');
  const lineStatus = await status(p, 0);
  await accept(p, 0);
  ok('F1', (await status(p, 0)) === 'accepted' && lineStatus !== 'accepted', 'an accept still works on the device (' + lineStatus + ' to accepted)');
  ok('F1', S.posts.length === 0, 'nothing is sent to the marks door while the record is not set up (' + S.posts.length + ' posts)');
  const tiedNow = (await p.getAttribute('[data-testid="bank-finish"]', 'data-tied')) === 'true';
  ok('F1', tiedNow ? await p.locator('[data-testid="bank-signoff"]').isDisabled() : (await p.locator('[data-testid="bank-signoff"]').count()) === 0, 'Sign off shows only at a nil difference, and is greyed while the record is not set up (nil: ' + tiedNow + ')');
  await p.screenshot({ path: path.join(SHOTS, 'walk-bank-store-device.png') });
  await ctx.close();

  /* ── F2 · the server path ── */
  S = stand(true);
  ({ ctx, p } = await open(S));
  await load(p);
  ok('F2', /kept for your accountant too/.test(await p.textContent('[data-testid="bank-store-line"]')), 'the record answers: the line says the marks are kept for the accountant too');
  await accept(p, 0);
  await p.waitForFunction(() => document.querySelector('[data-testid="bank-store-line"]'), null, { timeout: 3000 });
  await p.waitForTimeout(400);
  const marks = S.posts.filter((x) => x.p === '/api/books/bank/marks');
  ok('F2', marks.length === 1 && marks[0].body.marks.length === 1 && marks[0].body.marks[0].act === 'accept' && !!marks[0].body.marks[0].key && !('at' in marks[0].body.marks[0]) && !('by' in marks[0].body.marks[0]),
    'one accept = ONE mark with the line key and no at or by ' + JSON.stringify(marks[0] && marks[0].body).slice(0, 200));
  ok('F2', marks[0] && marks[0].body.account === '1500' && /^[0-9a-f]{16}$/.test(marks[0].body.file_hash || ''), 'the account and the file hash (not the file) travel');
  await ctx.close();
  ({ ctx, p } = await open(S));   /* a fresh login, an EMPTY device */
  await load(p);
  ok('F2', (await status(p, 0)) === 'accepted', 'a fresh device replays the log through the engine: the line is Accepted again');
  await p.click('[data-testid="bank-row-s0"] [data-caret]');
  await p.waitForSelector('[data-testid="bank-next-s0"]');
  await p.click('[data-next="s0"] [data-testid="bank-undo"]');
  await p.waitForTimeout(500);
  ok('F2', S.marks.length === 2 && S.marks[1].act === 'undo', 'an undo is a NEW mark (the log keeps both: ' + S.marks.map((x) => x.act).join(', ') + ')');

  /* ── F3 · a note ── */
  if (!(await p.locator('[data-testid="bank-next-s0"]').count())) await p.click('[data-testid="bank-row-s0"] [data-caret]');
  await p.waitForSelector('[data-testid="bank-next-s0"]');
  await p.click('[data-next="s0"] [data-testid="bank-note"]');
  await p.waitForSelector('[data-testid="bank-note-text"]', { timeout: 3000 }).catch(() => {});
  ok('F3', /shared record/.test(await p.textContent('.mbody').catch(() => '')), 'the note box says the note is kept on the shared record');
  await p.fill('[data-testid="bank-note-text"]', 'Cheque seen at the branch').catch(() => {});
  await p.click('[data-testid="bank-note-save"]').catch(() => {});
  await p.waitForTimeout(500);
  const note = S.marks.filter((x) => x.act === 'note')[0];
  ok('F3', !!note && note.note === 'Cheque seen at the branch', 'the note travels as the owner\'s own text');

  /* ── F5 · the exceptions ── */
  await p.click('[data-testid="bank-more"]'); await p.click('[data-testid="bank-tab-brs"]'); /* the exceptions and the signed list live on the Statement view */
  const ex = await p.textContent('[data-testid="bank-exceptions"]').catch(() => '');
  ok('F5', /MJ\/26-27\/0009/.test(ex) && /1,234\.00/.test(ex), 'the posted-not-accepted line is a named row: ' + ex.replace(/\s+/g, ' ').trim().slice(0, 90));

  /* ── F4 · sign off, keyboard only ── */
  await p.click('[data-testid="bank-more"]'); await p.click('[data-testid="bank-tab-brs"]');
  const btn = p.locator('[data-testid="bank-signoff"]');
  ok('F4', (await btn.count()) === 1 && (await btn.isEnabled()) && (await btn.getAttribute('data-cbsid')) === 'BKS014-B08', 'the Sign off button is there, enabled, and wears BKS014-B08');
  await btn.focus();
  ok('F4', await btn.evaluate((e) => document.activeElement === e), 'it takes the keyboard focus');
  await p.keyboard.press('Enter');
  await p.waitForSelector('dialog[open], .confirm, #cb_confirm', { timeout: 3000 }).catch(() => {});
  const reach = await p.textContent('[data-testid="bank-signoff-reach"]').catch(() => '');
  ok('F4', /Bank/.test(reach) && /Difference/.test(reach) && /2026/.test(reach), 'the popup names the account, the period and the difference: ' + reach.replace(/\s+/g, ' ').trim().slice(0, 120));
  await p.screenshot({ path: path.join(SHOTS, 'walk-bank-store-confirm.png') });
  await p.keyboard.press('Escape');
  await p.waitForTimeout(300);
  ok('F4', S.posts.filter((x) => x.p === '/api/books/bank/statements').length === 0, 'Esc sends nothing');
  await btn.focus();
  await p.keyboard.press('Enter');
  await p.waitForSelector('[data-testid="bank-signoff-reach"]', { timeout: 3000 });
  /* the popup's own confirm: the last button of the open dialog, reached by Tab, pressed by Enter */
  const yes = await p.evaluate(() => { const d = document.querySelector('dialog[open]') || document.body; const bs = Array.from(d.querySelectorAll('button')).filter((x) => x.offsetParent); return bs.map((x) => x.textContent.trim()); });
  for (let i = 0; i < 6 && (await p.evaluate(() => (document.activeElement && document.activeElement.textContent || '').trim())) !== 'Sign off'; i++) await p.keyboard.press('Tab');
  await p.keyboard.press('Enter');
  await p.waitForTimeout(600);
  const st = S.posts.filter((x) => x.p === '/api/books/bank/statements');
  ok('F4', st.length === 1 && st[0].body.account === '1500' && st[0].body.currency === 'INR' && st[0].body.difference_minor === 0 && st[0].body.closing_bank_minor === st[0].body.closing_books_minor
    && st[0].body.opening_minor === 10000000 && /^[0-9a-f]{16}$/.test(st[0].body.file_hash) && Object.keys(st[0].body).length === 9,
  'ONE statement with the figures the tab shows ' + JSON.stringify(st[0] && st[0].body) + ' (buttons: ' + yes.join('|') + ')');
  ok('F4', /Signed off/.test(await p.textContent('[data-testid="bank-store"]')) && (await p.locator('[data-testid="bank-signed-row"]').count()) === 1, 'the signed list shows it');
  await p.screenshot({ path: path.join(SHOTS, 'walk-bank-store-signed.png') });

  /* ── F6 · nothing secret leaves ── */
  const leaked = S.reqs.filter((x) => x.m !== 'GET').filter((x) => SECRETS.some((s) => x.d.indexOf(s) >= 0 || x.u.indexOf(s) >= 0)).map((x) => x.u);
  ok('F6', leaked.length === 0, 'no request carries a narration, the file name or the account number' + (leaked.length ? ' — ' + leaked.join(' ') : ''));
  await ctx.close();

  /* ── F7 · rule 13 ── */
  for (const theme of ['cream', 'dark']) for (const vp of [{ width: 1366, height: 768 }, { width: 390, height: 844 }]) {
    const tag = theme + '-' + vp.width;
    ({ ctx, p } = await open(S, { theme, vp }));
    await load(p);
    /* the store read repaints the page after the line first shows and closes an open More menu: open it again until it stays (slower CI runner) */
    for (let k = 0; k < 4 && !(await p.locator('[data-testid="bank-tab-brs"]').isVisible()); k++) { await p.click('[data-testid="bank-more"]'); await p.waitForTimeout(400); }
    await p.click('[data-testid="bank-tab-brs"]');
    await p.waitForTimeout(300);
    const m = (await p.evaluate(measure)).filter((x) => !x.grad && x.ratio < x.need);
    ok('F7', m.length === 0, tag + ': AA contrast for every text' + (m.length ? ' — ' + m.slice(0, 3).map((x) => '"' + x.text + '" ' + x.ratio + ' < ' + x.need).join(' · ') : ''));
    const g = await p.evaluate(() => {
      const host = document.querySelector('[data-testid="bank-store"]'), r = host.getBoundingClientRect();
      return { dsw: document.documentElement.scrollWidth, iw: innerWidth, right: r.right, hsw: host.scrollWidth, hcw: host.clientWidth, app: document.querySelectorAll('a[href*="app.html"]').length };
    });
    ok('F7', g.dsw <= g.iw && g.hsw <= g.hcw + 1 && g.right <= g.iw + 1, tag + ': nothing scrolls sideways (page ' + g.dsw + '/' + g.iw + ', panel ' + g.hsw + '/' + g.hcw + ')');
    ok('F7', g.app === 0, tag + ': no link to app.html');
    await p.screenshot({ path: path.join(SHOTS, 'walk-bank-store-' + tag + '.png') });
    await ctx.close();
  }

  ok('F0', threw.length === 0, 'no page error' + (threw.length ? ': ' + threw[0] : ''));
  const fin = C.finish(); ok('F0', fin[0], fin[1]);
  await b.close(); srv.close();
  console.log('\n  walk-bank-store: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('  XX  the harness stopped: ' + (e && e.stack || e)); process.exit(1); });
