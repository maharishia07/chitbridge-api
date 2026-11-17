#!/usr/bin/env node
/**
 * e2e/walk-connector-cockpit.cjs - THE CONNECTOR COCKPIT, WALKED (CON-161, 2026-11-13): public/app/cap-connector.js (the IoT / ERP device cockpit).
 * Black box: the real app.html, the cockpit capability loaded on demand (ensureCap('connector')), painted by the app's own piCockpit into the
 * detail pane; the API is a stand-in answering inside the page. Nothing reaches a server; nothing is written.
 *   C1  devices load -> each connection's ref is listed, and the agent installer the cockpit builds is valid JS whose HTTP error reads as words
 *       (the source of that error text once printed itself: " "+j.code - CON-161; e2e/tx-leak.cjs holds the scan, this holds the behaviour)
 *   C2  the devices call fails twice -> the person reads the api's sentence and a Retry button, not an empty list
 *   C3  1366 and 390 px, cream and dark -> the cockpit is AA-readable (contrast), unclipped, no sideways scroll
 *   C4  the pseudo-locale (qps) -> the cockpit's catalogue labels come back pseudo-localised (the string layer reaches the screen)
 *
 *   NODE_PATH=e2e/node_modules node e2e/walk-connector-cockpit.cjs
 */
'use strict';
const W = require('./lib/walk.cjs');
const { measure } = require('./lib/theme-measure.cjs');
const J = (o, status) => ({ status: status || 200, contentType: 'application/json', body: JSON.stringify(o) });
const ACTOR = { id: 'act-walk-pi', name: 'Walk Pi gateway', type: 'iot' };
const CONNS = [{ ref: 'Cold room scale', bridge_id: 'CBWALKDEV01', enabled: true, conn_config: { topic: 'cold/scale' } }, { ref: 'Gate camera', bridge_id: 'CBWALKDEV02', enabled: true, conn_config: { folder: '/in/gate' } }];

W.run('connector-cockpit', async (w) => {
  const { page, ctx, base } = w;
  let connsAnswer = () => J(CONNS), lang = null;
  await ctx.route('**/api/**', (r) => r.fulfill(J({})));   /* the catch-all FIRST - the last registered handler is tried first */
  await ctx.route(/\/api\/entities\/me(\?|$)/, (r) => r.fulfill(J({ entity: { display_name: 'Fixture Shop', currency_code: 'INR', country: 'IN', locale_prefs: lang ? { lang, langs: lang } : {} } })));
  await ctx.route('**/api/connectors/**/connections', (r) => r.fulfill(connsAnswer()));
  await ctx.addInitScript((s) => { try { localStorage.setItem('cb_api_base', location.origin); localStorage.setItem('cb_sess', s); } catch (_) {} }, W.session('Fixture Owner', 'Fixture Shop'));

  const open = async () => {
    await page.goto(base + '/app.html'); await page.waitForFunction(() => typeof window.navTo === 'function', null, { timeout: 20000 });
    await page.evaluate(async (actor) => {
      await ensureCap('workforce'); await ensureCap('connector');
      const old = document.getElementById('detailpane'); if (old) old.remove(); const pane = document.createElement('div'); pane.id = 'detailpane'; pane.style.cssText = 'position:fixed;inset:0;overflow:auto;z-index:99999;background:var(--card);padding:12px';
      document.body.appendChild(pane);
      UI.acts = [actor]; UI._connMap = { [actor.id]: 'iot' }; UI.acSel = actor.id; UI.acDet = actor; UI.acMode = 'view'; UI.acManageOpen = true; UI.acManageLoading = false;
      await acLoadDevices(actor.id);
    }, ACTOR);
    await page.waitForTimeout(700);   /* the boot paints its own screen into the pane; paint the cockpit again once it is quiet */
    await page.evaluate(() => { paintAcDetail(); });
  };
  const paneText = () => page.evaluate(() => (document.getElementById('detailpane') || {}).innerText || '');

  await w.step('C1', 'devices load -> both connections are listed; the generated agent is valid JS and its HTTP error reads as words', async () => {
    connsAnswer = () => J(CONNS); await open();
    const text = await paneText();
    const agent = await page.evaluate(() => { const src = _agentJs().replace(/^#![^\n]*\n/, ''); try { new Function(src); } catch (e) { return { syntax: String(e.message) }; } return { syntax: null, joined: src.indexOf('.filter(Boolean).join(') >= 0, stranded: /"\s*\+\s*j\.code|"\s*\+\s*String\(j\.message/.test(src) }; });
    return { ok: text.indexOf('Cold room scale') >= 0 && text.indexOf('Gate camera') >= 0 && !agent.syntax && agent.joined && !agent.stranded, saw: 'listed ' + CONNS.filter((c) => text.indexOf(c.ref) >= 0).length + ' of 2 · agent syntax ' + (agent.syntax || 'ok') + ' · error joined ' + agent.joined };
  });

  await w.step('C2', 'devices call fails -> the api\'s sentence and a Retry button on screen, not an empty list', async () => {
    connsAnswer = () => J({ message: 'The gateway register is unavailable right now.' }, 503); await open();
    const text = await paneText();
    return { ok: /unavailable right now|Could not load/i.test(text) && /Retry/.test(text) && text.indexOf("' + ") < 0, saw: JSON.stringify(text.slice(0, 160)) };
  });

  await w.step('C3', '1366 and 390 px, cream and dark -> cockpit AA-readable (contrast), unclipped, no sideways scroll', async () => {
    connsAnswer = () => J(CONNS); const seen = [];
    for (const [wd, ht] of [[1366, 800], [390, 844]]) {
      await page.setViewportSize({ width: wd, height: ht }); await open();
      for (const th of ['cream', 'dark']) {
        await page.evaluate((k) => { if (window.CBAvatar) CBAvatar.applyTheme(k); }, th); await page.waitForTimeout(80);
        const hscroll = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
        const rows = await page.evaluate(() => document.getElementById('detailpane').querySelectorAll('b').length);
        const bad = (await page.evaluate(measure)).filter((x) => x.ratio < x.need && /detailpane|Cold room|Gate camera|Retry|Co-assists/.test(x.html));
        seen.push({ wd, th, ok: rows >= 2 && !hscroll && !bad.length, why: rows + ' rows' + (hscroll ? ' h-scroll' : '') + (bad.length ? ' contrast ' + bad[0].ratio : '') });
      }
    }
    await page.setViewportSize({ width: 1366, height: 800 }); await page.evaluate(() => { if (window.CBAvatar) CBAvatar.applyTheme('cream'); });
    return { ok: seen.every((x) => x.ok), saw: seen.map((x) => x.wd + '/' + x.th + ':' + (x.ok ? 'ok' : 'FAIL ' + x.why)).join(' · ') };
  });

  await w.step('C4', 'pseudo-locale qps -> the cockpit\'s catalogue labels come back pseudo-localised', async () => {
    connsAnswer = () => J(CONNS);
    lang = 'qps'; await ctx.addInitScript(() => { try { localStorage.setItem('cb_lang', 'qps'); localStorage.setItem('cb_langs', 'qps'); localStorage.setItem('cb_locale', 'en-IN'); localStorage.setItem('cb_region', 'IN'); } catch (_) {} });
    await open(); await page.waitForFunction(() => window.CBSTR && window.CBSTR.qps, null, { timeout: 5000 }).catch(() => {});
    await page.evaluate((a) => { paintAcDetail(); }, ACTOR);
    const text = await paneText();
    const probe = await page.evaluate(() => [!!(window.CBSTR && window.CBSTR.qps), tx('Retry'), localStorage.getItem('cb_lang')]);
    return { ok: /\[!!/.test(text), saw: probe.join(' / ') + ' · ' + JSON.stringify(text.slice(0, 120)) };
  });
});
