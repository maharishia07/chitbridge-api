/* bank-r3-live.cjs — l16-bank-r3 + l16-bank-9 (the page remembers the statement · one line, one short answer · one status vocabulary · currency once · no empty brackets) · Harbour Plumbing's October statement to Difference 0.00 ON SCREEN as the owner, against a REAL api (a SIT box's throwaway api), then a reload that is still 0.00 with the twins paired.
 * Run on the box (r3-e2e.sh in C:/dev/shots/l16-bank-r3/box): web = this checkout's public/, api = $API, owner = harbour-plumbing-au. Shots: $OUT (1366x768 and 390x844).
 * Answers only: no typing beyond the new party's name and the new savings account's name (the two things the statement cannot know). */
'use strict';
const { chromium } = require('@playwright/test'), fs = require('fs'), path = require('path');
const L = require('./lib/live-harbour.cjs');
const OUT = process.env.OUT || 'e2e/shots';
let pass = 0, fail = 0;
const PRESS_TARGET = Number(process.env.PRESS_TARGET || 12);
const ok = (c, m) => { if (c) { pass++; console.log('  ok  ' + m); } else { fail++; console.log('  XX  ' + m); } };
const CSV = () => fs.readFileSync(fs.existsSync('/w/Harbour-Plumbing-Oct2026-bank-statement-description.csv') ? '/w/Harbour-Plumbing-Oct2026-bank-statement-description.csv' : path.join(__dirname, 'fixtures', 'harbour-oct-2026.csv'));
const flat = (s) => String(s || '').replace(/\s+/g, ' ').trim();
async function load(p) {
  await p.setInputFiles('[data-testid="bank-file"]', { name: 'Harbour-Plumbing-Oct2026.csv', mimeType: 'text/csv', buffer: CSV() });
  await p.waitForSelector('[data-testid="bank-currency"], [data-testid="bank-list"].cbl [data-status]', { timeout: 20000 });
  if (await p.locator('[data-testid="bank-currency"]').count()) { console.log('   NOTE the currency was asked'); await p.click('[data-testid="bank-currency-go"]'); }
  await p.waitForSelector('[data-testid="bank-list"].cbl [data-status]', { timeout: 20000 });
  await p.waitForTimeout(1200);
}
/* W15-84 · ONE LANDING: a reload opens the Bank home, never the last statement (the device's last statement no longer decides the landing page). A file read on this device only leaves nothing on the home, so the way back to the lines is the new path: Bank → read the file again → its lines. Returns whether the home was on screen with no statement restored. */
async function reloadToLines(p) {
  await p.reload();
  /* the menu's Bank always lands on the Bank home. A reload on #bank/<account>/<month> does not: accounts.html reads the whole hash as the page name and opens To do (reported to the coordinator, not hidden: the walk goes through the menu) */
  await p.waitForSelector('[data-testid="acc-nav-bank"]', { timeout: 20000 });
  if (!(await p.locator('[data-testid="bank-stmts-grid"], [data-testid="bank-home-cards"]').count())) await p.click('[data-testid="acc-nav-bank"]');
  await p.waitForSelector('[data-testid="bank-stmts-grid"], [data-testid="bank-home-cards"]', { timeout: 20000 });
  const landed = (await p.locator('[data-testid="bank-list"]').count()) === 0 && (await p.locator('[data-testid="bank-home-back"]').count()) === 0;
  await load(p);
  return landed;
}
const band = async (p) => flat(await p.textContent('[data-testid="bank-finish"]'));
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const { base } = await L.serve(), token = await L.signIn(process.env.HANDLE || 'harbour-plumbing-au');
  const b = await chromium.launch();
  const { ctx, page: p } = await L.open(b, base, token, { width: 1366, height: 768 });
  p.on('pageerror', (e) => console.log('PAGEERROR ' + e.message.slice(0, 300)));
  await load(p);
  let bd = await band(p);
  ok(/Statement\s*18,280\.75/.test(bd) && /Your books\s*19,963\.00/.test(bd) && /Difference\s*1,682\.25/.test(bd) && !/A\$/.test(bd), 'ITEM 5: the band reads plain figures, statement 18,280.75, books 19,963.00, difference 1,682.25, no A$ (' + bd.slice(0, 160) + ')');
  ok(await p.locator('[data-testid="bank-currency-ask"]').count() === 0, 'ITEM 1: the account has its currency on record, so no currency question');
  /* CHANGED ON PURPOSE (W15-18, W15-20): the currency is said once in the band, large (IAS 1 para 51); Load another statement is the band's secondary button */
  const head = flat(await p.textContent('[data-testid="bank-finish"]'));
  ok(head.includes('All amounts in Australian dollars (AUD)') && (await p.locator('[data-testid="bank-home-back"]').count()) === 1, 'ITEM 5: the currency is said once, in the band; ITEM 1: another statement is added from the Bank home (the trail Back is the way there) (' + head.slice(0, 120) + ')');
  ok(!/A\$/.test(await p.textContent('[data-testid="bank-list"]')), 'ITEM 5: no A$ on any row');
  ok(/Add 10 lines to your books/.test(bd), 'the primary carries the count: "Add 10 lines to your books"');
  await p.screenshot({ path: path.join(OUT, 'r3-01-before-1366.png') });
  /* ITEM 1: a visit with no file: the page opens on the latest statement (this same page, reloaded: nothing chosen) */
  const landedOnHome = await reloadToLines(p);
  ok(landedOnHome, 'ITEM 1 (W15-84, one landing): a reload opens the Bank home, no statement restored from the device');
  ok(/Statement\s*18,280\.75/.test(await band(p)), 'ITEM 1: the same file read again: the statement and band are unchanged (' + (await band(p)).slice(0, 100) + ')');
  ok(await p.locator('[data-testid="bank-currency-ask"]').count() === 0, 'ITEM 1: the statement read again asks no currency');
  await p.screenshot({ path: path.join(OUT, 'b9-01-opens-on-last-statement-1366.png') });
  /* l16-bank-rules: the CLEAN Harbour (no savings account yet), the whole sheet, nothing answered: the three lines say what they look like while CLOSED (the gap that let 39/39 pass: only open rows were read) */
  await p.click('[data-testid="bank-sheet-open"]');
  await p.waitForSelector('[data-testid="bank-sheet-lines"] .bd-row', { timeout: 20000 });
  await p.waitForTimeout(700);
  const closedRow = (needle) => p.locator('[data-testid="bank-sheet-lines"] .bd-row', { hasText: needle }).first();
  const savClosed = flat(await closedRow('TRANSFER TO SAVINGS').innerText()), atoClosed = flat(await closedRow('ATO PAYMENT').innerText());
  ok(/Looks like a transfer to your own account\. Which one\?/.test(savClosed) && !/New (party|supplier|customer)|Nothing here says/i.test(savClosed), 'l16-bank-rules: Savings, closed, says "Looks like a transfer to your own account. Which one?" (' + savClosed.slice(0, 160) + ')');
  ok(/Looks like tax paid to the tax office\./.test(atoClosed) && /Dr GST collected 1,462\.00/.test(atoClosed), 'l16-bank-rules: ATO, closed, says what it looks like and its entry (' + atoClosed.slice(0, 200) + ')');
  await p.screenshot({ path: path.join(OUT, 'rules-00-all-closed-1366.png') });
  await p.click('[data-testid="bank-sheet-close"]');
  await p.waitForTimeout(500);
  /* ITEM 2 + 3: answer ONE line (Add missing on the transfer): the sheet shows that line, one short question, each list under its own button */
  const tr = p.locator('[data-testid^="bank-row-"]', { hasText: 'TRANSFER TO SAVINGS' }).first();
  await tr.locator('[data-caret]').click();
  await p.locator('[data-testid="bank-add"]').first().click();
  await p.waitForSelector('[data-testid="bank-sheet-lines"] .bd-row', { timeout: 20000 });
  await p.waitForTimeout(600);
  const shown = await p.locator('[data-testid="bank-sheet-lines"] .bd-row').count();
  ok(shown === 1, 'ITEM 2: the sheet shows the ONE line, not all of them (' + shown + ' rows)');
  const sheetText = flat(await p.locator('[data-testid="bank-sheet-lines"]').innerText());
  ok(!/say which account|from the list for/i.test(sheetText) && (sheetText.match(/What is this\?/g) || []).length === 1, 'ITEM 2: one short question, said once: "What is this?"');
  ok(await p.locator('[data-testid="bank-sheet-lines"] [data-testid="bd-looks-transfer"]').count() === 1 && !/New party|New supplier|New customer|Savings.*Use this party/i.test(sheetText), 'l16-bank-rules: the Savings line leads with "Looks like: Moved between my own accounts" and proposes no new party (' + sheetText.slice(0, 160) + ')');
  const ownList = flat(await p.locator('[data-testid="bank-sheet-lines"] select[data-act^=kindacct-transfer]').first().innerText().catch(() => ''));
  ok(/Looks like a transfer to your own account\. Which one\?/.test(sheetText) && !/Savings account/.test(ownList) && await p.locator('[data-testid="bank-sheet-lines"] [data-testid="bd-addown-name"]').count() === 1, 'l16-bank-rules (CLEAN Harbour: no savings account yet): the line says "Looks like a transfer to your own account. Which one?" and offers "+ add a savings account" (list: ' + ownList.slice(0, 80) + ')');
  const stacked = await p.$$eval('[data-testid="bank-sheet-lines"] .bd-choice', (els) => els.every((e) => { const b = e.querySelector('button'), l = e.querySelector('select'); return !l || (l.getBoundingClientRect().top >= b.getBoundingClientRect().bottom - 1 && Math.abs(l.getBoundingClientRect().left - b.getBoundingClientRect().left) < 4); }));
  ok(stacked, 'ITEM 2: each choice that has a list carries it right under its own button');
  ok(await p.locator('[data-testid="bank-sheet-lines"] input[data-act=pname]').count() === 0 && await p.locator('[data-testid="bank-sheet-lines"] select[data-act=acct]').count() === 0, 'ITEM 2: the New party and Or an account boxes are not under the question from the start');
  const asks = await p.locator('[data-testid="bank-sheet-lines"] [data-act=kind]').count();
  console.log('   choices as buttons: ' + asks);
  ok(asks >= 2, 'ITEM 2: the choices are buttons (' + asks + ')');
  await p.screenshot({ path: path.join(OUT, 'b9-02-one-line-answer-1366.png') });
  await p.locator('[data-testid="bank-sheet-lines"] [data-testid="bd-addown-name"]').fill('Savings account 4411');
  await p.locator('[data-testid="bank-sheet-lines"] [data-testid="bd-addown"]').click();
  await p.waitForTimeout(2500);
  const one = flat(await p.locator('[data-testid="bank-sheet-lines"] .bd-row').first().innerText());
  ok(/Ready to add/.test(one) && /Savings account 4411/.test(one), 'the one line is Ready to add, Dr Savings account 4411 (' + one.slice(-90) + ')');
  const addOne = p.locator('#acc_sheet button', { hasText: /Add this line to your books/ }).first();
  ok(await addOne.count() === 1, 'the press reads "Add this line to your books"');
  await addOne.click();
  await p.waitForTimeout(800);
  const dlg = flat(await p.locator('[role=dialog], dialog[open]').last().innerText().catch(() => ''));
  console.log('   confirm: ' + dlg.slice(0, 260));
  ok(/Add 1 entry/.test(dlg) && /Currency: AUD/.test(dlg) && !/AUD \d/.test(dlg) && !/Money in: AUD|Money out: AUD/.test(dlg) && /Money out: 4,000\.00|Money out: \d/.test(dlg), 'ITEM 5: the confirm follows the page: plain figures, the currency said once, the one line only');
  await p.screenshot({ path: path.join(OUT, 'b9-03-confirm-1366.png') });
  await p.locator('[role=dialog] button, dialog[open] button', { hasText: /^(Yes|Add|Confirm)/ }).last().click();
  await p.waitForTimeout(6000);
  const sayNode = p.locator('[data-testid="bank-sheet-say"]');
  console.log('   say after one line: ' + flat(await sayNode.innerText().catch(() => '')) + ' | class ' + (await sayNode.getAttribute('class').catch(() => '')));
  ok(/added to your books/.test(flat(await sayNode.innerText().catch(() => ''))) && /pe-ok/.test((await sayNode.getAttribute('class').catch(() => '')) || ''), 'l16-bank-10: "1 added to your books." is in the success tone (pe-ok), not the red band');
  await p.screenshot({ path: path.join(OUT, 'b10-00-added-success-tone-1366.png') });
  await p.keyboard.press('Escape');
  await p.waitForTimeout(1500);
  bd = await band(p);
  ok(/Add 9 lines to your books/.test(bd), 'one line added, nine left: the primary says "Add 9 lines to your books" (' + bd.slice(-60) + ')');
  await p.click('[data-testid="bank-sheet-open"]');
  await p.waitForSelector('[data-testid="bank-sheet-lines"] .bd-row', { timeout: 20000 });
  await p.waitForTimeout(800);
  /* a line that asks "What is this?" shows the party and account boxes only after "Someone or something else" */
  const openMore = async (needle) => { const more = p.locator('[data-testid="bank-sheet-lines"] .bd-row', { hasText: needle }).first().locator('button[data-act=more]'); if (await more.count()) { await more.click(); await p.waitForTimeout(300); } };
  const row = (needle) => p.locator('[data-testid="bank-sheet-lines"] .bd-row', { hasText: needle }).first();
  const pause = () => p.waitForTimeout(450);
  const show = async (needle) => console.log('   ' + needle + ' -> ' + flat(await row(needle).innerText()).slice(0, 200));
  /* the answers: each line that needs one opens by itself, one at a time; every press and choice is counted */
  let presses = 0;
  const lines = '[data-testid="bank-sheet-lines"]';
  const press = async (loc) => { presses++; console.log('   press ' + presses + ': ' + flat(await loc.first().innerText().catch(() => '?')).slice(0, 50)); await loc.click(); await pause(); };
  const choose = async (loc, what) => { presses++; console.log('   press ' + presses + ': choose ' + JSON.stringify(what)); await loc.selectOption(what); await pause(); };
  const heightOf = (sel) => p.evaluate((q) => { const e = document.querySelector(q); return e ? e.scrollHeight : -1; }, sel);
  const sheetHeight = await heightOf('#acc_sheet');
  const pageScrolls = await p.evaluate(() => document.documentElement.scrollHeight > innerHeight + 2);
  console.log('   sheet content height at 1366x768: ' + await heightOf('.bks-lines') + ' px, dialog ' + sheetHeight + ', page scrolls: ' + pageScrolls);
  ok(!pageScrolls, 'ITEM 1: the 1366 page does not scroll with the sheet open');
  ok(sheetHeight <= 768, 'ITEM 1: the whole sheet fits the 768 px screen (' + sheetHeight + ' px); its list scrolls inside, ' + await heightOf('.bks-lines') + ' px of content for ' + await p.locator(lines + ' .bd-row').count() + ' rows shown');
  /* the same sheet on the phone */
  await p.setViewportSize({ width: 390, height: 844 });
  await p.waitForTimeout(600);
  const phoneDialog = await heightOf('#acc_sheet'), phoneScrolls = await p.evaluate(() => document.documentElement.scrollHeight > innerHeight + 2 || document.documentElement.scrollWidth > innerWidth);
  console.log('   sheet at 390x844: dialog ' + phoneDialog + ' px, lines content ' + await heightOf('.bks-lines') + ' px, page scrolls: ' + phoneScrolls);
  await p.screenshot({ path: path.join(OUT, 'b9-09-sheet-390.png') });
  ok(phoneDialog <= 844 && !phoneScrolls, 'ITEM 1: at 390x844 the sheet fits the screen and the page does not scroll (' + phoneDialog + ' px)');
  await p.setViewportSize({ width: 1366, height: 768 });
  await p.waitForTimeout(400);
  await p.screenshot({ path: path.join(OUT, 'b9-09-sheet-1366.png') });
  const strip = flat(await p.textContent('[data-testid="bank-sheet-strip"]'));
  console.log('   strip: ' + strip);
  ok(/9 lines to add/.test(strip) && /ready/.test(strip) && /need an answer/.test(strip), 'ITEM 4: the sheet says what each number is (' + strip.slice(0, 90) + ')');
  const atoWords = flat(await row('ATO PAYMENT').innerText());
  console.log('   ATO row before any answer: ' + atoWords.slice(0, 260));
  const cardClosed = flat(await row('CARD SETTLEMENT').innerText());
  ok(/Looks like tax paid to the tax office/.test(atoWords) && /Dr GST collected 1,462\.00/.test(atoWords) && /Cr Business bank account 1,462\.00/.test(atoWords) && !/New party|New supplier|New customer/i.test(atoWords), 'l16-bank-rules: the ATO line, CLOSED, says what it looks like and the entry it makes, no new supplier (' + atoWords.slice(0, 200) + ')');
  ok(/Looks like your card takings paid into the bank|Cr Card and EFTPOS settlements 451\.00/.test(cardClosed) && !/New party|New supplier|New customer/i.test(cardClosed), 'l16-bank-rules: the card line says what it is, no new customer (' + cardClosed.slice(0, 200) + ')');
  for (let round = 0; round < 24; round++) {
    const basis = p.locator(lines + ' button[data-act=gst][data-v=cash]');
    if (await basis.count()) {
      const inView = await p.evaluate(() => { const e = document.querySelector('.bks-lines .bd-confirm'), h = document.querySelector('.bks-lines'); if (!e) return false; const r = e.getBoundingClientRect(), q = h.getBoundingClientRect(); return r.top >= q.top - 1 && r.bottom <= q.bottom + 1; });
      ok(inView, 'ITEM 1: the GST basis question is in view at the top of the sheet when it is asked');
      await press(basis.first());
      continue;
    }
    const open = p.locator(lines + ' .bd-row.bd-is-open').first();
    if (!(await open.count())) break;
    const text = flat(await open.innerText());
    console.log('   OPEN: ' + text.slice(0, 230));
    const more = open.locator('button[data-act=more]');
    if (/ATO PAYMENT/.test(text)) {
      await press(open.locator('button[data-act=tick]').first());
    } else if (/CARD SETTLEMENT/.test(text)) {
      ok(!/New party|New supplier|New customer/i.test(text) && await open.locator('input[data-act=pname]').count() === 0 && /card/i.test(text), 'l16-bank-rules: the card settlement line is proposed into the card account, no new customer (' + text.slice(0, 170) + ')');
      await press(open.locator('button[data-act=tick]').first());
    } else if (/MONTHLY ACCOUNT FEE/.test(text)) await choose(open.locator('select[data-act=taxkind1]'), { label: 'Input-taxed supply' });
    else if (/PACIFIC RIM/.test(text)) { if (await more.count()) await press(more); await open.locator('input[data-act=pname]').fill('Pacific Rim Traders'); await choose(open.locator('select[data-act=pkind]'), 'customer'); await press(open.locator('button[data-act=resolve]')); }
    else if (/BUNNINGS/.test(text) && ((await more.count()) || (await open.locator('select[data-act=acct]').count()))) { if (await more.count()) await press(more); await choose(open.locator('select[data-act=acct]'), 'repairs'); await choose(open.locator('select[data-act=taxkind]'), { index: 1 }); }
    else if (await open.locator('button[data-act=tick]').count()) await press(open.locator('button[data-act=tick]').first());
    else if (await open.locator('button[data-act=inv][data-v=held]').count()) await press(open.locator('button[data-act=inv][data-v=held]'));
    else { console.log('   UNHANDLED open row: ' + text.slice(0, 160)); break; }
    for (let held = 0; held < 3; held++) {
      const again = p.locator(lines + ' .bd-row.bd-is-open button[data-act=inv][data-v=held], ' + lines + ' .bd-row.bd-is-open button[data-act=tick]').first();
      if (await again.count()) await press(again); else break;
    }
  }
  console.log('PRESSES for the rest of the statement: ' + presses);
  ok(presses <= PRESS_TARGET, 'ITEM 1/2: the nine lines answered in ' + presses + ' presses (target ' + PRESS_TARGET + ')');
  await p.locator(lines + ' button[data-act=group][data-g=ready]').first().click().catch(() => {});
  await p.waitForTimeout(300);
  await row('ATO PAYMENT').locator('button[data-act=open]').click();
  await p.waitForTimeout(300);
  const entryWords = flat(await row('ATO PAYMENT').innerText());
  console.log('   entry words: ' + entryWords);
  ok(/Dr GST collected/.test(entryWords) && !/New party|New supplier/i.test(entryWords) && !/gst collected|Dr bank |Cr card/.test(entryWords), 'ITEM 3: the entry prints the chart account names (' + entryWords.slice(0, 160) + ')');
  const rows = await p.$$eval('[data-testid="bank-sheet-lines"] .bd-row', (els) => els.map((e) => e.innerText.replace(/\s+/g, ' ').slice(0, 170)));
  rows.forEach((r, i) => console.log('   row ' + i + ': ' + r));
  await p.screenshot({ path: path.join(OUT, 'r3-02-sheet-answered-1366.png') });
  const addBtn = p.locator('#acc_sheet button', { hasText: /Add these \d+ ready lines/ }).first();
  console.log('   add button: ' + flat(await addBtn.innerText().catch(() => '')));
  await addBtn.click();
  await p.waitForTimeout(800);
  await p.screenshot({ path: path.join(OUT, 'r3-03-confirm-1366.png') });
  console.log('   confirm: ' + flat(await p.locator('[role=dialog], dialog[open]').last().innerText().catch(() => '')).slice(0, 300));
  await p.locator('[role=dialog] button, dialog[open] button', { hasText: /^(Yes|Add|Confirm)/ }).last().click();
  await p.waitForTimeout(9000);
  await p.screenshot({ path: path.join(OUT, 'r3-04-posted-1366.png') });
  console.log('   after: ' + flat(await p.locator('#acc_sheet').innerText().catch(() => '')).slice(0, 400));
  ok(!(await p.locator('#acc_sheet').isVisible().catch(() => false)), 'l16-bank-10 SIGNED STATE: at nil the sheet closed by itself (no Escape pressed yet)');
  await p.keyboard.press('Escape');
  await p.waitForTimeout(1500);
  bd = await band(p);
  ok(/Difference\s*0\.00/.test(bd) && /Nothing left to add/.test(bd) && !/Unexplained/.test(bd) && !/A\$/.test(bd), 'AFTER POSTING: Difference 0.00, nothing left to add, no Unexplained shown at 0.00 (W15-18), plain figures (' + bd.slice(0, 200) + ')');
  await p.screenshot({ path: path.join(OUT, 'b9-04-nil-1366.png') });
  const states = async (pg) => pg.$$eval('[data-testid="bank-list"] [data-status]', (els) => els.map((e) => e.getAttribute('data-status')));
  console.log('   states after posting: ' + JSON.stringify(await states(p)));
  /* RELOAD: the same page, nothing chosen: still nil */
  await reloadToLines(p);
  bd = await band(p);
  ok(/Difference\s*0\.00/.test(bd) && /Nothing left to add/.test(bd), 'AFTER RELOAD (no file chosen): still Difference 0.00 (' + bd.slice(0, 200) + ')');
  console.log('   states after reload: ' + JSON.stringify(await states(p)));
  const text2 = flat(await p.textContent('[data-testid="bank-list"]'));
  ok(!/More than one entry fits/.test(text2) && !(await states(p)).includes('missing'), 'after the reload the two Bunnings lines are paired one to one');
  await p.screenshot({ path: path.join(OUT, 'b9-05-reload-1366.png') });
  /* l16-bank-10: sign-off, the signed state of the lines view, and the statement as a document */
  const signBtn = p.locator('[data-testid="bank-signoff"]');
  ok(/pri/.test((await signBtn.getAttribute('class')) || '') && !(await p.locator('[data-testid="bank-signed-line"]').count()), 'l16-bank-10: before signing, Sign off is the filled primary and no "Signed off" line shows');
  await signBtn.click();
  await p.waitForTimeout(500);
  const signAsk = flat(await p.locator('[role=dialog], dialog[open]').last().innerText().catch(() => ''));
  console.log('   sign-off confirm: ' + signAsk.slice(0, 260));
  ok(!/A\$/.test(signAsk), 'l16-bank-10: the sign-off confirm has no "A$" in its Difference');
  await p.locator('[role=dialog] button, dialog[open] button', { hasText: /^Sign off$/ }).last().click();
  await p.waitForTimeout(3000);
  const signedLine = flat(await p.locator('[data-testid="bank-signed-line"]').first().innerText().catch(() => ''));
  console.log('   signed line: ' + signedLine);
  ok(/Signed off by .+ on \d+ \w+ 2026/.test(signedLine) && !/[0-9a-f]{8}-[0-9a-f]{4}/.test(signedLine), 'l16-bank-10: the lines view says "Signed off by <name> on <date>", no record id (' + signedLine + ')');
  ok(!/pri/.test((await p.locator('[data-testid="bank-signoff"]').first().getAttribute('class')) || ''), 'l16-bank-10: after signing, Sign off is no longer the filled primary');
  await p.screenshot({ path: path.join(OUT, 'b10-01-signed-lines-1366.png') });
  await p.locator('[data-testid="bank-more"]').click();
  await p.locator('[data-testid="bank-tab-brs"]').click();
  await p.waitForTimeout(800);
  const title = flat(await p.locator('[data-testid="bank-brs-title"]').innerText().catch(() => ''));
  const panel = flat(await p.locator('[data-testid="bank-store"]').innerText().catch(() => ''));
  console.log('   statement title: ' + title + ' | panel: ' + panel.slice(0, 200));
  ok(/^Bank reconciliation · Business bank account · 31 Oct 2026$/.test(title), 'l16-bank-10: the statement has its title (' + title + ')');
  ok(!/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/.test(await p.textContent('#bk_body')), 'l16-bank-10: no record id anywhere on the statement view');
  ok(/Signed off by/.test(flat(await p.locator('[data-testid="bank-brs-signed"]').innerText().catch(() => ''))), 'l16-bank-10: the statement carries the signer by name');
  ok((await p.locator('[data-testid="bank-brs-print"]').count()) === 1, 'l16-bank-10: the statement has a Print button');
  /* keyboard only: Tab to Print, Enter presses it (window.print is stubbed: the browser's sheet is not driven), the print mode is set and cleared again */
  await p.evaluate(() => { window.__printed = 0; window.print = () => { window.__printed++; window.dispatchEvent(new Event('afterprint')); }; });
  await p.locator('[data-testid="bank-tab-lines"]').focus();
  await p.keyboard.press('Tab');
  const onPrint = await p.evaluate(() => document.activeElement && document.activeElement.getAttribute('data-testid'));
  ok(onPrint === 'bank-brs-print', 'l16-bank-10 KEYBOARD: one Tab from "Back to the lines" lands on Print (' + onPrint + ')');
  await p.keyboard.press('Enter');
  const printState = await p.evaluate(() => ({ n: window.__printed, cls: document.body.classList.contains('brs-printing') }));
  ok(printState.n === 1 && !printState.cls, 'l16-bank-10 KEYBOARD: Enter on Print asks the browser to print once and the print mode is cleared after (' + JSON.stringify(printState) + ')');
  await p.emulateMedia({ media: 'print' });
  const printed = await p.evaluate(() => { document.body.classList.add('brs-printing'); const card = document.getElementById('bk_brs_print'), side = document.querySelector('.pe-bank, #bk_line, nav, aside'); return { card: getComputedStyle(card).visibility, other: side ? getComputedStyle(side).visibility : 'none' }; });
  console.log('   print media: ' + JSON.stringify(printed));
  ok(printed.card === 'visible' && printed.other !== 'visible', 'l16-bank-10: the print stylesheet shows the statement card and hides the rest');
  await p.evaluate(() => document.body.classList.remove('brs-printing'));
  await p.emulateMedia({ media: 'screen' });
  await p.screenshot({ path: path.join(OUT, 'b10-02-statement-1366.png') });
  /* the phone: the band has no room for "Sign off again", so it is in More, reachable by keyboard */
  await p.locator('[data-testid="bank-tab-lines"]').click();
  await p.setViewportSize({ width: 390, height: 844 });
  await p.waitForTimeout(500);
  ok(!(await p.locator('[data-testid="bank-signoff"]').first().isVisible().catch(() => false)), 'l16-bank-10: at 390 the band does not carry "Sign off again"');
  await p.locator('[data-testid="bank-more"]').focus();
  await p.keyboard.press('Enter');
  await p.waitForTimeout(300);
  const moreSign = p.locator('[data-testid="bank-signoff-more"]');
  ok(await moreSign.isVisible().catch(() => false), 'l16-bank-10: at 390 "Sign off again" is in More (R74: the action is never dropped)');
  await p.screenshot({ path: path.join(OUT, 'b10-03-more-signoff-390.png') });
  await p.keyboard.press('Escape');
  await p.setViewportSize({ width: 1366, height: 768 });
  await p.waitForTimeout(300);
  ok(!(await p.locator('[data-testid="bank-signoff-more"]').isVisible().catch(() => false)), 'l16-bank-10: at 1366 the More menu does not repeat "Sign off again"');
  /* ITEM 3: one vocabulary */
  /* CHANGED ON PURPOSE (W15-13, W15-15): the three groups became the list's status chips (All, In your books, Ready to add, Needs you) and a row's status is an icon whose name is its aria-label */
  const chips = flat(await p.textContent('[data-testid="bank-status-in"]') + ' | ' + await p.textContent('[data-testid="bank-status-ready"]') + ' | ' + await p.textContent('[data-testid="bank-status-need"]'));
  ok(/In your books/.test(chips) && /Ready to add/.test(chips) && /Needs you/.test(chips) && !/Missing in|Matched/.test(chips), 'ITEM 3: the chips use the band words (' + chips + ')');
  const chipWords = await p.$$eval('[data-testid="bank-list"] [data-row] [data-state]', (els) => els.map((e) => e.getAttribute('aria-label')));
  ok(!chipWords.includes('Accepted') && chipWords.filter((w) => w === 'In your books').length === chipWords.length, 'ITEM 3: every settled row reads "In your books", none "Accepted" (' + JSON.stringify(chipWords) + ')');
  /* ITEM 4: no empty brackets anywhere on the page, nor in the sheet's already-in-the-books notes */
  const all = flat(await p.innerText('body'));
  const hole = /.{0,60}\(\s*\).{0,30}/.exec(all);
  if (hole) console.log('   EMPTY BRACKETS: ' + hole[0]);
  ok(!/\(\s*\)/.test(all), 'ITEM 4: no empty brackets on the page');
  await p.locator('[data-testid="bank-more"]').click();
  await p.locator('[data-testid="bank-tab-brs"]').click();
  await p.waitForTimeout(1200);
  const brs = flat(await p.innerText('body'));
  const hole2 = /.{0,60}\(\s*\).{0,30}/.exec(brs);
  if (hole2) console.log('   EMPTY BRACKETS (brs): ' + hole2[0]);
  console.log('   A$ in brs: ' + (/.{0,40}A\$.{0,20}/.exec(await p.textContent('[data-testid="bank-brs"]')) || [''])[0]);
  ok(!/\(\s*\)/.test(brs) && !/A\$/.test(await p.textContent('[data-testid="bank-brs"]')), 'ITEM 4+5: the reconciliation statement has no empty brackets and no A$');
  await p.screenshot({ path: path.join(OUT, 'b9-06-brs-1366.png') });
  await p.locator('[data-testid="bank-tab-lines"]').click();
  await p.waitForTimeout(800);
  /* KEYBOARD ONLY (W15-84): the trail's Back goes to the Bank home; Tab reaches Add statement, Enter opens the form with its file box */
  await p.locator('[data-testid="bank-home-back"]').focus(); await p.keyboard.press('Enter');
  await p.waitForSelector('[data-testid="bank-stmts-toggle"]', { timeout: 20000 });
  await p.evaluate(() => { document.activeElement && document.activeElement.blur(); window.scrollTo(0, 0); });
  let reached = '';
  for (let n = 0; n < 80 && reached !== 'bank-stmts-toggle'; n++) { await p.keyboard.press('Tab'); reached = await p.evaluate(() => (document.activeElement && document.activeElement.getAttribute('data-testid')) || ''); }
  ok(reached === 'bank-stmts-toggle', 'KEYBOARD: Tab reaches Add statement on the Bank home (' + reached + ')');
  /* nothing kept yet: the box starts open, so the first Enter closes it and the second opens it again */
  if (await p.locator('[data-testid="bank-stmts-toggle"]').getAttribute('aria-expanded') === 'true') { await p.keyboard.press('Enter'); await p.waitForTimeout(300); ok(await p.locator('[data-testid="bank-stmts-toggle"]').getAttribute('aria-expanded') === 'false', 'KEYBOARD: Enter on Add statement closes the open box'); const kept = await p.evaluate(() => (document.activeElement && document.activeElement.getAttribute('data-testid')) || ''); if (kept !== 'bank-stmts-toggle') console.log('   FINDING (bank area, not asserted here): focus is lost to the page (' + (kept || 'body') + ') when Add statement closes the open box'); if (kept !== 'bank-stmts-toggle') await p.locator('[data-testid="bank-stmts-toggle"]').focus(); }
  await p.keyboard.press('Enter');
  await p.waitForTimeout(500);
  ok(await p.locator('[data-testid="bank-stmts-toggle"]').getAttribute('aria-expanded') === 'true' && await p.locator('[data-testid="bank-stmts-file"]').first().waitFor({ state: 'attached', timeout: 5000 }).then(() => true, () => false), 'KEYBOARD: Enter opens Add statement with its file box');
  await p.screenshot({ path: path.join(OUT, 'b9-07-keyboard-add-statement-1366.png') });
  await p.screenshot({ path: path.join(OUT, 'b9-07-keyboard-another-statement-1366.png') });
  /* PHONE: the same page at 390x844, the statement is still there */
  await p.setViewportSize({ width: 390, height: 844 });
  await reloadToLines(p);
  await p.screenshot({ path: path.join(OUT, 'b9-08-phone-390.png') });
  ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), '390x844: no sideways scroll');
  const fold = await p.evaluate(() => { const first = document.querySelector('[data-testid="bank-list"] [data-row]'); return first ? Math.round(first.getBoundingClientRect().top) : -1; });
  ok(fold > 0 && fold <= Math.round(844 * 0.8), '390x844: the first line starts within four fifths of the screen, the band now carries the right-account check, tiles, bar and chips (changed on purpose, was a third) (' + fold + ' px of 844)');
  ok(await p.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 2), '390x844: the page itself does not scroll (' + await p.evaluate(() => document.documentElement.scrollHeight) + ' of 844)');
  console.log('THREW ' + JSON.stringify(p.__threw.filter((x) => !/stream|ERR_FAILED/.test(x))));
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  await b.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERR', e.stack); process.exit(1); });
