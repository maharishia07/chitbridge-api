#!/usr/bin/env node
/**
 * e2e/walk-period.cjs — THE PERIOD CONTROL of a firm viewing a client's books (Athi 16 Nov: W8 · W14 · W15 · W17 · W18 · W20), on a MOCKED api.
 *
 * OWNS      the proof that ONE dropdown in the header line picks the year or a month for every read: the page opens on the year under review (FY 2025-26 on Seed E), each line says
 *           "Sep 2025 · 40 entries · Locked · 40/40 checked", the trial balance reads 'as at the year end', the P&L says "For 1 Jul 2025 – 30 Jun 2026" with a gross profit line, the Day book opens on
 *           the year, Who owes whom and Months follow it, the address carries &fy= (Back keeps it), switching the year moves every view. Fit at 1366x768 and 390x844 with no sideways scroll.
 * CALLED BY e2e/run-shard.cjs (walk-*.cjs) · the PR's CI walk
 * CARD      04-network/ACC-176-AUDITOR-GRANT
 * Which api: a STAND-IN with the shapes of api GET /periods (under_review · years · periods with checked and of), /pl (gross_profit), /trial-balance. It proves the web; the figures are the server's.
 *   NODE_PATH=$PWD/e2e/node_modules node e2e/walk-period.cjs
 */
'use strict';
const W = require('./lib/walk.cjs');
const TD = require('./lib/today.cjs');   /* QW1-TODAY: the one injected today (CB_TODAY) */
const C = require('./lib/contract.cjs');   /* every /api/books answer the stand-in serves is held to the api's own examples */
const T = (id) => '[data-testid="' + id + '"]';
const WIDE = { width: 1366, height: 768 }, NARROW = { width: 390, height: 844 };
const MEMBER = 'a0000000-0000-4000-8000-000000000001', OTHER = 'a0000000-0000-4000-8000-000000000002', BRAND = 'b0000000-0000-4000-8000-000000000009';
const GRANT = 'c0000000-0000-4000-8000-000000000001';
const DAY = (n) => new Date(W.nowMs() + n * 86400000).toISOString();

W.run('period', async (w) => {
  const { page, ctx, base } = w;
  const S = { calls: [], gives: [], revokes: [], given: [], refuse: null };
  const reset = () => { S.given = [{ grant_id: GRANT, grantor_entity: MEMBER, grantee_entity: BRAND, preset: 'auditor', can_see_costs: true, purpose: 'Year-end audit', granted_at: DAY(-5), expires_at: DAY(200), revoked_at: null, state: 'live' }]; };
  reset();
  const J = (r, status, body) => C.json(r, status, body);
  const example = (key) => { const hit = C.load().routes.filter((e) => e.key === key)[0]; return hit ? JSON.parse(JSON.stringify(hit.example)) : {}; };   /* the api's own answer shape, then our figures over it */
  const line = (ex, over) => Object.assign({}, ex, over);

  await ctx.route(base + '/api/**', async (r) => {
    const q = r.request(), u = new URL(q.url()), p = u.pathname, m = q.method(), h = q.headers();
    S.calls.push({ m, p, q: u.search, h });
    if (p === '/api/network-offers') { const ex = example('GET /api/network-offers'); ex.store.networks = [Object.assign({}, ex.store.networks[0], { brand_id: BRAND, brand_name: 'Acme Brand', membership: Object.assign({}, ex.store.networks[0].membership, { state: 'active' }), offers: [] })]; ex.may_design = { ok: false, why: 'Only the owner designs a network.' }; return J(r, 200, ex); }
    if (p === '/api/network-design/stores') return J(r, 200, { stores: [{ entity_id: MEMBER, name: 'Store One', city: 'Pune', km: 4, purpose: 'Tea' }, { entity_id: OTHER, name: 'Store Two', city: 'Delhi', km: 9, purpose: 'Snacks' }] });
    if (p === '/api/books-grants/consent') return J(r, 200, { headline: 'Let your network parent read your books', can_read: ['your trial balance', 'your profit and loss'], cannot: ['change or add anything'], costs: u.searchParams.get('can_see_costs') === 'false' ? 'It will not see your costs and margins.' : 'It will see your costs and margins.', rights: 'You can end this at any time.' });
    if (p === '/api/books-grants/log') return J(r, 200, { looks: [{ at: DAY(-1), grant_id: GRANT, grantee_entity: BRAND, actor_identity_id: 'x', route_pattern: 'GET /trial-balance', query_shape: null, status: 200, outcome: 'allowed' }, { at: DAY(-2), grant_id: GRANT, grantee_entity: BRAND, actor_identity_id: 'x', route_pattern: 'GET /packs', query_shape: null, status: 403, outcome: 'not_listed' }] });
    if (p === '/api/books-grants' && m === 'GET') return J(r, 200, { given: S.given, received: [{ grant_id: GRANT, grantor_entity: MEMBER, grantee_entity: BRAND, state: 'live', expires_at: DAY(200) }] });
    if (p === '/api/books-grants' && m === 'POST') { S.gives.push(JSON.parse(q.postData() || '{}')); return J(r, 201, { grant_id: GRANT, grantor_entity: MEMBER, grantee_entity: BRAND, purpose: 'x', expires_at: DAY(300) }); }
    if (/\/api\/books-grants\/[^/]+\/revoke$/.test(p)) { S.revokes.push(p); S.given = S.given.map((g) => Object.assign({}, g, { state: 'revoked', revoked_at: DAY(0) })); return J(r, 200, { grant_id: GRANT }); }
    if (p.indexOf('/api/books/') === 0) {
      if (h['x-books-for'] !== MEMBER) return J(r, 403, { error: 'No access has been given for these books.', message: 'No access has been given for these books.' });
      const sp = u.searchParams, day = (k) => sp.get(k);
      if (p === '/api/books/periods') {
        const ex = example('GET /api/books/periods'), row = ex.periods[0];
        const month = (fy, period, start, end, entries, status, checked) => Object.assign({}, row, { fiscal_year: fy, period, start_date: start, end_date: end, entries, status, checked, of: entries, sales_minor: 0, before_books: false });
        const all = [month('2025-26', 3, '2025-09-01', '2025-09-30', 40, 'soft_locked', 40), month('2025-26', 4, '2025-10-01', '2025-10-31', 30, 'soft_locked', 12), month('2024-25', 9, '2025-03-01', '2025-03-31', 10, 'hard_locked', 10)];
        return J(r, 200, { under_review: { fy: '2025-26', from: '2025-07-01', to: '2026-06-30' }, years: [{ fy: '2025-26', from: '2025-07-01', to: '2026-06-30', months: 12, locked: 12, entries: 70, checked: 52, of: 70 }, { fy: '2024-25', from: '2024-07-01', to: '2025-06-30', months: 12, locked: 12, entries: 10, checked: 10, of: 10 }], periods: all.filter((m) => !day('fy') || m.fiscal_year === day('fy')) });
      }
      if (p === '/api/books/trial-balance') { const ex = example('GET /api/books/trial-balance'); return J(r, 200, Object.assign(ex, { currency: 'AUD', asOf: day('asOf') || '2026-11-16', shown_as_at: day('asOf') || '2026-11-16', rows: [Object.assign({}, ex.rows[0], { code: '1000', name: 'Cash', dr_minor: 123400, cr_minor: 0 })] })); }
      if (p === '/api/books/pl') { const ex = example('GET /api/books/pl'); return J(r, 200, Object.assign(ex, { currency: 'AUD', from: day('from') || '2026-07-01', to: day('to') || '2026-11-16', income: [Object.assign({}, ex.income[0], { code: '4000', name: 'Sales', amount_minor: 170000, role: 'sales' })], expense: [Object.assign({}, ex.expense[0], { code: '5000', name: 'Purchases', amount_minor: 70000, role: 'purchases' })], total_income_minor: 170000, total_expense_minor: 70000, profit_minor: 100000, gross_profit: { sales_minor: 170000, cost_of_sales_minor: 70000, gross_profit_minor: 100000 } })); }
      if (p === '/api/books/bs') { const ex = example('GET /api/books/bs'); return J(r, 200, Object.assign(ex, { currency: 'AUD', asOf: day('asOf') || '2026-11-16', fy_from: '2025-07-01', equity: [Object.assign({}, ex.equity[0], { code: '3900', name: 'Net profit', role: 'profit_to_date', amount_minor: 100000 })] })); }
      if (p === '/api/books/daybook') { const ex = example('GET /api/books/daybook'); return J(r, 200, Object.assign(ex, { currency: 'AUD', from: day('from'), to: day('to'), entries: [], count: 0 })); }
      const ex = example('GET ' + p); return J(r, 200, Object.assign(ex, { parties: [] }));
    }
    return J(r, 200, {});
  });
  await ctx.addInitScript((s) => { try { localStorage.setItem('cb_api_base', location.origin); localStorage.setItem('cb_sess', s); } catch (_) {} }, W.session('Fixture Owner', 'Fixture Shop'));

  const txt = (sel) => page.locator(sel).first().innerText().then((s) => s.replace(/\s+/g, ' ').trim()).catch(() => '');
  const has = (sel) => page.locator(sel).count().then((n) => n > 0);
  const noScroll = () => page.evaluate(() => ({ y: document.documentElement.scrollHeight <= window.innerHeight + 1, x: document.documentElement.scrollWidth <= window.innerWidth + 1 }));
  const openNetwork = async () => { await page.goto(base + '/network.html'); await page.waitForSelector(T('nw-store-' + MEMBER), { timeout: 20000 }); await page.waitForTimeout(300); };
  const booksSection = async () => { await page.click(T('nw-books-door')); await page.waitForSelector(T('bg-give'), { timeout: 10000 }); await page.waitForTimeout(300); };

  const lastCall = (path) => { const list = S.calls.filter((c) => c.p === path); return list.length ? new URLSearchParams(list[list.length - 1].q) : new URLSearchParams(''); };
  const tab = async (k, sel) => { await page.click(T('bv-tab-' + k)); await page.waitForTimeout(500); if (sel) await page.waitForSelector(sel, { timeout: 8000 }); };
  const picked = () => page.$eval('#bv_period', (el) => el.value);
  const pick = async (value) => { await page.selectOption('#bv_period', value); await page.waitForTimeout(700); };
  const flat = (s) => String(s).replace(/\s+/g, ' ').trim();

  await page.setViewportSize(WIDE);
  await openNetwork();
  await page.focus(T('nw-books-' + MEMBER)); await page.keyboard.press('Enter');
  await page.waitForSelector(T('bv-band'), { timeout: 10000 }); await page.waitForSelector('#bv_period', { timeout: 10000 }); await page.waitForTimeout(500);

  await w.step('P1', 'the firm opens a client: the period control sits in the header line (the named slot of W19) and opens on the year under review (FY 2025-26), the Day book reads that year, not this month', async () => {
    const dq = lastCall('/api/books/daybook'), where = await page.$eval(T('bv-period-slot'), (el) => el.closest('[data-testid="bv-band"]') !== null);
    return { ok: (await picked()) === 'y:2025-26' && dq.get('from') === '2025-07-01' && dq.get('to') === '2026-06-30' && where, saw: 'value ' + (await picked()) + ' · daybook ' + dq.get('from') + ' – ' + dq.get('to') + ' · in the header line ' + where };
  });
  await w.step('P2', 'ONE dropdown replaces the month chips: each line says its state, e.g. "Sep 2025 · 40 entries · Locked · 40/40 checked"; the year lines sit in the same list', async () => {
    const lines = (await page.$$eval('#bv_period option', (os) => os.map((o) => o.textContent))).map(flat);
    const chips = await page.locator('[data-month]').count();
    return { ok: lines.includes('Sep 2025 · 40 entries · Locked · 40/40 checked') && lines.includes('Oct 2025 · 30 entries · Locked · 12/30 checked') && lines.some((l) => /^FY 2025-26 · .*2025 – .*2026 · 70 entries · 12 of 12 months locked · 52\/70 checked$/.test(l)) && chips === 0, saw: lines.join(' | ') + ' · chips ' + chips };
  });
  await w.step('P3', 'Trial balance: "As at" the year end (30 Jun 2026), not today', async () => {
    await tab('tb', T('bv-asat'));
    const q = lastCall('/api/books/trial-balance'), head = await txt(T('bv-asat'));
    return { ok: q.get('asOf') === '2026-06-30' && /30/.test(head) && /2026/.test(head) && /As at/.test(head), saw: 'asOf ' + q.get('asOf') + ' · ' + head };
  });
  await w.step('P4', 'Profit and loss: "For <from> – <to>" (a period, not "as at"), with a gross profit line (sales less cost of sales)', async () => {
    await tab('pl', T('bv-for'));
    const q = lastCall('/api/books/pl'), head = await txt(T('bv-for')), facts = await txt(T('bv-facts')), rows = await txt(T('bv-list'));
    return { ok: q.get('from') === '2025-07-01' && q.get('to') === '2026-06-30' && /^For /.test(head) && /2025/.test(head) && /2026/.test(head) && !(await has(T('bv-asat'))) && /Gross profit/.test(facts) && /1,000/.test(facts) && /Gross profit \(sales less cost of sales\)/.test(rows), saw: head + ' · ' + facts };
  });
  await w.step('P5', 'Balance sheet: as at the year end, and its profit line says which period it is the profit of', async () => {
    await tab('bs', T('bv-row-0'));
    const q = lastCall('/api/books/bs'), rows = await txt(T('bv-list'));
    return { ok: q.get('asOf') === '2026-06-30' && /Profit .*2025.*–.*2026/.test(rows) && !/Net profit/.test(rows), saw: 'asOf ' + q.get('asOf') + ' · ' + rows.slice(0, 120) };
  });
  await w.step('P6', 'Who owes whom reads as at the year end (capped at the shop day, E1); Months lists the months of the chosen year only', async () => {
    await tab('dues'); const d = lastCall('/api/books/dues');
    await tab('periods', T('bv-row-0')); const rows = await txt(T('bv-list'));
    const asOf = ['2026-06-30', TD.TODAY].sort()[0]; /* E1: the as-at is the earlier of the year end and the shop day, so a year still in progress is read as at today, never a future day */
    return { ok: d.get('asOf') === asOf && /September 2025/.test(rows) && /October 2025/.test(rows) && !/March 2025/.test(rows), saw: 'dues asOf ' + d.get('asOf') + ' · ' + rows.slice(0, 120) };
  });
  await w.step('P7', 'the address carries the period (?fy=2025-26); switching the year moves EVERY view (fy=2024-25 in the address, the Day book, P&L, trial balance and dues read the other year)', async () => {
    const before = page.url();
    await pick('y:2024-25');
    const after = page.url();
    await tab('daybook'); const dq = lastCall('/api/books/daybook');
    await tab('pl', T('bv-for')); const pq = lastCall('/api/books/pl');
    await tab('tb', T('bv-asat')); const tq = lastCall('/api/books/trial-balance');
    await tab('dues'); const uq = lastCall('/api/books/dues');
    return { ok: /fy=2025-26/.test(before) && /fy=2024-25/.test(after) && dq.get('from') === '2024-07-01' && dq.get('to') === '2025-06-30' && pq.get('from') === '2024-07-01' && pq.get('to') === '2025-06-30' && tq.get('asOf') === '2025-06-30' && uq.get('asOf') === '2025-06-30', saw: before.slice(-40) + ' → ' + after.slice(-40) + ' · day ' + dq.get('from') + ' · pl ' + pq.get('to') + ' · tb ' + tq.get('asOf') + ' · dues ' + uq.get('asOf') };
  });
  await w.step('P8', 'Back keeps the period: the browser Back restores the earlier screen with a year in the address and the control on it', async () => {
    await page.goBack(); await page.waitForTimeout(900);
    const url = page.url(), v = await picked();
    return { ok: /fy=2024-25|fy=2025-26/.test(url) && /^y:/.test(v), saw: url.slice(-60) + ' · control ' + v };
  });
  await w.step('P9', 'a link with the period opens on it (?view=pl&fy=2024-25), and a month pick reads that month: "For 1 Sep 2025 – 30 Sep 2025"', async () => {
    await page.goto(base + '/network.html?open=' + MEMBER + '&view=pl&fy=2024-25'); await page.waitForSelector('#bv_period', { timeout: 15000 }); await page.waitForTimeout(700);
    const v1 = await picked(), q1 = lastCall('/api/books/pl');
    await pick('m:2025-09-01|2025-09-30'); await page.waitForSelector(T('bv-for'), { timeout: 8000 });
    const q2 = lastCall('/api/books/pl'), head = await txt(T('bv-for'));
    return { ok: v1 === 'y:2024-25' && q1.get('from') === '2024-07-01' && q2.get('from') === '2025-09-01' && q2.get('to') === '2025-09-30' && /Sep/.test(head) && /from=2025-09-01/.test(page.url()), saw: v1 + ' · ' + q1.get('from') + ' · ' + q2.get('from') + ' – ' + q2.get('to') + ' · ' + head + ' · ' + page.url().slice(-60) };
  });
  await w.step('X1', 'every /api/books answer the stand-in served matched the api contract (web-api.contract.json)', async () => { const [ok, saw] = C.finish(); return { ok, saw }; });
  await w.step('M1', 'fits 1366×768 and 390×844: no sideways scroll, the control stays on the screen (390: full width under the tabs)', async () => {
    const a = await noScroll(), boxA = await page.$eval(T('bv-period-slot'), (el) => { const r = el.getBoundingClientRect(); return { l: r.left, r: r.right, w: window.innerWidth }; });
    await page.setViewportSize(NARROW); await page.waitForTimeout(400);
    const b = await noScroll(), boxB = await page.$eval(T('bv-period-slot'), (el) => { const r = el.getBoundingClientRect(); return { l: r.left, r: r.right, w: window.innerWidth }; });
    return { ok: a.x && b.x && boxA.r <= boxA.w + 1 && boxB.r <= boxB.w + 1 && boxB.l >= 0, saw: 'wide x ' + a.x + ' y ' + a.y + ' slot ' + Math.round(boxA.l) + '–' + Math.round(boxA.r) + ' · narrow x ' + b.x + ' y ' + b.y + ' slot ' + Math.round(boxB.l) + '–' + Math.round(boxB.r) };
  });
});

