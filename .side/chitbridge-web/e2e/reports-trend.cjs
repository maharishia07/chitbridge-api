#!/usr/bin/env node
/**
 * e2e/reports-trend.cjs — CB FINANCE › REPORTS › TREND, WALKED (RPT2: finance.html#/reports/trend + app/cap-mis-trend.js + engine/chart-draw.js).
 * Sales by week · month · quarter · year, each beside the same period last year — every figure the SERVER's (GET /api/till/summary?compare=1).
 * Planted, like e2e/index-page.cjs: the site is served from this checkout (lib/walk.cjs), the API is a stand-in answering inside the page, and its
 * slots are built by the REAL engine (public/engine/rollup.js → rollup.series) over planted summary chits — so the page is held to the engine's
 * own shape, not to a hand-typed copy. A FIXTURE shop in Australia (its year starts in July, its money AUD); the clock is fixed (NOW).
 * Proves: the four tabs read the server once each and draw its slots (12 · 52 · 8 · 7 bars); the headline is the newest CLOSED period vs last
 * year; a change the engine gave as null is "—" (never 0%); a short year is hatched and says "11 of 12 months"; a period before the first record
 * says "not on CB yet"; the running one says so; the shop with no country is sent to Country setup; it only READS; Rule 13 (Cream + Dark × 1366 + 390).
 *
 *   NODE_PATH=$PWD/e2e/node_modules node e2e/reports-trend.cjs          headless
 *   node e2e/reports-trend.cjs --show                                     headed, a caption per step
 */
'use strict';
const path = require('path');
const W = require('./lib/walk.cjs');
const C = require('./lib/contract.cjs');   /* every stand-in answer for a contract route is held to the API's shape (M43) */
const R = require(path.join(__dirname, '..', 'public', 'engine', 'rollup.js'));
const J = (route, status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

const NOW = new Date('2026-10-17T10:00:00+10:00');   /* a Saturday in Sydney; October is FY 2026-27's fourth month */
const FY_START = 7, CURRENCY = 'AUD';
/** the month k months before NOW's month, as its key */
const monthBack = (k) => { const d = new Date(Date.UTC(2026, 9 - k, 1)); return d.toISOString().slice(0, 7); };
const daysOf = (month, upTo) => { const [y, m] = month.split('-').map(Number); const n = upTo || new Date(Date.UTC(y, m, 0)).getUTCDate(); return Array.from({ length: n }, (_, i) => month + '-' + String(i + 1).padStart(2, '0')); };
const summary = (period, key, gross, source) => ({ period, key, till: { id: 'C1' }, source: source || undefined,
  totals: { count: 20, returns: 0, gross, refunds: 0, expenseCount: 0, expenses: 0, total: gross - 50, by: {} } });

/**
 * the planted history: months Aug 2025 … Sep 2026 (the first, Aug 2025, only from the 20th — a short month); September 2026 sold 1,100 against
 * September 2025's 1,000 (+10%); the ten weeks before this one sold 300 each against 250 the same weeks last year (+20%).
 */
const SUMMARIES = [];
for (let k = 1; k <= 14; k++) SUMMARIES.push(summary('month', monthBack(k), k === 1 ? 1100 : 1000, k === 14 ? daysOf(monthBack(14)).slice(19) : daysOf(monthBack(k))));
for (let i = 1; i <= 10; i++) {
  const wk = R.weekKey(new Date(NOW.getTime() - i * 7 * 86400000));
  SUMMARIES.push(summary('week', wk, 300), summary('week', R.lastYearKey('week', wk), 250));
}
const N = { week: 52, month: 12, quarter: 8, year: 7 };
const answerFor = (period) => ({ period, n: N[period], currency: CURRENCY, fy_start_month: FY_START,
  slots: R.series(period, N[period], SUMMARIES, { fyStart: FY_START, currency: CURRENCY, now: NOW.getTime() }),
  /* lib/till-summary.js: where the sales came from, and the words when the books could not be read - this stand-in serves the counters' day summaries only (wording as in the contract's example) */
  sales_from: 'summaries', sales_note: 'The books are not switched on for this shop, so these sales are the counter day summaries only.' });

W.run('reports-trend', async (w) => {
  const { page, ctx, base } = w;
  const S = { mode: 'ok', asked: [], writes: [] };
  await ctx.route('**/api/**', async (raw) => {
    const route = C.wrap(raw);
    const q = route.request(), u = new URL(q.url()), p = u.pathname;
    if (q.method() !== 'GET' && !/^\/api\/events\/ticket$/.test(p)) S.writes.push(q.method() + ' ' + p);
    if (p === '/api/till/summary' && u.searchParams.get('compare') === '1') {
      S.asked.push(u.searchParams.get('period'));
      if (S.mode === 'nocountry') return J(route, 422, { error: 'Set the shop country first. The books never open on a guess.', code: 'NO_COUNTRY', message: 'Set the shop country first. The books never open on a guess.', type: 'https://chitbridge.com/problems/no_country', title: 'No country set', status: 422, detail: 'Set the shop country first. The books never open on a guess.', hint: 'Set the country in Country setup.', request_id: null });
      return J(route, 200, answerFor(u.searchParams.get('period')));
    }
    /* the Till card's teaser on Home: 8 weeks' sales (minor, oldest first, null = no record) and the engine's change vs last year */
    if (p === '/api/facts/till') return J(route, 200, { lines: [{ text: '12 bills · {money}', value: 12, money: { amount: 4280, currency: CURRENCY } }],
      figures: { counters_open: 1, trend: { spark: [30000, 28000, null, 31000, 30000, 29000, 30000, null], vs_last_year_pct: 12 } } });
    if (p === '/api/entities/me') return J(route, 200, { entity: { display_name: 'Fixture Shop', currency_code: CURRENCY, country: 'AU' } });
    return J(route, 404, { error: 'not found' });
  });
  await ctx.addInitScript((s) => { try { localStorage.setItem('cb_api_base', location.origin); localStorage.setItem('cb_sess', s); localStorage.setItem('cb_locale', 'en-AU'); } catch (_) {} }, W.session('Fixture Owner', 'Fixture Shop'));
  await ctx.clock.setFixedTime(NOW);

  const txt = (sel) => page.locator(sel).first().innerText().then((s) => s.replace(/\s+/g, ' ').trim()).catch(() => '');
  const bars = (state) => page.locator('[data-testid^="tr-bar-"]' + (state ? '[data-state="' + state + '"]' : '')).count();
  const open = async (hash) => { await page.goto('about:blank'); await page.goto(base + '/finance.html' + hash); await page.waitForSelector('[data-testid="tr-chart"], [data-testid="tr-refused"]', { timeout: 20000 }).catch(() => {}); await page.waitForTimeout(400); };

  await open('#/reports/trend');
  await w.step('T1', 'Reports › Trend -> Months is the first tab; 12 bars; the server was asked once, for months', async () => {
    const pressed = await page.locator('[data-testid="tr-tab-month"][aria-pressed="true"]').count(), n = await bars(), view = await page.locator('[data-testid="fm-view-trend"][aria-current="page"]').count();
    return { ok: pressed === 1 && n === 12 && S.asked.join() === 'month' && view === 1, saw: 'pressed ' + pressed + '; ' + n + ' bars; asked ' + S.asked.join() + '; Trend view current ' + view };
  });
  await w.step('T2', 'the headline is the newest CLOSED month against last year, in the shop\'s money: "September 2026 · $1,100.00 · ↑ +10% vs last year"', async () => {
    const head = await txt('[data-testid="tr-headline"]');
    return { ok: /^September 2026 · .*1,100\.00 · ↑ \+10% vs last year$/.test(head), saw: '"' + head + '"' };
  });
  await w.step('T3', 'the running month (October) has no record -> an empty tick, never a zero bar; its note says "nothing yet"; its change is "—"', async () => {
    const state = await page.locator('[data-testid="tr-bar-2026-10"]').getAttribute('data-state').catch(() => ''), note = await txt('[data-testid="tr-note-2026-10"]'), change = await txt('[data-testid="tr-change-2026-10"]');
    return { ok: state === 'missing' && note === 'nothing yet' && change === '—', saw: 'bar ' + state + '; note "' + note + '"; change "' + change + '"' };
  });
  await w.step('T4', 'a month whose last year is short (August 2025 began on the 20th) -> no change printed: "—", never 0% or a fall', async () => {
    const change = await txt('[data-testid="tr-change-2026-08"]'), withPct = await page.locator('[data-testid^="tr-change-"]:has-text("%")').count();
    return { ok: change === '—' && withPct === 1, saw: 'Aug 2026 change "' + change + '"; rows with a % ' + withPct + ' (only September)' };
  });
  await w.step('T5', 'the chart is a picture with words: role=img, its label carries the headline; the legend names the three shapes; a dashed last-year line', async () => {
    const aria = await page.locator('[data-testid="tr-chart"]').getAttribute('aria-label').catch(() => ''), legend = await txt('[data-testid="tr-legend"]'), line = await page.locator('[data-testid="cd-lastyear"]').count();
    return { ok: /^Sales by period\. September 2026/.test(aria || '') && /Sales/.test(legend) && /Same time last year/.test(legend) && /Part of a period/.test(legend) && line === 1, saw: 'aria "' + (aria || '').slice(0, 60) + '"; legend "' + legend + '"; last-year line ' + line };
  });
  await w.step('T6', 'Years -> 7 bars; FY 2025-26 is hatched and says "11 of 12 months" (in the headline too); FY 2026-27 is running ("so far"); older years "not on CB yet"', async () => {
    await page.click('[data-testid="tr-tab-year"]'); await page.waitForSelector('[data-testid="tr-bar-2025-26"]', { timeout: 8000 }).catch(() => {}); await page.waitForTimeout(300);
    const n = await bars(), short = await page.locator('[data-testid="tr-bar-2025-26"]').getAttribute('data-state').catch(() => ''), note = await txt('[data-testid="tr-note-2025-26"]');
    const head = await txt('[data-testid="tr-headline"]'), now = await txt('[data-testid="tr-note-2026-27"]'), old = await txt('[data-testid="tr-note-2021-22"]'), cover = await page.locator('[data-testid="cbl-notice-tr-coverage"], [data-testid="tr-coverage"]').count();
    return { ok: n === 7 && short === 'partial' && note === '11 of 12 months' && /^FY 2025-26 \(11 of 12 months\) · /.test(head) && now === 'so far' && old === 'not on CB yet' && cover >= 1 && /#\/reports\/trend\/year$/.test(page.url()),
      saw: n + ' bars; FY 2025-26 ' + short + ' "' + note + '"; headline "' + head + '"; FY 2026-27 "' + now + '"; FY 2021-22 "' + old + '"; coverage notice ' + cover + '; url ' + page.url().split('#')[1] };
  });
  await w.step('T7', 'Weeks -> 52 bars, ISO weeks; last week vs the same week last year ↑ +20%; a week before the first record says "not on CB yet"', async () => {
    await page.click('[data-testid="tr-tab-week"]'); await page.waitForTimeout(700);
    const n = await bars(), last = R.weekKey(new Date(NOW.getTime() - 7 * 86400000)), change = await txt('[data-testid="tr-change-' + last + '"]');
    const oldest = R.weekKey(new Date(NOW.getTime() - 12 * 7 * 86400000)), note = await txt('[data-testid="tr-note-' + oldest + '"]');   /* twelve weeks back: before the first record (ten weeks back), and a row the list has drawn */
    return { ok: n === 52 && change === '↑ +20%' && note === 'not on CB yet' && S.asked[S.asked.length - 1] === 'week', saw: n + ' bars; ' + last + ' "' + change + '"; ' + oldest + ' "' + note + '"' };
  });
  await w.step('T8', 'Quarters -> 8 bars of the shop\'s own year (July start: Q1 = Jul–Sep), the newest "Q2 · FY 2026-27" running', async () => {
    await page.click('[data-testid="tr-tab-quarter"]'); await page.waitForTimeout(700);
    const n = await bars(), q2 = await page.locator('[data-testid="tr-row-2026-27-Q2"]').count(), q1 = await txt('[data-testid="tr-row-2026-27-Q1"]');
    return { ok: n === 8 && q2 === 1 && /Q1 · FY 2026-27/.test(q1) && /3,100\.00/.test(q1), saw: n + ' bars; Q2 row ' + q2 + '; Q1 "' + q1.slice(0, 80) + '"' };
  });
  await w.step('T9', 'the table under the chart carries every figure (Period · Sales · Last year · Change · Note), one row per bar', async () => {
    const rows = await page.locator('[data-testid^="tr-row-"]').count();
    return { ok: rows === 8, saw: rows + ' rows for 8 bars' };
  });
  await w.step('T10', 'Measures ⇄ Trend: the Measures link opens the chits list; Trend comes back', async () => {
    await page.click('[data-testid="fm-view-measures"]'); await page.waitForSelector('[data-testid="fm-list"]', { timeout: 8000 }).catch(() => {});
    const list = await page.locator('[data-testid="fm-list"]').count();
    await page.click('[data-testid="fm-view-trend"]'); await page.waitForSelector('[data-testid="tr-chart"]', { timeout: 8000 }).catch(() => {});
    return { ok: list === 1 && (await bars()) > 0, saw: 'measures list ' + list + '; trend bars back ' + (await bars()) };
  });
  await w.step('T11', 'a shop with no country set -> no chart, the sentence and its fix: Country setup', async () => {
    S.mode = 'nocountry'; await open('#/reports/trend/month');
    const words = await txt('[data-testid="tr-refused"]'), href = await page.locator('[data-testid="tr-country"]').getAttribute('href').catch(() => ''), n = await bars();
    S.mode = 'ok';
    return { ok: /Set your country, money and year first\./.test(words) && href === '/settings.html#/country' && n === 0, saw: '"' + words + '"; fix ' + href + '; bars ' + n };
  });
  await w.step('T12', 'Home -> the Till card carries the teaser: a sparkline + "↑ +12% vs last year" (arrow + sign + words), one line inside the card', async () => {
    await page.goto('about:blank'); await page.goto(base + '/'); await page.waitForSelector('[data-testid="shell-fact-trend"]', { timeout: 15000 }).catch(() => {});
    const teaser = await page.evaluate(() => { const t = document.querySelector('[data-testid="shell-facts-till"] [data-testid="shell-fact-trend"]'); return t ? { words: t.textContent.replace(/\s+/g, ' ').trim(), href: t.getAttribute('data-href'), svg: !!t.querySelector('svg[role="img"][aria-label]'), h: Math.round(t.getBoundingClientRect().height) } : null; });
    return { ok: !!teaser && teaser.svg && teaser.words === '↑ +12% vs last year' && teaser.href === '/finance.html#/reports/trend/week' && teaser.h <= 24, saw: JSON.stringify(teaser) };
  });
  await w.step('T13', 'the teaser opens Reports › Trend on Weeks', async () => {
    await page.click('[data-testid="shell-fact-trend"]'); await page.waitForSelector('[data-testid="tr-chart"]', { timeout: 15000 }).catch(() => {});
    const pressed = await page.locator('[data-testid="tr-tab-week"][aria-pressed="true"]').count();
    return { ok: /\/finance\.html#\/reports\/trend\/week$/.test(page.url()) && pressed === 1 && (await bars()) === 52, saw: page.url().replace(base, '') + '; Weeks pressed ' + pressed };
  });
  await w.step('T14', 'the Trend view only READ: nothing was written', async () => ({ ok: S.writes.length === 0, saw: 'writes ' + S.writes.length }));

  await w.step('M43', 'the stand-in answered every contract route as the API contract says', async () => { const [ok, saw] = C.finish(); return { ok, saw }; });
  await open('#/reports/trend/month');
  await require('./lib/rule13.cjs').rule13(w, 'R13', 'CB Finance › Reports › Trend', 'screen');
  if (w.errs.length) await w.step('E0', 'no page errors while walking', async () => ({ ok: false, saw: w.errs.slice(0, 2).join(' | ') }));
});
