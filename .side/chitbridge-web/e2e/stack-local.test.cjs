#!/usr/bin/env node
/**
 * e2e/stack-local.test.cjs — A PAGE ON THE LOCAL STACK NEVER REACHES THE PRODUCTION HOST (round FX-QA1, QA-W1 finding 1).
 *
 * The site e2e/lib/stack-local.cjs serves (its web server, in-process here, on a free port) is opened in a browser through the walk harness
 * (lib/walk.cjs with opts.base — the local walk that refuses production). No api runs: a request to the local api simply fails, which is fine —
 * the test is about WHERE the pages ask, not what they hear.
 *   L1  /config.js on the local stack names the local api, never the production host, and pins cb_api_base / cb_till_api
 *   L2  Tasks · Settings · Employees · the counter's shop screen (promo) — signed in — ask the local api, and nothing goes to the production host
 *   L3  the harness refuses a request to the production host and names it (the control: a page that asks anyway is caught)
 *
 *   NODE_PATH=$PWD/e2e/node_modules node e2e/stack-local.test.cjs
 */
'use strict';
const net = require('net');
const W = require('./lib/walk.cjs');
const S = require('./lib/stack-local.cjs');

const freePort = () => new Promise((res) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });

(async () => {
  const PROD = S.productionHost();
  const apiPort = await freePort(), LOCAL = 'http://localhost:' + apiPort;
  const srv = await S.serveWeb(0, apiPort);
  const base = 'http://localhost:' + srv.address().port;
  let w, code = 1;
  try {
    w = await W.start('stack-local', { base });
    const { page, ctx } = w;
    const hosts = [];
    ctx.on('request', (q) => { try { hosts.push(new URL(q.url()).host); } catch (_) {} });
    await ctx.addInitScript((s) => { try { localStorage.setItem('cb_sess', s); } catch (_) {} }, W.session('Fixture Owner', 'Fixture Shop'));

    await w.step('L1', '/config.js on the local stack -> the local api, no production host, both overrides pinned', async () => {
      const t = await (await fetch(base + '/config.js')).text();
      const ok = !!PROD && t.indexOf(PROD) < 0 && t.indexOf("window.CB_API = '" + LOCAL + "'") >= 0 && /cb_api_base/.test(t) && /cb_till_api/.test(t);
      return { ok, saw: (PROD ? 'production host ' + PROD + (t.indexOf(PROD) < 0 ? ' absent' : ' PRESENT') : 'no production host read') + ' · ' + (t.match(/window\.CB_API = [^;]+/) || ['no CB_API'])[0] };
    });

    await w.step('L2', 'Tasks · Settings · Employees · promo, signed in -> they ask the local api; nothing reaches the production host', async () => {
      const seen = [];
      for (const p of ['/tasks.html', '/settings.html#/shop', '/employees.html', '/promo.html']) {
        hosts.length = 0;
        await page.goto(base + p); await page.waitForTimeout(1800);
        const asked = await page.evaluate(() => ({ cb: window.CB_API, base: localStorage.getItem('cb_api_base'), till: localStorage.getItem('cb_till_api'), cfg: (typeof CFG !== 'undefined' && CFG && CFG.API_BASE) || null }));
        seen.push(p + ' ' + [...new Set(hosts)].filter((h) => !/^localhost:\d+$|^127\.0\.0\.1:\d+$/.test(h) || h === 'localhost:' + apiPort).join(',') + (asked.cfg ? ' cfg=' + asked.cfg : ''));
        if (asked.cb !== LOCAL || asked.base !== LOCAL || asked.till !== LOCAL || (asked.cfg && asked.cfg !== LOCAL)) return { ok: false, saw: p + ' reads ' + JSON.stringify(asked) };
      }
      return { ok: w.refused.length === 0,   /* the harness's refusal list is the proof across all four pages */ saw: seen.join(' · ') + ' · refused ' + w.refused.length };
    });

    await w.step('L3', 'A page that asks the production host anyway -> the harness refuses it and names the URL', async () => {
      const before = w.refused.length;
      const r = await page.evaluate((u) => fetch(u).then(() => 'answered', (e) => 'blocked: ' + e.message), 'https://' + PROD + '/health');
      const caught = w.refused.length - before;
      w.refused.splice(before);   /* the control's own request: caught as it should be, not a finding of this test */
      return { ok: caught === 1 && /^blocked/.test(r), saw: r + ' · refused ' + caught };
    });
    code = (await w.finish()) ? 1 : 0;
  } catch (e) { console.log('stack-local test stopped: ' + (e && e.stack || e)); code = 1; }
  finally { if (w) await w.close(); srv.close(); process.exit(code); }
})();
