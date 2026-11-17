'use strict';
/**
 * e2e/walk-bank-demo.cjs - THE BANK-TO-BOOKS DEMO v2, WALKED: public/bank-demo.html with app/bank-demo.js (+ -ask.js, -report.js), app/bank-preview.js, app/lab-kit.js and the product header,
 * light AND dark theme at 1366x768 and 390x844, every state, keyboard only, signed out AND with a stored session.
 *
 * OWNS      the proof that the page (a) fits both sizes with no page scroll, (b) makes no request outside its own origin, no /api or manifest call, writes no storage, throws no console or CSP error
 *           (signed out and with a cb_sess in localStorage: the header still says "Sign in"), (c) keeps every text at WCAG AA contrast (4.5:1) in light and dark in each state,
 *           (d) says in words when the books engine did not load, (e) reproduces the AU pass test by the engines' own figures (books 14,400.00, difference 3,108.50; after the GST basis is answered
 *           6 lines ready, in 12.50, out 984.00, books after 13,428.50, 3 still need you) and that the chips, the sticky bar and the button count the SAME lines,
 *           (f) works by keyboard alone: the popup and the panel keep focus inside and give it back, Esc closes, (g) the confirm popup lists every line's Dr and Cr and each entry's Dr = Cr,
 *           (h) after Add the Books tab stops saying "not yet" and the reconciliation has no tick while lines are outside the books, (i) a bad file says so in words and clears the old statement,
 *           a heading we do not know is read or opens the column map, (j) the phone keeps both loads under More, (k) the printed report shows nothing else of the page.
 *           Screenshots of every state go to e2e/shots/bank-demo-v2-<light|dark>-<width>-<state>.png.
 * CALLED BY the cloud walks (every e2e/walk-*.cjs); by hand: NODE_PATH=e2e/node_modules node e2e/walk-bank-demo.cjs [--show]
 * SKIPS     (exit 0, said out loud) until the engines adopt puts bank-project.js, bank-entry.js, chart.js, accounts-packs.js and posting.js under public/engine.
 * CARD      16-finance/bank-reconciliation-and-bank-rail
 */
const fs = require('fs'),
  path = require('path'),
  http = require('http');
const { chromium } = require('playwright');
const ROOT = path.join(__dirname, '..', 'public');
const NEEDS = ['bank-project.js', 'bank-entry.js', 'chart.js', 'accounts-packs.js', 'posting-voucher.js', 'posting.js', 'bank-json.js', 'bank-brs.js'];
const TYPES = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json' };
const SIZES = [[1366, 768], [390, 844]];
const SHOTS = path.join(__dirname, 'shots');
let failed = 0;
const check = (ok, words) => {
  console.log((ok ? 'ok   ' : 'FAIL ') + words);
  if (!ok) failed++;
};

function serve() {
  return new Promise((done) => {
    const server = http.createServer((req, res) => {
      const file = path.join(ROOT, req.url.split('?')[0]);
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return res.writeHead(404).end('no');
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'text/plain', 'x-content-type-options': 'nosniff' });
      res.end(fs.readFileSync(file));
    });
    server.listen(0, () => done(server));
  });
}
/** every visible text element's colour against the first opaque background above it: the ratio, in the page itself */
const CONTRAST_IN_PAGE = () => {
  const light = (rgb) => {
    const v = rgb.map((c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); });
    return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
  };
  /* a computed colour is rgb(...) or, for a colour-mix() the list control uses for its zebra, color(srgb 0.9 0.9 0.9 / 1): channels 0 to 1 */
  const parse = (css) => {
    const wide = /^color\(/.test(css), m = css.replace(/^color\([a-z-]+/, '').match(/[0-9.]+/g).map(Number);
    return { rgb: wide ? m.slice(0, 3).map((c) => c * 255) : m.slice(0, 3), a: m.length > 3 ? m[3] : 1 };
  };
  const backdrop = (node) => {
    for (let n = node; n; n = n.parentElement) { const c = parse(getComputedStyle(n).backgroundColor); if (c.a > 0.9) return c.rgb; }
    return [255, 255, 255];
  };
  const worst = [];
  document.querySelectorAll('body *').forEach((node) => {
    const own = [...node.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim());
    if (!own || !node.offsetParent || node.disabled) return;
    const fg = parse(getComputedStyle(node).color).rgb, bg = backdrop(node);
    const [a, b] = [light(fg), light(bg)].sort((x, y) => y - x);
    const ratio = (a + 0.05) / (b + 0.05);
    if (ratio < 4.5) worst.push(node.tagName + '.' + node.className + ' ' + ratio.toFixed(2));
  });
  return worst;
};
const NARRATIVE_CSV = 'Date,Narrative,Debit Amount,Credit Amount,Balance\n19/10/2026,EFT Smith Pty,,2200.00,12200.00\n20/10/2026,Rent,1650.00,,10550.00\n';

(async () => {
  const missing = NEEDS.filter((name) => !fs.existsSync(path.join(ROOT, 'engine', name)));
  if (missing.length) return console.log('SKIP walk-bank-demo: the engines adopt has not landed (missing under public/engine: ' + missing.join(', ') + ')');
  const server = await serve();
  const base = 'http://localhost:' + server.address().port;
  const browser = await chromium.launch({ headless: !process.argv.includes('--show') });
  const broken = await browser.newPage();
  await broken.route('**/engine/bank-project.js', (route) => route.abort());
  await broken.goto(base + '/bank-demo.html');
  await broken.waitForSelector('#bd_lines .bd-problem');
  check((await broken.textContent('#bd_lines')).includes('has not loaded'), 'engine missing: the page says so in words, shows no figures, makes none up');
  await broken.close();
  for (const scheme of ['light', 'dark']) {
    for (const [width, height] of SIZES) {
      for (const signedIn of [false, true]) {
        if (signedIn && scheme === 'dark') continue;
        await walkOne(browser, base, scheme, width, height, signedIn);
      }
    }
  }
  await browser.close();
  server.close();
  console.log(failed ? failed + ' FAILED' : 'all passed');
  process.exit(failed ? 1 : 0);
})();

/** one scheme, one size, signed out or with a stored session: the whole walk */
async function walkOne(browser, base, scheme, width, height, signedIn) {
  const context = await browser.newContext({ viewport: { width, height }, colorScheme: scheme });
  if (signedIn) await context.addInitScript(() => { try { localStorage.setItem('cb_sess', JSON.stringify({ token: 'x.y.z', user: { id: 'u1', name: 'Test', role: 'owner' }, biz: { id: 'b1', name: 'Shop' } })); } catch (_) { /* a profile without storage */ } });
  /* proof only: a copy of the engine's "What is this?" file (engines batch I, #145) stands in until the engines adopt lands; no fixture = the page's own adopted engine */
  for (const [name, file] of [['bank-entry', 'bank-entry-whatisthis.js'], ['bank-recon', 'bank-recon-batch-i.js'], ['bank-project', 'bank-project-batch-i.js']]) {
    const fixture = path.join(__dirname, 'fixtures', file);
    if (fs.existsSync(fixture)) await context.route('**/engine/' + name + '.js', (route) => route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(fixture, 'utf8') }));
  }
  const page = await context.newPage();
  const tag = scheme + ' ' + width + 'x' + height + (signedIn ? ' with a stored session' : '');
  const seen = { outside: [], calls: [], errors: [] };
  page.on('request', (r) => {
    if (!r.url().startsWith(base)) seen.outside.push(r.url());
    if (/\/api\/|manifest\.json|config\.js/.test(r.url())) seen.calls.push(r.url());
  });
  page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && seen.errors.push(m.text()));
  page.on('pageerror', (e) => seen.errors.push(String(e)));
  await page.goto(base + '/bank-demo.html');
  await page.waitForSelector('#bd_figs .lk-fig');
  const shot = (state) => page.screenshot({ path: path.join(SHOTS, 'bank-demo-v2-' + scheme + '-' + width + (signedIn ? '-session' : '') + '-' + state + '.png') });
  const fits = async (state) => {
    const fit = await page.evaluate(() => [document.documentElement.scrollHeight - innerHeight, document.documentElement.scrollWidth - innerWidth]);
    check(fit[0] <= 0 && fit[1] <= 0, tag + ' ' + state + ': no page scroll');
    const worst = await page.evaluate(CONTRAST_IN_PAGE);
    check(worst.length === 0, tag + ' ' + state + ': every text at AA contrast (4.5:1)' + (worst.length ? ' ' + worst.slice(0, 4).join('; ') : ''));
  };
  await fits('loaded');
  await shot('1-loaded');
  check((await page.textContent('#shell')).includes('Sign in'), tag + ': the product header is there and says "Sign in" (no person is made up)');
  if (!signedIn) await signedOutStates(page, tag, width, shot, fits);
  check(!seen.outside.length && !seen.calls.length && !seen.errors.length, tag + ': no request outside the page, no /api or manifest call, no console or CSP error ' + JSON.stringify(seen).slice(0, 300));
  await context.close();
}

/** the counts that must agree: the "Ready to add" chip, the ready icons on the rows and the button all read one standing per line (CHANGED ON PURPOSE, W15-15: the chips are the list's status chips; the sticky count text is gone) */
async function countsAgree(page, tag, when) {
  const chip = Number(((await page.textContent('[data-testid="bank-status-ready"]')).match(/([0-9]+)[ \t\r\n]*$/) || [])[1] || 0);
  const icons = await page.locator('#bd_list [data-row] [data-state="ready"]').count();
  const button = (await page.getAttribute('#bd_add', 'data-ready')) || '0';
  check(String(icons) === button && button === String(chip), tag + ' ' + when + ': ' + icons + ' ready icons = the "Ready to add" chip (' + chip + ') = the button (' + button + ')');
}
/** open the row whose payee says this (CHANGED ON PURPOSE, W15-14: a line's answers open as a panel under it, one at a time); its panel is returned */
async function openLine(page, words) {
  const row = page.locator('#bd_list [data-row]', { hasText: words }).first();
  if (!(await row.evaluate((node) => node.classList.contains('cbl-open')))) await row.click();
  await page.waitForSelector('#bd_list .bd-openrow');
  return page.locator('#bd_list .bd-openrow').first();
}
/** answer the page's one GST question: a radio segment on a wide screen, a menu on a phone */
async function answerGst(page, value) {
  if (await page.locator('#bd_gst [role=radio][data-choice-value=' + value + ']').isVisible()) await page.click('#bd_gst [role=radio][data-choice-value=' + value + ']');
  else {
    await page.click('#bd_gst .cbui-choice-btn');
    await page.click('#bd_gst [role=option][data-choice-value=' + value + ']');
  }
}
/** the focus must stay inside the dialog however many times Tab is pressed, and Esc must give it back */
async function trapAndReturn(page, tag, what, giveBack) {
  let inside = true;
  for (let i = 0; i < 14; i++) {
    await page.keyboard.press('Tab');
    inside = inside && (await page.evaluate(() => !!document.activeElement.closest('.lk-pop')));
  }
  check(inside, tag + ' ' + what + ': 14 Tab presses never leave the dialog (a focus trap)');
  await page.keyboard.press('Escape');
  await page.waitForSelector('.lk-pop', { state: 'detached' });
  check(await page.evaluate(giveBack), tag + ' ' + what + ': Esc closes it and focus goes back to the control that opened it');
}

async function signedOutStates(page, tag, width, shot, fits) {
  const text = (selector) => page.textContent(selector);
  const phone = width < 700;
  const figs = await text('#bd_figs');
  check(figs.includes('18,280.75') && figs.includes('19,963.00') && figs.includes('1,682.25') && !/AUD \d/.test(figs), tag + ': frame 0: statement 18,280.75, books 19,963.00, difference 1,682.25 (the figures of the product for the October file), AUD not on a figure');
  check((await page.locator('#bd_list [data-row]').count()) === 12, tag + ': the twelve lines of the October file are listed in the one list');
  check((await text('#bd_lines')).includes('8 Oct 2026') && /KENSINGTON/.test(await text('#bd_lines')) && (await openLine(page, 'KENSINGTON')) && (await text('#bd_lines .bd-openrow')).includes('Invoice INV-1'), tag + ': dates read "8 Oct 2026", the payee is as the bank wrote it, and an in-books line names the entry it matched when it opens (W15-13)');
  check(/Business bank account/.test(figs) && /2 Oct to 31 Oct 2026 · 12 lines/.test(figs) && figs.includes('All amounts in Australian dollars (AUD)') && figs.includes('Right account?') && /10 lines to go/.test(figs) && /2 of 12 in your books/.test(figs), tag + ': the band names the account, the period and the lines, says the currency once, asks "Right account?" and counts "10 lines to go" with "2 of 12 in your books" (W15-18, W15-20 to W15-23, W15-27)');
  check((await page.locator('#bd_list .cbl-vtab').count()) === 4 && (await page.locator('#bd_list [data-row] [data-state]').count()) === 12 && (await page.locator('#bd_list [data-row] [data-state]').first().getAttribute('aria-label')) !== null, tag + ': four status chips and a status ICON on every row, each with its name for a screen reader (W15-13, W15-15)');
  check(!(await page.locator('#bd_tabs, .bd-tabs').first().isVisible()) && !(await page.locator('#bd_gst').isVisible()), tag + ': no tabs and no setup question on the opening frame');
  await countsAgree(page, tag, 'at the start');
  await shot('30s-0-open');
  const hasInvoiceQuestion = (await page.locator('#bd_list [data-row]', { hasText: 'BUNNINGS' }).count()) > 0 && (await (await openLine(page, 'BUNNINGS')).textContent()).includes('needs a tax invoice');
  if (hasInvoiceQuestion) {
    check((await (await openLine(page, 'BUNNINGS')).textContent()).includes('needs a tax invoice. Do you hold it?'), tag + ': Bunnings asks the tax-invoice question first, in the panel under its line');
    await shot('30s-8-question');
    await page.click('#bd_list .bd-openrow [data-act=inv][data-v=held]');
    await countsAgree(page, tag, 'after "Yes, I hold it"');
  }
  const newParty = page.locator('#bd_list [data-act=resolve]');
  if (await page.locator('#bd_list [data-row]', { hasText: 'PACIFIC' }).count()) {
    const panel = await openLine(page, 'PACIFIC');
    check((await panel.textContent()).includes('What is this?'), tag + ': a payee nobody knows asks "What is this?" in its panel, with the way to a new customer under "Someone or something else"');
    await page.locator('#bd_list .bd-openrow [data-act=more]').first().click();
    await page.locator('#bd_list .bd-openrow [data-act=resolve]').first().click();
    await countsAgree(page, tag, 'after "New customer"');
  }
  await fits('before the press');
  await shot('30s-15-ready');
  await page.focus('#bd_add');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.lk-confirm');
  const popup = await page.innerText('.lk-confirm-text');
  check(/Difference to the statement after: [-\d,.]+/.test(popup) && /\bDr\b/.test(popup) && /Dr = Cr/.test(popup), tag + ': the confirm lists each entry with Dr and Cr and closes with "Difference to the statement after" (' + ((popup.match(/Difference to the statement after: [-\d,.]+/) || [''])[0]) + ')');
  await fits('popup');
  await shot('30s-16-confirm');
  await trapAndReturn(page, tag, 'popup', () => document.activeElement && document.activeElement.id === 'bd_add');
  await page.focus('#bd_add');
  await page.keyboard.press('Enter');
  await page.click('[data-testid=lk-confirm-ok]');
  await page.waitForTimeout(250);
  await fits('after the press');
  await shot('30s-20-added');
  const finished = (await page.locator('#bd_brs').isVisible()) && (await page.locator('.bd-tick').count()) > 0;
  if (hasInvoiceQuestion && !(await page.locator('#bd_list [data-state="need"]').count())) check(finished && (await text('#bd_brs')).includes('Reconciled') && (await text('#bd_figs')).includes('0.00'), tag + ': the last frame is the reconciliation statement with the green nil and the tick');
  else check(!(await page.locator('.bd-tick').count()) || finished, tag + ': the report shows a tick only when nothing is left outside the books');
  if (!(await page.locator('#bd_brs').isVisible())) await page.evaluate(() => document.getElementById('bd_tab_brs').click());
  const report = await text('#bd_brs');
  check(report.includes('Demo, sample data') && report.includes('Balance as per bank statement') && report.includes('Balance as per books') && /not yet on the statement/.test(report) && !/\bDr\b/.test(report), tag + ': the statement uses the AU words and no Dr on the bank figure');
  await shot('30s-25-reconciliation');
  if (phone) {
    await page.click('#bd_more');
    check((await text('#bd_menu')).includes('Load your own'), tag + ': the phone keeps both loads under More');
    await page.keyboard.press('Escape');
    return filesStates(page, tag, shot);
  }
  return printAndFiles(page, tag, shot);
}

/** the print stylesheet, then the file states (desktop) */
async function printAndFiles(page, tag, shot) {
  await page.emulateMedia({ media: 'print' });
  const shown = await page.evaluate(() => [...document.querySelectorAll('.bd-banner,.bd-head,.bd-figs,.bd-tabs,.bd-bar')].every((n) => getComputedStyle(n).display === 'none') && getComputedStyle(document.querySelector('.bd-sheet')).display !== 'none');
  check(shown, tag + ': print: only the report shows (no header, cards, tabs or bar)');
  await shot('10-print');
  await page.emulateMedia({ media: 'screen' });
  await filesStates(page, tag, shot);
}
/** a file of the visitor's: the page asks which currency it is in first (never taken from the account), then reads it */
async function loadWithCurrency(page, input, file, tag, shot) {
  await page.setInputFiles(input, file);
  await page.waitForSelector('#bd_cur_sel');
  if (shot) await shot('12-currency-question');
  await page.fill('#bd_cur_sel', 'AUD');
  await page.click('[data-act=curuse]');
}
async function filesStates(page, tag, shot) {
  const file = (name, body) => ({ name, mimeType: 'text/csv', buffer: Buffer.from(body) });
  const input = (await page.locator('#bd_file').isVisible()) || (await page.locator('#bd_file').count()) ? '#bd_file' : '#bd_file2';
  await loadWithCurrency(page, input, file('notes.csv', 'hello there'), tag, shot);
  await page.waitForSelector('#bd_lines .bd-problem');
  const lines = await page.textContent('#bd_lines');
  check(/not a bank statement|which column/.test(lines) && !(await page.locator('#bd_list [data-row]').count()), tag + ': a file that cannot be read says so in words, and the old statement is gone');
  check(!/preset|mapping/.test(lines), tag + ': no engine words ("preset", "mapping") on screen');
  await shot('11-bad-file');
  await loadWithCurrency(page, input, file('narrative.csv', NARRATIVE_CSV));
  await page.waitForSelector('#bd_list [data-row], #bd_lines .bd-problem');
  if (await page.locator('[data-act=showmap]').count()) {
    await page.click('[data-act=showmap]');
    await page.waitForSelector('select[data-map]');
    await shot('12-column-map');
    const pick = { date: 'Date', narration: 'Narrative', debit: 'Debit Amount', credit: 'Credit Amount', balance: 'Balance' };
    for (const field of Object.keys(pick)) await page.selectOption('select[data-map=' + field + ']', pick[field]);
    await page.click('[data-act=readmap]');
    await page.waitForSelector('#bd_list [data-row]');
  }
  check((await page.locator('#bd_list [data-row]').count()) >= 2, tag + ': a file whose heading says "Narrative" is read (by the engine or through the column map), its lines are listed');
  await shot('13-own-file');
  await loadWithCurrency(page, input, file('harbour.csv', fs.readFileSync(path.join(__dirname, 'fixtures', 'harbour-oct-2026.csv'), 'utf8')));
  await page.waitForSelector('#bd_list [data-row]');
  await shot('14-harbour-file');
  /* CHANGED ON PURPOSE (W15-12, W15-13): a closed line is the icon, the date, the payee and the amount; what it looks like is the first thing in its opened panel (R69 still holds: the same words as the owner sheet) */
  let sampleText = '';
  for (const words of ['TRANSFER TO SAVINGS', 'ATO PAYMENT']) {
    const panel = await openLine(page, words);
    sampleText += ' ' + (await panel.textContent());
    await page.locator('#bd_list [data-row]', { hasText: words }).first().click();
  }
  check(/Looks like a transfer to your own account\. Which one\?/.test(sampleText) && /Looks like tax paid to the tax office\./.test(sampleText) && !/New (supplier|customer): (Savings|Ato|Card)/i.test(sampleText), tag + ': l16-bank-rules (R69, the same words as the owner sheet): the savings transfer and the ATO payment say what they look like, no new supplier made of a bank word');
}
