#!/usr/bin/env node
/**
 * e2e/walk-x-r2r.cjs — R2R (Record to report) WALKED, WIDTH AND DEPTH (round WX-R2R, 2026-10-13; flows.json R2R steps 1-6).
 * Owner: "walk each of the screen across all the flow both depth and width and resolve the issues for every operation".
 *
 * WIDTH: every CB Accounts view the flow touches (the 21 menu items: To do · Day book · Ledgers · Trial balance · P&L · Balance sheet · Bank ·
 *        Receivables · Payables · Unpaid bills · Cheques · Waiting · Month lock · Closing stock · Assets · Accruals · GST close · Year close · Packs ·
 *        Opening balances · Shop ledgers) at 1366×768 AND 390×844: the view paints (no error card, no page error), no page-wide sideways scroll,
 *        and what it SAYS is held to the shop: the year's first month (India April · Australia July), the shop's money symbol, Dr = Cr on screen.
 * DEPTH (1366): step 1 an entry — ＋ Entry → Pay expense → in a CLOSED month the server's refusal is on screen with its fix; in the open year it saves,
 *        the Day book shows it, Reverse adds the mirror and the row says "Reversed by"; step 3 Month lock — a future month's Lock is greyed WITH the
 *        server's sentence; step 4 GST close — the closed month says what happened; step 5 Year close — the loaded year reads closed; step 6 the
 *        statements — TB balances on screen, a TB amount opens its ledger, P&L shows a result (never a refusal), BS sides agree.
 *        Step 2 (day close) is the counter's: its depth here is the posted walk-in days in the Day book (the loader closes each day through the api).
 *
 * TWO MODES
 *   --real   the REAL stack on this machine: Postgres loaded by the api's tools/sim-load.cjs (docs/SIM-LOAD.md) — the walk SPAWNS the api
 *            (node server.js, DEV_OTP, the web origin allowed) on SIM_DB and signs in through the page's own sign-in window, then kills it.
 *              node tools/sim-load.cjs --db postgres://postgres:pw@127.0.0.1:5432/cb_sim --shop simstores --schema      (api checkout)
 *              node tools/sim-load.cjs --db postgres://postgres:pw@127.0.0.1:5432/cb_sim --shop austores --country AU
 *              NODE_PATH=$PWD/e2e/node_modules node e2e/walk-x-r2r.cjs --real --shop IN      (then --shop AU; one shop per command)
 *            env: CB_API_DIR (default ../chitbridge-api) · SIM_DB (default the URL above). The depth writes (one entry + its reversal) go to THAT
 *            local database only.
 *   (none)   FIXTURE: the cloud walks. The site from this checkout, the API a stand-in inside the page (e2e/lib/books-api.cjs shapes, held to the
 *            contract by e2e/lib/contract.cjs) — an AU shop on a July year: the screens must paint the server's year, never an April of their own.
 * Shots: e2e/shots/walk-x-r2r-NN.png (one per path) + e2e/shots/wx-r2r-<shop>-<width>-<view>.png (every view; fixture-<shop> in fixture mode). Findings: docs/testing/WX-R2R-2026-10-13.md.
 */
'use strict';
const path = require('path'), fs = require('fs'), cp = require('child_process'), net = require('net');
const W = require('./lib/walk.cjs');
const books = require('./lib/books-api.cjs');
const C = require('./lib/contract.cjs');

const REAL = process.argv.includes('--real');
const argOf = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const SHOP = String(argOf('shop', REAL ? 'IN' : 'AU')).toUpperCase();
const LOGIN = SHOP === 'AU' ? 'austores' : 'simstores';
const FIRST = SHOP === 'AU' ? 'Jul' : 'Apr', LAST = SHOP === 'AU' ? 'Jun' : 'Mar';
const SYM = SHOP === 'AU' ? 'A$' : '₹';
const TAG = (REAL ? '' : 'fixture-') + SHOP.toLowerCase();   /* the shots' name: a fixture run never overwrites the real stack's */
const API_DIR = process.env.CB_API_DIR || path.join(__dirname, '..', '..', 'chitbridge-api');
const SIM_DB = process.env.SIM_DB || 'postgres://postgres:pw@127.0.0.1:5432/cb_sim';
/* --at YYYY-MM-DD: the SERVER's "today" — the api's shop clock (lib/shop-clock.set, allowed only with SHOP_CLOCK_ALLOW=1 on this local stack).
   The loaded shop runs 2026 → 2029 and closes every month it holds; its open year starts after its last day, so a typed entry that SAVES needs
   the server's today inside that year (--at 2029-04-10 for IN, 2029-07-10 for AU). The browser keeps its own clock (a moved browser clock reads
   the real sign-in token as expired), so --at walks ONLY the entry's depth (D1a–D1c); the width and the other steps run without it. */
const AT = argOf('at', '');
const SHOTS = path.join(__dirname, 'shots');
const T = (s) => '[data-testid="' + s + '"]';
const VIEWS = ['todo', 'daybook', 'ledgers', 'tb', 'pl', 'bs', 'bank', 'receivables', 'payables', 'bills', 'cheques', 'waiting', 'lock', 'closingstock', 'assets', 'accruals', 'gstclose', 'yearclose', 'packs', 'opening', 'accounts'];
const WIDTHS = [[1366, 768], [390, 844]];
const BOOKS_FIRST = '2026-27';   /* the loader's (and the fixture's) first year of books: no year before it is ever offered */

const freePort = () => new Promise((res) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
const money = (t) => Number(String(t).replace(/[^0-9.\-]/g, ''));

/* ── the real api, spawned on the loaded database (killed in the finally) ── */
async function realApi(webBase) {
  const port = await freePort();
  const args = AT ? ['-e', "require('./lib/shop-clock').set(process.argv[1] + 'T04:30:00Z'); require('./server.js');", AT] : ['server.js'];
  const api = cp.spawn(process.execPath, args, { cwd: API_DIR, stdio: ['ignore', 'pipe', 'pipe'], env: Object.assign({}, process.env, {
    DATABASE_URL: SIM_DB, PORT: String(port), HOST: '127.0.0.1', NODE_ENV: 'development', DEV_OTP: '123456', ALLOWED_ORIGINS: webBase, RLS_GUARD: 'off',
    JWT_SECRET: 'walk-x-r2r-local-only-' + 'x'.repeat(24), SHOP_CLOCK_ALLOW: AT ? '1' : '', RATE_LIMIT_MAX: '1000000', BOOKS_NIGHTLY: '0', CRM_SWEEP: '0', LOG_LEVEL: 'warn' }) });
  let log = ''; api.stdout.on('data', (d) => { log += d; }); api.stderr.on('data', (d) => { log += d; });
  for (let i = 0; i < 80 && !/running on port/.test(log); i++) await new Promise((r) => setTimeout(r, 250));
  if (!/running on port/.test(log)) { api.kill(); throw new Error('the api did not start: ' + log.slice(-400)); }
  return { base: 'http://127.0.0.1:' + port, stop: () => api.kill() };
}

/* ── the fixture: an AU shop on a July year, in the server's own shapes ── */
async function fixture(ctx) {
  const AUD = { currency: 'AUD' };
  const S = { asked: [] };
  const year = { fiscal_year: '2026-27', from: '2026-07-01', start_month: 7 };
  const months = [];
  for (let p = 1; p <= 12; p++) { const m = ((6 + p - 1) % 12) + 1, y = m >= 7 ? 2026 : 2027, s = y + '-' + String(m).padStart(2, '0');
    months.push(Object.assign(books.periodRow('2026-27', p, p <= 2 ? 'soft_locked' : 'open'), { start_date: s + '-01', end_date: s + '-28', entries: p <= 3 ? 40 : 0, sales_minor: p <= 3 ? 500000 : 0,
      lock: { may: p === 3, why: p === 3 ? null : 'Lock the earlier months first.' }, reopen: { may: p === 2, why: null } })); }
  await ctx.route('**/api/**', async (r0) => {
    const r = C.wrap(r0), q = r.request(), u = new URL(q.url()), p = u.pathname; S.asked.push(q.method() + ' ' + p + u.search);
    const J = (st, b) => r.fulfill({ status: st, contentType: 'application/json', body: JSON.stringify(b) });
    if (p === '/api/books/health') return J(200, books.health(Object.assign({ year }, AUD)));
    if (p === '/api/books/periods') return J(200, books.periods(months));
    if (p === '/api/books/todo') return J(200, []);
    if (p === '/api/books/pl') { const from = u.searchParams.get('from') || year.from;
      if (from < year.from) return J(422, books.refusal('A profit and loss stays inside one fiscal year (' + from + ' → ' + (u.searchParams.get('to') || '') + ').'));
      return J(200, books.pl([{ code: '4000', name: 'Sales', amount_minor: 1541545 }], [{ code: '6010', name: 'Rent', amount_minor: 879500 }], Object.assign({ from }, AUD))); }
    if (p === '/api/books/trial-balance') return J(200, books.trialBalance([{ code: '1400', name: 'Cash', dr_minor: 1000000, cr_minor: 0 }, { code: '3000', name: 'Capital', dr_minor: 0, cr_minor: 1000000 }], AUD));
    if (p === '/api/books/daybook') return J(200, books.daybook([], Object.assign({ from: u.searchParams.get('from') || year.from, to: u.searchParams.get('to') || '2026-10-13' }, AUD)));
    if (p === '/api/books/year/2026-27/status' || /^\/api\/books\/year\/[^/]+\/status$/.test(p)) return J(200, { fiscal_year: p.split('/')[4], closed: false, can_close: false, can_close_if_lodged: false, refusals: [{ name: 'months_open', why: 'Every month must be locked before the year closes.' }], months: [{ period: 1, status: 'open' }], next: '2027-28' });
    if (p === '/api/books/attention') return J(200, {}); /* the Needs-attention strip's counts: none (marking off) — the daybook strip reads it */
    if (p === '/api/books/packs') return J(200, { packs: [] });
    if (p === '/api/books/dues') return J(200, books.dues([], AUD));
    if (p === '/api/books/cheques') return J(200, { cheques: [] });
    S.missed = (S.missed || []).concat(q.method() + ' ' + p);
    return J(404, { error: 'not in this walk' });
  });
  return S;
}

/* sign in through the page's own window (CBSignin) — the identity the loader printed, the DEV_OTP code */
async function signIn(page, base) {
  await page.goto(base + '/accounts.html#todo');
  await page.waitForSelector(T('signin-id'), { timeout: 20000 });
  await page.fill(T('signin-id'), LOGIN); await page.click(T('signin-go'));
  await page.waitForSelector(T('signin-code') + ',' + T('signin-choice'), { timeout: 20000 });
  if (await page.locator(T('signin-choice')).count()) { await page.locator(T('signin-choice')).first().click(); await page.waitForSelector(T('signin-code')); }
  await page.fill(T('signin-code'), '123456'); await page.click(T('signin-verify'));
  await page.waitForFunction(() => !document.querySelector('[data-testid="signin-window"]') || !!document.querySelector('[data-testid="signin-later"]'), null, { timeout: 20000 }).catch(() => {});
  if (await page.locator(T('signin-later')).count()) await page.click(T('signin-later'));
}
/** open a view the way the menu does (the hash), wait until it is not "Reading…" */
async function open(page, base, v) {
  await page.evaluate((v) => { location.hash = v; }, v);
  await page.waitForTimeout(400);
  await page.waitForFunction(() => !document.querySelector('.bk-skel,.loadwrap,[aria-busy="true"]'), null, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(REAL ? 900 : 300);
}
/** what the person reads in the content (the menu and the kural band left out) */
const content = (page) => page.evaluate(() => { const c = document.getElementById('content') || document.querySelector('main') || document.body; return c.innerText.replace(/[ \t]+/g, ' ').trim(); });
const sideways = (page) => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
const ERRWORDS = /could not|couldn.t|went wrong|failed to|unexpected|not in this walk|\bundefined\b|\bNaN\b|\[object/;

W.run('x-r2r', async (w) => {
  const { page, ctx, base } = w;
  let api = null, S = null;
  fs.mkdirSync(SHOTS, { recursive: true });
  try {
    if (REAL) { api = await realApi(base); await ctx.addInitScript((b) => { try { localStorage.setItem('cb_api_base', b); } catch (_) {} }, api.base); }
    else { S = await fixture(ctx); await ctx.addInitScript(() => { try { localStorage.setItem('cb_api_base', location.origin); } catch (_) {} }); }
    if (!REAL) await ctx.addInitScript((s) => { try { localStorage.setItem('cb_sess', s); } catch (_) {} }, W.session('Fixture Owner', 'Fixture Shop AU'));

    await w.step('R0', 'sign in as ' + (REAL ? LOGIN : 'the fixture AU owner') + ' → Accounts opens on To do', async () => {
      if (REAL) await signIn(page, base); else await page.goto(base + '/accounts.html#todo');
      await page.waitForSelector('#content', { timeout: 20000 }); await open(page, base, 'todo');
      const t = await content(page);
      const h1 = await page.locator('h1').first().innerText().catch(() => '');
      return { ok: /To do/.test(h1) && !ERRWORDS.test(t), saw: h1 + ' · ' + t.replace(/\n/g, ' | ').slice(0, 120) };
    });

    if (!AT) {
    /* ── WIDTH: every view, both widths ── */
    const seen = {};
    for (const [wd, ht] of (REAL ? WIDTHS : [[1366, 768], [390, 844]])) {
      await page.setViewportSize({ width: wd, height: ht });
      for (const v of (REAL ? VIEWS : ['daybook', 'tb', 'pl', 'lock', 'gstclose', 'yearclose', 'packs'])) {
        await w.step('W-' + wd + '-' + v, wd + 'px · ' + v + ' paints, no sideways scroll, no error', async () => {
          await open(page, base, v);
          const t = await content(page), side = await sideways(page);
          seen[wd + v] = t;
          await page.screenshot({ path: path.join(SHOTS, 'wx-r2r-' + TAG + '-' + wd + '-' + v + '.png') });
          const bad = ERRWORDS.exec(t);
          return { ok: !side && !bad && t.length > 10 && w.errs.length === 0, saw: (side ? 'SIDEWAYS SCROLL · ' : '') + (bad ? 'says "' + bad[0] + '" · ' : '') + (w.errs.length ? 'page error: ' + w.errs[0] + ' · ' : '') + t.replace(/\n/g, ' | ').slice(0, 140) };
        });
      }
    }
    await page.setViewportSize({ width: 1366, height: 768 });

    /* ── what the screens SAY about the shop's year and money (the AU July year; India April) ── */
    await w.step('Y1', 'Day book opens on the shop\'s year: the period chip starts 1 ' + FIRST, async () => {
      await open(page, base, 'daybook'); const t = await content(page);
      return { ok: new RegExp('\\b1 ' + FIRST + '\\b').test(t), saw: (t.match(/\d{1,2} \w{3} – \d{1,2} \w{3} \d{4}/) || ['(no period chip)'])[0] };
    });
    await w.step('Y2', 'P&L shows a result for this year — never "stays inside one fiscal year"', async () => {
      await open(page, base, 'pl'); const t = await content(page);
      return { ok: !/stays inside one fiscal year/i.test(t) && /(Profit|Loss)/.test(t), saw: t.replace(/\n/g, ' | ').slice(0, 160) };
    });
    await w.step('Y3', 'Month lock names month 1 "' + FIRST + '" and month 12 "' + LAST + '"; its figures are in ' + SYM, async () => {
      await open(page, base, 'lock');
      const m1 = (await page.locator(T('lk-row-1') + ' th').first().innerText().catch(() => '')).trim(), m12 = (await page.locator(T('lk-row-12') + ' th').first().innerText().catch(() => '')).trim();
      const figs = await page.$$eval('[data-testid^="lk-row-"] .lk-sales', (a) => a.map((x) => x.innerText).join(' '))   /* dc25019a: Month lock is one table - the month is the row head, its sales a cell of its own */;
      const symOk = (figs.match(/A\$|₹|\$/g) || []).every((x) => x === SYM);   /* every money figure the months show is in the shop's money (a month with no sales shows none) */
      return { ok: m1 === FIRST && m12 === LAST && symOk, saw: m1 + ' … ' + m12 + ' · ' + (figs.slice(0, 60) || 'no figures') };
    });
    await w.step('Y4', 'Packs offers "Whole year (' + FIRST + '–' + LAST + ')"', async () => {
      await open(page, base, 'packs'); const o = await page.$$eval(T('pk_p') + ' option', (a) => a.map((x) => x.textContent)).catch(() => []);
      return { ok: o.some((x) => x === 'Whole year (' + FIRST + '–' + LAST + ')'), saw: o.slice(0, 3).join(' · ') };
    });
    await w.step('Y5', 'Year close opens on a year the books hold — never a year before they began', async () => {
      await open(page, base, 'yearclose'); const fy = await page.locator('#py_fy').inputValue().catch(() => ''); const t = await content(page);
      const yrs = await page.$$eval('#py_fy option', (a) => a.map((x) => x.value)).catch(() => []);
      return { ok: !!fy && yrs.every((y) => y >= BOOKS_FIRST), saw: 'year ' + fy + ' of [' + yrs.join(', ') + '] · ' + t.replace(/\n/g, ' | ').slice(0, 100) };
    });
    await w.step('Y6', 'GST close defaults to last month in the shop\'s year', async () => {
      await open(page, base, 'gstclose'); const p = await page.locator('#pg_p').inputValue().catch(() => ''), fy = await page.locator('#pg_fy').inputValue().catch(() => '');
      const lbl = await page.$eval('#pg_p', (s) => s.options[s.selectedIndex].textContent).catch(() => '');
      /* T2-WEBPRIMS: last month in the PAGE's own words (helpers.js monthNames → CBLocale: en-IN writes "Sept"), never a list typed here */
      const want = await page.evaluate(() => { const d = new Date(); d.setDate(0); return monthNames('short')[d.getMonth()]; }).catch(() => '');   /* clock-ok: runs in the page, whose clock is CB_TODAY */
      return { ok: lbl === want, saw: fy + ' · month ' + p + ' = ' + lbl + ' (last month is ' + want + ')' };
    });

    if (!REAL) {
      await w.step('F1', 'every read asked the server with the shop\'s year (from ' + '2026-07-01' + ' — never 2026-04-01)', async () => {
        const bad = S.asked.filter((a) => /from=2026-04-01/.test(a));
        return { ok: !bad.length, saw: bad.length ? bad.slice(0, 2).join(' · ') : S.asked.filter((a) => /from=/.test(a)).slice(0, 2).join(' · ') || 'no ranged read' };
      });
      return;
    }

    /* ── DEPTH (real) ── */
    await w.step('D6a', 'Trial balance: the Total row has Debit = Credit on screen', async () => {
      await open(page, base, 'tb'); const t = await content(page);
      const m = /Total\s+([^\s]+[\d,.]+)\s+([^\s]+[\d,.]+)/.exec(t);
      return { ok: !!m && money(m[1]) === money(m[2]) && money(m[1]) > 0, saw: m ? 'Dr ' + m[1] + ' · Cr ' + m[2] : t.slice(-120) };
    });
    await w.step('D6b', 'a Trial balance line opens the ledger it counts (Cash) — and the ledger\'s closing is the TB\'s figure', async () => {
      await open(page, base, 'tb');
      const want = (await page.locator('tr', { has: page.locator(T('tb-open-1400')) }).first().locator('td.num').first().innerText().catch(() => '')).trim();
      await page.click(T('tb-open-1400')); await page.waitForSelector(T('drill-all-1400'), { timeout: 10000 }); /* ACC-357: the line opens its entries below; Open all goes on to the ledger */ await page.click(T('drill-all-1400')); await page.waitForTimeout(REAL ? 3500 : 1200);
      const h = await page.evaluate(() => location.hash), t = await content(page);
      const closing = (/Closing\s+([^\s·]*[\d,.]+)/.exec(await page.evaluate(() => document.body.innerText)) || [, ''])[1];
      return { ok: h === '#ledgers' && !!want && money(closing) === money(want), saw: 'TB Cash ' + want + ' · the Cash ledger says Closing ' + (closing || '(none)') };
    });
    await w.step('D6c', 'Balance sheet: the two Totals agree on screen', async () => {
      await open(page, base, 'bs'); const t = await content(page);
      const tots = (t.match(/Total\s+-?[^\s\d-]*-?[\d,.]+/g) || []).map((x) => money(x.replace(/^Total\s+/, '')));
      return { ok: tots.length >= 2 && tots[0] === tots[tots.length - 1], saw: tots.join(' · ') };
    });
    await w.step('D2', 'step 2 day close: the Day book carries the counter\'s posted walk-in days', async () => {
      await open(page, base, 'daybook'); const t = await content(page);
      const n = (t.match(/Walk-in day/g) || []).length;
      return { ok: n > 0, saw: n + ' walk-in day rows on the first page' + (SHOP === 'AU' ? ' (AU: the engine does not fold the GST head — see E1)' : '') };
    });
    }
    if (!AT) w.note('D1b', 'the entry that saves and its reversal', 'the server\'s today is in a closed month — run again with --at <a day in the open year> for D1a–D1c');
    {
    await w.step('D1a', 'step 1 an entry: ＋ Entry → Pay expense → Rent, cash, dated in a CLOSED month → the server refuses in words, with its fix (and nothing else)', async () => {
      await open(page, base, 'daybook'); await page.click(T('db-add')); await page.waitForSelector(T('en-event-expense'), { timeout: 15000 });
      await page.click(T('en-event-expense')); await page.selectOption(T('en-f-class'), 'rent'); await page.click(T('en-next'));
      await page.waitForTimeout(800);
      if (await page.locator(T('en-f-paid_from')).count()) await page.selectOption(T('en-f-paid_from'), { index: 1 }).catch(() => {});
      await page.fill(T('en-f-amount'), '123');
      await page.fill(T('en-f-date'), SHOP === 'AU' ? '2026-08-15' : '2026-06-15').catch(() => {});   /* a month the loader closed for good */
      await page.click(T('en-next')).catch(() => {}); await page.waitForTimeout(2500);
      const t = await page.evaluate(() => (document.getElementById('entrysheet') || {}).innerText || '');
      await page.screenshot({ path: path.join(SHOTS, 'wx-r2r-' + TAG + '-entry-closed.png') });
      return { ok: /closed|locked/i.test(t) && /(open|month|lock|date)/i.test(t) && !/do not match/.test(t), saw: t.replace(/\n/g, ' | ').slice(0, 220) };
    });
    let entryNo = '';
    if (AT) {
    await w.step('D1b', '…dated in the open year it balances and saves; the Day book shows it', async () => {
      const r = await page.evaluate(() => fetch(localStorage.getItem('cb_api_base') + '/api/books/periods', { headers: { Authorization: 'Bearer ' + JSON.parse(localStorage.getItem('cb_sess')).token } }).then((x) => x.json()));
      const open1 = (r.periods || []).filter((x) => x.status === 'open' && x.period >= 1).sort((a, b) => String(a.start_date).localeCompare(String(b.start_date)))[0];
      if (!open1) return { ok: false, saw: 'no open month in the books' };
      const day = String(open1.start_date).slice(0, 10);
      if (await page.locator(T('en-back')).count()) await page.click(T('en-back')).catch(() => {});
      await page.waitForTimeout(500);
      await page.fill(T('en-f-date'), day).catch(() => {});
      await page.click(T('en-next')).catch(() => {}); await page.waitForTimeout(2500);
      const pv = await page.evaluate(() => (document.getElementById('entrysheet') || {}).innerText || '');
      if (!(await page.locator(T('en-save')).isEnabled().catch(() => false))) return { ok: false, saw: 'Save not offered: ' + pv.replace(/\n/g, ' | ').slice(0, 200) };
      await page.click(T('en-save')); await page.waitForSelector(T('en-saved') + ',' + T('en-err'), { timeout: 15000 });
      const t = await page.evaluate(() => (document.getElementById('entrysheet') || {}).innerText || '');
      entryNo = (t.match(/[A-Z]{2}\/\d{4}-\d{2}\/\d+/) || [''])[0];
      await page.screenshot({ path: path.join(SHOTS, 'wx-r2r-' + TAG + '-entry-saved.png') });
      return { ok: !!entryNo, saw: day + ' · ' + t.replace(/\n/g, ' | ').slice(0, 160) };
    });
    await w.step('D1c', '…Reverse this entry (with a reason) adds the mirror; the Day book row says "Reversed by" — the trail shows both', async () => {
      if (!entryNo) return { ok: false, saw: 'no entry to reverse' };
      await page.click(T('en-reverse-now')); await page.waitForSelector(T('en-reason'), { timeout: 10000 });
      await page.fill(T('en-reason'), 'walk: typed by mistake'); await page.click(T('confirm-ok'));
      await page.waitForTimeout(3000);
      const said = await page.evaluate(() => (document.body.innerText.match(/Reversed[^\n]*/) || [''])[0]);
      /* the Day book on the open year's days (its own Custom period — what a person picks in the chip) */
      await page.evaluate((to) => { BK.dbp = bkDbPeriod('custom', { from: to.slice(0, 8) + '01', to: to }); }, AT); await open(page, base, 'todo'); await open(page, base, 'daybook');
      const t = await content(page);
      await page.screenshot({ path: path.join(SHOTS, 'wx-r2r-' + TAG + '-entry-reversed.png') });
      return { ok: /Reversed/.test(said) && t.indexOf(entryNo) >= 0 && /Reversed by/.test(t), saw: said.slice(0, 90) + ' · day book: ' + (t.match(/Reversed by[^|\n]*/) || ['no "Reversed by"'])[0] };
    });
    }
    }
    if (!AT) {
    await w.step('D3', 'step 3 Month lock: the open year\'s first month — Lock is greyed WITH the server\'s sentence when it may not', async () => {
      if (await page.locator('#entrysheet[open]').count()) await page.keyboard.press('Escape');
      await open(page, base, 'lock'); const yrs = await page.$$eval(T('lk_fy') + ' option', (a) => a.map((x) => x.value));
      await page.selectOption(T('lk_fy'), yrs[0]); await page.waitForTimeout(800);
      const b = page.locator(T('lk-lock-1')); if (!(await b.count())) return { ok: true, saw: yrs[0] + ' month 1 is not open (no Lock to offer)' };
      const dis = await b.isDisabled(), why = await page.locator(T('lk-why-1')).innerText().catch(() => '');
      return { ok: !dis || !!why, saw: yrs[0] + ' · ' + (dis ? 'greyed: ' + why : 'may lock') };
    });
    await w.step('D4', 'step 4 GST close: Close the month on a closed month says what happened', async () => {
      await open(page, base, 'gstclose'); await page.click(T('pg-close')).catch(() => {}); await page.waitForTimeout(3000);
      const t = (await page.locator('#pg_out').innerText().catch(() => '')) + ' ' + (await page.locator('#pg_res').innerText().catch(() => ''));
      return { ok: t.trim().length > 0 && !ERRWORDS.test(t), saw: t.replace(/\n/g, ' | ').slice(0, 200) };
    });
    await w.step('D5', 'step 5 Year close: the first loaded year reads closed', async () => {
      await open(page, base, 'yearclose'); const yrs = await page.$$eval('#py_fy option', (a) => a.map((x) => x.value)).catch(() => []);
      const first = yrs.slice().sort()[0]; await page.selectOption('#py_fy', first).catch(() => {}); await page.waitForTimeout(2000);
      const t = await content(page);
      return { ok: /closed/i.test(t) && !/not locked/i.test(t), saw: first + ' · ' + t.replace(/\n/g, ' | ').slice(0, 140) };
    });
    await w.step('D7', 'Waiting: nothing is left unposted (the outbox the loader proved)', async () => {
      await open(page, base, 'waiting'); const t = await content(page);
      return { ok: /Nothing is waiting/.test(t), saw: t.replace(/\n/g, ' | ').slice(0, 160) };
    });
    }
    w.note('V1', 'a view-only login (co-assist) sees each refusal', 'the loader mints no co-assist and the api\'s invite needs a second signed-in person — not walked; see the findings file');
  } finally { if (api) api.stop(); }
});
