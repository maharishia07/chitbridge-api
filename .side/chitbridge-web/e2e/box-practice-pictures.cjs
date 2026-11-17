'use strict';
/* box-practice-pictures.cjs - REP-66 walk, run ON a SIT box inside the Playwright image (see the run line in the PR): the practice pictures against the seeded api.
 * Read-only: signs in aud1 and acct1 (OTP from the environment, never in a file), reads, opens bands and rows. Proves, per seat at 1366 and 390: the picture segments equal the API tile counts,
 * text equivalent, the list is pushed down by 0, no sideways scroll, the first list row in the first screen, the opened row's strip equals year_end.locked, and the picture's contrast in all 16 themes.
 * Env: CODE (the tester code), BASE (the throwaway web, default http://localhost:3997), API (default http://127.0.0.1:3991), OUT (default /out). */
const fs = require('fs'); const http = require('http'); const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:3997', API = process.env.API || 'http://127.0.0.1:3991', OUT = process.env.OUT || '/out', CODE = process.env.CODE;
const ORIGIN = process.env.ORIGIN || 'http://localhost:3992'; /* the origin the seede api allows: this throwaway web is another port of the same site */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (m) => { console.log(m); fs.appendFileSync(OUT + '/walk66.log', m + '\n'); };
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
const picOf = (page) => page.evaluate(() => {
  const pic = document.querySelector('[data-testid="practice-pic"]'); if (!pic) return null;
  const svg = pic.querySelector('svg'), r = pic.getBoundingClientRect();
  const segs = Array.from(svg.querySelectorAll('rect[data-kind]')).map((x) => Number((x.querySelector('title').textContent.match(/(\d+)$/) || [])[1]));
  const list = document.querySelector('[data-testid="practice-list"]'), rl = list.getBoundingClientRect();
  const first = Array.from(document.querySelectorAll('[data-testid^="practice-open-"]'))[0];
  const rf = first && first.getBoundingClientRect();
  const tiles = Array.from(document.querySelectorAll('.bp-tile')).map((t) => Number(t.querySelector('b').innerText));
  return { band: document.querySelector('[data-testid="practice-band"]').getAttribute('data-band'), role: svg.getAttribute('role'), title: svg.querySelector('title').textContent, desc: svg.querySelector('desc').textContent,
    segs, total: Number(pic.getAttribute('data-total')), count: pic.querySelector('[data-testid="practice-pic-count"]').innerText, figures: Array.from(svg.querySelectorAll('text')).map((t) => t.textContent), picBox: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
    tiles, listTop: Math.round(rl.y), firstRowBottom: rf ? Math.round(rf.bottom) : null, vh: innerHeight, sideways: document.documentElement.scrollWidth - document.documentElement.clientWidth, svgRight: Math.round(svg.getBoundingClientRect().right), vw: innerWidth };
});
const listTopWithoutPic = (page) => page.evaluate(() => { const p = document.querySelector('[data-testid="practice-pic"]'); p.style.display = 'none'; const t = Math.round(document.querySelector('[data-testid="practice-list"]').getBoundingClientRect().y); p.style.display = ''; return t; });
const themeRows = (page, band, client) => page.evaluate(([band, client]) => {
  const lum = (c) => { const m = c.match(/[\d.]+/g).map(Number); const rgb = /^color\(/.test(c) ? m.slice(0, 3) : m.slice(0, 3).map((x) => x / 255); const f = (v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)); return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]); };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const themes = CBScreen.APP_THEMES, sec = document.getElementById('bp_practice'), out = [];
  Object.keys(themes).forEach((key) => {
    const vars = themes[key].vars || {}; /* cream sets nothing: the page's own tokens */ sec.setAttribute('style', Object.keys(vars).length ? Object.keys(vars).map((n) => n + ':' + vars[n]).join(';') + ';--page:var(--paper);background:var(--paper);color:var(--ink)' : 'background:var(--paper,#FCFAF5);color:var(--ink)');
    /* draw again under this theme, the way a theme switch followed by a redraw does */
    const pic = sec.querySelector('[data-testid="practice-pic"]'); if (pic && band) pic.outerHTML = CBPractice.parts.pictureHTML(band);
    const sb = client && sec.querySelector('[data-testid="practice-strip-box-' + client.entity_id + '"]'); if (sb) sb.outerHTML = CBPractice.parts.stripHTML(client);
    const probe = document.createElement('div'); probe.style.cssText = 'background:var(--card)'; sec.appendChild(probe);
    const page = getComputedStyle(sec).backgroundColor, card = getComputedStyle(probe).backgroundColor; sec.removeChild(probe);
    const worst = { shapes: 99, text: 99, what: '' };
    sec.querySelectorAll('svg[data-testid^="bp-pic"] rect[data-kind], svg[data-testid^="practice-strip"] rect[data-state]').forEach((r) => {
      const cs = getComputedStyle(r), colour = r.hasAttribute('data-kind') || r.getAttribute('data-state') === 'locked' ? cs.fill : cs.stroke;
      const v = Math.min(ratio(colour, page), ratio(colour, card)); if (v < worst.shapes) { worst.shapes = v; worst.what = r.getAttribute('data-kind') || r.getAttribute('data-state'); }
    });
    sec.querySelectorAll('svg text').forEach((t) => { const v = Math.min(ratio(getComputedStyle(t).fill, page), ratio(getComputedStyle(t).fill, card)); if (v < worst.text) worst.text = v; });
    out.push({ key, dark: lum(page) < 0.3, shapes: +worst.shapes.toFixed(2), what: worst.what, text: +worst.text.toFixed(2) });
  });
  sec.removeAttribute('style'); return out;
}, [band, client]);
(async () => {
  log('== rep66 walk ' + new Date().toISOString());
  const browser = await chromium.launch();
  const seats = { aud: await signIn('aud1@seedefirmau'), acct: await signIn('acct1@seedefirmau') };
  for (const k of Object.keys(seats)) log(k + ' seat=' + seats[k].data.band.seat + ' clients=' + seats[k].data.clients.length + ' bands=' + cut(seats[k].data.band.bands.map((b) => b.key + ':' + b.tiles.map((t) => t.key + '=' + t.n).join(','))));
  for (const k of ['aud', 'acct']) for (const vp of [{ width: 1366, height: 768 }, { width: 390, height: 844 }]) {
    const S = seats[k], n = vp.width, { ctx, page } = await ctxOf(browser, vp, S.sess);
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="practice-band"]', { timeout: 20000 }).catch(async (e) => { log('NO BAND ' + e.message.slice(0, 40) + ' TEXT ' + (await page.evaluate(() => document.body.innerText.replace(/s+/g, ' ').slice(0, 500))) + ' BAD ' + cut(page.__bad, 300) + ' FAILED ' + cut(page.__fail, 500)); await page.screenshot({ path: OUT + '/nobanner.png' }); }); await sleep(1500);
    for (const b of S.data.band.bands) {
      const tab = page.locator('[data-testid="practice-band-' + b.key + '"]'); if (await tab.count()) { await tab.click(); await sleep(500); }
      const p = await picOf(page), tag = k + '@' + n + ' ' + b.key;
      if (b.key === 'advisory') { ok(tag + ' advice band draws no picture', p === null, cut(p)); continue; }
      if (!p) { ok(tag + ' picture drawn', false, 'none'); continue; }
      const apiN = b.tiles.reduce((m, t) => { m[t.key] = t.n; return m; }, {});
      const want = (b.key === 'pipeline' ? ['books_in', 'complete', 'checked', 'ready', 'lodged'] : ['bank_unexplained', 'to_check', 'months_unlocked']).map((x) => apiN[x]).filter((x) => x > 0);
      ok(tag + ' segments equal the API tile counts', JSON.stringify(p.segs) === JSON.stringify(want), 'segs ' + p.segs + ' api ' + want + ' tiles-on-page ' + p.tiles);
      if (b.key === 'pipeline') ok(tag + ' segments sum to the stage tiles (= clients)', p.segs.reduce((a, c) => a + c, 0) === p.tiles.reduce((a, c) => a + c, 0), p.segs.reduce((a, c) => a + c, 0) + ' vs ' + p.tiles.reduce((a, c) => a + c, 0) + ' of ' + S.data.clients.length + ' clients');
      ok(tag + ' text equivalent: role img + title + desc + visible count', p.role === 'img' && !!p.title && p.desc.length > 3 && p.count.length > 0, 'desc="' + p.desc + '" count="' + p.count + '" figures=' + p.figures);
      const top0 = await listTopWithoutPic(page);
      ok(tag + ' the picture pushes the list down by 0', p.listTop === top0, 'listTop ' + p.listTop + ' without the picture ' + top0);
      ok(tag + ' no sideways scroll, picture inside the viewport', p.sideways <= 0 && p.svgRight <= p.vw, 'sideways ' + p.sideways + ' svgRight ' + p.svgRight + '/' + p.vw);
      ok(tag + ' first list row in the first screen', p.firstRowBottom !== null && p.firstRowBottom <= p.vh, 'first row bottom ' + p.firstRowBottom + ' of ' + p.vh + ' (list top ' + p.listTop + ', picture box ' + p.picBox + ')');
      await page.screenshot({ path: OUT + '/' + k + '-' + n + '-' + b.key + '.png' });
    }
    if (S.data.band.bands.some((b) => b.key === 'pipeline')) {
      const tab = page.locator('[data-testid="practice-band-pipeline"]'); if (await tab.count()) { await tab.click(); await sleep(500); }
      const cl = S.data.clients.filter((c) => c.year_end && !c.year_end.first_year);
      for (const c of [cl.find((x) => x.year_end.locked < x.year_end.of && x.year_end.locked > 0), cl.find((x) => x.year_end.locked === x.year_end.of)].filter(Boolean)) {
        const cell = page.locator('[data-testid="practice-status-' + c.entity_id + '"]');
        if (!(await cell.count())) { log('  row ' + c.name + ' not drawn (virtual list) - skipped'); continue; }
        await cell.first().click(); await sleep(600);
        const s = await page.evaluate((id) => { const box = document.querySelector('[data-testid="practice-strip-box-' + id + '"]'); if (!box) return null; const r = box.getBoundingClientRect();
          return { states: Array.from(box.querySelectorAll('rect[data-state]')).map((x) => x.getAttribute('data-state')), count: box.querySelector('.sub').innerText, right: Math.round(r.right), sideways: document.documentElement.scrollWidth - document.documentElement.clientWidth, vw: innerWidth }; }, c.entity_id);
        ok(k + '@' + n + ' ' + c.name + ' strip locked squares = year_end.locked', !!s && s.states.length === c.year_end.of && s.states.filter((x) => x === 'locked').length === c.year_end.locked, cut(s) + ' api ' + c.year_end.locked + '/' + c.year_end.of);
        if (s) ok(k + '@' + n + ' the strip fits', s.right <= s.vw && s.sideways <= 0, 'right ' + s.right + ' sideways ' + s.sideways);
        await page.screenshot({ path: OUT + '/' + k + '-' + n + '-strip.png' });
        if (n === 1366 && k === 'acct') {
          const rows = await themeRows(page, S.data.band.bands.find((x) => x.key === 'pipeline'), c), lowS = rows.filter((x) => x.shapes < 3), lowT = rows.filter((x) => x.text < 4.5);
          ok('16 themes: strip + stage bar shapes >= 3:1', rows.length === 16 && lowS.length === 0, rows.length + ' themes; below 3: ' + (lowS.map((x) => x.key + ' ' + x.what + ' ' + x.shapes).join('; ') || 'none') + '; min ' + Math.min.apply(0, rows.map((x) => x.shapes)));
          ok('16 themes: figures >= 4.5:1', lowT.length === 0, 'below 4.5: ' + (lowT.map((x) => x.key + ' ' + x.text).join('; ') || 'none') + '; min ' + Math.min.apply(0, rows.map((x) => x.text)));
          log('  per theme ' + rows.map((x) => x.key + (x.dark ? '(d)' : '') + ' ' + x.shapes + '/' + x.text).join(' | '));
        }
        await cell.first().click(); await sleep(300);
      }
    }
    if (n === 1366 && k === 'acct') {
      const tab = page.locator('[data-testid="practice-band-on_us"]'); if (await tab.count()) { await tab.click(); await sleep(500); }
      const rows = await themeRows(page, S.data.band.bands.find((x) => x.key === 'on_us'), null), lowS = rows.filter((x) => x.shapes < 3);
      ok('16 themes: on-us bar shapes >= 3:1', rows.length === 16 && lowS.length === 0, 'below 3: ' + (lowS.map((x) => x.key + ' ' + x.what + ' ' + x.shapes).join('; ') || 'none') + '; min ' + Math.min.apply(0, rows.map((x) => x.shapes)));
    }
    log('  bad ' + cut(page.__bad.splice(0), 400) + ' calls=' + calls + ' remaining=' + rem);
    await ctx.close();
  }
  await browser.close(); log('TOTAL calls ' + calls + ' 429s=' + r429 + ' remaining=' + rem + ' FAILS=' + fails); log('DONE');
  process.exit(fails ? 1 : 0);
})().catch((e) => { log('FATAL ' + (e.stack || e).toString().slice(0, 600)); process.exit(1); });
