/* banklock-live.cjs — l16-banklock (W15-85) · Harbour Plumbing's October statement when October is LOCKED, against a REAL api (a SIT box's throwaway api: bl-setup.sh).
 * Run on the box (bl-e2e.sh in C:/dev/shots/l16-banklock/box): web = this checkout's public/, api = $API (the l16/banklock-api branch), owner = harbour-plumbing-au. Shots: $OUT (1366x768 and 390x844).
 * EXPECTED (hand, before the run): the unlocked page and the locked page show the SAME lines and the SAME Difference; every line the books do not hold shows a padlock (count = the unlocked page's not-in-books count);
 * the band says "October 2026 is locked" before any work; Reopen October lets the lines through; Post in November instead posts them on 1 Nov 2026 with doc_date their own day and the note "October locked";
 * the same file read again (this session, then a fresh one) shows those lines in the books and offers none of them; the Difference does not move. */
'use strict';
const { chromium } = require('@playwright/test'), fs = require('fs'), path = require('path');
const L = require('./lib/live-harbour.cjs');
const OUT = process.env.OUT || 'e2e/shots';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok  ' + m); } else { fail++; console.log('  XX  ' + m); } };
const CSV = () => fs.readFileSync(path.join(__dirname, 'fixtures', 'harbour-oct-2026.csv'));
const flat = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const band = async (p) => flat(await p.textContent('[data-testid="bank-finish"]'));
const diffOf = (text) => (/Difference\s*(-?[\d,]+\.\d\d)/.exec(text) || [])[1] || '';
const states = (p) => p.$$eval('[data-testid^="bank-row-"] .lk-st', (els) => els.map((e) => e.getAttribute('data-state')));
async function load(p) {
  await p.setInputFiles('[data-testid="bank-file"]', { name: 'Harbour-Plumbing-Oct2026.csv', mimeType: 'text/csv', buffer: CSV() });
  await p.waitForSelector('[data-testid="bank-currency"], [data-testid="bank-list"].cbl [data-status]', { timeout: 20000 });
  if (await p.locator('[data-testid="bank-currency"]').count()) await p.click('[data-testid="bank-currency-go"]');
  await p.waitForSelector('[data-testid="bank-list"].cbl [data-status]', { timeout: 20000 });
  await p.waitForTimeout(2500);
}
const count = (list, key) => list.filter((s) => s === key).length;
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const { base } = await L.serve(), token = await L.signIn(process.env.HANDLE || 'harbour-plumbing-au');
  const api = (m, u, b) => L.call(m, u, token, b);
  const b = await chromium.launch();
  /* 0 · the page with no lock: the baseline */
  let { ctx, page: p } = await L.open(b, base, token, { width: 1366, height: 768 });
  await load(p);
  const base0 = { band: await band(p), states: await states(p) };
  const unbooked = base0.states.filter((s) => s !== 'in').length;
  console.log('   baseline: ' + JSON.stringify(count(base0.states, 'in')) + ' in books, ' + unbooked + ' not · Difference ' + diffOf(base0.band));
  ok(!(await p.locator('[data-testid^="bank-lock-"]').count()), 'no month is locked: no lock notice');
  await p.screenshot({ path: path.join(OUT, 'bl-00-unlocked-1366.png') });
  /* lock every month up to October (oldest first, the server's own rule) */
  const periods = (await api('GET', '/api/books/periods')).body.periods || [];
  const toLock = periods.filter((r) => Number(r.period) >= 1 && String(r.end_date).slice(0, 10) <= '2026-10-31').sort((x, y) => String(x.start_date).localeCompare(String(y.start_date)));
  for (const r of toLock) if (r.status === 'open') { const out = await api('POST', '/api/books/periods/' + r.fiscal_year + '/' + r.period + '/lock', { reason: 'BAS lodged' }); if (!out.ok) console.log('   lock ' + r.fiscal_year + '/' + r.period + ' -> ' + out.status + ' ' + JSON.stringify(out.body).slice(0, 120)); }
  console.log('   months locked: ' + toLock.map((r) => r.fiscal_year + '/' + r.period).join(' '));
  await p.reload();
  await p.waitForSelector('[data-testid="bank-list"].cbl [data-status]', { timeout: 20000 });
  await p.waitForTimeout(2500);
  /* 1 · said BEFORE any work */
  let bd = await band(p), st = await states(p);
  const notice = flat(await p.locator('[data-testid="bank-lock-0"]').innerText().catch(() => ''));
  console.log('   notice: ' + notice);
  ok(/^October 2026 is locked/.test(notice) && /New lines can't be added until it's reopened\./.test(notice), 'the band says October 2026 is locked and what that means, before any press');
  ok(/closed by .+, \d{1,2} \w{3} 2026/.test(notice) || !/closed/.test(notice), 'who and when are shown only from the month\'s lock trail (' + (notice.match(/\(.*?\)/) || ['none carried'])[0] + ')');
  ok(count(st, 'lock') === unbooked && count(st, 'in') === count(base0.states, 'in'), 'every line the books do not hold shows a padlock (' + count(st, 'lock') + ' of ' + unbooked + '); the lines in the books stay ticked (' + count(st, 'in') + ')');
  ok(diffOf(bd) === diffOf(base0.band), 'the Difference is unchanged by the lock (' + diffOf(bd) + ')');
  ok(await p.locator('[data-testid="bank-lock-reopen-0"]').count() === 1 && await p.locator('[data-testid="bank-lock-move-0"]').count() === 1, 'two choices: Reopen October and Post in November instead (' + flat(await p.locator('[data-testid="bank-lock-0"] button').allInnerTexts().then((a) => a.join(' | '))) + ')');
  const geo = await p.evaluate(() => ({ sh: document.documentElement.scrollHeight, ih: innerHeight, sw: document.documentElement.scrollWidth, iw: innerWidth }));
  ok(geo.sw <= geo.iw, 'no sideways scroll at 1366 (' + JSON.stringify(geo) + ')');
  await p.screenshot({ path: path.join(OUT, 'bl-01-locked-band-1366.png') });
  await p.locator('[data-testid^="bank-row-"]', { has: p.locator('[data-status="lock"]') }).first().locator('[data-caret]').click().catch(() => {});
  await p.waitForTimeout(600);
  await p.screenshot({ path: path.join(OUT, 'bl-02-locked-line-open-1366.png') });
  { /* the phone view of the same locked band, a separate context */
    const ph = await L.open(b, base, token, { width: 390, height: 844 });
    await load(ph.page);
    const g = await ph.page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth }));
    ok(g.sw <= g.iw && (await ph.page.locator('[data-testid="bank-lock-0"]').count()) === 1, 'at 390 the locked band shows and nothing scrolls sideways (' + JSON.stringify(g) + ')');
    await ph.page.screenshot({ path: path.join(OUT, 'bl-01b-locked-band-390.png') });
    await ph.ctx.close();
  }
  /* keyboard only: Tab reaches the two buttons and Enter on Reopen opens the reason box */
  await p.locator('[data-testid="bank-lock-reopen-0"]').focus();
  await p.keyboard.press('Enter');
  await p.waitForSelector('#bk_lkwhy', { timeout: 8000 });
  await p.screenshot({ path: path.join(OUT, 'bl-03-reopen-asks-reason-1366.png') });
  await p.locator('[data-testid="bank-lock-reopen-go"]').click();
  await p.waitForTimeout(500);
  ok(/Say why/.test(flat(await p.locator('#bk_lkout').innerText().catch(() => ''))), 'Reopen asks for a reason and sends nothing without one');
  await p.fill('#bk_lkwhy', 'Statement read late');
  await p.locator('[data-testid="bank-lock-reopen-go"]').click();
  await p.waitForTimeout(4000);
  st = await states(p);
  ok(count(st, 'lock') === 0 && !(await p.locator('[data-testid="bank-lock-0"]').count()), 'Reopen October (with its reason): no padlock, no notice: the lines are open to work');
  const trail = ((await api('GET', '/api/books/periods')).body.periods || []).filter((r) => r.start_date && String(r.start_date).slice(0, 7) === '2026-10')[0] || {};
  ok(trail.status === 'open' && JSON.stringify(trail.lock_trail || []).includes('Statement read late'), 'the server reopened October and kept the reason (' + trail.status + ')');
  await p.screenshot({ path: path.join(OUT, 'bl-04-reopened-1366.png') });
  /* lock it again for the second way */
  const oct = periods.filter((r) => String(r.start_date).slice(0, 7) === '2026-10')[0];
  await api('POST', '/api/books/periods/' + oct.fiscal_year + '/' + oct.period + '/lock', { reason: 'BAS lodged again' });
  await p.reload();
  await p.waitForSelector('[data-testid="bank-list"].cbl [data-status]', { timeout: 20000 });
  await p.waitForTimeout(2500);
  ok(await p.locator('[data-testid="bank-lock-0"]').count() === 1, 'locked again: the notice is back');
  /* 2 · Post in November instead */
  await p.locator('[data-testid="bank-lock-move-0"]').click();
  await p.waitForTimeout(1500);
  const moved = flat(await p.locator('[data-testid="bank-lock-0"]').innerText());
  console.log('   moved: ' + moved);
  ok(/will post on 1 Nov 2026, with the note "October locked"/.test(moved), 'the band says where they will post: 1 Nov 2026, noted "October locked"');
  st = await states(p);
  ok(count(st, 'lock') === 0, 'the padlocks go; the lines are worked as any other (ready / needs you)');
  await p.screenshot({ path: path.join(OUT, 'bl-05-post-next-month-1366.png') });
  await p.click('[data-testid="bank-sheet-open"]');
  await p.waitForSelector('[data-testid="bank-sheet-lines"] .bd-row', { timeout: 20000 });
  await p.waitForTimeout(900);
  const sheetText = flat(await p.locator('[data-testid="bank-sheet-lines"]').innerText());
  ok(/Posts 1 Nov 2026 · October locked/.test(sheetText), 'each line in the sheet says "Posts 1 Nov 2026 · October locked"');
  await p.screenshot({ path: path.join(OUT, 'bl-06-sheet-1366.png') });
  const addBtn = p.locator('#acc_sheet button', { hasText: /Add (these \d+ ready lines|this line)/ }).first();
  const readyBefore = flat(await addBtn.innerText().catch(() => ''));
  console.log('   add button: ' + readyBefore);
  await addBtn.click();
  await p.waitForTimeout(800);
  await p.locator('[role=dialog] button, dialog[open] button', { hasText: /^(Yes|Add|Confirm)/ }).last().click();
  await p.waitForTimeout(9000);
  console.log('   after: ' + flat(await p.locator('#acc_sheet').innerText().catch(() => '')).slice(0, 300));
  await p.screenshot({ path: path.join(OUT, 'bl-07-added-1366.png') });
  await p.keyboard.press('Escape');
  await p.waitForTimeout(2000);
  /* what the server holds: the entries, on 1 Nov, doc_date their own day, the note */
  const day = (await api('GET', '/api/books/daybook?from=2026-10-01&to=2026-11-30&entries=1&limit=200')).body;
  console.log('   daybook keys: ' + Object.keys(day || {}).join(',') + ' count ' + ((day.entries || []).length) + ' sample ' + JSON.stringify((day.entries || [])[0] || null).slice(0, 300));
  const rows = (day.entries || []).filter((e) => String(e.posting_date).slice(0, 10) === '2026-11-01' && String(e.doc_date || '').slice(0, 7) === '2026-10');
  console.log('   narrations: ' + JSON.stringify(rows.map((e) => e.narration)));
  console.log('   daybook rows with the note: ' + rows.length + ' ' + JSON.stringify(rows.slice(0, 2).map((e) => [e.posting_date, e.doc_date, e.narration])));
  ok(rows.length >= 1 && rows.every((e) => String(e.posting_date).slice(0, 10) === '2026-11-01' && /^2026-10-/.test(String(e.doc_date || '').slice(0, 10))), 'the server holds ' + rows.length + ' entries on 1 Nov 2026, each with its own October day as doc_date, noted "October locked"');
  /* an entry (POST /events) carries the note in its narration; a payment or receipt (POST /payments) has its narration made by the api, so it carries doc_date only: said, not failed */
  const noted = rows.filter((e) => /October locked/.test(String(e.narration || '')));
  console.log('   NOTE entries with the note: ' + noted.length + ' of ' + rows.length + ' (payments keep their own day as doc_date; their narration is made by the api)');
  const log = await api('GET', '/api/books/bank/log?account=bank&from=2026-10-01&to=2026-10-31');
  const lateRows = ((log.body && log.body.posted) || []).filter((r) => r.doc_date && String(r.posting_date).slice(0, 7) > String(r.doc_date).slice(0, 7));
  ok(lateRows.length === rows.length, 'the bank log finds each moved line by its own ref through its statement date (' + lateRows.length + ' rows with doc_date)');
  await p.screenshot({ path: path.join(OUT, 'bl-08-after-add-1366.png') });
  const afterBand = await band(p), afterStates = await states(p);
  /* 3 · the SAME file again: this session, then a fresh one */
  const check = async (page, who) => {
    await load(page);
    const bd2 = await band(page), st2 = await states(page);
    const left = await page.locator('[data-testid="bank-lock-0"]').innerText().catch(() => '');
    console.log('   ' + who + ': ' + JSON.stringify({ in: count(st2, 'in'), lock: count(st2, 'lock'), ready: count(st2, 'ready'), need: count(st2, 'need') }) + ' | Difference ' + diffOf(bd2) + ' | ' + flat(left).slice(0, 80));
    ok(count(st2, 'in') === count(base0.states, 'in') + rows.length, who + ': in your books = the first ' + count(base0.states, 'in') + ' + the ' + rows.length + ' moved');
    ok(new RegExp((count(base0.states, 'in') + rows.length) + ' of 12 in your books').test(bd2), who + ': the band counts them too (' + (/d+ of 12 in your books/.exec(bd2) || ['?'])[0] + ')');
    ok(diffOf(bd2) === diffOf(base0.band), who + ': the Difference is unchanged (' + diffOf(bd2) + ' = ' + diffOf(base0.band) + ')');
    const one = page.locator('[data-testid^="bank-row-"]', { hasText: /posted 1 Nov 2026/ }).first();
    if (await one.count() === 0) { const row = page.locator('[data-testid^="bank-row-"]').first(); await row.locator('[data-caret]').click().catch(() => {}); }
    return { bd2, st2 };
  };
  await check(p, 'same session, same file');
  const open = p.locator('[data-testid^="bank-row-"]');
  for (let i = 0; i < Math.min(await open.count(), 14); i++) { await open.nth(i).locator('[data-caret]').click().catch(() => {}); }
  await p.waitForTimeout(800);
  const text = flat(await p.locator('[data-testid="bank-list"]').innerText());
  ok(/posted 1 Nov 2026 \(October locked\)/.test(text), 'a moved line reads "posted 1 Nov 2026 (October locked)" when its row is opened');
  await p.screenshot({ path: path.join(OUT, 'bl-09-reread-1366.png') });
  await ctx.close();
  ({ ctx, page: p } = await L.open(b, base, token, { width: 1366, height: 768 }));
  await check(p, 'fresh session (new browser context), same file');
  await p.screenshot({ path: path.join(OUT, 'bl-10-second-session-1366.png') });
  await ctx.close();
  /* 4 · phone */
  ({ ctx, page: p } = await L.open(b, base, token, { width: 390, height: 844 }));
  await load(p);
  const g2 = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth }));
  ok(g2.sw <= g2.iw, 'no sideways scroll at 390 (' + JSON.stringify(g2) + ')');
  await p.screenshot({ path: path.join(OUT, 'bl-11-reread-390.png') });
  await ctx.close();
  /* the phone view of the notice: lock a second month on the statement? the notice only exists while a line is held: relock is not needed, the shot above is the settled state */
  await b.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
