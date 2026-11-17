/**
 * schemes-shot.cjs — read the Classification schemes block back off the screen after Athi's four changes.
 *
 * *"HS and HS-Harmonized system, do we need two HS?"* · *"bring the explanation below the HS-"* ·
 * *"is this message necessary: or can we simplify?"* · *"read from app/catalogue-model.js · STD_SCHEMES,
 * is it necessary?"*
 *
 * ⚠️⚠️ THE SCREEN IS CATEGORIES, NOT the registry showcase. `cbDefHTML()` / `definitionsScreen()` in
 * cap-definitions.js has NO CALLER AT ALL — the `definitions` nav key redirects to catsetup and nothing else
 * reaches it — so the block Athi was looking at is the Classification schemes list on the CATEGORIES screen,
 * a second READER of the same registry. I edited the dead one first and it changed nothing he would ever see;
 * only opening the page said so.
 *
 * ⚠️ It reads innerText, not the diff: a name rendered as two elements looks right in source and can still print
 * the scheme twice.
 *
 * Run: node e2e/schemes-shot.cjs
 */
'use strict';
const { chromium } = require('@playwright/test');
const path = require('path');

const BASE = process.env.CB_WEB_BASE || 'http://localhost:5173';
const STATE = path.join(__dirname, '.auth', 'user.json');
const flat = (s) => String(s || '').replace(/[ \t\n\r]+/g, ' ').trim();

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ storageState: STATE, viewport: { width: 1280, height: 1000 } });
  const page = await ctx.newPage();
  const say = (s) => console.log('  ' + s);

  await page.goto(BASE + '/app.html');
  await page.waitForTimeout(4000);
  await page.evaluate(() => navTo('categories'));
  await page.waitForTimeout(3000);

  const out = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('.cbcat-prow'));
    const note = document.querySelector('.cbcat-note');
    const src = Array.from(document.querySelectorAll('div'))
      .find((d) => /^read from/.test((d.innerText || '').trim()));
    return {
      found: rows.length > 0,
      blurb: (note || {}).innerText || '',
      src: src ? src.innerText : '',
      rows: rows.slice(0, 4).map((r) => ({
        /* The name line is the first child; the explanation is its own block underneath. */
        name: (r.firstElementChild || {}).innerText || '',
        note: (r.querySelector('.cbcat-also') || {}).innerText || '',
      })),
    };
  });

  if (!out.found) { say('the Classification schemes block was not on screen'); await browser.close(); return; }

  say('blurb:  ' + flat(out.blurb));
  say('source: ' + (flat(out.src) || '(absent - spec mode off, as intended)'));
  let twice = 0;
  out.rows.forEach((r) => {
    const n = flat(r.name);
    const code = n.split(' ')[0];
    /* The whole question: does the code appear a second time inside the words beside it? */
    const repeats = !!code && n.slice(code.length).indexOf(code) >= 0;
    if (repeats) twice++;
    say((repeats ? '  x ' : '  + ') + 'name="' + n + '"');
    say('      note="' + flat(r.note).slice(0, 64) + '..."');
  });
  say(twice ? '  ! ' + twice + ' row(s) still print the code twice' : '  + every scheme names itself once');

  await page.screenshot({ path: path.join(__dirname, 'schemes.png') });
  say('  shot: e2e/schemes.png');
  await browser.close();
})();
