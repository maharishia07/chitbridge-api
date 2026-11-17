#!/usr/bin/env node
/**
 * e2e/walk-chart-sample.cjs — REP-36: the shared chart helper in all 16 themes (public/chart-sample.html + app/chart-sample.js + engine/chart-draw.js), in a real browser.
 * Proves: 16 panels; every svg is role="img" with a <title> and a <desc>; the contrast MEASURED in the page (ui-standard's contrastRatio on the real computed colours)
 * is previous >= 3 and actual >= 4.5 on every theme; at 390 px nothing scrolls sideways and every chart fits the phone. The page reads nothing from an api.
 * Shots: full-page at 1366 and 390 (CB_SHOT_DIR, default the walk's own shots folder).
 *   node e2e/walk-chart-sample.cjs          headless
 */
'use strict';
const path = require('path');
const W = require('./lib/walk.cjs');
const SHOT_DIR = process.env.CB_SHOT_DIR || path.join(__dirname, 'shots');

W.run('chart-sample', async (w) => {
  const { page, ctx, base } = w;
  const asked = [];
  await ctx.route('**/api/**', (route) => { asked.push(route.request().url()); return route.fulfill({ status: 404, body: '{}' }); });
  const open = async (width) => {
    await page.setViewportSize({ width, height: width > 600 ? 900 : 844 });
    await page.goto('about:blank');
    await page.goto(base + '/chart-sample.html');
    await page.waitForSelector('[data-testid="cs-panel-terminal"] [data-testid="cs-status-terminal"]');
  };

  await open(1366);
  await w.step('S1', 'chart sample at 1366: 16 themes, each with the five kinds, each svg named and described', async () => {
    const r = await page.evaluate(() => ({
      panels: document.querySelectorAll('[data-testid^="cs-panel-"]').length,
      svgs: [...document.querySelectorAll('.panel svg')].length,
      unnamed: [...document.querySelectorAll('.panel svg')].filter((s) => !s.getAttribute('role') && !s.getAttribute('aria-label')).length,
      noDesc: [...document.querySelectorAll('[data-testid^="cs-status-"],[data-testid^="cs-strip-"]')].filter((s) => !(s.querySelector('title') && s.querySelector('desc') && s.querySelector('desc').textContent.length > 10)).length,
      summary: document.getElementById('summary').textContent
    }));
    await page.screenshot({ path: path.join(SHOT_DIR, 'rep36-chart-sample-1366.png'), fullPage: true });
    return { ok: r.panels === 16 && r.svgs === 16 * 5 && r.unnamed === 0 && r.noDesc === 0, saw: r.panels + ' panels, ' + r.svgs + ' svgs, ' + r.unnamed + ' unnamed, ' + r.noDesc + ' without a desc; ' + r.summary };
  });
  await w.step('S2', 'contrast measured in the browser: previous >= 3:1 and actual >= 4.5:1 in all 16 themes', async () => {
    const rows = await page.evaluate(() => window.CB_CHART_SAMPLE);
    const bad = rows.filter((x) => x.previous < 3 || x.actual < 4.5 || x.accent < 3);
    const raised = rows.filter((x) => x.previousMix > 55).map((x) => x.key + '@' + x.previousMix);
    console.log(rows.map((x) => x.key + ' prev ' + x.previous.toFixed(2) + ' (' + x.previousMix + '%) actual ' + x.actual.toFixed(1) + ' accent ' + x.accent.toFixed(1) + ' fell:' + (x.fellBack.join(',') || '-')).join('\n'));
    return { ok: rows.length === 16 && bad.length === 0, saw: rows.length + ' themes, ' + bad.length + ' below the line; mix raised: ' + (raised.join(' ') || 'none') };
  });
  await open(390);
  await w.step('S3', 'at 390: no sideways scroll, every chart inside the phone width', async () => {
    const r = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      over: [...document.querySelectorAll('.panel svg')].filter((s) => s.getBoundingClientRect().right > 390.5).length
    }));
    await page.screenshot({ path: path.join(SHOT_DIR, 'rep36-chart-sample-390.png'), fullPage: true });
    return { ok: r.scroll <= 390 && r.over === 0, saw: 'scrollWidth ' + r.scroll + ', ' + r.over + ' svgs past 390' };
  });
  await w.step('S4', 'the page reads nothing from an api', async () => ({ ok: asked.length === 0, saw: asked.length + ' api requests' }));
});
