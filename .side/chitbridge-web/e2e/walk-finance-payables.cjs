#!/usr/bin/env node
/**
 * e2e/walk-finance-payables.cjs - CB FINANCE · PAYABLES, WALKED (round F4: finance.html#/payables + app/cap-finance-pay.js + payOpen's offer): what the shop
 * owes each supplier, aged, MSME day 45 and its risk, the supplier's early-pay offer, and Pay through the ONE payment path. Black box: it reads the tab the way
 * an owner does (the groups, the chips, a supplier's bills and the server's sentences), pays Mala Mills with her 2% offer, records the discount (the server's
 * own journal body, sent as given), sees the GST credit note greyed with its sentence, and checks the three refusals (owner only · a read that fails · ledger off).
 * Then the screen rules (BRIEF-RULES 13) in light AND dark at 1366 and 390 px: AA contrast of every text, no clipped text, no inner sideways scroll, no
 * floating control over content, no link to app.html, the copy within the text budget.
 * Every figure is the SERVER's (GET /api/books/dues?side=supplier&finance=1 → payable, payables) - the stand-in answers fixed numbers; the page adds nothing.
 * A FIXTURE shop ("Fixture Shop"): the site is served from this checkout, the API is a stand-in answering inside the page; nothing reaches localhost:3000 or the
 * live site. Every /api/books answer is held to the API contract (e2e/fixtures/web-api.contract.json, M43).
 *
 *   NODE_PATH=$PWD/e2e/node_modules node e2e/walk-finance-payables.cjs      headless, fast
 *   node e2e/walk-finance-payables.cjs --show                                headed, a caption per step, a results page that stays open
 * One line per path: "ID · path · PASS/FAIL (what it saw)". Screenshots: e2e/shots/walk-finance-payables-NN.png.
 */
'use strict';
const W = require('./lib/walk.cjs');
const C = require('./lib/contract.cjs');
const books = require('./lib/books-api.cjs');
const { measure } = require('./lib/theme-measure.cjs');
const J = (r, status, body) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
const crmApi = require('./lib/crm-api.cjs');   /* RAIL-LAB-SRV1: the rail card (GET /api/facts/rail) from its one builder */

/* ⭐ ONE CLOCK (as walk-finance-cash, F3b): the browser and the stand-in read the same instant; the stand-in's days are that instant's day in the shop's zone */
const ZONE = 'Asia/Kolkata';
const NOW = new Date(process.env.WALK_NOW || '2026-10-12T16:00:00+05:30');
if (isNaN(NOW)) { console.log('WALK_NOW is not a date: ' + process.env.WALK_NOW); process.exit(2); }
const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });
const dayN = (n) => ymd.format(new Date(NOW.getTime() + n * 86400000));
const DMY = (s) => Number(s.slice(8, 10)) + ' ' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(s.slice(5, 7)) - 1] + ' ' + s.slice(0, 4);

/* ── the day as the server states it (fixed numbers; lib/books-payables.view's shape) ── */
const KUMAR = 'pk', SRI = 'ps', MALA = 'pm', RAVI = 'pr';
const LATE = (d) => 'Day 45 was ' + DMY(d) + ' — this bill is an expense only in the year you pay it (Income-tax s.43B(h)).';
const PAYBY = (d) => 'Pay by ' + DMY(d) + ' — after that this bill cannot be claimed as an expense this year (Income-tax s.43B(h)).';
const bill = (o) => Object.assign({ ref: 'x', date: dayN(0), due_date: dayN(0), open_minor: 0, age_days: 0, bucket: '0_30', overdue: false, msme_day45: null, msme_days_left: null, msme_risk: false, msme_words: null, early: null, note: null }, o);   /* note: the bill's own word (R106), null here */
const buckets = (o) => Object.assign({ '0_30': 0, '31_45': 0, '46_60': 0, '60_plus': 0 }, o);
const OFFER = { pct: 2, within_days: 10, by: dayN(3), valid: true, save_minor: 60000, pay_minor: 2940000, words: '2% off if paid by ' + DMY(dayN(3)) + ' — saves ₹600',
  record: { ok: true, body: { narration: 'Early-pay discount from Mala Mills (2%)', against_ref: 'M1', client_ref: 'early:M1', lines: [{ account: '2100', party: MALA, dr_minor: 60000, cr_minor: 0 }, { account: '4230', dr_minor: 0, cr_minor: 60000 }] } },
  gst_note: { ok: false, why: 'owner_confirms', say: 'Ask Mala Mills for a GST credit note. You confirm it when it comes.' } };
function payables(paid) {
  const P = [
    { id: KUMAR, no: 'P-00003', name: 'Kumar Wholesale', payable: { total_minor: 8000000, buckets: buckets({ '31_45': 8000000 }), msme: true, msme_risk: true, msme_words: LATE(dayN(-10)), pay_by: dayN(-10), group: 'msme',
      terms: { credit_days: 30, early: null }, early: null, bills: [
        bill({ ref: 'K1', date: dayN(-40), due_date: dayN(-10), open_minor: 3000000, age_days: 40, bucket: '31_45', overdue: true, msme_day45: dayN(-10), msme_days_left: -10, msme_risk: true, msme_words: LATE(dayN(-10)) }),
        bill({ ref: 'K2', date: dayN(-41), due_date: dayN(49), open_minor: 5000000, age_days: 41, bucket: '31_45', msme_day45: dayN(4), msme_days_left: 4, msme_risk: true, msme_words: PAYBY(dayN(4)) })] } },
    { id: SRI, no: 'P-00001', name: 'Sri Traders', payable: { total_minor: 1000000, buckets: buckets({ '60_plus': 1000000 }), msme: false, msme_risk: false, msme_words: null, pay_by: dayN(-45), group: 'overdue',
      terms: { credit_days: 30, early: null }, early: null, bills: [bill({ ref: 'S1', date: dayN(-75), due_date: dayN(-45), open_minor: 1000000, age_days: 75, bucket: '60_plus', overdue: true })] } },
    { id: RAVI, no: 'P-00005', name: 'Ravi Agencies', payable: { total_minor: 400000, buckets: buckets({ '0_30': 400000 }), msme: false, msme_risk: false, msme_words: null, pay_by: dayN(3), group: 'week',
      terms: { credit_days: 14, early: null }, early: null, bills: [bill({ ref: 'R1', date: dayN(-11), due_date: dayN(3), open_minor: 400000, age_days: 11 })] } },
    { id: MALA, no: 'P-00004', name: 'Mala Mills', payable: paid ? { total_minor: 0, buckets: buckets(), msme: false, msme_risk: false, msme_words: null, pay_by: null, group: 'later', terms: { credit_days: 30, early: { pct: 2, within_days: 10 } }, early: null, bills: [] }
      : { total_minor: 3000000, buckets: buckets({ '0_30': 3000000 }), msme: false, msme_risk: false, msme_words: null, pay_by: dayN(23), group: 'later',
        terms: { credit_days: 30, early: { pct: 2, within_days: 10 } }, early: Object.assign({ ref: 'M1' }, OFFER),
        bills: [bill({ ref: 'M1', date: dayN(-7), due_date: dayN(23), open_minor: 3000000, age_days: 7, early: OFFER })] } },
  ];
  const plain = books.dues(P.map((x) => ({ party_no: x.no, name: x.name, party_id: x.id, side: 'supplier', balance_minor: -x.payable.total_minor, oldest_due: x.payable.bills.length ? x.payable.bills[0].due_date : null, buckets: { lt_1y: x.payable.total_minor } })), { asOf: dayN(0) });
  plain.parties = plain.parties.map((r) => Object.assign(r, { credit_limit_minor: null, over_limit: false, last_remind: null, payable: P.find((x) => x.id === r.party_id).payable }));
  plain.payables = { total_minor: P.reduce((t, x) => t + x.payable.total_minor, 0) };
  return plain;
}
const MALA_BILLS = [{ against_ref: 'M1', bill_no: 'MM-41', due_date: dayN(23), open_minor: 3000000, disputed: false }];

W.run('finance-payables', async (w) => {
  const { page, ctx, base } = w;
  const S = { mode: 'ok', asked: [], writes: [], pay: null, entry: null, paid: false };
  await ctx.route('**/api/**', async (r0) => {
    const r = C.wrap(r0);
    const q = r.request(), u = new URL(q.url()), p = u.pathname, b = (() => { try { return JSON.parse(q.postData() || 'null'); } catch (_) { return null; } })();
    if (q.method() !== 'GET' && !/\/payments\/preview$|^\/api\/events\/ticket$/.test(p)) S.writes.push(q.method() + ' ' + p);
    if (p === '/api/books/dues') {
      S.asked.push(u.search);
      if (S.mode === 'denied') return J(r, 403, { error: 'Only the owner may see what you owe.', message: 'Only the owner may see what you owe.' });
      if (S.mode === 'off') return J(r, 404, { error: 'Not found' });
      if (S.mode === 'broken') return J(r, 500, { error: 'Failed', message: 'database timeout at 10.0.0.5' });
      return J(r, 200, payables(S.paid));
    }
    if (p === '/api/books/payments/preview') return J(r, 200, books.payPreview(MALA_BILLS, b, 'Mala Mills'));
    if (p === '/api/books/payments' && q.method() === 'POST') { S.pay = b; return J(r, 200, books.payRecorded(MALA_BILLS, b, 'Mala Mills', { balance_minor: -60000 })); }
    if (p === '/api/books/entries' && q.method() === 'POST') { S.entry = b; S.paid = true; return J(r, 200, books.posted({ entry_no: 'MJ/26-27/0007', items: 3 })); }
    if (p === '/api/entities/me') return J(r, 200, { entity: { display_name: 'Fixture Shop', currency_code: 'INR' } });
    if (p === '/api/facts/rail') return J(r, 200, crmApi.railFacts({ suppliers: 4, customers: 3, in: 0, out: 0, stuck: 0 }));
    return J(r, 404, { error: 'not found' });
  });
  await ctx.addInitScript((s) => { try { localStorage.setItem('cb_api_base', location.origin); localStorage.setItem('cb_sess', s); } catch (_) {} }, W.session('Fixture Owner', 'Fixture Shop'));
  await ctx.clock.setFixedTime(NOW);
  console.log('clock: ' + NOW.toISOString() + ' = ' + dayN(0) + ' in ' + ZONE);

  const txt = (sel) => page.locator(sel).first().innerText().then((s) => s.replace(/\s+/g, ' ').trim()).catch(() => '');
  const body = () => page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
  const open = async (until) => { await page.goto('about:blank'); await page.goto(base + '/finance.html#/payables'); await page.waitForSelector(until || '[data-testid^="fp-row-"]', { timeout: 20000 }).catch(() => {}); await page.waitForTimeout(500); };
  const rows = () => page.locator('[data-testid^="fp-row-"]').count();

  await open();
  await w.step('P1', 'Finance -> Payables -> the nav is current; the page asked the SAME dues route for the supplier side with finance=1 and only READ', async () => {
    const cur = await page.locator('[data-testid="fin-nav-payables"][aria-current="page"]').count(), a = S.asked[0] || '';
    return { ok: cur === 1 && /side=supplier/.test(a) && /finance=1/.test(a) && S.writes.length === 0, saw: 'nav current ' + cur + '; asked ' + a + '; writes ' + S.writes.length };
  });
  await w.step('P2', 'Payables -> four groups in the order Overdue · MSME at risk · Due this week · Later, each with its supplier; the head says To pay ₹1,24,000', async () => {
    const heads = await page.locator('[data-testid^="fp-group-"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid').replace('fp-group-', '')));
    const tot = await txt('[data-testid="fp-total"]'), order = await page.locator('[data-testid^="fp-row-"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid').replace('fp-row-', '')));
    return { ok: heads.join() === 'overdue,msme,week,later' && order.join() === [SRI, KUMAR, RAVI, MALA].join() && /To pay ₹1,24,000/.test(tot), saw: 'groups ' + heads.join(' · ') + '; rows ' + order.join(' ') + '; head "' + tot + '"' };
  });
  await w.step('P3', 'Payables -> Kumar (Udyam): MSME tag, ⚠ Day 45, pay by ' + DMY(dayN(-10)) + ', ₹80,000 to pay, all of it in 31–45 days (the server\'s buckets)', async () => {
    const t = await txt('[data-testid="fp-row-' + KUMAR + '"]');
    return { ok: /MSME/.test(t) && /Day 45/.test(t) && t.indexOf(DMY(dayN(-10))) >= 0 && /80,000/.test(t), saw: '"' + t.slice(0, 160) + '"' };
  });
  await w.step('P4', 'Payables -> open Kumar -> his ages (31–45 days ₹80,000, the server\'s buckets) and both bills, each with the server\'s MSME sentence word for word (day 45 past · pay by ' + DMY(dayN(4)) + ')', async () => {
    await page.click('[data-testid="fp-row-' + KUMAR + '"]'); await page.waitForSelector('[data-testid="fp-next-' + KUMAR + '"]', { timeout: 6000 }).catch(() => {});
    const t = await txt('[data-testid="fp-next-' + KUMAR + '"]'), ages = await txt('[data-testid="fp-ages-' + KUMAR + '"]');
    return { ok: /^31–45 days ₹80,000(\.00)?$/.test(ages) && t.indexOf(LATE(dayN(-10))) >= 0 && t.indexOf(PAYBY(dayN(4))) >= 0 && /30,000/.test(t) && /50,000/.test(t), saw: 'ages "' + ages + '"; "' + t.slice(0, 260) + '"' };
  });
  await w.step('P5', 'Payables -> Mala Mills shows her offer; Pay opens THE pay sheet: the offer line, the amount filled with the server\'s ₹29,400, the bills read for it', async () => {
    const row = await txt('[data-testid="fp-row-' + MALA + '"]');
    await page.click('[data-testid="fp-pay-' + MALA + '"]'); await page.waitForSelector('[data-testid="pay_offer"]', { timeout: 6000 }).catch(() => {}); await page.waitForTimeout(900);
    const offer = await txt('[data-testid="pay_offer"]'), amt = await page.locator('#pay_amt').inputValue().catch(() => ''), title = await txt('[data-testid="pay_title"]'), bills = await page.locator('[data-testid^="alloc-row-"]').count();
    return { ok: row.indexOf(OFFER.words) >= 0 && offer === OFFER.words && /29,?400/.test(amt) && /Pay/.test(title) && /Mala Mills/.test(title) && bills === 1, saw: 'row "' + row.slice(0, 90) + '"; offer "' + offer + '"; amount ' + amt + '; title "' + title + '"; bills ' + bills };
  });
  await w.step('P6', 'Pay sheet -> Record -> the one payment route (out, ₹29,400); then the discount step: the offer, Record discount, and GST credit note GREYED with its sentence', async () => {
    await page.click('[data-testid="pay_record"]');
    await page.click('dialog[open] [data-testid="confirm-ok"]', { timeout: 5000 }).catch(() => {}); /* R102b: Record asks first — "Pay Mala Mills ₹29,400.00 by cash?" */
    await page.waitForSelector('[data-testid="pay_disc"]', { timeout: 6000 }).catch(() => {});
    const ok1 = S.pay && S.pay.direction === 'out' && S.pay.amount_minor === 2940000 && S.pay.party_id === MALA;
    const rec = await page.locator('[data-testid="pay_disc_record"]').isEnabled().catch(() => false), gst = await page.locator('[data-testid="pay_gst_note"]').isDisabled().catch(() => false), why = await txt('[data-testid="pay_gst_why"]');
    return { ok: !!ok1 && rec && gst && why === OFFER.gst_note.say && !S.entry, saw: 'payment ' + JSON.stringify(S.pay && { d: S.pay.direction, a: S.pay.amount_minor }) + '; Record discount enabled ' + rec + '; GST greyed ' + gst + ' "' + why + '"; journal sent ' + !!S.entry };
  });
  await w.step('P7', 'Record discount -> POST /api/books/entries with the SERVER\'s body (against M1, Dr 2100 · Cr 4230 ₹600, client_ref early:M1); the button becomes the fact; the list reads again', async () => {
    const n0 = S.asked.length;
    await page.click('[data-testid="pay_disc_record"]'); await page.waitForSelector('[data-testid="pay_disc_done"]', { timeout: 6000 }).catch(() => {}); await page.waitForTimeout(600);
    const e = S.entry || {}, sent = JSON.stringify({ narration: e.narration, against_ref: e.against_ref, client_ref: e.client_ref, lines: e.lines }) === JSON.stringify(OFFER.record.body);
    const done = await txt('[data-testid="pay_disc_done"]');
    return { ok: sent && e.date === dayN(0) && /Discount recorded/.test(done) && S.asked.length > n0, saw: 'body as given ' + sent + ' (date ' + e.date + '); "' + done + '"; dues asked ' + (S.asked.length - n0) + ' more' };
  });
  await page.keyboard.press('Escape').catch(() => {});
  await w.step('P8', 'Payables (this login may not see it) -> "Only the owner may see what you owe." greyed, titled Payables, no list', async () => {
    S.mode = 'denied'; await open('[data-testid="fin-denied"]');
    const why = await txt('[data-testid="fin-denied-why"]'), h = await txt('[data-testid="fin-denied"] h2'), n = await rows(); S.mode = 'ok';
    return { ok: why === 'Only the owner may see what you owe.' && h === 'Payables' && n === 0, saw: '"' + h + '" · "' + why + '"; ' + n + ' rows' };
  });
  await w.step('P9', 'Payables (the read fails) -> a plain sentence and Try again, never the raw server message', async () => {
    S.mode = 'broken'; await open('[data-testid="fp-list"]'); await page.waitForTimeout(700);
    const t = await body(); S.mode = 'ok';
    return { ok: /Could not read what you owe/.test(t) && /Try again/.test(t) && !/database timeout|10\.0\.0\.5/.test(t), saw: (/Could not read what you owe/.test(t) ? 'plain sentence' : 'NO plain sentence') + '; ' + (/10\.0\.0\.5/.test(t) ? 'RAW MESSAGE' : 'no raw message') };
  });
  await w.step('P10', 'the ledger is off (M212) -> "Your ledger is off" and the owner\'s switch, on the Payables tab too', async () => {
    S.mode = 'off'; await open('[data-testid="fin-off"]');
    const t = await txt('[data-testid="fin-off"]'), on = await page.locator('[data-testid="fin-turn-on"]').isEnabled().catch(() => false); S.mode = 'ok';
    return { ok: /Your ledger is off/.test(t) && on, saw: '"' + t + '"; Turn on enabled ' + on };
  });

  /* ── BRIEF-RULES 13: light AND dark, 1366 and 390 — the list with Kumar opened, then the pay sheet with its offer ── */
  S.paid = false;
  const audit = () => page.evaluate((src) => {
    const measureFn = eval('(' + src + ')'), pairs = measureFn();
    const bad = pairs.filter((x) => !x.grad && x.ratio < x.need).map((x) => x.cat + ' "' + x.text + '" ' + x.ratio + '<' + x.need);
    const vis = (el) => { const r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return false; for (let n = el; n && n.nodeType === 1; n = n.parentElement) { const cs = getComputedStyle(n); if (cs.display === 'none' || cs.visibility === 'hidden') return false; } return true; };
    const sheet = document.querySelector('#fin_sheet[open]'), scope = sheet || document.querySelector('#screen') || document.body;   /* the open sheet, else the screen */
    /* clipped: a text element whose own text overflows its box (ellipsis or hidden) */
    const clipped = [], seen = new Set(), tw = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
    for (let t; (t = tw.nextNode());) {
      const el = t.parentElement; if (!el || seen.has(el) || !/[A-Za-z0-9]/.test(t.nodeValue) || !vis(el)) continue; seen.add(el);
      if (el.closest('svg,.sr-only,[aria-hidden="true"],.cbl-live,option,select')) continue;
      const cs = getComputedStyle(el);
      if ((cs.textOverflow === 'ellipsis' || cs.overflowX === 'hidden' || cs.overflow === 'hidden') && el.scrollWidth > el.clientWidth + 1) clipped.push('"' + el.textContent.trim().slice(0, 30) + '"');
    }
    /* inner sideways scroll: an element that scrolls sideways (the page itself must not either) */
    const sideways = []; if (document.documentElement.scrollWidth > window.innerWidth + 1) sideways.push('page ' + document.documentElement.scrollWidth + '>' + window.innerWidth);
    scope.querySelectorAll('*').forEach((el) => { if (!vis(el)) return; const cs = getComputedStyle(el); if (/(auto|scroll)/.test(cs.overflowX) && el.scrollWidth > el.clientWidth + 1) sideways.push((el.className && String(el.className).split(' ')[0]) || el.tagName); });
    /* a floating control over content: at the centre of every row / bill line, the top element belongs to that row */
    /* only what is ON screen: the part of the element inside every clipping ancestor (a row scrolled out of the list is not covered, it is scrolled) */
    const shown = (el) => { let r = el.getBoundingClientRect(), t = r.top, b = r.bottom, l = r.left, rt = r.right;
      for (let n = el.parentElement; n && n !== document.documentElement; n = n.parentElement) { const cs = getComputedStyle(n); if (/(auto|scroll|hidden|clip)/.test(cs.overflowY + cs.overflowX)) { const q = n.getBoundingClientRect(); t = Math.max(t, q.top); b = Math.min(b, q.bottom); l = Math.max(l, q.left); rt = Math.min(rt, q.right); } }
      t = Math.max(t, 0); b = Math.min(b, window.innerHeight); return b - t >= 8 && rt - l >= 8 ? { x: l + Math.min((rt - l) / 2, 40), y: t + Math.min((b - t) / 2, 10) } : null; };
    const covered = []; scope.querySelectorAll('[data-testid^="fp-row-"],[data-testid^="fp-next-"],[data-testid="pay_disc"],[data-testid="pay_offer"]').forEach((el) => {
      if (!vis(el)) return; const pt = shown(el); if (!pt) return; const x = pt.x, y = pt.y;
      const top = document.elementFromPoint(x, y); if (top && !el.contains(top) && !top.contains(el)) covered.push(el.getAttribute('data-testid') + ' under ' + (top.getAttribute('data-testid') || top.className || top.tagName)); });
    const appLinks = document.querySelectorAll('a[href*="app.html"]').length;
    /* the text budget (design rules): any string ≤ 20 words · a title ≤ 5 · a button ≤ 3 · a chip/tag ≤ 3 */
    const words = (s) => String(s || '').replace(/[—·•›▾▸⚠✓]/g, ' ').trim().split(/\s+/).filter((x) => /[A-Za-z]/.test(x)).length;
    const over = [];
    seen.forEach((el) => { const n = words(el.textContent); if (n > 20) over.push(n + 'w "' + el.textContent.trim().slice(0, 40) + '"'); });
    scope.querySelectorAll('h1,h2,.cbl-title h1').forEach((el) => { if (vis(el) && words(el.textContent) > 5) over.push('title ' + words(el.textContent) + 'w'); });
    scope.querySelectorAll('button').forEach((el) => { if (vis(el) && !el.closest('.cbl-tools,.cbl-pop') && words(el.textContent) > 3) over.push('button "' + el.textContent.trim().slice(0, 30) + '"'); });
    scope.querySelectorAll('.tag,.optchip,.cbl-chip').forEach((el) => { if (vis(el) && !el.closest('.cbl-title') && words(el.textContent) > 3) over.push('chip "' + el.textContent.trim().slice(0, 30) + '"'); });
    return { pairs: pairs.length, bad, clipped, sideways, covered, appLinks, over };
  }, measure.toString());
  const say = (a) => a.pairs + ' texts measured; AA fails ' + a.bad.length + (a.bad.length ? ' [' + a.bad.slice(0, 3).join(' | ') + ']' : '') + '; clipped ' + a.clipped.length + (a.clipped.length ? ' [' + a.clipped.slice(0, 3).join(' ') + ']' : '')
    + '; sideways ' + a.sideways.length + (a.sideways.length ? ' [' + a.sideways.slice(0, 3).join(' ') + ']' : '') + '; covered ' + a.covered.length + (a.covered.length ? ' [' + a.covered.slice(0, 2).join(' | ') + ']' : '') + '; app.html links ' + a.appLinks + '; over budget ' + a.over.length + (a.over.length ? ' [' + a.over.slice(0, 3).join(' | ') + ']' : '');
  const clean = (a) => a.pairs > 10 && !a.bad.length && !a.clipped.length && !a.sideways.length && !a.covered.length && a.appLinks === 0 && !a.over.length;
  let k = 11;
  for (const theme of ['cream', 'dark']) {
    for (const width of [1366, 390]) {
      await w.step('P' + (k++), 'screen rules · ' + (theme === 'cream' ? 'light' : 'dark') + ' · ' + width + 'px -> the list (Kumar opened): AA contrast, nothing clipped, no inner sideways scroll, nothing covering, no app.html link, copy in budget', async () => {
        await page.setViewportSize({ width, height: 860 }); await open(); await page.evaluate((t) => CBAvatar.applyTheme(t), theme).catch(() => {}); await page.waitForTimeout(300);
        await page.click('[data-testid="fp-row-' + KUMAR + '"]').catch(() => {}); await page.waitForTimeout(400);
        const a = await audit(); return { ok: clean(a), saw: say(a) };
      });
      await w.step('P' + (k++), 'screen rules · ' + (theme === 'cream' ? 'light' : 'dark') + ' · ' + width + 'px -> the pay sheet with the offer and, after Record, the discount step: the same rules', async () => {
        S.paid = false; S.entry = null;
        await page.click('[data-testid="fp-pay-' + MALA + '"]'); await page.waitForSelector('[data-testid="pay_offer"]', { timeout: 6000 }).catch(() => {}); await page.waitForTimeout(800);
        const a1 = await audit();
        await page.click('[data-testid="pay_record"]').catch(() => {}); await page.click('dialog[open] [data-testid="confirm-ok"]', { timeout: 5000 }).catch(() => {}); await page.waitForSelector('[data-testid="pay_disc"]', { timeout: 6000 }).catch(() => {}); await page.waitForTimeout(300);
        const a2 = await audit(); await page.keyboard.press('Escape').catch(() => {});
        return { ok: clean(a1) && clean(a2), saw: 'sheet: ' + say(a1) + ' || after Record: ' + say(a2) };
      });
    }
  }
  await page.setViewportSize({ width: 1280, height: 860 });
  await w.step('M43', 'the stand-in answered every /api/books call as the API contract says', async () => { const [ok, saw] = C.finish(); return { ok, saw }; });
  if (w.errs.length) await w.step('E0', 'no page errors while walking', async () => ({ ok: false, saw: w.errs.slice(0, 2).join(' | ') }));
});
