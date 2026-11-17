#!/usr/bin/env node
/**
 * e2e/walk-kyb-address.cjs - A TAB HAS AN ADDRESS (UX-102): Know your business keeps its four tabs in the # so Back, Forward and a shared link land on the tab.
 *   A1  /know-your-business.html#risk opens on Risk (not Yourself)
 *   A2  tapping Field writes #field and lights Field
 *   A3  Back returns to Risk; an address that names no tab opens Yourself
 * A fixture shop: the site is served from this checkout, the API answers 404 (the tabs draw before any answer; nothing leaves this machine).
 */
'use strict';
const W = require('./lib/walk.cjs');

const walk = async (w) => {
  const { page, ctx, base } = w;
  await ctx.route('**/api/**', (r) => r.fulfill({ status: 404, contentType: 'application/json', body: '{"error":{"message":"not in this stand-in"}}' }));
  await ctx.addInitScript((s) => { try { localStorage.setItem('cb_api_base', location.origin); localStorage.setItem('cb_sess', s); } catch (_) { /* a private window: the walk then fails on the sign-in card */ } }, W.session('Fixture Owner', 'Fixture Shop'));
  const lit = () => page.evaluate(() => (document.querySelector('.tab.on') || {}).textContent || '');
  await w.step('A1', '#risk opens on the Risk tab', async () => {
    await page.goto(base + '/know-your-business.html#risk'); await page.waitForSelector('.tab', { timeout: 20000 });
    const on = await lit(); return { ok: on === 'Risk', saw: 'lit tab "' + on + '"' };
  });
  await w.step('A2', 'tapping Field writes #field and lights Field', async () => {
    await page.click('.tab:has-text("Field")'); await page.waitForTimeout(300);
    const on = await lit(), hash = await page.evaluate(() => location.hash); return { ok: on === 'Field' && hash === '#field', saw: 'lit "' + on + '" · address ' + hash };
  });
  await w.step('A3', 'Back returns to Risk; no tab in the address opens Yourself', async () => {
    await page.goBack(); await page.waitForTimeout(400); const back = await lit();
    await page.goto(base + '/know-your-business.html'); await page.waitForSelector('.tab', { timeout: 20000 }); const none = await lit();
    return { ok: back === 'Risk' && none === 'Yourself', saw: 'after Back "' + back + '" · bare address "' + none + '"' };
  });
};
walk.opts = { viewport: { width: 1366, height: 900 } };
W.run('kyb-address', walk);
