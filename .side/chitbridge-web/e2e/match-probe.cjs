/* match-probe.cjs — Does the Match screen open, load and say something true? (2026-09-08)
 * It is the screen the product is sold on, so the failure mode that matters is silence: a rail row that opens an empty panel because
 * the capability did not load, or a table that renders "undefined" for a shop with no purchase orders yet.
 * Run: node e2e/match-probe.cjs
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
  p.on('console', (m) => { if (m.type() === 'error') threw.push('console: ' + m.text().slice(0, 160)); });

  await p.goto('/app.html');
  await p.getByTestId('nav-match').waitFor({ state: 'visible', timeout: 45000 });
  console.log('  ok   the rail has a Match row');

  await p.getByTestId('nav-match').click();
  try { await p.waitForFunction(() => typeof UI !== 'undefined' && UI.nav === 'match', null, { timeout: 8000 }); }
  catch (_) { await p.getByTestId('nav-match').click(); await p.waitForFunction(() => UI.nav === 'match', null, { timeout: 15000 }); }
  await p.getByTestId('match-screen').waitFor({ timeout: 30000 });
  await p.waitForTimeout(2500);

  const out = await p.evaluate(() => ({
    chips: Array.from(document.querySelectorAll('[data-testid^="match-chip-"]')).map((b) => b.innerText.replace(/\s+/g, ' ')),
    orders: document.querySelectorAll('[data-testid="match-order"]').length,
    text: document.querySelector('[data-testid="match-screen"]').innerText.replace(/\s+/g, ' ').slice(0, 240),
    loaded: typeof window.matchScreen === 'function',
    rows: (window.MATCH && window.MATCH.rows) ? window.MATCH.rows.length : null,
    error: (window.MATCH && window.MATCH.error) || null,
  }));
  console.log('  chips: ' + out.chips.join(' · '));
  console.log('  orders in the API answer: ' + out.rows + (out.error ? ' · ERROR ' + out.error : '') + ' · cards drawn: ' + out.orders);
  console.log('  screen says: ' + out.text);
  console.log((out.loaded && out.rows !== null && !out.error ? '  ok   ' : '  FAIL ') + 'the capability loaded and the API answered');
  if (out.text.indexOf('undefined') >= 0 || out.text.indexOf('NaN') >= 0) console.log('  FAIL  a hole rendered onto the screen');

  console.log(threw.length ? 'THREW: ' + threw.join(' | ') : 'no errors on the page');
  await b.close();
  process.exit(threw.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
