#!/usr/bin/env node
/**
 * e2e/walk-connectors.cjs - CONNECTORS PER COUNTRY, WALKED (CX6 · K1, 2026-10-13): Settings › Integrations › Connectors for an IN, an AU and an AE shop.
 * Black box: the real app.html settings screen; the API is a stand-in answering inside the page with what api routes/integrations.js answers per
 * country (tests/integrations-country.test.cjs proves the server side): India may every connector; Australia and the UAE get Tally, GoFrugal and
 * Zoho greyed WITH the server's sentence, Till and CSV live. Nothing reaches a server; nothing is written.
 *   K1  IN -> every Download is live, no greyed sentence (India's answer unchanged)
 *   K2  AU -> Tally · GoFrugal · Zoho: Download greyed + the sentence naming Australia; Till · CSV live; pressing a greyed Download sends nothing
 *   K3  AE -> the same, naming the United Arab Emirates
 *   K4  AU at 1366 and 390 px, light and dark -> every greyed sentence AA-readable, not clipped, no sideways scroll
 *
 *   NODE_PATH=e2e/node_modules node e2e/walk-connectors.cjs
 */
'use strict';
const W = require('./lib/walk.cjs');
const { measure } = require('./lib/theme-measure.cjs');
const J = (o, status) => ({ status: status || 200, contentType: 'application/json', body: JSON.stringify(o) });
const NAMES = { AU: 'Australia', AE: 'United Arab Emirates' };
const WHY = {
  tally: (c) => 'The Tally connector is built on Tally\'s Indian GST books, so it is not offered for a ' + c + ' shop. Use the File connector (CSV) or the Counter.',
  gstin: (c) => 'This connector is built on India\'s GST (GSTIN, CGST/SGST/IGST), so it is not offered for a ' + c + ' shop yet. Use the File connector (CSV) or the Counter.',
};
const FITS = { tally: 'tally', gofrugal: 'gstin', zoho: 'gstin' };
function catalogue(country) {
  return { connectors: ['tally', 'gofrugal', 'zoho', 'till', 'csv'].map((id) => ({ id, name: id + ' connector', adapters: [id === 'till' || id === 'csv' ? 'csv' : id], default_adapter: id,
    runs_on: 'a shop PC', does: 'What the ' + id + ' connector does.', status: 'proven', steps: [], needs: [], watch_out: [], download: '/api/integrations/download/' + id, docs: '/api/integrations/docs/' + id,
    may: country !== 'IN' && FITS[id] ? { ok: false, why: WHY[FITS[id]](NAMES[country]) } : { ok: true, why: null } })) };
}

W.run('connectors', async (w) => {
  const { page, ctx, base } = w;
  let country = 'IN'; const downloads = [];
  await ctx.route('**/api/**', (r) => r.fulfill(J({})));   /* the catch-all FIRST — the last registered handler is tried first */
  await ctx.route('**/api/integrations/catalogue', (r) => r.fulfill(J(catalogue(country))));
  await ctx.route('**/api/integrations/status', (r) => r.fulfill(J({ connectors: [] })));
  await ctx.route('**/api/integrations/download/**', (r) => { downloads.push(r.request().url()); return r.fulfill(J({}, 409)); });
  await ctx.addInitScript((s) => { try { localStorage.setItem('cb_api_base', location.origin); localStorage.setItem('cb_sess', s); } catch (_) {} }, W.session('Fixture Owner', 'Fixture Shop'));

  const open = async () => {
    await page.goto(base + '/app.html'); await page.waitForFunction(() => typeof window.navTo === 'function', null, { timeout: 20000 });
    await page.evaluate(() => { navTo('settings'); });   /* Settings' code (cap-admin) loads on demand */
    await page.waitForFunction(() => typeof window.setSetSec === 'function', null, { timeout: 20000 }); await page.waitForTimeout(300);
    await page.evaluate(() => { setSetSec('integrations'); if (typeof intSetTab === 'function') intSetTab('connectors'); });
    await page.waitForSelector('[data-testid="int-connector-till"]', { timeout: 15000 }); await page.waitForTimeout(200);
  };
  const state = (id) => page.evaluate((i) => { const b = document.querySelector('[data-testid^="int-download-' + i + '-"]'); const why = document.querySelector('[data-testid="int-why-' + i + '"]');
    return { disabled: !!(b && b.disabled), why: why ? why.innerText.trim() : '' }; }, id);

  await w.step('K1', 'IN shop -> Settings › Integrations › Connectors: every Download is live, no greyed sentence', async () => {
    country = 'IN'; await open();
    const all = await Promise.all(['tally', 'gofrugal', 'zoho', 'till', 'csv'].map(state));
    return { ok: all.every((s) => !s.disabled && !s.why), saw: all.map((s, i) => ['tally', 'gofrugal', 'zoho', 'till', 'csv'][i] + ':' + (s.disabled ? 'greyed' : 'live')).join(' · ') };
  });
  for (const [id, c] of [['K2', 'AU'], ['K3', 'AE']]) {
    await w.step(id, c + ' shop -> Tally · GoFrugal · Zoho greyed with the sentence naming ' + NAMES[c] + '; Till · CSV live; a greyed Download sends nothing', async () => {
      country = c; await open(); downloads.length = 0;
      const t = await state('tally'), g = await state('gofrugal'), z = await state('zoho'), ti = await state('till'), cs = await state('csv');
      await page.click('[data-testid="int-download-tally-tally"]', { force: true, timeout: 2000 }).catch(() => {}); await page.waitForTimeout(200);
      const greyed = [t, g, z].every((s) => s.disabled && s.why.indexOf(NAMES[c]) >= 0);
      return { ok: greyed && !ti.disabled && !cs.disabled && !ti.why && downloads.length === 0, saw: 'tally "' + t.why.slice(0, 60) + '…" · till ' + (ti.disabled ? 'greyed' : 'live') + ' · csv ' + (cs.disabled ? 'greyed' : 'live') + ' · downloads sent ' + downloads.length };
    });
  }
  await w.step('K4', 'AU at 1366 and 390 px, light and dark -> every greyed sentence AA-readable, unclipped, no sideways scroll', async () => {
    country = 'AU'; const seen = [];
    for (const [wd, ht] of [[1366, 800], [390, 844]]) {
      await page.setViewportSize({ width: wd, height: ht }); await open();
      for (const th of ['cream', 'dark']) {
        await page.evaluate((k) => { if (window.CBAvatar) CBAvatar.applyTheme(k); }, th); await page.waitForTimeout(80);
        const boxes = await page.$$eval('[data-testid^="int-why-"]', (els) => els.map((e) => { const r = e.getBoundingClientRect(); return { clip: e.scrollWidth > e.clientWidth + 1, right: r.right, w: r.width }; }));
        const hscroll = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
        const bad = (await page.evaluate(measure)).filter((x) => x.ratio < x.need && /int-why-/.test(x.html));
        seen.push({ wd, th, ok: boxes.length === 3 && boxes.every((b) => !b.clip && b.right <= wd + 1 && b.w > 0) && !hscroll && !bad.length,
          why: boxes.length + ' sentences' + (hscroll ? ' h-scroll' : '') + (bad.length ? ' contrast ' + bad[0].ratio : '') });
      }
    }
    await page.setViewportSize({ width: 1366, height: 800 }); await page.evaluate(() => { if (window.CBAvatar) CBAvatar.applyTheme('cream'); });
    return { ok: seen.every((x) => x.ok), saw: seen.map((x) => x.wd + '/' + x.th + ':' + (x.ok ? 'ok' : 'FAIL ' + x.why)).join(' · ') };
  });
});
