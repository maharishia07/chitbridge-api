/* Athi, 2026-09-08: "the search works, but the first item gets picked up — how do I scroll down with the down key?"
   This drives the real counter and reports what the arrow keys actually do. */
'use strict';
const { chromium } = require('@playwright/test');
const KEY = process.env.TILL_KEY;
const WEB = process.env.CB_WEB_BASE || 'https://chitbridge-web.vercel.app';
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ baseURL: WEB });
  p.on('pageerror', (e) => console.log('  threw: ' + e.message));
  await p.goto('/till.html#key=' + encodeURIComponent(KEY));
  await p.waitForFunction(() => window.CBOffers && window.CBTax, null, { timeout: 30000 });
  await p.evaluate(() => refresh());
  await p.waitForSelector('[data-testid="till-hit-0"]', { timeout: 30000 });

  await p.fill('#q', 'rice');
  await p.waitForTimeout(400);
  const first = await p.evaluate(() => ({ sel: SEL, names: Array.from(document.querySelectorAll('.hit .n')).slice(0, 4).map((e) => e.childNodes[0].textContent.trim()) }));
  console.log('after typing "oil" · SEL=' + first.sel);
  first.names.forEach((n, i) => console.log('   ' + i + ' ' + n));

  for (const k of ['ArrowDown', 'ArrowDown']) await p.press('#q', k);
  const moved = await p.evaluate(() => ({
    sel: SEL,
    marked: (document.querySelector('.hit.sel .n') || {}).textContent,
    markedIndex: Array.from(document.querySelectorAll('.hit')).findIndex((e) => e.classList.contains('sel')),
    listTop: document.getElementById('hits').scrollTop,
  }));
  console.log('after ↓ ↓ · SEL=' + moved.sel + ' · marked row #' + moved.markedIndex + ' · list scrolled to ' + moved.listTop);

  await p.press('#q', 'Enter');
  await p.waitForTimeout(400);
  const added = await p.evaluate(() => (CART[0] || {}).name);
  console.log('Enter added   : ' + added);

  /* and far down the list, where the fold matters */
  await p.fill('#q', 'rice'); await p.waitForTimeout(300);
  for (let i = 0; i < 12; i++) await p.press('#q', 'ArrowDown');
  const far = await p.evaluate(() => {
    const el = document.querySelector('.hit.sel');
    const box = document.getElementById('hits').getBoundingClientRect();
    const r = el ? el.getBoundingClientRect() : null;
    return { sel: SEL, visible: !!r && r.top >= box.top - 1 && r.bottom <= box.bottom + 1, top: r && Math.round(r.top), boxTop: Math.round(box.top), boxBottom: Math.round(box.bottom) };
  });
  console.log('after 12 × ↓  · SEL=' + far.sel + ' · the marked row is ' + (far.visible ? 'ON screen' : 'OFF screen (' + far.top + ' vs ' + far.boxTop + '–' + far.boxBottom + ')'));
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
