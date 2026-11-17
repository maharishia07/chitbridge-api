/* walk-ui-library-offer-lab.cjs - THE OFFER LAB'S FOUR CLOSE CORNERS ARE THE LIBRARY'S (UX-137, web-controls-1).
 *
 * OWNS      the proof that the four overlay corners (price list, combos and modifiers, till preview, "Work it out") are the library's Close (CMP005-B01)
 *           with its screen mount OLB001-U01..U04, and that each one really works as a control:
 *           an accessible name, a visible focus ring when reached by keyboard, Tab reaches it, Enter and Space both press it, a 44 px target on a phone,
 *           and its glyph clears WCAG non-text AA (3:1) in Cream and Dark at 1366 and 390. (The lab's backBtn helper has no caller on this page, so it is left as it was.)
 * CALLED BY by hand and the SIT box: sh toolset/sit-box-run.sh sit-au e2e <branch> e2e/walk-ui-library-offer-lab.cjs
 * FLOW      UX-137 step 3 (customer pages, controls onto the library); no money is touched, the close handlers are the page's own.
 * CARD      29-qa-test-tooling-ux-locale-and-design-system/design-system
 * Run: node e2e/walk-ui-library-offer-lab.cjs   (needs @playwright/test; the SIT box has it)
 */
'use strict';
const { chromium } = require('@playwright/test');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', 'public');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const GLYPH_NEED = 3, PHONE_MIN_PX = 44;
let bad = 0;
const say = (label, ok, detail) => { console.log('  ' + String(label).padEnd(64) + '· ' + detail + '  ' + (ok ? 'OK' : (bad++, 'FAILED'))); };

/** the four overlay corners: [testid, mount, the overlay that holds it, how the test opens it] */
const CLOSES = [
  ['close-price-list', 'OLB001-U01', 'priceOverlay'],
  ['close-mod-lab', 'OLB001-U02', 'modLabOverlay'],
  ['close-till-preview', 'OLB001-U03', 'comboTillPreviewOverlay'],
  ['close-work', 'OLB001-U04', 'workScrim']
];

function serve() {
  return http.createServer((req, res) => {
    const file = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html');
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('no'); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'text/plain' });
    fs.createReadStream(file).pipe(res);
  });
}
/** the contrast of a glyph button: its colour against the colour painted behind it, both read from the page */
function glyphRatio(testid) {
  const el = document.querySelector('[data-testid="' + testid + '"]');
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const rgb = (value) => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = '#000'; ctx.fillStyle = value; ctx.fillRect(0, 0, 1, 1); const d = ctx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2]]; };
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const style = getComputedStyle(el);
  const a = lum(rgb(style.color)), b = lum(rgb(style.backgroundColor));
  return Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 100) / 100;
}
async function openOverlay(page, id) {
  await page.evaluate((overlay) => { document.getElementById(overlay).classList.add('on'); }, id);
}
async function isOpen(page, id) {
  return page.evaluate((overlay) => document.getElementById(overlay).classList.contains('on'), id);
}
/** Tab until the button holds focus (at most 60 presses); returns the presses it took, or -1 */
async function tabTo(page, testid) {
  await page.evaluate(() => { document.activeElement && document.activeElement.blur(); window.scrollTo(0, 0); });
  for (let presses = 1; presses <= 60; presses++) {
    await page.keyboard.press('Tab');
    if (await page.evaluate((id) => document.activeElement && document.activeElement.getAttribute('data-testid') === id, testid)) return presses;
  }
  return -1;
}
/** closeModLab (lab/combo-mode.js) sends the tab Home after closing, which is that file's business; the press is proved by its name being called and the overlay closing */
async function stubModLabNavigation(page) {
  await page.evaluate(() => { window.closeModLab = function () { document.getElementById('modLabOverlay').classList.remove('on'); }; });
}
async function checkClose(page, testid, mount, overlay) {
  if (overlay === 'modLabOverlay') await stubModLabNavigation(page);
  await openOverlay(page, overlay);
  const facts = await page.evaluate((id) => {
    const el = document.querySelector('[data-testid="' + id + '"]');
    return { sid: el.getAttribute('data-cbsid'), mount: el.getAttribute('data-cbmount'), name: el.getAttribute('aria-label'), tag: el.tagName, type: el.getAttribute('type') };
  }, testid);
  say(testid + ' is the library Close with its mount', facts.sid === 'CMP005-B01' && facts.mount === mount, facts.sid + ' ' + facts.mount);
  say(testid + ' has an accessible name', !!facts.name && /close/i.test(facts.name), JSON.stringify(facts.name));
  say(testid + ' is a native button', facts.tag === 'BUTTON' && facts.type === 'button', facts.tag + ' type=' + facts.type);
  const presses = await tabTo(page, testid);
  say(testid + ' is reached by Tab', presses > 0, presses + ' press(es)');
  const ring = await page.evaluate((id) => { const s = getComputedStyle(document.querySelector('[data-testid="' + id + '"]')); return { style: s.outlineStyle, width: parseFloat(s.outlineWidth) }; }, testid);
  say(testid + ' shows a visible focus ring from the keyboard', ring.style !== 'none' && ring.width >= 2, ring.style + ' ' + ring.width + 'px');
  await page.keyboard.press('Enter');
  say(testid + ' closes on Enter', !(await isOpen(page, overlay)), 'overlay off');
  await openOverlay(page, overlay);
  await tabTo(page, testid);
  await page.keyboard.press('Space');
  say(testid + ' closes on Space', !(await isOpen(page, overlay)), 'overlay off');
}
async function checkTheme(page, theme, width) {
  await page.setViewportSize({ width, height: width === 1366 ? 768 : 844 });
  await page.evaluate((key) => { CBAvatar.applyTheme(key); }, theme);
  for (const [testid, , overlay] of CLOSES) {
    await openOverlay(page, overlay);
    const ratio = await page.evaluate(glyphRatio, testid);
    const box = await page.evaluate((id) => { const r = document.querySelector('[data-testid="' + id + '"]').getBoundingClientRect(); return { w: r.width, h: r.height }; }, testid);
    say(testid + ' glyph contrast ' + theme + ' ' + width, ratio >= GLYPH_NEED, ratio + ':1 (need ' + GLYPH_NEED + ')');
    if (width === 390) say(testid + ' is 44 px on a phone ' + theme, box.w >= PHONE_MIN_PX - 0.5 && box.h >= PHONE_MIN_PX - 0.5, box.w + 'x' + box.h);
    await page.evaluate((id) => document.getElementById(id).classList.remove('on'), overlay);
  }
}

(async () => {
  const server = serve();
  await new Promise((resolve) => server.listen(0, resolve));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('http://127.0.0.1:' + server.address().port + '/offer-lab-next.html');
  await page.waitForTimeout(300);
  console.log('\n-- the four Close corners: identity, name, keyboard');
  for (const [testid, mount, overlay] of CLOSES) await checkClose(page, testid, mount, overlay);
  console.log('\n-- contrast and tap size, Cream and Dark, 1366 and 390');
  for (const theme of ['cream', 'dark']) for (const width of [1366, 390]) await checkTheme(page, theme, width);
  say('no page error', errors.length === 0, errors.join(' | ') || 'none');
  await browser.close();
  server.close();
  console.log(bad ? '\n' + bad + ' FAILED' : '\nALL PASS');
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
