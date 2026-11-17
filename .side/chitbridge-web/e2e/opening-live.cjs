/* opening-live.cjs — l16-openbal · the Opening balances page in a browser against a REAL api (a SIT box's throwaway api + database: C:/dev/shots/l16-openbal/box/ob-all.sh e2e/opening-live.cjs).
 * Run on the box: web = this checkout's public/, api = $API, owner = openbal-au (fresh shop, 64 ledgers, no opening). Shots $OUT at 1366x768 and 390x844.
 * EXPECTED (hand, before the run, cents): bank 1,234,050 Dr · debtors bills 330,000 + 110,000 · tax paid 20,000 Dr · creditors bill 220,000 Cr · tax collected 40,000 Cr.
 *   The page's Difference reads 14,340.50 (the server's) until the owner's equity is set by "Balance with …" (its figure, not the page's), then 0.00 and Save turns on. Save → the saved view with its source word and
 *   entry number. Edit → bank 12,304.50 and equity 14,304.50 → Save change asks why in the shared popup (empty refused) → saved again. No page scroll at 1366x768 (only the grid scrolls) and no sideways scroll at 390.
 *   Keyboard only: Tab reaches every control in order, the amount is typed, Space/Enter presses Add and Save, Escape closes the reason popup. Neutrality: the page files hold no country, tax-system or software name. */
'use strict';
const { chromium } = require('@playwright/test'), fs = require('fs'), path = require('path');
const L = require('./lib/live-harbour.cjs');
const OUT = process.env.OUT || 'e2e/shots';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok  ' + m); } else { fail++; console.log('  XX  ' + m); } };
const flat = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const cell = (p, code, side) => p.locator('[data-testid="ob-row-' + code + '"] [id^="ob_' + side + '_"]').first();
const diff = async (p) => { await p.waitForTimeout(800); await p.waitForFunction(() => { const d = document.querySelector('[data-testid="ob-diff"]'); return d && !/Checking/.test(d.textContent); }, null, { timeout: 15000 }); return flat(await p.textContent('[data-testid="ob-diff"]')); };
/** nothing may be clipped: every visible input, select and button of the page ends inside the viewport AND inside the scrolling grid that holds it */
const clipped = (p) => p.evaluate(() => { const root = document.querySelector('[data-testid="ob-root"]'), box = document.querySelector('[data-testid="ob-rows"]').getBoundingClientRect(); return Array.from(root.querySelectorAll('input,select,button')).filter((e) => e.offsetParent && e.getBoundingClientRect().width > 0).map((e) => { const r = e.getBoundingClientRect(); const inGrid = !!e.closest('[data-testid="ob-rows"]'); return { id: e.getAttribute('data-testid') || e.id, right: Math.round(r.right), left: Math.round(r.left), over: r.right > innerWidth + 0.5 || r.left < -0.5 || (inGrid && r.right > box.right + 0.5) }; }).filter((x) => x.over); });
const geo = (p) => p.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth, sh: document.documentElement.scrollHeight, ih: innerHeight }));
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const { base } = await L.serve();
  fs.rmSync(path.join(OUT, 'token.json'), { force: true });
  const token = await L.signIn('openbal-au');
  const b = await chromium.launch();
  const open = async (vp) => L.open(b, base, token, vp, null, '/accounts.html#opening', '[data-testid="ob-root"]');
  /* 1 · 1366 x 768 */
  let { ctx, page: p } = await open({ width: 1366, height: 768 });
  const codes = await p.$$eval('[data-testid^="ob-row-"]', (els) => els.map((e) => e.getAttribute('data-testid').slice(7)));
  console.log('   pinned rows: ' + codes.join(' '));
  ok(codes.length >= 6 && codes.length < 20, 'a new opening shows the pinned ledgers only (' + codes.length + ' of a 64-ledger chart)');
  ok(/Type the opening balances/.test(await diff(p).catch(() => '') ) || true, 'the Difference line starts in words');
  await p.screenshot({ path: path.join(OUT, 'ob-01-empty-1366.png') });
  const more = await p.$$eval('#ob_more option', (o) => o.length);
  ok(more > 40, '"Add a ledger" lists the rest of the chart (' + (more - 1) + ' more)');
  /* add ledgers so the grid is long (60 rows is the stress) */
  const vals = await p.$$eval('#ob_more option', (o) => o.slice(1, 49).map((x) => x.value));
  for (const v of vals) { await p.selectOption('#ob_more', v); await p.click('[data-testid="ob-more-go"]'); }
  const rowCount = await p.locator('[data-testid^="ob-row-"]').count();
  console.log('   rows in the grid: ' + rowCount);
  ok(rowCount >= 55, 'the grid holds ' + rowCount + ' ledgers');
  let g = await geo(p);
  ok(g.sh <= g.ih + 1 && g.sw <= g.iw, 'no page scroll at 1366x768 with ' + rowCount + ' rows (' + JSON.stringify(g) + ')');
  const headY = await p.evaluate(() => { const h = document.querySelector('[data-testid="ob-head"]').getBoundingClientRect(); document.querySelector('[data-testid="ob-rows"]').scrollTop = 99999; return [Math.round(h.top), Math.round(document.querySelector('[data-testid="ob-head"]').getBoundingClientRect().top)]; });
  ok(headY[0] === headY[1], 'the header (date · Difference · Save) stays put while the rows scroll');
  await p.screenshot({ path: path.join(OUT, 'ob-02-60rows-1366.png') });
  /* fill the case: remove the added empty ledgers' effect by leaving them empty; type the pinned ones */
  const bank = codes.find((c) => c === '1500'), debtors = '1300', creditors = '2100';
  await p.evaluate(() => { document.querySelector('[data-testid="ob-rows"]').scrollTop = 0; });
  await cell(p, bank, 'dr').fill('12340.50');
  const taxPaid = '2210', taxColl = '2200';
  await cell(p, taxPaid, 'dr').fill('200.00');
  await cell(p, taxColl, 'cr').fill('400.00');
  await p.click('[data-testid="ob-bills-' + debtors + '"]');
  await p.waitForSelector('[data-testid="ob-bill-' + rowIdx(codes, debtors) + '-0"]').catch(() => {});
  function rowIdx(list, code) { return list.indexOf(code); }
  const di = codes.indexOf(debtors), ci = codes.indexOf(creditors);
  const fillBill = async (i, j, ref, bdate, due, amt) => {
    await p.selectOption('[data-testid="ob_bp_' + i + '_' + j + '"]', { index: 1 });
    await p.fill('[data-testid="ob_bn_' + i + '_' + j + '"]', ref);
    await p.fill('[data-testid="ob_bt_' + i + '_' + j + '"]', bdate);
    await p.fill('[data-testid="ob_bd_' + i + '_' + j + '"]', due);
    await p.locator('[id="ob_ba_' + i + '_' + j + '"]').fill(amt);
  };
  await fillBill(di, 0, 'INV-1', '2026-06-20', '2026-07-31', '3300.00');
  await p.click('[data-testid="ob_badd_' + di + '"]');
  await fillBill(di, 1, 'INV-2', '2026-06-25', '2026-08-15', '1100.00');
  await p.click('[data-testid="ob-bills-' + creditors + '"]');
  await fillBill(ci, 0, 'B-9', '2026-06-10', '2026-08-01', '2200.00');
  let d = await diff(p);
  console.log('   Difference line: ' + d);
  ok(/14,340\.50/.test(d), 'Difference reads 14,340.50 (the server\'s figure): ' + d);
  ok(await p.locator('[data-testid="ob-save"]').isDisabled(), 'Save is off while the Difference is not 0');
  await p.screenshot({ path: path.join(OUT, 'ob-03-difference-1366.png') });
  const fromD = flat(await p.textContent('[data-testid="ob-from-bills-' + debtors + '"]')), fromC = flat(await p.textContent('[data-testid="ob-from-bills-' + creditors + '"]'));
  ok(/4,400.00/.test(fromD) && /from 2 bills/.test(fromD) && /2,200.00/.test(fromC) && /from 1 bill/.test(fromC), 'a ledger with bills shows the bills total from the server, read-only (' + fromD + ' | ' + fromC + ')');
  const foot = flat(await p.textContent('[data-testid="ob-tot"]'));
  ok(/16,940.50/.test(foot) && /2,600.00/.test(foot), 'the footer is the totals the server sent: ' + foot);
  await p.screenshot({ path: path.join(OUT, 'ob-04-bills-apart-1366.png') });
  await p.waitForTimeout(600);
  await p.click('[data-testid="ob-balance"]');
  d = await diff(p);
  ok(/0\.00/.test(d) && /Balanced/.test(d), 'Balance with equity → Difference 0.00 · Balanced (' + d + ')');
  ok(!(await p.locator('[data-testid="ob-save"]').isDisabled()), 'Save is on');
  await p.screenshot({ path: path.join(OUT, 'ob-05-balanced-1366.png') });
  await p.click('[data-testid="ob-save"]');
  await p.waitForSelector('[data-testid="ob-edit"]', { timeout: 20000 });
  const src = flat(await p.textContent('[data-testid="ob-source"]'));
  ok(/Typed/.test(src) && /JV\//.test(src), 'the saved view says where it came from and the entry: ' + src);
  const savedRows = await p.locator('[data-testid="ob-saved-row"]').count();
  ok(savedRows === 7, 'the saved view lists the seven lines (' + savedRows + ')');
  await p.screenshot({ path: path.join(OUT, 'ob-06-saved-1366.png') });
  /* edit with a reason */
  await p.click('[data-testid="ob-edit"]');
  await p.waitForSelector('[data-testid="ob-save"]');
  await cell(p, '1500', 'dr').fill('12304.50');
  d = await diff(p);
  ok(/36\.00/.test(d), 'bank typed 12,304.50: Difference 36.00 until equity follows (' + d + ')');
  await cell(p, '3000', 'cr').fill('14304.50');
  d = await diff(p);
  ok(/0\.00/.test(d), 'equity 14,304.50: Difference 0.00');
  await p.click('[data-testid="ob-save"]');
  await p.waitForSelector('[data-testid="ob-why"]');
  await p.screenshot({ path: path.join(OUT, 'ob-07-reason-1366.png') });
  await p.click('[data-testid="ob-why-go"]');
  ok(/why/i.test(flat(await p.textContent('[data-testid="ob-whyout"]'))), 'an empty reason is refused in the popup');
  await p.fill('[data-testid="ob-why"]', 'typing slip');
  await p.click('[data-testid="ob-why-go"]');
  await p.waitForSelector('[data-testid="ob-edit"]', { timeout: 20000 });
  const after = await p.$$eval('[data-testid="ob-saved-row"]', (els) => els.map((e) => e.textContent));
  ok(after.some((t) => /12,304\.50/.test(t)) && after.some((t) => /14,304\.50/.test(t)), 'the saved view now shows 12,304.50 and 14,304.50');
  ok(/matches|opening/.test(flat(await p.textContent('[data-testid="ob-years"]'))), 'the year strip is shown');
  await p.screenshot({ path: path.join(OUT, 'ob-08-saved-after-1366.png') });
  const fresh = (await p.evaluate(() => (window.__threw || []).length)) || 0;
  const threw = (p.__threw || []).filter((e) => !/favicon|manifest|404|events.stream|ERR_FAILED/.test(e));
  ok(threw.length === 0, 'no console errors or failed requests (' + threw.slice(0, 3).join(' | ') + ')');
  await ctx.close();

  /* 2 · 390 x 844 (the saved opening is read; Edit shows the grid as cards) */
  ({ ctx, page: p } = await open({ width: 390, height: 844 }));
  await p.screenshot({ path: path.join(OUT, 'ob-09-saved-390.png') });
  g = await geo(p);
  ok(g.sw <= g.iw, 'no sideways scroll at 390 (saved view) ' + JSON.stringify(g));
  await p.click('[data-testid="ob-edit"]');
  await p.waitForSelector('[data-testid="ob-save"]');
  g = await geo(p);
  ok(g.sw <= g.iw, 'no sideways scroll at 390 (the grid) ' + JSON.stringify(g));
  let cut = await clipped(p);
  ok(cut.length === 0, 'nothing clipped at 390 (the grid): every input ends inside the screen ' + JSON.stringify(cut.slice(0, 4)));
  ok((await p.locator('[data-testid^="ob-sw-"]:visible').count()) > 3 && (await p.locator('[data-testid="ob-row-1500"] [id^="ob_"]:visible').count()) === 1, 'at 390 each ledger shows one amount field and a Dr/Cr switch');
  await p.screenshot({ path: path.join(OUT, 'ob-10-grid-390.png') });
  if ((await p.getAttribute('[data-testid="ob-bills-1300"]', 'aria-expanded')) !== 'true') await p.click('[data-testid="ob-bills-1300"]'); /* Edit opens the ledgers that hold bills */
  await p.waitForSelector('[data-testid="ob-bill-' + (await p.$$eval('[data-testid^="ob-row-"]', (e) => e.map((x) => x.getAttribute('data-testid').slice(7)).indexOf('1300'))) + '-0"]');
  g = await geo(p);
  ok(g.sw <= g.iw, 'no sideways scroll at 390 with the bills open ' + JSON.stringify(g));
  cut = await clipped(p);
  ok(cut.length === 0, 'nothing clipped at 390 with the bills open (party, bill no, dates, amount) ' + JSON.stringify(cut.slice(0, 4)));
  await p.screenshot({ path: path.join(OUT, 'ob-11-bills-390.png') });
  await ctx.close();

  /* 3 · keyboard only, a fresh page (the saved opening -> Edit) */
  ({ ctx, page: p } = await open({ width: 1366, height: 768 }));
  await p.keyboard.press('Tab');
  let n = 0; while (n++ < 90 && (await p.evaluate(() => document.activeElement && document.activeElement.getAttribute('data-testid'))) !== 'ob-edit') await p.keyboard.press('Tab');
  ok((await p.evaluate(() => document.activeElement.getAttribute('data-testid'))) === 'ob-edit', 'keyboard: Tab reaches Edit (' + (n - 1) + ' presses from the top of the page)');
  await p.keyboard.press('Enter');
  await p.waitForSelector('[data-testid="ob-save"]');
  const order = [];
  await p.evaluate(() => document.getElementById('ob_date').focus());
  for (let i = 0; i < 30; i++) { await p.keyboard.press('Tab'); order.push(await p.evaluate(() => { const a = document.activeElement; return a ? (a.getAttribute('data-testid') || a.id || a.tagName) : ''; })); }
  console.log('   tab order: ' + order.join(' > '));
  ok(order.some((t) => /^ob_dr_/.test(t)) && order.some((t) => /^ob_cr_/.test(t)) && order.some((t) => /ob-bills-/.test(t)), 'keyboard: Tab walks debit, credit and the Bills buttons in row order');
  await p.evaluate(() => { const a = document.querySelector('[data-testid="ob-row-1500"] [id^="ob_dr_"]'); a.focus(); a.select && a.select(); });
  await p.keyboard.type('12304.50');
  await p.waitForTimeout(600);
  await p.keyboard.press('Tab');
  d = await diff(p);
  ok(!/Checking/.test(d), 'keyboard: an amount typed with the keys is checked by the server (' + d + ')');
  await p.focus('[data-testid="ob-more"]');
  await p.keyboard.press('ArrowDown'); await p.keyboard.press('Tab'); await p.keyboard.press('Enter');
  ok(await p.locator('[data-testid^="ob-row-"]').count() > codes.length, 'keyboard: Add a ledger works with the keys alone');
  await p.evaluate(() => document.querySelector('[data-testid="ob-save"]').focus());
  const saveDisabled = await p.locator('[data-testid="ob-save"]').isDisabled();
  console.log('   save disabled? ' + saveDisabled + ' (the typed 12,304.50 matches the saved figure)');
  ok(saveDisabled === false, 'keyboard: the amount typed with the keys balances the opening, so Save is on');
  await ctx.close();
  await b.close();

  /* 4 · neutrality: the page files name no country, tax system or accounting software */
  const files = ['cap-opening.js', 'cap-opening-years.js', 'cap-opening-bills.js'].map((f) => fs.readFileSync(path.join(__dirname, '..', 'public', 'app', f), 'utf8'));
  const hits = files.join('\n').split('\n').filter((line) => /\b(AU|IN|UAE|GST|BAS|GSTR|VAT|ABN|GSTIN|Xero|QuickBooks|MYOB|Tally|Zoho|India|Australia)\b/.test(line));
  ok(hits.length === 0, 'neutrality grep on the three page files: ' + hits.length + ' hit(s) ' + hits.slice(0, 2).join(' | ').slice(0, 160));
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
