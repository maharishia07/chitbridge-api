#!/usr/bin/env node
/**
 * e2e/walk-standards-icons.cjs - THE STANDARDS PAGE'S THREE ICONS ARE THE LIBRARY ICON (WEB-ICONS-2, 2026-11-13).
 * OWNS      the element test for standards.html's STD001-U01 (back to the matrix) and STD001-U02, STD001-U03 (the sheets' close: why, country readiness): library part, register mount, size, name, contrast, keys.
 * CALLED BY a person / the cloud walks (named walk-* so run-shard picks it up).  FLOW  the real page (it reads no api) -> open a sheet or the list page -> read the icon (lib/icon-measure.cjs).
 *   I1  each is drawn by ui.action: data-cbsid CMP005-B01 (close) or CMP006-B01 (back), its own mount, a button, no hand-written .back / .sh-x left
 *   I2  name (Close / Back to the matrix), a tooltip, a box of at least 44x44 at 1366 and 390
 *   I3  ink against its ground at least 4.5:1 in Cream and in Dark (CBAvatar.applyTheme)
 *   I4  keyboard: Tab reaches it, Enter closes the sheet / returns to the matrix, Space too on the back
 * It must FAIL on main: there the three are hand-written buttons with no component code and a 40 px box.
 *   NODE_PATH=<dir with playwright> node e2e/walk-standards-icons.cjs
 */
'use strict';
const fs = require('fs');
const path = require('path');
const W = require('./lib/walk.cjs');
const { readIcon } = require('./lib/icon-measure.cjs');

const ICONS = [
  { mount: 'STD001-U01', testid: 'std-back', sid: 'CMP006-B01', name: 'back', label: 'Back to the matrix' },
  { mount: 'STD001-U02', testid: 'std-sheet-x', sid: 'CMP005-B01', name: 'close', label: 'Close', sheet: 'why' },
  { mount: 'STD001-U03', testid: 'std-sheet-x', sid: 'CMP005-B01', name: 'close', label: 'Close', sheet: 'ready' }
];

W.run('standards-icons', async (w) => {
  const { page } = w;
  await page.route('**/api/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  /* put the icon on screen: a sheet by its address, or the list page of a phone (a cell opens page two, where the back shows) */
  const show = async (ic, vp) => {
    await page.setViewportSize(vp);
    await page.goto(w.base + '/standards.html' + (ic.sheet === 'ready' ? '?ready=IN' : ic.sheet ? '?sheet=' + ic.sheet : ''));
    if (ic.sheet) { await page.waitForSelector('dialog[open] [data-testid="' + ic.testid + '"]', { timeout: 10000 }); return; }
    await page.waitForSelector('[data-testid^="std-cell-"]', { timeout: 10000 });
    await page.locator('[data-testid^="std-cell-"]').first().click();
    await page.waitForSelector('[data-testid="std-back"]', { state: 'visible', timeout: 5000 });
  };
  const facts = [];
  for (const [vp, tag] of [[{ width: 1366, height: 768 }, '1366'], [{ width: 390, height: 844 }, '390']]) {
    for (const ic of ICONS) {
      if (!ic.sheet && tag === '1366') continue; /* the back shows on a phone's list page only (page.html .who back) */
      await show(ic, vp);
      for (const theme of ['cream', 'dark']) {
        await page.evaluate((t) => CBAvatar.applyTheme(t), theme);
        const f = await page.evaluate(readIcon, ic.testid);
        facts.push({ key: ic.mount + '@' + tag + '/' + theme, want: ic, f });
      }
    }
  }
  await w.step('I1', 'each is the library part: component element code, its own mount, a button, no inline onclick, no .back / .sh-x left', async () => {
    const bad = facts.filter((x) => !x.f || x.f.sid !== x.want.sid || x.f.name !== x.want.name || x.f.mount !== x.want.mount || x.f.tag !== 'BUTTON' || x.f.onclick);
    const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'standards.html'), 'utf8');
    const left = /class="(?:back|sh-x)"/.test(src);
    return { ok: !bad.length && !left, saw: facts.length + ' reads · bad ' + bad.map((b) => b.key).join(',') + ' · hand-written left ' + left };
  });
  await w.step('I2', 'name and tooltip say what it does, and the box is at least 44 x 44', async () => {
    const bad = facts.filter((x) => !x.f || x.f.label !== x.want.label || !x.f.title || x.f.w < 44 || x.f.h < 44);
    return { ok: !bad.length, saw: 'bad ' + bad.map((b) => b.key + ':' + (b.f && b.f.w + 'x' + b.f.h)).join(',') };
  });
  await w.step('I3', 'ink against its ground at least 4.5:1 in Cream and in Dark', async () => {
    const bad = facts.filter((x) => !x.f || x.f.ratio < 4.5);
    return { ok: !bad.length, saw: 'lowest ' + Math.min(...facts.map((x) => x.f.ratio)) + ' · bad ' + bad.map((b) => b.key + ':' + b.f.ratio).join(',') };
  });
  await w.step('I4', 'keyboard: Tab reaches each, Enter (and Space on the back) does its one job', async () => {
    const out = [];
    for (const ic of ICONS) {
      await show(ic, { width: 390, height: 844 });
      let reached = false;
      for (let i = 0; i < 60 && !reached; i++) {
        await page.keyboard.press('Tab');
        reached = await page.evaluate((t) => !!document.activeElement && document.activeElement.getAttribute('data-testid') === t, ic.testid);
      }
      await page.keyboard.press(ic.sheet ? 'Enter' : 'Space');
      await page.waitForTimeout(350);
      const done = ic.sheet ? (await page.locator('dialog[open]').count()) === 0 : await page.locator('#mxp').isVisible();
      out.push(ic.mount + ' reached ' + reached + ' did its job ' + done);
      if (!(reached && done)) return { ok: false, saw: out.join(' · ') };
    }
    return { ok: true, saw: out.join(' · ') };
  });
});
