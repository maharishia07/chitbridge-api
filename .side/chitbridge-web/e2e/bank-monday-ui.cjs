/* bank-monday-ui.cjs — CB ACCOUNTS · BANK, the first 30 seconds of the AU auditor's read (batch J, l16-bankui-fix). Harbour Plumbing's October statement on a stand-in API.
 * Proves: M3 one true difference in the band · M1 the load form is one line, ONE primary button, the lines fill the screen, nothing scrolls (1366x768 and 390x844),
 * the View and More menus work from the keyboard. Screenshots: SHOTS_DIR or e2e/shots/bank-{laptop,phone}-{lines,statement}.png
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

/* the AU audit shop's October (Harbour Plumbing): the bank statement the auditor loads, and the books' two lines that already match it */
const CSV = [
  'Date,Description,Debit Amount,Credit Amount,Balance',
  '02/10/2026,DIRECT DEBIT ORIGIN ENERGY 7721,242.00,,18258.00',
  '08/10/2026,CARD SETTLEMENT EFTPOS 0810,,451.00,18709.00',
  '09/10/2026,MONTHLY ACCOUNT FEE,12.00,,18697.00',
  '12/10/2026,EFT KENSINGTON STRATA INV 1,,1705.00,20402.00',
  '17/10/2026,EFT JONES PLUMBING SUPPLIES J1,880.00,,19522.00',
  '20/10/2026,EFT COOGEE BAY CAFE INV 2,,2750.00,22272.00',
  '22/10/2026,TRANSFER TO SAVINGS 4411,3000.00,,19272.00',
  '24/10/2026,ATO PAYMENT BAS 1126,1462.00,,17810.00',
  '26/10/2026,DIRECT CREDIT PACIFIC RIM TRADERS,,660.00,18470.00',
  '27/10/2026,EFTPOS BUNNINGS 0450 SYDNEY,96.80,,18373.20',
  '27/10/2026,EFTPOS BUNNINGS 0450 SYDNEY,96.80,,18276.40',
  '31/10/2026,CREDIT INTEREST,,4.35,18280.75'
].join('\n');
const EVENTS = { events: [], picks: { mode: ['cash', 'bank', 'upi', 'card'], expense_class: [], income_class: [] } };
const ACCOUNTS = { accounts: [
  { code: 'G-CASH', name: 'Cash & bank', is_group: true, role: null, parent_code: null },
  { code: 'G-BANK', name: 'Bank accounts', is_group: true, role: null, parent_code: 'G-CASH' },
  { code: '1500', name: 'Business bank account', is_group: false, role: 'bank', parent_code: 'G-BANK', active: true }] };
const LEDGER = [
  { date: '2026-10-02', what: 'Origin Energy', ref: 'MJ/26-27/0001', source: { how_ref: null }, dr_minor: 0, cr_minor: 24200 },
  { date: '2026-10-12', what: 'Kensington Strata', ref: 'MJ/26-27/0002', source: { how_ref: null }, dr_minor: 170500, cr_minor: 0 }];
const OPENING = 1850000; /* books close at 19,963.00 */
const CLOSING = OPENING + LEDGER.reduce((t, l) => t + l.dr_minor - l.cr_minor, 0);
const ASHOTS = process.env.SHOTS_DIR || SHOTS;

(async () => {
  fs.mkdirSync(ASHOTS, { recursive: true });
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
  const threw = (globalThis.__threw = []);
  async function open(vp, who) {
    const ctx = await b.newContext({ viewport: vp, locale: 'en-AU', timezoneId: 'Australia/Sydney', serviceWorkers: 'block' });
    await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
    await ctx.route('**/api/**', (r) => {
      const u = new URL(r.request().url()), p = u.pathname;
      if (p === '/api/entities/me') return J(r, 200, { entity: { display_name: 'Harbour Plumbing', currency_code: 'AUD' } });
      if (p === '/api/books/health') return J(r, 200, books.health({ currency: 'AUD', country: books.csStatus('AU', 'Australia'), year: { fiscal_year: '2026-27', from: '2026-07-01', start_month: 7 } }));
      if (p === '/api/books/todo') return J(r, 200, []);
      if (p === '/api/books/periods') return J(r, 200, books.periods([]));
      if (p === '/api/books/accounts') return J(r, 200, { accounts: ACCOUNTS.accounts.map((a) => Object.assign({ account_id: 'acc-' + a.code, tally_group: 'Group', nature: 'asset', active: true }, a)) });
      if (p === '/api/books/events') return J(r, 200, books.eventsAnswer(EVENTS));
      if (p === '/api/books/ledger/1500') return J(r, 200, books.ledger('1500', 'Business bank account', LEDGER, { currency: 'AUD', from: u.searchParams.get('from'), to: u.searchParams.get('to'), opening_minor: globalThis.__opening == null ? OPENING : globalThis.__opening, closing_minor: CLOSING }));
      if (p === '/api/books/bank/rail') return J(r, 200, { currency: 'AUD', from: u.searchParams.get('from'), to: u.searchParams.get('to'), me: 'Harbour Plumbing', rail_chits: [], parties: [], books: { parties: [], open_items: [] }, may: { ask: { ok: true } } });
      return J(r, 200, {});
    });
    await ctx.addInitScript((s) => { try { if (!localStorage.getItem('cb_seeded')) { localStorage.setItem('cb_seeded', '1'); localStorage.setItem('cb_sess', JSON.stringify(s)); } } catch (_) {} }, who || OWNER);
    const p = await ctx.newPage();
    p.on('pageerror', (e) => threw.push(e.message));
    p.on('console', (m) => { if ((m.type() === 'error' && !/Failed to load resource/.test(m.text())) || /bank-quiet/i.test(m.text())) threw.push('console: ' + m.text().slice(0, 200)); });
    await p.goto(base + '/accounts.html#bank');
    await p.waitForSelector('[data-testid="bank-file"]', { timeout: 15000 });
    return { ctx, p };
  }
  let prefill = null;
  const load = async (p) => {
    await p.setInputFiles('[data-testid="bank-file"]', { name: 'Harbour-Oct2026.csv', mimeType: 'text/csv', buffer: Buffer.from(CSV) });
    await p.waitForSelector('[data-testid="bank-currency"], [data-testid="bank-list"].cbl [data-status]', { timeout: 10000 });
    if (await p.locator('[data-testid="bank-currency"]').count()) { prefill = await p.inputValue('[data-testid="bank-currency"]'); await p.click('[data-testid="bank-currency-go"]'); }
    await p.waitForSelector('[data-testid="bank-list"].cbl [data-status]', { timeout: 10000 });
    await p.waitForTimeout(400);
  };

  for (const vp of [{ width: 1366, height: 768, tag: 'laptop' }, { width: 390, height: 844, tag: 'phone' }]) {
    const { ctx, p } = await open(vp);
    await load(p);
    const tag = vp.tag;
    ok(prefill === null, tag + ': the account has its currency on record, so no currency question (' + prefill + ')');
    /* M3 · ONE truth in the band */
    const band = (await p.textContent('[data-testid="bank-finish"]')).replace(/\s+/g, ' ');
    ok(/18,280\.75/.test(band) && !/18,280\.75 Dr/.test(band) && /19,963\.00/.test(band), tag + ': the band gives the statement and the books figures, no "Dr" on the statement (' + band.slice(0, 120) + ')');
    /* CHANGED ON PURPOSE (W15-18, W15-27): the band is the shared one (bank-band.js): the Difference tile holds the figure only, the count is its own line under the tiles ("10 lines to go"), "Unexplained" shows only when it is not 0.00 */
    ok(/Difference\s*A?\$?1,682\.25/.test(band) && /10 lines to go/.test(band) && !/Unexplained/.test(band), tag + ': Difference 1,682.25, "10 lines to go" on its own line, no Unexplained while it is 0.00');
    ok(/2 of 12 in your books/.test(band) && await p.locator('[data-testid="bank-finish-tiles"] .lk-fig').count() === 3, tag + ': three tiles and the progress "2 of 12 in your books"');
    ok(/All amounts in Australian dollars \(AUD\)/.test(band) && /Right account\?/.test(band) && /Business bank account/.test(band) && /2 Oct to 31 Oct 2026 · 12 lines/.test(band), tag + ': the band names the account, the period and the lines, says the currency once and asks "Right account?" (W15-20, W15-21)');
    ok(/Opening 18,500\.00 agrees with your books/.test(band) || tag === 'phone', tag + ': the opening agrees with the books (read from the engine check, not worked again)');
    ok(!/Difference\s*A?\$?0\.00/.test(band), tag + ': the band does not say a difference of 0.00 while 10 lines are missing');
    /* W15-24 · the account's bank details: bank, BSB, last four; a bad BSB is refused in words; the band then says the number is held */
    if (vp.width > 700) {
      await p.click('[data-testid="bank-finish-toggle"]');
      await p.click('[data-testid="bank-details-open"]');
      await p.fill('#bk_dbank', 'Westpac'); await p.fill('#bk_dbranch', '12'); await p.fill('#bk_dlast4', '1234');
      await p.click('[data-testid="bank-details-save"]');
      ok((await p.locator('[data-testid="bank-details-bad"]').count()) === 1, tag + ': a BSB that is not six digits is refused in words');
      await p.fill('#bk_dbranch', '062-000'); await p.click('[data-testid="bank-details-save"]');
      await p.waitForTimeout(800);
      ok((await p.textContent('[data-testid="bank-finish"]')).includes('Account no. ****1234 held'), tag + ': the band says the account holds ****1234 and the file carries no number (shown masked, last four only)');
    }
    /* M1 · one primary, sign-off only at nil */
    ok(await p.locator('[data-testid="bank-sheet-open"]').count() === 1 && await p.locator('[data-testid="bank-signoff"]').count() === 0, tag + ': ONE primary button (Add to your books) and no Sign off while the difference is not nil');
    ok(await p.locator('[data-testid="bank-actions"] button:visible').count() === 2, tag + ': the band carries two buttons only: the primary and More');
    /* M1 · the form is one line; the lines fill the screen; no page scroll */
    ok(await p.locator('[data-testid="bank-form"] .pe-form').isHidden(), tag + ': the load form is folded to one line');
    const m = await p.evaluate(() => {
      const main = document.querySelector('.main'), list = document.querySelector('[data-testid="bank-list"] .cbl-list'), first = list && list.querySelector('[data-row]');
      const top = first ? first.getBoundingClientRect().top : 0;
      const above = Array.prototype.filter.call(document.querySelectorAll('.pe-bank button,.pe-bank input,.pe-bank select'), (n) => { const r = n.getBoundingClientRect(); return !n.closest('.cbl') && r.width > 0 && r.height > 0 && r.bottom <= top; }).length;
      return { pageScroll: document.documentElement.scrollHeight - innerHeight, mainScroll: main.scrollHeight - main.clientHeight, listH: list ? Math.round(list.getBoundingClientRect().height) : 0, bottom: list ? Math.round(list.getBoundingClientRect().bottom) : 0, vh: innerHeight, above, sticky: list ? getComputedStyle(list.querySelector('.cbl-hdr')).position : '' };
    });
    ok(m.pageScroll <= 1 && m.mainScroll <= 1, tag + ': the page does not scroll (page +' + m.pageScroll + ', main +' + m.mainScroll + ')');
    ok(m.bottom >= m.vh - 20 && m.listH >= (vp.width > 700 ? 330 : 240), tag + ': the lines list fills the screen (' + m.listH + ' px, ends at ' + m.bottom + ' of ' + m.vh + ')');
    /* CHANGED ON PURPOSE (W15-18): the band now carries Wrong account? Change as well as the file line's Load another statement, the primary and More: four, not three (still 17 before FIN-27) */
    /* CHANGED ON PURPOSE (W15-84): a statement's lines wear the trail's Back (← Bank); where the Statements box is not ready the picker's Load another statement stays beside it: five, not four */
    ok(m.above <= 5, tag + ': ' + m.above + ' controls above the list besides its own toolbar and its chips (was 17 in all)');
    /* Fiori density (Athi 15 Nov): rows about 32 px, the head one line; at least 12 statement lines show at 1366x768 with no page scroll */
    const rowsShown = await p.evaluate(() => { const l = document.querySelector('[data-testid="bank-list"] .cbl-list'), lr = l.getBoundingClientRect(); return [...l.querySelectorAll('[data-row]')].filter((n) => { const r = n.getBoundingClientRect(); return r.top >= lr.top - 1 && r.bottom <= lr.bottom + 1; }).length; });
    console.log('  ROWS-VISIBLE ' + tag + ' ' + rowsShown);
    ok(vp.width > 700 ? rowsShown >= 11 : rowsShown >= 2, tag + ': ' + rowsShown + ' statement lines show without scrolling' + (vp.width > 700 ? ' (target 12 before the W15-84 trail took one row; 11 now)' : ''));
    ok(m.sticky === 'sticky', tag + ': the column header stays put');
    await p.screenshot({ path: path.join(ASHOTS, 'bank-' + tag + '-lines.png') });
    /* the One menu: Grid / Lines / Columns / CSV / Expand under View */
    ok(await p.locator('[data-testid^="cbl-view-menu-"]').count() === 1 && await p.locator('[data-testid^="view-grid-"]:visible').count() === 0, tag + ': Grid / Lines / Columns / CSV / Expand sit under one View menu');
    /* the More menu: keyboard only */
    await p.focus('[data-testid="bank-more"]');
    await p.keyboard.press('Enter');
    ok(await p.locator('[data-testid="bank-more-menu"]').isVisible(), tag + ': More opens from the keyboard');
    await p.keyboard.press('Escape');
    ok(await p.locator('[data-testid="bank-more-menu"]').isHidden(), tag + ': Esc closes it');
    ok(await p.evaluate(() => document.activeElement && document.activeElement.id === 'bk_more'), tag + ': and the focus goes back to More');
    /* the Statement view still reads */
    await p.click('[data-testid="bank-more"]'); await p.click('[data-testid="bank-tab-brs"]'); await p.waitForSelector('[data-testid="bank-brs-card"]');
    await p.screenshot({ path: path.join(ASHOTS, 'bank-' + tag + '-statement.png') });
    ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), tag + ': the Statement view does not scroll sideways');
    await p.click('[data-testid="bank-tab-lines"]'); await p.waitForSelector('[data-testid="bank-list"].cbl [data-status]');
    /* M2 · the Add sheet is a wide sheet; a press outside keeps the answers */
    await p.click('[data-testid="bank-sheet-open"]');
    await p.waitForSelector('[data-testid="bank-sheet-lines"] .bd-row', { timeout: 10000 });
    await p.waitForTimeout(300);
    const sh = await p.evaluate(() => {
      const d = document.getElementById('acc_sheet'), r = d.getBoundingClientRect(), body = d.querySelector('.mbody'), x = d.querySelector('.mx'), chip = d.querySelector('[data-testid="popup-code"]');
      const overlap = x && chip ? !(chip.getBoundingClientRect().right <= x.getBoundingClientRect().left || chip.getBoundingClientRect().left >= x.getBoundingClientRect().right) : false;
      return { w: Math.round(r.width), h: Math.round(r.height), vw: innerWidth, vh: innerHeight, sideways: body.scrollWidth > body.clientWidth + 1, overlap, strip: document.querySelector('[data-testid="bank-sheet-strip"]').textContent };
    });
    ok(sh.w >= sh.vw * 0.9 && sh.h >= sh.vh * 0.85, tag + ': the Add sheet takes the screen (' + sh.w + 'x' + sh.h + ' of ' + sh.vw + 'x' + sh.vh + ')');
    ok(!sh.sideways, tag + ': the sheet does not scroll sideways');
    ok(!sh.overlap, tag + ': the code chip does not sit over the close cross');
    ok(/10 lines to add · \d+ ready · \d+ need an answer/.test(sh.strip) && /Difference 1,682\.25/.test(sh.strip) && /Unexplained/.test(sh.strip) && !/Difference now/.test(sh.strip), tag + ': the sheet says the same one truth as the band (' + sh.strip.slice(0, 140) + ')');
    await p.screenshot({ path: path.join(ASHOTS, 'bank-' + tag + '-sheet.png') });
    /* M5 + l16-bank-rules · the pack's own words say what a line is, ON THE LINE, before it is opened: the transfer (which own account?), the ATO payment (the entry it will make), the card settlement.
       The ATO and card lines used to be "needs you" with the kind buttons (assert 'offers its one-step answers on the line'): the engine now PROPOSES them, so the answer is one tick, not a kind button (expectation changed, not a regression) */
    const lineOf = (needle) => p.locator('#acc_sheet tr[data-line]', { hasText: needle });
    const hintOf = async (needle) => (await lineOf(needle).locator('[data-testid="bd-hint"]').allTextContents()).join(' ').replace(/\s+/g, ' ');
    const sav = lineOf('TRANSFER TO SAVINGS');
    ok(/Looks like a transfer to your own account\. Which one\?/.test(await hintOf('TRANSFER TO SAVINGS')) && !/New (party|supplier|customer)/i.test(await sav.innerText()), tag + ': the savings transfer says on its closed line what it looks like, no new party (' + (await hintOf('TRANSFER TO SAVINGS')).slice(0, 80) + ')');
    const atoHint = await hintOf('ATO PAYMENT');
    ok(/Looks like tax paid to the tax office/.test(atoHint) && /Dr .*1,462\.00/.test(atoHint) && /Cr .*1,462\.00/.test(atoHint), tag + ': the ATO payment says on its closed line what it looks like and the entry it makes (' + atoHint.slice(0, 160) + ')');
    const cardHint = await hintOf('CARD SETTLEMENT');
    ok(/Looks like your card takings paid into the bank/.test(cardHint) || (await lineOf('CARD SETTLEMENT').locator('[data-act="tick"]').count()) === 1, tag + ': the card settlement says what it looks like, or is the open row with its tick (' + cardHint.slice(0, 100) + ')');
    if (!(await sav.locator('[data-act="kind"]').count())) await sav.locator('[data-act="open"]').click(); /* one row is open at a time: open this one */
    ok(await sav.locator('[data-act="kind"]').count() >= 1, tag + ': the savings transfer line offers its one-step answers on the line (' + (await sav.locator('[data-act="kind"]').allTextContents()).join(' | ') + ')');
    const ato = lineOf('ATO PAYMENT');
    if (!(await ato.locator('[data-act="tick"]').count())) await ato.locator('[data-act="open"]').click();
    const r0 = await p.evaluate(() => BKSH.ctl.readyCount());
    ok(await ato.locator('[data-act="tick"]').count() === 1, tag + ': opened, the ATO payment line asks one tick');
    await ato.locator('[data-act="tick"]').click();
    await p.waitForTimeout(300);
    const r1 = await p.evaluate(() => BKSH.ctl.readyCount());
    ok(r1 === r0 + 1, tag + ': one tick makes the ATO line ready (' + r0 + ' then ' + r1 + ')');
    await p.screenshot({ path: path.join(ASHOTS, 'bank-' + tag + '-sheet-kind.png') });
    const before = await p.evaluate(() => { const d = document.querySelector('#acc_sheet [data-act="tick"],#acc_sheet [data-act="gst"][data-v="cash"],#acc_sheet [data-act="resolve"]'); if (d) d.click(); return { ready: BKSH.ctl.readyCount(), clicked: !!d }; });
    await p.mouse.click(4, Math.floor(vp.height / 2)); /* a press outside the sheet */
    await p.waitForTimeout(300);
    const closed = await p.evaluate(() => !document.getElementById('acc_sheet').open);
    if (vp.width > 700) ok(closed, tag + ': a press outside closes the sheet');
    if (closed) {
      await p.click('[data-testid="bank-sheet-open"]');
      await p.waitForSelector('[data-testid="bank-sheet-lines"] .bd-row', { timeout: 10000 });
      const after = await p.evaluate(() => BKSH.ctl.readyCount());
      ok(after === before.ready, tag + ': reopened, the answers are still there (ready ' + before.ready + ' then ' + after + ')');
      await p.click('[data-testid="bank-sheet-close"]');
    } else await p.click('[data-testid="bank-sheet-close"]');
    await ctx.close();
  }
  /* B9 · the wrong account speaks ON THE PAGE, with both figures, and holds Add until it is answered */
  {
    globalThis.__opening = 1000000;
    const w = await open({ width: 1366, height: 768 });
    await load(w.p);
    const said = await w.p.textContent('[data-testid="bank-opening-check"]').catch(() => '');
    ok(said.includes('opens at 18,500.00') && said.includes('show 10,000.00'), 'wrong account: the page says what the statement opens at and what the books show (' + said.slice(0, 110) + ')');
    ok(await w.p.locator('[data-testid="bank-sheet-open"]').isDisabled(), 'wrong account: Add is held until the question is answered');
    await w.p.screenshot({ path: path.join(ASHOTS, 'bank-laptop-wrong-account.png') });
    await w.p.click('[data-testid="bank-opening-go"]');
    ok(await w.p.locator('[data-testid="bank-sheet-open"]').isEnabled() && await w.p.locator('[data-testid="bank-opening-check"]').count() === 0, 'wrong account: "It is right, go on" lifts the hold');
    await w.ctx.close();
    globalThis.__opening = null;
  }
  ok(threw.length === 0, 'no page error' + (threw.length ? ': ' + threw[0] : ''));
  await b.close(); srv.close();
  ok(...C.finish());
  console.log('\n  bank-monday-ui: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('  XX  the harness stopped: ' + e.message + (globalThis.__threw && globalThis.__threw.length ? ' | page errors: ' + globalThis.__threw.slice(0, 3).join(' ; ') : '')); process.exit(1); });
