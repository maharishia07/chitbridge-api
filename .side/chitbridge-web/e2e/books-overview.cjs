'use strict';
// @type: system
/**
 * e2e/books-overview.cjs - MIS overview "How we are doing" (screen BKS026, public/app/cap-books-overview.js) in a REAL browser against the REAL api
 * (GET /api/books/overview, lib/books-mis.js) and a REAL Postgres holding a seeded two-year Australian shop (api tools/sim-load.cjs --months 24 --country AU).
 *
 * OWNS      the proof that: every tile and the headline equal the api's own figure (the page adds, rounds and compares nothing) · a figure the api did not send
 *           draws NO tile and no zero (this shop has no sales posted in the current week, month or quarter: the api answers sales.minor null) · the period select
 *           (BKS026-S01) re-reads and repaints for week, mtd, quarter, ytd · each chart has its table and the table's rows equal the api's bars · every control and picture
 *           wears its BKS026 code · 1366x768 and 390x844 fit with no sideways scroll, light and dark, text contrast 4.5:1 inside the page.
 * MOCKED    only two cases, both marked in the output: (a) the api answer for a seat without costs (income, expenses, profit, gross removed, cost_hidden true) to see that the
 *           page draws no cost tile and no zero; (b) one forced 500 on the overview read, to reach the Try again button (BKS026-B01) and its repaint. Everything else is real.
 * SIGN-IN   the api's own login path (/api/entities/register + /verify on a LOCAL api: lib/signin-code.cjs says which fixed code); the token lives in memory only,
 *           is never printed and never written.
 * RUN       on a SIT box inside the Playwright image, sharing the network of the throwaway Postgres + api (see the run line in the PR):
 *           NODE_PATH=/pw/node_modules node /web/e2e/books-overview.cjs      Env: API (default http://localhost:3000), SHOP (q17shopau), OUT (default /out), PORT (3997: the api's ALLOWED_ORIGINS)
 * CARD      26-reporting-mis-and-bi/mis
 */
const fs = require('fs'), http = require('http'), path = require('path');
const { chromium } = require('playwright');
const { signinCode } = require('./lib/signin-code.cjs');
const { measure } = require('./lib/theme-measure.cjs');
const C = require('./lib/contract.cjs'); /* every overview answer (the api's own four, and the two mocked here) is held to docs/contracts/web-api.json: e2e/fixtures/web-api.contract.json */

const API = process.env.API || 'http://localhost:3000', SHOP = process.env.SHOP || 'q17shopau', OUT = process.env.OUT || '/out', PORT = Number(process.env.PORT || 3997);
const ROOT = path.join(__dirname, '..'), PUB = path.join(ROOT, 'public');
const T = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok  ' + m); } else { fail++; console.log('  XX  ' + m); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function j(p, token, body) {
  const r = await fetch(API + p, { method: body ? 'POST' : 'GET', headers: Object.assign({ 'content-type': 'application/json' }, token ? { authorization: 'Bearer ' + token } : {}), body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, b: await r.json().catch(() => ({})) };
}
/** the owner's sign-in, the two calls the Sign in screen makes; returns the session the apps store (never printed) */
async function signIn() {
  const email = SHOP + '@test.example', otp = signinCode('owner', API);
  await j('/api/entities/register', null, { email, mode: 'login' });
  const v = await j('/api/entities/verify', null, { email, otp });
  if (!v.b.token) throw new Error('sign-in refused: ' + v.status);
  const e = v.b.entity || {};
  return { token: v.b.token, sess: { token: v.b.token, role: 'entity', name: e.display_name || email, entity: e.display_name || email, bridgeId: e.bridge_id || null, shop: 'open' } };
}
/** a page's money text -> signed minor units (digits only: the api's figure is in minor units, the page's is the shop's currency format) */
const minorOf = (text) => { const d = String(text).replace(/[^\d]/g, ''); return d === '' ? null : (/[-−(]/.test(text) ? -1 : 1) * Number(d); };
const CODES = { pick: 'BKS026-S01', retry: 'BKS026-B01', sales: 'BKS026-B02', income: 'BKS026-B03', profit: 'BKS026-B04', collect: 'BKS026-B05', pay: 'BKS026-B06', cash: 'BKS026-B07', headline: 'BKS026-P01' };
const WORDS = { week: 'This week so far', mtd: 'This month so far', quarter: 'This quarter so far', ytd: 'This year so far' };

/** what the page must draw for an answer: tile key -> minor (null = no tile) */
function expectOf(a) {
  const f = (o) => (o && o.minor != null ? o.minor : null);
  return { sales: f(a.sales), income: f(a.income), profit: f(a.profit), collect: f(a.to_collect), pay: f(a.to_pay) };
}
const pctOf = (bp) => (bp / 100 > 0 ? '+' : '') + (bp / 100).toFixed(1) + '%';

async function readPage(page) {
  return page.evaluate(() => {
    const t = (s) => { const n = document.querySelector(s); return n ? n.innerText.replace(/\s+/g, ' ').trim() : null; };
    const tiles = {};
    document.querySelectorAll('.ov-tile').forEach((n) => { const id = n.getAttribute('data-testid').replace(/^ov-/, ''); tiles[id] = { v: (n.querySelector('.ov-v') || {}).innerText || null, note: (n.querySelector('.ov-n') || {}).innerText || '', code: n.getAttribute('data-cbsid'), href: n.getAttribute('href') }; });
    const pic = (k) => { const s = document.querySelector('[data-testid="ov-pic-' + k + '"]'); if (!s) return null; return { code: s.getAttribute('data-cbsid'), svg: !!s.querySelector('svg'), rows: Array.from(s.querySelectorAll('tbody tr')).map((r) => r.children[1].textContent.trim()), sum: (s.querySelector('summary') || {}).getAttribute ? s.querySelector('summary').getAttribute('data-cbsid') : null }; };
    const sel = document.querySelector('[data-testid="ov-pick"]');
    /* the rest of the pictures, by the testid each wears: weekday, owed, owe, cash line, and the one-line item note */
    const card = (k) => { const s = document.querySelector('[data-testid="ov-pic-' + k + '"]'); return s ? { code: s.getAttribute('data-cbsid'), sum: (s.querySelector('summary') || { getAttribute: () => null }).getAttribute('data-cbsid') } : null; };
    const note = document.querySelector('[data-testid="ov-item-note"]');
    return { weekday: card('weekday'), owed: card('owed'), owe: card('owe'), cashline: card('cashline'), itemNote: note ? note.getAttribute('data-cbsid') : null, headline: t('[data-testid="ov-headline"]'), headCode: (document.querySelector('[data-testid="ov-headline"]') || { getAttribute: () => null }).getAttribute('data-cbsid'), tiles, sales: pic('sales'), profit: pic('profit'), pick: sel ? { value: sel.value, code: sel.getAttribute('data-cbsid'), options: Array.from(sel.options).map((o) => o.value) } : null, body: document.body.innerText.replace(/\s+/g, ' '), through: t('[data-testid="ov-through"]') };
  });
}

/** every figure the page draws against the api answer `a` */
function compare(tag, a, got, period) {
  const want = expectOf(a);
  for (const k of Object.keys(want)) {
    const tile = got.tiles[k];
    if (want[k] == null) { ok(!tile, tag + ' ' + k + ': the api sent no figure -> no tile' + (tile ? ' (drew "' + tile.v + '")' : '')); continue; }
    ok(!!tile && minorOf(tile.v) === want[k], tag + ' ' + k + ': tile "' + (tile && tile.v) + '" = api ' + want[k] + ' minor');
    if (tile && CODES[k]) ok(tile.code === CODES[k], tag + ' ' + k + ' tile wears ' + CODES[k] + ' (' + tile.code + ')');
    const fig = { sales: a.sales, income: a.income, profit: a.profit }[k];
    if (fig && tile) {
      const wantNote = fig.change_bp != null ? pctOf(fig.change_bp) : null;
      ok(wantNote ? tile.note.includes(wantNote) : !/%/.test(tile.note), tag + ' ' + k + ': change ' + (wantNote ? 'says ' + wantNote : 'absent -> no percent drawn') + ' (note "' + tile.note + '")');
    }
  }
  const cash = got.tiles.cash;
  if (a.cash && a.cash.words) ok(!!cash && cash.note.replace(/\s+/g, ' ') === a.cash.words.replace(/\s+/g, ' ') && cash.code === CODES.cash, tag + ' cash: the api\'s sentence, word for word, wearing ' + CODES.cash);
  else ok(!cash, tag + ' cash: no sentence from the api -> no tile');
  const lead = a.income && a.income.minor != null ? a.income : a.sales && a.sales.minor != null ? a.sales : null;
  if (lead) ok(got.headline && minorOf(got.headline.replace(/^[^:]*:/, '').split('(')[0]) === lead.minor && got.headline.toLowerCase().includes(WORDS[period].toLowerCase()) && got.headCode === CODES.headline, tag + ' headline "' + got.headline + '" = api ' + lead.minor + ' for ' + WORDS[period]);
  else ok(!got.headline, tag + ' no lead figure -> no headline');
  /* never a zero for an unknown: the words of an absent figure are nowhere on the page */
  if (want.sales == null) ok(!/Sales, tax in/.test(got.body) && !/not available/i.test(got.body), tag + ' absent sales: its label and "not available" are nowhere on the page');
  const pics = [['sales', a.bars || [], 'sold_minor', 'BKS026-P02', 'BKS026-B08'], ['profit', a.profit_by_month || [], 'profit_minor', 'BKS026-P03', 'BKS026-B09']];
  for (const [k, list, key, code, sumCode] of pics) {
    const some = list.some((x) => x[key] != null), pic = got[k];
    if (!some) { ok(!pic, tag + ' ' + k + ' picture: no figures -> nothing drawn'); continue; }
    ok(!!pic && pic.svg && pic.code === code && pic.sum === sumCode, tag + ' ' + k + ' picture drawn, wears ' + code + ' + ' + sumCode);
    if (pic) ok(pic.rows.length === list.length && pic.rows.every((r, i) => (list[i][key] == null ? /^—$/.test(r) : minorOf(r) === list[i][key])), tag + ' ' + k + ' table: ' + list.length + ' rows, each = the api\'s ' + key);
  }
  /* the other cards each wear their BKS026 code and their table's summary code when the api sent figures for them; the item note (P08) is always there */
  const more = [['weekday', 'BKS026-P04', 'BKS026-B10', (a.weekdays || []).some((x) => x.sold_minor != null)], ['owed', 'BKS026-P05', 'BKS026-B11', null], ['owe', 'BKS026-P06', 'BKS026-B12', null], ['cashline', 'BKS026-P07', 'BKS026-B13', !!(a.cash && a.cash.series && a.cash.series.length)]];
  for (const [k, code, sumCode, expected] of more) {
    const pic = got[k];
    if (pic) ok(pic.code === code && pic.sum === sumCode, tag + ' ' + k + ' card wears ' + code + ' + ' + sumCode + ' (' + pic.code + ' + ' + pic.sum + ')');
    else if (expected) ok(false, tag + ' ' + k + ' card expected from the api answer but not drawn (' + code + ')');
  }
  ok(got.itemNote === 'BKS026-P08', tag + ' the profit-per-item note wears BKS026-P08 (' + got.itemNote + ')');
  ok(!!got.pick && got.pick.value === period && got.pick.code === CODES.pick && got.pick.options.join() === 'week,mtd,quarter,ytd', tag + ' period select on ' + period + ', wears ' + CODES.pick);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const srv = http.createServer((q, r) => {
    const rel = decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '');
    const f = (!rel || rel === 'index.html') ? path.join(ROOT, 'index.html') : path.join(PUB, rel);
    if (((!f.startsWith(PUB)) && f !== path.join(ROOT, 'index.html')) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('no'); }
    r.writeHead(200, { 'content-type': T[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(r);
  });
  await new Promise((r) => srv.listen(PORT, '0.0.0.0', r));
  const base = 'http://localhost:' + PORT;
  const { token, sess } = await signIn();
  const truth = {}; /* the api's own answers, read by this script with the same token */
  for (const p of Object.keys(WORDS)) { const r = await j('/api/books/overview?period=' + p, token); if (r.status !== 200) throw new Error('overview ' + p + ' ' + r.status); truth[p] = r.b; C.check('GET', '/api/books/overview', r.status, r.b, 'api answer, period ' + p + ': '); }
  ok(Object.values(truth).every((a) => a.currency === 'AUD'), 'api read: four periods, shop currency AUD');
  ok(truth.week.sales.minor == null && truth.ytd.sales.minor != null, 'the seeded shop: no sales posted this week (absent), sales this year ' + truth.ytd.sales.minor + ' minor');

  const browser = await chromium.launch();
  const bad = [];
  async function open(vp, theme, mock) {
    const ctx = await browser.newContext({ viewport: vp, locale: 'en-AU', timezoneId: 'Australia/Sydney', serviceWorkers: 'block', colorScheme: theme === 'dark' ? 'dark' : 'light', isMobile: vp.width < 500, hasTouch: vp.width < 500 });
    await ctx.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (r) => r.abort());
    await ctx.addInitScript((s) => { try { if (!localStorage.getItem('cb_seeded')) { localStorage.setItem('cb_seeded', '1'); localStorage.setItem('cb_sess', JSON.stringify(s.sess)); } } catch (_) {} }, { sess, theme });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => bad.push('THROW ' + e.message.slice(0, 160)));
    page.on('response', (r) => { if (/\/api\//.test(r.url()) && r.status() >= 400 && !(mock && /overview/.test(r.url()))) bad.push(r.status() + ' ' + new URL(r.url()).pathname); });
    return { ctx, page };
  }
  const settle = async (page, period) => { await page.waitForSelector('[data-testid="ov-headline"], [data-testid="ov-error"]', { timeout: 20000 }); await sleep(400); return readPage(page); };
  const dim = (page) => page.evaluate(() => {
    const vw = window.innerWidth, over = [];
    document.querySelectorAll('.ov-tile,.ov-pic,#ov_pick,.ov-head,.ov-pic svg').forEach((n) => { const r = n.getBoundingClientRect(); if (r.right > vw + 0.5 || r.left < -0.5) over.push((n.getAttribute('data-testid') || n.id || n.tagName) + ' ' + Math.round(r.left) + '..' + Math.round(r.right)); });
    return { vw, sw: document.documentElement.scrollWidth, over };
  });

  for (const vp of [{ width: 1366, height: 768 }, { width: 390, height: 844 }]) {
    for (const theme of ['light', 'dark']) {
      const tag = vp.width + ' ' + theme, { ctx, page } = await open(vp, theme);
      await page.goto(base + '/accounts.html#overview');
      let got = await settle(page, 'ytd');
      /* the look is the server's truth (CBAvatar.hydrate), so a stored cb_theme is overwritten: choose it the way a person does, through the avatar's own set() */
      await page.evaluate((th) => CBAvatar.set('theme', th === 'dark' ? 'dark' : 'cream'), theme);
      await sleep(500);
      ok(((await page.evaluate(() => document.documentElement.getAttribute('data-theme'))) === 'dark') === (theme === 'dark'), tag + ' the page is really in the ' + theme + ' theme');
      got = await readPage(page);
      compare(tag + ' ytd', truth.ytd, got, 'ytd');
      const dup = await page.evaluate(() => { const c = {}; document.querySelectorAll('[data-testid^="ov-"]').forEach((n) => { const k = n.getAttribute('data-testid'); c[k] = (c[k] || 0) + 1; }); return Object.keys(c).filter((k) => c[k] > 1); });
      ok(dup.length === 0, tag + ' every ov-* data-testid is on one element only' + (dup.length ? ' (twice: ' + dup.join(', ') + ')' : ''));
      let d = await dim(page);
      ok(d.sw <= d.vw && d.over.length === 0, tag + ' ytd fits: scrollWidth ' + d.sw + ' <= ' + d.vw + ', nothing past the edge' + (d.over.length ? ' [' + d.over.join('; ') + ']' : ''));
      await page.screenshot({ path: OUT + '/overview-' + vp.width + '-' + theme + '-ytd.png' });
      const lows = (await page.evaluate(measure)).filter((r) => /ov-|bk-st|<select/.test(r.html) && !r.grad && r.ratio < r.need);
      ok(lows.length === 0, tag + ' text contrast in the page >= 4.5:1 (3:1 large)' + (lows.length ? ' LOW ' + lows.slice(0, 3).map((x) => x.text + ' ' + x.ratio).join('; ') : ''));
      for (const p of ['week', 'mtd', 'quarter', 'ytd']) {
        const wait = page.waitForResponse((r) => r.url().includes('/api/books/overview') && r.url().includes('period=' + p), { timeout: 15000 });
        await page.selectOption('[data-testid="ov-pick"]', p);
        await wait; await sleep(500);
        got = await readPage(page);
        compare(tag + ' ' + p, truth[p], got, p);
        d = await dim(page);
        ok(d.sw <= d.vw && d.over.length === 0, tag + ' ' + p + ' fits (scrollWidth ' + d.sw + ' <= ' + d.vw + ')');
        if (p === 'week') await page.screenshot({ path: OUT + '/overview-' + vp.width + '-' + theme + '-week.png' });
      }
      await ctx.close();
    }
  }

  /* MOCKED (a): a seat without costs: the api answers no income, expenses, profit, gross; the page must draw no cost tile and no zero */
  {
    const { ctx, page } = await open({ width: 1366, height: 768 }, 'light', true);
    const hidden = JSON.parse(JSON.stringify(truth.ytd));
    delete hidden.income; delete hidden.expenses; delete hidden.profit; delete hidden.gross; delete hidden.profit_by_month; hidden.cost_hidden = true;
    await page.route('**/api/books/overview**', (r) => C.wrap(r, 'mocked seat without costs: ').fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': base }, body: JSON.stringify(hidden) }));
    await page.goto(base + '/accounts.html#overview');
    const got = await settle(page, 'ytd');
    ok(!got.tiles.income && !got.tiles.profit && !!got.tiles.sales && minorOf(got.tiles.sales.v) === truth.ytd.sales.minor && !got.profit, '[mocked: seat without costs] only the figures the api sent are drawn (sales yes; income, profit and the profit picture no)');
    ok(got.headline && got.headline.startsWith('Sales') && !/\$\s?0\.00/.test(got.body.replace(/Cash ahead.*/, '')), '[mocked: seat without costs] the headline leads with Sales and no 0.00 is invented anywhere');
    await page.screenshot({ path: OUT + '/overview-1366-nocosts.png' });
    await ctx.close();
  }
  /* MOCKED (c): this seeded shop has no sales in the current week, so the api sends no weekday figures; give the weekday card seven (the api's own seven days, figures added) to prove the card and its table wear BKS026-P04 and BKS026-B10 */
  {
    const { ctx, page } = await open({ width: 1366, height: 768 }, 'light', true);
    const withDays = JSON.parse(JSON.stringify(truth.ytd));
    withDays.weekdays = (withDays.weekdays || []).map((d, i) => Object.assign({}, d, { sold_minor: 10000 * (i + 1), last_year_minor: 8000 * (i + 1) }));
    await page.route('**/api/books/overview**', (r) => C.wrap(r, 'mocked weekday figures: ').fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': base }, body: JSON.stringify(withDays) }));
    await page.goto(base + '/accounts.html#overview');
    const got = await settle(page, 'ytd');
    ok(withDays.weekdays.length === 7 && !!got.weekday && got.weekday.code === 'BKS026-P04' && got.weekday.sum === 'BKS026-B10', '[mocked: weekday figures] the weekday card wears BKS026-P04 and its table BKS026-B10 (' + JSON.stringify(got.weekday) + ')');
    await ctx.close();
  }
  /* MOCKED (b): one forced 500 on the overview read: the sentence and Try again (BKS026-B01), then the real answer on the second try */
  {
    const { ctx, page } = await open({ width: 390, height: 844 }, 'light', true);
    let hits = 0;
    await page.route('**/api/books/overview**', (r) => { hits++; if (hits === 1) return r.fulfill({ status: 500, contentType: 'application/json', headers: { 'access-control-allow-origin': base }, body: JSON.stringify({ code: 'X', message: 'forced' }) }); return r.continue(); });
    await page.goto(base + '/accounts.html#overview');
    await page.waitForSelector('[data-testid="ov-error"]', { timeout: 20000 });
    const btn = page.locator('[data-testid="ov-retry"]');
    ok((await btn.getAttribute('data-cbsid')) === CODES.retry, '[mocked: one forced 500] the error line shows Try again wearing ' + CODES.retry);
    await btn.click();
    const got = await settle(page, 'ytd');
    ok(hits === 2 && !!got.tiles.sales && minorOf(got.tiles.sales.v) === truth.ytd.sales.minor, '[mocked: one forced 500] Try again reads the api once more and paints the real figure');
    await ctx.close();
  }
  await browser.close();
  srv.close();
  ok(...C.finish());
  ok(bad.length === 0, 'no page error and no api status >= 400 outside the forced one' + (bad.length ? ' ' + bad.slice(0, 4).join(' | ') : ''));
  console.log('\n' + pass + ' ok, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FATAL ' + (e.stack || e).toString().slice(0, 700)); process.exit(1); });
