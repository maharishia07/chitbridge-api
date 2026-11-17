/* bank-recon-page.cjs — CB ACCOUNTS · BANK, RECONCILED ON THE DEVICE, PROVED (DECISIONS: "Bank reconciliation runs on the SHOP'S DEVICE" · app/cap-bank.js).
 * Pattern: todo-home.cjs — Playwright, a stand-in API answering INSIDE the page, a free port for the static server; nothing leaves the machine.
 *
 *  1  a sample CSV (HDFC-shaped) is chosen → parsed IN THE BROWSER → GET /api/books/ledger/1500 for the statement's dates (and nothing else) → matched:
 *     2 matched (by reference), 3 suggested (charge · interest · ATM), 1 bank-only (an unknown NEFT), 1 in the books but not on the statement (a cheque not presented)
 *  2  ⭐ NO REQUEST CARRIES THE FILE: no url, header or body of any request contains a line, a narration, the file name or its text
 *  3  "Add missing" on the charge opens the ＋ Entry preview with the suggested event already placed (expense · bank_charges · paid from bank · the amount and the date);
 *     Save posts ONE entry through POST /events with client_ref = bank:<file hash>:<line no>; the page fetches the ledger again and the line is now matched
 *  4  the Statement (BRS) ties: books vs bank, every reconciling item named, difference nothing
 *  5  a co-assist reads the lines and is offered no Add; a file that is not a statement is refused in plain words; 390 px: nothing scrolls sideways
 * Screenshots: e2e/shots/bank-{lines,brs}-laptop.png · bank-lines-phone.png · bank-brs-phone.png
 */
'use strict';
const { chromium } = require('@playwright/test');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..'), PUB = path.join(ROOT, 'public'), SHOTS = path.join(__dirname, 'shots');
const T = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok  ' + m); } else { fail++; console.log('  XX  ' + m); } };
const C = require('./lib/contract.cjs'), books = require('./lib/books-api.cjs');   /* every answer served for a route in the API contract is checked (e2e/fixtures/web-api.contract.json) */
const J = C.json;
const tok = (c) => { const e = (o) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_'); return e({ alg: 'none' }) + '.' + e(Object.assign({ exp: Math.floor(Date.now() / 1000) + 3600 }, c)) + '.x'; };
const OWNER = { token: tok({ identity_id: 'ent-M', identity_type: 'entity' }), role: 'entity', name: 'Mayur', entity: 'Mayur Bhavan' };
const RAVI = { token: tok({ identity_id: 'act-1', identity_type: 'actor', parent_entity_id: 'ent-M', parent_entity_name: 'Mayur Bhavan', display_name: 'Ravi' }), role: 'actor', name: 'Ravi', entity: 'Mayur Bhavan' };

const CSV = [
  'Account No: 50100123456789',
  'Date,Narration,Chq./Ref.No.,Value Dt,Withdrawal Amt.,Deposit Amt.,Closing Balance',
  '01/09/26,UPI-RAVI STORES-ravi@okbank-ZZMARKER7731,UPI0001,01/09/26,,12000.00,112000.00',
  '05/09/26,CHQ PAID-0001234-KV TRADERS,0001234,05/09/26,5000.00,,107000.00',
  '10/09/26,SMS ALERT CHARGES,,10/09/26,23.60,,106976.40',
  '15/09/26,INT.PD:01-07-2026 to 30-09-2026,,15/09/26,,540.00,107516.40',
  '20/09/26,ATM WDL ATM-NFS-123,,20/09/26,2000.00,,105516.40',
  '25/09/26,NEFT-UNKNOWN PARTY XYZ,N123456,25/09/26,,3500.00,109016.40',
].join('\n');
const SECRETS = ['ZZMARKER7731', 'KV TRADERS', 'SMS ALERT', 'UNKNOWN PARTY', 'statement.csv', 'N123456', '50100123456789', '109016.40', '10901640'];

const EVENTS = { events: [
  { kind: 'expense', words: 'Pay expense', icon: 'receipt', band: 'paid', preview: true, fields: [{ key: 'class', kind: 'pick', pick: 'expense_class', required: true }, { key: 'amount', kind: 'amount' }, { key: 'paid_from', kind: 'pick', pick: 'mode' }, { key: 'date', kind: 'date' }, { key: 'narration', kind: 'text' }] },
  { kind: 'other_income', words: 'Other income', icon: 'coins', band: 'received', preview: true, fields: [{ key: 'class', kind: 'pick', pick: 'income_class', required: true }, { key: 'amount', kind: 'amount' }, { key: 'into', kind: 'pick', pick: 'mode' }, { key: 'date', kind: 'date' }, { key: 'narration', kind: 'text' }] },
  { kind: 'contra', words: 'Move money', icon: 'swap', band: 'money', preview: true, fields: [{ key: 'from', kind: 'pick', pick: 'mode' }, { key: 'to', kind: 'pick', pick: 'mode' }, { key: 'amount', kind: 'amount' }, { key: 'date', kind: 'date' }, { key: 'narration', kind: 'text' }] }],
  picks: { mode: ['cash', 'bank', 'upi', 'card'], expense_class: [{ role: 'bank_charges', code: '6090', name: 'Bank charges' }], income_class: [{ role: 'interest_received', code: '4210', name: 'Interest received' }] } };
const ACCOUNTS = { accounts: [
  { code: 'G-CASH', name: 'Cash & bank', is_group: true, role: null, parent_code: null },
  { code: '1000', name: 'Cash', is_group: false, role: 'cash', parent_code: 'G-CASH' },
  { code: 'G-BANK', name: 'Bank accounts', is_group: true, role: null, parent_code: 'G-CASH' },
  { code: '1500', name: 'Bank', is_group: false, role: 'bank', parent_code: 'G-BANK', active: true },
  { code: '6090', name: 'Bank charges', is_group: false, role: 'bank_charges', parent_code: 'G-EXP' }] };

function stand() {
  const S = { reqs: [], bodies: [], ledgerCalls: [] };
  S.lines = [
    { date: '2026-09-01', what: 'Receipt: Ravi Stores', ref: 'MJ/26-27/0001', source: { how_ref: 'UPI0001' }, dr_minor: 1200000, cr_minor: 0 },
    { date: '2026-09-05', what: 'Payment: KV Traders', ref: 'MJ/26-27/0002', source: { how_ref: '0001234' }, dr_minor: 0, cr_minor: 500000 },
    { date: '2026-09-24', what: 'Cheque to Sharma Supplies', ref: 'MJ/26-27/0003', source: { how_ref: '0007788' }, dr_minor: 0, cr_minor: 250000 }];
  S.opening = 10000000;
  return S;
}
const closing = (S) => S.opening + S.lines.reduce((t, l) => t + l.dr_minor - l.cr_minor, 0);   /* the stand-in's own ledger arithmetic, standing in for the API's */

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
  const threw = [], offHost = [];

  async function open(S, who, vp) {
    const ctx = await b.newContext({ viewport: vp || { width: 1360, height: 900 }, locale: 'en-IN', timezoneId: 'Asia/Kolkata', serviceWorkers: 'block' });
    await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => { offHost.push(r.request().url()); return r.abort(); });
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    /* EVERY request the page makes is recorded whole — url, headers, body — so "no request carries the file" is checked on all of them, not only the API's */
    ctx.on('request', (rq) => { S.reqs.push({ m: rq.method(), u: rq.url(), h: JSON.stringify(rq.headers()), d: rq.postData() || '' }); });
    await ctx.route('**/api/**', (r) => {
      const u = new URL(r.request().url()), p = u.pathname, m = r.request().method();
      let body = null; try { body = r.request().postDataJSON(); } catch (_) {} if (m !== 'GET') S.bodies.push({ m, p, body });
      if (p === '/api/entities/me') return J(r, 200, { entity: { display_name: 'Mayur Bhavan', currency_code: 'INR' } });
      if (p === '/api/books/health') return J(r, 200, books.health());
      if (p === '/api/books/todo') return J(r, 200, []);
      if (p === '/api/books/accounts') return J(r, 200, { accounts: ACCOUNTS.accounts.map((a) => Object.assign({ account_id: 'acc-' + a.code, tally_group: 'Group', nature: 'asset', active: true }, a)) });
      if (p === '/api/books/events' && m === 'GET') return J(r, 200, books.eventsAnswer(EVENTS));
      if (p === '/api/books/ledger/1500') { S.ledgerCalls.push(u.search); return J(r, 200, books.ledger('1500', 'Bank', S.lines, { from: u.searchParams.get('from'), to: u.searchParams.get('to'), opening_minor: S.opening, closing_minor: closing(S) })); }
      if (p === '/api/books/preview') return J(r, 200, { ok: true, kind: body.event, voucher: { series: 'MJ', type: 'Payment' }, date: body.date, balanced: true, totals: { dr_minor: body.amount_minor, cr_minor: body.amount_minor }, refusals: [], flags: [], credit: null, bill: null, code: null, duplicate: null,
        lines: [{ code: '6090', ledger: 'Bank charges', dr_minor: body.amount_minor, cr_minor: 0, type: 'nominal', rule: 'Dr expenses and losses' }, { code: '1500', ledger: 'Bank', dr_minor: 0, cr_minor: body.amount_minor, type: 'real', rule: 'Cr what goes out' }] });
      if (p === '/api/books/events' && m === 'POST') { S.lines.push({ date: body.date, what: body.narration, ref: 'MJ/26-27/0030', source: { how_ref: null }, dr_minor: 0, cr_minor: 2360 }); return J(r, 200, Object.assign({ kind: body.kind || body.event }, books.posted({ entry_no: 'MJ/26-27/0030', entry_id: 'e30' }))); }
      if (p === '/api/books/dues') return J(r, 200, books.dues([]));
      if (p === '/api/books/bank/rail') return J(r, 200, { currency: 'INR', from: u.searchParams.get('from'), to: u.searchParams.get('to'), me: 'Mayur Bhavan', books: { parties: [], open_items: [] }, rail_chits: [], parties: [], may: { ask: { ok: true } } });   /* BR1: nobody told us anything here — the lines match the books alone */
      return J(r, 200, {});
    });
    await ctx.addInitScript((s) => { try { if (!localStorage.getItem('cb_seeded')) { localStorage.setItem('cb_seeded', '1'); localStorage.setItem('cb_sess', JSON.stringify(s)); } } catch (_) {} }, who || OWNER);
    const p = await ctx.newPage();
    p.on('pageerror', (e) => { threw.push(e.message); if (process.env.DEBUG_PE) console.log('  !! pageerror: ' + e.message); });
    await p.goto(base + '/accounts.html#bank');
    await p.waitForSelector('[data-testid="bank-file"]', { timeout: 15000 });
    return { ctx, p };
  }
  const load = async (p, csv) => { if (await p.locator('[data-testid="bank-change"]').isVisible() && !(await p.locator('#bk_preset').isVisible())) await p.click('[data-testid="bank-change"]'); /* the form folds once a statement is on screen */ await p.selectOption('#bk_preset', 'hdfc'); await p.setInputFiles('[data-testid="bank-file"]', { name: 'statement.csv', mimeType: 'text/csv', buffer: Buffer.from(csv || CSV) }); await p.waitForSelector('[data-testid="bank-currency"], [data-testid="bank-list"].cbl [data-status], [data-testid="bank-refuse"], .pe-bad', { timeout: 10000 }); if (await p.locator('[data-testid="bank-currency"]').isVisible()) { await p.fill('[data-testid="bank-currency"]', 'INR'); await p.click('[data-testid="bank-currency-go"]'); } }; /* B5-05: the file's currency is asked */
  const status = (p, s) => p.locator('[data-status="' + s + '"]').count();
  const noSide = async (p) => { await p.waitForTimeout(300); return p.evaluate(() => ({ d: document.documentElement.scrollWidth, m: document.querySelector('.main').scrollWidth <= document.querySelector('.main').clientWidth })); };

  /* ── 1 · PARSE → FETCH → MATCH ── */
  const S = stand(), { ctx, p } = await open(S);
  ok((await p.evaluate(() => document.querySelector('.nav-btn.active').getAttribute('aria-label'))) === 'Bank', 'Bank opens, lit in the sidebar');
  ok(/never uploaded/.test(await p.textContent('[data-testid="bank-private"]')), 'the page says, in one line, that the file is never uploaded');
  ok(await p.locator('#bk_acct option').count() === 1 && (await p.textContent('#bk_acct')).trim() === 'Bank', 'the bank accounts come from the chart (the one with role bank and its siblings), not Cash');
  await load(p);
  await p.waitForSelector('[data-testid="bank-list"].cbl [data-status]', { timeout: 10000 });
  const c = { matched: await status(p, 'matched'), suggested: await status(p, 'suggested'), bankOnly: await status(p, 'bank-only'), missing: await status(p, 'missing') };
  ok(c.matched === 2 && c.suggested === 3 && c.bankOnly === 1 && c.missing === 1, 'matched 2 · suggested 3 · bank-only 1 · not on the statement 1 (' + JSON.stringify(c) + ')');
  ok(S.ledgerCalls.length === 1 && S.ledgerCalls[0] === '?from=2026-09-01&to=2026-09-25', 'the ledger is read once, for the statement\'s dates only (' + S.ledgerCalls[0] + ')');
  ok(await p.locator('[data-testid="bank-group-matched"]').count() === 1 && /2/.test(await p.textContent('[data-testid="bank-group-matched"]')) && /4 lines need you/.test(await p.textContent('[data-testid="bank-notice"]')), 'the head says the counts and "4 lines need you"');
  await p.screenshot({ path: path.join(SHOTS, 'bank-lines-laptop.png') });

  /* ── 2 · NO REQUEST CARRIES THE FILE ── */
  const leaks = S.reqs.filter((r) => SECRETS.some((s) => (r.u + r.h + r.d).indexOf(s) >= 0));
  ok(leaks.length === 0, 'no request (url, header or body) carries a line, a narration, the file name or its text' + (leaks.length ? ' — ' + leaks.map((l) => l.m + ' ' + l.u).join(', ') : ''));
  ok(S.reqs.every((r) => r.m === 'GET' || !/statement/i.test(r.u)) && S.bodies.filter((x) => /^\/api\/books\//.test(x.p)).length === 0, 'nothing has been posted yet — only reads (' + S.reqs.filter((r) => /\/api\//.test(r.u)).length + ' API calls, all GET)');

  /* ── 3 · ADD MISSING → ＋ ENTRY → ONE POST ── */
  const sms = await p.locator('[data-status="suggested"]').first().evaluate((e) => e.getAttribute('data-testid'));
  await p.click('[data-testid="' + sms.replace('bank-chip-', 'bank-row-') + '"] [data-caret]');
  ok(/Bank charge/.test(await p.textContent('[data-testid="bank-next-' + sms.replace('bank-chip-', '') + '"]')), 'the row opens to what it looks like ("Bank charge") and why');
  await p.click('[data-testid="bank-add"]');
  /* the Add button opens the ONE sheet (every line against the books), not a lone entry: the charge is a line of it, ready with what it would post */
  await p.waitForSelector('[data-testid="bank-sheet-lines"] .bd-row', { timeout: 10000 });
  const sheetRows = await p.$$eval('[data-testid="bank-sheet-lines"] .bd-row', (els) => els.map((e) => e.innerText.replace(/\s+/g, ' ')));
  if (process.env.DEBUG_PE) console.log(sheetRows.join(' // '));
  ok(sheetRows.length > 0 && sheetRows.some((t) => /23\.60/.test(t) && /bank charges/i.test(t)), 'Add missing opens the sheet with the charge placed (bank charges · 23.60)');
  ok(S.bodies.filter((x) => x.p === '/api/books/events').length === 0, 'the shop confirms: nothing is posted until the sheet is confirmed');
  const charge = p.locator('[data-testid="bank-sheet-lines"] .bd-row', { hasText: /23\.60/ }).first();
  for (const act of ['tick', 'inv', 'gst']) { const b2 = charge.locator('button[data-act=' + act + ']').first(); if (await b2.count()) { await b2.click(); await p.waitForTimeout(300); } }
  await p.locator('#acc_sheet button', { hasText: /Add \d+ to your books/ }).first().click();
  await p.locator('[role=dialog] button, dialog[open] button', { hasText: /^(Yes|Add|Confirm)/ }).last().click();
  await p.waitForFunction(() => !!document.querySelector('#acc_sheet') && /added to your books|Added/i.test(document.querySelector('#acc_sheet').innerText), null, { timeout: 8000 });
  const ev = S.bodies.filter((x) => x.p === '/api/books/events' && x.m === 'POST');
  ok(ev.length === 1 && /^bank:[0-9a-f]{24}-\d+$/.test(ev[0].body.client_ref), 'ONE entry posted through POST /events, client_ref = bank:<fingerprint>-<n> (' + (ev[0] && ev[0].body.client_ref) + ')');
  await p.keyboard.press('Escape');
  await p.waitForFunction(() => document.querySelectorAll('[data-status="suggested"]').length === 2, null, { timeout: 8000 });
  if (process.env.DEBUG_PE) console.log('STATUS', await p.$$eval('[data-status]', (e) => e.map((x) => x.getAttribute('data-status')).join(','))); await p.waitForTimeout(1500);
  ok(await status(p, 'matched') + await status(p, 'accepted') === 3 && await status(p, 'suggested') === 2 && S.ledgerCalls.length >= 2, 'the ledger is read again and the line is now in the books (matched or accepted: 3) · suggested 2');
  await p.waitForFunction(() => document.querySelectorAll('[data-status="suggested"]').length === 2, null, { timeout: 8000 });
  const leaks2 = S.reqs.filter((r) => ['ZZMARKER7731', 'KV TRADERS', 'UNKNOWN PARTY', 'statement.csv', 'N123456', '50100123456789'].some((s) => (r.u + r.h + r.d).indexOf(s) >= 0));
  ok(leaks2.length === 0, 'still no request carries the file (the confirmed entry carries a date, an amount and the note the shop saw)');

  /* ── 4 · THE STATEMENT (BRS) ── */
  await p.click('[data-testid="bank-more"]'); await p.click('[data-testid="bank-tab-brs"]'); await p.waitForSelector('[data-testid="bank-brs-card"]');
  ok(await p.locator('[data-testid="brs-tied"]').count() === 1 && await p.locator('[data-testid="brs-untied"]').count() === 0, 'the BRS ties: "the books reconcile to the bank"');
  const brs = await p.textContent('[data-testid="bank-brs-card"]'); if (process.env.DEBUG_PE) console.log(brs.slice(0, 700));
  ok(/Balance as per books/.test(brs) && /1,04,476\.40/.test(brs) && /Balance as per bank/.test(brs) && /1,09,016\.40/.test(brs), 'books vs bank: books 1,04,476.40 Dr (the API\'s ledger figure after the new entry) and bank 1,09,016.40 Dr (the statement\'s) :: ' + brs.replace(/ +/g, ' ').replace(/\n/g, ' ').slice(0, 300));
  ok(await p.locator('[data-testid="brs-issued"] .pe-row').count() === 1 && await p.locator('[data-testid="brs-bankcr"] .pe-row').count() === 2 && await p.locator('[data-testid="brs-bankdr"] .pe-row').count() === 1, 'every reconciling item is named: 1 cheque not presented · 2 bank credits not in the books · 1 bank debit');
  ok(/Difference/.test(brs) && /0\.00/.test(brs.slice(brs.indexOf('Difference'))), 'the difference is nothing');
  await p.screenshot({ path: path.join(SHOTS, 'bank-brs-laptop.png') });
  ok(threw.length === 0, 'no page error' + (threw.length ? ': ' + threw[0] : ''));
  await ctx.close();

  /* ── 5 · A CO-ASSIST · A FILE THAT IS NOT A STATEMENT · PHONE ── */
  {
    const S2 = stand(), c2 = await open(S2, RAVI); await load(c2.p);
    await c2.p.waitForSelector('[data-testid="bank-list"].cbl [data-status]', { timeout: 10000 });
    await c2.p.click('[data-testid^="bank-row-"] [data-caret]');
    ok(await status(c2.p, 'suggested') === 3 && await c2.p.locator('[data-testid="bank-add"], [data-testid="bank-dues"]').count() === 0, 'a co-assist reads the lines and is offered no Add missing');
    await c2.ctx.close();
    const S3 = stand(), c3 = await open(S3); await load(c3.p, 'hello\nthis is not a statement');
    await c3.p.waitForSelector('[data-testid="pe-refused"]', { timeout: 8000 });
    const why = await c3.p.textContent('[data-testid="pe-refused"]');
    ok(why.trim().length > 5 && !/undefined|\[object|Error:/.test(why) && S3.ledgerCalls.length === 0, 'a file that is not a statement is refused in plain words, and the ledger is not even read (' + why.trim().slice(0, 70) + ')');
    await c3.ctx.close();
    const S4 = stand(), c4 = await open(S4, OWNER, { width: 390, height: 844 }); await load(c4.p);
    await c4.p.waitForSelector('[data-testid="bank-list"].cbl [data-status]', { timeout: 10000 });
    let m = await noSide(c4.p); ok(m.d === 390 && m.m, '390 px: the lines do not scroll sideways (' + m.d + ')');
    await c4.p.screenshot({ path: path.join(SHOTS, 'bank-lines-phone.png') });
    await c4.p.click('[data-testid="bank-more"]'); await c4.p.click('[data-testid="bank-tab-brs"]'); await c4.p.waitForSelector('[data-testid="bank-brs-card"]');
    m = await noSide(c4.p); ok(m.d === 390 && m.m, '390 px: the statement does not scroll sideways (' + m.d + ')');
    await c4.p.screenshot({ path: path.join(SHOTS, 'bank-brs-phone.png') });
    await c4.ctx.close();
  }

  ok(offHost.filter((u) => !/fonts\.g/.test(u)).length === 0, 'nothing but the stand-in was reachable' + (offHost.length ? ' — refused: ' + offHost.join(' ') : ''));
  await b.close(); srv.close();
  ok(...C.finish());
  console.log('\n  bank-recon-page: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('  XX  the harness stopped: ' + e.message); process.exit(1); });
