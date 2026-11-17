#!/usr/bin/env node
/**
 * e2e/walk-mis-overview.cjs — THE OWNER'S MIS, WALKED ON THE REAL STACK (MIS3, 17 Nov 2026): accounts.html#overview (How we are doing, app/cap-books-overview.js)
 * and finance.html#/reports/pictures (app/cap-mis-pictures.js) over a throwaway Postgres holding a 7-year shop (tools/sim-load.cjs --months 84).
 *
 * Proves: every tile and bar the screen paints equals the figure the server sent (the page adds nothing), and the server's figures equal an independent SQL
 * (written here from the SOLD rule: Dr − Cr on cash · upi · card · bank · debtors over the day-kind entries, reversals out; the P&L from income and expense accounts);
 * the weekday chart (this ISO week against the same week last year); no sideways scroll, AA contrast, no clipping in Cream and Dark at 1366 and 390 (rule 13);
 * the first data inside the ceiling; GET /overview p95 at 7 years of books.
 * ⚠️ LOCAL ONLY: needs CB_REAL_DB (a localhost database) and CB_API_DIR (the api checkout); the api is started by e2e/lib/real-stack.cjs, NODE_OPTIONS may preload a clock
 * (the history ends 31 Oct 2026, so a walk sets the clock inside it). The web calls ONLY that api (localStorage cb_api_base). No code or token is printed or written.
 *   CB_REAL_DB=postgres://… CB_API_DIR=../chitbridge-api MIS_ENTITY_EMAIL=name@test.example node e2e/walk-mis-overview.cjs [--shots dir]
 */
'use strict';
const path = require('path'), fs = require('fs');
const { chromium } = require('playwright');
const S = require('./lib/serve.cjs'), R = require('./lib/real-stack.cjs');
const { measure } = require('./lib/theme-measure.cjs'), { audit } = require('./lib/rule13.cjs');

const DB = process.env.CB_REAL_DB, EMAIL = process.env.MIS_ENTITY_EMAIL || 'misthree@test.example';
const SHOTS = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : '';
const FIRST_DATA_MS = 2500, P95_MS = 1500, REPEAT = 25;
let failures = 0;
const check = (ok, words) => { console.log((ok ? '  ok   ' : '  FAIL ') + words); if (!ok) failures++; };
const get = (api, token, p) => R.j ? R.j(api + p, { token }) : null;

/** SQL, written from the rule and not from the api's code: SOLD of a date range (minor units), tax in */
const SOLD_SQL = `SELECT COALESCE(SUM(l.dr_minor - l.cr_minor), 0)::bigint AS v FROM journal_entry h JOIN journal_line l ON l.entry_id = h.entry_id AND l.entity_id = h.entity_id JOIN ledger_account a ON a.account_id = l.account_id
  WHERE h.entity_id = $1 AND h.event_type IN ('walkin_day','sale_bill','credit_given','return') AND h.reverses_entry_id IS NULL AND h.posting_date BETWEEN $2::date AND $3::date
    AND NOT EXISTS (SELECT 1 FROM journal_entry r WHERE r.entity_id = h.entity_id AND r.reverses_entry_id = h.entry_id) AND a.role IN ('cash','upi','card','bank','debtors')`;
/** profit of a range: income (Cr − Dr) less expense (Dr − Cr) over every posted entry of the range */
const PROFIT_SQL = `SELECT COALESCE(SUM(CASE WHEN a.nature = 'income' THEN l.cr_minor - l.dr_minor WHEN a.nature = 'expense' THEN l.cr_minor - l.dr_minor ELSE 0 END), 0)::bigint AS v
  FROM journal_entry h JOIN journal_line l ON l.entry_id = h.entry_id AND l.entity_id = h.entity_id JOIN ledger_account a ON a.account_id = l.account_id
  WHERE h.entity_id = $1 AND h.posting_date BETWEEN $2::date AND $3::date AND a.nature IN ('income','expense')`;
const lastDay = (month) => { const [y, m] = month.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };

(async () => {
  if (!DB) { console.log('SKIP: CB_REAL_DB not set (this walk needs a local Postgres holding the 7-year shop)'); process.exit(0); }
  const { Client } = require(path.join(process.env.CB_API_DIR || '', 'node_modules', 'pg'));
  const web = await S.serve(), stack = await R.up({ webBase: web.url('') }), api = stack.api;
  const owner = await R.signIn(api, EMAIL), token = owner.token;
  const db = new Client({ connectionString: DB }); await db.connect();
  /* the api's own door: every table is row-level-secured on app.current_entity, so a read names the shop the way the api does (BEGIN · set_config · the query) — a bare read as the api's role sees no row */
  const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
  const entity = claims.entity_id || claims.identity_id;   /* an entity's identity id is its entity id */
  const one = async (sql, args) => {
    await db.query('BEGIN');
    try { await db.query("SELECT set_config('app.current_entity', $1, true)", [String(entity)]); return Number((await db.query(sql, [entity].concat(args))).rows[0].v); } finally { await db.query('ROLLBACK'); }
  };
  const browser = await chromium.launch(), ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  /* the browser keeps the api's clock: a token is signed with the api's moment (iat), so a page on the real clock reads it as expired (the history ends 31 Oct, the api may run inside it). Read the moment from the token, install it, let it tick. */
  const apiMs = Number(claims.iat) * 1000;
  if (isFinite(apiMs) && Math.abs(apiMs - Date.now()) > 60000) await ctx.clock.install({ time: apiMs });   // clock-ok: compared with the api's moment
  await ctx.addInitScript((a) => { try { localStorage.setItem('cb_api_base', a.api); localStorage.setItem('cb_sess', a.s); } catch (_) {} }, { api, s: owner.session });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));
  const outside = []; page.on('request', (r) => { const u = r.url(); if (!/^(http:\/\/127\.0\.0\.1|data:|about:|https:\/\/fonts\.(googleapis|gstatic)\.com\/)/.test(u)) outside.push(u.slice(0, 80)); });

  /* ── the server's figures against SQL ── */
  const ov = (await get(api, token, '/api/books/overview?period=ytd')).b;
  const week = (await get(api, token, '/api/books/overview?period=week')).b;
  const dues = (await get(api, token, '/api/books/dues')).b;
  check(ov.currency === 'AUD' && ov.bars.length === 12 && ov.weekdays.length === 7, 'overview answers: 12 bars, 7 weekdays, ' + ov.currency);
  check(ov.sales.minor === await one(SOLD_SQL, [ov.period.from, ov.period.to]), 'sales ytd ' + ov.period.from + '..' + ov.period.to + ' = SQL (' + ov.sales.minor + ')');
  const bar = ov.bars[8], lastYearBar = ov.bars[8];
  check(bar.sold_minor === await one(SOLD_SQL, [bar.from, bar.to]), 'bar ' + bar.from + ' = SQL (' + bar.sold_minor + ')');
  const from1 = (d) => (Number(d.slice(0, 4)) - 1) + d.slice(4);
  check(lastYearBar.last_year_minor === await one(SOLD_SQL, [from1(lastYearBar.from), from1(lastYearBar.to)]), 'same month last year ' + from1(lastYearBar.from) + ' = SQL (' + lastYearBar.last_year_minor + ')');
  const wd = week.weekdays.find((d) => d.sold_minor !== null);
  check(!!wd && wd.sold_minor === await one(SOLD_SQL, [wd.day, wd.day]) && wd.last_year_minor === await one(SOLD_SQL, [wd.last_year_day, wd.last_year_day]), 'weekday ' + (wd && wd.day) + ' and last year ' + (wd && wd.last_year_day) + ' = SQL (' + (wd && wd.sold_minor) + ' / ' + (wd && wd.last_year_minor) + ')');
  const pm = ov.profit_by_month[8];
  check(pm.profit_minor === await one(PROFIT_SQL, [pm.from, pm.to]), 'profit ' + pm.from + ' = SQL (' + pm.profit_minor + ')');
  const owed = await one(`SELECT COALESCE(SUM(l.dr_minor - l.cr_minor),0)::bigint AS v FROM journal_line l JOIN ledger_account a ON a.account_id = l.account_id WHERE l.entity_id = $1 AND a.role = 'debtors'`, []);
  check(ov.to_collect.minor === owed, 'to collect = SQL debtors balance (' + owed + ')');
  check(JSON.stringify(ov.aged_totals) === JSON.stringify(dues.aged_totals), 'owed/you-owe by age = the /dues object, key for key');
  check(ov.cash && ov.cash.series.length === 30, 'cash has 30 days');

  /* ── p95 at 7 years ── */
  const times = [], trips = [];
  for (let i = 0; i < REPEAT; i++) {
    const t0 = Date.now(); /* clock-ok: elapsed ms, not a day */ const r = await fetch(api + '/api/books/overview?period=ytd', { headers: { authorization: 'Bearer ' + token } }); await r.arrayBuffer();
    times.push(Date.now() - t0);   // clock-ok: elapsed ms trips.push(r.headers.get('x-db-trips'));
  }
  times.sort((a, b) => a - b);
  const p95 = times[Math.ceil(times.length * 0.95) - 1];
  console.log('  info GET /overview ytd x' + REPEAT + ': p50 ' + times[Math.floor(times.length / 2)] + ' ms · p95 ' + p95 + ' ms · max ' + times[times.length - 1] + ' ms · X-DB-Trips ' + [...new Set(trips)].join(','));
  check(p95 <= P95_MS, 'p95 ' + p95 + ' ms within the ' + P95_MS + ' ms ceiling');

  /* ── the overview, painted ── */
  const fmt = (minor) => page.evaluate(([m, c]) => bkMoney(m, c), [minor, ov.currency]);
  let shot = 0;
  const snap = async (name) => { if (SHOTS && shot < 10) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, name + '.png'), fullPage: true }); shot++; } };
  for (const theme of ['cream', 'dark']) {
    for (const width of [1366, 390]) {
      await page.setViewportSize({ width, height: width > 500 ? 768 : 844 });
      const t0 = Date.now();   // clock-ok: elapsed ms
      await page.goto(web.url('/accounts.html#overview'));
      await page.evaluate((t) => { try { localStorage.setItem('cb_theme', t); } catch (_) {} }, theme);
      await page.waitForSelector('[data-testid="ov-headline"]', { timeout: 20000 });
      const first = Date.now() - t0;   // clock-ok: elapsed ms
      await page.evaluate((t) => { CBAvatar.applyTheme(t); }, theme); await page.waitForTimeout(250);
      const tag = theme + '·' + width;
      if (theme === 'cream' && width === 1366) check(first <= FIRST_DATA_MS, 'first data (headline) in ' + first + ' ms, ceiling ' + FIRST_DATA_MS);
      const cards = await page.$$eval('.ov-pic', (n) => n.map((x) => x.dataset.testid));
      check(['ov-pic-sales', 'ov-pic-weekday', 'ov-pic-profit', 'ov-pic-owed', 'ov-pic-owe', 'ov-pic-cashline'].every((c) => cards.includes(c)), tag + ' six picture cards: ' + cards.join(' '));
      check(await page.$('[data-testid="ov-item-note"]') !== null, tag + ' profit per item says it is not shown');
      const pairs = await page.evaluate(measure), bad = pairs.filter((x) => !x.grad && x.ratio < x.need), a = await audit(page, 'ov_main');
      const fails = [].concat(bad.map((x) => 'contrast ' + x.ratio + ' "' + x.text + '"'), a.clip.map((x) => 'clipped ' + x), a.scroll.map((x) => 'scroll ' + x), a.cover.map((x) => 'covered ' + x));
      check(!fails.length, tag + ' rule 13: ' + pairs.length + ' texts, no sideways scroll/clip/cover' + (fails.length ? ' · ' + fails.slice(0, 3).join(' | ') : ''));
      if (theme === 'cream' && width === 1366) {
        /* what is painted = what the server sent (formatted, never summed) */
        const sales = await page.textContent('[data-testid="ov-sales"] .ov-v');
        check(sales === await fmt(ov.sales.minor), 'tile Sales = server ' + ov.sales.minor + ' → "' + sales + '"');
        const rows = await page.$$eval('[data-testid="ov-pic-sales"] details tbody tr', (n) => n.map((r) => [...r.cells].map((c) => c.textContent)));
        const newest = rows[rows.length - 1];
        check(newest[1] === await fmt(ov.bars[11].sold_minor), 'sales table newest month = server bar ' + ov.bars[11].sold_minor);
        const wrows = await page.$$eval('[data-testid="ov-pic-weekday"] details tbody tr', (n) => n.map((r) => [...r.cells].map((c) => c.textContent)));
        const monday = week.weekdays[0];
        check(wrows.length === 7, 'weekday table has 7 rows');
        const owedRow = await page.$$eval('[data-testid="ov-pic-owed"] details tbody tr', (n) => n.map((r) => [...r.cells].map((c) => c.textContent)));
        check(owedRow.length === 5, 'owed by age table has 5 age rows');
        const cashWords = await page.textContent('[data-testid="ov-pic-cashline-legend"]');
        /* the page writes the sentence's money in the page's one format (8c5ca4f5: A$ for AUD); the server's own sentence says "AUD 1.00" */
        check(cashWords === String(ov.cash.words).replace(/\bAUD\s+/g, 'A$'), 'cash words = the server sentence (AUD 1.00 read as A$1.00)');
      }
      await snap('overview-' + tag);
    }
  }
  /* ── the sales-bar hatch and no-colour-alone: the running month's bar is hatched ── */
  const hatched = await page.$$eval('[data-testid="ov-sales-bar-' + ov.bars[11].from + '"]', (n) => n.map((x) => x.dataset.state));
  check(hatched.length === 1 && hatched[0] === 'partial', 'the running month bar is hatched (partial)');

  /* ── Reports › Pictures ── */
  for (const theme of ['cream', 'dark']) {
    for (const width of [1366, 390]) {
      await page.setViewportSize({ width, height: width > 500 ? 768 : 844 });
      await page.goto(web.url('/finance.html#/reports/pictures'));
      await page.waitForSelector('[data-testid="pc-cash-box"] svg, [data-testid="pc-cash-none"], [data-testid="pc-cash-error"]', { timeout: 20000, state: 'attached' });
      await page.waitForTimeout(600);
      const states = await page.$$eval('[data-testid$="-box"]', (n) => n.map((b) => b.dataset.testid + ':' + (b.querySelector('svg') ? 'svg' : b.querySelector('[data-testid$="-error"]') ? 'ERROR' : 'words')));
      check(!states.some((x) => /ERROR/.test(x)) && states.length === 5, 'pictures ' + theme + '·' + width + ' five cards, none failed: ' + states.join(' '));
      /* UX-137 register: every card and chart of the Pictures page wears its FIN008 code on the element a person sees (P01-P05 the cards, P06-P10 their charts), and the period buttons (FIN008-B03) have a name a reader hears */
      const FIN008 = { 'FIN008-P01': 'pc-sales', 'FIN008-P02': 'pc-owed', 'FIN008-P03': 'pc-owe', 'FIN008-P04': 'pc-cash', 'FIN008-P05': 'pc-pl', 'FIN008-P06': 'pcs-chart', 'FIN008-P07': 'pcowed', 'FIN008-P08': 'pcowe', 'FIN008-P09': 'pcpl', 'FIN008-P10': 'pcc' };
      const worn = await page.evaluate((m) => Object.keys(m).filter((c) => { const n = document.querySelector('[data-testid="' + m[c] + '"]'); return !n || n.getAttribute('data-cbsid') !== c; }), FIN008);
      check(worn.length === 0, 'pictures ' + theme + '·' + width + ' FIN008-P01..P10 each on its card or chart' + (worn.length ? ' MISSING ' + worn.join(' ') : ''));
      const named = await page.evaluate(() => Array.from(document.querySelectorAll('[data-cbsid="FIN008-B03"]')).map((b) => (b.getAttribute('aria-label') || b.textContent || '').trim()));
      check(named.length === 3 && named.every((x) => x.length > 0), 'pictures ' + theme + '·' + width + ' FIN008-B03 three period buttons (Weeks, Months, Years), each with a name: ' + named.join(' / '));
      await page.evaluate((t) => { CBAvatar.applyTheme(t); }, theme); await page.waitForTimeout(300);
      const tag = 'pictures·' + theme + '·' + width;
      const pairs = await page.evaluate(measure), bad = pairs.filter((x) => !x.grad && x.ratio < x.need), a = await audit(page, 'screen');
      const fails = [].concat(bad.map((x) => 'contrast ' + x.ratio + ' "' + x.text + '"'), a.scroll.map((x) => 'scroll ' + x), a.clip.map((x) => 'clipped ' + x));
      check(!fails.length, tag + ' rule 13' + (fails.length ? ' · ' + fails.slice(0, 3).join(' | ') : ''));
      await snap('pictures-' + tag);
    }
  }
  check(!errors.length, 'no page errors' + (errors.length ? ': ' + errors[0] : ''));
  check(!outside.length, 'the page called nothing outside this rig' + (outside.length ? ': ' + outside[0] : ''));
  await browser.close(); await db.end(); stack.stop(); web.close();
  console.log('\n' + (failures ? failures + ' FAILED' : 'ALL PASS'));
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.log('ERROR ' + (e && e.stack)); process.exit(1); });
