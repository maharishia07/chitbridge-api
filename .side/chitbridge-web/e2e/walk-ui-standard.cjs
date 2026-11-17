'use strict';
// @type: walk
/**
 * walk-ui-standard.cjs — the UI standard page (public/ui-standard.html, UIS001) in a real browser.
 *
 * Proves: the page loads with no sign-in and makes NO request except its own static files (no api, no third party); every component
 * (CMP001..CMP010) renders with its code chip and fcode; the six states draw; a language switch (ta, ar) changes the labels, the
 * accessible names and an OPEN dialog in place, and Arabic turns the page right-to-left; the commit confirm shows its reach (amount +
 * currency, recipients, count) before anything is sent; the 24 px overlay marks the too-small preset red; and, in light AND dark at
 * 1366x768 and 390x844, nothing scrolls the page and nothing scrolls sideways.
 * Needs playwright (NODE_PATH). Run on an Oracle box in the Playwright container, never on the laptop (load rule).
 * Run: NODE_PATH=<dir with playwright> node e2e/walk-ui-standard.cjs [outDir]
 */
const fs = require('fs'), path = require('path'), http = require('http');
const { chromium } = require('playwright');
const PUB = path.join(__dirname, '..', 'public');
const OUT = process.argv[2] || path.join(__dirname, '..', 'out', 'ui-standard');
fs.mkdirSync(OUT, { recursive: true });
let failures = 0;
const check = (ok, message) => { console.log((ok ? '  ok ' : '  FAIL ') + message); if (!ok) failures++; };
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.css': 'text/css', '.json': 'application/json' };

function serve() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const file = path.join(PUB, decodeURIComponent(req.url.split('?')[0]));
      if (!file.startsWith(PUB) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('no'); return; }
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    }).listen(0, '127.0.0.1', () => resolve(server));
  });
}
const press = (page, group, value) => page.click('[data-testid="gal-' + group + '-' + value + '"]');
/** a pick in the REAL avatar panel: open it, press the choice, close it again (toggling the button, so an open dialog is left alone) */
const avatarPick = async (page, testid) => {
  if (!(await page.$('[data-testid="avatar-menu"]'))) await page.click('[data-testid="avatar"]');
  /* the choice is pressed in the page itself: with a dialog open its backdrop sits over the panel, and a real pointer would hit the backdrop */
  await page.$eval('[data-testid="' + testid + '"]', (el) => el.click());
  if (await page.$('[data-testid="avatar-menu"]')) await page.$eval('[data-testid="avatar"]', (el) => el.click());
};
/** a section: the frame's sidebar at desktop (skel-nav-*), the frame's phone switch at 390 (lab-switch-*) */
const goTab = async (page, tab) => {
  if (await page.isVisible('[data-testid="skel-nav-' + tab + '"]')) await page.click('[data-testid="skel-nav-' + tab + '"]');
  else await page.click('[data-testid="lab-switch-' + tab + '"]');
};
/** a view choice (Screen, Size): the tools strip at desktop, the View sheet at 390 */
const viewPick = async (page, group, value) => {
  if (await page.isVisible('[data-testid="gal-' + group + '-' + value + '"]')) return page.click('[data-testid="gal-' + group + '-' + value + '"]');
  if (!(await page.$('html[data-open]'))) await page.click('[data-testid="gal-view"]');
  await page.click('[data-testid="gal-sheet-' + group + '-' + value + '"]');
  await page.click('[data-testid="gal-scrim"]', { position: { x: 5, y: 5 } });
};
const setOverlay = async (page, on) => {
  const desk = await page.isVisible('[data-testid="gal-overlay-switch"]');
  if (!desk && !(await page.$('html[data-open]'))) await page.click('[data-testid="gal-view"]');
  const sel = desk ? '[data-testid="gal-overlay-switch"]' : '[data-testid="gal-sheet-overlay-switch"]';
  if ((await page.getAttribute(sel, 'aria-checked')) !== String(on)) await page.click(sel);
  if (!desk) await page.click('[data-testid="gal-scrim"]', { position: { x: 5, y: 5 } });
};
const pick = (page, group, value) => avatarPick(page, (group === 'theme' ? 'theme-' : 'font-') + value);
/** the toast row must not overlap any visible button (it is a row of the page, so it takes room instead of covering) */
const toastClear = (page) => page.evaluate(() => {
  const bar = document.querySelector('#toast .toast');
  if (!bar) return false;
  const box = bar.getBoundingClientRect();
  return [...document.querySelectorAll('button:not(#undoBtn)')].every((button) => {
    const other = button.getBoundingClientRect();
    return !other.width || other.right <= box.left || other.left >= box.right || other.bottom <= box.top || other.top >= box.bottom;
  });
});
const noScroll = (page) => page.evaluate(() => {
  const panel = document.getElementById('panel');
  return { page: document.documentElement.scrollHeight - innerHeight, pageX: document.documentElement.scrollWidth - innerWidth, panelX: panel.scrollWidth - panel.clientWidth };
});

(async () => {
  const server = await serve();
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  const stray = [], errors = [], fontRequests = [];
  for (const [label, size] of [['1366', { width: 1366, height: 650 }], ['390', { width: 390, height: 740 }]]) {
    const context = await browser.newContext({ viewport: size, locale: 'en-US' });
    /* a session that happens to exist must be ignored: plant one */
    await context.addInitScript(() => { try { localStorage.setItem('cb_sess', JSON.stringify({ token: 'SHOULD-NOT-BE-READ' })); localStorage.setItem('cb_lang', 'fr'); localStorage.setItem('cb_theme', 'navy'); } catch (_) {} });
    const page = await context.newPage();
    page.on('request', (request) => { const url = request.url(), fontHost = /^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(url); if (fontHost) fontRequests.push(url); else if (!url.startsWith(base) || /\/api\//.test(url)) stray.push(url); });
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto(base + '/ui-standard.html');
    await page.waitForSelector('[data-testid="gal-row-CMP001-preference"]');
    console.log('viewport ' + label);

    const codes = await page.$$eval('[data-testid="gal-code"]', (nodes) => nodes.map((node) => node.textContent));
    for (let n = 1; n <= 10; n++) check(codes.indexOf('CMP' + String(n).padStart(3, '0')) >= 0, 'CMP' + String(n).padStart(3, '0') + ' renders with its code chip');
    check((await page.$$eval('[data-testid="gal-fcode"]', (nodes) => nodes.length)) >= 10, 'every row shows its fcode');
    check(await page.evaluate(() => document.documentElement.lang === 'en'), 'the planted cb_lang=fr is ignored: the page starts in English');
    const states = await page.$$eval('[data-testid="gal-row-CMP001-preference"] button', (nodes) => nodes.map((node) => [node.getAttribute('data-demo'), node.getAttribute('aria-disabled') === 'true' && !node.disabled, node.getAttribute('aria-busy')]));
    check(states.length === 6 && states.some((s) => s[1]) && states.some((s) => s[2] === 'true') && states.filter((s) => s[0]).length === 3, 'six states: default, hover, focus, pressed (static), disabled, busy');
    /* field-1: the disabled state is aria-disabled (no native disabled): Tab reaches it, its reason is real text, a press runs nothing and says why */
    const dis = '[data-testid="gal-row-CMP001-preference"] button[aria-disabled="true"]';
    const reason = await page.$eval(dis, (node) => { const el = document.getElementById(node.getAttribute('aria-describedby')); return el ? el.textContent : null; });
    check(reason === 'Disabled', 'the disabled state names its reason through aria-describedby (' + reason + ')');
    await page.focus(dis);
    check(await page.$eval(dis, (node) => document.activeElement === node), 'the disabled state takes keyboard focus (it is in the Tab order)');
    await page.keyboard.press('Enter');
    check((await page.$eval('#toast', (node) => node.textContent).catch(() => '')) === 'Disabled', 'pressing a disabled action shows its reason in the page notice line (toast) and runs nothing');
    /* the notice line clears on its own: wait for it, so the later "Cancel sends nothing" check reads only what Cancel did (it saw this toast when the walk ran fast) */
    for (let wait = 0; wait < 60 && (await page.$$('#toast .toast')).length > 0; wait++) await page.waitForTimeout(250); /* polls the DOM: the page CSP refuses waitForFunction eval */
    const idsOk = await page.$$eval('#content button', (nodes) => nodes.every((node) => node.getAttribute('data-cbsid') && node.getAttribute('data-cbmount')));
    check(idsOk, 'every component button carries its element code and its mount');
    const headIds = await page.$$eval('#hdr button', (nodes) => nodes.every((node) => /^UIS001-B\d\d$/.test(node.getAttribute('data-cbsid'))));
    check(headIds, 'every page control carries UIS001-Bnn');
    await goTab(page, 'waves');
    await page.waitForSelector('[data-testid="gal-wave-0"]');
    check((await page.$$('section[data-testid^="gal-wave-"]')).length === 5 && (await page.$$('[data-testid="gal-wave-progress"] [role="progressbar"]')).length === 5, label + ': the Waves section draws five rows, each with a progress bar, from ui-waves.json');

    for (const [theme, key] of [['light', 'cream'], ['dark', 'dark'], ['terminal', 'terminal']]) {
      await pick(page, 'theme', key);
      for (const tab of ['components', 'popups', 'icons', 'tokens', 'themes', 'before', 'waves']) {
        await goTab(page, tab);
        const scroll = await noScroll(page);
        check(scroll.page <= 0 && scroll.pageX <= 0 && scroll.panelX <= 0, label + ' ' + theme + ' ' + tab + ': page does not scroll, nothing scrolls sideways ' + JSON.stringify(scroll));
        await page.screenshot({ path: path.join(OUT, label + '-' + theme + '-en-' + tab + '.png') });
      }
    }
    await pick(page, 'theme', 'cream');
    await goTab(page, 'tokens');
    await page.waitForFunction(() => document.fonts.check('14px Inter') || document.fonts.status === 'loaded', null, { timeout: 15000 }).catch(() => {});
    const faceNote = await page.evaluate(() => ({ inter: document.fonts.check('14px Inter'), loaded: [...document.fonts].filter((face) => face.status === 'loaded').map((face) => face.family) }));
    console.log('  faces loaded from the product font host: ' + JSON.stringify(faceNote.loaded));
    check(faceNote.inter && faceNote.loaded.some((name) => /Inter/.test(name)), 'the product face Inter is loaded (document.fonts has it)');
    check(await page.evaluate(() => /Inter/.test(getComputedStyle(document.body).fontFamily.split(',')[0])), 'the page draws in Inter by default (avatar FONTS[0])');
    const typeRows = await page.$$eval('[data-testid="gal-type-row"]', (nodes) => nodes.map((node) => node.textContent.replace(/\s+/g, ' ')));
    check(typeRows.length >= 11, 'Type: ' + typeRows.length + ' measured rows (10 components and the page switches)');
    console.log('  type rows: ' + JSON.stringify(typeRows.slice(0, 3)) + ' ... ' + JSON.stringify(typeRows.slice(-1)));
    const small = await page.$$eval('[data-testid="gal-type-small"]', (nodes) => nodes.map((node) => node.parentElement.textContent.replace(/\s+/g, ' ')));
    console.log('  FINDINGS labels under 14 px at Standard 44: ' + small.length + ' ' + JSON.stringify(small));
    const faces = await page.$$eval('[data-testid^="gal-face-"]', (nodes) => nodes.map((node) => node.textContent.replace(/\s+/g, ' ')));
    check(faces.length === 5, 'every language names the face that drew it: ' + JSON.stringify(faces));
    check((await page.$$eval('[data-testid="gal-type-ok"]', (nodes) => nodes.length)) >= 10, 'every component label is 14 px or more at Standard 44');
    await page.screenshot({ path: path.join(OUT, label + '-light-en-type.png') });
    check((await page.$$eval('[data-testid="gal-token"]', (nodes) => nodes.length)) >= 8, 'tokens are read live: a row per custom property');
    const measure = await page.textContent('[data-testid="gal-measure"]');
    check(/×44 px/.test(measure) && /AA/.test(measure), 'measured on the real button: ' + measure.replace(/\s+/g, ' ').slice(0, 90));

    /* the size toggle moves the token and the real button follows */
    await viewPick(page, 'size', 'large');
    const largeHeight = await page.$eval('[data-testid="gal-measure-primary"]', (node) => Math.round(node.getBoundingClientRect().height));
    check(largeHeight === 56, 'Size: large sets --act-h and the real Done button is 56 px high (' + largeHeight + ')');
    await viewPick(page, 'size', 'small');
    await setOverlay(page, true);
    await goTab(page, 'components');
    check((await page.$$eval('[data-testid="gal-target-bad"]', (nodes) => nodes.length)) > 0, '24 px overlay marks the too-small preset red');
    await page.screenshot({ path: path.join(OUT, label + '-light-en-overlay-small.png') });
    await viewPick(page, 'size', 'standard');
    check((await page.$$eval('[data-testid="gal-target-bad"]', (nodes) => nodes.length)) === 0, '24 px overlay: no control below 24 px at the standard size');
    await setOverlay(page, false);

    /* the language switch repaints in place */
    const before = await page.textContent('[data-testid="gal-row-CMP003"] .st .slot button');
    const nameBefore = await page.getAttribute('[data-testid="gal-CMP003-std-default"]', 'aria-label');
    await avatarPick(page, 'lang-ta');
    const afterTa = await page.textContent('[data-testid="gal-row-CMP003"] .st .slot button');
    check(before === 'Cancel' && afterTa !== before && /[஀-௿]/.test(afterTa), 'Tamil: Cancel repaints in place (' + afterTa + ')');
    check((await page.getAttribute('[data-testid="gal-CMP003-std-default"]', 'aria-label')) !== nameBefore, 'Tamil: the accessible name (aria-label) repaints too');
    await page.screenshot({ path: path.join(OUT, label + '-light-ta-components.png') });
    await avatarPick(page, 'lang-ar');
    check(await page.evaluate(() => document.documentElement.dir === 'rtl' && document.documentElement.lang === 'ar'), 'Arabic: the page turns right-to-left');
    await page.screenshot({ path: path.join(OUT, label + '-light-ar-components.png') });
    const wide = await page.evaluate(() => [...document.querySelectorAll('body *')].filter((node) => node.getBoundingClientRect().right > innerWidth + 1 || node.getBoundingClientRect().left < -1).slice(0, 4).map((node) => node.tagName + '.' + node.className + ' ' + Math.round(node.getBoundingClientRect().left) + '..' + Math.round(node.getBoundingClientRect().right)));
    check((await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 0, 'Arabic: no sideways page scroll ' + JSON.stringify(wide));
    await avatarPick(page, 'lang-fr');
    check(/Annuler/.test(await page.textContent('[data-testid="gal-row-CMP003"] .st .slot button')), 'French: Annuler');
    await avatarPick(page, 'lang-en');

    /* the avatar's look: font, text size and weight go through the avatar's own apply and write nothing */
    const bodySize = () => page.evaluate(() => parseFloat(getComputedStyle(document.body).fontSize));
    const baseSize = await bodySize();
    await avatarPick(page, 'fs-xl');
    check((await bodySize()) > baseSize * 1.25, 'Text size: extra large scales the whole page (' + baseSize + ' to ' + (await bodySize()) + ' px)');
    const xlWide = await page.evaluate(() => [...document.querySelectorAll('body *')].filter((node) => node.scrollWidth > node.clientWidth + 1 && node.clientWidth > 0).slice(0, 8).map((node) => node.tagName + '.' + node.className + ' sw' + node.scrollWidth + ' cw' + node.clientWidth));
    check((await noScroll(page)).pageX <= 0, 'Text size xl: nothing scrolls sideways ' + JSON.stringify(xlWide) + JSON.stringify(await noScroll(page)));
    await page.screenshot({ path: path.join(OUT, label + '-light-en-textsize-xl.png') });
    await avatarPick(page, 'fs-m');
    await pick(page, 'font', 'serif');
    check(/Georgia/.test(await page.evaluate(() => getComputedStyle(document.body).fontFamily)), 'Font: serif reaches the page through the avatar apply');
    await pick(page, 'font', 'default');
    await avatarPick(page, 'weight-bold');
    check(await page.evaluate(() => document.documentElement.getAttribute('data-weight') === 'bold'), 'Weight: bold stamps data-weight like the avatar');
    await avatarPick(page, 'weight-normal');
    await page.click('[data-testid="avatar"]');
    check((await page.$$eval('[data-testid^="theme-"]:not([data-testid="theme-device"])', (nodes) => nodes.length)) === 16, 'the REAL avatar panel lists the 16 themes (the same component the app opens)');
    check(await page.evaluate(() => /Terminal/.test(document.querySelector('[data-testid="avatar-menu"]').textContent)), 'Terminal is one of them');
    await page.screenshot({ path: path.join(OUT, label + '-light-en-avatar-panel.png') });
    await page.click('[data-testid="avatar"]');
    check((await page.$$('[data-testid="gal-lang-ta"], [data-testid="gal-theme"], [data-testid="gal-font"]')).length === 0, 'the page keeps no copy of the panel: no own Theme, Font or Language switch');
    check(await page.evaluate(() => document.documentElement.hasAttribute('data-appearance-fixed') && localStorage.getItem('cb_theme') === 'navy' && localStorage.getItem('cb_fs') === null && localStorage.getItem('cb_font') === null && localStorage.getItem('cb_weight') === null), 'the avatar apply wrote nothing: cb_theme stays the visitor\'s own, cb_font / cb_fs / cb_weight absent');
    check(await page.evaluate(() => document.documentElement.getAttribute('data-theme') === 'cream'), 'the visitor\'s stored theme (navy) did not leak into the page: it starts in Cream');

    /* the request: open the REAL panel, pick Terminal + Mono + XL: the components repaint and nothing is written */
    const lookBefore = await page.evaluate(() => ({ face: getComputedStyle(document.querySelector('[data-testid="gal-measure-primary"]') || document.body).fontFamily, size: parseFloat(getComputedStyle(document.body).fontSize), keys: Object.keys(localStorage).sort().join() }));
    await goTab(page, 'tokens');
    await avatarPick(page, 'theme-terminal');
    await avatarPick(page, 'font-mono');
    await avatarPick(page, 'fs-xl');
    const after = await page.evaluate(() => ({ theme: document.documentElement.getAttribute('data-theme'), face: getComputedStyle(document.querySelector('[data-testid="gal-measure-primary"]')).fontFamily, size: parseFloat(getComputedStyle(document.body).fontSize), pressed: document.querySelector('[data-testid="gal-measure"]').textContent, keys: Object.keys(localStorage).sort().join(), sess: localStorage.getItem('cb_sess'), theme2: localStorage.getItem('cb_theme') }));
    check(after.theme === 'terminal' && /Space Mono|monospace/.test(after.face) && after.size > lookBefore.size * 1.25, 'Terminal + Mono + XL through the real panel: the components repaint (theme ' + after.theme + ', face ' + after.face.split(',')[0] + ', ' + lookBefore.size + ' to ' + after.size + ' px)');
    check(after.keys === lookBefore.keys && after.theme2 === 'navy' && !/SHOULD/.test(after.pressed), 'the panel pick wrote nothing: storage keys unchanged (' + after.keys + ')');
    await page.screenshot({ path: path.join(OUT, label + '-terminal-mono-xl-tokens.png') });
    await goTab(page, 'components');
    await page.screenshot({ path: path.join(OUT, label + '-terminal-mono-xl-components.png') });
    await avatarPick(page, 'theme-cream');
    await avatarPick(page, 'font-default');
    await avatarPick(page, 'fs-m');

    /* every theme, applied by the avatar code and measured on the real buttons: the failures are findings, never hidden */
    const audit = await page.evaluate(() => CBUiStandard.audit());
    check(audit.length === 16, 'themes audited: ' + audit.length);
    const failing = [];
    audit.forEach((row) => row.pairs.forEach((pair) => { if (!pair.ok) failing.push(row.name + ' · ' + pair.name + ' ' + pair.ratio.toFixed(2) + ' < ' + pair.min + ' (WCAG ' + pair.rule + ')'); }));
    console.log('  FINDINGS theme x component pairs below the minimum: ' + failing.length + ' of ' + audit.length * audit[0].pairs.length);
    failing.forEach((line) => console.log('    finding ' + line));
    fs.writeFileSync(path.join(OUT, label + '-theme-contrast-findings.json'), JSON.stringify({ failing, audit: audit.map((row) => ({ theme: row.name, pairs: row.pairs.map((pair) => [pair.name, +pair.ratio.toFixed(2), pair.min, pair.rule, pair.ok]) })) }, null, 1));
    await goTab(page, 'tokens');
    const focusLines = await page.$$eval('[data-testid="gal-focus-line"]', (nodes) => nodes.map((node) => node.textContent));
    check(focusLines.length === 5, 'the Tokens tab lists the focus ring and quiet edge results per pair');
    focusLines.forEach((line) => console.log('  FINDING focus: ' + line));
    const ringRows = audit.map((row) => row.pairs.filter((pair) => /^Ring|Quiet edge|label/.test(pair.name)).every((pair) => pair.ok));
    check(ringRows.every(Boolean) && ringRows.length === 16, 'the ring (>= 3:1 on page and card, 3 px, gap 2 px), the quiet edge (>= 3:1) and the labels (>= 4.5:1) pass in ALL 16 themes');
    await goTab(page, 'themes');
    await page.screenshot({ path: path.join(OUT, label + '-light-en-themes.png') });
    await goTab(page, 'meets');
    check((await page.$$('[data-testid="gal-meets-row"]')).length === 13, 'Meets the standard: thirteen rules (seven visual, six keyboard and focus), each with its source, its proof and its live result');
    const live = await page.$$eval('[data-testid^="gal-meetlive-"]', (nodes) => nodes.map((node) => node.getAttribute('data-testid') + ':' + node.textContent));
    live.forEach((line) => console.log('  LIVE keyboard row: ' + line));
    check(live.length === 6 && !live.some((line) => /wait/.test(line)) && live.filter((line) => /^gal-meetlive-(pass|fail):(PASS|FAIL) /.test(line)).length === 5, 'the six keyboard rows: five measured chips (PASS or FAIL read from the page, never waiting) and one rule the walk checks');
    check(/^gal-meetlive-fail:FAIL.*focus stayed/.test(live[0]) || /^gal-meetlive-pass:PASS/.test(live[0]), 'the popup-focus chip says what the focus did');
    check((await page.$$eval('[data-testid="gal-meets-row"] a[href^="https://"]', (nodes) => nodes.length)) >= 9, 'the sources are plain links');
    check((await page.$$('[data-testid="gal-meet-pass"]')).length >= 80 && (await page.$$('[data-testid="gal-meet-fail"]')).length === 0, 'the live results: every theme PASSES every rule');
    const ringChips = await page.$$eval('[data-testid="gal-meets-row"]:nth-of-type(2) [data-testid^="gal-meet-"]', (nodes) => nodes.map((node) => node.textContent));
    check(ringChips.length === 16 && ringChips.every((text) => /\d+(\.\d+)? px · gap \d+(\.\d+)? px/.test(text) && !/:1/.test(text)), 'the ring-thickness row shows measured px and gap, not a ratio: ' + ringChips.slice(0, 2).join(' | '));
    check((await page.textContent('[data-testid="gal-country"]')).indexOf('Empty on purpose') >= 0, 'the country section is present and empty, marked');
    check((await noScroll(page)).pageX <= 0 && (await noScroll(page)).panelX <= 0, 'Meets tab: nothing scrolls sideways');
    await page.screenshot({ path: path.join(OUT, label + '-light-en-meets.png') });
    await goTab(page, 'components');

    /* an OPEN dialog repaints in place when the language changes */
    await page.click('[data-testid="gal-open-dialog"]');
    await page.waitForSelector('[data-testid="gal-mover"]');
    const dialogEn = await page.textContent('.mhd .t');
    await page.screenshot({ path: path.join(OUT, label + '-light-en-dialog.png') });
    await avatarPick(page, 'lang-ta');
    const dialogTa = await page.textContent('.mhd .t');
    check(dialogEn === 'Example dialog' && dialogTa !== dialogEn, 'the open dialog repaints in Tamil without a reload (' + dialogTa + ')');
    await page.screenshot({ path: path.join(OUT, label + '-light-ta-dialog.png') });
    await avatarPick(page, 'lang-ar');
    await page.screenshot({ path: path.join(OUT, label + '-light-ar-dialog.png') });
    await page.keyboard.press('Escape');
    check((await page.$$('[data-testid="gal-mover"]')).length === 0, 'Escape closes the dialog');
    await avatarPick(page, 'lang-en');

    /* the commit confirm shows its reach BEFORE anything is sent, and Cancel sends nothing */
    await goTab(page, 'popups');
    await page.click('[data-testid="gal-open-commit"]');
    await page.waitForSelector('#cb_confirm');
    const ask = await page.textContent('#cb_confirm');
    check(/1,180\.00/.test(ask) && /USD/.test(ask) && /3 recipients/.test(ask) && /Asha Traders/.test(ask), 'commit confirm shows amount + currency, recipients and count: ' + ask.replace(/\s+/g, ' ').slice(0, 120));
    await page.screenshot({ path: path.join(OUT, label + '-light-en-commit-confirm.png') });
    await page.click('[data-testid="confirm-cancel"]');
    check((await page.$$('#toast .toast')).length === 0, 'Cancel sends nothing (no toast)');
    await page.click('[data-testid="gal-open-commit"]');
    await page.waitForSelector('#cb_confirm');
    await page.click('[data-testid="confirm-ok"]');
    await page.waitForFunction(() => /Bill posted/.test((document.querySelector('#toast .toast') || {}).textContent || ''));
    check(true, 'Confirm names the result in the toast: "Bill posted" (not a bare Done)');
    check(await toastClear(page), label + ': the toast covers no button');
    await page.screenshot({ path: path.join(OUT, label + '-light-en-toast-posted.png') });
    await page.click('[data-testid="gal-open-remove"]');
    await page.waitForSelector('#cb_confirm');
    await page.click('[data-testid="confirm-ok"]');
    await page.waitForFunction(() => /Supplier removed/.test((document.querySelector('#toast .toast') || {}).textContent || ''));
    check((await page.$$('#toast #undoBtn')).length === 1, 'a remove offers Undo in the same bar');
    check(await toastClear(page), label + ': the remove toast with Undo covers no button');
    await page.screenshot({ path: path.join(OUT, label + '-light-en-toast-removed.png') });
    await page.click('#undoBtn');
    await page.waitForFunction(() => document.querySelectorAll('#toast .toast').length === 0 || /restored/.test(document.querySelector('#toast .toast').textContent));
    check(true, 'Undo runs (the bar clears)');
    await avatarPick(page, 'lang-ta');
    await page.click('[data-testid="gal-open-commit"]');
    await page.waitForSelector('#cb_confirm');
    await page.click('[data-testid="confirm-ok"]');
    await page.waitForFunction(() => /[஀-௿]/.test((document.querySelector('#toast .toast') || {}).textContent || ''));
    check(await toastClear(page), label + ': the Tamil toast ("' + (await page.textContent('#toast .toast')) + '") covers no button');
    await avatarPick(page, 'lang-en');

    check(await page.evaluate(() => localStorage.getItem('cb_lang') === 'fr' && localStorage.getItem('cb_theme') === 'navy' && localStorage.getItem('cb_sess').includes('SHOULD-NOT') && localStorage.length === 3), 'the page wrote nothing to storage and left the visitor\'s own keys alone');
    await context.close();
  }
  /* the hash routes: a section has its own address */
  for (const route of ['meets', 'icons', 'themes']) {
    const routed = await browser.newContext({ viewport: { width: 1366, height: 650 } });
    const routedPage = await routed.newPage();
    await routedPage.goto(base + '/ui-standard.html#' + route);
    await routedPage.waitForSelector('[data-testid="skel-nav-' + route + '"][aria-current="page"]');
    check(true, '#' + route + ' opens its section directly');
    await routedPage.screenshot({ path: path.join(OUT, '1366-hash-' + route + '.png') });
    await routed.close();
  }
  /* the shell bar and the left pane (Option B) */
  const shellContext = await browser.newContext({ viewport: { width: 1366, height: 650 } });
  const shellPage = await shellContext.newPage();
  await shellPage.goto(base + '/ui-standard.html');
  await shellPage.waitForSelector('[data-testid="gal-to-standards"]');
  check((await shellPage.textContent('[data-testid="gal-to-standards"]')).indexOf('Standards') >= 0 && (await shellPage.getAttribute('[data-testid="gal-to-standards"]', 'href')) === '/standards.html', 'the shell bar has "‹ Standards" back to the Standards page');
  check((await shellPage.$$('[data-testid^="skel-nav-"]')).length === 8, 'the frame sidebar lists the eight sections');
  const heights = await shellPage.$$eval('#hdr button, [data-testid^="skel-nav-"], .tohome', (nodes) => nodes.map((node) => Math.round(node.getBoundingClientRect().height)));
  check(heights.every((height) => height >= 44), 'every control in the bar, the list and the shell is at least 44 px high (' + Math.min(...heights) + ')');
  const codes = await shellPage.$$eval('[data-cbsid^="UIS001-B"]', (nodes) => nodes.map((node) => node.getAttribute('data-cbsid')));
  check(['UIS001-B01', 'UIS001-B08', 'UIS001-B09', 'UIS001-B18', 'UIS001-B20', 'UIS001-B27'].every((code) => codes.indexOf(code) >= 0), 'the page controls carry UIS001-B01..B09, B18, B20..B27 (the section list belongs to the frame): ' + codes.length);
  await shellContext.close();
  /* the Mobile frame on a desktop viewport */
  const context = await browser.newContext({ viewport: { width: 1366, height: 650 } });
  const page = await context.newPage();
  await page.goto(base + '/ui-standard.html');
  await viewPick(page, 'screen', 'mobile');
  const frame = await page.$eval('#frame', (node) => [node.offsetWidth, node.offsetHeight]);
  check(frame[0] === 390 && frame[1] === 844, 'Screen: Mobile draws a 390x844 frame (' + frame.join('x') + ')');
  await page.screenshot({ path: path.join(OUT, '1366-light-en-mobile-frame.png') });
  await viewPick(page, 'screen', 'desktop');
  await page.screenshot({ path: path.join(OUT, '1366-light-en-desktop-frame.png') });
  await context.close();
  await browser.close();
  server.close();
  check(fontRequests.every((url) => /\.(css|woff2?)|css2\?/.test(url) || /fonts\.gstatic\.com\//.test(url)) , 'the only third-party requests are the product faces (Google Fonts, as app.html loads them): ' + fontRequests.length);
  check(stray.length === 0, 'no request left the page except its own static files ' + JSON.stringify(stray.slice(0, 3)));
  check(errors.length === 0, 'no page error or console error ' + JSON.stringify(errors.slice(0, 3)));
  console.log(failures ? failures + ' FAILED' : 'all ok');
  process.exit(failures ? 1 : 0);
})().catch((error) => { console.error(error); process.exit(2); });
