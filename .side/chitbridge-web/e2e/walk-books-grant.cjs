#!/usr/bin/env node
/**
 * e2e/walk-books-grant.cjs — ACC-176 WALKED: "Who can see my books" (the member) and "Open books" (the auditor), on a MOCKED api.
 *
 * OWNS      the proof of the two web screens of the auditor grant: (member) the grant list, the plain-words consent, Give access held until yes and asked in a confirm that names who, until when and read only,
 *           End access, Who looked; (auditor) "Open books" only on a store with a live grant, the "Viewing <store> — read only" band, the X-Books-For header on every read, a refusal said in the server's words, Back to My network.
 *           Fit at 1366×768 and 390×844 with no page scroll, a keyboard path through the auditor's screen, no write control in the read-only view.
 * CALLED BY e2e/run-shard.cjs (walk-*.cjs) · the PR's CI walk
 * CARD      04-network/ACC-176-AUDITOR-GRANT
 * Which api: a STAND-IN. The answers are the shapes of api PR #1302 (routes/books-grants.js, lib/books-grants-contract.js, middleware/books-grant.js). It proves the web; the server's rules (RLS, the allow-list, the log) are proved by the api's own acc-176 tests.
 *   NODE_PATH=$PWD/e2e/node_modules node e2e/walk-books-grant.cjs
 */
'use strict';
const W = require('./lib/walk.cjs');
const C = require('./lib/contract.cjs');   /* every /api/books answer the stand-in serves is held to the api's own examples */
const T = (id) => '[data-testid="' + id + '"]';
const WIDE = { width: 1366, height: 768 }, NARROW = { width: 390, height: 844 };
const MEMBER = 'a0000000-0000-4000-8000-000000000001', OTHER = 'a0000000-0000-4000-8000-000000000002', BRAND = 'b0000000-0000-4000-8000-000000000009';
const GRANT = 'c0000000-0000-4000-8000-000000000001';
const DAY = (n) => new Date(W.nowMs() + n * 86400000).toISOString();

W.run('books-grant', async (w) => {
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
      if (S.refuse && p === S.refuse.path) return J(r, 403, { error: S.refuse.words, message: S.refuse.words, code: 'GRANT_ROUTE_NOT_LISTED' });
      if (p === '/api/books/trial-balance') { const ex = example('GET /api/books/trial-balance'); return J(r, 200, Object.assign(ex, { currency: 'INR', rows: [line(ex.rows[0], { code: '1000', name: 'Cash', group: 'Assets', dr_minor: 123400, cr_minor: 0, net_minor: 123400, prior_net_minor: 20000, change_minor: 103400, change_bp: 51700, change_over: true }), line(ex.rows[0], { code: '4000', name: 'Sales', group: 'Income', dr_minor: 0, cr_minor: 123400, net_minor: -123400, prior_net_minor: -120000, change_minor: -3400, change_bp: -283, change_over: false })] /* leader-compare #2, HAND-COMPUTED (INR minor, rule 10% AND 1,000.00 = 100000): Cash +123400 vs +20000 = +103400, +51700 bp OVER; Sales -123400 vs -120000 = -3400, -283 bp, under the amount */, over_rule: { pct_bp: 1000, min_major: 1000, min_minor: 100000 }, compare: { how: 'year', as_at: '2025-06-30' }, total_dr_minor: 123400, total_cr_minor: 123400, balanced: true, bank: [{ account_id: 'acc-1000', code: '1000', name: 'Cash', currency: 'INR', state: 'reconciled', period_to: ex.asOf || '2026-06-30', statement_minor: 125400, books_signed_minor: 123400, unexplained_minor: 0, books_now_minor: 123400, moved_minor: 0, signed_at: null }] })); }
      if (p === '/api/books/bs') { /* leader-compare #2, HAND-COMPUTED (INR minor, rule 10% AND 1,000.00): Cash 123400 vs 20000 = +103400, +51700 bp OVER; Loan 50000 vs 48000 = +2000, +416 bp under */
        const ex = example('GET /api/books/bs'), one = (row, over) => Object.assign({}, row, over);
        return J(r, 200, Object.assign(ex, { currency: 'INR', assets: [one(ex.assets[0], { code: '1000', name: 'Cash', amount_minor: 123400, prior_month_minor: 100000, prior_year_minor: 20000, change_minor: 103400, change_bp: 51700, change_over: true })], liabilities: [one(ex.liabilities[0], { code: '2000', name: 'Bank loan', amount_minor: 50000, prior_month_minor: 49000, prior_year_minor: 48000, change_minor: 2000, change_bp: 416, change_over: false, net_of: undefined })], equity: [], total_assets_minor: 123400, total_liab_equity_minor: 123400, compare: { month: null, year: { as_at: '2025-06-30', total_assets_minor: 20000, total_liabilities_minor: 48000, total_equity_minor: -28000, net_assets_minor: -28000 } }, over_rule: { pct_bp: 1000, min_major: 1000, min_minor: 100000 } }));
      }
      if (p === '/api/books/pl') { /* rank 3 (ASA 520): last year beside this year; the figures are HAND-COMPUTED (INR minor, threshold 10% AND 1,000.00 = 100000): Sales 5000000 vs 4000000 +1000000 +25% OVER · Other 120000 vs 100000 +20000 +20% under the amount · Rent 1500000 vs 1000000 +500000 +50% OVER · Wages 2100000 vs 2000000 +100000 +5% under the percent. Served direct (the api contract copy here does not carry the new keys yet). */
        const ex = example('GET /api/books/pl'), acc = (code, name, now, was, bp, over) => ({ code, name, role: 'x', amount_minor: now, prior_minor: was, change_bp: bp, share_bp: 1000, prior_share_bp: 1000, change_minor: now - was, change_over: over });
        const head = (label, now, was, bp, over, accounts) => ({ line: label.toLowerCase(), label, amount_minor: now, prior_minor: was, change_bp: bp, share_bp: 1000, change_minor: now - was, change_over: over, accounts });
        const body = Object.assign(ex, { currency: 'INR', income: [line(ex.income[0], { code: '4000', name: 'Sales', amount_minor: 5000000 }), line(ex.income[0], { code: '4100', name: 'Other income', amount_minor: 120000 })], expense: [line(ex.expense[0], { code: '5000', name: 'Rent', amount_minor: 1500000 }), line(ex.expense[0], { code: '5100', name: 'Wages', amount_minor: 2100000 })], total_income_minor: 5120000, total_expense_minor: 3600000, profit_minor: 1520000,
          by_line: { income: [head('Revenue', 5120000, 4100000, 2488, true, [acc('4000', 'Sales', 5000000, 4000000, 2500, true), acc('4100', 'Other income', 120000, 100000, 2000, false)])], expense: [head('Costs', 3600000, 3000000, 2000, true, [acc('5000', 'Rent', 1500000, 1000000, 5000, true), acc('5100', 'Wages', 2100000, 2000000, 500, false)])] },
          compare: { how: 'year', from: '2025-04-01', to: '2026-03-31', total_income_minor: 4100000, total_expense_minor: 3000000, profit_minor: 1100000, income_change_bp: 2488, expense_change_bp: 2000, profit_change_bp: 3818, income_change_minor: 1020000, expense_change_minor: 600000, profit_change_minor: 420000, income_change_over: true, expense_change_over: true, profit_change_over: true },
          over_rule: { pct_bp: 1000, min_major: 1000, min_minor: 100000 } });
        return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) }); }
      if (p === '/api/books/periods') { /* W22: the books start Jul 2025, Jul-Jan locked, Feb open under later locked months; two empty months in 2024 sit before the start */
        const ex = example('GET ' + p), row = (fy, n, ym, status, entries) => Object.assign({}, ex.periods[0], { fiscal_year: fy, period: n, start_date: ym + '-01', end_date: ym + '-28', status, entries, sales_minor: 0, before_books: fy === '2024-25' ? true : undefined });
        const months = ['2025-07', '2025-08', '2025-09', '2025-10', '2025-11', '2025-12', '2026-01', '2026-02', '2026-03'];
        return J(r, 200, Object.assign(ex, { periods: [row('2024-25', 1, '2024-07', 'open', 0), row('2024-25', 2, '2024-08', 'open', 0)].concat(months.map((ym, n) => row('2025-26', n + 1, ym, ym === '2026-02' ? 'open' : 'soft_locked', 3))), under_review: { fy: '2025-26', from: '2025-07-01', to: '2026-06-30' }, books_start: { fiscal_year: '2025-26', period: 1, start_date: '2025-07-01' }, lock_date: '2026-01-31', gaps: [{ fiscal_year: '2025-26', period: 8, start_date: '2026-02-01' }] }));
      }
      const E1 = 'e0000000-0000-4000-8000-000000000001';
      const entry = { entry_id: E1, entry_no: 'JV-0001', posting_date: '2026-11-03', doc_date: '2026-11-03', event_type: 'sale', narration: 'Cash sale', source_chit_id: null, reverses_entry_id: null, reversed_by: null, source: { chit_id: null, ref: 'B-9', kind: 'bill', counter: null, by: 'Asha', count: null, how: 'Cash', how_ref: null, split: null, bills: null, doc_at: '2026-11-03T09:00:00.000Z', recorded_at: '2026-11-03T09:05:00.000Z' }, lines: [{ code: '1000', name: 'Cash', party_id: null, party_name: 'Walk-in buyer', dr_minor: 123400, cr_minor: 0, counter: null, rate: null }, { code: '4000', name: 'Sales', party_id: null, party_name: null, dr_minor: 0, cr_minor: 123400, counter: null, rate: null }] };
      if (p === '/api/books/ledger/1000' || p === '/api/books/ledger/4000') { const ex = example('GET /api/books/ledger/:account'), cash = p.endsWith('1000'); /* the PAGED ledger the drill asks for (limit=100): its page keys (total · page · limit · next · totals · page_opening_minor) are not in the api contract's example yet (reported to cb-api), so this one answer is sent as the server sends it and not held to the example */
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(Object.assign(ex, { currency: 'INR', account: { code: cash ? '1000' : '4000', name: cash ? 'Cash' : 'Sales', nature: cash ? 'asset' : 'income' }, from: '2026-04-01', to: '2026-11-15', opening_minor: 0, lines: [{ date: '2026-11-03', doc_date: '2026-11-03', what: 'Cash sale', ref: 'JV-0001', entry_id: E1, entry_no: 'JV-0001', event_type: 'sale', reverses_entry_id: null, reversed_by: null, source_chit_id: null, source: null, party_id: null, dr_minor: cash ? 123400 : 0, cr_minor: cash ? 0 : 123400, running_minor: cash ? 123400 : -123400 }], closing_minor: cash ? 123400 : -123400, page_opening_minor: 0, total: 1, page: 1, limit: 100, next: null, totals: { dr_minor: cash ? 123400 : 0, cr_minor: cash ? 0 : 123400 } })) }); }
      if (p === '/api/books/daybook') { const ex = example('GET /api/books/daybook'); return J(r, 200, Object.assign(ex, { currency: 'INR', entries: [Object.assign({}, ex.entries[0], entry)], count: 1 })); }
      const ex = example('GET ' + p); ['entries', 'parties', 'periods'].forEach((k) => { if (Array.isArray(ex[k])) ex[k] = []; }); /* only the list keys the api's own example has: a key it does not send is not invented (X1) */ return J(r, 200, ex);
    }
    return J(r, 200, {});
  });
  await ctx.addInitScript((s) => { try { localStorage.setItem('cb_api_base', location.origin); localStorage.setItem('cb_sess', s); } catch (_) {} }, W.session('Fixture Owner', 'Fixture Shop'));

  const txt = (sel) => page.locator(sel).first().innerText().then((s) => s.replace(/\s+/g, ' ').trim()).catch(() => '');
  const has = (sel) => page.locator(sel).count().then((n) => n > 0);
  const noScroll = () => page.evaluate(() => ({ y: document.documentElement.scrollHeight <= window.innerHeight + 1, x: document.documentElement.scrollWidth <= window.innerWidth + 1 }));
  const openNetwork = async () => { await page.goto(base + '/network.html'); await page.waitForSelector(T('nw-store-' + MEMBER), { timeout: 20000 }); await page.waitForTimeout(300); };
  const booksSection = async () => { await page.click(T('nw-books-door')); await page.waitForSelector(T('bg-give'), { timeout: 10000 }); await page.waitForTimeout(300); };

  /* ═══ the auditor ═══ */
  await page.setViewportSize(WIDE);
  await openNetwork();
  await w.step('A1', 'the auditor · My network · "Open books" only on the store with a live grant', async () => {
    const one = await has(T('nw-books-' + MEMBER)), two = await has(T('nw-books-' + OTHER));
    return { ok: one && !two, saw: 'Store One button: ' + one + ' · Store Two button: ' + two };
  });
  await w.step('A2', 'the auditor · keyboard: focus "Open books", Enter → the header line names Store One with the read only tag, the trial balance is listed', async () => {
    await page.focus(T('nw-books-' + MEMBER)); await page.keyboard.press('Enter');
    await page.waitForSelector(T('bv-band'), { timeout: 10000 });
    await page.click(T('bv-tab-tb')); /* acc17 (walk A2 was a test bug): the books open on the Day book of the year under review since the period merge, so the trial balance is the tab pressed, not the first screen */
    await page.waitForSelector(T('bv-tb-bank'), { timeout: 10000 }); /* listreg 17 Nov: wait on a trial-balance-only element; bv-row-0 is also drawn by the Day book, so the read raced the tab switch */
    const band = await txt(T('bv-band')), rows = await txt(T('bv-list'));
    const asked = S.calls.filter((c) => c.p === '/api/books/trial-balance');
    const bankLine = await txt(T('bv-tb-bank')).catch(() => ''); /* RANK 9: the bank agreement of the day, under the trial balance, with its Open Bank button */
    return { ok: /Signed off to/.test(bankLine) && /Statement/.test(bankLine) && /nothing unexplained/.test(bankLine) && (await has(T('bv-tb-bank-open-acc-1000'))) && /Store One/.test(band) && /read only/.test(band) && /Cash/.test(rows) && /1,234|1234/.test(rows) && asked.length > 0 && asked.every((c) => c.h['x-books-for'] === MEMBER), saw: band + ' · ' + rows.slice(0, 80) + ' · header sent ' + asked.length + '×' };
  });
  await w.step('A3', 'the auditor · the view has no write control (every button is Back or a report)', async () => {
    const names = await page.$$eval(T('bv-band') + ' button,' + T('bv-tabs') + ' button', (els) => els.map((e) => e.textContent.trim()));
    return { ok: names.every((n) => /Back|Clients|Trial|Profit|Balance|Day|owes|Closed|Months|Bank/.test(n)) && !(await has('#nw_body [data-act]')), saw: names.join(' · ') };
  });
  /* W19 (Athi 16 Nov, "be more space cautious in each page"): on a client's books the STATIC header (crumb, name, read only tag, period slot, tabs) takes at most 15% of the viewport height and the DYNAMIC part (totals, filters, the list's own bar and head) at most another 5%, so the first data row starts at 20% or less under the app header; a list under ten rows has no search box. GUARD NAME: w19-first-data-top */
  /* W19 (Athi 16 Nov): the first data row of every client view by 20% (1366x768) / 30% (390x844) of the screen, measured from y = 0: ONE guard for both seats, e2e/lib/first-data-top.cjs (the accountant seat calls it from walk-books-adviser.cjs). */
  await w.step('W19', 'the auditor · w19-first-data-top: every books view at 1366x768 and 390x844 starts its data by 20% / 30% of the viewport from y = 0 (a view above it is held at its measured ceiling, which only falls)', () => require('./lib/first-data-top.cjs').firstDataTop(page, { T, has, WIDE, NARROW, seat: 'auditor' }));
  await w.step('D1', 'the auditor drill · trial balance row Cash → its ledger: opening, the line with its running balance, the period total and the closing', async () => {
    await page.click(T('bv-tab-tb')); await page.waitForSelector(T('bv-row-0'), { timeout: 10000 }); /* acc17: the books open on the Day book, and W19 leaves the last tab: the ledger is opened from the trial balance, so that tab is pressed first */
    await page.click(T('bv-row-0')); await page.waitForSelector(T('bd-line-0'), { timeout: 10000 });
    const title = await txt(T('bd-title')), facts = await txt(T('bd-facts')), line = await txt(T('bd-line-0'));
    const asked = S.calls.filter((c) => c.p === "/api/books/ledger/1000");
    return { ok: /1000 Cash/.test(title) && /Opening/.test(facts) && /Total debit/.test(facts) && /Closing/.test(facts) && /JV-0001/.test(line) && /1,234/.test(line) && asked.length > 0 && asked.every((c) => c.h['x-books-for'] === MEMBER && /limit=100/.test(c.q)), saw: title + ' · ' + facts + ' · ' + line };
  });
  await w.step('D2', 'the auditor drill · the ledger line opens its entry: who made it, when, each line account · party · Dr · Cr', async () => {
    await page.click(T('bd-line-0')); await page.waitForSelector(T('bd-jl-1'), { timeout: 10000 });
    const title = await txt(T('bd-title')), who = await txt(T('bd-who')), facts = await txt(T('bd-facts')), l0 = await txt(T('bd-jl-0')), l1 = await txt(T('bd-jl-1'));
    return { ok: /JV-0001/.test(title) && /Made by Asha/.test(who) && /recorded/.test(who) && /Amount/.test(facts) && !(await has(T('bd-unbalanced'))) && /Cash/.test(l0) && /Walk-in buyer/.test(l0) && /Sales/.test(l1), saw: title + ' · ' + who + ' · ' + l0 + ' · ' + l1 };
  });
  await w.step('D3', 'the auditor drill · Back to the ledger; an entry line (Sales) opens the Sales ledger', async () => {
    await page.click(T('bd-back')); await page.waitForSelector(T('bd-line-0'), { timeout: 10000 });
    await page.click(T('bd-line-0')); await page.waitForSelector(T('bd-jl-1'), { timeout: 10000 });
    await page.click(T('bd-jl-1')); await page.waitForSelector(T('bd-fact-closing'), { timeout: 10000 });
    const title = await txt(T('bd-title'));
    return { ok: /4000 Sales/.test(title), saw: title };
  });
  await w.step('D4', 'the auditor drill · fits 1366×768 with the ledger open: no page scroll, no write or export control in the sheet', async () => {
    const a = await noScroll(), names = await page.$$eval('#nw_sheet button', (els) => els.map((e) => e.textContent.trim()));
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    return { ok: a.y && a.x && !names.some((n) => /csv|export|download|print|save|post|delete|edit|add/i.test(n)), saw: 'no vertical scroll ' + a.y + ' · no sideways ' + a.x + ' · buttons ' + names.join(' / ') };
  });
  await w.step('D5', 'the auditor drill · Day book: each entry shows its amount and opens to its journal lines', async () => {
    await page.click(T('bv-tab-daybook')); await page.waitForFunction((sel) => { const n = document.querySelector(sel); return n && /JV-/.test(n.textContent); }, T('bv-row-0'), { timeout: 10000 }); /* the Day book's own row, not the tab's previous list still on show */
    const row = await txt(T('bv-row-0'));
    await page.click(T('bv-row-0'), { position: { x: 24, y: 16 } }); /* the Entry cell: the middle of the row is the Evidence chip, which opens its own dialog */ await page.waitForSelector(T('bd-jl-1'), { timeout: 10000 });
    const title = await txt(T('bd-title'));
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    await page.click(T('bv-tab-tb')); await page.waitForSelector(T('bv-row-0'), { timeout: 10000 });
    return { ok: /JV-0001/.test(row) && /1,234/.test(row) && /JV-0001/.test(title) && !(await has(T('bd-back'))), saw: row + ' · ' + title };
  });
  await w.step('A4', 'the auditor · Profit and loss by keyboard: Tab to the tab, Enter → income, expense and the profit', async () => {
    await page.focus(T('bv-tab-pl')); await page.keyboard.press('Enter');
    await page.waitForSelector(T('bv-fact-profit_minor'), { timeout: 10000 });
    const facts = await txt(T('bv-facts')), rows = await txt(T('bv-list'));
    return { ok: /Profit/.test(facts) && /Rent/.test(rows) && /Sales/.test(rows), saw: facts + ' · ' + rows.slice(0, 70) };
  });
  await w.step('A4c', 'the auditor · P&L comparatives: Last year, Change (amount) and % beside each ledger; exactly Sales and Rent highlighted (the dot and the tint), Other income (under 1,000.00) and Wages (5%) not; the note states the rule; no sideways scroll', async () => {
    const head = await txt(T('bv-list')), dots = await page.locator('[data-cbsid="NET005-P02"]').count(), tint = await page.locator('.bv-over').count(), note = await txt(T('bv-cmp-note')), a = await noScroll();
    const rowOf = (n) => page.locator(T('bv-list') + ' [data-testid^="bv-row-"]').filter({ hasText: n }).first();
    const flat = (n) => rowOf(n).innerText().then((s) => s.replace(/\s+/g, ' '));
    const sales = await flat('Sales'), wages = await flat('Wages'), other = await flat('Other income');
    return { ok: /last year/i.test(head) && /change/i.test(head) && dots === 2 && tint === 2 && /10,000/.test(sales) && /[+]25[.]0%/.test(sales) && /[+]5[.]0%/.test(wages) && /[+].*1,000/.test(wages) && !/●/.test(wages) && !/●/.test(other) && /Highlighted: change of 10% and .*1,000 or more/.test(note) && a.x, saw: 'dots ' + dots + ' tinted ' + tint + ' · ' + note + ' · Sales: ' + sales + ' · Wages: ' + wages + ' · no sideways ' + a.x };
  });
  await w.step('A4d', 'the auditor · trial balance: Last year (Dr/Cr), Change and % beside each account; only Cash is highlighted (+1,034.00 on 200.00), Sales (credit rose 34.00, so +34.00 Cr: F3, on its own side) is not; the note states the rule under the list', async () => {
    await page.click(T('bv-tab-tb')); await page.waitForSelector(T('bv-row-0'), { timeout: 10000 }); await page.waitForTimeout(300);
    const head = await txt(T('bv-list')), dots = await page.locator('[data-cbsid="NET005-P02"]').count(), tint = await page.locator('.bv-over').count(), note = await txt(T('bv-cmp-note')), a = await noScroll();
    const flat = (n) => page.locator(T('bv-list') + ' [data-testid^="bv-row-"]').filter({ hasText: n }).first().innerText().then((x) => x.replace(/s+/g, ' '));
    const cash = await flat('Cash'), sales = await flat('Sales');
    const heads = [/last year/i.test(head), /change/i.test(head)]; return { ok: /last year/i.test(head) && /change/i.test(head) && dots === 1 && tint === 1 && /200[.]00 Dr/.test(cash) && /[+]₹1,034[.]00/.test(cash) && /[+]517[.]0%/.test(cash) && /1,200[.]00 Cr/.test(sales) && /[+]₹34[.]00\sCr/.test(sales) && /[+]2[.]8%/.test(sales) && !/●/.test(sales) && /Highlighted: change of 10% and .*1,000 or more/.test(note) && a.x, saw: 'headings ' + heads + ' · list head: ' + head.slice(0, 160) + ' · dots ' + dots + ' tinted ' + tint + ' · ' + note + ' · Cash: ' + cash + ' · Sales: ' + sales + ' · no sideways ' + a.x };
  });
  await w.step('A4e', 'the auditor · balance sheet: Last year, Change and % beside each account; Cash highlighted (+1,034.00 on 200.00), the loan (+20.00, 4.2%) not; the note states the rule', async () => {
    await page.click(T('bv-tab-bs')); await page.waitForSelector(T('bv-row-0'), { timeout: 10000 }); await page.waitForTimeout(300);
    const head = await txt(T('bv-list')), dots = await page.locator('[data-cbsid="NET005-P02"]').count(), tint = await page.locator('.bv-over').count(), note = await txt(T('bv-cmp-note')), a = await noScroll();
    const flat = (n) => page.locator(T('bv-list') + ' [data-testid^="bv-row-"]').filter({ hasText: n }).first().innerText().then((x) => x.replace(/s+/g, ' '));
    const cash = await flat('Cash'), loan = await flat('Bank loan');
    return { ok: /last year/i.test(head) && /change/i.test(head) && dots === 1 && tint === 1 && /1,234[.]00/.test(cash) && /200[.]00/.test(cash) && /[+]₹1,034[.]00/.test(cash) && /[+]517[.]0%/.test(cash) && /[+]₹20[.]00/.test(loan) && /[+]4[.]2%/.test(loan) && !/●/.test(loan) && /Highlighted: change of 10% and .*1,000 or more/.test(note) && a.x, saw: 'dots ' + dots + ' tinted ' + tint + ' · ' + note + ' · Cash: ' + cash + ' · Loan: ' + loan + ' · no sideways ' + a.x };
  });
  await w.step('A5', 'the auditor · a part the server refuses is said in the server\'s words, not shown as an empty table', async () => {
    S.refuse = { path: '/api/books/bs', words: 'This part of the books is not open to an auditor.' };
    await page.click(T('bv-tab-bs')); await page.waitForSelector(T('bv-why'), { timeout: 10000 });
    const why = await txt(T('bv-why') + ' p'), tbl = await has(T('bv-row-0'));
    S.refuse = null;
    return { ok: why === 'This part of the books is not open to an auditor.' && !tbl, saw: why };
  });
  await w.step('A6', 'the auditor · fits 1366×768 with no page scroll, in the view and on the list', async () => {
    const a = await noScroll();
    return { ok: a.y && a.x, saw: 'no vertical scroll ' + a.y + ' · no sideways ' + a.x };
  });
  await w.step('A7', 'the auditor · Back to My network → the list again, focus on the same "Open books"', async () => {
    await page.click(T('bv-back')); await page.waitForSelector(T('nw-store-' + MEMBER), { timeout: 10000 }); await page.waitForTimeout(200);
    const focused = await page.evaluate(() => document.activeElement && document.activeElement.getAttribute('data-testid'));
    return { ok: focused === 'nw-books-' + MEMBER, saw: 'focus on ' + focused };
  });
  await page.setViewportSize(NARROW); await page.waitForTimeout(300);
  await w.step('A8', 'the auditor · 390×844: Open books → the band and the list fit, no page scroll, no sideways scroll', async () => {
    await page.click(T('nw-books-' + MEMBER)); await page.waitForSelector(T('bv-band'), { timeout: 10000 }); await page.waitForSelector(T('bv-row-0'), { timeout: 10000 });
    const a = await noScroll();
    return { ok: a.y && a.x, saw: 'no vertical scroll ' + a.y + ' · no sideways ' + a.x };
  });

  await w.step('D6', 'the auditor drill · 390×844: trial balance → ledger sheet fits, no page scroll', async () => {
    await page.selectOption(T('bv-tab-select'), 'tb'); await page.waitForSelector(T('bv-row-0'), { timeout: 10000 }); /* acc17: the books open on the Day book; on a phone the six screens are ONE select (bv-tab-select), no tab buttons (T6 header line) */
    await page.click(T('bv-row-0')); await page.waitForSelector(T('bd-line-0'), { timeout: 10000 });
    const a = await noScroll(), sheet = await page.evaluate(() => { const d = document.getElementById('nw_sheet').getBoundingClientRect(); return d.width <= window.innerWidth + 1 && d.height <= window.innerHeight + 1; });
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    return { ok: a.y && a.x && sheet, saw: 'no vertical scroll ' + a.y + ' · no sideways ' + a.x + ' · sheet inside the screen ' + sheet };
  });

  await w.step('A8c', 'the auditor · 390×844: the P&L keeps Amount and Change, the note shows, a highlighted row is marked, no page scroll, no sideways scroll', async () => {
    await page.selectOption(T('bv-tab-select'), 'pl'); await page.waitForSelector(T('bv-row-0'), { timeout: 10000 }); await page.waitForTimeout(300);
    const a = await noScroll(), dots = await page.locator('[data-cbsid="NET005-P02"]').count(), note = await has(T('bv-cmp-note')), noteIn = await page.evaluate(() => { const n = document.querySelector('[data-testid="bv-cmp-note"]'); return !!n && n.getBoundingClientRect().bottom <= window.innerHeight; });
    return { ok: a.y && a.x && dots === 2 && note && noteIn, saw: 'no vertical scroll ' + a.y + ' · no sideways ' + a.x + ' · dots ' + dots + ' · note ' + note + ' in the screen ' + noteIn };
  });
  await w.step('A8d', 'the auditor · 390×844: the trial balance and the balance sheet keep their Amount and Change, the note shows, one highlighted row is marked each, no page scroll, no sideways scroll', async () => {
    const seen = [];
    for (const tab of ['tb', 'bs']) {
      await page.selectOption(T('bv-tab-select'), tab); await page.waitForSelector(T('bv-row-0'), { timeout: 10000 }); await page.waitForTimeout(500);
      const a = await noScroll(), dots = await page.locator('[data-cbsid="NET005-P02"]').count(), noteIn = await page.evaluate(() => { const n = document.querySelector('[data-testid="bv-cmp-note"]'); return !!n && n.getBoundingClientRect().bottom <= window.innerHeight; });
      seen.push(tab + ': no vertical scroll ' + a.y + ' · no sideways ' + a.x + ' · dots ' + dots + ' · note in the screen ' + noteIn);
      if (!(a.y && a.x && dots === 1 && noteIn)) return { ok: false, saw: seen.join(' | ') };
    }
    return { ok: true, saw: seen.join(' | ') };
  });
  await w.step('A9', 'the auditor · Months: one lock line (Books start Jul 2025 · Locked to 31 Jan 2026 · Open: Feb 2026 (gap)); no month before Jul 2025 is listed', async () => {
    await page.selectOption(T('bv-tab-select'), 'periods'); await page.waitForSelector(T('bv-lock-lines'), { timeout: 10000 }); await page.waitForSelector(T('bv-row-0'), { timeout: 10000 });
    const lines = await page.getAttribute(T('bv-lock-lines'), 'data-full'), list = await txt(T('bv-list'));
    return { ok: /Books start Jul 2025/.test(lines) && /Locked to .*Jan.* 2026/.test(lines) && /Open: Feb 2026 \(gap\)/.test(lines) && !/2024/.test(list) && /July 2025/.test(list), saw: lines + ' | ' + list.slice(0, 80) };
  });

  /* ═══ the member ═══ */
  await page.setViewportSize(WIDE);
  await openNetwork(); await booksSection();
  await w.step('M1', 'the member · My books › Access I gave: the grant, its purpose, until when and "Open"', async () => {
    const list = await txt(T('bg-list'));
    return { ok: /Acme Brand/.test(list) && /Open/.test(list), saw: list.slice(0, 120) };
  });
  await w.step('M2', 'the member · Give access: the plain-words consent shows; "Give access" stays greyed until yes is ticked', async () => {
    await page.click(T('bg-give')); await page.waitForSelector(T('bg-consent') + ' b', { timeout: 10000 });
    const consent = await txt(T('bg-consent')), before = await page.locator(T('bg-go')).isDisabled();
    await page.check(T('bg-yes')); const after = await page.locator(T('bg-go')).isDisabled();
    const until = await page.inputValue(T('bg-until')), months = Math.round((new Date(until + 'T12:00:00') - W.nowMs()) / 86400000 / 30.4);
    return { ok: /read your books/.test(consent) && /cannot/i.test(consent) && before && !after && months >= 11 && months <= 12, saw: 'greyed ' + before + ' → ' + after + ' · default end ' + until + ' (~' + months + ' months)' };
  });
  await w.step('M3', 'the member · untick costs → the consent says it will not see costs and margins, yes is cleared', async () => {
    await page.uncheck(T('bg-costs')); await page.waitForTimeout(400);
    const consent = await txt(T('bg-consent')), yes = await page.isChecked(T('bg-yes'));
    return { ok: /will not see your costs/.test(consent) && !yes, saw: consent.slice(-60) + ' · yes ' + yes };
  });
  await w.step('M4', 'the member · Give access asks first (who, until when, read only); Cancel sends nothing; Yes sends ONE post with consent', async () => {
    await page.check(T('bg-yes')); await page.click(T('bg-go')); await page.waitForSelector(T('confirm'), { timeout: 5000 });
    const ask = await txt(T('confirm'));
    await page.click(T('confirm-cancel')); await page.waitForTimeout(300);
    const none = S.gives.length === 0;
    await page.click(T('bg-go')); await page.waitForSelector(T('confirm'), { timeout: 5000 }); await page.click(T('confirm-ok')); await page.waitForTimeout(600);
    const sent = S.gives[0] || {};
    return { ok: /Acme Brand/.test(ask) && /read only/i.test(ask) && /until/i.test(ask) && none && S.gives.length === 1 && sent.consent === true && sent.grantee === BRAND && sent.can_see_costs === false && !!sent.expires_at, saw: ask.slice(0, 110) + ' · posts ' + S.gives.length };
  });
  await w.step('M5', 'the member · Who looked: when, who, what — the refused look is said as refused', async () => {
    await page.click(T('bg-seg-looks')); await page.waitForSelector(T('bg-look-allowed'), { timeout: 10000 });
    const list = await txt(T('bg-list'));
    return { ok: /trial balance/i.test(list) && /Looked/.test(list) && /Refused: not open to an auditor/.test(list), saw: list.slice(0, 140) };
  });
  await w.step('M6', 'the member · End access asks first, then ends: the row says Ended', async () => {
    await page.click(T('bg-seg-given')); await page.waitForSelector('[data-testid^="bg-grant-"]', { timeout: 10000 });
    await page.click('[data-testid^="bg-grant-"]'); await page.waitForSelector(T('bg-end'), { timeout: 5000 });
    await page.click(T('bg-end')); await page.waitForSelector(T('confirm'), { timeout: 5000 });
    const ask = await txt(T('confirm')); await page.click(T('confirm-ok')); await page.waitForTimeout(700);
    const list = await txt(T('bg-list'));
    return { ok: /Acme Brand/.test(ask) && S.revokes.length === 1 && /Ended/.test(list), saw: ask.slice(0, 80) + ' · revokes ' + S.revokes.length + ' · ' + list.slice(0, 60) };
  });
  await w.step('X1', 'every /api/books answer the stand-in served matched the api contract (web-api.contract.json)', async () => { const [ok, saw] = C.finish(); return { ok, saw }; });
  await w.step('M7', 'the member · fits 1366×768 and 390×844 with no page scroll', async () => {
    const a = await noScroll(); await page.setViewportSize(NARROW); await page.waitForTimeout(300); const b = await noScroll();
    return { ok: a.y && a.x && b.y && b.x, saw: 'wide ' + a.y + '/' + a.x + ' · narrow ' + b.y + '/' + b.x };
  });
});
