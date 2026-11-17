#!/usr/bin/env node
/* e2e/shortcuts-keyboard.cjs: THE KEYBOARD SHORTCUTS, PROVED BY THE KEYBOARD (MNT-63, public/app/shortcuts.js).
 * OWNS      three nav shortcuts (two rail area chords, a card by g then a letter) · one popup main-action shortcut · the ? sheet · the setting that turns them off · axe on Home.
 * CALLED BY by hand (one at a time): NODE_PATH=e2e/node_modules node e2e/shortcuts-keyboard.cjs
 * CARD      29-qa-test-tooling-ux-locale-and-design-system/shortcuts
 * Pattern   e2e/shell.cjs: Playwright, the static server on a free port, the api stood in by ctx.route; nothing reaches localhost:3000 or the live site. */
'use strict';
const fs = require('fs');
const path = require('path');
const { serve } = require('./lib/serve.cjs');
const C = require('./lib/contract.cjs');

const SESSION = JSON.stringify({ token: 'tok-keys', role: 'entity', name: 'Asha', entity: 'Books Shop' });
const out = { pass: 0, fail: 0 };
const ok = (cond, what) => { out[cond ? 'pass' : 'fail']++; console.log((cond ? '  ok  ' : '  XX  ') + what); };

async function context(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, locale: 'en-IN', serviceWorkers: 'block' });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
  await ctx.route('**/api/**', (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/entities/me') return C.json(route, 200, { entity: { display_name: 'Books Shop', ui_prefs: {} } });
    return C.json(route, 200, { ok: true });
  });
  await ctx.addInitScript((session) => { try { localStorage.setItem('cb_api_base', location.origin); localStorage.setItem('cb_sess', session); } catch (_) {} }, SESSION);
  return ctx;
}
async function home(ctx, web, errors) {
  const page = await ctx.newPage();
  page.on('pageerror', (error) => errors.push(String(error.message)));
  await page.goto(web.url('/'));
  await page.waitForSelector('[data-testid="shell-card-finance"]', { timeout: 20000 });
  await page.waitForFunction(() => document.querySelector('[data-testid="shell-card-finance"]').hasAttribute('data-shortcut'), null, { timeout: 10000 });
  return page;
}
const current = (page) => page.evaluate(() => ((document.querySelector('.cbsh-nv[aria-current]') || {}).dataset || {}).go || '');

async function staticProof() {
  const unit = fs.readFileSync(path.join(__dirname, '..', 'public', 'app', 'shortcuts.js'), 'utf8');
  const shell = fs.readFileSync(path.join(__dirname, '..', 'public', 'app', 'shell.js'), 'utf8');
  ok(shell.includes('/app/shortcuts-register.js') && shell.includes('/app/shortcuts.js'), 'static: the shell loads the register, then the unit, on every page it frames');
  ok(unit.includes("'Alt+Shift+'") && !/'(Control|Ctrl|Meta)+/.test(unit), 'static: the unit answers a chord and names no Ctrl or Meta key');
}
async function navProof(ctx, web, errors) {
  const page = await home(ctx, web, errors);
  ok((await page.getAttribute('[data-testid="shell-nav-running"]', 'aria-keyshortcuts')) === 'Alt+Shift+R', 'rail: Running says Alt+Shift+R in aria-keyshortcuts');
  ok((await page.getAttribute('[data-testid="shell-card-tasks"]', 'data-shortcut')) === 'g t', 'card: Tasks names g t (a sequence has no aria-keyshortcuts)');
  await page.keyboard.press('Alt+Shift+R');
  await page.waitForTimeout(400);
  ok((await current(page)) === 'running', 'shortcut 1: Alt+Shift+R lights the Running area on the rail');
  await page.keyboard.press('Alt+Shift+L');
  await page.waitForTimeout(400);
  ok((await current(page)) === 'labs', 'shortcut 2: Alt+Shift+L lights the Labs area');
  await page.keyboard.press('g');
  await page.keyboard.press('t');
  await page.waitForURL(/\/tasks\.html/, { timeout: 15000 }).then(() => ok(true, 'shortcut 3: g then t opens the Tasks page'), () => ok(false, 'shortcut 3: g then t opens the Tasks page'));
  await page.close();
}
async function sheetProof(ctx, web, errors) {
  const page = await home(ctx, web, errors);
  await page.keyboard.press('?');
  await page.waitForSelector('[data-testid="shortcut-sheet"]', { timeout: 5000 });
  const text = await page.textContent('[data-testid="shortcut-sheet"]');
  ok(/Alt\+Shift\+R/.test(text) && /g, t/.test(text), 'keyboard walk: the ? sheet says the area chords and the g keys in words, from the register');
  const chip = await page.locator('dialog[open] [data-testid="popup-code"]').first().textContent().catch(() => '');
  ok(chip.trim() === 'POP144', 'the sheet wears its own popup code POP144');
  await page.keyboard.press('Alt+Shift+D');
  await page.waitForSelector('[data-testid="shortcut-sheet"]', { state: 'detached', timeout: 3000 }).then(() => ok(true, 'the popup key closes the sheet (its main action is Close)'), () => ok(false, 'the popup key closes the sheet'));
  await page.close();
}
async function popupProof(ctx, web, errors) {
  const page = await ctx.newPage();
  page.on('pageerror', (error) => errors.push(String(error.message)));
  await page.goto(web.url('/ui-standard.html'));
  await page.waitForFunction(() => window.CBShortcuts && window.CBUi && typeof window.modal === 'function', null, { timeout: 20000 });
  await page.evaluate(() => {
    window.__pressed = 0;
    window.CBUi.dialog({ mount: 'ACC002-U01', title: 'Keys probe', pop: 'POP096', body: '<p>probe</p>', actions: [
      { name: 'cancel', options: { mount: 'ACC002-U01' } },
      { name: 'save', options: { mount: 'ACC002-U01', key: 'probe', effect: 'preference', onPress: () => { window.__pressed++; } } }] });
  });
  ok((await page.getAttribute('.mfoot .pri', 'aria-keyshortcuts')) === 'Alt+Shift+D', 'popup: the main action (Save) says Alt+Shift+D');
  await page.keyboard.press('Alt+Shift+D');
  await page.waitForTimeout(300);
  ok((await page.evaluate(() => window.__pressed)) === 1, 'shortcut 4: Alt+Shift+D presses the open popup main action');
  await page.close();
}
/** a held key must never press the confirm popup the first press opened (a money promise needs a deliberate second press) */
async function confirmProof(ctx, web, errors) {
  const page = await ctx.newPage();
  page.on('pageerror', (error) => errors.push(String(error.message)));
  await page.goto(web.url('/ui-standard.html'));
  await page.waitForFunction(() => window.CBShortcuts && window.CBUi && typeof window.modal === 'function', null, { timeout: 20000 });
  await page.evaluate(() => {
    window.__sent = 0;
    const confirmSend = () => window.CBUi.dialog({ mount: 'ACC002-U01', title: 'Send to everyone?', pop: 'POP097', body: '<p>confirm</p>', actions: [
      { name: 'cancel', options: { mount: 'ACC002-U01' } },
      { name: 'save', options: { mount: 'ACC002-U01', key: 'sent', effect: 'preference', onPress: () => { window.__sent++; } } }] });
    window.CBUi.dialog({ mount: 'ACC002-U01', title: 'Offer', pop: 'POP096', body: '<p>offer</p>', actions: [
      { name: 'cancel', options: { mount: 'ACC002-U01' } },
      { name: 'save', options: { mount: 'ACC002-U01', key: 'ask', effect: 'preference', onPress: confirmSend } }] });
  });
  await page.keyboard.down('Alt');
  await page.keyboard.down('Shift');
  for (let held = 0; held < 6; held++) await page.keyboard.down('KeyD'); /* the second down and on carry event.repeat */
  await page.keyboard.up('KeyD');
  await page.keyboard.up('Shift');
  await page.keyboard.up('Alt');
  await page.waitForTimeout(300);
  ok((await page.evaluate(() => window.__sent)) === 0, 'held key: the confirm popup the key opened was not pressed');
  ok((await page.locator('.mhd:has-text("Send to everyone?")').count()) === 1, 'held key: the confirm popup stays open');
  await page.close();
}
/** typing, composing and the sheet's focus: no shortcut fires inside a field or an IME composition, and the sheet gives focus back */
async function guardsProof(ctx, web, errors) {
  const page = await home(ctx, web, errors);
  await page.evaluate(() => { const box = document.createElement('input'); box.id = 'probe-box'; box.setAttribute('aria-label', 'probe'); document.body.prepend(box); box.focus(); });
  await page.keyboard.press('g');
  await page.keyboard.press('t');
  await page.keyboard.press('?');
  await page.waitForTimeout(500);
  ok(!/tasks\.html/.test(page.url()) && (await page.locator('[data-testid="shortcut-sheet"]').count()) === 0, 'typing in a field: g then t and ? type, and fire nothing');
  ok((await page.inputValue('#probe-box')) === 'gt?', 'typing in a field: the field received the keys');
  await page.evaluate(() => document.getElementById('probe-box').blur());
  await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyM', key: 'M', altKey: true, shiftKey: true, isComposing: true, bubbles: true })));
  await page.waitForTimeout(300);
  ok((await current(page)) !== 'money', 'IME composing: Alt+Shift+M while composing does nothing');
  await page.focus('[data-testid="shell-nav-running"]');
  await page.keyboard.press('?');
  await page.waitForSelector('[data-testid="shortcut-sheet"]', { timeout: 5000 });
  await page.keyboard.press('Escape');
  await page.waitForSelector('[data-testid="shortcut-sheet"]', { state: 'detached', timeout: 3000 });
  ok((await page.evaluate(() => document.activeElement && document.activeElement.getAttribute('data-testid'))) === 'shell-nav-running', 'the ? sheet returns focus to where the person was');
  await page.close();
}
async function offProof(ctx, web, errors) {
  const page = await home(ctx, web, errors);
  await page.evaluate(() => window.CBAvatar.set('keys', 'off'));
  await page.keyboard.press('Alt+Shift+M');
  await page.waitForTimeout(300);
  ok((await current(page)) !== 'money', 'setting off: Alt+Shift+M does nothing');
  ok((await page.getAttribute('[data-testid="shell-nav-money"]', 'aria-keyshortcuts')) === null, 'setting off: the rail stops saying its keys');
  await page.keyboard.press('?');
  await page.waitForTimeout(300);
  ok((await page.locator('[data-testid="shortcut-sheet"]').count()) === 0, 'setting off: ? opens nothing');
  await page.keyboard.press('g');
  await page.keyboard.press('f');
  await page.waitForTimeout(500);
  ok(!/finance\.html/.test(page.url()), 'setting off: g then f goes nowhere');
  await page.evaluate(() => window.CBAvatar.set('keys', 'on'));
  await page.keyboard.press('Alt+Shift+M');
  await page.waitForTimeout(400);
  ok((await current(page)) === 'money', 'setting on again: Alt+Shift+M works');
  await page.close();
}
async function axeProof(ctx, web, errors) {
  const { AxeBuilder } = require('@axe-core/playwright');
  const page = await home(ctx, web, errors);
  const result = await new AxeBuilder({ page }).analyze();
  const bad = result.violations.filter((item) => item.impact === 'serious' || item.impact === 'critical');
  ok(bad.length === 0, 'axe (colour contrast included): Home, no serious or critical violation' + (bad.length ? ': ' + bad.map((item) => item.id + ' x' + item.nodes.length).join(', ') : ''));
  await page.close();
}

(async () => {
  const { chromium } = require('@playwright/test');
  const web = await serve();
  const browser = await chromium.launch();
  const errors = [];
  for (const proof of [staticProof, navProof, sheetProof, popupProof, confirmProof, guardsProof, offProof, axeProof]) {
    const ctx = await context(browser);
    try { await proof(ctx, web, errors); } catch (error) { ok(false, proof.name + ' threw: ' + error.message); }
    await ctx.close();
  }
  ok(!errors.length, 'no page error' + (errors.length ? ': ' + errors[0] : ''));
  await browser.close();
  web.srv.close();
  console.log('\n' + out.pass + ' passed, ' + out.fail + ' failed');
  process.exit(out.fail ? 1 : 0);
})();
