/* walk-kb-sheet-dialog.cjs - A NATIVE <dialog class="sheet"> KEEPS THE FIVE DIALOG KEYBOARD RULES (1b 2c 4 5 8; proof run sit-grund-2026-11-14, FAILS.md)
 * The shared piece is public/app/sheet-dialog.js; the real ui.js, ui-field.js and accounts-shell.js (CBConfirm, CBUnsaved) are loaded beside it on a fixture page, with one
 * sheet marked the way the callers mark theirs (a required field + data-sheet-save). Keyboard only, 1366 x 768 and 390 x 844:
 *   1b  opens with the focus on the first field, not on the corner Close        2c  Escape on a clean sheet closes it, the focus is back on the opener, also when a repaint replaced the opener
 *   4   Enter in the one-line field presses Save; Enter in a textarea does not   5   Save with the field empty does not run: focus on the field, aria-invalid, aria-describedby names the sentence
 *   8   Escape after typing asks first (Stay keeps the sheet and the focus; Discard closes it and returns the focus); no question when nothing was typed
 * CALLERS (static): the five pages load the module, and each save button / required field the proof run named carries its mark.
 * Goes red when sheet-dialog.js is taken away from a page, or any rule is removed from it.    Run: NODE_PATH=<dir with @playwright/test> node e2e/walk-kb-sheet-dialog.cjs */
'use strict';
const fs = require('fs'), path = require('path');
const { chromium } = require('@playwright/test');
const { serve } = require('./lib/serve.cjs');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok  ' + m); } else { fail++; console.log('  XX  ' + m); } };
const PUB = path.join(__dirname, '..', 'public');
const read = (f) => fs.readFileSync(path.join(PUB, f), 'utf8');

/* static: who loads the module, who marks what */
['catalogue', 'crm', 'employees', 'finance', 'tasks'].forEach((p) => {
  const src = read(p + '.html');
  ok(/app\/sheet-dialog\.js/.test(src) && /app\/ui-field\.js/.test(src), 'static · ' + p + '.html loads sheet-dialog.js and ui-field.js');
  ok(src.indexOf('app/ui.js') < src.indexOf('app/ui-field.js'), 'static · ' + p + '.html loads ui-field.js after ui.js');
});
[['app/cap-catalogue.js', 'id="cat_save" data-sheet-save'], ['app/cap-employees.js', 'id="emp_add_go" data-testid="emp-add-go" data-sheet-save'], ['app/cap-tasks.js', 'id="tk_new_go" data-testid="tk-new-go" data-sheet-save'],
  ['app/cap-books.js', 'data-testid="pay_record" data-sheet-save'], ['app/cap-crm.js', "' data-sheet-save'"]].forEach(([f, s]) => ok(read(f).includes(s), 'static · ' + f + ' marks its save button (data-sheet-save)'));
['app/cap-catalogue.js', 'app/cap-employees.js', 'app/cap-tasks.js', 'app/cap-books.js'].forEach((f) => ok(/required[^\n]{0,24}data-required-msg/.test(read(f)), 'static · ' + f + ' marks its required field'));

/* static: the Price list overlay (offer-lab-next.html, not a native dialog) gives the focus back to its opener on close (2c) */
const lab = read('offer-lab-next.html');
const closeBody = (/function closePriceOverlay[(][)] [{]([^}]*)[}]/.exec(lab) || [])[1] || '';
ok(closeBody.indexOf('priceOvGiveBack()') > closeBody.indexOf('render()') && lab.includes('back: priceOvOpenerOf(document.activeElement)'),'static · offer-lab-next.html closePriceOverlay gives the focus back to the opener it remembered at open');

const FIXTURE = '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>kb</title></head><body>' +
  '<button id="open1" data-cbsid="KBT001-B01">New thing</button><button id="other">Other</button><div id="saved">0</div>' +
  '<dialog class="sheet" id="sh"></dialog>' +
  '<script src="/config.js"></script><script src="/app/accounts-shell.js"></script><script src="/app/helpers.js"></script><script src="/app/ui.js"></script><script src="/app/ui-field.js"></script><script src="/app/sheet-dialog.js"></script>' +
  '<script>' +
  'function paint(){document.getElementById("sh").innerHTML=\'<button type="button" class="mx" id="x" aria-label="Close">\\u2715</button><label for="f_name">Name</label><input class="inp" id="f_name" required data-required-msg="A name is needed.">' +
  '<textarea id="f_note"></textarea><button type="button" id="save" data-sheet-save>Save</button>\';' +
  'document.getElementById("x").onclick=function(){document.getElementById("sh").close();};' +
  'document.getElementById("save").onclick=function(){document.getElementById("saved").textContent=String(+document.getElementById("saved").textContent+1);document.getElementById("sh").close();};}' +
  'document.getElementById("open1").onclick=function(){paint();document.getElementById("sh").showModal();};' +
  'document.getElementById("sh").addEventListener("cancel",function(e){e.preventDefault();document.getElementById("sh").close();});' +
  '</script></body></html>';

const where = (page) => page.evaluate(() => { const a = document.activeElement; return a ? (a.id || a.tagName) : 'none'; });
const open = async (page) => { await page.focus('#open1'); await page.keyboard.press('Enter'); await page.waitForTimeout(120); };
const isOpen = (page) => page.evaluate(() => document.getElementById('sh').open);
const confirmUp = (page) => page.evaluate(() => { const c = document.getElementById('cb_confirm'); return !!c && c.open; });
const saved = (page) => page.textContent('#saved');

async function runWidth(browser, S, w, h) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, serviceWorkers: 'block' });
  await ctx.route('**/kb-fixture.html', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: FIXTURE }));
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  const page = await ctx.newPage(), errs = [], T = w + ' · ';
  page.on('pageerror', (e) => errs.push(String(e.message)));
  await page.goto(S.url('/kb-fixture.html'));
  await open(page);
  ok((await where(page)) === 'f_name', T + '1b · the sheet opens with the focus on its first field (' + (await where(page)) + '), not the corner Close');
  await page.keyboard.press('Escape'); await page.waitForTimeout(150);
  ok(!(await isOpen(page)) && !(await confirmUp(page)), T + '8 · Escape on a sheet nothing was typed in closes it with no question');
  ok((await where(page)) === 'open1', T + '2c · the focus is back on the opener (' + (await where(page)) + ')');
  await open(page);
  await page.evaluate(() => { const o = document.getElementById('open1'), n = o.cloneNode(true); n.onclick = o.onclick; o.replaceWith(n); });
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  ok((await where(page)) === 'open1', T + '2c · the opener was repainted while the sheet was open: the focus comes back to the one with the same id (' + (await where(page)) + ')');
  await open(page); await page.keyboard.type('Tea'); await page.keyboard.press('Enter'); await page.waitForTimeout(150);
  ok((await saved(page)) === '1' && !(await isOpen(page)), T + '4 · Enter in the one-line field presses Save (saved ' + (await saved(page)) + ')');
  await open(page); await page.focus('#f_note'); await page.keyboard.type('a'); await page.keyboard.press('Enter'); await page.waitForTimeout(120);
  ok((await saved(page)) === '1' && (await isOpen(page)), T + '4 · Enter in a textarea is a new line, it does not save');
  await page.evaluate(() => { const n = document.getElementById('f_note'); n.value = ''; n.defaultValue = ''; });
  await page.focus('#save'); await page.keyboard.press('Enter'); await page.waitForTimeout(150);
  const refused = await page.evaluate(() => {
    const a = document.activeElement, d = a.getAttribute('aria-describedby');
    const t = d ? d.split(' ').map((i) => (document.getElementById(i) || {}).textContent || '').join(' ') : '';
    return { id: a.id, invalid: a.getAttribute('aria-invalid'), text: t, open: document.getElementById('sh').open, saved: document.getElementById('saved').textContent };
  });
  ok(refused.open && refused.saved === '1', T + '5 · Save with the required field empty does not run and the sheet stays open');
  ok(refused.id === 'f_name' && refused.invalid === 'true', T + '5 · the focus is on the empty field, aria-invalid=true (' + refused.id + ')');
  ok(/A name is needed/.test(refused.text), T + '5 · aria-describedby resolves to the sentence ("' + refused.text.trim() + '")');
  await page.keyboard.type('T');
  ok((await page.evaluate(() => document.getElementById('f_name').getAttribute('aria-invalid'))) === null, T + '5 · typing in the field takes the mark away');
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  ok((await isOpen(page)) && (await confirmUp(page)), T + '8 · Escape after typing asks first and the sheet is still open');
  await page.click('#cb_confirm [data-testid="confirm-cancel"]'); await page.waitForTimeout(200);
  ok((await isOpen(page)) && !(await confirmUp(page)), T + '8 · Stay keeps the sheet');
  ok((await where(page)) === 'f_name', T + '8 · after Stay the focus is back in the field (' + (await where(page)) + ')');
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  await page.click('#cb_confirm [data-testid="confirm-ok"]'); await page.waitForTimeout(250);
  ok(!(await isOpen(page)), T + '8 · Discard closes the sheet');
  ok((await where(page)) === 'open1', T + '2c · after Discard the focus is back on the opener (' + (await where(page)) + ')');
  ok(errs.length === 0, T + 'no page error' + (errs.length ? ' · ' + errs[0].slice(0, 140) : ''));
  await ctx.close();
}

(async () => {
  const S = await serve(), browser = await chromium.launch();
  for (const [w, h] of [[1366, 768], [390, 844]]) await runWidth(browser, S, w, h);
  await browser.close(); S.close();
  console.log(pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
