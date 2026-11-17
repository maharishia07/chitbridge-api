#!/usr/bin/env node
/**
 * e2e/walk-finance-cash.cjs - CB FINANCE · CASH, WALKED (round F3: finance.html#/cash + app/cap-finance-cash.js): today's cash and bank, the next 7 or 30 days
 * in and out, and the FIRST day the shop goes below zero - in one sentence on top. Black box: it reads the tab the way an owner does (the sentence, the toggle,
 * the bars, the day table and what a day opens to) and checks the three refusals (a login that may not see it; a read that fails; the ledger off).
 * Every figure on this screen is the SERVER's (GET /api/books/cashflow) - the stand-in answers fixed numbers and the page must paint exactly those, add
 * nothing, compute nothing. Finance SUGGESTS: there is no button here that writes, and the walk counts the writes (0).
 * A FIXTURE shop ("Fixture Shop" / CBWALK0001): the site is served from this checkout, the API is a stand-in answering inside the page; nothing reaches
 * localhost:3000 or the live site. Every /api/books answer is held to the API contract (e2e/fixtures/web-api.contract.json, M43).
 *
 *   NODE_PATH=$PWD/e2e/node_modules node e2e/walk-finance-cash.cjs          headless, fast
 *   node e2e/walk-finance-cash.cjs --show                                    headed, a caption per step, a results page that stays open
 * One line per path: "ID · path · PASS/FAIL (what it saw)". Screenshots: e2e/shots/walk-finance-cash-NN.png.
 */
'use strict';
const W = require('./lib/walk.cjs');
const C = require('./lib/contract.cjs');
const J = (r, status, body) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
const crmApi = require('./lib/crm-api.cjs');   /* RAIL-LAB-SRV1: the rail card (GET /api/facts/rail) from its one builder */

/**
 * ⭐ ONE CLOCK (F3b, 2026-10-13): the walk ran red in the cloud at 23:37 UTC — the stand-in built its day 0 as the IST day (13 Oct) while the page's
 * bkToday() was the UTC day (12 Oct), so no row carried the Today tag. Now there is ONE injected instant, NOW: the browser's clock is fixed to it
 * (ctx.clock.setFixedTime) and the stand-in's days are that instant's calendar day in the SHOP's zone (Asia/Kolkata — the context's timezoneId in
 * lib/walk.cjs). The walk reads the same on any runner day. Edge runs: WALK_NOW=2026-10-12T18:29:00Z (23:59 IST) · WALK_NOW=2026-10-12T18:31:00Z (00:01 IST).
 */
const ZONE = 'Asia/Kolkata';
const NOW = new Date(process.env.WALK_NOW || '2026-10-12T16:00:00+05:30');
if (isNaN(NOW)) { console.log('WALK_NOW is not a date: ' + process.env.WALK_NOW); process.exit(2); }
const DAY_MS = 86400000;
const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });
/* day n of the window: NOW + n days, as the calendar day in the shop's zone (not UTC, not the runner's zone) */
const dayN = (n) => ymd.format(new Date(NOW.getTime() + n * DAY_MS));
const DMY = (s) => Number(s.slice(8, 10)) + ' ' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(s.slice(5, 7)) - 1] + ' ' + s.slice(0, 4);
const SRI = 'pa', MALA = 'pb';
const item = (o) => Object.assign({ kind: 'due_in', ref: 'x', party_id: null, name: '', amount_minor: 0, date: dayN(0), due_date: dayN(0), promised: false, overdue: false, cheque_no: null }, o);
/**
 * the day as the server states it: ₹50,000 in hand · a ₹5,000 cheque from Mala dated tomorrow · Mala's ₹20,000 due in two days · Sri Traders' ₹90,000 to pay in
 * three days (→ ₹15,000 short that day) · nothing else inside 7 days; GST ₹8,000 due the 20th of next month (inside 30 days only when it is). Fixed numbers.
 */
/* nodate: a shop whose pack will not guess the return date (AE without its FTA stagger) — the server sends due_date null and says why (W1-FIN) */
function answer(days, nodate) {
  const rows = [];
  let bal = 5000000, inT = 0, outT = 0, low = { date: dayN(0), balance_minor: bal }, short = null;
  for (let i = 0; i < days; i++) {
    const date = dayN(i), items = [];
    if (i === 1) items.push(item({ kind: 'cheque_in', ref: 'pay:c1', party_id: MALA, name: 'Mala Stores', amount_minor: 500000, date, due_date: date, cheque_no: '000777' }));
    if (i === 2) items.push(item({ kind: 'due_in', ref: 'SB-2', party_id: MALA, name: 'Mala Stores', amount_minor: 2000000, date, due_date: date }));
    if (i === 3) items.push(item({ kind: 'due_out', ref: 'PB-1', party_id: SRI, name: 'Sri Traders', amount_minor: 9000000, date, due_date: date }));
    if (days === 30 && i === 20 && !nodate) items.push(item({ kind: 'gst', ref: 'gst:' + date, name: 'GST', amount_minor: 800000, date, due_date: date }));
    const in_minor = items.filter((x) => /_in$/.test(x.kind)).reduce((t, x) => t + x.amount_minor, 0), out_minor = items.filter((x) => !/_in$/.test(x.kind)).reduce((t, x) => t + x.amount_minor, 0);
    bal += in_minor - out_minor; inT += in_minor; outT += out_minor;
    if (bal < low.balance_minor) low = { date, balance_minor: bal };
    if (bal < 0 && !short) short = { date, short_minor: -bal, balance_minor: bal, driver: { kind: 'due_out', ref: 'PB-1', name: 'Sri Traders', amount_minor: 9000000 }, words: 'On ' + DMY(date) + ' you will be ₹15,000 short — Sri Traders’ ₹90,000 is due that day.' };
    rows.push({ date, in_minor, out_minor, balance_minor: bal, items });
  }
  const gstDue = days === 30 ? dayN(20) : dayN(45);
  const gst = nodate ? { payable_minor: 800000, form: 'VAT201', short: 'VAT return', due_date: null, counted: false, why: 'Due date unknown until the return period is picked under Returns.' }
    : { payable_minor: 800000, form: 'GSTR-3B', short: 'GST', due_date: gstDue, counted: days === 30, why: null };
  return { asOf: dayN(0), days, from: dayN(0), to: dayN(days - 1), currency: 'INR', opening_minor: 5000000, drawer_minor: 1000000, bank_minor: 4000000, opening: [{ role: 'cash', code: '1400', name: 'Cash', balance_minor: 1000000 }, { role: 'bank', code: '1500', name: 'Bank', balance_minor: 4000000 }],
    in_minor: inT, out_minor: outT, closing_minor: bal, lowest: low, shortfall: short, words: short.words,
    uncounted: { overdue_in_minor: 1200000, overdue_parties: 1, disputed_in_minor: 0, disputed_out_minor: 0, words: '₹12,000 overdue from 1 party is not counted until it is promised or paid.' },
    gst, series: rows };
}

W.run('finance-cash', async (w) => {
  const { page, ctx, base } = w;
  const S = { mode: 'ok', asked: [], writes: [] };
  await ctx.route('**/api/**', async (r0) => {
    const r = C.wrap(r0);
    const q = r.request(), u = new URL(q.url()), p = u.pathname;
    if (q.method() !== 'GET' && !/^\/api\/events\/ticket$/.test(p)) S.writes.push(q.method() + ' ' + p);
    if (p === '/api/books/cashflow') {
      S.asked.push(u.search);
      if (S.mode === 'denied') return J(r, 403, { error: 'Only the owner may see the cash position.', message: 'Only the owner may see the cash position.' });
      if (S.mode === 'off') return J(r, 404, { error: 'Not found' });
      if (S.mode === 'broken') return J(r, 500, { error: 'Failed', message: 'database timeout at 10.0.0.5' });
      return J(r, 200, answer(u.searchParams.get('days') === '30' ? 30 : 7, S.mode === 'nodate'));
    }
    if (p === '/api/entities/me') return J(r, 200, { entity: { display_name: 'Fixture Shop', currency_code: 'INR' } });
    if (p === '/api/facts/rail') return J(r, 200, crmApi.railFacts({ suppliers: 1, customers: 3, in: 0, out: 0, stuck: 0 }));
    return J(r, 404, { error: 'not found' });
  });
  await ctx.addInitScript((s) => { try { localStorage.setItem('cb_api_base', location.origin); localStorage.setItem('cb_sess', s); } catch (_) {} }, W.session('Fixture Owner', 'Fixture Shop'));
  /* the page's clock is the stand-in's clock: Date.now / new Date in the browser answer NOW (timers still run) */
  await ctx.clock.setFixedTime(NOW);
  console.log('clock: ' + NOW.toISOString() + ' = ' + dayN(0) + ' in ' + ZONE + (process.env.WALK_NOW ? ' (WALK_NOW)' : '') + ' · runner TZ ' + (process.env.TZ || 'system'));

  const txt = (sel) => page.locator(sel).first().innerText().then((s) => s.replace(/\s+/g, ' ').trim()).catch(() => '');
  const body = () => page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
  /* a hash URL the page is already on would not reload: leave first, then arrive (each path starts from a fresh page) */
  const open = async (until) => { await page.goto('about:blank'); await page.goto(base + '/finance.html#/cash'); await page.waitForSelector(until || '[data-testid^="fc-row-"]', { timeout: 20000 }).catch(() => {}); await page.waitForTimeout(500); };
  const rows = () => page.locator('[data-testid^="fc-row-"]').count();
  const D3 = dayN(3);

  await open();
  await w.step('C1', 'Finance -> Cash -> the shortfall sentence is on top, word for word the server\'s; the Cash nav is the current one', async () => {
    const words = await txt('[data-testid="fc-words"]'), cur = await page.locator('[data-testid="fin-nav-cash"][aria-current="page"]').count();
    return { ok: words === 'On ' + DMY(D3) + ' you will be ₹15,000 short — Sri Traders’ ₹90,000 is due that day.' && cur === 1, saw: '"' + words + '"; nav current ' + cur };
  });
  await w.step('C2', 'Cash -> the page asked for 7 days and only READ: nothing was written', async () => {
    return { ok: /days=7/.test(S.asked[0] || '') && S.writes.length === 0, saw: 'asked ' + (S.asked[0] || 'nothing') + '; writes ' + S.writes.length };
  });
  await w.step('C3', 'Cash -> the four money days (of seven) as rows, the quiet days one chip; today is marked; the shortfall day says Short and its balance in Cr words (₹15,000 Cr); the opening is the server\'s ₹50,000', async () => {
    const n = await rows(), t0 = await txt('[data-testid="fc-row-' + dayN(0) + '"]'), t3 = await txt('[data-testid="fc-row-' + D3 + '"]'), op = await txt('[data-testid="fc-opening"]');
    /* the page's own day (bkToday, the shop's local day) must be the stand-in's day 0 — it was the UTC day before F3b, a day behind every IST morning */
    const pageDay = await page.evaluate(() => (typeof bkToday === 'function' ? bkToday() : 'no bkToday')).catch(() => 'threw');
    const today = await page.locator('[data-testid^="fc-row-"]:has-text("Today")').count();
    const quiet = await txt('[data-testid="fc-quiet"]');   /* l16-fin-ux dc25019a: only money days (and today) are listed; the other days are ONE chip */
    return { ok: n === 4 && /No money moved on 3 days/.test(quiet) && /Today/.test(t0) && today === 1 && pageDay === dayN(0) && /Short/.test(t3) && /short\s*₹?\s*15,000(\.00)?/.test(t3) && /50,000(\.00)?/.test(op) && !/\b(Dr|Cr)\b/.test(t3 + op), saw: n + ' rows; page day ' + pageDay + ' (fixture ' + dayN(0) + '); ' + today + ' row marked Today "' + t0.slice(0, 60) + '"; day 3 "' + t3.slice(0, 90) + '"; opening "' + op + '"' };
  });
  await w.step('C4', 'Cash -> the bars: one per day, the shortfall day\'s is the red one, the lowest day is labelled (short ₹15,000)', async () => {
    const bars = await page.locator('[data-testid^="fc-bar-"]').count(), neg = await page.locator('[data-testid^="fc-bar-"][data-neg="true"]').count(), low = (await page.locator('[data-testid="fc-low-label"]').first().textContent().catch(() => '')) || '';
    const negDate = await page.locator('[data-testid^="fc-bar-"][data-neg="true"]').first().getAttribute('data-testid').catch(() => '');
    return { ok: bars === 7 && neg === 4 && negDate === 'fc-bar-' + D3 && /short\s*₹?\s*15,000(\.00)?/.test(low) && !/\b(Dr|Cr)\b/.test(low), saw: bars + ' bars, ' + neg + ' red (first ' + negDate + '); lowest label "' + low + '"' };
  });
  await w.step('C5', 'Cash -> open the shortfall day -> what it counts: Sri Traders · Bill to pay · − ₹90,000 (the server\'s item, nothing added)', async () => {
    await page.click('[data-testid="fc-row-' + D3 + '"]'); await page.waitForSelector('[data-testid="fc-next-' + D3 + '"]', { timeout: 6000 }).catch(() => {});
    const t = await txt('[data-testid="fc-next-' + D3 + '"]');
    return { ok: /Sri Traders/.test(t) && /Bill to pay/.test(t) && /90,000/.test(t) && !/Mala/.test(t), saw: '"' + t.slice(0, 120) + '"' };
  });
  await w.step('C6', 'Cash -> open tomorrow -> the cheque in hand (000777 · Mala Stores · + ₹5,000)', async () => {
    const d1 = dayN(1);
    await page.click('[data-testid="fc-row-' + d1 + '"]'); await page.waitForSelector('[data-testid="fc-next-' + d1 + '"]', { timeout: 6000 }).catch(() => {});
    const t = await txt('[data-testid="fc-next-' + d1 + '"]');
    return { ok: /Cheque in hand 000777/.test(t) && /Mala Stores/.test(t) && /5,000/.test(t), saw: '"' + t.slice(0, 120) + '"' };
  });
  await w.step('C7', 'Cash -> what is left out is said: "₹12,000 overdue from 1 party is not counted…" (honest numbers)', async () => {
    const t = await txt('[data-testid="fc-uncounted"]');
    return { ok: /₹12,000 overdue from 1 party is not counted until it is promised or paid\./.test(t), saw: '"' + t + '"' };
  });
  await w.step('C8', 'Cash -> 30 days -> the page asks the server again (days=30), the money days only (today + 3 + the GST day), the GST chip now says the challan is inside the window', async () => {
    await page.click('[data-testid="fc-days-30"]'); await page.waitForTimeout(700);
    const n = await rows(), gst = await txt('[data-testid="fc-gst"]'), pressed = await page.locator('[data-testid="fc-days-30"][aria-pressed="true"]').count();
    return { ok: /days=30/.test(S.asked[S.asked.length - 1] || '') && n === 5 && /GST/.test(gst) && /8,000/.test(gst) && !/after this window/.test(gst) && pressed === 1 && S.writes.length === 0, saw: 'asked ' + S.asked[S.asked.length - 1] + '; ' + n + ' rows; gst chip "' + gst + '"; writes ' + S.writes.length };
  });
  await w.step('C8b', 'Cash (the pack will not guess the return date: AE without its stagger) -> the chip says the pack\'s word, the figure and the server\'s sentence — no date, nothing counted', async () => {
    S.mode = 'nodate'; await open(); await page.waitForTimeout(500);
    const gst = await txt('[data-testid="fc-gst"]'), gstRows = await page.locator('[data-testid^="fc-row-"]:has-text("Return to pay")').count();
    S.mode = 'ok'; await open(); await page.click('[data-testid="fc-days-30"]'); await page.waitForTimeout(700);   /* back to the 30-day view C8 left for C9 */
    return { ok: /^VAT return/.test(gst) && /8,000/.test(gst) && /picked under Returns/.test(gst) && !/after this window/.test(gst) && gstRows === 0, saw: 'gst chip "' + gst + '"; return rows ' + gstRows };
  });
  await w.step('C9', 'Cash -> filter "Money moving" -> only the days with something behind them stay', async () => {
    const before = await rows();
    await page.click('[data-testid="cbl-filters-fin-cash"]'); await page.waitForTimeout(300);
    const sel = page.locator('#cbl-f-fin-cash-show');
    let n = -1;
    if (await sel.count()) { await sel.selectOption('busy'); await page.waitForTimeout(500); n = await rows(); await sel.selectOption('').catch(() => {}); }
    await page.keyboard.press('Escape').catch(() => {});
    return { ok: n === 4, saw: before + ' rows before, ' + n + ' after (the 4 days with money moving)' };
  });
  await w.step('C10', 'Cash (this login may not see it) -> the owner-only sentence, greyed, and no table', async () => {
    S.mode = 'denied'; await open('[data-testid="fin-denied"]');
    const why = await txt('[data-testid="fin-denied-why"]'), n = await rows(); S.mode = 'ok';
    return { ok: /Only the owner may see the cash position/.test(why) && n === 0, saw: '"' + why + '"; ' + n + ' rows' };
  });
  await w.step('C11', 'Cash (the read fails) -> a plain sentence and Try again, never the raw server message', async () => {
    S.mode = 'broken'; await open('[data-testid="fc-list"]'); await page.waitForTimeout(700);
    const t = await body(); S.mode = 'ok';
    return { ok: /Could not read your cash position/.test(t) && /Try again/.test(t) && !/database timeout|10\.0\.0\.5/.test(t), saw: (/Could not read your cash position/.test(t) ? 'plain sentence' : 'NO plain sentence') + '; ' + (/10\.0\.0\.5/.test(t) ? 'RAW MESSAGE SHOWING' : 'no raw message') };
  });
  await w.step('C12', 'the ledger is off (M212) -> "Your ledger is off" and the owner\'s switch, on the Cash tab too', async () => {
    S.mode = 'off'; await open('[data-testid="fin-off"]');
    const t = await txt('[data-testid="fin-off"]'), on = await page.locator('[data-testid="fin-turn-on"]').isEnabled().catch(() => false); S.mode = 'ok';
    return { ok: /Your ledger is off/.test(t) && on, saw: '"' + t + '"; Turn on enabled ' + on };
  });
  await w.step('C13', 'at 390px the tab still works: the sentence, the bars and the day cards are all there', async () => {
    await page.setViewportSize({ width: 390, height: 800 }); await open(); await page.waitForTimeout(500);
    const words = await page.locator('[data-testid="fc-words"], [data-testid="fc-list"] .cbl-chip').count(), bars = await page.locator('[data-testid^="fc-bar-"]').count(), n = await rows();
    const wide = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    await page.setViewportSize({ width: 1280, height: 860 });
    return { ok: words >= 1 && bars === 7 && n === 4 && wide, saw: 'notices/chips ' + words + '; bars ' + bars + '; rows ' + n + '; no sideways scroll ' + wide };
  });
  await w.step('M43', 'the stand-in answered every /api/books call as the API contract says', async () => { const [ok, saw] = C.finish(); return { ok, saw }; });
  if (w.errs.length) await w.step('E0', 'no page errors while walking', async () => ({ ok: false, saw: w.errs.slice(0, 2).join(' | ') }));
});
