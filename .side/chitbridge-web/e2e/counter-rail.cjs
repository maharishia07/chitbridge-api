/* counter-rail.cjs — Does the rail actually lead with the Counter, and does its door open? (2026-09-08)
 * Athi asked for the counter in place of Compose, with one button that puts it on the shop's PC. This drives the deployed app with
 * the shared session and checks the three things that could silently be wrong: the lead row, that Compose is still reachable, and
 * that the door offers both ways in. It does NOT press the buttons — one mints a key and the other downloads a file.
 * Run: node e2e/counter-rail.cjs
 */
'use strict';
const path = require('path');
const { chromium } = require('@playwright/test');
const WEB = process.env.CB_WEB_BASE || 'https://chitbridge-web.vercel.app';
const SESSION = process.env.CB_SESSION || path.join(__dirname, '.auth', 'user.json');

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ baseURL: WEB, storageState: SESSION });
  const p = await ctx.newPage();
  const threw = [];
  p.on('pageerror', (e) => threw.push(e.message));
  await p.goto('/app.html');
  await p.getByTestId('nav-compose').waitFor({ state: 'visible', timeout: 45000 });

  const rail = await p.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('.rail button[data-testid^="nav-"], nav button[data-testid^="nav-"], [data-testid^="nav-"]'))
      .filter((b) => b.dataset.testid && b.innerText.trim());
    return btns.slice(0, 9).map((b) => b.dataset.testid.replace('nav-', '') + ' (' + b.innerText.trim().split('\n')[0] + ')');
  });
  console.log('rail, top to bottom: ' + rail.join(' · '));

  const compose = await p.getByTestId('nav-compose').isVisible();
  console.log((compose ? '  ok   ' : '  FAIL ') + 'Compose is still on the rail');

  await p.evaluate(() => counterOpen());
  await p.getByTestId('counter-door').waitFor({ timeout: 15000 });
  const doors = await p.evaluate(() => ({
    here: (document.querySelector('[data-testid="counter-open-here"]') || {}).innerText,
    kit: (document.querySelector('[data-testid="counter-download"]') || {}).innerText,
    words: document.querySelector('[data-testid="counter-door"]').innerText.replace(/\s+/g, ' ').slice(0, 200),
  }));
  console.log((doors.here && doors.kit ? '  ok   ' : '  FAIL ') + 'two doors: "' + doors.here + '" · "' + doors.kit + '"');
  console.log('         ' + doors.words);

  console.log(threw.length ? 'THREW: ' + threw.join(' | ') : 'no errors on the page');
  await b.close();
  process.exit(threw.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
