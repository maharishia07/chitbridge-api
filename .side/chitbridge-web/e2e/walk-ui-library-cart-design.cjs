/* walk-ui-library-cart-design.cjs - THE CART DESIGN PAGE'S ADD, EDIT AND BACK ARE THE LIBRARY'S (UX-137, web-mount-1).
 *
 * OWNS      the proof that seven controls of cart-design.html are library mounts (OWN004-U01..U07) and each really works as a control:
 *           a native button with an accessible name, reached by Tab, a visible focus ring from the keyboard, Enter and Space both
 *           call the page's REAL handler (a line lands in the cart, a recipient in the list, the step changes), a 44 px target on a phone,
 *           and its text or glyph clears WCAG AA (4.5:1 text, 3:1 glyph). The disabled Cancel of step 1 says why, in words.
 *           The page has one light look (no Dark theme), so contrast is read for it alone at 1366 and 390.
 * CALLED BY by hand and the SIT box: sh toolset/sit-box-run.sh sit-grund e2e <branch> e2e/walk-ui-library-cart-design.cjs
 * FLOW      UX-137 step 3 (customer pages, controls onto the library); no money is touched and nothing is sent: the page is a mock.
 * CARD      29-qa-test-tooling-ux-locale-and-design-system/design-system
 * Run: node e2e/walk-ui-library-cart-design.cjs   (needs @playwright/test; the SIT box has it)
 */
'use strict';
const { chromium } = require('@playwright/test');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', 'public');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const TEXT_NEED = 4.5, GLYPH_NEED = 3, PHONE_MIN_PX = 44;
let bad = 0;
const say = (label, ok, detail) => { console.log('  ' + String(label).padEnd(64) + '· ' + detail + '  ' + (ok ? 'OK' : (bad++, 'FAILED'))); };

/** [testid, mount, library component, step the control lives on, what the control is called] */
const MOUNTS = [
  ['cd-add-item', 'OWN004-U01', 'CMP007-B01', 0, /add item/i],
  ['cd-add-recipient', 'OWN004-U02', 'CMP007-B01', 1, /add recipient/i],
  ['cd-back', 'OWN004-U06', 'CMP006-B01', 1, /back/i],
  ['cd-edit-items', 'OWN004-U03', 'CMP012-B01', 'review', /edit items/i],
  ['cd-edit-recipients', 'OWN004-U04', 'CMP012-B01', 'review', /edit recipients/i],
  ['cd-edit-details', 'OWN004-U05', 'CMP012-B01', 'review', /edit details/i]
];

function serve() {
  return http.createServer((req, res) => {
    const file = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html');
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('no'); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'text/plain' });
    fs.createReadStream(file).pipe(res);
  });
}
/** the contrast of a control's colour against the first painted colour behind it (its own, else its parents') */
function ratioOf(testid) {
  const el = document.querySelector('[data-testid="' + testid + '"]');
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const rgba = (value) => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = '#000'; ctx.fillStyle = value; ctx.fillRect(0, 0, 1, 1); const d = ctx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3]]; };
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  let node = el, back = [255, 255, 255, 0];
  while (node && back[3] === 0) { back = rgba(getComputedStyle(node).backgroundColor); node = node.parentElement; }
  const a = lum(rgba(getComputedStyle(el).color)), b = lum(back);
  return Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 100) / 100;
}
/** Tab until the control holds focus (at most 80 presses); returns the presses it took, or -1 */
async function tabTo(page, testid) {
  await page.evaluate(() => { document.activeElement && document.activeElement.blur(); });
  for (let presses = 1; presses <= 80; presses++) {
    await page.keyboard.press('Tab');
    if (await page.evaluate((id) => document.activeElement && document.activeElement.getAttribute('data-testid') === id, testid)) return presses;
  }
  return -1;
}
/** put the page on a step with its own go(); 'review' is the last step */
async function goStep(page, step) {
  await page.evaluate((target) => { go(target === 'review' ? STEPS.length - 1 : target); }, step);
}
/** the state the page keeps, read back after a press: the step, the recipients, the lines of the cart */
const stateOf = (page) => page.evaluate(() => ({ step: S.step, to: S.to.length, lines: CBCart.selected('cc').length, name: (document.getElementById('cn') || {}).value }));

async function identity(page, [testid, mount, element, step, name]) {
  await goStep(page, step);
  const facts = await page.evaluate((id) => {
    const el = document.querySelector('[data-testid="' + id + '"]');
    return { sid: el.getAttribute('data-cbsid'), mount: el.getAttribute('data-cbmount'), label: el.getAttribute('aria-label') || el.textContent.trim(), tag: el.tagName, type: el.getAttribute('type') };
  }, testid);
  say(testid + ' is the library control with its mount', facts.sid === element && facts.mount === mount, facts.sid + ' ' + facts.mount);
  say(testid + ' has an accessible name', name.test(facts.label), JSON.stringify(facts.label));
  say(testid + ' is a native button', facts.tag === 'BUTTON' && facts.type === 'button', facts.tag + ' type=' + facts.type);
  const presses = await tabTo(page, testid);
  say(testid + ' is reached by Tab', presses > 0, presses + ' press(es)');
  const ring = await page.evaluate((id) => { const s = getComputedStyle(document.querySelector('[data-testid="' + id + '"]')); return { style: s.outlineStyle, width: parseFloat(s.outlineWidth) }; }, testid);
  say(testid + ' shows a visible focus ring from the keyboard', ring.style !== 'none' && ring.width >= 2, ring.style + ' ' + ring.width + 'px');
}
/** each press is checked against the page's own state, so the handler really ran (no stub, no flag) */
async function pressesCallTheRealHandler(page) {
  console.log('\n-- Enter and Space call the page handlers');
  await goStep(page, 0);
  for (const [key, word] of [['Enter', 'Alpha'], ['Space', 'Beta']]) {
    const before = (await stateOf(page)).lines;
    await page.fill('#cn', word); await tabTo(page, 'cd-add-item'); await page.keyboard.press(key);
    const after = await stateOf(page);
    say('add item on ' + key + ' puts the line in the cart', after.lines === before + 1 && after.name === '', before + ' -> ' + after.lines + ' line(s)');
  }
  await goStep(page, 1);
  for (const [key, word] of [['Enter', 'Ravi'], ['Space', 'Meena']]) {
    const before = (await stateOf(page)).to;
    await page.fill('#tov', word); await tabTo(page, 'cd-add-recipient'); await page.keyboard.press(key);
    say('add recipient on ' + key + ' puts the name in the list', (await stateOf(page)).to === before + 1, before + ' -> ' + (await stateOf(page)).to);
  }
  for (const key of ['Enter', 'Space']) {
    await goStep(page, 2); await tabTo(page, 'cd-back'); await page.keyboard.press(key);
    say('back on ' + key + ' goes one step back', (await stateOf(page)).step === 1, 'step ' + (await stateOf(page)).step);
  }
  for (const [testid, want] of [['cd-edit-items', 0], ['cd-edit-recipients', 1], ['cd-edit-details', 2]]) {
    for (const key of ['Enter', 'Space']) {
      await goStep(page, 'review'); await tabTo(page, testid); await page.keyboard.press(key);
      say(testid + ' on ' + key + ' returns to its step', (await stateOf(page)).step === want, 'step ' + (await stateOf(page)).step + ' (want ' + want + ')');
    }
  }
}
async function disabledCancel(page) {
  console.log('\n-- step 1: Cancel is shown, off, and says why');
  await goStep(page, 0);
  const facts = await page.evaluate(() => { const el = document.querySelector('[data-testid="cd-cancel"]'); return { sid: el.getAttribute('data-cbsid'), mount: el.getAttribute('data-cbmount'), off: el.getAttribute('aria-disabled') === 'true' /* the library never sets native disabled: the control stays in the Tab order (ui.js:59) */, why: el.getAttribute('title') }; });
  say('cd-cancel is the library Cancel with its mount', facts.sid === 'CMP003-B01' && facts.mount === 'OWN004-U07', facts.sid + ' ' + facts.mount);
  say('cd-cancel is off and says why in words', facts.off && /first step/i.test(facts.why || ''), JSON.stringify(facts.why));
}
async function sizeAndContrast(page, width) {
  await page.setViewportSize({ width, height: width === 1366 ? 768 : 844 });
  console.log('\n-- contrast and tap size at ' + width);
  for (const [testid, , , step] of MOUNTS) {
    await goStep(page, step);
    const ratio = await page.evaluate(ratioOf, testid);
    const need = testid.indexOf('cd-add') === 0 ? GLYPH_NEED : TEXT_NEED;
    say(testid + ' contrast ' + width, ratio >= need, ratio + ':1 (need ' + need + ')');
    if (width === 390) {
      const box = await page.evaluate((id) => { const r = document.querySelector('[data-testid="' + id + '"]').getBoundingClientRect(); return { w: r.width, h: r.height }; }, testid);
      say(testid + ' is 44 px on a phone', box.w >= PHONE_MIN_PX - 0.5 && box.h >= PHONE_MIN_PX - 0.5, box.w + 'x' + box.h);
    }
  }
}

(async () => {
  const server = serve();
  await new Promise((resolve) => server.listen(0, resolve));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('http://127.0.0.1:' + server.address().port + '/cart-design.html');
  await page.waitForTimeout(300);
  console.log('\n-- identity, name, keyboard');
  for (const row of MOUNTS) await identity(page, row);
  await pressesCallTheRealHandler(page);
  await disabledCancel(page);
  for (const width of [1366, 390]) await sizeAndContrast(page, width);
  say('no page error', errors.length === 0, errors.join(' | ') || 'none');
  await browser.close();
  server.close();
  console.log(bad ? '\n' + bad + ' FAILED' : '\nALL PASS');
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
