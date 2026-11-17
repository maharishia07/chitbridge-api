/* adviser-bank-live.cjs — l16/adviser-bank: the firm's person (Bayside Bookkeeping, an ADVISER grant that posts) opens a THROWAWAY CLONE of Bondi Electrical through "Open books", loads Bondi's October statement on the ONE Bank page,
 * answers the lines, adds them and takes the difference to 0.00; then the owner reads who did it. Figures are EXPECTED.md's (hand-computed before the run): mismatch, not recompute.
 * Run on the box (ab-e2e.sh): web = this checkout's public/, api = $API (a throwaway api on a copy of the box db), firm = $FIRM_HANDLE, owner = $OWNER_HANDLE. Shots: $OUT (1366x768, and 390x844 for the page).
 * Never production: lib/live-harbour refuses railway/vercel. The tester code never touches a file: it comes from the box's own environment. */
'use strict';
const { chromium } = require('@playwright/test'), fs = require('fs'), path = require('path');
const L = require('./lib/live-harbour.cjs');
const OUT = process.env.OUT || 'e2e/shots';
const ENT = process.env.ENT || 'a32a7c20-b7d5-43fc-9074-e02d10fd9c61';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok  ' + m); } else { fail++; console.log('  XX  ' + m); } };
const flat = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const CSV = () => fs.readFileSync(fs.existsSync('/w/Bondi-Electrical-Oct2026-bank-statement.csv') ? '/w/Bondi-Electrical-Oct2026-bank-statement.csv' : path.join(__dirname, 'fixtures', 'bondi-oct.csv'));
const band = async (p) => flat(await p.textContent('[data-testid="bank-finish"]'));
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const { base } = await L.serve();
  const firmToken = await L.signIn(process.env.FIRM_HANDLE || 'bayside-books-au');
  const b = await chromium.launch();

  /* 1 OPEN BOOKS from the firm's client list: no 403 */
  const ctx0 = await b.newContext({ viewport: { width: 1366, height: 768 }, locale: 'en-AU', timezoneId: 'Australia/Sydney', serviceWorkers: 'block' });
  await ctx0.addInitScript((s) => { try { if (!localStorage.getItem('cb_seeded')) { localStorage.setItem('cb_seeded', '1'); localStorage.setItem('cb_sess', JSON.stringify(s)); } } catch (_) {} }, { token: firmToken, role: 'entity', name: 'Bayside Bookkeeping - demo', entity: 'Bayside Bookkeeping - demo' });
  await ctx0.route('http://localhost:3000/**', async (r) => { if (r.request().url().includes('/events/stream')) return r.abort(); const u = new URL(r.request().url()), hs = Object.assign({}, r.request().headers()); delete hs.origin; delete hs.referer; const got = await r.fetch({ url: L.API + u.pathname + u.search, headers: hs }); return r.fulfill({ response: got, headers: Object.assign({}, got.headers(), { 'access-control-allow-origin': base, 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': '*' }) }); });
  const net = await ctx0.newPage(), bad = [];
  net.on('response', (r) => { if (r.status() === 403) bad.push(r.status() + ' ' + r.url().slice(-70)); });
  await net.goto(base + '/network.html');
  await net.waitForTimeout(4000);
  const bondiRow = net.locator('tr, li, [data-testid]', { hasText: /Bondi Electrical/ }).filter({ has: net.locator('button, a', { hasText: /Open book/ }) }).last();
  const open = bondiRow.locator('button, a', { hasText: /Open book/ }).first();
  console.log('   Bondi row: ' + flat(await bondiRow.innerText().catch(() => 'NONE')).slice(0, 200));
  console.log('   Open books buttons: ' + await net.locator('button, a', { hasText: /Open books/ }).count() + ' | texts: ' + JSON.stringify(await net.locator('button, a', { hasText: /Open books/ }).evaluateAll((els) => els.map((e) => (e.closest('tr,li,.card,div') || e).innerText.replace(/\s+/g, ' ').slice(0, 90)))));
  await net.screenshot({ path: path.join(OUT, 'ab-00-network-1366.png') });
  const hadOpen = await open.count();
  const popup = ctx0.waitForEvent('page', { timeout: 8000 }).catch(() => null);
  if (await open.count()) { await open.click(); await net.waitForTimeout(6000); }
  const pop = await popup; const target = pop || net; if (pop) { await pop.waitForTimeout(4000); target.on('response', () => {}); }
  console.log('   pages: ' + JSON.stringify(ctx0.pages().map((x) => x.url().slice(-60))));
  console.log('   after Open books: ' + target.url().slice(-80) + ' | 403s: ' + JSON.stringify(bad));
  ok(hadOpen > 0 && (await target.locator('#ba_band, .ba-band').count()) > 0 && bad.length === 0, 'Open books opens the client books workspace (Acting for Bondi), no 403');
  await target.screenshot({ path: path.join(OUT, 'ab-01-open-books-1366.png') });
  await net.unrouteAll({ behavior: 'ignoreErrors' }).catch(() => {});
  await ctx0.close();

  /* 2 the Bank page, as the adviser, on the clone */
  const { ctx, page: p } = await L.open(b, base, firmToken, { width: 1366, height: 768 }, 'Bayside Bookkeeping - demo', '/accounts.html?acting=' + ENT + '#bank');
  p.on('pageerror', (e) => console.log('PAGEERROR ' + e.message.slice(0, 300)));
  ok(await p.locator('[data-testid="bank-file"]').count() === 1, 'the Bank tab opens for the adviser (the one Bank page, acting for the client)');
  ok(/Acting for Bondi/.test(flat(await p.textContent('body'))), 'the frozen banner says who the page acts for');
  await p.screenshot({ path: path.join(OUT, 'ab-02-bank-open-1366.png') });
  await p.setInputFiles('[data-testid="bank-file"]', { name: 'Bondi-Electrical-Oct2026.csv', mimeType: 'text/csv', buffer: CSV() });
  await p.waitForSelector('[data-testid="bank-currency"], [data-testid="bank-list"].cbl [data-status]', { timeout: 25000 });
  if (await p.locator('[data-testid="bank-currency"]').count()) { console.log('   NOTE the currency was asked'); await p.click('[data-testid="bank-currency-go"]'); }
  await p.waitForSelector('[data-testid="bank-list"].cbl [data-status]', { timeout: 25000 });
  await p.waitForTimeout(1500);
  let bd = await band(p);
  console.log('   band before: ' + bd);
  ok(/Statement\s*13,298\.65/.test(bd) && /Books\s*12,935\.00/.test(bd) && /Difference\s*363\.65/.test(bd), 'EXPECTED.md: statement 13,298.65, books 12,935.00, difference 363.65 (' + bd.slice(0, 120) + ')');
  await p.screenshot({ path: path.join(OUT, 'ab-03-statement-loaded-1366.png') });

  /* 3 answer the lines */
  await p.click('[data-testid="bank-sheet-open"]');
  await p.waitForSelector('[data-testid="bank-sheet-lines"] .bd-row', { timeout: 25000 });
  await p.waitForTimeout(900);
  const lines = '[data-testid="bank-sheet-lines"]';
  const pause = () => p.waitForTimeout(450);
  let presses = 0;
  const press = async (loc) => { presses++; console.log('   press ' + presses + ': ' + flat(await loc.first().innerText().catch(() => '?')).slice(0, 60)); await loc.first().click(); await pause(); };
  const choose = async (loc, what) => { presses++; console.log('   press ' + presses + ': choose ' + JSON.stringify(what)); await loc.first().selectOption(what); await pause(); };
  await p.screenshot({ path: path.join(OUT, 'ab-04-sheet-1366.png') });
  console.log('   strip: ' + flat(await p.textContent('[data-testid="bank-sheet-strip"]').catch(() => '')));
  for (const row of await p.$$eval(lines + ' .bd-row', (els) => els.map((e) => e.innerText.replace(/\s+/g, ' ').slice(0, 200)))) console.log('   row: ' + row);
  for (let round = 0; round < 30; round++) {
    const basis = p.locator(lines + ' button[data-act=gst][data-v=accrual]');
    if (await basis.count()) { await press(basis); continue; }
    const open1 = p.locator(lines + ' .bd-row.bd-is-open').first();
    if (!(await open1.count())) break;
    const text = flat(await open1.innerText());
    console.log('   OPEN: ' + text.slice(0, 260));
    const more = open1.locator('button[data-act=more]');
    const dump = async (what) => { const c = await open1.locator('button, select, input').evaluateAll((els) => els.map((e) => e.tagName + ' ' + (e.getAttribute('data-act') || '') + '=' + (e.getAttribute('data-v') || '') + ' ' + (e.tagName === 'SELECT' ? [...e.options].map((o) => o.value + ':' + o.text).join('|').slice(0, 400) : (e.innerText || '').replace(/\s+/g, ' ').slice(0, 60)))); console.log('   CONTROLS ' + what + ': ' + JSON.stringify(c)); };
        if (/MONTHLY ACCOUNT FEE/.test(text) && await open1.locator('select[data-act=taxkind1]').count()) await choose(open1.locator('select[data-act=taxkind1]'), { label: 'Input-taxed supply' });
    else if (/KOOKABURRA/.test(text) && ((await more.count()) || (await open1.locator('select[data-act=acct]').count()))) { if (await more.count()) await press(more); await dump('kiosk'); { const opts = await open1.locator('select[data-act=acct]').first().evaluate((e) => [...e.options].map((o) => o.value + ':' + o.text)); console.log('   ACCT OPTIONS ' + JSON.stringify(opts)); const pick = opts.find((o) => /general|sundry|miscellaneous|other expense/i.test(o)) || opts[2]; await choose(open1.locator('select[data-act=acct]'), pick.split(':')[0]); } if (await open1.locator('select[data-act=taxkind]').count()) await choose(open1.locator('select[data-act=taxkind]'), 'gst_free'); }
    else if (await open1.locator('button[data-act=tick]').count()) await press(open1.locator('button[data-act=tick]'));
    else if (await open1.locator('button[data-act=inv][data-v=held]').count()) await press(open1.locator('button[data-act=inv][data-v=held]'));
    else { console.log('   UNHANDLED open row: ' + text); const btns = await open1.locator('button, select').evaluateAll((els) => els.map((e) => e.tagName + ' ' + (e.getAttribute('data-act') || '') + '=' + (e.getAttribute('data-v') || '') + ' ' + (e.innerText || '').replace(/\s+/g, ' ').slice(0, 50))); console.log('   CONTROLS: ' + JSON.stringify(btns)); break; }
  }
  console.log('PRESSES: ' + presses);
  for (const row of await p.$$eval(lines + ' .bd-row', (els) => els.map((e) => e.innerText.replace(/\s+/g, ' ').slice(0, 220)))) console.log('   row: ' + row);
  await p.screenshot({ path: path.join(OUT, 'ab-05-answered-1366.png') });
  const addBtn = p.locator('#acc_sheet button', { hasText: /Add (these )?\d* ?(ready )?lines?/ }).first();
  console.log('   add button: ' + flat(await addBtn.innerText().catch(() => 'NONE')));
  if (await addBtn.count()) {
    await addBtn.click();
    await p.waitForTimeout(900);
    console.log('   confirm: ' + flat(await p.locator('[role=dialog], dialog[open]').last().innerText().catch(() => '')).slice(0, 300));
    await p.screenshot({ path: path.join(OUT, 'ab-06-confirm-1366.png') });
    await p.locator('[role=dialog] button, dialog[open] button', { hasText: /^(Yes|Add|Confirm|Post)/ }).last().click();
    await p.waitForTimeout(9000);
    await p.screenshot({ path: path.join(OUT, 'ab-07-posted-1366.png') });
    console.log('   after: ' + flat(await p.locator('#acc_sheet').innerText().catch(() => '')).slice(0, 400));
    await p.keyboard.press('Escape');
    await p.waitForTimeout(1500);
  }
  bd = await band(p);
  console.log('   band after: ' + bd);
  ok(/Difference\s*0\.00/.test(bd), 'AFTER ADDING: Difference 0.00 (' + bd.slice(0, 160) + ')');
  await p.screenshot({ path: path.join(OUT, 'ab-08-nil-1366.png') });

  /* 4 sign off: "Signed off by <name>, <firm>" */
  const signBtn = p.locator('[data-testid="bank-signoff"]');
  if (await signBtn.count()) {
    await signBtn.click();
    await p.waitForTimeout(600);
    await p.locator('[role=dialog] button, dialog[open] button', { hasText: /^Sign off$/ }).last().click();
    await p.waitForTimeout(3500);
  }
  const signed = flat(await p.locator('[data-testid="bank-signed-line"]').first().innerText().catch(() => ''));
  console.log('   signed line: ' + signed);
  ok(/Reconciled by .*Bayside Bookkeeping - demo on 15 Nov 2026/.test(signed) && !/[0-9a-f]{8}-[0-9a-f]{4}/.test(signed), 'the sign-off reads "Signed off by <name>, Bayside Bookkeeping - demo" (' + signed + ')');
  await p.screenshot({ path: path.join(OUT, 'ab-09-signed-1366.png') });
  await p.setViewportSize({ width: 390, height: 844 });
  await p.waitForTimeout(700);
  await p.screenshot({ path: path.join(OUT, 'ab-10-bank-390.png') });
  const scrolls = await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2);
  ok(!scrolls, 'the Bank page at 390x844 has no sideways scroll');
  await ctx.close();

  /* 5 the owner reads it: the bank log, the Day book, who looked / what they did */
  fs.rmSync(path.join(OUT, 'token.json'), { force: true }); /* the sign-in cache is one file: never hand the firm's token to the owner */
  const ownerToken = await L.signIn(process.env.OWNER_HANDLE || 'bondi-electric-au');
  const log = (await L.call('GET', '/api/books/bank/log?account=1500', ownerToken)).body;
  const byFirm = (log.posted || []).filter((r) => r.by_firm === 'Bayside Bookkeeping - demo').length;
  console.log('   owner bank log: posted ' + (log.posted || []).length + ', by Bayside ' + byFirm + ', statements ' + JSON.stringify((log.statements || []).map((s) => [s.by_name, s.by_firm, s.difference_minor])));
  ok(byFirm >= 6 && (log.statements || []).some((s) => s.by_firm === 'Bayside Bookkeeping - demo' && s.difference_minor === 0), 'the owner\'s bank log names Bayside on the added lines and the nil sign-off');
  const day = (await L.call('GET', '/api/books/daybook?from=2026-10-01&to=2026-10-31&limit=200', ownerToken)).body;
  const posted = (day.entries || []).filter((e) => e.posted_by && e.posted_by.firm === 'Bayside Bookkeeping - demo');
  console.log('   owner Day book: ' + (day.entries || []).length + ' entries, ' + posted.length + ' posted by Bayside');
  ok(posted.length >= 6, 'the owner\'s Day book says which entries Bayside posted');
  const looks = (await L.call('GET', '/api/books-grants/log', ownerToken)).body;
  const rows = looks.looks || looks.rows || looks.log || [];
  const wrote = (Array.isArray(rows) ? rows : []).filter((r) => /POST \/(events|payments|bank\/marks|bank\/statements)/.test(String(r.route_pattern || '')));
  console.log('   owner looks: ' + (Array.isArray(rows) ? rows.length : '?') + ' rows, ' + wrote.length + ' bank writes by ' + JSON.stringify([...new Set(wrote.map((r) => r.actor_entity_name))]));
  ok(wrote.length >= 6, 'the owner\'s who-looked list shows Bayside\'s bank writes');
  const bk = await L.call('GET', '/api/books/trial-balance?asOf=2026-10-31', ownerToken);
  const tb = {}; for (const r of (bk.body.rows || [])) tb[r.code] = [r.dr_minor, r.cr_minor];
  console.log('   owner trial balance: ' + JSON.stringify(tb));
  ok(JSON.stringify(tb['1500']) === JSON.stringify([1329865, 0]), 'EXPECTED.md: bank 13,298.65 Dr (' + JSON.stringify(tb['1500']) + ')');
  ok(JSON.stringify(tb['1300']) === JSON.stringify([66000, 0]) && JSON.stringify(tb['2100']) === JSON.stringify([0, 55000]), 'EXPECTED.md: receivables 660.00, payables 550.00 (' + JSON.stringify([tb['1300'], tb['2100']]) + ')');
  /* 6 the grant view's Day book: ONE painter, the Party · ref cell carries a second line "posted by ..." only for an entry the firm posted; both lines at 390 */
  fs.rmSync(path.join(OUT, 'token.json'), { force: true });
  const firm2 = await L.signIn(process.env.FIRM_HANDLE || 'bayside-books-au');
  for (const vp of [{ width: 1366, height: 768, tag: '1366' }, { width: 390, height: 844, tag: '390' }]) {
    const { ctx: c2, page: g } = await L.open(b, base, firm2, vp, 'Bayside Bookkeeping - demo', '/network.html', 'body');
    await g.waitForTimeout(4000);
    const row = g.locator('tr, li, [data-testid]', { hasText: /Bondi Electrical/ }).filter({ has: g.locator('button, a', { hasText: /Open book/ }) }).last();
    await row.locator('button, a', { hasText: /Open book/ }).first().click();
    await g.waitForTimeout(3500);
    await g.locator('#bv_tab_daybook').click();
    await g.waitForTimeout(1500);
    await g.locator('#bv_day').fill('2026-10-29');
    await g.locator('#bv_day').dispatchEvent('change');
    await g.waitForTimeout(4000);
    const cells = await g.locator('[data-testid="bv-posted-by"]').evaluateAll((els) => els.map((e) => e.innerText.replace(/\s+/g, ' ')));
    const vis = await g.locator('[data-testid="bv-posted-by"]').first().isVisible().catch(() => false);
    console.log('   Day book ' + vp.tag + ' posted-by lines: ' + JSON.stringify(cells) + ' visible ' + vis);
    ok(cells.length >= 1 && cells[0].replace(/\s+/g, ' ').trim() === 'posted by Bayside Bookkeeping - demo' && vis, 'Day book ' + vp.tag + ': the Party · ref cell shows "posted by Bayside Bookkeeping - demo" as a second line');
    await g.screenshot({ path: path.join(OUT, 'ab-11-daybook-posted-by-' + vp.tag + '.png') });
    await c2.close();
  }
  fs.rmSync(path.join(OUT, 'token.json'), { force: true });
  await b.close();
  console.log('\n' + pass + ' ok, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('ERR ' + (e.stack || e.message)); process.exit(2); });
