'use strict';
/* box-practice-pictures.cjs - REP-66 walk, run ON a SIT box inside the Playwright image (see the run line in the PR): the practice pictures against the seeded api.
 * Read-only: signs in aud1 and acct1 (OTP from the environment, never in a file), reads, opens bands and rows. Proves, per seat at 1366 and 390: the picture segments equal the API tile counts,
 * text equivalent, the list is pushed down by 0, no sideways scroll, the first list row in the first screen, the opened row's strip equals year_end.locked, and the picture's contrast in all 16 themes.
 * Env: CODE (the tester code), BASE (the throwaway web, default http://localhost:3997), API (default http://127.0.0.1:3991), OUT (default /out). */
const fs = require('fs'); const http = require('http'); const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:3997', API = process.env.API || 'http://127.0.0.1:3991', OUT = process.env.OUT || '/out', CODE = process.env.CODE;
const ORIGIN = process.env.ORIGIN || 'http://localhost:3992'; /* the origin the seede api allows: this throwaway web is another port of the same site */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (m) => { console.log(m); fs.appendFileSync(OUT + '/walk66b.log', m + '\n'); };
const cut = (b, n) => JSON.stringify(b === undefined ? null : b).slice(0, n || 400);
let calls = 0, rem = null, r429 = 0, fails = 0;
const ok = (name, cond, saw) => { if (!cond) fails++; log((cond ? 'PASS ' : 'FAIL ') + name + ' :: ' + saw); };
function call(method, path, body, tok) {
  return new Promise((res, rej) => {
    const d = body ? JSON.stringify(body) : null;
    const q = http.request(API + path, { method, headers: Object.assign({ 'content-type': 'application/json' }, tok ? { authorization: 'Bearer ' + tok } : {}, d ? { 'content-length': Buffer.byteLength(d) } : {}) }, (r) => { let b = ''; r.on('data', (c) => (b += c)); r.on('end', () => { try { res(JSON.parse(b)); } catch (e) { res({ raw: b.slice(0, 200) }); } }); });
    q.on('error', rej); if (d) q.write(d); q.end();
  });
}
async function ctxOf(browser, vp, sess) {
  const ctx = await browser.newContext({ viewport: vp, locale: 'en-AU', timezoneId: 'Australia/Sydney', serviceWorkers: 'block', isMobile: vp.width < 500, hasTouch: vp.width < 500 });
  await ctx.addInitScript((s) => { try { if (!localStorage.getItem('cb_seeded')) { localStorage.setItem('cb_seeded', '1'); localStorage.setItem('cb_sess', JSON.stringify(s)); } } catch (_) {} }, sess);
  await ctx.route('http://localhost:3000/**', async (r) => {
    const u = new URL(r.request().url());
    if (u.pathname.includes('/events/stream')) return r.abort();
    try { const got = await r.fetch({ url: API + u.pathname + u.search, headers: Object.assign({}, r.request().headers(), { origin: ORIGIN, referer: ORIGIN + '/' }) }); /* the api answers the origin it allows; the page is on another port, so say its own origin back */ return r.fulfill({ response: got, headers: Object.assign({}, got.headers(), { 'access-control-allow-origin': r.request().headers().origin || BASE }) }); } catch (e) { return r.abort(); }
  });
  const page = await ctx.newPage(); page.__bad = []; page.__fail = [];
  page.on('pageerror', (e) => page.__bad.push('THROW ' + e.message.slice(0, 160)));
  page.on('response', (r) => { if (r.url().indexOf('/api/') >= 0) { calls++; const h = r.headers(); if (h['ratelimit-remaining'] !== undefined) rem = h['ratelimit-remaining']; if (r.status() === 429) r429++; if (r.status() >= 400) page.__fail.push(r.status() + ' ' + r.url().slice(-60)); } });
  return { ctx, page };
}
async function signIn(u) {
  const R = await call('POST', '/api/actors/login', { username: u, otp: CODE });
  if (!R.token) throw new Error('login ' + u + ' ' + cut(R, 200));
  const data = await call('GET', '/api/books-grants/practice', null, R.token);
  return { sess: { token: R.token, role: R.role || 'actor', name: R.name || u, entity: R.entity, bridgeId: R.bridgeId, duty: R.duty }, data };
}
/* REP-66b walk: sales year on year, ON a SIT box inside the Playwright image against the seede api. Read only. Per seat (aud1, acct1) at 1366x768 and 390x844: chart 1 in the Advice band
 * (printed figures = the api's sales_yoy_pct, rank order, only state ok, caption count, list pushed down by 0, no sideways scroll), chart 2 in an opened row (printed money = the api's figures through CBLocale),
 * shots in a light and a dark theme, the 16-theme contrast of the new shapes, the practice read count unchanged (one /books-grants/practice call per page load).
 * Env: CODE, BASE, API, OUT, ORIGIN as box-practice-pictures.cjs; SHOTS (default OUT). */
const themeCmp = (page, data) => page.evaluate((data) => {
  const lum = (c) => { const m = c.match(/[\d.]+/g).map(Number); const rgb = /^color\(/.test(c) ? m.slice(0, 3) : m.slice(0, 3).map((x) => x / 255); const f = (v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)); return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]); };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const themes = CBScreen.APP_THEMES, sec = document.getElementById('bp_practice'), out = [];
  Object.keys(themes).forEach((key) => {
    const vars = themes[key].vars || {}; sec.setAttribute('style', Object.keys(vars).length ? Object.keys(vars).map((n) => n + ':' + vars[n]).join(';') + ';--page:var(--paper);background:var(--paper);color:var(--ink)' : 'background:var(--paper,#FCFAF5);color:var(--ink)');
    const cell = sec.querySelector('[data-testid="practice-cmp"]'); if (cell) cell.outerHTML = CBPractice.parts.compareHTML(data);
    const probe = document.createElement('div'); probe.style.cssText = 'background:var(--card)'; sec.appendChild(probe);
    const page = getComputedStyle(sec).backgroundColor, card = getComputedStyle(probe).backgroundColor; sec.removeChild(probe);
    const w = { shapes: 99, text: 99 }, g = { n: 0 };
    sec.querySelectorAll('svg[data-testid^="bp-cmp"] rect[data-testid*="-before-"]').forEach((r) => { const v = Math.min(ratio(getComputedStyle(r).stroke, page), ratio(getComputedStyle(r).stroke, card)); if (v < w.shapes) w.shapes = v; g.n++; });
    sec.querySelectorAll('svg[data-testid^="bp-cmp"] text').forEach((t) => { const v = Math.min(ratio(getComputedStyle(t).fill, page), ratio(getComputedStyle(t).fill, card)); if (v < w.text) w.text = v; });
    out.push({ key, dark: lum(page) < 0.3, shapes: +w.shapes.toFixed(2), text: +w.text.toFixed(2), bars: g.n });
  });
  sec.removeAttribute('style'); return out;
}, data);
const cmpOf = (page) => page.evaluate(() => {
  const c = document.querySelector('[data-testid="practice-cmp"]'); if (!c) return null;
  const list = document.querySelector('[data-testid="practice-list"]'), rl = list.getBoundingClientRect(), rc = c.getBoundingClientRect();
  const rows = Array.from(c.querySelectorAll('g[data-testid*="-row-"]')).map((g) => ({ name: g.querySelector('text').textContent, title: g.querySelector('title').textContent, change: (g.querySelector('[data-testid*="-change-"]') || {}).textContent || '', state: g.getAttribute('data-state') }));
  const svgs = Array.from(c.querySelectorAll('svg')).map((s) => ({ role: s.getAttribute('role'), title: s.querySelector('title').textContent, desc: s.querySelector('desc').textContent.length, right: Math.round(s.getBoundingClientRect().right) }));
  return { caption: c.querySelector('[data-testid="practice-cmp-caption"]').innerText, shown: Number(c.getAttribute('data-shown')), listed: Number(c.getAttribute('data-listed')), rows, svgs, box: [Math.round(rc.x), Math.round(rc.y), Math.round(rc.width), Math.round(rc.height)], listTop: Math.round(rl.y), sideways: document.documentElement.scrollWidth - document.documentElement.clientWidth, vw: innerWidth, vh: innerHeight };
});
const listTopWithoutCmp = (page) => page.evaluate(() => { const p = document.querySelector('[data-testid="practice-cmp"]'); p.style.display = 'none'; const t = Math.round(document.querySelector('[data-testid="practice-list"]').getBoundingClientRect().y); p.style.display = ''; return t; });
const fmtPct = (v) => (v === 0 ? '0.0%' : (v > 0 ? '+' : '−') + Math.abs(v).toFixed(1) + '%');
const SHOTS = process.env.SHOTS || OUT;
(async () => {
  log('== rep66b walk ' + new Date().toISOString());
  const browser = await chromium.launch();
  const seats = { aud: await signIn('aud1@seedefirmau'), acct: await signIn('acct1@seedefirmau') };
  for (const k of Object.keys(seats)) {
    const cl = seats[k].data.clients, st = {}; cl.forEach((c) => { const s = c.health.sales_yoy_state || 'none'; st[s] = (st[s] || 0) + 1; });
    log(k + ' clients=' + cl.length + ' yoy states ' + cut(st) + ' first=' + cut(cl[0] && { f: cl[0].health.sales_yoy_from, t: cl[0].health.sales_yoy_to, n: cl[0].health.sales_ytd_minor, p: cl[0].health.sales_prev_ytd_minor, pct: cl[0].health.sales_yoy_pct, st: cl[0].health.sales_yoy_state, th: cl[0].health.sales_through }));
  }
  let darkKey = null;
  for (const k of ['aud', 'acct']) for (const vp of [{ width: 1366, height: 768 }, { width: 390, height: 844 }]) {
    const S = seats[k], n = vp.width, { ctx, page } = await ctxOf(browser, vp, S.sess), tag = k + '@' + n;
    let practiceCalls = 0; page.on('request', (r) => { if (/\/books-grants\/practice/.test(r.url())) practiceCalls++; });
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="practice-band"]', { timeout: 20000 }).catch((e) => log('NO BAND ' + e.message.slice(0, 40) + ' BAD ' + cut(page.__bad, 300) + ' FAILED ' + cut(page.__fail, 400))); await sleep(1500);
    const tab = page.locator('[data-testid="practice-band-advisory"]'); if (await tab.count()) { await tab.click(); await sleep(600); }
    const c = await cmpOf(page);
    const ranked = S.data.clients.filter((x) => x.health.sales_yoy_state === 'ok' && x.health.sales_yoy_pct != null), fall = ranked.filter((x) => x.health.sales_yoy_pct < 0).sort((a, b) => a.health.sales_yoy_pct - b.health.sales_yoy_pct), rise = ranked.filter((x) => x.health.sales_yoy_pct > 0).sort((a, b) => b.health.sales_yoy_pct - a.health.sales_yoy_pct);
    if (!c) { ok(tag + ' chart 1 drawn', ranked.length === 0, 'none; ranked ' + ranked.length); }
    else {
      const want = fall.slice(0, n === 1366 ? 3 : 2).concat(n === 1366 ? rise.slice(0, 3) : []).map((x) => fmtPct(x.health.sales_yoy_pct));
      const got = c.rows.map((r) => r.change.replace(/^[▲▼]\s*/, '').trim());
      ok(tag + ' chart 1 printed changes = the api sales_yoy_pct in rank order (falling most, then rising most)', JSON.stringify(got) === JSON.stringify(want), 'got ' + got + ' api ' + want);
      ok(tag + ' chart 1 ranks only state ok', c.rows.every((r) => r.state === 'ok'), c.rows.map((r) => r.state));
      ok(tag + ' chart 1 caption says how many of the list', c.listed === S.data.clients.length && c.shown === c.rows.length && /clients listed/.test(c.caption), c.caption);
      ok(tag + ' chart 1 svgs named + described', c.svgs.every((s) => s.role === 'img' && s.title && s.desc > 10), cut(c.svgs));
      const t0 = await listTopWithoutCmp(page);
      ok(tag + ' chart 1 pushes the list down by 0', c.listTop === t0, 'listTop ' + c.listTop + ' without ' + t0 + ' cell box ' + c.box);
      ok(tag + ' no sideways scroll, charts inside the viewport', c.sideways <= 0 && c.svgs.every((s) => s.right <= c.vw), 'sideways ' + c.sideways + ' svg rights ' + c.svgs.map((s) => s.right) + '/' + c.vw);
      await (await page.$('#bp_practice')).screenshot({ path: SHOTS + '/' + tag + '-advice-cream.png' });
      if (n === 1366) {
        const rows = await themeCmp(page, S.data), lowS = rows.filter((x) => x.shapes < 3), lowT = rows.filter((x) => x.text < 4.5);
        ok(tag + ' 16 themes: last-year outlines >= 3:1', rows.length === 16 && lowS.length === 0, rows.length + ' themes, below 3: ' + (lowS.map((x) => x.key + ' ' + x.shapes).join('; ') || 'none') + ', min ' + Math.min.apply(0, rows.map((x) => x.shapes)));
        ok(tag + ' 16 themes: words >= 4.5:1', lowT.length === 0, 'below 4.5: ' + (lowT.map((x) => x.key + ' ' + x.text).join('; ') || 'none') + ', min ' + Math.min.apply(0, rows.map((x) => x.text)));
        darkKey = (rows.find((x) => x.dark) || {}).key || darkKey;
      }
      if (darkKey) {
        await page.evaluate(([key, data]) => { const v = CBScreen.APP_THEMES[key].vars || {}; document.getElementById('bp_practice').setAttribute('style', Object.keys(v).map((m) => m + ':' + v[m]).join(';') + ';--page:var(--paper);background:var(--paper);color:var(--ink)'); const cell = document.querySelector('[data-testid="practice-cmp"]'); if (cell) cell.outerHTML = CBPractice.parts.compareHTML(data); }, [darkKey, S.data]);
        await (await page.$('#bp_practice')).screenshot({ path: SHOTS + '/' + tag + '-advice-' + darkKey + '.png' });
      }
    }
    await page.evaluate(() => { document.getElementById('bp_practice').removeAttribute('style'); });
    const kinds = {}; S.data.clients.forEach((x) => { const s = x.health.sales_yoy_state; if (s && !kinds[s]) kinds[s] = x; });
    log(tag + ' kinds present ' + Object.keys(kinds));
    for (const s of Object.keys(kinds).slice(0, 4)) {
      const x = kinds[s], cell = page.locator('[data-testid="practice-status-' + x.entity_id + '"]');
      if (!(await cell.count())) { log('  ' + s + ' ' + x.name + ' not drawn (virtual list) - skipped'); continue; }
      await cell.first().click(); await sleep(700);
      const g = await page.evaluate((id) => { const b = document.querySelector('[data-testid="practice-pair-box-' + id + '"]'); if (!b) return null; const r = b.getBoundingClientRect(); return { words: b.querySelector('.sub').innerText, rows: b.querySelectorAll('g[data-testid*="-row-"]').length, desc: b.querySelector('desc').textContent, right: Math.round(r.right), vw: innerWidth, sideways: document.documentElement.scrollWidth - document.documentElement.clientWidth }; }, x.entity_id);
      const money = (v) => page.evaluate(([v, cur]) => CBLocale.money(v / 100, cur || 'AUD'), [v, x.currency]);
      if (!g) { ok(tag + ' pair for ' + s + ' ' + x.name, x.health.sales_ytd_minor == null, 'none (api ytd ' + x.health.sales_ytd_minor + ')'); }
      else {
        const wantWords = (await money(x.health.sales_ytd_minor)) + ' this year · ' + (await money(x.health.sales_prev_ytd_minor)) + ' last year';
        ok(tag + ' pair (' + s + ') printed money = the api figures through CBLocale', g.words.indexOf(wantWords) === 0, g.words + ' | want ' + wantWords);
        ok(tag + ' pair (' + s + ') fits', g.right <= g.vw && g.sideways <= 0, 'right ' + g.right + '/' + g.vw + ' sideways ' + g.sideways);
        await (await page.$('[data-testid="practice-detail-' + x.entity_id + '"]')).screenshot({ path: SHOTS + '/' + tag + '-pair-' + s + '.png' });
      }
      await cell.first().click(); await sleep(300);
    }
    ok(tag + ' the practice read count is one per load', practiceCalls === 1, 'practice calls ' + practiceCalls);
    log('  bad ' + cut(page.__bad.splice(0), 400) + ' calls=' + calls + ' remaining=' + rem);
    await ctx.close();
  }
  { /* the sample page: the five kinds in 16 themes, the hostile rows (stale hatch, +900% broken end) drawn, svgs named */
    const { ctx, page } = await ctxOf(browser, { width: 1366, height: 768 }, seats.aud.sess);
    await page.goto(BASE + '/chart-sample.html', { waitUntil: 'domcontentloaded' }); await sleep(1500);
    const r = await page.evaluate(() => ({ panels: document.querySelectorAll('.panel').length, svgs: document.querySelectorAll('.panel svg').length, cmp: document.querySelectorAll('.panel svg[data-testid^="cs-cmp-"]').length, unnamed: [...document.querySelectorAll('.panel svg')].filter((s) => s.getAttribute('role') !== 'img').length, noDesc: [...document.querySelectorAll('.panel svg')].filter((s) => !s.querySelector('desc') && !s.getAttribute('aria-label')).length, hatched: document.querySelectorAll('.panel svg[data-testid^="cs-cmp-"] rect[style*="-hatch"]').length, broken: document.querySelectorAll('.panel svg[data-testid^="cs-cmp-"] line[style*="stroke-width:1.5"]').length }));
    ok('chart sample: 16 panels, 16 x 5 svgs, every svg named and described', r.panels === 16 && r.svgs === 80 && r.unnamed === 0 && r.noDesc === 0 && r.cmp === 16, cut(r));
    ok('chart sample: the stale row is hatched and the +900% bar is broken in every theme', r.hatched === 16 && r.broken >= 16, 'hatched ' + r.hatched + ' broken-end cuts ' + r.broken);
    const panels = await page.$$('.panel'); await panels[0].screenshot({ path: SHOTS + '/sample-theme-1.png' }); await panels[panels.length - 1].screenshot({ path: SHOTS + '/sample-theme-16.png' });
    await ctx.close();
  }
  await browser.close(); log('TOTAL calls ' + calls + ' 429s=' + r429 + ' remaining=' + rem + ' FAILS=' + fails); log('DONE');
  process.exit(fails ? 1 : 0);
})().catch((e) => { log('FATAL ' + (e.stack || e).toString().slice(0, 600)); process.exit(1); });
