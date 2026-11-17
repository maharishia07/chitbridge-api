'use strict';
// @type: accessibility
// PROOF PACK a11y: axe-core (serious + critical) on the 19 customer pages (proof/pages.json) at --widths, after opening every tab/summary/expander. MEASURE ONLY:
// every write to the app is aborted and counted (proof/guard.cjs). From the Wave 1b SIT driver (Athi 11 Nov), now parameterised by base URL and run on GitHub (proof.yml).
//   node e2e/proof/a11y.cjs [--base http://localhost:5173] [--api http://localhost:3000] [--widths 1366,390] [--only crm,till] [--out out/proof/a11y.json]
const fs = require('fs');
const L = require('./lib.cjs'); const { BASE, PAGES, VPS, sleep } = L;
const OUT = L.arg('out', 'a11y-pages.json'), ONLY = L.arg('only', ''), SHOTS = L.arg('shots', '');
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const FORBID = /sign\s?-?out|log\s?-?out|switch\s+(shop|account|business|user)|change\s+(shop|account)|delete\s+(my\s+)?account|end session/i;
const axeSrc = L.axeSource();
const AXE = async () => window.axe.run(document, { resultTypes: ['violations'], exclude: [['[data-dev-only]']] }).then((r) => ({ v: r.violations.map((x) => ({ id: x.id, impact: x.impact, nodes: x.nodes.map((n) => ({ t: (n.target || []).join(' ').slice(0, 140), h: String(n.html || '').slice(0, 170), d: (n.any && n.any[0] && n.any[0].data) ? JSON.stringify(n.any[0].data).slice(0, 200) : '' })) })) }));
const SEL = '[role=tab], .tab, summary, [aria-expanded=false]';
(async () => {
  const shop = await L.ownShop(); const sess = JSON.parse(shop.session);
  const browser = await L.playwright().chromium.launch({ args: ['--no-sandbox'] });
  const result = { generated: new Date().toISOString(), base: BASE, shop: shop.email, viewports: VPS.map((v) => v[0]), pages: [] };
  for (const [name, route] of PAGES.filter(([n]) => !ONLY || ONLY.split(',').includes(n))) {
    const row = { page: name, vp: {} };
    for (const [w, h] of VPS) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, locale: 'en-IN', serviceWorkers: 'block' });
      await ctx.addInitScript((s) => { try { localStorage.setItem('cb_sess', s); window.print = function () {}; } catch (_) {} }, shop.session);
      const counts = { writes: 0 }; await L.guardContext(ctx, counts);
      const page = await ctx.newPage(); page.on('dialog', (d) => d.dismiss().catch(() => {})); page.on('download', (d) => d.cancel().catch(() => {})); ctx.on('page', (p) => { if (p !== page) p.close().catch(() => {}); });
      const url = BASE + route.replace('{bridge}', encodeURIComponent(sess.bridgeId || '')); const m = { views: 0, rules: {}, err: null };
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 }); await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {}); await sleep(1500);
        await page.addScriptTag({ content: axeSrc });
        const merge = async (view) => { const r = await page.evaluate(AXE); for (const x of r.v) { const e = m.rules[x.id] || (m.rules[x.id] = { impact: x.impact, nodes: {}, views: {} }); for (const n of x.nodes) { if (!e.nodes[n.t]) e.nodes[n.t] = { h: n.h, d: n.d }; } e.views[view] = 1; } };
        if (SHOTS) await page.screenshot({ path: SHOTS + '/a11y-' + name + '-' + w + '.png' }).catch(() => {});
        await merge('load');
        const openers = await page.evaluate((sel) => { const out = []; document.querySelectorAll(sel).forEach((el, i) => { const r = el.getBoundingClientRect(); if (r.width > 0 && r.height > 0 && !el.closest('[data-dev-only]')) out.push({ i, label: String(el.innerText || el.getAttribute('aria-label') || el.id).replace(/\s+/g, ' ').trim().slice(0, 40) }); }); return out; }, SEL);
        for (const o of openers.slice(0, 30)) {
          if (FORBID.test(o.label)) continue;
          const ok = await page.evaluate(({ i, sel }) => { const el = document.querySelectorAll(sel)[i]; if (!el) return false; el.click(); return true; }, { i: o.i, sel: SEL }).catch(() => false);
          if (!ok) continue; await sleep(500); m.views++;
          await page.evaluate(() => { const d = [...document.querySelectorAll('[role=dialog], dialog[open], .modal')].filter((e) => e.getBoundingClientRect().width > 0).pop(); if (d) { const b = [...d.querySelectorAll('button')].find((x) => /^(close|cancel|×|✕|x|back)$/i.test((x.innerText || x.getAttribute('aria-label') || '').trim())); if (b) b.click(); } }).catch(() => {});
          if (page.url().split('#')[0].split('?')[0] !== url.split('#')[0].split('?')[0]) { await page.goto(url, { waitUntil: 'domcontentloaded' }).catch(() => {}); await sleep(1000); }
          if ((await page.evaluate(() => typeof window.axe).catch(() => 'undefined')) === 'undefined') await page.addScriptTag({ content: axeSrc }).catch(() => {});
          await merge('view:' + o.label).catch(() => {});
        }
      } catch (e) { m.err = String(e && e.message || e).slice(0, 200); }
      const sc = (imp) => Object.values(m.rules).filter((r) => r.impact === imp).reduce((a, r) => a + Object.keys(r.nodes).length, 0);
      m.s = sc('serious'); m.c = sc('critical'); m.mod = sc('moderate');
      m.writes = counts.writes; row.vp[w] = m; await ctx.close();
      console.log(name.padEnd(20), w, 's', m.s, 'c', m.c, 'mod', m.mod, 'views', m.views, m.err || '', Object.entries(m.rules).filter(([, r]) => /serious|critical/.test(r.impact)).map(([k, r]) => k + 'x' + Object.keys(r.nodes).length).join(','));
    }
    result.pages.push(row); fs.writeFileSync(OUT, JSON.stringify(result));
  }
  await browser.close(); console.log('A11Y DONE');
})().catch((e) => { console.error('FATAL ' + (e && e.stack || e)); process.exit(1); });
